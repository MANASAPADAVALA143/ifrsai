'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/Button';
import { ifrs15Api } from '@/lib/api';
import { formatRealEstateMoney, type DisplayCurrency } from '@/lib/realestate-format';
import toast from 'react-hot-toast';
import { ChevronDown, ChevronRight, Download, Loader2 } from 'lucide-react';

const RERA_THRESHOLDS = [
  { key: 'rera_30pct', label: '30%' },
  { key: 'rera_50pct', label: '50%' },
  { key: 'rera_60pct', label: '60%' },
  { key: 'rera_80pct', label: '80%' },
  { key: 'rera_100pct', label: '100%' },
] as const;

type MilestoneRow = Record<string, unknown>;
type TrackerReport = Record<string, unknown>;

type Props = {
  reraNumber: string;
  projectName: string;
  contractPrice: number;
  completionPct: number;
  constructionStart: string;
  expectedHandover: string;
  currency: DisplayCurrency;
  initialReport?: TrackerReport | null;
  onSummaryChange?: (summary: { overdue: number; dueSoon: number }) => void;
};

function completionsStorageKey(rera: string) {
  return `deadline_completions_${rera.trim()}`;
}

function formatDisplayDate(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso.slice(0, 10));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function statusIcon(status: string) {
  if (status === 'overdue') return '🔴';
  if (status === 'due_soon') return '🟡';
  if (status === 'completed') return '🟢';
  return '⚪';
}

function statusRowClass(status: string) {
  if (status === 'overdue') return 'bg-red-50 border-red-200';
  if (status === 'due_soon') return 'bg-amber-50 border-amber-200';
  if (status === 'completed') return 'bg-green-50 border-green-200 opacity-80';
  if (status === 'no_fta_data' || status === 'not_triggered') return 'bg-slate-50 border-slate-200 italic';
  return 'bg-white border-border-default';
}

function priorityBadge(priority: string) {
  const map: Record<string, string> = {
    critical: 'bg-red-600 text-white',
    high: 'bg-amber-500 text-white',
    medium: 'bg-blue-600 text-white',
    low: 'bg-slate-400 text-white',
  };
  return map[priority] || map.medium;
}

function statusBadge(status: string) {
  const labels: Record<string, string> = {
    overdue: 'Overdue',
    due_soon: 'Due Soon',
    completed: 'Completed',
    not_triggered: 'Not triggered',
    upcoming: 'Upcoming',
  };
  return labels[status] || status;
}

