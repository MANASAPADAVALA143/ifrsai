'use client';

import { useCallback } from 'react';
import {
  inputClassFilled,
  LeaseFormTabProps,
  monthsBetweenDates,
} from './lease-form-shared';
import { FieldLabelWithExtraction } from './FieldLabelWithExtraction';
import {
  CollapsibleFormSection,
  ContextHelpCallout,
  TintedSectionCard,
} from './lease-form-ui';

function HelperText({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] text-[#64748b] mt-1">{children}</p>;
}

const MOD_HINTS: Record<string, string> = {
  modificationDate: 'Fill if payment or term changed mid-lease',
  earlyTerminationDate: 'Fill if lease ended before original end date',
  extendedEndDate: 'Fill if renewal option was exercised',
  renewalDate: 'Date renewal was formally confirmed',
};
const TRANSACTION_TYPES = ['Lessee', 'Lessor', 'Sale & Leaseback'];
const LEASE_STATUS_OPTIONS = ['Active', 'Draft', 'Under Review', 'Terminated'];

export function ContractDetailsTab({
  form,
  setForm,
  markDirty,
  inputClass,
  labelClass,
  extractedConfidences,
  onClearExtractedField,
}: LeaseFormTabProps) {
  const patch = useCallback(
    (fields: Record<string, unknown>) => {
      setForm((p) => {
        const next = { ...p, ...fields };
        const start = String(fields.startDate ?? p.startDate ?? '');
        const end = String(fields.endDate ?? p.endDate ?? '');
        if ((fields.startDate != null || fields.endDate != null) && start && end) {
          next.lease_term_months = String(monthsBetweenDates(start, end));
        }
        return next;
      });
      markDirty('contract');
      Object.keys(fields).forEach((k) => onClearExtractedField?.(k));
    },
    [setForm, markDirty, onClearExtractedField]
  );

  const modCards: { key: string; label: string; value: string }[] = [
    { key: 'earlyTerminationDate', label: 'Early termination date', value: form.earlyTerminationDate || '' },
    { key: 'extendedEndDate', label: 'Extended end date', value: form.extendedEndDate || '' },
    { key: 'renewalDate', label: 'Renewal date', value: form.renewalDate || '' },
  ];

  return (
    <section className="mb-4 space-y-3">
      {/* Group A — Parties & identification */}
      <TintedSectionCard
        title="Parties & identification"
        icon={<span className="text-orange-500">📋</span>}
        tintClass="bg-slate-50"
        borderClass="border-slate-200"
      >
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <div>
            <label className={labelClass}>Transaction type</label>
            <select
              value={form.transactionType || 'Lessee'}
              onChange={(e) => patch({ transactionType: e.target.value })}
              className={inputClassFilled(inputClass, form.transactionType)}
            >
              {TRANSACTION_TYPES.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Legal entity</label>
            <input
              type="text"
              value={form.legalEntity || ''}
              onChange={(e) => patch({ legalEntity: e.target.value })}
              className={inputClassFilled(inputClass, form.legalEntity)}
            />
          </div>
          <div>
            <label className={labelClass}>Lease ID</label>
            <input
              type="text"
              value={form.leaseId || ''}
              readOnly
              className={inputClassFilled(inputClass, form.leaseId)}
            />
            <HelperText>Auto-generated — used in repository & reports</HelperText>
          </div>
          <div>
            <FieldLabelWithExtraction field="title" extractedConfidences={extractedConfidences}>
              Title
            </FieldLabelWithExtraction>
            <input
              type="text"
              value={form.title || ''}
              onChange={(e) => patch({ title: e.target.value })}
              className={inputClassFilled(inputClass, form.title)}
            />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mt-2">
          <div>
            <label className={labelClass}>Lease status</label>
            <select
              value={form.leaseStatus || 'Active'}
              onChange={(e) => patch({ leaseStatus: e.target.value })}
              className={inputClassFilled(inputClass, form.leaseStatus)}
            >
              {LEASE_STATUS_OPTIONS.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Modification date</label>
            <input
              type="date"
              value={form.modificationDate || ''}
              onChange={(e) => patch({ modificationDate: e.target.value })}
              className={inputClassFilled(inputClass, form.modificationDate)}
            />
            <HelperText>Only if terms changed after commencement</HelperText>
          </div>
        </div>
      </TintedSectionCard>

      {/* Group B — Core lease dates */}
      <TintedSectionCard
        title="Core lease dates"
        icon={<span className="text-blue-500">📅</span>}
        badge={
          <span className="text-xs text-blue-600 bg-blue-100 px-2 py-0.5 rounded font-medium">
            Required for IFRS 16 calculation
          </span>
        }
        tintClass="bg-blue-50"
        borderClass="border-blue-100"
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <div>
            <FieldLabelWithExtraction field="startDate" extractedConfidences={extractedConfidences} required>
              Commencement date
            </FieldLabelWithExtraction>
            <input
              type="date"
              value={form.startDate || ''}
              onChange={(e) => patch({ startDate: e.target.value })}
              className={inputClassFilled(inputClass, form.startDate)}
            />
            <HelperText>When you first control the asset — IFRS 16 para 13</HelperText>
          </div>
          <div>
            <FieldLabelWithExtraction field="endDate" extractedConfidences={extractedConfidences} required>
              End date
            </FieldLabelWithExtraction>
            <input
              type="date"
              value={form.endDate || ''}
              onChange={(e) => patch({ endDate: e.target.value })}
              className={inputClassFilled(inputClass, form.endDate)}
            />
            <HelperText>Last payment date of original term</HelperText>
          </div>
          <div>
            <FieldLabelWithExtraction field="lease_term_months" extractedConfidences={extractedConfidences} required>
              Lease term (months)
            </FieldLabelWithExtraction>
            <input
              type="number"
              min={1}
              value={form.lease_term_months || ''}
              onChange={(e) => {
                setForm((p) => ({ ...p, lease_term_months: e.target.value }));
                markDirty('contract');
              }}
              className={inputClassFilled(inputClass, form.lease_term_months)}
            />
            <HelperText>Auto-calculated from dates above</HelperText>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
          <div>
            <label className={labelClass}>Effective date</label>
            <input
              type="date"
              value={form.effectiveDate || ''}
              onChange={(e) => patch({ effectiveDate: e.target.value })}
              className={inputClassFilled(inputClass, form.effectiveDate)}
            />
          </div>
          <div>
            <label className={labelClass}>Payment date</label>
            <input
              type="date"
              value={form.paymentDate || ''}
              onChange={(e) => patch({ paymentDate: e.target.value })}
              className={inputClassFilled(inputClass, form.paymentDate)}
            />
          </div>
        </div>
      </TintedSectionCard>

      {/* Section — Modification & exit dates (collapsed) */}
      <CollapsibleFormSection
        title="Modification & exit dates"
        subtitle="Only if modified, terminated early, extended or renewed"
        tintClass="bg-gray-50"
      >
        <ContextHelpCallout>
          Complete these only if this lease has been modified, terminated early, extended or renewed. Leave
          blank for a standard active lease.
        </ContextHelpCallout>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {modCards.map((card) => (
            <div key={card.key} className="rounded-lg p-3 bg-white border border-[#e2e8f0]">
              <div className="flex justify-between items-start gap-2 mb-2">
                <span className="text-sm font-medium text-[#1e293b]">{card.label}</span>
                <span className="text-[10px] text-[#64748b] shrink-0">{MOD_HINTS[card.key]}</span>
              </div>
              <input
                type="date"
                value={card.value}
                onChange={(e) => patch({ [card.key]: e.target.value })}
                className={inputClassFilled(inputClass, card.value)}
              />
            </div>
          ))}
        </div>
      </CollapsibleFormSection>

      {/* Section — UAE-specific details (collapsed) */}
      <CollapsibleFormSection
        title="UAE-specific details"
        subtitle="Dubai / RERA real estate leases"
        tintClass="bg-amber-50/60"
      >
        <ContextHelpCallout variant="tip">
          <strong>RERA registration</strong> links the lease to Dubai Land Department records — required for UAE
          real estate audits and escrow compliance. Contract sealing date/location support legal enforceability
          under UAE property law.
        </ContextHelpCallout>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <div>
            <label className={labelClass}>RERA registration no</label>
            <input
              type="text"
              placeholder="e.g. DLD-2022-001234"
              value={form.reraRegistrationNo || ''}
              onChange={(e) => patch({ reraRegistrationNo: e.target.value })}
              className={inputClassFilled(inputClass, form.reraRegistrationNo)}
            />
            <HelperText>Dubai Land Dept / RERA number — required for UAE real estate</HelperText>
          </div>
          <div>
            <label className={labelClass}>Contract sealing date</label>
            <input
              type="date"
              value={form.contractSealingDate || ''}
              onChange={(e) => patch({ contractSealingDate: e.target.value })}
              className={inputClassFilled(inputClass, form.contractSealingDate)}
            />
            <HelperText>Date contract was officially notarised</HelperText>
          </div>
          <div>
            <label className={labelClass}>Contract sealing location</label>
            <input
              type="text"
              placeholder="e.g. Dubai Land Department — Deira"
              value={form.contractSealingLocation || ''}
              onChange={(e) => patch({ contractSealingLocation: e.target.value })}
              className={inputClassFilled(inputClass, form.contractSealingLocation)}
            />
          </div>
        </div>
      </CollapsibleFormSection>

      {/* Section — Other contract amounts (collapsed) */}
      <CollapsibleFormSection
        title="Other contract amounts"
        subtitle="Residual value, purchase options & contract reduction"
        tintClass="bg-slate-50"
      >
        <ContextHelpCallout>
          Include residual value guarantees and purchase options only if they affect lease classification or
          liability measurement under IFRS 16 paras 26–27.
        </ContextHelpCallout>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          <div>
            <label className={labelClass}>Residual value</label>
            <input
              type="number"
              value={form.residualValue || ''}
              onChange={(e) => patch({ residualValue: e.target.value })}
              className={inputClassFilled(inputClass, form.residualValue)}
            />
          </div>
          <div>
            <label className={labelClass}>Optional purchase price</label>
            <input
              type="number"
              value={form.optionalPurchasePrice || ''}
              onChange={(e) => patch({ optionalPurchasePrice: e.target.value })}
              className={inputClassFilled(inputClass, form.optionalPurchasePrice)}
            />
          </div>
        </div>
        <label className="flex items-center gap-2 mt-3 text-sm text-[#1e293b]">
          <input
            type="checkbox"
            checked={Boolean(form.enableContractReduction)}
            onChange={(e) => patch({ enableContractReduction: e.target.checked })}
          />
          Enable contract reduction
        </label>
      </CollapsibleFormSection>
    </section>
  );
}
