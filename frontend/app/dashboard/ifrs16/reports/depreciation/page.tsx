'use client';

import { useState, useMemo, useEffect } from 'react';
import { SidebarLayout } from '@/components/SidebarLayout';
import { ReportFilters, defaultFilters } from '@/components/ifrs16-reports/ReportFilters';
import { ReportSummaryBar } from '@/components/ifrs16-reports/ReportSummaryBar';
import {
  getLeasesFromStorage,
  getSchedule,
  scheduleRow,
  getROU,
  getMonthlyDepreciation,
  getUniqueLessees,
  getUniqueLeaseTypes,
  getUniqueStatuses,
  getUniqueLegalEntities,
  formatReportCurrency,
} from '@/lib/reports-utils';
import { exportReportCsv } from '@/lib/export-report-csv';
import { Button } from '@/components/Button';
import Link from 'next/link';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function DepreciationScheduleReportPage() {
  const [filters, setFilters] = useState(defaultFilters);
  const [leases, setLeases] = useState<any[]>([]);
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());
  const [highlightMonth, setHighlightMonth] = useState<number | null>(null);

  useEffect(() => {
    setLeases(getLeasesFromStorage());
  }, []);

  const lessees = useMemo(() => getUniqueLessees(leases), [leases]);
  const leaseTypes = useMemo(() => getUniqueLeaseTypes(leases), [leases]);
  const statuses = useMemo(() => getUniqueStatuses(leases), [leases]);
  const legalEntities = useMemo(() => getUniqueLegalEntities(leases), [leases]);

  const filtered = useMemo(() => {
    return leases.filter((l) => {
      if (filters.lessee && (l.lessee ?? l.lessee_name) !== filters.lessee) return false;
      if (filters.leaseType && l.lease_type !== filters.leaseType) return false;
      if (filters.status && (l.status ?? l.lease_status) !== filters.status) return false;
      if (filters.legalEntity && (l as any).legal_entity !== filters.legalEntity) return false;
      if (filters.contractName && !((l.title ?? l.asset ?? l.lease_id ?? '').toLowerCase().includes(filters.contractName.toLowerCase()))) return false;
      return true;
    });
  }, [leases, filters]);

  const { rows, totalROU, monthTotals } = useMemo(() => {
    const monthTotals: number[] = Array(12).fill(0);
    const out: Record<string, React.ReactNode>[] = [];
    let totalROU = 0;

    filtered.forEach((lease) => {
      const schedule = getSchedule(lease);
      const monthlyDep = getMonthlyDepreciation(lease);
      const rou = getROU(lease);
      totalROU += rou;
      const start = lease.start_date ?? lease.dates?.commencement;
      const startDate = start ? new Date(start) : null;
      const contractDays = lease.dates?.term_months ? lease.dates.term_months * 30 : 0;
      const totalDep = monthlyDep * (lease.dates?.term_months ?? 0);

      const monthValues: (React.ReactNode)[] = [];
      for (let m = 1; m <= 12; m++) {
        let amt = 0;
        if (startDate && startDate.getFullYear() === selectedYear) {
          const firstMonth = startDate.getMonth() + 1;
          if (m >= firstMonth) {
            const periodIndex = m - firstMonth;
            if (periodIndex < (lease.dates?.term_months ?? 0)) amt = monthlyDep;
          }
        } else if (startDate && startDate.getFullYear() < selectedYear) {
          const monthsInYear = Math.min(12, (lease.dates?.term_months ?? 0) - (selectedYear - startDate.getFullYear()) * 12);
          if (m <= monthsInYear) amt = monthlyDep;
        }
        monthTotals[m - 1] += amt;
        monthValues.push(amt > 0 ? formatReportCurrency(amt) : '—');
      }

      out.push({
        id: lease.id ?? lease.lease_id,
        leaseId: lease.lease_id ?? lease.id ?? '—',
        lessor: lease.lessor ?? lease.lessor_name ?? '—',
        lessee: lease.lessee ?? lease.lessee_name ?? '—',
        totalDepreciation: formatReportCurrency(totalDep),
        contractDays: String(contractDays),
        ...Object.fromEntries(MONTHS.map((_, i) => [`m${i}`, monthValues[i]])),
      });
    });

    return { rows: out, totalROU, monthTotals };
  }, [filtered, selectedYear]);

  const handleExport = () => {
    const headers = ['Lease ID', 'Lessor', 'Lessee', 'Total Depreciation', 'Contract Days', ...MONTHS];
    const dataRows = rows.map((r) => [r.leaseId, r.lessor, r.lessee, (r as any).totalDepreciation, (r as any).contractDays, ...MONTHS.map((_, i) => (r as any)[`m${i}`] ?? '—')].map(String));
    dataRows.push(['TOTAL', '', '', '', '', ...monthTotals.map((t) => formatReportCurrency(t))]);
    exportReportCsv('Depreciation Schedule Report', headers, dataRows);
  };

  return (
    <SidebarLayout pageTitle="Depreciation Schedule Report" pageSubtitle="Monthly depreciation by lease">
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

      <div className="flex flex-wrap items-center gap-4 mb-4">
        <label className="text-sm text-[#64748b]">Year</label>
        <select value={selectedYear} onChange={(e) => setSelectedYear(parseInt(e.target.value, 10))} className="px-3 py-2 border border-[#e2e8f0] rounded-lg">
          {[selectedYear - 2, selectedYear - 1, selectedYear, selectedYear + 1].map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>

      <ReportSummaryBar
        contractCount={rows.length}
        totalLabel="Total ROU Value"
        totalAmount={formatReportCurrency(totalROU)}
        statusCounts={[{ label: 'Active', count: filtered.filter((l) => (l.status ?? l.lease_status) === 'Active').length }]}
        typeCounts={leaseTypes.slice(0, 3).map((t) => ({ label: t, count: filtered.filter((l) => l.lease_type === t).length }))}
      />

      <div className="mb-2 flex justify-end">
        <Button variant="secondary" className="border border-[#e2e8f0]" onClick={handleExport}>📊 Export to Excel</Button>
      </div>

      <div className="overflow-x-auto border border-[#e2e8f0] rounded-xl">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-[#374151] text-white">
              <th className="px-3 py-2 text-left font-semibold">Lease ID</th>
              <th className="px-3 py-2 text-left font-semibold">Lessor</th>
              <th className="px-3 py-2 text-left font-semibold">Lessee</th>
              <th className="px-3 py-2 text-right font-semibold">Total Depreciation</th>
              <th className="px-3 py-2 text-right font-semibold">Contract Days</th>
              {MONTHS.map((m, i) => (
                <th key={m} className={`px-3 py-2 text-right font-semibold ${highlightMonth === i + 1 ? 'bg-[#fff7ed]' : ''}`}>{m}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={idx} className={`border-t border-[#e2e8f0] ${idx % 2 === 1 ? 'bg-[#f9fafb]' : 'bg-white'}`}>
                <td className="px-3 py-2">
                  <Link href={`/dashboard/ifrs16/leases/${row.id}`} className="text-[#f97316] hover:underline">{row.leaseId}</Link>
                </td>
                <td className="px-3 py-2">{row.lessor}</td>
                <td className="px-3 py-2">{row.lessee}</td>
                <td className="px-3 py-2 text-right font-mono">{(row as any).totalDepreciation}</td>
                <td className="px-3 py-2 text-right font-mono">{(row as any).contractDays}</td>
                {MONTHS.map((_, i) => (
                  <td key={i} className={`px-3 py-2 text-right font-mono ${highlightMonth === i + 1 ? 'bg-[#fff7ed]' : ''}`}>{(row as any)[`m${i}`] ?? '—'}</td>
                ))}
              </tr>
            ))}
            <tr className="border-t-2 border-[#e2e8f0] bg-[#fff7ed] font-bold">
              <td className="px-3 py-2" colSpan={4}>TOTAL</td>
              <td className="px-3 py-2"></td>
              {monthTotals.map((t, i) => (
                <td key={i} className="px-3 py-2 text-right font-mono">{formatReportCurrency(t)}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </SidebarLayout>
  );
}