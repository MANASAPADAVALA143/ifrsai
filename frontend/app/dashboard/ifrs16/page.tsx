'use client';

import { useState, useEffect, useCallback } from 'react';
import { SidebarLayout } from '@/components/SidebarLayout';
import { Button } from '@/components/Button';
import { Plus, Upload, FileBarChart, Eye, Calculator, Download, Building2, Car, Warehouse, Landmark, Store, Sparkles, Loader2, X } from 'lucide-react';
import { getLeaseRepository } from '@/lib/lease-repository';
import {
  formatLeaseMoney,
  getDefaultIfrs16Currency,
  getIfrs16MarketMode,
  resolveLeaseCurrency,
  setIfrs16MarketMode,
  type Ifrs16MarketMode,
} from '@/lib/ifrs16-currency';
import { ifrs16Api } from '@/lib/api';
import { IFRS16OverviewTools } from '@/components/ifrs16/IFRS16OverviewTools';
import Link from 'next/link';
import toast from 'react-hot-toast';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from '@/components/Charts';

const ORANGE_SHADES = ['#f97316', '#fb923c', '#fed7aa', '#ef4444', '#fbbf24', '#f59e0b'];

function getStatus(endDate: string): { label: string; className: string } {
  const end = new Date(endDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  const diffDays = Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return { label: 'Expired', className: 'bg-red-100 text-red-700' };
  if (diffDays <= 30) return { label: 'Expiring Soon', className: 'bg-amber-100 text-amber-700' };
  return { label: 'Active', className: 'bg-green-100 text-green-700' };
}

function inferAssetType(asset: string): string {
  const a = (asset || '').toLowerCase();
  if (a.includes('office')) return 'Office';
  if (a.includes('vehicle') || a.includes('car') || a.includes('auto')) return 'Vehicle';
  if (a.includes('equipment') || a.includes('machine')) return 'Equipment';
  if (a.includes('land')) return 'Land';
  if (a.includes('retail') || a.includes('store')) return 'Retail';
  if (a.includes('building') || a.includes('site')) return 'Building';
  return 'Other';
}

function getAssetTypeIcon(type: string) {
  switch (type) {
    case 'Office': return Building2;
    case 'Vehicle': return Car;
    case 'Equipment': return Warehouse;
    case 'Land': return Landmark;
    case 'Retail': return Store;
    default: return Building2;
  }
}

type CfoInsight = {
  id?: string;
  category?: string;
  severity?: string;
  title?: string;
  finding?: string;
  recommendation?: string;
  impact?: string;
};

type CfoInsightsResult = {
  insights?: CfoInsight[];
  overall_health?: string;
  health_score?: number;
  one_line_summary?: string;
  metrics?: Record<string, unknown>;
};

function leasesForCfoApi(raw: any[]) {
  return raw.map((l) => {
    const res = (l.results || {}) as Record<string, unknown>;
    return {
      ...l,
      title: l.title || l.asset,
      contract_id: l.id || l.lease_id,
      lease_liability: Number(l.liability ?? res.lease_liability ?? 0),
      rou_asset: Number(l.rou ?? res.rou_asset ?? 0),
      monthly_payment: Number(l.monthly_payment ?? l.payments?.monthly ?? 0),
      end_date: l.end_date || l.dates?.end || '',
      status: String(l.status || 'active'),
    };
  });
}

function healthScoreColor(score: number) {
  if (score >= 80) return { ring: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200' };
  if (score >= 60) return { ring: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200' };
  if (score >= 40) return { ring: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200' };
  return { ring: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200' };
}

function severityStyles(severity: string) {
  const s = severity.toUpperCase();
  if (s === 'HIGH') return { border: 'border-l-red-500', badge: 'bg-red-100 text-red-800' };
  if (s === 'MEDIUM') return { border: 'border-l-amber-500', badge: 'bg-amber-100 text-amber-800' };
  return { border: 'border-l-emerald-500', badge: 'bg-emerald-100 text-emerald-800' };
}

function categoryBadgeClass(category: string) {
  const c = category.toUpperCase();
  if (c === 'LEVERAGE') return 'bg-purple-100 text-purple-800';
  if (c === 'RENEWAL_RISK') return 'bg-red-100 text-red-800';
  if (c === 'COST_OPTIMISATION') return 'bg-blue-100 text-blue-800';
  if (c === 'BUDGET') return 'bg-amber-100 text-amber-800';
  if (c === 'CONCENTRATION_RISK') return 'bg-orange-100 text-orange-800';
  return 'bg-slate-100 text-slate-800';
}

export default function IFRS16DashboardPage() {
  const [leases, setLeases] = useState<any[]>([]);
  const [marketMode, setMarketModeState] = useState<Ifrs16MarketMode>(() =>
    typeof window !== 'undefined' ? getIfrs16MarketMode() : 'AE'
  );
  const portfolioCurrency = marketMode === 'IN' ? 'INR' : 'AED';
  const fmtPortfolio = (amount: number) => formatLeaseMoney(amount, portfolioCurrency);
  const [cfoInsightsOpen, setCfoInsightsOpen] = useState(false);
  const [cfoInsightsLoading, setCfoInsightsLoading] = useState(false);
  const [cfoInsightsResult, setCfoInsightsResult] = useState<CfoInsightsResult | null>(null);
  const [cfoContextOpen, setCfoContextOpen] = useState(false);
  const [cfoContextInputs, setCfoContextInputs] = useState({
    total_assets: 0,
    annual_revenue: 0,
    budget_lease_cost: 0,
  });
  const load = useCallback(() => {
    setLeases(getLeaseRepository());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onMode = () => {
      setMarketModeState(getIfrs16MarketMode());
      load();
    };
    window.addEventListener('ifrs16-market-mode-changed', onMode);
    return () => window.removeEventListener('ifrs16-market-mode-changed', onMode);
  }, [load]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const totalActive = leases.filter((l) => {
    if (l.status === 'Active') return true;
    const end = new Date(l.end_date || l.dates?.end || '9999-12-31');
    return end >= today && l.status !== 'Expired' && l.status !== 'Draft';
  }).length;

  const expiring30 = leases.filter((l) => {
    const end = new Date(l.end_date || l.dates?.end || '9999-12-31');
    const diff = Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return diff >= 0 && diff <= 30;
  });

  const expiring90 = leases.filter((l) => {
    const end = new Date(l.end_date || l.dates?.end || '9999-12-31');
    const diff = Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return diff >= 0 && diff <= 90;
  });

  const expiring365 = leases.filter((l) => {
    const end = new Date(l.end_date || l.dates?.end || '9999-12-31');
    const diff = Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return diff >= 0 && diff <= 365;
  });

  const totalContractedValue = leases.reduce((s, l) => {
    const m = l.monthly_payment ?? l.payments?.monthly ?? 0;
    const t = l.dates?.term_months || 12;
    return s + m * t;
  }, 0);

  const totalLeaseLiability = leases.reduce((s, l) => {
    const direct = Number(l.liability);
    const fromResults = Number((l.results as any)?.lease_liability);
    const safe = Number.isFinite(direct) ? direct : Number.isFinite(fromResults) ? fromResults : 0;
    return s + safe;
  }, 0);
  const pendingCalc = leases.filter((l) => l.results == null || (l.liability == null && (l.results as any)?.lease_liability == null)).length;

  const averageLeaseValue = totalActive > 0 ? totalContractedValue / totalActive : 0;

  const typeCounts: Record<string, number> = {};
  leases.forEach((l) => {
    const t = (l.lease_type || inferAssetType(l.asset || '') || 'Other').trim() || 'Other';
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  });
  const pieData = Object.entries(typeCounts).map(([name, value]) => ({ name, value }));

  const scheduleByMonth: Record<string, number> = {};
  leases.forEach((l) => {
    const schedule = (l.results?.amortization_schedule || []) as any[];
    schedule.forEach((row: any) => {
      const dateStr = row.payment_date ?? row.Date;
      if (!dateStr) return;
      const d = new Date(dateStr);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const closing = row.closing_balance ?? row.Closing_Balance ?? 0;
      scheduleByMonth[key] = (scheduleByMonth[key] || 0) + Number(closing);
    });
  });

  const liabilityByMonth = Array.from({ length: 12 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return {
      month: d.toLocaleString('default', { month: 'short' }) + ' ' + d.getFullYear(),
      liability: scheduleByMonth[key] ?? 0,
    };
  });

  const paymentTimeline = Array.from({ length: 12 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() + i);
    const monthStart = new Date(d.getFullYear(), d.getMonth(), 1);
    let total = 0;
    leases.forEach((l) => {
      const end = new Date(l.dates?.end || '9999-12-31');
      const start = new Date(l.dates?.commencement || '2020-01-01');
      if (monthStart >= start && monthStart <= end) {
        total += l.payments?.monthly || 0;
      }
    });
    return {
      month: monthStart.toLocaleString('default', { month: 'short' }),
      payment: total,
    };
  });

  const handleDownload = (entry: any) => {
    const fid = entry.excel_file_id;
    if (!fid) {
      toast.error('No Excel file for this lease');
      return;
    }
    window.open(ifrs16Api.downloadReport(fid), '_blank');
    toast.success('Download started');
  };

  const runCfoInsights = useCallback(async () => {
    setCfoInsightsLoading(true);
    try {
      const payload = {
        leases: leasesForCfoApi(getLeaseRepository()),
        total_assets: Number(cfoContextInputs.total_assets) || 0,
        annual_revenue: Number(cfoContextInputs.annual_revenue) || 0,
        budget_lease_cost: Number(cfoContextInputs.budget_lease_cost) || 0,
      };
      const res = (await ifrs16Api.cfoInsights(payload)) as { data?: Record<string, unknown>; error?: string };
      if (res.error) throw new Error(res.error);
      const d = res.data || {};
      setCfoInsightsResult({
        insights: (d.insights as CfoInsight[]) || [],
        overall_health: String(d.overall_health || 'ADEQUATE'),
        health_score: Number(d.health_score) || 0,
        one_line_summary: String(d.one_line_summary || ''),
        metrics: (d.metrics as Record<string, unknown>) || {},
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'CFO insights failed');
      setCfoInsightsResult(null);
    } finally {
      setCfoInsightsLoading(false);
    }
  }, [cfoContextInputs]);

  useEffect(() => {
    if (!cfoInsightsOpen) return;
    void runCfoInsights();
  }, [cfoInsightsOpen, runCfoInsights]);

  const downloadCfoInsightsTxt = () => {
    if (!cfoInsightsResult) return;
    const lines: string[] = [
      'CFO STRATEGIC INSIGHTS — IFRS 16 Lease Portfolio',
      `Generated: ${new Date().toISOString()}`,
      '',
      `Portfolio Health: ${cfoInsightsResult.overall_health || 'N/A'}`,
      `Health Score: ${cfoInsightsResult.health_score ?? 'N/A'}/100`,
      cfoInsightsResult.one_line_summary || '',
      '',
    ];
    const m = cfoInsightsResult.metrics || {};
    lines.push('METRICS', '-------');
    Object.entries(m).forEach(([k, v]) => {
      if (typeof v === 'object') return;
      lines.push(`${k}: ${v}`);
    });
    lines.push('');
    (cfoInsightsResult.insights || []).forEach((ins, i) => {
      lines.push(`Insight ${i + 1}: ${ins.title || ''}`);
      lines.push(`  Category: ${ins.category || ''} | Severity: ${ins.severity || ''}`);
      lines.push(`  Finding: ${ins.finding || ''}`);
      lines.push(`  Recommendation: ${ins.recommendation || ''}`);
      lines.push(`  Impact: ${ins.impact || ''}`);
      lines.push('');
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `IFRS16_CFO_Insights_${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const recentLeases = [...leases].slice(0, 10);
  const cfoMetrics = cfoInsightsResult?.metrics || {};
  const cfoHealthScore = Number(cfoInsightsResult?.health_score) || 0;
  const cfoHealthColors = healthScoreColor(cfoHealthScore);
  const expiringSoonRows = (cfoMetrics.expiring_soon as Array<Record<string, unknown>>) || [];
  const topLeaseRows = (cfoMetrics.top_leases_by_liability as Array<Record<string, unknown>>) || [];
  const totalLiabilityForInsights = Number(cfoMetrics.total_liability) || totalLeaseLiability || 0;
  const weightedIbrAcrossPortfolio = (() => {
    if (leases.length === 0) return 0;
    const weighted = leases.reduce((sum, lease) => {
      const liability = Number(lease.liability ?? lease.results?.lease_liability ?? 0);
      const rawRate = Number(lease.discount_rate ?? lease.results?.annual_discount_rate ?? 0);
      const pctRate = rawRate <= 1 ? rawRate * 100 : rawRate;
      return sum + liability * pctRate;
    }, 0);
    return totalLiabilityForInsights > 0 ? weighted / totalLiabilityForInsights : 0;
  })();
  const largestLease = topLeaseRows[0];
  const largestLeaseLiability = Number(largestLease?.liability) || 0;
  const largestLeasePortfolioPct =
    totalLiabilityForInsights > 0 ? (largestLeaseLiability / totalLiabilityForInsights) * 100 : 0;
  const expiringNext12MonthsCount = Number(cfoMetrics.expiring_12_months) || expiring365.length;
  const highestCostLease = [...leases].sort(
    (a, b) =>
      Number(b.monthly_payment ?? b.payments?.monthly ?? 0) -
      Number(a.monthly_payment ?? a.payments?.monthly ?? 0)
  )[0];
  const leaseVsBuyRecommendation = highestCostLease
    ? (() => {
        const monthly = Number(highestCostLease.monthly_payment ?? highestCostLease.payments?.monthly ?? 0);
        const annual = monthly * 12;
        const years = Math.max(
          1,
          Math.round(Number(highestCostLease.dates?.term_months ?? 12) / 12)
        );
        return `Highest-cost lease "${highestCostLease.title || highestCostLease.asset || highestCostLease.id}" runs about ${fmtPortfolio(annual)} per year. Run a lease-vs-buy NPV comparison over ${years} year(s); for long-use strategic assets, buying may reduce total cost if financing rates are below current IBR.`;
      })()
    : 'No lease-vs-buy recommendation available until at least one lease is present.';
  const debtCovenantImpact =
    Number(cfoMetrics.leverage_ratio_pct) > 20
      ? `Lease liability is ${Number(cfoMetrics.leverage_ratio_pct).toFixed(1)}% of total assets, which may pressure leverage covenants depending on lender thresholds.`
      : `Current leverage impact is moderate at ${Number(cfoMetrics.leverage_ratio_pct || 0).toFixed(1)}% of assets; monitor covenant headroom as new leases are added.`;

  return (
    <SidebarLayout
      pageTitle="IFRS 16 Overview"
      pageSubtitle="Lease portfolio KPIs and analytics"
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-white rounded-xl border border-[#e2e8f0] px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-[#1e293b]">Market mode</p>
            <p className="text-xs text-[#64748b]">Default currency for new leases and portfolio totals</p>
          </div>
          <div className="inline-flex rounded-lg border border-[#e2e8f0] p-1 bg-[#f8fafc]">
            {(['AE', 'IN'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  setIfrs16MarketMode(mode);
                  setMarketModeState(mode);
                  load();
                }}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  marketMode === mode
                    ? 'bg-[#f97316] text-white shadow-sm'
                    : 'text-[#64748b] hover:text-[#1e293b]'
                }`}
              >
                {mode === 'AE' ? 'UAE (AED)' : 'India (INR)'}
              </button>
            ))}
          </div>
        </div>
        <IFRS16OverviewTools />
        {/* Quick Actions */}
        <div className="flex flex-wrap gap-3">
          <Link href="/dashboard/ifrs16/leases/new">
            <Button variant="primary" className="bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white">
              <Plus className="w-4 h-4 mr-2" />
              Add New Lease
            </Button>
          </Link>
          <Link href="/dashboard/ifrs16/upload">
            <Button variant="secondary" className="border-border-default">
              <Upload className="w-4 h-4 mr-2" />
              Bulk Upload
            </Button>
          </Link>
          <Link href="/dashboard/reports">
            <Button variant="secondary" className="border-border-default">
              <FileBarChart className="w-4 h-4 mr-2" />
              Generate Reports
            </Button>
          </Link>
          <Button
            type="button"
            variant="primary"
            className="bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white"
            onClick={() => setCfoInsightsOpen(true)}
          >
            <Sparkles className="w-4 h-4 mr-2" />
            CFO Insights
          </Button>
        </div>

        {/* KPI Row */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <div className="bg-white rounded-[14px] p-5 border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
            <p className="text-xs font-medium text-[#64748b] mb-1">Total Active Leases</p>
            <p className="text-2xl font-bold text-[#1e293b] font-mono">{totalActive}</p>
          </div>
          <div className="bg-white rounded-[14px] p-5 border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
            <p className="text-xs font-medium text-[#64748b] mb-1">Total Contracted Value</p>
            <p className="text-xl font-bold text-[#1e293b] font-mono">{fmtPortfolio(totalContractedValue)}</p>
          </div>
          <div className="bg-white rounded-[14px] p-5 border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
            <p className="text-xs font-medium text-[#64748b] mb-1">Average Lease Value</p>
            <p className="text-xl font-bold text-[#1e293b] font-mono">{fmtPortfolio(averageLeaseValue)}</p>
          </div>
          <div className="bg-white rounded-[14px] p-5 border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
            <p className="text-xs font-medium text-[#64748b] mb-1">Total Lease Liability</p>
            <p className="text-xl font-bold text-[#f97316] font-mono">{fmtPortfolio(totalLeaseLiability)}</p>
          </div>
          <div className="bg-white rounded-[14px] p-5 border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
            <p className="text-xs font-medium text-[#64748b] mb-1">Leases Expiring</p>
            <p className="text-xl font-bold text-[#1e293b] font-mono">{expiring30.length} / {expiring90.length} / {expiring365.length}</p>
            <p className="text-xs text-[#64748b] mt-1">30 / 90 / 365 days</p>
          </div>
          <div className="bg-white rounded-[14px] p-5 border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
            <p className="text-xs font-medium text-[#64748b] mb-1">Pending Calculations</p>
            <p className="text-2xl font-bold text-[#1e293b] font-mono">{pendingCalc}</p>
          </div>
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-white rounded-[14px] p-6 border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)] lg:col-span-2">
            <h4 className="text-sm font-semibold text-[#1e293b] mb-4">Lease Liability by Month</h4>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={liabilityByMonth}>
                <defs>
                  <linearGradient id="liabilityGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f97316" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#f97316" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="#64748b" />
                <YAxis tick={{ fontSize: 11 }} stroke="#64748b" tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                <Tooltip formatter={(value: number | string | undefined) => (value !== undefined ? [fmtPortfolio(Number(value)), 'Liability'] : '')} />
                <Area type="monotone" dataKey="liability" stroke="#f97316" fill="url(#liabilityGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-white rounded-[14px] p-6 border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
            <h4 className="text-sm font-semibold text-[#1e293b] mb-4">Lease Type Distribution</h4>
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={pieData.length ? pieData : [{ name: 'No data', value: 1 }]}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="value"
                  nameKey="name"
                >
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={ORANGE_SHADES[i % ORANGE_SHADES.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: number | string | undefined, name: string | undefined) => (value !== undefined ? [Number(value), name ?? ''] : '')} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white rounded-[14px] p-6 border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
          <h4 className="text-sm font-semibold text-[#1e293b] mb-4">Payment Timeline (Next 12 Months)</h4>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={paymentTimeline}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="#64748b" />
              <YAxis tick={{ fontSize: 11 }} stroke="#64748b" tickFormatter={(v) => `${(v / 1e5).toFixed(1)}L`} />
              <Tooltip formatter={(value: number | string | undefined) => (value !== undefined ? [fmtPortfolio(Number(value)), 'Payment'] : '')} />
              <Bar dataKey="payment" fill="#f97316" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Recent Leases Table */}
        <div className="bg-white rounded-[14px] border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)] overflow-hidden">
          <div className="px-6 py-4 border-b border-[#e2e8f0] flex justify-between items-center">
            <h4 className="text-sm font-semibold text-[#1e293b]">Recent Leases</h4>
            <Link href="/dashboard/ifrs16/repository">
              <Button variant="secondary" size="sm">View All</Button>
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#f8fafc] border-b border-[#e2e8f0]">
                  <th className="text-left py-3 px-4 font-medium text-[#64748b]">Lease ID</th>
                  <th className="text-left py-3 px-4 font-medium text-[#64748b]">Title</th>
                  <th className="text-left py-3 px-4 font-medium text-[#64748b]">Type</th>
                  <th className="text-left py-3 px-4 font-medium text-[#64748b]">Start</th>
                  <th className="text-left py-3 px-4 font-medium text-[#64748b]">End</th>
                  <th className="text-right py-3 px-4 font-medium text-[#64748b]">Monthly</th>
                  <th className="text-right py-3 px-4 font-medium text-[#64748b]">Liability</th>
                  <th className="text-center py-3 px-4 font-medium text-[#64748b]">Status</th>
                  <th className="text-center py-3 px-4 font-medium text-[#64748b]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {recentLeases.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-[#64748b]">
                      No leases yet. Add a new lease to get started.
                    </td>
                  </tr>
                ) : (
                  recentLeases.map((l) => {
                    const status = getStatus(l.dates?.end || '9999-12-31');
                    const assetType = inferAssetType(l.asset || '');
                    const Icon = getAssetTypeIcon(assetType);
                    const end = new Date(l.dates?.end || '9999-12-31');
                    const diffDays = Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 24));
                    const rowBg = status.label === 'Expired' ? 'bg-red-50' : status.label === 'Expiring Soon' ? 'bg-amber-50' : '';
                    const lid = l.id || l.lease_id;
                    return (
                      <tr
                        key={lid}
                        className={`border-b border-[#e2e8f0] hover:bg-[#f8fafc] cursor-pointer ${rowBg}`}
                        onClick={() => window.location.href = `/dashboard/ifrs16/leases/${lid}`}
                      >
                        <td className="py-3 px-4 font-mono text-[#f97316] hover:underline">
                          <Link href={`/dashboard/ifrs16/leases/${lid}`} onClick={(e) => e.stopPropagation()}>
                            {lid}
                          </Link>
                        </td>
                        <td className="py-3 px-4 text-[#1e293b]">{l.title || l.asset || '—'}</td>
                        <td className="py-3 px-4">
                          <span className="inline-flex items-center gap-1 text-[#64748b]">
                            <Icon className="w-4 h-4" />
                            {l.lease_type || assetType}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-[#64748b]">{l.start_date || l.dates?.commencement || '—'}</td>
                        <td className="py-3 px-4 text-[#64748b]">{l.end_date || l.dates?.end || '—'}</td>
                        <td className="py-3 px-4 text-right font-mono text-[#1e293b]">{formatLeaseMoney(l.monthly_payment ?? l.payments?.monthly ?? 0, resolveLeaseCurrency(l))}</td>
                        <td className="py-3 px-4 text-right font-mono text-[#1e293b]">{formatLeaseMoney(l.liability ?? 0, resolveLeaseCurrency(l))}</td>
                        <td className="py-3 px-4 text-center">
                          <span className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${status.className}`}>
                            {status.label}
                          </span>
                        </td>
                        <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-center gap-1">
                            <Link href={`/dashboard/ifrs16/leases/${lid}`}>
                              <button className="p-1.5 rounded hover:bg-orange-100 text-[#64748b] hover:text-orange-600" title="View">
                                <Eye className="w-4 h-4" />
                              </button>
                            </Link>
                            <Link href={`/dashboard/ifrs16/leases/${lid}`}>
                              <button className="p-1.5 rounded hover:bg-orange-100 text-[#64748b] hover:text-orange-600" title="Recalculate">
                                <Calculator className="w-4 h-4" />
                              </button>
                            </Link>
                            <button onClick={() => handleDownload(l)} className="p-1.5 rounded hover:bg-orange-100 text-[#64748b] hover:text-orange-600" title="Download">
                              <Download className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {cfoInsightsOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40"
            onClick={() => setCfoInsightsOpen(false)}
            aria-hidden
          />
          <div className="fixed inset-y-0 right-0 z-50 w-full max-w-2xl bg-white shadow-2xl flex flex-col border-l border-[#e2e8f0]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#e2e8f0] bg-gradient-to-r from-orange-50 to-white">
              <div>
                <h2 className="text-lg font-bold text-[#1e293b] flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-[#f97316]" />
                  CFO Strategic Insights
                </h2>
                <p className="text-xs text-[#64748b] mt-0.5">IFRS 16 Lease Portfolio Analysis</p>
              </div>
              <button
                type="button"
                onClick={() => setCfoInsightsOpen(false)}
                className="p-2 rounded-lg hover:bg-[#f1f5f9] text-[#64748b]"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
              <div className="border border-[#e2e8f0] rounded-xl overflow-hidden">
                <button
                  type="button"
                  className="w-full px-4 py-3 text-left text-sm font-semibold text-[#1e293b] bg-[#f8fafc] flex justify-between items-center"
                  onClick={() => setCfoContextOpen((o) => !o)}
                >
                  Provide context for deeper analysis
                  <span className="text-[#64748b] text-xs">{cfoContextOpen ? 'Hide' : 'Show'}</span>
                </button>
                {cfoContextOpen && (
                  <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-3 border-t border-[#e2e8f0]">
                    <label className="text-xs text-[#64748b]">
                      Total Assets ($)
                      <input
                        type="number"
                        min={0}
                        className="mt-1 w-full border border-[#e2e8f0] rounded-lg px-3 py-2 text-sm"
                        value={cfoContextInputs.total_assets || ''}
                        onChange={(e) =>
                          setCfoContextInputs((p) => ({
                            ...p,
                            total_assets: Number(e.target.value) || 0,
                          }))
                        }
                      />
                    </label>
                    <label className="text-xs text-[#64748b]">
                      Annual Revenue ($)
                      <input
                        type="number"
                        min={0}
                        className="mt-1 w-full border border-[#e2e8f0] rounded-lg px-3 py-2 text-sm"
                        value={cfoContextInputs.annual_revenue || ''}
                        onChange={(e) =>
                          setCfoContextInputs((p) => ({
                            ...p,
                            annual_revenue: Number(e.target.value) || 0,
                          }))
                        }
                      />
                    </label>
                    <label className="text-xs text-[#64748b]">
                      Annual Lease Budget ($)
                      <input
                        type="number"
                        min={0}
                        className="mt-1 w-full border border-[#e2e8f0] rounded-lg px-3 py-2 text-sm"
                        value={cfoContextInputs.budget_lease_cost || ''}
                        onChange={(e) =>
                          setCfoContextInputs((p) => ({
                            ...p,
                            budget_lease_cost: Number(e.target.value) || 0,
                          }))
                        }
                      />
                    </label>
                    <div className="sm:col-span-3">
                      <Button
                        type="button"
                        variant="primary"
                        className="bg-gradient-to-r from-orange-500 to-orange-600 text-white w-full sm:w-auto"
                        isLoading={cfoInsightsLoading}
                        onClick={() => void runCfoInsights()}
                      >
                        Generate Insights
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {cfoInsightsLoading && (
                <div className="flex flex-col items-center justify-center py-16 text-[#64748b]">
                  <Loader2 className="w-10 h-10 animate-spin text-[#f97316] mb-3" />
                  <p className="text-sm font-medium animate-pulse">Analysing your lease portfolio...</p>
                </div>
              )}

              {!cfoInsightsLoading && cfoInsightsResult && (
                <>
                  <div className={`rounded-xl border p-6 ${cfoHealthColors.bg} ${cfoHealthColors.border}`}>
                    <p className="text-xs font-semibold text-[#64748b] uppercase tracking-wide">Portfolio Health</p>
                    <p className="text-xl font-bold text-[#1e293b] mt-1">{cfoInsightsResult.overall_health}</p>
                    <div className="flex items-center gap-6 mt-4">
                      <div
                        className={`w-24 h-24 rounded-full border-4 flex flex-col items-center justify-center font-bold ${cfoHealthColors.ring} border-current`}
                      >
                        <span className="text-2xl leading-none">{cfoHealthScore}</span>
                        <span className="text-xs font-normal text-[#64748b]">/100</span>
                      </div>
                      <p className="text-sm text-[#475569] flex-1">{cfoInsightsResult.one_line_summary}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {[
                      { label: 'Total Liability', value: fmtPortfolio(Number(cfoMetrics.total_liability) || 0) },
                      { label: 'Annual Payments', value: fmtPortfolio(Number(cfoMetrics.total_annual_payments) || 0) },
                      { label: 'Active Leases', value: String(cfoMetrics.active_lease_count ?? 0) },
                      {
                        label: 'Expiring (90 days)',
                        value: String(cfoMetrics.expiring_90_days ?? 0),
                        alert: Number(cfoMetrics.expiring_90_days) > 0,
                      },
                      {
                        label: 'Leverage Ratio',
                        value: `${Number(cfoMetrics.leverage_ratio_pct) || 0}%`,
                        alert: Number(cfoMetrics.leverage_ratio_pct) > 20,
                      },
                      {
                        label: 'Budget Variance',
                        value: fmtPortfolio(Number(cfoMetrics.budget_variance) || 0),
                        alert: Number(cfoMetrics.budget_variance) > 0,
                      },
                    ].map((card) => (
                      <div
                        key={card.label}
                        className={`rounded-xl border p-4 ${card.alert ? 'border-red-200 bg-red-50' : 'border-[#e2e8f0] bg-white'}`}
                      >
                        <p className="text-xs text-[#64748b]">{card.label}</p>
                        <p className={`text-lg font-bold font-mono mt-1 ${card.alert ? 'text-red-700' : 'text-[#1e293b]'}`}>
                          {card.value}
                        </p>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-xl border border-[#e2e8f0] bg-white p-4 space-y-2">
                    <h4 className="text-sm font-bold text-[#1e293b]">CFO Focus Analytics</h4>
                    <p className="text-sm text-[#475569]">
                      Weighted average IBR across portfolio: <span className="font-semibold text-[#1e293b]">{weightedIbrAcrossPortfolio.toFixed(2)}%</span>
                    </p>
                    <p className="text-sm text-[#475569]">
                      Largest lease as % of total liability: <span className="font-semibold text-[#1e293b]">{largestLeasePortfolioPct.toFixed(2)}%</span>
                    </p>
                    <p className="text-sm text-[#475569]">
                      Leases expiring in next 12 months: <span className="font-semibold text-[#1e293b]">{expiringNext12MonthsCount}</span>
                    </p>
                    <p className="text-sm text-[#475569]">
                      <span className="font-semibold text-[#1e293b]">Lease vs buy:</span> {leaseVsBuyRecommendation}
                    </p>
                    <p className="text-sm text-[#475569]">
                      <span className="font-semibold text-[#1e293b]">Debt covenant impact:</span> {debtCovenantImpact}
                    </p>
                  </div>

                  <div className="space-y-4">
                    {(cfoInsightsResult.insights || []).map((ins, idx) => {
                      const sev = severityStyles(String(ins.severity || 'LOW'));
                      return (
                        <div
                          key={ins.id || `${ins.title}-${idx}`}
                          className={`rounded-xl border border-[#e2e8f0] border-l-4 ${sev.border} p-4 bg-white shadow-sm`}
                        >
                          <div className="flex flex-wrap gap-2 mb-2">
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded ${sev.badge}`}>
                              {ins.severity}
                            </span>
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded ${categoryBadgeClass(String(ins.category || ''))}`}>
                              {ins.category?.replace(/_/g, ' ')}
                            </span>
                          </div>
                          <h3 className="text-base font-bold text-[#1e293b] mb-2">{ins.title}</h3>
                          <p className="text-sm text-[#475569]">
                            <span className="font-medium">Finding:</span> {ins.finding}
                          </p>
                          <p className="text-sm text-[#1e293b] mt-2">
                            → <span className="font-medium">Recommendation:</span> {ins.recommendation}
                          </p>
                          <p className="text-sm text-[#64748b] mt-2">💰 Impact: {ins.impact}</p>
                        </div>
                      );
                    })}
                  </div>

                  {expiringSoonRows.length > 0 && (
                    <div className="rounded-xl border border-red-200 overflow-hidden">
                      <div className="px-4 py-3 bg-red-50 border-b border-red-200">
                        <h4 className="text-sm font-bold text-red-900">⚠ Leases Expiring Within 90 Days</h4>
                      </div>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-red-100/80 text-red-900">
                            <th className="text-left py-2 px-4 font-medium">Lease Name</th>
                            <th className="text-left py-2 px-4 font-medium">End Date</th>
                            <th className="text-right py-2 px-4 font-medium">Monthly Payment</th>
                          </tr>
                        </thead>
                        <tbody>
                          {expiringSoonRows.map((row, i) => (
                            <tr key={i} className="border-t border-red-100">
                              <td className="py-2 px-4">{String(row.title)}</td>
                              <td className="py-2 px-4">{String(row.end_date)}</td>
                              <td className="py-2 px-4 text-right font-mono">
                                {fmtPortfolio(Number(row.monthly_payment) || 0)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {topLeaseRows.length > 0 && (
                    <div className="rounded-xl border border-[#e2e8f0] overflow-hidden">
                      <div className="px-4 py-3 bg-[#f8fafc] border-b border-[#e2e8f0]">
                        <h4 className="text-sm font-bold text-[#1e293b]">Top 5 Leases by Liability</h4>
                      </div>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-[#f8fafc] text-[#64748b]">
                            <th className="text-left py-2 px-4 font-medium">Lease Name</th>
                            <th className="text-right py-2 px-4 font-medium">Liability</th>
                            <th className="text-right py-2 px-4 font-medium">Monthly</th>
                            <th className="text-left py-2 px-4 font-medium">Ends</th>
                          </tr>
                        </thead>
                        <tbody>
                          {topLeaseRows.map((row, i) => (
                            <tr key={i} className="border-t border-[#e2e8f0]">
                              <td className="py-2 px-4">{String(row.title)}</td>
                              <td className="py-2 px-4 text-right font-mono">
                                {fmtPortfolio(Number(row.liability) || 0)}
                              </td>
                              <td className="py-2 px-4 text-right font-mono">
                                {fmtPortfolio(Number(row.monthly_payment) || 0)}
                              </td>
                              <td className="py-2 px-4">{String(row.end_date)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}

              {!cfoInsightsLoading && !cfoInsightsResult && (
                <p className="text-sm text-[#64748b] text-center py-8">
                  No insights yet. Add leases or adjust context and generate.
                </p>
              )}
            </div>

            <div className="px-6 py-4 border-t border-[#e2e8f0] flex flex-wrap gap-3 bg-[#f8fafc]">
              <Button
                type="button"
                variant="secondary"
                disabled={!cfoInsightsResult}
                onClick={downloadCfoInsightsTxt}
              >
                Download Insights (.txt)
              </Button>
              <Button type="button" variant="secondary" onClick={() => setCfoInsightsOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        </>
      )}
    </SidebarLayout>
  );
}
