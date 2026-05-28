'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { revRecApi, ifrs15Api } from '@/lib/api';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { Download, Upload } from 'lucide-react';

type GlRow = { contract_id: string; gl_revenue: string; gl_date: string };

const GL_TEMPLATE_CSV = `contract_id,gl_revenue,gl_date
CONTRACT-001,125000,2026-03-31
CONTRACT-002,48000,2026-03-31`;

function statusClass(status: string) {
  if (status === 'MATCHED') return 'bg-green-100 text-green-800';
  if (status === 'MINOR VARIANCE') return 'bg-amber-100 text-amber-800';
  return 'bg-red-100 text-red-800';
}

function parseGlCsv(text: string): GlRow[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].toLowerCase().split(',').map((h) => h.trim());
  const idxContract = header.findIndex((h) => h.includes('contract'));
  const idxRevenue = header.findIndex((h) => h.includes('revenue') || h.includes('gl'));
  const idxDate = header.findIndex((h) => h.includes('date'));
  const rows: GlRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    if (!cols[0] && cols.every((c) => !c)) continue;
    rows.push({
      contract_id: cols[idxContract >= 0 ? idxContract : 0] || '',
      gl_revenue: cols[idxRevenue >= 0 ? idxRevenue : 1] || '',
      gl_date: cols[idxDate >= 0 ? idxDate : 2] || '',
    });
  }
  return rows.filter((r) => r.contract_id.trim());
}

