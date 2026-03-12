'use client';

import { useState, useMemo, useEffect } from 'react';
import { SidebarLayout } from '@/components/SidebarLayout';
import { ReportFilters, defaultFilters } from '@/components/ifrs16-reports/ReportFilters';
import { ReportSummaryBar } from '@/components/ifrs16-reports/ReportSummaryBar';
import { ReportTable, PAGE_SIZE } from '@/components/ifrs16-reports/ReportTable';
import {
  getLeasesFromStorage,
  getSchedule,
  scheduleRow,
  getLiability,
  getROU,
  getMonthlyDepreciation,
  getUniqueLessees,
  getUniqueLeaseTypes,
  getUniqueStatuses,
  getUniqueLegalEntities,
  formatReportCurrency,
  getYearMonth,
} from '@/lib/reports-utils';
import { exportReportCsv } from '@/lib/export-report-csv';
import { Button } from '@/components/Button';
import Link from 'next/link';

export default function SummaryMovementReportPage() {
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

  const filterYear = filters.years[0] ? parseInt(filters.years[0], 10) : new Date().getFullYear();
  const filterMonth = filters.months[0] ? parseInt(filters.months[0], 10) : new Date().getMonth() + 1;

  const filtered = useMemo(() => {
    let list = leases.filter((l) => {
      if (filters.lessee && (l.lessee ?? l.lessee_name) !== filters.lessee) return false;
      if (filters.leaseType && l.lease_type !== filters.leaseType) return false;
      if (filters.status && (l.status ?? l.lease_status) !== filters.status) return false;
      if (filters.legalEntity && (l as any).legal_entity !== filters.legalEntity) return false;
      if (filters.contractName) {
        const name = (l.title ?? l.asset ?? l.lease_id ?? '').toLowerCase();
        if (!name.includes(filters.contractName.toLowerCase())) return false;
      }
      return true;
    });
    return list;
  }, [leases, filters]);

  const { rows, totals } = useMemo(() => {
    const out: Record<string, React.ReactNode>[] = [];
    const t: Record<string, number> = {};
    const monthStart = new Date(filterYear, filterMonth - 1, 1);
    const monthEnd = new Date(filterYear, filterMonth, 0);

    filtered.forEach((lease) => {
      const schedule = getSchedule(lease);
      const rowForMonth = schedule.find((r: any) => {
        const d = scheduleRow(r).date;
        if (!d) return false;
        const dt = new Date(d);
        return dt >= monthStart && dt <= monthEnd;
      });
      if (!rowForMonth && schedule.length === 0) return;

      const r = scheduleRow(rowForMonth || schedule[0]);
      const monthlyDep = getMonthlyDepreciation(lease);
      const periodIndex = schedule.findIndex((x: any) => scheduleRow(x).date === r.date);
      const rou = getROU(lease);
      const termMonths = lease?.dates?.term_months ?? 0;
      const accDepOpening = periodIndex >= 0 ? monthlyDep * periodIndex : 0;
      const accDepClosing = periodIndex >= 0 ? monthlyDep * (periodIndex + 1) : monthlyDep;
      const openingROU = Math.max(0, rou - accDepOpening);
      const closingROU = Math.max(0, rou - accDepClosing);
      const paymentAmt = Number(lease?.payments?.monthly ?? lease?.monthly_payment ?? 0);
      const currency = lease?.payments?.currency ?? lease?.currency ?? 'INR';

      const openLL = r.opening ?? 0;
      const interest = r.interest ?? 0;
      const payment = r.payment ?? 0;
      const closeLL = r.closing ?? 0;
      const mods = (lease.modifications || []).length;
      const movement = closeLL - openLL;

      out.push({
        id: lease.id ?? lease.lease_id,
        contract: lease.lease_id ?? lease.id ?? '—',
        legalEntity: (lease as any).legal_entity ?? '—',
        lessor: lease.lessor ?? lease.lessor_name ?? '—',
        lessee: lease.lessee ?? lease.lessee_name ?? '—',
        leaseType: lease.lease_type ?? '—',
        status: lease.status ?? lease.lease_status ?? 'Active',
        startDate: lease.start_date ?? lease.dates?.commencement ?? '—',
        endDate: lease.end_date ?? lease.dates?.end ?? '—',
        currency: currency,
        contractPayment: formatReportCurrency(paymentAmt, currency),
        openingLL: formatReportCurrency(openLL, currency),
        interest: formatReportCurrency(interest, currency),
        payment: formatReportCurrency(payment, currency),
        modification: String(mods),
        additions: '0',
        terminations: '0',
        closingLL: formatReportCurrency(closeLL, currency),
        openingROU: formatReportCurrency(openingROU, currency),
        accDepOpening: formatReportCurrency(accDepOpening, currency),
        depForPeriod: formatReportCurrency(monthlyDep, currency),
        accDepClosing: formatReportCurrency(accDepClosing, currency),
        closingROU: formatReportCurrency(closingROU, currency),
        movement: formatReportCurrency(movement, currency),
      });

      t.openingLL = (t.openingLL || 0) + openLL;
      t.interest = (t.interest || 0) + interest;
      t.payment = (t.payment || 0) + payment;
      t.closingLL = (t.closingLL || 0) + closeLL;
      t.openingROU = (t.openingROU || 0) + openingROU;
      t.accDepOpening = (t.accDepOpening || 0) + accDepOpening;
      t.depForPeriod = (t.depForPeriod || 0) + monthlyDep;
      t.accDepClosing = (t.accDepClosing || 0) + accDepClosing;
      t.closingROU = (t.closingROU || 0) + closingROU;
      t.movement = (t.movement || 0) + movement;
    });

    return { rows: out, totals: t };
  }, [filtered, filterYear, filterMonth]);

  const totalLiability = totals?.closingLL ?? 0;

  const hasPeriod = filterYear > 0 && filterMonth > 0;
  const displayRows = useMemo(() => {
    if (!totals || !hasPeriod) return rows;
    const currency = filtered[0]?.payments?.currency ?? filtered[0]?.currency ?? 'INR';
    return [
      ...rows,
      {
        id: '',
        contract: 'TOTAL',
        legalEntity: '',
        lessor: '',
        lessee: '',
        leaseType: '',
        status: '',
        startDate: '',
        endDate: '',
        currency: '',
        contractPayment: '',
        openingLL: formatReportCurrency(totals.openingLL ?? 0, currency),
        interest: formatReportCurrency(totals.interest ?? 0, currency),
        payment: formatReportCurrency(totals.payment ?? 0, currency),
        modification: '',
        additions: '',
        terminations: '',
        closingLL: formatReportCurrency(totals.closingLL ?? 0, currency),
        openingROU: formatReportCurrency(totals.openingROU ?? 0, currency),
        accDepOpening: formatReportCurrency(totals.accDepOpening ?? 0, currency),
        depForPeriod: formatReportCurrency(totals.depForPeriod ?? 0, currency),
        accDepClosing: formatReportCurrency(totals.accDepClosing ?? 0, currency),
        closingROU: formatReportCurrency(totals.closingROU ?? 0, currency),
        movement: formatReportCurrency(totals.movement ?? 0, currency),
        _isTotal: true,
      } as Record<string, React.ReactNode>,
    ];
  }, [rows, totals, hasPeriod, filtered]);

  const handleExport = () => {
    const headers = [
      'Contract #', 'Legal Entity', 'Lessor', 'Lessee', 'Lease Type', 'Status', 'Start Date', 'End Date', 'Currency', 'Contract Payment Amount',
      'Opening Lease Liability', 'Interest', 'Payment', 'Modification', 'Additions', 'Terminations', 'Closing Lease Liability',
      'Opening ROU', 'Accumulated Depreciation Opening', 'Depreciation for Period', 'Accumulated Depreciation Closing', 'Closing ROU', 'Movement',
    ];
    const dataRows = rows.map((r) => [
      r.contract, r.legalEntity, r.lessor, r.lessee, r.leaseType, r.status, r.startDate, r.endDate, r.currency,
      (r as any).contractPayment, (r as any).openingLL, (r as any).interest, (r as any).payment, (r as any).modification, (r as any).additions, (r as any).terminations,
      (r as any).closingLL, (r as any).openingROU, (r as any).accDepOpening, (r as any).depForPeriod, (r as any).accDepClosing, (r as any).closingROU, (r as any).movement,
    ].map(String));
    if (totals && Object.keys(totals).length) {
      dataRows.push([
        'TOTAL', '', '', '', '', '', '', '', '',
        '', formatReportCurrency(totals.openingLL ?? 0), formatReportCurrency(totals.interest ?? 0), formatReportCurrency(totals.payment ?? 0), '', '', formatReportCurrency(totals.closingLL ?? 0),
        formatReportCurrency(totals.openingROU ?? 0), formatReportCurrency(totals.accDepOpening ?? 0), formatReportCurrency(totals.depForPeriod ?? 0), formatReportCurrency(totals.accDepClosing ?? 0), formatReportCurrency(totals.closingROU ?? 0), formatReportCurrency(totals.movement ?? 0),
      ]);
    }
    exportReportCsv('Summary Movement Report', headers, dataRows);
  };

  const rowClassName = (row: Record<string, React.ReactNode>) => (row._isTotal ? 'bg-[#fff7ed] font-bold' : '');

  const columns = [
    { key: 'contract', label: 'Contract #', align: 'left' as const },
    { key: 'legalEntity', label: 'Legal Entity', align: 'left' as const },
    { key: 'lessor', label: 'Lessor', align: 'left' as const },
    { key: 'lessee', label: 'Lessee', align: 'left' as const },
    { key: 'leaseType', label: 'Lease Type', align: 'left' as const },
    { key: 'status', label: 'Status', align: 'left' as const },
    { key: 'startDate', label: 'Start Date', align: 'left' as const },
    { key: 'endDate', label: 'End Date', align: 'left' as const },
    { key: 'currency', label: 'Currency', align: 'left' as const },
    { key: 'contractPayment', label: 'Contract Payment Amount', align: 'right' as const },
    { key: 'openingLL', label: 'Opening Lease Liability', align: 'right' as const },
    { key: 'interest', label: 'Interest', align: 'right' as const },
    { key: 'payment', label: 'Payment', align: 'right' as const },
    { key: 'modification', label: 'Modification', align: 'right' as const },
    { key: 'additions', label: 'Additions', align: 'right' as const },
    { key: 'terminations', label: 'Terminations', align: 'right' as const },
    { key: 'closingLL', label: 'Closing Lease Liability', align: 'right' as const },
    { key: 'openingROU', label: 'Opening ROU', align: 'right' as const },
    { key: 'accDepOpening', label: 'Acc. Dep. Opening', align: 'right' as const },
    { key: 'depForPeriod', label: 'Depreciation for Period', align: 'right' as const },
    { key: 'accDepClosing', label: 'Acc. Dep. Closing', align: 'right' as const },
    { key: 'closingROU', label: 'Closing ROU', align: 'right' as const },
    { key: 'movement', label: 'Movement', align: 'right' as const },
  ];

  return (
    <SidebarLayout pageTitle="Summary Movement Report" pageSubtitle="Shows lease liability and ROU movement for selected period across all leases">
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
        yearOptions={Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - 2 + i)}
        monthOptions={Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: new Date(2000, i, 1).toLocaleString('default', { month: 'short' }) }))}
        onClearPeriods={() => setFilters({ ...filters, years: [], months: [] })}
        onExportExcel={handleExport}
        showYearMonth={true}
        showContractSearch={true}
      />

      <ReportSummaryBar
        contractCount={rows.length}
        totalLabel="Total Closing Liability"
        totalAmount={formatReportCurrency(totalLiability)}
        statusCounts={[{ label: 'Active', count: filtered.filter((l) => (l.status ?? l.lease_status) === 'Active').length }]}
        typeCounts={leaseTypes.slice(0, 3).map((t) => ({ label: t, count: filtered.filter((l) => l.lease_type === t).length }))}
      />

      <div className="mb-2 flex justify-end">
        <Button variant="secondary" className="border border-[#e2e8f0]" onClick={handleExport}>📊 Export to Excel</Button>
      </div>

      {!hasPeriod && (
        <div className="mb-4 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
          Year and Month are required. Select a year and month above to generate the report.
        </div>
      )}

      <ReportTable
        columns={columns}
        rows={hasPeriod ? displayRows : []}
        page={page}
        onPageChange={setPage}
        totalRows={displayRows.length}
        emptyMessage="No Data Found. Select Year and Month (required) and apply filters."
        freezeColumns={4}
        linkColumnKey="contract"
        linkHrefKey="id"
        rowClassName={(row) => (row._isTotal ? 'bg-[#fff7ed] font-bold' : '')}
      />
    </SidebarLayout>
  );
}
