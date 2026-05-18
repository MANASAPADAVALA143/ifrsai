import { NextResponse } from 'next/server';

/**
 * Proxies Claude requests server-side (browser cannot call api.anthropic.com with API key due to CORS).
 * Set ANTHROPIC_API_KEY in frontend/.env.local (local) or Vercel → Settings → Environment Variables (production).
 * Root IFRSAI/.env is for the Python backend only.
 *
 * Body options:
 * - { prompt: string } — free-form (e.g. Explain portfolio)
 * - { leases: unknown[], today?: string } — portfolio analysis with CFO-decision-grade prompt
 */
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

function mapLeaseForPrompt(l: Record<string, unknown>) {
  const res = l.results as Record<string, unknown> | undefined;
  const monthly = monthlyPaymentFromRow(l);
  const ll = leaseLiabilityFromRow(l);
  return {
    id: l.lease_id ?? l.id,
    asset: l.asset_description ?? l.asset,
    city: l.city,
    monthly_payment: monthly,
    annual_payment: monthly * 12,
    lease_liability: ll,
    rou_asset: num(l.rou_asset ?? res?.rou_asset),
    ibr: num(l.annual_discount_rate ?? l.ibr ?? l.discount_rate),
    term_months: num(l.lease_term_months ?? l.term_months),
    end_date: l.end_date ?? l.endDate,
    cpi_index_base: num(l.cpi_index_base),
    cpi_index_current: num(l.cpi_index_current),
    rvg_amount: num(l.rvg_amount),
    non_lease_component: num(l.non_lease_component),
    escalation_rate: num(l.escalation_rate),
    currency: typeof l.currency === 'string' ? l.currency : '',
  };
}

