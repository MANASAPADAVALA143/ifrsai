'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { GitFork, HelpCircle, Loader2, Sparkles, X } from 'lucide-react';
import { SidebarLayout } from '@/components/SidebarLayout';
import { Ifrs15WorkspaceShell } from '@/components/ifrs15/Ifrs15WorkspaceShell';
import { Button } from '@/components/Button';
import { ifrs15Api } from '@/lib/api';
import { getCurrentFirmId } from '@/lib/firm-workspace';

type PARow = Record<string, unknown>;
type FilterId = 'all' | 'principal' | 'agent' | 'judgment_required' | 'pending';

const INDICATOR_OPTS = [
  { value: 'strong_principal', label: 'Strong Principal (+2)', score: 2 },
  { value: 'partial_principal', label: 'Partial Principal (+1)', score: 1 },
  { value: 'neutral', label: 'Neutral (0)', score: 0 },
  { value: 'partial_agent', label: 'Partial Agent (−1)', score: -1 },
  { value: 'strong_agent', label: 'Strong Agent (−2)', score: -2 },
] as const;

const CONTRACT_TYPES = [
  { value: 'marketplace', label: 'Marketplace' },
  { value: 'platform', label: 'Platform/SaaS' },
  { value: 'reseller', label: 'Reseller' },
  { value: 'broker', label: 'Broker' },
  { value: 'fund_manager', label: 'Fund Manager' },
  { value: 'developer', label: 'UAE RE Developer' },
  { value: 'retailer', label: 'Retailer' },
  { value: 'other', label: 'Other' },
];

function aed(n: unknown): string {
  if (n == null || n === '' || Number.isNaN(Number(n))) return '—';
  return `AED ${Number(n).toLocaleString('en-AE', { maximumFractionDigits: 0 })}`;
}

function num(n: unknown): number {
  return Number(n || 0);
}

function signed(n: unknown): string {
  const v = Number(n || 0);
  return `${v >= 0 ? '+' : ''}${v}`;
}

function scoreOf(v?: string): number {
  return INDICATOR_OPTS.find((o) => o.value === v)?.score ?? 0;
}

function determinationMeta(d?: unknown) {
  const v = String(d || '');
  if (v === 'principal') return { label: 'PRINCIPAL — Gross', cls: 'bg-green-100 text-green-800', bar: 'bg-green-500' };
  if (v === 'agent') return { label: 'AGENT — Net', cls: 'bg-red-100 text-red-800', bar: 'bg-red-500' };
  if (v === 'judgment_required') return { label: 'JUDGMENT REQUIRED', cls: 'bg-amber-100 text-amber-800', bar: 'bg-amber-500' };
  return { label: 'Unassessed', cls: 'bg-gray-100 text-gray-600', bar: 'bg-gray-400' };
}

function statusCls(s?: unknown) {
  switch (String(s || '')) {
    case 'approved':
      return 'bg-green-100 text-green-800';
    case 'under_review':
      return 'bg-orange-100 text-orange-800';
    case 'ai_assessed':
      return 'bg-blue-100 text-blue-800';
    default:
      return 'bg-gray-100 text-gray-600';
  }
}

function typeLabel(t?: unknown) {
  return CONTRACT_TYPES.find((c) => c.value === t)?.label || String(t || 'Other');
}

function ScoreBar({ score, compact }: { score: number; compact?: boolean }) {
  const clamped = Math.max(-6, Math.min(6, score));
  const pct = ((clamped + 6) / 12) * 100;
  const meta = determinationMeta(clamped > 2 ? 'principal' : clamped < -2 ? 'agent' : 'judgment_required');
  return (
    <div className={compact ? '' : 'space-y-1'}>
      <div className="relative h-2.5 rounded-full bg-gradient-to-r from-red-200 via-amber-100 to-green-200">
        <div
          className={`absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 -translate-x-1/2 rounded-full border-2 border-white shadow ${meta.bar}`}
          style={{ left: `${pct}%` }}
        />
      </div>
      {!compact && (
        <div className="flex justify-between text-[10px] text-[#64748b]">
          <span>Agent −6</span>
          <span>Judgment</span>
          <span>Principal +6</span>
        </div>
      )}
    </div>
  );
}

function prelimFromScore(total: number): string {
  if (total > 2) return 'PRINCIPAL';
  if (total < -2) return 'AGENT';
  return 'JUDGMENT REQUIRED';
}

