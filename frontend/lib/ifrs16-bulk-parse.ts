import * as XLSX from 'xlsx';
import { normalizeAnnualRate } from './ifrs16-rates';

export type ParsedLeaseRow = {
  lease_id: string;
  asset_description: string;
  lessee_name: string;
  lessor_name: string;
  commencement_date: string;
  lease_term_months: number;
  monthly_payment: number;
  annual_discount_rate: number;
  currency: string;
  payment_type: string;
  rent_free_months: number;
  escalation_rate: number;
  legal_fees: number;
  brokerage_fees: number;
  other_initial_direct_costs: number;
  cash_incentive: number;
  rvg_amount: number;
  rvg_guaranteed_by: string;
  rvg_expected_payment: number;
  cpi_index_base: number;
  cpi_index_current: number;
  cpi_adjustment_frequency_months: number;
  non_lease_component: number;
  non_lease_description: string;
  practical_expedient_elected: boolean;
  rowIndex: number;
  status: 'ready' | 'warning' | 'error';
  messages: string[];
};

function normalizeHeader(h: string): string {
  return String(h || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

function formatCellDate(v: unknown): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return v.toISOString().slice(0, 10);
  }
  return String(v ?? '').trim();
}

function parseFlexibleDate(s: string): string | null {
  if (!s) return null;
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const m = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) {
    const d = m[1].padStart(2, '0');
    const mo = m[2].padStart(2, '0');
    const y = m[3];
    return `${y}-${mo}-${d}`;
  }
  return null;
}

function parseBool(v: unknown): boolean {
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'y';
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function findHeaderRow(rows: string[][]): number {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r?.length) continue;
    const first = normalizeHeader(String(r[0] ?? ''));
    if (first === 'lease_id') return i;
  }
  return -1;
}

function sheetToMatrix(sheet: XLSX.WorkSheet): string[][] {
  return XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
  }) as string[][];
}

function rowObject(headers: string[], row: unknown[]): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  headers.forEach((h, i) => {
    const key = normalizeHeader(h);
    if (!key) return;
    let val = row[i];
    if (val instanceof Date) val = val.toISOString().slice(0, 10);
    o[key] = val;
  });
  return o;
}

function optionalWarnings(o: Record<string, unknown>): string[] {
  const w: string[] = [];
  if (!String(o.lessor_name ?? '').trim()) w.push('Optional: lessor_name empty');
  if (!String(o.lessee_name ?? '').trim()) w.push('Optional: lessee_name empty');
  return w;
}

export function objectToParsedRow(o: Record<string, unknown>, rowIndex: number): ParsedLeaseRow {
  const messages: string[] = [];
  let status: ParsedLeaseRow['status'] = 'ready';

  const lease_id = String(o.lease_id ?? '').trim();
  const asset_description = String(o.asset_description ?? '').trim();
  const commencement_raw = formatCellDate(o.commencement_date);
  const commencement_date = parseFlexibleDate(commencement_raw) || commencement_raw || '';
  const lease_term_months = Math.round(num(o.lease_term_months, 0));
  const monthly_payment = num(o.monthly_payment, 0);
  const annual_discount_rate = normalizeAnnualRate(o.annual_discount_rate);

  if (!lease_id) {
    messages.push('Missing: lease_id');
    status = 'error';
  }
  if (!asset_description) {
    messages.push('Missing: asset_description');
    status = 'error';
  }
  if (!commencement_date || !/^\d{4}-\d{2}-\d{2}$/.test(commencement_date)) {
    messages.push('Missing or invalid: commencement_date');
    status = 'error';
  }
  if (lease_term_months <= 0) {
    messages.push('Missing or invalid: lease_term_months');
    status = 'error';
  }
  if (monthly_payment <= 0) {
    messages.push('Missing or invalid: monthly_payment');
    status = 'error';
  }
  if (!Number.isFinite(annual_discount_rate) || annual_discount_rate <= 0) {
    messages.push('Missing or invalid: annual_discount_rate');
    status = 'error';
  }

  const ow = optionalWarnings(o);
  if (status !== 'error' && ow.length) {
    messages.push(...ow);
    status = 'warning';
  }

  return {
    lease_id,
    asset_description,
    lessee_name: String(o.lessee_name ?? ''),
    lessor_name: String(o.lessor_name ?? ''),
    commencement_date,
    lease_term_months: lease_term_months > 0 ? lease_term_months : 1,
    monthly_payment: monthly_payment > 0 ? monthly_payment : 0,
    annual_discount_rate: Number.isFinite(annual_discount_rate) ? annual_discount_rate : 0.0001,
    currency: String(o.currency ?? 'INR').trim() || 'INR',
    payment_type: String(o.payment_type ?? 'Arrears').trim() || 'Arrears',
    rent_free_months: Math.max(0, Math.round(num(o.rent_free_months, 0))),
    escalation_rate: normalizeAnnualRate(o.escalation_rate) || 0,
    legal_fees: Math.max(0, num(o.legal_fees, 0)),
    brokerage_fees: Math.max(0, num(o.brokerage_fees, 0)),
    other_initial_direct_costs: Math.max(0, num(o.other_initial_direct_costs, 0)),
    cash_incentive: Math.max(0, num(o.cash_incentive, 0)),
    rvg_amount: Math.max(0, num(o.rvg_amount, 0)),
    rvg_guaranteed_by: String(o.rvg_guaranteed_by ?? 'None').trim() || 'None',
    rvg_expected_payment: Math.max(0, num(o.rvg_expected_payment, 0)),
    cpi_index_base: Math.max(0, num(o.cpi_index_base, 0)),
    cpi_index_current: Math.max(0, num(o.cpi_index_current, 0)),
    cpi_adjustment_frequency_months: Math.max(1, Math.round(num(o.cpi_adjustment_frequency_months, 12))),
    non_lease_component: Math.max(0, num(o.non_lease_component, 0)),
    non_lease_description: String(o.non_lease_description ?? ''),
    practical_expedient_elected: parseBool(o.practical_expedient_elected),
    rowIndex,
    status,
    messages,
  };
}

