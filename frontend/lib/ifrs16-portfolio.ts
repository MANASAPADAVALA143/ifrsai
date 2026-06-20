import { formatCurrency, sanitizeCurrencyCode } from './utils';
import { formatLeaseMoney, getDefaultIfrs16Currency, resolveLeaseCurrency } from './ifrs16-currency';
import type { LeaseRepositoryEntry } from './lease-repository';

/** Approximate units of currency per 1 USD (for portfolio totals only). */
const UNITS_PER_USD: Record<string, number> = {
  USD: 1,
  AED: 3.6725,
  SAR: 3.75,
  GBP: 0.79,
  EUR: 0.92,
  INR: 83.5,
};

export function getCalculatedIbrPct(entry: Partial<LeaseRepositoryEntry>): number {
  const res = (entry.results || {}) as { disclosure_data?: { discount_rate_pct?: number } };
  const fromCalc = res.disclosure_data?.discount_rate_pct;
  if (fromCalc != null && Number.isFinite(Number(fromCalc))) {
    return Number(fromCalc);
  }
  const raw = Number(entry.discount_rate ?? 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return raw <= 1 ? raw * 100 : raw;
}

export function getFormIbrPct(entry: Partial<LeaseRepositoryEntry>): number {
  const raw = Number(entry.discount_rate ?? 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return raw <= 1 ? raw * 100 : raw;
}

export function ibrRateMismatch(entry: Partial<LeaseRepositoryEntry>): boolean {
  const calc = getCalculatedIbrPct(entry);
  const form = getFormIbrPct(entry);
  if (calc <= 0 || form <= 0) return false;
  return Math.abs(calc - form) > 0.05;
}

function liabilityAmount(entry: Partial<LeaseRepositoryEntry>): number {
  const res = (entry.results || {}) as { lease_liability?: number };
  return Number(entry.liability ?? res.lease_liability ?? 0);
}

function toAed(amount: number, currency: string): number {
  const ccy = sanitizeCurrencyCode(currency, getDefaultIfrs16Currency());
  const perUsd = UNITS_PER_USD[ccy];
  if (!perUsd) return amount;
  const usd = amount / perUsd;
  return usd * (UNITS_PER_USD.AED ?? 3.6725);
}

/** Legacy merged bulk-import / portfolio summary rows — exclude from CFO analytics. */
export function isPortfolioAggregateLease(entry: Partial<LeaseRepositoryEntry>): boolean {
  if (entry.is_portfolio_aggregate === true) return true;

  const asset = String(entry.title || entry.asset || entry.asset_description || '').toLowerCase();
  if (asset.includes('portfolio')) return true;

  const ccy = resolveLeaseCurrency(entry);
  const ll = liabilityAmount(entry);
  if (ccy === 'AED' && ll > 200_000_000) return true;
  if (toAed(ll, ccy) > 200_000_000) return true;

  return false;
}

export type PortfolioMoneyDisplay = {
  dominantCurrency: string;
  isMultiCurrency: boolean;
  subtitle?: string;
  formatTotal: (amount: number) => string;
  sumLiabilities: (items: { currency: string; lease_liability: number }[]) => number;
};

export function getPortfolioMoneyDisplay(
  items: { currency: string; lease_liability: number }[]
): PortfolioMoneyDisplay {
  const byCcy = new Map<string, number>();
  for (const item of items) {
    const ccy = sanitizeCurrencyCode(item.currency, getDefaultIfrs16Currency());
    byCcy.set(ccy, (byCcy.get(ccy) ?? 0) + (item.lease_liability || 0));
  }

  const currencies = [...byCcy.keys()];

  if (currencies.length === 1) {
    const c = currencies[0];
    return {
      dominantCurrency: c,
      isMultiCurrency: false,
      formatTotal: (n) => formatLeaseMoney(n, c),
      sumLiabilities: (rows) => rows.reduce((s, r) => s + (r.lease_liability || 0), 0),
    };
  }

  if (currencies.length === 0) {
    const fallback = getDefaultIfrs16Currency();
    return {
      dominantCurrency: fallback,
      isMultiCurrency: false,
      formatTotal: (n) => formatLeaseMoney(n, fallback),
      sumLiabilities: (rows) => rows.reduce((s, r) => s + (r.lease_liability || 0), 0),
    };
  }

  let dominant = currencies[0];
  let max = 0;
  for (const [c, v] of byCcy) {
    if (v > max) {
      max = v;
      dominant = c;
    }
  }

  return {
    dominantCurrency: dominant,
    isMultiCurrency: true,
    subtitle: `Multi-currency portfolio (totals in USD equivalent; largest book: ${dominant})`,
    formatTotal: (n) => formatCurrency(n, 'USD', 0),
    sumLiabilities: (rows) =>
      rows.reduce((s, r) => {
        const ccy = sanitizeCurrencyCode(r.currency, getDefaultIfrs16Currency());
        const perUsd = UNITS_PER_USD[ccy] ?? 1;
        return s + (r.lease_liability || 0) / perUsd;
      }, 0),
  };
}

export function repositoryDuplicateKey(entry: Partial<LeaseRepositoryEntry>): string {
  const asset = String(entry.title || entry.asset || '').trim().toLowerCase();
  const start = String(entry.start_date || entry.dates?.commencement || '').slice(0, 10);
  const lessee = String(entry.lessee || entry.lessee_name || '').trim().toLowerCase();
  return `${asset}|${start}|${lessee}`;
}

export function findDuplicateLeaseGroups(
  entries: Partial<LeaseRepositoryEntry>[]
): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const e of entries) {
    const asset = String(e.title || e.asset || '').trim();
    const start = String(e.start_date || e.dates?.commencement || '').slice(0, 10);
    const lessee = String(e.lessee || e.lessee_name || '').trim();
    if (!asset || !start || !lessee) continue;
    const key = repositoryDuplicateKey(e);
    const id = String(e.id || e.lease_id || '');
    if (!id) continue;
    const list = groups.get(key) ?? [];
    list.push(id);
    groups.set(key, list);
  }
  const dupes = new Map<string, string[]>();
  for (const [key, ids] of groups) {
    if (ids.length >= 2) dupes.set(key, ids);
  }
  return dupes;
}
