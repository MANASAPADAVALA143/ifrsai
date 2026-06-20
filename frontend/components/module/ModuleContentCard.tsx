import type { ReactNode } from 'react';

type ModuleContentCardProps = {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
};

/** Standard enterprise content card — white, 8px radius, 24px padding, #E5E7EB border */
export function ModuleContentCard({ title, subtitle, children, className = '' }: ModuleContentCardProps) {
  return (
    <div className={`bg-white rounded-lg p-6 border border-[#E5E7EB] shadow-sm ${className}`}>
      {title ? (
        <div className="border-b border-[#E5E7EB] pb-4 mb-6">
          <h3 className="text-lg font-bold text-text-primary">{title}</h3>
          {subtitle ? <p className="text-xs text-text-muted mt-1">{subtitle}</p> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}
