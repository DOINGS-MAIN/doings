import { Navigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

/** `/join/:eventCode` → login or events with join sheet pre-filled. */
export default function JoinEventLinkPage() {
  const { eventCode } = useParams();
  const { initialized, loading, isAuthenticated } = useAuth();
  const code = (eventCode ?? "").trim().toUpperCase();

  if (!code) {
    return <Navigate to="/events" replace />;
  }

  if (!initialized || loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const target = `/events?join=${encodeURIComponent(code)}`;
  if (isAuthenticated) {
    return <Navigate to={target} replace />;
  }

  return <Navigate to={`/login?join=${encodeURIComponent(code)}`} replace />;
}
