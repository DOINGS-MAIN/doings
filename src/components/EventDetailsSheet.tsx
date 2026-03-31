import { motion } from "framer-motion";
import { 
  X, Calendar, Clock, MapPin, Users, Copy, Share2, 
  Play, Square, Edit2, Trash2, TrendingUp, QrCode,
  Globe, Lock, ChevronRight, Tv
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { EventData } from "@/hooks/useEvents";
import { toast } from "sonner";

interface EventDetailsSheetProps {
  event: EventData | null;
  isOpen: boolean;
  onClose: () => void;
  onGoLive: (eventId: string) => void;
  onEndEvent: (eventId: string) => void;
  onDelete: (eventId: string) => void;
  onOpenEventScreen?: (event: EventData) => void;
}

const statusConfig = {
  draft: { label: "Draft", color: "bg-gray-500", bgColor: "bg-gray-500/20", textColor: "text-gray-400" },
  scheduled: { label: "Scheduled", color: "bg-blue-500", bgColor: "bg-blue-500/20", textColor: "text-blue-400" },
  live: { label: "Live", color: "bg-green-500", bgColor: "bg-green-500/20", textColor: "text-green-400" },
  ended: { label: "Ended", color: "bg-muted", bgColor: "bg-muted/20", textColor: "text-muted-foreground" },
};

export const EventDetailsSheet = ({ 
  event, 
  isOpen, 
  onClose, 
  onGoLive, 
  onEndEvent,
  onDelete,
  onOpenEventScreen
}: EventDetailsSheetProps) => {
  if (!event) return null;

  const status = statusConfig[event.status];

  const handleCopyCode = () => {
    navigator.clipboard.writeText(event.eventCode);
    toast.success("Event code copied!");
  };

  const handleShare = () => {
    const shareText = `Join my event "${event.title}" on Doings! 🎉\nEvent Code: ${event.eventCode}`;
    
    if (navigator.share) {
      navigator.share({
        title: event.title,
        text: shareText,
        url: window.location.href,
      });
    } else {
      navigator.clipboard.writeText(shareText);
      toast.success("Event details copied!");
    }
  };

  const handleDelete = () => {
    if (event.status === 'live') {
      toast.error("Cannot delete a live event. End it first.");
      return;
    }
    onDelete(event.id);
    toast.success("Event deleted");
    onClose();
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-NG", { 
      weekday: "long",
      day: "numeric", 
      month: "long",
      year: "numeric"
    });
  };

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent
        side="bottom"
        className="flex h-[90dvh] max-h-[90dvh] flex-col overflow-hidden rounded-t-3xl bg-background"
      >
        <SheetHeader className="shrink-0 pb-4">
          <SheetTitle className="sr-only">Event Details</SheetTitle>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain pb-32 [-webkit-overflow-scrolling:touch]">
          {/* Event Header */}
          <div className="flex items-start gap-4 mb-6">
            <div className={`w-20 h-20 rounded-2xl bg-gradient-to-br ${event.gradient} flex items-center justify-center text-4xl shrink-0`}>
              {event.emoji}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <span className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${status.bgColor} ${status.textColor}`}>
                  <span className={`w-2 h-2 rounded-full ${status.color} ${event.status === 'live' ? 'animate-pulse' : ''}`} />
                  {status.label}
                </span>
                {event.isPrivate ? (
                  <Lock className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <Globe className="w-4 h-4 text-muted-foreground" />
                )}
              </div>
              <h2 className="text-2xl font-bold text-foreground">{event.title}</h2>
              <p className="text-sm text-muted-foreground mt-1">Hosted by {event.hostName}</p>
            </div>
          </div>

          {/* Event Code Section */}
          <motion.div
            className="glass rounded-2xl p-4 mb-6"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-muted-foreground">Event Code</span>
              <div className="flex gap-2">
                <motion.button
                  onClick={handleCopyCode}
                  className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
                  whileTap={{ scale: 0.95 }}
                >
                  <Copy className="w-4 h-4 text-foreground" />
                </motion.button>
                <motion.button
                  onClick={handleShare}
                  className="p-2 rounded-lg bg-primary/20 hover:bg-primary/30 transition-colors"
                  whileTap={{ scale: 0.95 }}
                >
                  <Share2 className="w-4 h-4 text-primary" />
                </motion.button>
              </div>
            </div>
            <div className="flex items-center justify-center gap-2 py-4 bg-white/5 rounded-xl">
              <span className="text-4xl font-mono font-bold text-primary tracking-widest">
                {event.eventCode}
              </span>
            </div>
            <p className="text-xs text-muted-foreground text-center mt-2">
              Share this code with your guests to join
            </p>
          </motion.div>

          {/* Event Details */}
          <div className="space-y-4 mb-6">
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Details</h3>
            
            <div className="glass rounded-xl p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
                <Calendar className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Date</p>
                <p className="font-medium text-foreground">{formatDate(event.date)}</p>
              </div>
            </div>

            <div className="glass rounded-xl p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
                <Clock className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Time</p>
                <p className="font-medium text-foreground">{event.time}</p>
              </div>
            </div>

            <div className="glass rounded-xl p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
                <MapPin className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Location</p>
                <p className="font-medium text-foreground">{event.location}</p>
              </div>
            </div>

            {event.description && (
              <div className="glass rounded-xl p-4">
                <p className="text-sm text-muted-foreground mb-2">Description</p>
                <p className="text-foreground">{event.description}</p>
              </div>
            )}
          </div>

          {/* Stats */}
          <div className="space-y-4 mb-6">
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Statistics</h3>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="glass rounded-xl p-4 text-center">
                <Users className="w-6 h-6 text-primary mx-auto mb-2" />
                <p className="text-2xl font-bold text-foreground">{event.participants}</p>
                <p className="text-sm text-muted-foreground">Participants</p>
              </div>
              <div className="glass rounded-xl p-4 text-center">
                <TrendingUp className="w-6 h-6 text-primary mx-auto mb-2" />
                <p className="text-2xl font-bold text-primary">₦{event.totalSprayed.toLocaleString()}</p>
                <p className="text-sm text-muted-foreground">Total Sprayed</p>
              </div>
            </div>
          </div>

          {/* Event Screen Button (for live events) */}
          {event.status === 'live' && onOpenEventScreen && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6"
            >
              <motion.button
                onClick={() => onOpenEventScreen(event)}
                className="w-full glass rounded-2xl p-4 flex items-center justify-between"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center">
                    <Tv className="w-6 h-6 text-primary-foreground" />
                  </div>
                  <div className="text-left">
                    <p className="font-bold text-foreground">Event Screen</p>
                    <p className="text-sm text-muted-foreground">Display on TV/Projector</p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground" />
              </motion.button>
            </motion.div>
          )}

          {/* Danger Zone */}
          {event.status !== 'live' && (
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-red-400 uppercase tracking-wide">Danger Zone</h3>
              <motion.button
                onClick={handleDelete}
                className="w-full flex items-center justify-center gap-2 bg-red-500/20 text-red-400 py-3 rounded-xl font-semibold"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <Trash2 className="w-5 h-5" />
                Delete Event
              </motion.button>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="absolute bottom-0 left-0 right-0 p-6 bg-background border-t border-white/10">
          {event.status === 'draft' || event.status === 'scheduled' ? (
            <motion.button
              onClick={() => {
                onGoLive(event.id);
                onClose();
              }}
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-green-500 to-emerald-600 text-white py-4 rounded-xl font-bold text-lg"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <Play className="w-6 h-6" />
              Go Live Now
            </motion.button>
          ) : event.status === 'live' ? (
            <motion.button
              onClick={() => {
                onEndEvent(event.id);
                onClose();
              }}
              className="w-full flex items-center justify-center gap-2 bg-red-500 text-white py-4 rounded-xl font-bold text-lg"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <Square className="w-6 h-6" />
              End Event
            </motion.button>
          ) : (
            <motion.button
              onClick={handleShare}
              className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground py-4 rounded-xl font-bold text-lg"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <Share2 className="w-6 h-6" />
              Share Event Summary
            </motion.button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};
