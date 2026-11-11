'use client';

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileText, Printer, Download, TrendingUp, TrendingDown, Scale, DollarSign, Filter, RefreshCcw } from "lucide-react";
import { toast } from "sonner";

export default function FinancialReportsPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [branches, setBranches] = useState<any[]>([]);
  const [filterBranch, setFilterBranch] = useState('ALL');
  const [userRole, setUserRole] = useState('TELLER');

  const loadBranches = async () => {
    try {
      const res = await fetch('/api/branches');
      if (res.ok) {
        const b = await res.json();
        setBranches([{ id: 'ALL', name: 'All Branches' }, ...b]);
      }
    } catch (e) { console.error(e); }
  };

  const loadFinancials = useCallback(async () => {
    setLoading(true);
    try {
      const stored = localStorage.getItem('user');
      const u = stored ? JSON.parse(stored) : null;
      if (u) setUserRole(u.role || 'TELLER');

      const params = new URLSearchParams({
        branchId: (u?.role === 'ADMIN' || u?.role === 'AUDITOR') ? filterBranch : (u?.branchId || 'HQ')
      });

      const res = await fetch(`/api/reports/financials?${params}`);
      if (res.ok) {
        const result = await res.json();
        setData(result);
      } else {
        toast.error('Failed to load financial reports');
      }
    } catch (err) {
      console.error(err);
      toast.error('Error fetching financial reports');
    } finally {
      setLoading(false);
    }
  }, [filterBranch]);

  useEffect(() => {
    loadBranches();
  }, []);

  useEffect(() => {
    loadFinancials();
  }, [loadFinancials]);

  const handlePrint = () => {
    window.print();
  };

  const trialBalance = data?.trialBalance || [];
  const pl = data?.profitLoss || {};
  const totalDebit = trialBalance.reduce((s: number, r: any) => s + Number(r.debit || 0), 0);
  const totalCredit = trialBalance.reduce((s: number, r: any) => s + Number(r.credit || 0), 0);

  return (
    <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-700">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center glass p-8 rounded-2xl border-white/40 shadow-2xl gap-6">
        <div>
          <div className="flex items-center gap-3">
            <Scale className="w-8 h-8 text-emerald-600" />
            <h1 className="text-4xl font-black text-slate-900 tracking-tighter leading-none">
              Financial <span className="text-gradient">Statements & Reports</span>
            </h1>
          </div>
          <p className="text-slate-500 font-medium tracking-tight mt-2">
            Automated General Ledger Trial Balance & Profit & Loss Statement.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          {(userRole === 'ADMIN' || userRole === 'AUDITOR') && (
            <Select value={filterBranch} onValueChange={(v) => v && setFilterBranch(v)}>
              <SelectTrigger className="h-12 w-full sm:w-44 bg-white/70 border-white/40 font-black text-[11px] uppercase tracking-widest rounded-2xl shadow-lg">
                <Filter className="w-3.5 h-3.5 mr-2 text-slate-400" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="glass border-white/40 rounded-2xl shadow-2xl">
                {branches.map(b => (
                  <SelectItem key={b.id} value={b.id} className="font-bold text-[11px] uppercase tracking-widest">
                    {b.name} ({b.id})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Button
            onClick={loadFinancials}
            disabled={loading}
            variant="outline"
            className="h-12 px-5 bg-white border-[#d6d6d6] text-[#202020] hover:bg-slate-100 font-bold rounded-2xl shadow-xs"
          >
            <RefreshCcw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>

          <Button
            onClick={handlePrint}
            className="h-12 px-6 bg-[#ffd100] hover:bg-[#ffee32] text-[#202020] font-black text-xs uppercase tracking-widest rounded-2xl shadow-lg border border-[#ffd100] flex items-center gap-2"
          >
            <Printer className="w-4 h-4" /> Print Reports
          </Button>
        </div>
      </div>

      {/* Overview Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="glass border-emerald-200/50 shadow-xl rounded-3xl p-6 bg-emerald-50/40">
          <div className="flex justify-between items-start">
            <div>
              <span className="text-xs font-black text-emerald-700 uppercase tracking-widest">Interest Income (Revenue)</span>
              <h2 className="text-3xl font-black font-mono text-emerald-950 mt-1">
                LKR {Number(pl.interestIncome || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </h2>
            </div>
            <div className="p-3 bg-emerald-600 text-white rounded-2xl shadow-md">
              <TrendingUp className="w-6 h-6" />
            </div>
          </div>
        </Card>

        <Card className="glass border-rose-200/50 shadow-xl rounded-3xl p-6 bg-rose-50/40">
          <div className="flex justify-between items-start">
            <div>
              <span className="text-xs font-black text-rose-700 uppercase tracking-widest">Operating Expenses</span>
              <h2 className="text-3xl font-black font-mono text-rose-950 mt-1">
                LKR {Number(pl.operatingExpenses || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </h2>
            </div>
            <div className="p-3 bg-rose-600 text-white rounded-2xl shadow-md">
              <TrendingDown className="w-6 h-6" />
            </div>
          </div>
        </Card>

        <Card className="glass border-indigo-200/50 shadow-xl rounded-3xl p-6 bg-indigo-50/40">
          <div className="flex justify-between items-start">
            <div>
              <span className="text-xs font-black text-indigo-700 uppercase tracking-widest">Net Profit / (Loss)</span>
              <h2 className={`text-3xl font-black font-mono mt-1 ${pl.netProfit >= 0 ? 'text-indigo-950' : 'text-rose-600'}`}>
                LKR {Number(pl.netProfit || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </h2>
            </div>
            <div className="p-3 bg-indigo-600 text-white rounded-2xl shadow-md">
              <DollarSign className="w-6 h-6" />
            </div>
          </div>
        </Card>
      </div>

      {/* Trial Balance Table */}
      <Card className="glass border-white/40 shadow-2xl rounded-3xl overflow-hidden p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-200 pb-4">
          <h2 className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            <Scale className="w-5 h-5 text-indigo-600" />
            General Ledger Trial Balance (පිරික්සුම් ශේෂය)
          </h2>
          <span className="text-xs font-bold text-slate-500 font-mono">
            Branch: <strong className="text-slate-900">{data?.branchId || 'ALL'}</strong>
          </span>
        </div>

        <Table>
          <TableHeader className="bg-slate-950 text-white">
            <TableRow className="hover:bg-slate-900 border-slate-800">
              <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-300">Account Name</TableHead>
              <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-300 text-right">Debit (LKR)</TableHead>
              <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-300 text-right">Credit (LKR)</TableHead>
              <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-300 text-right">Net Balance (LKR)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="divide-y divide-slate-100 font-mono font-bold text-xs">
            {loading ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-12 text-slate-400 font-bold text-sm">
                  <RefreshCcw className="w-6 h-6 animate-spin mx-auto mb-2 text-emerald-600" /> Computing Trial Balance from double-entry logs...
                </TableCell>
              </TableRow>
            ) : trialBalance.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-12 text-slate-400 font-bold text-sm">
                  No GL entries found.
                </TableCell>
              </TableRow>
            ) : (
              <>
                {trialBalance.map((row: any, idx: number) => (
                  <TableRow key={idx} className="hover:bg-slate-50">
                    <TableCell className="font-sans font-bold text-slate-900">{row.accountName}</TableCell>
                    <TableCell className="text-right text-slate-700">
                      Rs. {Number(row.debit || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right text-slate-700">
                      Rs. {Number(row.credit || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className={`text-right font-black ${row.netBalance >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                      Rs. {Number(row.netBalance || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-slate-900 text-white font-black text-sm">
                  <TableCell className="font-sans uppercase">Total Trial Balance</TableCell>
                  <TableCell className="text-right text-emerald-400">
                    Rs. {totalDebit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right text-emerald-400">
                    Rs. {totalCredit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right text-amber-400">
                    Rs. {(totalDebit - totalCredit).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </TableCell>
                </TableRow>
              </>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
