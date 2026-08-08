'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { SidebarLayout } from '@/components/SidebarLayout';
import { Ifrs15WorkspaceShell } from '@/components/ifrs15/Ifrs15WorkspaceShell';
import { Button } from '@/components/Button';
import { ifrs15Api } from '@/lib/api';
import { getCurrentFirmId } from '@/lib/firm-workspace';

type Pack = Record<string, unknown>;
type CheckItem = Record<string, unknown>;
type TabId = 'overview' | 'checklist' | 'sections' | 'export';

function num(v: unknown): number {
  return Number(v || 0);
}

function aed(v: unknown): string {
  if (v == null || v === '' || Number.isNaN(Number(v))) return '—';
  return `AED ${Number(v).toLocaleString('en-AE', { maximumFractionDigits: 0 })}`;
}

function statusBadge(s?: unknown): string {
  switch (String(s || '')) {
    case 'generating':
      return 'bg-gray-100 text-gray-700 animate-pulse';
    case 'ready':
      return 'bg-blue-100 text-blue-800';
    case 'under_review':
      return 'bg-yellow-100 text-yellow-800';
    case 'approved':
      return 'bg-green-100 text-green-800';
    case 'issued':
      return 'bg-purple-100 text-purple-800';
    default:
      return 'bg-gray-100 text-gray-600';
  }
}

function statusLabel(s?: unknown): string {
  switch (String(s || '')) {
    case 'generating':
      return 'Generating...';
    case 'ready':
      return 'Ready for Review';
    case 'under_review':
      return 'Under Review';
    case 'approved':
      return 'Approved';
    case 'issued':
      return 'Issued to Auditors';
    default:
      return String(s || '—');
  }
}

function checkIcon(st?: unknown) {
  const s = String(st || '');
  if (s === 'met') return <span className="text-emerald-600 font-bold">✓</span>;
  if (s === 'partial') return <span className="text-amber-600 font-bold">~</span>;
  if (s === 'gap') return <span className="text-red-600 font-bold">✗</span>;
  return <span className="text-slate-400 italic">—</span>;
}

function ScoreRing({ score }: { score: number }) {
  const r = 42;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(100, Math.max(0, score)) / 100) * circ;
  const color = score >= 85 ? '#16a34a' : score >= 70 ? '#d97706' : '#dc2626';
  return (
    <svg width="120" height="120" viewBox="0 0 120 120" className="shrink-0">
      <circle cx="60" cy="60" r={r} fill="none" stroke="#e2e8f0" strokeWidth="10" />
      <circle
        cx="60"
        cy="60"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="10"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform="rotate(-90 60 60)"
      />
      <text x="60" y="56" textAnchor="middle" className="fill-[#1e293b]" fontSize="22" fontWeight="700">
        {score.toFixed(0)}%
      </text>
      <text x="60" y="74" textAnchor="middle" className="fill-[#64748b]" fontSize="9">
        complete
      </text>
    </svg>
  );
}

