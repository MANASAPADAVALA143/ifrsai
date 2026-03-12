'use client';

import { useState, useMemo, useEffect } from 'react';
import { SidebarLayout } from '@/components/SidebarLayout';
import { ReportFilters, defaultFilters } from '@/components/ifrs16-reports/ReportFilters';
import { ReportSummaryBar } from '@/components/ifrs16-reports/ReportSummaryBar';
import {
  getLeasesFromStorage,
  getSchedule,
  scheduleRow,
  getLiability,
  getUniqueLessees,
  getUniqueLeaseTypes,
  getUniqueStatuses,
  getUniqueLegalEntities,
  formatReportCurrency,
} from '@/lib/reports-utils';
import { exportReportCsv } from '@/lib/export-report-csv';
import { Button } from '@/components/Button';
import Link from 'next/link';

export default function LiabilityMovementReportPage() {
  const [filters, setFilters] = useState(defaultFilters);
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
      if (filters.lessee && (l.lessee ?? l.lessee_name) !== filters.lessee) return false;
      if (filters.leaseType && l.lease_type !== filters.leaseType) return false;
      if (filters.status && (l.status ?? l.lease_status) !== filters.status) return false;
      if (filters.legalEntity && (l as any).legal_entity !== filters.legalEntity) return false;
      if (filters.contractName && !((l.title ?? l.asset ?? l.lease_id ?? '').toLowerCase().includes(filters.contractName.toLowerCase()))) return false;
      return true;
    });
  }, [leases, filters]);

  const totalLiability = useMemo(() => filtered.reduce((s, l) => s + getLiability(l), 0), [filtered]);

  const handleExport = () => {
    const headers = ['Legal Entity', 'Contract ID', 'Contract Name', 'Date', 'Opening Liability', 'Modifications', 'Interest', 'Payments', 'Closing Lease Liability'];
    const dataRows: (string | number)[][] = [];
    filtered.forEach((lease) => {
      const schedule = getSchedule(lease);
      const currency = lease?.payments?.currency ?? lease?.currency ?? 'INR';
      schedule.forEach((r: any) => {
        const row = scheduleRow(r);
        dataRows.push([
          (lease as any).legal_entity ?? '—',
          lease.lease_id ?? lease.id ?? '—',
          lease.title ?? lease.asset ?? '—',
          row.date ?? '—',
          formatReportCurrency(row.opening ?? 0, currency),
          '0',
          formatReportCurrency(row.interest ?? 0, currency),
          formatReportCurrency(row.payment ?? 0, currency),
          formatReportCurrency(row.closing ?? 0, currency),
        ]);
      });
    });
    exportReportCsv('Liability Movement Report', headers, dataRows);
  };

  return (
    <SidebarLayout pageTitle="Lease Liability Movement Schedule Report" pageSubtitle="Opening to closing movement by contract">
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

      <ReportSummaryBar
        contractCount={filtered.length}
        totalLabel="Total Lease Liability"
        totalAmount={formatReportCurrency(totalLiability)}
        statusCounts={[{ label: 'Active', count: filtered.filter((l) => (l.status ?? l.lease_status) === 'Active').length }]}
      />

      <div className="mb-2 flex justify-end">
        <Button variant="secondary" className="border border-[#e2e8f0]" onClick={handleExport}>📊 Export to Excel</Button>
      </div>

      <div className="space-y-6">
        {filtered.map((lease) => {
          const schedule = getSchedule(lease);
          const currency = lease?.payments?.currency ?? lease?.currency ?? 'INR';
          return (
            <div key={lease.id ?? lease.lease_id} className="border border-[#e2e8f0] rounded-xl overflow-hidden">
              <div className="bg-[#374151] text-white px-4 py-2 flex flex-wrap gap-4 text-sm">
                <span>{(lease as any).legal_entity ?? '—'}</span>
                <span>{lease.lease_id ?? lease.id ?? '—'}</span>
                <span>{lease.title ?? lease.asset ?? '—'}</span>
                <span>{currency}</span>
                <span>{lease.lessor ?? lease.lessor_name ?? '—'}</span>
                <span>{lease.lessee ?? lease.lessee_name ?? '—'}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-[#f9fafb]">
                      <th className="px-3 py-2 text-left font-medium text-[#64748b]">Date</th>
                      <th className="px-3 py-2 text-right font-medium text-[#64748b]">Opening Liability</th>
                      <th className="px-3 py-2 text-right font-medium text-[#64748b]">Modifications</th>
                      <th className="px-3 py-2 text-right font-medium text-[#64748b]">Interest</th>
                      <th className="px-3 py-2 text-right font-medium text-[#64748b]">Payments</th>
                      <th className="px-3 py-2 text-right font-medium text-[#64748b]">Closing Lease Liability</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedule.map((r: any, i: number) => {
                      const row = scheduleRow(r);
                      return (
                        <tr key={i} className={`border-t border-[#e2e8f0] ${i % 2 === 1 ? 'bg-[#f9fafb]' : 'bg-white'}`}>
                          <td className="px-3 py-2">{row.date ?? '—'}</td>
                          <td className="px-3 py-2 text-right font-mono">{formatReportCurrency(row.opening ?? 0, currency)}</td>
                          <td className="px-3 py-2 text-right font-mono">0</td>
                          <td className="px-3 py-2 text-right font-mono">{formatReportCurrency(row.interest ?? 0, currency)}</td>
                          <td className="px-3 py-2 text-right font-mono">{formatReportCurrency(row.payment ?? 0, currency)}</td>
                          <td className="px-3 py-2 text-right font-mono">{formatReportCurrency(row.closing ?? 0, currency)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-2 bg-[#fff7ed] text-right font-mono text-sm border-t border-[#e2e8f0]">
                Subtotal: {formatReportCurrency(schedule.length ? scheduleRow(schedule[schedule.length - 1]).closing ?? 0 : 0, currency)}
              </div>
            </div>
          );
        })}
      </div>
      {filtered.length === 0 && (
        <div className="py-12 text-center text-[#64748b] border border-[#e2e8f0] rounded-xl">No Data Found</div>
      )}
    </SidebarLayout>
  );
}