'use client';

import { useCallback, useEffect, useState } from 'react';
import { SidebarLayout } from '@/components/SidebarLayout';
import { useAuth } from '@/hooks/useAuth';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import {
  fetchFirmsWithMemberCounts,
  slugifyFirmCode,
} from '@/lib/user-profile';
import type { FirmRecord } from '@/lib/firm-workspace';
import toast from 'react-hot-toast';
import { Building2, Copy, Plus } from 'lucide-react';

type FirmRow = FirmRecord & { member_count: number };

export default function AdminFirmsPage() {
  const { isAdmin, loading: authLoading } = useAuth();
  const [firms, setFirms] = useState<FirmRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [market, setMarket] = useState('UAE');
  const [currency, setCurrency] = useState('AED');
  const [ifrs16, setIfrs16] = useState(true);
  const [ifrs15, setIfrs15] = useState(false);
  const [ifrs9, setIfrs9] = useState(false);
  const [createdCode, setCreatedCode] = useState<string | null>(null);

  const loadFirms = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await fetchFirmsWithMemberCounts();
      setFirms(rows.filter((f) => f.firm_id !== 'default'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading && isAdmin) void loadFirms();
  }, [authLoading, isAdmin, loadFirms]);

  useEffect(() => {
    if (name && !code) {
      setCode(slugifyFirmCode(name));
    }
  }, [name, code]);

  const createFirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSupabaseConfigured || !supabase) {
      toast.error('Supabase not configured');
      return;
    }
    const firmId = (code || slugifyFirmCode(name)).trim().toLowerCase();
    if (!firmId || !name.trim()) {
      toast.error('Company name and code are required');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from('firms').insert({
        firm_id: firmId,
        firm_name: name.trim(),
        slug: firmId,
        market,
        currency,
        modules_enabled: { ifrs16, ifrs15, ifrs9 },
      });
      if (error) throw error;
      setCreatedCode(firmId);
      toast.success(`Workspace created: ${firmId}`);
      setName('');
      setCode('');
      await loadFirms();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create workspace');
    } finally {
      setSaving(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-orange-500" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <SidebarLayout pageTitle="Admin" pageSubtitle="Workspace management">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
          Admin access required. Your profile must have <code>role = admin</code> in the profiles
          table.
        </div>
      </SidebarLayout>
    );
  }

  return (
    <SidebarLayout
      pageTitle="Client Workspaces"
      pageSubtitle="Create isolated firm workspaces for onboarding clients"
    >
      <div className="grid lg:grid-cols-2 gap-8">
        <div className="rounded-xl border border-[#e2e8f0] bg-white p-6">
          <h2 className="text-lg font-semibold text-[#1e293b] flex items-center gap-2 mb-4">
            <Plus className="w-5 h-5 text-orange-500" />
            Create workspace
          </h2>
          <form onSubmit={createFirm} className="space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-700">Company name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                placeholder="Gulf Steel Trading LLC"
                required
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Company code</label>
              <input
                value={code}
                onChange={(e) => setCode(slugifyFirmCode(e.target.value))}
                className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono"
                placeholder="gulf-steel-trading"
                required
              />
              <p className="text-xs text-gray-400 mt-1">Clients enter this on signup</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-gray-700">Market</label>
                <select
                  value={market}
                  onChange={(e) => setMarket(e.target.value)}
                  className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                >
                  <option value="UAE">UAE</option>
                  <option value="India">India</option>
                  <option value="UK">UK</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Currency</label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                >
                  <option value="AED">AED</option>
                  <option value="INR">INR</option>
                  <option value="GBP">GBP</option>
                </select>
              </div>
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={ifrs16} onChange={(e) => setIfrs16(e.target.checked)} />
                IFRS 16
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={ifrs15} onChange={(e) => setIfrs15(e.target.checked)} />
                IFRS 15
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={ifrs9} onChange={(e) => setIfrs9(e.target.checked)} />
                IFRS 9
              </label>
            </div>
            <button
              type="submit"
              disabled={saving}
              className="w-full py-2.5 bg-orange-500 text-white rounded-lg font-medium hover:bg-orange-600 disabled:opacity-50"
            >
              {saving ? 'Creating…' : 'Create workspace'}
            </button>
          </form>

          {createdCode && (
            <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-sm text-green-800 font-medium">Share this code with your client:</p>
              <div className="flex items-center gap-2 mt-2">
                <code className="flex-1 bg-white px-3 py-2 rounded border font-mono text-sm">
                  {createdCode}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(createdCode);
                    toast.success('Copied');
                  }}
                  className="p-2 rounded-lg border hover:bg-white"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-[#e2e8f0] bg-white p-6">
          <h2 className="text-lg font-semibold text-[#1e293b] flex items-center gap-2 mb-4">
            <Building2 className="w-5 h-5 text-orange-500" />
            Existing workspaces
          </h2>
          {loading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : firms.length === 0 ? (
            <p className="text-sm text-gray-500">No workspaces yet.</p>
          ) : (
            <ul className="space-y-2">
              {firms.map((f) => (
                <li
                  key={f.firm_id}
                  className="flex items-center justify-between px-4 py-3 border border-gray-100 rounded-lg"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-800">{f.firm_name}</p>
                    <p className="text-xs text-gray-400 font-mono">{f.firm_id}</p>
                  </div>
                  <span className="text-xs text-gray-500">{f.member_count} users</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </SidebarLayout>
  );
}
