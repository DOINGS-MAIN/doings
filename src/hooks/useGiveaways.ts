import { useState, useEffect, useCallback } from "react";
import { supabase, giveaways as giveawaysApi } from "@/lib/supabase";

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

function mapDbGiveaway(g: Record<string, unknown>): Giveaway {
  return {
    id: g.id as string,
    creatorId: (g.creator_id as string) ?? "",
    creatorName: (g.creator_name as string) ?? "",
    title: (g.title as string) ?? "",
    totalAmount: ((g.total_amount as number) ?? 0) / 100,
    perPersonAmount: ((g.per_person_amount as number) ?? 0) / 100,
    remainingAmount: ((g.remaining_amount as number) ?? 0) / 100,
    code: (g.code as string) ?? "",
    status: (g.status as Giveaway["status"]) ?? "active",
    type: (g.type as Giveaway["type"]) ?? "live",
    eventId: g.event_id as string | undefined,
    isPrivate: (g.is_private as boolean) ?? false,
    showOnEventScreen: true,
    redeemedBy: [],
    redemptions: [],
    createdAt: (g.created_at as string) ?? "",
    stoppedAt: g.stopped_at as string | undefined,
  };
}

export const useGiveaways = () => {
  const [giveawayList, setGiveawayList] = useState<Giveaway[]>([]);

  const fetchGiveaways = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { data } = await supabase
      .from("giveaways")
      .select("*")
      .order("created_at", { ascending: false });

    if (data) setGiveawayList(data.map(mapDbGiveaway));
  }, []);

  useEffect(() => {
    fetchGiveaways();
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
        total_amount: Math.round(data.totalAmount * 100),
        per_person_amount: Math.round(data.perPersonAmount * 100),
        type: data.type,
        event_id: data.eventId,
        is_private: data.isPrivate,
      });
      await fetchGiveaways();

      const r = result as Record<string, unknown>;
      return {
        id: (r.id as string) ?? "",
        code: (r.code as string) ?? "",
        creatorId: "",
        creatorName: "",
        title: data.title,
        totalAmount: data.totalAmount,
        perPersonAmount: data.perPersonAmount,
        remainingAmount: data.totalAmount,
        status: "active" as const,
        type: data.type,
        eventId: data.eventId,
        isPrivate: data.isPrivate,
        showOnEventScreen: data.showOnEventScreen,
        redeemedBy: [],
        redemptions: [],
        createdAt: new Date().toISOString(),
      } as Giveaway;
    },
    [fetchGiveaways]
  );

  const redeemGiveaway = useCallback(
    async (code: string) => {
      try {
        const result = await giveawaysApi.redeem(code);
        await fetchGiveaways();
        const r = result as Record<string, unknown>;
        return {
          success: true,
          message: r.message as string ?? "Redeemed successfully!",
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
        return ((r.refunded_amount as number) ?? 0) / 100;
      } catch {
        return 0;
      }
    },
    [fetchGiveaways]
  );

  const getMyGiveaways = useCallback(() => {
    return giveawayList.filter((g) => g.creatorId !== "");
  }, [giveawayList]);

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
    getMyGiveaways,
    getActiveGiveaways,
    getEventGiveaways,
    findGiveawayByCode,
  };
};
