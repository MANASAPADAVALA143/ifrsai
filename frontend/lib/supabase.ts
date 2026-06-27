import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();

function createSafeClient(): SupabaseClient | null {
  if (!supabaseUrl || !supabaseAnonKey) return null;
  try {
    return createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
        // Bypass Navigator LockManager — stale cross-tab locks cause acquire timeouts in dev.
        lock: async (_name, _acquireTimeout, fn) => fn(),
      },
    });
  } catch (e) {
    console.error('[supabase] createClient failed; using demo auth.', e);
    return null;
  }
}

export const supabase: SupabaseClient | null = createSafeClient();

export const isSupabaseConfigured = !!supabase;

export type { User } from '@supabase/supabase-js';
