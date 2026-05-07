import {
  getBackendConnectivityMessage,
  getApiHealthTimeoutMessage,
} from '@/lib/service-messages';

// Use '' so browser calls same-origin /api/*; the Next server proxies to Python (see app/api/[...path]/route.ts).
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

/** Shown when fetch fails or API is down (customer-safe in production builds). */
export function getBackendUnreachableHelp(): string {
  return getBackendConnectivityMessage();
}

function getConnectionErrorMessage(): string {
  return getBackendConnectivityMessage();
}

interface ApiResponse<T> {
  data?: T;
  error?: string;
}

async function apiCall<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  try {
    const method = (options.method ?? 'GET').toString().toUpperCase();
    const hasBody = options.body != null && options.body !== '';
    const jsonContentType = hasBody && method !== 'GET' && method !== 'HEAD';
    const response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers: {
        ...(jsonContentType ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }));
      const errorMessage = errorData.detail 
        ? (typeof errorData.detail === 'string' ? errorData.detail : JSON.stringify(errorData.detail))
        : `HTTP error! status: ${response.status}`;
      throw new Error(errorMessage);
    }

    const data = await response.json();
    return { data };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'An error occurred';
    const net =
      msg === 'Failed to fetch' ||
      msg.includes('NetworkError') ||
      msg.includes('Load failed') ||
      msg.includes('connection') ||
      msg.includes('reset');
    return { error: net ? getBackendUnreachableHelp() : msg };
  }
}

