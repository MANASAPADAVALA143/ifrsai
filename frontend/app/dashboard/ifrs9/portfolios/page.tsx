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
  Upload,
  FileSpreadsheet,
  FileDown,
  Plus,
} from 'lucide-react';
import {
  getEclPortfolioRepository,
  deleteEclPortfolioFromRepository,
  type ECLPortfolioEntry,
  type AssetClass,
} from '@/lib/ecl-portfolio-repository';
import { formatIndianCurrency } from '@/lib/utils';
import { ifrs9Api } from '@/lib/api';
import Link from 'next/link';
import toast from 'react-hot-toast';

function StageBadge({ stage }: { stage: 1 | 2 | 3 }) {
  const labels = { 1: 'Stage 1 — 12M ECL', 2: 'Stage 2 — Lifetime ECL', 3: 'Stage 3 — Credit Impaired' };
  const cls =
    stage === 1 ? 'bg-[#3b82f6]/15 text-[#3b82f6]' : stage === 2 ? 'bg-[#f59e0b]/15 text-[#f59e0b]' : 'bg-[#ef4444]/15 text-[#ef4444]';
  return <span className={`px-2 py-1 rounded-full text-xs font-semibold ${cls}`}>{labels[stage]}</span>;
}

const ASSET_CLASSES: AssetClass[] = [
  'Trade Receivables',
  'Loans & Advances',
  'Bonds & Securities',
  'Financial Guarantees',
  'Lease Receivables',
  'Intercompany',
  'Other',
];

