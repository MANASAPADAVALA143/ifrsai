/** Parse JSON from a fetch body; avoids "Unexpected end of JSON input" on empty responses. */
export function parseJsonText<T>(text: string): T | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
}

// Format numbers in Indian number system (₹1,24,53,200)
export function formatIndianCurrency(amount: number): string {
  const formatter = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  });
  return formatter.format(amount);
}

// Format with decimals
export function formatIndianCurrencyWithDecimals(amount: number, decimals: number = 2): string {
  const formatter = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return formatter.format(amount);
}

/** ISO 4217 codes accepted by Intl.NumberFormat — invalid values (e.g. "N/A") would throw RangeError. */
const VALID_CURRENCIES_FOR_FORMAT = [
  'INR',
  'USD',
  'AED',
  'GBP',
  'EUR',
  'AUD',
  'SGD',
  'CAD',
  'JPY',
] as const;

/**
 * Returns a safe currency code for Intl or falls back (default INR except callers may pass 'USD' for IFRS 15).
 */
export function sanitizeCurrencyCode(
  currency: string | null | undefined,
  fallback: string = 'INR'
): string {
  const raw = String(currency ?? '')
    .trim()
    .toUpperCase();
  if (!raw || raw === 'N/A' || raw === 'NA' || raw === '—' || raw === '-') {
    return fallback;
  }
  return VALID_CURRENCIES_FOR_FORMAT.includes(raw as (typeof VALID_CURRENCIES_FOR_FORMAT)[number])
    ? raw
    : fallback;
}

// Format number with currency (INR, USD, etc.)
export function formatCurrency(amount: number, currency: string = 'INR', decimals: number = 0): string {
  const safeCurrency = sanitizeCurrencyCode(currency || 'INR', 'INR');
  const formatter = new Intl.NumberFormat(safeCurrency === 'INR' ? 'en-IN' : 'en-US', {
    style: 'currency',
    currency: safeCurrency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return formatter.format(amount);
}

// Format number without currency symbol
export function formatIndianNumber(num: number): string {
  return new Intl.NumberFormat('en-IN').format(num);
}

// Format crores
export function formatCrores(amount: number): string {
  const crores = amount / 10000000;
  return `₹${crores.toFixed(2)}Cr`;
}

// Format lakhs
export function formatLakhs(amount: number): string {
  const lakhs = amount / 100000;
  return `₹${lakhs.toFixed(2)}L`;
}

// Class name utility (like clsx)
export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ');
}

// Format date
export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// Get greeting based on time
export function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
