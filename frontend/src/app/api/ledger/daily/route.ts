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
    const requestedBranch = searchParams.get('branch_id') || searchParams.get('branch');
    const date = searchParams.get('date');
    const month = searchParams.get('month'); // YYYY-MM

    const isHead = !session?.branchId || normalizeBranchId(session.branchId) === 'HQ' || session.branchId.toUpperCase() === 'HEAD OFFICE';
    let effectiveBranchId = requestedBranch;
    if (session && !isHead && session.role !== 'ADMIN') {
      effectiveBranchId = session.branchId;
    }

    if (date && effectiveBranchId) {
      const searchTerms = getBranchSearchTerms(effectiveBranchId);
      // Fetch specific single day ledger
      const { data: ledger, error: ledgerErr } = await adminSupabase
        .from('daily_ledgers')
        .select('*')
        .in('branch_id', searchTerms)
        .eq('ledger_date', date)
        .maybeSingle();

      if (ledgerErr) {
        return NextResponse.json({ error: ledgerErr.message }, { status: 500 });
      }

      let transactions = [];
      let expenses = [];

      if (ledger) {
        const [txRes, expRes] = await Promise.all([
          adminSupabase.from('daily_ledger_transactions').select('*').eq('ledger_id', ledger.id).order('created_at', { ascending: true }),
          adminSupabase.from('daily_ledger_expenses').select('*').eq('ledger_id', ledger.id).order('created_at', { ascending: true })
        ]);
        transactions = txRes.data || [];
        expenses = expRes.data || [];
      }

      const prevDate = new Date(date);
      prevDate.setDate(prevDate.getDate() - 1);

      const { data: prevLedger } = await adminSupabase
        .from('daily_ledgers')
        .select('closing_balance, cp_balance, ledger_date')
        .in('branch_id', searchTerms)
        .lt('ledger_date', date)
        .order('ledger_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      return NextResponse.json({
        ledger: ledger || null,
        transactions,
        expenses,
        previous_closing: prevLedger ? Number(prevLedger.closing_balance) : null,
        previous_capital: prevLedger ? Number(prevLedger.cp_balance) : null,
        previous_ledger_date: prevLedger ? prevLedger.ledger_date : null
      });
    }

    // Otherwise fetch list for branch / month
    let query = adminSupabase.from('daily_ledgers').select('*').order('ledger_date', { ascending: false });

    if (session && !isHead && session.role !== 'ADMIN') {
      query = query.in('branch_id', getBranchSearchTerms(session.branchId));
    } else if (effectiveBranchId && effectiveBranchId !== 'HQ' && effectiveBranchId !== 'ALL') {
      query = query.in('branch_id', getBranchSearchTerms(effectiveBranchId));
    }

    if (month) {
      const startDate = `${month}-01`;
      const endDate = `${month}-31`;
      query = query.gte('ledger_date', startDate).lte('ledger_date', endDate);
    }

    const { data: ledgers, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ledgers: ledgers || [] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
    }
    if (session.role === 'AUDITOR') {
      return NextResponse.json({ error: 'Forbidden. Auditors cannot modify daily ledgers.' }, { status: 403 });
    }
    const body = await request.json();
    let { branch_id, created_by = 'System User' } = body;
    const {
      ledger_date,
      cp_balance = 0,
      opening_capital = 0,
      opening_balance = 0,
      transfer_in = 0,
      transfer_in_type = '',
      transfer_out = 0,
      transfer_out_type = '',
      loan_issued_total = 0,
      redemption_total = 0,
      interest_rec_total = 0,
      recovery_total = 0,
      insurance_total = 0,
      expenses_total = 0,
      closing_balance = 0,
      actual_cash_count = null,
      staff_shift = '',
      status = 'APPROVED',
      transactions,
      expenses
    } = body;

    const isPostHead = !session.branchId || normalizeBranchId(session.branchId) === 'HQ' || session.branchId.toUpperCase() === 'HEAD OFFICE';
    if (!isPostHead && session.role !== 'ADMIN') {
      const requestedNorm = branch_id ? normalizeBranchId(branch_id) : normalizeBranchId(session.branchId);
      const sessionNorm = normalizeBranchId(session.branchId);
      if (requestedNorm && sessionNorm && requestedNorm !== sessionNorm) {
        return NextResponse.json(
          { error: `Forbidden. Your account (${sessionNorm}) cannot save a ledger for branch ${requestedNorm}.` },
          { status: 403 }
        );
      }
      branch_id = session.branchId;
    }
    if (session.user?.email) {
      created_by = session.user.email;
    }

    const canonicalBranchId = normalizeBranchId(branch_id);

    if (!canonicalBranchId || !ledger_date) {
      return NextResponse.json({ error: 'branch_id and ledger_date are required' }, { status: 400 });
    }

    // Protection: Tellers can create and update their own branch's daily ledgers unless explicitly LOCKED by Admin/Manager
    if (session && session.role === 'TELLER') {
      const isTellerHq = !session.branchId || normalizeBranchId(session.branchId) === 'HQ';
      if (!isTellerHq && normalizeBranchId(session.branchId) !== canonicalBranchId) {
        return NextResponse.json({
          error: 'Forbidden. You cannot modify a daily ledger belonging to another branch.'
        }, { status: 403 });
      }

      const { data: existingLedger } = await adminSupabase
        .from('daily_ledgers')
        .select('id, status, created_by')
        .eq('branch_id', canonicalBranchId)
        .eq('ledger_date', ledger_date)
        .maybeSingle();

      if (existingLedger && existingLedger.status === 'LOCKED') {
        return NextResponse.json({
          error: `Daily Ledger for ${ledger_date} has been locked by Management. Please submit a Ledger Correction Ticket for Manager approval.`
        }, { status: 403 });
      }
    }


    // --- CASH MATH ---
    const calcOpeningCash = Number(opening_balance) || 0;
    const calcTrIn = Number(transfer_in) || 0;
    const calcTrOut = Number(transfer_out) || 0;
    const calcLoans = Number(loan_issued_total) || 0;
    const calcRedeem = Number(redemption_total) || 0;
    const calcInterest = Number(interest_rec_total) || 0;
    const calcRecovery = Number(recovery_total) || 0;
    const calcInsurance = Number(insurance_total) || 0;
    const calcExpenses = Number(expenses_total) || 0;
    const userClosingCash = Number(closing_balance) || 0; // This is the Cash they entered

    const calculatedClosingCash = Number((
      calcOpeningCash + calcTrIn - calcTrOut - calcLoans + calcRedeem + calcInterest + calcRecovery + calcInsurance - calcExpenses
    ).toFixed(2));

    const cashMismatch = Math.abs(userClosingCash - calculatedClosingCash) > 0.01;
    const cashVariance = Number((userClosingCash - calculatedClosingCash).toFixed(2));

    // --- CAPITAL MATH ---
    const userOpeningCapital = Number(opening_capital) || 0; // New field from payload
    const rawCpBalance = (cp_balance !== '' && cp_balance !== null && cp_balance !== undefined) ? Number(cp_balance) : 0;
    let userClosingCapital = rawCpBalance;

    const calculatedClosingCapital = Number((
      userOpeningCapital + calcLoans - calcRedeem
    ).toFixed(2));

    // Only track capital mismatch if either Opening Capital or Closing CP was actually entered
    const isCapitalTracked = userOpeningCapital !== 0 || rawCpBalance !== 0;

    // If cp_balance was unprovided/empty or 0 (and Opening Capital is tracked), default to calculatedClosingCapital
    if (isCapitalTracked && (userClosingCapital === 0 || cp_balance === '' || cp_balance === null || cp_balance === undefined) && calculatedClosingCapital !== 0) {
      userClosingCapital = calculatedClosingCapital;
    }

    const capitalMismatch = isCapitalTracked && Math.abs(userClosingCapital - calculatedClosingCapital) > 0.01;
    const capitalVariance = isCapitalTracked ? Number((userClosingCapital - calculatedClosingCapital).toFixed(2)) : 0;

    // Determine status (Flag if EITHER is mismatched)
    const finalStatus = (cashMismatch || capitalMismatch) ? 'FLAGGED' : status;

    // Use variance field to store cash variance primarily, or capital variance if only capital is mismatched
    const storedVariance = cashMismatch ? cashVariance : (capitalMismatch ? capitalVariance : 0);

    // 2. Upsert Daily Ledger
    const ledgerPayload: Record<string, any> = {
      branch_id: canonicalBranchId,
      ledger_date,
      cp_balance: userClosingCapital,
      opening_capital: userOpeningCapital,
      opening_balance: calcOpeningCash,
      transfer_in: calcTrIn,
      transfer_out: calcTrOut,
      loan_issued_total: calcLoans,
      redemption_total: calcRedeem,
      interest_rec_total: calcInterest,
      recovery_total: calcRecovery,
      insurance_total: calcInsurance,
      expenses_total: calcExpenses,
      closing_balance: userClosingCash,
      actual_cash_count: userClosingCash, // Set actual cash to entered cash
      variance: storedVariance,
      staff_shift,
      status: finalStatus,
      created_by,
      updated_at: new Date().toISOString()
    };

    if (transfer_in_type !== undefined) ledgerPayload.transfer_in_type = transfer_in_type || null;
    if (transfer_out_type !== undefined) ledgerPayload.transfer_out_type = transfer_out_type || null;

    let { data: ledger, error: ledgerErr } = await adminSupabase
      .from('daily_ledgers')
      .upsert(ledgerPayload, { onConflict: 'branch_id,ledger_date' })
      .select('*')
      .single();

    // If database table does not contain recently added columns, retry without them
    if (ledgerErr && (ledgerErr.message?.includes('transfer_in_type') || ledgerErr.message?.includes('transfer_out_type') || ledgerErr.code === 'PGRST204')) {
      delete ledgerPayload.transfer_in_type;
      delete ledgerPayload.transfer_out_type;
      delete ledgerPayload.opening_capital;
      delete ledgerPayload.actual_cash_count;
      delete ledgerPayload.variance;

      const retryRes = await adminSupabase
        .from('daily_ledgers')
        .upsert(ledgerPayload, { onConflict: 'branch_id,ledger_date' })
        .select('*')
        .single();

      ledger = retryRes.data;
      ledgerErr = retryRes.error;
    }

    if (ledgerErr || !ledger) {
      return NextResponse.json({ error: ledgerErr?.message || 'Failed to save daily ledger.' }, { status: 500 });
    }

    const ledgerId = ledger.id;

    // 3. Clear and Re-insert Child Transactions (only if explicitly provided in payload)
    if (transactions !== undefined && Array.isArray(transactions)) {
      const txRows = transactions.map((t: any) => {
        const finalRemarks = t.remarks || '';
        return {
          ledger_id: ledgerId,
          transaction_type: t.transaction_type || 'LOAN_ISSUED',
          bill_no: t.loan_no || t.bill_no || '',
          amount: Number(t.cash_loan) || Number(t.amount) || 0,
          weight_g: Number(t.weight_g) || 0,
          weight_mg: Number(t.weight_mg) || 0,
          insurance_rs: Number(t.insurance_rs) || 0,
          item_code: t.item_code || '',
          interest_rs: Number(t.interest_rs) || 0,
          cash_received: Number(t.cash_received) || 0,
          fs_type: t.fs_type || '',
          redeem_no: t.redeem_no || '',
          type_ir: t.type_ir || '',
          quantity: t.quantity || '',
          remarks: finalRemarks
        };
      });

      const { error: delTxErr } = await adminSupabase.from('daily_ledger_transactions').delete().eq('ledger_id', ledgerId);
      if (delTxErr) {
        console.warn("Notice clearing old ledger transactions:", delTxErr);
      }

      if (txRows.length > 0) {
        const { error: txErr } = await adminSupabase.from('daily_ledger_transactions').insert(txRows);
        if (txErr) {
          return NextResponse.json({ error: 'Failed to save transactions: ' + txErr.message }, { status: 500 });
        }
      }
    }

    // 4. Clear and Re-insert Expenses (only if explicitly provided in payload)
    if (expenses !== undefined && Array.isArray(expenses)) {
      const expRows = expenses.map((e: any) => ({
        ledger_id: ledgerId,
        description: e.description || 'Expense',
        amount: Number(e.amount) || 0
      }));

      const { error: delExpErr } = await adminSupabase.from('daily_ledger_expenses').delete().eq('ledger_id', ledgerId);
      if (delExpErr) {
        console.warn("Notice clearing old ledger expenses:", delExpErr);
      }

      if (expRows.length > 0) {
        const { error: expErr } = await adminSupabase.from('daily_ledger_expenses').insert(expRows);
        if (expErr) {
          return NextResponse.json({ error: 'Failed to save expenses: ' + expErr.message }, { status: 500 });
        }
      }
    }

    return NextResponse.json({
      success: true,
      ledger_id: ledgerId,
      branch_id: canonicalBranchId,
      calculated_closing_cash: calculatedClosingCash,
      calculated_closing_capital: calculatedClosingCapital,
      cash_status: cashMismatch ? 'MISMATCH' : 'OK',
      capital_status: capitalMismatch ? 'MISMATCH' : 'OK',
      variance: storedVariance,
      status: finalStatus
    });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) return NextResponse.json({ error: 'id parameter is required' }, { status: 400 });

    const { data: ledger } = await adminSupabase.from('daily_ledgers').select('branch_id, status').eq('id', id).single();
    if (!ledger) {
      return NextResponse.json({ error: 'Daily ledger not found' }, { status: 404 });
    }

    if (session.role === 'AUDITOR') {
      return NextResponse.json({ error: 'Forbidden. Auditors cannot delete daily ledgers.' }, { status: 403 });
    }
    if (session.role === 'TELLER') {
      return NextResponse.json({
        error: 'Direct daily ledger deletion is strictly prohibited for Tellers. Please submit a Change Request Ticket for Manager approval.'
      }, { status: 403 });
    }

    const { error } = await adminSupabase.from('daily_ledgers').delete().eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
    }

    const { id, is_flag_ignored } = await request.json();
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    if (session.role === 'AUDITOR') {
      return NextResponse.json({ error: 'Forbidden. Auditors cannot override daily ledger flags.' }, { status: 403 });
    }
    if (session.role === 'TELLER') {
      const { data: ledger } = await adminSupabase.from('daily_ledgers').select('branch_id').eq('id', id).single();
      const isTellerHq = !session.branchId || normalizeBranchId(session.branchId) === 'HQ';
      if (ledger && !isTellerHq && normalizeBranchId(ledger.branch_id) !== normalizeBranchId(session.branchId)) {
        return NextResponse.json({ error: 'Forbidden. You cannot modify a daily ledger belonging to another branch.' }, { status: 403 });
      }
    }

    const { error } = await adminSupabase
      .from('daily_ledgers')
      .update({ is_flag_ignored: !!is_flag_ignored })
      .eq('id', id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
