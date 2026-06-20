'use client';

import { Link2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/Button';
import { formatCurrency } from '@/lib/utils';
import type { Ifrs15ContractContext } from '@/lib/ifrs15-contract-context';

export type ContractContextBarVariant = 'default' | 'modification';

type ContractContextBarProps = {
  activeContract: Ifrs15ContractContext | null;
  sessionContracts: Ifrs15ContractContext[];
  portfolioContracts: Record<string, unknown>[];
  selectedContractId: string;
  onSelectedContractIdChange: (contractId: string) => void;
  onApply: () => void;
  variant?: ContractContextBarVariant;
};

export function ContractContextBar({
  activeContract,
  sessionContracts,
  portfolioContracts,
  selectedContractId,
  onSelectedContractIdChange,
  onApply,
  variant = 'default',
}: ContractContextBarProps) {
  const portfolioOptions = portfolioContracts
    .map((c) => String(c.contract_id || ''))
    .filter(Boolean)
    .filter((id) => !sessionContracts.some((s) => s.contract_id === id));

  const hasAnySource = sessionContracts.length > 0 || portfolioOptions.length > 0 || !!activeContract;

  if (!hasAnySource) {
    return (
      <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50/60 px-4 py-3 text-sm text-amber-950">
        <p className="font-medium">No contract loaded</p>
        <p className="text-xs mt-1 text-amber-900/80">
          {variant === 'modification'
            ? 'Calculate or save a contract first, then link this modification to the original contract.'
            : 'Run Revenue Calculate on the main page (or save to portfolio) — shared fields will pre-fill here automatically.'}
        </p>
      </div>
    );
  }

  const display = activeContract;
  const label =
    variant === 'modification' ? 'Link to original contract' : 'Load from current contract';

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/50 px-4 py-3 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <Link2 className="w-4 h-4 text-blue-700 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-blue-950">{label}</p>
            {display ? (
              <p className="text-xs text-blue-900/80 mt-0.5 truncate">
                {display.contract_id} · {display.customer_name || 'Customer'} ·{' '}
                {formatCurrency(display.contract_value, display.currency, 0)} · {display.effective_date}
              </p>
            ) : (
              <p className="text-xs text-blue-900/80 mt-0.5">
                Select a contract below to pre-fill shared identification fields.
              </p>
            )}
          </div>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="bg-white shrink-0"
          onClick={onApply}
          disabled={!selectedContractId && !display}
        >
          <RefreshCw className="w-3.5 h-3.5 mr-1" />
          {variant === 'modification' ? 'Link contract' : 'Apply pre-fill'}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-blue-900 font-medium">Contract</label>
        <select
          className="text-sm border border-blue-200 rounded-lg px-2 py-1.5 bg-white min-w-[200px] max-w-full"
          value={selectedContractId}
          onChange={(e) => onSelectedContractIdChange(e.target.value)}
        >
          <option value="">
            {activeContract ? `${activeContract.contract_id} (current)` : 'Select contract…'}
          </option>
          {sessionContracts.map((c) => (
            <option key={`s-${c.contract_id}`} value={c.contract_id}>
              {c.contract_id} — {c.customer_name || 'Customer'} ({c.source})
            </option>
          ))}
          {portfolioOptions.map((id) => {
            const row = portfolioContracts.find((c) => String(c.contract_id) === id);
            const cust = row ? String(row.customer_name || '') : '';
            return (
              <option key={`p-${id}`} value={id}>
                {id} — {cust || 'Portfolio'} (saved)
              </option>
            );
          })}
        </select>
        <span className="text-xs text-blue-800/70">
          Judgment fields (control indicators, VC scenarios, cost amounts) stay manual.
        </span>
      </div>
    </div>
  );
}