export function RERADeadlineTracker({
  reraNumber,
  projectName,
  contractPrice,
  completionPct,
  constructionStart,
  expectedHandover,
  currency,
  initialReport,
  onSummaryChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [completionRate, setCompletionRate] = useState(3.5);
  const [projectStart, setProjectStart] = useState(constructionStart);
  const [expectedEnd, setExpectedEnd] = useState(expectedHandover);
  const [completionsOpen, setCompletionsOpen] = useState(false);
  const [completions, setCompletions] = useState<Record<string, string>>({});
  const [report, setReport] = useState<TrackerReport | null>(initialReport || null);
  const [loading, setLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'overdue' | 'due_soon' | 'upcoming' | 'completed'>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [completeModal, setCompleteModal] = useState<MilestoneRow | null>(null);
  const [completeDate, setCompleteDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [completeBy, setCompleteBy] = useState('');
  const [completeNotes, setCompleteNotes] = useState('');

  const fmt = (n: number) => formatRealEstateMoney(n, currency);

  useEffect(() => {
    setProjectStart(constructionStart);
    setExpectedEnd(expectedHandover);
  }, [constructionStart, expectedHandover]);

  useEffect(() => {
    if (initialReport) setReport(initialReport);
  }, [initialReport]);

  useEffect(() => {
    if (!reraNumber.trim()) return;
    try {
      const raw = localStorage.getItem(completionsStorageKey(reraNumber));
      if (raw) setCompletions(JSON.parse(raw) as Record<string, string>);
    } catch {
      setCompletions({});
    }
  }, [reraNumber]);

  const persistCompletions = useCallback(
    (next: Record<string, string>) => {
      setCompletions(next);
      if (reraNumber.trim()) {
        localStorage.setItem(completionsStorageKey(reraNumber), JSON.stringify(next));
      }
    },
    [reraNumber]
  );

  const trackerPayload = useCallback(
    () => ({
      rera_registration_number: reraNumber.trim(),
      project_name: projectName.trim(),
      contract_price_aed: contractPrice,
      current_completion_pct: completionPct,
      completion_rate_per_month: completionRate,
      project_start_date: projectStart,
      expected_completion_date: expectedEnd,
      existing_completions: completions,
      currency,
    }),
    [
      reraNumber,
      projectName,
      contractPrice,
      completionPct,
      completionRate,
      projectStart,
      expectedEnd,
      completions,
      currency,
    ]
  );

  const runTracker = async () => {
    if (!reraNumber.trim()) {
      toast.error('Enter RERA registration number first');
      return;
    }
    setLoading(true);
    const { data, error } = await ifrs15Api.realestateDeadlineTracker(trackerPayload());
    setLoading(false);
    if (error) {
      toast.error(error);
      return;
    }
    const rep = (data?.report as TrackerReport) || null;
    setReport(rep);
    toast.success('Deadline tracker updated');
  };

  useEffect(() => {
    if (!report) return;
    onSummaryChange?.({
      overdue: Number(report.overdue_count) || 0,
      dueSoon: Number(report.due_soon_count) || 0,
    });
  }, [report, onSummaryChange]);

  const milestones = useMemo(
    () => (report?.milestones as MilestoneRow[]) || [],
    [report]
  );

  const filtered = useMemo(() => {
    let rows = milestones.slice();
    if (filter === 'overdue') rows = rows.filter((m) => m.status === 'overdue');
    else if (filter === 'due_soon') rows = rows.filter((m) => m.status === 'due_soon');
    else if (filter === 'upcoming')
      rows = rows.filter((m) => m.status === 'upcoming' || m.status === 'not_triggered');
    else if (filter === 'completed') rows = rows.filter((m) => m.status === 'completed');
    else rows = rows.filter((m) => m.status !== 'completed');
    const sortKey = (m: MilestoneRow) =>
      String(m.due_date || m.projected_date || '9999-12-31');
    rows.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    return rows;
  }, [milestones, filter]);

  const nextMilestone = report?.next_milestone as MilestoneRow | undefined;
  const criticalAlerts = (report?.critical_alerts as string[]) || [];

  const exportExcel = async () => {
    if (!report) {
      toast.error('Run deadline tracker first');
      return;
    }
    setExportLoading(true);
    const { blob, filename, error } = await ifrs15Api.realestateDeadlineTrackerExport(trackerPayload());
    setExportLoading(false);
    if (error || !blob) {
      toast.error(error || 'Export failed');
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'RERA_Deadlines.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  };

  const saveComplete = async () => {
    if (!completeModal) return;
    setLoading(true);
    const { data, error } = await ifrs15Api.realestateDeadlineTrackerComplete({
      ...trackerPayload(),
      milestone_type: String(completeModal.milestone_type),
      completed_date: completeDate,
      completed_by: completeBy,
      notes: completeNotes,
    });
    setLoading(false);
    if (error) {
      toast.error(error);
      return;
    }
    const merged = (data?.deadline_completions as Record<string, string>) || completions;
    persistCompletions(merged);
    setReport((data?.report as TrackerReport) || report);
    setCompleteModal(null);
    toast.success('Milestone marked complete');
  };

  const toggleCompletion = (key: string, done: boolean, date: string) => {
    const next = { ...completions };
    if (done) next[key] = date;
    else delete next[key];
    persistCompletions(next);
  };

  return (
    <section
      id="rera-deadline-tracker"
      className="bg-white border border-border-default rounded-lg p-6"
    >
      <button
        type="button"
        className="w-full flex items-center justify-between text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <div>
          <h2 className="text-lg font-semibold">RERA Deadline Tracker</h2>
          <p className="text-xs text-text-muted mt-1">
            Track RERA milestones, FTA VAT deadlines, and IFRS 15 quarter-end obligations. UAE Law No. 8 of
            2007.
          </p>
        </div>
        {open ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
      </button>

      {open && (
        <div className="mt-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="text-sm">
              <span className="text-text-muted block mb-1">Completion rate (% per month)</span>
              <input
                type="number"
                step={0.5}
                min={0}
                className="w-full border rounded px-3 py-2"
                value={completionRate}
                onChange={(e) => setCompletionRate(parseFloat(e.target.value) || 0)}
              />
              <span className="text-[11px] text-text-muted">Average monthly construction progress %</span>
            </label>
            <label className="text-sm">
              <span className="text-text-muted block mb-1">Project start date</span>
              <input
                type="date"
                className="w-full border rounded px-3 py-2"
                value={projectStart}
                onChange={(e) => setProjectStart(e.target.value)}
              />
            </label>
            <label className="text-sm md:col-span-2">
              <span className="text-text-muted block mb-1">Expected completion date</span>
              <input
                type="date"
                className="w-full border rounded px-3 py-2 max-w-md"
                value={expectedEnd}
                onChange={(e) => setExpectedEnd(e.target.value)}
              />
            </label>
          </div>

          <div>
            <button
              type="button"
              className="text-sm font-medium text-orange-primary flex items-center gap-1"
              onClick={() => setCompletionsOpen((o) => !o)}
            >
              {completionsOpen ? '▼' : '▶'} Existing completions (RERA thresholds)
            </button>
            {completionsOpen && (
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {RERA_THRESHOLDS.map(({ key, label }) => {
                  const done = Boolean(completions[key]);
                  return (
                    <div key={key} className="border rounded p-3 text-sm">
                      <label className="flex items-center gap-2 font-medium">
                        <input
                          type="checkbox"
                          checked={done}
                          onChange={(e) =>
                            toggleCompletion(
                              key,
                              e.target.checked,
                              completions[key] || new Date().toISOString().slice(0, 10)
                            )
                          }
                        />
                        {label} complete
                      </label>
                      {done && (
                        <input
                          type="date"
                          className="mt-2 w-full border rounded px-2 py-1 text-xs"
                          value={completions[key] || ''}
                          onChange={(e) => toggleCompletion(key, true, e.target.value)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <Button variant="primary" onClick={() => void runTracker()} disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2 inline" />
                Calculating milestones...
              </>
            ) : (
              'Run Deadline Tracker'
            )}
          </Button>

          {report && (
            <>
              {criticalAlerts.length > 0 && (
                <div
                  className="border-2 border-red-500 bg-red-50 rounded-lg p-4"
                  role="alert"
                >
                  <p className="font-bold text-red-800 mb-2">
                    ⛔ {criticalAlerts.length} Critical Alert(s) Requiring Immediate Action
                  </p>
                  <ul className="list-disc pl-5 text-sm text-red-900 space-y-1">
                    {criticalAlerts.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </div>
              )}

              {nextMilestone && (
                <div className="border-2 border-orange-200 bg-orange-50 rounded-lg p-4">
                  <p className="text-xs uppercase text-text-muted">Next milestone</p>
                  <p className="font-bold text-lg">{String(nextMilestone.title)}</p>
                  <p className="text-sm text-text-secondary mt-1">
                    {nextMilestone.days_until_due != null
                      ? `${nextMilestone.days_until_due} days — ${formatDisplayDate(
                          String(nextMilestone.due_date || nextMilestone.projected_date)
                        )}`
                      : formatDisplayDate(
                          String(nextMilestone.due_date || nextMilestone.projected_date)
                        )}
                  </p>
                  <p className="text-sm mt-2">
                    {String(nextMilestone.action_required || '').split('\n')[0]}
                  </p>
                  {nextMilestone.threshold_pct != null && (
                    <div className="mt-3">
                      <div className="h-2 bg-white rounded overflow-hidden border">
                        <div
                          className="h-full bg-orange-primary"
                          style={{
                            width: `${Math.min(100, completionPct)}%`,
                          }}
                        />
                      </div>
                      <p className="text-[11px] text-text-muted mt-1">
                        Current {completionPct}% → threshold {String(nextMilestone.threshold_pct)}%
                      </p>
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {(['all', 'overdue', 'due_soon', 'upcoming', 'completed'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFilter(f)}
                    className={`px-3 py-1 rounded text-xs border ${
                      filter === f ? 'bg-slate-700 text-white' : 'bg-white'
                    }`}
                  >
                    {f === 'all'
                      ? 'All (excl. done)'
                      : f === 'due_soon'
                        ? 'Due Soon'
                        : f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                ))}
              </div>

              <div className="space-y-3">
                {filtered.map((m) => {
                  const id = String(m.milestone_id);
                  const st = String(m.status);
                  const isExpanded = expanded.has(id);
                  const isOverdue = st === 'overdue';
                  return (
                    <div
                      key={id}
                      className={`border rounded-lg p-4 ${statusRowClass(st)} ${
                        st === 'completed' ? 'line-through decoration-slate-400' : ''
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="flex items-start gap-2 flex-1 min-w-0">
                          <span
                            className={isOverdue ? 'animate-pulse' : ''}
                            aria-hidden
                          >
                            {statusIcon(st)}
                          </span>
                          <div className={st === 'completed' ? 'line-through' : ''}>
                            <p className="font-semibold text-sm">{String(m.title)}</p>
                            <p className="text-xs text-text-muted mt-0.5">
                              Due:{' '}
                              {formatDisplayDate(
                                String(m.due_date || m.projected_date || '')
                              )}
                              {m.days_until_due != null && (
                                <span> ({String(m.days_until_due)} days)</span>
                              )}
                            </p>
                            {m.threshold_pct != null && (
                              <p className="text-xs">
                                Threshold: {String(m.threshold_pct)}% | Escrow:{' '}
                                {fmt(Number(m.escrow_release_amount_aed) || 0)}
                              </p>
                            )}
                            <p className="text-xs text-text-secondary mt-1 line-clamp-1">
                              {String(m.description)}
                            </p>
                          </div>
                        </div>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${priorityBadge(
                            String(m.priority)
                          )}`}
                        >
                          {String(m.priority).toUpperCase()}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="text-xs text-orange-primary"
                          onClick={() => {
                            setExpanded((prev) => {
                              const n = new Set(prev);
                              if (n.has(id)) n.delete(id);
                              else n.add(id);
                              return n;
                            });
                          }}
                        >
                          {isExpanded ? '▲ Hide actions' : '▼ Show actions'}
                        </button>
                        {st !== 'completed' && (
                          <button
                            type="button"
                            className="text-xs text-green-700 font-medium"
                            onClick={() => {
                              setCompleteModal(m);
                              setCompleteDate(new Date().toISOString().slice(0, 10));
                            }}
                          >
                            ✓ Mark complete
                          </button>
                        )}
                      </div>
                      {isExpanded && (
                        <ol className="mt-3 list-decimal pl-5 text-xs space-y-1 text-text-secondary">
                          {String(m.action_required || '')
                            .split('\n')
                            .filter(Boolean)
                            .map((line, i) => (
                              <li key={i}>{line.replace(/^\d+\.\s*/, '')}</li>
                            ))}
                        </ol>
                      )}
                      <p className="text-[10px] text-text-muted mt-2 italic">{String(m.law_reference)}</p>
                    </div>
                  );
                })}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-left text-text-muted">
                      <th className="py-2">Milestone</th>
                      <th>Status</th>
                      <th>Due</th>
                      <th>Days</th>
                      <th>Escrow</th>
                    </tr>
                  </thead>
                  <tbody>
                    {milestones.map((m) => (
                      <tr key={String(m.milestone_id)} className="border-b">
                        <td className="py-2 max-w-[200px] truncate">{String(m.title)}</td>
                        <td>{statusBadge(String(m.status))}</td>
                        <td>
                          {formatDisplayDate(String(m.due_date || m.projected_date || ''))}
                        </td>
                        <td>{m.days_until_due != null ? String(m.days_until_due) : '—'}</td>
                        <td>
                          {m.escrow_release_amount_aed
                            ? fmt(Number(m.escrow_release_amount_aed))
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <Button variant="secondary" onClick={() => void exportExcel()} disabled={exportLoading}>
                {exportLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <Download className="w-4 h-4 mr-2" />
                )}
                Export Excel
              </Button>
            </>
          )}
        </div>
      )}

      {completeModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="deadline-complete-title"
        >
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 id="deadline-complete-title" className="font-semibold text-lg mb-4">
              Mark milestone complete
            </h3>
            <p className="text-sm text-text-muted mb-4">{String(completeModal.title)}</p>
            <label className="text-sm block mb-3">
              <span className="text-text-muted">Completed date</span>
              <input
                type="date"
                className="w-full border rounded px-3 py-2 mt-1"
                value={completeDate}
                onChange={(e) => setCompleteDate(e.target.value)}
              />
            </label>
            <label className="text-sm block mb-3">
              <span className="text-text-muted">Completed by</span>
              <input
                className="w-full border rounded px-3 py-2 mt-1"
                value={completeBy}
                onChange={(e) => setCompleteBy(e.target.value)}
              />
            </label>
            <label className="text-sm block mb-4">
              <span className="text-text-muted">Notes (optional)</span>
              <textarea
                className="w-full border rounded px-3 py-2 mt-1 text-sm"
                rows={3}
                value={completeNotes}
                onChange={(e) => setCompleteNotes(e.target.value)}
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setCompleteModal(null)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => void saveComplete()} disabled={loading}>
                Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
