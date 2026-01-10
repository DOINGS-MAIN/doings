import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FloatingMoney } from "@/components/FloatingMoney";
import { HeroSection } from "@/components/HeroSection";
import { FeatureCards } from "@/components/FeatureCards";
import { AuthFlow } from "@/components/AuthFlow";
import { BottomNav } from "@/components/BottomNav";
import { WalletCard } from "@/components/WalletCard";
import { EventList } from "@/components/EventList";

type AppState = "onboarding" | "dashboard";

const Index = () => {
  const [appState, setAppState] = useState<AppState>("onboarding");
  const [activeTab, setActiveTab] = useState("home");

  const handleAuthComplete = () => {
    setAppState("dashboard");
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
            <WalletCard />

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
            <EventList />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom Navigation */}
      {appState === "dashboard" && (
        <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
      )}
    </div>
  );
};

export default Index;
