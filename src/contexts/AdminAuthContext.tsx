import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
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

interface AdminAuthContextValue {
  isAuthenticated: boolean;
  session: AdminSession | null;
  currentAccount: AdminAccount | null;
  accounts: AdminAccount[];
  loading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  changePassword: (
    adminId: string,
    currentPassword: string,
    newPassword: string,
  ) => Promise<{ success: boolean; error?: string }>;
  resetPassword: (email: string) => Promise<{ success: boolean; error?: string; tempPassword?: string }>;
  inviteAdmin: () => Promise<{ success: boolean; error?: string }>;
  updateAdminRole: () => Promise<{ success: boolean; error?: string }>;
  disableAdmin: () => Promise<{ success: boolean; error?: string }>;
  enableAdmin: () => Promise<void>;
  deleteAdmin: () => Promise<{ success: boolean; error?: string }>;
}

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

export const AdminAuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [accounts] = useState<AdminAccount[]>([]);
  const [loading, setLoading] = useState(true);

  const checkAdminRole = useCallback(async (): Promise<boolean> => {
    const {
      data: { session: authSession },
    } = await supabase.auth.getSession();
    if (!authSession) {
      setSession(null);
      setLoading(false);
      return false;
    }

    const { data: adminRole, error } = await supabase
      .from("admin_roles")
      .select("role, status")
      .eq("user_id", authSession.user.id)
      .eq("status", "active")
      .maybeSingle();

    if (error) {
      console.warn("AdminAuth: admin_roles lookup failed", error.message);
      setSession(null);
      setLoading(false);
      return false;
    }

    if (adminRole?.role) {
      setSession({
        adminId: authSession.user.id,
        email: authSession.user.email ?? "",
        role: adminRole.role as AdminRole,
        loginAt: new Date(),
      });
      setLoading(false);
      return true;
    }

    setSession(null);
    setLoading(false);
    return false;
  }, []);

  useEffect(() => {
    void checkAdminRole();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void checkAdminRole();
    });

    return () => subscription.unsubscribe();
  }, [checkAdminRole]);

  const login = useCallback(
    async (email: string, password: string): Promise<{ success: boolean; error?: string }> => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { success: false, error: error.message };

      const isAdmin = await checkAdminRole();
      if (!isAdmin) {
        await auth.signOut();
        return { success: false, error: "This account does not have admin access." };
      }

      return { success: true };
    },
    [checkAdminRole],
  );

  const logout = useCallback(async () => {
    await auth.signOut();
    setSession(null);
  }, []);

  const changePassword = useCallback(
    async (_adminId: string, _currentPassword: string, newPassword: string) => {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) return { success: false, error: error.message };
      return { success: true };
    },
    [],
  );

  const currentAccount: AdminAccount | null = session
    ? {
        id: session.adminId,
        name: "",
        email: session.email,
        password: "",
        role: session.role,
        status: "active",
        createdAt: new Date(),
        lastLogin: session.loginAt,
      }
    : null;

  const value = useMemo<AdminAuthContextValue>(
    () => ({
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
    }),
    [session, currentAccount, accounts, loading, login, logout, changePassword],
  );

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
};

export const useAdminAuth = (): AdminAuthContextValue => {
  const context = useContext(AdminAuthContext);
  if (!context) {
    throw new Error("useAdminAuth must be used within AdminAuthProvider");
  }
  return context;
};
