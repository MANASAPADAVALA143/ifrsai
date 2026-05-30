'use client';

import { useState, useEffect, Fragment, useMemo, useRef } from 'react';
import Link from 'next/link';
import { SidebarLayout } from '@/components/SidebarLayout';
import { Button } from '@/components/Button';
import { Upload, FileText, Calculator, Download, Loader2, CheckCircle2, Clock, ArrowRight, Copy, Plus, Trash2, HelpCircle, X, ChevronDown, ChevronUp, AlertTriangle, Building2 } from 'lucide-react';
import { ifrs15Api } from '@/lib/api';
import { consumeRealEstateSyncPending } from '@/lib/realestate-ifrs15-mapper';
import toast from 'react-hot-toast';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from 'recharts';
import { formatCurrency, sanitizeCurrencyCode } from '@/lib/utils';

const IFRS15_REVERSAL_FACTOR_ROWS: { key: string; label: string }[] = [
  { key: 'constraint_level', label: 'VC Constraint Level' },
  { key: 'contract_term', label: 'Contract Duration' },
  { key: 'customer_type', label: 'Customer Risk Profile' },
  { key: 'variable_pct', label: 'Variable Component %' },
  { key: 'refund_right', label: 'Refund / Return Rights' },
  { key: 'recognition_timing', label: 'Recognition Timeline' },
  { key: 'historical_attainment', label: 'Historical Attainment' },
  { key: 'external_dependency', label: 'External Dependencies' },
];

type VC1556Factors = {
  susceptible_to_external: boolean;
  long_resolution_period: boolean;
  wide_range_of_outcomes: boolean;
  limited_experience: boolean;
  broad_price_concession_practice: boolean;
};

const DEFAULT_VC1556: VC1556Factors = {
  susceptible_to_external: false,
  long_resolution_period: false,
  wide_range_of_outcomes: false,
  limited_experience: false,
  broad_price_concession_practice: false,
};

function applyVc1556Preview(estimatedVc: number, factors: VC1556Factors) {
  const score = Object.values(factors).filter(Boolean).length;
  let risk: string;
  let inclusion: number;
  if (score <= 1) {
    risk = 'Low';
    inclusion = 1;
  } else if (score === 2) {
    risk = 'Medium';
    inclusion = 0.75;
  } else if (score === 3) {
    risk = 'High';
    inclusion = 0.5;
  } else {
    risk = 'Very High';
    inclusion = 0;
  }
  const constrained = Math.round(estimatedVc * inclusion * 100) / 100;
  const excluded = Math.round((estimatedVc - constrained) * 100) / 100;
  return { score, risk, constrained, excluded };
}

type WarrantyPreviewInput = {
  required_by_law: boolean;
  covers_specs_only: boolean;
  customer_can_purchase_separately: boolean;
  provides_additional_service: boolean;
  warranty_period_months: number;
};

function computeWarrantyPreview(d: WarrantyPreviewInput): 'ASSURANCE' | 'SERVICE' | 'JUDGEMENT_REQUIRED' {
  if (d.required_by_law && d.covers_specs_only) return 'ASSURANCE';
  if (d.customer_can_purchase_separately || d.provides_additional_service) return 'SERVICE';
  if (!d.covers_specs_only && d.warranty_period_months > 24) return 'SERVICE';
  if (d.covers_specs_only) return 'ASSURANCE';
  return 'JUDGEMENT_REQUIRED';
}

function WarYesNo(props: {
  label: string;
  sub?: string;
  value: boolean;
  onPick: (v: boolean) => void;
  yesExtra?: string;
}) {
  const { label, sub, value, onPick, yesExtra } = props;
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold text-text-primary">{label}</p>
      {sub ? <p className="text-[11px] text-text-muted leading-snug">{sub}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onPick(true)}
          className={`px-3 py-1.5 rounded text-xs font-semibold border transition-colors ${
            value ? 'bg-orange-primary text-white border-orange-primary' : 'bg-white border-border-default text-text-secondary'
          }`}
        >
          YES{yesExtra ? ` ${yesExtra}` : ''}
        </button>
        <button
          type="button"
          onClick={() => onPick(false)}
          className={`px-3 py-1.5 rounded text-xs font-semibold border transition-colors ${
            !value ? 'bg-slate-600 text-white border-slate-600' : 'bg-white border-border-default text-text-secondary'
          }`}
        >
          NO
        </button>
      </div>
    </div>
  );
}

function BahMetFailed(props: {
  label: string;
  sub?: string;
  met: boolean;
  onPick: (met: boolean) => void;
}) {
  const { label, sub, met, onPick } = props;
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold text-text-primary">{label}</p>
      {sub ? <p className="text-[11px] text-text-muted leading-snug">{sub}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onPick(true)}
          className={`px-3 py-1.5 rounded text-xs font-semibold border transition-colors ${
            met ? 'bg-green-600 text-white border-green-600' : 'bg-white border-border-default text-text-secondary'
          }`}
        >
          ✓ MET
        </button>
        <button
          type="button"
          onClick={() => onPick(false)}
          className={`px-3 py-1.5 rounded text-xs font-semibold border transition-colors ${
            !met ? 'bg-red-600 text-white border-red-600' : 'bg-white border-border-default text-text-secondary'
          }`}
        >
          ✗ FAILED
        </button>
      </div>
    </div>
  );
}

function financingSpanMonths(transfer: string, payment: string): number {
  const tr = (transfer || '').trim().slice(0, 10);
  const py = (payment || '').trim().slice(0, 10);
  if (!tr || !py) return 0;
  const t = new Date(`${tr}T12:00:00`);
  const p = new Date(`${py}T12:00:00`);
  if (Number.isNaN(t.getTime()) || Number.isNaN(p.getTime())) return 0;
  const early = t.getTime() <= p.getTime() ? t : p;
  const late = t.getTime() <= p.getTime() ? p : t;
  const months = (late.getFullYear() - early.getFullYear()) * 12 + (late.getMonth() - early.getMonth());
  const days = late.getDate() - early.getDate();
  return Math.max(0, months + (days > 0 ? 1 : 0));
}

function financingPreviewPv(nominal: number, months: number, ratePct: number) {
  if (months <= 12 || nominal <= 0) {
    return { expedient: true, pv: nominal, financing: 0 };
  }
  const y = months / 12;
  const r = Math.max(ratePct, 0) / 100;
  if (r <= 0) return { expedient: false, pv: nominal, financing: 0 };
  const pv = Math.round((nominal / (1 + r) ** y) * 100) / 100;
  const financing = Math.round((nominal - pv) * 100) / 100;
  return { expedient: false, pv, financing };
}

function cpPayablePreview(amount: number, distinctBenefit: boolean, fvBenefit: number) {
  const amt = Math.max(Number(amount) || 0, 0);
  const fv = Math.max(Number(fvBenefit) || 0, 0);
  if (!distinctBenefit) {
    return { kind: 'REVENUE_REDUCTION' as const, revenueRed: amt, cost: 0 };
  }
  if (fv >= amt) {
    return { kind: 'COST_FULL' as const, revenueRed: 0, cost: amt };
  }
  return { kind: 'SPLIT' as const, revenueRed: Math.round((amt - fv) * 100) / 100, cost: fv };
}

// Map extraction to calculate request
function mapExtractionToContract(extracted: any): any {
  const step1 = extracted?.step1_identify_contract?.contract_details || {};
  const rawObligations = extracted?.step2_performance_obligations?.identified_obligations;
  const obligations = Array.isArray(rawObligations) ? rawObligations : [];
  const step3 = extracted?.step3_transaction_price || {};
  const rawStep5 = extracted?.step5_recognition?.obligations_recognition_timing;
  const step5 = Array.isArray(rawStep5) ? rawStep5 : [];

  const recognitionMap: Record<string, any> = {};
  step5.forEach((r: any) => { recognitionMap[r.obligation_id] = r; });

  const perfObs = obligations.map((ob: any) => {
    const rec = recognitionMap[ob.obligation_id] || {};
    return {
      obligation_id: ob.obligation_id || `PO-${obligations.indexOf(ob) + 1}`,
      description: ob.description || 'Unnamed obligation',
      standalone_selling_price: ob.standalone_selling_price_estimate ?? 0,
      recognition_method: rec.recognition_pattern === 'point_in_time' ? 'point_in_time' : 'over_time',
      duration_months: rec.duration_months ?? 12,
      transfer_date: rec.transfer_date || null,
    };
  });

  const varCons = step3.variable_consideration || {};
  const fixed = step3.fixed_consideration ?? step3.total_transaction_price ?? step1.total_contract_value ?? 0;
  const variable = (varCons.performance_bonuses ?? 0) + (varCons.volume_discounts ?? 0) - (varCons.discounts ?? 0) - (varCons.rebates ?? 0) - (varCons.penalties ?? 0);
  const totalPrice = step3.total_transaction_price ?? step1.total_contract_value ?? fixed;

  return {
    contract_id: step1.contract_id || `CONTRACT-${Date.now()}`,
    customer_name: step1.customer_name || '',
    vendor_name: step1.vendor_name || '',
    effective_date: step1.effective_date || new Date().toISOString().split('T')[0],
    contract_term_months: step1.contract_term_months ?? 12,
    fixed_consideration: typeof fixed === 'number' ? fixed : parseFloat(String(fixed)) || 0,
    variable_consideration: typeof variable === 'number' ? variable : parseFloat(String(variable)) || 0,
    variable_consideration_constrained: varCons.variable_consideration_constrained ?? 0,
    constraint_percentage: varCons.constraint_percentage ?? 100,
    constraint_method: varCons.constraint_method ?? 'percentage',
    discounts: varCons.discounts ?? 0,
    rebates: varCons.rebates ?? 0,
    financing_adjustment: step3.significant_financing_component?.adjustment_amount ?? 0,
    currency: sanitizeCurrencyCode(step1.currency, 'USD'),
    contract_type: 'fixed_price',
    hourly_rate: 0,
    hours_worked: 0,
    tm_cap: 0,
    cumulative_billed: 0,
    total_estimated_cost: 0,
    actual_cost_to_date: 0,
    prior_revenue_recognised: 0,
    maintenance_term_months: 0,
    volume_slabs: [],
    estimated_annual_volume: 0,
    can_estimate_volume: true,
    sla_items: [],
    cash_received: 0,
    payment_terms: String(
      (extracted as any)?.step1_identify_contract?.contract_details?.payment_terms ??
        (extracted as any)?.step3_transaction_price?.payment_timing ??
        ''
    ),
    performance_obligations: perfObs.length ? perfObs : [{
      obligation_id: 'PO-1',
      description: 'Revenue',
      standalone_selling_price: totalPrice,
      recognition_method: 'over_time',
      duration_months: step1.contract_term_months ?? 12,
      transfer_date: null,
    }],
  };
}

function ifrs15ScheduleRowStatus(row: Record<string, unknown>): 'Recognised' | 'Deferred' {
  const raw = String(row?.Status ?? row?.status ?? '');
  const low = raw.toLowerCase();
  if (low.includes('defer')) return 'Deferred';
  if (low.includes('recogn')) return 'Recognised';
  const rev = Number(row?.Revenue ?? row?.revenue ?? 0);
  return rev > 0 ? 'Recognised' : 'Deferred';
}

/** Obligation-level status from API or pct (schedule rows stay Recognised/Deferred only). */
function ifrs15PoRecognitionStatus(p: Record<string, unknown>): string {
  const explicit = p.recognition_status ?? p.recognitionStatus;
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();
  const allocP = Number(p.allocated_amount ?? 0);
  const recAmt = Number(p.recognised_to_date ?? p.revenue_recognized ?? 0);
  if (allocP < 1e-6) return 'Deferred';
  if (recAmt <= 0.01) return 'Deferred';
  if (recAmt >= allocP - 0.01) return 'Recognised';
  return 'Partially Recognised';
}

function ifrs15PoStatusBadgeClass(status: string): string {
  if (status === 'Recognised') return 'bg-green-100 text-green-700';
  if (status === 'Partially Recognised') return 'bg-orange-100 text-orange-800';
  return 'bg-amber-100 text-amber-700';
}

function ifrs15ScheduleDisplayAmount(row: Record<string, unknown>): number {
  return Number(row?.Scheduled_Revenue ?? row?.scheduled_revenue ?? row?.Revenue ?? row?.revenue ?? 0) || 0;
}

function ifrs15PoProgressBarClass(pct: number): string {
  if (pct >= 100) return 'bg-emerald-500';
  if (pct >= 75) return 'bg-orange-400';
  if (pct >= 50) return 'bg-yellow-400';
  return 'bg-red-500';
}

function addMonthsIso(isoDate: string, months: number): string {
  const base = isoDate?.trim() || new Date().toISOString().slice(0, 10);
  const d = new Date(base.includes('T') ? base : `${base}T12:00:00`);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  d.setMonth(d.getMonth() + Math.max(0, Math.floor(months)));
  return d.toISOString().slice(0, 10);
}

function clauseTypeBadgeClass(clauseType: string): string {
  const m: Record<string, string> = {
    FREE_PERIOD: 'bg-purple-100 text-purple-900 border-purple-300',
    REFUND_RIGHT: 'bg-red-100 text-red-900 border-red-300',
    PRICE_CAP: 'bg-yellow-100 text-yellow-900 border-yellow-300',
    PRICE_ESCALATION: 'bg-orange-100 text-orange-900 border-orange-300',
    IMPLICIT_PROMISE: 'bg-blue-100 text-blue-900 border-blue-300',
    CUSTOMER_OPTION: 'bg-teal-100 text-teal-900 border-teal-300',
    VARIABLE_USAGE: 'bg-orange-100 text-orange-900 border-orange-300',
    PENALTY_CLAUSE: 'bg-red-100 text-red-900 border-red-300',
    EXTENDED_PAYMENT: 'bg-yellow-100 text-yellow-900 border-yellow-300',
    LICENCE_RESTRICTION: 'bg-gray-100 text-gray-800 border-gray-300',
    PRINCIPAL_AGENT_INDICATOR: 'bg-indigo-100 text-indigo-950 border-indigo-300',
    CANCELLATION_RIGHT: 'bg-orange-100 text-orange-900 border-orange-300',
  };
  return m[clauseType] || 'bg-gray-100 text-gray-800 border-gray-300';
}

function severityPillClass(sev: string): string {
  const u = (sev || '').toUpperCase();
  if (u === 'HIGH') return 'bg-red-600 text-white';
  if (u === 'MEDIUM') return 'bg-orange-500 text-white';
  if (u === 'LOW') return 'bg-yellow-400 text-yellow-950';
  return 'bg-gray-200 text-gray-800';
}

type Rpo120Pattern = 'within_1_year' | '1_to_2_years' | '2_to_5_years' | 'beyond_5_years';

type Rpo120PoForm = {
  id: string;
  name: string;
  allocated_amount: number;
  recognised_to_date: number;
  expected_recognition_pattern: Rpo120Pattern;
  recognition_type: 'over_time' | 'point_in_time';
};

type Rpo120ContractForm = {
  id: string;
  contract_id: string;
  customer_name: string;
  contract_start: string;
  contract_end: string;
  total_transaction_price: number;
  revenue_recognised_to_date: number;
  practical_expedient_applied: boolean;
  performance_obligations: Rpo120PoForm[];
};

function newUid(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

function newRpo120Po(): Rpo120PoForm {
  return {
    id: newUid(),
    name: '',
    allocated_amount: 0,
    recognised_to_date: 0,
    expected_recognition_pattern: 'within_1_year',
    recognition_type: 'over_time',
  };
}

function newRpo120Contract(): Rpo120ContractForm {
  return {
    id: newUid(),
    contract_id: '',
    customer_name: '',
    contract_start: '',
    contract_end: '',
    total_transaction_price: 0,
    revenue_recognised_to_date: 0,
    practical_expedient_applied: false,
    performance_obligations: [newRpo120Po()],
  };
}

type PaExtHistoryRow = {
  id: string;
  arrangement_id: string;
  description: string;
  gross_contract_value: number;
  third_party_cost: number;
  assessment: Record<string, unknown>;
};

export default function IFRS15Page() {
  const [activeTab, setActiveTab] = useState<'upload' | 'manual'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);
  const [isGeneratingExcel, setIsGeneratingExcel] = useState(false);
  const [extractedData, setExtractedData] = useState<any>(null);
  const [results, setResults] = useState<any>(null);
  const [fileId, setFileId] = useState<string | null>(null);
  const [activeModule, setActiveModule] = useState<string | null>(null);
  const [contractText, setContractText] = useState('');
  const [vcConstraint, setVcConstraint] = useState({
    constraint_method: 'percentage',
    constraint_percentage: 100,
    variable_consideration_constrained: 0,
  });
  const [vc1556Factors, setVc1556Factors] = useState<VC1556Factors>({ ...DEFAULT_VC1556 });
  const [ifrs15DashTab, setIfrs15DashTab] = useState<
    | 'portfolio'
    | 'calculate'
    | 'deferred-rev'
    | 'rpo'
    | 'principal-agent'
    | 'contract-costs'
    | 'licenses-ip'
    | 'audit-trail'
    | 'material-rights'
    | 'warranties'
    | 'bill-and-hold'
    | 'financing-component'
    | 'tp-adjustments'
  >('calculate');
  const [drForm, setDrForm] = useState({
    period: '',
    currency: 'USD',
    opening_balance: 0,
    new_bookings: 0,
    revenue_released: 0,
    cancellations: 0,
    modifications_impact: 0,
    fx_impact: 0,
    gl_closing_balance: 0,
  });
  const [drResultsStack, setDrResultsStack] = useState<Record<string, unknown>[]>([]);
  const [drLoading, setDrLoading] = useState(false);
  const [lastContractInfo, setLastContractInfo] = useState<{ contract_id?: string; customer_name?: string; effective_date?: string; contract_term_months?: number; currency?: string }>({});
  const [scheduleViewAll, setScheduleViewAll] = useState(false);
  const [showSLA, setShowSLA] = useState(false);
  const [showVolumeDiscount, setShowVolumeDiscount] = useState(false);
  const [openDisclosureCard, setOpenDisclosureCard] = useState<string | null>('accounting-policy');
  const [disclosureText, setDisclosureText] = useState('');
  const [disclosureScore, setDisclosureScore] = useState<Record<string, unknown> | null>(null);
  const [disclosureLoading, setDisclosureLoading] = useState(false);
  const [disclosureScoreOpen, setDisclosureScoreOpen] = useState(false);
  const [expandedDisclosureCriterion, setExpandedDisclosureCriterion] = useState<string | null>(null);
  const [expandedDisclosureImprovement, setExpandedDisclosureImprovement] = useState<number | null>(null);
  const [showModificationSection, setShowModificationSection] = useState(false);
  const [modForm, setModForm] = useState({
    modification_date: new Date().toISOString().split('T')[0],
    modification_description: '',
    price_change: 0,
    remaining_transaction_price: 0,
    new_goods_csv: '',
    remaining_po_csv: '',
  });
  const [modAssessment, setModAssessment] = useState<any>(null);
  const [modificationHistory, setModificationHistory] = useState<
    Array<{ id: string; modification_date: string; typeLabel: string; description: string; modification: any }>
  >([]);
  const [isAssessingModification, setIsAssessingModification] = useState(false);
  const [showVcSection, setShowVcSection] = useState(false);
  const [vcMethod, setVcMethod] = useState<'expected_value' | 'scenario_weighted' | 'most_likely'>('expected_value');
  const [vcScenarios, setVcScenarios] = useState([
    { outcome: 'Base Case', amount: '', probPct: '50' },
    { outcome: 'Upside', amount: '', probPct: '50' },
  ]);
  const [vcConstraintFactors, setVcConstraintFactors] = useState([false, false, false, false, false]);
  const [vcResult, setVcResult] = useState<Record<string, unknown> | null>(null);
  const [vcAssessment, setVcAssessment] = useState<Record<string, unknown> | null>(null);
  const [vcMostLikelyIdx, setVcMostLikelyIdx] = useState(0);
  const [vcMostLikelyManual, setVcMostLikelyManual] = useState(false);
  const [isCalculatingVc, setIsCalculatingVc] = useState(false);
  const [reversalRisk, setReversalRisk] = useState<Record<string, unknown> | null>(null);
  const [isReversalRiskLoading, setIsReversalRiskLoading] = useState(false);
  const [reversalCustomerType, setReversalCustomerType] = useState('mid_market');
  const [reversalRefundType, setReversalRefundType] = useState('none');
  const [reversalHistoricalPct, setReversalHistoricalPct] = useState('');
  const [reversalExtDep, setReversalExtDep] = useState(false);
  const [reversalDepLevel, setReversalDepLevel] = useState<'low' | 'medium' | 'high'>('low');
  const [showRpoSection, setShowRpoSection] = useState(false);
  const [rpoFormRows, setRpoFormRows] = useState<
    Array<{
      obligation_name: string;
      allocated_amount: number;
      recognised_to_date: number | string;
      expected_end_date: string;
      original_expected_duration_months?: number;
      is_right_to_invoice?: boolean;
    }>
  >([]);
  const [rpoResult, setRpoResult] = useState<Record<string, unknown> | null>(null);
  const [rpoAssessment, setRpoAssessment] = useState<Record<string, unknown> | null>(null);
  const [isRpoLoading, setIsRpoLoading] = useState(false);
  const [showCcSection, setShowCcSection] = useState(false);
  const [ccCommission, setCcCommission] = useState('');
  const [ccTerm, setCcTerm] = useState('');
  const [ccTotalValue, setCcTotalValue] = useState('');
  const [ccResult, setCcResult] = useState<Record<string, unknown> | null>(null);
  const [ccAssessment, setCcAssessment] = useState<Record<string, unknown> | null>(null);
  const [isCcLoading, setIsCcLoading] = useState(false);
  const [ccScheduleExpand, setCcScheduleExpand] = useState(false);
  const [showPaSection, setShowPaSection] = useState(false);
  const [paObtains, setPaObtains] = useState(false);
  const [paSetsPrice, setPaSetsPrice] = useState(false);
  const [paPrimary, setPaPrimary] = useState(false);
  const [paTp, setPaTp] = useState('');
  const [paCost, setPaCost] = useState('');
  const [paResult, setPaResult] = useState<Record<string, unknown> | null>(null);
  const [paAssessment, setPaAssessment] = useState<Record<string, unknown> | null>(null);
  const [isPaLoading, setIsPaLoading] = useState(false);
  const [rpo120Contracts, setRpo120Contracts] = useState<Rpo120ContractForm[]>([]);
  const [rpo120Result, setRpo120Result] = useState<Record<string, unknown> | null>(null);
  const [rpo120Loading, setRpo120Loading] = useState(false);
  const [rpo120Expanded, setRpo120Expanded] = useState<Record<string, boolean>>({});
  const [paExtHistory, setPaExtHistory] = useState<PaExtHistoryRow[]>([]);
  const [paExtForm, setPaExtForm] = useState({
    arrangement_id: '',
    description: '',
    gross_contract_value: 0,
    third_party_cost: 0,
    controls_before_transfer: false,
    primary_obligor: false,
    inventory_risk: false,
    pricing_discretion: false,
    credit_risk: false,
  });
  const [paExtLoading, setPaExtLoading] = useState(false);
  const [paExtLatest, setPaExtLatest] = useState<Record<string, unknown> | null>(null);
  const [paHistOpen, setPaHistOpen] = useState<Record<string, boolean>>({});
  type CcFormRow = {
    id: string;
    cost_id: string;
    contract_id: string;
    description: string;
    cost_type: string;
    cost_amount: number;
    incurred_date: string;
    contract_start: string;
    contract_end: string;
    expected_renewal: boolean;
    expected_renewal_months: number;
    currency: string;
  };
  const [ccRows, setCcRows] = useState<CcFormRow[]>([]);
  const [ccBatchResult, setCcBatchResult] = useState<Record<string, unknown> | null>(null);
  const [ccBatchLoading, setCcBatchLoading] = useState(false);
  const [ccSchedExpand, setCcSchedExpand] = useState<Record<string, boolean>>({});
  type LicFormRow = {
    id: string;
    license_id: string;
    product_name: string;
    license_description: string;
    license_fee: number;
    license_start: string;
    license_end: string;
    is_perpetual: boolean;
    entity_activities_affect_ip: boolean;
    customer_exposed_to_effect: boolean;
    no_separate_functional_utility: boolean;
    currency: string;
  };
  const [licRows, setLicRows] = useState<LicFormRow[]>([]);
  const [licIpResult, setLicIpResult] = useState<Record<string, unknown> | null>(null);
  const [licIpLoading, setLicIpLoading] = useState(false);
  const [licSchedExpand, setLicSchedExpand] = useState<Record<string, boolean>>({});
  const [auditEntries, setAuditEntries] = useState<Record<string, unknown>[]>([]);
  const [auditPending, setAuditPending] = useState(0);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditExcelLoading, setAuditExcelLoading] = useState(false);
  type MrFormRow = {
    id: string;
    option_id: string;
    contract_id: string;
    description: string;
    option_type: string;
    original_contract_value: number;
    original_ssp: number;
    option_price: number;
    option_ssp: number;
    exercise_probability_pct: number;
    currency: string;
  };
  const [mrRows, setMrRows] = useState<MrFormRow[]>([]);
  const [mrResult, setMrResult] = useState<Record<string, unknown> | null>(null);
  const [mrLoading, setMrLoading] = useState(false);
  const [mrJeTab, setMrJeTab] = useState<Record<string, 'inception' | 'exercised' | 'expired'>>({});
  type WarFormRow = {
    id: string;
    warranty_id: string;
    contract_id: string;
    product_description: string;
    warranty_description: string;
    warranty_period_months: number;
    warranty_value: number;
    allocated_fee: number;
    required_by_law: boolean;
    covers_specs_only: boolean;
    customer_can_purchase_separately: boolean;
    provides_additional_service: boolean;
    currency: string;
  };
  const [warRows, setWarRows] = useState<WarFormRow[]>([]);
  const [warResult, setWarResult] = useState<Record<string, unknown> | null>(null);
  const [warLoading, setWarLoading] = useState(false);
  type BahFormRow = {
    id: string;
    arrangement_id: string;
    contract_id: string;
    customer_name: string;
    product_description: string;
    contract_value: number;
    billing_date: string;
    expected_delivery_date: string;
    reason_is_substantive: boolean;
    product_separately_identified: boolean;
    product_ready_for_transfer: boolean;
    entity_cannot_redirect: boolean;
    currency: string;
  };
  const [bahRows, setBahRows] = useState<BahFormRow[]>([]);
  const [bahResult, setBahResult] = useState<Record<string, unknown> | null>(null);
  const [bahLoading, setBahLoading] = useState(false);
  type FcFormRow = {
    id: string;
    contract_id: string;
    description: string;
    contract_value: number;
    transfer_date: string;
    payment_date: string;
    payment_timing: 'advance' | 'deferred';
    discount_rate: number;
    currency: string;
  };
  const [fcRows, setFcRows] = useState<FcFormRow[]>([]);
  const [fcResult, setFcResult] = useState<Record<string, unknown> | null>(null);
  const [fcLoading, setFcLoading] = useState(false);
  const [fcSchedExpand, setFcSchedExpand] = useState<Record<string, boolean>>({});
  type TpNcFormRow = {
    id: string;
    item_id: string;
    contract_id: string;
    description: string;
    consideration_type: string;
    fv_unreliable: boolean;
    fair_value: number;
    fallback_ssp: number;
    currency: string;
  };
  type TpCpFormRow = {
    id: string;
    item_id: string;
    contract_id: string;
    description: string;
    payment_type: string;
    amount: number;
    distinct_benefit_received: boolean;
    fair_value_of_benefit: number;
    currency: string;
  };
  const [tpAdjPanel, setTpAdjPanel] = useState<'non-cash' | 'payable' | 'tp-change'>('non-cash');
  const [tpChangeForm, setTpChangeForm] = useState({
    contract_id: '',
    adjustment_reason: 'variable_consideration',
    original_transaction_price: '',
    new_transaction_price: '',
    revenue_recognised_to_date: '',
    remaining_performance_obligations: '1',
    adjustment_method: 'cumulative_catchup',
  });
  const [tpChangeResult, setTpChangeResult] = useState<Record<string, unknown> | null>(null);
  const [tpChangeLoading, setTpChangeLoading] = useState(false);
  const [ncRows, setNcRows] = useState<TpNcFormRow[]>([]);
  const [cpRows, setCpRows] = useState<TpCpFormRow[]>([]);
  const [tpAdjResult, setTpAdjResult] = useState<Record<string, unknown> | null>(null);
  const [tpAdjLoading, setTpAdjLoading] = useState(false);
  const [portfolioContracts, setPortfolioContracts] = useState<Record<string, unknown>[]>([]);
  const [portfolioSummaryApi, setPortfolioSummaryApi] = useState<Record<string, unknown>>({});
  const [portfolioLoading, setPortfolioLoading] = useState(false);
  const [portfolioSaving, setPortfolioSaving] = useState(false);
  const [portfolioExcelLoading, setPortfolioExcelLoading] = useState(false);
  const [portfolioTableFilter, setPortfolioTableFilter] = useState<'all' | 'active' | 'at_risk' | 'churned'>('all');
  const [portfolioPage, setPortfolioPage] = useState(1);
  const [portfolioAddOpen, setPortfolioAddOpen] = useState(false);
  const [portfolioAddForm, setPortfolioAddForm] = useState({
    contract_id: '',
    customer_name: '',
    contract_type: 'subscription',
    arr: 0,
    mrr: 0,
    start_date: '',
    end_date: '',
    total_tp: 0,
    recognised_to_date: 0,
    deferred_balance: 0,
    rpo_amount: 0,
    status: 'active',
    currency: 'USD',
  });
  const [auditFilterContract, setAuditFilterContract] = useState('');
  const [auditFilterAction, setAuditFilterAction] = useState('');
  const [auditExpanded, setAuditExpanded] = useState<Record<string, boolean>>({});
  const [signOffEntryId, setSignOffEntryId] = useState<string | null>(null);
  const [signOffReviewer, setSignOffReviewer] = useState('');
  const [signOffNotes, setSignOffNotes] = useState('');
  const [showLicSection, setShowLicSection] = useState(false);
  const [licA, setLicA] = useState<boolean | null>(null);
  const [licB, setLicB] = useState<boolean | null>(null);
  const [licC, setLicC] = useState<boolean | null>(null);
  const [licPrice, setLicPrice] = useState('');
  const [licTerm, setLicTerm] = useState('');
  const [licStart, setLicStart] = useState('');
  const [licRoyalty, setLicRoyalty] = useState(false);
  const [licResult, setLicResult] = useState<Record<string, unknown> | null>(null);
  const [licAssessment, setLicAssessment] = useState<Record<string, unknown> | null>(null);
  const [isLicLoading, setIsLicLoading] = useState(false);
  const [masterReport, setMasterReport] = useState<Record<string, unknown> | null>(null);
  const [masterModalOpen, setMasterModalOpen] = useState(false);
  const [masterTab, setMasterTab] = useState(0);
  const [isMasterLoading, setIsMasterLoading] = useState(false);
  const [isMasterExcelLoading, setIsMasterExcelLoading] = useState(false);
  const [isClientReportModalOpen, setIsClientReportModalOpen] = useState(false);
  const [isGeneratingClientReport, setIsGeneratingClientReport] = useState(false);
  const [clientReportPreparedFor, setClientReportPreparedFor] = useState('');
  const [clientReportPreparedBy, setClientReportPreparedBy] = useState('IFRS AI');
  const [clientReportIncludeQa, setClientReportIncludeQa] = useState(true);
  const [clauseDetection, setClauseDetection] = useState<Record<string, unknown> | null>(null);
  const [clauseAcknowledged, setClauseAcknowledged] = useState<Record<number, boolean>>({});
  const [clauseRowDetailOpen, setClauseRowDetailOpen] = useState<Record<number, boolean>>({});
  const [clauseBannerExpanded, setClauseBannerExpanded] = useState(false);
  const [clauseCleanKeepVisible, setClauseCleanKeepVisible] = useState(false);
  const [slaItems, setSlaItems] = useState<any[]>([]);
  const [volumeSlabs, setVolumeSlabs] = useState<any[]>([]);
  const [step3, setStep3] = useState<any>({
    contract_type: 'fixed_price',
    payment_terms: '',
    hourly_rate: '',
    hours_worked: '',
    tm_cap: '',
    cumulative_billed: '',
    total_estimated_cost: '',
    actual_cost_to_date: '',
    prior_revenue_recognised: '',
    maintenance_term_months: '',
    estimated_annual_volume: '',
    can_estimate_volume: true,
  });
  const updateStep3 = (patch: Record<string, any>) => {
    setStep3((prev: any) => ({ ...prev, ...patch }));
  };
  const addSLAItem = () => {
    setSlaItems((prev) => [...prev, { name: '', target: '', actual: '', monthly_fee: '', penalty_multiplier: 1 }]);
  };
  const addVolumeSlab = () => {
    setVolumeSlabs((prev) => [...prev, { min_volume: '', max_volume: '', discount_pct: '' }]);
  };

  const step1 = extractedData?.step1_identify_contract?.contract_details || {};
  const extractedVarCons = extractedData?.step3_transaction_price?.variable_consideration || {};
  const extractedVariableAmount =
    (Number(extractedVarCons.performance_bonuses ?? 0) + Number(extractedVarCons.volume_discounts ?? 0))
    - Number(extractedVarCons.discounts ?? 0)
    - Number(extractedVarCons.rebates ?? 0)
    - Number(extractedVarCons.penalties ?? 0);
  const vc1556ExtractionPreview = applyVc1556Preview(Number(extractedVariableAmount) || 0, vc1556Factors);
  const applyClauseDetectionFromResponse = (cd: Record<string, unknown> | null | undefined) => {
    setClauseAcknowledged({});
    setClauseRowDetailOpen({});
    setClauseCleanKeepVisible(false);
    if (!cd) {
      setClauseDetection(null);
      setClauseBannerExpanded(false);
      return;
    }
    setClauseDetection(cd);
    const risk = String(cd.overall_risk || '').toUpperCase();
    if (risk === 'LOW') setClauseBannerExpanded(false);
    else if (risk === 'MEDIUM' || risk === 'HIGH') setClauseBannerExpanded(true);
    else setClauseBannerExpanded(false);
  };

  useEffect(() => {
    if (!clauseDetection || clauseCleanKeepVisible) return;
    if (String(clauseDetection.overall_risk || '').toUpperCase() !== 'CLEAN') return;
    const t = window.setTimeout(() => {
      setClauseDetection(null);
    }, 5000);
    return () => window.clearTimeout(t);
  }, [clauseDetection, clauseCleanKeepVisible]);

  const stepStatus = {
    step1: !!extractedData?.step1_identify_contract,
    step2: !!(extractedData?.step2_performance_obligations?.identified_obligations?.length),
    step3: !!extractedData?.step3_transaction_price?.total_transaction_price,
    step4: !!(extractedData?.step4_allocation_hints || extractedData?.step2_performance_obligations?.identified_obligations?.length),
    step5: !!results,
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) {
      setFile(null);
      return;
    }
    if (!selectedFile.name.match(/\.(pdf|docx|txt|xlsx|xls)$/i)) {
      toast.error('Please upload a PDF, DOCX, TXT, or Excel file (.xlsx, .xls)');
      setFile(null);
      return;
    }
    setFile(selectedFile);
    setIsUploading(true);
    setExtractedData(null);
    applyClauseDetectionFromResponse(null);
    try {
      const response = await ifrs15Api.uploadContract(selectedFile) as any;
      const { data, error } = response;
      if (error) throw new Error(error);
      setExtractedData(data?.extracted_data);
      if (data?.clause_detection) {
        applyClauseDetectionFromResponse(data.clause_detection as Record<string, unknown>);
      }
      const vc = data?.extracted_data?.step3_transaction_price?.variable_consideration || {};
      setVcConstraint({
        constraint_method: vc.constraint_method ?? 'percentage',
        constraint_percentage: Number(vc.constraint_percentage ?? 100),
        variable_consideration_constrained: Number(vc.variable_consideration_constrained ?? 0),
      });
      toast.success('Contract extracted successfully!');
    } catch (error: any) {
      toast.error(error?.message || 'Failed to extract contract');
      setFile(null);
    } finally {
      setIsUploading(false);
    }
  };

  const handleCalculate = async (contractData?: any) => {
    const basePayload = contractData || (extractedData ? mapExtractionToContract(extractedData) : null);
    const payload = basePayload
      ? {
          ...basePayload,
          constraint_method: vcConstraint.constraint_method,
          constraint_percentage: vcConstraint.constraint_percentage,
          variable_consideration_constrained: vcConstraint.variable_consideration_constrained,
          vc_constraint_factors: { ...vc1556Factors },
          contract_type: step3.contract_type || 'fixed_price',
          hourly_rate: Number(step3.hourly_rate || 0),
          hours_worked: Number(step3.hours_worked || 0),
          tm_cap: Number(step3.tm_cap || 0),
          cumulative_billed: Number(step3.cumulative_billed || 0),
          total_estimated_cost: Number(step3.total_estimated_cost || 0),
          actual_cost_to_date: Number(step3.actual_cost_to_date || 0),
          prior_revenue_recognised: Number(step3.prior_revenue_recognised || 0),
          maintenance_term_months: Number(step3.maintenance_term_months || 0),
          volume_slabs: volumeSlabs.map((s) => ({
            min_volume: Number(s.min_volume || 0),
            max_volume: Number(s.max_volume || 0),
            discount_pct: Number(s.discount_pct || 0),
          })),
          estimated_annual_volume: Number(step3.estimated_annual_volume || 0),
          can_estimate_volume: Boolean(step3.can_estimate_volume),
          sla_items: slaItems.map((s) => ({
            name: s.name || '',
            target: Number(s.target || 0),
            actual: Number(s.actual || 0),
            monthly_fee: Number(s.monthly_fee || 0),
            penalty_multiplier: Number(s.penalty_multiplier || 1),
          })),
          payment_terms: String(
            (basePayload as any).payment_terms ??
              step3.payment_terms ??
              (extractedData as any)?.step1_identify_contract?.contract_details?.payment_terms ??
              ''
          ).trim(),
        }
      : null;
    if (!payload || !payload.performance_obligations?.length) {
      toast.error('No contract data. Upload a contract or enter manually.');
      return;
    }
    setIsCalculating(true);
    try {
      const response = await ifrs15Api.calculate(payload) as any;
      console.log('IFRS 15 calculate full API response:', response);
      const { data, error } = response;
      if (error) throw new Error(error);
      setResults(data?.results);
      setVcResult(null);
      setVcAssessment(null);
      setRpoResult(null);
      setRpoAssessment(null);
      setCcResult(null);
      setCcAssessment(null);
      setPaResult(null);
      setPaAssessment(null);
      setLicResult(null);
      setLicAssessment(null);
      setMasterReport(null);
      setMasterModalOpen(false);
      setModForm((prev) => ({
        ...prev,
        remaining_transaction_price: Number(
          data?.results?.total_deferred ?? data?.results?.contract_balances?.contract_liability_amount ?? 0
        ),
      }));
      setFileId(data?.excel_file_id || null);
      setLastContractInfo({
        contract_id: payload.contract_id,
        customer_name: payload.customer_name,
        effective_date: payload.effective_date,
        contract_term_months: payload.contract_term_months,
        currency: sanitizeCurrencyCode(payload.currency, 'USD'),
      });
      toast.success('Calculation completed!');
    } catch (error: any) {
      toast.error(error?.message || 'Calculation failed');
    } finally {
      setIsCalculating(false);
    }
  };

  const realestateSyncApplied = useRef(false);
  useEffect(() => {
    if (realestateSyncApplied.current) return;
    const payload = consumeRealEstateSyncPending();
    if (!payload) return;
    realestateSyncApplied.current = true;
    setIfrs15DashTab('calculate');
    setActiveTab('manual');
    const syncCurrency = sanitizeCurrencyCode(String(payload.currency || 'AED'), 'AED');
    updateStep3({
      contract_type: 'fixed_price',
      total_estimated_cost: String(payload.total_estimated_cost ?? ''),
      actual_cost_to_date: String(payload.actual_cost_to_date ?? ''),
      prior_revenue_recognised: String(payload.prior_revenue_recognised ?? ''),
      cumulative_billed: String(payload.cumulative_billed ?? ''),
    });
    const pos = (payload.performance_obligations as Record<string, unknown>[]) || [];
    setExtractedData({
      step1_identify_contract: {
        contract_details: {
          contract_id: payload.contract_id,
          customer_name: payload.customer_name,
          vendor_name: payload.vendor_name,
          effective_date: payload.effective_date,
          contract_term_months: payload.contract_term_months,
          total_contract_value: payload.fixed_consideration,
          currency: syncCurrency,
        },
      },
      step2_performance_obligations: {
        identified_obligations: pos.map((p, i) => ({
          obligation_id: p.obligation_id || `PO-${i + 1}`,
          description: p.description,
          standalone_selling_price_estimate: p.standalone_selling_price,
        })),
      },
      step3_transaction_price: {
        fixed_consideration: payload.fixed_consideration,
        total_transaction_price: payload.fixed_consideration,
      },
      _realestate_overlay: payload.realestate_overlay,
    });
    void handleCalculate({
      ...payload,
      realestate_overlay: payload.realestate_overlay,
      realestate_period_schedule: payload.realestate_period_schedule ?? [],
      currency: syncCurrency,
    });
    toast.success('Real estate recognition synced to IFRS 15 schedule');
  }, []);

  const moduleCards = [
    { id: 'contract-identification', name: 'Contract Identification', gradient: 'gradient-orange' },
    { id: 'performance-obligations', name: 'Performance Obligations', gradient: 'gradient-pink' },
    { id: 'transaction-price', name: 'Transaction Price', gradient: 'gradient-amber' },
    { id: 'price-allocation', name: 'Price Allocation', gradient: 'gradient-orange' },
    { id: 'revenue-recognition', name: 'Revenue Recognition', gradient: 'gradient-pink' },
    { id: 'contract-modifications', name: 'Contract Modifications', gradient: 'gradient-amber' },
    { id: 'disclosures', name: 'Disclosures', gradient: 'gradient-orange' },
  ];

  const disclosureData = results?.disclosure_data || {};
  const contractDetails = disclosureData?.contract_details || {};
  const disclosureNotes = results?.disclosure_notes || {};
  const currency = sanitizeCurrencyCode(
    contractDetails.currency || lastContractInfo.currency || step1.currency,
    (extractedData as { _realestate_overlay?: { currency?: string } })?._realestate_overlay?.currency
      ? 'AED'
      : 'USD'
  );
  const balances = results?.contract_balances || {};
  const schedule = Array.isArray(results?.revenue_schedule) ? results.revenue_schedule : [];
  const rawAllocations = results?.allocations;
  const allocations =
    rawAllocations && typeof rawAllocations === 'object' && !Array.isArray(rawAllocations)
      ? rawAllocations
      : {};
  const journalEntries = Array.isArray(results?.journal_entries) ? results.journal_entries : [];

  const contractId = contractDetails.contract_id || lastContractInfo.contract_id || step1.contract_id || '—';
  const customerName = contractDetails.customer || lastContractInfo.customer_name || step1.customer_name || '—';
  const contractDate = contractDetails.effective_date || lastContractInfo.effective_date || step1.effective_date || '—';
  const contractTerm = contractDetails.term_months ?? lastContractInfo.contract_term_months ?? step1.contract_term_months ?? '—';
  const rawPerfObs = results?.performance_obligations;
  const perfObs = Array.isArray(rawPerfObs) ? rawPerfObs : [];
  const tp = results?.total_contract_value;
  const rec = results?.total_recognised;
  const def = results?.total_deferred;
  const displayTp = typeof tp === 'number' ? Number(tp) : null;
  const effectiveRevenueRate = displayTp && typeof rec === 'number' && displayTp > 0 ? ((rec / displayTp) * 100).toFixed(1) : '—';
  const numPOBs = Object.keys(allocations).length || perfObs.length;
  const totalContractAssets = results?.total_contract_assets;
  const paymentTermsMode = String((results as Record<string, unknown> | null)?.payment_terms_mode ?? '');
  const contractAssetNoteStr = String((results as Record<string, unknown> | null)?.contract_asset_note ?? '');
  const tpNumForKpi = typeof displayTp === 'number' && !Number.isNaN(displayTp) ? displayTp : 0;
  const recNumForKpi = typeof rec === 'number' && !Number.isNaN(rec) ? rec : NaN;
  const defNumForKpi = typeof def === 'number' && !Number.isNaN(def) ? def : NaN;
  const deferredKpiShowsZero =
    !Number.isNaN(recNumForKpi) &&
    paymentTermsMode === 'advance' &&
    tpNumForKpi > 0 &&
    recNumForKpi + 0.01 >= tpNumForKpi;
  const deferredKpiText =
    !results || Number.isNaN(defNumForKpi)
      ? '—'
      : defNumForKpi > 0
        ? formatCurrency(defNumForKpi, currency, 0)
        : deferredKpiShowsZero
          ? formatCurrency(0, currency, 0)
          : '—';
  const deferredKpiClass =
    !results || Number.isNaN(defNumForKpi)
      ? 'text-2xl font-bold text-text-primary amount'
      : defNumForKpi > 0
        ? 'text-2xl font-bold text-orange-600 amount'
        : deferredKpiShowsZero
          ? 'text-2xl font-bold text-text-primary amount'
          : 'text-2xl font-bold text-text-muted amount';

  const paExtPrincipalCount = useMemo(
    () =>
      [
        paExtForm.controls_before_transfer,
        paExtForm.primary_obligor,
        paExtForm.inventory_risk,
        paExtForm.pricing_discretion,
        paExtForm.credit_risk,
      ].filter(Boolean).length,
    [paExtForm],
  );
  const paExtAgentCount = 5 - paExtPrincipalCount;

  const fillPortfolioFromLastCalculation = () => {
    setPortfolioAddOpen(true);
    const tid = contractId !== '—' ? String(contractId) : `C-${Date.now().toString(36).slice(-6)}`;
    const cust = customerName !== '—' ? String(customerName) : '';
    const baseEff =
      contractDate !== '—'
        ? String(contractDate).slice(0, 10)
        : new Date().toISOString().slice(0, 10);
    const termM = typeof contractTerm === 'number' && Number.isFinite(contractTerm) ? contractTerm : parseInt(String(contractTerm), 10) || 12;
    const endIso = addMonthsIso(baseEff, termM);
    const tpVal =
      typeof displayTp === 'number' && !Number.isNaN(displayTp) ? displayTp : Number(results?.total_contract_value) || 0;
    const recognised = typeof rec === 'number' && !Number.isNaN(rec) ? rec : Number(results?.total_recognised) || 0;
    const deferredAmt = typeof def === 'number' && !Number.isNaN(def) ? def : Number(results?.total_deferred) || 0;
    const rpoAmt = rpo120Result ? Number((rpo120Result as Record<string, unknown>).total_rpo) || 0 : 0;
    setPortfolioAddForm((f) => ({
      ...f,
      contract_id: tid,
      customer_name: cust,
      start_date: baseEff,
      end_date: endIso,
      total_tp: tpVal,
      recognised_to_date: recognised,
      deferred_balance: deferredAmt,
      rpo_amount: rpoAmt,
      currency,
    }));
  };

  const runRpo120Cal = async () => {
    if (rpo120Contracts.length === 0) {
      toast.error('Add at least one contract');
      return;
    }
    setRpo120Loading(true);
    try {
      const response = (await ifrs15Api.rpo({
        contracts: rpo120Contracts.map((c) => ({
          contract_id: c.contract_id || `C-${c.id.slice(0, 8)}`,
          customer_name: c.customer_name || 'Customer',
          contract_start: c.contract_start || '1900-01-01',
          contract_end: c.contract_end || '1900-01-01',
          total_transaction_price: Number(c.total_transaction_price) || 0,
          revenue_recognised_to_date: Number(c.revenue_recognised_to_date) || 0,
          practical_expedient_applied: c.practical_expedient_applied,
          performance_obligations: c.practical_expedient_applied
            ? []
            : (c.performance_obligations.length ? c.performance_obligations : [newRpo120Po()]).map((po) => ({
                name: po.name || 'PO',
                allocated_amount: Number(po.allocated_amount) || 0,
                recognised_to_date: Number(po.recognised_to_date) || 0,
                expected_recognition_pattern: po.expected_recognition_pattern,
                recognition_type: po.recognition_type,
              })),
        })),
      })) as { data?: Record<string, unknown>; error?: string };
      if (response.error) throw new Error(response.error);
      const data = response.data || {};
      if (data.success && data.rpo) {
        setRpo120Result(data.rpo as Record<string, unknown>);
      } else {
        setRpo120Result(data as Record<string, unknown>);
      }
      toast.success('RPO disclosure calculated');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'RPO calculation failed');
    } finally {
      setRpo120Loading(false);
    }
  };

  const runPaExtAssess = async () => {
    if (!paExtForm.arrangement_id.trim()) {
      toast.error('Enter arrangement ID');
      return;
    }
    setPaExtLoading(true);
    try {
      const response = (await ifrs15Api.principalAgent({
        arrangement_id: paExtForm.arrangement_id.trim(),
        description: paExtForm.description,
        third_party_involved: true,
        gross_contract_value: Number(paExtForm.gross_contract_value) || 0,
        third_party_cost: Number(paExtForm.third_party_cost) || 0,
        controls_before_transfer: paExtForm.controls_before_transfer,
        primary_obligor: paExtForm.primary_obligor,
        inventory_risk: paExtForm.inventory_risk,
        pricing_discretion: paExtForm.pricing_discretion,
        credit_risk: paExtForm.credit_risk,
      })) as { data?: Record<string, unknown>; error?: string };
      if (response.error) throw new Error(response.error);
      const data = response.data || {};
      const assessment = (data.assessment as Record<string, unknown>) || null;
      if (!assessment) throw new Error('No assessment returned');
      setPaExtLatest(assessment);
      const row: PaExtHistoryRow = {
        id: newUid(),
        arrangement_id: paExtForm.arrangement_id.trim(),
        description: paExtForm.description,
        gross_contract_value: Number(paExtForm.gross_contract_value) || 0,
        third_party_cost: Number(paExtForm.third_party_cost) || 0,
        assessment,
      };
      setPaExtHistory((h) => [row, ...h]);
      toast.success('Principal vs agent assessment complete');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Assessment failed');
    } finally {
      setPaExtLoading(false);
    }
  };

  const fetchAuditLog = async () => {
    setAuditLoading(true);
    try {
      const res = (await ifrs15Api.auditLog({
        contract_id: auditFilterContract.trim() || undefined,
        action: auditFilterAction || undefined,
        limit: 100,
      })) as { data?: Record<string, unknown>; error?: string };
      if (res.error) throw new Error(res.error);
      const data = res.data || {};
      setAuditEntries((data.entries as Record<string, unknown>[]) || []);
      setAuditPending(Number(data.pending_sign_off ?? 0));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Audit log failed');
    } finally {
      setAuditLoading(false);
    }
  };

  const downloadAuditLogExcel = async () => {
    setAuditExcelLoading(true);
    try {
      const res = await ifrs15Api.auditLogExportExcel({
        contract_id: auditFilterContract.trim() || undefined,
        action: auditFilterAction || undefined,
      });
      if (res.error) throw new Error(res.error);
      const blob = res.data;
      if (!blob) throw new Error('Empty export');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'IFRS15_AuditLog.xlsx';
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Downloaded audit log (.xlsx)');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Excel export failed');
    } finally {
      setAuditExcelLoading(false);
    }
  };

  const loadPortfolioSummary = async () => {
    setPortfolioLoading(true);
    try {
      const res = (await ifrs15Api.portfolioSummary()) as { data?: Record<string, unknown>; error?: string };
      if (res.error) throw new Error(res.error);
      const d = res.data || {};
      const summ = (d.summary as Record<string, unknown>) || {};
      const contracts = Array.isArray(d.contracts) ? (d.contracts as Record<string, unknown>[]) : [];
      setPortfolioSummaryApi(summ);
      setPortfolioContracts(contracts);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to load portfolio');
    } finally {
      setPortfolioLoading(false);
    }
  };

  const savePortfolioContract = async () => {
    if (!portfolioAddForm.contract_id.trim()) {
      toast.error('Contract ID is required');
      return;
    }
    if (!portfolioAddForm.start_date || !portfolioAddForm.end_date) {
      toast.error('Start and end dates are required');
      return;
    }
    setPortfolioSaving(true);
    try {
      const res = (await ifrs15Api.portfolioAddContract({ ...portfolioAddForm })) as { data?: Record<string, unknown>; error?: string };
      if (res.error) throw new Error(res.error);
      toast.success('Saved to portfolio');
      setPortfolioAddOpen(false);
      await loadPortfolioSummary();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setPortfolioSaving(false);
    }
  };

  const removePortfolioContractRow = async (contractId: string) => {
    setPortfolioSaving(true);
    try {
      const res = (await ifrs15Api.portfolioRemoveContract(contractId)) as { data?: Record<string, unknown>; error?: string };
      if (res.error) throw new Error(res.error);
      toast.success('Contract removed');
      await loadPortfolioSummary();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Remove failed');
    } finally {
      setPortfolioSaving(false);
    }
  };

  const exportPortfolioDashboardExcel = async () => {
    setPortfolioExcelLoading(true);
    try {
      window.open(ifrs15Api.portfolioExportExcelHref(), '_blank');
      toast.success('Portfolio Excel download started');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setPortfolioExcelLoading(false);
    }
  };

  useEffect(() => {
    if (ifrs15DashTab !== 'audit-trail') return;
    void fetchAuditLog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ifrs15DashTab]);

  useEffect(() => {
    if (ifrs15DashTab !== 'portfolio') return;
    void loadPortfolioSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ifrs15DashTab]);

  const PORTFOLIO_PAGE_SIZE = 10;

  useEffect(() => {
    setPortfolioPage(1);
  }, [portfolioTableFilter]);

  const portfolioFilteredContracts = useMemo(() => {
    if (portfolioTableFilter === 'all') return portfolioContracts;
    return portfolioContracts.filter((c) => String(c.status || '') === portfolioTableFilter);
  }, [portfolioContracts, portfolioTableFilter]);

  const portfolioTotalPages = Math.max(1, Math.ceil(portfolioFilteredContracts.length / PORTFOLIO_PAGE_SIZE));
  const portfolioPageClamped = Math.min(Math.max(portfolioPage, 1), portfolioTotalPages);

  const portfolioPagedContracts = useMemo(() => {
    const start = (portfolioPageClamped - 1) * PORTFOLIO_PAGE_SIZE;
    return portfolioFilteredContracts.slice(start, start + PORTFOLIO_PAGE_SIZE);
  }, [portfolioFilteredContracts, portfolioPageClamped]);

  const contractMixPie = useMemo(() => {
    const by = (portfolioSummaryApi.by_contract_type || {}) as Record<string, { arr?: number }>;
    const keys = ['subscription', 'professional_services', 'license', 'usage_based'];
    return keys.map((k) => ({
      name: k === 'professional_services' ? 'Professional services' : k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' '),
      value: Number(by[k]?.arr) || 0,
    }));
  }, [portfolioSummaryApi]);

  const statusStackBar = useMemo(
    () => [
      {
        name: 'Portfolio',
        active: Number(portfolioSummaryApi.active_contracts) || 0,
        at_risk: Number(portfolioSummaryApi.at_risk_contracts) || 0,
        churned: Number(portfolioSummaryApi.churned_contracts) || 0,
      },
    ],
    [portfolioSummaryApi],
  );

  const atRiskPortfolioRows = useMemo(
    () => portfolioContracts.filter((c) => String(c.status || '') === 'at_risk'),
    [portfolioContracts],
  );

  const runCcBatchCalc = async () => {
    if (ccRows.length === 0) {
      toast.error('Add at least one cost item');
      return;
    }
    setCcBatchLoading(true);
    try {
      const res = (await ifrs15Api.contractCosts({
        costs: ccRows.map((c) => ({
          cost_id: c.cost_id,
          contract_id: c.contract_id || 'N/A',
          description: c.description || 'Cost',
          cost_type: c.cost_type,
          cost_amount: Number(c.cost_amount) || 0,
          incurred_date: c.incurred_date,
          contract_start: c.contract_start,
          contract_end: c.contract_end,
          expected_renewal: c.expected_renewal,
          expected_renewal_months: c.expected_renewal_months,
          currency: c.currency || 'USD',
        })),
      })) as { data?: Record<string, unknown>; error?: string };
      if (res.error) throw new Error(res.error);
      const d = res.data || {};
      const cc = d.contract_costs as Record<string, unknown> | undefined;
      if (!cc) throw new Error('No contract_costs in response');
      setCcBatchResult(cc);
      toast.success('Contract costs calculated');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Contract costs failed');
    } finally {
      setCcBatchLoading(false);
    }
  };

  const runLicIpAssess = async () => {
    if (licRows.length === 0) {
      toast.error('Add at least one licence');
      return;
    }
    setLicIpLoading(true);
    try {
      const res = (await ifrs15Api.licensesIpAssess({
        licenses: licRows.map((l) => ({
          license_id: l.license_id,
          product_name: l.product_name,
          license_description: l.license_description,
          license_fee: Number(l.license_fee) || 0,
          license_start: l.license_start,
          license_end: l.is_perpetual ? '' : l.license_end,
          is_perpetual: l.is_perpetual,
          entity_activities_affect_ip: l.entity_activities_affect_ip,
          customer_exposed_to_effect: l.customer_exposed_to_effect,
          no_separate_functional_utility: l.no_separate_functional_utility,
          currency: l.currency || 'USD',
        })),
      })) as { data?: Record<string, unknown>; error?: string };
      if (res.error) throw new Error(res.error);
      setLicIpResult((res.data as Record<string, unknown>) || null);
      toast.success('Licence assessment complete');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Licence assessment failed');
    } finally {
      setLicIpLoading(false);
    }
  };

  const computeMrPreview = (row: MrFormRow) => {
    const optSsp = Number(row.option_ssp) || 0;
    const optPrice = Number(row.option_price) || 0;
    const disc = optSsp - optPrice;
    const discPct = optSsp > 0 ? (disc / optSsp) * 100 : 0;
    const mat = optPrice < optSsp && discPct > 10;
    const prob = Math.min(1, Math.max(0, (Number(row.exercise_probability_pct) || 0) / 100));
    const optionSspEst = Math.round(disc * prob * 100) / 100;
    const totalSsp = (Number(row.original_ssp) || 0) + optionSspEst;
    const deferredToOption =
      totalSsp > 0 ? Math.round((Number(row.original_contract_value) || 0) * (optionSspEst / totalSsp) * 100) / 100 : 0;
    return { discountAmount: disc, discountPct: discPct, materialRight: mat, optionSspEst, deferredToOption };
  };

  const runMaterialRightsAssess = async () => {
    if (mrRows.length === 0) {
      toast.error('Add at least one option');
      return;
    }
    setMrLoading(true);
    try {
      const res = (await ifrs15Api.materialRightsAssess({
        options: mrRows.map((r) => ({
          option_id: r.option_id,
          contract_id: r.contract_id || 'N/A',
          description: r.description || 'Customer option',
          option_type: r.option_type,
          original_contract_value: Number(r.original_contract_value) || 0,
          original_ssp: Number(r.original_ssp) || 0,
          option_price: Number(r.option_price) || 0,
          option_ssp: Number(r.option_ssp) || 0,
          exercise_probability: (Number(r.exercise_probability_pct) || 0) / 100,
          currency: r.currency || 'USD',
        })),
      })) as { data?: Record<string, unknown>; error?: string };
      if (res.error) throw new Error(res.error);
      setMrResult((res.data as Record<string, unknown>) || null);
      toast.success('Material rights assessment complete');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Material rights failed');
    } finally {
      setMrLoading(false);
    }
  };

  const runWarrantiesClassify = async () => {
    if (warRows.length === 0) {
      toast.error('Add at least one warranty');
      return;
    }
    setWarLoading(true);
    try {
      const res = (await ifrs15Api.warrantiesClassify({
        warranties: warRows.map((r) => ({
          warranty_id: r.warranty_id,
          contract_id: r.contract_id || 'N/A',
          product_description: r.product_description,
          warranty_description: r.warranty_description || 'Warranty',
          warranty_period_months: Number(r.warranty_period_months) || 0,
          warranty_value: Number(r.warranty_value) || 0,
          required_by_law: r.required_by_law,
          covers_specs_only: r.covers_specs_only,
          customer_can_purchase_separately: r.customer_can_purchase_separately,
          provides_additional_service: r.provides_additional_service,
          allocated_fee: Number(r.allocated_fee) || 0,
          currency: r.currency || 'USD',
        })),
      })) as { data?: Record<string, unknown>; error?: string };
      if (res.error) throw new Error(res.error);
      setWarResult((res.data as Record<string, unknown>) || null);
      toast.success('Warranty classification complete');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Warranty classification failed');
    } finally {
      setWarLoading(false);
    }
  };

  const runBillAndHoldAssess = async () => {
    if (bahRows.length === 0) {
      toast.error('Add at least one arrangement');
      return;
    }
    setBahLoading(true);
    try {
      const res = (await ifrs15Api.billAndHoldAssess({
        arrangements: bahRows.map((r) => ({
          arrangement_id: r.arrangement_id,
          contract_id: r.contract_id || 'N/A',
          customer_name: r.customer_name || 'Customer',
          product_description: r.product_description || 'Product',
          contract_value: Number(r.contract_value) || 0,
          expected_delivery_date: r.expected_delivery_date || new Date().toISOString().split('T')[0],
          billing_date: r.billing_date || new Date().toISOString().split('T')[0],
          reason_is_substantive: r.reason_is_substantive,
          product_separately_identified: r.product_separately_identified,
          product_ready_for_transfer: r.product_ready_for_transfer,
          entity_cannot_redirect: r.entity_cannot_redirect,
          currency: r.currency || 'USD',
        })),
      })) as { data?: Record<string, unknown>; error?: string };
      if (res.error) throw new Error(res.error);
      setBahResult((res.data as Record<string, unknown>) || null);
      toast.success('Bill-and-hold assessment complete');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Bill-and-hold assessment failed');
    } finally {
      setBahLoading(false);
    }
  };

  const runFinancingComponentCalculate = async () => {
    if (fcRows.length === 0) {
      toast.error('Add at least one contract');
      return;
    }
    setFcLoading(true);
    try {
      const res = (await ifrs15Api.financingComponentCalculate({
        contracts: fcRows.map((r) => ({
          contract_id: r.contract_id || 'N/A',
          description: r.description,
          contract_value: Number(r.contract_value) || 0,
          payment_date: r.payment_date,
          transfer_date: r.transfer_date,
          payment_timing: r.payment_timing,
          discount_rate: Number(r.discount_rate) || 0,
          currency: r.currency || 'USD',
        })),
      })) as { data?: Record<string, unknown>; error?: string };
      if (res.error) throw new Error(res.error);
      setFcResult((res.data as Record<string, unknown>) || null);
      toast.success('Financing component calculated');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Financing component failed');
    } finally {
      setFcLoading(false);
    }
  };

  const runTpAdjustments = async () => {
    if (ncRows.length === 0 && cpRows.length === 0) {
      toast.error('Add at least one non-cash item or consideration payable item');
      return;
    }
    setTpAdjLoading(true);
    try {
      const payload: Record<string, unknown> = {};
      if (ncRows.length > 0) {
        payload.non_cash_items = ncRows.map((r) => ({
          item_id: (r.item_id || r.id).trim() || r.id,
          contract_id: r.contract_id.trim() || 'N/A',
          description: r.description,
          consideration_type: r.consideration_type || 'goods',
          fair_value_determinable: !r.fv_unreliable,
          fair_value: Number(r.fair_value) || 0,
          fallback_ssp: Number(r.fallback_ssp) || 0,
          currency: r.currency || 'USD',
        }));
      }
      if (cpRows.length > 0) {
        payload.consideration_payable_items = cpRows.map((r) => ({
          item_id: (r.item_id || r.id).trim() || r.id,
          contract_id: r.contract_id.trim() || 'N/A',
          description: r.description,
          payment_type: r.payment_type || 'cash',
          amount: Number(r.amount) || 0,
          distinct_benefit_received: r.distinct_benefit_received,
          fair_value_of_benefit: Number(r.fair_value_of_benefit) || 0,
          currency: r.currency || 'USD',
        }));
      }
      const res = (await ifrs15Api.transactionPriceAdjustments(payload)) as { data?: Record<string, unknown>; error?: string };
      if (res.error) throw new Error(res.error);
      const d = res.data || {};
      const inner = (d.result as Record<string, unknown>) || {};
      setTpAdjResult(inner);
      toast.success('Transaction price adjustments calculated');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setTpAdjLoading(false);
    }
  };

  const confirmAuditSignOff = async () => {
    if (!signOffEntryId || !signOffReviewer.trim()) {
      toast.error('Reviewer name required');
      return;
    }
    try {
      const res = (await ifrs15Api.auditLogSignOff({
        entry_id: signOffEntryId,
        reviewer: signOffReviewer.trim(),
        notes: signOffNotes.trim(),
      })) as { data?: Record<string, unknown>; error?: string };
      if (res.error) throw new Error(res.error);
      toast.success('Signed off');
      setSignOffEntryId(null);
      setSignOffReviewer('');
      setSignOffNotes('');
      await fetchAuditLog();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Sign-off failed');
    }
  };

  const completionDate = schedule.length
    ? (schedule[schedule.length - 1]?.Date || schedule[schedule.length - 1]?.date || schedule[schedule.length - 1]?.Month || schedule[schedule.length - 1]?.month || '—')
    : '—';

  const postReversalRiskFromVc = async (vcData: Record<string, unknown>) => {
    setIsReversalRiskLoading(true);
    try {
      const termVal =
        typeof contractTerm === 'number' && Number.isFinite(contractTerm)
          ? contractTerm
          : parseInt(String(contractTerm), 10) || 12;
      const tpVal =
        typeof displayTp === 'number' && !Number.isNaN(displayTp)
          ? displayTp
          : Number(results?.total_contract_value ?? step1?.total_contract_value ?? 0) || 0;
      const methods = perfObs.map((p: { recognition_method?: string }) => String(p.recognition_method || '').toLowerCase());
      const hasOT = methods.some((m) => m.includes('over'));
      const hasPIT = methods.some((m) => m.includes('point'));
      const recognitionType = hasPIT && !hasOT ? 'point_in_time' : 'over_time';
      const histRaw = reversalHistoricalPct.trim();
      const histParsed = histRaw === '' ? null : Number(histRaw);
      const historicalPayload =
        histRaw === '' || histParsed === null || Number.isNaN(histParsed) ? null : histParsed;

      const revRes = await ifrs15Api.reversalRisk({
        contract_id: contractId !== '—' ? String(contractId) : undefined,
        constraint_level: String(vcData.constraint_level ?? 'none'),
        contract_term_months: termVal,
        customer_type: reversalCustomerType,
        variable_consideration: Number(vcData.constrained_amount ?? 0),
        total_contract_value: tpVal,
        refund_type: reversalRefundType,
        recognition_type: recognitionType,
        historical_attainment_pct: historicalPayload,
        has_external_dependency: reversalExtDep,
        dependency_level: reversalDepLevel,
      });
      if (revRes.error) {
        toast.error(revRes.error);
        setReversalRisk(null);
      } else if (revRes.data) {
        setReversalRisk(revRes.data);
      }
    } catch {
      setReversalRisk(null);
    } finally {
      setIsReversalRiskLoading(false);
    }
  };

  const disclosureCards = [
    {
      id: 'accounting-policy',
      title: 'Accounting Policy',
      content: disclosureNotes.accounting_policy || 'Generate master report to populate this disclosure note.'
    },
    {
      id: 'disaggregation',
      title: 'Disaggregation of Revenue',
      content: disclosureNotes.disaggregation_of_revenue || 'Generate master report to populate this disclosure note.'
    },
    {
      id: 'contract-balances',
      title: 'Contract Balances (assets/liabilities)',
      content: disclosureNotes.contract_balances || 'Generate master report to populate this disclosure note.'
    },
    {
      id: 'performance-obligations-note',
      title: 'Performance Obligations',
      content: disclosureNotes.performance_obligations_note || 'Generate master report to populate this disclosure note.'
    },
    {
      id: 'rpo',
      title: 'Transaction Price Allocated to RPO',
      content: disclosureNotes.transaction_price_rpo || 'Generate master report to populate this disclosure note.'
    },
    {
      id: 'judgements',
      title: 'Significant Judgements',
      content: disclosureNotes.significant_judgements || 'Generate master report to populate this disclosure note.'
    },
  ];

  const hasPopulatedDisclosureNotes =
    Boolean(results) &&
    disclosureCards.some((card) => !String(card.content || '').includes('Generate master report to populate'));

  const disclosureScorerCriteria: { key: string; label: string }[] = [
    { key: 'accounting_policy', label: 'Accounting Policy' },
    { key: 'disaggregation', label: 'Disaggregation of Revenue' },
    { key: 'contract_balances', label: 'Contract Balances' },
    { key: 'performance_obligations', label: 'Performance Obligations' },
    { key: 'rpo_disclosure', label: 'RPO Disclosure' },
    { key: 'significant_judgements', label: 'Significant Judgements' },
    { key: 'contract_modifications', label: 'Contract Modifications' },
  ];

  const barColorForDisclosureScore = (sc: number) => {
    if (sc >= 6) return 'bg-green-500';
    if (sc >= 4) return 'bg-blue-500';
    if (sc >= 2) return 'bg-orange-500';
    return 'bg-red-500';
  };

  const qualityLevelBadgeClass = (level: string) => {
    const u = String(level || '');
    if (u === 'Excellent') return 'bg-green-100 text-green-900 border-green-300';
    if (u === 'Good') return 'bg-blue-100 text-blue-900 border-blue-300';
    if (u === 'Adequate') return 'bg-yellow-100 text-yellow-900 border-yellow-300';
    return 'bg-red-100 text-red-900 border-red-300';
  };

  const handleAutoFillDisclosureNotes = () => {
    const combined = disclosureCards.map((c) => `${c.title}\n\n${c.content}`).join('\n\n---\n\n');
    setDisclosureText(combined);
  };

  const handleScoreDisclosureSubmit = async () => {
    if (disclosureText.trim().length < 50) return;
    setDisclosureLoading(true);
    try {
      const res = await ifrs15Api.scoreDisclosure({
        disclosure_text: disclosureText,
        calculation_results: results || {},
      });
      if (res.error) {
        toast.error(res.error);
        setDisclosureScore(null);
      } else {
        setDisclosureScore((res.data as Record<string, unknown>) || null);
      }
    } catch {
      toast.error('Scoring failed');
      setDisclosureScore(null);
    } finally {
      setDisclosureLoading(false);
    }
  };

  const generateDisclosureText = () => {
    if (!results) return '';
    const c = sanitizeCurrencyCode(disclosureData.contract_details?.currency || currency, 'USD');
    const sym = c === 'INR' ? '₹' : c === 'USD' ? '$' : c === 'GBP' ? '£' : c === 'EUR' ? '€' : c;
    const pointInTime = perfObs.filter((p: any) => p.recognition_method === 'point_in_time').reduce((s: number, p: any) => s + (p.revenue_recognized || 0), 0);
    const overTime = perfObs.filter((p: any) => p.recognition_method === 'over_time').reduce((s: number, p: any) => s + (p.revenue_recognized || 0), 0);
    return `IFRS 15 DISCLOSURE NOTES
=========================
Note: Revenue from Contracts with Customers

The Company recognises revenue in accordance with IFRS 15. Revenue is measured at the transaction price agreed under the contract.

Contract Balances:
- Contract Assets: ${sym} ${(balances.contract_asset_amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
- Contract Liabilities (Deferred Revenue): ${sym} ${(balances.contract_liability_amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
- Revenue Recognised to Date: ${sym} ${(balances.revenue_recognized_to_date || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
- Cash Received to Date: ${sym} ${(balances.cash_received_to_date || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}

Performance Obligations:
${perfObs.length ? perfObs.map((p: any) => `- ${p.obligation || p.obligation_id}: ${sym} ${(p.allocated_amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })} (${(p.recognition_method || '').replace('_', ' ')})`).join('\n') : Object.entries(allocations).map(([id, amt]) => `- ${id}: ${sym} ${Number(amt).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`).join('\n')}

Disaggregation of Revenue:
- Point in Time: ${sym} ${pointInTime.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
- Over Time: ${sym} ${overTime.toLocaleString('en-IN', { maximumFractionDigits: 0 })}

Transaction Price allocated to remaining performance obligations:
Remaining unrecognised: ${sym} ${((displayTp || 0) - rec).toLocaleString('en-IN', { maximumFractionDigits: 0 })}

Report generated: ${results.calculation_metadata?.calculation_date || new Date().toLocaleString()}`;
  };

  const handleCopyDisclosure = () => {
    navigator.clipboard.writeText(generateDisclosureText()).then(() => toast.success('Disclosure copied!')).catch(() => toast.error('Copy failed'));
  };

  const handleDownloadPDF = () => {
    if (!results) {
      toast.error('No disclosure data. Calculate a contract first.');
      return;
    }
    const blob = new Blob([generateDisclosureText()], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `IFRS15_Disclosure_${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Disclosure downloaded!');
  };

  const handleGenerateExcelReport = async () => {
    if (!results) {
      toast.error('No results found. Run calculation first.');
      return;
    }
    setIsGeneratingExcel(true);
    try {
      const response = await ifrs15Api.generateExcel({
        contract_id: contractId === '—' ? `CONTRACT-${Date.now()}` : contractId,
        customer_name: customerName === '—' ? '' : customerName,
        effective_date: contractDate === '—' ? undefined : contractDate,
        contract_term_months: typeof contractTerm === 'number' ? contractTerm : undefined,
        currency,
        master_report_data: masterReport ?? undefined,
        results: {
          ...results,
          variable_consideration_assessment: vcAssessment || undefined,
          rpo_disclosure: rpoAssessment || undefined,
          contract_costs_assessment: ccAssessment || undefined,
          principal_agent_assessment: paAssessment || undefined,
          license_classification: licAssessment || undefined,
          deferred_revenue_rollforward: drResultsStack[0] ?? undefined,
          rpo_disclosure_ifrs120: rpo120Result ?? undefined,
          principal_agent_history:
            paExtHistory.length > 0
              ? paExtHistory.map((h) => ({
                  arrangement_id: h.arrangement_id,
                  description: h.description,
                  gross_contract_value: h.gross_contract_value,
                  third_party_cost: h.third_party_cost,
                  assessment: h.assessment,
                }))
              : undefined,
          contract_costs_ifrs9194: ccBatchResult ?? undefined,
          licenses_ip_export:
            licIpResult && Array.isArray((licIpResult as any).licenses)
              ? { licenses: (licIpResult as any).licenses, summary: (licIpResult as any).summary }
              : undefined,
          material_rights_ifrs1540:
            mrResult && Array.isArray((mrResult as any).options)
              ? { options: (mrResult as any).options, summary: (mrResult as any).summary }
              : undefined,
          warranties_ifrs1528:
            warResult && Array.isArray((warResult as any).warranties)
              ? { warranties: (warResult as any).warranties, summary: (warResult as any).summary }
              : undefined,
          bill_and_hold_ifrs1579:
            bahResult && Array.isArray((bahResult as any).arrangements)
              ? { arrangements: (bahResult as any).arrangements, summary: (bahResult as any).summary }
              : undefined,
          financing_component_ifrs1560:
            fcResult && Array.isArray((fcResult as any).contracts)
              ? { contracts: (fcResult as any).contracts, summary: (fcResult as any).summary }
              : undefined,
          tp_adjustments_ifrs1566:
            tpAdjResult && (tpAdjResult.non_cash != null || tpAdjResult.consideration_payable != null)
              ? tpAdjResult
              : undefined,
          audit_entries: auditEntries.length > 0 ? auditEntries : undefined,
          modifications_log:
            modificationHistory.length > 0
              ? modificationHistory.map((h) => {
                  const m = h.modification || {};
                  const je0 = Array.isArray(m.journal_entries) ? m.journal_entries[0] : null;
                  const ref = (je0 as any)?.reference || '';
                  return {
                    modification_date: h.modification_date,
                    date: h.modification_date,
                    type: h.typeLabel,
                    description: h.description || String(m.explanation || ''),
                    catch_up_amount: Number(m.catch_up_amount ?? 0),
                    ifrs_reference: ref,
                  };
                })
              : modAssessment
                ? [
                    {
                      modification_date: modForm.modification_date,
                      date: modForm.modification_date,
                      type: String(modAssessment.modification_type_name || ''),
                      description: modForm.modification_description || String(modAssessment.explanation || ''),
                      catch_up_amount: Number(modAssessment.catch_up_amount ?? 0),
                      ifrs_reference: String((modAssessment.journal_entries?.[0] as any)?.reference || ''),
                    },
                  ]
                : [],
        },
      }) as any;
      const { data, error } = response;
      if (error) throw new Error(error);
      const generatedFileId = data?.file_id;
      if (!generatedFileId) throw new Error('Excel generation failed');
      setFileId(generatedFileId);
      window.open(ifrs15Api.downloadReport(generatedFileId), '_blank');
      toast.success('Excel report generated and download started');
    } catch (error: any) {
      toast.error(error?.message || 'Failed to generate Excel report');
    } finally {
      setIsGeneratingExcel(false);
    }
  };

  const openClientReportModal = () => {
    if (!results) {
      toast.error('Run calculation first');
      return;
    }
    setClientReportPreparedFor(customerName !== '—' ? customerName : '');
    setClientReportPreparedBy('IFRS AI');
    setClientReportIncludeQa(true);
    setIsClientReportModalOpen(true);
  };

  const handleGenerateClientReport = async () => {
    if (!results) {
      toast.error('No results found. Run calculation first.');
      return;
    }
    if (!clientReportPreparedFor.trim()) {
      toast.error('Please enter client name');
      return;
    }
    setIsGeneratingClientReport(true);
    const loadingToast = toast.loading('Generating client report... Claude is preparing your analysis.');
    try {
      const response = await ifrs15Api.generateClientReport({
        contract_id: contractId === '—' ? `CONTRACT-${Date.now()}` : String(contractId),
        customer_name: clientReportPreparedFor.trim(),
        calculation_results: results,
        master_report_data: masterReport ?? undefined,
        include_auditor_qa: clientReportIncludeQa,
        prepared_by: clientReportPreparedBy.trim() || 'IFRS AI',
      }) as any;
      const { data, error } = response;
      if (error) throw new Error(error);
      const fid = data?.file_id;
      if (!fid) throw new Error('Report generation failed');
      const url = ifrs15Api.downloadClientReport(fid);
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to download generated report');
      const blob = await res.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = data?.filename || `IFRS15_Report_${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);
      setIsClientReportModalOpen(false);
      toast.success(`Client report ready (${data?.pages ?? 10} pages)`);
    } catch (error: any) {
      toast.error(error?.message || 'Failed to generate client report');
    } finally {
      toast.dismiss(loadingToast);
      setIsGeneratingClientReport(false);
    }
  };

  const assessModification = async () => {
    if (!results) {
      toast.error('Calculate a contract first');
      return;
    }
    setIsAssessingModification(true);
    try {
      const newGoods = modForm.new_goods_csv
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const remPos = modForm.remaining_po_csv
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const original_ssps: Record<string, number> = {};
      perfObs.forEach((p: any) => {
        const id = String(p.obligation || p.obligation_id || '').trim();
        if (!id) return;
        original_ssps[id] = Number(
          p.standalone_selling_price ?? p.ssp ?? p.allocated_amount ?? 0
        );
      });
      const response = await ifrs15Api.assessModification({
        original_contract_id: contractId === '—' ? `CONTRACT-${Date.now()}` : String(contractId),
        modification_date: modForm.modification_date,
        modification_description: modForm.modification_description,
        new_goods_services: newGoods,
        price_change: Number(modForm.price_change || 0),
        remaining_transaction_price: Number(modForm.remaining_transaction_price || 0),
        remaining_performance_obligations: remPos.length ? remPos : perfObs.map((p: any) => String(p.obligation || p.obligation_id || '')).filter(Boolean),
        original_ssps,
      }) as any;
      const { data, error } = response;
      if (error) throw new Error(error);
      const mod = (data?.modification ?? data) as any;
      setModAssessment(mod);
      const typeLabel = String(mod?.modification_type_name || mod?.modification_type || '—');
      setModificationHistory((h) => [
        {
          id: `${Date.now()}`,
          modification_date: modForm.modification_date,
          typeLabel,
          description: modForm.modification_description || typeLabel,
          modification: mod,
        },
        ...h,
      ]);
      toast.success('Modification assessed');
    } catch (error: any) {
      toast.error(error?.message || 'Failed to assess modification');
    } finally {
      setIsAssessingModification(false);
    }
  };

  const runDeferredRevenueRollforward = async () => {
    setDrLoading(true);
    try {
      const response = await ifrs15Api.deferredRevenueRollforward({
        period: drForm.period || `PERIOD-${Date.now()}`,
        opening_balance: Number(drForm.opening_balance),
        new_bookings: Number(drForm.new_bookings),
        revenue_released: Number(drForm.revenue_released),
        cancellations: Number(drForm.cancellations),
        modifications_impact: Number(drForm.modifications_impact),
        fx_impact: Number(drForm.fx_impact),
        gl_closing_balance: Number(drForm.gl_closing_balance),
        currency: drForm.currency,
      }) as any;
      const { data, error } = response;
      if (error) throw new Error(error);
      const rf = data?.rollforward;
      if (!rf) throw new Error('No roll-forward data');
      setDrResultsStack((s) => [rf as Record<string, unknown>, ...s]);
      toast.success('Reconciliation complete');
    } catch (error: any) {
      toast.error(error?.message || 'Roll-forward failed');
    } finally {
      setDrLoading(false);
    }
  };

  useEffect(() => {
    setVcMostLikelyManual(false);
  }, [vcMethod]);

  useEffect(() => {
    if (vcMethod !== 'most_likely' || !vcScenarios.length) return;
    if (vcMostLikelyManual) return;
    const amounts = vcScenarios.map((s) => Number(s.amount) || 0);
    if (!amounts.length) return;
    let bestIdx = 0;
    for (let i = 1; i < amounts.length; i++) {
      if (amounts[i] > amounts[bestIdx]) bestIdx = i;
    }
    setVcMostLikelyIdx(bestIdx);
  }, [vcScenarios, vcMethod, vcMostLikelyManual]);

  const vcProbTotalPct = vcScenarios.reduce((s, r) => s + (Number(r.probPct) || 0), 0);
  const vcLocalEstimateFor1556 = useMemo(() => {
    if (vcMethod === 'expected_value' || vcMethod === 'scenario_weighted') {
      return vcScenarios.reduce((s, r) => s + (Number(r.amount) || 0) * ((Number(r.probPct) || 0) / 100), 0);
    }
    return Number(vcScenarios[vcMostLikelyIdx]?.amount) || 0;
  }, [vcScenarios, vcMethod, vcMostLikelyIdx]);
  const vc1556ModulePreview = applyVc1556Preview(vcLocalEstimateFor1556, vc1556Factors);
  const vcConstraintScore = vcConstraintFactors.filter(Boolean).length;
  const vcConstraintPreview = (() => {
    if (vcConstraintScore === 0) return { level: 'None', pill: 'bg-emerald-100 text-emerald-800 border-emerald-200' };
    if (vcConstraintScore === 1) return { level: 'Low', pill: 'bg-amber-100 text-amber-900 border-amber-300' };
    if (vcConstraintScore === 2) return { level: 'Moderate', pill: 'bg-orange-100 text-orange-900 border-orange-300' };
    return { level: 'High', pill: 'bg-red-100 text-red-800 border-red-300' };
  })();

  const calculateVariableConsideration = async () => {
    if ((vcMethod === 'expected_value' || vcMethod === 'scenario_weighted') && Math.abs(vcProbTotalPct - 100) > 1) {
      toast.error('Probabilities must sum to 100%');
      return;
    }
    setIsCalculatingVc(true);
    try {
      const scenariosPayload =
        vcMethod === 'expected_value' || vcMethod === 'scenario_weighted'
          ? vcScenarios.map((s) => ({
              outcome: s.outcome,
              amount: Number(s.amount) || 0,
              probability: (Number(s.probPct) || 0) / 100,
            }))
          : vcScenarios.map((s, i) => ({
              outcome: s.outcome,
              amount: Number(s.amount) || 0,
              probability: i === vcMostLikelyIdx ? 1 : 0,
            }));
      const totalCvRaw =
        typeof displayTp === 'number' && !Number.isNaN(displayTp) && displayTp > 0
          ? displayTp
          : Number(step1?.total_contract_value);
      const total_contract_value =
        Number.isFinite(totalCvRaw) && totalCvRaw > 0 ? totalCvRaw : undefined;
      const response = (await ifrs15Api.variableConsideration({
        method: vcMethod,
        scenarios: scenariosPayload,
        constraint_factors: vcConstraintFactors,
        contract_id: contractId !== '—' ? String(contractId) : undefined,
        ...(total_contract_value !== undefined ? { total_contract_value } : {}),
      })) as { data?: Record<string, unknown>; error?: string };
      if (response.error) throw new Error(response.error);
      const data = response.data;
      if (!data) throw new Error('No response data');
      setVcResult(data);
      setVcAssessment(data);
      toast.success('Variable consideration calculated');
      await postReversalRiskFromVc(data);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Calculation failed';
      toast.error(msg);
    } finally {
      setIsCalculatingVc(false);
    }
  };

  const addVcToTransactionPrice = () => {
    toast('KPIs use calculate API output only. Re-run Calculate to reflect VC changes.');
  };

  const initRpoFormFromResults = () => {
    const list =
      perfObs.length > 0
        ? perfObs
        : Object.entries(allocations).map(([id, amt]) => ({
            obligation: id,
            obligation_id: id,
            allocated_amount: Number(amt),
            revenue_recognized: 0,
          }));
    const termM = typeof contractTerm === 'number' ? contractTerm : parseInt(String(contractTerm), 10) || 12;
    const baseEff = contractDate !== '—' ? String(contractDate) : new Date().toISOString().slice(0, 10);
    const defaultEnd = addMonthsIso(baseEff, Number.isFinite(termM) ? termM : 12);
    setRpoFormRows(
      list.map((ob: any) => ({
        obligation_name: String(ob.obligation || ob.description || ob.obligation_id || 'Obligation'),
        allocated_amount: Number(ob.allocated_amount ?? 0),
        recognised_to_date: Number(ob.revenue_recognized ?? ob.revenue_recognised ?? 0),
        expected_end_date: defaultEnd,
        original_expected_duration_months:
          ob.duration_months != null ? Number(ob.duration_months) : undefined,
        is_right_to_invoice: false,
      })),
    );
  };

  const runRpoCalculation = async () => {
    if (!rpoFormRows.length) {
      toast.error('No performance obligations. Run a calculation first.');
      return;
    }
    setIsRpoLoading(true);
    try {
      const res = (await ifrs15Api.rpo({
        obligations: rpoFormRows.map((r) => ({
          obligation_name: r.obligation_name,
          allocated_amount: r.allocated_amount,
          recognised_to_date: Number(r.recognised_to_date),
          expected_end_date: r.expected_end_date,
          original_expected_duration_months: r.original_expected_duration_months ?? null,
          is_right_to_invoice: !!r.is_right_to_invoice,
        })),
        contract_id: contractId !== '—' ? String(contractId) : undefined,
      })) as { data?: Record<string, unknown>; error?: string };
      if (res.error) throw new Error(res.error);
      if (!res.data) throw new Error('No data');
      setRpoResult(res.data);
      setRpoAssessment(res.data);
      toast.success('RPO calculated');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'RPO failed');
    } finally {
      setIsRpoLoading(false);
    }
  };

  const runContractCostsCalculation = async () => {
    const com = Number(ccCommission || 0);
    const term = parseInt(String(ccTerm || 0), 10) || 0;
    const tv = Number(ccTotalValue || 0);
    setIsCcLoading(true);
    try {
      const res = (await ifrs15Api.contractCosts({
        commission_amount: com,
        contract_term_months: term,
        contract_total_value: tv,
        contract_id: contractId !== '—' ? String(contractId) : undefined,
      })) as { data?: Record<string, unknown>; error?: string };
      if (res.error) throw new Error(res.error);
      if (!res.data) throw new Error('No data');
      setCcResult(res.data);
      setCcAssessment(res.data);
      toast.success('Contract costs calculated');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Calculation failed');
    } finally {
      setIsCcLoading(false);
    }
  };

  const paScore = (paObtains ? 1 : 0) + (paSetsPrice ? 1 : 0) + (paPrimary ? 1 : 0);
  const runPrincipalAgentAssessment = async () => {
    setIsPaLoading(true);
    try {
      const res = (await ifrs15Api.principalAgent({
        transaction_price: Number(paTp || 0),
        cost_paid_to_supplier: Number(paCost || 0),
        obtains_before_transfer: paObtains,
        sets_price_independently: paSetsPrice,
        primarily_responsible: paPrimary,
        contract_id: contractId !== '—' ? String(contractId) : undefined,
      })) as { data?: Record<string, unknown>; error?: string };
      if (res.error) throw new Error(res.error);
      if (!res.data) throw new Error('No data');
      setPaResult(res.data);
      setPaAssessment(res.data);
      toast.success('Principal/Agent assessment complete');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Assessment failed');
    } finally {
      setIsPaLoading(false);
    }
  };

  const licPreviewLabel = (() => {
    if (licA === null || licB === null || licC === null) return 'Incomplete';
    if (licA && licB && licC) return 'RIGHT TO ACCESS (over time)';
    return 'RIGHT TO USE (point in time)';
  })();

  const runLicenseClassification = async () => {
    if (licA === null || licB === null || licC === null) {
      toast.error('Answer all three licence questions');
      return;
    }
    if (!licStart?.trim()) {
      toast.error('Set licence start date');
      return;
    }
    setIsLicLoading(true);
    try {
      const res = (await ifrs15Api.licenseClassification({
        transaction_price: Number(licPrice || 0),
        licence_term_months: parseInt(String(licTerm || 0), 10) || 0,
        licence_start_date: licStart,
        significantly_affects_ip: licA,
        customer_exposed_as_occurs: licB,
        activities_not_separate_good: licC,
        includes_usage_royalties: licRoyalty,
        contract_id: contractId !== '—' ? String(contractId) : undefined,
      })) as { data?: Record<string, unknown>; error?: string };
      if (res.error) throw new Error(res.error);
      if (!res.data) throw new Error('No data');
      setLicResult(res.data);
      setLicAssessment(res.data);
      toast.success('Licence classified');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Classification failed');
    } finally {
      setIsLicLoading(false);
    }
  };

  const generateMasterReport = async () => {
    if (!results) {
      toast.error('Run a calculation first');
      return;
    }
    setIsMasterLoading(true);
    const loadingToast = toast.loading('Generating master report… Claude is writing your technical memo.');
    try {
      const res = (await ifrs15Api.masterReport({
        contract_id: contractId === '—' ? `CONTRACT-${Date.now()}` : String(contractId),
        customer_name: customerName === '—' ? '' : String(customerName),
        core_results: results as Record<string, unknown>,
        modification_result: (modAssessment as Record<string, unknown>) || null,
        variable_consideration_result: (vcResult as Record<string, unknown>) || null,
        rpo_result: (rpoResult as Record<string, unknown>) || null,
        contract_costs_result: (ccResult as Record<string, unknown>) || null,
        principal_agent_result: (paResult as Record<string, unknown>) || null,
        license_result: (licResult as Record<string, unknown>) || null,
      })) as { data?: Record<string, unknown>; error?: string };
      if (res.error) throw new Error(res.error);
      if (!res.data) throw new Error('No report data');
      setMasterReport(res.data);
      setMasterTab(0);
      setMasterModalOpen(true);
      toast.success('Master report generated');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to generate master report');
    } finally {
      toast.dismiss(loadingToast);
      setIsMasterLoading(false);
    }
  };

  const downloadMasterReportExcel = async () => {
    if (!masterReport) return;
    setIsMasterExcelLoading(true);
    try {
      const res = (await ifrs15Api.masterReportDownloadExcel({ master_report: masterReport })) as {
        data?: { file_id?: string };
        error?: string;
      };
      if (res.error) throw new Error(res.error);
      const fid = res.data?.file_id;
      if (!fid) throw new Error('No file id');
      window.open(ifrs15Api.downloadReport(fid), '_blank');
      toast.success('Master report Excel download started');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Excel download failed');
    } finally {
      setIsMasterExcelLoading(false);
    }
  };

  const clauseOverall = clauseDetection ? String(clauseDetection.overall_risk || '').toUpperCase() : '';
  const clauseList = Array.isArray(clauseDetection?.clauses) ? (clauseDetection!.clauses as Record<string, unknown>[]) : [];
  const clauseReviewedCount = clauseList.filter((_, i) => clauseAcknowledged[i]).length;
  const clauseAllReviewed = clauseList.length > 0 && clauseReviewedCount === clauseList.length;
  const pageSubtitleText =
    clauseDetection?.overall_risk != null
      ? `5-step model for revenue recognition from customer contracts · Clause risk: ${String(clauseDetection.overall_risk)}`
      : '5-step model for revenue recognition from customer contracts';

  return (
    <SidebarLayout pageTitle="IFRS 15 — Revenue Recognition" pageSubtitle={pageSubtitleText}>
      {/* Module Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-8">
        {moduleCards.map((m) => (
          <div
            key={m.id}
            onClick={() => setActiveModule(activeModule === m.id ? null : m.id)}
            className={`bg-gradient-to-br ${m.gradient} rounded-card p-4 text-white cursor-pointer hover:shadow-lg transition-shadow ${activeModule === m.id ? 'ring-2 ring-white ring-offset-2' : ''}`}
          >
            <p className="text-sm font-semibold">{m.name}</p>
          </div>
        ))}
      </div>

      {/* Module content – expand when a card is clicked (same pattern as IFRS 16) */}
      {activeModule && (
        <div className="bg-white rounded-card p-6 border border-border-default shadow-card mb-8">
          {activeModule === 'contract-identification' && (
            <>
              <div className="border-b border-border-default pb-4 mb-6">
                <h3 className="text-base font-bold text-text-primary">Contract Identification</h3>
                <p className="text-xs text-text-muted mt-1">Contract details from results</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><span className="text-xs text-text-muted">Contract ID</span><p className="text-sm font-medium text-text-primary mt-1">{contractId}</p></div>
                <div><span className="text-xs text-text-muted">Customer Name</span><p className="text-sm font-medium text-text-primary mt-1">{customerName}</p></div>
                <div><span className="text-xs text-text-muted">Contract Date</span><p className="text-sm font-medium text-text-primary mt-1">{contractDate}</p></div>
                <div><span className="text-xs text-text-muted">Contract Term / Duration</span><p className="text-sm font-medium text-text-primary mt-1">{contractTerm === '—' ? '—' : `${contractTerm} months`}</p></div>
                <div><span className="text-xs text-text-muted">Transaction Price / Contract Value</span><p className="text-sm font-medium text-text-primary mt-1">{results ? (displayTp == null ? '—' : formatCurrency(displayTp, currency, 0)) : (step1.total_contract_value ? formatCurrency(Number(step1.total_contract_value), sanitizeCurrencyCode(step1.currency, 'USD'), 0) : '—')}</p></div>
              </div>
            </>
          )}
          {activeModule === 'performance-obligations' && (
            <>
              <div className="border-b border-border-default pb-4 mb-6">
                <h3 className="text-base font-bold text-text-primary">Performance Obligations</h3>
                <p className="text-xs text-text-muted mt-1">Identified obligations and allocation</p>
              </div>
              {(perfObs.length > 0 || Object.keys(allocations).length > 0) ? (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border-default">
                        <th className="text-left py-2 px-3 text-xs font-semibold text-text-secondary uppercase">Obligation</th>
                        <th className="text-right py-2 px-3 text-xs font-semibold text-text-secondary uppercase">Allocation Value</th>
                        <th className="text-left py-2 px-3 text-xs font-semibold text-text-secondary uppercase">Recognition Type</th>
                        <th className="text-left py-2 px-3 text-xs font-semibold text-text-secondary uppercase">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {perfObs.length > 0 ? perfObs.map((p: any) => {
                        const rec = p.recognition_method === 'point_in_time' ? 'Point in Time' : 'Over Time';
                        const status = ifrs15PoRecognitionStatus(p as Record<string, unknown>);
                        return (
                          <tr key={p.obligation_id || p.obligation} className="border-b border-border-default hover:bg-orange-light">
                            <td className="py-2 px-3 text-sm text-text-primary">{p.obligation || p.obligation_id}</td>
                            <td className="py-2 px-3 text-sm text-right font-semibold amount">{formatCurrency(Number(p.allocated_amount ?? 0), currency, 0)}</td>
                            <td className="py-2 px-3 text-sm text-text-primary">{rec}</td>
                            <td className="py-2 px-3">
                              <span className={`px-2 py-1 text-xs font-medium rounded-full ${ifrs15PoStatusBadgeClass(status)}`}>{status}</span>
                            </td>
                          </tr>
                        );
                      }) : Object.entries(allocations).map(([id, amt]) => (
                        <tr key={id} className="border-b border-border-default hover:bg-orange-light">
                          <td className="py-2 px-3 text-sm text-text-primary">{id}</td>
                          <td className="py-2 px-3 text-sm text-right font-semibold amount">{formatCurrency(Number(amt), currency, 0)}</td>
                          <td className="py-2 px-3 text-sm text-text-muted">—</td>
                          <td className="py-2 px-3 text-sm text-text-muted">—</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-text-muted">Upload and calculate a contract to see performance obligations.</p>
              )}
            </>
          )}
          {activeModule === 'transaction-price' && (
            <>
              <div className="border-b border-border-default pb-4 mb-6">
                <h3 className="text-base font-bold text-text-primary">Transaction Price</h3>
                <p className="text-xs text-text-muted mt-1">Step 3 – Determine transaction price</p>
              </div>
              <div className="p-4 bg-orange-light rounded-lg border border-orange-border space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-text-primary">Total transaction price</span>
                  <span className="text-lg font-bold text-orange-primary amount">{results ? (displayTp == null ? '—' : formatCurrency(displayTp, currency, 0)) : '—'}</span>
                </div>
                <div className="flex justify-between items-center text-sm text-text-secondary">
                  <span>Variable consideration</span>
                  <span className="amount">{results ? formatCurrency(disclosureData?.transaction_price_components?.variable_consideration ?? 0, currency, 0) : '—'}</span>
                </div>
                <div className="flex justify-between items-center text-sm text-text-secondary">
                  <span>Currency</span>
                  <span className="font-medium">{currency}</span>
                </div>
                <div className="flex justify-between items-center text-sm text-text-secondary">
                  <span>Payment terms</span>
                  <span>{extractedData?.step3_transaction_price?.significant_financing_component?.payment_terms_exceed_one_year ? 'Exceeds 1 year' : (results ? 'Per contract' : '—')}</span>
                </div>
                {disclosureData?.transaction_price_components && (
                  <div className="pt-2 mt-2 border-t border-orange-border space-y-1 text-sm text-text-secondary">
                    <div className="flex justify-between"><span>Fixed consideration</span><span className="amount">{formatCurrency(disclosureData.transaction_price_components.fixed_consideration ?? 0, currency, 0)}</span></div>
                  </div>
                )}
              </div>
            </>
          )}
          {activeModule === 'price-allocation' && (
            <>
              <div className="border-b border-border-default pb-4 mb-6">
                <h3 className="text-base font-bold text-text-primary">Price Allocation</h3>
                <p className="text-xs text-text-muted mt-1">Step 4 – Allocate transaction price to obligations (SSP method)</p>
              </div>
              {(perfObs.length > 0 || Object.keys(allocations).length > 0) ? (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border-default">
                        <th className="text-left py-2 px-3 text-xs font-semibold text-text-secondary uppercase">Obligation</th>
                        <th className="text-right py-2 px-3 text-xs font-semibold text-text-secondary uppercase">Allocated amount</th>
                        <th className="text-right py-2 px-3 text-xs font-semibold text-text-secondary uppercase">% of total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {perfObs.length > 0 ? perfObs.map((p: any) => {
                        const amt = Number(p.allocated_amount ?? 0);
                        const pct = tp > 0 ? ((amt / tp) * 100).toFixed(1) : '0';
                        return (
                          <tr key={p.obligation_id || p.obligation} className="border-b border-border-default hover:bg-orange-light">
                            <td className="py-2 px-3 text-sm text-text-primary">{p.obligation || p.obligation_id}</td>
                            <td className="py-2 px-3 text-sm text-right font-semibold amount">{formatCurrency(amt, currency, 0)}</td>
                            <td className="py-2 px-3 text-sm text-right text-text-secondary">{pct}%</td>
                          </tr>
                        );
                      }) : Object.entries(allocations).map(([id, amt]) => {
                        const pct = tp > 0 ? ((Number(amt) / tp) * 100).toFixed(1) : '0';
                        return (
                          <tr key={id} className="border-b border-border-default hover:bg-orange-light">
                            <td className="py-2 px-3 text-sm text-text-primary">{id}</td>
                            <td className="py-2 px-3 text-sm text-right font-semibold amount">{formatCurrency(Number(amt), currency, 0)}</td>
                            <td className="py-2 px-3 text-sm text-right text-text-secondary">{pct}%</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-text-muted">Calculate a contract to see allocation.</p>
              )}
            </>
          )}
          {activeModule === 'revenue-recognition' && (
            <>
              <div className="border-b border-border-default pb-4 mb-6">
                <h3 className="text-base font-bold text-text-primary">Revenue Recognition</h3>
                <p className="text-xs text-text-muted mt-1">Step 5 – Recognise revenue when/as obligations are satisfied</p>
              </div>
              {results ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex justify-between p-3 hover:bg-green-50 rounded-lg border-l-4 border-green-500">
                      <span className="text-sm text-text-secondary">Revenue Recognised</span>
                      <span className="font-bold text-green-600 amount">{formatCurrency(rec, currency, 0)}</span>
                    </div>
                    <div className="flex justify-between p-3 hover:bg-amber-50 rounded-lg border-l-4 border-amber-500">
                      <span className="text-sm text-text-secondary">Deferred Revenue</span>
                      <span className={`font-bold amount ${typeof def === 'number' && def > 0 ? 'text-amber-600' : 'text-text-muted'}`}>
                        {deferredKpiText}
                      </span>
                    </div>
                    <div className="flex justify-between p-3">
                      <span className="text-sm text-text-secondary">Effective Revenue Rate</span>
                      <span className="font-bold text-text-primary">{effectiveRevenueRate}%</span>
                    </div>
                  </div>
                  {schedule?.length > 0 && (
                    <>
                      <h4 className="text-sm font-semibold text-text-primary mt-4">Revenue Schedule</h4>
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead>
                            <tr className="border-b border-border-default">
                              <th className="text-left py-2 px-3 text-xs font-semibold text-text-secondary uppercase">Period</th>
                              <th className="text-left py-2 px-3 text-xs font-semibold text-text-secondary uppercase">Obligation</th>
                              <th className="text-right py-2 px-3 text-xs font-semibold text-text-secondary uppercase">Amount</th>
                              <th className="text-left py-2 px-3 text-xs font-semibold text-text-secondary uppercase">Date</th>
                              <th className="text-left py-2 px-3 text-xs font-semibold text-text-secondary uppercase">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {schedule.map((row: any, idx: number) => {
                              const displayAmt = ifrs15ScheduleDisplayAmount(row);
                              const status = ifrs15ScheduleRowStatus(row);
                              return (
                                <tr key={idx} className="border-b border-border-default hover:bg-orange-light">
                                  <td className="py-2 px-3 text-sm text-text-primary">{row.Period ?? row.Month ?? row.period ?? idx + 1}</td>
                                  <td className="py-2 px-3 text-sm text-text-primary">{row.Obligation ?? row.obligation ?? row.Obligation_ID ?? row.obligation_id ?? '—'}</td>
                                  <td className="py-2 px-3 text-sm text-right font-semibold amount">{formatCurrency(displayAmt, currency, 0)}</td>
                                  <td className="py-2 px-3 text-sm text-text-secondary">{row.Date ?? row.date ?? '—'}</td>
                                  <td className="py-2 px-3">
                                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${status === 'Recognised' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>{status}</span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <p className="text-sm text-text-muted">Calculate a contract to see recognition.</p>
              )}
            </>
          )}
          {activeModule === 'contract-modifications' && (
            <>
              <div className="border-b border-border-default pb-4 mb-6">
                <h3 className="text-base font-bold text-text-primary">Contract Modifications</h3>
                <p className="text-xs text-text-muted mt-1">Contract modification history</p>
              </div>
              {(results?.modifications ?? results?.disclosure_data?.contract_modifications ?? []).length > 0 ? (
                <ul className="space-y-2 list-disc list-inside text-sm text-text-primary">
                  {(results.modifications || results.disclosure_data?.contract_modifications || []).map((m: any, i: number) => (
                    <li key={i}>{typeof m === 'string' ? m : (m.description || m.date || JSON.stringify(m))}</li>
                  ))}
                </ul>
              ) : (
                <div className="p-4 bg-bg-light rounded-lg border border-border-default text-center">
                  <p className="text-sm text-text-muted">No modifications detected.</p>
                </div>
              )}
            </>
          )}
          {activeModule === 'disclosures' && (
            <>
              <div className="flex items-center justify-between border-b border-border-default pb-4 mb-6">
                <h3 className="text-lg font-bold text-text-primary">IFRS 15 DISCLOSURE NOTES</h3>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={handleCopyDisclosure} className="bg-white border border-border-default">
                    <Copy className="w-4 h-4 mr-2" /> Copy
                  </Button>
                  <Button variant="secondary" size="sm" onClick={handleDownloadPDF} className="bg-white border border-border-default">
                    <Download className="w-4 h-4 mr-2" /> Download PDF
                  </Button>
                </div>
              </div>
              {results ? (
                <pre className="whitespace-pre-wrap text-sm text-text-primary font-sans">{generateDisclosureText()}</pre>
              ) : (
                <p className="text-text-muted text-center py-8">Calculate a contract to generate disclosures.</p>
              )}
            </>
          )}
        </div>
      )}

      {/* KPI Cards - same style as IFRS 16 */}
      {results && (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-card p-5 border border-border-default shadow-card">
          <div className="h-1 bg-gradient-orange rounded-t-full -mt-5 -mx-5 mb-4"></div>
          <h4 className="text-sm font-medium text-text-secondary mb-2">Total Contract Value</h4>
            <p className="text-2xl font-bold text-text-primary amount">{displayTp == null ? '—' : formatCurrency(displayTp, currency, 0)}</p>
        </div>
        <div className="bg-white rounded-card p-5 border border-border-default shadow-card">
          <div className="h-1 bg-gradient-orange rounded-t-full -mt-5 -mx-5 mb-4"></div>
          <h4 className="text-sm font-medium text-text-secondary mb-2">Revenue Recognised</h4>
            <p className="text-2xl font-bold text-text-primary amount">{formatCurrency(rec, currency, 0)}</p>
        </div>
        <div className="bg-white rounded-card p-5 border border-border-default shadow-card">
          <div className="h-1 bg-gradient-orange rounded-t-full -mt-5 -mx-5 mb-4"></div>
            <h4 className="text-sm font-medium text-text-secondary mb-2">Deferred Revenue (Contract Liability)</h4>
            <p className={deferredKpiClass}>{deferredKpiText}</p>
        </div>
        <div className="bg-white rounded-card p-5 border border-border-default shadow-card">
          <div className="h-1 bg-gradient-pink rounded-t-full -mt-5 -mx-5 mb-4"></div>
          <div className="flex items-center gap-2 mb-2">
            <h4 className="text-sm font-medium text-text-secondary">Contract Assets</h4>
            {contractAssetNoteStr ? (
              <span title={contractAssetNoteStr} className="inline-flex cursor-help">
                <HelpCircle className="w-4 h-4 text-text-muted" aria-label={contractAssetNoteStr} />
              </span>
            ) : null}
          </div>
            <p className="text-2xl font-bold text-text-primary amount">{typeof totalContractAssets === 'number' ? formatCurrency(totalContractAssets, currency, 0) : '—'}</p>
        </div>
      </div>
      )}

      <div className="space-y-4">
        <div className="flex flex-wrap gap-2 border-b border-border-default pb-2">
          <button
            type="button"
            onClick={() => setIfrs15DashTab('portfolio')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              ifrs15DashTab === 'portfolio'
                ? 'bg-gradient-orange text-white shadow'
                : 'bg-bg-light text-text-secondary border border-border-default hover:bg-orange-light/40'
            }`}
          >
            Portfolio
          </button>
          <button
            type="button"
            onClick={() => setIfrs15DashTab('calculate')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              ifrs15DashTab === 'calculate'
                ? 'bg-gradient-orange text-white shadow'
                : 'bg-bg-light text-text-secondary border border-border-default hover:bg-orange-light/40'
            }`}
          >
            Revenue Calculate
          </button>
          <Link
            href="/dashboard/ifrs15/realestate"
            className="px-4 py-2 rounded-lg text-sm font-semibold transition-colors bg-bg-light text-text-secondary border border-border-default hover:bg-orange-light/40 inline-flex items-center gap-1.5"
          >
            <Building2 className="w-4 h-4" />
            Real Estate UAE
          </Link>
          <button
            type="button"
            onClick={() => setIfrs15DashTab('deferred-rev')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              ifrs15DashTab === 'deferred-rev'
                ? 'bg-gradient-orange text-white shadow'
                : 'bg-bg-light text-text-secondary border border-border-default hover:bg-orange-light/40'
            }`}
          >
            Deferred Revenue Rec
          </button>
          <button
            type="button"
            onClick={() => setIfrs15DashTab('rpo')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              ifrs15DashTab === 'rpo'
                ? 'bg-gradient-orange text-white shadow'
                : 'bg-bg-light text-text-secondary border border-border-default hover:bg-orange-light/40'
            }`}
          >
            RPO Disclosure
          </button>
        </div>
        <div className="flex flex-wrap gap-2 border-b border-border-default pb-2">
          <button
            type="button"
            onClick={() => setIfrs15DashTab('principal-agent')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              ifrs15DashTab === 'principal-agent'
                ? 'bg-gradient-orange text-white shadow'
                : 'bg-bg-light text-text-secondary border border-border-default hover:bg-orange-light/40'
            }`}
          >
            Principal vs Agent
          </button>
          <button
            type="button"
            onClick={() => setIfrs15DashTab('contract-costs')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              ifrs15DashTab === 'contract-costs'
                ? 'bg-gradient-orange text-white shadow'
                : 'bg-bg-light text-text-secondary border border-border-default hover:bg-orange-light/40'
            }`}
          >
            Contract Costs
          </button>
          <button
            type="button"
            onClick={() => setIfrs15DashTab('licenses-ip')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              ifrs15DashTab === 'licenses-ip'
                ? 'bg-gradient-orange text-white shadow'
                : 'bg-bg-light text-text-secondary border border-border-default hover:bg-orange-light/40'
            }`}
          >
            Licenses of IP
          </button>
          <button
            type="button"
            onClick={() => setIfrs15DashTab('audit-trail')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              ifrs15DashTab === 'audit-trail'
                ? 'bg-gradient-orange text-white shadow'
                : 'bg-bg-light text-text-secondary border border-border-default hover:bg-orange-light/40'
            }`}
          >
            Audit Trail
          </button>
        </div>
        <div className="flex flex-wrap gap-2 border-b border-border-default pb-3">
          <button
            type="button"
            onClick={() => setIfrs15DashTab('material-rights')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              ifrs15DashTab === 'material-rights'
                ? 'bg-gradient-orange text-white shadow'
                : 'bg-bg-light text-text-secondary border border-border-default hover:bg-orange-light/40'
            }`}
          >
            Material Rights
          </button>
          <button
            type="button"
            onClick={() => setIfrs15DashTab('warranties')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              ifrs15DashTab === 'warranties'
                ? 'bg-gradient-orange text-white shadow'
                : 'bg-bg-light text-text-secondary border border-border-default hover:bg-orange-light/40'
            }`}
          >
            Warranties
          </button>
          <button
            type="button"
            onClick={() => setIfrs15DashTab('bill-and-hold')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              ifrs15DashTab === 'bill-and-hold'
                ? 'bg-gradient-orange text-white shadow'
                : 'bg-bg-light text-text-secondary border border-border-default hover:bg-orange-light/40'
            }`}
          >
            Bill-and-Hold
          </button>
          <button
            type="button"
            onClick={() => setIfrs15DashTab('financing-component')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              ifrs15DashTab === 'financing-component'
                ? 'bg-gradient-orange text-white shadow'
                : 'bg-bg-light text-text-secondary border border-border-default hover:bg-orange-light/40'
            }`}
          >
            Financing Component
          </button>
          <button
            type="button"
            onClick={() => setIfrs15DashTab('tp-adjustments')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              ifrs15DashTab === 'tp-adjustments'
                ? 'bg-gradient-orange text-white shadow'
                : 'bg-bg-light text-text-secondary border border-border-default hover:bg-orange-light/40'
            }`}
          >
            TP Adjustments
          </button>
        </div>

        {ifrs15DashTab === 'portfolio' && (
          <div className="bg-white rounded-card p-6 border border-border-default shadow-card space-y-6">
            <Link
              href="/dashboard/ifrs15/realestate/portfolio"
              className="block p-4 rounded-lg border border-orange-200 bg-orange-50 hover:bg-orange-100 transition-colors"
            >
              <p className="font-semibold text-orange-900">Real Estate UAE Portfolio →</p>
              <p className="text-sm text-orange-800 mt-1">
                Cross-project KPIs, escrow compliance matrix, completion distribution, and Excel export for off-plan developments.
              </p>
            </Link>
            <div className="border-b border-border-default pb-4 flex flex-wrap justify-between gap-3 items-start">
              <div>
                <h3 className="text-lg font-bold text-text-primary">IFRS 15 PORTFOLIO DASHBOARD</h3>
                <p className="text-xs text-text-muted mt-1">Revenue intelligence across all contracts (in-memory store)</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" size="sm" onClick={() => void loadPortfolioSummary()} isLoading={portfolioLoading}>
                  Refresh
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  className="bg-gradient-orange"
                  onClick={() => void exportPortfolioDashboardExcel()}
                  isLoading={portfolioExcelLoading}
                >
                  Export Portfolio Excel
                </Button>
              </div>
            </div>

            {(() => {
              const churnPct = Number(portfolioSummaryApi.churn_rate_pct) || 0;
              const churnTone = churnPct < 3 ? 'text-emerald-700' : churnPct <= 5 ? 'text-amber-800' : 'text-red-700';
              const backlog = Number(portfolioSummaryApi.revenue_backlog) || 0;
              const mixColors = ['#2563eb', '#0d9488', '#7c3aed', '#ea580c'];
              return (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 text-center text-xs">
                    <div className="p-2 rounded border bg-bg-light">
                      <div className="text-text-muted">Total contracts</div>
                      <div className="text-lg font-bold">{String(portfolioSummaryApi.total_contracts ?? 0)}</div>
                    </div>
                    <div className="p-2 rounded border border-emerald-200 bg-emerald-50/60">
                      <div className="text-text-muted">Active</div>
                      <div className="text-lg font-bold text-emerald-800">{String(portfolioSummaryApi.active_contracts ?? 0)}</div>
                    </div>
                    <button
                      type="button"
                      className="p-2 rounded border border-amber-200 bg-amber-50/70 text-left sm:text-center hover:bg-amber-100/80 transition-colors"
                      onClick={() => setPortfolioTableFilter('at_risk')}
                    >
                      <div className="text-text-muted">At risk</div>
                      <div className="text-lg font-bold text-amber-900">{String(portfolioSummaryApi.at_risk_contracts ?? 0)}</div>
                      <div className="text-[10px] text-amber-800 hidden sm:block">Click to filter</div>
                    </button>
                    <div className="p-2 rounded border border-blue-200 bg-blue-50/60">
                      <div className="text-text-muted">ARR</div>
                      <div className="text-lg font-bold text-blue-900 amount">
                        {formatCurrency(Number(portfolioSummaryApi.total_arr) || 0, currency, 0)}
                      </div>
                    </div>
                    <div className="p-2 rounded border border-blue-100 bg-blue-50/40">
                      <div className="text-text-muted">MRR</div>
                      <div className="text-lg font-bold text-blue-800 amount">
                        {formatCurrency(Number(portfolioSummaryApi.total_mrr) || 0, currency, 0)}
                      </div>
                    </div>
                    <div className="p-2 rounded border border-amber-200 bg-amber-50/60">
                      <div className="text-text-muted">Deferred revenue</div>
                      <div className="text-lg font-bold text-amber-900 amount">
                        {formatCurrency(Number(portfolioSummaryApi.total_deferred_revenue) || 0, currency, 0)}
                      </div>
                    </div>
                    <div className="p-2 rounded border border-teal-200 bg-teal-50/60">
                      <div className="text-text-muted">Total RPO</div>
                      <div className="text-lg font-bold text-teal-900 amount">
                        {formatCurrency(Number(portfolioSummaryApi.total_rpo) || 0, currency, 0)}
                      </div>
                    </div>
                    <div className="p-2 rounded border bg-bg-light">
                      <div className="text-text-muted">Churn rate</div>
                      <div className={`text-lg font-bold ${churnTone}`}>{churnPct.toFixed(2)}%</div>
                    </div>
                  </div>

                  <div className="rounded-2xl border-2 border-orange-200 bg-gradient-to-br from-orange-50 to-white p-6 text-center space-y-1">
                    <p className="text-sm font-semibold text-text-primary">Revenue backlog = Deferred + RPO</p>
                    <p className="text-4xl md:text-5xl font-extrabold text-orange-primary amount">{formatCurrency(backlog, currency, 0)}</p>
                    <p className="text-xs text-text-muted">Contracted but unearned revenue</p>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="border rounded-lg p-4 min-h-[260px]">
                      <p className="text-sm font-bold text-text-primary mb-2">Contract mix (ARR by type)</p>
                      <div className="h-[220px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Tooltip formatter={(v) => formatCurrency(Number(v ?? 0) || 0, currency, 0)} />
                            <Pie data={contractMixPie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={88}>
                              {contractMixPie.map((_, i) => (
                                <Cell key={i} fill={mixColors[i % mixColors.length]} />
                              ))}
                            </Pie>
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                    <div className="border rounded-lg p-4 min-h-[260px]">
                      <p className="text-sm font-bold text-text-primary mb-2">Status distribution</p>
                      <div className="h-[220px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={statusStackBar} layout="vertical" margin={{ left: 8, right: 16 }}>
                            <XAxis type="number" allowDecimals={false} />
                            <YAxis type="category" dataKey="name" width={72} />
                            <Tooltip />
                            <Legend />
                            <Bar dataKey="active" name="Active" stackId="s" fill="#22c55e" />
                            <Bar dataKey="at_risk" name="At risk" stackId="s" fill="#f59e0b" />
                            <Bar dataKey="churned" name="Churned" stackId="s" fill="#ef4444" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex flex-wrap justify-between gap-2 items-center">
                      <h4 className="text-base font-bold text-text-primary">Contract portfolio</h4>
                      <div className="flex flex-wrap gap-2">
                        {(['all', 'active', 'at_risk', 'churned'] as const).map((f) => (
                          <button
                            key={f}
                            type="button"
                            onClick={() => setPortfolioTableFilter(f)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                              portfolioTableFilter === f
                                ? 'bg-gradient-orange text-white border-orange-primary'
                                : 'bg-white text-text-secondary border-border-default'
                            }`}
                          >
                            {f === 'all' ? 'All' : f === 'active' ? 'Active' : f === 'at_risk' ? 'At risk' : 'Churned'}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="overflow-x-auto border rounded-lg">
                      <table className="w-full text-sm">
                        <thead className="bg-bg-light">
                          <tr>
                            <th className="text-left p-2">Contract ID</th>
                            <th className="text-left p-2">Customer</th>
                            <th className="text-left p-2">Type</th>
                            <th className="text-right p-2">ARR</th>
                            <th className="text-right p-2">Deferred</th>
                            <th className="text-right p-2">RPO</th>
                            <th className="text-left p-2">Status</th>
                            <th className="text-right p-2">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {portfolioPagedContracts.length === 0 ? (
                            <tr>
                              <td colSpan={8} className="p-6 text-center text-text-muted">
                                No contracts match this filter. Add a contract below.
                              </td>
                            </tr>
                          ) : (
                            portfolioPagedContracts.map((row) => {
                              const cid = String(row.contract_id ?? '');
                              const st = String(row.status ?? 'active');
                              const ccy = String(row.currency || currency);
                              const badge =
                                st === 'active' ? (
                                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-900">active</span>
                                ) : st === 'at_risk' ? (
                                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-900 inline-flex items-center gap-1">
                                    <AlertTriangle className="w-3 h-3" /> at risk
                                  </span>
                                ) : st === 'churned' ? (
                                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-900">churned</span>
                                ) : (
                                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-900">renewed</span>
                                );
                              return (
                                <tr key={cid} className="border-t border-border-default">
                                  <td className="p-2 font-mono text-xs">{cid}</td>
                                  <td className="p-2 max-w-[160px] truncate" title={String(row.customer_name ?? '')}>
                                    {String(row.customer_name ?? '—')}
                                  </td>
                                  <td className="p-2 text-xs">{String(row.contract_type ?? '').replace(/_/g, ' ')}</td>
                                  <td className="p-2 text-right amount">{formatCurrency(Number(row.arr) || 0, ccy, 0)}</td>
                                  <td className="p-2 text-right amount">{formatCurrency(Number(row.deferred_balance) || 0, ccy, 0)}</td>
                                  <td className="p-2 text-right amount">{formatCurrency(Number(row.rpo_amount) || 0, ccy, 0)}</td>
                                  <td className="p-2">{badge}</td>
                                  <td className="p-2 text-right">
                                    <button
                                      type="button"
                                      className="text-xs text-red-600 underline"
                                      onClick={() => void removePortfolioContractRow(cid)}
                                      disabled={portfolioSaving}
                                    >
                                      Remove
                                    </button>
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                    {portfolioFilteredContracts.length > PORTFOLIO_PAGE_SIZE && (
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-muted">
                        <span>
                          Page {portfolioPageClamped} / {portfolioTotalPages}
                        </span>
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={portfolioPageClamped <= 1}
                            onClick={() => setPortfolioPage((p) => Math.max(1, p - 1))}
                          >
                            Previous
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={portfolioPageClamped >= portfolioTotalPages}
                            onClick={() => setPortfolioPage((p) => Math.min(portfolioTotalPages, p + 1))}
                          >
                            Next
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="border rounded-lg border-dashed border-orange-300 p-4 space-y-3">
                    <button
                      type="button"
                      className="flex items-center gap-2 text-sm font-bold text-orange-primary"
                      onClick={() => setPortfolioAddOpen((o) => !o)}
                    >
                      {portfolioAddOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      Add contract to portfolio
                    </button>
                    {portfolioAddOpen && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                        <div>
                          <label className="block text-xs text-text-muted mb-1">Contract ID</label>
                          <input
                            className="w-full px-2 py-1.5 border rounded"
                            value={portfolioAddForm.contract_id}
                            onChange={(e) => setPortfolioAddForm((f) => ({ ...f, contract_id: e.target.value }))}
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-text-muted mb-1">Customer name</label>
                          <input
                            className="w-full px-2 py-1.5 border rounded"
                            value={portfolioAddForm.customer_name}
                            onChange={(e) => setPortfolioAddForm((f) => ({ ...f, customer_name: e.target.value }))}
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-text-muted mb-1">Contract type</label>
                          <select
                            className="w-full px-2 py-1.5 border rounded"
                            value={portfolioAddForm.contract_type}
                            onChange={(e) => setPortfolioAddForm((f) => ({ ...f, contract_type: e.target.value }))}
                          >
                            <option value="subscription">Subscription</option>
                            <option value="professional_services">Professional services</option>
                            <option value="license">License</option>
                            <option value="usage_based">Usage-based</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-text-muted mb-1">Status</label>
                          <select
                            className="w-full px-2 py-1.5 border rounded"
                            value={portfolioAddForm.status}
                            onChange={(e) => setPortfolioAddForm((f) => ({ ...f, status: e.target.value }))}
                          >
                            <option value="active">Active</option>
                            <option value="at_risk">At risk</option>
                            <option value="churned">Churned</option>
                            <option value="renewed">Renewed</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-text-muted mb-1">ARR</label>
                          <input
                            type="number"
                            className="w-full px-2 py-1.5 border rounded"
                            value={portfolioAddForm.arr || ''}
                            onChange={(e) => setPortfolioAddForm((f) => ({ ...f, arr: Number(e.target.value) || 0 }))}
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-text-muted mb-1">MRR</label>
                          <input
                            type="number"
                            className="w-full px-2 py-1.5 border rounded"
                            value={portfolioAddForm.mrr || ''}
                            onChange={(e) => setPortfolioAddForm((f) => ({ ...f, mrr: Number(e.target.value) || 0 }))}
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-text-muted mb-1">Start date</label>
                          <input
                            type="date"
                            className="w-full px-2 py-1.5 border rounded"
                            value={portfolioAddForm.start_date}
                            onChange={(e) => setPortfolioAddForm((f) => ({ ...f, start_date: e.target.value }))}
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-text-muted mb-1">End date</label>
                          <input
                            type="date"
                            className="w-full px-2 py-1.5 border rounded"
                            value={portfolioAddForm.end_date}
                            onChange={(e) => setPortfolioAddForm((f) => ({ ...f, end_date: e.target.value }))}
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-text-muted mb-1">Total TP</label>
                          <input
                            type="number"
                            className="w-full px-2 py-1.5 border rounded"
                            value={portfolioAddForm.total_tp || ''}
                            onChange={(e) => setPortfolioAddForm((f) => ({ ...f, total_tp: Number(e.target.value) || 0 }))}
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-text-muted mb-1">Recognised to date</label>
                          <input
                            type="number"
                            className="w-full px-2 py-1.5 border rounded"
                            value={portfolioAddForm.recognised_to_date || ''}
                            onChange={(e) => setPortfolioAddForm((f) => ({ ...f, recognised_to_date: Number(e.target.value) || 0 }))}
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-text-muted mb-1">Deferred balance</label>
                          <input
                            type="number"
                            className="w-full px-2 py-1.5 border rounded"
                            value={portfolioAddForm.deferred_balance || ''}
                            onChange={(e) => setPortfolioAddForm((f) => ({ ...f, deferred_balance: Number(e.target.value) || 0 }))}
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-text-muted mb-1">RPO amount</label>
                          <input
                            type="number"
                            className="w-full px-2 py-1.5 border rounded"
                            value={portfolioAddForm.rpo_amount || ''}
                            onChange={(e) => setPortfolioAddForm((f) => ({ ...f, rpo_amount: Number(e.target.value) || 0 }))}
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-text-muted mb-1">Currency</label>
                          <select
                            className="w-full px-2 py-1.5 border rounded"
                            value={portfolioAddForm.currency}
                            onChange={(e) => setPortfolioAddForm((f) => ({ ...f, currency: e.target.value }))}
                          >
                            <option value="USD">USD</option>
                            <option value="GBP">GBP</option>
                            <option value="EUR">EUR</option>
                            <option value="INR">INR</option>
                          </select>
                        </div>
                        <div className="md:col-span-2 flex flex-wrap gap-2">
                          <Button type="button" variant="secondary" size="sm" onClick={() => void fillPortfolioFromLastCalculation()}>
                            Add from last calculation
                          </Button>
                          <Button
                            type="button"
                            variant="primary"
                            size="sm"
                            className="bg-gradient-orange flex-1 min-w-[200px]"
                            onClick={() => void savePortfolioContract()}
                            isLoading={portfolioSaving}
                          >
                            Save to portfolio
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>

                  {(atRiskPortfolioRows.length > 0 || churnPct > 5) && (
                    <div className="space-y-3 border-t pt-4">
                      <p className="text-sm font-bold text-text-primary">Exception alerts</p>
                      {atRiskPortfolioRows.length > 0 && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4 space-y-2">
                          <p className="text-sm font-semibold text-amber-950 flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4" /> At-risk contracts
                          </p>
                          <ul className="text-sm space-y-1 list-disc pl-5">
                            {atRiskPortfolioRows.map((c) => (
                              <li key={String(c.contract_id)}>
                                <span className="font-medium">{String(c.customer_name || c.contract_id)}</span>
                                {' — ARR '}
                                <span className="amount">{formatCurrency(Number(c.arr) || 0, String(c.currency || currency), 0)}</span>
                                <span className="text-text-muted"> (flagged at risk)</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {churnPct > 5 && (
                        <div className="rounded-lg border border-red-200 bg-red-50/50 p-4 text-sm text-red-900">
                          Churn rate {churnPct.toFixed(2)}% exceeds 5% threshold. Flag to FP&A for revenue forecast update.
                        </div>
                      )}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}

        {ifrs15DashTab === 'deferred-rev' && (
          <div className="bg-white rounded-card p-6 border border-border-default shadow-card space-y-6">
            <div className="border-b border-border-default pb-4">
              <h3 className="text-base font-bold text-text-primary">Deferred Revenue Roll-Forward</h3>
              <p className="text-xs text-text-muted mt-1">Reconciliation — IFRS 15.116</p>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="space-y-3">
                <div>
                  <label className="block text-sm text-text-primary mb-1">Period</label>
                  <input
                    className="w-full px-3 py-2 border border-border-default rounded-lg"
                    placeholder="e.g. 2025-Q1"
                    value={drForm.period}
                    onChange={(e) => setDrForm((p) => ({ ...p, period: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-sm text-text-primary mb-1">Currency</label>
                  <select
                    className="w-full px-3 py-2 border border-border-default rounded-lg"
                    value={drForm.currency}
                    onChange={(e) => setDrForm((p) => ({ ...p, currency: e.target.value }))}
                  >
                    <option value="USD">USD</option>
                    <option value="GBP">GBP</option>
                    <option value="EUR">EUR</option>
                    <option value="INR">INR</option>
                  </select>
                </div>
                {(
                  [
                    ['opening_balance', 'Opening Balance'],
                    ['new_bookings', 'New Bookings'],
                    ['revenue_released', 'Revenue Released'],
                    ['cancellations', 'Cancellations'],
                    ['modifications_impact', 'Modifications (net)'],
                    ['fx_impact', 'FX Impact'],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key}>
                    <label className="block text-sm text-text-primary mb-1">{label}</label>
                    <input
                      type="number"
                      className="w-full px-3 py-2 border border-border-default rounded-lg"
                      value={(drForm as any)[key]}
                      onChange={(e) =>
                        setDrForm((p) => ({ ...p, [key]: Number(e.target.value || 0) }))
                      }
                    />
                  </div>
                ))}
                <div>
                  <label className="block text-sm font-semibold text-blue-800 mb-1">GL Closing Balance (control total)</label>
                  <input
                    type="number"
                    className="w-full px-3 py-2 border-2 border-blue-300 rounded-lg bg-blue-50/40"
                    value={drForm.gl_closing_balance}
                    onChange={(e) =>
                      setDrForm((p) => ({ ...p, gl_closing_balance: Number(e.target.value || 0) }))
                    }
                  />
                </div>
                <Button
                  variant="primary"
                  className="w-full bg-gradient-orange"
                  onClick={runDeferredRevenueRollforward}
                  isLoading={drLoading}
                >
                  Run Reconciliation
                </Button>
              </div>
              <div className="space-y-4">
                {drResultsStack.map((rf, idx) => {
                  const lines = (rf.rollforward_lines as any[]) || [];
                  const variance = Number(rf.variance ?? 0);
                  const rec = Boolean(rf.reconciled);
                  const rel = Number(rf.release_rate_pct ?? 0);
                  const churn = Number(rf.churn_rate_pct ?? 0);
                  const excs = (rf.exceptions as any[]) || [];
                  return (
                    <div key={idx} className="border border-border-default rounded-lg p-4 space-y-3 bg-bg-light/30">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <span className="text-sm font-semibold text-text-primary">{String(rf.period)}</span>
                        <span
                          className={`text-xs font-bold px-3 py-1 rounded-full ${
                            rec ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {rec ? 'Reconciled' : 'Variance identified'}
                        </span>
                      </div>
                      <div className="overflow-x-auto border border-border-default rounded-lg bg-white">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-bg-light border-b border-border-default">
                              <th className="text-left py-2 px-3">Line Item</th>
                              <th className="text-right py-2 px-3">Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {lines.map((ln: any, i: number) => {
                              const lt = String(ln.type || '');
                              const amt = Number(ln.amount ?? 0);
                              const rowBg =
                                lt === 'opening'
                                  ? 'bg-gray-100'
                                  : lt === 'subtotal'
                                    ? 'bg-blue-50 font-semibold'
                                    : lt === 'variance'
                                      ? Math.abs(variance) < 0.01
                                        ? 'bg-green-50'
                                        : 'bg-red-50'
                                      : '';
                              const borderL =
                                lt === 'addition'
                                  ? 'border-l-4 border-l-green-500'
                                  : lt === 'deduction'
                                    ? 'border-l-4 border-l-red-400'
                                    : '';
                              return (
                                <tr key={i} className={`border-b border-border-default ${rowBg} ${borderL}`}>
                                  <td className="py-2 px-3">{ln.line}</td>
                                  <td className="py-2 px-3 text-right amount">{formatCurrency(amt, String(rf.currency || 'USD'), 0)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <p className={`text-lg font-bold ${Math.abs(variance) < 0.01 ? 'text-green-700' : 'text-red-700'}`}>
                        Variance: {formatCurrency(variance, String(rf.currency || 'USD'), 0)}
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div
                          className={`p-2 rounded border text-center text-xs ${
                            rel > 15 ? 'border-red-300 bg-red-50' : rel > 10 ? 'border-amber-300 bg-amber-50' : 'border-border-default'
                          }`}
                        >
                          <div className="text-text-muted">Release rate</div>
                          <div className="font-bold">{rel.toFixed(1)}%</div>
                        </div>
                        <div
                          className={`p-2 rounded border text-center text-xs ${
                            churn > 3 ? 'border-red-300 bg-red-50' : churn > 2 ? 'border-amber-300 bg-amber-50' : 'border-border-default'
                          }`}
                        >
                          <div className="text-text-muted">Churn rate</div>
                          <div className="font-bold">{churn.toFixed(1)}%</div>
                        </div>
                        <div
                          className={`p-2 rounded border text-center text-xs ${
                            Math.abs(variance) < 0.01 ? 'border-green-300 bg-green-50' : 'border-red-300 bg-red-50'
                          }`}
                        >
                          <div className="text-text-muted">Variance</div>
                          <div className="font-bold amount">{formatCurrency(variance, String(rf.currency || 'USD'), 0)}</div>
                        </div>
                      </div>
                      {excs.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-sm font-bold text-text-primary">Exceptions requiring investigation</p>
                          {excs.map((ex: any, j: number) => (
                            <div key={j} className="p-3 rounded border border-border-default bg-white text-sm">
                              <span
                                className={`text-xs font-bold px-2 py-0.5 rounded ${
                                  ex.severity === 'HIGH'
                                    ? 'bg-red-600 text-white'
                                    : ex.severity === 'MEDIUM'
                                      ? 'bg-orange-500 text-white'
                                      : 'bg-gray-200 text-gray-800'
                                }`}
                              >
                                {ex.severity}
                              </span>
                              <p className="font-semibold mt-2">{ex.type}</p>
                              <p className="text-text-secondary mt-1">{ex.description}</p>
                              <p className="text-blue-800 italic mt-2 text-xs">{ex.action}</p>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="p-3 rounded-lg bg-orange-light/40 border border-orange-border text-sm text-text-secondary">
                        {churn > 3 ? (
                          <p>
                            Churn rate of {churn.toFixed(1)}% is above threshold. Flag to FP&A — revenue forecast may require downward revision.
                          </p>
                        ) : rec ? (
                          <p>
                            Deferred revenue reconciliation complete. Balance of{' '}
                            {formatCurrency(Number(rf.gl_closing_balance ?? 0), String(rf.currency || 'USD'), 0)} is fully supported.
                          </p>
                        ) : (
                          <p>Review variance and exception actions before sign-off.</p>
                        )}
                      </div>
                    </div>
                  );
                })}
                {drResultsStack.length === 0 && (
                  <p className="text-sm text-text-muted">Run a reconciliation to see results here. Multiple runs stack above.</p>
                )}
              </div>
            </div>
          </div>
        )}
        {ifrs15DashTab === 'rpo' && (
          <div className="bg-white rounded-card p-6 border border-border-default shadow-card space-y-6">
            <div className="border-b border-border-default pb-4">
              <h3 className="text-lg font-bold text-text-primary">REMAINING PERFORMANCE OBLIGATIONS</h3>
              <p className="text-xs text-text-muted mt-1">IFRS 15.120-122 — Mandatory Disclosure</p>
            </div>
            <div className="rounded-lg border border-border-default bg-bg-light p-4 text-sm text-text-secondary">
              IFRS 15.120 requires disclosure of the aggregate transaction price allocated to unsatisfied performance obligations at period end, and when the entity expects to recognise that revenue. This note is required in the annual report of any listed company.
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" className="bg-white border border-border-default" onClick={() => setRpo120Contracts((c) => [...c, newRpo120Contract()])}>
                <Plus className="w-4 h-4 mr-1" /> Add Contract
              </Button>
              {results && typeof displayTp === 'number' && !Number.isNaN(displayTp) && (
                <Button
                  type="button"
                  variant="secondary"
                  className="bg-white border border-border-default"
                  onClick={() => {
                    const r = typeof rec === 'number' && !Number.isNaN(rec) ? rec : 0;
                    setRpo120Contracts((c) => [
                      ...c,
                      {
                        ...newRpo120Contract(),
                        total_transaction_price: displayTp,
                        revenue_recognised_to_date: r,
                        performance_obligations: perfObs.length
                          ? perfObs.map((p: any, i: number) => ({
                              id: newUid(),
                              name: String(p.obligation || p.description || p.obligation_id || `PO ${i + 1}`),
                              allocated_amount: Number(p.allocated_amount ?? 0),
                              recognised_to_date: Number(p.recognised_to_date ?? p.revenue_recognized ?? 0),
                              expected_recognition_pattern: 'within_1_year' as Rpo120Pattern,
                              recognition_type: (String(p.recognition_method || '').includes('point') ? 'point_in_time' : 'over_time') as 'over_time' | 'point_in_time',
                            }))
                          : [newRpo120Po()],
                      },
                    ]);
                    toast.success('Contract prefilled from calculation');
                  }}
                >
                  Add from last calculation
                </Button>
              )}
            </div>
            <div className="space-y-4">
              {rpo120Contracts.map((ctr) => (
                <div key={ctr.id} className="border border-border-default rounded-lg p-4 space-y-3 bg-bg-light/20">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-text-muted mb-1">Contract ID</label>
                      <input
                        className="w-full px-3 py-2 border border-border-default rounded-lg text-sm"
                        value={ctr.contract_id}
                        onChange={(e) =>
                          setRpo120Contracts((list) => list.map((x) => (x.id === ctr.id ? { ...x, contract_id: e.target.value } : x)))
                        }
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-text-muted mb-1">Customer Name</label>
                      <input
                        className="w-full px-3 py-2 border border-border-default rounded-lg text-sm"
                        value={ctr.customer_name}
                        onChange={(e) =>
                          setRpo120Contracts((list) => list.map((x) => (x.id === ctr.id ? { ...x, customer_name: e.target.value } : x)))
                        }
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-text-muted mb-1">Contract Start</label>
                      <input
                        type="date"
                        className="w-full px-3 py-2 border border-border-default rounded-lg text-sm"
                        value={ctr.contract_start}
                        onChange={(e) =>
                          setRpo120Contracts((list) => list.map((x) => (x.id === ctr.id ? { ...x, contract_start: e.target.value } : x)))
                        }
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-text-muted mb-1">Contract End</label>
                      <input
                        type="date"
                        className="w-full px-3 py-2 border border-border-default rounded-lg text-sm"
                        value={ctr.contract_end}
                        onChange={(e) =>
                          setRpo120Contracts((list) => list.map((x) => (x.id === ctr.id ? { ...x, contract_end: e.target.value } : x)))
                        }
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-text-muted mb-1">Total Transaction Price</label>
                      <input
                        type="number"
                        className="w-full px-3 py-2 border border-border-default rounded-lg text-sm"
                        value={ctr.total_transaction_price || ''}
                        onChange={(e) =>
                          setRpo120Contracts((list) =>
                            list.map((x) => (x.id === ctr.id ? { ...x, total_transaction_price: Number(e.target.value) || 0 } : x)),
                          )
                        }
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-text-muted mb-1">Revenue Recognised to Date</label>
                      <input
                        type="number"
                        className="w-full px-3 py-2 border border-border-default rounded-lg text-sm"
                        value={ctr.revenue_recognised_to_date || ''}
                        onChange={(e) =>
                          setRpo120Contracts((list) =>
                            list.map((x) => (x.id === ctr.id ? { ...x, revenue_recognised_to_date: Number(e.target.value) || 0 } : x)),
                          )
                        }
                      />
                    </div>
                  </div>
                  <label className="flex items-start gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={ctr.practical_expedient_applied}
                      onChange={(e) =>
                        setRpo120Contracts((list) =>
                          list.map((x) => (x.id === ctr.id ? { ...x, practical_expedient_applied: e.target.checked } : x)),
                        )
                      }
                      className="mt-1"
                    />
                    <span>
                      <span className="font-semibold text-text-primary">Practical Expedient</span> — Exclude — original term ≤ 1 year (IFRS 15.121a)
                    </span>
                  </label>
                  {!ctr.practical_expedient_applied && (
                    <div className="pl-2 border-l-2 border-orange-200 space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-text-primary">Performance Obligations</p>
                        <button
                          type="button"
                          className="text-sm text-orange-primary font-medium"
                          onClick={() =>
                            setRpo120Contracts((list) =>
                              list.map((x) => (x.id === ctr.id ? { ...x, performance_obligations: [...x.performance_obligations, newRpo120Po()] } : x)),
                            )
                          }
                        >
                          + Add PO
                        </button>
                      </div>
                      {ctr.performance_obligations.map((po) => (
                        <div key={po.id} className="grid grid-cols-1 md:grid-cols-2 gap-2 p-3 bg-white rounded border border-border-default">
                          <div className="md:col-span-2">
                            <label className="block text-xs text-text-muted mb-1">Name</label>
                            <input
                              className="w-full px-2 py-1.5 border border-border-default rounded text-sm"
                              value={po.name}
                              onChange={(e) =>
                                setRpo120Contracts((list) =>
                                  list.map((x) =>
                                    x.id !== ctr.id
                                      ? x
                                      : {
                                          ...x,
                                          performance_obligations: x.performance_obligations.map((p) =>
                                            p.id === po.id ? { ...p, name: e.target.value } : p,
                                          ),
                                        },
                                  ),
                                )
                              }
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-text-muted mb-1">Allocated Amount</label>
                            <input
                              type="number"
                              className="w-full px-2 py-1.5 border border-border-default rounded text-sm"
                              value={po.allocated_amount || ''}
                              onChange={(e) =>
                                setRpo120Contracts((list) =>
                                  list.map((x) =>
                                    x.id !== ctr.id
                                      ? x
                                      : {
                                          ...x,
                                          performance_obligations: x.performance_obligations.map((p) =>
                                            p.id === po.id ? { ...p, allocated_amount: Number(e.target.value) || 0 } : p,
                                          ),
                                        },
                                  ),
                                )
                              }
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-text-muted mb-1">Recognised to Date</label>
                            <input
                              type="number"
                              className="w-full px-2 py-1.5 border border-border-default rounded text-sm"
                              value={po.recognised_to_date || ''}
                              onChange={(e) =>
                                setRpo120Contracts((list) =>
                                  list.map((x) =>
                                    x.id !== ctr.id
                                      ? x
                                      : {
                                          ...x,
                                          performance_obligations: x.performance_obligations.map((p) =>
                                            p.id === po.id ? { ...p, recognised_to_date: Number(e.target.value) || 0 } : p,
                                          ),
                                        },
                                  ),
                                )
                              }
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-text-muted mb-1">Expected Recognition</label>
                            <select
                              className="w-full px-2 py-1.5 border border-border-default rounded text-sm"
                              value={po.expected_recognition_pattern}
                              onChange={(e) =>
                                setRpo120Contracts((list) =>
                                  list.map((x) =>
                                    x.id !== ctr.id
                                      ? x
                                      : {
                                          ...x,
                                          performance_obligations: x.performance_obligations.map((p) =>
                                            p.id === po.id ? { ...p, expected_recognition_pattern: e.target.value as Rpo120Pattern } : p,
                                          ),
                                        },
                                  ),
                                )
                              }
                            >
                              <option value="within_1_year">Within 1 year</option>
                              <option value="1_to_2_years">1–2 years</option>
                              <option value="2_to_5_years">2–5 years</option>
                              <option value="beyond_5_years">Beyond 5 years</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs text-text-muted mb-1">Type</label>
                            <select
                              className="w-full px-2 py-1.5 border border-border-default rounded text-sm"
                              value={po.recognition_type}
                              onChange={(e) =>
                                setRpo120Contracts((list) =>
                                  list.map((x) =>
                                    x.id !== ctr.id
                                      ? x
                                      : {
                                          ...x,
                                          performance_obligations: x.performance_obligations.map((p) =>
                                            p.id === po.id
                                              ? { ...p, recognition_type: e.target.value as 'over_time' | 'point_in_time' }
                                              : p,
                                          ),
                                        },
                                  ),
                                )
                              }
                            >
                              <option value="over_time">Over time</option>
                              <option value="point_in_time">Point in time</option>
                            </select>
                          </div>
                          <div className="md:col-span-2 text-right">
                            <button
                              type="button"
                              className="text-xs text-red-600 underline"
                              onClick={() =>
                                setRpo120Contracts((list) =>
                                  list.map((x) =>
                                    x.id !== ctr.id
                                      ? x
                                      : {
                                          ...x,
                                          performance_obligations:
                                            x.performance_obligations.filter((p) => p.id !== po.id).length > 0
                                              ? x.performance_obligations.filter((p) => p.id !== po.id)
                                              : [newRpo120Po()],
                                        },
                                  ),
                                )
                              }
                            >
                              Remove PO
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    className="text-sm text-red-600 underline"
                    onClick={() => setRpo120Contracts((list) => list.filter((x) => x.id !== ctr.id))}
                  >
                    Remove Contract
                  </button>
                </div>
              ))}
              {rpo120Contracts.length === 0 && <p className="text-sm text-text-muted">No contracts yet — add one to begin.</p>}
            </div>
            <Button variant="primary" className="w-full bg-gradient-orange" onClick={runRpo120Cal} isLoading={rpo120Loading}>
              Calculate RPO
            </Button>
            {rpo120Result && (
              <div className="space-y-6 border-t border-border-default pt-6">
                {(() => {
                  const b = (rpo120Result.buckets as Record<string, number>) || {};
                  const total = Number(rpo120Result.total_rpo ?? 0) || 0;
                  const w = Number(b.within_1_year ?? 0) || 0;
                  const mid = (Number(b['1_to_2_years'] ?? 0) || 0) + (Number(b['2_to_5_years'] ?? 0) || 0);
                  const b5 = Number(b.beyond_5_years ?? 0) || 0;
                  const denom = total > 0 ? total : 1;
                  return (
                    <>
                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        <div className="rounded-lg border border-blue-200 p-3 bg-blue-50/50">
                          <p className="text-xs text-text-muted">Total RPO</p>
                          <p className="text-xl font-bold text-blue-800 amount">{formatCurrency(total, currency, 0)}</p>
                        </div>
                        <div className="rounded-lg border border-green-200 p-3 bg-green-50/50">
                          <p className="text-xs text-text-muted">Within 1 Year</p>
                          <p className="text-lg font-bold text-green-800 amount">{formatCurrency(w, currency, 0)}</p>
                        </div>
                        <div className="rounded-lg border border-amber-200 p-3 bg-amber-50/50">
                          <p className="text-xs text-text-muted">1–5 Years</p>
                          <p className="text-lg font-bold text-amber-900 amount">{formatCurrency(mid, currency, 0)}</p>
                        </div>
                        <div className="rounded-lg border border-orange-300 p-3 bg-orange-50/60">
                          <p className="text-xs text-text-muted">Beyond 5 Years</p>
                          <p className="text-lg font-bold text-orange-900 amount">{formatCurrency(b5, currency, 0)}</p>
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-text-muted mb-2">Time buckets (share of total RPO)</p>
                        <div className="h-10 rounded-lg overflow-hidden flex w-full border border-border-default">
                          <div className="h-full bg-green-500 flex items-center justify-center text-white text-xs font-semibold px-1" style={{ width: `${(w / denom) * 100}%` }} title="Within 1y">
                            {w > 0 ? formatCurrency(w, currency, 0) : ''}
                          </div>
                          <div className="h-full bg-amber-400 flex items-center justify-center text-amber-950 text-xs font-semibold px-1" style={{ width: `${(mid / denom) * 100}%` }}>
                            {mid > 0 ? formatCurrency(mid, currency, 0) : ''}
                          </div>
                          <div className="h-full bg-orange-600 flex items-center justify-center text-white text-xs font-semibold px-1" style={{ width: `${(b5 / denom) * 100}%` }}>
                            {b5 > 0 ? formatCurrency(b5, currency, 0) : ''}
                          </div>
                          <div className="h-full bg-red-600 flex-1 min-w-[2px]" style={{ width: `${Math.max(0, 100 - ((w + mid + b5) / denom) * 100)}%` }} />
                        </div>
                      </div>
                    </>
                  );
                })()}
                <div className="overflow-x-auto border border-border-default rounded-lg">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-bg-light">
                        <th className="text-left py-2 px-2">Contract</th>
                        <th className="text-left py-2 px-2">Customer</th>
                        <th className="text-left py-2 px-2">End</th>
                        <th className="text-right py-2 px-2">Total TP</th>
                        <th className="text-right py-2 px-2">Recognised</th>
                        <th className="text-right py-2 px-2">RPO</th>
                      </tr>
                    </thead>
                    <tbody>
                      {((rpo120Result.contract_details as any[]) || []).map((row: any) => (
                        <Fragment key={String(row.contract_id)}>
                          <tr className="border-t border-border-default cursor-pointer hover:bg-bg-light/50" onClick={() => setRpo120Expanded((m) => ({ ...m, [row.contract_id]: !m[row.contract_id] }))}>
                            <td className="py-2 px-2 font-medium">{row.contract_id}</td>
                            <td className="py-2 px-2">{row.customer_name}</td>
                            <td className="py-2 px-2">{row.contract_end}</td>
                            <td className="py-2 px-2 text-right amount">{formatCurrency(Number(row.total_transaction_price ?? 0), currency, 0)}</td>
                            <td className="py-2 px-2 text-right amount">{formatCurrency(Number(row.revenue_recognised_to_date ?? 0), currency, 0)}</td>
                            <td className="py-2 px-2 text-right font-semibold amount">{formatCurrency(Number(row.rpo_amount ?? 0), currency, 0)}</td>
                          </tr>
                          {rpo120Expanded[row.contract_id] && (
                            <tr className="bg-bg-light/40">
                              <td colSpan={6} className="px-4 py-2 text-xs text-text-secondary">
                                {(row.performance_obligations as any[]).map((po: any) => (
                                  <div key={po.name} className="flex flex-wrap gap-2 py-1 border-b border-border-default last:border-0">
                                    <span className="font-medium text-text-primary">{po.name}</span>
                                    <span>RPO {formatCurrency(Number(po.rpo_amount ?? 0), currency, 0)}</span>
                                    <span className="text-text-muted">{po.recognition_pattern}</span>
                                    <span className="text-text-muted">{po.recognition_type}</span>
                                  </div>
                                ))}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))}
                      {((rpo120Result.expedient_contracts as any[]) || []).map((row: any) => (
                        <tr key={`exp-${row.contract_id}`} className="border-t border-border-default bg-gray-100 text-text-muted">
                          <td className="py-2 px-2">{row.contract_id}</td>
                          <td className="py-2 px-2" colSpan={4}>
                            (Practical expedient applied)
                          </td>
                          <td className="py-2 px-2 text-right text-xs">Excluded</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="rounded-lg border border-border-default p-4 bg-bg-light/40">
                  <p className="font-bold text-text-primary mb-2">{(rpo120Result.disclosure_note as any)?.title || 'Note: Remaining Performance Obligations'}</p>
                  <pre className="font-serif text-sm whitespace-pre-wrap text-text-primary leading-relaxed">
                    {String((rpo120Result.disclosure_note as any)?.full_text || '')}
                  </pre>
                  <div className="flex flex-wrap gap-2 mt-4">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="bg-white border border-border-default"
                      onClick={() =>
                        navigator.clipboard
                          .writeText(String((rpo120Result.disclosure_note as any)?.full_text || ''))
                          .then(() => toast.success('Copied'))
                          .catch(() => toast.error('Copy failed'))
                      }
                    >
                      <Copy className="w-4 h-4 mr-1" /> Copy Note
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="bg-white border border-border-default"
                      onClick={() => {
                        const t = String((rpo120Result.disclosure_note as any)?.full_text || '');
                        const blob = new Blob([t], { type: 'text/plain' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `IFRS15_RPO_Disclosure_${new Date().toISOString().slice(0, 10)}.txt`;
                        a.click();
                        URL.revokeObjectURL(url);
                        toast.success('Downloaded as .txt');
                      }}
                    >
                      <Download className="w-4 h-4 mr-1" /> Download (.txt)
                    </Button>
                  </div>
                  <p className="text-xs text-text-muted mt-3">{String(rpo120Result.ifrs_reference || 'IFRS 15.120-122')}</p>
                </div>
                <div className="text-sm space-y-1 border border-dashed border-border-default rounded-lg p-3">
                  <p className="font-semibold text-text-primary">Audit checklist</p>
                  <p>✅ Aggregate RPO amount disclosed</p>
                  <p>✅ Expected recognition timing disclosed</p>
                  <p>{Number(rpo120Result.expedient_contracts_excluded ?? 0) > 0 ? '✅' : '—'} Practical expedient disclosed (if applied)</p>
                  <p>✅ Variable consideration constraint noted</p>
                  <p>✅ RPO reconciles to contract details</p>
                </div>
              </div>
            )}
          </div>
        )}
        {ifrs15DashTab === 'principal-agent' && (
          <div className="bg-white rounded-card p-6 border border-border-default shadow-card space-y-6">
            <div className="border-b border-border-default pb-4">
              <h3 className="text-lg font-bold text-text-primary">PRINCIPAL vs AGENT ASSESSMENT</h3>
              <p className="text-xs text-text-muted mt-1">IFRS 15.B34-B38</p>
            </div>
            <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-4 text-sm text-text-secondary">
              Determines whether revenue is recognised GROSS (full contract value) or NET (margin only) when a third party is involved. The key question: does the entity CONTROL the good or service before transferring it to the customer? (IFRS 15.B35)
            </div>
            {paExtHistory.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-text-primary">Past assessments</p>
                {paExtHistory.map((h) => (
                  <div key={h.id} className="border border-border-default rounded-lg overflow-hidden">
                    <button
                      type="button"
                      className="w-full flex items-center justify-between px-3 py-2 bg-bg-light hover:bg-bg-light/80 text-left text-sm"
                      onClick={() => setPaHistOpen((m) => ({ ...m, [h.id]: !m[h.id] }))}
                    >
                      <span className="font-medium">{h.arrangement_id}</span>
                      <span className="text-xs text-text-muted">{String(h.assessment.conclusion || '')}</span>
                      {paHistOpen[h.id] ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                    {paHistOpen[h.id] && (
                      <div className="p-3 text-xs space-y-2 border-t border-border-default bg-white">
                        <p className="text-text-secondary">{h.description}</p>
                        <p>
                          <span className="font-semibold">Revenue treatment:</span> {String(h.assessment.revenue_treatment || '')}
                        </p>
                        <p className="text-text-muted">{String(h.assessment.explanation || '').slice(0, 400)}…</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-xs text-text-muted mb-1">Arrangement ID</label>
                <input
                  className="w-full px-3 py-2 border border-border-default rounded-lg"
                  value={paExtForm.arrangement_id}
                  onChange={(e) => setPaExtForm((f) => ({ ...f, arrangement_id: e.target.value }))}
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs text-text-muted mb-1">Description</label>
                <input
                  className="w-full px-3 py-2 border border-border-default rounded-lg"
                  value={paExtForm.description}
                  onChange={(e) => setPaExtForm((f) => ({ ...f, description: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Gross Contract Value</label>
                <input
                  type="number"
                  className="w-full px-3 py-2 border border-border-default rounded-lg"
                  value={paExtForm.gross_contract_value || ''}
                  onChange={(e) => setPaExtForm((f) => ({ ...f, gross_contract_value: Number(e.target.value) || 0 }))}
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Third-Party Cost</label>
                <input
                  type="number"
                  className="w-full px-3 py-2 border border-border-default rounded-lg"
                  value={paExtForm.third_party_cost || ''}
                  onChange={(e) => setPaExtForm((f) => ({ ...f, third_party_cost: Number(e.target.value) || 0 }))}
                />
              </div>
            </div>
            <div className="rounded-lg border border-border-default p-3 text-sm bg-bg-light/30">
              <p className="font-semibold text-text-primary mb-2">Revenue impact preview</p>
              <p>If PRINCIPAL → Revenue: {formatCurrency(Number(paExtForm.gross_contract_value) || 0, currency, 0)}</p>
              <p>If AGENT → Revenue: {formatCurrency(Math.max(0, (Number(paExtForm.gross_contract_value) || 0) - (Number(paExtForm.third_party_cost) || 0)), currency, 0)}</p>
              <p className="text-text-muted text-xs mt-1">Difference vs gross: {formatCurrency(Number(paExtForm.third_party_cost) || 0, currency, 0)} (third-party cost)</p>
            </div>
            <div className="space-y-4 border-t border-border-default pt-4">
              <p className="text-sm font-bold text-text-primary">Indicator checklist — IFRS 15.B37</p>
              {(
                [
                  ['controls_before_transfer', 'Controls the good/service before transfer (KEY — IFRS 15.B35)', 'Does the entity obtain control before transfer to the customer?'],
                  ['primary_obligor', 'Primary obligor', 'Is the entity primarily responsible for fulfilment?'],
                  ['inventory_risk', 'Inventory risk', 'Does the entity bear risk of loss on the good before or after transfer?'],
                  ['pricing_discretion', 'Pricing discretion', 'Discretion in setting price (not only cost + fixed mark-up)?'],
                  ['credit_risk', 'Credit risk', 'Must the entity pay the third party even if the customer does not pay?'],
                ] as const
              ).map(([key, title, help]) => (
                <div key={key} className={`rounded-lg border p-3 ${key === 'controls_before_transfer' ? 'border-blue-300 bg-blue-50/40' : 'border-border-default'}`}>
                  <p className={`text-sm font-semibold ${key === 'controls_before_transfer' ? 'text-blue-900' : 'text-text-primary'}`}>{title}</p>
                  <p className="text-xs text-text-muted mt-1 mb-2">{help}</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                        (paExtForm as any)[key] ? 'bg-green-600 text-white border-green-700' : 'bg-white text-text-secondary border-border-default'
                      }`}
                      onClick={() => setPaExtForm((f) => ({ ...f, [key]: true }))}
                    >
                      YES — principal
                    </button>
                    <button
                      type="button"
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                        !(paExtForm as any)[key] ? 'bg-blue-600 text-white border-blue-700' : 'bg-white text-text-secondary border-border-default'
                      }`}
                      onClick={() => setPaExtForm((f) => ({ ...f, [key]: false }))}
                    >
                      NO — agent
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span>
                Principal indicators: <strong>{paExtPrincipalCount}</strong> / 5
              </span>
              <span>
                Agent indicators: <strong>{paExtAgentCount}</strong> / 5
              </span>
              <span
                className={`text-xs font-bold px-2 py-1 rounded-full ${
                  paExtPrincipalCount >= 3 ? 'bg-green-100 text-green-800' : paExtAgentCount >= 3 ? 'bg-blue-100 text-blue-900' : 'bg-amber-100 text-amber-900'
                }`}
              >
                {paExtPrincipalCount >= 3 ? 'Likely PRINCIPAL' : paExtAgentCount >= 3 ? 'Likely AGENT' : 'Judgement required'}
              </span>
            </div>
            <Button variant="primary" className="w-full bg-gradient-orange" onClick={runPaExtAssess} isLoading={paExtLoading}>
              Run Assessment
            </Button>
            {paExtLatest && (
              <div className="space-y-4 border-t border-border-default pt-6">
                {(() => {
                  const conc = String(paExtLatest.conclusion || '');
                  const gross = Number(paExtLatest.gross_contract_value ?? 0);
                  const cost = Number(paExtLatest.third_party_cost ?? 0);
                  const margin = Number(paExtLatest.net_margin ?? gross - cost);
                  const border =
                    conc === 'PRINCIPAL' ? 'border-green-500' : conc === 'AGENT' ? 'border-blue-500' : 'border-amber-500 bg-amber-50/40';
                  return (
                    <>
                      <div className={`rounded-xl border-2 p-4 ${border}`}>
                        <p className="text-xl font-bold text-text-primary">
                          {conc === 'PRINCIPAL' ? '✅ PRINCIPAL' : conc === 'AGENT' ? 'ℹ AGENT' : '⚠ JUDGEMENT REQUIRED'}
                        </p>
                        <p className="text-sm mt-1">Confidence: {String(paExtLatest.confidence || '')}</p>
                        <p className="text-sm">Revenue treatment: {String(paExtLatest.revenue_treatment || '')}</p>
                        {conc === 'PRINCIPAL' && (
                          <div className="mt-3 text-sm space-y-1">
                            <p>Revenue recognised: {formatCurrency(gross, currency, 0)}</p>
                            <p>Cost of sales: {formatCurrency(cost, currency, 0)}</p>
                          </div>
                        )}
                        {conc === 'AGENT' && (
                          <div className="mt-3 text-sm space-y-1">
                            <p>Revenue recognised: {formatCurrency(margin, currency, 0)}</p>
                            <p>Revenue reduction vs gross: −{formatCurrency(cost, currency, 0)}</p>
                          </div>
                        )}
                        {conc === 'JUDGEMENT REQUIRED' && (
                          <div className="mt-3 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-900">
                            ⚠ Accounting judgement memo required before recognition.
                          </div>
                        )}
                      </div>
                      <div className="overflow-x-auto border border-border-default rounded-lg">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-bg-light">
                              <th className="text-left py-2 px-2">Indicator</th>
                              <th className="text-left py-2 px-2">Your answer</th>
                              <th className="text-left py-2 px-2">Supports</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries((paExtLatest.indicators_detail as Record<string, any>) || {}).map(([k, v]) => (
                              <tr key={k} className={`border-t ${k === 'controls_before_transfer' ? 'font-bold bg-blue-50/30' : ''}`}>
                                <td className="py-2 px-2">{String(v?.label || k)}</td>
                                <td className="py-2 px-2">{v?.present ? 'Yes' : 'No'}</td>
                                <td className={`py-2 px-2 ${v?.supports === 'PRINCIPAL' ? 'text-green-700' : 'text-blue-700'}`}>{String(v?.supports || '')}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="p-4 bg-bg-light border border-border-default rounded-lg text-sm">{String(paExtLatest.explanation || '')}</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                        <div className={`rounded-lg border p-3 ${conc === 'PRINCIPAL' ? 'ring-2 ring-green-400' : 'border-border-default'}`}>
                          <p className="font-bold mb-2">GROSS treatment</p>
                          <p>Revenue: {formatCurrency(gross, currency, 0)}</p>
                          <p>CoS: {formatCurrency(cost, currency, 0)}</p>
                          <p className="text-text-muted text-xs mt-2">Gross profit: {formatCurrency(gross - cost, currency, 0)}</p>
                        </div>
                        <div className={`rounded-lg border p-3 ${conc === 'AGENT' ? 'ring-2 ring-blue-400' : 'border-border-default'}`}>
                          <p className="font-bold mb-2">NET treatment</p>
                          <p>Revenue: {formatCurrency(margin, currency, 0)}</p>
                          <p>CoS: nil</p>
                          <p className="text-text-muted text-xs mt-2">Gross profit: {formatCurrency(margin, currency, 0)}</p>
                        </div>
                      </div>
                      <p className="text-xs text-text-muted italic">
                        Gross profit is identical regardless of treatment in this simplified view. The impact is on reported revenue, not profitability (margin equals gross − third-party cost in both cases).
                      </p>
                      {conc !== 'JUDGEMENT REQUIRED' && Array.isArray(paExtLatest.journal_entries) && (
                        <div className="space-y-2">
                          <p className="font-semibold text-sm">Journal entries</p>
                          {(paExtLatest.journal_entries as any[]).map((e, j) => (
                            <div key={j} className="p-3 rounded-lg border border-border-default bg-bg-light text-sm">
                              <p className="text-xs text-text-muted mb-1">{e.description}</p>
                              <div className="flex justify-between">
                                <span className="text-blue-800">Dr {e.debit_account}</span>
                                <span className="font-semibold amount">{formatCurrency(Number(e.amount ?? 0), currency, 0)}</span>
                              </div>
                              <div className="flex justify-between mt-1">
                                <span className="text-green-800">Cr {e.credit_account}</span>
                                <span className="font-semibold amount">{formatCurrency(Number(e.amount ?? 0), currency, 0)}</span>
                              </div>
                              <p className="text-xs text-text-muted mt-1">{e.reference}</p>
                            </div>
                          ))}
                        </div>
                      )}
                      {conc === 'JUDGEMENT REQUIRED' && (
                        <div className="p-4 rounded-lg border border-red-300 bg-red-50 text-sm text-red-900">
                          ⚠ An accounting judgement memo is required. Document all indicators, rationale, Controller sign-off, and IFRS 15.B34-B38. Consult Revenue Assurance before recognising revenue.
                        </div>
                      )}
                      <p className="text-xs text-text-muted">{String(paExtLatest.ifrs_reference || '')}</p>
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        )}
        {ifrs15DashTab === 'contract-costs' && (
          <div className="bg-white rounded-card p-6 border border-border-default shadow-card space-y-6">
            <div className="border-b border-border-default pb-4">
              <h3 className="text-lg font-bold text-text-primary">CONTRACT COSTS — IFRS 15.91-94</h3>
              <p className="text-xs text-text-muted mt-1">Costs to obtain and fulfil contracts</p>
            </div>
            <div className="rounded-lg border border-border-default bg-bg-light p-4 text-sm text-text-secondary">
              Sales commissions and other incremental costs of obtaining a contract must be capitalised and amortised if the expected amortisation period exceeds one year (IFRS 15.91). Practical expedient: expense immediately if amortisation period ≤ 1 year (IFRS 15.94).
            </div>
            {ccBatchResult && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {(
                  [
                    ['total_capitalised', 'Total Capitalised', 'text-blue-800'],
                    ['net_asset_balance', 'Net Asset Balance', 'text-green-800'],
                    ['total_amortised_to_date', 'Amortised to Date', 'text-amber-900'],
                    ['total_expensed_immediately', 'Expensed Immediately', 'text-text-muted'],
                  ] as const
                ).map(([k, lbl, cls]) => (
                  <div key={k} className="rounded-lg border border-border-default p-3 bg-white">
                    <p className="text-xs text-text-muted">{lbl}</p>
                    <p className={`text-lg font-bold amount ${cls}`}>
                      {formatCurrency(Number((ccBatchResult.summary as any)?.[k] ?? 0), currency, 0)}
                    </p>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                className="bg-white border border-border-default"
                onClick={() =>
                  setCcRows((rows) => [
                    ...rows,
                    {
                      id: newUid(),
                      cost_id: `COST-${String(rows.length + 1).padStart(3, '0')}`,
                      contract_id: contractId !== '—' ? String(contractId) : '',
                      description: '',
                      cost_type: 'incremental_obtaining',
                      cost_amount: 0,
                      incurred_date: new Date().toISOString().slice(0, 10),
                      contract_start: new Date().toISOString().slice(0, 10),
                      contract_end: new Date().toISOString().slice(0, 10),
                      expected_renewal: false,
                      expected_renewal_months: 0,
                      currency: 'USD',
                    },
                  ])
                }
              >
                <Plus className="w-4 h-4 mr-1" /> Add Cost Item
              </Button>
            </div>
            <div className="space-y-4">
              {ccRows.map((row) => (
                <div key={row.id} className="border border-border-default rounded-lg p-4 space-y-2 bg-bg-light/20">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <input className="px-2 py-1.5 border rounded text-sm" placeholder="Cost ID" value={row.cost_id} onChange={(e) => setCcRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, cost_id: e.target.value } : x)))} />
                    <input className="px-2 py-1.5 border rounded text-sm" placeholder="Contract ID" value={row.contract_id} onChange={(e) => setCcRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, contract_id: e.target.value } : x)))} />
                    <input className="px-2 py-1.5 border rounded text-sm md:col-span-2" placeholder="Description" value={row.description} onChange={(e) => setCcRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, description: e.target.value } : x)))} />
                    <select className="px-2 py-1.5 border rounded text-sm md:col-span-2" value={row.cost_type} onChange={(e) => setCcRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, cost_type: e.target.value } : x)))}>
                      <option value="incremental_obtaining">Incremental cost of obtaining (IFRS 15.91)</option>
                      <option value="fulfillment_cost">Fulfilment cost (IFRS 15.95)</option>
                      <option value="other">Other (expense immediately)</option>
                    </select>
                    <input type="number" className="px-2 py-1.5 border rounded text-sm" placeholder="Amount" value={row.cost_amount || ''} onChange={(e) => setCcRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, cost_amount: Number(e.target.value) || 0 } : x)))} />
                    <input type="date" className="px-2 py-1.5 border rounded text-sm" value={row.incurred_date} onChange={(e) => setCcRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, incurred_date: e.target.value } : x)))} />
                    <input type="date" className="px-2 py-1.5 border rounded text-sm" value={row.contract_start} onChange={(e) => setCcRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, contract_start: e.target.value } : x)))} />
                    <input type="date" className="px-2 py-1.5 border rounded text-sm" value={row.contract_end} onChange={(e) => setCcRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, contract_end: e.target.value } : x)))} />
                    <label className="flex items-center gap-2 text-sm md:col-span-2">
                      <input type="checkbox" checked={row.expected_renewal} onChange={(e) => setCcRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, expected_renewal: e.target.checked } : x)))} />
                      Expected renewal
                    </label>
                    {row.expected_renewal && (
                      <input type="number" className="px-2 py-1.5 border rounded text-sm md:col-span-2" placeholder="Renewal months" value={row.expected_renewal_months || ''} onChange={(e) => setCcRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, expected_renewal_months: Number(e.target.value) || 0 } : x)))} />
                    )}
                  </div>
                  <button type="button" className="text-xs text-red-600 underline" onClick={() => setCcRows((rs) => rs.filter((x) => x.id !== row.id))}>
                    Remove
                  </button>
                </div>
              ))}
              {ccRows.length === 0 && <p className="text-sm text-text-muted">Add cost lines to assess capitalisation and amortisation.</p>}
            </div>
            <Button variant="primary" className="w-full bg-gradient-orange" onClick={runCcBatchCalc} isLoading={ccBatchLoading}>
              Calculate
            </Button>
            {ccBatchResult && (
              <div className="space-y-6 border-t pt-6">
                {(ccBatchResult.costs as any[]).map((it: any) => (
                  <div
                    key={it.cost_id}
                    className={`rounded-lg border-l-4 p-4 space-y-2 ${it.treatment === 'CAPITALISE' ? 'border-green-500 bg-green-50/30' : 'border-amber-400 bg-amber-50/30'}`}
                  >
                    <p className="text-sm font-bold">{it.treatment === 'CAPITALISE' ? 'CAPITALISED — IFRS 15.91' : 'EXPENSED'}</p>
                    <p className="text-xs text-text-secondary">{it.reason}</p>
                    {it.treatment === 'CAPITALISE' && (
                      <p className="text-sm">
                        Amortisation: {formatCurrency(Number(it.monthly_amortisation ?? 0), currency, 0)}/mo over {it.amortisation_period_months} months — asset balance{' '}
                        {formatCurrency(Number(it.asset_balance ?? 0), currency, 0)}
                      </p>
                    )}
                    {it.treatment === 'CAPITALISE' && Array.isArray(it.amortisation_schedule) && it.amortisation_schedule.length > 0 && (
                      <div className="overflow-x-auto max-h-48 overflow-y-auto border rounded bg-white text-xs">
                        <table className="w-full">
                          <thead>
                            <tr className="bg-bg-light">
                              <th className="text-left p-1">Period</th>
                              <th className="text-right p-1">Amort</th>
                              <th className="text-right p-1">Cumulative</th>
                              <th className="text-right p-1">Asset</th>
                              <th className="text-left p-1">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(ccSchedExpand[it.cost_id] ? it.amortisation_schedule : (it.amortisation_schedule || []).slice(0, 6)).map((ln: any, i: number) => (
                              <tr key={i} className="border-t">
                                <td className="p-1">{ln.period}</td>
                                <td className="p-1 text-right amount">{formatCurrency(Number(ln.amortisation), currency, 0)}</td>
                                <td className="p-1 text-right amount">{formatCurrency(Number(ln.cumulative_amortised), currency, 0)}</td>
                                <td className="p-1 text-right amount">{formatCurrency(Number(ln.asset_balance), currency, 0)}</td>
                                <td className="p-1">{ln.status}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {it.treatment === 'CAPITALISE' && Array.isArray(it.amortisation_schedule) && it.amortisation_schedule.length > 6 && (
                      <button type="button" className="text-xs text-orange-primary font-semibold" onClick={() => setCcSchedExpand((m) => ({ ...m, [it.cost_id]: !m[it.cost_id] }))}>
                        {ccSchedExpand[it.cost_id] ? 'Show less' : 'View all'}
                      </button>
                    )}
                    <div className="space-y-2">
                      {(it.journal_entries as any[]).map((je: any, j: number) => (
                        <div key={j} className="p-2 rounded border bg-white text-xs">
                          <p className="text-text-muted">{je.description}</p>
                          <p>
                            Dr {je.debit_account} — {formatCurrency(Number(je.amount), currency, 0)}
                          </p>
                          <p>
                            Cr {je.credit_account} — {formatCurrency(Number(je.amount), currency, 0)}
                          </p>
                          <p className="text-text-muted">{je.reference}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                <div className="rounded-lg border border-border-default p-4 bg-bg-light/40">
                  <p className="font-semibold text-text-primary mb-2">Contract Cost Asset — Roll-Forward</p>
                  <table className="text-sm w-full max-w-md">
                    <tbody>
                      <tr>
                        <td>Opening</td>
                        <td className="text-right amount">{formatCurrency(0, currency, 0)}</td>
                      </tr>
                      <tr>
                        <td>Add: New costs capitalised</td>
                        <td className="text-right amount">{formatCurrency(Number((ccBatchResult.summary as any)?.total_capitalised ?? 0), currency, 0)}</td>
                      </tr>
                      <tr>
                        <td>Less: Amortised</td>
                        <td className="text-right amount">{formatCurrency(Number((ccBatchResult.summary as any)?.total_amortised_to_date ?? 0), currency, 0)}</td>
                      </tr>
                      <tr className="font-bold text-green-800">
                        <td>Closing</td>
                        <td className="text-right amount">{formatCurrency(Number((ccBatchResult.summary as any)?.net_asset_balance ?? 0), currency, 0)}</td>
                      </tr>
                    </tbody>
                  </table>
                  <p className="text-xs text-text-muted mt-2">Reconcile this balance to the Contract Cost Asset GL monthly as a SOX control.</p>
                </div>
              </div>
            )}
          </div>
        )}
        {ifrs15DashTab === 'licenses-ip' && (
          <div className="bg-white rounded-card p-6 border border-border-default shadow-card space-y-6">
            <div className="border-b border-border-default pb-4">
              <h3 className="text-lg font-bold text-text-primary">LICENSES OF INTELLECTUAL PROPERTY</h3>
              <p className="text-xs text-text-muted mt-1">IFRS 15.B52-B63</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div className="rounded-lg border border-green-200 p-3 bg-green-50/40">
                <p className="font-semibold text-green-900 mb-1">Right to Use</p>
                <p className="text-text-secondary">Static right as at grant date — recognise at point in time when accessible.</p>
              </div>
              <div className="rounded-lg border border-blue-200 p-3 bg-blue-50/40">
                <p className="font-semibold text-blue-900 mb-1">Right to Access</p>
                <p className="text-text-secondary">Ongoing activities affect IP — recognise over the licence term.</p>
              </div>
            </div>
            <Button
              type="button"
              variant="secondary"
              className="bg-white border border-border-default"
              onClick={() =>
                setLicRows((rows) => [
                  ...rows,
                  {
                    id: newUid(),
                    license_id: `LIC-${String(rows.length + 1).padStart(3, '0')}`,
                    product_name: '',
                    license_description: '',
                    license_fee: 0,
                    license_start: new Date().toISOString().slice(0, 10),
                    license_end: new Date().toISOString().slice(0, 10),
                    is_perpetual: false,
                    entity_activities_affect_ip: false,
                    customer_exposed_to_effect: false,
                    no_separate_functional_utility: false,
                    currency: 'USD',
                  },
                ])
              }
            >
              <Plus className="w-4 h-4 mr-1" /> Add Licence
            </Button>
            <div className="space-y-4">
              {licRows.map((row) => {
                const allThree = row.entity_activities_affect_ip && row.customer_exposed_to_effect && row.no_separate_functional_utility;
                const preview = allThree ? 'Right to Access → Over Time' : row.entity_activities_affect_ip ? 'Judgement required' : 'Right to Use → Point in Time';
                const prevClass = allThree ? 'bg-blue-100 text-blue-900' : row.entity_activities_affect_ip ? 'bg-amber-100 text-amber-900' : 'bg-green-100 text-green-900';
                return (
                  <div key={row.id} className="border rounded-lg p-4 space-y-2 bg-bg-light/20">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <input className="px-2 py-1 border rounded text-sm" value={row.license_id} onChange={(e) => setLicRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, license_id: e.target.value } : x)))} />
                      <input className="px-2 py-1 border rounded text-sm" placeholder="Product" value={row.product_name} onChange={(e) => setLicRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, product_name: e.target.value } : x)))} />
                      <input className="px-2 py-1 border rounded text-sm md:col-span-2" placeholder="Description" value={row.license_description} onChange={(e) => setLicRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, license_description: e.target.value } : x)))} />
                      <input type="number" className="px-2 py-1 border rounded text-sm" placeholder="Fee" value={row.license_fee || ''} onChange={(e) => setLicRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, license_fee: Number(e.target.value) || 0 } : x)))} />
                      <input type="date" className="px-2 py-1 border rounded text-sm" value={row.license_start} onChange={(e) => setLicRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, license_start: e.target.value } : x)))} />
                      {!row.is_perpetual && <input type="date" className="px-2 py-1 border rounded text-sm" value={row.license_end} onChange={(e) => setLicRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, license_end: e.target.value } : x)))} />}
                      <label className="flex items-center gap-2 text-sm md:col-span-2">
                        <input type="checkbox" checked={row.is_perpetual} onChange={(e) => setLicRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, is_perpetual: e.target.checked } : x)))} />
                        Perpetual
                      </label>
                    </div>
                    {(['entity_activities_affect_ip', 'customer_exposed_to_effect', 'no_separate_functional_utility'] as const).map((fld, idx) => (
                      <div key={fld} className="flex flex-wrap gap-2 items-center text-xs">
                        <span className="font-medium w-48 shrink-0">B58 ({idx + 1})</span>
                        <button type="button" className={`px-2 py-1 rounded ${row[fld] ? 'bg-green-600 text-white' : 'bg-white border'}`} onClick={() => setLicRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, [fld]: true } : x)))}>
                          Yes
                        </button>
                        <button type="button" className={`px-2 py-1 rounded ${!row[fld] ? 'bg-blue-600 text-white' : 'bg-white border'}`} onClick={() => setLicRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, [fld]: false } : x)))}>
                          No
                        </button>
                      </div>
                    ))}
                    <span className={`text-xs font-bold px-2 py-1 rounded inline-block ${prevClass}`}>{preview}</span>
                    <button type="button" className="text-xs text-red-600 underline" onClick={() => setLicRows((rs) => rs.filter((x) => x.id !== row.id))}>
                      Remove
                    </button>
                  </div>
                );
              })}
            </div>
            <Button variant="primary" className="w-full bg-gradient-orange" onClick={runLicIpAssess} isLoading={licIpLoading}>
              Assess Licences
            </Button>
            {licIpResult && (
              <div className="space-y-4 border-t pt-6">
                <div className="grid grid-cols-3 gap-2 text-center text-sm">
                  <div className="p-2 rounded border bg-blue-50">
                    RTA: {String((licIpResult.summary as any)?.right_to_access ?? 0)}
                  </div>
                  <div className="p-2 rounded border bg-green-50">
                    RTU: {String((licIpResult.summary as any)?.right_to_use ?? 0)}
                  </div>
                  <div className="p-2 rounded border bg-amber-50">
                    Judgement: {String((licIpResult.summary as any)?.judgement_required ?? 0)}
                  </div>
                </div>
                {((licIpResult.licenses as any[]) || []).map((lic: any) => (
                  <div key={lic.license_id} className="border rounded-lg p-4 space-y-2 text-sm">
                    <p className="font-bold">
                      {lic.license_type} — {lic.product_name}
                    </p>
                    <p>{lic.explanation}</p>
                    <div className="overflow-x-auto text-xs border rounded max-h-40 overflow-y-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="bg-bg-light">
                            <th className="text-left p-1">Period</th>
                            <th className="text-right p-1">Revenue</th>
                            <th className="text-right p-1">Cumulative</th>
                            <th className="text-right p-1">Deferred</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(licSchedExpand[lic.license_id] ? lic.recognition_schedule : (lic.recognition_schedule || []).slice(0, 6)).map((ln: any, i: number) => (
                            <tr key={i} className="border-t">
                              <td className="p-1">{ln.period}</td>
                              <td className="p-1 text-right amount">{formatCurrency(Number(ln.amount), currency, 0)}</td>
                              <td className="p-1 text-right amount">{formatCurrency(Number(ln.cumulative), currency, 0)}</td>
                              <td className="p-1 text-right amount">{formatCurrency(Number(ln.balance), currency, 0)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {Array.isArray(lic.recognition_schedule) && lic.recognition_schedule.length > 6 && (
                      <button type="button" className="text-xs text-orange-primary font-semibold" onClick={() => setLicSchedExpand((m) => ({ ...m, [lic.license_id]: !m[lic.license_id] }))}>
                        {licSchedExpand[lic.license_id] ? 'Show less' : 'View all'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {ifrs15DashTab === 'audit-trail' && (
          <div className="bg-white rounded-card p-6 border border-border-default shadow-card space-y-6">
            <div className="border-b border-border-default pb-4 flex flex-wrap justify-between gap-2">
              <div>
                <h3 className="text-lg font-bold text-text-primary">AUDIT TRAIL</h3>
                <p className="text-xs text-text-muted mt-1">IFRS 15 — activity log</p>
              </div>
              <Button variant="secondary" size="sm" className="bg-white border" onClick={() => void fetchAuditLog()} isLoading={auditLoading}>
                Refresh
              </Button>
            </div>
            {auditPending > 0 && (
              <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900">
                ⚠ {auditPending} entries require sign-off (materiality or sensitive action).
              </div>
            )}
            <div className="grid grid-cols-3 gap-3 text-center text-sm">
              <div className="p-3 rounded border">
                <div className="text-text-muted">Total entries</div>
                <div className="text-xl font-bold">{auditEntries.length}</div>
              </div>
              <div className="p-3 rounded border border-amber-300 bg-amber-50">
                <div className="text-text-muted">Pending sign-off</div>
                <div className="text-xl font-bold text-amber-900">{auditPending}</div>
              </div>
              <div className="p-3 rounded border border-green-200 bg-green-50">
                <div className="text-text-muted">Signed off</div>
                <div className="text-xl font-bold text-green-800">
                  {auditEntries.filter((e) => (e.sign_off_required as boolean) && String(e.signed_off_by || '').trim()).length}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 items-end">
              <div>
                <label className="block text-xs text-text-muted mb-1">Contract ID</label>
                <input className="px-2 py-1.5 border rounded text-sm" value={auditFilterContract} onChange={(e) => setAuditFilterContract(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Action</label>
                <select className="px-2 py-1.5 border rounded text-sm" value={auditFilterAction} onChange={(e) => setAuditFilterAction(e.target.value)}>
                  <option value="">All</option>
                  <option value="CALCULATE">Calculate</option>
                  <option value="MODIFICATION">Modification</option>
                  <option value="DEFERRED_REC">Deferred Rec</option>
                  <option value="RPO">RPO</option>
                  <option value="PRINCIPAL_AGENT">Principal Agent</option>
                  <option value="CONTRACT_COSTS">Contract Costs</option>
                  <option value="LICENSE_IP">License IP</option>
                  <option value="MATERIAL_RIGHTS">Material Rights</option>
                  <option value="WARRANTY">Warranty</option>
                  <option value="BILL_AND_HOLD">Bill-and-Hold</option>
                  <option value="FINANCING_COMPONENT">Financing Component</option>
                  <option value="NON_CASH_CONSIDERATION">Non-cash consideration</option>
                  <option value="CONSIDERATION_PAYABLE">Consideration payable</option>
                  <option value="PORTFOLIO_ADD">Portfolio add</option>
                  <option value="PORTFOLIO_REMOVE">Portfolio remove</option>
                  <option value="PORTFOLIO">Portfolio (legacy)</option>
                </select>
              </div>
              <Button type="button" variant="primary" className="bg-gradient-orange" onClick={() => void fetchAuditLog()}>
                Apply filters
              </Button>
              <Button
                type="button"
                variant="primary"
                className="bg-gradient-orange"
                onClick={() => void downloadAuditLogExcel()}
                isLoading={auditExcelLoading}
              >
                Download Audit Log Excel
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="bg-white border"
                onClick={() => {
                  const blob = new Blob([JSON.stringify(auditEntries, null, 2)], { type: 'text/plain' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `IFRS15_audit_log_${new Date().toISOString().slice(0, 10)}.txt`;
                  a.click();
                  URL.revokeObjectURL(url);
                  toast.success('Downloaded log (.txt)');
                }}
              >
                Download log (.txt)
              </Button>
            </div>
            <div className="overflow-x-auto border rounded-lg max-h-[480px] overflow-y-auto text-sm">
              <table className="w-full">
                <thead className="bg-bg-light sticky top-0">
                  <tr>
                    <th className="text-left p-2">ID</th>
                    <th className="text-left p-2">Time</th>
                    <th className="text-left p-2">Action</th>
                    <th className="text-left p-2">Contract</th>
                    <th className="text-left p-2">Description</th>
                    <th className="text-left p-2">IFRS</th>
                    <th className="text-left p-2">Sign-off</th>
                  </tr>
                </thead>
                <tbody>
                  {auditEntries.map((e) => {
                    const id = String(e.entry_id ?? '');
                    const req = Boolean(e.sign_off_required);
                    const signed = Boolean(String(e.signed_off_by || '').trim());
                    const rowBorder = req && !signed ? 'border-l-4 border-amber-400' : req && signed ? 'border-l-4 border-green-500' : '';
                    return (
                      <Fragment key={id}>
                        <tr className={`border-t cursor-pointer hover:bg-bg-light/50 ${rowBorder}`} onClick={() => setAuditExpanded((m) => ({ ...m, [id]: !m[id] }))}>
                          <td className="p-2 font-mono text-xs">{id}</td>
                          <td className="p-2 text-xs whitespace-nowrap">{String(e.timestamp || '').slice(0, 19)}</td>
                          <td className="p-2">{String(e.action)}</td>
                          <td className="p-2">{String(e.contract_id)}</td>
                          <td className="p-2 max-w-xs truncate">{String(e.description)}</td>
                          <td className="p-2 text-xs">{String(e.ifrs_reference)}</td>
                          <td className="p-2 text-xs">{req ? (signed ? '✅ Signed' : 'Pending') : '—'}</td>
                        </tr>
                        {auditExpanded[id] && (
                          <tr className="bg-bg-light/40">
                            <td colSpan={7} className="p-3 space-y-2 text-xs">
                              <div>
                                <span className="font-semibold">Before:</span>
                                <pre className="mt-1 p-2 bg-gray-100 rounded overflow-x-auto">{JSON.stringify(e.before_value, null, 2)}</pre>
                              </div>
                              <div>
                                <span className="font-semibold">After:</span>
                                <pre className="mt-1 p-2 bg-blue-50 rounded overflow-x-auto">{JSON.stringify(e.after_value, null, 2)}</pre>
                              </div>
                              {req && !signed && (
                                <Button type="button" size="sm" className="bg-orange-primary text-white" onClick={() => setSignOffEntryId(id)}>
                                  Sign off
                                </Button>
                              )}
                              {signed && (
                                <p className="text-green-800">
                                  ✅ Signed by {String(e.signed_off_by)} at {String(e.signed_off_at || '').slice(0, 19)}
                                </p>
                              )}
                              {String(e.notes || '') && <p className="italic text-text-muted">Notes: {String(e.notes)}</p>}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {signOffEntryId && (
              <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
                <button type="button" className="absolute inset-0 bg-black/50" aria-label="Close" onClick={() => setSignOffEntryId(null)} />
                <div className="relative bg-white rounded-xl border shadow-xl p-6 max-w-md w-full space-y-3">
                  <h4 className="font-bold">Sign off entry {signOffEntryId}</h4>
                  <input className="w-full border rounded px-3 py-2" placeholder="Reviewer name" value={signOffReviewer} onChange={(e) => setSignOffReviewer(e.target.value)} />
                  <textarea className="w-full border rounded px-3 py-2 min-h-[80px]" placeholder="Notes (optional)" value={signOffNotes} onChange={(e) => setSignOffNotes(e.target.value)} />
                  <div className="flex gap-2 justify-end">
                    <Button variant="secondary" onClick={() => setSignOffEntryId(null)}>
                      Cancel
                    </Button>
                    <Button variant="primary" className="bg-gradient-orange" onClick={() => void confirmAuditSignOff()}>
                      Confirm
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        {ifrs15DashTab === 'material-rights' && (
          <div className="bg-white rounded-card p-6 border border-border-default shadow-card space-y-6">
            <div className="border-b border-border-default pb-4">
              <h3 className="text-lg font-bold text-text-primary">CUSTOMER OPTIONS &amp; MATERIAL RIGHTS</h3>
              <p className="text-xs text-text-muted mt-1">IFRS 15.B40-B43</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-lg border border-green-200 bg-green-50/40 p-4 text-sm text-text-secondary flex gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-green-900 mb-1">Material right EXISTS</p>
                  <p>
                    The customer receives a discount that is incremental to the market — only available because they entered the original contract. This is a{' '}
                    <strong>separate performance obligation</strong>. Portion of transaction price deferred as contract liability until the option is exercised.
                  </p>
                </div>
              </div>
              <div className="rounded-lg border border-border-default bg-bg-light p-4 text-sm text-text-secondary flex gap-2">
                <ArrowRight className="w-5 h-5 text-text-muted shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-text-primary mb-1">No material right</p>
                  <p>
                    The discount is available to similar customers in the market regardless of the original contract. <strong>No separate PO</strong> — account for exercise when it occurs.
                  </p>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div className="border rounded-lg p-3 bg-bg-light/30">
                <p className="font-bold text-text-primary mb-1">Renewal discount</p>
                <p className="text-text-secondary">Year 2 at $70K vs SSP $100K. 30% discount = material right.</p>
              </div>
              <div className="border rounded-lg p-3 bg-bg-light/30">
                <p className="font-bold text-text-primary mb-1">Volume tier lock</p>
                <p className="text-text-secondary">Tier 3 pricing locked for Year 2 based on Year 1 volumes = material right.</p>
              </div>
              <div className="border rounded-lg p-3 bg-bg-light/30">
                <p className="font-bold text-text-primary mb-1">Free upgrade</p>
                <p className="text-text-secondary">Next version free. SSP = $20K. Not available to new customers = material.</p>
              </div>
            </div>
            <div className="flex justify-between items-center flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  setMrRows((rows) => [
                    ...rows,
                    {
                      id: newUid(),
                      option_id: `OPT-${String(rows.length + 1).padStart(3, '0')}`,
                      contract_id: '',
                      description: '',
                      option_type: 'renewal_discount',
                      original_contract_value: 0,
                      original_ssp: 0,
                      option_price: 0,
                      option_ssp: 0,
                      exercise_probability_pct: 50,
                      currency: 'USD',
                    },
                  ])
                }
              >
                <Plus className="w-4 h-4 mr-1" /> Add Option
              </Button>
            </div>
            <div className="space-y-4">
              {mrRows.map((row) => {
                const pv = computeMrPreview(row);
                return (
                  <div key={row.id} className="border border-border-default rounded-lg p-4 space-y-3 bg-bg-light/20">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <input className="px-2 py-1.5 border rounded text-sm" placeholder="Option ID" value={row.option_id} onChange={(e) => setMrRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, option_id: e.target.value } : x)))} />
                      <input className="px-2 py-1.5 border rounded text-sm" placeholder="Contract ID" value={row.contract_id} onChange={(e) => setMrRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, contract_id: e.target.value } : x)))} />
                      <input className="px-2 py-1.5 border rounded text-sm md:col-span-2" placeholder="Description" value={row.description} onChange={(e) => setMrRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, description: e.target.value } : x)))} />
                      <select className="px-2 py-1.5 border rounded text-sm md:col-span-2" value={row.option_type} onChange={(e) => setMrRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, option_type: e.target.value } : x)))}>
                        <option value="renewal_discount">Renewal discount</option>
                        <option value="volume_discount">Volume discount</option>
                        <option value="free_upgrade">Free upgrade / next version</option>
                        <option value="loyalty_points">Loyalty points</option>
                        <option value="additional_goods">Additional goods/services</option>
                      </select>
                      <p className="text-xs font-semibold text-text-muted md:col-span-2">Original contract</p>
                      <input type="number" className="px-2 py-1.5 border rounded text-sm" placeholder="Contract value" value={row.original_contract_value || ''} onChange={(e) => setMrRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, original_contract_value: Number(e.target.value) || 0 } : x)))} />
                      <input type="number" className="px-2 py-1.5 border rounded text-sm" placeholder="Original SSP" value={row.original_ssp || ''} onChange={(e) => setMrRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, original_ssp: Number(e.target.value) || 0 } : x)))} />
                      <p className="text-xs font-semibold text-text-muted md:col-span-2">Option terms</p>
                      <input type="number" className="px-2 py-1.5 border rounded text-sm" placeholder="Option price (if exercised)" value={row.option_price || ''} onChange={(e) => setMrRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, option_price: Number(e.target.value) || 0 } : x)))} />
                      <input type="number" className="px-2 py-1.5 border rounded text-sm" placeholder="Option SSP" value={row.option_ssp || ''} onChange={(e) => setMrRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, option_ssp: Number(e.target.value) || 0 } : x)))} />
                      <div className="md:col-span-2">
                        <label className="text-xs text-text-muted">Exercise probability: {row.exercise_probability_pct}%</label>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          className="w-full"
                          value={row.exercise_probability_pct}
                          onChange={(e) => setMrRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, exercise_probability_pct: Number(e.target.value) || 0 } : x)))}
                        />
                      </div>
                    </div>
                    <div className="rounded border border-border-default bg-white p-3 text-sm space-y-1">
                      <p>
                        Discount: {formatCurrency(pv.discountAmount, currency, 0)} ({pv.discountPct.toFixed(1)}%)
                      </p>
                      <p className={pv.materialRight ? 'text-amber-800 font-semibold' : 'text-text-muted'}>Material right: {pv.materialRight ? 'YES' : 'NO'}</p>
                      {pv.materialRight && (
                        <>
                          <p>Option SSP (estimated): {formatCurrency(pv.optionSspEst, currency, 0)}</p>
                          <p>Amount deferred to option: {formatCurrency(pv.deferredToOption, currency, 0)}</p>
                        </>
                      )}
                    </div>
                    <button type="button" className="text-xs text-red-600 underline" onClick={() => setMrRows((rs) => rs.filter((x) => x.id !== row.id))}>
                      Remove
                    </button>
                  </div>
                );
              })}
              {mrRows.length === 0 && <p className="text-sm text-text-muted">Add customer options to assess material rights under IFRS 15.B40.</p>}
            </div>
            <Button variant="primary" className="w-full bg-gradient-orange" onClick={() => void runMaterialRightsAssess()} isLoading={mrLoading}>
              Assess Options
            </Button>
            {mrResult && (
              <div className="space-y-6 border-t pt-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-center text-sm">
                  <div className="p-3 rounded border border-amber-200 bg-amber-50">
                    <div className="text-text-muted">Material rights found</div>
                    <div className="text-xl font-bold text-amber-900">{String((mrResult.summary as any)?.material_rights_found ?? 0)}</div>
                  </div>
                  <div className="p-3 rounded border bg-bg-light">
                    <div className="text-text-muted">No material right</div>
                    <div className="text-xl font-bold">{String((mrResult.summary as any)?.no_material_right ?? 0)}</div>
                  </div>
                  <div className="p-3 rounded border border-blue-100 bg-blue-50/50">
                    <div className="text-text-muted">Total deferred to options</div>
                    <div className="text-xl font-bold text-blue-900 amount">{formatCurrency(Number((mrResult.summary as any)?.total_deferred_to_options ?? 0), currency, 0)}</div>
                  </div>
                </div>
                {((mrResult.options as any[]) || []).map((it: any) => {
                  const oid = String(it.option_id ?? '');
                  const tab = mrJeTab[oid] || 'inception';
                  const jes = (it.journal_entries as any[]) || [];
                  const je = tab === 'exercised' ? jes[1] : tab === 'expired' ? jes[2] : jes[0];
                  const mat = Boolean(it.material_right_exists);
                  return (
                    <div
                      key={oid}
                      className={`rounded-lg border-l-4 p-4 space-y-3 ${mat ? 'border-amber-400 bg-amber-50/20' : 'border-gray-300 bg-bg-light/30'}`}
                    >
                      {mat ? (
                        <>
                          <p className="text-sm font-bold text-amber-900">SEPARATE PERFORMANCE OBLIGATION — IFRS 15.B40</p>
                          <div className="overflow-x-auto text-sm">
                            <table className="w-full border-collapse">
                              <thead>
                                <tr className="bg-bg-light">
                                  <th className="text-left p-2 border"> </th>
                                  <th className="text-right p-2 border">SSP</th>
                                  <th className="text-right p-2 border">Allocated</th>
                                </tr>
                              </thead>
                              <tbody>
                                <tr>
                                  <td className="p-2 border">Original POs</td>
                                  <td className="p-2 border text-right amount">{formatCurrency(Number(it.original_ssp ?? 0), currency, 0)}</td>
                                  <td className="p-2 border text-right amount">{formatCurrency(Number(it.allocated_to_original ?? 0), currency, 0)}</td>
                                </tr>
                                <tr>
                                  <td className="p-2 border">Option (material right)</td>
                                  <td className="p-2 border text-right amount">{formatCurrency(Number(it.option_ssp_estimated ?? 0), currency, 0)} est</td>
                                  <td className="p-2 border text-right amount">{formatCurrency(Number(it.allocated_to_option ?? 0), currency, 0)}</td>
                                </tr>
                                <tr className="font-semibold">
                                  <td className="p-2 border">Total</td>
                                  <td className="p-2 border text-right amount">{formatCurrency(Number(it.total_ssp_pool ?? 0), currency, 0)}</td>
                                  <td className="p-2 border text-right amount">{formatCurrency(Number(it.original_contract_value ?? 0), currency, 0)} TP</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                          <p className="text-2xl font-bold text-blue-800">
                            Contract liability at inception: {formatCurrency(Number(it.allocated_to_option ?? 0), currency, 0)}
                          </p>
                          <p className="text-sm whitespace-pre-wrap text-text-secondary">{String(it.explanation || '')}</p>
                          {jes.length > 0 && (
                            <div className="space-y-2">
                              <div className="flex gap-2 flex-wrap">
                                {(['inception', 'exercised', 'expired'] as const).map((k) => (
                                  <button
                                    key={k}
                                    type="button"
                                    className={`px-3 py-1 rounded text-xs font-semibold border ${tab === k ? 'bg-orange-primary text-white border-orange-primary' : 'bg-white'}`}
                                    onClick={() => setMrJeTab((m) => ({ ...m, [oid]: k }))}
                                  >
                                    {k === 'inception' ? 'At inception' : k === 'exercised' ? 'If exercised' : 'If expired'}
                                  </button>
                                ))}
                              </div>
                              {je && (
                                <div className="p-3 rounded border bg-white text-sm space-y-1">
                                  <p className="text-xs text-text-muted">{je.date}</p>
                                  <p className="font-medium">{je.description}</p>
                                  <div className="flex justify-between">
                                    <span className="text-blue-800">Dr {je.debit_account}</span>
                                    <span className="font-semibold amount">{formatCurrency(Number(je.amount ?? 0), currency, 0)}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-green-800">Cr {je.credit_account}</span>
                                    <span className="font-semibold amount">{formatCurrency(Number(je.amount ?? 0), currency, 0)}</span>
                                  </div>
                                  {je.split && (
                                    <div className="text-xs mt-2 space-y-1 border-t pt-2">
                                      {Object.entries(je.split as Record<string, number>).map(([k, v]) => (
                                        <div key={k} className="flex justify-between">
                                          <span>{k}</span>
                                          <span className="amount">{formatCurrency(Number(v), currency, 0)}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  {je.note && <p className="text-xs text-text-muted italic">{je.note}</p>}
                                  <p className="text-xs text-text-muted">{je.reference}</p>
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          <p className="text-sm font-bold text-text-primary">NOT A SEPARATE PO</p>
                          <p className="text-sm whitespace-pre-wrap">{String(it.explanation || '')}</p>
                          <p className="text-xs text-text-muted italic">Account for exercise if and when it occurs.</p>
                        </>
                      )}
                      <p className="text-xs text-text-muted">{String(it.ifrs_reference || '')}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {ifrs15DashTab === 'warranties' && (
          <div className="bg-white rounded-card p-6 border border-border-default shadow-card space-y-6">
            <div className="border-b border-border-default pb-4">
              <h3 className="text-lg font-bold text-text-primary">WARRANTIES</h3>
              <p className="text-xs text-text-muted mt-1">IFRS 15.B28-B33 | IAS 37</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-lg border border-slate-300 bg-slate-50/80 p-4 text-sm text-text-secondary">
                <p className="font-semibold text-slate-900 mb-2">Assurance-Type (IAS 37)</p>
                <p>
                  Assures the product meets ALREADY agreed specifications. NOT a performance obligation. → IAS 37 provision in cost of
                  sales.
                </p>
                <p className="text-xs text-text-muted mt-2">Examples: 12-month bug fix, legal minimum warranty.</p>
              </div>
              <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4 text-sm text-text-secondary">
                <p className="font-semibold text-blue-900 mb-2">Service-Type (IFRS 15)</p>
                <p>
                  Provides a service BEYOND specifications. IS a separate performance obligation. → Allocate transaction price, defer
                  revenue.
                </p>
                <p className="text-xs text-text-muted mt-2">Examples: Extended support, SaaS premium tier.</p>
              </div>
            </div>
            <div className="flex justify-between items-center flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  setWarRows((rows) => [
                    ...rows,
                    {
                      id: newUid(),
                      warranty_id: `WAR-${String(rows.length + 1).padStart(3, '0')}`,
                      contract_id: '',
                      product_description: '',
                      warranty_description: '',
                      warranty_period_months: 12,
                      warranty_value: 0,
                      allocated_fee: 0,
                      required_by_law: false,
                      covers_specs_only: true,
                      customer_can_purchase_separately: false,
                      provides_additional_service: false,
                      currency: 'USD',
                    },
                  ])
                }
              >
                <Plus className="w-4 h-4 mr-1" /> Add Warranty
              </Button>
            </div>
            <div className="space-y-4">
              {warRows.map((row) => {
                const pv = computeWarrantyPreview({
                  required_by_law: row.required_by_law,
                  covers_specs_only: row.covers_specs_only,
                  customer_can_purchase_separately: row.customer_can_purchase_separately,
                  provides_additional_service: row.provides_additional_service,
                  warranty_period_months: row.warranty_period_months,
                });
                const pvLabel =
                  pv === 'ASSURANCE'
                    ? 'Assurance-Type (IAS 37)'
                    : pv === 'SERVICE'
                      ? 'Service-Type (IFRS 15)'
                      : 'Judgement Required';
                const pvClass =
                  pv === 'ASSURANCE'
                    ? 'text-slate-700 bg-slate-100 border-slate-300'
                    : pv === 'SERVICE'
                      ? 'text-blue-900 bg-blue-50 border-blue-200'
                      : 'text-amber-900 bg-amber-50 border-amber-200';
                return (
                  <div key={row.id} className="border border-border-default rounded-lg p-4 space-y-3 bg-bg-light/20">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <input
                        className="px-2 py-1.5 border rounded text-sm"
                        placeholder="Warranty ID"
                        value={row.warranty_id}
                        onChange={(e) => setWarRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, warranty_id: e.target.value } : x)))}
                      />
                      <input
                        className="px-2 py-1.5 border rounded text-sm"
                        placeholder="Contract ID"
                        value={row.contract_id}
                        onChange={(e) => setWarRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, contract_id: e.target.value } : x)))}
                      />
                      <input
                        className="px-2 py-1.5 border rounded text-sm md:col-span-2"
                        placeholder="Product description"
                        value={row.product_description}
                        onChange={(e) =>
                          setWarRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, product_description: e.target.value } : x)))
                        }
                      />
                      <input
                        className="px-2 py-1.5 border rounded text-sm md:col-span-2"
                        placeholder="Warranty description"
                        value={row.warranty_description}
                        onChange={(e) =>
                          setWarRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, warranty_description: e.target.value } : x)))
                        }
                      />
                      <div>
                        <label className="block text-xs text-text-muted mb-1">Period (months)</label>
                        <input
                          type="number"
                          className="w-full px-2 py-1.5 border rounded text-sm"
                          value={row.warranty_period_months || ''}
                          onChange={(e) =>
                            setWarRows((rs) =>
                              rs.map((x) => (x.id === row.id ? { ...x, warranty_period_months: Number(e.target.value) || 0 } : x))
                            )
                          }
                        />
                        {row.warranty_period_months > 24 && (
                          <p className="text-[11px] text-amber-800 mt-1 font-medium">
                            ⚠ Extended period — service-type signal (IFRS 15.B31)
                          </p>
                        )}
                      </div>
                      <div>
                        <label className="block text-xs text-text-muted mb-1">Warranty value / allocated fee ($)</label>
                        <input
                          type="number"
                          className="w-full px-2 py-1.5 border rounded text-sm"
                          value={row.warranty_value || ''}
                          onChange={(e) =>
                            setWarRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, warranty_value: Number(e.target.value) || 0 } : x)))
                          }
                        />
                        <p className="text-[10px] text-text-muted mt-0.5">Estimated cost (assurance) or base fee; use Allocated fee if service-type.</p>
                      </div>
                      <div>
                        <label className="block text-xs text-text-muted mb-1">Allocated fee (service-type, optional)</label>
                        <input
                          type="number"
                          className="w-full px-2 py-1.5 border rounded text-sm"
                          value={row.allocated_fee || ''}
                          onChange={(e) =>
                            setWarRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, allocated_fee: Number(e.target.value) || 0 } : x)))
                          }
                        />
                      </div>
                      <select
                        className="px-2 py-1.5 border rounded text-sm md:col-span-2"
                        value={row.currency}
                        onChange={(e) => setWarRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, currency: e.target.value } : x)))}
                      >
                        <option value="USD">USD</option>
                        <option value="GBP">GBP</option>
                        <option value="EUR">EUR</option>
                        <option value="INR">INR</option>
                      </select>
                    </div>
                    <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Classification indicators</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <WarYesNo
                        label="[1] Required by law?"
                        sub="Statutory warranty requirement"
                        value={row.required_by_law}
                        onPick={(v) => setWarRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, required_by_law: v } : x)))}
                      />
                      <WarYesNo
                        label="[2] Covers specification compliance only?"
                        sub="Only promises the product/service meets the specs already agreed in the contract"
                        value={row.covers_specs_only}
                        onPick={(v) => setWarRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, covers_specs_only: v } : x)))}
                      />
                      <WarYesNo
                        label="[3] Customer can purchase separately?"
                        sub="This warranty/support is available as a standalone purchase to any customer"
                        value={row.customer_can_purchase_separately}
                        onPick={(v) =>
                          setWarRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, customer_can_purchase_separately: v } : x)))
                        }
                        yesExtra="— strong service signal"
                      />
                      <WarYesNo
                        label="[4] Provides additional service beyond specs?"
                        sub="Includes support, updates, proactive maintenance, hotline — beyond defect fix"
                        value={row.provides_additional_service}
                        onPick={(v) =>
                          setWarRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, provides_additional_service: v } : x)))
                        }
                        yesExtra="— service-type"
                      />
                    </div>
                    <div className={`rounded border p-3 text-sm font-semibold ${pvClass}`}>Live preview: {pvLabel}</div>
                    <button type="button" className="text-xs text-red-600 underline" onClick={() => setWarRows((rs) => rs.filter((x) => x.id !== row.id))}>
                      Remove
                    </button>
                  </div>
                );
              })}
              {warRows.length === 0 && <p className="text-sm text-text-muted">Add warranties to classify under IFRS 15.B28-B33.</p>}
            </div>
            <Button variant="primary" className="w-full bg-gradient-orange" onClick={() => void runWarrantiesClassify()} isLoading={warLoading}>
              Classify Warranties
            </Button>
            {warResult && (
              <div className="space-y-6 border-t pt-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center text-sm">
                  <div className="p-3 rounded border bg-slate-100 border-slate-300">
                    <div className="text-text-muted">Assurance-Type</div>
                    <div className="text-xl font-bold text-slate-800">{String((warResult.summary as any)?.assurance_type ?? 0)}</div>
                    <div className="text-[10px] text-text-muted">IAS 37</div>
                  </div>
                  <div className="p-3 rounded border border-blue-200 bg-blue-50/60">
                    <div className="text-text-muted">Service-Type</div>
                    <div className="text-xl font-bold text-blue-900">{String((warResult.summary as any)?.service_type ?? 0)}</div>
                    <div className="text-[10px] text-text-muted">IFRS 15</div>
                  </div>
                  <div className="p-3 rounded border border-amber-300 bg-amber-50">
                    <div className="text-text-muted">Judgement Required</div>
                    <div className="text-xl font-bold text-amber-900">{String((warResult.summary as any)?.judgement_required ?? 0)}</div>
                  </div>
                  <div className="p-3 rounded border border-green-200 bg-green-50/50">
                    <div className="text-text-muted">Total IFRS 15 Deferred</div>
                    <div className="text-xl font-bold text-green-800 amount">
                      {formatCurrency(Number((warResult.summary as any)?.total_ifrs15_deferred ?? 0), currency, 0)}
                    </div>
                  </div>
                </div>
                {((warResult.warranties as any[]) || []).map((w: any) => {
                  const wt = String(w.warranty_type || '');
                  const border =
                    wt === 'ASSURANCE' ? 'border-l-slate-500' : wt === 'SERVICE' ? 'border-l-blue-600' : 'border-l-amber-500';
                  const bg = wt === 'ASSURANCE' ? 'bg-slate-50/40' : wt === 'SERVICE' ? 'bg-blue-50/30' : 'bg-amber-50/30';
                  const jes = (w.journal_entries as any[]) || [];
                  const ind = (w.indicators_detail as Record<string, any>) || {};
                  return (
                    <div key={String(w.warranty_id)} className={`rounded-lg border-l-4 ${border} border border-border-default p-4 space-y-3 ${bg}`}>
                      {wt === 'ASSURANCE' && (
                        <>
                          <p className="text-sm font-bold text-slate-800">ASSURANCE-TYPE — IAS 37</p>
                          <p className="text-xs font-semibold text-slate-700">NOT a performance obligation</p>
                          <p className="text-sm whitespace-pre-wrap text-text-secondary">{String(w.treatment || '')}</p>
                          <p className="text-sm whitespace-pre-wrap text-text-secondary/90">{String(w.explanation || '')}</p>
                          <p className="text-xs text-text-secondary italic">Warranty costs → Cost of Sales (NOT a deduction from revenue)</p>
                          {jes.map((je: any, ji: number) => (
                            <div key={ji} className="p-3 rounded border bg-white text-sm space-y-1">
                              <p className="text-xs text-text-muted">{je.date}</p>
                              <p className="font-medium">{je.description}</p>
                              <div className="flex justify-between">
                                <span className="text-blue-800">Dr {je.debit_account}</span>
                                <span className="font-semibold amount">{formatCurrency(Number(je.amount ?? 0), currency, 0)}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-green-800">Cr {je.credit_account}</span>
                                <span className="font-semibold amount">{formatCurrency(Number(je.amount ?? 0), currency, 0)}</span>
                              </div>
                              {je.note && <p className="text-xs text-text-muted italic">{je.note}</p>}
                              <p className="text-xs text-text-muted">{je.reference}</p>
                            </div>
                          ))}
                        </>
                      )}
                      {wt === 'SERVICE' && (
                        <>
                          <p className="text-sm font-bold text-blue-900">SERVICE-TYPE — IFRS 15 PO</p>
                          <p className="text-xs font-semibold text-blue-800">Separate performance obligation</p>
                          <p className="text-2xl font-bold text-blue-800 amount">
                            Deferred revenue: {formatCurrency(Number(w.deferred_revenue_amount ?? 0), currency, 0)}
                          </p>
                          <p className="text-sm text-blue-900">
                            Monthly release:{' '}
                            <span className="font-bold amount">{formatCurrency(Number(w.monthly_release ?? 0), currency, 2)}</span>
                            /month
                          </p>
                          <p className="text-sm whitespace-pre-wrap text-text-secondary">{String(w.treatment || '')}</p>
                          <p className="text-sm whitespace-pre-wrap text-text-secondary/90">{String(w.explanation || '')}</p>
                          {jes.map((je: any, ji: number) => (
                            <div key={ji} className="p-3 rounded border bg-white text-sm space-y-1">
                              <p className="text-xs text-text-muted">{je.date}</p>
                              <p className="font-medium">{je.description}</p>
                              <div className="flex justify-between">
                                <span className="text-blue-800">Dr {je.debit_account}</span>
                                <span className="font-semibold amount">{formatCurrency(Number(je.amount ?? 0), currency, 0)}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-green-800">Cr {je.credit_account}</span>
                                <span className="font-semibold amount">{formatCurrency(Number(je.amount ?? 0), currency, 0)}</span>
                              </div>
                              <p className="text-xs text-text-muted">{je.reference}</p>
                            </div>
                          ))}
                        </>
                      )}
                      {wt === 'JUDGEMENT_REQUIRED' && (
                        <>
                          <p className="text-sm font-bold text-amber-900">JUDGEMENT REQUIRED</p>
                          <div className="flex gap-2 items-start rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                            <div>
                              <p className="font-semibold">Prepare an accounting judgement memo</p>
                              <p className="text-xs mt-1">{String(w.treatment || '')}</p>
                            </div>
                          </div>
                          <p className="text-sm whitespace-pre-wrap text-text-secondary">{String(w.explanation || '')}</p>
                          <div className="text-xs space-y-1 border rounded p-2 bg-white">
                            <p className="font-semibold text-text-primary">Indicators</p>
                            {Object.entries(ind).map(([k, info]) => {
                              if (!info || typeof info !== 'object') return null;
                              const sup = String((info as any).supports || '');
                              return (
                                <div key={k} className="flex justify-between gap-2 border-b border-border-default/50 py-1 last:border-0">
                                  <span className="text-text-muted">{(info as any).label || k}</span>
                                  <span className={sup === 'SERVICE' ? 'text-blue-800 font-medium' : sup === 'ASSURANCE' ? 'text-slate-700 font-medium' : ''}>
                                    {(info as any).value === true ? 'Yes' : (info as any).value === false ? 'No' : String((info as any).value)} → {sup}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </>
                      )}
                      <p className="text-xs text-text-muted">{String(w.ifrs_reference || '')}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {ifrs15DashTab === 'bill-and-hold' && (
          <div className="bg-white rounded-card p-6 border border-border-default shadow-card space-y-6">
            <div className="border-b border-border-default pb-4">
              <h3 className="text-lg font-bold text-text-primary">BILL-AND-HOLD ARRANGEMENTS</h3>
              <p className="text-xs text-text-muted mt-1">IFRS 15.B79-B82</p>
            </div>
            <div className="rounded-lg border border-red-300 bg-red-50/90 p-4 text-sm text-red-950 space-y-2">
              <p className="font-bold flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                HIGH AUDIT RISK AREA
              </p>
              <p>
                Bill-and-hold is a common mechanism for premature revenue recognition. ALL FOUR criteria must be met — failing any one
                requires deferral until physical delivery. Auditors test this rigorously.
              </p>
            </div>
            <div className="flex justify-between items-center flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const d = new Date().toISOString().split('T')[0];
                  setBahRows((rows) => [
                    ...rows,
                    {
                      id: newUid(),
                      arrangement_id: `BAH-${String(rows.length + 1).padStart(3, '0')}`,
                      contract_id: '',
                      customer_name: '',
                      product_description: '',
                      contract_value: 0,
                      billing_date: d,
                      expected_delivery_date: d,
                      reason_is_substantive: false,
                      product_separately_identified: false,
                      product_ready_for_transfer: false,
                      entity_cannot_redirect: false,
                      currency: 'USD',
                    },
                  ]);
                }}
              >
                <Plus className="w-4 h-4 mr-1" /> Add Arrangement
              </Button>
            </div>
            <div className="space-y-4">
              {bahRows.map((row) => {
                const nMet = [
                  row.reason_is_substantive,
                  row.product_separately_identified,
                  row.product_ready_for_transfer,
                  row.entity_cannot_redirect,
                ].filter(Boolean).length;
                const allMet = nMet === 4;
                return (
                  <div key={row.id} className="border border-border-default rounded-lg p-4 space-y-3 bg-bg-light/20">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <input
                        className="px-2 py-1.5 border rounded text-sm"
                        placeholder="Arrangement ID"
                        value={row.arrangement_id}
                        onChange={(e) => setBahRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, arrangement_id: e.target.value } : x)))}
                      />
                      <input
                        className="px-2 py-1.5 border rounded text-sm"
                        placeholder="Contract ID"
                        value={row.contract_id}
                        onChange={(e) => setBahRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, contract_id: e.target.value } : x)))}
                      />
                      <input
                        className="px-2 py-1.5 border rounded text-sm md:col-span-2"
                        placeholder="Customer name"
                        value={row.customer_name}
                        onChange={(e) => setBahRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, customer_name: e.target.value } : x)))}
                      />
                      <input
                        className="px-2 py-1.5 border rounded text-sm md:col-span-2"
                        placeholder="Product description"
                        value={row.product_description}
                        onChange={(e) => setBahRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, product_description: e.target.value } : x)))}
                      />
                      <div>
                        <label className="block text-xs text-text-muted mb-1">Contract value ($)</label>
                        <input
                          type="number"
                          className="w-full px-2 py-1.5 border rounded text-sm"
                          value={row.contract_value || ''}
                          onChange={(e) =>
                            setBahRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, contract_value: Number(e.target.value) || 0 } : x)))
                          }
                        />
                      </div>
                      <select
                        className="px-2 py-1.5 border rounded text-sm"
                        value={row.currency}
                        onChange={(e) => setBahRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, currency: e.target.value } : x)))}
                      >
                        <option value="USD">USD</option>
                        <option value="GBP">GBP</option>
                        <option value="EUR">EUR</option>
                        <option value="INR">INR</option>
                      </select>
                      <div>
                        <label className="block text-xs text-text-muted mb-1">Billing date</label>
                        <input
                          type="date"
                          className="w-full px-2 py-1.5 border rounded text-sm"
                          value={row.billing_date}
                          onChange={(e) => setBahRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, billing_date: e.target.value } : x)))}
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-text-muted mb-1">Expected delivery</label>
                        <input
                          type="date"
                          className="w-full px-2 py-1.5 border rounded text-sm"
                          value={row.expected_delivery_date}
                          onChange={(e) =>
                            setBahRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, expected_delivery_date: e.target.value } : x)))
                          }
                        />
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-bold text-text-primary">IFRS 15.B79 — four criteria (all must be met)</p>
                      <p className="text-sm font-semibold text-text-secondary mt-1">
                        Criteria met: {nMet} / 4
                      </p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <BahMetFailed
                        label="[1] Reason is substantive (customer-requested)"
                        sub="Customer has a genuine business reason for not taking physical delivery — e.g. storage constraints, production scheduling. Not seller convenience."
                        met={row.reason_is_substantive}
                        onPick={(v) => setBahRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, reason_is_substantive: v } : x)))}
                      />
                      <BahMetFailed
                        label="[2] Product separately identified for customer"
                        sub="The specific product/batch is physically tagged or segregated and cannot be redirected or commingled."
                        met={row.product_separately_identified}
                        onPick={(v) => setBahRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, product_separately_identified: v } : x)))}
                      />
                      <BahMetFailed
                        label="[3] Product ready for physical transfer"
                        sub="The product is complete and could be immediately shipped if customer requested."
                        met={row.product_ready_for_transfer}
                        onPick={(v) => setBahRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, product_ready_for_transfer: v } : x)))}
                      />
                      <BahMetFailed
                        label="[4] Entity cannot redirect to another customer"
                        sub="This product is committed to this customer and cannot be sold elsewhere."
                        met={row.entity_cannot_redirect}
                        onPick={(v) => setBahRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, entity_cannot_redirect: v } : x)))}
                      />
                    </div>
                    <div
                      className={`rounded border p-3 text-sm font-semibold ${
                        allMet
                          ? 'bg-green-50 border-green-300 text-green-900'
                          : 'bg-red-50 border-red-200 text-red-900'
                      }`}
                    >
                      {allMet ? (
                        <p>✅ Revenue recognisable on billing date ({row.billing_date || '—'})</p>
                      ) : (
                        <div>
                          <p>❌ Defer until delivery: {row.expected_delivery_date || '—'}</p>
                          <ul className="mt-2 text-amber-900 text-xs font-medium list-disc pl-4 space-y-0.5">
                            {!row.reason_is_substantive && <li>[1] Reason substantive — FAILED</li>}
                            {!row.product_separately_identified && <li>[2] Separately identified — FAILED</li>}
                            {!row.product_ready_for_transfer && <li>[3] Ready for transfer — FAILED</li>}
                            {!row.entity_cannot_redirect && <li>[4] Cannot redirect — FAILED</li>}
                          </ul>
                        </div>
                      )}
                    </div>
                    <button type="button" className="text-xs text-red-600 underline" onClick={() => setBahRows((rs) => rs.filter((x) => x.id !== row.id))}>
                      Remove
                    </button>
                  </div>
                );
              })}
              {bahRows.length === 0 && <p className="text-sm text-text-muted">Add arrangements to assess bill-and-hold under IFRS 15.B79.</p>}
            </div>
            <Button variant="primary" className="w-full bg-gradient-orange" onClick={() => void runBillAndHoldAssess()} isLoading={bahLoading}>
              Assess Arrangements
            </Button>
            {bahResult && (
              <div className="space-y-6 border-t pt-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-center text-sm">
                  <div className="p-3 rounded border border-green-300 bg-green-50">
                    <div className="text-text-muted">Recognisable now</div>
                    <div className="text-xl font-bold text-green-900">{String((bahResult.summary as any)?.recognisable_now ?? 0)}</div>
                  </div>
                  <div className="p-3 rounded border border-red-300 bg-red-50">
                    <div className="text-text-muted">Deferred until delivery</div>
                    <div className="text-xl font-bold text-red-900">{String((bahResult.summary as any)?.deferred_until_delivery ?? 0)}</div>
                  </div>
                  <div className="p-3 rounded border border-amber-300 bg-amber-50">
                    <div className="text-text-muted">Total revenue deferred</div>
                    <div className="text-xl font-bold text-amber-900 amount">
                      {formatCurrency(Number((bahResult.summary as any)?.total_revenue_deferred ?? 0), currency, 0)}
                    </div>
                  </div>
                </div>
                {((bahResult.arrangements as any[]) || []).map((a: any) => {
                  const ok = String(a.conclusion) === 'REVENUE_RECOGNISABLE';
                  const jes = (a.journal_entries as any[]) || [];
                  const failed = (a.failed_criteria as string[]) || [];
                  return (
                    <div
                      key={String(a.arrangement_id)}
                      className={`rounded-lg border-l-4 p-4 space-y-3 ${
                        ok ? 'border-l-green-600 bg-green-50/30' : 'border-l-red-600 bg-red-50/25'
                      }`}
                    >
                      {ok ? (
                        <>
                          <p className="text-xl font-bold text-green-900">✅ REVENUE RECOGNISABLE</p>
                          <p className="text-sm text-green-900">
                            Date: <strong>{String(a.billing_date || '')}</strong> — Criteria: {String(a.criteria_met_count ?? 0)}/4 ✓
                          </p>
                          <p className="text-sm text-blue-900 bg-blue-50/80 border border-blue-200 rounded p-2">
                            ℹ Disclose bill-and-hold arrangement in financial statement notes per IFRS 15.B83
                          </p>
                          <p className="text-sm whitespace-pre-wrap text-text-secondary">{String(a.explanation || '')}</p>
                          {jes.map((je: any, ji: number) => (
                            <div key={ji} className="p-3 rounded border bg-white text-sm space-y-1">
                              <p className="text-xs text-text-muted">{je.date}</p>
                              <p className="font-medium">{je.description}</p>
                              <div className="flex justify-between">
                                <span className="text-blue-800">Dr {je.debit_account}</span>
                                <span className="font-semibold amount">{formatCurrency(Number(je.amount ?? 0), currency, 0)}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-green-800">Cr {je.credit_account}</span>
                                <span className="font-semibold amount">{formatCurrency(Number(je.amount ?? 0), currency, 0)}</span>
                              </div>
                              <p className="text-xs text-text-muted">{je.reference}</p>
                            </div>
                          ))}
                        </>
                      ) : (
                        <>
                          <p className="text-xl font-bold text-red-900">❌ DEFER UNTIL DELIVERY</p>
                          <p className="text-sm text-red-900">
                            Earliest recognition: <strong>{String(a.earliest_recognition_date || a.expected_delivery_date || '')}</strong> — Criteria:{' '}
                            {String(a.criteria_met_count ?? 0)}/4 ✓
                          </p>
                          <p className="text-sm font-semibold text-red-800">Failed criteria</p>
                          <ul className="list-disc pl-5 text-sm text-red-900 space-y-1">
                            {failed.map((f: string) => (
                              <li key={f}>{f}</li>
                            ))}
                          </ul>
                          <p className="text-lg font-bold text-red-800 amount">
                            Deferred amount: {formatCurrency(Number(a.revenue_deferred ?? a.contract_value ?? 0), currency, 0)}
                          </p>
                          <p className="text-sm whitespace-pre-wrap text-text-secondary">{String(a.explanation || '')}</p>
                          {jes.map((je: any, ji: number) => (
                            <div key={ji} className="p-3 rounded border bg-white text-sm space-y-1">
                              <p className="text-xs text-text-muted">{je.date}</p>
                              <p className="font-medium">{je.description}</p>
                              <div className="flex justify-between">
                                <span className="text-blue-800">Dr {je.debit_account}</span>
                                <span className="font-semibold amount">{formatCurrency(Number(je.amount ?? 0), currency, 0)}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-green-800">Cr {je.credit_account}</span>
                                <span className="font-semibold amount">{formatCurrency(Number(je.amount ?? 0), currency, 0)}</span>
                              </div>
                              <p className="text-xs text-text-muted">{je.reference}</p>
                            </div>
                          ))}
                        </>
                      )}
                      <p className="text-xs text-text-muted">{String(a.ifrs_reference || '')}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {ifrs15DashTab === 'financing-component' && (
          <div className="bg-white rounded-card p-6 border border-border-default shadow-card space-y-6">
            <div className="border-b border-border-default pb-4">
              <h3 className="text-lg font-bold text-text-primary">SIGNIFICANT FINANCING COMPONENT</h3>
              <p className="text-xs text-text-muted mt-1">IFRS 15.60-65</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4 text-sm text-text-secondary">
                <p className="font-semibold text-blue-900 mb-2">Advance payment</p>
                <p>Customer pays BEFORE delivery. Customer finances the entity. → Revenue = PV (cash equivalent); interest expense over the advance period.</p>
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-4 text-sm text-text-secondary">
                <p className="font-semibold text-amber-900 mb-2">Deferred payment</p>
                <p>Customer pays AFTER delivery. Entity finances the customer. → Revenue = PV; interest income over the deferral period.</p>
              </div>
            </div>
            <div className="rounded-lg border border-blue-300 bg-blue-50/80 p-4 text-sm text-blue-950">
              <p className="font-semibold mb-1">Practical expedient (IFRS 15.63)</p>
              <p>If the period between transfer and payment is ≤ 12 months, no adjustment is required.</p>
            </div>
            <div className="flex justify-between items-center flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const d = new Date().toISOString().split('T')[0];
                  setFcRows((rows) => [
                    ...rows,
                    {
                      id: newUid(),
                      contract_id: '',
                      description: '',
                      contract_value: 0,
                      transfer_date: d,
                      payment_date: d,
                      payment_timing: 'deferred',
                      discount_rate: 5,
                      currency: 'USD',
                    },
                  ]);
                }}
              >
                <Plus className="w-4 h-4 mr-1" /> Add Contract
              </Button>
            </div>
            <div className="space-y-4">
              {fcRows.map((row) => {
                const pm = financingSpanMonths(row.transfer_date, row.payment_date);
                const pvPrev = financingPreviewPv(Number(row.contract_value) || 0, pm, Number(row.discount_rate) || 0);
                return (
                  <div key={row.id} className="border border-border-default rounded-lg p-4 space-y-3 bg-bg-light/20">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <input
                        className="px-2 py-1.5 border rounded text-sm"
                        placeholder="Contract ID"
                        value={row.contract_id}
                        onChange={(e) => setFcRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, contract_id: e.target.value } : x)))}
                      />
                      <select
                        className="px-2 py-1.5 border rounded text-sm"
                        value={row.currency}
                        onChange={(e) => setFcRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, currency: e.target.value } : x)))}
                      >
                        <option value="USD">USD</option>
                        <option value="GBP">GBP</option>
                        <option value="EUR">EUR</option>
                        <option value="INR">INR</option>
                      </select>
                      <input
                        className="px-2 py-1.5 border rounded text-sm md:col-span-2"
                        placeholder="Description"
                        value={row.description}
                        onChange={(e) => setFcRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, description: e.target.value } : x)))}
                      />
                      <div>
                        <label className="block text-xs text-text-muted mb-1">Contract value ($)</label>
                        <input
                          type="number"
                          className="w-full px-2 py-1.5 border rounded text-sm"
                          value={row.contract_value || ''}
                          onChange={(e) =>
                            setFcRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, contract_value: Number(e.target.value) || 0 } : x)))
                          }
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-text-muted mb-1">Discount rate (%)</label>
                        <input
                          type="number"
                          className="w-full px-2 py-1.5 border rounded text-sm"
                          value={row.discount_rate || ''}
                          onChange={(e) =>
                            setFcRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, discount_rate: Number(e.target.value) || 0 } : x)))
                          }
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-text-muted mb-1">Transfer date (goods/services)</label>
                        <input
                          type="date"
                          className="w-full px-2 py-1.5 border rounded text-sm"
                          value={row.transfer_date}
                          onChange={(e) => setFcRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, transfer_date: e.target.value } : x)))}
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-text-muted mb-1">Payment date (cash)</label>
                        <input
                          type="date"
                          className="w-full px-2 py-1.5 border rounded text-sm"
                          value={row.payment_date}
                          onChange={(e) => setFcRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, payment_date: e.target.value } : x)))}
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-xs text-text-muted mb-1">Payment timing</label>
                        <select
                          className="w-full px-2 py-1.5 border rounded text-sm"
                          value={row.payment_timing}
                          onChange={(e) =>
                            setFcRows((rs) =>
                              rs.map((x) =>
                                x.id === row.id ? { ...x, payment_timing: e.target.value as 'advance' | 'deferred' } : x
                              )
                            )
                          }
                        >
                          <option value="advance">Advance (customer pays before delivery)</option>
                          <option value="deferred">Deferred (customer pays after delivery)</option>
                        </select>
                      </div>
                    </div>
                    <div className="rounded border p-3 text-sm space-y-1 bg-white">
                      <p>
                        <span className="font-semibold">Period:</span> {pm} months
                      </p>
                      {pvPrev.expedient ? (
                        <p className="text-green-800 font-semibold">✅ Practical expedient applies — no adjustment needed</p>
                      ) : (
                        <div className="space-y-1">
                          <p>
                            <span className="font-semibold">PV:</span>{' '}
                            <span className="amount">{formatCurrency(pvPrev.pv, currency, 2)}</span>
                          </p>
                          <p>
                            <span className="font-semibold">Revenue amount (PV):</span>{' '}
                            <span className="amount">{formatCurrency(pvPrev.pv, currency, 2)}</span> vs nominal{' '}
                            <span className="amount">{formatCurrency(Number(row.contract_value) || 0, currency, 2)}</span>
                          </p>
                          <p>
                            <span className="font-semibold">Financing:</span>{' '}
                            <span className="amount">{formatCurrency(pvPrev.financing, currency, 2)}</span>{' '}
                            <span className="text-text-muted">
                              ({row.payment_timing === 'advance' ? 'interest expense' : 'interest income'})
                            </span>
                          </p>
                        </div>
                      )}
                    </div>
                    <button type="button" className="text-xs text-red-600 underline" onClick={() => setFcRows((rs) => rs.filter((x) => x.id !== row.id))}>
                      Remove
                    </button>
                  </div>
                );
              })}
              {fcRows.length === 0 && <p className="text-sm text-text-muted">Add contracts to analyse significant financing under IFRS 15.60-65.</p>}
            </div>
            <Button variant="primary" className="w-full bg-gradient-orange" onClick={() => void runFinancingComponentCalculate()} isLoading={fcLoading}>
              Calculate
            </Button>
            {fcResult && (
              <div className="space-y-6 border-t pt-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center text-sm">
                  <div className="p-3 rounded border bg-bg-light">
                    <div className="text-text-muted">Financing adjusted</div>
                    <div className="text-xl font-bold">{String((fcResult.summary as any)?.financing_adjusted ?? 0)}</div>
                  </div>
                  <div className="p-3 rounded border bg-bg-light">
                    <div className="text-text-muted">Expedient applied</div>
                    <div className="text-xl font-bold">{String((fcResult.summary as any)?.expedient_applied ?? 0)}</div>
                  </div>
                  <div className="p-3 rounded border border-green-200 bg-green-50/60">
                    <div className="text-text-muted">Interest income</div>
                    <div className="text-xl font-bold text-green-900 amount">
                      {formatCurrency(Number((fcResult.summary as any)?.interest_income_total ?? 0), currency, 0)}
                    </div>
                  </div>
                  <div className="p-3 rounded border border-amber-200 bg-amber-50/70">
                    <div className="text-text-muted">Interest expense</div>
                    <div className="text-xl font-bold text-amber-900 amount">
                      {formatCurrency(Number((fcResult.summary as any)?.interest_expense_total ?? 0), currency, 0)}
                    </div>
                  </div>
                </div>
                {((fcResult.contracts as any[]) || []).map((c: any) => {
                  const cid = String(c.contract_id ?? '');
                  const exp = Boolean(c.practical_expedient_applied);
                  const jes = (c.journal_entries as any[]) || [];
                  const sched = (c.amortisation_schedule as any[]) || [];
                  const expanded = fcSchedExpand[cid];
                  const showRows = expanded ? sched : sched.slice(0, 6);
                  const nominal = Number(c.nominal_payment ?? c.contract_value ?? 0);
                  const rev = Number(c.revenue_amount ?? 0);
                  const impact = nominal - rev;
                  return (
                    <div
                      key={cid}
                      className={`rounded-lg border-l-4 p-4 space-y-3 ${
                        exp ? 'border-l-slate-500 bg-slate-50/40' : 'border-l-blue-600 bg-blue-50/25'
                      }`}
                    >
                      {exp ? (
                        <>
                          <p className="text-sm font-bold text-slate-800">PRACTICAL EXPEDIENT (≤ 12 months)</p>
                          <p className="text-lg font-bold amount text-slate-900">Revenue: {formatCurrency(rev, currency, 0)} (no adjustment)</p>
                          <p className="text-sm whitespace-pre-wrap text-text-secondary">{String(c.explanation || '')}</p>
                          {jes[0] && (
                            <div className="p-3 rounded border bg-white text-sm space-y-1">
                              <p className="text-xs text-text-muted">{jes[0].date}</p>
                              <p className="font-medium">{jes[0].description}</p>
                              <div className="flex justify-between">
                                <span className="text-blue-800">Dr {jes[0].debit_account}</span>
                                <span className="font-semibold amount">{formatCurrency(Number(jes[0].amount ?? 0), currency, 0)}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-green-800">Cr {jes[0].credit_account}</span>
                                <span className="font-semibold amount">{formatCurrency(Number(jes[0].amount ?? 0), currency, 0)}</span>
                              </div>
                              <p className="text-xs text-text-muted">{jes[0].reference}</p>
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          <p className="text-sm font-bold text-blue-900">FINANCING COMPONENT ADJUSTED</p>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div className="rounded-lg border border-blue-200 bg-white p-3 text-center">
                              <div className="text-xs text-text-muted">Revenue (PV)</div>
                              <div className="text-2xl font-bold text-blue-900 amount">{formatCurrency(rev, currency, 0)}</div>
                            </div>
                            <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-3 text-center">
                              <div className="text-xs text-text-muted">Financing amount</div>
                              <div className="text-2xl font-bold text-amber-900 amount">{formatCurrency(Number(c.financing_amount ?? 0), currency, 0)}</div>
                              <div className="text-xs font-semibold mt-1">
                                {c.financing_type === 'INTEREST_EXPENSE' ? 'Interest expense' : 'Interest income'}
                              </div>
                            </div>
                          </div>
                          <p className="text-sm font-semibold text-text-primary">
                            Revenue impact vs nominal: −{formatCurrency(impact, currency, 0)} (auditors focus on PV vs cash)
                          </p>
                          <p className="text-sm whitespace-pre-wrap text-text-secondary">{String(c.explanation || '')}</p>
                          {sched.length > 0 && (
                            <div className="space-y-2">
                              <p className="text-xs font-bold text-text-primary">Amortisation schedule (first {expanded ? 'all' : '6'} rows)</p>
                              <div className="overflow-x-auto border rounded bg-white text-xs">
                                <table className="w-full">
                                  <thead>
                                    <tr className="bg-bg-light border-b">
                                      <th className="text-left p-2">Period</th>
                                      <th className="text-right p-2">Opening</th>
                                      <th className="text-right p-2">Interest</th>
                                      <th className="text-right p-2">Closing</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {showRows.map((s: any, i: number) => (
                                      <tr key={i} className="border-b border-border-default/40">
                                        <td className="p-2">{String(s.period)}</td>
                                        <td className="p-2 text-right amount">{formatCurrency(Number(s.opening_balance ?? 0), currency, 2)}</td>
                                        <td className="p-2 text-right amount">{formatCurrency(Number(s.interest ?? 0), currency, 2)}</td>
                                        <td className="p-2 text-right amount">{formatCurrency(Number(s.closing_balance ?? 0), currency, 2)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                              {sched.length > 6 && (
                                <button
                                  type="button"
                                  className="text-xs text-orange-primary font-semibold underline"
                                  onClick={() => setFcSchedExpand((m) => ({ ...m, [cid]: !m[cid] }))}
                                >
                                  {expanded ? 'Show less' : 'View all'}
                                </button>
                              )}
                            </div>
                          )}
                          {jes.map((je: any, ji: number) => (
                            <div key={ji} className="p-3 rounded border bg-white text-sm space-y-1">
                              <p className="text-xs text-text-muted">{je.date}</p>
                              <p className="font-medium">{je.description}</p>
                              <div className="flex justify-between">
                                <span className="text-blue-800">Dr {je.debit_account}</span>
                                <span className="font-semibold amount">{formatCurrency(Number(je.amount ?? 0), currency, 0)}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-green-800">Cr {je.credit_account}</span>
                                <span className="font-semibold amount">{formatCurrency(Number(je.amount ?? 0), currency, 0)}</span>
                              </div>
                              {je.note && <p className="text-xs text-text-muted italic">{je.note}</p>}
                              <p className="text-xs text-text-muted">{je.reference}</p>
                            </div>
                          ))}
                        </>
                      )}
                      <p className="text-xs text-text-muted">{String(c.ifrs_reference || '')}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {ifrs15DashTab === 'tp-adjustments' && (
          <div className="bg-white rounded-card p-6 border border-border-default shadow-card space-y-6">
            <div className="border-b border-border-default pb-4">
              <h3 className="text-lg font-bold text-text-primary">TRANSACTION PRICE ADJUSTMENTS</h3>
              <p className="text-xs text-text-muted mt-1">IFRS 15.66-72 — Non-cash consideration & consideration payable to the customer</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setTpAdjPanel('non-cash')}
                className={`px-4 py-2 rounded-lg text-sm font-semibold border ${
                  tpAdjPanel === 'non-cash' ? 'bg-gradient-orange text-white border-orange-primary' : 'bg-bg-light text-text-secondary border-border-default'
                }`}
              >
                Non-cash consideration
              </button>
              <button
                type="button"
                onClick={() => setTpAdjPanel('payable')}
                className={`px-4 py-2 rounded-lg text-sm font-semibold border ${
                  tpAdjPanel === 'payable' ? 'bg-gradient-orange text-white border-orange-primary' : 'bg-bg-light text-text-secondary border-border-default'
                }`}
              >
                Consideration payable
              </button>
              <button
                type="button"
                onClick={() => setTpAdjPanel('tp-change')}
                className={`px-4 py-2 rounded-lg text-sm font-semibold border ${
                  tpAdjPanel === 'tp-change' ? 'bg-gradient-orange text-white border-orange-primary' : 'bg-bg-light text-text-secondary border-border-default'
                }`}
              >
                TP change (catch-up / prospective)
              </button>
            </div>
            {tpAdjPanel === 'tp-change' && (
              <div className="space-y-4">
                <p className="text-sm text-text-secondary">IFRS 15.87-90 — Remeasure transaction price when facts change.</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <input className="border rounded px-2 py-1.5 text-sm" placeholder="Contract ID" value={tpChangeForm.contract_id} onChange={(e) => setTpChangeForm((f) => ({ ...f, contract_id: e.target.value }))} />
                  <select className="border rounded px-2 py-1.5 text-sm" value={tpChangeForm.adjustment_reason} onChange={(e) => setTpChangeForm((f) => ({ ...f, adjustment_reason: e.target.value }))}>
                    <option value="variable_consideration">Variable consideration</option>
                    <option value="modification">Modification</option>
                    <option value="new_info">New information</option>
                  </select>
                  <input className="border rounded px-2 py-1.5 text-sm" placeholder="Original TP" value={tpChangeForm.original_transaction_price} onChange={(e) => setTpChangeForm((f) => ({ ...f, original_transaction_price: e.target.value }))} />
                  <input className="border rounded px-2 py-1.5 text-sm" placeholder="New TP" value={tpChangeForm.new_transaction_price} onChange={(e) => setTpChangeForm((f) => ({ ...f, new_transaction_price: e.target.value }))} />
                  <input className="border rounded px-2 py-1.5 text-sm" placeholder="Revenue recognised to date" value={tpChangeForm.revenue_recognised_to_date} onChange={(e) => setTpChangeForm((f) => ({ ...f, revenue_recognised_to_date: e.target.value }))} />
                  <input className="border rounded px-2 py-1.5 text-sm" placeholder="Remaining POs" value={tpChangeForm.remaining_performance_obligations} onChange={(e) => setTpChangeForm((f) => ({ ...f, remaining_performance_obligations: e.target.value }))} />
                  <select className="border rounded px-2 py-1.5 text-sm" value={tpChangeForm.adjustment_method} onChange={(e) => setTpChangeForm((f) => ({ ...f, adjustment_method: e.target.value }))}>
                    <option value="cumulative_catchup">Cumulative catch-up</option>
                    <option value="prospective">Prospective</option>
                  </select>
                </div>
                <Button
                  variant="primary"
                  onClick={async () => {
                    setTpChangeLoading(true);
                    try {
                      const res = await ifrs15Api.tpAdjustmentsChange({
                        ...tpChangeForm,
                        original_transaction_price: Number(tpChangeForm.original_transaction_price) || 0,
                        new_transaction_price: Number(tpChangeForm.new_transaction_price) || 0,
                        revenue_recognised_to_date: Number(tpChangeForm.revenue_recognised_to_date) || 0,
                        remaining_performance_obligations: Number(tpChangeForm.remaining_performance_obligations) || 1,
                      });
                      if (res.error) throw new Error(res.error);
                      setTpChangeResult(res.data as Record<string, unknown>);
                      toast.success('TP adjustment calculated');
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : 'Failed');
                    } finally {
                      setTpChangeLoading(false);
                    }
                  }}
                  isLoading={tpChangeLoading}
                >
                  Calculate TP adjustment
                </Button>
                {tpChangeResult && (
                  <div className="text-sm space-y-1 border rounded p-3 bg-bg-light">
                    <p>Adjustment: {String(tpChangeResult.adjustment_amount)}</p>
                    <p>Current period impact: {String(tpChangeResult.current_period_impact)}</p>
                    <p>Method: {String(tpChangeResult.method_used)}</p>
                    <p className="text-xs text-text-muted">{String(tpChangeResult.disclosure_note)}</p>
                  </div>
                )}
              </div>
            )}
            {tpAdjPanel === 'non-cash' && (
              <div className="space-y-4">
                <p className="text-xs font-semibold text-blue-900">IFRS 15.66-69 — Non-cash consideration</p>
                <p className="text-sm text-text-secondary">
                  When a customer pays with goods, services, or equity instead of cash, include the fair value of the non-cash consideration in the transaction price at contract
                  inception.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setNcRows((rows) => [
                      ...rows,
                      {
                        id: newUid(),
                        item_id: '',
                        contract_id: '',
                        description: '',
                        consideration_type: 'goods',
                        fv_unreliable: false,
                        fair_value: 0,
                        fallback_ssp: 0,
                        currency: 'USD',
                      },
                    ])
                  }
                >
                  <Plus className="w-4 h-4 mr-1" /> Add non-cash item
                </Button>
                <div className="space-y-4">
                  {ncRows.map((row) => {
                    const fvOk = !row.fv_unreliable;
                    const tpAdd = fvOk ? Number(row.fair_value) || 0 : Number(row.fallback_ssp) || 0;
                    const badge = fvOk ? 'FAIR VALUE' : 'SSP FALLBACK';
                    return (
                      <div key={row.id} className="border border-border-default rounded-lg p-4 space-y-3 bg-bg-light/20">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          <input
                            className="px-2 py-1.5 border rounded text-sm"
                            placeholder="Item ID"
                            value={row.item_id}
                            onChange={(e) => setNcRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, item_id: e.target.value } : x)))}
                          />
                          <input
                            className="px-2 py-1.5 border rounded text-sm"
                            placeholder="Contract ID"
                            value={row.contract_id}
                            onChange={(e) => setNcRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, contract_id: e.target.value } : x)))}
                          />
                          <input
                            className="px-2 py-1.5 border rounded text-sm md:col-span-2"
                            placeholder="Description"
                            value={row.description}
                            onChange={(e) => setNcRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, description: e.target.value } : x)))}
                          />
                          <div>
                            <label className="block text-xs text-text-muted mb-1">Type</label>
                            <select
                              className="w-full px-2 py-1.5 border rounded text-sm"
                              value={row.consideration_type}
                              onChange={(e) => setNcRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, consideration_type: e.target.value } : x)))}
                            >
                              <option value="goods">Goods</option>
                              <option value="services">Services</option>
                              <option value="equity">Equity</option>
                              <option value="data">Data</option>
                              <option value="other">Other</option>
                            </select>
                          </div>
                          <select
                            className="px-2 py-1.5 border rounded text-sm"
                            value={row.currency}
                            onChange={(e) => setNcRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, currency: e.target.value } : x)))}
                          >
                            <option value="USD">USD</option>
                            <option value="GBP">GBP</option>
                            <option value="EUR">EUR</option>
                            <option value="INR">INR</option>
                          </select>
                          <div>
                            <label className="block text-xs text-text-muted mb-1">Fair value ($)</label>
                            <input
                              type="number"
                              className="w-full px-2 py-1.5 border rounded text-sm"
                              value={row.fair_value || ''}
                              onChange={(e) => setNcRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, fair_value: Number(e.target.value) || 0 } : x)))}
                            />
                          </div>
                          <label className="flex items-center gap-2 text-xs md:col-span-2">
                            <input
                              type="checkbox"
                              checked={row.fv_unreliable}
                              onChange={(e) => setNcRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, fv_unreliable: e.target.checked } : x)))}
                            />
                            Fair value cannot be reliably determined
                          </label>
                          {row.fv_unreliable && (
                            <div className="md:col-span-2">
                              <label className="block text-xs text-text-muted mb-1">Fallback SSP ($)</label>
                              <input
                                type="number"
                                className="w-full px-2 py-1.5 border rounded text-sm"
                                value={row.fallback_ssp || ''}
                                onChange={(e) => setNcRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, fallback_ssp: Number(e.target.value) || 0 } : x)))}
                              />
                            </div>
                          )}
                        </div>
                        <div className="rounded border p-3 bg-white text-sm space-y-1">
                          <p className="font-semibold text-text-primary">Live preview</p>
                          <p>
                            <span className="text-text-muted">Method:</span>{' '}
                            <span className="px-2 py-0.5 rounded text-xs font-bold bg-slate-100">{badge}</span>
                          </p>
                          <p>
                            <span className="text-text-muted">TP addition:</span>{' '}
                            <span className="amount text-lg font-bold text-emerald-700">{formatCurrency(tpAdd, row.currency || 'USD', 2)}</span>
                          </p>
                        </div>
                        <button type="button" className="text-xs text-red-600 underline" onClick={() => setNcRows((rs) => rs.filter((x) => x.id !== row.id))}>
                          Remove
                        </button>
                      </div>
                    );
                  })}
                  {ncRows.length === 0 && <p className="text-sm text-text-muted">Add items for IFRS 15.66-69 non-cash consideration.</p>}
                </div>
              </div>
            )}

            {tpAdjPanel === 'payable' && (
              <div className="space-y-4">
                <p className="text-xs font-semibold text-amber-900">IFRS 15.70-72 — Consideration payable</p>
                <p className="text-sm text-text-secondary">
                  When the entity pays cash or gives credits to a customer, this reduces revenue — unless the entity receives a distinct benefit, in which case it may be a cost
                  instead.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setCpRows((rows) => [
                      ...rows,
                      {
                        id: newUid(),
                        item_id: '',
                        contract_id: '',
                        description: '',
                        payment_type: 'cash',
                        amount: 0,
                        distinct_benefit_received: false,
                        fair_value_of_benefit: 0,
                        currency: 'USD',
                      },
                    ])
                  }
                >
                  <Plus className="w-4 h-4 mr-1" /> Add payment item
                </Button>
                <div className="space-y-4">
                  {cpRows.map((row) => {
                    const pv = cpPayablePreview(row.amount, row.distinct_benefit_received, row.fair_value_of_benefit);
                    return (
                      <div key={row.id} className="border border-border-default rounded-lg p-4 space-y-3 bg-bg-light/20">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          <input
                            className="px-2 py-1.5 border rounded text-sm"
                            placeholder="Item ID"
                            value={row.item_id}
                            onChange={(e) => setCpRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, item_id: e.target.value } : x)))}
                          />
                          <input
                            className="px-2 py-1.5 border rounded text-sm"
                            placeholder="Contract ID"
                            value={row.contract_id}
                            onChange={(e) => setCpRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, contract_id: e.target.value } : x)))}
                          />
                          <input
                            className="px-2 py-1.5 border rounded text-sm md:col-span-2"
                            placeholder="Description (e.g. setup fee waived)"
                            value={row.description}
                            onChange={(e) => setCpRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, description: e.target.value } : x)))}
                          />
                          <div>
                            <label className="block text-xs text-text-muted mb-1">Type</label>
                            <select
                              className="w-full px-2 py-1.5 border rounded text-sm"
                              value={row.payment_type}
                              onChange={(e) => setCpRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, payment_type: e.target.value } : x)))}
                            >
                              <option value="cash">Cash</option>
                              <option value="credit">Credit</option>
                              <option value="voucher">Voucher</option>
                              <option value="waived_fee">Waived fee</option>
                              <option value="mdf">MDF</option>
                              <option value="rebate">Rebate</option>
                            </select>
                          </div>
                          <select
                            className="px-2 py-1.5 border rounded text-sm"
                            value={row.currency}
                            onChange={(e) => setCpRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, currency: e.target.value } : x)))}
                          >
                            <option value="USD">USD</option>
                            <option value="GBP">GBP</option>
                            <option value="EUR">EUR</option>
                            <option value="INR">INR</option>
                          </select>
                          <div>
                            <label className="block text-xs text-text-muted mb-1">Amount ($)</label>
                            <input
                              type="number"
                              className="w-full px-2 py-1.5 border rounded text-sm"
                              value={row.amount || ''}
                              onChange={(e) => setCpRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, amount: Number(e.target.value) || 0 } : x)))}
                            />
                          </div>
                          <label className="flex items-center gap-2 text-xs md:col-span-2">
                            <input
                              type="checkbox"
                              checked={row.distinct_benefit_received}
                              onChange={(e) => setCpRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, distinct_benefit_received: e.target.checked } : x)))}
                            />
                            Distinct benefit received
                          </label>
                          {row.distinct_benefit_received && (
                            <div className="md:col-span-2">
                              <label className="block text-xs text-text-muted mb-1">FV of benefit ($)</label>
                              <input
                                type="number"
                                className="w-full px-2 py-1.5 border rounded text-sm"
                                value={row.fair_value_of_benefit || ''}
                                onChange={(e) =>
                                  setCpRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, fair_value_of_benefit: Number(e.target.value) || 0 } : x)))
                                }
                              />
                            </div>
                          )}
                        </div>
                        <div className="rounded border p-3 bg-white text-sm space-y-1">
                          <p className="font-semibold text-text-primary">Live treatment preview</p>
                          {pv.kind === 'REVENUE_REDUCTION' && (
                            <p className="text-red-700 font-semibold">Revenue reduction: −{formatCurrency(pv.revenueRed, row.currency || 'USD', 2)}</p>
                          )}
                          {pv.kind === 'COST_FULL' && (
                            <p className="text-amber-800 font-semibold">Cost: {formatCurrency(pv.cost, row.currency || 'USD', 2)}</p>
                          )}
                          {pv.kind === 'SPLIT' && (
                            <p className="text-text-secondary">
                              <span className="text-amber-800 font-semibold">Cost {formatCurrency(pv.cost, row.currency || 'USD', 2)}</span>
                              {' + '}
                              <span className="text-red-700 font-semibold">Revenue −{formatCurrency(pv.revenueRed, row.currency || 'USD', 2)}</span>
                            </p>
                          )}
                        </div>
                        <button type="button" className="text-xs text-red-600 underline" onClick={() => setCpRows((rs) => rs.filter((x) => x.id !== row.id))}>
                          Remove
                        </button>
                      </div>
                    );
                  })}
                  {cpRows.length === 0 && <p className="text-sm text-text-muted">Add items for IFRS 15.70-72 consideration payable to the customer.</p>}
                </div>
              </div>
            )}

            <Button variant="primary" className="w-full bg-gradient-orange" onClick={() => void runTpAdjustments()} isLoading={tpAdjLoading}>
              Calculate transaction price adjustments
            </Button>
            {tpAdjResult && (tpAdjResult.non_cash != null || tpAdjResult.consideration_payable != null) && (
              <div className="space-y-6 border-t pt-6">
                {tpAdjResult.non_cash != null && (
                  <div className="space-y-4">
                    <p className="text-sm font-bold text-text-primary">Non-cash results (IFRS 15.66-69)</p>
                    <div className="p-4 rounded-lg border border-emerald-200 bg-emerald-50/40 text-center">
                      <p className="text-xs text-text-muted">Total TP from non-cash</p>
                      <p className="text-2xl font-bold text-emerald-800 amount">
                        {formatCurrency(Number((tpAdjResult.non_cash as Record<string, unknown>).total_tp_from_non_cash) || 0, currency, 2)}
                      </p>
                    </div>
                    {(((tpAdjResult.non_cash as Record<string, unknown>).items as Record<string, unknown>[]) || []).map((it) => {
                      const ccy = String(it.currency || currency);
                      const method = String(it.measurement_method || '');
                      const badge = method === 'FAIR_VALUE' ? 'FAIR VALUE' : 'SSP FALLBACK';
                      const jes = (it.journal_entries as Record<string, unknown>[]) || [];
                      return (
                        <div key={String(it.item_id)} className="rounded-lg border border-blue-200 p-4 space-y-2 bg-white">
                          <div className="flex flex-wrap justify-between gap-2">
                            <p className="text-sm font-bold">{String(it.description || it.item_id)}</p>
                            <span className="text-xs font-bold px-2 py-0.5 rounded bg-slate-100">{badge}</span>
                          </div>
                          <p className="text-lg font-bold text-emerald-700 amount">
                            TP addition: {formatCurrency(Number(it.transaction_price_addition) || 0, ccy, 2)}
                          </p>
                          <p className="text-sm text-text-secondary whitespace-pre-wrap">{String(it.explanation || '')}</p>
                          {jes.map((je, ji) => (
                            <div key={ji} className="p-3 rounded border bg-bg-light/40 text-sm space-y-1">
                              <p className="text-xs text-text-muted">{String(je.date)}</p>
                              <p className="font-medium">{String(je.description)}</p>
                              <div className="flex justify-between">
                                <span className="text-blue-800">Dr {String(je.debit_account)}</span>
                                <span className="font-semibold amount">{formatCurrency(Number(je.amount) || 0, ccy, 2)}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-green-800">Cr {String(je.credit_account)}</span>
                                <span className="font-semibold amount">{formatCurrency(Number(je.amount) || 0, ccy, 2)}</span>
                              </div>
                              <p className="text-xs text-text-muted">{String(je.reference)}</p>
                            </div>
                          ))}
                          <p className="text-xs text-text-muted">{String(it.ifrs_reference || '')}</p>
                        </div>
                      );
                    })}
                  </div>
                )}

                {tpAdjResult.consideration_payable != null && (
                  <div className="space-y-4">
                    <p className="text-sm font-bold text-text-primary">Consideration payable results (IFRS 15.70-72)</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="p-4 rounded-lg border border-red-200 bg-red-50/40 text-center">
                        <p className="text-xs text-text-muted">Total revenue reduction</p>
                        <p className="text-xl font-bold text-red-800 amount">
                          {formatCurrency(Number((tpAdjResult.consideration_payable as Record<string, unknown>).total_revenue_reduction) || 0, currency, 2)}
                        </p>
                      </div>
                      <div className="p-4 rounded-lg border border-amber-200 bg-amber-50/40 text-center">
                        <p className="text-xs text-text-muted">Total cost recognition</p>
                        <p className="text-xl font-bold text-amber-900 amount">
                          {formatCurrency(Number((tpAdjResult.consideration_payable as Record<string, unknown>).total_cost_recognition) || 0, currency, 2)}
                        </p>
                      </div>
                    </div>
                    {(((tpAdjResult.consideration_payable as Record<string, unknown>).items as Record<string, unknown>[]) || []).map((it) => {
                      const ccy = String(it.currency || currency);
                      const tr = String(it.treatment || '');
                      const jes = (it.journal_entries as Record<string, unknown>[]) || [];
                      const badge =
                        tr === 'REVENUE_REDUCTION' ? (
                          <span className="text-xs font-bold px-2 py-1 rounded bg-red-100 text-red-900">↓ Reduces revenue</span>
                        ) : tr === 'COST_FULL' ? (
                          <span className="text-xs font-bold px-2 py-1 rounded bg-amber-100 text-amber-900">→ Marketing / service cost</span>
                        ) : (
                          <span className="text-xs font-bold px-2 py-1 rounded bg-orange-100 text-orange-900">Cost + revenue reduction</span>
                        );
                      return (
                        <div key={String(it.item_id)} className="rounded-lg border border-amber-200 p-4 space-y-2 bg-white">
                          <div className="flex flex-wrap justify-between gap-2 items-start">
                            <div>
                              <p className="text-sm font-bold">{String(it.description || it.item_id)}</p>
                              <p className="text-xs text-text-muted">{String(it.payment_type)}</p>
                            </div>
                            {badge}
                          </div>
                          {Number(it.revenue_reduction) > 0 && (
                            <p className="text-sm text-red-700 font-semibold">
                              Revenue reduction: {formatCurrency(Number(it.revenue_reduction) || 0, ccy, 2)}
                            </p>
                          )}
                          {Number(it.cost_recognition) > 0 && (
                            <p className="text-sm text-amber-800 font-semibold">
                              Cost recognised: {formatCurrency(Number(it.cost_recognition) || 0, ccy, 2)}
                            </p>
                          )}
                          <p className="text-sm text-text-secondary whitespace-pre-wrap">{String(it.explanation || '')}</p>
                          {jes.map((je, ji) => (
                            <div key={ji} className="p-3 rounded border bg-bg-light/40 text-sm space-y-1">
                              <p className="text-xs text-text-muted">{String(je.date)}</p>
                              <p className="font-medium">{String(je.description)}</p>
                              <div className="flex justify-between">
                                <span className="text-blue-800">Dr {String(je.debit_account)}</span>
                                <span className="font-semibold amount">{formatCurrency(Number(je.amount) || 0, ccy, 2)}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-green-800">Cr {String(je.credit_account)}</span>
                                <span className="font-semibold amount">{formatCurrency(Number(je.amount) || 0, ccy, 2)}</span>
                              </div>
                              <p className="text-xs text-text-muted">{String(je.reference)}</p>
                            </div>
                          ))}
                          <p className="text-xs text-text-muted">{String(it.ifrs_reference || '')}</p>
                        </div>
                      );
                    })}
                  </div>
                )}

                {(() => {
                  const ncPkg = tpAdjResult.non_cash as Record<string, unknown> | undefined;
                  const cpPkg = tpAdjResult.consideration_payable as Record<string, unknown> | undefined;
                  const ncTotal = ncPkg ? Number(ncPkg.total_tp_from_non_cash) || 0 : 0;
                  const revRed = cpPkg ? Number(cpPkg.total_revenue_reduction) || 0 : 0;
                  const costRec = cpPkg ? Number(cpPkg.total_cost_recognition) || 0 : 0;
                  const netTp = Math.round((ncTotal - revRed) * 100) / 100;
                  return (
                    <div className="rounded-xl border border-border-default p-4 bg-bg-light/30 space-y-2 text-sm">
                      <p className="font-bold text-text-primary">Summary</p>
                      <p>
                        Non-cash TP additions: <span className="amount text-emerald-700 font-semibold">{formatCurrency(ncTotal, currency, 2)}</span>
                      </p>
                      <p>
                        Revenue reductions (payable):{' '}
                        <span className="amount text-red-700 font-semibold">−{formatCurrency(revRed, currency, 2)}</span>
                      </p>
                      <p>
                        Cost recognitions (payable): <span className="amount text-amber-800 font-semibold">{formatCurrency(costRec, currency, 2)}</span>
                      </p>
                      <p className="pt-2 border-t font-bold">
                        Net TP adjustment: <span className="amount text-text-primary">{formatCurrency(netTp, currency, 2)}</span>
                      </p>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        )}
        {ifrs15DashTab === 'calculate' && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
        <div className="space-y-6">
          {(extractedData as { _realestate_overlay?: Record<string, unknown> })?._realestate_overlay ? (
            <div className="bg-orange-50 border border-orange-200 rounded-lg px-4 py-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-text-primary">
                <Building2 className="w-4 h-4 inline mr-1 text-orange-primary" />
                UAE real estate off-plan data loaded — completion{' '}
                {(extractedData as { _realestate_overlay?: Record<string, unknown> })._realestate_overlay?.completion_pct}%
              </p>
              <Link href="/dashboard/ifrs15/realestate" className="text-xs font-semibold text-orange-primary hover:underline">
                Edit in Real Estate UAE →
              </Link>
            </div>
          ) : null}
          {/* Upload + AI Extraction */}
          <div className="bg-white rounded-card p-6 border border-border-default shadow-card">
            <div className="border-b border-border-default pb-4 mb-6">
              <h3 className="text-base font-bold text-text-primary">Upload + AI Extraction</h3>
              <p className="text-xs text-text-muted mt-1">Upload revenue contract (PDF, DOCX, XLSX)</p>
            </div>
            <div className="flex gap-4 mb-6 border-b border-border-default">
              <button
                onClick={() => setActiveTab('upload')}
                className={`px-4 py-2 font-medium text-sm border-b-2 ${activeTab === 'upload' ? 'border-orange-primary text-orange-primary' : 'border-transparent text-text-secondary'}`}
              >
                <div className="flex items-center gap-2"><Upload className="w-4 h-4" /> Upload</div>
              </button>
              <button
                onClick={() => setActiveTab('manual')}
                className={`px-4 py-2 font-medium text-sm border-b-2 ${activeTab === 'manual' ? 'border-orange-primary text-orange-primary' : 'border-transparent text-text-secondary'}`}
              >
                <div className="flex items-center gap-2"><FileText className="w-4 h-4" /> Paste Text</div>
              </button>
            </div>

            {activeTab === 'upload' && (
              <div
                className="border-2 border-dashed border-orange-primary rounded-lg p-12 text-center hover:bg-orange-light/30 cursor-pointer"
                onClick={() => document.getElementById('ifrs15-file')?.click()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files[0];
                  if (f) handleFileSelect({ target: { files: [f] } } as any);
                }}
                onDragOver={(e) => e.preventDefault()}
            >
              <Upload className="w-16 h-16 text-orange-primary mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2 text-text-primary">Drop revenue contract here</h3>
                <p className="text-sm text-text-muted mb-6">Supports PDF, DOCX, TXT, Excel (.xlsx, .xls)</p>
                <input type="file" id="ifrs15-file" accept=".pdf,.docx,.txt,.xlsx,.xls" className="hidden" onChange={handleFileSelect} />
                {file && !isUploading && <p className="text-sm text-text-primary font-medium">{file.name}</p>}
                {isUploading && <div className="flex items-center justify-center gap-2 text-orange-primary"><Loader2 className="w-4 h-4 animate-spin" /> Extracting...</div>}
            </div>
            )}

            {activeTab === 'manual' && (
            <div>
                <label className="block text-sm font-medium text-text-primary mb-2">Paste contract text</label>
              <textarea
                value={contractText}
                onChange={(e) => setContractText(e.target.value)}
                  rows={8}
                  className="w-full px-4 py-3 bg-bg-light border border-border-default rounded-lg focus:ring-2 focus:ring-orange-primary text-text-primary"
                  placeholder="Paste revenue contract text..."
                />
                <Button
                  variant="primary"
                  size="md"
                  className="mt-4 w-full bg-gradient-orange"
                  onClick={async () => {
                    if (!contractText.trim()) {
                      toast.error('Please paste contract text');
                      return;
                    }
                    setIsUploading(true);
                    setExtractedData(null);
                    applyClauseDetectionFromResponse(null);
                    try {
                      const response = await ifrs15Api.extract(contractText) as any;
                      const { data, error } = response;
                      if (error) throw new Error(error);
                      setExtractedData(data?.extracted_data);
                      if (data?.clause_detection) {
                        applyClauseDetectionFromResponse(data.clause_detection as Record<string, unknown>);
                      }
                      const vc = data?.extracted_data?.step3_transaction_price?.variable_consideration || {};
                      setVcConstraint({
                        constraint_method: vc.constraint_method ?? 'percentage',
                        constraint_percentage: Number(vc.constraint_percentage ?? 100),
                        variable_consideration_constrained: Number(vc.variable_consideration_constrained ?? 0),
                      });
                      toast.success('Contract extracted successfully!');
                    } catch (e: any) {
                      toast.error(e?.message || 'Extraction failed');
                    } finally {
                      setIsUploading(false);
                    }
                  }}
                  disabled={!contractText.trim()}
                  isLoading={isUploading}
                >
                Analyze Contract
              </Button>

              <div className="mb-6 mt-6 p-4 bg-blue-50 border border-blue-200 rounded-xl">
                <label className="font-semibold text-gray-800 mb-3 block">
                  Contract Type
                  <span className="ml-2 text-xs text-blue-500">IFRS 15 §31-38</span>
                </label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { key: 'time_and_material', label: '⏱ Time & Material', desc: 'Hours × Rate' },
                    { key: 'fixed_price', label: '📋 Fixed Price (POC)', desc: 'Cost-to-cost method' },
                    { key: 'capped_tm', label: '🔒 Capped T&M', desc: 'T&M with maximum cap' },
                    { key: 'maintenance', label: '🔧 Maintenance', desc: 'Straight-line' },
                  ].map((ct) => (
                    <button
                      key={ct.key}
                      onClick={() => updateStep3({ contract_type: ct.key })}
                      type="button"
                      className={`p-3 rounded-lg border-2 text-left transition-all ${
                        step3.contract_type === ct.key
                          ? 'border-orange-500 bg-orange-50'
                          : 'border-gray-200 bg-white hover:border-orange-300'
                      }`}
                    >
                      <div className="font-semibold text-sm">{ct.label}</div>
                      <div className="text-xs text-gray-500 mt-1">{ct.desc}</div>
                    </button>
                  ))}
                </div>
                <label className="block text-sm font-medium text-text-primary mt-4 mb-1">Payment terms (billing pattern)</label>
                <input
                  type="text"
                  value={step3.payment_terms ?? ''}
                  onChange={(e) => updateStep3({ payment_terms: e.target.value })}
                  className="w-full px-3 py-2 border border-border-default rounded-lg text-sm"
                  placeholder='e.g. Annual in advance, or Net 30 days after delivery'
                />
              </div>

              {step3.contract_type === 'time_and_material' && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-text-primary mb-1">Hours Worked</label>
                    <input type="number" value={step3.hours_worked} onChange={(e) => updateStep3({ hours_worked: e.target.value })} className="w-full px-3 py-2 border border-border-default rounded-lg" />
                  </div>
                  <div>
                    <label className="block text-sm text-text-primary mb-1">Hourly Rate ($)</label>
                    <input type="number" value={step3.hourly_rate} onChange={(e) => updateStep3({ hourly_rate: e.target.value })} className="w-full px-3 py-2 border border-border-default rounded-lg" />
                  </div>
                </div>
              )}

              {(step3.contract_type === 'fixed_price' || step3.contract_type === 'capped_tm') && (
                <div className="grid grid-cols-3 gap-4 mt-4">
                  <div>
                    <label className="block text-sm text-text-primary mb-1">Total Estimated Cost</label>
                    <input type="number" value={step3.total_estimated_cost} onChange={(e) => updateStep3({ total_estimated_cost: e.target.value })} className="w-full px-3 py-2 border border-border-default rounded-lg" />
                  </div>
                  <div>
                    <label className="block text-sm text-text-primary mb-1">Actual Cost to Date</label>
                    <input type="number" value={step3.actual_cost_to_date} onChange={(e) => updateStep3({ actual_cost_to_date: e.target.value })} className="w-full px-3 py-2 border border-border-default rounded-lg" />
                  </div>
                  <div>
                    <label className="block text-sm text-text-primary mb-1">Prior Revenue Recognised</label>
                    <input type="number" value={step3.prior_revenue_recognised} onChange={(e) => updateStep3({ prior_revenue_recognised: e.target.value })} className="w-full px-3 py-2 border border-border-default rounded-lg" />
                  </div>
                </div>
              )}

              {step3.contract_type === 'capped_tm' && (
                <div className="grid grid-cols-2 gap-4 mt-4">
                  <div>
                    <label className="block text-sm text-text-primary mb-1">T&M Cap Amount</label>
                    <input type="number" value={step3.tm_cap} onChange={(e) => updateStep3({ tm_cap: e.target.value })} className="w-full px-3 py-2 border border-border-default rounded-lg" />
                  </div>
                  <div>
                    <label className="block text-sm text-text-primary mb-1">Cumulative Billed to Date</label>
                    <input type="number" value={step3.cumulative_billed} onChange={(e) => updateStep3({ cumulative_billed: e.target.value })} className="w-full px-3 py-2 border border-border-default rounded-lg" />
                  </div>
                </div>
              )}

              <div className="mt-6">
                <button onClick={() => setShowSLA(!showSLA)} className="text-sm font-semibold text-blue-600 flex items-center gap-2" type="button">
                  {showSLA ? '▲' : '▼'}
                  SLA Penalties / Credits (optional)
                  <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded">Reduces Revenue</span>
                </button>

                {showSLA && (
                  <div className="mt-3 space-y-3">
                    {slaItems.map((sla, i) => (
                      <div key={i} className="grid grid-cols-4 gap-3 p-3 bg-red-50 rounded-lg">
                        <input placeholder="SLA Name" value={sla.name} onChange={(e) => setSlaItems((prev) => prev.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))} className="px-2 py-1 border rounded" />
                        <input placeholder="Target %" type="number" value={sla.target} onChange={(e) => setSlaItems((prev) => prev.map((x, idx) => idx === i ? { ...x, target: e.target.value } : x))} className="px-2 py-1 border rounded" />
                        <input placeholder="Actual %" type="number" value={sla.actual} onChange={(e) => setSlaItems((prev) => prev.map((x, idx) => idx === i ? { ...x, actual: e.target.value } : x))} className="px-2 py-1 border rounded" />
                        <input placeholder="Monthly Fee" type="number" value={sla.monthly_fee} onChange={(e) => setSlaItems((prev) => prev.map((x, idx) => idx === i ? { ...x, monthly_fee: e.target.value } : x))} className="px-2 py-1 border rounded" />
                      </div>
                    ))}
                    <button onClick={addSLAItem} className="text-sm text-blue-600" type="button">
                      + Add SLA
                    </button>
                  </div>
                )}
              </div>

              <div className="mt-6">
                <button onClick={() => setShowVolumeDiscount(!showVolumeDiscount)} className="text-sm font-semibold text-blue-600 flex items-center gap-2" type="button">
                  {showVolumeDiscount ? '▲' : '▼'}
                  Volume Discounts (optional)
                  <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded">Variable Consideration</span>
                </button>

                {showVolumeDiscount && (
                  <div className="mt-3 space-y-3">
                    {volumeSlabs.map((slab, i) => (
                      <div key={i} className="grid grid-cols-3 gap-3 p-3 bg-amber-50 rounded-lg">
                        <input placeholder="Min Volume $" type="number" value={slab.min_volume} onChange={(e) => setVolumeSlabs((prev) => prev.map((x, idx) => idx === i ? { ...x, min_volume: e.target.value } : x))} className="px-2 py-1 border rounded" />
                        <input placeholder="Max Volume $" type="number" value={slab.max_volume} onChange={(e) => setVolumeSlabs((prev) => prev.map((x, idx) => idx === i ? { ...x, max_volume: e.target.value } : x))} className="px-2 py-1 border rounded" />
                        <input placeholder="Discount %" type="number" value={slab.discount_pct} onChange={(e) => setVolumeSlabs((prev) => prev.map((x, idx) => idx === i ? { ...x, discount_pct: e.target.value } : x))} className="px-2 py-1 border rounded" />
                      </div>
                    ))}
                    <button onClick={addVolumeSlab} className="text-sm text-blue-600" type="button">
                      + Add Slab
                    </button>

                    <div className="flex items-center gap-3">
                      <input type="checkbox" checked={step3.can_estimate_volume} onChange={(e) => updateStep3({ can_estimate_volume: e.target.checked })} />
                      <label className="text-sm">I can estimate annual volume</label>
                    </div>

                    {step3.can_estimate_volume && (
                      <input placeholder="Estimated annual volume $" type="number" value={step3.estimated_annual_volume} onChange={(e) => updateStep3({ estimated_annual_volume: e.target.value })} className="w-full px-3 py-2 border rounded-lg" />
                    )}

                    {!step3.can_estimate_volume && (
                      <p className="text-xs text-amber-700">
                        ⚠ Maximum discount will be applied (conservative — IFRS 15 §56)
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
            )}

            {clauseDetection != null && (
              <div className="mt-6 space-y-3">
                {clauseOverall === 'CLEAN' && (
                  <div className="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-green-900">
                    <div className="font-semibold flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5 shrink-0" />
                      No non-standard clauses detected
                    </div>
                    <p className="text-sm mt-1">Standard IFRS 15 treatment applies. Safe to proceed with calculation.</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="bg-white border border-green-300 text-green-900"
                        onClick={() => setClauseCleanKeepVisible(true)}
                      >
                        Keep visible
                      </Button>
                    </div>
                  </div>
                )}

                {clauseOverall === 'LOW' && clauseList.length > 0 && (
                  <div className="rounded-lg border border-yellow-300 bg-yellow-50 text-yellow-950">
                    <button
                      type="button"
                      className="w-full px-4 py-3 flex items-center justify-between text-left font-semibold"
                      onClick={() => setClauseBannerExpanded(!clauseBannerExpanded)}
                    >
                      <span>
                        ⚠ {clauseList.length} low-risk clause(s) detected — review recommended before calculating.
                      </span>
                      <span className="text-sm">{clauseBannerExpanded ? '▲' : '▼'}</span>
                    </button>
                    {clauseBannerExpanded && (
                      <div className="px-4 pb-4 overflow-x-auto">
                        <table className="w-full text-sm border border-yellow-200 rounded-lg overflow-hidden bg-white">
                          <thead className="bg-yellow-100">
                            <tr>
                              <th className="text-left p-2">Type</th>
                              <th className="text-left p-2">Severity</th>
                              <th className="text-left p-2">IFRS 15 impact</th>
                              <th className="text-left p-2 w-28" />
                            </tr>
                          </thead>
                          <tbody>
                            {clauseList.map((row, idx) => {
                              const ct = String(row.clause_type || '');
                              const sev = String(row.severity || '');
                              const impact = String(row.ifrs15_impact || '');
                              const short = impact.length > 80 ? `${impact.slice(0, 80)}…` : impact;
                              const open = !!clauseRowDetailOpen[idx];
                              const ack = !!clauseAcknowledged[idx];
                              return (
                                <Fragment key={`${ct}-${idx}`}>
                                  <tr className={`border-t border-yellow-100 ${ack ? 'bg-gray-100 text-gray-500' : ''}`}>
                                    <td className="p-2">
                                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium border ${clauseTypeBadgeClass(ct)}`}>{ct || '—'}</span>
                                    </td>
                                    <td className="p-2">
                                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${severityPillClass(sev)}`}>{sev}</span>
                                    </td>
                                    <td className="p-2">{short}</td>
                                    <td className="p-2">
                                      <Button
                                        type="button"
                                        variant="secondary"
                                        size="sm"
                                        className="text-xs"
                                        onClick={() => setClauseRowDetailOpen((p) => ({ ...p, [idx]: !open }))}
                                      >
                                        {open ? '▲ Hide' : '▼ View details'}
                                      </Button>
                                    </td>
                                  </tr>
                                  {open && (
                                    <tr className={`${ack ? 'bg-gray-100' : 'bg-white'}`}>
                                      <td colSpan={4} className="p-3 text-sm space-y-3">
                                        <div>
                                          <p className="text-xs font-semibold text-text-muted mb-1">Exact contract language</p>
                                          <p className="italic text-gray-700 bg-gray-50 border border-gray-200 rounded p-2">{String(row.exact_quote || '—')}</p>
                                        </div>
                                        <div>
                                          <p className="text-xs font-semibold text-text-muted mb-1">IFRS 15 treatment</p>
                                          <p className="text-blue-900 bg-blue-50 border border-blue-200 rounded p-2">{String(row.recommended_treatment || '—')}</p>
                                        </div>
                                        <p className="text-xs text-text-muted">Reference: {String(row.paragraph_reference || '—')}</p>
                                        <Button
                                          type="button"
                                          variant="secondary"
                                          size="sm"
                                          disabled={ack}
                                          onClick={() => setClauseAcknowledged((p) => ({ ...p, [idx]: true }))}
                                        >
                                          {ack ? 'Reviewed' : 'Acknowledge ✓'}
                                        </Button>
                                      </td>
                                    </tr>
                                  )}
                                </Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {(clauseOverall === 'MEDIUM' || clauseOverall === 'HIGH') && clauseList.length > 0 && (
                  <div
                    className={`rounded-lg border px-4 py-3 ${
                      clauseOverall === 'HIGH' ? 'border-red-400 bg-red-50 text-red-950' : 'border-orange-400 bg-orange-50 text-orange-950'
                    }`}
                  >
                    <div className="font-semibold flex flex-wrap items-center gap-2">
                      ⚠ {clauseList.length} clause(s) require attention — review before finalising treatment.
                      <span className="text-xs font-normal">
                        {Number(clauseDetection?.high_severity ?? 0)} HIGH · {Number(clauseDetection?.medium_severity ?? 0)} MEDIUM ·{' '}
                        {Number(clauseDetection?.low_severity ?? 0)} LOW
                      </span>
                    </div>
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full text-sm border border-black/10 rounded-lg overflow-hidden bg-white">
                        <thead className={clauseOverall === 'HIGH' ? 'bg-red-100' : 'bg-orange-100'}>
                          <tr>
                            <th className="text-left p-2">Type</th>
                            <th className="text-left p-2">Severity</th>
                            <th className="text-left p-2">IFRS 15 impact</th>
                            <th className="text-left p-2 w-28" />
                          </tr>
                        </thead>
                        <tbody>
                          {clauseList.map((row, idx) => {
                            const ct = String(row.clause_type || '');
                            const sev = String(row.severity || '');
                            const impact = String(row.ifrs15_impact || '');
                            const short = impact.length > 80 ? `${impact.slice(0, 80)}…` : impact;
                            const open = !!clauseRowDetailOpen[idx];
                            const ack = !!clauseAcknowledged[idx];
                            return (
                              <Fragment key={`${ct}-${idx}`}>
                                <tr className={`border-t ${ack ? 'bg-gray-100 text-gray-500' : ''}`}>
                                  <td className="p-2">
                                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium border ${clauseTypeBadgeClass(ct)}`}>{ct || '—'}</span>
                                  </td>
                                  <td className="p-2">
                                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${severityPillClass(sev)}`}>{sev}</span>
                                  </td>
                                  <td className="p-2">{short}</td>
                                  <td className="p-2">
                                    <Button
                                      type="button"
                                      variant="secondary"
                                      size="sm"
                                      className="text-xs"
                                      onClick={() => setClauseRowDetailOpen((p) => ({ ...p, [idx]: !open }))}
                                    >
                                      {open ? '▲ Hide' : '▼ View details'}
                                    </Button>
                                  </td>
                                </tr>
                                {open && (
                                  <tr className={ack ? 'bg-gray-100' : 'bg-white'}>
                                    <td colSpan={4} className="p-3 text-sm space-y-3">
                                      <div>
                                        <p className="text-xs font-semibold text-text-muted mb-1">Exact contract language</p>
                                        <p className="italic text-gray-700 bg-gray-50 border border-gray-200 rounded p-2">{String(row.exact_quote || '—')}</p>
                                      </div>
                                      <div>
                                        <p className="text-xs font-semibold text-text-muted mb-1">IFRS 15 treatment</p>
                                        <p className="text-blue-900 bg-blue-50 border border-blue-200 rounded p-2">{String(row.recommended_treatment || '—')}</p>
                                      </div>
                                      <p className="text-xs text-text-muted">Reference: {String(row.paragraph_reference || '—')}</p>
                                      <Button
                                        type="button"
                                        variant="secondary"
                                        size="sm"
                                        disabled={ack}
                                        onClick={() => setClauseAcknowledged((p) => ({ ...p, [idx]: true }))}
                                      >
                                        {ack ? 'Reviewed' : 'Acknowledge ✓'}
                                      </Button>
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {clauseList.length > 0 && clauseOverall !== 'CLEAN' && (
                  <div className="rounded-lg border border-border-default bg-bg-light px-3 py-2 text-sm text-text-primary flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {clauseReviewedCount} of {clauseList.length} clauses reviewed
                    </span>
                    {clauseAllReviewed && (
                      <span className="text-green-700 font-semibold flex items-center gap-1">
                        <CheckCircle2 className="w-4 h-4" /> All clauses reviewed — ready to calculate
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            {extractedData && (
              <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-lg">
                <h4 className="font-semibold text-green-700 mb-3 flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> Extraction complete</h4>
                <div className="grid grid-cols-2 gap-3 text-sm mb-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-text-muted">Customer Name:</span>
                    <span className="font-medium text-text-primary">{step1.customer_name || '—'}</span>
                    {clauseDetection?.overall_risk != null && (
                      <span
                        className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${
                          String(clauseDetection.overall_risk).toUpperCase() === 'HIGH'
                            ? 'bg-red-100 text-red-800 border-red-300'
                            : String(clauseDetection.overall_risk).toUpperCase() === 'MEDIUM'
                              ? 'bg-orange-100 text-orange-900 border-orange-300'
                              : String(clauseDetection.overall_risk).toUpperCase() === 'LOW'
                                ? 'bg-yellow-100 text-yellow-900 border-yellow-300'
                                : 'bg-green-100 text-green-800 border-green-300'
                        }`}
                      >
                        Clauses: {String(clauseDetection.overall_risk)}
                      </span>
                    )}
                  </div>
                  <div><span className="text-text-muted">Contract Date:</span> {step1.effective_date || '—'}</div>
                  <div>
                    <span className="text-text-muted">Contract Value:</span>{' '}
                    {formatCurrency(
                      step1.total_contract_value ?? extractedData?.step3_transaction_price?.total_transaction_price ?? 0,
                      sanitizeCurrencyCode(step1.currency, 'USD'),
                      0
                    )}
                  </div>
                  <div><span className="text-text-muted"># POBs:</span> {extractedData?.step2_performance_obligations?.total_obligations_count ?? 0}</div>
                  <div><span className="text-text-muted">Payment Terms:</span> {extractedData?.step3_transaction_price?.significant_financing_component?.payment_terms_exceed_one_year ? 'Exceeds 1 year' : (extractedData?.step3_transaction_price ? 'Per contract' : '—')}</div>
                  <div><span className="text-text-muted">Duration:</span> {step1.contract_term_months ?? '—'} months</div>
                </div>
                <div className="p-3 bg-white rounded border border-green-200 mb-4">
                  <p className="text-sm font-medium text-text-primary mb-2">Variable Consideration Constraint (IFRS 15 §56-58)</p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs text-text-muted">Constraint Method</label>
                      <select
                        className="w-full border rounded px-2 py-1 text-sm"
                        value={vcConstraint.constraint_method}
                        onChange={(e) => setVcConstraint((p) => ({ ...p, constraint_method: e.target.value }))}
                      >
                        <option value="percentage">% Highly Probable</option>
                        <option value="amount">Fixed Amount</option>
                      </select>
                    </div>
                    {vcConstraint.constraint_method === 'percentage' ? (
                      <div>
                        <label className="text-xs text-text-muted">Highly Probable %</label>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={1}
                          className="w-full border rounded px-2 py-1 text-sm"
                          value={vcConstraint.constraint_percentage}
                          onChange={(e) => setVcConstraint((p) => ({ ...p, constraint_percentage: parseFloat(e.target.value) || 100 }))}
                        />
                      </div>
                    ) : (
                      <div>
                        <label className="text-xs text-text-muted">Constrained Amount</label>
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          className="w-full border rounded px-2 py-1 text-sm"
                          value={vcConstraint.variable_consideration_constrained}
                          onChange={(e) => setVcConstraint((p) => ({ ...p, variable_consideration_constrained: parseFloat(e.target.value) || 0 }))}
                        />
                      </div>
                    )}
                  </div>
                  {vcConstraint.constraint_method === 'percentage' && vcConstraint.constraint_percentage < 100 && (
                    <p className="text-xs text-amber-600 mt-2">
                      VC constrained to {vcConstraint.constraint_percentage}% - {((extractedVariableAmount || 0) * (vcConstraint.constraint_percentage / 100)).toFixed(2)} included, {((extractedVariableAmount || 0) * (1 - vcConstraint.constraint_percentage / 100)).toFixed(2)} excluded.
                    </p>
                  )}
                </div>
                <div className="p-3 bg-white rounded border border-green-200 mb-4">
                  <p className="text-sm font-medium text-text-primary mb-1">IFRS 15.56 — Constraint Assessment</p>
                  <p className="text-xs text-text-muted mb-3">
                    Variable consideration is only included in the transaction price to the extent it is highly probable that a significant reversal will not occur.
                  </p>
                  <div className="space-y-2 text-sm">
                    {(
                      [
                        ['susceptible_to_external', 'Highly susceptible to external factors (market prices, counterparty actions, weather)'],
                        ['long_resolution_period', 'Uncertainty resolves over a long period (> 1 year to resolution)'],
                        ['wide_range_of_outcomes', 'Wide range of possible outcomes'],
                        ['limited_experience', 'Limited historical experience with this type'],
                        ['broad_price_concession_practice', 'Broad price concession history'],
                      ] as const
                    ).map(([key, label]) => (
                      <label key={key} className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={vc1556Factors[key as keyof VC1556Factors]}
                          onChange={() =>
                            setVc1556Factors((p) => ({ ...p, [key]: !p[key as keyof VC1556Factors] }))
                          }
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                  <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-text-muted">Risk Level: </span>
                      <span
                        className={`font-semibold ${
                          vc1556ExtractionPreview.risk === 'Low'
                            ? 'text-green-700'
                            : vc1556ExtractionPreview.risk === 'Medium'
                              ? 'text-amber-700'
                              : vc1556ExtractionPreview.risk === 'High'
                                ? 'text-orange-700'
                                : 'text-red-700'
                        }`}
                      >
                        {vc1556ExtractionPreview.risk}
                      </span>
                    </div>
                    <div className="text-text-secondary">
                      VC before constraint:{' '}
                      <span className="font-medium text-text-primary">{formatCurrency(vc1556ExtractionPreview.constrained + vc1556ExtractionPreview.excluded, sanitizeCurrencyCode(step1.currency, 'USD'), 0)}</span>
                    </div>
                    <div>
                      Constrained amount:{' '}
                      <span className="font-semibold text-green-700">{formatCurrency(vc1556ExtractionPreview.constrained, sanitizeCurrencyCode(step1.currency, 'USD'), 0)}</span>
                    </div>
                    <div>
                      Excluded amount:{' '}
                      <span className="font-semibold text-red-600">{formatCurrency(vc1556ExtractionPreview.excluded, sanitizeCurrencyCode(step1.currency, 'USD'), 0)}</span>
                    </div>
                  </div>
                </div>
                <Button variant="primary" size="md" onClick={() => handleCalculate()} isLoading={isCalculating}>
                  <Calculator className="w-4 h-4" /> Calculate with Extracted Data
                </Button>
              </div>
            )}
          </div>

          {/* 5-Step Checklist with real data - same as IFRS 16 */}
          {(extractedData || results) && (
          <div className="bg-white rounded-card p-6 border border-border-default shadow-card">
            <div className="border-b border-border-default pb-4 mb-6">
              <h3 className="text-base font-bold text-text-primary">5-Step IFRS 15 Checklist</h3>
              <p className="text-xs text-text-muted mt-1">Complete all steps for revenue recognition</p>
            </div>
            <div className="space-y-4">
              <div className={`flex items-center gap-4 p-4 rounded-lg border-2 ${stepStatus.step1 ? 'bg-green-50 border-green-200' : 'bg-bg-light border-border-default'}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${stepStatus.step1 ? 'bg-green-500 text-white' : 'bg-orange-primary text-white'}`}>1</div>
                <div className="flex-1">
                    <span className="font-semibold text-text-primary">Identify the contract</span>
                    {stepStatus.step1 && <CheckCircle2 className="w-5 h-5 text-green-600 inline ml-2" />}
                    {stepStatus.step1 && customerName && <p className="text-sm text-text-muted mt-1">— {customerName}</p>}
                  </div>
                </div>
              <div className={`flex items-center gap-4 p-4 rounded-lg border-2 ${stepStatus.step2 ? 'bg-green-50 border-green-200' : 'bg-bg-light border-border-default'}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${stepStatus.step2 ? 'bg-green-500 text-white' : 'bg-orange-primary text-white'}`}>2</div>
                <div className="flex-1">
                    <span className="font-semibold text-text-primary">Identify performance obligations</span>
                    {stepStatus.step2 && <CheckCircle2 className="w-5 h-5 text-green-600 inline ml-2" />}
                    {stepStatus.step2 && <p className="text-sm text-text-muted mt-1">— {numPOBs} obligation{numPOBs !== 1 ? 's' : ''}</p>}
                  </div>
                </div>
              <div className={`flex items-center gap-4 p-4 rounded-lg border-2 ${stepStatus.step3 ? 'bg-green-50 border-green-200' : 'bg-bg-light border-border-default'}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${stepStatus.step3 ? 'bg-green-500 text-white' : 'bg-orange-primary text-white'}`}>3</div>
                <div className="flex-1">
                    <span className="font-semibold text-text-primary">Determine transaction price</span>
                    {stepStatus.step3 && <CheckCircle2 className="w-5 h-5 text-green-600 inline ml-2" />}
                    {stepStatus.step3 && results && <p className="text-sm text-text-muted mt-1">— {displayTp == null ? '—' : formatCurrency(displayTp, currency, 0)}</p>}
                  </div>
                </div>
              <div className={`flex items-center gap-4 p-4 rounded-lg border-2 ${stepStatus.step4 ? 'bg-green-50 border-green-200' : 'bg-bg-light border-border-default'}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${stepStatus.step4 ? 'bg-green-500 text-white' : 'bg-orange-primary text-white'}`}>4</div>
                <div className="flex-1">
                    <span className="font-semibold text-text-primary">Allocate transaction price</span>
                    {stepStatus.step4 && <CheckCircle2 className="w-5 h-5 text-green-600 inline ml-2" />}
                    {stepStatus.step4 && <p className="text-sm text-text-muted mt-1">— {numPOBs} obligation{numPOBs !== 1 ? 's' : ''}</p>}
                  </div>
                </div>
              <div className={`flex items-center gap-4 p-4 rounded-lg border-2 ${stepStatus.step5 ? 'bg-green-50 border-green-200' : 'bg-bg-light border-border-default'}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${stepStatus.step5 ? 'bg-green-500 text-white' : 'bg-orange-primary text-white'}`}>5</div>
                <div className="flex-1">
                    <span className="font-semibold text-text-primary">Recognise revenue</span>
                    {stepStatus.step5 ? <CheckCircle2 className="w-5 h-5 text-green-600 inline ml-2" /> : <Clock className="w-5 h-5 text-amber-500 inline ml-2" />}
                    <p className="text-sm text-text-muted mt-1">{stepStatus.step5 && results ? `— ${formatCurrency(rec, currency, 0)} recognised` : '— Pending recognition'}</p>
                  </div>
                </div>
              </div>
              {!results && extractedData && (
                <Button variant="primary" size="lg" className="w-full mt-6 bg-gradient-orange hover:opacity-90" onClick={() => handleCalculate()} isLoading={isCalculating}>
                  <Calculator className="w-5 h-5" /> Calculate with Extracted Data
                </Button>
              )}
            </div>
          )}

          {/* Results - same level of detail as IFRS 16 */}
          {results && (
            <>
              {results?.revenue_engine_result && (
                <div className="p-5 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl mb-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-bold text-blue-900">Revenue Engine Result</h3>
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded font-medium">
                      {results?.revenue_engine_result?.method}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <div className="text-xs text-gray-500">Revenue This Period</div>
                      <div className="text-2xl font-bold text-blue-700">
                        ${results?.revenue_engine_result?.revenue_this_period?.toLocaleString?.()}
                      </div>
                    </div>

                    {results?.revenue_engine_result?.poc_percentage != null && (
                      <div>
                        <div className="text-xs text-gray-500">POC %</div>
                        <div className="text-2xl font-bold text-green-700">
                          {results?.revenue_engine_result?.poc_percentage}%
                        </div>
                        <div className="mt-1 h-2 bg-gray-200 rounded-full">
                          <div
                            className="h-2 bg-green-500 rounded-full"
                            style={{ width: `${results?.revenue_engine_result?.poc_percentage}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {results?.revenue_engine_result?.remaining_revenue != null && (
                      <div>
                        <div className="text-xs text-gray-500">Remaining Revenue</div>
                        <div className="text-2xl font-bold text-orange-600">
                          ${results?.revenue_engine_result?.remaining_revenue?.toLocaleString?.()}
                        </div>
                      </div>
                    )}
                  </div>

                  {results?.revenue_engine_result?.formula && (
                    <div className="mt-3 p-2 bg-blue-900 rounded text-xs text-white font-mono text-center">
                      📐 {results?.revenue_engine_result?.formula}
                    </div>
                  )}

                  {results?.onerous_check?.is_onerous && (
                    <div className="mt-3 p-3 bg-red-50 border border-red-300 rounded-lg">
                      <div className="font-bold text-red-700">⚠ ONEROUS CONTRACT DETECTED</div>
                      <div className="text-sm text-red-600 mt-1">
                        Expected loss: ${results?.onerous_check?.expected_loss?.toLocaleString?.()} — Provision required immediately (IAS 37)
                      </div>
                    </div>
                  )}

                  {results?.revenue_engine_result?.switched_to_poc && (
                    <div className="mt-3 p-2 bg-amber-50 border border-amber-300 rounded text-sm text-amber-700">
                      🔒 Cap exceeded by ${results?.revenue_engine_result?.cap_exceeded_by?.toLocaleString?.()} — Switched from T&M to POC method
                    </div>
                  )}
                </div>
              )}

              {results?.sla_result?.total_penalty > 0 && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-xl mb-4">
                  <h3 className="font-bold text-red-800 mb-2">SLA Penalties — Negative Revenue</h3>
                  <div className="text-2xl font-bold text-red-700 mb-2">
                    −${results?.sla_result?.total_penalty?.toLocaleString?.()}
                  </div>
                  <div className="space-y-1">
                    {results?.sla_result?.sla_details
                      ?.filter((s: any) => s?.breach)
                      ?.map((s: any, i: number) => (
                        <div key={i} className="text-sm text-red-600">
                          • {s?.sla_name}: target {s?.target}%, actual {s?.actual}% → penalty ${s?.penalty?.toFixed?.(0)}
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {results?.vc_constraint_result && (
                <div className="p-5 bg-white border border-border-default rounded-xl mb-4 shadow-sm">
                  <h3 className="font-bold text-text-primary mb-1">IFRS 15.56–58 — Variable consideration constraint</h3>
                  <p className="text-xs text-text-muted mb-3">Applied in transaction price calculation</p>
                  {(() => {
                    const cr = results.vc_constraint_result as Record<string, unknown>;
                    const risk = String(cr.risk_level || '');
                    const pill =
                      risk === 'Low'
                        ? 'bg-green-100 text-green-800'
                        : risk === 'Medium'
                          ? 'bg-amber-100 text-amber-900'
                          : risk === 'High'
                            ? 'bg-orange-100 text-orange-900'
                            : 'bg-red-100 text-red-800';
                    const raw = Number(cr.estimated_vc_before_constraint ?? 0);
                    const excl = Number(cr.excluded_amount ?? 0);
                    const factorLabels: Record<string, string> = {
                      susceptible_to_external: 'Highly susceptible to external factors',
                      long_resolution_period: 'Uncertainty resolves over a long period',
                      wide_range_of_outcomes: 'Wide range of possible outcomes',
                      limited_experience: 'Limited experience with this contract type',
                      broad_price_concession_practice: 'History of broad price concessions',
                    };
                    return (
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`text-xs font-bold px-3 py-1 rounded-full ${pill}`}>{risk}</span>
                          <span className="text-sm text-text-secondary">
                            Score: {Number(cr.constraint_score ?? 0)} / 5 factors
                          </span>
                        </div>
                        {(Array.isArray(cr.factors_present) ? cr.factors_present : []).length > 0 && (
                          <ul className="text-sm list-disc pl-5 text-text-secondary space-y-1">
                            {(cr.factors_present as string[]).map((f) => (
                              <li key={f}>{factorLabels[f] || f.replace(/_/g, ' ')}</li>
                            ))}
                          </ul>
                        )}
                        <p className="text-sm text-text-primary leading-relaxed">{String(cr.explanation || '')}</p>
                        {excl > 0 && (
                          <p className="text-sm font-semibold text-orange-700">
                            Transaction price reduced by {formatCurrency(excl, currency, 0)} due to constraint application (vs unconstrained VC{' '}
                            {formatCurrency(raw, currency, 0)}).
                          </p>
                        )}
                        <p className="text-[10px] text-text-muted">{String(cr.ifrs_reference || 'IFRS 15.56-58')}</p>
                      </div>
                    );
                  })()}
                </div>
              )}

              <div className="bg-white rounded-card p-6 border border-border-default shadow-card">
                <div className="border-b border-border-default pb-4 mb-6">
                  <h3 className="text-base font-bold text-text-primary">Calculation Results</h3>
                  <p className="text-xs text-text-muted mt-1">IFRS 15 revenue recognition metrics</p>
                </div>
                <div className="space-y-3">
                  <div className="flex justify-between items-center p-3 hover:bg-orange-light rounded-lg border-l-4 border-orange-primary transition-colors">
                    <span className="text-sm text-text-secondary">Total Contract Value</span>
                    <span className="text-base font-bold text-green-600 amount">{displayTp == null ? '—' : formatCurrency(displayTp, currency, 0)}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 hover:bg-green-50 rounded-lg border-l-4 border-green-500 transition-colors">
                    <span className="text-sm text-text-secondary">Total Revenue Recognised</span>
                    <span className="text-base font-bold text-green-600 amount">{typeof rec === 'number' ? formatCurrency(rec, currency, 0) : '—'}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 hover:bg-amber-50 rounded-lg border-l-4 border-amber-500 transition-colors">
                    <span className="text-sm text-text-secondary">Deferred Revenue</span>
                    <span className={`text-base font-bold amount ${typeof def === 'number' && def > 0 ? 'text-orange-600' : 'text-text-muted'}`}>
                      {deferredKpiText}
                    </span>
                  </div>
                  <div className="flex justify-between items-center p-3 hover:bg-blue-50 rounded-lg border-l-4 border-blue-500 transition-colors">
                    <span className="text-sm text-text-secondary flex items-center gap-1">
                      Contract Assets
                      {contractAssetNoteStr ? (
                        <span className="inline-flex" title={contractAssetNoteStr}>
                          <HelpCircle className="w-4 h-4 text-text-muted cursor-help" aria-label={contractAssetNoteStr} />
                        </span>
                      ) : null}
                    </span>
                    <span className="text-base font-bold text-blue-600 amount">{typeof totalContractAssets === 'number' ? formatCurrency(totalContractAssets, currency, 0) : '—'}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 hover:bg-orange-light rounded-lg border-l-4 border-orange-primary transition-colors">
                    <span className="text-sm text-text-secondary">Effective Revenue Rate</span>
                    <span className="text-base font-bold text-orange-primary amount">{effectiveRevenueRate === '—' ? '—' : `${effectiveRevenueRate}%`}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 hover:bg-bg-light rounded-lg border-l-4 border-border-default transition-colors">
                    <span className="text-sm text-text-secondary">Number of Performance Obligations</span>
                    <span className="text-base font-bold text-text-primary">{numPOBs}</span>
              </div>
            </div>
          </div>

              {perfObs.length > 0 && (
                <div className="bg-white rounded-card p-6 border border-border-default shadow-card">
                  <h3 className="text-base font-bold text-text-primary mb-4">Revenue per Obligation</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-border-default">
                          <th className="text-left py-2 px-3 text-xs font-semibold text-text-secondary uppercase">Obligation</th>
                          <th className="text-right py-2 px-3 text-xs font-semibold text-text-secondary uppercase">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {perfObs.map((ob: any, idx: number) => (
                          <tr key={ob.obligation_id || ob.obligation || idx} className="border-b border-border-default hover:bg-orange-light">
                            <td className="py-2 px-3 text-sm text-text-primary">{ob.obligation || ob.obligation_id || `PO-${idx + 1}`}</td>
                            <td className="py-2 px-3 text-sm text-right font-semibold amount">{formatCurrency(Number(ob.allocated_amount ?? 0), currency, 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Revenue Recognition Schedule Table - same style as IFRS 16 amortization */}
              <div className="bg-white rounded-card p-6 border border-border-default shadow-card">
            <div className="border-b border-border-default pb-4 mb-6">
              <h3 className="text-base font-bold text-text-primary">Revenue Recognition Schedule</h3>
                    <p className="text-xs text-text-muted mt-1">Revenue by period and obligation</p>
            </div>
            {schedule.length > 0 ? (
            <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border-default">
                    <th className="text-left py-3 px-4 text-xs font-semibold text-text-secondary uppercase">Period</th>
                          <th className="text-left py-3 px-4 text-xs font-semibold text-text-secondary uppercase">Contract ID</th>
                          <th className="text-left py-3 px-4 text-xs font-semibold text-text-secondary uppercase">Performance Obligation</th>
                          <th className="text-right py-3 px-4 text-xs font-semibold text-text-secondary uppercase">Revenue Amount</th>
                          <th className="text-left py-3 px-4 text-xs font-semibold text-text-secondary uppercase">Recognised Date</th>
                          <th className="text-right py-3 px-4 text-xs font-semibold text-text-secondary uppercase">Opening Balance</th>
                          <th className="text-right py-3 px-4 text-xs font-semibold text-text-secondary uppercase">Closing Balance</th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-text-secondary uppercase">Status</th>
                  </tr>
                </thead>
                <tbody>
                        {(scheduleViewAll ? schedule : schedule.slice(0, 6)).map((row: any, idx: number) => {
                              const rev = Number(row.Revenue ?? row.revenue_amount ?? row.revenue ?? 0);
                              const displayAmt = ifrs15ScheduleDisplayAmount(row);
                              const cum = Number(row.Cumulative ?? row.cumulative_recognized ?? row.closing_balance ?? rev);
                              const opening = cum - rev;
                              const rowStatus = ifrs15ScheduleRowStatus(row);
                              const isRecognised = rowStatus === 'Recognised';
                              return (
                            <tr
                              key={idx}
                              className={`border-b border-border-default hover:bg-orange-light transition-colors ${isRecognised ? 'bg-orange-50/50' : 'bg-amber-50/30'}`}
                            >
                              <td className="py-3 px-4 text-sm text-text-primary">{row.Month || row.Date || row.Period}</td>
                              <td className="py-3 px-4 text-sm text-text-primary">{contractId}</td>
                              <td className="py-3 px-4 text-sm text-text-primary">{row.Obligation || row.Obligation_ID}</td>
                              <td className="py-3 px-4 text-sm text-right font-semibold amount">{formatCurrency(displayAmt, currency, 0)}</td>
                              <td className="py-3 px-4 text-sm text-text-secondary">{row.Date || row.Month || '—'}</td>
                              <td className="py-3 px-4 text-sm text-right text-text-primary amount">{formatCurrency(opening, currency, 0)}</td>
                              <td className="py-3 px-4 text-sm text-right text-text-primary amount">{formatCurrency(cum, currency, 0)}</td>
                    <td className="py-3 px-4 text-right">
                                <span className={`px-2 py-1 text-xs font-semibold rounded-full ${isRecognised ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                                  {rowStatus}
                                </span>
                    </td>
                  </tr>
                          );
                        })}
                </tbody>
              </table>
            </div>
                  {schedule.length > 6 && (
                    <button
                      type="button"
                      onClick={() => setScheduleViewAll(!scheduleViewAll)}
                      className="mt-4 text-sm font-semibold text-orange-primary hover:underline"
                    >
                      {scheduleViewAll ? 'Show less' : `View All (${schedule.length} rows)`}
                    </button>
                  )}
            </>
            ) : (
              <p className="text-sm text-text-muted">No revenue schedule — run calculation first</p>
            )}
          </div>

              {/* Contract Modifications — IFRS 15.18-21 */}
              <div className="bg-white rounded-card p-6 border border-border-default shadow-card">
                <div className="border-b border-border-default pb-4 mb-4">
                  <h3 className="text-base font-bold text-text-primary">Contract Modifications</h3>
                  <p className="text-xs text-text-muted mt-1">IFRS 15.18–21</p>
                </div>

                {modificationHistory.length > 0 && (
                  <div className="space-y-2 mb-4">
                    <p className="text-xs font-semibold text-text-muted uppercase">Past assessments</p>
                    {modificationHistory.map((h) => (
                      <details key={h.id} className="border border-border-default rounded-lg bg-bg-light/50">
                        <summary className="px-3 py-2 cursor-pointer text-sm font-medium text-text-primary">
                          {h.modification_date} — {h.typeLabel}
                        </summary>
                        <div className="px-3 pb-3 text-xs text-text-secondary border-t border-border-default pt-2">
                          {h.description}
                        </div>
                      </details>
                    ))}
                  </div>
                )}

                <div className="flex justify-end mb-4">
                  <Button
                    variant="primary"
                    size="sm"
                    className="bg-gradient-orange"
                    onClick={() => setShowModificationSection(!showModificationSection)}
                  >
                    {showModificationSection ? 'Hide' : '+ Record Modification'}
                  </Button>
                </div>

                {showModificationSection && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm text-text-primary mb-1">Modification Date</label>
                        <input
                          type="date"
                          value={modForm.modification_date}
                          onChange={(e) => setModForm((p) => ({ ...p, modification_date: e.target.value }))}
                          className="w-full px-3 py-2 border border-border-default rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-text-primary mb-1">Price Change ($)</label>
                        <input
                          type="number"
                          value={modForm.price_change}
                          onChange={(e) => setModForm((p) => ({ ...p, price_change: Number(e.target.value || 0) }))}
                          className="w-full px-3 py-2 border border-border-default rounded-lg"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-sm text-text-primary mb-1">Description</label>
                        <input
                          type="text"
                          value={modForm.modification_description}
                          onChange={(e) => setModForm((p) => ({ ...p, modification_description: e.target.value }))}
                          className="w-full px-3 py-2 border border-border-default rounded-lg"
                          placeholder="Brief description of the modification"
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-text-primary mb-1">Remaining Transaction Price ($)</label>
                        <input
                          type="number"
                          value={modForm.remaining_transaction_price}
                          onChange={(e) =>
                            setModForm((p) => ({ ...p, remaining_transaction_price: Number(e.target.value || 0) }))
                          }
                          className="w-full px-3 py-2 border border-border-default rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-text-primary mb-1">New Goods/Services (comma-separated)</label>
                        <input
                          type="text"
                          value={modForm.new_goods_csv}
                          onChange={(e) => setModForm((p) => ({ ...p, new_goods_csv: e.target.value }))}
                          className="w-full px-3 py-2 border border-border-default rounded-lg"
                          placeholder="e.g. PO-Training, Add-on Module"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-sm text-text-primary mb-1">Remaining Performance Obligations (comma-separated)</label>
                        <input
                          type="text"
                          value={modForm.remaining_po_csv}
                          onChange={(e) => setModForm((p) => ({ ...p, remaining_po_csv: e.target.value }))}
                          className="w-full px-3 py-2 border border-border-default rounded-lg"
                          placeholder="Must match obligation names; leave blank to default from calculated POs"
                        />
                      </div>
                    </div>

                    <Button variant="primary" size="md" className="bg-gradient-orange" onClick={assessModification} isLoading={isAssessingModification}>
                      Assess Modification
                    </Button>

                    {modAssessment && (
                      <div className="space-y-4">
                        {(() => {
                          const mt = String(modAssessment.modification_type || '');
                          const badgeGreen = mt === 'TYPE_1';
                          const badgeBlue = mt === 'TYPE_2';
                          const badgeAmber = mt === 'TYPE_3';
                          return (
                            <div
                              className={`p-4 rounded-lg border ${
                                badgeGreen
                                  ? 'bg-green-50 border-green-200'
                                  : badgeBlue
                                    ? 'bg-blue-50 border-blue-200'
                                    : 'bg-amber-50 border-amber-200'
                              }`}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span
                                  className={`text-xs font-bold px-2 py-1 rounded-full ${
                                    badgeGreen ? 'bg-green-600 text-white' : badgeBlue ? 'bg-blue-600 text-white' : 'bg-amber-600 text-white'
                                  }`}
                                >
                                  {mt || '—'}
                                </span>
                                <span className="text-sm font-semibold text-text-primary">
                                  {modAssessment.modification_type_name}
                                </span>
                              </div>
                              {mt === 'TYPE_3' && (
                                <p className="mt-3 text-base font-bold text-orange-primary">
                                  Catch-up: {formatCurrency(Math.abs(Number(modAssessment.catch_up_amount || 0)), currency, 0)}
                                </p>
                              )}
                            </div>
                          );
                        })()}

                        {Array.isArray(modAssessment.new_recognition_schedule) && modAssessment.new_recognition_schedule.length > 0 && (
                          <div className="border border-border-default rounded-lg overflow-hidden">
                            <h4 className="text-sm font-semibold text-text-primary px-3 py-2 bg-bg-light border-b border-border-default">
                              New recognition schedule
                            </h4>
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="bg-bg-light border-b border-border-default">
                                  <th className="text-left py-2 px-3">Obligation</th>
                                  <th className="text-right py-2 px-3">Allocated</th>
                                  <th className="text-left py-2 px-3">From</th>
                                </tr>
                              </thead>
                              <tbody>
                                {modAssessment.new_recognition_schedule.map((row: any, i: number) => (
                                  <tr key={i} className="border-b border-border-default">
                                    <td className="py-2 px-3">{row.performance_obligation}</td>
                                    <td className="py-2 px-3 text-right amount">{formatCurrency(Number(row.allocated_amount || 0), currency, 0)}</td>
                                    <td className="py-2 px-3 text-text-muted">{row.recognition_from}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}

                        <div className="border border-border-default rounded-lg p-4">
                          <h4 className="text-sm font-semibold text-text-primary mb-3">Journal entries</h4>
                          <div className="space-y-3">
                            {(modAssessment.journal_entries || []).map((entry: any, i: number) => {
                              const hasNewShape = entry.debit_account && entry.credit_account;
                              if (hasNewShape) {
                                const amt = Number(entry.amount || 0);
                                return (
                                  <div key={i} className="space-y-2 p-3 rounded-lg border border-border-default bg-bg-light/40">
                                    {entry.description && <p className="text-xs text-text-muted">{entry.description}</p>}
                                    <div className="flex justify-between text-sm">
                                      <span className="text-blue-800 font-medium">Dr {entry.debit_account}</span>
                                      <span className="text-blue-800 font-bold amount">{formatCurrency(amt, currency, 0)}</span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                      <span className="text-green-800 font-medium">Cr {entry.credit_account}</span>
                                      <span className="text-green-800 font-bold amount">{formatCurrency(amt, currency, 0)}</span>
                                    </div>
                                    <p className="text-[10px] text-text-muted">{entry.date} · {entry.reference}</p>
                                  </div>
                                );
                              }
                              return (
                                <div key={i} className={`p-3 rounded-lg border-l-4 ${Number(entry.dr || 0) > 0 ? 'bg-blue-50 border-blue-500' : 'bg-green-50 border-green-500'}`}>
                                  <div className="flex justify-between items-center">
                                    <span className={`text-sm font-medium ${Number(entry.dr || 0) > 0 ? 'text-blue-700' : 'text-green-700'}`}>
                                      {Number(entry.dr || 0) > 0 ? 'Dr.' : 'Cr.'} {entry.account}
                                    </span>
                                    <span className={`text-sm font-bold amount ${Number(entry.dr || 0) > 0 ? 'text-blue-700' : 'text-green-700'}`}>
                                      {formatCurrency(Number(entry.dr || entry.cr || 0), currency, 0)}
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        <div className="p-4 bg-bg-light border border-border-default rounded-lg">
                          <p className="text-sm text-text-primary leading-relaxed" style={{ fontFamily: 'Georgia, serif' }}>
                            {modAssessment.explanation}
                          </p>
                          <p className="text-[10px] text-text-muted mt-3">
                            {(modAssessment.journal_entries || [])[0]?.reference ||
                              (modAssessment.modification_type === 'TYPE_1'
                                ? 'IFRS 15.18'
                                : modAssessment.modification_type === 'TYPE_2'
                                  ? 'IFRS 15.20(b)'
                                  : 'IFRS 15.21')}
                          </p>
                        </div>
                      </div>
                    )}
                    {!modAssessment && <p className="text-sm text-text-muted">No modification assessed yet.</p>}
                  </div>
                )}
              </div>

              {/* Variable Consideration (IFRS 15.50–58) */}
              <div className="bg-white rounded-card p-6 border border-border-default shadow-card">
                <div className="flex items-center justify-between border-b border-border-default pb-4 mb-6">
                  <div>
                    <h3 className="text-base font-bold text-text-primary">Variable Consideration</h3>
                    <p className="text-xs text-text-muted mt-1">Estimate and constrain variable consideration (IFRS 15.56)</p>
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    className="bg-gradient-orange"
                    onClick={() => setShowVcSection(!showVcSection)}
                  >
                    {showVcSection ? 'Collapse' : 'Add Variable Consideration'}
                  </Button>
                </div>

                {showVcSection && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <button
                        type="button"
                        onClick={() => setVcMethod('expected_value')}
                        className={`text-left p-4 rounded-xl border-2 transition-all ${
                          vcMethod === 'expected_value'
                            ? 'border-orange-primary bg-orange-50/80 shadow-sm'
                            : 'border-border-default bg-bg-light hover:border-orange-200'
                        }`}
                      >
                        <p className="font-bold text-text-primary">Expected Value</p>
                        <p className="text-xs text-text-muted mt-2 leading-relaxed">
                          Use when multiple outcomes exist (probability-weighted average).
                        </p>
                      </button>
                      <button
                        type="button"
                        onClick={() => setVcMethod('scenario_weighted')}
                        className={`text-left p-4 rounded-xl border-2 transition-all ${
                          vcMethod === 'scenario_weighted'
                            ? 'border-orange-primary bg-orange-50/80 shadow-sm'
                            : 'border-border-default bg-bg-light hover:border-orange-200'
                        }`}
                      >
                        <p className="font-bold text-text-primary">Scenario Weighted</p>
                        <p className="text-xs text-text-muted mt-2 leading-relaxed">
                          Same probability weighting as expected value; label reflects scenario-based weighting.
                        </p>
                      </button>
                      <button
                        type="button"
                        onClick={() => setVcMethod('most_likely')}
                        className={`text-left p-4 rounded-xl border-2 transition-all ${
                          vcMethod === 'most_likely'
                            ? 'border-orange-primary bg-orange-50/80 shadow-sm'
                            : 'border-border-default bg-bg-light hover:border-orange-200'
                        }`}
                      >
                        <p className="font-bold text-text-primary">Most Likely Amount</p>
                        <p className="text-xs text-text-muted mt-2 leading-relaxed">
                          Use when only two possible outcomes (binary: yes/no, win/lose).
                        </p>
                      </button>
                    </div>

                    <div className="overflow-x-auto border border-border-default rounded-lg">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-bg-light border-b border-border-default">
                            <th className="text-left py-2 px-3 font-semibold">Outcome Label</th>
                            <th className="text-right py-2 px-3 font-semibold">Amount ($)</th>
                            {(vcMethod === 'expected_value' || vcMethod === 'scenario_weighted') && (
                              <th className="text-right py-2 px-3 font-semibold">Probability (%)</th>
                            )}
                            <th className="w-12" />
                          </tr>
                        </thead>
                        <tbody>
                          {vcScenarios.map((row, idx) => (
                            <tr
                              key={idx}
                              className={`border-b border-border-default ${
                                vcMethod === 'most_likely' && idx === vcMostLikelyIdx ? 'bg-orange-50/60 ring-1 ring-inset ring-orange-200' : ''
                              }`}
                              onClick={() => {
                                if (vcMethod === 'most_likely') {
                                  setVcMostLikelyManual(true);
                                  setVcMostLikelyIdx(idx);
                                }
                              }}
                            >
                              <td className="py-2 px-2">
                                <input
                                  className="w-full px-2 py-1 border border-border-default rounded"
                                  value={row.outcome}
                                  onChange={(e) => {
                                    setVcScenarios((prev) => {
                                      const n = [...prev];
                                      n[idx] = { ...n[idx], outcome: e.target.value };
                                      return n;
                                    });
                                  }}
                                />
                              </td>
                              <td className="py-2 px-2 text-right">
                                <input
                                  type="number"
                                  className="w-full min-w-[7rem] px-2 py-1 border border-border-default rounded text-right"
                                  value={row.amount}
                                  onChange={(e) => {
                                    setVcScenarios((prev) => {
                                      const n = [...prev];
                                      n[idx] = { ...n[idx], amount: e.target.value };
                                      return n;
                                    });
                                    if (vcMethod === 'most_likely') setVcMostLikelyManual(false);
                                  }}
                                />
                              </td>
                              {(vcMethod === 'expected_value' || vcMethod === 'scenario_weighted') && (
                                <td className="py-2 px-2 text-right">
                                  <input
                                    type="number"
                                    className="w-full min-w-[5rem] px-2 py-1 border border-border-default rounded text-right"
                                    value={row.probPct}
                                    onChange={(e) => {
                                      setVcScenarios((prev) => {
                                        const n = [...prev];
                                        n[idx] = { ...n[idx], probPct: e.target.value };
                                        return n;
                                      });
                                    }}
                                  />
                                </td>
                              )}
                              <td className="py-2 px-1 text-center">
                                <button
                                  type="button"
                                  className="p-1.5 text-text-muted hover:text-red-600"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (vcScenarios.length <= 1) {
                                      toast.error('Keep at least one scenario');
                                      return;
                                    }
                                    setVcScenarios((prev) => prev.filter((_, i) => i !== idx));
                                    if (vcMethod === 'most_likely') setVcMostLikelyManual(false);
                                  }}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="border-dashed"
                      onClick={() =>
                        setVcScenarios((prev) => [...prev, { outcome: `Scenario ${prev.length + 1}`, amount: '', probPct: '0' }])
                      }
                    >
                      <Plus className="w-4 h-4 inline mr-1" />
                      Add Scenario
                    </Button>

                    {(vcMethod === 'expected_value' || vcMethod === 'scenario_weighted') && (
                      <div>
                        <div className="flex justify-between text-sm mb-1">
                          <span
                            className={Math.abs(vcProbTotalPct - 100) <= 0.5 ? 'text-emerald-700 font-medium' : 'text-red-600 font-medium'}
                          >
                            Probabilities: {vcProbTotalPct.toFixed(0)}% — must total 100%
                            {Math.abs(vcProbTotalPct - 100) > 0.5 && ' (adjust to continue)'}
                          </span>
                        </div>
                        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all ${Math.abs(vcProbTotalPct - 100) <= 0.5 ? 'bg-emerald-500' : 'bg-red-400'}`}
                            style={{ width: `${Math.min(100, Math.max(0, vcProbTotalPct))}%` }}
                          />
                        </div>
                      </div>
                    )}

                    <div>
                      <h4 className="text-sm font-bold text-text-primary">Constraint Assessment (IFRS 15.56)</h4>
                      <p className="text-xs text-text-muted mt-0.5 mb-3">Check all factors that apply to this contract</p>
                      <div className="space-y-2">
                        {[
                          'High susceptibility to external factors (market prices, weather, counterparty actions)',
                          'Long resolution period (uncertainty resolves near or after end of contract)',
                          'Limited experience with similar contracts (new product line, new geography, new customer type)',
                          'Broad range of possible outcomes (wide spread between lowest and highest scenario)',
                          'Contract allows full refund on cancellation',
                        ].map((label, i) => (
                          <label key={i} className="flex items-start gap-2 text-sm text-text-primary cursor-pointer">
                            <input
                              type="checkbox"
                              className="mt-1"
                              checked={vcConstraintFactors[i]}
                              onChange={() =>
                                setVcConstraintFactors((prev) => {
                                  const n = [...prev];
                                  n[i] = !n[i];
                                  return n;
                                })
                              }
                            />
                            <span>{label}</span>
                          </label>
                        ))}
                      </div>
                      <div className="mt-4 flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-text-secondary">Constraint Risk:</span>
                        <span className={`text-xs font-bold px-3 py-1 rounded-full border ${vcConstraintPreview.pill}`}>
                          {vcConstraintPreview.level}
                        </span>
                      </div>
                    </div>

                    <div className="p-4 rounded-lg border border-blue-100 bg-blue-50/40">
                      <h4 className="text-sm font-bold text-text-primary">IFRS 15.56 — Constraint Assessment (main calculate)</h4>
                      <p className="text-xs text-text-muted mt-1 mb-3">
                        Variable consideration is only included in the transaction price to the extent it is highly probable that a significant reversal will not occur. These factors apply when you run the main contract calculation.
                      </p>
                      <div className="space-y-2 text-sm">
                        {(
                          [
                            ['susceptible_to_external', 'Highly susceptible to external factors (market prices, counterparty actions, weather)'],
                            ['long_resolution_period', 'Uncertainty resolves over a long period (> 1 year to resolution)'],
                            ['wide_range_of_outcomes', 'Wide range of possible outcomes'],
                            ['limited_experience', 'Limited historical experience with this type'],
                            ['broad_price_concession_practice', 'Broad price concession history'],
                          ] as const
                        ).map(([key, label]) => (
                          <label key={key} className="flex items-start gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              className="mt-1"
                              checked={vc1556Factors[key as keyof VC1556Factors]}
                              onChange={() =>
                                setVc1556Factors((p) => ({ ...p, [key]: !p[key as keyof VC1556Factors] }))
                              }
                            />
                            <span>{label}</span>
                          </label>
                        ))}
                      </div>
                      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                        <div>
                          <span className="text-text-muted">Risk Level: </span>
                          <span
                            className={`font-semibold ${
                              vc1556ModulePreview.risk === 'Low'
                                ? 'text-green-700'
                                : vc1556ModulePreview.risk === 'Medium'
                                  ? 'text-amber-700'
                                  : vc1556ModulePreview.risk === 'High'
                                    ? 'text-orange-700'
                                    : 'text-red-700'
                            }`}
                          >
                            {vc1556ModulePreview.risk}
                          </span>
                        </div>
                        <div className="text-text-secondary">
                          VC before constraint:{' '}
                          <span className="font-medium text-text-primary">
                            {formatCurrency(vc1556ModulePreview.constrained + vc1556ModulePreview.excluded, currency, 0)}
                          </span>
                        </div>
                        <div>
                          Constrained amount:{' '}
                          <span className="font-semibold text-green-700">{formatCurrency(vc1556ModulePreview.constrained, currency, 0)}</span>
                        </div>
                        <div>
                          Excluded amount:{' '}
                          <span className="font-semibold text-red-600">{formatCurrency(vc1556ModulePreview.excluded, currency, 0)}</span>
                        </div>
                      </div>
                    </div>

                    <Button
                      variant="primary"
                      size="md"
                      className="bg-gradient-orange w-full sm:w-auto"
                      onClick={calculateVariableConsideration}
                      isLoading={isCalculatingVc}
                    >
                      Calculate Variable Consideration
                    </Button>

                    {vcResult && (
                      <div className="space-y-4 border-t border-border-default pt-6">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <div className="p-4 rounded-lg border border-border-default bg-white shadow-sm text-center">
                            <p className="text-xs text-text-muted">Unconstrained</p>
                            <p className="text-lg font-bold text-text-primary amount mt-1">
                              {formatCurrency(Number(vcResult.expected_amount ?? 0), currency, 0)}
                            </p>
                            <p className="text-xs text-text-muted mt-1">(estimated)</p>
                          </div>
                          <div className="p-4 rounded-lg border border-orange-200 bg-orange-50/40 shadow-sm text-center">
                            <p className="text-xs text-text-muted">Constrained</p>
                            <p className="text-lg font-bold text-text-primary amount mt-1">
                              {formatCurrency(Number(vcResult.constrained_amount ?? 0), currency, 0)}
                            </p>
                            <p className="text-xs text-text-muted mt-1">(to include)</p>
                          </div>
                          <div className="p-4 rounded-lg border border-border-default bg-white shadow-sm text-center">
                            <p className="text-xs text-text-muted">Reduction</p>
                            <p className="text-lg font-bold text-text-primary amount mt-1">
                              {formatCurrency(Number(vcResult.reduction_amount ?? 0), currency, 0)}
                            </p>
                            <p className="text-xs text-text-muted mt-1">
                              ({Number(vcResult.reduction_pct ?? 0).toFixed(1)}%)
                            </p>
                          </div>
                        </div>

                        {(() => {
                          const rl = String(vcResult.risk_level ?? 'LOW');
                          const rs = (vcResult.risk_scenario as Record<string, number> | null | undefined) || {};
                          const bgClass =
                            rl === 'HIGH' ? 'bg-red-50' : rl === 'MEDIUM' ? 'bg-orange-50' : 'bg-green-50';
                          const badgeClass =
                            rl === 'HIGH'
                              ? 'bg-red-100 text-red-800 border border-red-200'
                              : rl === 'MEDIUM'
                                ? 'bg-orange-100 text-orange-900 border border-orange-200'
                                : 'bg-green-100 text-green-800 border border-green-200';
                          const badgeLabel = rl === 'HIGH' ? 'HIGH RISK' : rl === 'MEDIUM' ? 'MEDIUM RISK' : 'LOW RISK';
                          const rat = Number(vcResult.revenue_at_risk ?? 0);
                          const rpc = Number(vcResult.risk_pct_of_contract ?? 0);
                          return (
                            <div className={`relative rounded-xl border border-border-default p-5 ${bgClass}`}>
                              <span
                                className={`absolute right-4 top-4 text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full ${badgeClass}`}
                              >
                                {badgeLabel}
                              </span>
                              <p className="text-sm font-bold text-text-primary pr-28">Revenue at Risk</p>
                              <div className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-2">
                                <span className="text-2xl font-bold text-text-primary amount">
                                  {formatCurrency(rat, currency, 0)}
                                </span>
                                <span className="text-sm text-text-secondary">
                                  {rpc.toFixed(2)}% of contract
                                </span>
                              </div>
                              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm text-text-primary">
                                <p>
                                  <span className="text-text-muted">Best case:</span>{' '}
                                  {formatCurrency(Number(rs.best_case ?? 0), currency, 0)}
                                </p>
                                <p>
                                  <span className="text-text-muted">Worst case:</span>{' '}
                                  {formatCurrency(Number(rs.worst_case ?? 0), currency, 0)}
                                </p>
                                <p>
                                  <span className="text-text-muted">Most likely:</span>{' '}
                                  {formatCurrency(Number(rs.most_likely ?? 0), currency, 0)}
                                </p>
                                <p>
                                  <span className="text-text-muted">Variance:</span>{' '}
                                  {formatCurrency(Number(rs.variance ?? 0), currency, 0)}
                                </p>
                              </div>
                            </div>
                          );
                        })()}

                        {typeof vcResult.constraint_warning === 'string' && vcResult.constraint_warning.trim() !== '' && (
                          <div className="rounded-xl border border-orange-300 bg-orange-50/80 p-5 space-y-4">
                            <p className="text-sm font-bold text-orange-950">⚠ Constraint Warning</p>
                            <p className="text-sm text-orange-950 leading-relaxed">{vcResult.constraint_warning}</p>
                            <div>
                              <p className="text-xs font-semibold text-orange-900 mb-1">
                                Constraint multiplier applied:{' '}
                                {(Number(vcResult.constraint_multiplier ?? 1) * 100).toFixed(0)}% of expected value
                                included
                              </p>
                              <p className="text-xs text-orange-800 mb-1">IFRS 15.57 — reassess when uncertainty resolves.</p>
                              <p className="text-xs font-medium text-orange-900 mt-3 mb-1">Included in Transaction Price</p>
                              <div className="h-3 bg-orange-100 rounded-full overflow-hidden border border-orange-200">
                                <div
                                  className="h-full bg-orange-500 transition-all rounded-full"
                                  style={{
                                    width: `${Math.min(100, Math.max(0, Number(vcResult.constraint_multiplier ?? 1) * 100))}%`,
                                  }}
                                />
                              </div>
                              <p className="text-xs text-orange-800 mt-1">
                                {(Number(vcResult.constraint_multiplier ?? 1) * 100).toFixed(0)}% of expected value
                                reflected in constrained amount
                              </p>
                            </div>
                          </div>
                        )}

                        <div className="rounded-xl border border-border-default bg-bg-light/60 p-4 space-y-4">
                          <h4 className="text-sm font-bold text-text-primary">Revenue Reversal Risk Assessment</h4>
                          <p className="text-xs text-text-muted">
                            Adjust profile inputs, then run an assessment. A first pass runs automatically when variable consideration is calculated.
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <label className="text-xs text-text-secondary block">
                              Customer type
                              <select
                                className="mt-1 w-full border border-border-default rounded-lg px-2 py-2 text-sm text-text-primary bg-white"
                                value={reversalCustomerType}
                                onChange={(e) => setReversalCustomerType(e.target.value)}
                              >
                                <option value="government">Government</option>
                                <option value="large_corp">Large Corp</option>
                                <option value="mid_market">Mid-Market</option>
                                <option value="sme">SME</option>
                                <option value="startup">Startup</option>
                                <option value="new_customer">New Customer</option>
                              </select>
                            </label>
                            <label className="text-xs text-text-secondary block">
                              Refund right
                              <select
                                className="mt-1 w-full border border-border-default rounded-lg px-2 py-2 text-sm text-text-primary bg-white"
                                value={reversalRefundType}
                                onChange={(e) => setReversalRefundType(e.target.value)}
                              >
                                <option value="none">None</option>
                                <option value="partial">Partial</option>
                                <option value="full">Full</option>
                              </select>
                            </label>
                            <label className="text-xs text-text-secondary block sm:col-span-2">
                              Historical attainment (%)
                              <input
                                type="number"
                                min={0}
                                max={100}
                                step={0.1}
                                placeholder="Leave blank if no history"
                                className="mt-1 w-full border border-border-default rounded-lg px-2 py-2 text-sm text-text-primary bg-white"
                                value={reversalHistoricalPct}
                                onChange={(e) => setReversalHistoricalPct(e.target.value)}
                              />
                            </label>
                            <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
                              <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={reversalExtDep}
                                  onChange={(e) => setReversalExtDep(e.target.checked)}
                                />
                                External dependency
                              </label>
                              {reversalExtDep && (
                                <label className="text-xs text-text-secondary flex items-center gap-2">
                                  Level
                                  <select
                                    className="border border-border-default rounded-lg px-2 py-1.5 text-sm bg-white"
                                    value={reversalDepLevel}
                                    onChange={(e) => setReversalDepLevel(e.target.value as 'low' | 'medium' | 'high')}
                                  >
                                    <option value="low">Low</option>
                                    <option value="medium">Medium</option>
                                    <option value="high">High</option>
                                  </select>
                                </label>
                              )}
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="border-orange-200 text-orange-900"
                            isLoading={isReversalRiskLoading}
                            onClick={() => {
                              if (!vcResult) return;
                              void postReversalRiskFromVc(vcResult);
                            }}
                          >
                            Assess Reversal Risk
                          </Button>

                          {isReversalRiskLoading && !reversalRisk && (
                            <p className="text-xs text-text-muted flex items-center gap-2">
                              <Loader2 className="w-4 h-4 animate-spin" /> Computing reversal risk…
                            </p>
                          )}

                          {reversalRisk && (() => {
                            const rp = Number(reversalRisk.risk_pct ?? 0);
                            const rl = String(reversalRisk.risk_level ?? 'LOW');
                            const revWatch = Boolean(reversalRisk.reversal_watch);
                            const needleAngle = Math.PI * (1 - Math.min(100, Math.max(0, rp)) / 100);
                            const nx = 140 + 78 * Math.cos(needleAngle);
                            const ny = 125 - 78 * Math.sin(needleAngle);
                            const needleColor =
                              rp <= 25 ? '#16a34a' : rp <= 50 ? '#ca8a04' : rp <= 75 ? '#ea580c' : '#dc2626';
                            const levelBoxClass =
                              rl === 'LOW'
                                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                                : rl === 'MEDIUM'
                                  ? 'bg-amber-50 border-amber-200 text-amber-950'
                                  : rl === 'HIGH'
                                    ? 'bg-orange-50 border-orange-300 text-orange-950'
                                    : 'bg-red-50 border-red-300 text-red-950';
                            const fs = (reversalRisk.factor_scores as Record<string, number> | undefined) || {};
                            const actions = Array.isArray(reversalRisk.recommended_actions)
                              ? (reversalRisk.recommended_actions as string[])
                              : [];
                            return (
                              <div className="space-y-6 pt-2 border-t border-border-default">
                                <div className="flex flex-col items-center">
                                  <div className="relative w-full max-w-md flex justify-center items-start gap-2">
                                    {revWatch && (
                                      <span className="absolute right-0 top-0 text-[10px] font-bold uppercase tracking-wide text-red-600 bg-red-50 border border-red-200 px-2 py-1 rounded-full animate-pulse">
                                        ● REVERSAL WATCH
                                      </span>
                                    )}
                                    <svg viewBox="0 0 280 130" className="w-full max-w-[320px] h-36" aria-hidden>
                                      <defs>
                                        <linearGradient id="reversalGaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                                          <stop offset="0%" stopColor="#22c55e" />
                                          <stop offset="33%" stopColor="#eab308" />
                                          <stop offset="66%" stopColor="#f97316" />
                                          <stop offset="100%" stopColor="#ef4444" />
                                        </linearGradient>
                                      </defs>
                                      <path
                                        d="M 40 125 A 100 100 0 0 1 240 125"
                                        fill="none"
                                        stroke="url(#reversalGaugeGrad)"
                                        strokeWidth="20"
                                        strokeLinecap="round"
                                      />
                                      <line
                                        x1="140"
                                        y1="125"
                                        x2={nx}
                                        y2={ny}
                                        stroke={needleColor}
                                        strokeWidth="3"
                                        strokeLinecap="round"
                                      />
                                      <circle cx="140" cy="125" r="5" fill="#374151" />
                                    </svg>
                                  </div>
                                  <p className="text-lg font-bold text-text-primary mt-1">{rl}</p>
                                  <p className="text-xs text-text-muted">{rp.toFixed(1)}% model intensity</p>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                  <div className="p-4 rounded-lg border border-border-default bg-white text-center">
                                    <p className="text-xs text-text-muted">Risk score</p>
                                    <p className="text-xl font-bold text-text-primary mt-1">
                                      {Number(reversalRisk.risk_score ?? 0)}/24
                                    </p>
                                  </div>
                                  <div className={`p-4 rounded-lg border text-center ${levelBoxClass}`}>
                                    <p className="text-xs opacity-80">Risk level</p>
                                    <p className="text-xl font-bold mt-1">{rl}</p>
                                  </div>
                                  <div className="p-4 rounded-lg border border-border-default bg-white text-center">
                                    <p className="text-xs text-text-muted">Est. reversal</p>
                                    <p className="text-xl font-bold text-text-primary amount mt-1">
                                      {formatCurrency(Number(reversalRisk.estimated_reversal_amount ?? 0), currency, 0)}
                                    </p>
                                  </div>
                                </div>

                                <div>
                                  <p className="text-sm font-semibold text-text-primary mb-2">Risk factor breakdown</p>
                                  <div className="space-y-2">
                                    {IFRS15_REVERSAL_FACTOR_ROWS.map(({ key, label }) => {
                                      const sc = Number(fs[key] ?? 0);
                                      const rowBg =
                                        sc >= 3 ? 'bg-red-50/80 border-red-200' : sc === 0 ? 'bg-emerald-50/60 border-emerald-200' : 'bg-white border-border-default';
                                      const nameClass = sc >= 3 ? 'font-bold text-red-700' : 'font-medium text-text-primary';
                                      return (
                                        <div
                                          key={key}
                                          className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm ${rowBg}`}
                                        >
                                          <span className={nameClass}>{label}</span>
                                          <div className="flex items-center gap-2">
                                            <span className="flex gap-1" aria-label={`${sc} of 3`}>
                                              {[0, 1, 2].map((i) => {
                                                const filled = i < sc;
                                                const dotClass =
                                                  sc >= 3
                                                    ? filled
                                                      ? 'bg-red-500'
                                                      : 'bg-gray-200'
                                                    : sc >= 1
                                                      ? filled
                                                        ? 'bg-orange-500'
                                                        : 'bg-gray-200'
                                                      : 'bg-gray-200';
                                                return <span key={i} className={`inline-block w-2.5 h-2.5 rounded-full ${dotClass}`} />;
                                              })}
                                            </span>
                                            <span className="text-xs text-text-muted w-14 text-right">{sc}/3 pts</span>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>

                                {actions.length > 0 && (
                                  <div>
                                    <p className="text-sm font-semibold text-text-primary mb-2">Recommended actions</p>
                                    <ol className="list-none space-y-2">
                                      {actions.map((a, i) => (
                                        <li key={i} className="flex gap-2 text-sm text-text-primary">
                                          <ArrowRight className="w-4 h-4 shrink-0 text-orange-600 mt-0.5" />
                                          <span>
                                            {i + 1}. {a}
                                          </span>
                                        </li>
                                      ))}
                                    </ol>
                                  </div>
                                )}

                                {typeof reversalRisk.explanation === 'string' && reversalRisk.explanation && (
                                  <div className="p-4 bg-neutral-100 border border-border-default rounded-lg">
                                    <p
                                      className="text-sm text-text-primary leading-relaxed"
                                      style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
                                    >
                                      {reversalRisk.explanation}
                                    </p>
                                  </div>
                                )}

                                {rl === 'CRITICAL' && (
                                  <div className="rounded-lg border-2 border-red-600 bg-red-600 text-white p-4 text-sm space-y-1">
                                    <p className="font-bold">⚠ REVERSAL WATCH — CRITICAL RISK</p>
                                    <p>This contract has critical reversal risk.</p>
                                    <p>Consider excluding variable consideration entirely until uncertainty resolves.</p>
                                    <p className="text-red-100">See IFRS 15.57.</p>
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </div>

                        {Array.isArray(vcResult.active_factors) && (vcResult.active_factors as string[]).length > 0 && (
                          <div>
                            <p className="text-sm font-semibold text-text-primary">Factors applied:</p>
                            <ul className="list-disc pl-5 mt-1 text-sm text-text-primary space-y-0.5">
                              {(vcResult.active_factors as string[]).map((f, j) => (
                                <li key={j}>{f}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {typeof vcResult.explanation === 'string' && vcResult.explanation && (
                          <div className="p-4 bg-bg-light border border-border-default rounded-lg">
                            <p className="text-sm text-text-primary leading-relaxed" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>
                              {vcResult.explanation}
                            </p>
                          </div>
                        )}
                        {Boolean(vcResult.risk_flag) && (
                          <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg text-sm text-amber-900">
                            ⚠{' '}
                            {typeof vcResult.risk_message === 'string' && vcResult.risk_message
                              ? vcResult.risk_message
                              : `Constraint reduces variable consideration by ${Number(vcResult.reduction_pct ?? 0).toFixed(1)}%. Consider whether the variable element should be excluded entirely until uncertainty resolves.`}
                          </div>
                        )}
                        <Button
                          variant="primary"
                          size="md"
                          className="bg-gradient-orange"
                          onClick={addVcToTransactionPrice}
                          title={
                            String(vcResult.risk_level ?? '') === 'HIGH'
                              ? `High revenue risk — only ${formatCurrency(Number(vcResult.constrained_amount ?? 0), currency, 0)} of ${formatCurrency(Number(vcResult.expected_amount ?? 0), currency, 0)} expected value included`
                              : undefined
                          }
                        >
                          {String(vcResult.risk_level ?? '') === 'HIGH'
                            ? `Add ${formatCurrency(Number(vcResult.constrained_amount ?? 0), currency, 0)} to TP ⚠`
                            : `Add ${formatCurrency(Number(vcResult.constrained_amount ?? 0), currency, 0)} to TP ✓`}
                        </Button>
                      </div>
                    )}
                    {!vcResult && <p className="text-sm text-text-muted">No variable consideration assessed yet.</p>}
                  </div>
                )}
              </div>

              {/* RPO Disclosure (IFRS 15.120–122) */}
              <div className="bg-white rounded-card p-6 border border-border-default shadow-card">
                <div className="flex items-center justify-between border-b border-border-default pb-4 mb-6">
                  <div>
                    <h3 className="text-base font-bold text-text-primary">RPO Disclosure</h3>
                    <p className="text-xs text-text-muted mt-1">Remaining performance obligations timing</p>
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    className="bg-gradient-orange"
                    onClick={() => {
                      if (!showRpoSection) initRpoFormFromResults();
                      setShowRpoSection(!showRpoSection);
                    }}
                  >
                    {showRpoSection ? 'Collapse' : 'Calculate RPO'}
                  </Button>
                </div>
                {showRpoSection && (
                  <div className="space-y-6">
                    <div className="overflow-x-auto border border-border-default rounded-lg">
                      <table className="w-full text-sm min-w-[640px]">
                        <thead>
                          <tr className="bg-bg-light border-b border-border-default">
                            <th className="text-left py-2 px-3 font-semibold">Obligation Name</th>
                            <th className="text-right py-2 px-3 font-semibold">Allocated Amount</th>
                            <th className="text-right py-2 px-3 font-semibold">Recognised to Date ($)</th>
                            <th className="text-left py-2 px-3 font-semibold">Expected End Date</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rpoFormRows.map((row, idx) => (
                            <tr key={idx} className="border-b border-border-default">
                              <td className="py-2 px-3">
                                <input readOnly className="w-full bg-bg-light px-2 py-1 border border-border-default rounded" value={row.obligation_name} />
                              </td>
                              <td className="py-2 px-3 text-right">
                                <input readOnly className="w-full bg-bg-light px-2 py-1 border border-border-default rounded text-right amount" value={row.allocated_amount} />
                              </td>
                              <td className="py-2 px-3 text-right">
                                <input
                                  type="number"
                                  className="w-full px-2 py-1 border border-border-default rounded text-right"
                                  value={row.recognised_to_date}
                                  onChange={(e) =>
                                    setRpoFormRows((prev) => {
                                      const n = [...prev];
                                      n[idx] = { ...n[idx], recognised_to_date: e.target.value };
                                      return n;
                                    })
                                  }
                                />
                              </td>
                              <td className="py-2 px-3">
                                <input
                                  type="date"
                                  className="w-full px-2 py-1 border border-border-default rounded"
                                  value={row.expected_end_date}
                                  onChange={(e) =>
                                    setRpoFormRows((prev) => {
                                      const n = [...prev];
                                      n[idx] = { ...n[idx], expected_end_date: e.target.value };
                                      return n;
                                    })
                                  }
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <Button variant="primary" size="md" className="bg-gradient-orange" onClick={runRpoCalculation} isLoading={isRpoLoading}>
                      Run RPO analysis
                    </Button>
                    {rpoResult && (
                      <div className="space-y-4 border-t border-border-default pt-6">
                        <div className="rounded-xl p-6 text-center text-white bg-gradient-to-r from-orange-500 to-amber-500 shadow-md">
                          <p className="text-sm font-medium opacity-90">Total Remaining Performance Obligations</p>
                          <p className="text-3xl font-bold amount mt-2">
                            {formatCurrency(Number(rpoResult.total_rpo ?? 0), currency, 0)}
                          </p>
                          <p className="text-xs mt-2 opacity-90">As of {String(rpoResult.as_of_date || '')}</p>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          {[
                            { label: 'Within 1 Year', val: rpoResult.within_1_year },
                            { label: '1 to 2 Years', val: rpoResult.one_to_two_years },
                            { label: 'Beyond 2 Years', val: rpoResult.beyond_2_years },
                          ].map((b) => (
                            <div key={b.label} className="p-4 rounded-lg border border-border-default text-center bg-white">
                              <p className="text-xs text-text-muted">{b.label}</p>
                              <p className="text-lg font-bold text-text-primary amount mt-1">
                                {formatCurrency(Number(b.val ?? 0), currency, 0)}
                              </p>
                            </div>
                          ))}
                        </div>
                        <div className="overflow-x-auto border border-border-default rounded-lg">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-bg-light border-b border-border-default">
                                <th className="text-left py-2 px-3">Obligation</th>
                                <th className="text-right py-2 px-3">RPO Amount</th>
                                <th className="text-left py-2 px-3">% Complete</th>
                                <th className="text-left py-2 px-3">Bucket</th>
                                <th className="text-left py-2 px-3">Expected Date</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(Array.isArray(rpoResult.by_obligation) ? rpoResult.by_obligation : []).map((ob: any, i: number) => {
                                const pct = Number(ob.pct_complete ?? 0);
                                const barColor = pct > 75 ? 'bg-emerald-500' : pct >= 25 ? 'bg-orange-400' : 'bg-red-500';
                                const bucketLabel =
                                  ob.bucket === 'within_1_year'
                                    ? 'Within 1 Year'
                                    : ob.bucket === 'one_to_two_years'
                                      ? '1 to 2 Years'
                                      : ob.bucket === 'beyond_2_years'
                                        ? 'Beyond 2 Years'
                                        : String(ob.bucket || '');
                                return (
                                  <tr key={i} className="border-b border-border-default">
                                    <td className="py-2 px-3">{ob.obligation_name}</td>
                                    <td className="py-2 px-3 text-right amount">{formatCurrency(Number(ob.rpo_amount ?? 0), currency, 0)}</td>
                                    <td className="py-2 px-3 w-40">
                                      <div className="flex items-center gap-2">
                                        <div className="flex-1 h-2 bg-bg-light rounded-full overflow-hidden">
                                          <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
                                        </div>
                                        <span className="text-xs w-10 text-right">{pct.toFixed(0)}%</span>
                                      </div>
                                    </td>
                                    <td className="py-2 px-3 text-xs">{bucketLabel}</td>
                                    <td className="py-2 px-3">{ob.expected_completion_date}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        {rpoResult.practical_expedient_available ? (
                          <div className="p-4 rounded-lg border border-emerald-200 bg-emerald-50 text-sm text-emerald-900">
                            ✓ Practical expedient available. RPO disclosure may be omitted under IFRS 15.121.
                          </div>
                        ) : (
                          <div className="p-4 rounded-lg border border-blue-200 bg-blue-50 text-sm text-blue-900">
                            ℹ RPO disclosure is mandatory for this contract.
                          </div>
                        )}
                        <div className="relative p-4 bg-white border border-border-default rounded-lg shadow-sm">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-bold text-text-primary">IFRS 15.120 Disclosure (ready to use)</span>
                            <button
                              type="button"
                              className="text-text-muted hover:text-orange-primary p-1"
                              title="Copy"
                              onClick={() => {
                                const t = String(rpoResult.disclosure_text || '');
                                navigator.clipboard.writeText(t).then(() => toast.success('Copied')).catch(() => toast.error('Copy failed'));
                              }}
                            >
                              <Copy className="w-4 h-4" />
                            </button>
                          </div>
                          <p
                            className="text-sm text-text-primary leading-relaxed whitespace-pre-wrap"
                            style={{ fontFamily: 'Times New Roman, Times, serif' }}
                          >
                            {String(rpoResult.disclosure_text || '')}
                          </p>
                        </div>
                      </div>
                    )}
                    {!rpoResult && <p className="text-sm text-text-muted">RPO not yet calculated.</p>}
                  </div>
                )}
              </div>

              {/* Contract Costs — Commission Asset (IFRS 15.91–94) */}
              <div className="bg-white rounded-card p-6 border border-border-default shadow-card">
                <div className="flex items-center justify-between border-b border-border-default pb-4 mb-6">
                  <div>
                    <h3 className="text-base font-bold text-text-primary">Contract Costs (Commission Asset)</h3>
                    <p className="text-xs text-text-muted mt-1">Costs to obtain a contract (IFRS 15.91–94)</p>
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    className="bg-gradient-orange"
                    onClick={() => {
                      if (!showCcSection) {
                        const t = typeof contractTerm === 'number' ? contractTerm : parseInt(String(contractTerm), 10);
                        setCcTerm(String(Number.isFinite(t) ? t : lastContractInfo.contract_term_months || ''));
                        setCcTotalValue(String(displayTp || tp || ''));
                      }
                      setShowCcSection(!showCcSection);
                    }}
                  >
                    {showCcSection ? 'Collapse' : 'Add Commission'}
                  </Button>
                </div>
                {showCcSection && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="flex items-center gap-1 text-sm text-text-primary mb-1">
                          Commission Amount ($)
                          <span className="relative group inline-flex">
                            <HelpCircle className="w-4 h-4 text-text-muted cursor-help" />
                            <span className="pointer-events-none absolute left-0 bottom-full mb-1 hidden group-hover:block z-10 w-56 p-2 text-xs bg-text-primary text-white rounded shadow-lg">
                              Incremental costs directly attributable to obtaining this contract (e.g. sales commissions). Internal overhead not included.
                            </span>
                          </span>
                        </label>
                        <input
                          type="number"
                          className="w-full px-3 py-2 border border-border-default rounded-lg"
                          value={ccCommission}
                          onChange={(e) => setCcCommission(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="flex items-center gap-1 text-sm text-text-primary mb-1">
                          Contract Term (months)
                          <span className="relative group inline-flex">
                            <HelpCircle className="w-4 h-4 text-text-muted cursor-help" />
                            <span className="pointer-events-none absolute left-0 bottom-full mb-1 hidden group-hover:block z-10 w-56 p-2 text-xs bg-text-primary text-white rounded shadow-lg">
                              If ≤ 12 months, practical expedient applies and commission can be expensed immediately.
                            </span>
                          </span>
                        </label>
                        <input
                          type="number"
                          min={0}
                          className="w-full px-3 py-2 border border-border-default rounded-lg"
                          value={ccTerm}
                          onChange={(e) => setCcTerm(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="text-sm text-text-primary mb-1 block">Total Contract Value ($)</label>
                        <input
                          type="number"
                          className="w-full px-3 py-2 border border-border-default rounded-lg"
                          value={ccTotalValue}
                          onChange={(e) => setCcTotalValue(e.target.value)}
                        />
                      </div>
                    </div>
                    <Button variant="primary" size="md" className="bg-gradient-orange" onClick={runContractCostsCalculation} isLoading={isCcLoading}>
                      Calculate Commission Asset
                    </Button>
                    {ccResult && (
                      <div className="space-y-4 border-t border-border-default pt-6">
                        {ccResult.use_practical_expedient ? (
                          <>
                            <div className="p-4 rounded-lg border border-emerald-200 bg-emerald-50 text-sm text-emerald-900">
                              ✓ Practical expedient applies (contract ≤ 12 months). Commission of{' '}
                              {formatCurrency(Number(ccResult.commission_amount ?? 0), currency, 0)} may be expensed immediately. No asset recognised.
                            </div>
                            <div className="space-y-2">
                              {(Array.isArray(ccResult.journal_entries) ? ccResult.journal_entries : []).map((entry: any, i: number) => (
                                <div key={i} className="p-3 rounded-lg border-l-4 border-blue-500 bg-blue-50">
                                  <div className="flex justify-between text-sm">
                                    <span className="font-medium text-blue-800">Dr {entry.dr_account}</span>
                                    <span className="font-bold amount text-blue-800">{formatCurrency(Number(entry.dr ?? 0), currency, 0)}</span>
                                  </div>
                                  <div className="flex justify-between text-sm mt-1">
                                    <span className="font-medium text-green-800">Cr {entry.cr_account}</span>
                                    <span className="font-bold amount text-green-800">{formatCurrency(Number(entry.cr ?? 0), currency, 0)}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                              <div className="p-4 rounded-lg border border-border-default text-center">
                                <p className="text-xs text-text-muted">Asset Recognised</p>
                                <p className="text-lg font-bold amount mt-1">
                                  {formatCurrency(Number(ccResult.total_asset_recognised ?? 0), currency, 0)}
                                </p>
                              </div>
                              <div className="p-4 rounded-lg border border-border-default text-center">
                                <p className="text-xs text-text-muted">Monthly Amortisation</p>
                                <p className="text-lg font-bold amount mt-1">
                                  {formatCurrency(Number(ccResult.monthly_amortisation ?? 0), currency, 0)}
                                </p>
                              </div>
                              <div className="p-4 rounded-lg border border-border-default text-center">
                                <p className="text-xs text-text-muted">Contract Term</p>
                                <p className="text-lg font-bold text-text-primary mt-1">{String(ccResult.contract_term_months ?? '')} months</p>
                              </div>
                            </div>
                            <div className="overflow-x-auto border border-border-default rounded-lg">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="bg-bg-light border-b border-border-default">
                                    <th className="text-left py-2 px-3">Month</th>
                                    <th className="text-right py-2 px-3">Opening Balance</th>
                                    <th className="text-right py-2 px-3">Amortisation</th>
                                    <th className="text-right py-2 px-3">Closing Balance</th>
                                    <th className="text-right py-2 px-3">Cumulative Amortised</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(Array.isArray(ccResult.amortisation_schedule) ? ccResult.amortisation_schedule : [])
                                    .slice(0, ccScheduleExpand ? undefined : 6)
                                    .map((row: any) => {
                                      const totalM = Number(ccResult.contract_term_months ?? 0);
                                      const isFinalMonth = Number(row.month) === totalM;
                                      return (
                                        <tr key={row.month} className={`border-b border-border-default ${isFinalMonth ? 'font-bold bg-bg-light' : ''}`}>
                                          <td className="py-2 px-3">{row.month}</td>
                                          <td className="py-2 px-3 text-right amount">{formatCurrency(Number(row.opening_balance ?? 0), currency, 0)}</td>
                                          <td className="py-2 px-3 text-right amount">{formatCurrency(Number(row.amortisation ?? 0), currency, 0)}</td>
                                          <td className="py-2 px-3 text-right amount">{formatCurrency(Number(row.closing_balance ?? 0), currency, 0)}</td>
                                          <td className="py-2 px-3 text-right amount">{formatCurrency(Number(row.cumulative_amortised ?? 0), currency, 0)}</td>
                                        </tr>
                                      );
                                    })}
                                </tbody>
                              </table>
                            </div>
                            {(Array.isArray(ccResult.amortisation_schedule) ? ccResult.amortisation_schedule.length : 0) > 6 && (
                              <button
                                type="button"
                                className="text-sm font-semibold text-orange-primary hover:underline"
                                onClick={() => setCcScheduleExpand(!ccScheduleExpand)}
                              >
                                {ccScheduleExpand ? 'Show less' : 'View All'}
                              </button>
                            )}
                            <div>
                              <h4 className="text-sm font-semibold text-text-primary mb-2">Journal Entries</h4>
                              <div className="space-y-3">
                                {(Array.isArray(ccResult.journal_entries) ? ccResult.journal_entries : []).map((entry: any, i: number) => (
                                  <div key={i} className="p-3 rounded-lg border border-border-default bg-bg-light">
                                    <p className="text-xs text-text-muted mb-2">{entry.description}</p>
                                    <div className="flex justify-between text-sm">
                                      <span className="font-medium text-blue-800">Dr {entry.dr_account}</span>
                                      <span className="font-bold amount text-blue-800">{formatCurrency(Number(entry.dr ?? 0), currency, 0)}</span>
                                    </div>
                                    <div className="flex justify-between text-sm mt-1">
                                      <span className="font-medium text-green-800">Cr {entry.cr_account}</span>
                                      <span className="font-bold amount text-green-800">{formatCurrency(Number(entry.cr ?? 0), currency, 0)}</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </>
                        )}
                        {Boolean(ccResult.impairment_flag) && (
                          <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg text-sm text-amber-900">
                            ⚠ {String(ccResult.impairment_note || '')}
                          </div>
                        )}
                        {typeof ccResult.explanation === 'string' && ccResult.explanation && (
                          <p className="text-sm text-text-secondary leading-relaxed">{ccResult.explanation}</p>
                        )}
                      </div>
                    )}
                    {!ccResult && <p className="text-sm text-text-muted">No contract costs assessed yet.</p>}
                  </div>
                )}
              </div>

              {/* Principal vs Agent (IFRS 15.B34–B38) */}
              <div className="bg-white rounded-card p-6 border border-border-default shadow-card">
                <div className="flex items-center justify-between border-b border-border-default pb-4 mb-6">
                  <div>
                    <h3 className="text-base font-bold text-text-primary">Principal vs Agent Assessment</h3>
                    <p className="text-xs text-text-muted mt-1">Gross vs net revenue presentation</p>
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    className="bg-gradient-orange"
                    onClick={() => setShowPaSection(!showPaSection)}
                  >
                    {showPaSection ? 'Collapse' : 'Assess Principal/Agent'}
                  </Button>
                </div>
                {showPaSection && (
                  <div className="space-y-4">
                    <div className="p-4 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-900">
                      This determines whether revenue is recognised <strong>GROSS</strong> (full transaction price) or <strong>NET</strong> (fee
                      only). The difference can be material to reported revenue.
                    </div>
                    {[
                      {
                        q: 'Does your entity obtain the good or service before transferring it to the customer?',
                        v: paObtains,
                        set: setPaObtains,
                      },
                      {
                        q: 'Does your entity have discretion in setting the price charged to the customer?',
                        v: paSetsPrice,
                        set: setPaSetsPrice,
                      },
                      {
                        q: 'Is your entity primarily responsible for fulfilling the promise to the customer?',
                        v: paPrimary,
                        set: setPaPrimary,
                      },
                    ].map((row, idx) => (
                      <div key={idx} className="p-3 border border-border-default rounded-lg">
                        <p className="text-sm text-text-primary mb-2">{row.q}</p>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className={`px-4 py-1.5 rounded-lg text-sm font-semibold border ${
                              row.v ? 'bg-orange-primary text-white border-orange-primary' : 'bg-bg-light border-border-default'
                            }`}
                            onClick={() => row.set(true)}
                          >
                            YES
                          </button>
                          <button
                            type="button"
                            className={`px-4 py-1.5 rounded-lg text-sm font-semibold border ${
                              !row.v ? 'bg-gray-200 text-text-primary border-gray-300' : 'bg-bg-light border-border-default'
                            }`}
                            onClick={() => row.set(false)}
                          >
                            NO
                          </button>
                        </div>
                      </div>
                    ))}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm text-text-primary mb-1 block">Total Transaction Price ($)</label>
                        <input
                          type="number"
                          className="w-full px-3 py-2 border border-border-default rounded-lg"
                          value={paTp}
                          onChange={(e) => setPaTp(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="text-sm text-text-primary mb-1 block">Cost Paid to Supplier ($)</label>
                        <input
                          type="number"
                          className="w-full px-3 py-2 border border-border-default rounded-lg"
                          value={paCost}
                          onChange={(e) => setPaCost(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="text-sm text-text-secondary">
                      <span className="font-semibold text-text-primary">Principal indicators met: {paScore} / 3</span>
                      <div className="flex gap-1 mt-1">
                        {[0, 1, 2].map((i) => {
                          const met = (paObtains && i === 0) || (paSetsPrice && i === 1) || (paPrimary && i === 2);
                          return <span key={i} className={met ? 'text-orange-primary text-lg' : 'text-gray-300 text-lg'}>●</span>;
                        })}
                      </div>
                    </div>
                    <Button variant="primary" className="bg-gradient-orange" size="md" onClick={runPrincipalAgentAssessment} isLoading={isPaLoading}>
                      Assess
                    </Button>
                    {paResult && (
                      <div className="space-y-4 border-t border-border-default pt-4">
                        {String(paResult.conclusion) === 'PRINCIPAL' ? (
                          <div className="rounded-xl p-5 bg-gradient-to-r from-emerald-600 to-green-600 text-white text-center">
                            <p className="font-bold text-lg">✓ PRINCIPAL — Recognise GROSS</p>
                            <p className="text-sm mt-1 opacity-95">Revenue: {formatCurrency(Number(paResult.gross_revenue), currency, 0)}</p>
                            <p className="text-sm">Cost of Sales: {formatCurrency(Number(paResult.cost_paid_to_supplier), currency, 0)}</p>
                          </div>
                        ) : (
                          <div className="rounded-xl p-5 bg-gradient-to-r from-sky-600 to-blue-700 text-white text-center">
                            <p className="font-bold text-lg">ℹ AGENT — Recognise NET</p>
                            <p className="text-sm mt-1">Net Revenue (Fee): {formatCurrency(Number(paResult.net_revenue), currency, 0)}</p>
                            <p className="text-sm">Commission Rate: {Number(paResult.commission_rate_pct).toFixed(1)}%</p>
                          </div>
                        )}
                        {Boolean(paResult.borderline) && (
                          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-sm">
                            ⚠ {String(paResult.borderline_note || 'Borderline assessment. Document your rationale for audit.')}
                          </div>
                        )}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {[
                            {
                              title: 'IF PRINCIPAL',
                              active: String(paResult.conclusion) === 'PRINCIPAL',
                              rev: Number(paResult.gross_revenue),
                              cogs: Number(paResult.cost_paid_to_supplier),
                              margin: Number((paResult as { gross_margin_pct?: number }).gross_margin_pct ?? 0),
                            },
                            {
                              title: 'IF AGENT',
                              active: String(paResult.conclusion) === 'AGENT',
                              rev: Number(paResult.net_revenue),
                              cogs: 0,
                              margin: 100,
                            },
                          ].map((c) => (
                            <div
                              key={c.title}
                              className={`p-4 rounded-lg border-2 ${
                                c.active ? 'border-orange-primary bg-orange-50/40' : 'border-border-default'
                              }`}
                            >
                              <p className="text-xs font-bold text-text-muted mb-2">{c.title}</p>
                              <p className="text-sm">Revenue: {formatCurrency(c.rev, currency, 0)}</p>
                              <p className="text-sm">COGS: {formatCurrency(c.cogs, currency, 0)}</p>
                              <p className="text-sm">Margin: {c.margin.toFixed(0)}%</p>
                            </div>
                          ))}
                        </div>
                        {(() => {
                          const g = Number(paResult.gross_revenue || 0);
                          const diff = g > 0 ? (Number(paResult.revenue_difference) / g) * 100 : 0;
                          return (
                            <p className={`text-sm font-medium ${Math.abs(diff) > 20 ? 'text-red-600' : 'text-text-secondary'}`}>
                              Revenue impact of gross vs net: {formatCurrency(Number(paResult.revenue_difference), currency, 0)}
                              {g > 0 ? ` (${Math.abs(diff).toFixed(1)}% of gross)` : ''}
                            </p>
                          );
                        })()}
                        <div className="space-y-2">
                          {(Array.isArray(paResult.journal_entries) ? paResult.journal_entries : []).map((e: any, j: number) => (
                            <div key={j} className="p-3 rounded-lg border border-border-default bg-bg-light">
                              {e.description && <p className="text-xs text-text-muted mb-2">{e.description}</p>}
                              {e.compound && e.lines ? (
                                <div className="space-y-1 text-sm">
                                  {e.lines.map((ln: any, k: number) => (
                                    <div
                                      key={k}
                                      className={`flex justify-between ${ln.side === 'Dr' ? 'text-blue-800 font-medium' : 'text-green-800 font-medium'}`}
                                    >
                                      <span>
                                        {ln.side} {ln.account}
                                      </span>
                                      <span className="amount">{formatCurrency(ln.amount, currency, 0)}</span>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <>
                                  <div className="flex justify-between text-sm">
                                    <span className="font-medium text-blue-800">Dr {e.dr_account}</span>
                                    <span className="font-bold text-blue-800 amount">{formatCurrency(Number(e.dr ?? 0), currency, 0)}</span>
                                  </div>
                                  <div className="flex justify-between text-sm mt-1">
                                    <span className="font-medium text-green-800">Cr {e.cr_account}</span>
                                    <span className="font-bold text-green-800 amount">{formatCurrency(Number(e.cr ?? 0), currency, 0)}</span>
                                  </div>
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                        {typeof paResult.explanation === 'string' && (
                          <p className="p-4 bg-bg-light border border-border-default rounded-lg text-sm text-text-primary leading-relaxed" style={{ fontFamily: 'Georgia, serif' }}>
                            {paResult.explanation}
                          </p>
                        )}
                      </div>
                    )}
                    {!paResult && <p className="text-sm text-text-muted">Assessment not yet run.</p>}
                  </div>
                )}
              </div>

              {/* Licence of IP (IFRS 15.B52–B63) */}
              <div className="bg-white rounded-card p-6 border border-border-default shadow-card">
                <div className="flex items-center justify-between border-b border-border-default pb-4 mb-6">
                  <div>
                    <h3 className="text-base font-bold text-text-primary">Licence of IP Classification</h3>
                    <p className="text-xs text-text-muted mt-1">Right to access (over time) vs right to use (point in time)</p>
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    className="bg-gradient-orange"
                    onClick={() => {
                      if (!showLicSection && !licStart) {
                        setLicStart(new Date().toISOString().slice(0, 10));
                        setLicTerm(
                          String(typeof contractTerm === 'number' ? contractTerm : parseInt(String(contractTerm), 10) || 12),
                        );
                        setLicPrice(String(displayTp || tp || ''));
                      }
                      setShowLicSection(!showLicSection);
                    }}
                  >
                    {showLicSection ? 'Collapse' : 'Classify Licence'}
                  </Button>
                </div>
                {showLicSection && (
                  <div className="space-y-4">
                    <div className="p-4 rounded-lg bg-amber-50/80 border border-amber-200 text-sm text-amber-950">
                      Determines if the licence is <strong>Right to Access</strong> (revenue over time) or <strong>Right to Use</strong> (revenue
                      at a point in time). Critical for SaaS, software, media, and IP-heavy businesses.
                    </div>
                    {[
                      {
                        label: 'Q1: Do your ongoing activities significantly affect the IP the customer is using?',
                        tip: 'e.g. continuous updates, live feeds, evolving datasets that the customer accesses',
                        v: licA,
                        set: setLicA,
                      },
                      {
                        label: 'Q2: Is the customer exposed to the effects of your activities as they occur?',
                        tip: 'Customer accesses updated/live version automatically — not a static snapshot',
                        v: licB,
                        set: setLicB,
                      },
                      {
                        label: 'Q3: Are those activities NOT a separate deliverable to the customer?',
                        tip: 'Updates are part of the licence, not billed separately or a distinct PO',
                        v: licC,
                        set: setLicC,
                      },
                    ].map((row, i) => (
                      <div key={i} className="p-3 border border-border-default rounded-lg">
                        <div className="flex items-start gap-1 mb-2">
                          <p className="text-sm text-text-primary flex-1">{row.label}</p>
                          <span className="relative group">
                            <HelpCircle className="w-4 h-4 text-text-muted shrink-0 cursor-help mt-0.5" />
                            <span className="pointer-events-none hidden group-hover:block absolute z-10 right-0 top-6 w-64 p-2 text-xs bg-text-primary text-white rounded shadow-lg">
                              {row.tip}
                            </span>
                          </span>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className={`px-4 py-1.5 rounded-lg text-sm font-semibold border ${
                              row.v === true ? 'bg-orange-primary text-white border-orange-primary' : 'bg-bg-light border-border-default'
                            }`}
                            onClick={() => row.set(true)}
                          >
                            YES
                          </button>
                          <button
                            type="button"
                            className={`px-4 py-1.5 rounded-lg text-sm font-semibold border ${
                              row.v === false ? 'bg-gray-200 text-text-primary border-gray-300' : 'bg-bg-light border-border-default'
                            }`}
                            onClick={() => row.set(false)}
                          >
                            NO
                          </button>
                        </div>
                      </div>
                    ))}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="text-sm text-text-primary mb-1 block">Transaction Price ($)</label>
                        <input
                          type="number"
                          className="w-full px-3 py-2 border border-border-default rounded-lg"
                          value={licPrice}
                          onChange={(e) => setLicPrice(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="text-sm text-text-primary mb-1 block">Licence Term (months)</label>
                        <input
                          type="number"
                          min={1}
                          className="w-full px-3 py-2 border border-border-default rounded-lg"
                          value={licTerm}
                          onChange={(e) => setLicTerm(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="text-sm text-text-primary mb-1 block">Licence Start Date</label>
                        <input
                          type="date"
                          className="w-full px-3 py-2 border border-border-default rounded-lg"
                          value={licStart}
                          onChange={(e) => setLicStart(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm">Includes usage-based royalties?</span>
                      <button
                        type="button"
                        className={`px-3 py-1 rounded-lg text-sm font-semibold border ${
                          licRoyalty ? 'bg-orange-primary text-white border-orange-primary' : 'bg-bg-light'
                        }`}
                        onClick={() => setLicRoyalty(!licRoyalty)}
                      >
                        {licRoyalty ? 'YES' : 'NO'}
                      </button>
                    </div>
                    <p className="text-sm text-text-secondary">
                      <span className="font-semibold text-text-primary">Current classification:</span> {licPreviewLabel}
                    </p>
                    <Button variant="primary" className="bg-gradient-orange" size="md" onClick={runLicenseClassification} isLoading={isLicLoading}>
                      Classify
                    </Button>
                    {licResult && (
                      <div className="space-y-4 border-t border-border-default pt-4">
                        {String(licResult.pattern) === 'OVER_TIME' ? (
                          <div className="rounded-xl p-5 bg-gradient-to-r from-orange-500 to-amber-500 text-white text-center">
                            <p className="font-bold">RIGHT TO ACCESS</p>
                            <p className="text-sm mt-1">Revenue recognised OVER TIME</p>
                            <p className="text-lg font-bold amount mt-2">
                              {formatCurrency(Number(licResult.revenue_per_period), currency, 0)} per month over {String(licResult.licence_term_months)} months
                            </p>
                          </div>
                        ) : (
                          <div className="rounded-xl p-5 bg-gradient-to-r from-emerald-600 to-green-600 text-white text-center">
                            <p className="font-bold">RIGHT TO USE</p>
                            <p className="text-sm mt-1">Revenue recognised at POINT IN TIME</p>
                            <p className="text-sm mt-2">
                              Full {formatCurrency(Number(licResult.transaction_price), currency, 0)} on {String(licResult.recognition_date || '')}
                            </p>
                          </div>
                        )}
                        <div className="space-y-1 text-sm">
                          {(
                            [
                              ['significantly_affects_ip', 'Entity activities significantly affect IP'],
                              ['customer_exposed_as_occurs', 'Customer exposed as activities occur'],
                              ['activities_not_separate_good', 'Activities not a separate deliverable'],
                            ] as const
                          ).map(([k, label]) => {
                            const met = (licResult.conditions_met as Record<string, boolean> | undefined)?.[k];
                            return (
                              <div key={k} className="flex items-center gap-2">
                                <span>{met ? '✅' : '❌'}</span>
                                <span>{label}</span>
                              </div>
                            );
                          })}
                        </div>
                        {Boolean(licResult.royalty_exception) && (
                          <div className="p-3 bg-sky-50 border border-sky-200 text-sky-900 text-sm rounded-lg">
                            ℹ Sales/usage royalties exception (IFRS 15.B63). {String(licResult.royalty_note || '')}
                          </div>
                        )}
                        <div className="overflow-x-auto border border-border-default rounded-lg">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-bg-light">
                                <th className="text-left py-2 px-2">Period</th>
                                <th className="text-right py-2 px-2">Revenue</th>
                                <th className="text-right py-2 px-2">Cumulative</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(Array.isArray(licResult.recognition_schedule) ? licResult.recognition_schedule : [])
                                .slice(0, String(licResult.pattern) === 'OVER_TIME' ? 6 : 1)
                                .map((row: any) => (
                                  <tr key={row.month} className="border-t border-border-default">
                                    <td className="py-2 px-2">{row.period || `Month ${row.month}`}</td>
                                    <td className="py-2 px-2 text-right amount">{formatCurrency(Number(row.revenue), currency, 0)}</td>
                                    <td className="py-2 px-2 text-right amount">{formatCurrency(Number(row.cumulative), currency, 0)}</td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="space-y-2">
                          {(Array.isArray(licResult.journal_entries) ? licResult.journal_entries : []).map((e: any, j: number) => (
                            <div key={j} className="p-3 rounded-lg border border-border-default bg-bg-light">
                              {e.description && <p className="text-xs text-text-muted mb-2">{e.description}</p>}
                              <div className="flex justify-between text-sm">
                                <span className="text-blue-800 font-medium">Dr {e.dr_account}</span>
                                <span className="text-blue-800 font-bold amount">{formatCurrency(Number(e.dr ?? 0), currency, 0)}</span>
                              </div>
                              <div className="flex justify-between text-sm mt-1">
                                <span className="text-green-800 font-medium">Cr {e.cr_account}</span>
                                <span className="text-green-800 font-bold amount">{formatCurrency(Number(e.cr ?? 0), currency, 0)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                        {typeof licResult.explanation === 'string' && (
                          <p
                            className="p-4 bg-bg-light border border-border-default rounded-lg text-sm leading-relaxed"
                            style={{ fontFamily: 'Georgia, serif' }}
                          >
                            {licResult.explanation}
                          </p>
                        )}
                      </div>
                    )}
                    {!licResult && <p className="text-sm text-text-muted">Licence not yet classified.</p>}
                  </div>
                )}
              </div>

              {/* Download row - same as IFRS 16 */}
          <div className="flex gap-4">
                <Button variant="primary" size="lg" className="flex-1 bg-gradient-orange hover:opacity-90" onClick={handleGenerateExcelReport} isLoading={isGeneratingExcel}>
                  <Download className="w-5 h-5" /> Download Excel Report
                </Button>
                <Button variant="primary" size="lg" className="flex-1 bg-[#0b1f3b] hover:opacity-90 text-white" onClick={openClientReportModal}>
                  <FileText className="w-5 h-5" /> Generate Client Report
                </Button>
                <Button variant="secondary" size="lg" className="flex-1 bg-white border-2 border-border-default hover:bg-bg-light" onClick={handleDownloadPDF}>
                  <Download className="w-5 h-5" /> Download PDF Disclosure
            </Button>
          </div>
            </>
          )}
        </div>

        {/* Right column - same structure as IFRS 16 */}
        <div className="space-y-6">
          {/* Performance Obligations Breakdown */}
          {results && (
          <div className="bg-white rounded-card p-6 border border-border-default shadow-card">
            <div className="border-b border-border-default pb-4 mb-6">
                <h3 className="text-base font-bold text-text-primary">Performance Obligations Breakdown</h3>
                <p className="text-xs text-text-muted mt-1">Recognition progress by obligation</p>
            </div>
            <div className="space-y-4">
                {perfObs.map((ob: any, idx: number) => {
                  const name = ob.obligation || ob.description || ob.obligation_id || `PO-${idx + 1}`;
                  const allocated = Number(ob.allocated_amount ?? 0);
                  const recognized = Number(ob.recognised_to_date ?? ob.revenue_recognized ?? 0);
                  const pct = Number(ob.pct_complete ?? (allocated > 0 ? (recognized / allocated) * 100 : 0));
                  const pctClamped = Math.max(0, Math.min(100, pct));
                  const barClass = ifrs15PoProgressBarClass(pctClamped);
                  return (
                    <div key={name}>
                      <div className="flex justify-between mb-1">
                        <span className="text-sm text-text-secondary">{name}</span>
                        <span className="text-sm font-semibold text-text-primary">{pctClamped.toFixed(1)}% recognised</span>
                      </div>
                <div className="h-2 bg-bg-light rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${barClass}`} style={{ width: `${pctClamped}%` }}></div>
                      </div>
                </div>
                  );
                })}
                {perfObs.length === 0 && <p className="text-sm text-text-muted">No obligations found — run calculation first</p>}
              </div>
            </div>
          )}

          {/* Journal Entries - At inception + On recognition, same Dr/Cr styling as IFRS 16 */}
          {results && (
          <div className="bg-white rounded-card p-6 border border-border-default shadow-card">
            <div className="border-b border-border-default pb-4 mb-6">
              <h3 className="text-base font-bold text-text-primary">Journal Entries</h3>
              <p className="text-xs text-text-muted mt-1">Revenue recognition entries</p>
            </div>
              <div className="space-y-4">
                <p className="text-xs font-semibold text-text-muted uppercase pt-2">On recognition</p>
                <div className="space-y-3">
                  {journalEntries.map((e: any, i: number) => (
                    <div key={i} className={`p-3 rounded-lg border-l-4 ${e.dr > 0 ? 'bg-blue-50 border-blue-500' : 'bg-green-50 border-green-500'}`}>
                      {e.section ? <p className="text-xs text-text-muted mb-2 font-medium">{e.section}</p> : null}
                      <div className="flex justify-between items-center">
                        <span className={`text-sm font-medium ${e.dr > 0 ? 'text-blue-700' : 'text-green-700'}`}>{e.dr > 0 ? 'Dr.' : 'Cr.'} {e.account}</span>
                        <span className={`text-sm font-bold ${e.dr > 0 ? 'text-blue-700' : 'text-green-700'} amount`}>{formatCurrency(e.dr || e.cr || 0, currency, 0)}</span>
                      </div>
                    </div>
                  ))}
                  {journalEntries.length === 0 && <p className="text-sm text-text-muted">No journal entries — run calculation first</p>}
                </div>
              </div>
            </div>
          )}

          {/* AI Insight - dynamic based on results */}
          <div className="bg-gradient-to-br from-orange-light to-orange-light/50 rounded-card p-6 border border-orange-border shadow-card">
            <h3 className="text-base font-bold text-text-primary mb-2">AI Insight</h3>
            <p className="text-sm text-text-secondary">
              {results
                ? def > 0
                  ? `Contract ${contractId} has ${formatCurrency(def, currency, 0)} deferred over the contract term. Recognition completes ${completionDate}.`
                  : `Contract ${contractId} has recognised ${formatCurrency(rec, currency, 0)}. ${numPOBs} performance obligation${numPOBs !== 1 ? 's' : ''} applied under the 5-step model.`
                : 'Revenue contracts are analysed using the 5-step IFRS 15 model. Performance obligations are identified and transaction price is allocated using the standalone selling price method.'}
            </p>
          </div>

          {/* Disclosure Notes - 6 collapsible cards */}
          <div className="bg-white rounded-card p-6 border border-border-default shadow-card">
            <div className="border-b border-border-default pb-4 mb-6 flex items-center justify-between">
              <div>
              <h3 className="text-base font-bold text-text-primary">Disclosure Notes</h3>
              <p className="text-xs text-text-muted mt-1">Required IFRS 15 disclosures</p>
              </div>
              <Button variant="secondary" size="sm" onClick={handleDownloadPDF} className="bg-white border border-border-default hover:bg-bg-light">
                <Download className="w-4 h-4 mr-2" /> Download PDF Disclosure
              </Button>
            </div>
            {results ? (
              <div className="space-y-3">
                {disclosureCards.map((card) => {
                  const isOpen = openDisclosureCard === card.id;
                  return (
                    <div key={card.id} className="border border-border-default rounded-lg">
                      <button
                        type="button"
                        onClick={() => setOpenDisclosureCard(isOpen ? null : card.id)}
                        className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-bg-light"
                      >
                        <span className="text-sm font-semibold text-text-primary">{card.title}</span>
                        <span className="text-xs text-text-muted">{isOpen ? 'Hide' : 'Show'}</span>
                      </button>
                      {isOpen && (
                        <div className="px-4 pb-4">
                          <p className="text-sm text-text-primary leading-relaxed" style={{ fontFamily: 'Georgia, serif' }}>{card.content}</p>
                          <Button
                            variant="secondary"
                            size="sm"
                            className="mt-3 bg-white border border-border-default hover:bg-bg-light"
                            onClick={() => navigator.clipboard.writeText(card.content).then(() => toast.success('Disclosure copied!')).catch(() => toast.error('Copy failed'))}
                          >
                            <Copy className="w-4 h-4 mr-2" /> Copy
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-text-muted">Calculate a contract to generate disclosure notes.</p>
            )}

            <div className="border-t border-border-default mt-6 pt-6">
              <button
                type="button"
                onClick={() => setDisclosureScoreOpen((o) => !o)}
                className="w-full flex items-center justify-between text-left py-2 px-1 rounded-lg hover:bg-bg-light"
              >
                <span className="text-sm font-bold text-text-primary">Score My Disclosure</span>
                {disclosureScoreOpen ? <ChevronUp className="w-5 h-5 text-text-muted" /> : <ChevronDown className="w-5 h-5 text-text-muted" />}
              </button>
              {disclosureScoreOpen && (
                <div className="mt-4 space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-text-primary mb-2">Paste your IFRS 15 disclosure here</label>
                    <textarea
                      className="w-full rounded-lg border border-border-default p-3 text-sm text-text-primary focus:ring-2 focus:ring-orange-primary focus:border-orange-primary min-h-[280px]"
                      rows={12}
                      value={disclosureText}
                      onChange={(e) => setDisclosureText(e.target.value)}
                      placeholder={`Paste the complete IFRS 15 note from your draft financial statements.

Example:
Note X — Revenue from Contracts with Customers
The Group recognises revenue in accordance with IFRS 15. Revenue is measured at the transaction price agreed under the contract...

The more complete your disclosure text, the more accurate the quality score.`}
                    />
                    <p className={`text-xs mt-1 ${disclosureText.length < 200 ? 'text-red-600 font-medium' : 'text-text-muted'}`}>
                      {disclosureText.length} characters — minimum 200 recommended
                    </p>
                    {hasPopulatedDisclosureNotes && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="mt-2 bg-white border border-border-default"
                        onClick={handleAutoFillDisclosureNotes}
                      >
                        Auto-fill from generated notes ↑
                      </Button>
                    )}
                  </div>
                  <Button
                    type="button"
                    className="w-full bg-[#0f172a] hover:bg-[#1e293b] text-white font-semibold py-3 rounded-lg disabled:opacity-50"
                    disabled={disclosureText.trim().length < 50 || disclosureLoading}
                    onClick={handleScoreDisclosureSubmit}
                  >
                    {disclosureLoading ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Scoring... Claude is reviewing your disclosure
                      </span>
                    ) : (
                      'Score Disclosure'
                    )}
                  </Button>

                  {disclosureScore && (
                    <div className="space-y-8 pt-2">
                      <div className="text-center">
                        <div className="flex items-end justify-center gap-1">
                          <span className="text-5xl font-bold text-[#0f172a]">{String(disclosureScore.total_score ?? '')}</span>
                          <span className="text-xl text-text-muted pb-2">
                            / {String((disclosureScore as { score_max?: number }).score_max ?? 98)}
                          </span>
                        </div>
                        <p
                          className={`text-lg font-semibold mt-1 ${
                            Number(disclosureScore.quality_pct) >= 80
                              ? 'text-green-700'
                              : Number(disclosureScore.quality_pct) >= 60
                                ? 'text-blue-700'
                                : Number(disclosureScore.quality_pct) >= 40
                                  ? 'text-amber-700'
                                  : 'text-red-600'
                          }`}
                        >
                          {String(disclosureScore.quality_pct ?? '')}%
                        </p>
                        <span
                          className={`inline-block mt-3 px-5 py-2 rounded-full text-sm font-bold border ${qualityLevelBadgeClass(String(disclosureScore.quality_level || ''))}`}
                        >
                          {String(disclosureScore.quality_level || '')}
                        </span>
                        {Number(disclosureScore.penalty) > 0 && (
                          <p className="text-xs text-text-muted mt-2">
                            Raw score {String(disclosureScore.raw_score ?? '')} — {String(disclosureScore.penalty ?? '')} pt penalty for boilerplate language
                          </p>
                        )}
                      </div>

                      <div>
                        <p className="text-xs font-semibold text-text-muted uppercase mb-3">Criteria scores</p>
                        <div className="space-y-3">
                          {disclosureScorerCriteria.map(({ key, label }) => {
                            const block = (disclosureScore.criteria_scores as Record<string, { score?: number; issues?: string[] }> | undefined)?.[key];
                            const sc = Math.min(7, Math.max(0, Number(block?.score ?? 0)));
                            const pct = (sc / 7) * 100;
                            const expanded = expandedDisclosureCriterion === key;
                            return (
                              <div key={key} className="border border-border-default rounded-lg overflow-hidden">
                                <button
                                  type="button"
                                  className="w-full px-3 py-2 flex items-center gap-3 text-left hover:bg-bg-light"
                                  onClick={() => setExpandedDisclosureCriterion(expanded ? null : key)}
                                >
                                  <span className="text-sm text-text-primary flex-1 min-w-0">{label}</span>
                                  <div className="flex-1 h-2 bg-bg-light rounded-full overflow-hidden max-w-[140px]">
                                    <div className={`h-full ${barColorForDisclosureScore(sc)}`} style={{ width: `${pct}%` }} />
                                  </div>
                                  <span className="text-xs font-semibold text-text-secondary w-14 text-right shrink-0">
                                    {sc}/7
                                  </span>
                                </button>
                                {expanded && (block?.issues?.length ?? 0) > 0 && (
                                  <ul className="px-3 pb-3 text-xs text-text-muted italic space-y-1">
                                    {(block?.issues || []).map((issue, i) => (
                                      <li key={i}>{issue}</li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {Array.isArray(disclosureScore.boilerplate_flags) && (disclosureScore.boilerplate_flags as string[]).length > 0 && (
                        <div className="rounded-lg border border-orange-300 bg-orange-50 p-4">
                          <p className="text-sm font-semibold text-orange-900">
                            ⚠ Boilerplate language detected ({(disclosureScore.boilerplate_flags as string[]).length} phrase(s) reduced your score)
                          </p>
                          <ul className="mt-2 space-y-1">
                            {(disclosureScore.boilerplate_flags as string[]).map((phrase) => (
                              <li key={phrase} className="text-sm text-text-muted italic">
                                {`• "${phrase}"`}
                              </li>
                            ))}
                          </ul>
                          <p className="text-xs text-text-muted mt-3">
                            Tip: Replace generic phrases with contract-specific details and actual amounts.
                          </p>
                        </div>
                      )}

                      <div>
                        <p className="text-sm font-bold text-text-primary mb-3">Top 5 Improvements</p>
                        <div className="space-y-2">
                          {(Array.isArray(disclosureScore.improvement_suggestions) ? disclosureScore.improvement_suggestions : []).map((row: any, idx: number) => {
                            const n = Number(row?.number ?? idx + 1);
                            const area = String(row?.area || '');
                            const issue = String(row?.issue || '');
                            const example = String(row?.example_wording || '');
                            const open = expandedDisclosureImprovement === idx;
                            const issueShort = issue.length > 60 ? `${issue.slice(0, 60)}…` : issue;
                            return (
                              <div key={idx} className="border border-border-default rounded-lg">
                                <button
                                  type="button"
                                  className="w-full px-3 py-2 flex items-start gap-2 text-left hover:bg-bg-light"
                                  onClick={() => setExpandedDisclosureImprovement(open ? null : idx)}
                                >
                                  <span className="text-xs font-bold text-text-muted shrink-0">[{n}]</span>
                                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-[#0f172a] text-white shrink-0 max-w-[40%] truncate">{area}</span>
                                  <span className="text-sm text-text-secondary flex-1 min-w-0">{issueShort}</span>
                                </button>
                                {open && (
                                  <div className="px-3 pb-3 pt-0 border-t border-border-default bg-bg-light/40">
                                    <p className="text-sm text-text-muted mt-2">{issue}</p>
                                    <p className="text-xs font-semibold text-text-primary mt-3">Suggested wording:</p>
                                    <div className="relative mt-1 rounded-lg border border-blue-200 bg-blue-50/80 p-3 pr-12">
                                      <button
                                        type="button"
                                        className="absolute top-2 right-2 p-1 rounded hover:bg-blue-100 text-blue-800"
                                        aria-label="Copy suggestion"
                                        onClick={() =>
                                          navigator.clipboard.writeText(example).then(() => toast.success('Copied')).catch(() => toast.error('Copy failed'))
                                        }
                                      >
                                        <Copy className="w-4 h-4" />
                                      </button>
                                      <p className="text-sm text-blue-950 leading-relaxed" style={{ fontFamily: 'Georgia, serif' }}>
                                        {example}
                                      </p>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        <Button
                          type="button"
                          variant="secondary"
                          className="mt-3 w-full sm:w-auto bg-white border border-border-default"
                          onClick={() => {
                            const rows = Array.isArray(disclosureScore.improvement_suggestions) ? disclosureScore.improvement_suggestions : [];
                            const text = (rows as any[])
                              .map((row, i) => {
                                const n = row?.number ?? i + 1;
                                return `IMPROVEMENT ${n}:\nAREA: ${row?.area || ''}\nISSUE: ${row?.issue || ''}\nEXAMPLE: ${row?.example_wording || ''}\n`;
                              })
                              .join('\n');
                            navigator.clipboard.writeText(text).then(() => toast.success('All suggestions copied')).catch(() => toast.error('Copy failed'));
                          }}
                        >
                          Copy All Suggestions
                        </Button>
                      </div>

                      <div className="rounded-lg border border-border-default bg-bg-light p-4 flex gap-3">
                        <span className="text-xl shrink-0" aria-hidden>
                          📊
                        </span>
                        <div>
                          <p className="text-sm font-bold text-text-primary">Industry Benchmark</p>
                          <p className="text-sm text-text-secondary mt-1">{String(disclosureScore.benchmark_comparison || '')}</p>
                        </div>
                      </div>

                      <div className="flex flex-col sm:flex-row gap-3">
                        <Button
                          type="button"
                          variant="secondary"
                          className="flex-1 bg-white border border-border-default"
                          onClick={() => {
                            setDisclosureScore(null);
                            setDisclosureScoreOpen(true);
                          }}
                        >
                          Re-score
                        </Button>
                        <button
                          type="button"
                          title="Coming soon"
                          className="flex-1 px-4 py-2 rounded-lg border border-dashed border-border-default text-text-muted text-sm font-medium cursor-not-allowed bg-white"
                          disabled
                        >
                          Download Scorecard (PDF)
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
        )}
      </div>

      {results && (
        <button
          type="button"
          onClick={() => generateMasterReport()}
          disabled={isMasterLoading}
          className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-5 py-3 rounded-full shadow-xl text-white font-semibold bg-gradient-to-r from-orange-500 to-amber-600 hover:opacity-95 disabled:opacity-60 disabled:animate-none animate-pulse"
        >
          {isMasterLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileText className="w-5 h-5" />}
          Master Report
        </button>
      )}

      {masterModalOpen && masterReport && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto py-8 px-4">
          <button type="button" className="absolute inset-0 bg-black/60" aria-label="Close" onClick={() => setMasterModalOpen(false)} />
          <div className="relative w-full max-w-[900px] bg-white rounded-2xl shadow-2xl border border-border-default max-h-[90vh] flex flex-col">
            <div className="flex items-start justify-between gap-4 p-5 border-b border-border-default">
              <div>
                <h2 className="text-lg font-bold text-text-primary">IFRS 15 Master Compliance Report</h2>
                <p className="text-sm text-text-muted mt-1">
                  {String(masterReport.customer_name || customerName)} | {String(masterReport.generated_at || '').slice(0, 19)}
                </p>
              </div>
              <button type="button" className="p-2 rounded-lg hover:bg-bg-light text-text-muted" onClick={() => setMasterModalOpen(false)}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex flex-wrap gap-1 px-4 pt-3 border-b border-border-default bg-bg-light/50">
              {['Overview', 'Financial', 'Assessments', 'Risks', 'Audit', 'AI memo', 'Downloads'].map((t, i) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setMasterTab(i)}
                  className={`px-3 py-2 text-xs font-semibold rounded-t-lg border-b-2 ${
                    masterTab === i ? 'border-orange-primary text-orange-primary bg-white' : 'border-transparent text-text-secondary'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {masterTab === 0 && (
                <>
                  <h3 className="text-sm font-bold text-text-primary">Contract overview</h3>
                  <table className="w-full text-sm border border-border-default rounded-lg overflow-hidden">
                    <tbody>
                      {Object.entries((masterReport.contract_overview as Record<string, unknown>) || {}).map(([k, v]) => (
                        <tr key={k} className="border-b border-border-default">
                          <td className="py-2 px-3 font-medium text-text-secondary">{k.replace(/_/g, ' ')}</td>
                          <td className="py-2 px-3 text-right">{String(v)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <h3 className="text-sm font-bold text-text-primary mt-4">5-step status</h3>
                  <ul className="text-sm space-y-1">
                    <li>Step 1: {(masterReport.five_step_status as any)?.step1_contract_identified ? '✓' : '✗'} Contract identified</li>
                    <li>Step 2: {(masterReport.five_step_status as any)?.step2_obligations_identified ?? 0} obligations</li>
                    <li>Step 3: {formatCurrency(Number((masterReport.five_step_status as any)?.step3_transaction_price), currency, 0)} TP</li>
                    <li>Step 3 VC: {(masterReport.five_step_status as any)?.step3_variable_consideration_included ? '✓' : '✗'} included</li>
                    <li>Step 4: {(masterReport.five_step_status as any)?.step4_allocation_method}</li>
                    <li>Step 5: {formatCurrency(Number((masterReport.five_step_status as any)?.step5_revenue_recognised), currency, 0)} recognised / {formatCurrency(Number((masterReport.five_step_status as any)?.step5_deferred), currency, 0)} deferred</li>
                    <li>All complete: {(masterReport.five_step_status as any)?.all_steps_complete ? '✓' : '✗'}</li>
                  </ul>
                </>
              )}
              {masterTab === 1 && (
                <>
                  <h3 className="text-sm font-bold text-text-primary">Financial summary</h3>
                  <table className="w-full text-sm border border-border-default rounded-lg">
                    <tbody>
                      {Object.entries((masterReport.financial_summary as Record<string, unknown>) || {}).map(([k, v]) => (
                        <tr key={k} className="border-b border-border-default">
                          <td className="py-2 px-3">{k.replace(/_/g, ' ')}</td>
                          <td className="py-2 px-3 text-right amount">{typeof v === 'number' ? formatCurrency(v, currency, 0) : String(v)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {(() => {
                    const fs = masterReport.financial_summary as Record<string, number>;
                    const g = Number(fs?.gross_revenue || 0);
                    const n = Number(fs?.net_revenue || 0);
                    const d = g > 0 ? Math.abs((g - n) / g) * 100 : 0;
                    if (d > 20)
                      return <p className="text-sm text-red-600 font-medium">Gross vs net difference is material ({d.toFixed(1)}% of gross).</p>;
                    return null;
                  })()}
                </>
              )}
              {masterTab === 2 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {Object.entries((masterReport.assessments as Record<string, Record<string, unknown>>) || {}).map(([key, block]) => (
                    <div key={key} className="p-3 border border-border-default rounded-lg text-sm">
                      <p className="font-bold text-text-primary capitalize">{key.replace(/_/g, ' ')}</p>
                      <p className="text-xs mt-1">{block?.assessed ? 'Assessed' : 'Not assessed'}</p>
                      <pre className="text-xs mt-2 whitespace-pre-wrap text-text-muted">{JSON.stringify(block, null, 2)}</pre>
                    </div>
                  ))}
                </div>
              )}
              {masterTab === 3 && (
                <>
                  {(!(masterReport.risk_flags as unknown[]) || (masterReport.risk_flags as unknown[]).length === 0) ? (
                    <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-lg text-sm font-medium">No risks identified ✓</div>
                  ) : (
                    <div className="space-y-2">
                      {([...(masterReport.risk_flags as any[])].sort((a, b) => {
                        const o = { HIGH: 0, MEDIUM: 1, LOW: 2 };
                        return (o[a.severity as keyof typeof o] ?? 3) - (o[b.severity as keyof typeof o] ?? 3);
                      })).map((rf: any, i: number) => (
                        <div
                          key={i}
                          className={`p-3 rounded-lg border-l-4 text-sm ${
                            rf.severity === 'HIGH'
                              ? 'border-red-500 bg-red-50'
                              : rf.severity === 'MEDIUM'
                                ? 'border-orange-400 bg-orange-50'
                                : 'border-amber-300 bg-amber-50'
                          }`}
                        >
                          <span className="text-xs font-bold uppercase">{rf.severity}</span>
                          <p className="font-semibold text-text-primary">{rf.module}</p>
                          <p className="text-text-secondary mt-1">{rf.message}</p>
                          <p className="text-xs text-text-muted mt-1">{rf.action_required}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
              {masterTab === 4 && (
                <>
                  <div className="flex flex-col items-center gap-2">
                    <div
                      className={`w-32 h-32 rounded-full border-8 flex items-center justify-center text-2xl font-bold ${
                        (masterReport.audit_readiness as any)?.level === 'Ready'
                          ? 'border-emerald-500 text-emerald-700'
                          : (masterReport.audit_readiness as any)?.level === 'Needs Review'
                            ? 'border-orange-400 text-orange-800'
                            : 'border-red-500 text-red-700'
                      }`}
                    >
                      {(masterReport.audit_readiness as any)?.score ?? 0}
                    </div>
                    <p className="text-sm font-semibold">{(masterReport.audit_readiness as any)?.level}</p>
                  </div>
                  <ul className="text-sm space-y-1 mt-4">
                    {((masterReport.audit_readiness as any)?.checklist || []).map((it: any, i: number) => (
                      <li key={i} className="flex gap-2">
                        <span>{it.status === 'complete' ? '✓' : it.status === 'not_applicable' ? '—' : '✗'}</span>
                        <span>{it.item}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {masterTab === 5 && (
                <div>
                  <div className="flex justify-end mb-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        navigator.clipboard
                          .writeText(String(masterReport.ai_narrative || ''))
                          .then(() => toast.success('Copied'))
                          .catch(() => toast.error('Copy failed'))
                      }
                    >
                      <Copy className="w-4 h-4 mr-1" /> Copy
                    </Button>
                  </div>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap text-text-primary" style={{ fontFamily: 'Georgia, Times, serif' }}>
                    {String(masterReport.ai_narrative || '')}
                  </p>
                  <p className="text-xs text-text-muted mt-4">Prepared by IFRS AI</p>
                </div>
              )}
              {masterTab === 6 && (
                <div className="flex flex-col gap-3">
                  <Button variant="primary" className="bg-gradient-orange w-full" onClick={downloadMasterReportExcel} isLoading={isMasterExcelLoading}>
                    <Download className="w-4 h-4 mr-2" /> Download Master Report Excel
                  </Button>
                  <Button variant="secondary" className="w-full" disabled title="Coming soon">
                    Download PDF Summary
                  </Button>
                </div>
              )}
            </div>
            <div className="p-4 border-t border-border-default text-xs text-text-muted text-center">
              This report was generated by IFRS AI. All figures should be reviewed by a qualified accountant before use.
            </div>
          </div>
        </div>
      )}
      {isClientReportModalOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center px-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            aria-label="Close"
            onClick={() => !isGeneratingClientReport && setIsClientReportModalOpen(false)}
          />
          <div className="relative w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-border-default p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-text-primary">Generate Client Report</h3>
              <button
                type="button"
                className="p-2 rounded-lg hover:bg-bg-light text-text-muted"
                onClick={() => !isGeneratingClientReport && setIsClientReportModalOpen(false)}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">Prepared for</label>
                <input
                  type="text"
                  value={clientReportPreparedFor}
                  onChange={(e) => setClientReportPreparedFor(e.target.value)}
                  className="w-full px-3 py-2 border border-border-default rounded-lg"
                  placeholder="Client name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">Prepared by</label>
                <input
                  type="text"
                  value={clientReportPreparedBy}
                  onChange={(e) => setClientReportPreparedBy(e.target.value)}
                  className="w-full px-3 py-2 border border-border-default rounded-lg"
                  placeholder="Your firm name"
                />
              </div>
              <label className="flex items-center gap-3 text-sm text-text-primary">
                <input
                  type="checkbox"
                  checked={clientReportIncludeQa}
                  onChange={(e) => setClientReportIncludeQa(e.target.checked)}
                />
                Include Auditor Q&A
              </label>
              <Button
                variant="primary"
                size="lg"
                className="w-full bg-[#0b1f3b] text-white hover:opacity-90"
                onClick={handleGenerateClientReport}
                isLoading={isGeneratingClientReport}
              >
                <FileText className="w-5 h-5" /> Generate Report
              </Button>
            </div>
          </div>
        </div>
      )}
    </SidebarLayout>
  );
}
