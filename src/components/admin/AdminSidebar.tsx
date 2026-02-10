import { 
  LayoutDashboard, 
  Users, 
  CreditCard, 
  FileCheck, 
  Calendar,
  Settings,
  LogOut,
  Shield
} from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { AdminRole, ROLE_LABELS, ROLE_PERMISSIONS } from "@/types/admin";

interface AdminSidebarProps {
  currentRole: AdminRole;
  adminName: string;
  adminEmail: string;
  onLogout: () => void;
  pendingKYC: number;
  flaggedTransactions: number;
}

const navItems = [
  { path: "/admin", label: "Dashboard", icon: LayoutDashboard, permission: "dashboard" },
  { path: "/admin/users", label: "User Management", icon: Users, permission: "users" },
  { path: "/admin/transactions", label: "Transactions", icon: CreditCard, permission: "transactions" },
  { path: "/admin/kyc", label: "KYC Review", icon: FileCheck, permission: "kyc" },
  { path: "/admin/events", label: "Event Moderation", icon: Calendar, permission: "events" },
];

const hasPermission = (role: AdminRole, permission: string): boolean => {
  const permissions = ROLE_PERMISSIONS[role];
  return permissions.includes("*") || 
         permissions.includes(permission) || 
         permissions.some(p => permission.startsWith(p.replace(".view", "")));
};

export const AdminSidebar = ({ 
  currentRole,
  adminName,
  adminEmail,
  onLogout,
  pendingKYC, 
  flaggedTransactions 
}: AdminSidebarProps) => {
  const location = useLocation();
  
  const getBadgeCount = (path: string): number | undefined => {
    if (path === "/admin/kyc" && pendingKYC > 0) return pendingKYC;
    if (path === "/admin/transactions" && flaggedTransactions > 0) return flaggedTransactions;
    return undefined;
  };

  return (
    <aside className="w-64 min-h-screen bg-card border-r border-border flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
            <Shield className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="font-bold text-lg text-foreground">Doings Admin</h1>
            <p className="text-xs text-muted-foreground">Management Console</p>
          </div>
        </div>
      </div>

      {/* Current Admin Info */}
      <div className="p-4 border-b border-border">
        <p className="text-sm font-semibold text-foreground truncate">{adminName}</p>
        <p className="text-xs text-muted-foreground truncate">{adminEmail}</p>
        <Badge variant="outline" className="mt-1 text-xs">{ROLE_LABELS[currentRole]}</Badge>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path || 
            (item.path !== "/admin" && location.pathname.startsWith(item.path));
          const canAccess = hasPermission(currentRole, item.permission);
          const badgeCount = getBadgeCount(item.path);

          if (!canAccess) return null;

          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200",
                isActive 
                  ? "bg-primary/10 text-primary" 
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <item.icon className="w-5 h-5" />
              <span className="font-medium flex-1">{item.label}</span>
              {badgeCount && (
                <Badge variant="destructive" className="h-5 min-w-[20px] px-1.5 text-xs">
                  {badgeCount}
                </Badge>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-border space-y-1">
        {hasPermission(currentRole, "*") && (
          <NavLink
            to="/admin/settings"
            className={cn(
              "flex items-center gap-3 px-4 py-3 rounded-xl transition-all",
              location.pathname === "/admin/settings"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Settings className="w-5 h-5" />
            <span className="font-medium">Settings</span>
          </NavLink>
        )}
        <button
          onClick={onLogout}
          className="flex items-center gap-3 px-4 py-3 rounded-xl text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-all w-full"
        >
          <LogOut className="w-5 h-5" />
          <span className="font-medium">Logout</span>
        </button>
      </div>
    </aside>
  );
};
