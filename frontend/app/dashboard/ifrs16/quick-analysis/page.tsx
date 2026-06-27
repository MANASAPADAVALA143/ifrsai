'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { Upload, Loader2, CheckCircle2, Zap, Copy } from 'lucide-react';
import { SidebarLayout } from '@/components/SidebarLayout';
import { Button } from '@/components/Button';
import { ifrs16Api } from '@/lib/api';
import { saveToLeaseRepository, saveManyToLeaseRepository, buildLeaseEntry } from '@/lib/lease-repository';
import { formatLeaseMoney } from '@/lib/ifrs16-currency';

const cardClass =
  'bg-white rounded-[14px] border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)]';
const MAX_BYTES = 50 * 1024 * 1024;
const CALC_CHUNK = 25;
const HISTORY_KEY = 'quick_analysis_history';
const STEP_DELAYS_MS = [0, 2000, 5000, 8000, 11000, 14000, 17000];
const STEP_LABELS = [
  'Reading lease data…',
  'Calculating lease liabilities…',
  'Computing ROU assets…',
  'Preparing journal entries…',
  'Generating disclosure notes…',
  'Running AI portfolio analysis…',
  'Packaging your complete report…',
];

type Phase = 'upload' | 'preview' | 'loading' | 'results';

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
  /** Present when API returns it; otherwise resolved via /api/calculate + cache */
  excel_file_id?: string | null;
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

type PortfolioLease = {
  id: string;
  asset_description: string;
  monthly_payment: number;
  discount_rate: number;
  lease_term_months: number;
  start_date: string;
  end_date: string;
  currency: string;
  lease_type: string;
  city: string;
  country: string;
  status: string;
  results: {
    lease_liability: number;
    rou_asset: number;
    monthly_depreciation: number;
    total_interest: number;
  };
};

type AiInsight = {
  type: string;
  severity: string;
  title: string;
  description: string;
  action: string;
  calculation?: string;
  lease_id: string | null;
};

type AiAnalysis = {
  health_score: number;
  health_label: string;
  summary: string;
  insights: AiInsight[];
  top_recommendation: string;
};

