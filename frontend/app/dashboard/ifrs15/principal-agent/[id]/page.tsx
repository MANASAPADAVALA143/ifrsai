'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { Download, GitFork, Loader2 } from 'lucide-react';
import { SidebarLayout } from '@/components/SidebarLayout';
import { Ifrs15WorkspaceShell } from '@/components/ifrs15/Ifrs15WorkspaceShell';
import { Button } from '@/components/Button';
import { ifrs15Api } from '@/lib/api';

type AuditRow = {
  id?: string;
  action?: string;
  actor?: string;
  note?: string;
  created_at?: string;
};

function aed(n: unknown): string {
  if (n == null || n === '' || Number.isNaN(Number(n))) return '—';
  return `AED ${Number(n).toLocaleString('en-AE', { maximumFractionDigits: 0 })}`;
}

function signed(n: unknown): string {
  const v = Number(n || 0);
  return `${v >= 0 ? '+' : ''}${v}`;
}

function determinationMeta(d?: unknown) {
  const v = String(d || '');
  if (v === 'principal') return { label: 'PRINCIPAL — Gross', cls: 'bg-green-100 text-green-800' };
  if (v === 'agent') return { label: 'AGENT — Net', cls: 'bg-red-100 text-red-800' };
  if (v === 'judgment_required') return { label: 'JUDGMENT REQUIRED', cls: 'bg-amber-100 text-amber-800' };
  return { label: 'Unassessed', cls: 'bg-gray-100 text-gray-600' };
}

const STEPS = [
  { key: 'draft', label: 'Draft' },
  { key: 'ai_assessed', label: 'AI Assessed' },
  { key: 'under_review', label: 'Under Review' },
  { key: 'approved', label: 'Approved' },
] as const;

function stepDone(status: string, key: string): boolean {
  const order = ['draft', 'ai_assessed', 'under_review', 'approved'];
  const idx = Math.max(0, order.indexOf(status === 'draft' ? 'draft' : status));
  const need: Record<string, number> = { draft: 0, ai_assessed: 1, under_review: 2, approved: 3 };
  return idx >= (need[key] ?? 99);
}

