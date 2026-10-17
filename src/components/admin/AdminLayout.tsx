import { Navigate, Outlet } from "react-router-dom";
import { AdminSidebar } from "./AdminSidebar";
import { useAdminStats } from "@/hooks/admin/useAdminQueries";
import { useAdminRealtime } from "@/hooks/admin/useAdminRealtime";
import { useAdminAuth } from "@/hooks/useAdminAuth";

export const AdminLayout = () => {
  const { isAuthenticated, currentAccount, logout, loading } = useAdminAuth();
  const { data: stats } = useAdminStats();
  useAdminRealtime();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Loading admin session…</p>
      </div>
    );
  }

  if (!isAuthenticated || !currentAccount) {
    return <Navigate to="/admin/login" replace />;
  }

  return (
    <div className="min-h-screen flex bg-background">
      <AdminSidebar
        currentRole={currentAccount.role}
        adminName={currentAccount.name}
        adminEmail={currentAccount.email}
        onLogout={logout}
        flaggedTransactions={stats?.flaggedTransactions ?? 0}
        stuckWithdrawals={stats?.stuckWithdrawals ?? 0}
      />
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
};
