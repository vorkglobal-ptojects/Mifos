'use client';

import React, { useState, useEffect, useMemo, useTransition } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { 
  Search, Calendar, Filter, User, Building, Clock, 
  RefreshCw, FileText, ArrowUpDown, ChevronDown, CheckCircle2,
  DollarSign, Hash, AlertCircle, X, Shield, Sparkles
} from 'lucide-react';
import { getAuthHeaders } from '@/lib/getAuthHeaders';
import { toast } from 'sonner';

export interface EntryHistoryItem {
  id: string;
  bill_no: string;
  branch_id: string;
  appraised_value: number;
  disbursed_amount: number;
  status: string;
  description: string;
  created_at: string;
  created_by_user_id: string;
  entered_by_name: string;
  entered_by_email: string;
  entered_by_display: string;
  client_id: string;
  period_months: number;
  interest_rate: number;
  weight_grams: number;
  weight_mg: number;
  unique_tag?: string;
  customer?: {
    id: string;
    national_id: string;
    first_name: string;
    last_name: string;
    name: string;
    phone: string;
    address: string;
  };
}

interface EntryHistoryModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  currentBranchId?: string;
  userRole?: string;
}

export function EntryHistoryModal({
  isOpen,
  onOpenChange,
  currentBranchId = '',
  userRole = 'TELLER',
}: EntryHistoryModalProps) {
  const [entries, setEntries] = useState<EntryHistoryItem[]>([]);
  const [availableBranches, setAvailableBranches] = useState<string[]>([]);
  const [availableUsers, setAvailableUsers] = useState<Array<{ id: string; name: string; email: string; display: string }>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Quick preset: 'TODAY' | 'YESTERDAY' | 'THIS_MONTH' | 'ALL' | 'CUSTOM'
  const [datePreset, setDatePreset] = useState<'TODAY' | 'YESTERDAY' | 'THIS_MONTH' | 'ALL' | 'CUSTOM'>('TODAY');

  // Filters
  const [selectedBranch, setSelectedBranch] = useState<string>('ALL');
  const [selectedUser, setSelectedUser] = useState<string>('ALL');
  const [dateInput, setDateInput] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [selectedYear, setSelectedYear] = useState<string>('');
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Selected entry for inspection details modal/panel
  const [selectedItem, setSelectedItem] = useState<EntryHistoryItem | null>(null);

  const isHQOrAdmin = !currentBranchId || 
    currentBranchId.toUpperCase().includes('HQ') || 
    currentBranchId.toUpperCase().includes('HEAD OFFICE') || 
    userRole === 'ADMIN' || 
    userRole === 'AUDITOR';

  // Helper date generators
  const getTodayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const getYesterdayStr = () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const fetchHistory = async () => {
    if (!isOpen) return;
    setIsLoading(true);
    setErrorMsg(null);

    try {
      const headers = await getAuthHeaders();
      const params = new URLSearchParams();

      if (selectedBranch && selectedBranch !== 'ALL') {
        params.set('branch', selectedBranch);
      }

      // Handle date filters according to preset
      if (datePreset === 'TODAY') {
        params.set('date', getTodayStr());
      } else if (datePreset === 'YESTERDAY') {
        params.set('date', getYesterdayStr());
      } else if (datePreset === 'THIS_MONTH') {
        const d = new Date();
        params.set('year', String(d.getFullYear()));
        params.set('month', String(d.getMonth() + 1).padStart(2, '0'));
      } else if (datePreset === 'CUSTOM') {
        if (dateInput) params.set('date', dateInput);
        if (selectedYear) params.set('year', selectedYear);
        if (selectedMonth) params.set('month', selectedMonth);
      }

      if (selectedUser && selectedUser !== 'ALL') {
        params.set('enteredBy', selectedUser);
      }

      if (searchQuery.trim()) {
        params.set('search', searchQuery.trim());
      }

      const res = await fetch(`/api/entry-history?${params.toString()}`, {
        headers,
        cache: 'no-store'
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP error ${res.status}`);
      }

      const data = await res.json();
      setEntries(data.entries || []);
      setAvailableBranches(data.meta?.branches || []);
      setAvailableUsers(data.meta?.users || []);
    } catch (err: any) {
      console.error('Failed to load entry history:', err);
      setErrorMsg(err.message || 'Failed to fetch entries');
      toast.error(`Entry History Error: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchHistory();
    } else {
      setSelectedItem(null);
    }
  }, [isOpen, datePreset, selectedBranch, selectedUser, dateInput, selectedYear, selectedMonth]);

  // Handle Search on Enter or debounced
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchHistory();
  };

  // Preset switch
  const handlePresetChange = (preset: typeof datePreset) => {
    setDatePreset(preset);
    if (preset === 'TODAY') {
      setDateInput(getTodayStr());
      setSelectedYear('');
      setSelectedMonth('');
    } else if (preset === 'YESTERDAY') {
      setDateInput(getYesterdayStr());
      setSelectedYear('');
      setSelectedMonth('');
    } else if (preset === 'THIS_MONTH') {
      const d = new Date();
      setDateInput('');
      setSelectedYear(String(d.getFullYear()));
      setSelectedMonth(String(d.getMonth() + 1).padStart(2, '0'));
    } else if (preset === 'ALL') {
      setDateInput('');
      setSelectedYear('');
      setSelectedMonth('');
    }
  };

  // Metrics
  const summaryMetrics = useMemo(() => {
    const totalCount = entries.length;
    const totalDisbursed = entries.reduce((sum, item) => sum + (Number(item.disbursed_amount) || 0), 0);
    const totalAppraised = entries.reduce((sum, item) => sum + (Number(item.appraised_value) || 0), 0);
    const totalGoldWeight = entries.reduce((sum, item) => sum + (Number(item.weight_grams) || 0), 0);
    return { totalCount, totalDisbursed, totalAppraised, totalGoldWeight };
  }, [entries]);

  // Year options: current year down 5 years
  const currentYearNum = new Date().getFullYear();
  const yearOptions = [currentYearNum, currentYearNum - 1, currentYearNum - 2, currentYearNum - 3];

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl w-[95vw] h-[92vh] max-h-[92vh] flex flex-col p-0 overflow-hidden bg-slate-50 border-slate-200 text-slate-800 shadow-2xl rounded-2xl">
        {/* Header Bar */}
        <DialogHeader className="px-6 py-4 bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 text-white shrink-0 border-b border-slate-700">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-amber-400 text-slate-950 rounded-xl shadow-md">
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <DialogTitle className="text-xl font-black tracking-tight text-white flex items-center gap-2">
                    Daily Entry & Audit History
                    <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-amber-400/20 text-amber-300 border border-amber-400/30">
                      Live Pawning Register
                    </span>
                  </DialogTitle>
                  <DialogDescription className="text-slate-300 text-xs mt-0.5">
                    View real-time entries made today or historical pawns. Filter by branch, staff, date, and customer details.
                  </DialogDescription>
                </div>
              </div>
            </div>

            {/* Quick Stats Pill */}
            <div className="flex items-center gap-2 bg-white/10 backdrop-blur-md px-4 py-2 rounded-xl border border-white/15 text-xs text-white">
              <div className="text-right">
                <div className="text-[10px] text-slate-300 font-bold uppercase tracking-wider">Entries Found</div>
                <div className="font-extrabold text-base text-amber-300">{summaryMetrics.totalCount}</div>
              </div>
              <div className="h-6 w-px bg-white/20 mx-1" />
              <div className="text-right">
                <div className="text-[10px] text-slate-300 font-bold uppercase tracking-wider">Total Disbursed</div>
                <div className="font-extrabold text-base text-emerald-400">
                  LKR {summaryMetrics.totalDisbursed.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={fetchHistory}
                disabled={isLoading}
                className="ml-2 h-8 w-8 p-0 text-white hover:bg-white/20 rounded-lg"
                title="Refresh entries"
              >
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-amber-400' : ''}`} />
              </Button>
            </div>
          </div>
        </DialogHeader>

        {/* Filter Controls Toolbar */}
        <div className="px-6 py-3.5 bg-white border-b border-slate-200/80 shadow-xs shrink-0 flex flex-col gap-3">
          {/* Top row: Presets + Search */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Date Preset Buttons */}
            <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl border border-slate-200">
              <button
                type="button"
                onClick={() => handlePresetChange('TODAY')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  datePreset === 'TODAY' 
                    ? 'bg-amber-400 text-slate-900 shadow-sm font-extrabold' 
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
                }`}
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => handlePresetChange('YESTERDAY')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  datePreset === 'YESTERDAY' 
                    ? 'bg-amber-400 text-slate-900 shadow-sm font-extrabold' 
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
                }`}
              >
                Yesterday
              </button>
              <button
                type="button"
                onClick={() => handlePresetChange('THIS_MONTH')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  datePreset === 'THIS_MONTH' 
                    ? 'bg-amber-400 text-slate-900 shadow-sm font-extrabold' 
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
                }`}
              >
                This Month
              </button>
              <button
                type="button"
                onClick={() => handlePresetChange('ALL')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  datePreset === 'ALL' 
                    ? 'bg-amber-400 text-slate-900 shadow-sm font-extrabold' 
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
                }`}
              >
                All Dates
              </button>
              <button
                type="button"
                onClick={() => handlePresetChange('CUSTOM')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  datePreset === 'CUSTOM' 
                    ? 'bg-amber-400 text-slate-900 shadow-sm font-extrabold' 
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
                }`}
              >
                Custom Filter
              </button>
            </div>

            {/* Quick Text Search */}
            <form onSubmit={handleSearchSubmit} className="relative flex-1 min-w-[240px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search Bill #, Customer Name, NIC, Phone..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-20 h-9 text-xs rounded-xl border-slate-300 focus:border-amber-400 focus:ring-amber-400 bg-slate-50/70"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => { setSearchQuery(''); fetchHistory(); }}
                  className="absolute right-12 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
              <Button
                type="submit"
                size="sm"
                className="absolute right-1 top-1 bottom-1 h-7 px-2.5 text-[11px] font-bold bg-slate-900 hover:bg-slate-800 text-white rounded-lg"
              >
                Find
              </Button>
            </form>
          </div>

          {/* Bottom row: Branch, Staff, and Custom Date Pickers */}
          <div className="flex flex-wrap items-center gap-2.5 text-xs">
            {/* Branch Selector (Admins / HQ can switch branch) */}
            <div className="flex items-center gap-1.5 bg-slate-100/80 px-2.5 py-1 rounded-xl border border-slate-200">
              <Building className="w-3.5 h-3.5 text-slate-500" />
              <span className="font-semibold text-slate-600 text-[11px]">Branch:</span>
              {isHQOrAdmin ? (
                <select
                  value={selectedBranch}
                  onChange={(e) => setSelectedBranch(e.target.value)}
                  className="bg-transparent font-bold text-slate-900 text-xs border-0 outline-none cursor-pointer pr-1"
                >
                  <option value="ALL">All Branches</option>
                  {availableBranches.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              ) : (
                <span className="font-bold text-slate-900 text-xs uppercase">
                  {currentBranchId || 'Assigned Branch'}
                </span>
              )}
            </div>

            {/* Entered By (Staff) Selector */}
            <div className="flex items-center gap-1.5 bg-slate-100/80 px-2.5 py-1 rounded-xl border border-slate-200">
              <User className="w-3.5 h-3.5 text-slate-500" />
              <span className="font-semibold text-slate-600 text-[11px]">Entered By:</span>
              <select
                value={selectedUser}
                onChange={(e) => setSelectedUser(e.target.value)}
                className="bg-transparent font-bold text-slate-900 text-xs border-0 outline-none cursor-pointer pr-1 max-w-[160px]"
              >
                <option value="ALL">All Staff / Tellers</option>
                {availableUsers.map((u) => (
                  <option key={u.id} value={u.name || u.email}>{u.display}</option>
                ))}
              </select>
            </div>

            {/* Custom Date Filters - Only shown when CUSTOM preset is selected */}
            {datePreset === 'CUSTOM' && (
              <>
                <div className="flex items-center gap-1.5 bg-amber-50/80 px-2.5 py-1 rounded-xl border border-amber-200">
                  <Calendar className="w-3.5 h-3.5 text-amber-600" />
                  <span className="font-semibold text-amber-800 text-[11px]">Specific Date:</span>
                  <input
                    type="date"
                    value={dateInput}
                    onChange={(e) => setDateInput(e.target.value)}
                    className="bg-transparent font-bold text-slate-900 text-xs border-0 outline-none cursor-pointer"
                  />
                  {dateInput && (
                    <button
                      type="button"
                      onClick={() => setDateInput('')}
                      className="text-amber-700 hover:text-amber-900 ml-1"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1.5 bg-amber-50/80 px-2.5 py-1 rounded-xl border border-amber-200">
                  <span className="font-semibold text-amber-800 text-[11px]">Year:</span>
                  <select
                    value={selectedYear}
                    onChange={(e) => setSelectedYear(e.target.value)}
                    className="bg-transparent font-bold text-slate-900 text-xs border-0 outline-none cursor-pointer"
                  >
                    <option value="">Any Year</option>
                    {yearOptions.map((yr) => (
                      <option key={yr} value={String(yr)}>{yr}</option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-1.5 bg-amber-50/80 px-2.5 py-1 rounded-xl border border-amber-200">
                  <span className="font-semibold text-amber-800 text-[11px]">Month:</span>
                  <select
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                    className="bg-transparent font-bold text-slate-900 text-xs border-0 outline-none cursor-pointer"
                  >
                    <option value="">Any Month</option>
                    <option value="01">Jan (01)</option>
                    <option value="02">Feb (02)</option>
                    <option value="03">Mar (03)</option>
                    <option value="04">Apr (04)</option>
                    <option value="05">May (05)</option>
                    <option value="06">Jun (06)</option>
                    <option value="07">Jul (07)</option>
                    <option value="08">Aug (08)</option>
                    <option value="09">Sep (09)</option>
                    <option value="10">Oct (10)</option>
                    <option value="11">Nov (11)</option>
                    <option value="12">Dec (12)</option>
                  </select>
                </div>
              </>
            )}

            {/* Active Filter Clear */}
            {(selectedBranch !== 'ALL' || selectedUser !== 'ALL' || searchQuery || datePreset !== 'TODAY') && (
              <button
                type="button"
                onClick={() => {
                  setSelectedBranch('ALL');
                  setSelectedUser('ALL');
                  setSearchQuery('');
                  handlePresetChange('TODAY');
                }}
                className="text-xs font-bold text-rose-600 hover:text-rose-800 underline underline-offset-2 ml-auto"
              >
                Reset All Filters
              </button>
            )}
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-auto bg-slate-50/60 p-6">
          {isLoading ? (
            <div className="h-full flex flex-col items-center justify-center py-20 text-slate-400">
              <RefreshCw className="w-8 h-8 animate-spin text-amber-500 mb-3" />
              <p className="text-sm font-bold text-slate-700">Loading daily entries from database...</p>
              <p className="text-xs text-slate-400 mt-1">Cross-referencing staff user records & customer profiles</p>
            </div>
          ) : errorMsg ? (
            <div className="p-8 text-center bg-rose-50 border border-rose-200 rounded-2xl max-w-lg mx-auto my-12">
              <AlertCircle className="w-10 h-10 text-rose-500 mx-auto mb-3" />
              <h3 className="text-base font-bold text-rose-900">Failed to load entries</h3>
              <p className="text-xs text-rose-700 mt-1">{errorMsg}</p>
              <Button onClick={fetchHistory} size="sm" className="mt-4 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs">
                Retry
              </Button>
            </div>
          ) : entries.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center py-20 text-slate-400 text-center">
              <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-300 mb-4 border border-slate-200">
                <FileText className="w-8 h-8" />
              </div>
              <h4 className="text-base font-bold text-slate-800">No Entries Found</h4>
              <p className="text-xs text-slate-500 max-w-md mt-1">
                No pawning entries matched your selected branch, date range, or search criteria.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePresetChange('ALL')}
                className="mt-4 text-xs font-bold border-slate-300"
              >
                View All Available Dates
              </Button>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-100/80 border-b border-slate-200 text-[11px] uppercase tracking-wider font-extrabold text-slate-600">
                      <th className="py-3 px-4">Bill No</th>
                      <th className="py-3 px-4">Date & Time</th>
                      <th className="py-3 px-4">Branch</th>
                      <th className="py-3 px-4">Entered Person (Staff)</th>
                      <th className="py-3 px-4">Customer Details</th>
                      <th className="py-3 px-4">Article / Description</th>
                      <th className="py-3 px-4 text-right">Weight (g)</th>
                      <th className="py-3 px-4 text-right">Disbursed (LKR)</th>
                      <th className="py-3 px-4 text-center">Status</th>
                      <th className="py-3 px-4 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {entries.map((entry) => {
                      const entryDate = new Date(entry.created_at);
                      const dateStr = entryDate.toLocaleDateString('en-GB', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric'
                      });
                      const timeStr = entryDate.toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit'
                      });

                      const customerName = entry.customer?.name || 
                        (entry.customer?.first_name ? `${entry.customer.first_name} ${entry.customer.last_name || ''}`.trim() : 'Unknown Customer');
                      const customerNic = entry.customer?.national_id || 'N/A';
                      const customerPhone = entry.customer?.phone;

                      const isSelected = selectedItem?.id === entry.id;

                      return (
                        <tr
                          key={entry.id}
                          className={`hover:bg-amber-50/40 transition-colors ${isSelected ? 'bg-amber-100/50' : ''}`}
                        >
                          {/* Bill No */}
                          <td className="py-3 px-4 font-mono font-black text-slate-900">
                            <span className="px-2 py-1 rounded-md bg-slate-100 border border-slate-200 text-slate-800">
                              {entry.bill_no || 'NO_BILL'}
                            </span>
                          </td>

                          {/* Date & Time */}
                          <td className="py-3 px-4 whitespace-nowrap">
                            <div className="font-bold text-slate-800">{dateStr}</div>
                            <div className="text-[11px] text-slate-400 font-mono flex items-center gap-1 mt-0.5">
                              <Clock className="w-3 h-3 inline" /> {timeStr}
                            </div>
                          </td>

                          {/* Branch */}
                          <td className="py-3 px-4">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                              {entry.branch_id || 'HQ'}
                            </span>
                          </td>

                          {/* Entered Person */}
                          <td className="py-3 px-4">
                            <div className="font-bold text-slate-900 flex items-center gap-1.5">
                              <div className="w-5 h-5 rounded-full bg-slate-800 text-amber-300 font-black text-[10px] flex items-center justify-center shrink-0">
                                {entry.entered_by_name?.charAt(0).toUpperCase() || 'U'}
                              </div>
                              <span className="truncate max-w-[140px]" title={entry.entered_by_name}>
                                {entry.entered_by_name || 'Staff User'}
                              </span>
                            </div>
                            {entry.entered_by_email && (
                              <div className="text-[10px] text-slate-400 truncate max-w-[150px] pl-6" title={entry.entered_by_email}>
                                {entry.entered_by_email}
                              </div>
                            )}
                          </td>

                          {/* Customer Details */}
                          <td className="py-3 px-4">
                            <div className="font-bold text-slate-800">{customerName}</div>
                            <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                              NIC: <span className="font-bold text-slate-700">{customerNic}</span>
                              {customerPhone && <span className="ml-2 text-slate-400">({customerPhone})</span>}
                            </div>
                          </td>

                          {/* Description */}
                          <td className="py-3 px-4 max-w-[180px]">
                            <div className="truncate text-slate-700 font-medium" title={entry.description || ''}>
                              {entry.description || 'Pawn item'}
                            </div>
                            {entry.unique_tag && (
                              <div className="text-[10px] text-slate-400 font-mono">
                                Tag: {entry.unique_tag}
                              </div>
                            )}
                          </td>

                          {/* Weight */}
                          <td className="py-3 px-4 text-right font-mono font-bold text-slate-800">
                            {Number(entry.weight_grams || 0).toFixed(2)}g
                          </td>

                          {/* Disbursed Amount */}
                          <td className="py-3 px-4 text-right">
                            <div className="font-mono font-extrabold text-emerald-700">
                              LKR {Number(entry.disbursed_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </div>
                            {entry.appraised_value > entry.disbursed_amount && (
                              <div className="text-[10px] text-slate-400 font-mono">
                                Val: {Number(entry.appraised_value).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                              </div>
                            )}
                          </td>

                          {/* Status */}
                          <td className="py-3 px-4 text-center whitespace-nowrap">
                            <Badge
                              className={`text-[10px] font-extrabold px-2 py-0.5 uppercase tracking-wider ${
                                entry.status === 'ACTIVE'
                                  ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                  : entry.status === 'CLOSED' || entry.status === 'REDEEMED'
                                  ? 'bg-blue-100 text-blue-800 border-blue-300'
                                  : 'bg-amber-100 text-amber-800 border-amber-300'
                              }`}
                            >
                              {entry.status || 'ACTIVE'}
                            </Badge>
                          </td>

                          {/* Action Button */}
                          <td className="py-3 px-4 text-center">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setSelectedItem(selectedItem?.id === entry.id ? null : entry)}
                              className="h-7 px-2.5 text-[11px] font-bold text-indigo-600 hover:text-indigo-900 hover:bg-indigo-50 rounded-lg"
                            >
                              {selectedItem?.id === entry.id ? 'Close' : 'Details'}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Selected Item Drawer / Quick Details Popup */}
        {selectedItem && (
          <div className="px-6 py-4 bg-slate-900 text-white border-t border-slate-700 shrink-0 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
              <div>
                <span className="text-slate-400 text-[10px] font-bold uppercase tracking-wider">Bill Reference</span>
                <p className="font-mono font-black text-amber-300 text-sm">{selectedItem.bill_no}</p>
                <p className="text-[11px] text-slate-400">{selectedItem.branch_id} Branch</p>
              </div>
              <div>
                <span className="text-slate-400 text-[10px] font-bold uppercase tracking-wider">Entered By</span>
                <p className="font-bold text-white text-sm">{selectedItem.entered_by_name || 'Staff'}</p>
                <p className="text-[11px] text-slate-400">{selectedItem.entered_by_email || 'No email'}</p>
              </div>
              <div>
                <span className="text-slate-400 text-[10px] font-bold uppercase tracking-wider">Customer</span>
                <p className="font-bold text-white text-sm">{selectedItem.customer?.name || 'N/A'}</p>
                <p className="text-[11px] text-amber-200 font-mono">NIC: {selectedItem.customer?.national_id || 'N/A'}</p>
              </div>
              <div>
                <span className="text-slate-400 text-[10px] font-bold uppercase tracking-wider">Loan Value</span>
                <p className="font-mono font-black text-emerald-400 text-sm">
                  LKR {Number(selectedItem.disbursed_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </p>
                <p className="text-[11px] text-slate-400">
                  Weight: {selectedItem.weight_grams}g | Period: {selectedItem.period_months || 12} mo
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setSelectedItem(null)}
                className="h-8 text-xs font-bold border-slate-600 text-slate-300 hover:text-white hover:bg-slate-800"
              >
                Close Details
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

