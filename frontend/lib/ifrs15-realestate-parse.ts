import * as XLSX from 'xlsx';

export const IFRS15_RE_FORM_IMPORT = 'ifrs15_realestate_form_import';

/** Sheet 1 — Off-Plan Sales Portfolio (main contract + unit rows) */
const PORTFOLIO_SHEET_HINTS = ['off-plan sales portfolio', 'off-plan', 'portfolio'];

/** Sheet 2 — revenue / completion overlay merged by contract_id */
const REVENUE_SHEET_HINTS = ['ifrs 15 revenue schedule', 'revenue schedule'];

/**
 * Column mapping — Excel header (normalized) → internal field key.
 * Sheet 1 drives contract form + unitRows; sheet 2 enriches completion & revenue.
 */
const PORTFOLIO_COLUMN_MAP: Record<string, string> = {
  contract_id: 'contract_id',
  project_name: 'project_name',
  unit_type: 'unit_type',
  unit_number: 'unit_number',
  buyer_name: 'buyer_name',
  spa_date: 'spa_date',
  total_contract_value_aed: 'contract_value',
  contract_value: 'contract_value',
  contract_price_aed: 'contract_value',
  payment_plan_type: 'payment_plan_type',
  deposit_received_aed: 'deposit_received',
  construction_start_date: 'construction_start',
  construction_start: 'construction_start',
  expected_handover_date: 'expected_handover',
  expected_handover: 'expected_handover',
  current_completion_pct: 'completion_pct',
  current_percentage_completion: 'completion_pct',
  completion_pct: 'completion_pct',
  milestone_1_pct: 'milestone_1_pct',
  milestone_1_amount_aed: 'milestone_1_amount',
  milestone_2_pct: 'milestone_2_pct',
  milestone_2_amount_aed: 'milestone_2_amount',
  rera_escrow_account: 'rera_escrow_account',
  rera_registration_number: 'rera_registration_number',
  vat_applicable: 'vat_applicable',
  performance_obligation: 'performance_obligation',
};

const REVENUE_COLUMN_MAP: Record<string, string> = {
  contract_id: 'contract_id',
  project_name: 'project_name',
  total_contract_value_aed: 'contract_value',
  completion_pct: 'completion_pct',
  revenue_recognised_to_date_aed: 'revenue_ytd',
  revenue_recognised_this_period_aed: 'revenue_period',
  contract_asset_aed: 'contract_asset',
  contract_liability_aed: 'contract_liability',
};

export type RealEstateExcelImport = {
  form: {
    projectName: string;
    reraNumber: string;
    spaExecutionDate: string;
    constructionStart: string;
    expectedHandover: string;
    contractValue: string;
    costsIncurred: string;
    totalCosts: string;
    revenuePrior: string;
    vatApplicable: string;
    depositReceived: string;
  };
  unitRows: Array<Record<string, string>>;
  milestones: Array<{ milestone: string; completion_pct_required: string; amount_released: string }>;
  portfolioCount: number;
  primaryContractId: string;
};

