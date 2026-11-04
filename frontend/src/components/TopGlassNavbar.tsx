'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import {
  LayoutDashboard,
  TrendingUp,
  Users,
  Wallet,
  PiggyBank,
  FileText,
  FileSpreadsheet,
  Layers,
  BarChart3,
  ArrowRightLeft,
  History,
  Camera,
  PlaySquare,
  Eye,
  Settings,
  CheckSquare,
  ShieldCheck,
  LogOut,
  ChevronDown,
  ChevronRight,
  Menu,
  X,
  User,
  Building2,
  Smartphone,
  Package,
  AlertTriangle,
  Percent,
  Receipt,
  Banknote
} from 'lucide-react';

const navGroups = [
  {
    label: "Overview",
    icon: LayoutDashboard,
    items: [
      { name: 'Executive Dashboard', href: '/', icon: LayoutDashboard },
      { name: 'Portfolio Growth', href: '/dashboard/executive', icon: TrendingUp },
    ]
  },
  {
    label: "Finance",
    icon: Wallet,
    items: [
      { name: 'Customers', href: '/clients', icon: Users },
      { name: 'Pawnings', href: '/loans', icon: Wallet },
      { name: 'Cash & Tills', href: '/finance/cash', icon: Banknote },
      { name: 'Interest', href: '/finance/interest', icon: Percent },
      { name: 'Journal Records', href: '/accounting/ledger?tab=journal', icon: FileText },
      { name: 'Ledger Entry', href: '/accounting/ledger?tab=entry', icon: FileSpreadsheet },
      { name: 'Branch Matrix', href: '/accounting/ledger?tab=matrix', icon: Layers },
      { name: 'Financial Statements', href: '/accounting/reports', icon: BarChart3 },
    ]
  },
  {
    label: "Stock Management",
    icon: Package,
    items: [
      { name: 'Pawn Stock', href: '/operations/eod?tab=stock', icon: Package },
      { name: 'FS Items (Forfeiture)', href: '/operations/forfeiture', icon: AlertTriangle, adminOnly: true },
    ]
  },
  {
    label: "Transactions",
    icon: ArrowRightLeft,
    items: [
      { name: 'Transaction History', href: '/transactions', icon: ArrowRightLeft },
    ]
  },
  {
    label: "CCTV",
    icon: Camera,
    items: [
      { name: 'Camera Registry', href: '/cctv/cameras', icon: Camera },
      { name: 'Evidence Playback', href: '/cctv/recordings', icon: PlaySquare },
      { name: 'Live View', href: '/cctv/live', icon: Eye },
      { name: 'CCTV Audit Logs', href: '/cctv/audit-logs', icon: FileText },
      { name: 'Settings', href: '/cctv/settings', icon: Settings, adminOnly: true },
    ]
  },
  {
    label: "Operations",
    icon: ShieldCheck,
    items: [
      { name: 'Audit Dashboard', href: '/dashboard/auditor', icon: ShieldCheck },
      { name: 'Staff Management', href: '/employees', icon: Users, adminOnly: true },
      { name: 'SMS Gateway', href: '/operations/sms-settings', icon: Smartphone, adminOnly: true },
      { name: 'Dual Approvals', href: '/operations/approvals', icon: CheckSquare },
      { name: 'End-of-Day', href: '/operations/eod', icon: ShieldCheck },
      { name: 'Audit Logs', href: '/operations/audit-logs', icon: ShieldCheck },
      { name: 'Reports', href: '/reports', icon: BarChart3 },
    ]
  }
];

const auditorNavItems = [
  { name: 'Audit Dashboard', href: '/dashboard/auditor', icon: ShieldCheck },
  { name: 'Customers', href: '/clients', icon: Users },
  { name: 'Pawnings', href: '/loans', icon: Wallet },
  { name: 'Interest', href: '/finance/interest', icon: Percent },
  { name: 'Vault Stock', href: '/operations/eod?tab=stock', icon: Layers },
  { name: 'Audit Logs', href: '/operations/audit-logs', icon: History },
];

const tellerNavItems = [
  { name: 'Customer', href: '/clients', icon: Users },
  { name: 'Pawning', href: '/loans', icon: Wallet },
  { name: 'Interest', href: '/finance/interest', icon: Percent },
  { name: 'Daily ledger', href: '/accounting/ledger?tab=entry', icon: FileSpreadsheet },
  { name: 'Profile', href: '/profile', icon: User },
];

