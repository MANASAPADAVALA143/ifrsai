'use client';

import { useState, useMemo, useEffect } from 'react';
import { SidebarLayout } from '@/components/SidebarLayout';
import { ReportFilters, defaultFilters } from '@/components/ifrs16-reports/ReportFilters';
import { ReportSummaryBar } from '@/components/ifrs16-reports/ReportSummaryBar';
import { ReportTable } from '@/components/ifrs16-reports/ReportTable';
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

type GroupBy = 'lease' | 'month' | 'lessee';

export default function PaymentDetailReportPage() {
  const [filters, setFilters] = useState(defaultFilters);
  const [page, setPage] = useState(1);
  const [leases, setLeases] = useState<any[]>([]);
  const [groupBy, setGroupBy] = useState<GroupBy>('lease');

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
      if (filters.years.length && filters.years.length > 0) {
        const y = filters.years[0];
        // filter by year if needed
      }
      if (filters.months.length && filters.months.length > 0) {
        const m = filters.months[0];
      }
      return true;
    });
  }, [leases, filters]);

  const rows = useMemo(() => {
    const out: Record<string, React.ReactNode>[] = [];
    filtered.forEach((lease) => {
      const schedule = getSchedule(lease);
      const currency = lease?.payments?.currency ?? lease?.currency ?? 'INR';
      let cumPay = 0;
      schedule.forEach((r: any) => {
        const row = scheduleRow(r);
        const payment = Number(row.payment ?? 0);
        const principal = Number(row.principal ?? 0);
        const interest = Number(row.interest ?? 0);
        const closing = Number(row.closing ?? 0);
        cumPay += payment;
        out.push({
          id: lease.id ?? lease.lease_id,
          contract: lease.lease_id ?? lease.id ?? '—',
          contractName: lease.title ?? lease.asset ?? '—',
          lessee: lease.lessee ?? lease.lessee_name ?? '—',
          lessor: lease.lessor ?? lease.lessor_name ?? '—',
          leaseType: lease.lease_type ?? '—',
          currency,
          paymentDate: row.date ?? '—',
          paymentAmount: formatReportCurrency(payment, currency),
          leaseComponent: formatReportCurrency(payment, currency),
          nonLeaseComponent: formatReportCurrency(0, currency),
          principal: formatReportCurrency(principal, currency),
          interest: formatReportCurrency(interest, currency),
          cumulativePayments: formatReportCurrency(cumPay, currency),
          outstandingBalance: formatReportCurrency(closing, currency),
        });
      });
    });
    return out;
  }, [filtered]);

  const handleExport = () => {
    const headers = ['Contract #', 'Contract Name', 'Lessee', 'Lessor', 'Lease Type', 'Currency', 'Payment Date', 'Payment Amount', 'Lease Component', 'Non-Lease Component', 'Principal', 'Interest', 'Cumulative Payments', 'Outstanding Balance'];
    const dataRows = rows.map((r) => [r.contract, r.contractName, r.lessee, r.lessor, r.leaseType, r.currency, r.paymentDate, (r as any).paymentAmount, (r as any).leaseComponent, (r as any).nonLeaseComponent, (r as any).principal, (r as any).interest, (r as any).cumulativePayments, (r as any).outstandingBalance].map(String));
    exportReportCsv('Payment Detail Report', headers, dataRows);
  };

  const columns = [
    { key: 'contract', label: 'Contract #', align: 'left' as const },
    { key: 'contractName', label: 'Contract Name', align: 'left' as const },
    { key: 'lessee', label: 'Lessee', align: 'left' as const },
    { key: 'lessor', label: 'Lessor', align: 'left' as const },
    { key: 'leaseType', label: 'Lease Type', align: 'left' as const },
    { key: 'currency', label: 'Currency', align: 'left' as const },
    { key: 'paymentDate', label: 'Payment Date', align: 'left' as const },
    { key: 'paymentAmount', label: 'Payment Amount', align: 'right' as const },
    { key: 'leaseComponent', label: 'Lease Component', align: 'right' as const },
    { key: 'nonLeaseComponent', label: 'Non-Lease Component', align: 'right' as const },
    { key: 'principal', label: 'Principal', align: 'right' as const },
    { key: 'interest', label: 'Interest', align: 'right' as const },
    { key: 'cumulativePayments', label: 'Cumulative Payments', align: 'right' as const },
    { key: 'outstandingBalance', label: 'Outstanding Balance', align: 'right' as const },
  ];

  return (
    <SidebarLayout pageTitle="Payment Detail Report" pageSubtitle="Shows every individual payment across all leases">
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
        showYearMonth={true}
        showContractSearch={true}
      />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-sm text-[#64748b]">Grouping:</span>
        {(['lease', 'month', 'lessee'] as const).map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => setGroupBy(g)}
            className={`px-3 py-1.5 rounded text-sm font-medium ${groupBy === g ? 'bg-[#f97316] text-white' : 'bg-white border border-[#e2e8f0] text-[#64748b]'}`}
          >
            {g === 'lease' ? 'By Lease' : g === 'month' ? 'By Month' : 'By Lessee'}
          </button>
        ))}
      </div>

      <ReportSummaryBar contractCount={rows.length} totalLabel="Total payments (count)" totalAmount={String(rows.length)} />

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
        linkColumnKey="contract"
        linkHrefKey="id"
      />
    </SidebarLayout>
  );
}
