/**
 * Lease Repository - localStorage management for IFRS 16 leases
 */

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
  status?: 'Active' | 'Draft' | 'Expiring Soon' | 'Expired' | 'Under Review' | 'Terminated';
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
  last_adjustment_date?: string;
  [key: string]: unknown;
}

const STORAGE_KEY = 'lease_repository';

export function getLeaseRepository(): LeaseRepositoryEntry[] {
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

export function saveToLeaseRepository(entry: LeaseRepositoryEntry): void {
  const repo = getLeaseRepository();
  const exists = repo.findIndex((e) => e.id === entry.id || e.lease_id === entry.lease_id);
  if (exists >= 0) {
    repo[exists] = entry;
  } else {
    repo.unshift(entry);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(repo));
}

export function getLeaseById(id: string): LeaseRepositoryEntry | undefined {
  return getLeaseRepository().find((e) => e.id === id || e.lease_id === id);
}

export function deleteLeaseFromRepository(id: string): void {
  const repo = getLeaseRepository().filter((e) => e.id !== id && e.lease_id !== id);
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
      currency: params.currency || 'INR',
    },
    liability: Number((params.results as any).lease_liability ?? 0),
    rou: Number((params.results as any).rou_asset ?? 0),
    results: params.results,
    calculated_at: new Date().toISOString(),
    lessee_name: params.lessee_name ?? params.lessee,
    lessor_name: params.lessor_name ?? params.lessor,
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
  };
}

/**
 * Build a full lease entry from tabbed form state (for Save to Repository).
 * Merges form fields into existing entry or creates new; preserves existing results if not recalculated.
 */
export function buildLeaseEntryFromForm(
  form: Record<string, any>,
  existing?: LeaseRepositoryEntry | null,
  results?: Record<string, unknown> | null,
  excelFileId?: string
): LeaseRepositoryEntry {
  const id = form.leaseId || form.lease_id || existing?.id || existing?.lease_id || `LEASE-2026-${String(Date.now()).slice(-6)}`;
  const start = form.startDate || form.effectiveDate || existing?.dates?.commencement || existing?.start_date || '';
  const end = form.endDate || existing?.end_date || existing?.dates?.end || '';
  const termMonths = form.lease_term_months
    ? parseInt(String(form.lease_term_months), 10)
    : existing?.dates?.term_months || (start && end ? Math.ceil((new Date(end).getTime() - new Date(start).getTime()) / (1000 * 60 * 60 * 24 * 30)) : 12);
  const monthly = Number(form.baseRentAmount ?? form.monthly_payment ?? existing?.payments?.monthly ?? existing?.monthly_payment ?? 0);
  const currency = form.currency || existing?.payments?.currency || 'INR';
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
    payments: { monthly, currency: currency || 'INR' },
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
    lessor_details: form.lessorDetails ?? existing?.lessor_details,
    lessee_details: form.lesseeDetails ?? existing?.lessee_details,
    legal_details: form.legalDetails ?? existing?.legal_details,
    payment_frequency: form.paymentFrequency ?? existing?.payment_frequency,
    payment_type: form.paymentType ?? existing?.payment_type,
    exchange_rate: form.exchangeRate ?? existing?.exchange_rate,
    extended_base_rent: form.extendedBaseRentAmount != null && form.extendedBaseRentAmount !== '' ? parseFloat(String(form.extendedBaseRentAmount)) : existing?.extended_base_rent,
    initial_direct_costs: form.initialDirectCosts != null && form.initialDirectCosts !== '' ? parseFloat(String(form.initialDirectCosts)) : existing?.initial_direct_costs,
    lease_incentives: form.leaseIncentives != null && form.leaseIncentives !== '' ? parseFloat(String(form.leaseIncentives)) : existing?.lease_incentives,
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
    last_adjustment_date: form.lastAdjustmentDate ?? existing?.last_adjustment_date,
    functional_currency: (form as any).functionalCurrency ?? existing?.functional_currency ?? 'INR',
    restoration_cost: (form as any).restorationCost != null && (form as any).restorationCost !== '' ? parseFloat(String((form as any).restorationCost)) : existing?.restoration_cost,
  };
  return entry;
}
