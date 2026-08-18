'use client';

import { HelpCircle } from 'lucide-react';

export type ModuleKpiItem = {
  label: string;
  value: string;
  accent?: 'orange' | 'pink' | 'default';
  helpText?: string;
};

type ModuleKpiBarProps = {
  items: ModuleKpiItem[];
};

export function ModuleKpiBar({ items }: ModuleKpiBarProps) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
      {items.map((item) => (
        <div
          key={item.label}
          className="bg-white rounded-lg p-3 border border-[#E5E7EB] shadow-sm min-w-0"
        >
          <div
            className={`h-1 rounded-t-full -mt-3 -mx-3 mb-2 ${
              item.accent === 'pink'
                ? 'bg-gradient-to-r from-pink-500 to-rose-400'
                : item.accent === 'orange'
                  ? 'bg-gradient-to-r from-[#F97316] to-amber-500'
                  : 'bg-gradient-to-r from-[#F97316] to-amber-500'
            }`}
          />
          <div className="flex items-center gap-1.5 mb-1">
            <h4 className="text-xs font-medium text-text-secondary truncate">{item.label}</h4>
            {item.helpText ? (
              <span title={item.helpText} className="inline-flex cursor-help shrink-0">
                <HelpCircle className="w-3.5 h-3.5 text-text-muted" />
              </span>
            ) : null}
          </div>
          <p className="text-lg font-bold text-text-primary amount truncate" title={item.value}>{item.value}</p>
        </div>
      ))}
    </div>
  );
}
