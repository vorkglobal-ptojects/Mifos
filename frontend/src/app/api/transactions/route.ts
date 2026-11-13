import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';
import { getBranchSearchTerms, normalizeBranchId } from '@/lib/branch-mapping';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const requestedViewMode = (searchParams.get('viewMode') || 'GLOBAL').toUpperCase();
    const requestedBranchId = searchParams.get('branchId') || 'ALL';
    const dateParam = searchParams.get('date'); // optional YYYY-MM-DD

    const userBranch = session.trustedBranchId || session.branchId;
    const isHead =
      !userBranch ||
      normalizeBranchId(userBranch) === 'HQ' ||
      userBranch.toUpperCase() === 'HEAD OFFICE';
    const effectiveViewMode = session.role === 'ADMIN' || isHead ? requestedViewMode : 'LOCAL';

    let query = adminSupabase
      .from('transaction')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(1000);

    if (effectiveViewMode === 'LOCAL' && userBranch && !isHead) {
      const terms = getBranchSearchTerms(userBranch);
      const orClause = terms.map((t) => `branch_id.eq.${t},target_branch_id.eq.${t}`).join(',');
      query = query.or(orClause);
    } else if (requestedBranchId && requestedBranchId !== 'ALL') {
      const terms = getBranchSearchTerms(requestedBranchId);
      const orClause = terms.map((t) => `branch_id.eq.${t},target_branch_id.eq.${t}`).join(',');
      query = query.or(orClause);
    }

    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      query = query
        .gte('timestamp', `${dateParam}T00:00:00+05:30`)
        .lte('timestamp', `${dateParam}T23:59:59.999+05:30`);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data || []);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to fetch transactions' }, { status: 500 });
  }
}

