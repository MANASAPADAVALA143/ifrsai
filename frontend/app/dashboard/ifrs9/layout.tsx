'use client';

import { useMemo, useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { ModuleRouteLayout } from '@/components/module/ModuleRouteLayout';
import { IFRS9_NAV_GROUPS } from '@/lib/ifrs9-nav';
import { getEclPortfolioRepository } from '@/lib/ecl-portfolio-repository';
import { formatIndianCurrency } from '@/lib/utils';

function fmtKpi(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return formatIndianCurrency(n);
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return `${Number(n).toFixed(2)}%`;
}

export default function Ifrs9Layout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [portfolios, setPortfolios] = useState<ReturnType<typeof getEclPortfolioRepository>>([]);

  const load = useCallback(() => setPortfolios(getEclPortfolioRepository()), []);
  useEffect(() => {
    load();
    const onStorage = () => load();
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [load]);

  const kpiItems = useMemo(() => {
    const withEcl = portfolios.filter((p) => p.applicableEcl != null || p.ecl12m != null || p.eclLifetime != null);
    const totalEad = withEcl.reduce(
      (s, p) => s + (Number(p.ead || p.outstandingBalance || p.grossCarryingAmount) || 0),
      0
    );
    const totalEcl = withEcl.reduce((s, p) => s + (Number(p.applicableEcl ?? p.eclLifetime ?? p.ecl12m) || 0), 0);
    const avgPd =
      withEcl.length > 0
        ? withEcl.reduce((s, p) => {
            const st = p.stage || 1;
            const pd = st === 1 ? Number(p.pd12m ?? 0) : Number(p.pdLifetime ?? 0);
            return s + pd;
          }, 0) / withEcl.length
        : null;
    const coverage = totalEad > 0 ? (totalEcl / totalEad) * 100 : null;

    return [
      { label: 'Total Portfolio Value (EAD)', value: withEcl.length ? fmtKpi(totalEad) : '—', accent: 'orange' as const },
      { label: 'Total ECL Provision', value: withEcl.length ? fmtKpi(totalEcl) : '—', accent: 'orange' as const },
      { label: 'Weighted Average PD', value: avgPd != null ? fmtPct(avgPd) : '—', accent: 'orange' as const },
      { label: 'Coverage Ratio', value: coverage != null ? fmtPct(coverage) : '—', accent: 'pink' as const },
    ];
  }, [portfolios]);

  const showShell = pathname?.startsWith('/dashboard/ifrs9');

  if (!showShell) return <>{children}</>;

  // Overview page supplies live KPI values via its own ModuleWorkspaceLayout.
  if (pathname === '/dashboard/ifrs9') return <>{children}</>;

  return (
    <ModuleRouteLayout navGroups={IFRS9_NAV_GROUPS} navTitle="IFRS 9 Menu" kpiItems={kpiItems}>
      {children}
    </ModuleRouteLayout>
  );
}
