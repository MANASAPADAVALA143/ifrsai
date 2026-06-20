'use client';

import { useState } from 'react';
import { Button } from '@/components/Button';
import { ifrs16FinReportApi } from '@/lib/api';
import { AlertTriangle, CheckCircle2, Loader2, Send } from 'lucide-react';
import toast from 'react-hot-toast';

type RiskFlag = {
  account: string;
  amount: number;
  risk_score: number;
  flags: string[];
  level: 'high' | 'medium' | 'low';
};

type RiskSummary = {
  total_entries: number;
  risk_counts: { high: number; medium: number; low: number };
  flags: RiskFlag[];
  overall_risk: string;
  ready_to_post: boolean;
  total_flagged: number;
};

type Props = {
  journalEntries: unknown;
  module: string;
  leaseName: string;
  company?: string;
  period: string;
  firmId?: string;
  onPosted?: () => void;
};

function riskEmoji(level: string) {
  if (level === 'high') return '🔴';
  if (level === 'medium') return '🟡';
  return '🟢';
}

export default function FinReportAIPostButton({
  journalEntries,
  module,
  leaseName,
  company = '',
  period,
  firmId = 'default',
  onPosted,
}: Props) {
  const [step, setStep] = useState<'idle' | 'reviewed' | 'posted'>('idle');
  const [loading, setLoading] = useState(false);
  const [riskSummary, setRiskSummary] = useState<RiskSummary | null>(null);
  const [checkMessage, setCheckMessage] = useState('');
  const [glPosted, setGlPosted] = useState(false);

  const payload = {
    journal_entries: journalEntries,
    module,
    lease_name: leaseName,
    company,
    period,
    firm_id: firmId,
  };

  const runCheck = async () => {
    setLoading(true);
    const { data, error } = await ifrs16FinReportApi.check({
      journal_entries: journalEntries,
      module,
      lease_name: leaseName,
      company,
    });
    setLoading(false);
    if (error) {
      toast.error(error);
      return;
    }
    setRiskSummary((data?.risk_summary as RiskSummary) ?? null);
    setCheckMessage(String(data?.message ?? ''));
    setStep('reviewed');
  };

  const runPost = async (force = false) => {
    setLoading(true);
    const { data, error } = await ifrs16FinReportApi.post({ ...payload, force_post: force });
    setLoading(false);
    if (error) {
      toast.error(error);
      return;
    }
    const posted = Boolean(data?.gl_posted);
    setGlPosted(posted);
    setRiskSummary((data?.risk_summary as RiskSummary) ?? riskSummary);
    setCheckMessage(String(data?.message ?? ''));
    if (posted) {
      setStep('posted');
      toast.success('Posted to FinReportAI GL');
      onPosted?.();
    } else {
      toast.error(data?.message || 'Not posted — review high-risk entries');
    }
  };

  if (!journalEntries) return null;

  return (
    <div className="mt-4 p-4 rounded-xl border border-[#e2e8f0] bg-[#f8fafc]">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <p className="text-sm font-semibold text-[#1e293b]">Post to FinReportAI</p>
          <p className="text-xs text-[#64748b]">ML anomaly screening before GL post</p>
        </div>
        {step === 'idle' && (
          <Button onClick={runCheck} disabled={loading} size="sm">
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
            Review &amp; Post →
          </Button>
        )}
      </div>

      {step === 'reviewed' && riskSummary && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-3 text-sm">
            <span>🔴 High: {riskSummary.risk_counts.high}</span>
            <span>🟡 Medium: {riskSummary.risk_counts.medium}</span>
            <span>🟢 Low: {riskSummary.risk_counts.low}</span>
            <span className="text-[#64748b]">({riskSummary.total_entries} lines screened)</span>
          </div>
          {checkMessage && (
            <p className={`text-sm flex items-start gap-2 ${riskSummary.ready_to_post ? 'text-emerald-700' : 'text-amber-800'}`}>
              {riskSummary.ready_to_post ? (
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              )}
              {checkMessage}
            </p>
          )}
          {riskSummary.flags.length > 0 && (
            <div className="max-h-40 overflow-y-auto space-y-2">
              {riskSummary.flags.map((f, i) => (
                <div
                  key={i}
                  className={`text-xs p-2 rounded border ${
                    f.level === 'high'
                      ? 'bg-red-50 border-red-200'
                      : 'bg-amber-50 border-amber-200'
                  }`}
                >
                  <span className="mr-1">{riskEmoji(f.level)}</span>
                  <strong>{f.account}</strong> — score {f.risk_score}
                  {f.flags?.length > 0 && (
                    <span className="block text-[#64748b] mt-0.5">{f.flags.join(', ')}</span>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {riskSummary.ready_to_post ? (
              <Button onClick={() => runPost(false)} disabled={loading} size="sm">
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Confirm Post to FinReportAI GL →
              </Button>
            ) : (
              <Button onClick={() => runPost(true)} disabled={loading} size="sm" variant="secondary" className="border-amber-300 text-amber-900">
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Post anyway (override)
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={() => setStep('idle')}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {step === 'posted' && glPosted && (
        <p className="text-sm text-emerald-700 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          Journals posted to FinReportAI for period {period}.
        </p>
      )}
    </div>
  );
}
