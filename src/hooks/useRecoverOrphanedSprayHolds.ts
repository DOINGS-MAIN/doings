import { useEffect, useRef } from "react";
import { supabase, spray as sprayApi } from "@/lib/supabase";
import { toast } from "sonner";

/**
 * After a crash/hang/refresh the server may still have `pending` spray holds (locked funds,
 * projector still showing the guest). Cancel any orphaned holds once per app load.
 */
export function useRecoverOrphanedSprayHolds(
  userId: string | undefined,
  refreshBalances: () => Promise<void>,
) {
  const ranRef = useRef(false);
  const refreshRef = useRef(refreshBalances);
  refreshRef.current = refreshBalances;

  useEffect(() => {
    if (!userId || ranRef.current) return;
    ranRef.current = true;

    const timer = window.setTimeout(() => {
      void (async () => {
      try {
        // Release holds whose session window ended (helps projector + other guests).
        await supabase.rpc("cleanup_spray_holds");

        const { data: holds, error } = await supabase
          .from("spray_holds")
          .select("id")
          .eq("status", "pending")
          .eq("sprayer_id", userId);

        if (error || !holds?.length) return;

        let released = 0;
        for (const hold of holds) {
          try {
            await sprayApi.settle(hold.id, "cancelled");
            released += 1;
          } catch {
            /* hold may have been cleaned up concurrently */
          }
        }

        if (released > 0) {
          toast.info(
            released === 1
              ? "A stuck spray session was cancelled — your funds are unlocked."
              : `${released} stuck spray sessions were cancelled — funds unlocked.`,
          );
          await refreshRef.current();
        }
      } catch (err) {
        console.warn("Could not recover orphaned spray holds:", err);
      }
    })();
    }, 1500);

    return () => window.clearTimeout(timer);
  }, [userId]);
}
