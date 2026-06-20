'use client';

import { Fragment, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { SidebarLayout } from '@/components/SidebarLayout';
import { Ifrs15WorkspaceShell } from '@/components/ifrs15/Ifrs15WorkspaceShell';
import { Button } from '@/components/Button';
import { ifrs15Api } from '@/lib/api';
import { formatRealEstateMoney, type DisplayCurrency } from '@/lib/realestate-format';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  Building2,
  Download,
  Loader2,
  Search,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type ProjectRow = Record<string, unknown>;
type Analytics = Record<string, unknown>;

const HEALTH_KEYS = [
  { key: 'check_a_pass', label: 'A — Schedule vs revenue' },
  { key: 'check_b1_pass', label: 'B1 — Revenue vs escrow' },
  { key: 'check_b2_pass', label: 'B2 — Release ≤ completion' },
  { key: 'check_c_pass', label: 'C — VAT alignment' },
  { key: 'check_d_pass', label: 'D — Oqood filings' },
  { key: 'check_e_pass', label: 'E — Bundling assessed' },
];

function PortfolioPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Analytics | null>(null);
  const [exportLoading, setExportLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [developerFilter, setDeveloperFilter] = useState('');
  const [minCompletion, setMinCompletion] = useState(0);
  const [maxCompletion, setMaxCompletion] = useState(100);
  const [escrowFilter, setEscrowFilter] = useState<'all' | 'compliant' | 'violation'>('all');
  const [healthOnly, setHealthOnly] = useState(false);
  const [oqoodOnly, setOqoodOnly] = useState(false);
  const [sortBy, setSortBy] = useState('contract_value');
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deadlineDrawer, setDeadlineDrawer] = useState<ProjectRow | null>(null);

  const violationsOnly = searchParams.get('violations_only') === 'true';
  const healthIssuesOnly = searchParams.get('health_issues_only') === 'true';

  const currency = (data?.currency as DisplayCurrency) || 'AED';
  const fmt = (n: number) => formatRealEstateMoney(n, currency);

  const queryParams = useMemo(() => {
    const p: Record<string, string | boolean> = { currency };
    if (developerFilter.trim()) p.developer_name = developerFilter.trim();
    if (minCompletion > 0) p.min_completion = String(minCompletion);
    if (maxCompletion < 100) p.max_completion = String(maxCompletion);
    if (healthOnly || healthIssuesOnly) p.health_issues_only = true;
    if (escrowFilter === 'violation' || violationsOnly) p.violations_only = true;
    return p;
  }, [currency, developerFilter, minCompletion, maxCompletion, healthOnly, healthIssuesOnly, escrowFilter, violationsOnly]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: res, error: err } = await ifrs15Api.realestatePortfolioAnalytics(queryParams);
    setLoading(false);
    if (err) {
      setError(err);
      setData(null);
      return;
    }
    setData(res || null);
  }, [queryParams]);

  useEffect(() => {
    void load();
  }, [load]);

  const projects = useMemo(() => {
    let rows = ((data?.projects as ProjectRow[]) || []).slice();
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (p) =>
          String(p.project_name || '').toLowerCase().includes(q) ||
          String(p.rera_registration_number || '').toLowerCase().includes(q)
      );
    }
    if (oqoodOnly) rows = rows.filter((p) => Number(p.pending_oqood_filings) > 0);
    if (escrowFilter === 'compliant') rows = rows.filter((p) => p.escrow_compliance === 'compliant');
    if (escrowFilter === 'violation') rows = rows.filter((p) => p.escrow_compliance === 'violation');

    rows.sort((a, b) => {
      if (sortBy === 'completion_pct') return Number(b.completion_pct) - Number(a.completion_pct);
      if (sortBy === 'health_score') return Number(b.health_score) - Number(a.health_score);
      if (sortBy === 'last_updated') return String(b.last_updated).localeCompare(String(a.last_updated));
      return Number(b.contract_price_aed) - Number(a.contract_price_aed);
    });
    return rows;
  }, [data?.projects, search, oqoodOnly, escrowFilter, sortBy]);

  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(projects.length / pageSize));
  const pageRows = projects.slice((page - 1) * pageSize, page * pageSize);

  const dist = (data?.completion_distribution as Record<string, number>) || {};
  const barData = [
    { name: '0–25%', count: dist['0-25'] || 0, fill: '#DC2626' },
    { name: '26–50%', count: dist['26-50'] || 0, fill: '#D97706' },
    { name: '51–75%', count: dist['51-75'] || 0, fill: '#2563EB' },
    { name: '76–100%', count: dist['76-100'] || 0, fill: '#16A34A' },
  ];

  const rev = Number(data?.total_revenue_recognised_aed) || 0;
  const def = Number(data?.total_deferred_revenue_aed) || 0;
  const donutData = [
    { name: 'Recognised', value: rev, fill: '#1E3A5F' },
    { name: 'Deferred', value: def, fill: '#C9A84C' },
  ];

  const setUrlFilter = (key: string, value: boolean) => {
    const url = new URL(window.location.href);
    if (value) url.searchParams.set(key, 'true');
    else url.searchParams.delete(key);
    router.push(url.pathname + url.search);
  };

  const openProject = (p: ProjectRow) => {
    sessionStorage.setItem(
      're_portfolio_selected_project',
      JSON.stringify({
        rera_registration_number: p.rera_registration_number,
        project_name: p.project_name,
        contract_value: p.contract_price_aed,
        construction_start: '',
        expected_handover: '',
      })
    );
    router.push('/dashboard/ifrs15/realestate');
  };

  const exportExcel = async () => {
    setExportLoading(true);
    const { blob, filename, error: err } = await ifrs15Api.realestatePortfolioAnalyticsExport(queryParams);
    setExportLoading(false);
    if (err || !blob) {
      toast.error(err || 'Export failed');
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'RE_Portfolio.xlsx';
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Portfolio Excel downloaded');
  };

  if (loading && !data) {
    return (
      <SidebarLayout pageTitle="IFRS 15 — Real Estate Portfolio" pageSubtitle="Loading portfolio analytics…">
        <div className="max-w-7xl mx-auto p-8 space-y-4 animate-pulse">
          <div className="h-8 bg-slate-200 rounded w-1/3" />
          <div className="grid grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-24 bg-slate-100 rounded-lg" />
            ))}
          </div>
          <div className="h-64 bg-slate-100 rounded-lg" />
        </div>
      </SidebarLayout>
    );
  }

  if (error) {
    return (
      <SidebarLayout pageTitle="IFRS 15 — Real Estate Portfolio" pageSubtitle="Portfolio analytics unavailable">
        <div className="max-w-lg mx-auto mt-20 text-center p-8">
          <p className="text-red-700 mb-4">Could not load portfolio data. Check your connection and try again.</p>
          <Button onClick={() => void load()}>Retry</Button>
        </div>
      </SidebarLayout>
    );
  }

  const totalProjects = Number(data?.total_projects) || 0;

  if (!loading && totalProjects === 0) {
    return (
      <SidebarLayout pageTitle="IFRS 15 — Real Estate Portfolio" pageSubtitle="No projects in portfolio yet">
        <div className="max-w-lg mx-auto mt-24 text-center p-8">
          <div className="text-6xl mb-4">🏢</div>
          <h1 className="text-xl font-bold mb-2">No real estate contracts in portfolio yet.</h1>
          <p className="text-text-muted mb-6">
            Run recognition on a project and click Save to add it to the portfolio.
          </p>
          <Link href="/dashboard/ifrs15/realestate">
            <Button>Go to Real Estate Module →</Button>
          </Link>
        </div>
      </SidebarLayout>
    );
  }

  const escrowViolations = Number(data?.escrow_violation_count) || 0;
  const oqoodPending = Number(data?.projects_with_oqood_pending) || 0;
  const bundlingN = Number(data?.projects_with_bundling_alert) || 0;
  const healthIssues = Number(data?.projects_with_health_issues) || 0;
  const completionPct = Number(data?.portfolio_completion_pct) || 0;
  const portfolioDeadlinesOverdue = Number(data?.portfolio_deadlines_overdue) || 0;

  return (
    <SidebarLayout
      pageTitle="IFRS 15 — Real Estate Portfolio"
      pageSubtitle="Cross-project UAE off-plan analytics"
    >
      <Ifrs15WorkspaceShell activeNavId="realestate-uae">
      <div className="max-w-7xl mx-auto space-y-6 pb-16 p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <Link
              href="/dashboard/ifrs15/realestate"
              className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-orange-primary mb-2"
            >
              <ArrowLeft className="w-4 h-4" /> Back to Project
            </Link>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Building2 className="text-orange-primary" /> Portfolio Analytics
            </h1>
            <p className="text-sm text-text-muted">UAE off-plan — cross-project IFRS 15 view</p>
          </div>
          <Button variant="secondary" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Refresh'}
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3">
          {[
            ['Total Projects', String(totalProjects), 'Off-plan contracts', ''],
            ['Total Contract Value', fmt(Number(data?.total_contract_value_aed)), 'Portfolio value', ''],
            [
              'Revenue Recognised',
              fmt(Number(data?.total_revenue_recognised_aed)),
              `${completionPct}% complete`,
              'progress',
            ],
            ['Deferred Revenue', fmt(Number(data?.total_deferred_revenue_aed)), 'Remaining performance obligations', ''],
            [
              'Escrow Status',
              `${Number(data?.escrow_compliant_count)}/${totalProjects}`,
              'RERA compliant',
              escrowViolations > 0 ? 'violation' : '',
            ],
            [
              'Compliance Alerts',
              String(healthIssues),
              'Projects need attention',
              healthIssues > 0 ? 'amber' : '',
            ],
            [
              'Portfolio Deadlines',
              String(portfolioDeadlinesOverdue),
              'Overdue milestones (all projects)',
              portfolioDeadlinesOverdue > 0 ? 'violation' : '',
            ],
          ].map(([title, val, sub, flag]) => (
            <div
              key={String(title)}
              className={`rounded-lg border p-4 ${
                flag === 'amber' ? 'bg-amber-50 border-amber-200' : 'bg-white border-border-default'
              }`}
            >
              <p className="text-[10px] uppercase text-text-muted">{title}</p>
              <p className="text-xl font-bold mt-1">{val}</p>
              <p className="text-xs text-text-muted mt-1">{sub}</p>
              {flag === 'progress' && (
                <div className="mt-2 h-1.5 bg-slate-200 rounded overflow-hidden">
                  <div className="h-full bg-orange-primary" style={{ width: `${Math.min(100, completionPct)}%` }} />
                </div>
              )}
              {flag === 'violation' && (
                <p className="text-xs font-semibold text-red-700 mt-1">{escrowViolations} VIOLATION(S)</p>
              )}
            </div>
          ))}
        </div>

        {escrowViolations > 0 && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex flex-wrap justify-between gap-2">
            <p className="text-sm text-red-900">
              ⛔ {escrowViolations} project(s) have RERA escrow violations. Immediate action required — UAE Law
              No. 8 of 2007, Art. 8.
            </p>
            <Button size="sm" variant="secondary" onClick={() => setUrlFilter('violations_only', true)}>
              View Projects →
            </Button>
          </div>
        )}
        {oqoodPending > 0 && (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg flex flex-wrap justify-between gap-2">
            <p className="text-sm text-amber-900">
              ⚠️ {oqoodPending} project(s) have pending Oqood amendment filings. Dubai Land Department filings
              overdue.
            </p>
            <Button size="sm" variant="secondary" onClick={() => setOqoodOnly(true)}>
              View Projects →
            </Button>
          </div>
        )}
        {bundlingN > 0 && (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-sm text-amber-900">
              ⚠️ {bundlingN} buyer(s) may require IFRS 15 para 17 contract bundling.
            </p>
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-white border rounded-lg p-4">
            <h3 className="font-semibold mb-4">Projects by Completion Stage</h3>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {barData.map((e) => (
                      <Cell key={e.name} fill={e.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="bg-white border rounded-lg p-4">
            <h3 className="font-semibold mb-4">Portfolio Revenue Recognition</h3>
            <div className="h-56 relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={donutData} dataKey="value" innerRadius={55} outerRadius={80} paddingAngle={2}>
                    {donutData.map((e) => (
                      <Cell key={e.name} fill={e.fill} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => fmt(v)} />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="text-lg font-bold">{completionPct.toFixed(1)}%</span>
              </div>
            </div>
          </div>
        </div>

        <section className="bg-white border rounded-lg p-4">
          <div className="flex flex-wrap justify-between gap-3 mb-4">
            <h3 className="font-semibold">Project Detail</h3>
            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-2 top-2.5 text-text-muted" />
                <input
                  className="pl-8 pr-3 py-2 border rounded text-sm"
                  placeholder="Search project or RERA"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                />
              </div>
              <Button variant="secondary" size="sm" onClick={() => setFiltersOpen((o) => !o)}>
                Filters {filtersOpen ? <ChevronUp className="w-4 h-4 ml-1" /> : <ChevronDown className="w-4 h-4 ml-1" />}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => void exportExcel()} disabled={exportLoading}>
                {exportLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4 mr-1" />}
                Export Excel
              </Button>
            </div>
          </div>

          {filtersOpen && (
            <div className="grid md:grid-cols-4 gap-3 mb-4 p-3 bg-bg-light rounded text-sm">
              <label>
                Developer
                <input className="w-full border rounded px-2 py-1 mt-1" value={developerFilter} onChange={(e) => setDeveloperFilter(e.target.value)} />
              </label>
              <label>
                Min completion %
                <input type="number" className="w-full border rounded px-2 py-1 mt-1" value={minCompletion} onChange={(e) => setMinCompletion(Number(e.target.value))} />
              </label>
              <label>
                Max completion %
                <input type="number" className="w-full border rounded px-2 py-1 mt-1" value={maxCompletion} onChange={(e) => setMaxCompletion(Number(e.target.value))} />
              </label>
              <label>
                Sort by
                <select className="w-full border rounded px-2 py-1 mt-1" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                  <option value="contract_value">Contract Value</option>
                  <option value="completion_pct">Completion %</option>
                  <option value="health_score">Health Score</option>
                  <option value="last_updated">Last Updated</option>
                </select>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={escrowFilter === 'violation'} onChange={(e) => setEscrowFilter(e.target.checked ? 'violation' : 'all')} />
                Escrow violations only
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={healthOnly} onChange={(e) => setHealthOnly(e.target.checked)} />
                Health issues only
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={oqoodOnly} onChange={(e) => setOqoodOnly(e.target.checked)} />
                Oqood pending only
              </label>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-text-muted">
                  <th className="py-2">Project</th>
                  <th>RERA</th>
                  <th>Completion</th>
                  <th>Contract</th>
                  <th>Revenue</th>
                  <th>Deferred</th>
                  <th>Escrow</th>
                  <th>Health</th>
                  <th>Oqood</th>
                  <th>Deadlines</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((p) => {
                  const id = String(p.contract_id);
                  const hs = Number(p.health_score) || 0;
                  const healthClass =
                    hs >= 5 ? 'text-green-700 bg-green-50' : hs >= 3 ? 'text-amber-800 bg-amber-50' : 'text-red-700 bg-red-50';
                  const expanded = expandedId === id;
                  const hc = (p.health_checks as Record<string, unknown>) || {};
                  return (
                    <Fragment key={id}>
                      <tr className="border-b border-border-default">
                        <td className="py-2 font-medium">{String(p.project_name)}</td>
                        <td className="text-xs">{String(p.rera_registration_number)}</td>
                        <td>
                          <div className="flex items-center gap-2 min-w-[100px]">
                            <div className="flex-1 h-1.5 bg-slate-200 rounded">
                              <div className="h-full bg-blue-600 rounded" style={{ width: `${Number(p.completion_pct)}%` }} />
                            </div>
                            <span>{Number(p.completion_pct).toFixed(1)}%</span>
                          </div>
                        </td>
                        <td>{fmt(Number(p.contract_price_aed))}</td>
                        <td>{fmt(Number(p.revenue_recognised_aed))}</td>
                        <td>{fmt(Number(p.deferred_revenue_aed))}</td>
                        <td>
                          {p.escrow_compliance === 'compliant' && <span className="text-green-600">✓</span>}
                          {p.escrow_compliance === 'violation' && <span className="text-red-600">⛔</span>}
                          {p.escrow_compliance === 'unknown' && '—'}
                        </td>
                        <td>
                          <button
                            type="button"
                            className={`px-2 py-0.5 rounded text-xs font-semibold ${healthClass}`}
                            onClick={() => setExpandedId(expanded ? null : id)}
                          >
                            {hs}/5
                          </button>
                        </td>
                        <td>
                          {(() => {
                            const od = Number(p.deadline_overdue) || 0;
                            const ds = Number(p.deadline_due_soon) || 0;
                            if (od === 0 && ds === 0) return <span className="text-xs text-slate-400">—</span>;
                            return (
                              <button
                                type="button"
                                className={`px-2 py-0.5 rounded text-xs font-semibold ${
                                  od > 0 ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-900'
                                }`}
                                onClick={() => setDeadlineDrawer(p)}
                              >
                                {od > 0 ? `${od} overdue` : `${ds} due soon`}
                              </button>
                            );
                          })()}
                        </td>
                        <td>
                          <span
                            className={`px-2 py-0.5 rounded text-xs ${
                              Number(p.pending_oqood_filings) > 0 ? 'bg-amber-100 text-amber-900' : 'bg-slate-100'
                            }`}
                          >
                            {Number(p.pending_oqood_filings)}
                          </span>
                        </td>
                        <td>
                          <div className="flex gap-1">
                            <Button size="sm" variant="secondary" onClick={() => openProject(p)}>
                              Open
                            </Button>
                          </div>
                        </td>
                      </tr>
                      {expanded && (
                        <tr>
                          <td colSpan={10} className="bg-slate-50 p-3">
                            <table className="text-xs w-full max-w-xl">
                              <tbody>
                                {HEALTH_KEYS.map(({ key, label }) => (
                                  <tr key={key}>
                                    <td className="py-1 pr-4">{label}</td>
                                    <td>
                                      {hc[key] === undefined ? '—' : hc[key] ? '✓ Pass' : '✗ Fail'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex justify-center gap-2 mt-4">
              <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Prev
              </Button>
              <span className="text-sm py-1">
                Page {page} / {totalPages}
              </span>
              <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          )}
        </section>

        {deadlineDrawer && (
          <div
            className="fixed inset-y-0 right-0 z-40 w-full max-w-md bg-white shadow-xl border-l p-6 overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-labelledby="deadline-drawer-title"
          >
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 id="deadline-drawer-title" className="font-bold text-lg">
                  {String(deadlineDrawer.project_name)}
                </h3>
                <p className="text-xs text-text-muted">{String(deadlineDrawer.rera_registration_number)}</p>
              </div>
              <button type="button" className="text-sm text-text-muted" onClick={() => setDeadlineDrawer(null)}>
                Close
              </button>
            </div>
            <ul className="text-sm space-y-2">
              {((deadlineDrawer.deadline_milestones as Record<string, unknown>[]) || []).map((m) => (
                <li
                  key={String(m.milestone_id)}
                  className={`border rounded p-2 ${
                    m.status === 'overdue'
                      ? 'bg-red-50 border-red-200'
                      : m.status === 'due_soon'
                        ? 'bg-amber-50 border-amber-200'
                        : 'bg-slate-50'
                  }`}
                >
                  <p className="font-medium text-xs">{String(m.title)}</p>
                  <p className="text-[11px] text-text-muted">
                    {String(m.status)} — {String(m.due_date || m.projected_date || '—')}
                  </p>
                </li>
              ))}
            </ul>
            <Button className="mt-4 w-full" variant="secondary" onClick={() => openProject(deadlineDrawer)}>
              Open in Real Estate module
            </Button>
          </div>
        )}
      </div>
      </Ifrs15WorkspaceShell>
    </SidebarLayout>
  );
}

export default function RealEstatePortfolioPage() {
  return (
    <Suspense
      fallback={
        <SidebarLayout pageTitle="IFRS 15 — Real Estate Portfolio" pageSubtitle="Loading portfolio analytics…">
          <div className="p-8 text-center text-text-muted">Loading portfolio…</div>
        </SidebarLayout>
      }
    >
      <PortfolioPageInner />
    </Suspense>
  );
}
