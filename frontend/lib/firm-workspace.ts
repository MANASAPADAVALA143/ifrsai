/**
 * Multi-tenant workspace — firms + firm_id (not companies).
 * Source of truth for X-Firm-Id header and sidebar workspace display.
 */

import { supabase, isSupabaseConfigured } from './supabase';
import { getDefaultIfrs16Currency } from './ifrs16-currency';

export const CURRENT_FIRM_ID_KEY = 'current_firm_id';
export const CURRENT_FIRM_NAME_KEY = 'current_firm_name';
export const LEGACY_FIRM_ID_KEY = 'firm_id';
export const FIRM_MANUAL_KEY = 'firm_workspace_manual';
/** Set on login from profiles.firm_id */
export const PROFILE_FIRM_ID_KEY = 'profile_firm_id';
export const USER_ROLE_KEY = 'user_role';
/** Legacy — user_metadata.company_id (fallback only) */
export const METADATA_FIRM_ID_KEY = 'metadata_firm_id';

export interface FirmRecord {
  firm_id: string;
  firm_name: string;
  market?: string | null;
  currency?: string | null;
  slug?: string | null;
}

const DEMO_FIRMS: FirmRecord[] = [
  { firm_id: 'emaar-dev', firm_name: 'Emaar Development LLC', market: 'UAE', currency: 'AED' },
  { firm_id: 'aldar-dev', firm_name: 'Aldar Properties PJSC', market: 'UAE', currency: 'AED' },
];

/** True when firm_id looks like an email domain (yahoo.com) not a workspace slug (emaar-dev). */
export function isLikelyEmailDomainFirmId(firmId: string): boolean {
  const id = firmId.trim().toLowerCase();
  if (!id || id === 'default') return false;
  // Workspace slugs use hyphens; email domains use dots (yahoo.com, gmail.com)
  return id.includes('.') && !id.includes('-');
}

/**
 * Resolve firm_id priority:
 * 1. manual workspace switch (current_firm_id)
 * 2. user_metadata.company_id
 * 3. stored workspace slug (non email-domain)
 * 4. email domain (last resort)
 * 5. default
 */
export function resolveFirmId(options: {
  metaCompanyId?: string | null;
  storedFirmId?: string | null;
  userEmail?: string | null;
  manual?: boolean;
}): string {
  const stored = options.storedFirmId?.trim();
  if (options.manual && stored) return stored;

  const fromMeta = options.metaCompanyId?.trim();
  if (fromMeta) return fromMeta;

  if (stored && !isLikelyEmailDomainFirmId(stored)) return stored;

  const fromEmail = options.userEmail?.includes('@')
    ? options.userEmail.split('@')[1]?.trim().toLowerCase()
    : undefined;
  if (fromEmail) return fromEmail;

  if (stored) return stored;
  return 'default';
}

export function getCurrentFirmId(): string {
  if (typeof window === 'undefined') return 'default';

  const manual = isFirmWorkspaceManual();
  const current = localStorage.getItem(CURRENT_FIRM_ID_KEY)?.trim();
  const legacy = localStorage.getItem(LEGACY_FIRM_ID_KEY)?.trim();
  const profileFirm = localStorage.getItem(PROFILE_FIRM_ID_KEY)?.trim();
  const metaFirm = localStorage.getItem(METADATA_FIRM_ID_KEY)?.trim();

  if (manual && current) return current;
  if (profileFirm) return profileFirm;
  if (metaFirm) return metaFirm;
  if (current && !isLikelyEmailDomainFirmId(current)) return current;
  if (legacy && !isLikelyEmailDomainFirmId(legacy)) return legacy;
  if (current) return current;
  if (legacy) return legacy;
  return 'default';
}

export function getCurrentFirmName(): string {
  if (typeof window === 'undefined') return 'My Workspace';
  return localStorage.getItem(CURRENT_FIRM_NAME_KEY) || 'My Workspace';
}

export function isFirmWorkspaceManual(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(FIRM_MANUAL_KEY) === 'true';
}

