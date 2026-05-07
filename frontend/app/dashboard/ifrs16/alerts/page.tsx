'use client';

import { useState, useEffect } from 'react';
import { SidebarLayout } from '@/components/SidebarLayout';
import { Button } from '@/components/Button';
import { Bell, Mail, MessageCircle, Send, Eye, X } from 'lucide-react';
import { getLeaseRepository } from '@/lib/lease-repository';
import { alertsApi } from '@/lib/api';
import { formatIndianCurrency } from '@/lib/utils';
import Link from 'next/link';
import toast from 'react-hot-toast';

const ALERT_CONFIG_KEY = 'ifrs16_alert_config';

const defaultConfig = {
  emailAlerts: false,
  whatsappAlerts: false,
  email: process.env.NEXT_PUBLIC_ALERT_EMAIL_TO || '',
  whatsapp: '',
  rules: {
    expiring_90: true,
    expiring_30: true,
    expiring_7: true,
    liability_change: true,
    new_lease: true,
    monthly_reminder: true,
  },
};

interface AlertResponse {
  status: string;
  message: string;
}

function loadConfig(): typeof defaultConfig {
  if (typeof window === 'undefined') return defaultConfig;
  try {
    const raw = localStorage.getItem(ALERT_CONFIG_KEY);
    if (!raw) return defaultConfig;
    return { ...defaultConfig, ...JSON.parse(raw) };
  } catch {
    return defaultConfig;
  }
}

function saveConfig(cfg: typeof defaultConfig) {
  localStorage.setItem(ALERT_CONFIG_KEY, JSON.stringify(cfg));
}

