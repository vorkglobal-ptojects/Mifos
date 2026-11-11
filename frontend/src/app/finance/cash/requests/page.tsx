'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  PlusCircle, RefreshCcw, CheckCircle2, XCircle, Clock, 
  ArrowRightLeft, Building2, Landmark, Filter, AlertTriangle, ShieldCheck
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { getAuthHeaders, getCurrentUser } from '@/lib/getAuthHeaders';
import { CANONICAL_BRANCHES } from '@/lib/branch-mapping';

export default function CashRequestsPage() {
  const [requests, setRequests] = useState<any[]>([]);
  const [banks, setBanks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);

  // New Request Modal
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [newBranch, setNewBranch] = useState('BRL');
  const [newAmount, setNewAmount] = useState('');
  const [newPurpose, setNewPurpose] = useState('Pawn loan disbursements replenishment');
  const [newDate, setNewDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [submitting, setSubmitting] = useState(false);

  // Approval Modal
  const [selectedReq, setSelectedReq] = useState<any | null>(null);
  const [isApproveModalOpen, setIsApproveModalOpen] = useState(false);
  const [approvedAmount, setApprovedAmount] = useState('');
  const [sourceType, setSourceType] = useState<'BRANCH' | 'BANK'>('BRANCH');
  const [sourceBranch, setSourceBranch] = useState('HQ');
  const [sourceBankId, setSourceBankId] = useState('');

  // Rejection Modal
  const [isRejectModalOpen, setIsRejectModalOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const u = getCurrentUser();
      setCurrentUser(u);
      if (u?.branchId && u.role === 'TELLER') {
        setNewBranch(u.branchId);
      }

      const headers = getAuthHeaders();
      const [reqRes, bankRes] = await Promise.all([
        fetch('/api/cash/requests', { headers }),
        fetch('/api/cash/banks', { headers })
      ]);

      if (reqRes.ok) {
        setRequests(await reqRes.json());
      }
      if (bankRes.ok) {
        setBanks(await bankRes.json());
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to load requisitions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const headers = getAuthHeaders();
      const res = await fetch('/api/cash/requests', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          requestingBranchId: newBranch,
          requestedAmount: parseFloat(newAmount),
          purpose: newPurpose,
          requiredDate: newDate
        })
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Failed to submit request');
      }

      toast.success(`Cash requisition ${json.request.request_ref} submitted successfully!`);
      setIsNewModalOpen(false);
      setNewAmount('');
      loadData();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async () => {
    if (!selectedReq) return;
    setSubmitting(true);
    try {
      const headers = getAuthHeaders();
      const res = await fetch(`/api/cash/requests/${selectedReq.id}/approve`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          approvedAmount: parseFloat(approvedAmount || selectedReq.requested_amount),
          sourceType,
          sourceBranchId: sourceType === 'BRANCH' ? sourceBranch : undefined,
          sourceBankId: sourceType === 'BANK' ? sourceBankId : undefined
        })
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Approval failed');
      }

      toast.success(`Request ${selectedReq.request_ref} approved! Transfer ${json.transfer.transfer_ref} initiated.`);
      setIsApproveModalOpen(false);
      loadData();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async (action: 'REJECT' | 'RETURN') => {
    if (!selectedReq) return;
    setSubmitting(true);
    try {
      const headers = getAuthHeaders();
      const res = await fetch(`/api/cash/requests/${selectedReq.id}/reject`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ action, reason: rejectReason })
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Rejection failed');
      }

      toast.success(`Request marked as ${action === 'RETURN' ? 'RETURNED' : 'REJECTED'}.`);
      setIsRejectModalOpen(false);
      setRejectReason('');
      loadData();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const isManagerOrAdmin = currentUser?.role === 'ADMIN' || currentUser?.role === 'MANAGER';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white/70 dark:bg-slate-900/70 backdrop-blur-md p-6 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
        <div>
          <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">
            Branch Cash <span className="text-emerald-600">Requisitions</span>
          </h1>
          <p className="text-sm font-medium text-slate-500 mt-0.5">
            Record 1: Immutable requisitions, maker-checker authorization, and source assignment.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Button variant="outline" size="sm" onClick={loadData} disabled={loading} className="rounded-xl h-10 font-bold">
            <RefreshCcw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          <Button size="sm" onClick={() => setIsNewModalOpen(true)} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl h-10 shadow-sm shadow-emerald-600/20">
            <PlusCircle className="w-4 h-4 mr-1.5" /> Submit Cash Requisition
          </Button>
        </div>
      </div>

      {/* Requisitions Table */}
      <Card className="rounded-2xl border-slate-200/80 dark:border-slate-800 shadow-xs overflow-hidden">
        <CardContent className="p-0">
          <div className="w-full">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="font-bold text-[11px] uppercase tracking-wider">Ref No.</TableHead>
                  <TableHead className="font-bold text-[11px] uppercase tracking-wider">Branch</TableHead>
                  <TableHead className="font-bold text-[11px] uppercase tracking-wider">Requested By</TableHead>
                  <TableHead className="font-bold text-[11px] uppercase tracking-wider">Required Date</TableHead>
                  <TableHead className="font-bold text-[11px] uppercase tracking-wider text-right">Requested</TableHead>
                  <TableHead className="font-bold text-[11px] uppercase tracking-wider text-right">Approved</TableHead>
                  <TableHead className="font-bold text-[11px] uppercase tracking-wider text-center">Status</TableHead>
                  <TableHead className="font-bold text-[11px] uppercase tracking-wider text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-10 text-slate-400">
                      No cash requisitions found. Click "Submit Cash Requisition" to create one.
                    </TableCell>
                  </TableRow>
                ) : (
                  requests.map((r: any) => {
                    const isOwnRequest = currentUser?.id && r.requested_by_user_id === currentUser.id;

                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-xs font-bold text-slate-700 dark:text-slate-300">
                          {r.request_ref}
                        </TableCell>
                        <TableCell className="font-bold text-sm">
                          <span className="font-mono text-xs px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 mr-1.5 text-slate-600">
                            {r.requesting_branch_id}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="font-bold text-slate-800 dark:text-slate-200">{r.requested_by_email}</div>
                          <div className="text-[10px] text-slate-400">{new Date(r.created_at).toLocaleString()}</div>
                        </TableCell>
                        <TableCell className="text-xs font-mono text-slate-600">
                          {r.required_date}
                        </TableCell>
                        <TableCell className="text-right font-black font-mono text-sm text-slate-800 dark:text-slate-200">
                          Rs. {Number(r.requested_amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right font-black font-mono text-sm text-emerald-600">
                          {r.approved_amount ? `Rs. ${Number(r.approved_amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '-'}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className={`text-[10px] font-bold uppercase ${
                            r.status === 'APPROVED' ? 'border-emerald-300 text-emerald-700 bg-emerald-50' :
                            r.status === 'SUBMITTED' ? 'border-amber-300 text-amber-700 bg-amber-50' :
                            r.status === 'IN_TRANSIT' ? 'border-blue-300 text-blue-700 bg-blue-50' :
                            r.status === 'COMPLETED' ? 'border-indigo-300 text-indigo-700 bg-indigo-50' :
                            'border-rose-300 text-rose-700 bg-rose-50'
                          }`}>
                            {r.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {r.status === 'SUBMITTED' && isManagerOrAdmin && (
                            <div className="flex justify-end gap-1.5">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 text-xs font-bold border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                                disabled={isOwnRequest}
                                title={isOwnRequest ? "Maker-checker policy: You cannot approve your own request" : "Approve and assign funding source"}
                                onClick={() => {
                                  setSelectedReq(r);
                                  setApprovedAmount(r.requested_amount);
                                  setIsApproveModalOpen(true);
                                }}
                              >
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 text-xs font-bold text-rose-600 hover:bg-rose-50"
                                onClick={() => {
                                  setSelectedReq(r);
                                  setIsRejectModalOpen(true);
                                }}
                              >
                                Reject
                              </Button>
                            </div>
                          )}
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

      {/* 1. Modal: Submit Requisition */}
      <Dialog open={isNewModalOpen} onOpenChange={setIsNewModalOpen}>
        <DialogContent className="sm:max-w-[480px] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-black">Submit Cash Requisition</DialogTitle>
            <DialogDescription className="text-xs">
              Record 1: Submit a cash requirement request under your verified login identity.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateRequest} className="space-y-4 pt-2">
            <div>
              <Label className="text-xs font-bold">Requesting Branch</Label>
              <Select value={newBranch} onValueChange={(val) => setNewBranch(val || '')} disabled={currentUser?.role === 'TELLER'}>
                <SelectTrigger className="mt-1 h-10 font-bold text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CANONICAL_BRANCHES.filter(b => b.id !== 'TEST').map(b => (
                    <SelectItem key={b.id} value={b.id} className="font-bold text-sm">
                      {b.name} ({b.id})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs font-bold">Requested Amount (LKR)</Label>
              <Input
                type="number"
                min="1000"
                step="500"
                placeholder="e.g. 500000"
                required
                value={newAmount}
                onChange={(e) => setNewAmount(e.target.value)}
                className="mt-1 h-10 font-bold text-sm font-mono"
              />
            </div>

            <div>
              <Label className="text-xs font-bold">Required Date</Label>
              <Input
                type="date"
                required
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="mt-1 h-10 font-bold text-sm"
              />
            </div>

            <div>
              <Label className="text-xs font-bold">Business Purpose / Justification</Label>
              <Input
                placeholder="e.g. Surge in gold pawn loan disbursements"
                required
                value={newPurpose}
                onChange={(e) => setNewPurpose(e.target.value)}
                className="mt-1 h-10 text-sm"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setIsNewModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold">
                {submitting ? 'Submitting...' : 'Submit Requisition'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 2. Modal: Approve Requisition & Assign Source */}
      <Dialog open={isApproveModalOpen} onOpenChange={setIsApproveModalOpen}>
        <DialogContent className="sm:max-w-[500px] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-black">Approve & Assign Source</DialogTitle>
            <DialogDescription className="text-xs">
              Maker-Checker Authorization for Requisition {selectedReq?.request_ref}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 text-xs space-y-1">
              <div><span className="font-bold">Requesting Branch:</span> {selectedReq?.requesting_branch_id}</div>
              <div><span className="font-bold">Requested Amount:</span> Rs. {Number(selectedReq?.requested_amount || 0).toLocaleString()}</div>
              <div><span className="font-bold">Requester:</span> {selectedReq?.requested_by_email}</div>
            </div>

            <div>
              <Label className="text-xs font-bold">Approved Amount (LKR)</Label>
              <Input
                type="number"
                min="1000"
                step="500"
                value={approvedAmount}
                onChange={(e) => setApprovedAmount(e.target.value)}
                className="mt-1 h-10 font-bold text-sm font-mono"
              />
            </div>

            <div>
              <Label className="text-xs font-bold">Funding Source Type</Label>
              <Select value={sourceType} onValueChange={(v: any) => setSourceType(v)}>
                <SelectTrigger className="mt-1 h-10 font-bold text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BRANCH">Supply from Branch / Vault</SelectItem>
                  <SelectItem value="BANK">Withdraw from Bank Account</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {sourceType === 'BRANCH' ? (
              <div>
                <Label className="text-xs font-bold">Source Branch / Central Vault</Label>
                <Select value={sourceBranch} onValueChange={(val) => setSourceBranch(val || '')}>
                  <SelectTrigger className="mt-1 h-10 font-bold text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CANONICAL_BRANCHES.filter(b => b.id !== selectedReq?.requesting_branch_id && b.id !== 'TEST').map(b => (
                      <SelectItem key={b.id} value={b.id} className="font-bold text-sm">
                        {b.name} ({b.id})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div>
                <Label className="text-xs font-bold">Source Bank Account</Label>
                <Select value={sourceBankId} onValueChange={(val) => setSourceBankId(val || '')}>
                  <SelectTrigger className="mt-1 h-10 font-bold text-sm">
                    <SelectValue placeholder="Select Bank Account" />
                  </SelectTrigger>
                  <SelectContent>
                    {banks.map(b => (
                      <SelectItem key={b.id} value={b.id} className="font-bold text-sm">
                        {b.bankName} - {b.accountName} ({b.accountNumber})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setIsApproveModalOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleApprove} disabled={submitting} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold">
                {submitting ? 'Approving...' : 'Authorize & Initiate Transfer'}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* 3. Modal: Reject / Return Requisition */}
      <Dialog open={isRejectModalOpen} onOpenChange={setIsRejectModalOpen}>
        <DialogContent className="sm:max-w-[420px] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-black">Reject or Return Request</DialogTitle>
            <DialogDescription className="text-xs">
              Provide justification for request {selectedReq?.request_ref}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label className="text-xs font-bold">Reason / Observation Note</Label>
              <Input
                placeholder="e.g. Branch cash forecast exceeds ceiling; resubmit for 200,000"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="mt-1 h-10 text-sm"
              />
            </div>
            <DialogFooter className="pt-2">
              <Button variant="outline" onClick={() => handleReject('RETURN')} disabled={submitting || !rejectReason.trim()}>
                Return for Correction
              </Button>
              <Button variant="destructive" onClick={() => handleReject('REJECT')} disabled={submitting || !rejectReason.trim()}>
                Reject Request
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
