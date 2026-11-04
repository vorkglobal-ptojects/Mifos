import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';
import { applyApprovedChange, ChangeRequestTicket } from '@/lib/change-requests';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: any) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userRole = (session.role || '').toUpperCase();
    if (userRole !== 'ADMIN' && userRole !== 'MANAGER') {
      return NextResponse.json({ error: 'Forbidden. Only Managers and Admins can approve change request tickets.' }, { status: 403 });
    }

    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const reviewNotes = (body.notes || body.reviewNotes || 'Approved by Manager').trim();

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
      return NextResponse.json({ error: `Ticket already ${ticket.status}. Cannot re-approve.` }, { status: 400 });
    }

    // 2. Apply change atomically to live database
    const managerEmail = session.user?.email || session.profile?.email || 'manager@branch';
    const managerName = session.user?.name || session.user?.user_metadata?.name || session.profile?.first_name || managerEmail.split('@')[0] || 'Manager';

    await applyApprovedChange(ticket, {
      name: managerName,
      email: managerEmail
    });

    // 3. Mark ticket as APPROVED
    const nowIso = new Date().toISOString();
    const updatedTicket: ChangeRequestTicket = {
      ...ticket,
      status: 'APPROVED',
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
      message: `Ticket ${ticket.ticket_no} approved and changes applied successfully.`,
      ticket: updatedTicket
    });
  } catch (err: any) {
    console.error('Error approving change request:', err);
    return NextResponse.json({ error: err.message || 'Failed to approve change request' }, { status: 500 });
  }
}
