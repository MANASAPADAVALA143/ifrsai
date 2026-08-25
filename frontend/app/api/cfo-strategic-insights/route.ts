import { NextResponse } from 'next/server';
import { getBackendBaseUrl } from '@/lib/backend-base';
import { extractJsonObject, parseAiJsonObject, repairTruncatedJson } from '@/lib/parse-ai-json';
import {
  num,
  leaseLiabilityFromRow,
  rouAssetFromRow,
  currentLiabilityFromRow,
  currentRouFromRow,
  monthlyPaymentFromRow,
  daysToExpiry,
  buildCashFlowForecast,
  classifyExpiry,
  computeHealthScore,
  type LeaseRow,
} from '@/lib/ifrs16-cfo-insights-calc';

/**
 * Proxies Claude requests server-side (browser cannot call api.anthropic.com with API key due to CORS).
 * Local dev: ANTHROPIC_API_KEY in frontend/.env.local OR root .env via Python backend fallback.
 */
const ANTHROPIC_TIMEOUT_MS = 120_000;

function calculatedIbrPct(l: LeaseRow): number {
  const fromPayload = num(l.discount_rate_pct);
  if (fromPayload > 0) return fromPayload;
  const res = l.results as LeaseRow | undefined;
  const disc = res?.disclosure_data as { discount_rate_pct?: number } | undefined;
  if (disc?.discount_rate_pct != null && Number.isFinite(Number(disc.discount_rate_pct))) {
    return Number(disc.discount_rate_pct);
  }
  const raw = num(l.annual_discount_rate ?? l.ibr ?? l.discount_rate);
  if (raw <= 0) return 0;
  return raw <= 1 ? raw * 100 : raw;
}

function mapLeaseForPrompt(l: LeaseRow, todayStr: string) {
  const monthly = monthlyPaymentFromRow(l);
  const ll = leaseLiabilityFromRow(l);
  const currentLl = currentLiabilityFromRow(l);
  const currentRou = currentRouFromRow(l);
  const ibrPct = calculatedIbrPct(l);
  const endDate = (l.end_date ?? l.endDate) as string | undefined;
  const days = daysToExpiry(endDate, todayStr);
  return {
    id: l.lease_id ?? l.id,
    asset: l.asset_description ?? l.asset,
    city: l.city,
    monthly_payment: monthly,
    annual_payment: monthly * 12,
    lease_liability: ll,
    rou_asset: rouAssetFromRow(l),
    current_lease_liability: currentLl.value,
    current_rou_asset: currentRou.value,
    current_values_are_estimated: currentLl.isFallback || currentRou.isFallback,
    ibr: ibrPct,
    term_months: num(l.lease_term_months ?? l.term_months),
    end_date: endDate ?? null,
    days_to_expiry: days,
    currency: typeof l.currency === 'string' ? l.currency : '',
  };
}

function dominantPortfolioCurrency(rows: LeaseRow[]): string {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const ccy = String(row.currency || 'AED').trim().toUpperCase() || 'AED';
    counts.set(ccy, (counts.get(ccy) || 0) + 1);
  }
  let best = 'AED';
  let max = 0;
  counts.forEach((n, ccy) => {
    if (n > max) {
      max = n;
      best = ccy;
    }
  });
  return best;
}

