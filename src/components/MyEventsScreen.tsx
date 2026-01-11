import { motion } from "framer-motion";
import { Plus, Calendar, MapPin, Users, Clock, Play, Square, Share2, Settings, TrendingUp, ChevronRight } from "lucide-react";
import { EventData } from "@/hooks/useEvents";
import { toast } from "sonner";

interface MyEventsScreenProps {
  events: EventData[];
  onCreateEvent: () => void;
  onGoLive: (eventId: string) => void;
  onEndEvent: (eventId: string) => void;
  onManageEvent: (event: EventData) => void;
}

const statusConfig = {
  draft: { label: "Draft", color: "bg-gray-500", textColor: "text-gray-400" },
  scheduled: { label: "Scheduled", color: "bg-blue-500", textColor: "text-blue-400" },
  live: { label: "Live", color: "bg-green-500", textColor: "text-green-400" },
  ended: { label: "Ended", color: "bg-muted", textColor: "text-muted-foreground" },
};

export const MyEventsScreen = ({ 
  events, 
  onCreateEvent, 
  onGoLive, 
  onEndEvent,
  onManageEvent 
}: MyEventsScreenProps) => {
  const handleShare = (event: EventData) => {
    const shareText = `Join my event "${event.title}" on Doings! 🎉\nEvent Code: ${event.eventCode}`;
    
    if (navigator.share) {
      navigator.share({
        title: event.title,
        text: shareText,
        url: window.location.href,
      });
    } else {
      navigator.clipboard.writeText(shareText);
      toast.success("Event details copied to clipboard!");
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-NG", { 
      day: "numeric", 
      month: "short",
      year: "numeric"
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="px-6 py-4"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">My Events</h1>
          <p className="text-sm text-muted-foreground">{events.length} event{events.length !== 1 ? 's' : ''} created</p>
        </div>
        <motion.button
          onClick={onCreateEvent}
          className="w-12 h-12 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center"
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.95 }}
        >
          <Plus className="w-6 h-6 text-primary-foreground" />
        </motion.button>
      </div>

      {/* Quick Stats */}
      {events.length > 0 && (
        <motion.div
          className="grid grid-cols-3 gap-3 mb-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <div className="glass rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-foreground">
              {events.filter(e => e.status === 'live').length}
            </p>
            <p className="text-xs text-muted-foreground">Live Now</p>
          </div>
          <div className="glass rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-foreground">
              {events.reduce((acc, e) => acc + e.participants, 0)}
            </p>
            <p className="text-xs text-muted-foreground">Total Guests</p>
          </div>
          <div className="glass rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-primary">
              ₦{(events.reduce((acc, e) => acc + e.totalSprayed, 0) / 1000).toFixed(0)}K
            </p>
            <p className="text-xs text-muted-foreground">Total Sprayed</p>
          </div>
        </motion.div>
      )}

      {/* Events List */}
      {events.length === 0 ? (
        <motion.div
          className="glass rounded-2xl p-8 text-center"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-4">
            <Calendar className="w-10 h-10 text-primary" />
          </div>
          <h3 className="text-xl font-bold text-foreground mb-2">No Events Yet</h3>
          <p className="text-muted-foreground mb-6">
            Create your first event and start receiving sprays from your guests!
          </p>
          <motion.button
            onClick={onCreateEvent}
            className="bg-gradient-to-r from-primary to-accent text-primary-foreground px-6 py-3 rounded-xl font-bold flex items-center gap-2 mx-auto"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <Plus className="w-5 h-5" />
            Create Event
          </motion.button>
        </motion.div>
      ) : (
        <div className="space-y-4">
          {events.map((event, index) => (
            <motion.div
              key={event.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + index * 0.05 }}
              className="glass rounded-2xl p-4 overflow-hidden"
            >
              {/* Event Header */}
              <div className="flex items-start gap-4 mb-4">
                <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${event.gradient} flex items-center justify-center text-2xl shrink-0`}>
                  {event.emoji}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`flex items-center gap-1 text-xs font-medium ${statusConfig[event.status].textColor}`}>
                      <span className={`w-2 h-2 rounded-full ${statusConfig[event.status].color} ${event.status === 'live' ? 'animate-pulse' : ''}`} />
                      {statusConfig[event.status].label}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono">
                      #{event.eventCode}
                    </span>
                  </div>
                  <h3 className="font-bold text-foreground truncate">{event.title}</h3>
                  <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {event.location}
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {formatDate(event.date)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Event Stats */}
              <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="bg-white/5 rounded-lg p-2 text-center">
                  <p className="text-sm font-bold text-foreground flex items-center justify-center gap-1">
                    <Users className="w-3 h-3" />
                    {event.participants}
                  </p>
                  <p className="text-xs text-muted-foreground">Guests</p>
                </div>
                <div className="bg-white/5 rounded-lg p-2 text-center">
                  <p className="text-sm font-bold text-primary flex items-center justify-center gap-1">
                    <TrendingUp className="w-3 h-3" />
                    ₦{(event.totalSprayed / 1000).toFixed(0)}K
                  </p>
                  <p className="text-xs text-muted-foreground">Sprayed</p>
                </div>
                <div className="bg-white/5 rounded-lg p-2 text-center">
                  <p className="text-sm font-bold text-foreground flex items-center justify-center gap-1">
                    <Clock className="w-3 h-3" />
                    {event.time}
                  </p>
                  <p className="text-xs text-muted-foreground">Time</p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2">
                {event.status === 'draft' || event.status === 'scheduled' ? (
                  <motion.button
                    onClick={() => onGoLive(event.id)}
                    className="flex-1 flex items-center justify-center gap-2 bg-green-500/20 text-green-400 py-2.5 rounded-xl font-semibold text-sm"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <Play className="w-4 h-4" />
                    Go Live
                  </motion.button>
                ) : event.status === 'live' ? (
                  <motion.button
                    onClick={() => onEndEvent(event.id)}
                    className="flex-1 flex items-center justify-center gap-2 bg-red-500/20 text-red-400 py-2.5 rounded-xl font-semibold text-sm"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <Square className="w-4 h-4" />
                    End Event
                  </motion.button>
                ) : null}
                
                <motion.button
                  onClick={() => handleShare(event)}
                  className="flex items-center justify-center gap-2 bg-primary/20 text-primary px-4 py-2.5 rounded-xl font-semibold text-sm"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <Share2 className="w-4 h-4" />
                </motion.button>
                
                <motion.button
                  onClick={() => onManageEvent(event)}
                  className="flex items-center justify-center gap-2 bg-white/10 text-foreground px-4 py-2.5 rounded-xl font-semibold text-sm"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <Settings className="w-4 h-4" />
                </motion.button>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
};
