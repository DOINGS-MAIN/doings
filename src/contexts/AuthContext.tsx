import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase, auth, isSupabaseConfigured, profileApi } from "@/lib/supabase";
import { invalidateAppUserCache } from "@/lib/appUser";
import type { SignUpResult } from "@/types/auth";

export type { SignUpResult } from "@/types/auth";

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
  avatar_url: string | null;
  avatar_data: Record<string, unknown> | null;
  kyc_level: number;
  status: string;
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  initialized: boolean;
  isAuthenticated: boolean;
  signInWithPassword: (email: string, password: string) => Promise<User | null>;
  signUpWithPassword: (
    email: string,
    password: string,
    firstName: string,
    lastName: string,
    username: string,
  ) => Promise<SignUpResult>;
  resetPasswordForEmail: (email: string) => Promise<void>;
  resendSignupEmail: (email: string) => Promise<void>;
  updatePassword: (newPassword: string) => Promise<void>;
  signInWithGoogle: () => Promise<unknown>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateProfile: (updates: { full_name?: string }) => Promise<void>;
  setUsername: (username: string) => Promise<void>;
  isUsernameAvailable: (username: string) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function useAuthState(): AuthContextValue {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [initialized, setInitialized] = useState(!isSupabaseConfigured);
  const authUserIdRef = useRef<string | null>(null);

  const fetchProfile = useCallback(async (authUserId: string) => {
    const { data, error } = await supabase
      .from("users")
      .select("id, phone, email, username, full_name, avatar_url, avatar_data, kyc_level, status")
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
      setSession(null);
      setUser(null);
      setProfile(null);
      setLoading(false);
      setInitialized(true);
      return;
    }

    const PROFILE_TIMEOUT_MS = 12_000;

    /**
     * Never `await` network/PostgREST inside `onAuthStateChange` — it can block the GoTrue client
     * so `getSession` never settles while a session exists in localStorage (infinite app loader).
     */
    const {
      data: { subscription },
    } = auth.onAuthStateChange((_event, nextSession) => {
      const nextUser = nextSession?.user ?? null;
      const priorAuthId = authUserIdRef.current;
      authUserIdRef.current = nextUser?.id ?? null;

      setSession(nextSession);
      setUser(nextUser);
      setLoading(false);
      setInitialized(true);
      setProfile((prev) => {
        if (!nextUser) return null;
        if (priorAuthId === nextUser.id) return prev;
        return null;
      });

      if (!nextUser) return;

      void withTimeout(fetchProfile(nextUser.id), PROFILE_TIMEOUT_MS, "fetchProfile")
        .then(async (loaded) => {
          if (authUserIdRef.current !== nextUser.id) return;

          let next = loaded;
          if (!next) {
            const { error } = await supabase.rpc("ensure_auth_user_profile");
            if (!error && authUserIdRef.current === nextUser.id) {
              next = await fetchProfile(nextUser.id);
            }
          }
          if (authUserIdRef.current !== nextUser.id) return;
          setProfile(next);
        })
        .catch((e) => {
          console.warn("useAuth: profile load error", e);
          if (authUserIdRef.current === nextUser.id) {
            setProfile(null);
          }
        });
    });

    const safety = window.setTimeout(() => {
      setInitialized((prev) => prev || true);
      setLoading(false);
    }, PROFILE_TIMEOUT_MS + 2000);

    return () => {
      window.clearTimeout(safety);
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  const signInWithPassword = useCallback(async (email: string, password: string) => {
    const { data, error } = await auth.signInWithPassword(email, password);
    if (error) {
      const msg = (error.message ?? "").toLowerCase();
      if (msg.includes("email not confirmed") || msg.includes("not confirmed")) {
        throw new Error(
          "Please verify your email first. Open the confirmation link we sent you, then try logging in again.",
        );
      }
      throw error;
    }
    return data.user;
  }, []);

  const signUpWithPassword = useCallback(
    async (
      email: string,
      password: string,
      firstName: string,
      lastName: string,
      username: string,
    ): Promise<SignUpResult> => {
      const { data, error } = await auth.signUpWithPassword(
        email,
        password,
        firstName,
        lastName,
        username,
      );
      if (error) throw error;
      const needsEmailConfirmation = Boolean(data.user) && !data.session;
      return { user: data.user ?? null, needsEmailConfirmation };
    },
    [],
  );

  const resetPasswordForEmail = useCallback(async (email: string) => {
    const { error } = await auth.resetPasswordForEmail(email);
    if (error) throw error;
  }, []);

  const resendSignupEmail = useCallback(async (email: string) => {
    const { error } = await auth.resendSignupEmail(email);
    if (error) throw error;
  }, []);

  const updatePassword = useCallback(async (newPassword: string) => {
    const { error } = await auth.updatePassword(newPassword);
    if (error) throw error;
  }, []);

  const signInWithGoogle = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    const join = params.get("join")?.trim().toUpperCase();
    const redirectTo = join
      ? `${window.location.origin}/events?join=${encodeURIComponent(join)}`
      : `${window.location.origin}/home`;
    const { data, error } = await auth.signInWithGoogle(redirectTo);
    if (error) throw error;
    return data;
  }, []);

  const signOut = useCallback(async () => {
    await auth.signOut();
    invalidateAppUserCache();
    setSession(null);
    setUser(null);
    setProfile(null);
    setLoading(false);
    setInitialized(true);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!user) return;
    const loaded = await fetchProfile(user.id);
    setProfile(loaded);
  }, [user, fetchProfile]);

  const updateProfile = useCallback(
    async (updates: { full_name?: string }) => {
      if (!user) return;
      const { error } = await supabase.from("users").update(updates).eq("auth_id", user.id);
      if (error) throw error;
      await refreshProfile();
    },
    [user, refreshProfile],
  );

  const setUsername = useCallback(
    async (username: string) => {
      if (!user) return;
      const { error } = await profileApi.setUsername(username);
      if (error) throw error;
      await refreshProfile();
    },
    [user, refreshProfile],
  );

  const isUsernameAvailable = useCallback(async (username: string) => {
    const { data, error } = await profileApi.isUsernameAvailable(username);
    if (error) throw error;
    return Boolean(data);
  }, []);

  return {
    session,
    user,
    profile,
    loading,
    initialized,
    isAuthenticated: !!session,
    signInWithPassword,
    signUpWithPassword,
    resetPasswordForEmail,
    resendSignupEmail,
    updatePassword,
    signInWithGoogle,
    signOut,
    refreshProfile,
    updateProfile,
    setUsername,
    isUsernameAvailable,
  };
}

/** Single auth subscription for the whole app — avoids duplicate listeners and profile fetches. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const value = useAuthState();
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
};
