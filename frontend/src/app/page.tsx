'use client';

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Users,
  CreditCard,
  Activity,
  ArrowUpRight,
  Sparkles,
  Layers,
  Zap,
  LineChart as LineChartIcon,
  ShieldCheck,
  Building2,
  Lock,
  Unlock,
  Power,
  MapPin
} from "lucide-react";
import {
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { normalizeBranchId, getBranchSearchTerms, CANONICAL_BRANCHES } from "@/lib/branch-mapping";
import { getAuthHeaders } from "@/lib/getAuthHeaders";

const statsTemplate = [
  { label: "Total Disbursed Portfolio", value: "Rs. 0", change: "+0.0%", trend: "up", icon: DollarSign, color: "emerald" },
  { label: "Active Pawn Tickets", value: "0", change: "+0.0%", trend: "up", icon: CreditCard, color: "blue" },
  { label: "Registered Customers", value: "0", change: "+0.0%", trend: "up", icon: Users, color: "primary" },
  { label: "System Health", value: "Online", change: "99.9%", trend: "up", icon: Zap, color: "indigo" },
];

const revenueData = [
  { month: "Jan", revenue: 45000, expenses: 32000 },
  { month: "Feb", revenue: 52000, expenses: 35000 },
  { month: "Mar", revenue: 48000, expenses: 33000 },
  { month: "Apr", revenue: 61000, expenses: 38000 },
  { month: "May", revenue: 55000, expenses: 36000 },
  { month: "Jun", revenue: 67000, expenses: 40000 },
];

const loanDistribution = [
  { name: "Gold Chains", value: 40, color: "var(--color-primary)" },
  { name: "Rings & Bangles", value: 30, color: "#10b981" },
  { name: "Necklaces & Pendants", value: 20, color: "#7c3aed" },
  { name: "Coins & Bars", value: 10, color: "#f59e0b" },
];

export default function Home() {
  const router = useRouter();
  const [stats, setStats] = useState(statsTemplate);
  const [recentTransactions, setRecentTransactions] = useState<any[]>([]);
  const [loadingTransactions, setLoadingTransactions] = useState(true);
  const [clientMap, setClientMap] = useState<{[key: string]: string}>({});
  const [branchId, setBranchId] = useState('');
  const [branchName, setBranchName] = useState('');
  const [userName, setUserName] = useState('');
  const [status, setStatus] = useState('CLOSED');
  const [isStatusLoading, setIsStatusLoading] = useState(false);
  const [monthlyGrowth, setMonthlyGrowth] = useState<any[]>(revenueData);
  const [loanTypesDistribution, setLoanTypesDistribution] = useState<any[]>(loanDistribution);
  const [activeLoanPercentage, setActiveLoanPercentage] = useState<number>(92);

  const getFirstName = (u: any): string => {
    if (!u) return 'User';
    const emailMap: Record<string, string> = {
      'madushaniperera9617@gmail.com': 'Madushani',
      'erandiperera25@gmail.com': 'Erandi',
      'erandiauditor@gmail.com': 'Erandi',
      'sanduminiauditor@gmail.com': 'Sandhumini',
      'nishanthimanager@gmail.com': 'Nishanthi',
      'manishadias@gmail.com': 'Manisha',
      'kavika2030@gmail.com': 'Imashi',
      'a.v.chamika.sonali@hrpulse.com': 'Chamika',
      'chathudissanayake63@gmail.com': 'Chathurika',
      'dahami.divyanjali@hrpulse.com': 'Dahami',
      'sachininirasha462@gmail.com': 'Sachini',
      'dilinisamudra8210@gmail.com': 'Dilini',
      'tharushisandumini1111@gmail.com': 'Tharushi',
      'kdrasikapriyangani80@gmail.com': 'Rasika',
      'chamilka.botheju@hrpulse.com': 'Chamilka',
      'chandimaperera501@gmail.com': 'Chandima',
      'chasirasulani@gmail.com': 'Chaseera',
      'tharushiaps99@icloud.com': 'Tharushi',
      'harshaha825@gmail.com': 'Harsha',
      'pereralakshi90@gmail.com': 'Lakshika',
      'geethanganipeiri2912@gmail.com': 'Geethangani',
      'dilupathamari9@gmail.com': 'Dilupa',
      'auditor@gmail.com': 'Auditor',
      'sanjay.rupasinghe@gmail.com': 'Sanjay',
      'manager@gmail.com': 'Manager',
      'admin@gmail.com': 'Admin',
      'admin@rupasinghe.com': 'Admin',
      'admin_sasindu@gmail.com': 'Sasindu',
      'admin_nisal@gmail.com': 'Nisal',
      'admin_dinusha@gmail.com': 'Dinusha',
      'admin_janani@gmail.com': 'Janani',
      'dilkiisanka3@gmail.com': 'Dilki'
    };

    const email = (u.email || '').toLowerCase().trim();
    if (email && emailMap[email]) return emailMap[email];
    if (u.role === 'ADMIN' || (email && email.startsWith('admin'))) return 'Admin';

    // Check first_name directly
    if (u.first_name && typeof u.first_name === 'string') {
      const cleanFirst = u.first_name.replace(/[0-9]+/g, '').trim();
      if (cleanFirst) return cleanFirst.charAt(0).toUpperCase() + cleanFirst.slice(1).toLowerCase();
    }

    // Check full name or user_metadata
    const raw = u.name || u.fullName || u.user_metadata?.full_name || u.user_metadata?.first_name || '';
    if (raw && typeof raw === 'string' && raw.trim()) {
      const cleaned = raw.replace(/[0-9]+/g, '').trim();
      if (cleaned.toLowerCase().includes('madushani')) return 'Madushani';
      const first = cleaned.split(/\s+/)[0];
      if (first) return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
    }

    // Check email prefix
    const emailPrefix = (u.email || u.username || '').split('@')[0] || '';
    const cleanedPrefix = emailPrefix.replace(/[0-9]+/g, '').replace(/[._]/g, ' ').trim();
    if (cleanedPrefix.toLowerCase().includes('madushani')) return 'Madushani';
    if (cleanedPrefix) {
      const first = cleanedPrefix.split(/\s+/)[0];
      if (first) return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
    }

    // Fallback: stored user_name in localStorage
    const storedName = typeof window !== 'undefined' ? localStorage.getItem('user_name') : null;
    if (storedName) {
      const cleanedStored = storedName.replace(/[0-9]+/g, '').replace(/[._]/g, ' ').trim();
      if (cleanedStored.toLowerCase().includes('madushani')) return 'Madushani';
      const first = cleanedStored.split(/\s+/)[0];
      if (first) return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
    }

    return 'User';
  };

  useEffect(() => {
    let uBranchId = localStorage.getItem('user_branch') || '';
    const storedUser = localStorage.getItem('user');
    let parsedUser: any = null;

    if (storedUser) {
      try {
        parsedUser = JSON.parse(storedUser);
        uBranchId = parsedUser.branchId || uBranchId;
      } catch (err) {
        console.error(err);
      }
    }

    const rawRole = localStorage.getItem('user_role') || parsedUser?.role || 'TELLER';
    const upperRole = rawRole.toUpperCase().trim();

    if (upperRole === 'TELLER' || upperRole === 'AUTHENTICATED') {
      router.replace('/loans');
      return;
    }
    if (upperRole === 'AUDITOR') {
      router.replace('/dashboard/auditor');
      return;
    }
    if (upperRole === 'MANAGER') {
      router.replace('/operations/approvals');
      return;
    }

    if (parsedUser) {
      setBranchId(uBranchId);
      const bObj = CANONICAL_BRANCHES.find(b => b.id === normalizeBranchId(uBranchId));
      setBranchName(parsedUser.branchName || bObj?.name || 'Head Office');
      setUserName(getFirstName(parsedUser));
      fetchStatus(uBranchId);
    } else {
      const fallbackName = getFirstName({ email: localStorage.getItem('user_name') });
      setUserName(fallbackName);
    }

    // Also sync with Supabase session to guarantee first name is always populated
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        const nameFromSession = getFirstName(user);
        if (nameFromSession && nameFromSession !== 'User') {
          setUserName(nameFromSession);
        }
      }
    }).catch(() => {});

    loadDashboardData(uBranchId, upperRole);
  }, [router]);

  const fetchStatus = async (bid: string) => {
    try {
      const res = await fetch('/api/branch-status', { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        if (data[bid]) setStatus(data[bid]);
      }
    } catch (err) { console.error(err); }
  };

  const toggleStatus = async () => {
    if (!branchId) return;
    const newStatus = status === 'OPEN' ? 'CLOSED' : 'OPEN';
    setIsStatusLoading(true);
    const toastId = toast.loading(`Setting branch as ${newStatus}...`);

    try {
      const res = await fetch('/api/branch-status', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ branchId, status: newStatus })
      });
      if (res.ok) {
        setStatus(newStatus);
        toast.success(`Branch is now ${newStatus}`, { id: toastId });
      } else throw new Error();
    } catch (err) {
      toast.error("Failed to update status", { id: toastId });
    } finally {
      setIsStatusLoading(false);
    }
  };

  const loadDashboardData = async (userBranchId?: string, userRole?: string) => {
    setLoadingTransactions(true);
    try {
      const isHeadBranch = !userBranchId || normalizeBranchId(userBranchId) === 'HQ' || userBranchId.toUpperCase() === 'HEAD OFFICE';
      const branchTerms = userBranchId ? getBranchSearchTerms(userBranchId) : [];
      const headers = getAuthHeaders();

      // 1. Fetch Customers Count & List via server-side API (falls back to client Supabase)
      let clientCount = 0;
      const cmap: { [key: string]: string } = {};

      try {
        const clientRes = await fetch('/api/clients?branchId=ALL&minimal=true', { headers });
        if (clientRes.ok) {
          const clientData = await clientRes.json();
          if (Array.isArray(clientData)) {
            clientCount = clientData.length;
            clientData.forEach((c: any) => {
              cmap[c.id] = `${c.first_name || ''} ${c.last_name || ''}`.trim() || 'Unknown Client';
            });
          }
        }
      } catch (e) {
        console.warn('Dashboard clients API fetch note:', e);
      }

      // If server API was empty, fallback to client Supabase
      if (clientCount === 0) {
        try {
          const { data: clientsList, count } = await supabase.from('clients').select('id, first_name, last_name', { count: 'exact' });
          if (count) clientCount = count;
          if (clientsList) {
            clientsList.forEach((c: any) => {
              cmap[c.id] = `${c.first_name || ''} ${c.last_name || ''}`.trim() || 'Unknown Client';
            });
          }
        } catch {}
      }
      setClientMap(cmap);

      // 2. Fetch Pawns via server-side API
      let pawnsData: any[] = [];
      const targetBranchParam = isHeadBranch ? 'ALL' : (userBranchId || 'ALL');
      try {
        const pawnsRes = await fetch(`/api/pawns?filterBranch=${targetBranchParam}`, { headers });
        if (pawnsRes.ok) {
          const resJson = await pawnsRes.json();
          if (Array.isArray(resJson)) {
            pawnsData = resJson;
          }
        }
      } catch (e) {
        console.warn('Dashboard pawns API fetch note:', e);
      }

      // If server API was empty, fallback to client Supabase
      if (pawnsData.length === 0) {
        try {
          let pawnsQuery = supabase.from('pawns').select('*');
          if (!isHeadBranch && userBranchId) {
            pawnsQuery = pawnsQuery.in('branch_id', branchTerms);
          }
          const { data } = await pawnsQuery;
          if (data) pawnsData = data;
        } catch {}
      }

      // Active Pawns are pawns with status === 'ACTIVE'
      const activePawnsList = pawnsData.filter((p: any) => (p.status || '').toUpperCase() === 'ACTIVE');
      const activePawnsCount = activePawnsList.length;
      const totalPawnsCount = pawnsData.length || 1;
      const totalPawnSum = activePawnsList.reduce((acc: number, p: any) => acc + (parseFloat(p.disbursed_amount) || 0), 0);

      // 3. Compute real 6-month Money Growth data (Disbursement vs Settlements)
      const now = new Date();
      const monthBuckets: any[] = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        monthBuckets.push({
          month: d.toLocaleString('en-US', { month: 'short' }),
          year: d.getFullYear(),
          mIndex: d.getMonth(),
          revenue: 0,
          expenses: 0
        });
      }

      (pawnsData || []).forEach((p: any) => {
        if (p.created_at) {
          const d = new Date(p.created_at);
          const bucket = monthBuckets.find(b => b.year === d.getFullYear() && b.mIndex === d.getMonth());
          if (bucket) {
            bucket.revenue += parseFloat(p.disbursed_amount) || 0;
          }
        }
        if (p.redeemed_at) {
          const d = new Date(p.redeemed_at);
          const bucket = monthBuckets.find(b => b.year === d.getFullYear() && b.mIndex === d.getMonth());
          if (bucket) {
            bucket.expenses += parseFloat(p.redeem_amount) || 0;
          }
        }
      });

      setMonthlyGrowth(monthBuckets.map(b => ({
        month: b.month,
        revenue: Math.round(b.revenue),
        expenses: Math.round(b.expenses)
      })));

      // 4. Compute real Collateral / Loan Types distribution
      const typeCategories: { [key: string]: number } = {
        'Rings': 0,
        'Chains & Necklaces': 0,
        'Pendants': 0,
        'Earrings & Studs': 0,
        'Bangles & Bracelets': 0,
      };
      let otherCount = 0;

      (pawnsData || []).forEach((p: any) => {
        const desc = (p.description || '').toUpperCase();
        if (desc.includes('RING') || desc.includes('PR') || desc.includes('R)') || desc.includes('(R')) {
          typeCategories['Rings']++;
        } else if (desc.includes('CHAIN') || desc.includes('CH') || desc.includes('NECKLACE') || desc.includes('NL')) {
          typeCategories['Chains & Necklaces']++;
        } else if (desc.includes('PENDANT') || desc.includes('PP') || desc.includes('PATHASARUM')) {
          typeCategories['Pendants']++;
        } else if (desc.includes('EAR') || desc.includes('STUD') || desc.includes('TS')) {
          typeCategories['Earrings & Studs']++;
        } else if (desc.includes('BANGLE') || desc.includes('BRC') || desc.includes('BRACELET') || desc.includes('CR')) {
          typeCategories['Bangles & Bracelets']++;
        } else {
          otherCount++;
        }
      });

      const palette = ['#f59e0b', '#10b981', '#8b5cf6', '#3b82f6', '#ec4899'];
      const realDistribution = Object.entries(typeCategories)
        .map(([name, count], idx) => ({
          name,
          value: Math.round((count / totalPawnsCount) * 100),
          count,
          color: palette[idx % palette.length]
        }))
        .filter(item => item.count > 0);

      if (otherCount > 0) {
        realDistribution.push({
          name: 'Other Articles',
          value: Math.round((otherCount / totalPawnsCount) * 100),
          count: otherCount,
          color: '#64748b'
        });
      }

      if (realDistribution.length > 0) {
        setLoanTypesDistribution(realDistribution);
      }

      // Active Loans ratio
      setActiveLoanPercentage(Math.round((activePawnsCount / totalPawnsCount) * 100));

      // 3. Recent Transactions (latest 6 pawns)
      const txs = pawnsData.slice(0, 6);
      if (txs.length > 0) {
        const formattedTxs = txs.map((p: any) => ({
          id: p.id,
          client_id: p.client_id,
          type: p.status || 'PAWN',
          amount: parseFloat(p.disbursed_amount) || 0,
          timestamp: p.created_at
        }));
        setRecentTransactions(formattedTxs);
      }

      setStats([
        { label: "Total Pawn Value", value: `Rs. ${totalPawnSum.toLocaleString()}`, change: "+0.0%", trend: "up", icon: DollarSign, color: "emerald" },
        { label: "Active Pawns", value: activePawnsCount.toString(), change: "+0.0%", trend: "up", icon: CreditCard, color: "blue" },
        { label: "Total Customers", value: (clientCount || 0).toString(), change: "+0.0%", trend: "up", icon: Users, color: "primary" },
        { label: "System Health", value: "Online", change: "100%", trend: "up", icon: Zap, color: "indigo" },
      ]);
    } catch (err) {
      console.error('Dashboard Load Error:', err);
    } finally {
      setLoadingTransactions(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-top-4 duration-1000 w-full max-w-[96%] xl:max-w-[1400px] mx-auto pb-10">
      {/* Dynamic Header Section */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-4 border-b border-slate-100">
        <div className="space-y-2">
          <h1 className="text-3xl lg:text-4xl font-black text-slate-900 tracking-tight leading-none flex items-center gap-2.5">
            Hi, <span className="text-amber-500 font-black">{userName || 'User'}</span>
          </h1>
          <p className="text-slate-500 font-bold text-sm flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-900 border border-amber-500/20 text-xs font-black uppercase tracking-wider">
              <MapPin className="w-3.5 h-3.5 text-amber-600 inline" />
              {branchName ? (branchName.toLowerCase().includes('branch') ? branchName : `${branchName} Branch`) : 'Head Office Branch'}
            </span>
            <span className="text-slate-400 font-medium">Manage operations in real-time</span>
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 shrink-0">
          <Button 
            onClick={toggleStatus}
            disabled={isStatusLoading || !branchId}
            className={cn(
              "h-10 font-black text-xs uppercase tracking-wider px-6 rounded-xl shadow-md transition-all duration-300 gap-1.5 cursor-pointer",
              status === 'OPEN' 
                ? "bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-200" 
                : "bg-rose-600 hover:bg-rose-700 text-white shadow-rose-200"
            )}
          >
            <Power className="w-3.5 h-3.5" />
            {status === 'OPEN' ? "Branch Open" : "Branch Closed"}
          </Button>
          <Button variant="outline" className="h-10 font-black text-xs uppercase tracking-wider px-6 rounded-xl border-slate-200 glass hover:bg-white shadow-xs cursor-pointer">
            History
          </Button>
          <Button className="h-10 bg-[#ffd100] hover:bg-[#ffee32] text-[#202020] font-black text-xs uppercase tracking-wider px-6 rounded-xl shadow-md card-hover cursor-pointer" onClick={() => router.push('/loans')}>
            New Pawn <ArrowUpRight className="ml-1 w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Bento Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.label} className="glass group overflow-hidden border-white/50 shadow-md hover:shadow-lg transition-all duration-350 rounded-2xl relative">
              <div className="absolute top-0 right-0 w-24 h-24 -mr-8 -mt-8 bg-amber-500/5 rounded-full blur-2xl group-hover:bg-amber-500/10 transition-colors" />
              <CardContent className="p-5 relative z-10">
                <div className="flex items-center justify-between mb-4">
                   <div className={cn(
                        "w-11 h-11 rounded-xl flex items-center justify-center shadow-inner transition-transform duration-300 group-hover:rotate-6",
                        stat.color === 'emerald' ? "bg-emerald-500/10 text-emerald-600" :
                        stat.color === 'blue' ? "bg-blue-500/10 text-blue-600" :
                        stat.color === 'indigo' ? "bg-indigo-500/10 text-indigo-600" :
                        "bg-amber-500/10 text-amber-700"
                    )}>
                        <Icon className="w-5 h-5" />
                   </div>
                   <div className={cn(
                       "flex items-center gap-1 py-1 px-2.5 rounded-full text-[9px] font-black uppercase tracking-widest",
                       stat.trend === "up" ? "bg-emerald-100/50 text-emerald-700" : "bg-rose-100/50 text-rose-700"
                   )}>
                       {stat.trend === "up" ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                       {stat.change}
                   </div>
                </div>
                <p className="text-slate-400 text-[9px] font-black uppercase tracking-[0.2em] mb-1.5">{stat.label}</p>
                <p className="text-2xl font-black text-slate-900 tracking-tighter leading-none">{stat.value}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Primary Analytics Bento Section */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Main Chart Card */}
        <Card className="lg:col-span-8 glass border-white/50 shadow-md rounded-2xl overflow-hidden p-6 flex flex-col">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4 p-0">
             <div>
                <CardTitle className="text-xl font-black tracking-tighter">Money Growth</CardTitle>
                <p className="text-slate-500 font-bold text-xs flex items-center gap-1.5">
                   <LineChartIcon className="w-3.5 h-3.5" /> Sales and Expenses
                </p>
             </div>
             <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                   <div className="w-3 h-3 rounded bg-primary shadow-sm shadow-primary/20" />
                   <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Income</span>
                </div>
                <div className="flex items-center gap-2">
                   <div className="w-3 h-3 rounded bg-indigo-255 bg-indigo-200" />
                   <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Expenses</span>
                </div>
             </div>
          </CardHeader>
          <CardContent className="p-0 flex-1">
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={monthlyGrowth}>
                <defs>
                  <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="colorExpenses" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} strokeOpacity={0.05} />
                <XAxis 
                  dataKey="month" 
                  stroke="#94a3b8" 
                  tick={{fontSize: 9, fontWeight: 900}} 
                  axisLine={false} 
                  tickLine={false}
                  dy={10}
                />
                <YAxis 
                  stroke="#94a3b8" 
                  tick={{fontSize: 9, fontWeight: 900}} 
                  axisLine={false} 
                  tickLine={false}
                  tickFormatter={(v) => v >= 1000000 ? `Rs.${(v/1000000).toFixed(1)}M` : `Rs.${Math.round(v/1000)}k`}
                />
                <Tooltip 
                  cursor={{ stroke: 'var(--color-primary)', strokeWidth: 1.5, strokeDasharray: '5 5' }}
                  contentStyle={{ 
                    backgroundColor: 'rgba(255, 255, 255, 0.95)', 
                    borderRadius: '16px', 
                    border: '1px solid rgba(0,0,0,0.05)', 
                    boxShadow: '0 15px 30px -10px rgba(0,0,0,0.1)',
                    backdropFilter: 'blur(10px)',
                    fontWeight: 900,
                    fontSize: '12px',
                    padding: '10px'
                  }} 
                  formatter={(v: any, name: any) => [`Rs. ${Number(v || 0).toLocaleString()}`, name === 'revenue' ? 'Disbursed' : 'Redeemed']}
                />
                <Area 
                  type="monotone" 
                  dataKey="revenue" 
                  name="revenue"
                  stroke="var(--color-primary)" 
                  strokeWidth={3} 
                  fillOpacity={1} 
                  fill="url(#colorRevenue)" 
                  animationDuration={1500}
                />
                <Area 
                  type="monotone" 
                  dataKey="expenses" 
                  name="expenses"
                  stroke="#6366f1" 
                  strokeWidth={2} 
                  fillOpacity={1} 
                  fill="url(#colorExpenses)" 
                  animationDuration={1500}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Portfolio Distribution Bento */}
        <div className="lg:col-span-4 flex">
          <Card className="glass border-white/50 shadow-md rounded-2xl p-6 w-full flex flex-col items-center justify-center relative overflow-hidden group">
             <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
             <div className="relative z-10 w-full">
                <CardHeader className="p-0 mb-4">
                   <CardTitle className="text-lg font-black tracking-tighter text-center italic">Loan Types</CardTitle>
                </CardHeader>
                <div className="relative h-[180px]">
                   <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={loanTypesDistribution} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={4} dataKey="value" stroke="none">
                          {loanTypesDistribution.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} className="card-hover drop-shadow-md" />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v: any, name: any) => [`${v}% of portfolio`, name]} />
                      </PieChart>
                   </ResponsiveContainer>
                   <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <Layers className="w-5 h-5 text-primary/30 mb-1" />
                      <span className="text-[9px] font-black uppercase tracking-wider text-slate-400">Active Ratio</span>
                      <span className="text-2xl font-black text-slate-900 tracking-tighter italic">${activeLoanPercentage}%</span>
                   </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2.5">
                  {loanTypesDistribution.map((item) => (
                    <div key={item.name} className="flex flex-col items-center p-2.5 rounded-xl bg-white/40 border border-white/50 transition-all hover:bg-white hover:shadow-sm">
                      <div className="w-1.5 h-1.5 rounded-full mb-1.5" style={{ backgroundColor: item.color }} />
                      <span className="text-[9px] font-black uppercase tracking-wider text-slate-600 mb-0.5 truncate max-w-[120px] text-center" title={item.name}>{item.name}</span>
                      <span className="text-sm font-black text-slate-900 tracking-tighter">{item.value}%</span>
                    </div>
                  ))}
                </div>
             </div>
          </Card>
        </div>
      </div>

      {/* Ledger Records - Large Bento Card */}
      <Card className="glass border-white/50 shadow-md rounded-2xl overflow-hidden mb-8">
        <CardHeader className="bg-white/40 border-b border-slate-100 p-6">
           <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <CardTitle className="text-xl font-black tracking-tighter uppercase italic">Recent Transactions</CardTitle>
                <p className="text-slate-500 font-bold text-xs flex items-center gap-1.5">
                   <Activity className="w-3.5 h-3.5 text-emerald-500" /> Latest activity logs
                </p>
              </div>
              <Button variant="outline" className="h-9 border-slate-200 glass font-black text-[10px] uppercase tracking-wider px-6 rounded-xl hover:bg-[#ffd100] hover:text-[#202020] hover:border-[#ffd100] transition-all shadow-xs cursor-pointer">View All History</Button>
           </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50/30">
                  <th className="px-6 py-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Customer Name</th>
                  <th className="px-6 py-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Type</th>
                  <th className="px-6 py-4 text-right text-[10px] font-black text-slate-400 uppercase tracking-widest">Amount</th>
                  <th className="px-6 py-4 text-right text-[10px] font-black text-slate-400 uppercase tracking-widest">Date & Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loadingTransactions ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-12 text-center font-black text-slate-300 italic animate-pulse">
                        Synchronizing with central vault...
                      </td>
                    </tr>
                ) : recentTransactions.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-12 text-center font-semibold text-slate-400 text-xs italic">
                        No recent transactions found.
                      </td>
                    </tr>
                ) : (
                  recentTransactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-primary/3 transition-all duration-300 group cursor-default">
                      <td className="px-6 py-3.5 whitespace-nowrap">
                        <div className="text-sm font-black text-slate-900 group-hover:text-primary transition-colors flex items-center gap-2">
                           <div className="w-1.5 h-1.5 rounded-full bg-primary/20 group-hover:bg-primary transition-colors" />
                           {clientMap[tx.client_id] || tx.client_id}
                        </div>
                      </td>
                      <td className="px-6 py-3.5 whitespace-nowrap">
                        <Badge className="bg-white text-slate-600 border border-slate-200 font-black text-[9px] uppercase tracking-widest shadow-xs px-3 py-1 rounded-lg">
                          {tx.type}
                        </Badge>
                      </td>
                      <td className="px-6 py-3.5 whitespace-nowrap text-right">
                        <div className="text-sm font-black text-emerald-600 tracking-tighter italic">Rs. {tx.amount?.toLocaleString()}</div>
                      </td>
                      <td className="px-6 py-3.5 whitespace-nowrap text-right">
                         <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">{new Date(tx.timestamp).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
