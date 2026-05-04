import { MyEventsScreen } from "@/components/MyEventsScreen";
import { useDashboardShell } from "@/contexts/DashboardShellContext";

export default function EventsPage() {
  const d = useDashboardShell();

  return (
    <MyEventsScreen
      events={d.myEvents}
      isLoading={d.myEventsInitialLoading}
      onCreateEvent={() => d.setShowCreateEvent(true)}
      onGoLive={d.handleGoLive}
      onEndEvent={d.handleEndEvent}
      onManageEvent={d.handleManageEvent}
    />
  );
}
