import {
  Building2,
  Calculator,
  ClipboardList,
  FileText,
  FolderOpen,
  Layers,
  PieChart,
  Scale,
  Shield,
  Upload,
  Wallet,
} from 'lucide-react';
import type { ModuleNavGroup } from '@/components/module/ModuleSubNav';

export type Ifrs15NavId =
  | 'portfolio'
  | 'new-contract'
  | 'realestate-uae'
  | 'revenue-calculate'
  | 'deferred-revenue'
  | 'rpo-disclosure'
  | 'variable-consideration'
  | 'principal-agent'
  | 'contract-modifications'
  | 'warranties-material-rights'
  | 'bill-and-hold'
  | 'financing-component'
  | 'contract-costs'
  | 'licenses-ip'
  | 'tp-adjustments'
  | 'audit-trail'
  | 'client-report'
  | 'master-report';

export type Ifrs15DashTab =
  | 'portfolio'
  | 'calculate'
  | 'deferred-rev'
  | 'rpo'
  | 'principal-agent'
  | 'contract-costs'
  | 'licenses-ip'
  | 'audit-trail'
  | 'warranties-material-rights'
  | 'bill-and-hold'
  | 'financing-component'
  | 'tp-adjustments';

export const IFRS15_NAV_GROUPS: ModuleNavGroup[] = [
  {
    id: 'contracts',
    title: 'CONTRACTS',
    items: [
      { id: 'portfolio', label: 'Portfolio', icon: FolderOpen },
      { id: 'new-contract', label: 'New Contract', icon: Upload },
      { id: 'realestate-uae', label: 'Real Estate UAE', icon: Building2, href: '/dashboard/ifrs15/realestate' },
    ],
  },
  {
    id: 'recognition',
    title: 'RECOGNITION',
    items: [
      { id: 'revenue-calculate', label: 'Revenue Calculate', icon: Calculator },
      { id: 'deferred-revenue', label: 'Deferred Revenue', icon: Wallet },
      { id: 'rpo-disclosure', label: 'RPO Disclosure', icon: PieChart },
    ],
  },
  {
    id: 'compliance',
    title: 'COMPLIANCE',
    items: [
      { id: 'variable-consideration', label: 'Variable Consideration', icon: Scale },
      { id: 'principal-agent', label: 'Principal vs Agent', icon: Shield },
      { id: 'contract-modifications', label: 'Contract Modifications', icon: Layers },
      { id: 'warranties-material-rights', label: 'Warranties & Material Rights', icon: ClipboardList },
      { id: 'bill-and-hold', label: 'Bill-and-Hold', icon: FileText },
      { id: 'financing-component', label: 'Financing Component', icon: Wallet },
      { id: 'contract-costs', label: 'Contract Costs', icon: Calculator },
      { id: 'licenses-ip', label: 'Licenses of IP', icon: FileText },
      { id: 'tp-adjustments', label: 'TP Adjustments', icon: Scale },
    ],
  },
  {
    id: 'reports',
    title: 'REPORTS',
    items: [
      { id: 'audit-trail', label: 'Audit Trail', icon: ClipboardList },
      { id: 'client-report', label: 'Client PDF Report', icon: FileText },
      { id: 'master-report', label: 'Master Report & Excel', icon: FileText },
    ],
  },
];

export const IFRS15_CALCULATE_STEPS = [
  { id: 1, label: 'Contract Details', description: 'Upload, extract & identify contract' },
  { id: 2, label: 'Performance Obligations', description: 'POBs & transaction price' },
  { id: 3, label: 'Revenue Schedule', description: 'Recognition & journals' },
  { id: 4, label: 'Compliance Checks', description: 'VC, modifications & assessments' },
  { id: 5, label: 'Reports & Export', description: 'Disclosures, PDF & Excel' },
];

export function navIdToDashTab(navId: Ifrs15NavId): Ifrs15DashTab {
  const map: Record<Ifrs15NavId, Ifrs15DashTab> = {
    portfolio: 'portfolio',
    'new-contract': 'calculate',
    'realestate-uae': 'calculate',
    'revenue-calculate': 'calculate',
    'deferred-revenue': 'deferred-rev',
    'rpo-disclosure': 'rpo',
    'variable-consideration': 'calculate',
    'principal-agent': 'principal-agent',
    'contract-modifications': 'calculate',
    'warranties-material-rights': 'warranties-material-rights',
    'bill-and-hold': 'bill-and-hold',
    'financing-component': 'financing-component',
    'contract-costs': 'contract-costs',
    'licenses-ip': 'licenses-ip',
    'tp-adjustments': 'tp-adjustments',
    'audit-trail': 'audit-trail',
    'client-report': 'calculate',
    'master-report': 'calculate',
  };
  return map[navId] ?? 'calculate';
}

export function navIdToCalculateStep(navId: Ifrs15NavId): number | null {
  switch (navId) {
    case 'new-contract':
      return 1;
    case 'revenue-calculate':
      return 1;
    case 'variable-consideration':
    case 'contract-modifications':
      return 4;
    case 'client-report':
    case 'master-report':
      return 5;
    default:
      return null;
  }
}

export function dashTabToNavId(tab: Ifrs15DashTab): Ifrs15NavId {
  const map: Record<Ifrs15DashTab, Ifrs15NavId> = {
    portfolio: 'portfolio',
    calculate: 'revenue-calculate',
    'deferred-rev': 'deferred-revenue',
    rpo: 'rpo-disclosure',
    'principal-agent': 'principal-agent',
    'contract-costs': 'contract-costs',
    'licenses-ip': 'licenses-ip',
    'audit-trail': 'audit-trail',
    'warranties-material-rights': 'warranties-material-rights',
    'bill-and-hold': 'bill-and-hold',
    'financing-component': 'financing-component',
    'tp-adjustments': 'tp-adjustments',
  };
  return map[tab] ?? 'revenue-calculate';
}

export function applyNavSideEffects(
  navId: Ifrs15NavId,
  setters: {
    setShowVcSection: (v: boolean) => void;
    setShowModificationSection: (v: boolean) => void;
    setIsClientReportModalOpen: (v: boolean) => void;
    generateMasterReport?: () => void;
  }
) {
  if (navId === 'variable-consideration') setters.setShowVcSection(true);
  if (navId === 'contract-modifications') setters.setShowModificationSection(true);
  if (navId === 'client-report') setters.setIsClientReportModalOpen(true);
  if (navId === 'master-report' && setters.generateMasterReport) setters.generateMasterReport();
}
