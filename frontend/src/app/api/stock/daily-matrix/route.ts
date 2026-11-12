import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';
import { normalizeBranchId } from '@/lib/branch-mapping';
import { buildInventoryCacheKey, getInventoryCache, setInventoryCache } from '@/lib/redis';
import { getSriLankaDate } from '@/lib/date-utils';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const session = await getAuthenticatedUser(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
    }
    const { searchParams } = new URL(req.url);
    const dateParam = searchParams.get('date') || getSriLankaDate();
    const branchParam = searchParams.get('branch') || '';

    const isHead = !session?.branchId || normalizeBranchId(session.branchId) === 'HQ' || session.branchId.toUpperCase() === 'HEAD OFFICE';
    let effectiveBranch = branchParam;
    if (session && !isHead && session.role !== 'ADMIN' && session.role !== 'AUDITOR') {
      effectiveBranch = session.branchId;
    }

    const canonicalBranch = (effectiveBranch || 'ALL').trim().toUpperCase();
    const cacheKey = buildInventoryCacheKey(canonicalBranch, dateParam);

    // 0. Check Redis Cache First
    const cachedData = await getInventoryCache(cacheKey);
    if (cachedData) {
      return NextResponse.json(cachedData, {
        headers: {
          'X-Cache': 'HIT',
          'X-Cache-Key': cacheKey,
        },
      });
    }

    if (!adminSupabase) {
      return NextResponse.json({ error: 'Supabase client not initialized' }, { status: 500 });
    }

    // 1. Fetch Interest Entries from stock_interests
    let interestItems: any[] = [];
    try {
      let interestQuery = adminSupabase.from('stock_interests').select('*').eq('date', dateParam);
      if (effectiveBranch && effectiveBranch.toUpperCase() !== 'ALL') {
        interestQuery = interestQuery.ilike('branch', effectiveBranch);
      }
      const { data, error } = await interestQuery;
      if (!error && data && data.length > 0) {
        interestItems = data;
      }
    } catch (e) {}

    // Cloud Fallback: If stock_interests is missing or empty, fetch from audit_logs
    if (interestItems.length === 0) {
      try {
        let auditQuery = adminSupabase
          .from('audit_logs')
          .select('details')
          .eq('action', 'RECORD_STOCK_INTEREST');
        if (effectiveBranch && effectiveBranch.toUpperCase() !== 'ALL') {
          auditQuery = auditQuery.ilike('branch_id', effectiveBranch);
        }
        const { data: auditData } = await auditQuery;
        if (auditData && Array.isArray(auditData)) {
          interestItems = auditData
            .map((a: any) => a.details)
            .filter((d: any) => d && (!dateParam || d.date === dateParam));
        }
      } catch (e) {}
    }

    // 2. Fetch Daily Ledger Transactions for F/S and R
    // Egress Optimization: Filter at database level instead of pulling all 2,600+ historical transactions into memory
    let ledgersQuery = adminSupabase.from('daily_ledgers').select('id, ledger_date, branch_id');
    if (dateParam) {
      ledgersQuery = ledgersQuery.eq('ledger_date', dateParam);
    }
    if (effectiveBranch && effectiveBranch.toUpperCase() !== 'ALL') {
      ledgersQuery = ledgersQuery.ilike('branch_id', effectiveBranch);
    }
    const { data: matchingLedgers } = await ledgersQuery;

    let rawLedgerTxs: any[] = [];
    if (matchingLedgers && matchingLedgers.length > 0) {
      const ledgerIds = matchingLedgers.map((l: any) => l.id);
      const ledgerMap = new Map(matchingLedgers.map((l: any) => [l.id, l]));

      const { data: txs } = await adminSupabase
        .from('daily_ledger_transactions')
        .select('*')
        .in('ledger_id', ledgerIds)
        .order('created_at', { ascending: false });

      if (txs && Array.isArray(txs)) {
        rawLedgerTxs = txs.map((tx: any) => ({
          ...tx,
          daily_ledgers: ledgerMap.get(tx.ledger_id) || null
        }));
      }
    } else if (dateParam) {
      // Fallback: check if transactions were created on that date directly
      const { data: directTxs } = await adminSupabase
        .from('daily_ledger_transactions')
        .select('*, daily_ledgers(ledger_date, branch_id)')
        .gte('created_at', `${dateParam}T00:00:00`)
        .lte('created_at', `${dateParam}T23:59:59.999Z`)
        .order('created_at', { ascending: false });
      if (directTxs && Array.isArray(directTxs)) {
        rawLedgerTxs = directTxs;
      }
    }

    const fsItems: any[] = [];
    const receiptItems: any[] = [];

    if (rawLedgerTxs && Array.isArray(rawLedgerTxs)) {
      rawLedgerTxs.forEach((tx: any) => {
        const txDate = tx.daily_ledgers?.ledger_date || tx.created_at?.split('T')[0];
        const txBranch = tx.daily_ledgers?.branch_id || tx.branch_id || '';

        const dateMatch = !dateParam || txDate === dateParam;
        const branchMatch = !branchParam || branchParam.toUpperCase() === 'ALL' || txBranch.toUpperCase() === branchParam.toUpperCase();

        if (dateMatch && branchMatch) {
          // F / S charges
          if (tx.fs_type === 'F' || tx.fs_type === 'S' || Number(tx.insurance_rs) > 0) {
            fsItems.push({
              id: tx.id,
              bill_no: tx.bill_no || tx.redeem_no || 'N/A',
              date: txDate,
              fs_type: tx.fs_type || 'F',
              amount: Number(tx.insurance_rs) || Number(tx.amount) || 0,
              branch: txBranch || 'DMT',
              remarks: tx.remarks || 'Form/Stamp Fee',
              category: 'FS'
            });
          }

          // R (Receipts / Redemptions)
          if (tx.type_ir === 'R' || tx.transaction_type === 'REDEEM' || Number(tx.cash_received) > 0) {
            receiptItems.push({
              id: tx.id,
              bill_no: tx.bill_no || tx.redeem_no || 'N/A',
              date: txDate,
              amount: Number(tx.cash_received) || Number(tx.amount) || 0,
              branch: txBranch || 'DMT',
              remarks: tx.remarks || 'Pawn Redemption Receipt',
              category: 'RECEIPT'
            });
          }
        }
      });
    }

    // 3. Fetch Stock Items (Loans & Redeems) - Paginated to prevent 1000 row truncation
    const allStock: any[] = [];
    let page = 0;
    const pageSize = 1000;
    while (true) {
      const from = page * pageSize;
      const to = from + pageSize - 1;
      let stockQuery = adminSupabase
        .from('stock_items')
        .select('*')
        .range(from, to);

      if (branchParam && branchParam.toUpperCase() !== 'ALL') {
        stockQuery = stockQuery.ilike('branch_id', branchParam);
      }

      const { data: pageData, error: stockErr } = await stockQuery;
      if (stockErr || !pageData || pageData.length === 0) break;
      allStock.push(...pageData);
      if (pageData.length < pageSize) break;
      page++;
    }

    const loanItems: any[] = [];
    const redeemItems: any[] = [];

    if (Array.isArray(allStock)) {
      allStock.forEach((s: any) => {
        const itemPawnDate = (s.date || '').substring(0, 10);
        const itemCreatedDate = (s.created_at || '').substring(0, 10);
        const itemWithdrawDate = (s.withdrawal_date || '').substring(0, 10);

        // Primary loan date is s.date if present, else fallback to s.created_at
        const effectiveLoanDate = (s.date && String(s.date).trim() !== '')
          ? s.date.substring(0, 10)
          : (itemCreatedDate || '');

        // An item is a Loan Issued on dateParam ONLY if its effective loan date strictly equals dateParam
        if (effectiveLoanDate === dateParam) {
          loanItems.push({
            id: s.id,
            bill_no: s.bill_no,
            date: effectiveLoanDate,
            amount: Number(s.disbursed_amount) || Number(s.price) || 0,
            weight: Number(s.weight) || 0,
            item_type: s.item_type || 'GOLD',
            branch: s.branch_id || 'DMT',
            category: 'LOAN'
          });
        }

        // An item is a Redeemed Stock on dateParam if it was withdrawn on dateParam
        if (itemWithdrawDate === dateParam && (s.status === 'Withdrawn' || s.status === 'Redeemed' || s.status === 'CLOSED' || !!s.withdrawal_reason)) {
          redeemItems.push({
            id: s.id,
            bill_no: s.bill_no,
            date: itemWithdrawDate,
            amount: Number(s.redeem_amount) || Number(s.disbursed_amount) || Number(s.price) || 0,
            weight: Number(s.weight) || 0,
            reason: s.withdrawal_reason || 'Pawn Redeemed',
            branch: s.branch_id || 'DMT',
            category: 'REDEEM'
          });
        }
      });
    }

    const formattedInterests = (interestItems || []).map((i: any) => ({
      id: i.id,
      bill_no: i.bill_no,
      date: i.date,
      amount: Number(i.interest_value) || 0,
      branch: i.branch,
      notes: i.notes || '',
      category: 'INTEREST'
    }));

    // Calculate totals
    const totalFs = fsItems.reduce((acc: number, x: any) => acc + x.amount, 0);
    const totalInterest = formattedInterests.reduce((acc: number, x: any) => acc + x.amount, 0);
    const totalReceipts = receiptItems.reduce((acc: number, x: any) => acc + x.amount, 0);
    const totalLoans = loanItems.reduce((acc: number, x: any) => acc + x.amount, 0);
    const totalRedeems = redeemItems.reduce((acc: number, x: any) => acc + x.amount, 0);

    const responsePayload = {
      date: dateParam,
      branch: branchParam || 'ALL',
      summary: {
        total_fs: totalFs,
        total_interest: totalInterest,
        total_receipts: totalReceipts,
        total_loans: totalLoans,
        total_redeems: totalRedeems,
        item_count: fsItems.length + formattedInterests.length + receiptItems.length + loanItems.length + redeemItems.length
      },
      data: {
        fs_items: fsItems,
        interest_items: formattedInterests,
        receipt_items: receiptItems,
        loan_items: loanItems,
        redeem_items: redeemItems
      }
    };

    // Store in Redis with TTL (non-blocking, failure resilient)
    await setInventoryCache(cacheKey, responsePayload);

    return NextResponse.json(responsePayload, {
      headers: {
        'X-Cache': 'MISS',
        'X-Cache-Key': cacheKey,
      },
    });

  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
