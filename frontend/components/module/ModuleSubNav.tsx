'use client';

import Link from 'next/link';
import { Menu, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type ModuleNavItem = {
  id: string;
  label: string;
  icon?: LucideIcon;
  href?: string;
  badge?: string;
};

export type ModuleNavGroup = {
  id: string;
  title: string;
  items: ModuleNavItem[];
};

type ModuleSubNavProps = {
  groups: ModuleNavGroup[];
  activeId: string;
  onSelect: (id: string) => void;
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
  title?: string;
  /** When true, sidebar is fixed under the top app bar (IFRS 15/9 single-nav mode). */
  docked?: boolean;
};

export function ModuleSubNav({
  groups,
  activeId,
  onSelect,
  mobileOpen,
  onMobileOpenChange,
  title = 'Navigation',
  docked = false,
}: ModuleSubNavProps) {
  const navBody = (
    <nav className="flex flex-col gap-5 py-4 px-3">
      {groups.map((group) => (
        <div key={group.id}>
          <p className="px-3 mb-2 text-[10px] font-bold uppercase tracking-wider text-text-muted flex items-center gap-1">
            <span className="text-orange-primary">▶</span> {group.title}
          </p>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = activeId === item.id;
              const baseClass = `w-full flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium rounded-r-md transition-colors text-left ${
                active
                  ? 'bg-white text-orange-primary border-l-[3px] border-orange-primary shadow-sm'
                  : 'text-text-secondary hover:bg-white/80 hover:text-text-primary border-l-[3px] border-transparent'
              }`;

              if (item.href) {
                return (
                  <li key={item.id}>
                    <Link href={item.href} className={baseClass} onClick={() => onMobileOpenChange(false)}>
                      {Icon ? <Icon className="w-4 h-4 shrink-0 opacity-80" /> : null}
                      <span className="leading-snug">{item.label}</span>
                      {item.badge ? (
                        <span className="ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">
                          {item.badge}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              }

              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(item.id);
                      onMobileOpenChange(false);
                    }}
                    className={baseClass}
                  >
                    {Icon ? <Icon className="w-4 h-4 shrink-0 opacity-80" /> : null}
                    <span className="leading-snug">{item.label}</span>
                    {item.badge ? (
                      <span className="ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">
                        {item.badge}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <>
      <button
        type="button"
        className="lg:hidden flex items-center gap-2 mb-4 px-4 py-2.5 rounded-lg border border-border-default bg-white text-sm font-semibold text-text-primary shadow-sm"
        onClick={() => onMobileOpenChange(!mobileOpen)}
        aria-expanded={mobileOpen}
      >
        {mobileOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
        {title}
      </button>

      {mobileOpen ? (
        <div
          className="lg:hidden fixed inset-0 z-50 bg-black/40"
          onClick={() => onMobileOpenChange(false)}
          aria-hidden
        />
      ) : null}

      <aside
        className={`shrink-0 w-[220px] bg-[#F8F9FA] border border-[#E5E7EB] rounded-lg overflow-y-auto overflow-x-hidden ${
          docked
            ? 'hidden lg:block lg:fixed lg:left-0 lg:top-14 lg:bottom-0 lg:rounded-none lg:border-y-0 lg:border-l-0 lg:z-30'
            : 'lg:sticky lg:top-6 lg:self-start'
        } ${mobileOpen ? 'fixed left-0 top-0 bottom-0 z-[51] shadow-xl block' : docked ? '' : 'hidden lg:block'}`}
      >
        {navBody}
      </aside>
    </>
  );
}
