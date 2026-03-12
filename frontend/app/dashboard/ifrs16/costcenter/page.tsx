'use client';

import { useState, useEffect } from 'react';
import { SidebarLayout } from '@/components/SidebarLayout';
import { Button } from '@/components/Button';
import { Plus, Trash2, Download, Link2 } from 'lucide-react';
import { getLeaseRepository } from '@/lib/lease-repository';
import { formatIndianCurrency } from '@/lib/utils';
import Link from 'next/link';
import toast from 'react-hot-toast';

const COST_CENTER_KEY = 'costcenter_allocations';

interface CostCenterRow {
  id: string;
  name: string;
  pct: number;
  glCode: string;
}

function loadAllocations(leaseId: string): CostCenterRow[] {
  try {
    const raw = localStorage.getItem(COST_CENTER_KEY);
    if (!raw) return [];
    const all: Record<string, CostCenterRow[]> = JSON.parse(raw);
    return all[leaseId] || [];
  } catch {
    return [];
  }
}

function saveAllocations(leaseId: string, rows: CostCenterRow[]): void {
  try {
    const raw = localStorage.getItem(COST_CENTER_KEY);
    const all: Record<string, CostCenterRow[]> = raw ? JSON.parse(raw) : {};
    all[leaseId] = rows;
    localStorage.setItem(COST_CENTER_KEY, JSON.stringify(all));
  } catch {}
}

