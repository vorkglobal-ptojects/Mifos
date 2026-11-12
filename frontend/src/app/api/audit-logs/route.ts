import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';
import { normalizeBranchId } from '@/lib/branch-mapping';
import { getSriLankaDate } from '@/lib/date-utils';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    const { searchParams } = new URL(request.url);
    const requestedBranch = searchParams.get('branchId');
    const filterAction = searchParams.get('action');
    const searchQuery = searchParams.get('search');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    let query = adminSupabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(250);

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Valid session token required to view audit logs.' }, { status: 401 });
    }

    const isHead = !session.branchId || normalizeBranchId(session.branchId) === 'HQ' || session.branchId.toUpperCase() === 'HEAD OFFICE';

    if (!isHead && session.role !== 'ADMIN') {
      // Branch user can only access audit logs for their assigned operating branch
      query = query.ilike('branch_id', `%${session.branchId}%`);
    } else {
      // Head Office / Admins can access across branches or filter by requestedBranch
      if (requestedBranch && requestedBranch !== 'ALL') {
        query = query.ilike('branch_id', `%${requestedBranch}%`);
      }
    }

    if (filterAction && filterAction !== 'ALL') {
      query = query.ilike('action', `%${filterAction}%`);
    }

    if (searchQuery) {
      const q = `%${searchQuery.trim()}%`;
      query = query.or(`user_email.ilike.${q},action.ilike.${q},resource.ilike.${q}`);
    }

    if (startDate) {
      query = query.gte('created_at', new Date(startDate).toISOString());
    }

    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      query = query.lte('created_at', end.toISOString());
    }

    const { data: logsData, error } = await query;
    const logs = logsData || [];

    if (error) {
      return NextResponse.json({ logs: [], stats: { total: 0, activeUsersToday: 0, financialActions: 0, criticalActions: 0 } });
    }

    // Calculate Summary Stats
    const todayStr = getSriLankaDate();
    const todayLogs = logs.filter(l => l.created_at && l.created_at.startsWith(todayStr));
    const activeUsersToday = new Set(todayLogs.map(l => l.user_email).filter(Boolean)).size;

    const financialActions = logs.filter(l => 
      l.action?.includes('PAWN') || 
      l.action?.includes('REDEEM') ||
      l.action?.includes('WITHDRAW') || 
      l.action?.includes('LEDGER') ||
      l.action?.includes('INTEREST') ||
      l.action?.includes('CAPITAL')
    ).length;

    const criticalActions = logs.filter(l => 
      l.action?.includes('DELETE') || 
      l.action?.includes('RESTORE') || 
      l.action?.includes('DISCOUNT') ||
      l.action?.includes('USER') ||
      l.action?.includes('ROLE')
    ).length;

    return NextResponse.json({
      logs,
      stats: {
        total: logs.length,
        activeUsersToday,
        financialActions,
        criticalActions
      }
    });
  } catch (error: any) {
    console.error('Audit Logs GET Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
    }
    const body = await request.json();

    const { action, resource, details, label_no, bill_no, branch_id } = body;
    const requestedAction = String(action || 'PRINT_PAWN_LABEL').toUpperCase();
    const PROTECTED_WORKFLOW_ACTIONS = new Set([
      'CHANGE_REQUEST',
      'AUDITOR_APPROVED',
      'MANAGER_APPROVED',
      'AUDIT_ISSUE_RAISED',
      'MANAGER_REJECTED'
    ]);
    if (PROTECTED_WORKFLOW_ACTIONS.has(requestedAction)) {
      return NextResponse.json({ error: 'Forbidden. Workflow audit events cannot be forged via /api/audit-logs.' }, { status: 403 });
    }

    const userEmail = session.user?.email || 'system';
    const role = session.role || 'TELLER';
    const branchId = (session.role === 'ADMIN' || session.branchId === 'HQ') ? (branch_id || session.branchId || 'HQ') : session.branchId;

    const payloadDetails = {
      ...(details || {}),
      label_no: label_no || body.labelNo || null,
      bill_no: bill_no || body.billNo || resource || null,
      printed_by: userEmail,
      printed_at: new Date().toISOString()
    };

    await adminSupabase.from('audit_logs').insert([{
      user_id: session?.user?.id || null,
      user_email: userEmail,
      role,
      branch_id: branchId,
      action: action || 'PRINT_PAWN_LABEL',
      resource: resource || bill_no || label_no || 'LABEL',
      details: payloadDetails,
      created_at: new Date().toISOString()
    }]);

    return NextResponse.json({ success: true, message: 'Audit log recorded successfully' });
  } catch (error: any) {
    console.error('Audit Logs POST Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
