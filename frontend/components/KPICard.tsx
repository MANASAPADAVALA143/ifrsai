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
        'bg-white rounded-lg p-6 shadow-sm border border-gray-100 hover:shadow-md transition-shadow',
        className
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-600 mb-1">{title}</p>
          <p className="text-2xl font-bold text-primary mb-1">{value}</p>
          {subtitle && (
            <p className="text-xs text-gray-500">{subtitle}</p>
          )}
        </div>
        <div className="bg-accent/10 p-3 rounded-lg">
          <Icon className="w-6 h-6 text-accent" />
        </div>
      </div>
      {trend && (
        <div className="mt-4 flex items-center text-sm">
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
