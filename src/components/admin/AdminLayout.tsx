import { Navigate, Outlet } from "react-router-dom";
import { AdminSidebar } from "./AdminSidebar";
import { useAdminData } from "@/hooks/useAdminData";
import { useAdminAuth } from "@/hooks/useAdminAuth";

export const AdminLayout = () => {
  const { isAuthenticated, currentAccount, logout } = useAdminAuth();
  const { getStats } = useAdminData();
  const stats = getStats();

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
        pendingKYC={stats.pendingKYC}
        flaggedTransactions={stats.flaggedTransactions}
      />
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
};
