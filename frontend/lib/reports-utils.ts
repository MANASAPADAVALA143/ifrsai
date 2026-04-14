/**
 * Shared utilities for IFRS 16 Reports — read from localStorage lease_repository
 */

import { getLeaseRepository, type LeaseRepositoryEntry } from './lease-repository';
import { formatIndianCurrency } from './utils';

export { getLeaseRepository, getLeaseById } from './lease-repository';
export type { LeaseRepositoryEntry } from './lease-repository';

const STORAGE_KEY = 'lease_repository';

export function getLeasesFromStorage(): LeaseRepositoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Schedule row helper — backend may return PascalCase */
export function scheduleRow(row: any): {
  period: number;
  date: string;
  opening: number;
  payment: number;
  interest: number;
  principal: number;
  closing: number;
} {
  return {
    period: row?.Period ?? row?.period ?? 0,
    date: row?.Date ?? row?.payment_date ?? row?.date ?? '',
    opening: Number(row?.Opening_Balance ?? row?.opening_balance ?? 0),
    payment: Number(row?.Payment ?? row?.payment ?? 0),
    interest: Number(row?.Interest ?? row?.interest ?? 0),
    principal: Number(row?.Principal ?? row?.principal ?? 0),
    closing: Number(row?.Closing_Balance ?? row?.closing_balance ?? 0),
  };
}

export function getSchedule(lease: LeaseRepositoryEntry): any[] {
  const schedule = (lease?.results as any)?.amortization_schedule;
  return Array.isArray(schedule) ? schedule : [];
}

export function getLiability(lease: LeaseRepositoryEntry): number {
  return Number((lease?.results as any)?.lease_liability ?? lease?.liability ?? 0);
}

export function getROU(lease: LeaseRepositoryEntry): number {
  return Number((lease?.results as any)?.rou_asset ?? lease?.rou ?? 0);
}

export function getLiabilitySplit(lease: LeaseRepositoryEntry): { current_portion: number; non_current_portion: number } {
  const split = (lease?.results as any)?.liability_split ?? {};
  return {
    current_portion: Number(split.current_portion ?? 0),
    non_current_portion: Number(split.non_current_portion ?? 0),
  };
}

export function getMonthlyDepreciation(lease: LeaseRepositoryEntry): number {
  const res = lease?.results as any;
  if (res?.monthly_depreciation != null) return Number(res.monthly_depreciation);
  const rou = getROU(lease);
  const term = lease?.dates?.term_months ?? 0;
  return term > 0 ? rou / term : 0;
}

export function formatReportCurrency(amount: number, currency: string = 'INR'): string {
  const formatter = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: currency || 'INR',
    maximumFractionDigits: 0,
  });
  return formatter.format(amount);
}

export function formatNeg(amount: number, currency: string = 'INR'): string {
  if (amount < 0) return `(${formatReportCurrency(-amount, currency)})`;
  return formatReportCurrency(amount, currency);
}

/** Unique values for filters */
export function getUniqueLessees(leases: LeaseRepositoryEntry[]): string[] {
  const set = new Set<string>();
  leases.forEach((l) => {
    const v = l.lessee ?? l.lessee_name ?? '';
    if (v) set.add(v);
  });
  return Array.from(set).sort();
}

export function getUniqueLessors(leases: LeaseRepositoryEntry[]): string[] {
  const set = new Set<string>();
  leases.forEach((l) => {
    const v = l.lessor ?? l.lessor_name ?? '';
    if (v) set.add(v);
  });
  return Array.from(set).sort();
}

export function getUniqueLeaseTypes(leases: LeaseRepositoryEntry[]): string[] {
  const set = new Set<string>();
  leases.forEach((l) => {
    const v = l.lease_type ?? '';
    if (v) set.add(v);
  });
  return Array.from(set).sort();
}

export function getUniqueStatuses(leases: LeaseRepositoryEntry[]): string[] {
  const set = new Set<string>();
  leases.forEach((l) => {
    const v = l.status ?? l.lease_status ?? 'Active';
    set.add(v);
  });
  return Array.from(set).sort();
}

export function getUniqueLegalEntities(leases: LeaseRepositoryEntry[]): string[] {
  const set = new Set<string>();
  leases.forEach((l) => {
    const v = (l as any).legal_entity ?? '';
    if (v) set.add(v);
  });
  return Array.from(set).sort();
}

/** Year/month from date string */
export function getYearMonth(dateStr: string): { year: number; month: number } {
  if (!dateStr) return { year: 0, month: 0 };
  const d = new Date(dateStr);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

/** Get schedule row for a specific YYYY-MM period (for ERP period-specific amounts) */
export function getScheduleRowForPeriod(lease: LeaseRepositoryEntry, period: string): {
  period: number;
  date: string;
  opening: number;
  payment: number;
  interest: number;
  principal: number;
  closing: number;
} | null {
  const schedule = getSchedule(lease);
  const [py, pm] = period.split('-').map(Number);
  for (const row of schedule) {
    const r = scheduleRow(row);
    const d = r.date ? new Date(String(r.date).slice(0, 10)) : null;
    if (d && d.getFullYear() === py && d.getMonth() + 1 === pm) {
      return r;
    }
  }
  return null;
}

/** Default page size for reports */
export const REPORT_PAGE_SIZE = 25;