// IFRS 16 endpoints
export const ifrs16Api = {
  calculate: async (leaseData: any) => {
    return apiCall('/api/calculate', {
      method: 'POST',
      body: JSON.stringify(leaseData),
    });
  },

  modificationAdvice: async (body: {
    extractor_hints: Record<string, unknown>;
    modification_inputs: Record<string, unknown>;
  }) => {
    return apiCall<Record<string, unknown>>('/api/ifrs16/modification-advice', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  uploadContract: async (file: File, abortSignal?: AbortSignal) => {
    const formData = new FormData();
    formData.append('file', file);
    const url = `${API_URL}/api/upload-contract`;
    if (typeof window !== 'undefined') console.log('[Upload] POST to', url);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 min timeout
    abortSignal?.addEventListener?.('abort', () => {
      clearTimeout(timeoutId);
      controller.abort();
    });

    try {
      const response = await fetch(url, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const bodyText = await response.text();
      if (!response.ok) {
        let errorMessage = `Upload failed (${response.status} ${response.statusText || ''})`.trim();
        try {
          const errorData = JSON.parse(bodyText) as {
            detail?: unknown;
            error?: unknown;
            message?: unknown;
          };
          const d = errorData.detail;
          if (typeof d === 'string') errorMessage = d;
          else if (Array.isArray(d))
            errorMessage = d.map((x: { msg?: string }) => x?.msg || JSON.stringify(x)).join('; ');
          else if (d != null) errorMessage = String(d);
          else if (errorData.error != null) errorMessage = String(errorData.error);
          else if (errorData.message != null) errorMessage = String(errorData.message);
        } catch {
          const snippet = bodyText.replace(/\s+/g, ' ').trim().slice(0, 400);
          if (snippet) errorMessage = `${errorMessage}. ${snippet}`;
        }
        throw new Error(errorMessage);
      }

      return { data: JSON.parse(bodyText) };
    } catch (error) {
      clearTimeout(timeoutId);
      const msg = error instanceof Error ? error.message : 'Upload failed';
      const isAbort = error instanceof Error && error.name === 'AbortError';
      const isNetworkError = msg === 'Failed to fetch' || msg.includes('NetworkError') || msg.includes('Load failed') || msg.includes('connection') || msg.includes('reset');
      return {
        error: isAbort ? 'Extraction cancelled or timed out.' : isNetworkError ? getConnectionErrorMessage() : msg,
      };
    }
  },

  downloadReport: (fileId: string) => {
    return `${API_URL}/api/download/${fileId}`;
  },

  bulkTemplateUrl: () => `${API_URL}/api/ifrs16/bulk-template`,

  bulkCalculate: async (leases: unknown[]) =>
    apiCall<{
      total: number;
      successful: number;
      failed: number;
      results: Array<{
        lease_id: string;
        status: string;
        error: string | null;
        lease_liability: number;
        rou_asset: number;
        monthly_depreciation: number;
        total_interest: number;
        calculation_results?: Record<string, unknown> | null;
      }>;
      portfolio_summary: {
        total_lease_liability: number;
        total_rou_asset: number;
        avg_ibr: number;
        currency_breakdown: Record<string, number>;
      };
    }>('/api/ifrs16/bulk-calculate', {
      method: 'POST',
      body: JSON.stringify({ leases }),
    }),
};

export const ifrs16IbrApi = {
  suggest: async (payload: {
    country: string;
    currency: string;
    lease_term_months: number;
    asset_type?: string;
    lessee_type?: string;
  }) =>
    apiCall<{
      ibr_low: number;
      ibr_mid: number;
      ibr_high: number;
      rationale: string;
      market_references: string[];
    }>('/api/ifrs16/suggest-ibr', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};

// IFRS 16 Smart Alerts
export const alertsApi = {
  getDefaults: async () => apiCall<{ email: string }>('/api/ifrs16/alerts/defaults'),
  configure: async (config: Record<string, unknown>) => {
    return apiCall('/api/ifrs16/alerts/configure', {
      method: 'POST',
      body: JSON.stringify(config),
    });
  },
  sendTest: async (config: { email?: string }) => {
    return apiCall('/api/ifrs16/alerts/send-test', {
      method: 'POST',
      body: JSON.stringify(config),
    });
  },
  check: async (leases: any[]) => {
    return apiCall<{ alerts: any[] }>('/api/ifrs16/alerts/check', {
      method: 'POST',
      body: JSON.stringify({ leases }),
    });
  },
};

// RAG Chat endpoint
export const chatApi = {
  ask: async (companyId: string, question: string, documentType?: string) => {
    return apiCall('/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        company_id: companyId,
        question,
        document_type: documentType,
        top_k: 5,
      }),
    });
  },

  getStats: async (companyId: string) => {
    return apiCall(`/api/rag/stats/${companyId}`, {
      method: 'GET',
    });
  },
};

/**
 * Health check with retries (Next.js dev / Turbopack cold start, slow API wake).
 * Does not send Content-Type on GET.
 */
export const healthCheck = async (): Promise<ApiResponse<{ status?: string }>> => {
  const maxAttempts = 5;
  const timeoutMs = 8000;
  let lastError = 'Unable to reach API';

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 350 * attempt));
    }
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(`${API_URL}/api/health`, {
        method: 'GET',
        signal: controller.signal,
        cache: 'no-store',
      });
      clearTimeout(tid);

      if (response.ok) {
        const data = (await response.json()) as { status?: string };
        return { data };
      }

      let detail = `HTTP ${response.status}`;
      try {
        const t = await response.text();
        const j = JSON.parse(t) as { detail?: unknown };
        if (j.detail != null) detail = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail);
      } catch {
        /* ignore */
      }
      lastError = detail;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const aborted = e instanceof Error && (e.name === 'AbortError' || msg.includes('aborted'));
      if (aborted) {
        lastError = getApiHealthTimeoutMessage();
      } else if (
        msg === 'Failed to fetch' ||
        msg.includes('NetworkError') ||
        msg.includes('Load failed') ||
        msg.includes('connection') ||
        msg.includes('reset')
      ) {
        lastError = getBackendUnreachableHelp();
      } else {
        lastError = msg;
      }
    }
  }

  return { error: lastError };
};

// Batch calculate
export const batchCalculate = async (leases: any[]) => {
  return apiCall('/api/batch-calculate', {
    method: 'POST',
    body: JSON.stringify(leases),
  });
};

