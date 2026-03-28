import { useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase, transfers } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";

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

const QUERY_KEY = ["bank-accounts"] as const;

// Nigerian banks list (picker UI)
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

function mapRow(row: {
  id: string;
  bank_code: string;
  bank_name: string;
  account_number: string;
  account_name: string;
  is_default: boolean | null;
  is_verified: boolean | null;
  created_at: string;
}): BankAccount {
  return {
    id: row.id,
    bankName: row.bank_name,
    bankCode: row.bank_code,
    accountNumber: row.account_number,
    accountName: row.account_name,
    isDefault: Boolean(row.is_default),
    isVerified: Boolean(row.is_verified),
    createdAt: new Date(row.created_at),
  };
}

async function fetchBankAccounts(): Promise<BankAccount[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return [];

  const { data, error } = await supabase
    .from("bank_accounts")
    .select("id, bank_code, bank_name, account_number, account_name, is_default, is_verified, created_at")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []).map((r) => mapRow(r as Parameters<typeof mapRow>[0]));
}

async function getPublicUserId(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in required");
  const { data, error } = await supabase.from("users").select("id").eq("auth_id", user.id).maybeSingle();
  if (error || !data) throw new Error("Profile not ready");
  return data.id;
}

export const useBankAccounts = () => {
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuth();

  const { data: rawAccounts = [], isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchBankAccounts,
    enabled: isAuthenticated,
  });
  const accounts = isAuthenticated ? rawAccounts : [];

  const addMutation = useMutation({
    mutationFn: async ({
      bankCode,
      accountNumber,
      accountName,
      bankName,
    }: {
      bankCode: string;
      accountNumber: string;
      accountName: string;
      bankName: string;
    }) => {
      const verify = (await transfers.verifyBankAccount(bankCode, accountNumber)) as {
        account_name?: string;
      };
      const resolvedName = verify.account_name ?? accountName;
      const userId = await getPublicUserId();

      const { count, error: countErr } = await supabase
        .from("bank_accounts")
        .select("*", { count: "exact", head: true });
      if (countErr) throw countErr;
      const isDefault = (count ?? 0) === 0;

      const { data, error } = await supabase
        .from("bank_accounts")
        .insert({
          user_id: userId,
          bank_code: bankCode,
          bank_name: bankName,
          account_number: accountNumber,
          account_name: resolvedName,
          is_default: isDefault,
          is_verified: true,
          verified_at: new Date().toISOString(),
        })
        .select("id, bank_code, bank_name, account_number, account_name, is_default, is_verified, created_at")
        .single();

      if (error) throw error;
      return mapRow(data as Parameters<typeof mapRow>[0]);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  const removeMutation = useMutation({
    mutationFn: async (accountId: string) => {
      const { data: meta } = await supabase
        .from("bank_accounts")
        .select("user_id, is_default")
        .eq("id", accountId)
        .maybeSingle();
      const { error } = await supabase.from("bank_accounts").delete().eq("id", accountId);
      if (error) throw error;
      if (meta?.is_default && meta.user_id) {
        const { data: first } = await supabase
          .from("bank_accounts")
          .select("id")
          .eq("user_id", meta.user_id)
          .limit(1)
          .maybeSingle();
        if (first) {
          await supabase.from("bank_accounts").update({ is_default: true }).eq("id", first.id);
        }
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  const defaultMutation = useMutation({
    mutationFn: async (accountId: string) => {
      const { error } = await supabase.from("bank_accounts").update({ is_default: true }).eq("id", accountId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  const addBankAccount = useCallback(
    async (bankCode: string, accountNumber: string, accountName: string) => {
      const bank = NIGERIAN_BANKS.find((b) => b.code === bankCode);
      if (!bank) throw new Error("Invalid bank selected");
      return addMutation.mutateAsync({
        bankCode,
        accountNumber,
        accountName,
        bankName: bank.name,
      });
    },
    [addMutation]
  );

  const removeBankAccount = useCallback(
    async (accountId: string) => {
      await removeMutation.mutateAsync(accountId);
    },
    [removeMutation]
  );

  const setDefaultAccount = useCallback(
    async (accountId: string) => {
      await defaultMutation.mutateAsync(accountId);
    },
    [defaultMutation]
  );

  const getDefaultAccount = useCallback(() => {
    return accounts.find((a) => a.isDefault);
  }, [accounts]);

  const submitKYC = useCallback(() => Promise.resolve(), []);

  return {
    accounts,
    loading: isLoading || addMutation.isPending || removeMutation.isPending || defaultMutation.isPending,
    kycStatus: "none" as const,
    kycSubmittedAt: undefined as Date | undefined,
    kycVerifiedAt: undefined as Date | undefined,
    addBankAccount,
    removeBankAccount,
    setDefaultAccount,
    submitKYC,
    getDefaultAccount,
  };
};
