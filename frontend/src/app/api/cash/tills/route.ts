import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';
import { recordAuditLog } from '@/lib/audit-logger';
import { normalizeBranchId } from '@/lib/branch-mapping';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const rawBranchId = searchParams.get('branchId');
    const branchId = session.role === 'TELLER'
      ? normalizeBranchId(session.trustedBranchId)
      : (rawBranchId && rawBranchId !== 'ALL' ? normalizeBranchId(rawBranchId) : 'ALL');

    let query = adminSupabase.from('cash_tills').select('*, till_sessions(*)');
    if (branchId !== 'ALL') {
      query = query.eq('branch_id', branchId);
    }

    const { data: tills, error } = await query.order('created_at', { ascending: true });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const formatted = (tills || []).map((t: any) => {
      const activeSession = (t.till_sessions || []).find((s: any) => s.status === 'OPEN') || null;
      return {
        id: t.id,
        branchId: t.branch_id,
        tillName: t.till_name,
        assignedRole: t.assigned_role,
        isActive: t.is_active,
        activeSession: activeSession ? {
          id: activeSession.id,
          userId: activeSession.user_id,
          sessionDate: activeSession.session_date,
          openedAt: activeSession.opened_at,
          openingCash: Number(activeSession.opening_cash || 0),
          systemExpectedCash: Number(activeSession.system_expected_cash || 0),
          actualCountedCash: activeSession.actual_counted_cash !== null ? Number(activeSession.actual_counted_cash) : null,
          varianceAmount: Number(activeSession.variance_amount || 0),
          status: activeSession.status
        } : null
      };
    });

    return NextResponse.json(formatted);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session || (session.role !== 'ADMIN' && session.role !== 'MANAGER')) {
      return NextResponse.json({ error: 'Forbidden. Admin or Manager role required to create tills.' }, { status: 403 });
    }

    const { branchId, tillName, assignedRole = 'TELLER' } = await request.json();

    if (!branchId || !tillName?.trim()) {
      return NextResponse.json({ error: 'Branch ID and till name are required.' }, { status: 400 });
    }

    const { data, error } = await adminSupabase
      .from('cash_tills')
      .insert([{
        branch_id: branchId.trim().toUpperCase(),
        till_name: tillName.trim(),
        assigned_role: assignedRole.toUpperCase(),
        is_active: true
      }])
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await recordAuditLog(session, {
      action: 'CASH_TILL_CREATED',
      resource: `Till #${data.id}`,
      branchId: branchId,
      details: { tillName, assignedRole }
    });

    return NextResponse.json({ success: true, till: data }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
