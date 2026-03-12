'use client';

import { useState, useMemo, useEffect } from 'react';
import { SidebarLayout } from '@/components/SidebarLayout';
import { ReportFilters, defaultFilters } from '@/components/ifrs16-reports/ReportFilters';
import { ReportSummaryBar } from '@/components/ifrs16-reports/ReportSummaryBar';
import { ReportTable } from '@/components/ifrs16-reports/ReportTable';
import {
  getLeasesFromStorage,
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

export default function AssetsDetailReportPage() {
  const [filters, setFilters] = useState(defaultFilters);
  const [page, setPage] = useState(1);
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

  const { rows, totalROU, totalAccDep, totalNBV } = useMemo(() => {
    let totalROU = 0;
    let totalAccDep = 0;
    let totalNBV = 0;
    const out: Record<string, React.ReactNode>[] = [];

    filtered.forEach((lease) => {
      const rou = getROU(lease);
      const monthlyDep = getMonthlyDepreciation(lease);
      const termMonths = lease?.dates?.term_months ?? 0;
      const start = lease.start_date ?? lease.dates?.commencement;
      const startDate = start ? new Date(start) : null;
      const now = new Date();
      const elapsed = startDate ? Math.min(termMonths, Math.floor((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 30))) : 0;
      const accDep = monthlyDep * elapsed;
      const nbv = Math.max(0, rou - accDep);
      const remaining = Math.max(0, termMonths - elapsed);
      const currency = lease?.payments?.currency ?? lease?.currency ?? 'INR';

      totalROU += rou;
      totalAccDep += accDep;
      totalNBV += nbv;

      const category = lease.lease_type ?? 'Other';
      out.push({
        id: lease.id ?? lease.lease_id,
        leaseId: lease.lease_id ?? lease.id ?? '—',
        assetId: lease.lease_id ?? lease.id ?? '—',
        assetName: lease.title ?? lease.asset ?? '—',
        assetCategory: category,
        lessee: lease.lessee ?? lease.lessee_name ?? '—',
        lessor: lease.lessor ?? lease.lessor_name ?? '—',
        leaseClassification: 'Lessee',
        leaseStart: lease.start_date ?? lease.dates?.commencement ?? '—',
        leaseEnd: lease.end_date ?? lease.dates?.end ?? '—',
        contractDuration: `${termMonths} months`,
        currency,
        initialROU: formatReportCurrency(rou, currency),
        currentNBV: formatReportCurrency(nbv, currency),
        accumulatedDepreciation: formatReportCurrency(accDep, currency),
        monthlyDepreciation: formatReportCurrency(monthlyDep, currency),
        remainingMonths: String(remaining),
        status: lease.status ?? lease.lease_status ?? 'Active',
      });
    });

    return { rows: out, totalROU, totalAccDep, totalNBV };
  }, [filtered]);

  const handleExport = () => {
    const headers = ['Lease ID', 'Asset ID', 'Asset Name', 'Asset Category', 'Lessee', 'Lessor', 'Lease Classification', 'Lease Start Date', 'Lease End Date', 'Contract Duration', 'Currency', 'Initial ROU Value', 'Current NBV', 'Accumulated Depreciation', 'Monthly Depreciation', 'Remaining Months', 'Status'];
    const dataRows = rows.map((r) => [r.leaseId, r.assetId, r.assetName, r.assetCategory, r.lessee, r.lessor, r.leaseClassification, r.leaseStart, r.leaseEnd, r.contractDuration, r.currency, (r as any).initialROU, (r as any).currentNBV, (r as any).accumulatedDepreciation, (r as any).monthlyDepreciation, (r as any).remainingMonths, r.status].map(String));
    exportReportCsv('Assets Detail Report', headers, dataRows);
  };

  const columns = [
    { key: 'leaseId', label: 'Lease ID', align: 'left' as const },
    { key: 'assetId', label: 'Asset ID', align: 'left' as const },
    { key: 'assetName', label: 'Asset Name', align: 'left' as const },
    { key: 'assetCategory', label: 'Asset Category', align: 'left' as const },
    { key: 'lessee', label: 'Lessee', align: 'left' as const },
    { key: 'lessor', label: 'Lessor', align: 'left' as const },
    { key: 'leaseClassification', label: 'Lease Classification', align: 'left' as const },
    { key: 'leaseStart', label: 'Lease Start Date', align: 'left' as const },
    { key: 'leaseEnd', label: 'Lease End Date', align: 'left' as const },
    { key: 'contractDuration', label: 'Contract Duration', align: 'left' as const },
    { key: 'currency', label: 'Currency', align: 'left' as const },
    { key: 'initialROU', label: 'Initial ROU Value', align: 'right' as const },
    { key: 'currentNBV', label: 'Current NBV', align: 'right' as const },
    { key: 'accumulatedDepreciation', label: 'Accumulated Depreciation', align: 'right' as const },
    { key: 'monthlyDepreciation', label: 'Monthly Depreciation', align: 'right' as const },
    { key: 'remainingMonths', label: 'Remaining Months', align: 'right' as const },
    { key: 'status', label: 'Status', align: 'left' as const },
  ];

  return (
    <SidebarLayout pageTitle="Assets Detail Report" pageSubtitle="One row per asset/lease">
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <div className="p-4 rounded-xl border border-[#e2e8f0] bg-white">
          <p className="text-xs text-[#64748b] uppercase mb-1">Total Assets</p>
          <p className="font-mono font-semibold text-[#f97316]">{rows.length}</p>
        </div>
        <div className="p-4 rounded-xl border border-[#e2e8f0] bg-white">
          <p className="text-xs text-[#64748b] uppercase mb-1">Total ROU Value</p>
          <p className="font-mono font-semibold text-[#f97316]">{formatReportCurrency(totalROU)}</p>
        </div>
        <div className="p-4 rounded-xl border border-[#e2e8f0] bg-white">
          <p className="text-xs text-[#64748b] uppercase mb-1">Total Accumulated Depreciation</p>
          <p className="font-mono font-semibold">{formatReportCurrency(totalAccDep)}</p>
        </div>
        <div className="p-4 rounded-xl border border-[#e2e8f0] bg-white">
          <p className="text-xs text-[#64748b] uppercase mb-1">Total NBV Today</p>
          <p className="font-mono font-semibold text-[#f97316]">{formatReportCurrency(totalNBV)}</p>
        </div>
      </div>

      <ReportSummaryBar contractCount={rows.length} totalLabel="Total NBV" totalAmount={formatReportCurrency(totalNBV)} />

      <div className="mb-2 flex justify-end">
        <Button variant="secondary" className="border border-[#e2e8f0]" onClick={handleExport}>📊 Export to Excel</Button>
      </div>

      <ReportTable
        columns={columns}
        rows={rows}
        page={page}
        onPageChange={setPage}
        totalRows={rows.length}
        emptyMessage="No Data Found"
        linkColumnKey="leaseId"
        linkHrefKey="id"
      />
    </SidebarLayout>
  );
}