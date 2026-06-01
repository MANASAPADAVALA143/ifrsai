'use client';

import { useMemo, useState } from 'react';
import { Plus, Trash2, Layers } from 'lucide-react';
import { Button } from '@/components/Button';
import { ifrs16ExtApi } from '@/lib/api';
import { formatLeaseMoney } from '@/lib/ifrs16-currency';
import toast from 'react-hot-toast';

export type ComponentRow = {
  id: string;
  name: string;
  type: 'lease' | 'service';
  amount: string;
};

type SplitResult = {
  lease_components?: { name: string; amount: number; liability: number; rou_asset: number }[];
  service_components?: { name: string; amount: number; annual_expense: number }[];
  consolidated?: {
    total_lease_liability: number;
    total_rou_asset: number;
    total_service_expense_annual: number;
  };
};

type Props = {
  isNew?: boolean;
  monthlyPayment: number;
  termMonths: number;
  ibrPct: number;
  commencementDate: string;
  currency: string;
  leaseId: string;
  practicalExpedientElected: boolean;
  onPracticalExpedientChange: (v: boolean) => void;
  onApplyToForm: (patch: { nonLeaseComponent: string; nonLeaseDescription: string }) => void;
  onAfterApply?: (patch: { nonLeaseComponent: string; nonLeaseDescription: string }) => void;
};

