import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { can } from "@/types/admin";

const DEBOUNCE_MS = 2_000;

// One channel for the whole admin: transaction changes mark the transaction lists and stats stale,
// at most once every 2 s, so a burst of sprays costs one refetch.
export function useAdminRealtime(): void {
  const role = useAdminAuth().session?.role;
  const qc = useQueryClient();
  const enabled = can(role, "transactions.view");
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      void qc.invalidateQueries({ queryKey: ["admin", "transactions"] });
      void qc.invalidateQueries({ queryKey: ["admin", "stats"] });
    };
    const channel = supabase
      .channel("admin-transactions-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "transactions" }, () => {
        if (!timer) timer = setTimeout(flush, DEBOUNCE_MS);
      })
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [enabled, qc]);
}
