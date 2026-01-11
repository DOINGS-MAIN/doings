import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FloatingMoney } from "@/components/FloatingMoney";
import { HeroSection } from "@/components/HeroSection";
import { FeatureCards } from "@/components/FeatureCards";
import { AuthFlow } from "@/components/AuthFlow";
import { BottomNav } from "@/components/BottomNav";
import { WalletCard } from "@/components/WalletCard";
import { EventList } from "@/components/EventList";
import { FundWalletSheet } from "@/components/FundWalletSheet";
import { TransactionHistory } from "@/components/TransactionHistory";
import { SpraySetupSheet } from "@/components/SpraySetupSheet";
import { SprayAnimation } from "@/components/SprayAnimation";
import { AvatarCustomization, AvatarData } from "@/components/AvatarCustomization";
import { CreateEventSheet } from "@/components/CreateEventSheet";
import { MyEventsScreen } from "@/components/MyEventsScreen";
import { EventDetailsSheet } from "@/components/EventDetailsSheet";
import { JoinEventSheet } from "@/components/JoinEventSheet";
import { useWallet } from "@/hooks/useWallet";
import { useEvents, EventData } from "@/hooks/useEvents";
import { toast } from "sonner";
import { Plus, ChevronRight, Sparkles } from "lucide-react";

type AppState = "onboarding" | "dashboard";

