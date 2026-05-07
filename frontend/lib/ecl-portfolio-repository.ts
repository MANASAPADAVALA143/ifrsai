/**
 * ECL Portfolio Repository - localStorage for IFRS 9 ECL portfolios
 * Key: ecl_portfolio_repository
 */

export type AssetClass =
  | 'Trade Receivables'
  | 'Loans & Advances'
  | 'Bonds & Securities'
  | 'Financial Guarantees'
  | 'Lease Receivables'
  | 'Intercompany'
  | 'Other';

export type CounterpartyType = 'Corporate' | 'SME' | 'Retail' | 'Sovereign' | 'Bank' | 'Other';

export type Stage = 1 | 2 | 3;

export interface AgeingBucket {
  bucket: string;
  daysOverdue: string;
  amount: number;
  pctOfTotal: number;
}

export interface ProvisionMatrixRow {
  bucket: string;
  daysOverdue: string;
  historicalDefaultRate: number;
  eclRate: number;
  grossAmount: number;
  eclAmount: number;
}

export interface ECLPortfolioEntry {
  id: string;
  portfolioId: string;
  name: string;
  assetClass: AssetClass;
  currency: string;
  counterpartyName: string;
  counterpartyType: CounterpartyType;
  industrySector: string;
  country: string;
  originationDate: string;
  maturityDate: string;
  reportingDate: string;
  lastReviewDate: string;
  grossCarryingAmount: number;
  amortisedCost: number;
  fairValue: number;
  notionalAmount: number;
  outstandingBalance: number;
  undrawnCommitment: number;
  accruedInterest: number;
  collateralValue: number;
  /** Classification */
  businessModel: 'hold_to_collect' | 'hold_collect_sell' | 'trading';
  sppiPass: boolean;
  classification: 'AC' | 'FVOCI' | 'FVTPL';
  effectiveInterestRate: number;
  initialRecognitionAmount: number;
  transactionCosts: number;
  originationFees: number;
  /** Staging */
  stage: Stage;
  stagingRationale: string;
  stage1Criteria: Record<string, boolean>;
  stage2Triggers: Record<string, boolean>;
  stage3Triggers: Record<string, boolean>;
  stagingHistory: Array<{ date: string; previousStage: Stage; newStage: Stage; reason: string; changedBy: string }>;
  /** ECL */
  approach: 'simplified' | 'general';
  pdSource: string;
  pd12m: number;
  pdLifetime: number;
  pdBasis: string;
  creditRating: string;
  lgd: number;
  collateralType: string;
  collateralCoverage: number;
  recoveryRate: number;
  ead: number;
  ccf: number;
  eadBasis: string;
  useProvisionMatrix: boolean;
  provisionMatrix: ProvisionMatrixRow[];
  ageingBuckets: AgeingBucket[];
  /** Calculated (set after /api/ifrs9/calculate) */
  ecl12m?: number;
  eclLifetime?: number;
  applicableEcl?: number;
  coverageRatio?: number;
  scenarioResults?: { base: number; optimistic: number; pessimistic: number; weighted: number };
  journalEntries?: Array<{ type: string; dr: string; cr: string; amount: number }>;
  disclosureNotes?: string;
  /** Scenario analysis */
  scenarios?: {
    base?: { gdp: number; unemployment: number; interestRate: number; weight: number; pd?: number; ecl?: number };
    optimistic?: { gdp: number; unemployment: number; interestRate: number; weight: number; pd?: number; ecl?: number };
    pessimistic?: { gdp: number; unemployment: number; interestRate: number; weight: number; pd?: number; ecl?: number };
  };
  /** Audit */
  status: 'Draft' | 'Pending Review' | 'Approved' | 'Archived';
  lastUpdated: string;
  auditTrail: Array<{ dateTime: string; user: string; action: string; oldValue: string; newValue: string; reason: string }>;
  [key: string]: unknown;
}

const STORAGE_KEY = 'ecl_portfolio_repository';

export function getEclPortfolioRepository(): ECLPortfolioEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveToEclPortfolioRepository(entry: ECLPortfolioEntry): void {
  const repo = getEclPortfolioRepository();
  const exists = repo.findIndex((e) => e.id === entry.id || e.portfolioId === entry.portfolioId);
  entry.lastUpdated = new Date().toISOString();
  if (exists >= 0) {
    repo[exists] = entry;
  } else {
    repo.unshift(entry);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(repo));
}

