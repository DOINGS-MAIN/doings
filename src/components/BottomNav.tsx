import { motion } from "framer-motion";
import { Home, Wallet, Gift, Bell, Sparkles, Trophy } from "lucide-react";
import { useState } from "react";

const navItems = [
  { icon: Home, label: "Home", id: "home" },
  { icon: Sparkles, label: "Events", id: "events" },
  { icon: Trophy, label: "Gifters", id: "leaderboard" },
  { icon: Gift, label: "Gifts", id: "gifts" },
  { icon: Bell, label: "Alerts", id: "notifications" },
];

interface BottomNavProps {
  activeTab?: string;
  onTabChange?: (tab: string) => void;
}

export const BottomNav = ({ activeTab = "home", onTabChange }: BottomNavProps) => {
  const [active, setActive] = useState(activeTab);

  const handleTabClick = (id: string) => {
    setActive(id);
    onTabChange?.(id);
  };

  return (
    <motion.nav
      className="fixed bottom-0 left-0 right-0 glass-strong border-t border-white/10 px-4 pb-6 pt-2 z-50"
      initial={{ y: 100 }}
      animate={{ y: 0 }}
      transition={{ type: "spring", stiffness: 100, damping: 20, delay: 0.8 }}
    >
      <div className="flex items-center justify-around max-w-md mx-auto">
        {navItems.map((item) => (
          <motion.button
            key={item.id}
            onClick={() => handleTabClick(item.id)}
            className={`nav-item relative ${active === item.id ? "active" : ""}`}
            whileTap={{ scale: 0.9 }}
          >
            {active === item.id && (
              <motion.div
                layoutId="activeTab"
                className="absolute inset-0 bg-primary/10 rounded-2xl"
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
              />
            )}
            <item.icon
              className={`w-6 h-6 relative z-10 transition-colors duration-200 ${
                active === item.id ? "text-primary" : "text-muted-foreground"
              }`}
            />
            <span
              className={`text-xs font-medium relative z-10 transition-colors duration-200 ${
                active === item.id ? "text-primary" : "text-muted-foreground"
              }`}
            >
              {item.label}
            </span>
          </motion.button>
        ))}
      </div>
    </motion.nav>
  );
};
