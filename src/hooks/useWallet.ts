import { useState, useEffect, useCallback } from "react";

export interface Transaction {
  id: string;
  type: "deposit" | "spray" | "giveaway" | "withdrawal" | "received";
  amount: number;
  description: string;
  timestamp: Date;
  status: "pending" | "completed" | "failed";
  method?: "bank" | "card";
  reference?: string;
}

interface WalletState {
  balance: number;
  transactions: Transaction[];
}

const WALLET_STORAGE_KEY = "doings_wallet";

const getInitialState = (): WalletState => {
  if (typeof window === "undefined") {
    return { balance: 0, transactions: [] };
  }
  
  const stored = localStorage.getItem(WALLET_STORAGE_KEY);
  if (stored) {
    const parsed = JSON.parse(stored);
    return {
      ...parsed,
      transactions: parsed.transactions.map((t: Transaction) => ({
        ...t,
        timestamp: new Date(t.timestamp),
      })),
    };
  }
  
  // Demo transactions for first-time users
  return {
    balance: 125000,
    transactions: [
      {
        id: "demo-1",
        type: "deposit",
        amount: 100000,
        description: "Bank Transfer - GTBank",
        timestamp: new Date(Date.now() - 86400000 * 2),
        status: "completed",
        method: "bank",
        reference: "TXN-GTB-001234",
      },
      {
        id: "demo-2",
        type: "deposit",
        amount: 50000,
        description: "Card Payment - **** 4242",
        timestamp: new Date(Date.now() - 86400000),
        status: "completed",
        method: "card",
        reference: "TXN-CARD-005678",
      },
      {
        id: "demo-3",
        type: "spray",
        amount: -25000,
        description: "Sprayed at Ade's Wedding",
        timestamp: new Date(Date.now() - 3600000 * 5),
        status: "completed",
      },
    ],
  };
};

export const useWallet = () => {
  const [state, setState] = useState<WalletState>(getInitialState);

  // Persist to localStorage
  useEffect(() => {
    localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const addFunds = useCallback((amount: number, method: "bank" | "card", description: string) => {
    const transaction: Transaction = {
      id: `txn-${Date.now()}`,
      type: "deposit",
      amount,
      description,
      timestamp: new Date(),
      status: "completed",
      method,
      reference: `TXN-${method.toUpperCase()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
    };

    setState((prev) => ({
      balance: prev.balance + amount,
      transactions: [transaction, ...prev.transactions],
    }));

    return transaction;
  }, []);

  const deductFunds = useCallback((amount: number, description: string, type: Transaction["type"] = "spray") => {
    if (state.balance < amount) {
      throw new Error("Insufficient balance");
    }

    const transaction: Transaction = {
      id: `txn-${Date.now()}`,
      type,
      amount: -amount,
      description,
      timestamp: new Date(),
      status: "completed",
    };

    setState((prev) => ({
      balance: prev.balance - amount,
      transactions: [transaction, ...prev.transactions],
    }));

    return transaction;
  }, [state.balance]);

  const withdraw = useCallback((amount: number, bankName: string, accountNumber: string) => {
    if (state.balance < amount) {
      throw new Error("Insufficient balance");
    }

    const transaction: Transaction = {
      id: `txn-${Date.now()}`,
      type: "withdrawal",
      amount: -amount,
      description: `Withdrawal to ${bankName} - ****${accountNumber.slice(-4)}`,
      timestamp: new Date(),
      status: "pending",
      reference: `WDR-${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
    };

    setState((prev) => ({
      balance: prev.balance - amount,
      transactions: [transaction, ...prev.transactions],
    }));

    // Simulate processing
    setTimeout(() => {
      setState((prev) => ({
        ...prev,
        transactions: prev.transactions.map((t) =>
          t.id === transaction.id ? { ...t, status: "completed" } : t
        ),
      }));
    }, 3000);

    return transaction;
  }, [state.balance]);

  return {
    balance: state.balance,
    transactions: state.transactions,
    addFunds,
    deductFunds,
    withdraw,
  };
};
