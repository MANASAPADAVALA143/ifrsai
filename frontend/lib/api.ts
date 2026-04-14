import {
  getBackendConnectivityMessage,
  getApiHealthTimeoutMessage,
} from '@/lib/service-messages';

// Use '' so browser calls same-origin /api/*; the Next server proxies to Python (see app/api/[...path]/route.ts).
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

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

  downloadReport: (fileId: string) => {
    return `${API_URL}/api/ifrs15/download/${fileId}`;
  },
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

  classify: async (data: { sppi_pass: boolean; business_model: string }) =>
    apiCall<{ classification: string; ecl_applicable: boolean; reason: string }>('/api/ifrs9/classify', {
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
