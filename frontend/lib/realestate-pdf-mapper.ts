/**
 * Map last recognition report + form state → RealEstatePDFInput for client PDF API.
 */

import { applyQuarterlyScheduleTotals } from '@/lib/realestate-format';

export type RealEstatePDFInputPayload = Record<string, unknown>;

export type PDFModalInputs = {
  reportingPeriod: string;
  reportDate: string;
  currency: 'AED' | 'USD';
};

export type PDFFormState = {
  projectName: string;
  developerName: string;
  reraNumber: string;
  revTrigger: string;
  reraCompletionDate: string;
  spaHandoverDate: string;
  contractValue: string;
  escrowReceipts: { amount: string }[];
  escrowReleases: { amount: string }[];
  completionPctLive: number;
  reraCertificateRef: string | null;
  reraCertificateDate: string | null;
  reraCertificateVerifiedPct: number | null;
  certResult: { confidence_score?: number } | null;
  certMismatchResolved: string | null;
  certOverrideManual: boolean;
  cancelResult: Record<string, unknown> | null;
  deadlineTracker?: Record<string, unknown> | null;
  spaExecutionDate?: string;
  revenuePrior?: string;
};

function currentQuarterLabel(): string {
  const d = new Date();
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `Q${q} ${d.getFullYear()}`;
}

export function mapReportToPDFInput(
  report: Record<string, unknown>,
  form: PDFFormState,
  modal: PDFModalInputs
): RealEstatePDFInputPayload {
  const off = (report.off_plan as Record<string, unknown>) || {};
  const vat = (report.vat as Record<string, unknown>) || {};
  const trig = (report.recognition_trigger as Record<string, unknown>) || {};
  const hv = (report.health_validation as Record<string, unknown>) || {};
  const escVal = (report.escrow_validation as Record<string, unknown>) || {};
  const cert = (report.rera_certificate as Record<string, unknown>) || {};

  const escrowReceived = form.escrowReceipts.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
  const escrowReleased = form.escrowReleases.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);

  const violation = Boolean(escVal.is_violation);
  const certVerified =
    form.reraCertificateVerifiedPct != null &&
    !form.certOverrideManual &&
    form.certMismatchResolved !== 'manual';

  const gapsRaw = (report.disclosure_gaps as Record<string, string>[]) || [];
  const disclosureGaps = gapsRaw.map((g) => {
    const crit = g.criterion || '';
    const gap = g.gap || '';
    return crit ? `${crit}: ${gap}` : gap;
  });

  const scheduleResult = applyQuarterlyScheduleTotals(
    (report.period_schedule as Record<string, unknown>[]) || [],
    {
      spaExecutionDate: form.spaExecutionDate,
      revenueToDate: Number(off.revenue_recognised_to_date) || 0,
      revenuePrior:
        parseFloat(form.revenuePrior || '') ||
        Number(report.revenue_prior_period) ||
        0,
      revenueCurrent: Number(off.revenue_current_period) || 0,
    }
  );
  const schedule = scheduleResult.schedule.map((row) => ({
    quarter: row.period || row.quarter,
    completion_pct: row.completion_pct,
    revenue: row.revenue_recognised,
    cumulative_revenue: row.cumulative_revenue,
    vat: row.vat_5pct ?? (Number(row.revenue_recognised) || 0) * 0.05,
    status: 'Recognised',
  }));

  const completionSource =
    report.completion_source === 'rera_certificate' || certVerified
      ? 'RERA Certificate'
      : 'Manual Input';

  const spa = (report.spa as Record<string, unknown>) || {};

  return {
    project_name: form.projectName.trim() || 'Unnamed Project',
    developer_name:
      String(spa.developer_name || (report.ifrs15_calculate_payload as Record<string, unknown>)?.vendor_name || 'Developer'),
    rera_registration_number: form.reraNumber.trim() || 'N/A',
    report_date: modal.reportDate.slice(0, 10),
    reporting_period: modal.reportingPeriod || currentQuarterLabel(),
    currency: modal.currency === 'USD' ? 'USD' : 'AED',

    contract_price: Number(report.contract_value) || parseFloat(form.contractValue) || 0,
    completion_pct: Number(off.completion_pct) || form.completionPctLive,
    completion_source: completionSource,
    rera_certificate_ref: form.reraCertificateRef || cert.ref || null,
    rera_certificate_date: form.reraCertificateDate || cert.date || null,
    revenue_recognition_trigger: form.revTrigger,
    rera_completion_date: form.reraCompletionDate || trig.rera_completion_date || null,
    spa_handover_date: form.spaHandoverDate || trig.spa_handover_date || null,
    trigger_warning: trig.trigger_warning || null,
    recognition_trigger_summary: String(report.recognition_trigger_summary || ''),

    revenue_recognised: Number(off.revenue_recognised_to_date) || 0,
    deferred_revenue: Number(off.contract_liability) || 0,
    contract_asset: Number(off.contract_asset) || 0,
    vat_amount: Number(vat.total_vat) || 0,
    remaining_performance_obligation: Number(off.remaining_revenue) || 0,

    total_escrow_received: escrowReceived,
    total_escrow_released: escrowReleased,
    net_escrow_balance: escrowReceived - escrowReleased,
    escrow_compliance_status: violation ? 'VIOLATION' : 'Compliant',

    quarterly_schedule: schedule,
    health_checks: hv,
    disclosure_score: Number(report.disclosure_score) || 0,
    disclosure_gaps: disclosureGaps,
    oqood_assessments: (report.oqood_assessments as Record<string, unknown>[]) || [],
    cancellation_summary: form.cancelResult || (report.cancellation_refund as Record<string, unknown>) || null,
    rera_certificate_verified: certVerified,
    rera_certificate_confidence: form.certResult?.confidence_score ?? null,
    journal_entries: (off.journal_entries as Record<string, unknown>[]) || [],
    deadline_tracker: form.deadlineTracker || (report.deadline_tracker as Record<string, unknown>) || null,
  };
}
