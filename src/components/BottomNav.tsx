import { motion } from "framer-motion";
import { NavLink } from "react-router-dom";
import { Home, Gift, User, Sparkles, Trophy } from "lucide-react";

const navItems = [
  { icon: Home, label: "Home", to: "/home" },
  { icon: Sparkles, label: "Events", to: "/events" },
  { icon: Trophy, label: "Gifters", to: "/leaderboard" },
  { icon: Gift, label: "Gifts", to: "/gifts" },
  { icon: User, label: "Profile", to: "/profile" },
] as const;

export const BottomNav = () => {
  return (
    <motion.nav
      className="fixed bottom-0 left-0 right-0 glass-strong border-t border-white/10 px-4 pb-6 pt-2 z-40"
      initial={{ y: 100 }}
      animate={{ y: 0 }}
      transition={{ type: "spring", stiffness: 100, damping: 20, delay: 0.8 }}
    >
      <div className="flex items-center justify-around max-w-md mx-auto">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/home"}
            className={({ isActive }) =>
              `nav-item relative flex flex-col items-center gap-1 py-1 px-2 rounded-2xl min-w-[3.5rem] ${isActive ? "active" : ""}`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <motion.div
                    layoutId="bottomNavActive"
                    className="absolute inset-0 bg-primary/10 rounded-2xl"
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  />
                )}
                <item.icon
                  className={`w-6 h-6 relative z-10 transition-colors duration-200 ${
                    isActive ? "text-primary" : "text-muted-foreground"
                  }`}
                />
                <span
                  className={`text-xs font-medium relative z-10 transition-colors duration-200 ${
                    isActive ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  {item.label}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </motion.nav>
  );
};
