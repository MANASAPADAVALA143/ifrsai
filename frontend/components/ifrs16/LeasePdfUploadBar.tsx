'use client';

import { useRef } from 'react';
import { FileText, Loader2, Upload, AlertCircle } from 'lucide-react';
import { confidenceLabel } from '@/lib/ifrs16-lease-extraction';

type Props = {
  uploading: boolean;
  uploadingSeconds?: number;
  uploadError: string | null;
  extractionSummary: { fieldCount: number; avgConfidence: number } | null;
  onFileSelect: (file: File) => void;
  compact?: boolean;
};

export function LeasePdfUploadBar({
  uploading,
  uploadingSeconds = 0,
  uploadError,
  extractionSummary,
  onFileSelect,
  compact = false,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onFileSelect(file);
    e.target.value = '';
  };

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx,.txt,.xlsx,.xls"
          className="hidden"
          onChange={handleChange}
          disabled={uploading}
        />
        <button
          type="button"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#e2e8f0] text-[#64748b] bg-white hover:border-[#f97316] hover:text-[#f97316] disabled:opacity-60"
        >
          {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          Upload PDF
        </button>
      </div>
    );
  }

  return (
    <div className="mb-6 rounded-xl border border-dashed border-[#f97316]/40 bg-gradient-to-r from-[#fff7ed] to-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex gap-3 min-w-0">
          <div className="shrink-0 p-2.5 rounded-lg bg-[#f97316]/10 text-[#f97316]">
            {uploading ? <Loader2 className="w-6 h-6 animate-spin" /> : <FileText className="w-6 h-6" />}
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-[#1e293b]">Upload Lease PDF</h2>
            <p className="text-sm text-[#64748b] mt-0.5 max-w-xl">
              AI extracts lessee, lessor, dates, rent, IBR, CPI escalation, renewal options and more.
              Supports English and Arabic UAE contracts — review fields before saving.
              <span className="block mt-1 text-xs text-[#94a3b8]">
                Large PDFs may take 2–5 minutes — please keep this tab open.
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
            accept=".pdf,.docx,.txt,.xlsx,.xls"
            className="hidden"
            onChange={handleChange}
            disabled={uploading}
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-lg text-white bg-gradient-to-r from-[#f97316] to-[#ef4444] hover:opacity-90 disabled:opacity-60 shadow-sm"
          >
            {uploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Extracting…{uploadingSeconds > 0 ? ` (${uploadingSeconds}s)` : ''}
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                Upload Lease PDF
              </>
            )}
          </button>
          <p className="text-[10px] text-[#94a3b8] text-center mt-1.5">PDF, DOCX, TXT, Excel</p>
        </div>
      </div>
    </div>
  );
}
