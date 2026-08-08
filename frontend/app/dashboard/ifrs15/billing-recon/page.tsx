'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from '@/components/Charts';
import {
  CheckCircle2,
  Download,
  GitCompare,
  Loader2,
  Sparkles,
  Upload,
} from 'lucide-react';
import { SidebarLayout } from '@/components/SidebarLayout';
import { Ifrs15WorkspaceShell } from '@/components/ifrs15/Ifrs15WorkspaceShell';
import { Button } from '@/components/Button';
import { ifrs15Api } from '@/lib/api';
import { getCurrentFirmId } from '@/lib/firm-workspace';

type TabId = 'summary' | 'exceptions' | 'upload';

type ReconResult = {
  id: string;
  contract_id?: string | null;
  contract_type?: string;
  period?: string;
  billing_total?: number;
  gl_revenue_total?: number;
  gl_deferred_total?: number;
  gl_receivable_total?: number;
  variance?: number;
  variance_pct?: number;
  status?: string;
  exceptions?: Array<{ type?: string; description?: string; amount?: number; action?: string }>;
  ai_commentary?: string;
  recon_run_at?: string;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
};

type FlatException = {
  contract_id?: string | null;
  contract_type?: string;
  period?: string;
  amount?: number;
  exception?: { type?: string; description?: string; amount?: number; action?: string };
};

function aed(n: number | undefined | null): string {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return `AED ${Number(n).toLocaleString('en-AE', { maximumFractionDigits: 2 })}`;
}

function statusClass(status?: string): string {
  switch (status) {
    case 'clean':
      return 'bg-green-100 text-green-800';
    case 'variance':
      return 'bg-red-100 text-red-800';
    case 'missing_gl':
      return 'bg-orange-100 text-orange-800';
    case 'missing_billing':
      return 'bg-yellow-100 text-yellow-800';
    case 'exception':
      return 'bg-purple-100 text-purple-800';
    default:
      return 'bg-gray-100 text-gray-600';
  }
}

