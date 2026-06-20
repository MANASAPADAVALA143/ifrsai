/**
 * Load user profile + firm from Supabase profiles table.
 */

import { supabase, isSupabaseConfigured } from './supabase';
import {
  PROFILE_FIRM_ID_KEY,
  USER_ROLE_KEY,
  isFirmWorkspaceManual,
  setFirmWorkspace,
  type FirmRecord,
} from './firm-workspace';

export interface UserProfile {
  firm_id: string;
  role: string;
  full_name?: string | null;
  firms?: FirmRecord | null;
}

export function getStoredUserRole(): string {
  if (typeof window === 'undefined') return 'member';
  return localStorage.getItem(USER_ROLE_KEY) || 'member';
}

export function isStoredUserAdmin(): boolean {
  return getStoredUserRole() === 'admin';
}

/** Load firm from profiles table and apply workspace (unless manual switch active). */
export async function loadUserFirmFromProfile(userId: string): Promise<UserProfile | null> {
  if (typeof window === 'undefined' || !isSupabaseConfigured || !supabase) return null;
  if (isFirmWorkspaceManual()) return null;

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('firm_id, role, full_name, firms(firm_id, firm_name, market, currency, slug)')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    if (error.code === '42P17') {
      console.warn('[profiles] RLS policy error — run backend/migrations/008_profiles_rls_fix.sql in Supabase');
    }
    return null;
  }
  if (!profile?.firm_id) return null;

  const firmRaw = profile.firms as FirmRecord | FirmRecord[] | null | undefined;
  const firm = Array.isArray(firmRaw) ? firmRaw[0] : firmRaw ?? null;
  const firmName = firm?.firm_name || profile.firm_id;

  localStorage.setItem(PROFILE_FIRM_ID_KEY, profile.firm_id);
  localStorage.setItem(USER_ROLE_KEY, profile.role || 'member');
  setFirmWorkspace(profile.firm_id, firmName, false);

  return {
    firm_id: profile.firm_id,
    role: profile.role || 'member',
    full_name: profile.full_name,
    firms: firm,
  };
}

export async function validateFirmCode(firmCode: string): Promise<FirmRecord | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  const code = firmCode.trim().toLowerCase();
  if (!code) return null;

  const { data, error } = await supabase
    .from('firms')
    .select('firm_id, firm_name, market, currency, slug')
    .eq('firm_id', code)
    .maybeSingle();

  if (error || !data) return null;
  return data as FirmRecord;
}

export async function upsertProfileForUser(
  userId: string,
  firmId: string,
  fullName: string,
  role = 'member'
): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;

  const { error } = await supabase.from('profiles').upsert(
    {
      id: userId,
      firm_id: firmId,
      role,
      full_name: fullName,
    },
    { onConflict: 'id' }
  );

  if (error) {
    console.warn('[profiles] upsert failed:', error.message);
  }
}

export async function fetchFirmsWithMemberCounts(): Promise<
  Array<FirmRecord & { member_count: number }>
> {
  if (!isSupabaseConfigured || !supabase) return [];

  const { data: firms, error: firmsErr } = await supabase
    .from('firms')
    .select('firm_id, firm_name, market, currency, slug, modules_enabled')
    .order('firm_name');

  if (firmsErr || !firms) return [];

  const { data: profiles } = await supabase.from('profiles').select('firm_id');

  const counts: Record<string, number> = {};
  for (const p of profiles || []) {
    const fid = String((p as { firm_id?: string }).firm_id || '');
    if (fid) counts[fid] = (counts[fid] || 0) + 1;
  }

  return firms.map((f) => ({
    ...(f as FirmRecord),
    member_count: counts[(f as FirmRecord).firm_id] || 0,
  }));
}

export function slugifyFirmCode(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
    .substring(0, 40);
}
