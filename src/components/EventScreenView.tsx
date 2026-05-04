import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Trophy,
  Gift,
  Sparkles,
  Users,
  X,
  Maximize2,
  QrCode,
  TrendingUp,
  Crown,
  Medal,
} from "lucide-react";
import { EventData } from "@/hooks/useEvents";
import { Giveaway } from "@/hooks/useGiveaways";
import QRCode from "react-qr-code";

export interface EventScreenViewProps {
  event: EventData;
  giveaways: Giveaway[];
  onBack: () => void;
}

interface SprayActivity {
  id: string;
  name: string;
  avatar: string;
  amount: number;
  timestamp: Date;
}

const generateMockActivities = (): SprayActivity[] => {
  const names = ["Big Daddy", "Money Rain", "Naira Queen", "Cash Flow", "Party King"];
  const avatars = ["👑", "💸", "👸", "🤑", "🎉"];

  return Array.from({ length: 5 }, (_, i) => ({
    id: `activity_${i}`,
    name: names[i],
    avatar: avatars[i],
    amount: Math.floor(Math.random() * 50000) + 10000,
    timestamp: new Date(Date.now() - i * 60000),
  }));
};

export const EventScreenView = ({ event, giveaways, onBack }: EventScreenViewProps) => {
  const [activities, setActivities] = useState<SprayActivity[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    setActivities(generateMockActivities());

    const interval = setInterval(() => {
      const newActivity: SprayActivity = {
        id: `activity_${Date.now()}`,
        name: ["Champion", "Baller", "Money Bag", "Oluwa Spray"][Math.floor(Math.random() * 4)],
        avatar: ["🏆", "🏀", "💰", "⭐"][Math.floor(Math.random() * 4)],
        amount: Math.floor(Math.random() * 30000) + 5000,
        timestamp: new Date(),
      };

      setActivities((prev) => [newActivity, ...prev.slice(0, 4)]);
    }, 5000);

    return () => clearInterval(interval);
  }, [event.id]);

  const activeGiveaways = giveaways.filter(
    (g) => g.status === "active" && g.eventId === event.id && g.showOnEventScreen,
  );

  const topGifters = activities
    .reduce((acc, activity) => {
      const existing = acc.find((a) => a.name === activity.name);
      if (existing) {
        existing.amount += activity.amount;
      } else {
        acc.push({ ...activity });
      }
      return acc;
    }, [] as SprayActivity[])
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 3);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      void document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      void document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  return (
    <div className="flex min-h-dvh max-h-dvh flex-col overflow-hidden bg-gradient-to-br from-background via-background to-primary/10">
      <div className="flex shrink-0 items-center justify-between border-b border-border p-4">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-2xl ${event.gradient}`}
          >
            {event.emoji}
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-xl font-black text-foreground">{event.title}</h2>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
                LIVE
              </span>
              <span>•</span>
              <span className="flex items-center gap-1">
                <Users className="h-4 w-4 shrink-0" />
                {event.participants} guests
              </span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <motion.button
            type="button"
            onClick={() => void toggleFullscreen()}
            className="rounded-xl bg-muted p-2 transition-colors hover:bg-muted/80"
            whileTap={{ scale: 0.95 }}
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          >
            <Maximize2 className="h-5 w-5 text-foreground" />
          </motion.button>
          <motion.button
            type="button"
            onClick={onBack}
            className="rounded-xl bg-muted p-2 transition-colors hover:bg-muted/80"
            whileTap={{ scale: 0.95 }}
            aria-label="Close event screen"
          >
            <X className="h-5 w-5 text-foreground" />
          </motion.button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto overscroll-y-contain p-4 [-webkit-overflow-scrolling:touch] md:grid-cols-3">
        <div className="space-y-4 md:col-span-2">
          <div className="mb-2 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h3 className="font-bold text-foreground">Live Sprays</h3>
          </div>

          <div className="space-y-3">
            <AnimatePresence>
              {activities.map((activity, index) => (
                <motion.div
                  key={activity.id}
                  initial={{ opacity: 0, x: -50, scale: 0.8 }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  exit={{ opacity: 0, x: 50 }}
                  transition={{ delay: index * 0.05 }}
                  className="glass flex items-center gap-4 rounded-2xl p-4"
                >
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/20 to-accent/20 text-3xl">
                    {activity.avatar}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-lg font-bold text-foreground">{activity.name}</p>
                    <p className="text-sm text-muted-foreground">Just sprayed</p>
                  </div>
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="shrink-0 rounded-xl bg-gradient-to-r from-primary to-accent px-4 py-2"
                  >
                    <p className="text-lg font-black text-primary-foreground">
                      ₦{activity.amount.toLocaleString()}
                    </p>
                  </motion.div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass rounded-2xl p-6 text-center"
          >
            <p className="mb-2 text-muted-foreground">Total Sprayed</p>
            <p className="text-4xl font-black text-gradient-gold">₦{(event.totalSprayed || 0).toLocaleString()}</p>
          </motion.div>
        </div>

        <div className="space-y-4">
          <div className="glass rounded-2xl p-4">
            <div className="mb-4 flex items-center gap-2">
              <Trophy className="h-5 w-5 text-yellow-500" />
              <h3 className="font-bold text-foreground">Top Gifters</h3>
            </div>

            <div className="space-y-3">
              {topGifters.map((gifter, index) => (
                <motion.div
                  key={gifter.name}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className="flex items-center gap-3"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                    {index === 0 && <Crown className="h-4 w-4 text-yellow-400" />}
                    {index === 1 && <Medal className="h-4 w-4 text-gray-300" />}
                    {index === 2 && <Medal className="h-4 w-4 text-amber-600" />}
                  </div>
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/20 to-accent/20 text-xl">
                    {gifter.avatar}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-foreground">{gifter.name}</p>
                  </div>
                  <p className="shrink-0 font-bold text-primary">₦{gifter.amount.toLocaleString()}</p>
                </motion.div>
              ))}
            </div>
          </div>

          {activeGiveaways.length > 0 && (
            <div className="glass rounded-2xl p-4">
              <div className="mb-4 flex items-center gap-2">
                <Gift className="h-5 w-5 text-accent" />
                <h3 className="font-bold text-foreground">Active Giveaways</h3>
              </div>

              <div className="space-y-4">
                {activeGiveaways.map((giveaway) => (
                  <motion.div
                    key={giveaway.id}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="rounded-xl border border-accent/30 bg-gradient-to-br from-accent/20 to-primary/20 p-4"
                  >
                    <h4 className="mb-2 font-bold text-foreground">{giveaway.title}</h4>
                    <p className="mb-3 text-sm text-muted-foreground">
                      ₦{giveaway.perPersonAmount.toLocaleString()} per person
                    </p>

                    <div className="mx-auto w-fit rounded-xl bg-white p-3">
                      <QRCode value={`https://doings.app/redeem/${giveaway.code}`} size={100} level="M" />
                    </div>

                    <div className="mt-3 text-center">
                      <p className="text-xs text-muted-foreground">Code</p>
                      <p className="font-mono text-lg font-bold tracking-widest text-primary">{giveaway.code}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          )}

          <div className="glass rounded-2xl p-4 text-center">
            <p className="mb-2 text-sm text-muted-foreground">Join this event</p>
            <p className="font-mono text-2xl font-bold tracking-widest text-primary">{event.eventCode}</p>
          </div>
        </div>
      </div>
    </div>
  );
};
