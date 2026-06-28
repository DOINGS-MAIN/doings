import { useState, useEffect, useCallback } from "react";
import { getAppUserId } from "@/lib/appUser";
import { supabase, wallet, withdrawals } from "@/lib/supabase";
import {
  Currency,
  FinanceTransaction,
  MonnifyReservedAccount,
  BlockradarAddress,
} from "@/types/finance";

const toDisplay = (koboOrMicro: number, currency: Currency) =>
  currency === "NGN" ? koboOrMicro / 100 : koboOrMicro / 1_000_000;

const toSmallest = (display: number, currency: Currency) =>
  currency === "NGN" ? Math.round(display * 100) : Math.round(display * 1_000_000);

export const useMultiWallet = () => {
  const [ngnBalance, setNgnBalance] = useState(0);
  const [usdtBalance, setUsdtBalance] = useState(0);
  const [transactions, setTransactions] = useState<FinanceTransaction[]>([]);
  const [monnifyAccount, setMonnifyAccount] = useState<MonnifyReservedAccount | undefined>();
  const [blockradarAddresses, setBlockradarAddresses] = useState<BlockradarAddress[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchWallets = useCallback(async () => {
    const appUserId = await getAppUserId();
    if (!appUserId) return;

    const { data: wallets } = await supabase
      .from("wallets")
      .select("currency, balance, locked_balance")
      .eq("user_id", appUserId);

    setNgnBalance(0);
    setUsdtBalance(0);
    if (wallets) {
      for (const w of wallets) {
        if (w.currency === "NGN") setNgnBalance(toDisplay(w.balance, "NGN"));
        if (w.currency === "USDT") setUsdtBalance(toDisplay(w.balance, "USDT"));
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
          createdAt: new Date(t.created_at as string),
          completedAt: t.completed_at ? new Date(t.completed_at as string) : undefined,
        }))
      );
    }
  }, []);

  const fetchMonnifyAccount = useCallback(async () => {
    const appUserId = await getAppUserId();
    if (!appUserId) return;

    const { data } = await supabase
      .from("monnify_reserved_accounts")
      .select("*")
      .eq("user_id", appUserId)
      .limit(1)
      .maybeSingle();

    if (data) {
      setMonnifyAccount({
        accountReference: data.account_reference,
        accountName: data.account_name,
        accountNumber: data.account_number,
        bankName: data.bank_name,
        bankCode: data.bank_code,
        reservationReference: data.reservation_reference,
        status: data.status,
      });
    } else {
      setMonnifyAccount(undefined);
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
          network: (a.network as string) ?? "TRC20",
          blockchain: (a.blockchain as string) ?? "Tron",
          walletId: a.wallet_id as string,
        }))
      );
    } else {
      setBlockradarAddresses([]);
    }
  }, []);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await Promise.all([fetchWallets(), fetchTransactions(), fetchMonnifyAccount(), fetchBlockradarAddresses()]);
      setLoading(false);
    };
    load();

    const channel = supabase
      .channel("wallet-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "wallets" }, () => {
        fetchWallets();
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "transactions" }, () => {
        fetchTransactions();
        fetchWallets();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchWallets, fetchTransactions, fetchMonnifyAccount, fetchBlockradarAddresses]);

  const createMonnifyAccount = useCallback(
    async (bvn: string) => {
      const digits = bvn.replace(/\D/g, "");
      if (digits.length !== 11) {
        throw new Error("BVN must be 11 digits");
      }
      const result = await wallet.createMonnifyAccount(digits);
      await fetchMonnifyAccount();
      return result as unknown as MonnifyReservedAccount;
    },
    [fetchMonnifyAccount]
  );

  const createBlockradarAddress = useCallback(async (network: string = "TRC20") => {
    const result = await wallet.createBlockradarAddress(network);
    await fetchBlockradarAddresses();
    return result as unknown as BlockradarAddress;
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
    async (amount: number, bankName: string, accountNumber: string, fee: number) => {
      await withdrawals.ngn(toSmallest(amount, "NGN"), "000", accountNumber, bankName);
      await fetchWallets();
      await fetchTransactions();
    },
    [fetchWallets, fetchTransactions]
  );

  const withdrawUSDT = useCallback(
    async (amount: number, toAddress: string, network: string, _provider: string, _fee: number) => {
      await withdrawals.usdt(toSmallest(amount, "USDT"), toAddress, network);
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

  return {
    ngnBalance,
    usdtBalance,
    transactions,
    monnifyAccount,
    blockradarAddresses,
    loading,
    getBalance: (c: Currency) => (c === "NGN" ? ngnBalance : usdtBalance),
    getAvailableBalance: (c: Currency) => (c === "NGN" ? ngnBalance : usdtBalance),
    createMonnifyAccount,
    createBlockradarAddress,
    creditWallet,
    debitWallet,
    withdrawNGN,
    withdrawUSDT,
    getTransactions,
    refreshWallets: fetchWallets,
    refreshTransactions: fetchTransactions,
  };
};
