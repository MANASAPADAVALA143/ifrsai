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

/** Drop pre-SPA quarters (e.g. 2023) — schedule must start from SPA execution (IFRS 15.9). */
export function filterPeriodScheduleFromSpa(
  schedule: Record<string, unknown>[],
  spaExecutionDate?: string
): Record<string, unknown>[] {
  if (!schedule?.length) return [];
  const spa = spaExecutionDate?.trim().slice(0, 10) || '';
  return schedule.filter((row) => {
    const period = String(row.period || row.quarter || '');
    if (/2023/.test(period)) return false;
    const start = String(row.period_start || '').slice(0, 10);
    if (spa && start && start < spa) return false;
    return true;
  });
}

export function disclosureScoreColor(score: number): string {
  if (score >= 80) return 'bg-green-100 text-green-800 border-green-300';
  if (score >= 60) return 'bg-amber-100 text-amber-800 border-amber-300';
  return 'bg-red-100 text-red-800 border-red-300';
}
