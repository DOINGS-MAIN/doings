import { Navigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

/** `/redeem/:code` → login or gifts with redeem sheet pre-filled. */
export default function RedeemGiveawayLinkPage() {
  const { code } = useParams();
  const { initialized, loading, isAuthenticated } = useAuth();
  const normalized = (code ?? "").trim().toUpperCase();

  if (!normalized) {
    return <Navigate to="/gifts" replace />;
  }

  if (!initialized || loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const target = `/gifts?redeem=${encodeURIComponent(normalized)}`;
  if (isAuthenticated) {
    return <Navigate to={target} replace />;
  }

  return <Navigate to={`/login?redeem=${encodeURIComponent(normalized)}`} replace />;
}
