import { ProfileScreen } from "@/components/ProfileScreen";
import { useDashboardShell } from "@/contexts/DashboardShellContext";
import { toast } from "sonner";

export default function ProfilePage() {
  const d = useDashboardShell();

  return (
    <ProfileScreen
      avatarData={d.avatarData}
      kycLevel={d.kycLevel}
      ngnBalance={d.ngnBalance}
      usdtBalance={d.usdtBalance}
      userName={d.profile?.full_name || ""}
      userPhone={d.profile?.phone || d.profile?.email || d.user?.email || ""}
      userId={d.profile?.id || ""}
      onOpenAvatar={() => d.setShowAvatarCustomization(true)}
      onOpenKYC={() => d.setShowKYC(true)}
      onOpenBankAccounts={() => d.setShowBankAccounts(true)}
      onOpenNotifications={() => d.setShowNotifications(true)}
      onLogout={async () => {
        await d.signOut();
        toast.success("Logged out successfully");
      }}
      onUpdateName={async (name) => {
        await d.updateProfile({ full_name: name });
      }}
    />
  );
}
