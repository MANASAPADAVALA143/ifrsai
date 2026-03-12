'use client';

import { useState, useMemo, useEffect } from 'react';
import { SidebarLayout } from '@/components/SidebarLayout';
import { ReportFilters, defaultFilters } from '@/components/ifrs16-reports/ReportFilters';
import { ReportSummaryBar } from '@/components/ifrs16-reports/ReportSummaryBar';
import { ReportTable } from '@/components/ifrs16-reports/ReportTable';
import {
  getLeasesFromStorage,
  getUniqueLessees,
  getUniqueLeaseTypes,
  getUniqueStatuses,
  getUniqueLegalEntities,
  formatReportCurrency,
} from '@/lib/reports-utils';
import { exportReportCsv } from '@/lib/export-report-csv';
import { Button } from '@/components/Button';
import Link from 'next/link';

export default function LeaseExpiryReportPage() {
  const [filters, setFilters] = useState(defaultFilters);
  const [page, setPage] = useState(1);
  const [leases, setLeases] = useState<any[]>([]);
  const [expiryFilter, setExpiryFilter] = useState<string | null>(null);

  useEffect(() => {
    setLeases(getLeasesFromStorage());
  }, []);

  const lessees = useMemo(() => getUniqueLessees(leases), [leases]);
  const leaseTypes = useMemo(() => getUniqueLeaseTypes(leases), [leases]);
  const statuses = useMemo(() => getUniqueStatuses(leases), [leases]);
  const legalEntities = useMemo(() => getUniqueLegalEntities(leases), [leases]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { rows, counts } = useMemo(() => {
    const counts = { expired: 0, in30: 0, in90: 0, in1yr: 0, in2yr: 0, beyond2: 0 };
    const out: Record<string, React.ReactNode>[] = [];

    let list = leases.filter((l) => {
      if (filters.lessee && (l.lessee ?? l.lessee_name) !== filters.lessee) return false;
      if (filters.leaseType && l.lease_type !== filters.leaseType) return false;
      if (filters.status && (l.status ?? l.lease_status) !== filters.status) return false;
      if (filters.legalEntity && (l as any).legal_entity !== filters.legalEntity) return false;
      if (filters.contractName && !((l.title ?? l.asset ?? l.lease_id ?? '').toLowerCase().includes(filters.contractName.toLowerCase()))) return false;
      return true;
    });

    list.forEach((lease) => {
      const endStr = lease.end_date ?? lease.dates?.end;
      if (!endStr) return;
      const end = new Date(endStr);
      end.setHours(0, 0, 0, 0);
      const remainingDays = Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      const remainingMonths = Math.ceil(remainingDays / 30);
      const monthly = Number(lease?.payments?.monthly ?? lease?.payments?.monthly ?? 0);
      const annualRent = monthly * 12;

      let bucket = 'beyond2';
      if (remainingDays < 0) { counts.expired++; bucket = 'expired'; }
      else if (remainingDays <= 30) { counts.in30++; bucket = 'in30'; }
      else if (remainingDays <= 90) { counts.in90++; bucket = 'in90'; }
      else if (remainingDays <= 365) { counts.in1yr++; bucket = 'in1yr'; }
      else if (remainingDays <= 730) { counts.in2yr++; bucket = 'in2yr'; }
      else { counts.beyond2++; }

      out.push({
        id: lease.id ?? lease.lease_id,
        leaseId: lease.lease_id ?? lease.id ?? '—',
        contractName: lease.title ?? lease.asset ?? '—',
        asset: lease.lease_type ?? lease.asset ?? '—',
        lessee: lease.lessee ?? lease.lessee_name ?? '—',
        lessor: lease.lessor ?? lease.lessor_name ?? '—',
        startDate: lease.start_date ?? lease.dates?.commencement ?? '—',
        endDate: endStr,
        remainingDays: String(remainingDays),
        remainingMonths: String(remainingMonths),
        extensionOption: '—',
        extensionTerm: '—',
        annualRent: formatReportCurrency(annualRent),
        status: lease.status ?? lease.lease_status ?? 'Active',
        _bucket: bucket,
        _remainingDays: remainingDays,
      });
    });

    return { rows: out, counts };
  }, [leases, filters]);

  const filteredRows = useMemo(() => {
    if (!expiryFilter) return rows;
    return rows.filter((r) => (r as any)._bucket === expiryFilter);
  }, [rows, expiryFilter]);

  const handleExport = () => {
    const headers = ['Lease ID', 'Contract Name', 'Asset', 'Lessee', 'Lessor', 'Start Date', 'End Date', 'Remaining Days', 'Remaining Months', 'Extension Option', 'Extension Term', 'Annual Rent', 'Status'];
    const dataRows = filteredRows.map((r) => [r.leaseId, r.contractName, r.asset, r.lessee, r.lessor, r.startDate, r.endDate, r.remainingDays, r.remainingMonths, r.extensionOption, r.extensionTerm, (r as any).annualRent, r.status].map(String));
    exportReportCsv('Lease Expiry Report', headers, dataRows);
  };

  const columns = [
    { key: 'leaseId', label: 'Lease ID', align: 'left' as const },
    { key: 'contractName', label: 'Contract Name', align: 'left' as const },
    { key: 'asset', label: 'Asset', align: 'left' as const },
    { key: 'lessee', label: 'Lessee', align: 'left' as const },
    { key: 'lessor', label: 'Lessor', align: 'left' as const },
    { key: 'startDate', label: 'Start Date', align: 'left' as const },
    { key: 'endDate', label: 'End Date', align: 'left' as const },
    { key: 'remainingDays', label: 'Remaining Days', align: 'right' as const },
    { key: 'remainingMonths', label: 'Remaining Months', align: 'right' as const },
    { key: 'extensionOption', label: 'Extension Option', align: 'left' as const },
    { key: 'extensionTerm', label: 'Extension Term', align: 'left' as const },
    { key: 'annualRent', label: 'Annual Rent', align: 'right' as const },
    { key: 'status', label: 'Status', align: 'left' as const },
  ];

  const cardClass = (key: string) => (expiryFilter === key ? 'ring-2 ring-[#f97316] bg-[#fff7ed]' : 'bg-white hover:bg-[#f9fafb]');

  return (
    <SidebarLayout pageTitle="Lease Expiry Report" pageSubtitle="Leases by expiry timeline — renewal planning">
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

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
        {[
          { key: 'expired', label: 'Expired', count: counts.expired, color: 'text-red-600' },
          { key: 'in30', label: 'Expiring in 30 days', count: counts.in30, color: 'text-red-600' },
          { key: 'in90', label: 'Expiring in 90 days', count: counts.in90, color: 'text-amber-600' },
          { key: 'in1yr', label: 'Expiring in 1 year', count: counts.in1yr, color: 'text-orange-600' },
          { key: 'in2yr', label: 'Expiring in 2 years', count: counts.in2yr, color: 'text-[#1e293b]' },
          { key: 'beyond2', label: 'Active > 2 years', count: counts.beyond2, color: 'text-[#1e293b]' },
        ].map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setExpiryFilter(expiryFilter === c.key ? null : c.key)}
            className={`p-4 rounded-xl border border-[#e2e8f0] text-left ${cardClass(c.key)}`}
          >
            <p className={`text-xs uppercase text-[#64748b] mb-1`}>{c.label}</p>
            <p className={`font-mono font-semibold ${c.color}`}>{c.count}</p>
          </button>
        ))}
      </div>

      <ReportSummaryBar contractCount={filteredRows.length} />

      <div className="mb-2 flex justify-end">
        <Button variant="secondary" className="border border-[#e2e8f0]" onClick={handleExport}>📊 Export to Excel</Button>
      </div>

      <ReportTable
        columns={columns}
        rows={filteredRows}
        page={page}
        onPageChange={setPage}
        totalRows={filteredRows.length}
        emptyMessage="No Data Found"
        linkColumnKey="leaseId"
        linkHrefKey="id"
        rowClassName={(row) => {
          const d = (row as any)._remainingDays;
          if (d < 0) return 'bg-red-50';
          if (d <= 30) return 'text-red-600';
          if (d <= 90) return 'text-amber-600';
          if (d <= 365) return 'text-orange-600';
          return '';
        }}
      />
    </SidebarLayout>
  );
}