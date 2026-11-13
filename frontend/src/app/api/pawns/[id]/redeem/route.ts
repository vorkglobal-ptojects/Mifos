import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';
import { recordAuditLog } from '@/lib/audit-logger';
import { sendFreeSms, buildPawnRedeemSms, getSmsGatewayConfig } from '@/lib/sms';
import { normalizeBranchId, stripBranchPrefix, getBranchSearchTerms } from '@/lib/branch-mapping';
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
    if (pawn.status !== 'ACTIVE') {
      return NextResponse.json({
        error: `Cannot redeem pawn in '${pawn.status}' status. Only ACTIVE approved loans can be redeemed.`
      }, { status: 400 });
    }

    const parsedDays = Number(days);
    if (!Number.isFinite(parsedDays) || parsedDays <= 0) {
      return NextResponse.json({ error: 'Days must be a valid positive number.' }, { status: 400 });
    }
    const manualInsurance = Number(insurance ?? 0);
    if (!Number.isFinite(manualInsurance) || manualInsurance < 0) {
      return NextResponse.json({ error: 'Insurance fee must be a valid non-negative number.' }, { status: 400 });
    }

    // 2. Perform Interest Calculation Logic
    const principal = Number(pawn.disbursed_amount) || 0;
    
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
    if (parsedDays <= 10) {
      const discount = totalAmount * discountRate;
      settlement = totalAmount - discount;
    } else if (parsedDays <= 30) {
      settlement = totalAmount;
    } else if (parsedDays <= 38) {
      settlement = principal + ((totalAmount * interestRate) * 0.25) + interestOne + manualInsurance;
    } else if (parsedDays <= 45) {
      settlement = principal + ((totalAmount * interestRate) * 0.50) + interestOne + manualInsurance;
    } else if (parsedDays <= 60) {
      settlement = principal + (totalAmount * interestRate) + interestOne + manualInsurance;
    } else {
      const months = Math.ceil(parsedDays / 30);
      settlement = principal + ((totalAmount * interestRate) * (months - 1)) + interestOne + manualInsurance;
    }

    const accruedCharges = settlement - principal;
    if (accruedCharges < -0.01) {
      return NextResponse.json({
        error: 'Invalid settlement calculation: settlement cannot be lower than loan principal.'
      }, { status: 400 });
    }
    const safeAccruedCharges = Math.max(0, accruedCharges);
    const interest = safeAccruedCharges;

    // 3. Mark Pawn Ticket as REDEEMED (Track servicing branch in redeemed_by if cross-branch)
    const servicingBranch = session?.branchId ? normalizeBranchId(session.branchId) : pawn.branch_id;
    const isCrossBranch = servicingBranch && normalizeBranchId(pawn.branch_id) !== servicingBranch;
    const effectiveRedeemedBy = approvedBy 
      ? (isCrossBranch ? `${approvedBy} (${servicingBranch} for ${pawn.branch_id})` : approvedBy)
      : (isCrossBranch ? `Teller (${servicingBranch} for ${pawn.branch_id})` : 'Teller / Cashier');

    const { data: updatedPawnRows, error: updateError } = await adminSupabase
      .from('pawns')
      .update({
        status: 'REDEEMED',
        redeemed_at: new Date().toISOString(),
        redeemed_by: effectiveRedeemedBy,
        redeem_amount: settlement,
        redeem_interest: interest,
        branch_id: pawn.branch_id
      })
      .eq('id', id)
      .eq('status', 'ACTIVE')
      .select('id');

    if (updateError) throw updateError;
    if (!updatedPawnRows || updatedPawnRows.length === 0) {
      return NextResponse.json({ error: 'Pawn ticket was already modified or redeemed concurrently.' }, { status: 409 });
    }

    // 3.5 Mark matching stock item(s) strictly within the pawn's branch as Withdrawn
    let withdrawnStockIds: string[] = [];
    const pawnBranchTerms = getBranchSearchTerms(pawn.branch_id);
    try {
      const cleanBillNo = pawn.bill_no ? stripBranchPrefix(pawn.bill_no) : (id.substring(0, 8));
      const targetBill = pawn.bill_no || id.substring(0, 8);
      const { data: withdrawnRows, error: stockErr } = await adminSupabase
        .from('stock_items')
        .update({
          status: 'Withdrawn',
          withdrawal_date: getSriLankaDate(),
          withdrawal_reason: 'Pawn Redeemed (Closed)'
        })
        .in('branch_id', pawnBranchTerms)
        .eq('status', 'Active')
        .or(`bill_no.eq."${targetBill}",bill_no.eq."${cleanBillNo}",bill_no.ilike."${cleanBillNo}-%",bill_no.ilike."${targetBill}-%"`)
        .select('id');

      if (stockErr) {
        console.warn("Could not mark matching vault stock item as Withdrawn:", stockErr);
      } else {
        withdrawnStockIds = (withdrawnRows || []).map((r: { id: string }) => r.id);
      }

      // Invalidate branch inventory cache
      await invalidateBranchInventoryCache(pawn.branch_id);
      if (isCrossBranch) {
        await invalidateBranchInventoryCache(servicingBranch);
      }
    } catch (stockErr) {
      console.warn("Could not mark matching vault stock item as Withdrawn:", stockErr);
    }

    // 4. Log Settle/Redemption Transaction in User History (Track at servicing branch where cash was received)
    const txId = crypto.randomUUID();
    let txInserted = false;
    try {
      const { error: txErr } = await adminSupabase.from('transaction').insert([{
        id: txId,
        client_id: pawn.client_id,
        type: 'PAWN_REDEEM',
        amount: settlement,
        description: `Redeemed Pawn: ${pawn.description} (Principal: Rs. ${principal.toLocaleString()}, Charges: Rs. ${safeAccruedCharges.toLocaleString()}, Insurance: Rs. ${manualInsurance.toLocaleString()})${isCrossBranch ? ` [Cross-Branch at ${servicingBranch}]` : ''}`,
        branch_id: servicingBranch || pawn.branch_id,
        timestamp: new Date().toISOString()
      }]);
      if (!txErr) txInserted = true;
    } catch (txErr) {
      console.warn("Transaction log warning (non-fatal):", txErr);
    }

    const rollbackRedemption = async (deleteJeId?: string) => {
      if (deleteJeId) {
        await adminSupabase.from('journal_entry').delete().eq('id', deleteJeId);
      }
      if (txInserted) {
        await adminSupabase.from('transaction').delete().eq('id', txId);
      }
      await adminSupabase.from('pawns').update({
        status: pawn.status,
        redeemed_at: pawn.redeemed_at ?? null,
        redeemed_by: pawn.redeemed_by ?? null,
        redeem_amount: pawn.redeem_amount ?? null,
        redeem_interest: pawn.redeem_interest ?? null
      }).eq('id', id);

      if (withdrawnStockIds.length > 0) {
        await adminSupabase.from('stock_items').update({
          status: 'Active',
          withdrawal_date: null,
          withdrawal_reason: null
        }).in('id', withdrawnStockIds);
        await invalidateBranchInventoryCache(pawn.branch_id).catch(() => {});
      }
    };

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
      await rollbackRedemption();

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

    if (safeAccruedCharges > 0) {
      journalLines.push({
        journal_entry_id: jeId,
        account_name: 'Interest & Fee Income (Revenue)',
        debit: 0,
        credit: safeAccruedCharges
      });
    }

    const { error: linesError } = await adminSupabase.from('journal_entry_line').insert(journalLines);
    if (linesError) {
      console.error("Journal lines insert failed during redemption:", linesError);
      await rollbackRedemption(jeId);

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
        days: parsedDays,
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
        const smsConfig = await getSmsGatewayConfig();
        const ticketDisplay = stripBranchPrefix(pawn.bill_no) || pawn.bill_no || id.substring(0, 8).toUpperCase();
        const redeemMsg = buildPawnRedeemSms({
          customerName: clientName || 'Valued Customer',
          ticketNo: ticketDisplay,
          settlementAmount: settlement,
          principalAmount: principal,
          branchName: normalizeBranchId(pawn.branch_id || ''),
          customTemplate: smsConfig.templates?.REDEEM,
        });
        await sendFreeSms({
          phone: clientPhone,
          message: redeemMsg,
          ticketNo: ticketDisplay,
          amount: settlement,
          type: 'REDEEM',
          branchId: pawn.branch_id,
          triggerKey: 'onPawnRedeem',
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