function normalizeHeader(h: unknown): string {
  return String(h ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function formatDate(v: unknown): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const s = String(v ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return s;
}

function formatNumber(v: unknown): string {
  if (v == null || v === '') return '';
  const n = Number(String(v).replace(/,/g, '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? String(n) : String(v).trim();
}

function normalizePercent(v: unknown): string {
  const n = Number(formatNumber(v));
  if (!Number.isFinite(n) || n <= 0) return '';
  const pct = n <= 1 ? n * 100 : n;
  return String(Math.round(pct * 100) / 100);
}

function sheetToMatrix(sheet: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
  }) as unknown[][];
}

function pickSheet(wb: XLSX.WorkBook, hints: string[]): XLSX.WorkSheet | null {
  for (const name of wb.SheetNames) {
    const n = name.toLowerCase();
    if (hints.some((h) => n.includes(h))) {
      return wb.Sheets[name] ?? null;
    }
  }
  return wb.Sheets[wb.SheetNames[0]] ?? null;
}

function findHeaderRow(matrix: unknown[][], requiredCol: string): number {
  for (let i = 0; i < matrix.length; i++) {
    const row = matrix[i];
    if (!row?.length) continue;
    for (const cell of row) {
      if (normalizeHeader(cell) === requiredCol) return i;
    }
  }
  return -1;
}

function rowToRecord(
  headers: string[],
  row: unknown[],
  colMap: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((h, i) => {
    const key = colMap[normalizeHeader(h)];
    if (!key) return;
    const raw = row[i];
    if (raw == null || raw === '') return;
    if (key.includes('date') || key === 'spa_date') {
      out[key] = formatDate(raw);
    } else if (key === 'completion_pct') {
      out[key] = normalizePercent(raw);
    } else if (key === 'vat_applicable') {
      out[key] =
        String(raw).toLowerCase() === 'true' || raw === true ? 'true' : String(raw);
    } else if (
      key.includes('amount') ||
      key.includes('value') ||
      key === 'deposit_received' ||
      key.includes('revenue') ||
      key.includes('contract_asset') ||
      key.includes('contract_liability')
    ) {
      out[key] = formatNumber(raw);
    } else {
      out[key] = String(raw).trim();
    }
  });
  return out;
}

function isDataRow(rec: Record<string, string>): boolean {
  const id = rec.contract_id?.trim().toLowerCase() || '';
  if (!id || id === 'string' || id === 'total') return false;
  return true;
}

function unitRowFromPortfolio(rec: Record<string, string>): Record<string, string> {
  return {
    contract_id: rec.contract_id || '',
    unit_number: rec.unit_number || '',
    unit_type: (rec.unit_type || 'apartment').toLowerCase(),
    contract_price_aed: rec.contract_value || '0',
    contract_date: rec.spa_date || '',
    completion_pct: rec.completion_pct || '',
    costs_incurred_aed:
      rec.contract_value && rec.completion_pct
        ? String(Math.round((Number(rec.contract_value) * Number(rec.completion_pct)) / 100))
        : '0',
    buyer_name: rec.buyer_name || '',
    buyer_id: '',
    project_name: rec.project_name || '',
    payment_plan_type: rec.payment_plan_type || '',
    vat_applicable: rec.vat_applicable || '',
    performance_obligation: rec.performance_obligation || '',
    revenue_ytd: rec.revenue_ytd || '',
    contract_asset: rec.contract_asset || '',
    contract_liability: rec.contract_liability || '',
  };
}

function milestonesFromRow(rec: Record<string, string>) {
  const ms: RealEstateExcelImport['milestones'] = [];
  if (rec.milestone_1_pct || rec.milestone_1_amount) {
    ms.push({
      milestone: 'Milestone 1',
      completion_pct_required: rec.milestone_1_pct || '0',
      amount_released: rec.milestone_1_amount || '0',
    });
  }
  if (rec.milestone_2_pct || rec.milestone_2_amount) {
    ms.push({
      milestone: 'Milestone 2',
      completion_pct_required: rec.milestone_2_pct || '0',
      amount_released: rec.milestone_2_amount || '0',
    });
  }
  return ms;
}

function buildFormFromPrimary(
  primary: Record<string, string>,
  revenueOverlay?: Record<string, string>
): RealEstateExcelImport['form'] {
  const merged = { ...primary, ...revenueOverlay };
  const contractValue = merged.contract_value || '0';
  const completionPct = Number(merged.completion_pct || 0);
  const totalCosts = contractValue;
  const costsIncurred =
    completionPct > 0
      ? String(Math.round((Number(contractValue) * completionPct) / 100))
      : contractValue;

  const rera = merged.rera_registration_number || merged.rera_escrow_account || '';

  return {
    projectName: merged.project_name || '',
    reraNumber: rera,
    spaExecutionDate: merged.spa_date || '',
    constructionStart: merged.construction_start || '',
    expectedHandover: merged.expected_handover || '',
    contractValue,
    totalCosts,
    costsIncurred,
    revenuePrior: merged.revenue_ytd || '0',
    vatApplicable: merged.vat_applicable === 'true' ? '5' : merged.vat_applicable || '5',
    depositReceived: merged.deposit_received || '',
  };
}

function parseSheetRows(
  sheet: XLSX.WorkSheet,
  colMap: Record<string, string>
): Record<string, string>[] {
  const matrix = sheetToMatrix(sheet);
  const hdrIdx = findHeaderRow(matrix, 'contract_id');
  if (hdrIdx < 0) return [];
  const headers = (matrix[hdrIdx] || []).map((h) => String(h));
  const rows: Record<string, string>[] = [];
  for (let r = hdrIdx + 1; r < matrix.length; r++) {
    const rec = rowToRecord(headers, matrix[r] || [], colMap);
    if (isDataRow(rec)) rows.push(rec);
  }
  return rows;
}

export function isRealEstateDemoFilename(name: string): boolean {
  const n = name.toLowerCase();
  return /realestate|ifrs15_uae|off.?plan|rera|emaar.*ifrs15/i.test(n);
}

/** Parse Emaar IFRS 15 UAE Real Estate demo workbook (sheet 1 + 2; sheet 3 is demo narrative only). */
export async function parseRealEstatePortfolioExcel(
  file: File
): Promise<RealEstateExcelImport | null> {
  const ext = file.name.toLowerCase();
  if (!ext.endsWith('.xlsx') && !ext.endsWith('.xls')) return null;

  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });

  const portfolioSheet = pickSheet(wb, PORTFOLIO_SHEET_HINTS);
  if (!portfolioSheet) return null;

  const portfolioRows = parseSheetRows(portfolioSheet, PORTFOLIO_COLUMN_MAP);
  if (portfolioRows.length === 0) return null;

  const revenueByContract: Record<string, Record<string, string>> = {};
  const revenueSheet = pickSheet(wb, REVENUE_SHEET_HINTS);
  if (revenueSheet) {
    for (const rec of parseSheetRows(revenueSheet, REVENUE_COLUMN_MAP)) {
      if (rec.contract_id) revenueByContract[rec.contract_id] = rec;
    }
  }

  const mergedRows = portfolioRows.map((row) => ({
    ...row,
    ...(revenueByContract[row.contract_id] || {}),
  }));

  const primary = mergedRows[0];
  const unitRows = mergedRows.map(unitRowFromPortfolio);
  const milestones = milestonesFromRow(primary);

  return {
    form: buildFormFromPrimary(primary, revenueByContract[primary.contract_id]),
    unitRows,
    milestones,
    portfolioCount: mergedRows.length,
    primaryContractId: primary.contract_id,
  };
}

/** @deprecated Use parseRealEstatePortfolioExcel — kept for IFRS 15 main-page redirect. */
export async function parseRealEstateDemoSpreadsheet(
  file: File
): Promise<Record<string, string> | null> {
  const parsed = await parseRealEstatePortfolioExcel(file);
  if (!parsed) return null;
  return {
    contractValue: parsed.form.contractValue,
    constructionStart: parsed.form.constructionStart,
    spaExecutionDate: parsed.form.spaExecutionDate,
    expectedHandover: parsed.form.expectedHandover,
    costsIncurred: parsed.form.costsIncurred,
    totalCosts: parsed.form.totalCosts,
    revenuePrior: parsed.form.revenuePrior,
    projectName: parsed.form.projectName,
    reraNumber: parsed.form.reraNumber,
  };
}

export function saveRealEstateFormImport(data: RealEstateExcelImport | Record<string, string>): void {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(IFRS15_RE_FORM_IMPORT, JSON.stringify(data));
}

export function isFullRealEstateImport(
  data: RealEstateExcelImport | Record<string, string>
): data is RealEstateExcelImport {
  return Boolean(data && typeof data === 'object' && 'unitRows' in data && 'form' in data);
}
