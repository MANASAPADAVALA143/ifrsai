/**
 * Pure, side-effect-free calculation helpers for the CFO Strategic Insights /
 * Quick Analysis feature. Extracted from app/api/cfo-strategic-insights/route.ts
 * so they can be unit-tested independently of the Next.js route handler and the
 * Claude/Python backend calls.
 *
 * These functions do NOT touch the per-lease IFRS 16 calculation engine
 * (ROU/liability/amortization) — they only read numbers the engine already
 * produced (lease_liability, rou_asset, current_lease_liability,
 * current_rou_asset, amortization schedule rows) and aggregate/interpret them
 * for portfolio-level reporting.
 */

export type LeaseRow = Record<string, unknown>;

export function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Initial-measurement lease liability (at commencement), reading top-level or nested `results`. */
export function leaseLiabilityFromRow(l: LeaseRow): number {
  const top = num(l.lease_liability);
  if (top > 0) return top;
  const res = l.results as LeaseRow | undefined;
  return num(res?.lease_liability);
}

/** Initial-measurement ROU asset (at commencement), reading top-level or nested `results`. */
export function rouAssetFromRow(l: LeaseRow): number {
  const top = num(l.rou_asset);
  if (top > 0) return top;
  const res = l.results as LeaseRow | undefined;
  return num(res?.rou_asset);
}

/**
 * CURRENT carrying value of the lease liability as of the analysis date.
 * Lookup: explicit current_lease_liability → amortization schedule Closing_Balance
 * → fallback to initial measurement (flagged).
 */
export function currentLiabilityFromRow(l: LeaseRow): { value: number; isFallback: boolean } {
  const current = num(l.current_lease_liability);
  if (current > 0) return { value: current, isFallback: false };
  const res = l.results as LeaseRow | undefined;
  const nested = num(res?.current_lease_liability);
  if (nested > 0) return { value: nested, isFallback: false };
  const fromSched = liabilityFromSchedule(l);
  if (fromSched != null && fromSched >= 0) return { value: fromSched, isFallback: false };
  return { value: leaseLiabilityFromRow(l), isFallback: true };
}

/** CURRENT carrying value of the ROU asset as of the analysis date. See currentLiabilityFromRow. */
export function currentRouFromRow(l: LeaseRow): { value: number; isFallback: boolean } {
  const current = num(l.current_rou_asset);
  if (current > 0) return { value: current, isFallback: false };
  const res = l.results as LeaseRow | undefined;
  const nested = num(res?.current_rou_asset);
  if (nested > 0) return { value: nested, isFallback: false };
  const fromSched = rouFromSchedule(l);
  if (fromSched != null && fromSched >= 0) return { value: fromSched, isFallback: false };
  return { value: rouAssetFromRow(l), isFallback: true };
}

function scheduleRows(l: LeaseRow): LeaseRow[] {
  const top = l.amortization_schedule;
  if (Array.isArray(top)) return top as LeaseRow[];
  const res = l.results as LeaseRow | undefined;
  const nested = res?.amortization_schedule;
  if (Array.isArray(nested)) return nested as LeaseRow[];
  return [];
}

function latestScheduleRowOnOrBeforeToday(l: LeaseRow): LeaseRow | null {
  const todayMs = Date.now();
  let best: LeaseRow | null = null;
  let bestMs = -Infinity;
  for (const row of scheduleRows(l)) {
    const rowMs = new Date(String(row.Date ?? row.date ?? '')).getTime();
    if (Number.isNaN(rowMs) || rowMs > todayMs || rowMs <= bestMs) continue;
    best = row;
    bestMs = rowMs;
  }
  return best;
}

function liabilityFromSchedule(l: LeaseRow): number | null {
  const row = latestScheduleRowOnOrBeforeToday(l);
  if (!row) return null;
  const v = num(
    row['Lease Liability'] ?? row.lease_liability_balance ?? row.Closing_Balance ?? row.closing_balance
  );
  return v > 0 || row.Closing_Balance === 0 || row.closing_balance === 0 ? v : null;
}

function rouFromSchedule(l: LeaseRow): number | null {
  const row = latestScheduleRowOnOrBeforeToday(l);
  if (!row) return null;
  const v = num(row['ROU Asset'] ?? row.rou_asset_balance ?? row.rou_nbv ?? row.rou_asset);
  return v > 0 || row['ROU Asset'] === 0 ? v : null;
}

export function monthlyPaymentFromRow(l: LeaseRow): number {
  return num(l.monthly_payment);
}

/**
 * Days from `todayStr` to the lease's end_date. Negative means already expired.
 * Returns null when end_date is missing or unparseable (never silently 0).
 */
