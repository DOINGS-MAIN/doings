import { useState, useEffect, useCallback } from "react";
import { KYCLevel, KYCState, KYCStatus, KYCVerification } from "@/types/finance";

const KYC_STORAGE_KEY = "doings_kyc";

const getInitialState = (): KYCState => {
  if (typeof window === "undefined") {
    return {
      currentLevel: 0,
      verifications: [],
      bvnVerified: false,
      ninVerified: false,
      selfieVerified: false,
    };
  }

  const stored = localStorage.getItem(KYC_STORAGE_KEY);
  if (stored) {
    const parsed = JSON.parse(stored);
    return {
      ...parsed,
      verifications: parsed.verifications.map((v: KYCVerification) => ({
        ...v,
        verifiedAt: v.verifiedAt ? new Date(v.verifiedAt) : undefined,
        submittedAt: v.submittedAt ? new Date(v.submittedAt) : undefined,
      })),
    };
  }

  return {
    currentLevel: 0,
    verifications: [],
    bvnVerified: false,
    ninVerified: false,
    selfieVerified: false,
  };
};

export const useKYC = () => {
  const [state, setState] = useState<KYCState>(getInitialState);

  useEffect(() => {
    localStorage.setItem(KYC_STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  // Level 1: Phone + Email verification
  const verifyLevel1 = useCallback((phone: string, email: string, fullName: string) => {
    return new Promise<boolean>((resolve) => {
      // Simulate Dojah OTP verification
      setTimeout(() => {
        const verification: KYCVerification = {
          level: 1,
          status: "verified",
          provider: "dojah",
          providerRef: `DOJ-L1-${Date.now()}`,
          verifiedAt: new Date(),
          submittedAt: new Date(),
        };

        setState((prev) => ({
          ...prev,
          currentLevel: 1,
          verifications: [...prev.verifications, verification],
          personalInfo: {
            fullName,
            phone,
            email,
            dateOfBirth: prev.personalInfo?.dateOfBirth || "",
            address: prev.personalInfo?.address || "",
          },
        }));
        resolve(true);
      }, 2000);
    });
  }, []);

  // Level 2: BVN Validation (Dojah)
  const verifyLevel2 = useCallback((bvn: string, dateOfBirth: string) => {
    return new Promise<{ success: boolean; message: string }>((resolve) => {
      // Simulate Dojah BVN validation
      setTimeout(() => {
        // Mock: BVN must be 11 digits
        if (bvn.length !== 11) {
          resolve({ success: false, message: "Invalid BVN format" });
          return;
        }

        const verification: KYCVerification = {
          level: 2,
          status: "verified",
          provider: "dojah",
          providerRef: `DOJ-BVN-${Date.now()}`,
          verifiedAt: new Date(),
          submittedAt: new Date(),
          data: { bvnLastFour: bvn.slice(-4) },
        };

        setState((prev) => ({
          ...prev,
          currentLevel: 2,
          verifications: [...prev.verifications, verification],
          bvnVerified: true,
          bvnData: {
            bvn: bvn.slice(0, 4) + "****" + bvn.slice(-3),
            firstName: prev.personalInfo?.fullName?.split(" ")[0] || "User",
            lastName: prev.personalInfo?.fullName?.split(" ").slice(1).join(" ") || "",
            phoneNumber: prev.personalInfo?.phone || "",
            dateOfBirth,
          },
          personalInfo: {
            ...prev.personalInfo!,
            dateOfBirth,
          },
        }));

        resolve({ success: true, message: "BVN verified successfully" });
      }, 3000);
    });
  }, []);

  // Level 3: NIN + Selfie Verification (Dojah)
  const verifyLevel3 = useCallback((nin: string, selfieBase64: string) => {
    return new Promise<{ success: boolean; message: string; confidence?: number }>((resolve) => {
      // Simulate Dojah NIN + Selfie match
      setTimeout(() => {
        if (nin.length !== 11) {
          resolve({ success: false, message: "Invalid NIN format" });
          return;
        }

        // Mock confidence score
        const confidence = 92 + Math.random() * 8; // 92-100%

        const verification: KYCVerification = {
          level: 3,
          status: "verified",
          provider: "dojah",
          providerRef: `DOJ-NIN-SELFIE-${Date.now()}`,
          verifiedAt: new Date(),
          submittedAt: new Date(),
          data: { confidence: Math.round(confidence), ninLastFour: nin.slice(-4) },
        };

        setState((prev) => ({
          ...prev,
          currentLevel: 3,
          verifications: [...prev.verifications, verification],
          ninVerified: true,
          selfieVerified: true,
        }));

        resolve({
          success: true,
          message: "Identity fully verified",
          confidence: Math.round(confidence),
        });
      }, 4000);
    });
  }, []);

  const getVerificationForLevel = useCallback(
    (level: KYCLevel) => {
      return state.verifications.find((v) => v.level === level);
    },
    [state.verifications]
  );

  const meetsKYCRequirement = useCallback(
    (requiredLevel: KYCLevel) => {
      return state.currentLevel >= requiredLevel;
    },
    [state.currentLevel]
  );

  const resetKYC = useCallback(() => {
    setState({
      currentLevel: 0,
      verifications: [],
      bvnVerified: false,
      ninVerified: false,
      selfieVerified: false,
    });
    localStorage.removeItem(KYC_STORAGE_KEY);
  }, []);

  return {
    ...state,
    verifyLevel1,
    verifyLevel2,
    verifyLevel3,
    getVerificationForLevel,
    meetsKYCRequirement,
    resetKYC,
  };
};
