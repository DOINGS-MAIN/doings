import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

/** `/` → `/home` when signed in, otherwise `/login`. */
export function RootRedirect() {
  const { initialized, loading, isAuthenticated } = useAuth();

  if (!initialized || loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return <Navigate to={isAuthenticated ? "/home" : "/login"} replace />;
}
