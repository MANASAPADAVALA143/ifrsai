import { getDefaultIfrs16Country, getDefaultIfrs16Currency } from './ifrs16-currency';

export type ExtractionConfidenceMap = Record<string, number>;

export type LeaseExtractionResult = {
  formPatch: Record<string, unknown>;
  confidences: ExtractionConfidenceMap;
  tabsWithData: Set<string>;
  contractData: Record<string, unknown> | null;
  fieldCount: number;
  avgConfidence: number;
};

function getVal(obj: unknown): unknown {
  if (obj == null) return null;
  if (typeof obj === 'object' && obj !== null && 'value' in obj) {
    return (obj as { value: unknown }).value;
  }
  return obj;
}

function getConf(obj: unknown): number | undefined {
  if (obj != null && typeof obj === 'object' && 'confidence' in obj) {
    const c = Number((obj as { confidence: unknown }).confidence);
    return Number.isFinite(c) ? c : undefined;
  }
  return undefined;
}

function dig(data: unknown, ...path: string[]): unknown {
  let cur: unknown = data;
  for (const p of path) {
    if (cur == null || typeof cur !== 'object') return null;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function setConf(map: ExtractionConfidenceMap, field: string, obj: unknown, hasValue: boolean) {
  const c = getConf(obj);
  if (hasValue && c != null) map[field] = c;
}

function parseDiscountRate(raw: unknown): string {
  if (raw == null || raw === '') return '';
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return '';
  return String(n > 1 ? n : n * 100);
}

function inferEscalation(escalationText: string): { type: string; value: string } {
  const t = escalationText.toLowerCase();
  if (!t.trim()) return { type: 'None', value: '' };
  const pct = t.match(/(\d+(?:\.\d+)?)\s*%/);
  const pctVal = pct ? pct[1] : '';
  if (
    t.includes('step-up') ||
    t.includes('step up') ||
    t.includes('increase') ||
    t.includes('escalat') ||
    pct
  ) {
    if (pct) return { type: 'Percentage', value: pctVal };
  }
  if (t.includes('cpi') || t.includes('consumer price') || t.includes('index')) {
    return { type: 'CPI Linked', value: pctVal };
  }
  return { type: 'None', value: '' };
}

function inferRentFreeMonths(...texts: string[]): number {
  for (const text of texts) {
    const t = text.toLowerCase();
    const m = t.match(/(\d+)\s*month[s]?\s*(?:rent[- ]?free|free)/);
    if (m) return parseInt(m[1], 10) || 0;
    const m2 = t.match(/rent[- ]?free[^.]{0,40}?(\d+)\s*month/);
    if (m2) return parseInt(m2[1], 10) || 0;
    const m3 = t.match(/(\d+)\s*month/);
    if (m3 && (t.includes('rent free') || t.includes('rent-free'))) {
      return parseInt(m3[1], 10) || 0;
    }
    if (t.includes('rent free') || t.includes('rent-free')) {
      if (t.includes('two') || t.includes('2 ')) return 2;
      if (t.includes('three') || t.includes('3 ')) return 3;
      if (t.includes('one') || t.includes('1 ')) return 1;
    }
  }
  return 0;
}

/** Map raw extractor JSON (nested confidence objects) to lease form fields. */
export function buildLeaseExtractionResult(raw: unknown): LeaseExtractionResult {
  const extractedBlob =
    raw != null && typeof raw === 'object' && 'extracted_data' in (raw as object)
      ? (raw as { extracted_data: unknown }).extracted_data
      : raw;

  const data =
    extractedBlob != null && typeof extractedBlob === 'object' && !Array.isArray(extractedBlob)
      ? (extractedBlob as Record<string, unknown>)
      : {};

  const confidences: ExtractionConfidenceMap = {};
  const top = raw != null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

  const lesseeObj = dig(data, 'basic_info', 'lessee_name');
  const lessorObj = dig(data, 'basic_info', 'lessor_name');
  const assetObj = dig(data, 'basic_info', 'asset_description');
  const leaseTypeObj = dig(data, 'basic_info', 'lease_type');
  const startObj = dig(data, 'dates', 'commencement_date');
  const endObj = dig(data, 'dates', 'end_date');
  const termObj = dig(data, 'dates', 'lease_term_months');
  const monthlyObj = dig(data, 'payments', 'monthly_amount');
  const currencyObj = dig(data, 'payments', 'currency');
  const freqObj = dig(data, 'payments', 'payment_frequency');
  const payTypeObj = dig(data, 'payments', 'payment_type');
  const escalationObj = dig(data, 'payments', 'escalation_clause');
  const rentFreeObj = dig(data, 'payments', 'rent_free_months');
  const nonLeaseObj = dig(data, 'payments', 'non_lease_component');
  const nonLeaseDescObj = dig(data, 'payments', 'non_lease_description');
  const discountObj = dig(data, 'discount_rate', 'stated_rate');
  const idcTotalObj = dig(data, 'initial_costs', 'total');
  const legalObj = dig(data, 'initial_costs', 'legal_fees');
  const brokerObj = dig(data, 'initial_costs', 'broker_fees');
  const renewalObj = dig(data, 'options', 'renewal_options');
  const terminationObj = dig(data, 'options', 'termination_clause');
  const indexLinkedObj = dig(data, 'remeasurement_triggers', 'index_linked');

  const startDateRaw = getVal(startObj) ?? top.commencement_date ?? top.start_date;
  const endDateRaw = getVal(endObj) ?? top.end_date;
  const startDate = startDateRaw != null ? String(startDateRaw).slice(0, 10) : '';
  const endDate = endDateRaw != null ? String(endDateRaw).slice(0, 10) : '';

  const lessee = String(getVal(lesseeObj) ?? top.lessee ?? top.lessee_name ?? '').trim();
  const lessor = String(getVal(lessorObj) ?? top.lessor ?? top.lessor_name ?? '').trim();
  const assetDescription = String(getVal(assetObj) ?? top.asset_description ?? top.title ?? '').trim();
  const title = assetDescription;
  const leaseType = String(getVal(leaseTypeObj) ?? top.lease_type ?? top.asset_type ?? '').trim();
  const baseRentAmount =
    getVal(monthlyObj) ?? top.monthly_payment ?? top.base_rent_amount ?? '';
  const currency = String(
    getVal(currencyObj) ?? top.currency ?? getDefaultIfrs16Currency()
  ).trim();
  const paymentFrequency = String(getVal(freqObj) ?? top.payment_frequency ?? 'Monthly');
  const paymentType = String(getVal(payTypeObj) ?? top.payment_type ?? 'Arrears');
  const discountRate = parseDiscountRate(getVal(discountObj) ?? top.discount_rate ?? top.ibr);
  const leaseTermMonths = getVal(termObj) ?? top.lease_term_months ?? '';
  const initialDirectCosts = getVal(idcTotalObj) ?? top.initial_direct_costs ?? '';
  const legalFees = getVal(legalObj) ?? top.legal_fees ?? '';
  const brokerageFees = getVal(brokerObj) ?? top.brokerage_fees ?? '';
  const renewalOptions = String(getVal(renewalObj) ?? top.renewal_options ?? '').trim();
  const terminationClauses = String(getVal(terminationObj) ?? top.termination_clauses ?? '').trim();
  const description = assetDescription;
  const country = String(
    getVal(dig(data, 'basic_info', 'country')) ??
      top.country ??
      getDefaultIfrs16Country()
  ).trim();
  const city = String(getVal(dig(data, 'basic_info', 'city')) ?? top.city ?? '').trim();
  const location = String(
    getVal(dig(data, 'basic_info', 'location')) ??
      getVal(dig(data, 'basic_info', 'premises')) ??
      top.location ??
      top.address ??
      ''
  ).trim();

  const escalationText = String(getVal(escalationObj) ?? '');
  const { type: escalationType, value: escalationValue } = inferEscalation(escalationText);
  const cpiAdjustments = Boolean(getVal(indexLinkedObj)) || escalationType === 'CPI Linked';
  const rentFreeFromField = Math.max(0, parseInt(String(getVal(rentFreeObj) ?? '0'), 10) || 0);
  const rentFreeMonths =
    rentFreeFromField ||
    inferRentFreeMonths(
      String(getVal(rentFreeObj) ?? ''),
      escalationText,
      String(getVal(dig(data, 'payments', 'variable_payments')) ?? ''),
      String(getVal(dig(data, 'payments', 'lease_incentives')) ?? '')
    );
  const nonLeaseComponent = getVal(nonLeaseObj) ?? top.non_lease_component ?? '';
  const nonLeaseDescription = String(
    getVal(nonLeaseDescObj) ?? top.non_lease_description ?? ''
  ).trim();

  const has = (v: unknown) => v != null && String(v).trim() !== '';

  setConf(confidences, 'lessee', lesseeObj, has(lessee));
  setConf(confidences, 'lessor', lessorObj, has(lessor));
  setConf(confidences, 'title', assetObj, has(title));
  setConf(confidences, 'assetDescription', assetObj, has(assetDescription));
  setConf(confidences, 'leaseType', leaseTypeObj, has(leaseType));
  setConf(confidences, 'startDate', startObj, has(startDate));
  setConf(confidences, 'endDate', endObj, has(endDate));
  setConf(confidences, 'lease_term_months', termObj, has(leaseTermMonths));
  setConf(confidences, 'baseRentAmount', monthlyObj, has(baseRentAmount));
  setConf(confidences, 'currency', currencyObj, has(currency));
  setConf(confidences, 'paymentFrequency', freqObj, has(paymentFrequency));
  setConf(confidences, 'paymentType', payTypeObj, has(paymentType));
  setConf(confidences, 'discountRate', discountObj, has(discountRate));
  setConf(confidences, 'initialDirectCosts', idcTotalObj, has(initialDirectCosts));
  setConf(confidences, 'legalFees', legalObj, has(legalFees));
  setConf(confidences, 'brokerageFees', brokerObj, has(brokerageFees));
  setConf(confidences, 'renewalOptions', renewalObj, has(renewalOptions));
  setConf(confidences, 'terminationClauses', terminationObj, has(terminationClauses));
  setConf(confidences, 'description', assetObj, has(description));
  if (escalationText) setConf(confidences, 'escalationType', escalationObj, true);
  if (cpiAdjustments) setConf(confidences, 'cpiAdjustments', indexLinkedObj, true);
  if (rentFreeMonths > 0) confidences.rentFreeMonths = getConf(rentFreeObj) ?? getConf(escalationObj) ?? 70;
  setConf(confidences, 'nonLeaseComponent', nonLeaseObj, has(nonLeaseComponent));
  setConf(confidences, 'nonLeaseDescription', nonLeaseDescObj, has(nonLeaseDescription));

  const formPatch: Record<string, unknown> = {
    leaseStatus: 'Active',
  };
  if (has(title)) formPatch.title = title;
  if (has(assetDescription)) formPatch.assetDescription = assetDescription;
  if (has(lessee)) {
    formPatch.lessee = lessee;
    formPatch.lesseeDetails = { name: lessee };
  }
  if (has(lessor)) {
    formPatch.lessor = lessor;
    formPatch.lessorDetails = { name: lessor };
  }
  if (has(startDate)) formPatch.startDate = startDate;
  if (has(endDate)) formPatch.endDate = endDate;
  if (has(leaseTermMonths)) formPatch.lease_term_months = String(leaseTermMonths);
  if (has(baseRentAmount)) formPatch.baseRentAmount = String(baseRentAmount);
  if (has(currency)) formPatch.currency = currency;
  if (has(paymentFrequency)) formPatch.paymentFrequency = paymentFrequency;
  if (has(paymentType)) formPatch.paymentType = paymentType;
  if (has(discountRate)) formPatch.discountRate = discountRate;
  if (has(initialDirectCosts)) formPatch.initialDirectCosts = String(initialDirectCosts);
  if (has(legalFees)) formPatch.legalFees = String(legalFees);
  if (has(brokerageFees)) formPatch.brokerageFees = String(brokerageFees);
  if (has(renewalOptions)) formPatch.renewalOptions = renewalOptions;
  if (has(terminationClauses)) formPatch.terminationClauses = terminationClauses;
  if (has(description)) formPatch.description = description;
  if (has(leaseType)) formPatch.leaseType = leaseType;
  if (has(country)) formPatch.country = country;
  if (has(city)) formPatch.city = city;
  if (has(location)) formPatch.location = location;
  if (escalationType !== 'None') {
    formPatch.escalationType = escalationType;
    if (escalationValue) formPatch.escalationValue = escalationValue;
  }
  if (cpiAdjustments) formPatch.cpiAdjustments = true;
  if (rentFreeMonths > 0) formPatch.rentFreeMonths = rentFreeMonths;
  if (has(nonLeaseComponent)) formPatch.nonLeaseComponent = String(nonLeaseComponent);
  if (has(nonLeaseDescription)) formPatch.nonLeaseDescription = nonLeaseDescription;
  const nonLeaseText = `${nonLeaseDescription} ${escalationText}`.toLowerCase();
  if (
    has(nonLeaseComponent) &&
    (/excluded from ifrs|in addition|separate|on top|additional to|plus.*service/i.test(nonLeaseText) ||
      /service charge|facilities management|cam\b|maintenance fee/i.test(nonLeaseText))
  ) {
    formPatch.nonLeaseAdditive = true;
  }

  const tabsWithData = new Set<string>();
  if (
    title ||
    startDate ||
    endDate ||
    lessee ||
    lessor ||
    leaseType ||
    leaseTermMonths ||
    renewalOptions ||
    terminationClauses ||
    description
  ) {
    tabsWithData.add('contract');
  }
  if (
    baseRentAmount ||
    currency ||
    paymentFrequency ||
    discountRate ||
    initialDirectCosts ||
    escalationType !== 'None' ||
    rentFreeMonths > 0 ||
    has(nonLeaseComponent)
  ) {
    tabsWithData.add('financial');
  }
  if (assetDescription || leaseType || country || city || location) {
    tabsWithData.add('assets');
  }
  if (renewalOptions || terminationClauses) tabsWithData.add('modifications');

  const scores = Object.values(confidences);
  const fieldCount = scores.length;
  const avgConfidence =
    fieldCount > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / fieldCount) : 0;

  const contractData = Object.keys(data).length > 0 ? { ...data } : null;

  return {
    formPatch,
    confidences,
    tabsWithData,
    contractData,
    fieldCount,
    avgConfidence,
  };
}

export function confidenceLabel(score: number): string {
  if (score >= 80) return 'High';
  if (score >= 50) return 'Medium';
  return 'Low';
}

export function isArabicExtractionError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('no readable text') ||
    m.includes('scanned pdf') ||
    m.includes('ocr') ||
    m.includes('arabic') ||
    m.includes('could not read pdf')
  );
}
