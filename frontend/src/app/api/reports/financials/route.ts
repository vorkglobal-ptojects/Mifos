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
    const requestedBranch = searchParams.get('branchId') || 'ALL';

    let effectiveBranch = requestedBranch;
    if (session && session.role === 'TELLER') {
      effectiveBranch = session.branchId;
    }

    // 1. Compute Trial Balance from journal_entry_line
    const { data: lines } = await adminSupabase.from('journal_entry_line').select('*').limit(5000);

    const trialBalanceMap: Record<string, { debit: number, credit: number }> = {
      'Vault Cash (Asset)': { debit: 0, credit: 0 },
      'Pawn Loan Portfolio (Asset)': { debit: 0, credit: 0 },
      'Interest & Fee Income (Revenue)': { debit: 0, credit: 0 },
      'Operating Expenses (Expense)': { debit: 0, credit: 0 }
    };

    (lines || []).forEach(l => {
      const acc = l.account_name || 'Other';
      if (!trialBalanceMap[acc]) {
        trialBalanceMap[acc] = { debit: 0, credit: 0 };
      }
      trialBalanceMap[acc].debit += Number(l.debit || 0);
      trialBalanceMap[acc].credit += Number(l.credit || 0);
    });

    const trialBalance = Object.entries(trialBalanceMap).map(([accountName, vals]) => ({
      accountName,
      debit: vals.debit,
      credit: vals.credit,
      netBalance: vals.debit - vals.credit
    }));

    // 2. Compute Profit & Loss Statement from pawns, redeem transactions, & daily_ledgers
    let pawnsQuery = adminSupabase.from('pawns').select('disbursed_amount, redeem_amount, redeem_interest, status, branch_id');
    if (effectiveBranch !== 'ALL') {
      pawnsQuery = pawnsQuery.eq('branch_id', effectiveBranch);
    }
    const { data: pawns } = await pawnsQuery;

    let ledgersQuery = adminSupabase.from('daily_ledgers').select('expenses_total, branch_id');
    if (effectiveBranch !== 'ALL') {
      ledgersQuery = ledgersQuery.eq('branch_id', effectiveBranch);
    }
    const { data: ledgers } = await ledgersQuery;

    const interestIncome = (pawns || [])
      .filter(p => p.status === 'REDEEMED')
      .reduce((sum, p) => sum + Number(p.redeem_interest || 0), 0);

    const activePortfolio = (pawns || [])
      .filter(p => p.status === 'ACTIVE')
      .reduce((sum, p) => sum + Number(p.disbursed_amount || 0), 0);

    const totalExpenses = (ledgers || []).reduce((sum, l) => sum + Number(l.expenses_total || 0), 0);
    const netProfit = interestIncome - totalExpenses;

    return NextResponse.json({
      trialBalance,
      profitLoss: {
        interestIncome,
        otherIncome: 0,
        totalRevenue: interestIncome,
        operatingExpenses: totalExpenses,
        netProfit,
        activePortfolio
      },
      branchId: effectiveBranch
    });
  } catch (error: any) {
    console.error('Financial Reports API Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
