import { useState, useEffect, useCallback } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase, auth, isSupabaseConfigured } from "@/lib/supabase";

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise
      .then((v) => {
        clearTimeout(t);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(t);
        reject(e);
      });
  });
}

export interface UserProfile {
  id: string;
  phone: string;
  full_name: string | null;
  kyc_level: number;
  status: string;
}

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  initialized: boolean;
}

export const useAuth = () => {
  const [state, setState] = useState<AuthState>({
    session: null,
    user: null,
    profile: null,
    loading: isSupabaseConfigured,
    initialized: !isSupabaseConfigured,
  });

  const fetchProfile = useCallback(async (authUserId: string) => {
    const { data, error } = await supabase
      .from("users")
      .select("id, phone, full_name, kyc_level, status")
      .eq("auth_id", authUserId)
      .maybeSingle();
    if (error) {
      console.warn("useAuth: profile fetch failed", error.message);
      return null;
    }
    return data as UserProfile | null;
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setState({
        session: null,
        user: null,
        profile: null,
        loading: false,
        initialized: true,
      });
      return;
    }

    const PROFILE_TIMEOUT_MS = 12_000;

    /**
     * Never `await` network/PostgREST inside `onAuthStateChange` — it can block the GoTrue client
     * so `getSession` never settles while a session exists in localStorage (infinite app loader).
     * See: https://github.com/supabase/supabase-js/issues (auth callback must return quickly)
     */
    const { data: { subscription } } = auth.onAuthStateChange((_event, session) => {
      const user = session?.user ?? null;

      setState((prev) => ({
        ...prev,
        session,
        user,
        loading: false,
        initialized: true,
        profile: !user ? null : prev.user?.id === user.id ? prev.profile : null,
      }));

      if (!user) return;

      void withTimeout(fetchProfile(user.id), PROFILE_TIMEOUT_MS, "fetchProfile")
        .then((profile) => {
          setState((prev) => {
            if (prev.user?.id !== user.id) return prev;
            return { ...prev, profile };
          });
        })
        .catch((e) => {
          console.warn("useAuth: profile load error", e);
          setState((prev) => (prev.user?.id === user.id ? { ...prev, profile: null } : prev));
        });
    });

    // Safety: if nothing is emitted (older clients), unblock the UI
    const safety = window.setTimeout(() => {
      setState((prev) =>
        prev.initialized ? prev : { ...prev, loading: false, initialized: true }
      );
    }, PROFILE_TIMEOUT_MS + 2000);

    return () => {
      window.clearTimeout(safety);
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  const sendOtp = useCallback(async (phone: string) => {
    const fullPhone = phone.startsWith("+") ? phone : `+234${phone}`;
    const { error } = await auth.signInWithOtp(fullPhone);
    if (error) throw error;
  }, []);

  const verifyOtp = useCallback(async (phone: string, token: string) => {
    const fullPhone = phone.startsWith("+") ? phone : `+234${phone}`;
    const { data, error } = await auth.verifyOtp(fullPhone, token);
    if (error) throw error;
    return data;
  }, []);

  const signOut = useCallback(async () => {
    await auth.signOut();
    setState({
      session: null,
      user: null,
      profile: null,
      loading: false,
      initialized: true,
    });
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!state.user) return;
    const profile = await fetchProfile(state.user.id);
    setState((prev) => ({ ...prev, profile }));
  }, [state.user, fetchProfile]);

  const updateProfile = useCallback(async (updates: { full_name?: string }) => {
    if (!state.user) return;
    const { error } = await supabase
      .from("users")
      .update(updates)
      .eq("auth_id", state.user.id);
    if (error) throw error;
    await refreshProfile();
  }, [state.user, refreshProfile]);

  return {
    session: state.session,
    user: state.user,
    profile: state.profile,
    loading: state.loading,
    initialized: state.initialized,
    isAuthenticated: !!state.session,
    sendOtp,
    verifyOtp,
    signOut,
    refreshProfile,
    updateProfile,
  };
};