export default function AlertsPage() {
  const [config, setConfig] = useState(defaultConfig);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const cfg = loadConfig();
    setConfig(cfg);
    if (!cfg.email) {
      alertsApi.getDefaults().then(({ data }) => {
        if (data?.email) setConfig((c) => ({ ...c, email: data.email }));
      });
    }
  }, []);

  useEffect(() => {
    const leases = getLeaseRepository();
    alertsApi.check(leases).then(({ data, error }) => {
      if (!error && data?.alerts) {
        setAlerts(data.alerts);
      } else {
        const local: any[] = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        leases.forEach((l) => {
          const end = l.dates?.end;
          if (!end) return;
          const endDate = new Date(end);
          const diff = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          if (diff < 0) local.push({ id: l.id, type: 'expired', severity: 'red', title: `${l.asset} has expired`, message: `Expired ${Math.abs(diff)} days ago` });
          else if (diff <= 7) local.push({ id: l.id, type: 'expiring_7', severity: 'red', title: `${l.asset} expires in ${diff} days`, message: `Renew by ${end}` });
          else if (diff <= 30) local.push({ id: l.id, type: 'expiring_30', severity: 'amber', title: `${l.asset} expires in ${diff} days`, message: `Renew by ${end}` });
          else if (diff <= 90) local.push({ id: l.id, type: 'expiring_90', severity: 'amber', title: `${l.asset} expires in ${diff} days`, message: `Renew by ${end}` });
        });
        const totalLiab = leases.reduce((s, l) => s + (Number(l.liability) || 0), 0);
        local.push({ id: 'summary', type: 'monthly', severity: 'green', title: 'Monthly summary', message: `${leases.length} leases active, total liability ${formatIndianCurrency(totalLiab)}` });
        setAlerts(local);
      }
    });
  }, []);

  const handleSaveConfig = async () => {
    saveConfig(config);
    setLoading(true);
    const { error } = await alertsApi.configure(config);
    setLoading(false);
    if (error) toast.error(error);
    else toast.success('Config saved');
  };

  const handleSendTest = async () => {
    if (!config.email) {
      toast.error('Enter email address');
      return;
    }
    setLoading(true);
    const { data, error } = await alertsApi.sendTest({ email: config.email });
    const typedData = data as AlertResponse | undefined;
    setLoading(false);
    if (error) toast.error(error);
    else if (typedData?.status === 'sent') toast.success('Test email sent!');
    else toast.success(typedData?.message || 'Check config');
  };

  const visibleAlerts = alerts.filter((a) => !dismissed.has(a.id + (a.type || '')));
  const activeCount = visibleAlerts.length;

  return (
    <SidebarLayout pageTitle="Smart Alerts" pageSubtitle="Configure and manage IFRS 16 lease alerts">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Configuration */}
        <div className="bg-white rounded-[14px] p-6 border border-border-default shadow-card">
          <h3 className="text-base font-bold text-text-primary mb-4">Alert Configuration</h3>
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.emailAlerts}
                  onChange={(e) => setConfig({ ...config, emailAlerts: e.target.checked })}
                  className="rounded border-border-default"
                />
                <Mail className="w-4 h-4" /> Email Alerts
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.whatsappAlerts}
                  onChange={(e) => setConfig({ ...config, whatsappAlerts: e.target.checked })}
                  className="rounded border-border-default"
                />
                <MessageCircle className="w-4 h-4" /> WhatsApp Alerts
              </label>
            </div>
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">Email</label>
              <input
                type="email"
                value={config.email}
                onChange={(e) => setConfig({ ...config, email: e.target.value })}
                placeholder="alerts@company.com"
                className="w-full px-4 py-2 bg-bg-light border border-border-default rounded-lg text-text-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">WhatsApp (with country code)</label>
              <input
                type="text"
                value={config.whatsapp}
                onChange={(e) => setConfig({ ...config, whatsapp: e.target.value })}
                placeholder="+919876543210"
                className="w-full px-4 py-2 bg-bg-light border border-border-default rounded-lg text-text-primary"
              />
            </div>
            <div>
              <p className="text-sm font-medium text-text-primary mb-2">Alert Rules</p>
              <div className="space-y-2">
                {[
                  { key: 'expiring_90', label: 'Lease expiring in 90 days' },
                  { key: 'expiring_30', label: 'Lease expiring in 30 days' },
                  { key: 'expiring_7', label: 'Lease expiring in 7 days' },
                  { key: 'liability_change', label: 'Large lease liability change (>10%)' },
                  { key: 'new_lease', label: 'New lease added to repository' },
                  { key: 'monthly_reminder', label: 'Monthly reminder on 1st' },
                ].map(({ key, label }) => (
                  <label key={key} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.rules[key as keyof typeof config.rules]}
                      onChange={(e) => setConfig({ ...config, rules: { ...config.rules, [key]: e.target.checked } })}
                      className="rounded border-border-default"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="primary" size="md" className="bg-gradient-orange" onClick={handleSaveConfig} disabled={loading}>
                Save Alert Config
              </Button>
              <Button variant="secondary" size="md" onClick={handleSendTest} disabled={loading}>
                <Send className="w-4 h-4 mr-2" /> Send Test Alert
              </Button>
            </div>
          </div>
        </div>

        {/* Alerts Dashboard */}
        <div className="bg-white rounded-[14px] p-6 border border-border-default shadow-card">
          <h3 className="text-base font-bold text-text-primary mb-4 flex items-center gap-2">
            <Bell className="w-5 h-5" /> Pending Alerts {activeCount > 0 && <span className="px-2 py-0.5 bg-red-500 text-white text-xs rounded-full">{activeCount}</span>}
          </h3>
          <div className="space-y-3 max-h-[400px] overflow-y-auto">
            {visibleAlerts.length === 0 ? (
              <p className="text-sm text-text-muted py-8 text-center">No pending alerts</p>
            ) : (
              visibleAlerts.map((a, i) => (
                <div
                  key={i}
                  className={`p-4 rounded-lg border-l-4 ${
                    a.severity === 'red'
                      ? 'bg-red-50 border-red-500'
                      : a.severity === 'amber'
                      ? 'bg-amber-50 border-amber-500'
                      : 'bg-green-50 border-green-500'
                  }`}
                >
                  <p className="font-semibold text-text-primary">{a.title}</p>
                  <p className="text-sm text-text-secondary mt-1">{a.message}</p>
                  <div className="flex gap-2 mt-3">
                    <Button variant="secondary" size="sm" className="!px-2 !py-1 text-xs" onClick={() => setDismissed((s) => new Set([...s, (a.id || '') + (a.type || '')]))}>
                      Dismiss
                    </Button>
                    {a.id && a.id !== 'summary' && (
                      <Link href={`/dashboard/ifrs16/repository`}>
                        <Button variant="secondary" size="sm" className="!px-2 !py-1 text-xs">
                          <Eye className="w-3 h-3 mr-1" /> View Lease
                        </Button>
                      </Link>
                    )}
                    <Button variant="secondary" size="sm" className="!px-2 !py-1 text-xs">
                      <Send className="w-3 h-3 mr-1" /> Send Now
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </SidebarLayout>
  );
}
