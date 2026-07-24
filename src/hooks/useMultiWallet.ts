import { useState, useEffect, useCallback } from "react";
import { getAppUserId } from "@/lib/appUser";
import { supabase, wallet, withdrawals } from "@/lib/supabase";
import {
  Currency,
  FinanceTransaction,
  MonnifyReservedAccount,
  NgnReservedAccount,
  BlockradarAddress,
  WithdrawalFeeSettings,
} from "@/types/finance";
import { DEFAULT_WITHDRAWAL_FEE_SETTINGS } from "@/lib/withdrawalFees";

const toDisplay = (koboOrMicro: number, currency: Currency) =>
  currency === "NGN" ? koboOrMicro / 100 : koboOrMicro / 1_000_000;

const toSmallest = (display: number, currency: Currency) =>
  currency === "NGN" ? Math.round(display * 100) : Math.round(display * 1_000_000);

export const useMultiWallet = () => {
  const [ngnBalance, setNgnBalance] = useState(0);
  const [usdcBalance, setUsdcBalance] = useState(0);
  const [transactions, setTransactions] = useState<FinanceTransaction[]>([]);
  const [ngnReservedAccount, setNgnReservedAccount] = useState<NgnReservedAccount | undefined>();
  const [fundingProviderId, setFundingProviderId] = useState<string>("monnify");
  const [blockradarAddresses, setBlockradarAddresses] = useState<BlockradarAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [withdrawalFeeSettings, setWithdrawalFeeSettings] = useState<WithdrawalFeeSettings>(
    DEFAULT_WITHDRAWAL_FEE_SETTINGS
  );

  const fetchWallets = useCallback(async () => {
    const appUserId = await getAppUserId();
    if (!appUserId) return;

    const { data: wallets } = await supabase
      .from("wallets")
      .select("currency, balance, locked_balance")
      .eq("user_id", appUserId);

    setNgnBalance(0);
    setUsdcBalance(0);
    if (wallets) {
      for (const w of wallets) {
        if (w.currency === "NGN") setNgnBalance(toDisplay(w.balance, "NGN"));
        if (w.currency === "USDC") setUsdcBalance(toDisplay(w.balance, "USDC"));
      }
    }
  }, []);

  const fetchTransactions = useCallback(async () => {
    const appUserId = await getAppUserId();
    if (!appUserId) return;

    const { data: txns } = await supabase
      .from("transactions")
      .select("*")
      .eq("user_id", appUserId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (txns) {
      setTransactions(
        txns.map((t: Record<string, unknown>) => ({
          id: t.id as string,
          walletId: (t.wallet_id as string) ?? "",
          currency: t.currency as Currency,
          type: t.type as FinanceTransaction["type"],
          amount: toDisplay(t.amount as number, t.currency as Currency),
          fee: toDisplay((t.fee as number) ?? 0, t.currency as Currency),
          netAmount: toDisplay(t.amount as number, t.currency as Currency),
          status: t.status as FinanceTransaction["status"],
          provider: t.provider as FinanceTransaction["provider"],
          providerRef: t.provider_ref as string,
          idempotencyKey: t.idempotency_key as string,
          description: (t.description as string) ?? "",
          metadata: (t.metadata as Record<string, unknown>) ?? undefined,
          createdAt: new Date(t.created_at as string),
          completedAt: t.completed_at ? new Date(t.completed_at as string) : undefined,
        }))
      );
    }
  }, []);

  const fetchNgnReservedAccount = useCallback(async () => {
    const appUserId = await getAppUserId();
    if (!appUserId) return;

    const { data: providerId } = await wallet.getWalletFundingProvider();
    const provider = (providerId as string) || "monnify";
    setFundingProviderId(provider);

    const { data } = await supabase
      .from("reserved_accounts")
      .select("*")
      .eq("user_id", appUserId)
      .eq("provider_id", provider)
      .limit(1)
      .maybeSingle();

    if (data) {
      setNgnReservedAccount({
        accountReference: data.account_reference,
        accountName: data.account_name,
        accountNumber: data.account_number,
        bankName: data.bank_name,
        bankCode: data.bank_code,
        reservationReference: data.reservation_reference,
        status: data.status,
        providerId: data.provider_id,
      });
    } else {
      setNgnReservedAccount(undefined);
    }
  }, []);

  const fetchBlockradarAddresses = useCallback(async () => {
    const appUserId = await getAppUserId();
    if (!appUserId) return;

    const { data: wallets } = await supabase.from("wallets").select("id").eq("user_id", appUserId);
    const walletIds = wallets?.map((w) => w.id) ?? [];
    if (walletIds.length === 0) {
      setBlockradarAddresses([]);
      return;
    }

    const { data } = await supabase
      .from("wallet_addresses")
      .select("*")
      .in("wallet_id", walletIds)
      .eq("provider", "blockradar");

    if (data) {
      setBlockradarAddresses(
        data.map((a: Record<string, unknown>) => ({
          address: a.address as string,
          network: (a.network as string) ?? "SOLANA",
          blockchain: (a.blockchain as string) ?? "Solana",
          walletId: a.wallet_id as string,
        }))
      );
    } else {
      setBlockradarAddresses([]);
    }
  }, []);

  const fetchWithdrawalFeeSettings = useCallback(async () => {
    const { data } = await wallet.getWithdrawalFeeSettings();
    if (data) {
      const row = data as {
        platform_fee_percent?: number;
        transaction_fee_naira?: number;
      };
      setWithdrawalFeeSettings({
        platformFeePercent: Number(row.platform_fee_percent ?? 0),
        transactionFeeNaira: Number(row.transaction_fee_naira ?? 50),
      });
    }
  }, []);

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      await Promise.all([
        fetchWallets(),
        fetchTransactions(),
        fetchNgnReservedAccount(),
        fetchBlockradarAddresses(),
        fetchWithdrawalFeeSettings(),
      ]);
      if (!cancelled) setLoading(false);
    };

    const setupRealtime = async () => {
      await load();
      const appUserId = await getAppUserId();
      if (!appUserId || cancelled) return;

      channel = supabase
        .channel(`wallet-${appUserId}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "wallets", filter: `user_id=eq.${appUserId}` },
          () => { void fetchWallets(); },
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "transactions", filter: `user_id=eq.${appUserId}` },
          () => {
            void fetchTransactions();
            void fetchWallets();
          },
        )
        .subscribe();
    };

    void setupRealtime();

    const refreshOnVisible = () => {
      if (document.visibilityState === "visible") {
        void fetchWallets();
        void fetchTransactions();
      }
    };
    document.addEventListener("visibilitychange", refreshOnVisible);
    window.addEventListener("focus", refreshOnVisible);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", refreshOnVisible);
      window.removeEventListener("focus", refreshOnVisible);
      if (channel) supabase.removeChannel(channel);
    };
  }, [fetchWallets, fetchTransactions, fetchNgnReservedAccount, fetchBlockradarAddresses, fetchWithdrawalFeeSettings]);

  const createNgnAccount = useCallback(
    async (bvn?: string) => {
      const digits = bvn?.replace(/\D/g, "") ?? "";
      if (
        (fundingProviderId === "monnify" || fundingProviderId === "flutterwave") &&
        digits.length !== 11
      ) {
        throw new Error("BVN must be 11 digits");
      }
      const result = await wallet.createNgnAccount(digits || undefined);
      await fetchNgnReservedAccount();
      const account = (result as { account?: NgnReservedAccount })?.account;
      if (!account) throw new Error("Failed to create funding account");
      return account;
    },
    [fetchNgnReservedAccount, fundingProviderId]
  );

  const createMonnifyAccount = useCallback(
    async (bvn: string) => createNgnAccount(bvn),
    [createNgnAccount]
  );

  const createBlockradarAddress = useCallback(async (network: string = "SOLANA") => {
    const result = (await wallet.createBlockradarAddress(network)) as {
      address?: string;
      network?: string;
      error?: string;
    };
    if (!result?.address) {
      throw new Error(result?.error || "Failed to generate USDC deposit address");
    }
    await fetchBlockradarAddresses();
    return {
      address: result.address,
      network: result.network ?? network,
      blockchain: "Solana",
      walletId: "",
    } satisfies BlockradarAddress;
  }, [fetchBlockradarAddresses]);

  const creditWallet = useCallback(
    (_currency: Currency, _amount: number, _description: string, _provider?: string, _type?: string, _fee?: number) => {
      // Credits happen via webhooks on the backend, not from the frontend.
      // This is a no-op stub to keep the Index.tsx interface stable.
      // Realtime subscription will update balances automatically.
    },
    []
  );

  const debitWallet = useCallback(
    (_currency: Currency, _amount: number, _description: string, _type?: string, _fee?: number) => {
      // Debits happen via edge functions (spray, transfer, giveaway).
      // This is a no-op stub. Realtime subscription updates balances.
    },
    []
  );

  const withdrawNGN = useCallback(
    async (amount: number, bankCode: string, accountNumber: string, accountName: string, pin: string) => {
      await withdrawals.ngn(amount, bankCode, accountNumber, accountName, pin);
      await fetchWallets();
      await fetchTransactions();
    },
    [fetchWallets, fetchTransactions]
  );

  const withdrawUSDC = useCallback(
    async (
      amount: number,
      toAddress: string,
      network: string,
      _provider: "blockradar" | "quidax",
      _fee: number,
      pin: string
    ) => {
      await withdrawals.usdc(amount, toAddress, pin, network);
      await fetchWallets();
      await fetchTransactions();
    },
    [fetchWallets, fetchTransactions]
  );

  const getTransactions = useCallback(
    (currency?: Currency) => {
      if (!currency) return transactions;
      return transactions.filter((t) => t.currency === currency);
    },
    [transactions]
  );

  const refreshBalances = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([fetchWallets(), fetchTransactions()]);
    } finally {
      setRefreshing(false);
    }
  }, [fetchWallets, fetchTransactions]);

  return {
    ngnBalance,
    usdcBalance,
    transactions,
    ngnReservedAccount,
    monnifyAccount: ngnReservedAccount,
    fundingProviderId,
    blockradarAddresses,
    loading,
    walletLoading: loading,
    refreshing,
    balanceRefreshing: refreshing,
    getBalance: (c: Currency) => (c === "NGN" ? ngnBalance : usdcBalance),
    getAvailableBalance: (c: Currency) => (c === "NGN" ? ngnBalance : usdcBalance),
    createNgnAccount,
    createMonnifyAccount,
    createBlockradarAddress,
    creditWallet,
    debitWallet,
    withdrawNGN,
    withdrawUSDC,
    getTransactions,
    refreshBalances,
    refreshWallets: fetchWallets,
    refreshTransactions: fetchTransactions,
    withdrawalFeeSettings,
  };
};
