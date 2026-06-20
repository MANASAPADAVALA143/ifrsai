'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { SidebarLayout } from '@/components/SidebarLayout';
import { Button } from '@/components/Button';
import { ifrs16LessorApi } from '@/lib/api';
import FinReportAIPostButton from '@/components/ifrs16/FinReportAIPostButton';
import { getLeaseRepositoryFirmId } from '@/lib/lease-repository';
import { Building2, Calculator, Loader2, CheckCircle2, Info } from 'lucide-react';
import toast from 'react-hot-toast';

const cardClass =
  'bg-white rounded-[14px] border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)]';
const inputClass =
  'w-full px-3 py-2 border border-[#e2e8f0] rounded-lg text-sm focus:ring-2 focus:ring-[#f97316]/30 focus:border-[#f97316]';
const labelClass = 'block text-xs font-medium text-[#64748b] uppercase tracking-wide mb-1';

type Indicator = { key: string; label: string; paragraph: string; strength: string };

type FormState = {
  asset_description: string;
  lessee_name: string;
  commencement_date: string;
  lease_term_months: number;
  payment_amount: number;
  payment_frequency: string;
  payment_timing: string;
  interest_rate_implicit: number;
  fair_value_of_asset: number;
  carrying_amount_of_asset: number;
  unguaranteed_residual_value: number;
  guaranteed_residual_value: number;
  is_dealer_manufacturer: boolean;
  cost_of_asset: number;
  initial_direct_costs: number;
  useful_life_months: number;
  currency: string;
  lease_type_override: string;
};

const defaultForm: FormState = {
  asset_description: 'Commercial Property — Dubai',
  lessee_name: 'Tenant LLC',
  commencement_date: '2024-01-01',
  lease_term_months: 60,
  payment_amount: 50000,
  payment_frequency: 'monthly',
  payment_timing: 'arrears',
  interest_rate_implicit: 0.055,
  fair_value_of_asset: 20000000,
  carrying_amount_of_asset: 18000000,
  unguaranteed_residual_value: 0,
  guaranteed_residual_value: 0,
  is_dealer_manufacturer: false,
  cost_of_asset: 0,
  initial_direct_costs: 0,
  useful_life_months: 600,
  currency: 'AED',
  lease_type_override: '',
};

