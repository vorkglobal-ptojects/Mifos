import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';
import { ChangeRequestTicket } from '@/lib/change-requests';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: any) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userRole = (session.role || '').toUpperCase();
    if (userRole !== 'ADMIN' && userRole !== 'MANAGER') {
      return NextResponse.json({ error: 'Forbidden. Only Managers and Admins can reject change request tickets.' }, { status: 403 });
    }

    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const reviewNotes = (body.notes || body.reason || 'Rejected by Manager').trim();

    // 1. Fetch ticket from audit_logs
    const { data: auditRow, error: fetchErr } = await adminSupabase
      .from('audit_logs')
      .select('*')
      .eq('id', id)
      .eq('action', 'CHANGE_REQUEST')
      .maybeSingle();

    if (fetchErr || !auditRow) {
      return NextResponse.json({ error: 'Change request ticket not found' }, { status: 404 });
    }

    const ticket: ChangeRequestTicket = auditRow.details;
    if (ticket.status !== 'PENDING') {
      return NextResponse.json({ error: `Ticket already ${ticket.status}. Cannot re-reject.` }, { status: 400 });
    }

    // 2. Mark ticket as REJECTED (live database remains untouched)
    const nowIso = new Date().toISOString();
    const managerEmail = session.user?.email || session.profile?.email || 'manager@branch';
    const managerName = session.user?.name || session.user?.user_metadata?.name || session.profile?.first_name || managerEmail.split('@')[0] || 'Manager';

    const updatedTicket: ChangeRequestTicket = {
      ...ticket,
      status: 'REJECTED',
      reviewed_by_user_id: session.user?.id,
      reviewed_by_name: managerName,
      reviewed_by_role: userRole,
      reviewed_at: nowIso,
      review_notes: reviewNotes,
      updated_at: nowIso
    };

    await adminSupabase
      .from('audit_logs')
      .update({ details: updatedTicket })
      .eq('id', id);

    return NextResponse.json({
      success: true,
      message: `Ticket ${ticket.ticket_no} marked as REJECTED.`,
      ticket: updatedTicket
    });
  } catch (err: any) {
    console.error('Error rejecting change request:', err);
    return NextResponse.json({ error: err.message || 'Failed to reject change request' }, { status: 500 });
  }
}