type HistoryEntry = {
  id: number;
  filename: string;
  lease_count: number;
  date: string;
  summary: {
    total_liability: number;
    total_rou: number;
    successful: number;
    total: number;
  };
  bulk: MergedBulkResponse;
  parsed: ParsedLeaseRow[];
  secondsElapsed: number;
  completedAt: string;
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
  if (Number.isFinite(annual_discount_rate) && annual_discount_rate > 0 && annual_discount_rate < 0.0001) {
    messages.push('annual_discount_rate must be at least 0.01% (0.0001 as decimal)');
    status = 'error';
  }
  if (Number.isFinite(annual_discount_rate) && annual_discount_rate > 1) {
    messages.push('annual_discount_rate must be ≤ 100% as decimal (e.g. 0.085 for 8.5%)');
    status = 'error';
  }

  const rent_free_months = Math.max(0, Math.round(num(o.rent_free_months, 0)));
  const practical_expedient_elected = parseBool(o.practical_expedient_elected);
  const non_lease_component = Math.max(0, num(o.non_lease_component, 0));
  const termEff = lease_term_months > 0 ? lease_term_months : 1;

  if (rent_free_months >= termEff) {
    messages.push('rent_free_months must be less than lease_term_months');
    status = 'error';
  }
  if (
    !practical_expedient_elected &&
    monthly_payment > 0 &&
    non_lease_component >= monthly_payment - 1e-9
  ) {
    messages.push(
      'non_lease_component must be less than monthly_payment (or set practical_expedient_elected to TRUE)'
    );
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
    lease_term_months: termEff,
    monthly_payment: monthly_payment > 0 ? monthly_payment : 0,
    annual_discount_rate: Number.isFinite(annual_discount_rate) ? annual_discount_rate : 0.0001,
    currency: String(o.currency ?? 'INR').trim() || 'INR',
    payment_type: String(o.payment_type ?? 'Arrears').trim() || 'Arrears',
    rent_free_months,
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
    non_lease_component,
    non_lease_description: String(o.non_lease_description ?? ''),
    practical_expedient_elected,
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

  const asset = String(
    getVal(o, ['basic_info', 'asset_description', 'value']) ??
      getVal(o, ['basic_info', 'asset_description']) ??
      o.asset_description ??
      ''
  ).trim();

  const lessee = String(
    getVal(o, ['basic_info', 'lessee_name', 'value']) ??
      getVal(o, ['basic_info', 'lessee_name']) ??
      o.lessee_name ??
      ''
  ).trim();

  const lessor = String(
    getVal(o, ['basic_info', 'lessor_name', 'value']) ??
      getVal(o, ['basic_info', 'lessor_name']) ??
      o.lessor_name ??
      ''
  ).trim();

  let startRaw = String(
    getVal(o, ['dates', 'commencement_date', 'value']) ??
      getVal(o, ['dates', 'commencement_date']) ??
      o.commencement_date ??
      o.start_date ??
      ''
  ).trim();
  const startFromDate = formatCellDate(
    getVal(o, ['dates', 'commencement_date', 'value']) ??
      getVal(o, ['dates', 'commencement_date']) ??
      o.commencement_date ??
      o.start_date
  );
  let commencement_date =
    parseFlexibleDate(startRaw) ||
    parseFlexibleDate(startFromDate) ||
    (/^\d{4}-\d{2}-\d{2}/.test(startRaw) ? startRaw.slice(0, 10) : '');

  if (!commencement_date) {
    messages.push('AI did not return a valid commencement_date — using today');
    commencement_date = new Date().toISOString().slice(0, 10);
  }

  const endRaw = String(
    getVal(o, ['dates', 'end_date', 'value']) ?? getVal(o, ['dates', 'end_date']) ?? o.end_date ?? ''
  ).trim();
  const endNorm =
    parseFlexibleDate(endRaw) ||
    (/^\d{4}-\d{2}-\d{2}/.test(endRaw) ? endRaw.slice(0, 10) : '');

  const termFromExtract = num(
    getVal(o, ['dates', 'lease_term_months', 'value']) ?? getVal(o, ['dates', 'lease_term_months']),
    0
  );

  let lease_term_months = Math.round(termFromExtract);
  if (lease_term_months <= 0 && commencement_date && endNorm) {
    const a = new Date(commencement_date);
    const b = new Date(endNorm);
    if (!Number.isNaN(a.getTime()) && !Number.isNaN(b.getTime())) {
      lease_term_months = Math.max(
        1,
        Math.ceil((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24 * 30.44))
      );
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

  let status: ParsedLeaseRow['status'] = messages.some((m) => m.includes('did not')) ? 'warning' : 'ready';
  if (!asset || monthly <= 0) {
    status = 'error';
    messages.push('Missing required fields from extraction (asset or monthly payment)');
  }
  if (Number.isFinite(dr) && dr > 0 && dr < 0.0001) {
    messages.push('annual_discount_rate must be at least 0.01% (0.0001 as decimal)');
    status = 'error';
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
    commencement_date,
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

function inferAssetType(asset: string): string {
  const a = (asset || '').toLowerCase();
  if (a.includes('warehouse')) return 'Warehouse';
  if (a.includes('data centre') || a.includes('datacenter') || a.includes('data center'))
    return 'Data Centre';
  if (a.includes('office')) return 'Office';
  if (a.includes('vehicle') || a.includes('car')) return 'Vehicle';
  if (a.includes('equipment') || a.includes('machine') || a.includes('server')) return 'Equipment';
  if (a.includes('land')) return 'Land';
  if (a.includes('retail') || a.includes('store')) return 'Retail';
  if (a.includes('building') || a.includes('site')) return 'Building';
  return 'Other';
}

function assetEmoji(asset: string): string {
  const a = (asset || '').toLowerCase();
  if (a.includes('warehouse')) return '🏭';
  if (a.includes('vehicle') || a.includes('car') || a.includes('auto')) return '🚗';
  if (
    a.includes('data centre') ||
    a.includes('datacenter') ||
    a.includes('data center') ||
    a.includes('server') ||
    a.includes('equipment')
  )
    return '🖥️';
  if (a.includes('office') || a.includes('building')) return '🏢';
  return '📋';
}

function assetTitleSubtitle(asset: string, fallbackSub: string): { title: string; sub: string } {
  const t = (asset || '').trim();
  const i = t.indexOf(',');
  if (i > 0) {
    return { title: t.slice(0, i).trim() || t, sub: t.slice(i + 1).trim() || fallbackSub };
  }
  return { title: t || 'Lease', sub: fallbackSub || '—' };
}

/** Left border on lease card by concentration (% of portfolio). */
function concentrationBorderClass(pct: number): string {
  if (pct > 40) return 'border-l-4 border-red-500';
  if (pct >= 20) return 'border-l-4 border-amber-400';
  return 'border-l-4 border-green-500';
}

function healthGaugeColor(score: number): { ring: string; label: string } {
  const s = Math.min(100, Math.max(0, Math.round(score)));
  if (s >= 80) return { ring: '#22c55e', label: 'text-green-700' };
  if (s >= 50) return { ring: '#f59e0b', label: 'text-amber-700' };
  return { ring: '#ef4444', label: 'text-red-700' };
}

function insightTypeBadgeClass(type: string): string {
  const t = type.toLowerCase();
  if (t === 'risk') return 'bg-red-100 text-red-700';
  if (t === 'renewal') return 'bg-amber-100 text-amber-700';
  if (t === 'opportunity') return 'bg-blue-100 text-blue-700';
  if (t === 'efficiency') return 'bg-green-100 text-green-700';
  return 'bg-gray-100 text-gray-700';
}

function insightCardTypeBorderClass(type: string): string {
  const t = type.toLowerCase();
  if (t === 'risk') return 'border-l-4 border-red-500';
  if (t === 'renewal') return 'border-l-4 border-amber-400';
  if (t === 'opportunity') return 'border-l-4 border-blue-500';
  if (t === 'efficiency') return 'border-l-4 border-green-500';
  return 'border-l-4 border-gray-300';
}

function severityDotLabel(sev: string): string {
  const s = sev.toLowerCase();
  if (s === 'high') return '🔴';
  if (s === 'medium') return '🟡';
  return '🟢';
}

type JournalLineForUi = {
  date: string;
  description: string;
  entryType: 'Debit' | 'Credit';
  amount: number;
  isDr: boolean;
};

function journalRowsToLineItems(flat: JournalFlatRow[]): JournalLineForUi[] {
  const out: JournalLineForUi[] = [];
  for (const jr of flat) {
    const desc = [jr.narration, jr.account, jr.section].filter(Boolean).join(' — ') || '—';
    if (jr.dr > 0) {
      out.push({
        date: jr.date,
        description: desc,
        entryType: 'Debit',
        amount: jr.dr,
        isDr: true,
      });
    }
    if (jr.cr > 0) {
      out.push({
        date: jr.date,
        description: desc,
        entryType: 'Credit',
        amount: jr.cr,
        isDr: false,
      });
    }
  }
  return out;
}

function pctBarBg(pct: number): string {
  if (pct > 40) return 'bg-red-500';
  if (pct >= 20) return 'bg-amber-500';
  return 'bg-emerald-500';
}

function getAmortizationSchedule(calc: Record<string, unknown> | null | undefined): Record<string, unknown>[] {
  const raw = calc?.amortization_schedule;
  return Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
}

type JournalFlatRow = {
  date: string;
  section: string;
  narration: string;
  account: string;
  dr: number;
  cr: number;
};

function flattenJournalEntries(je: unknown): JournalFlatRow[] {
  if (je == null || typeof je !== 'object') return [];
  const o = je as Record<string, unknown>;
  const out: JournalFlatRow[] = [];
  const sections = ['initial_recognition', 'monthly_depreciation', 'monthly_payment_example'] as const;
  for (const key of sections) {
    const block = o[key];
    if (block == null || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    const date = String(b.date ?? b.frequency ?? '—');
    const desc = String(b.description ?? key);
    const entries = b.entries;
    if (!Array.isArray(entries)) continue;
    for (const ent of entries) {
      if (ent == null || typeof ent !== 'object') continue;
      const e = ent as Record<string, unknown>;
      const dr = Number(e.dr ?? 0) || 0;
      const cr = Number(e.cr ?? 0) || 0;
      out.push({
        date,
        section: desc,
        narration: String(e.narration ?? ''),
        account: String(e.account ?? '—'),
        dr,
        cr,
      });
    }
  }
  return out;
}

function getDisclosureNotesText(calc: Record<string, unknown> | null | undefined): string {
  if (!calc) return '';
  const dn = calc.disclosure_notes;
  if (typeof dn === 'string' && dn.trim()) return dn.trim();
  const parts: string[] = [];
  for (const k of ['idc_disclosure_note', 'rvg_disclosure_note', 'incentive_disclosure_note'] as const) {
    const v = calc[k];
    if (typeof v === 'string' && v.trim()) parts.push(v.trim());
  }
  return parts.join('\n\n');
}

type DetailTab = 'amort' | 'journal' | 'metrics';

function leaseEndDate(start: string, termMonths: number): string {
  const d = new Date(start);
  if (Number.isNaN(d.getTime())) return '';
  d.setMonth(d.getMonth() + termMonths);
  return d.toISOString().slice(0, 10);
}

function getCurrencySymbol(currency?: string): string {
  switch ((currency || 'INR').toUpperCase()) {
    case 'AED':
      return 'AED ';
    case 'GBP':
      return '£';
    case 'USD':
      return '$';
    case 'EUR':
      return '€';
    case 'AUD':
      return 'A$';
    case 'SGD':
      return 'S$';
    case 'INR':
    default:
      return '₹';
  }
}

function formatIbrPct(rate: number): string {
  const r = rate || 0;
  const pct = r <= 1 ? r * 100 : r;
  return `${pct.toFixed(2)}%`;
}

function CalculationAssumptionsQuick({
  pr,
  symbol,
}: {
  pr?: ParsedLeaseRow | null;
  symbol: string;
}) {
  const r = pr?.annual_discount_rate ?? 0;
  const ibrAnnual = r <= 1 ? r * 100 : r;
  const monthlyEquiv = ibrAnnual / 12;
  const ptRaw = String(pr?.payment_type || 'Arrears').trim();
  const isAdvance = ptRaw.toLowerCase().includes('advance');
  const paymentTimingLabel = isAdvance
    ? `${ptRaw || 'Advance'} (beginning of period)`
    : `${ptRaw || 'Arrears'} (end of period)`;
  const leaseTermMonths = pr?.lease_term_months ?? 0;
  const nonLease = pr?.non_lease_component ?? 0;
  const rentFreeMonths = pr?.rent_free_months ?? 0;
  const cpiBase = pr?.cpi_index_base ?? 0;
  const cpiCurrent = pr?.cpi_index_current ?? 0;
  const cpiFreq = pr?.cpi_adjustment_frequency_months ?? 12;
  const cpiStepPct =
    cpiBase > 0 ? ((cpiCurrent / cpiBase - 1) * 100).toFixed(1) : '0.0';

  return (
    <div className="mt-4 p-4 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-600">
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-gray-400">⚙</span>
        <span className="font-semibold text-gray-700 uppercase tracking-wide text-xs">
          Calculation Assumptions
        </span>
        <span className="ml-auto text-xs text-blue-500 font-medium">IFRS 16 §26</span>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
        <div className="flex justify-between gap-2">
          <span className="text-gray-500">Discount rate (IBR)</span>
          <span className="font-medium text-gray-800 text-right shrink-0">
            {ibrAnnual.toFixed(2)}% (monthly: {monthlyEquiv.toFixed(4)}%)
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-gray-500">Payment timing</span>
          <span className="font-medium text-gray-800 text-right">{paymentTimingLabel}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-gray-500">Lease term</span>
          <span className="font-medium text-gray-800 text-right">{leaseTermMonths} months</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-gray-500">Depreciation method</span>
          <span className="font-medium text-gray-800 text-right">Straight-line over lease term</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-gray-500">PV method</span>
          <span className="font-medium text-gray-800 text-right">Effective interest method</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-gray-500">Ownership transfer</span>
          <span className="font-medium text-gray-800 text-right">Not assumed</span>
        </div>
        {nonLease > 0 && (
          <div className="flex justify-between col-span-2 gap-2">
            <span className="text-gray-500">Non-lease component</span>
            <span className="font-medium text-gray-800 text-right">
              {symbol}
              {(nonLease || 0).toLocaleString('en-IN')} /month excluded from PV
            </span>
          </div>
        )}
        {rentFreeMonths > 0 && (
          <div className="flex justify-between col-span-2 gap-2">
            <span className="text-gray-500">Rent-free period</span>
            <span className="font-medium text-gray-800 text-right">
              {rentFreeMonths} months ({symbol}0 payment, interest accrues)
            </span>
          </div>
        )}
        {cpiBase > 0 && (
          <div className="flex justify-between col-span-2 gap-2">
            <span className="text-gray-500">CPI adjustment</span>
            <span className="font-medium text-gray-800 text-right">
              Index {cpiBase} → {cpiCurrent} (+{cpiStepPct}% step-up at month {cpiFreq})
            </span>
          </div>
        )}
      </div>
      {(() => {
        const totalPayment = Number(pr?.monthly_payment) || 0;
        const nonLeaseComp = Number(pr?.non_lease_component) || 0;
        const rentFree = Number(pr?.rent_free_months) || 0;
        const netPayment = Math.max(0, totalPayment - nonLeaseComp);
        if (nonLeaseComp > 0 || rentFree > 0) {
          return (
            <div className="mt-3 pt-3 border-t border-gray-200">
              <div className="text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">
                Payment Used for PV Calculation
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-xs gap-2">
                  <span className="text-gray-500">Total monthly payment</span>
                  <span className="font-medium shrink-0">
                    {symbol}
                    {totalPayment.toLocaleString('en-IN')}
                  </span>
                </div>
                {nonLeaseComp > 0 ? (
                  <div className="flex justify-between text-xs gap-2">
                    <span className="text-gray-500">Less: Non-lease component (IFRS 16 §12)</span>
                    <span className="font-medium text-red-600 shrink-0">
                      −{symbol}
                      {nonLeaseComp.toLocaleString('en-IN')}
                    </span>
                  </div>
                ) : null}
                <div className="flex justify-between text-xs border-t border-gray-300 pt-1 mt-1 gap-2">
                  <span className="font-semibold text-gray-700">Net lease payment for PV</span>
                  <span className="font-bold text-green-700 shrink-0">
                    {symbol}
                    {netPayment.toLocaleString('en-IN')}
                  </span>
                </div>
                {rentFree > 0 ? (
                  <div className="text-xs text-amber-600 mt-1 italic">
                    ⚠ Months 1–{rentFree}: {symbol}0 payment (rent-free — interest accrues only)
                  </div>
                ) : null}
              </div>
            </div>
          );
        }
        return (
          <div className="mt-3 pt-3 border-t border-gray-200">
            <div className="text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">
              Payment Used for PV Calculation
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-xs">
              <span className="text-gray-500">
                Full contract payment is used for PV (no non-lease exclusion; no rent-free period in inputs).
              </span>
              <span className="font-bold text-gray-900 shrink-0 tabular-nums">
                {symbol}
                {totalPayment.toLocaleString('en-IN')}
                <span className="font-normal text-gray-500"> /mo</span>
              </span>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function readHistory(): HistoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const p = JSON.parse(raw) as HistoryEntry[];
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

function writeHistory(entries: HistoryEntry[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, 5)));
}

function parseClaudeJson(text: string): AiAnalysis {
  let s = text.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  }
  const raw = JSON.parse(s) as Record<string, unknown>;
  const score = Math.min(100, Math.max(0, Math.round(Number(raw.health_score) || 0)));
  const insights = Array.isArray(raw.insights) ? (raw.insights as AiInsight[]) : [];
  return {
    health_score: score,
    health_label: String(raw.health_label ?? ''),
    summary: String(raw.summary ?? ''),
    top_recommendation: String(raw.top_recommendation ?? ''),
    insights,
  };
}

function toPortfolioLeases(parsed: ParsedLeaseRow[], bulk: MergedBulkResponse): PortfolioLease[] {
  const ok = new Set(bulk.results.filter((r) => r.status === 'success').map((r) => r.lease_id));
  return parsed
    .filter((p) => p.status !== 'error' && ok.has(p.lease_id))
    .map((p) => {
      const br = bulk.results.find((r) => r.lease_id === p.lease_id && r.status === 'success');
      const ll = br?.lease_liability ?? 0;
      const rou = br?.rou_asset ?? 0;
      const end = leaseEndDate(p.commencement_date, p.lease_term_months);
      return {
        id: p.lease_id,
        asset_description: p.asset_description,
        monthly_payment: p.monthly_payment,
        discount_rate: p.annual_discount_rate,
        lease_term_months: p.lease_term_months,
        start_date: p.commencement_date,
        end_date: end,
        currency: p.currency,
        lease_type: inferAssetType(p.asset_description),
        city: '',
        country: '',
        status: 'Active',
        results: {
          lease_liability: ll,
          rou_asset: rou,
          monthly_depreciation: br?.monthly_depreciation ?? 0,
          total_interest: br?.total_interest ?? 0,
        },
      };
    });
}

export default function QuickAnalysisPage() {
  const router = useRouter();
  const excelIdCacheRef = useRef<Map<string, string>>(new Map());

  const [phase, setPhase] = useState<Phase>('upload');
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState(0);
  const [parsedRows, setParsedRows] = useState<ParsedLeaseRow[]>([]);
  const [bulkResult, setBulkResult] = useState<MergedBulkResponse | null>(null);
  const [secondsElapsed, setSecondsElapsed] = useState(0);
  const [completedAt, setCompletedAt] = useState<string>('');
  const [checkSteps, setCheckSteps] = useState<boolean[]>(() => Array(7).fill(false));
  const [progress, setProgress] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [tableExpanded, setTableExpanded] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<AiAnalysis | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [explainOpen, setExplainOpen] = useState(false);
  const [explainLoading, setExplainLoading] = useState(false);
  const [explainText, setExplainText] = useState('');
  const skipSaveHistoryRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [leaseDetailOpen, setLeaseDetailOpen] = useState<Record<string, boolean>>({});
  const [leaseDetailTab, setLeaseDetailTab] = useState<Record<string, DetailTab>>({});
  const [amortShowAllByLease, setAmortShowAllByLease] = useState<Record<string, boolean>>({});
  const [disclosureOpenByLease, setDisclosureOpenByLease] = useState<Record<string, boolean>>({});
  const [downloadingLeaseId, setDownloadingLeaseId] = useState<string | null>(null);
  const [savedLeaseDataThisSession, setSavedLeaseDataThisSession] = useState(false);
  const [showTrace, setShowTrace] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setHistory(readHistory());
  }, [phase]);

  const readyRows = useMemo(() => parsedRows.filter((r) => r.status !== 'error'), [parsedRows]);

  const previewStats = useMemo(() => {
    const currencies = [...new Set(readyRows.map((r) => r.currency || 'INR'))];
    const dates = readyRows.map((r) => new Date(r.commencement_date).getTime()).filter((t) => !Number.isNaN(t));
    const minT = dates.length ? Math.min(...dates) : null;
    const maxEnds = readyRows.map((r) => new Date(leaseEndDate(r.commencement_date, r.lease_term_months)).getTime());
    const maxT = maxEnds.filter((t) => !Number.isNaN(t));
    const maxEnd = maxT.length ? Math.max(...maxT) : null;
    const types = [...new Set(readyRows.map((r) => inferAssetType(r.asset_description)))];
    return {
      currency: currencies.length === 1 ? currencies[0] : currencies.join(', '),
      dateRange:
        minT != null && maxEnd != null
          ? `${new Date(minT).getFullYear()}–${new Date(maxEnd).getFullYear()}`
          : '—',
      assetTypes: types.join(', ') || '—',
      count: readyRows.length,
    };
  }, [readyRows]);

  const parseExcelCsv = useCallback(async (file: File) => {
    const XLSX = await import('xlsx');
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) {
      toast.error('No sheet found');
      return;
    }
    const matrix = XLSX.utils.sheet_to_json<string[]>(sheet, {
      header: 1,
      defval: '',
      raw: false,
    }) as string[][];
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
    setPhase('preview');
    toast.success('Lease data loaded');
  }, []);

  const processPdf = useCallback(async (file: File) => {
    const base = file.name.replace(/\.[^.]+$/, '') || 'lease';
    const { data, error } = await ifrs16Api.uploadContract(file);
    if (error || !data) {
      toast.error(String(error || 'Extraction failed'));
      return;
    }
    const raw = (data as { extracted_data?: unknown }).extracted_data ?? data;
    const row = extractionToParsedRow(raw, base, 1);
    setParsedRows([row]);
    setFileName(file.name);
    setFileSize(file.size);
    setPhase('preview');
    toast.success('Lease data loaded');
  }, []);

  const onFileChosen = async (files: FileList | null) => {
    if (!files?.length) return;
    const file = files[0];
    if (file.size > MAX_BYTES) {
      toast.error('File must be under 50MB');
      return;
    }
    const ext = file.name.toLowerCase();
    try {
      if (ext.endsWith('.pdf')) {
        await processPdf(file);
        return;
      }
      if (ext.endsWith('.xlsx') || ext.endsWith('.xls') || ext.endsWith('.csv')) {
        await parseExcelCsv(file);
        return;
      }
      toast.error('Use Excel, CSV, or PDF');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not read file');
    }
  };

  const resetToUpload = () => {
    setPhase('upload');
    setFileName(null);
    setFileSize(0);
    setParsedRows([]);
    setBulkResult(null);
    setAiAnalysis(null);
    setAiError(null);
    setExplainText('');
    setExplainOpen(false);
    setTableExpanded(false);
    setProgress(0);
    setCheckSteps(Array(7).fill(false));
    skipSaveHistoryRef.current = false;
    excelIdCacheRef.current.clear();
    setLeaseDetailOpen({});
    setLeaseDetailTab({});
    setAmortShowAllByLease({});
    setDisclosureOpenByLease({});
    setDownloadingLeaseId(null);
    setSavedLeaseDataThisSession(false);
    setShowTrace({});
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const loadFromHistory = (h: HistoryEntry) => {
    skipSaveHistoryRef.current = true;
    setFileName(h.filename);
    setParsedRows(h.parsed);
    setBulkResult(h.bulk);
    setSecondsElapsed(h.secondsElapsed);
    setCompletedAt(h.completedAt);
    setPhase('results');
    setAiAnalysis(null);
    setAiError(null);
    setSavedLeaseDataThisSession(false);
    setShowTrace({});
    toast.success('Opened saved analysis');
  };

  const runBulkCalc = async (): Promise<MergedBulkResponse> => {
    const toSend = readyRows.map(parsedRowToLeaseRequest);
    if (toSend.length === 0) throw new Error('No valid leases to generate');
    const chunks: typeof toSend[] = [];
    for (let i = 0; i < toSend.length; i += CALC_CHUNK) {
      chunks.push(toSend.slice(i, i + CALC_CHUNK));
    }
    const parts: MergedBulkResponse[] = [];
    for (const c of chunks) {
      const { data, error } = await ifrs16Api.bulkCalculate(c);
      if (error || !data) throw new Error(error || 'Generate failed');
      parts.push(data as MergedBulkResponse);
    }
    return mergeSummaries(parts);
  };

  const saveHistoryEntry = (merged: MergedBulkResponse, elapsed: number) => {
    if (skipSaveHistoryRef.current) return;
    if (!fileName) return;
    const entry: HistoryEntry = {
      id: Date.now(),
      filename: fileName,
      lease_count: merged.total,
      date: new Date().toISOString(),
      summary: {
        total_liability: merged.portfolio_summary.total_lease_liability,
        total_rou: merged.portfolio_summary.total_rou_asset,
        successful: merged.successful,
        total: merged.total,
      },
      bulk: merged,
      parsed: parsedRows,
      secondsElapsed: elapsed,
      completedAt: new Date().toISOString(),
    };
    const next = [entry, ...readHistory()].slice(0, 5);
    writeHistory(next);
    setHistory(next);
  };

  const onGenerate = async () => {
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    let progressIv: ReturnType<typeof setInterval> | undefined;
    setPhase('loading');
    setShowTrace({});
    setCheckSteps(Array(7).fill(false));
    setProgress(5);
    STEP_DELAYS_MS.forEach((delay, i) => {
      timeouts.push(
        setTimeout(() => {
          setCheckSteps((prev) => {
            const n = [...prev];
            n[i] = true;
            return n;
          });
        }, delay)
      );
    });
    progressIv = setInterval(() => {
      setProgress((p) => Math.min(p + 3, 92));
    }, 450);

    const started = Date.now();
    try {
      const merged = await runBulkCalc();
      setProgress(100);
      const elapsed = Math.max(1, Math.round((Date.now() - started) / 1000));
      setSecondsElapsed(elapsed);
      setCompletedAt(new Date().toLocaleString('en-IN'));
      setBulkResult(merged);
      saveHistoryEntry(merged, elapsed);
      try {
        const toSave: ReturnType<typeof buildLeaseEntry>[] = [];
        for (const r of merged.results) {
          if (r.status !== 'success') continue;
          const pr = parsedRows.find((p) => p.lease_id === r.lease_id);
          if (!pr) continue;
          const results = (r.calculation_results || {
            lease_liability: r.lease_liability,
            rou_asset: r.rou_asset,
            monthly_depreciation: r.monthly_depreciation,
            total_interest: r.total_interest,
          }) as Record<string, unknown>;
          toSave.push(
            buildLeaseEntry({
              lease_id: r.lease_id,
              asset_description: pr.asset_description ?? r.lease_id,
              commencement_date: pr.commencement_date ?? '',
              lease_term_months: pr.lease_term_months ?? 12,
              monthly_payment: pr.monthly_payment ?? 0,
              currency: pr.currency ?? 'AED',
              lessee_name: pr.lessee_name,
              lessor_name: pr.lessor_name,
              discount_rate: pr ? pr.annual_discount_rate * 100 : undefined,
              results,
              excel_file_id: r.excel_file_id ?? undefined,
              status: 'Calculated',
            })
          );
        }
        if (toSave.length > 0) {
          saveManyToLeaseRepository(toSave);
          toast.success(`${toSave.length} lease${toSave.length === 1 ? '' : 's'} auto-saved to repository`, {
            duration: 2000,
          });
        }
      } catch (e) {
        console.log('Auto-save skipped:', e);
      }
      setShowTrace({});
      setPhase('results');
      setTableExpanded(false);
      if (merged.successful > 0) {
        toast.success('Your IFRS 16 pack is ready');
      } else {
        const firstErr = merged.results.find((r) => r.status === 'error')?.error;
        const hint = firstErr
          ? String(firstErr).slice(0, 220)
          : 'Check uploaded columns (e.g. non-lease amount vs rent, commencement YYYY-MM-DD, IBR as percent or decimal).';
        toast.error(`No leases calculated — ${hint}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Generate failed');
      setPhase('preview');
    } finally {
      timeouts.forEach(clearTimeout);
      if (progressIv) clearInterval(progressIv);
    }
  };

  useEffect(() => {
    if (phase !== 'results' || !bulkResult) return;
    const leases = toPortfolioLeases(parsedRows, bulkResult);
    if (leases.length === 0) {
      setAiAnalysis(null);
      setAiError('No successful leases for Portfolio Insights.');
      return;
    }
    let cancelled = false;
    setAiLoading(true);
    setAiError(null);
    setAiAnalysis(null);
    const leasePayload = leases.map((l) => ({
      id: l.id,
      asset: l.asset_description,
      monthly_payment: l.monthly_payment ?? 0,
      lease_liability: l.results?.lease_liability ?? 0,
      ibr: l.discount_rate,
      term_months: l.lease_term_months,
      end_date: l.end_date,
      lease_type: l.lease_type,
      city: l.city,
      currency: l.currency,
    }));
    const todayIso = new Date().toISOString().split('T')[0];
    void (async () => {
      try {
        const response = await fetch('/api/cfo-strategic-insights', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leases: leasePayload, today: todayIso }),
        });
        const raw = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error((raw as { error?: string }).error || `Request failed (${response.status})`);
        }
        const text = (raw as { text?: string }).text;
        if (!text) throw new Error('Empty response');
        if (cancelled) return;
        setAiAnalysis(parseClaudeJson(text));
      } catch (err) {
        if (!cancelled) {
          setAiError(err instanceof Error ? err.message : 'Portfolio Insights unavailable');
        }
      } finally {
        if (!cancelled) setAiLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phase, bulkResult, parsedRows]);

  const rowByLeaseId = useMemo(() => new Map(parsedRows.map((r) => [r.lease_id, r])), [parsedRows]);

  const breakdownRows = useMemo(() => {
    if (!bulkResult) return [];
    const totalL = bulkResult.portfolio_summary.total_lease_liability || 0;
    return bulkResult.results
      .filter((r) => r.status === 'success')
      .map((r) => {
        const pr = rowByLeaseId.get(r.lease_id);
        const ll = r.lease_liability || 0;
        const pct = totalL > 0 ? (ll / totalL) * 100 : 0;
        return { r, pr, ll, pct };
      })
      .sort((a, b) => b.ll - a.ll);
  }, [bulkResult, rowByLeaseId]);

  /** Distinct backend error strings when status === 'error' (explains 0 / N processed). */
  const bulkFailureMessages = useMemo(() => {
    if (!bulkResult) return [];
    const lines: string[] = [];
    const seen = new Set<string>();
    for (const r of bulkResult.results) {
      if (r.status !== 'error') continue;
      const msg = String(r.error ?? '').trim() || 'Unknown error';
      if (seen.has(msg)) continue;
      seen.add(msg);
      lines.push(msg);
      if (lines.length >= 8) break;
    }
    return lines;
  }, [bulkResult]);

  const portfolioCurrency = useMemo(() => {
    const first = bulkResult?.results?.find((r) => r.status === 'success');
    const fromApi =
      first && typeof (first as { currency?: string }).currency === 'string'
        ? String((first as { currency?: string }).currency).trim()
        : '';
    if (fromApi) return fromApi.toUpperCase();
    if (first) {
      const pr = parsedRows.find((p) => p.lease_id === first.lease_id);
      if (pr?.currency) return String(pr.currency).toUpperCase();
    }
    return String(parsedRows[0]?.currency || 'INR').toUpperCase();
  }, [bulkResult, parsedRows]);

  const symbol = getCurrencySymbol(portfolioCurrency);

  const formatAmount = useCallback(
    (value: number, currency?: string) => {
      const cur = currency || portfolioCurrency;
      const v = Number(value) || 0;
      const ccy = String(cur).toUpperCase();
      if (ccy === 'INR') {
        const av = Math.abs(v);
        if (av >= 10_000_000) return `₹${(v / 10_000_000).toFixed(2)}Cr`;
        if (av >= 100_000) return `₹${(v / 100_000).toFixed(2)}L`;
        return `₹${v.toLocaleString('en-IN')}`;
      }
      return formatLeaseMoney(v, cur, 0);
    },
    [portfolioCurrency]
  );

  const onExplainPortfolio = async () => {
    if (!bulkResult) return;
    const totalL = bulkResult.portfolio_summary.total_lease_liability || 0;
    const types = [...new Set(readyRows.map((r) => inferAssetType(r.asset_description)))];
    const prompt = `In exactly 3 short sentences, plain English, no accounting jargon, explain this lease portfolio for an executive: 
${readyRows.length} leases, total liability about ${formatAmount(totalL)}, asset types: ${types.join(', ')}. 
Do not use bullet points.`;
    setExplainLoading(true);
    setExplainOpen(true);
    setExplainText('');
    try {
      const response = await fetch('/api/cfo-strategic-insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const raw = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((raw as { error?: string }).error || 'Request failed');
      }
      const text = (raw as { text?: string }).text?.trim() || '';
      setExplainText(text || 'No explanation returned.');
      toast.success('Explanation ready');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
      setExplainText('');
    } finally {
      setExplainLoading(false);
    }
  };

  const totalCashOutflow = useMemo(
    () => readyRows.reduce((s, r) => s + (r.monthly_payment || 0), 0),
    [readyRows]
  );

  const resolveExcelFileId = async (br: BulkResultRow): Promise<string | null> => {
    const fromApi = br.excel_file_id?.trim();
    if (fromApi) return fromApi;
    const cached = excelIdCacheRef.current.get(br.lease_id);
    if (cached) return cached;
    const pr = rowByLeaseId.get(br.lease_id);
    if (!pr) return null;
    const { data, error } = await ifrs16Api.calculate(parsedRowToLeaseRequest(pr));
    if (error || !data) return null;
    const fid = (data as { excel_file_id?: string }).excel_file_id?.trim() ?? null;
    if (fid) excelIdCacheRef.current.set(br.lease_id, fid);
    return fid;
  };

  const downloadPack = async () => {
    if (!bulkResult) return;
    const successes = bulkResult.results.filter((r) => r.status === 'success');
    if (successes.length === 0) {
      toast.error('No successful leases to download');
      return;
    }
    const t = toast.loading(`Building ${successes.length} IFRS 16 workbooks…`);
    try {
      const payloads = successes.map((br) => {
        const cr =
          br.calculation_results &&
          typeof br.calculation_results === 'object' &&
          Object.keys(br.calculation_results as object).length > 0
            ? (br.calculation_results as Record<string, unknown>)
            : {
                lease_liability: br.lease_liability,
                rou_asset: br.rou_asset,
                monthly_depreciation: br.monthly_depreciation,
                total_interest: br.total_interest,
              };
        return { lease_id: br.lease_id, calculation_results: cr };
      });
      const { blob, exportedCount, requestedCount } = await ifrs16Api.exportAllLeaseWorkbooksZip(payloads);
      const objUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objUrl;
      link.download = `IFRS16_All_Leases_${exportedCount}_${new Date().toISOString().slice(0, 10)}.zip`;
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(objUrl);
      const msg =
        exportedCount === requestedCount
          ? `Downloaded ZIP with ${exportedCount} full workbook(s)`
          : `Downloaded ${exportedCount} of ${requestedCount} workbooks — see _export_manifest.txt in ZIP for skips`;
      toast.success(msg, { id: t });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Download failed', { id: t });
    }
  };

  const saveAllToLeaseData = () => {
    if (!bulkResult) return;
    let n = 0;
    for (const r of bulkResult.results) {
      if (r.status !== 'success') continue;
      const pr = rowByLeaseId.get(r.lease_id);
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
        excel_file_id: r.excel_file_id ?? undefined,
        status: 'Calculated',
      });
      saveToLeaseRepository(entry);
      n++;
    }
    if (n === 0) {
      toast.error('No leases to save');
      return;
    }
    setSavedLeaseDataThisSession(true);
    toast.success(`✅ ${n} leases saved successfully`);
    setTimeout(() => {
      router.push('/dashboard/ifrs16');
    }, 1000);
  };

  const goToLeaseDataAfterSave = () => {
    if (!savedLeaseDataThisSession) {
      toast.error('Save lease data first, then open the overview.');
      return;
    }
    router.push('/dashboard/ifrs16');
  };

  const previewFive = readyRows.slice(0, 5);
  const moreCount = Math.max(0, readyRows.length - 5);

  return (
    <SidebarLayout
      pageTitle="Quick Analysis"
      pageSubtitle="Upload lease data — generate a full IFRS 16 report pack in one flow"
    >
      <div className="w-full max-w-6xl mx-auto space-y-8 pb-16 px-0 sm:px-1">
        {phase === 'upload' && (
          <>
            <div className="text-center space-y-3 px-2">
              <h2 className="text-3xl sm:text-4xl font-bold text-[#0f172a] tracking-tight">
                IFRS 16 AI Engine
              </h2>
              <p className="text-[#64748b] text-base sm:text-lg max-w-xl mx-auto">
                Convert your lease data into a complete IFRS 16 report pack instantly
              </p>
            </div>

            <div
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
              }}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-[#cbd5e1] rounded-2xl p-10 sm:p-14 text-center cursor-pointer bg-white hover:border-[#f97316] hover:bg-orange-50/30 transition-colors"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv,.pdf"
                className="hidden"
                onChange={(e) => void onFileChosen(e.target.files)}
              />
              <Upload className="w-12 h-12 sm:w-14 sm:h-14 mx-auto text-[#f97316] mb-4" strokeWidth={1.25} />
              <p className="text-lg font-semibold text-[#1e293b]">Drag and drop your lease file here</p>
              <p className="text-sm text-[#64748b] mt-1">or click to browse</p>
              <div className="flex flex-wrap justify-center gap-2 mt-6">
                <span className="px-3 py-1 rounded-full bg-slate-100 text-xs font-medium text-[#475569]">
                  📊 Excel
                </span>
                <span className="px-3 py-1 rounded-full bg-slate-100 text-xs font-medium text-[#475569]">
                  📄 CSV
                </span>
                <span className="px-3 py-1 rounded-full bg-slate-100 text-xs font-medium text-[#475569]">
                  📑 PDF
                </span>
              </div>
              {fileName ? (
                <p className="mt-4 text-sm text-[#334155]">
                  {fileName} ({(fileSize / 1024).toFixed(1)} KB)
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap justify-center gap-3">
              {['No manual calculations required', 'AI-powered insights included', 'Full IFRS 16 pack in 60 seconds'].map(
                (t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-800 text-xs sm:text-sm font-medium border border-emerald-100"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    {t}
                  </span>
                )
              )}
            </div>

            {history.length > 0 && (
              <div className={cardClass + ' overflow-hidden'}>
                <div className="px-4 py-3 border-b border-[#e2e8f0] bg-slate-50/80">
                  <h3 className="text-sm font-semibold text-[#334155]">Recent Analyses</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[#64748b] border-b border-[#e2e8f0]">
                        <th className="px-4 py-2 font-medium">File Name</th>
                        <th className="px-4 py-2 font-medium">Leases</th>
                        <th className="px-4 py-2 font-medium">Date</th>
                        <th className="px-4 py-2 font-medium">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((h) => (
                        <tr key={h.id} className="border-b border-[#f1f5f9]">
                          <td className="px-4 py-2 text-[#1e293b] truncate max-w-[140px] sm:max-w-xs">
                            {h.filename}
                          </td>
                          <td className="px-4 py-2">{h.lease_count}</td>
                          <td className="px-4 py-2 text-[#64748b]">{formatDateShort(h.date)}</td>
                          <td className="px-4 py-2">
                            <button
                              type="button"
                              onClick={() => loadFromHistory(h)}
                              className="text-[#f97316] font-semibold hover:underline text-xs sm:text-sm"
                            >
                              View Results
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {phase === 'preview' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <p className="text-emerald-700 font-semibold flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5" />
              File uploaded successfully
            </p>
            <div className={cardClass + ' p-6 space-y-3'}>
              <p className="text-sm font-semibold text-[#334155]">Detected</p>
              <ul className="grid sm:grid-cols-2 gap-3 text-sm">
                <li className="flex justify-between gap-2 border-b border-[#f1f5f9] pb-2">
                  <span className="text-[#64748b]">Leases found</span>
                  <span className="font-semibold text-[#0f172a]">{previewStats.count}</span>
                </li>
                <li className="flex justify-between gap-2 border-b border-[#f1f5f9] pb-2">
                  <span className="text-[#64748b]">Currency</span>
                  <span className="font-semibold text-[#0f172a]">{previewStats.currency}</span>
                </li>
                <li className="flex justify-between gap-2 border-b border-[#f1f5f9] pb-2 sm:col-span-2">
                  <span className="text-[#64748b]">Date range</span>
                  <span className="font-semibold text-[#0f172a]">{previewStats.dateRange}</span>
                </li>
                <li className="flex justify-between gap-2 sm:col-span-2">
                  <span className="text-[#64748b]">Asset types</span>
                  <span className="font-semibold text-[#0f172a] text-right">{previewStats.assetTypes}</span>
                </li>
              </ul>
            </div>

            <div className={cardClass + ' overflow-x-auto'}>
              <table className="w-full text-sm min-w-[520px]">
                <thead>
                  <tr className="text-left text-[#64748b] border-b border-[#e2e8f0]">
                    <th className="px-4 py-2">Lease ID</th>
                    <th className="px-4 py-2">Asset</th>
                    <th className="px-4 py-2 text-right">Cash Outflow</th>
                    <th className="px-4 py-2 text-right">Term</th>
                    <th className="px-4 py-2 text-right">IBR%</th>
                  </tr>
                </thead>
                <tbody>
                  {previewFive.map((r) => (
                    <tr key={r.lease_id} className="border-b border-[#f8fafc]">
                      <td className="px-4 py-2 font-mono text-xs">{r.lease_id}</td>
                      <td className="px-4 py-2 max-w-[180px] truncate">{r.asset_description}</td>
                      <td className="px-4 py-2 text-right">{formatAmount(r.monthly_payment, r.currency)}</td>
                      <td className="px-4 py-2 text-right">{r.lease_term_months}</td>
                      <td className="px-4 py-2 text-right">{formatIbrPct(r.annual_discount_rate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {moreCount > 0 && (
                <p className="px-4 py-2 text-xs text-[#64748b]">… and {moreCount} more leases</p>
              )}
            </div>

            <button
              type="button"
              onClick={resetToUpload}
              className="text-sm text-[#64748b] hover:text-[#334155] underline"
            >
              ← Upload Different File
            </button>

            <div className="text-center space-y-2 pt-4">
              <Button
                variant="primary"
                size="lg"
                className="px-8 py-3 text-base rounded-xl shadow-md"
                onClick={() => void onGenerate()}
                disabled={readyRows.length === 0}
              >
                🚀 Generate IFRS 16 Pack
              </Button>
              <p className="text-xs text-[#94a3b8]">Estimated time: 20–40 seconds</p>
            </div>
          </div>
        )}

        {phase === 'loading' && (
          <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 animate-in fade-in">
            <div className="relative mb-8">
              <div className="w-16 h-16 rounded-full border-4 border-[#fed7aa] border-t-[#f97316] animate-spin" />
              <Zap className="w-7 h-7 text-[#f97316] absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" />
            </div>
            <h3 className="text-xl font-bold text-[#0f172a] text-center mb-8">Generating your IFRS 16 pack…</h3>
            <ul className="w-full max-w-md space-y-3 mb-8">
              {STEP_LABELS.map((label, i) => (
                <li
                  key={label}
                  className={`flex items-center gap-3 text-sm transition-all duration-500 ${
                    checkSteps[i] ? 'text-emerald-700' : 'text-[#94a3b8]'
                  }`}
                >
                  {checkSteps[i] ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                  ) : (
                    <Loader2 className="w-5 h-5 animate-spin text-[#cbd5e1] shrink-0" />
                  )}
                  <span>{label}</span>
                </li>
              ))}
            </ul>
            <div className="w-full max-w-md h-2 bg-[#e2e8f0] rounded-full overflow-hidden mb-2">
              <div
                className="h-full bg-gradient-to-r from-[#f97316] to-[#3b82f6] transition-all duration-300 rounded-full"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-xs text-[#94a3b8]">Estimated time: 20–40 seconds</p>
          </div>
        )}

        {phase === 'results' && bulkResult && (
          <div className="space-y-8 animate-in fade-in duration-300">
            <div
              className={`flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 rounded-2xl border px-5 py-4 ${
                bulkResult.successful > 0
                  ? 'bg-gradient-to-r from-emerald-50 to-teal-50 border-emerald-100'
                  : 'bg-gradient-to-r from-amber-50 to-orange-50 border-amber-200'
              }`}
            >
              <div>
                <h3
                  className={`text-lg font-bold ${bulkResult.successful > 0 ? 'text-emerald-900' : 'text-amber-950'}`}
                >
                  {bulkResult.successful > 0 ? '✅ Your IFRS 16 Pack is Ready' : '⚠️ Pack finished — no leases calculated'}
                </h3>
                <p
                  className={`text-sm mt-1 ${bulkResult.successful > 0 ? 'text-emerald-800' : 'text-amber-900'}`}
                >
                  {bulkResult.successful} leases processed in {secondsElapsed} seconds
                  {bulkResult.successful === 0 && (
                    <span className="block mt-1 text-xs font-normal text-amber-900/90">
                      Monthly cash outflow still reflects rows that passed the upload check; IFRS metrics need a
                      successful calculation per lease (see errors below).
                    </span>
                  )}
                </p>
              </div>
              <span
                className={`text-xs whitespace-nowrap ${bulkResult.successful > 0 ? 'text-emerald-700' : 'text-amber-800'}`}
              >
                {completedAt}
              </span>
            </div>

            {bulkResult.successful === 0 && bulkFailureMessages.length > 0 && (
              <div
                className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
                role="alert"
              >
                <p className="font-semibold mb-2">Why nothing was processed</p>
                <p className="text-xs text-red-800/90 mb-2">
                  The API returned an error for each lease (common causes:{' '}
                  <strong>non-lease component ≥ monthly rent</strong> without “practical expedient”, invalid dates, or
                  rent-free months ≥ term). Typical message:
                </p>
                <ul className="list-disc pl-5 space-y-1 font-mono text-xs break-words">
                  {bulkFailureMessages.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="w-full rounded-2xl border border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50 p-6 sm:p-8 shadow-sm">
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <h3 className="text-lg font-bold text-gray-900">Portfolio Summary</h3>
                <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-medium">
                  {portfolioCurrency} Portfolio
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-6 rounded-xl bg-white shadow-sm flex flex-col gap-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Total Lease Liability
                  </p>
                  <p className="text-3xl font-bold text-blue-700">
                    {formatAmount(bulkResult.portfolio_summary.total_lease_liability || 0)}
                  </p>
                  <span className="text-2xl" aria-hidden>
                    📊
                  </span>
                </div>
                <div className="p-6 rounded-xl bg-white shadow-sm flex flex-col gap-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Total ROU Asset</p>
                  <p className="text-3xl font-bold text-green-700">
                    {formatAmount(bulkResult.portfolio_summary.total_rou_asset || 0)}
                  </p>
                  <span className="text-2xl" aria-hidden>
                    📈
                  </span>
                </div>
                <div className="p-6 rounded-xl bg-white shadow-sm flex flex-col gap-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Monthly Cash Outflow
                  </p>
                  <p className="text-3xl font-bold text-orange-600">{formatAmount(totalCashOutflow)}</p>
                  <span className="text-2xl" aria-hidden>
                    💸
                  </span>
                </div>
                <div className="p-6 rounded-xl bg-white shadow-sm flex flex-col gap-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Leases Processed</p>
                  <p className="text-3xl font-bold text-purple-700">
                    {bulkResult.successful} / {bulkResult.total} <span aria-hidden>✅</span>
                  </p>
                  <span className="text-2xl" aria-hidden>
                    ✓
                  </span>
                </div>
              </div>
            </div>

            {breakdownRows.length >= 2 && (
              <div className="w-full">
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <h3 className="text-lg font-bold text-[#0f172a]">
                    Lease Liability Movement — Portfolio Reconciliation
                  </h3>
                  <span className="text-[10px] sm:text-xs font-semibold text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">
                    IFRS 16 §28
                  </span>
                </div>
                <div className="rounded-xl bg-white shadow-sm border border-gray-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-blue-900 text-white">
                        <th className="text-left px-4 py-3 font-semibold">IFRS 16 Lease Liability Reconciliation</th>
                        <th className="text-right px-4 py-3 font-semibold w-[42%]" />
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-gray-100">
                        <td className="px-4 py-2.5 font-medium text-gray-800">Opening balance</td>
                        <td className="px-4 py-2.5 text-right font-medium text-gray-900">
                          {formatAmount(0)}{' '}
                          <span className="text-gray-500 font-normal text-xs whitespace-nowrap">
                            (new leases this period)
                          </span>
                        </td>
                      </tr>
                      <tr className="border-b border-gray-100 font-bold border-t-2 border-blue-200 bg-white">
                        <td className="px-4 py-2.5 text-gray-900">+ New leases</td>
                        <td className="px-4 py-2.5 text-right font-medium text-gray-900">
                          {formatAmount(
                            breakdownRows.reduce((s, row) => s + (row.ll || 0), 0)
                          )}
                        </td>
                      </tr>
                      {breakdownRows.map(({ r, ll }) => (
                        <tr key={`rec-${r.lease_id}`} className="border-b border-gray-100 bg-gray-50">
                          <td className="pl-8 pr-4 py-2 text-sm text-gray-600">{r.lease_id}</td>
                          <td className="px-4 py-2 text-right text-sm font-medium text-gray-700 tabular-nums">
                            {formatAmount(ll || 0)}
                          </td>
                        </tr>
                      ))}
                      <tr className="border-b border-gray-100 font-bold border-t border-gray-200">
                        <td className="px-4 py-2.5 text-gray-900">− Modifications</td>
                        <td className="px-4 py-2.5 text-right font-medium text-gray-900">
                          {formatAmount(0)}{' '}
                          <span className="text-gray-500 font-normal text-xs">(none this period)</span>
                        </td>
                      </tr>
                      <tr className="font-bold border-t-2 border-blue-200 bg-white">
                        <td className="px-4 py-2.5 text-gray-900">Closing balance</td>
                        <td className="px-4 py-2.5 text-right font-medium text-gray-900">
                          {formatAmount(breakdownRows.reduce((s, row) => s + (row.ll || 0), 0))}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-gray-500 mt-2 leading-relaxed">
                  Opening balance is {symbol}0 as these are newly calculated leases. In production, import your
                  prior period closing balance for full movement analysis.
                </p>
              </div>
            )}

            <div className="flex flex-col gap-6">
              {breakdownRows.map(({ r, pr, ll, pct }) => {
                const calc = (r.calculation_results ?? null) as Record<string, unknown> | null;
                const sched = getAmortizationSchedule(calc);
                const tab = leaseDetailTab[r.lease_id] || 'amort';
                const expanded = !!leaseDetailOpen[r.lease_id];
                const showAllAmort = !!amortShowAllByLease[r.lease_id];
                const asset = pr?.asset_description ?? r.lease_id;
                const sub = pr?.lessee_name?.trim() || pr?.lessor_name?.trim() || '—';
                const { title, sub: subLine } = assetTitleSubtitle(asset, sub);
                const emoji = assetEmoji(asset);
                const barW = Math.min(100, Math.max(0, pct));

                const downloadThisLease = async () => {
                  setDownloadingLeaseId(r.lease_id);
                  try {
                    const cr =
                      calc && typeof calc === 'object' && Object.keys(calc as object).length > 0
                        ? (calc as Record<string, unknown>)
                        : null;
                    if (cr) {
                      try {
                        const blob = await ifrs16Api.exportLeaseWorkbookFromResults(r.lease_id, cr);
                        const objUrl = URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.href = objUrl;
                        link.download = `IFRS16_${r.lease_id}.xlsx`;
                        link.rel = 'noopener';
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        URL.revokeObjectURL(objUrl);
                        toast.success('Download started');
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : 'Excel export failed');
                      }
                      return;
                    }
                    const fid = await resolveExcelFileId(r);
                    if (!fid) {
                      toast.error('Could not prepare Excel for this lease');
                      return;
                    }
                    const url = ifrs16Api.downloadReport(fid);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = `IFRS16_${r.lease_id}.xlsx`;
                    link.rel = 'noopener';
                    link.target = '_blank';
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    toast.success('Download started');
                  } finally {
                    setDownloadingLeaseId(null);
                  }
                };

                const y1 = (calc?.year_1_impact ?? {}) as Record<string, unknown>;
                const openingLL =
                  Number(sched[0]?.Opening_Balance ?? sched[0]?.opening_balance ?? ll) || ll || 0;
                const totalDep =
                  (Number(r.monthly_depreciation) || 0) * (Number(pr?.lease_term_months) || 0);
                const discText = getDisclosureNotesText(calc);
                const discOpen = !!disclosureOpenByLease[r.lease_id];
                const amortSlice = showAllAmort ? sched : sched.slice(0, 12);
                const journalRows = flattenJournalEntries(calc?.journal_entries);
                const journalLineItems = journalRowsToLineItems(journalRows);
                const pctEmoji = pct > 40 ? '🔴' : pct >= 20 ? '🟡' : '🟢';
                const tlc = (calc?.total_lease_cost ?? {}) as Record<string, unknown>;
                const grandTotalCost = Number(tlc.grand_total ?? 0) || 0;

                return (
                  <div
                    key={r.lease_id}
                    className={`bg-white rounded-xl shadow-md hover:shadow-lg transition-shadow overflow-hidden border border-gray-100 ${concentrationBorderClass(
                      pct
                    )}`}
                  >
                    <div className="p-6 flex flex-col gap-5">
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0">
                          <span className="text-2xl shrink-0 leading-none" aria-hidden>
                            {emoji}
                          </span>
                          <div className="min-w-0">
                            <p className="text-lg font-bold text-gray-900 leading-snug">{title}</p>
                            <p className="text-sm text-gray-500 mt-0.5">{subLine}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
                          <span
                            className={`text-lg font-bold tabular-nums ${
                              pct > 40 ? 'text-red-600' : pct >= 20 ? 'text-amber-600' : 'text-green-700'
                            }`}
                          >
                            {pct.toFixed(1)}%
                          </span>
                          <span className="text-xl" aria-hidden>
                            {pctEmoji}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        <div className="bg-gray-50 rounded-lg p-4">
                          <p className="text-xs text-gray-500 uppercase tracking-wide">Lease Liability</p>
                          <p className="text-xl font-bold text-gray-900 mt-1 break-all">
                            {formatAmount(ll, pr?.currency || portfolioCurrency)}
                          </p>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-4">
                          <p className="text-xs text-gray-500 uppercase tracking-wide">ROU Asset</p>
                          <p className="text-xl font-bold text-gray-900 mt-1 break-all">
                            {formatAmount(r.rou_asset || 0, pr?.currency || portfolioCurrency)}
                          </p>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-4">
                          <p className="text-xs text-gray-500 uppercase tracking-wide">Monthly Outflow</p>
                          <p className="text-xl font-bold text-gray-900 mt-1 break-all">
                            {formatAmount(pr?.monthly_payment ?? 0, pr?.currency || portfolioCurrency)}
                          </p>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-4">
                          <p className="text-xs text-gray-500 uppercase tracking-wide">IBR / Term</p>
                          <p className="text-xl font-bold text-gray-900 mt-1">
                            {formatIbrPct(pr?.annual_discount_rate ?? 0)}
                          </p>
                          <p className="text-sm font-semibold text-gray-700 mt-0.5">
                            {pr?.lease_term_months ?? 0} mo
                          </p>
                        </div>
                      </div>

                      <CalculationAssumptionsQuick
                        pr={pr}
                        symbol={getCurrencySymbol(pr?.currency || portfolioCurrency)}
                      />

                      <button
                        type="button"
                        onClick={() =>
                          setShowTrace((prev) => ({
                            ...prev,
                            [r.lease_id]: !prev[r.lease_id],
                          }))
                        }
                        className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 mt-2"
                      >
                        <span>{showTrace[r.lease_id] ? '▲' : '▶'}</span>
                        {showTrace[r.lease_id] ? 'Hide calculation' : 'View calculation trace'}
                      </button>

                      {showTrace[r.lease_id] &&
                        (() => {
                          const leaseSymbol = getCurrencySymbol(pr?.currency || portfolioCurrency);
                          const totalPayment = pr?.monthly_payment ?? 0;
                          const nonLeaseComp = pr?.non_lease_component ?? 0;
                          const netPayment = totalPayment - nonLeaseComp;
                          const ibr = pr?.annual_discount_rate ?? 0;
                          const ibrPct = ibr > 1 ? ibr : ibr * 100;
                          const monthlyRate = ibrPct / 12;
                          const term = pr?.lease_term_months ?? 0;
                          const liability = ll || 0;
                          const pvFactor =
                            netPayment > 0 && Number.isFinite(liability / netPayment)
                              ? liability / netPayment
                              : 0;
                          const rentFree = pr?.rent_free_months ?? 0;
                          const legalFees = pr?.legal_fees ?? 0;
                          const brokerage = pr?.brokerage_fees ?? 0;
                          const otherIDC = pr?.other_initial_direct_costs ?? 0;
                          const totalIDC = legalFees + brokerage + otherIDC;
                          const cashIncentive = pr?.cash_incentive ?? 0;
                          const rou = r.rou_asset || 0;

                          return (
                            <div className="mt-3 p-4 bg-blue-50 border border-blue-200 rounded-lg text-xs">
                              <div className="font-semibold text-blue-800 mb-3 flex items-center gap-2">
                                <span>🧮</span>
                                IFRS 16 Calculation Trace
                                <span className="ml-auto text-blue-500">IFRS 16 §26</span>
                              </div>

                              <div className="mb-3">
                                <div className="font-semibold text-gray-700 mb-1">Step 1 — Lease Payment for PV</div>
                                <div className="space-y-0.5 pl-3">
                                  <div className="flex justify-between gap-2">
                                    <span className="text-gray-500">Total monthly payment</span>
                                    <span className="shrink-0">
                                      {leaseSymbol}
                                      {totalPayment.toLocaleString('en-IN')}
                                    </span>
                                  </div>
                                  {nonLeaseComp > 0 && (
                                    <div className="flex justify-between gap-2 text-red-600">
                                      <span>Less: non-lease component (§12)</span>
                                      <span className="shrink-0">
                                        −{leaseSymbol}
                                        {nonLeaseComp.toLocaleString('en-IN')}
                                      </span>
                                    </div>
                                  )}
                                  <div className="flex justify-between font-semibold border-t border-blue-200 pt-1 gap-2">
                                    <span>Net payment used for PV</span>
                                    <span className="text-green-700 shrink-0">
                                      {leaseSymbol}
                                      {netPayment.toLocaleString('en-IN')}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              <div className="mb-3">
                                <div className="font-semibold text-gray-700 mb-1">Step 2 — Discount Rate (IBR)</div>
                                <div className="space-y-0.5 pl-3">
                                  <div className="flex justify-between">
                                    <span className="text-gray-500">Annual IBR</span>
                                    <span>{ibrPct.toFixed(2)}%</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-gray-500">Monthly rate (IBR ÷ 12)</span>
                                    <span>{monthlyRate.toFixed(4)}%</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-gray-500">Lease term</span>
                                    <span>{term} months</span>
                                  </div>
                                  {rentFree > 0 && (
                                    <div className="flex justify-between text-amber-600 gap-2">
                                      <span>Rent-free period</span>
                                      <span className="text-right">
                                        Months 1–{rentFree} ({leaseSymbol}0 payment)
                                      </span>
                                    </div>
                                  )}
                                </div>
                              </div>

                              <div className="mb-3">
                                <div className="font-semibold text-gray-700 mb-1">
                                  Step 3 — Present Value (Lease Liability)
                                </div>
                                <div className="space-y-0.5 pl-3">
                                  <div className="flex justify-between">
                                    <span className="text-gray-500">PV annuity factor (approx)</span>
                                    <span>{pvFactor.toFixed(2)}</span>
                                  </div>
                                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 font-bold text-blue-800 border-t border-blue-200 pt-1">
                                    <span className="min-w-0 break-words">
                                      Lease Liability ≈ {leaseSymbol}
                                      {netPayment.toLocaleString('en-IN')} × {pvFactor.toFixed(2)}
                                    </span>
                                    <span className="shrink-0">{formatAmount(liability)} ✅</span>
                                  </div>
                                </div>
                              </div>

                              {(totalIDC > 0 || cashIncentive > 0) && (
                                <div className="mb-2">
                                  <div className="font-semibold text-gray-700 mb-1">Step 4 — ROU Asset (IFRS 16 §24)</div>
                                  <div className="space-y-0.5 pl-3">
                                    <div className="flex justify-between gap-2">
                                      <span className="text-gray-500">Lease liability (opening)</span>
                                      <span className="shrink-0">
                                        {formatAmount(liability, pr?.currency || portfolioCurrency)}
                                      </span>
                                    </div>
                                    {totalIDC > 0 && (
                                      <div className="flex justify-between text-green-700 gap-2">
                                        <span>+ Initial direct costs</span>
                                        <span className="shrink-0">
                                          +{leaseSymbol}
                                          {totalIDC.toLocaleString('en-IN')}
                                        </span>
                                      </div>
                                    )}
                                    {cashIncentive > 0 && (
                                      <div className="flex justify-between text-red-600 gap-2">
                                        <span>− Lease incentives received</span>
                                        <span className="shrink-0">
                                          −{leaseSymbol}
                                          {cashIncentive.toLocaleString('en-IN')}
                                        </span>
                                      </div>
                                    )}
                                    <div className="flex justify-between font-bold text-green-800 border-t border-blue-200 pt-1 gap-2">
                                      <span>ROU Asset</span>
                                      <span className="shrink-0">
                                        {formatAmount(rou, pr?.currency || portfolioCurrency)} ✅
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              )}

                              <div className="mt-3 pt-2 border-t border-blue-200 text-blue-600 italic">
                                Method: Effective interest (IFRS 16 §36) · Depreciation: Straight-line (§31) · Verified
                                per IFRS 16 §26
                              </div>
                            </div>
                          );
                        })()}

                      <div>
                        <div className="flex justify-between text-xs text-gray-500 uppercase tracking-wide mb-1.5">
                          <span>% of Portfolio</span>
                          <span className="tabular-nums">{pct.toFixed(1)}%</span>
                        </div>
                        <div className="h-2.5 rounded-full bg-gray-200 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${pctBarBg(pct)}`}
                            style={{ width: `${barW}%` }}
                          />
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          setLeaseDetailOpen((prev) => ({
                            ...prev,
                            [r.lease_id]: !prev[r.lease_id],
                          }))
                        }
                        className="text-sm font-semibold text-gray-700 hover:text-orange-600 w-full text-left"
                      >
                        {expanded ? '▲ Hide Details' : '▼ View Details'}
                      </button>
                    </div>

                    {expanded && (
                      <div className="border-t border-gray-200 bg-gray-50/90 p-6 space-y-4 w-full">
                        <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-3 mb-4">
                          {(
                            [
                              ['amort', 'Amortization'],
                              ['journal', 'Journal Entries'],
                              ['metrics', 'Key Metrics'],
                            ] as const
                          ).map(([k, label]) => (
                            <button
                              key={k}
                              type="button"
                              onClick={() =>
                                setLeaseDetailTab((prev) => ({ ...prev, [r.lease_id]: k }))
                              }
                              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${
                                tab === k
                                  ? 'bg-orange-500 text-white'
                                  : 'text-gray-600 hover:text-orange-500'
                              }`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>

                        {tab === 'amort' && (
                          <div>
                            {sched.length === 0 ? (
                              <p className="text-sm text-[#64748b]">
                                Schedule not available — open individual lease for full schedule.{' '}
                                <Link
                                  href={`/dashboard/ifrs16/leases/${encodeURIComponent(r.lease_id)}`}
                                  className="text-blue-600 font-semibold underline"
                                >
                                  Open lease
                                </Link>
                              </p>
                            ) : (
                              <>
                                <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
                                  <table className="w-full table-fixed text-[10px] sm:text-xs">
                                    <thead>
                                      <tr className="bg-gray-100 text-gray-600 border-b border-gray-200">
                                        <th className="px-1 sm:px-2 py-2 text-left font-semibold uppercase w-[8%]">
                                          Month
                                        </th>
                                        <th className="px-1 sm:px-2 py-2 text-left font-semibold uppercase w-[14%]">
                                          Date
                                        </th>
                                        <th className="px-1 sm:px-2 py-2 text-right font-semibold uppercase w-[14%]">
                                          Opening Liability
                                        </th>
                                        <th className="px-1 sm:px-2 py-2 text-right font-semibold uppercase w-[12%]">
                                          Payment
                                        </th>
                                        <th className="px-1 sm:px-2 py-2 text-right font-semibold uppercase w-[12%]">
                                          Interest
                                        </th>
                                        <th className="px-1 sm:px-2 py-2 text-right font-semibold uppercase w-[12%]">
                                          Principal
                                        </th>
                                        <th className="px-1 sm:px-2 py-2 text-right font-semibold uppercase w-[18%]">
                                          Closing Liability
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {amortSlice.map((row, ri) => (
                                        <tr
                                          key={ri}
                                          className={`border-b border-gray-100 ${ri % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}
                                        >
                                          <td className="px-1 sm:px-2 py-1.5 truncate">
                                            {String(row.Period ?? row.Month ?? row.month ?? ri + 1)}
                                          </td>
                                          <td className="px-1 sm:px-2 py-1.5 truncate">
                                            {String(row.Date ?? row.date ?? '—')}
                                          </td>
                                          <td className="px-1 sm:px-2 py-1.5 text-right tabular-nums break-all">
                                            {formatAmount(
                                              Number(row.Opening_Balance ?? row.opening_balance ?? 0) || 0,
                                              pr?.currency || portfolioCurrency
                                            )}
                                          </td>
                                          <td className="px-1 sm:px-2 py-1.5 text-right tabular-nums break-all">
                                            {formatAmount(
                                              Number(row.Payment ?? row.payment ?? 0) || 0,
                                              pr?.currency || portfolioCurrency
                                            )}
                                          </td>
                                          <td className="px-1 sm:px-2 py-1.5 text-right tabular-nums break-all">
                                            {formatAmount(
                                              Number(row.Interest ?? row.interest ?? 0) || 0,
                                              pr?.currency || portfolioCurrency
                                            )}
                                          </td>
                                          <td className="px-1 sm:px-2 py-1.5 text-right tabular-nums break-all">
                                            {formatAmount(
                                              Number(row.Principal ?? row.principal ?? 0) || 0,
                                              pr?.currency || portfolioCurrency
                                            )}
                                          </td>
                                          <td className="px-1 sm:px-2 py-1.5 text-right tabular-nums break-all">
                                            {formatAmount(
                                              Number(row.Closing_Balance ?? row.closing_balance ?? 0) || 0,
                                              pr?.currency || portfolioCurrency
                                            )}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                                {sched.length > 12 && (
                                  <button
                                    type="button"
                                    className="mt-3 text-sm text-blue-600 underline cursor-pointer"
                                    onClick={() =>
                                      setAmortShowAllByLease((prev) => ({
                                        ...prev,
                                        [r.lease_id]: !prev[r.lease_id],
                                      }))
                                    }
                                  >
                                    {showAllAmort ? 'Show first 12 months' : `Show all ${sched.length} months`}
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        )}

                        {tab === 'journal' && (
                          <div>
                            {journalRows.length === 0 ? (
                              <p className="text-sm text-[#64748b]">
                                Journal entries not available — open individual lease for full entries.{' '}
                                <Link
                                  href={`/dashboard/ifrs16/leases/${encodeURIComponent(r.lease_id)}`}
                                  className="text-blue-600 font-semibold underline"
                                >
                                  Open lease
                                </Link>
                              </p>
                            ) : (
                              <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
                                <table className="w-full table-fixed text-xs sm:text-sm">
                                  <thead>
                                    <tr className="bg-gray-100 text-gray-600 border-b border-gray-200">
                                      <th className="px-2 py-2 text-left font-semibold uppercase w-[14%]">Date</th>
                                      <th className="px-2 py-2 text-left font-semibold uppercase w-[46%]">
                                        Description
                                      </th>
                                      <th className="px-2 py-2 text-left font-semibold uppercase w-[18%]">
                                        Entry Type
                                      </th>
                                      <th className="px-2 py-2 text-right font-semibold uppercase w-[22%]">Amount</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {journalLineItems.map((line, jri) => (
                                      <tr
                                        key={jri}
                                        className={`border-b border-gray-100 ${
                                          line.isDr
                                            ? 'bg-blue-50 text-blue-700 border-l-4 border-l-blue-500'
                                            : 'bg-green-50 text-green-700 border-l-4 border-l-green-500'
                                        }`}
                                      >
                                        <td className="px-2 py-2 align-top whitespace-nowrap">{line.date}</td>
                                        <td className="px-2 py-2 align-top break-words whitespace-normal">
                                          {line.description}
                                        </td>
                                        <td className="px-2 py-2 align-top font-semibold">{line.entryType}</td>
                                        <td className="px-2 py-2 align-top text-right tabular-nums font-medium">
                                          {formatAmount(line.amount)}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        )}

                        {tab === 'metrics' && (
                          <div className="space-y-3">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              {(
                                [
                                  {
                                    label: 'Opening Lease Liability',
                                    value: formatAmount(openingLL),
                                    ref: 'IFRS 16 para 26',
                                  },
                                  {
                                    label: 'Total Interest',
                                    value: formatAmount(
                                      Number(calc?.total_interest ?? r.total_interest ?? 0) || 0
                                    ),
                                    ref: 'IFRS 16 para 36',
                                  },
                                  {
                                    label: 'Total Depreciation',
                                    value: formatAmount(totalDep),
                                    ref: 'IFRS 16 para 28',
                                  },
                                  {
                                    label: 'Year 1 P&L Impact',
                                    value: formatAmount(
                                      Number(y1.total_p_l_expense ?? y1.total_pl_expense ?? 0) || 0
                                    ),
                                    ref: 'IFRS 16 para 42',
                                  },
                                  {
                                    label: 'Year 1 Cash Flow',
                                    value: formatAmount(Number(y1.cash_outflow ?? 0) || 0),
                                    ref: 'IFRS 16 para 50',
                                  },
                                  {
                                    label: 'Total Cost of Lease',
                                    value:
                                      grandTotalCost > 0
                                        ? formatAmount(grandTotalCost)
                                        : formatAmount(ll),
                                    ref: 'IFRS 16 para 34',
                                  },
                                ] as const
                              ).map((m) => (
                                <div
                                  key={m.label}
                                  className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
                                >
                                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                                    {m.label}
                                  </p>
                                  <p className="text-lg font-bold text-gray-900 mt-1 break-all">{m.value}</p>
                                  <p className="text-[11px] text-gray-400 mt-2">{m.ref}</p>
                                </div>
                              ))}
                            </div>

                            {discText ? (
                              <div>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDisclosureOpenByLease((prev) => ({
                                      ...prev,
                                      [r.lease_id]: !prev[r.lease_id],
                                    }))
                                  }
                                  className="text-xs font-semibold text-[#64748b] hover:text-[#334155] mb-2"
                                >
                                  {discOpen ? '▲ Hide disclosure note' : '▼ Disclosure note'}
                                </button>
                                {discOpen && (
                                  <div className="rounded-lg bg-[#f1f5f9] border border-[#e2e8f0] p-3 text-sm text-[#334155] font-serif leading-relaxed whitespace-pre-wrap">
                                    {discText}
                                  </div>
                                )}
                              </div>
                            ) : null}
                          </div>
                        )}

                        <Button
                          variant="secondary"
                          size="sm"
                          className="w-full"
                          disabled={downloadingLeaseId === r.lease_id}
                          onClick={() => void downloadThisLease()}
                        >
                          {downloadingLeaseId === r.lease_id ? (
                            <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                          ) : null}
                          Download This Lease Excel
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="w-full rounded-2xl border border-indigo-100 bg-white shadow-md overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-bold text-gray-900 flex flex-wrap items-center gap-2">
                    <span>🤖 CFO Portfolio Analysis</span>
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-violet-100 text-violet-800 border border-violet-200">
                      AI
                    </span>
                  </h3>
                  <p className="text-sm text-gray-500 mt-0.5">Powered by Claude AI</p>
                </div>
              </div>

              <div className="p-5 sm:p-6 space-y-8">
                {aiLoading && (
                  <div className="space-y-4">
                    <p className="text-sm font-medium text-gray-600">Analysing your portfolio...</p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {[0, 1, 2].map((i) => (
                        <div key={i} className="h-28 rounded-xl bg-gray-200 animate-pulse" />
                      ))}
                    </div>
                  </div>
                )}

                {!aiLoading && aiError && (
                  <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-4 py-3">
                    {aiError}
                  </p>
                )}

                {!aiLoading && aiAnalysis && (
                  <>
                    <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-5 sm:p-6">
                      <div className="flex flex-col lg:flex-row lg:items-start gap-6">
                        {(() => {
                          const score = Math.min(100, Math.max(0, Math.round(aiAnalysis.health_score || 0)));
                          const { ring, label } = healthGaugeColor(score);
                          const rad = 52;
                          const circ = 2 * Math.PI * rad;
                          const offset = circ - (score / 100) * circ;
                          return (
                            <div className="flex flex-col items-center shrink-0">
                              <svg width={120} height={120} viewBox="0 0 120 120" aria-hidden>
                                <circle cx={60} cy={60} r={rad} fill="none" stroke="#e5e7eb" strokeWidth={10} />
                                <circle
                                  cx={60}
                                  cy={60}
                                  r={rad}
                                  fill="none"
                                  stroke={ring}
                                  strokeWidth={10}
                                  strokeDasharray={circ}
                                  strokeDashoffset={offset}
                                  strokeLinecap="round"
                                  transform="rotate(-90 60 60)"
                                />
                                <text
                                  x={60}
                                  y={56}
                                  textAnchor="middle"
                                  fill={ring}
                                  style={{ fontSize: 28 }}
                                  className="font-bold"
                                >
                                  {score}
                                </text>
                                <text x={60} y={78} textAnchor="middle" fill="#6b7280" style={{ fontSize: 11 }}>
                                  /100
                                </text>
                              </svg>
                              <p className={`text-sm font-semibold mt-2 ${label}`}>{aiAnalysis.health_label}</p>
                            </div>
                          );
                        })()}
                        <div className="flex-1 min-w-0">
                          <h4 className="text-base font-bold text-gray-900 mb-2">Portfolio Health Score</h4>
                          <p className="text-sm text-gray-600 leading-relaxed">{aiAnalysis.summary}</p>
                          <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 flex gap-2 items-start">
                            <Zap className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                            <div>
                              <p className="text-xs font-bold text-amber-900 uppercase tracking-wide">
                                Top recommendation this week
                              </p>
                              <p className="text-sm font-bold text-gray-900 mt-1">
                                {aiAnalysis.top_recommendation}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div>
                      <h4 className="text-base font-bold text-gray-900 mb-4">Strategic insights</h4>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {(aiAnalysis.insights || []).map((ins, idx) => (
                          <div
                            key={`${ins.title}-${idx}`}
                            className={`rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden flex ${insightCardTypeBorderClass(
                              ins.type
                            )}`}
                          >
                            <div className="p-4 flex-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-2 mb-2">
                                <span
                                  className={`text-xs font-bold px-2 py-0.5 rounded-md ${insightTypeBadgeClass(
                                    ins.type
                                  )}`}
                                >
                                  {ins.type}
                                </span>
                                <span className="text-xs text-gray-600">
                                  {severityDotLabel(ins.severity)} {ins.severity}
                                </span>
                              </div>
                              <p className="font-bold text-gray-900 text-base">{ins.title}</p>
                              <p className="text-sm text-gray-600 mt-2 leading-relaxed">{ins.description}</p>
                              {typeof ins.calculation === 'string' && ins.calculation.length > 0 ? (
                                <div className="mt-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded text-xs font-mono text-gray-600">
                                  📐 {ins.calculation}
                                </div>
                              ) : null}
                              <p className="text-sm text-gray-700 mt-3">
                                <span className="font-semibold">→ Recommended Action:</span> {ins.action}
                              </p>
                              {ins.lease_id ? (
                                <Link
                                  href={`/dashboard/ifrs16/leases/${encodeURIComponent(ins.lease_id)}`}
                                  className="inline-block mt-3 text-sm font-semibold text-blue-600 hover:underline"
                                >
                                  View Lease →
                                </Link>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {!aiLoading && bulkResult ? (
                  <div className="rounded-xl border border-gray-200 bg-gradient-to-r from-slate-50 to-gray-50 p-5">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                      <div>
                        <p className="text-base font-bold text-gray-900">💬 Explain My Lease Portfolio</p>
                        <p className="text-sm text-gray-600 mt-1">
                          Get a plain English summary for your board
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void onExplainPortfolio()}
                        disabled={explainLoading}
                        className="inline-flex items-center justify-center gap-2 shrink-0 px-5 py-2.5 rounded-lg bg-orange-500 text-white font-semibold hover:bg-orange-600 disabled:opacity-60"
                      >
                        {explainLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                        Generate ▶
                      </button>
                    </div>
                    {explainOpen && (
                      <div className="mt-4 relative rounded-xl bg-blue-50 border border-blue-100 p-5 pr-12">
                        <button
                          type="button"
                          onClick={() => {
                            void (async () => {
                              if (!explainText) return;
                              try {
                                await navigator.clipboard.writeText(explainText);
                                toast.success('Copied to clipboard');
                              } catch {
                                toast.error('Copy failed');
                              }
                            })();
                          }}
                          className="absolute top-3 right-3 p-2 rounded-lg bg-white border border-blue-200 text-blue-700 hover:bg-blue-100"
                          title="Copy to clipboard"
                          disabled={!explainText || explainLoading}
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                        {explainLoading ? (
                          <div className="flex items-center gap-2 text-gray-600 text-base">
                            <Loader2 className="w-5 h-5 animate-spin" /> Writing…
                          </div>
                        ) : (
                          <p className="text-base text-gray-800 leading-relaxed whitespace-pre-wrap">{explainText}</p>
                        )}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>

              <div className="px-5 pb-5 pt-0">
                <Link
                  href="/dashboard/ifrs16/cfo-insights"
                  className="text-blue-600 text-sm underline font-medium"
                >
                  View Full CFO Analysis →
                </Link>
              </div>
            </div>

            <div className="w-full">
              <h3 className="text-lg font-bold text-[#0f172a] mb-3">Lease-by-Lease Breakdown</h3>
              <div className={`${cardClass} overflow-hidden`}>
                <table className="w-full table-fixed text-xs sm:text-sm">
                  <thead>
                    <tr className="text-left text-[#64748b] border-b border-[#e2e8f0] bg-gray-50 text-[10px] sm:text-xs uppercase tracking-wide">
                      <th className="px-2 py-2 w-[28%]">Asset</th>
                      <th className="px-2 py-2 text-right w-[14%]">Outflow</th>
                      <th className="px-2 py-2 text-right w-[16%]">Liability</th>
                      <th className="px-2 py-2 text-right w-[14%]">ROU</th>
                      <th className="px-2 py-2 text-right w-[10%]">IBR</th>
                      <th className="px-2 py-2 text-right w-[18%]">% Port.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(tableExpanded ? breakdownRows : breakdownRows.slice(0, 10)).map(({ r, pr, ll, pct }) => (
                      <tr key={r.lease_id} className="border-b border-[#f8fafc]">
                        <td className="px-2 py-2 truncate" title={String(pr?.asset_description ?? r.lease_id)}>
                          {pr?.asset_description ?? r.lease_id}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums break-all">
                          {formatAmount(pr?.monthly_payment ?? 0, pr?.currency || portfolioCurrency)}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums break-all">
                          {formatAmount(ll, pr?.currency || portfolioCurrency)}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums break-all">
                          {formatAmount(r.rou_asset || 0, pr?.currency || portfolioCurrency)}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {formatIbrPct(pr?.annual_discount_rate ?? 0)}
                        </td>
                        <td
                          className={`px-2 py-2 text-right font-semibold tabular-nums ${
                            pct > 40 ? 'text-red-600' : pct >= 20 ? 'text-amber-600' : 'text-[#334155]'
                          }`}
                        >
                          {pct.toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {breakdownRows.length > 10 && (
                  <div className="p-3 border-t border-[#f1f5f9]">
                    <button
                      type="button"
                      className="text-sm font-semibold text-[#f97316] hover:underline"
                      onClick={() => setTableExpanded((v) => !v)}
                    >
                      {tableExpanded ? 'Show less' : `Show all ${breakdownRows.length} leases`}
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="w-full rounded-2xl bg-gradient-to-br from-blue-900 to-blue-700 text-white shadow-xl p-8 sm:p-10">
              <h3 className="text-xl sm:text-2xl font-bold text-white mb-6 text-center">IFRS 16 Complete Pack</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left text-sm text-white/95 mb-8 max-w-2xl mx-auto">
                {[
                  'Lease Liability Schedule',
                  'ROU Asset Schedule',
                  'Journal Entries',
                  'Disclosure Notes & Maturity Analysis',
                ].map((x) => (
                  <div key={x} className="flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-white shrink-0" />
                    {x}
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-4 items-stretch sm:items-center max-w-xl mx-auto">
                <button
                  type="button"
                  onClick={() => void downloadPack()}
                  className="w-full sm:w-auto bg-orange-500 hover:bg-orange-600 text-white font-bold py-4 px-8 rounded-xl text-lg transition-colors shadow-lg"
                >
                  ⬇ Download All Workbooks (ZIP)
                </button>
                <button
                  type="button"
                  onClick={saveAllToLeaseData}
                  className="w-full sm:w-auto bg-white text-blue-900 border-2 border-white font-semibold py-3 px-8 rounded-xl hover:bg-blue-50 transition-colors"
                >
                  Save All to Lease Data
                </button>
                <button
                  type="button"
                  className="text-sm font-semibold text-white/90 hover:text-white underline"
                  onClick={goToLeaseDataAfterSave}
                >
                  View Lease Data →
                </button>
                <button
                  type="button"
                  onClick={resetToUpload}
                  className="text-sm text-white/70 hover:text-white mt-1"
                >
                  Start New Analysis
                </button>
              </div>
            </div>

            <div className="mt-6 p-4 border border-green-200 bg-green-50 rounded-xl text-xs text-green-700 flex items-start gap-3">
              <span className="text-green-500 text-lg mt-0.5">✓</span>
              <div>
                <div className="font-semibold mb-1">Calculation Methodology — Audit Ready</div>
                <div className="text-green-600 leading-relaxed">
                  All calculations use the effective interest method per IFRS 16 §26. Discount rates applied as
                  monthly equivalent (IBR ÷ 12). Right-of-use assets measured per §24 including initial direct
                  costs less lease incentives. Depreciation applied straight-line over lease term per §31.
                  Journal entries follow standard IFRS 16 recognition pattern. This output is suitable for audit
                  review.
                </div>
                <div className="mt-2 text-green-500">
                  References: IFRS 16 §24, §26, §28, §31, §36, §47, §50
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </SidebarLayout>
  );
}

function formatDateShort(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}
