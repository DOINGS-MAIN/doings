import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FloatingMoney } from "@/components/FloatingMoney";
import { HeroSection } from "@/components/HeroSection";
import { FeatureCards } from "@/components/FeatureCards";
import { AuthFlow } from "@/components/AuthFlow";
import { BottomNav } from "@/components/BottomNav";
import { WalletCard } from "@/components/WalletCard";
import { EventList, Event, liveEvents } from "@/components/EventList";
import { FundWalletSheet } from "@/components/FundWalletSheet";
import { TransactionHistory } from "@/components/TransactionHistory";
import { SpraySetupSheet } from "@/components/SpraySetupSheet";
import { SprayAnimation } from "@/components/SprayAnimation";
import { useWallet } from "@/hooks/useWallet";
import { toast } from "sonner";

type AppState = "onboarding" | "dashboard";

const Index = () => {
  const [appState, setAppState] = useState<AppState>("onboarding");
  const [activeTab, setActiveTab] = useState("home");
  const [showFundSheet, setShowFundSheet] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  
  // Spray state
  const [showSpraySetup, setShowSpraySetup] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [isSprayActive, setIsSprayActive] = useState(false);
  const [sprayAmount, setSprayAmount] = useState(0);
  const [sprayDenomination, setSprayDenomination] = useState(0);
  
  const { balance, transactions, addFunds, deductFunds } = useWallet();

  const handleAuthComplete = () => {
    setAppState("dashboard");
  };

  const handleJoinEvent = (event: Event) => {
    if (event.timeLeft !== "Live Now") {
      toast.info("This event hasn't started yet");
      return;
    }
    setSelectedEvent(event);
    setShowSpraySetup(true);
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
              <motion.div
                className="w-12 h-12 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-xl font-bold text-primary-foreground"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                C
              </motion.div>
            </motion.header>

            {/* Wallet */}
            <WalletCard 
              balance={balance}
              onAddFunds={() => setShowFundSheet(true)}
              onViewHistory={() => setShowHistory(true)}
            />

            {/* Quick Actions */}
            <motion.div
              className="px-6 mb-6"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
            >
              <div className="glass rounded-2xl p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-primary/20 flex items-center justify-center text-2xl">
                    🎯
                  </div>
                  <div>
                    <h3 className="font-bold text-foreground">Start Spraying!</h3>
                    <p className="text-sm text-muted-foreground">Join a live event</p>
                  </div>
                </div>
                <motion.button
                  className="bg-primary text-primary-foreground px-4 py-2 rounded-xl font-bold text-sm"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  Go Live
                </motion.button>
              </div>
            </motion.div>

            {/* Events */}
            <EventList onJoinEvent={handleJoinEvent} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom Navigation */}
      {appState === "dashboard" && (
        <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
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
    </div>
  );
};

export default Index;
