'use client';
import { getAuthHeaders } from '@/lib/getAuthHeaders';
import ChangeRequestModal from '@/components/ChangeRequestModal';
import { normalizeBranchId } from '@/lib/branch-mapping';
import { toast } from 'sonner';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  Building2, Calendar, DollarSign, Calculator, CheckCircle2, AlertTriangle, 
  FileSpreadsheet, Plus, Trash2, Save, ArrowLeft, RefreshCw, ShieldCheck, UserCheck, Scale
} from 'lucide-react';
import Link from 'next/link';

interface TransactionRow {
  transaction_type: 'LOAN_ISSUED' | 'REDEMPTION';
  bill_no: string;
  amount: number | string;
  weight_g: number | string;
  weight_mg: number | string;
  insurance_rs: number | string;
  item_code: string;
  interest_rs: number | string;
  cash_received: number | string;
  remarks: string;
}

interface ExpenseRow {
  description: string;
  amount: number | string;
}

const BRANCHES = [
  { id: 'BRL', name: 'Borella' },
  { id: 'KOT', name: 'Kotikawatta' },
  { id: 'DMT', name: 'Dematagoda' },
  { id: 'W2',  name: 'Wattala 2' },
  { id: 'W3',  name: 'Wattala 3' },
  { id: 'W4',  name: 'Wattala 4' },
  { id: 'KIR', name: 'Kiribathgoda' },
  { id: 'KDW', name: 'Kadawatha' },
  { id: 'DHW', name: 'Dehiwala' },
  { id: 'PND', name: 'Panadura' },
  { id: 'KTW', name: 'Kottawa' },
  { id: 'HMG', name: 'Homagama' },
  { id: 'KHT', name: 'Kahathuduwa' },
  { id: 'TEST', name: 'Test Branch' },
  { id: 'HQ',  name: 'Head Office' }
];

