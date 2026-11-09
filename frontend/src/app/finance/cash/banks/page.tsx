'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  Landmark, PlusCircle, RefreshCcw, CheckCircle2, Building2, 
  ArrowLeft, Edit, ShieldCheck, DollarSign
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

export default function BankAccountsPage() {
  const [banks, setBanks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);

  // New Bank Modal
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [bankName, setBankName] = useState('Commercial Bank of Ceylon');
  const [accountName, setAccountName] = useState('Rupasingha Capital Operations');
  const [accountNumber, setAccountNumber] = useState('');
  const [assignedBranch, setAssignedBranch] = useState('HQ');
  const [openingBalance, setOpeningBalance] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Reconcile Modal
  const [selectedBank, setSelectedBank] = useState<any | null>(null);
  const [isReconcileModalOpen, setIsReconcileModalOpen] = useState(false);
  const [newBalance, setNewBalance] = useState('');
  const [reconNotes, setReconNotes] = useState('');

  const loadBanks = async () => {
    setLoading(true);
    try {
      const u = getCurrentUser();
      setCurrentUser(u);
      const headers = getAuthHeaders();
      const res = await fetch('/api/cash/banks', { headers });
      if (res.ok) {
        setBanks(await res.json());
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to load bank accounts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBanks();
  }, []);

  const handleAddBank = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const headers = getAuthHeaders();
      const res = await fetch('/api/cash/banks', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          bankName,
          accountName,
          accountNumber,
          branchId: assignedBranch,
          openingBalance: parseFloat(openingBalance || '0')
        })
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Failed to add bank account');
      }

      toast.success('Bank account registered successfully!');
      setIsAddModalOpen(false);
      setAccountNumber('');
      setOpeningBalance('');
      loadBanks();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReconcile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBank) return;
    setSubmitting(true);
    try {
      const headers = getAuthHeaders();
      const res = await fetch('/api/cash/banks', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          id: selectedBank.id,
          currentBalance: parseFloat(newBalance),
          notes: reconNotes
        })
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Reconciliation update failed');
      }

      toast.success('Bank account balance updated & reconciled!');
      setIsReconcileModalOpen(false);
      setNewBalance('');
      setReconNotes('');
      loadBanks();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const isAdmin = currentUser?.role === 'ADMIN';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white/70 dark:bg-slate-900/70 backdrop-blur-md p-6 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
        <div className="flex items-center gap-3">
          <Link href="/finance/cash">
            <Button variant="ghost" size="icon" className="rounded-xl">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">
              Company <span className="text-blue-600">Bank Accounts</span>
            </h1>
            <p className="text-sm font-medium text-slate-500 mt-0.5">
              Master accounts directory, General Ledger linkage, and statement reconciliation.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <Button variant="outline" size="sm" onClick={loadBanks} disabled={loading} className="rounded-xl h-10 font-bold">
            <RefreshCcw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          {isAdmin && (
            <Button size="sm" onClick={() => setIsAddModalOpen(true)} className="bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl h-10 shadow-sm shadow-blue-600/20">
              <PlusCircle className="w-4 h-4 mr-1.5" /> Register Bank Account
            </Button>
          )}
        </div>
      </div>

      {/* Banks Table */}
      <Card className="rounded-2xl border-slate-200/80 dark:border-slate-800 shadow-xs">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="font-bold text-[11px] uppercase tracking-wider">Bank Name</TableHead>
                  <TableHead className="font-bold text-[11px] uppercase tracking-wider">Account Title</TableHead>
                  <TableHead className="font-bold text-[11px] uppercase tracking-wider">Account Number</TableHead>
                  <TableHead className="font-bold text-[11px] uppercase tracking-wider">Branch</TableHead>
                  <TableHead className="font-bold text-[11px] uppercase tracking-wider text-right">Balance (LKR)</TableHead>
                  <TableHead className="font-bold text-[11px] uppercase tracking-wider">Last Reconciliation</TableHead>
                  <TableHead className="font-bold text-[11px] uppercase tracking-wider text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {banks.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-10 text-slate-400">
                      No bank accounts registered. Click "Register Bank Account" to add one.
                    </TableCell>
                  </TableRow>
                ) : (
                  banks.map((b: any) => (
                    <TableRow key={b.id}>
                      <TableCell className="font-bold text-sm text-slate-900 dark:text-white">
                        {b.bankName}
                      </TableCell>
                      <TableCell className="text-xs text-slate-600 dark:text-slate-300">
                        {b.accountName}
                      </TableCell>
                      <TableCell className="font-mono text-xs font-bold">
                        {b.accountNumber}
                      </TableCell>
                      <TableCell className="text-xs">
                        <span className="font-mono text-xs px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 font-bold">
                          {b.branchId || 'HQ Corporate'}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-black font-mono text-sm text-emerald-600 dark:text-emerald-400">
                        Rs. {Number(b.currentBalance).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {b.lastReconciledAt ? new Date(b.lastReconciledAt).toLocaleDateString() : 'Unreconciled'}
                      </TableCell>
                      <TableCell className="text-right">
                        {(isAdmin || currentUser?.role === 'MANAGER') && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs font-bold text-blue-600 border-blue-200"
                            onClick={() => {
                              setSelectedBank(b);
                              setNewBalance(b.currentBalance);
                              setIsReconcileModalOpen(true);
                            }}
                          >
                            <Edit className="w-3.5 h-3.5 mr-1" /> Reconcile
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Modal: Add Bank Account */}
      <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
        <DialogContent className="sm:max-w-[480px] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-black">Register Bank Account</DialogTitle>
            <DialogDescription className="text-xs">
              Add a new company bank account to the master financial directory.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAddBank} className="space-y-4 pt-2">
            <div>
              <Label className="text-xs font-bold">Bank Name</Label>
              <Input
                required
                placeholder="e.g. Commercial Bank of Ceylon"
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                className="mt-1 h-10 text-sm"
              />
            </div>

            <div>
              <Label className="text-xs font-bold">Account Name / Title</Label>
              <Input
                required
                placeholder="e.g. Rupasingha Capital - Current A/C"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                className="mt-1 h-10 text-sm"
              />
            </div>

            <div>
              <Label className="text-xs font-bold">Account Number</Label>
              <Input
                required
                placeholder="e.g. 1000293847"
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                className="mt-1 h-10 font-mono font-bold text-sm"
              />
            </div>

            <div>
              <Label className="text-xs font-bold">Branch Assignment</Label>
              <Select value={assignedBranch} onValueChange={(val) => setAssignedBranch(val || 'HQ')}>
                <SelectTrigger className="mt-1 h-10 font-bold text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="HQ" className="font-bold">HQ Corporate General</SelectItem>
                  {CANONICAL_BRANCHES.filter(b => b.id !== 'HQ' && b.id !== 'TEST').map(b => (
                    <SelectItem key={b.id} value={b.id} className="font-bold text-sm">
                      {b.name} ({b.id})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs font-bold">Opening Balance (LKR)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={openingBalance}
                onChange={(e) => setOpeningBalance(e.target.value)}
                className="mt-1 h-10 font-mono font-bold text-sm"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setIsAddModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting} className="bg-blue-600 hover:bg-blue-700 text-white font-bold">
                {submitting ? 'Registering...' : 'Save Bank Account'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal: Reconcile Statement Balance */}
      <Dialog open={isReconcileModalOpen} onOpenChange={setIsReconcileModalOpen}>
        <DialogContent className="sm:max-w-[440px] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-black">Bank Statement Reconciliation</DialogTitle>
            <DialogDescription className="text-xs">
              Reconcile {selectedBank?.bankName} ({selectedBank?.accountNumber})
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleReconcile} className="space-y-4 pt-2">
            <div>
              <Label className="text-xs font-bold">Statement Balance (LKR)</Label>
              <Input
                type="number"
                step="0.01"
                required
                value={newBalance}
                onChange={(e) => setNewBalance(e.target.value)}
                className="mt-1 h-10 font-mono font-bold text-sm"
              />
            </div>

            <div>
              <Label className="text-xs font-bold">Reconciliation Notes / Bank Ref</Label>
              <Input
                placeholder="e.g. Monthly statement reconciliation as of today"
                value={reconNotes}
                onChange={(e) => setReconNotes(e.target.value)}
                className="mt-1 h-10 text-sm"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setIsReconcileModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting} className="bg-blue-600 hover:bg-blue-700 text-white font-bold">
                {submitting ? 'Updating...' : 'Confirm Reconciliation'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
