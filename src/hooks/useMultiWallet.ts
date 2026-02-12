import { useState, useEffect, useCallback } from "react";
import {
  Currency,
  MultiWalletState,
  FinanceTransaction,
  TransactionType,
  MonnifyReservedAccount,
  BlockradarAddress,
  QuidaxSubUser,
  Wallet,
} from "@/types/finance";

const WALLET_STORAGE_KEY = "doings_multi_wallet";

const createEmptyWallet = (currency: Currency): Wallet => ({
  id: `wallet-${currency.toLowerCase()}-${Date.now()}`,
  currency,
  balance: 0,
  lockedBalance: 0,
  addresses: [],
  createdAt: new Date(),
});

const getInitialState = (): MultiWalletState => {
  if (typeof window === "undefined") {
    return {
      wallets: {
        NGN: createEmptyWallet("NGN"),
        USDT: createEmptyWallet("USDT"),
      },
      transactions: [],
      blockradarAddresses: [],
    };
  }

  const stored = localStorage.getItem(WALLET_STORAGE_KEY);
  if (stored) {
    const parsed = JSON.parse(stored);
    return {
      ...parsed,
      wallets: {
        NGN: {
          ...parsed.wallets.NGN,
          createdAt: new Date(parsed.wallets.NGN.createdAt),
        },
        USDT: {
          ...parsed.wallets.USDT,
          createdAt: new Date(parsed.wallets.USDT.createdAt),
        },
      },
      transactions: parsed.transactions.map((t: FinanceTransaction) => ({
        ...t,
        createdAt: new Date(t.createdAt),
        completedAt: t.completedAt ? new Date(t.completedAt) : undefined,
      })),
    };
  }

  // Demo state with some initial balance
  const ngnWallet = createEmptyWallet("NGN");
  ngnWallet.balance = 125000;

  const usdtWallet = createEmptyWallet("USDT");
  usdtWallet.balance = 50;

  const demoTransactions: FinanceTransaction[] = [
    {
      id: "demo-1",
      walletId: ngnWallet.id,
      currency: "NGN",
      type: "deposit",
      amount: 100000,
      fee: 0,
      netAmount: 100000,
      status: "completed",
      provider: "monnify",
      providerRef: "MNFY-TXN-001",
      idempotencyKey: `idem-${Date.now()}-1`,
      description: "Bank Transfer - Wema Bank",
      createdAt: new Date(Date.now() - 86400000 * 2),
      completedAt: new Date(Date.now() - 86400000 * 2),
    },
    {
      id: "demo-2",
      walletId: ngnWallet.id,
      currency: "NGN",
      type: "deposit",
      amount: 50000,
      fee: 750,
      netAmount: 49250,
      status: "completed",
      provider: "monnify",
      idempotencyKey: `idem-${Date.now()}-2`,
      description: "Card Payment - **** 4242",
      createdAt: new Date(Date.now() - 86400000),
      completedAt: new Date(Date.now() - 86400000),
    },
    {
      id: "demo-3",
      walletId: ngnWallet.id,
      currency: "NGN",
      type: "spray",
      amount: -25000,
      fee: 0,
      netAmount: -25000,
      status: "completed",
      provider: "internal",
      idempotencyKey: `idem-${Date.now()}-3`,
      description: "Sprayed at Ade's Wedding",
      createdAt: new Date(Date.now() - 3600000 * 5),
      completedAt: new Date(Date.now() - 3600000 * 5),
    },
    {
      id: "demo-4",
      walletId: usdtWallet.id,
      currency: "USDT",
      type: "deposit",
      amount: 50,
      fee: 0,
      netAmount: 50,
      status: "completed",
      provider: "blockradar",
      providerRef: "BR-TXN-001",
      idempotencyKey: `idem-${Date.now()}-4`,
      description: "USDT Deposit (TRC20)",
      createdAt: new Date(Date.now() - 86400000 * 3),
      completedAt: new Date(Date.now() - 86400000 * 3),
    },
  ];

  return {
    wallets: { NGN: ngnWallet, USDT: usdtWallet },
    transactions: demoTransactions,
    blockradarAddresses: [],
  };
};

