'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  AlertTriangle, ShieldAlert, Send, RefreshCcw, Search, Download, 
  Phone, User, Calendar, Clock, DollarSign, CheckCircle2, 
  X, Check, AlertCircle, FileSpreadsheet, Smartphone, Gavel,
  Printer, Layers, Tag, Percent, RotateCcw, MessageSquare, Building2
} from 'lucide-react';
import { toast } from 'sonner';
import { CANONICAL_BRANCHES } from '@/lib/branch-mapping';

const getBranchDisplayName = (bCode: string) => {
  const code = (bCode || 'HQ').toUpperCase();
  const found = CANONICAL_BRANCHES.find(b => b.id === code);
  if (found) return `${found.name} (${found.id})`;
  return `${code} Branch`;
};

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
    with_phone_count: 0,
    has_paid_interest_count: 0,
    zero_interest_count: 0
  });

  // Filter states
  const [filterBranch, setFilterBranch] = useState('ALL');
  const [filterSeverity, setFilterSeverity] = useState('ALL');
  const [filterPeriod, setFilterPeriod] = useState('ALL');
  const [filterBillTag, setFilterBillTag] = useState('ALL');
  const [filterInterestStatus, setFilterInterestStatus] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [phoneOnly, setPhoneOnly] = useState(false);

  // Selection states
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Modal states
  const [smsModalItem, setSmsModalItem] = useState<any | null>(null);
  const [singleCustomMessage, setSingleCustomMessage] = useState('');
  const [bulkSmsModalOpen, setBulkSmsModalOpen] = useState(false);
  const [bulkCustomTemplate, setBulkCustomTemplate] = useState('');
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
      if (filterPeriod !== 'ALL') params.set('period', filterPeriod);
      if (filterBillTag !== 'ALL') params.set('billTag', filterBillTag);
      if (filterInterestStatus !== 'ALL') params.set('interestStatus', filterInterestStatus);
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
  }, [authChecked, isAdmin, filterBranch, filterSeverity, filterPeriod, filterBillTag, filterInterestStatus]);

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

  // Helper to build detailed default SMS for an item
  const buildItemDefaultSms = (item: any) => {
    const nameDisplay = (item.customer_name && item.customer_name !== '.' && item.customer_name !== 'Valued Customer') 
      ? item.customer_name 
      : 'Valued Customer';
    const dateInfo = item.origination_date ? ` (Date: ${item.origination_date}, ${item.period_months || 3}M)` : '';
    const paidInfo = item.total_interest_paid > 0 
      ? `\nInterest Paid: Rs. ${item.total_interest_paid.toLocaleString()} (${item.covered_months || 0} mo. covered${item.last_interest_date ? `, last: ${item.last_interest_date}` : ''})` 
      : '\nInterest Paid: Rs. 0 (None)';

    return `RUPASINGHE PAWNING (PVT) LTD
Dear ${nameDisplay},
URGENT: Pawn Ticket #${item.bill_no} [${item.branch_id}]${dateInfo}
Principal: Rs. ${(item.principal || 0).toLocaleString()} | Expired: ${item.effective_expiry_date}${paidInfo}
Due Overdue Interest: Rs. ${(item.outstanding_interest || 0).toLocaleString()}
Please settle immediately to avoid collateral forfeiture/auction.
කරුණාකර භාණ්ඩ සින්න වීම වැළැක්වීමට වහාම ශාඛාව අමතන්න.`;
  };

  // Open Single SMS Modal
  const openSingleSmsModal = (item: any) => {
    setSmsModalItem(item);
    setSingleCustomMessage(buildItemDefaultSms(item));
  };

  // Open Bulk SMS Modal
  const openBulkSmsModal = () => {
    const defaultTemplate = `RUPASINGHE PAWNING (PVT) LTD
Dear {customer_name},
URGENT: Pawn Ticket #{bill_no} [{branch}] (Date: {origination_date})
Principal: Rs. {principal} | Expired: {expiry_date}
Interest Paid: Rs. {interest_paid}
Due Overdue Interest: Rs. {interest_due}
Please settle immediately to avoid collateral forfeiture/auction.
කරුණාකර භාණ්ඩ සින්න වීම වැළැක්වීමට වහාම ශාඛාව අමතන්න.`;
    setBulkCustomTemplate(defaultTemplate);
    setBulkSmsModalOpen(true);
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
          branchId: smsModalItem.branch_id,
          originationDate: smsModalItem.origination_date,
          periodMonths: smsModalItem.period_months,
          interestPaid: smsModalItem.total_interest_paid,
          coveredMonths: smsModalItem.covered_months,
          lastInterestDate: smsModalItem.last_interest_date,
          customMessage: singleCustomMessage.trim()
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
        branchId: it.branch_id,
        originationDate: it.origination_date,
        periodMonths: it.period_months,
        interestPaid: it.total_interest_paid,
        coveredMonths: it.covered_months,
        lastInterestDate: it.last_interest_date
      }));

      const res = await fetch('/api/stock/forfeiture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'BULK_SEND_SMS',
          items: payload,
          customTemplate: bulkCustomTemplate.trim()
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
      'Bill No', 'Tag', 'Branch', 'Item Type', 'Weight (g)', 'Customer Name', 
      'Phone', 'NIC', 'Address', 'Pawn Date', 'Period (M)', 
      'Expiry Date', 'Days Overdue', 'Principal (LKR)', 
      'Due Interest (LKR)', 'Interest Paid (LKR)', 'Covered Months', 'Last Interest Date'
    ];

    const rows = displayedItems.map(it => [
      `"${it.bill_no || ''}"`,
      `"${it.bill_tag || ''}"`,
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
      it.total_interest_paid || 0,
      it.covered_months || 0,
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

  // PDF Print Function
  const handlePrintPdf = () => {
    if (displayedItems.length === 0) {
      toast.error('No items to print');
      return;
    }
    window.print();
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

  // Bulk SMS live preview for the first selected item
  const bulkPreviewMessage = useMemo(() => {
    const firstItem = items.find(it => selectedIds.includes(it.id)) || displayedItems[0];
    if (!firstItem || !bulkCustomTemplate) return '';
    return bulkCustomTemplate
      .replace(/\{customer_name\}/gi, firstItem.customer_name || 'Valued Customer')
      .replace(/\{bill_no\}/gi, firstItem.bill_no || 'N/A')
      .replace(/\{branch\}/gi, firstItem.branch_id || 'Branch')
      .replace(/\{principal\}/gi, parseFloat(firstItem.principal || 0).toLocaleString())
      .replace(/\{interest_due\}/gi, parseFloat(firstItem.outstanding_interest || 0).toLocaleString())
      .replace(/\{expiry_date\}/gi, firstItem.effective_expiry_date || 'N/A')
      .replace(/\{origination_date\}/gi, firstItem.origination_date || 'N/A')
      .replace(/\{interest_paid\}/gi, parseFloat(firstItem.total_interest_paid || 0).toLocaleString());
  }, [items, selectedIds, displayedItems, bulkCustomTemplate]);

  // Group displayed items by branch for A4 Portrait multi-page report
  const branchGroupedItems = useMemo(() => {
    const groups: Record<string, any[]> = {};
    displayedItems.forEach(item => {
      const b = (item.branch_id || 'HQ').toUpperCase();
      if (!groups[b]) groups[b] = [];
      groups[b].push(item);
    });
    return Object.keys(groups).sort().map(branchCode => ({
      branchCode,
      branchName: getBranchDisplayName(branchCode),
      items: groups[branchCode],
      totalPrincipal: groups[branchCode].reduce((acc: number, it: any) => acc + (it.principal || 0), 0),
      totalDueInterest: groups[branchCode].reduce((acc: number, it: any) => acc + (it.outstanding_interest || 0), 0),
      criticalCount: groups[branchCode].filter((it: any) => it.days_overdue > 30).length
    }));
  }, [displayedItems]);

  return (
    <>
      {/* PRINT-ONLY STYLESHEET */}
      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #print-area, #print-area * {
            visibility: visible;
          }
          #print-area {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            display: block !important;
            padding: 0;
            margin: 0;
            background: white !important;
            color: black !important;
          }
          .no-print {
            display: none !important;
          }
          .branch-page-section {
            page-break-before: always;
            break-before: page;
            padding-bottom: 24px;
          }
          .branch-page-section:first-child {
            page-break-before: avoid;
            break-before: avoid;
          }
          @page {
            size: A4 portrait;
            margin: 8mm 6mm 10mm 6mm;
          }
        }
      `}</style>

      {/* PRINT AREA (Hidden in UI, Visible during window.print()) */}
      <div id="print-area" className="hidden">
        {branchGroupedItems.length === 0 ? (
          <div className="p-8 text-center text-sm font-bold text-slate-600">
            No Forfeited Stock (FS) items found for the selected criteria.
          </div>
        ) : (
          branchGroupedItems.map((group, gIdx) => (
            <div key={group.branchCode} className="branch-page-section">
              {/* Header for this Branch Page */}
              <div className="border-b-2 border-slate-900 pb-2 mb-2">
                <div className="flex justify-between items-start">
                  <div>
                    <h1 className="text-xl font-black tracking-tight text-slate-900">RUPASINGHE PAWNING (PVT) LTD</h1>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                        Forfeited Stock (FS Items) Report
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-slate-900 text-white">
                        {group.branchName}
                      </span>
                    </div>
                  </div>
                  <div className="text-right text-[9px] text-slate-500">
                    <p>Printed: {new Date().toLocaleString('en-GB')}</p>
                    <p>Tag: <strong className="text-slate-900">{filterBillTag}</strong> | Duration: <strong className="text-slate-900">{filterPeriod === 'ALL' ? 'All' : `${filterPeriod}M`}</strong></p>
                    <p className="font-bold text-slate-700">Branch Page {gIdx + 1} of {branchGroupedItems.length}</p>
                  </div>
                </div>

                {/* Branch Summary Bar */}
                <div className="grid grid-cols-4 gap-2 mt-2 pt-1.5 border-t border-slate-200 text-[9px]">
                  <div>Branch Overdue Items: <strong className="text-slate-900 font-bold">{group.items.length}</strong></div>
                  <div>Principal at Risk: <strong className="text-slate-900 font-bold">Rs. {group.totalPrincipal.toLocaleString()}</strong></div>
                  <div>Unpaid Due Interest: <strong className="text-slate-900 font-bold">Rs. {group.totalDueInterest.toLocaleString()}</strong></div>
                  <div>Critical Overdue (&gt;30d): <strong className="text-slate-900 font-bold">{group.criticalCount}</strong></div>
                </div>
              </div>

              {/* Branch Items Table (A4 Portrait Optimized) */}
              <table className="w-full text-[8.5px] border-collapse border border-slate-300">
                <thead>
                  <tr className="bg-slate-100 text-slate-900 text-left border-b border-slate-300 font-bold">
                    <th className="p-1 border border-slate-300 w-6 text-center">#</th>
                    <th className="p-1 border border-slate-300 w-16">Bill No</th>
                    <th className="p-1 border border-slate-300">Customer Details</th>
                    <th className="p-1 border border-slate-300 w-24">Item &amp; Weight</th>
                    <th className="p-1 border border-slate-300 w-16">Date</th>
                    <th className="p-1 border border-slate-300 w-12 text-center">Elapsed</th>
                    <th className="p-1 border border-slate-300 w-16">FS Due</th>
                    <th className="p-1 border border-slate-300 w-12 text-center">Overdue</th>
                    <th className="p-1 border border-slate-300 w-18 text-right">Principal</th>
                    <th className="p-1 border border-slate-300 w-16 text-right">Int. Paid</th>
                    <th className="p-1 border border-slate-300 w-20 text-right">Due Interest</th>
                  </tr>
                </thead>
                <tbody>
                  {group.items.map((it: any, idx: number) => (
                    <tr key={it.id} className="border-b border-slate-200">
                      <td className="p-1 border border-slate-300 text-center text-slate-500">{idx + 1}</td>
                      <td className="p-1 border border-slate-300 font-black text-slate-900 whitespace-nowrap">{it.bill_no}</td>
                      <td className="p-1 border border-slate-300">
                        <div className="font-bold text-slate-900 leading-tight">{it.customer_name}</div>
                        <div className="text-[7.5px] text-slate-600 font-mono">
                          {it.customer_phone || 'No Phone'}{it.customer_nic ? ` • ${it.customer_nic}` : ''}
                        </div>
                      </td>
                      <td className="p-1 border border-slate-300">
                        <div className="font-semibold text-slate-800 leading-tight">{it.item_type || 'Gold'}</div>
                        <div className="text-[7.5px] text-slate-500">{it.weight_grams}g</div>
                      </td>
                      <td className="p-1 border border-slate-300 whitespace-nowrap">{it.origination_date}</td>
                      <td className="p-1 border border-slate-300 text-center font-bold text-purple-800 whitespace-nowrap">
                        {it.elapsed_months ?? 0}M
                      </td>
                      <td className="p-1 border border-slate-300 whitespace-nowrap">{it.effective_expiry_date}</td>
                      <td className="p-1 border border-slate-300 text-center font-bold text-rose-700 whitespace-nowrap">
                        {it.days_overdue} d
                      </td>
                      <td className="p-1 border border-slate-300 text-right font-mono font-bold text-slate-900 whitespace-nowrap">
                        {it.principal?.toLocaleString()}
                      </td>
                      <td className="p-1 border border-slate-300 text-right font-mono text-emerald-700 whitespace-nowrap">
                        {it.total_interest_paid?.toLocaleString()}
                      </td>
                      <td className="p-1 border border-slate-300 text-right font-mono font-black text-rose-900 whitespace-nowrap">
                        {it.outstanding_interest?.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 font-bold border-t-2 border-slate-300 text-[9px]">
                    <td colSpan={8} className="p-1 border border-slate-300 text-right uppercase">
                      {group.branchCode} Total:
                    </td>
                    <td className="p-1 border border-slate-300 text-right font-mono text-slate-900">
                      Rs. {group.totalPrincipal.toLocaleString()}
                    </td>
                    <td className="p-1 border border-slate-300 text-right font-mono text-emerald-700">
                      Rs. {group.items.reduce((acc: number, it: any) => acc + (it.total_interest_paid || 0), 0).toLocaleString()}
                    </td>
                    <td className="p-1 border border-slate-300 text-right font-mono text-rose-900">
                      Rs. {group.totalDueInterest.toLocaleString()}
                    </td>
                  </tr>
                </tfoot>
              </table>

              {/* Branch Page Signatures */}
              <div className="mt-4 flex justify-between text-[8.5px] text-slate-500 pt-3 border-t border-slate-300">
                <div>Branch Manager ({group.branchCode}): ___________________</div>
                <div>Audited By: ___________________</div>
                <div>Authorized By (Director): ___________________</div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* SCREEN UI CONTAINER (Full Width, Spacious Responsive Design) */}
      <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-700 pb-20 w-full max-w-[1700px] mx-auto px-4 sm:px-6 lg:px-8 no-print">
        
        {/* Header Banner */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center glass p-6 md:p-8 rounded-3xl border-white/40 shadow-2xl gap-6 relative overflow-hidden bg-gradient-to-r from-amber-500/10 via-rose-500/5 to-transparent">
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
                  Identify overdue pawn contracts with unpaid interest, dispatch customizable customer warning SMS, and manage collateral forfeiture.
                </p>
              </div>
            </div>
          </div>

          {/* Global Action Buttons */}
          <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto relative z-10">
            <Button
              onClick={handlePrintPdf}
              variant="outline"
              className="h-10 px-3.5 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-700 border-indigo-200 font-bold rounded-2xl shadow-sm text-xs"
              title="Print official A4 PDF report"
            >
              <Printer className="w-4 h-4 mr-1.5" /> Print PDF
            </Button>

            <Button
              onClick={exportToCSV}
              variant="outline"
              className="h-10 px-3.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 border-emerald-200 font-bold rounded-2xl shadow-sm text-xs"
            >
              <Download className="w-4 h-4 mr-1.5" /> Export CSV
            </Button>

            <Button
              onClick={() => loadData(true)}
              disabled={refreshing}
              variant="outline"
              className="h-10 px-3.5 bg-white/80 hover:bg-white text-slate-700 border-slate-200 font-bold rounded-2xl shadow-sm text-xs"
            >
              <RefreshCcw className={`w-4 h-4 mr-1.5 ${refreshing ? 'animate-spin text-amber-600' : ''}`} />
              Refresh
            </Button>

            {selectedIds.length > 0 && (
              <Button
                onClick={openBulkSmsModal}
                className="h-10 px-4 bg-gradient-to-r from-amber-600 to-rose-600 hover:from-amber-700 hover:to-rose-700 text-white font-bold rounded-2xl shadow-lg shadow-rose-600/20 text-xs animate-in zoom-in-95 duration-200"
              >
                <Send className="w-4 h-4 mr-1.5" />
                Customize &amp; Send SMS ({selectedIds.length})
              </Button>
            )}
          </div>
        </div>

        {/* KPI Metrics Dashboard (6 Cards) */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3.5">
          {/* Metric 1 */}
          <Card className="glass border-white/40 shadow-xl rounded-2xl">
            <CardContent className="p-4 flex flex-col justify-between h-full">
              <div className="flex items-center justify-between text-slate-500 text-xs font-bold uppercase tracking-wider">
                <span>Overdue Items</span>
                <AlertTriangle className="w-4 h-4 text-amber-500" />
              </div>
              <div className="mt-2">
                <span className="text-2xl font-black text-slate-900 tracking-tight">
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
                <span className="text-xl font-black text-rose-600 tracking-tight">
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
                <span className="text-xl font-black text-indigo-600 tracking-tight">
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
                <span className="text-2xl font-black text-rose-600 tracking-tight">
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
                <span>Interest Paid</span>
                <Percent className="w-4 h-4 text-blue-500" />
              </div>
              <div className="mt-2">
                <span className="text-2xl font-black text-blue-600 tracking-tight">
                  {summary.has_paid_interest_count?.toLocaleString() || 0}
                </span>
                <p className="text-[11px] font-semibold text-slate-500 mt-0.5">
                  Zero paid: <strong className="text-rose-600">{summary.zero_interest_count || 0}</strong>
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Metric 6 */}
          <Card className="glass border-white/40 shadow-xl rounded-2xl">
            <CardContent className="p-4 flex flex-col justify-between h-full">
              <div className="flex items-center justify-between text-slate-500 text-xs font-bold uppercase tracking-wider">
                <span>SMS Reachable</span>
                <Smartphone className="w-4 h-4 text-emerald-500" />
              </div>
              <div className="mt-2">
                <span className="text-2xl font-black text-emerald-600 tracking-tight">
                  {summary.with_phone_count?.toLocaleString() || 0}
                </span>
                <p className="text-[11px] font-semibold text-emerald-700 mt-0.5">Valid mobile numbers</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Enhanced Multi-Filter and Control Bar */}
        <div className="glass p-5 rounded-3xl border-white/40 shadow-xl flex flex-col lg:flex-row gap-3.5 items-stretch lg:items-center justify-between bg-white/75">
          
          {/* Search Bar */}
          <form onSubmit={handleSearchSubmit} className="relative w-full lg:w-72">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search Bill, Customer, Phone, NIC..."
              className="pl-9 h-10 rounded-2xl bg-white border-slate-200 text-xs font-medium focus:ring-amber-500"
            />
          </form>

          {/* Filters Row */}
          <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto">
            
            {/* 1. Branch Filter */}
            <Select value={filterBranch} onValueChange={(val) => setFilterBranch(val || 'ALL')}>
              <SelectTrigger className="h-10 w-32 rounded-2xl bg-white border-slate-200 text-xs font-bold">
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

            {/* 2. Elapsed Duration (Months from Start Date) Filter */}
            <Select value={filterPeriod} onValueChange={(val) => setFilterPeriod(val || 'ALL')}>
              <SelectTrigger className="h-10 w-44 rounded-2xl bg-white border-slate-200 text-xs font-bold">
                <SelectValue placeholder="Elapsed Duration" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Durations (All FS)</SelectItem>
                <SelectItem value="1">1 Month Elapsed</SelectItem>
                <SelectItem value="2">2 Months Elapsed</SelectItem>
                <SelectItem value="3">3 Months (1R FS Threshold)</SelectItem>
                <SelectItem value="5">5 Months (3R/3M FS Threshold)</SelectItem>
                <SelectItem value="6">6 Months Elapsed</SelectItem>
                <SelectItem value="12">12 Months Elapsed</SelectItem>
                <SelectItem value="13">13+ Months (12R/A FS Threshold)</SelectItem>
              </SelectContent>
            </Select>

            {/* 3. Bill Tag Filter (1R, 3R, 3M, 12R, A) */}
            <Select value={filterBillTag} onValueChange={(val) => setFilterBillTag(val || 'ALL')}>
              <SelectTrigger className="h-10 w-36 rounded-2xl bg-white border-slate-200 text-xs font-bold">
                <SelectValue placeholder="Tag" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Tags</SelectItem>
                <SelectItem value="1R">1R Tickets (3M FS)</SelectItem>
                <SelectItem value="3R">3R Tickets (5M FS)</SelectItem>
                <SelectItem value="3M">3M Tickets (5M FS)</SelectItem>
                <SelectItem value="12R">12R Tickets (13M FS)</SelectItem>
                <SelectItem value="A">A Tickets (13M FS)</SelectItem>
                <SelectItem value="6R">6R Tickets (Legacy)</SelectItem>
                <SelectItem value="OTHER">Other / Non-R</SelectItem>
              </SelectContent>
            </Select>

            {/* 4. Interest Payment Status Filter */}
            <Select value={filterInterestStatus} onValueChange={(val) => setFilterInterestStatus(val || 'ALL')}>
              <SelectTrigger className="h-10 w-44 rounded-2xl bg-white border-slate-200 text-xs font-bold">
                <SelectValue placeholder="Interest Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Interest Statuses</SelectItem>
                <SelectItem value="PAID">Paid Interest (&ge;1 mo.)</SelectItem>
                <SelectItem value="UNPAID">Zero Interest Paid (0 mo.)</SelectItem>
              </SelectContent>
            </Select>

            {/* 5. Severity Filter */}
            <Select value={filterSeverity} onValueChange={(val) => setFilterSeverity(val || 'ALL')}>
              <SelectTrigger className="h-10 w-40 rounded-2xl bg-white border-slate-200 text-xs font-bold">
                <SelectValue placeholder="Overdue Severity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Overdue</SelectItem>
                <SelectItem value="1-14">1 – 14 Days</SelectItem>
                <SelectItem value="15-30">15 – 30 Days</SelectItem>
                <SelectItem value="30+">30+ Days (Critical)</SelectItem>
              </SelectContent>
            </Select>

            {/* 6. Phone Only Toggle */}
            <button
              type="button"
              onClick={() => setPhoneOnly(!phoneOnly)}
              className={`h-10 px-3 rounded-2xl text-xs font-bold flex items-center gap-1.5 border transition-colors ${
                phoneOnly 
                  ? 'bg-emerald-500 text-white border-emerald-600 shadow-sm' 
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
              title="Show only records with customer phone"
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>Has Phone</span>
            </button>
          </div>
        </div>

        {/* Spacious, Full-Width Main FS Data Table */}
        <Card className="glass border-white/40 shadow-2xl rounded-3xl overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-x-auto w-full">
              <Table className="w-full">
                <TableHeader className="bg-slate-50/90 border-b border-slate-200">
                  <TableRow>
                    <TableHead className="w-12 text-center p-3">
                      <input
                        type="checkbox"
                        checked={displayedItems.length > 0 && selectedIds.length === displayedItems.length}
                        onChange={handleSelectAll}
                        className="rounded border-slate-300 text-amber-600 focus:ring-amber-500 w-4 h-4 cursor-pointer"
                      />
                    </TableHead>
                    <TableHead className="font-black text-xs text-slate-700 uppercase tracking-wider py-3.5 px-3 whitespace-nowrap">Bill &amp; Branch</TableHead>
                    <TableHead className="font-black text-xs text-slate-700 uppercase tracking-wider py-3.5 px-3 min-w-[200px]">Customer Contact</TableHead>
                    <TableHead className="font-black text-xs text-slate-700 uppercase tracking-wider py-3.5 px-3 whitespace-nowrap">Agreement &amp; Period</TableHead>
                    <TableHead className="font-black text-xs text-slate-700 uppercase tracking-wider py-3.5 px-3 whitespace-nowrap">Maturity / Overdue</TableHead>
                    <TableHead className="font-black text-xs text-slate-700 uppercase tracking-wider py-3.5 px-3 text-right whitespace-nowrap">Principal (LKR)</TableHead>
                    <TableHead className="font-black text-xs text-slate-700 uppercase tracking-wider py-3.5 px-3 text-right whitespace-nowrap">Interest History</TableHead>
                    <TableHead className="font-black text-xs text-slate-700 uppercase tracking-wider py-3.5 px-3 text-right whitespace-nowrap">Due Interest</TableHead>
                    <TableHead className="font-black text-xs text-slate-700 uppercase tracking-wider py-3.5 px-3 text-center whitespace-nowrap">SMS Status</TableHead>
                    <TableHead className="font-black text-xs text-slate-700 uppercase tracking-wider py-3.5 px-3 text-center whitespace-nowrap">Actions</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={10} className="h-64 text-center">
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
                      <TableCell colSpan={10} className="h-48 text-center">
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
                          <TableCell className="text-center p-3">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleToggleSelect(item.id)}
                              className="rounded border-slate-300 text-amber-600 focus:ring-amber-500 w-4 h-4 cursor-pointer"
                            />
                          </TableCell>

                          {/* Bill No & Branch */}
                          <TableCell className="py-3 px-3">
                            <div className="flex flex-col">
                              <span className="font-black text-sm text-slate-900 tracking-tight whitespace-nowrap">
                                {item.bill_no}
                              </span>
                              <div className="flex items-center gap-1.5 mt-0.5 whitespace-nowrap">
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-black uppercase bg-indigo-500/10 text-indigo-700 border border-indigo-200">
                                  {item.branch_id}
                                </span>
                                {item.bill_tag && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-500/10 text-amber-800 border border-amber-200">
                                    {item.bill_tag}
                                  </span>
                                )}
                                <span className="text-[11px] font-medium text-slate-500">
                                  {item.item_type || 'Gold'} • {item.weight_grams}g
                                </span>
                              </div>
                            </div>
                          </TableCell>

                          {/* Customer Contact */}
                          <TableCell className="py-3 px-3">
                            <div className="flex flex-col">
                              <span className="font-bold text-xs text-slate-900 leading-snug">
                                {item.customer_name}
                              </span>
                              {item.customer_phone ? (
                                <div className="flex items-center gap-1.5 mt-0.5">
                                  <span className="font-mono text-xs font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 whitespace-nowrap">
                                    {item.customer_phone}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-[10px] font-bold text-rose-600 uppercase mt-0.5 whitespace-nowrap">
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
                          <TableCell className="py-3 px-3 whitespace-nowrap">
                            <div className="flex flex-col text-xs">
                              <span className="font-semibold text-slate-700">
                                {item.origination_date}
                              </span>
                              <div className="flex items-center gap-1 mt-0.5">
                                <span className="px-1.5 py-0.2 rounded text-[10px] font-black bg-purple-50 text-purple-700 border border-purple-200">
                                  {item.elapsed_months ?? 0}M Elapsed
                                </span>
                                <span className="text-[10px] font-medium text-slate-400">
                                  ({item.fs_threshold_months ?? 3}M Rule)
                                </span>
                              </div>
                            </div>
                          </TableCell>

                          {/* Maturity / Days Overdue */}
                          <TableCell className="py-3 px-3 whitespace-nowrap">
                            <div className="flex flex-col">
                              <span className="text-xs font-semibold text-slate-700">
                                {item.effective_expiry_date}
                              </span>
                              <div className="mt-1">
                                {item.is_fs_eligible ? (
                                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border ${
                                    isCritical 
                                      ? 'bg-rose-500/15 text-rose-700 border-rose-300' 
                                      : isMedium 
                                        ? 'bg-amber-500/15 text-amber-800 border-amber-300' 
                                        : 'bg-yellow-500/15 text-yellow-800 border-yellow-300'
                                  }`}>
                                    <AlertTriangle className="w-3 h-3" />
                                    FS Overdue ({item.days_overdue}d)
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border bg-sky-50 text-sky-700 border-sky-200">
                                    <Clock className="w-3 h-3" />
                                    In Grace ({Math.max(0, (item.fs_threshold_months || 3) - (item.elapsed_months || 0))}m left)
                                  </span>
                                )}
                              </div>
                            </div>
                          </TableCell>

                          {/* Principal */}
                          <TableCell className="text-right py-3 px-3 whitespace-nowrap">
                            <span className="font-mono font-black text-sm text-slate-900">
                              Rs. {item.principal?.toLocaleString()}
                            </span>
                          </TableCell>

                          {/* Interest Paid History */}
                          <TableCell className="text-right py-3 px-3 whitespace-nowrap">
                            <div className="flex flex-col items-end text-xs">
                              {item.total_interest_paid > 0 ? (
                                <>
                                  <span className="font-mono font-bold text-emerald-700">
                                    Paid: Rs. {item.total_interest_paid.toLocaleString()}
                                  </span>
                                  <span className="text-[10px] text-slate-500">
                                    {item.covered_months} mo. covered
                                  </span>
                                  {item.last_interest_date && (
                                    <span className="text-[9px] text-slate-400">
                                      Last: {item.last_interest_date}
                                    </span>
                                  )}
                                </>
                              ) : (
                                <span className="text-[11px] font-bold text-slate-400">
                                  Rs. 0 Paid
                                </span>
                              )}
                            </div>
                          </TableCell>

                          {/* Outstanding Due Interest */}
                          <TableCell className="text-right py-3 px-3 whitespace-nowrap">
                            <div className="flex flex-col items-end">
                              <span className="font-mono font-black text-sm text-rose-600">
                                Rs. {item.outstanding_interest?.toLocaleString()}
                              </span>
                            </div>
                          </TableCell>

                          {/* SMS Status */}
                          <TableCell className="text-center py-3 px-3 whitespace-nowrap">
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
                          <TableCell className="text-center py-3 px-3 whitespace-nowrap">
                            <div className="flex items-center justify-center gap-1.5">
                              {/* Send SMS Button */}
                              <Button
                                size="sm"
                                disabled={!item.has_phone}
                                onClick={() => openSingleSmsModal(item)}
                                className="h-8 px-2.5 bg-amber-500/15 hover:bg-amber-500/25 text-amber-800 border border-amber-300 font-bold text-xs rounded-xl shadow-none"
                                title={item.has_phone ? "Customize & Send SMS" : "No Phone Available"}
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

        {/* CUSTOMIZABLE SINGLE SMS MODAL */}
        {smsModalItem && (
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl max-w-xl w-full p-6 shadow-2xl border border-slate-100 animate-in zoom-in-95 duration-200 max-h-[92vh] overflow-y-auto">
              <div className="flex justify-between items-center pb-4 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-amber-500/15 text-amber-600 rounded-xl">
                    <MessageSquare className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-slate-900">Customize &amp; Send Warning SMS</h3>
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
                {/* Pawning and Interest Details Pill Grid */}
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-slate-500 block">Customer Name:</span>
                    <strong className="text-slate-900">{smsModalItem.customer_name}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Recipient Mobile:</span>
                    <strong className="text-emerald-700 font-mono">{smsModalItem.customer_phone}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Origination Date &amp; Period:</span>
                    <strong className="text-slate-800">{smsModalItem.origination_date} ({smsModalItem.period_months}M)</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Maturity Expiry Date:</span>
                    <strong className="text-rose-600">{smsModalItem.effective_expiry_date} ({smsModalItem.days_overdue}d overdue)</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Principal Amount:</span>
                    <strong className="text-slate-900 font-mono">Rs. {smsModalItem.principal?.toLocaleString()}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Interest Paid so far:</span>
                    <strong className="text-blue-700 font-mono">Rs. {smsModalItem.total_interest_paid?.toLocaleString()} ({smsModalItem.covered_months} mo.)</strong>
                  </div>
                  <div className="col-span-2 pt-1 border-t border-slate-200 flex justify-between items-center">
                    <span className="text-slate-500 font-semibold">Outstanding Due Interest:</span>
                    <strong className="text-rose-600 font-mono text-sm">Rs. {smsModalItem.outstanding_interest?.toLocaleString()}</strong>
                  </div>
                </div>

                {/* Editable Textarea with Character Counter */}
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                      Editable SMS Message (Customize Before Sending)
                    </label>
                    <button
                      type="button"
                      onClick={() => setSingleCustomMessage(buildItemDefaultSms(smsModalItem))}
                      className="text-[11px] text-amber-700 hover:text-amber-800 font-semibold flex items-center gap-1"
                    >
                      <RotateCcw className="w-3 h-3" /> Reset Template
                    </button>
                  </div>

                  <textarea
                    rows={8}
                    value={singleCustomMessage}
                    onChange={(e) => setSingleCustomMessage(e.target.value)}
                    className="w-full p-3.5 rounded-2xl border border-amber-300 focus:border-amber-500 focus:ring-amber-500 text-xs font-mono bg-amber-50/30 leading-relaxed text-slate-800 shadow-inner"
                    placeholder="Enter customized SMS message..."
                  />

                  <div className="flex justify-between items-center text-[10px] text-slate-500 mt-1">
                    <span>Characters: <strong>{singleCustomMessage.length}</strong> (approx. {Math.ceil(singleCustomMessage.length / 160)} SMS segment)</span>
                    <span className="text-amber-700 font-semibold">Pawning &amp; Interest details auto-filled</span>
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
                  disabled={actionLoading || !singleCustomMessage.trim()}
                  onClick={handleSendSingleSms}
                  className="h-10 px-5 bg-gradient-to-r from-amber-600 to-rose-600 hover:from-amber-700 hover:to-rose-700 text-white font-bold rounded-xl text-xs shadow-md"
                >
                  {actionLoading ? <RefreshCcw className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
                  Confirm &amp; Dispatch SMS
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* CUSTOMIZABLE BULK SMS MODAL */}
        {bulkSmsModalOpen && (
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl max-w-xl w-full p-6 shadow-2xl border border-slate-100 animate-in zoom-in-95 duration-200 max-h-[92vh] overflow-y-auto">
              <div className="flex justify-between items-center pb-4 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-rose-500/15 text-rose-600 rounded-xl">
                    <Send className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-slate-900">Customize &amp; Send Bulk SMS</h3>
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

                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                      Bulk Template with Dynamic Placeholders
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setBulkCustomTemplate(`RUPASINGHE PAWNING (PVT) LTD
Dear {customer_name},
URGENT: Pawn Ticket #{bill_no} [{branch}] (Date: {origination_date})
Principal: Rs. {principal} | Expired: {expiry_date}
Interest Paid: Rs. {interest_paid}
Due Overdue Interest: Rs. {interest_due}
Please settle immediately to avoid collateral forfeiture/auction.
කරුණාකර භාණ්ඩ සින්න වීම වැළැක්වීමට වහාම ශාඛාව අමතන්න.`);
                      }}
                      className="text-[11px] text-amber-700 hover:text-amber-800 font-semibold flex items-center gap-1"
                    >
                      <RotateCcw className="w-3 h-3" /> Reset Template
                    </button>
                  </div>

                  <textarea
                    rows={7}
                    value={bulkCustomTemplate}
                    onChange={(e) => setBulkCustomTemplate(e.target.value)}
                    className="w-full p-3.5 rounded-2xl border border-amber-300 focus:border-amber-500 focus:ring-amber-500 text-xs font-mono bg-amber-50/30 leading-relaxed text-slate-800 shadow-inner"
                    placeholder="Enter dynamic template..."
                  />

                  <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-slate-500">
                    <span>Tags:</span>
                    <code className="bg-slate-100 px-1 rounded text-indigo-700">{"{customer_name}"}</code>
                    <code className="bg-slate-100 px-1 rounded text-indigo-700">{"{bill_no}"}</code>
                    <code className="bg-slate-100 px-1 rounded text-indigo-700">{"{branch}"}</code>
                    <code className="bg-slate-100 px-1 rounded text-indigo-700">{"{principal}"}</code>
                    <code className="bg-slate-100 px-1 rounded text-indigo-700">{"{interest_due}"}</code>
                    <code className="bg-slate-100 px-1 rounded text-indigo-700">{"{interest_paid}"}</code>
                    <code className="bg-slate-100 px-1 rounded text-indigo-700">{"{expiry_date}"}</code>
                    <code className="bg-slate-100 px-1 rounded text-indigo-700">{"{origination_date}"}</code>
                  </div>
                </div>

                {/* Live Preview with First Selected Item */}
                <div>
                  <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block mb-1">
                    Live Preview (Sample for First Selected Item)
                  </label>
                  <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200 text-xs font-mono whitespace-pre-line text-slate-700 leading-relaxed">
                    {bulkPreviewMessage}
                  </div>
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
                  disabled={actionLoading || selectedWithPhoneCount === 0 || !bulkCustomTemplate.trim()}
                  onClick={handleSendBulkSms}
                  className="h-10 px-5 bg-gradient-to-r from-amber-600 to-rose-600 hover:from-amber-700 hover:to-rose-700 text-white font-bold rounded-xl text-xs shadow-md"
                >
                  {actionLoading ? <RefreshCcw className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
                  Dispatch {selectedWithPhoneCount} Custom SMS Messages
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
    </>
  );
}
