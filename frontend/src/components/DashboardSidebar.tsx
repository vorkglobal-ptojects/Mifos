'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { 
  BarChart3, 
  Users, 
  Wallet, 
  ArrowRightLeft, 
  FileText, 
  Settings, 
  LayoutDashboard,
  LogOut,
  ChevronLeft,
  ChevronRight,
  X,
  TrendingUp,
  History,
  ShieldCheck,
  UserCircle,
  PiggyBank,
  CheckSquare,
  FileSpreadsheet,
  Layers,
  Camera,
  Video,
  PlaySquare,
  Eye,
  Package,
  Landmark,
  Percent
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';

const navGroups = [
  {
    label: "Overview",
    items: [
      { name: 'Dashboard', href: '/', icon: LayoutDashboard },
      { name: 'Growth', href: '/dashboard/executive', icon: TrendingUp },
    ]
  },
  {
    label: "Cash & Banking",
    items: [
      { name: 'Cash Dashboard', href: '/finance/cash', icon: Landmark },
      { name: 'Cash Requests', href: '/finance/cash/requests', icon: FileSpreadsheet },
      { name: 'Transfers & Transit', href: '/finance/cash/transfers', icon: ArrowRightLeft },
      { name: 'Cash Tills', href: '/finance/cash/tills', icon: Wallet },
      { name: 'Bank Accounts', href: '/finance/cash/banks', icon: PiggyBank },
    ]
  },
  {
    label: "Finance",
    items: [
      { name: 'Customers', href: '/clients', icon: Users },
      { name: 'Pawnes', href: '/loans', icon: Wallet },
      { name: 'Records', href: '/accounting/ledger?tab=journal', icon: FileText },
      { name: 'Ledger Entry', href: '/accounting/ledger?tab=entry', icon: FileSpreadsheet },
      { name: 'Ledger Matrix', href: '/accounting/ledger?tab=matrix', icon: Layers },
      { name: 'Financial Statements', href: '/accounting/reports', icon: BarChart3 },
    ]
  },
  {
    label: "Stock Management",
    items: [
      { name: 'Pawn Stock', href: '/operations/eod?tab=stock', icon: Package },
    ]
  },
  {
    label: "Transactions",
    items: [
      { name: 'Transaction History', href: '/transactions', icon: ArrowRightLeft },
    ]
  },
  {
    label: "CCTV Surveillance",
    items: [
      { name: 'Camera Registry', href: '/cctv/cameras', icon: Camera },
      { name: 'Transaction Evidence', href: '/cctv/recordings', icon: PlaySquare },
      { name: 'Live View & PTZ', href: '/cctv/live', icon: Eye },
      { name: 'CCTV Audit Logs', href: '/cctv/audit-logs', icon: FileText },
      { name: 'CCTV Settings', href: '/cctv/settings', icon: Settings, adminOnly: true },
    ]
  },
  {
    label: "Operations",
    items: [
      { name: 'Audit Dashboard', href: '/dashboard/auditor', icon: ShieldCheck },
      { name: 'Approvals', href: '/operations/approvals', icon: CheckSquare },
      { name: 'End-of-Day', href: '/operations/eod', icon: ShieldCheck },
      { name: 'Audit Logs', href: '/operations/audit-logs', icon: ShieldCheck },
      { name: 'Reports', href: '/reports', icon: BarChart3 },
      { name: 'Staff', href: '/employees', icon: Users, adminOnly: true },
    ]
  }
];

const tellerNavItems = [
  { name: 'Customer', href: '/clients', icon: Users },
  { name: 'Pawning', href: '/loans', icon: Wallet },
  { name: 'Interest', href: '/finance/interest', icon: Percent },
  { name: 'Daily ledger', href: '/accounting/ledger?tab=entry', icon: FileSpreadsheet },
  { name: 'Profile', href: '/profile', icon: UserCircle },
];

const auditorNavItems = [
  { name: 'Audit Dashboard', href: '/dashboard/auditor', icon: ShieldCheck },
  { name: 'Cash & Vault', href: '/finance/cash', icon: Landmark },
  { name: 'Cash Transfers', href: '/finance/cash/transfers', icon: ArrowRightLeft },
  { name: 'Vault Stock', href: '/operations/eod?tab=stock', icon: Layers },
  { name: 'System Logs', href: '/operations/audit-logs', icon: FileText },
  { name: 'CCTV Logs', href: '/cctv/audit-logs', icon: Video },
  { name: 'Financial Reports', href: '/accounting/reports', icon: FileSpreadsheet },
  { name: 'Profile', href: '/profile', icon: UserCircle },
];

