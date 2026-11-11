'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  ArrowRightLeft, Send, CheckCircle2, Clock, ShieldAlert, 
  RefreshCcw, User, Truck, ShieldCheck, AlertTriangle, Eye, Printer, FileText
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
import { DenominationCounter, DenominationState } from '@/components/DenominationCounter';

const initialDenoms: DenominationState = {
  notes_5000: '',
  notes_2000: '',
  notes_1000: '',
  notes_500: '',
  notes_100: '',
  notes_50: '',
  notes_20: '',
  notes_10: '',
  coins_total: ''
};

export default function CashTransfersTrackerPage() {
  const [transfers, setTransfers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);

  // Dispatch Modal (Record 2)
  const [selectedTransfer, setSelectedTransfer] = useState<any | null>(null);
  const [isDispatchModalOpen, setIsDispatchModalOpen] = useState(false);
  const [carrierType, setCarrierType] = useState('INTERNAL_STAFF');
  const [carrierName, setCarrierName] = useState('');
  const [carrierNic, setCarrierNic] = useState('');
  const [carrierVehicle, setCarrierVehicle] = useState('');
  const [sealNumber, setSealNumber] = useState('');
  const [dispatchDenoms, setDispatchDenoms] = useState<DenominationState>(initialDenoms);

  // Receipt Modal (Record 3)
  const [isReceiveModalOpen, setIsReceiveModalOpen] = useState(false);
  const [receiveDenoms, setReceiveDenoms] = useState<DenominationState>(initialDenoms);
  const [sealVerified, setSealVerified] = useState(true);
  const [discrepancyReason, setDiscrepancyReason] = useState('');

  // Details Modal
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const loadTransfers = async () => {
    setLoading(true);
    try {
      const u = getCurrentUser();
      setCurrentUser(u);
      const headers = getAuthHeaders();
      const res = await fetch('/api/cash/transfers', { headers });
      if (res.ok) {
        setTransfers(await res.json());
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to load transfers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTransfers();
  }, []);

  const handleDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTransfer) return;
    setSubmitting(true);
    try {
      const headers = getAuthHeaders();
      const res = await fetch('/api/cash/transfers/dispatch', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          transferId: selectedTransfer.id,
          dispatchedAmount: selectedTransfer.amount,
          denominations: dispatchDenoms,
          transportCarrierType: carrierType,
          carrierPersonName: carrierName,
          carrierPersonNic: carrierNic,
          carrierVehicleNo: carrierVehicle,
          securityBagSealNo: sealNumber
        })
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Dispatch handover failed');
      }

      toast.success(`Transfer ${json.transferRef} dispatched and marked as IN_TRANSIT!`);
      setIsDispatchModalOpen(false);
      setDispatchDenoms(initialDenoms);
      setCarrierName('');
      setCarrierNic('');
      setSealNumber('');
      loadTransfers();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReceive = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTransfer) return;
    setSubmitting(true);
    try {
      const headers = getAuthHeaders();
      const res = await fetch('/api/cash/transfers/receive', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          transferId: selectedTransfer.id,
          denominations: receiveDenoms,
          securitySealVerified: sealVerified,
          discrepancyReason
        })
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Receipt confirmation failed');
      }

      if (json.transferStatus === 'DISCREPANCY_FLAGGED') {
        toast.warning(`Cash received with a variance of Rs. ${json.discrepancy}. Flagged for Audit!`);
      } else {
        toast.success(`Cash receipt verified and accepted! GL Journal Entry #${json.journalEntryId} posted.`);
      }

      setIsReceiveModalOpen(false);
      setReceiveDenoms(initialDenoms);
      setDiscrepancyReason('');
      loadTransfers();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white/70 dark:bg-slate-900/70 backdrop-blur-md p-6 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
        <div>
          <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">
            Physical Cash Transfers & <span className="text-emerald-600">Transit Tracker</span>
          </h1>
          <p className="text-sm font-medium text-slate-500 mt-0.5">
            Full physical chain of custody: Source Dispatch (Record 2) → In-Transit → Destination Acceptance (Record 3).
          </p>
        </div>

        <Button variant="outline" size="sm" onClick={loadTransfers} disabled={loading} className="rounded-xl h-10 font-bold">
          <RefreshCcw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} /> Refresh Transfers
        </Button>
      </div>

      {/* Transfers Table */}
      <Card className="rounded-2xl border-slate-200/80 dark:border-slate-800 shadow-xs overflow-hidden">
        <CardContent className="p-0">
          <div className="w-full">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="font-bold text-[11px] uppercase tracking-wider">Transfer Ref</TableHead>
                  <TableHead className="font-bold text-[11px] uppercase tracking-wider">Route</TableHead>
                  <TableHead className="font-bold text-[11px] uppercase tracking-wider text-right">Amount</TableHead>
                  <TableHead className="font-bold text-[11px] uppercase tracking-wider text-center">Status</TableHead>
                  <TableHead className="font-bold text-[11px] uppercase tracking-wider">Dispatch Details (Record 2)</TableHead>
                  <TableHead className="font-bold text-[11px] uppercase tracking-wider">Receipt Details (Record 3)</TableHead>
                  <TableHead className="font-bold text-[11px] uppercase tracking-wider text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transfers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-10 text-slate-400">
                      No active or historical cash transfers found.
                    </TableCell>
                  </TableRow>
                ) : (
                  transfers.map((t: any) => {
                    const dispatch = Array.isArray(t.cash_dispatches) && t.cash_dispatches[0];
                    const receipt = Array.isArray(t.cash_receipts) && t.cash_receipts[0];
                    const canDispatch = t.status === 'ASSIGNED';
                    const canReceive = t.status === 'IN_TRANSIT' || t.status === 'DISPATCHED';

                    return (
                      <TableRow key={t.id}>
                        <TableCell className="font-mono text-xs font-bold text-slate-700 dark:text-slate-300">
                          {t.transfer_ref}
                        </TableCell>
                        <TableCell className="text-xs">
                          <span className="font-bold text-slate-900 dark:text-white">{t.source_branch_id}</span>
                          <span className="text-slate-400 mx-1.5">→</span>
                          <span className="font-bold text-emerald-600">{t.destination_branch_id}</span>
                        </TableCell>
                        <TableCell className="text-right font-black font-mono text-sm text-slate-900 dark:text-white">
                          Rs. {Number(t.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className={`text-[10px] font-bold uppercase ${
                            t.status === 'ACCEPTED' ? 'border-emerald-300 text-emerald-700 bg-emerald-50' :
                            t.status === 'IN_TRANSIT' ? 'border-amber-300 text-amber-700 bg-amber-50 animate-pulse' :
                            t.status === 'ASSIGNED' ? 'border-blue-300 text-blue-700 bg-blue-50' :
                            'border-rose-300 text-rose-700 bg-rose-50'
                          }`}>
                            {t.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {dispatch ? (
                            <div>
                              <div className="font-bold">{dispatch.carrier_person_name} ({dispatch.carrier_person_nic})</div>
                              <div className="text-[10px] text-slate-400">Seal: {dispatch.security_bag_seal_no}</div>
                            </div>
                          ) : (
                            <span className="text-slate-400 italic">Not dispatched yet</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          {receipt ? (
                            <div>
                              <div className="font-bold text-emerald-600">{receipt.received_by_email}</div>
                              <div className="text-[10px] text-slate-400">{new Date(receipt.received_at).toLocaleTimeString()}</div>
                            </div>
                          ) : (
                            <span className="text-slate-400 italic">Awaiting delivery</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1.5">
                            {canDispatch && (
                              <Button
                                size="sm"
                                className="h-8 text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white"
                                onClick={() => {
                                  setSelectedTransfer(t);
                                  setIsDispatchModalOpen(true);
                                }}
                              >
                                <Send className="w-3.5 h-3.5 mr-1" /> Dispatch Cash
                              </Button>
                            )}

                            {canReceive && (
                              <Button
                                size="sm"
                                className="h-8 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white"
                                onClick={() => {
                                  setSelectedTransfer(t);
                                  setIsReceiveModalOpen(true);
                                }}
                              >
                                <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Receive & Count
                              </Button>
                            )}

                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 text-xs font-bold"
                              onClick={() => {
                                setSelectedTransfer(t);
                                setIsDetailsModalOpen(true);
                              }}
                            >
                              <Eye className="w-3.5 h-3.5" />
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

      {/* Modal 1: Dispatch Handover (Record 2) */}
      <Dialog open={isDispatchModalOpen} onOpenChange={setIsDispatchModalOpen}>
        <DialogContent className="sm:max-w-[620px] rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-black">Physical Cash Dispatch (Record 2)</DialogTitle>
            <DialogDescription className="text-xs">
              Handover from {selectedTransfer?.source_branch_id} to transport officer for delivery to {selectedTransfer?.destination_branch_id}.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleDispatch} className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-bold">Carrier Type</Label>
                <Select value={carrierType} onValueChange={(val) => setCarrierType(val || 'INTERNAL_STAFF')}>
                  <SelectTrigger className="mt-1 h-9 text-xs font-bold">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="INTERNAL_STAFF">Internal Officer Transport</SelectItem>
                    <SelectItem value="SECURITY_COURIER">Armored Security Courier</SelectItem>
                    <SelectItem value="MANAGER_TRANSPORT">Branch Manager Vehicle</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs font-bold">Tamper Bag Seal Number *</Label>
                <Input
                  required
                  placeholder="e.g. SEAL-90214"
                  value={sealNumber}
                  onChange={(e) => setSealNumber(e.target.value)}
                  className="mt-1 h-9 text-xs font-mono font-bold"
                />
              </div>

              <div>
                <Label className="text-xs font-bold">Courier / Driver Name *</Label>
                <Input
                  required
                  placeholder="e.g. Sunil Perera"
                  value={carrierName}
                  onChange={(e) => setCarrierName(e.target.value)}
                  className="mt-1 h-9 text-xs"
                />
              </div>

              <div>
                <Label className="text-xs font-bold">Courier NIC Number *</Label>
                <Input
                  required
                  placeholder="e.g. 841234567V"
                  value={carrierNic}
                  onChange={(e) => setCarrierNic(e.target.value)}
                  className="mt-1 h-9 text-xs font-mono font-bold"
                />
              </div>
            </div>

            {/* Denomination Counter for Dispatch */}
            <div className="pt-2">
              <DenominationCounter
                denominations={dispatchDenoms}
                onChange={setDispatchDenoms}
                expectedAmount={selectedTransfer?.amount}
              />
            </div>

            <DialogFooter className="pt-3">
              <Button type="button" variant="outline" onClick={() => setIsDispatchModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting} className="bg-amber-600 hover:bg-amber-700 text-white font-bold">
                {submitting ? 'Confirming Dispatch...' : 'Confirm Handover & Dispatch'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal 2: Receive & Acceptance (Record 3) */}
      <Dialog open={isReceiveModalOpen} onOpenChange={setIsReceiveModalOpen}>
        <DialogContent className="sm:max-w-[620px] rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-black">Cash Acceptance & Physical Count (Record 3)</DialogTitle>
            <DialogDescription className="text-xs">
              Delivery acceptance at {selectedTransfer?.destination_branch_id}. Verify security bag seal and count notes.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleReceive} className="space-y-4 pt-2">
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 rounded-xl text-xs space-y-1">
              <div><span className="font-bold">Dispatched Amount:</span> Rs. {Number(selectedTransfer?.amount || 0).toLocaleString()}</div>
              <div><span className="font-bold">Security Seal No:</span> {selectedTransfer?.cash_dispatches?.[0]?.security_bag_seal_no || 'N/A'}</div>
              <div><span className="font-bold">Delivered By:</span> {selectedTransfer?.cash_dispatches?.[0]?.carrier_person_name}</div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="sealCheck"
                checked={sealVerified}
                onChange={(e) => setSealVerified(e.target.checked)}
                className="rounded border-slate-300 w-4 h-4 text-emerald-600"
              />
              <Label htmlFor="sealCheck" className="text-xs font-bold text-slate-700 dark:text-slate-200">
                I verify that the security bag seal is intact and matches the dispatch seal number.
              </Label>
            </div>

            {/* Denomination Counter for Receipt */}
            <div className="pt-2">
              <DenominationCounter
                denominations={receiveDenoms}
                onChange={setReceiveDenoms}
                expectedAmount={selectedTransfer?.amount}
              />
            </div>

            <div>
              <Label className="text-xs font-bold">Discrepancy / Exception Notes (if any)</Label>
              <Input
                placeholder="Required if counted physical notes differ from dispatched amount"
                value={discrepancyReason}
                onChange={(e) => setDiscrepancyReason(e.target.value)}
                className="mt-1 h-9 text-xs"
              />
            </div>

            <DialogFooter className="pt-3">
              <Button type="button" variant="outline" onClick={() => setIsReceiveModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold">
                {submitting ? 'Accepting...' : 'Accept Cash & Post Journal Entry'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal 3: View Full 3-Record Audit Details */}
      <Dialog open={isDetailsModalOpen} onOpenChange={setIsDetailsModalOpen}>
        <DialogContent className="sm:max-w-[540px] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-black">Transfer Audit Trail & 3-Record Chain</DialogTitle>
            <DialogDescription className="text-xs">
              Linked non-repudiation records for Transfer {selectedTransfer?.transfer_ref}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2 text-xs">
            {/* Record 1 */}
            <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
              <div className="font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider text-[11px] mb-1">
                Record 1: Cash Requisition
              </div>
              <div>Ref: {selectedTransfer?.cash_requests?.request_ref || 'N/A'}</div>
              <div>Requester: {selectedTransfer?.cash_requests?.requested_by_email || 'Direct Balancing'}</div>
              <div>Purpose: {selectedTransfer?.cash_requests?.purpose || 'Routine Transfer'}</div>
            </div>

            {/* Record 2 */}
            <div className="p-3 bg-amber-50/50 dark:bg-amber-950/20 rounded-xl border border-amber-200 dark:border-amber-900/40">
              <div className="font-bold text-amber-800 dark:text-amber-200 uppercase tracking-wider text-[11px] mb-1">
                Record 2: Physical Dispatch & Handover
              </div>
              {selectedTransfer?.cash_dispatches?.[0] ? (
                <>
                  <div>Ref: {selectedTransfer.cash_dispatches[0].dispatch_ref}</div>
                  <div>Dispatched By: {selectedTransfer.cash_dispatches[0].dispatched_by_email}</div>
                  <div>Courier: {selectedTransfer.cash_dispatches[0].carrier_person_name} (NIC: {selectedTransfer.cash_dispatches[0].carrier_person_nic})</div>
                  <div>Seal No: {selectedTransfer.cash_dispatches[0].security_bag_seal_no}</div>
                  <div>Departure Time: {new Date(selectedTransfer.cash_dispatches[0].dispatched_at).toLocaleString()}</div>
                </>
              ) : (
                <div className="text-slate-400 italic">Not dispatched yet</div>
              )}
            </div>

            {/* Record 3 */}
            <div className="p-3 bg-emerald-50/50 dark:bg-emerald-950/20 rounded-xl border border-emerald-200 dark:border-emerald-900/40">
              <div className="font-bold text-emerald-800 dark:text-emerald-200 uppercase tracking-wider text-[11px] mb-1">
                Record 3: Receipt Acceptance & GL Closure
              </div>
              {selectedTransfer?.cash_receipts?.[0] ? (
                <>
                  <div>Ref: {selectedTransfer.cash_receipts[0].receipt_ref}</div>
                  <div>Received By: {selectedTransfer.cash_receipts[0].received_by_email}</div>
                  <div>Received Amount: Rs. {Number(selectedTransfer.cash_receipts[0].received_amount).toLocaleString()}</div>
                  <div>Arrival Time: {new Date(selectedTransfer.cash_receipts[0].received_at).toLocaleString()}</div>
                  <div className="font-mono text-emerald-700 font-bold mt-1">GL Posting: {selectedTransfer.gl_journal_entry_id || 'Posted'}</div>
                </>
              ) : (
                <div className="text-slate-400 italic">Awaiting destination confirmation</div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