function fmtMoney(n: number, ccy: string) {
  const v = Number(n) || 0;
  return `${ccy} ${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

export default function LessorAccountingPage() {
  const [form, setForm] = useState<FormState>(defaultForm);
  const [indicators, setIndicators] = useState<Indicator[]>([]);
  const [selectedIndicators, setSelectedIndicators] = useState<string[]>([]);
  const [classify, setClassify] = useState<{
    lease_type: string;
    classification: string;
    classification_tests: { test: string; result: string; threshold: string; triggered: boolean }[];
  } | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [classifyLoading, setClassifyLoading] = useState(false);
  const [calcLoading, setCalcLoading] = useState(false);

  useEffect(() => {
    void ifrs16LessorApi.getIndicators().then(({ data, error }) => {
      if (error) return;
      const list = (data as { indicators?: Indicator[] })?.indicators;
      if (Array.isArray(list)) setIndicators(list);
    });
  }, []);

  const patch = (key: keyof FormState, value: string | number | boolean) =>
    setForm((p) => ({ ...p, [key]: value }));

  const runClassify = useCallback(async () => {
    setClassifyLoading(true);
    try {
      const { data, error } = await ifrs16LessorApi.classify({
        fair_value_of_asset: form.fair_value_of_asset,
        payment_amount: form.payment_amount,
        payment_frequency: form.payment_frequency,
        payment_timing: form.payment_timing,
        interest_rate_implicit: form.interest_rate_implicit,
        lease_term_months: form.lease_term_months,
        useful_life_months: form.useful_life_months,
        classification_indicators: selectedIndicators,
      });
      if (error) throw new Error(error);
      setClassify(data as typeof classify);
    } catch (e) {
      console.warn(e);
    } finally {
      setClassifyLoading(false);
    }
  }, [form, selectedIndicators]);

  useEffect(() => {
    const t = setTimeout(() => void runClassify(), 400);
    return () => clearTimeout(t);
  }, [runClassify]);

  const runCalculate = async () => {
    setCalcLoading(true);
    try {
      const payload = {
        ...form,
        interest_rate_implicit: form.interest_rate_implicit,
        lease_type_override: form.lease_type_override || null,
        classification_indicators: selectedIndicators,
      };
      const { data, error } = await ifrs16LessorApi.calculate(payload);
      if (error) throw new Error(error);
      const res = (data as { result?: Record<string, unknown> })?.result;
      setResult(res || null);
      toast.success('Lessor calculation complete');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Calculation failed');
    } finally {
      setCalcLoading(false);
    }
  };

  const summary = (result?.summary || {}) as Record<string, unknown>;
  const schedule = useMemo(() => {
    if (!result) return [];
    if (result.lease_type === 'finance') {
      return (result.net_investment_schedule as Record<string, unknown>[]) || [];
    }
    return (result.income_schedule as Record<string, unknown>[]) || [];
  }, [result]);

  const journals = (result?.journal_entries as Record<string, unknown>[]) || [];
  const badgeClass =
    classify?.lease_type === 'finance'
      ? 'bg-blue-100 text-blue-800 border-blue-200'
      : 'bg-emerald-100 text-emerald-800 border-emerald-200';

  return (
    <SidebarLayout
      pageTitle="Lessor Accounting"
      pageSubtitle="IFRS 16 §61–97 — finance and operating lease (lessor perspective)"
    >
      <div className="space-y-6">
        <div className={`${cardClass} p-4 flex flex-wrap items-center gap-4`}>
          <Building2 className="w-8 h-8 text-[#f97316]" />
          <div className="flex-1 min-w-[200px]">
            <p className="text-sm text-[#64748b]">
              UAE property leases typically classify as <strong>Operating</strong> — building stays on
              your balance sheet, rental income recognised straight-line.
            </p>
          </div>
          <div className={`px-4 py-2 rounded-lg border text-sm font-semibold ${badgeClass}`}>
            {classifyLoading ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Classifying…
              </span>
            ) : (
              classify?.classification || '—'
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className={`${cardClass} p-6 xl:col-span-1 space-y-4`}>
            <h2 className="font-semibold text-[#1e293b]">Lease inputs</h2>

            <div>
              <label className={labelClass}>Asset description</label>
              <input className={inputClass} value={form.asset_description} onChange={(e) => patch('asset_description', e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>Lessee name</label>
              <input className={inputClass} value={form.lessee_name} onChange={(e) => patch('lessee_name', e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Commencement</label>
                <input type="date" className={inputClass} value={form.commencement_date} onChange={(e) => patch('commencement_date', e.target.value)} />
              </div>
              <div>
                <label className={labelClass}>Term (months)</label>
                <input type="number" className={inputClass} value={form.lease_term_months} onChange={(e) => patch('lease_term_months', Number(e.target.value))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Payment / period</label>
                <input type="number" className={inputClass} value={form.payment_amount} onChange={(e) => patch('payment_amount', Number(e.target.value))} />
              </div>
              <div>
                <label className={labelClass}>Currency</label>
                <input className={inputClass} value={form.currency} onChange={(e) => patch('currency', e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Frequency</label>
                <select className={inputClass} value={form.payment_frequency} onChange={(e) => patch('payment_frequency', e.target.value)}>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="annual">Annual</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>Timing</label>
                <select className={inputClass} value={form.payment_timing} onChange={(e) => patch('payment_timing', e.target.value)}>
                  <option value="arrears">Arrears</option>
                  <option value="advance">Advance</option>
                </select>
              </div>
            </div>
            <div>
              <label className={labelClass}>Implicit rate (annual decimal, e.g. 0.055)</label>
              <input type="number" step="0.001" className={inputClass} value={form.interest_rate_implicit} onChange={(e) => patch('interest_rate_implicit', Number(e.target.value))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Fair value</label>
                <input type="number" className={inputClass} value={form.fair_value_of_asset} onChange={(e) => patch('fair_value_of_asset', Number(e.target.value))} />
              </div>
              <div>
                <label className={labelClass}>Carrying amount</label>
                <input type="number" className={inputClass} value={form.carrying_amount_of_asset} onChange={(e) => patch('carrying_amount_of_asset', Number(e.target.value))} />
              </div>
            </div>
            <div>
              <label className={labelClass}>Useful life (months)</label>
              <input type="number" className={inputClass} value={form.useful_life_months} onChange={(e) => patch('useful_life_months', Number(e.target.value))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>UGR</label>
                <input type="number" className={inputClass} value={form.unguaranteed_residual_value} onChange={(e) => patch('unguaranteed_residual_value', Number(e.target.value))} />
              </div>
              <div>
                <label className={labelClass}>Guaranteed residual</label>
                <input type="number" className={inputClass} value={form.guaranteed_residual_value} onChange={(e) => patch('guaranteed_residual_value', Number(e.target.value))} />
              </div>
            </div>
            <div>
              <label className={labelClass}>Initial direct costs</label>
              <input type="number" className={inputClass} value={form.initial_direct_costs} onChange={(e) => patch('initial_direct_costs', Number(e.target.value))} />
            </div>
            <label className="flex items-center gap-2 text-sm text-[#475569]">
              <input type="checkbox" checked={form.is_dealer_manufacturer} onChange={(e) => patch('is_dealer_manufacturer', e.target.checked)} />
              Dealer / manufacturer lessor
            </label>
            <div>
              <label className={labelClass}>Override classification</label>
              <select className={inputClass} value={form.lease_type_override} onChange={(e) => patch('lease_type_override', e.target.value)}>
                <option value="">Auto-classify</option>
                <option value="finance">Finance</option>
                <option value="operating">Operating</option>
              </select>
            </div>

            <div className="pt-2 border-t border-[#e2e8f0]">
              <p className="text-xs font-medium text-[#64748b] uppercase mb-2">Classification indicators (§62)</p>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {indicators.map((ind) => (
                  <label key={ind.key} className="flex items-start gap-2 text-sm text-[#475569]">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={selectedIndicators.includes(ind.key)}
                      onChange={(e) => {
                        setSelectedIndicators((prev) =>
                          e.target.checked ? [...prev, ind.key] : prev.filter((k) => k !== ind.key)
                        );
                      }}
                    />
                    <span>
                      {ind.label}
                      <span className="block text-xs text-[#94a3b8]">{ind.paragraph}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <Button onClick={runCalculate} disabled={calcLoading} className="w-full">
              {calcLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Calculator className="w-4 h-4 mr-2" />}
              Calculate
            </Button>
          </div>

          <div className="xl:col-span-2 space-y-6">
            {classify?.classification_tests && classify.classification_tests.length > 0 && (
              <div className={`${cardClass} p-6`}>
                <h2 className="font-semibold text-[#1e293b] mb-3 flex items-center gap-2">
                  <Info className="w-4 h-4 text-[#f97316]" /> Classification tests
                </h2>
                <div className="space-y-2">
                  {classify.classification_tests.map((t, i) => (
                    <div
                      key={i}
                      className={`flex flex-wrap justify-between gap-2 p-3 rounded-lg text-sm ${
                        t.triggered ? 'bg-amber-50 border border-amber-200' : 'bg-[#f8fafc] border border-[#e2e8f0]'
                      }`}
                    >
                      <span>{t.test}</span>
                      <span className="font-mono">{t.result}</span>
                      <span className="text-[#64748b]">{t.threshold}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {result && (
              <>
                <div className={`${cardClass} p-6`}>
                  <h2 className="font-semibold text-[#1e293b] mb-4 flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                    {String(summary.lease_type || 'Summary')}
                  </h2>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {Object.entries(summary)
                      .filter(([k]) => !['lease_type', 'currency', 'classification_basis', 'recognition_basis', 'income_recognition_basis'].includes(k))
                      .slice(0, 9)
                      .map(([k, v]) => (
                        <div key={k} className="p-3 bg-[#f8fafc] rounded-lg">
                          <p className="text-xs text-[#64748b] capitalize">{k.replace(/_/g, ' ')}</p>
                          <p className="font-mono font-semibold text-[#1e293b] text-sm mt-1">
                            {typeof v === 'number' && (k.includes('amount') || k.includes('income') || k.includes('investment') || k.includes('depreciation') || k.includes('contribution') || k.includes('profit'))
                              ? fmtMoney(v as number, String(summary.currency || form.currency))
                              : typeof v === 'boolean'
                                ? v ? 'Yes' : 'No'
                                : String(v)}
                          </p>
                        </div>
                      ))}
                  </div>
                </div>

                <div className={`${cardClass} p-6 overflow-x-auto`}>
                  <h2 className="font-semibold text-[#1e293b] mb-4">Period schedule</h2>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#e2e8f0] text-left text-[#64748b]">
                        {schedule[0] &&
                          Object.keys(schedule[0])
                            .filter((k) => k !== 'period')
                            .map((k) => (
                              <th key={k} className="py-2 pr-4 capitalize whitespace-nowrap">
                                {k.replace(/_/g, ' ')}
                              </th>
                            ))}
                      </tr>
                    </thead>
                    <tbody>
                      {schedule.slice(0, 24).map((row, i) => (
                        <tr key={i} className="border-b border-[#f1f5f9] font-mono text-xs">
                          {Object.entries(row)
                            .filter(([k]) => k !== 'period')
                            .map(([k, v]) => (
                              <td key={k} className="py-2 pr-4 whitespace-nowrap">
                                {typeof v === 'number' ? v.toLocaleString() : String(v)}
                              </td>
                            ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {schedule.length > 24 && (
                    <p className="text-xs text-[#64748b] mt-2">Showing first 24 of {schedule.length} periods</p>
                  )}
                </div>

                <div className={`${cardClass} p-6`}>
                  <h2 className="font-semibold text-[#1e293b] mb-4">Journal entries</h2>
                  <div className="space-y-4">
                    {journals.map((j, i) => (
                      <div key={i} className="border border-[#e2e8f0] rounded-lg p-4">
                        <p className="text-sm font-medium text-[#1e293b]">{String(j.description)}</p>
                        <p className="text-xs text-[#64748b] mb-2">{String(j.date)}</p>
                        <table className="w-full text-xs font-mono">
                          <thead>
                            <tr className="text-[#64748b]">
                              <th className="text-left py-1">Account</th>
                              <th className="text-right py-1">Debit</th>
                              <th className="text-right py-1">Credit</th>
                            </tr>
                          </thead>
                          <tbody>
                            {((j.entries as { account: string; debit: number; credit: number }[]) || []).map((e, jdx) => (
                              <tr key={jdx}>
                                <td className="py-1">{e.account}</td>
                                <td className="text-right py-1">{e.debit ? e.debit.toLocaleString() : '—'}</td>
                                <td className="text-right py-1">{e.credit ? e.credit.toLocaleString() : '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>
                  {journals.length > 0 && (
                    <FinReportAIPostButton
                      journalEntries={journals}
                      module={String(summary.lease_type || '').toLowerCase().includes('finance') ? 'lessor_finance' : 'lessor_operating'}
                      leaseName={form.asset_description}
                      company={form.lessee_name}
                      period={form.commencement_date.slice(0, 7)}
                      firmId={getLeaseRepositoryFirmId()}
                    />
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </SidebarLayout>
  );
}
