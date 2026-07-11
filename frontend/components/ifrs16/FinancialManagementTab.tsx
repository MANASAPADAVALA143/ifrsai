'use client';

import { useMemo, useState } from 'react';
import { Info } from 'lucide-react';
import {
  currencyForMode,
  currencyModeFromForm,
  LeaseFormTabProps,
  symForCurrencyMode,
  type CurrencyMode,
} from './lease-form-shared';
import { FieldLabelWithExtraction } from './FieldLabelWithExtraction';
import {
  CollapsibleFormSection,
  ContextHelpCallout,
  TintedSectionCard,
} from './lease-form-ui';

const PAYMENT_FREQ = ['Monthly', 'Quarterly', 'Semi-Annual', 'Annual'];
const PAYMENT_TYPES = ['Advance', 'Arrears'];
const CURRENCIES = ['INR', 'USD', 'AED', 'GBP', 'EUR', 'SGD'];

type Props = LeaseFormTabProps & {
  sym?: string;
  onCurrencyModeChange?: (mode: CurrencyMode, sym: string) => void;
};

export function FinancialManagementTab({
  form,
  setForm,
  markDirty,
  inputClass,
  labelClass,
  onCurrencyModeChange,
  extractedConfidences,
  onClearExtractedField,
}: Props) {
  const [currencyMode, setCurrencyMode] = useState<CurrencyMode>(() =>
    currencyModeFromForm(form.currency)
  );

  const sym = symForCurrencyMode(currencyMode);

  const totalIDC = useMemo(
    () =>
      (parseFloat(form.legalFees ?? '0') || 0) +
      (parseFloat(form.brokerageFees ?? '0') || 0) +
      (parseFloat(form.otherInitialDirectCosts ?? '0') || 0),
    [form.legalFees, form.brokerageFees, form.otherInitialDirectCosts]
  );

  const setMode = (mode: CurrencyMode) => {
    setCurrencyMode(mode);
    const nextCurrency = currencyForMode(mode, form.currency || 'USD');
    setForm((p) => ({ ...p, currency: nextCurrency }));
    markDirty('financial');
    onCurrencyModeChange?.(mode, symForCurrencyMode(mode));
  };

  const amountLabel = (text: string) => (sym ? `${text} (${sym})` : text);

  return (
    <section className="mb-6 space-y-4">
      <TintedSectionCard
        title="Payment basics"
        icon={<span className="text-blue-500">💳</span>}
        badge={
          <span className="text-xs text-blue-600 bg-blue-100 px-2 py-0.5 rounded font-medium">
            Required for IFRS 16 calculation
          </span>
        }
        tintClass="bg-blue-50/60"
        borderClass="border-blue-100"
      >
        <ContextHelpCallout>
          Base rent, payment timing, currency and IBR determine the lease liability present value. Keep these
          fields current before calculating.
        </ContextHelpCallout>
        <div className="flex flex-wrap gap-1.5 mb-4">
          {(['AED', 'INR', 'GBP', 'OTHER'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setMode(mode)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                currencyMode === mode
                  ? 'bg-[#1B3A6B] text-white border-[#1B3A6B]'
                  : 'bg-white text-[#64748b] border-[#e2e8f0] hover:border-[#1B3A6B]'
              }`}
            >
              {mode === 'AED'
                ? '🇦🇪 UAE (AED)'
                : mode === 'INR'
                  ? '🇮🇳 India (INR)'
                  : mode === 'GBP'
                    ? '🇬🇧 UK (GBP)'
                    : '🌐 Other'}
            </button>
          ))}
        </div>

        <div className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded bg-white text-blue-700 border border-blue-200 mb-4">
          All amounts in {currencyMode}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
        <div>
          <FieldLabelWithExtraction field="baseRentAmount" extractedConfidences={extractedConfidences} required>
            {amountLabel('Base rent amount')}
          </FieldLabelWithExtraction>
          <input
            type="number"
            value={form.baseRentAmount}
            onChange={(e) => {
              setForm((p) => ({ ...p, baseRentAmount: e.target.value }));
              markDirty('financial');
              onClearExtractedField?.('baseRentAmount');
            }}
            className={inputClass}
          />
        </div>
        <div>
          <FieldLabelWithExtraction field="paymentFrequency" extractedConfidences={extractedConfidences} required>
            Payment frequency
          </FieldLabelWithExtraction>
          <select
            value={form.paymentFrequency}
            onChange={(e) => {
              setForm((p) => ({ ...p, paymentFrequency: e.target.value }));
              markDirty('financial');
            }}
            className={inputClass}
          >
            {PAYMENT_FREQ.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-bold text-gray-800 uppercase tracking-wide mb-1">
            Payment type <span className="text-[#DC2626] font-bold text-sm">*</span>
          </label>
          <select
            value={form.paymentType}
            onChange={(e) => {
              setForm((p) => ({ ...p, paymentType: e.target.value }));
              markDirty('financial');
            }}
            className={inputClass}
          >
            {PAYMENT_TYPES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </div>
        <div>
          <FieldLabelWithExtraction field="currency" extractedConfidences={extractedConfidences} required>
            Currency
          </FieldLabelWithExtraction>
          <select
            value={form.currency}
            onChange={(e) => {
              const c = e.target.value;
              setForm((p) => ({ ...p, currency: c }));
              setCurrencyMode(currencyModeFromForm(c));
              markDirty('financial');
              onClearExtractedField?.('currency');
            }}
            className={inputClass}
          >
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        </div>
      </TintedSectionCard>

      <CollapsibleFormSection
        title="Other contract amounts & FX"
        subtitle="Extended rent, exchange rates, rent-free periods and lease incentives"
        tintClass="bg-slate-50"
      >
        <ContextHelpCallout variant="tip">
          Use these fields only when the contract includes FX translation, rent-free months, or lessor incentives.
        </ContextHelpCallout>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
        <div>
          <label className={labelClass}>{amountLabel('Extended base rent')}</label>
          <input
            type="number"
            value={form.extendedBaseRentAmount}
            onChange={(e) => {
              setForm((p) => ({ ...p, extendedBaseRentAmount: e.target.value }));
              markDirty('financial');
            }}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Exchange rate</label>
          <input
            type="text"
            value={form.exchangeRate}
            onChange={(e) => {
              setForm((p) => ({ ...p, exchangeRate: e.target.value }));
              markDirty('financial');
            }}
            className={inputClass}
          />
        </div>
        <div>
          <FieldLabelWithExtraction field="rentFreeMonths" extractedConfidences={extractedConfidences}>
            Rent-free period (months)
          </FieldLabelWithExtraction>
          <input
            type="number"
            min="0"
            value={form.rentFreeMonths ?? 0}
            onChange={(e) => {
              setForm((p) => ({ ...p, rentFreeMonths: parseInt(e.target.value, 10) || 0 }));
              markDirty('financial');
              onClearExtractedField?.('rentFreeMonths');
            }}
            className={inputClass}
            placeholder="0"
          />
        </div>
        <div>
          <label className={labelClass}>{amountLabel('Cash incentive received')}</label>
          <input
            type="number"
            min="0"
            value={form.cashIncentive ?? form.leaseIncentives ?? '0'}
            onChange={(e) => {
              setForm((p) => ({ ...p, cashIncentive: e.target.value, leaseIncentives: e.target.value }));
              markDirty('financial');
            }}
            className={inputClass}
            placeholder="0"
          />
        </div>
        <div className="md:col-span-2">
          <label className={labelClass}>Lease incentive description</label>
          <input
            type="text"
            value={form.leaseIncentiveDescription ?? ''}
            onChange={(e) => {
              setForm((p) => ({ ...p, leaseIncentiveDescription: e.target.value }));
              markDirty('financial');
            }}
            className={inputClass}
            placeholder="e.g. 2 months rent free"
          />
        </div>
        </div>
      </CollapsibleFormSection>

      <CollapsibleFormSection
        title="Initial direct costs"
        subtitle="Legal fees, brokerage and other directly attributable costs"
        tintClass="bg-amber-50/60"
      >
        <ContextHelpCallout>
          Initial direct costs are added to the ROU asset at commencement under IFRS 16 para 24.
        </ContextHelpCallout>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
          <div>
            <FieldLabelWithExtraction field="legalFees" extractedConfidences={extractedConfidences}>
              <span className="inline-flex items-center gap-1">
                {amountLabel('Legal fees')}{' '}
                <Info className="inline w-3.5 h-3.5 text-[#64748b] cursor-help" />
              </span>
            </FieldLabelWithExtraction>
            <input
              type="number"
              min="0"
              value={form.legalFees ?? '0'}
              onChange={(e) => {
                setForm((p) => ({ ...p, legalFees: e.target.value }));
                markDirty('financial');
                onClearExtractedField?.('legalFees');
              }}
              className={inputClass}
            />
          </div>
          <div>
            <FieldLabelWithExtraction field="brokerageFees" extractedConfidences={extractedConfidences}>
              {amountLabel('Brokerage / agent fees')}
            </FieldLabelWithExtraction>
            <input
              type="number"
              min="0"
              value={form.brokerageFees ?? '0'}
              onChange={(e) => {
                setForm((p) => ({ ...p, brokerageFees: e.target.value }));
                markDirty('financial');
                onClearExtractedField?.('brokerageFees');
              }}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>{amountLabel('Other initial direct costs')}</label>
            <input
              type="number"
              min="0"
              value={form.otherInitialDirectCosts ?? '0'}
              onChange={(e) => {
                setForm((p) => ({ ...p, otherInitialDirectCosts: e.target.value }));
                markDirty('financial');
              }}
              className={inputClass}
            />
          </div>
          <div className="md:col-span-2">
            <label className={labelClass}>IDC description</label>
            <input
              type="text"
              value={form.initialDirectCostsDescription ?? ''}
              onChange={(e) => {
                setForm((p) => ({ ...p, initialDirectCostsDescription: e.target.value }));
                markDirty('financial');
              }}
              className={inputClass}
              placeholder="e.g. Legal fees for lease negotiation, agent commission"
            />
          </div>
        </div>

        <div className="flex justify-between items-center bg-white rounded-lg px-4 py-3 mt-3 border border-[#e2e8f0]">
          <div>
            <p className="text-sm text-[#64748b]">Total initial direct costs</p>
            <p className="text-xs text-[#64748b]/70 mt-0.5">
              Added to ROU asset on commencement — IFRS 16 para 24
            </p>
          </div>
          <p className="text-lg font-semibold text-[#f97316]">
            {sym ? `${sym} ` : ''}
            {totalIDC.toLocaleString()}
          </p>
        </div>
      </CollapsibleFormSection>
    </section>
  );
}

/** Hook-friendly sym resolver for sibling sections in the lease page */
export function useFinancialSym(form: Record<string, any>): string {
  return symForCurrencyMode(currencyModeFromForm(form.currency));
}
