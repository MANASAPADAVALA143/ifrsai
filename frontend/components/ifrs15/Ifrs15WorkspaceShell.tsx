'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ModuleWorkspaceLayout } from '@/components/module/ModuleWorkspaceLayout';
import type { ModuleKpiItem } from '@/components/module/ModuleKpiBar';
import { IFRS15_NAV_GROUPS, type Ifrs15NavId } from '@/lib/ifrs15-nav';

const DEFAULT_KPIS: ModuleKpiItem[] = [
  { label: 'Total Contract Value', value: '—', accent: 'orange' },
  { label: 'Revenue Recognised', value: '—', accent: 'orange' },
  { label: 'Deferred Revenue (Contract Liability)', value: '—', accent: 'orange' },
  { label: 'Contract Assets', value: '—', accent: 'pink' },
];

type Ifrs15WorkspaceShellProps = {
  activeNavId: Ifrs15NavId;
  kpiItems?: ModuleKpiItem[];
  children: React.ReactNode;
};

export function Ifrs15WorkspaceShell({ activeNavId, kpiItems = DEFAULT_KPIS, children }: Ifrs15WorkspaceShellProps) {
  const router = useRouter();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const handleNavSelect = (navId: string) => {
    const item = IFRS15_NAV_GROUPS.flatMap((g) => g.items).find((i) => i.id === navId);
    if (item?.href) {
      router.push(item.href);
      return;
    }
    router.push('/dashboard/ifrs15');
  };

  return (
    <ModuleWorkspaceLayout
      navGroups={IFRS15_NAV_GROUPS}
      activeNavId={activeNavId}
      onNavSelect={handleNavSelect}
      mobileNavOpen={mobileNavOpen}
      onMobileNavOpenChange={setMobileNavOpen}
      kpiItems={kpiItems}
      navTitle="IFRS 15 Menu"
    >
      {children}
    </ModuleWorkspaceLayout>
  );
}
