import { useState, useEffect, useCallback } from "react";
import { supabase, auth } from "@/lib/supabase";
import { AdminRole } from "@/types/admin";

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

export const useAdminAuth = () => {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [accounts, setAccounts] = useState<AdminAccount[]>([]);
  const [loading, setLoading] = useState(true);

  const checkAdminRole = useCallback(async () => {
    const { data: { session: authSession } } = await supabase.auth.getSession();
    if (!authSession) {
      setSession(null);
      setLoading(false);
      return;
    }

    const { data: adminRole } = await supabase
      .from("admin_roles")
      .select("role, is_active")
      .eq("user_id", authSession.user.id)
      .single();

    if (adminRole?.is_active) {
      setSession({
        adminId: authSession.user.id,
        email: authSession.user.email ?? "",
        role: adminRole.role as AdminRole,
        loginAt: new Date(),
      });
    } else {
      setSession(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    checkAdminRole();
  }, [checkAdminRole]);

  const login = useCallback(async (email: string, password: string): Promise<{ success: boolean; error?: string }> => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { success: false, error: error.message };

    await checkAdminRole();
    return { success: true };
  }, [checkAdminRole]);

  const logout = useCallback(async () => {
    await auth.signOut();
    setSession(null);
  }, []);

  const changePassword = useCallback(async (_adminId: string, _currentPassword: string, newPassword: string) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) return { success: false, error: error.message };
    return { success: true };
  }, []);

  const currentAccount: AdminAccount | null = session ? {
    id: session.adminId,
    name: "",
    email: session.email,
    password: "",
    role: session.role,
    status: "active",
    createdAt: new Date(),
    lastLogin: session.loginAt,
  } : null;

  return {
    isAuthenticated: !!session,
    session,
    currentAccount,
    accounts,
    loading,
    login,
    logout,
    changePassword,
    resetPassword: async () => ({ success: false, error: "Use Supabase password reset" }),
    inviteAdmin: async () => ({ success: false, error: "Use admin API" }),
    updateAdminRole: async () => ({ success: false, error: "Use admin API" }),
    disableAdmin: async () => ({ success: false, error: "Use admin API" }),
    enableAdmin: async () => {},
    deleteAdmin: async () => ({ success: false, error: "Use admin API" }),
  };
};
