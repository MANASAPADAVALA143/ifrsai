'use client';

import { useState, useEffect, useCallback } from 'react';
import { SidebarLayout } from '@/components/SidebarLayout';
import { Button } from '@/components/Button';
import { Plus, Upload, FileBarChart, Eye, Calculator, Download } from 'lucide-react';
import { getEclPortfolioRepository } from '@/lib/ecl-portfolio-repository';
import { formatIndianCurrency } from '@/lib/utils';
import Link from 'next/link';
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from '@/components/Charts';

const ORANGE_SHADES = ['#f97316', '#fb923c', '#fed7aa', '#ea580c', '#c2410c', '#9a3412'];
const STAGE_COLORS = { 1: '#3b82f6', 2: '#f59e0b', 3: '#ef4444' };

function StageBadge({ stage }: { stage: 1 | 2 | 3 }) {
  const labels = { 1: 'Stage 1 — 12M ECL', 2: 'Stage 2 — Lifetime ECL', 3: 'Stage 3 — Credit Impaired' };
  const cls =
    stage === 1 ? 'bg-[#3b82f6]/15 text-[#3b82f6]' : stage === 2 ? 'bg-[#f59e0b]/15 text-[#f59e0b]' : 'bg-[#ef4444]/15 text-[#ef4444]';
  return <span className={`px-2 py-1 rounded-full text-xs font-semibold ${cls}`}>{labels[stage]}</span>;
}

