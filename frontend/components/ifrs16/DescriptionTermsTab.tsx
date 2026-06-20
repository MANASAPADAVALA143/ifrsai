'use client';

import { LeaseFormTabProps } from './lease-form-shared';
import { FieldLabelWithExtraction } from './FieldLabelWithExtraction';

type ClauseCardConfig = {
  title: string;
  tag: string;
  tagStyle: string;
  exampleText: string;
  placeholder: string;
  fieldName: keyof typeof FIELD_MAP;
  warningText?: string;
};

const FIELD_MAP = {
  description: 'description',
  terminationClauses: 'terminationClauses',
  renewalOptions: 'renewalOptions',
  restorationObligations: 'restorationObligations',
} as const;

const CARDS: ClauseCardConfig[] = [
  {
    title: 'Lease description',
    tag: 'Optional',
    tagStyle: 'bg-[#f1f5f9] text-[#64748b]',
    exampleText:
      'e.g. Office space Floor 22, Business Bay Tower B. 4,500 sqft. Includes 3 car park bays and shared reception.',
    placeholder: 'Describe the leased asset — floor, size, inclusions, key terms...',
    fieldName: 'description',
  },
  {
    title: 'Termination clauses',
    tag: 'RERA relevant',
    tagStyle: 'bg-[#FAEEDA] text-[#854F0B]',
    exampleText:
      'e.g. Tenant may terminate with 3 months written notice after Year 2. Penalty: 3 months rent = AED 585,000.',
    placeholder: 'State notice period, penalty amount (AED), and when break clause applies...',
    fieldName: 'terminationClauses',
    warningText:
      'If penalty exists — enter AED amount in Financial Management tab. It affects lease liability calculation.',
  },
  {
    title: 'Renewal options',
    tag: 'Optional',
    tagStyle: 'bg-[#f1f5f9] text-[#64748b]',
    exampleText:
      'e.g. Tenant has option to renew for 5 years at market rent. 6 months notice required. Reasonably certain to exercise: Yes.',
    placeholder:
      'State renewal term, rent basis, notice period, and whether reasonably certain to exercise...',
    fieldName: 'renewalOptions',
    warningText: 'If renewal is reasonably certain — include in lease term. Update End Date in Contract Details tab.',
  },
  {
    title: 'Restoration obligations',
    tag: 'RERA relevant',
    tagStyle: 'bg-[#FAEEDA] text-[#854F0B]',
    exampleText:
      'e.g. Tenant must restore premises on exit. Estimated cost: AED 120,000. Discount rate 5% over 5 years.',
    placeholder: 'State if restoration required, estimated cost (AED), and timing...',
    fieldName: 'restorationObligations',
    warningText:
      'Restoration cost must be present-valued and added to ROU asset — IFRS 16 para 24(d).',
  },
];

export function DescriptionTermsTab({
  form,
  setForm,
  markDirty,
  inputClass,
  extractedConfidences,
  onClearExtractedField,
}: LeaseFormTabProps) {
  return (
    <section className="mb-6">
      {CARDS.map((card) => {
        const key = FIELD_MAP[card.fieldName];
        const value = String(form[key] ?? '');
        return (
          <div key={key} className="border border-[#e2e8f0] rounded-lg p-4 mb-3">
            <div className="flex justify-between items-center mb-2">
              <FieldLabelWithExtraction field={key} extractedConfidences={extractedConfidences} className="mb-0">
                <span className="text-sm font-medium text-[#1e293b] normal-case tracking-normal">{card.title}</span>
              </FieldLabelWithExtraction>
              <span className={`text-xs px-2 py-0.5 rounded ${card.tagStyle}`}>{card.tag}</span>
            </div>
            <p className="text-xs text-[#64748b] italic mb-2">{card.exampleText}</p>
            <textarea
              rows={2}
              placeholder={card.placeholder}
              value={value}
              onChange={(e) => {
                setForm((p) => ({ ...p, [key]: e.target.value }));
                markDirty('contract');
                onClearExtractedField?.(key);
              }}
              className={`w-full text-sm border border-[#e2e8f0] rounded-lg p-2 resize-none focus:ring-2 focus:ring-[#f97316]/30 focus:border-[#f97316] ${inputClass.includes('w-full') ? '' : ''}`}
            />
            {card.warningText && (
              <p className="text-xs text-amber-700 mt-1.5">⚠ {card.warningText}</p>
            )}
          </div>
        );
      })}
    </section>
  );
}
