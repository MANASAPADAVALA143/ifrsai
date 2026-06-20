'use client';

import { useEffect, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { setLeaseRepositoryAuthContext } from '@/lib/lease-repository';
import {
  applyFirmFromUserMetadata,
  getCurrentFirmId,
  getCurrentFirmName,
  resetFirmWorkspaceOnSignOut,
} from '@/lib/firm-workspace';
import {
  loadUserFirmFromProfile,
  upsertProfileForUser,
  validateFirmCode,
  type UserProfile,
} from '@/lib/user-profile';
import { useRouter } from 'next/navigation';

type DemoUser = {
  id: string;
  email: string;
  user_metadata?: {
    company_id?: string;
    company_name?: string;
  };
};

function readUserMetadata(u: User | DemoUser): {
  company_id?: string;
  company_name?: string;
} {
  const meta = 'user_metadata' in u ? u.user_metadata : undefined;
  const raw = meta as Record<string, unknown> | undefined;
  return {
    company_id:
      (raw?.company_id as string | undefined) ||
      (raw?.firm_id as string | undefined),
    company_name:
      (raw?.company_name as string | undefined) ||
      (raw?.firm_name as string | undefined),
  };
}

async function applyAuthContext(u: User | DemoUser | null): Promise<UserProfile | null> {
  if (!u || typeof window === 'undefined') return null;

  let userForMeta: User | DemoUser = u;

  if (isSupabaseConfigured && supabase && 'id' in u && !String(u.id).startsWith('demo-')) {
    try {
      const { data } = await supabase.auth.getUser();
      if (data.user) userForMeta = data.user;
    } catch {
      /* use session user */
    }

    const profile = await loadUserFirmFromProfile(userForMeta.id);
    if (profile?.firm_id) {
      setLeaseRepositoryAuthContext(profile.firm_id, userForMeta.id);
      return profile;
    }
  }

  const meta = readUserMetadata(userForMeta);
  const email = 'email' in userForMeta ? userForMeta.email : undefined;
  const { firmId } = applyFirmFromUserMetadata(meta, email);
  setLeaseRepositoryAuthContext(firmId, userForMeta.id);
  return null;
}

export function useAuth() {
  const [user, setUser] = useState<User | DemoUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    if (!isSupabaseConfigured) {
      const demoUser = localStorage.getItem('demo_user');
      if (demoUser) {
        try {
          const parsed = JSON.parse(demoUser) as User | DemoUser;
          setUser(parsed);
          void applyAuthContext(parsed).then(setProfile);
        } catch {
          localStorage.removeItem('demo_user');
          setUser(null);
        }
      }
      setLoading(false);
      return;
    }

    if (!supabase) {
      setLoading(false);
      return;
    }

    supabase.auth
      .getSession()
      .then(async ({ data: { session } }) => {
        const u = session?.user ?? null;
        setUser(u);
        if (u) {
          const p = await applyAuthContext(u);
          setProfile(p);
        }
        setLoading(false);
      })
      .catch(() => {
        setUser(null);
        setLoading(false);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      if (u) {
        void applyAuthContext(u).then(setProfile);
      } else {
        setProfile(null);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    if (!isSupabaseConfigured || !supabase) {
      const demoUser: DemoUser = {
        id: `demo-${Date.now()}`,
        email,
        user_metadata: {
          company_id: 'emaar-dev',
          company_name: 'Emaar Development LLC',
        },
      };
      localStorage.setItem('demo_user', JSON.stringify(demoUser));
      setUser(demoUser);
      const p = await applyAuthContext(demoUser);
      setProfile(p);
      return { user: demoUser, session: null };
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;
    if (data.user) {
      const p = await applyAuthContext(data.user);
      setProfile(p);
    }
    return data;
  };

  const signOut = async () => {
    resetFirmWorkspaceOnSignOut();
    setProfile(null);
    if (!isSupabaseConfigured || !supabase) {
      localStorage.removeItem('demo_user');
      setUser(null);
      router.push('/login');
      return;
    }

    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    setUser(null);
    router.push('/login');
  };

  const signUp = async (email: string, password: string, firmCode: string) => {
    if (!isSupabaseConfigured || !supabase) {
      return signIn(email, password);
    }

    const firm = await validateFirmCode(firmCode);
    if (!firm) {
      throw new Error('Invalid company code. Check the code from your administrator.');
    }

    const fullName = email.split('@')[0];

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          firm_id: firm.firm_id,
          full_name: fullName,
          role: 'member',
        },
      },
    });

    if (error) throw error;
    if (!data.user) throw new Error('Signup failed — no user returned');

    await upsertProfileForUser(data.user.id, firm.firm_id, fullName, 'member');

    const p = await applyAuthContext(data.user);
    setProfile(p);
    setUser(data.user);
    return data;
  };

  const getCompanyId = (): string => getCurrentFirmId();

  const getCompanyName = (): string => {
    const fromWorkspace = getCurrentFirmName();
    if (fromWorkspace !== 'My Workspace') return fromWorkspace;
    if (profile?.firms?.firm_name) return profile.firms.firm_name;
    if (!user) return 'Company';
    if ('user_metadata' in user && user.user_metadata?.company_name) {
      return user.user_metadata.company_name;
    }
    if ('email' in user && user.email) {
      return user.email.split('@')[0];
    }
    return 'Company';
  };

  const isAdmin = profile?.role === 'admin';

  return {
    user,
    profile,
    loading,
    signIn,
    signOut,
    signUp,
    getCompanyId,
    getCompanyName,
    isAdmin,
    isAuthenticated: !!user,
  };
}
