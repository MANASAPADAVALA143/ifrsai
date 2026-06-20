'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { SidebarLayout } from '@/components/SidebarLayout';
import { Button } from '@/components/Button';
import { Plus, Upload, FileBarChart, Eye, Calculator, Download, Copy, ChevronDown, ChevronUp, Loader2, Trash2, X, FileText } from 'lucide-react';
import { getEclPortfolioRepository, refreshEclPortfolioFromServer, type ECLPortfolioEntry } from '@/lib/ecl-portfolio-repository';
import { formatIndianCurrency } from '@/lib/utils';
import {
  ifrs9Api,
  API_URL,
  type IFRS9ClassificationResult,
  type IFRS9MacroOverlayResult,
  type IFRS9ProvisionMatrixResult,
} from '@/lib/api';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { ModuleWorkspaceLayout } from '@/components/module/ModuleWorkspaceLayout';
import { IFRS9_NAV_GROUPS, ifrs9NavHref, IFRS9_ECL_STEPS, ifrs9NavIdToStep, ifrs9StepToNavId, isIfrs9EclWorkflowNav, type Ifrs9NavId } from '@/lib/ifrs9-nav';
import { CalculateStepper } from '@/components/module/CalculateStepper';
import { useRouter } from 'next/navigation';
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  ReferenceLine,
  LabelList,
  Legend,
} from '@/components/Charts';

/** AUDIT: Previously this page used (1) synthetic ECL trend LineChart scaling totalEcl*0.7..1.0 by month — not real data. (2) Six KPI cards mixing repo aggregates. Replaced with API-backed portfolio fields only after calculate, four KPIs, no fake trends. */

const BAR_GREEN = '#22c55e';
const BAR_ORANGE = '#f97316';
const BAR_RED = '#ef4444';

const PROVISION_DEFAULT_PCT: Record<string, number> = {
  Current: 0.5,
  '1-30 DPD': 2.0,
  '31-60 DPD': 5.0,
  '61-90 DPD': 10.0,
  '91-180 DPD': 20.0,
  '>180 DPD': 50.0,
};

function provisionRowBg(label: string): string {
  const m: Record<string, string> = {
    Current: 'bg-white',
    '1-30 DPD': 'bg-[#FEFCE8]',
    '31-60 DPD': 'bg-[#FEF9C3]',
    '61-90 DPD': 'bg-[#FED7AA]',
    '91-180 DPD': 'bg-[#FECACA]',
    '>180 DPD': 'bg-[#FCA5A5]',
  };
  return m[label] ?? 'bg-white';
}

function provisionShortLabel(label: string): string {
  if (label === 'Current') return 'Cur';
  if (label === '1-30 DPD') return '1-30';
  if (label === '31-60 DPD') return '31-60';
  if (label === '61-90 DPD') return '61-90';
  if (label === '91-180 DPD') return '91-180';
  if (label === '>180 DPD') return '>180';
  return label.slice(0, 8);
}

function loanEad(p: ECLPortfolioEntry): number {
  return Number(p.ead || p.outstandingBalance || p.grossCarryingAmount || 0) || 0;
}

function loanPdPct(p: ECLPortfolioEntry): number {
  const st = p.stage || 1;
  return st === 1 ? Number(p.pd12m ?? 0) : Number(p.pdLifetime ?? 0);
}

function StageRowBadge({ stage }: { stage: 1 | 2 | 3 }) {
  const cfg = {
    1: { label: 'Stage 1 — Performing', cls: 'bg-green-100 text-green-800 border-green-300' },
    2: { label: 'Stage 2 — SICR', cls: 'bg-orange-100 text-orange-800 border-orange-300' },
    3: { label: 'Stage 3 — Impaired', cls: 'bg-red-100 text-red-800 border-red-300' },
  }[stage];
  return <span className={`px-2 py-1 rounded-full text-xs font-semibold border ${cfg.cls}`}>{cfg.label}</span>;
}

function rowBgForStage(stage: number): string {
  if (stage === 2) return 'bg-orange-50/80';
  if (stage === 3) return 'bg-red-50/80';
  return 'bg-green-50/50';
}

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

/** Recharts Tooltip — normalises ValueType (incl. tuple) for strict TS. */
function formatRechartsTooltipPair(value: unknown, name?: unknown): [string, string] {
  const n = coerceChartNumber(value);
  const v = n !== undefined ? formatIndianCurrency(n) : '';
  const nm = typeof name === 'string' ? name : name != null && name !== false ? String(name) : '';
  return [v, nm];
}

function formatRechartsTooltipString(value: unknown): string {
  const n = coerceChartNumber(value);
  return n !== undefined ? formatIndianCurrency(n) : '';
}

const HOLD_TO_COLLECT_KEYS = new Set([
  'hold_to_maturity',
  'contractual_cash_flows_only',
  'infrequent_sales',
  'no_trading_intent',
]);
const HOLD_COLLECT_SELL_KEYS = new Set([
  'liquidity_management',
  'frequent_sales',
  'available_for_sale_intent',
  'benchmark_performance',
]);

function assessBusinessModelLive(indicators: string[]): {
  key: 'HOLD_TO_COLLECT' | 'HOLD_TO_COLLECT_AND_SELL' | 'OTHER';
  htc: number;
  htcs: number;
} {
  const ind = new Set(indicators);
  let htc = 0;
  let htcs = 0;
  ind.forEach((i) => {
    if (HOLD_TO_COLLECT_KEYS.has(i)) htc += 1;
    if (HOLD_COLLECT_SELL_KEYS.has(i)) htcs += 1;
  });
  const htcOk = htc >= 2;
  const htcsOk = htcs >= 2;
  if (htcOk && !htcsOk) return { key: 'HOLD_TO_COLLECT', htc, htcs };
  if (htcsOk && !htcOk) return { key: 'HOLD_TO_COLLECT_AND_SELL', htc, htcs };
  if (htcOk && htcsOk) return { key: 'HOLD_TO_COLLECT_AND_SELL', htc, htcs };
  return { key: 'OTHER', htc, htcs };
}

function runSppiLive(features: string[], prepaymentPenaltyReasonable: boolean): { pass: boolean; reasons: string[] } {
  let pass = true;
  const reasons: string[] = [];
  for (const feat of features) {
    if (feat === 'leverage') {
      pass = false;
      reasons.push('Leveraged returns not SPPI');
    } else if (feat === 'convertible') {
      pass = false;
      reasons.push('Equity conversion not SPPI');
    } else if (feat === 'equity_linked') {
      pass = false;
      reasons.push('Equity-linked returns not SPPI');
    } else if (feat === 'inverse_floating') {
      pass = false;
      reasons.push('Inverse floater not SPPI');
    } else if (feat === 'non_recourse') {
      /* no auto-fail */
    } else if (feat === 'contractual_linkage') {
      pass = false;
      reasons.push('Contractual linkage to non-SPPI instrument fails test');
    } else if (feat === 'prepayment_option' && !prepaymentPenaltyReasonable) {
      pass = false;
      reasons.push('Prepayment penalty not reasonable compensation');
    }
  }
  return { pass, reasons };
}

function liveMeasurementFrom(
  bm: 'HOLD_TO_COLLECT' | 'HOLD_TO_COLLECT_AND_SELL' | 'OTHER',
  sppiPass: boolean,
  fairValueOption: boolean
): 'AMORTISED_COST' | 'FVOCI' | 'FVTPL' {
  if (fairValueOption) return 'FVTPL';
  if (bm === 'HOLD_TO_COLLECT' && sppiPass) return 'AMORTISED_COST';
  if (bm === 'HOLD_TO_COLLECT_AND_SELL' && sppiPass) return 'FVOCI';
  return 'FVTPL';
}

