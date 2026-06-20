import { NextResponse } from 'next/server';
import { getBackendBaseUrl } from '@/lib/backend-base';
import { extractJsonObject, parseAiJsonObject, repairTruncatedJson } from '@/lib/parse-ai-json';

/**
 * Proxies Claude requests server-side (browser cannot call api.anthropic.com with API key due to CORS).
 * Local dev: ANTHROPIC_API_KEY in frontend/.env.local OR root .env via Python backend fallback.
 */
const ANTHROPIC_TIMEOUT_MS = 120_000;

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function leaseLiabilityFromRow(l: Record<string, unknown>): number {
  const top = num(l.lease_liability);
  if (top > 0) return top;
  const res = l.results as Record<string, unknown> | undefined;
  return num(res?.lease_liability);
}

function monthlyPaymentFromRow(l: Record<string, unknown>): number {
  return num(l.monthly_payment);
}

function calculatedIbrPct(l: Record<string, unknown>): number {
  const fromPayload = num(l.discount_rate_pct);
  if (fromPayload > 0) return fromPayload;
  const res = l.results as Record<string, unknown> | undefined;
  const disc = res?.disclosure_data as { discount_rate_pct?: number } | undefined;
  if (disc?.discount_rate_pct != null && Number.isFinite(Number(disc.discount_rate_pct))) {
    return Number(disc.discount_rate_pct);
  }
  const raw = num(l.annual_discount_rate ?? l.ibr ?? l.discount_rate);
  if (raw <= 0) return 0;
  return raw <= 1 ? raw * 100 : raw;
}

function mapLeaseForPrompt(l: Record<string, unknown>) {
  const res = l.results as Record<string, unknown> | undefined;
  const monthly = monthlyPaymentFromRow(l);
  const ll = leaseLiabilityFromRow(l);
  const ibrPct = calculatedIbrPct(l);
  return {
    id: l.lease_id ?? l.id,
    asset: l.asset_description ?? l.asset,
    city: l.city,
    monthly_payment: monthly,
    annual_payment: monthly * 12,
    lease_liability: ll,
    rou_asset: num(l.rou_asset ?? res?.rou_asset),
    ibr: ibrPct,
    term_months: num(l.lease_term_months ?? l.term_months),
    end_date: l.end_date ?? l.endDate,
    currency: typeof l.currency === 'string' ? l.currency : '',
  };
}

function dominantPortfolioCurrency(rows: Record<string, unknown>[]): string {
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

function buildCfoAdvisorPrompt(rows: Record<string, unknown>[], today: string): string {
  const totalLiability = rows.reduce((sum, l) => sum + leaseLiabilityFromRow(l), 0);
  const totalMonthly = rows.reduce((sum, l) => sum + monthlyPaymentFromRow(l), 0);
  const totalAnnual = totalMonthly * 12;
  const in12mo = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const leaseJson = JSON.stringify(rows.map((l) => mapLeaseForPrompt(l)), null, 2);
  const reportCcy = dominantPortfolioCurrency(rows);

  return `You are a CFO advisor analysing an IFRS 16 lease portfolio.

TODAY: ${today}
ALERT WINDOW: 12 months through ${in12mo}
PORTFOLIO REPORTING CURRENCY: ${reportCcy}

PORTFOLIO DATA (${rows.length} leases):
${leaseJson}

PORTFOLIO SUMMARY (amounts in ${reportCcy}):
Total Lease Liability: ${reportCcy} ${totalLiability.toLocaleString('en-US', { maximumFractionDigits: 0 })}
Total Monthly Outflow: ${reportCcy} ${totalMonthly.toLocaleString('en-US', { maximumFractionDigits: 0 })}
Total Annual Commitment: ${reportCcy} ${totalAnnual.toLocaleString('en-US', { maximumFractionDigits: 0 })}
Report Date: ${today}

CRITICAL: Every monetary amount in your JSON must use ${reportCcy}
(e.g. "${reportCcy} 305,549,758" or "${reportCcy} 305.5M"). Never use $ or USD unless portfolio currency is USD.

Return ONLY valid JSON (no markdown) with this shape:
{
  "health_score": <0-100>,
  "health_label": "<Excellent|Good|Fair|At Risk>",
  "cfo_summary": {
    "total_annual_commitment": <number>,
    "total_liability": <number>,
    "monthly_outflow": <number>,
    "biggest_risk": "<lease + amount>",
    "most_urgent_decision": "<action + deadline>",
    "potential_annual_saving": <number>
  },
  "summary": "<3 sentences for CFO>",
  "top_recommendation": "<action — amount — deadline>",
  "insights": [
    {
      "type": "<Risk|Opportunity|Renewal|Efficiency|Decision>",
      "severity": "<High|Medium|Low>",
      "title": "<title>",
      "description": "<detail with numbers>",
      "action": "<specific action>",
      "financial_impact": "<amount>",
      "calculation": "<formula>",
      "lease_id": "<id or null>"
    }
  ],
  "actions": [
    {
      "id": "ACT-001",
      "category": "<RENEWAL_DECISION|RENEGOTIATION|CONCENTRATION_RISK|CPI_EXPOSURE|BUY_VS_LEASE|CASH_FLOW>",
      "title": "<title>",
      "description": "<detail>",
      "priority": "<High|Medium|Low>",
      "deadline": "<YYYY-MM-DD>",
      "lease_id": "<id or null>",
      "is_ai_generated": true
    }
  ],
  "cash_flow_forecast": {
    "year_1": <number>,
    "year_2": <number>,
    "year_3": <number>,
    "year_4": <number>,
    "year_5": <number>,
    "total_5_year": <number>,
    "note": "<observation>"
  }
}

Generate 5 insights and 4 actions. Use portfolio currency. Every number must include its formula.`;
}

function mapBackendToAiAnalysisText(data: Record<string, unknown>): string {
  const metrics = (data.metrics as Record<string, unknown>) || {};
  const insightsRaw = (data.insights as Array<Record<string, unknown>>) || [];
  const healthMap: Record<string, string> = {
    STRONG: 'Excellent',
    ADEQUATE: 'Good',
    AT_RISK: 'At Risk',
    CRITICAL: 'At Risk',
  };
  const annual = num(metrics.total_annual_payments);
  const liability = num(metrics.total_liability);
  const first = insightsRaw[0];

  const mapped = {
    health_score: num(data.health_score) || 50,
    health_label: healthMap[String(data.overall_health || 'ADEQUATE')] || 'Fair',
    summary: String(data.one_line_summary || 'Portfolio analysis complete.'),
    top_recommendation: first
      ? `${first.recommendation || first.title} — ${first.impact || ''}`
      : 'Review largest leases for renewal and IBR benchmarking.',
    cfo_summary: {
      total_annual_commitment: annual,
      total_liability: liability,
      monthly_outflow: annual / 12,
      biggest_risk: String(
        insightsRaw.find((i) => String(i.severity).toUpperCase() === 'HIGH')?.title ||
          first?.title ||
          'Concentration in top leases'
      ),
      most_urgent_decision: String(first?.recommendation || 'Review expiring leases'),
      potential_annual_saving: Math.round(annual * 0.03),
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
    cash_flow_forecast: {
      year_1: annual,
      year_2: annual,
      year_3: annual,
      year_4: annual,
      year_5: annual,
      total_5_year: annual * 5,
      note: 'Based on current annual lease payments from portfolio.',
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
