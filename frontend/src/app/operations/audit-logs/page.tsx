'use client';

import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  ShieldCheck, RefreshCcw, Filter, UserCheck, Clock, Layers, 
  Search, Download, Activity, BadgeDollarSign, ShieldAlert, 
  Eye, X, Terminal, Laptop, Globe, CheckCircle2, AlertTriangle
} from "lucide-react";
import { toast } from "sonner";

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({ total: 0, activeUsersToday: 0, financialActions: 0, criticalActions: 0 });
  const [loading, setLoading] = useState(true);
  const [branches, setBranches] = useState<any[]>([]);
  
  /* Filters */
  const [searchQuery, setSearchQuery] = useState('');
  const [filterBranch, setFilterBranch] = useState('ALL');
  const [filterAction, setFilterAction] = useState('ALL');
  const [dateFilter, setDateFilter] = useState('ALL');
  const [userRole, setUserRole] = useState('TELLER');

  /* Auditor Verification State */
  const [verifiedLogsMap, setVerifiedLogsMap] = useState<Record<string, { verifiedBy: string; verifiedAt: string }>>({});

  /* Details Inspector Modal */
  const [selectedLog, setSelectedLog] = useState<any | null>(null);

  useEffect(() => {
    try {
      const storedMap = localStorage.getItem('auditor_verified_logs');
      if (storedMap) {
        setVerifiedLogsMap(JSON.parse(storedMap));
      }
    } catch (e) {}
  }, []);

  const handleVerifyLog = (logId: string) => {
    const stored = localStorage.getItem('user');
    const user = stored ? JSON.parse(stored) : null;
    const auditorEmail = user?.email || 'Auditor';

    setVerifiedLogsMap(prev => {
      const updated = {
        ...prev,
        [logId]: {
          verifiedBy: auditorEmail,
          verifiedAt: new Date().toISOString()
        }
      };
      localStorage.setItem('auditor_verified_logs', JSON.stringify(updated));
      return updated;
    });

    toast.success('Audit Log Verified!', {
      description: `Log entry officially verified by ${auditorEmail}.`
    });
  };

  const loadBranches = async () => {
    try {
      const res = await fetch('/api/branches');
      if (res.ok) {
        const data = await res.json();
        setBranches([{ id: 'ALL', name: 'All Branches' }, ...data]);
      }
    } catch (e) { console.error('Failed to load branches', e); }
  };

  const loadAuditLogs = async () => {
    setLoading(true);
    try {
      const stored = localStorage.getItem('user');
      const user = stored ? JSON.parse(stored) : null;
      if (user) setUserRole(user.role || 'TELLER');

      const params = new URLSearchParams({
        branchId: (user?.role === 'ADMIN' || user?.role === 'AUDITOR') ? filterBranch : (user?.branchId || 'HQ'),
        action: filterAction,
      });

      if (searchQuery.trim()) {
        params.append('search', searchQuery.trim());
      }

      if (dateFilter === 'TODAY') {
        const today = new Date().toISOString().split('T')[0];
        params.append('startDate', today);
      } else if (dateFilter === '7DAYS') {
        const d = new Date();
        d.setDate(d.getDate() - 7);
        params.append('startDate', d.toISOString().split('T')[0]);
      } else if (dateFilter === '30DAYS') {
        const d = new Date();
        d.setDate(d.getDate() - 30);
        params.append('startDate', d.toISOString().split('T')[0]);
      }

      const res = await fetch(`/api/audit-logs?${params}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setLogs(data);
          setStats({ total: data.length, activeUsersToday: 0, financialActions: 0, criticalActions: 0 });
        } else {
          setLogs(data.logs || []);
          setStats(data.stats || { total: 0, activeUsersToday: 0, financialActions: 0, criticalActions: 0 });
        }
      } else {
        toast.error('Failed to load activity audit logs');
      }
    } catch (err) {
      console.error(err);
      toast.error('Error fetching audit logs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBranches();
  }, []);

  useEffect(() => {
    loadAuditLogs();
  }, [filterBranch, filterAction, dateFilter]);

  // Client-side search filtering fallback for instant response
  const filteredLogs = useMemo(() => {
    if (!searchQuery.trim()) return logs;
    const q = searchQuery.toLowerCase().trim();
    return logs.filter(l => 
      l.user_email?.toLowerCase().includes(q) ||
      l.action?.toLowerCase().includes(q) ||
      l.resource?.toLowerCase().includes(q) ||
      l.branch_id?.toLowerCase().includes(q) ||
      JSON.stringify(l.details || {}).toLowerCase().includes(q)
    );
  }, [logs, searchQuery]);

  /* CSV Export */
  const exportToCSV = () => {
    if (filteredLogs.length === 0) return toast.error('No logs available to export');

    const headers = ['Timestamp', 'User Email', 'Role', 'Branch', 'Action', 'Resource', 'Status', 'IP Address', 'Details'];
    const rows = filteredLogs.map(l => [
      l.created_at ? new Date(l.created_at).toLocaleString('en-GB') : '',
      l.user_email || 'System',
      l.role || '',
      l.branch_id || '',
      l.action || '',
      l.resource || '',
      l.details?.status || 'SUCCESS',
      l.details?.ip_address || '127.0.0.1',
      JSON.stringify(l.details || {})
    ]);

    const escapeCell = (val: any) => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/\r\n|\r|\n/g, ' ');
      return `"${str.replace(/"/g, '""')}"`;
    };

    const csvLines = [
      headers.map(escapeCell).join(','),
      ...rows.map(row => row.map(escapeCell).join(','))
    ];

    const csvString = csvLines.join('\r\n');
    const blob = new Blob(['\uFEFF' + csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `MIFOS_Audit_Logs_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 500);
    toast.success('Audit Log Trail exported successfully as CSV!');
  };

  /* Helper for Action Severity and Colors */
  const getActionBadge = (actionName: string) => {
    const act = (actionName || '').toUpperCase();
    if (act.includes('DELETE') || act.includes('REMOVE') || act.includes('REVOKE')) {
      return { label: act, bg: 'bg-rose-500/10 text-rose-600 border-rose-200 ring-rose-500/20' };
    }
    if (act.includes('WITHDRAW')) {
      return { label: act, bg: 'bg-purple-500/10 text-purple-700 border-purple-200 ring-purple-500/20' };
    }
    if (act.includes('RESTORE') || act.includes('RECOVER')) {
      return { label: act, bg: 'bg-emerald-500/10 text-emerald-600 border-emerald-200 ring-emerald-500/20' };
    }
    if (act.includes('PAWN') || act.includes('REDEEM') || act.includes('INTEREST') || act.includes('LEDGER')) {
      return { label: act, bg: 'bg-indigo-500/10 text-indigo-600 border-indigo-200 ring-indigo-500/20' };
    }
    if (act.includes('LOGIN') || act.includes('USER') || act.includes('ROLE')) {
      return { label: act, bg: 'bg-amber-500/10 text-amber-600 border-amber-200 ring-amber-500/20' };
    }
    return { label: act, bg: 'bg-slate-500/10 text-slate-700 border-slate-200' };
  };

  return (
    <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-700 pb-16">

      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center glass p-8 rounded-3xl border-white/40 shadow-2xl gap-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-br from-indigo-500/10 via-purple-500/5 to-transparent rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-indigo-600/10 rounded-2xl border border-indigo-500/20 text-indigo-600 shadow-inner">
              <ShieldCheck className="w-8 h-8" />
            </div>
            <div>
              <h1 className="text-3xl md:text-4xl font-black text-slate-900 tracking-tighter leading-none">
                System <span className="bg-gradient-to-r from-indigo-600 via-purple-600 to-amber-500 bg-clip-text text-transparent">Audit Logs</span>
              </h1>
              <p className="text-slate-500 font-semibold text-xs md:text-sm tracking-tight mt-1.5">
                Real-time security trail, cashier operational audit, and system event inspector.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto relative z-10">
          <Button
            onClick={exportToCSV}
            variant="outline"
            className="h-11 px-4 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 border-emerald-200 font-bold rounded-2xl shadow-sm text-xs"
          >
            <Download className="w-4 h-4 mr-2" /> Export CSV
          </Button>
          <Button
            onClick={loadAuditLogs}
            variant="outline"
            className="h-11 px-4 bg-white/80 hover:bg-white text-slate-700 border-slate-200 font-bold rounded-2xl shadow-sm text-xs"
          >
            <RefreshCcw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin text-indigo-600' : ''}`} /> Refresh
          </Button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <Card className="glass border-white/50 shadow-xl rounded-3xl p-5 relative overflow-hidden">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total Audit Events</p>
              <h3 className="text-3xl font-black text-slate-900 tracking-tight mt-1">{stats.total || logs.length}</h3>
            </div>
            <div className="p-3.5 bg-blue-500/10 rounded-2xl text-blue-600 border border-blue-500/20">
              <Activity className="w-6 h-6" />
            </div>
          </div>
          <p className="text-[11px] font-medium text-slate-500 mt-3 flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-blue-500 inline-block animate-pulse" />
            Recorded activity log stream
          </p>
        </Card>

        <Card className="glass border-white/50 shadow-xl rounded-3xl p-5 relative overflow-hidden">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Active Users Today</p>
              <h3 className="text-3xl font-black text-slate-900 tracking-tight mt-1">{stats.activeUsersToday || '—'}</h3>
            </div>
            <div className="p-3.5 bg-emerald-500/10 rounded-2xl text-emerald-600 border border-emerald-500/20">
              <UserCheck className="w-6 h-6" />
            </div>
          </div>
          <p className="text-[11px] font-medium text-slate-500 mt-3 flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
            Unique active cashiers & admins
          </p>
        </Card>

        <Card className="glass border-white/50 shadow-xl rounded-3xl p-5 relative overflow-hidden">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Financial Operations</p>
              <h3 className="text-3xl font-black text-slate-900 tracking-tight mt-1">{stats.financialActions}</h3>
            </div>
            <div className="p-3.5 bg-indigo-500/10 rounded-2xl text-indigo-600 border border-indigo-500/20">
              <BadgeDollarSign className="w-6 h-6" />
            </div>
          </div>
          <p className="text-[11px] font-medium text-slate-500 mt-3 flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-indigo-500 inline-block" />
            Loans, Redemptions & Ledger
          </p>
        </Card>

        <Card className="glass border-white/50 shadow-xl rounded-3xl p-5 relative overflow-hidden">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Critical / Security Actions</p>
              <h3 className="text-3xl font-black text-slate-900 tracking-tight mt-1">{stats.criticalActions}</h3>
            </div>
            <div className="p-3.5 bg-rose-500/10 rounded-2xl text-rose-600 border border-rose-500/20">
              <ShieldAlert className="w-6 h-6" />
            </div>
          </div>
          <p className="text-[11px] font-medium text-slate-500 mt-3 flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-rose-500 inline-block" />
            Restores, Deletions & Security
          </p>
        </Card>
      </div>

      {/* Multi-Filter & Search Bar */}
      <Card className="glass border-white/40 shadow-xl rounded-3xl p-5">
        <div className="flex flex-col lg:flex-row gap-4 items-center justify-between">

          {/* Search Input */}
          <div className="relative w-full lg:w-96">
            <Search className="absolute left-4 top-3.5 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search by Cashier Email, Ticket #, Action, Resource..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-11 pr-4 py-2.5 bg-white/70 border border-slate-200/80 rounded-2xl text-xs font-semibold placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 shadow-sm transition-all"
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                className="absolute right-3.5 top-3 text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Filter Dropdowns */}
          <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto justify-end">
            
            {/* Branch Filter */}
            {userRole === 'ADMIN' && (
              <div className="flex items-center gap-2">
                <Select value={filterBranch} onValueChange={(v) => v && setFilterBranch(v)}>
                  <SelectTrigger className="h-10 px-3 bg-white/80 border-slate-200 font-extrabold text-[11px] uppercase tracking-wider rounded-xl shadow-sm w-40">
                    <Filter className="w-3.5 h-3.5 mr-1.5 text-indigo-500" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="glass border-white/40 rounded-2xl shadow-2xl max-h-64">
                    {branches.map(b => (
                      <SelectItem key={b.id} value={b.id} className="font-bold text-[11px] uppercase tracking-widest">
                        {b.name} ({b.id})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Action Type Filter */}
            <Select value={filterAction} onValueChange={(v) => v && setFilterAction(v)}>
              <SelectTrigger className="h-10 px-3 bg-white/80 border-slate-200 font-extrabold text-[11px] uppercase tracking-wider rounded-xl shadow-sm w-44">
                <Layers className="w-3.5 h-3.5 mr-1.5 text-indigo-500" />
                <SelectValue placeholder="Action Category" />
              </SelectTrigger>
              <SelectContent className="glass border-white/40 rounded-2xl shadow-2xl max-h-64">
                <SelectItem value="ALL" className="font-bold text-[11px] uppercase tracking-widest">All Action Types</SelectItem>
                <SelectItem value="ORIGINATE" className="font-bold text-[11px] uppercase tracking-widest">Pawn Loans (Originate)</SelectItem>
                <SelectItem value="REDEEM" className="font-bold text-[11px] uppercase tracking-widest">Pawn Redemptions</SelectItem>
                <SelectItem value="WITHDRAW" className="font-bold text-[11px] uppercase tracking-widest">Stock Withdrawals</SelectItem>
                <SelectItem value="RESTORE" className="font-bold text-[11px] uppercase tracking-widest">Stock Restores</SelectItem>
                <SelectItem value="DELETE" className="font-bold text-[11px] uppercase tracking-widest">Stock / User Deletions</SelectItem>
                <SelectItem value="LEDGER" className="font-bold text-[11px] uppercase tracking-widest">Ledger & Matrix Updates</SelectItem>
                <SelectItem value="LOGIN" className="font-bold text-[11px] uppercase tracking-widest">User Logins</SelectItem>
              </SelectContent>
            </Select>

            {/* Date Range Filter */}
            <Select value={dateFilter} onValueChange={(v) => v && setDateFilter(v)}>
              <SelectTrigger className="h-10 px-3 bg-white/80 border-slate-200 font-extrabold text-[11px] uppercase tracking-wider rounded-xl shadow-sm w-36">
                <Clock className="w-3.5 h-3.5 mr-1.5 text-indigo-500" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="glass border-white/40 rounded-2xl shadow-2xl">
                <SelectItem value="ALL" className="font-bold text-[11px] uppercase tracking-widest">All Time</SelectItem>
                <SelectItem value="TODAY" className="font-bold text-[11px] uppercase tracking-widest">Today</SelectItem>
                <SelectItem value="7DAYS" className="font-bold text-[11px] uppercase tracking-widest">Last 7 Days</SelectItem>
                <SelectItem value="30DAYS" className="font-bold text-[11px] uppercase tracking-widest">Last 30 Days</SelectItem>
              </SelectContent>
            </Select>

          </div>

        </div>
      </Card>

      {/* Main Audit Trail Data Table */}
      <Card className="glass border-white/40 shadow-2xl rounded-3xl overflow-hidden">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-950 text-white">
                <TableRow className="hover:bg-slate-900 border-slate-800">
                  <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-300 py-4 pl-6">Timestamp</TableHead>
                  <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-300">User / Cashier</TableHead>
                  <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-300">Branch</TableHead>
                  <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-300">Action Type</TableHead>
                  <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-300">Target Resource</TableHead>
                  <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-300">Status & IP</TableHead>
                  <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-300 text-right pr-6">Inspect</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-slate-100">
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-16 text-slate-400 font-bold text-sm">
                      <RefreshCcw className="w-8 h-8 animate-spin mx-auto mb-3 text-indigo-600" />
                      Fetching live system audit trail...
                    </TableCell>
                  </TableRow>
                ) : filteredLogs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-16 text-slate-400 font-bold text-sm">
                      No security audit log records match your selected filter criteria.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredLogs.map((log) => {
                    const dateStr = log.created_at ? new Date(log.created_at).toLocaleString('en-GB') : '—';
                    const badge = getActionBadge(log.action);
                    const statusVal = log.details?.status || 'SUCCESS';
                    const isSuccess = statusVal === 'SUCCESS';

                    return (
                      <TableRow key={log.id} className="hover:bg-slate-50/80 transition-colors">
                        
                        {/* Timestamp */}
                        <TableCell className="pl-6 font-mono text-xs text-slate-600 font-semibold py-4">
                          <div className="flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            {dateStr}
                          </div>
                        </TableCell>

                        {/* User Email & Role */}
                        <TableCell className="font-bold text-slate-900 text-xs">
                          <div className="flex flex-col">
                            <div className="flex items-center gap-1.5 font-bold text-slate-800">
                              <UserCheck className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                              {log.user_email || 'System'}
                            </div>
                            <span className="text-[10px] font-black text-slate-400 tracking-wider uppercase ml-5">
                              {log.role || 'TELLER'}
                            </span>
                          </div>
                        </TableCell>

                        {/* Branch */}
                        <TableCell>
                          <span className="px-2.5 py-1 text-[10px] font-black rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200/60 uppercase tracking-widest font-mono">
                            {log.branch_id || 'HQ'}
                          </span>
                        </TableCell>

                        {/* Action Badge */}
                        <TableCell>
                          <span className={`px-2.5 py-1 text-[10px] font-black rounded-lg border uppercase tracking-wider inline-block ${badge.bg}`}>
                            {badge.label}
                          </span>
                        </TableCell>

                        {/* Target Resource */}
                        <TableCell className="font-mono text-xs font-bold text-slate-700">
                          {log.resource || '—'}
                        </TableCell>

                        {/* Status & IP */}
                        <TableCell>
                          <div className="flex flex-col gap-0.5">
                            <span className={`inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest ${isSuccess ? 'text-emerald-600' : 'text-rose-600'}`}>
                              {isSuccess ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                              {statusVal}
                            </span>
                            <span className="text-[10px] font-mono text-slate-400">
                              {log.details?.ip_address || '127.0.0.1'}
                            </span>
                          </div>
                        </TableCell>

                        {/* Inspect & Auditor Verification Buttons */}
                        <TableCell className="text-right pr-6">
                          <div className="flex items-center justify-end gap-2">
                            {verifiedLogsMap[log.id] ? (
                              <span 
                                className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200/80 px-2.5 py-1 rounded-lg"
                                title={`Verified by ${verifiedLogsMap[log.id].verifiedBy} on ${new Date(verifiedLogsMap[log.id].verifiedAt).toLocaleString()}`}
                              >
                                <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Verified
                              </span>
                            ) : (userRole === 'ADMIN' || userRole === 'AUDITOR') ? (
                              <Button
                                onClick={() => handleVerifyLog(log.id)}
                                size="sm"
                                variant="outline"
                                className="h-8 px-2.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-300 font-black text-[10px] uppercase tracking-wider rounded-xl gap-1 cursor-pointer"
                              >
                                <CheckCircle2 className="w-3 h-3" /> Verify
                              </Button>
                            ) : null}

                            <Button
                              onClick={() => setSelectedLog(log)}
                              size="sm"
                              variant="ghost"
                              className="h-8 px-3 text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 font-bold rounded-xl text-xs gap-1.5 cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" /> Details
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

      {/* JSON Details Inspector Modal */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
            
            {/* Modal Header */}
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-900 text-white">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-indigo-500/20 rounded-xl text-indigo-400 border border-indigo-400/30">
                  <Terminal className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-lg text-white tracking-tight">Audit Event Inspector</h3>
                  <p className="text-xs text-slate-400 font-mono">Event ID: {selectedLog.id}</p>
                </div>
              </div>
              <button 
                onClick={() => setSelectedLog(null)}
                className="p-2 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-6 text-slate-800 text-xs">
              
              {/* Event Metadata Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100 font-semibold">
                <div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block">User Email</span>
                  <span className="text-slate-900 font-bold">{selectedLog.user_email || 'System'}</span>
                </div>
                <div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block">Role & Branch</span>
                  <span className="text-slate-900 font-bold">{selectedLog.role} ({selectedLog.branch_id || 'HQ'})</span>
                </div>
                <div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block">Timestamp</span>
                  <span className="text-slate-900 font-mono">{selectedLog.created_at ? new Date(selectedLog.created_at).toLocaleString('en-GB') : '—'}</span>
                </div>
                <div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block">Action Type</span>
                  <span className="text-indigo-600 font-black">{selectedLog.action}</span>
                </div>
                <div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block">Target Resource</span>
                  <span className="text-slate-900 font-mono">{selectedLog.resource || '—'}</span>
                </div>
                <div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block">IP Address</span>
                  <span className="text-slate-900 font-mono flex items-center gap-1">
                    <Globe className="w-3 h-3 text-slate-400" />
                    {selectedLog.details?.ip_address || '127.0.0.1'}
                  </span>
                </div>
              </div>

              {/* User Agent / Device Info */}
              {selectedLog.details?.user_agent && (
                <div className="p-3 bg-slate-100/70 rounded-xl border border-slate-200/60 font-mono text-[11px] text-slate-600 flex items-start gap-2">
                  <Laptop className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                  <span className="break-all">{selectedLog.details.user_agent}</span>
                </div>
              )}

              {/* Full JSON State Diff Payload */}
              <div>
                <h4 className="font-black text-xs uppercase tracking-widest text-slate-500 mb-2 flex items-center justify-between">
                  <span>Payload Details & State Diff</span>
                  <span className="text-[10px] font-mono text-slate-400">JSON Format</span>
                </h4>
                <pre className="p-4 bg-slate-950 text-emerald-400 font-mono text-xs rounded-2xl border border-slate-800 overflow-x-auto max-h-64 leading-relaxed shadow-inner">
                  {JSON.stringify(selectedLog.details || {}, null, 2)}
                </pre>
              </div>

            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end">
              <Button
                onClick={() => setSelectedLog(null)}
                className="h-10 px-6 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs"
              >
                Close Inspector
              </Button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
