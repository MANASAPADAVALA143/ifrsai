/** Normalize UI / spreadsheet percent (8.5) or decimal (0.085) to annual decimal for API. */
export function normalizeAnnualRate(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return NaN;
  if (n > 1) return n / 100;
  return n;
}

/** Display annual decimal as percent string for form fields. */
export function annualDecimalToPercentDisplay(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return '';
  const pct = rate <= 1 ? rate * 100 : rate;
  const rounded = Math.round(pct * 100) / 100;
  return String(rounded);
}

export function getIbrTypicalRangeHint(currency?: string | null): string {
  const ccy = String(currency ?? '')
    .trim()
    .toUpperCase();
  if (ccy === 'AED') {
    return 'Typical range: 4.5%–7% (UAE AED, 2021–2024)';
  }
  return 'Typical range: 6%–12%';
}

export function getIbrRequiredMessage(currency?: string | null): string {
  return `IBR rate is required. ${getIbrTypicalRangeHint(currency)}`;
}
