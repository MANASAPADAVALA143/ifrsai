/**
 * Client-side current / non-current split from an amortization schedule
 * (mirrors ifrs16_calculator.calculate_current_vs_noncurrent).
 */

export type LiabilitySplit = {
  current_portion: number;
  non_current_portion: number;
  total_liability: number;
  reporting_date: string;
  cutoff_date: string;
};

function parseScheduleDate(row: Record<string, unknown>): Date | null {
  const raw = row.Date ?? row.date ?? row.payment_date ?? row.Payment_Date ?? '';
  if (!raw) return null;
  const s = String(raw).slice(0, 10);
  const parts = s.split('-').map((x) => parseInt(x, 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const dt = new Date(parts[0], parts[1] - 1, parts[2]);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function rowNum(row: Record<string, unknown>, key: string): number {
  const v = row[key] ?? row[key.toLowerCase()];
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function rowPrincipal(row: Record<string, unknown>): number {
  const raw = row.Principal ?? row.principal;
  const n = Number(raw);
  if (Number.isFinite(n) && n !== 0) return n;
  const payment =
    rowNum(row, 'Payment') ||
    rowNum(row, 'payment') ||
    rowNum(row, 'Total_Payment') ||
    rowNum(row, 'total_payment');
  const interest = rowNum(row, 'Interest') + rowNum(row, 'interest');
  return Math.max(0, payment - interest);
}

function rowClosingBalance(row: Record<string, unknown>): number {
  return (
    rowNum(row, 'Closing_Balance') ||
    rowNum(row, 'closing_balance') ||
    rowNum(row, 'Closing') ||
    rowNum(row, 'closing')
  );
}

function rowOpeningBalance(row: Record<string, unknown>): number {
  return (
    rowNum(row, 'Opening_Balance') ||
    rowNum(row, 'opening_balance') ||
    rowNum(row, 'Opening') ||
    rowNum(row, 'opening')
  );
}

function addMonths(d: Date, months: number): Date {
  const r = new Date(d.getTime());
  r.setMonth(r.getMonth() + months);
  return r;
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export const MATURITY_BUCKET_LABELS = [
  'Less than 1 year',
  '1 to 2 years',
  '2 to 3 years',
  '3 to 4 years',
  '4 to 5 years',
  'More than 5 years',
] as const;

export type MaturityBucketRow = { undiscounted: number; pv: number };

/** IFRS 16 para 58(b) — undiscounted payments in maturity buckets from reporting date. */
export function buildMaturityBuckets(
  schedule: Array<Record<string, unknown>>,
  reportingDate: Date,
  currentLiability: number,
  nonCurrentLiability: number
): { buckets: MaturityBucketRow[]; totalUndiscounted: number; totalPV: number } {
  const buckets: MaturityBucketRow[] = MATURITY_BUCKET_LABELS.map(() => ({
    undiscounted: 0,
    pv: 0,
  }));
  const reportingDt = new Date(
    reportingDate.getFullYear(),
    reportingDate.getMonth(),
    reportingDate.getDate()
  );

  const rows = schedule
    .map((row) => ({ row, dt: parseScheduleDate(row) }))
    .filter((x): x is { row: Record<string, unknown>; dt: Date } => x.dt != null)
    .sort((a, b) => a.dt.getTime() - b.dt.getTime());

  const msPerYear = 365.25 * 24 * 60 * 60 * 1000;
  const future = rows.filter((r) => r.dt.getTime() > reportingDt.getTime());

  let totalUndiscounted = 0;

  const bucketIndex = (yearsFromReport: number): number => {
    if (yearsFromReport < 1) return 0;
    if (yearsFromReport < 2) return 1;
    if (yearsFromReport < 3) return 2;
    if (yearsFromReport < 4) return 3;
    if (yearsFromReport < 5) return 4;
    return 5;
  };

  for (const { row, dt } of future) {
    const payment =
      rowNum(row, 'Payment') ||
      rowNum(row, 'payment') ||
      rowNum(row, 'Total_Payment') ||
      rowNum(row, 'total_payment');
    if (payment <= 0) continue;
    const yearsFromReport = Math.max(0, (dt.getTime() - reportingDt.getTime()) / msPerYear);
    const idx = bucketIndex(yearsFromReport);
    buckets[idx].undiscounted += payment;
    totalUndiscounted += payment;
  }

  const totalPV = currentLiability + nonCurrentLiability;

  let allocatedPV = 0;
  buckets.forEach((bucket) => {
    if (totalUndiscounted > 0) {
      bucket.pv = Math.round((bucket.undiscounted / totalUndiscounted) * totalPV);
      allocatedPV += bucket.pv;
    } else {
      bucket.pv = 0;
    }
  });

  const pvRoundingDiff = Math.round(totalPV) - allocatedPV;
  if (pvRoundingDiff !== 0 && totalUndiscounted > 0) {
    const adjustIdx =
      buckets
        .map((b, i) => (b.undiscounted > 0 ? i : -1))
        .filter((i) => i >= 0)
        .pop() ?? 0;
    buckets[adjustIdx].pv += pvRoundingDiff;
  }

  return { buckets, totalUndiscounted, totalPV };
}

export function computeLiabilitySplitFromSchedule(
  schedule: Array<Record<string, unknown>>,
  reportingDate: Date
): LiabilitySplit {
  if (!schedule.length) {
    return {
      current_portion: 0,
      non_current_portion: 0,
      total_liability: 0,
      reporting_date: toDateStr(reportingDate),
      cutoff_date: toDateStr(addMonths(reportingDate, 12)),
    };
  }

  const reportingDt = new Date(reportingDate.getFullYear(), reportingDate.getMonth(), reportingDate.getDate());
  const cutoffDt = addMonths(reportingDt, 12);

  const rows = schedule
    .map((row) => ({
      row,
      dt: parseScheduleDate(row),
    }))
    .filter((x): x is { row: Record<string, unknown>; dt: Date } => x.dt != null)
    .sort((a, b) => a.dt.getTime() - b.dt.getTime());

  const firstDt = rows[0].dt;
  const onOrBefore = rows.filter((r) => r.dt.getTime() <= reportingDt.getTime());

  let totalLiability: number;
  if (onOrBefore.length === 0 || reportingDt.getTime() <= firstDt.getTime()) {
    totalLiability = rowOpeningBalance(rows[0].row);
  } else {
    const last = onOrBefore[onOrBefore.length - 1].row;
    totalLiability = rowClosingBalance(last);
    if (totalLiability === 0 && onOrBefore.length < rows.length) {
      const nextAfter = rows.find((r) => r.dt.getTime() > reportingDt.getTime());
      if (nextAfter && rowOpeningBalance(nextAfter.row) > 0) {
        totalLiability = rowOpeningBalance(nextAfter.row);
      }
    }
  }

  let current = 0;
  // IFRS 16 / IAS 1: current portion = principal repayments (not gross cash payments) within 12 months.
  const dueAfter = rows.filter(
    (r) => r.dt.getTime() > reportingDt.getTime() && r.dt.getTime() <= cutoffDt.getTime()
  );
  current = dueAfter.reduce((s, r) => s + rowPrincipal(r.row), 0);

  if (current === 0 && reportingDt.getTime() <= firstDt.getTime()) {
    const head = rows.slice(0, Math.min(12, rows.length));
    current = head.reduce((s, r) => s + rowPrincipal(r.row), 0);
    totalLiability = rowOpeningBalance(rows[0].row);
  }

  if (totalLiability === 0 && current > 0) {
    const remaining = rows
      .filter((r) => r.dt.getTime() > reportingDt.getTime())
      .reduce((s, r) => s + rowPrincipal(r.row), 0);
    totalLiability = current + remaining;
  }

  const nonCurrent = Math.max(0, totalLiability - current);

  return {
    current_portion: current,
    non_current_portion: nonCurrent,
    total_liability: totalLiability,
    reporting_date: toDateStr(reportingDt),
    cutoff_date: toDateStr(cutoffDt),
  };
}
