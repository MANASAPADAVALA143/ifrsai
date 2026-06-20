'use client';

import { useMemo, useState } from 'react';
import { SidebarLayout } from '@/components/SidebarLayout';
import { Button } from '@/components/Button';
import { consolidationApi } from '@/lib/api';
import {
  getLeaseRepository,
  refreshLeaseRepositoryFromServer,
  type LeaseRepositoryEntry,
} from '@/lib/lease-repository';
import { getCurrentFirmCurrency } from '@/lib/firm-workspace';
import { isPortfolioAggregateLease } from '@/lib/ifrs16-portfolio';
import { formatLeaseMoney } from '@/lib/ifrs16-currency';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from '@/components/Charts';
import toast from 'react-hot-toast';

type LeaseInput = {
  rou_asset: number;
  lease_liability: number;
  lease_term_years: number;
  interest_expense_year1: number;
  lease_id?: string;
  is_intercompany?: boolean;
  intercompany_with?: string;
};

type EntityInput = {
  entity_name: string;
  entity_currency: string;
  fx_rate_to_group: number;
  leases: LeaseInput[];
  manual: LeaseInput;
};

const COLORS = ['#f97316', '#fb923c', '#f59e0b', '#ef4444', '#22c55e', '#3b82f6'];

function defaultEntityCurrency(): string {
  if (typeof window === 'undefined') return 'AED';
  return getCurrentFirmCurrency();
}

function blankEntity(): EntityInput {
  const ccy = defaultEntityCurrency();
  return {
    entity_name: '',
    entity_currency: ccy,
    fx_rate_to_group: ccy === 'AED' ? 1 : 1,
    leases: [],
    manual: { rou_asset: 0, lease_liability: 0, lease_term_years: 5, interest_expense_year1: 0 },
  };
}

function isActiveLease(l: LeaseRepositoryEntry): boolean {
  const st = String(l.status || l.lease_status || '').toLowerCase();
  if (st === 'active' || st === 'calculated') return true;
  if (!st) {
    const ll = Number(l.liability ?? (l.results as { lease_liability?: number })?.lease_liability ?? 0);
    return ll > 0;
  }
  return false;
}

function year1Interest(l: LeaseRepositoryEntry): number {
  const y1 = (l.results as { year_1_impact?: { interest_expense?: number } })?.year_1_impact
    ?.interest_expense;
  if (Number(y1) > 0) return Number(y1);
  const sched = (l.results as { amortization_schedule?: Record<string, unknown>[] })
    ?.amortization_schedule;
  if (Array.isArray(sched)) {
    return sched.slice(0, 12).reduce((sum, row) => {
      const interest = Number(row.Interest ?? row.interest ?? 0);
      return sum + (Number.isFinite(interest) ? interest : 0);
    }, 0);
  }
  return 0;
}

function mapLeaseToInput(l: LeaseRepositoryEntry): LeaseInput {
  const res = (l.results || {}) as Record<string, unknown>;
  const termMonths = Number(l.dates?.term_months ?? 0);
  return {
    rou_asset: Number(l.rou ?? res.rou_asset ?? 0),
    lease_liability: Number(l.liability ?? res.lease_liability ?? 0),
    lease_term_years: Math.max(1, Math.round((termMonths > 0 ? termMonths : 12) / 12 * 10) / 10),
    interest_expense_year1: year1Interest(l),
    lease_id: l.lease_id || l.id,
  };
}

