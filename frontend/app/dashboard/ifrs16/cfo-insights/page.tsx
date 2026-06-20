'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Building2,
  FileText,
  Percent,
  AlertTriangle,
  Sparkles,
  Loader2,
  Zap,
} from 'lucide-react';
import { SidebarLayout } from '@/components/SidebarLayout';
import { Button } from '@/components/Button';
import { getLeaseRepository, type LeaseRepositoryEntry } from '@/lib/lease-repository';
import { formatIndianNumber, formatDate } from '@/lib/utils';
import { parseAiJsonObject } from '@/lib/parse-ai-json';
import { formatLeaseMoney, resolveLeaseCurrency } from '@/lib/ifrs16-currency';
import {
  getCalculatedIbrPct,
  getPortfolioMoneyDisplay,
  isPortfolioAggregateLease,
} from '@/lib/ifrs16-portfolio';

const cardClass =
  'bg-white rounded-[14px] border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)]';

const categoryLabels: Record<string, string> = {
  RENEWAL_DECISION: '🔄 Renewal Decision',
  RENEGOTIATION: '💰 Renegotiation',
  CONCENTRATION_RISK: '⚠️ Concentration Risk',
  CPI_EXPOSURE: '📈 CPI Exposure',
  BUY_VS_LEASE: '🏗️ Buy vs Lease',
  SUBLET_OPPORTUNITY: '🏢 Sublet Opportunity',
  BREAK_CLAUSE: '🔓 Break Clause',
  RVG_EXPOSURE: '🛡️ RVG Exposure',
  CASH_FLOW: '💸 Cash Flow',
};

export type PortfolioLease = {
  id: string;
  asset_description: string;
  monthly_payment: number;
  discount_rate: number;
  calculated_discount_rate: number;
  lease_term_months: number;
  start_date: string;
  end_date: string;
  currency: string;
  lease_type: string;
  city: string;
  country: string;
  status: string;
  results: {
    lease_liability: number;
    rou_asset: number;
    monthly_depreciation: number;
    total_interest: number;
  };
};

export type AiInsight = {
  type: string;
  severity: string;
  title: string;
  description: string;
  action: string;
  calculation?: string;
  cfo_question?: string;
  financial_impact?: string;
  if_ignored?: string;
  lease_id: string | null;
};

export type AiActionOption = {
  option: string;
  financial_impact: string;
  pros: string;
  cons: string;
};

export type AiAction = {
  id: string;
  category: string;
  title: string;
  description: string;
  cfo_decision?: string;
  options?: AiActionOption[];
  recommended_option?: string;
  priority: string;
  owner?: string;
  deadline?: string;
  financial_consequence_if_ignored?: string;
  potential_saving_or_cost?: string;
  lease_id: string | null;
  is_ai_generated?: boolean;
};

export type CfoSummary = {
  total_annual_commitment?: number;
  total_liability?: number;
  monthly_outflow?: number;
  biggest_risk?: string;
  most_urgent_decision?: string;
  potential_annual_saving?: number;
};

export type CashFlowForecast = {
  year_1?: number;
  year_2?: number;
  year_3?: number;
  year_4?: number;
  year_5?: number;
  total_5_year?: number;
  note?: string;
};

export type AiAnalysis = {
  health_score: number;
  health_label: string;
  summary: string;
  insights: AiInsight[];
  top_recommendation: string;
  cfo_summary?: CfoSummary;
  actions?: AiAction[];
  cash_flow_forecast?: CashFlowForecast;
};

function normalizeLeases(raw: LeaseRepositoryEntry[]): PortfolioLease[] {
  return raw
    .filter((l) => !isPortfolioAggregateLease(l))
    .map((l) => {
    const res = (l.results || {}) as Record<string, unknown>;
    const y1 = (res.year_1_impact || {}) as Record<string, unknown>;
    const end = String(l.end_date || l.dates?.end || '');
    const start = String(l.start_date || l.dates?.commencement || '');
    const ll = Number(l.liability ?? res.lease_liability ?? 0);
    const calculatedIbr = getCalculatedIbrPct(l);
    return {
      id: String(l.id || l.lease_id || ''),
      asset_description: String(l.title || l.asset || (l as { asset_description?: string }).asset_description || ''),
      monthly_payment: Number(l.monthly_payment ?? l.payments?.monthly ?? 0),
      discount_rate: calculatedIbr,
      calculated_discount_rate: calculatedIbr,
      lease_term_months: Number(l.dates?.term_months ?? 0),
      start_date: start,
      end_date: end,
      currency: resolveLeaseCurrency(l),
      lease_type: String(l.lease_type || ''),
      city: String(l.city || ''),
      country: String(l.country || ''),
      status: String(l.status || l.lease_status || ''),
      results: {
        lease_liability: ll,
        rou_asset: Number(l.rou ?? res.rou_asset ?? 0),
        monthly_depreciation: Number(res.monthly_depreciation ?? 0),
        total_interest: Number(y1.interest_expense ?? res.total_interest ?? 0),
      },
    };
  });
}

