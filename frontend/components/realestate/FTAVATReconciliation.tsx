'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/Button';
import { ifrs15Api } from '@/lib/api';
import { ChevronDown, ChevronRight, Download, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

export type FTAReturnRow = {
  quarter: string;
  period_start: string;
  period_end: string;
  box_1a: number;
  box_1b: number;
  box_7: number;
  box_8: number;
  fta_return_ref: string;
  filing_date: string;
  status: 'draft' | 'filed' | 'amended';
};

type Props = {
  reraNumber: string;
  projectName: string;
  developerName: string;
  currency: string;
  periodSchedule: Record<string, unknown>[];
  fmt: (n: number) => string;
  onResultChange?: (report: Record<string, unknown> | null) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

function periodBoundsFromEnd(periodEnd: string): { start: string; end: string } {
  if (!periodEnd || periodEnd.length < 10) return { start: '', end: periodEnd };
  const d = new Date(periodEnd.slice(0, 10));
  if (Number.isNaN(d.getTime())) return { start: '', end: periodEnd };
  const q = Math.floor(d.getMonth() / 3);
  const start = new Date(d.getFullYear(), q * 3, 1);
  return {
    start: start.toISOString().slice(0, 10),
    end: periodEnd.slice(0, 10),
  };
}

function scheduleToFtaRow(row: Record<string, unknown>): FTAReturnRow {
  const periodEnd = String(row.period_end || '');
  const { start, end } = periodBoundsFromEnd(periodEnd);
  const rev = Number(row.revenue_recognised ?? row.revenue) || 0;
  const box1b = Math.round(rev * 0.05 * 100) / 100;
  return {
    quarter: String(row.period || row.quarter || ''),
    period_start: String(row.period_start || start),
    period_end: end,
    box_1a: 0,
    box_1b: box1b,
    box_7: 0,
    box_8: box1b,
    fta_return_ref: '',
    filing_date: '',
    status: 'draft',
  };
}

function computeLocalFtaPreview(
  ftaReturns: FTAReturnRow[],
  periodSchedule: Record<string, unknown>[],
  fmt: (n: number) => string
): { level: 'high' | 'medium' | 'low'; message: string } | null {
  if (!periodSchedule.length) return null;
  const pairs = ftaReturns.map((r, i) => ({
    ifrs: Number(periodSchedule[i]?.revenue_recognised) || 0,
    box1a: Number(r.box_1a) || 0,
  }));
  if (!pairs.some((p) => p.box1a > 0)) return null;
  const ifrsTotal = pairs.reduce((s, p) => s + p.ifrs, 0);
  const ftaTotal = pairs.reduce((s, p) => s + p.box1a, 0);
  const diff = ifrsTotal - ftaTotal;
  const pct = ifrsTotal > 0 ? (Math.abs(diff) / ifrsTotal) * 100 : 0;
  let level: 'high' | 'medium' | 'low' = 'low';
  if (pct > 10) level = 'high';
  else if (pct >= 5) level = 'medium';
  const message = `IFRS 15 revenue ${fmt(ifrsTotal)} vs FTA Box 1a ${fmt(ftaTotal)} — unexplained difference ${fmt(Math.abs(diff))}. Federal Decree-Law No. 8 of 2017 — potential compliance issue.`;
  return { level, message };
}

function loadStoredReturns(rera: string): FTAReturnRow[] {
  if (typeof window === 'undefined' || !rera.trim()) return [];
  try {
    const raw = localStorage.getItem(`fta_returns_${rera.trim()}`);
    return raw ? (JSON.parse(raw) as FTAReturnRow[]) : [];
  } catch {
    return [];
  }
}

export function FTAVATReconciliation({
  reraNumber,
  projectName,
  developerName,
  currency,
  periodSchedule,
  fmt,
  onResultChange,
  open: openProp,
  onOpenChange,
}: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const ftaVatOpen = openProp ?? internalOpen;
  const setFtaVatOpen = onOpenChange ?? setInternalOpen;

  const [ftaReturns, setFtaReturns] = useState<FTAReturnRow[]>([]);
  const [vatRecResult, setVatRecResult] = useState<Record<string, unknown> | null>(null);
  const [vatRecLoading, setVatRecLoading] = useState(false);
  const [vatRecError, setVatRecError] = useState<string | null>(null);

  useEffect(() => {
    if (!reraNumber.trim()) return;
    if (periodSchedule.length === 0) {
      const saved = loadStoredReturns(reraNumber);
      if (saved.length > 0) setFtaReturns(saved);
      return;
    }
    const scheduleQuarters = new Set(
      periodSchedule.map((row) => String(row.period || row.quarter || ''))
    );
    const saved = loadStoredReturns(reraNumber).filter((r) => scheduleQuarters.has(r.quarter));
    const savedByQuarter = Object.fromEntries(saved.map((r) => [r.quarter, r]));
    setFtaReturns(
      periodSchedule.map((row) => {
        const base = scheduleToFtaRow(row);
        const prev = savedByQuarter[base.quarter];
        if (!prev) return base;
        return {
          ...base,
          box_1a: prev.box_1a,
          box_1b: prev.box_1b,
          box_7: prev.box_7,
          box_8: prev.box_8,
          fta_return_ref: prev.fta_return_ref,
          filing_date: prev.filing_date,
          status: prev.status,
        };
      })
    );
  }, [reraNumber, periodSchedule]);

  useEffect(() => {
    if (typeof window === 'undefined' || !reraNumber.trim()) return;
    localStorage.setItem(`fta_returns_${reraNumber.trim()}`, JSON.stringify(ftaReturns));
  }, [ftaReturns, reraNumber]);

  const setResult = useCallback(
    (r: Record<string, unknown> | null) => {
      setVatRecResult(r);
      onResultChange?.(r);
    },
    [onResultChange]
  );

  const buildPayload = useCallback(
    () => ({
      rera_registration_number: reraNumber.trim(),
      project_name: projectName.trim(),
      developer_name: developerName,
      currency,
      quarterly_schedule: periodSchedule.map((row) => ({
        period: row.period,
        quarter: row.period,
        period_start: row.period_start,
        period_end: row.period_end,
        revenue_recognised: row.revenue_recognised,
        revenue: row.revenue_recognised,
      })),
      fta_returns: ftaReturns.map((r) => ({
        quarter: r.quarter,
        period_start: r.period_start,
        period_end: r.period_end,
        box_1a_taxable_supplies: r.box_1a,
        box_1b_vat_on_supplies: r.box_1b,
        box_7_input_vat: r.box_7,
        box_8_net_vat_payable: r.box_8,
        fta_return_ref: r.fta_return_ref || null,
        filing_date: r.filing_date || null,
        status: r.status,
      })),
    }),
    [reraNumber, projectName, developerName, currency, periodSchedule, ftaReturns]
  );

  const handleFtaRowChange = (index: number, field: keyof FTAReturnRow, value: string | number) => {
    setFtaReturns((prev) => {
      const updated = [...prev];
      const row = { ...updated[index], [field]: value };
      if (field === 'box_1a') {
        const n = Number(value) || 0;
        row.box_1b = Math.round(n * 0.05 * 100) / 100;
        row.box_8 = row.box_1b - row.box_7;
      }
      if (field === 'box_1b' || field === 'box_7') {
        row.box_8 = row.box_1b - row.box_7;
      }
      updated[index] = row;
      return updated;
    });
  };

  const handleAddFtaRow = () => {
    const next = periodSchedule[ftaReturns.length];
    if (next) {
      setFtaReturns((prev) => [...prev, scheduleToFtaRow(next)]);
    } else {
      setFtaReturns((prev) => [
        ...prev,
        {
          quarter: '',
          period_start: '',
          period_end: '',
          box_1a: 0,
          box_1b: 0,
          box_7: 0,
          box_8: 0,
          fta_return_ref: '',
          filing_date: '',
          status: 'draft',
        },
      ]);
    }
  };

  const handleRunVatReconciliation = async () => {
    if (!periodSchedule.length) return;
    setVatRecLoading(true);
    setVatRecError(null);
    const { data, error } = await ifrs15Api.realestateVatReconciliation(buildPayload());
    setVatRecLoading(false);
    if (error) {
      setVatRecError(error);
      toast.error(error);
      return;
    }
    const rep = (data?.report as Record<string, unknown>) || null;
    setResult(rep);
    toast.success('VAT reconciliation complete');
  };

  const handleVatRecExcel = async () => {
    if (!vatRecResult) return;
    const { blob, filename, error } = await ifrs15Api.realestateVatReconciliationExport(buildPayload());
    if (error || !blob) {
      toast.error(error || 'Export failed');
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `VAT_Rec_${reraNumber}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const risk = String(vatRecResult?.overall_risk || '');
  const lines = (vatRecResult?.reconciliation_lines as Record<string, unknown>[]) || [];
  const localPreview = useMemo(
    () => computeLocalFtaPreview(ftaReturns, periodSchedule, fmt),
    [ftaReturns, periodSchedule, fmt]
  );

  return (
    <section
      id="fta-vat-reconciliation"
      className="bg-white border border-border-default rounded-lg overflow-hidden mt-6"
    >
      <button
        type="button"
        className="w-full flex items-center justify-between px-6 py-4 bg-bg-light hover:bg-slate-100 text-left"
        onClick={() => setFtaVatOpen(!ftaVatOpen)}
      >
        <span className="font-semibold text-text-primary flex items-center gap-2 flex-wrap">
          FTA VAT Return Reconciliation
          {vatRecResult && (
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                risk === 'high'
                  ? 'bg-red-100 text-red-700'
                  : risk === 'medium'
                    ? 'bg-amber-100 text-amber-800'
                    : 'bg-green-100 text-green-700'
              }`}
            >
              {risk.toUpperCase()} RISK
            </span>
          )}
        </span>
        {ftaVatOpen ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
      </button>

      {ftaVatOpen && (
        <div className="p-6 space-y-6 border-t border-border-default">
          <p className="text-sm text-text-muted">
            Reconcile IFRS 15 revenue recognition against FTA VAT return filings. Federal Decree-Law No. 8 of
            2017.
          </p>

          {!periodSchedule.length && (
            <div className="bg-amber-50 border border-amber-200 rounded p-4 text-amber-800 text-sm">
              Run recognition first to generate the quarterly schedule, then enter FTA return data here.
            </div>
          )}

          {periodSchedule.length > 0 && (
            <>
              <div>
                <h3 className="font-medium text-text-primary mb-2">Enter FTA VAT Return Data</h3>
                <p className="text-xs text-text-muted mb-3">
                  Enter Box 1a and 1b from your filed FTA VAT returns. One row per quarter.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse border border-border-default">
                    <thead>
                      <tr className="bg-bg-light text-left text-xs text-text-muted">
                        {[
                          'Quarter',
                          'Period Start',
                          'Period End',
                          'Box 1a (Taxable)',
                          'Box 1b',
                          'Box 7',
                          'Box 8',
                          'Return Ref',
                          'Filing Date',
                          'Status',
                          '',
                        ].map((h) => (
                          <th key={h || 'x'} className="border border-border-default px-2 py-1">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {ftaReturns.map((row, i) => (
                        <tr key={i} className="hover:bg-bg-light">
                          <td className="border border-border-default px-1 py-1">
                            <input
                              className="w-24 text-xs border rounded px-1 py-0.5"
                              value={row.quarter}
                              onChange={(e) => handleFtaRowChange(i, 'quarter', e.target.value)}
                            />
                          </td>
                          <td className="border border-border-default px-1 py-1">
                            <input
                              type="date"
                              className="text-xs border rounded px-1"
                              value={row.period_start}
                              onChange={(e) => handleFtaRowChange(i, 'period_start', e.target.value)}
                            />
                          </td>
                          <td className="border border-border-default px-1 py-1">
                            <input
                              type="date"
                              className="text-xs border rounded px-1"
                              value={row.period_end}
                              onChange={(e) => handleFtaRowChange(i, 'period_end', e.target.value)}
                            />
                          </td>
                          <td className="border border-border-default px-1 py-1 bg-white">
                            <input
                              type="number"
                              min={0}
                              step={0.01}
                              placeholder="FTA filed amount"
                              className="w-full min-w-[7rem] text-sm border-2 border-slate-300 rounded px-2 py-1.5 bg-white text-text-primary focus:border-orange-primary focus:outline-none"
                              value={row.box_1a === 0 ? '' : row.box_1a}
                              onChange={(e) =>
                                handleFtaRowChange(i, 'box_1a', parseFloat(e.target.value) || 0)
                              }
                            />
                          </td>
                          <td className="border border-border-default px-1 py-1">
                            <input
                              type="number"
                              className="w-24 text-xs border rounded px-1"
                              value={row.box_1b}
                              onChange={(e) =>
                                handleFtaRowChange(i, 'box_1b', parseFloat(e.target.value) || 0)
                              }
                            />
                            {Math.abs(row.box_1b - row.box_1a * 0.05) > 1 && (
                              <p className="text-[10px] text-amber-700 mt-0.5">
                                Box 1b differs from 5% of Box 1a. Verify your FTA return.
                              </p>
                            )}
                          </td>
                          <td className="border border-border-default px-1 py-1">
                            <input
                              type="number"
                              className="w-24 text-xs border rounded px-1"
                              value={row.box_7}
                              onChange={(e) =>
                                handleFtaRowChange(i, 'box_7', parseFloat(e.target.value) || 0)
                              }
                            />
                          </td>
                          <td className="border border-border-default px-1 py-1 text-xs text-text-muted">
                            {(row.box_1b - row.box_7).toFixed(2)}
                          </td>
                          <td className="border border-border-default px-1 py-1">
                            <input
                              className="w-24 text-xs border rounded px-1"
                              value={row.fta_return_ref}
                              placeholder="FTA-REF"
                              onChange={(e) => handleFtaRowChange(i, 'fta_return_ref', e.target.value)}
                            />
                          </td>
                          <td className="border border-border-default px-1 py-1">
                            <input
                              type="date"
                              className="text-xs border rounded px-1"
                              value={row.filing_date}
                              onChange={(e) => handleFtaRowChange(i, 'filing_date', e.target.value)}
                            />
                          </td>
                          <td className="border border-border-default px-1 py-1">
                            <select
                              className="text-xs border rounded px-1"
                              value={row.status}
                              onChange={(e) =>
                                handleFtaRowChange(
                                  i,
                                  'status',
                                  e.target.value as FTAReturnRow['status']
                                )
                              }
                            >
                              <option value="draft">Draft</option>
                              <option value="filed">Filed</option>
                              <option value="amended">Amended</option>
                            </select>
                          </td>
                          <td className="border border-border-default px-1 py-1">
                            <button
                              type="button"
                              className="text-red-500 text-xs"
                              onClick={() => setFtaReturns((prev) => prev.filter((_, j) => j !== i))}
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button
                  type="button"
                  className="mt-2 text-sm text-orange-primary hover:underline"
                  onClick={handleAddFtaRow}
                >
                  + Add Quarter
                </button>
              </div>

              {localPreview && (
                <div
                  className={`rounded-lg p-4 border text-sm ${
                    localPreview.level === 'high'
                      ? 'bg-red-50 border-red-300 text-red-800'
                      : localPreview.level === 'medium'
                        ? 'bg-amber-50 border-amber-300 text-amber-900'
                        : 'bg-green-50 border-green-300 text-green-800'
                  }`}
                >
                  <p className="font-semibold">
                    {localPreview.level === 'high'
                      ? '⛔ VAT Reconciliation — HIGH RISK (preview)'
                      : localPreview.level === 'medium'
                        ? '⚠️ VAT Reconciliation — Medium Risk (preview)'
                        : '✓ VAT Reconciliation — Low Risk (preview)'}
                  </p>
                  <p className="mt-1">{localPreview.message}</p>
                </div>
              )}

              <div className="flex flex-wrap gap-3">
                <Button variant="primary" onClick={() => void handleRunVatReconciliation()} disabled={vatRecLoading}>
                  {vatRecLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      Reconciling IFRS 15 vs FTA data...
                    </>
                  ) : (
                    'Run Reconciliation'
                  )}
                </Button>
                {vatRecResult && (
                  <Button variant="secondary" onClick={() => void handleVatRecExcel()} disabled={vatRecLoading}>
                    <Download className="w-4 h-4 mr-2" />
                    Export Excel
                  </Button>
                )}
              </div>
            </>
          )}

          {vatRecError && (
            <div className="bg-red-50 border border-red-200 rounded p-3 text-red-700 text-sm">
              Error: {vatRecError}
            </div>
          )}

          {vatRecResult && (
            <div className="space-y-4">
              <div
                className={`rounded-lg p-4 border ${
                  risk === 'high'
                    ? 'bg-red-50 border-red-300 text-red-800'
                    : risk === 'medium'
                      ? 'bg-amber-50 border-amber-300 text-amber-900'
                      : 'bg-green-50 border-green-300 text-green-800'
                }`}
              >
                <p className="font-semibold text-sm">
                  {risk === 'high'
                    ? '⛔ VAT Reconciliation — HIGH RISK'
                    : risk === 'medium'
                      ? '⚠️ VAT Reconciliation — Medium Risk'
                      : '✓ VAT Reconciliation — Low Risk'}
                </p>
                <p className="text-sm mt-1">{String(vatRecResult.reconciliation_summary)}</p>
                {risk === 'high' && (
                  <p className="text-xs mt-1 font-medium">Consult UAE tax advisor immediately.</p>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b text-left text-text-muted text-xs">
                      <th className="py-2 pr-2">Quarter</th>
                      <th className="pr-2">IFRS 15 Revenue</th>
                      <th className="pr-2">IFRS 15 VAT</th>
                      <th className="pr-2">FTA Box 1a</th>
                      <th className="pr-2">FTA Box 1b</th>
                      <th className="pr-2">Difference</th>
                      <th className="pr-2">Status</th>
                      <th>Risk</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line, i) => {
                      const st = String(line.status);
                      const rowClass =
                        st === 'matched'
                          ? 'bg-green-50'
                          : st === 'timing_diff'
                            ? 'bg-amber-50'
                            : st === 'unexplained'
                              ? 'bg-red-50'
                              : 'bg-slate-50 italic';
                      const badge =
                        st === 'matched'
                          ? '✓ Matched'
                          : st === 'timing_diff'
                            ? '⏱ Timing Diff'
                            : st === 'unexplained'
                              ? '⚠️ Unexplained'
                              : '— Awaiting Data';
                      const revDiff = Number(line.revenue_difference) || 0;
                      return (
                        <tr key={i} className={`border-b ${rowClass}`}>
                          <td className="py-2 font-medium">{String(line.quarter)}</td>
                          <td>{fmt(Number(line.ifrs15_revenue_recognised))}</td>
                          <td>{fmt(Number(line.ifrs15_vat_amount))}</td>
                          <td>{fmt(Number(line.fta_taxable_supply))}</td>
                          <td>{fmt(Number(line.fta_vat_collected))}</td>
                          <td
                            className={
                              revDiff < 0
                                ? 'text-red-600 font-medium'
                                : revDiff > 0
                                  ? 'text-amber-700'
                                  : 'text-green-700'
                            }
                          >
                            {revDiff > 0 ? '+' : ''}
                            {fmt(revDiff)}
                          </td>
                          <td>{badge}</td>
                          <td>{line.risk_flag ? '⚠️ Yes' : 'No'}</td>
                        </tr>
                      );
                    })}
                    <tr className="bg-bg-light font-bold border-t-2">
                      <td className="py-2">TOTAL</td>
                      <td>{fmt(Number(vatRecResult.total_ifrs15_revenue))}</td>
                      <td>{fmt(Number(vatRecResult.total_ifrs15_vat))}</td>
                      <td>{fmt(Number(vatRecResult.total_fta_taxable_supply))}</td>
                      <td>{fmt(Number(vatRecResult.total_fta_vat_collected))}</td>
                      <td>{fmt(Number(vatRecResult.total_revenue_difference))}</td>
                      <td colSpan={2} />
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