function newRow(partial?: Partial<ComponentRow>): ComponentRow {
  return {
    id: `cmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: '',
    type: 'lease',
    amount: '',
    ...partial,
  };
}

export function ComponentSplitWizard({
  isNew,
  monthlyPayment,
  termMonths,
  ibrPct,
  commencementDate,
  currency,
  leaseId,
  practicalExpedientElected,
  onPracticalExpedientChange,
  onApplyToForm,
}: Props) {
  const [multiMode, setMultiMode] = useState<boolean | null>(null);
  const [components, setComponents] = useState<ComponentRow[]>([
    newRow({ name: 'Office space / core lease', type: 'lease' }),
    newRow({ name: 'Maintenance & support', type: 'service' }),
  ]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SplitResult | null>(null);

  const componentSum = useMemo(
    () => components.reduce((s, c) => s + (parseFloat(c.amount) || 0), 0),
    [components]
  );
  const sumValid = monthlyPayment > 0 && Math.abs(componentSum - monthlyPayment) < 0.02;
  const fmt = (amount: number) => formatLeaseMoney(amount, currency);

  const runSplit = async () => {
    if (!commencementDate) {
      toast.error('Set lease start date first');
      return;
    }
    if (!sumValid) {
      toast.error(`Component amounts (${componentSum.toLocaleString()}) must equal monthly payment (${monthlyPayment.toLocaleString()})`);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await ifrs16ExtApi.componentSplit({
        total_contract_payment: monthlyPayment,
        components: components.map((c) => ({
          name: c.name || 'Component',
          type: c.type,
          amount: parseFloat(c.amount) || 0,
        })),
        term_months: termMonths,
        ibr: ibrPct,
        commencement_date: commencementDate,
        currency,
        lease_id: leaseId || 'NEW-LEASE',
      });
      if (error) throw new Error(error);
      setResult(data as SplitResult);
      toast.success('Component split calculated');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Component split failed');
    } finally {
      setLoading(false);
    }
  };

  const applyToLease = () => {
    const services = result?.service_components || [];
    const serviceMonthly = services.reduce((s, c) => s + (c.amount || 0), 0);
    const desc = services.map((s) => s.name).filter(Boolean).join('; ') || 'Service components';
    const patch = {
      nonLeaseComponent: String(serviceMonthly),
      nonLeaseDescription: desc,
    };
    onApplyToForm(patch);
    onPracticalExpedientChange(false);
    onAfterApply?.(patch);
    toast.success('Applied service components to lease — calculating IFRS 16');
  };

  return (
    <section className="mb-6">
      {isNew && (
        <div className="mb-4 p-3 rounded-lg bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 flex items-start gap-3">
          <Layers className="w-5 h-5 text-[#f97316] shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-[#9a3412]">IT / BPO contracts — multi-component split</p>
            <p className="text-xs text-[#78350f] mt-1">
              Separate lease (on balance sheet) from service (expensed). Required for bundled office + maintenance deals.
            </p>
          </div>
        </div>
      )}

      <h4 className="text-sm font-medium text-[#64748b] border-b border-[#e2e8f0] pb-2 mb-3 flex items-center gap-2">
        Lease vs non-lease components
        <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">IFRS 16 §12–15</span>
      </h4>

      <p className="text-sm text-[#64748b] mb-3">
        Does this contract include non-lease components (maintenance, cleaning, IT support)?
      </p>
      <div className="flex flex-wrap gap-2 mb-4">
        <button
          type="button"
          onClick={() => {
            setMultiMode(false);
            setResult(null);
            onPracticalExpedientChange(false);
          }}
          className={`px-4 py-2 rounded-lg text-sm font-medium border ${
            multiMode === false ? 'bg-[#f97316] text-white border-[#f97316]' : 'bg-white border-[#e2e8f0] text-[#64748b]'
          }`}
        >
          No — single component
        </button>
        <button
          type="button"
          onClick={() => {
            setMultiMode(true);
            onPracticalExpedientChange(false);
          }}
          className={`px-4 py-2 rounded-lg text-sm font-medium border ${
            multiMode === true ? 'bg-[#f97316] text-white border-[#f97316]' : 'bg-white border-[#e2e8f0] text-[#64748b]'
          }`}
        >
          Yes — split components
        </button>
        <button
          type="button"
          onClick={() => {
            setMultiMode(null);
            setResult(null);
            onPracticalExpedientChange(true);
          }}
          className={`px-4 py-2 rounded-lg text-sm font-medium border ${
            practicalExpedientElected ? 'bg-gray-700 text-white border-gray-700' : 'bg-white border-[#e2e8f0] text-[#64748b]'
          }`}
        >
          Practical expedient (§15)
        </button>
      </div>

      {multiMode === false && (
        <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg p-3">
          Full monthly payment will be measured under IFRS 16.
        </p>
      )}

      {practicalExpedientElected && multiMode === null && (
        <p className="text-sm text-gray-700 bg-gray-50 border rounded-lg p-3">
          Practical expedient elected — components not separated; entire payment on balance sheet.
        </p>
      )}

      {multiMode === true && (
        <div className="space-y-4">
          <p className="text-xs text-[#64748b]">
            Monthly payment (total): <strong>{fmt(monthlyPayment)}</strong>
            {monthlyPayment > 0 && (
              <span className={sumValid ? ' text-green-600 ml-2' : ' text-red-600 ml-2'}>
                {sumValid ? '✓ Allocations match' : `Allocated: ${fmt(componentSum)}`}
              </span>
            )}
          </p>

          <div className="space-y-2">
            <div className="grid grid-cols-12 gap-2 text-xs font-semibold text-[#64748b] px-1">
              <span className="col-span-4">Component</span>
              <span className="col-span-3">Type</span>
              <span className="col-span-3">Amount / month</span>
              <span className="col-span-2" />
            </div>
            {components.map((row) => (
              <div key={row.id} className="grid grid-cols-12 gap-2 items-center">
                <input
                  className="col-span-4 border border-[#e2e8f0] rounded-lg px-2 py-1.5 text-sm"
                  placeholder="e.g. Office rent"
                  value={row.name}
                  onChange={(e) =>
                    setComponents((rows) =>
                      rows.map((r) => (r.id === row.id ? { ...r, name: e.target.value } : r))
                    )
                  }
                />
                <select
                  className="col-span-3 border border-[#e2e8f0] rounded-lg px-2 py-1.5 text-sm"
                  value={row.type}
                  onChange={(e) =>
                    setComponents((rows) =>
                      rows.map((r) =>
                        r.id === row.id ? { ...r, type: e.target.value as 'lease' | 'service' } : r
                      )
                    )
                  }
                >
                  <option value="lease">Lease</option>
                  <option value="service">Service</option>
                </select>
                <input
                  type="number"
                  min="0"
                  className="col-span-3 border border-[#e2e8f0] rounded-lg px-2 py-1.5 text-sm"
                  value={row.amount}
                  onChange={(e) =>
                    setComponents((rows) =>
                      rows.map((r) => (r.id === row.id ? { ...r, amount: e.target.value } : r))
                    )
                  }
                />
                <button
                  type="button"
                  className="col-span-2 text-red-500 hover:text-red-700 disabled:opacity-30"
                  disabled={components.length <= 1}
                  onClick={() => setComponents((rows) => rows.filter((r) => r.id !== row.id))}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setComponents((rows) => [...rows, newRow()])}
            >
              <Plus className="w-4 h-4 mr-1" /> Add component
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              className="bg-[#f97316] hover:bg-[#ea580c] text-white"
              onClick={() => void runSplit()}
              isLoading={loading}
              disabled={!sumValid}
            >
              Calculate component split
            </Button>
            {result && (
              <Button variant="secondary" onClick={applyToLease}>
                Apply to lease & calculate
              </Button>
            )}
          </div>

          {result && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl border-2 border-green-200 bg-green-50">
                <h5 className="text-sm font-bold text-green-800 mb-3">On balance sheet (lease)</h5>
                {(result.lease_components || []).length === 0 ? (
                  <p className="text-xs text-green-700">No lease components</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {(result.lease_components || []).map((lc) => (
                      <li key={lc.name} className="flex justify-between gap-2">
                        <span>{lc.name}</span>
                        <span className="text-right shrink-0">
                          <span className="block">{fmt(lc.amount)}/mo</span>
                          <span className="text-xs text-green-700">
                            LL {fmt(lc.liability)}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {result.consolidated && (
                  <p className="mt-3 pt-3 border-t border-green-200 text-sm font-semibold text-green-900">
                    Total liability: {fmt(result.consolidated.total_lease_liability)}
                  </p>
                )}
              </div>
              <div className="p-4 rounded-xl border-2 border-red-200 bg-red-50">
                <h5 className="text-sm font-bold text-red-800 mb-3">Expensed (service)</h5>
                {(result.service_components || []).length === 0 ? (
                  <p className="text-xs text-red-700">No service components</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {(result.service_components || []).map((sc) => (
                      <li key={sc.name} className="flex justify-between gap-2">
                        <span>{sc.name}</span>
                        <span className="text-right shrink-0">
                          <span className="block">{fmt(sc.amount)}/mo</span>
                          <span className="text-xs text-red-700">
                            Annual {fmt(sc.annual_expense)}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {result.consolidated && (
                  <p className="mt-3 pt-3 border-t border-red-200 text-sm font-semibold text-red-900">
                    Annual service expense:{' '}
                    {fmt(result.consolidated.total_service_expense_annual)}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

