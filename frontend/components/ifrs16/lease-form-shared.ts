import type { Dispatch, SetStateAction } from 'react';
import type { ExtractionConfidenceMap } from '@/lib/ifrs16-lease-extraction';

export type LeaseFormTabProps = {
  form: Record<string, any>;
  setForm: Dispatch<SetStateAction<Record<string, any>>>;
  markDirty: (tab: string) => void;
  inputClass: string;
  labelClass: string;
  extractedConfidences?: ExtractionConfidenceMap;
  onClearExtractedField?: (field: string) => void;
};

export type CurrencyMode = 'AED' | 'INR' | 'GBP' | 'OTHER';
export type CountryMode = 'UAE' | 'INDIA' | 'UK' | 'OTHER';

export function monthsBetweenDates(start: string, end: string): number {
  if (!start || !end) return 0;
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s) return 0;
  let months = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
  if (e.getDate() < s.getDate()) months -= 1;
  return Math.max(1, months);
}

export function currencyModeFromForm(currency: string | undefined): CurrencyMode {
  const c = (currency || 'AED').toUpperCase();
  if (c === 'GBP') return 'GBP';
  if (c === 'INR') return 'INR';
  if (c === 'AED') return 'AED';
  return 'OTHER';
}

export function symForCurrencyMode(mode: CurrencyMode): string {
  if (mode === 'AED') return 'AED';
  if (mode === 'INR') return '₹';
  if (mode === 'GBP') return '£';
  return '';
}

export function currencyForMode(mode: CurrencyMode, current: string): string {
  if (mode === 'AED') return 'AED';
  if (mode === 'INR') return 'INR';
  if (mode === 'GBP') return 'GBP';
  return current && !['AED', 'INR', 'GBP'].includes(current) ? current : 'USD';
}

export function countryModeFromForm(country: string | undefined): CountryMode {
  const c = (country || 'UAE').trim();
  if (c === 'India') return 'INDIA';
  if (c === 'UK' || c === 'United Kingdom') return 'UK';
  if (c === 'UAE' || c === 'United Arab Emirates') return 'UAE';
  return c ? 'OTHER' : 'UAE';
}

export function countryForMode(mode: CountryMode): string {
  if (mode === 'INDIA') return 'India';
  if (mode === 'UK') return 'UK';
  if (mode === 'UAE') return 'UAE';
  return 'Other';
}

export function inputClassFilled(base: string, value: unknown): string {
  const filled = value != null && String(value).trim() !== '';
  return filled ? `${base} bg-[#E6F1FB] border-[#185FA5]` : base;
}
