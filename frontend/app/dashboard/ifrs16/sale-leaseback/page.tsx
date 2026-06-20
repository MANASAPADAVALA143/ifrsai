'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { SidebarLayout } from '@/components/SidebarLayout';
import { Button } from '@/components/Button';
import { ifrs16SlbApi } from '@/lib/api';
import FinReportAIPostButton from '@/components/ifrs16/FinReportAIPostButton';
import { getLeaseRepositoryFirmId } from '@/lib/lease-repository';
import { ArrowLeftRight, Calculator, CheckCircle2, Info, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

const cardClass =
  'bg-white rounded-[14px] border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)]';
const inputClass =
  'w-full px-3 py-2 border border-[#e2e8f0] rounded-lg text-sm focus:ring-2 focus:ring-[#f97316]/30 focus:border-[#f97316]';
const labelClass = 'block text-xs font-medium text-[#64748b] uppercase tracking-wide mb-1';

type Indicator = { key: string; label: string; paragraph: string };

type FormState = {
  asset_description: string;
  asset_carrying_amount: number;
  fair_value_of_asset: number;
  sale_proceeds: number;
  transaction_date: string;
  leaseback_payment: number;
  leaseback_term_months: number;
  leaseback_payment_frequency: string;
  leaseback_payment_timing: string;
  ibr: number;
  leaseback_percentage: number;
  market_rent_per_period: number;
  buyer_has_present_right_to_payment: boolean;
  buyer_has_legal_title: boolean;
  buyer_has_physical_possession: boolean;
  buyer_has_risks_rewards: boolean;
  buyer_accepted_asset: boolean;
  failed_sale: boolean;
  currency: string;
};

const defaultForm: FormState = {
  asset_description: 'Dubai Office Tower — Floors 1–10',
  asset_carrying_amount: 5_000_000,
  fair_value_of_asset: 8_000_000,
  sale_proceeds: 8_000_000,
  transaction_date: '2024-01-01',
  leaseback_payment: 55_000,
  leaseback_term_months: 60,
  leaseback_payment_frequency: 'monthly',
  leaseback_payment_timing: 'arrears',
  ibr: 0.055,
  leaseback_percentage: 100,
  market_rent_per_period: 55_000,
  buyer_has_present_right_to_payment: true,
  buyer_has_legal_title: true,
  buyer_has_physical_possession: true,
  buyer_has_risks_rewards: true,
  buyer_accepted_asset: true,
  failed_sale: false,
  currency: 'AED',
};

function fmtMoney(n: number, ccy: string) {
  const v = Number(n) || 0;
  return `${ccy} ${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

export default function SaleLeasebackPage() {
  const [form, setForm] = useState<FormState>(defaultForm);
  const [indicators, setIndicators] = useState<Indicator[]>([]);
  const [assess, setAssess] = useState<Record<string, unknown> | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [assessLoading, setAssessLoading] = useState(false);
  const [calcLoading, setCalcLoading] = useState(false);

  const patch = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  useEffect(() => {
    void ifrs16SlbApi.getIndicators().then(({ data, error }) => {
      if (error) return;
      setIndicators(data?.indicators ?? []);
    });
  }, []);

  const assessPayload = useMemo(
    () => ({
      asset_carrying_amount: form.asset_carrying_amount,
      fair_value_of_asset: form.fair_value_of_asset,
      sale_proceeds: form.sale_proceeds,
      leaseback_payment: form.leaseback_payment,
      leaseback_term_months: form.leaseback_term_months,
      ibr: form.ibr,
      leaseback_payment_frequency: form.leaseback_payment_frequency,
      buyer_has_present_right_to_payment: form.buyer_has_present_right_to_payment,
      buyer_has_legal_title: form.buyer_has_legal_title,
      buyer_has_physical_possession: form.buyer_has_physical_possession,
      buyer_has_risks_rewards: form.buyer_has_risks_rewards,
      buyer_accepted_asset: form.buyer_accepted_asset,
      failed_sale: form.failed_sale,
      currency: form.currency,
    }),
    [form]
  );

  useEffect(() => {
    const t = setTimeout(() => {
      setAssessLoading(true);
      void ifrs16SlbApi.assess(assessPayload).then(({ data, error }) => {
        setAssessLoading(false);
        if (error) return;
        setAssess(data as Record<string, unknown>);
      });
    }, 400);
    return () => clearTimeout(t);
  }, [assessPayload]);

  const runCalculate = async () => {
    setCalcLoading(true);
    const payload = {
      ...form,
      leaseback_percentage: form.leaseback_percentage > 1 ? form.leaseback_percentage / 100 : form.leaseback_percentage,
    };
    const { data, error } = await ifrs16SlbApi.calculate(payload);
    setCalcLoading(false);
    if (error) {
      toast.error(error);
      return;
    }
    setResult(data?.result ?? null);
    toast.success('Sale & leaseback calculation complete');
  };

  const summary = (result?.summary as Record<string, unknown>) || {};
  const schedule = (result?.leaseback_schedule as Record<string, unknown>[]) || [];
  const journals = (result?.journal_entries as Record<string, unknown>[]) || [];
  const isSale = assess?.is_sale !== false && !form.failed_sale;
  const badgeClass = isSale
    ? 'bg-blue-100 text-blue-800 border-blue-200'
    : 'bg-amber-100 text-amber-900 border-amber-200';

  return (
    <SidebarLayout
      pageTitle="Sale & Leaseback"
      pageSubtitle="IFRS 16 §99–103 qualifying sale and IFRS 15 §B3–B8 failed sale"
    >
      <div className="space-y-6">
        <div className={`${cardClass} p-4 flex flex-wrap items-center gap-4`}>
          <ArrowLeftRight className="w-8 h-8 text-[#f97316]" />
          <div className="flex-1 min-w-[200px]">
            <p className="text-sm text-[#64748b]">
              UAE property disposals with leaseback require IFRS 15 control transfer assessment first,
              then IFRS 16 retained ROU and gain/loss split.
            </p>
          </div>
          <div className={`px-4 py-2 rounded-lg border text-sm font-semibold ${badgeClass}`}>
            {assessLoading ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Assessing…
              </span>
            ) : (
              String(assess?.verdict || '—')
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className={`${cardClass} p-6 xl:col-span-1 space-y-4`}>
            <h2 className="font-semibold text-[#1e293b]">Transaction inputs</h2>

            <div>
              <label className={labelClass}>Asset description</label>
              <input className={inputClass} value={form.asset_description} onChange={(e) => patch('asset_description', e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Carrying amount</label>
                <input type="number" className={inputClass} value={form.asset_carrying_amount} onChange={(e) => patch('asset_carrying_amount', Number(e.target.value))} />
              </div>
              <div>
                <label className={labelClass}>Fair value</label>
                <input type="number" className={inputClass} value={form.fair_value_of_asset} onChange={(e) => patch('fair_value_of_asset', Number(e.target.value))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Sale proceeds</label>
                <input type="number" className={inputClass} value={form.sale_proceeds} onChange={(e) => patch('sale_proceeds', Number(e.target.value))} />
              </div>
              <div>
                <label className={labelClass}>Transaction date</label>
                <input type="date" className={inputClass} value={form.transaction_date} onChange={(e) => patch('transaction_date', e.target.value)} />
              </div>
            </div>

            <div className="pt-2 border-t border-[#e2e8f0]">
              <p className="text-xs font-medium text-[#64748b] uppercase mb-2">Leaseback</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Payment / period</label>
                <input type="number" className={inputClass} value={form.leaseback_payment} onChange={(e) => patch('leaseback_payment', Number(e.target.value))} />
              </div>
              <div>
                <label className={labelClass}>Market rent / period</label>
                <input type="number" className={inputClass} value={form.market_rent_per_period} onChange={(e) => patch('market_rent_per_period', Number(e.target.value))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Term (months)</label>
                <input type="number" className={inputClass} value={form.leaseback_term_months} onChange={(e) => patch('leaseback_term_months', Number(e.target.value))} />
              </div>
              <div>
                <label className={labelClass}>Leaseback %</label>
                <input type="number" className={inputClass} value={form.leaseback_percentage} onChange={(e) => patch('leaseback_percentage', Number(e.target.value))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Frequency</label>
                <select className={inputClass} value={form.leaseback_payment_frequency} onChange={(e) => patch('leaseback_payment_frequency', e.target.value)}>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="annual">Annual</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>IBR (annual)</label>
                <input type="number" step="0.001" className={inputClass} value={form.ibr} onChange={(e) => patch('ibr', Number(e.target.value))} />
              </div>
            </div>
            <div>
              <label className={labelClass}>Currency</label>
              <input className={inputClass} value={form.currency} onChange={(e) => patch('currency', e.target.value)} />
            </div>

            <div className="pt-2 border-t border-[#e2e8f0]">
              <p className="text-xs font-medium text-[#64748b] uppercase mb-2">
                IFRS 15 control transfer ({String(assess?.ifrs15_indicators_met ?? 0)}/5 — need ≥3)
              </p>
              <div className="space-y-2 max-h-52 overflow-y-auto">
                {indicators.map((ind) => (
                  <label key={ind.key} className="flex items-start gap-2 text-sm text-[#475569]">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={form[ind.key as keyof FormState] as boolean}
                      onChange={(e) => patch(ind.key as keyof FormState, e.target.checked as FormState[keyof FormState])}
                    />
                    <span>
                      {ind.label}
                      <span className="block text-xs text-[#94a3b8]">{ind.paragraph}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-[#475569]">
              <input type="checkbox" checked={form.failed_sale} onChange={(e) => patch('failed_sale', e.target.checked)} />
              Force: Failed Sale (IFRS 15 §B3–B8)
            </label>

            <Button onClick={runCalculate} disabled={calcLoading} className="w-full">
              {calcLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Calculator className="w-4 h-4 mr-2" />}
              Calculate
            </Button>
          </div>

          <div className="xl:col-span-2 space-y-6">
            {assess && (
              <div className={`${cardClass} p-6`}>
                <h2 className="font-semibold text-[#1e293b] mb-3 flex items-center gap-2">
                  <Info className="w-4 h-4 text-[#f97316]" /> Live assessment
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {[
                    ['lease_liability', 'Lease liability'],
                    ['rou_asset', 'ROU asset'],
                    ['gain_loss_recognised', 'Gain/loss recognised'],
                    ['gain_loss_deferred', 'Gain/loss deferred'],
                    ['financial_liability', 'Financial liability'],
                    ['retained_proportion_pct', 'Retained %'],
                  ].map(([key, label]) => (
                    <div key={key} className="p-3 bg-[#f8fafc] rounded-lg">
                      <p className="text-xs text-[#64748b]">{label}</p>
                      <p className="font-mono font-semibold text-sm mt-1">
                        {key === 'retained_proportion_pct'
                          ? `${assess[key]}%`
                          : fmtMoney(Number(assess[key] || 0), String(assess.currency || form.currency))}
                      </p>
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
                    {String(summary.treatment || 'Results')}
                  </h2>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {Object.entries(summary)
                      .filter(([k]) => !['treatment', 'asset_description', 'currency'].includes(k))
                      .slice(0, 12)
                      .map(([k, v]) => (
                        <div key={k} className="p-3 bg-[#f8fafc] rounded-lg">
                          <p className="text-xs text-[#64748b] capitalize">{k.replace(/_/g, ' ')}</p>
                          <p className="font-mono font-semibold text-[#1e293b] text-sm mt-1">
                            {typeof v === 'number' && (k.includes('pct') ? `${v}%` : k.includes('amount') || k.includes('liability') || k.includes('proceeds') || k.includes('value') || k.includes('rent') || k.includes('financing') || k.includes('gain') || k.includes('rou') || k.includes('prepaid') ? fmtMoney(v, String(summary.currency || form.currency)) : v.toLocaleString())}
                            {typeof v === 'string' ? v : null}
                          </p>
                        </div>
                      ))}
                  </div>
                </div>

                {schedule.length > 0 && (
                  <div className={`${cardClass} p-6 overflow-x-auto`}>
                    <h2 className="font-semibold text-[#1e293b] mb-3">Leaseback schedule</h2>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-[#64748b] border-b border-[#e2e8f0]">
                          {Object.keys(schedule[0]).map((col) => (
                            <th key={col} className="py-2 pr-3 capitalize whitespace-nowrap">
                              {col.replace(/_/g, ' ')}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {schedule.slice(0, 24).map((row, i) => (
                          <tr key={i} className="border-b border-[#f1f5f9]">
                            {Object.values(row).map((val, j) => (
                              <td key={j} className="py-2 pr-3 font-mono text-xs whitespace-nowrap">
                                {typeof val === 'number' ? val.toLocaleString() : String(val)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {schedule.length > 24 && (
                      <p className="text-xs text-[#94a3b8] mt-2">Showing first 24 of {schedule.length} periods</p>
                    )}
                  </div>
                )}

                {journals.length > 0 && (
                  <div className={`${cardClass} p-6`}>
                    <h2 className="font-semibold text-[#1e293b] mb-3">Journal entries</h2>
                    {journals.map((entry, i) => (
                      <div key={i} className="mb-4 last:mb-0">
                        <p className="text-sm font-medium text-[#1e293b]">{String(entry.description)}</p>
                        <p className="text-xs text-[#94a3b8] mb-2">{String(entry.date)}</p>
                        <div className="space-y-1">
                          {((entry.lines as Record<string, unknown>[]) || []).map((line, j) => (
                            <div key={j} className="flex flex-wrap gap-4 text-xs font-mono bg-[#f8fafc] p-2 rounded">
                              <span className="flex-1">{String(line.account)}</span>
                              {Number(line.dr) > 0 && <span className="text-emerald-700">Dr {Number(line.dr).toLocaleString()}</span>}
                              {Number(line.cr) > 0 && <span className="text-red-700">Cr {Number(line.cr).toLocaleString()}</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {journals.length > 0 && (
                  <FinReportAIPostButton
                    journalEntries={journals}
                    module="sale_leaseback"
                    leaseName={form.asset_description}
                    company=""
                    period={form.transaction_date.slice(0, 7)}
                    firmId={getLeaseRepositoryFirmId()}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </SidebarLayout>
  );
}
