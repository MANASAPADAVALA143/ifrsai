'use client';

import { useState, useEffect, useCallback } from 'react';
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
import { getLeaseRepository, deleteLeaseFromRepository } from '@/lib/lease-repository';
import { formatIndianCurrency } from '@/lib/utils';
import { ifrs16Api } from '@/lib/api';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';

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

  const handleDownloadExcel = (entry: any) => {
    const fid = entry.excel_file_id;
    if (!fid) {
      toast.error('No Excel file for this lease');
      return;
    }
    window.open(ifrs16Api.downloadReport(fid), '_blank');
    toast.success('Download started');
  };

  const handleDelete = (id: string) => {
    setMenuOpen(null);
    if (!confirm('Delete this lease?')) return;
    deleteLeaseFromRepository(id);
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
            <Button variant="secondary" className="border border-[#e2e8f0] bg-white">
              <FileDown className="w-4 h-4 mr-2" /> Export Contracts
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
                      <th className="text-left py-3 px-4 text-xs font-semibold text-[#64748b] uppercase">Lease ID</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold text-[#64748b] uppercase">Title</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold text-[#64748b] uppercase">Lease Type</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold text-[#64748b] uppercase">Lessee</th>
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
                    {paginated.map((l) => {
                      const id = l.id || l.lease_id;
                      const endDate = l.end_date || l.dates?.end || '9999-12-31';
                      const status = getStatus(endDate, l.status);
                      const version = l.version || 'V1';
                      const menuId = `menu-${id}`;
                      return (
                        <tr
                          key={id}
                          className="border-b border-[#e2e8f0] hover:bg-[#f8fafc] cursor-pointer"
                          onClick={() => router.push(`/dashboard/ifrs16/leases/${id}`)}
                        >
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
                          <td className="py-3 px-4 text-[#64748b]">{l.start_date || l.dates?.commencement || '—'}</td>
                          <td className="py-3 px-4 text-[#64748b]">{l.end_date || l.dates?.end || '—'}</td>
                          <td className="py-3 px-4 text-right font-mono text-[#1e293b]">
                            {formatIndianCurrency(l.monthly_payment ?? l.payments?.monthly ?? 0)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-[#1e293b]">
                            {formatIndianCurrency(l.liability ?? 0)}
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
                                      onClick={() => handleDownloadExcel(l)}
                                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[#1e293b] hover:bg-[#f8fafc]"
                                    >
                                      <Download className="w-4 h-4" /> Download Excel
                                    </button>
                                    <button
                                      onClick={() => handleDelete(id)}
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
