'use client';

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { FileText, Send, AlertTriangle, Trash2, RotateCcw, Edit3, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { getAuthHeaders } from '@/lib/getAuthHeaders';

export interface ChangeRequestConfig {
  isOpen: boolean;
  onClose: () => void;
  entityType: 'PAWN' | 'STOCK' | 'DAILY_LEDGER' | 'INTEREST' | 'CLIENT';
  actionType: 'UPDATE' | 'DELETE' | 'RESTORE' | 'LEDGER_ADJUST' | 'VOID_INTEREST';
  entityId: string;
  referenceNo: string; // Bill No, Ledger Date, or Client NIC
  branchId: string;
  currentData: Record<string, any>;
  initialProposedData?: Record<string, any>;
  onSubmitted?: (ticket: any) => void;
}

export default function ChangeRequestModal({
  isOpen,
  onClose,
  entityType,
  actionType,
  entityId,
  referenceNo,
  branchId,
  currentData,
  initialProposedData,
  onSubmitted
}: ChangeRequestConfig) {
  const [reason, setReason] = useState('');
  const [proposedData, setProposedData] = useState<Record<string, any>>(initialProposedData || {});
  const [loading, setLoading] = useState(false);

  React.useEffect(() => {
    if (isOpen) {
      setProposedData(initialProposedData || {});
      setReason('');
    }
  }, [isOpen, initialProposedData]);

  // Helper for action label
  const isDelete = actionType === 'DELETE' || actionType === 'VOID_INTEREST';
  const isRestore = actionType === 'RESTORE';
  const isBlockedClientDelete = entityType === 'CLIENT' && actionType === 'DELETE';

  const actionTitle = isDelete 
    ? `Request Deletion / Void (${referenceNo})`
    : isRestore 
      ? `Request Restore to Safe (${referenceNo})` 
      : `Request Modification (${referenceNo})`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isBlockedClientDelete) {
      toast.error('Customer deletion is permanently disabled.');
      return;
    }
    if (!reason.trim()) {
      toast.error('A clear explanation / reason is mandatory for Manager review.');
      return;
    }

    setLoading(true);
    try {
      const payload = {
        entity_type: entityType,
        action_type: actionType,
        entity_id: entityId,
        reference_no: referenceNo,
        branch_id: branchId,
        reason: reason.trim(),
        current_data: currentData,
        proposed_data: isDelete ? { requested_action: 'PERMANENT_DELETE' } : proposedData
      };

      const res = await fetch('/api/change-requests', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit change request ticket');
      }

      toast.success(`Ticket ${data.ticket?.ticket_no} submitted for Manager approval!`);
      if (onSubmitted) onSubmitted(data.ticket);
      setReason('');
      setProposedData({});
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Error submitting request');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="w-[95vw] sm:max-w-lg max-h-[90dvh] rounded-2xl p-6 bg-white border border-slate-200 shadow-2xl overflow-y-auto overflow-x-hidden">
        <DialogHeader className="space-y-1 pr-8">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="px-2 py-0.5 text-[10px] font-black uppercase tracking-wider bg-amber-50 text-amber-700 border-amber-200">
              Maker-Checker Ticket
            </Badge>
            <Badge variant="outline" className="px-2 py-0.5 text-[10px] font-black uppercase tracking-wider bg-slate-100 text-slate-700">
              {entityType}
            </Badge>
          </div>
          <DialogTitle className="text-lg font-black text-slate-900 flex items-center gap-2 pt-1">
            {isDelete ? <Trash2 className="w-5 h-5 text-rose-500" /> : isRestore ? <RotateCcw className="w-5 h-5 text-blue-500" /> : <Edit3 className="w-5 h-5 text-amber-500" />}
            {actionTitle}
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500">
            Tellers cannot directly alter or delete live records. This request will be submitted as an approval ticket for Branch Manager or Head Office review.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {/* Current Details Summary */}
          <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 space-y-2 text-xs">
            <div className="flex justify-between items-center text-slate-500 font-bold">
              <span>Target Record: <strong className="text-slate-800">{referenceNo}</strong></span>
              <span>Branch: <strong className="text-slate-800">{branchId}</strong></span>
            </div>
            
            {/* Context-specific current snapshot display */}
            {entityType === 'PAWN' && (
              <div className="grid grid-cols-2 gap-2 text-slate-600 pt-1 border-t border-slate-200/60">
                <div>Current Amount: <strong>Rs. {Number(currentData.disbursed_amount || currentData.amount || 0).toLocaleString()}</strong></div>
                <div>Current Weight: <strong>{currentData.weight_grams || currentData.weight || 0}g</strong></div>
              </div>
            )}

            {entityType === 'STOCK' && (
              <div className="grid grid-cols-2 gap-2 text-slate-600 pt-1 border-t border-slate-200/60">
                <div>Current Price: <strong>Rs. {Number(currentData.price || 0).toLocaleString()}</strong></div>
                <div>Current Status: <strong>{currentData.status || 'Active'}</strong></div>
              </div>
            )}

            {entityType === 'DAILY_LEDGER' && (
              <div className="grid grid-cols-2 gap-2 text-slate-600 pt-1 border-t border-slate-200/60">
                <div>Closing Cash: <strong>Rs. {Number(currentData.closing_balance || 0).toLocaleString()}</strong></div>
                <div>Expenses Total: <strong>Rs. {Number(currentData.expenses_total || 0).toLocaleString()}</strong></div>
              </div>
            )}

            {entityType === 'CLIENT' && (
              <div className="grid grid-cols-2 gap-2 text-slate-600 pt-1 border-t border-slate-200/60">
                <div className="truncate">Name: <strong>{currentData.first_name || currentData.name || '—'}</strong></div>
                <div>NIC: <strong>{currentData.national_id || currentData.nic || '—'}</strong></div>
                <div>Phone: <strong>{currentData.phone || currentData.tp || '—'}</strong></div>
                <div className="truncate">Address: <strong>{currentData.address || '—'}</strong></div>
              </div>
            )}
          </div>

          {isBlockedClientDelete && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-bold text-rose-700">
              Customer profiles cannot be deleted. Please edit the customer details instead.
            </div>
          )}

          {/* Form Fields for UPDATE actions */}
          {!isDelete && !isRestore && (
            <div className="space-y-3">
              {entityType === 'PAWN' && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs font-bold text-slate-700">Bill Number</Label>
                    <Input
                      placeholder={String(currentData.bill_no || '')}
                      value={proposedData.bill_no ?? ''}
                      onChange={e => setProposedData({ ...proposedData, bill_no: e.target.value })}
                      className="h-9 rounded-xl text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-bold text-slate-700">Proposed Loan Amount (Rs.)</Label>
                    <Input
                      type="number"
                      placeholder={String(currentData.disbursed_amount || '')}
                      value={proposedData.disbursed_amount ?? ''}
                      onChange={e => setProposedData({ ...proposedData, disbursed_amount: e.target.value })}
                      className="h-9 rounded-xl text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-bold text-slate-700">Appraised Value (Rs.)</Label>
                    <Input
                      type="number"
                      placeholder={String(currentData.appraised_value || '')}
                      value={proposedData.appraised_value ?? ''}
                      onChange={e => setProposedData({ ...proposedData, appraised_value: e.target.value })}
                      className="h-9 rounded-xl text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-bold text-slate-700">Proposed Gold Weight (g)</Label>
                    <Input
                      type="number"
                      step="0.001"
                      placeholder={String(currentData.weight_grams || currentData.weight || '')}
                      value={proposedData.weight_grams ?? ''}
                      onChange={e => setProposedData({ ...proposedData, weight_grams: e.target.value })}
                      className="h-9 rounded-xl text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-bold text-slate-700">Period (Months)</Label>
                    <Input
                      type="number"
                      placeholder={String(currentData.period_months || '3')}
                      value={proposedData.period_months ?? ''}
                      onChange={e => setProposedData({ ...proposedData, period_months: e.target.value })}
                      className="h-9 rounded-xl text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-bold text-slate-700">Collateral Description</Label>
                    <Input
                      placeholder={String(currentData.description || '')}
                      value={proposedData.description ?? ''}
                      onChange={e => setProposedData({ ...proposedData, description: e.target.value })}
                      className="h-9 rounded-xl text-xs"
                    />
                  </div>
                </div>
              )}

              {entityType === 'STOCK' && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs font-bold text-slate-700">Bill Number</Label>
                    <Input
                      placeholder={String(currentData.bill_no || '')}
                      value={proposedData.bill_no ?? ''}
                      onChange={e => setProposedData({ ...proposedData, bill_no: e.target.value })}
                      className="h-9 rounded-xl text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-bold text-slate-700">Item Type</Label>
                    <Input
                      placeholder={String(currentData.item_type || '')}
                      value={proposedData.item_type ?? ''}
                      onChange={e => setProposedData({ ...proposedData, item_type: e.target.value })}
                      className="h-9 rounded-xl text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-bold text-slate-700">Proposed Stock Price (Rs.)</Label>
                    <Input
                      type="number"
                      placeholder={String(currentData.price || '')}
                      value={proposedData.price ?? ''}
                      onChange={e => setProposedData({ ...proposedData, price: e.target.value })}
                      className="h-9 rounded-xl text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-bold text-slate-700">Proposed Weight (g)</Label>
                    <Input
                      type="number"
                      step="0.001"
                      placeholder={String(currentData.weight || '')}
                      value={proposedData.weight ?? ''}
                      onChange={e => setProposedData({ ...proposedData, weight: e.target.value })}
                      className="h-9 rounded-xl text-xs"
                    />
                  </div>
                  <div className="space-y-1 col-span-2">
                    <Label className="text-xs font-bold text-slate-700">Stock Date</Label>
                    <Input
                      type="date"
                      value={proposedData.date ?? ''}
                      onChange={e => setProposedData({ ...proposedData, date: e.target.value })}
                      className="h-9 rounded-xl text-xs"
                    />
                  </div>
                </div>
              )}

              {entityType === 'DAILY_LEDGER' && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs font-bold text-slate-700">Opening Balance (Rs.)</Label>
                    <Input
                      type="number"
                      placeholder={String(currentData.opening_balance ?? '')}
                      value={proposedData.opening_balance ?? ''}
                      onChange={e => setProposedData({ ...proposedData, opening_balance: e.target.value })}
                      className="h-9 rounded-xl text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-bold text-slate-700">Adjusted Closing Cash (Rs.)</Label>
                    <Input
                      type="number"
                      placeholder={String(currentData.closing_balance ?? '')}
                      value={proposedData.closing_balance ?? ''}
                      onChange={e => setProposedData({ ...proposedData, closing_balance: e.target.value })}
                      className="h-9 rounded-xl text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-bold text-slate-700">Loan Issued Total (Rs.)</Label>
                    <Input
                      type="number"
                      placeholder={String(currentData.loan_issued_total ?? '')}
                      value={proposedData.loan_issued_total ?? ''}
                      onChange={e => setProposedData({ ...proposedData, loan_issued_total: e.target.value })}
                      className="h-9 rounded-xl text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-bold text-slate-700">Redemption Total (Rs.)</Label>
                    <Input
                      type="number"
                      placeholder={String(currentData.redemption_total ?? '')}
                      value={proposedData.redemption_total ?? ''}
                      onChange={e => setProposedData({ ...proposedData, redemption_total: e.target.value })}
                      className="h-9 rounded-xl text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-bold text-slate-700">Interest Received (Rs.)</Label>
                    <Input
                      type="number"
                      placeholder={String(currentData.interest_rec_total ?? '')}
                      value={proposedData.interest_rec_total ?? ''}
                      onChange={e => setProposedData({ ...proposedData, interest_rec_total: e.target.value })}
                      className="h-9 rounded-xl text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-bold text-slate-700">Adjusted Expenses Total (Rs.)</Label>
                    <Input
                      type="number"
                      placeholder={String(currentData.expenses_total ?? '')}
                      value={proposedData.expenses_total ?? ''}
                      onChange={e => setProposedData({ ...proposedData, expenses_total: e.target.value })}
                      className="h-9 rounded-xl text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-bold text-slate-700">Transfer In (Rs.)</Label>
                    <Input
                      type="number"
                      placeholder={String(currentData.transfer_in ?? '')}
                      value={proposedData.transfer_in ?? ''}
                      onChange={e => setProposedData({ ...proposedData, transfer_in: e.target.value })}
                      className="h-9 rounded-xl text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-bold text-slate-700">Transfer Out (Rs.)</Label>
                    <Input
                      type="number"
                      placeholder={String(currentData.transfer_out ?? '')}
                      value={proposedData.transfer_out ?? ''}
                      onChange={e => setProposedData({ ...proposedData, transfer_out: e.target.value })}
                      className="h-9 rounded-xl text-xs"
                    />
                  </div>
                </div>
              )}

              {entityType === 'INTEREST' && (
                <div className="grid grid-cols-1 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs font-bold text-slate-700">Adjusted Interest Amount (Rs.)</Label>
                    <Input
                      type="number"
                      placeholder={String(currentData.interest_value ?? currentData.amount ?? '')}
                      value={proposedData.interest_value ?? ''}
                      onChange={e => setProposedData({ ...proposedData, interest_value: e.target.value })}
                      className="h-9 rounded-xl text-xs"
                    />
                  </div>
                </div>
              )}

              {entityType === 'CLIENT' && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1 col-span-2">
                    <Label className="text-xs font-bold text-slate-700">Customer Name (Full / With Initials)</Label>
                    <Input
                      placeholder={String(currentData.first_name || currentData.name || '')}
                      value={proposedData.first_name ?? ''}
                      onChange={e => setProposedData({ ...proposedData, first_name: e.target.value })}
                      className="h-9 rounded-xl text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-bold text-slate-700">Corrected NIC Number</Label>
                    <Input
                      placeholder={String(currentData.national_id || currentData.nic || '')}
                      value={proposedData.national_id ?? ''}
                      onChange={e => setProposedData({ ...proposedData, national_id: e.target.value })}
                      className="h-9 rounded-xl text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-bold text-slate-700">Corrected Phone</Label>
                    <Input
                      placeholder={String(currentData.phone || currentData.tp || '')}
                      value={proposedData.phone ?? ''}
                      onChange={e => setProposedData({ ...proposedData, phone: e.target.value })}
                      className="h-9 rounded-xl text-xs"
                    />
                  </div>
                  <div className="space-y-1 col-span-2">
                    <Label className="text-xs font-bold text-slate-700">Corrected Address</Label>
                    <Input
                      placeholder={String(currentData.address || '')}
                      value={proposedData.address ?? ''}
                      onChange={e => setProposedData({ ...proposedData, address: e.target.value })}
                      className="h-9 rounded-xl text-xs"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Mandatory Reason Textarea */}
          <div className="space-y-1.5">
            <Label className="text-xs font-bold text-slate-800 flex items-center justify-between">
              <span>Reason for Request (අනිවාර්ය සාධාරණීකරණය) *</span>
              <span className="text-[10px] text-slate-400 font-normal">Mandatory for Manager audit</span>
            </Label>
            <textarea
              required
              rows={3}
              placeholder="e.g. Typo in manual scale reading; customer requested weight re-verification; or customer settled cash but bill was recorded under wrong counter."
              value={reason}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setReason(e.target.value)}
              className="w-full rounded-xl border border-slate-200 p-2.5 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 resize-none"
            />
          </div>

          <DialogFooter className="mx-0 mb-0 rounded-xl bg-transparent px-0 pt-3 pb-0 flex flex-row items-center justify-between gap-2 border-t border-slate-100">
            <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={loading} className="rounded-xl text-xs">
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading || !reason.trim() || isBlockedClientDelete}
              size="sm"
              className={isDelete ? "bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5" : "bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5"}
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Submit Change Ticket
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
