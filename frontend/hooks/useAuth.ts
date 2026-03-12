'use client';

import { useEffect, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useRouter } from 'next/navigation';

// Demo user type for when Supabase is not configured
type DemoUser = {
  id: string;
  email: string;
  user_metadata?: {
    company_id?: string;
    company_name?: string;
  };
};

export function useAuth() {
  const [user, setUser] = useState<User | DemoUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    if (!isSupabaseConfigured) {
      // Demo mode: Check localStorage for demo session
      const demoUser = localStorage.getItem('demo_user');
      if (demoUser) {
        setUser(JSON.parse(demoUser));
      }
      setLoading(false);
      return;
    }

    if (!supabase) {
      setLoading(false);
      return;
    }

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    if (!isSupabaseConfigured || !supabase) {
      // Demo mode: Accept any email/password combination
      const demoUser: DemoUser = {
        id: `demo-${Date.now()}`,
        email,
        user_metadata: {
          company_id: `COMP-${email.split('@')[0].toUpperCase()}-001`,
          company_name: email.split('@')[0],
        },
      };
      localStorage.setItem('demo_user', JSON.stringify(demoUser));
      setUser(demoUser);
      return { user: demoUser, session: null };
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;
    return data;
  };

  const signOut = async () => {
    if (!isSupabaseConfigured || !supabase) {
      // Demo mode: Clear localStorage
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

  const signUp = async (email: string, password: string, metadata?: any) => {
    if (!isSupabaseConfigured || !supabase) {
      // Demo mode: Same as sign in
      return signIn(email, password);
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: metadata,
      },
    });

    if (error) throw error;
    return data;
  };

  // Get company ID from user metadata
  const getCompanyId = (): string => {
    if (!user) return 'default-company';
    if ('user_metadata' in user && user.user_metadata?.company_id) {
      return user.user_metadata.company_id;
    }
    return user.id || 'default-company';
  };

  // Get company name from user metadata
  const getCompanyName = (): string => {
    if (!user) return 'Company';
    if ('user_metadata' in user && user.user_metadata?.company_name) {
      return user.user_metadata.company_name;
    }
    if ('email' in user && user.email) {
      return user.email.split('@')[0];
    }
    return 'Company';
  };

  return {
    user,
    loading,
    signIn,
    signOut,
    signUp,
    getCompanyId,
    getCompanyName,
    isAuthenticated: !!user,
  };
}