export default function EclPortfoliosPage() {
  const [portfolios, setPortfolios] = useState<ECLPortfolioEntry[]>([]);
  const [search, setSearch] = useState('');
  const [filterAssetClass, setFilterAssetClass] = useState('');
  const [filterStage, setFilterStage] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterCurrency, setFilterCurrency] = useState('');
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  const load = useCallback(() => {
    setPortfolios(getEclPortfolioRepository());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = portfolios.filter((p) => {
    const q = search.toLowerCase();
    const id = p.portfolioId || p.id || '';
    const name = p.name || '';
    const counterparty = p.counterpartyName || '';
    if (q && !id.toLowerCase().includes(q) && !name.toLowerCase().includes(q) && !counterparty.toLowerCase().includes(q))
      return false;
    if (filterAssetClass && p.assetClass !== filterAssetClass) return false;
    if (filterStage && (p.stage || 1) !== Number(filterStage)) return false;
    if (filterStatus && p.status !== filterStatus) return false;
    const lastUp = p.lastUpdated || '';
    if (filterDateFrom && lastUp < filterDateFrom) return false;
    if (filterDateTo && lastUp > filterDateTo) return false;
    if (filterCurrency && p.currency !== filterCurrency) return false;
    return true;
  });

  const handleDownloadReport = async (p: ECLPortfolioEntry) => {
    setMenuOpen(null);
    const payload = {
      applicable_ecl: p.applicableEcl,
      coverage_ratio: p.coverageRatio,
      bucket_results: p.provisionMatrix?.map((r) => ({ bucket: r.bucket, amount: r.grossAmount, rate_pct: r.eclRate, ecl: r.eclAmount })),
      journal_entries: p.journalEntries,
    };
    const res = await ifrs9Api.downloadReportPost(payload);
    if (res.error || !res.data?.file_id) {
      toast.error(res.error || 'Download failed');
      return;
    }
    window.open(ifrs9Api.downloadReport(res.data.file_id), '_blank');
    toast.success('Report download started');
  };

  const handleDelete = (id: string) => {
    setMenuOpen(null);
    if (!confirm('Delete this portfolio?')) return;
    deleteEclPortfolioFromRepository(id);
    load();
    toast.success('Deleted');
  };

  return (
    <SidebarLayout pageTitle="ECL Portfolio Management" pageSubtitle="Manage IFRS 9 ECL portfolios">
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-[#1e293b]">ECL Portfolio Management</h1>
            <p className="text-sm text-[#64748b]">Portfolios and ECL calculations</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/dashboard/ifrs9/portfolios/new">
              <Button className="bg-[#f97316] hover:bg-[#ea580c] text-white">
                <Plus className="w-4 h-4 mr-2" /> New Portfolio
              </Button>
            </Link>
            <Button variant="secondary" className="border border-[#e2e8f0] bg-white">
              <Upload className="w-4 h-4 mr-2" /> Bulk Upload
            </Button>
            <Button variant="secondary" className="border border-[#e2e8f0] bg-white">
              <FileSpreadsheet className="w-4 h-4 mr-2" /> Import Excel
            </Button>
            <Button variant="secondary" className="border border-[#e2e8f0] bg-white">
              <FileDown className="w-4 h-4 mr-2" /> Export
            </Button>
          </div>
        </div>

        <div className="bg-white rounded-[14px] p-4 border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
            <div className="lg:col-span-2">
              <input
                type="text"
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full px-4 py-2 border border-[#e2e8f0] rounded-lg text-sm focus:ring-2 focus:ring-[#f97316]/30 focus:border-[#f97316]"
              />
            </div>
            <select
              value={filterAssetClass}
              onChange={(e) => setFilterAssetClass(e.target.value)}
              className="px-4 py-2 border border-[#e2e8f0] rounded-lg text-sm focus:ring-2 focus:ring-[#f97316]/30"
            >
              <option value="">Asset Class</option>
              {ASSET_CLASSES.map((ac) => (
                <option key={ac} value={ac}>{ac}</option>
              ))}
            </select>
            <select
              value={filterStage}
              onChange={(e) => setFilterStage(e.target.value)}
              className="px-4 py-2 border border-[#e2e8f0] rounded-lg text-sm focus:ring-2 focus:ring-[#f97316]/30"
            >
              <option value="">Stage</option>
              <option value="1">Stage 1</option>
              <option value="2">Stage 2</option>
              <option value="3">Stage 3</option>
            </select>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="px-4 py-2 border border-[#e2e8f0] rounded-lg text-sm focus:ring-2 focus:ring-[#f97316]/30"
            >
              <option value="">Status</option>
              <option value="Draft">Draft</option>
              <option value="Pending Review">Pending Review</option>
              <option value="Approved">Approved</option>
              <option value="Archived">Archived</option>
            </select>
            <input
              type="date"
              placeholder="Date from"
              value={filterDateFrom}
              onChange={(e) => setFilterDateFrom(e.target.value)}
              className="px-4 py-2 border border-[#e2e8f0] rounded-lg text-sm"
            />
            <input
              type="date"
              placeholder="Date to"
              value={filterDateTo}
              onChange={(e) => setFilterDateTo(e.target.value)}
              className="px-4 py-2 border border-[#e2e8f0] rounded-lg text-sm"
            />
            <select
              value={filterCurrency}
              onChange={(e) => setFilterCurrency(e.target.value)}
              className="px-4 py-2 border border-[#e2e8f0] rounded-lg text-sm"
            >
              <option value="">Currency</option>
              <option value="INR">INR</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
            </select>
          </div>
        </div>

        <div className="bg-white rounded-[14px] border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#f8fafc] border-b border-[#e2e8f0]">
                  <th className="text-left py-3 px-4 font-medium text-[#64748b]">Portfolio ID</th>
                  <th className="text-left py-3 px-4 font-medium text-[#64748b]">Name</th>
                  <th className="text-left py-3 px-4 font-medium text-[#64748b]">Asset Class</th>
                  <th className="text-left py-3 px-4 font-medium text-[#64748b]">Counterparty</th>
                  <th className="text-right py-3 px-4 font-medium text-[#64748b]">Gross</th>
                  <th className="text-right py-3 px-4 font-medium text-[#64748b]">PD %</th>
                  <th className="text-right py-3 px-4 font-medium text-[#64748b]">LGD %</th>
                  <th className="text-right py-3 px-4 font-medium text-[#64748b]">ECL</th>
                  <th className="text-right py-3 px-4 font-medium text-[#64748b]">Coverage %</th>
                  <th className="text-center py-3 px-4 font-medium text-[#64748b]">Stage</th>
                  <th className="text-center py-3 px-4 font-medium text-[#64748b]">Status</th>
                  <th className="text-right py-3 px-4 font-medium text-[#64748b]">Last Updated</th>
                  <th className="text-center py-3 px-4 font-medium text-[#64748b] w-14">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={13} className="py-12 text-center text-[#64748b]">
                      No portfolios match filters. Create a new portfolio to get started.
                    </td>
                  </tr>
                ) : (
                  filtered.map((p) => {
                    const id = p.id || p.portfolioId;
                    const gross = p.grossCarryingAmount || p.outstandingBalance || p.ead || 0;
                    const cov = gross > 0 && p.applicableEcl != null ? ((p.applicableEcl / gross) * 100).toFixed(2) : '—';
                    const lastUp = p.lastUpdated ? new Date(p.lastUpdated).toLocaleDateString() : '—';
                    return (
                      <tr
                        key={id}
                        className="border-b border-[#e2e8f0] hover:bg-[#f8fafc] cursor-pointer"
                        onClick={() => (window.location.href = `/dashboard/ifrs9/portfolios/${id}`)}
                      >
                        <td className="py-3 px-4 font-mono text-[#f97316]">
                          <Link href={`/dashboard/ifrs9/portfolios/${id}`} onClick={(e) => e.stopPropagation()}>
                            {id}
                          </Link>
                        </td>
                        <td className="py-3 px-4 text-[#1e293b]">{p.name || '—'}</td>
                        <td className="py-3 px-4 text-[#64748b]">{p.assetClass || '—'}</td>
                        <td className="py-3 px-4 text-[#64748b]">{p.counterpartyName || '—'}</td>
                        <td className="py-3 px-4 text-right font-mono">{formatIndianCurrency(gross)}</td>
                        <td className="py-3 px-4 text-right font-mono">{(p.stage === 1 ? p.pd12m : p.pdLifetime) ?? '—'}%</td>
                        <td className="py-3 px-4 text-right font-mono">{p.lgd ?? '—'}%</td>
                        <td className="py-3 px-4 text-right font-mono">{formatIndianCurrency(p.applicableEcl || 0)}</td>
                        <td className="py-3 px-4 text-right font-mono">{cov}%</td>
                        <td className="py-3 px-4 text-center">
                          <StageBadge stage={p.stage || 1} />
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className="px-2 py-1 rounded-full text-xs font-medium bg-[#e2e8f0] text-[#64748b]">{p.status || 'Draft'}</span>
                        </td>
                        <td className="py-3 px-4 text-right text-[#64748b]">{lastUp}</td>
                        <td className="py-3 px-4 relative" onClick={(e) => e.stopPropagation()}>
                          <button
                            className="p-1.5 rounded hover:bg-[#e2e8f0]"
                            onClick={(e) => { e.stopPropagation(); setMenuOpen(menuOpen === id ? null : id); }}
                          >
                            <MoreVertical className="w-4 h-4 text-[#64748b]" />
                          </button>
                          {menuOpen === id && (
                            <div className="absolute right-4 top-10 z-10 bg-white border border-[#e2e8f0] rounded-lg shadow-lg py-1 min-w-[160px]">
                              <Link href={`/dashboard/ifrs9/portfolios/${id}`}>
                                <button className="w-full px-4 py-2 text-left text-sm flex items-center gap-2 hover:bg-[#f8fafc]">
                                  <Eye className="w-4 h-4" /> View
                                </button>
                              </Link>
                              <Link href={`/dashboard/ifrs9/portfolios/${id}`}>
                                <button className="w-full px-4 py-2 text-left text-sm flex items-center gap-2 hover:bg-[#f8fafc]">
                                  <Pencil className="w-4 h-4" /> Edit
                                </button>
                              </Link>
                              <Link href={`/dashboard/ifrs9/portfolios/${id}`}>
                                <button className="w-full px-4 py-2 text-left text-sm flex items-center gap-2 hover:bg-[#f8fafc]">
                                  <RefreshCw className="w-4 h-4" /> Recalculate
                                </button>
                              </Link>
                              <button
                                onClick={() => handleDownloadReport(p)}
                                className="w-full px-4 py-2 text-left text-sm flex items-center gap-2 hover:bg-[#f8fafc]"
                              >
                                <Download className="w-4 h-4" /> Download Report
                              </button>
                              <button
                                onClick={() => handleDelete(id)}
                                className="w-full px-4 py-2 text-left text-sm flex items-center gap-2 hover:bg-red-50 text-red-600"
                              >
                                <Trash2 className="w-4 h-4" /> Delete
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </SidebarLayout>
  );
}