export default function PrincipalAgentDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [loading, setLoading] = useState(true);
  const [row, setRow] = useState<Record<string, unknown> | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [actor, setActor] = useState('Finance');
  const [overrideDet, setOverrideDet] = useState('principal');
  const [overrideReason, setOverrideReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const { data, error } = await ifrs15Api.paFullGet(id);
    if (error) toast.error(error);
    setRow((data?.assessment || null) as Record<string, unknown> | null);
    setAudit((data?.audit_trail || []) as AuditRow[]);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const status = String(row?.status || 'draft');
  const det = String(row?.final_determination || row?.ai_determination || '');
  const meta = determinationMeta(det);
  const canApprove = det !== 'judgment_required' || Boolean(row?.human_determination);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      await load();
    } finally {
      setBusy(false);
    }
  };

  const downloadPdf = async () => {
    if (!id) return;
    const { blob, filename, error } = await ifrs15Api.paFullMemoPdf(id);
    if (error || !blob) {
      toast.error(error || 'PDF download failed');
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'pa_memo.pdf';
    a.click();
    URL.revokeObjectURL(url);
  };

  const kpiItems = [
    { label: 'Status', value: status.replace('_', ' '), accent: 'orange' as const },
    { label: 'Determination', value: meta.label.replace(' — Gross', '').replace(' — Net', ''), accent: 'orange' as const },
    { label: 'Score', value: signed(row?.total_score), accent: 'orange' as const },
    { label: 'Rev. difference', value: aed(row?.revenue_difference), accent: 'pink' as const },
  ];

  return (
    <SidebarLayout pageTitle="P vs A detail" pageSubtitle="IFRS 15.B34–B38 workpaper">
      <Ifrs15WorkspaceShell activeNavId="principal-agent" kpiItems={kpiItems}>
        <div className="flex items-center justify-between gap-2">
          <div>
            <Link href="/dashboard/ifrs15/principal-agent" className="text-xs text-teal-700 font-semibold hover:underline">
              ← All assessments
            </Link>
            <h1 className="text-xl font-bold text-[#1e293b] flex items-center gap-2 mt-1">
              <GitFork className="w-5 h-5 text-teal-600" />
              {String(row?.assessment_ref || 'Assessment')}
            </h1>
          </div>
        </div>

        {loading || !row ? (
          <div className="flex items-center gap-2 text-sm text-[#64748b] py-10">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[65fr_35fr] gap-4">
            <div className="space-y-3">
              <div className="bg-white border border-[#e2e8f0] rounded-lg p-4 text-sm">
                <p className="text-xs font-bold uppercase text-[#64748b] mb-2">Assessment facts</p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div><span className="text-[#64748b]">Date</span><p className="font-medium">{String(row.assessment_date || '—')}</p></div>
                  <div><span className="text-[#64748b]">Type</span><p className="font-medium">{String(row.contract_type || '—')}</p></div>
                  <div><span className="text-[#64748b]">Customer</span><p className="font-medium">{String(row.customer_name || '—')}</p></div>
                  <div><span className="text-[#64748b]">Counterparty</span><p className="font-medium">{String(row.counterparty_name || '—')}</p></div>
                  <div className="col-span-2"><span className="text-[#64748b]">Transaction</span><p className="font-medium">{String(row.transaction_description || '—')}</p></div>
                  <div><span className="text-[#64748b]">Gross amount</span><p className="font-medium">{aed(row.gross_amount)}</p></div>
                  <div><span className="text-[#64748b]">Commission rate</span><p className="font-medium">{row.commission_rate != null ? `${(Number(row.commission_rate) * 100).toFixed(2)}%` : '—'}</p></div>
                </div>
              </div>

              <div className="bg-white border border-[#e2e8f0] rounded-lg p-4 text-sm">
                <p className="text-xs font-bold uppercase text-[#64748b] mb-2">Indicator scoring</p>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[#64748b]">
                      <th className="py-1">Indicator</th>
                      <th>Input</th>
                      <th className="text-right">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t">
                      <td className="py-2">Primary responsibility (B37a)</td>
                      <td>{String(row.indicator_1_responsibility || '')}</td>
                      <td className="text-right font-mono">{signed(row.indicator_1_score)}</td>
                    </tr>
                    <tr className="border-t">
                      <td className="py-2">Inventory risk (B37b)</td>
                      <td>{String(row.indicator_2_inventory || '')}</td>
                      <td className="text-right font-mono">{signed(row.indicator_2_score)}</td>
                    </tr>
                    <tr className="border-t">
                      <td className="py-2">Pricing discretion (B37c)</td>
                      <td>{String(row.indicator_3_pricing || '')}</td>
                      <td className="text-right font-mono">{signed(row.indicator_3_score)}</td>
                    </tr>
                    <tr className="border-t font-bold bg-slate-50">
                      <td className="py-2" colSpan={2}>Total</td>
                      <td className="text-right font-mono">{signed(row.total_score)} / +6</td>
                    </tr>
                  </tbody>
                </table>
                <p className="text-[11px] text-[#64748b] mt-2">{String(row.indicator_1_notes || '')}</p>
                <p className="text-[11px] text-[#64748b]">{String(row.indicator_2_notes || '')}</p>
                <p className="text-[11px] text-[#64748b]">{String(row.indicator_3_notes || '')}</p>
              </div>

              <div className="bg-white border border-[#e2e8f0] rounded-lg p-4 text-sm space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold uppercase text-[#64748b]">AI assessment</p>
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${meta.cls}`}>{meta.label}</span>
                </div>
                <p className="text-xs leading-relaxed text-[#334155]">{String(row.ai_reasoning || '')}</p>
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs">
                  <p className="font-semibold text-amber-900">Revenue impact (materiality)</p>
                  <p>Gross: {aed(row.gross_amount)} · Net: {aed(row.net_revenue)}</p>
                  <p className="font-bold text-amber-800">Difference: {aed(row.revenue_difference)}</p>
                  <p className="mt-1">{String(row.ai_revenue_impact || '')}</p>
                </div>
                {row.ai_risk_flag ? (
                  <p className="text-xs text-amber-800">⚠ {String(row.ai_risk_flag)}</p>
                ) : null}
                <p className="text-xs italic text-[#64748b]">{String(row.ai_key_judgment || '')}</p>
              </div>

              <div className="bg-white border border-[#e2e8f0] rounded-lg p-4 text-sm space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold uppercase text-[#64748b]">Assessment memo</p>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const { error } = await ifrs15Api.paFullGenerateMemo(String(id));
                          if (error) throw toast.error(error);
                          toast.success('Memo generated');
                        })
                      }
                    >
                      Generate
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => void downloadPdf()}>
                      <Download className="w-3.5 h-3.5 mr-1" /> PDF
                    </Button>
                  </div>
                </div>
                <pre className="whitespace-pre-wrap text-xs text-[#334155] max-h-80 overflow-y-auto bg-slate-50 p-3 rounded">
                  {String(row.assessment_memo || 'No memo yet. Click Generate.')}
                </pre>
              </div>
            </div>

            <div className="space-y-3">
              <div className="bg-white border border-[#e2e8f0] rounded-lg p-4">
                <p className="text-xs font-bold uppercase text-[#64748b] mb-3">Workflow</p>
                <ol className="space-y-2">
                  {STEPS.map((s) => {
                    const done = stepDone(status, s.key);
                    return (
                      <li key={s.key} className="flex items-center gap-2 text-xs">
                        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${done ? 'bg-teal-600 text-white' : 'bg-slate-200 text-slate-500'}`}>
                          {done ? '✓' : '•'}
                        </span>
                        {s.label}
                      </li>
                    );
                  })}
                </ol>
              </div>

              <div className="bg-white border border-[#e2e8f0] rounded-lg p-4 space-y-2 text-xs">
                <p className="text-xs font-bold uppercase text-[#64748b]">Quick actions</p>
                <label className="block">
                  Actor
                  <input className="mt-1 w-full border rounded px-2 py-1.5" value={actor} onChange={(e) => setActor(e.target.value)} />
                </label>
                <select className="w-full border rounded px-2 py-1.5" value={overrideDet} onChange={(e) => setOverrideDet(e.target.value)}>
                  <option value="principal">Principal — Gross</option>
                  <option value="agent">Agent — Net</option>
                  <option value="judgment_required">Judgment required</option>
                </select>
                <textarea
                  className="w-full border rounded px-2 py-1.5"
                  placeholder="Override reason"
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      if (!overrideReason.trim()) {
                        toast.error('Reason required');
                        return;
                      }
                      const { error } = await ifrs15Api.paFullOverride(String(id), {
                        human_determination: overrideDet,
                        reason: overrideReason,
                        actor,
                      });
                      if (error) toast.error(error);
                      else toast.success('Override saved');
                    })
                  }
                >
                  Override
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  className="w-full bg-teal-600"
                  disabled={busy || !canApprove}
                  onClick={() =>
                    void run(async () => {
                      const { error } = await ifrs15Api.paFullApprove(String(id), actor);
                      if (error) toast.error(error);
                      else toast.success('Approved');
                    })
                  }
                >
                  Approve
                </Button>
                {!canApprove && (
                  <p className="text-amber-700">Human determination required before approval (judgment zone).</p>
                )}
              </div>

              <div className="bg-white border border-[#e2e8f0] rounded-lg p-4">
                <p className="text-xs font-bold uppercase text-[#64748b] mb-2">Audit trail</p>
                <ul className="space-y-2 text-xs">
                  {audit.length === 0 ? (
                    <li className="text-[#94a3b8]">No events yet.</li>
                  ) : (
                    audit.map((a, i) => (
                      <li key={a.id || i} className="border-l-2 border-teal-200 pl-2">
                        <p className="font-semibold">{a.action}</p>
                        <p className="text-[#64748b]">
                          {a.actor || 'system'} · {a.created_at ? new Date(a.created_at).toLocaleString() : ''}
                        </p>
                        {a.note ? <p className="text-[#475569]">{a.note}</p> : null}
                      </li>
                    ))
                  )}
                </ul>
              </div>
            </div>
          </div>
        )}
      </Ifrs15WorkspaceShell>
    </SidebarLayout>
  );
}
