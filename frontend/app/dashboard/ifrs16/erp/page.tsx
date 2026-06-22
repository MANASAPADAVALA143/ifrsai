'use client';

import { useState, useEffect } from 'react';
import { SidebarLayout } from '@/components/SidebarLayout';
import { Button } from '@/components/Button';
import { Download, Copy, Link2, Wifi, WifiOff, CheckCircle2, XCircle, Loader2, ChevronDown } from 'lucide-react';
import { getLeaseRepository } from '@/lib/lease-repository';
import { getErpAccountCodes, saveErpAccountCodes } from '@/lib/erp-codes';
import {
  getSchedule,
  getScheduleRowForPeriod,
  getLiabilitySplit,
  getMonthlyDepreciation,
  scheduleRow,
} from '@/lib/reports-utils';
import type { LeaseRepositoryEntry } from '@/lib/lease-repository';
import toast from 'react-hot-toast';

type ErpType = 'tally' | 'sap' | 'oracle' | 'quickbooks' | 'csv';
type ExportType = 'initial' | 'monthly' | 'both';

function toNum(v: unknown): number {
  if (v == null || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const LEASE_GL_MAP: Record<string, string> = {
  rou_asset: 'rou_gl_code',
  lease_liability: 'liability_gl_code',
  interest_expense: 'interest_gl_code',
  depreciation: 'depreciation_gl_code',
};

/** Get GL/ledger name: prefer per-lease GL code, then global mapping, then default */
function getAccount(lease: any, codes: any, key: string, defaultName: string): string {
  const leaseKey = LEASE_GL_MAP[key] || key;
  const perLease = (lease as any)?.[leaseKey];
  if (perLease != null && String(perLease).trim()) return String(perLease).trim();
  const mapped = (codes as any)[key];
  if (mapped != null && String(mapped).trim()) return String(mapped).trim();
  return defaultName;
}

/** Tally date: DD/MM/YYYY */
function tallyDate(isoDate: string): string {
  if (!isoDate || isoDate.length < 10) return isoDate;
  const [y, m, d] = isoDate.slice(0, 10).split('-');
  return `${d || '01'}/${m || '01'}/${y || '2024'}`;
}

function generateTallyXml(
  lease: LeaseRepositoryEntry,
  period: string,
  codes: any,
  exportType: ExportType,
  rowForPeriod: ReturnType<typeof getScheduleRowForPeriod>
): string {
  const rou = toNum(lease.rou ?? (lease.results as any)?.rou_asset);
  const liab = toNum(lease.liability ?? (lease.results as any)?.lease_liability);
  const split = getLiabilitySplit(lease);
  let currentLL = toNum(split.current_portion);
  let nonCurrentLL = toNum(split.non_current_portion);
  if (currentLL === 0 && nonCurrentLL === 0 && liab > 0) {
    currentLL = liab / 2;
    nonCurrentLL = liab - currentLL;
  }
  const dep = getMonthlyDepreciation(lease);
  const int = rowForPeriod ? toNum(rowForPeriod.interest) : toNum((lease.results as any)?.year_1_impact?.interest_expense) / 12;

  const rouLedger = getAccount(lease, codes, 'rou_asset', 'Right-of-Use Asset');
  const licLedger = getAccount(lease, codes, 'lease_liability', 'Lease Liability');
  const currLedger = getAccount(lease, codes, 'lease_liability_current', 'Lease Liability (Current)');
  const nonCurrLedger = getAccount(lease, codes, 'lease_liability_non_current', 'Lease Liability (Non-Current)');
  const depLedger = getAccount(lease, codes, 'depreciation', 'Depreciation Expense');
  const intLedger = getAccount(lease, codes, 'interest_expense', 'Finance Cost');
  const cashLedger = getAccount(lease, codes, 'cash', 'Bank/Cash');
  const accDepLedger = getAccount(lease, codes, 'acc_dep_rou', 'Accumulated Depreciation - ROU');

  const lid = lease.lease_id || lease.id || 'Lease';
  const dateStr = tallyDate(`${period}-01`);
  const vouchers: string[] = [];

  if (exportType === 'initial' || exportType === 'both') {
    const useSplit = (currLedger || nonCurrLedger) && (currentLL > 0 || nonCurrentLL > 0);
    let liabilityEntries = '';
    if (useSplit && currLedger && nonCurrLedger) {
      liabilityEntries = `<ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>${currLedger}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>-${currentLL.toFixed(2)}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>${nonCurrLedger}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>-${nonCurrentLL.toFixed(2)}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>`;
    } else {
      liabilityEntries = `<ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>${licLedger}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>-${liab.toFixed(2)}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>`;
    }
    const v1 = `<VOUCHER VCHTYPE="Journal" ACTION="Create" OBJVIEW="Accounting Voucher View">
            <DATE>${dateStr}</DATE>
            <NARRATION>IFRS 16 Initial Recognition - ${lid}</NARRATION>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>${rouLedger}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
              <AMOUNT>${rou.toFixed(2)}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
            ${liabilityEntries}
          </VOUCHER>`;
    vouchers.push(v1);
  }

  if ((exportType === 'monthly' || exportType === 'both') && (dep > 0 || int > 0)) {
    const payment = rowForPeriod ? toNum(rowForPeriod.payment) : 0;
    const principal = rowForPeriod ? toNum(rowForPeriod.principal) : 0;
    const v2Parts: string[] = [];
    if (payment > 0 && principal > 0) {
      v2Parts.push(`<ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>${licLedger}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
              <AMOUNT>${principal.toFixed(2)}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>${cashLedger}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>-${payment.toFixed(2)}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>`);
    }
    if (int > 0) {
      v2Parts.push(`<ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>${intLedger}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
              <AMOUNT>${int.toFixed(2)}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>${licLedger}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>-${int.toFixed(2)}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>`);
    }
    if (dep > 0) {
      v2Parts.push(`<ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>${depLedger}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
              <AMOUNT>${dep.toFixed(2)}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>${accDepLedger}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>-${dep.toFixed(2)}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>`);
    }
    if (v2Parts.length > 0) {
      vouchers.push(`<VOUCHER VCHTYPE="Journal" ACTION="Create" OBJVIEW="Accounting Voucher View">
            <DATE>${dateStr}</DATE>
            <NARRATION>IFRS 16 Monthly P&amp;L - ${lid} (${period})</NARRATION>
            ${v2Parts.join('\n            ')}
          </VOUCHER>`);
    }
  }

  const tallyMsgs = vouchers.map((v) => `          <TALLYMESSAGE>\n            ${v}\n          </TALLYMESSAGE>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
      </REQUESTDESC>
      <REQUESTDATA>
${tallyMsgs}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

/** SAP: Semicolon-separated, Debit/Credit columns - compatible with common SAP FI import templates */
function generateSapCsv(
  lease: LeaseRepositoryEntry,
  period: string,
  codes: any,
  exportType: ExportType,
  rowForPeriod: ReturnType<typeof getScheduleRowForPeriod>
): string {
  const rou = toNum(lease.rou ?? (lease.results as any)?.rou_asset);
  const liab = toNum(lease.liability ?? (lease.results as any)?.lease_liability);
  const dep = getMonthlyDepreciation(lease);
  const int = rowForPeriod ? toNum(rowForPeriod.interest) : toNum((lease.results as any)?.year_1_impact?.interest_expense) / 12;
  const payment = rowForPeriod ? toNum(rowForPeriod.payment) : 0;
  const principal = rowForPeriod ? toNum(rowForPeriod.principal) : 0;

  const sep = ';';
  const hdr = ['Posting Date', 'Doc Type', 'Company Code', 'GL Account', 'Debit', 'Credit', 'Currency', 'Document Text'].join(sep);
  const rows: string[] = [];
  const lid = lease.lease_id || lease.id || 'Lease';
  const dateStr = `${period}-01`;

  const rouCode = getAccount(lease, codes, 'rou_asset', '1000001');
  const liabCode = getAccount(lease, codes, 'lease_liability', '2000001');
  const depCode = getAccount(lease, codes, 'depreciation', '6000001');
  const intCode = getAccount(lease, codes, 'interest_expense', '6000002');
  const cashCode = getAccount(lease, codes, 'cash', '1000000');
  const accDepCode = getAccount(lease, codes, 'acc_dep_rou', '1000002');

  if (exportType === 'initial' || exportType === 'both') {
    rows.push([dateStr, 'SA', '1000', rouCode, rou.toFixed(2), '0', 'INR', `IFRS16 Init ${lid}`].join(sep));
    rows.push([dateStr, 'SA', '1000', liabCode, '0', liab.toFixed(2), 'INR', `IFRS16 Init ${lid}`].join(sep));
  }
  if (exportType === 'monthly' || exportType === 'both') {
    if (payment > 0 && principal > 0) {
      rows.push([dateStr, 'SA', '1000', liabCode, principal.toFixed(2), '0', 'INR', `IFRS16 Payment ${lid}`].join(sep));
      rows.push([dateStr, 'SA', '1000', cashCode, '0', payment.toFixed(2), 'INR', `IFRS16 Payment ${lid}`].join(sep));
    }
    if (int > 0) {
      rows.push([dateStr, 'SA', '1000', intCode, int.toFixed(2), '0', 'INR', `IFRS16 Interest ${lid}`].join(sep));
      rows.push([dateStr, 'SA', '1000', liabCode, '0', int.toFixed(2), 'INR', `IFRS16 Interest ${lid}`].join(sep));
    }
    if (dep > 0) {
      rows.push([dateStr, 'SA', '1000', depCode, dep.toFixed(2), '0', 'INR', `IFRS16 Depreciation ${lid}`].join(sep));
      rows.push([dateStr, 'SA', '1000', accDepCode, '0', dep.toFixed(2), 'INR', `IFRS16 Depreciation ${lid}`].join(sep));
    }
  }

  return [hdr, ...rows].join('\n');
}

function generateOracleFormat(
  lease: LeaseRepositoryEntry,
  period: string,
  codes: any,
  exportType: ExportType,
  rowForPeriod: ReturnType<typeof getScheduleRowForPeriod>
): string {
  const rou = toNum(lease.rou ?? (lease.results as any)?.rou_asset);
  const liab = toNum(lease.liability ?? (lease.results as any)?.lease_liability);
  const dep = getMonthlyDepreciation(lease);
  const int = rowForPeriod ? toNum(rowForPeriod.interest) : toNum((lease.results as any)?.year_1_impact?.interest_expense) / 12;
  const payment = rowForPeriod ? toNum(rowForPeriod.payment) : 0;
  const principal = rowForPeriod ? toNum(rowForPeriod.principal) : 0;

  const hdr = 'Journal,Date,Account,Debit,Credit,Description';
  const rows: string[] = [];
  const lid = lease.lease_id || lease.id || 'Lease';
  const dateStr = `${period}-01`;

  const rouCode = getAccount(lease, codes, 'rou_asset', '1.ROU_ASSET');
  const liabCode = getAccount(lease, codes, 'lease_liability', '2.LEASE_LIAB');
  const depCode = getAccount(lease, codes, 'depreciation', '5.DEPRECIATION');
  const intCode = getAccount(lease, codes, 'interest_expense', '5.INTEREST');
  const cashCode = getAccount(lease, codes, 'cash', '1.CASH');
  const accDepCode = getAccount(lease, codes, 'acc_dep_rou', '1.ACC_DEP_ROU');

  if (exportType === 'initial' || exportType === 'both') {
    rows.push(`IFRS16_INIT,${dateStr},${rouCode},${rou.toFixed(2)},0,Initial ROU - ${lid}`);
    rows.push(`IFRS16_INIT,${dateStr},${liabCode},0,${liab.toFixed(2)},Initial Liability - ${lid}`);
  }
  if (exportType === 'monthly' || exportType === 'both') {
    if (payment > 0 && principal > 0) {
      rows.push(`IFRS16_PMT,${dateStr},${liabCode},${principal.toFixed(2)},0,Principal - ${lid}`);
      rows.push(`IFRS16_PMT,${dateStr},${cashCode},0,${payment.toFixed(2)},Payment - ${lid}`);
    }
    if (int > 0) rows.push(`IFRS16_PL,${dateStr},${intCode},${int.toFixed(2)},0,Interest - ${lid}`);
    if (dep > 0) {
      rows.push(`IFRS16_PL,${dateStr},${depCode},${dep.toFixed(2)},0,Depreciation - ${lid}`);
      rows.push(`IFRS16_PL,${dateStr},${accDepCode},0,${dep.toFixed(2)},Acc Dep - ${lid}`);
    }
  }

  return [hdr, ...rows].join('\n');
}

function generateQuickBooksFormat(
  lease: LeaseRepositoryEntry,
  period: string,
  exportType: ExportType,
  rowForPeriod: ReturnType<typeof getScheduleRowForPeriod>
): string {
  const rou = toNum(lease.rou ?? (lease.results as any)?.rou_asset);
  const liab = toNum(lease.liability ?? (lease.results as any)?.lease_liability);
  const dep = getMonthlyDepreciation(lease);
  const int = rowForPeriod ? toNum(rowForPeriod.interest) : toNum((lease.results as any)?.year_1_impact?.interest_expense) / 12;
  const payment = rowForPeriod ? toNum(rowForPeriod.payment) : 0;
  const principal = rowForPeriod ? toNum(rowForPeriod.principal) : 0;

  const hdr = 'Date,Account,Debit,Credit,Memo';
  const rows: string[] = [];
  const lid = lease.lease_id || lease.id || 'Lease';
  const dateStr = `${period}-01`;

  if (exportType === 'initial' || exportType === 'both') {
    rows.push(`${dateStr},Right-of-Use Asset,${rou.toFixed(2)},0,IFRS 16 Init ${lid}`);
    rows.push(`${dateStr},Lease Liability,0,${liab.toFixed(2)},IFRS 16 Init ${lid}`);
  }
  if (exportType === 'monthly' || exportType === 'both') {
    if (payment > 0 && principal > 0) {
      rows.push(`${dateStr},Lease Liability,${principal.toFixed(2)},0,Principal ${lid}`);
      rows.push(`${dateStr},Bank,0,${payment.toFixed(2)},Payment ${lid}`);
    }
    if (int > 0) rows.push(`${dateStr},Interest Expense,${int.toFixed(2)},0,Interest ${lid}`);
    if (dep > 0) rows.push(`${dateStr},Depreciation Expense,${dep.toFixed(2)},0,Depreciation ${lid}`);
  }

  return [hdr, ...rows].join('\n');
}

function generateManualCsv(
  lease: LeaseRepositoryEntry,
  period: string,
  exportType: ExportType,
  rowForPeriod: ReturnType<typeof getScheduleRowForPeriod>
): string {
  const rou = toNum(lease.rou ?? (lease.results as any)?.rou_asset);
  const liab = toNum(lease.liability ?? (lease.results as any)?.lease_liability);
  const dep = getMonthlyDepreciation(lease);
  const int = rowForPeriod ? toNum(rowForPeriod.interest) : toNum((lease.results as any)?.year_1_impact?.interest_expense) / 12;
  const payment = rowForPeriod ? toNum(rowForPeriod.payment) : 0;
  const principal = rowForPeriod ? toNum(rowForPeriod.principal) : 0;

  const hdr = 'Date,Account,Debit,Credit,Narration';
  const rows: string[] = [];
  const lid = lease.lease_id || lease.id || 'Lease';
  const dateStr = `${period}-01`;

  if (exportType === 'initial' || exportType === 'both') {
    rows.push(`${dateStr},ROU Asset,${rou.toFixed(2)},,IFRS 16 Initial Recognition ${lid}`);
    rows.push(`${dateStr},Lease Liability,,${liab.toFixed(2)},IFRS 16 Initial Recognition ${lid}`);
  }
  if (exportType === 'monthly' || exportType === 'both') {
    if (payment > 0 && principal > 0) {
      rows.push(`${dateStr},Lease Liability,${principal.toFixed(2)},,Principal repayment ${lid}`);
      rows.push(`${dateStr},Cash/Bank,,${payment.toFixed(2)},Lease payment ${lid}`);
    }
    if (int > 0) rows.push(`${dateStr},Interest Expense,${int.toFixed(2)},,Monthly interest ${lid}`);
    if (dep > 0) rows.push(`${dateStr},Depreciation Expense,${dep.toFixed(2)},,Monthly depreciation ${lid}`);
  }

  return [hdr, ...rows].join('\n');
}

// ---------------------------------------------------------------------------
// Live Connection helpers
// ---------------------------------------------------------------------------
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:9000';

async function apiGet(path: string) {
  const r = await fetch(`${API_BASE}${path}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function apiPost(path: string, body: unknown) {
  const r = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

const ZOHO_ACCOUNT_FIELDS = [
  { key: 'rou_asset_account_id', label: 'ROU Asset (Zoho account_id)' },
  { key: 'lease_liability_account_id', label: 'Lease Liability (Zoho account_id)' },
  { key: 'interest_expense_account_id', label: 'Interest Expense (Zoho account_id)' },
  { key: 'depreciation_account_id', label: 'Depreciation Expense (Zoho account_id)' },
  { key: 'acc_dep_rou_account_id', label: 'Acc. Depreciation ROU (Zoho account_id)' },
  { key: 'cash_account_id', label: 'Cash / Bank (Zoho account_id)' },
];

type ZohoStatus = { connected: boolean; org_name: string; data_centre: string; last_push: string | null };
type PushLogEntry = {
  timestamp: string; erp: string; lease_id: string; journal_type: string;
  success: boolean; error: string; erp_reference: string;
  payload_summary: { reference_number: string; journal_date: string; line_count: number };
};

// ---------------------------------------------------------------------------

export default function ErpPage() {
  const [leases, setLeases] = useState<LeaseRepositoryEntry[]>([]);
  const [selectedLease, setSelectedLease] = useState<string>('');
  const [erpType, setErpType] = useState<ErpType>('tally');
  const [exportType, setExportType] = useState<ExportType>('monthly');

  // Live connection state
  const [activeTab, setActiveTab] = useState<'file' | 'live'>('file');

  // Zoho
  const [zohoStatus, setZohoStatus] = useState<ZohoStatus | null>(null);
  const [zohoStatusLoading, setZohoStatusLoading] = useState(false);
  const [showZohoConfigure, setShowZohoConfigure] = useState(false);
  const [zohoForm, setZohoForm] = useState({
    client_id: '', client_secret: '', refresh_token: '', organization_id: '',
    data_centre: 'com',
    rou_asset_account_id: '', lease_liability_account_id: '',
    interest_expense_account_id: '', depreciation_account_id: '',
    acc_dep_rou_account_id: '', cash_account_id: '',
  });
  const [zohoConfiguring, setZohoConfiguring] = useState(false);

  // Tally
  const [tallyStatus, setTallyStatus] = useState<{ connected: boolean; gateway_url: string; company: string; error?: string } | null>(null);
  const [tallyStatusLoading, setTallyStatusLoading] = useState(false);
  const [showTallyConfigure, setShowTallyConfigure] = useState(false);
  const [tallyForm, setTallyForm] = useState({
    gateway_url: 'http://localhost:9000', company: '',
    rou_asset_ledger: 'Right-of-Use Asset',
    lease_liability_ledger: 'Lease Liability',
    interest_expense_ledger: 'Finance Cost',
    depreciation_ledger: 'Depreciation Expense',
    acc_dep_rou_ledger: 'Accumulated Depreciation - ROU',
    cash_ledger: 'Bank/Cash',
  });
  const [tallyConfiguring, setTallyConfiguring] = useState(false);

  // Push log (shared across ERPs)
  const [pushLog, setPushLog] = useState<PushLogEntry[]>([]);
  const [pushLogLoading, setPushLogLoading] = useState(false);
  const [period, setPeriod] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [preview, setPreview] = useState('');
  const [codes, setCodes] = useState(getErpAccountCodes());

  useEffect(() => {
    setLeases(getLeaseRepository());
    fetchZohoStatus();
    fetchTallyStatus();
  }, []);

  useEffect(() => {
    saveErpAccountCodes(codes);
  }, [codes]);

  async function fetchZohoStatus() {
    setZohoStatusLoading(true);
    try {
      const data = await apiGet('/api/erp/zoho/status');
      setZohoStatus(data);
    } catch {
      setZohoStatus({ connected: false, org_name: '', data_centre: '', last_push: null });
    } finally {
      setZohoStatusLoading(false);
    }
  }

  async function handleZohoConfigure() {
    setZohoConfiguring(true);
    try {
      const result = await apiPost('/api/erp/zoho/configure', zohoForm);
      toast.success(`Connected to Zoho Books — ${result.org_name}`);
      setShowZohoConfigure(false);
      await fetchZohoStatus();
    } catch (e: any) {
      toast.error(`Connection failed: ${e.message}`);
    } finally {
      setZohoConfiguring(false);
    }
  }

  async function fetchTallyStatus() {
    setTallyStatusLoading(true);
    try {
      const data = await apiGet('/api/erp/tally/status');
      setTallyStatus(data);
    } catch {
      setTallyStatus({ connected: false, gateway_url: '', company: '' });
    } finally {
      setTallyStatusLoading(false);
    }
  }

  async function handleTallyConfigure() {
    setTallyConfiguring(true);
    try {
      const result = await apiPost('/api/erp/tally/configure', tallyForm);
      toast.success(`Connected to Tally Prime${result.company ? ` — ${result.company}` : ''}`);
      setShowTallyConfigure(false);
      await fetchTallyStatus();
    } catch (e: any) {
      toast.error(`Tally connection failed: ${e.message}`);
    } finally {
      setTallyConfiguring(false);
    }
  }

  async function fetchPushLog() {
    setPushLogLoading(true);
    try {
      // Merge Zoho + Tally logs
      const [zohoData, tallyData] = await Promise.allSettled([
        apiGet('/api/erp/zoho/push-log'),
        apiGet('/api/erp/tally/push-log'),
      ]);
      const zohoEntries = zohoData.status === 'fulfilled' ? (zohoData.value.entries || []) : [];
      const tallyEntries = tallyData.status === 'fulfilled' ? (tallyData.value.entries || []) : [];
      const combined = [...zohoEntries, ...tallyEntries]
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
        .slice(-50)
        .reverse();
      setPushLog(combined);
    } catch {
      setPushLog([]);
    } finally {
      setPushLogLoading(false);
    }
  }

  const lease = leases.find((l) => l.id === selectedLease || l.lease_id === selectedLease);
  const rowForPeriod = lease ? getScheduleRowForPeriod(lease, period) : null;

  const handleGenerate = () => {
    if (!lease) {
      toast.error('Select a lease first');
      return;
    }
    let out = '';
    switch (erpType) {
      case 'tally':
        out = generateTallyXml(lease, period, codes, exportType, rowForPeriod);
        break;
      case 'sap':
        out = generateSapCsv(lease, period, codes, exportType, rowForPeriod);
        break;
      case 'oracle':
        out = generateOracleFormat(lease, period, codes, exportType, rowForPeriod);
        break;
      case 'quickbooks':
        out = generateQuickBooksFormat(lease, period, exportType, rowForPeriod);
        break;
      case 'csv':
        out = generateManualCsv(lease, period, exportType, rowForPeriod);
        break;
    }
    setPreview(out);
    toast.success('Export generated');
  };

  const handleDownload = () => {
    if (!preview) return;
    const ext = erpType === 'tally' ? 'xml' : 'csv';
    const blob = new Blob([preview], { type: erpType === 'tally' ? 'application/xml' : 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `IFRS16_${lease?.lease_id || 'lease'}_${period}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Downloaded');
  };

  const handleCopy = () => {
    if (!preview) return;
    navigator.clipboard.writeText(preview).then(() => toast.success('Copied to clipboard'));
  };

  const periodInLeaseRange =
    lease &&
    (() => {
      const schedule = getSchedule(lease);
      if (schedule.length === 0) return true;
      const first = scheduleRow(schedule[0]);
      const last = scheduleRow(schedule[schedule.length - 1]);
      const [py, pm] = period.split('-').map(Number);
      const periodStart = new Date(py, pm - 1, 1).getTime();
      const firstDate = first.date ? new Date(String(first.date).slice(0, 10)).getTime() : 0;
      const lastDate = last.date ? new Date(String(last.date).slice(0, 10)).getTime() : 0;
      return periodStart >= firstDate && periodStart <= lastDate;
    })();

  return (
    <SidebarLayout pageTitle="ERP Export" pageSubtitle="Export journal entries or push live to your ERP">
      {/* Tab switcher */}
      <div className="flex gap-1 mb-6 bg-bg-light rounded-lg p-1 w-fit border border-border-default">
        <button
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === 'file' ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'}`}
          onClick={() => setActiveTab('file')}
        >
          File Export
        </button>
        <button
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${activeTab === 'live' ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'}`}
          onClick={() => { setActiveTab('live'); fetchPushLog(); }}
        >
          <Wifi className="w-3.5 h-3.5" /> Live ERP Connection
        </button>
      </div>

      {activeTab === 'live' && (
        <div className="space-y-6">
          {/* Zoho Books card */}
          <div className="bg-white rounded-[14px] p-6 border border-border-default shadow-card">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                  <Wifi className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-text-primary">Zoho Books</h3>
                  <p className="text-xs text-text-muted">Push IFRS 16 journals directly via REST API</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {zohoStatusLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-text-muted" />
                ) : zohoStatus?.connected ? (
                  <span className="flex items-center gap-1 text-xs text-green-700 bg-green-50 border border-green-200 px-2 py-1 rounded-full">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Connected — {zohoStatus.org_name}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs text-red-600 bg-red-50 border border-red-200 px-2 py-1 rounded-full">
                    <XCircle className="w-3.5 h-3.5" /> Not connected
                  </span>
                )}
                <Button variant="secondary" size="sm" onClick={() => setShowZohoConfigure(!showZohoConfigure)}>
                  Configure
                </Button>
                <Button variant="secondary" size="sm" onClick={fetchZohoStatus}>
                  Refresh
                </Button>
              </div>
            </div>

            {zohoStatus?.connected && zohoStatus.last_push && (
              <p className="text-xs text-text-muted mb-4">Last push: {new Date(zohoStatus.last_push).toLocaleString()}</p>
            )}

            {showZohoConfigure && (
              <div className="border-t border-border-default pt-4 space-y-3">
                <h4 className="text-sm font-semibold text-text-primary">Zoho Books Credentials</h4>
                <p className="text-xs text-text-muted">Credentials are stored server-side and never returned to the browser.</p>
                {[
                  { key: 'client_id', label: 'Client ID', type: 'text' },
                  { key: 'client_secret', label: 'Client Secret', type: 'password' },
                  { key: 'refresh_token', label: 'Refresh Token', type: 'password' },
                  { key: 'organization_id', label: 'Organization ID', type: 'text' },
                ].map(({ key, label, type }) => (
                  <div key={key}>
                    <label className="block text-xs font-medium text-text-secondary mb-1">{label}</label>
                    <input
                      type={type}
                      value={(zohoForm as any)[key]}
                      onChange={(e) => setZohoForm({ ...zohoForm, [key]: e.target.value })}
                      className="w-full px-3 py-2 bg-bg-light border border-border-default rounded-lg text-sm font-mono"
                      placeholder={label}
                    />
                  </div>
                ))}
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Data Centre</label>
                  <select
                    value={zohoForm.data_centre}
                    onChange={(e) => setZohoForm({ ...zohoForm, data_centre: e.target.value })}
                    className="w-full px-3 py-2 bg-bg-light border border-border-default rounded-lg text-sm"
                  >
                    <option value="com">US (.com)</option>
                    <option value="eu">Europe (.eu)</option>
                    <option value="in">India (.in)</option>
                    <option value="au">Australia (.au)</option>
                  </select>
                </div>
                <h4 className="text-sm font-semibold text-text-primary pt-2">Zoho Chart of Accounts — Account IDs</h4>
                <p className="text-xs text-text-muted">Enter the Zoho numeric account_id for each IFRS 16 GL line.</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {ZOHO_ACCOUNT_FIELDS.map(({ key, label }) => (
                    <div key={key}>
                      <label className="block text-xs font-medium text-text-secondary mb-1">{label}</label>
                      <input
                        type="text"
                        value={(zohoForm as any)[key]}
                        onChange={(e) => setZohoForm({ ...zohoForm, [key]: e.target.value })}
                        className="w-full px-3 py-2 bg-bg-light border border-border-default rounded-lg text-sm font-mono"
                        placeholder="Zoho account_id"
                      />
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 pt-2">
                  <Button variant="primary" size="md" className="bg-gradient-orange" onClick={handleZohoConfigure} disabled={zohoConfiguring}>
                    {zohoConfiguring ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    {zohoConfiguring ? 'Verifying…' : 'Save & Verify Connection'}
                  </Button>
                  <Button variant="secondary" size="md" onClick={() => setShowZohoConfigure(false)}>Cancel</Button>
                </div>
              </div>
            )}
          </div>

          {/* Tally Prime — live */}
          <div className="bg-white rounded-[14px] p-6 border border-border-default shadow-card">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center">
                  <Wifi className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-text-primary">Tally Prime</h3>
                  <p className="text-xs text-text-muted">Push via TDL Developer Gateway (local)</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {tallyStatusLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-text-muted" />
                ) : tallyStatus?.connected ? (
                  <span className="flex items-center gap-1 text-xs text-green-700 bg-green-50 border border-green-200 px-2 py-1 rounded-full">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Gateway reachable
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs text-red-600 bg-red-50 border border-red-200 px-2 py-1 rounded-full">
                    <XCircle className="w-3.5 h-3.5" /> Not connected
                  </span>
                )}
                <Button variant="secondary" size="sm" onClick={() => setShowTallyConfigure(!showTallyConfigure)}>
                  Configure
                </Button>
                <Button variant="secondary" size="sm" onClick={fetchTallyStatus}>
                  Ping
                </Button>
              </div>
            </div>

            {tallyStatus?.connected && (
              <p className="text-xs text-text-muted mb-1">
                Gateway: <span className="font-mono">{tallyStatus.gateway_url}</span>
                {tallyStatus.company && <> &nbsp;|&nbsp; Company: <strong>{tallyStatus.company}</strong></>}
              </p>
            )}
            {tallyStatus?.error && !tallyStatus.connected && (
              <p className="text-xs text-red-500 mb-2">{tallyStatus.error}</p>
            )}

            {showTallyConfigure && (
              <div className="border-t border-border-default pt-4 space-y-3">
                <h4 className="text-sm font-semibold text-text-primary">Tally Developer Gateway</h4>
                <p className="text-xs text-text-muted">
                  Enable in Tally Prime: <span className="font-mono">Gateway &gt; Settings &gt; Enable TDL Gateway Server</span> (default port 9000).
                </p>
                {[
                  { key: 'gateway_url', label: 'Gateway URL', placeholder: 'http://localhost:9000' },
                  { key: 'company', label: 'Company Name (optional — leave blank for active company)', placeholder: '' },
                ].map(({ key, label, placeholder }) => (
                  <div key={key}>
                    <label className="block text-xs font-medium text-text-secondary mb-1">{label}</label>
                    <input
                      type="text"
                      value={(tallyForm as any)[key]}
                      onChange={(e) => setTallyForm({ ...tallyForm, [key]: e.target.value })}
                      className="w-full px-3 py-2 bg-bg-light border border-border-default rounded-lg text-sm font-mono"
                      placeholder={placeholder}
                    />
                  </div>
                ))}
                <h4 className="text-sm font-semibold text-text-primary pt-2">Tally Ledger Names</h4>
                <p className="text-xs text-text-muted">Enter the exact ledger name as it appears in your Tally Chart of Accounts.</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {[
                    { key: 'rou_asset_ledger', label: 'ROU Asset' },
                    { key: 'lease_liability_ledger', label: 'Lease Liability' },
                    { key: 'interest_expense_ledger', label: 'Interest / Finance Cost' },
                    { key: 'depreciation_ledger', label: 'Depreciation Expense' },
                    { key: 'acc_dep_rou_ledger', label: 'Accumulated Depreciation ROU' },
                    { key: 'cash_ledger', label: 'Cash / Bank' },
                  ].map(({ key, label }) => (
                    <div key={key}>
                      <label className="block text-xs font-medium text-text-secondary mb-1">{label}</label>
                      <input
                        type="text"
                        value={(tallyForm as any)[key]}
                        onChange={(e) => setTallyForm({ ...tallyForm, [key]: e.target.value })}
                        className="w-full px-3 py-2 bg-bg-light border border-border-default rounded-lg text-sm"
                        placeholder={label}
                      />
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 pt-2">
                  <Button variant="primary" size="md" className="bg-gradient-orange" onClick={handleTallyConfigure} disabled={tallyConfiguring}>
                    {tallyConfiguring ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    {tallyConfiguring ? 'Connecting…' : 'Save & Verify Connection'}
                  </Button>
                  <Button variant="secondary" size="md" onClick={() => setShowTallyConfigure(false)}>Cancel</Button>
                </div>
              </div>
            )}
          </div>

          {/* SAP B1 — coming soon */}
          <div className="bg-white rounded-[14px] p-6 border border-border-default shadow-card opacity-60">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
                <WifiOff className="w-5 h-5 text-gray-400" />
              </div>
              <div>
                <h3 className="text-base font-bold text-text-primary">SAP Business One <span className="ml-2 text-xs font-normal text-text-muted bg-gray-100 px-2 py-0.5 rounded-full">Coming soon</span></h3>
                <p className="text-xs text-text-muted">Live push via Service Layer REST API</p>
              </div>
            </div>
          </div>

          {/* Push log */}
          <div className="bg-white rounded-[14px] p-6 border border-border-default shadow-card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-text-primary">Push Log</h3>
              <Button variant="secondary" size="sm" onClick={fetchPushLog} disabled={pushLogLoading}>
                {pushLogLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Refresh'}
              </Button>
            </div>
            {pushLog.length === 0 ? (
              <p className="text-sm text-text-muted text-center py-6">No pushes recorded yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-border-default">
                      {['Timestamp', 'Lease', 'Type', 'Status', 'ERP Reference', 'Error'].map((h) => (
                        <th key={h} className="text-left py-2 px-2 font-medium text-text-muted">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pushLog.map((entry, i) => (
                      <tr key={i} className="border-t border-border-default hover:bg-bg-light">
                        <td className="py-2 px-2 whitespace-nowrap">{new Date(entry.timestamp).toLocaleString()}</td>
                        <td className="py-2 px-2">{entry.lease_id}</td>
                        <td className="py-2 px-2">{entry.journal_type}</td>
                        <td className="py-2 px-2">
                          {entry.success
                            ? <span className="text-green-700 font-medium">Success</span>
                            : <span className="text-red-600 font-medium">Failed</span>}
                        </td>
                        <td className="py-2 px-2 font-mono">{entry.erp_reference || '—'}</td>
                        <td className="py-2 px-2 text-red-500">{entry.error || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'file' && <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Controls */}
        <div className="space-y-6">
          <div className="bg-white rounded-[14px] p-6 border border-border-default shadow-card">
            <h3 className="text-base font-bold text-text-primary mb-4">Export Settings</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">Select ERP</label>
                <select
                  value={erpType}
                  onChange={(e) => setErpType(e.target.value as ErpType)}
                  className="w-full px-4 py-2 bg-bg-light border border-border-default rounded-lg focus:ring-2 focus:ring-orange-primary text-text-primary"
                >
                  <option value="tally">Tally Prime (XML)</option>
                  <option value="sap">SAP (CSV, semicolon)</option>
                  <option value="oracle">Oracle (CSV)</option>
                  <option value="quickbooks">QuickBooks (CSV)</option>
                  <option value="csv">Generic CSV</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">Export Type</label>
                <select
                  value={exportType}
                  onChange={(e) => setExportType(e.target.value as ExportType)}
                  className="w-full px-4 py-2 bg-bg-light border border-border-default rounded-lg focus:ring-2 focus:ring-orange-primary text-text-primary"
                >
                  <option value="initial">Initial Recognition only</option>
                  <option value="monthly">Monthly P&amp;L only (depreciation + interest + payment)</option>
                  <option value="both">Both (Initial + Monthly)</option>
                </select>
                <p className="text-xs text-text-muted mt-1">
                  Use &quot;Monthly P&amp;L only&quot; for ongoing period postings.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">Select Lease</label>
                <select
                  value={selectedLease}
                  onChange={(e) => setSelectedLease(e.target.value)}
                  className="w-full px-4 py-2 bg-bg-light border border-border-default rounded-lg focus:ring-2 focus:ring-orange-primary text-text-primary"
                >
                  <option value="">— Select —</option>
                  {leases.map((l) => (
                    <option key={l.id} value={l.lease_id || l.id}>
                      {l.lease_id || l.id} — {l.asset}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">Period (YYYY-MM)</label>
                <input
                  type="month"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                  className="w-full px-4 py-2 bg-bg-light border border-border-default rounded-lg focus:ring-2 focus:ring-orange-primary text-text-primary"
                />
                {lease && !periodInLeaseRange && (
                  <p className="text-amber-600 text-xs mt-1">Period may be outside lease term — amounts estimated.</p>
                )}
              </div>
              <Button variant="primary" size="lg" className="w-full bg-gradient-orange" onClick={handleGenerate}>
                <Link2 className="w-5 h-5 mr-2" /> Generate ERP Export
              </Button>
            </div>
          </div>

          <div className="bg-white rounded-[14px] p-6 border border-border-default shadow-card">
            <h3 className="text-base font-bold text-text-primary mb-4">GL Account Mapping</h3>
            <p className="text-xs text-text-muted mb-4">
              Use ledger names for Tally; GL codes for SAP/Oracle. Per-lease codes (in lease form) override these.
            </p>
            <div className="space-y-3">
              {[
                { key: 'rou_asset', label: 'ROU Asset', placeholder: 'Right-of-Use Asset or 1000001' },
                { key: 'lease_liability', label: 'Lease Liability', placeholder: 'Lease Liability or 2000001' },
                { key: 'lease_liability_current', label: 'Liability (Current)', placeholder: 'Optional for Tally' },
                { key: 'lease_liability_non_current', label: 'Liability (Non-Current)', placeholder: 'Optional for Tally' },
                { key: 'interest_expense', label: 'Interest / Finance Cost', placeholder: 'e.g. 6100' },
                { key: 'depreciation', label: 'Depreciation Expense', placeholder: 'e.g. 6200' },
                { key: 'cash', label: 'Cash / Bank', placeholder: 'e.g. 1000000' },
                { key: 'acc_dep_rou', label: 'Acc. Depreciation ROU', placeholder: 'e.g. 1000002' },
              ].map(({ key, label, placeholder }) => (
                <div key={key}>
                  <label className="block text-xs text-text-secondary mb-1">{label}</label>
                  <input
                    type="text"
                    value={(codes as any)[key] ?? ''}
                    onChange={(e) => setCodes({ ...codes, [key]: e.target.value })}
                    placeholder={placeholder}
                    className="w-full px-4 py-2 bg-bg-light border border-border-default rounded-lg text-text-primary font-mono text-sm"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Preview */}
        <div className="bg-white rounded-[14px] p-6 border border-border-default shadow-card">
          <h3 className="text-base font-bold text-text-primary mb-4">Preview</h3>
          <pre className="p-4 bg-bg-light rounded-lg border border-border-default text-xs font-mono text-text-primary overflow-x-auto max-h-[400px] overflow-y-auto whitespace-pre-wrap">
            {preview || 'Click "Generate ERP Export" to see preview'}
          </pre>
          <div className="flex gap-2 mt-4">
            <Button variant="primary" size="md" className="bg-gradient-orange" onClick={handleDownload} disabled={!preview}>
              <Download className="w-4 h-5 mr-2" /> Download {erpType === 'tally' ? 'XML' : 'CSV'}
            </Button>
            <Button variant="secondary" size="md" onClick={handleCopy} disabled={!preview}>
              <Copy className="w-4 h-4 mr-2" /> Copy to Clipboard
            </Button>
          </div>
          <p className="text-xs text-text-muted mt-3">
            SAP uses semicolon separator. Tally XML uses Import Data format. Amounts are period-specific from the amortization schedule when available.
          </p>
        </div>
      </div>
    </div>}

    </SidebarLayout>
  );
}
