import { useState, useEffect, useCallback } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase, auth } from "@/lib/supabase";

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
    loading: true,
    initialized: false,
  });

  const fetchProfile = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from("users")
      .select("id, phone, full_name, kyc_level, status")
      .eq("id", userId)
      .single();
    return data as UserProfile | null;
  }, []);

  useEffect(() => {
    auth.getSession().then(async ({ data: { session } }) => {
      let profile: UserProfile | null = null;
      if (session?.user) {
        profile = await fetchProfile(session.user.id);
      }
      setState({
        session,
        user: session?.user ?? null,
        profile,
        loading: false,
        initialized: true,
      });
    });

    const { data: { subscription } } = auth.onAuthStateChange(
      async (_event, session) => {
        let profile: UserProfile | null = null;
        if (session?.user) {
          profile = await fetchProfile(session.user.id);
        }
        setState((prev) => ({
          ...prev,
          session,
          user: session?.user ?? null,
          profile,
          loading: false,
        }));
      }
    );

    return () => subscription.unsubscribe();
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
  };
};