export default function IFRS9OverviewPage() {
  const [portfolios, setPortfolios] = useState<ECLPortfolioEntry[]>([]);
  const [activeNavId, setActiveNavId] = useState<Ifrs9NavId>('overview');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const router = useRouter();
  const [openDisclosureId, setOpenDisclosureId] = useState<string | null>(null);
  const [showAllLoans, setShowAllLoans] = useState(false);
  const [downloadLoading, setDownloadLoading] = useState(false);

  const [classificationPanelOpen, setClassificationPanelOpen] = useState(false);
  const [classificationResult, setClassificationResult] = useState<IFRS9ClassificationResult | null>(null);
  const [classificationLoading, setClassificationLoading] = useState(false);
  const [clsInstrumentName, setClsInstrumentName] = useState('');
  const [clsInstrumentType, setClsInstrumentType] = useState('loan');
  const [clsBusinessIndicators, setClsBusinessIndicators] = useState<string[]>([]);
  const [clsSppiFeatures, setClsSppiFeatures] = useState<string[]>([]);
  const [clsPrepaymentReasonable, setClsPrepaymentReasonable] = useState(true);
  const [clsFairValueOption, setClsFairValueOption] = useState(false);
  const [clsFvoReason, setClsFvoReason] = useState('');
  const [clsBusinessModelChanged, setClsBusinessModelChanged] = useState(false);
  const [clsEirOpen, setClsEirOpen] = useState(false);
  const [clsNominalRate, setClsNominalRate] = useState('');
  const [clsIssuePrice, setClsIssuePrice] = useState('');
  const [clsFaceValue, setClsFaceValue] = useState('');
  const [clsTermMonths, setClsTermMonths] = useState('');

  const toggleClsIndicator = (key: string) => {
    setClsBusinessIndicators((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };
  const toggleClsSppi = (key: string) => {
    setClsSppiFeatures((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const liveBm = useMemo(() => assessBusinessModelLive(clsBusinessIndicators), [clsBusinessIndicators]);
  const liveSppi = useMemo(
    () => runSppiLive(clsSppiFeatures, clsPrepaymentReasonable),
    [clsSppiFeatures, clsPrepaymentReasonable]
  );
  const liveMeasurement = useMemo(
    () => liveMeasurementFrom(liveBm.key, liveSppi.pass, clsFairValueOption),
    [liveBm.key, liveSppi.pass, clsFairValueOption]
  );

  const handleClassifyInstrument = async () => {
    setClassificationPanelOpen(true);
    setClassificationLoading(true);
    const parseNum = (s: string) => {
      const n = parseFloat(String(s).replace(/,/g, ''));
      return Number.isFinite(n) ? n : undefined;
    };
    const nr = parseNum(clsNominalRate);
    const ip = parseNum(clsIssuePrice);
    const fv = parseNum(clsFaceValue);
    const tmRaw = parseInt(clsTermMonths, 10);
    const payload = {
      instrument_name: clsInstrumentName.trim() || 'Instrument',
      instrument_type: clsInstrumentType,
      business_model_indicators: clsBusinessIndicators,
      sppi_features: clsSppiFeatures,
      prepayment_penalty_reasonable: clsPrepaymentReasonable,
      fair_value_option_elected: clsFairValueOption,
      fvo_reason: clsFvoReason.trim() || null,
      business_model_changed: clsBusinessModelChanged,
      nominal_rate: nr,
      issue_price: ip,
      face_value: fv,
      term_months: Number.isFinite(tmRaw) && tmRaw > 0 ? tmRaw : undefined,
    };
    const res = await ifrs9Api.classify(payload);
    setClassificationLoading(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    if (res.data) setClassificationResult(res.data);
  };

  const [macroPanelOpen, setMacroPanelOpen] = useState(false);
  const [macroOverlayResult, setMacroOverlayResult] = useState<IFRS9MacroOverlayResult | null>(null);
  const [macroLoading, setMacroLoading] = useState(false);
  const [macroPortfolioName, setMacroPortfolioName] = useState('');
  const [macroBasePd, setMacroBasePd] = useState('');
  const [macroLgd, setMacroLgd] = useState('');
  const [macroEad, setMacroEad] = useState('');
  const [eclKpiMode, setEclKpiMode] = useState<'macro' | 'pit'>('macro');

  const [provisionPanelOpen, setProvisionPanelOpen] = useState(false);
  const [provisionMode, setProvisionMode] = useState<'invoices' | 'buckets'>('buckets');
  const [provisionRows, setProvisionRows] = useState<
    Array<{ invoice_id: string; customer: string; gross_amount: number; days_past_due: number }>
  >([
    { invoice_id: '', customer: '', gross_amount: 0, days_past_due: 0 },
    { invoice_id: '', customer: '', gross_amount: 0, days_past_due: 0 },
    { invoice_id: '', customer: '', gross_amount: 0, days_past_due: 0 },
  ]);
  const [bucketInputs, setBucketInputs] = useState<
    Array<{ label: string; gross: number; rate: number }>
  >([
    { label: 'Current', gross: 0, rate: 0.5 },
    { label: '1-30 DPD', gross: 0, rate: 2.0 },
    { label: '31-60 DPD', gross: 0, rate: 5.0 },
    { label: '61-90 DPD', gross: 0, rate: 10.0 },
    { label: '91-180 DPD', gross: 0, rate: 20.0 },
    { label: '>180 DPD', gross: 0, rate: 50.0 },
  ]);
  const [provisionPortfolioName, setProvisionPortfolioName] = useState('');
  const [provisionReceivableType, setProvisionReceivableType] = useState('trade_receivables');
  const [provisionDate, setProvisionDate] = useState('');
  const [provisionFLA, setProvisionFLA] = useState(0);
  const [provisionWriteoffs, setProvisionWriteoffs] = useState('');
  const [provisionResult, setProvisionResult] = useState<IFRS9ProvisionMatrixResult | null>(null);
  const [provisionLoading, setProvisionLoading] = useState(false);

  const [masterReport, setMasterReport] = useState<Record<string, unknown> | null>(null);
  const [masterLoading, setMasterLoading] = useState(false);
  const [showMasterModal, setShowMasterModal] = useState(false);
  const [masterTab, setMasterTab] = useState(0);

  const [scOpt, setScOpt] = useState({
    probability: '25',
    gdp: '3.5',
    unemp: '3.5',
    rate: '3.0',
    prop: '5',
    spread: '0.5',
  });
  const [scBase, setScBase] = useState({
    probability: '50',
    gdp: '2.0',
    unemp: '5.0',
    rate: '4.5',
    prop: '0',
    spread: '1.5',
  });
  const [scPess, setScPess] = useState({
    probability: '25',
    gdp: '-1.0',
    unemp: '8.0',
    rate: '6.0',
    prop: '-10',
    spread: '3.0',
  });

  const macroProbSumPct = useMemo(() => {
    const a = parseFloat(scOpt.probability) || 0;
    const b = parseFloat(scBase.probability) || 0;
    const c = parseFloat(scPess.probability) || 0;
    return a + b + c;
  }, [scOpt.probability, scBase.probability, scPess.probability]);
  const macroProbOk = Math.abs(macroProbSumPct - 100) < 0.01;

  const load = useCallback(async () => {
    try {
      const rows = await refreshEclPortfolioFromServer();
      setPortfolios(rows);
    } catch {
      setPortfolios(getEclPortfolioRepository());
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const calculated = useMemo(
    () => portfolios.filter((p) => p.applicableEcl != null && !Number.isNaN(Number(p.applicableEcl))),
    [portfolios]
  );

  const results = useMemo(() => {
    if (!calculated.length) return null;
    const total_ead = calculated.reduce((s, p) => s + loanEad(p), 0);
    const total_ecl = calculated.reduce((s, p) => s + Number(p.applicableEcl ?? 0), 0);
    let sumPdEad = 0;
    let sumLgdEad = 0;
    for (const p of calculated) {
      const e = loanEad(p);
      sumPdEad += loanPdPct(p) * e;
      sumLgdEad += Number(p.lgd ?? 0) * e;
    }
    const weighted_avg_pd = total_ead > 0 ? sumPdEad / total_ead : null;
    const weighted_avg_lgd = total_ead > 0 ? sumLgdEad / total_ead : null;
    const coverage_ratio = total_ead > 0 ? (total_ecl / total_ead) * 100 : null;

    const stage1_ecl = calculated.filter((p) => (p.stage || 1) === 1).reduce((s, p) => s + Number(p.applicableEcl ?? 0), 0);
    const stage2_ecl = calculated.filter((p) => p.stage === 2).reduce((s, p) => s + Number(p.applicableEcl ?? 0), 0);
    const stage3_ecl = calculated.filter((p) => p.stage === 3).reduce((s, p) => s + Number(p.applicableEcl ?? 0), 0);

    const stage_summary = [1, 2, 3].map((st) => {
      const rows = calculated.filter((p) => (p.stage || 1) === st);
      return {
        stage: st as 1 | 2 | 3,
        loan_count: rows.length,
        ead: rows.reduce((s, p) => s + loanEad(p), 0),
        ecl: rows.reduce((s, p) => s + Number(p.applicableEcl ?? 0), 0),
      };
    });

    const loans = calculated.map((p) => ({
      id: p.portfolioId || p.id,
      stage: (p.stage || 1) as 1 | 2 | 3,
      ead: loanEad(p),
      pd_pct: loanPdPct(p),
      lgd_pct: Number(p.lgd ?? 0),
      ecl: Number(p.applicableEcl ?? 0),
      status: p.status || 'Draft',
    }));

    const firstNotes = calculated.map((p) => p.disclosureNotes).find((n) => n && String(n).trim());

    return {
      total_ecl,
      total_ead,
      total_exposure: total_ead,
      weighted_avg_pd,
      weighted_avg_lgd,
      coverage_ratio,
      stage1_ecl,
      stage2_ecl,
      stage3_ecl,
      stage_summary,
      loans,
      disclosure_notes: {
        accounting_policy:
          firstNotes ||
          'Run calculation on a portfolio to generate disclosure notes. The Group recognises ECL allowances in accordance with IFRS 9 Financial Instruments.',
        staging_criteria:
          'Run calculation to generate disclosure notes. Stage 1: performing — 12-month ECL. Stage 2: significant increase in credit risk (SICR) — lifetime ECL. Stage 3: credit-impaired — lifetime ECL.',
        significant_assumptions:
          'Run calculation to generate disclosure notes. PD and LGD are estimated using internal models or external ratings; EAD reflects exposure at default.',
        sensitivity_analysis:
          'Run calculation to generate disclosure notes. Sensitivity of ECL to adverse changes in PD, LGD, and macroeconomic factors should be disclosed per IFRS 9 B5.5.17–B5.5.21.',
      },
    };
  }, [calculated]);

  useEffect(() => {
    if (!results || !calculated.length) return;
    const name = calculated.map((p) => p.name).filter(Boolean).join(', ') || 'IFRS 9 Portfolio';
    setMacroPortfolioName(name);
    if (results.weighted_avg_pd != null) {
      setMacroBasePd(String(Number(results.weighted_avg_pd.toFixed(4))));
    }
    if (results.weighted_avg_lgd != null) {
      setMacroLgd(String(Number(results.weighted_avg_lgd.toFixed(4))));
    }
    setMacroEad(String(Math.round(results.total_ead)));
  }, [results, calculated]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      console.log(
        '[IFRS9 overview] Aggregated from portfolios with applicableEcl set (saved after POST /api/ifrs9/calculate on portfolio detail). Field mapping:',
        results
          ? {
              total_ecl: results.total_ecl,
              total_ead: results.total_ead,
              weighted_avg_pd: results.weighted_avg_pd,
              coverage_ratio: results.coverage_ratio,
              stage1_ecl: results.stage1_ecl,
              stage2_ecl: results.stage2_ecl,
              stage3_ecl: results.stage3_ecl,
              loan_rows: results.loans?.length,
            }
          : null
      );
    }
  }, [results]);

  const barChartData = useMemo(() => {
    if (!results) return [];
    return [
      { name: 'Stage 1 ECL', ecl: results.stage1_ecl, fill: BAR_GREEN },
      { name: 'Stage 2 ECL', ecl: results.stage2_ecl, fill: BAR_ORANGE },
      { name: 'Stage 3 ECL', ecl: results.stage3_ecl, fill: BAR_RED },
    ];
  }, [results]);

  const fmtKpi = (v: number | null | undefined, suffix = ''): string => {
    if (v == null || Number.isNaN(v)) return '—';
    return `${formatIndianCurrency(v)}${suffix}`;
  };

  const fmtPct = (v: number | null | undefined): string => {
    if (v == null || Number.isNaN(v)) return '—';
    return `${v.toFixed(2)}%`;
  };

  const aiInsight = useMemo(() => {
    if (!results || !calculated.length) {
      return 'Upload loan portfolios, run Calculate on each instrument, and return here to see portfolio-level ECL analytics.';
    }
    const cov = results.coverage_ratio ?? 0;
    const ranked = [...results.stage_summary].sort((a, b) => b.loan_count - a.loan_count);
    const top = ranked[0];
    const risk = cov > 5 ? 'High' : cov > 2 ? 'Moderate' : 'Low';
    return `Portfolio ECL coverage ratio is ${cov.toFixed(2)}%. Stage ${top.stage} has the highest concentration with ${top.loan_count} loan(s). ${risk} credit risk profile overall.`;
  }, [results, calculated.length]);

  const disclosureCards = useMemo(() => {
    const dn = results?.disclosure_notes;
    return [
      { id: 'accounting-policy', title: 'Accounting Policy', content: dn?.accounting_policy ?? '' },
      { id: 'staging-criteria', title: 'Staging Criteria', content: dn?.staging_criteria ?? '' },
      { id: 'significant-assumptions', title: 'Significant Assumptions', content: dn?.significant_assumptions ?? '' },
      { id: 'sensitivity', title: 'Sensitivity Analysis', content: dn?.sensitivity_analysis ?? '' },
    ];
  }, [results]);

  const handleDownloadExcel = async () => {
    if (!results || !calculated.length) {
      toast.error('Calculate ECL on at least one portfolio first');
      return;
    }
    setDownloadLoading(true);
    try {
      const portfolioName = calculated.map((p) => p.name).filter(Boolean).join(', ') || 'IFRS9 Portfolio';
      const reportingDate = calculated[0]?.reportingDate || new Date().toISOString().split('T')[0];
      const journal_entries = [
        ...(results.stage1_ecl > 0
          ? [{ type: 'Stage 1 — 12-month ECL', dr: 'ECL Expense (P&L)', cr: 'Loan Loss Allowance', amount: results.stage1_ecl }]
          : []),
        ...(results.stage2_ecl > 0
          ? [{ type: 'Stage 2 — Lifetime ECL (SICR)', dr: 'ECL Expense (P&L)', cr: 'Loan Loss Allowance', amount: results.stage2_ecl }]
          : []),
        ...(results.stage3_ecl > 0
          ? [{ type: 'Stage 3 — Credit impaired', dr: 'ECL Expense (P&L)', cr: 'Loan Loss Allowance', amount: results.stage3_ecl }]
          : []),
      ];
      const stage_summary = {
        stage1: {
          count: results.stage_summary[0]?.loan_count ?? 0,
          ead: results.stage_summary[0]?.ead ?? 0,
          ecl: results.stage_summary[0]?.ecl ?? 0,
        },
        stage2: {
          count: results.stage_summary[1]?.loan_count ?? 0,
          ead: results.stage_summary[1]?.ead ?? 0,
          ecl: results.stage_summary[1]?.ecl ?? 0,
        },
        stage3: {
          count: results.stage_summary[2]?.loan_count ?? 0,
          ead: results.stage_summary[2]?.ead ?? 0,
          ecl: results.stage_summary[2]?.ecl ?? 0,
        },
      };
      const loansPayload = (results.loans || []).map((l) => ({
        loan_id: l.id,
        stage: l.stage,
        ead: l.ead,
        pd: l.pd_pct,
        lgd: l.lgd_pct,
        ecl: l.ecl,
        status: l.status,
      }));
      const disclosureStr = calculated.map((p) => p.disclosureNotes).find((n) => n && String(n).trim()) ?? null;
      const scenarioResults = calculated.map((p) => p.scenarioResults).find((s) => s != null) ?? null;

      const payload: Record<string, unknown> = {
        portfolio_name: portfolioName,
        entity_name: '',
        reporting_date: reportingDate,
        applicable_ecl: results.total_ecl,
        ecl_12m: results.stage1_ecl,
        ecl_lifetime: results.stage2_ecl + results.stage3_ecl,
        total_ead: results.total_ead,
        pd_used: results.weighted_avg_pd ?? 0,
        lgd_used: results.weighted_avg_lgd ?? 0,
        coverage_ratio: results.coverage_ratio ?? 0,
        weighted_avg_pd: results.weighted_avg_pd ?? 0,
        stage_summary,
        loans: loansPayload,
        journal_entries,
        disclosure_notes: disclosureStr,
        scenario_results: scenarioResults,
        bucket_results: [],
      };
      if (masterReport) {
        payload.master_report_data = masterReport;
      }

      const post = await ifrs9Api.downloadExcelAuditPack(payload);
      if (post.error || !post.data?.file_id) {
        toast.error(post.error || 'Download failed');
        return;
      }
      const { file_id, filename, sheets: sheetsRaw } = post.data;
      const sheets =
        typeof sheetsRaw === 'number' && sheetsRaw > 0
          ? sheetsRaw
          : payload.master_report_data != null
            ? 6
            : 5;
      const dlRes = await fetch(`${API_URL}/api/ifrs9/download/${file_id}`);
      if (!dlRes.ok) {
        toast.error('Download failed — try again');
        return;
      }
      const blob = await dlRes.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || `IFRS9_ECL_${file_id}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      toast.success(`ECL report downloaded (${sheets} sheets) ✓`);
    } catch {
      toast.error('Download failed — try again');
    } finally {
      setDownloadLoading(false);
    }
  };

  const handleGenerateMasterReport = async () => {
    if (!results || !calculated.length) {
      toast.error('Calculate ECL on at least one portfolio first');
      return;
    }
    setMasterLoading(true);
    try {
      const portfolioName = calculated.map((p) => p.name).filter(Boolean).join(', ') || 'IFRS 9 Portfolio';
      const core = {
        ...results,
        applicable_ecl: results.total_ecl,
        ead_used: results.total_ead,
      };
      const masterPayload = {
        portfolio_name: portfolioName,
        entity_name: '',
        reporting_date: new Date().toISOString().split('T')[0],
        core_results: core,
        classification_result: classificationResult,
        macro_overlay_result: macroOverlayResult,
        provision_matrix_result: provisionResult,
      };
      console.log('Master report payload:', JSON.stringify(masterPayload, null, 2));
      const res = await ifrs9Api.masterReport(masterPayload);
      if (res.error) {
        toast.error(res.error || 'Master report failed');
        return;
      }
      if (res.data) {
        setMasterReport(res.data as Record<string, unknown>);
        setMasterTab(0);
        setShowMasterModal(true);
        toast.success('Master report generated');
      }
    } catch {
      toast.error('Master report failed');
    } finally {
      setMasterLoading(false);
    }
  };

  const loanRows = results?.loans ?? [];
  const loanSlice = showAllLoans ? loanRows : loanRows.slice(0, 6);
  const hasCalcData = calculated.length > 0;

  const handleRunMacroOverlay = async () => {
    setMacroPanelOpen(true);
    setMacroLoading(true);
    const pd = parseFloat(macroBasePd) || 0;
    const lgd = parseFloat(macroLgd) || 0;
    const ead = parseFloat(String(macroEad).replace(/,/g, '')) || 0;
    const mkSc = (s: typeof scBase) => ({
      gdp_growth: parseFloat(s.gdp) || 0,
      unemployment_rate: parseFloat(s.unemp) || 0,
      interest_rate: parseFloat(s.rate) || 0,
      property_price_change: parseFloat(s.prop) || 0,
      credit_spread: parseFloat(s.spread) || 0,
      probability: (parseFloat(s.probability) || 0) / 100,
    });
    const loansPayload = calculated.map((p) => ({
      stage: p.stage || 1,
      ead: loanEad(p),
      pd: loanPdPct(p),
    }));
    const res = await ifrs9Api.macroOverlay({
      portfolio_name: macroPortfolioName.trim() || 'Portfolio',
      base_pd: pd,
      lgd,
      ead,
      base_scenario: mkSc(scBase),
      optimistic_scenario: mkSc(scOpt),
      pessimistic_scenario: mkSc(scPess),
      loans: loansPayload.length ? loansPayload : undefined,
    });
    setMacroLoading(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    if (res.data) {
      setMacroOverlayResult(res.data);
      toast.success('Macro overlay calculated ✓');
    }
  };

  const handleProvisionCsv = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      const lines = text.split(/\r?\n/).filter((ln) => ln.trim());
      if (lines.length < 2) {
        toast.error('CSV needs a header row and at least one data row');
        return;
      }
      const header = lines[0].split(',').map((c) => c.trim().toLowerCase().replace(/\s+/g, '_'));
      const ii = header.indexOf('invoice_id');
      const cu = header.indexOf('customer');
      const ga = header.indexOf('gross_amount');
      const dpd = header.indexOf('days_past_due');
      if (ii < 0 || ga < 0 || dpd < 0) {
        toast.error('CSV needs invoice_id, gross_amount, days_past_due columns');
        return;
      }
      const rows: Array<{ invoice_id: string; customer: string; gross_amount: number; days_past_due: number }> = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        const g = parseFloat(String(cols[ga] || '0').replace(/,/g, '')) || 0;
        const d = parseInt(String(cols[dpd] || '0'), 10) || 0;
        rows.push({
          invoice_id: String(cols[ii] ?? '').trim(),
          customer: cu >= 0 ? String(cols[cu] ?? '').trim() : '',
          gross_amount: g,
          days_past_due: d,
        });
      }
      if (!rows.length) {
        toast.error('No data rows in CSV');
        return;
      }
      setProvisionRows(rows);
      setProvisionMode('invoices');
      toast.success(`${rows.length} invoice(s) loaded from CSV`);
    };
    reader.readAsText(f);
  };

  const handleProvisionMatrix = async () => {
    setProvisionLoading(true);
    try {
      const payload: Record<string, unknown> = {
        portfolio_name: provisionPortfolioName.trim() || 'Provision Matrix',
        reporting_date: provisionDate.trim() || new Date().toISOString().split('T')[0],
        receivable_type: provisionReceivableType,
        macro_adjustment_factor: provisionFLA / 100,
      };
      const wo = parseFloat(String(provisionWriteoffs).replace(/,/g, ''));
      if (Number.isFinite(wo) && wo > 0) {
        payload.writeoffs_this_period = wo;
      }
      if (provisionMode === 'buckets') {
        const bt = bucketInputs
          .filter((b) => b.gross > 0)
          .map((b) => {
            const row: Record<string, unknown> = {
              label: b.label,
              gross_amount: b.gross,
            };
            const def = PROVISION_DEFAULT_PCT[b.label] ?? 0;
            if (Math.abs(b.rate - def) > 0.0001) {
              row.historical_loss_rate = b.rate / 100;
            }
            return row;
          });
        if (!bt.length) {
          toast.error('Enter gross amount in at least one bucket');
          return;
        }
        payload.bucket_totals = bt;
      } else {
        const rec = provisionRows.filter((r) => r.gross_amount > 0);
        if (!rec.length) {
          toast.error('Add at least one invoice with a positive amount');
          return;
        }
        payload.receivables = rec.map((r) => ({
          invoice_id: r.invoice_id.trim() || '—',
          customer: r.customer.trim() || '—',
          gross_amount: r.gross_amount,
          days_past_due: Math.max(0, Math.floor(Number(r.days_past_due) || 0)),
          currency: 'USD',
        }));
      }
      const res = await ifrs9Api.provisionMatrix(payload);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      if (res.data) {
        setProvisionResult(res.data);
        toast.success('Provision matrix calculated ✓');
      }
    } finally {
      setProvisionLoading(false);
    }
  };

  const macroBarChartData = useMemo(() => {
    if (!macroOverlayResult) return [];
    const r = macroOverlayResult;
    return [
      { name: 'Point-in-time ECL', value: r.point_in_time_ecl, fill: '#94a3b8', thick: false },
      { name: 'Optimistic ECL', value: r.scenarios.optimistic.ecl, fill: '#22c55e', thick: false },
      { name: 'Base ECL', value: r.scenarios.base.ecl, fill: '#3b82f6', thick: false },
      { name: 'Pessimistic ECL', value: r.scenarios.pessimistic.ecl, fill: '#ef4444', thick: false },
      { name: 'Prob-weighted ECL', value: r.probability_weighted_ecl, fill: '#0f172a', thick: true },
    ];
  }, [macroOverlayResult]);

  const macroGdpLineData = useMemo(
    () =>
      (macroOverlayResult?.sensitivity_analysis?.gdp ?? []).map((row) => ({
        gdp: row.gdp,
        ecl: row.ecl,
      })),
    [macroOverlayResult]
  );

  const provisionStackedData = useMemo(() => {
    if (!provisionResult?.buckets?.length) return [];
    return provisionResult.buckets.map((b) => ({
      short: provisionShortLabel(b.label),
      label: b.label,
      net: b.net_amount,
      provision: b.provision,
    }));
  }, [provisionResult]);

  const totalEclKpiValue =
    macroOverlayResult != null
      ? eclKpiMode === 'macro'
        ? macroOverlayResult.probability_weighted_ecl
        : macroOverlayResult.point_in_time_ecl
      : hasCalcData
        ? results!.total_ecl
        : null;
  const showTotalEclKpi = totalEclKpiValue != null && (macroOverlayResult != null || hasCalcData);

  const handleIfrs9NavSelect = (navId: string) => {
    const id = navId as Ifrs9NavId;
    const href = ifrs9NavHref(id);
    if (href) {
      router.push(href);
      return;
    }
    setActiveNavId(id);
    if (id === 'classification') setClassificationPanelOpen(true);
    if (id === 'macro-overlay') setMacroPanelOpen(true);
    if (id === 'provision-matrix') setProvisionPanelOpen(true);
    if (id === 'reports' && hasCalcData) void handleGenerateMasterReport();
  };

  const handleIfrs9EclStepChange = (step: number) => {
    handleIfrs9NavSelect(ifrs9StepToNavId(step));
  };

  const ifrs9EclStep = ifrs9NavIdToStep(activeNavId) ?? 1;
  const showIfrs9EclStepper = isIfrs9EclWorkflowNav(activeNavId);

  const ifrs9KpiItems = [
    {
      label: 'Total Portfolio Value (EAD)',
      value: hasCalcData ? fmtKpi(results!.total_ead) : '—',
      accent: 'orange' as const,
    },
    {
      label: 'Total ECL Provision',
      value: showTotalEclKpi ? fmtKpi(totalEclKpiValue) : '—',
      accent: 'orange' as const,
    },
    {
      label: 'Weighted Average PD',
      value: hasCalcData && results!.weighted_avg_pd != null ? fmtPct(results!.weighted_avg_pd) : '—',
      accent: 'orange' as const,
    },
    {
      label: 'Coverage Ratio',
      value: hasCalcData && results!.coverage_ratio != null ? fmtPct(results!.coverage_ratio) : '—',
      accent: 'pink' as const,
    },
  ];

  return (
    <SidebarLayout
      pageTitle="IFRS 9 — ECL Estimation Platform"
      pageSubtitle="Automate ECL calculations and deliver audit-ready results"
    >
      <ModuleWorkspaceLayout
        navGroups={IFRS9_NAV_GROUPS}
        activeNavId={activeNavId}
        onNavSelect={handleIfrs9NavSelect}
        mobileNavOpen={mobileNavOpen}
        onMobileNavOpenChange={setMobileNavOpen}
        kpiItems={ifrs9KpiItems}
        navTitle="IFRS 9 Menu"
      >
      <div className="space-y-6">
        {showIfrs9EclStepper ? (
          <CalculateStepper
            steps={IFRS9_ECL_STEPS}
            currentStep={ifrs9EclStep}
            onStepChange={handleIfrs9EclStepChange}
            maxReachableStep={hasCalcData ? 5 : classificationResult ? 3 : 1}
          />
        ) : null}
        {(activeNavId === 'overview') && (
        <div className="flex flex-wrap gap-3">
          <Link href="/dashboard/ifrs9/portfolios/new">
            <Button variant="primary" className="bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white">
              <Plus className="w-4 h-4 mr-2" />
              New Portfolio
            </Button>
          </Link>
          <Link href="/dashboard/ifrs9/portfolios">
            <Button variant="secondary" className="border-[#e2e8f0]">
              <Upload className="w-4 h-4 mr-2" />
              Upload Debtor Ageing
            </Button>
          </Link>
          <Link href="/dashboard/reports">
            <Button variant="secondary" className="border-[#e2e8f0]">
              <FileBarChart className="w-4 h-4 mr-2" />
              Generate Reports
            </Button>
          </Link>
        </div>
        )}

        {(activeNavId === 'classification') && (
        <div className="bg-white rounded-[14px] border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)] overflow-hidden">
          <div className="px-5 py-4 border-b border-[#e2e8f0]">
            <div>
              <h2 className="text-base font-bold text-[#1e293b]">Classification &amp; Measurement</h2>
              <p className="text-xs text-[#64748b] mt-0.5">Business model, SPPI, and measurement category (IFRS 9.4.1)</p>
            </div>
          </div>
          <div className="px-5 pb-3 border-t border-[#e2e8f0]">
            <div className="rounded-[12px] border border-[#bfdbfe] bg-[#eff6ff] p-4 text-sm text-[#1e3a5f]">
              Classification determines how this financial instrument is measured. It must be assessed before ECL is calculated — ECL only applies to instruments at Amortised Cost or FVOCI.
            </div>
          </div>
          <div className="px-5 pb-5 pt-0 space-y-6 border-t border-[#f1f5f9]">
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-[#334155] border-b border-[#f1f5f9] pb-2">Instrument details</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium text-[#64748b]">Instrument name</label>
                    <input
                      className="mt-1 w-full rounded-lg border border-[#e2e8f0] px-3 py-2 text-sm"
                      placeholder="e.g. Corporate Loan Portfolio"
                      value={clsInstrumentName}
                      onChange={(e) => setClsInstrumentName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-[#64748b]">Instrument type</label>
                    <select
                      className="mt-1 w-full rounded-lg border border-[#e2e8f0] px-3 py-2 text-sm bg-white"
                      value={clsInstrumentType}
                      onChange={(e) => setClsInstrumentType(e.target.value)}
                    >
                      <option value="loan">Loan</option>
                      <option value="bond">Bond</option>
                      <option value="trade_receivable">Trade receivable</option>
                      <option value="lease_receivable">Lease receivable</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-[#334155]">Business model indicators</h3>
                  <p className="text-xs text-[#64748b] mt-0.5">Select all that apply to this portfolio&apos;s management intent</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-[#475569]">Hold to collect</p>
                    {[
                      ['hold_to_maturity', 'Hold to maturity — collect cash flows only'],
                      ['contractual_cash_flows_only', 'Contractual cash flows only — no trading'],
                      ['infrequent_sales', 'Sales infrequent and insignificant'],
                      ['no_trading_intent', 'No trading intent'],
                    ].map(([key, label]) => (
                      <label key={key} className="flex items-start gap-2 text-sm text-[#334155] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={clsBusinessIndicators.includes(key)}
                          onChange={() => toggleClsIndicator(key)}
                          className="mt-1 rounded border-[#cbd5e1]"
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-[#475569]">Hold to collect &amp; sell</p>
                    {[
                      ['liquidity_management', 'Liquidity management requires sales'],
                      ['frequent_sales', 'Frequent sales are part of strategy'],
                      ['available_for_sale_intent', 'Available-for-sale intent'],
                      ['benchmark_performance', 'Performance measured vs benchmark'],
                    ].map(([key, label]) => (
                      <label key={key} className="flex items-start gap-2 text-sm text-[#334155] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={clsBusinessIndicators.includes(key)}
                          onChange={() => toggleClsIndicator(key)}
                          className="mt-1 rounded border-[#cbd5e1]"
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-[#64748b]">Current assessment:</span>
                  <span
                    className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                      liveBm.key === 'HOLD_TO_COLLECT'
                        ? 'bg-green-100 text-green-800'
                        : liveBm.key === 'HOLD_TO_COLLECT_AND_SELL'
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {liveBm.key === 'HOLD_TO_COLLECT'
                      ? 'HOLD TO COLLECT'
                      : liveBm.key === 'HOLD_TO_COLLECT_AND_SELL'
                        ? 'HOLD TO COLLECT AND SELL'
                        : 'OTHER'}
                  </span>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-[#334155]">SPPI test — instrument features</h3>
                  <p className="text-xs text-[#64748b] mt-0.5">Check any features present in this instrument</p>
                </div>
                <p className="text-xs font-medium text-[#475569]">Features that may fail SPPI</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[
                    ['leverage', 'Leverage (returns amplified beyond principal)'],
                    ['convertible', 'Convertible to equity'],
                    ['equity_linked', 'Equity-linked returns'],
                    ['inverse_floating', 'Inverse floating rate'],
                    ['non_recourse', 'Non-recourse (limited recourse to assets)'],
                    ['contractual_linkage', 'Contractual linkage to non-SPPI instrument'],
                  ].map(([key, label]) => (
                    <label key={key} className="flex items-start gap-2 text-sm text-[#334155] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={clsSppiFeatures.includes(key)}
                        onChange={() => toggleClsSppi(key)}
                        className="mt-1 rounded border-[#cbd5e1]"
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs font-medium text-[#475569] pt-2">Features consistent with SPPI</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[
                    ['fixed_rate', 'Fixed rate'],
                    ['floating_rate', 'Floating rate (LIBOR/SOFR benchmark)'],
                    ['variable_rate_benchmark', 'Variable rate linked to benchmark'],
                    ['prepayment_option', 'Prepayment option'],
                  ].map(([key, label]) => (
                    <label key={key} className="flex items-start gap-2 text-sm text-[#334155] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={clsSppiFeatures.includes(key)}
                        onChange={() => toggleClsSppi(key)}
                        className="mt-1 rounded border-[#cbd5e1]"
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
                {clsSppiFeatures.includes('prepayment_option') && (
                  <div className="rounded-lg bg-[#f8fafc] border border-[#e2e8f0] p-3 text-sm">
                    <p className="text-[#334155] mb-2">Is the prepayment penalty reasonable compensation? (IFRS 9.B4.1.12)</p>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={clsPrepaymentReasonable ? 'primary' : 'secondary'}
                        onClick={() => setClsPrepaymentReasonable(true)}
                      >
                        Yes
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={!clsPrepaymentReasonable ? 'primary' : 'secondary'}
                        onClick={() => setClsPrepaymentReasonable(false)}
                      >
                        No
                      </Button>
                    </div>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-[#64748b]">SPPI result:</span>
                  <span
                    className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                      liveSppi.pass ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {liveSppi.pass ? 'PASS ✓' : 'FAIL ✗'}
                  </span>
                </div>
                {!liveSppi.pass && liveSppi.reasons.length > 0 && (
                  <ul className="text-xs text-red-700 list-disc pl-5 space-y-0.5">
                    {liveSppi.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="space-y-3 border-t border-[#f1f5f9] pt-4">
                <label className="flex items-center gap-2 text-sm text-[#334155] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={clsFairValueOption}
                    onChange={(e) => setClsFairValueOption(e.target.checked)}
                    className="rounded border-[#cbd5e1]"
                  />
                  Elect fair value option (FVTPL)
                </label>
                {clsFairValueOption && (
                  <div>
                    <label className="text-xs font-medium text-[#64748b]">Reason for FVO election</label>
                    <input
                      className="mt-1 w-full rounded-lg border border-[#e2e8f0] px-3 py-2 text-sm"
                      placeholder="e.g. Eliminates accounting mismatch with related liability"
                      value={clsFvoReason}
                      onChange={(e) => setClsFvoReason(e.target.value)}
                    />
                  </div>
                )}
                <label className="flex items-center gap-2 text-sm text-[#334155] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={clsBusinessModelChanged}
                    onChange={(e) => setClsBusinessModelChanged(e.target.checked)}
                    className="rounded border-[#cbd5e1]"
                  />
                  Business model has changed since initial recognition
                </label>
              </div>

              {(liveMeasurement === 'AMORTISED_COST' || liveMeasurement === 'FVOCI') && (
                <div className="rounded-[12px] border border-[#e2e8f0] overflow-hidden">
                  <button
                    type="button"
                    className="w-full flex items-center justify-between px-4 py-3 text-left text-sm font-medium text-[#334155] bg-[#f8fafc]"
                    onClick={() => setClsEirOpen((o) => !o)}
                  >
                    Calculate effective interest rate (EIR)
                    {clsEirOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  {clsEirOpen && (
                    <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                      <div>
                        <label className="text-xs text-[#64748b]">Nominal rate (% p.a.)</label>
                        <input
                          className="mt-1 w-full rounded-lg border border-[#e2e8f0] px-3 py-2"
                          placeholder="e.g. 5 or 0.05"
                          value={clsNominalRate}
                          onChange={(e) => setClsNominalRate(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-[#64748b]">Issue price ($)</label>
                        <input
                          className="mt-1 w-full rounded-lg border border-[#e2e8f0] px-3 py-2"
                          value={clsIssuePrice}
                          onChange={(e) => setClsIssuePrice(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-[#64748b]">Face value ($)</label>
                        <input
                          className="mt-1 w-full rounded-lg border border-[#e2e8f0] px-3 py-2"
                          value={clsFaceValue}
                          onChange={(e) => setClsFaceValue(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-[#64748b]">Term (months)</label>
                        <input
                          className="mt-1 w-full rounded-lg border border-[#e2e8f0] px-3 py-2"
                          value={clsTermMonths}
                          onChange={(e) => setClsTermMonths(e.target.value)}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              <Button
                type="button"
                disabled={classificationLoading}
                onClick={handleClassifyInstrument}
                className="w-full bg-gradient-to-r from-[#0f172a] via-[#1e3a5f] to-[#0f172a] hover:opacity-95 text-white py-3 rounded-xl font-semibold shadow-md"
              >
                {classificationLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin inline" />
                    Classifying…
                  </>
                ) : (
                  'Classify instrument'
                )}
              </Button>

              {classificationResult && (
                <div className="space-y-4 pt-2">
                  {classificationResult.measurement === 'AMORTISED_COST' && (
                    <div className="rounded-xl p-5 text-white bg-gradient-to-br from-[#0f172a] to-[#1e3a8a] shadow-lg">
                      <p className="text-lg font-bold tracking-wide">AMORTISED COST</p>
                      <p className="text-sm mt-2 opacity-95">ECL applies ✓ — proceed to calculate</p>
                      <p className="text-xs mt-3 opacity-90">Audit risk: {classificationResult.audit_risk}</p>
                    </div>
                  )}
                  {classificationResult.measurement === 'FVOCI' && (
                    <div className="rounded-xl p-5 text-white bg-gradient-to-br from-[#0d9488] to-[#115e59] shadow-lg">
                      <p className="text-lg font-bold tracking-wide">FAIR VALUE THROUGH OCI</p>
                      <p className="text-sm mt-2 opacity-95">ECL applies ✓ — proceed to calculate</p>
                      <p className="text-xs mt-3 opacity-90">Audit risk: {classificationResult.audit_risk}</p>
                    </div>
                  )}
                  {classificationResult.measurement === 'FVTPL' && (
                    <div className="rounded-xl p-5 text-white bg-gradient-to-br from-[#ea580c] to-[#c2410c] shadow-lg">
                      <p className="text-lg font-bold tracking-wide">FAIR VALUE THROUGH P&amp;L</p>
                      <p className="text-sm mt-2 opacity-95">ECL does NOT apply</p>
                      <p className="text-xs mt-3 opacity-90">Audit risk: {classificationResult.audit_risk}</p>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[#64748b]">Business model:</span>
                      <span className="font-medium text-[#1e293b]">{classificationResult.business_model_label}</span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                          classificationResult.business_model === 'HOLD_TO_COLLECT'
                            ? 'bg-green-100 text-green-800'
                            : classificationResult.business_model === 'HOLD_TO_COLLECT_AND_SELL'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {classificationResult.business_model === 'HOLD_TO_COLLECT'
                          ? 'Hold to collect'
                          : classificationResult.business_model === 'HOLD_TO_COLLECT_AND_SELL'
                            ? 'Collect & sell'
                            : 'Other'}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[#64748b]">SPPI test:</span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                          classificationResult.sppi_pass ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {classificationResult.sppi_pass ? 'Pass' : 'Fail'}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[#64748b]">ECL applies:</span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                          classificationResult.ecl_applies ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {classificationResult.ecl_applies ? 'Yes' : 'No'}
                      </span>
                    </div>
                  </div>

                  <div className="rounded-lg bg-[#f1f5f9] p-4 text-sm font-serif text-[#334155]">
                    <span className="font-semibold">P&amp;L impact: </span>
                    {classificationResult.p_and_l_impact}
                  </div>
                  <div className="rounded-lg bg-[#f1f5f9] p-4 text-sm font-serif text-[#334155]">
                    <span className="font-semibold">Balance sheet: </span>
                    {classificationResult.balance_sheet}
                  </div>

                  {classificationResult.sppi_failure_reasons.length > 0 && (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
                      <p className="font-semibold mb-2">⚠ SPPI test failed:</p>
                      <ul className="list-disc pl-5 space-y-1">
                        {classificationResult.sppi_failure_reasons.map((x) => (
                          <li key={x}>{x}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-3 text-sm">
                    <span className="text-[#64748b]">Classification confidence:</span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                        classificationResult.classification_confidence === 'HIGH'
                          ? 'bg-green-100 text-green-800'
                          : classificationResult.classification_confidence === 'MEDIUM'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {classificationResult.classification_confidence}
                    </span>
                    <span className="text-[#64748b]">Audit risk:</span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                        classificationResult.audit_risk === 'LOW'
                          ? 'bg-green-100 text-green-800'
                          : classificationResult.audit_risk === 'MEDIUM'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {classificationResult.audit_risk}
                    </span>
                  </div>

                  {classificationResult.eir_annual != null && (
                    <div>
                      <p className="text-2xl font-bold text-[#0f172a]">
                        Effective interest rate: {(classificationResult.eir_annual * 100).toFixed(2)}% per annum
                      </p>
                      {classificationResult.amortised_cost_schedule.length > 0 && (
                        <div className="mt-3 overflow-x-auto rounded-lg border border-[#e2e8f0]">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-[#f8fafc]">
                                <th className="text-left py-2 px-3">Period</th>
                                <th className="text-right py-2 px-3">Opening balance</th>
                                <th className="text-right py-2 px-3">Interest income</th>
                                <th className="text-right py-2 px-3">Cash received</th>
                                <th className="text-right py-2 px-3">Closing balance</th>
                              </tr>
                            </thead>
                            <tbody>
                              {classificationResult.amortised_cost_schedule.map((row) => (
                                <tr key={row.period} className="border-t border-[#f1f5f9]">
                                  <td className="py-2 px-3">{row.period}</td>
                                  <td className="text-right py-2 px-3 font-mono">{formatIndianCurrency(row.opening_balance)}</td>
                                  <td className="text-right py-2 px-3 font-mono">{formatIndianCurrency(row.interest_income)}</td>
                                  <td className="text-right py-2 px-3 font-mono">{formatIndianCurrency(row.cash_received)}</td>
                                  <td className="text-right py-2 px-3 font-mono">{formatIndianCurrency(row.closing_balance)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                  {classificationResult.eir_note ? (
                    <p className="text-xs text-[#64748b]">{classificationResult.eir_note}</p>
                  ) : null}

                  <p className="text-xs text-[#64748b]">{classificationResult.reclassification_note}</p>

                  <div
                    className="rounded-lg bg-[#f1f5f9] p-4 text-[#1e293b] whitespace-pre-wrap"
                    style={{ fontFamily: 'Times New Roman, Times, serif', fontSize: 11 }}
                  >
                    {classificationResult.explanation}
                  </div>
                </div>
              )}
            </div>
        </div>
        )}

        {(activeNavId === 'macro-overlay') && (
        <div className="bg-white rounded-[14px] border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)] overflow-hidden">
          <div className="px-5 py-4 border-b border-[#e2e8f0]">
            <div>
              <h2 className="text-base font-bold text-[#1e293b]">Forward-Looking Macro Overlay</h2>
              <p className="text-xs text-[#64748b] mt-0.5">IFRS 9.5.5.17 scenario PDs and probability-weighted ECL</p>
            </div>
          </div>
          <div className="px-5 pb-3 border-t border-[#e2e8f0]">
            <div className="mt-3 rounded-[12px] border border-[#bfdbfe] bg-[#eff6ff] p-4 text-sm text-[#1e3a5f]">
              IFRS 9.5.5.17 requires forward-looking macroeconomic information to be incorporated into ECL calculations. This module adjusts your base PD across three economic scenarios and probability-weights the result.
            </div>
          </div>
          <div className="px-5 pb-5 space-y-6 border-t border-[#f1f5f9]">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-[#64748b]">Portfolio name</label>
                  <input
                    className="mt-1 w-full rounded-lg border border-[#e2e8f0] px-3 py-2 text-sm"
                    value={macroPortfolioName}
                    onChange={(e) => setMacroPortfolioName(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-xs font-medium text-[#64748b]">Base PD (%)</label>
                    <input
                      className="mt-1 w-full rounded-lg border border-[#e2e8f0] px-3 py-2 text-sm"
                      value={macroBasePd}
                      onChange={(e) => setMacroBasePd(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-[#64748b]">LGD (%)</label>
                    <input
                      className="mt-1 w-full rounded-lg border border-[#e2e8f0] px-3 py-2 text-sm"
                      value={macroLgd}
                      onChange={(e) => setMacroLgd(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-[#64748b]">EAD ($)</label>
                    <input
                      className="mt-1 w-full rounded-lg border border-[#e2e8f0] px-3 py-2 text-sm"
                      value={macroEad}
                      onChange={(e) => setMacroEad(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {(
                  [
                    {
                      key: 'opt',
                      title: 'Optimistic',
                      sub: 'Upside',
                      head: 'bg-green-600',
                      sc: scOpt,
                      set: setScOpt,
                    },
                    {
                      key: 'base',
                      title: 'Base',
                      sub: 'Most likely',
                      head: 'bg-blue-600',
                      sc: scBase,
                      set: setScBase,
                    },
                    {
                      key: 'pess',
                      title: 'Pessimistic',
                      sub: 'Downside',
                      head: 'bg-red-600',
                      sc: scPess,
                      set: setScPess,
                    },
                  ] as const
                ).map((col) => (
                  <div key={col.key} className="rounded-xl border border-[#e2e8f0] overflow-hidden">
                    <div className={`${col.head} text-white px-3 py-2`}>
                      <p className="text-sm font-bold">{col.title}</p>
                      <p className="text-[10px] opacity-90">{col.sub}</p>
                    </div>
                    <div className="p-3 space-y-2 text-sm bg-white">
                      {(
                        [
                          ['probability', 'Probability (%)'],
                          ['gdp', 'GDP growth (%)'],
                          ['unemp', 'Unemployment (%)'],
                          ['rate', 'Interest rate (%)'],
                          ['prop', 'Property price chg (%)'],
                          ['spread', 'Credit spread (%)'],
                        ] as const
                      ).map(([field, label]) => (
                        <div key={field}>
                          <label className="text-[10px] text-[#64748b]">{label}</label>
                          <input
                            className="mt-0.5 w-full rounded border border-[#e2e8f0] px-2 py-1 text-sm"
                            value={
                              field === 'probability'
                                ? col.sc.probability
                                : field === 'gdp'
                                  ? col.sc.gdp
                                  : field === 'unemp'
                                    ? col.sc.unemp
                                    : field === 'rate'
                                      ? col.sc.rate
                                      : field === 'prop'
                                        ? col.sc.prop
                                        : col.sc.spread
                            }
                            onChange={(e) => {
                              const v = e.target.value;
                              col.set((prev) => ({ ...prev, [field]: v }));
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="space-y-3">
                <p className={`text-sm font-medium ${macroProbOk ? 'text-green-700' : 'text-red-600'}`}>
                  Probabilities: {macroProbSumPct.toFixed(1)}% — must total 100%
                </p>
                <Button
                  type="button"
                  disabled={macroLoading || !macroProbOk}
                  onClick={handleRunMacroOverlay}
                  className="w-full bg-gradient-to-r from-[#0f172a] via-[#1e3a5f] to-[#0f172a] text-white py-3 rounded-xl font-semibold"
                >
                  {macroLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin inline" />
                      Running…
                    </>
                  ) : (
                    'Run Macro Overlay'
                  )}
                </Button>
              </div>

              {macroOverlayResult && (
                <div className="space-y-6 pt-2 border-t border-[#e2e8f0]">
                  <div>
                    <h3 className="text-sm font-semibold text-[#334155] mb-3">ECL comparison</h3>
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart layout="vertical" data={macroBarChartData} margin={{ top: 8, right: 100, left: 8, bottom: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                        <XAxis type="number" tickFormatter={(v) => formatIndianCurrency(Number(v))} />
                        <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11 }} />
                        <Tooltip formatter={(v, n) => formatRechartsTooltipPair(v, n)} />
                        <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                          {macroBarChartData.map((e, i) => (
                            <Cell key={i} fill={e.fill} stroke={e.thick ? '#0f172a' : undefined} strokeWidth={e.thick ? 2 : 0} />
                          ))}
                          <LabelList
                            dataKey="value"
                            position="right"
                            formatter={((v: unknown) => formatRechartsTooltipString(v)) as (label: unknown) => string}
                            className="text-xs fill-[#334155]"
                          />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {[
                      ['Point-in-time ECL', macroOverlayResult.point_in_time_ecl, 'NEUTRAL'],
                      ['Prob-weighted ECL', macroOverlayResult.probability_weighted_ecl, 'NEUTRAL'],
                      [
                        'Macro overlay impact',
                        macroOverlayResult.macro_overlay_impact,
                        macroOverlayResult.overlay_direction,
                      ],
                      ['Overlay %', macroOverlayResult.overlay_pct, macroOverlayResult.overlay_direction],
                    ].map(([label, val, dir]) => {
                      const d = dir as string;
                      const isImpact = String(label).includes('impact') || String(label).includes('Overlay %');
                      const inc = d === 'INCREASE';
                      const dec = d === 'DECREASE';
                      const cls =
                        isImpact && inc
                          ? 'text-red-600'
                          : isImpact && dec
                            ? 'text-green-600'
                            : isImpact
                              ? 'text-[#64748b]'
                              : 'text-[#1e293b]';
                      const arrow = isImpact ? (inc ? ' ▲' : dec ? ' ▼' : '') : '';
                      return (
                        <div key={String(label)} className="rounded-lg border border-[#e2e8f0] p-4 bg-[#fafafa]">
                          <p className="text-xs text-[#64748b] mb-1">{label}</p>
                          <p className={`text-lg font-bold font-mono ${cls}`}>
                            {String(label).includes('%') && typeof val === 'number'
                              ? `${(val as number).toFixed(2)}%${arrow}`
                              : `${formatIndianCurrency(Number(val))}${arrow}`}
                          </p>
                        </div>
                      );
                    })}
                  </div>

                  <div className="overflow-x-auto rounded-lg border border-[#e2e8f0]">
                    <table className="w-full text-sm min-w-[640px]">
                      <thead>
                        <tr className="bg-[#f8fafc]">
                          <th className="text-left py-2 px-3">Scenario</th>
                          <th className="text-right py-2 px-3">Prob</th>
                          <th className="text-right py-2 px-3">GDP</th>
                          <th className="text-right py-2 px-3">Unemp</th>
                          <th className="text-right py-2 px-3">Adj PD</th>
                          <th className="text-right py-2 px-3">PD change</th>
                          <th className="text-right py-2 px-3">ECL</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(
                          [
                            ['Optimistic', macroOverlayResult.scenarios.optimistic, 'bg-green-50'],
                            ['Base', macroOverlayResult.scenarios.base, 'bg-blue-50'],
                            ['Pessimistic', macroOverlayResult.scenarios.pessimistic, 'bg-red-50'],
                          ] as const
                        ).map(([name, s, bg]) => (
                          <tr key={name} className={`border-t border-[#e2e8f0] ${bg}`}>
                            <td className="py-2 px-3 font-medium">{name}</td>
                            <td className="text-right py-2 px-3">{(s.probability * 100).toFixed(0)}%</td>
                            <td className="text-right py-2 px-3">{s.macro_variables.gdp_growth}%</td>
                            <td className="text-right py-2 px-3">{s.macro_variables.unemployment_rate}%</td>
                            <td className="text-right py-2 px-3 font-mono">{s.pd_adjusted.toFixed(2)}%</td>
                            <td
                              className={`text-right py-2 px-3 font-mono ${
                                s.pd_adjustment > 0 ? 'text-red-600' : s.pd_adjustment < 0 ? 'text-green-600' : ''
                              }`}
                            >
                              {s.pd_adjustment > 0 ? '+' : ''}
                              {s.pd_adjustment.toFixed(2)} pp
                            </td>
                            <td className="text-right py-2 px-3 font-mono">{formatIndianCurrency(s.ecl)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div>
                    <p className="text-xs font-medium text-[#64748b] mb-2">PD range</p>
                    <div className="relative h-14 flex items-center">
                      <div className="absolute left-0 right-0 top-1/2 h-0.5 bg-[#cbd5e1]" />
                      {(
                        [
                          ['Optimistic', macroOverlayResult.pd_range.optimistic, 'bg-green-500'],
                          ['Base', macroOverlayResult.pd_range.base, 'bg-blue-600'],
                          ['Pessimistic', macroOverlayResult.pd_range.pessimistic, 'bg-red-500'],
                        ] as const
                      ).map(([label, pct, dot]) => (
                        <div key={label} className="flex-1 flex flex-col items-center z-10">
                          <span className={`w-3 h-3 rounded-full ${dot} ring-2 ring-white shadow`} />
                          <span className="text-[10px] text-[#64748b] mt-1">{label}</span>
                          <span className="text-xs font-mono font-semibold">{pct.toFixed(2)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold text-[#334155] mb-2">GDP sensitivity (ECL vs GDP growth)</h3>
                    <ResponsiveContainer width="100%" height={240}>
                      <LineChart data={macroGdpLineData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="gdp" tickFormatter={(v) => `${v}%`} />
                        <YAxis tickFormatter={(v) => formatIndianCurrency(Number(v))} />
                        <Tooltip
                          formatter={(v, n) => formatRechartsTooltipPair(v, n)}
                          labelFormatter={(l) => `GDP ${String(l)}%`}
                        />
                        <ReferenceLine x={parseFloat(scBase.gdp) || 0} stroke="#94a3b8" strokeDasharray="4 4" />
                        <Line type="monotone" dataKey="ecl" stroke="#f97316" strokeWidth={2} dot={{ r: 3 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  {macroOverlayResult.staging_migrations > 0 ? (
                    <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-900">
                      <p className="font-semibold">⚠ Staging migration risk</p>
                      <p className="mt-1">
                        Under the pessimistic scenario, {macroOverlayResult.staging_migrations} loan(s) (EAD{' '}
                        {formatIndianCurrency(macroOverlayResult.migration_ead)}) may migrate to a higher stage, significantly increasing lifetime ECL.
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-900">
                      ✓ No staging migrations expected under pessimistic scenario.
                    </div>
                  )}

                  <div className="rounded-lg border border-[#e2e8f0] p-4 space-y-2">
                    <p className="text-sm font-semibold text-[#334155]">IFRS 9 compliance checklist</p>
                    <ul className="text-sm text-green-800 space-y-1">
                      <li>✓ Forward-looking information incorporated</li>
                      <li>✓ Multiple economic scenarios assessed</li>
                      <li>✓ Probability-weighted ECL calculated</li>
                      <li>
                        ✓ Macro variables:{' '}
                        {(macroOverlayResult.ifrs9_compliance?.macro_variables_used ?? []).join(', ') || '—'}
                      </li>
                    </ul>
                    <p className="text-xs text-[#64748b] pt-2">
                      Overlay adequacy:{' '}
                      <span
                        className={`font-semibold ${
                          macroOverlayResult.overlay_adequacy === 'ADEQUATE'
                            ? 'text-green-700'
                            : macroOverlayResult.overlay_adequacy === 'REVIEW_REQUIRED'
                              ? 'text-orange-600'
                              : 'text-red-600'
                        }`}
                      >
                        {macroOverlayResult.overlay_adequacy.replace(/_/g, ' ')}
                      </span>
                    </p>
                  </div>

                  <div>
                    <p className="text-xs font-semibold text-[#64748b] mb-1">IFRS 9.5.5.17 compliance assessment</p>
                    <div
                      className="rounded-lg bg-[#f1f5f9] p-4 text-[#1e293b] whitespace-pre-wrap"
                      style={{ fontFamily: 'Times New Roman, Times, serif', fontSize: 11 }}
                    >
                      {macroOverlayResult.narrative}
                    </div>
                  </div>
                </div>
              )}
            </div>
        </div>
        )}

        {(activeNavId === 'provision-matrix') && (
        <div className="bg-white rounded-[14px] border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)] overflow-hidden">
          <div className="px-5 py-4 border-b border-[#e2e8f0]">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold text-[#1e293b]">Provision Matrix</h2>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-teal-100 text-teal-900 border border-teal-200">
                IFRS 9.5.5.15
              </span>
              <p className="text-xs text-[#64748b] w-full sm:w-auto sm:ml-2">Simplified Approach (IFRS 9.5.5.15)</p>
            </div>
          </div>
          <div className="px-5 pb-3 border-t border-[#e2e8f0]">
            <div className="mt-3 rounded-[12px] border border-[#bfdbfe] bg-[#eff6ff] p-4 text-sm text-[#1e3a5f]">
              Groups receivables by ageing bucket and applies historical loss rates. Suitable for trade receivables, contract assets (IFRS 15), and lease
              receivables (IFRS 16).
            </div>
          </div>
          <div className="px-5 pb-5 space-y-6 border-t border-[#f1f5f9]">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs font-medium text-[#64748b]">Portfolio name</label>
                  <input
                    className="mt-1 w-full rounded-lg border border-[#e2e8f0] px-3 py-2 text-sm"
                    placeholder="e.g. Trade Receivables — AU"
                    value={provisionPortfolioName}
                    onChange={(e) => setProvisionPortfolioName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-[#64748b]">Receivable type</label>
                  <select
                    className="mt-1 w-full rounded-lg border border-[#e2e8f0] px-3 py-2 text-sm bg-white"
                    value={provisionReceivableType}
                    onChange={(e) => setProvisionReceivableType(e.target.value)}
                  >
                    <option value="trade_receivables">Trade receivables</option>
                    <option value="contract_assets">Contract assets</option>
                    <option value="lease_receivables">Lease receivables</option>
                    <option value="intercompany">Intercompany</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-[#64748b]">Reporting date</label>
                  <input
                    type="date"
                    className="mt-1 w-full rounded-lg border border-[#e2e8f0] px-3 py-2 text-sm"
                    value={provisionDate}
                    onChange={(e) => setProvisionDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-[#64748b]" title="+ = worse conditions, − = better">
                    Macro adjustment (%)
                  </label>
                  <input
                    type="number"
                    step={0.1}
                    className="mt-1 w-full rounded-lg border border-[#e2e8f0] px-3 py-2 text-sm"
                    value={provisionFLA === 0 ? '' : provisionFLA}
                    placeholder="0"
                    onChange={(e) => setProvisionFLA(parseFloat(e.target.value) || 0)}
                  />
                  <p className="text-[10px] text-[#64748b] mt-0.5">+ worse conditions · − better conditions</p>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-[#64748b]">Write-offs this period ($)</label>
                <input
                  className="mt-1 w-full max-w-xs rounded-lg border border-[#e2e8f0] px-3 py-2 text-sm"
                  placeholder="0"
                  value={provisionWriteoffs}
                  onChange={(e) => setProvisionWriteoffs(e.target.value)}
                />
              </div>

              <div className="flex rounded-lg border border-[#e2e8f0] overflow-hidden text-sm font-semibold max-w-md">
                <button
                  type="button"
                  className={`flex-1 py-2 ${provisionMode === 'invoices' ? 'bg-[#0f172a] text-white' : 'bg-white text-[#64748b]'}`}
                  onClick={() => setProvisionMode('invoices')}
                >
                  Individual invoices
                </button>
                <button
                  type="button"
                  className={`flex-1 py-2 ${provisionMode === 'buckets' ? 'bg-[#0f172a] text-white' : 'bg-white text-[#64748b]'}`}
                  onClick={() => setProvisionMode('buckets')}
                >
                  Bucket totals
                </button>
              </div>

              {provisionMode === 'buckets' ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[480px]">
                    <thead>
                      <tr className="bg-[#f8fafc]">
                        <th className="text-left py-2 px-3">Bucket</th>
                        <th className="text-right py-2 px-3">Gross amount ($)</th>
                        <th className="text-right py-2 px-3">Loss rate (%)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bucketInputs.map((row, idx) => (
                        <tr key={row.label} className="border-t border-[#e2e8f0]">
                          <td className="py-2 px-3 font-medium">{row.label}</td>
                          <td className="text-right py-2 px-3">
                            <input
                              type="number"
                              className="w-full max-w-[140px] ml-auto rounded border border-[#e2e8f0] px-2 py-1 text-right"
                              value={row.gross || ''}
                              placeholder="0"
                              onChange={(e) => {
                                const v = parseFloat(e.target.value) || 0;
                                setBucketInputs((prev) => prev.map((r, i) => (i === idx ? { ...r, gross: v } : r)));
                              }}
                            />
                          </td>
                          <td className="text-right py-2 px-3">
                            <input
                              type="number"
                              step={0.1}
                              className="w-full max-w-[100px] ml-auto rounded border border-[#e2e8f0] px-2 py-1 text-right"
                              value={row.rate}
                              onChange={(e) => {
                                const v = parseFloat(e.target.value) || 0;
                                setBucketInputs((prev) => prev.map((r, i) => (i === idx ? { ...r, rate: v } : r)));
                              }}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-xs text-[#64748b] italic mt-2">
                    Default loss rates shown. Replace with entity-specific historical rates for IFRS 9 compliance.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <label className="inline-flex items-center px-3 py-2 rounded-lg border border-[#e2e8f0] text-sm cursor-pointer bg-[#f8fafc] hover:bg-[#f1f5f9]">
                      <Upload className="w-4 h-4 mr-2" />
                      Upload CSV
                      <input type="file" accept=".csv" className="hidden" onChange={handleProvisionCsv} />
                    </label>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        setProvisionRows((prev) => [
                          ...prev,
                          { invoice_id: '', customer: '', gross_amount: 0, days_past_due: 0 },
                        ])
                      }
                    >
                      + Add invoice
                    </Button>
                  </div>
                  <div className="overflow-x-auto rounded-lg border border-[#e2e8f0]">
                    <table className="w-full text-sm min-w-[560px]">
                      <thead>
                        <tr className="bg-[#f8fafc]">
                          <th className="text-left py-2 px-3">Invoice ID</th>
                          <th className="text-left py-2 px-3">Customer</th>
                          <th className="text-right py-2 px-3">Amount ($)</th>
                          <th className="text-right py-2 px-3">Days past due</th>
                          <th className="w-10" />
                        </tr>
                      </thead>
                      <tbody>
                        {provisionRows.map((row, idx) => (
                          <tr key={idx} className="border-t border-[#e2e8f0]">
                            <td className="py-1 px-2">
                              <input
                                className="w-full rounded border border-[#e2e8f0] px-2 py-1 text-sm"
                                value={row.invoice_id}
                                onChange={(e) =>
                                  setProvisionRows((p) => p.map((r, i) => (i === idx ? { ...r, invoice_id: e.target.value } : r)))
                                }
                              />
                            </td>
                            <td className="py-1 px-2">
                              <input
                                className="w-full rounded border border-[#e2e8f0] px-2 py-1 text-sm"
                                value={row.customer}
                                onChange={(e) =>
                                  setProvisionRows((p) => p.map((r, i) => (i === idx ? { ...r, customer: e.target.value } : r)))
                                }
                              />
                            </td>
                            <td className="py-1 px-2 text-right">
                              <input
                                type="number"
                                className="w-full max-w-[120px] ml-auto rounded border border-[#e2e8f0] px-2 py-1 text-sm text-right"
                                value={row.gross_amount || ''}
                                placeholder="0"
                                onChange={(e) =>
                                  setProvisionRows((p) =>
                                    p.map((r, i) => (i === idx ? { ...r, gross_amount: parseFloat(e.target.value) || 0 } : r))
                                  )
                                }
                              />
                            </td>
                            <td className="py-1 px-2 text-right">
                              <input
                                type="number"
                                className="w-full max-w-[90px] ml-auto rounded border border-[#e2e8f0] px-2 py-1 text-sm text-right"
                                value={row.days_past_due}
                                onChange={(e) =>
                                  setProvisionRows((p) =>
                                    p.map((r, i) => (i === idx ? { ...r, days_past_due: parseInt(e.target.value, 10) || 0 } : r))
                                  )
                                }
                              />
                            </td>
                            <td className="py-1 px-1 text-center">
                              <button
                                type="button"
                                className="p-1 text-[#64748b] hover:text-red-600"
                                aria-label="Delete row"
                                onClick={() => setProvisionRows((p) => (p.length <= 1 ? p : p.filter((_, i) => i !== idx)))}
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <Button
                type="button"
                disabled={provisionLoading}
                onClick={handleProvisionMatrix}
                className="w-full bg-gradient-to-r from-[#0f172a] via-[#1e3a5f] to-[#0f172a] text-white py-3 rounded-xl font-semibold"
              >
                {provisionLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin inline" />
                    Calculating…
                  </>
                ) : (
                  'Calculate provision'
                )}
              </Button>

              {provisionResult && (
                <div className="space-y-6 pt-4 border-t border-[#e2e8f0]">
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="rounded-lg border border-[#e2e8f0] p-4 bg-[#fafafa]">
                      <p className="text-xs text-[#64748b] mb-1">Total gross receivables</p>
                      <p className="text-lg font-bold font-mono text-blue-600">{formatIndianCurrency(provisionResult.totals.gross_amount)}</p>
                    </div>
                    <div className="rounded-lg border border-[#e2e8f0] p-4 bg-[#fafafa]">
                      <p className="text-xs text-[#64748b] mb-1">Total provision</p>
                      <p className="text-lg font-bold font-mono text-red-600">{formatIndianCurrency(provisionResult.totals.total_provision)}</p>
                    </div>
                    <div className="rounded-lg border border-[#e2e8f0] p-4 bg-[#fafafa]">
                      <p className="text-xs text-[#64748b] mb-1">Net receivables</p>
                      <p className="text-lg font-bold font-mono text-green-700">{formatIndianCurrency(provisionResult.totals.net_amount)}</p>
                    </div>
                    <div className="rounded-lg border border-[#e2e8f0] p-4 bg-[#fafafa]">
                      <p className="text-xs text-[#64748b] mb-1">Coverage ratio</p>
                      <p
                        className={`text-lg font-bold font-mono ${
                          provisionResult.totals.overall_coverage_pct < 2
                            ? 'text-green-700'
                            : provisionResult.totals.overall_coverage_pct <= 5
                              ? 'text-orange-600'
                              : 'text-red-600'
                        }`}
                      >
                        {provisionResult.totals.overall_coverage_pct.toFixed(2)}%
                      </p>
                    </div>
                  </div>

                  <div className="overflow-x-auto rounded-lg border border-[#e2e8f0]">
                    <table className="w-full text-sm min-w-[900px]">
                      <thead>
                        <tr className="bg-[#f8fafc]">
                          <th className="text-left py-2 px-2">Bucket</th>
                          <th className="text-right py-2 px-2">Count</th>
                          <th className="text-right py-2 px-2">Gross ($)</th>
                          <th className="text-right py-2 px-2">Base rate %</th>
                          <th className="text-right py-2 px-2">FLA</th>
                          <th className="text-right py-2 px-2">Adj rate %</th>
                          <th className="text-right py-2 px-2">Provision ($)</th>
                          <th className="text-right py-2 px-2">Net ($)</th>
                          <th className="text-right py-2 px-2">Cover %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {provisionResult.buckets.map((b) => (
                          <tr
                            key={b.label}
                            className={`border-t border-[#e2e8f0] ${provisionRowBg(b.label)} group`}
                            title={
                              b.receivables?.length
                                ? b.receivables.map((r: { invoice_id?: string }) => r.invoice_id).join(', ')
                                : undefined
                            }
                          >
                            <td className="py-2 px-2 font-medium">{b.label}</td>
                            <td className="text-right py-2 px-2">{b.count}</td>
                            <td className="text-right py-2 px-2 font-mono">{formatIndianCurrency(b.gross_amount)}</td>
                            <td className="text-right py-2 px-2 font-mono">{(b.base_loss_rate * 100).toFixed(2)}</td>
                            <td className="text-right py-2 px-2 font-mono">{b.fla_applied.toFixed(4)}</td>
                            <td className="text-right py-2 px-2 font-mono">{(b.adjusted_loss_rate * 100).toFixed(2)}</td>
                            <td className="text-right py-2 px-2 font-mono text-red-600">{formatIndianCurrency(b.provision)}</td>
                            <td className="text-right py-2 px-2 font-mono">{formatIndianCurrency(b.net_amount)}</td>
                            <td className="text-right py-2 px-2 font-mono">{b.coverage_pct.toFixed(2)}</td>
                          </tr>
                        ))}
                        <tr className="bg-[#0f172a] text-white font-bold">
                          <td className="py-3 px-2">TOTAL</td>
                          <td className="text-right py-3 px-2">{provisionResult.totals.count}</td>
                          <td className="text-right py-3 px-2 font-mono">{formatIndianCurrency(provisionResult.totals.gross_amount)}</td>
                          <td className="text-right py-3 px-2 font-mono">{(provisionResult.totals.weighted_loss_rate * 100).toFixed(2)}</td>
                          <td className="text-right py-3 px-2">—</td>
                          <td className="text-right py-3 px-2">—</td>
                          <td className="text-right py-3 px-2 font-mono">{formatIndianCurrency(provisionResult.totals.total_provision)}</td>
                          <td className="text-right py-3 px-2 font-mono">{formatIndianCurrency(provisionResult.totals.net_amount)}</td>
                          <td className="text-right py-3 px-2 font-mono">{provisionResult.totals.overall_coverage_pct.toFixed(2)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {provisionStackedData.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-[#334155] mb-2">Ageing waterfall (net vs provision)</h3>
                      <ResponsiveContainer width="100%" height={280}>
                        <BarChart data={provisionStackedData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="short" tick={{ fontSize: 11 }} />
                          <YAxis tickFormatter={(v) => formatIndianCurrency(Number(v))} />
                          <Tooltip formatter={(v, n) => formatRechartsTooltipPair(v, n)} />
                          <Legend />
                          <Bar dataKey="net" name="Net amount" stackId="s" fill="#1D4ED8" />
                          <Bar dataKey="provision" name="Provision" stackId="s" fill="#DC2626" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-4 items-start">
                    <div>
                      <p className="text-xs text-[#64748b] mb-1">Bad debt risk</p>
                      <span
                        className={`inline-block px-3 py-1 rounded-full text-xs font-bold ${
                          provisionResult.bad_debt_risk === 'HIGH'
                            ? 'bg-red-600 text-white'
                            : provisionResult.bad_debt_risk === 'MEDIUM'
                              ? 'bg-orange-500 text-white'
                              : 'bg-green-600 text-white'
                        }`}
                      >
                        {provisionResult.bad_debt_risk}
                      </span>
                    </div>
                    <div>
                      <p className="text-xs text-[#64748b] mb-1">Concentration risk</p>
                      <span
                        className={`inline-block px-3 py-1 rounded-full text-xs font-bold ${
                          provisionResult.concentration_risk === 'HIGH'
                            ? 'bg-red-600 text-white'
                            : provisionResult.concentration_risk === 'MEDIUM'
                              ? 'bg-orange-500 text-white'
                              : 'bg-green-600 text-white'
                        }`}
                      >
                        {provisionResult.concentration_risk}
                      </span>
                    </div>
                  </div>
                  {provisionResult.concentration_note ? (
                    <p className="text-sm text-orange-600 italic">{provisionResult.concentration_note}</p>
                  ) : null}

                  {provisionResult.fla_applied !== 0 ? (
                    <div className="rounded-xl border border-[#bfdbfe] bg-[#eff6ff] p-4 space-y-3">
                      <p className="text-sm font-semibold text-[#1e3a5f]">Forward-looking adjustment applied</p>
                      <p className="text-sm text-[#334155]">{provisionResult.fla_note}</p>
                      <table className="w-full text-sm border border-[#e2e8f0] rounded-lg overflow-hidden">
                        <thead className="bg-[#f8fafc]">
                          <tr>
                            <th className="text-left py-2 px-2">Bucket</th>
                            <th className="text-right py-2 px-2">Base rate %</th>
                            <th className="text-right py-2 px-2">FLA</th>
                            <th className="text-right py-2 px-2">Final %</th>
                          </tr>
                        </thead>
                        <tbody>
                          {provisionResult.buckets.map((b) => {
                            const up = b.adjusted_loss_rate > b.base_loss_rate + 1e-12;
                            const down = b.adjusted_loss_rate < b.base_loss_rate - 1e-12;
                            return (
                              <tr key={b.label} className="border-t border-[#e2e8f0]">
                                <td className="py-2 px-2">{b.label}</td>
                                <td className="text-right py-2 px-2 font-mono">{(b.base_loss_rate * 100).toFixed(2)}</td>
                                <td className="text-right py-2 px-2 font-mono">{b.fla_applied.toFixed(4)}</td>
                                <td
                                  className={`text-right py-2 px-2 font-mono ${
                                    up ? 'text-red-600' : down ? 'text-green-600' : 'text-[#64748b]'
                                  }`}
                                >
                                  {(b.adjusted_loss_rate * 100).toFixed(2)}
                                  {up ? ' ↑' : down ? ' ↓' : ''}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-sm text-[#64748b] italic">
                      No forward-looking adjustment. Use Macro Overlay above to apply scenario adjustment (IFRS 9.5.5.17).
                    </p>
                  )}

                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-[#334155]">Journal entries</h3>
                    {provisionResult.journal_entries.map((je, i) => (
                      <div key={i} className="rounded-lg border border-[#e2e8f0] p-4 bg-[#fafafa] text-sm">
                        <p className="font-medium text-blue-800">Dr {je.dr_account}</p>
                        <p className="font-medium text-green-700 pl-4">Cr {je.cr_account}</p>
                        <p className="font-mono font-semibold text-[#1e293b] mt-1">{formatIndianCurrency(je.amount)}</p>
                        <p className="text-xs text-[#64748b] mt-2">{je.description}</p>
                      </div>
                    ))}
                  </div>

                  {provisionResult.using_defaults && (
                    <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-900">
                      ⚠ Industry default loss rates applied. These are indicative only. IFRS 9 requires entity-specific historical loss rates based on your
                      actual write-off history.
                    </div>
                  )}

                  <div className="relative rounded-lg bg-[#f1f5f9] p-4 text-[#1e293b]">
                    <span className="absolute top-3 right-3 text-[10px] font-semibold px-2 py-0.5 rounded bg-white border border-[#e2e8f0]">
                      IFRS 9.5.5.15
                    </span>
                    <div className="whitespace-pre-wrap pr-16" style={{ fontFamily: 'Times New Roman, Times, serif', fontSize: 11 }}>
                      {provisionResult.narrative}
                    </div>
                  </div>
                </div>
              )}
            </div>
        </div>
        )}

        {(activeNavId === 'calculate') && classificationResult && !classificationResult.ecl_applies && (
          <div className="rounded-[14px] border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900">
            ⚠ ECL not applicable for this classification ({classificationResult.measurement_label || classificationResult.measurement}). ECL
            under IFRS 9 applies to amortised cost and FVOCI debt instruments — not to FVTPL positions unless separately required.
          </div>
        )}
        {(activeNavId === 'calculate') && classificationResult && classificationResult.ecl_applies && (
          <div className="rounded-[14px] border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
            ✓ ECL applicable — proceed to calculate Expected Credit Loss below.
          </div>
        )}

        {(activeNavId === 'calculate') && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
          {/* LEFT */}
          <div className="space-y-6">
            <div className="bg-white rounded-[14px] p-6 border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
              <h3 className="text-base font-bold text-[#1e293b] mb-4 border-b border-[#e2e8f0] pb-2">Calculation results</h3>
              {!hasCalcData ? (
                <p className="text-sm text-[#64748b]">Upload a loan portfolio and run Calculate on a portfolio to view ECL results.</p>
              ) : (
                <div className="space-y-2 text-sm">
                  {[
                    ['Total Exposure (EAD)', fmtKpi(results!.total_ead), 'text-blue-600'],
                    ['Total ECL Provision', fmtKpi(results!.total_ecl), 'text-red-600'],
                    ['Stage 1 ECL (12-month)', fmtKpi(results!.stage1_ecl), 'text-green-700'],
                    ['Stage 2 ECL (Lifetime)', fmtKpi(results!.stage2_ecl), 'text-orange-600'],
                    ['Stage 3 ECL (Lifetime)', fmtKpi(results!.stage3_ecl), 'text-red-600'],
                    ['Weighted Average PD', results!.weighted_avg_pd != null ? fmtPct(results!.weighted_avg_pd) : '—', 'text-[#64748b]'],
                    ['Weighted Average LGD', results!.weighted_avg_lgd != null ? fmtPct(results!.weighted_avg_lgd) : '—', 'text-[#64748b]'],
                    ['Coverage Ratio %', results!.coverage_ratio != null ? fmtPct(results!.coverage_ratio) : '—', 'text-[#64748b]'],
                  ].map(([label, val, cls]) => (
                    <div key={String(label)} className="flex justify-between py-2 border-b border-[#f1f5f9] last:border-0">
                      <span className="text-[#64748b]">{label}</span>
                      <span className={`font-mono font-semibold ${cls}`}>{val}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white rounded-[14px] border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)] overflow-hidden">
              <div className="px-6 py-4 border-b border-[#e2e8f0]">
                <h3 className="text-base font-bold text-[#1e293b]">Loan staging</h3>
                <p className="text-xs text-[#64748b] mt-1">Instruments with saved ECL after calculate</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#f8fafc] border-b border-[#e2e8f0]">
                      <th className="text-left py-3 px-4 font-medium text-[#64748b]">Loan ID</th>
                      <th className="text-left py-3 px-4 font-medium text-[#64748b]">Stage</th>
                      <th className="text-right py-3 px-4 font-medium text-[#64748b]">EAD</th>
                      <th className="text-right py-3 px-4 font-medium text-[#64748b]">PD (%)</th>
                      <th className="text-right py-3 px-4 font-medium text-[#64748b]">LGD (%)</th>
                      <th className="text-right py-3 px-4 font-medium text-[#64748b]">ECL</th>
                      <th className="text-left py-3 px-4 font-medium text-[#64748b]">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!loanRows.length ? (
                      <tr>
                        <td colSpan={7} className="py-10 text-center text-[#64748b]">
                          Upload loan portfolio and calculate to view staging results.
                        </td>
                      </tr>
                    ) : (
                      loanSlice.map((row) => (
                        <tr key={row.id} className={`border-b border-[#e2e8f0] ${rowBgForStage(row.stage)}`}>
                          <td className="py-3 px-4 font-mono text-[#f97316]">
                            <Link href={`/dashboard/ifrs9/portfolios/${row.id}`} className="hover:underline">
                              {row.id}
                            </Link>
                          </td>
                          <td className="py-3 px-4">
                            <StageRowBadge stage={row.stage} />
                          </td>
                          <td className="py-3 px-4 text-right font-mono">{formatIndianCurrency(row.ead)}</td>
                          <td className="py-3 px-4 text-right font-mono">{row.pd_pct.toFixed(2)}%</td>
                          <td className="py-3 px-4 text-right font-mono">{row.lgd_pct.toFixed(2)}%</td>
                          <td className="py-3 px-4 text-right font-mono">{formatIndianCurrency(row.ecl)}</td>
                          <td className="py-3 px-4 text-[#64748b]">{row.status}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {loanRows.length > 6 && (
                <div className="px-6 py-3 border-t border-[#e2e8f0]">
                  <Button variant="secondary" size="sm" onClick={() => setShowAllLoans((v) => !v)}>
                    {showAllLoans ? 'Show less' : 'View all'}
                  </Button>
                </div>
              )}
            </div>

            <div className="bg-white rounded-[14px] p-6 border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
              <h3 className="text-base font-bold text-[#1e293b] mb-2">ECL movement analysis</h3>
              <p className="text-sm text-[#64748b]">Run calculation to generate movement analysis</p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center flex-wrap">
              <Button
                type="button"
                disabled={!hasCalcData || downloadLoading}
                onClick={handleDownloadExcel}
                className="bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white disabled:opacity-50"
              >
                {downloadLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Generating... ⟳
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4 mr-2" />
                    Download Excel Report ↓
                  </>
                )}
              </Button>
              <span className="text-xs font-medium text-[#94a3b8] px-2 py-1 rounded-full bg-[#f1f5f9] border border-[#e2e8f0]">
                {masterReport ? '6 sheets (with Master Summary)' : '5 sheets'}
              </span>
              <button
                type="button"
                title="Coming soon"
                disabled
                className="px-4 py-2 rounded-lg border-2 border-[#e2e8f0] text-[#94a3b8] text-sm font-medium cursor-not-allowed bg-white"
              >
                Download PDF Report
              </button>
            </div>
          </div>

          {/* RIGHT */}
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {(results?.stage_summary ?? [
                { stage: 1 as const, loan_count: 0, ead: 0, ecl: 0 },
                { stage: 2 as const, loan_count: 0, ead: 0, ecl: 0 },
                { stage: 3 as const, loan_count: 0, ead: 0, ecl: 0 },
              ]).map((s) => {
                const border = s.stage === 1 ? 'border-green-500' : s.stage === 2 ? 'border-orange-500' : 'border-red-500';
                const title = s.stage === 1 ? 'Performing' : s.stage === 2 ? 'SICR' : 'Impaired';
                return (
                  <div key={s.stage} className={`bg-white rounded-[14px] p-4 border-2 ${border} shadow-[0_2px_8px_rgba(0,0,0,0.06)]`}>
                    <p className="text-xs font-bold text-[#64748b]">Stage {s.stage}</p>
                    <p className="text-sm font-semibold text-[#1e293b] mb-2">{title}</p>
                    {!hasCalcData ? (
                      <p className="text-sm text-[#94a3b8]">— loans | $— EAD | $— ECL</p>
                    ) : (
                      <>
                        <p className="text-lg font-bold text-[#1e293b]">{s.loan_count} loans</p>
                        <p className="text-sm font-mono text-[#64748b]">{formatIndianCurrency(s.ead)} EAD</p>
                        <p className="text-sm font-mono text-red-600">{formatIndianCurrency(s.ecl)} ECL</p>
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="bg-white rounded-[14px] p-6 border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
              <h3 className="text-sm font-semibold text-[#1e293b] mb-4">ECL breakdown</h3>
              {!hasCalcData ? (
                <p className="text-sm text-[#64748b] h-[220px] flex items-center justify-center">Run calculate to view stage ECL bars.</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={barChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="#64748b" />
                    <YAxis tick={{ fontSize: 11 }} stroke="#64748b" tickFormatter={(v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : `${(v / 1e3).toFixed(0)}K`)} />
                    <Tooltip formatter={(v, n) => formatRechartsTooltipPair(v, n ?? 'ECL')} />
                    <Bar dataKey="ecl" radius={[4, 4, 0, 0]}>
                      {barChartData.map((entry) => (
                        <Cell key={entry.name} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="bg-white rounded-[14px] p-6 border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
              <h3 className="text-base font-bold text-[#1e293b] mb-4">Journal entries</h3>
              {!hasCalcData ? (
                <p className="text-sm text-[#64748b]">Run calculation to generate journal entries.</p>
              ) : (
                <div className="space-y-6">
                  {results!.stage1_ecl > 0 && (
                    <div>
                      <p className="text-xs text-[#64748b] mb-2">12-month ECL provision — Stage 1 performing loans</p>
                      <div className="p-3 bg-blue-50 rounded-lg border-l-4 border-blue-600">
                        <p className="text-sm font-medium text-blue-800">Dr ECL Expense (P&L)</p>
                        <p className="text-sm font-mono font-bold text-blue-900">{formatIndianCurrency(results!.stage1_ecl)}</p>
                      </div>
                      <div className="p-3 bg-green-50 rounded-lg border-l-4 border-green-600 mt-2">
                        <p className="text-sm font-medium text-green-800">Cr Loan Loss Allowance</p>
                        <p className="text-sm font-mono font-bold text-green-900">{formatIndianCurrency(results!.stage1_ecl)}</p>
                      </div>
                    </div>
                  )}
                  {results!.stage2_ecl > 0 && (
                    <div>
                      <p className="text-xs text-[#64748b] mb-2">Lifetime ECL — significant increase in credit risk detected</p>
                      <div className="p-3 bg-blue-50 rounded-lg border-l-4 border-blue-600">
                        <p className="text-sm font-medium text-blue-800">Dr ECL Expense (P&L)</p>
                        <p className="text-sm font-mono font-bold text-blue-900">{formatIndianCurrency(results!.stage2_ecl)}</p>
                      </div>
                      <div className="p-3 bg-green-50 rounded-lg border-l-4 border-green-600 mt-2">
                        <p className="text-sm font-medium text-green-800">Cr Loan Loss Allowance</p>
                        <p className="text-sm font-mono font-bold text-green-900">{formatIndianCurrency(results!.stage2_ecl)}</p>
                      </div>
                    </div>
                  )}
                  {results!.stage3_ecl > 0 && (
                    <div>
                      <p className="text-xs text-[#64748b] mb-2">Lifetime ECL — credit impaired loan (Stage 3)</p>
                      <div className="p-3 bg-blue-50 rounded-lg border-l-4 border-blue-600">
                        <p className="text-sm font-medium text-blue-800">Dr ECL Expense (P&L)</p>
                        <p className="text-sm font-mono font-bold text-blue-900">{formatIndianCurrency(results!.stage3_ecl)}</p>
                      </div>
                      <div className="p-3 bg-green-50 rounded-lg border-l-4 border-green-600 mt-2">
                        <p className="text-sm font-medium text-green-800">Cr Loan Loss Allowance</p>
                        <p className="text-sm font-mono font-bold text-green-900">{formatIndianCurrency(results!.stage3_ecl)}</p>
                      </div>
                    </div>
                  )}
                  {results!.stage1_ecl === 0 && results!.stage2_ecl === 0 && results!.stage3_ecl === 0 && (
                    <p className="text-sm text-[#64748b]">No stage ECL amounts to recognise.</p>
                  )}
                </div>
              )}
            </div>

            <div className="bg-[#f8fafc] rounded-[14px] p-4 border border-[#e2e8f0]">
              <p className="text-sm font-bold text-[#1e293b] mb-1">AI insight</p>
              <p className="text-sm text-[#475569] leading-relaxed">{aiInsight}</p>
            </div>

            <div className="bg-white rounded-[14px] p-6 border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
              <h3 className="text-base font-bold text-[#1e293b] mb-4">Disclosure notes</h3>
              <div className="space-y-3">
                {disclosureCards.map((card) => {
                  const open = openDisclosureId === card.id;
                  const placeholder = card.content.startsWith('Run calculation');
                  return (
                    <div key={card.id} className="border border-[#e2e8f0] rounded-lg">
                      <button
                        type="button"
                        onClick={() => setOpenDisclosureId(open ? null : card.id)}
                        className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-[#f8fafc]"
                      >
                        <span className="text-sm font-semibold text-[#1e293b]">{card.title}</span>
                        {open ? <ChevronUp className="w-4 h-4 text-[#64748b]" /> : <ChevronDown className="w-4 h-4 text-[#64748b]" />}
                      </button>
                      {open && (
                        <div className="px-4 pb-4">
                          <p className={`text-sm leading-relaxed ${placeholder ? 'text-[#94a3b8] italic' : 'text-[#1e293b]'}`} style={{ fontFamily: 'Georgia, serif' }}>
                            {card.content}
                          </p>
                          <Button
                            variant="secondary"
                            size="sm"
                            className="mt-2"
                            onClick={() => {
                              navigator.clipboard.writeText(card.content).then(() => toast.success('Copied')).catch(() => toast.error('Copy failed'));
                            }}
                          >
                            <Copy className="w-4 h-4 mr-1" /> Copy
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        )}

        {(activeNavId === 'reconciliation') && (
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-6">
          <h3 className="text-base font-bold text-[#1e293b] mb-2">ECL Reconciliation</h3>
          <p className="text-sm text-[#64748b] mb-4">Roll-forward from opening to closing ECL provision — compare calculated ECL to GL balances.</p>
          {hasCalcData ? (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between py-2 border-b"><span>Opening ECL provision</span><span className="font-mono">—</span></div>
              <div className="flex justify-between py-2 border-b"><span>Current period charge</span><span className="font-mono text-red-600">{fmtKpi(results!.total_ecl)}</span></div>
              <div className="flex justify-between py-2 border-b"><span>Write-offs / recoveries</span><span className="font-mono">—</span></div>
              <div className="flex justify-between py-2 font-semibold"><span>Closing ECL provision</span><span className="font-mono">{fmtKpi(results!.total_ecl)}</span></div>
            </div>
          ) : (
            <p className="text-sm text-[#64748b]">Calculate ECL on at least one portfolio to run reconciliation.</p>
          )}
        </div>
        )}

        {(activeNavId === 'reports') && (
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-6 space-y-4">
          <h3 className="text-base font-bold text-[#1e293b]">Export &amp; Reports</h3>
          <p className="text-sm text-[#64748b]">Generate the IFRS 9 master compliance report with staging, ECL, and disclosure narrative.</p>
          <Button
            type="button"
            variant="primary"
            className="bg-gradient-to-r from-orange-500 to-orange-600 text-white"
            disabled={!hasCalcData || masterLoading}
            onClick={() => void handleGenerateMasterReport()}
            isLoading={masterLoading}
          >
            <FileBarChart className="w-4 h-4 mr-2" /> Generate IFRS 9 Master Report
          </Button>
        </div>
        )}

        {(activeNavId === 'overview') && (
        <div className="bg-white rounded-[14px] border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)] overflow-hidden">
          <div className="px-6 py-4 border-b border-[#e2e8f0] flex justify-between items-center">
            <h4 className="text-sm font-semibold text-[#1e293b]">All portfolios</h4>
            <Link href="/dashboard/ifrs9/portfolios">
              <Button variant="secondary" size="sm">
                View all
              </Button>
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#f8fafc] border-b border-[#e2e8f0]">
                  <th className="text-left py-3 px-4 font-medium text-[#64748b]">Portfolio ID</th>
                  <th className="text-left py-3 px-4 font-medium text-[#64748b]">Name</th>
                  <th className="text-right py-3 px-4 font-medium text-[#64748b]">EAD</th>
                  <th className="text-right py-3 px-4 font-medium text-[#64748b]">ECL</th>
                  <th className="text-center py-3 px-4 font-medium text-[#64748b]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {portfolios.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-[#64748b]">
                      No portfolios yet. Create a new portfolio to get started.
                    </td>
                  </tr>
                ) : (
                  portfolios.slice(0, 10).map((p) => {
                    const id = p.id || p.portfolioId;
                    const gross = loanEad(p);
                    const eclDisp = p.applicableEcl != null ? formatIndianCurrency(p.applicableEcl) : '—';
                    return (
                      <tr key={id} className="border-b border-[#e2e8f0] hover:bg-[#f8fafc]">
                        <td className="py-3 px-4 font-mono text-[#f97316]">
                          <Link href={`/dashboard/ifrs9/portfolios/${id}`}>{id}</Link>
                        </td>
                        <td className="py-3 px-4 text-[#1e293b]">{p.name || '—'}</td>
                        <td className="py-3 px-4 text-right font-mono">{formatIndianCurrency(gross)}</td>
                        <td className="py-3 px-4 text-right font-mono">{eclDisp}</td>
                        <td className="py-3 px-4 text-center">
                          <Link href={`/dashboard/ifrs9/portfolios/${id}`}>
                            <button type="button" className="p-1.5 rounded hover:bg-orange-100 text-[#64748b]" title="Open">
                              <Eye className="w-4 h-4" />
                            </button>
                            <button type="button" className="p-1.5 rounded hover:bg-orange-100 text-[#64748b]" title="Calculate">
                              <Calculator className="w-4 h-4" />
                            </button>
                          </Link>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
        )}
      </div>
      </ModuleWorkspaceLayout>

      {hasCalcData ? (
        <button
          type="button"
          onClick={() => void handleGenerateMasterReport()}
          disabled={masterLoading}
          className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-5 py-3 rounded-full font-semibold text-white shadow-xl bg-gradient-to-r from-orange-500 to-amber-600 hover:opacity-95 disabled:opacity-60 animate-pulse"
        >
          {masterLoading ? <Loader2 className="w-5 h-5 animate-spin shrink-0" aria-hidden /> : null}
          Generate IFRS 9 Report
        </button>
      ) : null}

      {showMasterModal && masterReport ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ifrs9-master-title"
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[900px] max-h-[92vh] flex flex-col overflow-hidden border border-[#e2e8f0]">
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[#e2e8f0] bg-[#f8fafc]">
              <div>
                <h2 id="ifrs9-master-title" className="text-lg font-bold text-[#0f172a]">
                  IFRS 9 Master Report
                </h2>
                <p className="text-xs text-[#64748b] mt-1">
                  {String(masterReport.portfolio_name ?? '')} | {String(masterReport.reporting_date ?? '')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowMasterModal(false)}
                className="p-2 rounded-lg hover:bg-[#e2e8f0] text-[#64748b]"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex flex-wrap gap-1 px-3 pt-3 border-b border-[#e2e8f0] bg-white">
              {[
                'Overview',
                'Financial',
                'Assessments',
                'Risk flags',
                'Audit readiness',
                'AI narrative',
                'Downloads',
              ].map((label, i) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setMasterTab(i)}
                  className={`px-3 py-2 text-xs font-semibold rounded-t-lg border border-b-0 transition-colors ${
                    masterTab === i
                      ? 'bg-orange-50 text-orange-800 border-orange-200'
                      : 'bg-transparent text-[#64748b] border-transparent hover:bg-[#f1f5f9]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto p-5 text-sm text-[#334155]">
              {masterTab === 0 ? (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-xs font-bold uppercase text-[#64748b] mb-2">Portfolio overview</h3>
                    <table className="w-full border border-[#e2e8f0] rounded-lg overflow-hidden text-sm">
                      <tbody>
                        {Object.entries((masterReport.portfolio_overview as Record<string, unknown>) || {}).map(([k, v]) => (
                          <tr key={k} className="border-b border-[#f1f5f9] last:border-0">
                            <td className="py-2 px-3 text-[#64748b] capitalize">{k.replace(/_/g, ' ')}</td>
                            <td className="py-2 px-3 text-right font-mono font-medium">{typeof v === 'number' ? v.toLocaleString() : String(v)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div>
                    <h3 className="text-xs font-bold uppercase text-[#64748b] mb-2">ECL by stage</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {(['stage1', 'stage2', 'stage3'] as const).map((sk) => {
                        const b = ((masterReport.ecl_summary as Record<string, unknown>) || {})[sk] as Record<string, unknown> | undefined;
                        const stageNum = sk === 'stage1' ? 1 : sk === 'stage2' ? 2 : 3;
                        const bg = stageNum === 1 ? 'bg-green-50 border-green-200' : stageNum === 2 ? 'bg-orange-50 border-orange-200' : 'bg-red-50 border-red-200';
                        return (
                          <div key={sk} className={`rounded-lg border p-3 ${bg}`}>
                            <p className="text-xs font-semibold text-[#64748b]">Stage {stageNum}</p>
                            <p className="text-lg font-bold font-mono mt-1">{Number(b?.ecl ?? 0).toLocaleString()}</p>
                            <p className="text-[10px] text-[#64748b] mt-1">
                              {Number(b?.count ?? 0)} loans · EAD {Number(b?.ead ?? 0).toLocaleString()}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                    <p className="mt-3 text-xs">
                      <span
                        className={`inline-flex px-2 py-1 rounded-full font-semibold ${
                          (masterReport.ecl_summary as Record<string, unknown>)?.all_steps_complete
                            ? 'bg-green-100 text-green-800'
                            : 'bg-[#f1f5f9] text-[#64748b]'
                        }`}
                      >
                        {(masterReport.ecl_summary as Record<string, unknown>)?.all_steps_complete
                          ? 'All core ECL steps complete'
                          : 'Core ECL incomplete'}
                      </span>
                    </p>
                  </div>
                </div>
              ) : null}

              {masterTab === 1 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <table className="w-full border border-[#e2e8f0] rounded-lg">
                    <tbody>
                      {Object.entries((masterReport.financial_summary as Record<string, unknown>) || {}).map(([k, v]) => (
                        <tr key={k} className="border-b border-[#f1f5f9] last:border-0">
                          <td className="py-2 px-3 text-[#64748b]">{k.replace(/_/g, ' ')}</td>
                          <td className="py-2 px-3 text-right font-mono">
                            {v == null ? '—' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="rounded-lg border border-[#e2e8f0] p-4 bg-[#f8fafc]">
                    <p className="text-xs font-semibold text-[#64748b] mb-2">Macro vs point-in-time</p>
                    {(() => {
                      const asm = masterReport.assessments as Record<string, Record<string, unknown>> | undefined;
                      const mo = asm?.macro_overlay;
                      const pit = Number(mo?.point_in_time_ecl ?? 0);
                      const pwe = Number(mo?.probability_weighted_ecl ?? 0);
                      const fs = masterReport.financial_summary as Record<string, unknown> | undefined;
                      const cls = String(fs?.classification ?? '—');
                      return (
                        <>
                          <div className="flex justify-between text-sm">
                            <span>PIT ECL</span>
                            <span className="font-mono">{formatIndianCurrency(pit)}</span>
                          </div>
                          <div className="flex justify-between text-sm mt-2">
                            <span>Probability-weighted</span>
                            <span className="font-mono">{formatIndianCurrency(pwe)}</span>
                          </div>
                          <div className="mt-3">
                            <span className="text-xs text-[#64748b]">Classification</span>
                            <span
                              className={`ml-2 px-2 py-0.5 rounded-full text-xs font-semibold ${
                                cls.toLowerCase().includes('amort')
                                  ? 'bg-green-100 text-green-800'
                                  : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {cls}
                            </span>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>
              ) : null}

              {masterTab === 2 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {(['ecl_staging', 'classification', 'macro_overlay', 'provision_matrix'] as const).map((key) => {
                    const block = ((masterReport.assessments as Record<string, unknown>) || {})[key] as Record<string, unknown> | undefined;
                    const assessed = Boolean(block?.assessed);
                    const modLabel =
                      key === 'ecl_staging'
                        ? 'ECL staging'
                        : key === 'classification'
                          ? 'Classification'
                          : key === 'macro_overlay'
                            ? 'Macro overlay'
                            : 'Provision matrix';
                    const moduleNeedle =
                      key === 'ecl_staging'
                        ? 'ECL Staging'
                        : key === 'classification'
                          ? 'Classification'
                          : key === 'macro_overlay'
                            ? 'Macro Overlay'
                            : 'Provision Matrix';
                    const flags = (masterReport.risk_flags as Array<Record<string, string>>) || [];
                    const n = flags.filter((f) => String(f.module || '') === moduleNeedle).length;
                    return (
                      <div key={key} className="rounded-xl border border-[#e2e8f0] p-4 bg-white shadow-sm">
                        <div className="flex justify-between items-center mb-2">
                          <span className="font-semibold text-[#0f172a]">{modLabel}</span>
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                              assessed ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {assessed ? 'Assessed' : 'Not run'}
                          </span>
                        </div>
                        <p className="text-xs text-[#64748b] line-clamp-2">
                          {key === 'ecl_staging' && `Total ECL ${Number(block?.total_ecl ?? 0).toLocaleString()} · ${String(block?.method ?? '')}`}
                          {key === 'classification' && String(block?.measurement ?? '—')}
                          {key === 'macro_overlay' && `PWE ${Number(block?.probability_weighted_ecl ?? 0).toLocaleString()}`}
                          {key === 'provision_matrix' && `Provision ${Number(block?.total_provision ?? 0).toLocaleString()}`}
                        </p>
                        {n > 0 ? (
                          <p className="text-[10px] mt-2 font-semibold text-orange-700">{n} related risk flag(s)</p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}

              {masterTab === 3 ? (
                <div className="space-y-3">
                  {(!(masterReport.risk_flags as unknown[]) || (masterReport.risk_flags as unknown[]).length === 0) ? (
                    <div className="rounded-lg bg-green-50 border border-green-200 text-green-800 px-4 py-3 text-sm font-medium">
                      ✓ No risks identified
                    </div>
                  ) : (
                    [...((masterReport.risk_flags as Array<Record<string, string>>) || [])]
                      .sort(
                        (a, b) =>
                          ({ HIGH: 0, MEDIUM: 1, LOW: 2 }[a.severity] ?? 9) - ({ HIGH: 0, MEDIUM: 1, LOW: 2 }[b.severity] ?? 9)
                      )
                      .map((f, i) => {
                        const sev = f.severity || 'LOW';
                        const border =
                          sev === 'HIGH' ? 'border-l-red-500' : sev === 'MEDIUM' ? 'border-l-orange-500' : 'border-l-amber-400';
                        return (
                          <div key={i} className={`rounded-lg border border-[#e2e8f0] border-l-4 ${border} pl-3 pr-3 py-3 bg-[#fafafa]`}>
                            <div className="flex flex-wrap gap-2 items-center mb-1">
                              <span className="text-[10px] font-bold uppercase text-[#64748b]">{f.module}</span>
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-white border border-[#e2e8f0]">{sev}</span>
                            </div>
                            <p className="text-sm text-[#1e293b]">{f.message}</p>
                            <p className="text-xs italic text-[#64748b] mt-2">{f.action_required}</p>
                          </div>
                        );
                      })
                  )}
                </div>
              ) : null}

              {masterTab === 4 ? (
                <div className="space-y-4">
                  {(() => {
                    const ar = (masterReport.audit_readiness as Record<string, unknown>) || {};
                    const score = Number(ar.score ?? 0);
                    const level = String(ar.level ?? '');
                    const ring =
                      level === 'Ready'
                        ? 'border-green-500 text-green-700 bg-green-50'
                        : level === 'Needs Review'
                          ? 'border-orange-500 text-orange-800 bg-orange-50'
                          : 'border-red-500 text-red-700 bg-red-50';
                    const list = (ar.checklist as Array<{ item: string; status: string }>) || [];
                    const done = list.filter((c) => c.status === 'complete').length;
                    return (
                      <>
                        <div className="flex flex-col items-center">
                          <div
                            className={`w-36 h-36 rounded-full border-4 flex flex-col items-center justify-center font-bold ${ring}`}
                          >
                            <span className="text-3xl">{score.toFixed(1)}%</span>
                            <span className="text-xs font-semibold mt-1">{level}</span>
                          </div>
                          <p className="text-sm text-[#64748b] mt-3">
                            {done} of {list.length || 14} items complete
                          </p>
                        </div>
                        <ul className="space-y-1 max-h-[40vh] overflow-y-auto">
                          {list.map((c, idx) => (
                            <li
                              key={idx}
                              className={`flex gap-2 text-sm ${c.status === 'complete' ? 'text-green-700' : 'text-red-600'}`}
                            >
                              <span>{c.status === 'complete' ? '✓' : '✗'}</span>
                              <span>{c.item}</span>
                            </li>
                          ))}
                        </ul>
                      </>
                    );
                  })()}
                </div>
              ) : null}

              {masterTab === 5 ? (
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wide text-[#0f172a] mb-3" style={{ fontFamily: 'Georgia, serif' }}>
                    Executive narrative
                  </h3>
                  <div
                    className="text-[#1e293b] leading-relaxed whitespace-pre-wrap border border-[#e2e8f0] rounded-lg p-4 bg-[#fafafa]"
                    style={{ fontFamily: 'Times New Roman, Times, serif', fontSize: 13 }}
                  >
                    {String(masterReport.ai_narrative ?? '')}
                  </div>
                  <div className="flex justify-between items-center mt-4">
                    <p className="text-[10px] text-[#64748b]" style={{ fontFamily: 'Times New Roman, Times, serif' }}>
                      IFRS 9 Master Report — {String(masterReport.reporting_date ?? '')}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard.writeText(String(masterReport.ai_narrative ?? ''));
                        toast.success('Narrative copied');
                      }}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-orange-700 hover:underline"
                    >
                      <Copy className="w-3.5 h-3.5" /> Copy
                    </button>
                  </div>
                </div>
              ) : null}

              {masterTab === 6 ? (
                <div className="space-y-4">
                  <p className="text-xs text-[#64748b]">
                    Excel includes the IFRS 9 Master Summary sheet plus the five core audit sheets (six sheets total) when this master report session is active.
                  </p>
                  <Button
                    variant="primary"
                    className="w-full bg-gradient-to-r from-orange-500 to-amber-600"
                    onClick={() => void handleDownloadExcel()}
                    isLoading={downloadLoading}
                  >
                    <Download className="w-4 h-4" /> Download Master Report Excel
                  </Button>
                  <button
                    type="button"
                    disabled
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-lg border border-dashed border-[#cbd5e1] text-[#94a3b8] text-sm cursor-not-allowed"
                  >
                    <FileText className="w-4 h-4" /> Download PDF — Coming soon
                  </button>
                </div>
              ) : null}
            </div>
            <div className="px-5 py-3 text-[10px] text-[#64748b] border-t border-[#e2e8f0] bg-[#f8fafc]">
              This report was generated by IFRS AI. All figures should be reviewed by a qualified accountant before use in financial statements.
            </div>
          </div>
        </div>
      ) : null}
    </SidebarLayout>
  );
}
