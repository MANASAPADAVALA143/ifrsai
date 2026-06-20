'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { SidebarLayout } from '@/components/SidebarLayout';
import { Button } from '@/components/Button';
import {
  ChevronRight,
  Calculator,
  Save,
  Download,
  Trash2,
  Upload,
  Loader2,
  FileText,
  BarChart3,
  AlertTriangle,
  TrendingUp,
  CheckCircle,
  Copy,
} from 'lucide-react';
import { ifrs9Api } from '@/lib/api';
import {
  getEclPortfolioById,
  saveToEclPortfolioRepository,
  deleteEclPortfolioFromRepository,
  createBlankEclPortfolio,
  fetchEclPortfolioById,
  type ECLPortfolioEntry,
  type AssetClass,
  type CounterpartyType,
  type AgeingBucket,
  type ProvisionMatrixRow,
} from '@/lib/ecl-portfolio-repository';
import { formatIndianCurrency } from '@/lib/utils';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { CalculateStepper } from '@/components/module/CalculateStepper';
import {
  IFRS9_PORTFOLIO_STEPS,
  ifrs9PortfolioTabToStep,
  ifrs9PortfolioStepToTab,
  type Ifrs9PortfolioTabId,
} from '@/lib/ifrs9-nav';

const TAB_IDS = ['instrument', 'classification', 'staging', 'ecl', 'scenario', 'results'] as const;

const ASSET_CLASSES: AssetClass[] = [
  'Trade Receivables',
  'Loans & Advances',
  'Bonds & Securities',
  'Financial Guarantees',
  'Lease Receivables',
  'Intercompany',
  'Other',
];
const COUNTERPARTY_TYPES: CounterpartyType[] = ['Corporate', 'SME', 'Retail', 'Sovereign', 'Bank', 'Other'];
const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD'];

const inputClass =
  'w-full px-4 py-2.5 bg-white border border-[#e2e8f0] rounded-lg focus:ring-2 focus:ring-[#f97316]/30 focus:border-[#f97316] text-[#1e293b] font-mono';
const labelClass = 'block text-xs font-medium text-[#64748b] uppercase tracking-wide mb-1.5';

function coerceChartNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  if (typeof value === 'string' && value !== '') {
    const n = Number(value);
    return Number.isNaN(n) ? undefined : n;
  }
  if (Array.isArray(value) && value.length > 0) return coerceChartNumber(value[0]);
  return undefined;
}

function formatScenarioTooltip(value: unknown, name?: unknown): [string, string] {
  const n = coerceChartNumber(value);
  const v = n !== undefined ? `$${n.toLocaleString()}` : '';
  const nm = typeof name === 'string' ? name : name != null ? String(name) : 'ECL';
  return [v, nm];
}

function StageBadge({ stage }: { stage: 1 | 2 | 3 }) {
  const labels = { 1: 'Stage 1 — 12M ECL', 2: 'Stage 2 — Lifetime ECL', 3: 'Stage 3 — Credit Impaired' };
  const cls =
    stage === 1 ? 'bg-[#3b82f6]/15 text-[#3b82f6]' : stage === 2 ? 'bg-[#f59e0b]/15 text-[#f59e0b]' : 'bg-[#ef4444]/15 text-[#ef4444]';
  return <span className={`px-2 py-1 rounded-full text-xs font-semibold ${cls}`}>{labels[stage]}</span>;
}

