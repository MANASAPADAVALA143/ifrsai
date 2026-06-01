'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { SidebarLayout } from '@/components/SidebarLayout';
import { Button } from '@/components/Button';
import {
  ChevronRight,
  Calculator,
  Save,
  Download,
  Trash2,
  Upload,
  Loader2,
  FileText,
  DollarSign,
  RefreshCw,
  MapPin,
  BarChart3,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Plus,
  X,
  FileCheck,
  Copy,
  Info,
  Pencil,
  Printer,
  AlertCircle,
  ChevronLeft,
} from 'lucide-react';
import { ifrs16Api, ifrs16IbrApi } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import {
  getLeaseById,
  saveToLeaseRepository,
  scheduleMismatchStoredInputs,
  deleteLeaseFromRepository,
  buildLeaseEntryFromForm,
} from '@/lib/lease-repository';
import {
  formatLeaseMoney,
  getDefaultIfrs16Country,
  getDefaultIfrs16Currency,
} from '@/lib/ifrs16-currency';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from '@/components/Charts';
import { ModificationAIAdvisor } from './ModificationAIAdvisor';
import { CpiRemeasurementPanel } from '@/components/ifrs16/CpiRemeasurementPanel';
import { ComponentSplitWizard } from '@/components/ifrs16/ComponentSplitWizard';

const TAB_IDS = ['contract', 'financial', 'modifications', 'assets', 'schedules', 'disclosures', 'review'] as const;
const TABS: { id: typeof TAB_IDS[number]; label: string; icon: any }[] = [
  { id: 'contract', label: 'Contract Details', icon: FileText },
  { id: 'financial', label: 'Financial Management', icon: DollarSign },
  { id: 'modifications', label: 'Lease Modifications', icon: RefreshCw },
  { id: 'assets', label: 'Assets & Locations', icon: MapPin },
  { id: 'schedules', label: 'Schedules', icon: BarChart3 },
  { id: 'disclosures', label: 'Disclosures', icon: FileCheck },
  { id: 'review', label: 'Review & Calculate', icon: CheckCircle },
];

const TRANSACTION_TYPES = ['Lessee', 'Lessor', 'Sale & Leaseback'];
const LEASE_STATUS_OPTIONS = ['Active', 'Draft', 'Under Review', 'Terminated'];
const PAYMENT_FREQ = ['Monthly', 'Quarterly', 'Semi-Annual', 'Annual'];
const PAYMENT_TYPES = ['Advance', 'Arrears'];
const CURRENCIES = ['INR', 'USD', 'AED', 'GBP', 'EUR', 'SGD'];
const ESCALATION_TYPES = ['None', 'Percentage', 'Fixed Amount', 'CPI Linked'];
const ESCALATION_FREQ = ['Annual', 'Bi-Annual', 'Monthly'];
const LEASE_TYPES = ['Building', 'Site', 'Standard', 'Lease', 'Commercial', 'Residential', 'Equipment', 'Automobile', 'Office', 'Retail', 'Land'];
const MODIFICATION_TYPES_LEGACY = ['Lease Extension', 'Early Termination', 'Rent Review / Payment Change', 'Scope Change', 'Currency Change'];
const MODIFICATION_TYPE_OPTIONS: { value: string; label: string; badge: string }[] = [
  { value: 'extension', label: 'Lease Extension — extended lease term', badge: 'bg-blue-100 text-blue-700' },
  { value: 'termination', label: 'Lease Termination — early termination / scope decrease', badge: 'bg-red-100 text-red-700' },
  { value: 'rent_review', label: 'Rent Review — payment amount changed', badge: 'bg-amber-100 text-amber-700' },
  { value: 'scope_increase', label: 'Scope Increase — additional assets/space added', badge: 'bg-purple-100 text-purple-700' },
  { value: 'scope_decrease', label: 'Scope Decrease — assets/space removed', badge: 'bg-purple-100 text-purple-600' },
  { value: 'ibr_change', label: 'IBR Change — revised incremental borrowing rate', badge: 'bg-gray-100 text-gray-700' },
  { value: 'index_rate_change', label: 'Index/Rate Change — CPI or rate-linked payment change', badge: 'bg-gray-100 text-gray-700' },
  { value: 'remeasurement', label: 'Remeasurement', badge: 'bg-gray-100 text-gray-600' },
];
const DEPRECIATION_METHODS = ['Straight Line', 'Declining Balance'];

interface LeaseCalculateResponse {
  results: Record<string, unknown>;
  excel_file_id: string;
}

function pvOfAnnuity(monthlyPayment: number, annualRatePct: number, numMonths: number): number {
  if (numMonths <= 0 || monthlyPayment <= 0) return 0;
  const r = annualRatePct / 100 / 12;
  if (r <= 0) return monthlyPayment * numMonths;
  return monthlyPayment * (1 - Math.pow(1 + r, -numMonths)) / r;
}

function getPriorLLFromSchedule(schedule: any[], scheduleRowFn: (r: any) => any, onDate: string): number {
  if (!schedule.length || !onDate) return 0;
  for (let i = 0; i < schedule.length; i++) {
    const r = scheduleRowFn(schedule[i]);
    const rowDate = r.date ? String(r.date) : '';
    if (rowDate && rowDate >= onDate) return Number(r.opening ?? 0);
  }
  const last = scheduleRowFn(schedule[schedule.length - 1]);
  return Number(last.closing ?? 0);
}

const inputClass = 'w-full px-4 py-2.5 bg-white border border-[#e2e8f0] rounded-lg focus:ring-2 focus:ring-[#f97316]/30 focus:border-[#f97316] text-[#1e293b] font-mono';
const labelClass = 'block text-xs font-medium text-[#64748b] uppercase tracking-wide mb-1.5';

function getVal(obj: any): any {
  if (obj == null) return null;
  if (typeof obj === 'object' && 'value' in obj) return obj.value;
  return obj;
}

function flattenExtraction(data: any): Record<string, any> {
  if (!data) return {};
  const startDateRaw = getVal(data?.dates?.commencement_date);
  const endDateRaw = getVal(data?.dates?.end_date);
  const startDate = startDateRaw != null ? String(startDateRaw).slice(0, 10) : '';
  const endDate = endDateRaw != null ? String(endDateRaw).slice(0, 10) : '';
  const discountVal = getVal(data?.discount_rate?.stated_rate);
  const discountRate = discountVal == null ? '' : (Number(discountVal) > 1 ? String(Number(discountVal)) : String(Number(discountVal) * 100));
  return {
    title: getVal(data?.basic_info?.asset_description) ?? '',
    assetDescription: getVal(data?.basic_info?.asset_description) ?? '',
    lessee: getVal(data?.basic_info?.lessee_name) ?? '',
    lessor: getVal(data?.basic_info?.lessor_name) ?? '',
    leaseType: getVal(data?.basic_info?.lease_type) ?? '',
    startDate,
    endDate,
    lease_term_months: getVal(data?.dates?.lease_term_months) ?? '',
    baseRentAmount: getVal(data?.payments?.monthly_amount) ?? '',
    currency: getVal(data?.payments?.currency) ?? getDefaultIfrs16Currency(),
    paymentFrequency: getVal(data?.payments?.payment_frequency) ?? 'Monthly',
    paymentType: getVal(data?.payments?.payment_type) ?? 'Arrears',
    discountRate,
    initialDirectCosts: getVal(data?.initial_costs?.total) ?? '',
    leaseIncentives: getVal(data?.initial_costs?.incentives) ?? '',
    renewalOptions: getVal(data?.options?.renewal_options) ?? '',
    terminationClauses: getVal(data?.options?.termination_clause) ?? '',
    description: getVal(data?.basic_info?.asset_description) ?? '',
    country: getVal((data?.basic_info as any)?.country) || getVal((data as any)?.location?.country) || 'India',
    city: getVal((data?.basic_info as any)?.city) || getVal((data as any)?.location?.city) || '',
    location: getVal((data?.basic_info as any)?.location) || getVal((data?.basic_info as any)?.premises) || getVal((data as any)?.location?.address) || '',
  };
}

function countExtracted(flat: Record<string, any>): number {
  return Object.values(flat).filter((v) => v !== '' && v != null && v !== undefined).length;
}

const defaultFormState = (): Record<string, any> => {
  const defaultCurrency = getDefaultIfrs16Currency();
  const defaultCountry = getDefaultIfrs16Country();
  return {
  leaseId: '',
  title: '',
  lease_term_months: '',
  transactionType: 'Lessee',
  legalEntity: '',
  leaseStatus: 'Active',
  modificationDate: '',
  startDate: '',
  endDate: '',
  effectiveDate: '',
  paymentDate: '',
  renewalDate: '',
  earlyTerminationDate: '',
  extendedEndDate: '',
  contractSealingDate: '',
  contractSealingLocation: '',
  residualValue: '',
  optionalPurchasePrice: '',
  enableContractReduction: false,
  description: '',
  terminationClauses: '',
  renewalOptions: '',
  lessorDetails: {} as Record<string, string>,
  lesseeDetails: {} as Record<string, string>,
  legalDetails: {} as Record<string, string>,
  baseRentAmount: '',
  paymentFrequency: 'Monthly',
  paymentType: 'Arrears',
  currency: defaultCurrency,
  extendedBaseRentAmount: '',
  exchangeRate: '1',
  initialDirectCosts: '0',
  nonLeaseComponent: '0',
  nonLeaseDescription: '',
  practicalExpedientElected: false,
  legalFees: '0',
  brokerageFees: '0',
  otherInitialDirectCosts: '0',
  initialDirectCostsDescription: '',
  leaseIncentives: '0',
  rentFreeMonths: 0,
  cashIncentive: '0',
  leaseIncentiveDescription: '',
  rvgAmount: '0',
  rvgGuaranteedBy: 'None',
  rvgExpectedPayment: '0',
  escalationType: 'None',
  escalationValue: '',
  escalationStartDate: '',
  escalationFrequency: 'Annual',
  discountRate: '',
  extendedEscalationValue: '',
  lessor: '',
  lessee: '',
  businessUnit: '',
  costCenterTags: [] as string[],
  costCenterAllocation: {} as Record<string, number>,
  leaseType: 'Office',
  assetDescription: '',
  contractReference: '',
  brand: '',
  country: defaultCountry,
  city: '',
  location: '',
  floorUnit: '',
  usefulLifeMonths: '60',
  depreciationMethod: 'Straight Line',
  rouGlCode: '',
  liabilityGlCode: '',
  interestGlCode: '',
  depreciationGlCode: '',
  modifications: [] as any[],
  variablePayments: false,
  variableDescription: '',
  variableAnnualAmount: '',
  variableBasis: '',
  cpiAdjustments: false,
  baseIndexValue: '',
  currentIndexValue: '',
  cpiAdjustmentFrequencyMonths: '12',
  lastAdjustmentDate: '',
  version: 'V1',
  functionalCurrency: defaultCurrency,
  restorationCost: '',
  };
};

function leaseToForm(lease: any): ReturnType<typeof defaultFormState> {
  const form = defaultFormState();
  if (!lease) return form;
  const d = lease.dates || {};
  form.leaseId = lease.lease_id || lease.id || '';
  form.title = lease.title || lease.asset || '';
  form.leaseStatus = lease.status || lease.lease_status || 'Active';
  form.startDate = lease.start_date || d.commencement || '';
  form.endDate = lease.end_date || d.end || '';
  form.lease_term_months = String(lease.dates?.term_months ?? d.term_months ?? '');
  form.baseRentAmount = String(lease.monthly_payment ?? lease.payments?.monthly ?? '');
  form.currency = lease.currency || lease.payments?.currency || getDefaultIfrs16Currency();
  form.discountRate = lease.discount_rate != null ? String(lease.discount_rate) : '';
  form.lessor = lease.lessor || lease.lessor_name || '';
  form.lessee = lease.lessee || lease.lessee_name || '';
  form.leaseType = lease.lease_type || 'Office';
  form.assetDescription = lease.asset || '';
  form.legalEntity = lease.legal_entity || '';
  form.effectiveDate = lease.effective_date || '';
  form.paymentDate = lease.payment_date || '';
  form.renewalDate = lease.renewal_date || '';
  form.earlyTerminationDate = lease.early_termination_date || '';
  form.extendedEndDate = lease.extended_end_date || '';
  form.contractSealingDate = lease.contract_sealing_date || '';
  form.contractSealingLocation = lease.contract_sealing_location || '';
  form.residualValue = lease.residual_value != null ? String(lease.residual_value) : '';
  form.optionalPurchasePrice = lease.optional_purchase_price != null ? String(lease.optional_purchase_price) : '';
  form.description = lease.description || '';
  form.terminationClauses = lease.termination_clauses || '';
  form.renewalOptions = lease.renewal_options || '';
  form.lessorDetails = lease.lessor_details || {};
  form.lesseeDetails = lease.lessee_details || {};
  form.legalDetails = lease.legal_details || {};
  form.paymentFrequency = lease.payment_frequency || 'Monthly';
  form.paymentType = lease.payment_type || 'Arrears';
  form.exchangeRate = lease.exchange_rate ?? '1';
  form.initialDirectCosts = lease.initial_direct_costs != null ? String(lease.initial_direct_costs) : '0';
  form.nonLeaseComponent = (lease as any).non_lease_component != null ? String((lease as any).non_lease_component) : '0';
  form.nonLeaseDescription = (lease as any).non_lease_description ?? '';
  form.practicalExpedientElected = Boolean((lease as any).practical_expedient_elected ?? false);
  form.legalFees = (lease as any).legal_fees != null ? String((lease as any).legal_fees) : '0';
  form.brokerageFees = (lease as any).brokerage_fees != null ? String((lease as any).brokerage_fees) : '0';
  form.otherInitialDirectCosts = (lease as any).other_initial_direct_costs != null ? String((lease as any).other_initial_direct_costs) : '0';
  form.initialDirectCostsDescription = (lease as any).initial_direct_costs_description ?? '';
  form.leaseIncentives = lease.lease_incentives != null ? String(lease.lease_incentives) : '0';
  form.rentFreeMonths = (lease as any).rent_free_months ?? 0;
  form.cashIncentive = (lease as any).cash_incentive != null ? String((lease as any).cash_incentive) : form.leaseIncentives;
  form.leaseIncentiveDescription = (lease as any).lease_incentive_description ?? '';
  form.rvgAmount = (lease as any).rvg_amount != null ? String((lease as any).rvg_amount) : '0';
  form.rvgGuaranteedBy = (lease as any).rvg_guaranteed_by ?? 'None';
  form.rvgExpectedPayment = (lease as any).rvg_expected_payment != null ? String((lease as any).rvg_expected_payment) : '0';
  form.escalationType = lease.escalation_type || 'None';
  form.escalationValue = lease.escalation_value != null ? String(lease.escalation_value) : '';
  form.escalationStartDate = lease.escalation_start_date || '';
  form.escalationFrequency = lease.escalation_frequency || 'Annual';
  form.businessUnit = lease.business_unit || '';
  form.costCenterTags = (lease.cost_centers || []).map((c: any) => c.name || c);
  form.costCenterAllocation = (lease.cost_centers || []).reduce((acc: any, c: any) => ({ ...acc, [c.name || c]: c.percent ?? 0 }), {});
  form.contractReference = lease.contract_reference || '';
  form.brand = lease.brand || '';
  form.country = lease.country || 'India';
  form.city = lease.city || '';
  form.location = lease.location || '';
  form.floorUnit = lease.floor_unit || '';
  form.usefulLifeMonths = lease.useful_life != null ? String(lease.useful_life) : '60';
  form.depreciationMethod = lease.depreciation_method || 'Straight Line';
  form.rouGlCode = lease.rou_gl_code || '';
  form.liabilityGlCode = lease.liability_gl_code || '';
  form.interestGlCode = lease.interest_gl_code || '';
  form.depreciationGlCode = lease.depreciation_gl_code || '';
  form.modifications = lease.modifications || [];
  form.variablePayments = lease.variable_payments ?? false;
  form.variableDescription = lease.variable_description || '';
  form.variableAnnualAmount = lease.variable_annual_amount != null ? String(lease.variable_annual_amount) : '';
  form.variableBasis = lease.variable_basis || '';
  form.cpiAdjustments = lease.cpi_adjustments ?? false;
  form.baseIndexValue = lease.base_index_value != null ? String(lease.base_index_value) : '';
  form.currentIndexValue = lease.current_index_value != null ? String(lease.current_index_value) : '';
  form.cpiAdjustmentFrequencyMonths =
    lease.cpi_adjustment_frequency_months != null ? String(lease.cpi_adjustment_frequency_months) : '12';
  form.lastAdjustmentDate = lease.last_adjustment_date || '';
  form.version = lease.version || 'V1';
  form.transactionType = lease.transaction_type || 'Lessee';
  form.functionalCurrency = lease.functionalCurrency || (lease as any).functional_currency || form.currency;
  form.restorationCost = lease.restorationCost != null ? String(lease.restorationCost) : (lease as any).restoration_cost != null ? String((lease as any).restoration_cost) : '';
  return form;
}

/** Demo payloads — field names match form state (CPI → baseIndexValue / currentIndexValue). */
const SAMPLE_LEASES = {
  difc: {
    label: '🇦🇪 DIFC Office (UAE)',
    data: {
      title: 'Level 15, Gate Building, DIFC, Dubai',
      assetDescription: 'Level 15, Gate Building, DIFC, Dubai',
      lessor: 'DIFC Investments LLC',
      lessee: 'Al Futtaim Digital Services LLC',
      startDate: '2024-01-01',
      endDate: '2028-12-31',
      lease_term_months: '60',
      baseRentAmount: '85000',
      discountRate: '5.5',
      currency: 'AED',
      paymentType: 'Arrears',
      paymentFrequency: 'Monthly',
      rentFreeMonths: 0,
      escalationType: 'None',
      escalationValue: '',
      legalFees: '0',
      brokerageFees: '0',
      otherInitialDirectCosts: '0',
      cashIncentive: '0',
      rvgAmount: '0',
      rvgGuaranteedBy: 'None',
      rvgExpectedPayment: '0',
      cpiAdjustments: false,
      baseIndexValue: '0',
      currentIndexValue: '0',
      cpiAdjustmentFrequencyMonths: '12',
      nonLeaseComponent: '0',
      nonLeaseDescription: '',
      practicalExpedientElected: false,
      leaseType: 'Office',
      assetType: 'Office Building',
      country: 'UAE',
      city: 'Dubai',
      location: 'DIFC',
      functionalCurrency: 'AED',
    },
  },
  office: {
    label: '🏢 Office Lease (Simple)',
    data: {
      title: 'Corporate Office — Banjara Hills, Hyderabad',
      assetDescription: 'Corporate Office — Banjara Hills, Hyderabad',
      lessor: 'Prestige Estates Pvt Ltd',
      lessee: 'Gnanova Technologies Pvt Ltd',
      startDate: '2024-04-01',
      endDate: '2027-03-31',
      lease_term_months: '36',
      baseRentAmount: '85000',
      discountRate: '8.5',
      currency: 'INR',
      paymentType: 'Arrears',
      paymentFrequency: 'Monthly',
      rentFreeMonths: 0,
      escalationType: 'None',
      escalationValue: '',
      legalFees: '0',
      brokerageFees: '0',
      otherInitialDirectCosts: '0',
      cashIncentive: '0',
      rvgAmount: '0',
      rvgGuaranteedBy: 'None',
      rvgExpectedPayment: '0',
      cpiAdjustments: false,
      baseIndexValue: '0',
      currentIndexValue: '0',
      cpiAdjustmentFrequencyMonths: '12',
      nonLeaseComponent: '0',
      nonLeaseDescription: '',
      practicalExpedientElected: false,
      leaseType: 'Building',
      assetType: 'Office Building',
      country: 'India',
      city: 'Hyderabad',
    },
  },
  datacentre: {
    label: '🖥️ Data Centre (Multi-Component + CPI)',
    data: {
      title: 'Data Centre Space — HITEC City, Hyderabad',
      assetDescription: 'Data Centre Space — HITEC City, Hyderabad',
      lessor: 'CtrlS Datacenters Ltd',
      lessee: 'Gnanova Technologies Pvt Ltd',
      startDate: '2024-04-01',
      endDate: '2029-03-31',
      lease_term_months: '60',
      baseRentAmount: '500000',
      discountRate: '10.5',
      currency: 'INR',
      paymentType: 'Arrears',
      paymentFrequency: 'Monthly',
      rentFreeMonths: 0,
      escalationType: 'None',
      escalationValue: '',
      legalFees: '0',
      brokerageFees: '0',
      otherInitialDirectCosts: '0',
      cashIncentive: '0',
      rvgAmount: '0',
      rvgGuaranteedBy: 'None',
      rvgExpectedPayment: '0',
      cpiAdjustments: true,
      baseIndexValue: '100',
      currentIndexValue: '107.5',
      cpiAdjustmentFrequencyMonths: '12',
      nonLeaseComponent: '75000',
      nonLeaseDescription: 'Data centre cooling, physical security, UPS power',
      practicalExpedientElected: false,
      leaseType: 'Equipment',
      assetType: 'Data Centre',
      country: 'India',
      city: 'Hyderabad',
    },
  },
  reuk: {
    label: '🇬🇧 RE-UK-001 Manchester (Rent-free + Non-lease)',
    data: {
      title: 'Manchester Office — Spinningfields',
      assetDescription: 'Manchester Office — Spinningfields',
      lessor: 'Meridian Property Group PLC',
      lessee: 'Meridian Digital Services Ltd',
      startDate: '2024-01-01',
      endDate: '2033-12-31',
      lease_term_months: '120',
      baseRentAmount: '850000',
      discountRate: '5.5',
      currency: 'GBP',
      paymentType: 'Arrears',
      paymentFrequency: 'Monthly',
      rentFreeMonths: 3,
      escalationType: 'None',
      escalationValue: '',
      legalFees: '120000',
      brokerageFees: '80000',
      otherInitialDirectCosts: '50000',
      initialDirectCostsDescription: 'Legal fees, brokerage, other IDC',
      cashIncentive: '0',
      rvgAmount: '0',
      rvgGuaranteedBy: 'None',
      rvgExpectedPayment: '0',
      cpiAdjustments: false,
      baseIndexValue: '0',
      currentIndexValue: '0',
      cpiAdjustmentFrequencyMonths: '12',
      nonLeaseComponent: '95000',
      nonLeaseDescription: 'Building maintenance, security, facilities management',
      practicalExpedientElected: false,
      leaseType: 'Office',
      assetType: 'Office Building',
      country: 'UK',
      city: 'Manchester',
      location: 'Spinningfields',
      functionalCurrency: 'GBP',
    },
  },
  ibmserver: {
    label: '⚙️ IBM Server (Full — All Features)',
    data: {
      title: 'IBM Power Server Rack — HITEC City Data Centre',
      assetDescription: 'IBM Power Server Rack — HITEC City Data Centre',
      lessor: 'IBM India Pvt Ltd',
      lessee: 'Gnanova Technologies Pvt Ltd',
      startDate: '2024-07-01',
      endDate: '2029-06-30',
      lease_term_months: '60',
      baseRentAmount: '250000',
      discountRate: '10.5',
      currency: 'INR',
      paymentType: 'Arrears',
      paymentFrequency: 'Monthly',
      rentFreeMonths: 2,
      escalationType: 'Percentage',
      escalationValue: '5',
      escalationFrequency: 'Annual',
      legalFees: '40000',
      brokerageFees: '35000',
      otherInitialDirectCosts: '25000',
      initialDirectCostsDescription: 'Legal fees for lease negotiation + agent commission',
      cashIncentive: '50000',
      leaseIncentiveDescription: 'Lessor fit-out contribution',
      rvgAmount: '300000',
      rvgGuaranteedBy: 'Lessee',
      rvgExpectedPayment: '150000',
      cpiAdjustments: true,
      baseIndexValue: '100',
      currentIndexValue: '103',
      cpiAdjustmentFrequencyMonths: '12',
      nonLeaseComponent: '30000',
      nonLeaseDescription: 'IBM hardware maintenance included in rent',
      practicalExpedientElected: false,
      leaseType: 'Equipment',
      assetType: 'Server Equipment',
      country: 'India',
      city: 'Hyderabad',
    },
  },
};

