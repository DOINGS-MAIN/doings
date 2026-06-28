import { useState, useEffect, useCallback } from "react";
import { supabase, giveaways as giveawaysApi } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";

export interface Giveaway {
  id: string;
  creatorId: string;
  creatorName: string;
  title: string;
  totalAmount: number;
  perPersonAmount: number;
  remainingAmount: number;
  code: string;
  status: "active" | "stopped" | "exhausted";
  type: "live" | "scheduled";
  eventId?: string;
  eventName?: string;
  isPrivate: boolean;
  showOnEventScreen: boolean;
  redeemedBy: string[];
  /** Server-backed count (from DB embed or detail fetch) */
  redemptionCount: number;
  redemptions: GiveawayRedemption[];
  createdAt: string;
  stoppedAt?: string;
}

export interface GiveawayRedemption {
  id: string;
  giveawayId: string;
  userId: string;
  userName: string;
  amount: number;
  redeemedAt: string;
}

function parseNestedRedemptions(raw: unknown): { redemptionCount: number; redemptions: GiveawayRedemption[] } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { redemptionCount: 0, redemptions: [] };
  }
  const row0 = raw[0] as Record<string, unknown>;
  if (typeof row0.count === "number" && row0.id === undefined) {
    return { redemptionCount: row0.count, redemptions: [] };
  }
  const redemptions: GiveawayRedemption[] = (raw as Record<string, unknown>[]).map((r) => ({
    id: String(r.id ?? ""),
    giveawayId: "",
    userId: String(r.user_id ?? ""),
    userName: "Winner",
    amount: Number(r.amount ?? 0) / 100,
    redeemedAt: String(r.redeemed_at ?? ""),
  }));
  return { redemptionCount: redemptions.length, redemptions };
}

/** Normalize a PostgREST row or giveaway edge JSON object into `Giveaway`. */
export function mapGiveawayRow(g: Record<string, unknown>): Giveaway {
  const gid = String(g.id ?? "");
  const { redemptionCount, redemptions } = parseNestedRedemptions(g.giveaway_redemptions);
  const redemptionsWithGid = redemptions.map((r) => ({ ...r, giveawayId: gid }));

  return {
    id: gid,
    creatorId: (g.creator_id as string) ?? "",
    creatorName: (g.creator_name as string) ?? "",
    title: (g.title as string) ?? "",
    totalAmount: Number(g.total_amount ?? 0) / 100,
    perPersonAmount: Number(g.per_person_amount ?? 0) / 100,
    remainingAmount: Number(g.remaining_amount ?? 0) / 100,
    code: (g.code as string) ?? "",
    status: (g.status as Giveaway["status"]) ?? "active",
    type: (g.type as Giveaway["type"]) ?? "live",
    eventId: (g.event_id as string) || undefined,
    eventName: (g.event_name as string) || undefined,
    isPrivate: (g.is_private as boolean) ?? false,
    showOnEventScreen: (g.show_on_event_screen as boolean) ?? true,
    redeemedBy: [],
    redemptionCount,
    redemptions: redemptionsWithGid,
    createdAt: (g.created_at as string) ?? "",
    stoppedAt: (g.stopped_at as string) || undefined,
  };
}

export const useGiveaways = () => {
  const { profile } = useAuth();
  const [giveawayList, setGiveawayList] = useState<Giveaway[]>([]);

  const fetchGiveaways = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setGiveawayList([]);
      return;
    }

    const { data, error } = await supabase
      .from("giveaways")
      .select("*, giveaway_redemptions(count)")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("fetchGiveaways:", error.message);
      setGiveawayList([]);
      return;
    }

    if (data) setGiveawayList((data as Record<string, unknown>[]).map(mapGiveawayRow));
  }, []);

  useEffect(() => {
    void fetchGiveaways();
  }, [fetchGiveaways]);

  const createGiveaway = useCallback(
    async (data: {
      title: string;
      totalAmount: number;
      perPersonAmount: number;
      type: "live" | "scheduled";
      eventId?: string;
      eventName?: string;
      isPrivate: boolean;
      showOnEventScreen: boolean;
    }) => {
      const result = await giveawaysApi.create({
        title: data.title,
        total_amount: data.totalAmount,
        per_person_amount: data.perPersonAmount,
        type: data.type,
        event_id: data.eventId,
        is_private: data.isPrivate,
        show_on_event_screen: data.showOnEventScreen,
      });
      await fetchGiveaways();

      const r = result as Record<string, unknown>;
      const gw = (r.giveaway as Record<string, unknown>) ?? r;
      const id = String(gw.id ?? "");
      const code = String(gw.code ?? "");

      return {
        id,
        code,
        creatorId: profile?.id ?? "",
        creatorName: profile?.full_name ?? "",
        title: data.title,
        totalAmount: data.totalAmount,
        perPersonAmount: data.perPersonAmount,
        remainingAmount: data.totalAmount,
        status: "active" as const,
        type: data.type,
        eventId: data.eventId,
        eventName: data.eventName,
        isPrivate: data.isPrivate,
        showOnEventScreen: data.showOnEventScreen,
        redeemedBy: [],
        redemptionCount: 0,
        redemptions: [],
        createdAt: new Date().toISOString(),
      } satisfies Giveaway;
    },
    [fetchGiveaways, profile?.id, profile?.full_name]
  );

  const redeemGiveaway = useCallback(
    async (code: string) => {
      try {
        const result = await giveawaysApi.redeem(code);
        await fetchGiveaways();
        const r = result as Record<string, unknown>;
        return {
          success: Boolean(r.ok),
          message: (typeof r.message === "string" && r.message) || "Redeemed successfully!",
          amount: ((r.amount as number) ?? 0) / 100,
        };
      } catch (err: unknown) {
        return {
          success: false,
          message: err instanceof Error ? err.message : "Redemption failed",
        };
      }
    },
    [fetchGiveaways]
  );

  const stopGiveaway = useCallback(
    async (giveawayId: string): Promise<number> => {
      try {
        const result = await giveawaysApi.stop(giveawayId);
        await fetchGiveaways();
        const r = result as Record<string, unknown>;
        const kobo = (r.refunded as number) ?? (r.refunded_amount as number) ?? 0;
        return kobo / 100;
      } catch {
        return 0;
      }
    },
    [fetchGiveaways]
  );

  const loadGiveawayDetail = useCallback(async (g: Giveaway): Promise<Giveaway> => {
    const row = (await giveawaysApi.getById(g.id)) as Record<string, unknown>;
    return mapGiveawayRow(row);
  }, []);

  const getMyGiveaways = useCallback(() => {
    if (!profile?.id) return [];
    return giveawayList.filter((x) => x.creatorId === profile.id);
  }, [giveawayList, profile?.id]);

  const getActiveGiveaways = useCallback(() => {
    return giveawayList.filter((g) => g.status === "active" && !g.isPrivate);
  }, [giveawayList]);

  const getEventGiveaways = useCallback(
    (eventId: string) => giveawayList.filter((g) => g.eventId === eventId && g.status === "active"),
    [giveawayList]
  );

  const findGiveawayByCode = useCallback(
    (code: string) => giveawayList.find((g) => g.code.toUpperCase() === code.toUpperCase()),
    [giveawayList]
  );

  return {
    giveaways: giveawayList,
    createGiveaway,
    redeemGiveaway,
    stopGiveaway,
    loadGiveawayDetail,
    getMyGiveaways,
    getActiveGiveaways,
    getEventGiveaways,
    findGiveawayByCode,
    refetchGiveaways: fetchGiveaways,
  };
};
