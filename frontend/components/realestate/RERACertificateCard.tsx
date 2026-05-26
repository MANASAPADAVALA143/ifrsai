'use client';

import { Button } from '@/components/Button';
import { lowConfidenceFieldLabel } from '@/lib/spa-extraction-ui';

export type RERACertificateFields = {
  completion_pct?: number | null;
  certificate_date?: string | null;
  inspection_date?: string | null;
  certificate_ref?: string | null;
  rera_registration_number?: string | null;
  project_name?: string | null;
  developer_name?: string | null;
  authority_name?: string | null;
  inspector_name?: string | null;
  certificate_valid_until?: string | null;
  raw_completion_text?: string | null;
};

export type RERACertificateUploadResult = {
  success?: boolean;
  language_detected?: string;
  confidence_score?: number;
  fields?: RERACertificateFields;
  low_confidence_fields?: string[];
  warnings?: string[];
  extraction_method?: string;
  mismatch_detected?: boolean;
  mismatch_detail?: string | null;
};

function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso.slice(0, 10));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

type Props = {
  result: RERACertificateUploadResult;
  formCompletionPct: number;
  onUseCertificate: () => void;
  onKeepManual: () => void;
};

export function RERACertificateCard({ result, formCompletionPct, onUseCertificate, onKeepManual }: Props) {
  const fields = result.fields || {};
  const confidence = result.confidence_score ?? 0;
  const low = result.low_confidence_fields || [];

  if (result.success === false) {
    return (
      <div className="mt-4 p-4 rounded-lg border border-red-300 bg-red-50 text-red-900 text-sm" role="alert">
        <p className="font-semibold">Certificate could not be read</p>
        <p className="mt-1">
          {result.warnings?.[0] ||
            'Check the PDF is not password-protected and try again.'}
        </p>
      </div>
    );
  }

  if (result.mismatch_detected) {
    const certPct = fields.completion_pct ?? 0;
    const diff = Math.abs(certPct - formCompletionPct);
    return (
      <div className="mt-4 p-4 rounded-lg border border-amber-300 bg-amber-50 text-amber-950 text-sm" role="alert">
        <p className="font-semibold">⚠️ Completion % Mismatch Detected</p>
        <hr className="my-2 border-amber-200" />
        <p>Certificate shows: {certPct.toFixed(1)}%</p>
        <p>Form currently has: {formCompletionPct.toFixed(1)}%</p>
        <p>Difference: {diff.toFixed(1)} percentage points</p>
        <hr className="my-2 border-amber-200" />
        <div className="flex flex-wrap gap-2 mt-2">
          <Button variant="primary" size="sm" onClick={onUseCertificate}>
            Use Certificate Value: {certPct.toFixed(0)}%
          </Button>
          <Button variant="secondary" size="sm" onClick={onKeepManual}>
            Keep Manual: {formCompletionPct.toFixed(0)}%
          </Button>
        </div>
        {result.mismatch_detail ? <p className="text-xs mt-2 opacity-80">{result.mismatch_detail}</p> : null}
      </div>
    );
  }

  if (confidence < 0.7 || low.length > 0) {
    return (
      <div className="mt-4 p-4 rounded-lg border border-yellow-300 bg-yellow-50 text-yellow-950 text-sm">
        <p className="font-semibold">Partial certificate extraction — verify fields</p>
        <p className="text-xs mt-1">Confidence: {Math.round(confidence * 100)}%</p>
        <ul className="mt-2 space-y-1 text-xs">
          {fields.completion_pct != null && (
            <li>Completion: {fields.completion_pct}%</li>
          )}
          {fields.certificate_date && <li>Cert date: {fmtDate(fields.certificate_date)}</li>}
          {fields.certificate_ref && <li>Ref: {fields.certificate_ref}</li>}
          {low.map((f) => (
            <li key={f} className="text-amber-800">
              {lowConfidenceFieldLabel(f)} — verify manually
            </li>
          ))}
        </ul>
        <Button variant="primary" size="sm" className="mt-3" onClick={onUseCertificate}>
          Apply high-confidence fields
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-4 p-4 rounded-lg border border-green-300 bg-green-50 text-green-950 text-sm">
      <p className="font-semibold">✓ RERA Certificate Verified</p>
      <hr className="my-2 border-green-200" />
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <span className="text-green-800">Completion:</span>
        <span className="font-medium">{fields.completion_pct?.toFixed(1)}%</span>
        <span className="text-green-800">Cert Date:</span>
        <span>{fmtDate(fields.certificate_date)}</span>
        <span className="text-green-800">Cert Ref:</span>
        <span>{fields.certificate_ref || '—'}</span>
        <span className="text-green-800">Project:</span>
        <span>{fields.project_name || '—'}</span>
        <span className="text-green-800">Authority:</span>
        <span>{fields.authority_name || '—'}</span>
      </div>
      <hr className="my-2 border-green-200" />
      <p className="text-xs">✓ Completion % updated from certificate</p>
      <p className="text-xs">✓ Certificate date set as RERA completion date</p>
    </div>
  );
}
