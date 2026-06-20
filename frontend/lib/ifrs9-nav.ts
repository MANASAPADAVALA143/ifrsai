import {
  BarChart3,
  Calculator,
  FileBarChart,
  FolderOpen,
  Layers,
  Plus,
  TrendingUp,
} from 'lucide-react';
import type { ModuleNavGroup } from '@/components/module/ModuleSubNav';

export type Ifrs9NavId =
  | 'overview'
  | 'new-portfolio'
  | 'portfolios'
  | 'calculate'
  | 'classification'
  | 'provision-matrix'
  | 'macro-overlay'
  | 'reconciliation'
  | 'reports';

export const IFRS9_NAV_GROUPS: ModuleNavGroup[] = [
  {
    id: 'portfolios',
    title: 'PORTFOLIOS',
    items: [
      { id: 'overview', label: 'Overview', icon: BarChart3 },
      { id: 'new-portfolio', label: 'New Portfolio', icon: Plus, href: '/dashboard/ifrs9/portfolios/new' },
      { id: 'portfolios', label: 'All Portfolios', icon: FolderOpen, href: '/dashboard/ifrs9/portfolios' },
    ],
  },
  {
    id: 'ecl',
    title: 'ECL ENGINE',
    items: [
      { id: 'calculate', label: 'Calculate ECL', icon: Calculator },
      { id: 'classification', label: 'Classification', icon: Layers },
      { id: 'provision-matrix', label: 'Provision Matrix', icon: BarChart3 },
      { id: 'macro-overlay', label: 'Macro Overlay', icon: TrendingUp },
    ],
  },
  {
    id: 'reports',
    title: 'REPORTS',
    items: [
      { id: 'reconciliation', label: 'Reconciliation', icon: FileBarChart },
      { id: 'reports', label: 'Export & Reports', icon: FileBarChart },
    ],
  },
];

export function ifrs9NavHref(id: Ifrs9NavId): string | undefined {
  const item = IFRS9_NAV_GROUPS.flatMap((g) => g.items).find((i) => i.id === id);
  return item?.href;
}

export const IFRS9_ECL_STEPS = [
  { id: 1, label: 'Classification', description: 'Business model & SPPI assessment' },
  { id: 2, label: 'Provision Matrix', description: 'Ageing buckets & loss rates' },
  { id: 3, label: 'Calculate ECL', description: 'Stage allocation & provision' },
  { id: 4, label: 'Macro Overlay', description: 'Forward-looking adjustments' },
  { id: 5, label: 'Reports & Export', description: 'Reconciliation & master report' },
];

const IFRS9_STEP_NAV: Ifrs9NavId[] = [
  'classification',
  'provision-matrix',
  'calculate',
  'macro-overlay',
  'reports',
];

export function ifrs9NavIdToStep(navId: Ifrs9NavId): number | null {
  if (navId === 'reconciliation') return 5;
  const idx = IFRS9_STEP_NAV.indexOf(navId);
  return idx >= 0 ? idx + 1 : null;
}

export function ifrs9StepToNavId(step: number): Ifrs9NavId {
  return IFRS9_STEP_NAV[Math.max(0, Math.min(step - 1, IFRS9_STEP_NAV.length - 1))] ?? 'classification';
}

export function isIfrs9EclWorkflowNav(navId: Ifrs9NavId): boolean {
  return (
    navId === 'classification' ||
    navId === 'provision-matrix' ||
    navId === 'calculate' ||
    navId === 'macro-overlay' ||
    navId === 'reconciliation' ||
    navId === 'reports'
  );
}

export const IFRS9_PORTFOLIO_STEPS = [
  { id: 1, label: 'Instrument Details', description: 'Portfolio setup & upload' },
  { id: 2, label: 'Classification', description: 'Measurement category' },
  { id: 3, label: 'Staging', description: 'Stage 1 / 2 / 3 assignment' },
  { id: 4, label: 'ECL Calculation', description: 'Run provision engine' },
  { id: 5, label: 'Scenario Analysis', description: 'Macro & stress tests' },
  { id: 6, label: 'Results & Audit', description: 'Export & audit trail' },
];

export type Ifrs9PortfolioTabId =
  | 'instrument'
  | 'classification'
  | 'staging'
  | 'ecl'
  | 'scenario'
  | 'results';

const IFRS9_PORTFOLIO_TAB_ORDER: Ifrs9PortfolioTabId[] = [
  'instrument',
  'classification',
  'staging',
  'ecl',
  'scenario',
  'results',
];

export function ifrs9PortfolioTabToStep(tab: Ifrs9PortfolioTabId): number {
  const idx = IFRS9_PORTFOLIO_TAB_ORDER.indexOf(tab);
  return idx >= 0 ? idx + 1 : 1;
}

export function ifrs9PortfolioStepToTab(step: number): Ifrs9PortfolioTabId {
  return IFRS9_PORTFOLIO_TAB_ORDER[Math.max(0, Math.min(step - 1, IFRS9_PORTFOLIO_TAB_ORDER.length - 1))] ?? 'instrument';
}
