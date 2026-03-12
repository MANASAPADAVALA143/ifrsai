'use client';

import { useState, useMemo, useEffect } from 'react';
import { SidebarLayout } from '@/components/SidebarLayout';
import { ReportFilters, defaultFilters } from '@/components/ifrs16-reports/ReportFilters';
import { ReportSummaryBar } from '@/components/ifrs16-reports/ReportSummaryBar';
import {
  getLeasesFromStorage,
  getSchedule,
  scheduleRow,
  getUniqueLessees,
  getUniqueLeaseTypes,
  getUniqueStatuses,
  getUniqueLegalEntities,
  formatReportCurrency,
} from '@/lib/reports-utils';
import { exportReportCsv } from '@/lib/export-report-csv';
import { Button } from '@/components/Button';
import Link from 'next/link';

const SUB_TABS = [
  { id: 'll' as const, label: 'FX LL Schedule' },
  { id: 'rc' as const, label: 'FX RC Schedule' },
  { id: 'rou' as const, label: 'FX ROU Schedule' },
  { id: 'rcrou' as const, label: 'FX RC ROU Schedule' },
];

export default function FXScheduleReportPage() {
  const [filters, setFilters] = useState(defaultFilters);
  const [subTab, setSubTab] = useState<'ll' | 'rc' | 'rou' | 'rcrou'>('ll');
  const [leases, setLeases] = useState<any[]>([]);

  useEffect(() => {
    setLeases(getLeasesFromStorage());
  }, []);

  const lessees = useMemo(() => getUniqueLessees(leases), [leases]);
  const leaseTypes = useMemo(() => getUniqueLeaseTypes(leases), [leases]);
  const statuses = useMemo(() => getUniqueStatuses(leases), [leases]);
  const legalEntities = useMemo(() => getUniqueLegalEntities(leases), [leases]);

  const filtered = useMemo(() => {
    return leases.filter((l) => {
      const currency = l?.payments?.currency ?? l?.currency ?? 'INR';
      if (currency === 'INR') return false;
      if (filters.lessee && (l.lessee ?? l.lessee_name) !== filters.lessee) return false;
      if (filters.leaseType && l.lease_type !== filters.leaseType) return false;
      if (filters.status && (l.status ?? l.lease_status) !== filters.status) return false;
      if (filters.legalEntity && (l as any).legal_entity !== filters.legalEntity) return false;
      if (filters.contractName && !((l.title ?? l.asset ?? l.lease_id ?? '').toLowerCase().includes(filters.contractName.toLowerCase()))) return false;
      return true;
    });
  }, [leases, filters]);

  const rows = useMemo(() => {
    const out: Record<string, React.ReactNode>[] = [];
    filtered.forEach((lease) => {
      const schedule = getSchedule(lease);
      const foreignCcy = lease?.payments?.currency ?? lease?.currency ?? 'USD';
      const rate = 82;
      schedule.slice(0, 12).forEach((r: any, i: number) => {
        const row = scheduleRow(r);
        const amt = Number(row.payment ?? 0);
        const openingFcy = amt;
        const openingLcy = amt * rate;
        const movementFcy = amt;
        const movementLcy = amt * rate;
        const closingFcy = amt;
        const closingLcy = amt * rate;
        const fxGainLoss = 0;
        out.push({
          id: lease.id ?? lease.lease_id,
          contract: lease.lease_id ?? lease.id ?? '—',
          foreignCcy,
          functionalCcy: 'INR',
          period: row.period ?? i + 1,
          openingFcy: formatReportCurrency(openingFcy, foreignCcy),
          rate: String(rate),
          openingLcy: formatReportCurrency(openingLcy),
          movementFcy: formatReportCurrency(movementFcy, foreignCcy),
          movementLcy: formatReportCurrency(movementLcy),
          closingFcy: formatReportCurrency(closingFcy, foreignCcy),
          closingLcy: formatReportCurrency(closingLcy),
          fxGainLoss: formatReportCurrency(fxGainLoss),
          _fxGainLoss: fxGainLoss,
        });
      });
    });
    return out;
  }, [filtered]);

  const handleExport = () => {
    const headers = ['Contract #', 'Foreign CCY', 'Functional CCY', 'Period', 'Opening (FCY)', 'Rate', 'Opening (LCY)', 'Movement (FCY)', 'Movement (LCY)', 'Closing (FCY)', 'Closing (LCY)', 'FX Gain/Loss'];
    const dataRows = rows.map((r) => [r.contract, r.foreignCcy, r.functionalCcy, r.period, (r as any).openingFcy, (r as any).rate, (r as any).openingLcy, (r as any).movementFcy, (r as any).movementLcy, (r as any).closingFcy, (r as any).closingLcy, (r as any).fxGainLoss].map(String));
    exportReportCsv('FX Schedule Report', headers, dataRows);
  };

  const columns = [
    { key: 'contract', label: 'Contract #', align: 'left' as const },
    { key: 'foreignCcy', label: 'Foreign CCY', align: 'left' as const },
    { key: 'functionalCcy', label: 'Functional CCY', align: 'left' as const },
    { key: 'period', label: 'Period', align: 'right' as const },
    { key: 'openingFcy', label: 'Opening (FCY)', align: 'right' as const },
    { key: 'rate', label: 'Rate', align: 'right' as const },
    { key: 'openingLcy', label: 'Opening (LCY)', align: 'right' as const },
    { key: 'movementFcy', label: 'Movement (FCY)', align: 'right' as const },
    { key: 'movementLcy', label: 'Movement (LCY)', align: 'right' as const },
    { key: 'closingFcy', label: 'Closing (FCY)', align: 'right' as const },
    { key: 'closingLcy', label: 'Closing (LCY)', align: 'right' as const },
    { key: 'fxGainLoss', label: 'FX Gain/Loss', align: 'right' as const },
  ];

  return (
    <SidebarLayout pageTitle="FX Schedule Report" pageSubtitle="Foreign exchange impact on lease components">
      <div className="mb-4 flex justify-end">
        <Link href="/dashboard/ifrs16/reports">
          <Button variant="secondary" className="border border-[#e2e8f0]">← Back to Reports</Button>
        </Link>
      </div>

      <ReportFilters
        filters={filters}
        onFiltersChange={setFilters}
        lessees={lessees}
        leaseTypes={leaseTypes}
        statuses={statuses}
        legalEntities={legalEntities}
        onExportExcel={handleExport}
        showContractSearch={true}
      />

      <div className="flex gap-2 mb-4">
        {SUB_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSubTab(t.id)}
            className={`px-3 py-1.5 rounded text-sm font-medium ${subTab === t.id ? 'bg-[#f97316] text-white' : 'bg-white border border-[#e2e8f0]'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <ReportSummaryBar contractCount={filtered.length} totalLabel="FX leases" totalAmount={String(filtered.length)} />

      {filtered.length === 0 ? (
        <div className="py-12 text-center text-[#64748b] border border-[#e2e8f0] rounded-xl bg-white">
          No leases with foreign currency. This report shows leases where currency is not INR.
        </div>
      ) : (
        <>
          <div className="mb-2 flex justify-end">
            <Button variant="secondary" className="border border-[#e2e8f0]" onClick={handleExport}>📊 Export to Excel</Button>
          </div>
          <div className="overflow-x-auto border border-[#e2e8f0] rounded-xl">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-[#374151] text-white">
                  {columns.map((c) => (
                    <th key={c.key} className={`px-3 py-2 font-semibold ${c.align === 'right' ? 'text-right' : 'text-left'}`}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => (
                  <tr
                    key={idx}
                    className={`border-t border-[#e2e8f0] ${idx % 2 === 1 ? 'bg-[#f9fafb]' : 'bg-white'} ${(row as any)._fxGainLoss > 0 ? 'text-green-600' : (row as any)._fxGainLoss < 0 ? 'text-red-600' : ''}`}
                  >
                    <td className="px-3 py-2">
                      <Link href={`/dashboard/ifrs16/leases/${row.id}`} className="text-[#f97316] hover:underline">{row.contract}</Link>
                    </td>
                    <td className="px-3 py-2">{row.foreignCcy}</td>
                    <td className="px-3 py-2">{row.functionalCcy}</td>
                    <td className="px-3 py-2 text-right font-mono">{row.period}</td>
                    <td className="px-3 py-2 text-right font-mono">{(row as any).openingFcy}</td>
                    <td className="px-3 py-2 text-right font-mono">{(row as any).rate}</td>
                    <td className="px-3 py-2 text-right font-mono">{(row as any).openingLcy}</td>
                    <td className="px-3 py-2 text-right font-mono">{(row as any).movementFcy}</td>
                    <td className="px-3 py-2 text-right font-mono">{(row as any).movementLcy}</td>
                    <td className="px-3 py-2 text-right font-mono">{(row as any).closingFcy}</td>
                    <td className="px-3 py-2 text-right font-mono">{(row as any).closingLcy}</td>
                    <td className="px-3 py-2 text-right font-mono">{(row as any).fxGainLoss}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </SidebarLayout>
  );
}