'use client';

import { ModuleSubNav, type ModuleNavGroup } from './ModuleSubNav';
import { ModuleKpiBar, type ModuleKpiItem } from './ModuleKpiBar';

type ModuleWorkspaceLayoutProps = {
  navGroups: ModuleNavGroup[];
  activeNavId: string;
  onNavSelect: (id: string) => void;
  mobileNavOpen: boolean;
  onMobileNavOpenChange: (open: boolean) => void;
  kpiItems?: ModuleKpiItem[];
  navTitle?: string;
  dockedNav?: boolean;
  children: React.ReactNode;
};

export function ModuleWorkspaceLayout({
  navGroups,
  activeNavId,
  onNavSelect,
  mobileNavOpen,
  onMobileNavOpenChange,
  kpiItems,
  navTitle,
  dockedNav = true,
  children,
}: ModuleWorkspaceLayoutProps) {
  return (
    <div className="flex flex-col lg:flex-row gap-6 items-start">
      <ModuleSubNav
        groups={navGroups}
        activeId={activeNavId}
        onSelect={onNavSelect}
        mobileOpen={mobileNavOpen}
        onMobileOpenChange={onMobileNavOpenChange}
        title={navTitle}
        docked={dockedNav}
      />
      <div className={dockedNav ? 'flex-1 min-w-0 w-full lg:ml-[220px]' : 'flex-1 min-w-0 w-full'}>
        {kpiItems && kpiItems.length > 0 ? <ModuleKpiBar items={kpiItems} /> : null}
        <div className="space-y-6">{children}</div>
      </div>
    </div>
  );
}
