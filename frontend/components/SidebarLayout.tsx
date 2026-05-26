'use client';

import { useAuth } from '@/hooks/useAuth';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
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
  const { user, loading, signOut, getCompanyName } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [alertCount, setAlertCount] = useState(0);
  const [repoCount, setRepoCount] = useState(0);
  const [eclPortfolioCount, setEclPortfolioCount] = useState(0);
  const [backendLive, setBackendLive] = useState<boolean | null>(null);

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
        <p className="text-[#64748b]">Redirecting to login…</p>
      </div>
    );
  }

  const mainNav = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  ];

  const ifrsNav = [
    { name: 'IFRS 16 Overview', href: '/dashboard/ifrs16', icon: LayoutDashboard },
    { name: 'AI Search', href: '/dashboard/assistant?mode=lease', icon: MessageSquare },
    {
      name: '⚡ Quick Analysis',
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
    { name: 'IFRS 15 Revenue Recognition', href: '/dashboard/ifrs15', icon: DollarSign },
    { name: 'Real Estate UAE (IFRS 15)', href: '/dashboard/ifrs15/realestate', icon: Building2 },
    { name: '  └ Portfolio Analytics', href: '/dashboard/ifrs15/realestate/portfolio', icon: Building2 },
    { name: 'Rev Rec Reconciliation', href: '/dashboard/r2r/rev-rec', icon: FileCheck },
    { name: 'IFRS 9 Overview', href: '/dashboard/ifrs9', icon: TrendingUp },
    { name: 'ECL Portfolios', href: '/dashboard/ifrs9/portfolios', icon: FolderOpen, badge: eclPortfolioCount, badgeStyle: 'count' },
    { name: 'New Portfolio', href: '/dashboard/ifrs9/portfolios/new', icon: Plus },
    { name: 'Provision Matrix', href: '/dashboard/ifrs9/portfolios', icon: BarChart2 },
    { name: 'Scenario Analysis', href: '/dashboard/ifrs9/portfolios', icon: PieChart },
    { name: 'Disclosure Notes', href: '/dashboard/ifrs9/portfolios', icon: FileEdit },
  ];

  const moreNav = [
    { name: 'Settings', href: '/dashboard/admin/macro-sensitivity', icon: Settings },
    { name: 'Reports', href: '/dashboard/reports', icon: FileCheck },
    { name: 'AI Assistant', href: '/dashboard/assistant', icon: MessageSquare },
    { name: 'Health Check', href: '/dashboard/health', icon: Activity },
  ];

  const isActive = (href: string) => pathname === href;

  return (
    <div className="min-h-screen bg-bg-light flex">
      {/* Left Sidebar - Fixed 220px */}
      <aside className="w-[220px] bg-white border-r border-border-default fixed left-0 top-0 bottom-0 flex flex-col z-50">
        {/* Logo */}
        <div className="p-6 border-b border-border-default">
          <Link href="/dashboard" className="flex items-center">
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
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2 px-3">IFRS</p>
            {ifrsNav.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              const highlight = (item as { highlight?: boolean }).highlight;
              const badge = (item as { badge?: number; badgeStyle?: string }).badge;
              const badgeStyle = (item as { badgeStyle?: string }).badgeStyle;
              const showBadge = badge != null && (badgeStyle === 'alert' ? badge > 0 : true);
              const badgeClass = badgeStyle === 'alert'
                ? 'px-2 py-0.5 bg-red-500 text-white text-xs rounded-full'
                : 'px-2 py-0.5 bg-[#e2e8f0] text-[#64748b] text-xs rounded-full';
              return (
                <Link
                  key={`${item.href}-${item.name}`}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors mb-1',
                    highlight &&
                      'rounded-full bg-gradient-to-r from-amber-100/95 to-orange-50 border border-amber-200/90 text-amber-950 shadow-[0_1px_5px_rgba(251,191,36,0.35)]',
                    active && highlight && 'ring-2 ring-amber-300/80 ring-offset-1',
                    active && !highlight && 'bg-orange-light text-orange-primary',
                    !active && !highlight && 'text-text-secondary hover:bg-bg-light hover:text-text-primary',
                    !active &&
                      highlight &&
                      'hover:from-amber-100 hover:to-orange-100/90 hover:border-amber-300'
                  )}
                >
                  <Icon className="w-4 h-4" />
                  <span className="flex-1">{item.name}</span>
                  {showBadge && (
                    <span className={badgeClass}>{badge}</span>
                  )}
                </Link>
              );
            })}
          </div>

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

      {/* Main Content Area */}
      <div className="flex-1 ml-[220px] flex flex-col">
        {/* Top Bar - Sticky 56px */}
        <header className="h-14 bg-white border-b border-border-default sticky top-0 z-40 flex items-center justify-between px-7">
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <span>IFRS</span>
            <ChevronRight className="w-4 h-4" />
            <span className="text-text-primary font-medium">{pageTitle}</span>
          </div>
          <div className="flex items-center gap-3">
            {backendLive === null ? (
              <div className="flex items-center gap-2 px-3 py-1 bg-slate-50 border border-slate-200 rounded-full">
                <Circle className="w-2 h-2 fill-slate-400 text-slate-400 animate-pulse" />
                <span className="text-xs font-medium text-slate-600">Checking API…</span>
              </div>
            ) : backendLive === false ? (
              <div
                className="flex items-center gap-2 max-w-[min(420px,50vw)]"
                title={getBackendConnectivityMessage()}
              >
                <div className="flex items-center gap-2 px-3 py-1 bg-amber-50 border border-amber-200 rounded-full cursor-help">
                  <Circle className="w-2 h-2 shrink-0 fill-amber-500 text-amber-500" />
                  <span className="text-xs font-medium text-amber-900 leading-snug">
                    {isCustomerFacingBuild() ? (
                      getBackendConnectivityShortLabel()
                    ) : (
                      <>
                        API offline — run{' '}
                        <code className="text-[10px] bg-amber-100 px-1 rounded">python app.py</code>
                        {' '}or{' '}
                        <code className="text-[10px] bg-amber-100 px-1 rounded">START_LOCALHOST.bat</code>
                        <span className="hidden sm:inline"> · hover for details</span>
                      </>
                    )}
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 px-3 py-1 bg-green-50 border border-green-200 rounded-full">
                <Circle className="w-2 h-2 fill-green-500 text-green-500" />
                <span className="text-xs font-medium text-green-700">API connected</span>
              </div>
            )}
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