function buildCfoAdvisorPrompt(rows: Record<string, unknown>[], today: string): string {
  const totalLiability = rows.reduce((sum, l) => sum + leaseLiabilityFromRow(l), 0);
  const totalMonthly = rows.reduce((sum, l) => sum + monthlyPaymentFromRow(l), 0);
  const totalAnnual = totalMonthly * 12;
  const in12mo = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const in18mo = new Date(Date.now() + 548 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const leaseJson = JSON.stringify(rows.map((l) => mapLeaseForPrompt(l)), null, 2);

  return `You are a CFO advisor with 
20 years of experience in lease portfolio 
management. You think like a CFO — not an 
accountant.

A CFO cares about FOUR things only:
1. How much cash is going out?
2. What is on the balance sheet?
3. What decisions need to be made?
4. What is the risk of doing nothing?

TODAY: ${today}
ALERT WINDOW: 12-month planning horizon through ${in12mo}; renewals within 18 months 
= urgent (before ${in18mo})

PORTFOLIO DATA:
${leaseJson}

PORTFOLIO SUMMARY:
Total Lease Liability: ${totalLiability}
Total Monthly Outflow: ${totalMonthly}
Total Annual Commitment: ${totalAnnual}
Number of Leases: ${rows.length}
Report Date: ${today}

CRITICAL RULES:
1. Every number MUST show its formula
   WRONG: "Save £180K" 
   RIGHT: "Save £180K (0.7% x £25.76M)"
   
2. Every insight MUST answer a CFO question
   Not: "Concentration risk exists"
   Yes: "If Canary Wharf landlord 
         terminates — you lose 36.3% of 
         all space with no backup. Cost 
         to replace: £850K/mo market rate"

3. Every action MUST have a financial 
   consequence of NOT acting
   "If you do nothing by Apr 2026 — 
    Liverpool auto-renews at current terms. 
    You lose negotiating leverage worth 
    est. £200K over next term."

4. Always use portfolio currency 
   (detect from data)

5. As of ${today} — always reference date

Analyse this portfolio and return ONLY 
this exact JSON — no preamble, no markdown:

{
  "health_score": <0-100>,
  "health_label": "<Excellent|Good|Fair|At Risk>",
  
  "cfo_summary": {
    "total_annual_commitment": <number>,
    "total_liability": <number>,
    "monthly_outflow": <number>,
    "biggest_risk": "<lease name + £ amount>",
    "most_urgent_decision": "<what + deadline>",
    "potential_annual_saving": <number>
  },
  
  "summary": "<3 sentences. Must include: 
    (1) total liability + date,
    (2) biggest single risk with £ and %,
    (3) most urgent action with deadline>",
  
  "top_recommendation": "<Format exactly: 
    [Action] — [£ amount at stake] — 
    deadline [specific date]. 
    If ignored: [specific consequence]>",

  "insights": [
    {
      "type": "<Risk|Opportunity|Renewal|
               Efficiency|Decision>",
      "severity": "<High|Medium|Low>",
      "title": "<title with £ amount>",
      "description": "<CFO language. Include:
        - Current situation with £ and %
        - What this means financially
        - Formula showing how number derived>",
      "cfo_question": "<The CFO question 
        this answers e.g. 'Am I overexposed 
        to one asset?'>",
      "financial_impact": "<£ amount at risk 
        or saveable — with formula>",
      "action": "<specific action + deadline>",
      "if_ignored": "<what happens financially 
        if CFO does nothing>",
      "calculation": "<formula e.g. 
        '£145K x 12 = £1.74M annual' or
        '£9.35M / £25.76M = 36.3%'>",
      "lease_id": "<id or null>"
    }
  ],

  "actions": [
    {
      "id": "<ACT-001, ACT-002 etc>",
      "category": "<one of: RENEWAL_DECISION | 
        RENEGOTIATION | CONCENTRATION_RISK | 
        CPI_EXPOSURE | BUY_VS_LEASE | 
        SUBLET_OPPORTUNITY | BREAK_CLAUSE | 
        RVG_EXPOSURE | CASH_FLOW>",
      "title": "<specific action title>",
      "description": "<what to do and why 
        — with £ amounts>",
      "cfo_decision": "<the decision the CFO 
        needs to make — one sentence>",
      "options": [
        {
          "option": "<Option A name>",
          "financial_impact": "<£ amount>",
          "pros": "<key benefit>",
          "cons": "<key risk>"
        },
        {
          "option": "<Option B name>",
          "financial_impact": "<£ amount>",
          "pros": "<key benefit>",
          "cons": "<key risk>"
        }
      ],
      "recommended_option": "<A or B and why>",
      "priority": "<High|Medium|Low>",
      "owner": "<CFO|Finance Team|Treasury|
                 Legal|Property Manager>",
      "deadline": "<YYYY-MM-DD>",
      "financial_consequence_if_ignored": 
        "<£ amount + what happens>",
      "potential_saving_or_cost": 
        "<£ amount with formula>",
      "lease_id": "<id or null>",
      "is_ai_generated": true
    }
  ],

  "cash_flow_forecast": {
    "year_1": <total payments year 1>,
    "year_2": <year 2>,
    "year_3": <year 3>,
    "year_4": <year 4>,
    "year_5": <year 5>,
    "total_5_year": <sum>,
    "note": "<key observation about 
              cash flow trend>"
  }
}

Generate insights covering ALL applicable 
categories from this list — only if 
relevant to the data:

RENEWAL_DECISION: Any lease expiring 
within 18 months.
Formula: months_to_expiry = 
(end_date - today) / 30
Include: Renew vs relocate cost comparison

RENEGOTIATION: Any lease where IBR > 
estimated current market rate.
Market rate estimate: use portfolio 
average IBR as baseline — leases 
significantly above average are candidates.
Formula: annual_saving = 
(current_ibr - market_ibr) x liability

CONCENTRATION_RISK: Any lease > 25% 
of total liability.
Formula: lease_liability / total_liability
Include: What backup plan exists?

CPI_EXPOSURE: Any lease with 
cpi_index_base > 0.
Formula: potential_increase = 
liability x (cpi_index_current/
cpi_index_base - 1)
Include: Inflation scenario analysis

BUY_VS_LEASE: Equipment/tech leases 
where total_cost > 60% of typical 
asset purchase price.
Estimate purchase price = 
monthly_payment x 24 (rough proxy)
Include: NPV of buy vs lease

SUBLET_OPPORTUNITY: Large office leases 
where square footage might be sublettable.
Include: Revenue potential if 20-30% sublet

BREAK_CLAUSE: Long-term leases (>60mo) 
where market conditions may have changed.
Include: Value of flexibility

RVG_EXPOSURE: Any lease with rvg_amount > 0.
Formula: rvg_exposure as % of liability
Include: Probability assessment

CASH_FLOW: Overall portfolio cash commitment 
vs typical revenue assumptions.
Include: Year-by-year outflow forecast

Generate 5-7 insights and 4-6 actions.
Every single number must have its formula.
CFO language only — no accounting jargon.`;
}

export async function POST(req: Request) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return NextResponse.json(
      {
        error:
          'ANTHROPIC_API_KEY is not configured. Local dev: add it to frontend/.env.local and restart npm run dev. Vercel: Project → Settings → Environment Variables → ANTHROPIC_API_KEY, then redeploy.',
      },
      { status: 503 }
    );
  }

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

  let prompt = '';

  if (Array.isArray(leasesRaw) && leasesRaw.length > 0) {
    const rows = leasesRaw.filter((x) => x != null && typeof x === 'object') as Record<string, unknown>[];
    prompt = buildCfoAdvisorPrompt(rows, today);
  } else {
    prompt = typeof body.prompt === 'string' ? body.prompt : '';
  }

  if (!prompt.trim()) {
    return NextResponse.json({ error: 'Missing prompt or leases' }, { status: 400 });
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const msg =
      (data as { error?: { message?: string } })?.error?.message ||
      `Anthropic API error: ${response.status}`;
    return NextResponse.json({ error: msg }, { status: response.status >= 400 ? response.status : 502 });
  }

  const text = (data as { content?: Array<{ type?: string; text?: string }> })?.content?.[0]?.text;
  if (typeof text !== 'string') {
    return NextResponse.json({ error: 'Unexpected response shape from Claude' }, { status: 502 });
  }

  return NextResponse.json({ text });
}
