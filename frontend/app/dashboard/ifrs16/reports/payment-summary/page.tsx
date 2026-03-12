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

export default function PaymentSummaryReportPage() {
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

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const in30 = new Date(today);
  in30.setDate(in30.getDate() + 30);
  const in90 = new Date(today);
  in90.setDate(in90.getDate() + 90);

  const { rows, totalAnnual, paymentsThisMonth, overdueCount, upcoming30Count } = useMemo(() => {
    let totalAnnual = 0;
    let paymentsThisMonth = 0;
    let overdueCount = 0;
    let upcoming30Count = 0;
    const out: Record<string, React.ReactNode>[] = [];

    filtered.forEach((lease) => {
      const schedule = getSchedule(lease);
      const currency = lease?.payments?.currency ?? lease?.currency ?? 'INR';
      const monthly = Number(lease?.payments?.monthly ?? lease?.monthly_payment ?? 0);
      const totalPayments = schedule.reduce((s: number, r: any) => s + (scheduleRow(r).payment ?? 0), 0);
      const paymentsMade = schedule.filter((r: any) => {
        const d = scheduleRow(r).date;
        return d && new Date(d) <= today;
      }).length;
      const paymentAmt = schedule.length ? (scheduleRow(schedule[0]).payment ?? 0) : monthly;
      const nextRow = schedule.find((r: any) => new Date(scheduleRow(r).date) > today);
      const nextPaymentDate = nextRow ? scheduleRow(nextRow).date : '—';
      const nextPaymentAmount = nextRow ? formatReportCurrency(scheduleRow(nextRow).payment ?? 0, currency) : '—';
      const annualPayment = monthly * 12;
      totalAnnual += annualPayment;

      const endDate = lease.end_date ?? lease.dates?.end;
      const remaining = endDate ? Math.ceil((new Date(endDate).getTime() - today.getTime()) / (1000 * 60 * 60 * 24)) : 0;
      const isOverdue = endDate && new Date(endDate) < today;
      const expiringIn90 = endDate && remaining <= 90 && remaining > 0;
      if (isOverdue) overdueCount++;
      if (endDate && remaining > 0 && remaining <= 30) upcoming30Count++;

      schedule.forEach((r: any) => {
        const d = scheduleRow(r).date;
        if (d) {
          const dt = new Date(d);
          if (dt <= today) paymentsThisMonth += dt.getMonth() === today.getMonth() && dt.getFullYear() === today.getFullYear() ? (scheduleRow(r).payment ?? 0) : 0;
        }
      });

      out.push({
        id: lease.id ?? lease.lease_id,
        contract: lease.lease_id ?? lease.id ?? '—',
        contractName: lease.title ?? lease.asset ?? '—',
        lessee: lease.lessee ?? lease.lessee_name ?? '—',
        assetClass: lease.lease_type ?? '—',
        currency,
        totalPayments: formatReportCurrency(totalPayments, currency),
        paymentsMade: String(paymentsMade),
        paymentsRemaining: String(schedule.length - paymentsMade),
        nextPaymentDate,
        nextPaymentAmount,
        annualPayment: formatReportCurrency(annualPayment, currency),
        status: lease.status ?? lease.lease_status ?? 'Active',
        _isOverdue: isOverdue,
        _expiringIn90: expiringIn90 && !isOverdue,
      });
    });

    return { rows: out, totalAnnual, paymentsThisMonth, overdueCount, upcoming30Count };
  }, [filtered]);

  const handleExport = () => {
    const headers = ['Contract #', 'Contract Name', 'Lessee', 'Asset Class', 'Currency', 'Total Payments', 'Payments Made', 'Payments Remaining', 'Next Payment Date', 'Next Payment Amount', 'Annual Payment', 'Status'];
    const dataRows = rows.map((r) => [r.contract, r.contractName, r.lessee, r.assetClass, r.currency, (r as any).totalPayments, (r as any).paymentsMade, (r as any).paymentsRemaining, r.nextPaymentDate, r.nextPaymentAmount, (r as any).annualPayment, r.status].map(String));
    exportReportCsv('Payment Summary Report', headers, dataRows);
  };

  const columns = [
    { key: 'contract', label: 'Contract #', align: 'left' as const },
    { key: 'contractName', label: 'Contract Name', align: 'left' as const },
    { key: 'lessee', label: 'Lessee', align: 'left' as const },
    { key: 'assetClass', label: 'Asset Class', align: 'left' as const },
    { key: 'currency', label: 'Currency', align: 'left' as const },
    { key: 'totalPayments', label: 'Total Payments', align: 'right' as const },
    { key: 'paymentsMade', label: 'Payments Made', align: 'right' as const },
    { key: 'paymentsRemaining', label: 'Payments Remaining', align: 'right' as const },
    { key: 'nextPaymentDate', label: 'Next Payment Date', align: 'left' as const },
    { key: 'nextPaymentAmount', label: 'Next Payment Amount', align: 'right' as const },
    { key: 'annualPayment', label: 'Annual Payment', align: 'right' as const },
    { key: 'status', label: 'Status', align: 'left' as const },
  ];

  return (
    <SidebarLayout pageTitle="Payment Summary Report" pageSubtitle="One row per lease, summarized">
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
          <p className="text-xs text-[#64748b] uppercase mb-1">Total Annual Commitments</p>
          <p className="font-mono font-semibold text-[#f97316]">{formatReportCurrency(totalAnnual)}</p>
        </div>
        <div className="p-4 rounded-xl border border-[#e2e8f0] bg-white">
          <p className="text-xs text-[#64748b] uppercase mb-1">Payments This Month</p>
          <p className="font-mono font-semibold text-[#f97316]">{formatReportCurrency(paymentsThisMonth)}</p>
        </div>
        <div className="p-4 rounded-xl border border-[#e2e8f0] bg-white">
          <p className="text-xs text-[#64748b] uppercase mb-1">Overdue Payments</p>
          <p className="font-mono font-semibold">{overdueCount}</p>
        </div>
        <div className="p-4 rounded-xl border border-[#e2e8f0] bg-white">
          <p className="text-xs text-[#64748b] uppercase mb-1">Upcoming (30 days)</p>
          <p className="font-mono font-semibold">{upcoming30Count}</p>
        </div>
      </div>

      <ReportSummaryBar contractCount={rows.length} totalLabel="Leases" totalAmount={String(rows.length)} />

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
        rowClassName={(row) => {
          if ((row as any)._isOverdue) return 'bg-amber-50';
          if ((row as any)._expiringIn90) return 'bg-[#fff7ed]';
          return '';
        }}
      />
    </SidebarLayout>
  );
}