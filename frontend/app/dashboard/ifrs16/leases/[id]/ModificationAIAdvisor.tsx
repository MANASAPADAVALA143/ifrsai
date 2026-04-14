'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/Button';
import { ifrs16Api } from '@/lib/api';

export type ModificationAdvice = {
  recommended_type: string;
  ifrs_reference: string;
  treatment_label: string;
  confidence: string;
  headline: string;
  reasoning: string[];
  user_action_required: string;
  journal_hint: string;
  signals: { source: string; field: string; description: string }[];
};

type Props = {
  extractorHints: Record<string, unknown> | null;
  /** Merged hints from contract JSON + form fields (renewal, termination, etc.) */
  formOverlay?: Record<string, unknown>;
  modificationInputs: {
    modification_type: string;
    scope_change?: boolean | null;
    new_payment?: number | null;
    original_payment?: number | null;
    new_lease_term_months?: number | null;
    original_lease_term_months?: number | null;
  };
  currentModificationType: string;
  onAccept: (recommendedType: string) => void;
  onDismiss?: () => void;
};

function mergeHints(
  base: Record<string, unknown> | null,
  overlay?: Record<string, unknown>
): Record<string, unknown> {
  return { ...(base || {}), ...(overlay || {}) };
}

export function ModificationAIAdvisor({
  extractorHints,
  formOverlay,
  modificationInputs,
  currentModificationType,
  onAccept,
  onDismiss,
}: Props) {
  const [advice, setAdvice] = useState<ModificationAdvice | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const mergedHints = useMemo(
    () => mergeHints(extractorHints, formOverlay),
    [extractorHints, formOverlay]
  );

  const payloadKey = useMemo(
    () =>
      JSON.stringify({
        h: mergedHints,
        m: modificationInputs,
      }),
    [mergedHints, modificationInputs]
  );

  const fetchAdvice = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await ifrs16Api.modificationAdvice({
      extractor_hints: mergedHints,
      modification_inputs: modificationInputs,
    });
    setLoading(false);
    if (err) {
      setAdvice(null);
      setError(err);
      return;
    }
    setAdvice(data as ModificationAdvice);
  }, [mergedHints, modificationInputs]);

  useEffect(() => {
    fetchAdvice();
  }, [payloadKey, fetchAdvice]);

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="mb-4 flex items-center gap-2 rounded-lg border border-[#fed7aa] bg-[#fff7ed] px-3 py-2 text-sm font-medium text-[#9a3412] hover:bg-[#ffedd5]"
      >
        <Sparkles className="h-4 w-4" />
        Show modification advisor
      </button>
    );
  }

  return (
    <div className="mb-6 rounded-xl border border-[#fed7aa] bg-gradient-to-br from-[#fffbeb] to-[#fff7ed] p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 shrink-0 text-[#ea580c]" />
          <div>
            <h5 className="text-sm font-semibold text-[#1e293b]">Modification advisor (IFRS 16 Section 44 / 45)</h5>
            <p className="text-xs text-[#64748b]">Based on contract extraction hints and the values below.</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="rounded p-1 text-[#64748b] hover:bg-white/80 hover:text-[#1e293b]"
            aria-label="Minimize advisor"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 py-4 text-sm text-[#64748b]">
          <Loader2 className="h-4 w-4 animate-spin text-[#f97316]" />
          Analysing treatment…
        </div>
      )}

      {error && !loading && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      )}

      {!loading && advice && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-[#c2410c] ring-1 ring-[#fed7aa]">
              {advice.ifrs_reference.replace(/\u00a7/g, 'Section ')}
            </span>
            <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-medium text-[#64748b] ring-1 ring-[#e2e8f0]">
              Confidence: {advice.confidence}
            </span>
            {currentModificationType === advice.recommended_type && (
              <span className="text-xs font-medium text-emerald-700">Matches your modification type</span>
            )}
          </div>
          <p className="text-sm font-medium text-[#1e293b]">{advice.headline}</p>
          <p className="text-xs font-semibold uppercase tracking-wide text-[#64748b]">{advice.treatment_label}</p>
          <ul className="list-inside list-disc space-y-1 text-sm text-[#475569]">
            {advice.reasoning.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
          {advice.journal_hint ? (
            <div className="rounded-lg border border-[#e2e8f0] bg-white/90 px-3 py-2 text-sm text-[#334155]">
              <span className="font-semibold text-[#64748b]">Journal hint: </span>
              {advice.journal_hint}
            </div>
          ) : null}
          {advice.user_action_required ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              <span className="font-semibold">Confirm: </span>
              {advice.user_action_required}
            </div>
          ) : null}
          {advice.signals?.length > 0 && (
            <details className="text-xs text-[#64748b]">
              <summary className="cursor-pointer font-medium text-[#475569]">Signals used ({advice.signals.length})</summary>
              <ul className="mt-2 space-y-1 pl-2">
                {advice.signals.map((s, i) => (
                  <li key={i}>
                    <span className="font-mono text-[#94a3b8]">{s.field}</span> — {s.description}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              type="button"
              className="bg-[#f97316] text-white hover:bg-[#ea580c]"
              onClick={() => onAccept(advice.recommended_type)}
            >
              Apply recommendation ({advice.recommended_type})
            </Button>
            {onDismiss ? (
              <Button type="button" variant="secondary" onClick={onDismiss}>
                Dismiss banner
              </Button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
