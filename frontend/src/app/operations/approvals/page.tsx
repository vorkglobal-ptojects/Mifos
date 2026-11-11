'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { getAuthHeaders } from '@/lib/getAuthHeaders';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow 
} from '@/components/ui/table';
import { 
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter 
} from '@/components/ui/dialog';
import { 
  CheckCircle2, XCircle, ShieldAlert, Sparkles, Inbox, RefreshCcw, 
  Landmark, UserCheck, Search, Filter, Eye, AlertTriangle, 
  RotateCcw, Scale, FileText, Camera, User, DollarSign, 
  Package, Clock, Check, ExternalLink, AlertCircle, ShieldCheck, Building2
} from 'lucide-react';
import { toast } from 'sonner';

interface PawnTransaction {
  id: string;
  bill_no: string;
  client_id: string;
  customer_name?: string;
  phone?: string;
  clients?: {
    first_name?: string;
    last_name?: string;
    national_id?: string;
    phone?: string;
    address?: string;
    photo_url?: string;
    nic_image?: string;
  };
  disbursed_amount: number;
  appraised_value: number;
  interest_rate: number;
  period_months: number;
  weight_grams?: number;
  weight_mg?: number;
  weight?: number;
  status: string;
  branch_id: string;
  created_at: string;
  approved_by?: string;
  approved_at?: string;
  description?: string;
  air_weight_photo_url?: string;
  water_weight_photo_url?: string;
  items?: any[];
}

interface AuditRecord {
  id?: string;
  bill_no: string;
  action: string;
  status: string;
  notes: string;
  auditor_email: string;
  audited_at: string;
  checklist?: any;
}