export function PeriodReconciliationTab() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [glRows, setGlRows] = useState<GlRow[]>([{ contract_id: '', gl_revenue: '', gl_date: '' }]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [uploadFileName, setUploadFileName] = useState<string | null>(null);

  const downloadTemplate = () => {
    const blob = new Blob([GL_TEMPLATE_CSV], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gl_revenue_upload_template.csv';
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Template downloaded');
  };

  const handleCsvFile = (file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      const parsed = parseGlCsv(text);
      if (!parsed.length) {
        toast.error('No valid rows found. Use template columns: contract_id, gl_revenue, gl_date');
        return;
      }
      setGlRows(parsed);
      setUploadFileName(file.name);
      toast.success(`Loaded ${parsed.length} GL row(s)`);
    };
    reader.onerror = () => toast.error('Could not read file');
    reader.readAsText(file);
  };

  const run = async () => {
    setLoading(true);
    try {
      const port = await ifrs15Api.portfolioSummary();
      const contracts = (port.data as { contracts?: Record<string, unknown>[] })?.contracts || [];
      const ifrs_contracts = contracts.map((c) => ({
        contract_id: String(c.contract_id || ''),
        customer_name: String(c.customer_name || ''),
        ifrs_revenue: Number(c.recognised_to_date || c.mrr || 0),
      }));
      const gl_entries = glRows
        .filter((r) => r.contract_id.trim())
        .map((r) => ({
          contract_id: r.contract_id.trim(),
          gl_revenue: Number(r.gl_revenue) || 0,
          gl_date: r.gl_date || period,
        }));
      if (!gl_entries.length) {
        toast.error('Add GL rows or upload a CSV');
        setLoading(false);
        return;
      }
      const { data, error } = await revRecApi.periodReconciliation({
        period,
        gl_entries,
        ifrs_contracts,
      });
      if (error) throw new Error(error);
      setResult(data as Record<string, unknown>);
      toast.success('Reconciliation complete');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Reconciliation failed');
    } finally {
      setLoading(false);
    }
  };

  const downloadBlackline = () => {
    const rows = (result?.blackline_export as Record<string, unknown>[]) || [];
    if (!rows.length) {
      toast.error('Run reconciliation first');
      return;
    }
    const headers = Object.keys(rows[0]);
    const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => String(r[h] ?? '')).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `blackline_rev_rec_${period}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const summary = (result?.summary || {}) as Record<string, number>;
  const recon = (result?.reconciliation || []) as Record<string, unknown>[];
  const matchRate =
    summary.total_contracts > 0
      ? Math.round(((summary.matched || 0) / summary.total_contracts) * 100)
      : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs text-text-muted">Period</label>
          <input
            type="month"
            className="block border rounded-lg px-3 py-2 mt-1"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          />
        </div>
        <Button variant="primary" onClick={() => void run()} isLoading={loading}>
          Run reconciliation
        </Button>
        <Button variant="secondary" onClick={downloadBlackline}>
          Download BlackLine export
        </Button>
      </div>

      <div className="p-4 border border-dashed border-[#f97316] rounded-xl bg-orange-50/50 space-y-3">
        <p className="text-sm font-semibold text-[#9a3412]">Upload GL revenue extract</p>
        <p className="text-xs text-[#78350f]">
          Columns: contract_id, gl_revenue, gl_date (YYYY-MM-DD). Matches IFRS.ai portfolio by contract ID.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={downloadTemplate}>
            <Download className="w-4 h-4 mr-1" />
            Download GL template
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt,text/csv"
            className="hidden"
            onChange={(e) => handleCsvFile(e.target.files?.[0] ?? null)}
          />
          <Button variant="primary" size="sm" className="bg-[#f97316]" onClick={() => fileRef.current?.click()}>
            <Upload className="w-4 h-4 mr-1" />
            Upload GL CSV
          </Button>
          {uploadFileName && (
            <span className="text-xs text-[#64748b] self-center">Loaded: {uploadFileName}</span>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-semibold text-text-muted">Or enter GL rows manually</p>
        {glRows.map((row, i) => (
          <div key={i} className="grid grid-cols-3 gap-2">
            <input
              className="border rounded px-2 py-1.5 text-sm"
              placeholder="Contract ID"
              value={row.contract_id}
              onChange={(e) => {
                const next = [...glRows];
                next[i] = { ...next[i], contract_id: e.target.value };
                setGlRows(next);
              }}
            />
            <input
              className="border rounded px-2 py-1.5 text-sm"
              placeholder="GL revenue"
              value={row.gl_revenue}
              onChange={(e) => {
                const next = [...glRows];
                next[i] = { ...next[i], gl_revenue: e.target.value };
                setGlRows(next);
              }}
            />
            <input
              className="border rounded px-2 py-1.5 text-sm"
              placeholder="GL date"
              value={row.gl_date}
              onChange={(e) => {
                const next = [...glRows];
                next[i] = { ...next[i], gl_date: e.target.value };
                setGlRows(next);
              }}
            />
          </div>
        ))}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setGlRows((r) => [...r, { contract_id: '', gl_revenue: '', gl_date: '' }])}
        >
          Add GL row
        </Button>
      </div>

      {result && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="bg-white border rounded-lg p-4">
              <p className="text-xs text-text-muted">IFRS revenue</p>
              <p className="text-lg font-bold">{summary.total_ifrs_revenue?.toLocaleString()}</p>
            </div>
            <div className="bg-white border rounded-lg p-4">
              <p className="text-xs text-text-muted">GL revenue</p>
              <p className="text-lg font-bold">{summary.total_gl_revenue?.toLocaleString()}</p>
            </div>
            <div className="bg-white border rounded-lg p-4">
              <p className="text-xs text-text-muted">Net variance</p>
              <p className="text-lg font-bold">{summary.net_variance?.toLocaleString()}</p>
            </div>
            <div className="bg-white border rounded-lg p-4">
              <p className="text-xs text-text-muted">Matched</p>
              <p className="text-lg font-bold text-green-700">{summary.matched}</p>
            </div>
            <div className="bg-white border rounded-lg p-4">
              <p className="text-xs text-text-muted">Match rate</p>
              <p className="text-lg font-bold">{matchRate}%</p>
            </div>
          </div>
          <div className="overflow-x-auto border rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-bg-light border-b">
                  <th className="text-left p-2">Contract</th>
                  <th className="text-right p-2">IFRS</th>
                  <th className="text-right p-2">GL</th>
                  <th className="text-right p-2">Variance</th>
                  <th className="text-left p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {recon.map((r) => (
                  <tr key={String(r.contract_id)} className="border-b">
                    <td className="p-2">{String(r.contract_id)}</td>
                    <td className="p-2 text-right">{Number(r.ifrs_revenue).toLocaleString()}</td>
                    <td className="p-2 text-right">{Number(r.gl_revenue).toLocaleString()}</td>
                    <td className="p-2 text-right">{Number(r.variance).toLocaleString()}</td>
                    <td className="p-2">
                      <span
                        className={cn(
                          'px-2 py-0.5 rounded-full text-xs font-medium',
                          statusClass(String(r.status))
                        )}
                      >
                        {String(r.status)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
