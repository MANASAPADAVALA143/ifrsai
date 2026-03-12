'use client';

import { useState, useEffect } from 'react';
import { SidebarLayout } from '@/components/SidebarLayout';
import { Button } from '@/components/Button';
import { Download, Copy, Link2 } from 'lucide-react';
import { getLeaseRepository } from '@/lib/lease-repository';
import { getErpAccountCodes, saveErpAccountCodes } from '@/lib/erp-codes';
import { formatIndianCurrency } from '@/lib/utils';
import toast from 'react-hot-toast';

type ErpType = 'tally' | 'sap' | 'oracle' | 'quickbooks' | 'csv';

function generateTallyXml(lease: any, period: string, codes: any): string {
  const rou = Number(lease.rou ?? 0);
  const liab = Number(lease.liability ?? 0);
  const roc = codes.rou_asset || 'Right-of-Use Asset';
  const lic = codes.lease_liability || 'Lease Liability';

  return `<?xml version="1.0"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Export Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE>
          <VOUCHER VCHTYPE="Journal" ACTION="Create" OBJVIEW="Accounting Voucher View">
            <DATE>${period}-01</DATE>
            <NARRATION>IFRS 16 Initial Recognition - ${lease.lease_id || lease.id}</NARRATION>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>${roc}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
              <AMOUNT>${rou.toFixed(2)}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>${lic}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>${liab.toFixed(2)}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
          </VOUCHER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

function generateSapCsv(lease: any, period: string, codes: any): string {
  const dep = Number(lease.results?.monthly_depreciation ?? 0);
  const int = Number((lease.results?.year_1_impact?.interest_expense ?? 0) / 12);
  const roc = codes.rou_asset || 'ROU_ASSET';
  const depc = codes.depreciation || 'DEPRECIATION';
  const intc = codes.interest_expense || 'INTEREST_EXPENSE';

  return `PostingDate,DocumentType,GLAccount,CostCenter,Amount,Currency,Text
${period}-01,SA,${roc},,${lease.rou ?? 0},INR,IFRS16 Initial Recognition
${period}-01,SA,${depc},,${dep},INR,IFRS16 Depreciation
${period}-01,SA,${intc},,${int},INR,IFRS16 Interest Expense`;
}

function generateManualCsv(lease: any, period: string): string {
  const rou = Number(lease.rou ?? 0);
  const liab = Number(lease.liability ?? 0);
  const dep = Number(lease.results?.monthly_depreciation ?? 0);
  const int = Number((lease.results?.year_1_impact?.interest_expense ?? 0) / 12);

  return `Date,Account,Debit,Credit,Narration
${period}-01,ROU Asset,${rou},,IFRS 16 Initial Recognition
${period}-01,Lease Liability,,${liab},IFRS 16 Initial Recognition
${period}-01,Depreciation Expense,${dep},,IFRS 16 Monthly Depreciation
${period}-01,Interest Expense,${int},,IFRS 16 Monthly Interest`;
}

function generateOracleFormat(lease: any, period: string, codes: any): string {
  const rou = Number(lease.rou ?? 0);
  const dep = Number(lease.results?.monthly_depreciation ?? 0);
  const int = Number((lease.results?.year_1_impact?.interest_expense ?? 0) / 12);
  const roc = codes.rou_asset || '1.ROU_ASSET';
  const depc = codes.depreciation || '5.DEPRECIATION';
  const intc = codes.interest_expense || '5.INTEREST';

  return `Journal,Date,Account,Debit,Credit,Description
IFRS16,${period}-01,${roc},${rou},0,Lease - ${lease.lease_id || lease.id}
IFRS16,${period}-01,Lease Liability,0,${rou},IFRS 16 Recognition
IFRS16,${period}-01,${depc},${dep},0,Monthly Depreciation
IFRS16,${period}-01,${intc},${int},0,Monthly Interest`;
}

function generateQuickBooksFormat(lease: any, period: string): string {
  const dep = Number(lease.results?.monthly_depreciation ?? 0);
  const int = Number((lease.results?.year_1_impact?.interest_expense ?? 0) / 12);

  return `Date,Account,Debit,Credit,Memo
${period}-01,Right-of-Use Asset,${lease.rou ?? 0},0,IFRS 16 ${lease.lease_id || lease.id}
${period}-01,Lease Liability,0,${lease.liability ?? 0},IFRS 16
${period}-01,Depreciation Expense,${dep},0,Monthly
${period}-01,Interest Expense,${int},0,Monthly`;
}

export default function ErpPage() {
  const [leases, setLeases] = useState<any[]>([]);
  const [selectedLease, setSelectedLease] = useState<string>('');
  const [erpType, setErpType] = useState<ErpType>('tally');
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

  const handleGenerate = () => {
    if (!lease) {
      toast.error('Select a lease first');
      return;
    }
    let out = '';
    switch (erpType) {
      case 'tally':
        out = generateTallyXml(lease, period, codes);
        break;
      case 'sap':
        out = generateSapCsv(lease, period, codes);
        break;
      case 'oracle':
        out = generateOracleFormat(lease, period, codes);
        break;
      case 'quickbooks':
        out = generateQuickBooksFormat(lease, period);
        break;
      case 'csv':
        out = generateManualCsv(lease, period);
        break;
    }
    setPreview(out);
    toast.success('Export generated');
  };

  const handleDownload = () => {
    if (!preview) return;
    const ext = erpType === 'tally' ? 'xml' : 'csv';
    const blob = new Blob([preview], { type: erpType === 'tally' ? 'application/xml' : 'text/csv' });
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

  return (
    <SidebarLayout pageTitle="ERP Export" pageSubtitle="Export journal entries for Tally, SAP, Oracle, QuickBooks">
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
                  <option value="sap">SAP (CSV)</option>
                  <option value="oracle">Oracle</option>
                  <option value="quickbooks">QuickBooks</option>
                  <option value="csv">Manual CSV</option>
                </select>
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
                <label className="block text-sm font-medium text-text-primary mb-2">Period</label>
                <input
                  type="month"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                  className="w-full px-4 py-2 bg-bg-light border border-border-default rounded-lg focus:ring-2 focus:ring-orange-primary text-text-primary"
                />
              </div>
              <Button variant="primary" size="lg" className="w-full bg-gradient-orange" onClick={handleGenerate}>
                <Link2 className="w-5 h-5 mr-2" /> Generate ERP Export
              </Button>
            </div>
          </div>

          <div className="bg-white rounded-[14px] p-6 border border-border-default shadow-card">
            <h3 className="text-base font-bold text-text-primary mb-4">Account Code Mapping</h3>
            <p className="text-xs text-text-muted mb-4">Map IFRS 16 accounts to your GL codes</p>
            <div className="space-y-3">
              {[
                { key: 'rou_asset', label: 'ROU Asset', placeholder: 'e.g. 1100' },
                { key: 'lease_liability', label: 'Lease Liability', placeholder: 'e.g. 2100' },
                { key: 'interest_expense', label: 'Interest Expense', placeholder: 'e.g. 6100' },
                { key: 'depreciation', label: 'Depreciation', placeholder: 'e.g. 6200' },
              ].map(({ key, label, placeholder }) => (
                <div key={key}>
                  <label className="block text-xs text-text-secondary mb-1">{label}</label>
                  <input
                    type="text"
                    value={codes[key as keyof typeof codes]}
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
          <pre className="p-4 bg-bg-light rounded-lg border border-border-default text-xs font-mono text-text-primary overflow-x-auto max-h-[400px] overflow-y-auto">
            {preview || 'Click "Generate ERP Export" to see preview'}
          </pre>
          <div className="flex gap-2 mt-4">
            <Button variant="primary" size="md" className="bg-gradient-orange" onClick={handleDownload} disabled={!preview}>
              <Download className="w-4 h-4 mr-2" /> Download {erpType === 'tally' ? 'XML' : 'CSV'}
            </Button>
            <Button variant="secondary" size="md" onClick={handleCopy} disabled={!preview}>
              <Copy className="w-4 h-4 mr-2" /> Copy to Clipboard
            </Button>
          </div>
        </div>
      </div>
    </SidebarLayout>
  );
}
