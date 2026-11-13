import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';
import { normalizeBranchId, stripBranchPrefix } from '@/lib/branch-mapping';
import { sendFreeSms, buildPawnReturnedSms, getSmsGatewayConfig, resolvePawnCustomerContact } from '@/lib/sms';

export const dynamic = 'force-dynamic';

const isUUID = (str: string) => /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(str);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getAuthenticatedUser(request);
    const { id } = await params;

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
    }

    // Role check: Only MANAGER and ADMIN can return/reject pawn transactions
    if (session.role !== 'ADMIN' && session.role !== 'MANAGER') {
      return NextResponse.json({ 
        error: `Forbidden. Role '${session.role}' is not authorized to reject or return transactions.` 
      }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const reason = (body?.reason || '').trim();

    if (!reason) {
      return NextResponse.json({ 
        error: 'A mandatory return/rejection reason must be provided before returning the transaction for recheck.' 
      }, { status: 400 });
    }

    // 1. Fetch Pawn Details by UUID (or unambiguous bill_no)
    let pawn: any = null;
    if (isUUID(id)) {
      const { data, error: fetchErr } = await adminSupabase.from('pawns').select('*').eq('id', id).maybeSingle();
      if (fetchErr) throw fetchErr;
      pawn = data;
    } else {
      const { data: matches, error: fetchErr } = await adminSupabase.from('pawns').select('*').eq('bill_no', id).limit(2);
      if (fetchErr) throw fetchErr;
      if (matches && matches.length > 1) {
        return NextResponse.json({ error: 'Ambiguous bill number across branches. Please use exact pawn UUID.' }, { status: 400 });
      }
      pawn = matches?.[0] || null;
    }

    if (!pawn) {
      return NextResponse.json({ error: 'Pawn transaction not found.' }, { status: 404 });
    }

    if (pawn.status === 'REDEEMED' || pawn.status === 'FORFEITED') {
      return NextResponse.json({
        error: `Cannot return a pawn in '${pawn.status}' status for recheck.`
      }, { status: 409 });
    }

    // 2. Managers and Admins can return or reject transactions across all branches including Head Office

    const cleanBill = pawn.bill_no || pawn.id.substring(0, 8).toUpperCase();
    const managerId = session.user?.id || (session as any).id || 'MANAGER';
    const managerEmail = session.user?.email || (session as any).email || 'manager@mifos.lk';
    const timestamp = new Date().toISOString();

    const returnDetails = {
      pawn_id: pawn.id,
      bill_no: cleanBill,
      manager_id: managerId,
      manager_email: managerEmail,
      branch_id: pawn.branch_id,
      action: 'MANAGER_RETURNED',
      reason: reason,
      returned_at: timestamp,
      previous_status: pawn.status,
      status: 'REQUIRES_RECHECK'
    };

    // 3. Save Manager Return/Rejection in audit_logs (maintains immutable audit trail)
    const { error: logErr } = await adminSupabase
      .from('audit_logs')
      .insert([{
        user_id: managerId,
        user_email: managerEmail,
        role: session.role || 'MANAGER',
        branch_id: pawn.branch_id,
        action: 'MANAGER_RETURNED',
        resource: cleanBill,
        details: returnDetails,
        created_at: timestamp
      }]);

    if (logErr) {
      console.error('Error inserting manager return audit log:', logErr);
      throw logErr;
    }

    // 4. Send transaction back for rechecking (status: REQUIRES_RECHECK)
    // Note: Stock update is NOT allowed, and customer release is NOT allowed
    const { error: updateErr } = await adminSupabase
      .from('pawns')
      .update({
        status: 'REQUIRES_RECHECK'
      })
      .eq('id', pawn.id);

    if (updateErr) {
      console.error('Error updating pawn status to REQUIRES_RECHECK:', updateErr);
      throw updateErr;
    }

    // 5. Optional Automated Return/Rejection SMS (only fires if Admin enables 'onPawnReject')
    try {
      const smsConfig = await getSmsGatewayConfig();
      if (smsConfig.triggers?.onPawnReject) {
        const contact = await resolvePawnCustomerContact(pawn);
        if (contact.phone) {
          const ticketDisplay = stripBranchPrefix(cleanBill) || pawn.id.substring(0, 8).toUpperCase();
          const returnMsg = buildPawnReturnedSms({
            customerName: contact.name,
            ticketNo: ticketDisplay,
            reason,
            branchName: normalizeBranchId(pawn.branch_id || ''),
            customTemplate: smsConfig.templates?.REJECTED,
          });
          await sendFreeSms({
            phone: contact.phone,
            message: returnMsg,
            ticketNo: ticketDisplay,
            type: 'REJECTED',
            branchId: pawn.branch_id,
            triggerKey: 'onPawnReject',
          });
        }
      }
    } catch (smsErr) {
      console.warn('Return/Reject SMS notice:', smsErr);
    }

    return NextResponse.json({
      success: true,
      message: `Transaction for Bill #${cleanBill} has been returned for rechecking.`,
      pawnId: pawn.id,
      status: 'REQUIRES_RECHECK',
      returnRecord: returnDetails
    });
  } catch (error: any) {
    console.error('Manager Return/Reject POST Error:', error);
    return NextResponse.json({ error: error.message || 'Failed to process return/rejection' }, { status: 500 });
  }
}
