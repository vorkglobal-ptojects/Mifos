import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';
import { generateTicketNo, ChangeRequestTicket } from '@/lib/change-requests';
import { normalizeBranchId } from '@/lib/branch-mapping';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const branchParam = searchParams.get('branch');
    const statusParam = searchParams.get('status') || 'ALL';
    const entityParam = searchParams.get('entity') || 'ALL';

    let query = adminSupabase
      .from('audit_logs')
      .select('*')
      .eq('action', 'CHANGE_REQUEST')
      .order('created_at', { ascending: false });

    // Branch filter: Tellers can only view their assigned branch, Managers/Admins can filter or view ALL
    const userRole = (session.role || 'TELLER').toUpperCase();
    if (userRole === 'TELLER') {
      const userBranch = normalizeBranchId(session.branchId || 'HQ');
      query = query.eq('branch_id', userBranch);
    } else if (branchParam && branchParam !== 'ALL') {
      query = query.eq('branch_id', normalizeBranchId(branchParam));
    }

    const { data: logs, error } = await query;
    if (error) throw error;

    let tickets: ChangeRequestTicket[] = (logs || []).map((l: any) => ({
      id: l.id,
      ...l.details,
      branch_id: l.branch_id || l.details?.branch_id,
      created_at: l.created_at || l.details?.created_at
    }));

    if (statusParam !== 'ALL') {
      tickets = tickets.filter(t => t.status === statusParam);
    }

    if (entityParam !== 'ALL') {
      tickets = tickets.filter(t => t.entity_type === entityParam);
    }

    return NextResponse.json({
      success: true,
      count: tickets.length,
      tickets
    });
  } catch (err: any) {
    console.error('Error in GET /api/change-requests:', err);
    return NextResponse.json({ error: err.message || 'Failed to fetch change requests' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      entity_type,
      action_type,
      entity_id,
      reference_no,
      branch_id,
      reason,
      current_data,
      proposed_data
    } = body;

    if (!entity_type || !action_type || !entity_id || !reason?.trim()) {
      return NextResponse.json({
        error: 'Missing required fields: entity_type, action_type, entity_id, and a mandatory reason are required.'
      }, { status: 400 });
    }

    const targetBranch = normalizeBranchId(branch_id || session.branchId || 'HQ');
    const ticketNo = generateTicketNo(targetBranch, entity_type);
    const nowIso = new Date().toISOString();

    const ticketPayload: ChangeRequestTicket = {
      id: crypto.randomUUID(),
      ticket_no: ticketNo,
      entity_type,
      action_type,
      entity_id,
      reference_no: reference_no || 'N/A',
      branch_id: targetBranch,
      requested_by_user_id: session.user?.id,
      requested_by_name: session.user?.name || session.user?.user_metadata?.name || session.profile?.first_name || (session.user?.email || '').split('@')[0] || 'Teller',
      requested_by_email: session.user?.email || session.profile?.email || 'teller@branch',
      requested_by_role: session.role || 'TELLER',
      reason: reason.trim(),
      current_data: current_data || {},
      proposed_data: proposed_data || {},
      status: 'PENDING',
      created_at: nowIso
    };

    const auditRow = {
      id: ticketPayload.id,
      user_id: ticketPayload.requested_by_user_id || null,
      user_email: ticketPayload.requested_by_email,
      role: ticketPayload.requested_by_role,
      branch_id: targetBranch,
      action: 'CHANGE_REQUEST',
      resource: ticketNo,
      details: ticketPayload,
      created_at: nowIso
    };

    const { data, error } = await adminSupabase
      .from('audit_logs')
      .insert([auditRow])
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({
      success: true,
      message: `Change request ticket ${ticketNo} successfully submitted for Manager/Admin review.`,
      ticket: ticketPayload
    }, { status: 201 });
  } catch (err: any) {
    console.error('Error in POST /api/change-requests:', err);
    return NextResponse.json({ error: err.message || 'Failed to submit change request' }, { status: 500 });
  }
}
