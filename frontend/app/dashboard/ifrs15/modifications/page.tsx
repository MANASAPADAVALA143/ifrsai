'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  CheckCircle2,
  GitMerge,
  Loader2,
  Sparkles,
  X,
} from 'lucide-react';
import { SidebarLayout } from '@/components/SidebarLayout';
import { Ifrs15WorkspaceShell } from '@/components/ifrs15/Ifrs15WorkspaceShell';
import { Button } from '@/components/Button';
import { ifrs15Api } from '@/lib/api';
import { getCurrentFirmId } from '@/lib/firm-workspace';

type ModRow = {
  id: string;
  modification_ref?: string | null;
  modification_date?: string | null;
  description?: string;
  contract_type?: string;
  contract_id?: string;
  ai_treatment?: string | null;
  human_treatment_override?: string | null;
  final_treatment?: string | null;
  catch_up_adjustment?: number | string | null;
  status?: string;
  ai_confidence?: string | null;
  ai_classification_reason?: string | null;
  ai_key_judgment?: string | null;
  ai_risk_flag?: string | null;
  new_transaction_price?: number | string | null;
  updated_progress_pct?: number | string | null;
  revenue_should_have_been?: number | string | null;
  revenue_recognised_to_date?: number | string | null;
  days_since_created?: number;
  modification_memo?: string | null;
};

type ContractOpt = { id: string; name: string; transaction_price?: number; term_months?: number };

type FilterId = 'all' | 'draft' | 'under_review' | 'approved' | 'posted';

const TREATMENTS = [
  { value: 'A_separate_contract', label: 'A — Separate new contract', para: 'IFRS 15.20' },
  { value: 'B_prospective', label: 'B — Prospective', para: 'IFRS 15.21(a)' },
  { value: 'C_catchup', label: 'C — Cumulative catch-up', para: 'IFRS 15.21(b)' },
] as const;

function aed(n: number | string | null | undefined): string {
  if (n == null || n === '' || Number.isNaN(Number(n))) return '—';
  return `AED ${Number(n).toLocaleString('en-AE', { maximumFractionDigits: 2 })}`;
}

function num(n: number | string | null | undefined): number {
  return Number(n || 0);
}

function treatmentMeta(t?: string | null) {
  if (t === 'A_separate_contract') return { label: 'New Contract', cls: 'bg-blue-100 text-blue-800', letter: 'A', para: 'IFRS 15.20' };
  if (t === 'B_prospective') return { label: 'Prospective', cls: 'bg-yellow-100 text-yellow-800', letter: 'B', para: 'IFRS 15.21(a)' };
  if (t === 'C_catchup') return { label: 'Catch-Up', cls: 'bg-red-100 text-red-800', letter: 'C', para: 'IFRS 15.21(b)' };
  return { label: 'Unclassified', cls: 'bg-gray-100 text-gray-600', letter: '—', para: '' };
}

function statusCls(s?: string) {
  switch (s) {
    case 'approved':
      return 'bg-green-100 text-green-800';
    case 'posted':
      return 'bg-teal-100 text-teal-800';
    case 'under_review':
      return 'bg-orange-100 text-orange-800';
    case 'ai_classified':
      return 'bg-blue-100 text-blue-800';
    default:
      return 'bg-gray-100 text-gray-600';
  }
}

function typeLabel(t?: string) {
  if (t === 'uae_real_estate') return 'UAE Real Estate';
  if (t === 'saas_subscription') return 'SaaS';
  if (t === 'professional_services') return 'Professional services';
  return t || 'Other';
}

function confidenceCls(c?: string | null) {
  if (c === 'high') return 'bg-green-100 text-green-800';
  if (c === 'low') return 'bg-red-100 text-red-800';
  return 'bg-amber-100 text-amber-800';
}

