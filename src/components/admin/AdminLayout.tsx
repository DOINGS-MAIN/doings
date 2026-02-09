import { Outlet } from "react-router-dom";
import { AdminSidebar } from "./AdminSidebar";
import { useAdminData } from "@/hooks/useAdminData";

export const AdminLayout = () => {
  const { currentAdmin, getStats, setAdminRole } = useAdminData();
  const stats = getStats();

  if (!currentAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading admin panel...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-background">
      <AdminSidebar
        currentRole={currentAdmin.role}
        onRoleChange={setAdminRole}
        pendingKYC={stats.pendingKYC}
        flaggedTransactions={stats.flaggedTransactions}
      />
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
};
