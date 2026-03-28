import { useState, useEffect, useCallback } from "react";
import { supabase, kyc } from "@/lib/supabase";
import { KYCLevel, KYCState, KYCVerification } from "@/types/finance";

export const useKYC = () => {
  const [state, setState] = useState<KYCState>({
    currentLevel: 0,
    verifications: [],
    bvnVerified: false,
    ninVerified: false,
    selfieVerified: false,
  });

  const fetchKYCState = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { data: user } = await supabase
      .from("users")
      .select("kyc_level, full_name, phone")
      .eq("id", session.user.id)
      .single();

    const { data: verifications } = await supabase
      .from("kyc_verifications")
      .select("*")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: true });

    const kycLevel = (user?.kyc_level ?? 0) as KYCLevel;
    const bvnVerified = kycLevel >= 2;
    const ninVerified = kycLevel >= 3;
    const selfieVerified = kycLevel >= 3;

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
      selfieVerified,
      personalInfo: user ? {
        fullName: user.full_name ?? "",
        phone: user.phone ?? "",
        email: "",
        dateOfBirth: "",
        address: "",
      } : undefined,
    });
  }, []);

  useEffect(() => {
    fetchKYCState();
  }, [fetchKYCState]);

  const verifyLevel1 = useCallback(async (phone: string, email: string, fullName: string) => {
    // Level 1 is auto-set on signup via Supabase Auth (phone OTP).
    // If user is authenticated, they already have level 1.
    await fetchKYCState();
    return true;
  }, [fetchKYCState]);

  const verifyLevel2 = useCallback(async (bvn: string, dateOfBirth: string) => {
    try {
      await kyc.verifyBvn(bvn, dateOfBirth);
      await fetchKYCState();
      return { success: true, message: "BVN verified successfully" };
    } catch (err: unknown) {
      return { success: false, message: err instanceof Error ? err.message : "BVN verification failed" };
    }
  }, [fetchKYCState]);

  const verifyLevel3 = useCallback(async (nin: string, selfieBase64: string) => {
    try {
      const result = await kyc.verifyNinSelfie(nin, selfieBase64);
      await fetchKYCState();
      return {
        success: true,
        message: "Identity fully verified",
        confidence: (result as Record<string, unknown>)?.confidence as number | undefined,
      };
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
    verifyLevel1,
    verifyLevel2,
    verifyLevel3,
    getVerificationForLevel,
    meetsKYCRequirement,
    refreshKYC: fetchKYCState,
  };
};