const managerNavItems = [
  { name: 'Approvals', href: '/operations/approvals', icon: CheckSquare },
  { name: 'Overview', href: '/', icon: LayoutDashboard },
  { name: 'Pawn Review', href: '/loans', icon: Wallet },
  { name: 'Transactions', href: '/transactions', icon: ArrowRightLeft },
  { name: 'End-of-Day', href: '/operations/eod', icon: ShieldCheck },
];

export default function TopGlassNavbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<Record<string, any> | null>(null);
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openMobileGroup, setOpenMobileGroup] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const getCleanDisplayName = (u: any) => {
    if (!u) return 'User';
    const emailMap: Record<string, string> = {
      'madushaniperera9617@gmail.com': 'Madushani',
      'erandiperera25@gmail.com': 'Erandi',
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
      'sanjay.rupasinghe@gmail.com': 'Sanjay',
      'nishanthikuru@gmail.com': 'Nishanthi',
      'admin@gmail.com': 'Admin',
      'admin@rupasinghe.com': 'Admin',
      'dilkiisanka3@gmail.com': 'Dilki'
    };

    const email = (u.email || '').toLowerCase().trim();
    if (email && emailMap[email]) return emailMap[email];
    if (u.role === 'ADMIN' || (email && email.startsWith('admin'))) return 'Admin';

    if (u.first_name && typeof u.first_name === 'string') {
      const cleanFirst = u.first_name.replace(/[0-9]+/g, '').trim();
      if (cleanFirst) return cleanFirst.charAt(0).toUpperCase() + cleanFirst.slice(1).toLowerCase();
    }

    const raw = u.name || u.fullName || u.user_metadata?.full_name || u.user_metadata?.first_name || '';
    if (raw && typeof raw === 'string' && raw.trim()) {
      const cleaned = raw.replace(/[0-9]+/g, '').trim();
      if (cleaned.toLowerCase().includes('madushani')) return 'Madushani';
      const first = cleaned.split(/\s+/)[0];
      if (first) return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
    }

    const emailPrefix = (u.email || u.username || '').split('@')[0] || '';
    const cleaned = emailPrefix.replace(/[0-9]+/g, '').replace(/[._]/g, ' ').trim();
    if (cleaned.toLowerCase().includes('madushani')) return 'Madushani';
    if (cleaned) {
      const first = cleaned.split(/\s+/)[0];
      if (first) return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
    }

    const storedName = typeof window !== 'undefined' ? localStorage.getItem('user_name') : null;
    if (storedName) {
      const cleanedStored = storedName.replace(/[0-9]+/g, '').replace(/[._]/g, ' ').trim();
      if (cleanedStored.toLowerCase().includes('madushani')) return 'Madushani';
      const first = cleanedStored.split(/\s+/)[0];
      if (first) return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
    }

    return 'User';
  };

  const getEffectiveRole = useCallback((u: any): 'ADMIN' | 'MANAGER' | 'AUDITOR' | 'TELLER' => {
    const candidates = [
      u?.role,
      u?.user_metadata?.role,
      u?.app_metadata?.role,
      typeof window !== 'undefined' ? localStorage.getItem('user_role') : null
    ];

    for (const c of candidates) {
      if (!c || typeof c !== 'string') continue;
      const upper = c.toUpperCase().trim();
      if (upper === 'ADMIN') return 'ADMIN';
      if (upper === 'MANAGER') return 'MANAGER';
      if (upper === 'AUDITOR') return 'AUDITOR';
      if (upper === 'TELLER') return 'TELLER';
    }

    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('user');
        if (stored) {
          const parsed = JSON.parse(stored);
          const storedRole = (parsed.role || '').toUpperCase().trim();
          if (storedRole === 'ADMIN') return 'ADMIN';
          if (storedRole === 'MANAGER') return 'MANAGER';
          if (storedRole === 'AUDITOR') return 'AUDITOR';
          if (storedRole === 'TELLER') return 'TELLER';
        }
      } catch {}
    }

    return 'TELLER';
  }, []);

  const effectiveRole = getEffectiveRole(user);

  useEffect(() => {
    const syncUser = () => {
      let initialUser: any = null;
      const stored = localStorage.getItem('user');
      if (stored) {
        try {
          initialUser = JSON.parse(stored);
        } catch { /* ignore */ }
      }
      const initialRole = getEffectiveRole(initialUser);
      if (initialUser) {
        setUser({ ...initialUser, role: initialRole });
      } else {
        setUser({ role: initialRole });
      }

      supabase.auth.getUser().then(({ data: { user: authUser } }) => {
        if (authUser) {
          setUser(prev => {
            const preservedRole = getEffectiveRole(prev || authUser);
            return {
              ...(prev || {}),
              ...authUser,
              role: preservedRole,
              branchId: prev?.branchId || prev?.branch_id || authUser.user_metadata?.branch_id || 'HQ',
              email: authUser.email
            };
          });
        }
      }).catch(() => {});
    };
    syncUser();
    window.addEventListener('storage', syncUser);
    return () => window.removeEventListener('storage', syncUser);
  }, [getEffectiveRole]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setActiveDropdown(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close menus and synchronize active mobile group on route changes safely
  useEffect(() => {
    const timer = setTimeout(() => {
      setActiveDropdown(prev => (prev !== null ? null : prev));
      setMobileMenuOpen(prev => (prev ? false : prev));
      const active = navGroups.find(g => g.items.some(i => pathname === i.href || pathname.startsWith(i.href.split('?')[0])));
      if (active) {
        setOpenMobileGroup(prev => (prev !== active.label ? active.label : prev));
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [pathname]);

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.body.style.overflow = mobileMenuOpen ? 'hidden' : '';
    }
    return () => { 
      if (typeof document !== 'undefined') document.body.style.overflow = ''; 
    };
  }, [mobileMenuOpen]);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {}
    try {
      await supabase.auth.signOut();
    } catch {}

    // 1. Purge all local identity and authentication keys
    [
      'auth_token',
      'refresh_token',
      'user',
      'user_role',
      'user_branch',
      'user_name',
      'last_activity',
      'local_stock_customers',
      'local_stock_customers_timestamp'
    ].forEach(k => {
      try { localStorage.removeItem(k); } catch {}
    });

    // 2. Clear all session and authentication cookies
    [
      'sb-access-token',
      'auth_token',
      'sb-refresh-token',
      'refresh_token'
    ].forEach(c => {
      document.cookie = `${c}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; max-age=0; SameSite=Lax`;
    });

    // 3. Clear session storage circuit breaker
    try {
      sessionStorage.removeItem('__auth_nav_chain');
    } catch {}

    // 4. Force hard redirect to login so all in-memory React states and query caches are destroyed
    window.location.replace('/login');
  };

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href.split('?')[0]);

  return (
    <>
      {/* ─── TOP NAVBAR ─── */}
      <header className="sticky top-0 z-50 w-full">
        <div className="mx-2 mt-2 sm:mx-4 sm:mt-3">
          <nav className="bg-slate-950/95 backdrop-blur-2xl border border-amber-500/20 shadow-2xl shadow-black/40 rounded-2xl px-3 sm:px-5 py-2.5 flex items-center justify-between gap-3">

            {/* Brand - Unique rounded logo with company color code */}
            <Link href="/" className="flex items-center group shrink-0" aria-label="Home">
              <div className="relative flex items-center justify-center w-[50px] h-[50px] sm:w-[52px] sm:h-[52px] rounded-full p-[2.5px] bg-gradient-to-tr from-amber-500 via-yellow-400 to-amber-600 shadow-md shadow-amber-500/25 group-hover:shadow-amber-500/40 group-hover:scale-105 transition-all duration-300">
                <div className="w-full h-full rounded-full bg-white flex items-center justify-center overflow-hidden p-1 shadow-inner">
                  <img
                    src="/rupasinghe_logo.png"
                    alt="Rupasinghe Pawning"
                    className="w-full h-full object-contain"
                  />
                </div>
              </div>
            </Link>

            {/* ── Desktop Nav Groups (≥ lg) ── */}
            {effectiveRole === 'ADMIN' ? (
              <div className="hidden lg:flex items-center gap-1" ref={dropdownRef}>
                {navGroups.map((group) => {
                  const GroupIcon = group.icon;
                  const groupActive = group.items.some(i => isActive(i.href));
                  const isOpen = activeDropdown === group.label;

                  return (
                    <div key={group.label} className="relative">
                      <button
                        type="button"
                        onClick={() => setActiveDropdown(isOpen ? null : group.label)}
                        onMouseEnter={() => setActiveDropdown(group.label)}
                        className={cn(
                          "flex items-center gap-2 px-3 py-2 rounded-xl text-[11px] font-bold transition-all duration-200 cursor-pointer outline-none select-none",
                          groupActive || isOpen
                            ? "bg-amber-500/15 text-amber-300 border border-amber-500/30 shadow-sm"
                            : "text-slate-300 hover:bg-white/10 hover:text-white border border-transparent"
                        )}>
                        <GroupIcon className={cn("w-3.5 h-3.5", groupActive ? "text-amber-400" : "text-slate-400")} />
                        <span>{group.label}</span>
                        <ChevronDown className={cn("w-3 h-3 text-slate-400 transition-transform duration-200", isOpen && "rotate-180")} />
                      </button>

                      {isOpen && (
                        <div
                          onMouseLeave={() => setActiveDropdown(null)}
                          className="absolute top-full left-0 mt-2 w-60 bg-slate-950/98 backdrop-blur-2xl border border-amber-500/25 rounded-2xl p-2 shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-150"
                        >
                          <div className="px-3 py-1.5 text-[9px] font-black uppercase tracking-widest text-amber-500/60 border-b border-white/5 mb-1">
                            {group.label}
                          </div>
                          {group.items.map((item) => {
                            if (item.adminOnly && effectiveRole !== 'ADMIN') return null;
                            const active = isActive(item.href);
                            const ItemIcon = item.icon;
                            return (
                              <Link key={item.name} href={item.href}
                                onClick={() => setActiveDropdown(null)}
                                className={cn(
                                  "flex items-center gap-3 px-3 py-2 rounded-xl text-[11px] font-bold transition-all duration-150 mb-0.5",
                                  active
                                    ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                                    : "text-slate-300 hover:bg-white/8 hover:text-white"
                                )}>
                                <ItemIcon className={cn("w-4 h-4 shrink-0", active ? "text-amber-400" : "text-slate-400")} />
                                <span className="truncate">{item.name}</span>
                              </Link>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : effectiveRole === 'AUDITOR' ? (
              <div className="hidden lg:flex items-center gap-1" ref={dropdownRef}>
                {auditorNavItems.map((item) => {
                  const active = isActive(item.href);
                  const ItemIcon = item.icon;
                  return (
                    <Link key={item.name} href={item.href}
                      className={cn(
                        "flex items-center gap-2 px-3.5 py-2 rounded-xl text-[11px] font-bold transition-all duration-200",
                        active
                          ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm"
                          : "text-slate-300 hover:bg-white/10 hover:text-white border border-transparent"
                      )}>
                      <ItemIcon className={cn("w-3.5 h-3.5", active ? "text-amber-400" : "text-slate-400")} />
                      <span>{item.name}</span>
                    </Link>
                  );
                })}
              </div>
            ) : effectiveRole === 'MANAGER' ? (
              <div className="hidden lg:flex items-center gap-1.5" ref={dropdownRef}>
                {managerNavItems.map((item) => {
                  const active = isActive(item.href);
                  const ItemIcon = item.icon;
                  return (
                    <Link key={item.name} href={item.href}
                      className={cn(
                        "flex items-center gap-2 px-3.5 py-2 rounded-xl text-[11.5px] font-bold transition-all duration-200",
                        active
                          ? "bg-purple-500/25 text-purple-300 border border-purple-500/50 shadow-md shadow-purple-500/10"
                          : "text-slate-300 hover:bg-white/10 hover:text-white border border-transparent"
                      )}>
                      <ItemIcon className={cn("w-3.5 h-3.5", active ? "text-purple-400" : "text-purple-400/70")} />
                      <span>{item.name}</span>
                    </Link>
                  );
                })}
              </div>
            ) : (
              /* TELLER IS THE DEFAULT (and fallback for any non-admin) */
              <div className="hidden lg:flex items-center gap-1.5" ref={dropdownRef}>
                {tellerNavItems.map((item) => {
                  const active = isActive(item.href);
                  const ItemIcon = item.icon;
                  return (
                    <Link key={item.name} href={item.href}
                      className={cn(
                        "flex items-center gap-2 px-3.5 py-2 rounded-xl text-[11.5px] font-bold transition-all duration-200",
                        active
                          ? "bg-amber-500/25 text-amber-300 border border-amber-500/50 shadow-md shadow-amber-500/10"
                          : "text-slate-300 hover:bg-white/10 hover:text-white border border-transparent"
                      )}>
                      <ItemIcon className={cn("w-3.5 h-3.5", active ? "text-amber-400" : "text-amber-400/70")} />
                      <span>{item.name}</span>
                    </Link>
                  );
                })}
              </div>
            )}

            {/* ── Right: Branch + Profile + Logout + Hamburger ── */}
            <div className="flex items-center gap-2 ml-auto">

              {/* Branch Badge */}
              <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-400 font-mono text-[10px] font-black">
                <Building2 className="w-3 h-3" />
                <span>{user?.branchId || user?.branch_id || 'HQ'}</span>
              </div>

              {/* Profile Pill */}
              <Link href="/profile"
                className="hidden sm:flex items-center gap-2 px-2.5 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all">
                <User className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-[11px] font-bold text-slate-200 max-w-32 truncate">
                  {getCleanDisplayName(user)}
                </span>
                <span className="text-[9px] font-black bg-slate-800 text-amber-400 px-1.5 py-0.5 rounded-md uppercase tracking-wider">
                  {effectiveRole}
                </span>
              </Link>

              {/* Logout */}
              <button
                onClick={handleLogout}
                title="Sign Out"
                className="hidden sm:flex p-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 transition-all cursor-pointer">
                <LogOut className="w-4 h-4" />
              </button>

              {/* Hamburger (mobile & tablet) */}
              <button
                onClick={() => setMobileMenuOpen(v => !v)}
                className="lg:hidden p-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white transition-all cursor-pointer border border-white/10"
                aria-label="Toggle navigation menu">
                {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            </div>
          </nav>
        </div>
      </header>

      {/* ─── MOBILE FULL-SCREEN DRAWER ─── */}
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden transition-opacity duration-300",
          mobileMenuOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        onClick={() => setMobileMenuOpen(false)}
      />

      {/* Drawer Panel */}
      <div className={cn(
        "fixed top-0 right-0 z-50 h-full w-[85vw] max-w-sm bg-slate-950 border-l border-amber-500/20 shadow-2xl lg:hidden flex flex-col transition-transform duration-300 ease-out",
        mobileMenuOpen ? "translate-x-0" : "translate-x-full"
      )}>

        {/* Drawer Header - Unique rounded logo with company color code */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/8 bg-black/30 shrink-0">
          <div className="flex items-center">
            <div className="relative flex items-center justify-center w-11 h-11 rounded-full p-[2.5px] bg-gradient-to-tr from-amber-500 via-yellow-400 to-amber-600 shadow-md shadow-amber-500/25">
              <div className="w-full h-full rounded-full bg-white flex items-center justify-center overflow-hidden p-1 shadow-inner">
                <img src="/rupasinghe_logo.png" alt="Rupasinghe Pawning" className="w-full h-full object-contain" />
              </div>
            </div>
          </div>
          <button
            onClick={() => setMobileMenuOpen(false)}
            className="p-2 rounded-xl bg-white/8 hover:bg-white/15 text-slate-400 hover:text-white transition-all cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* User Info Banner */}
        <div className="mx-4 mt-4 mb-2 flex items-center justify-between p-3 bg-white/5 border border-white/8 rounded-2xl shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center shrink-0">
              <User className="w-4 h-4 text-amber-400" />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-white text-xs font-bold truncate">
                {getCleanDisplayName(user)}
              </span>
              <span className="text-[9px] font-black text-amber-400 uppercase tracking-wider">
                {effectiveRole} · {user?.branchId || user?.branch_id || 'HQ'}
              </span>
            </div>
          </div>
          <Link
            href="/profile"
            onClick={() => setMobileMenuOpen(false)}
            className="text-[10px] font-bold text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 px-2.5 py-1.5 rounded-lg transition-all border border-white/8">
            Profile
          </Link>
        </div>

        {/* Nav Content (scrollable) */}
        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-1">
          {effectiveRole === 'ADMIN' ? (
            navGroups.map((group) => {
              const GroupIcon = group.icon;
              const groupActive = group.items.some(i => isActive(i.href));
              const isOpen = openMobileGroup === group.label;

              return (
                <div key={group.label}>
                  {/* Group Header */}
                  <button
                    type="button"
                    onClick={() => setOpenMobileGroup(isOpen ? null : group.label)}
                    className={cn(
                      "w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all cursor-pointer",
                      groupActive
                        ? "bg-amber-500/10 border border-amber-500/20"
                        : "hover:bg-white/5 border border-transparent"
                    )}>
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center",
                        groupActive ? "bg-amber-500/20" : "bg-white/5"
                      )}>
                        <GroupIcon className={cn("w-4 h-4", groupActive ? "text-amber-400" : "text-slate-400")} />
                      </div>
                      <span className={cn(
                        "text-sm font-bold",
                        groupActive ? "text-amber-300" : "text-slate-300"
                      )}>
                        {group.label}
                      </span>
                    </div>
                    <ChevronRight className={cn(
                      "w-4 h-4 text-slate-500 transition-transform duration-200",
                      isOpen && "rotate-90"
                    )} />
                  </button>

                  {/* Sub-items */}
                  <div className={cn(
                    "grid transition-all duration-300 ease-in-out overflow-hidden",
                    isOpen ? "grid-rows-[1fr] opacity-100 mt-1 mb-2" : "grid-rows-[0fr] opacity-0"
                  )}>
                    <div className="overflow-hidden space-y-0.5 pl-4 border-l-2 border-amber-500/20 ml-8">
                      {group.items.map((item) => {
                        if (item.adminOnly && effectiveRole !== 'ADMIN') return null;
                        const active = isActive(item.href);
                        const ItemIcon = item.icon;
                        return (
                          <Link key={item.name} href={item.href}
                            onClick={() => setMobileMenuOpen(false)}
                            className={cn(
                              "flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-semibold transition-all min-h-[48px]",
                              active
                                ? "bg-amber-500/20 text-amber-300"
                                : "text-slate-400 hover:bg-white/5 hover:text-white"
                            )}>
                            <ItemIcon className={cn("w-4 h-4 shrink-0", active ? "text-amber-400" : "text-slate-500")} />
                            <span>{item.name}</span>
                            {active && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-amber-400" />}
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })
          ) : effectiveRole === 'AUDITOR' ? (
            <>
              <div className="text-[9px] font-black text-amber-400/70 uppercase tracking-widest px-1 pt-2 pb-1">
                Auditor Navigation
              </div>
              {auditorNavItems.map((item) => {
                const active = isActive(item.href);
                const ItemIcon = item.icon;
                return (
                  <Link key={item.name} href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={cn(
                      "flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm font-bold transition-all min-h-[52px]",
                      active
                        ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                        : "text-slate-300 hover:bg-white/8 hover:text-white border border-transparent"
                    )}>
                    <ItemIcon className={cn("w-5 h-5 shrink-0", active ? "text-amber-400" : "text-slate-500")} />
                    <span>{item.name}</span>
                    {active && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-amber-400" />}
                  </Link>
                );
              })}
            </>
          ) : effectiveRole === 'MANAGER' ? (
            <>
              <div className="text-[9px] font-black text-purple-400/80 uppercase tracking-widest px-1 pt-2 pb-1">
                Manager Portal
              </div>
              {managerNavItems.map((item) => {
                const active = isActive(item.href);
                const ItemIcon = item.icon;
                return (
                  <Link key={item.name} href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={cn(
                      "flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm font-bold transition-all min-h-[52px]",
                      active
                        ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                        : "text-slate-300 hover:bg-white/8 hover:text-white border border-transparent"
                    )}>
                    <ItemIcon className={cn("w-5 h-5 shrink-0", active ? "text-purple-400" : "text-purple-400/70")} />
                    <span>{item.name}</span>
                    {active && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-purple-400" />}
                  </Link>
                );
              })}
            </>
          ) : (
            <>
              <div className="text-[9px] font-black text-amber-400/70 uppercase tracking-widest px-1 pt-2 pb-1">
                Teller Counter Navigation
              </div>
              {tellerNavItems.map((item) => {
                const active = isActive(item.href);
                const ItemIcon = item.icon;
                return (
                  <Link key={item.name} href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={cn(
                      "flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm font-bold transition-all min-h-[52px]",
                      active
                        ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                        : "text-slate-300 hover:bg-white/8 hover:text-white border border-transparent"
                    )}>
                    <ItemIcon className={cn("w-5 h-5 shrink-0", active ? "text-amber-400" : "text-amber-400/70")} />
                    <span>{item.name}</span>
                    {active && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-amber-400" />}
                  </Link>
                );
              })}
            </>
          )}
        </div>

        {/* Drawer Footer: Logout */}
        <div className="shrink-0 p-4 border-t border-white/8 bg-black/20">
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-3 px-4 py-3.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 transition-all cursor-pointer font-bold text-sm">
            <LogOut className="w-5 h-5" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    </>
  );
}