// IFRS 15 endpoints
export const ifrs15Api = {
  extract: async (contractText: string) => {
    return apiCall('/api/ifrs15/extract', {
      method: 'POST',
      body: JSON.stringify({ contract_text: contractText }),
    });
  },

  detectClauses: async (contractText: string) =>
    apiCall<Record<string, unknown>>('/api/ifrs15/detect-clauses', {
      method: 'POST',
      body: JSON.stringify({ contract_text: contractText }),
    }),

  uploadContract: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    try {
      const response = await fetch(`${API_URL}/api/ifrs15/upload-contract`, {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) {
        let errorMessage = `Upload failed: ${response.statusText}`;
        try {
          const errorData = await response.json();
          if (errorData.detail) errorMessage = errorData.detail;
          else if (errorData.error) errorMessage = errorData.error;
        } catch { /* ignore */ }
        throw new Error(errorMessage);
      }
      return { data: await response.json() };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Upload failed';
      const isNetworkError = msg === 'Failed to fetch' || msg.includes('NetworkError') || msg.includes('Load failed');
      return { error: isNetworkError ? getConnectionErrorMessage() : msg };
    }
  },

  calculate: async (contractData: any) => {
    return apiCall<{ results?: Record<string, unknown>; excel_file_id?: string; contract_id?: string }>('/api/ifrs15/calculate', {
      method: 'POST',
      body: JSON.stringify(contractData),
    });
  },

  generateExcel: async (payload: {
    contract_id: string;
    customer_name?: string;
    effective_date?: string;
    contract_term_months?: number;
    currency?: string;
    results: Record<string, unknown>;
    /** When set, Sheet 1 is populated; otherwise Sheet 1 is a placeholder. */
    master_report_data?: Record<string, unknown> | null;
  }) => {
    return apiCall<{ status: string; file_id: string; filename: string }>('/api/ifrs15/download-excel', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  rpo: async (payload: {
    obligations: Array<{
      obligation_name: string;
      allocated_amount: number;
      recognised_to_date: number;
      expected_end_date: string;
      original_expected_duration_months?: number | null;
      is_right_to_invoice?: boolean;
    }>;
    contract_id?: string;
  }) => {
    return apiCall<Record<string, unknown>>('/api/ifrs15/rpo', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  contractCosts: async (payload: {
    commission_amount: number;
    contract_term_months: number;
    contract_total_value: number;
    contract_id?: string;
  }) => {
    return apiCall<Record<string, unknown>>('/api/ifrs15/contract-costs', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  principalAgent: async (payload: {
    transaction_price: number;
    cost_paid_to_supplier: number;
    obtains_before_transfer: boolean;
    sets_price_independently: boolean;
    primarily_responsible: boolean;
    contract_id?: string;
  }) => {
    return apiCall<Record<string, unknown>>('/api/ifrs15/principal-agent', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  masterReport: async (payload: {
    contract_id: string;
    customer_name?: string;
    core_results: Record<string, unknown>;
    modification_result?: Record<string, unknown> | null;
    variable_consideration_result?: Record<string, unknown> | null;
    rpo_result?: Record<string, unknown> | null;
    contract_costs_result?: Record<string, unknown> | null;
    principal_agent_result?: Record<string, unknown> | null;
    license_result?: Record<string, unknown> | null;
  }) => {
    return apiCall<Record<string, unknown>>('/api/ifrs15/master-report', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  masterReportDownloadExcel: async (payload: { master_report: Record<string, unknown> }) => {
    return apiCall<{ status: string; file_id: string; filename: string }>('/api/ifrs15/master-report/download-excel', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  licenseClassification: async (payload: {
    transaction_price: number;
    licence_term_months: number;
    licence_start_date: string;
    significantly_affects_ip: boolean;
    customer_exposed_as_occurs: boolean;
    activities_not_separate_good: boolean;
    includes_usage_royalties: boolean;
    contract_id?: string;
  }) => {
    return apiCall<Record<string, unknown>>('/api/ifrs15/license-classification', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  variableConsideration: async (payload: {
    method: string;
    scenarios: Array<{ outcome: string; amount: number; probability: number }>;
    constraint_factors: boolean[];
    contract_id?: string;
    total_contract_value?: number;
  }) => {
    return apiCall<Record<string, unknown>>('/api/ifrs15/variable-consideration', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  reversalRisk: async (payload: {
    contract_id?: string | null;
    constraint_level: string;
    contract_term_months: number;
    customer_type: string;
    variable_consideration: number;
    total_contract_value: number;
    refund_type?: string;
    recognition_type: string;
    historical_attainment_pct?: number | null;
    has_external_dependency?: boolean;
    dependency_level?: string;
  }) => {
    return apiCall<Record<string, unknown>>('/api/ifrs15/reversal-risk', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  assessModification: async (payload: {
    original_contract_id: string;
    modification_date: string;
    new_goods_services: string[];
    price_change: number;
    revenue_recognised_to_date: number;
    remaining_periods: number;
    original_price: number;
    new_goods_are_distinct: boolean;
    price_reflects_standalone: boolean;
    remaining_goods_are_distinct: boolean;
  }) => {
    return apiCall<{
      modification_type: 'new_contract' | 'prospective' | 'catch_up';
      modification_type_label: string;
      catch_up_amount: number;
      catch_up_direction: 'additional_revenue' | 'revenue_reversal' | 'none';
      revised_schedule: any[];
      original_schedule_preview: any[];
      journal_entries: any[];
      explanation: string;
      risk_flag: boolean;
      risk_message: string;
    }>('/api/ifrs15/modification', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  downloadReport: (fileId: string) => {
    return `${API_URL}/api/ifrs15/download/${fileId}`;
  },

  generateClientReport: async (payload: {
    contract_id: string;
    customer_name: string;
    calculation_results: Record<string, unknown>;
    master_report_data?: Record<string, unknown> | null;
    include_auditor_qa?: boolean;
    prepared_by?: string;
  }) => {
    return apiCall<{ status: string; file_id: string; filename: string; pages: number }>('/api/ifrs15/client-report', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  downloadClientReport: (fileId: string) => {
    return `${API_URL}/api/ifrs15/client-report/${fileId}`;
  },

  scoreDisclosure: async (payload: {
    disclosure_text: string;
    calculation_results?: Record<string, unknown> | null;
  }) => {
    return apiCall<Record<string, unknown>>('/api/ifrs15/score-disclosure', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};

/** IFRS 9 classification & measurement (POST /api/ifrs9/classify) */
export type IFRS9ClassificationRequest = {
  instrument_name: string;
  instrument_type: string;
  business_model_indicators: string[];
  sppi_features: string[];
  prepayment_penalty_reasonable?: boolean;
  fair_value_option_elected?: boolean;
  fvo_reason?: string | null;
  business_model_changed?: boolean;
  nominal_rate?: number | null;
  issue_price?: number | null;
  face_value?: number | null;
  term_months?: number | null;
};

export type IFRS9AmortScheduleRow = {
  period: number;
  opening_balance: number;
  interest_income: number;
  cash_received: number;
  closing_balance: number;
};

export type IFRS9ClassificationResult = {
  instrument_name: string;
  business_model: string;
  business_model_label: string;
  sppi_pass: boolean;
  sppi_failure_reasons: string[];
  measurement: string;
  measurement_label: string;
  ecl_applies: boolean;
  p_and_l_impact: string;
  balance_sheet: string;
  fair_value_option_elected: boolean;
  reclassification_permitted: boolean;
  reclassification_note: string;
  eir_annual: number | null;
  eir_monthly: number | null;
  amortised_cost_schedule: IFRS9AmortScheduleRow[];
  eir_note: string;
  explanation: string;
  classification_confidence: string;
  audit_risk: string;
};

export type MacroScenarioPayload = {
  gdp_growth: number;
  unemployment_rate: number;
  interest_rate: number;
  property_price_change?: number;
  credit_spread?: number;
  probability: number;
};

export type IFRS9MacroOverlayRequest = {
  portfolio_name: string;
  base_pd: number;
  lgd: number;
  ead: number;
  base_scenario: MacroScenarioPayload;
  optimistic_scenario: MacroScenarioPayload;
  pessimistic_scenario: MacroScenarioPayload;
  loans?: Array<Record<string, unknown>>;
};

export type IFRS9MacroScenarioResult = {
  pd_adjusted: number;
  pd_adjustment: number;
  ecl: number;
  probability: number;
  macro_variables: Record<string, number>;
};

export type IFRS9MacroOverlayResult = {
  portfolio_name: string;
  base_pd_original: number;
  lgd: number;
  ead: number;
  scenarios: {
    base: IFRS9MacroScenarioResult;
    optimistic: IFRS9MacroScenarioResult;
    pessimistic: IFRS9MacroScenarioResult;
  };
  point_in_time_ecl: number;
  probability_weighted_ecl: number;
  macro_overlay_impact: number;
  overlay_pct: number;
  overlay_direction: string;
  pd_range: { optimistic: number; base: number; pessimistic: number };
  ecl_range: { optimistic: number; base: number; pessimistic: number };
  sensitivity_analysis: {
    gdp: Array<{ gdp: number; pd: number; ecl: number }>;
    unemployment: Array<{ unemployment: number; pd: number; ecl: number }>;
  };
  staging_migrations: number;
  migration_ead: number;
  ifrs9_compliance: {
    forward_looking: boolean;
    multiple_scenarios: boolean;
    probability_weighted: boolean;
    macro_variables_used: string[];
  };
  narrative: string;
  overlay_adequacy: string;
};

export type IFRS9ProvisionBucketResult = {
  label: string;
  days_from: number;
  days_to: number;
  count: number;
  gross_amount: number;
  base_loss_rate: number;
  fla_applied: number;
  adjusted_loss_rate: number;
  provision: number;
  net_amount: number;
  coverage_pct: number;
  receivables: Array<Record<string, unknown>>;
};

export type IFRS9ProvisionMatrixResult = {
  portfolio_name: string;
  reporting_date: string;
  receivable_type: string;
  buckets: IFRS9ProvisionBucketResult[];
  totals: {
    gross_amount: number;
    total_provision: number;
    net_amount: number;
    overall_coverage_pct: number;
    weighted_loss_rate: number;
    count: number;
  };
  concentration_risk: string;
  concentration_note: string;
  bad_debt_risk: string;
  using_defaults: boolean;
  default_rates_note: string;
  fla_applied: number;
  fla_note: string;
  journal_entries: Array<{
    description: string;
    dr_account: string;
    cr_account: string;
    amount: number;
  }>;
  ifrs9_simplified_approach: boolean;
  ifrs9_reference: string;
  narrative: string;
  highest_risk_bucket: {
    label: string;
    gross_amount: number;
    provision: number;
    adjusted_loss_rate: number;
  };
};

// IFRS 9 ECL endpoints
export const ifrs9Api = {
  getPdRates: async () => apiCall<{ pd_rates: Record<string, number> }>('/api/ifrs9/pd-rates'),

  uploadPortfolio: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    try {
      const response = await fetch(`${API_URL}/api/ifrs9/upload-portfolio`, {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || response.statusText);
      }
      return { data: await response.json() };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Upload failed';
      return { error: msg };
    }
  },

  calculate: async (data: Record<string, unknown>) =>
    apiCall<{
      ecl_12m?: number;
      ecl_lifetime?: number;
      applicable_ecl: number;
      ecl_weighted: number;
      coverage_ratio: number;
      journal_entries: Array<{ type: string; dr: string; cr: string; amount: number }>;
      disclosure_notes: string;
      bucket_results?: Array<Record<string, unknown>>;
      scenario_results: { base: number; optimistic: number; pessimistic: number; weighted: number };
    }>('/api/ifrs9/calculate', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  downloadExcelAuditPack: async (payload: Record<string, unknown>) =>
    apiCall<{ file_id: string; filename: string; sheets: number }>('/api/ifrs9/download-excel', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  masterReport: async (payload: Record<string, unknown>) =>
    apiCall<Record<string, unknown>>('/api/ifrs9/master-report', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  classify: async (data: IFRS9ClassificationRequest) =>
    apiCall<IFRS9ClassificationResult>('/api/ifrs9/classify', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  macroOverlay: async (data: IFRS9MacroOverlayRequest) =>
    apiCall<IFRS9MacroOverlayResult>('/api/ifrs9/macro-overlay', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  provisionMatrix: async (data: Record<string, unknown>) =>
    apiCall<IFRS9ProvisionMatrixResult>('/api/ifrs9/provision-matrix', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  downloadReport: (fileId: string) => `${API_URL}/api/ifrs9/download/${fileId}`,

  downloadReportPost: async (data: Record<string, unknown>) =>
    apiCall<{ file_id: string; filename: string }>('/api/ifrs9/download-report', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

export const macroSensitivityApi = {
  getCurrent: async (tenantId = 'default', portfolioType = 'all') =>
    apiCall<Record<string, unknown>>(
      `/api/admin/macro-sensitivity?tenant_id=${encodeURIComponent(tenantId)}&portfolio_type=${encodeURIComponent(portfolioType)}`
    ),
  update: async (payload: Record<string, unknown>) =>
    apiCall<{ status: string; effective: string }>('/api/admin/macro-sensitivity', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getHistory: async (tenantId = 'default', portfolioType = 'all') =>
    apiCall<Array<Record<string, unknown>>>(
      `/api/admin/macro-sensitivity/history?tenant_id=${encodeURIComponent(tenantId)}&portfolio_type=${encodeURIComponent(portfolioType)}`
    ),
};

export const consolidationApi = {
  getEntities: () => apiCall<any[]>('/api/consolidation/entities'),
  addEntity: (payload: Record<string, unknown>) =>
    apiCall('/api/consolidation/entities', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  addIntercompany: (payload: Record<string, unknown>) =>
    apiCall('/api/consolidation/intercompany', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  run: (entity_ids: string[], group_currency: string) =>
    apiCall('/api/consolidation/run', {
      method: 'POST',
      body: JSON.stringify({ entity_ids, group_currency }),
    }),
  runIfrs16: (payload: { group_currency: string; entities: any[] }) =>
    apiCall('/api/ifrs16/consolidate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};
