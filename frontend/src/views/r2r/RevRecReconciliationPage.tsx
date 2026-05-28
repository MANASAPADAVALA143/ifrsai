'use client';

import { useCallback, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Plus,
  Trash2,
  Copy,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Sparkles,
} from 'lucide-react';
import { SidebarLayout } from '@/components/SidebarLayout';
import { Button } from '@/components/Button';
import { revRecApi } from '@/lib/api';
import { PeriodReconciliationTab } from '@/components/r2r/PeriodReconciliationTab';
import { cn } from '@/lib/utils';

const SSP_METHODS = [
  'Observable',
  'Adjusted Market Assessment',
  'Expected Cost Plus Margin',
  'Residual Approach',
] as const;

type SspMethod = (typeof SSP_METHODS)[number];
type RecognitionPattern = 'Over time' | 'Point in time';

type PoRow = {
  id: string;
  po_name: string;
  ssp_used: string;
  ssp_supported: string;
  allocated_amount: string;
  recognition_pattern: RecognitionPattern;
};

type PoResult = {
  po_name: string;
  ssp_used: number;
  ssp_supported: number;
  ssp_variance: number;
  allocated_amount: number;
  correct_allocation: number;
  allocation_variance: number;
  recognition_pattern: string;
  po_status: string;
  risk: string;
};

type JournalLine = {
  dr_account: string;
  cr_account: string;
  amount: number;
  narrative: string;
};

type MovementLine = { line: string; amount: number };

type AccountResult = {
  opening: number;
  expected_closing: number;
  gl_closing: number;
  difference: number;
  status: string;
  movements: MovementLine[];
};

type SspResult = {
  overall_status: string;
  allocation_rounding_diff: number;
  po_results: PoResult[];
  reallocation_journal: JournalLine[];
  nova_commentary: string;
};

type BalanceResult = {
  overall_status: string;
  accounts: Record<string, AccountResult>;
  ifrs15_disclosure_note: string;
  nova_commentary: string;
};

const inputClass =
  'w-full px-4 py-2 bg-bg-light border border-border-default rounded-lg text-sm';
const glInputClass =
  'w-full px-4 py-2 bg-[#f1f5f9] border border-border-default rounded-lg text-sm font-medium';

