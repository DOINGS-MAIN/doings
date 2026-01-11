import { motion } from "framer-motion";
import { MapPin, Users, ChevronRight, Zap } from "lucide-react";

export interface Event {
  id: string;
  title: string;
  type: string;
  location: string;
  participants: number;
  timeLeft: string;
  emoji: string;
  gradient: string;
}

interface EventListProps {
  events?: Event[];
  onJoinEvent?: (event: Event) => void;
}

const defaultEvents: Event[] = [
  {
    id: "demo-1",
    title: "Ade & Bimpe Wedding",
    type: "Wedding",
    location: "Lagos, Nigeria",
    participants: 234,
    timeLeft: "Live Now",
    emoji: "💒",
    gradient: "from-pink-500 to-rose-600",
  },
  {
    id: "demo-2",
    title: "Tech Summit Afterparty",
    type: "Party",
    location: "Victoria Island",
    participants: 89,
    timeLeft: "2h left",
    emoji: "🎉",
    gradient: "from-violet-500 to-purple-600",
  },
  {
    id: "demo-3",
    title: "Chief's Birthday Bash",
    type: "Birthday",
    location: "Abuja",
    participants: 156,
    timeLeft: "Live Now",
    emoji: "🎂",
    gradient: "from-amber-500 to-orange-600",
  },
];

export const EventList = ({ events, onJoinEvent }: EventListProps) => {
  const displayEvents = events && events.length > 0 ? events : defaultEvents;

  return (
    <section className="px-6 py-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-foreground">Live Events</h2>
        <button className="text-primary text-sm font-medium flex items-center gap-1 hover:gap-2 transition-all">
          See all
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-3">
        {displayEvents.map((event, index) => (
          <motion.div
            key={event.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.5 + index * 0.1 }}
            whileHover={{ scale: 1.02, x: 4 }}
            whileTap={{ scale: 0.98 }}
            className="glass rounded-2xl p-4 cursor-pointer card-interactive"
            onClick={() => onJoinEvent?.(event)}
          >
            <div className="flex items-center gap-4">
              <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${event.gradient} flex items-center justify-center text-2xl shrink-0`}>
                {event.emoji}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                    {event.type}
                  </span>
                  {event.timeLeft === "Live Now" && (
                    <span className="flex items-center gap-1 text-xs font-medium text-green-400">
                      <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                      Live
                    </span>
                  )}
                </div>
                <h3 className="font-bold text-foreground truncate">{event.title}</h3>
                <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    {event.location}
                  </span>
                  <span className="flex items-center gap-1">
                    <Users className="w-3 h-3" />
                    {event.participants}
                  </span>
                </div>
              </div>

              <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
            </div>
            
            {event.timeLeft === "Live Now" && (
              <motion.div
                className="mt-3 flex justify-end"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.6 + index * 0.1 }}
              >
                <button className="flex items-center gap-2 bg-primary/20 hover:bg-primary/30 text-primary px-4 py-2 rounded-xl text-sm font-semibold transition-colors">
                  <Zap className="w-4 h-4" />
                  Join & Spray
                </button>
              </motion.div>
            )}
          </motion.div>
        ))}
      </div>
    </section>
  );
};
