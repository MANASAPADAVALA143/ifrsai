'use client';

import { useRef } from 'react';
import { FileText, Loader2, Upload, AlertCircle } from 'lucide-react';
import { confidenceLabel } from '@/lib/ifrs15-contract-extraction';

type Props = {
  uploading: boolean;
  uploadingSeconds?: number;
  uploadError: string | null;
  extractionSummary: { fieldCount: number; avgConfidence: number } | null;
  onFileSelect: (file: File) => void;
};

export function ContractPdfUploadBar({
  uploading,
  uploadingSeconds = 0,
  uploadError,
  extractionSummary,
  onFileSelect,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onFileSelect(file);
    e.target.value = '';
  };

  return (
    <div className="mb-6 rounded-xl border border-dashed border-[#f97316]/40 bg-gradient-to-r from-[#fff7ed] to-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex gap-3 min-w-0">
          <div className="shrink-0 p-2.5 rounded-lg bg-[#f97316]/10 text-[#f97316]">
            {uploading ? <Loader2 className="w-6 h-6 animate-spin" /> : <FileText className="w-6 h-6" />}
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-[#1e293b]">Upload SPA / Contract PDF</h2>
            <p className="text-sm text-[#64748b] mt-0.5 max-w-xl">
              AI extracts RERA, Oqood, buyer, unit, contract value, payment plan, handover dates and IFRS 15
              fields. Supports English and Arabic UAE Sale & Purchase Agreements.
              <span className="block mt-1 text-xs text-[#94a3b8]">
                Large SPAs may take 2–5 minutes — please keep this tab open.
                {uploading && uploadingSeconds > 0 ? ` (${uploadingSeconds}s)` : ''}
              </span>
            </p>
            {extractionSummary && extractionSummary.fieldCount > 0 && (
              <p className="text-xs text-emerald-700 mt-2 font-medium">
                ✓ {extractionSummary.fieldCount} fields populated — average confidence{' '}
                {extractionSummary.avgConfidence}% ({confidenceLabel(extractionSummary.avgConfidence)})
              </p>
            )}
            {uploadError && (
              <div className="flex items-start gap-1.5 mt-2 text-sm text-red-600">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{uploadError}</span>
              </div>
            )}
          </div>
        </div>
        <div className="shrink-0">
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.doc,.docx,.txt"
            className="hidden"
            onChange={handleChange}
            disabled={uploading}
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-lg bg-[#f97316] text-white hover:bg-[#ea580c] disabled:opacity-60 shadow-sm"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {uploading ? 'Extracting…' : 'Choose PDF'}
          </button>
        </div>
      </div>
    </div>
  );
}
