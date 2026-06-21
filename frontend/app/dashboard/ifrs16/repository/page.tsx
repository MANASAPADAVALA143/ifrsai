'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { SidebarLayout } from '@/components/SidebarLayout';
import { Button } from '@/components/Button';
import {
  Search,
  MoreVertical,
  Eye,
  Pencil,
  RefreshCw,
  Download,
  Trash2,
  FolderOpen,
  Upload,
  FileSpreadsheet,
  FileDown,
  Plus,
} from 'lucide-react';
import {
  getLeaseRepository,
  deleteLeaseFromRepository,
} from '@/lib/lease-repository';
import { findDuplicateLeaseGroups } from '@/lib/ifrs16-portfolio';
import { formatLeaseMoney, resolveLeaseCurrency } from '@/lib/ifrs16-currency';
import { ifrs16Api } from '@/lib/api';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';

function getStatus(endDate: string, entryStatus?: string): { label: string; className: string } {
  if (entryStatus === 'Draft') return { label: 'Draft', className: 'bg-gray-100 text-gray-700' };
  const end = new Date(endDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  const diffDays = Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return { label: 'Expired', className: 'bg-red-100 text-red-700' };
  if (diffDays <= 30) return { label: 'Expiring Soon', className: 'bg-amber-100 text-amber-700' };
  return { label: 'Active', className: 'bg-green-100 text-green-700' };
}

const PAGE_SIZE = 10;
const STORAGE_KEY = 'lease_repository';

function rowSelectionKey(l: any): string {
  const id = String(l.id || l.lease_id || '');
  const start = String(l.start_date || l.dates?.commencement || '');
  const end = String(l.end_date || l.dates?.end || '');
  const monthly = String(l.monthly_payment ?? l.payments?.monthly ?? '');
  const lessor = String(l.lessor || l.lessor_name || '');
  const title = String(l.title || l.asset || '');
  return [id, start, end, monthly, lessor, title].join('||');
}

export default function LeaseRepositoryPage() {
  const router = useRouter();
  const [leases, setLeases] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [filterLeaseType, setFilterLeaseType] = useState('');
  const [filterLessor, setFilterLessor] = useState('');
  const [filterLessee, setFilterLessee] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterStartFrom, setFilterStartFrom] = useState('');
  const [filterStartTo, setFilterStartTo] = useState('');
  const [filterEndFrom, setFilterEndFrom] = useState('');
  const [filterEndTo, setFilterEndTo] = useState('');
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exportingWorkbooks, setExportingWorkbooks] = useState(false);

  const load = useCallback(() => {
    setLeases(getLeaseRepository());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = leases.filter((l) => {
    const q = search.toLowerCase();
    const id = l.lease_id || l.id || '';
    const title = l.title || l.asset || '';
    const lessee = l.lessee || l.lessee_name || '';
    const lessor = l.lessor || l.lessor_name || '';
    const leaseType = l.lease_type || '';
    const start = l.start_date || l.dates?.commencement || '';
    const end = l.end_date || l.dates?.end || '9999-12-31';
    const status = getStatus(end, l.status);

    if (q && !id.toLowerCase().includes(q) && !title.toLowerCase().includes(q) && !lessee.toLowerCase().includes(q) && !lessor.toLowerCase().includes(q)) return false;
    if (filterLeaseType && leaseType !== filterLeaseType) return false;
    if (filterLessor && lessor !== filterLessor) return false;
    if (filterLessee && lessee !== filterLessee) return false;
    if (filterStatus && status.label !== filterStatus) return false;
    if (filterStartFrom && start < filterStartFrom) return false;
    if (filterStartTo && start > filterStartTo) return false;
    if (filterEndFrom && end < filterEndFrom) return false;
    if (filterEndTo && end > filterEndTo) return false;
    return true;
  });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const uniqueLeaseTypes = Array.from(new Set(leases.map((l) => l.lease_type).filter(Boolean))) as string[];
  const uniqueLessors = Array.from(new Set(leases.map((l) => l.lessor || l.lessor_name).filter(Boolean))) as string[];
  const uniqueLessees = Array.from(new Set(leases.map((l) => l.lessee || l.lessee_name).filter(Boolean))) as string[];

  const duplicateGroups = useMemo(() => findDuplicateLeaseGroups(leases), [leases]);

  const duplicateIds = useMemo(() => {
    const ids = new Set<string>();
    for (const group of duplicateGroups.values()) {
      for (const id of group) ids.add(id);
    }
    return ids;
  }, [duplicateGroups]);

  const toggleSelect = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleSelectAllOnPage = (checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const l of paginated) {
        const rowKey = rowSelectionKey(l);
        if (checked) next.add(rowKey);
        else next.delete(rowKey);
      }
      return next;
    });
  };

  const deleteRowsBySelectionKeys = (keys: Set<string>) => {
    const repo = getLeaseRepository();
    const remaining = repo.filter((e) => !keys.has(rowSelectionKey(e)));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(remaining));
  };

  const handleBulkDelete = () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} selected lease(s)? This cannot be undone.`)) return;
    deleteRowsBySelectionKeys(selectedIds);
    setSelectedIds(new Set());
    load();
    toast.success('Deleted selected leases');
  };

  const handleDownloadExcel = async (entry: any) => {
    const leaseId = String(entry.lease_id || entry.id || 'lease');
    const fid = entry.excel_file_id;
    if (fid) {
      window.open(ifrs16Api.downloadReport(fid), '_blank');
      toast.success('Download started');
      return;
    }
    const results = buildCalculationResults(entry);
    const sched = results.amortization_schedule;
    const hasSchedule = Array.isArray(sched) && sched.length > 0;
    const hasTotals = results.lease_liability != null || results.rou_asset != null;
    if (!hasSchedule && !hasTotals) {
      toast.error('No calculation results for this lease — recalculate first');
      return;
    }
    const toastId = toast.loading(`Building workbook for ${leaseId}…`);
    try {
      const blob = await ifrs16Api.exportLeaseWorkbookFromResults(leaseId, results);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `IFRS16_${leaseId}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Download started', { id: toastId });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Excel export failed', { id: toastId });
    }
  };

  const handleExportContracts = () => {
    const rows = (filtered.length > 0 ? filtered : leases).map((l) => {
      const endDate = l.end_date || l.dates?.end || '9999-12-31';
      const status = getStatus(endDate, l.status);
      const ccy = resolveLeaseCurrency(l);
      const liability = Number(l.liability ?? (l.results as { lease_liability?: number })?.lease_liability ?? 0);
      const rou = Number(l.rou ?? (l.results as { rou_asset?: number })?.rou_asset ?? 0);
      return {
        'Lease ID': l.lease_id || l.id || '',
        Title: l.title || l.asset || '',
        'Lease Type': l.lease_type || '',
        Lessee: l.lessee || l.lessee_name || '',
        Lessor: l.lessor || l.lessor_name || '',
        'Legal Entity': l.legal_entity || '',
        Currency: ccy,
        'Start Date': l.start_date || l.dates?.commencement || '',
        'End Date': l.end_date || l.dates?.end || '',
        'Monthly Payment': Number(l.monthly_payment ?? l.payments?.monthly ?? 0),
        'Lease Liability': liability,
        'ROU Asset': rou,
        Status: status.label,
        Version: l.version || 'V1',
      };
    });

    if (rows.length === 0) {
      toast.error('No leases to export');
      return;
    }

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Lease Register');
    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `IFRS16_Lease_Register_${rows.length}_leases_${stamp}.xlsx`);
    toast.success(`Exported ${rows.length} lease(s) to Excel`);
  };

  const buildCalculationResults = (entry: any): Record<string, unknown> => {
    const base = { ...((entry.results || {}) as Record<string, unknown>) };
    const leaseId = String(entry.lease_id || entry.id || 'lease');
    if (base.lease_id == null) base.lease_id = leaseId;
    if (base.lease_liability == null && entry.liability != null) base.lease_liability = entry.liability;
    if (base.rou_asset == null && entry.rou != null) base.rou_asset = entry.rou;
    if (!base.disclosure_data && entry.currency) {
      base.disclosure_data = { currency: entry.currency };
    }
    return base;
  };

  const handleExportAllWorkbooks = async (scope: 'all' | 'filtered' | 'selected' = 'all') => {
    let source = leases;
    if (scope === 'filtered') source = filtered;
    else if (scope === 'selected') {
      source = leases.filter((l) => selectedIds.has(rowSelectionKey(l)));
      if (source.length === 0) {
        toast.error('No leases selected');
        return;
      }
    }

    const payloads = source.map((l) => ({
      lease_id: String(l.lease_id || l.id || 'lease'),
      calculation_results: buildCalculationResults(l),
    }));

    if (payloads.length === 0) {
      toast.error('No leases to export');
      return;
    }

    setExportingWorkbooks(true);
    const toastId = toast.loading(`Building ${payloads.length} IFRS 16 workbooks…`);
    try {
      const { blob, exportedCount, requestedCount } = await ifrs16Api.exportAllLeaseWorkbooksZip(payloads);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `IFRS16_All_Leases_${exportedCount}_${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      const msg =
        exportedCount === requestedCount
          ? `Downloaded ZIP with ${exportedCount} full workbook(s)`
          : `Downloaded ${exportedCount} of ${requestedCount} workbooks — see _export_manifest.txt in ZIP for skips`;
      toast.success(msg, { id: toastId });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Bulk workbook export failed', { id: toastId });
    } finally {
      setExportingWorkbooks(false);
    }
  };

  const handleDelete = (entry: any) => {
    const id = String(entry.id || entry.lease_id || '');
    const key = rowSelectionKey(entry);
    setMenuOpen(null);
    if (!confirm('Delete this lease?')) return;
    deleteRowsBySelectionKeys(new Set([key]));
    const stillHasSameId = getLeaseRepository().some((e) => String(e.id || e.lease_id || '') === id);
    if (!stillHasSameId && id) {
      deleteLeaseFromRepository(id);
    }
    load();
    toast.success('Deleted');
  };

  return (
    <SidebarLayout pageTitle="Lease Repository" pageSubtitle="All lease contracts and calculations">
      <div className="space-y-6">
        {/* Header row */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-[#1e293b]">Lease Repository</h1>
            <p className="text-sm text-[#64748b]">All lease contracts and calculations</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/dashboard/ifrs16/upload">
              <Button className="bg-gradient-to-r from-[#f97316] to-[#ef4444] text-white hover:opacity-90">
                <Upload className="w-4 h-4 mr-2" /> AI Bulk Import
              </Button>
            </Link>
            <Button variant="secondary" className="border border-[#e2e8f0] bg-white">
              <FileSpreadsheet className="w-4 h-4 mr-2" /> Import Excel
            </Button>
            <Button
              variant="secondary"
              className="border border-[#e2e8f0] bg-white"
              onClick={handleExportContracts}
            >
              <FileDown className="w-4 h-4 mr-2" /> Export Register
            </Button>
            <Button
              variant="secondary"
              className="border border-[#e2e8f0] bg-white"
              onClick={() => void handleExportAllWorkbooks('all')}
              disabled={exportingWorkbooks || leases.length === 0}
            >
              <Download className="w-4 h-4 mr-2" />
              {exportingWorkbooks ? 'Building ZIP…' : 'Export All Workbooks (ZIP)'}
            </Button>
            <Link href="/dashboard/ifrs16/leases/new">
              <Button className="bg-gradient-to-r from-[#f97316] to-[#ef4444] text-white hover:opacity-90">
                <Plus className="w-4 h-4 mr-2" /> Add Contract
              </Button>
            </Link>
          </div>
        </div>

        {/* Filter bar */}
        <div className="bg-white rounded-[14px] p-4 border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-3">
            <div className="lg:col-span-2">
              <input
                type="text"
                placeholder="Search by ID, title, lessee..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="w-full px-4 py-2 border border-[#e2e8f0] rounded-lg text-sm focus:ring-2 focus:ring-[#f97316]/30 focus:border-[#f97316]"
              />
            </div>
            <div>
              <select
                value={filterLeaseType}
                onChange={(e) => { setFilterLeaseType(e.target.value); setPage(1); }}
                className="w-full px-4 py-2 border border-[#e2e8f0] rounded-lg text-sm focus:ring-2 focus:ring-[#f97316]/30"
              >
                <option value="">Lease Type</option>
                {uniqueLeaseTypes.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <select
                value={filterLessor}
                onChange={(e) => { setFilterLessor(e.target.value); setPage(1); }}
                className="w-full px-4 py-2 border border-[#e2e8f0] rounded-lg text-sm focus:ring-2 focus:ring-[#f97316]/30"
              >
                <option value="">Lessor</option>
                {uniqueLessors.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <select
                value={filterLessee}
                onChange={(e) => { setFilterLessee(e.target.value); setPage(1); }}
                className="w-full px-4 py-2 border border-[#e2e8f0] rounded-lg text-sm focus:ring-2 focus:ring-[#f97316]/30"
              >
                <option value="">Lessee</option>
                {uniqueLessees.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <select
                value={filterStatus}
                onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
                className="w-full px-4 py-2 border border-[#e2e8f0] rounded-lg text-sm focus:ring-2 focus:ring-[#f97316]/30"
              >
                <option value="">Status</option>
                <option value="Active">Active</option>
                <option value="Expiring Soon">Expiring Soon</option>
                <option value="Expired">Expired</option>
                <option value="Draft">Draft</option>
              </select>
            </div>
            <div>
              <input
                type="date"
                placeholder="Start from"
                value={filterStartFrom}
                onChange={(e) => { setFilterStartFrom(e.target.value); setPage(1); }}
                className="w-full px-4 py-2 border border-[#e2e8f0] rounded-lg text-sm"
              />
            </div>
            <div>
              <input
                type="date"
                placeholder="End to"
                value={filterEndTo}
                onChange={(e) => { setFilterEndTo(e.target.value); setPage(1); }}
                className="w-full px-4 py-2 border border-[#e2e8f0] rounded-lg text-sm"
              />
            </div>
          </div>
        </div>

        {duplicateGroups.size > 0 && (
          <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-sm">
            <p className="font-medium">Possible duplicate detected</p>
            <p className="mt-1">
              {duplicateGroups.size} group(s) share the same asset description, commencement date, and lessee. Review
              before calculating — same asset and commencement date exists in another record.
            </p>
            <ul className="mt-2 list-disc list-inside text-amber-800">
              {[...duplicateGroups.entries()].slice(0, 5).map(([key, ids]) => (
                <li key={key}>
                  {ids.join(', ')}
                </li>
              ))}
            </ul>
          </div>
        )}

        {selectedIds.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 p-3 rounded-lg bg-[#f8fafc] border border-[#e2e8f0]">
            <span className="text-sm text-[#64748b]">{selectedIds.size} selected</span>
            <Button
              variant="secondary"
              className="border border-[#e2e8f0] bg-white"
              onClick={() => void handleExportAllWorkbooks('selected')}
              disabled={exportingWorkbooks}
            >
              <Download className="w-4 h-4 mr-2" />
              Export selected workbooks (ZIP)
            </Button>
            <Button
              variant="secondary"
              className="border border-red-200 text-red-700 hover:bg-red-50"
              onClick={handleBulkDelete}
            >
              <Trash2 className="w-4 h-4 mr-2" /> Delete selected
            </Button>
            <button
              type="button"
              className="text-sm text-[#64748b] hover:text-[#1e293b]"
              onClick={() => setSelectedIds(new Set())}
            >
              Clear selection
            </button>
          </div>
        )}

        {/* Table */}
        <div className="bg-white rounded-[14px] border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)] overflow-hidden">
          {filtered.length === 0 ? (
            <div className="p-12 text-center">
              <FolderOpen className="w-16 h-16 text-[#94a3b8] mx-auto mb-4" />
              <p className="text-[#64748b]">No leases yet. Add your first lease to get started.</p>
              <Link href="/dashboard/ifrs16/leases/new">
                <Button className="mt-4 bg-[#f97316] hover:bg-[#ea580c] text-white">Add Contract</Button>
              </Link>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#f8fafc] border-b border-[#e2e8f0]">
                      <th className="py-3 px-3 w-10">
                        <input
                          type="checkbox"
                          aria-label="Select all on page"
                            checked={paginated.length > 0 && paginated.every((l) => selectedIds.has(rowSelectionKey(l)))}
                          onChange={(e) => toggleSelectAllOnPage(e.target.checked)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </th>
                      <th className="text-left py-3 px-4 text-xs font-semibold text-[#64748b] uppercase">Lease ID</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold text-[#64748b] uppercase">Title</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold text-[#64748b] uppercase">Lease Type</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold text-[#64748b] uppercase">Lessee</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold text-[#64748b] uppercase">Currency</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold text-[#64748b] uppercase">Start Date</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold text-[#64748b] uppercase">End Date</th>
                      <th className="text-right py-3 px-4 text-xs font-semibold text-[#64748b] uppercase">Monthly Payment</th>
                      <th className="text-right py-3 px-4 text-xs font-semibold text-[#64748b] uppercase">Lease Liability</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold text-[#64748b] uppercase">Status</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold text-[#64748b] uppercase">Version</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold text-[#64748b] uppercase w-12">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map((l, idx) => {
                      const id = l.id || l.lease_id;
                      const endDate = l.end_date || l.dates?.end || '9999-12-31';
                      const status = getStatus(endDate, l.status);
                      const version = l.version || 'V1';
                      const menuId = `menu-${id}`;
                      const isDupe = duplicateIds.has(String(id));
                      return (
                        <tr
                          key={`${id}-${l.calculated_at || l.start_date || ''}-${idx}`}
                          className={`border-b border-[#e2e8f0] hover:bg-[#f8fafc] cursor-pointer ${
                            isDupe ? 'bg-amber-50/60' : ''
                          }`}
                          onClick={() => router.push(`/dashboard/ifrs16/leases/${id}`)}
                        >
                          <td className="py-3 px-3" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selectedIds.has(rowSelectionKey(l))}
                              onChange={(e) => toggleSelect(rowSelectionKey(l), e.target.checked)}
                              aria-label={`Select ${id}`}
                            />
                          </td>
                          <td className="py-3 px-4">
                            <Link
                              href={`/dashboard/ifrs16/leases/${id}`}
                              className="text-[#f97316] font-medium hover:underline font-mono"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {id}
                            </Link>
                          </td>
                          <td className="py-3 px-4 text-[#1e293b]">{l.title || l.asset || '—'}</td>
                          <td className="py-3 px-4 text-[#64748b]">{l.lease_type || '—'}</td>
                          <td className="py-3 px-4 text-[#64748b]">{l.lessee || l.lessee_name || '—'}</td>
                          <td className="py-3 px-4 text-[#64748b] font-mono text-xs">{resolveLeaseCurrency(l)}</td>
                          <td className="py-3 px-4 text-[#64748b]">{l.start_date || l.dates?.commencement || '—'}</td>
                          <td className="py-3 px-4 text-[#64748b]">{l.end_date || l.dates?.end || '—'}</td>
                          <td className="py-3 px-4 text-right font-mono text-[#1e293b]">
                            {formatLeaseMoney(l.monthly_payment ?? l.payments?.monthly ?? 0, resolveLeaseCurrency(l))}
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-[#1e293b]">
                            {formatLeaseMoney(l.liability ?? 0, resolveLeaseCurrency(l))}
                          </td>
                          <td className="py-3 px-4">
                            <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${status.className}`}>
                              {status.label}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-700">
                              {version}
                            </span>
                          </td>
                          <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                            <div className="relative">
                              <button
                                onClick={(e) => { e.stopPropagation(); setMenuOpen(menuOpen === menuId ? null : menuId); }}
                                className="p-1.5 rounded hover:bg-[#e2e8f0] text-[#64748b]"
                              >
                                <MoreVertical className="w-4 h-4" />
                              </button>
                              {menuOpen === menuId && (
                                <>
                                  <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(null)} />
                                  <div className="absolute right-0 top-full mt-1 py-1 bg-white border border-[#e2e8f0] rounded-lg shadow-lg z-20 min-w-[160px]">
                                    <Link href={`/dashboard/ifrs16/leases/${id}`}>
                                      <button className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[#1e293b] hover:bg-[#f8fafc]">
                                        <Eye className="w-4 h-4" /> View
                                      </button>
                                    </Link>
                                    <Link href={`/dashboard/ifrs16/leases/${id}`}>
                                      <button className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[#1e293b] hover:bg-[#f8fafc]">
                                        <Pencil className="w-4 h-4" /> Edit
                                      </button>
                                    </Link>
                                    <Link href={`/dashboard/ifrs16/leases/${id}`}>
                                      <button className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[#1e293b] hover:bg-[#f8fafc]">
                                        <RefreshCw className="w-4 h-4" /> Recalculate
                                      </button>
                                    </Link>
                                    <button
                                      onClick={() => void handleDownloadExcel(l)}
                                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[#1e293b] hover:bg-[#f8fafc]"
                                    >
                                      <Download className="w-4 h-4" /> Download Excel
                                    </button>
                                    <button
                                      onClick={() => handleDelete(l)}
                                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                                    >
                                      <Trash2 className="w-4 h-4" /> Delete
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-[#e2e8f0]">
                  <p className="text-sm text-[#64748b]">
                    Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
                  </p>
                  <div className="flex gap-2">
                    <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                      Previous
                    </Button>
                    <span className="flex items-center px-2 text-sm text-[#64748b]">
                      Page {page} of {totalPages}
                    </span>
                    <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </SidebarLayout>
  );
}
