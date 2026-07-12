'use client';

import type { ReactNode } from 'react';

/** Blue contextual help callout (matches Core lease dates pattern). */
export function ContextHelpCallout({
  children,
  variant = 'info',
}: {
  children: ReactNode;
  variant?: 'info' | 'tip';
}) {
  const styles =
    variant === 'tip'
      ? { background: '#FFFBEB', borderLeftColor: '#D97706' }
      : { background: '#E6F1FB', borderLeftColor: '#378ADD' };
  return (
    <div
      className="text-[11px] text-[#1e293b] rounded-r-md px-2.5 py-2 mb-3 border-l-[3px]"
      style={styles}
    >
      {children}
    </div>
  );
}

/** Collapsed-by-default accordion section (matches Assets & Locations Additional details). */
export function CollapsibleFormSection({
  title,
  subtitle,
  children,
  defaultOpen = false,
  tintClass = 'bg-[#f8fafc]',
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  defaultOpen?: boolean;
  tintClass?: string;
}) {
  return (
    <details
      className={`mb-2 border border-[#e2e8f0] rounded-lg overflow-hidden ${tintClass}`}
      {...(defaultOpen ? { open: true } : {})}
    >
      <summary className="px-2.5 py-1.5 bg-white/60 text-xs font-semibold text-[#1e293b] cursor-pointer list-none flex items-center justify-between gap-2">
        <span>
          {title}
          {subtitle && (
            <span className="block text-[10px] font-normal text-[#64748b] mt-0.5">{subtitle}</span>
          )}
        </span>
        <span className="text-[10px] font-medium text-[#64748b] uppercase tracking-wide shrink-0">
          {defaultOpen ? 'Expanded' : 'Optional'}
        </span>
      </summary>
      <div className="p-2.5 border-t border-[#e2e8f0] bg-white/50">{children}</div>
    </details>
  );
}

/** Card section with light background tint for visual separation. */
export function TintedSectionCard({
  title,
  icon,
  badge,
  tintClass,
  borderClass,
  children,
}: {
  title: string;
  icon?: ReactNode;
  badge?: ReactNode;
  tintClass: string;
  borderClass: string;
  children: ReactNode;
}) {
  return (
    <div className={`${tintClass} border ${borderClass} rounded-lg p-2.5 mb-2`}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          {icon}
          <h3 className="text-xs font-semibold text-gray-800">{title}</h3>
        </div>
        {badge}
      </div>
      {children}
    </div>
  );
}

export function RequiredMark() {
  return (
    <span className="text-[#DC2626] font-bold ml-0.5 text-sm leading-none" aria-hidden>
      *
    </span>
  );
}