/** Parse portfolio bulk template (.xlsx / .xls / .csv). Returns null if not a bulk template. */
export async function parseBulkSpreadsheetFile(file: File): Promise<ParsedLeaseRow[] | null> {
  const ext = file.name.toLowerCase();
  if (!ext.endsWith('.xlsx') && !ext.endsWith('.xls') && !ext.endsWith('.csv')) {
    return null;
  }
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return null;

  const matrix = sheetToMatrix(sheet);
  const hdrIdx = findHeaderRow(matrix);
  if (hdrIdx < 0) return null;

  const headers = (matrix[hdrIdx] || []).map((h) => String(h));
  const rows: ParsedLeaseRow[] = [];
  for (let r = hdrIdx + 1; r < matrix.length; r++) {
    const line = matrix[r];
    if (!line || !line.some((c) => String(c).trim())) continue;
    const o = rowObject(headers, line);
    rows.push(objectToParsedRow(o, r + 1));
  }
  return rows.length > 0 ? rows : null;
}

export function parsedRowToLeaseRequest(r: ParsedLeaseRow): Record<string, unknown> {
  const initial_direct_costs = r.legal_fees + r.brokerage_fees + r.other_initial_direct_costs;
  return {
    lease_id: r.lease_id,
    company_id: '',
    asset_description: r.asset_description,
    lessee_name: r.lessee_name,
    lessor_name: r.lessor_name,
    commencement_date: r.commencement_date,
    lease_term_months: r.lease_term_months,
    monthly_payment: r.monthly_payment,
    non_lease_component: r.non_lease_component,
    non_lease_description: r.non_lease_description,
    practical_expedient_elected: r.practical_expedient_elected,
    annual_discount_rate: r.annual_discount_rate,
    initial_direct_costs,
    legal_fees: r.legal_fees,
    brokerage_fees: r.brokerage_fees,
    other_initial_direct_costs: r.other_initial_direct_costs,
    initial_direct_costs_description: '',
    escalation_rate: r.escalation_rate,
    cpi_index_base: r.cpi_index_base,
    cpi_index_current: r.cpi_index_current,
    cpi_adjustment_frequency_months: r.cpi_adjustment_frequency_months,
    currency: r.currency,
    payment_type: r.payment_type,
    rent_free_months: r.rent_free_months,
    cash_incentive: r.cash_incentive,
    lease_incentive_description: '',
    rvg_amount: r.rvg_amount,
    rvg_guaranteed_by: r.rvg_guaranteed_by,
    rvg_expected_payment: r.rvg_expected_payment,
  };
}

export function countReadyBulkRows(rows: ParsedLeaseRow[]): number {
  return rows.filter((r) => r.status !== 'error').length;
}

/** Map a parsed bulk-template row into flat fields for the New Lease form / AI extraction apply path. */
export function bulkRowToFormExtraction(row: ParsedLeaseRow): Record<string, unknown> {
  const end = new Date(row.commencement_date);
  if (!Number.isNaN(end.getTime())) {
    end.setMonth(end.getMonth() + row.lease_term_months);
  }
  const endDate = Number.isNaN(end.getTime()) ? '' : end.toISOString().slice(0, 10);
  const initialDirectCosts = row.legal_fees + row.brokerage_fees + row.other_initial_direct_costs;
  const discountPct = Math.round(row.annual_discount_rate * 1000) / 10;

  return {
    lease_id: row.lease_id,
    asset_description: row.asset_description,
    title: row.asset_description,
    lessee_name: row.lessee_name,
    lessor_name: row.lessor_name,
    commencement_date: row.commencement_date,
    start_date: row.commencement_date,
    end_date: endDate,
    lease_term_months: row.lease_term_months,
    monthly_payment: row.monthly_payment,
    base_rent_amount: row.monthly_payment,
    discount_rate: discountPct,
    currency: row.currency,
    payment_type: row.payment_type,
    initial_direct_costs: initialDirectCosts,
    legal_fees: row.legal_fees,
    brokerage_fees: row.brokerage_fees,
    other_initial_direct_costs: row.other_initial_direct_costs,
    rent_free_months: row.rent_free_months,
    cash_incentive: row.cash_incentive,
    lease_incentives: row.cash_incentive,
    escalation_value: row.escalation_rate > 0 ? Math.round(row.escalation_rate * 1000) / 10 : undefined,
    rvg_amount: row.rvg_amount,
    rvg_guaranteed_by: row.rvg_guaranteed_by,
    rvg_expected_payment: row.rvg_expected_payment,
    non_lease_component: row.non_lease_component,
    non_lease_description: row.non_lease_description,
    practical_expedient_elected: row.practical_expedient_elected,
  };
}
