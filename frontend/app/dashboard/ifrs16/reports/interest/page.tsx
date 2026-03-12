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
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from '@/components/Charts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function InterestScheduleReportPage() {
  const [filters, setFilters] = useState(defaultFilters);
  const [leases, setLeases] = useState<any[]>([]);
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());

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

  const { rows, monthTotals, totalInterest, chartData } = useMemo(() => {
    const monthTotals: number[] = Array(12).fill(0);
    const out: Record<string, React.ReactNode>[] = [];
    let totalInterest = 0;

    filtered.forEach((lease) => {
      const schedule = getSchedule(lease);
      const ibrPct = Number(lease?.discount_rate ?? 0);
      const start = lease.start_date ?? lease.dates?.commencement;
      const startDate = start ? new Date(start) : null;
      const contractDays = lease.dates?.term_months ? lease.dates.term_months * 30 : 0;
      const totalInt = schedule.reduce((s: number, r: any) => s + (scheduleRow(r).interest ?? 0), 0);
      totalInterest += totalInt;

      const monthValues: (React.ReactNode)[] = [];
      for (let m = 1; m <= 12; m++) {
        let amt = 0;
        schedule.forEach((r: any) => {
          const d = scheduleRow(r).date;
          if (!d) return;
          const dt = new Date(d);
          if (dt.getFullYear() === selectedYear && dt.getMonth() + 1 === m) amt += scheduleRow(r).interest ?? 0;
        });
        monthTotals[m - 1] += amt;
        monthValues.push(amt > 0 ? formatReportCurrency(amt) : '—');
      }

      out.push({
        id: lease.id ?? lease.lease_id,
        leaseId: lease.lease_id ?? lease.id ?? '—',
        lessor: lease.lessor ?? lease.lessor_name ?? '—',
        lessee: lease.lessee ?? lease.lessee_name ?? '—',
        ibrPct: ibrPct ? `${ibrPct}%` : '—',
        totalInterest: formatReportCurrency(totalInt),
        contractDays: String(contractDays),
        ...Object.fromEntries(MONTHS.map((_, i) => [`m${i}`, monthValues[i]])),
      });
    });

    const chartData = MONTHS.map((name, i) => ({ name, amount: monthTotals[i] }));
    return { rows: out, monthTotals, totalInterest, chartData };
  }, [filtered, selectedYear]);

  const handleExport = () => {
    const headers = ['Lease ID', 'Lessor', 'Lessee', 'IBR %', 'Total Interest', 'Contract Days', ...MONTHS];
    const dataRows = rows.map((r) => [r.leaseId, r.lessor, r.lessee, (r as any).ibrPct, (r as any).totalInterest, (r as any).contractDays, ...MONTHS.map((_, i) => (r as any)[`m${i}`] ?? '—')].map(String));
    dataRows.push(['TOTAL', '', '', '', formatReportCurrency(totalInterest), '', ...monthTotals.map((t) => formatReportCurrency(t))]);
    exportReportCsv('Interest Schedule Report', headers, dataRows);
  };

  return (
    <SidebarLayout pageTitle="Interest Schedule Report" pageSubtitle="Monthly interest expense by lease">
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

      <ReportSummaryBar contractCount={rows.length} totalLabel="Total Interest" totalAmount={formatReportCurrency(totalInterest)} />

      <div className="h-64 mb-6">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 24 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `₹${(v / 100000).toFixed(0)}L`} />
            <Tooltip formatter={(v: number) => formatReportCurrency(v)} />
            <Bar dataKey="amount" fill="#f97316" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

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
              <th className="px-3 py-2 text-right font-semibold">IBR %</th>
              <th className="px-3 py-2 text-right font-semibold">Total Interest</th>
              <th className="px-3 py-2 text-right font-semibold">Contract Days</th>
              {MONTHS.map((m) => (
                <th key={m} className="px-3 py-2 text-right font-semibold">{m}</th>
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
                <td className="px-3 py-2 text-right font-mono">{(row as any).ibrPct}</td>
                <td className="px-3 py-2 text-right font-mono">{(row as any).totalInterest}</td>
                <td className="px-3 py-2 text-right font-mono">{(row as any).contractDays}</td>
                {MONTHS.map((_, i) => (
                  <td key={i} className="px-3 py-2 text-right font-mono">{(row as any)[`m${i}`] ?? '—'}</td>
                ))}
              </tr>
            ))}
            <tr className="border-t-2 border-[#e2e8f0] bg-[#fff7ed] font-bold">
              <td className="px-3 py-2" colSpan={5}>TOTAL</td>
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