'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/Button';
import { ifrs16ExtApi } from '@/lib/api';
import { getLeaseRepository } from '@/lib/lease-repository';
import toast from 'react-hot-toast';
import { Download, Loader2 } from 'lucide-react';

export function IFRS16OverviewTools() {
  const [health, setHealth] = useState<{ score: number; issues: { description: string; severity: string }[] } | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [ibrCountry, setIbrCountry] = useState('India');
  const [ibrRating, setIbrRating] = useState('BBB');
  const [ibrYears, setIbrYears] = useState(5);
  const [ibrResult, setIbrResult] = useState<Record<string, unknown> | null>(null);
  const [ibrLoading, setIbrLoading] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditPeriod, setAuditPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [auditLoading, setAuditLoading] = useState(false);

  const loadHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      const leases = getLeaseRepository();
      const { data, error } = await ifrs16ExtApi.healthScore(leases, 0);
      if (error) throw new Error(error);
      setHealth(data as { score: number; issues: { description: string; severity: string }[] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Health score failed');
    } finally {
      setHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHealth();
  }, [loadHealth]);

  const runIbr = async () => {
    setIbrLoading(true);
    try {
      const { data, error } = await ifrs16ExtApi.ibrBenchmark({
        country: ibrCountry,
        credit_rating: ibrRating,
        lease_term_years: ibrYears,
      });
      if (error) throw new Error(error);
      setIbrResult(data as Record<string, unknown>);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'IBR benchmark failed');
    } finally {
      setIbrLoading(false);
    }
  };

  const downloadAudit = async () => {
    setAuditLoading(true);
    try {
      const leases = getLeaseRepository();
      const { data, error } = await ifrs16ExtApi.auditBundle({
        period: auditPeriod,
        leases,
        alerts_count: 0,
      });
      if (error || !data) throw new Error(error || 'No PDF');
      const url = URL.createObjectURL(data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `IFRS16_Audit_Pack_${auditPeriod}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Audit pack downloaded');
      setAuditOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Audit bundle failed');
    } finally {
      setAuditLoading(false);
    }
  };

  const score = health?.score ?? 0;
  const ringColor =
    score >= 80 ? 'text-emerald-600' : score >= 60 ? 'text-amber-600' : 'text-red-600';

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-[#e2e8f0] p-6 flex flex-col items-center">
          <p className="text-sm font-semibold text-[#64748b] mb-3 w-full text-left">Compliance Health</p>
          {healthLoading ? (
            <Loader2 className="w-8 h-8 animate-spin text-[#f97316]" />
          ) : (
            <>
              <div className={`text-5xl font-bold ${ringColor}`}>{score}</div>
              <p className="text-xs text-[#64748b] mt-1">SCORE / 100</p>
              <Button variant="secondary" size="sm" className="mt-3" onClick={() => void loadHealth()}>
                Refresh
              </Button>
              {health?.issues && health.issues.length > 0 && (
                <ul className="mt-4 w-full text-xs space-y-1">
                  {health.issues.slice(0, 4).map((iss, i) => (
                    <li key={i} className="text-red-700">
                      [{iss.severity}] {iss.description}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        <div className="bg-white rounded-xl border border-[#e2e8f0] p-6">
          <p className="text-sm font-semibold text-[#1e293b] mb-3">IBR Benchmark Tool</p>
          <div className="space-y-2 text-sm">
            <select
              className="w-full border rounded-lg px-2 py-1.5"
              value={ibrCountry}
              onChange={(e) => setIbrCountry(e.target.value)}
            >
              {['India', 'UAE', 'UK', 'US', 'Singapore'].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              className="w-full border rounded-lg px-2 py-1.5"
              value={ibrRating}
              onChange={(e) => setIbrRating(e.target.value)}
            >
              {['AAA', 'AA', 'A', 'BBB', 'BB', 'B'].map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              className="w-full border rounded-lg px-2 py-1.5"
              value={ibrYears}
              onChange={(e) => setIbrYears(Number(e.target.value) || 1)}
              placeholder="Lease term (years)"
            />
            <Button variant="primary" size="sm" className="w-full" onClick={() => void runIbr()} isLoading={ibrLoading}>
              Get IBR Range
            </Button>
            {ibrResult && (
              <p className="text-sm font-medium text-[#f97316] mt-2">
                Suggested IBR: {String(ibrResult.ibr_low)}% – {String(ibrResult.ibr_high)}% (mid{' '}
                {String(ibrResult.ibr_mid)}%)
              </p>
            )}
            {ibrResult?.benchmark_basis != null && (
              <p className="text-xs text-[#64748b]">{String(ibrResult.benchmark_basis)}</p>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-[#e2e8f0] p-6 flex flex-col justify-between">
          <div>
            <p className="text-sm font-semibold text-[#1e293b] mb-2">One-Click Audit PDF Bundle</p>
            <p className="text-xs text-[#64748b]">Portfolio summary, health score, certification pages.</p>
          </div>
          <Button
            variant="primary"
            className="mt-4 bg-[#f97316] hover:bg-[#ea580c]"
            onClick={() => setAuditOpen(true)}
          >
            <Download className="w-4 h-4 mr-2" />
            Download Audit Bundle
          </Button>
        </div>
      </div>

      {auditOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl p-6 max-w-md w-full shadow-xl">
            <h3 className="font-bold text-lg mb-4">Generate Audit Pack</h3>
            <label className="text-sm text-[#64748b]">Period (YYYY-MM)</label>
            <input
              type="month"
              className="w-full border rounded-lg px-3 py-2 mt-1 mb-4"
              value={auditPeriod}
              onChange={(e) => setAuditPeriod(e.target.value)}
            />
            <div className="flex gap-2 justify-end">
              <Button variant="secondary" onClick={() => setAuditOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => void downloadAudit()} isLoading={auditLoading}>
                Generate PDF
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
