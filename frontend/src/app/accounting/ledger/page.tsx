'use client';
import { getAuthHeaders } from '@/lib/getAuthHeaders';

import { useState, useEffect, useMemo, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { 
  Building2, Calendar, Calculator, CheckCircle2, AlertTriangle, 
  FileSpreadsheet, Plus, Trash2, Save, RefreshCw, UserCheck,
  Layers, FileText
} from 'lucide-react';
import { Button } from "@/components/ui/button";

interface TransactionRow {
  id: string;
  loan_no: string;
  cash_loan: number | string;
  insurance_rs: number | string;
  weight_g: number | string;
  weight_mg: number | string;
  item_code: string;
  redeem_no: string;
  interest_rs: number | string;
  cash_received: number | string;
  type_ir: 'I' | 'R' | '';
  fs_type: 'F' | 'S' | '';
  quantity: number | string;
  remarks: string;
}

interface ExpenseRow {
  id: string;
  description: string;
  amount: number | string;
}

interface StaffShiftItem {
  id: string;
  name: string;
  checkIn: string;
  checkOut: string;
  status: 'PRESENT' | 'ABSENT';
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

const BILL_PREFIXES = ["1R", "12R", "3R", "6R", "M", "A"];

const applyBillPrefix = (currentVal: string, prefix: string) => {
  const trimmed = (currentVal || '').trim();
  if (!trimmed) return `${prefix} `;
  const parts = trimmed.split(/\s+/);
  if (parts.length > 1 && BILL_PREFIXES.includes(parts[0].toUpperCase())) {
    return `${prefix} ${parts.slice(1).join(' ')}`;
  }
  if (parts.length > 1 && /^[0-9]*[A-Za-z]+[0-9]*$/i.test(parts[0])) {
    return `${prefix} ${parts.slice(1).join(' ')}`;
  }
  return `${prefix} ${trimmed}`;
};


const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

function MainLedgerContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tabParam = searchParams.get('tab') || 'entry';
  const branchParam = searchParams.get('branch');

  const [activeTab, setActiveTab] = useState<'entry' | 'matrix' | 'journal'>(
    tabParam === 'matrix' ? 'matrix' : tabParam === 'journal' ? 'journal' : 'entry'
  );

  useEffect(() => {
    if (tabParam === 'matrix') setActiveTab('matrix');
    else if (tabParam === 'journal') setActiveTab('journal');
    else setActiveTab('entry');
  }, [tabParam]);

  // User State
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [isHqUser, setIsHqUser] = useState(false);

  // Controls
  const [selectedBranch, setSelectedBranch] = useState(() => {
    if (branchParam) return branchParam;
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
  const [cpBalance, setCpBalance] = useState<string | number>(''); // Closing Capital
  const [openingCapital, setOpeningCapital] = useState<string | number>(''); // Opening Capital

  // Daily Cash Figures
  const [openingBalance, setOpeningBalance] = useState<string | number>('');
  const [transferIn, setTransferIn] = useState<string | number>('');
  const [transferInType, setTransferInType] = useState<'B2B' | 'B2O' | 'O2B' | ''>('');
  const [transferOut, setTransferOut] = useState<string | number>('');
  const [transferOutType, setTransferOutType] = useState<'B2B' | 'B2O' | 'O2B' | ''>('');
  const [recoveryTotal, setRecoveryTotal] = useState<string | number>('');
  const [userClosingBalance, setUserClosingBalance] = useState<string | number>('');

  // Manual Summary Totals (Direct paper ledger entry overrides)
  const [manualLoanTotal, setManualLoanTotal] = useState<string | number>('');
  const [manualRedeemTotal, setManualRedeemTotal] = useState<string | number>('');
  const [manualInterestTotal, setManualInterestTotal] = useState<string | number>('');
  const [manualInsuranceTotal, setManualInsuranceTotal] = useState<string | number>('');
  const [manualExpensesTotal, setManualExpensesTotal] = useState<string | number>('');

  // Transactions & Expenses
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);

  // Staff Shifts
  const [shiftList, setShiftList] = useState<StaffShiftItem[]>([]);
  const [newStaffName, setNewStaffName] = useState('');
  const [newCheckIn, setNewCheckIn] = useState('08:00');
  const [newCheckOut, setNewCheckOut] = useState('17:30');
  const [newShiftStatus, setNewShiftStatus] = useState<'PRESENT' | 'ABSENT'>('PRESENT');

  const [previousClosing, setPreviousClosing] = useState<number | null>(null);
  const [previousCapital, setPreviousCapital] = useState<number | null>(null);
  const [previousDate, setPreviousDate] = useState<string | null>(null);
  const [loadingLedger, setLoadingLedger] = useState(false);
  const [savingLedger, setSavingLedger] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'warning'; message: string } | null>(null);
  const [showSavedPopup, setShowSavedPopup] = useState(false);

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      try {
        const u = JSON.parse(storedUser);
        setCurrentUser(u);
        const isAdmin = u.role === 'ADMIN' || u.branch_id === 'HQ' || u.branchId === 'HQ';
        setIsHqUser(isAdmin);
        if (!isAdmin && (u.branch_id || u.branchId)) {
          setSelectedBranch(u.branch_id || u.branchId);
        }
      } catch (e) {
        console.error("Error parsing user:", e);
      }
    }
  }, []);

  // Sync Staff Shift String
  const staffShiftString = useMemo(() => {
    return shiftList.map(s => {
      const timeStr = `${s.checkIn}-${s.checkOut}`;
      return s.status === 'ABSENT' ? `${s.name} (${timeStr} / AB)` : `${s.name} (${timeStr})`;
    }).join(', ');
  }, [shiftList]);

  const handleAddShift = () => {
    if (!newStaffName.trim()) return;
    setShiftList(prev => [
      ...prev,
      {
        id: Math.random().toString(36).substring(2, 9),
        name: newStaffName.trim(),
        checkIn: newCheckIn,
        checkOut: newCheckOut,
        status: newShiftStatus
      }
    ]);
    setNewStaffName('');
  };

  const handleRemoveShift = (id: string) => {
    setShiftList(prev => prev.filter(s => s.id !== id));
  };

  // Transaction Table Row Handlers
  const handleAddTransactionRow = () => {
    setTransactions(prev => [
      ...prev,
      {
        id: Math.random().toString(36).substring(2, 9),
        loan_no: '',
        cash_loan: '',
        insurance_rs: '',
        weight_g: '',
        weight_mg: '',
        item_code: '',
        redeem_no: '',
        interest_rs: '',
        cash_received: '',
        type_ir: 'R' as const,
        fs_type: '' as const,
        quantity: '',
        remarks: ''
      }
    ]);
  };

  const handleRemoveTransactionRow = (index: number) => {
    setTransactions(prev => prev.filter((_, i) => i !== index));
  };

  const handleUpdateTransactionRow = (index: number, field: keyof TransactionRow, val: any) => {
    setTransactions(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: val };
      return updated;
    });
  };

  const handleAddTransactionRowWithPrefix = (field: 'loan_no' | 'redeem_no', prefix: string) => {
    setTransactions(prev => [
      ...prev,
      {
        id: Math.random().toString(36).substring(2, 9),
        transaction_type: field === 'loan_no' ? 'LOAN_ISSUED' : 'REDEMPTION',
        loan_no: field === 'loan_no' ? `${prefix} ` : '',
        cash_loan: '',
        insurance_rs: '',
        weight_g: '',
        weight_mg: '',
        item_code: '',
        redeem_no: field === 'redeem_no' ? `${prefix} ` : '',
        interest_rs: '',
        cash_received: '',
        type_ir: 'R' as const,
        fs_type: '' as const,
        quantity: '',
        remarks: ''
      }
    ]);
  };


  // Expenses Handlers
  const handleAddExpenseRow = () => {
    setExpenses(prev => [...prev, { id: Math.random().toString(36).substring(2, 9), description: '', amount: '' }]);
  };

  const handleRemoveExpenseRow = (index: number) => {
    setExpenses(prev => prev.filter((_, i) => i !== index));
  };

  const handleUpdateExpenseRow = (index: number, field: keyof ExpenseRow, val: any) => {
    setExpenses(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: val };
      return updated;
    });
  };

  // Auto-calculated Totals
  const totalLoansIssued = useMemo(() => {
    return transactions.reduce((sum, t) => sum + (Number(t.cash_loan) || 0), 0);
  }, [transactions]);

  const totalRedemptions = useMemo(() => {
    return transactions.reduce((sum, t) => sum + (Number(t.cash_received) || 0), 0);
  }, [transactions]);

  const totalInterestCollected = useMemo(() => {
    return transactions.reduce((sum, t) => sum + (Number(t.interest_rs) || 0), 0);
  }, [transactions]);

  const totalInsuranceCollected = useMemo(() => {
    return transactions.reduce((sum, t) => sum + (Number(t.insurance_rs) || 0), 0);
  }, [transactions]);

  const totalExpensesSum = useMemo(() => {
    return expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  }, [expenses]);

  // Effective totals (Use transaction grid auto-sum if available, otherwise manual direct entry)
  const effectiveLoansIssued = useMemo(() => {
    return totalLoansIssued > 0 ? totalLoansIssued : (Number(manualLoanTotal) || 0);
  }, [totalLoansIssued, manualLoanTotal]);

  const effectiveRedemptions = useMemo(() => {
    return totalRedemptions > 0 ? totalRedemptions : (Number(manualRedeemTotal) || 0);
  }, [totalRedemptions, manualRedeemTotal]);

  const effectiveInterest = useMemo(() => {
    return totalInterestCollected > 0 ? totalInterestCollected : (Number(manualInterestTotal) || 0);
  }, [totalInterestCollected, manualInterestTotal]);

  const effectiveInsurance = useMemo(() => {
    return totalInsuranceCollected > 0 ? totalInsuranceCollected : (Number(manualInsuranceTotal) || 0);
  }, [totalInsuranceCollected, manualInsuranceTotal]);

  const effectiveExpenses = useMemo(() => {
    return totalExpensesSum > 0 ? totalExpensesSum : (Number(manualExpensesTotal) || 0);
  }, [totalExpensesSum, manualExpensesTotal]);

  // Formula Closing Balances
  const calculatedClosingCash = useMemo(() => {
    const op = Number(openingBalance) || 0;
    const ti = Number(transferIn) || 0;
    const to = Number(transferOut) || 0;
    const rec = Number(recoveryTotal) || 0;

    return Number((op + ti - to - effectiveLoansIssued + effectiveRedemptions + effectiveInterest + rec + effectiveInsurance - effectiveExpenses).toFixed(2));
  }, [openingBalance, transferIn, transferOut, effectiveLoansIssued, effectiveRedemptions, effectiveInterest, recoveryTotal, effectiveInsurance, effectiveExpenses]);

  const calculatedClosingCapital = useMemo(() => {
    const opCap = Number(openingCapital) || 0;
    return Number((opCap + effectiveLoansIssued - effectiveRedemptions).toFixed(2));
  }, [openingCapital, effectiveLoansIssued, effectiveRedemptions]);


  // Fetch Ledger Data
  const fetchLedgerData = useCallback(async () => {
    if (!selectedBranch || !ledgerDate) return;
    setLoadingLedger(true);
    setFeedback(null);
    try {
      const headers = getAuthHeaders({ 'x-branch-id': selectedBranch });

      const res = await fetch(`/api/ledger/daily?branch_id=${selectedBranch}&date=${ledgerDate}`, { headers });
      const contentType = res.headers.get('content-type');
      
      if (res.ok && contentType && contentType.includes('application/json')) {
        const data = await res.json();
        if (data.error) {
          setFeedback({ type: 'error', message: data.error });
          return;
        }

        setPreviousClosing(data.previous_closing);
        setPreviousCapital(data.previous_capital);
        setPreviousDate(data.previous_ledger_date);

        if (data.ledger) {
          const l = data.ledger;
          setCpBalance(l.cp_balance || '');
          setOpeningCapital(l.opening_capital || '');
          setOpeningBalance(l.opening_balance || '');
          setTransferIn(l.transfer_in || '');
          setTransferInType(l.transfer_in_type || '');
          setTransferOut(l.transfer_out || '');
          setTransferOutType(l.transfer_out_type || '');
          setRecoveryTotal(l.recovery_total || '');
          setUserClosingBalance(l.closing_balance || '');
          
          // Restore manual values
          setManualLoanTotal(l.loan_issued_total || '');
          setManualRedeemTotal(l.redemption_total || '');
          setManualInterestTotal(l.interest_rec_total || '');
          setManualInsuranceTotal(l.insurance_total || '');
          setManualExpensesTotal(l.expenses_total || '');

          if (data.transactions && Array.isArray(data.transactions)) {
            setTransactions(data.transactions.map((t: any) => {
              let type_ir: 'I' | 'R' | '' = t.type_ir || 'R';
              let quantity = t.quantity || '';
              let remarks = t.remarks || '';
              let redeem_no = t.redeem_no || '';

              // Fallback for older data that still has remarks embedded
              if (remarks.includes('[RNO:')) {
                const rnoMatch = remarks.match(/\[RNO:(.*?)\]/);
                if (rnoMatch) {
                  redeem_no = rnoMatch[1];
                  remarks = remarks.replace(rnoMatch[0], '').trim();
                }
              }

              if (remarks.includes('[I:')) {
                type_ir = 'I';
                const match = remarks.match(/\[I:(.*?)\]\s*(.*)$/);
                if (match) {
                  quantity = match[1];
                  remarks = match[2];
                }
              }

              return {
                id: t.id || Math.random().toString(),
                loan_no: t.bill_no || t.loan_no || '',
                cash_loan: t.amount || t.cash_loan || '',
                insurance_rs: t.insurance_rs || '',
                weight_g: t.weight_g || '',
                weight_mg: t.weight_mg || '',
                item_code: t.item_code || '',
                redeem_no: redeem_no || t.redeem_no || '',
                interest_rs: t.interest_rs || '',
                cash_received: t.cash_received || '',
                type_ir,
                fs_type: t.fs_type || '',
                quantity,
                remarks
              };
            }));
          } else {
            setTransactions([]);
          }

          if (data.expenses && Array.isArray(data.expenses)) {
            setExpenses(data.expenses.map((e: any) => ({
              id: e.id || Math.random().toString(),
              description: e.description || '',
              amount: e.amount || ''
            })));
          } else {
            setExpenses([]);
          }
        } else {
          setCpBalance('');
          setOpeningCapital(data.previous_capital !== null ? data.previous_capital : '');
          setOpeningBalance(data.previous_closing !== null ? data.previous_closing : '');
          setTransferIn('');
          setTransferInType('');
          setTransferOut('');
          setTransferOutType('');
          setRecoveryTotal('');
          setUserClosingBalance('');
          
          setManualLoanTotal('');
          setManualRedeemTotal('');
          setManualInterestTotal('');
          setManualInsuranceTotal('');
          setManualExpensesTotal('');
          
          setTransactions([]);
          setExpenses([]);
        }
      } else {
        console.warn("Fetch ledger returned non-JSON response:", res.status);
      }
    } catch (err: any) {
      console.error("Fetch ledger error:", err);
    } finally {
      setLoadingLedger(false);
    }
  }, [selectedBranch, ledgerDate]);

  useEffect(() => {
    if (activeTab === 'entry') {
      fetchLedgerData();
    }
  }, [activeTab, fetchLedgerData]);

  const handleSaveLedger = async () => {
    setSavingLedger(true);
    setFeedback(null);

    const payload = {
      branch_id: selectedBranch,
      ledger_date: ledgerDate,
      cp_balance: (cpBalance !== '' && cpBalance !== null && cpBalance !== undefined) ? cpBalance : calculatedClosingCapital,
      opening_capital: openingCapital,
      opening_balance: openingBalance,
      transfer_in: transferIn,
      transfer_in_type: transferInType,
      transfer_out: transferOut,
      transfer_out_type: transferOutType,
      loan_issued_total: effectiveLoansIssued,
      redemption_total: effectiveRedemptions,
      interest_rec_total: effectiveInterest,
      recovery_total: recoveryTotal,
      insurance_total: effectiveInsurance,
      expenses_total: effectiveExpenses,
      closing_balance: userClosingBalance || calculatedClosingCash,
      staff_shift: staffShiftString,
      created_by: currentUser?.email || 'Teller',
      status: 'APPROVED',
      transactions,
      expenses
    };

    try {
      const res = await fetch('/api/ledger/daily', {
        method: 'POST',
        headers: getAuthHeaders({
          'Content-Type': 'application/json',
          'x-branch-id': selectedBranch
        }),
        body: JSON.stringify(payload)
      });
      const contentType = res.headers.get('content-type');
      let data: any = {};
      if (contentType && contentType.includes('application/json')) {
        data = await res.json();
      }

      if (!res.ok) {
        setFeedback({
          type: 'error',
          message: data.error || `Save failed: Server returned status ${res.status}. Please check database connection.`
        });
        return;
      }

      if (data.error) {
        setFeedback({ type: 'error', message: data.error });
      } else {
        setFeedback({
          type: 'success',
          message: `Daily Ledger for ${selectedBranch} (${ledgerDate}) saved successfully!`
        });
        setShowSavedPopup(true);
        fetchLedgerData();
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message });
    } finally {
      setSavingLedger(false);
    }
  };

  // Matrix State
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear().toString());
  const [matrixData, setMatrixData] = useState<Record<string, any>>({});
  const [matrixBranches, setMatrixBranches] = useState<any[]>([]);
  const [loadingMatrix, setLoadingMatrix] = useState(false);
  const [matrixError, setMatrixError] = useState<string | null>(null);

  // Matrix Branch Modal State (Daily Ledgers List)
  const [matrixBranchModalOpen, setMatrixBranchModalOpen] = useState(false);
  const [selectedMatrixBranch, setSelectedMatrixBranch] = useState<any | null>(null);
  const [selectedMatrixMonth, setSelectedMatrixMonth] = useState<string | null>(null);
  const [matrixBranchLedgers, setMatrixBranchLedgers] = useState<any[]>([]);
  const [loadingMatrixLedgers, setLoadingMatrixLedgers] = useState(false);

  // Months Modal State
  const [monthsModalOpen, setMonthsModalOpen] = useState(false);
  const [selectedMonthsBranch, setSelectedMonthsBranch] = useState<any | null>(null);
  const [branchAllLedgers, setBranchAllLedgers] = useState<any[]>([]);
  const [loadingBranchLedgers, setLoadingBranchLedgers] = useState(false);
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);

  const handleOpenMonthsModal = async (branch: any) => {
    setSelectedMonthsBranch(branch);
    setMonthsModalOpen(true);
    setExpandedMonth(null);
    setLoadingBranchLedgers(true);
    try {
      const res = await fetch(`/api/ledger/daily?branch_id=${branch.id}`, { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        const filtered = (data.ledgers || []).filter((l: any) => l.ledger_date.startsWith(selectedYear));
        setBranchAllLedgers(filtered);
      }
    } catch (err) {
      console.error("Failed to load ledgers", err);
    } finally {
      setLoadingBranchLedgers(false);
    }
  };

  const handleOpenBranchLedgers = async (branch: any, monthKey: string) => {
    setSelectedMatrixBranch(branch);
    setSelectedMatrixMonth(monthKey);
    setMatrixBranchModalOpen(true);
    setLoadingMatrixLedgers(true);
    try {
      const res = await fetch(`/api/ledger/daily?branch_id=${branch.id}`, { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        // filter by specific month
        const filtered = (data.ledgers || []).filter((l: any) => l.ledger_date.startsWith(monthKey));
        setMatrixBranchLedgers(filtered);
      }
    } catch (err) {
      console.error("Failed to load ledgers", err);
    } finally {
      setLoadingMatrixLedgers(false);
    }
  };

  const handleEditLedgerFromMatrix = (date: string, branchId: string) => {
    setSelectedBranch(branchId);
    setLedgerDate(date);
    setMatrixBranchModalOpen(false);
    setMonthsModalOpen(false);
    handleTabSwitch('entry');
  };

  const handleDeleteLedger = async (id: string, date: string) => {
    if (!confirm(`Are you sure you want to completely DELETE the ledger for ${date}? This action cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/ledger/daily?id=${id}`, { method: 'DELETE', headers: getAuthHeaders() });
      if (res.ok) {
        setMatrixBranchLedgers(prev => prev.filter(l => l.id !== id));
        fetchMatrix(); // Refresh matrix counts
      } else {
        const data = await res.json();
        alert('Failed to delete: ' + data.error);
      }
    } catch (err: any) {
      alert('Failed to delete: ' + err.message);
    }
  };

  const handleIgnoreFlag = async (id: string) => {
    try {
      const res = await fetch(`/api/ledger/daily`, {
        method: 'PATCH',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ id, is_flag_ignored: true })
      });
      if (res.ok) {
        setBranchAllLedgers(prev => prev.map(l => l.id === id ? { ...l, is_flag_ignored: true } : l));
        fetchMatrix(); // Refresh matrix counts
      } else {
        alert('Failed to ignore flag');
      }
    } catch (err: any) {
      alert('Failed to ignore flag: ' + err.message);
    }
  };

  const fetchMatrix = useCallback(async () => {
    setLoadingMatrix(true);
    setMatrixError(null);
    try {
      const res = await fetch(`/api/ledger/matrix?year=${selectedYear}`, { headers: getAuthHeaders() });
      const contentType = res.headers.get('content-type');
      if (res.ok && contentType && contentType.includes('application/json')) {
        const data = await res.json();
        if (data.error) setMatrixError(data.error);
        else {
          setMatrixBranches(data.branches || []);
          setMatrixData(data.matrix || {});
        }
      } else {
        setMatrixError(`Matrix load error: Server returned status ${res.status}`);
      }
    } catch (err: any) {
      setMatrixError(err.message);
    } finally {
      setLoadingMatrix(false);
    }
  }, [selectedYear]);

  useEffect(() => {
    if (activeTab === 'matrix') fetchMatrix();
  }, [activeTab, fetchMatrix]);

  const grandTotalEntered = Object.values(matrixData).reduce((sum, b: any) => sum + (b.total_entered || 0), 0);
  const grandTotalFlagged = Object.values(matrixData).reduce((sum, b: any) => sum + (b.total_flagged || 0), 0);

  // Journal Logs
  const [journalEntries, setJournalEntries] = useState<any[]>([]);
  const [loadingJournal, setLoadingJournal] = useState(false);

  const loadJournalEntries = async () => {
    setLoadingJournal(true);
    try {
      const res = await fetch('/api/ledger', { headers: getAuthHeaders() });
      const contentType = res.headers.get('content-type');
      if (res.ok && contentType && contentType.includes('application/json')) {
        setJournalEntries(await res.json());
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingJournal(false);
    }
  };


  useEffect(() => {
    if (activeTab === 'journal') loadJournalEntries();
  }, [activeTab]);

  const handleTabSwitch = (tab: 'entry' | 'matrix' | 'journal') => {
    setActiveTab(tab);
    router.push(`/accounting/ledger?tab=${tab}`);
  };

  const renderSignButtons = (
    val: string | number,
    setVal: (v: string) => void,
    theme: 'emerald' | 'rose' | 'blue' = 'emerald',
    disabled: boolean = false
  ) => {
    const isNegative = String(val ?? '').trim().startsWith('-') || (Number(val) || 0) < 0;
    const isPositive = !String(val ?? '').trim().startsWith('-') && (Number(val) || 0) >= 0;

    const positiveBg = theme === 'rose'
      ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
      : theme === 'blue'
      ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
      : 'bg-emerald-600 text-white border-emerald-600 shadow-xs';

    return (
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            const str = String(val ?? '').trim();
            if (str.startsWith('-')) {
              setVal(str.substring(1));
            } else {
              const num = Number(str);
              if (!isNaN(num) && num < 0) {
                setVal(String(Math.abs(num)));
              }
            }
          }}
          className={`px-2 py-0.5 rounded text-[11px] font-black transition-all border disabled:opacity-40 disabled:cursor-not-allowed ${
            isPositive
              ? positiveBg
              : 'bg-white text-slate-500 border-slate-300 hover:bg-slate-50'
          }`}
          title="Positive (+)"
        >
          +
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            const str = String(val ?? '').trim();
            if (!str.startsWith('-')) {
              if (str === '' || str === '0' || str === '0.00') {
                setVal('-');
              } else {
                setVal(`-${str}`);
              }
            }
          }}
          className={`px-2 py-0.5 rounded text-[11px] font-black transition-all border disabled:opacity-40 disabled:cursor-not-allowed ${
            isNegative
              ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
              : 'bg-white text-slate-500 border-slate-300 hover:bg-rose-50 hover:text-rose-700'
          }`}
          title="Negative (-)"
        >
          -
        </button>
      </div>
    );
  };

  return (
    <div className="w-full min-w-0 space-y-4 pb-24">
      
      {/* Main Title Bar */}
      <div className="w-full bg-white border border-slate-200 px-4 py-4 rounded-xl shadow-sm space-y-3">
        {/* Title row */}
        <div>
          <h1 className="text-lg md:text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            <FileSpreadsheet className="w-6 h-6 md:w-7 md:h-7 text-blue-600 shrink-0" />
            Daily Transaction Ledger
          </h1>
          <p className="text-slate-500 font-medium text-[11px] md:text-sm mt-0.5 ml-8">
            Digital Twin of Paper Ledger Book (Daily Financial Ledger)
          </p>
        </div>

        {/* Tab switcher — own row, scrollable on small screens */}
        <div className="overflow-x-auto -mx-1 px-1 pb-0.5">
          <div className="flex items-center gap-1.5 bg-slate-100 p-1.5 rounded-xl border border-slate-200 w-max min-w-full">
            <button
              onClick={() => handleTabSwitch('entry')}
              className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg font-bold text-xs transition whitespace-nowrap flex-1 ${
                activeTab === 'entry' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5 shrink-0" />
              Daily Entry Sheet
            </button>
            <button
              onClick={() => handleTabSwitch('matrix')}
              className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg font-bold text-xs transition whitespace-nowrap flex-1 ${
                activeTab === 'matrix' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
              }`}
            >
              <Layers className="w-3.5 h-3.5 shrink-0" />
              11-Branch Matrix
            </button>
            <button
              onClick={() => handleTabSwitch('journal')}
              className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg font-bold text-xs transition whitespace-nowrap flex-1 ${
                activeTab === 'journal' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
              }`}
            >
              <FileText className="w-3.5 h-3.5 shrink-0" />
              General Journal
            </button>
          </div>
        </div>
      </div>

      {/* ========================================== */}
      {/* TAB 1: DAILY LEDGER ENTRY SHEET            */}
      {/* ========================================== */}
      {activeTab === 'entry' && (
        <div className="w-full space-y-6">
          {feedback && (
            <div className={`p-4 rounded-xl border flex items-center gap-3 text-sm font-semibold w-full ${
              feedback.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' :
              feedback.type === 'warning' ? 'bg-amber-50 border-amber-200 text-amber-800' :
              'bg-rose-50 border-rose-200 text-rose-800'
            }`}>
              {feedback.type === 'success' ? <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" /> : <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />}
              <span>{feedback.message}</span>
            </div>
          )}

          {/* Top Control Header Card */}
          <div className="w-full bg-white border border-slate-200 p-4 rounded-xl shadow-sm space-y-3">
            {/* Row 1: Branch + Date (always side by side) */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-extrabold text-slate-700 uppercase tracking-wider flex items-center gap-1">
                  <Building2 className="w-3.5 h-3.5 text-blue-600" />
                  Branch
                </label>
                <select
                  value={selectedBranch}
                  onChange={(e) => setSelectedBranch(e.target.value)}
                  disabled={!isHqUser}
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-2 text-slate-900 font-bold text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:opacity-75"
                >
                  {BRANCHES.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.id})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-extrabold text-slate-700 uppercase tracking-wider flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-blue-600" />
                  Ledger Date
                </label>
                <input
                  type="date"
                  value={ledgerDate}
                  onChange={(e) => setLedgerDate(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-2 text-slate-900 font-bold text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>
            </div>            {/* Row 2: Staff Attendance */}
            <div className="grid grid-cols-1 md:grid-cols-1 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-extrabold text-slate-700 uppercase tracking-wider flex items-center gap-1">
                  <UserCheck className="w-3.5 h-3.5 text-blue-600" />
                  Staff
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Name..."
                    value={newStaffName}
                    onChange={(e) => setNewStaffName(e.target.value)}
                    className="flex-1 bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-2 text-slate-900 font-medium text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newStaffName.trim()) {
                        e.preventDefault();
                        const sList = [...shiftList, { id: Math.random().toString(), name: newStaffName.trim(), checkIn: newCheckIn, checkOut: newCheckOut, status: newShiftStatus }];
                        setShiftList(sList);
                        setNewStaffName('');
                      }
                    }}
                  />
                  <button 
                    type="button"
                    onClick={() => {
                      if (newStaffName.trim()) {
                        const sList = [...shiftList, { id: Math.random().toString(), name: newStaffName.trim(), checkIn: newCheckIn, checkOut: newCheckOut, status: newShiftStatus }];
                        setShiftList(sList);
                        setNewStaffName('');
                      }
                    }}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-xs font-bold transition flex items-center gap-1 shrink-0"
                  >
                    <Plus className="w-4 h-4" /> Add
                  </button>
                </div>
              </div>
            </div>

            {shiftList.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-2.5 border-t border-slate-200 w-full">
                {shiftList.map(s => (
                  <span key={s.id} className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-50 border border-blue-200 text-blue-900 rounded-full text-[11px] font-bold">
                    <span>{s.name} ({s.checkIn}-{s.checkOut})</span>
                    <button onClick={() => handleRemoveShift(s.id)} className="text-slate-400 hover:text-slate-800 text-sm font-black ml-0.5">×</button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* SECTION 1: TOP DAILY TRANSACTIONS GRID (EXCEL SHEET DIRECT TABLE) */}
          <div className="w-full bg-white border border-slate-200 p-4 rounded-xl shadow-sm space-y-3">
            <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-3">
              <div className="min-w-0">
                <h2 className="text-sm md:text-base font-black text-slate-900 flex items-center gap-1.5">
                  <FileSpreadsheet className="w-4 h-4 text-blue-600 shrink-0" />
                  <span className="truncate">Daily Transactions Grid</span>
                </h2>
                <p className="text-[10px] text-slate-500 font-medium mt-0.5 hidden sm:block">
                  Type loans & redemptions in rows below. Totals auto-calculated.
                </p>
              </div>
              <Button
                onClick={handleAddTransactionRow}
                variant="outline"
                size="sm"
                className="font-bold text-xs gap-1.5 border-blue-300 text-blue-700 hover:bg-blue-50 shrink-0"
              >
                <Plus className="w-4 h-4 text-blue-600" />
                + Add Bill Row
              </Button>
            </div>

            <div className="overflow-x-auto w-full border border-slate-200 rounded-xl">
              <table className="w-full text-left border-collapse text-xs min-w-[700px]">
                <thead>
                  <tr className="bg-slate-100 text-slate-700 font-extrabold uppercase border-b border-slate-200">
                    <th className="py-2 px-2 min-w-[100px]">Loan No</th>
                    <th className="py-2 px-2 min-w-[130px] text-right">Cash (Loan)</th>
                    <th className="py-2 px-2 min-w-[125px] text-right">Insurance</th>
                    <th className="py-2 px-2 min-w-[60px] text-center">Wt.g</th>
                    <th className="py-2 px-2 min-w-[60px] text-center">Wt.mg</th>
                    <th className="py-2 px-2 min-w-[55px] text-center">Code</th>
                    <th className="py-2 px-2 min-w-[100px]">Redeem No</th>
                    <th className="py-2 px-2 min-w-[125px] text-right">Interest</th>
                    <th className="py-2 px-2 min-w-[130px] text-right">Cash (Rdm)</th>
                    <th className="py-2 px-2 min-w-[55px] text-center">Type</th>
                    <th className="py-2 px-2 min-w-[55px] text-center">F/S</th>
                    <th className="py-2 px-1.5 w-[32px] text-center"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {transactions.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="py-8 text-center text-slate-400 font-medium">
                        No transactions added yet. Click &quot;+ Add Bill Row&quot; above to add rows.
                      </td>
                    </tr>
                  ) : (
                    transactions.map((t, idx) => (
                      <tr key={t.id || idx} className="hover:bg-slate-50/80 transition">
                        <td className="py-1.5 px-2 min-w-[140px]">
                          <div className="space-y-1">
                            <input
                              type="text"
                              value={t.loan_no}
                              onChange={(e) => handleUpdateTransactionRow(idx, 'loan_no', e.target.value)}
                              className="w-full bg-white border border-slate-300 rounded px-2 py-1 font-mono font-bold text-xs text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                            />
                            <div className="flex items-center gap-0.5 flex-wrap">
                              {["1R", "12R", "3R", "6R", "M", "A"].map(pref => (
                                <button
                                  key={pref}
                                  type="button"
                                  onClick={() => handleUpdateTransactionRow(idx, 'loan_no', applyBillPrefix(t.loan_no, pref))}
                                  className="px-1 py-0.2 bg-blue-50 hover:bg-blue-600 hover:text-white border border-blue-200 rounded text-[9px] font-black text-blue-800 transition-all cursor-pointer active:scale-95 shadow-2xs"
                                  title={`Click to set ${pref} prefix`}
                                >
                                  {pref}
                                </button>
                              ))}
                            </div>
                          </div>
                        </td>
                        <td className="py-1.5 px-2">
                          <div className="flex items-center gap-1 min-w-[125px]">
                            {renderSignButtons(t.cash_loan, (v) => handleUpdateTransactionRow(idx, 'cash_loan', v), 'rose')}
                            <input
                              type="text"
                              inputMode="decimal"
                              placeholder="0.00"
                              value={t.cash_loan}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val === '' || val === '-' || /^-?\d*\.?\d*$/.test(val)) {
                                  handleUpdateTransactionRow(idx, 'cash_loan', val);
                                }
                              }}
                              className={`w-full bg-white border rounded px-1.5 py-1 font-mono font-bold text-xs text-right focus:ring-2 focus:outline-none ${
                                String(t.cash_loan ?? '').trim().startsWith('-') || (Number(t.cash_loan) || 0) < 0
                                  ? 'text-rose-600 border-rose-300 focus:ring-rose-500'
                                  : 'text-rose-700 border-slate-300 focus:ring-rose-500'
                              }`}
                            />
                          </div>
                        </td>
                        <td className="py-1.5 px-2">
                          <div className="flex items-center gap-1 min-w-[120px]">
                            {renderSignButtons(t.insurance_rs, (v) => handleUpdateTransactionRow(idx, 'insurance_rs', v), 'emerald')}
                            <input
                              type="text"
                              inputMode="decimal"
                              placeholder="0.00"
                              value={t.insurance_rs}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val === '' || val === '-' || /^-?\d*\.?\d*$/.test(val)) {
                                  handleUpdateTransactionRow(idx, 'insurance_rs', val);
                                }
                              }}
                              className={`w-full bg-white border rounded px-1.5 py-1 font-mono font-bold text-xs text-right focus:ring-2 focus:outline-none ${
                                String(t.insurance_rs ?? '').trim().startsWith('-') || (Number(t.insurance_rs) || 0) < 0
                                  ? 'text-rose-600 border-rose-300 focus:ring-rose-500'
                                  : 'text-emerald-700 border-slate-300 focus:ring-emerald-500'
                              }`}
                            />
                          </div>
                        </td>
                        <td className="py-1.5 px-2">
                          <input
                            type="number"
                            value={t.weight_g}
                            onChange={(e) => handleUpdateTransactionRow(idx, 'weight_g', e.target.value)}
                            className="w-full bg-white border border-slate-300 rounded px-1.5 py-1 text-center font-bold text-xs text-slate-900"
                          />
                        </td>
                        <td className="py-1.5 px-2">
                          <input
                            type="number"
                            value={t.weight_mg}
                            onChange={(e) => handleUpdateTransactionRow(idx, 'weight_mg', e.target.value)}
                            className="w-full bg-white border border-slate-300 rounded px-1.5 py-1 text-center text-xs text-slate-800"
                          />
                        </td>
                        <td className="py-1.5 px-2">
                          <input
                            type="text"
                            value={t.item_code}
                            onChange={(e) => handleUpdateTransactionRow(idx, 'item_code', e.target.value)}
                            className="w-full bg-white border border-slate-300 rounded px-1.5 py-1 text-center font-bold text-xs uppercase text-slate-900"
                          />
                        </td>
                        <td className="py-1.5 px-2 min-w-[140px]">
                          <div className="space-y-1">
                            <input
                              type="text"
                              value={t.redeem_no}
                              onChange={(e) => handleUpdateTransactionRow(idx, 'redeem_no', e.target.value)}
                              className="w-full bg-white border border-slate-300 rounded px-2 py-1 font-mono font-bold text-xs text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                            />
                            <div className="flex items-center gap-0.5 flex-wrap">
                              {["1R", "12R", "3R", "6R", "M", "A"].map(pref => (
                                <button
                                  key={pref}
                                  type="button"
                                  onClick={() => handleUpdateTransactionRow(idx, 'redeem_no', applyBillPrefix(t.redeem_no, pref))}
                                  className="px-1 py-0.2 bg-emerald-50 hover:bg-emerald-600 hover:text-white border border-emerald-200 rounded text-[9px] font-black text-emerald-800 transition-all cursor-pointer active:scale-95 shadow-2xs"
                                  title={`Click to set ${pref} prefix`}
                                >
                                  {pref}
                                </button>
                              ))}
                            </div>
                          </div>
                        </td>
                        <td className="py-1.5 px-2">
                          <div className="flex items-center gap-1 min-w-[120px]">
                            {renderSignButtons(t.interest_rs, (v) => handleUpdateTransactionRow(idx, 'interest_rs', v), 'emerald')}
                            <input
                              type="text"
                              inputMode="decimal"
                              placeholder="0.00"
                              value={t.interest_rs}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val === '' || val === '-' || /^-?\d*\.?\d*$/.test(val)) {
                                  handleUpdateTransactionRow(idx, 'interest_rs', val);
                                }
                              }}
                              className={`w-full bg-white border rounded px-1.5 py-1 font-mono font-bold text-xs text-right focus:ring-2 focus:outline-none ${
                                String(t.interest_rs ?? '').trim().startsWith('-') || (Number(t.interest_rs) || 0) < 0
                                  ? 'text-rose-600 border-rose-300 focus:ring-rose-500'
                                  : 'text-emerald-700 border-slate-300 focus:ring-emerald-500'
                              }`}
                            />
                          </div>
                        </td>
                        <td className="py-1.5 px-2">
                          <div className="flex items-center gap-1 min-w-[125px]">
                            {renderSignButtons(t.cash_received, (v) => handleUpdateTransactionRow(idx, 'cash_received', v), 'emerald')}
                            <input
                              type="text"
                              inputMode="decimal"
                              placeholder="0.00"
                              value={t.cash_received}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val === '' || val === '-' || /^-?\d*\.?\d*$/.test(val)) {
                                  handleUpdateTransactionRow(idx, 'cash_received', val);
                                }
                              }}
                              className={`w-full bg-white border rounded px-1.5 py-1 font-mono font-bold text-xs text-right focus:ring-2 focus:outline-none ${
                                String(t.cash_received ?? '').trim().startsWith('-') || (Number(t.cash_received) || 0) < 0
                                  ? 'text-rose-600 border-rose-300 focus:ring-rose-500'
                                  : 'text-emerald-700 border-slate-300 focus:ring-emerald-500'
                              }`}
                            />
                          </div>
                        </td>
                        <td className="py-1.5 px-2">
                          <div className="space-y-1">
                            {/* I / R Toggle Buttons */}
                            <div className="flex gap-1">
                              <button
                                type="button"
                                onClick={() => handleUpdateTransactionRow(idx, 'type_ir', 'I')}
                                className={`flex-1 py-1 rounded font-black text-xs transition-all ${
                                  t.type_ir === 'I'
                                    ? 'bg-blue-600 text-white shadow-sm'
                                    : 'bg-slate-100 text-slate-500 hover:bg-blue-100 hover:text-blue-700 border border-slate-300'
                                }`}
                              >
                                I
                              </button>
                              <button
                                type="button"
                                onClick={() => handleUpdateTransactionRow(idx, 'type_ir', 'R')}
                                className={`flex-1 py-1 rounded font-black text-xs transition-all ${
                                  t.type_ir === 'R' || t.type_ir === ''
                                    ? 'bg-emerald-600 text-white shadow-sm'
                                    : 'bg-slate-100 text-slate-500 hover:bg-emerald-100 hover:text-emerald-700 border border-slate-300'
                                }`}
                              >
                                R
                              </button>
                            </div>
                            {/* Quantity — only show for type I */}
                            {t.type_ir === 'I' && (
                              <input
                                type="number"
                                placeholder="Qty"
                                value={t.quantity}
                                onChange={(e) => handleUpdateTransactionRow(idx, 'quantity', e.target.value)}
                                className="w-full bg-white border border-blue-300 rounded px-1.5 py-1 text-center font-bold text-xs text-blue-800 focus:ring-1 focus:ring-blue-400 focus:outline-none"
                              />
                            )}
                          </div>
                        </td>
                        <td className="py-1.5 px-2">
                          <div className="flex gap-1">
                            <button
                              type="button"
                              onClick={() => handleUpdateTransactionRow(idx, 'fs_type', t.fs_type === 'F' ? '' : 'F')}
                              className={`flex-1 py-1 rounded font-black text-xs transition-all ${
                                t.fs_type === 'F'
                                  ? 'bg-purple-600 text-white shadow-sm'
                                  : 'bg-slate-100 text-slate-500 hover:bg-purple-100 hover:text-purple-700 border border-slate-300'
                              }`}
                            >
                              F
                            </button>
                            <button
                              type="button"
                              onClick={() => handleUpdateTransactionRow(idx, 'fs_type', t.fs_type === 'S' ? '' : 'S')}
                              className={`flex-1 py-1 rounded font-black text-xs transition-all ${
                                t.fs_type === 'S'
                                  ? 'bg-amber-600 text-white shadow-sm'
                                  : 'bg-slate-100 text-slate-500 hover:bg-amber-100 hover:text-amber-700 border border-slate-300'
                              }`}
                            >
                              S
                            </button>
                          </div>
                        </td>
                        <td className="py-1.5 px-1 text-center">
                          <button
                            onClick={() => handleRemoveTransactionRow(idx)}
                            className="p-1 text-rose-600 hover:bg-rose-50 rounded transition"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-100 font-extrabold font-mono text-xs border-t-2 border-slate-300">
                    <td className="py-2.5 px-2.5 uppercase text-slate-800 font-black">TOTALS:</td>
                    <td className="py-2.5 px-2.5 text-right text-rose-700">LKR {totalLoansIssued.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                    <td className="py-2.5 px-2.5 text-right text-emerald-700">LKR {totalInsuranceCollected.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                    <td colSpan={4} className="py-2.5 px-2.5 text-center text-slate-500 font-normal">Auto-calculated formula sum ↓</td>
                    <td className="py-2.5 px-2.5 text-right text-emerald-700">LKR {totalInterestCollected.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                    <td className="py-2.5 px-2.5 text-right text-emerald-700">LKR {totalRedemptions.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                    <td colSpan={3}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* SECTION 2: CLEAN FULL-WIDTH STACKED SUMMARY & EXPENSES CARDS */}
          <div className="w-full flex flex-col gap-6">
            
            {/* Daily Financial Summary (Dual-Column Clean Layout) */}
            <div className="w-full bg-white border border-slate-200 p-5 rounded-xl shadow-sm space-y-5">
              <h3 className="text-base font-black text-slate-900 flex items-center gap-2 border-b border-slate-200 pb-3">
                <Calculator className="w-5 h-5 text-blue-600 shrink-0" />
                Daily Financial Summary (දිනපතා මූල්‍ය සාරාංශය)
              </h3>

              {/* Main Dual-Column Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                
                {/* COLUMN A: CASH ACCOUNTING (GREEN THEME) */}
                <div className="bg-white rounded-2xl border-2 border-emerald-500/30 shadow-sm overflow-hidden flex flex-col justify-between">
                  {/* Header Banner */}
                  <div className="bg-emerald-600 px-5 py-3 text-white">
                    <h4 className="text-sm font-black tracking-wider uppercase">CASH ACCOUNTING</h4>
                  </div>

                  {/* Form Items */}
                  <div className="p-5 space-y-4 flex-1">
                    {/* 1B. Opening Cash */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between bg-emerald-50/70 p-3 rounded-xl border border-emerald-200 gap-2">
                      <span className="font-extrabold text-xs text-emerald-950">1B. Opening Cash</span>
                      <div className="flex items-center gap-1.5 w-full sm:w-auto">
                        {renderSignButtons(openingBalance, setOpeningBalance, 'emerald')}
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="0.00"
                          value={openingBalance}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === '' || val === '-' || /^-?\d*\.?\d*$/.test(val)) {
                              setOpeningBalance(val);
                            }
                          }}
                          className={`w-full sm:w-36 bg-white border rounded-lg px-3 py-1.5 text-right font-mono text-xs font-bold focus:ring-2 focus:outline-none ${
                            String(openingBalance ?? '').trim().startsWith('-') || (Number(openingBalance) || 0) < 0
                              ? 'text-rose-600 border-rose-300 focus:ring-rose-500'
                              : 'text-slate-900 border-emerald-300 focus:ring-emerald-500'
                          }`}
                        />
                      </div>
                    </div>

                    {/* Cash Received */}
                    <div className="space-y-2 pt-2 border-t border-slate-100">
                      <span className="text-[10px] font-black text-emerald-800 uppercase tracking-wider block">Cash Received</span>
                      
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-200 gap-2">
                        <span className="text-xs font-bold text-slate-700">Cash In (Office / Transfer In)</span>
                        <div className="flex items-center gap-1.5 w-full sm:w-auto">
                          <div className="flex items-center gap-1">
                            {['B2B', 'B2O', 'O2B'].map(type => (
                              <button
                                key={type}
                                type="button"
                                onClick={() => setTransferInType(transferInType === type ? '' : type as any)}
                                className={`px-1.5 py-0.5 rounded text-[10px] font-black transition-all border ${
                                  transferInType === type
                                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                                    : 'bg-white text-slate-500 border-slate-300 hover:bg-emerald-50 hover:text-emerald-700'
                                }`}
                              >
                                {type}
                              </button>
                            ))}
                          </div>
                          {renderSignButtons(transferIn, setTransferIn, 'emerald')}
                          <input
                            type="text"
                            inputMode="decimal"
                            placeholder="0.00"
                            value={transferIn}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === '' || val === '-' || /^-?\d*\.?\d*$/.test(val)) {
                                setTransferIn(val);
                              }
                            }}
                            className={`w-full sm:w-32 bg-white border rounded-lg px-2.5 py-1 text-right font-mono text-xs font-bold focus:ring-2 focus:outline-none ${
                              String(transferIn ?? '').trim().startsWith('-') || (Number(transferIn) || 0) < 0
                                ? 'text-rose-600 border-rose-300 focus:ring-rose-500'
                                : 'text-emerald-700 border-slate-300 focus:ring-emerald-500'
                            }`}
                          />
                        </div>
                      </div>

                      <div className="flex flex-col sm:flex-row sm:items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-200 gap-2">
                        <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                          Redeem Cash
                          {totalRedemptions > 0 && <span className="text-[9px] bg-emerald-100 text-emerald-800 px-1 py-0.5 rounded font-mono">Auto</span>}
                        </span>
                        <div className="flex items-center gap-1.5 w-full sm:w-auto">
                          {renderSignButtons(
                            totalRedemptions > 0 ? totalRedemptions : manualRedeemTotal,
                            setManualRedeemTotal,
                            'emerald',
                            totalRedemptions > 0
                          )}
                          <input
                            type="text"
                            inputMode="decimal"
                            placeholder="0.00"
                            value={totalRedemptions > 0 ? totalRedemptions : manualRedeemTotal}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === '' || val === '-' || /^-?\d*\.?\d*$/.test(val)) {
                                setManualRedeemTotal(val);
                              }
                            }}
                            disabled={totalRedemptions > 0}
                            className={`w-full sm:w-32 bg-white border rounded-lg px-2.5 py-1 text-right font-mono text-xs font-bold focus:ring-2 disabled:bg-emerald-50/50 focus:outline-none ${
                              String((totalRedemptions > 0 ? totalRedemptions : manualRedeemTotal) ?? '').trim().startsWith('-') || (Number(totalRedemptions > 0 ? totalRedemptions : manualRedeemTotal) || 0) < 0
                                ? 'text-rose-600 border-rose-300 focus:ring-rose-500'
                                : 'text-emerald-700 border-slate-300 focus:ring-emerald-500'
                            }`}
                          />
                        </div>
                      </div>

                      <div className="flex flex-col sm:flex-row sm:items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-200 gap-2">
                        <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                          Receive (Interest)
                          {totalInterestCollected > 0 && <span className="text-[9px] bg-emerald-100 text-emerald-800 px-1 py-0.5 rounded font-mono">Auto</span>}
                        </span>
                        <div className="flex items-center gap-1.5 w-full sm:w-auto">
                          {renderSignButtons(
                            totalInterestCollected > 0 ? totalInterestCollected : manualInterestTotal,
                            setManualInterestTotal,
                            'emerald',
                            totalInterestCollected > 0
                          )}
                          <input
                            type="text"
                            inputMode="decimal"
                            placeholder="0.00"
                            value={totalInterestCollected > 0 ? totalInterestCollected : manualInterestTotal}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === '' || val === '-' || /^-?\d*\.?\d*$/.test(val)) {
                                setManualInterestTotal(val);
                              }
                            }}
                            disabled={totalInterestCollected > 0}
                            className={`w-full sm:w-32 bg-white border rounded-lg px-2.5 py-1 text-right font-mono text-xs font-bold focus:ring-2 disabled:bg-emerald-50/50 focus:outline-none ${
                              String((totalInterestCollected > 0 ? totalInterestCollected : manualInterestTotal) ?? '').trim().startsWith('-') || (Number(totalInterestCollected > 0 ? totalInterestCollected : manualInterestTotal) || 0) < 0
                                ? 'text-rose-600 border-rose-300 focus:ring-rose-500'
                                : 'text-emerald-700 border-slate-300 focus:ring-emerald-500'
                            }`}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200">
                          <span className="text-[11px] font-bold text-slate-600 block mb-1">Recovery</span>
                          <div className="flex items-center gap-1.5">
                            {renderSignButtons(recoveryTotal, setRecoveryTotal, 'emerald')}
                            <input
                              type="text"
                              inputMode="decimal"
                              placeholder="0.00"
                              value={recoveryTotal}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val === '' || val === '-' || /^-?\d*\.?\d*$/.test(val)) {
                                  setRecoveryTotal(val);
                                }
                              }}
                              className={`w-full bg-white border rounded-lg px-2 py-1 text-right font-mono text-xs font-bold focus:ring-2 focus:outline-none ${
                                String(recoveryTotal ?? '').trim().startsWith('-') || (Number(recoveryTotal) || 0) < 0
                                  ? 'text-rose-600 border-rose-300 focus:ring-rose-500'
                                  : 'text-emerald-700 border-slate-300 focus:ring-emerald-500'
                              }`}
                            />
                          </div>
                        </div>
                        <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200">
                          <span className="text-[11px] font-bold text-slate-600 block flex items-center justify-between mb-1">
                            Insurance
                            {totalInsuranceCollected > 0 && <span className="text-[9px] bg-emerald-100 text-emerald-800 px-1 py-0.5 rounded font-mono">Auto</span>}
                          </span>
                          <div className="flex items-center gap-1.5">
                            {renderSignButtons(
                              totalInsuranceCollected > 0 ? totalInsuranceCollected : manualInsuranceTotal,
                              setManualInsuranceTotal,
                              'emerald',
                              totalInsuranceCollected > 0
                            )}
                            <input
                              type="text"
                              inputMode="decimal"
                              placeholder="0.00"
                              value={totalInsuranceCollected > 0 ? totalInsuranceCollected : manualInsuranceTotal}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val === '' || val === '-' || /^-?\d*\.?\d*$/.test(val)) {
                                  setManualInsuranceTotal(val);
                                }
                              }}
                              disabled={totalInsuranceCollected > 0}
                              className={`w-full bg-white border rounded-lg px-2 py-1 text-right font-mono text-xs font-bold focus:ring-2 disabled:bg-emerald-50/50 focus:outline-none ${
                                String((totalInsuranceCollected > 0 ? totalInsuranceCollected : manualInsuranceTotal) ?? '').trim().startsWith('-') || (Number(totalInsuranceCollected > 0 ? totalInsuranceCollected : manualInsuranceTotal) || 0) < 0
                                  ? 'text-rose-600 border-rose-300 focus:ring-rose-500'
                                  : 'text-emerald-700 border-slate-300 focus:ring-emerald-500'
                              }`}
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Cash Paid Out */}
                    <div className="space-y-2 pt-2 border-t border-slate-100">
                      <span className="text-[10px] font-black text-rose-700 uppercase tracking-wider block">Cash Paid Out</span>

                      <div className="flex flex-col sm:flex-row sm:items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-200 gap-2">
                        <span className="text-xs font-bold text-slate-700">Cash Out / Transfer Out</span>
                        <div className="flex items-center gap-1.5 w-full sm:w-auto">
                          <div className="flex items-center gap-1">
                            {['B2B', 'B2O', 'O2B'].map(type => (
                              <button
                                key={type}
                                type="button"
                                onClick={() => setTransferOutType(transferOutType === type ? '' : type as any)}
                                className={`px-1.5 py-0.5 rounded text-[10px] font-black transition-all border ${
                                  transferOutType === type
                                    ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
                                    : 'bg-white text-slate-500 border-slate-300 hover:bg-rose-50 hover:text-rose-700'
                                }`}
                              >
                                {type}
                              </button>
                            ))}
                          </div>
                          {renderSignButtons(transferOut, setTransferOut, 'rose')}
                          <input
                            type="text"
                            inputMode="decimal"
                            placeholder="0.00"
                            value={transferOut}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === '' || val === '-' || /^-?\d*\.?\d*$/.test(val)) {
                                setTransferOut(val);
                              }
                            }}
                            className={`w-full sm:w-32 bg-white border rounded-lg px-2.5 py-1 text-right font-mono text-xs font-bold focus:ring-2 focus:outline-none ${
                              String(transferOut ?? '').trim().startsWith('-') || (Number(transferOut) || 0) < 0
                                ? 'text-rose-600 border-rose-300 focus:ring-rose-500'
                                : 'text-slate-900 border-slate-300 focus:ring-rose-500'
                            }`}
                          />
                        </div>
                      </div>

                      <div className="flex flex-col sm:flex-row sm:items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-200 gap-2">
                        <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                          Loans Issued
                          {totalLoansIssued > 0 && <span className="text-[9px] bg-rose-100 text-rose-800 px-1 py-0.5 rounded font-mono">Auto</span>}
                        </span>
                        <div className="flex items-center gap-1.5 w-full sm:w-auto">
                          {renderSignButtons(
                            totalLoansIssued > 0 ? totalLoansIssued : manualLoanTotal,
                            setManualLoanTotal,
                            'rose',
                            totalLoansIssued > 0
                          )}
                          <input
                            type="text"
                            inputMode="decimal"
                            placeholder="0.00"
                            value={totalLoansIssued > 0 ? totalLoansIssued : manualLoanTotal}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === '' || val === '-' || /^-?\d*\.?\d*$/.test(val)) {
                                setManualLoanTotal(val);
                              }
                            }}
                            disabled={totalLoansIssued > 0}
                            className={`w-full sm:w-32 bg-white border rounded-lg px-2.5 py-1 text-right font-mono text-xs font-bold focus:ring-2 disabled:bg-rose-50/50 focus:outline-none ${
                              String((totalLoansIssued > 0 ? totalLoansIssued : manualLoanTotal) ?? '').trim().startsWith('-') || (Number(totalLoansIssued > 0 ? totalLoansIssued : manualLoanTotal) || 0) < 0
                                ? 'text-rose-600 border-rose-300 focus:ring-rose-500'
                                : 'text-slate-900 border-slate-300 focus:ring-rose-500'
                            }`}
                          />
                        </div>
                      </div>

                      <div className="flex flex-col sm:flex-row sm:items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-200 gap-2">
                        <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                          Expenses
                          {totalExpensesSum > 0 && <span className="text-[9px] bg-rose-100 text-rose-800 px-1 py-0.5 rounded font-mono">Auto</span>}
                        </span>
                        <div className="flex items-center gap-1.5 w-full sm:w-auto">
                          {renderSignButtons(
                            totalExpensesSum > 0 ? totalExpensesSum : manualExpensesTotal,
                            setManualExpensesTotal,
                            'rose',
                            totalExpensesSum > 0
                          )}
                          <input
                            type="text"
                            inputMode="decimal"
                            placeholder="0.00"
                            value={totalExpensesSum > 0 ? totalExpensesSum : manualExpensesTotal}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === '' || val === '-' || /^-?\d*\.?\d*$/.test(val)) {
                                setManualExpensesTotal(val);
                              }
                            }}
                            disabled={totalExpensesSum > 0}
                            className={`w-full sm:w-32 bg-white border rounded-lg px-2.5 py-1 text-right font-mono text-xs font-bold focus:ring-2 disabled:bg-rose-50/50 focus:outline-none ${
                              String((totalExpensesSum > 0 ? totalExpensesSum : manualExpensesTotal) ?? '').trim().startsWith('-') || (Number(totalExpensesSum > 0 ? totalExpensesSum : manualExpensesTotal) || 0) < 0
                                ? 'text-rose-600 border-rose-300 focus:ring-rose-500'
                                : 'text-slate-900 border-slate-300 focus:ring-rose-500'
                            }`}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Closing Cash Result Card (Bottom) */}
                  <div className="p-5 bg-emerald-50 border-t-2 border-emerald-500/40 space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-black text-emerald-950 uppercase tracking-wider">L/Balance (Closing Cash)</span>
                      <span className="text-xl font-black font-mono text-emerald-950">LKR {calculatedClosingCash.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                    </div>

                    <div className="pt-2 border-t border-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-700">Closing Cash Entered:</span>
                      <div className="flex items-center gap-1.5 w-full sm:w-auto">
                        {renderSignButtons(userClosingBalance, setUserClosingBalance, 'emerald')}
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="0.00"
                          value={userClosingBalance}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === '' || val === '-' || /^-?\d*\.?\d*$/.test(val)) {
                              setUserClosingBalance(val);
                            }
                          }}
                          className={`w-full sm:w-36 bg-white border-2 rounded-xl px-3 py-1.5 text-right font-mono font-bold text-xs focus:outline-none focus:ring-2 ${
                            String(userClosingBalance ?? '').trim().startsWith('-') || (Number(userClosingBalance) || 0) < 0
                              ? 'text-rose-600 border-rose-300 focus:ring-rose-500'
                              : 'text-emerald-900 border-emerald-400 focus:ring-emerald-500'
                          }`}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* COLUMN B: CAPITAL ACCOUNTING (BLUE THEME) */}
                <div className="bg-white rounded-2xl border-2 border-blue-500/30 shadow-sm overflow-hidden flex flex-col justify-between">
                  {/* Header Banner */}
                  <div className="bg-blue-600 px-5 py-3 text-white">
                    <h4 className="text-sm font-black tracking-wider uppercase">CAPITAL ACCOUNTING (CP)</h4>
                  </div>

                  {/* Form Items */}
                  <div className="p-5 space-y-5 flex-1">
                    {/* 1A. Opening Capital */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between bg-blue-50/70 p-3 rounded-xl border border-blue-200 gap-2">
                      <span className="font-extrabold text-xs text-blue-950">1A. Opening Capital</span>
                      <div className="flex items-center gap-1.5 w-full sm:w-auto">
                        {renderSignButtons(openingCapital, setOpeningCapital, 'blue')}
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="0.00"
                          value={openingCapital}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === '' || val === '-' || /^-?\d*\.?\d*$/.test(val)) {
                              setOpeningCapital(val);
                            }
                          }}
                          className={`w-full sm:w-36 bg-white border rounded-lg px-3 py-1.5 text-right font-mono text-xs font-bold focus:ring-2 focus:outline-none ${
                            String(openingCapital ?? '').trim().startsWith('-') || (Number(openingCapital) || 0) < 0
                              ? 'text-rose-600 border-rose-300 focus:ring-rose-500'
                              : 'text-slate-900 border-blue-300 focus:ring-blue-500'
                          }`}
                        />
                      </div>
                    </div>

                    {/* Capital Transactions */}
                    <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                      <span className="text-xs font-black text-blue-950 uppercase tracking-wider block">Capital Transactions</span>

                      <div className="flex justify-between items-center p-3 bg-white rounded-lg border border-slate-200">
                        <span className="text-xs font-extrabold text-slate-700">4. Loans Issued (+)</span>
                        <span className="font-mono font-bold text-xs text-rose-600">LKR {effectiveLoansIssued.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                      </div>

                      <div className="flex justify-between items-center p-3 bg-white rounded-lg border border-slate-200">
                        <span className="text-xs font-extrabold text-slate-700">5. Redeems (-)</span>
                        <span className="font-mono font-bold text-xs text-emerald-600">LKR {effectiveRedemptions.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                      </div>
                    </div>
                  </div>

                  {/* Closing Capital Result Card (Bottom) */}
                  <div className="p-5 bg-blue-50 border-t-2 border-blue-500/40 space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-black text-blue-950 uppercase tracking-wider">CP Balance (Closing Capital)</span>
                      <span className="text-xl font-black font-mono text-blue-950">LKR {calculatedClosingCapital.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                    </div>

                    <div className="pt-2 border-t border-blue-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-700">Closing CP Entered:</span>
                      <div className="flex items-center gap-1.5 w-full sm:w-auto">
                        {renderSignButtons(cpBalance, setCpBalance, 'blue')}
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="0.00"
                          value={cpBalance}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === '' || val === '-' || /^-?\d*\.?\d*$/.test(val)) {
                              setCpBalance(val);
                            }
                          }}
                          className={`w-full sm:w-36 bg-white border-2 rounded-xl px-3 py-1.5 text-right font-mono font-bold text-xs focus:outline-none focus:ring-2 ${
                            String(cpBalance ?? '').trim().startsWith('-') || (Number(cpBalance) || 0) < 0
                              ? 'text-rose-600 border-rose-300 focus:ring-rose-500'
                              : 'text-blue-900 border-blue-400 focus:ring-blue-500'
                          }`}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Warning Alerts & Save Button */}
              <div className="pt-3 space-y-3">
                {userClosingBalance !== '' && Math.abs((Number(userClosingBalance) || 0) - calculatedClosingCash) > 0.01 && (
                  <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
                    <div className="flex items-start gap-2 text-rose-800">
                      <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-rose-600" />
                      <div>
                        <p className="font-black text-sm">Cash Mismatch Warning (Variance: Rs. {Number((Number(userClosingBalance) || 0) - calculatedClosingCash).toLocaleString()})</p>
                        <p className="text-xs font-semibold opacity-90 mt-0.5">Your entered Closing Cash (Rs. {Number(userClosingBalance || 0).toLocaleString()}) does not match the transactions formula (Rs. {calculatedClosingCash.toLocaleString()}).</p>
                      </div>
                    </div>
                    <Button 
                      onClick={() => setUserClosingBalance(calculatedClosingCash.toString())}
                      variant="outline" 
                      size="sm" 
                      className="shrink-0 bg-white border-rose-300 text-rose-700 hover:bg-rose-100 font-bold"
                    >
                      <Calculator className="w-4 h-4 mr-1.5" />
                      Auto-Fill Cash (Rs. {calculatedClosingCash.toLocaleString()})
                    </Button>
                  </div>
                )}

                {cpBalance !== '' && Math.abs((Number(cpBalance) || 0) - calculatedClosingCapital) > 0.01 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
                    <div className="flex items-start gap-2 text-amber-900">
                      <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" />
                      <div>
                        <p className="font-black text-sm">Capital (CP) Mismatch Warning (Variance: Rs. {Number((Number(cpBalance) || 0) - calculatedClosingCapital).toLocaleString()})</p>
                        <p className="text-xs font-semibold opacity-90 mt-0.5">Your entered CP Balance (Rs. {Number(cpBalance || 0).toLocaleString()}) does not match the Capital formula (Rs. {calculatedClosingCapital.toLocaleString()}).</p>
                      </div>
                    </div>
                    <Button 
                      onClick={() => setCpBalance(calculatedClosingCapital.toString())}
                      variant="outline" 
                      size="sm" 
                      className="shrink-0 bg-white border-amber-300 text-amber-800 hover:bg-amber-100 font-bold"
                    >
                      <Calculator className="w-4 h-4 mr-1.5" />
                      Auto-Fill Capital (Rs. {calculatedClosingCapital.toLocaleString()})
                    </Button>
                  </div>
                )}
                
                <Button
                  onClick={handleSaveLedger}
                  disabled={savingLedger || loadingLedger}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold h-12 text-sm gap-2 rounded-xl shadow-xs"
                >
                  <Save className="w-5 h-5" />
                  {savingLedger ? 'Saving Ledger...' : 'Update & Save Ledger for ' + ledgerDate}
                </Button>
              </div>
            </div>

            {/* Itemized Expenses Card */}
            <div className="w-full bg-white border border-slate-200 p-5 rounded-xl shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <h3 className="text-base font-black text-slate-900">Itemized Expenses (දිනපතා වියදම්)</h3>
                <Button onClick={handleAddExpenseRow} variant="outline" size="sm" className="h-8 text-xs font-bold border-blue-300 text-blue-700">
                  + Add Expense Line
                </Button>
              </div>

              {expenses.length === 0 ? (
                <div className="p-6 border border-dashed border-slate-300 rounded-xl text-center bg-slate-50/50">
                  <p className="text-xs text-slate-400 font-medium">No expenses added yet. Click &quot;+ Add Expense Line&quot; to list tea, stationary, cleaning items.</p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {expenses.map((exp, idx) => (
                    <div key={exp.id || idx} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                      <input
                        type="text"
                        placeholder="Expense description (Tea, Stationary)"
                        value={exp.description}
                        onChange={(e) => handleUpdateExpenseRow(idx, 'description', e.target.value)}
                        className="flex-1 bg-white border border-slate-300 rounded px-3 py-1.5 text-xs font-bold text-slate-900"
                      />
                      <div className="flex items-center gap-1 w-full sm:w-auto">
                        {renderSignButtons(exp.amount, (v) => handleUpdateExpenseRow(idx, 'amount', v), 'rose')}
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="Amount"
                          value={exp.amount}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === '' || val === '-' || /^-?\d*\.?\d*$/.test(val)) {
                              handleUpdateExpenseRow(idx, 'amount', val);
                            }
                          }}
                          className={`w-full sm:w-36 bg-white border rounded px-3 py-1.5 text-xs font-mono font-bold text-right focus:ring-2 focus:outline-none ${
                            String(exp.amount ?? '').trim().startsWith('-') || (Number(exp.amount) || 0) < 0
                              ? 'text-rose-600 border-rose-300 focus:ring-rose-500'
                              : 'text-rose-700 border-slate-300 focus:ring-rose-500'
                          }`}
                        />
                      </div>
                      <button onClick={() => handleRemoveExpenseRow(idx)} className="text-rose-600 hover:bg-rose-100 p-1.5 rounded self-end sm:self-auto">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  <div className="flex justify-end pt-2 text-xs font-bold text-slate-800 font-mono">
                    Total Expenses: LKR {totalExpensesSum.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </div>
                </div>
              )}
            </div>

          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* TAB 2: 11-BRANCH MATRIX                    */}
      {/* ========================================== */}
      {activeTab === 'matrix' && (
        <div className="w-full space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white border border-slate-200 p-5 rounded-xl shadow-sm flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Total Days Entered ({selectedYear})</p>
                <p className="text-3xl font-black text-slate-800 mt-1">{grandTotalEntered} Days</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
                <CheckCircle2 className="w-6 h-6" />
              </div>
            </div>

            <div className="bg-white border border-slate-200 p-5 rounded-xl shadow-sm flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Flagged Mismatch Days</p>
                <p className={`text-3xl font-black mt-1 ${grandTotalFlagged > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                  {grandTotalFlagged} Days
                </p>
              </div>
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center border ${
                grandTotalFlagged > 0 ? 'bg-rose-50 border-rose-200 text-rose-600' : 'bg-emerald-50 border-emerald-200 text-emerald-600'
              }`}>
                <AlertTriangle className="w-6 h-6" />
              </div>
            </div>

            <div className="bg-white border border-slate-200 p-5 rounded-xl shadow-sm flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Active Branches Tracked</p>
                <p className="text-3xl font-black text-slate-800 mt-1">{matrixBranches.length} Branches</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
                <Building2 className="w-6 h-6" />
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm w-full">
            <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <h2 className="text-lg font-black text-slate-800 flex items-center gap-2">
                <Layers className="w-5 h-5 text-blue-600" />
                Completion Progress Matrix ({selectedYear})
              </h2>
              <div className="flex items-center gap-3">
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(e.target.value)}
                  className="bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-slate-900 font-bold text-xs"
                >
                  <option value="2024">Year 2024</option>
                  <option value="2025">Year 2025</option>
                  <option value="2026">Year 2026</option>
                </select>
                <Button
                  onClick={fetchMatrix}
                  disabled={loadingMatrix}
                  variant="outline"
                  size="sm"
                  className="h-8 px-3"
                >
                  <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loadingMatrix ? 'animate-spin' : ''}`} /> Refresh
                </Button>
              </div>
            </div>

            {loadingMatrix ? (
              <div className="p-12 text-center text-slate-500 font-bold animate-pulse">
                Loading 11 Branches Matrix...
              </div>
            ) : matrixError ? (
              <div className="p-8 bg-rose-50 text-rose-800 text-sm font-semibold text-center">
                {matrixError}
              </div>
            ) : (
              <div className="overflow-x-auto w-full">
                <table className="w-full text-left border-collapse text-xs min-w-[800px]">
                  <thead>
                    <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                      <th className="py-3 px-4 sticky left-0 bg-slate-100 min-w-[140px] z-10">Branch</th>
                      {MONTH_NAMES.map((m, idx) => (
                        <th key={idx} className="py-3 px-3 text-center min-w-[70px]">{m}</th>
                      ))}
                      <th className="py-3 px-4 text-right min-w-[90px]">Total Days</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {matrixBranches.map((b) => {
                      const item = matrixData[b.id];
                      return (
                        <tr key={b.id} className="hover:bg-slate-50/80 transition">
                          <td 
                            className="py-3 px-4 font-black text-slate-800 sticky left-0 bg-white z-10 flex items-center justify-between cursor-pointer hover:bg-slate-100 transition"
                            onClick={() => handleOpenMonthsModal(b)}
                          >
                            <span className="group-hover:text-blue-600 transition-colors underline decoration-blue-300 decoration-dotted underline-offset-4">{b.name}</span>
                            <span className="text-[10px] text-slate-400 font-mono bg-slate-100 px-1.5 py-0.5 rounded">({b.id})</span>
                          </td>

                          {MONTH_NAMES.map((_, mIdx) => {
                            const mKey = `${selectedYear}-${String(mIdx + 1).padStart(2, '0')}`;
                            const mData = item?.months?.[mKey];
                            const count = mData?.entered_count || 0;
                            const flagged = mData?.flagged_count || 0;

                            let badgeColor = 'bg-slate-100 text-slate-500 border-slate-200';
                            if (count >= 25) {
                              badgeColor = 'bg-emerald-100 text-emerald-800 border-emerald-300 font-bold';
                            } else if (count > 0) {
                              badgeColor = 'bg-amber-100 text-amber-800 border-amber-300 font-bold';
                            }

                            return (
                              <td key={mIdx} className="py-3 px-2 text-center">
                                <button
                                  onClick={() => handleOpenBranchLedgers(b, mKey)}
                                  className={`inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs transition hover:scale-105 ${badgeColor}`}
                                >
                                  <span>{count}</span>
                                  {flagged > 0 && (
                                    <AlertTriangle className="w-3 h-3 text-rose-600 shrink-0" />
                                  )}
                                </button>
                              </td>
                            );
                          })}

                          <td className="py-3 px-4 text-right font-mono font-black text-blue-600">
                            {item?.total_entered || 0}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Matrix Branch Ledgers Modal */}
          {matrixBranchModalOpen && selectedMatrixBranch && (
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh]">
                <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
                      <Building2 className="w-5 h-5 text-blue-600" />
                      {selectedMatrixBranch.name} ({selectedMatrixBranch.id})
                    </h3>
                    <p className="text-sm text-slate-500 font-medium">
                      Ledgers for {selectedMatrixMonth}
                    </p>
                  </div>
                  <button 
                    onClick={() => setMatrixBranchModalOpen(false)}
                    className="p-2 hover:bg-slate-200 rounded-lg text-slate-500 transition"
                  >
                    <Trash2 className="w-5 h-5 rotate-45" style={{ display: 'none' }} />
                    <span className="font-bold text-xl leading-none">×</span>
                  </button>
                </div>
                
                <div className="p-6 overflow-y-auto flex-1 bg-slate-50/50">
                  {loadingMatrixLedgers ? (
                    <div className="flex flex-col items-center justify-center py-12 text-slate-500">
                      <RefreshCw className="w-8 h-8 animate-spin text-blue-600 mb-4" />
                      <p className="font-bold">Loading ledgers for {selectedMatrixBranch.name}...</p>
                    </div>
                  ) : matrixBranchLedgers.length === 0 ? (
                    <div className="text-center py-12 bg-white border border-dashed border-slate-300 rounded-xl">
                      <p className="text-slate-500 font-bold">No ledgers found for {selectedMatrixMonth}.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {matrixBranchLedgers.map((ledger) => (
                        <div key={ledger.id} className="flex items-center justify-between p-4 bg-white border border-slate-200 rounded-xl shadow-sm hover:border-blue-300 transition-colors">
                          <div>
                            <div className="flex items-center gap-3 mb-1">
                              <span className="font-mono font-black text-slate-900 text-lg">
                                {ledger.ledger_date}
                              </span>
                              <span className={`px-2 py-0.5 rounded text-xs font-bold flex items-center gap-1 ${
                                ledger.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-800' :
                                ledger.status === 'FLAGGED' ? 'bg-rose-100 text-rose-800' :
                                'bg-amber-100 text-amber-800'
                              }`}>
                                {ledger.status} {ledger.status === 'FLAGGED' && ledger.is_flag_ignored && '(IGNORED)'}
                                {ledger.status === 'FLAGGED' && (
                                  <span 
                                    className="cursor-help bg-rose-200 text-rose-900 rounded-full px-1.5 py-0.5 text-[10px] ml-1" 
                                    title={`Reason: Mathematical mismatch between Calculated Closing Balance and User Entered Closing Balance. Variance: Rs. ${Number(ledger.variance).toLocaleString()}`}
                                  >
                                    !?
                                  </span>
                                )}
                              </span>
                            </div>
                            <div className="flex items-center gap-4 text-xs font-bold text-slate-500">
                              <span>CP: {Number(ledger.cp_balance).toLocaleString()}</span>
                              <span>Staff: {ledger.staff_shift?.split(',').length || 0} users</span>
                              {Number(ledger.variance) !== 0 && (
                                <span className="text-rose-600">Var: {Number(ledger.variance).toLocaleString()}</span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button 
                              onClick={() => handleEditLedgerFromMatrix(ledger.ledger_date, ledger.branch_id)}
                              variant="outline"
                              size="sm"
                              className="bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-600 hover:text-white"
                            >
                              Edit Data
                            </Button>
                            <Button 
                              onClick={() => handleDeleteLedger(ledger.id, ledger.ledger_date)}
                              variant="outline"
                              size="sm"
                              className="bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-600 hover:text-white"
                            >
                              Delete
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                
                <div className="p-4 border-t border-slate-200 bg-white flex justify-end">
                  <Button onClick={() => setMatrixBranchModalOpen(false)} variant="outline" className="font-bold">
                    Close Window
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* New Months Modal */}
          {monthsModalOpen && selectedMonthsBranch && (
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[85vh]">
                <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
                      <Building2 className="w-5 h-5 text-blue-600" />
                      {selectedMonthsBranch.name} ({selectedMonthsBranch.id})
                    </h3>
                    <p className="text-sm text-slate-500 font-medium">
                      Monthly Summaries for {selectedYear}
                    </p>
                  </div>
                  <button 
                    onClick={() => setMonthsModalOpen(false)}
                    className="p-2 hover:bg-slate-200 rounded-lg text-slate-500 transition"
                  >
                    <span className="font-bold text-xl leading-none">×</span>
                  </button>
                </div>
                
                <div className="p-6 overflow-y-auto flex-1 bg-slate-50/50">
                  {loadingBranchLedgers ? (
                    <div className="flex flex-col items-center justify-center py-12 text-slate-500">
                      <RefreshCw className="w-8 h-8 animate-spin text-blue-600 mb-4" />
                      <p className="font-bold">Loading ledgers...</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {MONTH_NAMES.map((mName, mIdx) => {
                        const mKey = `${selectedYear}-${String(mIdx + 1).padStart(2, '0')}`;
                        const isExpanded = expandedMonth === mKey;
                        const monthLedgers = branchAllLedgers.filter(l => l.ledger_date.startsWith(mKey)).sort((a, b) => a.ledger_date.localeCompare(b.ledger_date));
                        const hasLedgers = monthLedgers.length > 0;
                        const flaggedLedgers = monthLedgers.filter(l => (l.status === 'FLAGGED' || Math.abs(Number(l.variance || 0)) > 0.01) && !l.is_flag_ignored);

                        let openingBalance = 0;
                        let closingBalance = 0;
                        if (hasLedgers) {
                          openingBalance = Number(monthLedgers[0].opening_balance || monthLedgers[0].cp_balance || 0); // fallback to cp if opening not there
                          closingBalance = Number(monthLedgers[monthLedgers.length - 1].cp_balance || 0);
                        }

                        return (
                          <div key={mKey} className={`bg-white border rounded-xl shadow-sm overflow-hidden transition-all ${isExpanded ? 'border-blue-400 ring-1 ring-blue-400' : 'border-slate-200 hover:border-blue-300'}`}>
                            <div 
                              className={`p-4 flex items-center justify-between cursor-pointer ${isExpanded ? 'bg-blue-50/50' : 'bg-white'}`}
                              onClick={() => setExpandedMonth(isExpanded ? null : mKey)}
                            >
                              <div className="flex items-center gap-3">
                                <span className="font-black text-slate-800 text-lg w-28">{mName}</span>
                                <span className="text-sm font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded">
                                  {monthLedgers.length} Days
                                </span>
                                {flaggedLedgers.length > 0 && (
                                  <span className="text-sm font-bold text-rose-700 bg-rose-100 px-2 py-1 rounded flex items-center gap-1">
                                    <AlertTriangle className="w-4 h-4" />
                                    {flaggedLedgers.length} Flagged
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-4 text-sm font-bold">
                                {hasLedgers ? (
                                  <span className="text-slate-500">Closing: <span className="text-slate-800">{closingBalance.toLocaleString()}</span></span>
                                ) : (
                                  <span className="text-slate-400 italic">No Data</span>
                                )}
                              </div>
                            </div>

                            {isExpanded && hasLedgers && (
                              <div className="p-4 border-t border-slate-200 bg-slate-50/80 space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                  <div className="bg-white p-3 rounded-lg border border-slate-200">
                                    <p className="text-xs font-bold text-slate-500 mb-1">Month Opening Balance</p>
                                    <p className="text-lg font-black text-slate-800">{openingBalance.toLocaleString()}</p>
                                  </div>
                                  <div className="bg-white p-3 rounded-lg border border-slate-200">
                                    <p className="text-xs font-bold text-slate-500 mb-1">Month Closing Balance</p>
                                    <p className="text-lg font-black text-slate-800">{closingBalance.toLocaleString()}</p>
                                  </div>
                                </div>

                                {flaggedLedgers.length > 0 && (
                                  <div className="bg-rose-50/50 border border-rose-200 rounded-lg p-3 space-y-2">
                                    <p className="text-sm font-black text-rose-800 flex items-center gap-2">
                                      <AlertTriangle className="w-4 h-4" />
                                      Flagged Days Require Attention
                                    </p>
                                    <div className="space-y-2">
                                      {flaggedLedgers.map(fl => (
                                        <div key={fl.id} className="flex items-center justify-between bg-white p-2 rounded border border-rose-100">
                                          <div className="flex items-center gap-3">
                                            <span className="font-bold text-slate-800">{fl.ledger_date}</span>
                                            <span className="text-xs font-bold text-rose-600 flex items-center gap-1">
                                              Var: {Number(fl.variance).toLocaleString()}
                                              <span 
                                                className="cursor-help bg-rose-200 text-rose-900 rounded-full px-1.5 py-0.5 text-[10px]" 
                                                title={`Reason: Mathematical mismatch between Calculated Closing Balance and User Entered Closing Balance. Variance: Rs. ${Number(fl.variance).toLocaleString()}`}
                                              >
                                                !?
                                              </span>
                                            </span>
                                          </div>
                                          <div className="flex gap-2">
                                            <Button size="sm" variant="outline" className="h-7 text-xs bg-slate-100 hover:bg-slate-200" onClick={() => handleIgnoreFlag(fl.id)}>
                                              Ignore Flag
                                            </Button>
                                            <Button size="sm" className="h-7 text-xs bg-blue-600 hover:bg-blue-700 text-white" onClick={() => handleEditLedgerFromMatrix(fl.ledger_date, fl.branch_id)}>
                                              Edit Data
                                            </Button>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                
                <div className="p-4 border-t border-slate-200 bg-white flex justify-end">
                  <Button onClick={() => setMonthsModalOpen(false)} variant="outline" className="font-bold">
                    Close Window
                  </Button>
                </div>
              </div>
            </div>
          )}

        </div>
      )}

      {/* ========================================== */}
      {/* TAB 3: GENERAL JOURNAL LEDGER LOGS         */}
      {/* ========================================== */}
      {activeTab === 'journal' && (
        <div className="w-full space-y-6">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between bg-white p-6 rounded-xl shadow-sm border border-slate-200 gap-4 text-slate-800 w-full">
            <div>
              <h2 className="text-2xl font-black text-slate-800 tracking-tight">General Ledger</h2>
              <p className="text-sm text-slate-500 font-medium mt-1">Record and view strict double-entry journal logs.</p>
            </div>
          </div>

          <div className="space-y-6 w-full">
            {loadingJournal ? (
               <p className="text-center font-bold text-slate-400">Loading ledger logs...</p>
            ) : journalEntries.length === 0 ? (
               <p className="text-center font-bold text-slate-400">No journal entries found.</p>
            ) : journalEntries.map((entry) => (
              <div key={entry.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm text-slate-800 w-full">
                <div className="px-6 py-4 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
                   <div>
                      <div className="flex items-center gap-3">
                         <span className="text-xs font-black bg-slate-200 text-slate-700 px-2 py-0.5 rounded uppercase">{entry.id}</span>
                         <span className="text-xs font-bold text-slate-500">{new Date(entry.date).toLocaleDateString()}</span>
                      </div>
                      <p className="text-sm font-semibold text-slate-800 mt-2">{entry.description}</p>
                   </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Saved Success Modal (Visible on any tab) */}
      {showSavedPopup && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden flex flex-col items-center text-center p-6">
            <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mb-4 animate-bounce">
              <CheckCircle2 className="w-10 h-10" />
            </div>
            <h3 className="text-xl font-black text-slate-900 mb-2">Saved Done!</h3>
            <p className="text-sm text-slate-500 font-medium mb-6">
              Ledger data for <span className="font-bold text-slate-800">{selectedBranch}</span> on <span className="font-bold text-slate-800">{ledgerDate}</span> has been successfully saved to the database.
            </p>
            <Button 
              onClick={() => {
                setShowSavedPopup(false);
              }}
              className="w-full font-bold bg-emerald-600 hover:bg-emerald-700 text-white h-12 text-lg"
            >
              OK
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function LedgerPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-500">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          <p className="font-bold text-sm text-slate-700">Loading Daily Transaction Ledger...</p>
        </div>
      </div>
    }>
      <MainLedgerContent />
    </Suspense>
  );
}
