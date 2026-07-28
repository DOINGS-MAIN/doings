import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { WalletCard } from "@/components/WalletCard";
import { EventList } from "@/components/EventList";
import { useDashboardShell } from "@/contexts/DashboardShellContext";
import { Plus, ChevronRight, Bell } from "lucide-react";

export default function HomePage() {
  const navigate = useNavigate();
  const d = useDashboardShell();

  return (
    <>
      <motion.header
        className="flex items-center justify-between px-6 pt-12 pb-6"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <div>
          <p className="text-muted-foreground text-sm">Welcome back,</p>
          <h1 className="text-2xl font-bold text-foreground">
            {d.profile?.full_name?.split(" ")[0] || "Champ"} 👋
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <motion.button
            type="button"
            onClick={() => d.setShowNotifications(true)}
            className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            title="Notifications"
          >
            <Bell className="w-4 h-4 text-muted-foreground" />
          </motion.button>
          <motion.button
            type="button"
            onClick={() => navigate("/profile")}
            className="w-12 h-12 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-xl font-bold text-primary-foreground overflow-hidden"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            {d.avatarData.photoUrl ? (
              <img src={d.avatarData.photoUrl} alt="Avatar" className="w-full h-full object-cover" />
            ) : (
              (d.profile?.full_name?.[0] || "U").toUpperCase()
            )}
          </motion.button>
        </div>
      </motion.header>

      {d.kycLoading ? null : d.kycLevel < 2 && (
        <motion.div
          className="mx-6 mb-4 p-3 rounded-2xl bg-primary/10 border border-primary/20 flex items-center gap-3 cursor-pointer"
          onClick={() => d.setShowKYC(true)}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          whileTap={{ scale: 0.98 }}
        >
          <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center text-lg">🛡️</div>
          <div className="flex-1">
            <p className="text-sm font-bold text-foreground">
              {d.kycLevel === 0 && "Verify your email, then add BVN + NIN to unlock everything"}
              {d.kycLevel === 1 && "Complete BVN + NIN verification to fund, send, and withdraw"}
            </p>
            <p className="text-xs text-muted-foreground">Level {d.kycLevel}/2 • Tap to continue</p>
          </div>
          <ChevronRight className="w-5 h-5 text-primary" />
        </motion.div>
      )}

      <WalletCard
        ngnBalance={d.ngnBalance}
        ngnAvailableBalance={d.ngnAvailableBalance}
        ngnLockedBalance={d.ngnLockedBalance}
        usdcBalance={d.usdcBalance}
        onAddFunds={() => d.setShowFundSheet(true)}
        onViewHistory={() => d.setShowHistory(true)}
        onSend={() => d.setShowSendMoney(true)}
        onConvert={() => d.setShowConvert(true)}
        onWithdraw={() => d.setShowWithdraw(true)}
        activeCurrency={d.activeCurrency}
        onCurrencyChange={d.setActiveCurrency}
        onRefreshBalance={() => void d.refreshBalances()}
        balanceRefreshing={d.balanceRefreshing}
        loading={d.walletLoading}
      />

      <motion.div
        className="px-6 mb-6 grid grid-cols-2 gap-3"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
      >
        <motion.button
          type="button"
          onClick={() => d.setShowJoinEvent(true)}
          className="glass rounded-2xl p-4 flex flex-col items-center gap-2"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <div className="w-12 h-12 rounded-2xl bg-primary/20 flex items-center justify-center text-2xl">🎯</div>
          <div className="text-center">
            <h3 className="font-bold text-foreground text-sm">Join Event</h3>
            <p className="text-xs text-muted-foreground">Spray money</p>
          </div>
        </motion.button>

        <motion.button
          type="button"
          onClick={() => d.setShowCreateEvent(true)}
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

      {d.myEvents.length > 0 && (
        <motion.section
          className="px-6 mb-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45 }}
        >
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold text-foreground">My Events</h2>
            <button
              type="button"
              onClick={() => navigate("/events")}
              className="text-primary text-sm font-medium flex items-center gap-1 hover:gap-2 transition-all"
            >
              See all
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <div className="glass rounded-2xl p-4">
            <div className="flex items-center gap-3">
              <div
                className={`w-12 h-12 rounded-xl bg-gradient-to-br ${d.myEvents[0].gradient} flex items-center justify-center text-xl`}
              >
                {d.myEvents[0].emoji}
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-foreground text-sm">{d.myEvents[0].title}</h3>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs ${d.myEvents[0].status === "live" ? "text-green-400" : "text-muted-foreground"}`}
                  >
                    {d.myEvents[0].status === "live" && (
                      <span className="inline-block w-2 h-2 bg-green-500 rounded-full animate-pulse mr-1" />
                    )}
                    {d.myEvents[0].status.charAt(0).toUpperCase() + d.myEvents[0].status.slice(1)}
                  </span>
                  <span className="text-xs text-muted-foreground">• {d.myEvents[0].participants} guests</span>
                </div>
              </div>
              <motion.button
                type="button"
                onClick={() => d.handleManageEvent(d.myEvents[0])}
                className="px-3 py-1.5 bg-primary/20 text-primary rounded-lg text-xs font-semibold"
                whileTap={{ scale: 0.95 }}
              >
                Manage
              </motion.button>
            </div>
          </div>
        </motion.section>
      )}

      <EventList
        events={d.liveEventsForList}
        onJoinEvent={(event) => {
          const fullEvent = d.events.find((e) => e.id === event.id);
          if (fullEvent) d.handleJoinEvent(fullEvent);
        }}
      />
    </>
  );
}
