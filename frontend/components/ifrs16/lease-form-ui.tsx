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
      className="text-xs text-[#1e293b] rounded-r-md px-3 py-2.5 mb-4 border-l-[3px]"
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
      className={`mb-4 border border-[#e2e8f0] rounded-xl overflow-hidden ${tintClass}`}
      {...(defaultOpen ? { open: true } : {})}
    >
      <summary className="px-4 py-3 bg-white/60 text-sm font-semibold text-[#1e293b] cursor-pointer list-none flex items-center justify-between gap-2">
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
      <div className="p-4 border-t border-[#e2e8f0] bg-white/50">{children}</div>
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
    <div className={`${tintClass} border ${borderClass} rounded-xl p-5 mb-4`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
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
