import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Trophy, Gift, Sparkles, Users, X, Maximize2, 
  QrCode, TrendingUp, Crown, Medal, Tv
} from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { EventData } from "@/hooks/useEvents";
import { Giveaway } from "@/hooks/useGiveaways";
import QRCode from "react-qr-code";

interface EventScreenDisplayProps {
  event: EventData | null;
  isOpen: boolean;
  onClose: () => void;
  giveaways: Giveaway[];
}

interface SprayActivity {
  id: string;
  name: string;
  avatar: string;
  amount: number;
  timestamp: Date;
}

// Mock spray activities for demonstration
const generateMockActivities = (): SprayActivity[] => {
  const names = ['Big Daddy', 'Money Rain', 'Naira Queen', 'Cash Flow', 'Party King'];
  const avatars = ['👑', '💸', '👸', '🤑', '🎉'];
  
  return Array.from({ length: 5 }, (_, i) => ({
    id: `activity_${i}`,
    name: names[i],
    avatar: avatars[i],
    amount: Math.floor(Math.random() * 50000) + 10000,
    timestamp: new Date(Date.now() - i * 60000),
  }));
};

export const EventScreenDisplay = ({ event, isOpen, onClose, giveaways }: EventScreenDisplayProps) => {
  const [activities, setActivities] = useState<SprayActivity[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setActivities(generateMockActivities());
      
      // Simulate live updates
      const interval = setInterval(() => {
        const newActivity: SprayActivity = {
          id: `activity_${Date.now()}`,
          name: ['Champion', 'Baller', 'Money Bag', 'Oluwa Spray'][Math.floor(Math.random() * 4)],
          avatar: ['🏆', '🏀', '💰', '⭐'][Math.floor(Math.random() * 4)],
          amount: Math.floor(Math.random() * 30000) + 5000,
          timestamp: new Date(),
        };
        
        setActivities(prev => [newActivity, ...prev.slice(0, 4)]);
      }, 5000);
      
      return () => clearInterval(interval);
    }
  }, [isOpen]);

  const activeGiveaways = giveaways.filter(g => 
    g.status === 'active' && 
    g.eventId === event?.id && 
    g.showOnEventScreen
  );

  const topGifters = activities
    .reduce((acc, activity) => {
      const existing = acc.find(a => a.name === activity.name);
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
      document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  if (!event) return null;

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent
        side="bottom"
        className="flex h-[95dvh] max-h-[95dvh] flex-col overflow-hidden bg-gradient-to-br from-background via-background to-primary/10 p-0"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border p-4">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${event.gradient} flex items-center justify-center text-2xl`}>
              {event.emoji}
            </div>
            <div>
              <h2 className="text-xl font-black text-foreground">{event.title}</h2>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                  LIVE
                </span>
                <span>•</span>
                <span className="flex items-center gap-1">
                  <Users className="w-4 h-4" />
                  {event.participants} guests
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <motion.button
              onClick={toggleFullscreen}
              className="p-2 rounded-xl bg-muted hover:bg-muted/80 transition-colors"
              whileTap={{ scale: 0.95 }}
            >
              <Maximize2 className="w-5 h-5 text-foreground" />
            </motion.button>
            <motion.button
              onClick={onClose}
              className="p-2 rounded-xl bg-muted hover:bg-muted/80 transition-colors"
              whileTap={{ scale: 0.95 }}
            >
              <X className="w-5 h-5 text-foreground" />
            </motion.button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto overscroll-y-contain p-4 [-webkit-overflow-scrolling:touch] md:grid-cols-3">
          {/* Live Activity Feed */}
          <div className="md:col-span-2 space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-5 h-5 text-primary" />
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
                    className="glass rounded-2xl p-4 flex items-center gap-4"
                  >
                    <div className="w-14 h-14 rounded-full bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center text-3xl">
                      {activity.avatar}
                    </div>
                    <div className="flex-1">
                      <p className="font-bold text-foreground text-lg">{activity.name}</p>
                      <p className="text-sm text-muted-foreground">Just sprayed</p>
                    </div>
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="px-4 py-2 rounded-xl bg-gradient-to-r from-primary to-accent"
                    >
                      <p className="font-black text-primary-foreground text-lg">
                        ₦{activity.amount.toLocaleString()}
                      </p>
                    </motion.div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            {/* Total Sprayed */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass rounded-2xl p-6 text-center"
            >
              <p className="text-muted-foreground mb-2">Total Sprayed</p>
              <p className="text-4xl font-black text-gradient-gold">
                ₦{(event.totalSprayed || 0).toLocaleString()}
              </p>
            </motion.div>
          </div>

          {/* Right Sidebar */}
          <div className="space-y-4">
            {/* Top Gifters */}
            <div className="glass rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-4">
                <Trophy className="w-5 h-5 text-yellow-500" />
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
                    <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                      {index === 0 && <Crown className="w-4 h-4 text-yellow-400" />}
                      {index === 1 && <Medal className="w-4 h-4 text-gray-300" />}
                      {index === 2 && <Medal className="w-4 h-4 text-amber-600" />}
                    </div>
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center text-xl">
                      {gifter.avatar}
                    </div>
                    <div className="flex-1">
                      <p className="font-bold text-foreground text-sm">{gifter.name}</p>
                    </div>
                    <p className="font-bold text-primary">₦{gifter.amount.toLocaleString()}</p>
                  </motion.div>
                ))}
              </div>
            </div>

            {/* Active Giveaways */}
            {activeGiveaways.length > 0 && (
              <div className="glass rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-4">
                  <Gift className="w-5 h-5 text-accent" />
                  <h3 className="font-bold text-foreground">Active Giveaways</h3>
                </div>
                
                <div className="space-y-4">
                  {activeGiveaways.map((giveaway) => (
                    <motion.div
                      key={giveaway.id}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="p-4 rounded-xl bg-gradient-to-br from-accent/20 to-primary/20 border border-accent/30"
                    >
                      <h4 className="font-bold text-foreground mb-2">{giveaway.title}</h4>
                      <p className="text-sm text-muted-foreground mb-3">
                        ₦{giveaway.perPersonAmount.toLocaleString()} per person
                      </p>
                      
                      {/* QR Code */}
                      <div className="bg-white p-3 rounded-xl mx-auto w-fit">
                        <QRCode
                          value={`https://doings.app/redeem/${giveaway.code}`}
                          size={100}
                          level="M"
                        />
                      </div>
                      
                      <div className="mt-3 text-center">
                        <p className="text-xs text-muted-foreground">Code</p>
                        <p className="font-mono font-bold text-primary text-lg tracking-widest">
                          {giveaway.code}
                        </p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}

            {/* Event Code */}
            <div className="glass rounded-2xl p-4 text-center">
              <p className="text-sm text-muted-foreground mb-2">Join this event</p>
              <p className="font-mono font-bold text-2xl text-primary tracking-widest">
                {event.eventCode}
              </p>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};