export default function PortfolioDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = typeof params?.id === 'string' ? params.id : '';
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [portfolio, setPortfolio] = useState<ECLPortfolioEntry | null>(null);
  const [activeTab, setActiveTab] = useState<(typeof TAB_IDS)[number]>('instrument');
  const [uploading, setUploading] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingPortfolio, setLoadingPortfolio] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      setLoadingPortfolio(true);
      if (id === 'new') {
        setPortfolio(createBlankEclPortfolio());
        setLoadingPortfolio(false);
        return;
      }
      if (!id) {
        setPortfolio(null);
        setLoadingPortfolio(false);
        return;
      }
      const cached = getEclPortfolioById(id);
      if (cached) {
        setPortfolio(JSON.parse(JSON.stringify(cached)));
      }
      const remote = await fetchEclPortfolioById(id);
      if (cancelled) return;
      if (remote) {
        setPortfolio(JSON.parse(JSON.stringify(remote)));
      } else if (!cached) {
        setPortfolio(null);
      }
      setLoadingPortfolio(false);
    };
    void init();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const update = useCallback((patch: Partial<ECLPortfolioEntry>) => {
    setPortfolio((p) => (p ? { ...p, ...patch } : null));
  }, []);

  const handleUpload = useCallback(
    async (file: File) => {
      if (!portfolio) return;
      setUploading(true);
      try {
        const res = await ifrs9Api.uploadPortfolio(file);
        if (res.error || !res.data?.extracted_data) {
          toast.error(res.error || 'Upload failed');
          return;
        }
        const data = res.data.extracted_data as { rows?: any[]; columns?: string[] };
        const rows = data.rows || [];
        const cols = (data.columns || []).map((c: string) => c.toLowerCase());
        const getCol = (key: string) => {
          const i = cols.findIndex((c: string) => c.includes(key));
          return i >= 0 && rows[0] ? rows[0][cols[i]] : null;
        };
        const amount = (v: any) => (typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.-]/g, '')) || 0);
        update({
          counterpartyName: getCol('counterparty') ?? getCol('name') ?? portfolio.counterpartyName,
          outstandingBalance: amount(getCol('outstanding') ?? getCol('balance') ?? getCol('amount')) || portfolio.outstandingBalance,
          grossCarryingAmount: amount(getCol('gross') ?? getCol('outstanding')) || portfolio.grossCarryingAmount,
          ead: amount(getCol('ead') ?? getCol('outstanding')) || portfolio.ead,
        });
        toast.success('Data extracted. Review Instrument Details and ECL tabs.');
      } finally {
        setUploading(false);
      }
    },
    [portfolio, update]
  );

  const handleCalculate = useCallback(async () => {
    if (!portfolio) return;
    const ead = portfolio.ead || portfolio.outstandingBalance || portfolio.grossCarryingAmount || 0;
    if (ead <= 0 && !portfolio.useProvisionMatrix) {
      toast.error('Set EAD or Outstanding Balance (or use Provision Matrix)');
      return;
    }
    setCalculating(true);
    try {
      const ageingBuckets =
        portfolio.useProvisionMatrix && portfolio.provisionMatrix
          ? portfolio.provisionMatrix.map((r) => ({ bucket: r.bucket, amount: r.grossAmount, rate: r.eclRate }))
          : undefined;
      const payload = {
        portfolio_id: portfolio.portfolioId || portfolio.id,
        portfolio_name: portfolio.name || portfolio.portfolioId || portfolio.id,
        reporting_date: portfolio.reportingDate,
        previous_ecl: portfolio.applicableEcl ?? 0,
        approach: portfolio.useProvisionMatrix ? 'simplified' : 'general',
        stage: portfolio.stage || 1,
        pd_12m: portfolio.pd12m ?? 1,
        pd_lifetime: portfolio.pdLifetime ?? 5,
        lgd: portfolio.lgd ?? 45,
        ead,
        ageing_buckets: ageingBuckets,
        scenarios: portfolio.scenarios
          ? {
              base_weight: portfolio.scenarios.base?.weight ?? 50,
              optimistic_weight: portfolio.scenarios.optimistic?.weight ?? 30,
              pessimistic_weight: portfolio.scenarios.pessimistic?.weight ?? 20,
              base_ecl: portfolio.scenarios.base?.ecl,
              optimistic_ecl: portfolio.scenarios.optimistic?.ecl,
              pessimistic_ecl: portfolio.scenarios.pessimistic?.ecl,
              base_macro: {
                gdp_growth: portfolio.scenarios.base?.gdp,
                unemployment: portfolio.scenarios.base?.unemployment,
                interest_rate: portfolio.scenarios.base?.interestRate,
              },
              optimistic_macro: {
                gdp_growth: portfolio.scenarios.optimistic?.gdp,
                unemployment: portfolio.scenarios.optimistic?.unemployment,
                interest_rate: portfolio.scenarios.optimistic?.interestRate,
              },
              pessimistic_macro: {
                gdp_growth: portfolio.scenarios.pessimistic?.gdp,
                unemployment: portfolio.scenarios.pessimistic?.unemployment,
                interest_rate: portfolio.scenarios.pessimistic?.interestRate,
              },
            }
          : undefined,
      };
      const res = await ifrs9Api.calculate(payload);
      if (res.error || !res.data) {
        toast.error(res.error || 'Calculation failed');
        return;
      }
      const d = res.data;
      console.log('IFRS9 API RESPONSE:', JSON.stringify(d, null, 2));
      const notes =
        typeof d.disclosure_notes === 'string'
          ? d.disclosure_notes
          : d.disclosure_notes != null
            ? JSON.stringify(d.disclosure_notes)
            : undefined;
      const patch: Partial<ECLPortfolioEntry> = {
        ecl12m: d.ecl_12m ?? undefined,
        eclLifetime: d.ecl_lifetime ?? undefined,
        applicableEcl: d.applicable_ecl as number | undefined,
        coverageRatio: d.coverage_ratio as number | undefined,
        scenarioResults: d.scenario_results as ECLPortfolioEntry['scenarioResults'],
        journalEntries: d.journal_entries as ECLPortfolioEntry['journalEntries'],
        disclosureNotes: notes,
      };
      let next: ECLPortfolioEntry = { ...portfolio, ...patch };
      if (portfolio.provisionMatrix && d.bucket_results?.length) {
        next = {
          ...next,
          provisionMatrix: portfolio.provisionMatrix.map((row, i) => {
            const b = d.bucket_results?.[i];
            return b ? { ...row, eclAmount: Number(b.ecl ?? row.eclAmount ?? 0) } : row;
          }),
        };
      }
      saveToEclPortfolioRepository(next);
      setPortfolio(next);
      toast.success('ECL calculated and saved to portfolio');
    } finally {
      setCalculating(false);
    }
  }, [portfolio]);

  const handleSave = useCallback(() => {
    if (!portfolio) return;
    setSaving(true);
    saveToEclPortfolioRepository(portfolio);
    setSaving(false);
    toast.success('Saved');
  }, [portfolio]);

  const handleDelete = useCallback(() => {
    if (!confirm('Delete this portfolio?')) return;
    deleteEclPortfolioFromRepository(id);
    toast.success('Deleted');
    router.push('/dashboard/ifrs9/portfolios');
  }, [id, router]);

  const handleDownloadReport = useCallback(async () => {
    if (portfolio == null || (portfolio.applicableEcl == null && !portfolio.useProvisionMatrix)) {
      toast.error('Calculate ECL first');
      return;
    }
    const res = await ifrs9Api.downloadReportPost({
      applicable_ecl: portfolio.applicableEcl,
      coverage_ratio: portfolio.coverageRatio,
      bucket_results: portfolio.provisionMatrix?.map((r) => ({ bucket: r.bucket, amount: r.grossAmount, rate_pct: r.eclRate, ecl: r.eclAmount })),
      journal_entries: portfolio.journalEntries,
    });
    if (res.error || !res.data?.file_id) {
      toast.error(res.error || 'Download failed');
      return;
    }
    window.open(ifrs9Api.downloadReport(res.data.file_id), '_blank');
    toast.success('Report download started');
  }, [portfolio]);

  if (loadingPortfolio) {
    return (
      <SidebarLayout pageTitle="Portfolio" pageSubtitle="Loading">
        <div className="flex items-center justify-center min-h-[40vh]">
          <Loader2 className="w-8 h-8 animate-spin text-[#f97316]" />
        </div>
      </SidebarLayout>
    );
  }

  if (!portfolio && id !== 'new') {
    return (
      <SidebarLayout pageTitle="Portfolio" pageSubtitle="Not found">
        <p className="text-[#64748b]">Portfolio not found.</p>
        <Link href="/dashboard/ifrs9/portfolios">Back to list</Link>
      </SidebarLayout>
    );
  }

  const p = portfolio!;
  const gross = p.grossCarryingAmount || p.outstandingBalance || p.ead || 0;
  const totalAgeing = p.ageingBuckets?.reduce((s, b) => s + b.amount, 0) || 0;
  const provisionTotal = p.useProvisionMatrix && p.provisionMatrix ? p.provisionMatrix.reduce((s, r) => s + (r.eclAmount || r.grossAmount * (r.eclRate / 100)), 0) : 0;

  return (
    <SidebarLayout
      pageTitle={`${p.portfolioId} — ${p.assetClass || 'ECL Portfolio'}`}
      pageSubtitle="Edit portfolio and calculate ECL"
    >
      {/* Sticky header */}
      <div className="sticky top-0 z-30 -mx-7 -mt-2 px-7 py-3 bg-[#f5f6fa] border-b border-[#e2e8f0] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-[#64748b]">
          <Link href="/dashboard/ifrs9" className="hover:text-[#f97316]">
            IFRS 9
          </Link>
          <ChevronRight className="w-4 h-4" />
          <Link href="/dashboard/ifrs9/portfolios" className="hover:text-[#f97316]">
            Portfolios
          </Link>
          <ChevronRight className="w-4 h-4" />
          <span className="text-[#1e293b] font-medium">{p.portfolioId}</span>
        </div>
        <div className="flex items-center gap-2">
          <StageBadge stage={p.stage || 1} />
          <span className="px-2 py-1 rounded-full text-xs font-medium bg-[#e2e8f0] text-[#64748b]">{p.status || 'Draft'}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={handleCalculate} disabled={calculating} className="bg-[#f97316] hover:bg-[#ea580c] text-white">
            {calculating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />}
            Calculate ECL
          </Button>
          <Button variant="secondary" onClick={handleSave} disabled={saving}>
            <Save className="w-4 h-4 mr-1" /> Save
          </Button>
          <Button variant="secondary" onClick={handleDownloadReport}>
            <Download className="w-4 h-4 mr-1" /> Download
          </Button>
          <Button variant="secondary" onClick={handleDelete} className="text-red-600 hover:bg-red-50">
            <Trash2 className="w-4 h-4" /> Delete
          </Button>
        </div>
      </div>

      {/* AI Upload bar */}
      <div className="mt-4 p-4 bg-white rounded-[14px] border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
        <p className="text-sm text-[#64748b] mb-2">
          Upload debtor ageing report, loan schedule, or financial instrument data for extraction
        </p>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUpload(f);
              e.target.value = '';
            }}
          />
          <Button variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {uploading ? 'Uploading...' : 'Upload Excel / CSV'}
          </Button>
        </div>
      </div>

      {/* Portfolio workflow stepper */}
      <CalculateStepper
        steps={IFRS9_PORTFOLIO_STEPS}
        currentStep={ifrs9PortfolioTabToStep(activeTab as Ifrs9PortfolioTabId)}
        onStepChange={(step) => setActiveTab(ifrs9PortfolioStepToTab(step))}
        maxReachableStep={portfolio?.applicableEcl != null ? 6 : portfolio?.name ? 4 : 1}
      />

      {/* Tab content */}
      <div className="mt-6 bg-white rounded-[14px] p-6 border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
        {activeTab === 'instrument' && (
          <>
            <h3 className="text-base font-bold text-[#1e293b] mb-4">Basic Information</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <div>
                <label className={labelClass}>Portfolio ID</label>
                <input className={inputClass} value={p.portfolioId} readOnly disabled />
              </div>
              <div>
                <label className={labelClass}>Portfolio Name</label>
                <input className={inputClass} value={p.name} onChange={(e) => update({ name: e.target.value })} placeholder="Name" />
              </div>
              <div>
                <label className={labelClass}>Asset Class</label>
                <select className={inputClass} value={p.assetClass} onChange={(e) => update({ assetClass: e.target.value as AssetClass })}>
                  {ASSET_CLASSES.map((ac) => (
                    <option key={ac} value={ac}>{ac}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Currency</label>
                <select className={inputClass} value={p.currency} onChange={(e) => update({ currency: e.target.value })}>
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Counterparty Name</label>
                <input className={inputClass} value={p.counterpartyName} onChange={(e) => update({ counterpartyName: e.target.value })} />
              </div>
              <div>
                <label className={labelClass}>Counterparty Type</label>
                <select className={inputClass} value={p.counterpartyType} onChange={(e) => update({ counterpartyType: e.target.value as CounterpartyType })}>
                  {COUNTERPARTY_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Industry Sector</label>
                <input className={inputClass} value={p.industrySector} onChange={(e) => update({ industrySector: e.target.value })} />
              </div>
              <div>
                <label className={labelClass}>Country</label>
                <input className={inputClass} value={p.country} onChange={(e) => update({ country: e.target.value })} />
              </div>
              <div>
                <label className={labelClass}>Origination Date</label>
                <input type="date" className={inputClass} value={p.originationDate} onChange={(e) => update({ originationDate: e.target.value })} />
              </div>
              <div>
                <label className={labelClass}>Maturity Date</label>
                <input type="date" className={inputClass} value={p.maturityDate} onChange={(e) => update({ maturityDate: e.target.value })} />
              </div>
              <div>
                <label className={labelClass}>Reporting Date</label>
                <input type="date" className={inputClass} value={p.reportingDate} onChange={(e) => update({ reportingDate: e.target.value })} />
              </div>
              <div>
                <label className={labelClass}>Last Review Date</label>
                <input type="date" className={inputClass} value={p.lastReviewDate} onChange={(e) => update({ lastReviewDate: e.target.value })} />
              </div>
            </div>
            <h3 className="text-base font-bold text-[#1e293b] mb-4">Exposure Details</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              {[
                { key: 'grossCarryingAmount' as const, label: 'Gross Carrying Amount' },
                { key: 'amortisedCost' as const, label: 'Amortised Cost' },
                { key: 'fairValue' as const, label: 'Fair Value' },
                { key: 'notionalAmount' as const, label: 'Notional Amount' },
                { key: 'outstandingBalance' as const, label: 'Outstanding Balance' },
                { key: 'undrawnCommitment' as const, label: 'Undrawn Commitment' },
                { key: 'accruedInterest' as const, label: 'Accrued Interest' },
                { key: 'collateralValue' as const, label: 'Collateral Value' },
              ].map(({ key, label }) => (
                <div key={key}>
                  <label className={labelClass}>{label}</label>
                  <input
                    type="number"
                    className={inputClass}
                    value={p[key] === 0 ? '' : p[key]}
                    onChange={(e) => update({ [key]: parseFloat(e.target.value) || 0 })}
                  />
                </div>
              ))}
            </div>
            <h3 className="text-base font-bold text-[#1e293b] mb-4">Ageing Analysis</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#e2e8f0]">
                    <th className="text-left py-2 px-3 font-medium text-[#64748b]">Bucket</th>
                    <th className="text-left py-2 px-3 font-medium text-[#64748b]">Days Overdue</th>
                    <th className="text-right py-2 px-3 font-medium text-[#64748b]">Outstanding Amount</th>
                    <th className="text-right py-2 px-3 font-medium text-[#64748b]">% of Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(p.ageingBuckets || []).map((b, i) => (
                    <tr key={i} className="border-b border-[#e2e8f0]">
                      <td className="py-2 px-3">{b.bucket}</td>
                      <td className="py-2 px-3">{b.daysOverdue}</td>
                      <td className="py-2 px-3 text-right font-mono">
                        <input
                          type="number"
                          className="w-24 text-right border border-[#e2e8f0] rounded px-2 py-1"
                          value={b.amount || ''}
                          onChange={(e) => {
                            const amt = parseFloat(e.target.value) || 0;
                            const buckets = (p.ageingBuckets || []).map((x, j) =>
                              j === i ? { ...x, amount: amt } : x
                            );
                            const tot = buckets.reduce((s, x) => s + x.amount, 0);
                            buckets.forEach((x, j) => {
                              x.pctOfTotal = tot ? (x.amount / tot) * 100 : 0;
                            });
                            update({ ageingBuckets: buckets });
                          }}
                        />
                      </td>
                      <td className="py-2 px-3 text-right font-mono">{b.pctOfTotal.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-medium border-t border-[#e2e8f0]">
                    <td className="py-2 px-3">TOTAL</td>
                    <td className="py-2 px-3"></td>
                    <td className="py-2 px-3 text-right font-mono">{formatIndianCurrency(totalAgeing)}</td>
                    <td className="py-2 px-3 text-right font-mono">100%</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}

        {activeTab === 'classification' && (
          <>
            <h3 className="text-base font-bold text-[#1e293b] mb-4">Business Model Assessment</h3>
            <div className="space-y-2 mb-6">
              {[
                { value: 'hold_to_collect' as const, label: 'Hold to Collect (Amortised Cost)' },
                { value: 'hold_collect_sell' as const, label: 'Hold to Collect & Sell (FVOCI)' },
                { value: 'trading' as const, label: 'Trading / Other (FVTPL)' },
              ].map((opt) => (
                <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="businessModel"
                    checked={p.businessModel === opt.value}
                    onChange={() => update({ businessModel: opt.value })}
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>
            <h3 className="text-base font-bold text-[#1e293b] mb-4">SPPI Test</h3>
            <div className="mb-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={p.sppiPass} onChange={(e) => update({ sppiPass: e.target.checked })} />
                <span>Instrument pays principal and interest only (SPPI pass)</span>
              </label>
            </div>
            <p className="text-sm text-[#64748b] mb-6">
              SPPI Result: {p.sppiPass ? 'PASS' : 'FAIL'} — {p.sppiPass ? 'ECL applicable if Hold to Collect.' : 'Classify as FVTPL; ECL not applicable.'}
            </p>
            <h3 className="text-base font-bold text-[#1e293b] mb-4">Classification Result</h3>
            <div className="p-4 rounded-lg bg-[#f8fafc] border border-[#e2e8f0] mb-6">
              {p.classification === 'AC' && 'Amortised Cost — ECL Applicable'}
              {p.classification === 'FVOCI' && 'FVOCI — ECL Applicable'}
              {p.classification === 'FVTPL' && 'FVTPL — ECL Not Applicable'}
            </div>
            <h3 className="text-base font-bold text-[#1e293b] mb-4">Measurement</h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {[
                { key: 'effectiveInterestRate' as const, label: 'Effective Interest Rate %' },
                { key: 'initialRecognitionAmount' as const, label: 'Initial Recognition Amount' },
                { key: 'transactionCosts' as const, label: 'Transaction Costs' },
                { key: 'originationFees' as const, label: 'Origination Fees' },
              ].map(({ key, label }) => (
                <div key={key}>
                  <label className={labelClass}>{label}</label>
                  <input
                    type="number"
                    className={inputClass}
                    value={p[key] === 0 ? '' : p[key]}
                    onChange={(e) => update({ [key]: parseFloat(e.target.value) || 0 })}
                  />
                </div>
              ))}
            </div>
          </>
        )}

        {activeTab === 'staging' && (
          <>
            <h3 className="text-base font-bold text-[#1e293b] mb-4">Stage Assessment</h3>
            <div className="space-y-2 mb-6">
              {[
                { value: 1 as const, label: 'Stage 1 — Performing (12-month ECL)' },
                { value: 2 as const, label: 'Stage 2 — Underperforming (Lifetime ECL)' },
                { value: 3 as const, label: 'Stage 3 — Non-Performing / Credit Impaired' },
              ].map((opt) => (
                <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="stage"
                    checked={(p.stage || 1) === opt.value}
                    onChange={() => update({ stage: opt.value })}
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>
            <h3 className="text-base font-bold text-[#1e293b] mb-2">Stage 1 Criteria</h3>
            <div className="flex flex-wrap gap-4 mb-4">
              {['No significant increase in credit risk', 'Less than 30 days past due', 'No forbearance', 'Credit rating stable or improved'].map(
                (c) => (
                  <label key={c} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={p.stage1Criteria?.[c] ?? false}
                      onChange={(e) => update({ stage1Criteria: { ...p.stage1Criteria, [c]: e.target.checked } })}
                    />
                    <span className="text-sm">{c}</span>
                  </label>
                )
              )}
            </div>
            <h3 className="text-base font-bold text-[#1e293b] mb-2">Stage 2 Triggers</h3>
            <div className="flex flex-wrap gap-4 mb-4">
              {['Significant increase in credit risk', '30+ days past due', 'Forbearance applied', 'Rating downgraded 2+ notches', 'Covenant breach'].map(
                (c) => (
                  <label key={c} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={p.stage2Triggers?.[c] ?? false}
                      onChange={(e) => update({ stage2Triggers: { ...p.stage2Triggers, [c]: e.target.checked } })}
                    />
                    <span className="text-sm">{c}</span>
                  </label>
                )
              )}
            </div>
            <h3 className="text-base font-bold text-[#1e293b] mb-2">Stage 3 Triggers</h3>
            <div className="flex flex-wrap gap-4 mb-4">
              {['90+ days past due', 'Bankruptcy / insolvency', 'Borrower in default', 'Rating below investment grade', 'Enforcement action'].map(
                (c) => (
                  <label key={c} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={p.stage3Triggers?.[c] ?? false}
                      onChange={(e) => update({ stage3Triggers: { ...p.stage3Triggers, [c]: e.target.checked } })}
                    />
                    <span className="text-sm">{c}</span>
                  </label>
                )
              )}
            </div>
            <div className="mb-4">
              <label className={labelClass}>Staging Rationale (required for audit)</label>
              <textarea
                className={inputClass + ' min-h-[100px]'}
                value={p.stagingRationale}
                onChange={(e) => update({ stagingRationale: e.target.value })}
                placeholder="Explain why this stage was assigned..."
              />
            </div>
            <h3 className="text-base font-bold text-[#1e293b] mb-2">Staging History</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#e2e8f0]">
                  <th className="text-left py-2 px-3 font-medium text-[#64748b]">Date</th>
                  <th className="text-left py-2 px-3 font-medium text-[#64748b]">Previous</th>
                  <th className="text-left py-2 px-3 font-medium text-[#64748b]">New</th>
                  <th className="text-left py-2 px-3 font-medium text-[#64748b]">Reason</th>
                  <th className="text-left py-2 px-3 font-medium text-[#64748b]">Changed By</th>
                </tr>
              </thead>
              <tbody>
                {(p.stagingHistory || []).map((h, i) => (
                  <tr key={i} className="border-b border-[#e2e8f0]">
                    <td className="py-2 px-3">{h.date}</td>
                    <td className="py-2 px-3">Stage {h.previousStage}</td>
                    <td className="py-2 px-3">Stage {h.newStage}</td>
                    <td className="py-2 px-3">{h.reason}</td>
                    <td className="py-2 px-3">{h.changedBy}</td>
                  </tr>
                ))}
                {!(p.stagingHistory || []).length && (
                  <tr>
                    <td colSpan={5} className="py-4 text-center text-[#64748b]">No history yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </>
        )}

        {activeTab === 'ecl' && (
          <>
            <h3 className="text-base font-bold text-[#1e293b] mb-4">PD / LGD / EAD</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
              <div>
                <label className={labelClass}>PD Source</label>
                <select className={inputClass} value={p.pdSource} onChange={(e) => update({ pdSource: e.target.value })}>
                  <option>Manual Input</option>
                  <option>Rating Agency</option>
                  <option>Internal Model</option>
                  <option>Simplified Matrix</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>12-Month PD %</label>
                <input type="number" className={inputClass} value={p.pd12m ?? ''} onChange={(e) => update({ pd12m: parseFloat(e.target.value) || 0 })} />
              </div>
              <div>
                <label className={labelClass}>Lifetime PD %</label>
                <input type="number" className={inputClass} value={p.pdLifetime ?? ''} onChange={(e) => update({ pdLifetime: parseFloat(e.target.value) || 0 })} />
              </div>
              <div>
                <label className={labelClass}>LGD %</label>
                <input type="number" className={inputClass} value={p.lgd ?? ''} onChange={(e) => update({ lgd: parseFloat(e.target.value) || 45 })} />
              </div>
              <div>
                <label className={labelClass}>EAD</label>
                <input
                  type="number"
                  className={inputClass}
                  value={p.ead || p.outstandingBalance || p.grossCarryingAmount || ''}
                  onChange={(e) => update({ ead: parseFloat(e.target.value) || 0 })}
                />
              </div>
              <div>
                <label className={labelClass}>CCF %</label>
                <input type="number" className={inputClass} value={p.ccf ?? 75} onChange={(e) => update({ ccf: parseFloat(e.target.value) || 75 })} />
              </div>
            </div>
            <div className="mb-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={p.useProvisionMatrix} onChange={(e) => update({ useProvisionMatrix: e.target.checked })} />
                <span>Use Provision Matrix (simplified approach for trade receivables)</span>
              </label>
            </div>
            {p.useProvisionMatrix && p.provisionMatrix && (
              <>
                <h3 className="text-base font-bold text-[#1e293b] mb-4">Provision Matrix</h3>
                <div className="overflow-x-auto mb-6">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#e2e8f0]">
                        <th className="text-left py-2 px-3 font-medium text-[#64748b]">Bucket</th>
                        <th className="text-left py-2 px-3 font-medium text-[#64748b]">Days</th>
                        <th className="text-right py-2 px-3 font-medium text-[#64748b]">Historical Default %</th>
                        <th className="text-right py-2 px-3 font-medium text-[#64748b]">ECL Rate %</th>
                        <th className="text-right py-2 px-3 font-medium text-[#64748b]">Gross Amount</th>
                        <th className="text-right py-2 px-3 font-medium text-[#64748b]">ECL Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.provisionMatrix.map((r, i) => {
                        const eclAmt = r.grossAmount * (r.eclRate / 100);
                        return (
                          <tr key={i} className="border-b border-[#e2e8f0]">
                            <td className="py-2 px-3">{r.bucket}</td>
                            <td className="py-2 px-3">{r.daysOverdue}</td>
                            <td className="py-2 px-3 text-right font-mono">{r.historicalDefaultRate}%</td>
                            <td className="py-2 px-3 text-right">
                              <input
                                type="number"
                                className="w-16 text-right border border-[#e2e8f0] rounded px-2 py-1 font-mono"
                                value={r.eclRate}
                                onChange={(e) => {
                                  const matrix = p.provisionMatrix!.map((x, j) =>
                                    j === i ? { ...x, eclRate: parseFloat(e.target.value) || 0 } : x
                                  );
                                  update({ provisionMatrix: matrix });
                                }}
                              />
                              %
                            </td>
                            <td className="py-2 px-3 text-right font-mono">
                              <input
                                type="number"
                                className="w-28 text-right border border-[#e2e8f0] rounded px-2 py-1 font-mono"
                                value={r.grossAmount || ''}
                                onChange={(e) => {
                                  const matrix = p.provisionMatrix!.map((x, j) =>
                                    j === i ? { ...x, grossAmount: parseFloat(e.target.value) || 0 } : x
                                  );
                                  update({ provisionMatrix: matrix });
                                }}
                              />
                            </td>
                            <td className="py-2 px-3 text-right font-mono">{formatIndianCurrency(eclAmt)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="font-medium border-t border-[#e2e8f0]">
                        <td colSpan={4} className="py-2 px-3">TOTAL ECL</td>
                        <td className="py-2 px-3 text-right font-mono">
                          {formatIndianCurrency(p.provisionMatrix.reduce((s, r) => s + r.grossAmount * (r.eclRate / 100), 0))}
                        </td>
                        <td className="py-2 px-3"></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            )}
            <h3 className="text-base font-bold text-[#1e293b] mb-4">ECL Formula (transparent)</h3>
            <div className="p-4 bg-[#f8fafc] rounded-lg border border-[#e2e8f0] font-mono text-sm space-y-2 mb-4">
              {!p.useProvisionMatrix && (
                <>
                  <p>
                    12-Month ECL = PD(12M) × LGD × EAD = {(p.pd12m ?? 0)}% × {(p.lgd ?? 0)}% × {formatIndianCurrency(p.ead || p.outstandingBalance || 0)} ={' '}
                    {formatIndianCurrency(((p.pd12m ?? 0) / 100) * ((p.lgd ?? 45) / 100) * (p.ead || p.outstandingBalance || 0))}
                  </p>
                  <p>
                    Lifetime ECL = PD(Lifetime) × LGD × EAD = {(p.pdLifetime ?? 0)}% × {(p.lgd ?? 0)}% × {formatIndianCurrency(p.ead || p.outstandingBalance || 0)} ={' '}
                    {formatIndianCurrency(((p.pdLifetime ?? 0) / 100) * ((p.lgd ?? 45) / 100) * (p.ead || p.outstandingBalance || 0))}
                  </p>
                  <p>
                    Applicable ECL (Stage {(p.stage || 1)}): Stage 1 → 12M ECL; Stage 2/3 → Lifetime ECL
                  </p>
                </>
              )}
              {p.useProvisionMatrix && (
                <p>
                  Simplified ECL = Σ (Bucket Gross × ECL Rate) = {formatIndianCurrency(p.provisionMatrix?.reduce((s, r) => s + r.grossAmount * (r.eclRate / 100), 0) || 0)}
                </p>
              )}
            </div>
            <div className="p-4 rounded-lg bg-[#f97316]/10 border border-[#f97316]/30">
              <p className="text-sm font-medium text-[#1e293b]">FINAL ECL AMOUNT</p>
              <p className="text-2xl font-bold text-[#f97316] font-mono">
                {formatIndianCurrency(p.applicableEcl ?? (p.useProvisionMatrix ? provisionTotal : ((p.stage === 1 ? p.pd12m : p.pdLifetime) ?? 0) / 100 * ((p.lgd ?? 45) / 100) * (p.ead || p.outstandingBalance || 0)))}
              </p>
              <p className="text-sm text-[#64748b] mt-1">
                Coverage: {gross ? (((p.applicableEcl ?? 0) / gross) * 100).toFixed(2) : '0'}%
              </p>
            </div>
          </>
        )}

        {activeTab === 'scenario' && (
          <>
            <h3 className="text-base font-bold text-[#1e293b] mb-4">Macro-Economic Scenarios</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
              {(['base', 'optimistic', 'pessimistic'] as const).map((key) => {
                const s = p.scenarios?.[key] ?? { gdp: key === 'base' ? 6 : key === 'optimistic' ? 8 : 3, unemployment: key === 'base' ? 7 : key === 'optimistic' ? 5 : 12, interestRate: key === 'base' ? 6.5 : key === 'optimistic' ? 5.5 : 8, weight: key === 'base' ? 50 : key === 'optimistic' ? 30 : 20 };
                return (
                  <div key={key} className="p-4 border border-[#e2e8f0] rounded-lg">
                    <h4 className="font-semibold text-[#1e293b] mb-3 uppercase">{key}</h4>
                    <div className="space-y-2">
                      <div>
                        <label className={labelClass}>GDP Growth %</label>
                        <input
                          type="number"
                          className={inputClass}
                          value={s.gdp}
                          onChange={(e) =>
                            update({
                              scenarios: {
                                ...p.scenarios,
                                [key]: { ...s, gdp: parseFloat(e.target.value) || 0 },
                              },
                            })
                          }
                        />
                      </div>
                      <div>
                        <label className={labelClass}>Unemployment %</label>
                        <input type="number" className={inputClass} value={s.unemployment} onChange={(e) => update({ scenarios: { ...p.scenarios, [key]: { ...s, unemployment: parseFloat(e.target.value) || 0 } } })} />
                      </div>
                      <div>
                        <label className={labelClass}>Interest Rate %</label>
                        <input type="number" className={inputClass} value={s.interestRate} onChange={(e) => update({ scenarios: { ...p.scenarios, [key]: { ...s, interestRate: parseFloat(e.target.value) || 0 } } })} />
                      </div>
                      <div>
                        <label className={labelClass}>Weight %</label>
                        <input type="number" className={inputClass} value={s.weight} onChange={(e) => update({ scenarios: { ...p.scenarios, [key]: { ...s, weight: parseFloat(e.target.value) || 0 } } })} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-sm text-[#64748b] mb-4">Weights must total 100%. Probability-weighted ECL = Base×W1 + Optimistic×W2 + Pessimistic×W3.</p>
            {p.scenarioResults && (
              <>
                <div className="p-4 rounded-lg bg-[#f97316]/10 border border-[#f97316]/30 mb-4">
                  <p className="text-sm font-medium text-[#1e293b]">Probability-Weighted ECL</p>
                  <p className="text-xl font-bold text-[#f97316] font-mono">{formatIndianCurrency(p.scenarioResults.weighted)}</p>
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart
                    data={[
                      { name: 'Base', ecl: p.scenarioResults.base, fill: '#f97316' },
                      { name: 'Optimistic', ecl: p.scenarioResults.optimistic, fill: '#22c55e' },
                      { name: 'Pessimistic', ecl: p.scenarioResults.pessimistic, fill: '#ef4444' },
                    ]}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={(v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : `${(v / 1e3).toFixed(0)}K`)} />
                    <Tooltip formatter={(v, n) => formatScenarioTooltip(v, n)} />
                    <Bar dataKey="ecl" radius={[4, 4, 0, 0]} />
                    <ReferenceLine y={p.scenarioResults.weighted} stroke="#f97316" strokeDasharray="4 4" label="Weighted" />
                  </BarChart>
                </ResponsiveContainer>
              </>
            )}
          </>
        )}

        {activeTab === 'results' && (
          <>
            <h3 className="text-base font-bold text-[#1e293b] mb-4">Results Summary</h3>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
              <div className="p-4 bg-[#f8fafc] rounded-lg border border-[#e2e8f0]">
                <p className="text-xs text-[#64748b]">Final ECL</p>
                <p className="text-lg font-bold font-mono text-[#f97316]">{formatIndianCurrency(p.applicableEcl ?? 0)}</p>
              </div>
              <div className="p-4 bg-[#f8fafc] rounded-lg border border-[#e2e8f0]">
                <p className="text-xs text-[#64748b]">Coverage</p>
                <p className="text-lg font-bold font-mono">{p.coverageRatio ?? (gross ? ((p.applicableEcl ?? 0) / gross * 100).toFixed(2) : 0)}%</p>
              </div>
              <div className="p-4 bg-[#f8fafc] rounded-lg border border-[#e2e8f0]">
                <p className="text-xs text-[#64748b]">Stage</p>
                <StageBadge stage={p.stage || 1} />
              </div>
              <div className="p-4 bg-[#f8fafc] rounded-lg border border-[#e2e8f0]">
                <p className="text-xs text-[#64748b]">PD / LGD</p>
                <p className="text-sm font-mono">{(p.stage === 1 ? p.pd12m : p.pdLifetime) ?? 0}% / {p.lgd ?? 0}%</p>
              </div>
              <div className="p-4 bg-[#f8fafc] rounded-lg border border-[#e2e8f0]">
                <p className="text-xs text-[#64748b]">EAD</p>
                <p className="text-sm font-mono">{formatIndianCurrency(p.ead || p.outstandingBalance || 0)}</p>
              </div>
            </div>
            <h3 className="text-base font-bold text-[#1e293b] mb-4">Journal Entries</h3>
            <div className="space-y-3 mb-6">
              <div className="p-3 bg-red-50 rounded-lg border-l-4 border-red-500">
                <p className="text-sm font-medium text-red-700">Dr. Impairment Loss (P&L)</p>
                <p className="text-sm font-mono font-bold">{formatIndianCurrency(p.applicableEcl ?? 0)}</p>
              </div>
              <div className="p-3 bg-green-50 rounded-lg border-l-4 border-green-500">
                <p className="text-sm font-medium text-green-700">Cr. Loss Allowance (BS)</p>
                <p className="text-sm font-mono font-bold">{formatIndianCurrency(p.applicableEcl ?? 0)}</p>
              </div>
            </div>
            <h3 className="text-base font-bold text-[#1e293b] mb-4">Disclosure Notes (IFRS 9 para 35H–35N)</h3>
            <div className="p-4 bg-[#f8fafc] rounded-lg border border-[#e2e8f0] font-mono text-sm whitespace-pre-wrap mb-4">
              {p.disclosureNotes || 'Calculate ECL to generate disclosure text.'}
            </div>
            <h3 className="text-base font-bold text-[#1e293b] mb-4">Audit Trail</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#e2e8f0]">
                  <th className="text-left py-2 px-3 font-medium text-[#64748b]">Date/Time</th>
                  <th className="text-left py-2 px-3 font-medium text-[#64748b]">User</th>
                  <th className="text-left py-2 px-3 font-medium text-[#64748b]">Action</th>
                  <th className="text-left py-2 px-3 font-medium text-[#64748b]">Old / New</th>
                  <th className="text-left py-2 px-3 font-medium text-[#64748b]">Reason</th>
                </tr>
              </thead>
              <tbody>
                {(p.auditTrail || []).map((a, i) => (
                  <tr key={i} className="border-b border-[#e2e8f0]">
                    <td className="py-2 px-3">{a.dateTime}</td>
                    <td className="py-2 px-3">{a.user}</td>
                    <td className="py-2 px-3">{a.action}</td>
                    <td className="py-2 px-3">{a.oldValue} → {a.newValue}</td>
                    <td className="py-2 px-3">{a.reason}</td>
                  </tr>
                ))}
                {!(p.auditTrail || []).length && (
                  <tr>
                    <td colSpan={5} className="py-4 text-center text-[#64748b]">No audit entries yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="flex gap-2 mt-4">
              <Button
                variant="secondary"
                onClick={() => {
                  navigator.clipboard.writeText(p.disclosureNotes || '');
                  toast.success('Copied to clipboard');
                }}
              >
                <Copy className="w-4 h-4 mr-1" /> Copy Disclosure Text
              </Button>
              <Button variant="secondary" onClick={handleDownloadReport}>
                <Download className="w-4 h-4 mr-1" /> Download Full Report
              </Button>
            </div>
          </>
        )}
      </div>
    </SidebarLayout>
  );
}