export function daysToExpiry(endDateStr: unknown, todayStr: string): number | null {
  if (!endDateStr || typeof endDateStr !== 'string') return null;
  const end = new Date(endDateStr);
  const today = new Date(todayStr);
  if (Number.isNaN(end.getTime()) || Number.isNaN(today.getTime())) return null;
  return Math.round((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export type CashFlowForecast = {
  year_1: number;
  year_2: number;
  year_3: number;
  year_4: number;
  year_5: number;
  total_5_year: number;
  note: string;
};

/**
 * Year-by-year cash flow forecast built from each lease's actual payment schedule.
 * For each 12-month window starting from `today`, sums only the months where each
 * lease is contractually active (i.e. not yet expired) and applies `escalation_rate`
 * (annual, percent) if present on the row.
 */
export function buildCashFlowForecast(rows: LeaseRow[], today: string): CashFlowForecast {
  const todayMs = new Date(today).getTime();
  const MS_PER_DAY = 86_400_000;
  const MS_PER_YEAR = 365 * MS_PER_DAY;

  const yearTotals = [0, 0, 0, 0, 0];

  for (const lease of rows) {
    const endDateStr = (lease.end_date ?? lease.endDate) as string | undefined;
    if (!endDateStr) continue;
    const endMs = new Date(endDateStr).getTime();
    if (Number.isNaN(endMs) || endMs < todayMs) continue; // already expired

    const baseMonthly = monthlyPaymentFromRow(lease);
    if (baseMonthly <= 0) continue;

    const escalationRate = num(lease.escalation_rate ?? lease.escalation ?? 0);

    for (let yr = 0; yr < 5; yr++) {
      const yearStartMs = todayMs + yr * MS_PER_YEAR;
      const yearEndMs = todayMs + (yr + 1) * MS_PER_YEAR;

      const activeStartMs = Math.max(yearStartMs, todayMs);
      const activeEndMs = Math.min(yearEndMs, endMs);
      if (activeEndMs <= activeStartMs) continue;

      const activeDays = (activeEndMs - activeStartMs) / MS_PER_DAY;
      const activeMonths = activeDays / 30.44;

      const escalated = baseMonthly * Math.pow(1 + escalationRate / 100, yr);
      yearTotals[yr] += escalated * activeMonths;
    }
  }

  const rounded = yearTotals.map((v) => Math.round(v));
  const total = rounded.reduce((s, v) => s + v, 0);

  return {
    year_1: rounded[0],
    year_2: rounded[1],
    year_3: rounded[2],
    year_4: rounded[3],
    year_5: rounded[4],
    total_5_year: total,
    note:
      "Year-by-year forecast built from each lease's actual contractual term, monthly payment, and escalation rate. Excludes months where the lease has expired. Includes contractual escalation where provided.",
  };
}

export type ExpiryClassification<T> = {
  active: T[];
  expired: T[];
  expiring90: T[];
  expiring12mo: T[];
  expiringTotal12mo: number;
};

/**
 * Classifies leases into active/expired and expiry buckets from a single pass,
 * using ONLY days_to_expiry (computed once) — never a re-derived boolean flag.
 * `rows` must already carry a `days_to_expiry` field (see mapLeaseForPrompt equivalents).
 */
export function classifyExpiry<T extends { days_to_expiry: number | null }>(
  mappedLeases: T[]
): ExpiryClassification<T> {
  const active = mappedLeases.filter((l) => l.days_to_expiry !== null && (l.days_to_expiry as number) >= 0);
  const expired = mappedLeases.filter((l) => l.days_to_expiry !== null && (l.days_to_expiry as number) < 0);
  const expiring90 = active.filter((l) => (l.days_to_expiry as number) <= 90);
  const expiring12mo = active.filter(
    (l) => (l.days_to_expiry as number) > 90 && (l.days_to_expiry as number) <= 365
  );
  return {
    active,
    expired,
    expiring90,
    expiring12mo,
    expiringTotal12mo: expiring90.length + expiring12mo.length,
  };
}

export type HealthScoreFactor = {
  name: string;
  deduction: number;
  detail: string;
};

export type HealthScoreResult = {
  score: number;
  label: 'Excellent' | 'Good' | 'Fair' | 'At Risk';
  factors: HealthScoreFactor[];
};

/**
 * Deterministic, documented portfolio health score — computed in code, NOT by the
 * AI model. Claude only narrates around this number; it never sets it. This makes
 * the score auditable and reproducible for the same input data.
 *
 * METHODOLOGY (starts at 100, deducts per factor, floors at 0):
 *
 * 1. Concentration risk — top-5 leases' share of total ACTIVE liability.
 *      >50%: -20   >35%: -10   >25%: -5   else: 0
 * 2. Near-term expiry risk — leases expiring within 90 days as % of active leases.
 *      >20%: -15   >10%: -8    >0%:  -4   else: 0
 * 3. 12-month expiry risk — leases expiring within 12 months as % of active leases.
 *      >40%: -15   >25%: -8    >10%: -4   else: 0
 * 4. Leverage — total liability / total assets (only if total_assets provided > 0).
 *      >60%: -15   >40%: -8    >25%: -3   else: 0
 * 5. Data quality — leases missing end_date or with liability but no ROU, as % of total.
 *      >10%: -10   >0%:  -5    else: 0
 *
 * Label thresholds: >=80 Excellent, >=65 Good, >=45 Fair, else At Risk.
 */
export function computeHealthScore(params: {
  activeLeases: LeaseRow[];
  totalLeases: number;
  totalActiveLiability: number;
  top5Liability: number;
  expiring90Count: number;
  expiring12moCount: number;
  totalAssets?: number;
  dataQualityIssueCount: number;
}): HealthScoreResult {
  const {
    activeLeases,
    totalLeases,
    totalActiveLiability,
    top5Liability,
    expiring90Count,
    expiring12moCount,
    totalAssets,
    dataQualityIssueCount,
  } = params;

  const factors: HealthScoreFactor[] = [];
  let score = 100;

  // 1. Concentration risk
  const concentrationPct = totalActiveLiability > 0 ? (top5Liability / totalActiveLiability) * 100 : 0;
  let concDeduction = 0;
  if (concentrationPct > 50) concDeduction = 20;
  else if (concentrationPct > 35) concDeduction = 10;
  else if (concentrationPct > 25) concDeduction = 5;
  if (concDeduction > 0) {
    factors.push({
      name: 'Concentration risk',
      deduction: concDeduction,
      detail: `Top-5 leases = ${concentrationPct.toFixed(1)}% of active liability`,
    });
    score -= concDeduction;
  }

  // 2. Near-term (90-day) expiry risk
  const activeCount = activeLeases.length || 1;
  const expiring90Pct = (expiring90Count / activeCount) * 100;
  let exp90Deduction = 0;
  if (expiring90Pct > 20) exp90Deduction = 15;
  else if (expiring90Pct > 10) exp90Deduction = 8;
  else if (expiring90Pct > 0) exp90Deduction = 4;
  if (exp90Deduction > 0) {
    factors.push({
      name: 'Near-term expiry risk (≤90 days)',
      deduction: exp90Deduction,
      detail: `${expiring90Count} of ${activeLeases.length} active leases (${expiring90Pct.toFixed(1)}%) expire within 90 days`,
    });
    score -= exp90Deduction;
  }

  // 3. 12-month expiry risk
  const expiring12moPct = (expiring12moCount / activeCount) * 100;
  let exp12Deduction = 0;
  if (expiring12moPct > 40) exp12Deduction = 15;
  else if (expiring12moPct > 25) exp12Deduction = 8;
  else if (expiring12moPct > 10) exp12Deduction = 4;
  if (exp12Deduction > 0) {
    factors.push({
      name: '12-month expiry risk',
      deduction: exp12Deduction,
      detail: `${expiring12moCount} of ${activeLeases.length} active leases (${expiring12moPct.toFixed(1)}%) expire within 12 months`,
    });
    score -= exp12Deduction;
  }

  // 4. Leverage
  if (totalAssets != null && totalAssets > 0) {
    const leveragePct = (totalActiveLiability / totalAssets) * 100;
    let levDeduction = 0;
    if (leveragePct > 60) levDeduction = 15;
    else if (leveragePct > 40) levDeduction = 8;
    else if (leveragePct > 25) levDeduction = 3;
    if (levDeduction > 0) {
      factors.push({
        name: 'Leverage (liability/assets)',
        deduction: levDeduction,
        detail: `Liability is ${leveragePct.toFixed(1)}% of total assets`,
      });
      score -= levDeduction;
    }
  }

  // 5. Data quality
  const dqPct = totalLeases > 0 ? (dataQualityIssueCount / totalLeases) * 100 : 0;
  let dqDeduction = 0;
  if (dqPct > 10) dqDeduction = 10;
  else if (dqPct > 0) dqDeduction = 5;
  if (dqDeduction > 0) {
    factors.push({
      name: 'Data quality',
      deduction: dqDeduction,
      detail: `${dataQualityIssueCount} of ${totalLeases} leases have missing end_date or ROU/liability data`,
    });
    score -= dqDeduction;
  }

  score = Math.max(0, Math.min(100, score));

  let label: HealthScoreResult['label'];
  if (score >= 80) label = 'Excellent';
  else if (score >= 65) label = 'Good';
  else if (score >= 45) label = 'Fair';
  else label = 'At Risk';

  return { score, label, factors };
}
