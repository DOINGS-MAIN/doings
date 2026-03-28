import { motion } from "framer-motion";
import { Bell, CheckCheck, Loader2 } from "lucide-react";
import { useNotifications, Notification } from "@/hooks/useNotifications";
import { Button } from "@/components/ui/button";

const ICON_MAP: Record<string, string> = {
  deposit: "💰",
  withdrawal: "🏦",
  spray_received: "🎉",
  transfer: "💸",
  kyc_update: "🛡️",
  giveaway_redeemed: "🎁",
  system: "🔔",
};

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function NotificationItem({ notification, onRead }: { notification: Notification; onRead: (id: string) => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex gap-3 p-4 rounded-2xl cursor-pointer transition-colors ${
        notification.read ? "bg-transparent" : "bg-primary/5"
      }`}
      onClick={() => !notification.read && onRead(notification.id)}
    >
      <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center text-lg shrink-0">
        {ICON_MAP[notification.type] ?? "🔔"}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className={`text-sm ${notification.read ? "text-muted-foreground" : "font-semibold text-foreground"}`}>
            {notification.title}
          </p>
          {!notification.read && (
            <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5" />
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{notification.body}</p>
        <p className="text-xs text-muted-foreground/60 mt-1">{timeAgo(notification.created_at)}</p>
      </div>
    </motion.div>
  );
}

export const NotificationsScreen = () => {
  const { notifications, unreadCount, loading, markRead, markAllRead } = useNotifications();

  return (
    <div className="px-6 pt-12 pb-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Notifications</h1>
          {unreadCount > 0 && (
            <p className="text-sm text-muted-foreground">{unreadCount} unread</p>
          )}
        </div>
        {unreadCount > 0 && (
          <Button variant="ghost" size="sm" onClick={markAllRead} className="text-primary">
            <CheckCheck className="w-4 h-4 mr-1" />
            Mark all read
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : notifications.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Bell className="w-12 h-12 mb-3 opacity-30" />
          <p className="font-medium">No notifications yet</p>
          <p className="text-sm mt-1">We'll notify you about deposits, sprays, and more</p>
        </div>
      ) : (
        <div className="space-y-1">
          {notifications.map((n) => (
            <NotificationItem key={n.id} notification={n} onRead={markRead} />
          ))}
        </div>
      )}
    </div>
  );
};
