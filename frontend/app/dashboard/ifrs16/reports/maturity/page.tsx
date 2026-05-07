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
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from '@/components/Charts';

const BUCKETS = [
  { key: 'y1', label: '1 Year (Months 1-12)' },
  { key: 'y1_2', label: '1 to 2 Year (Months 13-24)' },
  { key: 'y2_5', label: '2 to 5 Year (Months 25-60)' },
  { key: 'beyond', label: 'Beyond (Months 61+)' },
];
const BUCKET_COLORS = ['#f97316', '#fb923c', '#fdba74', '#fed7aa'];

export default function LiabilityMaturityReportPage() {
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

  const { rows, bucketTotals, grandTotal, chartData } = useMemo(() => {
    const bucketTotals = { y1: 0, y1_2: 0, y2_5: 0, beyond: 0 };
    const out: Record<string, React.ReactNode>[] = [];

    filtered.forEach((lease) => {
      const schedule = getSchedule(lease);
      const start = lease.start_date ?? lease.dates?.commencement;
      const startDate = start ? new Date(start) : null;
      const endStr = lease.end_date ?? lease.dates?.end;
      const endDate = endStr ? new Date(endStr) : null;
      const termMonths = lease?.dates?.term_months ?? schedule.length;
      const currency = lease?.payments?.currency ?? lease?.currency ?? 'INR';

      let y1 = 0, y1_2 = 0, y2_5 = 0, beyond = 0;
      schedule.forEach((r: any, i: number) => {
        const row = scheduleRow(r);
        const payment = Number(row.payment ?? 0);
        const periodMonth = i + 1;
        if (periodMonth <= 12) y1 += payment;
        else if (periodMonth <= 24) y1_2 += payment;
        else if (periodMonth <= 60) y2_5 += payment;
        else beyond += payment;
      });

      bucketTotals.y1 += y1;
      bucketTotals.y1_2 += y1_2;
      bucketTotals.y2_5 += y2_5;
      bucketTotals.beyond += beyond;

      out.push({
        id: lease.id ?? lease.lease_id,
        leaseNumber: lease.lease_id ?? lease.id ?? '—',
        assetId: lease.lease_id ?? lease.id ?? '—',
        leaseClassification: 'Lessee',
        assetCategory: lease.lease_type ?? '—',
        lessorName: lease.lessor ?? lease.lessor_name ?? '—',
        leaseStart: lease.start_date ?? lease.dates?.commencement ?? '—',
        leaseEnd: endStr ?? '—',
        contractDuration: `${termMonths} months`,
        y1: formatReportCurrency(y1, currency),
        y1_2: formatReportCurrency(y1_2, currency),
        y2_5: formatReportCurrency(y2_5, currency),
        beyond: formatReportCurrency(beyond, currency),
        _y1: y1, _y1_2: y1_2, _y2_5: y2_5, _beyond: beyond,
      });
    });

    const grandTotal = bucketTotals.y1 + bucketTotals.y1_2 + bucketTotals.y2_5 + bucketTotals.beyond;
    const chartData = out.length ? filtered.slice(0, 10).map((lease) => {
      const schedule = getSchedule(lease);
      let y1 = 0, y1_2 = 0, y2_5 = 0, beyond = 0;
      schedule.forEach((r: any, i: number) => {
        const payment = Number(scheduleRow(r).payment ?? 0);
        const periodMonth = i + 1;
        if (periodMonth <= 12) y1 += payment;
        else if (periodMonth <= 24) y1_2 += payment;
        else if (periodMonth <= 60) y2_5 += payment;
        else beyond += payment;
      });
      return {
        name: (lease.lease_id ?? lease.id ?? 'Lease').slice(0, 12),
        y1, y1_2, y2_5, beyond,
      };
    }) : [];

    return { rows: out, bucketTotals, grandTotal, chartData };
  }, [filtered]);

  const displayTotals = useMemo(() => ({
    y1: bucketTotals.y1,
    y1_2: bucketTotals.y1_2,
    y2_5: bucketTotals.y2_5,
    beyond: bucketTotals.beyond,
    grand: grandTotal,
  }), [bucketTotals, grandTotal]);

  const handleExport = () => {
    const headers = ['Lease Number', 'Asset ID', 'Lease Classification', 'Asset Category', 'Lessor Name', 'Lease Start Date', 'Lease End Date', 'Contract Duration', ...BUCKETS.map((b) => b.label)];
    const dataRows = rows.map((r) => [r.leaseNumber, r.assetId, r.leaseClassification, r.assetCategory, r.lessorName, r.leaseStart, r.leaseEnd, r.contractDuration, (r as any).y1, (r as any).y1_2, (r as any).y2_5, (r as any).beyond].map(String));
    dataRows.push(['TOTAL', '', '', '', '', '', '', '', formatReportCurrency(bucketTotals.y1), formatReportCurrency(bucketTotals.y1_2), formatReportCurrency(bucketTotals.y2_5), formatReportCurrency(bucketTotals.beyond)]);
    exportReportCsv('Liability Maturity Report', headers, dataRows);
  };

  const columns = [
    { key: 'leaseNumber', label: 'Lease Number', align: 'left' as const },
    { key: 'assetId', label: 'Asset ID', align: 'left' as const },
    { key: 'leaseClassification', label: 'Lease Classification', align: 'left' as const },
    { key: 'assetCategory', label: 'Asset Category', align: 'left' as const },
    { key: 'lessorName', label: 'Lessor Name', align: 'left' as const },
    { key: 'leaseStart', label: 'Lease Start Date', align: 'left' as const },
    { key: 'leaseEnd', label: 'Lease End Date', align: 'left' as const },
    { key: 'contractDuration', label: 'Contract Duration', align: 'left' as const },
    { key: 'y1', label: BUCKETS[0].label, align: 'right' as const },
    { key: 'y1_2', label: BUCKETS[1].label, align: 'right' as const },
    { key: 'y2_5', label: BUCKETS[2].label, align: 'right' as const },
    { key: 'beyond', label: BUCKETS[3].label, align: 'right' as const },
  ];

  return (
    <SidebarLayout pageTitle="Liability Maturity Report" pageSubtitle="Undiscounted cash flows by maturity bucket (IFRS 16 para 58)">
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

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <div className="p-4 rounded-xl border border-[#e2e8f0] bg-white">
          <p className="text-xs text-[#64748b] uppercase mb-1">&lt; 1 Year Total</p>
          <p className="font-mono font-semibold text-[#f97316]">{formatReportCurrency(displayTotals.y1)}</p>
        </div>
        <div className="p-4 rounded-xl border border-[#e2e8f0] bg-white">
          <p className="text-xs text-[#64748b] uppercase mb-1">1-2 Years</p>
          <p className="font-mono font-semibold">{formatReportCurrency(displayTotals.y1_2)}</p>
        </div>
        <div className="p-4 rounded-xl border border-[#e2e8f0] bg-white">
          <p className="text-xs text-[#64748b] uppercase mb-1">2-5 Years</p>
          <p className="font-mono font-semibold">{formatReportCurrency(displayTotals.y2_5)}</p>
        </div>
        <div className="p-4 rounded-xl border border-[#e2e8f0] bg-white">
          <p className="text-xs text-[#64748b] uppercase mb-1">5+ Years</p>
          <p className="font-mono font-semibold">{formatReportCurrency(displayTotals.beyond)}</p>
        </div>
        <div className="p-4 rounded-xl border border-[#e2e8f0] bg-[#fff7ed]">
          <p className="text-xs text-[#64748b] uppercase mb-1">Grand Total Commitment</p>
          <p className="font-mono font-bold text-[#f97316]">{formatReportCurrency(displayTotals.grand)}</p>
        </div>
      </div>

      <ReportSummaryBar contractCount={rows.length} totalLabel="Total commitment (undiscounted)" totalAmount={formatReportCurrency(grandTotal)} />

      {chartData.length > 0 && (
        <div className="h-64 mb-6">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 24 }} stackOffset="sign">
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `₹${(v / 100000).toFixed(0)}L`} />
              <Tooltip formatter={(value: number | string | undefined) => (value !== undefined ? formatReportCurrency(Number(value)) : '')} />
              <Bar dataKey="y1" stackId="a" fill={BUCKET_COLORS[0]} name={BUCKETS[0].label} radius={[0, 0, 0, 0]} />
              <Bar dataKey="y1_2" stackId="a" fill={BUCKET_COLORS[1]} name={BUCKETS[1].label} radius={[0, 0, 0, 0]} />
              <Bar dataKey="y2_5" stackId="a" fill={BUCKET_COLORS[2]} name={BUCKETS[2].label} radius={[0, 0, 0, 0]} />
              <Bar dataKey="beyond" stackId="a" fill={BUCKET_COLORS[3]} name={BUCKETS[3].label} radius={[4, 4, 0, 0]} />
              <Legend />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <h3 className="text-lg font-semibold text-[#1e293b] mb-2">Liability Maturity (New)</h3>
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
        linkColumnKey="leaseNumber"
        linkHrefKey="id"
      />

      {rows.length > 0 && (
        <div className="mt-4 p-4 bg-[#fff7ed] border border-[#e2e8f0] rounded-b-xl font-bold flex flex-wrap gap-4">
          <span>TOTAL</span>
          <span className="font-mono">{formatReportCurrency(bucketTotals.y1)}</span>
          <span className="font-mono">{formatReportCurrency(bucketTotals.y1_2)}</span>
          <span className="font-mono">{formatReportCurrency(bucketTotals.y2_5)}</span>
          <span className="font-mono">{formatReportCurrency(bucketTotals.beyond)}</span>
        </div>
      )}
    </SidebarLayout>
  );
}