export default function ConsolidationPage() {
  const [groupCurrency, setGroupCurrency] = useState(() => defaultEntityCurrency());
  const [entities, setEntities] = useState<EntityInput[]>([blankEntity()]);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [importingIdx, setImportingIdx] = useState<number | null>(null);

  const formatGroupMoney = (amount: number) => formatLeaseMoney(amount, groupCurrency);

  const addEntity = () => setEntities((p) => [...p, blankEntity()]);
  const removeEntity = (idx: number) => setEntities((p) => p.filter((_, i) => i !== idx));

  const updateEntity = (idx: number, patch: Partial<EntityInput>) =>
    setEntities((p) => p.map((e, i) => (i === idx ? { ...e, ...patch } : e)));

  const updateLease = (entityIdx: number, leaseIdx: number, patch: Partial<LeaseInput>) =>
    setEntities((p) =>
      p.map((e, i) =>
        i === entityIdx
          ? {
              ...e,
              leases: e.leases.map((lease, j) => (j === leaseIdx ? { ...lease, ...patch } : lease)),
            }
          : e
      )
    );

  const addManualLease = (idx: number) =>
    setEntities((p) =>
      p.map((e, i) =>
        i === idx
          ? {
              ...e,
              leases: [
                ...e.leases,
                {
                  lease_id: crypto.randomUUID(),
                  rou_asset: Number(e.manual.rou_asset || 0),
                  lease_liability: Number(e.manual.lease_liability || 0),
                  lease_term_years: Number(e.manual.lease_term_years || 1),
                  interest_expense_year1: Number(e.manual.interest_expense_year1 || 0),
                },
              ],
            }
          : e
      )
    );

  const loadFromSavedLeases = async (idx: number) => {
    setImportingIdx(idx);
    try {
      let repo = await refreshLeaseRepositoryFromServer();
      if (repo.length === 0) repo = getLeaseRepository();

      const active = repo
        .filter(isActiveLease)
        .filter((l) => !isPortfolioAggregateLease(l))
        .filter((l) => {
          const mapped = mapLeaseToInput(l);
          return mapped.lease_liability > 0 || mapped.rou_asset > 0;
        });

      if (active.length === 0) {
        toast.error('No active leases found. Save leases in IFRS 16 first.');
        return;
      }

      const mapped = active.map(mapLeaseToInput);
      const dominant = active[0]?.currency || active[0]?.payments?.currency || getCurrentFirmCurrency();
      updateEntity(idx, {
        leases: mapped,
        entity_currency: String(dominant).toUpperCase(),
        fx_rate_to_group: String(dominant).toUpperCase() === groupCurrency ? 1 : undefined,
      });
      toast.success(`Loaded ${mapped.length} lease(s) from repository`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load leases');
    } finally {
      setImportingIdx(null);
    }
  };

  const runConsolidation = async () => {
    const payload = {
      group_currency: groupCurrency,
      entities: entities
        .filter((e) => e.entity_name.trim())
        .map((e) => ({
          entity_name: e.entity_name,
          entity_currency: e.entity_currency,
          fx_rate_to_group: Number(e.fx_rate_to_group || 1),
          leases: e.leases.map((lease) => ({
            rou_asset: lease.rou_asset,
            lease_liability: lease.lease_liability,
            lease_term_years: lease.lease_term_years,
            interest_expense_year1: lease.interest_expense_year1,
            ...(lease.lease_id ? { lease_id: lease.lease_id } : {}),
            ...(lease.is_intercompany ? { is_intercompany: true } : {}),
            ...(lease.intercompany_with ? { intercompany_with: lease.intercompany_with } : {}),
          })),
        })),
    };
    if (!payload.entities.length) {
      toast.error('Add at least one entity');
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await consolidationApi.runIfrs16(payload);
      if (error || !data) {
        toast.error(error || 'Consolidation failed');
        return;
      }
      setResult(data);
      toast.success('Consolidation complete');
    } finally {
      setLoading(false);
    }
  };

  const pieData = useMemo(
    () =>
      (result?.entities || []).map((e: any) => ({
        name: e.entity_name,
        value: Number(e.rou_asset_group_ccy || 0),
      })),
    [result]
  );

  return (
    <SidebarLayout
      pageTitle="IFRS 16 - Group Consolidation"
      pageSubtitle="Consolidate lease portfolios across multiple entities"
    >
      <div className="space-y-6">
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
          <strong>How to use:</strong> Add each entity below → Load their saved leases → Click Consolidate to see
          group totals.
        </div>
        <div className="flex flex-wrap gap-2">
          <Button className="bg-[#f97316] text-white" onClick={addEntity}>+ Add Entity</Button>
          <Button className="bg-blue-600 text-white" onClick={runConsolidation} disabled={loading}>
            {loading ? 'Calculating...' : 'Consolidate'}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              if (!result) return;
              const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'ifrs16_consolidation.json';
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            Download
          </Button>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[#64748b]">Group reporting currency</label>
            <select value={groupCurrency} onChange={(e) => setGroupCurrency(e.target.value)} className="px-3 py-2 rounded border border-[#e2e8f0] bg-white">
              {['AED', 'USD', 'EUR', 'GBP', 'INR', 'SGD', 'Other'].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-4">
          {entities.map((entity, idx) => (
            <div key={idx} className="bg-white rounded-[14px] p-4 border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-[#64748b]">Entity Name</label>
                  <input className="px-3 py-2 rounded border border-[#e2e8f0]" placeholder="Entity Name" value={entity.entity_name} onChange={(e) => updateEntity(idx, { entity_name: e.target.value })} />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-[#64748b]">Currency</label>
                  <select className="px-3 py-2 rounded border border-[#e2e8f0]" value={entity.entity_currency} onChange={(e) => updateEntity(idx, { entity_currency: e.target.value })}>
                    {['AED', 'USD', 'EUR', 'GBP', 'INR', 'SGD', 'Other'].map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-[#64748b]">FX Rate to Group Currency</label>
                  <input type="number" step="0.0001" className="px-3 py-2 rounded border border-[#e2e8f0]" placeholder="1.0" value={entity.fx_rate_to_group} onChange={(e) => updateEntity(idx, { fx_rate_to_group: Number(e.target.value) || 1 })} />
                </div>
                <div className="flex flex-col gap-1 justify-end">
                  <span className="text-xs font-medium text-transparent select-none">.</span>
                  <Button variant="secondary" onClick={() => removeEntity(idx)}>Remove</Button>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  onClick={() => void loadFromSavedLeases(idx)}
                  disabled={importingIdx === idx}
                >
                  {importingIdx === idx ? 'Loading…' : 'Load from saved leases'}
                </Button>
              </div>

              <div className="mt-3 grid grid-cols-1 md:grid-cols-5 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-[#64748b]">Lease Liability</label>
                  <input type="number" className="px-3 py-2 rounded border border-[#e2e8f0]" value={entity.manual.lease_liability} onChange={(e) => updateEntity(idx, { manual: { ...entity.manual, lease_liability: Number(e.target.value) || 0 } })} />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-[#64748b]">ROU Asset</label>
                  <input type="number" className="px-3 py-2 rounded border border-[#e2e8f0]" value={entity.manual.rou_asset} onChange={(e) => updateEntity(idx, { manual: { ...entity.manual, rou_asset: Number(e.target.value) || 0 } })} />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-[#64748b]">Lease term (years)</label>
                  <input type="number" className="px-3 py-2 rounded border border-[#e2e8f0]" value={entity.manual.lease_term_years} onChange={(e) => updateEntity(idx, { manual: { ...entity.manual, lease_term_years: Number(e.target.value) || 1 } })} />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-[#64748b]">Year 1 interest expense</label>
                  <input type="number" className="px-3 py-2 rounded border border-[#e2e8f0]" value={entity.manual.interest_expense_year1} onChange={(e) => updateEntity(idx, { manual: { ...entity.manual, interest_expense_year1: Number(e.target.value) || 0 } })} />
                </div>
                <div className="flex flex-col gap-1 justify-end">
                  <span className="text-xs font-medium text-transparent select-none">.</span>
                  <Button className="bg-[#f97316] text-white" onClick={() => addManualLease(idx)}>Add Lease</Button>
                </div>
              </div>
              <p className="mt-3 text-xs text-[#64748b]">
                Tip: Save leases in IFRS 16, then click &apos;Load from saved leases&apos; to import automatically.
              </p>

              {entity.leases.length > 0 && (
                <div className="mt-4 space-y-3">
                  <p className="text-sm font-medium text-[#334155]">Leases ({entity.leases.length})</p>
                  {entity.leases.map((lease, leaseIdx) => {
                    const counterpartyOptions = entities
                      .filter((e, i) => i !== idx && e.entity_name.trim())
                      .map((e) => e.entity_name);
                    return (
                      <div
                        key={lease.lease_id || leaseIdx}
                        className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-3 text-sm"
                      >
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[#64748b]">
                          <span>ROU: {formatLeaseMoney(lease.rou_asset, entity.entity_currency)}</span>
                          <span>Liability: {formatLeaseMoney(lease.lease_liability, entity.entity_currency)}</span>
                          <span>Term: {lease.lease_term_years} yr</span>
                          {lease.lease_id && <span className="text-xs">ID: {lease.lease_id}</span>}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-3">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={Boolean(lease.is_intercompany)}
                              onChange={(e) =>
                                updateLease(idx, leaseIdx, {
                                  is_intercompany: e.target.checked,
                                  intercompany_with: e.target.checked
                                    ? lease.intercompany_with || counterpartyOptions[0] || ''
                                    : undefined,
                                })
                              }
                            />
                            <span className="text-xs font-medium text-[#64748b]">Intercompany?</span>
                          </label>
                          {lease.is_intercompany && (
                            <div className="flex flex-col gap-1">
                              <label className="text-xs font-medium text-[#64748b]">Lessor is which entity?</label>
                              <select
                                className="px-2 py-1 rounded border border-[#e2e8f0] bg-white text-sm"
                                value={lease.intercompany_with || ''}
                                onChange={(e) =>
                                  updateLease(idx, leaseIdx, { intercompany_with: e.target.value })
                                }
                              >
                                <option value="">Select lessor entity…</option>
                                {counterpartyOptions.map((name) => (
                                  <option key={name} value={name}>
                                    {name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}
                        </div>
                        {lease.is_intercompany && (
                          <p className="mt-2 text-xs text-[#64748b]">
                            Mark this lease as intercompany if {entity.entity_name || 'this entity'} is leasing from
                            another entity in this same group. It will be excluded from group totals.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>

        {result && (
          <div className="space-y-6">
            <div className="bg-white rounded-[14px] p-5 border border-[#e2e8f0]">
              <h4 className="font-semibold mb-3">Entity Breakdown</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#e2e8f0]">
                      <th className="text-left py-2">Entity</th>
                      <th className="text-left py-2">Currency</th>
                      <th className="text-right py-2">FX Rate</th>
                      <th className="text-right py-2">ROU Asset (local)</th>
                      <th className="text-right py-2">ROU Asset (group CCY)</th>
                      <th className="text-right py-2">Lease Liability</th>
                      <th className="text-right py-2">FX Adj</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(result.entities || []).map((e: any) => (
                      <tr key={e.entity_name} className="border-b border-[#e2e8f0]">
                        <td className="py-2">{e.entity_name}</td>
                        <td className="py-2">{e.currency}</td>
                        <td className="py-2 text-right">{e.fx_rate}</td>
                        <td className="py-2 text-right">{formatGroupMoney(Number(e.rou_asset || 0))}</td>
                        <td className="py-2 text-right">{formatGroupMoney(Number(e.rou_asset_group_ccy || 0))}</td>
                        <td className="py-2 text-right">{formatGroupMoney(Number((e.lease_liability_current || 0) + (e.lease_liability_non_current || 0)))}</td>
                        <td className="py-2 text-right">{formatGroupMoney(Number(e.fx_translation_adjustment || 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white rounded-[14px] p-5 border border-[#e2e8f0]">
              <h4 className="font-semibold mb-3">Group Totals ({result.group_currency || groupCurrency})</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                <div>Total ROU Assets: <strong>{formatGroupMoney(Number(result.group_totals?.rou_asset || 0))}</strong></div>
                <div>Lease Liabilities (Current): <strong>{formatGroupMoney(Number(result.group_totals?.lease_liability_current || 0))}</strong></div>
                <div>Lease Liabilities (Non-Current): <strong>{formatGroupMoney(Number(result.group_totals?.lease_liability_non_current || 0))}</strong></div>
                <div>Total Depreciation: <strong>{formatGroupMoney(Number(result.group_totals?.depreciation_expense || 0))}</strong></div>
                <div>Total Interest: <strong>{formatGroupMoney(Number(result.group_totals?.interest_expense || 0))}</strong></div>
                <div>FX Translation Reserve: <strong>{formatGroupMoney(Number(result.group_totals?.fx_translation_adjustment || 0))}</strong></div>
              </div>
            </div>

            {Number(result.intercompany_eliminated_count || 0) > 0 && (
              <div className="bg-white rounded-[14px] p-5 border border-[#e2e8f0]">
                <h4 className="font-semibold mb-1">Intercompany Eliminations</h4>
                <p className="text-sm text-[#64748b] mb-3">
                  Intercompany eliminations: {result.intercompany_eliminated_count} lease(s) excluded from group totals
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#e2e8f0]">
                        <th className="text-left py-2">Lessee</th>
                        <th className="text-left py-2">Lessor</th>
                        <th className="text-right py-2">ROU Asset Excluded</th>
                        <th className="text-right py-2">Lease Liability Excluded</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(result.intercompany_eliminations || []).map((row: any, i: number) => (
                        <tr key={row.lease_id || i} className="border-b border-[#e2e8f0]">
                          <td className="py-2">{row.lessee_entity}</td>
                          <td className="py-2">{row.lessor_entity}</td>
                          <td className="py-2 text-right">{formatGroupMoney(Number(row.rou_asset || 0))}</td>
                          <td className="py-2 text-right">{formatGroupMoney(Number(row.lease_liability || 0))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="bg-white rounded-[14px] p-5 border border-[#e2e8f0]">
              <h4 className="font-semibold mb-3">Consolidation Journal Entries</h4>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#e2e8f0]">
                    <th className="text-left py-2">Description</th>
                    <th className="text-left py-2">Debit</th>
                    <th className="text-left py-2">Credit</th>
                    <th className="text-right py-2">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(result.consolidation_journal || []).map((j: any, i: number) => (
                    <tr key={i} className="border-b border-[#e2e8f0]">
                      <td className="py-2">{j.description}</td>
                      <td className="py-2">{j.debit}</td>
                      <td className="py-2">{j.credit}</td>
                      <td className="py-2 text-right">{formatGroupMoney(Number(j.amount || 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="bg-white rounded-[14px] p-5 border border-[#e2e8f0]">
              <h4 className="font-semibold mb-3">ROU Assets by Entity</h4>
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90}>
                    {pieData.map((_: any, i: number) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
    </SidebarLayout>
  );
}