export default function DailyLedgerEntryPage() {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [hasExistingLedger, setHasExistingLedger] = useState<boolean>(false);
  const [existingLedgerData, setExistingLedgerData] = useState<any>(null);
  const [ledgerCorrectionModal, setLedgerCorrectionModal] = useState<boolean>(false);
  const [isHqUser, setIsHqUser] = useState(false);

  // Form State
  const [selectedBranch, setSelectedBranch] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('user');
        if (stored) {
          const u = JSON.parse(stored);
          const b = u.branchId || u.branch_id;
          if (b) return b;
        }
      } catch {}
    }
    return 'BRL';
  });
  const [ledgerDate, setLedgerDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [cpBalance, setCpBalance] = useState<string | number>('');
  const [openingBalance, setOpeningBalance] = useState<string | number>('');
  const [transferIn, setTransferIn] = useState<string | number>('');
  const [transferOut, setTransferOut] = useState<string | number>('');
  const [loanIssuedTotal, setLoanIssuedTotal] = useState<string | number>('');
  const [redemptionTotal, setRedemptionTotal] = useState<string | number>('');
  const [interestRecTotal, setInterestRecTotal] = useState<string | number>('');
  const [recoveryTotal, setRecoveryTotal] = useState<string | number>('');
  const [insuranceTotal, setInsuranceTotal] = useState<string | number>('');
  const [expensesTotal, setExpensesTotal] = useState<string | number>('');
  const [userClosingBalance, setUserClosingBalance] = useState<string | number>('');
  const [actualCashCount, setActualCashCount] = useState<string | number>('');
  const [staffShift, setStaffShift] = useState('');

  // Child Grids
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);

  // Metadata & Audit
  const [previousClosing, setPreviousClosing] = useState<number | null>(null);
  const [previousDate, setPreviousDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'warning'; message: string } | null>(null);

  // 1. Fetch user role and set default branch
  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      try {
        const u = JSON.parse(storedUser);
        setCurrentUser(u);
        const isAdmin = u.role === 'ADMIN' || u.branch_id === 'HQ' || u.branchId === 'HQ';
        setIsHqUser(isAdmin);

        if (!isAdmin && (u.branch_id || u.branchId)) {
          const bId = u.branch_id || u.branchId;
          setSelectedBranch(bId);
        }
      } catch (e) {
        console.error("Error parsing user from localStorage:", e);
      }
    }
  }, []);

  // 2. Fetch existing ledger for selected branch & date
  const fetchLedgerData = useCallback(async () => {
    if (!selectedBranch || !ledgerDate) return;
    setLoading(true);
    setFeedback(null);
    try {
      const headers = getAuthHeaders();
      const res = await fetch(`/api/ledger/daily?branch_id=${selectedBranch}&date=${ledgerDate}`, { headers });
      const contentType = res.headers.get('content-type');
      if (res.ok && contentType && contentType.includes('application/json')) {
        const data = await res.json();

        if (data.error) {
          setFeedback({ type: 'error', message: data.error });
          return;
        }

        setPreviousClosing(data.previous_closing);
        setPreviousDate(data.previous_ledger_date);

        if (data.ledger) {
          const l = data.ledger;
          setHasExistingLedger(true);
          setExistingLedgerData(l);
          setCpBalance(l.cp_balance || '');
          setOpeningBalance(l.opening_balance || '');
          setTransferIn(l.transfer_in || '');
          setTransferOut(l.transfer_out || '');
          setLoanIssuedTotal(l.loan_issued_total || '');
          setRedemptionTotal(l.redemption_total || '');
          setInterestRecTotal(l.interest_rec_total || '');
          setRecoveryTotal(l.recovery_total || '');
          setInsuranceTotal(l.insurance_total || '');
          setExpensesTotal(l.expenses_total || '');
          setUserClosingBalance(l.closing_balance || '');
          setActualCashCount(l.actual_cash_count !== null ? l.actual_cash_count : '');
          setStaffShift(l.staff_shift || '');

          setTransactions(data.transactions || []);
          setExpenses(data.expenses || []);
        } else {
          setHasExistingLedger(false);
          setExistingLedgerData(null);
          // Reset form for fresh date
          setCpBalance('');
          // Auto-fill opening balance from previous day closing if available!
          setOpeningBalance(data.previous_closing !== null ? data.previous_closing : '');
          setTransferIn('');
          setTransferOut('');
          setLoanIssuedTotal('');
          setRedemptionTotal('');
          setInterestRecTotal('');
          setRecoveryTotal('');
          setInsuranceTotal('');
          setExpensesTotal('');
          setUserClosingBalance('');
          setActualCashCount('');
          setStaffShift('');
          setTransactions([]);
          setExpenses([]);
        }
      } else {
        console.warn("Fetch ledger returned non-JSON response:", res.status);
      }
    } catch (err: any) {
      console.error("Fetch ledger error:", err);
    } finally {
      setLoading(false);
    }
  }, [selectedBranch, ledgerDate]);

  useEffect(() => {
    fetchLedgerData();
  }, [fetchLedgerData]);

  // 3. Real-Time Math Verification Engine
  const calculatedClosing = useMemo(() => {
    const op = Number(openingBalance) || 0;
    const ti = Number(transferIn) || 0;
    const to = Number(transferOut) || 0;
    const loans = Number(loanIssuedTotal) || 0;
    const red = Number(redemptionTotal) || 0;
    const int = Number(interestRecTotal) || 0;
    const rec = Number(recoveryTotal) || 0;
    const ins = Number(insuranceTotal) || 0;
    const exp = Number(expensesTotal) || 0;

    return Number((op + ti - to - loans + red + int + rec + ins - exp).toFixed(2));
  }, [openingBalance, transferIn, transferOut, loanIssuedTotal, redemptionTotal, interestRecTotal, recoveryTotal, insuranceTotal, expensesTotal]);

  const userClosingNum = Number(userClosingBalance) || 0;
  const isMathBalanced = Math.abs(userClosingNum - calculatedClosing) < 0.01;
  const mathDiff = Number((userClosingNum - calculatedClosing).toFixed(2));

  const isContinuityMismatch = useMemo(() => {
    if (previousClosing === null) return false;
    const op = Number(openingBalance) || 0;
    return Math.abs(op - previousClosing) > 0.01;
  }, [openingBalance, previousClosing]);

  // Auto calculate sum of detailed expenses
  const detailedExpensesSum = useMemo(() => {
    return expenses.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  }, [expenses]);

  // Sync expensesTotal with itemized expenses if expenses exist
  useEffect(() => {
    if (expenses.length > 0) {
      setExpensesTotal(detailedExpensesSum);
    }
  }, [detailedExpensesSum, expenses.length]);

  // Transaction Helpers
  const addTransactionRow = (type: 'LOAN_ISSUED' | 'REDEMPTION') => {
    setTransactions(prev => [
      ...prev,
      {
        transaction_type: type,
        bill_no: '',
        amount: '',
        weight_g: '',
        weight_mg: '',
        insurance_rs: '',
        item_code: 'PP',
        interest_rs: '',
        cash_received: '',
        remarks: ''
      }
    ]);
  };

  const removeTransactionRow = (index: number) => {
    setTransactions(prev => prev.filter((_, i) => i !== index));
  };

  const updateTransactionRow = (index: number, field: keyof TransactionRow, val: any) => {
    setTransactions(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: val };
      return updated;
    });
  };

  // Expense Helpers
  const addExpenseRow = () => {
    setExpenses(prev => [...prev, { description: '', amount: '' }]);
  };

  const removeExpenseRow = (index: number) => {
    setExpenses(prev => prev.filter((_, i) => i !== index));
  };

  const updateExpenseRow = (index: number, field: keyof ExpenseRow, val: any) => {
    setExpenses(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: val };
      return updated;
    });
  };

  // Save Handler
  const handleSaveLedger = async () => {
    // If an existing ledger is LOCKED by Management and user is TELLER, redirect to Maker-Checker ticket
    if (hasExistingLedger && existingLedgerData?.status === 'LOCKED' && currentUser?.role === 'TELLER') {
      setLedgerCorrectionModal(true);
      return;
    }
    setSaving(true);
    setFeedback(null);

    const effectiveBranch = normalizeBranchId(selectedBranch || 'HQ');
    const finalClosingCash = (userClosingBalance !== '' && userClosingBalance !== null && userClosingBalance !== undefined)
      ? Number(userClosingBalance)
      : calculatedClosing;

    const payload = {
      branch_id: effectiveBranch,
      ledger_date: ledgerDate,
      cp_balance: cpBalance,
      opening_balance: openingBalance,
      transfer_in: transferIn,
      transfer_out: transferOut,
      loan_issued_total: loanIssuedTotal,
      redemption_total: redemptionTotal,
      interest_rec_total: interestRecTotal,
      recovery_total: recoveryTotal,
      insurance_total: insuranceTotal,
      expenses_total: expensesTotal,
      closing_balance: finalClosingCash,
      actual_cash_count: actualCashCount !== '' ? actualCashCount : finalClosingCash,
      staff_shift: staffShift,
      created_by: currentUser?.email || 'Teller',
      status: isMathBalanced ? 'APPROVED' : 'FLAGGED',
      transactions,
      expenses
    };

    const toastId = toast.loading(`Saving Daily Ledger for ${effectiveBranch} (${ledgerDate})...`);

    try {
      const headers = {
        'Content-Type': 'application/json',
        ...getAuthHeaders({ 'x-branch-id': effectiveBranch })
      };

      const res = await fetch('/api/ledger/daily', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      let data: any = {};
      try {
        data = await res.json();
      } catch {
        data = { error: `Server returned ${res.status}: ${res.statusText || 'Unable to parse server response'}` };
      }

      if (!res.ok || data.error) {
        const errorMsg = data.error || `Save failed with status ${res.status}`;
        toast.error(errorMsg, { id: toastId, duration: 6000 });
        setFeedback({ type: 'error', message: errorMsg });
      } else {
        if (data.math_status === 'MISMATCH') {
          toast.warning(`Ledger saved as FLAGGED! Variance: LKR ${data.math_mismatch_amount}`, { id: toastId, duration: 6000 });
          setFeedback({
            type: 'warning',
            message: `Ledger saved as FLAGGED! Manual Closing differs from Calculated Closing by LKR ${data.math_mismatch_amount}`
          });
        } else {
          toast.success(`Save Success! Daily Ledger for ${effectiveBranch} saved successfully ✓`, { id: toastId, duration: 5000 });
          setFeedback({
            type: 'success',
            message: `Daily Ledger for ${effectiveBranch} on ${ledgerDate} saved successfully with 100% Math Balance!`
          });
        }
        fetchLedgerData();
      }
    } catch (err: any) {
      toast.error(err.message || 'Error occurred while saving ledger', { id: toastId });
      setFeedback({ type: 'error', message: err.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-3xl bg-slate-900 text-slate-100 p-4 md:p-8 space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 bg-slate-800/80 backdrop-blur border border-slate-700/60 p-6 rounded-2xl shadow-2xl">
        <div className="flex items-center gap-4">
          <Link href="/accounting/ledger" className="p-3 bg-slate-700/50 hover:bg-slate-700 rounded-xl transition">
            <ArrowLeft className="w-5 h-5 text-slate-300" />
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
                <FileSpreadsheet className="w-7 h-7 text-emerald-400" />
                Daily Ledger Data Entry
              </h1>
              <span className="px-3 py-1 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full text-xs font-bold uppercase tracking-wider">
                Fail-Safe Verification
              </span>
            </div>
            <p className="text-slate-400 text-sm mt-1">
              Enter and audit multi-branch daily paper log records into Supabase DB.
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-3 w-full md:w-auto justify-end">
          <button
            onClick={fetchLedgerData}
            disabled={loading}
            className="p-3 bg-slate-700 hover:bg-slate-600 rounded-xl text-slate-200 transition disabled:opacity-50"
            title="Refresh Data"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={handleSaveLedger}
            disabled={saving || loading}
            className="flex items-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition shadow-lg shadow-emerald-600/30 disabled:opacity-50"
          >
            <Save className="w-5 h-5" />
            {saving ? 'Saving...' : 'Save & Verify Ledger'}
          </button>
        </div>
      </div>

      {/* Notifications */}
      {feedback && (
        <div className={`p-4 rounded-xl border flex items-center gap-3 text-sm font-semibold ${
          feedback.type === 'success' ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-200' :
          feedback.type === 'warning' ? 'bg-amber-950/80 border-amber-500/50 text-amber-200' :
          'bg-rose-950/80 border-rose-500/50 text-rose-200'
        }`}>
          {feedback.type === 'success' ? <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" /> : <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />}
          <span>{feedback.message}</span>
        </div>
      )}

      {/* Branch & Date Control Card */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-slate-800/50 border border-slate-700/50 p-5 rounded-2xl">
        {/* Branch Selector */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <Building2 className="w-4 h-4 text-emerald-400" />
            Branch Selection
          </label>
          <select
            value={selectedBranch}
            onChange={(e) => setSelectedBranch(e.target.value)}
            disabled={!isHqUser}
            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-white font-bold focus:ring-2 focus:ring-emerald-500 focus:outline-none disabled:opacity-75 disabled:cursor-not-allowed"
          >
            {BRANCHES.map(b => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.id})
              </option>
            ))}
          </select>
          {!isHqUser && (
            <p className="text-xs text-amber-400/90 font-medium">Locked to your assigned branch</p>
          )}
        </div>

        {/* Ledger Date Picker */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <Calendar className="w-4 h-4 text-emerald-400" />
            Ledger Date
          </label>
          <input
            type="date"
            value={ledgerDate}
            onChange={(e) => setLedgerDate(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-white font-bold focus:ring-2 focus:ring-emerald-500 focus:outline-none"
          />
        </div>

        {/* Staff Shift Input */}
        <div className="space-y-1.5 md:col-span-2">
          <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <UserCheck className="w-4 h-4 text-emerald-400" />
            Staff Shifts / Attendance
          </label>
          <input
            type="text"
            placeholder="e.g. Achini (8.00-5.30), Dahami (8.00-5.30 / AB)"
            value={staffShift}
            onChange={(e) => setStaffShift(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-white font-medium focus:ring-2 focus:ring-emerald-500 focus:outline-none placeholder:text-slate-600"
          />
        </div>
      </div>

      {/* Main Grid Section: Left = Cash Summary Form, Right = Live Verification Engine */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Side: Paper Ledger Cash Form (8 Cols) */}
        <div className="lg:col-span-8 bg-slate-800/60 border border-slate-700/60 p-6 rounded-2xl space-y-6">
          <div className="flex items-center justify-between border-b border-slate-700/60 pb-4">
            <h2 className="text-lg font-extrabold text-white flex items-center gap-2">
              <Calculator className="w-5 h-5 text-emerald-400" />
              Daily Cash Ledger Figures
            </h2>
            <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
              <span>CP Balance:</span>
              <input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={cpBalance}
                onChange={(e) => setCpBalance(e.target.value)}
                className="w-32 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-white font-bold text-right"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 1. Opening Balance */}
            <div className="space-y-1">
              <div className="flex justify-between items-center text-xs text-slate-400 font-bold uppercase">
                <span>Opening Balance (ආරම්භක)</span>
                {previousClosing !== null && (
                  <span className="text-slate-500 text-[10px]">Prev: LKR {previousClosing.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                )}
              </div>
              <input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={openingBalance}
                onChange={(e) => setOpeningBalance(e.target.value)}
                className={`w-full bg-slate-900 border rounded-xl px-4 py-2.5 text-white font-bold text-right text-lg focus:ring-2 focus:ring-emerald-500 focus:outline-none ${
                  isContinuityMismatch ? 'border-amber-500/80 text-amber-200' : 'border-slate-700'
                }`}
              />
            </div>

            {/* 2. Transfers */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs text-emerald-400 font-bold uppercase">Transfer In (+)</label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={transferIn}
                  onChange={(e) => setTransferIn(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-emerald-300 font-bold text-right focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-rose-400 font-bold uppercase">Transfer Out (-)</label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={transferOut}
                  onChange={(e) => setTransferOut(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-rose-300 font-bold text-right focus:ring-2 focus:ring-rose-500 focus:outline-none"
                />
              </div>
            </div>

            {/* 3. Loans Issued */}
            <div className="space-y-1">
              <label className="text-xs text-rose-400 font-bold uppercase">Loans Issued Total (-)</label>
              <input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={loanIssuedTotal}
                onChange={(e) => setLoanIssuedTotal(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-rose-300 font-bold text-right text-lg focus:ring-2 focus:ring-rose-500 focus:outline-none"
              />
            </div>

            {/* 4. Redemptions */}
            <div className="space-y-1">
              <label className="text-xs text-emerald-400 font-bold uppercase">Redemptions Total (+)</label>
              <input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={redemptionTotal}
                onChange={(e) => setRedemptionTotal(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-emerald-300 font-bold text-right text-lg focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              />
            </div>

            {/* 5. Interest Collected */}
            <div className="space-y-1">
              <label className="text-xs text-emerald-400 font-bold uppercase">Interest Rec: Int (+)</label>
              <input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={interestRecTotal}
                onChange={(e) => setInterestRecTotal(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-emerald-300 font-bold text-right focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              />
            </div>

            {/* 6. Recovery Total */}
            <div className="space-y-1">
              <label className="text-xs text-emerald-400 font-bold uppercase">Recovery Total (+)</label>
              <input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={recoveryTotal}
                onChange={(e) => setRecoveryTotal(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-emerald-300 font-bold text-right focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              />
            </div>

            {/* 7. Insurance Collected */}
            <div className="space-y-1">
              <label className="text-xs text-emerald-400 font-bold uppercase">Insurance Total (+)</label>
              <input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={insuranceTotal}
                onChange={(e) => setInsuranceTotal(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-emerald-300 font-bold text-right focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              />
            </div>

            {/* 8. Expenses Total */}
            <div className="space-y-1">
              <label className="text-xs text-rose-400 font-bold uppercase">Daily Expenses Total (-)</label>
              <input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={expensesTotal}
                onChange={(e) => setExpensesTotal(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-rose-300 font-bold text-right focus:ring-2 focus:ring-rose-500 focus:outline-none"
              />
            </div>

            {/* 9. Closing Balance (User Input) */}
            <div className="space-y-1 border-t border-slate-700/60 pt-3 md:col-span-2">
              <div className="flex justify-between items-center text-xs font-bold uppercase text-slate-300">
                <span>Closing Balance (ලෙජර් අවසාන ශේෂය)</span>
                <span className="text-emerald-400 text-[11px] font-mono">Formula Result: LKR {calculatedClosing.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
              </div>
              <input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={userClosingBalance}
                onChange={(e) => setUserClosingBalance(e.target.value)}
                className={`w-full bg-slate-900 border rounded-xl px-4 py-3 text-right text-xl font-black focus:ring-2 focus:outline-none ${
                  userClosingBalance !== '' && !isMathBalanced
                    ? 'border-rose-500 text-rose-300 focus:ring-rose-500'
                    : 'border-emerald-500/80 text-emerald-300 focus:ring-emerald-500'
                }`}
              />
            </div>
          </div>
        </div>

        {/* Right Side: Live Verification & Audit Status Box (4 Cols) */}
        <div className="lg:col-span-4 space-y-6">
          
          {/* Real-time Math Lock Card */}
          <div className={`p-6 rounded-2xl border backdrop-blur shadow-xl transition-all ${
            userClosingBalance === ''
              ? 'bg-slate-800/80 border-slate-700 text-slate-300'
              : isMathBalanced
              ? 'bg-emerald-950/80 border-emerald-500/80 text-emerald-100 shadow-emerald-950/50'
              : 'bg-rose-950/80 border-rose-500/80 text-rose-100 shadow-rose-950/50'
          }`}>
            <div className="flex items-center gap-3 border-b border-current/20 pb-4 mb-4">
              <ShieldCheck className="w-8 h-8 shrink-0" />
              <div>
                <h3 className="font-extrabold text-base tracking-tight uppercase">
                  {userClosingBalance === '' ? 'Awaiting Input' : isMathBalanced ? '100% Math Balanced' : 'Math Mismatch Alert'}
                </h3>
                <p className="text-xs opacity-80">Automatic Ledger Formula Verification</p>
              </div>
            </div>

            <div className="space-y-3 text-sm">
              <div className="flex justify-between items-center font-mono">
                <span className="opacity-75">Calculated Closing:</span>
                <span className="font-bold text-base">LKR {calculatedClosing.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between items-center font-mono">
                <span className="opacity-75">Entered Closing:</span>
                <span className="font-bold text-base">LKR {userClosingNum.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
              </div>

              <div className="border-t border-current/20 pt-3 flex justify-between items-center font-bold">
                <span>Formula Discrepancy:</span>
                <span className={`text-base font-mono ${isMathBalanced ? 'text-emerald-300' : 'text-rose-300 underline'}`}>
                  LKR {mathDiff.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          </div>

          {/* Date Continuity Verification */}
          <div className="bg-slate-800/60 border border-slate-700/60 p-5 rounded-2xl space-y-3">
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Scale className="w-4 h-4 text-emerald-400" />
              Date Continuity Verification
            </h4>
            {previousClosing !== null ? (
              <div className="text-xs space-y-2">
                <div className="flex justify-between text-slate-300">
                  <span>Last Recorded Date ({previousDate}):</span>
                  <span className="font-mono font-bold">LKR {previousClosing.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                </div>
                {isContinuityMismatch ? (
                  <div className="p-2.5 bg-amber-950/60 border border-amber-500/40 rounded-xl text-amber-300 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>Opening balance differs from previous closing balance!</span>
                  </div>
                ) : (
                  <div className="p-2.5 bg-emerald-950/60 border border-emerald-500/40 rounded-xl text-emerald-300 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>Opening balance matches previous day closing!</span>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-500 italic">No previous ledger entry found for continuity check.</p>
            )}
          </div>
        </div>

      </div>

      {/* Itemized Expenses Grid */}
      <div className="bg-slate-800/60 border border-slate-700/60 p-6 rounded-2xl space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-extrabold text-white">Daily Expenses Itemization (දිනපතා වියදම් ලැයිස්තුව)</h3>
            <p className="text-xs text-slate-400">Specify tea, garbage bags, stationary and other daily shop expenses.</p>
          </div>
          <button
            onClick={addExpenseRow}
            className="flex items-center gap-1.5 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-xl text-xs font-bold transition"
          >
            <Plus className="w-4 h-4 text-emerald-400" />
            Add Expense Item
          </button>
        </div>

        {expenses.length === 0 ? (
          <p className="text-xs text-slate-500 italic py-2">No itemized expenses added. Click &quot;Add Expense Item&quot; to list items.</p>
        ) : (
          <div className="space-y-2">
            {expenses.map((exp, idx) => (
              <div key={idx} className="flex items-center gap-3 bg-slate-900/60 p-2.5 rounded-xl border border-slate-700/50">
                <input
                  type="text"
                  placeholder="Description (e.g. Tea, Stapler pins)"
                  value={exp.description}
                  onChange={(e) => updateExpenseRow(idx, 'description', e.target.value)}
                  className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                />
                <input
                  type="number"
                  step="0.01"
                  placeholder="Amount (LKR)"
                  value={exp.amount}
                  onChange={(e) => updateExpenseRow(idx, 'amount', e.target.value)}
                  className="w-40 bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white font-bold text-right"
                />
                <button
                  onClick={() => removeExpenseRow(idx)}
                  className="p-1.5 text-rose-400 hover:bg-rose-950/50 rounded-lg transition"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
            <div className="flex justify-end pt-2 text-xs font-bold text-slate-300 font-mono">
              Total Itemized Expenses: LKR {detailedExpensesSum.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </div>
          </div>
        )}
      </div>

      {/* Maker-Checker Ledger Correction Modal */}
      <ChangeRequestModal
        isOpen={ledgerCorrectionModal}
        onClose={() => setLedgerCorrectionModal(false)}
        entityType="DAILY_LEDGER"
        actionType="LEDGER_ADJUST"
        entityId={existingLedgerData?.id || `${normalizeBranchId(selectedBranch || 'HQ')}_${ledgerDate}`}
        referenceNo={`${normalizeBranchId(selectedBranch || 'HQ')} (${ledgerDate})`}
        branchId={normalizeBranchId(selectedBranch || 'HQ')}
        currentData={existingLedgerData || {}}
        initialProposedData={{
          closing_balance: userClosingBalance !== '' ? Number(userClosingBalance) : calculatedClosing,
          expenses_total: expensesTotal,
          opening_balance: openingBalance,
          transfer_in: transferIn,
          transfer_out: transferOut,
          loan_issued_total: loanIssuedTotal,
          redemption_total: redemptionTotal,
          interest_rec_total: interestRecTotal
        }}
        onSubmitted={() => {
          fetchLedgerData();
        }}
      />
    </div>
  );
}
