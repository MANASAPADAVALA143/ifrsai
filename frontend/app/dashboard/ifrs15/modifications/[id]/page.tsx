'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { CheckCircle2, Clock, Download, GitMerge, Loader2 } from 'lucide-react';
import { SidebarLayout } from '@/components/SidebarLayout';
import { Ifrs15WorkspaceShell } from '@/components/ifrs15/Ifrs15WorkspaceShell';
import { Button } from '@/components/Button';
import { ifrs15Api } from '@/lib/api';

type ModRow = Record<string, unknown>;
type AuditRow = {
  id?: string;
  action?: string;
  actor?: string;
  note?: string;
  created_at?: string;
};

function aed(n: unknown): string {
  if (n == null || n === '' || Number.isNaN(Number(n))) return '—';
  return `AED ${Number(n).toLocaleString('en-AE', { maximumFractionDigits: 2 })}`;
}

function treatmentMeta(t?: unknown) {
  const v = String(t || '');
  if (v === 'A_separate_contract') return { label: 'New Contract', cls: 'bg-blue-100 text-blue-800', letter: 'A', para: 'IFRS 15.20' };
  if (v === 'B_prospective') return { label: 'Prospective', cls: 'bg-yellow-100 text-yellow-800', letter: 'B', para: 'IFRS 15.21(a)' };
  if (v === 'C_catchup') return { label: 'Catch-Up', cls: 'bg-red-100 text-red-800', letter: 'C', para: 'IFRS 15.21(b)' };
  return { label: 'Unclassified', cls: 'bg-gray-100 text-gray-600', letter: '—', para: '' };
}

const STEPS = [
  { key: 'created', label: 'Created' },
  { key: 'ai_classified', label: 'AI Classified' },
  { key: 'under_review', label: 'Under Review' },
  { key: 'approved', label: 'Approved' },
  { key: 'posted', label: 'JE Posted' },
] as const;

function stepDone(status: string, key: string): boolean {
  const order = ['draft', 'ai_classified', 'under_review', 'approved', 'posted'];
  const idx = order.indexOf(status === 'draft' ? 'draft' : status);
  const need: Record<string, number> = {
    created: 0,
    ai_classified: 1,
    under_review: 2,
    approved: 3,
    posted: 4,
  };
  const current = status === 'draft' ? 0 : Math.max(idx, 0);
  return current >= (need[key] ?? 99);
}

