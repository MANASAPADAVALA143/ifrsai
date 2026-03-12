'use client';

import { Button } from '@/components/Button';

const inputClass = 'w-full min-w-[120px] px-3 py-2 bg-white border border-[#e2e8f0] rounded-lg text-sm text-[#1e293b] focus:ring-2 focus:ring-[#f97316]/30 focus:border-[#f97316]';

export interface ReportFiltersState {
  lessee: string;
  leaseType: string;
  status: string;
  legalEntity: string;
  contractName: string;
  years: string[];
  months: string[];
}

export const defaultFilters: ReportFiltersState = {
  lessee: '',
  leaseType: '',
  status: '',
  legalEntity: '',
  contractName: '',
  years: [],
  months: [],
};

interface ReportFiltersProps {
  filters: ReportFiltersState;
  onFiltersChange: (f: ReportFiltersState) => void;
  lessees: string[];
  leaseTypes: string[];
  statuses: string[];
  legalEntities: string[];
  yearOptions?: number[];
  monthOptions?: { value: number; label: string }[];
  onApply?: () => void;
  onClearPeriods?: () => void;
  onExportExcel?: () => void;
  showYearMonth?: boolean;
  showContractSearch?: boolean;
}

export function ReportFilters({
  filters,
  onFiltersChange,
  lessees,
  leaseTypes,
  statuses,
  legalEntities,
  yearOptions = [],
  monthOptions = [],
  onApply,
  onClearPeriods,
  onExportExcel,
  showYearMonth = true,
  showContractSearch = true,
}: ReportFiltersProps) {
  const setOne = (key: keyof ReportFiltersState, value: any) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  const yearList = yearOptions.length ? yearOptions : Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - 2 + i);
  const monthList = monthOptions.length ? monthOptions : Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: new Date(2000, i, 1).toLocaleString('default', { month: 'short' }) }));

  return (
    <div className="bg-[#f9fafb] border border-[#e2e8f0] rounded-xl p-4 mb-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
        <div>
          <label className="block text-xs font-medium text-[#64748b] uppercase tracking-wide mb-1">Lessee</label>
          <select value={filters.lessee} onChange={(e) => setOne('lessee', e.target.value)} className={inputClass}>
            <option value="">All</option>
            {lessees.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-[#64748b] uppercase tracking-wide mb-1">Lease Type</label>
          <select value={filters.leaseType} onChange={(e) => setOne('leaseType', e.target.value)} className={inputClass}>
            <option value="">All</option>
            {leaseTypes.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-[#64748b] uppercase tracking-wide mb-1">Status</label>
          <select value={filters.status} onChange={(e) => setOne('status', e.target.value)} className={inputClass}>
            <option value="">All</option>
            {statuses.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-[#64748b] uppercase tracking-wide mb-1">Legal Entity</label>
          <select value={filters.legalEntity} onChange={(e) => setOne('legalEntity', e.target.value)} className={inputClass}>
            <option value="">All</option>
            {legalEntities.map((e) => (
              <option key={e} value={e}>{e}</option>
            ))}
          </select>
        </div>
        {showContractSearch && (
          <div className="sm:col-span-2 lg:col-span-4">
            <label className="block text-xs font-medium text-[#64748b] uppercase tracking-wide mb-1">Contract Name</label>
            <input type="text" value={filters.contractName} onChange={(e) => setOne('contractName', e.target.value)} placeholder="Search contract..." className={inputClass} />
          </div>
        )}
        {showYearMonth && (
          <>
            <div>
              <label className="block text-xs font-medium text-[#64748b] uppercase tracking-wide mb-1">Years</label>
              <select
                multiple
                value={filters.years}
                onChange={(e) => setOne('years', Array.from(e.target.selectedOptions, (o) => o.value))}
                className={inputClass + ' min-h-[80px]'}
              >
                {yearList.map((y) => (
                  <option key={y} value={String(y)}>{y}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#64748b] uppercase tracking-wide mb-1">Months</label>
              <select
                multiple
                value={filters.months}
                onChange={(e) => setOne('months', Array.from(e.target.selectedOptions, (o) => o.value))}
                className={inputClass + ' min-h-[80px]'}
              >
                {monthList.map((m) => (
                  <option key={m.value} value={String(m.value)}>{m.label}</option>
                ))}
              </select>
            </div>
          </>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {onApply && <Button size="sm" className="bg-[#f97316] text-white" onClick={onApply}>Apply Filters</Button>}
        {onClearPeriods && <Button size="sm" variant="secondary" className="border border-[#e2e8f0]" onClick={onClearPeriods}>Clear Periods</Button>}
        {onExportExcel && <Button size="sm" variant="secondary" className="border border-[#e2e8f0]" onClick={onExportExcel}>📊 Export to Excel</Button>}
      </div>
    </div>
  );
}
