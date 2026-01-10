import { motion } from "framer-motion";
import { MapPin, Users, Clock, ChevronRight } from "lucide-react";

interface Event {
  id: string;
  title: string;
  type: string;
  location: string;
  participants: number;
  timeLeft: string;
  emoji: string;
  gradient: string;
}

const liveEvents: Event[] = [
  {
    id: "1",
    title: "Ade & Bimpe Wedding",
    type: "Wedding",
    location: "Lagos, Nigeria",
    participants: 234,
    timeLeft: "Live Now",
    emoji: "💒",
    gradient: "from-pink-500 to-rose-600",
  },
  {
    id: "2",
    title: "Tech Summit Afterparty",
    type: "Party",
    location: "Victoria Island",
    participants: 89,
    timeLeft: "2h left",
    emoji: "🎉",
    gradient: "from-violet-500 to-purple-600",
  },
  {
    id: "3",
    title: "Chief's Birthday Bash",
    type: "Birthday",
    location: "Abuja",
    participants: 156,
    timeLeft: "Live Now",
    emoji: "🎂",
    gradient: "from-amber-500 to-orange-600",
  },
];

export const EventList = () => {
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
        {liveEvents.map((event, index) => (
          <motion.div
            key={event.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.5 + index * 0.1 }}
            whileHover={{ scale: 1.02, x: 4 }}
            whileTap={{ scale: 0.98 }}
            className="glass rounded-2xl p-4 cursor-pointer card-interactive flex items-center gap-4"
          >
            {/* Event icon */}
            <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${event.gradient} flex items-center justify-center text-2xl shrink-0`}>
              {event.emoji}
            </div>

            {/* Event details */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                  {event.type}
                </span>
                {event.timeLeft === "Live Now" && (
                  <span className="flex items-center gap-1 text-xs font-medium text-success">
                    <span className="w-2 h-2 bg-success rounded-full animate-pulse" />
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
          </motion.div>
        ))}
      </div>
    </section>
  );
};
