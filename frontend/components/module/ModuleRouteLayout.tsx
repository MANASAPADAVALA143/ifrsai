'use client';

import { useState, useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ModuleWorkspaceLayout } from './ModuleWorkspaceLayout';
import type { ModuleNavGroup } from './ModuleSubNav';
import type { ModuleKpiItem } from './ModuleKpiBar';

type ModuleRouteLayoutProps = {
  navGroups: ModuleNavGroup[];
  navTitle?: string;
  kpiItems?: ModuleKpiItem[];
  /** Override auto-detected active id (e.g. in-page sections without routes). */
  activeNavId?: string;
  onNavSelect?: (id: string) => void;
  children: React.ReactNode;
};

function resolveActiveIdFromPath(groups: ModuleNavGroup[], pathname: string): string {
  const items = groups.flatMap((g) => g.items);
  const withHref = items
    .filter((i) => i.href)
    .sort((a, b) => (b.href?.length ?? 0) - (a.href?.length ?? 0));
  for (const item of withHref) {
    if (item.href && (pathname === item.href || pathname.startsWith(`${item.href}/`))) {
      return item.id;
    }
  }
  return items.find((i) => !i.href)?.id ?? items[0]?.id ?? '';
}

export function ModuleRouteLayout({
  navGroups,
  navTitle,
  kpiItems,
  activeNavId: activeNavIdProp,
  onNavSelect: onNavSelectProp,
  children,
}: ModuleRouteLayoutProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const pathActiveId = useMemo(() => resolveActiveIdFromPath(navGroups, pathname), [navGroups, pathname]);
  const activeNavId = activeNavIdProp ?? pathActiveId;

  const handleNavSelect = (id: string) => {
    if (onNavSelectProp) {
      onNavSelectProp(id);
      return;
    }
    const item = navGroups.flatMap((g) => g.items).find((i) => i.id === id);
    if (item?.href) router.push(item.href);
  };

  return (
    <ModuleWorkspaceLayout
      navGroups={navGroups}
      activeNavId={activeNavId}
      onNavSelect={handleNavSelect}
      mobileNavOpen={mobileNavOpen}
      onMobileNavOpenChange={setMobileNavOpen}
      kpiItems={kpiItems}
      navTitle={navTitle}
    >
      {children}
    </ModuleWorkspaceLayout>
  );
}