export default function EvidencePackPage() {
  const companyId = typeof window !== 'undefined' ? getCurrentFirmId() : 'default';
  const [periodType, setPeriodType] = useState<'monthly' | 'quarterly' | 'annual'>('monthly');
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState(6);
  const [quarter, setQuarter] = useState(2);
  const [preparedBy, setPreparedBy] = useState('Finance');
  const [actor, setActor] = useState('Finance');
  const [issuedTo, setIssuedTo] = useState('');
  const [packs, setPacks] = useState<Pack[]>([]);
  const [active, setActive] = useState<Pack | null>(null);
  const [checklist, setChecklist] = useState<CheckItem[]>([]);
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);
  const [evidence, setEvidence] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [tab, setTab] = useState<TabId>('overview');
  const [openSec, setOpenSec] = useState<Record<string, boolean>>({});
  const [approveOpen, setApproveOpen] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);

  const period =
    periodType === 'annual'
      ? String(year)
      : periodType === 'quarterly'
        ? `${year}-Q${quarter}`
        : `${year}-${String(month).padStart(2, '0')}`;

  const loadList = useCallback(async () => {
    setLoading(true);
    const { data, error } = await ifrs15Api.evidencePackList(companyId);
    if (error) toast.error(error);
    const list = (data?.packs || []) as Pack[];
    setPacks(list);
    setLoading(false);
    return list;
  }, [companyId]);

  const openPack = async (id: string) => {
    const { data, error } = await ifrs15Api.evidencePackGet(id);
    if (error) {
      toast.error(error);
      return;
    }
    setActive((data?.pack as Pack) || null);
    setChecklist((data?.checklist as CheckItem[]) || []);
    setSummary((data?.summary as Record<string, unknown>) || null);
    setEvidence((data?.evidence as Record<string, unknown>) || null);
    setTab('overview');
  };

  useEffect(() => {
    void loadList().then((list) => {
      const first = list[0];
      if (first?.id) void openPack(String(first.id));
    });
  }, [loadList]);

  const generate = async () => {
    setGenerating(true);
    const { data, error } = await ifrs15Api.evidencePackGenerate({
      company_id: companyId,
      period,
      period_type: periodType,
      prepared_by: preparedBy,
    });
    setGenerating(false);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success(`Pack generated · ${Number(data?.summary?.score || data?.pack?.completeness_score || 0).toFixed(1)}%`);
    setActive((data?.pack as Pack) || null);
    setChecklist((data?.checklist as CheckItem[]) || []);
    setSummary((data?.summary as Record<string, unknown>) || null);
    setEvidence((data?.evidence as Record<string, unknown>) || null);
    await loadList();
  };

  const download = async (kind: 'pdf' | 'excel') => {
    if (!active?.id) return;
    const { blob, filename, error } = await ifrs15Api.evidencePackExport(String(active.id), kind);
    if (error || !blob) {
      toast.error(error || 'Export failed');
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || (kind === 'pdf' ? 'AEP.pdf' : 'AEP.xlsx');
    a.click();
    URL.revokeObjectURL(url);
  };

  const grouped = useMemo(() => {
    const map: Record<string, CheckItem[]> = {};
    for (const it of checklist) {
      const s = String(it.section || 'other');
      map[s] = map[s] || [];
      map[s].push(it);
    }
    return map;
  }, [checklist]);

  const score = num(active?.completeness_score ?? summary?.score);
  const gaps = num(summary?.gap);
  const met = num(summary?.met ?? active?.checklist_items_met);
  const totalApp = num(summary?.applicable) || Math.max(1, num(active?.checklist_items_total) - num(summary?.not_applicable));
  const counts = (evidence?.counts || {}) as Record<string, unknown>;
  const rpoSnap = ((evidence?.rpo as Record<string, unknown> | null)?.snapshot || {}) as Record<string, unknown>;
  const st = String(active?.status || '');

  const sectionCards = [
    {
      id: 'controls',
      label: 'Controls',
      items: grouped.controls || [],
      ok: Boolean(active?.section_controls),
    },
    {
      id: 'identification',
      label: 'Contracts',
      items: grouped.identification || [],
      ok: Boolean(active?.section_contracts),
    },
    {
      id: 'recognition',
      label: 'Calculations',
      items: grouped.recognition || [],
      ok: Boolean(active?.section_calculations),
    },
    {
      id: 'modifications',
      label: 'Modifications',
      items: [],
      ok: Boolean(active?.section_modifications),
      extra: `${num(active?.modifications_count)} events`,
    },
    {
      id: 'billing',
      label: 'Billing Recon',
      items: [],
      ok: Boolean(active?.section_billing_recon),
      extra: `${num(active?.recon_exceptions_count)} exc.`,
    },
    {
      id: 'rpo',
      label: 'RPO',
      items: grouped.disclosure?.filter((i) => String(i.item_code).startsWith('DISC-00')) || [],
      ok: Boolean(active?.section_rpo),
    },
    {
      id: 'disclosure',
      label: 'Checklist',
      items: checklist,
      ok: Boolean(active?.section_checklist),
    },
  ];

  const kpiItems = [
    { label: 'Completeness', value: active ? `${score.toFixed(0)}%` : '—', accent: score < 70 ? ('pink' as const) : ('orange' as const) },
    { label: 'Contracts', value: active ? String(active.contracts_count ?? 0) : '—', accent: 'orange' as const },
    { label: 'Exceptions', value: active ? String(active.recon_exceptions_count ?? 0) : '—', accent: 'orange' as const },
    { label: 'Gaps', value: active ? String(gaps) : '—', accent: gaps > 0 ? ('pink' as const) : ('orange' as const) },
  ];

  return (
    <SidebarLayout pageTitle="Audit Evidence Pack" pageSubtitle="IFRS 15 · Complete auditor-ready evidence package">
      <Ifrs15WorkspaceShell activeNavId="evidence-pack" kpiItems={kpiItems}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-[#1e293b] flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-[#f97316]" />
              Audit Evidence Pack
            </h1>
            <p className="text-sm text-[#64748b]">IFRS 15 · Complete auditor-ready evidence package</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="text-xs border border-[#e2e8f0] rounded-md px-2 py-1.5 bg-white"
              value={periodType}
              onChange={(e) => setPeriodType(e.target.value as 'monthly' | 'quarterly' | 'annual')}
            >
              <option value="monthly">Month</option>
              <option value="quarterly">Quarter</option>
              <option value="annual">Year</option>
            </select>
            {periodType === 'monthly' ? (
              <select className="text-xs border border-[#e2e8f0] rounded-md px-2 py-1.5 bg-white" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {new Date(2000, i, 1).toLocaleString('en', { month: 'short' })}
                  </option>
                ))}
              </select>
            ) : null}
            {periodType === 'quarterly' ? (
              <select className="text-xs border border-[#e2e8f0] rounded-md px-2 py-1.5 bg-white" value={quarter} onChange={(e) => setQuarter(Number(e.target.value))}>
                {[1, 2, 3, 4].map((q) => (
                  <option key={q} value={q}>
                    Q{q}
                  </option>
                ))}
              </select>
            ) : null}
            <select className="text-xs border border-[#e2e8f0] rounded-md px-2 py-1.5 bg-white" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {[2025, 2026, 2027].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <input
              className="text-xs border border-[#e2e8f0] rounded-md px-2 py-1.5 w-28"
              value={preparedBy}
              onChange={(e) => setPreparedBy(e.target.value)}
              placeholder="Prepared by"
            />
            <Button size="sm" className="!bg-teal-600" onClick={() => void generate()} disabled={generating}>
              {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              Generate Pack
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-[#64748b] py-8">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading packs…
          </div>
        ) : packs.length ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
            {packs.map((p) => (
              <div key={String(p.id)} className={`bg-white border rounded-lg p-3 ${active?.id === p.id ? 'border-teal-500' : 'border-[#e2e8f0]'}`}>
                <div className="flex justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">{String(p.pack_ref || '—')}</p>
                    <p className="text-xs text-[#64748b]">{String(p.period)} · {String(p.period_type)}</p>
                  </div>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded h-fit ${statusBadge(p.status)}`}>{statusLabel(p.status)}</span>
                </div>
                <p className="text-xs mt-1">Completeness <b>{num(p.completeness_score).toFixed(0)}%</b></p>
                <p className="text-[11px] text-[#94a3b8]">{String(p.generated_at || '').slice(0, 19)}</p>
                <div className="flex flex-wrap gap-1 mt-2">
                  <Button size="sm" variant="secondary" onClick={() => void openPack(String(p.id))}>View</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setActive(p); void download('pdf'); }}><Download className="w-3 h-3" /> PDF</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setActive(p); void download('excel'); }}>Excel</Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-white border border-[#e2e8f0] rounded-lg p-8 text-center text-sm text-[#64748b]">
            No evidence packs yet. Generate one for {period}.
          </div>
        )}

        {active ? (
          <>
            <div className="bg-white border border-[#e2e8f0] rounded-lg p-4 flex flex-wrap items-center gap-6">
              <ScoreRing score={score} />
              <div>
                <p className="text-sm font-semibold text-[#1e293b]">{String(active.pack_ref)} · {String(active.period)}</p>
                <p className="text-xs text-[#64748b] mt-1">
                  {met} of {totalApp} applicable requirements met
                </p>
                {gaps > 0 ? <p className="text-xs text-red-700 font-semibold mt-1">{gaps} gaps require attention</p> : null}
                <p className="text-[11px] text-amber-800 mt-2">AI-assessed, human review recommended</p>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
              {sectionCards.map((s) => {
                const g = (s.items || []).filter((i) => i.status === 'gap').length;
                const icon = g ? '✗' : s.ok ? '✓' : '⚠';
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setTab(s.id === 'disclosure' ? 'checklist' : 'sections')}
                    className="bg-white border border-[#e2e8f0] rounded-lg px-2 py-2 text-left"
                  >
                    <p className="text-[10px] uppercase text-[#64748b]">{s.label}</p>
                    <p className="text-sm font-semibold">
                      {icon} {s.items.length || s.extra || (s.ok ? 'ok' : '—')}
                    </p>
                  </button>
                );
              })}
            </div>

            <div className="flex gap-1.5">
              {([['overview', 'Overview'], ['checklist', 'Checklist'], ['sections', 'Sections'], ['export', 'Export']] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={`text-xs px-3 py-1.5 rounded-full border ${tab === id ? 'bg-[#f97316] text-white border-[#f97316]' : 'bg-white text-[#64748b] border-[#e2e8f0]'}`}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === 'overview' ? (
              <div className="space-y-3">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <div className="bg-white border border-[#e2e8f0] rounded-lg p-4 shadow-sm">
                    <div className="flex justify-between mb-2">
                      <p className="text-xs font-semibold">Executive Summary</p>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          void navigator.clipboard.writeText(String(active.ai_executive_summary || ''));
                          toast.success('Copied');
                        }}
                      >
                        <Copy className="w-3.5 h-3.5" /> Copy
                      </Button>
                    </div>
                    <pre className="whitespace-pre-wrap text-xs text-[#334155] font-sans">{String(active.ai_executive_summary || '')}</pre>
                  </div>
                  <div className="bg-white border border-[#e2e8f0] rounded-lg p-4 text-sm space-y-1.5">
                    <p className="text-xs font-semibold mb-2">Key metrics</p>
                    <div className="flex justify-between"><span>Contracts reviewed</span><b>{String(active.contracts_count)}</b></div>
                    <div className="flex justify-between"><span>Modifications assessed</span><b>{String(active.modifications_count)} ({aed(counts.catch_up_total)} catch-up)</b></div>
                    <div className="flex justify-between"><span>Recon exceptions</span><b>{String(active.recon_exceptions_count)} ({String(active.recon_exceptions_resolved)} resolved)</b></div>
                    <div className="flex justify-between"><span>JE manual ratio</span><b>{num(active.je_count) ? `${((num(active.je_manual_count) / num(active.je_count)) * 100).toFixed(0)}%` : '—'}</b></div>
                    <div className="flex justify-between"><span>RPO as at period end</span><b>{aed(rpoSnap.total_rpo)}</b></div>
                    <div className="flex justify-between"><span>Completeness score</span><b>{score.toFixed(1)}%</b></div>
                  </div>
                </div>
                <div className="bg-slate-50 border border-[#e2e8f0] rounded-lg p-4">
                  <p className="text-xs font-semibold mb-2">Controls narrative</p>
                  <pre className="whitespace-pre-wrap text-xs text-[#334155] font-sans">{String(active.ai_controls_narrative || '')}</pre>
                </div>
              </div>
            ) : null}

            {tab === 'checklist' ? (
              <div className="space-y-2">
                {Object.entries(grouped).map(([sec, rows]) => {
                  const m = rows.filter((r) => r.status === 'met').length;
                  return (
                    <div key={sec} className="bg-white border border-[#e2e8f0] rounded-lg overflow-hidden">
                      <button
                        type="button"
                        className="w-full flex justify-between px-3 py-2 bg-[#f8fafc] text-sm font-semibold"
                        onClick={() => setOpenSec((p) => ({ ...p, [sec]: !p[sec] }))}
                      >
                        <span className="flex items-center gap-1">
                          {openSec[sec] !== false ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                          {sec} ({m} met / {rows.length} total)
                        </span>
                      </button>
                      {openSec[sec] !== false ? (
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs min-w-[800px]">
                            <thead>
                              <tr className="text-left text-[#64748b] border-b">
                                <th className="py-1.5 px-2">Code</th>
                                <th className="py-1.5 px-2">Requirement</th>
                                <th className="py-1.5 px-2">IFRS Ref</th>
                                <th className="py-1.5 px-2">Status</th>
                                <th className="py-1.5 px-2">Evidence</th>
                                <th className="py-1.5 px-2">Notes</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map((r) => (
                                <tr key={String(r.id || r.item_code)} className={`border-t ${r.status === 'gap' ? 'bg-red-50' : ''} ${r.status === 'not_applicable' ? 'text-slate-400 italic' : ''}`}>
                                  <td className="py-1.5 px-2 font-mono">{String(r.item_code)}</td>
                                  <td className="py-1.5 px-2">
                                    {String(r.requirement)}
                                    {r.status === 'gap' && r.recommended_action ? (
                                      <p className="text-red-700 mt-0.5">→ {String(r.recommended_action)}</p>
                                    ) : null}
                                  </td>
                                  <td className="py-1.5 px-2">{String(r.ifrs_reference || '')}</td>
                                  <td className="py-1.5 px-2 whitespace-nowrap">{checkIcon(r.status)} {String(r.status)}</td>
                                  <td className="py-1.5 px-2">{String(r.evidence_source || '')}</td>
                                  <td className="py-1.5 px-2">{String(r.notes || '')}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                <div className="text-xs bg-white border border-[#e2e8f0] rounded-lg px-3 py-2">
                  Met: {num(summary?.met)} | Partial: {num(summary?.partial)} | Gaps: {num(summary?.gap)} | N/A: {num(summary?.not_applicable)} | Score: {score.toFixed(1)}%
                </div>
              </div>
            ) : null}

            {tab === 'sections' ? (
              <div className="space-y-2">
                {[
                  { title: 'Controls', ok: active.section_controls, text: `Maker-checker inferred from JE/recon/mod sign-offs. Manual JE ratio ${(num(active.je_count) ? (num(active.je_manual_count) / num(active.je_count)) * 100 : 0).toFixed(0)}%.`, href: undefined },
                  { title: 'Contracts', ok: active.section_contracts, text: `${num(active.contracts_count)} contracts on RPO register + portfolio.`, href: '/dashboard/ifrs15' },
                  { title: 'Calculations / GL', ok: active.section_calculations, text: `${num(active.je_count)} GL postings (${num(active.je_manual_count)} manual).`, href: '/dashboard/ifrs15' },
                  { title: 'Modifications', ok: active.section_modifications, text: `${num(active.modifications_count)} events · catch-up ${aed(counts.catch_up_total)}.`, href: '/dashboard/ifrs15/modifications' },
                  { title: 'Billing Recon', ok: active.section_billing_recon, text: `${num(active.recon_exceptions_count)} exceptions, ${num(active.recon_exceptions_resolved)} resolved.`, href: '/dashboard/ifrs15/billing-recon' },
                  { title: 'RPO', ok: active.section_rpo, text: `Period-end RPO ${aed(rpoSnap.total_rpo)} · coverage ${rpoSnap.rpo_coverage_ratio ?? '—'}.`, href: '/dashboard/ifrs15/rpo' },
                ].map((s) => (
                  <div key={s.title} className="bg-white border border-[#e2e8f0] rounded-lg p-3">
                    <div className="flex justify-between">
                      <p className="text-sm font-semibold">{s.ok ? '✓' : '⚠'} {s.title}</p>
                      {s.href ? (
                        <Link href={s.href} className="text-xs font-semibold text-teal-700 hover:underline">View Source →</Link>
                      ) : null}
                    </div>
                    <p className="text-xs text-[#64748b] mt-1">{s.text}</p>
                  </div>
                ))}
              </div>
            ) : null}

            {tab === 'export' ? (
              <div className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="bg-white border border-[#e2e8f0] rounded-lg p-5">
                    <FileText className="w-8 h-8 text-teal-700 mb-2" />
                    <p className="font-semibold">Complete Audit Evidence Pack (PDF)</p>
                    <p className="text-xs text-[#64748b] mt-1">Multi-page PDF covering all 7 sections · ~15–20 pages</p>
                    <p className="text-[11px] text-[#94a3b8] mt-2">Last exported: {String(active.pdf_path || 'not yet')}</p>
                    <Button className="mt-3 !bg-teal-600" size="sm" onClick={() => void download('pdf')}>Download PDF</Button>
                  </div>
                  <div className="bg-white border border-[#e2e8f0] rounded-lg p-5">
                    <FileSpreadsheet className="w-8 h-8 text-teal-700 mb-2" />
                    <p className="font-semibold">Audit Workbook (Excel)</p>
                    <p className="text-xs text-[#64748b] mt-1">6-sheet Excel with full data tables + checklist formatting</p>
                    <p className="text-[11px] text-[#94a3b8] mt-2">Last exported: {String(active.excel_path || 'not yet')}</p>
                    <Button className="mt-3" size="sm" variant="secondary" onClick={() => void download('excel')}>Download Excel</Button>
                  </div>
                </div>

                <div className="bg-white border border-[#e2e8f0] rounded-lg p-4">
                  <p className="text-xs font-semibold mb-3">Approval workflow</p>
                  <ol className="flex flex-wrap gap-3 text-xs mb-3">
                    {['ready', 'under_review', 'approved', 'issued'].map((step) => {
                      const order = ['ready', 'under_review', 'approved', 'issued'];
                      const done = order.indexOf(st) >= order.indexOf(step) || (st === 'issued' && step !== 'generating');
                      return (
                        <li key={step} className={`flex items-center gap-1 ${done ? 'text-emerald-700 font-semibold' : 'text-slate-400'}`}>
                          {done ? <CheckCircle2 className="w-3.5 h-3.5" /> : <span className="w-3.5 h-3.5 rounded-full border border-slate-300 inline-block" />}
                          {step.replace('_', ' ')}
                        </li>
                      );
                    })}
                  </ol>
                  <div className="flex flex-wrap gap-2 items-center">
                    <input className="text-xs border rounded-md px-2 py-1.5" value={actor} onChange={(e) => setActor(e.target.value)} placeholder="Your name" />
                    {st === 'ready' ? (
                      <Button size="sm" onClick={async () => {
                        const { error } = await ifrs15Api.evidencePackSubmitReview(String(active.id), actor);
                        if (error) toast.error(error);
                        else { toast.success('Submitted for review'); await openPack(String(active.id)); await loadList(); }
                      }}>Submit for Review</Button>
                    ) : null}
                    {st === 'under_review' ? (
                      <Button size="sm" onClick={() => setApproveOpen(true)}>Approve Pack</Button>
                    ) : null}
                    {st === 'approved' ? (
                      <Button size="sm" onClick={() => setIssueOpen(true)}>Issue to Auditors</Button>
                    ) : null}
                    {st === 'issued' ? (
                      <span className="text-xs font-semibold text-purple-800 bg-purple-100 px-2 py-1 rounded">
                        Issued to {String(active.issued_to || 'auditors')} on {String(active.issued_at || '').slice(0, 10)}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
          </>
        ) : null}

        {approveOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="bg-white rounded-lg p-4 w-full max-w-sm space-y-3">
              <p className="font-semibold text-sm">Approve pack</p>
              <input className="w-full border rounded-md px-2 py-1.5 text-sm" value={actor} onChange={(e) => setActor(e.target.value)} placeholder="Approved by" />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="secondary" onClick={() => setApproveOpen(false)}>Cancel</Button>
                <Button size="sm" onClick={async () => {
                  const { error } = await ifrs15Api.evidencePackApprove(String(active?.id), { approved_by: actor });
                  if (error) toast.error(error);
                  else { toast.success('Approved'); setApproveOpen(false); await openPack(String(active?.id)); await loadList(); }
                }}>Confirm</Button>
              </div>
            </div>
          </div>
        ) : null}

        {issueOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="bg-white rounded-lg p-4 w-full max-w-sm space-y-3">
              <p className="font-semibold text-sm">Issue to auditors</p>
              <input className="w-full border rounded-md px-2 py-1.5 text-sm" value={issuedTo} onChange={(e) => setIssuedTo(e.target.value)} placeholder="Auditor firm name" />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="secondary" onClick={() => setIssueOpen(false)}>Cancel</Button>
                <Button size="sm" onClick={async () => {
                  if (!issuedTo.trim()) { toast.error('Enter auditor firm'); return; }
                  const { error } = await ifrs15Api.evidencePackApprove(String(active?.id), { approved_by: actor, issued_to: issuedTo.trim() });
                  if (error) toast.error(error);
                  else { toast.success('Issued'); setIssueOpen(false); await openPack(String(active?.id)); await loadList(); }
                }}>Issue</Button>
              </div>
            </div>
          </div>
        ) : null}
      </Ifrs15WorkspaceShell>
    </SidebarLayout>
  );
}