export default function CostCenterPage() {
  const [leases, setLeases] = useState<any[]>([]);
  const [selectedLease, setSelectedLease] = useState('');
  const [rows, setRows] = useState<CostCenterRow[]>([]);
  const [calculated, setCalculated] = useState<any[] | null>(null);

  useEffect(() => {
    setLeases(getLeaseRepository());
  }, []);

  useEffect(() => {
    if (selectedLease) {
      setRows(loadAllocations(selectedLease));
      setCalculated(null);
    } else {
      setRows([]);
      setCalculated(null);
    }
  }, [selectedLease]);

  const lease = leases.find((l) => l.id === selectedLease || l.lease_id === selectedLease);
  const totalPct = rows.reduce((s, r) => s + r.pct, 0);

  const addRow = () => {
    setRows([
      ...rows,
      { id: crypto.randomUUID(), name: '', pct: 0, glCode: '' },
    ]);
  };

  const removeRow = (id: string) => {
    setRows(rows.filter((r) => r.id !== id));
  };

  const updateRow = (id: string, field: keyof CostCenterRow, value: string | number) => {
    setRows(rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  };

  const handleCalculate = () => {
    if (!lease) {
      toast.error('Select a lease');
      return;
    }
    if (Math.abs(totalPct - 100) > 0.01) {
      toast.error('Total % must equal 100%');
      return;
    }
    const validRows = rows.filter((r) => r.name && r.pct > 0);
    if (validRows.length === 0) {
      toast.error('Add at least one cost center with %');
      return;
    }

    const dep = Number(lease.results?.monthly_depreciation ?? 0);
    const int = Number((lease.results?.year_1_impact?.interest_expense ?? 0) / 12);
    const totalMonthly = dep + int;

    const calc = validRows.map((r) => {
      const p = r.pct / 100;
      return {
        name: r.name,
        pct: r.pct,
        glCode: r.glCode,
        monthlyDep: dep * p,
        monthlyInt: int * p,
        monthlyTotal: totalMonthly * p,
        annualTotal: totalMonthly * 12 * p,
      };
    });
    setCalculated(calc);
    saveAllocations(selectedLease, validRows);
    toast.success('Allocation calculated');
  };

  const handleDownloadReport = () => {
    if (!calculated || !lease) return;
    const lines = [
      'IFRS 16 Cost Center Allocation Report',
      `Lease: ${lease.lease_id || lease.id}`,
      `Asset: ${lease.asset}`,
      '',
      'Cost Center | % | Monthly Depreciation | Monthly Interest | Total Monthly | Annual Cost',
      '-'.repeat(80),
      ...calculated.map(
        (c) =>
          `${c.name} | ${c.pct}% | ${formatIndianCurrency(c.monthlyDep)} | ${formatIndianCurrency(c.monthlyInt)} | ${formatIndianCurrency(c.monthlyTotal)} | ${formatIndianCurrency(c.annualTotal)}`
      ),
      '',
      `TOTAL | 100% | ${formatIndianCurrency(calculated.reduce((s, c) => s + c.monthlyDep, 0))} | ${formatIndianCurrency(calculated.reduce((s, c) => s + c.monthlyInt, 0))} | ${formatIndianCurrency(calculated.reduce((s, c) => s + c.monthlyTotal, 0))} | ${formatIndianCurrency(calculated.reduce((s, c) => s + c.annualTotal, 0))}`,
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `IFRS16_CostCenter_${lease.lease_id || lease.id}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Report downloaded');
  };

  const dep = Number(lease?.results?.monthly_depreciation ?? 0);
  const int = Number((lease?.results?.year_1_impact?.interest_expense ?? 0) / 12);

  return (
    <SidebarLayout
      pageTitle="Cost Center Allocation"
      pageSubtitle="Split lease expenses across departments"
    >
      <div className="space-y-6">
        <div className="bg-white rounded-[14px] p-6 border border-border-default shadow-card">
          <h3 className="text-base font-bold text-text-primary mb-4">Select Lease</h3>
          <select
            value={selectedLease}
            onChange={(e) => setSelectedLease(e.target.value)}
            className="w-full max-w-md px-4 py-2 bg-bg-light border border-border-default rounded-lg focus:ring-2 focus:ring-orange-primary text-text-primary"
          >
            <option value="">— Select —</option>
            {leases.map((l) => (
              <option key={l.id} value={l.lease_id || l.id}>
                {l.lease_id || l.id} — {l.asset}
              </option>
            ))}
          </select>
        </div>

        {lease && (
          <>
            <div className="bg-white rounded-[14px] p-6 border border-border-default shadow-card">
              <h3 className="text-base font-bold text-text-primary mb-4">Cost Centers</h3>
              <p className="text-xs text-text-muted mb-4">Total % must equal 100%</p>
              <div className="space-y-3 mb-4">
                {rows.map((r) => (
                  <div key={r.id} className="flex gap-3 items-center">
                    <input
                      type="text"
                      placeholder="Cost Center Name"
                      value={r.name}
                      onChange={(e) => updateRow(r.id, 'name', e.target.value)}
                      className="flex-1 px-4 py-2 bg-bg-light border border-border-default rounded-lg text-text-primary"
                    />
                    <input
                      type="number"
                      placeholder="%"
                      min={0}
                      max={100}
                      step={0.1}
                      value={r.pct || ''}
                      onChange={(e) => updateRow(r.id, 'pct', parseFloat(e.target.value) || 0)}
                      className="w-20 px-4 py-2 bg-bg-light border border-border-default rounded-lg text-text-primary font-mono"
                    />
                    <input
                      type="text"
                      placeholder="GL Code"
                      value={r.glCode}
                      onChange={(e) => updateRow(r.id, 'glCode', e.target.value)}
                      className="w-28 px-4 py-2 bg-bg-light border border-border-default rounded-lg text-text-primary font-mono"
                    />
                    <button
                      onClick={() => removeRow(r.id)}
                      className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
              <Button variant="secondary" size="sm" onClick={addRow}>
                <Plus className="w-4 h-4 mr-2" /> Add Cost Center
              </Button>
              <div className="mt-4 text-sm">
                Total: <span className={`font-mono font-bold ${Math.abs(totalPct - 100) < 0.01 ? 'text-green-600' : 'text-red-600'}`}>{totalPct.toFixed(1)}%</span>
              </div>
              <Button variant="primary" size="md" className="mt-4 bg-gradient-orange" onClick={handleCalculate}>
                Calculate Allocation
              </Button>
            </div>

            {calculated && calculated.length > 0 && (
              <div className="bg-white rounded-[14px] p-6 border border-border-default shadow-card">
                <h3 className="text-base font-bold text-text-primary mb-4">Results</h3>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border-default">
                        <th className="text-left py-2 px-3 text-xs font-semibold text-text-secondary uppercase">Cost Center</th>
                        <th className="text-center py-2 px-3 text-xs font-semibold text-text-secondary uppercase">%</th>
                        <th className="text-right py-2 px-3 text-xs font-semibold text-text-secondary uppercase">Monthly Depreciation</th>
                        <th className="text-right py-2 px-3 text-xs font-semibold text-text-secondary uppercase">Monthly Interest</th>
                        <th className="text-right py-2 px-3 text-xs font-semibold text-text-secondary uppercase">Total Monthly</th>
                        <th className="text-right py-2 px-3 text-xs font-semibold text-text-secondary uppercase">Annual Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {calculated.map((c, i) => (
                        <tr key={i} className="border-b border-border-default hover:bg-orange-light">
                          <td className="py-3 px-3 text-sm text-text-primary">{c.name}</td>
                          <td className="py-3 px-3 text-sm text-center font-mono">{c.pct}%</td>
                          <td className="py-3 px-3 text-sm text-right font-mono amount">{formatIndianCurrency(c.monthlyDep)}</td>
                          <td className="py-3 px-3 text-sm text-right font-mono amount">{formatIndianCurrency(c.monthlyInt)}</td>
                          <td className="py-3 px-3 text-sm text-right font-mono amount">{formatIndianCurrency(c.monthlyTotal)}</td>
                          <td className="py-3 px-3 text-sm text-right font-mono amount">{formatIndianCurrency(c.annualTotal)}</td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-border-default font-semibold">
                        <td className="py-3 px-3 text-sm text-text-primary">TOTAL</td>
                        <td className="py-3 px-3 text-sm text-center font-mono">100%</td>
                        <td className="py-3 px-3 text-sm text-right font-mono amount">{formatIndianCurrency(dep)}</td>
                        <td className="py-3 px-3 text-sm text-right font-mono amount">{formatIndianCurrency(int)}</td>
                        <td className="py-3 px-3 text-sm text-right font-mono amount">{formatIndianCurrency(dep + int)}</td>
                        <td className="py-3 px-3 text-sm text-right font-mono amount">{formatIndianCurrency((dep + int) * 12)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="mt-4 p-4 bg-bg-light rounded-lg text-sm font-mono">
                  <p className="font-semibold text-text-primary mb-2">Journal Entries with Cost Centers:</p>
                  {calculated.map((c, i) => (
                    <p key={i}>Dr Depreciation — {c.name} (CC: {c.glCode || '—'}) {formatIndianCurrency(c.monthlyDep)}</p>
                  ))}
                  <p className="mt-2">Cr Accumulated Depreciation {formatIndianCurrency(dep)}</p>
                </div>
                <div className="flex gap-2 mt-4">
                  <Button variant="primary" size="md" className="bg-gradient-orange" onClick={handleDownloadReport}>
                    <Download className="w-4 h-4 mr-2" /> Download Allocation Report
                  </Button>
                  <Link href="/dashboard/ifrs16/erp">
                    <Button variant="secondary" size="md">
                      <Link2 className="w-4 h-4 mr-2" /> Export to ERP
                    </Button>
                  </Link>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </SidebarLayout>
  );
}
