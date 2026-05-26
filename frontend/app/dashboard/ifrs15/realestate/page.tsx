'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SidebarLayout } from '@/components/SidebarLayout';
import { Button } from '@/components/Button';
import { ifrs15Api } from '@/lib/api';
import {
  mapRealEstateToCalculatePayload,
  saveRealEstateSyncPayload,
} from '@/lib/realestate-ifrs15-mapper';
import {
  formatRealEstateMoney,
  disclosureScoreColor,
  type DisplayCurrency,
  UAE_PEG,
} from '@/lib/realestate-format';
import {
  type ExtractionMeta,
  fieldVerifyClass,
  highlightLowConfidenceField,
  languageBadgeLabel,
  lowConfidenceFieldLabel,
  successBadgeLabel,
} from '@/lib/spa-extraction-ui';
import {
  RERACertificateCard,
  type RERACertificateUploadResult,
} from '@/components/realestate/RERACertificateCard';
import { mapReportToPDFInput } from '@/lib/realestate-pdf-mapper';
import toast from 'react-hot-toast';
import {
  Upload,
  Loader2,
  Building2,
  Calculator,
  FileText,
  ArrowLeft,
  Plus,
  Trash2,
  ArrowRight,
  Download,
  FolderPlus,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from 'recharts';

const FORM_STORAGE_KEY = 'ifrs15_realestate_form_v2';

type EscrowReceipt = { date: string; amount: string; unit_id?: string; buyer_name?: string };
type Milestone = { milestone: string; completion_pct_required: string; amount_released: string };
type ModificationLog = {
  id: string;
  type: string;
  treatment?: string;
  adjustment?: number;
  narrative?: string;
  at: string;
  modification_date?: string;
  oqood_assessment?: Record<string, unknown>;
};

const DEFAULT_ESCROW: EscrowReceipt[] = [
  { date: '2024-01-15', amount: '400000', buyer_name: 'Buyer A' },
  { date: '2024-06-01', amount: '500000', buyer_name: 'Buyer A' },
  { date: '2024-10-01', amount: '300000', buyer_name: 'Buyer A' },
];

const DEFAULT_MILESTONES: Milestone[] = [
  { milestone: 'Foundation', completion_pct_required: '20', amount_released: '400000' },
  { milestone: 'Structure', completion_pct_required: '50', amount_released: '500000' },
];

export default function RealEstateIFRS15Page() {
  const router = useRouter();
  const [spaLoading, setSpaLoading] = useState(false);
  const [calcLoading, setCalcLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [spaExtracted, setSpaExtracted] = useState<Record<string, unknown> | null>(null);
  const [spaInputs, setSpaInputs] = useState<Record<string, unknown> | null>(null);
  const [extractionMeta, setExtractionMeta] = useState<ExtractionMeta | null>(null);
  const [spaFilename, setSpaFilename] = useState<string | null>(null);
  const [clearedVerifyFields, setClearedVerifyFields] = useState<Set<string>>(new Set());
  const [certLoading, setCertLoading] = useState(false);
  const [certFilename, setCertFilename] = useState<string | null>(null);
  const [certResult, setCertResult] = useState<RERACertificateUploadResult | null>(null);
  const [reraCertificateRef, setReraCertificateRef] = useState<string | null>(null);
  const [reraCertificateDate, setReraCertificateDate] = useState<string | null>(null);
  const [reraCertificateVerifiedPct, setReraCertificateVerifiedPct] = useState<number | null>(null);
  const [certOverrideManual, setCertOverrideManual] = useState(false);
  const [certMismatchResolved, setCertMismatchResolved] = useState<'certificate' | 'manual' | null>(null);
  const [certManualNote, setCertManualNote] = useState<string | null>(null);
  const [pdfModalOpen, setPdfModalOpen] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfReportingPeriod, setPdfReportingPeriod] = useState('Q1 2026');
  const [pdfReportDate, setPdfReportDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [pdfCustomPeriod, setPdfCustomPeriod] = useState('');

  const [contractValue, setContractValue] = useState('2000000');
  const [constructionStart, setConstructionStart] = useState('2023-01-01');
  const [expectedHandover, setExpectedHandover] = useState('2025-09-30');
  const [currentDate, setCurrentDate] = useState('2024-12-31');
  const [costsIncurred, setCostsIncurred] = useState('1300000');
  const [totalCosts, setTotalCosts] = useState('2000000');
  const [revenuePrior, setRevenuePrior] = useState('1026000');
  const [escrowReceipts, setEscrowReceipts] = useState<EscrowReceipt[]>(DEFAULT_ESCROW);
  const [escrowReleases, setEscrowReleases] = useState<EscrowRelease[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>(DEFAULT_MILESTONES);

  const [fullReport, setFullReport] = useState<Record<string, unknown> | null>(null);
  const [offPlanResult, setOffPlanResult] = useState<Record<string, unknown> | null>(null);
  const [escrowResult, setEscrowResult] = useState<Record<string, unknown> | null>(null);
  const [vatResult, setVatResult] = useState<Record<string, unknown> | null>(null);
  const [periodSchedule, setPeriodSchedule] = useState<Record<string, unknown>[]>([]);
  const [excelLoading, setExcelLoading] = useState(false);
  const [portfolioLoading, setPortfolioLoading] = useState(false);

  const [modType, setModType] = useState('price_change');
  const [modNewPrice, setModNewPrice] = useState('1950000');
  const [modRefund, setModRefund] = useState('1200000');
  const [modNewDate, setModNewDate] = useState('2026-03-31');
  const [modLog, setModLog] = useState<ModificationLog[]>([]);

  const [commissionPaid, setCommissionPaid] = useState('60000');
  const [amortMonths, setAmortMonths] = useState('30');
  const [costsResult, setCostsResult] = useState<Record<string, unknown> | null>(null);

  const [paControls, setPaControls] = useState('developer');
  const [paInventory, setPaInventory] = useState('developer');
  const [paPricing, setPaPricing] = useState('developer');
  const [paCredit, setPaCredit] = useState('developer');
  const [paResult, setPaResult] = useState<Record<string, unknown> | null>(null);

  const [projectName, setProjectName] = useState('');
  const [reraNumber, setReraNumber] = useState('');
  const [reraError, setReraError] = useState('');
  const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrency>('AED');
  const [revTrigger, setRevTrigger] = useState<
    'rera_completion_certificate' | 'spa_handover_date' | 'earlier_of_both'
  >('earlier_of_both');
  const [reraCompletionDate, setReraCompletionDate] = useState('');
  const [spaHandoverDate, setSpaHandoverDate] = useState('');
  const [disclosureOpen, setDisclosureOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('buyer_default');
  const [amountPaidBuyer, setAmountPaidBuyer] = useState('1200000');
  const [cancelEscrowBal, setCancelEscrowBal] = useState('1200000');
  const [cancelResult, setCancelResult] = useState<Record<string, unknown> | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [bundlingOpen, setBundlingOpen] = useState(false);
  const [bundlingLoading, setBundlingLoading] = useState(false);
  const [bundlingResult, setBundlingResult] = useState<Record<string, unknown> | null>(null);
  const [unitRows, setUnitRows] = useState<Array<Record<string, string>>>([
    {
      contract_id: 'RE-U1',
      unit_number: 'TWR-A-101',
      unit_type: 'apartment',
      contract_price_aed: '2000000',
      contract_date: '2024-03-01',
      completion_pct: '60',
      costs_incurred_aed: '1200000',
      buyer_name: 'Buyer A',
      buyer_id: 'EID1234567890',
    },
    {
      contract_id: 'RE-U2',
      unit_number: 'TWR-A-102',
      unit_type: 'apartment',
      contract_price_aed: '1800000',
      contract_date: '2024-03-15',
      completion_pct: '55',
      costs_incurred_aed: '990000',
      buyer_name: 'Buyer A',
      buyer_id: 'EID1234567890',
    },
  ]);

  const fmt = useCallback(
    (n: number) => formatRealEstateMoney(n, displayCurrency),
    [displayCurrency]
  );

  const triggerDateWarning = useMemo(() => {
    if (!reraCompletionDate || !spaHandoverDate) return null;
    const a = new Date(`${reraCompletionDate}T12:00:00`);
    const b = new Date(`${spaHandoverDate || expectedHandover}T12:00:00`);
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
    const days = Math.abs(Math.round((a.getTime() - b.getTime()) / 86400000));
    return days > 90 ? days : null;
  }, [reraCompletionDate, spaHandoverDate, expectedHandover]);

  useEffect(() => {
    setSpaHandoverDate((prev) => prev || expectedHandover);
  }, [expectedHandover]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(FORM_STORAGE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw) as Record<string, unknown>;
      if (s.contractValue) setContractValue(String(s.contractValue));
      if (s.constructionStart) setConstructionStart(String(s.constructionStart));
      if (s.expectedHandover) setExpectedHandover(String(s.expectedHandover));
      if (s.currentDate) setCurrentDate(String(s.currentDate));
      if (s.costsIncurred) setCostsIncurred(String(s.costsIncurred));
      if (s.totalCosts) setTotalCosts(String(s.totalCosts));
      if (s.revenuePrior) setRevenuePrior(String(s.revenuePrior));
      if (Array.isArray(s.escrowReceipts)) setEscrowReceipts(s.escrowReceipts as EscrowReceipt[]);
      if (Array.isArray(s.escrowReleases)) setEscrowReleases(s.escrowReleases as EscrowRelease[]);
      if (Array.isArray(s.milestones)) setMilestones(s.milestones as Milestone[]);
      if (s.commissionPaid) setCommissionPaid(String(s.commissionPaid));
      if (s.amortMonths) setAmortMonths(String(s.amortMonths));
      if (s.projectName) setProjectName(String(s.projectName));
      if (s.reraNumber) setReraNumber(String(s.reraNumber));
      if (s.displayCurrency) setDisplayCurrency(s.displayCurrency as DisplayCurrency);
      if (s.revTrigger) setRevTrigger(s.revTrigger as typeof revTrigger);
      if (s.reraCompletionDate) setReraCompletionDate(String(s.reraCompletionDate));
      if (s.spaHandoverDate) setSpaHandoverDate(String(s.spaHandoverDate));
    } catch {
      /* ignore corrupt storage */
    }
  }, []);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('re_portfolio_selected_project');
      if (!raw) return;
      const p = JSON.parse(raw) as Record<string, unknown>;
      if (p.rera_registration_number) setReraNumber(String(p.rera_registration_number));
      if (p.project_name) setProjectName(String(p.project_name));
      if (p.contract_value != null) setContractValue(String(p.contract_value));
      if (p.construction_start) setConstructionStart(String(p.construction_start).slice(0, 10));
      if (p.expected_handover) setExpectedHandover(String(p.expected_handover).slice(0, 10));
      sessionStorage.removeItem('re_portfolio_selected_project');
      toast.success('Project loaded from portfolio');
    } catch {
      sessionStorage.removeItem('re_portfolio_selected_project');
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => {
      localStorage.setItem(
        FORM_STORAGE_KEY,
        JSON.stringify({
          contractValue,
          constructionStart,
          expectedHandover,
          currentDate,
          costsIncurred,
          totalCosts,
          revenuePrior,
          escrowReceipts,
          escrowReleases,
          milestones,
          commissionPaid,
          amortMonths,
          projectName,
          reraNumber,
          displayCurrency,
          revTrigger,
          reraCompletionDate,
          spaHandoverDate,
        })
      );
    }, 400);
    return () => window.clearTimeout(t);
  }, [
    contractValue,
    constructionStart,
    expectedHandover,
    currentDate,
    costsIncurred,
    totalCosts,
    revenuePrior,
    escrowReceipts,
    escrowReleases,
    milestones,
    commissionPaid,
    amortMonths,
    projectName,
    reraNumber,
    displayCurrency,
    revTrigger,
    reraCompletionDate,
    spaHandoverDate,
  ]);

  const buildReportPayload = useCallback(() => {
    const escrowPayload = escrowReceipts.map((r) => ({
      date: r.date,
      amount: parseFloat(r.amount) || 0,
      unit_id: r.unit_id,
      buyer_name: r.buyer_name,
    }));
    const releasePayload = escrowReleases.map((r) => ({
      date: r.date,
      amount: parseFloat(r.amount) || 0,
      release_pct: parseFloat(r.release_pct) || 0,
      milestone_description: r.milestone_description || '',
      rera_approval_ref: r.rera_approval_ref || null,
    }));
    return {
      contract_value: parseFloat(contractValue) || 0,
      construction_start: constructionStart,
      expected_handover: expectedHandover,
      current_date: currentDate,
      costs_incurred_to_date: parseFloat(costsIncurred) || 0,
      total_estimated_costs: parseFloat(totalCosts) || 0,
      escrow_receipts: escrowPayload,
      escrow_releases: releasePayload,
      milestone_releases: milestones.map((m) => ({
        milestone: m.milestone,
        completion_pct_required: parseFloat(m.completion_pct_required) || 0,
        amount_released: parseFloat(m.amount_released) || 0,
      })),
      revenue_prior_period: parseFloat(revenuePrior) || 0,
      currency: displayCurrency,
      exchange_rate: UAE_PEG,
      rera_registration_number: reraNumber.trim(),
      project_name: projectName.trim(),
      revenue_recognition_trigger: revTrigger,
      rera_completion_date: reraCompletionDate || null,
      spa_handover_date: spaHandoverDate || expectedHandover,
      commission_paid: parseFloat(commissionPaid) || 0,
      expected_amortisation_period: parseInt(amortMonths, 10) || 24,
      assess_principal_agent: true,
      gross_contract_value: parseFloat(contractValue) || 0,
      controls_before_transfer: paControls,
      inventory_risk: paInventory,
      pricing_discretion: paPricing,
      credit_risk: paCredit,
      spa: spaExtracted,
      spa_mapped: spaInputs,
      contract_id: String(spaExtracted?.property_unit_number || spaInputs?.unit_id || 'RE-UNIT'),
      modifications: modLog.map((m) => ({
        modification_type: m.type,
        type: m.type,
        old_value: parseFloat(contractValue) || 0,
        new_value: m.type === 'price_change' ? parseFloat(modNewPrice) || 0 : undefined,
        modification_date: m.modification_date || currentDate,
        oqood_filed: Boolean(m.oqood_assessment?.oqood_filed),
      })),
      units: unitRows.map((u) => ({
        contract_id: u.contract_id,
        unit_number: u.unit_number,
        unit_type: u.unit_type,
        contract_price_aed: parseFloat(u.contract_price_aed) || 0,
        contract_date: u.contract_date,
        completion_pct: parseFloat(u.completion_pct) || 0,
        costs_incurred_aed: parseFloat(u.costs_incurred_aed) || 0,
        buyer_name: u.buyer_name,
        buyer_id: u.buyer_id,
      })),
      rera_certificate_ref: reraCertificateRef,
      rera_certificate_date: reraCertificateDate,
      rera_certificate_verified_pct:
        reraCertificateVerifiedPct != null && !certOverrideManual && certMismatchResolved !== 'manual'
          ? reraCertificateVerifiedPct
          : null,
    };
  }, [
    contractValue,
    constructionStart,
    expectedHandover,
    currentDate,
    costsIncurred,
    totalCosts,
    revenuePrior,
    escrowReceipts,
    milestones,
    commissionPaid,
    amortMonths,
    paControls,
    paInventory,
    paPricing,
    paCredit,
    spaExtracted,
    spaInputs,
    displayCurrency,
    reraNumber,
    projectName,
    revTrigger,
    reraCompletionDate,
    spaHandoverDate,
    modLog,
    modNewPrice,
    unitRows,
    escrowReleases,
    reraCertificateRef,
    reraCertificateDate,
    reraCertificateVerifiedPct,
    certOverrideManual,
    certMismatchResolved,
  ]);

  const applySpaInputs = useCallback((inputs: Record<string, unknown>) => {
    if (inputs.contract_value) setContractValue(String(inputs.contract_value));
    if (inputs.expected_handover) setExpectedHandover(String(inputs.expected_handover).slice(0, 10));
    if (inputs.construction_start) setConstructionStart(String(inputs.construction_start).slice(0, 10));
    const receipts = (inputs.escrow_receipts as EscrowReceipt[]) || [];
    if (receipts.length) {
      setEscrowReceipts(
        receipts.map((r) => ({
          date: String(r.date || '').slice(0, 10),
          amount: String(r.amount || ''),
          buyer_name: String(r.buyer_name || ''),
        }))
      );
    }
    if (inputs.project_name) setProjectName(String(inputs.project_name));
    const rera = (inputs as { rera_registration_number?: string }).rera_registration_number;
    if (rera) setReraNumber(String(rera));
  }, []);

  const markFieldVerified = useCallback((backendField: string) => {
    setClearedVerifyFields((prev) => {
      const next = new Set(prev);
      next.add(backendField);
      return next;
    });
  }, []);

  const isVerifyHighlight = useCallback(
    (backendField: string) =>
      highlightLowConfidenceField(
        backendField,
        extractionMeta?.low_confidence_fields || [],
        clearedVerifyFields
      ),
    [extractionMeta?.low_confidence_fields, clearedVerifyFields]
  );

  const handleCertUpload = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Certificate PDF must be 10MB or smaller');
      return;
    }
    setCertLoading(true);
    clearCertificateState();
    setCertFilename(file.name);
    const { data, error } = await ifrs15Api.realestateUploadReraCertificate(file, {
      rera_registration_number: reraNumber.trim() || undefined,
      form_completion_pct: costBasedCompletionPct,
      currency: displayCurrency,
    });
    setCertLoading(false);
    if (error) {
      toast.error(error);
      return;
    }
    const result = (data || {}) as RERACertificateUploadResult;
    setCertResult(result);
    if (result.success === false) {
      return;
    }
    if (result.mismatch_detected) {
      return;
    }
    const conf = result.confidence_score ?? 0;
    const low = result.low_confidence_fields || [];
    if (conf >= 0.7) {
      applyCertificateFromFields(result.fields, { lowFields: low });
      setCertMismatchResolved('certificate');
      toast.success('RERA certificate verified — completion % updated');
    } else {
      applyCertificateFromFields(result.fields, { onlyHighConfidence: true, lowFields: low });
      toast('Partial certificate extraction — verify highlighted fields', { icon: '⚠️' });
    }
  };

  const handleSpaUpload = async (file: File) => {
    setSpaLoading(true);
    setExtractionMeta(null);
    setSpaExtracted(null);
    setSpaInputs(null);
    setClearedVerifyFields(new Set());
    setSpaFilename(file.name);
    const { data, error } = await ifrs15Api.realestateUploadSpa(file);
    setSpaLoading(false);
    if (error) {
      toast.error(error);
      return;
    }
    const meta = (data?.extraction_meta as ExtractionMeta) || {};
    setExtractionMeta(meta);

    if (meta.success === false) {
      setSpaExtracted(null);
      setSpaInputs(null);
      toast.error(meta.fallback_reason || 'PDF could not be read');
      return;
    }

    const extracted = (data?.extracted as Record<string, unknown>) || {};
    const inputs = (data?.ifrs15_inputs as Record<string, unknown>) || {};
    setSpaExtracted(Object.keys(extracted).length ? extracted : null);
    setSpaInputs(inputs);

    if (meta.fallback_triggered) {
      toast('Arabic PDF — please enter fields manually', { icon: '⚠️' });
      return;
    }

    if (Object.keys(inputs).length) {
      applySpaInputs(inputs);
    }
    if (extracted.rera_registration_number) {
      setReraNumber(String(extracted.rera_registration_number));
    }
    if (extracted.project_name) {
      setProjectName(String(extracted.project_name));
    }
    if (extracted.handover_date) {
      setSpaHandoverDate(String(extracted.handover_date).slice(0, 10));
    }

    if (meta.warnings?.length) {
      toast(meta.warnings[0], { icon: '⚠️' });
    } else {
      toast.success('SPA extracted — calculator pre-filled');
    }
  };

  const runCalculations = async () => {
    const rera = reraNumber.trim();
    if (!rera) {
      setReraError('RERA registration number is required');
      toast.error('RERA registration number is required');
      return;
    }
    setReraError('');
    if (
      revTrigger === 'rera_completion_certificate' &&
      !reraCompletionDate
    ) {
      toast.error('RERA completion date required for this trigger');
      return;
    }
    if (revTrigger === 'spa_handover_date' && !spaHandoverDate && !expectedHandover) {
      toast.error('SPA handover date required for this trigger');
      return;
    }
    setCalcLoading(true);
    const payload = {
      ...buildReportPayload(),
      cancellation_refund: cancelResult || undefined,
    };
    const { data, error, reraViolation } = await ifrs15Api.realestateReport(payload);
    setCalcLoading(false);
    if (reraViolation) {
      setReraEscrowViolation(reraViolation);
      setFullReport(null);
      setOffPlanResult(null);
      setEscrowResult(null);
      setVatResult(null);
      setPeriodSchedule([]);
      return;
    }
    if (error) {
      toast.error(error);
      return;
    }
    setReraEscrowViolation(null);
    const report = (data?.report as Record<string, unknown>) || {};
    setFullReport(report);
    setOffPlanResult((report.off_plan as Record<string, unknown>) || null);
    setEscrowResult((report.escrow as Record<string, unknown>) || null);
    setVatResult((report.vat as Record<string, unknown>) || null);
    setPeriodSchedule((report.period_schedule as Record<string, unknown>[]) || []);
    setCostsResult((report.contract_costs as Record<string, unknown>) || null);
    setPaResult((report.principal_agent as Record<string, unknown>) || null);
    toast.success('Full recognition report ready');
  };

  const downloadClientPdf = async () => {
    if (!fullReport) {
      toast.error('Run recognition first');
      return;
    }
    const period =
      pdfReportingPeriod === 'Custom' ? pdfCustomPeriod.trim() || 'Custom period' : pdfReportingPeriod;
    setPdfLoading(true);
    const payload = mapReportToPDFInput(
      fullReport,
      {
        projectName,
        developerName: String(spaExtracted?.developer_name || ''),
        reraNumber,
        revTrigger,
        reraCompletionDate,
        spaHandoverDate,
        contractValue,
        escrowReceipts,
        escrowReleases,
        completionPctLive,
        reraCertificateRef,
        reraCertificateDate,
        reraCertificateVerifiedPct,
        certResult,
        certMismatchResolved,
        certOverrideManual,
        cancelResult,
      },
      { reportingPeriod: period, reportDate: pdfReportDate, currency: displayCurrency }
    );
    const { blob, filename, error } = await ifrs15Api.realestateClientReportPdf(payload);
    setPdfLoading(false);
    if (error || !blob) {
      toast.error(`PDF generation failed — ${error || 'Unknown error'}`);
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `IFRS15_RE_${reraNumber}_${pdfReportDate.replace(/-/g, '')}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
    setPdfModalOpen(false);
    toast.success(`✓ Client report downloaded — ${a.download}`);
  };

  const exportExcel = async () => {
    if (!fullReport || reraEscrowViolation) {
      toast.error('Run recognition first');
      return;
    }
    setExcelLoading(true);
    const unit = String(spaExtracted?.property_unit_number || 'RE-UNIT');
    const reportOut = {
      ...fullReport,
      ...(cancelResult ? { cancellation_refund: cancelResult } : {}),
    };
    const { data, error, reraViolation } = await ifrs15Api.realestateExportExcel({
      report: reportOut,
      contract_id: `RE-${unit}`,
      escrow_receipts: buildReportPayload().escrow_receipts as Record<string, unknown>[],
      escrow_releases: buildReportPayload().escrow_releases as Record<string, unknown>[],
      construction_completion_pct: completionPctLive,
    });
    setExcelLoading(false);
    if (reraViolation) {
      setReraEscrowViolation(reraViolation);
      setBlockedModal({
        title: 'Excel Export Blocked',
        body: 'A RERA escrow violation exists. Resolve the escrow release figures before exporting the audit workbook.',
      });
      return;
    }
    if (error || !data?.file_id) {
      toast.error(error || 'Export failed');
      return;
    }
    window.open(ifrs15Api.realestateDownloadExcel(data.file_id), '_blank');
    toast.success('Excel downloaded');
  };

  const saveToPortfolio = async () => {
    if (!offPlanResult || reraEscrowViolation) {
      toast.error('Run recognition first');
      return;
    }
    setPortfolioLoading(true);
    const unit = String(spaExtracted?.property_unit_number || 'RE-UNIT');
    const buyer = String(spaExtracted?.buyer_name || 'Buyer');
    const hv = (fullReport?.health_validation as Record<string, unknown>) || {};
    const pendingOqood = modLog.filter(
      (m) =>
        Boolean(m.oqood_assessment?.requires_oqood_amendment) &&
        !Boolean(m.oqood_assessment?.oqood_filed)
    ).length;
    const { error, reraViolation } = await ifrs15Api.realestatePortfolioAdd({
      contract_id: `RE-${unit}`,
      customer_name: buyer,
      contract_type: 'real_estate_off_plan',
      start_date: constructionStart,
      end_date: expectedHandover,
      total_tp: parseFloat(contractValue) || 0,
      recognised_to_date: Number(offPlanResult.revenue_recognised_to_date) || 0,
      deferred_balance: Number(offPlanResult.contract_liability) || 0,
      rpo_amount: Number(offPlanResult.remaining_revenue) || 0,
      status: 'active',
      currency: displayCurrency,
      arr: 0,
      mrr: 0,
      disclosure_score: Number(fullReport?.disclosure_score) || undefined,
      risk: reraNumber,
      escrow_receipts: buildReportPayload().escrow_receipts,
      escrow_releases: buildReportPayload().escrow_releases,
      construction_completion_pct: completionPctLive,
      realestate_snapshot: {
        project_name: projectName.trim(),
        developer_name: String(spaExtracted?.developer_name || ''),
        rera_registration_number: reraNumber.trim(),
        completion_pct: completionPctLive,
        completion_source:
          reraCertificateVerifiedPct != null && !certOverrideManual ? 'rera_certificate' : 'manual_input',
        revenue_recognised: Number(offPlanResult.revenue_recognised_to_date) || 0,
        deferred_revenue: Number(offPlanResult.contract_liability) || 0,
        vat_amount: Number(vatResult?.total_vat) || 0,
        health_validation: hv,
        escrow_validation: fullReport?.escrow_validation,
        pending_oqood_filings: pendingOqood,
        bundling_alert: Boolean((fullReport?.bundling_assessment as Record<string, unknown>)?.should_bundle),
        rera_certificate_verified:
          reraCertificateVerifiedPct != null && !certOverrideManual && certMismatchResolved !== 'manual',
        disclosure_score: fullReport?.disclosure_score,
        last_updated: new Date().toISOString(),
      },
    });
    setPortfolioLoading(false);
    if (reraViolation) {
      setReraEscrowViolation(reraViolation);
      setBlockedModal({
        title: 'Portfolio Save Blocked',
        body: 'Cannot save a contract with an active RERA escrow violation to the portfolio. Resolve and rerun recognition first.',
      });
      return;
    }
    if (error) toast.error(error);
    else toast.success('Saved to IFRS 15 portfolio');
  };

  const runModification = async () => {
    const completionPct = Number(offPlanResult?.completion_pct) || 65;
    const { data, error } = await ifrs15Api.realestateModification({
      original_contract: { value: parseFloat(contractValue), completion_pct: completionPct },
      modification_type: modType,
      modification_date: currentDate,
      oqood_filed: false,
      modification_details: {
        new_price: parseFloat(modNewPrice),
        refund_amount: parseFloat(modRefund),
        new_date: modNewDate,
      },
    });
    if (error) {
      toast.error(error);
      return;
    }
    const result = data?.result as Record<string, unknown>;
    setModLog((prev) => [
      {
        id: crypto.randomUUID(),
        type: modType,
        treatment: String(result?.treatment || ''),
        adjustment: Number(result?.revenue_adjustment) || 0,
        narrative: String(result?.narrative || ''),
        at: new Date().toISOString(),
        modification_date: currentDate,
        oqood_assessment: (result?.oqood_assessment as Record<string, unknown>) || undefined,
      },
      ...prev,
    ]);
    toast.success(`Modification: ${result?.treatment}`);
  };

  const setOqoodFiled = async (id: string, filed: boolean) => {
    setModLog((prev) =>
      prev.map((m) =>
        m.id === id
          ? {
              ...m,
              oqood_assessment: { ...(m.oqood_assessment || {}), oqood_filed: filed },
            }
          : m
      )
    );
    const { error } = await ifrs15Api.realestatePatchOqoodFiled({
      modification_id: id,
      oqood_filed: filed,
    });
    if (error) toast.error(error);
  };

  const runContractCosts = async () => {
    const { data, error } = await ifrs15Api.realestateContractCosts({
      commission_paid: parseFloat(commissionPaid) || 0,
      contract_value: parseFloat(contractValue) || 0,
      expected_amortisation_period: parseInt(amortMonths, 10) || 24,
    });
    if (error) toast.error(error);
    else if (data?.result) {
      setCostsResult(data.result);
      toast.success(data.result.capitalise ? 'Commission capitalised' : 'Commission expensed');
    }
  };

  const runPrincipalAgent = async () => {
    const { data, error } = await ifrs15Api.realestatePrincipalAgent({
      gross_contract_value: parseFloat(contractValue) || 0,
      controls_before_transfer: paControls,
      inventory_risk: paInventory,
      pricing_discretion: paPricing,
      credit_risk: paCredit,
    });
    if (error) toast.error(error);
    else if (data?.result) setPaResult(data.result);
  };

  const timelineChart = useMemo(() => {
    const timeline = (escrowResult?.timeline as Record<string, unknown>[]) || [];
    return timeline.map((t, i) => ({
      name: String(t.date || t.milestone || `Event ${i + 1}`).slice(0, 12),
      escrow: t.type === 'escrow_receipt' ? Number(t.amount) || 0 : 0,
      released: t.type === 'milestone_release' ? Number(t.amount_released) || 0 : 0,
      revenue: Number(t.revenue_recognised_to_date) || 0,
    }));
  }, [escrowResult]);

  const vatRows = (vatResult?.alignment_table as Record<string, unknown>[]) || [];
  const scheduleChart = useMemo(
    () =>
      periodSchedule.map((p) => ({
        name: String(p.period || ''),
        revenue: Number(p.revenue_recognised) || 0,
        cumulative: Number(p.cumulative_revenue) || 0,
      })),
    [periodSchedule]
  );
  const pendingOqoodCount = useMemo(
    () =>
      modLog.filter(
        (m) =>
          Boolean(m.oqood_assessment?.requires_oqood_amendment) &&
          !Boolean(m.oqood_assessment?.oqood_filed)
      ).length,
    [modLog]
  );
  const escrowReleasedTotal = useMemo(
    () => escrowReleases.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0),
    [escrowReleases]
  );
  const escrowReceivedTotal = useMemo(
    () => escrowReceipts.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0),
    [escrowReceipts]
  );
  const costBasedCompletionPct = useMemo(() => {
    const c = parseFloat(costsIncurred) || 0;
    const t = parseFloat(totalCosts) || 0;
    return t > 0 ? (c / t) * 100 : 0;
  }, [costsIncurred, totalCosts]);

  const completionPctLive = useMemo(() => {
    if (
      reraCertificateVerifiedPct != null &&
      !certOverrideManual &&
      certMismatchResolved !== 'manual'
    ) {
      return reraCertificateVerifiedPct;
    }
    return costBasedCompletionPct;
  }, [
    reraCertificateVerifiedPct,
    certOverrideManual,
    certMismatchResolved,
    costBasedCompletionPct,
  ]);

  const clearCertificateState = useCallback(() => {
    setCertResult(null);
    setCertFilename(null);
    setReraCertificateRef(null);
    setReraCertificateDate(null);
    setReraCertificateVerifiedPct(null);
    setCertOverrideManual(false);
    setCertMismatchResolved(null);
    setCertManualNote(null);
  }, []);

  const applyCertificateFromFields = useCallback(
    (
      fields: RERACertificateUploadResult['fields'],
      opts?: { onlyHighConfidence?: boolean; lowFields?: string[] }
    ) => {
      if (!fields) return;
      const low = opts?.lowFields || certResult?.low_confidence_fields || [];
      const skip = (name: string) => opts?.onlyHighConfidence && low.includes(name);

      if (fields.completion_pct != null && !skip('completion_pct')) {
        const pct = Number(fields.completion_pct);
        setReraCertificateVerifiedPct(pct);
        const total = parseFloat(totalCosts) || 0;
        if (total > 0) {
          setCostsIncurred(String(Math.round((pct / 100) * total)));
        }
      }
      if (fields.certificate_date && !skip('certificate_date')) {
        setReraCertificateDate(fields.certificate_date.slice(0, 10));
        if (
          revTrigger === 'rera_completion_certificate' ||
          revTrigger === 'earlier_of_both'
        ) {
          setReraCompletionDate(fields.certificate_date.slice(0, 10));
        }
      }
      if (fields.certificate_ref && !skip('certificate_ref')) {
        setReraCertificateRef(fields.certificate_ref);
      }
      if (fields.project_name && !projectName.trim() && !skip('project_name')) {
        setProjectName(fields.project_name);
      }
      if (fields.rera_registration_number && !reraNumber.trim()) {
        setReraNumber(fields.rera_registration_number);
      }
    },
    [certResult?.low_confidence_fields, totalCosts, revTrigger, projectName, reraNumber]
  );
  const escrowReleasePctLive = useMemo(() => {
    const cv = parseFloat(contractValue) || 0;
    return cv > 0 ? (escrowReleasedTotal / cv) * 100 : 0;
  }, [contractValue, escrowReleasedTotal]);
  const previewReleaseViolation = escrowReleasePctLive > completionPctLive;

  const syncToMainSchedule = async () => {
    if (!offPlanResult || reraEscrowViolation) {
      toast.error('Run recognition first');
      return;
    }
    setSyncLoading(true);
    const escrowTotal = escrowReceipts.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
    const fromReport = fullReport?.ifrs15_calculate_payload as Record<string, unknown> | undefined;
    const localPayload = mapRealEstateToCalculatePayload({
      contractValue: parseFloat(contractValue) || 0,
      constructionStart,
      expectedHandover,
      costsIncurred: parseFloat(costsIncurred) || 0,
      totalCosts: parseFloat(totalCosts) || 0,
      revenuePrior: parseFloat(revenuePrior) || 0,
      escrowTotal,
      offPlan: offPlanResult,
      spaExtracted,
      spaInputs,
      reraRegistrationNumber: reraNumber.trim(),
      projectName: projectName.trim(),
      currency: displayCurrency,
      exchangeRate: UAE_PEG,
      revenueRecognitionTrigger: revTrigger,
      recognitionTriggerSummary: String(
        fullReport?.recognition_trigger_summary || ''
      ),
    });
    let payload = fromReport || localPayload;
    if (!fromReport) {
      const { data, error, reraViolation } = await ifrs15Api.realestateToCalculatePayload({
        off_plan: offPlanResult,
        spa: spaExtracted ?? undefined,
        spa_mapped: spaInputs ?? undefined,
        construction_start: constructionStart,
        expected_handover: expectedHandover,
        contract_value: parseFloat(contractValue) || 0,
        costs_incurred_to_date: parseFloat(costsIncurred) || 0,
        total_estimated_costs: parseFloat(totalCosts) || 0,
        revenue_prior_period: parseFloat(revenuePrior) || 0,
        escrow_total: escrowTotal,
        escrow_receipts: buildReportPayload().escrow_receipts,
        escrow_releases: buildReportPayload().escrow_releases,
      });
      if (reraViolation) {
        setSyncLoading(false);
        setReraEscrowViolation(reraViolation);
        return;
      }
      if (error && !data?.calculate_payload) {
        setSyncLoading(false);
        toast.error(error);
        return;
      }
      payload = (data?.calculate_payload as Record<string, unknown>) || localPayload;
    }
    setSyncLoading(false);
    saveRealEstateSyncPayload(payload as Record<string, unknown>);
    toast.success('Opening main IFRS 15 schedule…');
    router.push('/dashboard/ifrs15');
  };

  const runCancellationRefund = async () => {
    if (!reraNumber.trim()) {
      setReraError('RERA registration number is required');
      return;
    }
    setCancelLoading(true);
    const { data, error, reraViolation } = await ifrs15Api.realestateCancellationRefund({
      contract_price: parseFloat(contractValue) || 0,
      amount_paid_by_buyer: parseFloat(amountPaidBuyer) || 0,
      construction_completion_pct: Number(offPlanResult?.completion_pct) || 0,
      rera_registration_number: reraNumber.trim(),
      cancellation_reason: cancelReason,
      escrow_balance: parseFloat(cancelEscrowBal) || 0,
      escrow_receipts: buildReportPayload().escrow_receipts,
      escrow_releases: buildReportPayload().escrow_releases,
    });
    setCancelLoading(false);
    if (reraViolation) {
      setReraEscrowViolation(reraViolation);
      return;
    }
    if (error) {
      toast.error(error);
      return;
    }
    setCancelResult((data?.result as Record<string, unknown>) || null);
    toast.success('Cancellation refund calculated (Law 8/2007)');
  };

  const runBundlingCheck = async () => {
    setBundlingLoading(true);
    const units = unitRows.map((u) => ({
      contract_id: u.contract_id,
      unit_number: u.unit_number,
      unit_type: u.unit_type,
      contract_price_aed: parseFloat(u.contract_price_aed) || 0,
      contract_date: u.contract_date,
      completion_pct: parseFloat(u.completion_pct) || 0,
      costs_incurred_aed: parseFloat(u.costs_incurred_aed) || 0,
      buyer_name: u.buyer_name,
      buyer_id: u.buyer_id,
    }));
    const { data, error } = await ifrs15Api.realestateBundlingCheck({
      units,
      currency: displayCurrency,
    });
    setBundlingLoading(false);
    if (error) {
      toast.error(error);
      return;
    }
    setBundlingResult((data?.assessment as Record<string, unknown>) || null);
    toast.success('Bundling check completed');
  };

  return (
    <SidebarLayout>
      {pdfModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 border border-border-default">
            <h3 className="text-lg font-semibold mb-4">Generate Client Report</h3>
            <label className="text-sm block mb-3">
              <span className="text-text-muted block mb-1">Reporting Period</span>
              <select
                className="w-full border rounded px-3 py-2"
                value={pdfReportingPeriod}
                onChange={(e) => setPdfReportingPeriod(e.target.value)}
              >
                {['Q1 2026', 'Q2 2026', 'Q3 2026', 'Q4 2026', 'FY 2025', 'FY 2026', 'Custom'].map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            {pdfReportingPeriod === 'Custom' && (
              <label className="text-sm block mb-3">
                <span className="text-text-muted block mb-1">Custom period label</span>
                <input
                  className="w-full border rounded px-3 py-2"
                  value={pdfCustomPeriod}
                  onChange={(e) => setPdfCustomPeriod(e.target.value)}
                  placeholder="e.g. H1 2026"
                />
              </label>
            )}
            <label className="text-sm block mb-3">
              <span className="text-text-muted block mb-1">Report Date</span>
              <input
                type="date"
                className="w-full border rounded px-3 py-2"
                value={pdfReportDate}
                onChange={(e) => setPdfReportDate(e.target.value)}
              />
            </label>
            <label className="text-sm block mb-4">
              <span className="text-text-muted block mb-1">Currency</span>
              <select
                className="w-full border rounded px-3 py-2"
                value={displayCurrency}
                onChange={(e) => setDisplayCurrency(e.target.value as DisplayCurrency)}
              >
                <option value="AED">AED</option>
                <option value="USD">USD</option>
              </select>
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setPdfModalOpen(false)} disabled={pdfLoading}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => void downloadClientPdf()} disabled={pdfLoading}>
                {pdfLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Generating PDF report...
                  </>
                ) : (
                  'Generate PDF →'
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto space-y-8 pb-16">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <Link
              href="/dashboard/ifrs15"
              className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-orange-primary mb-2"
            >
              <ArrowLeft className="w-4 h-4" /> IFRS 15
            </Link>
            <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
              <Building2 className="w-7 h-7 text-orange-primary" />
              Real Estate UAE
            </h1>
            <p className="text-sm text-text-muted mt-1">
              RERA registration, AED/USD, handover trigger, Law 8/2007 cancellation, Oqood amendment flag, IFRS 15 para 17 bundling check, disclosure scoring
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex rounded-lg border border-border-default overflow-hidden text-xs font-semibold">
              {(['AED', 'USD'] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setDisplayCurrency(c)}
                  className={`px-4 py-2 ${displayCurrency === c ? 'bg-orange-primary text-white' : 'bg-white text-text-secondary'}`}
                >
                  {c}
                </button>
              ))}
            </div>
            {displayCurrency === 'USD' && (
              <p className="text-[11px] text-text-muted">Rate: 1 USD = {UAE_PEG} AED (UAE CB peg)</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2 w-full sm:w-auto">
            <Button onClick={runCalculations} disabled={calcLoading}>
              {calcLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Calculator className="w-4 h-4 mr-2" />}
              Run recognition
            </Button>
            <Button title={reraEscrowViolation ? 'Resolve RERA escrow violation first.' : ''} variant="secondary" onClick={syncToMainSchedule} disabled={syncLoading || !offPlanResult || Boolean(reraEscrowViolation)}>
              {syncLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ArrowRight className="w-4 h-4 mr-2" />}
              Sync to IFRS 15
            </Button>
            <Button
              title={
                reraEscrowViolation
                  ? 'Resolve RERA escrow violation first.'
                  : !fullReport
                    ? 'Run recognition first to generate report'
                    : ''
              }
              variant="secondary"
              onClick={() => setPdfModalOpen(true)}
              disabled={!fullReport || Boolean(reraEscrowViolation)}
            >
              📄 Client Report
            </Button>
            <Button title={reraEscrowViolation ? 'Resolve RERA escrow violation first.' : ''} variant="secondary" onClick={exportExcel} disabled={excelLoading || !fullReport || Boolean(reraEscrowViolation)}>
              {excelLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Download className="w-4 h-4 mr-2" />}
              Excel
            </Button>
            <Link href="/dashboard/ifrs15/realestate/portfolio">
              <Button type="button" variant="secondary">
                📊 Portfolio
              </Button>
            </Link>
            <Button title={reraEscrowViolation ? 'Resolve RERA escrow violation first.' : ''} variant="secondary" onClick={saveToPortfolio} disabled={portfolioLoading || !offPlanResult || Boolean(reraEscrowViolation)}>
              {portfolioLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <FolderPlus className="w-4 h-4 mr-2" />}
              Save
            </Button>
          </div>
        </div>

        {reraEscrowViolation ? (
          <section
            className="w-full border-2 border-red-500 bg-red-50 rounded-lg p-6"
            role="alert"
            aria-live="assertive"
          >
            <h2 className="text-xl font-bold text-red-800 mb-3">⛔ RERA ESCROW VIOLATION — Processing Blocked</h2>
            <div className="text-sm text-red-900 space-y-1">
              <p>Escrow Released: {Number(reraEscrowViolation.escrow_release_pct || 0).toFixed(2)}% ({fmt(escrowReleasedTotal)})</p>
              <p>Construction: {Number(reraEscrowViolation.construction_completion_pct || 0).toFixed(2)}%</p>
              <p>Excess Released: {Number(reraEscrowViolation.excess_pct || 0).toFixed(2)}% ({fmt(Number(reraEscrowViolation.excess_amount_aed || 0))})</p>
              <p className="pt-2 font-medium">{String(reraEscrowViolation.law_reference || 'UAE Law No. 8 of 2007, Article 8')}</p>
              <div className="pt-2">
                <p className="font-semibold">Resolution Steps:</p>
                <ol className="list-decimal pl-5">
                  {((reraEscrowViolation.resolution_steps as string[]) || []).map((s, i) => (
                    <li key={i}>{s.replace(/^\d+\.\s*/, '')}</li>
                  ))}
                </ol>
              </div>
            </div>
          </section>
        ) : null}

        <section className="bg-white border border-border-default rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">Contract details</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="text-sm">
              <span className="text-text-muted block mb-1">Project name</span>
              <input
                className={`w-full rounded px-3 py-2 ${fieldVerifyClass(isVerifyHighlight('project_name'))}`}
                value={projectName}
                onChange={(e) => {
                  setProjectName(e.target.value);
                  markFieldVerified('project_name');
                }}
                placeholder="e.g. Marina Heights Tower B"
              />
              {isVerifyHighlight('project_name') ? (
                <p className="text-xs text-amber-700 mt-1">⚠️ Please verify</p>
              ) : null}
            </label>
            <label className="text-sm">
              <span className="text-text-muted block mb-1">RERA Registration Number *</span>
              <input
                className={`w-full rounded px-3 py-2 ${
                  reraError ? 'border-red-500 border-2' : fieldVerifyClass(isVerifyHighlight('rera_registration_number'))
                }`}
                value={reraNumber}
                onChange={(e) => {
                  setReraNumber(e.target.value);
                  markFieldVerified('rera_registration_number');
                  clearCertificateState();
                  if (reraError) setReraError('');
                }}
                placeholder="e.g. RERA-2024-DXB-00123"
              />
              {isVerifyHighlight('rera_registration_number') ? (
                <p className="text-xs text-amber-700 mt-1">⚠️ Please verify</p>
              ) : null}
              {reraError ? (
                <p className="text-xs text-red-600 mt-1">{reraError}</p>
              ) : null}
            </label>
          </div>
        </section>

        {offPlanResult && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3">
            {[
              ['RERA', reraNumber || '—'],
              [
                'Certificate',
                certResult?.success === false
                  ? 'Upload failed'
                  : certResult?.mismatch_detected && !certMismatchResolved
                    ? '⚠️ Mismatch'
                    : reraCertificateVerifiedPct != null && !certOverrideManual
                      ? '✓ Cert Verified'
                      : 'No Certificate',
              ],
              ['Completion', `${offPlanResult.completion_pct}%`],
              ['Revenue YTD', fmt(Number(offPlanResult.revenue_recognised_to_date))],
              ['This period', fmt(Number(offPlanResult.revenue_current_period))],
              ['Escrow', `Received ${fmt(escrowReceivedTotal)} | Released ${fmt(escrowReleasedTotal)} | Net ${fmt(escrowReceivedTotal - escrowReleasedTotal)}`],
              ['Remaining', fmt(Number(offPlanResult.remaining_revenue))],
            ].map(([k, v]) => {
              const isCert = k === 'Certificate';
              const certClass =
                v === '✓ Cert Verified'
                  ? 'border-green-200 bg-green-50'
                  : v === '⚠️ Mismatch'
                    ? 'border-amber-200 bg-amber-50'
                    : 'border-orange-100 bg-gradient-to-br from-orange-50 to-white';
              const inner = (
                <>
                  <p className="text-[10px] uppercase tracking-wide text-text-muted">{k}</p>
                  <p className="text-sm font-bold text-text-primary">{v}</p>
                </>
              );
              if (isCert) {
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() =>
                      document.getElementById('rera-certificate-section')?.scrollIntoView({ behavior: 'smooth' })
                    }
                    className={`rounded-lg p-3 border text-left w-full hover:opacity-90 ${certClass}`}
                  >
                    {inner}
                  </button>
                );
              }
              return (
                <div key={k} className="bg-gradient-to-br from-orange-50 to-white border border-orange-100 rounded-lg p-3">
                  {inner}
                </div>
              );
            })}
            <button
              type="button"
              onClick={() => setDisclosureOpen((o) => !o)}
              className={`rounded-lg p-3 border text-left transition-colors ${
                disclosureScoreColor(Number(fullReport?.disclosure_score) || 0)
              }`}
            >
              <p className="text-[10px] uppercase tracking-wide">Disclosure</p>
              <p className="text-sm font-bold">{Number(fullReport?.disclosure_score) || 0}/100</p>
            </button>
            <div
              className={`rounded-lg p-3 border ${
                pendingOqoodCount > 0
                  ? 'bg-red-100 text-red-800 border-red-300'
                  : 'bg-green-100 text-green-800 border-green-300'
              }`}
            >
              <p className="text-[10px] uppercase tracking-wide">Pending Oqood Filings</p>
              <p className="text-sm font-bold">{pendingOqoodCount}</p>
            </div>
          </div>
        )}

        {disclosureOpen && fullReport && (
          <section className="bg-white border border-border-default rounded-lg p-6">
            <h3 className="font-semibold mb-3">Disclosure gaps (IFRS 15.110–129)</h3>
            <ul className="text-sm space-y-2 max-h-48 overflow-y-auto">
              {((fullReport.disclosure_gaps as Record<string, string>[]) || []).map((g, i) => (
                <li key={i} className="border-l-2 border-orange-primary pl-2">
                  <span className="font-medium">{g.criterion}</span>: {g.gap}
                </li>
              ))}
            </ul>
          </section>
        )}

        {scheduleChart.length > 0 && (
          <section className="bg-white border border-border-default rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4">Quarterly revenue schedule</h2>
            <div className="h-56 mb-4">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={scheduleChart}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v: number) => fmt(Number(v))} />
                  <Legend />
                  <Line type="monotone" dataKey="revenue" stroke="#f97316" name="Period revenue" strokeWidth={2} />
                  <Line type="monotone" dataKey="cumulative" stroke="#64748b" name="Cumulative" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-text-muted">
                  <th className="py-2">Period</th>
                  <th>Completion %</th>
                  <th>Revenue</th>
                  <th>Cumulative</th>
                  <th>FTA</th>
                </tr>
              </thead>
              <tbody>
                {periodSchedule.map((row, i) => (
                  <tr key={i} className="border-b border-border-default">
                    <td className="py-2">{String(row.period)}</td>
                    <td>{String(row.completion_pct)}%</td>
                    <td>{fmt(Number(row.revenue_recognised))}</td>
                    <td>{fmt(Number(row.cumulative_revenue))}</td>
                    <td>{String(row.fta_filing_period)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {fullReport?.recognition_trigger_summary ? (
              <p className="text-sm text-text-secondary mt-4 p-3 bg-bg-light rounded border border-border-default">
                {String(fullReport.recognition_trigger_summary)}
                {(fullReport.recognition_trigger as Record<string, unknown>)?.trigger_warning ? (
                  <span className="block text-amber-700 mt-2 font-medium">
                    {String((fullReport.recognition_trigger as Record<string, unknown>).trigger_warning)}
                  </span>
                ) : null}
              </p>
            ) : null}
          </section>
        )}

        <section className="bg-white border border-border-default rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">Revenue recognition trigger</h2>
          <div className="flex flex-wrap gap-2 mb-4">
            {[
              ['rera_completion_certificate', 'RERA completion certificate'],
              ['spa_handover_date', 'SPA handover date'],
              ['earlier_of_both', 'Earlier of both'],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setRevTrigger(id as typeof revTrigger)}
                className={`px-3 py-1.5 rounded text-xs font-semibold border ${
                  revTrigger === id ? 'bg-orange-primary text-white border-orange-primary' : 'bg-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-4 max-w-lg">
            <label className="text-sm">
              <span className="text-text-muted block mb-1">RERA completion date</span>
              <input
                type="date"
                className="w-full border rounded px-3 py-2"
                value={reraCompletionDate}
                onChange={(e) => setReraCompletionDate(e.target.value)}
              />
            </label>
            <label className="text-sm">
              <span className="text-text-muted block mb-1">SPA handover date</span>
              <input
                type="date"
                className="w-full border rounded px-3 py-2"
                value={spaHandoverDate}
                onChange={(e) => setSpaHandoverDate(e.target.value)}
              />
            </label>
          </div>
          {triggerDateWarning ? (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-3 mt-3">
              RERA completion and SPA handover differ by {triggerDateWarning} days. Confirm revenue trigger with legal
              counsel per IFRS 15.38.
            </p>
          ) : null}

          <div id="rera-certificate-section" className="mt-6 pt-6 border-t border-border-default">
            <h3 className="text-sm font-semibold text-text-primary">RERA Completion Certificate (Optional)</h3>
            <p className="text-xs text-text-muted mt-1 mb-3">
              Upload the DLD-issued completion certificate to verify construction % and strengthen audit evidence.
            </p>
            {certFilename && (
              <p className="text-xs text-text-secondary mb-2">File: {certFilename}</p>
            )}
            {certManualNote && (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 mb-2">
                {certManualNote}
              </p>
            )}
            <label className="flex flex-col items-center justify-center border border-dashed border-border-default rounded-lg p-6 cursor-pointer hover:border-orange-primary">
              <input
                type="file"
                accept=".pdf,application/pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleCertUpload(f);
                }}
              />
              {certLoading ? (
                <div className="flex items-center gap-2 text-sm text-text-secondary">
                  <Loader2 className="w-5 h-5 animate-spin text-orange-primary" />
                  Extracting certificate data...
                </div>
              ) : (
                <span className="text-sm text-text-secondary">Upload RERA Completion Certificate (PDF, max 10MB)</span>
              )}
            </label>
            {certResult && (
              <RERACertificateCard
                result={certResult}
                formCompletionPct={costBasedCompletionPct}
                onUseCertificate={() => {
                  applyCertificateFromFields(certResult.fields, {
                    lowFields: certResult.low_confidence_fields,
                  });
                  setCertMismatchResolved('certificate');
                  setCertOverrideManual(false);
                  setCertManualNote(null);
                  toast.success('Using certificate completion %');
                }}
                onKeepManual={() => {
                  setCertMismatchResolved('manual');
                  setCertOverrideManual(true);
                  setReraCertificateVerifiedPct(null);
                  setCertManualNote(
                    'Manual % used — certificate on file for reference.'
                  );
                  toast('Keeping manual completion %', { icon: 'ℹ️' });
                }}
              />
            )}
          </div>
        </section>

        {/* 1. SPA Upload */}
        <section className="bg-white border border-border-default rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Upload className="w-5 h-5 text-orange-primary" /> Upload SPA
          </h2>
          {spaFilename && (
            <div className="flex items-center gap-2 mb-3 text-sm text-text-secondary">
              <FileText className="w-4 h-4" />
              <span>{spaFilename}</span>
              {languageBadgeLabel(
                extractionMeta?.language_detected,
                Boolean(extractionMeta?.warnings?.length && !extractionMeta?.fallback_triggered)
              ) && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                  {languageBadgeLabel(
                    extractionMeta?.language_detected,
                    Boolean(extractionMeta?.warnings?.length && !extractionMeta?.fallback_triggered)
                  )}
                </span>
              )}
              {extractionMeta &&
                !extractionMeta.fallback_triggered &&
                !extractionMeta.warnings?.length &&
                successBadgeLabel(extractionMeta.language_detected) && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                    {successBadgeLabel(extractionMeta.language_detected)}
                  </span>
                )}
            </div>
          )}
          {extractionMeta?.success === false && (
            <div
              className="mb-4 p-4 rounded-lg border border-red-300 bg-red-50 text-red-900 text-sm"
              role="alert"
            >
              <p className="font-semibold">PDF could not be read</p>
              <p className="mt-1">{extractionMeta.fallback_reason}</p>
            </div>
          )}
          {extractionMeta?.fallback_triggered && extractionMeta.success !== false && (
            <div
              className="mb-4 p-4 rounded-lg border border-amber-300 bg-amber-50 text-amber-950 text-sm"
              role="alert"
            >
              <p className="font-semibold">⚠️ Arabic PDF — Manual Entry Required</p>
              <hr className="my-2 border-amber-200" />
              <p>
                Language detected:{' '}
                {extractionMeta.language_detected === 'arabic'
                  ? 'Arabic'
                  : extractionMeta.language_detected === 'bilingual'
                    ? 'Bilingual'
                    : extractionMeta.language_detected || 'Unknown'}
              </p>
              <p>Extraction confidence: {Math.round((extractionMeta.confidence_score || 0) * 100)}%</p>
              <p className="mt-2">Could not reliably extract:</p>
              <ul className="list-disc list-inside">
                {(extractionMeta.low_confidence_fields || []).map((f) => (
                  <li key={f}>{lowConfidenceFieldLabel(f)}</li>
                ))}
              </ul>
              <hr className="my-2 border-amber-200" />
              <p>
                Please fill in the form fields below manually. Your PDF has been accepted — only auto-fill has
                been skipped to prevent incorrect data.
              </p>
            </div>
          )}
          {extractionMeta &&
            !extractionMeta.fallback_triggered &&
            (extractionMeta.warnings?.length ?? 0) > 0 && (
              <p className="mb-3 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-3">
                ⚠️ Partial extraction — please verify highlighted fields
              </p>
            )}
          {extractionMeta &&
            !extractionMeta.fallback_triggered &&
            !(extractionMeta.warnings?.length ?? 0) &&
            extractionMeta.success !== false &&
            spaExtracted && (
              <p className="mb-3 text-sm text-green-800 bg-green-50 border border-green-200 rounded p-3">
                ✓ SPA extracted successfully
              </p>
            )}
          <label className="flex flex-col items-center justify-center border-2 border-dashed border-border-default rounded-lg p-10 cursor-pointer hover:border-orange-primary transition-colors">
            <input
              type="file"
              accept=".pdf,.doc,.docx,.txt"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleSpaUpload(f);
              }}
            />
            {spaLoading ? (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="w-8 h-8 animate-spin text-orange-primary" />
                <span className="text-sm text-text-secondary">Detecting language and extracting fields...</span>
              </div>
            ) : (
              <>
                <FileText className="w-10 h-10 text-text-muted mb-2" />
                <span className="text-sm text-text-secondary">Drag & drop UAE Sale & Purchase Agreement (PDF)</span>
              </>
            )}
          </label>
          {spaExtracted && (
            <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              {['property_unit_number', 'buyer_name', 'developer_name', 'project_name', 'total_contract_price', 'handover_date'].map(
                (k) =>
                  spaExtracted[k] != null && (
                    <div key={k} className="bg-bg-light p-2 rounded">
                      <span className="text-text-muted block">{k.replace(/_/g, ' ')}</span>
                      <span className="font-medium">{String(spaExtracted[k])}</span>
                    </div>
                  )
              )}
            </div>
          )}
        </section>

        {/* 2. Off-plan calculator */}
        <section className="bg-white border border-border-default rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">Off-plan revenue calculator</h2>
          <label className="text-sm block mb-4 max-w-xs">
            <span className="text-text-muted block mb-1">
              Construction completion %
              {reraCertificateVerifiedPct != null && !certOverrideManual && certMismatchResolved !== 'manual' ? (
                <span className="ml-1 text-xs text-slate-600">📄 From RERA certificate</span>
              ) : null}
            </span>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly={
                  reraCertificateVerifiedPct != null &&
                  !certOverrideManual &&
                  certMismatchResolved !== 'manual'
                }
                className={`w-full rounded px-3 py-2 ${
                  reraCertificateVerifiedPct != null && !certOverrideManual && certMismatchResolved !== 'manual'
                    ? 'bg-slate-100 border border-slate-300 text-slate-700'
                    : 'border border-border-default'
                }`}
                value={completionPctLive.toFixed(1)}
                onChange={(e) => {
                  const pct = parseFloat(e.target.value) || 0;
                  const total = parseFloat(totalCosts) || 0;
                  if (total > 0) setCostsIncurred(String(Math.round((pct / 100) * total)));
                }}
              />
              {reraCertificateVerifiedPct != null && !certOverrideManual && certMismatchResolved !== 'manual' ? (
                <button
                  type="button"
                  className="text-xs text-orange-primary whitespace-nowrap underline"
                  onClick={() => {
                    setCertOverrideManual(true);
                    setReraCertificateVerifiedPct(null);
                    toast('Overriding certificate — manual input method applies', { icon: '⚠️' });
                  }}
                >
                  Override
                </button>
              ) : null}
            </div>
            {reraCertificateVerifiedPct != null && !certOverrideManual && certMismatchResolved !== 'manual' ? (
              <p className="text-[11px] text-amber-700 mt-1">
                Overriding will use manual input instead of RERA certificate.
              </p>
            ) : null}
          </label>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {(
              [
                ['Contract value (AED)', contractValue, setContractValue, undefined, 'contract_price_aed'],
                ['Costs incurred', costsIncurred, setCostsIncurred],
                ['Total estimated costs', totalCosts, setTotalCosts],
                ['Revenue prior period', revenuePrior, setRevenuePrior],
                ['Construction start', constructionStart, setConstructionStart, 'date'],
                ['Expected handover', expectedHandover, setExpectedHandover, 'date', 'handover_date'],
                ['Current date', currentDate, setCurrentDate, 'date'],
              ] as const
            ).map((row) => {
              const label = row[0];
              const val = row[1];
              const setVal = row[2];
              const type = row[3];
              const verifyKey = row.length > 4 ? row[4] : undefined;
              const highlight = verifyKey ? isVerifyHighlight(verifyKey) : false;
              return (
                <label key={String(label)} className="text-sm">
                  <span className="text-text-muted block mb-1">{label}</span>
                  <input
                    type={(type as string) || 'text'}
                    className={`w-full rounded px-3 py-2 ${fieldVerifyClass(highlight)}`}
                    value={val as string}
                    onChange={(e) => {
                      (setVal as (v: string) => void)(e.target.value);
                      if (verifyKey) markFieldVerified(verifyKey);
                    }}
                  />
                  {highlight ? <p className="text-xs text-amber-700 mt-1">⚠️ Please verify</p> : null}
                </label>
              );
            })}
          </div>
          {offPlanResult && (
            <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                ['Completion %', `${offPlanResult.completion_pct}%`],
                ['Revenue to date', fmt(Number(offPlanResult.revenue_recognised_to_date))],
                ['Current period', fmt(Number(offPlanResult.revenue_current_period))],
                ['Contract asset', fmt(Number(offPlanResult.contract_asset))],
                ['Contract liability', fmt(Number(offPlanResult.contract_liability))],
                ['Escrow balance', fmt(Number(offPlanResult.escrow_balance))],
                ['Remaining revenue', fmt(Number(offPlanResult.remaining_revenue))],
                ['Handover', String(offPlanResult.estimated_handover)],
              ].map(([k, v]) => (
                <div key={k} className="bg-orange-50 border border-orange-100 rounded p-3">
                  <p className="text-xs text-text-muted">{k}</p>
                  <p className="font-semibold text-text-primary">{v}</p>
                </div>
              ))}
            </div>
          )}
          {(offPlanResult?.journal_entries as Record<string, unknown>[])?.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-text-muted">
                    <th className="py-2">Dr</th>
                    <th>Cr</th>
                    <th>Amount</th>
                    <th>Narrative</th>
                  </tr>
                </thead>
                <tbody>
                  {(offPlanResult.journal_entries as Record<string, unknown>[]).map((j, i) => (
                    <tr key={i} className="border-b border-border-default">
                      <td className="py-2">{String(j.dr)}</td>
                      <td>{String(j.cr)}</td>
                      <td>{fmt(Number(j.amount))}</td>
                      <td className="text-text-secondary">{String(j.narrative)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* 3. RERA Escrow */}
        <section className="bg-white border border-border-default rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">RERA escrow timeline</h2>
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <p className="text-xs font-semibold text-text-muted mb-2">Escrow receipts</p>
              {escrowReceipts.map((r, i) => (
                <div key={i} className="flex gap-2 mb-2">
                  <input type="date" className="border rounded px-2 py-1 text-sm flex-1" value={r.date} onChange={(e) => {
                    const next = [...escrowReceipts];
                    next[i] = { ...next[i], date: e.target.value };
                    setEscrowReceipts(next);
                  }} />
                  <input type="number" className="border rounded px-2 py-1 text-sm w-28" value={r.amount} onChange={(e) => {
                    const next = [...escrowReceipts];
                    next[i] = { ...next[i], amount: e.target.value };
                    setEscrowReceipts(next);
                  }} />
                  <button type="button" onClick={() => setEscrowReceipts(escrowReceipts.filter((_, j) => j !== i))} className="text-red-500">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              <button type="button" className="text-xs text-orange-primary flex items-center gap-1" onClick={() => setEscrowReceipts([...escrowReceipts, { date: '', amount: '' }])}>
                <Plus className="w-3 h-3" /> Add receipt
              </button>
            </div>
            <div>
              <p className="text-xs font-semibold text-text-muted mb-2">Milestone releases</p>
              {milestones.map((m, i) => (
                <div key={i} className="flex gap-2 mb-2 flex-wrap">
                  <input placeholder="Milestone" className="border rounded px-2 py-1 text-sm flex-1 min-w-[100px]" value={m.milestone} onChange={(e) => {
                    const next = [...milestones];
                    next[i] = { ...next[i], milestone: e.target.value };
                    setMilestones(next);
                  }} />
                  <input placeholder="%" className="border rounded px-2 py-1 text-sm w-16" value={m.completion_pct_required} onChange={(e) => {
                    const next = [...milestones];
                    next[i] = { ...next[i], completion_pct_required: e.target.value };
                    setMilestones(next);
                  }} />
                  <input placeholder="AED" className="border rounded px-2 py-1 text-sm w-24" value={m.amount_released} onChange={(e) => {
                    const next = [...milestones];
                    next[i] = { ...next[i], amount_released: e.target.value };
                    setMilestones(next);
                  }} />
                </div>
              ))}
            </div>
          </div>
          <div className="mt-5">
            <p className="text-xs font-semibold text-text-muted mb-2">Escrow Releases (Disbursements to Developer)</p>
            {escrowReleases.map((r, i) => (
              <div key={i} className="grid grid-cols-5 gap-2 mb-2">
                <input type="date" className="border rounded px-2 py-1 text-sm" value={r.date} onChange={(e) => {
                  const next = [...escrowReleases];
                  next[i] = { ...next[i], date: e.target.value };
                  setEscrowReleases(next);
                }} />
                <input placeholder="Amount (AED)" className="border rounded px-2 py-1 text-sm" value={r.amount} onChange={(e) => {
                  const next = [...escrowReleases];
                  next[i] = { ...next[i], amount: e.target.value };
                  setEscrowReleases(next);
                }} />
                <input placeholder="Release %" className="border rounded px-2 py-1 text-sm" value={r.release_pct} onChange={(e) => {
                  const next = [...escrowReleases];
                  next[i] = { ...next[i], release_pct: e.target.value };
                  setEscrowReleases(next);
                }} />
                <input placeholder="Milestone" className="border rounded px-2 py-1 text-sm" value={r.milestone_description} onChange={(e) => {
                  const next = [...escrowReleases];
                  next[i] = { ...next[i], milestone_description: e.target.value };
                  setEscrowReleases(next);
                }} />
                <input placeholder="RERA Approval Ref" className="border rounded px-2 py-1 text-sm" value={r.rera_approval_ref || ''} onChange={(e) => {
                  const next = [...escrowReleases];
                  next[i] = { ...next[i], rera_approval_ref: e.target.value };
                  setEscrowReleases(next);
                }} />
              </div>
            ))}
            <button type="button" className="text-xs text-orange-primary flex items-center gap-1" onClick={() => setEscrowReleases([...escrowReleases, { date: '', amount: '', release_pct: '', milestone_description: '', rera_approval_ref: '' }])}>
              <Plus className="w-3 h-3" /> Add Release
            </button>
            <p className="text-xs mt-2 text-text-secondary">
              Total Released: {fmt(escrowReleasedTotal)} ({escrowReleasePctLive.toFixed(2)}%)
            </p>
            {previewReleaseViolation ? (
              <p className="text-xs mt-2 text-red-700 font-semibold">
                ⛔ Release exceeds completion % — will be blocked on submission
              </p>
            ) : null}
          </div>
          {timelineChart.length > 0 && (
            <div className="h-64 mt-6">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={timelineChart}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <Legend />
                  <Bar dataKey="escrow" fill="#f97316" name="Escrow in" />
                  <Bar dataKey="released" fill="#94a3b8" name="Released" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        {/* 4. Modifications */}
        <section className="bg-white border border-border-default rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">Contract modifications</h2>
          <div className="flex flex-wrap gap-3 mb-4">
            {['price_change', 'unit_swap', 'cancellation', 'extension'].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setModType(t)}
                className={`px-3 py-1.5 rounded text-xs font-semibold border ${
                  modType === t ? 'bg-orange-primary text-white border-orange-primary' : 'bg-white border-border-default'
                }`}
              >
                {t.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <label className="text-sm">
              <span className="text-text-muted block mb-1">New price</span>
              <input className="w-full border rounded px-3 py-2" value={modNewPrice} onChange={(e) => setModNewPrice(e.target.value)} />
            </label>
            <label className="text-sm">
              <span className="text-text-muted block mb-1">Refund (cancellation)</span>
              <input className="w-full border rounded px-3 py-2" value={modRefund} onChange={(e) => setModRefund(e.target.value)} />
            </label>
            <label className="text-sm">
              <span className="text-text-muted block mb-1">New handover date</span>
              <input type="date" className="w-full border rounded px-3 py-2" value={modNewDate} onChange={(e) => setModNewDate(e.target.value)} />
            </label>
          </div>
          <Button variant="secondary" onClick={runModification}>Assess modification</Button>
          {modLog.length > 0 && (
            <ul className="mt-4 space-y-2 text-sm">
              {modLog.map((m) => (
                <li key={m.id} className="border-l-4 border-orange-primary pl-3 py-1">
                  <span className="font-medium">{m.type}</span> — {m.treatment}
                  {m.adjustment !== 0 && ` · ${fmt(m.adjustment ?? 0)}`}
                  <p className="text-text-muted text-xs">{m.narrative}</p>
                  {m.oqood_assessment?.requires_oqood_amendment ? (
                    <div className="mt-2 p-3 rounded border border-amber-300 bg-amber-50">
                      <p className="font-semibold text-amber-900">⚠️ Oqood Amendment Required — DLD</p>
                      <p className="text-xs text-amber-900 mt-1">{String(m.oqood_assessment.warning_message || '')}</p>
                      <div className="mt-2 text-xs font-semibold inline-block bg-amber-200 text-amber-900 px-2 py-1 rounded">
                        AED 2,000 Amendment Fee
                      </div>
                      <p className="text-xs mt-2">
                        Treatment:{' '}
                        {String(m.oqood_assessment.ifrs15_modification_type || '') === 'new_contract'
                          ? 'New Contract'
                          : 'Modify Existing'}
                      </p>
                      <ol className="text-xs mt-2 list-decimal pl-4 whitespace-pre-line">
                        {String(m.oqood_assessment.action_required || '')
                          .split('\n')
                          .map((step, idx) => (
                            <li key={idx}>{step.replace(/^\d+\.\s*/, '')}</li>
                          ))}
                      </ol>
                      <p className="text-[11px] mt-2 text-text-muted">Dubai Law No. 13 of 2008, Art. 3</p>
                      <label className="text-xs mt-2 inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={Boolean(m.oqood_assessment?.oqood_filed)}
                          onChange={(e) => setOqoodFiled(m.id, e.target.checked)}
                        />
                        ✓ Oqood amendment filed with DLD
                      </label>
                    </div>
                  ) : (
                    <p className="text-xs text-green-700 mt-1">
                      ✓ No Oqood amendment required for this modification type. Treatment:{' '}
                      {String(m.oqood_assessment?.ifrs15_modification_type || m.treatment || '')}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-6 border-t border-border-default pt-6">
            <button
              type="button"
              className="text-sm font-semibold text-text-primary flex items-center gap-2"
              onClick={() => setCancelOpen((o) => !o)}
            >
              {cancelOpen ? '▼' : '▶'} Cancellation Refund Calculator (Law 8/2007)
            </button>
            {cancelOpen && (
              <div className="mt-4 space-y-4">
                <span className="inline-block text-xs font-bold bg-slate-800 text-white px-2 py-1 rounded">
                  UAE Law No. 8 of 2007 — Article 11
                </span>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <label className="text-sm">
                    <span className="text-text-muted block mb-1">Cancellation reason</span>
                    <select
                      className="w-full border rounded px-3 py-2"
                      value={cancelReason}
                      onChange={(e) => setCancelReason(e.target.value)}
                    >
                      <option value="buyer_default">Buyer default</option>
                      <option value="developer_default">Developer default</option>
                      <option value="mutual_agreement">Mutual agreement</option>
                    </select>
                  </label>
                  <label className="text-sm">
                    <span className="text-text-muted block mb-1">Amount paid by buyer</span>
                    <input
                      className="w-full border rounded px-3 py-2"
                      value={amountPaidBuyer}
                      onChange={(e) => setAmountPaidBuyer(e.target.value)}
                    />
                  </label>
                  <label className="text-sm">
                    <span className="text-text-muted block mb-1">Escrow balance</span>
                    <input
                      className="w-full border rounded px-3 py-2"
                      value={cancelEscrowBal}
                      onChange={(e) => setCancelEscrowBal(e.target.value)}
                    />
                  </label>
                </div>
                <Button variant="secondary" onClick={runCancellationRefund} disabled={cancelLoading}>
                  {cancelLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Calculate refund waterfall
                </Button>
                {cancelResult && (
                  <div className="grid md:grid-cols-2 gap-4 text-sm">
                    <div className="space-y-1">
                      <p>Developer retention: <strong>{fmt(Number(cancelResult.developer_retention_amount))}</strong></p>
                      <p>Buyer refund: <strong>{fmt(Number(cancelResult.buyer_refund_amount))}</strong></p>
                      <p>Escrow → buyer: {fmt(Number(cancelResult.escrow_release_to_buyer))}</p>
                      <p>Escrow → developer: {fmt(Number(cancelResult.escrow_release_to_developer))}</p>
                      <p>IFRS 15 revenue reversal: {fmt(Number(cancelResult.ifrs15_revenue_reversal))}</p>
                    </div>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-text-muted">
                          <th>Dr</th>
                          <th>Cr</th>
                          <th>Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {((cancelResult.journal_entries as Record<string, unknown>[]) || []).map((j, i) => (
                          <tr key={i}>
                            <td>{String(j.dr)}</td>
                            <td>{String(j.cr)}</td>
                            <td>{fmt(Number(j.amount))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* 5. Contract costs */}
        <section className="bg-white border border-border-default rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">Costs to obtain contracts</h2>
          <div className="grid grid-cols-2 gap-4 max-w-md">
            <label className="text-sm">
              <span className="text-text-muted block mb-1">Commission paid (AED)</span>
              <input className="w-full border rounded px-3 py-2" value={commissionPaid} onChange={(e) => setCommissionPaid(e.target.value)} />
            </label>
            <label className="text-sm">
              <span className="text-text-muted block mb-1">Amortisation (months)</span>
              <input className="w-full border rounded px-3 py-2" value={amortMonths} onChange={(e) => setAmortMonths(e.target.value)} />
            </label>
          </div>
          <Button className="mt-4" variant="secondary" onClick={runContractCosts}>Calculate commission asset</Button>
          {costsResult && (
            <div className="mt-4 text-sm grid grid-cols-2 gap-3">
              <p>Capitalise: <strong>{costsResult.capitalise ? 'Yes' : 'No'}</strong></p>
              <p>Asset: {fmt(Number(costsResult.asset_recognised))}</p>
              <p>Monthly amort: {fmt(Number(costsResult.monthly_amortisation))}</p>
            </div>
          )}
        </section>

        {/* 6. Principal vs Agent */}
        <section className="bg-white border border-border-default rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">Principal vs agent</h2>
          <div className="grid md:grid-cols-2 gap-4">
            {[
              ['controls_before_transfer', 'Controls property before transfer?', paControls, setPaControls],
              ['inventory_risk', 'Bears inventory / completion risk?', paInventory, setPaInventory],
              ['pricing_discretion', 'Sets the price?', paPricing, setPaPricing],
              ['credit_risk', 'Accepts buyer credit risk?', paCredit, setPaCredit],
            ].map(([key, label, val, setVal]) => (
              <div key={key as string}>
                <p className="text-xs text-text-muted mb-1">{label as string}</p>
                <div className="flex gap-2">
                  {['developer', 'agent'].map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => (setVal as (v: string) => void)(p)}
                      className={`px-3 py-1 rounded text-xs border ${
                        val === p ? 'bg-slate-700 text-white' : 'bg-white'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <Button className="mt-4" variant="secondary" onClick={runPrincipalAgent}>Run assessment</Button>
          {paResult && (
            <div className="mt-4 p-4 bg-bg-light rounded">
              <p className="font-bold text-lg">{String(paResult.conclusion)} — {String(paResult.revenue_basis)}</p>
              <p className="text-sm text-text-secondary mt-2">{String(paResult.assessment)}</p>
            </div>
          )}
        </section>

        {/* 7. VAT */}
        <section className="bg-white border border-border-default rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">VAT timing alignment (5%)</h2>
          {vatRows.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-text-muted">
                  <th className="py-2">Period</th>
                  <th>Revenue recognised</th>
                  <th>VAT @ 5%</th>
                  <th>FTA filing</th>
                </tr>
              </thead>
              <tbody>
                {vatRows.map((row, i) => (
                  <tr key={i} className="border-b">
                    <td className="py-2">{String(row.period)}</td>
                    <td>{fmt(Number(row.revenue_recognised))}</td>
                    <td>{fmt(Number(row.vat_5pct))}</td>
                    <td>{String(row.fta_filing_period)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-text-muted">Run recognition to generate VAT alignment from revenue schedule.</p>
          )}
        </section>

        <section className="bg-white border border-border-default rounded-lg p-6">
          <button
            type="button"
            className="text-lg font-semibold flex items-center gap-2"
            onClick={() => setBundlingOpen((o) => !o)}
          >
            {bundlingOpen ? '▼' : '▶'} Multi-Unit Bundling Check (IFRS 15 Para 17)
          </button>
          {bundlingOpen && (
            <div className="mt-4 space-y-4">
              <p className="text-xs text-text-muted">
                If the same buyer has purchased multiple units in this development, IFRS 15 para 17 may require combining these contracts.
              </p>
              {unitRows.map((row, i) => (
                <div key={i} className="grid grid-cols-2 md:grid-cols-5 gap-2">
                  {[
                    'contract_id',
                    'unit_number',
                    'unit_type',
                    'contract_price_aed',
                    'contract_date',
                    'completion_pct',
                    'costs_incurred_aed',
                    'buyer_name',
                    'buyer_id',
                  ].map((k) => (
                    <input
                      key={k}
                      className="border rounded px-2 py-1 text-xs"
                      value={row[k] || ''}
                      onChange={(e) =>
                        setUnitRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [k]: e.target.value } : r)))
                      }
                      placeholder={k}
                    />
                  ))}
                </div>
              ))}
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() =>
                    setUnitRows((prev) => [
                      ...prev,
                      {
                        contract_id: '',
                        unit_number: '',
                        unit_type: 'apartment',
                        contract_price_aed: '',
                        contract_date: '',
                        completion_pct: '',
                        costs_incurred_aed: '',
                        buyer_name: '',
                        buyer_id: '',
                      },
                    ])
                  }
                >
                  Add Unit
                </Button>
                <Button variant="secondary" onClick={runBundlingCheck} disabled={bundlingLoading}>
                  {bundlingLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Run Bundling Check
                </Button>
              </div>
              {bundlingResult?.should_bundle ? (
                <div className="p-4 border border-amber-300 bg-amber-50 rounded">
                  <p className="font-semibold text-amber-900">⚠️ IFRS 15 Para 17 — Bundling Required</p>
                  <p className="text-xs mt-2">{String(bundlingResult.recommendation || '')}</p>
                  <p className="text-xs mt-1">Risk: {String(bundlingResult.audit_risk_level || '').toUpperCase()}</p>
                  <table className="w-full text-xs mt-3">
                    <thead>
                      <tr>
                        <th className="text-left">Contract</th>
                        <th className="text-left">Price</th>
                        <th className="text-left">Completion%</th>
                        <th className="text-left">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {((bundlingResult.individual_schedules as Record<string, unknown>[]) || []).map((u, i) => (
                        <tr key={i}>
                          <td>{String(u.contract_id)}</td>
                          <td>{fmt(Number(u.contract_price_aed))}</td>
                          <td>{String(u.completion_pct)}%</td>
                          <td>{fmt(Number(u.revenue_recognised_aed))}</td>
                        </tr>
                      ))}
                      <tr className="font-semibold">
                        <td>Combined</td>
                        <td>{fmt(Number(bundlingResult.combined_transaction_price_aed))}</td>
                        <td>{String(bundlingResult.combined_completion_pct)}%</td>
                        <td>{fmt(Number(bundlingResult.combined_revenue_recognised_aed))}</td>
                      </tr>
                    </tbody>
                  </table>
                  <Button className="mt-3" onClick={syncToMainSchedule}>
                    Apply Combined Schedule → Sync to IFRS 15
                  </Button>
                </div>
              ) : bundlingResult ? (
                <div className="p-4 border border-green-300 bg-green-50 rounded text-green-800 text-sm">
                  ✓ No bundling required based on current data. Continue monitoring if buyer purchases additional units.
                </div>
              ) : null}
            </div>
          )}
        </section>

        <p className="text-xs text-text-muted text-center">
          Results feed the main IFRS 15 recognition schedule — export via{' '}
          <Link href="/dashboard/ifrs15" className="text-orange-primary underline">IFRS 15 dashboard</Link>.
        </p>
        {blockedModal ? (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center">
            <div className="bg-white rounded-lg border p-6 max-w-md w-full">
              <h3 className="text-lg font-semibold mb-2">{blockedModal.title}</h3>
              <p className="text-sm text-text-secondary mb-4">{blockedModal.body}</p>
              <Button onClick={() => setBlockedModal(null)}>Back to Form</Button>
            </div>
          </div>
        ) : null}
      </div>
    </SidebarLayout>
  );
}
