'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  AlertTriangle, ShieldAlert, Send, RefreshCcw, Search, Download, 
  Phone, User, Calendar, Clock, DollarSign, CheckCircle2, 
  X, Check, AlertCircle, FileSpreadsheet, Smartphone, Gavel
} from 'lucide-react';
import { toast } from 'sonner';

export default function ForfeitureManagementPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Data states
  const [items, setItems] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>({
    total_at_risk_count: 0,
    total_principal_at_risk: 0,
    total_interest_due: 0,
    critical_overdue_count: 0,
    with_phone_count: 0
  });

  // Filter states
  const [filterBranch, setFilterBranch] = useState('ALL');
  const [filterSeverity, setFilterSeverity] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [phoneOnly, setPhoneOnly] = useState(false);

  // Selection states
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Modal states
  const [smsModalItem, setSmsModalItem] = useState<any | null>(null);
  const [bulkSmsModalOpen, setBulkSmsModalOpen] = useState(false);
  const [forfeitModalItem, setForfeitModalItem] = useState<any | null>(null);
  const [forfeitNotes, setForfeitNotes] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  // Verify Admin Role on Mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem('user');
      if (stored) {
        const u = JSON.parse(stored);
        setCurrentUser(u);
      }
    } catch (e) {
      console.error('Error loading stored user:', e);
    } finally {
      setAuthChecked(true);
    }
  }, []);

  const isAdmin = useMemo(() => {
    if (!currentUser) return false;
    const role = (currentUser.role || currentUser.user_metadata?.role || '').toUpperCase().trim();
    return role === 'ADMIN';
  }, [currentUser]);

  // Fetch Forfeiture Data
  const loadData = async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);

    try {
      const params = new URLSearchParams();
      if (filterBranch !== 'ALL') params.set('branch', filterBranch);
      if (filterSeverity !== 'ALL') params.set('severity', filterSeverity);
      if (searchQuery.trim()) params.set('search', searchQuery.trim());

      const res = await fetch(`/api/stock/forfeiture?${params.toString()}`);
      if (!res.ok) {
        if (res.status === 403) {
          toast.error('Access Denied: Only Administrators can view Forfeited Stock.');
          return;
        }
        throw new Error('Failed to load forfeiture items');
      }

      const data = await res.json();
      if (data.success) {
        setItems(data.items || []);
        setSummary(data.summary || {});
      } else {
        toast.error(data.error || 'Could not fetch forfeiture data');
      }
    } catch (err: any) {
      console.error('Load forfeiture error:', err);
      toast.error(err.message || 'Error connecting to server');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (authChecked && isAdmin) {
      loadData();
    }
  }, [authChecked, isAdmin, filterBranch, filterSeverity]);

  // Handle Search on Enter or filter change
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loadData();
  };

  // Filtered Items for Display
  const displayedItems = useMemo(() => {
    let result = items;
    if (phoneOnly) {
      result = result.filter(it => it.has_phone);
    }
    return result;
  }, [items, phoneOnly]);

  // Select / Deselect Logic
  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedIds(displayedItems.map(it => it.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleToggleSelect = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  // Single SMS Dispatch
  const handleSendSingleSms = async () => {
    if (!smsModalItem) return;
    setActionLoading(true);

    try {
      const res = await fetch('/api/stock/forfeiture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'SEND_SMS',
          itemId: smsModalItem.id,
          billNo: smsModalItem.bill_no,
          customerName: smsModalItem.customer_name,
          phone: smsModalItem.customer_phone,
          principal: smsModalItem.principal,
          interestDue: smsModalItem.outstanding_interest,
          expiryDate: smsModalItem.effective_expiry_date,
          branchId: smsModalItem.branch_id
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(`Warning SMS sent to ${smsModalItem.customer_phone}!`);
        setSmsModalItem(null);
        loadData(true);
      } else {
        toast.error(data.error || 'Failed to dispatch SMS');
      }
    } catch (err: any) {
      toast.error(err.message || 'Network error sending SMS');
    } finally {
      setActionLoading(false);
    }
  };

  // Bulk SMS Dispatch
  const handleSendBulkSms = async () => {
    const selectedItemObjs = items.filter(it => selectedIds.includes(it.id));
    if (selectedItemObjs.length === 0) return;

    setActionLoading(true);
    try {
      const payload = selectedItemObjs.map(it => ({
        itemId: it.id,
        billNo: it.bill_no,
        customerName: it.customer_name,
        phone: it.customer_phone,
        principal: it.principal,
        interestDue: it.outstanding_interest,
        expiryDate: it.effective_expiry_date,
        branchId: it.branch_id
      }));

      const res = await fetch('/api/stock/forfeiture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'BULK_SEND_SMS',
          items: payload
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(`Bulk SMS dispatched! Sent: ${data.sentCount}, Skipped (No phone): ${data.skippedNoPhone}`);
        setBulkSmsModalOpen(false);
        setSelectedIds([]);
        loadData(true);
      } else {
        toast.error(data.error || 'Bulk SMS dispatch failed');
      }
    } catch (err: any) {
      toast.error(err.message || 'Network error');
    } finally {
      setActionLoading(false);
    }
  };

  // Mark Item as Forfeited (Move to F/S Inventory)
  const handleConfirmForfeit = async () => {
    if (!forfeitModalItem) return;
    setActionLoading(true);

    try {
      const res = await fetch('/api/stock/forfeiture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'MARK_FORFEITED',
          itemId: forfeitModalItem.id,
          billNo: forfeitModalItem.bill_no,
          branchId: forfeitModalItem.branch_id,
          notes: forfeitNotes.trim() || `F/S (Forfeited Collateral moved to auction. Overdue: ${forfeitModalItem.days_overdue} days)`
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(data.message || 'Item marked as Forfeited (F/S)!');
        setForfeitModalItem(null);
        setForfeitNotes('');
        loadData(true);
      } else {
        toast.error(data.error || 'Failed to mark item as forfeited');
      }
    } catch (err: any) {
      toast.error(err.message || 'Network error');
    } finally {
      setActionLoading(false);
    }
  };

  // Export to CSV
  const exportToCSV = () => {
    if (displayedItems.length === 0) {
      toast.error('No items to export');
      return;
    }

    const headers = [
      'Bill No', 'Branch', 'Item Type', 'Weight (g)', 'Customer Name', 
      'Phone', 'NIC', 'Address', 'Pawn Date', 'Period (M)', 
      'Expiry Date', 'Days Overdue', 'Principal (LKR)', 
      'Due Interest (LKR)', 'Last Interest Date'
    ];

    const rows = displayedItems.map(it => [
      `"${it.bill_no || ''}"`,
      `"${it.branch_id || ''}"`,
      `"${it.item_type || ''}"`,
      it.weight_grams || 0,
      `"${(it.customer_name || '').replace(/"/g, '""')}"`,
      `"${it.customer_phone || ''}"`,
      `"${it.customer_nic || ''}"`,
      `"${(it.customer_address || '').replace(/"/g, '""')}"`,
      `"${it.origination_date || ''}"`,
      it.period_months || 3,
      `"${it.effective_expiry_date || ''}"`,
      it.days_overdue || 0,
      it.principal || 0,
      it.outstanding_interest || 0,
      `"${it.last_interest_date || 'None'}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Rupasinghe_FS_Overdue_Items_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('Forfeited Stock list exported successfully!');
  };

  // Access Denied Screen for Non-Admin
  if (authChecked && !isAdmin) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-500">
        <div className="w-20 h-20 bg-rose-500/10 text-rose-600 rounded-3xl flex items-center justify-center border border-rose-500/20 mb-6 shadow-xl">
          <ShieldAlert className="w-10 h-10" />
        </div>
        <h1 className="text-3xl font-black text-slate-900 tracking-tight mb-2">
          Admin Access Required
        </h1>
        <p className="text-slate-500 max-w-md text-sm mb-6 font-medium">
          The Forfeited Stock (FS Items / සින්න වන භාණ්ඩ) management module and customer SMS dispatch controls are strictly reserved for Head Office Administrators.
        </p>
        <Button 
          onClick={() => router.push('/')}
          className="bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-2xl px-6 h-11"
        >
          Return to Dashboard
        </Button>
      </div>
    );
  }

  const selectedWithPhoneCount = useMemo(() => {
    return items.filter(it => selectedIds.includes(it.id) && it.has_phone).length;
  }, [items, selectedIds]);

  return (
    <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-700 pb-20 max-w-7xl mx-auto px-4 md:px-6">
      
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center glass p-8 rounded-3xl border-white/40 shadow-2xl gap-6 relative overflow-hidden bg-gradient-to-r from-amber-500/10 via-rose-500/5 to-transparent">
        <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-br from-amber-500/10 via-rose-500/5 to-transparent rounded-full blur-3xl pointer-events-none" />
        
        <div className="relative z-10">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-amber-500/15 rounded-2xl border border-amber-500/30 text-amber-600 shadow-inner">
              <AlertTriangle className="w-8 h-8 text-amber-600" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-700 border border-rose-300">
                  Admin Only
                </span>
                <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 border border-amber-300">
                  සින්න වන භාණ්ඩ කළමනාකරණය
                </span>
              </div>
              <h1 className="text-3xl md:text-4xl font-black text-slate-900 tracking-tighter leading-none mt-1">
                Forfeited Stock <span className="bg-gradient-to-r from-amber-600 to-rose-600 bg-clip-text text-transparent">(FS Items)</span>
              </h1>
              <p className="text-slate-500 font-semibold text-xs md:text-sm tracking-tight mt-1.5">
                Identify overdue pawn contracts with unpaid interest, dispatch automated customer warning SMS, and manage collateral forfeiture.
              </p>
            </div>
          </div>
        </div>

        {/* Global Action Buttons */}
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto relative z-10">
          <Button
            onClick={exportToCSV}
            variant="outline"
            className="h-11 px-4 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 border-emerald-200 font-bold rounded-2xl shadow-sm text-xs"
          >
            <Download className="w-4 h-4 mr-2" /> Export CSV
          </Button>

          <Button
            onClick={() => loadData(true)}
            disabled={refreshing}
            variant="outline"
            className="h-11 px-4 bg-white/80 hover:bg-white text-slate-700 border-slate-200 font-bold rounded-2xl shadow-sm text-xs"
          >
            <RefreshCcw className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin text-amber-600' : ''}`} />
            Refresh
          </Button>

          {selectedIds.length > 0 && (
            <Button
              onClick={() => setBulkSmsModalOpen(true)}
              className="h-11 px-5 bg-gradient-to-r from-amber-600 to-rose-600 hover:from-amber-700 hover:to-rose-700 text-white font-bold rounded-2xl shadow-lg shadow-rose-600/20 text-xs animate-in zoom-in-95 duration-200"
            >
              <Send className="w-4 h-4 mr-2" />
              Send SMS to Selected ({selectedIds.length})
            </Button>
          )}
        </div>
      </div>

      {/* KPI Metrics Dashboard */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {/* Metric 1 */}
        <Card className="glass border-white/40 shadow-xl rounded-2xl">
          <CardContent className="p-4 flex flex-col justify-between h-full">
            <div className="flex items-center justify-between text-slate-500 text-xs font-bold uppercase tracking-wider">
              <span>Overdue Items</span>
              <AlertTriangle className="w-4 h-4 text-amber-500" />
            </div>
            <div className="mt-2">
              <span className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight">
                {summary.total_at_risk_count?.toLocaleString() || 0}
              </span>
              <p className="text-[11px] font-semibold text-amber-700 mt-0.5">Maturity expired</p>
            </div>
          </CardContent>
        </Card>

        {/* Metric 2 */}
        <Card className="glass border-white/40 shadow-xl rounded-2xl">
          <CardContent className="p-4 flex flex-col justify-between h-full">
            <div className="flex items-center justify-between text-slate-500 text-xs font-bold uppercase tracking-wider">
              <span>Principal At Risk</span>
              <DollarSign className="w-4 h-4 text-rose-500" />
            </div>
            <div className="mt-2">
              <span className="text-xl md:text-2xl font-black text-rose-600 tracking-tight">
                Rs. {summary.total_principal_at_risk?.toLocaleString() || 0}
              </span>
              <p className="text-[11px] font-semibold text-slate-500 mt-0.5">Disbursed collateral</p>
            </div>
          </CardContent>
        </Card>

        {/* Metric 3 */}
        <Card className="glass border-white/40 shadow-xl rounded-2xl">
          <CardContent className="p-4 flex flex-col justify-between h-full">
            <div className="flex items-center justify-between text-slate-500 text-xs font-bold uppercase tracking-wider">
              <span>Unpaid Interest</span>
              <Clock className="w-4 h-4 text-indigo-500" />
            </div>
            <div className="mt-2">
              <span className="text-xl md:text-2xl font-black text-indigo-600 tracking-tight">
                Rs. {summary.total_interest_due?.toLocaleString() || 0}
              </span>
              <p className="text-[11px] font-semibold text-indigo-700 mt-0.5">Estimated overdue</p>
            </div>
          </CardContent>
        </Card>

        {/* Metric 4 */}
        <Card className="glass border-white/40 shadow-xl rounded-2xl">
          <CardContent className="p-4 flex flex-col justify-between h-full">
            <div className="flex items-center justify-between text-slate-500 text-xs font-bold uppercase tracking-wider">
              <span>Critical Overdue</span>
              <div className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping" />
            </div>
            <div className="mt-2">
              <span className="text-2xl md:text-3xl font-black text-rose-600 tracking-tight">
                {summary.critical_overdue_count?.toLocaleString() || 0}
              </span>
              <p className="text-[11px] font-semibold text-rose-700 mt-0.5">&gt; 30 Days expired</p>
            </div>
          </CardContent>
        </Card>

        {/* Metric 5 */}
        <Card className="glass border-white/40 shadow-xl rounded-2xl">
          <CardContent className="p-4 flex flex-col justify-between h-full">
            <div className="flex items-center justify-between text-slate-500 text-xs font-bold uppercase tracking-wider">
              <span>SMS Reachable</span>
              <Smartphone className="w-4 h-4 text-emerald-500" />
            </div>
            <div className="mt-2">
              <span className="text-2xl md:text-3xl font-black text-emerald-600 tracking-tight">
                {summary.with_phone_count?.toLocaleString() || 0}
              </span>
              <p className="text-[11px] font-semibold text-emerald-700 mt-0.5">Valid mobile numbers</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter and Control Bar */}
      <div className="glass p-5 rounded-3xl border-white/40 shadow-xl flex flex-col md:flex-row gap-4 items-center justify-between bg-white/70">
        
        {/* Search Bar */}
        <form onSubmit={handleSearchSubmit} className="relative w-full md:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search Bill, Customer, Phone, NIC..."
            className="pl-10 h-10 rounded-2xl bg-white border-slate-200 text-xs font-medium focus:ring-amber-500"
          />
        </form>

        {/* Filters Group */}
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          
          {/* Branch Filter */}
          <Select value={filterBranch} onValueChange={(val) => setFilterBranch(val || 'ALL')}>
            <SelectTrigger className="h-10 w-36 rounded-2xl bg-white border-slate-200 text-xs font-bold">
              <SelectValue placeholder="Branch" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Branches</SelectItem>
              <SelectItem value="KDW">Kaduwela (KDW)</SelectItem>
              <SelectItem value="KHT">Kiribathgoda (KHT)</SelectItem>
              <SelectItem value="PND">Panadura (PND)</SelectItem>
              <SelectItem value="KTW">Kotikawatta (KTW)</SelectItem>
              <SelectItem value="HMG">Homagama (HMG)</SelectItem>
              <SelectItem value="DMT">Dematagoda (DMT)</SelectItem>
              <SelectItem value="W3">Wattala 3 (W3)</SelectItem>
              <SelectItem value="W4">Wattala 4 (W4)</SelectItem>
              <SelectItem value="BOR">Boralesgamuwa</SelectItem>
              <SelectItem value="HQ">Head Office (HQ)</SelectItem>
            </SelectContent>
          </Select>

          {/* Severity Filter */}
          <Select value={filterSeverity} onValueChange={(val) => setFilterSeverity(val || 'ALL')}>
            <SelectTrigger className="h-10 w-44 rounded-2xl bg-white border-slate-200 text-xs font-bold">
              <SelectValue placeholder="Overdue Severity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Overdue Items</SelectItem>
              <SelectItem value="1-14">1 – 14 Days Overdue</SelectItem>
              <SelectItem value="15-30">15 – 30 Days Overdue</SelectItem>
              <SelectItem value="30+">30+ Days (Critical)</SelectItem>
            </SelectContent>
          </Select>

          {/* Phone Only Toggle */}
          <button
            type="button"
            onClick={() => setPhoneOnly(!phoneOnly)}
            className={`h-10 px-3.5 rounded-2xl text-xs font-bold flex items-center gap-2 border transition-colors ${
              phoneOnly 
                ? 'bg-emerald-500 text-white border-emerald-600 shadow-sm' 
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span>Has Phone Only</span>
          </button>
        </div>
      </div>

      {/* Main FS Data Table */}
      <Card className="glass border-white/40 shadow-2xl rounded-3xl overflow-hidden">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-50/80 border-b border-slate-200">
                <TableRow>
                  <TableHead className="w-12 text-center">
                    <input
                      type="checkbox"
                      checked={displayedItems.length > 0 && selectedIds.length === displayedItems.length}
                      onChange={handleSelectAll}
                      className="rounded border-slate-300 text-amber-600 focus:ring-amber-500 w-4 h-4 cursor-pointer"
                    />
                  </TableHead>
                  <TableHead className="font-black text-xs text-slate-700 uppercase tracking-wider">Bill &amp; Branch</TableHead>
                  <TableHead className="font-black text-xs text-slate-700 uppercase tracking-wider">Customer Contact</TableHead>
                  <TableHead className="font-black text-xs text-slate-700 uppercase tracking-wider">Agreement &amp; Period</TableHead>
                  <TableHead className="font-black text-xs text-slate-700 uppercase tracking-wider">Maturity / Overdue</TableHead>
                  <TableHead className="font-black text-xs text-slate-700 uppercase tracking-wider text-right">Principal (LKR)</TableHead>
                  <TableHead className="font-black text-xs text-slate-700 uppercase tracking-wider text-right">Due Interest</TableHead>
                  <TableHead className="font-black text-xs text-slate-700 uppercase tracking-wider text-center">SMS Status</TableHead>
                  <TableHead className="font-black text-xs text-slate-700 uppercase tracking-wider text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={9} className="h-64 text-center">
                      <div className="flex flex-col items-center justify-center gap-3">
                        <RefreshCcw className="w-8 h-8 text-amber-600 animate-spin" />
                        <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                          Scanning inventory for overdue contracts and interest records...
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : displayedItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="h-48 text-center">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <CheckCircle2 className="w-10 h-10 text-emerald-500" />
                        <span className="text-base font-bold text-slate-800">No Overdue Items Found</span>
                        <p className="text-xs text-slate-500">
                          All active collateral contracts in the selected criteria have valid interest or are within agreement limits.
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  displayedItems.map((item) => {
                    const isSelected = selectedIds.includes(item.id);
                    const isCritical = item.days_overdue > 30;
                    const isMedium = item.days_overdue > 14 && item.days_overdue <= 30;

                    return (
                      <TableRow 
                        key={item.id} 
                        className={`hover:bg-amber-50/40 transition-colors border-b border-slate-100 ${
                          isSelected ? 'bg-amber-50/70' : ''
                        }`}
                      >
                        {/* Checkbox */}
                        <TableCell className="text-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleSelect(item.id)}
                            className="rounded border-slate-300 text-amber-600 focus:ring-amber-500 w-4 h-4 cursor-pointer"
                          />
                        </TableCell>

                        {/* Bill No & Branch */}
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-black text-sm text-slate-900 tracking-tight">
                              {item.bill_no}
                            </span>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-black uppercase bg-indigo-500/10 text-indigo-700 border border-indigo-200">
                                {item.branch_id}
                              </span>
                              <span className="text-[11px] font-medium text-slate-500">
                                {item.item_type || 'Gold'} • {item.weight_grams}g
                              </span>
                            </div>
                          </div>
                        </TableCell>

                        {/* Customer Contact */}
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-bold text-xs text-slate-900">
                              {item.customer_name}
                            </span>
                            {item.customer_phone ? (
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <span className="font-mono text-xs font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                                  {item.customer_phone}
                                </span>
                              </div>
                            ) : (
                              <span className="text-[10px] font-bold text-rose-600 uppercase mt-0.5">
                                No Phone on File
                              </span>
                            )}
                            {item.customer_nic && (
                              <span className="text-[10px] text-slate-400 font-mono">
                                NIC: {item.customer_nic}
                              </span>
                            )}
                          </div>
                        </TableCell>

                        {/* Agreement & Period */}
                        <TableCell>
                          <div className="flex flex-col text-xs">
                            <span className="font-semibold text-slate-700">
                              {item.origination_date}
                            </span>
                            <span className="text-[11px] font-bold text-amber-700">
                              {item.period_months}M Contract ({item.interest_rate}%)
                            </span>
                            {item.covered_months > 0 && (
                              <span className="text-[10px] text-emerald-600 font-semibold mt-0.5">
                                +{item.covered_months} mo. interest covered
                              </span>
                            )}
                          </div>
                        </TableCell>

                        {/* Maturity / Days Overdue */}
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="text-xs font-semibold text-slate-700">
                              {item.effective_expiry_date}
                            </span>
                            <div className="mt-1">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border ${
                                isCritical 
                                  ? 'bg-rose-500/15 text-rose-700 border-rose-300' 
                                  : isMedium 
                                    ? 'bg-amber-500/15 text-amber-800 border-amber-300' 
                                    : 'bg-yellow-500/15 text-yellow-800 border-yellow-300'
                              }`}>
                                <AlertTriangle className="w-3 h-3" />
                                {item.days_overdue} Days Overdue
                              </span>
                            </div>
                          </div>
                        </TableCell>

                        {/* Principal */}
                        <TableCell className="text-right">
                          <span className="font-mono font-black text-sm text-slate-900">
                            Rs. {item.principal?.toLocaleString()}
                          </span>
                        </TableCell>

                        {/* Outstanding Interest */}
                        <TableCell className="text-right">
                          <div className="flex flex-col items-end">
                            <span className="font-mono font-black text-sm text-rose-600">
                              Rs. {item.outstanding_interest?.toLocaleString()}
                            </span>
                            {item.total_interest_paid > 0 && (
                              <span className="text-[10px] text-slate-500 font-medium">
                                Paid: Rs. {item.total_interest_paid.toLocaleString()}
                              </span>
                            )}
                          </div>
                        </TableCell>

                        {/* SMS Status */}
                        <TableCell className="text-center">
                          {item.last_sms_sent_at ? (
                            <div className="flex flex-col items-center">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-500/10 text-emerald-700 border border-emerald-200">
                                <Check className="w-3 h-3" /> Sent
                              </span>
                              <span className="text-[9px] text-slate-400 mt-0.5">
                                {new Date(item.last_sms_sent_at).toLocaleDateString()}
                              </span>
                            </div>
                          ) : item.has_phone ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                              Ready
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-600 border border-rose-200">
                              Missing #
                            </span>
                          )}
                        </TableCell>

                        {/* Actions */}
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-2">
                            {/* Send SMS Button */}
                            <Button
                              size="sm"
                              disabled={!item.has_phone}
                              onClick={() => setSmsModalItem(item)}
                              className="h-8 px-2.5 bg-amber-500/15 hover:bg-amber-500/25 text-amber-800 border border-amber-300 font-bold text-xs rounded-xl shadow-none"
                              title={item.has_phone ? "Send Warning SMS" : "No Phone Available"}
                            >
                              <Send className="w-3.5 h-3.5 mr-1 text-amber-700" />
                              SMS
                            </Button>

                            {/* Mark as Forfeited Button */}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setForfeitModalItem(item);
                                setForfeitNotes(`F/S (Forfeited Collateral transferred to auction due to ${item.days_overdue} days overdue maturity).`);
                              }}
                              className="h-8 px-2.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-700 border border-rose-200 font-bold text-xs rounded-xl shadow-none"
                              title="Mark as Forfeited (F/S)"
                            >
                              <Gavel className="w-3.5 h-3.5 mr-1 text-rose-600" />
                              F/S
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* SINGLE SMS MODAL */}
      {smsModalItem && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-amber-500/15 text-amber-600 rounded-xl">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900">Send Forfeiture SMS Warning</h3>
                  <p className="text-xs text-slate-500 font-medium">Ticket #{smsModalItem.bill_no} • {smsModalItem.branch_id}</p>
                </div>
              </div>
              <button 
                onClick={() => setSmsModalItem(null)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="py-4 space-y-4">
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">Customer Name:</span>
                  <span className="font-bold text-slate-800">{smsModalItem.customer_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Recipient Mobile:</span>
                  <span className="font-bold text-emerald-700 font-mono">{smsModalItem.customer_phone}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Maturity Date:</span>
                  <span className="font-bold text-slate-800">{smsModalItem.effective_expiry_date}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Days Overdue:</span>
                  <span className="font-bold text-rose-600">{smsModalItem.days_overdue} Days</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Due Interest:</span>
                  <span className="font-black text-rose-600 font-mono">Rs. {smsModalItem.outstanding_interest.toLocaleString()}</span>
                </div>
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block mb-1.5">
                  SMS Preview (Automatic Trilingual Template)
                </label>
                <div className="bg-amber-50/60 p-3.5 rounded-2xl border border-amber-200 font-sans text-xs text-slate-700 whitespace-pre-line leading-relaxed shadow-inner">
                  {`RUPASINGHE PAWNING (PVT) LTD
Dear ${smsModalItem.customer_name},
URGENT: Pawn Ticket #${smsModalItem.bill_no} (Principal: Rs. ${smsModalItem.principal.toLocaleString()}) expired on ${smsModalItem.effective_expiry_date}.
Unpaid Interest: Rs. ${smsModalItem.outstanding_interest.toLocaleString()}.
Please settle immediately to prevent item forfeiture/auction.
කරුණාකර භාණ්ඩ සින්න වීම වැළැක්වීමට වහාම ශාඛාව අමතන්න.`}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <Button
                variant="outline"
                onClick={() => setSmsModalItem(null)}
                className="h-10 rounded-xl text-xs font-bold"
              >
                Cancel
              </Button>
              <Button
                disabled={actionLoading}
                onClick={handleSendSingleSms}
                className="h-10 px-5 bg-gradient-to-r from-amber-600 to-rose-600 hover:from-amber-700 hover:to-rose-700 text-white font-bold rounded-xl text-xs shadow-md"
              >
                {actionLoading ? <RefreshCcw className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
                Confirm &amp; Send SMS
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* BULK SMS MODAL */}
      {bulkSmsModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-rose-500/15 text-rose-600 rounded-xl">
                  <Send className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900">Confirm Bulk SMS Dispatch</h3>
                  <p className="text-xs text-slate-500 font-medium">{selectedIds.length} items selected</p>
                </div>
              </div>
              <button 
                onClick={() => setBulkSmsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="py-4 space-y-4">
              <div className="grid grid-cols-2 gap-3 text-center">
                <div className="p-3 bg-emerald-50 rounded-2xl border border-emerald-200">
                  <span className="text-xl font-black text-emerald-700">{selectedWithPhoneCount}</span>
                  <p className="text-[11px] font-bold text-emerald-800">Ready to Send</p>
                </div>
                <div className="p-3 bg-rose-50 rounded-2xl border border-rose-200">
                  <span className="text-xl font-black text-rose-700">{selectedIds.length - selectedWithPhoneCount}</span>
                  <p className="text-[11px] font-bold text-rose-800">Skipped (No Phone)</p>
                </div>
              </div>

              <div className="p-4 bg-amber-50 rounded-2xl border border-amber-200 text-xs text-amber-800 space-y-1.5 font-medium">
                <p className="font-bold flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 text-amber-600" />
                  SMS Warning Policy
                </p>
                <p>
                  Each customer will receive a personalised SMS with their specific ticket number, overdue interest balance, and branch contact details via the Textbee / Android SIM Gateway.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <Button
                variant="outline"
                onClick={() => setBulkSmsModalOpen(false)}
                className="h-10 rounded-xl text-xs font-bold"
              >
                Cancel
              </Button>
              <Button
                disabled={actionLoading || selectedWithPhoneCount === 0}
                onClick={handleSendBulkSms}
                className="h-10 px-5 bg-gradient-to-r from-amber-600 to-rose-600 hover:from-amber-700 hover:to-rose-700 text-white font-bold rounded-xl text-xs shadow-md"
              >
                {actionLoading ? <RefreshCcw className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
                Dispatch {selectedWithPhoneCount} SMS Messages
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* MARK AS FORFEITED (F/S) MODAL */}
      {forfeitModalItem && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-rose-500/15 text-rose-600 rounded-xl">
                  <Gavel className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900">Confirm Forfeiture (F/S Withdrawal)</h3>
                  <p className="text-xs text-slate-500 font-medium">Ticket #{forfeitModalItem.bill_no} • {forfeitModalItem.branch_id}</p>
                </div>
              </div>
              <button 
                onClick={() => setForfeitModalItem(null)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="py-4 space-y-4">
              <div className="p-4 bg-rose-50 rounded-2xl border border-rose-200 text-xs text-rose-800 space-y-1.5 font-medium">
                <p className="font-bold flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 text-rose-600" />
                  Collateral Forfeiture Action
                </p>
                <p>
                  This action marks the collateral as <strong>Forfeited Stock (F/S)</strong> and withdraws it from the active branch safe inventory. It will be logged permanently in the system audit logs.
                </p>
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block mb-1.5">
                  Audit Notes / Reason
                </label>
                <Input
                  value={forfeitNotes}
                  onChange={(e) => setForfeitNotes(e.target.value)}
                  placeholder="Enter audit notes..."
                  className="h-10 rounded-xl text-xs font-medium"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <Button
                variant="outline"
                onClick={() => setForfeitModalItem(null)}
                className="h-10 rounded-xl text-xs font-bold"
              >
                Cancel
              </Button>
              <Button
                disabled={actionLoading}
                onClick={handleConfirmForfeit}
                className="h-10 px-5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-xs shadow-md"
              >
                {actionLoading ? <RefreshCcw className="w-4 h-4 animate-spin mr-2" /> : <Gavel className="w-4 h-4 mr-2" />}
                Confirm Forfeiture
              </Button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
