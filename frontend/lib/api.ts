import {
  getBackendConnectivityMessage,
  getApiHealthTimeoutMessage,
} from '@/lib/service-messages';
import { parseJsonText } from '@/lib/utils';

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

/** RERA escrow Art. 8 — HTTP 422 with `error: RERA_ESCROW_VIOLATION` (not wrapped in `detail`). */
export interface ApiResponseWithRera<T> extends ApiResponse<T> {
  reraViolation?: Record<string, unknown>;
}

async function apiPostRealestateEscrowGate<T>(
  endpoint: string,
  body: Record<string, unknown>
): Promise<ApiResponseWithRera<T>> {
  try {
    const response = await fetch(`${API_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const bodyText = await response.text();
    const parsed = parseJsonText<Record<string, unknown>>(bodyText);
    if (response.status === 422 && parsed && parsed.error === 'RERA_ESCROW_VIOLATION') {
      return { reraViolation: parsed };
    }
    if (!response.ok) {
      let msg = `HTTP error! status: ${response.status}`;
      if (parsed?.detail !== undefined) {
        msg =
          typeof parsed.detail === 'string'
            ? parsed.detail
            : JSON.stringify(parsed.detail);
      } else if (typeof parsed?.message === 'string') {
        msg = parsed.message;
      }
      return { error: msg };
    }
    const data = parseJsonText<T>(bodyText);
    if (data == null) {
      return { error: 'API returned an empty response' };
    }
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

    const bodyText = await response.text();
    if (!response.ok) {
      const errorData =
        parseJsonText<{ detail?: unknown }>(bodyText) ?? ({ detail: 'Unknown error' } as const);
      const errorMessage = errorData.detail
        ? typeof errorData.detail === 'string'
          ? errorData.detail
          : JSON.stringify(errorData.detail)
        : `HTTP error! status: ${response.status}`;
      throw new Error(errorMessage);
    }

    const data = parseJsonText<T>(bodyText);
    if (data == null) {
      throw new Error('API returned an empty response');
    }
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

  extractFromText: async (contractText: string) =>
    apiCall<{ extracted_data?: Record<string, unknown>; extraction_id?: string; validation?: unknown }>(
      '/api/extract',
      {
        method: 'POST',
        body: JSON.stringify({ contract_text: contractText }),
      }
    ),

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

      const data = parseJsonText<Record<string, unknown>>(bodyText);
      if (data == null) {
        throw new Error('Upload succeeded but the server returned an empty response');
      }
      return { data };
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

  /**
   * Single-shot Excel from bulk-calculate JSON (no file_id; works when /api/calculate fails on RAG/Excel on same request).
   */
  exportLeaseWorkbookFromResults: async (leaseId: string, calculationResults: Record<string, unknown>) => {
    const url = `${API_URL}/api/ifrs16/export-excel`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lease_id: leaseId, calculation_results: calculationResults }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      let msg = `Excel export failed (${response.status})`;
      try {
        const err = JSON.parse(text) as { detail?: unknown };
        if (typeof err.detail === 'string') msg = err.detail;
        else if (err.detail != null) msg = JSON.stringify(err.detail);
      } catch {
        const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 300);
        if (snippet) msg = `${msg}. ${snippet}`;
      }
      throw new Error(msg);
    }
    return response.blob();
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

  cfoInsights: async (payload: {
    leases: unknown[];
    total_assets?: number;
    annual_revenue?: number;
    budget_lease_cost?: number;
  }) =>
    apiCall<Record<string, unknown>>('/api/ifrs16/cfo-insights', {
      method: 'POST',
      body: JSON.stringify(payload),
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

export const ifrs16ExtApi = {
  indexLease: (body: Record<string, unknown>) =>
    apiCall('/api/ifrs16/index-lease', { method: 'POST', body: JSON.stringify(body) }),
  search: (query: string, companyId: string, topK = 5) =>
    apiCall<{ answer: string; sources: string[] }>('/api/ifrs16/search', {
      method: 'POST',
      body: JSON.stringify({ query, company_id: companyId, top_k: topK }),
    }),
  remeasureCpi: (body: Record<string, unknown>) =>
    apiCall('/api/ifrs16/remeasure-cpi', { method: 'POST', body: JSON.stringify(body) }),
  componentSplit: (body: Record<string, unknown>) =>
    apiCall('/api/ifrs16/component-split', { method: 'POST', body: JSON.stringify(body) }),
  healthScore: (leases: unknown[], alertsCount = 0) =>
    apiCall<{ score: number; issues: { description: string; severity: string }[] }>(
      '/api/ifrs16/health-score',
      { method: 'POST', body: JSON.stringify({ leases, alerts_count: alertsCount }) }
    ),
  ibrBenchmark: (body: { country: string; credit_rating: string; lease_term_years: number; currency?: string }) =>
    apiCall('/api/ifrs16/ibr-benchmark', { method: 'POST', body: JSON.stringify(body) }),
  auditBundle: async (body: Record<string, unknown>) => {
    const res = await fetch(`${API_URL}/api/ifrs16/audit-bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text();
      return { error: t || `HTTP ${res.status}` };
    }
    const blob = await res.blob();
    return { data: blob };
  },
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

  leaseSearch: async (companyId: string, question: string, topK = 5) => {
    return apiCall<{ answer: string; sources: string[] }>('/api/ifrs16/search', {
      method: 'POST',
      body: JSON.stringify({
        query: question,
        company_id: companyId,
        top_k: topK,
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
        const text = await response.text();
        const data = parseJsonText<{ status?: string }>(text) ?? { status: 'ok' };
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

  /** Legacy: `{ obligations }`. IFRS 15.120–122: `{ contracts: [...] }` — returns `{ success, rpo }` for contracts payload. */
  rpo: async (payload: Record<string, unknown>) => {
    return apiCall<Record<string, unknown>>('/api/ifrs15/rpo', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  contractCosts: async (payload: Record<string, unknown>) => {
    return apiCall<Record<string, unknown>>('/api/ifrs15/contract-costs', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /** Legacy gross/net engine, or extended B37 assessment when `arrangement_id` + five indicators are sent (`{ success, assessment }`). */
  principalAgent: async (payload: Record<string, unknown>) => {
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

  licensesIpAssess: async (payload: Record<string, unknown>) => {
    return apiCall<Record<string, unknown>>('/api/ifrs15/licenses-ip', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  auditLog: async (params?: { contract_id?: string; action?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.contract_id) q.set('contract_id', params.contract_id);
    if (params?.action) q.set('action', params.action);
    if (params?.limit != null) q.set('limit', String(params.limit));
    const qs = q.toString();
    return apiCall<Record<string, unknown>>(`/api/ifrs15/audit-log${qs ? `?${qs}` : ''}`);
  },

  auditLogSignOff: async (payload: { entry_id: string; reviewer: string; notes?: string }) => {
    return apiCall<Record<string, unknown>>('/api/ifrs15/audit-log/sign-off', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  materialRightsAssess: async (payload: { options: Record<string, unknown>[] }) => {
    return apiCall<Record<string, unknown>>('/api/ifrs15/material-rights', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  warrantiesClassify: async (payload: { warranties: Record<string, unknown>[] }) => {
    return apiCall<Record<string, unknown>>('/api/ifrs15/warranties', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  billAndHoldAssess: async (payload: { arrangements: Record<string, unknown>[] }) => {
    return apiCall<Record<string, unknown>>('/api/ifrs15/bill-and-hold', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  financingComponentCalculate: async (payload: { contracts: Record<string, unknown>[] }) => {
    return apiCall<Record<string, unknown>>('/api/ifrs15/financing-component', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  transactionPriceAdjustments: async (payload: {
    non_cash_items?: Record<string, unknown>[];
    consideration_payable_items?: Record<string, unknown>[];
  }) => {
    return apiCall<Record<string, unknown>>('/api/ifrs15/transaction-price-adjustments', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  tpAdjustmentsChange: async (payload: Record<string, unknown>) => {
    return apiCall<Record<string, unknown>>('/api/ifrs15/tp-adjustments', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  portfolioAddContract: async (payload: Record<string, unknown>) => {
    return apiCall<Record<string, unknown>>('/api/ifrs15/portfolio/add', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  realestatePortfolioAnalytics: async (params?: Record<string, string | boolean | number>) => {
    const q = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== '') q.set(k, String(v));
      });
    }
    const suffix = q.toString() ? `?${q.toString()}` : '';
    return apiCall<Record<string, unknown>>(`/api/ifrs15/realestate/portfolio/analytics${suffix}`);
  },

  realestatePortfolioAnalyticsExport: async (params?: Record<string, string | boolean | number>) => {
    const q = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== '') q.set(k, String(v));
      });
    }
    const suffix = q.toString() ? `?${q.toString()}` : '';
    try {
      const response = await fetch(
        `${API_URL}/api/ifrs15/realestate/portfolio/analytics/export-excel${suffix}`
      );
      if (!response.ok) throw new Error('Export failed');
      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="?([^";]+)"?/);
      return { blob, filename: match?.[1] || 'RE_Portfolio.xlsx' };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Export failed';
      return { error: msg };
    }
  },

  realestatePortfolioAdd: async (payload: Record<string, unknown>) =>
    apiPostRealestateEscrowGate<{ success?: boolean; portfolio_size?: number }>(
      '/api/ifrs15/realestate/portfolio',
      payload
    ),

  portfolioSummary: async () => {
    return apiCall<Record<string, unknown>>('/api/ifrs15/portfolio/summary');
  },

  portfolioRemoveContract: async (contractId: string) => {
    return apiCall<Record<string, unknown>>(`/api/ifrs15/portfolio/${encodeURIComponent(contractId)}`, {
      method: 'DELETE',
    });
  },

  portfolioExportExcelHref: () => `${API_URL}/api/ifrs15/portfolio/export-excel`,

  /** Standalone audit workbook (filtered); not JSON — returns Blob or error string. */
  auditLogExportExcel: async (params?: { contract_id?: string; action?: string }): Promise<{ data?: Blob; error?: string }> => {
    const q = new URLSearchParams();
    if (params?.contract_id?.trim()) q.set('contract_id', params.contract_id.trim());
    if (params?.action?.trim()) q.set('action', params.action.trim());
    const suffix = q.toString() ? `?${q.toString()}` : '';
    try {
      const response = await fetch(`${API_URL}/api/ifrs15/audit-log/export-excel${suffix}`, { method: 'POST' });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Audit log export failed' }));
        const errorMessage = errorData.detail
          ? typeof errorData.detail === 'string'
            ? errorData.detail
            : JSON.stringify(errorData.detail)
          : `HTTP error! status: ${response.status}`;
        throw new Error(errorMessage);
      }
      const blob = await response.blob();
      return { data: blob };
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
    modification_description?: string;
    new_goods_services?: string[];
    price_change: number;
    remaining_transaction_price?: number;
    remaining_performance_obligations?: string[];
    original_ssps?: Record<string, number>;
  }) => {
    return apiCall<{ success?: boolean; modification?: Record<string, unknown> }>('/api/ifrs15/modification', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  deferredRevenueRollforward: async (payload: {
    period: string;
    opening_balance: number;
    new_bookings: number;
    revenue_released: number;
    cancellations?: number;
    modifications_impact?: number;
    fx_impact?: number;
    gl_closing_balance: number;
    currency?: string;
  }) => {
    return apiCall<{ success?: boolean; rollforward?: Record<string, unknown> }>(
      '/api/ifrs15/deferred-revenue-rollforward',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
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

  realestateUploadSpa: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    try {
      const response = await fetch(`${API_URL}/api/ifrs15/realestate/upload-spa`, {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) {
        let errorMessage = `SPA upload failed: ${response.statusText}`;
        try {
          const errorData = await response.json();
          if (errorData.detail) {
            errorMessage = typeof errorData.detail === 'string' ? errorData.detail : JSON.stringify(errorData.detail);
          }
        } catch { /* ignore */ }
        throw new Error(errorMessage);
      }
      return { data: await response.json() };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Upload failed';
      const isNetworkError = msg === 'Failed to fetch' || msg.includes('NetworkError');
      return { error: isNetworkError ? getConnectionErrorMessage() : msg };
    }
  },

  realestateClientReportPdf: async (payload: Record<string, unknown>) => {
    try {
      const response = await fetch(`${API_URL}/api/ifrs15/realestate/client-report-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        let errorMessage = `PDF generation failed: ${response.statusText}`;
        try {
          const errorData = await response.json();
          if (errorData.detail) {
            errorMessage =
              typeof errorData.detail === 'string' ? errorData.detail : JSON.stringify(errorData.detail);
          }
        } catch { /* ignore */ }
        throw new Error(errorMessage);
      }
      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="?([^";]+)"?/);
      const filename = match?.[1] || 'IFRS15_RealEstate_Report.pdf';
      return { blob, filename };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'PDF generation failed';
      const isNetworkError = msg === 'Failed to fetch' || msg.includes('NetworkError');
      return { error: isNetworkError ? getConnectionErrorMessage() : msg };
    }
  },

  realestateUploadReraCertificate: async (
    file: File,
    opts?: {
      rera_registration_number?: string;
      form_completion_pct?: number;
      currency?: string;
    }
  ) => {
    const formData = new FormData();
    formData.append('file', file);
    if (opts?.rera_registration_number) {
      formData.append('rera_registration_number', opts.rera_registration_number);
    }
    if (opts?.form_completion_pct != null) {
      formData.append('form_completion_pct', String(opts.form_completion_pct));
    }
    formData.append('currency', opts?.currency || 'AED');
    try {
      const response = await fetch(`${API_URL}/api/ifrs15/realestate/upload-rera-certificate`, {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) {
        let errorMessage = `Certificate upload failed: ${response.statusText}`;
        try {
          const errorData = await response.json();
          if (errorData.detail) {
            errorMessage =
              typeof errorData.detail === 'string' ? errorData.detail : JSON.stringify(errorData.detail);
          }
        } catch { /* ignore */ }
        throw new Error(errorMessage);
      }
      return { data: await response.json() };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Upload failed';
      const isNetworkError = msg === 'Failed to fetch' || msg.includes('NetworkError');
      return { error: isNetworkError ? getConnectionErrorMessage() : msg };
    }
  },

  realestateOffPlan: async (payload: Record<string, unknown>) =>
    apiCall<{ success?: boolean; result?: Record<string, unknown> }>('/api/ifrs15/realestate/off-plan', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  realestateEscrow: async (payload: Record<string, unknown>) =>
    apiCall<{ success?: boolean; result?: Record<string, unknown> }>('/api/ifrs15/realestate/escrow', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  realestateModification: async (payload: Record<string, unknown>) =>
    apiCall<{ success?: boolean; result?: Record<string, unknown> }>('/api/ifrs15/realestate/modification', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  realestateContractCosts: async (payload: Record<string, unknown>) =>
    apiCall<{ success?: boolean; result?: Record<string, unknown> }>('/api/ifrs15/realestate/contract-costs', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  realestatePrincipalAgent: async (payload: Record<string, unknown>) =>
    apiCall<{ success?: boolean; result?: Record<string, unknown> }>('/api/ifrs15/realestate/principal-agent', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  realestateVat: async (payload: Record<string, unknown>) =>
    apiCall<{ success?: boolean; result?: Record<string, unknown> }>('/api/ifrs15/realestate/vat', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  realestateCalculate: async (payload: Record<string, unknown>) =>
    apiCall<Record<string, unknown>>('/api/ifrs15/realestate/calculate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  realestateToCalculatePayload: async (payload: Record<string, unknown>) =>
    apiPostRealestateEscrowGate<{ success?: boolean; calculate_payload?: Record<string, unknown> }>(
      '/api/ifrs15/realestate/to-calculate-payload',
      payload
    ),

  realestateReport: async (payload: Record<string, unknown>) =>
    apiPostRealestateEscrowGate<{ success?: boolean; report?: Record<string, unknown> }>(
      '/api/ifrs15/realestate/report',
      payload
    ),

  realestateExportExcel: async (payload: {
    report: Record<string, unknown>;
    contract_id?: string;
    escrow_receipts?: Record<string, unknown>[];
    escrow_releases?: Record<string, unknown>[];
    construction_completion_pct?: number;
  }) =>
    apiPostRealestateEscrowGate<{ status: string; file_id: string; filename: string }>(
      '/api/ifrs15/realestate/export-excel',
      payload
    ),

  realestateDownloadExcel: (fileId: string) => `${API_URL}/api/ifrs15/download/${fileId}`,

  realestateCancellationRefund: async (payload: Record<string, unknown>) =>
    apiPostRealestateEscrowGate<{ success?: boolean; result?: Record<string, unknown> }>(
      '/api/ifrs15/realestate/cancellation-refund',
      payload
    ),

  realestateBundlingCheck: async (payload: Record<string, unknown>) =>
    apiCall<{ success?: boolean; assessment?: Record<string, unknown> }>(
      '/api/ifrs15/realestate/bundling-check',
      { method: 'POST', body: JSON.stringify(payload) }
    ),

  realestatePatchOqoodFiled: async (payload: { modification_id: string; oqood_filed: boolean }) =>
    apiCall<{ success?: boolean; modification_id?: string; oqood_filed?: boolean }>(
      '/api/ifrs15/realestate/modification/oqood-filed',
      { method: 'PATCH', body: JSON.stringify(payload) }
    ),

  realestateDeadlineTracker: async (payload: Record<string, unknown>) =>
    apiCall<{ success?: boolean; report?: Record<string, unknown> }>(
      '/api/ifrs15/realestate/deadline-tracker',
      { method: 'POST', body: JSON.stringify(payload) }
    ),

  realestateDeadlineTrackerComplete: async (payload: Record<string, unknown>) =>
    apiCall<{
      success?: boolean;
      report?: Record<string, unknown>;
      deadline_completions?: Record<string, string>;
    }>('/api/ifrs15/realestate/deadline-tracker/complete', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  realestateDeadlineTrackerExport: async (payload: Record<string, unknown>) => {
    try {
      const response = await fetch(`${API_URL}/api/ifrs15/realestate/deadline-tracker/export-excel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        return { blob: null, filename: null, error: (err as { detail?: string }).detail || response.statusText };
      }
      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="?([^";]+)"?/);
      return { blob, filename: match?.[1] || 'RERA_Deadlines.xlsx', error: null };
    } catch (e) {
      return { blob: null, filename: null, error: e instanceof Error ? e.message : 'Export failed' };
    }
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

export const revRecApi = {
  sspAllocationCheck: async (payload: Record<string, unknown>) =>
    apiCall<Record<string, unknown>>('/api/rev-rec/ssp-allocation-check', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  contractBalanceTracker: async (payload: Record<string, unknown>) =>
    apiCall<Record<string, unknown>>('/api/rev-rec/contract-balance-tracker', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  periodReconciliation: async (payload: Record<string, unknown>) =>
    apiCall<Record<string, unknown>>('/api/rev-rec/period-reconciliation', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
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