function exceptionClass(type?: string): string {
  switch (type) {
    case 'variance':
      return 'bg-red-100 text-red-700';
    case 'missing_gl':
      return 'bg-orange-100 text-orange-700';
    case 'missing_billing':
      return 'bg-yellow-100 text-yellow-700';
    case 'escrow_mismatch':
      return 'bg-purple-100 text-purple-700';
    case 'deferred_not_reversed':
      return 'bg-amber-100 text-amber-700';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

function typeLabel(t?: string): string {
  if (t === 'uae_real_estate') return 'UAE Real Estate';
  if (t === 'saas_subscription') return 'B2B SaaS';
  return t || '—';
}

function parseCsvFile(file: File): Promise<Record<string, unknown>[]> {
  return file.arrayBuffer().then((buf) => {
    const wb = XLSX.read(buf, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  });
}

function downloadTemplate(filename: string, headers: string[], rows: string[][]) {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Template');
  XLSX.writeFile(wb, filename);
}

export default function BillingGlReconPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const period = `${year}-${String(month).padStart(2, '0')}`;
  const [tab, setTab] = useState<TabId>('summary');
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<ReconResult[]>([]);
  const [trend, setTrend] = useState<ReconResult[]>([]);
  const [exceptions, setExceptions] = useState<FlatException[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [reviewName, setReviewName] = useState('');
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const [billingPreview, setBillingPreview] = useState<Record<string, unknown>[]>([]);
  const [glPreview, setGlPreview] = useState<Record<string, unknown>[]>([]);
  const [importingBilling, setImportingBilling] = useState(false);
  const [importingGl, setImportingGl] = useState(false);

  const companyId = typeof window !== 'undefined' ? getCurrentFirmId() : 'default';

  const load = useCallback(async () => {
    setLoading(true);
    const [res, exc] = await Promise.all([
      ifrs15Api.billingReconResults({ company_id: companyId, period }),
      ifrs15Api.billingReconExceptions({ company_id: companyId, period }),
    ]);
    if (res.error) toast.error(res.error);
    if (exc.error) toast.error(exc.error);
    setResults(((res.data?.results || []) as ReconResult[]));
    setExceptions(((exc.data?.exceptions || []) as FlatException[]));

    const months: string[] = [];
    for (let i = 5; i >= 0; i -= 1) {
      const d = new Date(year, month - 1 - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    const trendRows: ReconResult[] = [];
    for (const p of months) {
      const tr = await ifrs15Api.billingReconResults({ company_id: companyId, period: p });
      const rows = (tr.data?.results || []) as ReconResult[];
      const variance = rows.reduce((s, r) => s + Number(r.variance || 0), 0);
      trendRows.push({ period: p, variance });
    }
    setTrend(trendRows);
    setLoading(false);
  }, [companyId, period, year, month]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    if (!results.length) {
      return { billing: null as number | null, revenue: null as number | null, deferred: null as number | null, variance: null as number | null };
    }
    return {
      billing: results.reduce((s, r) => s + Number(r.billing_total || 0), 0),
      revenue: results.reduce((s, r) => s + Number(r.gl_revenue_total || 0), 0),
      deferred: results.reduce((s, r) => s + Number(r.gl_deferred_total || 0), 0),
      variance: results.reduce((s, r) => s + Number(r.variance || 0), 0),
    };
  }, [results]);

  const runRecon = async () => {
    setRunning(true);
    const { data, error } = await ifrs15Api.billingReconRun({ company_id: companyId, period });
    setRunning(false);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success(`Reconciliation complete (${data?.count || 0} result${(data?.count || 0) === 1 ? '' : 's'})`);
    await load();
    setTab('summary');
  };

  const markReviewed = async (id: string) => {
    if (!reviewName.trim()) {
      toast.error('Enter reviewer name');
      return;
    }
    const { error } = await ifrs15Api.billingReconReview(id, reviewName.trim());
    if (error) {
      toast.error(error);
      return;
    }
    toast.success('Marked as reviewed');
    setReviewingId(null);
    await load();
  };

  const onBillingFile = async (file: File) => {
    try {
      const rows = await parseCsvFile(file);
      setBillingPreview(rows);
    } catch {
      toast.error('Could not parse billing CSV');
    }
  };

  const onGlFile = async (file: File) => {
    try {
      const rows = await parseCsvFile(file);
      setGlPreview(rows);
    } catch {
      toast.error('Could not parse GL CSV');
    }
  };

  const importBilling = async () => {
    if (!billingPreview.length) return;
    setImportingBilling(true);
    const { data, error } = await ifrs15Api.billingReconUploadBilling({
      company_id: companyId,
      rows: billingPreview,
    });
    setImportingBilling(false);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success(`${data?.imported || 0} rows imported successfully`);
    if (data?.errors?.length) toast.error(data.errors.slice(0, 3).join(' · '));
  };

  const importGl = async () => {
    if (!glPreview.length) return;
    setImportingGl(true);
    const { data, error } = await ifrs15Api.billingReconUploadGl({
      company_id: companyId,
      rows: glPreview,
    });
    setImportingGl(false);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success(`${data?.imported || 0} rows imported successfully`);
    if (data?.errors?.length) toast.error(data.errors.slice(0, 3).join(' · '));
  };

  const kpiItems = [
    { label: 'Billing Total', value: loading ? '—' : aed(totals.billing), accent: 'orange' as const },
    { label: 'GL Revenue', value: loading ? '—' : aed(totals.revenue), accent: 'orange' as const },
    { label: 'GL Deferred', value: loading ? '—' : aed(totals.deferred), accent: 'orange' as const },
    {
      label: 'Variance',
      value: loading ? '—' : aed(totals.variance),
      accent: totals.variance && Math.abs(totals.variance) > 0 ? ('pink' as const) : ('orange' as const),
    },
  ];

  return (
    <SidebarLayout
      pageTitle="Billing-to-GL Reconciliation"
      pageSubtitle="IFRS 15 · Reconcile billing reality to your books"
    >
      <Ifrs15WorkspaceShell activeNavId="billing-recon" kpiItems={kpiItems}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-[#1e293b] flex items-center gap-2">
              <GitCompare className="w-5 h-5 text-[#f97316]" />
              Billing-to-GL Reconciliation
            </h1>
            <p className="text-sm text-[#64748b]">IFRS 15 · Reconcile billing reality to your books</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="text-xs border border-[#e2e8f0] rounded-md px-2 py-1.5 bg-white"
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
            >
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {format(new Date(2000, i, 1), 'MMM')}
                </option>
              ))}
            </select>
            <select
              className="text-xs border border-[#e2e8f0] rounded-md px-2 py-1.5 bg-white"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            >
              {[2024, 2025, 2026, 2027].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <Button size="sm" onClick={() => void runRecon()} disabled={running}>
              {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              Run Reconciliation
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: 'Billing Total AED', value: totals.billing },
            { label: 'GL Revenue AED', value: totals.revenue },
            { label: 'GL Deferred AED', value: totals.deferred },
            { label: 'Variance AED', value: totals.variance, variance: true },
          ].map((c) => {
            const hasVar = c.variance && c.value != null && Math.abs(Number(c.value)) > 0;
            return (
              <div
                key={c.label}
                className={`rounded-lg border p-3 ${
                  c.variance
                    ? hasVar
                      ? 'bg-red-50 border-red-200'
                      : 'bg-green-50 border-green-200'
                    : 'bg-white border-[#e2e8f0]'
                }`}
              >
                <p className="text-[10px] uppercase font-semibold text-[#64748b]">{c.label}</p>
                <p className="text-base font-bold text-[#1e293b] mt-0.5">
                  {loading ? '—' : aed(c.value)}
                </p>
              </div>
            );
          })}
        </div>

        <div className="flex gap-1 border-b border-[#e2e8f0]">
          {([
            ['summary', 'Summary'],
            ['exceptions', 'Exceptions'],
            ['upload', 'Upload Data'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`px-3 py-2 text-xs font-semibold border-b-2 ${
                tab === id ? 'border-[#f97316] text-[#f97316]' : 'border-transparent text-[#64748b]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'summary' && (
          <div className="bg-white border border-[#e2e8f0] rounded-lg overflow-hidden">
            {results.length === 0 ? (
              <p className="p-8 text-sm text-center text-[#64748b]">
                No reconciliation data for this period. Upload billing and GL data, then run reconciliation.
              </p>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-[#f8fafc] text-[#64748b] uppercase">
                  <tr>
                    <th className="text-left px-3 py-2">Contract</th>
                    <th className="text-left px-3 py-2">Type</th>
                    <th className="text-right px-3 py-2">Billing (AED)</th>
                    <th className="text-right px-3 py-2">GL Revenue</th>
                    <th className="text-right px-3 py-2">GL Deferred</th>
                    <th className="text-right px-3 py-2">Variance</th>
                    <th className="text-left px-3 py-2">Status</th>
                    <th className="text-left px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => {
                    const id = String(r.id);
                    const open = expanded === id;
                    return (
                      <FragmentRow
                        key={id}
                        result={r}
                        open={open}
                        onToggle={() => setExpanded(open ? null : id)}
                        reviewingId={reviewingId}
                        reviewName={reviewName}
                        setReviewName={setReviewName}
                        setReviewingId={setReviewingId}
                        onReview={() => void markReviewed(id)}
                      />
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {tab === 'exceptions' && (
          <div className="bg-white border border-[#e2e8f0] rounded-lg overflow-hidden">
            {exceptions.length === 0 ? (
              <div className="m-4 rounded-lg bg-green-50 border border-green-200 text-green-800 text-sm px-4 py-3">
                No exceptions for this period ✓
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-[#f8fafc] text-[#64748b] uppercase">
                  <tr>
                    <th className="text-left px-3 py-2">Exception Type</th>
                    <th className="text-left px-3 py-2">Contract</th>
                    <th className="text-left px-3 py-2">Period</th>
                    <th className="text-right px-3 py-2">Amount (AED)</th>
                    <th className="text-left px-3 py-2">Description</th>
                    <th className="text-left px-3 py-2">Recommended Action</th>
                  </tr>
                </thead>
                <tbody>
                  {exceptions.map((row, i) => {
                    const ex = row.exception || {};
                    return (
                      <tr key={`${row.period}-${i}`} className="border-t border-[#f1f5f9]">
                        <td className="px-3 py-2">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${exceptionClass(ex.type)}`}>
                            {ex.type || '—'}
                          </span>
                        </td>
                        <td className="px-3 py-2">{row.contract_id || typeLabel(row.contract_type)}</td>
                        <td className="px-3 py-2">{row.period}</td>
                        <td className="px-3 py-2 text-right font-mono">{aed(Number(ex.amount ?? row.amount ?? 0))}</td>
                        <td className="px-3 py-2">{ex.description}</td>
                        <td className="px-3 py-2 text-[#64748b]">{ex.action}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {tab === 'upload' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <UploadCard
                title="Upload Billing Transactions"
                preview={billingPreview}
                importing={importingBilling}
                onFile={onBillingFile}
                onImport={() => void importBilling()}
                onTemplate={() =>
                  downloadTemplate(
                    'billing_template.csv',
                    [
                      'transaction_ref',
                      'transaction_type',
                      'billing_date',
                      'amount',
                      'currency',
                      'contract_type',
                      'milestone_ref',
                      'customer_id',
                      'billing_system',
                      'external_ref',
                    ],
                    [
                      [
                        'INV-2026-001',
                        'invoice',
                        '2026-06-15',
                        '750000',
                        'AED',
                        'uae_real_estate',
                        '30_percent',
                        'CUST-001',
                        'manual',
                        'ESCROW-REL-001',
                      ],
                      [
                        'INV-2026-002',
                        'invoice',
                        '2026-06-01',
                        '1000',
                        'AED',
                        'saas_subscription',
                        '',
                        'CUST-002',
                        'stripe',
                        'ch_abc123',
                      ],
                    ]
                  )
                }
              />
              <UploadCard
                title="Upload GL Postings"
                preview={glPreview}
                importing={importingGl}
                onFile={onGlFile}
                onImport={() => void importGl()}
                legend={
                  <ul className="text-[10px] text-[#64748b] mt-2 space-y-0.5">
                    <li>4000-4999 → Revenue</li>
                    <li>2300-2399 → Deferred Revenue</li>
                    <li>1500-1599 → Contract Asset</li>
                    <li>1200-1299 → Accounts Receivable</li>
                    <li>1000-1099 → Cash</li>
                  </ul>
                }
                onTemplate={() =>
                  downloadTemplate(
                    'gl_template.csv',
                    ['posting_date', 'account_code', 'account_name', 'debit', 'credit', 'journal_ref', 'period', 'contract_id'],
                    [['2026-06-15', '4001', 'Revenue', '0', '750000', 'JE-RE-001', '2026-06', '']]
                  )
                }
              />
            </div>
            <div className="bg-white border border-[#e2e8f0] rounded-lg p-4">
              <h3 className="text-sm font-semibold text-[#1e293b] mb-3">Variance Trend (Last 6 Months)</h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={trend.map((t) => ({ month: t.period, variance: Number(t.variance || 0) }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="variance">
                    {trend.map((t, i) => (
                      <Cell key={i} fill={Number(t.variance || 0) === 0 ? '#16a34a' : '#dc2626'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </Ifrs15WorkspaceShell>
    </SidebarLayout>
  );
}

function FragmentRow({
  result: r,
  open,
  onToggle,
  reviewingId,
  reviewName,
  setReviewName,
  setReviewingId,
  onReview,
}: {
  result: ReconResult;
  open: boolean;
  onToggle: () => void;
  reviewingId: string | null;
  reviewName: string;
  setReviewName: (v: string) => void;
  setReviewingId: (v: string | null) => void;
  onReview: () => void;
}) {
  const id = String(r.id);
  return (
    <>
      <tr className="border-t border-[#f1f5f9] hover:bg-[#f8fafc] cursor-pointer" onClick={onToggle}>
        <td className="px-3 py-2 font-medium">{r.contract_id || 'Portfolio'}</td>
        <td className="px-3 py-2">{typeLabel(r.contract_type)}</td>
        <td className="px-3 py-2 text-right font-mono">{aed(Number(r.billing_total || 0))}</td>
        <td className="px-3 py-2 text-right font-mono">{aed(Number(r.gl_revenue_total || 0))}</td>
        <td className="px-3 py-2 text-right font-mono">{aed(Number(r.gl_deferred_total || 0))}</td>
        <td className="px-3 py-2 text-right font-mono">{aed(Number(r.variance || 0))}</td>
        <td className="px-3 py-2">
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${statusClass(r.status)}`}>
            {r.status || 'pending'}
          </span>
        </td>
        <td className="px-3 py-2 text-[#f97316]">{open ? 'Hide' : 'View'}</td>
      </tr>
      {open ? (
        <tr className="border-t border-[#f1f5f9] bg-[#fafafa]">
          <td colSpan={8} className="px-4 py-3 space-y-3">
            <div className="bg-blue-50 border-l-4 border-blue-400 rounded-r-md px-3 py-2">
              <p className="text-[10px] font-semibold text-blue-800 flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5" /> AI Analysis
                {r.recon_run_at ? (
                  <span className="font-normal text-blue-600 ml-2">
                    {format(new Date(r.recon_run_at), 'dd MMM yyyy')}
                  </span>
                ) : null}
              </p>
              <p className="text-xs text-[#1e293b] mt-1">{r.ai_commentary || 'No commentary yet.'}</p>
            </div>
            {(r.exceptions || []).length > 0 ? (
              <ul className="text-xs space-y-1">
                {(r.exceptions || []).map((ex, i) => (
                  <li key={i}>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold mr-1 ${exceptionClass(ex.type)}`}>
                      {ex.type}
                    </span>
                    {ex.description} — <span className="text-[#64748b]">{ex.action}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {r.reviewed_by ? (
              <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> Reviewed ✓ {r.reviewed_by}
              </span>
            ) : reviewingId === id ? (
              <div className="flex flex-wrap gap-2 items-center" onClick={(e) => e.stopPropagation()}>
                <input
                  className="text-xs border rounded px-2 py-1"
                  placeholder="Reviewer name"
                  value={reviewName}
                  onChange={(e) => setReviewName(e.target.value)}
                />
                <Button size="sm" onClick={onReview}>
                  Confirm
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                onClick={(e) => {
                  e.stopPropagation();
                  setReviewingId(id);
                }}
              >
                Mark Reviewed
              </Button>
            )}
          </td>
        </tr>
      ) : null}
    </>
  );
}

function UploadCard({
  title,
  preview,
  importing,
  onFile,
  onImport,
  onTemplate,
  legend,
}: {
  title: string;
  preview: Record<string, unknown>[];
  importing: boolean;
  onFile: (file: File) => void;
  onImport: () => void;
  onTemplate: () => void;
  legend?: ReactNode;
}) {
  return (
    <div className="bg-white border border-[#e2e8f0] rounded-lg p-4">
      <h3 className="text-sm font-semibold text-[#1e293b] mb-2">{title}</h3>
      <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-[#e2e8f0] rounded-lg px-4 py-8 text-xs text-[#64748b] cursor-pointer hover:bg-[#f8fafc]">
        <Upload className="w-5 h-5" />
        Drag & drop CSV or click to browse
        <input
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
          }}
        />
      </label>
      <div className="flex gap-2 mt-3">
        <Button size="sm" variant="secondary" onClick={onTemplate}>
          <Download className="w-3.5 h-3.5" /> Sample CSV
        </Button>
        <Button size="sm" onClick={onImport} disabled={!preview.length || importing}>
          {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
          Import
        </Button>
      </div>
      {legend}
      {preview.length > 0 ? (
        <div className="mt-3 overflow-x-auto">
          <p className="text-[10px] text-[#64748b] mb-1">Preview (first 5 rows)</p>
          <table className="w-full text-[10px]">
            <thead>
              <tr>
                {Object.keys(preview[0]).slice(0, 6).map((k) => (
                  <th key={k} className="text-left pr-2 py-1 text-[#64748b]">
                    {k}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.slice(0, 5).map((row, i) => (
                <tr key={i} className="border-t border-[#f1f5f9]">
                  {Object.keys(preview[0]).slice(0, 6).map((k) => (
                    <td key={k} className="pr-2 py-1 truncate max-w-[90px]">
                      {String(row[k] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