function buildCfoAdvisorPrompt(rows: LeaseRow[], today: string): string {
  const totalMonthly = rows.reduce((sum, l) => sum + monthlyPaymentFromRow(l), 0);
  const totalAnnual = totalMonthly * 12;
  const todayDate = new Date(today);

  // Pre-compute days_to_expiry + current carrying values for every lease so Claude
  // never has to calculate dates or guess at amortisation.
  const mappedLeases = rows.map((l) => mapLeaseForPrompt(l, today));
  const { active: activeLeasesAll, expired: alreadyExpired, expiring90, expiring12mo, expiringTotal12mo } =
    classifyExpiry(mappedLeases);

  const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  const toLine = (l: ReturnType<typeof mapLeaseForPrompt>) =>
    `  • ${String(l.asset)} (${String(l.id)}): expires ${String(l.end_date)} — ${l.days_to_expiry as number} days remaining`;

  const expiry90Lines = expiring90.length > 0 ? expiring90.map(toLine).join('\n') : '  (none)';
  const expiry12moLines = expiring12mo.length > 0 ? expiring12mo.map(toLine).join('\n') : '  (none)';

  // Initial-measurement sums (all leases, at commencement).
  const totalLiability = rows.reduce((sum, l) => sum + leaseLiabilityFromRow(l), 0);
  const totalRou = rows.reduce((sum, l) => sum + rouAssetFromRow(l), 0);

  // CURRENT carrying values — read from each lease's own amortization schedule (row
  // nearest today), summed across ACTIVE leases only. This is the true current-period
  // position, distinct from the initial-measurement totals above.
  const activeRows = rows.filter((_, i) => mappedLeases[i].days_to_expiry !== null && (mappedLeases[i].days_to_expiry as number) >= 0);
  const totalCurrentLiability = activeRows.reduce((sum, l) => sum + currentLiabilityFromRow(l).value, 0);
  const totalCurrentRou = activeRows.reduce((sum, l) => sum + currentRouFromRow(l).value, 0);
  const anyCurrentValuesEstimated = mappedLeases.some((l) => l.current_values_are_estimated);

  // Pre-built year-by-year cash flow forecast (replaces flat annual × 5 estimate).
  const forecast = buildCashFlowForecast(rows, today);

  // Deterministic, documented health score — computed in code, not by Claude.
  const top5Liability = [...activeRows]
    .sort((a, b) => currentLiabilityFromRow(b).value - currentLiabilityFromRow(a).value)
    .slice(0, 5)
    .reduce((s, l) => s + currentLiabilityFromRow(l).value, 0);
  const dataQualityIssueCount = rows.filter((l) => {
    const endDate = l.end_date ?? l.endDate;
    const hasEndDate = endDate && typeof endDate === 'string' && endDate.length >= 8;
    const hasLiabilityNoRou = leaseLiabilityFromRow(l) > 0 && rouAssetFromRow(l) === 0;
    return !hasEndDate || hasLiabilityNoRou;
  }).length;
  const health = computeHealthScore({
    activeLeases: activeLeasesAll,
    totalLeases: rows.length,
    totalActiveLiability: totalCurrentLiability,
    top5Liability,
    expiring90Count: expiring90.length,
    expiring12moCount: expiring12mo.length,
    dataQualityIssueCount,
  });
  const healthFactorLines = health.factors.length > 0
    ? health.factors.map((f) => `  • ${f.name}: -${f.deduction} (${f.detail})`).join('\n')
    : '  (no deductions — all factors within healthy range)';

  const leaseJson = JSON.stringify(mappedLeases, null, 2);
  const reportCcy = dominantPortfolioCurrency(rows);

  return `You are a CFO advisor analysing an IFRS 16 lease portfolio under IFRS 16.

TODAY: ${today}
PORTFOLIO REPORTING CURRENCY: ${reportCcy}

══════════════════════════════════════════════════════════
PRE-COMPUTED PORTFOLIO FACTS — use these verbatim; do NOT recalculate.
══════════════════════════════════════════════════════════
Total leases in portfolio: ${rows.length}
Contractually active as of ${today}: ${activeLeasesAll.length}  (expires AFTER today)
Already expired / outside term: ${alreadyExpired.length}

EXPIRY PIPELINE (days calculated from TODAY = ${today}):
  Expiring within 0–90 days (CRITICAL — ${expiring90.length} lease${expiring90.length !== 1 ? 's' : ''}):
${expiry90Lines}
  Expiring in 91–365 days (watch list — ${expiring12mo.length} lease${expiring12mo.length !== 1 ? 's' : ''}):
${expiry12moLines}
  TOTAL expiring within 12 months: ${expiringTotal12mo}

ROU ASSET & LEASE LIABILITY — TWO DISTINCT FIGURES, DO NOT CONFLATE THEM:
(A) INITIAL MEASUREMENT (sum of values recorded at each lease's commencement date, all ${rows.length} leases):
    Total ROU Asset (initial): ${reportCcy} ${fmt(totalRou)}
    Total Lease Liability (initial): ${reportCcy} ${fmt(totalLiability)}
(B) CURRENT CARRYING VALUE as of ${today} (read from each active lease's own amortization
    schedule — the row closest to today — summed across the ${activeLeasesAll.length} ACTIVE leases)${anyCurrentValuesEstimated ? ' — NOTE: some leases lack a schedule and fall back to their initial value, flagged per-lease as current_values_are_estimated' : ''}:
    Total ROU Asset (current): ${reportCcy} ${fmt(totalCurrentRou)}
    Total Lease Liability (current): ${reportCcy} ${fmt(totalCurrentLiability)}
When discussing "amortisation phase" or portfolio maturity, use figure (B), the CURRENT values —
never infer amortisation phase from figure (A), the initial-measurement sums.

ANNUAL COMMITMENT (current-period run-rate, ${activeLeasesAll.length} active leases):
Monthly outflow: ${reportCcy} ${fmt(totalMonthly)}
Annualised run-rate: ${reportCcy} ${fmt(totalAnnual)}
(Note: this run-rate will decline as ${expiringTotal12mo} lease${expiringTotal12mo !== 1 ? 's' : ''} expire within 12 months.)

PRE-BUILT 5-YEAR CASH FLOW FORECAST (year-by-year, actual lease terms + escalation):
Year 1 (${today} to ${new Date(todayDate.getTime() + 365 * 86400000).toISOString().slice(0, 10)}): ${reportCcy} ${fmt(forecast.year_1)}
Year 2: ${reportCcy} ${fmt(forecast.year_2)}
Year 3: ${reportCcy} ${fmt(forecast.year_3)}
Year 4: ${reportCcy} ${fmt(forecast.year_4)}
Year 5: ${reportCcy} ${fmt(forecast.year_5)}
Total 5-year: ${reportCcy} ${fmt(forecast.total_5_year)}
Methodology: ${forecast.note}

PRE-COMPUTED HEALTH SCORE (deterministic, NOT generated by you — you must echo this exact
number and label in your JSON response; you only write the narrative around it):
Score: ${health.score}/100 — ${health.label}
Methodology (documented, auditable — starts at 100, deducts per factor):
${healthFactorLines}

══════════════════════════════════════════════════════════
PORTFOLIO DATA (${rows.length} leases — each row includes pre-computed days_to_expiry and current carrying values):
══════════════════════════════════════════════════════════
${leaseJson}

══════════════════════════════════════════════════════════
CRITICAL RULES — MANDATORY COMPLIANCE:
══════════════════════════════════════════════════════════
1. Every monetary amount must use ${reportCcy}. Never use $ or USD unless portfolio currency is USD.
2. Use ONLY the pre-computed days_to_expiry values above. Never recalculate from dates.
3. Report active lease count as ${activeLeasesAll.length} (NOT ${rows.length}); the remaining ${alreadyExpired.length} are past their contractual end date.
4. Report "expiring within 12 months" as ${expiringTotal12mo} (= ${expiring90.length} within 90 days + ${expiring12mo.length} in 91–365 days).
5. Use the pre-built 5-year forecast numbers above. Do NOT substitute flat annual × 5 arithmetic.
6. Use the CURRENT carrying values (figure B) for portfolio-maturity commentary. Use INITIAL
   values (figure A) only when discussing initial recognition. Do NOT claim an "accelerating
   amortisation phase" or any amortisation-rate comparison — those rates are not in the data.
   You may say cash outflows decline as leases expire when the forecast supports it.
7. Always state counts with population: "9 of N active leases", never bare "9 leases" when
   total portfolio size differs from active count.
8. Do NOT generate a "cost optimisation" or "sublease opportunity" insight unless the portfolio data includes utilisation_pct, market_rent, or sublease_income fields. None of those fields are present in this dataset — omit this insight category entirely.
9. You MUST echo health_score=${health.score} and health_label="${health.label} (indicative)" exactly as given — do not compute your own score.

Return ONLY valid JSON (no markdown):
{
  "health_score": ${health.score},
  "health_label": "${health.label} (indicative)",
  "cfo_summary": {
    "total_annual_commitment": <number — use pre-built year_1 forecast, not flat run-rate>,
    "total_liability": ${totalCurrentLiability},
    "total_rou_assets": ${totalCurrentRou},
    "monthly_outflow": <number>,
    "active_leases": ${activeLeasesAll.length},
    "expired_leases": ${alreadyExpired.length},
    "expiring_90_days": ${expiring90.length},
    "expiring_12_months": ${expiringTotal12mo},
    "biggest_risk": "<lease id + days_to_expiry from pre-computed data>",
    "most_urgent_decision": "<action + exact expiry date>",
    "data_quality_note": "Total liability and ROU figures above are CURRENT carrying values as of ${today}, read from each lease's amortization schedule."
  },
  "summary": "<3 sentences for CFO — must reference ${activeLeasesAll.length} active leases and ${expiringTotal12mo} expiring within 12 months>",
  "top_recommendation": "<action — amount — exact deadline YYYY-MM-DD>",
  "insights": [ /* 5 items; no cost-optimisation insight unless utilisation data is present */ ],
  "actions": [ /* 4 items */ ],
  "health_score_factors": ${JSON.stringify(health.factors)},
  "cash_flow_forecast": {
    "year_1": ${forecast.year_1},
    "year_2": ${forecast.year_2},
    "year_3": ${forecast.year_3},
    "year_4": ${forecast.year_4},
    "year_5": ${forecast.year_5},
    "total_5_year": ${forecast.total_5_year},
    "note": "${forecast.note}"
  }
}

insights schema: { type, severity, title, description (with exact days_to_expiry), action, financial_impact, calculation, lease_id }
actions schema: { id, category, title, description, priority, deadline (YYYY-MM-DD), lease_id, is_ai_generated: true }`;
}

