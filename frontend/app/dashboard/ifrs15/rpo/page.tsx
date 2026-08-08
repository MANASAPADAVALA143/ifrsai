'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from '@/components/Charts';
import {
  BarChart3,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  FileText,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { SidebarLayout } from '@/components/SidebarLayout';
import { Ifrs15WorkspaceShell } from '@/components/ifrs15/Ifrs15WorkspaceShell';
import { Button } from '@/components/Button';
import { ifrs15Api } from '@/lib/api';
import { getCurrentFirmId } from '@/lib/firm-workspace';

type Snapshot = Record<string, unknown>;
type Detail = Record<string, unknown>;
type WaterfallRow = {
  period?: string;
  opening_rpo?: number;
  new_bookings?: number;
  revenue_recognised?: number;
  closing_rpo?: number;
};
type TabId = 'contracts' | 'disclosure' | 'trend';

const BUCKET_COLORS: Record<string, string> = {
  lt_1yr: '#0d9488',
  '1_2yr': '#2563eb',
  '2_5yr': '#4f46e5',
  gt_5yr: '#7c3aed',
};

const TYPE_ORDER = ['uae_real_estate', 'saas_subscription', 'professional_services', 'other'];

function aed(n: unknown): string {
  if (n == null || n === '' || Number.isNaN(Number(n))) return '—';
  return `AED ${Number(n).toLocaleString('en-AE', { maximumFractionDigits: 0 })}`;
}

function num(n: unknown): number {
  return Number(n || 0);
}

function bucketLabel(b?: unknown): string {
  switch (String(b || '')) {
    case 'lt_1yr':
      return '< 1 Year';
    case '1_2yr':
      return '1–2 Years';
    case '2_5yr':
      return '2–5 Years';
    case 'gt_5yr':
      return '> 5 Years';
    default:
      return String(b || '—');
  }
}

function typeLabel(t?: unknown): string {
  switch (String(t || '')) {
    case 'uae_real_estate':
      return 'UAE Real Estate';
    case 'saas_subscription':
      return 'SaaS Subscriptions';
    case 'professional_services':
      return 'Professional Services';
    default:
      return 'Other';
  }
}

function statusCls(s?: unknown): string {
  switch (String(s || '')) {
    case 'active':
      return 'bg-green-100 text-green-800';
    case 'near_complete':
      return 'bg-blue-100 text-blue-800';
    case 'at_risk':
      return 'bg-amber-100 text-amber-800';
    case 'overdue':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-gray-100 text-gray-600';
  }
}

function coverageTone(ratio: number | null): string {
  if (ratio == null) return 'text-[#64748b]';
  if (ratio > 1.5) return 'text-emerald-700';
  if (ratio >= 1) return 'text-amber-700';
  return 'text-red-700';
}

export default function RpoDashboardPage() {
  const companyId = typeof window !== 'undefined' ? getCurrentFirmId() : 'default';
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [tab, setTab] = useState<TabId>('contracts');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [details, setDetails] = useState<Detail[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [waterfall, setWaterfall] = useState<WaterfallRow[]>([]);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    uae_real_estate: true,
    saas_subscription: true,
    professional_services: true,
    other: true,
  });

  const load = useCallback(async () => {
    setLoading(true);
    const [cur, hist, wf] = await Promise.all([
      ifrs15Api.rpoDashboardCurrent(companyId),
      ifrs15Api.rpoDashboardSnapshots({ company_id: companyId, last_n_periods: 6 }),
      ifrs15Api.rpoDashboardWaterfall({ company_id: companyId, periods: 6 }),
    ]);
    if (cur.error && !String(cur.error).toLowerCase().includes('no rpo snapshot')) {
      toast.error(cur.error);
    }
    setSnapshot((cur.data?.snapshot as Snapshot) || null);
    setDetails((cur.data?.contract_detail as Detail[]) || []);
    setSnapshots((hist.data?.snapshots as Snapshot[]) || []);
    setWaterfall((wf.data?.waterfall as WaterfallRow[]) || []);
    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const runSnapshot = async () => {
    setRunning(true);
    const today = new Date();
    const period = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const { error } = await ifrs15Api.rpoDashboardRun({
      company_id: companyId,
      snapshot_date: today.toISOString().slice(0, 10),
      period,
      ltm_revenue: num(snapshot?.ltm_revenue) || 2100000,
    });
    setRunning(false);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success('RPO snapshot saved');
    await load();
  };

  const exportPdf = async () => {
    if (!snapshot?.id) {
      toast.error('Run a snapshot first');
      return;
    }
    const { blob, filename, error } = await ifrs15Api.rpoDashboardExportPdf({
      company_id: companyId,
      snapshot_id: String(snapshot.id),
    });
    if (error || !blob) {
      toast.error(error || 'PDF export failed');
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'IFRS15_RPO_disclosure.pdf';
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyDisclosure = async () => {
    const text = String(snapshot?.ai_disclosure_draft || '');
    if (!text) {
      toast.error('No disclosure draft yet');
      return;
    }
    await navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  const coverage = snapshot?.rpo_coverage_ratio == null ? null : num(snapshot.rpo_coverage_ratio);
  const pieData = [
    { key: 'lt_1yr', name: '< 1 Year', value: num(snapshot?.bucket_lt_1yr) },
    { key: '1_2yr', name: '1–2 Years', value: num(snapshot?.bucket_1_2yr) },
    { key: '2_5yr', name: '2–5 Years', value: num(snapshot?.bucket_2_5yr) },
    { key: 'gt_5yr', name: '> 5 Years', value: num(snapshot?.bucket_gt_5yr) },
  ].filter((d) => d.value > 0);

  const grouped = useMemo(() => {
    const map: Record<string, Detail[]> = {};
    for (const d of details) {
      const t = String(d.contract_type || 'other');
      map[t] = map[t] || [];
      map[t].push(d);
    }
    return TYPE_ORDER.filter((t) => map[t]?.length).map((t) => ({
      type: t,
      rows: map[t],
      rpo: map[t].reduce((s, r) => s + num(r.rpo), 0),
    }));
  }, [details]);

  const trendRows = useMemo(() => {
    const ordered = [...snapshots].sort((a, b) => String(a.period).localeCompare(String(b.period)));
    return ordered.map((s, i) => {
      const prev = i > 0 ? num(ordered[i - 1].total_rpo) : null;
      const total = num(s.total_rpo);
      return {
        ...s,
        change: prev == null ? null : total - prev,
      };
    });
  }, [snapshots]);

  const wfChart = waterfall.map((w) => ({
    ...w,
    revenue_out: -num(w.revenue_recognised),
  }));

  const kpiItems = [
    { label: 'Total RPO', value: loading ? '—' : aed(snapshot?.total_rpo), accent: 'orange' as const },
    {
      label: 'Active contracts',
      value: loading ? '—' : String(snapshot?.active_contracts ?? 0),
      accent: 'orange' as const,
    },
    {
      label: 'Coverage ratio',
      value: loading || coverage == null ? '—' : `${coverage.toFixed(2)}x`,
      accent: coverage != null && coverage < 1 ? ('pink' as const) : ('orange' as const),
    },
    {
      label: 'At-risk RPO',
      value: loading ? '—' : aed(snapshot?.at_risk_rpo),
      accent: num(snapshot?.at_risk_rpo) > 0 ? ('pink' as const) : ('orange' as const),
    },
  ];

  return (
    <SidebarLayout pageTitle="RPO Portfolio Dashboard" pageSubtitle="IFRS 15 §120 · Remaining Performance Obligations">
      <Ifrs15WorkspaceShell activeNavId="rpo-disclosure" kpiItems={kpiItems}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-[#1e293b] flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-[#f97316]" />
              RPO Portfolio Dashboard
            </h1>
            <p className="text-sm text-[#64748b]">IFRS 15 §120 · Remaining Performance Obligations</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-[#64748b] border border-[#e2e8f0] rounded-md px-2 py-1.5 bg-white">
              {snapshot?.snapshot_date ? `As at ${String(snapshot.snapshot_date).slice(0, 10)}` : 'No snapshot'}
              {snapshot?.period ? ` · ${String(snapshot.period)}` : ''}
            </span>
            <Button size="sm" variant="secondary" onClick={() => void exportPdf()} disabled={!snapshot}>
              <Download className="w-3.5 h-3.5" /> Export Disclosure PDF
            </Button>
            <Button size="sm" className="!bg-teal-600 hover:!opacity-90" onClick={() => void runSnapshot()} disabled={running}>
              {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              Run Snapshot
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-[#64748b] py-10">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading RPO dashboard…
          </div>
        ) : !snapshot ? (
          <div className="bg-white border border-[#e2e8f0] rounded-lg p-10 text-center">
            <p className="font-semibold text-[#1e293b]">Run your first RPO snapshot</p>
            <p className="text-sm text-[#64748b] mt-2 max-w-xl mx-auto">
              IFRS 15 §120 requires disclosure of the aggregate transaction price allocated to unsatisfied performance
              obligations, and when that revenue is expected to be recognised (typically &lt;1 year, 1–2, 2–5, &gt;5 years).
            </p>
            <Button className="mt-4 !bg-teal-600" onClick={() => void runSnapshot()} disabled={running}>
              Run Snapshot
            </Button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              {[
                { label: 'Total RPO', value: aed(snapshot.total_rpo), extra: null as string | null },
                { label: 'Active Contracts', value: String(snapshot.active_contracts ?? 0), extra: null },
                {
                  label: 'RPO Coverage Ratio',
                  value: coverage == null ? '—' : `${coverage.toFixed(2)}x`,
                  extra: coverageTone(coverage),
                },
                {
                  label: 'Weighted Avg Term',
                  value: snapshot.weighted_avg_remaining_months != null ? `${num(snapshot.weighted_avg_remaining_months).toFixed(1)} months` : '—',
                  extra: null,
                },
                { label: 'At-Risk RPO', value: aed(snapshot.at_risk_rpo), extra: 'text-amber-800' },
              ].map((k) => (
                <div key={k.label} className="bg-white border border-[#e2e8f0] rounded-lg p-3">
                  <p className="text-[11px] uppercase tracking-wide text-[#64748b]">{k.label}</p>
                  <p className={`text-lg font-bold mt-1 ${k.extra || 'text-[#1e293b]'}`}>{k.value}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-3">
              <div className="bg-white border border-[#e2e8f0] rounded-lg p-4">
                <p className="text-sm font-semibold text-[#1e293b] mb-2">RPO Waterfall — Backlog Movement</p>
                {wfChart.length === 0 ? (
                  <p className="text-xs text-[#64748b] py-8 text-center">No waterfall data yet.</p>
                ) : (
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={wfChart}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
                        <Tooltip formatter={(v: number) => aed(v)} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar dataKey="opening_rpo" name="Opening RPO" fill="#94a3b8" stackId="wf" />
                        <Bar dataKey="new_bookings" name="+ New Bookings" fill="#0d9488" stackId="wf" />
                        <Bar dataKey="revenue_out" name="− Revenue Recognised" fill="#f97316" stackId="wf" />
                        <Line type="monotone" dataKey="closing_rpo" name="Closing RPO" stroke="#1e293b" strokeWidth={2} dot />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
              <div className="bg-white border border-[#e2e8f0] rounded-lg p-4">
                <p className="text-sm font-semibold text-[#1e293b] mb-2">Revenue Expected By Year (IFRS 15 §120)</p>
                <div className="h-48 relative">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={48} outerRadius={72} paddingAngle={2}>
                        {pieData.map((d) => (
                          <Cell key={d.key} fill={BUCKET_COLORS[d.key]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: number) => aed(v)} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="text-center">
                      <p className="text-[10px] text-[#64748b]">Total RPO</p>
                      <p className="text-xs font-bold text-[#1e293b]">{aed(snapshot.total_rpo)}</p>
                    </div>
                  </div>
                </div>
                <ul className="mt-2 space-y-1 text-xs">
                  {pieData.map((d) => (
                    <li key={d.key} className="flex justify-between">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-sm inline-block" style={{ background: BUCKET_COLORS[d.key] }} />
                        {d.name}
                      </span>
                      <span className="font-mono">{aed(d.value)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="flex gap-1.5">
              {(
                [
                  ['contracts', 'By Contract'],
                  ['disclosure', 'AI Disclosure'],
                  ['trend', 'Trend'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={`text-xs px-3 py-1.5 rounded-full border ${
                    tab === id ? 'bg-[#f97316] text-white border-[#f97316]' : 'bg-white text-[#64748b] border-[#e2e8f0]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === 'contracts' ? (
              <div className="space-y-3">
                {grouped.map((g) => (
                  <div key={g.type} className="bg-white border border-[#e2e8f0] rounded-lg overflow-hidden">
                    <button
                      type="button"
                      className="w-full flex items-center justify-between px-4 py-2.5 text-left bg-[#f8fafc]"
                      onClick={() => setOpenGroups((p) => ({ ...p, [g.type]: !p[g.type] }))}
                    >
                      <span className="text-sm font-semibold text-[#1e293b] flex items-center gap-1">
                        {openGroups[g.type] ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        {typeLabel(g.type)} ({g.rows.length} contracts · {aed(g.rpo)} total RPO)
                      </span>
                    </button>
                    {openGroups[g.type] ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs min-w-[860px]">
                          <thead>
                            <tr className="text-left text-[#64748b] border-b border-[#e2e8f0]">
                              <th className="py-2 px-3">Contract Ref</th>
                              <th className="py-2 px-3">Customer</th>
                              <th className="py-2 px-3">Type</th>
                              <th className="py-2 px-3 text-right">Transaction Price</th>
                              <th className="py-2 px-3 text-right">Revenue Recognised</th>
                              <th className="py-2 px-3 text-right">RPO</th>
                              <th className="py-2 px-3">Progress %</th>
                              <th className="py-2 px-3">Time Bucket</th>
                              <th className="py-2 px-3">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {g.rows.map((r) => {
                              const expedient = Boolean(r.practical_expedient_applies);
                              const prog = num(r.progress_pct);
                              return (
                                <tr
                                  key={String(r.id || r.contract_ref)}
                                  className={`border-t border-[#f1f5f9] ${expedient ? 'text-[#94a3b8] italic' : ''}`}
                                  title={expedient ? 'Excluded from §120 disclosure (original term ≤ 12 months)' : undefined}
                                >
                                  <td className="py-2 px-3 font-medium">{String(r.contract_ref || '—')}</td>
                                  <td className="py-2 px-3">{String(r.customer_name || '—')}</td>
                                  <td className="py-2 px-3">{typeLabel(r.contract_type)}</td>
                                  <td className="py-2 px-3 text-right font-mono">{aed(r.transaction_price)}</td>
                                  <td className="py-2 px-3 text-right font-mono">{aed(r.revenue_recognised)}</td>
                                  <td className="py-2 px-3 text-right font-mono font-semibold">{aed(r.rpo)}</td>
                                  <td className="py-2 px-3">
                                    <div className="flex items-center gap-2">
                                      <div className="flex-1 h-1.5 rounded bg-[#e2e8f0] overflow-hidden">
                                        <div className="h-full bg-teal-600" style={{ width: `${Math.min(100, prog)}%` }} />
                                      </div>
                                      <span>{prog.toFixed(1)}%</span>
                                    </div>
                                  </td>
                                  <td className="py-2 px-3">
                                    <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold">
                                      {bucketLabel(r.time_bucket)}
                                    </span>
                                  </td>
                                  <td className="py-2 px-3">
                                    <span className={`px-1.5 py-0.5 rounded font-semibold ${statusCls(r.status)}`}>
                                      {String(r.status || '—').replace('_', ' ')}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            {tab === 'disclosure' ? (
              <div className="space-y-3">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <div className="bg-blue-50 border-l-4 border-blue-400 rounded-r-lg p-4">
                    <p className="text-xs font-semibold text-blue-900 flex items-center gap-1 mb-2">
                      <Sparkles className="w-3.5 h-3.5" /> AI Analysis · Management Commentary
                    </p>
                    <p className="text-sm text-blue-950 whitespace-pre-wrap">{String(snapshot.ai_narrative || 'No narrative yet.')}</p>
                    <p className="text-[11px] text-blue-700 mt-3">Snapshot run: {String(snapshot.created_at || snapshot.snapshot_date || '')}</p>
                  </div>
                  <div className="bg-white border border-[#e2e8f0] rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-[#1e293b] flex items-center gap-1">
                        <FileText className="w-3.5 h-3.5" /> Draft Financial Statement Note
                      </p>
                      <div className="flex gap-1">
                        <Button size="sm" variant="secondary" onClick={() => void copyDisclosure()}>
                          <Copy className="w-3.5 h-3.5" /> Copy
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => void exportPdf()}>
                          <Download className="w-3.5 h-3.5" /> PDF
                        </Button>
                      </div>
                    </div>
                    <pre className="whitespace-pre-wrap text-xs text-[#334155] font-mono leading-relaxed max-h-[420px] overflow-y-auto">
                      {String(snapshot.ai_disclosure_draft || 'No disclosure draft yet.')}
                    </pre>
                  </div>
                </div>
                <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
                  This is an AI-generated draft. Review and approve with your finance team before inclusion in financial statements.
                </div>
              </div>
            ) : null}

            {tab === 'trend' ? (
              <div className="space-y-3">
                <div className="bg-white border border-[#e2e8f0] rounded-lg p-4">
                  <p className="text-sm font-semibold text-[#1e293b] mb-2">RPO Trend — 6 Month History</p>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={[...snapshots].sort((a, b) => String(a.period).localeCompare(String(b.period)))}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
                        <Tooltip formatter={(v: number) => aed(v)} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Line type="monotone" dataKey="total_rpo" name="Total RPO" stroke="#0d9488" strokeWidth={2} />
                        <Line type="monotone" dataKey="at_risk_rpo" name="At-Risk RPO" stroke="#d97706" strokeDasharray="5 4" />
                        <Line type="monotone" dataKey="bucket_lt_1yr" name="< 1 Year" stroke="#2563eb" strokeDasharray="2 3" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="bg-white border border-[#e2e8f0] rounded-lg overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[#64748b] border-b border-[#e2e8f0]">
                        <th className="py-2 px-3">Period</th>
                        <th className="py-2 px-3 text-right">Total RPO</th>
                        <th className="py-2 px-3 text-right">Coverage Ratio</th>
                        <th className="py-2 px-3 text-right">New Bookings</th>
                        <th className="py-2 px-3 text-right">Change vs Prior</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trendRows.map((s) => {
                        const change = s.change as number | null;
                        return (
                          <tr key={String(s.id || s.period)} className="border-t border-[#f1f5f9]">
                            <td className="py-2 px-3 font-medium">{String(s.period)}</td>
                            <td className="py-2 px-3 text-right font-mono">{aed(s.total_rpo)}</td>
                            <td className="py-2 px-3 text-right">
                              {s.rpo_coverage_ratio == null ? '—' : `${num(s.rpo_coverage_ratio).toFixed(2)}x`}
                            </td>
                            <td className="py-2 px-3 text-right font-mono">{aed(s.new_bookings_qtd)}</td>
                            <td
                              className={`py-2 px-3 text-right font-semibold ${
                                change == null ? 'text-[#94a3b8]' : change >= 0 ? 'text-emerald-700' : 'text-red-600'
                              }`}
                            >
                              {change == null ? '—' : `${change >= 0 ? '+' : ''}${aed(change).replace('AED ', 'AED ')}`}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </>
        )}
      </Ifrs15WorkspaceShell>
    </SidebarLayout>
  );
}
