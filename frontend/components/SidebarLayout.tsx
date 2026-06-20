'use client';

import { useAuth } from '@/hooks/useAuth';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState, type ComponentType } from 'react';
import Link from 'next/link';
import { 
  LayoutDashboard, 
  FileText, 
  DollarSign, 
  TrendingUp, 
  FileCheck, 
  MessageSquare,
  ChevronRight,
  User,
  Circle,
  Activity,
  FolderOpen,
  Link2,
  Building2,
  Bell,
  Plus,
  BarChart2,
  PieChart,
  FileEdit,
  Sparkles,
  Settings,
  Upload,
  Zap,
  ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { healthCheck } from '@/lib/api';
import {
  getBackendConnectivityMessage,
  getBackendConnectivityShortLabel,
  isCustomerFacingBuild,
} from '@/lib/service-messages';

interface SidebarLayoutProps {
  children: React.ReactNode;
  pageTitle: string;
  pageSubtitle: string;
}

export function SidebarLayout({ children, pageTitle, pageSubtitle }: SidebarLayoutProps) {
  const { user, loading, signOut, getCompanyName, isAdmin } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [alertCount, setAlertCount] = useState(0);
  const [repoCount, setRepoCount] = useState(0);
  const [eclPortfolioCount, setEclPortfolioCount] = useState(0);
  const [backendLive, setBackendLive] = useState<boolean | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let poll: ReturnType<typeof setInterval> | undefined;

    const run = async () => {
      setBackendLive(null);
      const { error } = await healthCheck();
      if (cancelled) return;
      setBackendLive(!error);
      if (error) {
        poll = setInterval(async () => {
          const r = await healthCheck();
          if (cancelled) return;
          if (!r.error) {
            setBackendLive(true);
            if (poll) clearInterval(poll);
          }
        }, 15000);
      }
    };

    void run();
    return () => {
      cancelled = true;
      if (poll) clearInterval(poll);
    };
  }, [pathname]);

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem('lease_repository');
      if (raw) {
        const leases = JSON.parse(raw);
        if (Array.isArray(leases)) {
          setRepoCount(leases.length);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const in90 = new Date(today);
          in90.setDate(in90.getDate() + 90);
          let count = 0;
          leases.forEach((l: Record<string, unknown>) => {
            const endRaw =
              l.end_date ??
              l.endDate ??
              (l.dates as { end?: string } | undefined)?.end ??
              '';
            if (!endRaw) return;
            const d = new Date(String(endRaw));
            if (Number.isNaN(d.getTime())) return;
            d.setHours(0, 0, 0, 0);
            if (d >= today && d <= in90) count++;
          });
          setAlertCount(count);
        } else {
          setRepoCount(0);
          setAlertCount(0);
        }
      } else {
        setRepoCount(0);
        setAlertCount(0);
      }
    } catch {
      setRepoCount(0);
      setAlertCount(0);
    }
    try {
      const rawEcl = localStorage.getItem('ecl_portfolio_repository');
      if (rawEcl) {
        const ecl = JSON.parse(rawEcl);
        setEclPortfolioCount(Array.isArray(ecl) ? ecl.length : 0);
      }
    } catch { /* ignore */ }
  }, [pathname]);

  if (loading) {
    return (
      <div className="min-h-screen bg-bg-light flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-primary"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-bg-light flex items-center justify-center">
        <p className="text-[#64748b]">Redirecting to login...</p>
      </div>
    );
  }

  const mainNav = [
    { name: 'IFRS 16 Dashboard', href: '/dashboard/ifrs16', icon: LayoutDashboard },
  ];

  const moduleSwitch = [
    { name: 'IFRS 15 — Revenue', href: '/dashboard/ifrs15', module: 'ifrs15' as const, icon: DollarSign },
    { name: 'IFRS 16 — Leases', href: '/dashboard/ifrs16', module: 'ifrs16' as const, icon: FileText },
    { name: 'IFRS 9 — ECL', href: '/dashboard/ifrs9', module: 'ifrs9' as const, icon: TrendingUp },
  ];

  const ifrs16Nav = [
    { name: 'Dashboard', href: '/dashboard/ifrs16', icon: LayoutDashboard },
    { name: 'AI Search', href: '/dashboard/assistant?mode=lease', icon: MessageSquare },
    {
      name: 'Quick Analysis',
      href: '/dashboard/ifrs16/quick-analysis',
      icon: Zap,
      highlight: true,
    },
    { name: 'CFO Insights', href: '/dashboard/ifrs16/cfo-insights', icon: Sparkles },
    { name: 'Bulk Upload', href: '/dashboard/ifrs16/bulk-upload', icon: Upload },
    { name: 'New Lease', href: '/dashboard/ifrs16/leases/new', icon: FileText },
    { name: 'Lease Repository', href: '/dashboard/ifrs16/repository', icon: FolderOpen, badge: repoCount, badgeStyle: 'count' },
    { name: 'ERP Export', href: '/dashboard/ifrs16/erp', icon: Link2 },
    { name: 'Cost Centers', href: '/dashboard/ifrs16/costcenter', icon: Building2 },
    { name: 'Group Consolidation', href: '/dashboard/ifrs16/consolidation', icon: PieChart },
    { name: 'Smart Alerts', href: '/dashboard/ifrs16/alerts', icon: Bell, badge: alertCount, badgeStyle: 'alert' },
    { name: 'Reports', href: '/dashboard/ifrs16/reports', icon: BarChart2 },
    { name: 'Summary Movement Report', href: '/dashboard/ifrs16/reports/summary-movement', icon: FileText },
    { name: 'Payment Detail Report', href: '/dashboard/ifrs16/reports/payment-detail', icon: FileText },
    { name: 'Payment Summary Report', href: '/dashboard/ifrs16/reports/payment-summary', icon: FileText },
    { name: 'Assets Detail Report', href: '/dashboard/ifrs16/reports/assets-detail', icon: FileText },
    { name: 'Lease Expiry Report', href: '/dashboard/ifrs16/reports/lease-expiry', icon: FileText },
    { name: 'Depreciation Schedule Report', href: '/dashboard/ifrs16/reports/depreciation', icon: FileText },
    { name: 'Interest Schedule Report', href: '/dashboard/ifrs16/reports/interest', icon: FileText },
    { name: 'Liability Movement Report', href: '/dashboard/ifrs16/reports/liability-movement', icon: FileText },
    { name: 'ROU Movement Report', href: '/dashboard/ifrs16/reports/rou-movement', icon: FileText },
    { name: 'Restoration Schedule Report', href: '/dashboard/ifrs16/reports/restoration', icon: FileText },
    { name: 'FX Schedule Report', href: '/dashboard/ifrs16/reports/fx', icon: FileText },
    { name: 'Liability Maturity Report', href: '/dashboard/ifrs16/reports/maturity', icon: FileText },
  ];

  const ifrs15Nav = [
    { name: 'Revenue Recognition', href: '/dashboard/ifrs15', icon: DollarSign },
    { name: 'Real Estate UAE', href: '/dashboard/ifrs15/realestate', icon: Building2 },
    { name: 'Portfolio Analytics', href: '/dashboard/ifrs15/realestate/portfolio', icon: PieChart },
    { name: 'Rev Rec Reconciliation', href: '/dashboard/r2r/rev-rec', icon: FileCheck },
  ];

  const ifrs9Nav = [
    { name: 'Overview', href: '/dashboard/ifrs9', icon: LayoutDashboard },
    { name: 'ECL Portfolios', href: '/dashboard/ifrs9/portfolios', icon: FolderOpen, badge: eclPortfolioCount, badgeStyle: 'count' },
    { name: 'New Portfolio', href: '/dashboard/ifrs9/portfolios/new', icon: Plus },
    { name: 'Provision Matrix', href: '/dashboard/ifrs9/portfolios', icon: BarChart2 },
    { name: 'Scenario Analysis', href: '/dashboard/ifrs9/portfolios', icon: PieChart },
    { name: 'Disclosure Notes', href: '/dashboard/ifrs9/portfolios', icon: FileEdit },
  ];

  type IfrsModule = 'ifrs15' | 'ifrs16' | 'ifrs9';

  const activeModule: IfrsModule | null = pathname.startsWith('/dashboard/ifrs15')
    ? 'ifrs15'
    : pathname.startsWith('/dashboard/ifrs16')
      ? 'ifrs16'
      : pathname.startsWith('/dashboard/ifrs9')
        ? 'ifrs9'
        : null;

  /** IFRS 15/9 pages use ModuleWorkspaceLayout for detailed in-page nav — avoid duplicating links here. */
  const usesInnerModuleNav = activeModule === 'ifrs15' || activeModule === 'ifrs9';

  const moduleDetailNav =
    activeModule === 'ifrs16'
      ? ifrs16Nav
      : activeModule === 'ifrs15' && !usesInnerModuleNav
        ? ifrs15Nav
        : activeModule === 'ifrs9' && !usesInnerModuleNav
          ? ifrs9Nav
          : [];

  const isActive = (href: string) => {
    const base = href.split('?')[0];
    if (base === '/dashboard') return pathname === '/dashboard';
    return pathname === base || pathname.startsWith(`${base}/`);
  };

  const isModuleActive = (module: IfrsModule) => activeModule === module;

  const renderNavLink = (
    item: {
      name: string;
      href: string;
      icon: ComponentType<{ className?: string }>;
      highlight?: boolean;
      badge?: number;
      badgeStyle?: string;
    },
    key?: string
  ) => {
    const Icon = item.icon;
    const active = isActive(item.href);
    const highlight = item.highlight;
    const badge = item.badge;
    const badgeStyle = item.badgeStyle;
    const showBadge = badge != null && (badgeStyle === 'alert' ? badge > 0 : true);
    const badgeClass =
      badgeStyle === 'alert'
        ? 'px-2 py-0.5 bg-red-500 text-white text-xs rounded-full'
        : 'px-2 py-0.5 bg-[#e2e8f0] text-[#64748b] text-xs rounded-full';
    return (
      <Link
        key={key ?? item.href}
        href={item.href}
        className={cn(
          'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors mb-1',
          highlight &&
            'rounded-full bg-gradient-to-r from-amber-100/95 to-orange-50 border border-amber-200/90 text-amber-950 shadow-[0_1px_5px_rgba(251,191,36,0.35)]',
          active && highlight && 'ring-2 ring-amber-300/80 ring-offset-1',
          active && !highlight && 'bg-orange-light text-orange-primary',
          !active && !highlight && 'text-text-secondary hover:bg-bg-light hover:text-text-primary',
          !active && highlight && 'hover:from-amber-100 hover:to-orange-100/90 hover:border-amber-300'
        )}
      >
        <Icon className="w-4 h-4" />
        <span className="flex-1">{item.name}</span>
        {showBadge && <span className={badgeClass}>{badge}</span>}
      </Link>
    );
  };

  const moreNav = [
    ...(isAdmin ? [{ name: 'Client Workspaces', href: '/dashboard/admin/firms', icon: Building2 }] : []),
    { name: 'Settings', href: '/dashboard/admin/macro-sensitivity', icon: Settings },
    { name: 'Reports', href: '/dashboard/reports', icon: FileCheck },
    { name: 'AI Assistant', href: '/dashboard/assistant', icon: MessageSquare },
    { name: 'Health Check', href: '/dashboard/health', icon: Activity },
  ];

  /** IFRS 15/9 use in-page module sidebar — hide the global left nav to avoid double sidebars. */
  const hideMainSidebar = usesInnerModuleNav;

  const apiStatusBadge = (
    <>
      {backendLive === null ? (
        <div className="flex items-center gap-2 px-3 py-1 bg-slate-50 border border-slate-200 rounded-full">
          <Circle className="w-2 h-2 fill-slate-400 text-slate-400 animate-pulse" />
          <span className="text-xs font-medium text-slate-600">Checking API…</span>
        </div>
      ) : backendLive === false ? (
        <div className="flex items-center gap-2 max-w-[min(320px,40vw)]" title={getBackendConnectivityMessage()}>
          <div className="flex items-center gap-2 px-3 py-1 bg-amber-50 border border-amber-200 rounded-full cursor-help">
            <Circle className="w-2 h-2 shrink-0 fill-amber-500 text-amber-500" />
            <span className="text-xs font-medium text-amber-900 leading-snug truncate">
              {isCustomerFacingBuild() ? getBackendConnectivityShortLabel() : 'API offline'}
            </span>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-3 py-1 bg-green-50 border border-green-200 rounded-full">
          <Circle className="w-2 h-2 fill-green-500 text-green-500" />
          <span className="text-xs font-medium text-green-700">API connected</span>
        </div>
      )}
    </>
  );

  return (
    <div className="min-h-screen bg-bg-light flex">
      {/* Global left sidebar — hidden on IFRS 15/9 module pages (single in-page nav only) */}
      {!hideMainSidebar ? (
      <aside className="w-[220px] bg-white border-r border-border-default fixed left-0 top-0 bottom-0 flex flex-col z-50">
        {/* Logo */}
        <div className="p-6 border-b border-border-default">
          <Link href="/dashboard/ifrs16" className="flex items-center">
            <span className="text-xl font-bold text-text-primary">
              IFRS<span className="text-gradient-orange">.ai</span>
            </span>
          </Link>
          <p className="text-xs text-text-muted mt-1">Enterprise Finance Automation</p>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4">
          {/* Main Section */}
          <div className="px-4 mb-6">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2 px-3">Main</p>
            {mainNav.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors mb-1',
                    active
                      ? 'bg-orange-light text-orange-primary'
                      : 'text-text-secondary hover:bg-bg-light hover:text-text-primary'
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {item.name}
                </Link>
              );
            })}
          </div>

          {/* IFRS Section */}
          <div className="px-4 mb-6">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2 px-3">IFRS Modules</p>
            {moduleSwitch.map((item) => {
              const Icon = item.icon;
              const active = isModuleActive(item.module);
              return (
                <Link
                  key={item.module}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors mb-1',
                    active
                      ? 'bg-orange-light text-orange-primary border-l-[3px] border-orange-primary'
                      : 'text-text-secondary hover:bg-bg-light hover:text-text-primary border-l-[3px] border-transparent'
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {item.name}
                </Link>
              );
            })}
          </div>

          {moduleDetailNav.length > 0 ? (
            <div className="px-4 mb-6">
              <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2 px-3">
                {activeModule === 'ifrs16' ? 'IFRS 16' : activeModule === 'ifrs15' ? 'IFRS 15' : 'IFRS 9'}
              </p>
              {moduleDetailNav.map((item) => renderNavLink(item, `${item.href}-${item.name}`))}
            </div>
          ) : null}

          {/* More Section */}
          <div className="px-4">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2 px-3">More</p>
            {moreNav.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors mb-1',
                    active
                      ? 'bg-orange-light text-orange-primary'
                      : 'text-text-secondary hover:bg-bg-light hover:text-text-primary'
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {item.name}
                </Link>
              );
            })}
          </div>
        </nav>

        {/* User Section */}
        <div className="p-4 border-t border-border-default">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-8 h-8 rounded-full bg-orange-light flex items-center justify-center">
              <User className="w-4 h-4 text-orange-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text-primary truncate">Manasa P.</p>
              <p className="text-xs text-text-muted">CMA · Admin</p>
            </div>
          </div>
        </div>
      </aside>
      ) : null}

      {/* Main Content Area */}
      <div className={cn('flex-1 flex flex-col', hideMainSidebar ? '' : 'ml-[220px]')}>
        <header className="min-h-14 bg-white border-b border-border-default sticky top-0 z-40 flex items-center justify-between gap-4 px-4 lg:px-7 py-2">
          {hideMainSidebar ? (
            <div className="flex items-center gap-3 min-w-0 flex-1 overflow-x-auto">
              <Link href="/dashboard/ifrs16" className="shrink-0 flex items-center">
                <span className="text-lg font-bold text-text-primary">
                  IFRS<span className="text-gradient-orange">.ai</span>
                </span>
              </Link>
              <div className="hidden sm:flex items-center gap-1 shrink-0 border-l border-border-default pl-3">
                {moduleSwitch.map((item) => (
                  <Link
                    key={item.module}
                    href={item.href}
                    className={cn(
                      'px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors',
                      isModuleActive(item.module)
                        ? 'bg-orange-light text-orange-primary'
                        : 'text-text-secondary hover:bg-bg-light hover:text-text-primary'
                    )}
                  >
                    {item.name.replace(' — ', ' ')}
                  </Link>
                ))}
              </div>
              <div className="relative shrink-0 sm:ml-1">
                <button
                  type="button"
                  onClick={() => setMoreOpen((o) => !o)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium text-text-secondary hover:bg-bg-light"
                >
                  More <ChevronDown className="w-4 h-4" />
                </button>
                {moreOpen ? (
                  <>
                    <button
                      type="button"
                      className="fixed inset-0 z-40"
                      aria-label="Close menu"
                      onClick={() => setMoreOpen(false)}
                    />
                    <div className="absolute left-0 top-full mt-1 z-50 min-w-[200px] bg-white border border-border-default rounded-lg shadow-lg py-1">
                      {moreNav.map((item) => {
                        const Icon = item.icon;
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            onClick={() => setMoreOpen(false)}
                            className="flex items-center gap-2 px-4 py-2 text-sm text-text-secondary hover:bg-bg-light hover:text-text-primary"
                          >
                            <Icon className="w-4 h-4" />
                            {item.name}
                          </Link>
                        );
                      })}
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-text-secondary min-w-0">
              <span>IFRS</span>
              <ChevronRight className="w-4 h-4 shrink-0" />
              <span className="text-text-primary font-medium truncate">{pageTitle}</span>
            </div>
          )}
          <div className="flex items-center gap-3 shrink-0">
            {apiStatusBadge}
            {hideMainSidebar ? (
              <div className="hidden md:flex items-center gap-2 pl-2 border-l border-border-default">
                <div className="w-8 h-8 rounded-full bg-orange-light flex items-center justify-center">
                  <User className="w-4 h-4 text-orange-primary" />
                </div>
              </div>
            ) : null}
          </div>
        </header>
        {/* Page Content */}
        <main className="flex-1 p-6 px-7">
          {/* Page Header */}
          <div className="mb-6">
            <h1 className="text-3xl font-bold text-text-primary mb-2">{pageTitle}</h1>
            <p className="text-text-secondary">{pageSubtitle}</p>
          </div>

          {children}
        </main>
      </div>
    </div>
  );
}