function mapBackendToAiAnalysisText(data: Record<string, unknown>): string {
  const metrics = (data.metrics as Record<string, unknown>) || {};
  // Defensive filter — drop any COST_OPTIMISATION insight even if the backend's own
  // filter missed it, since this dataset has no utilisation/market-rent data to support one.
  const insightsRaw = ((data.insights as Array<Record<string, unknown>>) || []).filter(
    (i) => String(i.category || '').toUpperCase() !== 'COST_OPTIMISATION'
  );
  const annual = num(metrics.total_annual_payments);
  const liability = num(metrics.total_liability);
  const rouAssets = metrics.total_rou_assets != null ? num(metrics.total_rou_assets) : undefined;
  const activeLeases = metrics.active_lease_count != null ? num(metrics.active_lease_count) : undefined;
  const expiredLeases = metrics.expired_lease_count != null ? num(metrics.expired_lease_count) : undefined;
  const expiring90 = metrics.expiring_90_days != null ? num(metrics.expiring_90_days) : undefined;
  const expiring12mo = metrics.expiring_12_months != null ? num(metrics.expiring_12_months) : undefined;
  const dataQualityNote = metrics.data_quality_note != null ? String(metrics.data_quality_note) : undefined;
  const backendForecast = (metrics.cash_flow_forecast as Record<string, unknown>) || null;
  const healthFactors = Array.isArray(metrics.health_score_factors) ? metrics.health_score_factors : undefined;
  const first = insightsRaw[0];

  // health_score / health_label_suffix are computed deterministically server-side (see
  // _ifrs16_compute_health_score in app.py) — use them directly rather than re-deriving
  // a label from Claude's own overall_health field, which would duplicate the label.
  const mapped = {
    health_score: num(data.health_score) || 50,
    health_label: data.health_label_suffix != null ? String(data.health_label_suffix) : 'Fair (indicative)',
    summary: String(data.one_line_summary || 'Portfolio analysis complete.'),
    top_recommendation: first
      ? `${first.recommendation || first.title} — ${first.impact || ''}`
      : 'Review largest leases for renewal and IBR benchmarking.',
    health_score_factors: healthFactors,
    cfo_summary: {
      total_annual_commitment: annual,
      total_liability: liability,
      total_rou_assets: rouAssets,
      monthly_outflow: annual / 12,
      active_leases: activeLeases,
      expired_leases: expiredLeases,
      expiring_90_days: expiring90,
      expiring_12_months: expiring12mo,
      biggest_risk: String(
        insightsRaw.find((i) => String(i.severity).toUpperCase() === 'HIGH')?.title ||
          first?.title ||
          'Concentration in top leases'
      ),
      most_urgent_decision: String(first?.recommendation || 'Review expiring leases'),
      data_quality_note: dataQualityNote,
    },
    insights: insightsRaw.map((i) => ({
      type: String(i.category || 'Risk'),
      severity: String(i.severity || 'Medium'),
      title: String(i.title || ''),
      description: String(i.finding || i.title || ''),
      action: String(i.recommendation || ''),
      financial_impact: String(i.impact || ''),
      lease_id: null,
    })),
    actions: insightsRaw.slice(0, 4).map((i, idx) => ({
      id: `ACT-${String(idx + 1).padStart(3, '0')}`,
      category: String(i.category || 'CASH_FLOW'),
      title: String(i.title || ''),
      description: String(i.finding || ''),
      priority: String(i.severity || 'Medium'),
      lease_id: null,
      is_ai_generated: true,
    })),
    // Prefer the backend's real year-by-year forecast; only fall back to a flat
    // estimate (clearly noted as such) if the backend didn't provide one.
    cash_flow_forecast: backendForecast
      ? {
          year_1: num(backendForecast.year_1),
          year_2: num(backendForecast.year_2),
          year_3: num(backendForecast.year_3),
          year_4: num(backendForecast.year_4),
          year_5: num(backendForecast.year_5),
          total_5_year: num(backendForecast.total_5_year),
          note: String(backendForecast.note || ''),
        }
      : {
          year_1: annual,
          year_2: annual,
          year_3: annual,
          year_4: annual,
          year_5: annual,
          total_5_year: annual * 5,
          note: 'Fallback estimate: current annual run-rate held flat (backend forecast unavailable). Does not account for lease expiries or escalations.',
        },
  };

  return JSON.stringify(mapped);
}

