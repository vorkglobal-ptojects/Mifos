import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const year = searchParams.get('year') || new Date().getFullYear().toString();
    const month = searchParams.get('month'); // optional YYYY-MM

    // 1. Fetch active branches
    const { data: branches, error: bErr } = await adminSupabase
      .from('branches')
      .select('id, name')
      .order('id', { ascending: true });

    if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 });

    // 2. Fetch all daily ledgers for the given year/month
    let query = adminSupabase.from('daily_ledgers').select('id, branch_id, ledger_date, closing_balance, variance, status, is_flag_ignored');

    if (month) {
      const startDate = `${month}-01`;
      const endDate = `${month}-31`;
      query = query.gte('ledger_date', startDate).lte('ledger_date', endDate);
    } else {
      const startDate = `${year}-01-01`;
      const endDate = `${year}-12-31`;
      query = query.gte('ledger_date', startDate).lte('ledger_date', endDate);
    }

    const { data: ledgers, error: lErr } = await query;
    if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 });

    // 3. Build Matrix aggregated by Branch and Month
    const matrix: Record<string, any> = {};

    (branches || []).forEach((b) => {
      matrix[b.id] = {
        branch_id: b.id,
        branch_name: b.name,
        months: {},
        total_entered: 0,
        total_flagged: 0
      };
      for (let m = 1; m <= 12; m++) {
        const mKey = `${year}-${String(m).padStart(2, '0')}`;
        matrix[b.id].months[mKey] = {
          month: mKey,
          entered_count: 0,
          flagged_count: 0,
          days: []
        };
      }
    });

    (ledgers || []).forEach((l) => {
      if (matrix[l.branch_id]) {
        const mKey = l.ledger_date.substring(0, 7);
        if (matrix[l.branch_id].months[mKey]) {
          matrix[l.branch_id].months[mKey].entered_count++;
          const isFlagged = l.status === 'FLAGGED' || Math.abs(Number(l.variance || 0)) > 0.01;
          if (isFlagged && !l.is_flag_ignored) {
            matrix[l.branch_id].months[mKey].flagged_count++;
            matrix[l.branch_id].total_flagged++;
          }
          matrix[l.branch_id].months[mKey].days.push(l.ledger_date);
          matrix[l.branch_id].total_entered++;
        }
      }
    });

    return NextResponse.json({
      year,
      branches: branches || [],
      matrix
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
