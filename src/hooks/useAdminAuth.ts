import { useState, useEffect, useCallback } from "react";
import { AdminRole, ROLE_LABELS } from "@/types/admin";

const ADMIN_AUTH_KEY = "doings_admin_auth";
const ADMIN_ACCOUNTS_KEY = "doings_admin_accounts";

export interface AdminAccount {
  id: string;
  name: string;
  email: string;
  password: string;
  role: AdminRole;
  status: "active" | "invited" | "disabled";
  createdAt: Date;
  lastLogin?: Date;
  invitedBy?: string;
  mustChangePassword?: boolean;
}

interface AdminSession {
  adminId: string;
  email: string;
  role: AdminRole;
  loginAt: Date;
}

const DEFAULT_SUPER_ADMIN: AdminAccount = {
  id: "admin-1",
  name: "Super Admin",
  email: "admin@doings.app",
  password: "admin123",
  role: "super_admin",
  status: "active",
  createdAt: new Date(),
  lastLogin: new Date(),
  mustChangePassword: false,
};

const getStoredAccounts = (): AdminAccount[] => {
  const stored = localStorage.getItem(ADMIN_ACCOUNTS_KEY);
  if (stored) {
    return JSON.parse(stored).map((a: AdminAccount) => ({
      ...a,
      createdAt: new Date(a.createdAt),
      lastLogin: a.lastLogin ? new Date(a.lastLogin) : undefined,
    }));
  }
  const accounts = [DEFAULT_SUPER_ADMIN];
  localStorage.setItem(ADMIN_ACCOUNTS_KEY, JSON.stringify(accounts));
  return accounts;
};

const getStoredSession = (): AdminSession | null => {
  const stored = localStorage.getItem(ADMIN_AUTH_KEY);
  if (stored) {
    const session = JSON.parse(stored);
    return { ...session, loginAt: new Date(session.loginAt) };
  }
  return null;
};

export const useAdminAuth = () => {
  const [session, setSession] = useState<AdminSession | null>(getStoredSession);
  const [accounts, setAccounts] = useState<AdminAccount[]>(getStoredAccounts);

  useEffect(() => {
    localStorage.setItem(ADMIN_ACCOUNTS_KEY, JSON.stringify(accounts));
  }, [accounts]);

  const login = useCallback((email: string, password: string): { success: boolean; error?: string; mustChangePassword?: boolean } => {
    const account = accounts.find(a => a.email.toLowerCase() === email.toLowerCase());
    if (!account) return { success: false, error: "Invalid email or password" };
    if (account.status === "disabled") return { success: false, error: "This account has been disabled" };
    if (account.status === "invited") {
      // First login for invited admin — accept any password they set
      if (password.length < 6) return { success: false, error: "Password must be at least 6 characters" };
      setAccounts(prev => prev.map(a =>
        a.id === account.id ? { ...a, password, status: "active" as const, lastLogin: new Date(), mustChangePassword: false } : a
      ));
    } else {
      if (account.password !== password) return { success: false, error: "Invalid email or password" };
      setAccounts(prev => prev.map(a =>
        a.id === account.id ? { ...a, lastLogin: new Date() } : a
      ));
    }

    const newSession: AdminSession = {
      adminId: account.id,
      email: account.email,
      role: account.role,
      loginAt: new Date(),
    };
    setSession(newSession);
    localStorage.setItem(ADMIN_AUTH_KEY, JSON.stringify(newSession));

    if (account.mustChangePassword) {
      return { success: true, mustChangePassword: true };
    }
    return { success: true };
  }, [accounts]);

  const logout = useCallback(() => {
    setSession(null);
    localStorage.removeItem(ADMIN_AUTH_KEY);
  }, []);

  const changePassword = useCallback((adminId: string, currentPassword: string, newPassword: string): { success: boolean; error?: string } => {
    const account = accounts.find(a => a.id === adminId);
    if (!account) return { success: false, error: "Account not found" };
    if (account.password !== currentPassword) return { success: false, error: "Current password is incorrect" };
    if (newPassword.length < 6) return { success: false, error: "New password must be at least 6 characters" };

    setAccounts(prev => prev.map(a =>
      a.id === adminId ? { ...a, password: newPassword, mustChangePassword: false } : a
    ));
    return { success: true };
  }, [accounts]);

  const resetPassword = useCallback((email: string): { success: boolean; error?: string; tempPassword?: string } => {
    const account = accounts.find(a => a.email.toLowerCase() === email.toLowerCase());
    if (!account) return { success: false, error: "No account found with that email" };

    const tempPassword = `temp${Math.random().toString(36).slice(2, 8)}`;
    setAccounts(prev => prev.map(a =>
      a.id === account.id ? { ...a, password: tempPassword, mustChangePassword: true } : a
    ));
    return { success: true, tempPassword };
  }, [accounts]);

  const inviteAdmin = useCallback((name: string, email: string, role: AdminRole): { success: boolean; error?: string } => {
    if (accounts.find(a => a.email.toLowerCase() === email.toLowerCase())) {
      return { success: false, error: "An admin with this email already exists" };
    }

    const newAdmin: AdminAccount = {
      id: `admin-${Date.now()}`,
      name,
      email,
      password: "",
      role,
      status: "invited",
      createdAt: new Date(),
      invitedBy: session?.adminId,
      mustChangePassword: true,
    };

    setAccounts(prev => [...prev, newAdmin]);
    return { success: true };
  }, [accounts, session]);

  const updateAdminRole = useCallback((adminId: string, role: AdminRole): { success: boolean; error?: string } => {
    if (adminId === session?.adminId) return { success: false, error: "You cannot change your own role" };
    setAccounts(prev => prev.map(a =>
      a.id === adminId ? { ...a, role } : a
    ));
    // Update session if it's the current user's role being changed
    return { success: true };
  }, [session]);

  const disableAdmin = useCallback((adminId: string): { success: boolean; error?: string } => {
    if (adminId === session?.adminId) return { success: false, error: "You cannot disable your own account" };
    setAccounts(prev => prev.map(a =>
      a.id === adminId ? { ...a, status: "disabled" as const } : a
    ));
    return { success: true };
  }, [session]);

  const enableAdmin = useCallback((adminId: string) => {
    setAccounts(prev => prev.map(a =>
      a.id === adminId ? { ...a, status: "active" as const } : a
    ));
  }, []);

  const deleteAdmin = useCallback((adminId: string): { success: boolean; error?: string } => {
    if (adminId === session?.adminId) return { success: false, error: "You cannot delete your own account" };
    setAccounts(prev => prev.filter(a => a.id !== adminId));
    return { success: true };
  }, [session]);

  const currentAccount = accounts.find(a => a.id === session?.adminId) || null;

  return {
    isAuthenticated: !!session,
    session,
    currentAccount,
    accounts,
    login,
    logout,
    changePassword,
    resetPassword,
    inviteAdmin,
    updateAdminRole,
    disableAdmin,
    enableAdmin,
    deleteAdmin,
  };
};
