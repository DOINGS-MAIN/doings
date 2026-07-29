import { useState, useEffect, useCallback } from "react";
import { supabase, kyc } from "@/lib/supabase";
import { getAppUserId } from "@/lib/appUser";
import { getValidSession, refreshCachedSession } from "@/lib/authSession";
import { KYCLevel, KYCState, KYCVerification } from "@/types/finance";

export const useKYC = () => {
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<KYCState>({
    currentLevel: 0,
    verifications: [],
    bvnVerified: false,
    ninVerified: false,
  });

  const fetchKYCState = useCallback(async () => {
    setLoading(true);
    try {
      let appUserId = await getAppUserId();
      if (!appUserId) {
        setState({
          currentLevel: 0,
          verifications: [],
          bvnVerified: false,
          ninVerified: false,
        });
        return;
      }

      let { data: user } = await supabase
        .from("users")
        .select("id, kyc_level, full_name, phone, email")
        .eq("id", appUserId)
        .maybeSingle();

      if (!user?.id) {
        await supabase.rpc("ensure_auth_user_profile");
        appUserId = await getAppUserId();
        if (!appUserId) {
          setState({
            currentLevel: 0,
            verifications: [],
            bvnVerified: false,
            ninVerified: false,
          });
          return;
        }
        const again = await supabase
          .from("users")
          .select("id, kyc_level, full_name, phone, email")
          .eq("id", appUserId)
          .maybeSingle();
        user = again.data;
      }

      if (!user?.id) {
        setState({
          currentLevel: 0,
          verifications: [],
          bvnVerified: false,
          ninVerified: false,
        });
        return;
      }

      const { data: verifications } = await supabase
        .from("kyc_verifications")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true });

      const kycLevel = (user?.kyc_level ?? 0) as KYCLevel;
      const bvnVerified = kycLevel >= 2;
      const ninVerified = kycLevel >= 2;

      const mapped: KYCVerification[] = (verifications ?? []).map((v: Record<string, unknown>) => ({
        level: v.level as KYCLevel,
        status: v.status as KYCVerification["status"],
        provider: "dojah" as const,
        providerRef: v.provider_ref as string,
        verifiedAt: v.verified_at ? new Date(v.verified_at as string) : undefined,
        submittedAt: v.created_at ? new Date(v.created_at as string) : undefined,
      }));

      setState({
        currentLevel: kycLevel,
        verifications: mapped,
        bvnVerified,
        ninVerified,
        personalInfo: user ? {
          fullName: user.full_name ?? "",
          phone: user.phone ?? "",
          email: user.email ?? "",
          dateOfBirth: "",
          address: "",
        } : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKYCState();
  }, [fetchKYCState]);

  const verifyLevel1 = useCallback(async (action: "resend" | "check") => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.email) {
      return { success: false, message: "No email on file for this account." };
    }

    // Supabase auth.resend({ type: "signup" }) returns 200 and sends nothing when
    // the address is already confirmed — don't claim we emailed in that case.
    if (user.email_confirmed_at) {
      await fetchKYCState();
      return {
        success: true,
        message: "Your email is already verified. Tap “I’ve confirmed my email” if your level hasn’t updated yet.",
      };
    }

    if (action === "resend") {
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: user.email,
        options: {
          emailRedirectTo: origin ? `${origin}/auth/callback` : undefined,
        },
      });
      if (error) return { success: false, message: error.message };
      return {
        success: true,
        message: "Confirmation email sent. Check inbox and spam, then open the link.",
      };
    }

    await refreshCachedSession();
    await fetchKYCState();
    const session = await getValidSession();
    if (session?.user?.email_confirmed_at) {
      return { success: true, message: "Email verified — you can receive in-app transfers and giveaways." };
    }
    return { success: false, message: "Not confirmed yet. Open the link in your email, then tap again." };
  }, [fetchKYCState]);

  const verifyLevel2 = useCallback(async (bvn: string, nin: string, dateOfBirth: string) => {
    try {
      const result = await kyc.verifyBvnAndNin(bvn, nin, dateOfBirth || undefined) as {
        va_pending?: boolean;
        message?: string;
        va_error?: string;
      };
      await fetchKYCState();
      if (result.va_pending) {
        return {
          success: true,
          message: result.message ||
            "Identity verified. Open Fund Wallet to finish setting up your transfer account.",
        };
      }
      return { success: true, message: "BVN, NIN, and bank transfer account are ready." };
    } catch (err: unknown) {
      return { success: false, message: err instanceof Error ? err.message : "Verification failed" };
    }
  }, [fetchKYCState]);

  const getVerificationForLevel = useCallback(
    (level: KYCLevel) => state.verifications.find((v) => v.level === level),
    [state.verifications]
  );

  const meetsKYCRequirement = useCallback(
    (requiredLevel: KYCLevel) => state.currentLevel >= requiredLevel,
    [state.currentLevel]
  );

  return {
    ...state,
    loading,
    kycLoading: loading,
    verifyLevel1,
    verifyLevel2,
    getVerificationForLevel,
    meetsKYCRequirement,
    refreshKYC: fetchKYCState,
  };
};