export function getEclPortfolioById(id: string): ECLPortfolioEntry | undefined {
  return getEclPortfolioRepository().find((e) => e.id === id || e.portfolioId === id);
}

export function deleteEclPortfolioFromRepository(id: string): void {
  const repo = getEclPortfolioRepository().filter((e) => e.id !== id && e.portfolioId !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(repo));
}

const DEFAULT_AGEING: AgeingBucket[] = [
  { bucket: 'Current', daysOverdue: '0 days', amount: 0, pctOfTotal: 0 },
  { bucket: 'Bucket 1', daysOverdue: '1-30 days', amount: 0, pctOfTotal: 0 },
  { bucket: 'Bucket 2', daysOverdue: '31-60 days', amount: 0, pctOfTotal: 0 },
  { bucket: 'Bucket 3', daysOverdue: '61-90 days', amount: 0, pctOfTotal: 0 },
  { bucket: 'Bucket 4', daysOverdue: '91-180 days', amount: 0, pctOfTotal: 0 },
  { bucket: 'Bucket 5', daysOverdue: '180+ days', amount: 0, pctOfTotal: 0 },
];

const DEFAULT_PROVISION_MATRIX: ProvisionMatrixRow[] = [
  { bucket: 'Current', daysOverdue: '0', historicalDefaultRate: 0.5, eclRate: 0.5, grossAmount: 0, eclAmount: 0 },
  { bucket: '1-30 days', daysOverdue: '1-30', historicalDefaultRate: 2, eclRate: 2, grossAmount: 0, eclAmount: 0 },
  { bucket: '31-60 days', daysOverdue: '31-60', historicalDefaultRate: 5, eclRate: 5, grossAmount: 0, eclAmount: 0 },
  { bucket: '61-90 days', daysOverdue: '61-90', historicalDefaultRate: 15, eclRate: 15, grossAmount: 0, eclAmount: 0 },
  { bucket: '91-180 days', daysOverdue: '91-180', historicalDefaultRate: 30, eclRate: 30, grossAmount: 0, eclAmount: 0 },
  { bucket: '180+ days', daysOverdue: '180+', historicalDefaultRate: 60, eclRate: 60, grossAmount: 0, eclAmount: 0 },
];

export function createBlankEclPortfolio(portfolioId?: string): ECLPortfolioEntry {
  const id = portfolioId || `PORTFOLIO-2026-${String(Date.now()).slice(-6)}`;
  return {
    id,
    portfolioId: id,
    name: '',
    assetClass: 'Trade Receivables',
    currency: 'INR',
    counterpartyName: '',
    counterpartyType: 'Corporate',
    industrySector: '',
    country: '',
    originationDate: '',
    maturityDate: '',
    reportingDate: new Date().toISOString().split('T')[0],
    lastReviewDate: '',
    grossCarryingAmount: 0,
    amortisedCost: 0,
    fairValue: 0,
    notionalAmount: 0,
    outstandingBalance: 0,
    undrawnCommitment: 0,
    accruedInterest: 0,
    collateralValue: 0,
    businessModel: 'hold_to_collect',
    sppiPass: true,
    classification: 'AC',
    effectiveInterestRate: 0,
    initialRecognitionAmount: 0,
    transactionCosts: 0,
    originationFees: 0,
    stage: 1,
    stagingRationale: '',
    stage1Criteria: {},
    stage2Triggers: {},
    stage3Triggers: {},
    stagingHistory: [],
    approach: 'general',
    pdSource: 'Manual Input',
    pd12m: 1,
    pdLifetime: 5,
    pdBasis: 'Forward-Looking',
    creditRating: '',
    lgd: 45,
    collateralType: 'None',
    collateralCoverage: 0,
    recoveryRate: 0,
    ead: 0,
    ccf: 75,
    eadBasis: 'Outstanding Balance',
    useProvisionMatrix: false,
    provisionMatrix: JSON.parse(JSON.stringify(DEFAULT_PROVISION_MATRIX)),
    ageingBuckets: JSON.parse(JSON.stringify(DEFAULT_AGEING)),
    status: 'Draft',
    lastUpdated: new Date().toISOString(),
    auditTrail: [],
  };
}
