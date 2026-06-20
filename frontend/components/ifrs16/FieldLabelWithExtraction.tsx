'use client';

import { ExtractedFieldBadge } from './ExtractedFieldBadge';
import type { ExtractionConfidenceMap } from '@/lib/ifrs16-lease-extraction';

type Props = {
  field: string;
  extractedConfidences?: ExtractionConfidenceMap;
  className?: string;
  children: React.ReactNode;
  required?: boolean;
};

export function FieldLabelWithExtraction({
  field,
  extractedConfidences,
  className = '',
  children,
  required,
}: Props) {
  const confidence = extractedConfidences?.[field];
  return (
    <div className={`flex flex-wrap items-center gap-1.5 mb-1 ${className}`}>
      <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-600">
        {children}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <ExtractedFieldBadge confidence={confidence} />
    </div>
  );
}
