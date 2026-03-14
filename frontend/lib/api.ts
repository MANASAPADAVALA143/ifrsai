const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:9000'; // Backend runs on 9000

function getConnectionErrorMessage(): string {
  return 'Service temporarily unavailable. Please try again shortly.';
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
    const response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
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
    return {
      error: error instanceof Error ? error.message : 'An error occurred',
    };
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

      if (!response.ok) {
        // Try to get error detail from response
        let errorMessage = `Upload failed: ${response.statusText}`;
        try {
          const errorData = await response.json();
          if (errorData.detail) {
            errorMessage = errorData.detail;
          } else if (errorData.error) {
            errorMessage = errorData.error;
          }
        } catch {
          // If JSON parsing fails, use status text
        }
        throw new Error(errorMessage);
      }

      return { data: await response.json() };
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

// Health check
export const healthCheck = async () => {
  return apiCall('/api/health', {
    method: 'GET',
  });
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
