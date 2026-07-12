'use client';

import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface KPICardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  subtitle?: string;
  className?: string;
}

export function KPICard({
  title,
  value,
  icon: Icon,
  trend,
  subtitle,
  className,
}: KPICardProps) {
  return (
    <div
      className={cn(
        'bg-white rounded-lg p-4 shadow-sm border border-gray-100 hover:shadow-md transition-shadow',
        className
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-gray-600 mb-0.5">{title}</p>
          <p className="text-lg font-bold text-primary leading-tight truncate">{value}</p>
          {subtitle && (
            <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>
          )}
        </div>
        <div className="bg-accent/10 p-2 rounded-md shrink-0">
          <Icon className="w-4 h-4 text-accent" />
        </div>
      </div>
      {trend && (
        <div className="mt-2 flex items-center text-xs">
          <span
            className={cn(
              'font-medium',
              trend.isPositive ? 'text-success' : 'text-red-500'
            )}
          >
            {trend.isPositive ? '+' : ''}{trend.value}%
          </span>
          <span className="text-gray-500 ml-2">vs last month</span>
        </div>
      )}
    </div>
  );
}
