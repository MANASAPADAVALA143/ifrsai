'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import * as XLSX from 'xlsx';
import toast from 'react-hot-toast';
import {
  Upload,
  FileSpreadsheet,
  FileText,
  FileType,
  Download,
  ChevronLeft,
  ChevronRight,
  Loader2,
  CheckCircle2,
  XCircle,
  Building2,
  Landmark,
} from 'lucide-react';
import { SidebarLayout } from '@/components/SidebarLayout';
import { Button } from '@/components/Button';
import { ifrs16Api } from '@/lib/api';
import { saveToLeaseRepository, buildLeaseEntry } from '@/lib/lease-repository';
import { formatIndianCurrency, formatIndianNumber } from '@/lib/utils';

const cardClass =
  'bg-white rounded-[14px] border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)]';
const MAX_BYTES = 50 * 1024 * 1024;
const PREVIEW_PAGE_SIZE = 20;
const CALC_CHUNK = 25;

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

type BulkResultRow = {
  lease_id: string;
  status: string;
  error: string | null;
  lease_liability: number;
  rou_asset: number;
  monthly_depreciation: number;
  total_interest: number;
  calculation_results?: Record<string, unknown> | null;
};

type MergedBulkResponse = {
  total: number;
  successful: number;
  failed: number;
  results: BulkResultRow[];
  portfolio_summary: {
    total_lease_liability: number;
    total_rou_asset: number;
    avg_ibr: number;
    currency_breakdown: Record<string, number>;
  };
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

function normalizeAnnualRate(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return NaN;
  if (n > 1) return n / 100;
  return n;
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

function objectToParsedRow(o: Record<string, unknown>, rowIndex: number): ParsedLeaseRow {
  const messages: string[] = [];
  let status: ParsedLeaseRow['status'] = 'ready';

  const lease_id = String(o.lease_id ?? '').trim();
  const asset_description = String(o.asset_description ?? '').trim();
  let commencement_raw = formatCellDate(o.commencement_date);
  const commencement_date = parseFlexibleDate(commencement_raw) || (commencement_raw || '');
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

function parsedRowToLeaseRequest(r: ParsedLeaseRow): Record<string, unknown> {
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

function getVal(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const p of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function extractionToParsedRow(raw: unknown, fileBaseId: string, rowIndex: number): ParsedLeaseRow {
  const messages: string[] = [];
  const o = raw as Record<string, unknown>;

  const asset =
    String(
      getVal(o, ['basic_info', 'asset_description', 'value']) ??
        getVal(o, ['basic_info', 'asset_description']) ??
        o.asset_description ??
        ''
    ).trim();

  const lessee =
    String(
      getVal(o, ['basic_info', 'lessee_name', 'value']) ??
        getVal(o, ['basic_info', 'lessee_name']) ??
        o.lessee_name ??
        ''
    ).trim();

  const lessor =
    String(
      getVal(o, ['basic_info', 'lessor_name', 'value']) ??
        getVal(o, ['basic_info', 'lessor_name']) ??
        o.lessor_name ??
        ''
    ).trim();

  let start =
    String(
      getVal(o, ['dates', 'commencement_date', 'value']) ??
        getVal(o, ['dates', 'commencement_date']) ??
        o.commencement_date ??
        o.start_date ??
        ''
    ).slice(0, 10);

  let end =
    String(
      getVal(o, ['dates', 'end_date', 'value']) ??
        getVal(o, ['dates', 'end_date']) ??
        o.end_date ??
        ''
    ).slice(0, 10);

  const termFromExtract = num(
    getVal(o, ['dates', 'lease_term_months', 'value']) ?? getVal(o, ['dates', 'lease_term_months']),
    0
  );

  let lease_term_months = Math.round(termFromExtract);
  if (lease_term_months <= 0 && start && end) {
    const a = new Date(start);
    const b = new Date(end);
    if (!Number.isNaN(a.getTime()) && !Number.isNaN(b.getTime())) {
      lease_term_months = Math.max(1, Math.ceil((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24 * 30.44)));
    }
  }
  if (lease_term_months <= 0) lease_term_months = 36;

  const monthly = num(
    getVal(o, ['payments', 'monthly_amount', 'value']) ??
      getVal(o, ['payments', 'monthly_amount']) ??
      o.monthly_payment,
    0
  );

  let dr = num(
    getVal(o, ['discount_rate', 'stated_rate', 'value']) ??
      getVal(o, ['discount_rate', 'stated_rate']) ??
      o.discount_rate ??
      o.ibr,
    NaN
  );
  if (Number.isFinite(dr) && dr > 1) dr /= 100;
  if (!Number.isFinite(dr) || dr <= 0) {
    messages.push('Could not infer annual_discount_rate — using 8.5%');
    dr = 0.085;
  }

  const currency = String(
    getVal(o, ['payments', 'currency', 'value']) ?? getVal(o, ['payments', 'currency']) ?? o.currency ?? 'INR'
  );

  const payment_type = String(
    getVal(o, ['payments', 'payment_type', 'value']) ??
      getVal(o, ['payments', 'payment_type']) ??
      o.payment_type ??
      'Arrears'
  );

  if (!start) {
    messages.push('AI did not return commencement_date — using today');
    start = new Date().toISOString().slice(0, 10);
  }

  let status: ParsedLeaseRow['status'] = messages.some((m) => m.includes('did not')) ? 'warning' : 'ready';
  if (!asset || monthly <= 0) {
    status = 'error';
    messages.push('Missing required fields from extraction (asset or monthly payment)');
  }

  const lease_id = `PDF-${fileBaseId.replace(/[^a-zA-Z0-9_-]/g, '')}-${rowIndex}`.slice(0, 80);

  if (!lessor) messages.push('Optional: lessor_name empty');
  if (!lessee) messages.push('Optional: lessee_name empty');
  if (status === 'ready' && messages.some((m) => m.startsWith('Optional'))) status = 'warning';

  return {
    lease_id,
    asset_description: asset || `Lease from ${fileBaseId}`,
    lessee_name: lessee,
    lessor_name: lessor,
    commencement_date: start,
    lease_term_months,
    monthly_payment: monthly,
    annual_discount_rate: dr,
    currency,
    payment_type,
    rent_free_months: 0,
    escalation_rate: 0,
    legal_fees: 0,
    brokerage_fees: 0,
    other_initial_direct_costs: 0,
    cash_incentive: 0,
    rvg_amount: 0,
    rvg_guaranteed_by: 'None',
    rvg_expected_payment: 0,
    cpi_index_base: 0,
    cpi_index_current: 0,
    cpi_adjustment_frequency_months: 12,
    non_lease_component: 0,
    non_lease_description: '',
    practical_expedient_elected: false,
    rowIndex,
    status,
    messages,
  };
}

function mergeSummaries(parts: MergedBulkResponse[]): MergedBulkResponse {
  const results = parts.flatMap((p) => p.results);
  const successful = results.filter((r) => r.status === 'success').length;
  const failed = results.filter((r) => r.status === 'error').length;
  let ibrW = 0;
  const ccy: Record<string, number> = {};
  for (const p of parts) {
    for (const [k, v] of Object.entries(p.portfolio_summary.currency_breakdown)) {
      ccy[k] = (ccy[k] ?? 0) + v;
    }
    const n = p.successful;
    if (n > 0) ibrW += p.portfolio_summary.avg_ibr * n;
  }
  const succCount = parts.reduce((s, p) => s + p.successful, 0);
  return {
    total: results.length,
    successful,
    failed,
    results,
    portfolio_summary: {
      total_lease_liability: parts.reduce((s, p) => s + p.portfolio_summary.total_lease_liability, 0),
      total_rou_asset: parts.reduce((s, p) => s + p.portfolio_summary.total_rou_asset, 0),
      avg_ibr: succCount > 0 ? ibrW / succCount : 0,
      currency_breakdown: ccy,
    },
  };
}

export default function BulkUploadPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<number>(0);
  const [parsedRows, setParsedRows] = useState<ParsedLeaseRow[]>([]);
  const [previewPage, setPreviewPage] = useState(0);
  const [bulkResult, setBulkResult] = useState<MergedBulkResponse | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [calcDone, setCalcDone] = useState(0);
  const [calcTotal, setCalcTotal] = useState(0);
  const [pdfProgress, setPdfProgress] = useState<{ cur: number; total: number } | null>(null);

  const resetFlow = () => {
    setStep(1);
    setFileName(null);
    setFileSize(0);
    setParsedRows([]);
    setPreviewPage(0);
    setBulkResult(null);
    setCalcDone(0);
    setCalcTotal(0);
    setPdfProgress(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const parseExcelCsv = useCallback(async (file: File) => {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) {
      toast.error('No sheet found');
      return;
    }
    const matrix = sheetToMatrix(sheet);
    const hdrIdx = findHeaderRow(matrix);
    if (hdrIdx < 0) {
      toast.error('Could not find header row (need lease_id column)');
      return;
    }
    const headers = (matrix[hdrIdx] || []).map((h) => String(h));
    const rows: ParsedLeaseRow[] = [];
    for (let r = hdrIdx + 1; r < matrix.length; r++) {
      const line = matrix[r];
      if (!line || !line.some((c) => String(c).trim())) continue;
      const o = rowObject(headers, line);
      rows.push(objectToParsedRow(o, r + 1));
    }
    if (rows.length === 0) {
      toast.error('No data rows found');
      return;
    }
    setParsedRows(rows);
    setFileName(file.name);
    setFileSize(file.size);
    setStep(2);
    setPreviewPage(0);
    toast.success(`${rows.length} lease(s) parsed`);
  }, []);

  const processPdfFiles = useCallback(async (files: File[]) => {
    const list = [...files];
    setPdfProgress({ cur: 0, total: list.length });
    const out: ParsedLeaseRow[] = [];
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      setPdfProgress({ cur: i + 1, total: list.length });
      const base = f.name.replace(/\.[^.]+$/, '') || `lease-${i + 1}`;
      const { data, error } = await ifrs16Api.uploadContract(f);
      if (error || !data) {
        toast.error(error || `Extraction failed: ${f.name}`);
        out.push(
          objectToParsedRow(
            {
              lease_id: `ERR-${base}-${i}`,
              asset_description: f.name,
              lessee_name: '',
              lessor_name: '',
              commencement_date: '',
              lease_term_months: 0,
              monthly_payment: 0,
              annual_discount_rate: 0,
            },
            i + 1
          )
        );
        continue;
      }
      const raw = (data as { extracted_data?: unknown }).extracted_data ?? data;
      out.push(extractionToParsedRow(raw, base, i + 1));
    }
    setPdfProgress(null);
    setParsedRows(out);
    setFileName(list.length === 1 ? list[0].name : `${list.length} PDF files`);
    setFileSize(list.reduce((s, f) => s + f.size, 0));
    setStep(2);
    setPreviewPage(0);
    toast.success(`Extracted ${out.length} lease(s) from PDF`);
  }, []);

  const onFileChosen = async (files: FileList | null) => {
    if (!files?.length) return;
    const all = Array.from(files);
    const totalSize = all.reduce((s, f) => s + f.size, 0);
    if (all.some((f) => f.size > MAX_BYTES) || totalSize > MAX_BYTES) {
      toast.error('Each file must be under 50MB');
      return;
    }
    if (all.length > 1) {
      const allPdf = all.every((f) => f.name.toLowerCase().endsWith('.pdf'));
      if (allPdf) {
        await processPdfFiles(all);
        return;
      }
      toast.error('Select one Excel/CSV file, or multiple PDFs only');
      return;
    }
    const file = all[0];
    const ext = file.name.toLowerCase();
    if (ext.endsWith('.pdf')) {
      await processPdfFiles([file]);
      return;
    }
    if (ext.endsWith('.xlsx') || ext.endsWith('.xls') || ext.endsWith('.csv')) {
      await parseExcelCsv(file);
      return;
    }
    toast.error('Use .xlsx, .csv, or .pdf');
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    void onFileChosen(e.dataTransfer.files);
  };

  const downloadTemplate = () => {
    window.open(ifrs16Api.bulkTemplateUrl(), '_blank', 'noopener,noreferrer');
    toast.success('Downloading template…');
  };

  const readyRows = useMemo(() => parsedRows.filter((r) => r.status !== 'error'), [parsedRows]);
  const errorRows = useMemo(() => parsedRows.filter((r) => r.status === 'error'), [parsedRows]);
  const warningCount = useMemo(() => parsedRows.filter((r) => r.status === 'warning').length, [parsedRows]);

  const previewSlice = useMemo(() => {
    const start = previewPage * PREVIEW_PAGE_SIZE;
    return parsedRows.slice(start, start + PREVIEW_PAGE_SIZE);
  }, [parsedRows, previewPage]);

  const totalPreviewPages = Math.max(1, Math.ceil(parsedRows.length / PREVIEW_PAGE_SIZE));

  const runBulkCalculate = async () => {
    const toSend = readyRows.map(parsedRowToLeaseRequest);
    if (toSend.length === 0) {
      toast.error('No valid leases to calculate');
      return;
    }
    setCalculating(true);
    setBulkResult(null);
    setCalcTotal(toSend.length);
    setCalcDone(0);
    try {
      const chunks: typeof toSend[] = [];
      for (let i = 0; i < toSend.length; i += CALC_CHUNK) {
        chunks.push(toSend.slice(i, i + CALC_CHUNK));
      }
      const parts: MergedBulkResponse[] = [];
      for (let c = 0; c < chunks.length; c++) {
        const { data, error } = await ifrs16Api.bulkCalculate(chunks[c]);
        if (error || !data) throw new Error(error || 'Bulk calculate failed');
        parts.push(data as MergedBulkResponse);
        setCalcDone(Math.min((c + 1) * CALC_CHUNK, toSend.length));
      }
      const merged = mergeSummaries(parts);
      setBulkResult(merged);
      setStep(3);
      toast.success(`Calculated ${merged.successful} lease(s)`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Calculation failed');
    } finally {
      setCalculating(false);
    }
  };

  const downloadResultsExcel = () => {
    if (!bulkResult) return;
    const ws = XLSX.utils.json_to_sheet(
      bulkResult.results.map((r) => ({
        lease_id: r.lease_id,
        status: r.status,
        error: r.error ?? '',
        lease_liability: r.lease_liability,
        rou_asset: r.rou_asset,
        monthly_depreciation: r.monthly_depreciation,
        total_interest: r.total_interest,
      }))
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Results');
    XLSX.writeFile(wb, `ifrs16_bulk_results_${Date.now()}.xlsx`);
    toast.success('Results downloaded');
  };

  const saveAllToRepository = () => {
    if (!bulkResult) return;
    let n = 0;
    const rowById = new Map(parsedRows.map((r) => [r.lease_id, r]));
    for (const r of bulkResult.results) {
      if (r.status !== 'success') continue;
      const pr = rowById.get(r.lease_id);
      const results = (r.calculation_results || {
        lease_liability: r.lease_liability,
        rou_asset: r.rou_asset,
        monthly_depreciation: r.monthly_depreciation,
        total_interest: r.total_interest,
      }) as Record<string, unknown>;
      const entry = buildLeaseEntry({
        lease_id: r.lease_id,
        asset_description: pr?.asset_description ?? r.lease_id,
        commencement_date: pr?.commencement_date ?? '',
        lease_term_months: pr?.lease_term_months ?? 12,
        monthly_payment: pr?.monthly_payment ?? 0,
        currency: pr?.currency ?? 'INR',
        lessee_name: pr?.lessee_name,
        lessor_name: pr?.lessor_name,
        discount_rate: pr ? pr.annual_discount_rate * 100 : undefined,
        results,
        status: 'Active',
      });
      saveToLeaseRepository(entry);
      n++;
    }
    toast.success(`Saved ${n} lease(s) to repository`);
  };

  const rowByLeaseId = useMemo(() => new Map(parsedRows.map((r) => [r.lease_id, r])), [parsedRows]);

  const progressPct = calcTotal > 0 ? Math.round((calcDone / calcTotal) * 100) : 0;

  return (
    <SidebarLayout
      pageTitle="Portfolio Bulk Upload"
      pageSubtitle="Upload hundreds of leases at once — Excel, CSV, or PDF"
    >
      <div className="max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2">
            {[1, 2, 3].map((s) => (
              <div key={s} className="flex items-center gap-2">
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${
                    step >= s ? 'bg-[#f97316] text-white' : 'bg-[#e2e8f0] text-[#64748b]'
                  }`}
                >
                  {s}
                </span>
                <span className={`text-sm ${step >= s ? 'text-[#1e293b] font-medium' : 'text-[#94a3b8]'}`}>
                  {s === 1 ? 'Upload File' : s === 2 ? 'Preview & Confirm' : 'Results'}
                </span>
                {s < 3 && <ChevronRight className="w-4 h-4 text-[#cbd5e1] hidden sm:inline" />}
              </div>
            ))}
          </div>
          <Button variant="secondary" size="sm" onClick={downloadTemplate} className="border-[#e2e8f0]">
            <Download className="w-4 h-4" />
            Download Template
          </Button>
        </div>

        {step === 1 && (
          <>
            <div
              className={`${cardClass} border-2 border-dashed border-[#f97316]/40 p-10 text-center cursor-pointer hover:bg-[#fff7ed]/30 transition-colors`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
            >
              <input
                ref={inputRef}
                type="file"
                className="hidden"
                accept=".xlsx,.xls,.csv,.pdf"
                multiple
                onChange={(e) => void onFileChosen(e.target.files)}
              />
              <Upload className="w-12 h-12 mx-auto text-[#f97316] mb-3" />
              <p className="text-[#1e293b] font-medium">Drag and drop your file here or click to browse</p>
              <p className="text-sm text-[#64748b] mt-2">.xlsx, .csv, .pdf — max 50MB</p>
              {fileName && (
                <p className="text-xs text-[#475569] mt-4">
                  Selected: {fileName} ({(fileSize / 1024).toFixed(1)} KB)
                </p>
              )}
            </div>

            {pdfProgress && (
              <div className={`${cardClass} p-4 flex items-center gap-3`}>
                <Loader2 className="w-5 h-5 animate-spin text-[#f97316]" />
                <span className="text-sm text-[#475569]">
                  AI extraction: file {pdfProgress.cur} of {pdfProgress.total}…
                </span>
              </div>
            )}

            <div className="grid md:grid-cols-3 gap-4">
              <div className={`${cardClass} p-4`}>
                <div className="flex items-center gap-2 mb-2">
                  <FileSpreadsheet className="w-5 h-5 text-[#f97316]" />
                  <span className="font-semibold text-[#1e293b]">Excel (.xlsx)</span>
                </div>
                <p className="text-sm text-[#64748b]">
                  Use our template. Supports 10,000+ leases. Fastest processing.
                </p>
              </div>
              <div className={`${cardClass} p-4`}>
                <div className="flex items-center gap-2 mb-2">
                  <FileText className="w-5 h-5 text-[#2E86AB]" />
                  <span className="font-semibold text-[#1e293b]">CSV (.csv)</span>
                </div>
                <p className="text-sm text-[#64748b]">
                  Comma-separated. Same columns as Excel template. Good for system exports.
                </p>
              </div>
              <div className={`${cardClass} p-4 relative`}>
                <span className="absolute top-3 right-3 text-[10px] font-bold px-2 py-0.5 rounded bg-violet-100 text-violet-800">
                  AI Extraction
                </span>
                <div className="flex items-center gap-2 mb-2">
                  <FileType className="w-5 h-5 text-[#64748b]" />
                  <span className="font-semibold text-[#1e293b]">PDF</span>
                </div>
                <p className="text-sm text-[#64748b]">
                  AI extracts lease data automatically. Best for contracts. Slower — one file at a time with progress.
                </p>
              </div>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div className="rounded-lg border border-blue-200 bg-blue-50/80 px-4 py-3 text-sm text-blue-900">
              Review parsed leases below, then run calculation. Rows with errors will be skipped.
            </div>

            <div
              className={`${cardClass} px-5 py-4 flex flex-wrap gap-4 items-center text-sm text-[#475569]`}
            >
              <span>
                ✅ {parsedRows.length - errorRows.length} leases parsed successfully
              </span>
              {warningCount > 0 && (
                <span className="text-amber-700">⚠️ {warningCount} row(s) with warnings</span>
              )}
              {errorRows.length > 0 && (
                <span className="text-red-600">⚠️ {errorRows.length} row(s) with errors</span>
              )}
            </div>

            <div className={`${cardClass} overflow-hidden`}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#f8fafc] text-left text-xs font-semibold text-[#64748b] uppercase">
                      <th className="px-3 py-2">#</th>
                      <th className="px-3 py-2">Lease ID</th>
                      <th className="px-3 py-2">Asset</th>
                      <th className="px-3 py-2 text-right">Monthly</th>
                      <th className="px-3 py-2 text-right">Term</th>
                      <th className="px-3 py-2 text-right">IBR%</th>
                      <th className="px-3 py-2">Currency</th>
                      <th className="px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewSlice.map((r, i) => (
                      <tr
                        key={`${r.lease_id}-${r.rowIndex}`}
                        className={`border-t border-[#f1f5f9] ${
                          r.status === 'error'
                            ? 'bg-red-50'
                            : r.status === 'warning'
                              ? 'bg-amber-50/80'
                              : ''
                        }`}
                        title={r.messages.join(' · ')}
                      >
                        <td className="px-3 py-2 text-[#94a3b8]">{previewPage * PREVIEW_PAGE_SIZE + i + 1}</td>
                        <td className="px-3 py-2 font-mono text-xs">{r.lease_id || '—'}</td>
                        <td className="px-3 py-2 max-w-[200px] truncate">{r.asset_description}</td>
                        <td className="px-3 py-2 text-right font-mono">
                          {formatIndianCurrency(r.monthly_payment)}
                        </td>
                        <td className="px-3 py-2 text-right">{r.lease_term_months}</td>
                        <td className="px-3 py-2 text-right">{(r.annual_discount_rate * 100).toFixed(2)}%</td>
                        <td className="px-3 py-2">{r.currency}</td>
                        <td className="px-3 py-2">
                          {r.status === 'ready' && <span title={r.messages.join(' ')}>✅ Ready</span>}
                          {r.status === 'warning' && <span title={r.messages.join(' ')}>⚠️ Warning</span>}
                          {r.status === 'error' && <span title={r.messages.join(' ')}>❌ Error</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {parsedRows.length > PREVIEW_PAGE_SIZE && (
                <div className="flex items-center justify-between px-4 py-2 border-t border-[#e2e8f0] text-sm">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={previewPage <= 0}
                    onClick={() => setPreviewPage((p) => Math.max(0, p - 1))}
                  >
                    <ChevronLeft className="w-4 h-4" /> Prev
                  </Button>
                  <span className="text-[#64748b]">
                    Page {previewPage + 1} / {totalPreviewPages}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={previewPage >= totalPreviewPages - 1}
                    onClick={() => setPreviewPage((p) => Math.min(totalPreviewPages - 1, p + 1))}
                  >
                    Next <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </div>

            <p className="text-sm text-[#475569]">
              {readyRows.length} leases ready to calculate. {errorRows.length} errors will be skipped.
            </p>

            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => { setStep(1); setParsedRows([]); setFileName(null); }}>
                <ChevronLeft className="w-4 h-4" /> Back
              </Button>
              <Button
                variant="primary"
                onClick={() => void runBulkCalculate()}
                disabled={readyRows.length === 0 || calculating}
                isLoading={calculating}
              >
                Calculate All Leases →
              </Button>
            </div>

            {calculating && (
              <div className={`${cardClass} p-4`}>
                <div className="flex justify-between text-sm text-[#475569] mb-2">
                  <span>Calculating lease {calcDone} of {calcTotal}…</span>
                  <span>{progressPct}%</span>
                </div>
                <div className="h-2 bg-[#e2e8f0] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[#f97316] to-[#ef4444] transition-all duration-300"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
            )}
          </>
        )}

        {step === 3 && bulkResult && (
          <>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className={`${cardClass} p-4 flex gap-3 items-center`}>
                <CheckCircle2 className="w-8 h-8 text-green-600" />
                <div>
                  <p className="text-xs text-[#64748b] uppercase font-semibold">Successful</p>
                  <p className="text-xl font-bold text-[#1e293b]">{bulkResult.successful}</p>
                </div>
              </div>
              <div className={`${cardClass} p-4 flex gap-3 items-center`}>
                <XCircle className="w-8 h-8 text-red-500" />
                <div>
                  <p className="text-xs text-[#64748b] uppercase font-semibold">Failed</p>
                  <p className="text-xl font-bold text-[#1e293b]">{bulkResult.failed}</p>
                </div>
              </div>
              <div className={`${cardClass} p-4 flex gap-3 items-center`}>
                <Landmark className="w-8 h-8 text-[#2E86AB]" />
                <div>
                  <p className="text-xs text-[#64748b] uppercase font-semibold">Total Liability</p>
                  <p className="text-lg font-bold text-[#1e293b]">
                    {formatIndianCurrency(bulkResult.portfolio_summary.total_lease_liability)}
                  </p>
                </div>
              </div>
              <div className={`${cardClass} p-4 flex gap-3 items-center`}>
                <Building2 className="w-8 h-8 text-[#f97316]" />
                <div>
                  <p className="text-xs text-[#64748b] uppercase font-semibold">Total ROU Asset</p>
                  <p className="text-lg font-bold text-[#1e293b]">
                    {formatIndianCurrency(bulkResult.portfolio_summary.total_rou_asset)}
                  </p>
                </div>
              </div>
            </div>

            <div className={`${cardClass} p-5`}>
              <h3 className="text-base font-semibold text-[#1e293b] mb-3">Portfolio summary</h3>
              <ul className="text-sm text-[#475569] space-y-1">
                <li>
                  Total lease liability:{' '}
                  <strong>{formatIndianCurrency(bulkResult.portfolio_summary.total_lease_liability)}</strong>
                </li>
                <li>
                  Total ROU asset:{' '}
                  <strong>{formatIndianCurrency(bulkResult.portfolio_summary.total_rou_asset)}</strong>
                </li>
                <li>
                  Average IBR:{' '}
                  <strong>{(bulkResult.portfolio_summary.avg_ibr * 100).toFixed(2)}%</strong>
                </li>
                <li>
                  Currency breakdown:{' '}
                  {Object.entries(bulkResult.portfolio_summary.currency_breakdown)
                    .map(([ccy, n]) => `${ccy}: ${formatIndianNumber(n)} leases`)
                    .join(' · ') || '—'}
                </li>
              </ul>
            </div>

            <div className={`${cardClass} overflow-hidden`}>
              <div className="px-5 py-3 border-b border-[#e2e8f0] font-semibold text-[#1e293b]">Results</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#f8fafc] text-left text-xs font-semibold text-[#64748b] uppercase">
                      <th className="px-3 py-2"> </th>
                      <th className="px-3 py-2">Lease ID</th>
                      <th className="px-3 py-2">Asset</th>
                      <th className="px-3 py-2 text-right">Liability</th>
                      <th className="px-3 py-2 text-right">ROU</th>
                      <th className="px-3 py-2 text-right">Monthly Dep.</th>
                      <th className="px-3 py-2 text-right">IBR%</th>
                      <th className="px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bulkResult.results.map((r) => {
                      const pr = rowByLeaseId.get(r.lease_id);
                      return (
                        <tr key={r.lease_id} className="border-t border-[#f1f5f9]">
                          <td className="px-3 py-2">
                            {r.status === 'success' ? (
                              <span className="text-green-600" title="Success">
                                ●
                              </span>
                            ) : (
                              <span className="text-red-600" title={r.error || 'Error'}>
                                ●
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">{r.lease_id}</td>
                          <td className="px-3 py-2 max-w-[180px] truncate">{pr?.asset_description ?? '—'}</td>
                          <td className="px-3 py-2 text-right font-mono">
                            {formatIndianCurrency(r.lease_liability || 0)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {formatIndianCurrency(r.rou_asset || 0)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {formatIndianCurrency(r.monthly_depreciation || 0)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {pr ? `${(pr.annual_discount_rate * 100).toFixed(2)}%` : '—'}
                          </td>
                          <td className="px-3 py-2 text-xs text-red-600 max-w-[140px] truncate" title={r.error || ''}>
                            {r.status === 'success' ? 'OK' : r.error || 'Error'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={downloadResultsExcel}>
                <Download className="w-4 h-4" />
                Download Results Excel
              </Button>
              <Button variant="primary" onClick={saveAllToRepository}>
                Save All to Repository
              </Button>
              <Button variant="ghost" onClick={resetFlow}>
                Upload Another File
              </Button>
              <Link href="/dashboard/ifrs16/repository" className="inline-flex items-center text-sm text-[#2E86AB] ml-2">
                View repository →
              </Link>
            </div>
          </>
        )}
      </div>
    </SidebarLayout>
  );
}