function newPoRow(): PoRow {
  return {
    id: `po-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    po_name: '',
    ssp_used: '',
    ssp_supported: '',
    allocated_amount: '',
    recognition_pattern: 'Over time',
  };
}

function formatMoney(n: number | undefined | null): string {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseNum(v: string): number {
  const n = parseFloat(v.replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function poStatusStyles(status: string): string {
  switch (status) {
    case 'COMPLIANT':
      return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    case 'SSP VARIANCE':
      return 'bg-amber-100 text-amber-900 border-amber-200';
    case 'ALLOCATION ERROR':
      return 'bg-red-100 text-red-800 border-red-200';
    case 'BOTH':
      return 'bg-red-200 text-red-950 border-red-400';
    default:
      return 'bg-slate-100 text-slate-700 border-slate-200';
  }
}

function CardHeader({
  number,
  title,
  subtitle,
}: {
  number: number;
  title: string;
  subtitle: string;
}) {
  return (
    <header className="mb-6">
      <p className="text-xs font-bold text-orange-primary uppercase tracking-wider mb-1">
        Card {number}
      </p>
      <h2 className="text-lg font-bold text-text-primary">{title}</h2>
      <p className="text-sm text-text-muted mt-0.5">{subtitle}</p>
    </header>
  );
}

function StatusPillsRow({ sspPill, balancePill }: { sspPill: string | null; balancePill: string | null }) {
  return (
    <div className="flex flex-wrap gap-3">
      <span
        className={cn(
          'inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold border',
          sspPill?.includes('✓')
            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
            : sspPill
              ? 'bg-amber-50 text-amber-900 border-amber-200'
              : 'bg-slate-50 text-slate-500 border-slate-200'
        )}
      >
        {sspPill ?? 'SSP: not run'}
      </span>
      <span
        className={cn(
          'inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold border',
          balancePill?.includes('✓')
            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
            : balancePill
              ? 'bg-red-50 text-red-800 border-red-200'
              : 'bg-slate-50 text-slate-500 border-slate-200'
        )}
      >
        {balancePill ?? 'Contract Balances: not run'}
      </span>
    </div>
  );
}

function AccountMovementCard({
  title,
  account,
}: {
  title: string;
  account: AccountResult | undefined;
}) {
  if (!account) return null;
  const reconciled = account.status === 'RECONCILED';
  return (
    <div className="bg-white rounded-lg border border-border-default p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2 mb-3">
        <h4 className="text-sm font-semibold text-text-primary">{title}</h4>
        <span
          className={cn(
            'text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border shrink-0',
            reconciled
              ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
              : 'bg-red-100 text-red-800 border-red-200'
          )}
        >
          {reconciled ? '✓ RECONCILED' : `✗ $${formatMoney(Math.abs(account.difference))} DIFF`}
        </span>
      </div>
      <table className="w-full text-xs">
        <tbody>
          {(account.movements || []).map((m, i) => {
            const isDiff = m.line === 'Difference';
            const diffOk = isDiff && Math.abs(m.amount) < 0.01;
            const diffBad = isDiff && Math.abs(m.amount) >= 0.01;
            return (
              <tr
                key={`${m.line}-${i}`}
                className={cn(
                  'border-b border-border-default last:border-0',
                  isDiff && diffOk && 'bg-emerald-50',
                  isDiff && diffBad && 'bg-red-50'
                )}
              >
                <td className="py-2 pr-2 text-text-secondary">{m.line}</td>
                <td
                  className={cn(
                    'py-2 text-right font-mono',
                    isDiff && diffOk && 'text-emerald-700 font-semibold',
                    isDiff && diffBad && 'text-red-700 font-semibold'
                  )}
                >
                  {formatMoney(m.amount)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BalanceSubsection({
  title,
  borderClass,
  fields,
  values,
  onChange,
}: {
  title: string;
  borderClass: string;
  fields: { key: string; label: string; wide?: boolean }[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <div className={cn('border-l-4 pl-4 mb-6', borderClass)}>
      <h3 className="text-sm font-bold text-text-primary mb-3">{title}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-3">
        {fields.map((f) => (
          <div key={f.key}>
            <label className="block text-xs font-medium text-text-muted mb-1">{f.label}</label>
            <input
              type="number"
              step="0.01"
              className={inputClass}
              value={values[f.key] ?? ''}
              onChange={(e) => onChange(f.key, e.target.value)}
            />
          </div>
        ))}
      </div>
      <div>
        <label className="block text-xs font-medium text-text-muted mb-1">
          GL closing balance ($) — From SAP / GL
        </label>
        <input
          type="number"
          step="0.01"
          className={glInputClass}
          value={values.gl_closing_balance ?? ''}
          onChange={(e) => onChange('gl_closing_balance', e.target.value)}
        />
      </div>
    </div>
  );
}

export default function RevRecReconciliationPage() {

  const [sspPill, setSspPill] = useState<string | null>(null);
  const [balancePill, setBalancePill] = useState<string | null>(null);
  const [sspLoading, setSspLoading] = useState(false);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [sspResult, setSspResult] = useState<SspResult | null>(null);
  const [balanceResult, setBalanceResult] = useState<BalanceResult | null>(null);

  const [sspForm, setSspForm] = useState({
    period: 'May 2026',
    contract_id: '',
    customer_name: '',
    total_contract_value: '',
    ssp_method: 'Expected Cost Plus Margin' as SspMethod,
  });
  const [poRows, setPoRows] = useState<PoRow[]>(() => [newPoRow(), newPoRow()]);

  const [balanceForm, setBalanceForm] = useState({
    period: 'May 2026',
    prior_period: 'Apr 2026',
    contract_asset: {
      opening_balance: '',
      revenue_recognised_unbilled: '',
      invoiced_this_period: '',
      cancellations_reversed: '',
      gl_closing_balance: '',
    },
    deferred_revenue: {
      opening_balance: '',
      new_billings_received: '',
      revenue_recognised: '',
      cancellations_refunded: '',
      gl_closing_balance: '',
    },
    accrued_revenue: {
      opening_balance: '',
      accruals_raised: '',
      accruals_reversed_on_billing: '',
      gl_closing_balance: '',
    },
    trade_receivables: {
      opening_balance: '',
      invoices_raised: '',
      cash_collected: '',
      bad_debt_written_off: '',
      gl_closing_balance: '',
    },
  });

  const updatePo = (id: string, patch: Partial<PoRow>) => {
    setPoRows((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const addPoRow = () => setPoRows((rows) => [...rows, newPoRow()]);

  const removePoRow = (id: string) => {
    setPoRows((rows) => (rows.length <= 1 ? rows : rows.filter((r) => r.id !== id)));
  };

  const setBalanceField = (
    section: keyof typeof balanceForm,
    field: string,
    value: string
  ) => {
    if (section === 'period' || section === 'prior_period') {
      setBalanceForm((f) => ({ ...f, [section]: value }));
      return;
    }
    setBalanceForm((f) => ({
      ...f,
      [section]: { ...(f[section] as Record<string, string>), [field]: value },
    }));
  };

  const runSspCheck = async () => {
    if (!sspForm.contract_id.trim() || !sspForm.customer_name.trim()) {
      toast.error('Contract ID and customer name are required.');
      return;
    }
    const obligations = poRows
      .filter((r) => r.po_name.trim())
      .map((r) => ({
        po_name: r.po_name.trim(),
        ssp_used: parseNum(r.ssp_used),
        ssp_supported: parseNum(r.ssp_supported),
        allocated_amount: parseNum(r.allocated_amount),
        recognition_pattern: r.recognition_pattern,
      }));
    if (obligations.length === 0) {
      toast.error('Add at least one performance obligation with a name.');
      return;
    }

    setSspLoading(true);
    try {
      const res = await revRecApi.sspAllocationCheck({
        period: sspForm.period,
        contract_id: sspForm.contract_id.trim(),
        customer_name: sspForm.customer_name.trim(),
        total_contract_value: parseNum(sspForm.total_contract_value),
        ssp_method: sspForm.ssp_method,
        performance_obligations: obligations,
      });
      if (res.error) throw new Error(res.error);
      const data = res.data as SspResult;
      setSspResult(data);
      const compliant = data.overall_status === 'COMPLIANT';
      setSspPill(
        compliant
          ? 'SSP: ✓'
          : `SSP: ${data.po_results?.filter((p) => p.po_status !== 'COMPLIANT').length ?? 0} exception(s)`
      );
      toast.success('SSP allocation check complete');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'SSP check failed');
    } finally {
      setSspLoading(false);
    }
  };

  const runBalanceTracker = async () => {
    setBalanceLoading(true);
    try {
      const res = await revRecApi.contractBalanceTracker({
        period: balanceForm.period,
        prior_period: balanceForm.prior_period,
        contract_asset: {
          opening_balance: parseNum(balanceForm.contract_asset.opening_balance),
          revenue_recognised_unbilled: parseNum(
            balanceForm.contract_asset.revenue_recognised_unbilled
          ),
          invoiced_this_period: parseNum(balanceForm.contract_asset.invoiced_this_period),
          cancellations_reversed: parseNum(balanceForm.contract_asset.cancellations_reversed),
          gl_closing_balance: parseNum(balanceForm.contract_asset.gl_closing_balance),
        },
        deferred_revenue: {
          opening_balance: parseNum(balanceForm.deferred_revenue.opening_balance),
          new_billings_received: parseNum(balanceForm.deferred_revenue.new_billings_received),
          revenue_recognised: parseNum(balanceForm.deferred_revenue.revenue_recognised),
          cancellations_refunded: parseNum(balanceForm.deferred_revenue.cancellations_refunded),
          gl_closing_balance: parseNum(balanceForm.deferred_revenue.gl_closing_balance),
        },
        accrued_revenue: {
          opening_balance: parseNum(balanceForm.accrued_revenue.opening_balance),
          accruals_raised: parseNum(balanceForm.accrued_revenue.accruals_raised),
          accruals_reversed_on_billing: parseNum(
            balanceForm.accrued_revenue.accruals_reversed_on_billing
          ),
          gl_closing_balance: parseNum(balanceForm.accrued_revenue.gl_closing_balance),
        },
        trade_receivables: {
          opening_balance: parseNum(balanceForm.trade_receivables.opening_balance),
          invoices_raised: parseNum(balanceForm.trade_receivables.invoices_raised),
          cash_collected: parseNum(balanceForm.trade_receivables.cash_collected),
          bad_debt_written_off: parseNum(balanceForm.trade_receivables.bad_debt_written_off),
          gl_closing_balance: parseNum(balanceForm.trade_receivables.gl_closing_balance),
        },
      });
      if (res.error) throw new Error(res.error);
      const data = res.data as BalanceResult;
      setBalanceResult(data);
      const allOk = data.overall_status === 'ALL RECONCILED';
      setBalancePill(allOk ? 'Contract Balances: ✓' : `Contract Balances: ${data.overall_status}`);
      toast.success('Contract balance tracker complete');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Balance tracker failed');
    } finally {
      setBalanceLoading(false);
    }
  };

  const copyDisclosure = useCallback(async () => {
    const text = balanceResult?.ifrs15_disclosure_note;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Disclosure note copied to clipboard');
    } catch {
      toast.error('Could not copy to clipboard');
    }
  }, [balanceResult?.ifrs15_disclosure_note]);

  const sspCompliant = sspResult?.overall_status === 'COMPLIANT';
  const balanceAllOk = balanceResult?.overall_status === 'ALL RECONCILED';
  const accounts = balanceResult?.accounts ?? {};

  return (
    <SidebarLayout
      pageTitle="Rev Rec Reconciliation"
      pageSubtitle="IFRS 15 month-end — SSP allocation & contract balances"
    >
      <div className="space-y-6">
        <StatusPillsRow sspPill={sspPill} balancePill={balancePill} />

        <section className="bg-white rounded-[14px] p-6 border border-border-default shadow-card">
          <CardHeader
            number={8}
            title="Period GL vs IFRS.ai Revenue"
            subtitle="BlackLine-style reconciliation by contract"
          />
          <PeriodReconciliationTab />
        </section>

        <section className="bg-white rounded-[14px] p-6 border border-border-default shadow-card">
          <CardHeader
            number={7}
            title="SSP Allocation Variance Check"
            subtitle="IFRS 15 para 73-86 — standalone selling price compliance"
          />

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Period</label>
              <input className={inputClass} value={sspForm.period} onChange={(e) => setSspForm((f) => ({ ...f, period: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Contract ID</label>
              <input className={inputClass} value={sspForm.contract_id} onChange={(e) => setSspForm((f) => ({ ...f, contract_id: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Customer name</label>
              <input className={inputClass} value={sspForm.customer_name} onChange={(e) => setSspForm((f) => ({ ...f, customer_name: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Total contract value ($)</label>
              <input type="number" step="0.01" className={inputClass} value={sspForm.total_contract_value} onChange={(e) => setSspForm((f) => ({ ...f, total_contract_value: e.target.value }))} />
            </div>
            <div className="md:col-span-2 lg:col-span-1">
              <label className="block text-xs font-medium text-text-muted mb-1">SSP method</label>
              <select className={inputClass} value={sspForm.ssp_method} onChange={(e) => setSspForm((f) => ({ ...f, ssp_method: e.target.value as SspMethod }))}>
                {SSP_METHODS.map((m) => (<option key={m} value={m}>{m}</option>))}
              </select>
            </div>
          </div>

          <div className="overflow-x-auto mb-4">
            <table className="w-full text-sm border-collapse min-w-[720px]">
              <thead>
                <tr className="text-left text-xs text-text-muted border-b">
                  <th className="py-2 pr-2">PO Name</th>
                  <th className="py-2 pr-2">SSP Used ($)</th>
                  <th className="py-2 pr-2">SSP Supported ($)</th>
                  <th className="py-2 pr-2">Allocated ($)</th>
                  <th className="py-2 pr-2">Recognition</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {poRows.map((row) => (
                  <tr key={row.id} className="border-b border-border-default/60">
                    <td className="py-2 pr-2"><input className={inputClass} value={row.po_name} onChange={(e) => updatePo(row.id, { po_name: e.target.value })} /></td>
                    <td className="py-2 pr-2"><input type="number" className={inputClass} value={row.ssp_used} onChange={(e) => updatePo(row.id, { ssp_used: e.target.value })} /></td>
                    <td className="py-2 pr-2"><input type="number" className={inputClass} value={row.ssp_supported} onChange={(e) => updatePo(row.id, { ssp_supported: e.target.value })} /></td>
                    <td className="py-2 pr-2"><input type="number" className={inputClass} value={row.allocated_amount} onChange={(e) => updatePo(row.id, { allocated_amount: e.target.value })} /></td>
                    <td className="py-2 pr-2">
                      <select className={inputClass} value={row.recognition_pattern} onChange={(e) => updatePo(row.id, { recognition_pattern: e.target.value as RecognitionPattern })}>
                        <option value="Over time">Over time</option>
                        <option value="Point in time">Point in time</option>
                      </select>
                    </td>
                    <td className="py-2">
                      <button type="button" className="p-1.5 text-red-500 hover:bg-red-50 rounded disabled:opacity-30" disabled={poRows.length <= 1} onClick={() => removePoRow(row.id)} aria-label="Remove PO"><Trash2 className="w-4 h-4" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button type="button" onClick={addPoRow} className="inline-flex items-center gap-1 text-sm font-semibold text-orange-primary hover:underline mb-4">
            <Plus className="w-4 h-4" /> Add Performance Obligation
          </button>

          <Button onClick={runSspCheck} disabled={sspLoading}>{sspLoading ? 'Running…' : 'Run SSP Check'}</Button>

          {sspResult && (
            <div className="mt-6 pt-6 border-t border-border-default space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className={cn('inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-bold border', sspCompliant ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 'bg-red-100 text-red-800 border-red-300')}>
                  {sspCompliant ? <><CheckCircle2 className="w-4 h-4" /> COMPLIANT</> : <><XCircle className="w-4 h-4" /> EXCEPTIONS FOUND</>}
                </span>
                <span className={cn('text-sm font-medium', Math.abs(sspResult.allocation_rounding_diff) >= 0.01 ? 'text-red-600' : 'text-emerald-700')}>
                  Allocation rounding difference: ${formatMoney(sspResult.allocation_rounding_diff)}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs sm:text-sm border-collapse">
                  <thead>
                    <tr className="text-left text-text-muted border-b bg-slate-50">
                      <th className="p-2">PO Name</th><th className="p-2">SSP Used</th><th className="p-2">SSP Supported</th><th className="p-2">SSP Variance</th>
                      <th className="p-2">Allocated</th><th className="p-2">Correct</th><th className="p-2">Difference</th><th className="p-2">Status</th><th className="p-2">Risk</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sspResult.po_results.map((p) => (
                      <tr key={p.po_name} className="border-b">
                        <td className="p-2 font-medium">{p.po_name}</td>
                        <td className="p-2">${formatMoney(p.ssp_used)}</td>
                        <td className="p-2">${formatMoney(p.ssp_supported)}</td>
                        <td className="p-2">${formatMoney(p.ssp_variance)}</td>
                        <td className="p-2">${formatMoney(p.allocated_amount)}</td>
                        <td className="p-2">${formatMoney(p.correct_allocation)}</td>
                        <td className="p-2">${formatMoney(p.allocation_variance)}</td>
                        <td className="p-2"><span className={cn('px-2 py-0.5 rounded text-xs font-semibold border', poStatusStyles(p.po_status))}>{p.po_status}</span></td>
                        <td className="p-2">{p.risk}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {(sspResult.reallocation_journal?.length ?? 0) > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <p className="font-semibold text-text-primary mb-2">Suggested reallocation journal entry:</p>
                  {sspResult.reallocation_journal.map((j, i) => (
                    <div key={i} className="font-mono text-sm mb-3 last:mb-0">
                      <p>Dr {j.dr_account} ${formatMoney(j.amount)}</p>
                      <p>Cr {j.cr_account} ${formatMoney(j.amount)}</p>
                      <p className="font-sans text-xs text-text-muted mt-1">Narrative: {j.narrative}</p>
                    </div>
                  ))}
                </div>
              )}
              {sspResult.nova_commentary && (
                <div className="flex gap-2 text-sm text-blue-800 italic bg-blue-50 border border-blue-100 rounded-lg p-4">
                  <Sparkles className="w-4 h-4 shrink-0 mt-0.5" />
                  <p>{sspResult.nova_commentary}</p>
                </div>
              )}
            </div>
          )}
        </section>

        <section className="bg-white rounded-[14px] p-6 border border-border-default shadow-card">
          <CardHeader number={8} title="Contract Asset & Liability Tracker" subtitle="IFRS 15 para 116-118 — balance sheet account movements" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Period</label>
              <input className={inputClass} value={balanceForm.period} onChange={(e) => setBalanceForm((f) => ({ ...f, period: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Prior period</label>
              <input className={inputClass} value={balanceForm.prior_period} onChange={(e) => setBalanceForm((f) => ({ ...f, prior_period: e.target.value }))} />
            </div>
          </div>
          <BalanceSubsection title="Contract Asset (Unbilled Revenue)" borderClass="border-l-teal-500" fields={[{ key: 'opening_balance', label: 'Opening balance ($)' }, { key: 'revenue_recognised_unbilled', label: 'Revenue recognised — unbilled ($)' }, { key: 'invoiced_this_period', label: 'Invoiced this period ($)' }, { key: 'cancellations_reversed', label: 'Cancellations reversed ($)' }]} values={balanceForm.contract_asset} onChange={(k, v) => setBalanceField('contract_asset', k, v)} />
          <BalanceSubsection title="Deferred Revenue (Contract Liability)" borderClass="border-l-blue-500" fields={[{ key: 'opening_balance', label: 'Opening balance ($)' }, { key: 'new_billings_received', label: 'New billings received ($)' }, { key: 'revenue_recognised', label: 'Revenue recognised ($)' }, { key: 'cancellations_refunded', label: 'Cancellations refunded ($)' }]} values={balanceForm.deferred_revenue} onChange={(k, v) => setBalanceField('deferred_revenue', k, v)} />
          <BalanceSubsection title="Accrued Revenue" borderClass="border-l-amber-500" fields={[{ key: 'opening_balance', label: 'Opening balance ($)' }, { key: 'accruals_raised', label: 'Accruals raised ($)' }, { key: 'accruals_reversed_on_billing', label: 'Accruals reversed on billing ($)', wide: true }]} values={balanceForm.accrued_revenue} onChange={(k, v) => setBalanceField('accrued_revenue', k, v)} />
          <BalanceSubsection title="Trade Receivables" borderClass="border-l-purple-500" fields={[{ key: 'opening_balance', label: 'Opening balance ($)' }, { key: 'invoices_raised', label: 'Invoices raised ($)' }, { key: 'cash_collected', label: 'Cash collected ($)' }, { key: 'bad_debt_written_off', label: 'Bad debt written off ($)' }]} values={balanceForm.trade_receivables} onChange={(k, v) => setBalanceField('trade_receivables', k, v)} />
          <Button onClick={runBalanceTracker} disabled={balanceLoading} className="mt-2">{balanceLoading ? 'Running…' : 'Run Balance Tracker'}</Button>
          {balanceResult && (
            <div className="mt-6 pt-6 border-t border-border-default space-y-4">
              <span className={cn('inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-bold border', balanceAllOk ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 'bg-red-100 text-red-800 border-red-300')}>
                {balanceAllOk ? <><CheckCircle2 className="w-4 h-4" /> All 4 accounts reconciled</> : <><AlertTriangle className="w-4 h-4" /> {balanceResult.overall_status}</>}
              </span>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <AccountMovementCard title="Contract Asset" account={accounts.contract_asset} />
                <AccountMovementCard title="Deferred Revenue" account={accounts.deferred_revenue} />
                <AccountMovementCard title="Accrued Revenue" account={accounts.accrued_revenue} />
                <AccountMovementCard title="Trade Receivables" account={accounts.trade_receivables} />
              </div>
              {balanceResult.ifrs15_disclosure_note && (
                <div className="relative bg-slate-100 border border-slate-200 rounded-lg p-4">
                  <div className="flex justify-between items-start gap-2 mb-2">
                    <h3 className="text-sm font-bold">IFRS 15 Contract Balances Disclosure Note (draft)</h3>
                    <button type="button" onClick={copyDisclosure} className="inline-flex items-center gap-1 text-xs font-semibold text-orange-primary hover:underline shrink-0"><Copy className="w-3.5 h-3.5" /> Copy</button>
                  </div>
                  <pre className="text-xs font-mono whitespace-pre-wrap text-text-secondary">{balanceResult.ifrs15_disclosure_note}</pre>
                </div>
              )}
              {balanceResult.nova_commentary && (
                <div className="flex gap-2 text-sm text-blue-800 italic bg-blue-50 border border-blue-100 rounded-lg p-4">
                  <Sparkles className="w-4 h-4 shrink-0 mt-0.5" />
                  <p>{balanceResult.nova_commentary}</p>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </SidebarLayout>
  );
}