async function callAnthropic(prompt: string, key: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ANTHROPIC_TIMEOUT_MS);
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
        max_tokens: 8192,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const msg =
        (data as { error?: { message?: string } })?.error?.message ||
        `Anthropic API error: ${response.status}`;
      throw new Error(msg);
    }

    const text = (data as { content?: Array<{ type?: string; text?: string }> })?.content?.[0]?.text;
    if (typeof text !== 'string' || !text.trim()) {
      throw new Error('Unexpected response shape from Claude');
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function callPythonBackend(rows: Record<string, unknown>[]): Promise<string> {
  const base = getBackendBaseUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ANTHROPIC_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/api/ifrs16/cfo-insights`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leases: rows,
        total_assets: 0,
        annual_revenue: 0,
        budget_lease_cost: 0,
      }),
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const detail =
        typeof data.detail === 'string'
          ? data.detail
          : `Backend CFO insights failed (${res.status})`;
      throw new Error(detail);
    }
    return mapBackendToAiAnalysisText(data);
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(req: Request) {
  let body: { prompt?: string; leases?: unknown[]; today?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const leasesRaw = body.leases;
  const today =
    typeof body.today === 'string' && body.today.trim()
      ? body.today.trim()
      : new Date().toISOString().split('T')[0];

  let rows: Record<string, unknown>[] = [];
  let prompt = '';

  if (Array.isArray(leasesRaw) && leasesRaw.length > 0) {
    rows = leasesRaw.filter((x) => x != null && typeof x === 'object') as Record<string, unknown>[];
    const forPrompt = [...rows]
      .sort((a, b) => leaseLiabilityFromRow(b) - leaseLiabilityFromRow(a))
      .slice(0, 12);
    prompt = buildCfoAdvisorPrompt(forPrompt, today);
  } else {
    prompt = typeof body.prompt === 'string' ? body.prompt : '';
  }

  if (!prompt.trim() && rows.length === 0) {
    return NextResponse.json({ error: 'Missing prompt or leases' }, { status: 400 });
  }

  // Data-consistency safeguards — block analysis rather than let the AI generate false narratives.
  if (rows.length > 0) {
    const totalRouCheck = rows.reduce((s, l) => s + rouAssetFromRow(l), 0);
    const totalLiabilityCheck = rows.reduce((s, l) => s + leaseLiabilityFromRow(l), 0);

    // Check 1: ROU = 0 while liability > 0 means rou_asset was never sent to this endpoint.
    if (totalLiabilityCheck > 0 && totalRouCheck === 0) {
      console.error(
        `[cfo-strategic-insights] VALIDATION FAILED (rou_missing): ${rows.length} leases, ` +
        `total_liability=${totalLiabilityCheck}, total_rou=0. ` +
        'Blocking to prevent false "ROU = AED 0" insight.'
      );
      return NextResponse.json(
        { error: 'Analysis temporarily unavailable — data validation failed: ROU asset values missing. Please recalculate leases and retry.' },
        { status: 422 }
      );
    }

    // Check 2: all end_dates missing means expiry insights would be hallucinated.
    const rowsWithEndDate = rows.filter((l) => {
      const ed = l.end_date ?? l.endDate;
      return ed && typeof ed === 'string' && ed.length >= 8;
    });
    if (rowsWithEndDate.length === 0) {
      console.error(
        `[cfo-strategic-insights] VALIDATION FAILED (end_date_missing): ${rows.length} leases have no end_date. ` +
        'Expiry insights would be hallucinated. Blocking analysis.'
      );
      return NextResponse.json(
        { error: 'Analysis temporarily unavailable — data validation failed: lease end dates missing. Please ensure commencement dates and terms are set.' },
        { status: 422 }
      );
    }
  }

  const key = process.env.ANTHROPIC_API_KEY?.trim();
  const errors: string[] = [];

  // Prefer Python backend for portfolio analysis — returns compact, valid JSON.
  if (rows.length > 0) {
    try {
      const text = await callPythonBackend(rows);
      return NextResponse.json({ text, source: 'python' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Backend request failed';
      errors.push(msg.includes('abort') ? 'Backend analysis timed out (120s)' : msg);
    }
  }

  if (key && prompt.trim()) {
    try {
      const rawText = await callAnthropic(prompt, key);
      let parsed: Record<string, unknown>;
      try {
        parsed = parseAiJsonObject(rawText);
      } catch {
        const repaired = repairTruncatedJson(extractJsonObject(rawText));
        parsed = JSON.parse(repaired) as Record<string, unknown>;
      }
      return NextResponse.json({ text: JSON.stringify(parsed), source: 'anthropic' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Anthropic request failed';
      errors.push(msg.includes('abort') ? 'AI analysis timed out (120s)' : msg);
    }
  } else if (!key && rows.length === 0) {
    errors.push('ANTHROPIC_API_KEY not set in frontend/.env.local');
  }

  return NextResponse.json(
    {
      error:
        errors.join(' · ') ||
        'CFO analysis unavailable. Start the Python backend (START_LOCALHOST.bat) and set ANTHROPIC_API_KEY in .env',
    },
    { status: 503 }
  );
}
