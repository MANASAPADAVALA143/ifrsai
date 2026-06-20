'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { SidebarLayout } from '@/components/SidebarLayout';
import { Button } from '@/components/Button';
import { ifrs16ComparativeApi } from '@/lib/api';
import {
  BarChart3,
  Calendar,
  CheckCircle2,
  Loader2,
  Lock,
  RefreshCw,
  Settings,
  Table2,
  Unlock,
} from 'lucide-react';
import toast from 'react-hot-toast';

const cardClass =
  'bg-white rounded-[14px] border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)]';
const inputClass =
  'w-full px-3 py-2 border border-[#e2e8f0] rounded-lg text-sm focus:ring-2 focus:ring-[#f97316]/30 focus:border-[#f97316]';
const labelClass = 'block text-xs font-medium text-[#64748b] uppercase tracking-wide mb-1';

type Tab = 'close' | 'disclosures' | 'settings';

type SnapshotRow = {
  id: string;
  period_label: string;
  period_start: string;
  period_end: string;
  status: string;
  closed_at?: string;
  lease_count_active?: number;
  rou_closing?: number;
  ll_closing?: number;
  pl_total?: number;
};

type ComparativeCell = { curr: number | null; prior: number | null };

const FY_PRESETS = [
  { value: '12-31', label: '31 December', hint: 'UAE, most international' },
  { value: '03-31', label: '31 March', hint: 'India, UK' },
  { value: '06-30', label: '30 June', hint: 'Australia' },
  { value: '09-30', label: '30 September', hint: 'Custom' },
];