export default function ContractModificationsPage() {
  const router = useRouter();
  const companyId = typeof window !== 'undefined' ? getCurrentFirmId() : 'default';
  const [filter, setFilter] = useState<FilterId>('all');
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<ModRow[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [classifying, setClassifying] = useState(false);
  const [contracts, setContracts] = useState<ContractOpt[]>([]);
  const [actor, setActor] = useState('Finance');
  const [memoOpen, setMemoOpen] = useState(false);
  const [memoText, setMemoText] = useState('');
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideTreatment, setOverrideTreatment] = useState('C_catchup');
  const [overrideReason, setOverrideReason] = useState('');
  const [result, setResult] = useState<ModRow | null>(null);
  const [classification, setClassification] = useState<Record<string, unknown> | null>(null);

  const year = new Date().getFullYear();
  const [form, setForm] = useState({
    contract_id: '',
    modification_date: new Date().toISOString().slice(0, 10),
    modification_ref: `MOD-${year}-`,
    modification_type: 'price_change',
    description: '',
    contract_type: 'uae_real_estate',
    original_transaction_price: '',
    months_elapsed: '',
    revenue_recognised_to_date: '',
    price_change_amount: '',
    new_term_months: '',
    new_ssp_of_added_services: '',
    original_term_months: '24',
    are_new_services_distinct: 'unsure' as 'yes' | 'no' | 'unsure',
    are_remaining_services_distinct: 'unsure' as 'yes' | 'no' | 'unsure',
  });

  const load = useCallback(async () => {
    setLoading(true);
    const statusParam =
      filter === 'all' ? undefined : filter === 'draft' ? undefined : filter;
    const { data, error } = await ifrs15Api.modificationsList({
      company_id: companyId,
      status: statusParam,
    });
    if (error) toast.error(error);
    let list = ((data?.modifications || []) as ModRow[]);
    if (filter === 'draft') {
      list = list.filter((r) => r.status === 'draft' || r.status === 'ai_classified');
    }
    setRows(list);
    setLoading(false);
  }, [companyId, filter]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void ifrs15Api.modificationsContracts(companyId).then((res) => {
      setContracts((res.data?.contracts || []) as ContractOpt[]);
    });
  }, [companyId]);

  const kpiCatchUp = useMemo(
    () => rows.reduce((s, r) => s + num(r.catch_up_adjustment), 0),
    [rows]
  );

  const onContractChange = (id: string) => {
    const c = contracts.find((x) => x.id === id);
    setForm((p) => ({
      ...p,
      contract_id: id,
      original_transaction_price: c?.transaction_price != null ? String(c.transaction_price) : p.original_transaction_price,
      original_term_months: c?.term_months != null ? String(c.term_months) : p.original_term_months,
    }));
  };

  const resetWizard = () => {
    setStep(1);
    setResult(null);
    setClassification(null);
    setOverrideOpen(false);
    setClassifying(false);
  };

  const classify = async () => {
    if (form.description.trim().length < 20) {
      toast.error('Description must be at least 20 characters');
      return;
    }
    if (!form.contract_id.trim()) {
      toast.error('Select or enter a contract');
      return;
    }
    setClassifying(true);
    setStep(3);
    const yn = (v: string) => (v === 'yes' ? true : v === 'no' ? false : undefined);
    const { data, error } = await ifrs15Api.modificationsClassify({
      company_id: companyId,
      contract_id: form.contract_id.trim(),
      modification_date: form.modification_date,
      description: form.description.trim(),
      modification_type: form.modification_type,
      contract_type: form.contract_type,
      original_transaction_price: Number(form.original_transaction_price || 0),
      original_term_months: Number(form.original_term_months || 1),
      months_elapsed: Number(form.months_elapsed || 0),
      revenue_recognised_to_date: Number(form.revenue_recognised_to_date || 0),
      price_change_amount: Number(form.price_change_amount || 0),
      new_term_months: form.new_term_months ? Number(form.new_term_months) : undefined,
      new_ssp_of_added_services: form.new_ssp_of_added_services
        ? Number(form.new_ssp_of_added_services)
        : undefined,
      are_new_services_distinct: yn(form.are_new_services_distinct),
      are_remaining_services_distinct: yn(form.are_remaining_services_distinct),
      prepared_by: actor,
      modification_ref: form.modification_ref || undefined,
    });
    setClassifying(false);
    if (error) {
      toast.error(error);
      setStep(2);
      return;
    }
    setResult(data?.modification as ModRow);
    setClassification(data?.classification || null);
    const conf = String(data?.classification?.confidence || data?.modification?.ai_confidence || '');
    const risk = String(data?.classification?.risk_flag || data?.modification?.ai_risk_flag || '');
    if (conf === 'low' || (risk && risk !== 'null' && risk !== 'None')) setOverrideOpen(true);
    toast.success('Modification classified');
    await load();
  };

  const applyOverride = async () => {
    if (!result?.id) return;
    if (overrideReason.trim().length < 8) {
      toast.error('Override reason required');
      return;
    }
    const { data, error } = await ifrs15Api.modificationsOverride(result.id, {
      human_treatment: overrideTreatment,
      reason: overrideReason.trim(),
      actor,
    });
    if (error) {
      toast.error(error);
      return;
    }
    setResult(data?.modification as ModRow);
    toast.success('AI classification overridden');
    await load();
  };

  const approve = async () => {
    if (!result?.id) return;
    const { data, error } = await ifrs15Api.modificationsApprove(result.id, actor);
    if (error) {
      toast.error(error);
      return;
    }
    setResult(data?.modification as ModRow);
    toast.success('Approved');
    await load();
  };

  const generateMemo = async () => {
    if (!result?.id) return;
    const { data, error } = await ifrs15Api.modificationsGenerateMemo(result.id);
    if (error) {
      toast.error(error);
      return;
    }
    setMemoText(String(data?.memo || ''));
    setMemoOpen(true);
    if (data?.modification) setResult(data.modification as ModRow);
  };

  const postJe = async () => {
    if (!result?.id) return;
    const { data, error } = await ifrs15Api.modificationsPostJe(result.id, {
      je_date: new Date().toISOString().slice(0, 10),
      actor,
    });
    if (error) {
      toast.error(error);
      return;
    }
    setResult(data?.modification as ModRow);
    toast.success(`JE posted ${data?.modification?.je_ref || ''}`);
    await load();
  };

  const finalT = result?.final_treatment || result?.human_treatment_override || result?.ai_treatment;
  const tMeta = treatmentMeta(finalT);
  const catchUp = result ? num(result.catch_up_adjustment) : 0;

  const kpiItems = [
    { label: 'Modifications', value: loading ? '—' : String(rows.length), accent: 'orange' as const },
    {
      label: 'Net catch-up',
      value: loading ? '—' : aed(kpiCatchUp),
      accent: kpiCatchUp < 0 ? ('pink' as const) : ('orange' as const),
    },
    {
      label: 'Under review',
      value: loading ? '—' : String(rows.filter((r) => r.status === 'under_review').length),
      accent: 'orange' as const,
    },
    {
      label: 'Posted',
      value: loading ? '—' : String(rows.filter((r) => r.status === 'posted').length),
      accent: 'orange' as const,
    },
  ];

  return (
    <SidebarLayout
      pageTitle="Contract Modifications"
      pageSubtitle="IFRS 15.18–21 · AI classification + catch-up calc"
    >
      <Ifrs15WorkspaceShell activeNavId="contract-modifications" kpiItems={kpiItems}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-[#1e293b] flex items-center gap-2">
              <GitMerge className="w-5 h-5 text-[#f97316]" />
              Contract Modifications
            </h1>
            <p className="text-sm text-[#64748b]">IFRS 15.18–21 · AI classification + catch-up calc</p>
          </div>
          <Button
            size="sm"
            onClick={() => {
              resetWizard();
              setPanelOpen(true);
            }}
          >
            + New Modification
          </Button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ['all', 'All'],
              ['draft', 'Draft'],
              ['under_review', 'Under Review'],
              ['approved', 'Approved'],
              ['posted', 'Posted'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={`text-xs px-3 py-1.5 rounded-full border ${
                filter === id
                  ? 'bg-[#f97316] text-white border-[#f97316]'
                  : 'bg-white text-[#64748b] border-[#e2e8f0] hover:bg-[#f8fafc]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-[#64748b] py-8">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading modifications…
          </div>
        ) : rows.length === 0 ? (
          <div className="bg-white border border-[#e2e8f0] rounded-lg p-8 text-center text-sm text-[#64748b]">
            No modifications yet. Create one to run the IFRS 15.18–21 decision tree.
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map((r) => {
              const ft = r.final_treatment || r.human_treatment_override || r.ai_treatment;
              const meta = treatmentMeta(ft);
              const adj = r.catch_up_adjustment == null ? null : num(r.catch_up_adjustment);
              return (
                <div
                  key={r.id}
                  className="bg-white border border-[#e2e8f0] rounded-lg px-4 py-3 grid grid-cols-1 md:grid-cols-[180px_1fr_auto] gap-3 items-center"
                >
                  <div>
                    <p className="text-sm font-semibold text-[#1e293b]">{r.modification_ref || '—'}</p>
                    <p className="text-xs text-[#64748b]">{r.modification_date}</p>
                    <span className="inline-block mt-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                      {typeLabel(r.contract_type)}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm text-[#334155] line-clamp-2">{r.description}</p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${meta.cls}`}>{meta.label}</span>
                      {r.human_treatment_override ? (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-orange-100 text-orange-800">
                          Overridden
                        </span>
                      ) : null}
                      {adj != null && ft === 'C_catchup' ? (
                        <span className={`text-xs font-mono font-semibold ${adj < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                          {adj < 0 ? '▼' : '▲'} {aed(adj)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 justify-end">
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${statusCls(r.status)}`}>
                      {(r.status || 'draft').replace('_', ' ')}
                    </span>
                    <Link
                      href={`/dashboard/ifrs15/modifications/${r.id}`}
                      className="text-xs font-semibold px-3 py-1.5 rounded-md border border-[#e2e8f0] hover:bg-[#f8fafc]"
                    >
                      View
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {panelOpen ? (
          <div className="fixed inset-0 z-50 flex justify-end">
            <button type="button" className="flex-1 bg-black/30" aria-label="Close" onClick={() => setPanelOpen(false)} />
            <aside className="w-full max-w-[600px] h-full bg-white shadow-2xl overflow-y-auto">
              <div className="sticky top-0 bg-white border-b border-[#e2e8f0] px-5 py-3 flex items-center justify-between z-10">
                <div>
                  <p className="font-semibold text-[#1e293b]">New modification</p>
                  <p className="text-xs text-[#64748b]">Step {step} of 3</p>
                </div>
                <button type="button" onClick={() => setPanelOpen(false)} className="p-1 rounded hover:bg-[#f1f5f9]">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-5 space-y-4">
                <div className="flex gap-1 text-[11px] font-medium">
                  {['Details', 'Financials', 'Classification'].map((l, i) => (
                    <span
                      key={l}
                      className={`flex-1 text-center py-1 rounded ${step === i + 1 ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-500'}`}
                    >
                      {i + 1}. {l}
                    </span>
                  ))}
                </div>

                {step === 1 ? (
                  <>
                    <label className="block text-xs font-medium text-[#334155]">
                      Contract
                      <select
                        className="mt-1 w-full border border-[#e2e8f0] rounded-md px-2 py-2 text-sm"
                        value={form.contract_id}
                        onChange={(e) => onContractChange(e.target.value)}
                      >
                        <option value="">Select contract…</option>
                        {contracts.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                        <option value="SPA-OFFPLAN-001">SPA-OFFPLAN-001 (demo UAE RE)</option>
                        <option value="SAAS-PREM-001">SAAS-PREM-001 (demo SaaS)</option>
                      </select>
                    </label>
                    {!contracts.length ? (
                      <input
                        className="w-full border border-[#e2e8f0] rounded-md px-2 py-2 text-sm"
                        placeholder="Or type contract id"
                        value={form.contract_id}
                        onChange={(e) => setForm((p) => ({ ...p, contract_id: e.target.value }))}
                      />
                    ) : null}
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block text-xs font-medium text-[#334155]">
                        Modification date
                        <input
                          type="date"
                          className="mt-1 w-full border border-[#e2e8f0] rounded-md px-2 py-2 text-sm"
                          value={form.modification_date}
                          onChange={(e) => setForm((p) => ({ ...p, modification_date: e.target.value }))}
                        />
                      </label>
                      <label className="block text-xs font-medium text-[#334155]">
                        Reference
                        <input
                          className="mt-1 w-full border border-[#e2e8f0] rounded-md px-2 py-2 text-sm"
                          value={form.modification_ref}
                          onChange={(e) => setForm((p) => ({ ...p, modification_ref: e.target.value }))}
                        />
                      </label>
                    </div>
                    <label className="block text-xs font-medium text-[#334155]">
                      Modification type
                      <select
                        className="mt-1 w-full border border-[#e2e8f0] rounded-md px-2 py-2 text-sm"
                        value={form.modification_type}
                        onChange={(e) => setForm((p) => ({ ...p, modification_type: e.target.value }))}
                      >
                        <option value="scope_change">Scope change</option>
                        <option value="price_change">Price change</option>
                        <option value="scope_and_price">Scope + price</option>
                        <option value="extension">Extension</option>
                        <option value="cancellation">Cancellation</option>
                        <option value="unit_swap">Unit swap (UAE RE)</option>
                      </select>
                    </label>
                    <label className="block text-xs font-medium text-[#334155]">
                      Description (min 20 characters)
                      <textarea
                        className="mt-1 w-full border border-[#e2e8f0] rounded-md px-2 py-2 text-sm min-h-[90px]"
                        value={form.description}
                        onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                        placeholder="What changed — e.g. handover delay concession on off-plan SPA"
                      />
                    </label>
                    <label className="block text-xs font-medium text-[#334155]">
                      Contract type
                      <select
                        className="mt-1 w-full border border-[#e2e8f0] rounded-md px-2 py-2 text-sm"
                        value={form.contract_type}
                        onChange={(e) => setForm((p) => ({ ...p, contract_type: e.target.value }))}
                      >
                        <option value="uae_real_estate">UAE real estate</option>
                        <option value="saas_subscription">SaaS subscription</option>
                        <option value="professional_services">Professional services</option>
                        <option value="other">Other</option>
                      </select>
                    </label>
                    <div className="flex justify-end">
                      <Button size="sm" onClick={() => setStep(2)}>
                        Next →
                      </Button>
                    </div>
                  </>
                ) : null}

                {step === 2 ? (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block text-xs font-medium text-[#334155]">
                        Original transaction price (AED)
                        <input
                          type="number"
                          className="mt-1 w-full border border-[#e2e8f0] rounded-md px-2 py-2 text-sm"
                          value={form.original_transaction_price}
                          onChange={(e) => setForm((p) => ({ ...p, original_transaction_price: e.target.value }))}
                        />
                      </label>
                      <label className="block text-xs font-medium text-[#334155]">
                        Original term (months)
                        <input
                          type="number"
                          className="mt-1 w-full border border-[#e2e8f0] rounded-md px-2 py-2 text-sm"
                          value={form.original_term_months}
                          onChange={(e) => setForm((p) => ({ ...p, original_term_months: e.target.value }))}
                        />
                      </label>
                      <label className="block text-xs font-medium text-[#334155]">
                        Months elapsed
                        <input
                          type="number"
                          className="mt-1 w-full border border-[#e2e8f0] rounded-md px-2 py-2 text-sm"
                          value={form.months_elapsed}
                          onChange={(e) => setForm((p) => ({ ...p, months_elapsed: e.target.value }))}
                        />
                      </label>
                      <label className="block text-xs font-medium text-[#334155]">
                        Revenue recognised to date (AED)
                        <input
                          type="number"
                          className="mt-1 w-full border border-[#e2e8f0] rounded-md px-2 py-2 text-sm"
                          value={form.revenue_recognised_to_date}
                          onChange={(e) => setForm((p) => ({ ...p, revenue_recognised_to_date: e.target.value }))}
                        />
                      </label>
                      <label className="block text-xs font-medium text-[#334155]">
                        Price change (+/− AED)
                        <input
                          type="number"
                          className="mt-1 w-full border border-[#e2e8f0] rounded-md px-2 py-2 text-sm"
                          value={form.price_change_amount}
                          onChange={(e) => setForm((p) => ({ ...p, price_change_amount: e.target.value }))}
                        />
                      </label>
                      <label className="block text-xs font-medium text-[#334155]">
                        New term months (if changed)
                        <input
                          type="number"
                          className="mt-1 w-full border border-[#e2e8f0] rounded-md px-2 py-2 text-sm"
                          value={form.new_term_months}
                          onChange={(e) => setForm((p) => ({ ...p, new_term_months: e.target.value }))}
                        />
                      </label>
                    </div>
                    <label className="block text-xs font-medium text-[#334155]">
                      SSP of added services (if applicable)
                      <input
                        type="number"
                        className="mt-1 w-full border border-[#e2e8f0] rounded-md px-2 py-2 text-sm"
                        value={form.new_ssp_of_added_services}
                        onChange={(e) => setForm((p) => ({ ...p, new_ssp_of_added_services: e.target.value }))}
                      />
                    </label>
                    <div className="rounded-lg border border-[#e2e8f0] p-3 space-y-2 bg-[#f8fafc]">
                      <p className="text-xs font-semibold text-[#334155]">Pre-answer helper (optional)</p>
                      <label className="block text-xs">
                        Are the additional goods/services distinct from original?
                        <select
                          className="mt-1 w-full border border-[#e2e8f0] rounded-md px-2 py-1.5 text-sm bg-white"
                          value={form.are_new_services_distinct}
                          onChange={(e) =>
                            setForm((p) => ({ ...p, are_new_services_distinct: e.target.value as 'yes' | 'no' | 'unsure' }))
                          }
                        >
                          <option value="unsure">Unsure</option>
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                        </select>
                      </label>
                      <label className="block text-xs">
                        Are remaining undelivered services distinct from delivered ones?
                        <select
                          className="mt-1 w-full border border-[#e2e8f0] rounded-md px-2 py-1.5 text-sm bg-white"
                          value={form.are_remaining_services_distinct}
                          onChange={(e) =>
                            setForm((p) => ({
                              ...p,
                              are_remaining_services_distinct: e.target.value as 'yes' | 'no' | 'unsure',
                            }))
                          }
                        >
                          <option value="unsure">Unsure</option>
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                        </select>
                      </label>
                    </div>
                    <label className="block text-xs font-medium text-[#334155]">
                      Prepared by
                      <input
                        className="mt-1 w-full border border-[#e2e8f0] rounded-md px-2 py-2 text-sm"
                        value={actor}
                        onChange={(e) => setActor(e.target.value)}
                      />
                    </label>
                    <div className="flex justify-between">
                      <Button size="sm" variant="secondary" onClick={() => setStep(1)}>
                        ← Back
                      </Button>
                      <Button
                        size="sm"
                        className="!bg-teal-600 hover:!opacity-90"
                        onClick={() => void classify()}
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        Classify with AI →
                      </Button>
                    </div>
                  </>
                ) : null}

                {step === 3 ? (
                  classifying ? (
                    <div className="py-12 text-center text-sm text-[#64748b]">
                      <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-teal-600" />
                      Claude is analysing your modification…
                    </div>
                  ) : result ? (
                    <>
                      <div className="rounded-lg border border-[#e2e8f0] p-4 space-y-2">
                        <div className="flex items-center gap-3">
                          <span className={`text-2xl font-black w-12 h-12 rounded-lg flex items-center justify-center ${tMeta.cls}`}>
                            {tMeta.letter}
                          </span>
                          <div>
                            <p className="font-semibold text-[#1e293b]">{tMeta.label}</p>
                            <p className="text-xs text-[#64748b]">{tMeta.para}</p>
                          </div>
                          <span className={`ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded ${confidenceCls(result.ai_confidence)}`}>
                            {result.ai_confidence || 'medium'} confidence
                          </span>
                        </div>
                        <p className="text-sm text-[#334155]">
                          {String(classification?.reason || result.ai_classification_reason || '')}
                        </p>
                        {(classification?.key_judgment || result.ai_key_judgment) ? (
                          <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
                            <span className="font-semibold">Key judgment: </span>
                            {String(classification?.key_judgment || result.ai_key_judgment)}
                          </div>
                        ) : null}
                        {(classification?.risk_flag || result.ai_risk_flag) &&
                        String(classification?.risk_flag || result.ai_risk_flag) !== 'null' ? (
                          <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-800">
                            <span className="font-semibold">Risk flag: </span>
                            {String(classification?.risk_flag || result.ai_risk_flag)}
                          </div>
                        ) : null}
                      </div>

                      {finalT === 'C_catchup' ? (
                        <div
                          className={`rounded-lg border p-4 text-sm ${
                            catchUp < 0 ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50'
                          }`}
                        >
                          <p className="text-xs font-bold uppercase tracking-wide mb-2">Catch-up calculation</p>
                          <div className="space-y-1 font-mono text-xs">
                            <div className="flex justify-between"><span>Updated transaction price</span><span>{aed(result.new_transaction_price)}</span></div>
                            <div className="flex justify-between"><span>Updated progress %</span><span>{result.updated_progress_pct != null ? `${Number(result.updated_progress_pct).toFixed(1)}%` : '—'}</span></div>
                            <div className="flex justify-between"><span>Revenue should have been</span><span>{aed(result.revenue_should_have_been)}</span></div>
                            <div className="flex justify-between"><span>Revenue recognised to date</span><span>{aed(result.revenue_recognised_to_date)}</span></div>
                          </div>
                          <div className={`mt-3 pt-2 border-t flex justify-between font-semibold ${catchUp < 0 ? 'text-red-700 border-red-200' : 'text-emerald-800 border-emerald-200'}`}>
                            <span>CATCH-UP ADJUSTMENT</span>
                            <span>
                              {catchUp < 0 ? '▼ Reduce' : '▲ Increase'} {aed(catchUp)}
                            </span>
                          </div>
                        </div>
                      ) : null}

                      <div className="border border-[#e2e8f0] rounded-lg">
                        <button
                          type="button"
                          className="w-full text-left px-3 py-2 text-xs font-semibold text-orange-700"
                          onClick={() => setOverrideOpen(!overrideOpen)}
                        >
                          Override AI Classification {overrideOpen ? '▴' : '▾'}
                        </button>
                        {overrideOpen ? (
                          <div className="px-3 pb-3 space-y-2">
                            <select
                              className="w-full border border-[#e2e8f0] rounded-md px-2 py-1.5 text-sm"
                              value={overrideTreatment}
                              onChange={(e) => setOverrideTreatment(e.target.value)}
                            >
                              {TREATMENTS.map((t) => (
                                <option key={t.value} value={t.value}>
                                  {t.label}
                                </option>
                              ))}
                            </select>
                            <textarea
                              className="w-full border border-[#e2e8f0] rounded-md px-2 py-1.5 text-sm min-h-[70px]"
                              placeholder="Reason for override"
                              value={overrideReason}
                              onChange={(e) => setOverrideReason(e.target.value)}
                            />
                            <Button size="sm" variant="secondary" onClick={() => void applyOverride()}>
                              Save override
                            </Button>
                          </div>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="secondary" onClick={() => void generateMemo()}>
                          Generate Memo
                        </Button>
                        <Button size="sm" onClick={() => void approve()} disabled={result.status === 'approved' || result.status === 'posted'}>
                          <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={result.status !== 'approved'}
                          onClick={() => void postJe()}
                        >
                          Post JE
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            toast.success('Draft saved');
                            setPanelOpen(false);
                            router.push(`/dashboard/ifrs15/modifications/${result.id}`);
                          }}
                        >
                          Save Draft
                        </Button>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-[#64748b]">No classification result.</p>
                  )
                ) : null}
              </div>
            </aside>
          </div>
        ) : null}

        {memoOpen ? (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
            <div className="bg-white rounded-lg max-w-2xl w-full max-h-[80vh] overflow-y-auto p-5">
              <div className="flex justify-between items-center mb-3">
                <h2 className="font-semibold">Modification memo</h2>
                <button type="button" onClick={() => setMemoOpen(false)}>
                  <X className="w-4 h-4" />
                </button>
              </div>
              <pre className="whitespace-pre-wrap text-xs text-[#334155] font-sans">{memoText}</pre>
            </div>
          </div>
        ) : null}
      </Ifrs15WorkspaceShell>
    </SidebarLayout>
  );
}
