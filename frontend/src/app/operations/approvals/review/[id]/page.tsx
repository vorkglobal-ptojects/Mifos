'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { getAuthHeaders } from '@/lib/getAuthHeaders';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter 
} from '@/components/ui/dialog';
import { 
  CheckCircle2, XCircle, ShieldAlert, Sparkles, Inbox, RefreshCcw, 
  ArrowLeft, Landmark, UserCheck, Eye, AlertTriangle, 
  RotateCcw, Scale, FileText, Camera, User, DollarSign, 
  Package, Clock, Check, ExternalLink, AlertCircle, ShieldCheck
} from 'lucide-react';
import { toast } from 'sonner';

export default function ManagerReviewPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [dossier, setDossier] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);

  // Actions
  const [isApproveConfirmOpen, setIsApproveConfirmOpen] = useState(false);
  const [isReturnModalOpen, setIsReturnModalOpen] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const [isResubmitModalOpen, setIsResubmitModalOpen] = useState(false);
  const [resubmitNote, setResubmitNote] = useState('');
  const [managerCertified, setManagerCertified] = useState(false);
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);

  // Lightbox
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const loadDossier = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const stored = localStorage.getItem('user');
      if (stored) setUser(JSON.parse(stored));

      const res = await fetch(`/api/pawns/${id}`, { headers: getAuthHeaders() });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to load transaction review dossier');
      }
      const data = await res.json();
      setDossier(data);
    } catch (err: any) {
      console.error(err);
      toast.error('Error loading transaction', { description: err.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDossier();
  }, [id]);

  // Action 1: Final Approve
  const handleConfirmFinalApproval = async () => {
    if (!id) return;

    if (!managerCertified) {
      toast.error('Please certify that you have independently reviewed the dossier before approving.');
      return;
    }

    setIsSubmittingAction(true);
    const toastId = toast.loading('Recording Manager final approval & posting to General Ledger...');

    try {
      const res = await fetch(`/api/pawns/${id}/approve`, {
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
      setTimeout(() => {
        router.push('/operations/approvals');
      }, 1200);
    } catch (err: any) {
      toast.error('Final Approval Failed', { description: err.message, id: toastId });
    } finally {
      setIsSubmittingAction(false);
    }
  };

  // Action 2: Return / Reject
  const handleConfirmReturn = async () => {
    if (!id) return;

    if (!returnReason.trim()) {
      toast.error('A mandatory return reason/note is required.');
      return;
    }

    setIsSubmittingAction(true);
    const toastId = toast.loading('Returning transaction for rechecking...');

    try {
      const res = await fetch(`/api/pawns/${id}/reject`, {
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
      setTimeout(() => {
        router.push('/operations/approvals');
      }, 1200);
    } catch (err: any) {
      toast.error('Return Failed', { description: err.message, id: toastId });
    } finally {
      setIsSubmittingAction(false);
    }
  };

  // Action 3: Resolve Recheck & Resubmit for Audit
  const handleConfirmResubmit = async () => {
    if (!id) return;
    if (!resubmitNote.trim()) {
      toast.error('Please enter a note describing the correction made.');
      return;
    }
    setIsSubmittingAction(true);
    const toastId = toast.loading('Resolving recheck and resubmitting for audit...');
    try {
      const res = await fetch(`/api/pawns/${id}/resubmit`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ note: resubmitNote.trim() })
      });
      const resData = await res.json();
      if (!res.ok) {
        throw new Error(resData.error || 'Failed to resubmit transaction');
      }
      toast.success('Resubmitted for Audit', {
        description: 'Status updated to PENDING_APPROVAL for fresh Auditor verification.',
        id: toastId
      });
      setIsResubmitModalOpen(false);
      setTimeout(() => {
        router.push('/operations/approvals');
      }, 1200);
    } catch (err: any) {
      toast.error('Resubmit Failed', { description: err.message, id: toastId });
    } finally {
      setIsSubmittingAction(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <RefreshCcw className="animate-spin h-10 w-10 text-amber-500" />
        <p className="text-sm font-bold text-slate-500 tracking-tight">Loading Manager Review Dossier...</p>
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
            Managerial authorization is required to review auditor findings and authorize final disbursal.
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

  if (!pData) {
    return (
      <div className="max-w-2xl mx-auto py-20 px-8 text-center bg-white rounded-3xl border border-slate-200 shadow-xl space-y-6">
        <AlertTriangle className="w-12 h-12 text-rose-500 mx-auto" />
        <h2 className="text-2xl font-black text-slate-900">Transaction Not Found</h2>
        <p className="text-slate-500 text-sm">Could not find this pawn transaction record or you may not be authorized for this branch.</p>
        <Link href="/operations/approvals">
          <Button variant="outline" className="rounded-xl">Return to Approvals Inbox</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-6xl mx-auto pb-24 animate-in slide-in-from-bottom-4 duration-500">
      
      {/* ── TOP NAV BAR ── */}
      <div className="flex items-center justify-between">
        <Link href="/operations/approvals">
          <Button variant="outline" className="rounded-xl gap-2 font-bold text-xs bg-white text-slate-700 hover:bg-slate-50 shadow-xs">
            <ArrowLeft className="w-4 h-4" /> Back to Manager Inbox
          </Button>
        </Link>

        <div className="flex items-center gap-2">
          <span className="text-xs font-mono font-bold text-slate-500">Branch: {pData.branch_id}</span>
          <Badge className={`font-black text-[10px] uppercase ${
            pData.status === 'AUDITED_PENDING_APPROVAL' ? 'bg-amber-400 text-slate-950' : 'bg-slate-700 text-white'
          }`}>
            {pData.status}
          </Badge>
        </div>
      </div>

      {/* ── DOSSIER HEADER ── */}
      <div className="p-8 bg-slate-900 text-white rounded-3xl flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-xl border border-slate-800">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 bg-amber-500 text-slate-950 font-black text-[10px] uppercase rounded-md flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" /> Manager Final Review
            </span>
            <span className="text-xs font-bold text-slate-400">Originated: {new Date(pData.created_at).toLocaleString('en-GB')}</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-white">
            Bill #{pData.bill_no || pData.id.substring(0, 8).toUpperCase()}
          </h1>
          <p className="text-xs font-semibold text-slate-300">
            Customer: <strong className="text-white">{cData?.first_name ? `${cData.first_name} ${cData.last_name || ''}`.trim() : pData.customer_name || 'Customer'}</strong>
          </p>
        </div>

        <div className="text-left md:text-right md:border-l md:border-slate-800 md:pl-8 space-y-1">
          <span className="text-[10px] uppercase font-bold text-slate-400 block">Requested Disbursal</span>
          <div className="text-3xl font-black text-amber-400 font-mono tracking-tight">
            Rs. {(pData.disbursed_amount || 0).toLocaleString()}
          </div>
          <span className="text-xs font-semibold text-slate-400">
            Valuation: Rs. {(pData.appraised_value || 0).toLocaleString()}
          </span>
        </div>
      </div>

      {/* ── SECTION: AUDITOR VERIFICATION RESULTS ── */}
      <div className="bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent border-2 border-emerald-500/30 rounded-3xl p-6 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-emerald-500/20 pb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-600 text-white flex items-center justify-center font-black shadow-xs">
              <Check className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-black text-slate-900 flex items-center gap-2">
                Auditor Verification Completed
                <Badge className="bg-emerald-600 text-white font-black text-[9px] uppercase">
                  VERIFIED & PASSED
                </Badge>
              </h2>
              <p className="text-xs font-semibold text-slate-600">
                Auditor: <strong className="text-slate-900">{auditorApprovedLog?.user_email || auditorApprovedLog?.details?.auditor_email || 'Branch Auditor'}</strong> • {auditorApprovedLog?.created_at ? new Date(auditorApprovedLog.created_at).toLocaleString('en-GB') : 'Verified'}
              </p>
            </div>
          </div>
        </div>

        {/* Auditor Checklist 10 Points */}
        {auditorChecklist ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-bold text-slate-700">
            <div className="p-3 bg-white rounded-2xl border border-emerald-200 flex items-center justify-between shadow-xs">
              <span>Physical Item:</span>
              <Badge className={auditorChecklist.physicalExists ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}>
                {auditorChecklist.physicalExists ? 'Exists' : 'No'}
              </Badge>
            </div>
            <div className="p-3 bg-white rounded-2xl border border-emerald-200 flex items-center justify-between shadow-xs">
              <span>Item Matches:</span>
              <Badge className={auditorChecklist.itemMatches ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}>
                {auditorChecklist.itemMatches ? 'Matched' : 'Differs'}
              </Badge>
            </div>
            <div className="p-3 bg-white rounded-2xl border border-emerald-200 flex items-center justify-between shadow-xs">
              <span>Weight Matches:</span>
              <Badge className={auditorChecklist.weightMatches ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}>
                {auditorChecklist.weightMatches ? 'Matched' : 'Differs'}
              </Badge>
            </div>
            <div className="p-3 bg-white rounded-2xl border border-emerald-200 flex items-center justify-between shadow-xs">
              <span>Karat Matches:</span>
              <Badge className={auditorChecklist.karatMatches ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}>
                {auditorChecklist.karatMatches ? 'Matched' : 'Differs'}
              </Badge>
            </div>
            <div className="p-3 bg-white rounded-2xl border border-emerald-200 flex items-center justify-between shadow-xs">
              <span>Observed Weight:</span>
              <span className="font-mono font-black text-slate-900">
                {auditorChecklist.observedWeight ? `${auditorChecklist.observedWeight} mg` : 'Verified'}
              </span>
            </div>
            <div className="p-3 bg-white rounded-2xl border border-emerald-200 flex items-center justify-between shadow-xs">
              <span>Observed Karat:</span>
              <span className="font-mono font-black text-slate-900">
                {auditorChecklist.observedKarat || 'Verified'}
              </span>
            </div>
            <div className="p-3 bg-white rounded-2xl border border-emerald-200 flex items-center justify-between shadow-xs">
              <span>Stock Status:</span>
              <Badge className={auditorChecklist.stockVerified ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'}>
                {auditorChecklist.stockVerified ? 'Verified' : 'Pending'}
              </Badge>
            </div>
            <div className="p-3 bg-white rounded-2xl border border-emerald-200 flex items-center justify-between shadow-xs">
              <span>Cash Balance:</span>
              <Badge className={auditorChecklist.cashVerified ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'}>
                {auditorChecklist.cashVerified ? 'Verified' : 'Pending'}
              </Badge>
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-500 font-semibold italic">Standard Auditor compliance checks recorded on file.</p>
        )}

        {auditorApprovedLog?.details?.notes && (
          <div className="p-3.5 bg-white rounded-2xl border border-emerald-200 text-xs space-y-1">
            <span className="text-[10px] font-black uppercase text-slate-400">Auditor Notes:</span>
            <p className="font-bold text-slate-800 italic">"{auditorApprovedLog.details.notes}"</p>
          </div>
        )}
      </div>

      {/* ── 2 COLUMN: CUSTOMER & PAWN DETAILS ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Customer Details */}
        <div className="glass p-6 rounded-3xl border border-slate-200 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
              <User className="w-4 h-4 text-amber-600" /> 1. Customer KYC Credentials
            </h3>
            <Badge variant="outline" className="text-[9px] uppercase font-bold">KYC Record</Badge>
          </div>

          <div className="flex gap-4 items-start">
            <div className="w-24 h-24 bg-slate-100 rounded-2xl overflow-hidden border border-slate-200 flex items-center justify-center shrink-0">
              {customerAvatar ? (
                <img 
                  src={customerAvatar} 
                  alt="Customer" 
                  className="w-full h-full object-cover cursor-zoom-in hover:scale-105 transition-all"
                  onClick={() => setPreviewImage(customerAvatar)}
                />
              ) : (
                <User className="w-10 h-10 text-slate-400" />
              )}
            </div>

            <div className="space-y-1.5 text-xs">
              <p className="font-black text-slate-900 text-base">
                {cData?.first_name ? `${cData.first_name} ${cData.last_name || ''}`.trim() : pData.customer_name || 'Customer'}
              </p>
              <p className="font-semibold text-slate-600">
                National ID: <strong className="font-mono text-slate-900">{cData?.national_id || 'N/A'}</strong>
              </p>
              <p className="font-semibold text-slate-600">
                Contact: <strong className="text-slate-900">{cData?.phone || pData.phone || 'N/A'}</strong>
              </p>
              <p className="font-semibold text-slate-600 text-[11px]">
                Address: {cData?.address || 'Branch customer address on file'}
              </p>
            </div>
          </div>
        </div>

        {/* Pawn & Collateral Details */}
        <div className="glass p-6 rounded-3xl border border-slate-200 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
              <FileText className="w-4 h-4 text-amber-600" /> 2. Pawn Terms & Collateral
            </h3>
            <Badge variant="outline" className="text-[9px] uppercase font-bold">Contract</Badge>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-[10px] font-bold text-slate-400 block">Total Weight</span>
              <strong className="font-mono text-slate-900 text-sm">
                {pData.weight_mg ? `${pData.weight_mg.toLocaleString()} mg` : (pData.weight_grams ? `${Math.round(pData.weight_grams * 1000).toLocaleString()} mg` : (pData.weight ? `${Math.round(Number(pData.weight) * 1000).toLocaleString()} mg` : '—'))}
              </strong>
            </div>
            <div>
              <span className="text-[10px] font-bold text-slate-400 block">Interest Rate</span>
              <strong className="text-slate-900 text-sm">{pData.interest_rate || 2.5}% Monthly</strong>
            </div>
            <div>
              <span className="text-[10px] font-bold text-slate-400 block">Period</span>
              <strong className="text-slate-900">{pData.period_months || 12} Months</strong>
            </div>
            <div>
              <span className="text-[10px] font-bold text-slate-400 block">Article Type</span>
              <strong className="text-slate-900 truncate block">{pData.description || 'Gold Jewelry'}</strong>
            </div>
          </div>

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

      {/* ── SECTION: CUSTOMER KYC IDENTITY PHOTOS ── */}
      <div className="glass p-6 rounded-3xl border border-slate-200 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600" /> 3. Customer KYC Photos & Signatures
          </h3>
          <span className="text-xs font-semibold text-slate-400">Captured Identity Evidence</span>
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
                  <img src={customerNicFront} alt="NIC Front" className="w-full h-full object-contain group-hover:scale-105 transition-all" />
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
                  <img src={customerNicBack} alt="NIC Back" className="w-full h-full object-contain group-hover:scale-105 transition-all" />
                  <span className="absolute bottom-2 right-2 bg-black/75 text-white text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1 opacity-90 group-hover:opacity-100">
                    <Eye className="w-3 h-3" /> Zoom
                  </span>
                </>
              ) : (
                <span className="text-xs text-slate-400 font-bold">No NIC back photo</span>
              )}
            </div>
          </div>

          {/* Signature */}
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
                  <img src={customerSignature} alt="Customer Signature" className="w-full h-full object-contain group-hover:scale-105 transition-all" />
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

      {/* ── SECTION: UPLOADED SCALE EVIDENCE IMAGES ── */}
      <div className="glass p-6 rounded-3xl border border-slate-200 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
            <Camera className="w-4 h-4 text-amber-600" /> 3. Hydrostatic Scale Evidence Photos
          </h3>
          <span className="text-xs font-semibold text-slate-400">Archimedes Hydrostatic Density</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs font-bold text-slate-700">
              <span>Air Weight Photo (Dry)</span>
              <span className="font-mono text-slate-500">{evalEv?.air_weight ? `${evalEv.air_weight} mg` : ''}</span>
            </div>
            <div 
              className="w-full aspect-video bg-black/90 rounded-2xl overflow-hidden flex items-center justify-center cursor-zoom-in group relative border border-slate-200"
              onClick={() => evalEv?.air_weight_photo_url && setPreviewImage(evalEv.air_weight_photo_url)}
            >
              {evalEv?.air_weight_photo_url ? (
                <>
                  <img src={evalEv.air_weight_photo_url} alt="Air scale" className="w-full h-full object-contain group-hover:scale-105 transition-all" />
                  <span className="absolute bottom-2 right-2 bg-black/75 text-white text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1">
                    <Eye className="w-3 h-3" /> Zoom
                  </span>
                </>
              ) : (
                <span className="text-xs text-slate-400 font-bold">No air weight photo attached</span>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs font-bold text-slate-700">
              <span>Water Weight Photo (Submerged)</span>
              <span className="font-mono text-slate-500">{evalEv?.water_weight ? `${evalEv.water_weight} mg` : ''}</span>
            </div>
            <div 
              className="w-full aspect-video bg-black/90 rounded-2xl overflow-hidden flex items-center justify-center cursor-zoom-in group relative border border-slate-200"
              onClick={() => evalEv?.water_weight_photo_url && setPreviewImage(evalEv.water_weight_photo_url)}
            >
              {evalEv?.water_weight_photo_url ? (
                <>
                  <img src={evalEv.water_weight_photo_url} alt="Water scale" className="w-full h-full object-contain group-hover:scale-105 transition-all" />
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

      {/* ── SECTION: STOCK & CASH RECONCILIATION ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="p-5 bg-slate-50 rounded-3xl border border-slate-200 space-y-2">
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
                <div key={stk.id} className="p-3 bg-white rounded-xl border border-slate-200 flex justify-between font-semibold">
                  <span>Sub-bill: <strong className="font-mono text-slate-900">{stk.bill_no}</strong> ({stk.item_type})</span>
                  <span className="font-mono font-black">{stk.weight_mg ? `${stk.weight_mg} mg` : `${Math.round((parseFloat(stk.weight) || 0) * 1000)} mg`}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500 font-medium">
              Collateral items will transfer to safe custody storage upon Manager sign-off.
            </p>
          )}
        </div>

        <div className="p-5 bg-slate-50 rounded-3xl border border-slate-200 space-y-2">
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
              Disbursed Loan: <strong className="font-mono text-slate-900 font-black">Rs. {(pData.disbursed_amount || 0).toLocaleString()}</strong>
            </p>
            <p className="text-slate-600">
              Double-Entry Posting: <strong className="text-slate-900">Vault Cash (Asset) ➔ Pawn Loan Portfolio (Asset)</strong>
            </p>
            <p className="text-[11px] text-slate-500">
              Automated GL journal entries will post upon confirmation.
            </p>
          </div>
        </div>
      </div>

      {/* ── SECTION: AUDIT TRAIL & ISSUE HISTORY ── */}
      <div className="glass p-6 rounded-3xl border border-slate-200 space-y-3">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
          <h3 className="text-xs font-black text-slate-900 flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-600" /> Historical Audit Logs & Issue Notes
          </h3>
          <span className="text-[10px] font-mono font-bold text-slate-400">{auditLogs.length} events</span>
        </div>

        <div className="space-y-2 max-h-48 overflow-y-auto">
          {auditLogs.length > 0 ? (
            auditLogs.map((log: any, idx: number) => {
              const isIssue = log.action === 'AUDIT_ISSUE_RAISED';
              const isReturn = log.action === 'MANAGER_RETURNED';
              const isApproval = log.action === 'AUDITOR_APPROVED' || log.action === 'MANAGER_APPROVED';

              return (
                <div 
                  key={log.id || idx} 
                  className={`p-3.5 rounded-2xl border text-xs space-y-1 ${
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
                    {log.details?.reason || log.details?.notes || log.details?.note || 'Audit event logged'}
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
      <div className="p-5 bg-amber-500/10 border-2 border-amber-500/30 rounded-3xl flex items-start gap-3 shadow-xs">
        <input
          type="checkbox"
          id="standalone-mgr-decl"
          checked={managerCertified}
          onChange={(e) => setManagerCertified(e.target.checked)}
          className="w-5 h-5 rounded mt-0.5 text-amber-600 focus:ring-amber-500 cursor-pointer"
        />
        <label htmlFor="standalone-mgr-decl" className="text-xs font-bold text-amber-950 cursor-pointer leading-relaxed">
          <strong>Independent Manager Certification:</strong> I have independently inspected customer identification, pawn collateral descriptions, hydrostatic scale photographs, auditor verification outcomes, stock records, and cash balances for this branch ticket.
        </label>
      </div>

      {/* ── ACTION BUTTONS BAR ── */}
      <div className="p-6 bg-white rounded-3xl border border-slate-200 shadow-lg flex flex-col sm:flex-row items-center justify-between gap-4">
        <Link href="/operations/approvals">
          <Button variant="outline" className="rounded-xl font-bold text-slate-600">
            Cancel & Return to Inbox
          </Button>
        </Link>

        <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
          {pData.status === 'REQUIRES_RECHECK' && (
            <Button
              onClick={() => {
                setResubmitNote('');
                setIsResubmitModalOpen(true);
              }}
              className="w-full sm:w-auto bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs uppercase tracking-wider h-12 px-6 rounded-2xl gap-2 cursor-pointer shadow-md"
            >
              <RefreshCcw className="w-4 h-4" /> Resolve &amp; Resubmit for Audit
            </Button>
          )}

          {/* Action 2: RETURN / REJECT */}
          <Button
            onClick={() => {
              setReturnReason('');
              setIsReturnModalOpen(true);
            }}
            className="w-full sm:w-auto bg-white hover:bg-rose-50 text-rose-600 hover:text-rose-700 border border-rose-300 font-black text-xs uppercase tracking-wider h-12 px-6 rounded-2xl gap-2 cursor-pointer shadow-xs"
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
            className="w-full sm:w-auto bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 text-white font-black text-xs uppercase tracking-wider h-12 px-8 rounded-2xl gap-2 cursor-pointer shadow-lg shadow-emerald-600/20"
          >
            <CheckCircle2 className="w-4 h-4" /> Final Approve
          </Button>
        </div>
      </div>

      {/* Return Modal */}
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
            <Button variant="outline" onClick={() => setIsReturnModalOpen(false)} className="rounded-xl font-bold">
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

      {/* Resolve & Resubmit Modal */}
      <Dialog open={isResubmitModalOpen} onOpenChange={setIsResubmitModalOpen}>
        <DialogContent className="max-w-md rounded-3xl border-slate-200 p-6 space-y-4">
          <DialogHeader className="space-y-1">
            <div className="w-12 h-12 bg-amber-50 rounded-2xl flex items-center justify-center text-amber-600 mx-auto sm:mx-0">
              <RefreshCcw className="w-6 h-6" />
            </div>
            <DialogTitle className="text-xl font-black text-slate-900">
              Resolve Recheck &amp; Resubmit for Audit
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 font-medium">
              Confirm the corrections made for this ticket. Resubmitting marks active audit issues as resolved and returns the pawn to PENDING_APPROVAL for fresh Auditor verification.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label className="text-xs font-black uppercase text-slate-700">
              Correction / Resolution Note <span className="text-rose-500">*</span>
            </label>
            <textarea
              rows={4}
              value={resubmitNote}
              onChange={(e) => setResubmitNote(e.target.value)}
              placeholder="e.g. Updated physical weight photo and corrected customer NIC scan..."
              className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
            />
          </div>

          <DialogFooter className="flex sm:justify-between gap-2 pt-2">
            <Button variant="outline" onClick={() => setIsResubmitModalOpen(false)} className="rounded-xl font-bold">
              Cancel
            </Button>
            <Button
              onClick={handleConfirmResubmit}
              disabled={isSubmittingAction || !resubmitNote.trim()}
              className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs uppercase tracking-wider rounded-xl gap-2 cursor-pointer shadow-md"
            >
              {isSubmittingAction ? <RefreshCcw className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />}
              Resubmit for Audit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Final Approve Modal */}
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
            <Button variant="outline" onClick={() => setIsApproveConfirmOpen(false)} className="rounded-xl font-bold">
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

      {/* Lightbox */}
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
