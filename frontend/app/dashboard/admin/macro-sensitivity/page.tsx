'use client';

import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { SidebarLayout } from '@/components/SidebarLayout';
import { Button } from '@/components/Button';
import { macroSensitivityApi } from '@/lib/api';

type PortfolioType = 'all' | 'retail' | 'corporate' | 'mortgage';

const DEFAULTS = {
  gdp_sensitivity: 0.15,
  unemployment_sensitivity: 0.08,
  interest_rate_sensitivity: 0.03,
};

export default function MacroSensitivityPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [portfolioType, setPortfolioType] = useState<PortfolioType>('all');
  const [approvedBy, setApprovedBy] = useState('');
  const [notes, setNotes] = useState('');
  const [current, setCurrent] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [form, setForm] = useState({
    gdp_sensitivity: DEFAULTS.gdp_sensitivity,
    unemployment_sensitivity: DEFAULTS.unemployment_sensitivity,
    interest_rate_sensitivity: DEFAULTS.interest_rate_sensitivity,
  });

  const loadData = async (pt: PortfolioType) => {
    setLoading(true);
    try {
      const [cfg, hist] = await Promise.all([
        macroSensitivityApi.getCurrent('default', pt),
        macroSensitivityApi.getHistory('default', pt),
      ]);
      if (cfg.error) throw new Error(cfg.error);
      if (hist.error) throw new Error(hist.error);
      const c = cfg.data || {};
      setCurrent(c);
      setForm({
        gdp_sensitivity: Number(c.gdp_sensitivity ?? DEFAULTS.gdp_sensitivity),
        unemployment_sensitivity: Number(c.unemployment_sensitivity ?? DEFAULTS.unemployment_sensitivity),
        interest_rate_sensitivity: Number(c.interest_rate_sensitivity ?? DEFAULTS.interest_rate_sensitivity),
      });
      setHistory((hist.data || []).slice(0, 10));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData(portfolioType);
  }, [portfolioType]);

  const adjustedPdPct = useMemo(() => {
    const basePdPct = 5;
    return basePdPct * (1 + 0.01 * form.gdp_sensitivity);
  }, [form.gdp_sensitivity]);

  const handleSave = async () => {
    if (!notes.trim()) {
      toast.error('Justification / Notes is required for audit.');
      return;
    }
    setSaving(true);
    try {
      const res = await macroSensitivityApi.update({
        tenant_id: 'default',
        portfolio_type: portfolioType,
        gdp_sensitivity: form.gdp_sensitivity,
        unemployment_sensitivity: form.unemployment_sensitivity,
        interest_rate_sensitivity: form.interest_rate_sensitivity,
        approved_by: approvedBy,
        approval_notes: notes,
      });
      if (res.error) throw new Error(res.error);
      toast.success('Macro sensitivity updated and applied live.');
      await loadData(portfolioType);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setForm({ ...DEFAULTS });
  };

  return (
    <SidebarLayout
      pageTitle="Macro Sensitivity Settings"
      pageSubtitle="IFRS 9 §5.5.17 — Forward-looking assumptions"
    >
      <div className="space-y-6">
        <div className="rounded-[14px] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Changes take effect immediately across all ECL calculations. Document your justification for audit purposes.
        </div>

        <div className="bg-white rounded-[14px] p-6 border border-border-default shadow-card">
          <h3 className="text-base font-bold text-text-primary mb-4">Current Configuration</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-default">
                  <th className="text-left py-2 px-3 text-text-muted">Parameter</th>
                  <th className="text-left py-2 px-3 text-text-muted">Current Value</th>
                  <th className="text-left py-2 px-3 text-text-muted">Default</th>
                  <th className="text-left py-2 px-3 text-text-muted">Last Updated</th>
                  <th className="text-left py-2 px-3 text-text-muted">Updated By</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['GDP Sensitivity', 'gdp_sensitivity', DEFAULTS.gdp_sensitivity],
                  ['Unemployment Sensitivity', 'unemployment_sensitivity', DEFAULTS.unemployment_sensitivity],
                  ['Interest Rate Sensitivity', 'interest_rate_sensitivity', DEFAULTS.interest_rate_sensitivity],
                ].map(([label, key, def]) => (
                  <tr key={String(key)} className="border-b border-border-default">
                    <td className="py-2 px-3">{label}</td>
                    <td className="py-2 px-3 font-mono">{Number((current || {})[String(key)] ?? def).toFixed(3)}</td>
                    <td className="py-2 px-3 font-mono">{Number(def).toFixed(3)}</td>
                    <td className="py-2 px-3">{current?.created_at || '—'}</td>
                    <td className="py-2 px-3">{current?.approved_by || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white rounded-[14px] p-6 border border-border-default shadow-card">
            <h3 className="text-base font-bold text-text-primary mb-4">Edit & Apply Live</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">GDP Sensitivity</label>
                <input type="number" step="0.001" min="0" max="1" value={form.gdp_sensitivity} onChange={(e) => setForm((p) => ({ ...p, gdp_sensitivity: Number(e.target.value) }))} className="w-full px-4 py-2 bg-bg-light border border-border-default rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">Unemployment Sensitivity</label>
                <input type="number" step="0.001" min="0" max="1" value={form.unemployment_sensitivity} onChange={(e) => setForm((p) => ({ ...p, unemployment_sensitivity: Number(e.target.value) }))} className="w-full px-4 py-2 bg-bg-light border border-border-default rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">Interest Rate Sensitivity</label>
                <input type="number" step="0.001" min="0" max="1" value={form.interest_rate_sensitivity} onChange={(e) => setForm((p) => ({ ...p, interest_rate_sensitivity: Number(e.target.value) }))} className="w-full px-4 py-2 bg-bg-light border border-border-default rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">Portfolio Type</label>
                <select value={portfolioType} onChange={(e) => setPortfolioType(e.target.value as PortfolioType)} className="w-full px-4 py-2 bg-bg-light border border-border-default rounded-lg">
                  <option value="all">All</option>
                  <option value="retail">Retail</option>
                  <option value="corporate">Corporate</option>
                  <option value="mortgage">Mortgage</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">Approved By</label>
                <input value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)} className="w-full px-4 py-2 bg-bg-light border border-border-default rounded-lg" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-text-primary mb-1">Justification / Notes</label>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full px-4 py-2 bg-bg-light border border-border-default rounded-lg min-h-[96px]" />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <Button variant="secondary" onClick={handleReset}>Reset to Defaults</Button>
              <Button className="bg-blue-600 hover:bg-blue-700 text-white" onClick={handleSave} disabled={saving || loading}>
                {saving ? 'Saving...' : 'Save & Apply Live'}
              </Button>
            </div>
          </div>

          <div className="bg-white rounded-[14px] p-6 border border-border-default shadow-card">
            <h3 className="text-base font-bold text-text-primary mb-3">Impact Preview</h3>
            <p className="text-sm text-text-secondary mb-2">
              At GDP growth = -1%, adjusted PD = base_PD x (1 + 1% x current GDP sensitivity)
            </p>
            <div className="p-3 rounded-lg bg-bg-light border border-border-default font-mono text-sm">
              <div>Base PD: 5.00%</div>
              <div>GDP sensitivity: {form.gdp_sensitivity.toFixed(3)}</div>
              <div className="mt-2 font-semibold text-text-primary">Adjusted PD: {adjustedPdPct.toFixed(3)}%</div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-[14px] p-6 border border-border-default shadow-card">
          <h3 className="text-base font-bold text-text-primary mb-4">Change History</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-default">
                  <th className="text-left py-2 px-3 text-text-muted">Date</th>
                  <th className="text-left py-2 px-3 text-text-muted">Portfolio Type</th>
                  <th className="text-left py-2 px-3 text-text-muted">GDP</th>
                  <th className="text-left py-2 px-3 text-text-muted">Unemployment</th>
                  <th className="text-left py-2 px-3 text-text-muted">Interest Rate</th>
                  <th className="text-left py-2 px-3 text-text-muted">Approved By</th>
                  <th className="text-left py-2 px-3 text-text-muted">Notes</th>
                  <th className="text-left py-2 px-3 text-text-muted">Status</th>
                </tr>
              </thead>
              <tbody>
                {!loading && history.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-4 px-3 text-text-secondary">No changes yet.</td>
                  </tr>
                )}
                {history.map((h) => (
                  <tr key={h.id} className="border-b border-border-default">
                    <td className="py-2 px-3">{h.created_at || '—'}</td>
                    <td className="py-2 px-3">{h.portfolio_type || 'all'}</td>
                    <td className="py-2 px-3 font-mono">{Number(h.gdp_sensitivity).toFixed(3)}</td>
                    <td className="py-2 px-3 font-mono">{Number(h.unemployment_sensitivity).toFixed(3)}</td>
                    <td className="py-2 px-3 font-mono">{Number(h.interest_rate_sensitivity).toFixed(3)}</td>
                    <td className="py-2 px-3">{h.approved_by || '—'}</td>
                    <td className="py-2 px-3">{h.approval_notes || '—'}</td>
                    <td className="py-2 px-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs ${h.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}>
                        {h.is_active ? 'Active' : 'Superseded'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </SidebarLayout>
  );
}
