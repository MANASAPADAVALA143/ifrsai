/**
 * Lease Repository — server-first with localStorage cache (offline fallback).
 * Existing sync API preserved for all IFRS 16 pages.
 */

import {
  getDefaultIfrs16Currency,
  migrateLeaseEntry,
} from './ifrs16-currency';
import { API_URL } from './api';
import { getCurrentFirmId, LEGACY_FIRM_ID_KEY } from './firm-workspace';

export interface LeaseRepositoryEntry {
  id: string;
  asset: string;
  dates: {
    commencement: string;
    end: string;
    term_months: number;
  };
  payments: {
    monthly: number;
    currency: string;
  };
  liability: number;
  rou: number;
  results: Record<string, unknown>;
  calculated_at: string;
  lease_id?: string;
  lessee_name?: string;
  lessor_name?: string;
  excel_file_id?: string;
  /** Extended fields for full lease management */
  title?: string;
  lessee?: string;
  lessor?: string;
  lease_type?: string;
  start_date?: string;
  end_date?: string;
  monthly_payment?: number;
  discount_rate?: number;
  status?: 'Active' | 'Calculated' | 'Draft' | 'Expiring Soon' | 'Expired' | 'Under Review' | 'Terminated';
  version?: string;
  cost_centers?: { name: string; percent: number }[];
  /** Tabbed form extensions (optional) */
  transaction_type?: string;
  legal_entity?: string;
  lease_status?: string;
  modification_date?: string;
  effective_date?: string;
  payment_date?: string;
  renewal_date?: string;
  early_termination_date?: string;
  extended_end_date?: string;
  residual_value?: number;
  optional_purchase_price?: number;
  contract_sealing_date?: string;
  contract_sealing_location?: string;
  enable_contract_reduction?: boolean;
  description?: string;
  termination_clauses?: string;
  renewal_options?: string;
  restoration_obligations?: string;
  rera_registration_no?: string;
  emirate?: string;
  area_district?: string;
  free_zone?: string;
  lessor_details?: Record<string, string>;
  lessee_details?: Record<string, string>;
  legal_details?: Record<string, string>;
  payment_frequency?: string;
  payment_type?: string;
  currency?: string;
  exchange_rate?: string;
  extended_base_rent?: number;
  initial_direct_costs?: number;
  lease_incentives?: number;
  escalation_type?: string;
  escalation_value?: number;
  escalation_start_date?: string;
  escalation_frequency?: string;
  extended_escalation_value?: number;
  business_unit?: string;
  contract_reference?: string;
  brand?: string;
  country?: string;
  city?: string;
  location?: string;
  floor_unit?: string;
  useful_life?: number;
  depreciation_method?: string;
  rou_gl_code?: string;
  liability_gl_code?: string;
  interest_gl_code?: string;
  depreciation_gl_code?: string;
  modifications?: Array<{
    date: string;
    type: string;
    description: string;
    new_payment?: number;
    new_end_date?: string;
    reason?: string;
  }>;
  variable_payments?: boolean;
  variable_description?: string;
  variable_annual_amount?: number;
  variable_basis?: string;
  cpi_adjustments?: boolean;
  base_index_value?: number;
  current_index_value?: number;
  cpi_adjustment_frequency_months?: number;
  last_adjustment_date?: string;
  non_lease_component?: number;
  non_lease_description?: string;
  practical_expedient_elected?: boolean;
  /** Full IFRS 16 extractor JSON from upload-contract (for modification advisor, etc.) */
  contract_data?: Record<string, unknown>;
  /** True for legacy merged bulk-import rows — exclude from CFO portfolio analytics */
  is_portfolio_aggregate?: boolean;
  [key: string]: unknown;
}

const STORAGE_KEY = 'lease_repository';
const USER_ID_KEY = 'user_id';
const MIGRATION_DONE_KEY = 'ifrs16_server_migration_done';

export function setLeaseRepositoryAuthContext(firmId: string, userId?: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LEGACY_FIRM_ID_KEY, firmId);
  if (userId) localStorage.setItem(USER_ID_KEY, userId);
}

export function getLeaseRepositoryFirmId(): string {
  return getCurrentFirmId();
}

function getLeaseRepositoryUserId(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(USER_ID_KEY) || '';
}

