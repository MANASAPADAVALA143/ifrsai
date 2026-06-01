'use client';

import { useState } from 'react';
import { Button } from '@/components/Button';
import { ifrs16ExtApi } from '@/lib/api';
import { formatLeaseMoney } from '@/lib/ifrs16-currency';
import toast from 'react-hot-toast';

type Props = {
  leaseId: string;
  originalPayment: number;
  ibrPct: number;
  remainingMonths: number;
  currentLiability: number;
  currentRou: number;
  baseIndex: number;
  currentIndex: number;
  currency?: string;
};

export function CpiRemeasurementPanel({
  leaseId,
  originalPayment,
  ibrPct,
  remainingMonths,
  currentLiability,
  currentRou,
  baseIndex,
  currentIndex,
  currency = 'AED',
}: Props) {
  const [origCpi, setOrigCpi] = useState(baseIndex || 100);
  const [newCpi, setNewCpi] = useState(currentIndex || 100);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const run = async () => {
    setLoading(true);
    try {
      const { data, error } = await ifrs16ExtApi.remeasureCpi({
        lease_id: leaseId,
        original_monthly_payment: originalPayment,
        original_ibr: ibrPct,
        original_cpi: origCpi,
        new_cpi: newCpi,
        remeasurement_date: date,
        remaining_term_months: remainingMonths,
        current_liability_balance: currentLiability,
        current_rou_balance: currentRou,
        currency,
      });
      if (error) throw new Error(error);
      setResult(data as Record<string, unknown>);
      toast.success('CPI remeasurement calculated');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'CPI remeasurement failed');
    } finally {
      setLoading(false);
    }
  };

  const journal = result?.remeasurement_journal as
    | { entries?: { account: string; dr: number; cr: number }[] }
    | undefined;

  return (
    <div className="mt-6 p-4 border border-[#fed7aa] rounded-lg bg-[#fff7ed]">
      <h5 className="text-sm font-semibold text-[#ea580c] mb-3">CPI / Index Remeasurement (IFRS 16.42)</h5>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm mb-3">
        <div>
          <label className="text-[#64748b]">Original CPI at commencement</label>
          <input
            type="number"
            className="w-full border rounded px-2 py-1.5 mt-1"
            value={origCpi}
            onChange={(e) => setOrigCpi(Number(e.target.value))}
          />
        </div>
        <div>
          <label className="text-[#64748b]">New CPI (current)</label>
          <input
            type="number"
            className="w-full border rounded px-2 py-1.5 mt-1"
            value={newCpi}
            onChange={(e) => setNewCpi(Number(e.target.value))}
          />
        </div>
        <div>
          <label className="text-[#64748b]">Remeasurement date</label>
          <input type="date" className="w-full border rounded px-2 py-1.5 mt-1" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label className="text-[#64748b]">Remaining term (months)</label>
          <input type="number" className="w-full border rounded px-2 py-1.5 mt-1 bg-gray-50" readOnly value={remainingMonths} />
        </div>
        <div>
          <label className="text-[#64748b]">Current liability balance</label>
          <input type="number" className="w-full border rounded px-2 py-1.5 mt-1 bg-gray-50" readOnly value={currentLiability} />
        </div>
        <div>
          <label className="text-[#64748b]">Current ROU balance</label>
          <input type="number" className="w-full border rounded px-2 py-1.5 mt-1 bg-gray-50" readOnly value={currentRou} />
        </div>
      </div>
      <Button className="bg-[#f97316] text-white" onClick={() => void run()} isLoading={loading}>
        Calculate CPI Remeasurement
      </Button>
      {result && (
        <div className="mt-4 space-y-2 text-sm">
          <p>CPI uplift: +{String(result.cpi_uplift_pct)}%</p>
          <p>
            New monthly payment: {formatLeaseMoney(Number(result.new_monthly_payment), currency)} (was{' '}
            {formatLeaseMoney(Number(result.original_monthly_payment), currency)})
          </p>
          <p>Liability adjustment: {formatLeaseMoney(Number(result.liability_adjustment), currency)}</p>
          <p>New ROU balance: {formatLeaseMoney(Number(result.new_rou_balance), currency)}</p>
          {journal?.entries && (
            <div className="font-mono bg-white border rounded p-3 mt-2">
              <p className="font-semibold mb-1">Remeasurement journal</p>
              {journal.entries.map((e, i) => (
                <p key={i}>
                  {e.dr > 0 ? 'Dr' : 'Cr'} {e.account} {formatLeaseMoney(e.dr || e.cr, currency)}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