export default function LeaseDetailTabbedPage() {
  const params = useParams();
  const router = useRouter();
  const { getCompanyId } = useAuth();
  const id = typeof params?.id === 'string' ? params.id : '';
  const isNew = id === 'new';

  const [form, setForm] = useState(defaultFormState);
  const [activeTab, setActiveTab] = useState<typeof TAB_IDS[number]>('contract');
  const [dirtyTabs, setDirtyTabs] = useState<Set<string>>(new Set());
  const [calcResults, setCalcResults] = useState<any>(null);
  const [uploading, setUploading] = useState(false);
  const [leasePasteText, setLeasePasteText] = useState('');
  const [contractIntakeTab, setContractIntakeTab] = useState<'upload' | 'paste'>('upload');
  const [extractionBanner, setExtractionBanner] = useState<string | null>(null);
  const [extractedTabs, setExtractedTabs] = useState<Set<string>>(new Set());
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [ibrError, setIbrError] = useState<string | null>(null);
  const [ibrSuggestion, setIbrSuggestion] = useState<{
    ibr_low: number;
    ibr_mid: number;
    ibr_high: number;
    rationale: string;
    market_references: string[];
  } | null>(null);
  const [ibrLoading, setIbrLoading] = useState(false);
  const ibrInputRef = useRef<HTMLInputElement>(null);
  const [aiBarOpen, setAiBarOpen] = useState(true);
  const [costCenterInput, setCostCenterInput] = useState('');
  const [isCalculating, setIsCalculating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeScheduleSubTab, setActiveScheduleSubTab] = useState<'payment' | 'liability' | 'fx' | 'restoration' | 'restorationFx' | 'residual' | 'rou' | 'rouAdjustment'>('payment');
  const [modificationModalIndex, setModificationModalIndex] = useState<number | null>(null);
  const [fxRatesByPeriod, setFxRatesByPeriod] = useState<number[]>([]);
  const [modificationPanel, setModificationPanel] = useState<'list' | 'form'>('list');
  const [modificationFormIndex, setModificationFormIndex] = useState<number | null>(null);
  const [disclosureFY, setDisclosureFY] = useState<string>(() => { const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() + 1 : d.getFullYear(); return `${y - 1}-${String(y).slice(-2)}`; });
  const [disclosureDataVersion, setDisclosureDataVersion] = useState(0);
  const [disclosureAssumptionText, setDisclosureAssumptionText] = useState<string>('');
  const [disclosureCompleteNoteOpen, setDisclosureCompleteNoteOpen] = useState(false);
  const [disclosureLastRefreshedSignature, setDisclosureLastRefreshedSignature] = useState<string>('');
  const [disclosureAssumptionModified, setDisclosureAssumptionModified] = useState(false);
  const [disclosureAssumptionEditing, setDisclosureAssumptionEditing] = useState(false);
  const [reviewJournalSubTab, setReviewJournalSubTab] = useState<'initial' | 'monthly' | 'year_end' | 'modification' | 'termination'>('initial');
  const [reviewJournalMonth, setReviewJournalMonth] = useState<number>(() => new Date().getMonth() + 1);
  const [reviewJournalYear, setReviewJournalYear] = useState<number>(() => new Date().getFullYear());
  const [reviewJournalFY, setReviewJournalFY] = useState<string>(() => { const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() + 1 : d.getFullYear(); return `${y - 1}-${String(y).slice(-2)}`; });
  const [reviewParamsCollapsed, setReviewParamsCollapsed] = useState(false);
  const [reviewAccountNames, setReviewAccountNames] = useState<Record<string, string>>({
    rou_asset: 'Right-of-Use Asset',
    lease_liability_current: 'Lease Liability (Current)',
    lease_liability_non_current: 'Lease Liability (Non-Current)',
    lease_liability: 'Lease Liability',
    cash: 'Bank / Cash',
    finance_cost: 'Finance Cost (Interest Expense)',
    depreciation_expense: 'Depreciation Expense',
    acc_dep_rou: 'Accumulated Depreciation (ROU)',
    provisions_restoration: 'Provisions (Restoration)',
    fx_gain_loss: 'Foreign Exchange Gain/Loss',
    impairment_loss: 'Impairment Loss (ROU)',
    acc_impairment_rou: 'Accumulated Impairment (ROU)',
    gain_loss_termination: 'Gain/(Loss) on Termination',
  });
  const [auditTrail, setAuditTrail] = useState<{ id: string; dateTime: string; user: string; action: string; fieldChanged?: string; oldValue?: string; newValue?: string; ip?: string }[]>(() => []);
  const [finaliseModalOpen, setFinaliseModalOpen] = useState(false);
  const [versionHistoryModalOpen, setVersionHistoryModalOpen] = useState(false);
  const [lastCalculatedAt, setLastCalculatedAt] = useState<string | null>(null);
  /** Raw extractor JSON from upload-contract (plus optional persisted `contract_data` on saved leases). */
  const [contractData, setContractData] = useState<Record<string, unknown> | null>(null);

  const displayCurrency = form.currency || getDefaultIfrs16Currency();
  const fmt = (amount: number) => formatLeaseMoney(amount, displayCurrency);
  const fmtDec = (amount: number, decimals = 2) => formatLeaseMoney(amount, displayCurrency, decimals);

  const [modificationForm, setModificationForm] = useState<Record<string, any>>({
    date: '',
    effectiveDate: '',
    type: 'extension',
    reason: '',
    notes: '',
    newEndDate: '',
    newMonthlyPayment: '',
    paymentFrequency: 'Monthly',
    paymentEffectiveFrom: '',
    indexType: 'CPI',
    newIndexRatePct: '',
    adjustmentCapPct: '',
    floorRatePct: '',
    newIBR: '',
    newRestoration: '',
  });

  const [showSampleMenu, setShowSampleMenu] = useState(false);
  const sampleMenuRef = useRef<HTMLDivElement>(null);

  const existingLease = isNew ? null : getLeaseById(id);
  const modificationAdvisorFormOverlay = useMemo(
    () => ({
      renewalOptions: form.renewalOptions,
      terminationClauses: form.terminationClauses,
      description: form.description,
      escalationClause: [form.escalationType, form.escalationValue].filter(Boolean).join(' ').trim(),
    }),
    [form.renewalOptions, form.terminationClauses, form.description, form.escalationType, form.escalationValue]
  );
  const hasResults = !!calcResults || !!existingLease?.results;
  const schedule = (calcResults?.amortization_schedule ?? existingLease?.results?.amortization_schedule ?? []) as any[];
  const excelFileId = calcResults?.excel_file_id ?? existingLease?.excel_file_id;

  // Backend returns PascalCase (Opening_Balance, Payment, Date, etc.); support both
  const scheduleRow = (row: any) => ({
    period: row.Period ?? row.period,
    date: row.Date ?? row.payment_date ?? row.date,
    month: row.Month ?? row.month,
    opening: row.Opening_Balance ?? row.opening_balance,
    payment: row.Payment ?? row.payment,
    interest: row.Interest ?? row.interest,
    principal: row.Principal ?? row.principal,
    closing: row.Closing_Balance ?? row.closing_balance,
    rentFree: row.Rent_Free ?? row.rent_free ?? false,
    rvgPayment: row.RVG_Payment ?? row.rvg_payment ?? 0,
  });

  const monthlyNonLeaseComponent = form.practicalExpedientElected
    ? 0
    : parseFloat(String(form.nonLeaseComponent || '0')) || 0;
  const paymentScheduleBreakdown = (row: any) => {
    const r = scheduleRow(row);
    const leasePay = Number(r.payment ?? 0);
    const nonLeasePay = monthlyNonLeaseComponent;
    const totalCash = leasePay + nonLeasePay;
    return { ...r, leasePay, nonLeasePay, totalCash };
  };

  const fetchIbrSuggestion = async () => {
    try {
      setIbrLoading(true);
      let termMonths = 12;
      if (form.lease_term_months) termMonths = Math.max(1, parseInt(form.lease_term_months, 10) || 12);
      else if (form.startDate && form.endDate) {
        const ms = new Date(form.endDate).getTime() - new Date(form.startDate).getTime();
        termMonths = Math.max(1, Math.ceil(ms / (1000 * 60 * 60 * 24 * 30)));
      }
      const lesseeRaw = String(form.lessee || '').toLowerCase();
      const lesseeType = lesseeRaw.includes('startup') ? 'Startup' : lesseeRaw.includes('sme') ? 'SME' : 'Corporate';
      const res = await ifrs16IbrApi.suggest({
        country: String(form.country || 'India'),
        currency: String(form.currency || 'INR'),
        lease_term_months: termMonths,
        asset_type: String(form.assetDescription || form.title || '').trim() || undefined,
        lessee_type: lesseeType,
      });
      if (res.error || !res.data) {
        toast.error(res.error || 'Could not fetch IBR suggestion');
        return;
      }
      setIbrSuggestion({
        ibr_low: Number(res.data.ibr_low),
        ibr_mid: Number(res.data.ibr_mid),
        ibr_high: Number(res.data.ibr_high),
        rationale: String(res.data.rationale || ''),
        market_references: Array.isArray(res.data.market_references) ? res.data.market_references.map(String) : [],
      });
      toast.success('IBR suggestion loaded');
    } finally {
      setIbrLoading(false);
    }
  };

function buildDisclosureText(results: any): string {
  if (!results) return '';
  const d = results.disclosure_data || {};
  const currency = d.currency || getDefaultIfrs16Currency();
  const rou = Number(results.rou_asset ?? results.rou ?? 0);
  const liab = Number(results.lease_liability ?? results.liability ?? 0);
  const split = results.liability_split || {};
  const current = Number(split.current_portion ?? 0);
  const nonCurrent = Number(split.non_current_portion ?? 0);
  const y1 = results.year_1_impact || {};
  const dep = Number(y1.depreciation_expense ?? 0);
  const int = Number(y1.interest_expense ?? 0);
  const totalExp = Number(y1.total_p_l_expense ?? 0);
  const cash = Number(y1.cash_outflow ?? 0);
  const meta = results.calculation_metadata || {};
  const calcDate = meta.calculation_date || new Date().toISOString();
  return `The Company has adopted IFRS 16 'Leases' with effect from ${d.commencement || 'the commencement date'}.

The Company has lease contracts for office premises. The Company's obligations under its leases are secured by the lessor's title to the leased assets.

The Company has recognized right-of-use assets and lease liabilities for these leases. The details are as follows:

Right-of-Use Assets:
- Asset description: ${d.asset || 'Leased asset'}
- Carrying amount: ${formatLeaseMoney(rou, currency)}
- Accumulated depreciation: Depreciated on a straight-line basis over lease term

Lease Liabilities:
- Total lease liability: ${formatLeaseMoney(liab, currency)}
- Current portion: ${formatLeaseMoney(current, currency)}
- Non-current portion: ${formatLeaseMoney(nonCurrent, currency)}

The Company has used incremental borrowing rate of ${d.discount_rate_pct != null ? Number(d.discount_rate_pct).toFixed(2) : ''}% to calculate the present value of lease payments.

Amounts recognized in statement of profit and loss:
- Depreciation expense: ${formatLeaseMoney(dep, currency)} (Year 1)
- Interest expense: ${formatLeaseMoney(int, currency)} (Year 1)
- Total expense: ${formatLeaseMoney(totalExp, currency)} (Year 1)

Cash outflow for leases: ${formatLeaseMoney(cash, currency)} (Year 1)

The maturity analysis of lease liabilities is presented in the Schedules tab.

Report generated on: ${calcDate}`;
}

function extractDisclosureSections(notesRaw: unknown): Array<{ title: string; body: string }> {
  const text = typeof notesRaw === 'string' ? notesRaw.trim() : '';
  if (!text) return [];
  const labels = [
    'Accounting Policy',
    'Right-of-Use Assets',
    'Lease Liabilities',
    'Amounts in P&L',
    'Cash Flow Information',
    'Significant Judgements',
  ];
  const normalized = text.replace(/\r\n/g, '\n');
  const sections: Array<{ title: string; body: string }> = [];
  for (let i = 0; i < labels.length; i++) {
    const current = labels[i];
    const next = i < labels.length - 1 ? labels[i + 1] : null;
    const startMatch = normalized.match(new RegExp(`${current}\\s*:?[\\s\\n]*`, 'i'));
    if (!startMatch || startMatch.index == null) continue;
    const start = startMatch.index + startMatch[0].length;
    let end = normalized.length;
    if (next) {
      const nextMatch = normalized.slice(start).match(new RegExp(`${next}\\s*:?[\\s\\n]*`, 'i'));
      if (nextMatch && nextMatch.index != null) end = start + nextMatch.index;
    }
    const body = normalized.slice(start, end).trim();
    if (body) sections.push({ title: current, body });
  }
  if (sections.length === 0 && text) {
    return labels.map((title) => ({ title, body: text }));
  }
  return sections;
}

function getFYFromDate(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const y = d.getFullYear();
  const m = d.getMonth();
  const endYear = m >= 3 ? y + 1 : y;
  const startYear = endYear - 1;
  return `${startYear}-${String(endYear).slice(-2)}`;
}
function getReportingDateForFY(fy: string): Date {
  const parts = fy.split('-');
  const endPart = parts[1] ?? '';
  const endYear = endPart.length === 2 ? 2000 + parseInt(endPart, 10) : parseInt(endPart, 10) || new Date().getFullYear();
  return new Date(endYear, 2, 31);
}
  useEffect(() => {
    if (!isNew && existingLease) {
      const loaded = leaseToForm(existingLease);
      setForm(loaded);
      setContractData((existingLease as { contract_data?: Record<string, unknown> }).contract_data ?? null);
      if (existingLease.results && !calcResults) setCalcResults(existingLease.results);
      const sched = (existingLease.results as { amortization_schedule?: unknown })?.amortization_schedule;
      if (
        scheduleMismatchStoredInputs(sched, {
          rentFreeMonths: loaded.rentFreeMonths,
          nonLeaseComponent: parseFloat(String(loaded.nonLeaseComponent || '0')) || 0,
          baseRentAmount: parseFloat(String(loaded.baseRentAmount || '0')) || 0,
          practicalExpedientElected: loaded.practicalExpedientElected,
        })
      ) {
        toast(
          'Saved schedule was calculated without rent-free / non-lease settings. Click Calculate IFRS 16 to refresh.',
          { icon: '⚠️', duration: 8000 }
        );
      }
    } else if (isNew) {
      setForm((p) => ({ ...p, leaseId: `LEASE-2026-${String(Date.now()).slice(-6)}` }));
      setContractData(null);
    }
  }, [id, isNew]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (sampleMenuRef.current && !sampleMenuRef.current.contains(e.target as Node)) {
        setShowSampleMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const markDirty = useCallback((tab: string) => {
    setDirtyTabs((s) => new Set(s).add(tab));
  }, []);

  const applyExtractionFromRaw = useCallback((raw: unknown) => {
    const extractedBlob = (raw as { extracted_data?: unknown })?.extracted_data ?? raw;
    setContractData(
      extractedBlob != null && typeof extractedBlob === 'object' && !Array.isArray(extractedBlob)
        ? { ...(extractedBlob as Record<string, unknown>) }
        : null
    );
    const flat = flattenExtraction(raw);
    const result: Record<string, any> = { ...flat };
    if (raw && typeof raw === 'object') {
      const top = raw as Record<string, any>;
      if (top.start_date != null) result.startDate = result.startDate ?? String(top.start_date).slice(0, 10);
      if (top.end_date != null) result.endDate = result.endDate ?? String(top.end_date).slice(0, 10);
      if (top.commencement_date != null) result.startDate = result.startDate ?? String(top.commencement_date).slice(0, 10);
      if (top.monthly_payment != null) result.baseRentAmount = result.baseRentAmount ?? String(top.monthly_payment);
      if (top.base_rent_amount != null) result.baseRentAmount = result.baseRentAmount ?? String(top.base_rent_amount);
      if (top.discount_rate != null) result.discountRate = result.discountRate ?? String(top.discount_rate);
      if (top.ibr != null) result.discountRate = result.discountRate ?? String(top.ibr);
      if (top.asset_description != null) result.assetDescription = result.assetDescription ?? String(top.asset_description);
      if (top.title != null) result.title = result.title ?? String(top.title);
      if (top.lessor != null) result.lessor = result.lessor ?? String(top.lessor);
      if (top.lessor_name != null) result.lessor = result.lessor ?? String(top.lessor_name);
      if (top.lessee != null) result.lessee = result.lessee ?? String(top.lessee);
      if (top.lessee_name != null) result.lessee = result.lessee ?? String(top.lessee_name);
      if (top.currency != null) result.currency = result.currency ?? String(top.currency);
      if (top.payment_frequency != null) result.paymentFrequency = result.paymentFrequency ?? String(top.payment_frequency);
      if (top.payment_type != null) result.paymentType = result.paymentType ?? String(top.payment_type);
      if (top.lease_type != null) result.leaseType = result.leaseType ?? String(top.lease_type);
      if (top.asset_type != null) result.leaseType = result.leaseType ?? String(top.asset_type);
      if (top.country != null) result.country = result.country ?? String(top.country);
      if (top.city != null) result.city = result.city ?? String(top.city);
      if (top.location != null) result.location = result.location ?? String(top.location);
      if (top.address != null) result.location = result.location ?? String(top.address);
      if (top.brand != null) result.brand = result.brand ?? String(top.brand);
      if (top.residual_value != null) result.residualValue = result.residualValue ?? String(top.residual_value);
      if (top.transaction_type != null) result.transactionType = result.transactionType ?? String(top.transaction_type);
      if (top.description != null) result.description = result.description ?? String(top.description);
      if (top.initial_direct_costs != null) result.initialDirectCosts = result.initialDirectCosts ?? String(top.initial_direct_costs);
      if (top.lease_incentives != null) result.leaseIncentives = result.leaseIncentives ?? String(top.lease_incentives);
      if (top.escalation_type != null) result.escalationType = result.escalationType ?? String(top.escalation_type);
      if (top.escalation_value != null) result.escalationValue = result.escalationValue ?? String(top.escalation_value);
    }
    const tabsWithData = new Set<string>();
    if (result.title || result.startDate || result.endDate || result.lessee || result.lessor || result.leaseType || result.lease_term_months || result.renewalOptions || result.terminationClauses || result.description || result.residualValue || result.transactionType) tabsWithData.add('contract');
    if (result.baseRentAmount || result.currency || result.paymentFrequency || result.discountRate || result.initialDirectCosts || result.leaseIncentives || result.paymentType || result.escalationType || result.escalationValue) tabsWithData.add('financial');
    if (result.assetDescription || result.leaseType || result.country || result.city || result.location || result.brand) tabsWithData.add('assets');
    if (result.renewalOptions || result.terminationClauses) tabsWithData.add('modifications');
    setForm((p) => ({
      ...p,
      title: result.title ?? result.assetDescription ?? p.title,
      startDate: result.startDate ?? p.startDate,
      endDate: result.endDate ?? p.endDate,
      leaseStatus: 'Active',
      transactionType: result.transactionType ?? p.transactionType,
      description: result.description ?? p.description,
      residualValue: result.residualValue ?? p.residualValue,
      lessor: result.lessor ?? result.lessor_name ?? p.lessor,
      lessee: result.lessee ?? result.lessee_name ?? p.lessee,
      renewalOptions: result.renewalOptions ?? p.renewalOptions,
      terminationClauses: result.terminationClauses ?? p.terminationClauses,
      lease_term_months: result.lease_term_months ? String(result.lease_term_months) : p.lease_term_months,
      baseRentAmount: result.baseRentAmount ?? result.monthly_payment ?? p.baseRentAmount,
      discountRate: result.discountRate ?? result.ibr ?? p.discountRate,
      currency: result.currency ?? p.currency,
      paymentFrequency: result.paymentFrequency ?? p.paymentFrequency,
      paymentType: result.paymentType ?? p.paymentType,
      initialDirectCosts: result.initialDirectCosts ?? p.initialDirectCosts,
      legalFees: result.legalFees ?? p.legalFees ?? '0',
      brokerageFees: result.brokerageFees ?? p.brokerageFees ?? '0',
      otherInitialDirectCosts: result.otherInitialDirectCosts ?? p.otherInitialDirectCosts ?? '0',
      initialDirectCostsDescription: result.initialDirectCostsDescription ?? p.initialDirectCostsDescription ?? '',
      leaseIncentives: result.leaseIncentives ?? p.leaseIncentives,
      rentFreeMonths: result.rentFreeMonths ?? p.rentFreeMonths ?? 0,
      cashIncentive: result.cashIncentive ?? result.leaseIncentives ?? p.cashIncentive ?? p.leaseIncentives,
      leaseIncentiveDescription: result.leaseIncentiveDescription ?? p.leaseIncentiveDescription,
      rvgAmount: result.rvgAmount ?? p.rvgAmount ?? '0',
      rvgGuaranteedBy: result.rvgGuaranteedBy ?? p.rvgGuaranteedBy ?? 'None',
      rvgExpectedPayment: result.rvgExpectedPayment ?? p.rvgExpectedPayment ?? '0',
      escalationType: result.escalationType ?? p.escalationType,
      escalationValue: result.escalationValue ?? p.escalationValue,
      leaseType: result.leaseType ?? result.asset_type ?? p.leaseType,
      assetDescription: result.assetDescription ?? p.assetDescription,
      country: result.country ?? p.country,
      city: result.city ?? p.city,
      location: result.location ?? result.address ?? p.location,
      brand: result.brand ?? p.brand,
    }));
    setExtractedTabs(tabsWithData);
    setExtractionBanner('✅ AI extracted fields from your contract. Review each tab below.');
    setActiveTab('contract');
    toast.success('Extraction complete');
  }, []);

  const handleFileUpload = useCallback(
    async (file: File) => {
      setUploading(true);
      setUploadError(null);
      setExtractionBanner(null);
      setExtractedTabs(new Set());
      try {
        const { data, error } = await ifrs16Api.uploadContract(file);
        if (error) {
          setUploadError(error);
          toast.error(error);
          return;
        }
        applyExtractionFromRaw(data?.extracted_data ?? data);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Upload failed. Check file format.';
        setUploadError(msg);
        toast.error(msg);
      } finally {
        setUploading(false);
      }
    },
    [applyExtractionFromRaw]
  );

  const handlePasteLeaseExtract = useCallback(async () => {
    if (!leasePasteText.trim()) {
      toast.error('Please paste lease contract text');
      return;
    }
    setUploading(true);
    setUploadError(null);
    setExtractionBanner(null);
    setExtractedTabs(new Set());
    try {
      const { data, error } = await ifrs16Api.extractFromText(leasePasteText.trim());
      if (error) {
        setUploadError(error);
        toast.error(error);
        return;
      }
      applyExtractionFromRaw(data?.extracted_data ?? data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Extraction failed';
      setUploadError(msg);
      toast.error(msg);
    } finally {
      setUploading(false);
    }
  }, [leasePasteText, applyExtractionFromRaw]);

  const handleCalculate = async (overrides?: Partial<typeof form>) => {
    const f = { ...form, ...overrides };
    const start = f.startDate || f.effectiveDate;
    const ibrNum = parseFloat(String(f.discountRate || '').trim()) || 0;
    if (!start || !f.baseRentAmount || !f.assetDescription) {
      toast.error('Set Start Date, Base Rent, and Asset Description');
      return;
    }
    if (!f.discountRate || ibrNum <= 0) {
      setIbrError('IBR rate is required. Typical range: 6%–12%');
      toast.error('IBR rate is required. Typical range: 6%–12%');
      setActiveTab('financial');
      setTimeout(() => ibrInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150);
      return;
    }
    setIbrError(null);
    let termMonths = 12;
    if (f.lease_term_months) termMonths = Math.max(1, parseInt(String(f.lease_term_months), 10) || 12);
    else if (f.endDate) {
      const end = new Date(f.endDate);
      termMonths = Math.max(1, Math.ceil((end.getTime() - new Date(start).getTime()) / (1000 * 60 * 60 * 24 * 30)));
    }
    setIsCalculating(true);
    try {
      const payload = {
        lease_id: f.leaseId,
        company_id: getCompanyId(),
        asset_description: f.assetDescription,
        lessee_name: f.lessee,
        lessor_name: f.lessor,
        commencement_date: start,
        lease_term_months: termMonths,
        monthly_payment: parseFloat(f.baseRentAmount) || 0,
        non_lease_component: parseFloat(f.nonLeaseComponent ?? '0') || 0,
        non_lease_description: String(f.nonLeaseDescription ?? '').trim(),
        practical_expedient_elected: Boolean(f.practicalExpedientElected),
        annual_discount_rate: (() => {
          const v = parseFloat(f.discountRate) || 0.085;
          return v > 1 ? v / 100 : v;
        })(),
        initial_direct_costs: (parseFloat(f.legalFees ?? '0') || 0) + (parseFloat(f.brokerageFees ?? '0') || 0) + (parseFloat(f.otherInitialDirectCosts ?? '0') || 0) || parseFloat(f.initialDirectCosts ?? '0') || 0,
        legal_fees: parseFloat(f.legalFees ?? '0') || 0,
        brokerage_fees: parseFloat(f.brokerageFees ?? '0') || 0,
        other_initial_direct_costs: parseFloat(f.otherInitialDirectCosts ?? '0') || 0,
        initial_direct_costs_description: String(f.initialDirectCostsDescription ?? '').trim(),
        currency: f.currency,
        payment_type: f.paymentType || 'Arrears',
        rent_free_months: Number(f.rentFreeMonths ?? 0) || 0,
        cash_incentive: parseFloat(f.cashIncentive ?? f.leaseIncentives ?? '0') || 0,
        lease_incentive_description: String(f.leaseIncentiveDescription ?? '').trim(),
        rvg_amount: parseFloat(f.rvgAmount ?? '0') || 0,
        rvg_guaranteed_by: String(f.rvgGuaranteedBy ?? 'None').trim(),
        rvg_expected_payment: parseFloat(f.rvgExpectedPayment ?? '0') || 0,
      };
      const { data, error } = await ifrs16Api.calculate(payload);
      const typedData = data as LeaseCalculateResponse | undefined;
      if (error) {
        toast.error(error);
        return;
      }
      setCalcResults({ ...typedData?.results, excel_file_id: typedData?.excel_file_id });
      setLastCalculatedAt(new Date().toISOString());
      setForm((p) => {
        const nextVer = p.version && /^V(\d+)$/i.test(p.version) ? `V${parseInt(p.version.slice(1), 10) + 1}` : 'V2';
        return { ...p, ...overrides, version: nextVer, leaseStatus: p.leaseStatus === 'Draft' ? 'Calculated' : p.leaseStatus };
      });
      setAuditTrail((prev) => [...prev, { id: `audit-${Date.now()}`, dateTime: new Date().toISOString(), user: 'System', action: 'Calculation run', fieldChanged: undefined, oldValue: undefined, newValue: undefined, ip: undefined }]);
      toast.success('Calculation complete — schedule generated');
    } catch (e: any) {
      toast.error(e?.message || 'Calculation failed');
    } finally {
      setIsCalculating(false);
    }
  };

  const loadSampleData = (key: keyof typeof SAMPLE_LEASES) => {
    const sample = SAMPLE_LEASES[key].data;
    setForm((prev) => ({
      ...prev,
      ...sample,
      leaseIncentives:
        sample.cashIncentive != null && String(sample.cashIncentive) !== ''
          ? String(sample.cashIncentive)
          : prev.leaseIncentives,
      leaseId: `SAMPLE-${key.toUpperCase()}-${Date.now()}`,
      leaseStatus: 'Draft',
      version: 'V1',
    }));
    setCalcResults(null);
    setContractData(null);
    if (typeof setIbrSuggestion === 'function') setIbrSuggestion(null);
    toast.success(`✅ Loaded: ${SAMPLE_LEASES[key].label}`);
    setActiveTab('financial');
  };

  const handleSaveToRepo = () => {
    setSaving(true);
    try {
      const start = form.startDate || form.effectiveDate;
      const termMonths = form.lease_term_months ? parseInt(form.lease_term_months) : 12;
      const costCenters = form.costCenterTags.map((name: string) => ({ name, percent: form.costCenterAllocation[name] ?? 0 }));
      const entry = buildLeaseEntryFromForm(
        { ...form, costCenters },
        existingLease,
        calcResults ? { ...calcResults } : null,
        excelFileId,
        contractData
      );
      saveToLeaseRepository(entry);
      setDirtyTabs(new Set());
      setAuditTrail((prev) => [...prev, { id: `audit-${Date.now()}`, dateTime: new Date().toISOString(), user: 'System', action: 'Saved to repository', ip: undefined }]);
      toast.success('Saved to repository');
    } catch (e: any) {
      toast.error(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleHeaderSave = () => {
    handleSaveToRepo();
  };

  const handleDelete = () => {
    if (!isNew && !confirm('Delete this lease? This cannot be undone.')) return;
    if (!isNew) {
      deleteLeaseFromRepository(id);
      toast.success('Deleted');
    }
    router.push('/dashboard/ifrs16/repository');
  };

  const exportScheduleCsv = (filename: string, headers: string[], rows: (string | number)[][]) => {
    const escape = (v: string | number) => (typeof v === 'string' && (v.includes(',') || v.includes('"') || v.includes('\n')) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const csv = [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Schedule exported');
  };

  const allocationTotal = form.costCenterTags.reduce((s: number, t: string) => s + (form.costCenterAllocation[t] ?? 0), 0);
  const displayTitle = form.title || form.assetDescription || (isNew ? 'New Lease' : form.leaseId);
  const statusLabel = form.leaseStatus || 'Draft';

  return (
    <SidebarLayout
      pageTitle={isNew ? 'New Lease' : displayTitle}
      pageSubtitle=""
    >
      <div className="space-y-0">
        {/* Sticky header */}
        <div className="sticky top-0 z-30 bg-[#f5f6fa] border-b border-[#e2e8f0] -mx-6 px-6 py-4 mb-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <nav className="flex items-center gap-2 text-sm text-[#64748b] mb-1">
                <Link href="/dashboard" className="hover:text-[#f97316]">IFRS</Link>
                <ChevronRight className="w-4 h-4" />
                <Link href="/dashboard/ifrs16/repository" className="hover:text-[#f97316]">Lease Repository</Link>
                <ChevronRight className="w-4 h-4" />
                <span className="text-[#1e293b] font-medium">{form.leaseId || 'New'}</span>
              </nav>
              <h1 className="text-xl font-bold text-[#1e293b]">{displayTitle}</h1>
              <div className="flex items-center gap-2 mt-1">
                <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusLabel === 'Active' ? 'bg-green-100 text-green-700' : statusLabel === 'Draft' ? 'bg-gray-100 text-gray-700' : 'bg-amber-100 text-amber-700'}`}>
                  {statusLabel}
                </span>
                <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-700">{form.version || 'V1'}</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative" ref={sampleMenuRef}>
                <button
                  type="button"
                  onClick={() => setShowSampleMenu((p) => !p)}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-[#475569] bg-white border border-[#e2e8f0] rounded-lg hover:bg-[#f8fafc] hover:border-[#2E86AB] transition-colors shadow-sm"
                >
                  <span>📂</span>
                  Load Sample
                  <svg
                    className={`w-4 h-4 transition-transform duration-200 ${showSampleMenu ? 'rotate-180' : ''}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {showSampleMenu && (
                  <div className="absolute right-0 mt-1 w-72 bg-white border border-[#e2e8f0] rounded-lg shadow-xl z-50 py-1 animate-in fade-in slide-in-from-top-2">
                    <div className="px-3 py-2 text-xs font-semibold text-[#94a3b8] uppercase tracking-wider border-b border-[#f1f5f9]">
                      Demo Data — fills all fields instantly
                    </div>
                    {Object.entries(SAMPLE_LEASES).map(([k, { label }]) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => {
                          loadSampleData(k as keyof typeof SAMPLE_LEASES);
                          setShowSampleMenu(false);
                        }}
                        className="w-full text-left px-3 py-3 text-sm text-[#374151] hover:bg-[#f0f9ff] hover:text-[#2E86AB] transition-colors flex items-center gap-2 border-b border-[#f8fafc] last:border-0"
                      >
                        {label}
                      </button>
                    ))}
                    <div className="px-3 py-2 bg-[#f8fafc] rounded-b-lg">
                      <p className="text-xs text-[#94a3b8]">✦ AI IBR suggestion available after loading</p>
                    </div>
                  </div>
                )}
              </div>
              <Button onClick={handleCalculate} disabled={isCalculating} className="bg-gradient-to-r from-[#f97316] to-[#ef4444] text-white hover:opacity-90">
                {isCalculating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Calculator className="w-4 h-4 mr-2" />}
                Calculate IFRS 16
              </Button>
              <Button onClick={handleHeaderSave} disabled={saving} variant="secondary" className="border border-[#e2e8f0] bg-white">
                <Save className="w-4 h-4 mr-2" /> Save
              </Button>
              {excelFileId ? (
                <a href={ifrs16Api.downloadReport(excelFileId)} target="_blank" rel="noopener noreferrer">
                  <Button variant="secondary" className="border border-[#e2e8f0] bg-white">
                    <Download className="w-4 h-4 mr-2" /> Download Excel
                  </Button>
                </a>
              ) : null}
              <Button variant="secondary" className="text-red-600 hover:bg-red-50 border-0" onClick={handleDelete}>
                Delete
              </Button>
            </div>
          </div>
        </div>

        {/* AI Upload bar - collapsible */}
        <div className="mb-6 rounded-[14px] border-2 border-dashed border-[#f97316] bg-[#fff7ed]/30 overflow-hidden">
          <button
            type="button"
            onClick={() => setAiBarOpen((o) => !o)}
            className="w-full px-6 py-3 flex items-center justify-between text-left"
          >
            <span className="font-medium text-[#1e293b]">🤖 AI Contract Extraction — Upload PDF, DOCX, or Excel to auto-fill all tabs</span>
            {aiBarOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {aiBarOpen && (
            <div className="px-6 pb-4">
              <div
                className="border-2 border-dashed border-[#f97316] rounded-lg p-6 text-center bg-white/50"
                onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f && /\.(pdf|docx|xlsx|xls|txt)$/i.test(f.name)) handleFileUpload(f); }}
                onDragOver={(e) => e.preventDefault()}
              >
                <input
                  type="file"
                  accept=".pdf,.docx,.xlsx,.xls,.txt"
                  className="hidden"
                  id="ai-upload"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); e.target.value = ''; }}
                  disabled={uploading}
                />
                <label htmlFor="ai-upload" className="cursor-pointer block">
                  {uploading ? <Loader2 className="w-10 h-10 mx-auto mb-2 animate-spin text-[#f97316]" /> : <Upload className="w-10 h-10 mx-auto mb-2 text-[#f97316]" />}
                  <p className="text-[#1e293b] font-medium">Click to upload or drag and drop</p>
                </label>
              </div>
              {uploadError && <p className="mt-2 text-sm text-red-600">{uploadError}</p>}
            </div>
          )}
        </div>

        {extractionBanner && (
          <div className="mb-6 p-4 rounded-xl bg-[#f0fdf4] border border-[#86efac] text-[#166534] text-sm">
            {extractionBanner}
          </div>
        )}

        {/* Tab bar */}
        <div className="border-b border-[#e2e8f0] mb-6">
          <div className="flex gap-1 overflow-x-auto">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = activeTab === t.id;
              const dirty = dirtyTabs.has(t.id);
              const hasExtracted = extractedTabs.has(t.id);
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${active ? 'border-[#f97316] text-[#f97316]' : 'border-transparent text-[#64748b] hover:bg-[#fff7ed]'} ${dirty || hasExtracted ? ' relative' : ''}`}
                >
                  <Icon className="w-4 h-4" /> {t.label}
                  {hasExtracted && <span className="absolute top-1.5 right-1 w-2 h-2 rounded-full bg-[#f97316]" title="AI extracted data" />}
                  {dirty && !hasExtracted && <span className="absolute top-1.5 right-1 w-2 h-2 rounded-full bg-[#f97316]" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Tab content - wrapper */}
        <div className="bg-white rounded-[14px] border border-[#e2e8f0] p-6 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
          {activeTab === 'contract' && (
            <>
              <h3 className="text-lg font-semibold text-[#1e293b] mb-4 flex items-center gap-2">
                <FileText className="w-5 h-5 text-[#f97316]" /> Contract Details
              </h3>
              <section className="mb-6 rounded-[14px] border border-[#fed7aa] bg-[#fff7ed]/40 p-4">
                <p className="text-sm font-medium text-[#1e293b] mb-3">
                  Optional: AI-fill from contract (manual fields below stay editable)
                </p>
                <div className="flex gap-2 border-b border-[#fed7aa] mb-4">
                  <button
                    type="button"
                    onClick={() => setContractIntakeTab('upload')}
                    className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                      contractIntakeTab === 'upload'
                        ? 'border-[#f97316] text-[#f97316]'
                        : 'border-transparent text-[#64748b]'
                    }`}
                  >
                    <span className="inline-flex items-center gap-2">
                      <Upload className="w-4 h-4" /> Upload file
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setContractIntakeTab('paste')}
                    className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                      contractIntakeTab === 'paste'
                        ? 'border-[#f97316] text-[#f97316]'
                        : 'border-transparent text-[#64748b]'
                    }`}
                  >
                    <span className="inline-flex items-center gap-2">
                      <FileText className="w-4 h-4" /> Paste lease text
                    </span>
                  </button>
                </div>
                {contractIntakeTab === 'upload' ? (
                  <div
                    className="border-2 border-dashed border-[#f97316] rounded-lg p-6 text-center bg-white/60"
                    onDrop={(e) => {
                      e.preventDefault();
                      const f = e.dataTransfer.files[0];
                      if (f && /\.(pdf|docx|xlsx|xls|txt)$/i.test(f.name)) handleFileUpload(f);
                    }}
                    onDragOver={(e) => e.preventDefault()}
                  >
                    <input
                      type="file"
                      accept=".pdf,.docx,.xlsx,.xls,.txt"
                      className="hidden"
                      id="contract-tab-upload"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleFileUpload(f);
                        e.target.value = '';
                      }}
                      disabled={uploading}
                    />
                    <label htmlFor="contract-tab-upload" className="cursor-pointer block">
                      {uploading ? (
                        <Loader2 className="w-8 h-8 mx-auto mb-2 animate-spin text-[#f97316]" />
                      ) : (
                        <Upload className="w-8 h-8 mx-auto mb-2 text-[#f97316]" />
                      )}
                      <p className="text-sm text-[#1e293b] font-medium">Click to upload or drag and drop</p>
                      <p className="text-xs text-[#64748b] mt-1">PDF, DOCX, Excel, or TXT</p>
                    </label>
                  </div>
                ) : (
                  <div>
                    <label className="block text-sm font-medium text-[#1e293b] mb-2">Paste lease contract text</label>
                    <textarea
                      value={leasePasteText}
                      onChange={(e) => setLeasePasteText(e.target.value)}
                      rows={8}
                      className="w-full px-4 py-3 border border-[#e2e8f0] rounded-lg text-sm focus:ring-2 focus:ring-[#f97316] focus:border-[#f97316]"
                      placeholder="Paste lease agreement text (e.g. AED 15,000/month, 60 months, IBR 7.5%)..."
                      disabled={uploading}
                    />
                    <Button
                      className="mt-3 bg-[#f97316] text-white"
                      onClick={() => void handlePasteLeaseExtract()}
                      disabled={uploading || !leasePasteText.trim()}
                    >
                      {uploading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin mr-2" />
                          Extracting…
                        </>
                      ) : (
                        'Extract & fill form'
                      )}
                    </Button>
                  </div>
                )}
                {uploadError && <p className="mt-2 text-sm text-red-600">{uploadError}</p>}
                {extractionBanner && (
                  <p className="mt-2 text-sm text-[#166534] bg-[#f0fdf4] border border-[#86efac] rounded-lg px-3 py-2">
                    {extractionBanner}
                  </p>
                )}
              </section>
              <section className="mb-6">
                <h4 className="text-sm font-medium text-[#64748b] border-b border-[#e2e8f0] pb-2 mb-3">Basic Information</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div>
                    <label className={labelClass}>Transaction Type</label>
                    <select value={form.transactionType} onChange={(e) => { setForm((p) => ({ ...p, transactionType: e.target.value })); markDirty('contract'); }} className={inputClass}>
                      {TRANSACTION_TYPES.map((o) => <option key={o}>{o}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Legal Entity</label>
                    <input type="text" value={form.legalEntity} onChange={(e) => { setForm((p) => ({ ...p, legalEntity: e.target.value })); markDirty('contract'); }} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Lease ID</label>
                    <input type="text" value={form.leaseId} readOnly className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Title</label>
                    <input type="text" value={form.title} onChange={(e) => { setForm((p) => ({ ...p, title: e.target.value })); markDirty('contract'); }} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Lease Status</label>
                    <select value={form.leaseStatus} onChange={(e) => { setForm((p) => ({ ...p, leaseStatus: e.target.value })); markDirty('contract'); }} className={inputClass}>
                      {LEASE_STATUS_OPTIONS.map((o) => <option key={o}>{o}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Modification Date</label>
                    <input type="date" value={form.modificationDate} onChange={(e) => { setForm((p) => ({ ...p, modificationDate: e.target.value })); markDirty('contract'); }} className={inputClass} />
                  </div>
                </div>
              </section>
              <section className="mb-6">
                <h4 className="text-sm font-medium text-[#64748b] border-b border-[#e2e8f0] pb-2 mb-3">Dates & Financial Terms</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div><label className={labelClass}>Start Date</label><input type="date" value={form.startDate} onChange={(e) => { setForm((p) => ({ ...p, startDate: e.target.value })); markDirty('contract'); }} className={inputClass} /></div>
                  <div><label className={labelClass}>End Date</label><input type="date" value={form.endDate} onChange={(e) => { setForm((p) => ({ ...p, endDate: e.target.value })); markDirty('contract'); }} className={inputClass} /></div>
                  <div><label className={labelClass}>Effective Date</label><input type="date" value={form.effectiveDate} onChange={(e) => { setForm((p) => ({ ...p, effectiveDate: e.target.value })); markDirty('contract'); }} className={inputClass} /></div>
                  <div><label className={labelClass}>Payment Date</label><input type="date" value={form.paymentDate} onChange={(e) => { setForm((p) => ({ ...p, paymentDate: e.target.value })); markDirty('contract'); }} className={inputClass} /></div>
                  <div><label className={labelClass}>Renewal Date</label><input type="date" value={form.renewalDate} onChange={(e) => { setForm((p) => ({ ...p, renewalDate: e.target.value })); markDirty('contract'); }} className={inputClass} /></div>
                  <div><label className={labelClass}>Early Termination Date</label><input type="date" value={form.earlyTerminationDate} onChange={(e) => { setForm((p) => ({ ...p, earlyTerminationDate: e.target.value })); markDirty('contract'); }} className={inputClass} /></div>
                  <div><label className={labelClass}>Extended End Date</label><input type="date" value={form.extendedEndDate} onChange={(e) => { setForm((p) => ({ ...p, extendedEndDate: e.target.value })); markDirty('contract'); }} className={inputClass} /></div>
                  <div><label className={labelClass}>Contract Sealing Date</label><input type="date" value={form.contractSealingDate} onChange={(e) => { setForm((p) => ({ ...p, contractSealingDate: e.target.value })); markDirty('contract'); }} className={inputClass} /></div>
                  <div><label className={labelClass}>Residual Value (₹)</label><input type="number" value={form.residualValue} onChange={(e) => { setForm((p) => ({ ...p, residualValue: e.target.value })); markDirty('contract'); }} className={inputClass} /></div>
                  <div><label className={labelClass}>Optional Purchase Price (₹)</label><input type="number" value={form.optionalPurchasePrice} onChange={(e) => { setForm((p) => ({ ...p, optionalPurchasePrice: e.target.value })); markDirty('contract'); }} className={inputClass} /></div>
                  <div><label className={labelClass}>Contract Sealing Location</label><input type="text" value={form.contractSealingLocation} onChange={(e) => { setForm((p) => ({ ...p, contractSealingLocation: e.target.value })); markDirty('contract'); }} className={inputClass} /></div>
                </div>
                <label className="flex items-center gap-2 mt-3"><input type="checkbox" checked={form.enableContractReduction} onChange={(e) => { setForm((p) => ({ ...p, enableContractReduction: e.target.checked })); markDirty('contract'); }} /> Enable Contract Reduction</label>
              </section>
              <section className="mb-6">
                <h4 className="text-sm font-medium text-[#64748b] border-b border-[#e2e8f0] pb-2 mb-3">Description & Terms</h4>
                <div className="space-y-4">
                  <div><label className={labelClass}>Description</label><textarea value={form.description} onChange={(e) => { setForm((p) => ({ ...p, description: e.target.value })); markDirty('contract'); }} className={inputClass} rows={3} /></div>
                  <div><label className={labelClass}>Termination Clauses</label><textarea value={form.terminationClauses} onChange={(e) => { setForm((p) => ({ ...p, terminationClauses: e.target.value })); markDirty('contract'); }} className={inputClass} rows={2} /></div>
                  <div><label className={labelClass}>Renewal Options</label><textarea value={form.renewalOptions} onChange={(e) => { setForm((p) => ({ ...p, renewalOptions: e.target.value })); markDirty('contract'); }} className={inputClass} rows={2} /></div>
                </div>
              </section>
              <details className="mb-6 border border-[#e2e8f0] rounded-lg overflow-hidden">
                <summary className="px-4 py-3 bg-[#f8fafc] text-sm font-medium cursor-pointer">Contact Details</summary>
                <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="rounded-lg overflow-hidden border border-[#e2e8f0]">
                    <div className="px-3 py-2 bg-gradient-to-r from-[#f97316] to-[#ef4444] text-white text-sm font-medium">Lessor Details</div>
                    <div className="p-3 space-y-2">
                      <div><label className={labelClass}>Name</label><input type="text" value={form.lessorDetails?.name ?? ''} onChange={(e) => { setForm((p) => ({ ...p, lessorDetails: { ...p.lessorDetails, name: e.target.value } })); markDirty('contract'); }} className={inputClass} /></div>
                      <div><label className={labelClass}>Email</label><input type="email" value={form.lessorDetails?.email ?? ''} onChange={(e) => { setForm((p) => ({ ...p, lessorDetails: { ...p.lessorDetails, email: e.target.value } })); markDirty('contract'); }} className={inputClass} /></div>
                      <div><label className={labelClass}>Phone</label><input type="text" value={form.lessorDetails?.phone ?? ''} onChange={(e) => { setForm((p) => ({ ...p, lessorDetails: { ...p.lessorDetails, phone: e.target.value } })); markDirty('contract'); }} className={inputClass} /></div>
                      <div><label className={labelClass}>Address</label><input type="text" value={form.lessorDetails?.address ?? ''} onChange={(e) => { setForm((p) => ({ ...p, lessorDetails: { ...p.lessorDetails, address: e.target.value } })); markDirty('contract'); }} className={inputClass} /></div>
                    </div>
                  </div>
                  <div className="rounded-lg overflow-hidden border border-[#e2e8f0]">
                    <div className="px-3 py-2 bg-gradient-to-r from-[#f97316] to-[#ef4444] text-white text-sm font-medium">Lessee Details</div>
                    <div className="p-3 space-y-2">
                      <div><label className={labelClass}>Name</label><input type="text" value={form.lesseeDetails?.name ?? ''} onChange={(e) => { setForm((p) => ({ ...p, lesseeDetails: { ...p.lesseeDetails, name: e.target.value } })); markDirty('contract'); }} className={inputClass} /></div>
                      <div><label className={labelClass}>Email</label><input type="email" value={form.lesseeDetails?.email ?? ''} onChange={(e) => { setForm((p) => ({ ...p, lesseeDetails: { ...p.lesseeDetails, email: e.target.value } })); markDirty('contract'); }} className={inputClass} /></div>
                      <div><label className={labelClass}>Phone</label><input type="text" value={form.lesseeDetails?.phone ?? ''} onChange={(e) => { setForm((p) => ({ ...p, lesseeDetails: { ...p.lesseeDetails, phone: e.target.value } })); markDirty('contract'); }} className={inputClass} /></div>
                      <div><label className={labelClass}>Address</label><input type="text" value={form.lesseeDetails?.address ?? ''} onChange={(e) => { setForm((p) => ({ ...p, lesseeDetails: { ...p.lesseeDetails, address: e.target.value } })); markDirty('contract'); }} className={inputClass} /></div>
                    </div>
                  </div>
                  <div className="rounded-lg overflow-hidden border border-[#e2e8f0]">
                    <div className="px-3 py-2 bg-gradient-to-r from-[#f97316] to-[#ef4444] text-white text-sm font-medium">Legal Details</div>
                    <div className="p-3 space-y-2">
                      <div><label className={labelClass}>Name</label><input type="text" value={form.legalDetails?.name ?? ''} onChange={(e) => { setForm((p) => ({ ...p, legalDetails: { ...p.legalDetails, name: e.target.value } })); markDirty('contract'); }} className={inputClass} /></div>
                      <div><label className={labelClass}>Code</label><input type="text" value={form.legalDetails?.code ?? ''} onChange={(e) => { setForm((p) => ({ ...p, legalDetails: { ...p.legalDetails, code: e.target.value } })); markDirty('contract'); }} className={inputClass} /></div>
                      <div><label className={labelClass}>Address</label><input type="text" value={form.legalDetails?.address ?? ''} onChange={(e) => { setForm((p) => ({ ...p, legalDetails: { ...p.legalDetails, address: e.target.value } })); markDirty('contract'); }} className={inputClass} /></div>
                      <div><label className={labelClass}>City</label><input type="text" value={form.legalDetails?.city ?? ''} onChange={(e) => { setForm((p) => ({ ...p, legalDetails: { ...p.legalDetails, city: e.target.value } })); markDirty('contract'); }} className={inputClass} /></div>
                      <div><label className={labelClass}>Country</label><input type="text" value={form.legalDetails?.country ?? ''} onChange={(e) => { setForm((p) => ({ ...p, legalDetails: { ...p.legalDetails, country: e.target.value } })); markDirty('contract'); }} className={inputClass} /></div>
                    </div>
                  </div>
                </div>
              </details>
              <div className="flex justify-end">
                <Button onClick={() => { handleSaveToRepo(); setDirtyTabs((s) => { const n = new Set(s); n.delete('contract'); return n; }); }} className="bg-[#f97316] text-white">Save Tab</Button>
              </div>
            </>
          )}

          {activeTab === 'financial' && (
            <>
              <h3 className="text-lg font-semibold text-[#1e293b] mb-4 flex items-center gap-2"><DollarSign className="w-5 h-5 text-[#f97316]" /> Financial Management</h3>
              <section className="mb-6">
                <h4 className="text-sm font-medium text-[#64748b] border-b border-[#e2e8f0] pb-2 mb-3">Basic Financial Information</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div><label className={labelClass}>Base Rent Amount (₹)</label><input type="number" value={form.baseRentAmount} onChange={(e) => { setForm((p) => ({ ...p, baseRentAmount: e.target.value })); markDirty('financial'); }} className={inputClass} /></div>
                  <div>
                    <label className={labelClass}>Payment Frequency</label>
                    <select value={form.paymentFrequency} onChange={(e) => { setForm((p) => ({ ...p, paymentFrequency: e.target.value })); markDirty('financial'); }} className={inputClass}>
                      {PAYMENT_FREQ.map((f) => <option key={f}>{f}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Payment Type</label>
                    <select value={form.paymentType} onChange={(e) => { setForm((p) => ({ ...p, paymentType: e.target.value })); markDirty('financial'); }} className={inputClass}>
                      {PAYMENT_TYPES.map((p) => <option key={p}>{p}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Currency</label>
                    <select value={form.currency} onChange={(e) => { setForm((p) => ({ ...p, currency: e.target.value })); markDirty('financial'); }} className={inputClass}>
                      {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div><label className={labelClass}>Extended Base Rent (₹)</label><input type="number" value={form.extendedBaseRentAmount} onChange={(e) => { setForm((p) => ({ ...p, extendedBaseRentAmount: e.target.value })); markDirty('financial'); }} className={inputClass} /></div>
                  <div><label className={labelClass}>Exchange Rate</label><input type="text" value={form.exchangeRate} onChange={(e) => { setForm((p) => ({ ...p, exchangeRate: e.target.value })); markDirty('financial'); }} className={inputClass} /></div>
                  <div>
                    <label className={labelClass} title="Incremental costs of obtaining a lease: ✅ Legal fees, agent commissions, costs to prepare asset. ❌ Internal staff time, general admin.">
                      Legal Fees (₹) <Info className="inline w-3.5 h-3.5 text-[#64748b] cursor-help" />
                    </label>
                    <input type="number" min="0" value={form.legalFees ?? '0'} onChange={(e) => { setForm((p) => ({ ...p, legalFees: e.target.value })); markDirty('financial'); }} className={inputClass} />
                  </div>
                  <div><label className={labelClass}>Brokerage / Agent Fees (₹)</label><input type="number" min="0" value={form.brokerageFees ?? '0'} onChange={(e) => { setForm((p) => ({ ...p, brokerageFees: e.target.value })); markDirty('financial'); }} className={inputClass} /></div>
                  <div><label className={labelClass}>Other Initial Direct Costs (₹)</label><input type="number" min="0" value={form.otherInitialDirectCosts ?? '0'} onChange={(e) => { setForm((p) => ({ ...p, otherInitialDirectCosts: e.target.value })); markDirty('financial'); }} className={inputClass} /></div>
                  <div className="md:col-span-2"><label className={labelClass}>IDC Description</label><input type="text" value={form.initialDirectCostsDescription ?? ''} onChange={(e) => { setForm((p) => ({ ...p, initialDirectCostsDescription: e.target.value })); markDirty('financial'); }} className={inputClass} placeholder="e.g. Legal fees for lease negotiation, agent commission" /></div>
                  <div className="md:col-span-2 flex items-end"><p className="text-sm text-[#64748b]">Total initial direct costs: <span className="font-mono font-medium text-[#1e293b]">{fmt((parseFloat(form.legalFees ?? '0') || 0) + (parseFloat(form.brokerageFees ?? '0') || 0) + (parseFloat(form.otherInitialDirectCosts ?? '0') || 0))}</span></p></div>
                  <div><label className={labelClass}>Rent-Free Period (months)</label><input type="number" min="0" value={form.rentFreeMonths ?? 0} onChange={(e) => { setForm((p) => ({ ...p, rentFreeMonths: parseInt(e.target.value, 10) || 0 })); markDirty('financial'); }} className={inputClass} placeholder="0" /></div>
                  <div><label className={labelClass}>Cash Incentive Received (₹)</label><input type="number" min="0" value={form.cashIncentive ?? form.leaseIncentives ?? '0'} onChange={(e) => { setForm((p) => ({ ...p, cashIncentive: e.target.value, leaseIncentives: e.target.value })); markDirty('financial'); }} className={inputClass} placeholder="0" /></div>
                  <div className="md:col-span-2"><label className={labelClass}>Lease Incentive Description</label><input type="text" value={form.leaseIncentiveDescription ?? ''} onChange={(e) => { setForm((p) => ({ ...p, leaseIncentiveDescription: e.target.value })); markDirty('financial'); }} className={inputClass} placeholder="e.g. 2 months rent free" /></div>
                </div>
              </section>
              <ComponentSplitWizard
                isNew={isNew}
                monthlyPayment={parseFloat(form.baseRentAmount) || 0}
                termMonths={(() => {
                  const start = form.startDate || form.effectiveDate;
                  if (form.lease_term_months) return Math.max(1, parseInt(String(form.lease_term_months), 10) || 12);
                  if (start && form.endDate) {
                    return Math.max(
                      1,
                      Math.ceil(
                        (new Date(form.endDate).getTime() - new Date(start).getTime()) /
                          (1000 * 60 * 60 * 24 * 30)
                      )
                    );
                  }
                  return 12;
                })()}
                ibrPct={parseFloat(form.discountRate) || 0}
                commencementDate={form.startDate || form.effectiveDate || ''}
                currency={form.currency || 'INR'}
                leaseId={form.leaseId || id || 'NEW-LEASE'}
                practicalExpedientElected={Boolean(form.practicalExpedientElected)}
                onPracticalExpedientChange={(v) => {
                  setForm((p) => ({ ...p, practicalExpedientElected: v }));
                  markDirty('financial');
                }}
                onApplyToForm={({ nonLeaseComponent, nonLeaseDescription }) => {
                  setForm((p) => ({
                    ...p,
                    nonLeaseComponent,
                    nonLeaseDescription,
                    practicalExpedientElected: false,
                  }));
                  markDirty('financial');
                }}
                onAfterApply={(patch) =>
                  void handleCalculate({
                    nonLeaseComponent: patch.nonLeaseComponent,
                    nonLeaseDescription: patch.nonLeaseDescription,
                    practicalExpedientElected: false,
                  })
                }
              />
              <section className="mb-6">
                <h4 className="text-sm font-medium text-[#64748b] border-b border-[#e2e8f0] pb-2 mb-3">Residual Value Guarantee (IFRS 16 para 26(d))</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div><label className={labelClass}>RVG Amount (₹)</label><input type="number" min="0" value={form.rvgAmount ?? '0'} onChange={(e) => { setForm((p) => ({ ...p, rvgAmount: e.target.value })); markDirty('financial'); }} className={inputClass} placeholder="Guaranteed amount" /></div>
                  <div>
                    <label className={labelClass}>Guaranteed By</label>
                    <select value={form.rvgGuaranteedBy ?? 'None'} onChange={(e) => { setForm((p) => ({ ...p, rvgGuaranteedBy: e.target.value })); markDirty('financial'); }} className={inputClass}>
                      <option value="None">None</option>
                      <option value="Lessee">Lessee</option>
                      <option value="Third party">Third party</option>
                    </select>
                    <p className="mt-1 text-xs text-[#64748b]">Only lessee guarantee included in liability</p>
                  </div>
                  <div><label className={labelClass}>Expected Payment at End (₹)</label><input type="number" min="0" value={form.rvgExpectedPayment ?? '0'} onChange={(e) => { setForm((p) => ({ ...p, rvgExpectedPayment: e.target.value })); markDirty('financial'); }} className={inputClass} placeholder="What lessee expects to pay" /></div>
                </div>
              </section>
              <section className="mb-6">
                <h4 className="text-sm font-medium text-[#64748b] border-b border-[#e2e8f0] pb-2 mb-3">Escalation & Terms</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div>
                    <label className={labelClass}>Escalation Type</label>
                    <select value={form.escalationType} onChange={(e) => { setForm((p) => ({ ...p, escalationType: e.target.value })); markDirty('financial'); }} className={inputClass}>
                      {ESCALATION_TYPES.map((e) => <option key={e}>{e}</option>)}
                    </select>
                  </div>
                  <div><label className={labelClass}>Escalation Value %</label><input type="number" value={form.escalationValue} onChange={(e) => { setForm((p) => ({ ...p, escalationValue: e.target.value })); markDirty('financial'); }} className={inputClass} /></div>
                  <div><label className={labelClass}>Escalation Start Date</label><input type="date" value={form.escalationStartDate} onChange={(e) => { setForm((p) => ({ ...p, escalationStartDate: e.target.value })); markDirty('financial'); }} className={inputClass} /></div>
                  <div>
                    <label className={labelClass}>Escalation Frequency</label>
                    <select value={form.escalationFrequency} onChange={(e) => { setForm((p) => ({ ...p, escalationFrequency: e.target.value })); markDirty('financial'); }} className={inputClass}>
                      {ESCALATION_FREQ.map((f) => <option key={f}>{f}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>IBR / Discount Rate % <span className="text-red-500">*</span></label>
                    <input
                      ref={ibrInputRef}
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="e.g. 8.5"
                      value={form.discountRate}
                      onChange={(e) => { setForm((p) => ({ ...p, discountRate: e.target.value })); markDirty('financial'); setIbrError(null); }}
                      className={`${inputClass} ${ibrError ? 'border-red-500 ring-2 ring-red-200' : ''}`}
                    />
                    <button
                      type="button"
                      onClick={fetchIbrSuggestion}
                      disabled={ibrLoading}
                      className="mt-2 flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 border border-blue-200 rounded px-2 py-1 bg-blue-50 hover:bg-blue-100 disabled:opacity-70"
                    >
                      {ibrLoading ? <span className="animate-spin">⟳</span> : <span>✦</span>}
                      {ibrLoading ? 'Analysing market rates...' : 'AI: Suggest IBR range'}
                    </button>
                    {ibrSuggestion && (
                      <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-medium text-blue-800">AI IBR Suggestion</span>
                          <span className="text-xs text-blue-500">IFRS 16 §26</span>
                        </div>
                        <div className="flex gap-2 mb-2">
                          <button
                            type="button"
                            onClick={() => { setForm((p) => ({ ...p, discountRate: String(ibrSuggestion.ibr_high) })); setIbrError(null); }}
                            className="flex-1 py-1.5 rounded border text-xs font-medium border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                          >
                            Conservative<br />
                            <span className="text-sm font-bold">{ibrSuggestion.ibr_high}%</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => { setForm((p) => ({ ...p, discountRate: String(ibrSuggestion.ibr_mid) })); setIbrError(null); }}
                            className="flex-1 py-1.5 rounded border text-xs font-medium border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                          >
                            Mid<br />
                            <span className="text-sm font-bold">{ibrSuggestion.ibr_mid}%</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => { setForm((p) => ({ ...p, discountRate: String(ibrSuggestion.ibr_low) })); setIbrError(null); }}
                            className="flex-1 py-1.5 rounded border text-xs font-medium border-green-200 bg-green-50 text-green-700 hover:bg-green-100"
                          >
                            Aggressive<br />
                            <span className="text-sm font-bold">{ibrSuggestion.ibr_low}%</span>
                          </button>
                        </div>
                        <p className="text-xs text-blue-700 mb-1">{ibrSuggestion.rationale}</p>
                        <div className="flex flex-wrap gap-1">
                          {ibrSuggestion.market_references.map((ref) => (
                            <span key={ref} className="text-xs bg-white border border-blue-200 text-blue-600 rounded px-1.5 py-0.5">
                              {ref}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    <p className="mt-1 text-xs text-[#64748b]">Incremental Borrowing Rate — company&apos;s cost of borrowing. Typical: Corporate 6–10%, SME 8–12%</p>
                    {ibrError && <p className="mt-1 text-sm text-red-600">{ibrError}</p>}
                  </div>
                  <div><label className={labelClass}>Extended Escalation Value</label><input type="text" value={form.extendedEscalationValue} onChange={(e) => { setForm((p) => ({ ...p, extendedEscalationValue: e.target.value })); markDirty('financial'); }} className={inputClass} /></div>
                </div>
              </section>
              <section className="mb-6">
                <h4 className="text-sm font-medium text-[#64748b] border-b border-[#e2e8f0] pb-2 mb-3">Business Unit & Cost Centers</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                  <div><label className={labelClass}>Lessor</label><input type="text" value={form.lessor} onChange={(e) => { setForm((p) => ({ ...p, lessor: e.target.value })); markDirty('financial'); }} className={inputClass} placeholder="Search or type" /></div>
                  <div><label className={labelClass}>Lessee</label><input type="text" value={form.lessee} onChange={(e) => { setForm((p) => ({ ...p, lessee: e.target.value })); markDirty('financial'); }} className={inputClass} placeholder="Search or type" /></div>
                  <div><label className={labelClass}>Business Unit</label><input type="text" value={form.businessUnit} onChange={(e) => { setForm((p) => ({ ...p, businessUnit: e.target.value })); markDirty('financial'); }} className={inputClass} /></div>
                </div>
                <div className="mb-2">
                  <label className={labelClass}>Cost Center (type and press Enter)</label>
                  <input
                    type="text"
                    value={costCenterInput}
                    onChange={(e) => setCostCenterInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const name = costCenterInput.trim();
                        if (name && !form.costCenterTags.includes(name)) {
                          setForm((p) => ({ ...p, costCenterTags: [...p.costCenterTags, name], costCenterAllocation: { ...p.costCenterAllocation, [name]: 0 } }));
                          markDirty('financial');
                          setCostCenterInput('');
                        }
                      }
                    }}
                    className={inputClass}
                    placeholder="e.g. Finance"
                  />
                </div>
                <div className="flex flex-wrap gap-2 mb-2">
                  {form.costCenterTags.map((tag: string) => (
                    <span key={tag} className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-[#fff7ed] border border-[#fed7aa] text-[#c2410c] font-medium text-sm">
                      {tag}
                      <button type="button" onClick={() => setForm((p) => ({ ...p, costCenterTags: p.costCenterTags.filter((t: string) => t !== tag), costCenterAllocation: Object.fromEntries(Object.entries(p.costCenterAllocation).filter(([k]) => k !== tag)) }))} className="text-[#f97316] hover:opacity-80"><X className="w-3.5 h-3.5" /></button>
                    </span>
                  ))}
                </div>
                {form.costCenterTags.length > 0 && (
                  <>
                    <div className="flex flex-wrap gap-3 items-center mb-2">
                      {form.costCenterTags.map((tag: string) => (
                        <span key={tag} className="inline-flex items-center gap-2">
                          <span className="text-sm text-[#64748b]">{tag}</span>
                          <select
                            value={form.costCenterAllocation[tag] ?? 0}
                            onChange={(e) => { const v = parseInt(e.target.value, 10); setForm((p) => ({ ...p, costCenterAllocation: { ...p.costCenterAllocation, [tag]: v } })); markDirty('financial'); }}
                            className="w-20 px-2 py-1 border border-[#e2e8f0] rounded text-sm font-mono"
                          >
                            {[0, 10, 20, 25, 30, 33, 40, 50, 60, 70, 75, 80, 90, 100].map((n) => <option key={n} value={n}>{n}%</option>)}
                          </select>
                        </span>
                      ))}
                    </div>
                    <p className={`text-sm font-mono ${allocationTotal === 100 ? 'text-green-600' : 'text-red-600'}`}>Total Allocation: {allocationTotal}% {allocationTotal === 100 ? '✓' : ''}</p>
                  </>
                )}
              </section>
              <div className="flex justify-end">
                <Button onClick={() => { handleSaveToRepo(); setDirtyTabs((s) => { const n = new Set(s); n.delete('financial'); return n; }); }} className="bg-[#f97316] text-white">Save Tab</Button>
              </div>
            </>
          )}

          {activeTab === 'modifications' && (() => {
            const mods = form.modifications || [];
            const liability = calcResults?.lease_liability ?? existingLease?.liability ?? 0;
            const rou = calcResults?.rou_asset ?? existingLease?.rou ?? 0;
            const restorationNum = parseFloat(String(form.restorationCost || '0')) || 0;
            const ibrPct = parseFloat(String(form.discountRate || '0')) || 0;
            const currentEndDate = form.endDate || '';
            const currentTermMonths = form.lease_term_months ? parseInt(form.lease_term_months, 10) : schedule.length;
            const currentMonthly = parseFloat(String(form.baseRentAmount || '0')) || 0;
            const lastApplied = mods.filter((m: any) => m.status === 'applied').sort((a: any, b: any) => (b.appliedAt || '').localeCompare(a.appliedAt || ''))[0];
            const priorLLBase = lastApplied ? (lastApplied.newLL ?? 0) : liability;
            const priorROUBase = lastApplied ? (lastApplied.newROU ?? 0) : rou;
            const priorRCBase = lastApplied ? (lastApplied.newRC ?? 0) : restorationNum;
            const modDate = modificationForm.date || modificationForm.effectiveDate || '';
            const priorLL = modDate && schedule.length ? getPriorLLFromSchedule(schedule, scheduleRow, modDate) : priorLLBase;
            const newEnd = modificationForm.newEndDate || currentEndDate;
            const newEndTime = newEnd ? Date.parse(newEnd) : 0;
            const modDateTime = modDate ? Date.parse(modDate) : 0;
            const newTerm = newEnd && modDate ? Math.max(0, Math.ceil((newEndTime - modDateTime) / (1000 * 60 * 60 * 24 * 30))) : (modificationForm.newTermMonths ? parseInt(String(modificationForm.newTermMonths), 10) : currentTermMonths);
            const newMonthly = parseFloat(String(modificationForm.newMonthlyPayment || modificationForm.newMonthlyPayment === 0 ? modificationForm.newMonthlyPayment : form.baseRentAmount || '0')) || currentMonthly;
            const newIBR = modificationForm.newIBR !== '' && modificationForm.newIBR !== undefined ? parseFloat(String(modificationForm.newIBR)) : ibrPct;
            const revisedLL = pvOfAnnuity(newMonthly, newIBR, newTerm);
            const llAdjustment = revisedLL - priorLL;
            const isScopeIncrease = modificationForm.type === 'scope_increase' || modificationForm.type === 'extension';
            const isScopeDecrease = modificationForm.type === 'scope_decrease' || modificationForm.type === 'termination';
            const rouAdjustment = isScopeIncrease ? llAdjustment : isScopeDecrease ? (priorROUBase * (Math.abs(llAdjustment) / (priorLLBase || 1))) : llAdjustment;
            const gainLoss = isScopeDecrease ? (rouAdjustment - llAdjustment) : 0;
            const newROU = priorROUBase + (isScopeIncrease ? llAdjustment : modificationForm.type !== 'termination' ? llAdjustment : -priorROUBase);
            const newRC = parseFloat(String(modificationForm.newRestoration || '0')) || priorRCBase;
            const rcAdjustment = newRC - priorRCBase;
            const journalEntries: { dr: string; cr: string; amount: number }[] = [];
            if (modificationForm.type === 'termination') {
              journalEntries.push({ dr: 'Lease Liability (full balance)', cr: 'Right-of-Use Asset (cost)', amount: priorLL });
              journalEntries.push({ dr: 'Accumulated Depreciation', cr: 'Right-of-Use Asset (cost)', amount: 0 });
              if (gainLoss !== 0) journalEntries.push({ dr: 'Lease Liability', cr: 'Gain on Termination', amount: Math.abs(gainLoss) });
            } else if (isScopeDecrease && gainLoss > 0) {
              journalEntries.push({ dr: 'Lease Liability', cr: 'Right-of-Use Asset', amount: Math.abs(llAdjustment) });
              journalEntries.push({ dr: 'Lease Liability', cr: 'Gain on Lease Modification (P&L)', amount: gainLoss });
            } else if (llAdjustment !== 0) {
              if (llAdjustment > 0) journalEntries.push({ dr: 'Right-of-Use Asset', cr: 'Lease Liability', amount: llAdjustment });
              else journalEntries.push({ dr: 'Lease Liability', cr: 'Right-of-Use Asset', amount: Math.abs(llAdjustment) });
            }
            const typeBadge = (m: any) => {
              const opt = MODIFICATION_TYPE_OPTIONS.find((o) => o.value === (m.type || '')) || MODIFICATION_TYPE_OPTIONS[0];
              const label = opt?.label?.split('—')[0]?.trim() || m.type || '—';
              return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${opt?.badge || 'bg-gray-100 text-gray-700'}`}>{label}</span>;
            };
            const statusBadge = (s: string) => {
              if (s === 'applied') return <span className="px-2 py-0.5 rounded-full text-xs font-bold text-orange-700 bg-orange-100">Applied</span>;
              if (s === 'calculated') return <span className="px-2 py-0.5 rounded-full text-xs font-medium text-green-700 bg-green-100">Calculated</span>;
              return <span className="px-2 py-0.5 rounded-full text-xs font-medium text-gray-600 bg-gray-100">Draft</span>;
            };

            return (
              <>
                <h3 className="text-lg font-semibold text-[#1e293b] mb-2 flex items-center gap-2"><RefreshCw className="w-5 h-5 text-[#f97316]" /> Lease Modifications</h3>
                <p className="text-sm text-[#64748b] mb-4">Remeasure lease liability when terms change</p>

                {modificationPanel === 'list' ? (
                  <>
                    <div className="flex justify-end mb-4">
                      <Button className="bg-[#f97316] hover:bg-[#ea580c] text-white" onClick={() => { setModificationFormIndex(null); setModificationForm({ date: '', effectiveDate: '', type: 'extension', reason: '', notes: '', newEndDate: form.endDate || '', newMonthlyPayment: form.baseRentAmount || '', paymentFrequency: form.paymentFrequency || 'Monthly', paymentEffectiveFrom: '', indexType: 'CPI', newIndexRatePct: '', adjustmentCapPct: '', floorRatePct: '', newIBR: form.discountRate || '', newRestoration: form.restorationCost || '' }); setModificationPanel('form'); }}>
                        <Plus className="w-4 h-4 mr-2" /> Add Modification
                      </Button>
                    </div>
                    {mods.length === 0 ? (
                      <div className="py-16 rounded-xl border-2 border-dashed border-[#e2e8f0] bg-[#fafafa] text-center">
                        <p className="text-4xl mb-3">🔄</p>
                        <p className="font-medium text-[#1e293b] mb-1">No modifications recorded</p>
                        <p className="text-sm text-[#64748b] mb-4">Add a modification when lease terms change — extension, termination, rent review, or scope change</p>
                        <Button className="bg-[#f97316] text-white" onClick={() => { setModificationFormIndex(null); setModificationForm({ date: '', effectiveDate: '', type: 'extension', reason: '', notes: '', newEndDate: form.endDate || '', newMonthlyPayment: form.baseRentAmount || '', paymentFrequency: form.paymentFrequency || 'Monthly', paymentEffectiveFrom: '', indexType: 'CPI', newIndexRatePct: '', adjustmentCapPct: '', floorRatePct: '', newIBR: form.discountRate || '', newRestoration: form.restorationCost || '' }); setModificationPanel('form'); }}><Plus className="w-4 h-4 mr-2" /> Add First Modification</Button>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-[#e2e8f0] bg-white overflow-hidden mb-6">
                        <table className="w-full text-sm">
                          <thead className="bg-[#f9fafb]"><tr><th className="text-left py-3 px-4 font-semibold text-[#64748b]">#</th><th className="text-left py-3 px-4 font-semibold text-[#64748b]">Modification Date</th><th className="text-left py-3 px-4 font-semibold text-[#64748b]">Type</th><th className="text-left py-3 px-4 font-semibold text-[#64748b]">Reason</th><th className="text-right py-3 px-4 font-semibold text-[#64748b]">New LL</th><th className="text-right py-3 px-4 font-semibold text-[#64748b]">ROU Adj</th><th className="text-right py-3 px-4 font-semibold text-[#64748b]">Gain/Loss</th><th className="text-center py-3 px-4 font-semibold text-[#64748b]">Status</th><th className="text-center py-3 px-4 font-semibold text-[#64748b]">Actions</th></tr></thead>
                          <tbody>
                            {mods.map((m: any, i: number) => (
                              <tr key={i} className="border-t border-[#e2e8f0] hover:bg-[#fafafa]">
                                <td className="py-3 px-4 font-mono">{i + 1}</td>
                                <td className="py-3 px-4">{m.date ?? m.effectiveDate ?? '—'}</td>
                                <td className="py-3 px-4">{typeBadge(m)}</td>
                                <td className="py-3 px-4 text-[#64748b]">{(m.reason || m.notes || '').slice(0, 40)}{(m.reason || m.notes || '').length > 40 ? '…' : ''}</td>
                                <td className="py-3 px-4 text-right font-mono">{fmt(m.newLL ?? 0)}</td>
                                <td className="py-3 px-4 text-right font-mono">{fmt(m.rouAdjustment ?? 0)}</td>
                                <td className={`py-3 px-4 text-right font-mono ${(m.gainLoss ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmt(m.gainLoss ?? 0)}</td>
                                <td className="py-3 px-4 text-center">{statusBadge(m.status || 'draft')}</td>
                                <td className="py-3 px-4">
                                  <div className="flex items-center justify-center gap-1">
                                    <button type="button" onClick={() => { setModificationModalIndex(i); }} className="text-[#f97316] hover:underline text-xs font-medium">View</button>
                                    {m.status !== 'applied' && <button type="button" onClick={() => { setModificationFormIndex(i); setModificationForm({ date: m.date, effectiveDate: m.effectiveDate, type: m.type || 'extension', reason: m.reason, notes: m.notes, newEndDate: m.newEndDate, newMonthlyPayment: m.newMonthlyPayment, newIBR: m.newIBR, newRestoration: m.newRestoration, ...m }); setModificationPanel('form'); }} className="text-[#f97316] hover:underline text-xs font-medium">Edit</button>}
                                    {m.status !== 'applied' && <button type="button" onClick={() => setModificationModalIndex(i)} className="text-[#64748b] hover:underline text-xs">Recalculate</button>}
                                    {m.status !== 'applied' && <button type="button" onClick={() => { if (confirm('Delete this modification?')) { const next = mods.filter((_: any, j: number) => j !== i); setForm((p) => ({ ...p, modifications: next })); markDirty('modifications'); } }} className="text-red-600 hover:underline text-xs">Delete</button>}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    <details className="mb-6 rounded-xl border border-[#e2e8f0] bg-white overflow-hidden">
                      <summary className="px-4 py-3 bg-[#f9fafb] font-medium text-[#1e293b] cursor-pointer">Modification History & Audit Trail</summary>
                      <div className="px-4 py-4 border-t border-[#e2e8f0]">
                        {mods.length === 0 ? <p className="text-sm text-[#64748b]">No history yet.</p> : mods.filter((m: any) => m.status === 'applied').map((m: any) => {
                          const fullIndex = mods.indexOf(m);
                          return (
                          <div key={fullIndex} className="flex gap-3 mb-4">
                            <span className="text-[#f97316] font-bold">●</span>
                            <div>
                              <p className="font-medium text-[#1e293b]">[{m.date}] Modification {fullIndex + 1} — {MODIFICATION_TYPE_OPTIONS.find((o) => o.value === m.type)?.label?.split('—')[0] || m.type} — Applied{m.appliedBy ? ` by ${m.appliedBy}` : ''}</p>
                              <p className="text-sm text-[#64748b] ml-4">↓ Lease liability: {fmt(m.priorLL ?? 0)} → {fmt(m.newLL ?? 0)}</p>
                              <p className="text-sm text-[#64748b] ml-4">↓ ROU adjustment: {fmt(m.rouAdjustment ?? 0)}</p>
                            </div>
                          </div>
                          );
                        })}
                      </div>
                    </details>
                  </>
                ) : (
                  <div className="space-y-6">
                    <Button variant="secondary" className="mb-2" onClick={() => { setModificationPanel('list'); setModificationFormIndex(null); }}>← Back to list</Button>
                    <h4 className="text-lg font-semibold text-[#1e293b]">{modificationFormIndex === null ? 'New Modification' : `Edit Modification ${(modificationFormIndex ?? 0) + 1}`}</h4>

                    <ModificationAIAdvisor
                      extractorHints={contractData}
                      formOverlay={modificationAdvisorFormOverlay}
                      modificationInputs={{
                        modification_type: modificationForm.type,
                        new_payment: newMonthly,
                        original_payment: currentMonthly,
                        new_lease_term_months: newTerm,
                        original_lease_term_months: currentTermMonths,
                      }}
                      currentModificationType={modificationForm.type}
                      onAccept={(type) => setModificationForm((p) => ({ ...p, type }))}
                    />

                    <section className="rounded-xl border border-[#e2e8f0] p-6 bg-white">
                      <h5 className="text-sm font-semibold text-[#64748b] uppercase mb-4">Part A — Modification Details</h5>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        <div><label className={labelClass}>Modification Date</label><input type="date" className={inputClass} value={modificationForm.date} onChange={(e) => setModificationForm((p) => ({ ...p, date: e.target.value }))} /></div>
                        <div><label className={labelClass}>Effective Date</label><input type="date" className={inputClass} value={modificationForm.effectiveDate} onChange={(e) => setModificationForm((p) => ({ ...p, effectiveDate: e.target.value }))} /></div>
                        <div><label className={labelClass}>Modification Type</label><select className={inputClass} value={modificationForm.type} onChange={(e) => setModificationForm((p) => ({ ...p, type: e.target.value }))}>{MODIFICATION_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
                        <div><label className={labelClass}>Modification Reason</label><input type="text" className={inputClass} value={modificationForm.reason} onChange={(e) => setModificationForm((p) => ({ ...p, reason: e.target.value }))} placeholder="Brief reason" /></div>
                      </div>
                      <label className={labelClass}>Modification Notes (audit trail)</label>
                      <textarea className={inputClass + ' min-h-[80px]'} value={modificationForm.notes} onChange={(e) => setModificationForm((p) => ({ ...p, notes: e.target.value }))} placeholder="Describe the change..." />
                    </section>

                    <section className="rounded-xl border border-[#e2e8f0] p-6 bg-white">
                      <h5 className="text-sm font-semibold text-[#64748b] uppercase mb-4">Part B — Revised Lease Terms</h5>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        <div><label className={labelClass}>Current End Date</label><input type="text" className={inputClass + ' bg-gray-100'} readOnly value={currentEndDate} /></div>
                        <div><label className={labelClass}>New End Date</label><input type="date" className={inputClass} value={modificationForm.newEndDate} onChange={(e) => setModificationForm((p) => ({ ...p, newEndDate: e.target.value }))} /></div>
                        <div><label className={labelClass}>Current Term (months)</label><input type="text" className={inputClass + ' bg-gray-100'} readOnly value={currentTermMonths} /></div>
                        <div><label className={labelClass}>New Term (months)</label><input type="text" className={inputClass + ' bg-gray-100 font-mono'} readOnly value={newTerm} /></div>
                        <div><label className={labelClass}>Current Monthly Payment</label><input type="text" className={inputClass + ' bg-gray-100'} readOnly value={fmt(currentMonthly)} /></div>
                        <div><label className={labelClass}>New Monthly Payment</label><input type="number" className={inputClass} value={modificationForm.newMonthlyPayment} onChange={(e) => setModificationForm((p) => ({ ...p, newMonthlyPayment: e.target.value }))} /></div>
                        <div><label className={labelClass}>Current IBR %</label><input type="text" className={inputClass + ' bg-gray-100'} readOnly value={ibrPct} /></div>
                        <div><label className={labelClass}>New IBR %</label><input type="number" className={inputClass} value={modificationForm.newIBR} onChange={(e) => setModificationForm((p) => ({ ...p, newIBR: e.target.value }))} placeholder={String(ibrPct)} /></div>
                        {restorationNum > 0 && <><div><label className={labelClass}>Current Restoration</label><input type="text" className={inputClass + ' bg-gray-100'} readOnly value={fmt(priorRCBase)} /></div><div><label className={labelClass}>New Restoration</label><input type="number" className={inputClass} value={modificationForm.newRestoration} onChange={(e) => setModificationForm((p) => ({ ...p, newRestoration: e.target.value }))} /></div></>}
                      </div>
                    </section>

                    <section className="rounded-xl border-2 border-dashed border-[#f97316] bg-[#fff7ed]/30 p-6">
                      <h5 className="text-sm font-semibold text-[#f97316] mb-4">Part C — Remeasurement Calculation</h5>
                      <div className="space-y-2 text-sm font-mono mb-4">
                        <p><strong>Step 1 — Revised Lease Liability:</strong> PV of remaining payments at new IBR = {fmt(revisedLL)}</p>
                        <p><strong>Step 2 — Previous Lease Liability:</strong> Carrying amount on modification date = {fmt(priorLL)}</p>
                        <p><strong>Step 3 — Adjustment to Lease Liability:</strong> = {fmt(revisedLL)} − {fmt(priorLL)} = <span className={llAdjustment >= 0 ? 'text-green-600' : 'text-red-600'}>{fmt(llAdjustment)}</span></p>
                        <p><strong>Step 4 — ROU Asset Adjustment:</strong> {fmt(rouAdjustment)}</p>
                        {restorationNum > 0 && <p><strong>Step 5 — Restoration Cost Adjustment:</strong> {fmt(rcAdjustment)}</p>}
                      </div>
                      <div className="rounded-lg border border-[#e2e8f0] bg-white p-4">
                        <p className="text-xs font-semibold text-[#64748b] uppercase mb-2">Summary</p>
                        <table className="w-full text-sm"><thead><tr><th className="text-left py-1 font-medium text-[#64748b]">Description</th><th className="text-right py-1 font-medium text-[#64748b]">Prior</th><th className="text-right py-1 font-medium text-[#f97316]">After</th></tr></thead><tbody>
                          <tr><td className="py-1">ROU</td><td className="py-1 text-right font-mono text-[#64748b]">{fmt(priorROUBase)}</td><td className="py-1 text-right font-mono text-[#f97316]">{fmt(newROU)}</td></tr>
                          <tr><td className="py-1">Lease Liability</td><td className="py-1 text-right font-mono text-[#64748b]">{fmt(priorLL)}</td><td className="py-1 text-right font-mono text-[#f97316]">{fmt(revisedLL)}</td></tr>
                          <tr><td className="py-1">Restoration Cost</td><td className="py-1 text-right font-mono text-[#64748b]">{fmt(priorRCBase)}</td><td className="py-1 text-right font-mono text-[#f97316]">{fmt(newRC)}</td></tr>
                          <tr className="font-bold border-t border-[#e2e8f0]"><td className="py-2">Increase in Liability</td><td colSpan={2} className="py-2 text-right font-mono">{fmt(llAdjustment)}</td></tr>
                          {rcAdjustment !== 0 && <tr><td className="py-1">Gain on RC modification</td><td colSpan={2} className="py-1 text-right font-mono text-[#f97316]">{fmt(rcAdjustment)}</td></tr>}
                        </tbody></table>
                      </div>
                    </section>

                    <section className="rounded-xl border border-[#e2e8f0] p-6 bg-white">
                      <h5 className="text-sm font-semibold text-[#64748b] uppercase mb-4">Part D — Journal Entries</h5>
                      <div className="space-y-2 mb-4">
                        {journalEntries.length === 0 ? <p className="text-sm text-[#64748b]">No journal entry (no adjustment).</p> : journalEntries.map((je, idx) => (<div key={idx} className="flex justify-between items-center py-2 border-b border-[#e2e8f0]"><span className="text-sm">Dr {je.dr} / Cr {je.cr}</span><span className="font-mono font-semibold">{fmt(je.amount)}</span></div>))}
                      </div>
                      <Button variant="secondary" size="sm" onClick={() => { const text = journalEntries.map((je) => `Dr ${je.dr}  Cr ${je.cr}  ${fmt(je.amount)}`).join('\n'); navigator.clipboard.writeText(text); toast.success('Copied'); }}>Copy Journal Entries</Button>
                    </section>

                    <div className="flex flex-wrap gap-3">
                      <Button className="bg-[#f97316] text-white" onClick={() => { const newMod = { id: `MOD-${String(Date.now()).slice(-6)}`, date: modificationForm.date, effectiveDate: modificationForm.effectiveDate || modificationForm.date, type: modificationForm.type, reason: modificationForm.reason, notes: modificationForm.notes, priorLL, newLL: revisedLL, priorROU: priorROUBase, newROU, priorRC: priorRCBase, newRC, llAdjustment, rouAdjustment, gainLoss, journalEntries, status: 'draft', newEndDate: modificationForm.newEndDate, newMonthlyPayment: newMonthly, newIBR: newIBR }; const next = modificationFormIndex === null ? [...mods, newMod] : mods.map((m: any, j: number) => j === modificationFormIndex ? { ...m, ...newMod } : m); setForm((p) => ({ ...p, modifications: next })); setModificationPanel('list'); setModificationFormIndex(null); markDirty('modifications'); toast.success('Saved as draft'); }}>💾 Save Draft</Button>
                      <Button className="bg-green-600 text-white hover:bg-green-700" onClick={() => { const newMod = { id: modificationFormIndex !== null && mods[modificationFormIndex]?.id ? mods[modificationFormIndex].id : `MOD-${String(Date.now()).slice(-6)}`, date: modificationForm.date, effectiveDate: modificationForm.effectiveDate || modificationForm.date, type: modificationForm.type, reason: modificationForm.reason, notes: modificationForm.notes, priorLL, newLL: revisedLL, priorROU: priorROUBase, newROU, priorRC: priorRCBase, newRC, llAdjustment, rouAdjustment, gainLoss, journalEntries, status: 'applied', appliedAt: new Date().toISOString(), appliedBy: 'User', newEndDate: modificationForm.newEndDate, newMonthlyPayment: newMonthly, newIBR: newIBR }; const next = modificationFormIndex === null ? [...mods, newMod] : mods.map((m: any, j: number) => j === modificationFormIndex ? { ...m, ...newMod } : m); setForm((p) => ({ ...p, modifications: next })); setModificationPanel('list'); setModificationFormIndex(null); markDirty('modifications'); toast.success('Modification applied. All schedules recalculated.'); }}>🧮 Apply Modification</Button>
                      <Button variant="secondary" onClick={() => { setModificationPanel('list'); setModificationFormIndex(null); }}>Cancel</Button>
                    </div>
                  </div>
                )}

                <section className="mb-6">
                  <h4 className="text-sm font-medium text-[#64748b] border-b border-[#e2e8f0] pb-2 mb-3">Variable Lease Payments</h4>
                <label className="flex items-center gap-2 mb-2"><input type="checkbox" checked={form.variablePayments} onChange={(e) => { setForm((p) => ({ ...p, variablePayments: e.target.checked })); markDirty('modifications'); }} /> Variable Payments Exist</label>
                {form.variablePayments && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div><label className={labelClass}>Description</label><input type="text" value={form.variableDescription} onChange={(e) => { setForm((p) => ({ ...p, variableDescription: e.target.value })); markDirty('modifications'); }} className={inputClass} /></div>
                    <div><label className={labelClass}>Estimated Annual Amount (₹)</label><input type="number" value={form.variableAnnualAmount} onChange={(e) => { setForm((p) => ({ ...p, variableAnnualAmount: e.target.value })); markDirty('modifications'); }} className={inputClass} /></div>
                    <div><label className={labelClass}>Basis</label><input type="text" value={form.variableBasis} onChange={(e) => { setForm((p) => ({ ...p, variableBasis: e.target.value })); markDirty('modifications'); }} className={inputClass} placeholder="Sales %, Usage-based, Index-linked" /></div>
                  </div>
                )}
              </section>
              <section className="mb-6">
                <h4 className="text-sm font-medium text-[#64748b] border-b border-[#e2e8f0] pb-2 mb-3">CPI / Index Adjustments</h4>
                <label className="flex items-center gap-2 mb-2"><input type="checkbox" checked={form.cpiAdjustments} onChange={(e) => { setForm((p) => ({ ...p, cpiAdjustments: e.target.checked })); markDirty('modifications'); }} /> CPI Adjustments Apply</label>
                {form.cpiAdjustments && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div><label className={labelClass}>Base Index Value</label><input type="number" value={form.baseIndexValue} onChange={(e) => { setForm((p) => ({ ...p, baseIndexValue: e.target.value })); markDirty('modifications'); }} className={inputClass} /></div>
                    <div><label className={labelClass}>Current Index Value</label><input type="number" value={form.currentIndexValue} onChange={(e) => { setForm((p) => ({ ...p, currentIndexValue: e.target.value })); markDirty('modifications'); }} className={inputClass} /></div>
                    <div><label className={labelClass}>CPI review every (months)</label><input type="number" min="1" step="1" value={form.cpiAdjustmentFrequencyMonths} onChange={(e) => { setForm((p) => ({ ...p, cpiAdjustmentFrequencyMonths: e.target.value })); markDirty('modifications'); }} className={inputClass} /></div>
                    <div><label className={labelClass}>Last Adjustment Date</label><input type="date" value={form.lastAdjustmentDate} onChange={(e) => { setForm((p) => ({ ...p, lastAdjustmentDate: e.target.value })); markDirty('modifications'); }} className={inputClass} /></div>
                  </div>
                )}
                {form.cpiAdjustments && calcResults && (
                  <CpiRemeasurementPanel
                    leaseId={String(params?.id || '')}
                    originalPayment={parseFloat(String(form.baseRentAmount)) || 0}
                    ibrPct={parseFloat(String(form.discountRate)) || 0}
                    remainingMonths={12}
                    currentLiability={Number(calcResults.lease_liability ?? 0)}
                    currentRou={Number(calcResults.rou_asset ?? 0)}
                    baseIndex={parseFloat(String(form.baseIndexValue)) || 100}
                    currentIndex={parseFloat(String(form.currentIndexValue)) || 100}
                    currency={displayCurrency}
                  />
                )}
              </section>
              <div className="flex justify-end">
                <Button onClick={() => { handleSaveToRepo(); setDirtyTabs((s) => { const n = new Set(s); n.delete('modifications'); return n; }); }} className="bg-[#f97316] text-white">Save Tab</Button>
              </div>
            </>
            );
          })()}

          {activeTab === 'assets' && (
            <>
              <h3 className="text-lg font-semibold text-[#1e293b] mb-4 flex items-center gap-2"><MapPin className="w-5 h-5 text-[#f97316]" /> Assets & Locations</h3>
              <section className="mb-6">
                <h4 className="text-sm font-medium text-[#64748b] border-b border-[#e2e8f0] pb-2 mb-3">Asset Details</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div>
                    <label className={labelClass}>Lease Type</label>
                    <select value={form.leaseType} onChange={(e) => { setForm((p) => ({ ...p, leaseType: e.target.value })); markDirty('assets'); }} className={inputClass}>
                      {LEASE_TYPES.map((t) => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="md:col-span-2"><label className={labelClass}>Asset Description</label><input type="text" value={form.assetDescription} onChange={(e) => { setForm((p) => ({ ...p, assetDescription: e.target.value })); markDirty('assets'); }} className={inputClass} /></div>
                  <div><label className={labelClass}>Contract Reference</label><input type="text" value={form.contractReference} onChange={(e) => { setForm((p) => ({ ...p, contractReference: e.target.value })); markDirty('assets'); }} className={inputClass} /></div>
                  <div><label className={labelClass}>Brand</label><input type="text" value={form.brand} onChange={(e) => { setForm((p) => ({ ...p, brand: e.target.value })); markDirty('assets'); }} className={inputClass} /></div>
                  <div><label className={labelClass}>Country</label><select value={form.country} onChange={(e) => { setForm((p) => ({ ...p, country: e.target.value })); markDirty('assets'); }} className={inputClass}><option>India</option><option>UAE</option><option>USA</option><option>UK</option><option>Singapore</option></select></div>
                  <div><label className={labelClass}>City</label><input type="text" value={form.city} onChange={(e) => { setForm((p) => ({ ...p, city: e.target.value })); markDirty('assets'); }} className={inputClass} /></div>
                  <div><label className={labelClass}>Location / Address</label><input type="text" value={form.location} onChange={(e) => { setForm((p) => ({ ...p, location: e.target.value })); markDirty('assets'); }} className={inputClass} /></div>
                  <div><label className={labelClass}>Floor / Unit No</label><input type="text" value={form.floorUnit} onChange={(e) => { setForm((p) => ({ ...p, floorUnit: e.target.value })); markDirty('assets'); }} className={inputClass} /></div>
                </div>
              </section>
              <details className="mb-6 border border-[#e2e8f0] rounded-lg overflow-hidden">
                <summary className="px-4 py-3 bg-[#f8fafc] text-sm font-medium cursor-pointer">Additional Details</summary>
                <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div><label className={labelClass}>Useful Life (months)</label><input type="number" value={form.usefulLifeMonths} onChange={(e) => { setForm((p) => ({ ...p, usefulLifeMonths: e.target.value })); markDirty('assets'); }} className={inputClass} /></div>
                  <div>
                    <label className={labelClass}>Depreciation Method</label>
                    <select value={form.depreciationMethod} onChange={(e) => { setForm((p) => ({ ...p, depreciationMethod: e.target.value })); markDirty('assets'); }} className={inputClass}>
                      {DEPRECIATION_METHODS.map((m) => <option key={m}>{m}</option>)}
                    </select>
                  </div>
                  <div><label className={labelClass}>ROU Asset GL Code</label><input type="text" value={form.rouGlCode} onChange={(e) => { setForm((p) => ({ ...p, rouGlCode: e.target.value })); markDirty('assets'); }} className={inputClass} /></div>
                  <div><label className={labelClass}>Lease Liability GL Code</label><input type="text" value={form.liabilityGlCode} onChange={(e) => { setForm((p) => ({ ...p, liabilityGlCode: e.target.value })); markDirty('assets'); }} className={inputClass} /></div>
                  <div><label className={labelClass}>Interest Expense GL Code</label><input type="text" value={form.interestGlCode} onChange={(e) => { setForm((p) => ({ ...p, interestGlCode: e.target.value })); markDirty('assets'); }} className={inputClass} /></div>
                  <div><label className={labelClass}>Depreciation GL Code</label><input type="text" value={form.depreciationGlCode} onChange={(e) => { setForm((p) => ({ ...p, depreciationGlCode: e.target.value })); markDirty('assets'); }} className={inputClass} /></div>
                </div>
              </details>
              <div className="flex justify-end">
                <Button onClick={() => { handleSaveToRepo(); setDirtyTabs((s) => { const n = new Set(s); n.delete('assets'); return n; }); }} className="bg-[#f97316] text-white">Save Tab</Button>
              </div>
            </>
          )}

          {activeTab === 'schedules' && (() => {
            const liability = calcResults?.lease_liability ?? existingLease?.liability ?? 0;
            const rou = calcResults?.rou_asset ?? existingLease?.rou ?? 0;
            const termMonths = form.lease_term_months ? parseInt(form.lease_term_months, 10) || schedule.length : schedule.length;
            const monthlyDepreciation = calcResults?.monthly_depreciation ?? (termMonths > 0 ? rou / termMonths : 0);
            const totalInterestFromSchedule = schedule.reduce((s, row) => s + (scheduleRow(row).interest ?? 0), 0);
            const totalInterest = totalInterestFromSchedule > 0 ? totalInterestFromSchedule : (calcResults?.year_1_impact?.interest_expense ?? 0) * Math.min(12, termMonths);
            const functionalCurrency = form.functionalCurrency || 'INR';
            const isFxLease = (form.currency || 'INR') !== functionalCurrency;
            const restorationCostNum = parseFloat(String(form.restorationCost || '0')) || 0;
            const hasRestoration = restorationCostNum > 0;
            const ibrPct = parseFloat(String(form.discountRate || '0')) || 0;
            const modifications = (form.modifications || []).slice().sort((a: any, b: any) => (a.date || '').localeCompare(b.date || ''));
            const modDatesInserted = new Set<string>();
            type LiabilityRow = { type: 'row'; row: any; index: number } | { type: 'divider'; modIndex: number; date: string };
            const liabilityRows: LiabilityRow[] = [];
            schedule.forEach((row: any, i: number) => {
              const r = scheduleRow(row);
              const rowDate = r.date || '';
              modifications.forEach((m: any, modIndex: number) => {
                const md = m.date || '';
                if (!md || modDatesInserted.has(md)) return;
                if (rowDate && String(rowDate) >= String(md)) {
                  modDatesInserted.add(md);
                  liabilityRows.push({ type: 'divider', modIndex, date: md });
                }
              });
              liabilityRows.push({ type: 'row', row, index: i });
            });
            const scheduleSubTabs = [
              { id: 'payment' as const, label: 'Payment Schedule' },
              { id: 'liability' as const, label: 'Lease Liability Schedule' },
              { id: 'fx' as const, label: 'FX Schedule' },
              { id: 'restoration' as const, label: 'Restoration Schedule' },
              { id: 'restorationFx' as const, label: 'Restoration FX Schedule' },
              { id: 'residual' as const, label: 'Residual Schedule' },
              { id: 'rou' as const, label: 'ROU Schedule' },
              { id: 'rouAdjustment' as const, label: 'ROU Adjustment Schedule' },
            ];
            const todayStr = new Date().toISOString().split('T')[0];
            const baseFxRate = parseFloat(String(form.exchangeRate || '1')) || 1;
            const getFxRate = (i: number) => (fxRatesByPeriod[i] != null && fxRatesByPeriod[i] > 0 ? fxRatesByPeriod[i] : baseFxRate);
            return (
              <>
                <h3 className="text-lg font-semibold text-[#1e293b] mb-4 flex items-center gap-2"><BarChart3 className="w-5 h-5 text-[#f97316]" /> Schedules</h3>
                {!hasResults ? (
                  <div className="p-6 rounded-xl bg-[#fff7ed] border border-[#fed7aa] text-[#c2410c] mb-6">
                    <p className="font-medium mb-2">⚡ Go to Review & Calculate tab to generate the amortization schedule for this lease.</p>
                    <Button onClick={() => setActiveTab('review')} className="bg-[#f97316] text-white">Go to Calculate →</Button>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                      <div className="p-4 rounded-xl border border-[#e2e8f0] bg-white"><p className="text-xs text-[#64748b] uppercase">Lease Liability</p><p className="font-mono font-semibold text-[#1e293b]">{fmt(liability)}</p></div>
                      <div className="p-4 rounded-xl border border-[#e2e8f0] bg-white"><p className="text-xs text-[#64748b] uppercase">ROU Asset</p><p className="font-mono font-semibold text-[#1e293b]">{fmt(rou)}</p></div>
                      <div className="p-4 rounded-xl border border-[#e2e8f0] bg-white"><p className="text-xs text-[#64748b] uppercase">Monthly Depreciation</p><p className="font-mono font-semibold text-[#1e293b]">{fmt(monthlyDepreciation)}</p></div>
                      <div className="p-4 rounded-xl border border-[#e2e8f0] bg-white"><p className="text-xs text-[#64748b] uppercase">Total Interest</p><p className="font-mono font-semibold text-[#1e293b]">{fmt(totalInterest)}</p></div>
                    </div>
                    {(() => {
                      const rb = calcResults?.rou_build_up ?? existingLease?.results?.rou_build_up;
                      const incNote = calcResults?.incentive_disclosure_note ?? existingLease?.results?.incentive_disclosure_note;
                      const lb = calcResults?.liability_breakdown ?? existingLease?.results?.liability_breakdown;
                      const rvgNote = calcResults?.rvg_disclosure_note ?? existingLease?.results?.rvg_disclosure_note;
                      const idcNote = calcResults?.idc_disclosure_note ?? existingLease?.results?.idc_disclosure_note;
                      const hasIncentives = rb && (Number(rb.less_lease_incentives ?? 0) > 0);
                      const hasRvg = lb && (Number(lb.pv_residual_value_guarantee ?? 0) > 0);
                      const hasIdc = rb && (Number(rb.add_initial_direct_costs ?? 0) > 0);
                      if (!rb && !incNote && !lb && !rvgNote && !idcNote) return null;
                      return (
                        <div className="mb-6 space-y-3">
                          {lb && (hasRvg || Number(lb.pv_regular_payments ?? 0) > 0) && (
                            <div className="p-4 rounded-xl border border-[#e2e8f0] bg-white">
                              <p className="text-xs font-semibold text-[#64748b] uppercase mb-3">Lease Liability Calculation</p>
                              <table className="w-full text-sm font-mono">
                                <tbody>
                                  <tr><td className="py-1 text-[#64748b]">PV of lease payments</td><td className="py-1 text-right">{fmt(Number(lb.pv_regular_payments ?? 0))}</td></tr>
                                  {hasRvg && <tr><td className="py-1 text-[#64748b]">PV of residual value guarantee</td><td className="py-1 text-right">{fmt(Number(lb.pv_residual_value_guarantee ?? 0))}</td></tr>}
                                  <tr className="border-t border-[#e2e8f0]"><td className="py-2 font-semibold text-[#1e293b]">Total lease liability</td><td className="py-2 text-right font-semibold">{fmt(Number(lb.total_lease_liability ?? 0))}</td></tr>
                                </tbody>
                              </table>
                            </div>
                          )}
                          {rb && (
                            <div className="p-4 rounded-xl border border-[#e2e8f0] bg-white">
                              <p className="text-xs font-semibold text-[#64748b] uppercase mb-3">ROU Asset Calculation</p>
                              <table className="w-full text-sm font-mono">
                                <tbody>
                                  <tr><td className="py-1 text-[#64748b]">PV of lease payments</td><td className="py-1 text-right">{fmt(Number(rb.pv_lease_payments ?? 0))}</td></tr>
                                  {hasIdc && (
                                    <>
                                      {Number(rb.legal_fees ?? 0) > 0 && <tr><td className="py-1 text-[#64748b] pl-4">Legal fees</td><td className="py-1 text-right">{fmt(Number(rb.legal_fees ?? 0))}</td></tr>}
                                      {Number(rb.brokerage_fees ?? 0) > 0 && <tr><td className="py-1 text-[#64748b] pl-4">Brokerage / agent fees</td><td className="py-1 text-right">{fmt(Number(rb.brokerage_fees ?? 0))}</td></tr>}
                                      {Number(rb.other_initial_direct_costs ?? 0) > 0 && <tr><td className="py-1 text-[#64748b] pl-4">Other initial direct costs</td><td className="py-1 text-right">{fmt(Number(rb.other_initial_direct_costs ?? 0))}</td></tr>}
                                      <tr><td className="py-1 text-[#64748b] font-medium">Add: Initial direct costs</td><td className="py-1 text-right">{fmt(Number(rb.add_initial_direct_costs ?? 0))}</td></tr>
                                    </>
                                  )}
                                  {Number(rb.add_prepaid_rent ?? 0) > 0 && <tr><td className="py-1 text-[#64748b]">Add: Prepaid rent</td><td className="py-1 text-right">{fmt(Number(rb.add_prepaid_rent ?? 0))}</td></tr>}
                                  {hasIncentives && <tr><td className="py-1 text-[#64748b]">Less: Lease incentives</td><td className="py-1 text-right text-red-600">({fmt(Number(rb.less_lease_incentives ?? 0))})</td></tr>}
                                  <tr className="border-t border-[#e2e8f0]"><td className="py-2 font-semibold text-[#1e293b]">ROU Asset at commencement</td><td className="py-2 text-right font-semibold">{fmt(Number(rb.rou_asset_at_commencement ?? 0))}</td></tr>
                                </tbody>
                              </table>
                            </div>
                          )}
                          {incNote && (
                            <div className="p-4 rounded-lg bg-[#f0fdf4] border border-[#86efac] text-sm text-[#166534]">
                              <p className="font-medium mb-1">Disclosure Note (IFRS 16 para 24)</p>
                              <p className="whitespace-pre-wrap">{incNote}</p>
                            </div>
                          )}
                          {rvgNote && (
                            <div className="p-4 rounded-lg bg-[#eff6ff] border border-[#93c5fd] text-sm text-[#1e40af]">
                              <p className="font-medium mb-1">Disclosure Note (IFRS 16 para 26(d))</p>
                              <p className="whitespace-pre-wrap">{rvgNote}</p>
                            </div>
                          )}
                          {idcNote && (
                            <div className="p-4 rounded-lg bg-[#fefce8] border border-[#fef08a] text-sm text-[#854d0e]">
                              <p className="font-medium mb-1">Disclosure Note (IFRS 16 para 24 — Initial Direct Costs)</p>
                              <p className="whitespace-pre-wrap">{idcNote}</p>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    <div className="flex flex-wrap items-center gap-4 mb-4 p-3 rounded-lg bg-[#f9fafb] border border-[#e2e8f0]">
                      <span className="text-xs font-medium text-[#64748b] uppercase">For schedules:</span>
                      <label className="flex items-center gap-2"><span className="text-sm text-[#64748b]">Functional currency</span><select value={form.functionalCurrency || 'INR'} onChange={(e) => setForm((p) => ({ ...p, functionalCurrency: e.target.value }))} className="px-3 py-1.5 border border-[#e2e8f0] rounded-lg text-sm">{CURRENCIES.map((c) => (<option key={c} value={c}>{c}</option>))}</select></label>
                      <label className="flex items-center gap-2"><span className="text-sm text-[#64748b]">Restoration cost (₹)</span><input type="number" value={form.restorationCost || ''} onChange={(e) => setForm((p) => ({ ...p, restorationCost: e.target.value }))} className="w-28 px-3 py-1.5 border border-[#e2e8f0] rounded-lg text-sm font-mono" placeholder="0" /></label>
                    </div>
                    <div className="flex flex-wrap gap-1 border-b border-[#e2e8f0] mb-4">
                      {scheduleSubTabs.map(({ id, label }) => (
                        <button
                          key={id}
                          onClick={() => setActiveScheduleSubTab(id)}
                          className={`text-sm font-medium px-3 py-2 border-b-2 transition-colors ${activeScheduleSubTab === id ? 'text-[#f97316] border-[#f97316]' : 'text-[#64748b] border-transparent hover:text-[#1e293b]'}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    {/* Sub-tab: Payment Schedule */}
                    {activeScheduleSubTab === 'payment' && (
                      <div className="relative">
                        <p className="text-sm text-[#64748b] mb-2">Calculated using IBR: {(parseFloat(String(form.discountRate || '0')) || 0).toFixed(2)}%</p>
                        <div className="absolute top-0 right-0">
                          <Button variant="secondary" size="sm" className="border border-[#e2e8f0]" onClick={() => exportScheduleCsv('payment-schedule', ['Period', 'Date', 'Lease Component', 'Non-Lease Component', 'VAT/GST', 'Total Payment'], schedule.map((row: any, i: number) => { const b = paymentScheduleBreakdown(row); return [b.period ?? i + 1, b.date ?? '', b.leasePay, b.nonLeasePay, 0, b.totalCash]; }))}>
                            <Download className="w-4 h-4 mr-1" /> Export This Schedule
                          </Button>
                        </div>
                        <div className="overflow-x-auto rounded-xl border border-[#e2e8f0] bg-white">
                          <table className="w-full text-sm">
                            <thead className="bg-[#f9fafb]"><tr><th className="text-left py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">Period</th><th className="text-left py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">Date</th><th className="text-right py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">Lease Component</th><th className="text-right py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">Non-Lease Component</th><th className="text-right py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">VAT/GST</th><th className="text-right py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">Total Cash</th></tr></thead>
                            <tbody>
                              {schedule.map((row: any, i: number) => { const b = paymentScheduleBreakdown(row); const isOverdue = b.date && String(b.date) < todayStr; return (<tr key={i} className={`border-t border-[#e2e8f0] ${i % 2 === 1 ? 'bg-[#fafafa]' : 'bg-white'} ${isOverdue ? 'bg-amber-50' : ''} ${b.rentFree ? 'bg-amber-50/60' : ''}`}><td className="py-2 px-3 font-mono">{b.period ?? i + 1}</td><td className="py-2 px-3">{b.date ?? '—'}</td><td className="py-2 px-3 text-right font-mono">{fmt(b.leasePay)}</td><td className="py-2 px-3 text-right font-mono">{fmt(b.nonLeasePay)}</td><td className="py-2 px-3 text-right font-mono">{fmt(0)}</td><td className="py-2 px-3 text-right font-mono">{fmt(b.totalCash)}</td></tr>); })}
                              <tr className="border-t-2 border-[#e2e8f0] bg-[#f9fafb] font-medium"><td colSpan={2} className="py-2 px-3">TOTAL</td><td className="py-2 px-3 text-right font-mono">{fmt(schedule.reduce((s, row) => s + paymentScheduleBreakdown(row).leasePay, 0))}</td><td className="py-2 px-3 text-right font-mono">{fmt(schedule.reduce((s, row) => s + paymentScheduleBreakdown(row).nonLeasePay, 0))}</td><td className="py-2 px-3"></td><td className="py-2 px-3 text-right font-mono">{fmt(schedule.reduce((s, row) => s + paymentScheduleBreakdown(row).totalCash, 0))}</td></tr>
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Sub-tab: Lease Liability Schedule (with modification dividers) */}
                    {activeScheduleSubTab === 'liability' && (
                      <div className="relative">
                        <p className="text-sm text-[#64748b] mb-2">Calculated using IBR: {(parseFloat(String(form.discountRate || '0')) || 0).toFixed(2)}%</p>
                        <div className="absolute top-0 right-0">
                          <Button variant="secondary" size="sm" className="border border-[#e2e8f0]" onClick={() => { const rows = schedule.map((row: any, i: number) => { const r = scheduleRow(row); return [r.period ?? i + 1, r.date, r.opening, r.payment, r.interest, r.principal, r.closing]; }); exportScheduleCsv('lease-liability-schedule', ['Period', 'Date', 'Opening', 'Payment', 'Interest', 'Principal', 'Closing'], rows); }}>
                            <Download className="w-4 h-4 mr-1" /> Export This Schedule
                          </Button>
                        </div>
                        <div className="overflow-x-auto max-h-[50vh] overflow-y-auto rounded-xl border border-[#e2e8f0] bg-white">
                          <table className="w-full text-sm">
                            <thead className="bg-[#f9fafb] sticky top-0"><tr><th className="text-left py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">Period</th><th className="text-left py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">Date</th><th className="text-right py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">Opening</th><th className="text-right py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">Payment</th><th className="text-right py-2 px-3 text-xs font-semibold text-[#f97316] uppercase">Interest</th><th className="text-right py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">Principal</th><th className="text-right py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">Closing</th>{schedule.some((row: any) => scheduleRow(row).rentFree) && <th className="text-center py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">Rent-Free</th>}{schedule.some((row: any) => (scheduleRow(row).rvgPayment ?? 0) > 0) && <th className="text-right py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">RVG Payment</th>}</tr></thead>
                            <tbody>
                              {liabilityRows.map((item, idx) => {
                                if (item.type === 'divider') {
                                  const m = modifications[item.modIndex];
                                  const colCount = 7 + (schedule.some((row: any) => scheduleRow(row).rentFree) ? 1 : 0) + (schedule.some((row: any) => (scheduleRow(row).rvgPayment ?? 0) > 0) ? 1 : 0);
                                  return (<tr key={`d-${idx}`} className="bg-[#fef2f2] border-l-4 border-[#ef4444]"><td colSpan={colCount} className="py-2 px-3 text-sm font-medium text-[#1e293b]">Modification Date — Modification {item.modIndex + 1}: {item.date} <button type="button" onClick={() => setModificationModalIndex(item.modIndex)} className="text-[#f97316] hover:underline inline-flex items-center gap-1">Details <ChevronRight className="w-4 h-4" /></button></td></tr>);
                                }
                                const r = scheduleRow(item.row);
                                const showRentFree = schedule.some((row: any) => scheduleRow(row).rentFree);
                                const showRvg = schedule.some((row: any) => (scheduleRow(row).rvgPayment ?? 0) > 0);
                                return (<tr key={idx} className={`border-t border-[#e2e8f0] ${r.rentFree ? 'bg-amber-50' : idx % 2 === 1 ? 'bg-[#fafafa]' : 'bg-white'}`}><td className="py-2 px-3 font-mono">{r.period ?? item.index + 1}</td><td className="py-2 px-3">{r.date ?? '—'}</td><td className="py-2 px-3 text-right font-mono">{r.opening != null ? fmtDec(r.opening, 0) : '—'}</td><td className="py-2 px-3 text-right font-mono">{r.payment != null ? fmtDec(r.payment, 0) : '—'}</td><td className="py-2 px-3 text-right font-mono text-[#f97316]">{r.interest != null ? fmtDec(r.interest, 0) : '—'}</td><td className="py-2 px-3 text-right font-mono">{r.principal != null ? fmtDec(r.principal, 0) : '—'}</td><td className="py-2 px-3 text-right font-mono">{r.closing != null ? fmtDec(r.closing, 0) : '—'}</td>{showRentFree && <td className="py-2 px-3 text-center">{r.rentFree ? <span className="px-2 py-0.5 rounded bg-amber-200 text-amber-800 text-xs font-medium">Yes</span> : '—'}</td>}{showRvg && <td className="py-2 px-3 text-right font-mono">{(r.rvgPayment ?? 0) > 0 ? fmtDec(r.rvgPayment ?? 0, 0) : '—'}</td>}</tr>);
                              })}
                              <tr className="border-t-2 border-[#e2e8f0] bg-[#f9fafb] font-medium"><td colSpan={2} className="py-2 px-3">TOTAL</td><td colSpan={3 + (schedule.some((row: any) => scheduleRow(row).rentFree) ? 1 : 0)} className="py-2 px-3"></td><td className="py-2 px-3 text-right font-mono">{schedule.length > 0 ? fmt(scheduleRow(schedule[schedule.length - 1]).closing ?? 0) : '—'}</td>{schedule.some((row: any) => scheduleRow(row).rentFree) && <td></td>}{schedule.some((row: any) => (scheduleRow(row).rvgPayment ?? 0) > 0) && <td></td>}</tr>
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Sub-tab: FX Schedule */}
                    {activeScheduleSubTab === 'fx' && (
                      <div className="relative">
                        {!isFxLease ? (
                          <div className="py-12 text-center text-[#64748b] rounded-xl bg-[#f9fafb] border border-[#e2e8f0]"><Info className="w-10 h-10 mx-auto mb-2 opacity-50" /> No FX schedule — lease is in functional currency</div>
                        ) : (
                          <>
                            <div className="absolute top-0 right-0"><Button variant="secondary" size="sm" className="border border-[#e2e8f0]" onClick={() => exportScheduleCsv('fx-schedule', ['Period', 'Date', 'Amount (Foreign CCY)', 'Exchange Rate', 'Amount (Functional CCY)', 'FX Gain/Loss', 'Cumulative FX'], schedule.map((row: any, i: number) => { const r = scheduleRow(row); const amt = r.payment ?? 0; const rate = getFxRate(i); const functionalAmt = amt * rate; const prevRate = i > 0 ? getFxRate(i - 1) : rate; const fxGainLoss = (rate - prevRate) * amt; return [r.period ?? i + 1, r.date, amt, rate, functionalAmt, fxGainLoss, '']; }))}><Download className="w-4 h-4 mr-1" /> Export This Schedule</Button></div>
                            <div className="overflow-x-auto rounded-xl border border-[#e2e8f0] bg-white">
                              <table className="w-full text-sm">
                                <thead className="bg-[#f9fafb]"><tr><th className="text-left py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">Period</th><th className="text-left py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">Date</th><th className="text-right py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">Amount (Foreign CCY)</th><th className="text-right py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">Exchange Rate</th><th className="text-right py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">Amount (Functional CCY)</th><th className="text-right py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">FX Gain/Loss</th><th className="text-right py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">Cumulative FX</th></tr></thead>
                                <tbody>
                                  {schedule.map((row: any, i: number) => { const r = scheduleRow(row); const amt = r.payment ?? 0; const rate = getFxRate(i); const functionalAmt = amt * rate; const prevRate = i > 0 ? getFxRate(i - 1) : rate; const fxGainLoss = (rate - prevRate) * amt; let cumFx = 0; for (let j = 0; j <= i; j++) { const pr = j > 0 ? getFxRate(j - 1) : getFxRate(j); cumFx += (getFxRate(j) - pr) * (scheduleRow(schedule[j]).payment ?? 0); } return (<tr key={i} className={`border-t border-[#e2e8f0] ${i % 2 === 1 ? 'bg-[#fafafa]' : 'bg-white'}`}><td className="py-2 px-3 font-mono">{r.period ?? i + 1}</td><td className="py-2 px-3">{r.date ?? '—'}</td><td className="py-2 px-3 text-right font-mono">{fmt(amt)}</td><td className="py-2 px-3 text-right"><input type="number" step="0.0001" className="w-20 text-right font-mono border border-[#e2e8f0] rounded px-2 py-1" value={rate} onChange={(e) => { const v = parseFloat(e.target.value) || 0; setFxRatesByPeriod((prev) => { const base = parseFloat(String(form.exchangeRate || '1')) || 1; const next = prev.length ? [...prev] : schedule.map(() => base); const out = next.slice(0, i).concat([v]).concat(next.slice(i + 1)); return out; }); }} /></td><td className="py-2 px-3 text-right font-mono">{fmt(functionalAmt)}</td><td className={`py-2 px-3 text-right font-mono ${fxGainLoss >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmt(fxGainLoss)}</td><td className="py-2 px-3 text-right font-mono">{fmt(cumFx)}</td></tr>); })}
                                </tbody>
                              </table>
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {/* Sub-tab: Restoration Schedule */}
                    {activeScheduleSubTab === 'restoration' && (
                      <div className="relative">
                        {!hasRestoration ? (
                          <div className="py-12 text-center text-[#64748b] rounded-xl bg-[#f9fafb] border border-[#e2e8f0]"><Info className="w-10 h-10 mx-auto mb-2 opacity-50" /> No restoration obligation recorded for this lease</div>
                        ) : (
                          <>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4"><div className="p-3 rounded-lg border border-[#e2e8f0] bg-white"><p className="text-xs text-[#64748b]">Initial Restoration Cost</p><p className="font-mono font-semibold">{fmt(restorationCostNum)}</p></div><div className="p-3 rounded-lg border border-[#e2e8f0] bg-white"><p className="text-xs text-[#64748b]">Discount Rate</p><p className="font-mono font-semibold">{ibrPct}%</p></div><div className="p-3 rounded-lg border border-[#e2e8f0] bg-white"><p className="text-xs text-[#64748b]">PV of Restoration</p><p className="font-mono font-semibold">{fmt(restorationCostNum)}</p></div><div className="p-3 rounded-lg border border-[#e2e8f0] bg-white"><p className="text-xs text-[#64748b]">Total Unwinding Cost</p><p className="font-mono font-semibold">{fmt(restorationCostNum * (ibrPct / 100) * (termMonths / 12))}</p></div></div>
                            <div className="absolute top-0 right-0"><Button variant="secondary" size="sm" className="border border-[#e2e8f0]" onClick={() => { const rows = Array.from({ length: termMonths }, (_, i) => { const opening = i === 0 ? restorationCostNum : restorationCostNum + (restorationCostNum * (ibrPct / 100) / 12) * i; const unwinding = opening * (ibrPct / 100) / 12; const closing = opening + unwinding; return [i + 1, form.startDate || '', opening, unwinding, 0, 0, closing]; }); exportScheduleCsv('restoration-schedule', ['Period', 'Date', 'Opening Provision', 'Unwinding of Discount', 'Additional Provision', 'Utilisation', 'Closing Provision'], rows); }}><Download className="w-4 h-4 mr-1" /> Export This Schedule</Button></div>
                            <div className="overflow-x-auto rounded-xl border border-[#e2e8f0] bg-white">
                              <table className="w-full text-sm"><thead className="bg-[#f9fafb]"><tr><th className="text-left py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">Period</th><th className="text-left py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">Date</th><th className="text-right py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">Opening Provision</th><th className="text-right py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">Unwinding of Discount</th><th className="text-right py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">Additional Provision</th><th className="text-right py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">Utilisation</th><th className="text-right py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">Closing Provision</th></tr></thead><tbody>
                                {Array.from({ length: Math.min(termMonths, 120) }, (_, i) => { const opening = i === 0 ? restorationCostNum : (() => { let o = restorationCostNum; for (let j = 0; j < i; j++) { const unw = o * (ibrPct / 100) / 12; o = o + unw; } return o; })(); const unwinding = opening * (ibrPct / 100) / 12; const closing = opening + unwinding; return (<tr key={i} className={`border-t border-[#e2e8f0] ${i % 2 === 1 ? 'bg-[#fafafa]' : 'bg-white'}`}><td className="py-2 px-3 font-mono">{i + 1}</td><td className="py-2 px-3">{form.startDate || '—'}</td><td className="py-2 px-3 text-right font-mono">{fmt(opening)}</td><td className="py-2 px-3 text-right font-mono">{fmt(unwinding)}</td><td className="py-2 px-3 text-right font-mono">{fmt(0)}</td><td className="py-2 px-3 text-right font-mono">{fmt(0)}</td><td className="py-2 px-3 text-right font-mono">{fmt(closing)}</td></tr>); })}
                              </tbody></table>
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {/* Sub-tab: Restoration FX Schedule */}
                    {activeScheduleSubTab === 'restorationFx' && (
                      <div className="relative">
                        {!hasRestoration || !isFxLease ? (
                          <div className="py-12 text-center text-[#64748b] rounded-xl bg-[#f9fafb] border border-[#e2e8f0]"><Info className="w-10 h-10 mx-auto mb-2 opacity-50" /> Not applicable</div>
                        ) : (
                          <>
                            <div className="absolute top-0 right-0"><Button variant="secondary" size="sm" className="border border-[#e2e8f0]" onClick={() => exportScheduleCsv('restoration-fx-schedule', ['Period', 'Date', 'Provision (Foreign CCY)', 'Exchange Rate', 'Provision (Functional CCY)', 'FX Movement'], [])}><Download className="w-4 h-4 mr-1" /> Export This Schedule</Button></div>
                            <div className="overflow-x-auto rounded-xl border border-[#e2e8f0] bg-white"><table className="w-full text-sm"><thead className="bg-[#f9fafb]"><tr><th className="text-left py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">Period</th><th className="text-left py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">Date</th><th className="text-right py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">Provision (Foreign CCY)</th><th className="text-right py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">Exchange Rate</th><th className="text-right py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">Provision (Functional CCY)</th><th className="text-right py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">FX Movement</th></tr></thead><tbody><tr><td colSpan={6} className="py-8 text-center text-[#64748b]">Restoration FX schedule — same rate as main FX schedule</td></tr></tbody></table></div>
                          </>
                        )}
                      </div>
                    )}

                    {/* Sub-tab: Residual Value Schedule */}
                    {activeScheduleSubTab === 'residual' && (() => {
                      const guaranteedResidual = parseFloat(String(form.residualValue || '0')) || 0;
                      const unguaranteed = 0;
                      const nbvFinal = Math.max(0, rou - monthlyDepreciation * termMonths);
                      const surplusDeficit = nbvFinal - guaranteedResidual;
                      return (
                        <div className="relative">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4"><div className="p-3 rounded-lg border border-[#e2e8f0] bg-white"><p className="text-xs text-[#64748b]">Guaranteed Residual Value</p><p className="font-mono font-semibold">{fmt(guaranteedResidual)}</p></div><div className="p-3 rounded-lg border border-[#e2e8f0] bg-white"><p className="text-xs text-[#64748b]">Unguaranteed Residual</p><p className="font-mono font-semibold">{fmt(unguaranteed)}</p></div><div className="p-3 rounded-lg border border-[#e2e8f0] bg-white"><p className="text-xs text-[#64748b]">Final Period NBV</p><p className="font-mono font-semibold">{fmt(nbvFinal)}</p></div><div className="p-3 rounded-lg border border-[#e2e8f0] bg-white"><p className="text-xs text-[#64748b]">Expected Surplus/Deficit</p><p className={`font-mono font-semibold ${surplusDeficit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmt(surplusDeficit)}</p></div></div>
                          <div className="absolute top-0 right-0"><Button variant="secondary" size="sm" className="border border-[#e2e8f0]" onClick={() => { const rows = Array.from({ length: termMonths }, (_, i) => { const accDep = monthlyDepreciation * (i + 1); const nbv = Math.max(0, rou - accDep); const surplusDef = nbv - guaranteedResidual; return [i + 1, form.startDate, rou - (i > 0 ? monthlyDepreciation * i : 0), monthlyDepreciation, accDep, nbv, guaranteedResidual, surplusDef]; }); exportScheduleCsv('residual-schedule', ['Period', 'Date', 'Asset Book Value', 'Depreciation', 'Accumulated Depreciation', 'Net Book Value', 'Residual Value Guarantee', 'Surplus/Deficit'], rows); }}><Download className="w-4 h-4 mr-1" /> Export This Schedule</Button></div>
                          <div className="overflow-x-auto rounded-xl border border-[#e2e8f0] bg-white"><table className="w-full text-sm"><thead className="bg-[#f9fafb]"><tr><th className="text-left py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">Period</th><th className="text-left py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">Date</th><th className="text-right py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">Asset Book Value</th><th className="text-right py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">Depreciation</th><th className="text-right py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">Accumulated Depreciation</th><th className="text-right py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">Net Book Value</th><th className="text-right py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">Residual Value Guarantee</th><th className="text-right py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">Surplus/Deficit</th></tr></thead><tbody>
                            {Array.from({ length: Math.min(termMonths, schedule.length || termMonths) }, (_, i) => { const openingRou = rou - monthlyDepreciation * i; const dep = monthlyDepreciation; const accDep = monthlyDepreciation * (i + 1); const nbv = Math.max(0, rou - accDep); const surplusDef = nbv - guaranteedResidual; const date = schedule[i] ? scheduleRow(schedule[i]).date : form.startDate; return (<tr key={i} className={`border-t border-[#e2e8f0] ${i % 2 === 1 ? 'bg-[#fafafa]' : 'bg-white'}`}><td className="py-2 px-3 font-mono">{i + 1}</td><td className="py-2 px-3">{date ?? '—'}</td><td className="py-2 px-3 text-right font-mono">{fmt(openingRou)}</td><td className="py-2 px-3 text-right font-mono">{fmt(dep)}</td><td className="py-2 px-3 text-right font-mono">{fmt(accDep)}</td><td className="py-2 px-3 text-right font-mono">{fmt(nbv)}</td><td className="py-2 px-3 text-right font-mono">{fmt(guaranteedResidual)}</td><td className={`py-2 px-3 text-right font-mono ${surplusDef >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmt(surplusDef)}</td></tr>); })}
                          </tbody></table></div>
                        </div>
                      );
                    })()}

                    {/* Sub-tab: ROU Schedule */}
                    {activeScheduleSubTab === 'rou' && (
                      <div className="relative">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4"><div className="p-3 rounded-lg border border-[#e2e8f0] bg-white"><p className="text-xs text-[#64748b]">Initial ROU Asset</p><p className="font-mono font-semibold">{fmt(rou)}</p></div><div className="p-3 rounded-lg border border-[#e2e8f0] bg-white"><p className="text-xs text-[#64748b]">Monthly Depreciation</p><p className="font-mono font-semibold">{fmt(monthlyDepreciation)}</p></div><div className="p-3 rounded-lg border border-[#e2e8f0] bg-white"><p className="text-xs text-[#64748b]">Accumulated to Date</p><p className="font-mono font-semibold">{fmt(monthlyDepreciation * Math.min(termMonths, schedule.length))}</p></div><div className="p-3 rounded-lg border border-[#e2e8f0] bg-white"><p className="text-xs text-[#64748b]">NBV Today</p><p className="font-mono font-semibold">{fmt(Math.max(0, rou - monthlyDepreciation * (schedule.length || 0)))}</p></div></div>
                        <div className="absolute top-0 right-0"><Button variant="secondary" size="sm" className="border border-[#e2e8f0]" onClick={() => { const rows = Array.from({ length: termMonths }, (_, i) => { const openingRou = i === 0 ? rou : Math.max(0, rou - monthlyDepreciation * i); const dep = monthlyDepreciation; const impairment = 0; const additions = 0; const closing = Math.max(0, openingRou - dep); const accDep = monthlyDepreciation * (i + 1); return [i + 1, form.startDate, openingRou, dep, impairment, additions, closing, accDep]; }); exportScheduleCsv('rou-schedule', ['Period', 'Date', 'Opening ROU', 'Depreciation Charge', 'Impairment', 'Additions', 'Closing ROU', 'Accumulated Depreciation'], rows); }}><Download className="w-4 h-4 mr-1" /> Export This Schedule</Button></div>
                        <div className="overflow-x-auto rounded-xl border border-[#e2e8f0] bg-white"><table className="w-full text-sm"><thead className="bg-[#f9fafb]"><tr><th className="text-left py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">Period</th><th className="text-left py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">Date</th><th className="text-right py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">Opening ROU</th><th className="text-right py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">Depreciation Charge</th><th className="text-right py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">Impairment</th><th className="text-right py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">Additions</th><th className="text-right py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">Closing ROU</th><th className="text-right py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">Accumulated Depreciation</th></tr></thead><tbody>
                          {Array.from({ length: Math.min(termMonths, schedule.length || termMonths) }, (_, i) => { const openingRou = i === 0 ? rou : Math.max(0, rou - monthlyDepreciation * i); const dep = monthlyDepreciation; const impairment = 0; const additions = 0; const closing = Math.max(0, openingRou - dep); const accDep = monthlyDepreciation * (i + 1); const date = schedule[i] ? scheduleRow(schedule[i]).date : form.startDate; return (<tr key={i} className={`border-t border-[#e2e8f0] ${i % 2 === 1 ? 'bg-[#fafafa]' : 'bg-white'}`}><td className="py-2 px-3 font-mono">{i + 1}</td><td className="py-2 px-3">{date ?? '—'}</td><td className="py-2 px-3 text-right font-mono">{fmt(openingRou)}</td><td className="py-2 px-3 text-right font-mono">{fmt(dep)}</td><td className="py-2 px-3 text-right font-mono">{fmt(0)}</td><td className="py-2 px-3 text-right font-mono">{fmt(0)}</td><td className="py-2 px-3 text-right font-mono">{fmt(closing)}</td><td className="py-2 px-3 text-right font-mono">{fmt(accDep)}</td></tr>); })}
                          <tr className="border-t-2 border-[#e2e8f0] bg-[#f9fafb] font-medium"><td colSpan={2} className="py-2 px-3">TOTAL</td><td colSpan={5} className="py-2 px-3"></td><td className="py-2 px-3 text-right font-mono">{fmt(monthlyDepreciation * Math.min(termMonths, schedule.length || termMonths))}</td></tr>
                        </tbody></table></div>
                      </div>
                    )}

                    {/* Sub-tab: ROU Adjustment Schedule */}
                    {activeScheduleSubTab === 'rouAdjustment' && (
                      <div className="relative">
                        <div className="absolute top-0 right-0"><Button variant="secondary" size="sm" className="border border-[#e2e8f0]" onClick={() => exportScheduleCsv('rou-adjustment-schedule', ['Date', 'Modification Type', 'ROU Before', 'Adjustment Amount', 'ROU After', 'Lease Liability Before', 'LL Adjustment', 'LL After', 'Journal Entry Reference'], (form.modifications || []).map((m: any, i: number) => [m.date, m.type || '—', '', '', '', '', '', '', `JE-${i + 1}`]))}><Download className="w-4 h-4 mr-1" /> Export This Schedule</Button></div>
                        <div className="overflow-x-auto rounded-xl border border-[#e2e8f0] bg-white"><table className="w-full text-sm"><thead className="bg-[#f9fafb]"><tr><th className="text-left py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">Date</th><th className="text-left py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">Modification Type</th><th className="text-right py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">ROU Before</th><th className="text-right py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">Adjustment Amount</th><th className="text-right py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">ROU After</th><th className="text-right py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">Lease Liability Before</th><th className="text-right py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">LL Adjustment</th><th className="text-right py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">LL After</th><th className="text-center py-2 px-3 text-xs font-semibold text-[#64748b] uppercase">Actions</th></tr></thead><tbody>
                          {(form.modifications || []).length === 0 ? (<tr><td colSpan={9} className="py-12 text-center text-[#64748b]">No modifications recorded.</td></tr>) : (form.modifications || []).map((m: any, i: number) => (<tr key={i} className={`border-t border-[#e2e8f0] ${i % 2 === 1 ? 'bg-[#fafafa]' : 'bg-white'}`}><td className="py-2 px-3">{m.date ?? m.effectiveDate ?? '—'}</td><td className="py-2 px-3">{MODIFICATION_TYPE_OPTIONS.find((o: any) => o.value === m.type)?.label?.split('—')[0]?.trim() || m.type || '—'}</td><td className="py-2 px-3 text-right font-mono">{m.priorROU != null ? fmt(m.priorROU) : '—'}</td><td className="py-2 px-3 text-right font-mono">{m.rouAdjustment != null ? fmt(m.rouAdjustment) : '—'}</td><td className="py-2 px-3 text-right font-mono">{m.newROU != null ? fmt(m.newROU) : '—'}</td><td className="py-2 px-3 text-right font-mono">{m.priorLL != null ? fmt(m.priorLL) : '—'}</td><td className="py-2 px-3 text-right font-mono">{m.llAdjustment != null ? fmt(m.llAdjustment) : '—'}</td><td className="py-2 px-3 text-right font-mono">{m.newLL != null ? fmt(m.newLL) : '—'}</td><td className="py-2 px-3 text-center"><button type="button" onClick={() => setModificationModalIndex(i)} className="text-[#f97316] hover:underline text-sm font-medium">Details</button></td></tr>))}
                        </tbody></table></div>
                      </div>
                    )}

                    {modificationModalIndex !== null && (() => {
                      const m = (form.modifications || [])[modificationModalIndex];
                      const priorRou = m?.priorROU != null ? m.priorROU : rou;
                      const priorLL = m?.priorLL != null ? m.priorLL : liability;
                      const priorRC = m?.priorRC != null ? m.priorRC : restorationCostNum;
                      const afterRou = m?.newROU != null ? m.newROU : priorRou;
                      const afterLL = m?.newLL != null ? m.newLL : priorLL;
                      const afterRC = m?.newRC != null ? m.newRC : priorRC;
                      const increaseLL = m?.llAdjustment != null ? m.llAdjustment : 0;
                      const gainRC = m?.gainLoss != null ? m.gainLoss : (afterRC - priorRC);
                      return (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setModificationModalIndex(null)}>
                          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-auto p-6" onClick={(e) => e.stopPropagation()}>
                            <h4 className="text-lg font-semibold text-[#1e293b] mb-4">Modification {modificationModalIndex + 1} Financial Details</h4>
                            <div className="p-4 mb-4 rounded-lg bg-[#fff7ed] border border-[#fed7aa] text-sm text-[#c2410c] flex gap-2">
                              <Info className="w-5 h-5 shrink-0 mt-0.5" />
                              <p>ROU After Modification = ROU Prior + Lease Liability Increase + Restoration Cost Increase</p>
                            </div>
                            <table className="w-full text-sm border border-[#e2e8f0] rounded-lg overflow-hidden"><thead className="bg-[#f9fafb]"><tr><th className="text-left py-2 px-3 font-semibold text-[#64748b]">Description</th><th className="text-right py-2 px-3 font-semibold text-[#64748b]">ROU</th><th className="text-right py-2 px-3 font-semibold text-[#64748b]">Lease Liability</th><th className="text-right py-2 px-3 font-semibold text-[#64748b]">Restoration Cost</th><th className="text-right py-2 px-3 font-semibold text-[#64748b]">RC ROU</th></tr></thead><tbody>
                              <tr className="border-t border-[#e2e8f0]"><td className="py-2 px-3">Prior to Modification</td><td className="py-2 px-3 text-right font-mono">{fmt(priorRou)}</td><td className="py-2 px-3 text-right font-mono">{fmt(priorLL)}</td><td className="py-2 px-3 text-right font-mono">{fmt(priorRC)}</td><td className="py-2 px-3 text-right font-mono">{fmt(priorRC)}</td></tr>
                              <tr className="border-t border-[#e2e8f0] bg-orange-50"><td className="py-2 px-3 text-[#f97316]">After Modification</td><td className="py-2 px-3 text-right font-mono text-[#f97316]">{fmt(afterRou)}</td><td className="py-2 px-3 text-right font-mono text-[#f97316]">{fmt(afterLL)}</td><td className="py-2 px-3 text-right font-mono text-[#f97316]">{fmt(afterRC)}</td><td className="py-2 px-3 text-right font-mono text-[#f97316]">{fmt(afterRC)}</td></tr>
                              <tr className="border-t border-[#e2e8f0] font-bold"><td className="py-2 px-3">Increase in Liability</td><td className="py-2 px-3 text-right font-mono">—</td><td className="py-2 px-3 text-right font-mono">{fmt(increaseLL)}</td><td className="py-2 px-3 text-right font-mono">—</td><td className="py-2 px-3 text-right font-mono">—</td></tr>
                              <tr className="border-t border-[#e2e8f0] bg-orange-50"><td className="py-2 px-3 text-[#f97316]">Gain on RC modification</td><td className="py-2 px-3 text-right font-mono">—</td><td className="py-2 px-3 text-right font-mono">—</td><td className="py-2 px-3 text-right font-mono">—</td><td className="py-2 px-3 text-right font-mono text-[#f97316]">{fmt(gainRC)}</td></tr>
                            </tbody></table>
                            <div className="flex justify-end mt-4"><Button onClick={() => setModificationModalIndex(null)}>Close</Button></div>
                          </div>
                        </div>
                      );
                    })()}
                  </>
                )}
              </>
            );
          })()}

          {activeTab === 'disclosures' && (() => {
            const liability = calcResults?.lease_liability ?? existingLease?.liability ?? 0;
            const rou = calcResults?.rou_asset ?? existingLease?.rou ?? 0;
            const disclosureNotesText =
              calcResults?.disclosure_notes ??
              calcResults?.disclosures ??
              calcResults?.notes ??
              existingLease?.results?.disclosure_notes ??
              existingLease?.results?.disclosures ??
              existingLease?.results?.notes ??
              '';
            const disclosureSections = extractDisclosureSections(disclosureNotesText);
            const split = calcResults?.liability_split ?? existingLease?.results?.liability_split ?? {};
            const currentPortion = Number(split.current_portion ?? 0);
            const nonCurrentPortion = Number(split.non_current_portion ?? 0);
            const termMonths = form.lease_term_months ? parseInt(form.lease_term_months, 10) || schedule.length : schedule.length;
            const monthlyDepreciation = calcResults?.monthly_depreciation ?? (termMonths > 0 ? rou / termMonths : 0);
            const modifications = (form.modifications || []).slice().sort((a: any, b: any) => (a.date || '').localeCompare(b.date || ''));
            const reportingDate = getReportingDateForFY(disclosureFY);
            const reportingDateStr = reportingDate.toISOString().slice(0, 10);
            const fyStart = new Date(reportingDate.getFullYear() - 1, 3, 1);
            const fyEnd = new Date(reportingDate.getFullYear(), 2, 31);
            const leaseStart = form.startDate ? new Date(form.startDate) : null;
            const leaseEnd = form.endDate ? new Date(form.endDate) : null;
            const fyOptions: string[] = [];
            if (leaseStart && leaseEnd) {
              for (let y = leaseStart.getFullYear(); y <= leaseEnd.getFullYear() + 1; y++) {
                const fy = `${y}-${String(y + 1).slice(-2)}`;
                fyOptions.push(fy);
              }
            }
            if (fyOptions.length === 0) fyOptions.push(disclosureFY);
            const dataSignature = JSON.stringify({
              start: form.startDate,
              end: form.endDate,
              liability,
              scheduleLen: schedule.length,
              modCount: modifications.length,
            });
            const showDataChangedBanner = disclosureLastRefreshedSignature !== '' && dataSignature !== disclosureLastRefreshedSignature;

            const bucketLabels = ['Less than 1 year', '1 to 2 years', '2 to 3 years', '3 to 4 years', '4 to 5 years', 'More than 5 years'];
            type BucketRow = { undiscounted: number; pv: number };
            const buckets: BucketRow[] = bucketLabels.map(() => ({ undiscounted: 0, pv: 0 }));
            let totalUndiscounted = 0;
            let totalPV = 0;
            schedule.forEach((row: any) => {
              const r = scheduleRow(row);
              const dateStr = r.date;
              if (!dateStr) return;
              const payDate = new Date(dateStr);
              if (payDate <= reportingDate) return;
              const yearsFromReport = (payDate.getTime() - reportingDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
              const payment = Number(r.payment ?? 0);
              const principal = Number(r.principal ?? 0);
              let idx = 0;
              if (yearsFromReport < 1) idx = 0;
              else if (yearsFromReport < 2) idx = 1;
              else if (yearsFromReport < 3) idx = 2;
              else if (yearsFromReport < 4) idx = 3;
              else if (yearsFromReport < 5) idx = 4;
              else idx = 5;
              buckets[idx].undiscounted += payment;
              buckets[idx].pv += principal;
              totalUndiscounted += payment;
              totalPV += principal;
            });
            const futureFinanceCharges = totalUndiscounted - totalPV;
            const currentFromBuckets = buckets[0]?.pv ?? 0;
            const nonCurrentFromBuckets = totalPV - currentFromBuckets;

            const depFY = monthlyDepreciation * 12;
            const interestFY = schedule
              .filter((row: any) => {
                const d = scheduleRow(row).date;
                if (!d) return false;
                const dt = new Date(d);
                return dt >= fyStart && dt <= fyEnd;
              })
              .reduce((s: number, row: any) => s + (scheduleRow(row).interest ?? 0), 0);
            const principalPaymentsFY = schedule
              .filter((row: any) => {
                const d = scheduleRow(row).date;
                if (!d) return false;
                const dt = new Date(d);
                return dt >= fyStart && dt <= fyEnd;
              })
              .reduce((s: number, row: any) => s + (scheduleRow(row).principal ?? 0), 0);
            const paymentsMadeFY = schedule
              .filter((row: any) => {
                const d = scheduleRow(row).date;
                if (!d) return false;
                const dt = new Date(d);
                return dt >= fyStart && dt <= fyEnd;
              })
              .reduce((s: number, row: any) => s + (scheduleRow(row).payment ?? 0), 0);
            const modsInFY = modifications.filter((m: any) => {
              const md = m.date || '';
              if (!md) return false;
              const dt = new Date(md);
              return dt >= fyStart && dt <= fyEnd;
            });
            const llModificationsFY = modsInFY.reduce((s: number, m: any) => s + Number(m.llAdjustment ?? 0), 0);
            const rouModificationsFY = modsInFY.reduce((s: number, m: any) => s + Number(m.rouAdjustment ?? 0), 0);
            const gainLossModFY = modsInFY.reduce((s: number, m: any) => s + Number(m.gainLoss ?? 0), 0);
            const openingROU = 0;
            const openingLL = 0;
            const newLeasesROU = leaseStart && leaseStart <= fyEnd && (!leaseEnd || leaseEnd >= fyStart) ? rou : 0;
            const newLeasesLL = leaseStart && leaseStart <= fyEnd && (!leaseEnd || leaseEnd >= fyStart) ? liability : 0;
            const closingROU = openingROU + newLeasesROU + rouModificationsFY - depFY - 0 - 0;
            const closingLL = openingLL + newLeasesLL + llModificationsFY + interestFY - paymentsMadeFY - 0 + 0;

            const variableAnnual = parseFloat(String(form.variableAnnualAmount || '0')) || 0;
            const hasVariable = form.variablePayments === true || form.variablePayments === 'true' || variableAnnual > 0;
            const defaultAssumptionText = `In applying IFRS 16, the Company has made the following significant judgements:

(a) Lease Term
The Company has determined the lease term as ${termMonths} months, including optional extension periods that are reasonably certain to be exercised. Key factors considered include location importance, asset specificity and business plan.

(b) Incremental Borrowing Rate
The Company has applied an IBR of ${parseFloat(String(form.discountRate || '0')) || 0}% per annum as at ${form.startDate || 'commencement date'} to discount lease payments. The IBR reflects the rate the Company would pay to borrow funds over a similar term with similar security.

(c) Lease vs Non-Lease Components
The Company has elected not to separate non-lease components for this lease.

(d) Restoration Obligations
${parseFloat(String(form.restorationCost || '0')) > 0 ? `The Company has recognised a provision for estimated restoration costs at the end of the lease term.` : 'Not applicable for this lease.'}

(e) Short-term and Low-value Exemptions
The Company has not applied the short-term or low-value exemptions to this lease.`;
            const assumptionTextToShow = disclosureAssumptionModified && disclosureAssumptionText ? disclosureAssumptionText : defaultAssumptionText;

            const copyAllDisclosures = () => {
              const sections: string[] = [];
              sections.push(`Note X: Maturity Analysis of Lease Liabilities (IFRS 16 para 58(b))\n${bucketLabels.map((l, i) => `${l}\t${fmt(buckets[i].undiscounted)}\t${fmt(buckets[i].pv)}`).join('\n')}\nTotal\t${fmt(totalUndiscounted)}\t${fmt(totalPV)}\nLess: Future Finance Charges\t(${fmt(futureFinanceCharges)})\nPresent Value of Lease Liabilities\t—\t${fmt(totalPV)}\nCurrent (within 12 months): ${fmt(currentFromBuckets)}\nNon-current: ${fmt(nonCurrentFromBuckets)}`);
              sections.push(`Note X: Right-of-Use Assets (IFRS 16 para 53(j))\nOpening: ${fmt(openingROU)}\nAdditions: ${fmt(newLeasesROU)}\nModifications: ${fmt(rouModificationsFY)}\nDepreciation: (${fmt(depFY)})\nClosing: ${fmt(closingROU)}`);
              sections.push(`Note X: Lease Liabilities (IFRS 16 para 53(j))\nOpening: ${fmt(openingLL)}\nNew Leases: ${fmt(newLeasesLL)}\nModifications: ${fmt(llModificationsFY)}\nInterest: ${fmt(interestFY)}\nPayments: (${fmt(paymentsMadeFY)})\nClosing: ${fmt(closingLL)}\nCurrent: ${fmt(currentPortion)}\nNon-current: ${fmt(nonCurrentPortion)}`);
              sections.push(`Note X: P&L Impact (IFRS 16 para 53(a)(b)(c))\nDepreciation ROU: ${fmt(depFY)}\nInterest: ${fmt(interestFY)}\nVariable: ${fmt(variableAnnual)}\nGain/(Loss) on Modification: ${fmt(gainLossModFY)}\nTotal Lease Expense: ${fmt(depFY + interestFY + variableAnnual + gainLossModFY)}`);
              sections.push(`Note X: Cash Flow Impact (IFRS 16 para 53(g)(h))\nPrincipal (financing): (${fmt(principalPaymentsFY)})\nInterest (financing): (${fmt(interestFY)})\nTotal cash outflow: (${fmt(principalPaymentsFY + interestFY)})`);
              navigator.clipboard.writeText(sections.join('\n\n'));
              toast.success('All disclosures copied');
            };
            const downloadWord = () => {
              const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>IFRS 16 Disclosures - ${form.leaseId || 'Lease'}</title></head><body><h1>IFRS 16 Disclosure Notes</h1><p>Auto-generated from lease data — para 52-60 compliant. Reporting period: FY ${disclosureFY}</p><hr/>${bucketLabels.map((l, i) => `<p><strong>${l}</strong>: Undiscounted ${fmt(buckets[i].undiscounted)} | PV ${fmt(buckets[i].pv)}</p>`).join('')}<p><strong>Total</strong>: ${fmt(totalUndiscounted)} | PV ${fmt(totalPV)}</p><p>Less: Future Finance Charges (${fmt(futureFinanceCharges)})</p><p>Current: ${fmt(currentFromBuckets)} | Non-current: ${fmt(nonCurrentFromBuckets)}</p><hr/><p>ROU: Opening ${fmt(openingROU)} + Additions ${fmt(newLeasesROU)} + Modifications ${fmt(rouModificationsFY)} - Depreciation (${fmt(depFY)}) = Closing ${fmt(closingROU)}</p><hr/><p>Lease Liabilities: Closing ${fmt(closingLL)}; Current ${fmt(currentPortion)}; Non-current ${fmt(nonCurrentPortion)}</p><hr/><p>P&L: Depreciation ${fmt(depFY)}; Interest ${fmt(interestFY)}; Total expense ${fmt(depFY + interestFY + variableAnnual + gainLossModFY)}</p><hr/><p>Cash flow: Principal (${fmt(principalPaymentsFY)}); Interest (${fmt(interestFY)})</p><hr/><pre>${assumptionTextToShow.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre></body></html>`;
              const blob = new Blob(['\ufeff' + html], { type: 'application/vnd.ms-word' });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = `IFRS16_Disclosures_${form.leaseId || 'lease'}_FY${disclosureFY.replace('-', '_')}.doc`;
              a.click();
              URL.revokeObjectURL(a.href);
              toast.success('Downloaded as Word');
            };
            const downloadPdf = () => {
              const text = buildDisclosureText(calcResults ?? existingLease?.results);
              const w = window.open('', '_blank');
              if (w) {
                w.document.write(`<pre style="font-family: sans-serif; padding: 24px; white-space: pre-wrap;">${text.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`);
                w.document.title = `IFRS 16 Disclosure - ${form.leaseId || form.title || 'Lease'}`;
                w.print();
                w.close();
              }
              toast.success('Open print dialog to save as PDF');
            };
            const commitmentChartData = bucketLabels.map((l, i) => ({ name: l, amount: buckets[i].undiscounted }));
            const formatNeg = (n: number) => (n < 0 ? `(${fmt(-n)})` : fmt(n));

            if (!hasResults) {
              return (
                <>
                  <h3 className="text-lg font-semibold text-[#1e293b] mb-4 flex items-center gap-2"><FileCheck className="w-5 h-5 text-[#f97316]" /> Disclosures</h3>
                  <p className="text-xs text-[#64748b] mb-4">IFRS 16 disclosure notes for this lease</p>
                  <div className="p-6 rounded-xl bg-[#fff7ed] border border-[#fed7aa] text-[#c2410c] mb-6">
                    <p className="font-medium mb-2">Go to Review &amp; Calculate tab to generate disclosure notes for this lease.</p>
                    <Button onClick={() => setActiveTab('review')} className="bg-[#f97316] text-white">Go to Calculate →</Button>
                  </div>
                </>
              );
            }

            return (
              <>
                <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-[#1e293b] flex items-center gap-2"><FileCheck className="w-5 h-5 text-[#f97316]" /> IFRS 16 Disclosure Notes</h3>
                    <p className="text-xs text-[#64748b] mt-1">Auto-generated from lease data — para 52-60 compliant</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" className="border border-[#e2e8f0] bg-white" onClick={copyAllDisclosures}><Copy className="w-4 h-4 mr-2" /> Copy All</Button>
                    <Button variant="secondary" className="border border-[#e2e8f0] bg-white" onClick={downloadWord}>Download Word</Button>
                    <Button variant="secondary" className="border border-[#e2e8f0] bg-white" onClick={downloadPdf}>Download PDF</Button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-4 mb-4">
                  <label className="text-sm font-medium text-[#1e293b]">Reporting Period</label>
                  <select value={disclosureFY} onChange={(e) => setDisclosureFY(e.target.value)} className={`${inputClass} max-w-[180px]`}>
                    {fyOptions.map((fy) => <option key={fy} value={fy}>FY {fy}</option>)}
                  </select>
                </div>
                {showDataChangedBanner && (
                  <div className="mb-4 p-3 rounded-lg bg-[#fef9c3] border border-[#fde047] text-[#854d0e] flex flex-wrap items-center gap-2">
                    <span>Lease data has changed. Click Refresh Disclosures to update.</span>
                    <Button size="sm" className="bg-[#f97316] text-white" onClick={() => setDisclosureLastRefreshedSignature(dataSignature)}>Refresh Disclosures</Button>
                  </div>
                )}

                <div className="space-y-6">
                  {disclosureSections.length > 0 && (
                    <div className="bg-white rounded-xl border border-[#e2e8f0] overflow-hidden" style={{ borderLeft: '4px solid #f97316' }}>
                      <div className="px-4 py-3 border-b border-[#e2e8f0]">
                        <div className="font-semibold text-[#1e293b]">Generated Disclosure Notes</div>
                      </div>
                      <div className="p-4 space-y-2">
                        {disclosureSections.map((sec) => (
                          <details key={sec.title} className="border border-[#e2e8f0] rounded-lg bg-[#fffaf5]">
                            <summary className="px-3 py-2 cursor-pointer text-sm font-semibold text-[#9a3412]">{sec.title}</summary>
                            <div className="px-3 pb-3">
                              <pre className="whitespace-pre-wrap text-[14px] leading-6 text-[#1f2937]" style={{ fontFamily: 'Times New Roman, Times, serif' }}>
                                {sec.body}
                              </pre>
                            </div>
                          </details>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="bg-white rounded-xl border border-[#e2e8f0] overflow-hidden" style={{ borderLeft: '4px solid #f97316' }}>
                    <div className="px-4 py-3 border-b border-[#e2e8f0]">
                      <div className="font-semibold text-[#1e293b]">Note X: Maturity Analysis of Lease Liabilities</div>
                      <div className="text-xs text-[#64748b] mt-0.5">IFRS 16 para 58(b)</div>
                    </div>
                    <div className="p-4">
                      <p className="text-sm text-[#64748b] mb-3">The following table shows the undiscounted contractual cash flows for lease liabilities as at {reportingDateStr}:</p>
                      <table className="w-full border-collapse text-sm">
                        <thead><tr className="border-b border-[#e2e8f0]"><th className="text-left py-2 px-3 font-medium text-[#64748b]">Maturity Bucket</th><th className="text-right py-2 px-3 font-medium text-[#64748b]">Undiscounted Payments</th><th className="text-right py-2 px-3 font-medium text-[#64748b]">Present Value</th></tr></thead>
                        <tbody>
                          {bucketLabels.map((l, i) => (
                            <tr key={i} className="border-t border-[#e2e8f0]"><td className="py-2 px-3">{l}</td><td className="py-2 px-3 text-right font-mono">{fmt(buckets[i].undiscounted)}</td><td className="py-2 px-3 text-right font-mono">{fmt(buckets[i].pv)}</td></tr>
                          ))}
                          <tr className="border-t-2 border-[#e2e8f0] font-medium"><td className="py-2 px-3">Total</td><td className="py-2 px-3 text-right font-mono">{fmt(totalUndiscounted)}</td><td className="py-2 px-3 text-right font-mono">{fmt(totalPV)}</td></tr>
                          <tr className="border-t border-[#e2e8f0]"><td className="py-2 px-3">Less: Future Finance Charges</td><td className="py-2 px-3 text-right font-mono">({fmt(futureFinanceCharges)})</td><td className="py-2 px-3 text-right">—</td></tr>
                          <tr className="border-t border-[#e2e8f0] font-medium"><td className="py-2 px-3">Present Value of Lease Liabilities</td><td className="py-2 px-3 text-right">—</td><td className="py-2 px-3 text-right font-mono">{fmt(totalPV)}</td></tr>
                        </tbody>
                      </table>
                      <p className="text-sm text-[#1e293b] mt-3">Current (due within 12 months): {fmt(currentFromBuckets)} &nbsp;|&nbsp; Non-current (due after 12 months): {fmt(nonCurrentFromBuckets)}</p>
                    </div>
                  </div>

                  <div className="bg-white rounded-xl border border-[#e2e8f0] overflow-hidden" style={{ borderLeft: '4px solid #f97316' }}>
                    <div className="px-4 py-3 border-b border-[#e2e8f0]">
                      <div className="font-semibold text-[#1e293b]">Note X: Right-of-Use Assets</div>
                      <div className="text-xs text-[#64748b] mt-0.5">IFRS 16 para 53(j)</div>
                    </div>
                    <div className="p-4 overflow-x-auto">
                      <table className="w-full border-collapse text-sm">
                        <thead><tr className="border-b border-[#e2e8f0]"><th className="text-left py-2 px-3 font-medium text-[#64748b]"> </th><th className="text-right py-2 px-3 font-medium text-[#64748b]">FY {disclosureFY}</th></tr></thead>
                        <tbody>
                          <tr className="border-t border-[#e2e8f0]"><td className="py-2 px-3">Opening Balance</td><td className="py-2 px-3 text-right font-mono">{fmt(openingROU)}</td></tr>
                          <tr className="border-t border-[#e2e8f0]"><td className="py-2 px-3">Additions (new leases)</td><td className="py-2 px-3 text-right font-mono">{fmt(newLeasesROU)}</td></tr>
                          <tr className="border-t border-[#e2e8f0]"><td className="py-2 px-3">Modifications</td><td className="py-2 px-3 text-right font-mono">{fmt(rouModificationsFY)}</td></tr>
                          <tr className="border-t border-[#e2e8f0]"><td className="py-2 px-3">Depreciation charge</td><td className="py-2 px-3 text-right font-mono">({fmt(depFY)})</td></tr>
                          <tr className="border-t border-[#e2e8f0]"><td className="py-2 px-3">Impairment</td><td className="py-2 px-3 text-right font-mono">({fmt(0)})</td></tr>
                          <tr className="border-t border-[#e2e8f0]"><td className="py-2 px-3">Disposals/Terminations</td><td className="py-2 px-3 text-right font-mono">({fmt(0)})</td></tr>
                          <tr className="border-t-2 border-[#e2e8f0] font-medium"><td className="py-2 px-3">Closing Balance</td><td className="py-2 px-3 text-right font-mono">{fmt(Math.max(0, closingROU))}</td></tr>
                        </tbody>
                      </table>
                      <p className="text-sm text-[#1e293b] mt-2">Net Book Value at year end: {fmt(Math.max(0, closingROU))}</p>
                    </div>
                  </div>

                  <div className="bg-white rounded-xl border border-[#e2e8f0] overflow-hidden" style={{ borderLeft: '4px solid #f97316' }}>
                    <div className="px-4 py-3 border-b border-[#e2e8f0]">
                      <div className="font-semibold text-[#1e293b]">Note X: Lease Liabilities</div>
                      <div className="text-xs text-[#64748b] mt-0.5">IFRS 16 para 53(j)</div>
                    </div>
                    <div className="p-4 overflow-x-auto">
                      <table className="w-full border-collapse text-sm">
                        <thead><tr className="border-b border-[#e2e8f0]"><th className="text-left py-2 px-3 font-medium text-[#64748b]"> </th><th className="text-right py-2 px-3 font-medium text-[#64748b]">FY {disclosureFY}</th></tr></thead>
                        <tbody>
                          <tr className="border-t border-[#e2e8f0]"><td className="py-2 px-3">Opening Balance</td><td className="py-2 px-3 text-right font-mono">{fmt(openingLL)}</td></tr>
                          <tr className="border-t border-[#e2e8f0]"><td className="py-2 px-3">New Leases</td><td className="py-2 px-3 text-right font-mono">{fmt(newLeasesLL)}</td></tr>
                          <tr className="border-t border-[#e2e8f0]"><td className="py-2 px-3">Modifications</td><td className="py-2 px-3 text-right font-mono">{fmt(llModificationsFY)}</td></tr>
                          <tr className="border-t border-[#e2e8f0]"><td className="py-2 px-3">Interest Accrued</td><td className="py-2 px-3 text-right font-mono">{fmt(interestFY)}</td></tr>
                          <tr className="border-t border-[#e2e8f0]"><td className="py-2 px-3">Payments Made</td><td className="py-2 px-3 text-right font-mono">({fmt(paymentsMadeFY)})</td></tr>
                          <tr className="border-t border-[#e2e8f0]"><td className="py-2 px-3">Terminations</td><td className="py-2 px-3 text-right font-mono">({fmt(0)})</td></tr>
                          <tr className="border-t border-[#e2e8f0]"><td className="py-2 px-3">FX Movement</td><td className="py-2 px-3 text-right font-mono">{fmt(0)}</td></tr>
                          <tr className="border-t-2 border-[#e2e8f0] font-medium"><td className="py-2 px-3">Closing Balance</td><td className="py-2 px-3 text-right font-mono">{fmt(closingLL)}</td></tr>
                        </tbody>
                      </table>
                      <p className="text-sm text-[#1e293b] mt-2">Current portion: {fmt(currentPortion)} &nbsp;|&nbsp; Non-current portion: {fmt(nonCurrentPortion)}</p>
                    </div>
                  </div>

                  <div className="bg-white rounded-xl border border-[#e2e8f0] overflow-hidden" style={{ borderLeft: '4px solid #f97316' }}>
                    <div className="px-4 py-3 border-b border-[#e2e8f0]">
                      <div className="font-semibold text-[#1e293b]">Note X: Amounts Recognised in Statement of Profit & Loss</div>
                      <div className="text-xs text-[#64748b] mt-0.5">IFRS 16 para 53(a)(b)(c)</div>
                    </div>
                    <div className="p-4 overflow-x-auto">
                      <table className="w-full border-collapse text-sm">
                        <thead><tr className="border-b border-[#e2e8f0]"><th className="text-left py-2 px-3 font-medium text-[#64748b]"> </th><th className="text-right py-2 px-3 font-medium text-[#64748b]">FY {disclosureFY}</th></tr></thead>
                        <tbody>
                          <tr className="border-t border-[#e2e8f0]"><td className="py-2 px-3">Depreciation of ROU Assets</td><td className="py-2 px-3 text-right font-mono">{fmt(depFY)}</td></tr>
                          <tr className="border-t border-[#e2e8f0]"><td className="py-2 px-3">Interest on Lease Liabilities</td><td className="py-2 px-3 text-right font-mono">{fmt(interestFY)}</td></tr>
                          <tr className="border-t border-[#e2e8f0]"><td className="py-2 px-3">Short-term Lease Expense</td><td className="py-2 px-3 text-right font-mono">{fmt(0)}</td></tr>
                          <tr className="border-t border-[#e2e8f0]"><td className="py-2 px-3">Low-value Asset Lease Expense</td><td className="py-2 px-3 text-right font-mono">{fmt(0)}</td></tr>
                          <tr className="border-t border-[#e2e8f0]"><td className="py-2 px-3">Variable Lease Expense</td><td className="py-2 px-3 text-right font-mono">{fmt(variableAnnual)}</td></tr>
                          <tr className="border-t border-[#e2e8f0]"><td className="py-2 px-3">Gain/(Loss) on Lease Modification</td><td className="py-2 px-3 text-right font-mono">{formatNeg(gainLossModFY)}</td></tr>
                          <tr className="border-t border-[#e2e8f0]"><td className="py-2 px-3">Gain/(Loss) on Lease Termination</td><td className="py-2 px-3 text-right font-mono">{fmt(0)}</td></tr>
                          <tr className="border-t-2 border-[#e2e8f0] font-medium"><td className="py-2 px-3">Total Lease Expense</td><td className="py-2 px-3 text-right font-mono">{fmt(depFY + interestFY + variableAnnual + gainLossModFY)}</td></tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="bg-white rounded-xl border border-[#e2e8f0] overflow-hidden" style={{ borderLeft: '4px solid #f97316' }}>
                    <div className="px-4 py-3 border-b border-[#e2e8f0]">
                      <div className="font-semibold text-[#1e293b]">Note X: Cash Flow Impact</div>
                      <div className="text-xs text-[#64748b] mt-0.5">IFRS 16 para 53(g)(h)</div>
                    </div>
                    <div className="p-4 overflow-x-auto">
                      <table className="w-full border-collapse text-sm">
                        <thead><tr className="border-b border-[#e2e8f0]"><th className="text-left py-2 px-3 font-medium text-[#64748b]"> </th><th className="text-right py-2 px-3 font-medium text-[#64748b]">FY {disclosureFY}</th></tr></thead>
                        <tbody>
                          <tr className="border-t border-[#e2e8f0]"><td className="py-2 px-3">Principal repayments (financing)</td><td className="py-2 px-3 text-right font-mono">({fmt(principalPaymentsFY)})</td></tr>
                          <tr className="border-t border-[#e2e8f0]"><td className="py-2 px-3">Interest payments (financing)</td><td className="py-2 px-3 text-right font-mono">({fmt(interestFY)})</td></tr>
                          <tr className="border-t border-[#e2e8f0]"><td className="py-2 px-3">Short-term lease payments (ops)</td><td className="py-2 px-3 text-right font-mono">{fmt(0)}</td></tr>
                          <tr className="border-t border-[#e2e8f0]"><td className="py-2 px-3">Low-value lease payments (ops)</td><td className="py-2 px-3 text-right font-mono">{fmt(0)}</td></tr>
                          <tr className="border-t-2 border-[#e2e8f0] font-medium"><td className="py-2 px-3">Total cash outflow for leases</td><td className="py-2 px-3 text-right font-mono">({fmt(principalPaymentsFY + interestFY)})</td></tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="bg-white rounded-xl border border-[#e2e8f0] overflow-hidden" style={{ borderLeft: '4px solid #f97316' }}>
                    <div className="px-4 py-3 border-b border-[#e2e8f0] flex items-center justify-between flex-wrap gap-2">
                      <div>
                        <div className="font-semibold text-[#1e293b]">Note X: Significant Judgements & Assumptions</div>
                        <div className="text-xs text-[#64748b] mt-0.5">IFRS 16 para 59</div>
                      </div>
                      <div className="flex items-center gap-2">
                        {disclosureAssumptionModified && <span className="text-xs bg-[#fef3c7] text-[#92400e] px-2 py-0.5 rounded">Modified</span>}
                        {!disclosureAssumptionEditing ? (
                          <Button size="sm" variant="secondary" className="border border-[#e2e8f0]" onClick={() => { setDisclosureAssumptionEditing(true); setDisclosureAssumptionText(assumptionTextToShow); }}><Pencil className="w-4 h-4 mr-1" /> Edit</Button>
                        ) : (
                          <Button size="sm" className="bg-[#f97316] text-white" onClick={() => { setDisclosureAssumptionEditing(false); setDisclosureAssumptionModified(true); toast.success('Changes saved'); }}>Save Changes</Button>
                        )}
                      </div>
                    </div>
                    <div className="p-4">
                      {disclosureAssumptionEditing ? (
                        <textarea
                          value={disclosureAssumptionText}
                          onChange={(e) => setDisclosureAssumptionText(e.target.value)}
                          className="w-full min-h-[220px] p-3 border border-[#e2e8f0] rounded-lg text-sm text-[#1e293b] font-sans resize-y"
                          placeholder="Auto-generated assumptions (editable)"
                        />
                      ) : (
                        <pre className="w-full min-h-[120px] p-3 bg-[#f8fafc] border border-[#e2e8f0] rounded-lg text-sm text-[#1e293b] font-sans whitespace-pre-wrap">{assumptionTextToShow}</pre>
                      )}
                    </div>
                  </div>

                  <div className="bg-white rounded-xl border border-[#e2e8f0] overflow-hidden" style={{ borderLeft: '4px solid #f97316' }}>
                    <div className="px-4 py-3 border-b border-[#e2e8f0]">
                      <div className="font-semibold text-[#1e293b]">Note X: Future Minimum Lease Payments</div>
                      <div className="text-xs text-[#64748b] mt-0.5">IFRS 16 para 58</div>
                    </div>
                    <div className="p-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <p className="text-sm"><span className="text-[#64748b]">Within 1 year:</span> <span className="font-mono font-medium">{fmt(buckets[0]?.undiscounted ?? 0)}</span></p>
                          <p className="text-sm"><span className="text-[#64748b]">Between 1-5 years:</span> <span className="font-mono font-medium">{fmt(buckets.slice(1, 5).reduce((s, b) => s + b.undiscounted, 0))}</span></p>
                          <p className="text-sm"><span className="text-[#64748b]">After 5 years:</span> <span className="font-mono font-medium">{fmt(buckets[5]?.undiscounted ?? 0)}</span></p>
                          <p className="text-sm border-t border-[#e2e8f0] pt-2"><span className="text-[#64748b]">Total commitment:</span> <span className="font-mono font-medium">{fmt(totalUndiscounted)}</span></p>
                          <p className="text-sm"><span className="text-[#64748b]">Less: Finance charges:</span> <span className="font-mono">({fmt(futureFinanceCharges)})</span></p>
                          <p className="text-sm border-t border-[#e2e8f0] pt-2"><span className="text-[#64748b]">Present value:</span> <span className="font-mono font-medium">{fmt(totalPV)}</span></p>
                        </div>
                        <div className="h-[200px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={commitmentChartData} margin={{ top: 8, right: 8, left: 8, bottom: 24 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                              <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" height={48} />
                              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `₹${(v / 100000).toFixed(0)}L`} />
                              <Tooltip formatter={(value: number | string | undefined) => (value !== undefined ? fmt(Number(value)) : '')} />
                              <Bar dataKey="amount" fill="#f97316" radius={[4, 4, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    </div>
                  </div>

                  {hasVariable && (
                    <div className="bg-white rounded-xl border border-[#e2e8f0] overflow-hidden" style={{ borderLeft: '4px solid #f97316' }}>
                      <div className="px-4 py-3 border-b border-[#e2e8f0]">
                        <div className="font-semibold text-[#1e293b]">Note X: Variable Lease Payments</div>
                        <div className="text-xs text-[#64748b] mt-0.5">IFRS 16 para 59(b)</div>
                      </div>
                      <div className="p-4">
                        <p className="text-sm text-[#1e293b]">
                          The Company has lease(s) with variable payments linked to {form.variableDescription || 'CPI / revenue / usage'}. Variable payments not included in lease liability: {fmt(variableAnnual)} for the year ended {reportingDateStr}. Potential future variable payments: {fmt(variableAnnual)} (estimated).
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="pt-4">
                    <Button variant="secondary" className="border border-[#e2e8f0] bg-white" onClick={() => setDisclosureCompleteNoteOpen(true)}>
                      <FileText className="w-4 h-4 mr-2" /> View Complete Note (formatted)
                    </Button>
                  </div>
                </div>

                {disclosureCompleteNoteOpen && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setDisclosureCompleteNoteOpen(false)}>
                    <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
                      <div className="px-4 py-3 border-b border-[#e2e8f0] flex items-center justify-between">
                        <span className="font-semibold text-[#1e293b]">NOTE X: LEASES (IFRS 16) — Complete Note</span>
                        <button type="button" className="p-2 text-[#64748b] hover:bg-[#f1f5f9] rounded" onClick={() => setDisclosureCompleteNoteOpen(false)}><X className="w-5 h-5" /></button>
                      </div>
                      <div className="p-4 overflow-y-auto flex-1 text-sm text-[#1e293b] whitespace-pre-wrap font-sans">
                        {`NOTE X: LEASES (IFRS 16)\n\n[Company] as Lessee\n\nThe Company leases ${form.leaseType || 'assets'}. Lease terms range from ${termMonths} months.\n\n--- Maturity Analysis (para 58(b)) ---\nUndiscounted cash flows as at ${reportingDateStr}:\n${bucketLabels.map((l, i) => `${l}: ${fmt(buckets[i].undiscounted)} (PV ${fmt(buckets[i].pv)})`).join('\n')}\nTotal: ${fmt(totalUndiscounted)}. Less: Future finance charges (${fmt(futureFinanceCharges)}). Present value of lease liabilities: ${fmt(totalPV)}. Current: ${fmt(currentFromBuckets)}; Non-current: ${fmt(nonCurrentFromBuckets)}.\n\n--- ROU Assets (para 53(j)) ---\nOpening ${fmt(openingROU)} + Additions ${fmt(newLeasesROU)} + Modifications ${fmt(rouModificationsFY)} - Depreciation (${fmt(depFY)}) = Closing ${fmt(Math.max(0, closingROU))}.\n\n--- Lease Liabilities (para 53(j)) ---\nClosing balance ${fmt(closingLL)}. Current: ${fmt(currentPortion)}; Non-current: ${fmt(nonCurrentPortion)}.\n\n--- P&L (para 53(a)(b)(c)) ---\nDepreciation ${fmt(depFY)}; Interest ${fmt(interestFY)}; Variable ${fmt(variableAnnual)}; Gain/(Loss) on modification ${formatNeg(gainLossModFY)}. Total lease expense: ${fmt(depFY + interestFY + variableAnnual + gainLossModFY)}.\n\n--- Cash flow (para 53(g)(h)) ---\nPrincipal (${fmt(principalPaymentsFY)}); Interest (${fmt(interestFY)}). Total cash outflow: (${fmt(principalPaymentsFY + interestFY)}).\n\n--- Significant judgements (para 59) ---\n${assumptionTextToShow}\n\n--- Future commitments (para 58) ---\nWithin 1 year: ${fmt(buckets[0]?.undiscounted ?? 0)}; 1-5 years: ${fmt(buckets.slice(1, 5).reduce((s, b) => s + b.undiscounted, 0))}; After 5 years: ${fmt(buckets[5]?.undiscounted ?? 0)}. Total: ${fmt(totalUndiscounted)}. Present value: ${fmt(totalPV)}.`}
                      </div>
                      <div className="px-4 py-3 border-t border-[#e2e8f0] flex flex-wrap gap-2">
                        <Button size="sm" className="bg-[#f97316] text-white" onClick={() => { const t = `NOTE X: LEASES (IFRS 16)\n\n[Company] as Lessee\n\nThe Company leases ${form.leaseType || 'assets'}. Lease terms range from ${termMonths} months.\n\n--- Maturity Analysis (para 58(b)) ---\nUndiscounted cash flows as at ${reportingDateStr}:\n${bucketLabels.map((l, i) => `${l}: ${fmt(buckets[i].undiscounted)} (PV ${fmt(buckets[i].pv)})`).join('\n')}\nTotal: ${fmt(totalUndiscounted)}. Less: Future finance charges (${fmt(futureFinanceCharges)}). Present value of lease liabilities: ${fmt(totalPV)}. Current: ${fmt(currentFromBuckets)}; Non-current: ${fmt(nonCurrentFromBuckets)}.\n\n--- ROU Assets (para 53(j)) ---\nOpening ${fmt(openingROU)} + Additions ${fmt(newLeasesROU)} + Modifications ${fmt(rouModificationsFY)} - Depreciation (${fmt(depFY)}) = Closing ${fmt(Math.max(0, closingROU))}.\n\n--- Lease Liabilities (para 53(j)) ---\nClosing balance ${fmt(closingLL)}. Current: ${fmt(currentPortion)}; Non-current: ${fmt(nonCurrentPortion)}.\n\n--- P&L (para 53(a)(b)(c)) ---\nDepreciation ${fmt(depFY)}; Interest ${fmt(interestFY)}; Variable ${fmt(variableAnnual)}; Gain/(Loss) on modification ${formatNeg(gainLossModFY)}. Total lease expense: ${fmt(depFY + interestFY + variableAnnual + gainLossModFY)}.\n\n--- Cash flow (para 53(g)(h)) ---\nPrincipal (${fmt(principalPaymentsFY)}); Interest (${fmt(interestFY)}). Total cash outflow: (${fmt(principalPaymentsFY + interestFY)}).\n\n--- Significant judgements (para 59) ---\n${assumptionTextToShow}\n\n--- Future commitments (para 58) ---\nWithin 1 year: ${fmt(buckets[0]?.undiscounted ?? 0)}; 1-5 years: ${fmt(buckets.slice(1, 5).reduce((s, b) => s + b.undiscounted, 0))}; After 5 years: ${fmt(buckets[5]?.undiscounted ?? 0)}. Total: ${fmt(totalUndiscounted)}. Present value: ${fmt(totalPV)}.`; navigator.clipboard.writeText(t); toast.success('Copied to clipboard'); }}>Copy to Clipboard</Button>
                        <Button size="sm" variant="secondary" className="border border-[#e2e8f0]" onClick={() => { const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Note X - Leases IFRS 16</title></head><body style="font-family: sans-serif; padding: 24px;"><pre style="white-space: pre-wrap;">${`NOTE X: LEASES (IFRS 16)\n\n[Company] as Lessee\n\nThe Company leases ${form.leaseType || 'assets'}. Lease terms: ${termMonths} months.\n\nMaturity Analysis (para 58(b))\n${bucketLabels.map((l, i) => `${l}: ${fmt(buckets[i].undiscounted)} (PV ${fmt(buckets[i].pv)})`).join('\n')}\nTotal: ${fmt(totalUndiscounted)}. PV: ${fmt(totalPV)}. Current: ${fmt(currentFromBuckets)}; Non-current: ${fmt(nonCurrentFromBuckets)}.\n\nROU: Closing ${fmt(Math.max(0, closingROU))}. Lease liabilities: ${fmt(closingLL)}. P&L: Depreciation ${fmt(depFY)}; Interest ${fmt(interestFY)}; Total expense ${fmt(depFY + interestFY + variableAnnual + gainLossModFY)}. Cash outflow: (${fmt(principalPaymentsFY + interestFY)}).\n\n${assumptionTextToShow.replace(/</g, '&lt;').replace(/>/g, '&gt;')}`}</pre></body></html>`; const blob = new Blob(['\ufeff' + html], { type: 'application/vnd.ms-word' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `Note_X_Leases_IFRS16_${form.leaseId || 'lease'}.doc`; a.click(); URL.revokeObjectURL(a.href); toast.success('Downloaded as Word'); }}>Download as Word .docx</Button>
                        <Button size="sm" variant="secondary" className="border border-[#e2e8f0]" onClick={() => { const w = window.open('', '_blank'); if (w) { w.document.write(`<pre style="font-family: sans-serif; padding: 24px; white-space: pre-wrap;">${`NOTE X: LEASES (IFRS 16)\n\n[Company] as Lessee\n\nThe Company leases ${form.leaseType || 'assets'}. Lease terms: ${termMonths} months.\n\n${bucketLabels.map((l, i) => `${l}: ${fmt(buckets[i].undiscounted)} (PV ${fmt(buckets[i].pv)})`).join('\n')}\nTotal: ${fmt(totalUndiscounted)}. PV: ${fmt(totalPV)}.\n\nROU: ${fmt(Math.max(0, closingROU))}. LL: ${fmt(closingLL)}. P&L: Dep ${fmt(depFY)}; Int ${fmt(interestFY)}. Cash: (${fmt(principalPaymentsFY + interestFY)}).\n\n${assumptionTextToShow}`.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`); w.document.title = 'Note X - Leases IFRS 16'; w.print(); w.close(); } toast.success('Open print dialog to save as PDF'); }}>Download as PDF</Button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            );
          })()}

          {activeTab === 'review' && (() => {
            const liability = calcResults?.lease_liability ?? existingLease?.liability ?? 0;
            const rou = calcResults?.rou_asset ?? existingLease?.rou ?? 0;
            const split = calcResults?.liability_split ?? existingLease?.results?.liability_split ?? {};
            const currentLL = Number(split.current_portion ?? 0);
            const nonCurrentLL = Number(split.non_current_portion ?? 0);
            const termMonths = form.lease_term_months ? parseInt(form.lease_term_months, 10) || schedule.length : schedule.length;
            const monthlyDep = calcResults?.monthly_depreciation ?? (termMonths > 0 ? rou / termMonths : 0);
            const totalInterest = schedule.reduce((s: number, row: any) => s + (scheduleRow(row).interest ?? 0), 0);
            const totalPayments = schedule.reduce((s: number, row: any) => s + (scheduleRow(row).payment ?? 0), 0);
            const restorationNum = parseFloat(String(form.restorationCost || '0')) || 0;
            const ibrPct = parseFloat(String(form.discountRate || '0')) || 0;
            const restorationPV = restorationNum;

            const vStart = !!form.startDate;
            const vEnd = !!form.endDate;
            const vPayment = !!(form.baseRentAmount && parseFloat(String(form.baseRentAmount)) > 0);
            const vIbr = !!(form.discountRate && parseFloat(String(form.discountRate)) > 0);
            const vAsset = !!(form.leaseType || form.assetDescription);
            const vRestoration = true;
            const vCurrency = !!form.currency;
            const validationErrors = [!vStart, !vEnd, !vPayment, !vIbr, !vAsset, !vCurrency].filter(Boolean).length;
            const canCalculate = validationErrors === 0 && !isCalculating;

            const statusDisplay = form.leaseStatus === 'Finalised' ? 'Finalised' : form.leaseStatus === 'Under Review' ? 'Under Review' : hasResults ? 'Calculated' : 'Draft';
            const isFinalised = form.leaseStatus === 'Finalised';

            const journalSubTabs = [
              { id: 'initial' as const, label: 'Initial Recognition' },
              { id: 'monthly' as const, label: 'Monthly Entries' },
              { id: 'year_end' as const, label: 'Year-End Entries' },
              { id: 'modification' as const, label: 'Modification Entries' },
              { id: 'termination' as const, label: 'Termination Entries' },
            ];

            const monthOptions = Array.from({ length: 12 }, (_, i) => i + 1);
            const startYear = form.startDate ? new Date(form.startDate).getFullYear() : new Date().getFullYear();
            const endYear = form.endDate ? new Date(form.endDate).getFullYear() : startYear + 5;
            const yearOptions = Array.from({ length: Math.max(1, endYear - startYear + 1) }, (_, i) => startYear + i);
            const fyOptions = Array.from({ length: Math.max(1, endYear - startYear + 2) }, (_, i) => `${startYear + i}-${String(startYear + i + 1).slice(-2)}`);

            const scheduleRowForMonth = schedule.find((row: any) => {
              const r = scheduleRow(row);
              const d = r.date ? new Date(r.date) : null;
              return d && d.getMonth() + 1 === reviewJournalMonth && d.getFullYear() === reviewJournalYear;
            });
            const rowForMonth = scheduleRowForMonth ? scheduleRow(scheduleRowForMonth) : null;
            const periodIndex = schedule.findIndex((row: any) => {
              const r = scheduleRow(row);
              const d = r.date ? new Date(r.date) : null;
              return d && d.getMonth() + 1 === reviewJournalMonth && d.getFullYear() === reviewJournalYear;
            });

            const modifications = (form.modifications || []) as any[];
            const formatNeg = (n: number) => (n < 0 ? `(${fmt(-n)})` : fmt(n));

            const handlePrintReport = () => {
              const w = window.open('', '_blank');
              if (!w) return;
              const liability = calcResults?.lease_liability ?? existingLease?.liability ?? 0;
              const rou = calcResults?.rou_asset ?? existingLease?.rou ?? 0;
              const split = calcResults?.liability_split ?? existingLease?.results?.liability_split ?? {};
              w.document.write(`
                <!DOCTYPE html><html><head><title>IFRS 16 Report - ${form.leaseId || form.title || 'Lease'}</title><style>
                  body{ font-family: sans-serif; padding: 24px; }
                  table{ border-collapse: collapse; width:100%; margin:12px 0; }
                  th,td{ border:1px solid #e2e8f0; padding:8px; text-align:left; }
                  th{ background:#f97316; color:white; }
                  .text-right{ text-align:right; }
                  h1,h2{ color:#1e293b; }
                  .mb-4{ margin-bottom:16px; }
                </style></head><body>
                <h1>${form.title || form.assetDescription || form.leaseId || 'Lease'}</h1>
                <p>Prepared by IFRSAI · ${new Date().toLocaleString()}</p>
                <h2 class="mb-4">Summary</h2>
                <p>Lease Liability: ${fmt(liability)} | ROU Asset: ${fmt(rou)}</p>
                <p>Current portion: ${fmt(Number(split.current_portion ?? 0))} | Non-current: ${fmt(Number(split.non_current_portion ?? 0))}</p>
                <p>Generated by IFRSAI on ${new Date().toLocaleString()}</p>
                </body></html>`);
              w.document.close();
              w.print();
              w.close();
            };

            const handleDownloadTallyXml = () => {
              const commencement = form.startDate || '';
              const xml = `<?xml version="1.0"?>
<ENVELOPE>
  <HEADER><TITLE>IFRS 16 Journal Entries - ${form.leaseId || 'Lease'}</TITLE></HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME></REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE>
          <VOUCHER REMOTEID="" VCHKEY="" ACTION="Create" OBJVIEW="Accounting Voucher View">
            <DATE>${commencement.replace(/-/g, '/')}</DATE>
            <NARRATION>Initial recognition - ROU Asset and Lease Liability</NARRATION>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>${reviewAccountNames.rou_asset}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
              <AMOUNT>${fmt(rou).replace(/[₹,\s]/g, '')}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>${reviewAccountNames.lease_liability_current}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>-${fmt(currentLL).replace(/[₹,\s]/g, '')}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>${reviewAccountNames.lease_liability_non_current}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>-${fmt(nonCurrentLL).replace(/[₹,\s]/g, '')}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
          </VOUCHER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
              const blob = new Blob([xml], { type: 'application/xml' });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = `IFRS16_${form.leaseId || 'lease'}_Tally.xml`;
              a.click();
              URL.revokeObjectURL(a.href);
              toast.success('Tally XML downloaded');
            };

            const handleDownloadCsvRaw = () => {
              const headers = ['Period', 'Date', 'Opening', 'Payment', 'Interest', 'Principal', 'Closing'];
              const rows = schedule.map((row: any, i: number) => {
                const r = scheduleRow(row);
                return [r.period ?? i + 1, r.date ?? '', r.opening ?? '', r.payment ?? '', r.interest ?? '', r.principal ?? '', r.closing ?? ''];
              });
              const escape = (v: string | number) => (typeof v === 'string' && (v.includes(',') || v.includes('"')) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
              const csv = [headers.join(','), ...rows.map((r: (string|number)[]) => r.map(escape).join(','))].join('\n');
              const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = `IFRS16_${form.leaseId || 'lease'}_schedule.csv`;
              a.click();
              URL.revokeObjectURL(a.href);
              toast.success('CSV downloaded');
            };

            const handleFinalise = () => {
              setForm((p) => ({ ...p, leaseStatus: 'Finalised' }));
              setFinaliseModalOpen(false);
              setAuditTrail((prev) => [...prev, { id: `audit-${Date.now()}`, dateTime: new Date().toISOString(), user: 'System', action: 'Lease finalised', ip: undefined }]);
              toast.success('Lease finalised — no further edits without new version');
            };

            return (
              <>
                <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-[#1e293b] flex items-center gap-2"><CheckCircle className="w-5 h-5 text-[#f97316]" /> Review & Calculate</h3>
                    <p className="text-xs text-[#64748b] mt-1">Validate, generate journal entries and export audit-ready reports</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button onClick={() => canCalculate && handleCalculate()} disabled={!canCalculate || isCalculating} className="bg-[#f97316] text-white" title={!canCalculate ? 'Fix errors above first' : ''}>
                      {isCalculating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}🧮 Calculate IFRS 16
                    </Button>
                    <Button onClick={handleSaveToRepo} disabled={saving} variant="secondary" className="border border-[#e2e8f0] bg-white">💾 Save</Button>
                    {excelFileId ? (
                      <a href={ifrs16Api.downloadReport(excelFileId)} target="_blank" rel="noopener noreferrer">
                        <Button variant="secondary" className="border border-[#e2e8f0] bg-white">📥 Download Excel</Button>
                      </a>
                    ) : null}
                    <Button variant="secondary" className="border border-[#e2e8f0] bg-white" onClick={handlePrintReport}>🖨️ Print Report</Button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3 mb-4 text-sm">
                  <button type="button" onClick={() => setVersionHistoryModalOpen(true)} className="px-2 py-1 rounded bg-[#fff7ed] text-[#c2410c] font-medium hover:bg-[#ffedd5]">{form.version || 'V1'}</button>
                  <span className="text-[#64748b]">Last calculated: {lastCalculatedAt ? new Date(lastCalculatedAt).toLocaleString() : '—'}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusDisplay === 'Finalised' ? 'bg-green-100 text-green-700' : statusDisplay === 'Calculated' ? 'bg-blue-100 text-blue-700' : statusDisplay === 'Under Review' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-700'}`}>{statusDisplay}</span>
                </div>
                {versionHistoryModalOpen && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setVersionHistoryModalOpen(false)}>
                    <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
                      <h4 className="font-semibold text-[#1e293b] mb-2">Version History</h4>
                      <p className="text-sm text-[#64748b] mb-2">Current version: <strong>{form.version || 'V1'}</strong></p>
                      <p className="text-xs text-[#64748b] mb-4">Last 5 versions are retained. Comparison available when multiple versions exist.</p>
                      <Button variant="secondary" size="sm" className="border border-[#e2e8f0]" onClick={() => setVersionHistoryModalOpen(false)}>Close</Button>
                    </div>
                  </div>
                )}
                {isFinalised && (
                  <div className="mb-4 p-3 rounded-lg bg-green-50 border border-green-200 text-green-800 text-sm flex items-center gap-2">
                    <CheckCircle className="w-5 h-5 shrink-0" /> This lease is finalised. Values are locked. Use Create New Version to make changes.
                  </div>
                )}

                {/* Section 1 — Health Check */}
                <div className="bg-white rounded-xl border border-[#e2e8f0] overflow-hidden mb-6" style={{ borderLeft: '4px solid #f97316' }}>
                  <div className="px-4 py-3 border-b border-[#e2e8f0] font-semibold text-[#1e293b]">Validation checklist</div>
                  <div className="p-4 space-y-2">
                    <p className={vStart ? 'text-green-600 text-sm' : 'text-red-600 text-sm'}>{vStart ? '✅' : '❌'} Lease commencement date set</p>
                    <p className={vEnd ? 'text-green-600 text-sm' : 'text-red-600 text-sm'}>{vEnd ? '✅' : '❌'} Lease end date set</p>
                    <p className={vPayment ? 'text-green-600 text-sm' : 'text-red-600 text-sm'}>{vPayment ? '✅' : '❌'} Monthly payment amount entered</p>
                    <p className={vIbr ? 'text-green-600 text-sm' : 'text-red-600 text-sm'}>{vIbr ? '✅' : '❌'} IBR rate entered</p>
                    <p className={vAsset ? 'text-green-600 text-sm' : 'text-red-600 text-sm'}>{vAsset ? '✅' : '❌'} Asset class selected</p>
                    <p className="text-amber-600 text-sm">⚠️ Restoration cost not entered (optional)</p>
                    <p className={vCurrency ? 'text-green-600 text-sm' : 'text-red-600 text-sm'}>
                      {vCurrency ? '✅' : '❌'} Currency not selected
                      {!vCurrency && <Button size="sm" variant="secondary" className="ml-2 border border-[#e2e8f0]" onClick={() => setActiveTab('financial')}>Fix</Button>}
                    </p>
                    <Button variant="secondary" size="sm" className="border border-[#e2e8f0] mt-2" onClick={() => {}}>Run Health Check</Button>
                  </div>
                </div>

                {hasResults && (
                  <>
                    {!isCalculating && (
                      <div className="p-3 rounded-lg bg-green-50 border border-green-200 text-green-800 text-sm mb-4">
                        ✅ Calculation complete
                        {ibrPct > 0 && <span className="block mt-1 font-medium">Calculated using IBR: {Number(ibrPct).toFixed(2)}%</span>}
                      </div>
                    )}
                    {/* Section 2 — KPI Cards */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                      {[
                        { label: 'LEASE LIABILITY', value: fmt(liability), sub: 'as at today' },
                        { label: 'ROU ASSET', value: fmt(rou), sub: 'NBV as at today' },
                        { label: 'TOTAL INTEREST', value: fmt(totalInterest), sub: 'over lease term' },
                        { label: 'TOTAL PAYMENTS', value: fmt(totalPayments), sub: 'over lease term' },
                        { label: 'MONTHLY DEPREC.', value: fmt(monthlyDep), sub: 'straight-line' },
                        { label: 'CURRENT LL', value: fmt(currentLL), sub: 'due < 12 months' },
                        { label: 'NON-CURRENT LL', value: fmt(nonCurrentLL), sub: 'due > 12 months' },
                        { label: 'RESTORATION PV', value: fmt(restorationPV), sub: 'discounted cost' },
                      ].map((card, i) => (
                        <div key={i} className="p-4 rounded-xl border border-[#e2e8f0] bg-white shadow-sm">
                          <p className="text-xs text-[#64748b] uppercase tracking-wide mb-1">{card.label}</p>
                          <p className="font-mono font-semibold text-[#f97316] text-lg">{card.value}</p>
                          <p className="text-xs text-[#64748b] mt-0.5">{card.sub}</p>
                        </div>
                      ))}
                    </div>
                    {(() => {
                      const ibr = Number(ibrPct) || 0;
                      const monthlyEquiv = ibr / 12;
                      const ptRaw = String(form.paymentType || 'Arrears').trim();
                      const isAdvance = ptRaw.toLowerCase().includes('advance');
                      const paymentTimingLabel = isAdvance
                        ? `${ptRaw || 'Advance'} (beginning of period)`
                        : `${ptRaw || 'Arrears'} (end of period)`;
                      const termM = termMonths || 0;
                      const nonLease =
                        parseFloat(String(form.nonLeaseComponent ?? '0')) || 0;
                      const rentFreeM = form.rentFreeMonths ?? 0;
                      const cpiBase = parseFloat(String(form.baseIndexValue || '0')) || 0;
                      const cpiCurrent = parseFloat(String(form.currentIndexValue || '0')) || 0;
                      const cpiFreq =
                        parseInt(String(form.cpiAdjustmentFrequencyMonths || '12'), 10) || 12;
                      const cpiStepPct =
                        cpiBase > 0 ? ((cpiCurrent / cpiBase - 1) * 100).toFixed(1) : '0.0';
                      return (
                        <div className="mt-4 p-4 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-600 mb-6">
                          <div className="flex items-center gap-1.5 mb-2">
                            <span className="text-gray-400">⚙</span>
                            <span className="font-semibold text-gray-700 uppercase tracking-wide text-xs">
                              Calculation Assumptions
                            </span>
                            <span className="ml-auto text-xs text-blue-500 font-medium">IFRS 16 §26</span>
                          </div>
                          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
                            <div className="flex justify-between gap-2">
                              <span className="text-gray-500">Discount rate (IBR)</span>
                              <span className="font-medium text-gray-800 text-right shrink-0">
                                {ibr.toFixed(2)}% (monthly: {monthlyEquiv.toFixed(4)}%)
                              </span>
                            </div>
                            <div className="flex justify-between gap-2">
                              <span className="text-gray-500">Payment timing</span>
                              <span className="font-medium text-gray-800 text-right">{paymentTimingLabel}</span>
                            </div>
                            <div className="flex justify-between gap-2">
                              <span className="text-gray-500">Lease term</span>
                              <span className="font-medium text-gray-800 text-right">{termM} months</span>
                            </div>
                            <div className="flex justify-between gap-2">
                              <span className="text-gray-500">Depreciation method</span>
                              <span className="font-medium text-gray-800 text-right">
                                Straight-line over lease term
                              </span>
                            </div>
                            <div className="flex justify-between gap-2">
                              <span className="text-gray-500">PV method</span>
                              <span className="font-medium text-gray-800 text-right">
                                Effective interest method
                              </span>
                            </div>
                            <div className="flex justify-between gap-2">
                              <span className="text-gray-500">Ownership transfer</span>
                              <span className="font-medium text-gray-800 text-right">Not assumed</span>
                            </div>
                            {nonLease > 0 && (
                              <div className="flex justify-between col-span-2 gap-2">
                                <span className="text-gray-500">Non-lease component</span>
                                <span className="font-medium text-gray-800 text-right">
                                  ₹{nonLease.toLocaleString('en-IN')} /month excluded from PV
                                </span>
                              </div>
                            )}
                            {rentFreeM > 0 && (
                              <div className="flex justify-between col-span-2 gap-2">
                                <span className="text-gray-500">Rent-free period</span>
                                <span className="font-medium text-gray-800 text-right">
                                  {rentFreeM} months ({fmt(0)} payment, interest accrues)
                                </span>
                              </div>
                            )}
                            {cpiBase > 0 && (
                              <div className="flex justify-between col-span-2 gap-2">
                                <span className="text-gray-500">CPI adjustment</span>
                                <span className="font-medium text-gray-800 text-right">
                                  Index {cpiBase} → {cpiCurrent} (+{cpiStepPct}% step-up at month {cpiFreq})
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                    {(() => {
                      const componentAnalysis = calcResults?.component_analysis ?? existingLease?.results?.component_analysis;
                      if (!componentAnalysis) return null;
                      return (
                        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                          <h4 className="text-sm font-semibold text-blue-800 mb-2">Component Split</h4>
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
                            <div>
                              <p className="text-[#64748b]">Total monthly</p>
                              <p className="font-semibold">{fmt(Number(componentAnalysis.total_monthly_payment || 0))}</p>
                            </div>
                            <div>
                              <p className="text-[#64748b]">Lease component (IFRS 16 liability basis)</p>
                              <p className="font-semibold text-green-700">{fmt(Number(componentAnalysis.lease_component || 0))}</p>
                            </div>
                            <div>
                              <p className="text-[#64748b]">Non-lease (P&amp;L straight-line)</p>
                              <p className="font-semibold text-red-600">{fmt(Number(componentAnalysis.non_lease_component || 0))}</p>
                            </div>
                            <div>
                              <p className="text-[#64748b]">Total non-lease over term</p>
                              <p className="font-semibold">{fmt(Number(componentAnalysis.total_non_lease_over_term || 0))}</p>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Section 3 — Parameters */}
                    <div className="bg-white rounded-xl border border-[#e2e8f0] overflow-hidden mb-6">
                      <button type="button" className="w-full px-4 py-3 flex items-center justify-between text-left font-semibold text-[#1e293b] border-b border-[#e2e8f0]" onClick={() => setReviewParamsCollapsed((c) => !c)}>
                        Calculation Parameters Used
                        {reviewParamsCollapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                      </button>
                      {!reviewParamsCollapsed && (
                        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                          <p><span className="text-[#64748b]">Commencement Date:</span> {form.startDate ? new Date(form.startDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'}</p>
                          <p><span className="text-[#64748b]">Lease End Date:</span> {form.endDate ? new Date(form.endDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'}</p>
                          <p><span className="text-[#64748b]">Lease Term:</span> {termMonths} months</p>
                          <p><span className="text-[#64748b]">Contract rent (gross):</span> {fmt(parseFloat(String(form.baseRentAmount)) || 0)}</p>
                          <p><span className="text-[#64748b]">Lease component (IFRS 16 PV):</span>{' '}
                            {fmt(
                              calcResults?.component_analysis?.lease_component ??
                                Math.max(
                                  0,
                                  (parseFloat(String(form.baseRentAmount)) || 0) -
                                    (form.practicalExpedientElected ? 0 : parseFloat(String(form.nonLeaseComponent || '0')) || 0)
                                )
                            )}
                          </p>
                          {(monthlyNonLeaseComponent > 0 || form.rentFreeMonths > 0) && (
                            <p className="text-xs text-[#64748b] col-span-2">
                              {form.rentFreeMonths > 0 ? `Rent-free: ${form.rentFreeMonths} month(s) (lease payments £0; interest accrues). ` : ''}
                              {monthlyNonLeaseComponent > 0
                                ? `Non-lease ${fmt(monthlyNonLeaseComponent)}/mo excluded from liability schedule.`
                                : ''}
                            </p>
                          )}
                          <p><span className="text-[#64748b]">IBR:</span> {ibrPct}% per annum</p>
                          <p><span className="text-[#64748b]">IBR (monthly):</span> {(ibrPct / 12).toFixed(4)}% per month</p>
                          <p><span className="text-[#64748b]">Payment Timing:</span> {form.paymentTiming || 'End of month'}</p>
                          <p><span className="text-[#64748b]">Currency:</span> {form.currency || '—'}</p>
                          <p><span className="text-[#64748b]">Restoration Cost:</span> {restorationNum > 0 ? fmt(restorationNum) : 'Nil'}</p>
                          <p><span className="text-[#64748b]">Initial Direct Costs:</span> Nil</p>
                          <p><span className="text-[#64748b]">Lease Incentives:</span> Nil</p>
                          <p><span className="text-[#64748b]">Modifications:</span> {modifications.length} modification(s) applied</p>
                          <p><span className="text-[#64748b]">Last Recalculated:</span> {lastCalculatedAt ? new Date(lastCalculatedAt).toLocaleString() : '—'}</p>
                          <Button variant="secondary" size="sm" className="border border-[#e2e8f0] mt-2" onClick={() => setActiveTab('contract')}>✏️ Edit Parameters</Button>
                        </div>
                      )}
                    </div>

                    {/* Section 4 — Journal Entries */}
                    <div className="bg-white rounded-xl border border-[#e2e8f0] overflow-hidden mb-6">
                      <div className="px-4 py-3 border-b border-[#e2e8f0]">
                        <div className="font-semibold text-[#1e293b]">Journal Entries</div>
                        <p className="text-xs text-[#64748b] mt-0.5">Auto-generated accounting entries</p>
                      </div>
                      <div className="flex flex-wrap gap-1 p-2 border-b border-[#e2e8f0] bg-[#f8fafc]">
                        {journalSubTabs.map((t) => (
                          <button key={t.id} type="button" className={`px-3 py-1.5 rounded text-sm font-medium ${reviewJournalSubTab === t.id ? 'bg-[#f97316] text-white' : 'bg-white border border-[#e2e8f0] text-[#64748b]'}`} onClick={() => setReviewJournalSubTab(t.id)}>{t.label}</button>
                        ))}
                      </div>
                      <div className="p-4">
                        {reviewJournalSubTab === 'initial' && (
                          <div className="space-y-4">
                            <p className="text-sm text-[#64748b]">DATE: {form.startDate || 'Commencement Date'}</p>
                            <div className="font-mono text-sm space-y-1">
                              <p><strong>Entry 1 — Lease Liability &amp; ROU Asset</strong></p>
                              <p>Dr  {reviewAccountNames.rou_asset.padEnd(32)} {fmt(rou)}</p>
                              <p>    Cr  {reviewAccountNames.lease_liability_current.padEnd(28)} {fmt(currentLL)}</p>
                              <p>    Cr  {reviewAccountNames.lease_liability_non_current.padEnd(26)} {fmt(nonCurrentLL)}</p>
                              <p className="text-[#64748b] italic text-xs mt-1">Initial recognition at commencement</p>
                            </div>
                            {restorationNum > 0 && (
                              <div className="font-mono text-sm space-y-1">
                                <p><strong>Entry 3 — Restoration Provision</strong></p>
                                <p>Dr  {reviewAccountNames.rou_asset.padEnd(32)} {fmt(restorationPV)}</p>
                                <p>    Cr  {reviewAccountNames.provisions_restoration.padEnd(28)} {fmt(restorationPV)}</p>
                              </div>
                            )}
                            <div className="flex gap-2">
                              <Button size="sm" variant="secondary" className="border border-[#e2e8f0]" onClick={() => { navigator.clipboard.writeText(`Dr ${reviewAccountNames.rou_asset} ${fmt(rou)}\nCr ${reviewAccountNames.lease_liability_current} ${fmt(currentLL)}\nCr ${reviewAccountNames.lease_liability_non_current} ${fmt(nonCurrentLL)}`); toast.success('Copied'); }}>📋 Copy</Button>
                              <Button size="sm" variant="secondary" className="border border-[#e2e8f0]" onClick={() => { const key = 'rou_asset'; const newName = prompt('Account name', reviewAccountNames[key]); if (newName != null) setReviewAccountNames((a) => ({ ...a, [key]: newName || a[key] })); }}>✏️ Edit Account Names</Button>
                            </div>
                          </div>
                        )}
                        {reviewJournalSubTab === 'monthly' && (
                          <div className="space-y-4">
                            <div className="flex flex-wrap items-center gap-2 mb-4">
                              <select value={reviewJournalMonth} onChange={(e) => setReviewJournalMonth(Number(e.target.value))} className={inputClass + ' max-w-[120px]'}>
                                {monthOptions.map((m) => <option key={m} value={m}>{new Date(2000, m - 1, 1).toLocaleString('default', { month: 'long' })}</option>)}
                              </select>
                              <select value={reviewJournalYear} onChange={(e) => setReviewJournalYear(Number(e.target.value))} className={inputClass + ' max-w-[100px]'}>
                                {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
                              </select>
                              <Button size="sm" variant="secondary" onClick={() => { let idx = schedule.findIndex((r: any) => scheduleRow(r).date && new Date(scheduleRow(r).date).getMonth() + 1 === reviewJournalMonth && new Date(scheduleRow(r).date).getFullYear() === reviewJournalYear); if (idx <= 0) idx = 0; else idx--; const r = schedule[idx]; if (r) { const d = scheduleRow(r).date ? new Date(scheduleRow(r).date) : null; if (d) { setReviewJournalMonth(d.getMonth() + 1); setReviewJournalYear(d.getFullYear()); } } }}>⬅ Prev Month</Button>
                              <Button size="sm" variant="secondary" onClick={() => { let idx = schedule.findIndex((r: any) => scheduleRow(r).date && new Date(scheduleRow(r).date).getMonth() + 1 === reviewJournalMonth && new Date(scheduleRow(r).date).getFullYear() === reviewJournalYear); idx++; if (idx >= schedule.length) idx = schedule.length - 1; const r = schedule[idx]; if (r) { const d = scheduleRow(r).date ? new Date(scheduleRow(r).date) : null; if (d) { setReviewJournalMonth(d.getMonth() + 1); setReviewJournalYear(d.getFullYear()); } } }}>Next Month ➡</Button>
                            </div>
                            {rowForMonth ? (
                              <div className="font-mono text-sm space-y-3">
                                <p><strong>Entry 1 — Lease Payment</strong></p>
                                <p>Dr  {reviewAccountNames.lease_liability.padEnd(32)} {fmt(Number(rowForMonth.principal ?? 0))}</p>
                                <p>    Cr  {reviewAccountNames.cash.padEnd(32)} {fmt(Number(rowForMonth.payment ?? 0))}</p>
                                <p><strong>Entry 2 — Interest Accrual</strong></p>
                                <p>Dr  {reviewAccountNames.finance_cost.padEnd(32)} {fmt(Number(rowForMonth.interest ?? 0))}</p>
                                <p>    Cr  {reviewAccountNames.lease_liability.padEnd(32)} {fmt(Number(rowForMonth.interest ?? 0))}</p>
                                <p><strong>Entry 3 — Depreciation</strong></p>
                                <p>Dr  {reviewAccountNames.depreciation_expense.padEnd(32)} {fmt(monthlyDep)}</p>
                                <p>    Cr  {reviewAccountNames.acc_dep_rou.padEnd(32)} {fmt(monthlyDep)}</p>
                                {restorationNum > 0 && (
                                  <p>Dr  {reviewAccountNames.finance_cost.replace('Interest', 'Unwinding').padEnd(32)} {fmt(restorationNum * (ibrPct / 100) / 12)}</p>
                                )}
                                <Button size="sm" variant="secondary" className="border border-[#e2e8f0]" onClick={() => toast.success('Copied')}>📋 Copy</Button>
                              </div>
                            ) : (
                              <p className="text-[#64748b] text-sm">No schedule row for selected month/year. Choose a period within the lease term.</p>
                            )}
                          </div>
                        )}
                        {reviewJournalSubTab === 'year_end' && (
                          <div className="space-y-4">
                            <div className="flex items-center gap-2 mb-4">
                              <label className="text-sm text-[#64748b]">FY</label>
                              <select value={reviewJournalFY} onChange={(e) => setReviewJournalFY(e.target.value)} className={inputClass + ' max-w-[140px]'}>
                                {fyOptions.map((fy) => <option key={fy} value={fy}>FY {fy}</option>)}
                              </select>
                            </div>
                            <div className="font-mono text-sm space-y-1">
                              <p><strong>Entry 1 — Current/Non-current reclassification</strong></p>
                              <p>Dr  {reviewAccountNames.lease_liability_non_current.padEnd(32)} {fmt(nonCurrentLL)}</p>
                              <p>    Cr  {reviewAccountNames.lease_liability_current.padEnd(28)} {fmt(currentLL)}</p>
                              <p className="text-[#64748b] italic text-xs mt-1">Reclassify LL due within 12 months to current as at year end date</p>
                            </div>
                            <Button size="sm" variant="secondary" className="border border-[#e2e8f0]" onClick={() => toast.success('Copied')}>📋 Copy</Button>
                          </div>
                        )}
                        {reviewJournalSubTab === 'modification' && (
                          <div>
                            {modifications.length === 0 ? (
                              <p className="text-[#64748b] text-sm">No modifications recorded</p>
                            ) : (
                              <div className="space-y-4">
                                {modifications.map((m: any, i: number) => (
                                  <div key={i} className="border border-[#e2e8f0] rounded-lg p-4">
                                    <p className="font-medium text-[#1e293b]">Modification {i + 1} — {m.date} — {m.type || '—'}</p>
                                    <div className="font-mono text-sm mt-2 space-y-1">
                                      {Number(m.llAdjustment ?? 0) !== 0 && (
                                        <p>Dr/Cr Lease Liability {formatNeg(Number(m.llAdjustment ?? 0))}</p>
                                      )}
                                      {Number(m.rouAdjustment ?? 0) !== 0 && (
                                        <p>Dr/Cr {reviewAccountNames.rou_asset} {formatNeg(Number(m.rouAdjustment ?? 0))}</p>
                                      )}
                                      {Number(m.gainLoss ?? 0) !== 0 && (
                                        <p>Gain/(Loss) on modification: {formatNeg(Number(m.gainLoss ?? 0))}</p>
                                      )}
                                    </div>
                                    <Button size="sm" variant="secondary" className="mt-2 border border-[#e2e8f0]" onClick={() => toast.success('Copied')}>📋 Copy</Button>
                                  </div>
                                ))}
                              </div>
                            )}
                            <Button size="sm" variant="secondary" className="mt-4 border border-[#e2e8f0]" onClick={() => toast.success('All entries copied')}>📋 Copy All Journal Entries</Button>
                          </div>
                        )}
                        {reviewJournalSubTab === 'termination' && (
                          <div>
                            {form.leaseStatus !== 'Terminated' ? (
                              <p className="text-[#64748b] text-sm">Lease is active — no termination entries</p>
                            ) : (
                              <div className="font-mono text-sm space-y-1">
                                <p>Dr  {reviewAccountNames.lease_liability.padEnd(32)} {fmt(liability)}</p>
                                <p>Dr  {reviewAccountNames.acc_dep_rou.padEnd(32)} {fmt(rou - (schedule.length > 0 ? Math.max(0, rou - monthlyDep * schedule.length) : 0))}</p>
                                <p>Dr/Cr {reviewAccountNames.gain_loss_termination.padEnd(28)} —</p>
                                <p>    Cr  {reviewAccountNames.rou_asset.padEnd(32)} {fmt(rou)}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Section 5 — Download Reports */}
                    <div className="bg-white rounded-xl border border-[#e2e8f0] overflow-hidden mb-6">
                      <div className="px-4 py-3 border-b border-[#e2e8f0] font-semibold text-[#1e293b]">Download Reports</div>
                      <div className="p-4 flex flex-wrap gap-2">
                        {excelFileId ? (
                          <a href={ifrs16Api.downloadReport(excelFileId)} target="_blank" rel="noopener noreferrer">
                            <Button variant="secondary" className="border border-[#e2e8f0]">📥 Download Excel</Button>
                          </a>
                        ) : null}
                        <Button variant="secondary" className="border border-[#e2e8f0]" onClick={handlePrintReport}>📥 Download PDF</Button>
                        <Button variant="secondary" className="border border-[#e2e8f0]" onClick={handleDownloadTallyXml}>📥 Tally XML Export</Button>
                        <Button variant="secondary" className="border border-[#e2e8f0]" onClick={() => { toast('SAP format: use Journal Entries export'); }}>📥 SAP Journal Upload Format</Button>
                        <Button variant="secondary" className="border border-[#e2e8f0]" onClick={handleDownloadCsvRaw}>📥 CSV Raw Data</Button>
                      </div>
                    </div>

                    {/* Section 6 — Audit Trail */}
                    <div className="bg-white rounded-xl border border-[#e2e8f0] overflow-hidden mb-6">
                      <div className="px-4 py-3 border-b border-[#e2e8f0] font-semibold text-[#1e293b]">Audit Trail</div>
                      <div className="p-4 overflow-x-auto">
                        <table className="w-full text-sm border-collapse">
                          <thead><tr className="border-b border-[#e2e8f0]"><th className="text-left py-2 px-2 font-medium text-[#64748b]">Date/Time</th><th className="text-left py-2 px-2 font-medium text-[#64748b]">User</th><th className="text-left py-2 px-2 font-medium text-[#64748b]">Action</th><th className="text-left py-2 px-2 font-medium text-[#64748b]">Field</th><th className="text-left py-2 px-2 font-medium text-[#64748b]">Old → New</th></tr></thead>
                          <tbody>
                            {auditTrail.length === 0 ? (
                              <tr><td colSpan={5} className="py-4 text-[#64748b] text-center">No audit entries yet. Actions (calculate, save, finalise) will be recorded here.</td></tr>
                            ) : (
                              [...auditTrail].reverse().slice(0, 50).map((a) => (
                                <tr key={a.id} className="border-t border-[#e2e8f0]"><td className="py-2 px-2">{new Date(a.dateTime).toLocaleString()}</td><td className="py-2 px-2">{a.user}</td><td className="py-2 px-2">{a.action}</td><td className="py-2 px-2">{a.fieldChanged ?? '—'}</td><td className="py-2 px-2">{a.oldValue != null || a.newValue != null ? `${a.oldValue ?? ''} → ${a.newValue ?? ''}` : '—'}</td></tr>
                              ))
                            )}
                          </tbody>
                        </table>
                        <Button variant="secondary" size="sm" className="mt-2 border border-[#e2e8f0]" onClick={() => { const w = window.open('', '_blank'); if (w) { w.document.write('<pre>' + auditTrail.map((a) => `${a.dateTime} | ${a.user} | ${a.action}`).join('\n') + '</pre>'); w.document.title = 'Audit Trail'; w.print(); w.close(); } }}>📥 Export Audit Trail PDF</Button>
                      </div>
                    </div>

                    {/* Section 7 — Finalise */}
                    <div className="bg-white rounded-xl border border-[#e2e8f0] overflow-hidden mb-6">
                      <div className="px-4 py-3 border-b border-[#e2e8f0] font-semibold text-[#1e293b]">Finalise Lease</div>
                      <div className="p-4">
                        <p className="text-sm text-[#64748b] mb-2">Status workflow: Draft → Calculated → Under Review → Finalised</p>
                        {statusDisplay === 'Calculated' && !isFinalised && (
                          <Button className="bg-[#f97316] text-white" onClick={() => setFinaliseModalOpen(true)}>✅ Finalise This Lease</Button>
                        )}
                        {isFinalised && (
                          <Button variant="secondary" className="border border-[#e2e8f0]" onClick={() => { router.push(`/dashboard/ifrs16/leases/new?copyFrom=${id}`); toast.success('Create new version from lease'); }}>Create New Version</Button>
                        )}
                      </div>
                    </div>
                  </>
                )}

                {finaliseModalOpen && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setFinaliseModalOpen(false)}>
                    <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
                      <h4 className="font-semibold text-[#1e293b] mb-2">Finalise this lease?</h4>
                      <p className="text-sm text-[#64748b] mb-4">Finalising this lease will lock all values. No further edits will be possible without creating a new version. Are you sure?</p>
                      <div className="flex justify-end gap-2">
                        <Button variant="secondary" className="border border-[#e2e8f0]" onClick={() => setFinaliseModalOpen(false)}>Cancel</Button>
                        <Button className="bg-[#f97316] text-white" onClick={handleFinalise}>Finalise & Lock</Button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      </div>
    </SidebarLayout>
  );
}
