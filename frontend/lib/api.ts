const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

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
      throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
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

  uploadContract: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch(`${API_URL}/api/upload-contract`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`);
      }

      return { data: await response.json() };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Upload failed',
      };
    }
  },

  downloadReport: (fileId: string) => {
    return `${API_URL}/api/download/${fileId}`;
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