export function setFirmWorkspace(firmId: string, firmName: string, manual: boolean): void {
  if (typeof window === 'undefined') return;
  const id = firmId.trim();
  localStorage.setItem(CURRENT_FIRM_ID_KEY, id);
  localStorage.setItem(CURRENT_FIRM_NAME_KEY, firmName.trim());
  localStorage.setItem(LEGACY_FIRM_ID_KEY, id);
  if (manual) {
    localStorage.setItem(FIRM_MANUAL_KEY, 'true');
  } else {
    localStorage.removeItem(FIRM_MANUAL_KEY);
  }
}

export function applyFirmFromUserMetadata(
  meta: { company_id?: string; company_name?: string } | undefined,
  userEmail?: string | null
): { firmId: string; firmName: string } {
  if (typeof window === 'undefined') {
    return { firmId: 'default', firmName: 'My Workspace' };
  }

  const manual = isFirmWorkspaceManual();
  const stored =
    localStorage.getItem(CURRENT_FIRM_ID_KEY) ||
    localStorage.getItem(LEGACY_FIRM_ID_KEY) ||
    undefined;

  const firmId = resolveFirmId({
    metaCompanyId: meta?.company_id,
    storedFirmId: stored,
    userEmail,
    manual,
  });

  const firmName =
    (meta?.company_name && String(meta.company_name).trim()) ||
    (userEmail ? userEmail.split('@')[0] : 'My Workspace');

  const fromMeta = meta?.company_id?.trim();
  if (fromMeta) {
    localStorage.setItem(METADATA_FIRM_ID_KEY, fromMeta);
  } else if (!manual) {
    localStorage.removeItem(METADATA_FIRM_ID_KEY);
  }

  if (!manual || fromMeta) {
    setFirmWorkspace(firmId, firmName, manual && !fromMeta);
  } else {
    setFirmWorkspace(firmId, firmName, true);
  }

  return { firmId: getCurrentFirmId(), firmName: getCurrentFirmName() };
}

export function clearFirmWorkspaceCaches(): void {
  if (typeof window === 'undefined') return;
  const keys = [
    'lease_repository',
    'ifrs16_leases',
    'ifrs16_server_migration_done',
    'ecl_portfolio_repository',
    'ifrs9_server_migration_done',
  ];
  keys.forEach((k) => localStorage.removeItem(k));
}

export function resetFirmWorkspaceOnSignOut(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(CURRENT_FIRM_ID_KEY);
  localStorage.removeItem(CURRENT_FIRM_NAME_KEY);
  localStorage.removeItem(LEGACY_FIRM_ID_KEY);
  localStorage.removeItem(METADATA_FIRM_ID_KEY);
  localStorage.removeItem(PROFILE_FIRM_ID_KEY);
  localStorage.removeItem(USER_ROLE_KEY);
  localStorage.removeItem(FIRM_MANUAL_KEY);
  clearFirmWorkspaceCaches();
}

export function switchFirmWorkspace(firmId: string, firmName: string): void {
  clearFirmWorkspaceCaches();
  setFirmWorkspace(firmId, firmName, true);
  window.location.reload();
}

export function getCurrentFirmCurrency(): string {
  if (typeof window === 'undefined') return 'AED';
  const firmId = getCurrentFirmId();
  const demo = DEMO_FIRMS.find((f) => f.firm_id === firmId);
  if (demo?.currency) return demo.currency.toUpperCase();
  const firmIdLower = firmId.toLowerCase();
  const firmName = getCurrentFirmName().toLowerCase();
  if (
    firmIdLower.includes('uae') ||
    firmIdLower.includes('emaar') ||
    firmIdLower.includes('aldar') ||
    firmName.includes('uae') ||
    firmName.includes('emaar') ||
    firmName.includes('aldar')
  ) {
    return 'AED';
  }
  return getDefaultIfrs16Currency();
}

export async function fetchAvailableFirms(): Promise<FirmRecord[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase
      .from('firms')
      .select('firm_id, firm_name, market, currency, slug')
      .order('firm_name');
    if (!error && data && data.length > 0) {
      return data as FirmRecord[];
    }
  }
  return DEMO_FIRMS;
}
