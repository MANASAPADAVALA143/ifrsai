/** SPA Arabic/bilingual extraction — UI helpers (session state only). */

export type ExtractionMeta = {
  language_detected?: string;
  confidence_score?: number;
  extraction_method?: string;
  low_confidence_fields?: string[];
  fallback_triggered?: boolean;
  fallback_reason?: string;
  warnings?: string[];
  success?: boolean;
};

const FIELD_LABELS: Record<string, string> = {
  contract_price_aed: 'Contract Price',
  handover_date: 'Handover Date',
  buyer_name: 'Buyer Name',
  developer_name: 'Developer Name',
  unit_number: 'Unit Number',
  rera_registration_number: 'RERA Registration Number',
  project_name: 'Project Name',
};

/** Maps backend low-confidence field names to form state keys. */
export const LOW_CONFIDENCE_FORM_KEYS: Record<string, string> = {
  contract_price_aed: 'contractValue',
  handover_date: 'expectedHandover',
  buyer_name: 'buyer_name',
  developer_name: 'developer_name',
  unit_number: 'unit_number',
  rera_registration_number: 'reraNumber',
  project_name: 'projectName',
};

export function lowConfidenceFieldLabel(fieldName: string): string {
  return FIELD_LABELS[fieldName] || fieldName.replace(/_/g, ' ');
}

export function languageBadgeLabel(lang?: string, partial?: boolean): string | null {
  if (!lang || lang === 'english') return null;
  if (lang === 'arabic') return '🇦🇪 Arabic';
  if (lang === 'bilingual') {
    return partial ? '🇦🇪 Bilingual PDF — partial extraction' : '🇦🇪 Bilingual';
  }
  if (lang === 'unknown') return '? Language undetected';
  return null;
}

export function successBadgeLabel(lang?: string): string | null {
  if (lang === 'arabic' || lang === 'bilingual') return '🇦🇪 Arabic PDF — extracted successfully';
  return null;
}

export function highlightLowConfidenceField(
  fieldName: string,
  lowConfidenceFields: string[],
  clearedHighlights: Set<string>
): boolean {
  if (clearedHighlights.has(fieldName)) return false;
  return lowConfidenceFields.includes(fieldName);
}

export function fieldVerifyClass(active: boolean): string {
  return active ? 'field-verify border-2 border-amber-400' : 'border border-border-default';
}
