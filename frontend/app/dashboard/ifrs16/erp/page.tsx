'use client';

import { useState, useEffect } from 'react';
import { SidebarLayout } from '@/components/SidebarLayout';
import { Button } from '@/components/Button';
import { Download, Copy, Link2 } from 'lucide-react';
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

export default function ErpPage() {
  const [leases, setLeases] = useState<LeaseRepositoryEntry[]>([]);
  const [selectedLease, setSelectedLease] = useState<string>('');
  const [erpType, setErpType] = useState<ErpType>('tally');
  const [exportType, setExportType] = useState<ExportType>('monthly');
  const [period, setPeriod] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [preview, setPreview] = useState('');
  const [codes, setCodes] = useState(getErpAccountCodes());

  useEffect(() => {
    setLeases(getLeaseRepository());
  }, []);

  useEffect(() => {
    saveErpAccountCodes(codes);
  }, [codes]);

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
    <SidebarLayout pageTitle="ERP Export" pageSubtitle="Export journal entries for Tally Prime, SAP, Oracle, QuickBooks">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
    </SidebarLayout>
  );
}