export default function IFRS9OverviewPage() {
  const [portfolios, setPortfolios] = useState<ReturnType<typeof getEclPortfolioRepository>>([]);

  const load = useCallback(() => {
    setPortfolios(getEclPortfolioRepository());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const totalPortfolios = portfolios.length;
  const totalGross = portfolios.reduce((s, p) => s + (p.grossCarryingAmount || p.outstandingBalance || p.ead || 0), 0);
  const totalEcl = portfolios.reduce((s, p) => s + (p.applicableEcl || 0), 0);
  const coverageRatio = totalGross > 0 ? (totalEcl / totalGross) * 100 : 0;
  const stage3Count = portfolios.filter((p) => p.stage === 3).length;
  const stage3Pct = totalPortfolios > 0 ? (stage3Count / totalPortfolios) * 100 : 0;
  const pendingReview = portfolios.filter((p) => p.status === 'Pending Review' || p.status === 'Draft').length;

  const eclByStage = portfolios.reduce(
    (acc, p) => {
      const s = p.stage || 1;
      acc[s] = (acc[s] || 0) + (p.applicableEcl || 0);
      return acc;
    },
    {} as Record<number, number>
  );
  const barChartData = [
    { name: 'Stage 1', ecl: eclByStage[1] || 0, fill: STAGE_COLORS[1] },
    { name: 'Stage 2', ecl: eclByStage[2] || 0, fill: STAGE_COLORS[2] },
    { name: 'Stage 3', ecl: eclByStage[3] || 0, fill: STAGE_COLORS[3] },
  ];

  const assetClassCounts: Record<string, number> = {};
  portfolios.forEach((p) => {
    const ac = p.assetClass || 'Other';
    assetClassCounts[ac] = (assetClassCounts[ac] || 0) + 1;
  });
  const pieData = Object.entries(assetClassCounts).map(([name, value]) => ({ name, value }));

  const trendMonths = Array.from({ length: 12 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - (11 - i));
    return d.toLocaleString('default', { month: 'short' }) + ' ' + d.getFullYear();
  });
  const trendData = trendMonths.map((month, i) => ({
    month,
    ecl: i === 11 ? totalEcl : Math.max(0, totalEcl * (0.7 + (i / 12) * 0.3)),
  }));

  const recentPortfolios = [...portfolios].slice(0, 10);

  return (
    <SidebarLayout
      pageTitle="IFRS 9 — ECL Estimation Platform"
      pageSubtitle="Automate ECL calculations and deliver audit-ready results"
    >
      <div className="space-y-6">
        {/* Quick Actions */}
        <div className="flex flex-wrap gap-3">
          <Link href="/dashboard/ifrs9/portfolios/new">
            <Button variant="primary" className="bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white">
              <Plus className="w-4 h-4 mr-2" />
              New Portfolio
            </Button>
          </Link>
          <Link href="/dashboard/ifrs9/portfolios">
            <Button variant="secondary" className="border-[#e2e8f0]">
              <Upload className="w-4 h-4 mr-2" />
              Upload Debtor Ageing
            </Button>
          </Link>
          <Link href="/dashboard/reports">
            <Button variant="secondary" className="border-[#e2e8f0]">
              <FileBarChart className="w-4 h-4 mr-2" />
              Generate Reports
            </Button>
          </Link>
        </div>

        {/* KPI Row - 6 cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <div className="bg-white rounded-[14px] p-5 border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
            <p className="text-xs font-medium text-[#64748b] mb-1">Total Portfolios</p>
            <p className="text-2xl font-bold text-[#1e293b] font-mono">{totalPortfolios}</p>
          </div>
          <div className="bg-white rounded-[14px] p-5 border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
            <p className="text-xs font-medium text-[#64748b] mb-1">Total Gross Exposure</p>
            <p className="text-xl font-bold text-[#1e293b] font-mono">{formatIndianCurrency(totalGross)}</p>
          </div>
          <div className="bg-white rounded-[14px] p-5 border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
            <p className="text-xs font-medium text-[#64748b] mb-1">Total ECL Provision</p>
            <p className="text-xl font-bold text-[#f97316] font-mono">{formatIndianCurrency(totalEcl)}</p>
          </div>
          <div className="bg-white rounded-[14px] p-5 border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
            <p className="text-xs font-medium text-[#64748b] mb-1">Coverage Ratio</p>
            <p className="text-xl font-bold text-[#1e293b] font-mono">{coverageRatio.toFixed(2)}%</p>
          </div>
          <div className="bg-white rounded-[14px] p-5 border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
            <p className="text-xs font-medium text-[#64748b] mb-1">Stage 3 Assets</p>
            <p className="text-xl font-bold text-[#1e293b] font-mono">
              {stage3Count} <span className="text-sm font-normal text-[#64748b]">({stage3Pct.toFixed(0)}%)</span>
            </p>
          </div>
          <div className="bg-white rounded-[14px] p-5 border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
            <p className="text-xs font-medium text-[#64748b] mb-1">Pending Review</p>
            <p className="text-2xl font-bold text-[#1e293b] font-mono">{pendingReview}</p>
          </div>
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-white rounded-[14px] p-6 border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
            <h4 className="text-sm font-semibold text-[#1e293b] mb-4">ECL by Stage</h4>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={barChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#64748b" />
                <YAxis tick={{ fontSize: 11 }} stroke="#64748b" tickFormatter={(v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : `${(v / 1e3).toFixed(0)}K`)} />
                <Tooltip formatter={(v: number) => [formatIndianCurrency(v), 'ECL']} />
                <Bar dataKey="ecl" fill="#f97316" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-white rounded-[14px] p-6 border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
            <h4 className="text-sm font-semibold text-[#1e293b] mb-4">Portfolio Distribution</h4>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={pieData.length ? pieData : [{ name: 'No data', value: 1 }]}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="value"
                  nameKey="name"
                >
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={ORANGE_SHADES[i % ORANGE_SHADES.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number, n: string) => [v, n]} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-white rounded-[14px] p-6 border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
            <h4 className="text-sm font-semibold text-[#1e293b] mb-4">ECL Trend</h4>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} stroke="#64748b" />
                <YAxis tick={{ fontSize: 11 }} stroke="#64748b" tickFormatter={(v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : `${(v / 1e3).toFixed(0)}K`)} />
                <Tooltip formatter={(v: number) => [formatIndianCurrency(v), 'ECL']} />
                <Line type="monotone" dataKey="ecl" stroke="#f97316" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Recent Portfolios Table */}
        <div className="bg-white rounded-[14px] border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)] overflow-hidden">
          <div className="px-6 py-4 border-b border-[#e2e8f0] flex justify-between items-center">
            <h4 className="text-sm font-semibold text-[#1e293b]">Recent Portfolios</h4>
            <Link href="/dashboard/ifrs9/portfolios">
              <Button variant="secondary" size="sm">
                View All
              </Button>
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#f8fafc] border-b border-[#e2e8f0]">
                  <th className="text-left py-3 px-4 font-medium text-[#64748b]">Portfolio ID</th>
                  <th className="text-left py-3 px-4 font-medium text-[#64748b]">Name</th>
                  <th className="text-left py-3 px-4 font-medium text-[#64748b]">Asset Class</th>
                  <th className="text-right py-3 px-4 font-medium text-[#64748b]">Gross Exposure</th>
                  <th className="text-right py-3 px-4 font-medium text-[#64748b]">ECL Amount</th>
                  <th className="text-right py-3 px-4 font-medium text-[#64748b]">Coverage %</th>
                  <th className="text-center py-3 px-4 font-medium text-[#64748b]">Stage</th>
                  <th className="text-center py-3 px-4 font-medium text-[#64748b]">Status</th>
                  <th className="text-center py-3 px-4 font-medium text-[#64748b]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {recentPortfolios.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-[#64748b]">
                      No portfolios yet. Create a new portfolio to get started.
                    </td>
                  </tr>
                ) : (
                  recentPortfolios.map((p) => {
                    const gross = p.grossCarryingAmount || p.outstandingBalance || p.ead || 0;
                    const cov = gross > 0 && p.applicableEcl != null ? ((p.applicableEcl / gross) * 100).toFixed(2) : '—';
                    const id = p.id || p.portfolioId;
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
                        <td className="py-3 px-4 text-right font-mono text-[#1e293b]">{formatIndianCurrency(gross)}</td>
                        <td className="py-3 px-4 text-right font-mono text-[#1e293b]">{formatIndianCurrency(p.applicableEcl || 0)}</td>
                        <td className="py-3 px-4 text-right font-mono text-[#1e293b]">{cov}%</td>
                        <td className="py-3 px-4 text-center">
                          <StageBadge stage={p.stage || 1} />
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className="inline-block px-2 py-1 rounded-full text-xs font-medium bg-[#e2e8f0] text-[#64748b]">
                            {p.status || 'Draft'}
                          </span>
                        </td>
                        <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-center gap-1">
                            <Link href={`/dashboard/ifrs9/portfolios/${id}`}>
                              <button className="p-1.5 rounded hover:bg-orange-100 text-[#64748b] hover:text-orange-600" title="View">
                                <Eye className="w-4 h-4" />
                              </button>
                            </Link>
                            <Link href={`/dashboard/ifrs9/portfolios/${id}`}>
                              <button className="p-1.5 rounded hover:bg-orange-100 text-[#64748b] hover:text-orange-600" title="Calculate ECL">
                                <Calculator className="w-4 h-4" />
                              </button>
                            </Link>
                          </div>
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
