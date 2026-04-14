const ERP_CODES_KEY = 'erp_account_codes';

export interface ErpAccountMapping {
  rou_asset: string;
  lease_liability: string;
  lease_liability_current: string;
  lease_liability_non_current: string;
  interest_expense: string;
  depreciation: string;
  cash: string;
  acc_dep_rou: string;
}

const defaults: ErpAccountMapping = {
  rou_asset: '',
  lease_liability: '',
  lease_liability_current: '',
  lease_liability_non_current: '',
  interest_expense: '',
  depreciation: '',
  cash: '',
  acc_dep_rou: '',
};

export function getErpAccountCodes(): ErpAccountMapping {
  if (typeof window === 'undefined') return { ...defaults };
  try {
    const raw = localStorage.getItem(ERP_CODES_KEY);
    if (!raw) return { ...defaults };
    const parsed = JSON.parse(raw);
    return { ...defaults, ...parsed };
  } catch {
    return { ...defaults };
  }
}

export function saveErpAccountCodes(mapping: ErpAccountMapping): void {
  localStorage.setItem(ERP_CODES_KEY, JSON.stringify(mapping));
}
