import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';
import { generateTicketNo, executeChangeTicketAction, ChangeRequestTicket } from '@/lib/change-requests';
import { normalizeBranchId } from '@/lib/branch-mapping';

export const dynamic = 'force-dynamic';

async function processTicketDecision(
  session: any,
  ticketId: string,
  decision: 'APPROVE' | 'REJECT' | 'UPDATE_PROPOSED',
  rawNotes?: string,
  proposedData?: Record<string, any>
) {
  const result = await executeChangeTicketAction(session, ticketId, decision, {
    notes: rawNotes,
    proposedData
  });
  return NextResponse.json(result.body, { status: result.status });
}

export async function GET(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);

    // Fallback action handler via GET query params in case POST/PATCH is blocked by client proxy/network
    const actionParam = (searchParams.get('action') || '').toUpperCase();
    const ticketIdParam = searchParams.get('id') || '';
    if ((actionParam === 'APPROVE' || actionParam === 'REJECT' || actionParam === 'UPDATE_PROPOSED') && ticketIdParam) {
      const notesParam = searchParams.get('notes') || '';
      const rawProposed = searchParams.get('proposed_data');
      let parsedProposed: Record<string, any> | undefined;
      if (rawProposed) {
        try { parsedProposed = JSON.parse(rawProposed); } catch { /* ignore malformed fallback */ }
      }
      return await processTicketDecision(
        session,
        ticketIdParam,
        actionParam as 'APPROVE' | 'REJECT' | 'UPDATE_PROPOSED',
        notesParam,
        parsedProposed
      );
    }

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

    let tickets: ChangeRequestTicket[] = (logs || [])
      .map((l: any) => ({
        ...l.details,
        id: l.id,
        branch_id: l.branch_id || l.details?.branch_id,
        created_at: l.created_at || l.details?.created_at
      }))
      .filter((t: ChangeRequestTicket) => {
        const ref = t.reference_no || '';
        const rsn = t.reason || '';
        return (
          !ref.startsWith('CR-TEST') &&
          t.entity_id !== '00000000-0000-0000-0000-000000000003' &&
          !rsn.startsWith('Automated live account verification for ')
        );
      });

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

export async function PATCH(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const ticketId = body.id || body.ticket_id;
    const action = (body.action || '').toUpperCase();
    const notes = body.notes || body.reason || '';
    const proposedData = body.proposed_data || body.proposedData;

    if (!ticketId || !['APPROVE', 'REJECT', 'UPDATE_PROPOSED'].includes(action)) {
      return NextResponse.json(
        { error: 'Valid ticket id and action (APPROVE, REJECT, or UPDATE_PROPOSED) are required' },
        { status: 400 }
      );
    }

    return await processTicketDecision(
      session,
      ticketId,
      action as 'APPROVE' | 'REJECT' | 'UPDATE_PROPOSED',
      notes,
      proposedData
    );
  } catch (err: any) {
    console.error('Error in PATCH /api/change-requests:', err);
    return NextResponse.json({ error: err.message || 'Failed to process change request decision' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();

    // Allow POST decision/edit payload on main endpoint
    const decisionAction = (body.action || '').toUpperCase();
    const decisionId = body.id || body.ticket_id;
    if (['APPROVE', 'REJECT', 'UPDATE_PROPOSED'].includes(decisionAction) && decisionId) {
      return await processTicketDecision(
        session,
        decisionId,
        decisionAction as 'APPROVE' | 'REJECT' | 'UPDATE_PROPOSED',
        body.notes || body.reason || '',
        body.proposed_data || body.proposedData
      );
    }

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
