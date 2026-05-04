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
  phone: string | null;
  email: string | null;
  username: string | null;
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
      .select("id, phone, email, username, full_name, kyc_level, status")
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

  const signInWithPassword = useCallback(async (email: string, password: string) => {
    const { data, error } = await auth.signInWithPassword(email, password);
    if (error) throw error;
    return data.user;
  }, []);

  const signUpWithPassword = useCallback(
    async (email: string, password: string, firstName: string, lastName: string, username: string) => {
      const { data, error } = await auth.signUpWithPassword(email, password, firstName, lastName, username);
      if (error) throw error;
      return data.user;
    },
    []
  );

  const signInWithGoogle = useCallback(async () => {
    const redirectTo = `${window.location.origin}/`;
    const { data, error } = await auth.signInWithGoogle(redirectTo);
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
    signInWithPassword,
    signUpWithPassword,
    signInWithGoogle,
    signOut,
    refreshProfile,
    updateProfile,
  };
};