function fmt(n: number | null | undefined, ccy = 'AED') {
  if (n == null || Number.isNaN(n)) return '—';
  return `${ccy} ${Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function statusBadge(status: string) {
  const base = 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium';
  if (status === 'closed') return `${base} bg-emerald-50 text-emerald-700`;
  if (status === 'draft') return `${base} bg-amber-50 text-amber-700`;
  if (status === 'reopened') return `${base} bg-sky-50 text-sky-700`;
  return `${base} bg-slate-100 text-slate-600`;
}

function DisclosureTable({
  title,
  ifrsRef,
  rows,
  data,
  currentLabel,
  priorLabel,
  hasComparative,
  currency,
}: {
  title: string;
  ifrsRef: string;
  rows: { label: string; key: string }[];
  data: Record<string, ComparativeCell>;
  currentLabel: string;
  priorLabel: string | null;
  hasComparative: boolean;
  currency: string;
}) {
  return (
    <div className={`${cardClass} overflow-hidden`}>
      <div className="px-5 py-4 border-b border-[#e2e8f0]">
        <h3 className="text-sm font-semibold text-[#1e293b]">{title}</h3>
        <p className="text-xs text-[#64748b] mt-0.5">{ifrsRef}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#f8fafc] text-left text-xs uppercase tracking-wide text-[#64748b]">
              <th className="px-5 py-3 font-medium">Line item</th>
              <th className="px-5 py-3 font-medium text-right">{currentLabel}</th>
              {hasComparative && (
                <th className="px-5 py-3 font-medium text-right">{priorLabel}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ label, key }) => {
              const cell = data[key];
              return (
                <tr key={key} className="border-t border-[#f1f5f9]">
                  <td className="px-5 py-2.5 text-[#334155]">{label}</td>
                  <td className="px-5 py-2.5 text-right font-mono text-[#1e293b]">
                    {fmt(cell?.curr, currency)}
                  </td>
                  {hasComparative && (
                    <td className="px-5 py-2.5 text-right font-mono text-[#64748b]">
                      {fmt(cell?.prior, currency)}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ComparativeReportsPage() {
  const [tab, setTab] = useState<Tab>('close');
  const [year, setYear] = useState(new Date().getFullYear() - 1);
  const [currency, setCurrency] = useState('AED');
  const [fiscalYearEnd, setFiscalYearEnd] = useState('12-31');
  const [country, setCountry] = useState('UAE');
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [periods, setPeriods] = useState<{ label: string; period_end: string }[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState('');
  const [report, setReport] = useState<{
    has_comparative: boolean;
    current_period: string;
    prior_period: string | null;
    data: Record<string, Record<string, ComparativeCell>>;
  } | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [loadingReport, setLoadingReport] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [closeTarget, setCloseTarget] = useState<SnapshotRow | null>(null);
  const [busyId, setBusyId] = useState('');
  const [migrationHint, setMigrationHint] = useState('');

  const loadSettings = useCallback(async () => {
    const { data, error } = await ifrs16ComparativeApi.getSettings();
    if (error) return;
    const s = (data as { settings?: Record<string, unknown> })?.settings;
    if (!s) return;
    if (s.fiscal_year_end) setFiscalYearEnd(String(s.fiscal_year_end));
    if (s.currency) setCurrency(String(s.currency));
    if (s.country) setCountry(String(s.country));
    if (s._migration_required) {
      setMigrationHint(String(s._migration_hint || 'Run IFRS 16 migrations in Supabase SQL Editor.'));
    } else {
      setMigrationHint('');
    }
  }, []);

  const loadSnapshots = useCallback(async () => {
    const { data, error } = await ifrs16ComparativeApi.listSnapshots();
    if (error) {
      toast.error(error);
      return;
    }
    const list = ((data as { snapshots?: SnapshotRow[] })?.snapshots || []) as SnapshotRow[];
    setSnapshots(list);
  }, []);

  const loadPeriods = useCallback(async () => {
    const { data, error } = await ifrs16ComparativeApi.getAvailablePeriods();
    if (error) return;
    const p = (data as { periods?: { label: string; period_end: string }[] })?.periods || [];
    setPeriods(p);
    setSelectedPeriod((prev) => prev || p[0]?.label || '');
  }, []);

  useEffect(() => {
    void loadSettings();
    void loadSnapshots();
    void loadPeriods();
  }, [loadSettings, loadSnapshots, loadPeriods]);

  const runPreview = async () => {
    setLoadingPreview(true);
    setPreview(null);
    try {
      const { data, error } = await ifrs16ComparativeApi.previewSnapshot({ year });
      if (error) throw new Error(error);
      setPreview((data as { preview?: Record<string, unknown> })?.preview || null);
      toast.success('Preview ready');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Preview failed');
    } finally {
      setLoadingPreview(false);
    }
  };

  const createDraft = async () => {
    setLoadingDraft(true);
    try {
      const { data, error } = await ifrs16ComparativeApi.createSnapshot({ year });
      if (error) throw new Error(error);
      toast.success(`Draft saved for ${(data as { snapshot?: SnapshotRow })?.snapshot?.period_label || year}`);
      setPreview(null);
      await loadSnapshots();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create draft');
    } finally {
      setLoadingDraft(false);
    }
  };

  const confirmClose = async () => {
    if (!closeTarget) return;
    setBusyId(closeTarget.id);
    try {
      const { data, error } = await ifrs16ComparativeApi.closeSnapshot(closeTarget.id);
      if (error) throw new Error(error);
      toast.success((data as { message?: string })?.message || 'Period closed');
      setCloseTarget(null);
      await loadSnapshots();
      await loadPeriods();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Close failed');
    } finally {
      setBusyId('');
    }
  };

  const reopen = async (snap: SnapshotRow) => {
    setBusyId(snap.id);
    try {
      const { error } = await ifrs16ComparativeApi.reopenSnapshot(snap.id);
      if (error) throw new Error(error);
      toast.success(`${snap.period_label} reopened`);
      await loadSnapshots();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Reopen failed');
    } finally {
      setBusyId('');
    }
  };

  const loadReport = async (label?: string) => {
    const pl = label || selectedPeriod;
    if (!pl) return;
    setLoadingReport(true);
    try {
      const { data, error } = await ifrs16ComparativeApi.getReport(pl);
      if (error) throw new Error(error);
      setReport(data as typeof report);
      setTab('disclosures');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Report not available');
    } finally {
      setLoadingReport(false);
    }
  };

  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      const { error } = await ifrs16ComparativeApi.updateSettings({
        fiscal_year_end: fiscalYearEnd,
        currency,
        country,
      });
      if (error) throw new Error(error);
      toast.success('Fiscal year settings saved');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSavingSettings(false);
    }
  };

  const previewFigures = (preview?.figures || {}) as Record<string, number>;
  const reportData = report?.data || {};

  const tabs = useMemo(
    () => [
      { id: 'close' as Tab, label: 'Close Period', icon: Lock },
      { id: 'disclosures' as Tab, label: 'Disclosures', icon: Table2 },
      { id: 'settings' as Tab, label: 'FY Settings', icon: Settings },
    ],
    []
  );

  return (
    <SidebarLayout
      pageTitle="Comparative Reports"
      pageSubtitle="IFRS 16 period close, frozen snapshots, and year-on-year disclosures"
    >
      {migrationHint && (
        <div className="mb-4 flex items-start gap-3 p-4 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-900">
          <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Database setup required</p>
            <p className="mt-1">{migrationHint}</p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-6">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === id
                ? 'bg-[#f97316] text-white shadow-sm'
                : 'bg-white border border-[#e2e8f0] text-[#64748b] hover:bg-[#f8fafc]'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'close' && (
        <div className="space-y-6">
          <div className={`${cardClass} p-5`}>
            <h2 className="text-base font-semibold text-[#1e293b] mb-1">Close fiscal year</h2>
            <p className="text-sm text-[#64748b] mb-4">
              Preview figures from live lease schedules, save a draft, then close to freeze for comparatives.
            </p>
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className={labelClass}>Fiscal year</label>
                <input
                  type="number"
                  className={`${inputClass} w-32`}
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value))}
                />
              </div>
              <Button onClick={runPreview} disabled={loadingPreview}>
                {loadingPreview ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                Preview
              </Button>
              {preview && (
                <Button variant="secondary" onClick={createDraft} disabled={loadingDraft}>
                  {loadingDraft ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Calendar className="w-4 h-4 mr-2" />}
                  Create draft snapshot
                </Button>
              )}
            </div>
          </div>

          {preview && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: 'Active leases', value: String(preview.lease_count ?? previewFigures.lease_count_active ?? 0) },
                { label: 'ROU asset (closing)', value: fmt(previewFigures.rou_closing, currency) },
                { label: 'Lease liability (closing)', value: fmt(previewFigures.ll_closing, currency) },
                { label: 'P&L charge', value: fmt(previewFigures.pl_total, currency) },
              ].map((c) => (
                <div key={c.label} className={`${cardClass} p-4`}>
                  <p className="text-xs text-[#64748b] uppercase tracking-wide">{c.label}</p>
                  <p className="text-lg font-semibold text-[#1e293b] mt-1">{c.value}</p>
                  <p className="text-xs text-[#94a3b8] mt-1">{String(preview.period_label || '')}</p>
                </div>
              ))}
            </div>
          )}

          <div className={`${cardClass} overflow-hidden`}>
            <div className="px-5 py-4 border-b border-[#e2e8f0] flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#1e293b]">Period snapshots</h3>
              <button type="button" onClick={() => void loadSnapshots()} className="text-xs text-[#f97316] hover:underline">
                Refresh
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#f8fafc] text-left text-xs uppercase tracking-wide text-[#64748b]">
                    <th className="px-5 py-3">Period</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3 text-right">ROU closing</th>
                    <th className="px-5 py-3 text-right">LL closing</th>
                    <th className="px-5 py-3 text-right">P&L</th>
                    <th className="px-5 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshots.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-5 py-8 text-center text-[#94a3b8]">
                        No snapshots yet — preview and create a draft to get started.
                      </td>
                    </tr>
                  )}
                  {snapshots.map((s) => (
                    <tr key={s.id} className="border-t border-[#f1f5f9]">
                      <td className="px-5 py-3 font-medium text-[#1e293b]">{s.period_label}</td>
                      <td className="px-5 py-3">
                        <span className={statusBadge(s.status)}>{s.status}</span>
                      </td>
                      <td className="px-5 py-3 text-right font-mono">{fmt(s.rou_closing, currency)}</td>
                      <td className="px-5 py-3 text-right font-mono">{fmt(s.ll_closing, currency)}</td>
                      <td className="px-5 py-3 text-right font-mono">{fmt(s.pl_total, currency)}</td>
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap gap-2">
                          {s.status !== 'closed' && (
                            <Button size="sm" onClick={() => setCloseTarget(s)} disabled={busyId === s.id}>
                              {busyId === s.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Lock className="w-3 h-3 mr-1" />}
                              Close
                            </Button>
                          )}
                          {s.status === 'closed' && (
                            <>
                              <Button size="sm" variant="secondary" onClick={() => void loadReport(s.period_label)}>
                                <BarChart3 className="w-3 h-3 mr-1" />
                                Disclosures
                              </Button>
                              <Button size="sm" variant="secondary" onClick={() => void reopen(s)} disabled={busyId === s.id}>
                                <Unlock className="w-3 h-3 mr-1" />
                                Reopen
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'disclosures' && (
        <div className="space-y-6">
          <div className={`${cardClass} p-5 flex flex-wrap items-end gap-4`}>
            <div className="flex-1 min-w-[200px]">
              <label className={labelClass}>Closed period</label>
              <select
                className={inputClass}
                value={selectedPeriod}
                onChange={(e) => setSelectedPeriod(e.target.value)}
              >
                {periods.length === 0 && <option value="">No closed periods</option>}
                {periods.map((p) => (
                  <option key={p.label} value={p.label}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <Button onClick={() => void loadReport()} disabled={!selectedPeriod || loadingReport}>
              {loadingReport ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Table2 className="w-4 h-4 mr-2" />}
              Load report
            </Button>
          </div>

          {report && !report.has_comparative && (
            <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-900">
              <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
              <p>
                First closed year — showing current period only. Prior year column appears automatically once a second
                year is closed.
              </p>
            </div>
          )}

          {report && (
            <div className="space-y-4">
              <DisclosureTable
                title="ROU asset movement"
                ifrsRef="IFRS 16 §53(j)"
                rows={[
                  { label: 'Opening', key: 'opening' },
                  { label: 'Additions', key: 'additions' },
                  { label: 'Depreciation', key: 'depreciation' },
                  { label: 'Disposals', key: 'disposals' },
                  { label: 'Remeasurements', key: 'remeasurements' },
                  { label: 'Closing', key: 'closing' },
                ]}
                data={reportData.rou_movement || {}}
                currentLabel={report.current_period}
                priorLabel={report.prior_period}
                hasComparative={report.has_comparative}
                currency={currency}
              />
              <DisclosureTable
                title="Lease liability movement"
                ifrsRef="IFRS 16 §58"
                rows={[
                  { label: 'Opening', key: 'opening' },
                  { label: 'New leases', key: 'new_leases' },
                  { label: 'Interest', key: 'interest' },
                  { label: 'Payments', key: 'payments' },
                  { label: 'Modifications', key: 'modifications' },
                  { label: 'Terminations', key: 'terminations' },
                  { label: 'Closing', key: 'closing' },
                  { label: 'Current portion', key: 'current_portion' },
                  { label: 'Non-current portion', key: 'non_current_portion' },
                ]}
                data={reportData.ll_movement || {}}
                currentLabel={report.current_period}
                priorLabel={report.prior_period}
                hasComparative={report.has_comparative}
                currency={currency}
              />
              <DisclosureTable
                title="Amounts recognised in P&L"
                ifrsRef="IFRS 16 §53"
                rows={[
                  { label: 'Depreciation', key: 'depreciation' },
                  { label: 'Interest', key: 'interest' },
                  { label: 'Short-term lease expense', key: 'short_term' },
                  { label: 'Low-value lease expense', key: 'low_value' },
                  { label: 'Total', key: 'total' },
                ]}
                data={reportData.pl_charges || {}}
                currentLabel={report.current_period}
                priorLabel={report.prior_period}
                hasComparative={report.has_comparative}
                currency={currency}
              />
              <DisclosureTable
                title="Total cash outflow for leases"
                ifrsRef="IFRS 16 §53(g)"
                rows={[{ label: 'Total cash outflow', key: 'total' }]}
                data={reportData.cash_flow || {}}
                currentLabel={report.current_period}
                priorLabel={report.prior_period}
                hasComparative={report.has_comparative}
                currency={currency}
              />
              <DisclosureTable
                title="Maturity analysis (undiscounted)"
                ifrsRef="IFRS 16 §58(b)"
                rows={[
                  { label: 'Within 1 year', key: 'less_1yr' },
                  { label: '1–2 years', key: '1_to_2yr' },
                  { label: '2–3 years', key: '2_to_3yr' },
                  { label: '3–4 years', key: '3_to_4yr' },
                  { label: '4–5 years', key: '4_to_5yr' },
                  { label: 'Over 5 years', key: 'over_5yr' },
                  { label: 'Total', key: 'total' },
                ]}
                data={reportData.maturity || {}}
                currentLabel={report.current_period}
                priorLabel={report.prior_period}
                hasComparative={report.has_comparative}
                currency={currency}
              />
            </div>
          )}
        </div>
      )}

      {tab === 'settings' && (
        <div className={`${cardClass} p-5 max-w-xl space-y-5`}>
          <div>
            <h2 className="text-base font-semibold text-[#1e293b]">Fiscal year end</h2>
            <p className="text-sm text-[#64748b] mt-1">Used for period labels, snapshots, and disclosure reports.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {FY_PRESETS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setFiscalYearEnd(p.value)}
                className={`text-left p-3 rounded-lg border transition-colors ${
                  fiscalYearEnd === p.value
                    ? 'border-[#f97316] bg-orange-50'
                    : 'border-[#e2e8f0] hover:border-[#cbd5e1]'
                }`}
              >
                <p className="text-sm font-medium text-[#1e293b]">{p.label}</p>
                <p className="text-xs text-[#64748b]">{p.hint}</p>
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Currency</label>
              <input className={inputClass} value={currency} onChange={(e) => setCurrency(e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>Country</label>
              <input className={inputClass} value={country} onChange={(e) => setCountry(e.target.value)} />
            </div>
          </div>
          <Button onClick={saveSettings} disabled={savingSettings}>
            {savingSettings ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Settings className="w-4 h-4 mr-2" />}
            Save settings
          </Button>
        </div>
      )}

      {closeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className={`${cardClass} max-w-md w-full p-6`}>
            <h3 className="text-lg font-semibold text-[#1e293b]">Close {closeTarget.period_label}?</h3>
            <p className="text-sm text-[#64748b] mt-2">
              Figures will be frozen permanently. Recalculations will not change this snapshot. Reopen only for audit
              corrections.
            </p>
            <div className="flex justify-end gap-3 mt-6">
              <Button variant="secondary" onClick={() => setCloseTarget(null)}>
                Cancel
              </Button>
              <Button onClick={() => void confirmClose()} disabled={busyId === closeTarget.id}>
                {busyId === closeTarget.id ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Lock className="w-4 h-4 mr-2" />}
                Close period
              </Button>
            </div>
          </div>
        </div>
      )}
    </SidebarLayout>
  );
}
