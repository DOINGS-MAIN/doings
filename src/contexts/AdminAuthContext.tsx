import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { supabase, auth, admin as adminApi, passwordCheckClient } from "@/lib/supabase";
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

/**
 * Where the session stands on two-step sign-in: "challenge" = an authenticator is set up and its code
 * has not been entered yet; "setup" = a super admin with no authenticator; "ok" = nothing to do.
 */
export type TwoStepState = "ok" | "challenge" | "setup";

interface AdminSession {
  adminId: string;
  email: string;
  role: AdminRole;
  loginAt: Date;
  twoStep: TwoStepState;
  /** The verified authenticator to ask a code from, when there is one. */
  twoStepFactorId: string | null;
}

/** The session's assurance level, read from its token ("aal2" once a two-step code was entered). */
function sessionAal(accessToken: string): "aal1" | "aal2" {
  try {
    const part = accessToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(part + "=".repeat((4 - (part.length % 4)) % 4))) as { aal?: unknown };
    return claims.aal === "aal2" ? "aal2" : "aal1";
  } catch {
    return "aal1";
  }
}

export function twoStepStateFor(role: string, hasAuthenticator: boolean, aal: "aal1" | "aal2"): TwoStepState {
  if (hasAuthenticator) return aal === "aal2" ? "ok" : "challenge";
  return role === "super_admin" ? "setup" : "ok";
}

interface AdminAuthContextValue {
  isAuthenticated: boolean;
  session: AdminSession | null;
  currentAccount: AdminAccount | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  /** Pass currentPassword to re-check it first; omit it when setting a first password from an invite link. */
  changePassword: (newPassword: string, currentPassword?: string) => Promise<{ success: boolean; error?: string }>;
  /** Emails a reset link that opens /admin/change-password. */
  resetPassword: (email: string) => Promise<{ success: boolean; error?: string }>;
  /** Activates a pending admin invite for the signed-in user, then reloads the admin session. */
  acceptInvite: () => Promise<{ success: boolean; error?: string }>;
}

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

export const AdminAuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<AdminSession | null>(null);
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
      // Read from the session itself: calling the auth client again from inside its own change
      // listener can stall it.
      const factor = (authSession.user.factors ?? []).find((f) => f.factor_type === "totp" && f.status === "verified");
      setSession({
        adminId: authSession.user.id,
        email: authSession.user.email ?? "",
        role: adminRole.role as AdminRole,
        loginAt: new Date(),
        twoStep: twoStepStateFor(adminRole.role as string, Boolean(factor), sessionAal(authSession.access_token)),
        twoStepFactorId: factor?.id ?? null,
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

      // An invited admin who already had an account activates their invite on first sign-in.
      await adminApi.team.accept().catch(() => undefined);
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
    async (newPassword: string, currentPassword?: string) => {
      if (currentPassword !== undefined) {
        const { data } = await supabase.auth.getUser();
        const email = data.user?.email;
        if (!email) return { success: false, error: "Sign in again to change your password." };
        // Checked on a throwaway client: signing in again on the main one would replace a session that
        // has passed the two-step code with a password-only one, which may not change a password.
        const { error: checkErr } = await passwordCheckClient().auth.signInWithPassword({ email, password: currentPassword });
        if (checkErr) return { success: false, error: "Your current password is wrong." };
      }
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) return { success: false, error: error.message };
      return { success: true };
    },
    [],
  );

  const resetPassword = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/admin/change-password`,
    });
    if (error) return { success: false, error: error.message };
    return { success: true };
  }, []);

  const acceptInvite = useCallback(async () => {
    try {
      await adminApi.team.accept();
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : "Couldn't accept the invite" };
    }
    const isAdmin = await checkAdminRole();
    return isAdmin ? { success: true } : { success: false, error: "This account does not have admin access." };
  }, [checkAdminRole]);

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
      loading,
      login,
      logout,
      changePassword,
      resetPassword,
      acceptInvite,
    }),
    [session, currentAccount, loading, login, logout, changePassword, resetPassword, acceptInvite],
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
