import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';
import { normalizeBranchId, stripBranchPrefix } from '@/lib/branch-mapping';
import { getSriLankaDate } from '@/lib/date-utils';
import { sendFreeSms, buildPawnApprovedSms, getSmsGatewayConfig, resolvePawnCustomerContact } from '@/lib/sms';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getAuthenticatedUser(request);
    const { id } = await params;
    let approvedBy = '';
    try {
      const body = await request.json();
      approvedBy = body?.approvedBy || '';
    } catch {
      // body optional
    }

    // 1. Get Pawn Details
    const { data: pawn, error: fetchError } = await adminSupabase
      .from('pawns')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !pawn) {
      return NextResponse.json({ error: 'Pawn ticket not found' }, { status: 404 });
    }

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
    }

    // Role check: Only ADMIN and MANAGER can approve pawn transactions
    if (session.role !== 'ADMIN' && session.role !== 'MANAGER') {
      return NextResponse.json({ error: `Forbidden. Role '${session.role}' is not authorized to approve loans.` }, { status: 403 });
    }

    // Managers and Admins can approve transactions across all branches including Head Office

    // Auditor Unresolved Issue Check: Transaction must NOT proceed to Manager approval when Auditor has raised an unresolved issue
    if (pawn.status === 'REQUIRES_RECHECK') {
      return NextResponse.json({ 
        error: 'Cannot approve transaction. The Auditor has raised an issue/error note. This transaction requires correction and recheck before it can be approved.' 
      }, { status: 409 });
    }

    const pawnBranch = normalizeBranchId(pawn.branch_id || '');
    const cleanBill = (pawn.bill_no || '').trim();
    let issueQuery = adminSupabase.from('audit_logs').select('*').eq('action', 'AUDIT_ISSUE_RAISED');
    if (cleanBill) {
      issueQuery = issueQuery.or(`resource.eq."${cleanBill}",resource.eq."${pawn.id}"`);
    } else {
      issueQuery = issueQuery.eq('resource', pawn.id);
    }
    const { data: issues } = await issueQuery;
    const hasUnresolvedIssue = (issues || []).some((l: any) => {
      const logPawnId = l.details?.pawn_id;
      if (logPawnId && logPawnId !== pawn.id) return false;
      const logBranch = normalizeBranchId(l.branch_id || l.details?.branch_id || '');
      if (!logPawnId && pawnBranch && logBranch && logBranch !== pawnBranch) return false;
      return l.details?.status === 'REQUIRES_RECHECK' || l.details?.resolved === false;
    });

    if (hasUnresolvedIssue) {
      return NextResponse.json({ 
        error: 'Cannot approve transaction. There is an active, unresolved Auditor issue note on this transaction.' 
      }, { status: 409 });
    }

    if (pawn.status !== 'PENDING_APPROVAL' && pawn.status !== 'AUDITED_PENDING_APPROVAL') {
      return NextResponse.json({ error: 'Pawn ticket is already approved or not pending approval' }, { status: 400 });
    }

    const principal = pawn.disbursed_amount || 0;
    const managerId = session.user?.id || (session as any).id || approvedBy || 'MANAGER';
    const managerEmail = session.user?.email || (session as any).email || 'manager@mifos.lk';
    const approvalTimestamp = new Date().toISOString();

    // 2. Update Pawn Status to ACTIVE with Manager Approval Metadata (atomic status guard)
    const { data: updatedRows, error: updateError } = await adminSupabase
      .from('pawns')
      .update({ 
        status: 'ACTIVE',
        approved_by: managerId,
        approved_at: approvalTimestamp
      })
      .eq('id', id)
      .in('status', ['PENDING_APPROVAL', 'AUDITED_PENDING_APPROVAL'])
      .select('id');

    if (updateError) throw updateError;
    if (!updatedRows || updatedRows.length === 0) {
      return NextResponse.json({ error: 'Pawn ticket was already approved or modified concurrently.' }, { status: 409 });
    }

    // 3. Log Disbursement Transaction (Soft Fallback)
    const txId = crypto.randomUUID();
    let txInserted = false;
    try {
      const { error: txErr } = await adminSupabase.from('transaction').insert([{
        id: txId,
        client_id: pawn.client_id,
        type: 'PAWN_DISBURSE',
        amount: principal,
        description: `Disbursed Pawn: ${pawn.description}`,
        branch_id: pawn.branch_id,
        timestamp: approvalTimestamp
      }]);
      if (!txErr) txInserted = true;
    } catch (txErr) {
      console.warn("Transaction log warning (non-fatal):", txErr);
    }

    const rollbackApproval = async (deleteJeId?: string) => {
      if (deleteJeId) {
        await adminSupabase.from('journal_entry').delete().eq('id', deleteJeId);
      }
      if (txInserted) {
        await adminSupabase.from('transaction').delete().eq('id', txId);
      }
      await adminSupabase
        .from('pawns')
        .update({
          status: pawn.status,
          approved_by: pawn.approved_by ?? null,
          approved_at: pawn.approved_at ?? null
        })
        .eq('id', id);
    };

    // 4. Generate Automated Double-Entry General Ledger Posting BEFORE committing final audit log
    const jeId = `JE-AUTO-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const dateStr = getSriLankaDate();

    const { error: jeError } = await adminSupabase.from('journal_entry').insert([{
      id: jeId,
      date: dateStr,
      description: `Automated Posting - Originated Pawn: ${pawn.description}`,
      reference: `PAWN-${pawn.id.substring(0, 8).toUpperCase()}`,
      total_debit: principal,
      total_credit: principal,
      created_by: approvedBy || 'Manager / Admin'
    }]);

    if (jeError) {
      await rollbackApproval();
      throw jeError;
    }

    const { error: linesError } = await adminSupabase.from('journal_entry_line').insert([
      {
        journal_entry_id: jeId,
        account_name: 'Pawn Loan Portfolio (Asset)',
        debit: principal,
        credit: 0
      },
      {
        journal_entry_id: jeId,
        account_name: 'Vault Cash (Asset)',
        debit: 0,
        credit: principal
      }
    ]);

    if (linesError) {
      await rollbackApproval(jeId);
      throw linesError;
    }

    // 5. Record Manager Approval in audit_logs only after GL succeeds
    try {
      await adminSupabase.from('audit_logs').insert([{
        user_id: managerId,
        user_email: managerEmail,
        role: session.role || 'MANAGER',
        branch_id: pawn.branch_id,
        action: 'MANAGER_APPROVED',
        resource: cleanBill,
        details: {
          pawn_id: pawn.id,
          bill_no: cleanBill,
          manager_id: managerId,
          manager_email: managerEmail,
          branch_id: pawn.branch_id,
          action: 'FINAL_APPROVED',
          status: 'ACTIVE',
          approved_at: approvalTimestamp
        },
        created_at: approvalTimestamp
      }]);
    } catch (logErr) {
      console.warn("Audit log insert warning:", logErr);
    }

    // 6. Dispatch Automated Loan Approval SMS via Branch TextBee SIM (Non-fatal)
    try {
      const smsConfig = await getSmsGatewayConfig();
      const contact = await resolvePawnCustomerContact(pawn);
      if (contact.phone) {
        const ticketDisplay = stripBranchPrefix(cleanBill) || pawn.id.substring(0, 8).toUpperCase();
        const approvedMsg = buildPawnApprovedSms({
          customerName: contact.name,
          ticketNo: ticketDisplay,
          amount: principal,
          branchName: pawnBranch || pawn.branch_id,
          customTemplate: smsConfig.templates?.APPROVED,
        });
        await sendFreeSms({
          phone: contact.phone,
          message: approvedMsg,
          ticketNo: ticketDisplay,
          amount: principal,
          type: 'APPROVED',
          branchId: pawn.branch_id,
          triggerKey: 'onPawnApprove',
        });
      }
    } catch (smsErr) {
      console.warn('Approval SMS notice:', smsErr);
    }

    return NextResponse.json({ success: true, pawnId: id, journalEntryId: jeId });
  } catch (error: any) {
    console.error('Pawn approval error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
