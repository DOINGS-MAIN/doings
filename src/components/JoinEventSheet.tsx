import { useState } from "react";
import { motion } from "framer-motion";
import { Search, Hash, ChevronRight, MapPin, Users, Zap } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { EventData } from "@/hooks/useEvents";
import { toast } from "sonner";

interface JoinEventSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onJoinEvent: (event: EventData) => void;
  findEventByCode: (code: string) => EventData | undefined;
  liveEvents: EventData[];
}

export const JoinEventSheet = ({ 
  isOpen, 
  onClose, 
  onJoinEvent, 
  findEventByCode,
  liveEvents 
}: JoinEventSheetProps) => {
  const [eventCode, setEventCode] = useState("");
  const [searchedEvent, setSearchedEvent] = useState<EventData | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  const handleSearchByCode = () => {
    if (eventCode.length < 4) {
      toast.error("Please enter a valid event code");
      return;
    }

    setIsSearching(true);
    
    // Simulate search delay
    setTimeout(() => {
      const event = findEventByCode(eventCode);
      if (event) {
        setSearchedEvent(event);
        if (event.status !== 'live') {
          toast.info("This event is not live yet");
        }
      } else {
        toast.error("Event not found. Check the code and try again.");
        setSearchedEvent(null);
      }
      setIsSearching(false);
    }, 500);
  };

  const handleJoin = (event: EventData) => {
    if (event.status !== 'live') {
      toast.error("This event is not live yet");
      return;
    }
    onJoinEvent(event);
    onClose();
    setEventCode("");
    setSearchedEvent(null);
  };

  return (
    <Sheet open={isOpen} onOpenChange={() => {
      onClose();
      setEventCode("");
      setSearchedEvent(null);
    }}>
      <SheetContent side="bottom" className="h-[85vh] bg-background rounded-t-3xl">
        <SheetHeader className="pb-4">
          <SheetTitle className="text-xl font-bold text-foreground">Join Event</SheetTitle>
          <p className="text-sm text-muted-foreground">
            Enter an event code or browse live events
          </p>
        </SheetHeader>

        <div className="overflow-y-auto pb-8">
          {/* Search by Code */}
          <div className="mb-8">
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
              Have an Event Code?
            </h3>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <Input
                  placeholder="Enter event code"
                  value={eventCode}
                  onChange={(e) => setEventCode(e.target.value.toUpperCase())}
                  className="pl-10 bg-white/5 border-white/10 uppercase tracking-widest font-mono"
                  maxLength={8}
                />
              </div>
              <motion.button
                onClick={handleSearchByCode}
                disabled={isSearching}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-xl font-semibold flex items-center gap-2"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                {isSearching ? (
                  <motion.div
                    className="w-5 h-5 border-2 border-primary-foreground border-t-transparent rounded-full"
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  />
                ) : (
                  <>
                    <Search className="w-4 h-4" />
                    Find
                  </>
                )}
              </motion.button>
            </div>

            {/* Searched Event Result */}
            {searchedEvent && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-4 glass rounded-2xl p-4"
              >
                <div className="flex items-center gap-4">
                  <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${searchedEvent.gradient} flex items-center justify-center text-2xl shrink-0`}>
                    {searchedEvent.emoji}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {searchedEvent.status === 'live' && (
                        <span className="flex items-center gap-1 text-xs font-medium text-green-400">
                          <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                          Live
                        </span>
                      )}
                    </div>
                    <h3 className="font-bold text-foreground truncate">{searchedEvent.title}</h3>
                    <p className="text-sm text-muted-foreground">{searchedEvent.location}</p>
                  </div>
                </div>
                <motion.button
                  onClick={() => handleJoin(searchedEvent)}
                  disabled={searchedEvent.status !== 'live'}
                  className={`w-full mt-4 flex items-center justify-center gap-2 py-3 rounded-xl font-bold ${
                    searchedEvent.status === 'live'
                      ? 'bg-gradient-to-r from-primary to-accent text-primary-foreground'
                      : 'bg-white/10 text-muted-foreground'
                  }`}
                  whileHover={searchedEvent.status === 'live' ? { scale: 1.02 } : {}}
                  whileTap={searchedEvent.status === 'live' ? { scale: 0.98 } : {}}
                >
                  {searchedEvent.status === 'live' ? (
                    <>
                      <Zap className="w-5 h-5" />
                      Join & Spray
                    </>
                  ) : (
                    'Event Not Live Yet'
                  )}
                </motion.button>
              </motion.div>
            )}
          </div>

          {/* Live Events */}
          <div>
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
              Live Events Near You
            </h3>
            
            {liveEvents.length === 0 ? (
              <div className="glass rounded-2xl p-6 text-center">
                <p className="text-muted-foreground">No live events at the moment</p>
              </div>
            ) : (
              <div className="space-y-3">
                {liveEvents.map((event, index) => (
                  <motion.div
                    key={event.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.05 }}
                    onClick={() => handleJoin(event)}
                    className="glass rounded-2xl p-4 cursor-pointer card-interactive"
                  >
                    <div className="flex items-center gap-4">
                      <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${event.gradient} flex items-center justify-center text-2xl shrink-0`}>
                        {event.emoji}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="flex items-center gap-1 text-xs font-medium text-green-400">
                            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                            Live
                          </span>
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
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};