const Index = () => {
  const [appState, setAppState] = useState<AppState>("onboarding");
  const [activeTab, setActiveTab] = useState("home");
  const [showFundSheet, setShowFundSheet] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  
  // Spray state
  const [showSpraySetup, setShowSpraySetup] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<EventData | null>(null);
  const [isSprayActive, setIsSprayActive] = useState(false);
  const [sprayAmount, setSprayAmount] = useState(0);
  const [sprayDenomination, setSprayDenomination] = useState(0);
  
  // Avatar state
  const [showAvatarCustomization, setShowAvatarCustomization] = useState(false);
  const [avatarData, setAvatarData] = useState<AvatarData>({
    photoUrl: null,
    outfit: "agbada",
    accessory: "none",
    background: "gold-gradient",
  });

  // Event creation state
  const [showCreateEvent, setShowCreateEvent] = useState(false);
  const [showEventDetails, setShowEventDetails] = useState(false);
  const [selectedEventDetails, setSelectedEventDetails] = useState<EventData | null>(null);
  const [showJoinEvent, setShowJoinEvent] = useState(false);
  
  const { balance, transactions, addFunds, deductFunds } = useWallet();
  const { 
    events, 
    myEvents, 
    createEvent, 
    goLive, 
    endEvent, 
    deleteEvent,
    findEventByCode, 
    getLiveEvents,
    addSprayAmount,
    joinEvent
  } = useEvents();

  const handleAuthComplete = () => {
    setAppState("dashboard");
  };

  const handleJoinEvent = (event: EventData) => {
    if (event.status !== "live") {
      toast.info("This event hasn't started yet");
      return;
    }
    setSelectedEvent(event);
    setShowSpraySetup(true);
    joinEvent(event.id);
  };

  const handleStartSpray = (amount: number, denomination: number) => {
    setSprayAmount(amount);
    setSprayDenomination(denomination);
    setShowSpraySetup(false);
    setIsSprayActive(true);
  };

  const handleSprayComplete = (sprayedAmount: number) => {
    try {
      deductFunds(sprayedAmount, `Sprayed at ${selectedEvent?.title || "Event"}`);
      if (selectedEvent) {
        addSprayAmount(selectedEvent.id, sprayedAmount);
      }
      toast.success(`Successfully sprayed ₦${sprayedAmount.toLocaleString()}! 🎉`);
    } catch (error) {
      toast.error("Failed to complete spray");
    }
    setIsSprayActive(false);
    setSelectedEvent(null);
  };

  const handleSprayCancel = (sprayedAmount: number) => {
    if (sprayedAmount > 0) {
      try {
        deductFunds(sprayedAmount, `Sprayed at ${selectedEvent?.title || "Event"} (cancelled)`);
        if (selectedEvent) {
          addSprayAmount(selectedEvent.id, sprayedAmount);
        }
        toast.info(`Spray stopped. ₦${sprayedAmount.toLocaleString()} was sprayed.`);
      } catch (error) {
        toast.error("Failed to record spray");
      }
    } else {
      toast.info("Spray cancelled");
    }
    setIsSprayActive(false);
    setSelectedEvent(null);
  };

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
  };

  const handleGoLive = (eventId: string) => {
    goLive(eventId);
    toast.success("Your event is now LIVE! 🎉");
  };

  const handleEndEvent = (eventId: string) => {
    endEvent(eventId);
    toast.success("Event ended successfully");
  };

  const handleManageEvent = (event: EventData) => {
    setSelectedEventDetails(event);
    setShowEventDetails(true);
  };

  // Convert EventData to the format expected by EventList
  const liveEventsForList = getLiveEvents().map(event => ({
    id: event.id,
    title: event.title,
    type: event.type.charAt(0).toUpperCase() + event.type.slice(1),
    location: event.location,
    participants: event.participants,
    timeLeft: event.status === 'live' ? 'Live Now' : 'Scheduled',
    emoji: event.emoji,
    gradient: event.gradient,
  }));

  const renderDashboardContent = () => {
    switch (activeTab) {
      case "events":
        return (
          <MyEventsScreen
            events={myEvents}
            onCreateEvent={() => setShowCreateEvent(true)}
            onGoLive={handleGoLive}
            onEndEvent={handleEndEvent}
            onManageEvent={handleManageEvent}
          />
        );
      
      case "home":
      default:
        return (
          <>
            {/* Header */}
            <motion.header
              className="flex items-center justify-between px-6 pt-12 pb-6"
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
            >
              <div>
                <p className="text-muted-foreground text-sm">Welcome back,</p>
                <h1 className="text-2xl font-bold text-foreground">Champion 👋</h1>
              </div>
              <motion.button
                onClick={() => setShowAvatarCustomization(true)}
                className="w-12 h-12 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-xl font-bold text-primary-foreground overflow-hidden"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                {avatarData.photoUrl ? (
                  <img src={avatarData.photoUrl} alt="Avatar" className="w-full h-full object-cover" />
                ) : (
                  "C"
                )}
              </motion.button>
            </motion.header>

            {/* Wallet */}
            <WalletCard 
              balance={balance}
              onAddFunds={() => setShowFundSheet(true)}
              onViewHistory={() => setShowHistory(true)}
            />

            {/* Quick Actions */}
            <motion.div
              className="px-6 mb-6 grid grid-cols-2 gap-3"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
            >
              <motion.button
                onClick={() => setShowJoinEvent(true)}
                className="glass rounded-2xl p-4 flex flex-col items-center gap-2"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <div className="w-12 h-12 rounded-2xl bg-primary/20 flex items-center justify-center text-2xl">
                  🎯
                </div>
                <div className="text-center">
                  <h3 className="font-bold text-foreground text-sm">Join Event</h3>
                  <p className="text-xs text-muted-foreground">Spray money</p>
                </div>
              </motion.button>

              <motion.button
                onClick={() => setShowCreateEvent(true)}
                className="glass rounded-2xl p-4 flex flex-col items-center gap-2"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <div className="w-12 h-12 rounded-2xl bg-accent/20 flex items-center justify-center">
                  <Plus className="w-6 h-6 text-accent" />
                </div>
                <div className="text-center">
                  <h3 className="font-bold text-foreground text-sm">Create Event</h3>
                  <p className="text-xs text-muted-foreground">Host a party</p>
                </div>
              </motion.button>
            </motion.div>

            {/* My Events Preview */}
            {myEvents.length > 0 && (
              <motion.section
                className="px-6 mb-6"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.45 }}
              >
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-lg font-bold text-foreground">My Events</h2>
                  <button 
                    onClick={() => setActiveTab("events")}
                    className="text-primary text-sm font-medium flex items-center gap-1 hover:gap-2 transition-all"
                  >
                    See all
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
                <div className="glass rounded-2xl p-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${myEvents[0].gradient} flex items-center justify-center text-xl`}>
                      {myEvents[0].emoji}
                    </div>
                    <div className="flex-1">
                      <h3 className="font-bold text-foreground text-sm">{myEvents[0].title}</h3>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs ${myEvents[0].status === 'live' ? 'text-green-400' : 'text-muted-foreground'}`}>
                          {myEvents[0].status === 'live' && <span className="inline-block w-2 h-2 bg-green-500 rounded-full animate-pulse mr-1" />}
                          {myEvents[0].status.charAt(0).toUpperCase() + myEvents[0].status.slice(1)}
                        </span>
                        <span className="text-xs text-muted-foreground">• {myEvents[0].participants} guests</span>
                      </div>
                    </div>
                    <motion.button
                      onClick={() => handleManageEvent(myEvents[0])}
                      className="px-3 py-1.5 bg-primary/20 text-primary rounded-lg text-xs font-semibold"
                      whileTap={{ scale: 0.95 }}
                    >
                      Manage
                    </motion.button>
                  </div>
                </div>
              </motion.section>
            )}

            {/* Live Events */}
            <EventList 
              events={liveEventsForList}
              onJoinEvent={(event) => {
                const fullEvent = events.find(e => e.id === event.id);
                if (fullEvent) handleJoinEvent(fullEvent);
              }} 
            />
          </>
        );
    }
  };

  return (
    <div className="min-h-screen relative overflow-x-hidden">
      {/* Floating money background */}
      <FloatingMoney count={15} />

      <AnimatePresence mode="wait">
        {appState === "onboarding" && (
          <motion.div
            key="onboarding"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.4 }}
            className="relative z-10 pb-32"
          >
            {/* Logo */}
            <motion.div
              className="flex items-center justify-center pt-12 pb-4"
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              <h1 className="text-2xl font-black text-gradient-gold tracking-tight">
                DOINGS
              </h1>
            </motion.div>

            <HeroSection />
            <FeatureCards />
            <AuthFlow onComplete={handleAuthComplete} />
          </motion.div>
        )}

        {appState === "dashboard" && (
          <motion.div
            key="dashboard"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="relative z-10 pb-32"
          >
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, x: activeTab === "events" ? 20 : -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: activeTab === "events" ? -20 : 20 }}
                transition={{ duration: 0.2 }}
              >
                {renderDashboardContent()}
              </motion.div>
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom Navigation */}
      {appState === "dashboard" && (
        <BottomNav activeTab={activeTab} onTabChange={handleTabChange} />
      )}

      {/* Fund Wallet Sheet */}
      <FundWalletSheet
        isOpen={showFundSheet}
        onClose={() => setShowFundSheet(false)}
        onFundComplete={(amount, method, description) => {
          addFunds(amount, method, description);
          setShowFundSheet(false);
        }}
      />

      {/* Transaction History */}
      <AnimatePresence>
        {showHistory && (
          <TransactionHistory
            transactions={transactions}
            isOpen={showHistory}
            onClose={() => setShowHistory(false)}
          />
        )}
      </AnimatePresence>

      {/* Spray Setup Sheet */}
      <SpraySetupSheet
        isOpen={showSpraySetup}
        onClose={() => {
          setShowSpraySetup(false);
          setSelectedEvent(null);
        }}
        onStartSpray={handleStartSpray}
        balance={balance}
        eventName={selectedEvent?.title || ""}
      />

      {/* Spray Animation */}
      <AnimatePresence>
        {isSprayActive && (
          <SprayAnimation
            isActive={isSprayActive}
            amount={sprayAmount}
            denomination={sprayDenomination}
            onComplete={handleSprayComplete}
            onCancel={handleSprayCancel}
            eventName={selectedEvent?.title || "Event"}
          />
        )}
      </AnimatePresence>

      {/* Avatar Customization */}
      <AvatarCustomization
        isOpen={showAvatarCustomization}
        onClose={() => setShowAvatarCustomization(false)}
        onSave={setAvatarData}
        currentAvatar={avatarData}
      />

      {/* Create Event Sheet */}
      <CreateEventSheet
        isOpen={showCreateEvent}
        onClose={() => setShowCreateEvent(false)}
        onCreateEvent={createEvent}
      />

      {/* Event Details Sheet */}
      <EventDetailsSheet
        event={selectedEventDetails}
        isOpen={showEventDetails}
        onClose={() => {
          setShowEventDetails(false);
          setSelectedEventDetails(null);
        }}
        onGoLive={handleGoLive}
        onEndEvent={handleEndEvent}
        onDelete={deleteEvent}
      />

      {/* Join Event Sheet */}
      <JoinEventSheet
        isOpen={showJoinEvent}
        onClose={() => setShowJoinEvent(false)}
        onJoinEvent={handleJoinEvent}
        findEventByCode={findEventByCode}
        liveEvents={getLiveEvents()}
      />
    </div>
  );
};

export default Index;
