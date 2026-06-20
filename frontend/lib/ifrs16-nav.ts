import {
  BarChart3,
  Building2,
  Calculator,
  FileBarChart,
  FolderOpen,
  Layers,
  Sparkles,
  Upload,
} from 'lucide-react';
import type { ModuleNavGroup } from '@/components/module/ModuleSubNav';

export type Ifrs16NavId =
  | 'overview'
  | 'new-lease'
  | 'upload'
  | 'repository'
  | 'quick-analysis'
  | 'cfo-insights'
  | 'reports'
  | 'lessor'
  | 'sale-leaseback'
  | 'comparative'
  | 'bulk-upload'
  | 'erp-export';

export const IFRS16_NAV_GROUPS: ModuleNavGroup[] = [
  {
    id: 'leases',
    title: 'LEASES',
    items: [
      { id: 'overview', label: 'Overview', icon: BarChart3 },
      { id: 'new-lease', label: 'New Lease', icon: Upload, href: '/dashboard/ifrs16/new' },
      { id: 'upload', label: 'Upload Contract', icon: Upload, href: '/dashboard/ifrs16/upload' },
      { id: 'repository', label: 'Lease Repository', icon: FolderOpen, href: '/dashboard/ifrs16/repository' },
      { id: 'bulk-upload', label: 'Bulk Upload', icon: Layers, href: '/dashboard/ifrs16/bulk-upload' },
    ],
  },
  {
    id: 'analysis',
    title: 'ANALYSIS',
    items: [
      { id: 'quick-analysis', label: 'Quick Analysis', icon: Calculator, href: '/dashboard/ifrs16/quick-analysis' },
      { id: 'cfo-insights', label: 'CFO Insights', icon: Sparkles, href: '/dashboard/ifrs16/cfo-insights' },
      { id: 'comparative', label: 'Comparative', icon: BarChart3, href: '/dashboard/ifrs16/comparative' },
    ],
  },
  {
    id: 'special',
    title: 'SPECIAL TOPICS',
    items: [
      { id: 'lessor', label: 'Lessor Accounting', icon: Building2, href: '/dashboard/ifrs16/lessor' },
      { id: 'sale-leaseback', label: 'Sale-Leaseback', icon: Layers, href: '/dashboard/ifrs16/sale-leaseback' },
    ],
  },
  {
    id: 'reports',
    title: 'REPORTS',
    items: [
      { id: 'reports', label: 'Reports Hub', icon: FileBarChart, href: '/dashboard/ifrs16/reports' },
      { id: 'erp-export', label: 'ERP Export', icon: Upload, href: '/dashboard/ifrs16/erp' },
    ],
  },
];

export function ifrs16NavHref(id: Ifrs16NavId): string | undefined {
  const item = IFRS16_NAV_GROUPS.flatMap((g) => g.items).find((i) => i.id === id);
  return item?.href;
}

export const IFRS16_LEASE_STEPS = [
  { id: 1, label: 'Contract Details', description: 'Parties, dates & terms' },
  { id: 2, label: 'Financial Management', description: 'Payments, IBR & costs' },
  { id: 3, label: 'Modifications', description: 'Remeasurement & changes' },
  { id: 4, label: 'Assets & Locations', description: 'ROU asset mapping' },
  { id: 5, label: 'Schedules', description: 'Liability & depreciation' },
  { id: 6, label: 'Disclosures', description: 'IFRS 16 notes' },
  { id: 7, label: 'Review & Export', description: 'Journals, PDF & Excel' },
];

export type Ifrs16LeaseTabId =
  | 'contract'
  | 'financial'
  | 'modifications'
  | 'assets'
  | 'schedules'
  | 'disclosures'
  | 'review';

const IFRS16_TAB_STEP_ORDER: Ifrs16LeaseTabId[] = [
  'contract',
  'financial',
  'modifications',
  'assets',
  'schedules',
  'disclosures',
  'review',
];

export function ifrs16TabToStep(tab: Ifrs16LeaseTabId): number {
  const idx = IFRS16_TAB_STEP_ORDER.indexOf(tab);
  return idx >= 0 ? idx + 1 : 1;
}

export function ifrs16StepToTab(step: number): Ifrs16LeaseTabId {
  return IFRS16_TAB_STEP_ORDER[Math.max(0, Math.min(step - 1, IFRS16_TAB_STEP_ORDER.length - 1))] ?? 'contract';
}

export const IFRS16_QUICK_ANALYSIS_STEPS = [
  { id: 1, label: 'Upload', description: 'Lease file intake' },
  { id: 2, label: 'Review Data', description: 'Validate parsed rows' },
  { id: 3, label: 'Calculate', description: 'Run IFRS 16 engine' },
  { id: 4, label: 'Results', description: 'Report pack & export' },
];

export type Ifrs16QuickAnalysisPhase = 'upload' | 'preview' | 'loading' | 'results';

export function ifrs16QuickAnalysisPhaseToStep(phase: Ifrs16QuickAnalysisPhase): number {
  switch (phase) {
    case 'upload':
      return 1;
    case 'preview':
      return 2;
    case 'loading':
      return 3;
    case 'results':
      return 4;
    default:
      return 1;
  }
}

export function ifrs16QuickAnalysisStepToPhase(step: number): Ifrs16QuickAnalysisPhase {
  if (step <= 1) return 'upload';
  if (step === 2) return 'preview';
  if (step === 3) return 'loading';
  return 'results';
}