export default function PrincipalAgentPage() {
  const router = useRouter();
  const companyId = typeof window !== 'undefined' ? getCurrentFirmId() : 'default';
  const [filter, setFilter] = useState<FilterId>('all');
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<PARow[]>([]);
  const [summary, setSummary] = useState({
    total_assessments: 0,
    principal_count: 0,
    agent_count: 0,
    judgment_required_count: 0,
    total_gross_at_risk: 0,
    pending_approval: 0,
  });
  const [panelOpen, setPanelOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [assessing, setAssessing] = useState(false);
  const [actor, setActor] = useState('Finance');
  const [result, setResult] = useState<PARow | null>(null);
  const [classification, setClassification] = useState<Record<string, unknown> | null>(null);
  const [overrideDet, setOverrideDet] = useState('principal');
  const [overrideReason, setOverrideReason] = useState('');
  const [showOverride, setShowOverride] = useState(false);

  const [form, setForm] = useState({
    contract_ref: '',
    assessment_date: new Date().toISOString().slice(0, 10),
    contract_type: 'developer',
    customer_name: '',
    counterparty_name: '',
    transaction_description: '',
    gross_amount: '',
    commission_rate_pct: '',
    indicator_1_responsibility: 'neutral',
    indicator_1_notes: '',
    indicator_2_inventory: 'neutral',
    indicator_2_notes: '',
    indicator_3_pricing: 'neutral',
    indicator_3_notes: '',
    has_inventory_risk: false,
    sets_price_independently: false,
    primary_obligor: false,
    can_redirect_good: false,
  });

  const liveScore = useMemo(
    () =>
      scoreOf(form.indicator_1_responsibility) +
      scoreOf(form.indicator_2_inventory) +
      scoreOf(form.indicator_3_pricing),
    [form.indicator_1_responsibility, form.indicator_2_inventory, form.indicator_3_pricing]
  );

  const load = useCallback(async () => {
    setLoading(true);
    const det =
      filter === 'principal' || filter === 'agent' || filter === 'judgment_required' ? filter : undefined;
    const { data, error } = await ifrs15Api.paFullList({
      company_id: companyId,
      determination: det,
    });
    if (error) toast.error(error);
    let list = ((data?.assessments || []) as PARow[]);
    if (filter === 'pending') {
      list = list.filter((r) => ['draft', 'ai_assessed', 'under_review'].includes(String(r.status || '')));
    }
    setRows(list);
    const sum = await ifrs15Api.paFullSummary(companyId);
    if (sum.data) {
      setSummary({
        total_assessments: sum.data.total_assessments || 0,
        principal_count: sum.data.principal_count || 0,
        agent_count: sum.data.agent_count || 0,
        judgment_required_count: sum.data.judgment_required_count || 0,
        total_gross_at_risk: sum.data.total_gross_at_risk || 0,
        pending_approval: sum.data.pending_approval || 0,
      });
    }
    setLoading(false);
  }, [companyId, filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const resetPanel = () => {
    setStep(1);
    setResult(null);
    setClassification(null);
    setShowOverride(false);
    setOverrideReason('');
  };

  const runAssess = async () => {
    if (!form.transaction_description.trim()) {
      toast.error('Transaction description is required');
      return;
    }
    setAssessing(true);
    const ratePct = Number(form.commission_rate_pct);
    const { data, error } = await ifrs15Api.paFullAssess({
      company_id: companyId,
      contract_ref: form.contract_ref || undefined,
      assessment_date: form.assessment_date,
      contract_type: form.contract_type,
      customer_name: form.customer_name || undefined,
      counterparty_name: form.counterparty_name || undefined,
      transaction_description: form.transaction_description,
      gross_amount: form.gross_amount ? Number(form.gross_amount) : undefined,
      commission_rate: Number.isFinite(ratePct) && form.commission_rate_pct !== '' ? ratePct / 100 : undefined,
      currency: 'AED',
      indicator_1_responsibility: form.indicator_1_responsibility,
      indicator_1_notes: form.indicator_1_notes || undefined,
      indicator_2_inventory: form.indicator_2_inventory,
      indicator_2_notes: form.indicator_2_notes || undefined,
      indicator_3_pricing: form.indicator_3_pricing,
      indicator_3_notes: form.indicator_3_notes || undefined,
      has_inventory_risk: form.has_inventory_risk,
      sets_price_independently: form.sets_price_independently,
      primary_obligor: form.primary_obligor,
      can_redirect_good: form.can_redirect_good,
      prepared_by: actor,
    });
    setAssessing(false);
    if (error || !data?.assessment) {
      toast.error(error || 'Assessment failed');
      return;
    }
    setResult(data.assessment);
    setClassification(data.classification || null);
    setStep(3);
    if (String(data.assessment.final_determination) === 'judgment_required') setShowOverride(true);
    toast.success('AI assessment complete');
    void load();
  };

  const idOf = (r: PARow | null) => String(r?.id || '');

  const runOverride = async () => {
    const id = idOf(result);
    if (!id) return;
    if (!overrideReason.trim()) {
      toast.error('Override reason is required');
      return;
    }
    const { error, data } = await ifrs15Api.paFullOverride(id, {
      human_determination: overrideDet,
      reason: overrideReason,
      actor,
    });
    if (error) {
      toast.error(error);
      return;
    }
    setResult(data?.assessment || result);
    toast.success('Override saved');
    void load();
  };

  const runApprove = async () => {
    const id = idOf(result);
    if (!id) return;
    const det = String(result?.final_determination || result?.ai_determination || '');
    const human = String(result?.human_determination || '');
    if (det === 'judgment_required' && !human) {
      toast.error('Set a human determination before approving');
      setShowOverride(true);
      return;
    }
    const { error, data } = await ifrs15Api.paFullApprove(id, actor);
    if (error) {
      toast.error(error);
      return;
    }
    setResult(data?.assessment || result);
    toast.success('Approved');
    void load();
  };

  const runMemo = async () => {
    const id = idOf(result);
    if (!id) return;
    const { error, data } = await ifrs15Api.paFullGenerateMemo(id);
    if (error) {
      toast.error(error);
      return;
    }
    setResult(data?.assessment || result);
    toast.success('Memo generated');
  };

  const kpiItems = [
    { label: 'Total Assessments', value: String(summary.total_assessments), accent: 'orange' as const },
    { label: 'Principal (Gross)', value: String(summary.principal_count), accent: 'orange' as const },
    { label: 'Agent (Net)', value: String(summary.agent_count), accent: 'orange' as const },
    {
      label: 'Revenue at Risk AED',
      value: aed(summary.total_gross_at_risk),
      accent: 'pink' as const,
    },
  ];

  const filters: { id: FilterId; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'principal', label: 'Principal' },
    { id: 'agent', label: 'Agent' },
    { id: 'judgment_required', label: 'Judgment Required' },
    { id: 'pending', label: 'Pending Approval' },
  ];

  const detNow = String(result?.final_determination || result?.ai_determination || '');
  const canApprove = detNow !== 'judgment_required' || Boolean(result?.human_determination);

  return (
    <SidebarLayout pageTitle="Principal vs Agent" pageSubtitle="IFRS 15.B34–B38 · Gross vs net revenue">
      <Ifrs15WorkspaceShell activeNavId="principal-agent" kpiItems={kpiItems}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-[#1e293b] flex items-center gap-2">
              <GitFork className="w-5 h-5 text-teal-600" />
              Principal vs Agent Assessments
            </h1>
            <p className="text-sm text-[#64748b]">IFRS 15.B34-B38 · Gross vs net revenue determination</p>
          </div>
          <Button
            variant="primary"
            className="bg-teal-600 hover:bg-teal-700"
            onClick={() => {
              resetPanel();
              setPanelOpen(true);
            }}
          >
            + New Assessment
          </Button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: 'Total Assessments', value: summary.total_assessments, tip: null },
            { label: 'Principal (Gross)', value: summary.principal_count, tip: null },
            { label: 'Agent (Net)', value: summary.agent_count, tip: null },
            {
              label: 'Revenue at Risk AED',
              value: aed(summary.total_gross_at_risk),
              tip: 'Total difference between gross and net revenue across all agent determinations — materiality indicator for auditors',
              amber: true,
            },
          ].map((k) => (
            <div
              key={k.label}
              className={`bg-white border rounded-lg p-4 ${k.amber ? 'border-amber-300 bg-amber-50/40' : 'border-[#e2e8f0]'}`}
            >
              <p className="text-[11px] uppercase tracking-wide text-[#64748b] flex items-center gap-1">
                {k.label}
                {k.tip ? (
                  <span className="inline-flex" title={k.tip}>
                    <HelpCircle className="w-3.5 h-3.5 text-amber-600" />
                  </span>
                ) : null}
              </p>
              <p className={`text-2xl font-bold mt-1 ${k.amber ? 'text-amber-800' : 'text-[#1e293b]'}`}>{k.value}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${
                filter === f.id
                  ? 'bg-teal-600 text-white border-teal-600'
                  : 'bg-white text-[#475569] border-[#e2e8f0]'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-[#64748b] py-8">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading assessments…
          </div>
        ) : rows.length === 0 ? (
          <div className="bg-white border border-dashed border-[#cbd5e1] rounded-lg p-10 text-center text-sm text-[#64748b]">
            No assessments yet. Start with + New Assessment.
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map((r) => {
              const meta = determinationMeta(r.final_determination || r.ai_determination);
              return (
                <button
                  key={String(r.id)}
                  type="button"
                  onClick={() => router.push(`/dashboard/ifrs15/principal-agent/${r.id}`)}
                  className="w-full text-left bg-white border border-[#e2e8f0] rounded-lg p-4 hover:border-teal-300 hover:shadow-sm transition-all"
                >
                  <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.2fr_1fr_1fr] gap-3 items-center">
                    <div>
                      <p className="font-semibold text-[#1e293b]">{String(r.assessment_ref || '—')}</p>
                      <p className="text-xs text-[#64748b]">{String(r.assessment_date || '')}</p>
                      <span className="inline-block mt-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                        {typeLabel(r.contract_type)}
                      </span>
                    </div>
                    <div>
                      <p className="text-sm text-[#334155] line-clamp-2">{String(r.transaction_description || '')}</p>
                      <p className="text-xs text-[#64748b] mt-1">Counterparty: {String(r.counterparty_name || '—')}</p>
                    </div>
                    <div>
                      <ScoreBar score={num(r.total_score)} />
                      <p className="text-[11px] text-[#64748b] mt-1 text-center">Score {signed(r.total_score)} / +6</p>
                    </div>
                    <div className="flex flex-col items-start lg:items-end gap-1">
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${meta.cls}`}>{meta.label}</span>
                      <span className="text-sm font-semibold text-amber-800">{aed(r.revenue_difference)}</span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${statusCls(r.status)}`}>
                        {String(r.status || '').replace('_', ' ')}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {panelOpen && (
          <div className="fixed inset-0 z-40 flex justify-end">
            <button type="button" className="flex-1 bg-black/30" aria-label="Close" onClick={() => setPanelOpen(false)} />
            <div className="w-full max-w-xl h-full bg-white shadow-2xl overflow-y-auto p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-bold text-[#1e293b]">New Principal vs Agent assessment</h2>
                <button type="button" onClick={() => setPanelOpen(false)}>
                  <X className="w-5 h-5 text-[#64748b]" />
                </button>
              </div>
              <p className="text-xs text-[#64748b]">Step {step} of 3</p>

              {step === 1 && (
                <div className="space-y-3 text-sm">
                  <label className="block">
                    <span className="text-xs text-[#64748b]">Contract ref (optional)</span>
                    <input
                      className="mt-1 w-full border rounded-lg px-3 py-2"
                      value={form.contract_ref}
                      onChange={(e) => setForm((f) => ({ ...f, contract_ref: e.target.value }))}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs text-[#64748b]">Assessment date</span>
                    <input
                      type="date"
                      className="mt-1 w-full border rounded-lg px-3 py-2"
                      value={form.assessment_date}
                      onChange={(e) => setForm((f) => ({ ...f, assessment_date: e.target.value }))}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs text-[#64748b]">Contract type</span>
                    <select
                      className="mt-1 w-full border rounded-lg px-3 py-2"
                      value={form.contract_type}
                      onChange={(e) => setForm((f) => ({ ...f, contract_type: e.target.value }))}
                    >
                      {CONTRACT_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-xs text-[#64748b]">Customer name</span>
                    <input
                      className="mt-1 w-full border rounded-lg px-3 py-2"
                      value={form.customer_name}
                      onChange={(e) => setForm((f) => ({ ...f, customer_name: e.target.value }))}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs text-[#64748b]">Counterparty / third-party supplier</span>
                    <input
                      className="mt-1 w-full border rounded-lg px-3 py-2"
                      value={form.counterparty_name}
                      onChange={(e) => setForm((f) => ({ ...f, counterparty_name: e.target.value }))}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs text-[#64748b]">Transaction description *</span>
                    <textarea
                      className="mt-1 w-full border rounded-lg px-3 py-2 min-h-[80px]"
                      value={form.transaction_description}
                      onChange={(e) => setForm((f) => ({ ...f, transaction_description: e.target.value }))}
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="text-xs text-[#64748b]">Gross transaction amount (AED)</span>
                      <input
                        type="number"
                        className="mt-1 w-full border rounded-lg px-3 py-2"
                        value={form.gross_amount}
                        onChange={(e) => setForm((f) => ({ ...f, gross_amount: e.target.value }))}
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs text-[#64748b]">Commission rate % (optional)</span>
                      <input
                        type="number"
                        className="mt-1 w-full border rounded-lg px-3 py-2"
                        value={form.commission_rate_pct}
                        onChange={(e) => setForm((f) => ({ ...f, commission_rate_pct: e.target.value }))}
                      />
                    </label>
                  </div>
                  <Button variant="primary" className="bg-teal-600 w-full" onClick={() => setStep(2)}>
                    Next →
                  </Button>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-4 text-sm">
                  {[
                    {
                      key: 'indicator_1_responsibility' as const,
                      notes: 'indicator_1_notes' as const,
                      title: 'INDICATOR 1 — Primary Responsibility (IFRS 15.B37a)',
                      help: 'Is your entity primarily responsible for fulfilling the promise to provide the good/service to the customer? Strong Principal = customer holds you responsible, not the supplier. Strong Agent = customer knows they are dealing with the supplier.',
                    },
                    {
                      key: 'indicator_2_inventory' as const,
                      notes: 'indicator_2_notes' as const,
                      title: 'INDICATOR 2 — Inventory Risk (IFRS 15.B37b)',
                      help: 'Does your entity have inventory risk before or after transfer? Strong Principal = you own/control the good before selling it. Strong Agent = you never take ownership of the good.',
                    },
                    {
                      key: 'indicator_3_pricing' as const,
                      notes: 'indicator_3_notes' as const,
                      title: 'INDICATOR 3 — Pricing Discretion (IFRS 15.B37c)',
                      help: 'Does your entity have discretion in establishing the price? Strong Principal = you set the price independently. Strong Agent = you earn a fixed fee or percentage set by the supplier.',
                    },
                  ].map((ind) => (
                    <div key={ind.key} className="border rounded-lg p-3 space-y-2">
                      <p className="font-semibold text-[#1e293b] text-xs">{ind.title}</p>
                      <p className="text-[11px] text-[#64748b] leading-snug">{ind.help}</p>
                      <div className="space-y-1">
                        {INDICATOR_OPTS.map((opt) => (
                          <label key={opt.value} className="flex items-center gap-2 text-xs">
                            <input
                              type="radio"
                              name={ind.key}
                              checked={form[ind.key] === opt.value}
                              onChange={() => setForm((f) => ({ ...f, [ind.key]: opt.value }))}
                            />
                            {opt.label}
                          </label>
                        ))}
                      </div>
                      <textarea
                        className="w-full border rounded-lg px-2 py-1.5 text-xs"
                        placeholder="Notes (encouraged)"
                        value={form[ind.notes]}
                        onChange={(e) => setForm((f) => ({ ...f, [ind.notes]: e.target.value }))}
                      />
                    </div>
                  ))}

                  <div className="rounded-lg border border-teal-200 bg-teal-50 p-3">
                    <p className="font-semibold text-teal-900">Current Score: {signed(liveScore)} / +6</p>
                    <ScoreBar score={liveScore} />
                    <p className="text-xs mt-2 font-semibold text-teal-800">Preliminary: {prelimFromScore(liveScore)}</p>
                  </div>

                  <div className="space-y-1.5 text-xs">
                    {(
                      [
                        ['has_inventory_risk', 'We have inventory risk before transfer'],
                        ['sets_price_independently', 'We set the price independently'],
                        ['primary_obligor', 'Customer holds us (not supplier) responsible'],
                        ['can_redirect_good', 'We can redirect the good/service to another customer'],
                      ] as const
                    ).map(([k, label]) => (
                      <label key={k} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={Boolean(form[k])}
                          onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.checked }))}
                        />
                        {label}
                      </label>
                    ))}
                  </div>

                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => setStep(1)}>
                      Back
                    </Button>
                    <Button variant="primary" className="bg-teal-600 flex-1" onClick={() => void runAssess()} isLoading={assessing}>
                      <Sparkles className="w-4 h-4 mr-1" /> Assess with AI →
                    </Button>
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-3 text-sm">
                  {assessing && (
                    <p className="text-teal-700 flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" /> Claude is analysing under IFRS 15.B34-B38...
                    </p>
                  )}
                  {result && (
                    <>
                      <div className={`rounded-lg p-4 text-center ${determinationMeta(detNow).cls}`}>
                        <p className="text-lg font-black">{determinationMeta(detNow).label}</p>
                        <p className="text-xs mt-1">Confidence: {String(result.ai_confidence || classification?.confidence || '—')}</p>
                      </div>
                      <ScoreBar score={num(result.total_score)} />
                      <div className="border rounded-lg overflow-hidden text-xs">
                        {[
                          ['Primary Responsibility', result.indicator_1_score],
                          ['Inventory Risk', result.indicator_2_score],
                          ['Pricing Discretion', result.indicator_3_score],
                          ['TOTAL SCORE', result.total_score],
                        ].map(([lab, sc], i) => (
                          <div key={String(lab)} className={`flex justify-between px-3 py-2 ${i === 3 ? 'font-bold bg-slate-50' : 'border-b'}`}>
                            <span>{lab}</span>
                            <span>
                              {signed(sc)} {num(sc) > 0 ? '██' : num(sc) < 0 ? '▁' : ''}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
                        {String(result.ai_reasoning || classification?.reasoning || '')}
                      </div>
                      <div
                        className={`rounded-lg border p-3 text-xs ${
                          detNow === 'agent' ? 'border-red-200 bg-red-50 text-red-900' : 'border-green-200 bg-green-50 text-green-900'
                        }`}
                      >
                        <p>Gross amount: {aed(result.gross_amount)}</p>
                        <p>Net/commission: {aed(result.net_revenue)}</p>
                        <p className="font-bold">Revenue difference: {aed(result.revenue_difference)}</p>
                        <p className="mt-1">{String(result.ai_revenue_impact || classification?.revenue_impact || '')}</p>
                      </div>
                      {result.ai_risk_flag ? (
                        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                          {String(result.ai_risk_flag)}
                          <p className="mt-1 font-semibold">Human review recommended before approving</p>
                        </div>
                      ) : null}
                      <p className="text-xs italic text-[#64748b]">
                        {String(result.ai_key_judgment || classification?.key_judgment || '')}
                      </p>
                      {detNow === 'judgment_required' && (
                        <div className="rounded-lg border border-amber-400 bg-amber-50 p-3 text-xs text-amber-900">
                          Score falls in judgment zone (−2 to +2). Finance team must review and select final determination.
                        </div>
                      )}
                      {(showOverride || detNow === 'judgment_required') && (
                        <div className="border rounded-lg p-3 space-y-2">
                          <p className="text-xs font-semibold">Override determination</p>
                          <select
                            className="w-full border rounded px-2 py-1.5 text-xs"
                            value={overrideDet}
                            onChange={(e) => setOverrideDet(e.target.value)}
                          >
                            <option value="principal">Principal — Gross</option>
                            <option value="agent">Agent — Net</option>
                            <option value="judgment_required">Keep judgment required</option>
                          </select>
                          <textarea
                            className="w-full border rounded px-2 py-1.5 text-xs"
                            placeholder="Reason (required)"
                            value={overrideReason}
                            onChange={(e) => setOverrideReason(e.target.value)}
                          />
                          <Button variant="secondary" size="sm" onClick={() => void runOverride()}>
                            Save override
                          </Button>
                        </div>
                      )}
                      <label className="block text-xs">
                        Prepared / approved by
                        <input
                          className="mt-1 w-full border rounded px-2 py-1.5"
                          value={actor}
                          onChange={(e) => setActor(e.target.value)}
                        />
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <Button variant="secondary" size="sm" onClick={() => void runMemo()}>
                          Generate Memo
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => setShowOverride(true)}>
                          Override
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          className="bg-teal-600"
                          disabled={!canApprove}
                          onClick={() => void runApprove()}
                        >
                          Approve
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            toast.success('Assessment saved');
                            setPanelOpen(false);
                            if (result?.id) router.push(`/dashboard/ifrs15/principal-agent/${result.id}`);
                          }}
                        >
                          Save
                        </Button>
                      </div>
                      {result?.id ? (
                        <Link
                          href={`/dashboard/ifrs15/principal-agent/${result.id}`}
                          className="block text-center text-xs text-teal-700 font-semibold"
                        >
                          Open full workpaper →
                        </Link>
                      ) : null}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </Ifrs15WorkspaceShell>
    </SidebarLayout>
  );
}
