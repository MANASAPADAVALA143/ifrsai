'use client';

import { SidebarLayout } from '@/components/SidebarLayout';
import Link from 'next/link';
import {
  BarChart2,
  CreditCard,
  FileText,
  Building2,
  Clock,
  TrendingDown,
  Percent,
  TrendingUp,
  HardHat,
  Wrench,
  ArrowRightLeft,
  Calendar,
  ChevronRight,
} from 'lucide-react';

const REPORTS = [
  { href: '/dashboard/ifrs16/reports/summary-movement', name: 'Summary Movement Report', description: 'Liability & ROU movement by period', icon: BarChart2 },
  { href: '/dashboard/ifrs16/reports/payment-detail', name: 'Payment Detail Report', description: 'All payments across portfolio', icon: CreditCard },
  { href: '/dashboard/ifrs16/reports/payment-summary', name: 'Payment Summary Report', description: 'Payment summary per lease', icon: FileText },
  { href: '/dashboard/ifrs16/reports/assets-detail', name: 'Assets Detail Report', description: 'ROU assets and NBV', icon: Building2 },
  { href: '/dashboard/ifrs16/reports/lease-expiry', name: 'Lease Expiry Report', description: 'Upcoming renewals and expirations', icon: Clock },
  { href: '/dashboard/ifrs16/reports/depreciation', name: 'Depreciation Schedule Report', description: 'Monthly depreciation by lease', icon: TrendingDown },
  { href: '/dashboard/ifrs16/reports/interest', name: 'Interest Schedule Report', description: 'Monthly interest expense', icon: Percent },
  { href: '/dashboard/ifrs16/reports/liability-movement', name: 'Liability Movement Report', description: 'LL opening to closing movement', icon: TrendingUp },
  { href: '/dashboard/ifrs16/reports/rou-movement', name: 'ROU Movement Report', description: 'ROU asset movement schedule', icon: HardHat },
  { href: '/dashboard/ifrs16/reports/restoration', name: 'Restoration Schedule Report', description: 'Provision unwinding schedule', icon: Wrench },
  { href: '/dashboard/ifrs16/reports/fx', name: 'FX Schedule Report', description: 'Foreign exchange impact', icon: ArrowRightLeft },
  { href: '/dashboard/ifrs16/reports/maturity', name: 'Liability Maturity Report', description: 'Maturity analysis for disclosures', icon: Calendar },
];

export default function IFRS16ReportsPage() {
  return (
    <SidebarLayout pageTitle="IFRS 16 Reports" pageSubtitle="Portfolio-level reports across all leases">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {REPORTS.map((r) => {
          const Icon = r.icon;
          return (
            <Link
              key={r.href}
              href={r.href}
              className="block p-6 bg-white border border-[#e2e8f0] rounded-xl hover:border-[#f97316] hover:shadow-md transition-all"
            >
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-lg bg-[#fff7ed] flex items-center justify-center shrink-0">
                  <Icon className="w-6 h-6 text-[#f97316]" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-[#1e293b] mb-1">{r.name}</h3>
                  <p className="text-sm text-[#64748b] mb-3">{r.description}</p>
                  <span className="text-sm font-medium text-[#f97316] flex items-center gap-1">
                    Open Report <ChevronRight className="w-4 h-4" />
                  </span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </SidebarLayout>
  );
}
