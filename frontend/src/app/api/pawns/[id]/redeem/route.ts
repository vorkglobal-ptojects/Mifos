import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';
import { recordAuditLog } from '@/lib/audit-logger';
import { sendFreeSms, buildPawnRedeemSms } from '@/lib/sms';
import { normalizeBranchId, stripBranchPrefix } from '@/lib/branch-mapping';
import { invalidateBranchInventoryCache } from '@/lib/redis';
import { getSriLankaDate } from '@/lib/date-utils';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
    }
    const { id } = await params;
    const body = await request.json();
    const { insurance = 50, days = 1, approvedBy } = body;

    // 1. Fetch Pawn Ticket Details
    const { data: pawn, error: fetchError } = await adminSupabase
      .from('pawns')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !pawn) {
      return NextResponse.json({ error: 'Pawn ticket not found' }, { status: 404 });
    }

    if (session && session.role === 'AUDITOR') {
      return NextResponse.json({ error: 'Forbidden. Auditors are not permitted to redeem loans.' }, { status: 403 });
    }

    if (pawn.status === 'REDEEMED') {
      return NextResponse.json({ error: 'Pawn ticket is already redeemed' }, { status: 400 });
    }

    // 2. Perform Interest Calculation Logic
    const principal = pawn.disbursed_amount || 0;
    const manualInsurance = parseFloat(insurance) || 0;
    
    // Rupasinghe Tiered Interest Structure
    const tier = principal < 50000 ? 'A' : 'B';
    let interestRate = 0.0250; // Tier A: 2.50%
    let discountRate = 0.0100; // Tier A: 1.00%
    if (tier === 'B') {
      interestRate = 0.0275; // Tier B: 2.75%
      discountRate = 0.0050; // Tier B: 0.50%
    }

    const interestOne = principal * interestRate;
    const totalAmount = principal + interestOne;

    let settlement = 0;
    if (days <= 10) {
      const discount = totalAmount * discountRate;
      settlement = totalAmount - discount;
    } else if (days <= 30) {
      settlement = totalAmount;
    } else if (days <= 38) {
      settlement = principal + ((totalAmount * interestRate) * 0.25) + interestOne + manualInsurance;
    } else if (days <= 45) {
      settlement = principal + ((totalAmount * interestRate) * 0.50) + interestOne + manualInsurance;
    } else if (days <= 60) {
      settlement = principal + (totalAmount * interestRate) + interestOne + manualInsurance;
    } else {
      const months = Math.ceil(days / 30);
      settlement = principal + ((totalAmount * interestRate) * (months - 1)) + interestOne + manualInsurance;
    }

    const accruedCharges = Math.max(0, settlement - principal);
    const interest = accruedCharges;

    // 3. Mark Pawn Ticket as REDEEMED (Track servicing branch in redeemed_by if cross-branch)
    const servicingBranch = session?.branchId ? normalizeBranchId(session.branchId) : pawn.branch_id;
    const isCrossBranch = servicingBranch && normalizeBranchId(pawn.branch_id) !== servicingBranch;
    const effectiveRedeemedBy = approvedBy 
      ? (isCrossBranch ? `${approvedBy} (${servicingBranch} for ${pawn.branch_id})` : approvedBy)
      : (isCrossBranch ? `Teller (${servicingBranch} for ${pawn.branch_id})` : 'Teller / Cashier');

    const { error: updateError } = await adminSupabase
      .from('pawns')
      .update({
        status: 'REDEEMED',
        redeemed_at: new Date().toISOString(),
        redeemed_by: effectiveRedeemedBy,
        redeem_amount: settlement,
        redeem_interest: interest,
        branch_id: pawn.branch_id
      })
      .eq('id', id);

    if (updateError) throw updateError;

    // 3.5 Mark matching stock item(s) as Withdrawn (including sub-items)
    try {
      const cleanBillNo = pawn.bill_no ? stripBranchPrefix(pawn.bill_no) : (id.substring(0, 8));
      const targetBill = pawn.bill_no || id.substring(0, 8);
      await adminSupabase.from('stock_items').update({
        status: 'Withdrawn',
        withdrawal_date: getSriLankaDate(),
        withdrawal_reason: 'Pawn Redeemed (Closed)'
      }).or(`bill_no.eq."${targetBill}",bill_no.eq."${cleanBillNo}",bill_no.ilike."${cleanBillNo}-%",bill_no.ilike."${targetBill}-%"`);

      // Invalidate branch inventory cache
      await invalidateBranchInventoryCache(pawn.branch_id);
      if (isCrossBranch) {
        await invalidateBranchInventoryCache(servicingBranch);
      }
    } catch (stockErr) {
      console.warn("Could not mark matching vault stock item as Withdrawn:", stockErr);
    }

    // 4. Log Settle/Redemption Transaction in User History (Track at servicing branch where cash was received)
    try {
      await adminSupabase.from('transaction').insert([{
        id: crypto.randomUUID(),
        client_id: pawn.client_id,
        type: 'PAWN_REDEEM',
        amount: settlement,
        description: `Redeemed Pawn: ${pawn.description} (Principal: Rs. ${principal.toLocaleString()}, Charges: Rs. ${accruedCharges.toLocaleString()}, Insurance: Rs. ${manualInsurance.toLocaleString()})${isCrossBranch ? ` [Cross-Branch at ${servicingBranch}]` : ''}`,
        branch_id: servicingBranch || pawn.branch_id,
        timestamp: new Date().toISOString()
      }]);
    } catch (txErr) {
      console.warn("Transaction log warning (non-fatal):", txErr);
    }

    // 5. Post Balanced Double-Entry Journal Entry
    const jeId = `JE-AUTO-RED-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const dateStr = getSriLankaDate();

    const { error: jeError } = await adminSupabase.from('journal_entry').insert([{
      id: jeId,
      date: dateStr,
      description: `Automated Redemption Posting - Pawn: ${pawn.description}`,
      reference: `PAWN-RED-${pawn.id.substring(0, 8).toUpperCase()}`,
      total_debit: settlement,
      total_credit: settlement,
      created_by: approvedBy || 'Teller / Cashier'
    }]);

    if (jeError) {
      console.error("Journal entry creation failed during redemption:", jeError);
      // Compensating rollback of pawn ticket and stock item
      await adminSupabase.from('pawns').update({
        status: pawn.status,
        redeemed_at: null,
        redeemed_by: null,
        redeem_amount: null,
        redeem_interest: null
      }).eq('id', id);

      await adminSupabase.from('stock_items').update({
        status: 'Active',
        withdrawal_date: null,
        withdrawal_reason: null
      }).eq('bill_no', pawn.bill_no || id.substring(0, 8));

      return NextResponse.json({ 
        error: 'Accounting General Ledger posting failed. Redemption has been safely rolled back. Please retry: ' + jeError.message 
      }, { status: 500 });
    }

    // Generate balanced double-entry lines
    const journalLines = [
      {
        journal_entry_id: jeId,
        account_name: 'Vault Cash (Asset)',
        debit: settlement,
        credit: 0
      },
      {
        journal_entry_id: jeId,
        account_name: 'Pawn Loan Portfolio (Asset)',
        debit: 0,
        credit: principal
      }
    ];

    if (accruedCharges > 0) {
      journalLines.push({
        journal_entry_id: jeId,
        account_name: 'Interest & Fee Income (Revenue)',
        debit: 0,
        credit: accruedCharges
      });
    }

    const { error: linesError } = await adminSupabase.from('journal_entry_line').insert(journalLines);
    if (linesError) {
      console.error("Journal lines insert failed during redemption:", linesError);
      await adminSupabase.from('journal_entry').delete().eq('id', jeId);
      await adminSupabase.from('pawns').update({
        status: pawn.status,
        redeemed_at: null,
        redeemed_by: null,
        redeem_amount: null,
        redeem_interest: null
      }).eq('id', id);

      return NextResponse.json({ 
        error: 'Accounting entry line posting failed. Redemption rolled back: ' + linesError.message 
      }, { status: 500 });
    }

    // 6. Record Security Audit Log
    recordAuditLog(session, {
      action: 'REDEEM_PAWN',
      resource: `Pawn Ticket #${id.substring(0, 8)}`,
      branchId: servicingBranch || pawn.branch_id,
      details: {
        pawnId: id,
        settlement,
        principal,
        interest,
        insurance: manualInsurance,
        days,
        originatingBranch: pawn.branch_id,
        servicingBranch: servicingBranch || pawn.branch_id
      }
    });

    // 7. Send Free Redemption SMS Receipt via Android Gateway
    try {
      let clientPhone = pawn.phone;
      let clientName = pawn.client_name || pawn.customer_name;
      if (pawn.client_id) {
        const { data: clientRow } = await adminSupabase
          .from('clients')
          .select('phone, first_name, last_name')
          .eq('id', pawn.client_id)
          .single();
        if (clientRow) {
          if (!clientPhone) clientPhone = clientRow.phone;
          if (!clientName) clientName = `${clientRow.first_name || ''} ${clientRow.last_name || ''}`.trim();
        }
      }
      if (clientPhone) {
        const ticketDisplay = pawn.bill_no || id.substring(0, 8).toUpperCase();
        const redeemMsg = buildPawnRedeemSms({
          customerName: clientName || 'Valued Customer',
          ticketNo: ticketDisplay,
          settlementAmount: settlement,
          principalAmount: principal
        });
        await sendFreeSms({
          phone: clientPhone,
          message: redeemMsg,
          ticketNo: ticketDisplay,
          amount: settlement,
          type: 'REDEEM',
          branchId: pawn.branch_id
        });
      }
    } catch (smsErr) {
      console.warn("SMS Redeem notice:", smsErr);
    }

    return NextResponse.json({
      success: true,
      message: 'Pawn redeemed and GL accounting entries posted.',
      journalEntryId: jeId,
      settlementAmount: settlement,
      principalAmount: principal,
      interestAmount: interest
    });
  } catch (error: any) {
    console.error('Pawns Redeem API Error:', error);
    return NextResponse.json({ error: error.message || 'Server error redeeming pawn ticket' }, { status: 500 });
  }
}