export default function ApprovalsPage() {
  const [pawns, setPawns] = useState<PawnTransaction[]>([]);
  const [auditMap, setAuditMap] = useState<Record<string, AuditRecord>>({});
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBranch, setSelectedBranch] = useState<string>('ALL');
  const [filterTab, setFilterTab] = useState<'AUDITED' | 'RECHECK' | 'APPROVED' | 'ALL' | 'CHANGE_REQUESTS'>('AUDITED');

  // Change Request Tickets State (Maker-Checker)
  const [changeTickets, setChangeTickets] = useState<any[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<any>(null);
  const [isTicketActionLoading, setIsTicketActionLoading] = useState(false);
  const [isTicketReviewModalOpen, setIsTicketReviewModalOpen] = useState(false);
  const [ticketReviewNotes, setTicketReviewNotes] = useState('');
  const [isRejectTicketModalOpen, setIsRejectTicketModalOpen] = useState(false);
  const [ticketRejectReason, setTicketRejectReason] = useState('');

  // Review Modal State
  const [selectedPawnId, setSelectedPawnId] = useState<string | null>(null);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [dossierLoading, setDossierLoading] = useState(false);
  const [dossier, setDossier] = useState<any>(null);

  // Action Dialogs
  const [isApproveConfirmOpen, setIsApproveConfirmOpen] = useState(false);
  const [isReturnModalOpen, setIsReturnModalOpen] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const [managerCertified, setManagerCertified] = useState(false);
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);

  // Image Zoom Lightbox
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // 1. Load User, Pawns, and Branch Audit Logs
  const loadDashboardData = async () => {
    setLoading(true);
    try {
      const stored = localStorage.getItem('user');
      let currentUser: any = null;
      if (stored) {
        currentUser = JSON.parse(stored);
        setUser(currentUser);
      }

      // Fetch pawns: Managers can access ALL branches including Head Office, or filter by selectedBranch
      const params = new URLSearchParams({
        branchId: selectedBranch === 'ALL' ? '' : selectedBranch,
        role: currentUser?.role || 'MANAGER',
        filterBranch: selectedBranch
      });

      const res = await fetch(`/api/pawns?${params}`, { headers: getAuthHeaders() });
      if (res.ok) {
        const data: PawnTransaction[] = await res.json();
        setPawns(Array.isArray(data) ? data : []);
      } else {
        toast.error('Failed to load transactions');
      }

      // Fetch branch audit logs to map Auditor verification details for each bill
      const logParams = new URLSearchParams({
        action: 'AUDIT_',
        branchId: selectedBranch === 'ALL' ? 'ALL' : selectedBranch
      });
      const logsRes = await fetch(`/api/audit-logs?${logParams}`, { headers: getAuthHeaders() });
      if (logsRes.ok) {
        const logsJson = await logsRes.json();
        const logs = logsJson.logs || [];
        const newMap: Record<string, AuditRecord> = {};

        logs.forEach((log: any) => {
          const bill = log.resource || log.details?.bill_no;
          if (bill && (!newMap[bill] || log.action === 'AUDITOR_APPROVED')) {
            newMap[bill] = {
              id: log.id,
              bill_no: bill,
              action: log.action,
              status: log.details?.status || (log.action === 'AUDITOR_APPROVED' ? 'PASSED' : 'FLAGGED'),
              notes: log.details?.notes || log.details?.note || '',
              auditor_email: log.user_email || log.details?.auditor_email || 'Branch Auditor',
              audited_at: log.created_at || log.details?.confirmed_at || '',
              checklist: log.details?.checklist || null
            };
          }
        });
        setAuditMap(newMap);
      }

      // Fetch change request tickets for Manager/Admin review
      try {
        const ticketParams = new URLSearchParams({
          branch: selectedBranch === 'ALL' ? 'ALL' : selectedBranch
        });
        const tRes = await fetch(`/api/change-requests?${ticketParams}`, { headers: getAuthHeaders() });
        if (tRes.ok) {
          const tJson = await tRes.json();
          setChangeTickets(tJson.tickets || []);
        }
      } catch (tErr) {
        console.warn('Error fetching change tickets:', tErr);
      }
    } catch (e) {
      console.error(e);
      toast.error('An error occurred loading approvals');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboardData();
  }, [selectedBranch]);

  // 2. Load Complete Transaction Dossier for Independent Review
  const handleOpenReview = async (pawnId: string) => {
    setSelectedPawnId(pawnId);
    setDossierLoading(true);
    setManagerCertified(false);
    setIsReviewModalOpen(true);

    try {
      const res = await fetch(`/api/pawns/${pawnId}`, { headers: getAuthHeaders() });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to load transaction dossier');
      }
      const data = await res.json();
      setDossier(data);
    } catch (err: any) {
      toast.error('Error loading review details', { description: err.message });
      setIsReviewModalOpen(false);
    } finally {
      setDossierLoading(false);
    }
  };

  // 3. Action 1: Final Approval
  const handleConfirmFinalApproval = async () => {
    if (!selectedPawnId) return;

    if (!managerCertified) {
      toast.error('Please certify that you have independently reviewed the dossier before approving.');
      return;
    }

    setIsSubmittingAction(true);
    const toastId = toast.loading('Recording Manager final approval & posting to General Ledger...');

    try {
      const res = await fetch(`/api/pawns/${selectedPawnId}/approve`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          approvedBy: user ? `${user.firstName || user.name || user.email || 'Manager'}` : 'Manager'
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to approve pawn ticket');
      }

      toast.success('Pawn Transaction Final Approved!', {
        description: 'Transaction marked as ACTIVE. General Ledger double-entry lines posted successfully.',
        id: toastId
      });

      setIsApproveConfirmOpen(false);
      setIsReviewModalOpen(false);
      loadDashboardData();
    } catch (err: any) {
      toast.error('Final Approval Failed', { description: err.message, id: toastId });
    } finally {
      setIsSubmittingAction(false);
    }
  };

  // Helper to execute change ticket decision with automatic multi-endpoint fallback
  const executeTicketDecisionRequest = async (
    ticketId: string,
    action: 'APPROVE' | 'REJECT',
    notes: string
  ) => {
    const headers = getAuthHeaders();
    const payload = JSON.stringify({ id: ticketId, action, notes });

    // 1. Primary: PATCH /api/change-requests (same serverless bundle as GET /api/change-requests)
    try {
      const res = await fetch('/api/change-requests', {
        method: 'PATCH',
        headers,
        body: payload
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      return data;
    } catch (primaryErr: any) {
      const isNetworkErr =
        !primaryErr?.message ||
        primaryErr.message.includes('Failed to fetch') ||
        primaryErr.message.includes('NetworkError') ||
        primaryErr.message.includes('Load failed');

      if (!isNetworkErr) {
        throw primaryErr;
      }

      // 2. Fallback A: POST /api/change-requests/[id]/approve or /reject
      try {
        const subRoute = action === 'APPROVE' ? 'approve' : 'reject';
        const res2 = await fetch(`/api/change-requests/${encodeURIComponent(ticketId)}/${subRoute}`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ notes })
        });
        const data2 = await res2.json();
        if (!res2.ok) throw new Error(data2.error || `Request failed (${res2.status})`);
        return data2;
      } catch (secondaryErr: any) {
        // 3. Fallback B: GET /api/change-requests?action=...&id=...
        const qs = new URLSearchParams({
          action: action.toLowerCase(),
          id: ticketId,
          notes
        });
        const res3 = await fetch(`/api/change-requests?${qs.toString()}`, {
          method: 'GET',
          headers
        });
        const data3 = await res3.json();
        if (!res3.ok) throw new Error(data3.error || `Request failed (${res3.status})`);
        return data3;
      }
    }
  };

  // Maker-Checker Change Request Handlers
  const handleOpenTicketReview = (ticket: any) => {
    setSelectedTicket(ticket);
    setTicketReviewNotes(ticket.review_notes || '');
    setIsTicketReviewModalOpen(true);
  };

  const handleApproveTicket = async (ticket: any, customNotes?: string) => {
    setIsTicketActionLoading(true);
    const toastId = toast.loading(`Approving ticket ${ticket.ticket_no}...`);
    try {
      const finalNotes = (customNotes ?? ticketReviewNotes).trim() || 'Approved by Branch Manager';
      await executeTicketDecisionRequest(ticket.id, 'APPROVE', finalNotes);
      toast.success(`Ticket ${ticket.ticket_no} approved and applied to database!`, { id: toastId });
      setIsTicketReviewModalOpen(false);
      setSelectedTicket(null);
      setTicketReviewNotes('');
      loadDashboardData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to approve ticket', { id: toastId });
    } finally {
      setIsTicketActionLoading(false);
    }
  };

  const handleRejectTicket = async () => {
    if (!ticketRejectReason.trim()) {
      toast.error('Rejection reason is required');
      return;
    }
    if (!selectedTicket) return;
    setIsTicketActionLoading(true);
    const toastId = toast.loading(`Rejecting ticket ${selectedTicket.ticket_no}...`);
    try {
      await executeTicketDecisionRequest(selectedTicket.id, 'REJECT', ticketRejectReason.trim());
      toast.success(`Ticket ${selectedTicket.ticket_no} marked as REJECTED.`, { id: toastId });
      setIsRejectTicketModalOpen(false);
      setIsTicketReviewModalOpen(false);
      setTicketRejectReason('');
      setSelectedTicket(null);
      loadDashboardData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to reject ticket', { id: toastId });
    } finally {
      setIsTicketActionLoading(false);
    }
  };

  // 4. Action 2: Return / Reject for Recheck
  const handleConfirmReturn = async () => {
    if (!selectedPawnId) return;

    if (!returnReason.trim()) {
      toast.error('A mandatory return reason/note is required.');
      return;
    }

    setIsSubmittingAction(true);
    const toastId = toast.loading('Returning transaction for rechecking...');

    try {
      const res = await fetch(`/api/pawns/${selectedPawnId}/reject`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          reason: returnReason.trim()
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to return transaction');
      }

      toast.success('Transaction Returned for Recheck', {
        description: 'Status updated to REQUIRES_RECHECK. Auditor & staff notified. Stock release blocked.',
        id: toastId
      });

      setIsReturnModalOpen(false);
      setIsReviewModalOpen(false);
      setReturnReason('');
      loadDashboardData();
    } catch (err: any) {
      toast.error('Return Failed', { description: err.message, id: toastId });
    } finally {
      setIsSubmittingAction(false);
    }
  };

  // Derived filtered transactions
  const filteredPawns = useMemo(() => {
    return pawns.filter(p => {
      // Branch check (if specific branch is selected; 'ALL' shows all branches including Head Office)
      if (selectedBranch !== 'ALL') {
        const pawnBranch = (p.branch_id || '').toUpperCase().trim();
        const sel = selectedBranch.toUpperCase().trim();
        if (pawnBranch !== sel && !pawnBranch.includes(sel)) {
          return false;
        }
      }

      // Tab filter
      if (filterTab === 'AUDITED') {
        if (p.status !== 'AUDITED_PENDING_APPROVAL' && p.status !== 'PENDING_APPROVAL') return false;
      } else if (filterTab === 'RECHECK') {
        if (p.status !== 'REQUIRES_RECHECK') return false;
      } else if (filterTab === 'APPROVED') {
        if (p.status !== 'ACTIVE') return false;
      }

      // Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const bill = (p.bill_no || '').toLowerCase();
        const name = (p.clients?.first_name ? `${p.clients.first_name} ${p.clients.last_name || ''}` : p.customer_name || '').toLowerCase();
        const nic = (p.clients?.national_id || '').toLowerCase();
        const phone = (p.clients?.phone || p.phone || '').toLowerCase();
        const desc = (p.description || '').toLowerCase();
        return bill.includes(q) || name.includes(q) || nic.includes(q) || phone.includes(q) || desc.includes(q);
      }

      return true;
    });
  }, [pawns, filterTab, searchQuery, selectedBranch]);

  // Summary Metrics
  const metrics = useMemo(() => {
    const auditedPending = pawns.filter(p => p.status === 'AUDITED_PENDING_APPROVAL' || p.status === 'PENDING_APPROVAL');
    const totalPendingValue = auditedPending.reduce((acc, p) => acc + (p.disbursed_amount || 0), 0);
    const returnedCount = pawns.filter(p => p.status === 'REQUIRES_RECHECK').length;
    const activeCount = pawns.filter(p => p.status === 'ACTIVE').length;

    return {
      auditedCount: auditedPending.length,
      totalPendingValue,
      returnedCount,
      activeCount
    };
  }, [pawns]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <RefreshCcw className="animate-spin h-10 w-10 text-amber-500" />
        <p className="text-sm font-bold text-slate-500 tracking-tight">Loading Manager Approvals Dashboard...</p>
      </div>
    );
  }

  // Maker-Checker Authorization Lock (Only Admin/Manager)
  if (user && user.role !== 'ADMIN' && user.role !== 'MANAGER') {
    return (
      <div className="max-w-2xl mx-auto py-20 px-8 text-center bg-white rounded-3xl border border-slate-200 shadow-xl space-y-6">
        <div className="w-20 h-20 bg-rose-50 rounded-full flex items-center justify-center mx-auto text-rose-600">
          <ShieldAlert className="w-10 h-10" />
        </div>
        <div className="space-y-2">
          <h2 className="text-3xl font-black text-slate-800 tracking-tight">Access Restricted</h2>
          <p className="text-slate-500 font-medium leading-relaxed">
            Managerial authorization is strictly required to review auditor findings and authorize final loan disbursements.
            Please log in with a Manager or Administrator account.
          </p>
        </div>
      </div>
    );
  }

  const pData = dossier?.pawn;
  const cData = dossier?.client;
  const items = dossier?.items || [];
  const evalEv = dossier?.evaluationEvidence;
  const stockItems = dossier?.stockItems || [];
  const transactions = dossier?.transactions || [];
  const auditLogs = dossier?.auditHistory || [];
  const auditorApprovedLog = auditLogs.find((l: any) => l.action === 'AUDITOR_APPROVED');
  const auditorChecklist = auditorApprovedLog?.details?.checklist || null;

  // Safely parse KYC customer pictures
  let customerNicFront: string | null = null;
  let customerNicBack: string | null = null;
  if (cData?.nic_image) {
    try {
      const parsed = JSON.parse(cData.nic_image);
      customerNicFront = parsed.front || null;
      customerNicBack = parsed.back || null;
    } catch {
      if (typeof cData.nic_image === 'string' && (cData.nic_image.startsWith('data:') || cData.nic_image.startsWith('http'))) {
        customerNicFront = cData.nic_image;
      }
    }
  }
  const customerSignature: string | null = cData?.signature_image || null;
  const customerAvatar: string | null = cData?.photo_url || customerNicFront || null;

  return (
    <div className="space-y-8 max-w-[1600px] w-full mx-auto pb-24 animate-in slide-in-from-bottom-4 duration-500">
      
      {/* ── HEADER ── */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center glass p-8 rounded-3xl border-slate-200 shadow-xl gap-6">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="px-3 py-1 bg-amber-500 text-slate-950 font-black text-[10px] tracking-wider rounded-lg uppercase shadow-xs flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" /> Manager Portal
            </span>
            <div className="flex items-center gap-1.5 px-3 py-1 bg-slate-900 text-amber-300 font-black text-[10px] tracking-wider rounded-lg uppercase shadow-xs font-mono">
              <Building2 className="w-3.5 h-3.5 text-amber-400" />
              <span>Scope: {selectedBranch === 'ALL' ? 'All Branches (incl. Head Office)' : `Branch: ${selectedBranch}`}</span>
            </div>
            <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-800 text-[10px] font-bold">
              Auditor-Verified Pipeline
            </Badge>
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-[#202020] tracking-tight leading-none">
            Manager <span className="text-amber-600">Approval Workflow</span>
          </h1>
          <p className="text-slate-600 font-medium text-xs sm:text-sm">
            Review completed Auditor verifications, inspect physical/stock/cash findings, and issue Final Disbursal or Return.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button 
            onClick={loadDashboardData} 
            variant="outline" 
            className="gap-2 font-bold bg-white border-slate-300 text-slate-800 hover:bg-slate-50 shadow-xs rounded-xl"
          >
            <RefreshCcw className="h-4 w-4" /> Refresh
          </Button>
        </div>
      </div>

      {/* ── KPI STATS CARDS ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <Card className="bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent border-amber-200 rounded-3xl shadow-sm">
          <CardContent className="p-6 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black uppercase tracking-wider text-amber-900">Audited • Pending Approval</span>
              <div className="w-9 h-9 rounded-xl bg-amber-500 text-slate-950 flex items-center justify-center font-black shadow-xs">
                <ShieldCheck className="w-5 h-5" />
              </div>
            </div>
            <div className="text-3xl font-black text-slate-900 tracking-tight">{metrics.auditedCount}</div>
            <p className="text-[11px] font-bold text-amber-800">Ready for independent Manager review</p>
          </CardContent>
        </Card>

        <Card className="bg-white border-slate-200 rounded-3xl shadow-sm">
          <CardContent className="p-6 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black uppercase tracking-wider text-slate-500">Pending Disbursal Exposure</span>
              <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-black">
                <DollarSign className="w-5 h-5" />
              </div>
            </div>
            <div className="text-2xl font-black text-slate-900 font-mono tracking-tight">
              Rs. {metrics.totalPendingValue.toLocaleString()}
            </div>
            <p className="text-[11px] font-semibold text-slate-500">Total loan principal waiting for sign-off</p>
          </CardContent>
        </Card>

        <Card className="bg-white border-slate-200 rounded-3xl shadow-sm">
          <CardContent className="p-6 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black uppercase tracking-wider text-slate-500">Returned for Recheck</span>
              <div className="w-9 h-9 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center font-black">
                <RotateCcw className="w-5 h-5" />
              </div>
            </div>
            <div className="text-3xl font-black text-rose-600 tracking-tight">{metrics.returnedCount}</div>
            <p className="text-[11px] font-semibold text-slate-500">Pending correction by branch staff</p>
          </CardContent>
        </Card>

        <Card className="bg-white border-slate-200 rounded-3xl shadow-sm">
          <CardContent className="p-6 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black uppercase tracking-wider text-slate-500">Approved & Active (GL)</span>
              <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-black">
                <CheckCircle2 className="w-5 h-5" />
              </div>
            </div>
            <div className="text-3xl font-black text-emerald-700 tracking-tight">{metrics.activeCount}</div>
            <p className="text-[11px] font-semibold text-slate-500">Fully authorized branch pawn loans</p>
          </CardContent>
        </Card>
      </div>

      {/* ── FILTER & SEARCH BAR ── */}
      <div className="bg-white border border-slate-200 rounded-3xl p-4 sm:p-5 shadow-sm space-y-3">
        <div className="flex flex-col 2xl:flex-row items-stretch 2xl:items-center justify-between gap-3">
          
          {/* Filter Tabs — wrapped cleanly so every tab is always visible with zero scrollbar */}
          <div className="flex flex-wrap items-center gap-1.5 p-1.5 bg-slate-100 rounded-2xl w-full 2xl:w-auto">
            <button
              onClick={() => setFilterTab('CHANGE_REQUESTS')}
              className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                filterTab === 'CHANGE_REQUESTS'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileText className="w-3.5 h-3.5" /> Change Tickets ({changeTickets.filter(t => t.status === 'PENDING').length})
            </button>
            <button
              onClick={() => setFilterTab('AUDITED')}
              className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all cursor-pointer whitespace-nowrap ${
                filterTab === 'AUDITED'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Audited • Ready for Final Review ({metrics.auditedCount})
            </button>
            <button
              onClick={() => setFilterTab('RECHECK')}
              className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all cursor-pointer whitespace-nowrap ${
                filterTab === 'RECHECK'
                  ? 'bg-rose-500 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Returned for Recheck ({metrics.returnedCount})
            </button>
            <button
              onClick={() => setFilterTab('APPROVED')}
              className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all cursor-pointer whitespace-nowrap ${
                filterTab === 'APPROVED'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Approved (Active) ({metrics.activeCount})
            </button>
            <button
              onClick={() => setFilterTab('ALL')}
              className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all cursor-pointer whitespace-nowrap ${
                filterTab === 'ALL'
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All Branch Pawns ({pawns.length})
            </button>
          </div>

          {/* Branch & Search Group */}
          <div className="flex flex-col sm:flex-row items-center justify-end gap-3 w-full 2xl:w-auto shrink-0">
            {/* Branch Selector Dropdown */}
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-2xl px-3 py-2.5 w-full sm:w-auto">
              <Building2 className="w-4 h-4 text-slate-500 shrink-0" />
              <select
                value={selectedBranch}
                onChange={(e) => setSelectedBranch(e.target.value)}
                className="bg-transparent text-xs font-bold text-slate-800 focus:outline-none cursor-pointer w-full sm:w-auto"
              >
                <option value="ALL">All Branches (incl. Head Office)</option>
                <option value="HQ">HQ - Head Office</option>
                <option value="KHT">KHT - Kahathuduwa</option>
                <option value="W4">W4 - Wattala 4</option>
                <option value="BRL">BRL - Borella</option>
                <option value="DHW">DHW - Dehiwala</option>
                <option value="DMT">DMT - Dematagoda</option>
                <option value="HMG">HMG - Homagama</option>
                <option value="KDW">KDW - Kadawatha</option>
                <option value="KIR">KIR - Kiribathgoda</option>
                <option value="KOT">KOT - Kotikawatta</option>
                <option value="KTW">KTW - Kottawa</option>
                <option value="PND">PND - Panadura</option>
                <option value="W2">W2 - Wattala 2</option>
                <option value="W3">W3 - Wattala 3</option>
              </select>
            </div>

            {/* Search Input */}
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search Bill No, Customer, NIC..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-semibold text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all"
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── CHANGE REQUEST TICKETS TABLE (MAKER-CHECKER) ── */}
      {filterTab === 'CHANGE_REQUESTS' ? (
        changeTickets.length === 0 ? (
          <Card className="bg-white border border-slate-200 shadow-sm rounded-3xl py-16 text-center">
            <CardContent className="space-y-3 flex flex-col items-center">
              <div className="w-14 h-14 bg-purple-50 text-purple-600 rounded-full flex items-center justify-center">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <h2 className="text-lg font-black text-slate-900">No Pending Change Request Tickets</h2>
              <p className="text-slate-500 text-xs max-w-md">There are currently no edit or delete requests submitted by Tellers awaiting Manager review for this branch.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
            <Table className="w-full table-auto">
              <TableHeader className="bg-slate-900 text-white">
                <TableRow className="border-b border-slate-800 hover:bg-transparent">
                  <TableHead className="px-3 py-3.5 font-black text-[10px] uppercase tracking-widest text-purple-300">Ticket No & Date</TableHead>
                  <TableHead className="px-3 py-3.5 font-black text-[10px] uppercase tracking-widest text-slate-300">Entity & Branch</TableHead>
                  <TableHead className="px-3 py-3.5 font-black text-[10px] uppercase tracking-widest text-slate-300">Action & Reference</TableHead>
                  <TableHead className="px-3 py-3.5 font-black text-[10px] uppercase tracking-widest text-slate-300">Reason / Justification</TableHead>
                  <TableHead className="px-3 py-3.5 font-black text-[10px] uppercase tracking-widest text-slate-300">Proposed Changes (Diff)</TableHead>
                  <TableHead className="px-3 py-3.5 font-black text-[10px] uppercase tracking-widest text-right text-slate-300">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {changeTickets.map((t: any) => {
                  const isPending = t.status === 'PENDING';
                  const isDelete = t.action_type === 'DELETE' || t.action_type === 'VOID_INTEREST';
                  return (
                    <TableRow
                      key={t.id}
                      onClick={() => handleOpenTicketReview(t)}
                      className="border-b border-slate-100 hover:bg-purple-50/30 transition-colors cursor-pointer"
                    >
                      <TableCell className="px-3 py-3.5 align-top whitespace-normal min-w-[155px]">
                        <div className="font-mono text-xs font-bold text-slate-900 break-words">{t.ticket_no}</div>
                        <div className="text-[10px] text-slate-400 mt-0.5">{t.created_at ? new Date(t.created_at).toLocaleString() : 'N/A'}</div>
                        <Badge variant="outline" className={`mt-1.5 text-[9px] font-black uppercase ${
                          t.status === 'PENDING' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                          t.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'
                        }`}>
                          {t.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="px-3 py-3.5 align-top whitespace-normal min-w-[120px] max-w-[160px]">
                        <Badge variant="outline" className="text-[10px] font-bold bg-slate-100 text-slate-700 border-slate-200">
                          {t.entity_type}
                        </Badge>
                        <div className="text-xs font-bold text-slate-700 mt-1">Branch: {t.branch_id}</div>
                        <div className="text-[10px] text-slate-500 break-words">By: {t.requested_by_name || t.requested_by_email}</div>
                      </TableCell>
                      <TableCell className="px-3 py-3.5 align-top whitespace-normal min-w-[95px]">
                        <Badge variant="outline" className={`text-[10px] font-bold ${
                          isDelete ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-blue-50 text-blue-700 border-blue-200'
                        }`}>
                          {t.action_type}
                        </Badge>
                        <div className="text-xs font-bold text-slate-900 mt-1 break-words">{t.reference_no}</div>
                      </TableCell>
                      <TableCell className="px-3 py-3.5 align-top whitespace-normal min-w-[200px] max-w-[280px]">
                        <div className="w-full text-xs text-slate-800 bg-amber-50/90 px-3 py-2.5 rounded-xl border border-amber-200/80 italic whitespace-normal break-words leading-relaxed shadow-2xs">
                          {t.reason ? `"${t.reason}"` : 'No reason provided'}
                        </div>
                      </TableCell>
                      <TableCell className="px-3 py-3.5 align-top whitespace-normal min-w-[210px] max-w-[300px]">
                        {isDelete ? (
                          <div className="w-fit text-xs font-bold text-rose-600 flex items-center gap-1.5 bg-rose-50 px-2.5 py-2 rounded-xl border border-rose-200/60 whitespace-normal">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            <span>Permanent Delete Requested</span>
                          </div>
                        ) : (
                          <div className="space-y-1.5 text-xs">
                            {Object.entries(t.proposed_data || {}).map(([key, val]: any) => {
                              const curr = t.current_data?.[key];
                              return (
                                <div key={key} className="flex flex-wrap items-center gap-1 text-[11px] leading-snug break-words">
                                  <span className="font-semibold text-slate-500 capitalize">{key.replace(/_/g, ' ')}:</span>
                                  {curr !== undefined && <span className="line-through text-slate-400 break-words">{String(curr)}</span>}
                                  <span className="text-slate-400">➔</span>
                                  <span className="font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded break-words">{String(val)}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="px-3 py-3.5 align-top text-right whitespace-normal min-w-[155px]" onClick={(e) => e.stopPropagation()}>
                        {isPending ? (
                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={isTicketActionLoading}
                              onClick={() => handleOpenTicketReview(t)}
                              className="h-8 px-2.5 rounded-xl bg-slate-900 hover:bg-purple-600 text-white hover:text-white border-slate-900 font-bold text-xs cursor-pointer gap-1"
                            >
                              <Eye className="w-3.5 h-3.5" /> Review
                            </Button>
                            <Button
                              size="sm"
                              disabled={isTicketActionLoading}
                              onClick={() => handleApproveTicket(t, 'Approved by Branch Manager')}
                              className="h-8 px-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs cursor-pointer shadow-xs"
                            >
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={isTicketActionLoading}
                              onClick={() => {
                                setSelectedTicket(t);
                                setTicketRejectReason('');
                                setIsRejectTicketModalOpen(true);
                              }}
                              className="h-8 px-2.5 rounded-xl border-rose-200 hover:bg-rose-50 text-rose-700 font-bold text-xs cursor-pointer"
                            >
                              Reject
                            </Button>
                          </div>
                        ) : (
                          <div className="flex flex-col items-end gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={isTicketActionLoading}
                              onClick={() => handleOpenTicketReview(t)}
                              className="h-8 px-2.5 rounded-xl bg-slate-900 hover:bg-purple-600 text-white hover:text-white border-slate-900 font-bold text-xs cursor-pointer gap-1"
                            >
                              <Eye className="w-3.5 h-3.5" /> Review
                            </Button>
                            <div className="text-[11px] text-slate-500 text-right max-w-[180px] whitespace-normal break-words leading-snug">
                              Reviewed by: <strong className="text-slate-800">{t.reviewed_by_name || 'Manager'}</strong>
                              {t.review_notes && <div className="text-[10px] text-slate-400 italic mt-0.5">"{t.review_notes}"</div>}
                            </div>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )
      ) : null}

      {/* ── TRANSACTIONS LIST ── */}
      {filterTab !== 'CHANGE_REQUESTS' && (filteredPawns.length === 0 ? (
        <Card className="bg-white border border-slate-200 shadow-sm rounded-3xl py-20 text-center">
          <CardContent className="space-y-4 flex flex-col items-center">
            <div className="w-16 h-16 bg-amber-50 text-amber-600 rounded-full flex items-center justify-center">
              <Inbox className="w-8 h-8" />
            </div>
            <div className="space-y-1">
              <h2 className="text-xl font-black text-slate-900">No Transactions Found</h2>
              <p className="text-slate-500 text-xs max-w-md mx-auto">
                {filterTab === 'AUDITED' 
                  ? 'There are currently no pawn transactions in AUDITED_PENDING_APPROVAL awaiting Manager review for your branch.' 
                  : 'No pawn records match the selected filter criteria.'}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
          <Table className="w-full table-auto">
            <TableHeader className="bg-slate-900 text-white">
              <TableRow className="border-b border-slate-800 hover:bg-transparent">
                <TableHead className="px-3 py-3.5 font-black text-[10px] uppercase tracking-widest text-amber-400">Bill No</TableHead>
                <TableHead className="px-3 py-3.5 font-black text-[10px] uppercase tracking-widest text-slate-300">Customer Details</TableHead>
                <TableHead className="px-3 py-3.5 font-black text-[10px] uppercase tracking-widest text-slate-300">Item & Weight</TableHead>
                <TableHead className="px-3 py-3.5 font-black text-[10px] uppercase tracking-widest text-slate-300 text-right">Disbursed Loan</TableHead>
                <TableHead className="px-3 py-3.5 font-black text-[10px] uppercase tracking-widest text-slate-300">Auditor Status</TableHead>
                <TableHead className="px-3 py-3.5 font-black text-[10px] uppercase tracking-widest text-slate-300">Status</TableHead>
                <TableHead className="px-3 py-3.5 text-right font-black text-[10px] uppercase tracking-widest text-slate-300">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-slate-100">
              {filteredPawns.map(pawn => {
                const cleanBill = pawn.bill_no || pawn.id.substring(0, 8).toUpperCase();
                const auditRecord = auditMap[cleanBill] || auditMap[pawn.id];
                const custName = pawn.clients?.first_name 
                  ? `${pawn.clients.first_name} ${pawn.clients.last_name || ''}`.trim()
                  : pawn.customer_name || 'Customer';
                const isAwaitingManager = pawn.status === 'AUDITED_PENDING_APPROVAL' || pawn.status === 'PENDING_APPROVAL';

                return (
                  <TableRow
                    key={pawn.id}
                    onClick={() => handleOpenReview(pawn.id)}
                    className="hover:bg-amber-50/30 transition-all duration-200 cursor-pointer"
                  >
                    
                    {/* Bill No */}
                    <TableCell className="px-3 py-3.5 align-middle whitespace-nowrap">
                      <div className="flex flex-col">
                        <span className="font-mono font-black text-slate-950 text-xs sm:text-sm">{cleanBill}</span>
                        <span className="text-[10px] font-bold text-slate-400 mt-0.5">
                          {new Date(pawn.created_at).toLocaleDateString('en-GB')}
                        </span>
                      </div>
                    </TableCell>

                    {/* Customer */}
                    <TableCell className="px-3 py-3.5 align-middle whitespace-normal min-w-[130px] max-w-[190px]">
                      <div className="flex flex-col">
                        <span className="font-black text-slate-900 text-xs break-words">{custName}</span>
                        <span className="text-[10px] font-mono text-slate-500 break-words">
                          NIC: {pawn.clients?.national_id || 'N/A'}
                        </span>
                      </div>
                    </TableCell>

                    {/* Collateral & Weight */}
                    <TableCell className="px-3 py-3.5 align-middle whitespace-normal min-w-[170px] max-w-[260px]">
                      <div className="flex flex-col">
                        <span className="font-bold text-slate-800 text-xs break-words line-clamp-2 leading-snug">
                          {pawn.description || 'Gold Jewelry'}
                        </span>
                        <span className="text-[10px] font-semibold text-slate-500 mt-0.5">
                          Weight: {pawn.weight_mg ? `${pawn.weight_mg.toLocaleString()} mg` : (pawn.weight_grams ? `${Math.round(pawn.weight_grams * 1000).toLocaleString()} mg` : (pawn.weight ? `${Math.round(Number(pawn.weight) * 1000).toLocaleString()} mg` : '—'))}
                        </span>
                      </div>
                    </TableCell>

                    {/* Disbursed Loan */}
                    <TableCell className="px-3 py-3.5 align-middle text-right whitespace-nowrap">
                      <div className="flex flex-col items-end">
                        <span className="font-mono font-black text-slate-950 text-xs sm:text-sm">
                          Rs. {(pawn.disbursed_amount || 0).toLocaleString()}
                        </span>
                        <span className="text-[10px] font-bold text-slate-400">
                          Val: Rs. {(pawn.appraised_value || 0).toLocaleString()}
                        </span>
                      </div>
                    </TableCell>

                    {/* Auditor Status */}
                    <TableCell className="px-3 py-3.5 align-middle whitespace-nowrap">
                      {auditRecord?.action === 'AUDITOR_APPROVED' || pawn.status === 'AUDITED_PENDING_APPROVAL' ? (
                        <div className="flex flex-col items-start gap-1">
                          <Badge className="bg-emerald-50 text-emerald-800 border-emerald-300 font-black text-[9px] uppercase tracking-wider flex items-center gap-1">
                            <Check className="w-3 h-3 text-emerald-600" /> AUDITOR VERIFIED
                          </Badge>
                          <span className="text-[10px] font-semibold text-slate-500 truncate max-w-[130px]">
                            {auditRecord?.auditor_email || 'Auditor'}
                          </span>
                        </div>
                      ) : pawn.status === 'REQUIRES_RECHECK' ? (
                        <Badge className="bg-rose-50 text-rose-800 border-rose-300 font-black text-[9px] uppercase tracking-wider flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 text-rose-600" /> REQUIRES RECHECK
                        </Badge>
                      ) : (
                        <span className="text-[11px] font-bold text-slate-400 italic">
                          Awaiting Audit
                        </span>
                      )}
                    </TableCell>

                    {/* Status Badge */}
                    <TableCell className="px-3 py-3.5 align-middle whitespace-nowrap">
                      <Badge className={`font-black text-[9px] uppercase tracking-wider px-2 py-0.5 border ${
                        pawn.status === 'AUDITED_PENDING_APPROVAL'
                          ? 'bg-amber-100 text-amber-900 border-amber-300'
                          : pawn.status === 'ACTIVE'
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                          : pawn.status === 'REQUIRES_RECHECK'
                          ? 'bg-rose-100 text-rose-900 border-rose-300'
                          : 'bg-slate-100 text-slate-700 border-slate-300'
                      }`}>
                        {pawn.status === 'AUDITED_PENDING_APPROVAL' ? 'READY FOR MANAGER' : pawn.status}
                      </Badge>
                    </TableCell>

                    {/* Action Button */}
                    <TableCell className="px-3 py-3.5 align-middle text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      <Button
                        size="sm"
                        onClick={() => handleOpenReview(pawn.id)}
                        className={`font-black text-[11px] uppercase tracking-wider h-9 px-3 rounded-xl gap-1.5 transition-all shadow-xs cursor-pointer ${
                          isAwaitingManager
                            ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                            : 'bg-slate-900 hover:bg-amber-500 hover:text-slate-950 text-white'
                        }`}
                      >
                        {isAwaitingManager ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5" /> Review & Approve
                          </>
                        ) : (
                          <>
                            <Eye className="w-3.5 h-3.5" /> Review & Decide
                          </>
                        )}
                      </Button>
                    </TableCell>

                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ))}

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* ── COMPREHENSIVE MANAGER REVIEW MODAL ── */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      <Dialog open={isReviewModalOpen} onOpenChange={setIsReviewModalOpen}>
        <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto p-0 rounded-3xl border-slate-200">
          
          {dossierLoading ? (
            <div className="p-16 flex flex-col items-center justify-center space-y-4">
              <RefreshCcw className="w-10 h-10 animate-spin text-amber-500" />
              <p className="text-sm font-bold text-slate-600">Loading complete transaction dossier & auditor logs...</p>
            </div>
          ) : !pData ? (
            <div className="p-10 text-center space-y-3">
              <AlertTriangle className="w-10 h-10 text-rose-500 mx-auto" />
              <h3 className="text-lg font-black text-slate-900">Transaction Not Found</h3>
              <p className="text-xs text-slate-500">Could not retrieve dossier details for this transaction.</p>
            </div>
          ) : (
            <div className="space-y-6 pb-6">

              {/* Dossier Header Banner */}
              <div className="p-6 bg-slate-900 text-white rounded-t-3xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-2.5 py-0.5 bg-amber-500 text-slate-950 font-black text-[10px] uppercase rounded-md">
                      Manager Review Dossier
                    </span>
                    <Badge variant="outline" className="border-slate-700 text-slate-300 text-[10px] font-mono">
                      Branch: {pData.branch_id || 'HQ'}
                    </Badge>
                    <Badge className={`font-black text-[10px] uppercase ${
                      pData.status === 'AUDITED_PENDING_APPROVAL' ? 'bg-amber-400 text-slate-950' : 'bg-slate-700 text-white'
                    }`}>
                      {pData.status}
                    </Badge>
                  </div>
                  <h2 className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
                    Bill #{pData.bill_no || pData.id.substring(0, 8).toUpperCase()}
                  </h2>
                  <p className="text-xs text-slate-400 font-semibold">
                    Originated on {new Date(pData.created_at).toLocaleString('en-GB')}
                  </p>
                </div>

                <div className="text-right sm:border-l sm:border-slate-800 sm:pl-6">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Requested Cash Loan</span>
                  <div className="text-2xl font-black text-amber-400 font-mono tracking-tight">
                    Rs. {(pData.disbursed_amount || 0).toLocaleString()}
                  </div>
                  <span className="text-[10px] font-semibold text-slate-400">
                    Appraisal: Rs. {(pData.appraised_value || 0).toLocaleString()}
                  </span>
                </div>
              </div>

              <div className="px-6 space-y-6">

                {/* ── AUDITOR VERIFICATION SUMMARY CARD ── */}
                <div className="bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent border-2 border-emerald-500/30 rounded-3xl p-5 shadow-xs space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-emerald-500/20 pb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-black shadow-xs">
                        <Check className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                          Auditor Verification Results
                          <Badge className="bg-emerald-600 text-white font-black text-[9px] uppercase">
                            VERIFIED & PASSED
                          </Badge>
                        </h3>
                        <p className="text-xs font-semibold text-slate-600">
                          Auditor: <strong className="text-slate-900">{auditorApprovedLog?.user_email || auditorApprovedLog?.details?.auditor_email || 'Branch Auditor'}</strong> • {auditorApprovedLog?.created_at ? new Date(auditorApprovedLog.created_at).toLocaleString('en-GB') : 'Verified'}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Auditor Checklist 10 Points */}
                  {auditorChecklist ? (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs font-bold text-slate-700">
                      <div className="p-2.5 bg-white rounded-xl border border-emerald-200 flex items-center justify-between">
                        <span>Physical Item:</span>
                        <Badge className={auditorChecklist.physicalExists ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}>
                          {auditorChecklist.physicalExists ? 'Exists' : 'No'}
                        </Badge>
                      </div>
                      <div className="p-2.5 bg-white rounded-xl border border-emerald-200 flex items-center justify-between">
                        <span>Item Details:</span>
                        <Badge className={auditorChecklist.itemMatches ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}>
                          {auditorChecklist.itemMatches ? 'Matched' : 'Differs'}
                        </Badge>
                      </div>
                      <div className="p-2.5 bg-white rounded-xl border border-emerald-200 flex items-center justify-between">
                        <span>Weight Matches:</span>
                        <Badge className={auditorChecklist.weightMatches ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}>
                          {auditorChecklist.weightMatches ? 'Matched' : 'Differs'}
                        </Badge>
                      </div>
                      <div className="p-2.5 bg-white rounded-xl border border-emerald-200 flex items-center justify-between">
                        <span>Karat Matches:</span>
                        <Badge className={auditorChecklist.karatMatches ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}>
                          {auditorChecklist.karatMatches ? 'Matched' : 'Differs'}
                        </Badge>
                      </div>
                      <div className="p-2.5 bg-white rounded-xl border border-emerald-200 flex items-center justify-between">
                        <span>Observed Weight:</span>
                        <span className="font-mono font-black text-slate-900">
                          {auditorChecklist.observedWeight ? `${auditorChecklist.observedWeight} mg` : 'Verified'}
                        </span>
                      </div>
                      <div className="p-2.5 bg-white rounded-xl border border-emerald-200 flex items-center justify-between">
                        <span>Observed Karat:</span>
                        <span className="font-mono font-black text-slate-900">
                          {auditorChecklist.observedKarat || 'Verified'}
                        </span>
                      </div>
                      <div className="p-2.5 bg-white rounded-xl border border-emerald-200 flex items-center justify-between">
                        <span>Stock Verified:</span>
                        <Badge className={auditorChecklist.stockVerified ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'}>
                          {auditorChecklist.stockVerified ? 'Verified' : 'Pending'}
                        </Badge>
                      </div>
                      <div className="p-2.5 bg-white rounded-xl border border-emerald-200 flex items-center justify-between">
                        <span>Cash Verified:</span>
                        <Badge className={auditorChecklist.cashVerified ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'}>
                          {auditorChecklist.cashVerified ? 'Verified' : 'Pending'}
                        </Badge>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500 italic font-semibold">
                      Standard Auditor compliance checks passed and recorded on file.
                    </p>
                  )}

                  {/* Auditor Notes */}
                  {auditorApprovedLog?.details?.notes && (
                    <div className="p-3 bg-white rounded-2xl border border-emerald-200 text-xs space-y-1">
                      <span className="text-[10px] font-black uppercase text-slate-400">Auditor Observation Notes:</span>
                      <p className="font-bold text-slate-800 italic">
                        "{auditorApprovedLog.details.notes}"
                      </p>
                    </div>
                  )}
                </div>

                {/* ── 2 COLUMN GRID: CUSTOMER & PAWN DETAILS ── */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  
                  {/* Customer Details */}
                  <div className="glass p-5 rounded-3xl border border-slate-200 space-y-3">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                      <h4 className="text-sm font-black text-slate-900 flex items-center gap-2">
                        <User className="w-4 h-4 text-amber-600" /> Customer KYC Details
                      </h4>
                      <Badge variant="outline" className="text-[9px] uppercase font-bold">KYC Verified</Badge>
                    </div>

                    <div className="flex gap-4 items-start">
                      <div className="w-20 h-20 bg-slate-100 rounded-2xl overflow-hidden border border-slate-200 flex items-center justify-center shrink-0">
                        {customerAvatar ? (
                          <img 
                            src={customerAvatar} 
                            alt="Customer" 
                            className="w-full h-full object-cover cursor-zoom-in hover:scale-105 transition-all"
                            onClick={() => setPreviewImage(customerAvatar)}
                          />
                        ) : (
                          <User className="w-8 h-8 text-slate-400" />
                        )}
                      </div>

                      <div className="space-y-1 text-xs">
                        <p className="font-black text-slate-900 text-sm">
                          {cData?.first_name ? `${cData.first_name} ${cData.last_name || ''}`.trim() : pData.customer_name || 'Customer'}
                        </p>
                        <p className="font-semibold text-slate-600">
                          NIC: <strong className="font-mono text-slate-900">{cData?.national_id || 'N/A'}</strong>
                        </p>
                        <p className="font-semibold text-slate-600">
                          Phone: <strong className="text-slate-900">{cData?.phone || pData.phone || 'N/A'}</strong>
                        </p>
                        <p className="font-semibold text-slate-600 text-[11px] line-clamp-2">
                          Address: {cData?.address || 'Registered branch address'}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Pawn Loan Terms */}
                  <div className="glass p-5 rounded-3xl border border-slate-200 space-y-3">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                      <h4 className="text-sm font-black text-slate-900 flex items-center gap-2">
                        <FileText className="w-4 h-4 text-amber-600" /> Loan Terms & Collateral
                      </h4>
                      <Badge variant="outline" className="text-[9px] uppercase font-bold">Terms</Badge>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-[10px] font-bold text-slate-400 block">Gross Weight</span>
                        <strong className="font-mono text-slate-900">
                          {pData.weight_mg ? `${pData.weight_mg.toLocaleString()} mg` : (pData.weight_grams ? `${Math.round(pData.weight_grams * 1000).toLocaleString()} mg` : (pData.weight ? `${Math.round(Number(pData.weight) * 1000).toLocaleString()} mg` : '—'))}
                        </strong>
                      </div>
                      <div>
                        <span className="text-[10px] font-bold text-slate-400 block">Interest Rate</span>
                        <strong className="text-slate-900">{pData.interest_rate || 2.5}% monthly</strong>
                      </div>
                      <div>
                        <span className="text-[10px] font-bold text-slate-400 block">Loan Period</span>
                        <strong className="text-slate-900">{pData.period_months || 12} Months</strong>
                      </div>
                      <div>
                        <span className="text-[10px] font-bold text-slate-400 block">Description</span>
                        <strong className="text-slate-900 truncate block">{pData.description || 'Gold Article'}</strong>
                      </div>
                    </div>

                    {/* Breakdown of items */}
                    {items && items.length > 0 && (
                      <div className="pt-2 border-t border-slate-100 space-y-1">
                        <span className="text-[10px] font-black uppercase text-slate-400">Pawn Items Breakdown:</span>
                        <div className="space-y-1 max-h-24 overflow-y-auto">
                          {items.map((it: any) => (
                            <div key={it.id} className="flex justify-between text-[11px] font-semibold text-slate-700 bg-slate-50 px-2.5 py-1 rounded-lg">
                              <span>{it.item_type || 'Gold'} ({it.purity || '22K'})</span>
                              <span className="font-mono">{it.weight_mg ? `${it.weight_mg.toLocaleString()} mg` : `${Math.round((it.weight_grams || 0) * 1000).toLocaleString()} mg`} • Rs. {(it.appraised_value || 0).toLocaleString()}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* ── CUSTOMER KYC IDENTITY PHOTOS & EVIDENCE ── */}
                <div className="glass p-5 rounded-3xl border border-slate-200 space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                    <h4 className="text-sm font-black text-slate-900 flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-emerald-600" /> Customer KYC Photos & Signature Verification
                    </h4>
                    <span className="text-[11px] font-bold text-slate-400">Captured Identity Evidence</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {/* NIC Front */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                        <span>NIC Front Side</span>
                        {customerNicFront ? (
                          <span className="text-[10px] text-emerald-700 font-bold bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md flex items-center gap-1">
                            <Check className="w-2.5 h-2.5" /> Captured
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-400 font-medium">Missing</span>
                        )}
                      </div>
                      <div 
                        className="w-full aspect-[4/3] bg-slate-900 rounded-2xl overflow-hidden flex items-center justify-center cursor-zoom-in group relative border border-slate-200 shadow-xs"
                        onClick={() => customerNicFront && setPreviewImage(customerNicFront)}
                      >
                        {customerNicFront ? (
                          <>
                            <img 
                              src={customerNicFront} 
                              alt="NIC Front" 
                              className="w-full h-full object-contain group-hover:scale-105 transition-all"
                            />
                            <span className="absolute bottom-2 right-2 bg-black/75 text-white text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1 opacity-90 group-hover:opacity-100">
                              <Eye className="w-3 h-3" /> Zoom
                            </span>
                          </>
                        ) : (
                          <span className="text-xs text-slate-400 font-bold">No NIC front photo</span>
                        )}
                      </div>
                    </div>

                    {/* NIC Back */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                        <span>NIC Back Side</span>
                        {customerNicBack ? (
                          <span className="text-[10px] text-emerald-700 font-bold bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md flex items-center gap-1">
                            <Check className="w-2.5 h-2.5" /> Captured
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-400 font-medium">Missing</span>
                        )}
                      </div>
                      <div 
                        className="w-full aspect-[4/3] bg-slate-900 rounded-2xl overflow-hidden flex items-center justify-center cursor-zoom-in group relative border border-slate-200 shadow-xs"
                        onClick={() => customerNicBack && setPreviewImage(customerNicBack)}
                      >
                        {customerNicBack ? (
                          <>
                            <img 
                              src={customerNicBack} 
                              alt="NIC Back" 
                              className="w-full h-full object-contain group-hover:scale-105 transition-all"
                            />
                            <span className="absolute bottom-2 right-2 bg-black/75 text-white text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1 opacity-90 group-hover:opacity-100">
                              <Eye className="w-3 h-3" /> Zoom
                            </span>
                          </>
                        ) : (
                          <span className="text-xs text-slate-400 font-bold">No NIC back photo</span>
                        )}
                      </div>
                    </div>

                    {/* Customer Signature */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                        <span>Customer Signature</span>
                        {customerSignature ? (
                          <span className="text-[10px] text-emerald-700 font-bold bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md flex items-center gap-1">
                            <Check className="w-2.5 h-2.5" /> Verified
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-400 font-medium">Missing</span>
                        )}
                      </div>
                      <div 
                        className="w-full aspect-[4/3] bg-white rounded-2xl overflow-hidden flex items-center justify-center cursor-zoom-in group relative border border-slate-200 shadow-xs p-2"
                        onClick={() => customerSignature && setPreviewImage(customerSignature)}
                      >
                        {customerSignature ? (
                          <>
                            <img 
                              src={customerSignature} 
                              alt="Customer Signature" 
                              className="w-full h-full object-contain group-hover:scale-105 transition-all"
                            />
                            <span className="absolute bottom-2 right-2 bg-black/75 text-white text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1 opacity-90 group-hover:opacity-100">
                              <Eye className="w-3 h-3" /> Zoom
                            </span>
                          </>
                        ) : (
                          <span className="text-xs text-slate-400 font-bold">No signature photo</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* ── UPLOADED SCALE EVIDENCE IMAGES ── */}
                <div className="glass p-5 rounded-3xl border border-slate-200 space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                    <h4 className="text-sm font-black text-slate-900 flex items-center gap-2">
                      <Camera className="w-4 h-4 text-amber-600" /> Uploaded Evidence & Scale Photos
                    </h4>
                    <span className="text-[11px] font-bold text-slate-400">Archimedes Hydrostatic Verification</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Air Weight Photo */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                        <span>Air Weight Photo (In Air)</span>
                        <span className="font-mono text-slate-500">
                          {evalEv?.air_weight ? `${evalEv.air_weight} mg` : ''}
                        </span>
                      </div>
                      <div 
                        className="w-full aspect-video bg-black/90 rounded-2xl overflow-hidden flex items-center justify-center cursor-zoom-in group relative border border-slate-200"
                        onClick={() => evalEv?.air_weight_photo_url && setPreviewImage(evalEv.air_weight_photo_url)}
                      >
                        {evalEv?.air_weight_photo_url ? (
                          <>
                            <img 
                              src={evalEv.air_weight_photo_url} 
                              alt="Air weight scale" 
                              className="w-full h-full object-contain group-hover:scale-105 transition-all"
                            />
                            <span className="absolute bottom-2 right-2 bg-black/75 text-white text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1">
                              <Eye className="w-3 h-3" /> Zoom
                            </span>
                          </>
                        ) : (
                          <span className="text-xs text-slate-400 font-bold">No air weight photo attached</span>
                        )}
                      </div>
                    </div>

                    {/* Water Weight Photo */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                        <span>Water Weight Photo (In Water)</span>
                        <span className="font-mono text-slate-500">
                          {evalEv?.water_weight ? `${evalEv.water_weight} mg` : ''}
                        </span>
                      </div>
                      <div 
                        className="w-full aspect-video bg-black/90 rounded-2xl overflow-hidden flex items-center justify-center cursor-zoom-in group relative border border-slate-200"
                        onClick={() => evalEv?.water_weight_photo_url && setPreviewImage(evalEv.water_weight_photo_url)}
                      >
                        {evalEv?.water_weight_photo_url ? (
                          <>
                            <img 
                              src={evalEv.water_weight_photo_url} 
                              alt="Water weight scale" 
                              className="w-full h-full object-contain group-hover:scale-105 transition-all"
                            />
                            <span className="absolute bottom-2 right-2 bg-black/75 text-white text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1">
                              <Eye className="w-3 h-3" /> Zoom
                            </span>
                          </>
                        ) : (
                          <span className="text-xs text-slate-400 font-bold">No water weight photo attached</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* ── STOCK & CASH RECONCILIATION ── */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  
                  {/* Stock Verification Results */}
                  <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                        <Package className="w-4 h-4 text-amber-600" /> Stock Verification Results
                      </span>
                      <Badge className="bg-emerald-50 text-emerald-800 border-emerald-300 font-bold text-[9px] uppercase">
                        {stockItems.length > 0 ? 'Item Recorded' : 'Pre-Allocation'}
                      </Badge>
                    </div>
                    {stockItems.length > 0 ? (
                      <div className="space-y-1.5 text-xs">
                        {stockItems.map((stk: any) => (
                          <div key={stk.id} className="p-2.5 bg-white rounded-xl border border-slate-200 flex justify-between font-semibold">
                            <span>Sub-bill: <strong className="font-mono text-slate-900">{stk.bill_no}</strong> ({stk.item_type})</span>
                            <span className="font-mono font-black">{stk.weight_mg ? `${stk.weight_mg} mg` : `${Math.round((parseFloat(stk.weight) || 0) * 1000)} mg`}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500 font-medium">
                        Collateral ready for safe custody transfer upon Manager approval.
                      </p>
                    )}
                  </div>

                  {/* Cash Verification Results */}
                  <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                        <DollarSign className="w-4 h-4 text-amber-600" /> Cash Verification Results
                      </span>
                      <Badge className="bg-emerald-50 text-emerald-800 border-emerald-300 font-bold text-[9px] uppercase">
                        GL Prepared
                      </Badge>
                    </div>
                    <div className="space-y-1 text-xs">
                      <p className="text-slate-600">
                        Disbursement Amount: <strong className="font-mono text-slate-900 font-black">Rs. {(pData.disbursed_amount || 0).toLocaleString()}</strong>
                      </p>
                      <p className="text-slate-600">
                        Posting Account: <strong className="text-slate-900">Vault Cash (Asset) ➔ Pawn Loan Portfolio (Asset)</strong>
                      </p>
                      <p className="text-[11px] text-slate-500">
                        Automated double-entry lines will execute immediately upon final authorization.
                      </p>
                    </div>
                  </div>
                </div>

                {/* ── AUDIT & ISSUE HISTORY TRAIL ── */}
                <div className="glass p-5 rounded-3xl border border-slate-200 space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <h4 className="text-xs font-black text-slate-900 flex items-center gap-2">
                      <Clock className="w-4 h-4 text-amber-600" /> Complete Audit Trail & Issue History
                    </h4>
                    <span className="text-[10px] font-mono font-bold text-slate-400">
                      {auditLogs.length} events logged
                    </span>
                  </div>

                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {auditLogs.length > 0 ? (
                      auditLogs.map((log: any, idx: number) => {
                        const isIssue = log.action === 'AUDIT_ISSUE_RAISED';
                        const isReturn = log.action === 'MANAGER_RETURNED';
                        const isApproval = log.action === 'AUDITOR_APPROVED' || log.action === 'MANAGER_APPROVED';

                        return (
                          <div 
                            key={log.id || idx} 
                            className={`p-3 rounded-xl border text-xs space-y-1 ${
                              isIssue || isReturn 
                                ? 'bg-rose-50/80 border-rose-200 text-rose-900' 
                                : isApproval 
                                ? 'bg-emerald-50/80 border-emerald-200 text-emerald-900' 
                                : 'bg-slate-50 border-slate-200 text-slate-800'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-black text-[10px] uppercase tracking-wider">
                                {log.action} • {log.user_email || 'Staff'}
                              </span>
                              <span className="font-mono text-[10px] text-slate-500">
                                {log.created_at ? new Date(log.created_at).toLocaleString('en-GB') : ''}
                              </span>
                            </div>
                            <p className="font-semibold text-[11px]">
                              {log.details?.reason || log.details?.notes || log.details?.note || 'Event recorded'}
                            </p>
                          </div>
                        );
                      })
                    ) : (
                      <p className="text-xs text-slate-400 italic font-semibold">No prior issues recorded for this ticket.</p>
                    )}
                  </div>
                </div>

                {/* ── MANAGER INDEPENDENT REVIEW DECLARATION ── */}
                <div className="p-4 bg-amber-500/10 border-2 border-amber-500/30 rounded-2xl flex items-start gap-3">
                  <input
                    type="checkbox"
                    id="mgr-declaration"
                    checked={managerCertified}
                    onChange={(e) => setManagerCertified(e.target.checked)}
                    className="w-5 h-5 rounded mt-0.5 text-amber-600 focus:ring-amber-500 cursor-pointer"
                  />
                  <label htmlFor="mgr-declaration" className="text-xs font-bold text-amber-950 cursor-pointer leading-relaxed">
                    <strong>Manager Certification:</strong> I have independently inspected customer identification, pawn collateral descriptions, hydrostatic scale photographs, auditor verification outcomes, stock records, and cash balances for this branch ticket.
                  </label>
                </div>

              </div>

              {/* ── DIALOG FOOTER: THE TWO MANDATORY ACTIONS ── */}
              <div className="p-6 bg-slate-50 rounded-b-3xl border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
                <Button
                  variant="outline"
                  onClick={() => setIsReviewModalOpen(false)}
                  className="w-full sm:w-auto font-bold rounded-xl text-slate-600"
                >
                  Close Dossier
                </Button>

                <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                  {/* Action 2: RETURN / REJECT */}
                  <Button
                    onClick={() => {
                      setReturnReason('');
                      setIsReturnModalOpen(true);
                    }}
                    className="w-full sm:w-auto bg-white hover:bg-rose-50 text-rose-600 hover:text-rose-700 border border-rose-300 font-black text-xs uppercase tracking-wider h-11 px-5 rounded-2xl gap-2 cursor-pointer shadow-xs"
                  >
                    <RotateCcw className="w-4 h-4" /> Return / Reject
                  </Button>

                  {/* Action 1: FINAL APPROVE */}
                  <Button
                    onClick={() => {
                      if (!managerCertified) {
                        toast.error('Please certify that you have independently reviewed the dossier before approving.');
                        return;
                      }
                      setIsApproveConfirmOpen(true);
                    }}
                    disabled={pData.status === 'REQUIRES_RECHECK'}
                    className="w-full sm:w-auto bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 text-white font-black text-xs uppercase tracking-wider h-11 px-6 rounded-2xl gap-2 cursor-pointer shadow-lg shadow-emerald-600/20"
                  >
                    <CheckCircle2 className="w-4 h-4" /> Final Approve
                  </Button>
                </div>
              </div>

            </div>
          )}

        </DialogContent>
      </Dialog>

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* ── RETURN / REJECT REASON MODAL ── */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      <Dialog open={isReturnModalOpen} onOpenChange={setIsReturnModalOpen}>
        <DialogContent className="max-w-md rounded-3xl border-slate-200 p-6 space-y-4">
          <DialogHeader className="space-y-1">
            <div className="w-12 h-12 bg-rose-50 rounded-2xl flex items-center justify-center text-rose-600 mx-auto sm:mx-0">
              <RotateCcw className="w-6 h-6" />
            </div>
            <DialogTitle className="text-xl font-black text-slate-900">
              Return Transaction for Recheck
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 font-medium">
              Please specify the exact reason or observation. This reason will be recorded in the audit log and the transaction will be returned to branch staff for correction.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label className="text-xs font-black uppercase text-slate-700">
              Return / Rejection Reason <span className="text-rose-500">*</span>
            </label>
            <textarea
              rows={4}
              value={returnReason}
              onChange={(e) => setReturnReason(e.target.value)}
              placeholder="e.g. Weight mismatch on scale photo, unclear customer NIC image, or discrepancy in carat valuation..."
              className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
            />
          </div>

          <DialogFooter className="flex sm:justify-between gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => setIsReturnModalOpen(false)}
              className="rounded-xl font-bold"
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirmReturn}
              disabled={isSubmittingAction || !returnReason.trim()}
              className="bg-rose-600 hover:bg-rose-700 text-white font-black text-xs uppercase tracking-wider rounded-xl gap-2 cursor-pointer shadow-md"
            >
              {isSubmittingAction ? <RefreshCcw className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
              Submit Return Note
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* ── FINAL APPROVE CONFIRMATION MODAL ── */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      <Dialog open={isApproveConfirmOpen} onOpenChange={setIsApproveConfirmOpen}>
        <DialogContent className="max-w-md rounded-3xl border-slate-200 p-6 space-y-4">
          <DialogHeader className="space-y-1">
            <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600 mx-auto sm:mx-0">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <DialogTitle className="text-xl font-black text-slate-900">
              Confirm Final Disbursal Approval
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 font-medium">
              You are authorizing final approval for Bill #{pData?.bill_no || pData?.id?.substring(0, 8)}.
              This will update the transaction state to ACTIVE, post double-entry journal entries to the General Ledger, and allow the transaction to proceed to stock management.
            </DialogDescription>
          </DialogHeader>

          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-1.5 text-xs font-semibold text-slate-700">
            <div className="flex justify-between">
              <span>Manager Approver:</span>
              <strong className="text-slate-900">{user?.email || 'Manager'}</strong>
            </div>
            <div className="flex justify-between">
              <span>Operating Branch:</span>
              <strong className="font-mono text-slate-900">{pData?.branch_id}</strong>
            </div>
            <div className="flex justify-between">
              <span>Disbursed Amount:</span>
              <strong className="font-mono text-emerald-700 font-black">Rs. {(pData?.disbursed_amount || 0).toLocaleString()}</strong>
            </div>
          </div>

          <DialogFooter className="flex sm:justify-between gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => setIsApproveConfirmOpen(false)}
              className="rounded-xl font-bold"
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirmFinalApproval}
              disabled={isSubmittingAction}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase tracking-wider rounded-xl gap-2 cursor-pointer shadow-md"
            >
              {isSubmittingAction ? <RefreshCcw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Confirm Final Approval
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* ── CHANGE REQUEST TICKET REVIEW MODAL (MAKER-CHECKER) ── */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      <Dialog open={isTicketReviewModalOpen} onOpenChange={setIsTicketReviewModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl border-slate-200 p-0">
          {selectedTicket && (
            <div className="space-y-5 pb-6">
              {/* Header Banner */}
              <div className="p-6 bg-slate-900 text-white rounded-t-3xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-2.5 py-0.5 bg-purple-500 text-white font-black text-[10px] uppercase rounded-md">
                      Maker-Checker Review
                    </span>
                    <Badge variant="outline" className="border-slate-700 text-slate-300 text-[10px] font-mono">
                      Branch: {selectedTicket.branch_id}
                    </Badge>
                    <Badge className={`font-black text-[10px] uppercase ${
                      selectedTicket.status === 'PENDING'
                        ? 'bg-amber-400 text-slate-950'
                        : selectedTicket.status === 'APPROVED'
                        ? 'bg-emerald-500 text-white'
                        : 'bg-rose-500 text-white'
                    }`}>
                      {selectedTicket.status}
                    </Badge>
                  </div>
                  <h2 className="text-xl font-black tracking-tight text-white font-mono">
                    {selectedTicket.ticket_no}
                  </h2>
                  <p className="text-xs text-slate-400 font-semibold">
                    Submitted by {selectedTicket.requested_by_name || selectedTicket.requested_by_email} • {selectedTicket.created_at ? new Date(selectedTicket.created_at).toLocaleString() : 'N/A'}
                  </p>
                </div>

                <div className="text-right sm:border-l sm:border-slate-800 sm:pl-6">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Target Reference</span>
                  <div className="text-xl font-black text-amber-400 font-mono">
                    {selectedTicket.reference_no}
                  </div>
                  <span className="text-[10px] font-bold text-slate-300 uppercase">
                    {selectedTicket.entity_type} • {selectedTicket.action_type}
                  </span>
                </div>
              </div>

              <div className="px-6 space-y-4">
                {/* Staff Justification */}
                <div className="p-4 bg-amber-50/80 border border-amber-200 rounded-2xl space-y-1">
                  <span className="text-[10px] font-black uppercase tracking-wider text-amber-900 block">
                    Staff Reason / Justification
                  </span>
                  <p className="text-sm font-bold text-slate-900 italic whitespace-pre-wrap break-words leading-relaxed">
                    {selectedTicket.reason ? `"${selectedTicket.reason}"` : 'No reason provided'}
                  </p>
                </div>

                {/* Comparison of Current vs Proposed Values */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                    <h4 className="text-xs font-black uppercase tracking-wider text-slate-800">
                      Proposed Record Modifications
                    </h4>
                    <Badge variant="outline" className="text-[10px] font-bold">
                      {selectedTicket.action_type}
                    </Badge>
                  </div>

                  {selectedTicket.action_type === 'DELETE' || selectedTicket.action_type === 'VOID_INTEREST' ? (
                    <div className="space-y-3">
                      <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2 text-rose-700 text-xs font-bold">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span>Permanent Deletion Requested for {selectedTicket.entity_type} ({selectedTicket.reference_no})</span>
                      </div>
                      {selectedTicket.current_data && Object.keys(selectedTicket.current_data).length > 0 && (
                        <div className="grid grid-cols-2 gap-2 text-xs bg-white p-3 rounded-xl border border-slate-200">
                          {Object.entries(selectedTicket.current_data)
                            .filter(([k]) => !['id', 'created_at', 'updated_at', 'withdrawal_date', 'withdrawal_notes', 'withdrawal_reason'].includes(k))
                            .map(([k, v]: any) => (
                              <div key={k} className="flex justify-between border-b border-slate-100 py-1">
                                <span className="text-slate-500 font-semibold capitalize">{k.replace(/_/g, ' ')}:</span>
                                <span className="font-mono font-bold text-slate-900">{String(v ?? '—')}</span>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-slate-200 text-slate-500 uppercase text-[10px] font-black">
                            <th className="py-2 px-3 text-left">Field</th>
                            <th className="py-2 px-3 text-left">Current Value</th>
                            <th className="py-2 px-3 text-left">Proposed New Value</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 bg-white">
                          {Object.entries(selectedTicket.proposed_data || {}).map(([key, val]: any) => {
                            const curr = selectedTicket.current_data?.[key];
                            const isChanged = String(curr ?? '') !== String(val ?? '');
                            return (
                              <tr key={key} className={isChanged ? 'bg-emerald-50/40' : ''}>
                                <td className="py-2.5 px-3 font-bold text-slate-700 capitalize">
                                  {key.replace(/_/g, ' ')}
                                </td>
                                <td className="py-2.5 px-3 font-mono text-slate-500 line-through">
                                  {curr !== undefined && curr !== null ? String(curr) : '—'}
                                </td>
                                <td className="py-2.5 px-3 font-mono font-black text-emerald-700">
                                  {String(val)}
                                  {isChanged && (
                                    <span className="ml-2 px-1.5 py-0.5 text-[9px] bg-emerald-100 text-emerald-800 rounded uppercase font-sans">
                                      Changed
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Manager Review Notes */}
                {selectedTicket.status === 'PENDING' ? (
                  <div className="space-y-1.5">
                    <label className="text-xs font-black uppercase text-slate-700">
                      Manager Review Note (Optional for Approval)
                    </label>
                    <input
                      type="text"
                      value={ticketReviewNotes}
                      onChange={(e) => setTicketReviewNotes(e.target.value)}
                      placeholder="e.g. Verified against branch physical bill & approved..."
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
                    />
                  </div>
                ) : (
                  <div className="p-3 bg-slate-100 rounded-xl text-xs space-y-1">
                    <div className="font-bold text-slate-700">
                      Reviewed by: <strong className="text-slate-900">{selectedTicket.reviewed_by_name || 'Manager'}</strong> ({selectedTicket.reviewed_at ? new Date(selectedTicket.reviewed_at).toLocaleString() : ''})
                    </div>
                    {selectedTicket.review_notes && (
                      <div className="text-slate-600 italic">Note: "{selectedTicket.review_notes}"</div>
                    )}
                  </div>
                )}
              </div>

              {/* Footer Actions */}
              <div className="px-6 pt-4 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
                <Button
                  variant="outline"
                  onClick={() => setIsTicketReviewModalOpen(false)}
                  className="w-full sm:w-auto rounded-xl font-bold"
                >
                  Close
                </Button>

                {selectedTicket.status === 'PENDING' && (
                  <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
                    <Button
                      variant="outline"
                      disabled={isTicketActionLoading}
                      onClick={() => {
                        setTicketRejectReason('');
                        setIsRejectTicketModalOpen(true);
                      }}
                      className="border-rose-300 text-rose-700 hover:bg-rose-50 font-black text-xs uppercase tracking-wider rounded-xl px-4 h-10 cursor-pointer"
                    >
                      <XCircle className="w-4 h-4 mr-1.5" /> Reject Ticket
                    </Button>
                    <Button
                      disabled={isTicketActionLoading}
                      onClick={() => handleApproveTicket(selectedTicket, ticketReviewNotes)}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase tracking-wider rounded-xl px-5 h-10 cursor-pointer shadow-md"
                    >
                      {isTicketActionLoading ? (
                        <RefreshCcw className="w-4 h-4 mr-1.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4 mr-1.5" />
                      )}
                      Approve & Apply Changes
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* ── REJECT CHANGE TICKET MODAL (MAKER-CHECKER) ── */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      <Dialog open={isRejectTicketModalOpen} onOpenChange={setIsRejectTicketModalOpen}>
        <DialogContent className="max-w-md rounded-3xl border-slate-200 p-6 space-y-4">
          <DialogHeader className="space-y-1">
            <div className="w-12 h-12 bg-rose-50 rounded-2xl flex items-center justify-center text-rose-600 mx-auto sm:mx-0">
              <XCircle className="w-6 h-6" />
            </div>
            <DialogTitle className="text-xl font-black text-slate-900">
              Reject Change Ticket {selectedTicket?.ticket_no}
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 font-medium">
              Specify the reason for rejecting this change request for <strong>{selectedTicket?.reference_no}</strong>. The live database record will remain untouched.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label className="text-xs font-black uppercase text-slate-700">
              Rejection Reason <span className="text-rose-500">*</span>
            </label>
            <textarea
              rows={3}
              value={ticketRejectReason}
              onChange={(e) => setTicketRejectReason(e.target.value)}
              placeholder="e.g. Incorrect amount requested; please verify original pawn receipt..."
              className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
            />
          </div>

          <DialogFooter className="flex sm:justify-between gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => setIsRejectTicketModalOpen(false)}
              className="rounded-xl font-bold"
            >
              Cancel
            </Button>
            <Button
              onClick={handleRejectTicket}
              disabled={isTicketActionLoading || !ticketRejectReason.trim()}
              className="bg-rose-600 hover:bg-rose-700 text-white font-black text-xs uppercase tracking-wider rounded-xl gap-2 cursor-pointer shadow-md"
            >
              {isTicketActionLoading ? <RefreshCcw className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
              Confirm Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* ── IMAGE ZOOM LIGHTBOX ── */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      <Dialog open={!!previewImage} onOpenChange={() => setPreviewImage(null)}>
        <DialogContent className="max-w-4xl p-2 bg-black/95 border-none rounded-3xl">
          <div className="relative flex items-center justify-center p-2 min-h-[60vh]">
            {previewImage && (
              <img 
                src={previewImage} 
                alt="Enlarged verification evidence" 
                className="max-h-[80vh] w-auto max-w-full object-contain rounded-2xl shadow-2xl"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
