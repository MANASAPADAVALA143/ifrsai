'use client';

import { useMemo, useState } from 'react';
import { SidebarLayout } from '@/components/SidebarLayout';
import { Button } from '@/components/Button';
import { consolidationApi } from '@/lib/api';
import { getLeaseRepository } from '@/lib/lease-repository';
import { formatIndianCurrency } from '@/lib/utils';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from '@/components/Charts';
import toast from 'react-hot-toast';

type LeaseInput = {
  rou_asset: number;
  lease_liability: number;
  lease_term_years: number;
  interest_expense_year1: number;
};

type EntityInput = {
  entity_name: string;
  entity_currency: string;
  fx_rate_to_group: number;
  leases: LeaseInput[];
  manual: LeaseInput;
};

const COLORS = ['#f97316', '#fb923c', '#f59e0b', '#ef4444', '#22c55e', '#3b82f6'];

function blankEntity(): EntityInput {
  return {
    entity_name: '',
    entity_currency: 'USD',
    fx_rate_to_group: 1,
    leases: [],
    manual: { rou_asset: 0, lease_liability: 0, lease_term_years: 5, interest_expense_year1: 0 },
  };
}

export default function ConsolidationPage() {
  const [groupCurrency, setGroupCurrency] = useState('USD');
  const [entities, setEntities] = useState<EntityInput[]>([blankEntity()]);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const addEntity = () => setEntities((p) => [...p, blankEntity()]);
  const removeEntity = (idx: number) => setEntities((p) => p.filter((_, i) => i !== idx));

  const updateEntity = (idx: number, patch: Partial<EntityInput>) =>
    setEntities((p) => p.map((e, i) => (i === idx ? { ...e, ...patch } : e)));

  const addManualLease = (idx: number) =>
    setEntities((p) =>
      p.map((e, i) =>
        i === idx
          ? {
              ...e,
              leases: [
                ...e.leases,
                {
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

  const loadFromSavedLeases = (idx: number) => {
    const repo = getLeaseRepository();
    const mapped: LeaseInput[] = repo.map((l: any) => ({
      rou_asset: Number(l.rou ?? l.results?.rou_asset ?? 0),
      lease_liability: Number(l.liability ?? l.results?.lease_liability ?? 0),
      lease_term_years: Math.max(1, Number(l.dates?.term_months ?? 12) / 12),
      interest_expense_year1: Number(l.results?.year_1_impact?.interest_expense ?? 0),
    }));
    updateEntity(idx, { leases: mapped });
    toast.success(`Loaded ${mapped.length} lease(s)`);
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
          leases: e.leases,
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
              {['USD', 'EUR', 'GBP', 'INR', 'AED', 'SGD', 'Other'].map((c) => (
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
                    {['USD', 'EUR', 'GBP', 'INR', 'AED', 'SGD', 'Other'].map((c) => (
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
                <Button variant="secondary" onClick={() => loadFromSavedLeases(idx)}>Load from saved leases</Button>
              </div>

              <div className="mt-3 grid grid-cols-1 md:grid-cols-5 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-[#64748b]">Lease Liability (£ / $ / ₹)</label>
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
                Tip: Save leases in Quick Analysis first, then click &apos;Load from saved leases&apos; to import automatically.
              </p>
              <p className="mt-2 text-xs text-[#64748b]">Leases loaded: {entity.leases.length}</p>
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
                        <td className="py-2 text-right">{formatIndianCurrency(Number(e.rou_asset || 0))}</td>
                        <td className="py-2 text-right">{formatIndianCurrency(Number(e.rou_asset_group_ccy || 0))}</td>
                        <td className="py-2 text-right">{formatIndianCurrency(Number((e.lease_liability_current || 0) + (e.lease_liability_non_current || 0)))}</td>
                        <td className="py-2 text-right">{formatIndianCurrency(Number(e.fx_translation_adjustment || 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white rounded-[14px] p-5 border border-[#e2e8f0]">
              <h4 className="font-semibold mb-3">Group Totals ({result.group_currency || groupCurrency})</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                <div>Total ROU Assets: <strong>{formatIndianCurrency(Number(result.group_totals?.rou_asset || 0))}</strong></div>
                <div>Lease Liabilities (Current): <strong>{formatIndianCurrency(Number(result.group_totals?.lease_liability_current || 0))}</strong></div>
                <div>Lease Liabilities (Non-Current): <strong>{formatIndianCurrency(Number(result.group_totals?.lease_liability_non_current || 0))}</strong></div>
                <div>Total Depreciation: <strong>{formatIndianCurrency(Number(result.group_totals?.depreciation_expense || 0))}</strong></div>
                <div>Total Interest: <strong>{formatIndianCurrency(Number(result.group_totals?.interest_expense || 0))}</strong></div>
                <div>FX Translation Reserve: <strong>{formatIndianCurrency(Number(result.group_totals?.fx_translation_adjustment || 0))}</strong></div>
              </div>
            </div>

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
                      <td className="py-2 text-right">{formatIndianCurrency(Number(j.amount || 0))}</td>
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
