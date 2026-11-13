import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';
import { recordAuditLog } from '@/lib/audit-logger';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (session.role !== 'ADMIN' && session.role !== 'MANAGER') {
      return NextResponse.json({ error: `Forbidden. Role '${session.role}' is not authorized to reject or return cash requests.` }, { status: 403 });
    }

    const { id } = await params;
    const { action = 'REJECT', reason } = await request.json();

    if (!reason?.trim()) {
      return NextResponse.json({ error: 'Reason for rejection/return is required.' }, { status: 400 });
    }

    const targetStatus = action === 'RETURN' ? 'RETURNED' : 'REJECTED';

    const { data: existingReq, error: fetchErr } = await adminSupabase
      .from('cash_requests')
      .select('id, status')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr || !existingReq) {
      return NextResponse.json({ error: 'Cash request not found.' }, { status: 404 });
    }
    if (existingReq.status !== 'SUBMITTED') {
      return NextResponse.json({
        error: `Cannot ${action === 'RETURN' ? 'return' : 'reject'} request with current status '${existingReq.status}'.`
      }, { status: 409 });
    }

    const { data: updatedReq, error } = await adminSupabase
      .from('cash_requests')
      .update({
        status: targetStatus,
        rejection_reason: reason.trim(),
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .eq('status', 'SUBMITTED')
      .select()
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!updatedReq) {
      return NextResponse.json({ error: 'Cash request status changed concurrently.' }, { status: 409 });
    }

    await recordAuditLog(session, {
      action: action === 'RETURN' ? 'CASH_REQUEST_RETURNED' : 'CASH_REQUEST_REJECTED',
      resource: updatedReq.request_ref,
      branchId: updatedReq.requesting_branch_id,
      details: {
        requestRef: updatedReq.request_ref,
        reason: reason.trim(),
        action
      }
    });

    return NextResponse.json({ success: true, request: updatedReq });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