export default function ModificationDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [loading, setLoading] = useState(true);
  const [row, setRow] = useState<ModRow | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [actor, setActor] = useState('Finance');
  const [overrideTreatment, setOverrideTreatment] = useState('C_catchup');
  const [overrideReason, setOverrideReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const { data, error } = await ifrs15Api.modificationsGet(id);
    if (error) toast.error(error);
    setRow((data?.modification || null) as ModRow | null);
    setAudit((data?.audit_trail || []) as AuditRow[]);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const status = String(row?.status || 'draft');
  const finalT = String(row?.final_treatment || row?.human_treatment_override || row?.ai_treatment || '');
  const meta = treatmentMeta(finalT);
  const catchUp = Number(row?.catch_up_adjustment || 0);

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
    const { blob, filename, error } = await ifrs15Api.modificationsMemoPdf(id);
    if (error || !blob) {
      toast.error(error || 'PDF download failed');
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'modification_memo.pdf';
    a.click();
    URL.revokeObjectURL(url);
  };

  const kpiItems = [
    { label: 'Status', value: status.replace('_', ' '), accent: 'orange' as const },
    { label: 'Treatment', value: meta.label, accent: 'orange' as const },
    {
      label: 'Catch-up',
      value: finalT === 'C_catchup' ? aed(row?.catch_up_adjustment) : 'n/a',
      accent: catchUp < 0 ? ('pink' as const) : ('orange' as const),
    },
    { label: 'JE', value: row?.je_posted ? String(row.je_ref || 'Posted') : 'Not posted', accent: 'orange' as const },
  ];

  return (
    <SidebarLayout pageTitle="Modification detail" pageSubtitle="IFRS 15.18–21 workpaper">
      <Ifrs15WorkspaceShell activeNavId="contract-modifications" kpiItems={kpiItems}>
        <div className="flex items-center justify-between gap-2">
          <div>
            <Link href="/dashboard/ifrs15/modifications" className="text-xs text-[#f97316] font-semibold hover:underline">
              ← All modifications
            </Link>
            <h1 className="text-xl font-bold text-[#1e293b] flex items-center gap-2 mt-1">
              <GitMerge className="w-5 h-5 text-[#f97316]" />
              {String(row?.modification_ref || 'Modification')}
            </h1>
          </div>
        </div>

        {loading || !row ? (
          <div className="flex items-center gap-2 text-sm text-[#64748b] py-10">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-4">
            <div className="space-y-3">
              <div className="bg-white border border-[#e2e8f0] rounded-lg p-4 text-sm">
                <p className="text-xs font-bold uppercase text-[#64748b] mb-2">Modification facts</p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div><span className="text-[#64748b]">Date</span><p className="font-medium">{String(row.modification_date || '—')}</p></div>
                  <div><span className="text-[#64748b]">Contract</span><p className="font-medium">{String(row.contract_id || '—')}</p></div>
                  <div><span className="text-[#64748b]">Type</span><p className="font-medium">{String(row.modification_type || '—')}</p></div>
                  <div><span className="text-[#64748b]">Contract type</span><p className="font-medium">{String(row.contract_type || '—')}</p></div>
                  <div><span className="text-[#64748b]">Original TP</span><p className="font-medium">{aed(row.original_transaction_price)}</p></div>
                  <div><span className="text-[#64748b]">Price change</span><p className="font-medium">{aed(row.price_change_amount)}</p></div>
                  <div className="col-span-2"><span className="text-[#64748b]">Description</span><p className="font-medium">{String(row.description || '')}</p></div>
                </div>
              </div>

              <div className="bg-white border border-[#e2e8f0] rounded-lg p-4 text-sm space-y-2">
                <p className="text-xs font-bold uppercase text-[#64748b]">Classification</p>
                <div className="flex items-center gap-2">
                  <span className={`text-lg font-black px-2 py-1 rounded ${meta.cls}`}>{meta.letter}</span>
                  <div>
                    <p className="font-semibold">{meta.label} · {meta.para}</p>
                    <p className="text-xs text-[#64748b]">AI: {String(row.ai_treatment || '—')} · confidence {String(row.ai_confidence || '—')}</p>
                  </div>
                  {row.human_treatment_override ? (
                    <span className="ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded bg-orange-100 text-orange-800">Overridden</span>
                  ) : null}
                </div>
                <p className="text-xs text-[#334155]">{String(row.ai_classification_reason || '')}</p>
                {row.ai_key_judgment ? (
                  <div className="rounded bg-amber-50 border border-amber-200 px-2 py-1.5 text-xs text-amber-900">
                    Key judgment: {String(row.ai_key_judgment)}
                  </div>
                ) : null}
                {row.ai_risk_flag ? (
                  <div className="rounded bg-red-50 border border-red-200 px-2 py-1.5 text-xs text-red-800">
                    Risk: {String(row.ai_risk_flag)}
                  </div>
                ) : null}
                {row.human_override_reason ? (
                  <p className="text-xs text-orange-800">Override reason: {String(row.human_override_reason)}</p>
                ) : null}
              </div>

              {finalT === 'C_catchup' ? (
                <div className={`border rounded-lg p-4 text-sm ${catchUp < 0 ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200'}`}>
                  <p className="text-xs font-bold uppercase mb-2">Catch-up calculation</p>
                  <div className="space-y-1 font-mono text-xs">
                    <div className="flex justify-between"><span>Updated TP</span><span>{aed(row.new_transaction_price)}</span></div>
                    <div className="flex justify-between"><span>Updated progress %</span><span>{row.updated_progress_pct != null ? `${Number(row.updated_progress_pct).toFixed(1)}%` : '—'}</span></div>
                    <div className="flex justify-between"><span>Should have been</span><span>{aed(row.revenue_should_have_been)}</span></div>
                    <div className="flex justify-between"><span>Recognised to date</span><span>{aed(row.revenue_recognised_to_date)}</span></div>
                  </div>
                  <div className={`mt-2 pt-2 border-t font-semibold flex justify-between ${catchUp < 0 ? 'text-red-700 border-red-200' : 'text-emerald-800 border-emerald-200'}`}>
                    <span>CATCH-UP ADJUSTMENT</span>
                    <span>{catchUp < 0 ? '▼ Reduce' : '▲ Increase'} {aed(catchUp)}</span>
                  </div>
                </div>
              ) : null}

              <div className="bg-white border border-[#e2e8f0] rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-bold uppercase text-[#64748b]">Modification memo</p>
                  <div className="flex gap-2">
                    {!row.modification_memo ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            const { error } = await ifrs15Api.modificationsGenerateMemo(String(row.id));
                            if (error) toast.error(error);
                            else toast.success('Memo generated');
                          })
                        }
                      >
                        Generate Memo
                      </Button>
                    ) : null}
                    <Button size="sm" variant="secondary" onClick={() => void downloadPdf()}>
                      <Download className="w-3.5 h-3.5" /> PDF
                    </Button>
                  </div>
                </div>
                {row.modification_memo ? (
                  <pre className="whitespace-pre-wrap text-xs text-[#334155] font-sans max-h-[420px] overflow-y-auto">
                    {String(row.modification_memo)}
                  </pre>
                ) : (
                  <p className="text-xs text-[#64748b]">No memo yet.</p>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <div className="bg-white border border-[#e2e8f0] rounded-lg p-4">
                <p className="text-xs font-bold uppercase text-[#64748b] mb-3">Workflow</p>
                <ol className="space-y-2">
                  {STEPS.map((s) => {
                    const done = stepDone(status, s.key);
                    return (
                      <li key={s.key} className="flex items-center gap-2 text-sm">
                        {done ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        ) : (
                          <Clock className="w-4 h-4 text-[#94a3b8]" />
                        )}
                        <span className={done ? 'text-[#1e293b] font-medium' : 'text-[#94a3b8]'}>{s.label}</span>
                      </li>
                    );
                  })}
                </ol>
              </div>

              <div className="bg-white border border-[#e2e8f0] rounded-lg p-4">
                <p className="text-xs font-bold uppercase text-[#64748b] mb-2">Quick actions</p>
                <label className="block text-xs mb-2">
                  Actor
                  <input
                    className="mt-1 w-full border border-[#e2e8f0] rounded-md px-2 py-1.5 text-sm"
                    value={actor}
                    onChange={(e) => setActor(e.target.value)}
                  />
                </label>
                <div className="flex flex-col gap-2">
                  {status !== 'approved' && status !== 'posted' ? (
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          const { error } = await ifrs15Api.modificationsApprove(String(row.id), actor);
                          if (error) toast.error(error);
                          else toast.success('Approved');
                        })
                      }
                    >
                      Approve
                    </Button>
                  ) : null}
                  {status === 'approved' ? (
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          const { error } = await ifrs15Api.modificationsPostJe(String(row.id), {
                            je_date: new Date().toISOString().slice(0, 10),
                            actor,
                          });
                          if (error) toast.error(error);
                          else toast.success('JE posted');
                        })
                      }
                    >
                      Post JE
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const { error } = await ifrs15Api.modificationsGenerateMemo(String(row.id));
                        if (error) toast.error(error);
                        else toast.success('Memo generated');
                      })
                    }
                  >
                    Generate Memo
                  </Button>
                  {status !== 'posted' ? (
                    <div className="border-t border-[#e2e8f0] pt-2 space-y-2">
                      <p className="text-[11px] font-semibold text-orange-700">Override AI</p>
                      <select
                        className="w-full border border-[#e2e8f0] rounded-md px-2 py-1.5 text-sm"
                        value={overrideTreatment}
                        onChange={(e) => setOverrideTreatment(e.target.value)}
                      >
                        <option value="A_separate_contract">A — Separate contract</option>
                        <option value="B_prospective">B — Prospective</option>
                        <option value="C_catchup">C — Catch-up</option>
                      </select>
                      <textarea
                        className="w-full border border-[#e2e8f0] rounded-md px-2 py-1.5 text-sm min-h-[60px]"
                        placeholder="Override reason"
                        value={overrideReason}
                        onChange={(e) => setOverrideReason(e.target.value)}
                      />
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            if (overrideReason.trim().length < 8) {
                              toast.error('Override reason required');
                              return;
                            }
                            const { error } = await ifrs15Api.modificationsOverride(String(row.id), {
                              human_treatment: overrideTreatment,
                              reason: overrideReason.trim(),
                              actor,
                            });
                            if (error) toast.error(error);
                            else toast.success('Overridden');
                          })
                        }
                      >
                        Save override
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="bg-white border border-[#e2e8f0] rounded-lg p-4">
                <p className="text-xs font-bold uppercase text-[#64748b] mb-2">Audit trail</p>
                {audit.length === 0 ? (
                  <p className="text-xs text-[#64748b]">No events yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {audit.map((a) => (
                      <li key={a.id || `${a.action}-${a.created_at}`} className="text-xs border-b border-[#f1f5f9] pb-2 last:border-0">
                        <p className="font-semibold text-[#1e293b]">{a.action}</p>
                        <p className="text-[#64748b]">
                          {a.actor || 'system'} · {a.created_at ? new Date(a.created_at).toLocaleString() : ''}
                        </p>
                        {a.note ? <p className="text-[#475569] mt-0.5">{a.note}</p> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}
      </Ifrs15WorkspaceShell>
    </SidebarLayout>
  );
}