function daysUntilEnd(endDate: string): number | null {
  if (!endDate) return null;
  const end = new Date(endDate);
  if (Number.isNaN(end.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  return Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function numOpt(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function normalizeMoneyText(text: string | undefined, currency: string): string | undefined {
  if (!text) return text;
  if (currency === 'AED') {
    return text
      .replace(/\bUSD\s+/gi, 'AED ')
      .replace(/\$\s*([\d,]+(?:\.\d+)?)\s*M\b/gi, 'AED $1M')
      .replace(/\$\s*([\d,]+(?:\.\d+)?)/g, 'AED $1');
  }
  return text;
}

function normalizeAiAnalysisForCurrency(analysis: AiAnalysis, currency: string): AiAnalysis {
  const norm = (s?: string) => normalizeMoneyText(s, currency);
  return {
    ...analysis,
    summary: norm(analysis.summary) ?? analysis.summary,
    top_recommendation: norm(analysis.top_recommendation) ?? analysis.top_recommendation,
    insights: analysis.insights.map((ins) => ({
      ...ins,
      title: norm(ins.title) ?? ins.title,
      description: norm(ins.description) ?? ins.description,
      action: norm(ins.action) ?? ins.action,
      calculation: norm(ins.calculation),
      financial_impact: norm(ins.financial_impact),
      if_ignored: norm(ins.if_ignored),
    })),
    cfo_summary: analysis.cfo_summary
      ? {
          ...analysis.cfo_summary,
          biggest_risk: norm(analysis.cfo_summary.biggest_risk),
          most_urgent_decision: norm(analysis.cfo_summary.most_urgent_decision),
        }
      : undefined,
    cash_flow_forecast: analysis.cash_flow_forecast
      ? {
          ...analysis.cash_flow_forecast,
          note: norm(analysis.cash_flow_forecast.note),
        }
      : undefined,
    actions: analysis.actions?.map((a) => ({
      ...a,
      title: norm(a.title) ?? a.title,
      description: norm(a.description) ?? a.description,
      financial_consequence_if_ignored: norm(a.financial_consequence_if_ignored),
      potential_saving_or_cost: norm(a.potential_saving_or_cost),
      options: a.options?.map((o) => ({
        ...o,
        financial_impact: norm(o.financial_impact) ?? o.financial_impact,
      })),
    })),
  };
}

function parseClaudeJson(text: string): AiAnalysis {
  const raw = parseAiJsonObject(text);
  const score = Math.min(100, Math.max(0, Math.round(Number(raw.health_score) || 0)));
  const insightsRaw = Array.isArray(raw.insights) ? raw.insights : [];
  const insights: AiInsight[] = insightsRaw.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      type: String(r.type ?? ''),
      severity: String(r.severity ?? ''),
      title: String(r.title ?? ''),
      description: String(r.description ?? ''),
      action: String(r.action ?? ''),
      calculation: typeof r.calculation === 'string' ? r.calculation : undefined,
      cfo_question: typeof r.cfo_question === 'string' ? r.cfo_question : undefined,
      financial_impact: typeof r.financial_impact === 'string' ? r.financial_impact : undefined,
      if_ignored: typeof r.if_ignored === 'string' ? r.if_ignored : undefined,
      lease_id: r.lease_id != null && String(r.lease_id).length > 0 ? String(r.lease_id) : null,
    };
  });

  let cfo_summary: CfoSummary | undefined;
  const cs = raw.cfo_summary;
  if (cs != null && typeof cs === 'object' && !Array.isArray(cs)) {
    const o = cs as Record<string, unknown>;
    cfo_summary = {
      total_annual_commitment: numOpt(o.total_annual_commitment),
      total_liability: numOpt(o.total_liability),
      monthly_outflow: numOpt(o.monthly_outflow),
      biggest_risk: typeof o.biggest_risk === 'string' ? o.biggest_risk : undefined,
      most_urgent_decision: typeof o.most_urgent_decision === 'string' ? o.most_urgent_decision : undefined,
      potential_annual_saving: numOpt(o.potential_annual_saving),
    };
  }

  let actions: AiAction[] | undefined;
  if (Array.isArray(raw.actions) && raw.actions.length > 0) {
    actions = raw.actions.map((row) => {
      const a = row as Record<string, unknown>;
      const opts = Array.isArray(a.options)
        ? (a.options as Record<string, unknown>[]).map((o) => ({
            option: String(o.option ?? ''),
            financial_impact: String(o.financial_impact ?? ''),
            pros: String(o.pros ?? ''),
            cons: String(o.cons ?? ''),
          }))
        : undefined;
      return {
        id: String(a.id ?? ''),
        category: String(a.category ?? ''),
        title: String(a.title ?? ''),
        description: String(a.description ?? ''),
        cfo_decision: typeof a.cfo_decision === 'string' ? a.cfo_decision : undefined,
        options: opts && opts.length > 0 ? opts : undefined,
        recommended_option: typeof a.recommended_option === 'string' ? a.recommended_option : undefined,
        priority: String(a.priority ?? ''),
        owner: typeof a.owner === 'string' ? a.owner : undefined,
        deadline: typeof a.deadline === 'string' ? a.deadline : undefined,
        financial_consequence_if_ignored:
          typeof a.financial_consequence_if_ignored === 'string'
            ? a.financial_consequence_if_ignored
            : undefined,
        potential_saving_or_cost:
          typeof a.potential_saving_or_cost === 'string' ? a.potential_saving_or_cost : undefined,
        lease_id: a.lease_id != null && String(a.lease_id).length > 0 ? String(a.lease_id) : null,
        is_ai_generated: typeof a.is_ai_generated === 'boolean' ? a.is_ai_generated : undefined,
      };
    });
  }

  let cash_flow_forecast: CashFlowForecast | undefined;
  const cf = raw.cash_flow_forecast;
  if (cf != null && typeof cf === 'object' && !Array.isArray(cf)) {
    const o = cf as Record<string, unknown>;
    cash_flow_forecast = {
      year_1: numOpt(o.year_1),
      year_2: numOpt(o.year_2),
      year_3: numOpt(o.year_3),
      year_4: numOpt(o.year_4),
      year_5: numOpt(o.year_5),
      total_5_year: numOpt(o.total_5_year),
      note: typeof o.note === 'string' ? o.note : undefined,
    };
  }

  return {
    health_score: score,
    health_label: String(raw.health_label ?? ''),
    summary: String(raw.summary ?? ''),
    top_recommendation: String(raw.top_recommendation ?? ''),
    insights,
    cfo_summary,
    actions,
    cash_flow_forecast,
  };
}

function healthColors(score: number): { ring: string; label: string } {
  if (score >= 80) return { ring: '#22c55e', label: 'text-green-700' };
  if (score >= 50) return { ring: '#f59e0b', label: 'text-amber-700' };
  return { ring: '#ef4444', label: 'text-red-700' };
}

function insightBarClass(type: string): string {
  const t = type.toLowerCase();
  if (t === 'risk') return 'bg-red-500';
  if (t === 'efficiency') return 'bg-green-500';
  return 'bg-amber-500';
}

function severityEmoji(sev: string): string {
  const s = sev.toLowerCase();
  if (s === 'high') return '🔴';
  if (s === 'medium') return '🟡';
  return '🟢';
}

function formatMoney(amount: number, currency: string): string {
  return formatLeaseMoney(amount, currency);
}

function buildLocalPortfolioAnalysis(
  leases: PortfolioLease[],
  totalLiability: number,
  formatPortfolioTotal: (amount: number) => string
): AiAnalysis {
  const totalMonthly = leases.reduce((s, l) => s + (l.monthly_payment || 0), 0);
  const totalAnnual = totalMonthly * 12;
  const expiring = leases.filter((l) => {
    const d = daysUntilEnd(l.end_date);
    return d != null && d >= 0 && d <= 90;
  });
  const sorted = [...leases].sort(
    (a, b) => (b.results?.lease_liability || 0) - (a.results?.lease_liability || 0)
  );
  const top = sorted[0];
  const topLl = top?.results?.lease_liability || 0;
  const topPct = totalLiability > 0 ? (topLl / totalLiability) * 100 : 0;

  let health = 82;
  if (topPct > 35) health -= 22;
  else if (topPct > 25) health -= 12;
  if (expiring.length > 2) health -= 15;
  else if (expiring.length > 0) health -= 8;
  health = Math.max(28, Math.min(95, health));

  const fmt = formatPortfolioTotal;
  const today = new Date().toISOString().split('T')[0];
  const insights: AiInsight[] = [];

  if (top) {
    insights.push({
      type: 'Risk',
      severity: topPct > 30 ? 'High' : 'Medium',
      title: `${top.asset_description || top.id} — ${topPct.toFixed(1)}% of portfolio`,
      description: `Largest lease liability is ${fmt(topLl)} (${topPct.toFixed(1)}% of total ${fmt(totalLiability)}).`,
      action: 'Review concentration risk and backup space options before renewal.',
      financial_impact: fmt(topLl),
      calculation: `${fmt(topLl)} / ${fmt(totalLiability)} = ${topPct.toFixed(1)}%`,
      lease_id: top.id,
    });
  }

  if (expiring.length > 0) {
    const expLiability = expiring.reduce((s, l) => s + (l.results?.lease_liability || 0), 0);
    insights.push({
      type: 'Renewal',
      severity: 'High',
      title: `${expiring.length} lease(s) expiring within 90 days`,
      description: `Near-term renewals represent ${fmt(expLiability)} in lease liability.`,
      action: 'Start renewal negotiations now to preserve negotiating leverage.',
      financial_impact: fmt(expLiability),
      lease_id: expiring[0]?.id || null,
    });
  }

  insights.push({
    type: 'Efficiency',
    severity: 'Medium',
    title: `Annual cash commitment ${fmt(totalAnnual)}`,
    description: `Portfolio monthly outflow is ${fmt(totalMonthly)} across ${leases.length} active leases.`,
    action: 'Benchmark IBR rates against market for leases above portfolio average.',
    financial_impact: fmt(totalAnnual),
    calculation: `${fmt(totalMonthly)} × 12 = ${fmt(totalAnnual)}`,
    lease_id: null,
  });

  return {
    health_score: health,
    health_label: health >= 80 ? 'Good' : health >= 50 ? 'Fair' : 'At Risk',
    summary: `Portfolio liability ${fmt(totalLiability)} across ${leases.length} leases as of ${today}. ${
      top ? `Largest exposure: ${top.asset_description} (${topPct.toFixed(1)}%). ` : ''
    }${
      expiring.length
        ? `${expiring.length} renewal(s) due within 90 days.`
        : 'No leases expiring in the next 90 days.'
    }`,
    top_recommendation: expiring.length
      ? `Prioritise renewal for ${expiring[0].asset_description} — deadline ${expiring[0].end_date}`
      : `Review IBR on ${top?.asset_description || 'top leases'} for renegotiation savings.`,
    insights,
    cfo_summary: {
      total_annual_commitment: totalAnnual,
      total_liability: totalLiability,
      monthly_outflow: totalMonthly,
      biggest_risk: top ? `${top.asset_description} (${fmt(topLl)})` : undefined,
      most_urgent_decision: expiring[0]
        ? `Renew ${expiring[0].asset_description} by ${expiring[0].end_date}`
        : 'Monitor portfolio concentration',
      potential_annual_saving: Math.round(totalAnnual * 0.03),
    },
    actions: insights.slice(0, 3).map((ins, i) => ({
      id: `ACT-LOC-${String(i + 1).padStart(3, '0')}`,
      category: 'CASH_FLOW',
      title: ins.title,
      description: ins.description,
      priority: ins.severity,
      lease_id: ins.lease_id,
      is_ai_generated: false,
    })),
    cash_flow_forecast: {
      year_1: totalAnnual,
      year_2: totalAnnual,
      year_3: totalAnnual,
      year_4: totalAnnual,
      year_5: totalAnnual,
      total_5_year: totalAnnual * 5,
      note: 'Flat forecast based on current monthly payments.',
    },
  };
}

export default function CFOStrategicInsightsPage() {
  const [leases, setLeases] = useState<PortfolioLease[]>([]);
  const [aiResult, setAiResult] = useState<AiAnalysis | null>(null);
  const [lastAnalysedAt, setLastAnalysedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingSec, setLoadingSec] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const refreshLeases = useCallback(() => {
    try {
      setLeases(normalizeLeases(getLeaseRepository()));
    } catch {
      setLeases([]);
    }
  }, []);

  useEffect(() => {
    refreshLeases();
  }, [refreshLeases]);

  useEffect(() => {
    const onFocus = () => refreshLeases();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshLeases]);

  const portfolioMoney = useMemo(
    () =>
      getPortfolioMoneyDisplay(
        leases.map((l) => ({
          currency: l.currency,
          lease_liability: l.results?.lease_liability || 0,
        }))
      ),
    [leases]
  );

  const totalLiability = useMemo(
    () =>
      portfolioMoney.sumLiabilities(
        leases.map((l) => ({
          currency: l.currency,
          lease_liability: l.results?.lease_liability || 0,
        }))
      ),
    [leases, portfolioMoney]
  );

  const activeCount = useMemo(
    () =>
      leases.filter((l) => {
        const st = (l.status || '').toLowerCase();
        return st === 'active' || st === 'calculated';
      }).length,
    [leases]
  );

  const avgIbr = useMemo(() => {
    let weighted = 0;
    let totalLl = 0;
    for (const l of leases) {
      const ll = l.results?.lease_liability || 0;
      const rate = l.calculated_discount_rate || 0;
      if (ll > 0 && rate > 0) {
        weighted += ll * rate;
        totalLl += ll;
      }
    }
    return totalLl > 0 ? weighted / totalLl : 0;
  }, [leases]);

  const expiring90 = useMemo(() => {
    return leases.filter((l) => {
      const d = daysUntilEnd(l.end_date);
      return d != null && d >= 0 && d <= 90;
    }).length;
  }, [leases]);

  const tableRows = useMemo(() => {
    const sorted = [...leases].sort(
      (a, b) => (b.results?.lease_liability || 0) - (a.results?.lease_liability || 0)
    );
    return sorted.map((l) => {
      const ll = l.results?.lease_liability || 0;
      const llWeighted = portfolioMoney.sumLiabilities([
        { currency: l.currency, lease_liability: ll },
      ]);
      const pct = totalLiability > 0 ? (llWeighted / totalLiability) * 100 : 0;
      return { lease: l, pct };
    });
  }, [leases, totalLiability, portfolioMoney]);

  useEffect(() => {
    if (!loading) {
      setLoadingSec(0);
      return;
    }
    const t0 = Date.now();
    const tick = window.setInterval(() => {
      setLoadingSec(Math.floor((Date.now() - t0) / 1000));
    }, 1000);
    return () => window.clearInterval(tick);
  }, [loading]);

  const runAnalysis = async () => {
    if (leases.length === 0) return;
    setLoading(true);
    setError(null);
    setAiResult(null);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 130_000);
    try {
      const todayIso = new Date().toISOString().split('T')[0];
      const leasePayload = leases.map((l) => ({
        id: l.id,
        lease_id: l.id,
        asset: l.asset_description,
        asset_description: l.asset_description,
        monthly_payment: l.monthly_payment ?? 0,
        lease_liability: l.results?.lease_liability ?? 0,
        rou_asset: l.results?.rou_asset ?? 0,
        annual_discount_rate: l.calculated_discount_rate / 100,
        ibr: l.calculated_discount_rate,
        discount_rate_pct: l.calculated_discount_rate,
        lease_term_months: l.lease_term_months,
        term_months: l.lease_term_months,
        end_date: l.end_date,
        lease_type: l.lease_type,
        city: l.city,
        currency: l.currency,
      }));
      const response = await fetch('/api/cfo-strategic-insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leases: leasePayload, today: todayIso }),
        signal: controller.signal,
      });
      const raw = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((raw as { error?: string }).error || `Request failed (${response.status})`);
      }
      const text = (raw as { text?: string }).text;
      if (!text) throw new Error('Empty response from analysis service');
      const parsed = normalizeAiAnalysisForCurrency(
        parseClaudeJson(text),
        portfolioMoney.dominantCurrency
      );
      setAiResult(parsed);
      setLastAnalysedAt(new Date().toISOString());
      setError(null);
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.name === 'AbortError'
            ? 'Analysis timed out after 2 minutes'
            : e.message
          : 'Analysis failed';
      const local = buildLocalPortfolioAnalysis(leases, totalLiability, (amount) =>
        portfolioMoney.formatTotal(amount)
      );
      setAiResult(local);
      setLastAnalysedAt(new Date().toISOString());
      setError(`AI unavailable (${msg}). Showing portfolio-based insights.`);
    } finally {
      window.clearTimeout(timeoutId);
      setLoading(false);
    }
  };

  const hasLeases = leases.length > 0;
  const formatAmount = (amount: number | undefined) => {
    if (amount == null || Number.isNaN(Number(amount))) return '—';
    return portfolioMoney.formatTotal(Number(amount));
  };
  const formatPortfolioTotal = (amount: number) => portfolioMoney.formatTotal(amount);

  return (
    <SidebarLayout
      pageTitle="CFO Strategic Insights"
      pageSubtitle="IFRS 16 Lease Portfolio Intelligence"
    >
      <div className="space-y-6 max-w-6xl">
        {/* Header row */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="px-3 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800 border border-blue-200">
              AI Powered
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {aiResult && !loading && (
              <Button variant="secondary" size="sm" onClick={runAnalysis} disabled={!hasLeases}>
                Re-analyse
              </Button>
            )}
            <Button
              variant="primary"
              size="md"
              onClick={runAnalysis}
              disabled={!hasLeases}
              isLoading={loading}
            >
              {!loading && <Sparkles className="w-4 h-4" />}
              Analyse Portfolio
            </Button>
          </div>
        </div>

        {!hasLeases ? (
          <div className={`${cardClass} p-10 text-center`}>
            <p className="text-[#64748b] text-base mb-4">
              No leases found. Add leases in the IFRS 16 module first.
            </p>
            <Link
              href="/dashboard/ifrs16"
              className="inline-flex items-center justify-center font-semibold rounded-lg px-6 py-3 text-base text-white bg-gradient-to-r from-[#f97316] to-[#ef4444] hover:opacity-90 transition-opacity"
            >
              Go to IFRS 16
            </Link>
          </div>
        ) : (
          <>
            {/* KPI cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <div className={`${cardClass} p-5 flex gap-4 items-start`}>
                <div className="p-2 rounded-lg bg-orange-50 text-[#f97316]">
                  <Building2 className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-xs font-medium text-[#64748b] uppercase tracking-wide">Total Lease Liability</p>
                  <p className="text-xl font-bold text-[#1e293b] mt-1">{formatPortfolioTotal(totalLiability)}</p>
                  {portfolioMoney.isMultiCurrency && portfolioMoney.subtitle && (
                    <p className="text-xs text-[#94a3b8] mt-0.5">{portfolioMoney.subtitle}</p>
                  )}
                  {!portfolioMoney.isMultiCurrency && leases.length > 0 && (
                    <p className="text-xs text-[#94a3b8] mt-0.5">{portfolioMoney.dominantCurrency}</p>
                  )}
                </div>
              </div>
              <div className={`${cardClass} p-5 flex gap-4 items-start`}>
                <div className="p-2 rounded-lg bg-slate-100 text-[#475569]">
                  <FileText className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-xs font-medium text-[#64748b] uppercase tracking-wide">Active Leases</p>
                  <p className="text-xl font-bold text-[#1e293b] mt-1">{formatIndianNumber(activeCount)}</p>
                  <p className="text-xs text-[#94a3b8] mt-0.5">Status Active or Calculated</p>
                </div>
              </div>
              <div className={`${cardClass} p-5 flex gap-4 items-start`}>
                <div className="p-2 rounded-lg bg-violet-50 text-violet-600">
                  <Percent className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-xs font-medium text-[#64748b] uppercase tracking-wide">Avg IBR Rate</p>
                  <p className="text-xl font-bold text-[#1e293b] mt-1">{avgIbr.toFixed(1)}%</p>
                </div>
              </div>
              <div className={`${cardClass} p-5 flex gap-4 items-start`}>
                <div
                  className={`p-2 rounded-lg ${
                    expiring90 > 0 ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'
                  }`}
                >
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-xs font-medium text-[#64748b] uppercase tracking-wide">Expiring in 90 days</p>
                  <p
                    className={`text-xl font-bold mt-1 ${
                      expiring90 > 0 ? 'text-red-600' : 'text-green-600'
                    }`}
                  >
                    {formatIndianNumber(expiring90)}
                  </p>
                </div>
              </div>
            </div>

            {!aiResult && !loading && (
              <div className="rounded-lg border border-blue-200 bg-blue-50/80 px-4 py-3 text-sm text-blue-900">
                Click &apos;Analyse Portfolio&apos; to generate AI-powered insights for your CFO dashboard.
              </div>
            )}

            {error && (
              <div className={`${cardClass} border-amber-200 bg-amber-50/50 p-4 flex flex-wrap items-center justify-between gap-3`}>
                <p className="text-sm text-amber-900">{error}</p>
                <Button variant="secondary" size="sm" onClick={runAnalysis} disabled={loading}>
                  Retry AI
                </Button>
              </div>
            )}

            {/* AI section */}
            {(loading || aiResult) && (
              <div className="space-y-4">
                {loading && (
                  <div className={`${cardClass} p-8 flex flex-col items-center justify-center gap-3`}>
                    <Loader2 className="w-10 h-10 text-[#f97316] animate-spin" />
                    <p className="text-sm font-medium text-[#475569]">
                      Analysing your lease portfolio…
                      {loadingSec > 0 ? ` (${loadingSec}s)` : ''}
                    </p>
                    {loadingSec >= 20 && (
                      <p className="text-xs text-[#94a3b8] max-w-md text-center">
                        AI analysis can take up to 2 minutes for large portfolios. Portfolio-based insights will
                        appear if the AI service is unavailable.
                      </p>
                    )}
                  </div>
                )}

                {aiResult && !loading && (
                  <>
                    {aiResult.cfo_summary ? (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                        <div className="bg-blue-900 text-white rounded-xl p-4">
                          <div className="text-xs text-blue-300 uppercase mb-1">Annual Commitment</div>
                          <div className="text-2xl font-bold">
                            {formatAmount(aiResult.cfo_summary?.total_annual_commitment)}
                          </div>
                        </div>
                        <div className="bg-red-900 text-white rounded-xl p-4">
                          <div className="text-xs text-red-300 uppercase mb-1">Biggest Risk</div>
                          <div className="text-sm font-semibold leading-snug">
                            {aiResult.cfo_summary?.biggest_risk ?? '—'}
                          </div>
                        </div>
                        <div className="bg-green-800 text-white rounded-xl p-4">
                          <div className="text-xs text-green-300 uppercase mb-1">Potential Annual Saving</div>
                          <div className="text-2xl font-bold">
                            {formatAmount(aiResult.cfo_summary?.potential_annual_saving)}
                          </div>
                        </div>
                      </div>
                    ) : null}

                    <div className={`${cardClass} p-6`}>
                      <div className="flex flex-col md:flex-row md:items-center gap-6">
                        {(() => {
                          const score = Math.min(100, Math.max(0, Math.round(aiResult.health_score)));
                          const { ring, label } = healthColors(score);
                          const r = 52;
                          const circ = 2 * Math.PI * r;
                          const offset = circ - (score / 100) * circ;
                          return (
                            <div className="flex flex-col items-center shrink-0">
                              <svg width={120} height={120} viewBox="0 0 120 120">
                                <circle
                                  cx={60}
                                  cy={60}
                                  r={r}
                                  fill="none"
                                  stroke="#e2e8f0"
                                  strokeWidth={10}
                                />
                                <circle
                                  cx={60}
                                  cy={60}
                                  r={r}
                                  fill="none"
                                  stroke={ring}
                                  strokeWidth={10}
                                  strokeDasharray={circ}
                                  strokeDashoffset={offset}
                                  strokeLinecap="round"
                                  transform="rotate(-90 60 60)"
                                />
                                <text
                                  x={60}
                                  y={56}
                                  textAnchor="middle"
                                  className="text-2xl font-bold"
                                  fill={ring}
                                  style={{ fontSize: 28 }}
                                >
                                  {score}
                                </text>
                                <text
                                  x={60}
                                  y={78}
                                  textAnchor="middle"
                                  fill="#64748b"
                                  style={{ fontSize: 11 }}
                                >
                                  / 100
                                </text>
                              </svg>
                              <p className={`text-sm font-semibold mt-2 ${label}`}>{aiResult.health_label}</p>
                            </div>
                          );
                        })()}
                        <div className="flex-1 min-w-0">
                          <h3 className="text-lg font-semibold text-[#1e293b] mb-2">Portfolio health</h3>
                          <p className="text-sm text-[#475569] leading-relaxed">{aiResult.summary}</p>
                          {lastAnalysedAt && (
                            <p className="text-xs text-[#94a3b8] mt-3">
                              Last analysed:{' '}
                              {new Date(lastAnalysedAt).toLocaleString('en-IN', {
                                dateStyle: 'medium',
                                timeStyle: 'short',
                              })}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50/80 px-4 py-3 flex gap-2 items-start">
                        <Zap className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                        <div>
                          <p className="text-xs font-semibold text-amber-900 uppercase tracking-wide">
                            Top recommendation this week
                          </p>
                          <p className="text-sm font-bold text-[#1e293b] mt-1">{aiResult.top_recommendation}</p>
                        </div>
                      </div>
                    </div>

                    <div>
                      <h3 className="text-base font-semibold text-[#1e293b] mb-3">Strategic insights</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {aiResult.insights.map((ins, idx) => (
                          <div
                            key={`${ins.title}-${idx}`}
                            className={`${cardClass} flex overflow-hidden`}
                          >
                            <div className={`w-1.5 shrink-0 ${insightBarClass(ins.type)}`} />
                            <div className="p-4 flex-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-2 mb-2">
                                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-[#f1f5f9] text-[#475569]">
                                  {ins.type}
                                </span>
                                <span className="text-xs text-[#64748b]">
                                  {severityEmoji(ins.severity)} {ins.severity}
                                </span>
                              </div>
                              <p className="font-bold text-[#1e293b] text-sm">{ins.title}</p>
                              <p className="text-xs text-[#64748b] mt-1 leading-relaxed">{ins.description}</p>
                              {ins.cfo_question ? (
                                <p className="text-xs text-blue-800 mt-2 font-medium">
                                  <span className="text-[#64748b]">CFO question:</span> {ins.cfo_question}
                                </p>
                              ) : null}
                              {ins.financial_impact ? (
                                <p className="text-xs text-[#1e293b] mt-1">
                                  <span className="font-semibold">Financial impact:</span> {ins.financial_impact}
                                </p>
                              ) : null}
                              {typeof ins.calculation === 'string' && ins.calculation.length > 0 ? (
                                <div className="mt-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded text-xs font-mono text-gray-600">
                                  📐 {ins.calculation}
                                </div>
                              ) : null}
                              {ins.if_ignored ? (
                                <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                                  <span className="font-semibold">If ignored:</span>
                                  <span className="ml-1">{ins.if_ignored}</span>
                                </div>
                              ) : null}
                              <div className="mt-3 pt-3 border-t border-[#f1f5f9]">
                                <p className="text-xs text-[#475569]">
                                  <span className="font-semibold">→ Recommended Action:</span> {ins.action}
                                </p>
                                {ins.lease_id ? (
                                  <Link
                                    href={`/dashboard/ifrs16/leases/${encodeURIComponent(ins.lease_id)}`}
                                    className="inline-block mt-2 text-xs font-medium text-[#2E86AB] hover:underline"
                                  >
                                    View Lease →
                                  </Link>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {aiResult.actions && aiResult.actions.length > 0 ? (
                      <div>
                        <h3 className="text-base font-semibold text-[#1e293b] mb-3">CFO actions</h3>
                        <div className="grid grid-cols-1 gap-4">
                          {aiResult.actions.map((action, aidx) => (
                            <div
                              key={action.id || `action-${aidx}`}
                              className={`${cardClass} p-4 border-l-4 border-l-[#2E86AB]`}
                            >
                              <div className="flex flex-wrap items-center gap-2 mb-2">
                                {action.category ? (
                                  <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 border border-amber-300">
                                    {categoryLabels[action.category] ?? action.category}
                                  </span>
                                ) : null}
                                {action.priority ? (
                                  <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-blue-100 text-blue-800 border border-blue-200">
                                    {action.priority}
                                  </span>
                                ) : null}
                                {action.owner ? (
                                  <span className="text-xs text-[#64748b]">{action.owner}</span>
                                ) : null}
                                {action.deadline ? (
                                  <span className="text-xs text-[#64748b]">Due {action.deadline}</span>
                                ) : null}
                              </div>
                              <p className="font-bold text-[#1e293b] text-sm">{action.title}</p>
                              <p className="text-xs text-[#64748b] mt-1 leading-relaxed">{action.description}</p>
                              {action.potential_saving_or_cost ? (
                                <p className="text-xs text-[#1e293b] mt-2">
                                  <span className="font-semibold">Potential saving / cost:</span>{' '}
                                  {action.potential_saving_or_cost}
                                </p>
                              ) : null}
                              {action.cfo_decision ? (
                                <div className="mt-2 p-2 bg-blue-50 border-l-4 border-blue-500 rounded text-xs">
                                  <span className="font-semibold text-blue-700">Decision needed:</span>
                                  <span className="text-blue-600 ml-1">{action.cfo_decision}</span>
                                </div>
                              ) : null}
                              {action.options && action.options.length > 0 ? (
                                <div className="mt-3 grid grid-cols-2 gap-2">
                                  {action.options.map((opt, i) => {
                                    const first = opt.option[0];
                                    const isRec =
                                      first != null &&
                                      Boolean(action.recommended_option?.startsWith(first));
                                    return (
                                      <div
                                        key={i}
                                        className={`p-2 rounded border text-xs ${
                                          isRec ? 'border-green-400 bg-green-50' : 'border-gray-200 bg-gray-50'
                                        }`}
                                      >
                                        <div className="font-semibold mb-1">
                                          {opt.option}
                                          {isRec ? (
                                            <span className="ml-1 text-green-600">✓ Recommended</span>
                                          ) : null}
                                        </div>
                                        <div className="text-gray-600">{opt.financial_impact}</div>
                                        <div className="text-green-600 mt-1">+ {opt.pros}</div>
                                        <div className="text-red-600">- {opt.cons}</div>
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : null}
                              {action.financial_consequence_if_ignored ? (
                                <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                                  <span className="font-semibold">⚠ If ignored:</span>
                                  <span className="ml-1">{action.financial_consequence_if_ignored}</span>
                                </div>
                              ) : null}
                              {action.lease_id ? (
                                <Link
                                  href={`/dashboard/ifrs16/leases/${encodeURIComponent(action.lease_id)}`}
                                  className="inline-block mt-2 text-xs font-medium text-[#2E86AB] hover:underline"
                                >
                                  View Lease →
                                </Link>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {aiResult.cash_flow_forecast ? (
                      <div className="mt-6">
                        <h3 className="text-lg font-bold text-gray-900 mb-3">📅 5-Year Cash Flow Forecast</h3>
                        <div className="overflow-x-auto pb-1">
                          <div className="grid grid-cols-5 gap-3 min-w-[520px]">
                            {(['year_1', 'year_2', 'year_3', 'year_4', 'year_5'] as const).map((yr, i) => {
                              const v = aiResult.cash_flow_forecast?.[yr];
                              return (
                                <div
                                  key={yr}
                                  className="bg-white border border-gray-200 rounded-xl p-4 text-center shadow-sm"
                                >
                                  <div className="text-xs text-gray-500 mb-1 uppercase">Year {i + 1}</div>
                                  <div className="text-lg font-bold text-blue-700">{formatAmount(v)}</div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                        <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
                          📊 Total 5-year commitment:
                          <strong className="ml-1">
                            {formatAmount(aiResult.cash_flow_forecast?.total_5_year)}
                          </strong>
                          {aiResult.cash_flow_forecast?.note ? (
                            <span className="ml-2 text-blue-600">— {aiResult.cash_flow_forecast.note}</span>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            )}

            {/* Table */}
            <div className={`${cardClass} overflow-hidden`}>
              <div className="px-5 py-4 border-b border-[#e2e8f0]">
                <h3 className="text-base font-semibold text-[#1e293b]">Lease breakdown</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#f8fafc] text-left text-xs font-semibold text-[#64748b] uppercase tracking-wide">
                      <th className="px-4 py-3">Asset Description</th>
                      <th className="px-4 py-3">City</th>
                      <th className="px-4 py-3 text-right">Monthly Payment</th>
                      <th className="px-4 py-3 text-right">Lease Liability</th>
                      <th className="px-4 py-3 text-right">IBR %</th>
                      <th className="px-4 py-3">Expiry Date</th>
                      <th className="px-4 py-3 text-right">% of Portfolio</th>
                      <th className="px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map(({ lease: l, pct }) => {
                      const pctCell =
                        pct > 40
                          ? 'bg-red-100 text-red-900 font-medium'
                          : pct >= 20
                            ? 'bg-amber-100 text-amber-900 font-medium'
                            : '';
                      return (
                        <tr key={l.id} className="border-t border-[#f1f5f9] hover:bg-[#fafafa]">
                          <td className="px-4 py-3 text-[#1e293b] max-w-[200px] truncate" title={l.asset_description}>
                            {l.asset_description || '—'}
                          </td>
                          <td className="px-4 py-3 text-[#475569]">{l.city || '—'}</td>
                          <td className="px-4 py-3 text-right font-mono text-[#1e293b]">
                            {formatMoney(l.monthly_payment, l.currency)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-[#1e293b]">
                            {formatMoney(l.results?.lease_liability || 0, l.currency)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono">
                            {Number(l.calculated_discount_rate || 0).toFixed(2)}%
                          </td>
                          <td className="px-4 py-3 text-[#475569]">
                            {l.end_date ? formatDate(l.end_date) : '—'}
                          </td>
                          <td className={`px-4 py-3 text-right font-mono ${pctCell}`}>
                            {totalLiability > 0 ? `${pct.toFixed(1)}%` : '—'}
                          </td>
                          <td className="px-4 py-3 text-[#475569]">{l.status || '—'}</td>
                        </tr>
                      );
                    })}
                    <tr className="border-t-2 border-[#e2e8f0] bg-[#f8fafc] font-semibold">
                      <td className="px-4 py-3 text-[#1e293b]" colSpan={3}>
                        Total
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-[#1e293b]">
                        {formatPortfolioTotal(totalLiability)}
                      </td>
                      <td className="px-4 py-3" colSpan={4} />
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </SidebarLayout>
  );
}
