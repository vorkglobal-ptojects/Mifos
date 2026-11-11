'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  Wallet, Landmark, ArrowRightLeft, ShieldAlert, Clock, CheckCircle2, 
  Building2, PlusCircle, RefreshCcw, AlertTriangle, Eye, Send, ArrowDownLeft, 
  Layers, FileSpreadsheet, Lock, Unlock
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { getAuthHeaders } from '@/lib/getAuthHeaders';

export default function ConsolidatedCashDashboard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchDashboardData = async () => {
    try {
      setRefreshing(true);
      const headers = getAuthHeaders();
      const res = await fetch('/api/cash/dashboard', { headers });
      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      console.error(err);
      toast.error('Failed to load consolidated cash dashboard');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const summary = data?.summary || {
    totalBranchCash: 0,
    totalBankBalance: 0,
    totalTillCash: 0,
    inTransitAmount: 0,
    inTransitCount: 0,
    pendingRequestsCount: 0,
    discrepancyCount: 0,
    grandTotalLiquid: 0
  };

  return (
    <div className="space-y-8 animate-in slide-in-from-bottom-3 duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white/70 dark:bg-slate-900/70 backdrop-blur-md p-6 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-500/10 text-emerald-600 rounded-xl">
              <Wallet className="w-7 h-7" />
            </div>
            <div>
              <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">
                Consolidated <span className="text-emerald-600">Cash & Bank</span> Dashboard
              </h1>
              <p className="text-sm font-medium text-slate-500 mt-0.5">
                Multi-branch vault cash, active tills, bank balances, and transit oversight.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchDashboardData}
            disabled={refreshing}
            className="rounded-xl h-10 font-bold"
          >
            <RefreshCcw className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>

          <Link href="/finance/cash/requests">
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl h-10 shadow-sm shadow-emerald-600/20">
              <PlusCircle className="w-4 h-4 mr-1.5" /> Cash Requisition
            </Button>
          </Link>

          <Link href="/finance/cash/transfers">
            <Button size="sm" variant="outline" className="border-indigo-200 text-indigo-700 dark:border-indigo-800 dark:text-indigo-300 font-bold rounded-xl h-10">
              <ArrowRightLeft className="w-4 h-4 mr-1.5" /> Transfers & Transit
            </Button>
          </Link>
        </div>
      </div>

      {/* Primary KPI Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Vault Cash */}
        <Card className="rounded-2xl border-slate-200/80 dark:border-slate-800 shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Branch Vault Cash
            </CardTitle>
            <Building2 className="w-4 h-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black text-slate-900 dark:text-white">
              Rs. {summary.totalBranchCash.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </div>
            <p className="text-[11px] font-medium text-slate-500 mt-1">
              Sum of 14 canonical branch closing ledgers
            </p>
          </CardContent>
        </Card>

        {/* Bank Balances */}
        <Card className="rounded-2xl border-slate-200/80 dark:border-slate-800 shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Total Bank Balances
            </CardTitle>
            <Landmark className="w-4 h-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black text-slate-900 dark:text-white">
              Rs. {summary.totalBankBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </div>
            <Link href="/finance/cash/banks" className="text-[11px] font-bold text-blue-600 hover:underline mt-1 inline-block">
              Manage {data?.bankAccounts?.length || 0} registered bank accounts →
            </Link>
          </CardContent>
        </Card>

        {/* Cash in Transit */}
        <Card className={`rounded-2xl shadow-xs border ${summary.inTransitAmount > 0 ? 'border-amber-300 bg-amber-50/40 dark:bg-amber-950/20' : 'border-slate-200/80 dark:border-slate-800'}`}>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Cash In Transit
            </CardTitle>
            <ArrowRightLeft className="w-4 h-4 text-amber-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black text-amber-700 dark:text-amber-400">
              Rs. {summary.inTransitAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </div>
            <div className="text-[11px] font-medium text-slate-500 mt-1 flex items-center justify-between">
              <span>{summary.inTransitCount} physical transfers in transit</span>
              <Link href="/finance/cash/transfers" className="font-bold text-amber-600 hover:underline">Track</Link>
            </div>
          </CardContent>
        </Card>

        {/* Pending Requisitions / Discrepancies */}
        <Card className={`rounded-2xl shadow-xs border ${summary.discrepancyCount > 0 ? 'border-rose-300 bg-rose-50/40 dark:bg-rose-950/20' : 'border-slate-200/80 dark:border-slate-800'}`}>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Requisitions & Flags
            </CardTitle>
            <ShieldAlert className={`w-4 h-4 ${summary.discrepancyCount > 0 ? 'text-rose-600' : 'text-slate-400'}`} />
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <div>
                <span className="text-2xl font-black text-slate-900 dark:text-white">
                  {summary.pendingRequestsCount}
                </span>
                <span className="text-xs font-semibold text-slate-500 ml-1">Pending</span>
              </div>
              {summary.discrepancyCount > 0 && (
                <Badge variant="destructive" className="font-black animate-pulse">
                  {summary.discrepancyCount} Discrepancies
                </Badge>
              )}
            </div>
            <Link href="/finance/cash/requests" className="text-[11px] font-bold text-emerald-600 hover:underline mt-1 inline-block">
              Review Approval Queue →
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* Main Grid: Branch Cash Table & Bank Accounts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Branch Cash Table (2 Cols) */}
        <Card className="lg:col-span-2 rounded-2xl border-slate-200/80 dark:border-slate-800 shadow-xs">
          <CardHeader className="border-b border-slate-100 dark:border-slate-800 pb-4">
            <div className="flex justify-between items-center">
              <div>
                <CardTitle className="text-lg font-bold">Branch Vault Positions</CardTitle>
                <p className="text-xs text-slate-500 mt-0.5">Authoritative ledger closing cash reported by branch.</p>
              </div>
              <Link href="/accounting/ledger?tab=matrix">
                <Button variant="ghost" size="sm" className="text-xs font-bold text-emerald-600">
                  Full Ledger Matrix →
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="w-full">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="font-bold text-[11px] uppercase tracking-wider">Branch</TableHead>
                    <TableHead className="font-bold text-[11px] uppercase tracking-wider">Last Reported Date</TableHead>
                    <TableHead className="font-bold text-[11px] uppercase tracking-wider text-right">Vault Cash</TableHead>
                    <TableHead className="font-bold text-[11px] uppercase tracking-wider text-center">Status</TableHead>
                    <TableHead className="font-bold text-[11px] uppercase tracking-wider text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.branchCashList || []).map((b: any) => (
                    <TableRow key={b.branchId}>
                      <TableCell className="font-bold text-sm">
                        <span className="font-mono text-xs px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 mr-2 text-slate-600 dark:text-slate-300">
                          {b.branchId}
                        </span>
                        {b.branchName}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500 font-mono">
                        {b.lastReportedDate || 'Never'}
                      </TableCell>
                      <TableCell className="text-right font-black font-mono text-sm">
                        Rs. {b.latestClosingCash.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className={`text-[10px] font-bold uppercase ${
                          b.status === 'APPROVED' ? 'border-emerald-300 text-emerald-700 bg-emerald-50 dark:bg-emerald-950/30' :
                          b.status === 'FLAGGED' ? 'border-rose-300 text-rose-700 bg-rose-50 dark:bg-rose-950/30' :
                          'border-slate-300 text-slate-500'
                        }`}>
                          {b.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Link href={`/finance/cash/requests?branch=${b.branchId}`}>
                          <Button variant="ghost" size="sm" className="h-8 text-xs font-bold text-emerald-600">
                            Request Cash
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Bank Accounts Overview (1 Col) */}
        <Card className="rounded-2xl border-slate-200/80 dark:border-slate-800 shadow-xs">
          <CardHeader className="border-b border-slate-100 dark:border-slate-800 pb-4">
            <div className="flex justify-between items-center">
              <div>
                <CardTitle className="text-lg font-bold">Bank Accounts</CardTitle>
                <p className="text-xs text-slate-500 mt-0.5">Corporate accounts & statement balances.</p>
              </div>
              <Link href="/finance/cash/banks">
                <Button variant="ghost" size="sm" className="text-xs font-bold text-blue-600">
                  Manage →
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-4 space-y-3">
            {(data?.bankAccounts || []).length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-sm">
                <Landmark className="w-8 h-8 mx-auto mb-2 opacity-50" />
                No bank accounts registered yet.
                <div className="mt-2">
                  <Link href="/finance/cash/banks">
                    <Button size="sm" variant="outline" className="text-xs font-bold">
                      + Register First Bank
                    </Button>
                  </Link>
                </div>
              </div>
            ) : (
              data.bankAccounts.map((bank: any) => (
                <div key={bank.id} className="p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-bold text-sm text-slate-900 dark:text-white">{bank.bankName}</h4>
                      <p className="text-xs text-slate-500">{bank.accountName}</p>
                      <span className="font-mono text-[11px] text-slate-400 block mt-1">
                        Acc: {bank.maskedAccountNumber}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-black font-mono text-emerald-600 dark:text-emerald-400 block">
                        Rs. {bank.currentBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </span>
                      <span className="text-[10px] text-slate-400 block mt-1">
                        {bank.lastReconciledAt ? `Rec: ${new Date(bank.lastReconciledAt).toLocaleDateString()}` : 'Unreconciled'}
                      </span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
