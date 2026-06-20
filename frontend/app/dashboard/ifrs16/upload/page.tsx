'use client';

import { useState, useRef } from 'react';
import { SidebarLayout } from '@/components/SidebarLayout';
import { Button } from '@/components/Button';
import { Upload, Loader2, ArrowRight } from 'lucide-react';
import { ifrs16Api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { saveToLeaseRepository, buildLeaseEntry } from '@/lib/lease-repository';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { isCustomerFacingBuild } from '@/lib/service-messages';
import {
  parseBulkSpreadsheetFile,
  parsedRowToLeaseRequest,
  countReadyBulkRows,
  type ParsedLeaseRow,
} from '@/lib/ifrs16-bulk-parse';
import { normalizeAnnualRate, getIbrTypicalRangeHint } from '@/lib/ifrs16-rates';
import { isPortfolioAggregateLease } from '@/lib/ifrs16-portfolio';

interface LeaseCalculateResponse {
  results: Record<string, unknown>;
  excel_file_id: string;
}

type BulkResultRow = {
  lease_id: string;
  status: string;
  error?: string | null;
  lease_liability?: number;
  rou_asset?: number;
  monthly_depreciation?: number;
  total_interest?: number;
  calculation_results?: Record<string, unknown> | null;
};

function getVal(obj: any): any {
  if (obj == null) return null;
  if (typeof obj === 'object' && 'value' in obj) return obj.value;
  return obj;
}

function flattenExtraction(data: any): Record<string, any> {
  if (!data) return {};
  return {
    lease_id: data.lease_id ?? null,
    asset_description: getVal(data?.basic_info?.asset_description) ?? data.asset_description ?? data.asset ?? '',
    lessee_name: getVal(data?.basic_info?.lessee_name) ?? data.lessee_name ?? '',
    lessor_name: getVal(data?.basic_info?.lessor_name) ?? data.lessor_name ?? '',
    commencement_date: getVal(data?.dates?.commencement_date) ?? data.commencement_date ?? data.start_date ?? '',
    lease_term_months: getVal(data?.dates?.lease_term_months) ?? data.lease_term_months ?? data.term_months ?? '',
    monthly_payment: getVal(data?.payments?.monthly_amount) ?? data.monthly_payment ?? data.payment_amount ?? '',
    discount_rate: (() => {
      const v = getVal(data?.discount_rate?.stated_rate) ?? data.discount_rate;
      if (v == null) return 0.085;
      return normalizeAnnualRate(v) || 0.085;
    })(),
    initial_direct_costs: getVal(data?.initial_costs?.total) ?? data.initial_direct_costs ?? 0,
    currency: getVal(data?.payments?.currency) ?? data.currency ?? 'INR',
  };
}

export default function BulkUploadPage() {
  const router = useRouter();
  const { getCompanyId } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [extractedData, setExtractedData] = useState<any>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [formData, setFormData] = useState({
    lease_id: '',
    asset_description: '',
    lessee_name: '',
    lessor_name: '',
    commencement_date: '',
    lease_term_months: '',
    monthly_payment: '',
    annual_discount_rate: '',
    initial_direct_costs: '0',
    currency: 'INR',
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const saveBulkRows = async (rows: ParsedLeaseRow[]) => {
    const ready = rows.filter((r) => r.status !== 'error');
    if (ready.length === 0) {
      toast.error('No valid lease rows in spreadsheet');
      return;
    }
    setIsCalculating(true);
    try {
      const payloads = ready.map(parsedRowToLeaseRequest);
      const { data, error } = await ifrs16Api.bulkCalculate(payloads);
      if (error || !data) {
        toast.error(String(error || 'Bulk calculate failed'));
        return;
      }
      const results = (data as { results?: BulkResultRow[] }).results ?? [];
      const rowById = new Map(ready.map((r) => [r.lease_id, r]));
      let saved = 0;
      for (const r of results) {
        if (r.status !== 'success') continue;
        const pr = rowById.get(r.lease_id);
        const calcResults = (r.calculation_results || {
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
          rent_free_months: pr?.rent_free_months ?? 0,
          non_lease_component: pr?.non_lease_component ?? 0,
          non_lease_description: pr?.non_lease_description ?? '',
          practical_expedient_elected: pr?.practical_expedient_elected ?? false,
          legal_fees: pr?.legal_fees,
          brokerage_fees: pr?.brokerage_fees,
          other_initial_direct_costs: pr?.other_initial_direct_costs,
          cash_incentive: pr?.cash_incentive,
          payment_type: pr?.payment_type,
          results: calcResults,
          status: 'Active',
        });
        saveToLeaseRepository(entry);
        saved++;
      }
      const failed = results.filter((r) => r.status !== 'success').length;
      if (saved > 0) {
        toast.success(`Saved ${saved} lease(s) to repository${failed ? ` (${failed} failed)` : ''}`);
        router.push('/dashboard/ifrs16/repository');
      } else {
        toast.error('No leases calculated successfully');
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Bulk import failed');
    } finally {
      setIsCalculating(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.name.match(/\.(pdf|docx|txt|xlsx|xls)$/i)) {
      toast.error('PDF, DOCX, TXT, or Excel only');
      return;
    }
    setFile(f);
    setExtractedData(null);
    setUploadError(null);

    const ext = f.name.toLowerCase();
    if (ext.endsWith('.xlsx') || ext.endsWith('.xls')) {
      setIsUploading(true);
      try {
        const bulkRows = await parseBulkSpreadsheetFile(f);
        const readyCount = bulkRows ? countReadyBulkRows(bulkRows) : 0;
        if (bulkRows && readyCount >= 2) {
          toast.success(`Found ${readyCount} leases in template — calculating each row separately…`);
          await saveBulkRows(bulkRows);
          return;
        }
        if (bulkRows && readyCount === 1) {
          const row = bulkRows.find((r) => r.status !== 'error')!;
          setFormData({
            lease_id: row.lease_id,
            asset_description: row.asset_description,
            lessee_name: row.lessee_name,
            lessor_name: row.lessor_name,
            commencement_date: row.commencement_date,
            lease_term_months: String(row.lease_term_months),
            monthly_payment: String(row.monthly_payment),
            annual_discount_rate: String(Math.round(row.annual_discount_rate * 1000) / 10),
            initial_direct_costs: String(row.legal_fees + row.brokerage_fees + row.other_initial_direct_costs),
            currency: row.currency,
          });
          setExtractedData({ source: 'bulk_template', rows: bulkRows });
          toast.success('Loaded 1 lease from spreadsheet');
          return;
        }
      } catch (err: unknown) {
        console.warn('Bulk template parse failed, falling back to AI extraction', err);
      } finally {
        setIsUploading(false);
      }
    }

    setIsUploading(true);
    try {
      const { data, error } = await ifrs16Api.uploadContract(f);
      if (error) {
        setUploadError(error);
        toast.error(String(error));
        setFile(null);
        return;
      }
      const raw = data?.extracted_data;
      const ed = flattenExtraction(raw);
      setExtractedData(raw);
      const dr = (v: any) => (v != null && v !== '') ? String(v) : '';
      const disc = normalizeAnnualRate(ed.discount_rate) || 0.085;
      const discDisplay = String(Math.round(disc * 1000) / 10);
      setFormData({
        lease_id: dr(ed.lease_id) || `LEASE-${Date.now().toString().slice(-6)}`,
        asset_description: dr(ed.asset_description) || '',
        lessee_name: dr(ed.lessee_name) || '',
        lessor_name: dr(ed.lessor_name) || '',
        commencement_date: dr(ed.commencement_date) || '',
        lease_term_months: dr(ed.lease_term_months) || '36',
        monthly_payment: dr(ed.monthly_payment) || '0',
        annual_discount_rate: discDisplay,
        initial_direct_costs: String(ed.initial_direct_costs ?? 0),
        currency: ed.currency || 'INR',
      });
      toast.success('Extraction complete');
    } catch (e: any) {
      const msg = e?.message || 'Upload failed. Check file format and ensure the backend is running.';
      setUploadError(msg);
      toast.error(msg);
    } finally {
      setIsUploading(false);
    }
  };

  const handleCalculate = async () => {
    if (!formData.lease_id || !formData.asset_description || !formData.commencement_date || !formData.lease_term_months || !formData.monthly_payment || !formData.annual_discount_rate) {
      toast.error('Fill required fields');
      return;
    }
    const ratePct = normalizeAnnualRate(formData.annual_discount_rate);
    if (!Number.isFinite(ratePct) || ratePct <= 0) {
      toast.error(`IBR / Discount rate is required and must be > 0%. ${getIbrTypicalRangeHint(formData.currency)}`);
      return;
    }
    setIsCalculating(true);
    try {
      const payload = {
        ...formData,
        company_id: getCompanyId(),
        lease_term_months: parseInt(formData.lease_term_months),
        monthly_payment: parseFloat(formData.monthly_payment),
        annual_discount_rate: ratePct,
        initial_direct_costs: parseFloat(formData.initial_direct_costs),
      };
      const { data, error } = await ifrs16Api.calculate(payload);
      const typedData = data as LeaseCalculateResponse | undefined;
      if (error) {
        toast.error(String(error));
        return;
      }
      const results = typedData?.results || {};
      const entryDraft = {
        lease_id: formData.lease_id,
        title: formData.asset_description,
        asset: formData.asset_description,
        start_date: formData.commencement_date,
        liability: Number((results as { lease_liability?: number }).lease_liability ?? 0),
        currency: formData.currency,
        results,
      };
      if (isPortfolioAggregateLease(entryDraft)) {
        toast.error(
          'This looks like a merged portfolio record. Use Portfolio bulk upload (Excel template) for multiple leases.'
        );
        return;
      }
      const entry = buildLeaseEntry({
        lease_id: formData.lease_id,
        asset_description: formData.asset_description,
        commencement_date: formData.commencement_date,
        lease_term_months: parseInt(formData.lease_term_months),
        monthly_payment: parseFloat(formData.monthly_payment),
        currency: formData.currency,
        lessee_name: formData.lessee_name,
        lessor_name: formData.lessor_name,
        discount_rate: parseFloat(formData.annual_discount_rate),
        results,
        excel_file_id: typedData?.excel_file_id,
        is_portfolio_aggregate: false,
      });
      saveToLeaseRepository(entry);
      toast.success('Saved to repository');
      router.push('/dashboard/ifrs16/repository');
    } catch (e: any) {
      toast.error(e?.message || 'Calculation failed');
    } finally {
      setIsCalculating(false);
    }
  };

  const inputClass = 'w-full px-4 py-2.5 bg-[#f8fafc] border border-[#e2e8f0] rounded-lg focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500 text-[#1e293b]';
  const ibrHint = getIbrTypicalRangeHint(formData.currency);

  return (
    <SidebarLayout pageTitle="Bulk Upload" pageSubtitle="Upload lease contracts for AI extraction">
      <div className="max-w-2xl space-y-6">
        <div
          className="border-2 border-dashed border-[#e2e8f0] rounded-[14px] p-12 text-center hover:bg-[#f8fafc] cursor-pointer transition-colors"
          onClick={() => fileInputRef.current?.click()}
        >
          <input ref={fileInputRef} type="file" accept=".pdf,.docx,.txt,.xlsx,.xls" onChange={handleFileSelect} className="hidden" />
          <Upload className="w-16 h-16 text-[#f97316] mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-[#1e293b] mb-2">Drop your lease contract here</h3>
          <p className="text-[#64748b] mb-2">or click to browse</p>
          <p className="text-sm text-[#94a3b8]">PDF, DOCX, TXT, Excel (.xlsx, .xls)</p>
          <p className="text-xs text-[#94a3b8] mt-2">
            Multi-row Excel templates (column <code className="text-[#64748b]">lease_id</code>) create one lease per row automatically.
          </p>
          {isUploading && (
            <div className="mt-4 flex items-center justify-center gap-2 text-[#f97316]">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>Extracting...</span>
            </div>
          )}
          {isCalculating && !isUploading && (
            <div className="mt-4 flex items-center justify-center gap-2 text-[#f97316]">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>Calculating leases...</span>
            </div>
          )}
        </div>

        {uploadError && (
          <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm">
            <strong>Upload failed</strong>
            <p className="mt-1 whitespace-pre-wrap break-words">{uploadError}</p>
            {isCustomerFacingBuild() ? (
              <p className="mt-3 text-xs text-red-700">
                You can still enter lease details manually below, or try again later.
              </p>
            ) : (
              <p className="mt-3 text-xs text-red-700 space-y-1">
                <span className="block">
                  1. Backend must be running: <code className="bg-red-100 px-1 rounded">python app.py</code> (check the port matches Next.js — restart{' '}
                  <code className="bg-red-100 px-1 rounded">npm run dev</code> after the backend if the port changed).
                </span>
                <span className="block">
                  2. AI extraction needs <strong>ANTHROPIC_API_KEY</strong> in <code className="bg-red-100 px-1 rounded">IFRSAI\.env</code> (project root), then restart the backend.
                </span>
                <span className="block">
                  3. For many leases without AI, use{' '}
                  <Link href="/dashboard/ifrs16/bulk-upload" className="underline font-medium text-red-900">
                    Portfolio bulk upload (Excel template)
                  </Link>
                  .
                </span>
              </p>
            )}
          </div>
        )}

        {extractedData && (
          <div className="bg-white rounded-[14px] p-6 border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
            <h3 className="text-base font-semibold text-[#1e293b] mb-4">Review & Calculate</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[#1e293b] mb-2">Lease ID</label>
                <input value={formData.lease_id} onChange={(e) => setFormData({ ...formData, lease_id: e.target.value })} className={inputClass} />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-[#1e293b] mb-2">Asset Description</label>
                <input value={formData.asset_description} onChange={(e) => setFormData({ ...formData, asset_description: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#1e293b] mb-2">Commencement Date</label>
                <input type="date" value={formData.commencement_date} onChange={(e) => setFormData({ ...formData, commencement_date: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#1e293b] mb-2">Term (months)</label>
                <input type="number" value={formData.lease_term_months} onChange={(e) => setFormData({ ...formData, lease_term_months: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#1e293b] mb-2">Monthly Payment</label>
                <input type="number" value={formData.monthly_payment} onChange={(e) => setFormData({ ...formData, monthly_payment: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#1e293b] mb-2">IBR / Discount Rate % <span className="text-red-500">*</span></label>
                <input type="number" step="0.01" min="0.01" max="100" value={formData.annual_discount_rate} onChange={(e) => setFormData({ ...formData, annual_discount_rate: e.target.value })} className={inputClass} placeholder="8.5 (required)" />
                <p className="text-xs text-[#64748b] mt-1">Required. {ibrHint}. IBR must be &gt; 0.</p>
              </div>
            </div>
            <div className="mt-6 flex gap-3">
              <Button onClick={handleCalculate} disabled={isCalculating} className="bg-gradient-to-r from-orange-500 to-orange-600 text-white">
                {isCalculating ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Calculating...</> : <>Calculate & Save</>}
              </Button>
              <Link href="/dashboard/ifrs16/leases/new">
                <Button variant="secondary">Use Full Wizard Instead</Button>
              </Link>
            </div>
          </div>
        )}
      </div>
    </SidebarLayout>
  );
}
