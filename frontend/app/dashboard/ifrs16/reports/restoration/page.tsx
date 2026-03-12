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

export default function RestorationScheduleReportPage() {
  const [filters, setFilters] = useState(defaultFilters);
  const [page, setPage] = useState(1);
  const [leases, setLeases] = useState<any[]>([]);
  const [subTab, setSubTab] = useState<'rc' | 'rou'>('rc');

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

  const withRestoration = useMemo(() => {
    return filtered.filter((l) => {
      const rc = parseFloat(String((l as any).restorationCost ?? (l as any).restoration_cost ?? '0')) || 0;
      return rc > 0;
    });
  }, [filtered]);

  const rows = useMemo(() => {
    const out: Record<string, React.ReactNode>[] = [];
    withRestoration.forEach((lease) => {
      const rc = parseFloat(String((lease as any).restorationCost ?? (lease as any).restoration_cost ?? '0')) || 0;
      const ibrPct = parseFloat(String(lease?.discount_rate ?? '0')) || 0;
      const pvRC = rc;
      const unwinding = rc * (ibrPct / 100) / 12;
      out.push({
        id: lease.id ?? lease.lease_id,
        contract: lease.lease_id ?? lease.id ?? '—',
        asset: lease.title ?? lease.asset ?? '—',
        lessee: lease.lessee ?? lease.lessee_name ?? '—',
        initialRC: formatReportCurrency(rc),
        discountRate: ibrPct ? ibrPct + '%' : '—',
        pvRC: formatReportCurrency(pvRC),
        openingProvision: formatReportCurrency(rc),
        unwinding: formatReportCurrency(unwinding),
        additional: formatReportCurrency(0),
        utilisation: formatReportCurrency(0),
        closingProvision: formatReportCurrency(rc + unwinding),
      });
    });
    return out;
  }, [withRestoration]);

  const handleExport = () => {
    const headers = ['Contract #', 'Asset', 'Lessee', 'Initial RC', 'Discount Rate', 'PV of RC', 'Opening Provision', 'Unwinding', 'Additional', 'Utilisation', 'Closing Provision'];
    const dataRows = rows.map((r) => [r.contract, r.asset, r.lessee, (r as any).initialRC, (r as any).discountRate, (r as any).pvRC, (r as any).openingProvision, (r as any).unwinding, (r as any).additional, (r as any).utilisation, (r as any).closingProvision].map(String));
    exportReportCsv('RC Schedule Report', headers, dataRows);
  };

  const columns = [
    { key: 'contract', label: 'Contract #', align: 'left' as const },
    { key: 'asset', label: 'Asset', align: 'left' as const },
    { key: 'lessee', label: 'Lessee', align: 'left' as const },
    { key: 'initialRC', label: 'Initial RC', align: 'right' as const },
    { key: 'discountRate', label: 'Discount Rate', align: 'right' as const },
    { key: 'pvRC', label: 'PV of RC', align: 'right' as const },
    { key: 'openingProvision', label: 'Opening Provision', align: 'right' as const },
    { key: 'unwinding', label: 'Unwinding', align: 'right' as const },
    { key: 'additional', label: 'Additional', align: 'right' as const },
    { key: 'utilisation', label: 'Utilisation', align: 'right' as const },
    { key: 'closingProvision', label: 'Closing Provision', align: 'right' as const },
  ];

  return (
    <SidebarLayout pageTitle="RC Schedule Report" pageSubtitle="Restoration cost provision unwinding schedule">
      <div className="mb-4 flex justify-end">
        <Link href="/dashboard/ifrs16/reports">
          <Button variant="secondary" className="border border-[#e2e8f0]">Back to Reports</Button>
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
        <button type="button" onClick={() => setSubTab('rc')} className={'px-3 py-1.5 rounded text-sm font-medium ' + (subTab === 'rc' ? 'bg-[#f97316] text-white' : 'bg-white border border-[#e2e8f0]')}>
          RC Schedule
        </button>
        <button type="button" onClick={() => setSubTab('rou')} className={'px-3 py-1.5 rounded text-sm font-medium ' + (subTab === 'rou' ? 'bg-[#f97316] text-white' : 'bg-white border border-[#e2e8f0]')}>
          RC ROU Schedule
        </button>
      </div>

      <ReportSummaryBar contractCount={rows.length} totalLabel="Leases with restoration" totalAmount={String(rows.length)} />

      {withRestoration.length === 0 ? (
        <div className="py-12 text-center text-[#64748b] border border-[#e2e8f0] rounded-xl bg-white">
          No leases with restoration obligations. Add restoration cost on a lease to see data here.
        </div>
      ) : (
        <>
          <div className="mb-2 flex justify-end">
            <Button variant="secondary" className="border border-[#e2e8f0]" onClick={handleExport}>Export to Excel</Button>
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
        </>
      )}
    </SidebarLayout>
  );
}
