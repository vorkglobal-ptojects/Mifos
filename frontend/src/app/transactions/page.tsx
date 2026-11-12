'use client';

import Link from "next/link"
import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Search, Send, FileText, ArrowRightLeft, Building2 } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { cn } from "@/lib/utils"
import { normalizeBranchId, getBranchSearchTerms } from "@/lib/branch-mapping"
import { getAuthHeaders } from "@/lib/getAuthHeaders"

// Branches are fetched dynamically from /api/branches

export default function TransactionsPage() {
  const [isOpen, setIsOpen] = useState(false);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'GLOBAL' | 'LOCAL'>('GLOBAL');
  const [filterBranchId, setFilterBranchId] = useState<string>('ALL');
  const [userProfile, setUserProfile] = useState<{ role: string, branchId: string } | null>(null);
  const [branches, setBranches] = useState<any[]>([]);

  // Transfer State
  const [targetBranchId, setTargetBranchId] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');

  const loadTransactions = async () => {
    try {
      const storedUser = localStorage.getItem('user');
      const user = storedUser ? JSON.parse(storedUser) : null;
      setUserProfile(user);
      
      const branchId = user?.branchId;
      const role = user?.role;

      // Force LOCAL mode for non-admins / non-HQ users
      const isHead = !branchId || normalizeBranchId(branchId) === 'HQ' || branchId.toUpperCase() === 'HEAD OFFICE';
      const effectiveViewMode = (role === 'ADMIN' || isHead) ? viewMode : 'LOCAL';

      let query = supabase.from('transaction').select('*').order('timestamp', { ascending: false });
      
      // Multi-tenant isolation logic
      if (effectiveViewMode === 'LOCAL' && branchId) {
        // Show transactions where this branch is either the source or destination
        const terms = getBranchSearchTerms(branchId);
        const orClause = terms.map(t => `branch_id.eq.${t},target_branch_id.eq.${t}`).join(',');
        query = query.or(orClause);
      } else if (effectiveViewMode === 'GLOBAL' && filterBranchId !== 'ALL') {
        // Admin branch filter in global view
        const terms = getBranchSearchTerms(filterBranchId);
        const orClause = terms.map(t => `branch_id.eq.${t},target_branch_id.eq.${t}`).join(',');
        query = query.or(orClause);
      }

      const { data, error } = await query;
      if (error) throw error;
      if (data) {
        setTransactions(data);
      }
    } catch(err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadBranches = async () => {
    try {
      const res = await fetch('/api/branches', { headers: getAuthHeaders() });
      if (res.ok) setBranches(await res.json());
    } catch (e) {
      console.error('Failed to load branches');
    }
  };

  useEffect(() => {
    loadTransactions();
  }, [viewMode, filterBranchId]);

  useEffect(() => {
    loadBranches();
  }, []);

  const handleTransfer = async () => {
    try {
      const storedUser = localStorage.getItem('user');
      const user = storedUser ? JSON.parse(storedUser) : null;

      const { error } = await supabase.from('transaction').insert([{
        client_id: 'INTERNAL_TRANSFER',
        type: 'TRANSFER',
        branch_id: user?.branchId || 'HQ',
        target_branch_id: targetBranchId || 'UNKNOWN',
        amount: parseFloat(amount) || 0,
        description: description || 'Routine Branch Balancing',
        timestamp: new Date().toISOString()
      }]);

      if (error) throw error;

      setIsOpen(false);
      setTargetBranchId('');
      setAmount('');
      setDescription('');
      loadTransactions();
    } catch(err) {
      console.error(err);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center glass p-8 rounded-3xl border-white/40 shadow-2xl gap-6">
        <div className="flex items-center gap-5">
          <div className="h-14 w-14 bg-primary/10 rounded-2xl flex items-center justify-center border border-primary/20 shadow-inner">
             <ArrowRightLeft className="h-7 w-7 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-black text-slate-900 tracking-tighter leading-none mb-1">
              Transaction <span className="text-gradient">Ledger</span>
            </h1>
            <p className="text-sm text-slate-500 font-medium">Branch-specific transaction history and transfers.</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          {/* Visibility Toggle (HQ Admin Only) */}
          {userProfile?.role === 'ADMIN' && userProfile?.branchId === 'HQ' && (
            <>
              <div className="flex flex-wrap bg-slate-100 p-1 rounded-2xl border border-slate-200 w-full sm:w-auto gap-1">
                <button 
                  onClick={() => setViewMode('GLOBAL')}
                  className={cn(
                    "flex-1 sm:px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer",
                    viewMode === 'GLOBAL' ? "bg-[#ffd100] text-[#202020] shadow-sm" : "text-slate-600 hover:text-slate-900"
                  )}
                >
                  Global View
                </button>
                <button 
                  onClick={() => setViewMode('LOCAL')}
                  className={cn(
                    "flex-1 sm:px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer",
                    viewMode === 'LOCAL' ? "bg-[#ffd100] text-[#202020] shadow-sm" : "text-slate-600 hover:text-slate-900"
                  )}
                >
                  Local Branch
                </button>
              </div>

              {/* Branch Filter (Only in Global Mode) */}
              {viewMode === 'GLOBAL' && (
                <Select value={filterBranchId} onValueChange={(val) => val && setFilterBranchId(val)}>
                  <SelectTrigger className="h-11 w-full sm:w-[200px] rounded-2xl border-slate-200 font-bold text-[10px] uppercase tracking-widest transition-all glass">
                    <div className="flex items-center gap-2">
                      <Building2 className="w-3.5 h-3.5 text-amber-600" />
                      <SelectValue placeholder="All Branches" />
                    </div>
                  </SelectTrigger>
                  <SelectContent className="glass border-white/40 rounded-2xl shadow-2xl">
                    <SelectItem value="ALL" className="font-black text-[10px] uppercase tracking-widest">All Branches</SelectItem>
                    {branches.map(b => (
                      <SelectItem key={b.id} value={b.id} className="font-bold text-[10px] uppercase tracking-widest">
                        {b.name} ({b.id})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </>
          )}

          <Button onClick={() => setIsOpen(true)} className="gap-2 bg-slate-900 hover:bg-slate-800 text-white font-black uppercase tracking-widest text-[10px] h-11 px-6 rounded-2xl w-full sm:w-auto shadow-xl shadow-slate-900/10">
            <Send className="h-4 w-4" /> New Transfer
          </Button>
        </div>
      </div>

      {/* Compliance & Security Banner */}
      <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-amber-500/20 flex items-center justify-center shrink-0">
            <ArrowRightLeft className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-amber-950">Cash Transfers & Vault Balancing</h4>
            <p className="text-xs text-amber-800">Inter-branch cash movements must follow the three-record attributable workflow: Requisition &rarr; Manager Approval &rarr; Physical Dispatch &rarr; Recipient Count.</p>
          </div>
        </div>
        <Link 
          href="/finance/cash/transfers"
          className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold px-4 py-2 rounded-xl transition-colors shrink-0"
        >
          Go to Cash Transfers <Send className="w-3.5 h-3.5" />
        </Link>
      </div>

      {/* Transfer Guidance Dialog */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-[480px] glass border-white/40 p-0 max-h-[90dvh] flex flex-col gap-0 overflow-hidden rounded-[2rem]">
          <div className="h-2 bg-[#ffd100] shrink-0" />
          <div className="flex-1 min-h-0 overflow-y-auto p-6 sm:p-8 space-y-6 overscroll-contain">
            <DialogHeader className="pr-8">
              <DialogTitle className="text-2xl font-black tracking-tighter flex items-center gap-3 text-slate-900">
                <div className="h-10 w-10 bg-[#ffd100]/20 rounded-xl flex items-center justify-center border border-[#ffd100]/40">
                  <Send className="h-5 w-5 text-slate-900"/>
                </div>
                Branch Cash Transfer
              </DialogTitle>
              <DialogDescription className="font-medium text-slate-600 text-sm">
                To maintain physical cash security and financial integrity, transfers require:
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 bg-slate-50 p-4 rounded-2xl border border-slate-100 text-xs text-slate-700">
              <div className="flex items-start gap-2.5">
                <span className="font-bold text-amber-600">1.</span>
                <span><strong>Cash Requisition:</strong> Requester drafts cash need with operational justification.</span>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="font-bold text-amber-600">2.</span>
                <span><strong>Manager Approval:</strong> Dual-control review and funding source allocation.</span>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="font-bold text-amber-600">3.</span>
                <span><strong>Physical Dispatch & Receipt:</strong> Independent denomination counts, tamper bag seal tracking, and automated GL posting.</span>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setIsOpen(false)} className="rounded-xl">
                View Historical Ledger
              </Button>
              <Button 
                onClick={() => {
                  setIsOpen(false);
                  window.location.href = '/finance/cash/transfers';
                }}
                className="bg-slate-900 hover:bg-slate-800 font-bold text-white rounded-xl gap-2"
              >
                Open Transfer Hub <Send className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <div className="flex items-center space-x-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search ledger logs by TX ID..." className="pl-8 bg-white border-slate-200" />
        </div>
      </div>

      <div className="glass border-white/40 rounded-3xl shadow-2xl bg-white/40 flex flex-col min-h-[420px]">
        <Table>
          <TableHeader className="bg-slate-50/50">
            <TableRow>
              <TableHead className="px-4 py-4 font-black text-[10px] uppercase tracking-widest text-slate-400">TX ID / HASH</TableHead>
              {viewMode === 'GLOBAL' && (
                <TableHead className="px-4 py-4 font-black text-[10px] uppercase tracking-widest text-slate-400">Branch</TableHead>
              )}
              <TableHead className="px-4 py-4 font-black text-[10px] uppercase tracking-widest text-slate-400">Type / Direction</TableHead>
              <TableHead className="px-4 py-4 font-black text-[10px] uppercase tracking-widest text-slate-400">Timestamp</TableHead>
              <TableHead className="px-4 py-4 font-black text-[10px] uppercase tracking-widest text-slate-400 max-w-xs">Audit Reference</TableHead>
              <TableHead className="px-4 py-4 text-right font-black text-[10px] uppercase tracking-widest text-slate-400">Capital Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="divide-y divide-slate-100">
            {loading ? (
               <TableRow><TableCell colSpan={6} className="h-96 text-center font-black text-slate-300 tracking-widest uppercase animate-pulse">Synchronizing Ledger State...</TableCell></TableRow>
            ) : transactions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-96 text-center text-slate-400">
                  <div className="flex flex-col items-center justify-center gap-4">
                    <div className="h-20 w-20 bg-slate-50 rounded-full flex items-center justify-center border border-slate-100 shadow-inner">
                      <FileText className="h-10 w-10 text-slate-300" />
                    </div>
                    <div className="space-y-1">
                      <p className="font-black text-slate-800 uppercase tracking-widest text-xs">No transactions found</p>
                      <p className="text-sm font-medium text-slate-400">The operational ledger is currently empty for this scope.</p>
                    </div>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
                transactions.map((tx) => (
                  <TableRow key={tx.id} className="group hover:bg-amber-50/40 transition-all duration-300">
                    <TableCell className="px-4 py-4 font-black text-slate-900 group-hover:text-amber-700 transition-colors">
                      {tx.id.substring(0,8).toUpperCase()}
                    </TableCell>
                    {viewMode === 'GLOBAL' && (
                      <TableCell className="px-4 py-4">
                        <span className="font-black text-[10px] bg-slate-100 text-slate-600 px-3 py-1 rounded-lg tracking-widest uppercase border border-slate-200">
                          {tx.branch_id || 'HQ'}
                        </span>
                      </TableCell>
                    )}
                    <TableCell className="px-4 py-4">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "h-2 w-2 rounded-full",
                          tx.type === 'TRANSFER' ? "bg-orange-500 shadow-sm shadow-orange-500/50" : "bg-blue-500 shadow-sm shadow-blue-500/50"
                        )} />
                        <span className="font-black text-slate-700 text-xs uppercase tracking-tight">
                          {tx.type}
                          {tx.target_branch_id && <span className="text-[9px] bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full ml-2 font-black">TO: {tx.target_branch_id}</span>}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-4 text-slate-500 font-bold text-xs uppercase tracking-widest">
                      {new Date(tx.timestamp).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </TableCell>
                    <TableCell className="px-4 py-4 text-slate-600 font-medium max-w-xs whitespace-normal break-words text-sm">{tx.description}</TableCell>
                    <TableCell className={cn(
                      "px-4 py-4 text-right font-black text-sm tracking-tighter",
                      tx.type === 'TRANSFER' ? 'text-rose-600' : 'text-slate-900'
                    )}>
                      {tx.type === 'TRANSFER' ? `- Rs. ${tx.amount.toLocaleString()}` : `Rs. ${tx.amount.toLocaleString()}`}
                    </TableCell>
                  </TableRow>
                ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