export const useMultiWallet = () => {
  const [state, setState] = useState<MultiWalletState>(getInitialState);

  useEffect(() => {
    localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  // ---- Balance helpers ----
  const getBalance = useCallback(
    (currency: Currency) => state.wallets[currency].balance,
    [state.wallets]
  );

  const getAvailableBalance = useCallback(
    (currency: Currency) =>
      state.wallets[currency].balance - state.wallets[currency].lockedBalance,
    [state.wallets]
  );

  // ---- Create Monnify Reserved Account (mock) ----
  const createMonnifyAccount = useCallback((bvn: string, customerName: string, customerEmail: string) => {
    return new Promise<MonnifyReservedAccount>((resolve) => {
      setTimeout(() => {
        const account: MonnifyReservedAccount = {
          accountReference: `DOINGS-${Date.now()}`,
          accountName: `DOINGS/${customerName}`,
          accountNumber: `78${Math.floor(10000000 + Math.random() * 90000000)}`,
          bankName: "Wema Bank",
          bankCode: "035",
          reservationReference: `MNFY-RSV-${Date.now()}`,
          status: "ACTIVE",
        };

        setState((prev) => ({ ...prev, monnifyAccount: account }));
        resolve(account);
      }, 2000);
    });
  }, []);

  // ---- Create Blockradar USDT Address (mock) ----
  const createBlockradarAddress = useCallback((network: string = "TRC20") => {
    return new Promise<BlockradarAddress>((resolve) => {
      setTimeout(() => {
        const prefixMap: Record<string, string> = {
          TRC20: "T",
          BEP20: "0x",
          ERC20: "0x",
        };
        const prefix = prefixMap[network] || "T";
        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        let addr = prefix;
        for (let i = 0; i < (prefix === "T" ? 33 : 40); i++) {
          addr += chars[Math.floor(Math.random() * chars.length)];
        }

        const address: BlockradarAddress = {
          address: addr,
          network,
          blockchain: network === "TRC20" ? "Tron" : "BSC",
          walletId: `br-wallet-${Date.now()}`,
        };

        setState((prev) => ({
          ...prev,
          blockradarAddresses: [...prev.blockradarAddresses, address],
          wallets: {
            ...prev.wallets,
            USDT: {
              ...prev.wallets.USDT,
              addresses: [
                ...prev.wallets.USDT.addresses,
                {
                  id: `addr-${Date.now()}`,
                  provider: "blockradar",
                  address: addr,
                  label: `USDT (${network})`,
                  network,
                  createdAt: new Date(),
                },
              ],
            },
          },
        }));

        resolve(address);
      }, 2000);
    });
  }, []);

  // ---- Create Quidax Sub-user (mock) ----
  const createQuidaxUser = useCallback((email: string) => {
    return new Promise<QuidaxSubUser>((resolve) => {
      setTimeout(() => {
        const user: QuidaxSubUser = {
          id: `qx-user-${Date.now()}`,
          email,
        };
        setState((prev) => ({ ...prev, quidaxUser: user }));
        resolve(user);
      }, 1500);
    });
  }, []);

  // ---- Credit wallet (deposit) ----
  const creditWallet = useCallback(
    (
      currency: Currency,
      amount: number,
      description: string,
      provider: FinanceTransaction["provider"] = "internal",
      type: TransactionType = "deposit",
      fee: number = 0
    ) => {
      const transaction: FinanceTransaction = {
        id: `txn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        walletId: state.wallets[currency].id,
        currency,
        type,
        amount,
        fee,
        netAmount: amount - fee,
        status: "completed",
        provider,
        providerRef: `${provider?.toUpperCase()}-${Date.now()}`,
        idempotencyKey: `idem-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        description,
        createdAt: new Date(),
        completedAt: new Date(),
      };

      setState((prev) => ({
        ...prev,
        wallets: {
          ...prev.wallets,
          [currency]: {
            ...prev.wallets[currency],
            balance: prev.wallets[currency].balance + (amount - fee),
          },
        },
        transactions: [transaction, ...prev.transactions],
      }));

      return transaction;
    },
    [state.wallets]
  );

  // ---- Debit wallet (send/spray/giveaway) ----
  const debitWallet = useCallback(
    (
      currency: Currency,
      amount: number,
      description: string,
      type: TransactionType = "send",
      fee: number = 0
    ) => {
      const available = getAvailableBalance(currency);
      if (available < amount + fee) {
        throw new Error("Insufficient balance");
      }

      const transaction: FinanceTransaction = {
        id: `txn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        walletId: state.wallets[currency].id,
        currency,
        type,
        amount: -(amount),
        fee,
        netAmount: -(amount + fee),
        status: "completed",
        provider: "internal",
        idempotencyKey: `idem-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        description,
        createdAt: new Date(),
        completedAt: new Date(),
      };

      setState((prev) => ({
        ...prev,
        wallets: {
          ...prev.wallets,
          [currency]: {
            ...prev.wallets[currency],
            balance: prev.wallets[currency].balance - (amount + fee),
          },
        },
        transactions: [transaction, ...prev.transactions],
      }));

      return transaction;
    },
    [state.wallets, getAvailableBalance]
  );

  // ---- Withdraw NGN to bank (Monnify Disbursement mock) ----
  const withdrawNGN = useCallback(
    (amount: number, bankName: string, accountNumber: string, fee: number) => {
      const available = getAvailableBalance("NGN");
      if (available < amount + fee) {
        throw new Error("Insufficient balance");
      }

      const transaction: FinanceTransaction = {
        id: `txn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        walletId: state.wallets.NGN.id,
        currency: "NGN",
        type: "withdrawal",
        amount: -(amount),
        fee,
        netAmount: -(amount + fee),
        status: "pending",
        provider: "monnify",
        providerRef: `MNFY-DSB-${Date.now()}`,
        idempotencyKey: `idem-wd-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        description: `Withdrawal to ${bankName} - ****${accountNumber.slice(-4)}`,
        createdAt: new Date(),
      };

      // Lock funds
      setState((prev) => ({
        ...prev,
        wallets: {
          ...prev.wallets,
          NGN: {
            ...prev.wallets.NGN,
            balance: prev.wallets.NGN.balance - (amount + fee),
          },
        },
        transactions: [transaction, ...prev.transactions],
      }));

      // Simulate processing
      setTimeout(() => {
        setState((prev) => ({
          ...prev,
          transactions: prev.transactions.map((t) =>
            t.id === transaction.id
              ? { ...t, status: "completed", completedAt: new Date() }
              : t
          ),
        }));
      }, 3000);

      return transaction;
    },
    [state.wallets, getAvailableBalance]
  );

  // ---- Withdraw USDT externally (Blockradar/Quidax mock) ----
  const withdrawUSDT = useCallback(
    (
      amount: number,
      toAddress: string,
      network: string,
      provider: "blockradar" | "quidax",
      fee: number
    ) => {
      const available = getAvailableBalance("USDT");
      if (available < amount + fee) {
        throw new Error("Insufficient USDT balance");
      }

      const transaction: FinanceTransaction = {
        id: `txn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        walletId: state.wallets.USDT.id,
        currency: "USDT",
        type: "withdrawal",
        amount: -(amount),
        fee,
        netAmount: -(amount + fee),
        status: "pending",
        provider,
        providerRef: `${provider.toUpperCase()}-WD-${Date.now()}`,
        idempotencyKey: `idem-wd-usdt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        description: `USDT to ${toAddress.slice(0, 6)}...${toAddress.slice(-4)} (${network})`,
        metadata: { toAddress, network },
        createdAt: new Date(),
      };

      setState((prev) => ({
        ...prev,
        wallets: {
          ...prev.wallets,
          USDT: {
            ...prev.wallets.USDT,
            balance: prev.wallets.USDT.balance - (amount + fee),
          },
        },
        transactions: [transaction, ...prev.transactions],
      }));

      // Simulate blockchain confirmation
      setTimeout(() => {
        setState((prev) => ({
          ...prev,
          transactions: prev.transactions.map((t) =>
            t.id === transaction.id
              ? { ...t, status: "completed", completedAt: new Date() }
              : t
          ),
        }));
      }, 5000);

      return transaction;
    },
    [state.wallets, getAvailableBalance]
  );

  // ---- Get transactions filtered by currency ----
  const getTransactions = useCallback(
    (currency?: Currency) => {
      if (!currency) return state.transactions;
      return state.transactions.filter((t) => t.currency === currency);
    },
    [state.transactions]
  );

  return {
    wallets: state.wallets,
    ngnBalance: state.wallets.NGN.balance,
    usdtBalance: state.wallets.USDT.balance,
    transactions: state.transactions,
    monnifyAccount: state.monnifyAccount,
    blockradarAddresses: state.blockradarAddresses,
    quidaxUser: state.quidaxUser,
    getBalance,
    getAvailableBalance,
    createMonnifyAccount,
    createBlockradarAddress,
    createQuidaxUser,
    creditWallet,
    debitWallet,
    withdrawNGN,
    withdrawUSDT,
    getTransactions,
  };
};