const managerNavItems = [
  { name: 'Approvals', href: '/operations/approvals', icon: CheckSquare },
  { name: 'Cash Dashboard', href: '/finance/cash', icon: Landmark },
  { name: 'Cash Requests', href: '/finance/cash/requests', icon: FileSpreadsheet },
  { name: 'Cash Transfers', href: '/finance/cash/transfers', icon: ArrowRightLeft },
  { name: 'Bank Accounts', href: '/finance/cash/banks', icon: PiggyBank },
  { name: 'Overview', href: '/', icon: LayoutDashboard },
  { name: 'Pawn Review', href: '/loans', icon: Wallet },
  { name: 'Transactions', href: '/transactions', icon: ArrowRightLeft },
  { name: 'End-of-Day', href: '/operations/eod', icon: ShieldCheck },
  { name: 'Profile', href: '/profile', icon: UserCircle },
];

export default function DashboardSidebar({ 
  isCollapsed, 
  setIsCollapsed,
  isMobileOpen,
  setIsMobileOpen
}: { 
  isCollapsed: boolean, 
  setIsCollapsed: (v: boolean) => void,
  isMobileOpen?: boolean,
  setIsMobileOpen?: (v: boolean) => void
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<Record<string, any> | null>(null);
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  const groupIcons: { [key: string]: React.ElementType } = {
    "Overview": LayoutDashboard,
    "Cash & Banking": Landmark,
    "Finance": Wallet,
    "Stock Management": Package,
    "Transactions": ArrowRightLeft,
    "CCTV Surveillance": Camera,
    "Operations": ShieldCheck
  };

  useEffect(() => {
    const active = navGroups.find(group => 
      group.items.some(item => pathname === item.href)
    );
    if (active) {
      const timer = setTimeout(() => {
        setOpenGroup(prev => (prev !== active.label ? active.label : prev));
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [pathname]);

  const handleGroupClick = (label: string) => {
    setOpenGroup(openGroup === label ? null : label);
  };

  const getEffectiveRole = (u: any): 'ADMIN' | 'MANAGER' | 'AUDITOR' | 'TELLER' => {
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
  };

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
    };
    
    syncUser();
    
    // Listen for storage changes from other components (like ProfilePage)
    window.addEventListener('storage', syncUser);
    return () => window.removeEventListener('storage', syncUser);
  }, []);

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

  return (
    <aside 
      className={cn(
        "fixed left-0 top-0 h-screen bg-slate-950 text-slate-300 transition-all duration-500 ease-in-out z-50 flex flex-col shadow-2xl overflow-hidden border-r border-white/5 font-sans",
        isCollapsed ? "md:w-24" : "md:w-24 lg:w-72",
        isMobileOpen ? "translate-x-0 w-72" : "-translate-x-full md:translate-x-0"
      )}
    >
      {/* Branding Section */}
      <div className={cn(
        "h-20 flex items-center mb-1 relative shrink-0 transition-all duration-500",
        isCollapsed ? "justify-center" : "px-6"
      )}>
        <div className={cn(
          "flex items-center w-full",
          isCollapsed ? "justify-center" : "justify-between"
        )}>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-[#ffd100] rounded-xl flex items-center justify-center shadow-lg shadow-[#ffd100]/20 ring-2 ring-[#ffd100]/40 group-hover:scale-105 transition-transform duration-300 relative overflow-hidden shrink-0">
              <div className="absolute inset-0 bg-gradient-to-br from-white/30 to-transparent" />
              <span className="text-[#202020] font-black text-sm tracking-tighter relative z-10">RP</span>
            </div>
            {!isCollapsed && (
              <div className="flex flex-col animate-in fade-in slide-in-from-left-4 duration-500">
                <span className="text-white font-black tracking-tighter text-lg leading-none">RUPASINGHE</span>
                <span className="text-[#ffd100] text-[8.5px] font-black uppercase tracking-[0.2em] opacity-95 mt-1">MIFOS Management</span>
              </div>
            )}
          </div>
          
          {/* Top Toggle Button (Desktop only) */}
          {!isCollapsed && (
            <button 
              onClick={() => setIsCollapsed(true)}
              className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/5 transition-all group animate-in fade-in zoom-in duration-500 hidden md:flex"
            >
              <ChevronLeft className="w-5 h-5 group-hover:-translate-x-0.5 transition-transform" />
            </button>
          )}

          {/* Close button (Mobile only) */}
          <button 
            onClick={() => setIsMobileOpen?.(false)}
            className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/5 transition-all group md:hidden"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Navigation Groups */}
      <div className="flex-1 px-4 space-y-2 overflow-y-auto pt-4 scrollbar-hide pb-6">
        {effectiveRole === 'ADMIN' ? (
          navGroups.map((group) => {
          const GroupIcon = groupIcons[group.label] || LayoutDashboard;
          const isGroupActive = group.items.some(item => pathname === item.href);
          const isOpen = openGroup === group.label;

          return (
            <div 
              key={group.label} 
              className="space-y-1"
            >
              {/* Group Header Button */}
              <button
                type="button"
                onClick={() => handleGroupClick(group.label)}
                className={cn(
                  "w-full flex items-center h-9.5 rounded-xl transition-all duration-300 relative overflow-hidden cursor-pointer",
                  isCollapsed ? "justify-center" : "px-4 justify-between",
                  isGroupActive 
                    ? "bg-[#333533] text-white font-bold border border-[#ffd100]/20" 
                    : "hover:bg-white/5 text-slate-400 hover:text-white"
                )}
              >
                <div className="flex items-center">
                  <GroupIcon className={cn(
                    "w-4 h-4 shrink-0 transition-transform duration-300",
                    isGroupActive ? "text-[#ffd100]" : "text-slate-500",
                    !isCollapsed && "mr-3.5"
                  )} />
                  {!isCollapsed && (
                    <span className="font-bold text-[12.5px] tracking-tight">{group.label}</span>
                  )}
                </div>
                {!isCollapsed && (
                  <ChevronRight className={cn(
                    "w-3.5 h-3.5 text-slate-500 transition-transform duration-300",
                    isOpen && "rotate-90 text-[#ffd100]"
                  )} />
                )}
              </button>

              {/* Sub-items sliding container */}
              <div className={cn(
                "grid transition-all duration-300 ease-in-out overflow-hidden",
                isOpen ? "grid-rows-[1fr] opacity-100 mt-1" : "grid-rows-[0fr] opacity-0"
              )}>
                <div className="overflow-hidden space-y-1 pl-3 border-l border-white/10 ml-5">
                  {group.items.map((item) => {
                    if (item.adminOnly && effectiveRole !== 'ADMIN') return null;
                    const isActive = pathname === item.href;
                    const SubIcon = item.icon;
                    
                    return (
                      <Link 
                        key={item.name} 
                        href={item.href}
                        onClick={() => {
                          if (window.innerWidth < 768 && setIsMobileOpen) {
                            setIsMobileOpen(false);
                          }
                        }}
                        className={cn(
                          "group flex items-center h-8.5 rounded-lg transition-all duration-300 relative overflow-hidden",
                          isCollapsed ? "justify-center" : "px-3",
                          isActive 
                            ? "bg-[#ffd100] text-[#202020] font-black shadow-md" 
                            : "text-slate-300 hover:bg-[#333533] hover:text-[#ffee32]"
                        )}
                      >
                        <SubIcon className={cn(
                          "w-3.5 h-3.5 shrink-0 transition-all duration-300 group-hover:scale-105",
                          isActive ? "text-[#202020]" : "text-slate-400 group-hover:text-[#ffd100]",
                          !isCollapsed && "mr-3"
                        )} />
                        {!isCollapsed && (
                          <span className={cn("text-[12px] tracking-tight", isActive ? "font-black text-[#202020]" : "font-semibold")}>
                            {item.name}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })
        ) : effectiveRole === 'AUDITOR' ? (
          <div className="space-y-1.5 pt-1">
            <div className={cn(
              "px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-amber-400/90",
              isCollapsed && "text-center text-[8.5px] px-0"
            )}>
              {!isCollapsed ? "Auditor Portal" : "Audit"}
            </div>
            {auditorNavItems.map((item) => {
              const isActive = pathname === item.href || (item.href.includes('?') && pathname === item.href.split('?')[0]);
              const ItemIcon = item.icon;
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  onClick={() => {
                    if (window.innerWidth < 768 && setIsMobileOpen) {
                      setIsMobileOpen(false);
                    }
                  }}
                  className={cn(
                    "group flex items-center h-10 rounded-xl transition-all duration-300 relative overflow-hidden",
                    isCollapsed ? "justify-center" : "px-3.5",
                    isActive
                      ? "bg-amber-500 text-slate-950 font-black shadow-md"
                      : "text-slate-300 hover:bg-[#333533] hover:text-amber-300"
                  )}
                >
                  <ItemIcon className={cn(
                    "w-4 h-4 shrink-0 transition-all duration-300 group-hover:scale-105",
                    isActive ? "text-slate-950" : "text-amber-400 group-hover:text-amber-300",
                    !isCollapsed && "mr-3"
                  )} />
                  {!isCollapsed && (
                    <span className={cn("text-[12.5px] tracking-tight", isActive ? "font-black text-slate-950" : "font-semibold")}>
                      {item.name}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ) : effectiveRole === 'MANAGER' ? (
          <div className="space-y-1.5 pt-1">
            <div className={cn(
              "px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-purple-400/90",
              isCollapsed && "text-center text-[8.5px] px-0"
            )}>
              {!isCollapsed ? "Manager Portal" : "Manager"}
            </div>
            {managerNavItems.map((item) => {
              const isActive = pathname === item.href || (item.href.includes('?') && pathname === item.href.split('?')[0]);
              const ItemIcon = item.icon;
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  onClick={() => {
                    if (window.innerWidth < 768 && setIsMobileOpen) {
                      setIsMobileOpen(false);
                    }
                  }}
                  className={cn(
                    "group flex items-center h-10 rounded-xl transition-all duration-300 relative overflow-hidden",
                    isCollapsed ? "justify-center" : "px-3.5",
                    isActive
                      ? "bg-purple-600 text-white font-black shadow-md"
                      : "text-slate-300 hover:bg-[#333533] hover:text-purple-300"
                  )}
                >
                  <ItemIcon className={cn(
                    "w-4 h-4 shrink-0 transition-all duration-300 group-hover:scale-105",
                    isActive ? "text-white" : "text-purple-400 group-hover:text-purple-300",
                    !isCollapsed && "mr-3"
                  )} />
                  {!isCollapsed && (
                    <span className={cn("text-[12.5px] tracking-tight", isActive ? "font-black text-white" : "font-semibold")}>
                      {item.name}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="space-y-1.5 pt-1">
            <div className={cn(
              "px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-[#ffd100]/80",
              isCollapsed && "text-center text-[8.5px] px-0"
            )}>
              {!isCollapsed ? "Teller Counter" : "Counter"}
            </div>
            {tellerNavItems.map((item) => {
              const isActive = pathname === item.href || (item.href.includes('?') && pathname === item.href.split('?')[0]);
              const ItemIcon = item.icon;
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  onClick={() => {
                    if (window.innerWidth < 768 && setIsMobileOpen) {
                      setIsMobileOpen(false);
                    }
                  }}
                  className={cn(
                    "group flex items-center h-10 rounded-xl transition-all duration-300 relative overflow-hidden",
                    isCollapsed ? "justify-center" : "px-3.5",
                    isActive
                      ? "bg-[#ffd100] text-[#202020] font-black shadow-md"
                      : "text-slate-300 hover:bg-[#333533] hover:text-[#ffee32]"
                  )}
                >
                  <ItemIcon className={cn(
                    "w-4 h-4 shrink-0 transition-all duration-300 group-hover:scale-105",
                    isActive ? "text-[#202020]" : "text-slate-400 group-hover:text-[#ffd100]",
                    !isCollapsed && "mr-3"
                  )} />
                  {!isCollapsed && (
                    <span className={cn("text-[12.5px] tracking-tight", isActive ? "font-black text-[#202020]" : "font-semibold")}>
                      {item.name}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Profile & Footer */}
      <div className="p-3 border-t border-white/5 space-y-2 bg-black/20 shrink-0">
        {!isCollapsed && user && (
          <Link 
            href="/profile"
            className="flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-white/5 border border-white/5 group transition-all hover:bg-white/10 hover:border-white/20 active:scale-[0.98] cursor-pointer"
          >
            <div className="w-8 h-8 rounded-xl bg-slate-800 flex items-center justify-center border border-white/10 relative overflow-hidden shrink-0">
              {user.avatar_url || user.avatarUrl ? (
                <img 
                  src={user.avatar_url || user.avatarUrl} 
                  alt="Profile" 
                  className="w-full h-full object-cover"
                />
              ) : (
                <UserCircle className="w-5 h-5 text-slate-400 group-hover:text-primary transition-colors" />
              )}
              <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-emerald-500 rounded-full border border-slate-950 shadow-sm" />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-white font-black text-xs truncate tracking-tight group-hover:text-primary transition-colors">
                {user.firstName || user.first_name || 'User'}
              </span>
              <span className="text-slate-500 text-[8px] font-black uppercase tracking-widest truncate">
                {effectiveRole}
              </span>
            </div>
          </Link>
        )}

        <div className="flex flex-col gap-1">
          {/* Bottom Toggle Button (Only when closed) */}
          {isCollapsed && (
            <button 
              onClick={() => setIsCollapsed(false)}
              className="flex items-center justify-center w-full h-9 rounded-xl hover:bg-white/5 text-slate-500 hover:text-white transition-all group"
            >
              <ChevronRight className="w-4 h-4 transition-transform group-hover:scale-110" />
            </button>
          )}
          
          <button 
            onClick={handleLogout}
            className={cn(
              "flex items-center w-full h-9 rounded-xl transition-all group",
              isCollapsed ? "justify-center" : "px-4",
              "hover:bg-rose-500/10 text-slate-500 hover:text-rose-400"
            )}
          >
            <LogOut className={cn(
              "w-4 h-4 shrink-0 transition-transform group-hover:rotate-12",
              !isCollapsed && "mr-3.5"
            )} />
            {!isCollapsed && <span className="font-bold text-[12.5px]">Logout</span>}
          </button>
        </div>
      </div>
    </aside>
  );
}
