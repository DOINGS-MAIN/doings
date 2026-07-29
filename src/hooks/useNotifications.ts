import { useState, useEffect, useCallback, useRef } from "react";
import { getAppUserId } from "@/lib/appUser";
import { debounceAsync } from "@/lib/debounceAsync";
import { supabase, notifications as notificationsApi } from "@/lib/supabase";

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  created_at: string;
}

export const useNotifications = () => {
  const [items, setItems] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const refreshRef = useRef<() => Promise<void>>(async () => {});

  const fetchNotifications = useCallback(async () => {
    try {
      const result = await notificationsApi.list(false, 50) as {
        notifications: Notification[];
        unread_count: number;
      };
      setItems(result.notifications ?? []);
      setUnreadCount(result.unread_count ?? 0);
    } catch {
      const appUserId = await getAppUserId();
      if (!appUserId) return;

      const { data } = await supabase
        .from("notifications")
        .select("id, type, title, body, read, created_at")
        .eq("user_id", appUserId)
        .order("created_at", { ascending: false })
        .limit(50);

      if (data) {
        setItems(data);
        setUnreadCount(data.filter((n) => !n.read).length);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  refreshRef.current = fetchNotifications;

  useEffect(() => {
    let cancelled = false;
    const channelRef: { current: ReturnType<typeof supabase.channel> | null } = { current: null };
    const debouncedRefresh = debounceAsync(() => {
      void refreshRef.current();
    }, 250);

    void (async () => {
      await fetchNotifications();
      if (cancelled) return;

      const appUserId = await getAppUserId();
      if (!appUserId || cancelled) return;

      const channel = supabase
        .channel(`notifications-${appUserId}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${appUserId}` },
          () => {
            debouncedRefresh();
          },
        )
        .subscribe();

      if (cancelled) {
        supabase.removeChannel(channel);
        return;
      }
      channelRef.current = channel;
    })();

    return () => {
      cancelled = true;
      debouncedRefresh.cancel();
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [fetchNotifications]);

  const markRead = useCallback(async (notificationId: string) => {
    await notificationsApi.markRead(notificationId);
    setItems((prev) => prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n)));
    setUnreadCount((prev) => Math.max(0, prev - 1));
  }, []);

  const markAllRead = useCallback(async () => {
    await notificationsApi.markAllRead();
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
  }, []);

  return {
    notifications: items,
    unreadCount,
    loading,
    markRead,
    markAllRead,
    refresh: fetchNotifications,
  };
};
