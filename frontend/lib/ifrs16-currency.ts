/**
 * IFRS 16 currency helpers — AE mode defaults to AED (Western grouping), IN mode to INR (lakh grouping).
 */

import { formatCurrency, sanitizeCurrencyCode } from './utils';
import type { LeaseRepositoryEntry } from './lease-repository';

export type Ifrs16MarketMode = 'AE' | 'IN';

export const IFRS16_MARKET_MODE_KEY = 'ifrs16_market_mode';

export function getIfrs16MarketMode(): Ifrs16MarketMode {
  if (typeof window === 'undefined') return 'AE';
  const raw = localStorage.getItem(IFRS16_MARKET_MODE_KEY);
  return raw === 'IN' ? 'IN' : 'AE';
}

export function setIfrs16MarketMode(mode: Ifrs16MarketMode): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(IFRS16_MARKET_MODE_KEY, mode);
  window.dispatchEvent(new Event('ifrs16-market-mode-changed'));
}

export function getDefaultIfrs16Currency(): string {
  return getIfrs16MarketMode() === 'IN' ? 'INR' : 'AED';
}

export function getDefaultIfrs16Country(): string {
  return getIfrs16MarketMode() === 'IN' ? 'India' : 'UAE';
}

export function resolveLeaseCurrency(
  lease?: Partial<LeaseRepositoryEntry> | null,
  fallback?: string
): string {
  const base = fallback ?? getDefaultIfrs16Currency();
  const raw =
    lease?.currency ??
    lease?.payments?.currency ??
    (lease?.results as { disclosure_data?: { currency?: string } } | undefined)?.disclosure_data?.currency;
  return sanitizeCurrencyCode(String(raw ?? ''), base);
}

/** Format lease amounts: INR → ₹ + lakh grouping; AED/others → ISO code + comma thousands. */
export function formatLeaseMoney(
  amount: number,
  currency?: string | null,
  decimals: number = 0
): string {
  const ccy = sanitizeCurrencyCode(currency ?? undefined, getDefaultIfrs16Currency());
  return formatCurrency(Number(amount) || 0, ccy, decimals);
}

const UK_DEMO_PATTERN =
  /canary wharf|manchester retail|head office canary|multiple commercial properties including head office|london,|,\s*london|united kingdom|uk retail centre/i;

export function isUkDemoLease(entry: Partial<LeaseRepositoryEntry>): boolean {
  const text = [entry.title, entry.asset, entry.location, entry.city, entry.country]
    .filter(Boolean)
    .join(' ');
  const country = String(entry.country ?? '').toLowerCase();
  return UK_DEMO_PATTERN.test(text) || country === 'uk' || country === 'united kingdom';
}

/** Rewrite legacy UK demo leases to UAE DIFC demo data and AED. */
export function migrateLeaseEntry(entry: LeaseRepositoryEntry): LeaseRepositoryEntry {
  let next: LeaseRepositoryEntry = { ...entry };

  if (isUkDemoLease(entry)) {
    const monthly = Number(entry.monthly_payment ?? entry.payments?.monthly ?? 85000) || 85000;
    const asset = 'Level 15, Gate Building, DIFC, Dubai';
    const currentId = String(entry.lease_id || entry.id || '');
    const normalizedId = currentId.startsWith('RE-UK-')
      ? `RE-UAE-${currentId.slice('RE-UK-'.length)}`
      : currentId;
    next = {
      ...next,
      id: normalizedId || next.id,
      lease_id: normalizedId || next.lease_id,
      title: asset,
      asset,
      lessor: entry.lessor || entry.lessor_name || 'DIFC Investments LLC',
      lessor_name: entry.lessor_name || entry.lessor || 'DIFC Investments LLC',
      lessee: entry.lessee || entry.lessee_name || 'Al Futtaim Digital Services LLC',
      lessee_name: entry.lessee_name || entry.lessee || 'Al Futtaim Digital Services LLC',
      country: 'UAE',
      city: 'Dubai',
      location: 'DIFC',
      currency: 'AED',
      monthly_payment: monthly,
      payments: { monthly, currency: 'AED' },
    };
  }

  const country = String(next.country ?? '').toLowerCase();
  const mode = getIfrs16MarketMode();
  const shouldBeAed =
    country === 'uae' ||
    country === 'ae' ||
    country === 'dubai' ||
    (mode === 'AE' && !next.currency && !next.payments?.currency);

  const currentCcy = sanitizeCurrencyCode(
    next.currency ?? next.payments?.currency ?? '',
    getDefaultIfrs16Currency()
  );

  if (shouldBeAed && currentCcy === 'INR') {
    next = {
      ...next,
      currency: 'AED',
      payments: {
        monthly: Number(next.monthly_payment ?? next.payments?.monthly ?? 0),
        currency: 'AED',
      },
    };
  } else if (!next.currency && next.payments?.currency) {
    next = { ...next, currency: next.payments.currency };
  } else if (!next.payments?.currency && next.currency) {
    next = {
      ...next,
      payments: {
        monthly: Number(next.monthly_payment ?? next.payments?.monthly ?? 0),
        currency: next.currency,
      },
    };
  }

  const resolved = resolveLeaseCurrency(next);
  if (next.results && typeof next.results === 'object') {
    const results = { ...(next.results as Record<string, unknown>) };
    const disc = { ...((results.disclosure_data as Record<string, unknown>) || {}) };
    if (disc.currency !== resolved || (isUkDemoLease(entry) && disc.asset !== next.asset)) {
      disc.currency = resolved;
      if (next.asset) disc.asset = next.asset;
      if (next.lessee || next.lessee_name) disc.lessee = next.lessee || next.lessee_name;
      if (next.lessor || next.lessor_name) disc.lessor = next.lessor || next.lessor_name;
      results.disclosure_data = disc;
      next = { ...next, results };
    }
  }

  return next;
}