function getFirmHeaders(): HeadersInit {
  const firmId = getLeaseRepositoryFirmId();
  const userId = getLeaseRepositoryUserId();
  return {
    'Content-Type': 'application/json',
    'X-Firm-Id': firmId,
    ...(userId ? { 'X-User-Id': userId } : {}),
  };
}

async function serverUpsertLease(entry: LeaseRepositoryEntry): Promise<void> {
  const res = await fetch(`${API_URL}/api/ifrs16/portfolio/add`, {
    method: 'POST',
    headers: getFirmHeaders(),
    body: JSON.stringify({ lease_data: entry }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Server upsert failed (${res.status})`);
  }
}

async function serverDeleteLease(leaseId: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/ifrs16/portfolio/${encodeURIComponent(leaseId)}`, {
    method: 'DELETE',
    headers: getFirmHeaders(),
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Server delete failed (${res.status})`);
  }
}

let syncChain: Promise<void> = Promise.resolve();

function queueServerSync(fn: () => Promise<void>): void {
  syncChain = syncChain
    .then(fn)
    .catch((err) => {
      console.warn('[lease-repository] server sync failed:', err);
    });
}

function formatDisclosureAmount(amount: number, currency: string): string {
  const ccy = String(currency || 'INR').toUpperCase();
  const numeric = Number(amount) || 0;
  if (ccy === 'INR') {
    return `₹${numeric.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  }
  if (ccy === 'GBP') {
    return `£${numeric.toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;
  }
  if (ccy === 'AED') {
    return `AED ${numeric.toLocaleString('en-AE', { maximumFractionDigits: 0 })}`;
  }
  return `${ccy} ${numeric.toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;
}

function inferAssetType(entry: LeaseRepositoryEntry): string {
  const text = String(entry.lease_type || entry.asset || entry.title || '').toLowerCase();
  if (text.includes('office')) return 'office space';
  if (text.includes('vehicle') || text.includes('car')) return 'vehicle asset';
  if (text.includes('warehouse')) return 'warehouse facility';
  if (text.includes('retail') || text.includes('store')) return 'retail premises';
  return 'asset';
}

function inferOptionFlag(value: unknown): string {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return 'No';
  if (text === 'none' || text === 'na' || text === 'n/a') return 'No';
  return 'Yes';
}

function ensureDisclosureNotes(entry: LeaseRepositoryEntry): LeaseRepositoryEntry {
  const currentResults = { ...((entry.results as Record<string, unknown>) || {}) };
  const current = currentResults.disclosure_notes;
  if (typeof current === 'string' && current.trim().length > 0) {
    if (entry.disclosure_generated === true) return entry;
    return { ...entry, disclosure_generated: true };
  }

  const currency = String(entry.currency || entry.payments?.currency || 'INR').toUpperCase();
  const leaseTermMonths = Number(entry.dates?.term_months || 0);
  const endDate = String(entry.end_date || entry.dates?.end || 'N/A');
  const liability = Number(entry.liability ?? currentResults.lease_liability ?? 0);
  const rou = Number(entry.rou ?? currentResults.rou_asset ?? 0);
  const variableDetails = String(entry.variable_description || '').trim();
  const variablePayments = variableDetails
    ? variableDetails
    : entry.variable_payments
      ? 'Based on contractual variable terms'
      : 'None';
  const title = String(entry.title || entry.asset || entry.id || 'Lease');
  const location = String(entry.location || entry.city || entry.country || 'N/A');
  const note = [
    `Lease: ${title}`,
    `The Group leases ${inferAssetType(entry)} at ${location}.`,
    `Lease term: ${leaseTermMonths} months ending ${endDate}.`,
    `Lease liability at period end: ${formatDisclosureAmount(liability, currency)}.`,
    `ROU asset at period end: ${formatDisclosureAmount(rou, currency)}.`,
    `IBR applied: ${Number(entry.discount_rate || 0).toFixed(2)}%.`,
    `Variable payments: ${variablePayments}.`,
    `Extension options: ${inferOptionFlag(entry.renewal_options)}.`,
    `Termination options: ${inferOptionFlag(entry.termination_clauses)}.`,
  ].join('\n');

  currentResults.disclosure_notes = note;
  return {
    ...entry,
    results: currentResults,
    disclosure_generated: true,
  };
}

export function getLeaseRepository(): LeaseRepositoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    let changed = false;
    const migrated = parsed.map((entry: LeaseRepositoryEntry) => {
      const next = ensureDisclosureNotes(migrateLeaseEntry(entry));
      if (JSON.stringify(next) !== JSON.stringify(entry)) changed = true;
      return next;
    });
    if (changed) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
    }
    return migrated;
  } catch {
    return [];
  }
}

/** Distinct non-empty legal_entity values from saved leases (sorted). */
export function getDistinctLegalEntities(repo: LeaseRepositoryEntry[]): string[] {
  const names = new Set<string>();
  for (const lease of repo) {
    const name = (lease.legal_entity || '').trim();
    if (name) names.add(name);
  }
  return Array.from(names).sort();
}

export function saveToLeaseRepository(entry: LeaseRepositoryEntry): void {
  saveManyToLeaseRepository([entry]);
}

/** Batch local save + serialized server sync (avoids flooding /api/ifrs16/portfolio/add). */
export function saveManyToLeaseRepository(entries: LeaseRepositoryEntry[]): void {
  if (entries.length === 0) return;
  const repo = getLeaseRepository();
  const enriched = entries.map((entry) => ensureDisclosureNotes(entry));
  for (const entry of enriched) {
    const exists = repo.findIndex((e) => e.id === entry.id || e.lease_id === entry.lease_id);
    if (exists >= 0) {
      repo[exists] = entry;
    } else {
      repo.unshift(entry);
    }
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(repo));
  for (const entry of enriched) {
    queueServerSync(() => serverUpsertLease(entry));
  }
}

export function getLeaseById(id: string): LeaseRepositoryEntry | undefined {
  return getLeaseRepository().find((e) => e.id === id || e.lease_id === id);
}

export function deleteLeaseFromRepository(id: string): void {
  const repo = getLeaseRepository().filter((e) => e.id !== id && e.lease_id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(repo));
  queueServerSync(() => serverDeleteLease(id));
}

export function deleteLeasesFromRepository(ids: string[]): void {
  const drop = new Set(ids.filter(Boolean));
  if (drop.size === 0) return;
  const repo = getLeaseRepository().filter((e) => !drop.has(e.id) && !drop.has(String(e.lease_id ?? '')));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(repo));
}

export function buildLeaseEntry(params: {
  lease_id: string;
  asset_description: string;
  commencement_date: string;
  lease_term_months: number;
  monthly_payment: number;
  currency: string;
  lessee_name?: string;
  lessor_name?: string;
  legal_entity?: string;
  results: Record<string, unknown>;
  excel_file_id?: string;
  title?: string;
  lessee?: string;
  lessor?: string;
  lease_type?: string;
  start_date?: string;
  end_date?: string;
  discount_rate?: number;
  status?: LeaseRepositoryEntry['status'];
  version?: string;
  cost_centers?: { name: string; percent: number }[];
  rent_free_months?: number;
  non_lease_component?: number;
  non_lease_description?: string;
  practical_expedient_elected?: boolean;
  legal_fees?: number;
  brokerage_fees?: number;
  other_initial_direct_costs?: number;
  cash_incentive?: number;
  payment_type?: string;
  is_portfolio_aggregate?: boolean;
}): LeaseRepositoryEntry {
  const start = new Date(params.commencement_date || params.start_date || '');
  const endDateStr = params.end_date || (() => {
    const end = new Date(start);
    end.setMonth(end.getMonth() + params.lease_term_months);
    return end.toISOString().split('T')[0];
  })();

  return {
    id: params.lease_id,
    lease_id: params.lease_id,
    asset: params.asset_description,
    dates: {
      commencement: params.commencement_date || params.start_date || '',
      end: endDateStr,
      term_months: params.lease_term_months,
    },
    payments: {
      monthly: params.monthly_payment,
      currency: params.currency || getDefaultIfrs16Currency(),
    },
    currency: params.currency || getDefaultIfrs16Currency(),
    liability: Number((params.results as any).lease_liability ?? 0),
    rou: Number((params.results as any).rou_asset ?? 0),
    results: params.results,
    calculated_at: new Date().toISOString(),
    lessee_name: params.lessee_name ?? params.lessee,
    lessor_name: params.lessor_name ?? params.lessor,
    legal_entity: (params.legal_entity ?? params.lessee_name ?? params.lessee ?? '').trim() || undefined,
    excel_file_id: params.excel_file_id,
    title: params.title || params.asset_description,
    lessee: params.lessee ?? params.lessee_name,
    lessor: params.lessor ?? params.lessor_name,
    lease_type: params.lease_type,
    start_date: params.start_date || params.commencement_date,
    end_date: params.end_date || endDateStr,
    monthly_payment: params.monthly_payment,
    discount_rate: params.discount_rate,
    status: params.status || 'Active',
    version: params.version || 'V1',
    cost_centers: params.cost_centers,
    rent_free_months: params.rent_free_months ?? 0,
    non_lease_component: params.non_lease_component ?? 0,
    non_lease_description: params.non_lease_description ?? '',
    practical_expedient_elected: Boolean(params.practical_expedient_elected ?? false),
    legal_fees: params.legal_fees,
    brokerage_fees: params.brokerage_fees,
    other_initial_direct_costs: params.other_initial_direct_costs,
    cash_incentive: params.cash_incentive,
    payment_type: params.payment_type,
    is_portfolio_aggregate: params.is_portfolio_aggregate ?? false,
  };
}

/** True when stored amortisation does not match rent-free / non-lease form inputs. */
export function scheduleMismatchStoredInputs(
  schedule: unknown,
  inputs: {
    rentFreeMonths?: number;
    nonLeaseComponent?: number;
    baseRentAmount?: number;
    practicalExpedientElected?: boolean;
  }
): boolean {
  if (!Array.isArray(schedule) || schedule.length === 0) return false;
  const row0 = schedule[0] as Record<string, unknown>;
  const pay0 = Number(row0.Payment ?? row0.payment ?? NaN);
  if (!Number.isFinite(pay0)) return false;

  const rentFree = Math.max(0, Number(inputs.rentFreeMonths) || 0);
  const gross = Math.max(0, Number(inputs.baseRentAmount) || 0);
  const nonLease = inputs.practicalExpedientElected
    ? 0
    : Math.max(0, Number(inputs.nonLeaseComponent) || 0);
  const expectedLeasePay = rentFree > 0 ? 0 : Math.max(0, gross - nonLease);

  if (Math.abs(pay0 - expectedLeasePay) > 0.01) return true;

  if (rentFree > 1 && schedule.length > 1) {
    const pay1 = Number((schedule[1] as Record<string, unknown>).Payment ?? (schedule[1] as Record<string, unknown>).payment ?? NaN);
    if (Number.isFinite(pay1) && rentFree >= 2 && Math.abs(pay1) > 0.01) return true;
  }
  return false;
}

/**
 * Build a full lease entry from tabbed form state (for Save to Repository).
 * Merges form fields into existing entry or creates new; preserves existing results if not recalculated.
 */
export function buildLeaseEntryFromForm(
  form: Record<string, any>,
  existing?: LeaseRepositoryEntry | null,
  results?: Record<string, unknown> | null,
  excelFileId?: string,
  contractData?: Record<string, unknown> | null
): LeaseRepositoryEntry {
  const id = form.leaseId || form.lease_id || existing?.id || existing?.lease_id || `LEASE-2026-${String(Date.now()).slice(-6)}`;
  const start = form.startDate || form.effectiveDate || existing?.dates?.commencement || existing?.start_date || '';
  const end = form.endDate || existing?.end_date || existing?.dates?.end || '';
  const termMonths = form.lease_term_months
    ? parseInt(String(form.lease_term_months), 10)
    : existing?.dates?.term_months || (start && end ? Math.ceil((new Date(end).getTime() - new Date(start).getTime()) / (1000 * 60 * 60 * 24 * 30)) : 12);
  const monthly = Number(form.baseRentAmount ?? form.monthly_payment ?? existing?.payments?.monthly ?? existing?.monthly_payment ?? 0);
  const currency = form.currency || existing?.currency || existing?.payments?.currency || getDefaultIfrs16Currency();
  const res = results ?? existing?.results ?? {};
  const liability = Number((res as any).lease_liability ?? existing?.liability ?? 0);
  const rou = Number((res as any).rou_asset ?? existing?.rou ?? 0);

  const entry: LeaseRepositoryEntry = {
    id,
    lease_id: id,
    asset: form.assetDescription ?? form.title ?? existing?.asset ?? '',
    dates: {
      commencement: start,
      end: end || (() => { const d = new Date(start); d.setMonth(d.getMonth() + termMonths); return d.toISOString().split('T')[0]; })(),
      term_months: termMonths,
    },
    payments: { monthly, currency: currency || getDefaultIfrs16Currency() },
    currency: currency || getDefaultIfrs16Currency(),
    liability,
    rou,
    results: res,
    calculated_at: (res && Object.keys(res).length) ? new Date().toISOString() : (existing?.calculated_at || new Date().toISOString()),
    lessee_name: form.lessee ?? form.lessee_name ?? existing?.lessee_name ?? existing?.lessee,
    lessor_name: form.lessor ?? form.lessor_name ?? existing?.lessor_name ?? existing?.lessor,
    excel_file_id: excelFileId ?? existing?.excel_file_id,
    title: form.title ?? form.assetDescription ?? existing?.title ?? existing?.asset,
    lessee: form.lessee ?? existing?.lessee ?? existing?.lessee_name,
    lessor: form.lessor ?? existing?.lessor ?? existing?.lessor_name,
    lease_type: form.leaseType ?? existing?.lease_type,
    start_date: start || existing?.start_date,
    end_date: end || existing?.end_date,
    monthly_payment: monthly,
    discount_rate: form.discountRate != null && form.discountRate !== '' ? parseFloat(String(form.discountRate)) : existing?.discount_rate,
    status: (form.leaseStatus ?? existing?.status ?? 'Active') as LeaseRepositoryEntry['status'],
    version: form.version ?? existing?.version ?? 'V1',
    cost_centers: form.costCenters?.length ? form.costCenters.map((c: any) => ({ name: typeof c === 'string' ? c : c.name, percent: typeof c === 'object' && c != null && 'percent' in c ? c.percent : 0 })) : existing?.cost_centers,
    transaction_type: form.transactionType ?? existing?.transaction_type,
    legal_entity: form.legalEntity ?? existing?.legal_entity,
    lease_status: form.leaseStatus ?? existing?.lease_status,
    modification_date: form.modificationDate ?? existing?.modification_date,
    effective_date: form.effectiveDate ?? existing?.effective_date,
    payment_date: form.paymentDate ?? existing?.payment_date,
    renewal_date: form.renewalDate ?? existing?.renewal_date,
    early_termination_date: form.earlyTerminationDate ?? existing?.early_termination_date,
    extended_end_date: form.extendedEndDate ?? existing?.extended_end_date,
    residual_value: form.residualValue != null && form.residualValue !== '' ? parseFloat(String(form.residualValue)) : existing?.residual_value,
    optional_purchase_price: form.optionalPurchasePrice != null && form.optionalPurchasePrice !== '' ? parseFloat(String(form.optionalPurchasePrice)) : existing?.optional_purchase_price,
    contract_sealing_date: form.contractSealingDate ?? existing?.contract_sealing_date,
    contract_sealing_location: form.contractSealingLocation ?? existing?.contract_sealing_location,
    description: form.description ?? existing?.description,
    termination_clauses: form.terminationClauses ?? existing?.termination_clauses,
    renewal_options: form.renewalOptions ?? existing?.renewal_options,
    restoration_obligations: form.restorationObligations ?? existing?.restoration_obligations,
    rera_registration_no: form.reraRegistrationNo ?? existing?.rera_registration_no,
    emirate: form.emirate ?? existing?.emirate,
    area_district: form.areaDistrict ?? existing?.area_district,
    free_zone: form.freeZone ?? existing?.free_zone,
    lessor_details: form.lessorDetails ?? existing?.lessor_details,
    lessee_details: form.lesseeDetails ?? existing?.lessee_details,
    legal_details: form.legalDetails ?? existing?.legal_details,
    payment_frequency: form.paymentFrequency ?? existing?.payment_frequency,
    payment_type: form.paymentType ?? existing?.payment_type,
    exchange_rate: form.exchangeRate ?? existing?.exchange_rate,
    extended_base_rent: form.extendedBaseRentAmount != null && form.extendedBaseRentAmount !== '' ? parseFloat(String(form.extendedBaseRentAmount)) : existing?.extended_base_rent,
    initial_direct_costs: (form.legalFees != null && form.legalFees !== '' ? parseFloat(String(form.legalFees)) : 0) + (form.brokerageFees != null && form.brokerageFees !== '' ? parseFloat(String(form.brokerageFees)) : 0) + (form.otherInitialDirectCosts != null && form.otherInitialDirectCosts !== '' ? parseFloat(String(form.otherInitialDirectCosts)) : 0) || (form.initialDirectCosts != null && form.initialDirectCosts !== '' ? parseFloat(String(form.initialDirectCosts)) : existing?.initial_direct_costs ?? 0),
    legal_fees: form.legalFees != null && form.legalFees !== '' ? parseFloat(String(form.legalFees)) : (existing as any)?.legal_fees,
    brokerage_fees: form.brokerageFees != null && form.brokerageFees !== '' ? parseFloat(String(form.brokerageFees)) : (existing as any)?.brokerage_fees,
    other_initial_direct_costs: form.otherInitialDirectCosts != null && form.otherInitialDirectCosts !== '' ? parseFloat(String(form.otherInitialDirectCosts)) : (existing as any)?.other_initial_direct_costs,
    initial_direct_costs_description: form.initialDirectCostsDescription ?? (existing as any)?.initial_direct_costs_description ?? '',
    lease_incentives: form.leaseIncentives != null && form.leaseIncentives !== '' ? parseFloat(String(form.leaseIncentives)) : existing?.lease_incentives,
    rent_free_months: form.rentFreeMonths ?? (existing as any)?.rent_free_months ?? 0,
    cash_incentive: form.cashIncentive != null && form.cashIncentive !== '' ? parseFloat(String(form.cashIncentive)) : (existing as any)?.cash_incentive ?? (form.leaseIncentives != null && form.leaseIncentives !== '' ? parseFloat(String(form.leaseIncentives)) : 0),
    lease_incentive_description: form.leaseIncentiveDescription ?? (existing as any)?.lease_incentive_description ?? '',
    non_lease_component: form.nonLeaseComponent != null && form.nonLeaseComponent !== '' ? parseFloat(String(form.nonLeaseComponent)) : (existing as any)?.non_lease_component ?? 0,
    non_lease_description: form.nonLeaseDescription ?? (existing as any)?.non_lease_description ?? '',
    non_lease_additive: Boolean(form.nonLeaseAdditive ?? (existing as any)?.non_lease_additive),
    practical_expedient_elected: Boolean(form.practicalExpedientElected ?? (existing as any)?.practical_expedient_elected ?? false),
    rvg_amount: form.rvgAmount != null && form.rvgAmount !== '' ? parseFloat(String(form.rvgAmount)) : (existing as any)?.rvg_amount,
    rvg_guaranteed_by: form.rvgGuaranteedBy ?? (existing as any)?.rvg_guaranteed_by ?? 'None',
    rvg_expected_payment: form.rvgExpectedPayment != null && form.rvgExpectedPayment !== '' ? parseFloat(String(form.rvgExpectedPayment)) : (existing as any)?.rvg_expected_payment ?? 0,
    escalation_type: form.escalationType ?? existing?.escalation_type,
    escalation_value: form.escalationValue != null && form.escalationValue !== '' ? parseFloat(String(form.escalationValue)) : existing?.escalation_value,
    escalation_start_date: form.escalationStartDate ?? existing?.escalation_start_date,
    escalation_frequency: form.escalationFrequency ?? existing?.escalation_frequency,
    business_unit: form.businessUnit ?? existing?.business_unit,
    contract_reference: form.contractReference ?? existing?.contract_reference,
    brand: form.brand ?? existing?.brand,
    country: form.country ?? existing?.country,
    city: form.city ?? existing?.city,
    location: form.location ?? existing?.location,
    floor_unit: form.floorUnit ?? existing?.floor_unit,
    useful_life: form.usefulLifeMonths != null && form.usefulLifeMonths !== '' ? parseInt(String(form.usefulLifeMonths), 10) : existing?.useful_life,
    depreciation_method: form.depreciationMethod ?? existing?.depreciation_method,
    rou_gl_code: form.rouGlCode ?? existing?.rou_gl_code,
    liability_gl_code: form.liabilityGlCode ?? existing?.liability_gl_code,
    interest_gl_code: form.interestGlCode ?? existing?.interest_gl_code,
    depreciation_gl_code: form.depreciationGlCode ?? existing?.depreciation_gl_code,
    modifications: form.modifications?.length ? form.modifications : existing?.modifications,
    variable_payments: form.variablePayments ?? existing?.variable_payments,
    variable_description: form.variableDescription ?? existing?.variable_description,
    variable_annual_amount: form.variableAnnualAmount != null ? parseFloat(String(form.variableAnnualAmount)) : existing?.variable_annual_amount,
    variable_basis: form.variableBasis ?? existing?.variable_basis,
    cpi_adjustments: form.cpiAdjustments ?? existing?.cpi_adjustments,
    base_index_value: form.baseIndexValue != null ? parseFloat(String(form.baseIndexValue)) : existing?.base_index_value,
    current_index_value: form.currentIndexValue != null ? parseFloat(String(form.currentIndexValue)) : existing?.current_index_value,
    cpi_adjustment_frequency_months:
      form.cpiAdjustmentFrequencyMonths != null && form.cpiAdjustmentFrequencyMonths !== ''
        ? parseInt(String(form.cpiAdjustmentFrequencyMonths), 10)
        : existing?.cpi_adjustment_frequency_months,
    last_adjustment_date: form.lastAdjustmentDate ?? existing?.last_adjustment_date,
    functional_currency:
      (form as any).functionalCurrency ??
      existing?.functional_currency ??
      (currency || getDefaultIfrs16Currency()),
    restoration_cost: (form as any).restorationCost != null && (form as any).restorationCost !== '' ? parseFloat(String((form as any).restorationCost)) : existing?.restoration_cost,
    contract_data:
      contractData != null && Object.keys(contractData).length > 0
        ? contractData
        : (existing as { contract_data?: Record<string, unknown> })?.contract_data,
  };
  return entry;
}

/** Pull leases from server into localStorage cache. */
export async function refreshLeaseRepositoryFromServer(): Promise<LeaseRepositoryEntry[]> {
  if (typeof window === 'undefined') return [];
  try {
    const res = await fetch(`${API_URL}/api/ifrs16/portfolio/list`, {
      method: 'GET',
      headers: getFirmHeaders(),
    });
    if (!res.ok) return getLeaseRepository();
    const json = (await res.json()) as { leases?: LeaseRepositoryEntry[] };
    const leases = Array.isArray(json.leases) ? json.leases : [];
    const migrated = leases.map((e) => ensureDisclosureNotes(migrateLeaseEntry(e)));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
    return migrated;
  } catch {
    return getLeaseRepository();
  }
}

/** One-time push of browser-only leases to server after login. */
export async function migrateLocalStorageToServer(): Promise<{ migrated: number; failed: number }> {
  if (typeof window === 'undefined') return { migrated: 0, failed: 0 };
  if (localStorage.getItem(MIGRATION_DONE_KEY) === '1') {
    return { migrated: 0, failed: 0 };
  }

  const local = getLeaseRepository();
  if (local.length === 0) {
    localStorage.setItem(MIGRATION_DONE_KEY, '1');
    return { migrated: 0, failed: 0 };
  }

  let migrated = 0;
  let failed = 0;
  for (const lease of local) {
    try {
      await serverUpsertLease(lease);
      migrated++;
    } catch {
      failed++;
    }
  }

  if (failed === 0) {
    localStorage.setItem(MIGRATION_DONE_KEY, '1');
    await refreshLeaseRepositoryFromServer();
  }
  return { migrated, failed };
}

/** Save calculation outputs to server (and local cache via saveToLeaseRepository). */
export async function saveLeaseCalculationToServer(
  leaseId: string,
  payload: {
    results?: Record<string, unknown>;
    amortization_schedule?: unknown[];
    journal_entries?: unknown[];
    disclosure_notes?: unknown;
    excel_file_id?: string;
  }
): Promise<void> {
  const res = await fetch(
    `${API_URL}/api/ifrs16/portfolio/${encodeURIComponent(leaseId)}/save-calculation`,
    {
      method: 'POST',
      headers: getFirmHeaders(),
      body: JSON.stringify(payload),
    }
  );
  if (!res.ok) {
    throw new Error(`Save calculation failed (${res.status})`);
  }
  const json = (await res.json()) as { lease?: LeaseRepositoryEntry };
  if (json.lease) {
    const repo = getLeaseRepository();
    const idx = repo.findIndex((e) => e.id === leaseId || e.lease_id === leaseId);
    const enriched = ensureDisclosureNotes(migrateLeaseEntry(json.lease));
    if (idx >= 0) repo[idx] = enriched;
    else repo.unshift(enriched);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(repo));
  }
}

export async function getPortfolioSummaryFromServer(): Promise<Record<string, unknown>> {
  const res = await fetch(`${API_URL}/api/ifrs16/portfolio/summary/portfolio`, {
    headers: getFirmHeaders(),
  });
  if (!res.ok) throw new Error(`Portfolio summary failed (${res.status})`);
  const json = (await res.json()) as { summary?: Record<string, unknown> };
  return json.summary || {};
}
