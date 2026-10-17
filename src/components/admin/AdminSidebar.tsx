import { 
  LayoutDashboard, 
  Users, 
  CreditCard, 
  FileCheck, 
  Calendar,
  Settings,
  LogOut,
  Shield,
  Route,
  Webhook,
  BarChart3,
  ListTodo,
  Activity,
  ArrowLeftRight,
  Music, Megaphone,
  Banknote,
  ShoppingBag,
  UserCog,
  ScrollText,
} from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { AdminRole, ROLE_LABELS, can } from "@/types/admin";

interface AdminSidebarProps {
  currentRole: AdminRole;
  adminName: string;
  adminEmail: string;
  onLogout: () => void;
  flaggedTransactions: number;
  stuckWithdrawals: number;
}

// Each item shows when the role has any of its permissions (the server enforces the same matrix).
const navItems = [
  { path: "/admin", label: "Dashboard", icon: LayoutDashboard, permissions: ["dashboard"] },
  { path: "/admin/users", label: "User Management", icon: Users, permissions: ["users.view"] },
  { path: "/admin/payments", label: "Payments", icon: BarChart3, permissions: ["payments"] },
  { path: "/admin/queue", label: "Review Queue", icon: ListTodo, permissions: ["queue"] },
  { path: "/admin/transactions", label: "Transactions", icon: CreditCard, permissions: ["transactions.view"] },
  { path: "/admin/payouts", label: "Payouts", icon: Banknote, permissions: ["transactions.view"] },
  { path: "/admin/bundle-orders", label: "Bundle Orders", icon: ShoppingBag, permissions: ["transactions.view"] },
  { path: "/admin/psp-events", label: "PSP Activity", icon: Activity, permissions: ["psp_events"] },
  { path: "/admin/webhooks", label: "Webhooks", icon: Webhook, permissions: ["webhooks.view"] },
  { path: "/admin/payment-rails", label: "Payment Rails", icon: Route, permissions: ["payment_rails"] },
  { path: "/admin/fx", label: "FX & Convert", icon: ArrowLeftRight, permissions: ["payment_rails"] },
  { path: "/admin/dance-floor", label: "Dance Floor", icon: Music, permissions: ["dance_floor", "floor_avatars"] },
  { path: "/admin/ads", label: "Ads", icon: Megaphone, permissions: ["ads"] },
  { path: "/admin/kyc", label: "KYC Results", icon: FileCheck, permissions: ["kyc"] },
  { path: "/admin/events", label: "Event Moderation", icon: Calendar, permissions: ["events.view"] },
  { path: "/admin/team", label: "Team", icon: UserCog, permissions: ["*"] },
  { path: "/admin/audit", label: "Audit Log", icon: ScrollText, permissions: ["*"] },
];

export const AdminSidebar = ({ 
  currentRole,
  adminName,
  adminEmail,
  onLogout,
  flaggedTransactions,
  stuckWithdrawals,
}: AdminSidebarProps) => {
  const location = useLocation();
  
  const getBadgeCount = (path: string): number | undefined => {
    if (path === "/admin/transactions" && flaggedTransactions > 0) return flaggedTransactions;
    if (path === "/admin/queue" && stuckWithdrawals > 0) return stuckWithdrawals;
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
          const canAccess = item.permissions.some((p) => can(currentRole, p));
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
