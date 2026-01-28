import { useState, useEffect, useCallback } from "react";

export interface BankAccount {
  id: string;
  bankName: string;
  bankCode: string;
  accountNumber: string;
  accountName: string;
  isDefault: boolean;
  isVerified: boolean;
  createdAt: Date;
}

interface BankAccountsState {
  accounts: BankAccount[];
  kycStatus: "none" | "pending" | "verified" | "rejected";
  kycSubmittedAt?: Date;
  kycVerifiedAt?: Date;
}

const BANK_ACCOUNTS_STORAGE_KEY = "doings_bank_accounts";

// Nigerian banks list
export const NIGERIAN_BANKS = [
  { code: "044", name: "Access Bank" },
  { code: "023", name: "Citibank Nigeria" },
  { code: "063", name: "Diamond Bank" },
  { code: "050", name: "Ecobank Nigeria" },
  { code: "084", name: "Enterprise Bank" },
  { code: "070", name: "Fidelity Bank" },
  { code: "011", name: "First Bank of Nigeria" },
  { code: "214", name: "First City Monument Bank" },
  { code: "058", name: "Guaranty Trust Bank" },
  { code: "030", name: "Heritage Bank" },
  { code: "301", name: "Jaiz Bank" },
  { code: "082", name: "Keystone Bank" },
  { code: "526", name: "Parallex Bank" },
  { code: "076", name: "Polaris Bank" },
  { code: "101", name: "Providus Bank" },
  { code: "221", name: "Stanbic IBTC Bank" },
  { code: "068", name: "Standard Chartered Bank" },
  { code: "232", name: "Sterling Bank" },
  { code: "100", name: "Suntrust Bank" },
  { code: "032", name: "Union Bank of Nigeria" },
  { code: "033", name: "United Bank for Africa" },
  { code: "215", name: "Unity Bank" },
  { code: "035", name: "Wema Bank" },
  { code: "057", name: "Zenith Bank" },
  { code: "999", name: "OPay" },
  { code: "998", name: "Palmpay" },
  { code: "997", name: "Kuda Bank" },
  { code: "996", name: "Moniepoint" },
];

const getInitialState = (): BankAccountsState => {
  if (typeof window === "undefined") {
    return { accounts: [], kycStatus: "none" };
  }

  const stored = localStorage.getItem(BANK_ACCOUNTS_STORAGE_KEY);
  if (stored) {
    const parsed = JSON.parse(stored);
    return {
      ...parsed,
      accounts: parsed.accounts.map((a: BankAccount) => ({
        ...a,
        createdAt: new Date(a.createdAt),
      })),
      kycSubmittedAt: parsed.kycSubmittedAt ? new Date(parsed.kycSubmittedAt) : undefined,
      kycVerifiedAt: parsed.kycVerifiedAt ? new Date(parsed.kycVerifiedAt) : undefined,
    };
  }

  return { accounts: [], kycStatus: "none" };
};

export const useBankAccounts = () => {
  const [state, setState] = useState<BankAccountsState>(getInitialState);

  useEffect(() => {
    localStorage.setItem(BANK_ACCOUNTS_STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const addBankAccount = useCallback((
    bankCode: string,
    accountNumber: string,
    accountName: string
  ) => {
    const bank = NIGERIAN_BANKS.find((b) => b.code === bankCode);
    if (!bank) throw new Error("Invalid bank selected");

    const newAccount: BankAccount = {
      id: `bank-${Date.now()}`,
      bankName: bank.name,
      bankCode,
      accountNumber,
      accountName,
      isDefault: state.accounts.length === 0,
      isVerified: true, // Simulated verification
      createdAt: new Date(),
    };

    setState((prev) => ({
      ...prev,
      accounts: [...prev.accounts, newAccount],
    }));

    return newAccount;
  }, [state.accounts.length]);

  const removeBankAccount = useCallback((accountId: string) => {
    setState((prev) => {
      const filtered = prev.accounts.filter((a) => a.id !== accountId);
      // If we removed the default, make the first one default
      if (filtered.length > 0 && !filtered.some((a) => a.isDefault)) {
        filtered[0].isDefault = true;
      }
      return { ...prev, accounts: filtered };
    });
  }, []);

  const setDefaultAccount = useCallback((accountId: string) => {
    setState((prev) => ({
      ...prev,
      accounts: prev.accounts.map((a) => ({
        ...a,
        isDefault: a.id === accountId,
      })),
    }));
  }, []);

  const submitKYC = useCallback(() => {
    setState((prev) => ({
      ...prev,
      kycStatus: "pending",
      kycSubmittedAt: new Date(),
    }));

    // Simulate KYC verification after 3 seconds
    setTimeout(() => {
      setState((prev) => ({
        ...prev,
        kycStatus: "verified",
        kycVerifiedAt: new Date(),
      }));
    }, 3000);
  }, []);

  const getDefaultAccount = useCallback(() => {
    return state.accounts.find((a) => a.isDefault);
  }, [state.accounts]);

  return {
    accounts: state.accounts,
    kycStatus: state.kycStatus,
    kycSubmittedAt: state.kycSubmittedAt,
    kycVerifiedAt: state.kycVerifiedAt,
    addBankAccount,
    removeBankAccount,
    setDefaultAccount,
    submitKYC,
    getDefaultAccount,
  };
};
