'use client';

import { useState, useEffect, Fragment } from 'react';
import { SidebarLayout } from '@/components/SidebarLayout';
import { Button } from '@/components/Button';
import { Upload, FileText, Calculator, Download, Loader2, CheckCircle2, Clock, ArrowRight, Copy, Plus, Trash2, HelpCircle, X, ChevronDown, ChevronUp } from 'lucide-react';
import { ifrs15Api } from '@/lib/api';
import toast from 'react-hot-toast';
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
  const [showModificationComparison, setShowModificationComparison] = useState(false);
  const [modForm, setModForm] = useState({
    modification_date: new Date().toISOString().split('T')[0],
    price_change: 0,
    revenue_recognised_to_date: 0,
    remaining_periods: 1,
    new_goods_are_distinct: true,
    price_reflects_standalone: true,
    remaining_goods_are_distinct: true,
  });
  const [modAssessment, setModAssessment] = useState<any>(null);
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
        revenue_recognised_to_date: Number(data?.results?.contract_balances?.revenue_recognized_to_date || 0),
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
    'USD'
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
          modifications_log: modAssessment ? [{
            modification_date: modForm.modification_date,
            type: modAssessment.modification_type_label,
            price_change: modForm.price_change,
            catch_up_amount: modAssessment.catch_up_amount,
            direction: modAssessment.catch_up_direction,
            assessed_by: 'System',
            notes: modAssessment.explanation,
          }] : [],
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
      const response = await ifrs15Api.assessModification({
        original_contract_id: contractId === '—' ? `CONTRACT-${Date.now()}` : contractId,
        modification_date: modForm.modification_date,
        new_goods_services: perfObs.map((p: any) => String(p.obligation || p.obligation_id || '')).filter(Boolean),
        price_change: Number(modForm.price_change || 0),
        revenue_recognised_to_date: Number(modForm.revenue_recognised_to_date || 0),
        remaining_periods: Number(modForm.remaining_periods || 1),
        original_price: Number(tp || 0),
        new_goods_are_distinct: modForm.new_goods_are_distinct,
        price_reflects_standalone: modForm.price_reflects_standalone,
        remaining_goods_are_distinct: modForm.remaining_goods_are_distinct,
      }) as any;
      const { data, error } = response;
      if (error) throw new Error(error);
      setModAssessment(data);
      toast.success('Modification assessed');
    } catch (error: any) {
      toast.error(error?.message || 'Failed to assess modification');
    } finally {
      setIsAssessingModification(false);
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

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
        <div className="space-y-6">
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

              {/* Contract Modifications */}
              <div className="bg-white rounded-card p-6 border border-border-default shadow-card">
                <div className="flex items-center justify-between border-b border-border-default pb-4 mb-6">
                  <div>
                    <h3 className="text-base font-bold text-text-primary">Contract Modifications</h3>
                    <p className="text-xs text-text-muted mt-1">IFRS 15.18-21 assessment and accounting treatment</p>
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    className="bg-gradient-orange"
                    onClick={() => setShowModificationSection(!showModificationSection)}
                  >
                    {showModificationSection ? 'Hide' : 'Record Modification'}
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
                      <div>
                        <label className="block text-sm text-text-primary mb-1">Revenue Recognised to Date ($)</label>
                        <input
                          type="number"
                          value={modForm.revenue_recognised_to_date}
                          onChange={(e) => setModForm((p) => ({ ...p, revenue_recognised_to_date: Number(e.target.value || 0) }))}
                          className="w-full px-3 py-2 border border-border-default rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-text-primary mb-1">Remaining Periods</label>
                        <input
                          type="number"
                          min={1}
                          value={modForm.remaining_periods}
                          onChange={(e) => setModForm((p) => ({ ...p, remaining_periods: Number(e.target.value || 1) }))}
                          className="w-full px-3 py-2 border border-border-default rounded-lg"
                        />
                      </div>
                    </div>

                    <div className="space-y-3">
                      {[
                        { key: 'new_goods_are_distinct', label: 'Q1: Are the new goods/services distinct?' },
                        { key: 'price_reflects_standalone', label: 'Q2: Does the price increase reflect the standalone selling price?' },
                        { key: 'remaining_goods_are_distinct', label: 'Q3: Are remaining goods/services distinct from those already transferred?' },
                      ].map((q) => (
                        <div key={q.key} className="p-3 border border-border-default rounded-lg">
                          <p className="text-sm text-text-primary mb-2">{q.label}</p>
                          <div className="flex gap-4 text-sm">
                            <label className="flex items-center gap-2">
                              <input
                                type="radio"
                                checked={(modForm as any)[q.key] === true}
                                onChange={() => setModForm((p) => ({ ...p, [q.key]: true }))}
                              />
                              Yes
                            </label>
                            <label className="flex items-center gap-2">
                              <input
                                type="radio"
                                checked={(modForm as any)[q.key] === false}
                                onChange={() => setModForm((p) => ({ ...p, [q.key]: false }))}
                              />
                              No
                            </label>
                          </div>
                        </div>
                      ))}
                    </div>

                    <Button variant="primary" size="md" className="bg-gradient-orange" onClick={assessModification} isLoading={isAssessingModification}>
                      Assess Modification
                    </Button>

                    {modAssessment && (
                      <div className="space-y-4">
                        <div className={`p-4 rounded-lg border ${
                          modAssessment.modification_type === 'new_contract'
                            ? 'bg-green-50 border-green-200'
                            : modAssessment.modification_type === 'prospective'
                              ? 'bg-blue-50 border-blue-200'
                              : 'bg-orange-50 border-orange-200'
                        }`}>
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-bold text-text-primary">
                              {modAssessment.modification_type === 'new_contract' ? 'NEW CONTRACT' : modAssessment.modification_type === 'prospective' ? 'PROSPECTIVE' : 'CUMULATIVE CATCH-UP'}
                            </span>
                            <span className="text-xs px-2 py-1 rounded-full bg-white border border-border-default">
                              {modAssessment.modification_type_label}
                            </span>
                          </div>
                          {modAssessment.modification_type === 'catch_up' && (
                            <p className={`mt-3 text-sm font-semibold ${modAssessment.catch_up_amount >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                              {modAssessment.catch_up_amount >= 0 ? '+' : '-'} {formatCurrency(Math.abs(modAssessment.catch_up_amount || 0), currency, 0)} {modAssessment.catch_up_amount >= 0 ? 'Additional Revenue' : 'Revenue Reversal'}
                            </p>
                          )}
                        </div>

                        <div className="border border-border-default rounded-lg p-4">
                          <div className="flex items-center justify-between mb-3">
                            <h4 className="text-sm font-semibold text-text-primary">Before/After Schedule Comparison</h4>
                            <button type="button" className="text-xs font-semibold text-orange-primary" onClick={() => setShowModificationComparison(!showModificationComparison)}>
                              {showModificationComparison ? 'Collapse' : 'Show first 3 rows'}
                            </button>
                          </div>
                          {showModificationComparison && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div>
                                <p className="text-xs font-semibold text-text-muted mb-2">BEFORE MODIFICATION</p>
                                <div className="space-y-2">
                                  {(modAssessment.original_schedule_preview || []).slice(0, 3).map((row: any, idx: number) => (
                                    <div key={idx} className="p-2 border border-border-default rounded text-xs">
                                      {row.recognition_date} • {formatCurrency(Number(row.revenue_amount || 0), currency, 0)}
                                    </div>
                                  ))}
                                </div>
                              </div>
                              <div>
                                <p className="text-xs font-semibold text-text-muted mb-2">AFTER MODIFICATION</p>
                                <div className="space-y-2">
                                  {(modAssessment.revised_schedule || []).slice(0, 3).map((row: any, idx: number) => (
                                    <div key={idx} className="p-2 border border-border-default rounded text-xs">
                                      {row.recognition_date} • {formatCurrency(Number(row.revenue_amount || 0), currency, 0)}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="border border-border-default rounded-lg p-4">
                          <h4 className="text-sm font-semibold text-text-primary mb-3">Journal Entry</h4>
                          <div className="space-y-2">
                            {(modAssessment.journal_entries || []).map((entry: any, i: number) => (
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
                            ))}
                          </div>
                        </div>

                        <div className="p-4 bg-bg-light border border-border-default rounded-lg">
                          <p className="text-sm text-text-primary leading-relaxed" style={{ fontFamily: 'Georgia, serif' }}>
                            {modAssessment.explanation}
                          </p>
                        </div>

                        {modAssessment.risk_flag && (
                          <div className="p-3 bg-orange-50 border border-orange-300 rounded-lg text-sm text-orange-700">
                            ⚠ Catch-up adjustment exceeds 10% of total contract value. Recommend controller review.
                          </div>
                        )}
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
