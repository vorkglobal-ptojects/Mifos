import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';
import { normalizeBranchId, CANONICAL_BRANCHES } from '@/lib/branch-mapping';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const rawBranchParam = searchParams.get('branch');
    const branchFilter = session.role === 'TELLER'
      ? normalizeBranchId(session.trustedBranchId)
      : (rawBranchParam && rawBranchParam !== 'ALL' ? normalizeBranchId(rawBranchParam) : 'ALL');

    // 1. Fetch Latest Branch Cash Positions from daily_ledgers
    let ledgersQuery = adminSupabase
      .from('daily_ledgers')
      .select('branch_id, ledger_date, closing_balance, actual_cash_count, variance, status, updated_at')
      .order('ledger_date', { ascending: false })
      .limit(100);

    if (branchFilter !== 'ALL') {
      ledgersQuery = ledgersQuery.eq('branch_id', branchFilter);
    }

    const { data: latestLedgers } = await ledgersQuery;

    // Map each canonical branch to its latest reported closing balance
    const branchCashMap: Record<string, { closing: number; date: string; status: string }> = {};
    (latestLedgers || []).forEach((l: any) => {
      const bId = normalizeBranchId(l.branch_id);
      if (!branchCashMap[bId]) {
        branchCashMap[bId] = {
          closing: Number(l.closing_balance || 0),
          date: l.ledger_date,
          status: l.status || 'APPROVED'
        };
      }
    });

    const branchCashList = CANONICAL_BRANCHES
      .filter(b => b.id !== 'TEST')
      .map(b => ({
        branchId: b.id,
        branchName: b.name,
        latestClosingCash: branchCashMap[b.id]?.closing || 0,
        lastReportedDate: branchCashMap[b.id]?.date || null,
        status: branchCashMap[b.id]?.status || 'NO_ENTRY'
      }));

    const totalBranchCash = branchCashList.reduce((sum, b) => sum + b.latestClosingCash, 0);

    // 2. Fetch Bank Accounts (graceful fallback if table does not exist yet)
    let bankAccounts: any[] = [];
    let totalBankBalance = 0;
    try {
      const { data: banks, error: bankErr } = await adminSupabase
        .from('bank_accounts')
        .select('*')
        .eq('is_active', true)
        .order('bank_name', { ascending: true });

      if (!bankErr && banks) {
        bankAccounts = banks.map((b: any) => ({
          id: b.id,
          bankName: b.bank_name,
          accountName: b.account_name,
          maskedAccountNumber: b.account_number ? `${b.account_number.slice(0, 4)}****${b.account_number.slice(-3)}` : '****',
          branchId: b.branch_id,
          currentBalance: Number(b.current_balance || 0),
          lastReconciledAt: b.last_reconciled_at,
          currency: b.currency || 'LKR'
        }));
        totalBankBalance = bankAccounts.reduce((sum, b) => sum + b.currentBalance, 0);
      }
    } catch {
      // Table may be pending migration
    }

    // 3. Fetch Active Tills & Open Sessions
    let activeTillCount = 0;
    let totalTillCash = 0;
    try {
      const { data: openSessions } = await adminSupabase
        .from('till_sessions')
        .select('*, cash_tills(till_name)')
        .eq('status', 'OPEN');

      if (openSessions) {
        activeTillCount = openSessions.length;
        totalTillCash = openSessions.reduce((sum: number, s: any) => sum + Number(s.actual_counted_cash || s.opening_cash || 0), 0);
      }
    } catch {}

    // 4. Fetch In-Transit & Pending Transfers
    let inTransitAmount = 0;
    let inTransitCount = 0;
    let pendingRequestsCount = 0;
    let discrepancyCount = 0;

    try {
      const { data: transfers } = await adminSupabase
        .from('cash_transfers')
        .select('amount, status');

      if (transfers) {
        inTransitAmount = transfers
          .filter((t: any) => t.status === 'DISPATCHED' || t.status === 'IN_TRANSIT')
          .reduce((sum: number, t: any) => sum + Number(t.amount || 0), 0);
        inTransitCount = transfers.filter((t: any) => t.status === 'DISPATCHED' || t.status === 'IN_TRANSIT').length;
        discrepancyCount = transfers.filter((t: any) => t.status === 'DISCREPANCY_FLAGGED').length;
      }

      const { count: reqCount } = await adminSupabase
        .from('cash_requests')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'SUBMITTED');

      pendingRequestsCount = reqCount || 0;
    } catch {}

    // 5. Recent Cash Audit Activity
    let recentAudits: any[] = [];
    try {
      const { data: logs } = await adminSupabase
        .from('audit_logs')
        .select('*')
        .in('action', ['CASH_REQUEST_SUBMITTED', 'CASH_REQUEST_APPROVED', 'CASH_DISPATCHED', 'CASH_RECEIVED', 'CASH_TRANSFER_DISCREPANCY', 'TILL_SESSION_OPENED', 'TILL_SESSION_CLOSED'])
        .order('created_at', { ascending: false })
        .limit(10);
      recentAudits = logs || [];
    } catch {}

    return NextResponse.json({
      summary: {
        totalBranchCash,
        totalBankBalance,
        totalTillCash,
        inTransitAmount,
        inTransitCount,
        pendingRequestsCount,
        discrepancyCount,
        activeTillCount,
        grandTotalLiquid: totalBranchCash + totalBankBalance + inTransitAmount
      },
      branchCashList,
      bankAccounts,
      recentAudits,
      userRole: session.role,
      userBranch: session.trustedBranchId
    });
  } catch (err: any) {
    console.error('Cash dashboard API error:', err);
    return NextResponse.json({ error: err.message || 'Failed to load cash dashboard' }, { status: 500 });
  }
}
