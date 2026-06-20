'use client';

import { confidenceLabel } from '@/lib/ifrs16-lease-extraction';

type Props = {
  confidence?: number;
  className?: string;
};

export function ExtractedFieldBadge({ confidence, className = '' }: Props) {
  if (confidence == null) return null;
  const label = confidenceLabel(confidence);
  const color =
    confidence >= 80
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : confidence >= 50
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-red-50 text-red-600 border-red-200';

  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border ${color} ${className}`}
      title={`Extracted from PDF — ${label} confidence (${confidence}%)`}
    >
      <span aria-hidden>✦</span>
      PDF {confidence}%
    </span>
  );
}
