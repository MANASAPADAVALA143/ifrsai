/** Formatting helpers for UAE Real Estate IFRS 15 module */

export type DisplayCurrency = 'AED' | 'USD';

export const UAE_PEG = 3.6725;

export function formatRealEstateMoney(
  amount: number,
  currency: DisplayCurrency = 'AED'
): string {
  const sym = currency === 'USD' ? 'USD' : 'AED';
  const n = Number(amount);
  if (!Number.isFinite(n)) return `${sym} —`;
  return `${sym} ${n.toLocaleString('en-AE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function spaQuarterFloor(spaExecutionDate: string): { year: number; quarter: number } | null {
  const spa = spaExecutionDate.trim().slice(0, 10);
  if (!spa) return null;
  const d = new Date(`${spa}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return { year: d.getFullYear(), quarter: Math.floor(d.getMonth() / 3) + 1 };
}

function parseQuarterPeriod(period: string): { year: number; quarter: number } | null {
  const m = period.match(/Q(\d)\s+(\d{4})/i);
  if (!m) return null;
  return { quarter: parseInt(m[1], 10), year: parseInt(m[2], 10) };
}

function quarterOnOrAfterSpa(
  period: string,
  spaFloor: { year: number; quarter: number }
): boolean {
  const q = parseQuarterPeriod(period);
  if (!q) return true;
  if (q.year < spaFloor.year) return false;
  if (q.year === spaFloor.year && q.quarter < spaFloor.quarter) return false;
  return true;
}

/** Drop pre-SPA quarters — keep period labels/dates only (amounts applied separately). */
export function filterPeriodScheduleFromSpa(
  schedule: Record<string, unknown>[],
  spaExecutionDate?: string
): Record<string, unknown>[] {
  if (!schedule?.length) return [];

  const spaFloor = spaExecutionDate ? spaQuarterFloor(spaExecutionDate) : null;
  const spa = spaExecutionDate?.trim().slice(0, 10) || '';

  return schedule.filter((row) => {
    const period = String(row.period || row.quarter || '');
    if (spaFloor && period) {
      return quarterOnOrAfterSpa(period, spaFloor);
    }
    if (/2023/.test(period)) return false;
    const end = String(row.period_end || row.period_start || '').slice(0, 10);
    if (spa && end && end < spa) return false;
    return true;
  });
}

function spreadPeriodRevenues(
  n: number,
  revenueToDate: number,
  revenuePrior: number,
  revenueCurrent: number
): number[] {
  if (n <= 0) return [];
  if (n === 1) return [Math.round(revenueToDate * 100) / 100];
  if (revenuePrior > 0) {
    const priorQuarters = n - 1;
    const perPrior =
      priorQuarters > 0 ? Math.round((revenuePrior / priorQuarters) * 100) / 100 : 0;
    const revenues = Array(Math.max(0, priorQuarters - 1)).fill(perPrior);
    if (priorQuarters > 0) {
      revenues.push(
        Math.round((revenuePrior - perPrior * (priorQuarters - 1)) * 100) / 100
      );
    }
    revenues.push(Math.round(revenueCurrent * 100) / 100);
    return revenues;
  }
  const perPeriod = Math.round((revenueToDate / n) * 100) / 100;
  return [
    ...Array(n - 1).fill(perPeriod),
    Math.round((revenueToDate - perPeriod * (n - 1)) * 100) / 100,
  ];
}

/** Filter to SPA quarters and spread off-plan revenue totals (fixes stale 8-quarter amounts). */
export function applyQuarterlyScheduleTotals(
  schedule: Record<string, unknown>[],
  opts: {
    spaExecutionDate?: string;
    revenueToDate: number;
    revenuePrior: number;
    revenueCurrent: number;
  }
): {
  schedule: Record<string, unknown>[];
  valid: boolean;
  expectedTotal: number;
  actualTotal: number;
  error?: string;
} {
  const filtered = filterPeriodScheduleFromSpa(schedule, opts.spaExecutionDate);
  const n = filtered.length;
  const expectedTotal = Math.round(opts.revenueToDate * 100) / 100;
  if (n === 0) {
    return {
      schedule: [],
      valid: false,
      expectedTotal,
      actualTotal: 0,
      error: 'No quarterly periods from SPA execution date',
    };
  }

  const periodRevenues = spreadPeriodRevenues(
    n,
    opts.revenueToDate,
    opts.revenuePrior,
    opts.revenueCurrent
  );

  let cumulative = 0;
  const rebuilt = filtered.map((row, i) => {
    const rev = periodRevenues[i] ?? 0;
    cumulative = Math.round((cumulative + rev) * 100) / 100;
    return {
      ...row,
      revenue_recognised: rev,
      revenue: rev,
      cumulative_revenue: cumulative,
    };
  });

  const actualTotal = cumulative;
  const valid = Math.abs(actualTotal - expectedTotal) <= 0.02;
  return {
    schedule: rebuilt,
    valid,
    expectedTotal,
    actualTotal,
    error: valid
      ? undefined
      : `Quarterly schedule total AED ${actualTotal.toLocaleString('en-AE')} does not equal revenue to date AED ${expectedTotal.toLocaleString('en-AE')}`,
  };
}

export function vatAlignmentFromPeriodSchedule(
  schedule: Record<string, unknown>[],
  currency: DisplayCurrency = 'AED'
): Record<string, unknown>[] {
  return schedule.map((row) => {
    const rev = Number(row.revenue_recognised ?? row.revenue ?? 0);
    return {
      period: row.period || row.quarter,
      revenue_recognised: rev,
      vat_5pct: Math.round(rev * 0.05 * 100) / 100,
      fta_filing_period: row.fta_filing_period,
      currency,
    };
  });
}

export function disclosureScoreColor(score: number): string {
  if (score >= 80) return 'bg-green-100 text-green-800 border-green-300';
  if (score >= 60) return 'bg-amber-100 text-amber-800 border-amber-300';
  return 'bg-red-100 text-red-800 border-red-300';
}
