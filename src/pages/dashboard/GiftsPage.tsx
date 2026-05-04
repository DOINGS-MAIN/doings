import { GiftsScreen } from "@/components/GiftsScreen";
import { useDashboardShell } from "@/contexts/DashboardShellContext";

export default function GiftsPage() {
  const d = useDashboardShell();

  return (
    <GiftsScreen
      myGiveaways={d.getMyGiveaways()}
      onCreateGiveaway={() => d.setShowCreateGiveaway(true)}
      onRedeemGiveaway={() => d.setShowRedeemGiveaway(true)}
      onViewGiveaway={d.handleViewGiveaway}
    />
  );
}
