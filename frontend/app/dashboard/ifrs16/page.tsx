'use client';

import { useState, useEffect, useCallback } from 'react';
import { SidebarLayout } from '@/components/SidebarLayout';
import { Button } from '@/components/Button';
import { Plus, Upload, FileBarChart, Eye, Calculator, Download, Building2, Car, Warehouse, Landmark, Store } from 'lucide-react';
import { getLeaseRepository } from '@/lib/lease-repository';
import { formatIndianCurrency } from '@/lib/utils';
import { ifrs16Api } from '@/lib/api';
import Link from 'next/link';
import toast from 'react-hot-toast';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from '@/components/Charts';

const ORANGE_SHADES = ['#f97316', '#fb923c', '#fed7aa', '#ef4444', '#fbbf24', '#f59e0b'];

function getStatus(endDate: string): { label: string; className: string } {
  const end = new Date(endDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  const diffDays = Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return { label: 'Expired', className: 'bg-red-100 text-red-700' };
  if (diffDays <= 30) return { label: 'Expiring Soon', className: 'bg-amber-100 text-amber-700' };
  return { label: 'Active', className: 'bg-green-100 text-green-700' };
}

function inferAssetType(asset: string): string {
  const a = (asset || '').toLowerCase();
  if (a.includes('office')) return 'Office';
  if (a.includes('vehicle') || a.includes('car') || a.includes('auto')) return 'Vehicle';
  if (a.includes('equipment') || a.includes('machine')) return 'Equipment';
  if (a.includes('land')) return 'Land';
  if (a.includes('retail') || a.includes('store')) return 'Retail';
  if (a.includes('building') || a.includes('site')) return 'Building';
  return 'Other';
}

function getAssetTypeIcon(type: string) {
  switch (type) {
    case 'Office': return Building2;
    case 'Vehicle': return Car;
    case 'Equipment': return Warehouse;
    case 'Land': return Landmark;
    case 'Retail': return Store;
    default: return Building2;
  }
}

export default function IFRS16DashboardPage() {
  const [leases, setLeases] = useState<any[]>([]);

  const load = useCallback(() => {
    setLeases(getLeaseRepository());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const totalActive = leases.filter((l) => {
    if (l.status === 'Active') return true;
    const end = new Date(l.end_date || l.dates?.end || '9999-12-31');
    return end >= today && l.status !== 'Expired' && l.status !== 'Draft';
  }).length;

  const expiring30 = leases.filter((l) => {
    const end = new Date(l.end_date || l.dates?.end || '9999-12-31');
    const diff = Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return diff >= 0 && diff <= 30;
  });

  const expiring90 = leases.filter((l) => {
    const end = new Date(l.end_date || l.dates?.end || '9999-12-31');
    const diff = Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return diff >= 0 && diff <= 90;
  });

  const expiring365 = leases.filter((l) => {
    const end = new Date(l.end_date || l.dates?.end || '9999-12-31');
    const diff = Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return diff >= 0 && diff <= 365;
  });

  const totalContractedValue = leases.reduce((s, l) => {
    const m = l.monthly_payment ?? l.payments?.monthly ?? 0;
    const t = l.dates?.term_months || 12;
    return s + m * t;
  }, 0);

  const totalLeaseLiability = leases.reduce((s, l) => s + (Number(l.liability) ?? Number((l.results as any)?.lease_liability) ?? 0), 0);
  const pendingCalc = leases.filter((l) => l.results == null || (l.liability == null && (l.results as any)?.lease_liability == null)).length;

  const averageLeaseValue = totalActive > 0 ? totalContractedValue / totalActive : 0;

  const typeCounts: Record<string, number> = {};
  leases.forEach((l) => {
    const t = (l.lease_type || inferAssetType(l.asset || '') || 'Other').trim() || 'Other';
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  });
  const pieData = Object.entries(typeCounts).map(([name, value]) => ({ name, value }));

  const scheduleByMonth: Record<string, number> = {};
  leases.forEach((l) => {
    const schedule = (l.results?.amortization_schedule || []) as any[];
    schedule.forEach((row: any) => {
      const dateStr = row.payment_date ?? row.Date;
      if (!dateStr) return;
      const d = new Date(dateStr);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const closing = row.closing_balance ?? row.Closing_Balance ?? 0;
      scheduleByMonth[key] = (scheduleByMonth[key] || 0) + Number(closing);
    });
  });

  const liabilityByMonth = Array.from({ length: 12 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return {
      month: d.toLocaleString('default', { month: 'short' }) + ' ' + d.getFullYear(),
      liability: scheduleByMonth[key] ?? 0,
    };
  });

  const paymentTimeline = Array.from({ length: 12 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() + i);
    const monthStart = new Date(d.getFullYear(), d.getMonth(), 1);
    let total = 0;
    leases.forEach((l) => {
      const end = new Date(l.dates?.end || '9999-12-31');
      const start = new Date(l.dates?.commencement || '2020-01-01');
      if (monthStart >= start && monthStart <= end) {
        total += l.payments?.monthly || 0;
      }
    });
    return {
      month: monthStart.toLocaleString('default', { month: 'short' }),
      payment: total,
    };
  });

  const handleDownload = (entry: any) => {
    const fid = entry.excel_file_id;
    if (!fid) {
      toast.error('No Excel file for this lease');
      return;
    }
    window.open(ifrs16Api.downloadReport(fid), '_blank');
    toast.success('Download started');
  };

  const recentLeases = [...leases].slice(0, 10);

  return (
    <SidebarLayout
      pageTitle="IFRS 16 Overview"
      pageSubtitle="Lease portfolio KPIs and analytics"
    >
      <div className="space-y-6">
        {/* Quick Actions */}
        <div className="flex flex-wrap gap-3">
          <Link href="/dashboard/ifrs16/leases/new">
            <Button variant="primary" className="bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white">
              <Plus className="w-4 h-4 mr-2" />
              Add New Lease
            </Button>
          </Link>
          <Link href="/dashboard/ifrs16/upload">
            <Button variant="secondary" className="border-border-default">
              <Upload className="w-4 h-4 mr-2" />
              Bulk Upload
            </Button>
          </Link>
          <Link href="/dashboard/reports">
            <Button variant="secondary" className="border-border-default">
              <FileBarChart className="w-4 h-4 mr-2" />
              Generate Reports
            </Button>
          </Link>
        </div>

        {/* KPI Row */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <div className="bg-white rounded-[14px] p-5 border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
            <p className="text-xs font-medium text-[#64748b] mb-1">Total Active Leases</p>
            <p className="text-2xl font-bold text-[#1e293b] font-mono">{totalActive}</p>
          </div>
          <div className="bg-white rounded-[14px] p-5 border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
            <p className="text-xs font-medium text-[#64748b] mb-1">Total Contracted Value</p>
            <p className="text-xl font-bold text-[#1e293b] font-mono">{formatIndianCurrency(totalContractedValue)}</p>
          </div>
          <div className="bg-white rounded-[14px] p-5 border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
            <p className="text-xs font-medium text-[#64748b] mb-1">Average Lease Value</p>
            <p className="text-xl font-bold text-[#1e293b] font-mono">{formatIndianCurrency(averageLeaseValue)}</p>
          </div>
          <div className="bg-white rounded-[14px] p-5 border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
            <p className="text-xs font-medium text-[#64748b] mb-1">Total Lease Liability</p>
            <p className="text-xl font-bold text-[#f97316] font-mono">{formatIndianCurrency(totalLeaseLiability)}</p>
          </div>
          <div className="bg-white rounded-[14px] p-5 border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
            <p className="text-xs font-medium text-[#64748b] mb-1">Leases Expiring</p>
            <p className="text-xl font-bold text-[#1e293b] font-mono">{expiring30.length} / {expiring90.length} / {expiring365.length}</p>
            <p className="text-xs text-[#64748b] mt-1">30 / 90 / 365 days</p>
          </div>
          <div className="bg-white rounded-[14px] p-5 border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
            <p className="text-xs font-medium text-[#64748b] mb-1">Pending Calculations</p>
            <p className="text-2xl font-bold text-[#1e293b] font-mono">{pendingCalc}</p>
          </div>
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-white rounded-[14px] p-6 border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)] lg:col-span-2">
            <h4 className="text-sm font-semibold text-[#1e293b] mb-4">Lease Liability by Month</h4>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={liabilityByMonth}>
                <defs>
                  <linearGradient id="liabilityGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f97316" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#f97316" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="#64748b" />
                <YAxis tick={{ fontSize: 11 }} stroke="#64748b" tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                <Tooltip formatter={(v: number) => [formatIndianCurrency(v), 'Liability']} />
                <Area type="monotone" dataKey="liability" stroke="#f97316" fill="url(#liabilityGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-white rounded-[14px] p-6 border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
            <h4 className="text-sm font-semibold text-[#1e293b] mb-4">Lease Type Distribution</h4>
            <ResponsiveContainer width="100%" height={240}>
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
        </div>

        <div className="bg-white rounded-[14px] p-6 border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
          <h4 className="text-sm font-semibold text-[#1e293b] mb-4">Payment Timeline (Next 12 Months)</h4>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={paymentTimeline}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="#64748b" />
              <YAxis tick={{ fontSize: 11 }} stroke="#64748b" tickFormatter={(v) => `${(v / 1e5).toFixed(1)}L`} />
              <Tooltip formatter={(v: number) => [formatIndianCurrency(v), 'Payment']} />
              <Bar dataKey="payment" fill="#f97316" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Recent Leases Table */}
        <div className="bg-white rounded-[14px] border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)] overflow-hidden">
          <div className="px-6 py-4 border-b border-[#e2e8f0] flex justify-between items-center">
            <h4 className="text-sm font-semibold text-[#1e293b]">Recent Leases</h4>
            <Link href="/dashboard/ifrs16/repository">
              <Button variant="secondary" size="sm">View All</Button>
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#f8fafc] border-b border-[#e2e8f0]">
                  <th className="text-left py-3 px-4 font-medium text-[#64748b]">Lease ID</th>
                  <th className="text-left py-3 px-4 font-medium text-[#64748b]">Title</th>
                  <th className="text-left py-3 px-4 font-medium text-[#64748b]">Type</th>
                  <th className="text-left py-3 px-4 font-medium text-[#64748b]">Start</th>
                  <th className="text-left py-3 px-4 font-medium text-[#64748b]">End</th>
                  <th className="text-right py-3 px-4 font-medium text-[#64748b]">Monthly</th>
                  <th className="text-right py-3 px-4 font-medium text-[#64748b]">Liability</th>
                  <th className="text-center py-3 px-4 font-medium text-[#64748b]">Status</th>
                  <th className="text-center py-3 px-4 font-medium text-[#64748b]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {recentLeases.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-[#64748b]">
                      No leases yet. Add a new lease to get started.
                    </td>
                  </tr>
                ) : (
                  recentLeases.map((l) => {
                    const status = getStatus(l.dates?.end || '9999-12-31');
                    const assetType = inferAssetType(l.asset || '');
                    const Icon = getAssetTypeIcon(assetType);
                    const end = new Date(l.dates?.end || '9999-12-31');
                    const diffDays = Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 24));
                    const rowBg = status.label === 'Expired' ? 'bg-red-50' : status.label === 'Expiring Soon' ? 'bg-amber-50' : '';
                    const lid = l.id || l.lease_id;
                    return (
                      <tr
                        key={lid}
                        className={`border-b border-[#e2e8f0] hover:bg-[#f8fafc] cursor-pointer ${rowBg}`}
                        onClick={() => window.location.href = `/dashboard/ifrs16/leases/${lid}`}
                      >
                        <td className="py-3 px-4 font-mono text-[#f97316] hover:underline">
                          <Link href={`/dashboard/ifrs16/leases/${lid}`} onClick={(e) => e.stopPropagation()}>
                            {lid}
                          </Link>
                        </td>
                        <td className="py-3 px-4 text-[#1e293b]">{l.title || l.asset || '—'}</td>
                        <td className="py-3 px-4">
                          <span className="inline-flex items-center gap-1 text-[#64748b]">
                            <Icon className="w-4 h-4" />
                            {l.lease_type || assetType}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-[#64748b]">{l.start_date || l.dates?.commencement || '—'}</td>
                        <td className="py-3 px-4 text-[#64748b]">{l.end_date || l.dates?.end || '—'}</td>
                        <td className="py-3 px-4 text-right font-mono text-[#1e293b]">{formatIndianCurrency(l.monthly_payment ?? l.payments?.monthly ?? 0)}</td>
                        <td className="py-3 px-4 text-right font-mono text-[#1e293b]">{formatIndianCurrency(l.liability ?? 0)}</td>
                        <td className="py-3 px-4 text-center">
                          <span className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${status.className}`}>
                            {status.label}
                          </span>
                        </td>
                        <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-center gap-1">
                            <Link href={`/dashboard/ifrs16/leases/${lid}`}>
                              <button className="p-1.5 rounded hover:bg-orange-100 text-[#64748b] hover:text-orange-600" title="View">
                                <Eye className="w-4 h-4" />
                              </button>
                            </Link>
                            <Link href={`/dashboard/ifrs16/leases/${lid}`}>
                              <button className="p-1.5 rounded hover:bg-orange-100 text-[#64748b] hover:text-orange-600" title="Recalculate">
                                <Calculator className="w-4 h-4" />
                              </button>
                            </Link>
                            <button onClick={() => handleDownload(l)} className="p-1.5 rounded hover:bg-orange-100 text-[#64748b] hover:text-orange-600" title="Download">
                              <Download className="w-4 h-4" />
                            </button>
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
