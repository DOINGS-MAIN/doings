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
import { BankAccountsSheet } from "@/components/BankAccountsSheet";
import { KYCVerificationSheet } from "@/components/KYCVerificationSheet";
import { WithdrawSheet } from "@/components/WithdrawSheet";
import { SendMoneySheet } from "@/components/SendMoneySheet";
import { GiftsScreen } from "@/components/GiftsScreen";
import { LeaderboardScreen } from "@/components/LeaderboardScreen";
import { CreateGiveawaySheet } from "@/components/CreateGiveawaySheet";
import { GiveawayDetailsSheet } from "@/components/GiveawayDetailsSheet";
import { RedeemGiveawaySheet } from "@/components/RedeemGiveawaySheet";
import { EventScreenDisplay } from "@/components/EventScreenDisplay";
import { NotificationsScreen } from "@/components/NotificationsScreen";
import { ProfileScreen } from "@/components/ProfileScreen";
import { useAuth } from "@/hooks/useAuth";
import { spray as sprayApi, isSupabaseConfigured } from "@/lib/supabase";
import { useMultiWallet } from "@/hooks/useMultiWallet";
import { useKYC } from "@/hooks/useKYC";
import { useEvents, EventData } from "@/hooks/useEvents";
import { useGiveaways, Giveaway } from "@/hooks/useGiveaways";
import { toast } from "sonner";
import { Plus, ChevronRight, Loader2, Bell } from "lucide-react";
import { Currency } from "@/types/finance";

const Index = () => {
  const { isAuthenticated, loading: authLoading, initialized, profile, sendOtp, verifyOtp, signOut, updateProfile } = useAuth();
  const [activeTab, setActiveTab] = useState("home");
  const [showFundSheet, setShowFundSheet] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [activeCurrency, setActiveCurrency] = useState<Currency>("NGN");
  
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
  
  // Banking & Withdrawal state
  const [showBankAccounts, setShowBankAccounts] = useState(false);
  const [showKYC, setShowKYC] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [showSendMoney, setShowSendMoney] = useState(false);
  const [showJoinEvent, setShowJoinEvent] = useState(false);
  
  // Giveaway state
  const [showCreateGiveaway, setShowCreateGiveaway] = useState(false);
  const [showRedeemGiveaway, setShowRedeemGiveaway] = useState(false);
  const [showGiveawayDetails, setShowGiveawayDetails] = useState(false);
  const [selectedGiveaway, setSelectedGiveaway] = useState<Giveaway | null>(null);
  
  // Event Screen Display state
  const [showEventScreen, setShowEventScreen] = useState(false);
  const [eventScreenEvent, setEventScreenEvent] = useState<EventData | null>(null);
  const [showNotifications, setShowNotifications] = useState(false);

  // Finance hooks
  const {
    ngnBalance,
    usdtBalance,
    transactions,
    monnifyAccount,
    blockradarAddresses,
    creditWallet,
    debitWallet,
    withdrawNGN,
    withdrawUSDT,
    createMonnifyAccount,
    createBlockradarAddress,
    getTransactions,
  } = useMultiWallet();

  const {
    currentLevel: kycLevel,
    verifyLevel1,
    verifyLevel2,
    verifyLevel3,
  } = useKYC();

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
  
  const {
    createGiveaway,
    redeemGiveaway,
    stopGiveaway,
    getMyGiveaways,
    findGiveawayByCode,
  } = useGiveaways();

  const appState = isAuthenticated ? "dashboard" : "onboarding";

  const handleAuthComplete = () => {
    // Auth state change is handled by useAuth — nothing to do here
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

  const handleSprayComplete = async (sprayedAmount: number) => {
    try {
      if (selectedEvent) {
        await sprayApi.send(selectedEvent.id, Math.round(sprayedAmount * 100), sprayDenomination as 200 | 500 | 1000);
      }
      toast.success(`Successfully sprayed ₦${sprayedAmount.toLocaleString()}! 🎉`);
    } catch {
      toast.error("Failed to complete spray");
    }
    setIsSprayActive(false);
    setSelectedEvent(null);
  };

  const handleSprayCancel = async (sprayedAmount: number) => {
    if (sprayedAmount > 0) {
      try {
        if (selectedEvent) {
          await sprayApi.send(selectedEvent.id, Math.round(sprayedAmount * 100), sprayDenomination as 200 | 500 | 1000);
        }
        toast.info(`Spray stopped. ₦${sprayedAmount.toLocaleString()} was sprayed.`);
      } catch {
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

  // Giveaway handlers
  const handleCreateGiveaway = async (data: Parameters<typeof createGiveaway>[0]) => {
    const giveaway = await createGiveaway(data);
    toast.success("Giveaway created! 🎁");
    return { code: giveaway.code, id: giveaway.id };
  };

  const handleRedeemGiveaway = async (code: string) => {
    const result = await redeemGiveaway(code);
    return result;
  };

  const handleStopGiveaway = async (giveawayId: string) => {
    const refund = await stopGiveaway(giveawayId);
    if (refund > 0) {
      toast.success(`₦${refund.toLocaleString()} refunded to your wallet`);
    } else {
      toast.info("Giveaway stopped");
    }
  };

  const handleViewGiveaway = (giveaway: Giveaway) => {
    setSelectedGiveaway(giveaway);
    setShowGiveawayDetails(true);
  };

  // Fund wallet handlers — deposits are confirmed via webhooks, not client-side
  const handleFundNGN = (_amount: number, _method: "bank" | "card", _description: string) => {
    toast.info("Transfer to your reserved account. Balance updates automatically.");
    setShowFundSheet(false);
  };

  const handleFundUSDT = (_amount: number, _provider: "blockradar", _description: string) => {
    toast.info("Send USDT to your deposit address. Balance updates automatically.");
    setShowFundSheet(false);
  };

  const handleCreateMonnifyAccount = async () => {
    return createMonnifyAccount();
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
      
      case "gifts":
        return (
          <GiftsScreen
            myGiveaways={getMyGiveaways()}
            onCreateGiveaway={() => setShowCreateGiveaway(true)}
            onRedeemGiveaway={() => setShowRedeemGiveaway(true)}
            onViewGiveaway={handleViewGiveaway}
          />
        );
      
      case "leaderboard":
        return <LeaderboardScreen />;

      case "profile":
        return (
          <ProfileScreen
            avatarData={avatarData}
            kycLevel={kycLevel}
            ngnBalance={ngnBalance}
            usdtBalance={usdtBalance}
            userName={profile?.full_name || ""}
            userPhone={profile?.phone || ""}
            userId={profile?.id || ""}
            onOpenAvatar={() => setShowAvatarCustomization(true)}
            onOpenKYC={() => setShowKYC(true)}
            onOpenBankAccounts={() => setShowBankAccounts(true)}
            onOpenNotifications={() => setShowNotifications(true)}
            onLogout={async () => {
              await signOut();
              toast.success("Logged out successfully");
            }}
            onUpdateName={async (name) => {
              await updateProfile({ full_name: name });
            }}
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
                <h1 className="text-2xl font-bold text-foreground">{profile?.full_name?.split(" ")[0] || "Champ"} 👋</h1>
              </div>
              <div className="flex items-center gap-2">
                <motion.button
                  onClick={() => setShowNotifications(true)}
                  className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  title="Notifications"
                >
                  <Bell className="w-4 h-4 text-muted-foreground" />
                </motion.button>
                <motion.button
                  onClick={() => setActiveTab("profile")}
                  className="w-12 h-12 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-xl font-bold text-primary-foreground overflow-hidden"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  {avatarData.photoUrl ? (
                    <img src={avatarData.photoUrl} alt="Avatar" className="w-full h-full object-cover" />
                  ) : (
                    (profile?.full_name?.[0] || "U").toUpperCase()
                  )}
                </motion.button>
              </div>
            </motion.header>

            {/* KYC Banner */}
            {kycLevel < 3 && (
              <motion.div
                className="mx-6 mb-4 p-3 rounded-2xl bg-primary/10 border border-primary/20 flex items-center gap-3 cursor-pointer"
                onClick={() => setShowKYC(true)}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                whileTap={{ scale: 0.98 }}
              >
                <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center text-lg">
                  🛡️
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-foreground">
                    {kycLevel === 0 && "Complete verification to get started"}
                    {kycLevel === 1 && "Verify BVN to unlock funding"}
                    {kycLevel === 2 && "Complete full KYC to enable withdrawals"}
                  </p>
                  <p className="text-xs text-muted-foreground">Level {kycLevel}/3 • Tap to continue</p>
                </div>
                <ChevronRight className="w-5 h-5 text-primary" />
              </motion.div>
            )}

            {/* Wallet */}
            <WalletCard 
              ngnBalance={ngnBalance}
              usdtBalance={usdtBalance}
              onAddFunds={() => setShowFundSheet(true)}
              onViewHistory={() => setShowHistory(true)}
              onSend={() => setShowSendMoney(true)}
              onWithdraw={() => setShowWithdraw(true)}
              activeCurrency={activeCurrency}
              onCurrencyChange={setActiveCurrency}
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

  if (!initialized || authLoading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-dvh relative overflow-x-hidden">
      {!isSupabaseConfigured && (
        <div className="relative z-[100] bg-destructive/20 text-destructive text-sm text-center px-4 py-3 border-b border-destructive/30">
          This build has no Supabase URL/key. In Railway, set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY as variables and trigger a new deploy so they are present during the build step (Vite reads them at build time, not only at runtime).
        </div>
      )}
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
            <AuthFlow onComplete={handleAuthComplete} sendOtp={sendOtp} verifyOtp={verifyOtp} updateProfile={updateProfile} existingName={profile?.full_name} />
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
            {/* No AnimatePresence here: mode="wait" + exit slides collapse layout on mobile and snap scroll. */}
            <motion.div
              key={activeTab}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 }}
            >
              {renderDashboardContent()}
            </motion.div>
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
        onFundNGN={handleFundNGN}
        onFundUSDT={handleFundUSDT}
        activeCurrency={activeCurrency}
        kycLevel={kycLevel}
        onOpenKYC={() => { setShowFundSheet(false); setShowKYC(true); }}
        monnifyAccount={monnifyAccount}
        onCreateMonnifyAccount={handleCreateMonnifyAccount}
        blockradarAddresses={blockradarAddresses}
        onCreateBlockradarAddress={createBlockradarAddress}
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
        balance={ngnBalance}
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
        onOpenEventScreen={(event) => {
          setEventScreenEvent(event);
          setShowEventScreen(true);
        }}
      />

      {/* Join Event Sheet */}
      <JoinEventSheet
        isOpen={showJoinEvent}
        onClose={() => setShowJoinEvent(false)}
        onJoinEvent={handleJoinEvent}
        findEventByCode={findEventByCode}
        liveEvents={getLiveEvents()}
      />

      {/* Bank Accounts Sheet */}
      <BankAccountsSheet
        open={showBankAccounts}
        onOpenChange={setShowBankAccounts}
      />

      {/* KYC Verification Sheet */}
      <KYCVerificationSheet
        open={showKYC}
        onOpenChange={setShowKYC}
        currentLevel={kycLevel}
        onVerifyLevel1={verifyLevel1}
        onVerifyLevel2={verifyLevel2}
        onVerifyLevel3={verifyLevel3}
      />

      {/* Withdraw Sheet */}
      <WithdrawSheet
        open={showWithdraw}
        onOpenChange={setShowWithdraw}
        onOpenBankAccounts={() => setShowBankAccounts(true)}
        onOpenKYC={() => setShowKYC(true)}
        activeCurrency={activeCurrency}
        kycLevel={kycLevel}
        ngnBalance={ngnBalance}
        usdtBalance={usdtBalance}
        onWithdrawNGN={(amount, bankName, accountNumber, fee) => {
          withdrawNGN(amount, bankName, accountNumber, fee);
        }}
        onWithdrawUSDT={(amount, toAddress, network, provider, fee) => {
          withdrawUSDT(amount, toAddress, network, provider, fee);
        }}
      />

      {/* Send Money Sheet */}
      <SendMoneySheet
        open={showSendMoney}
        onOpenChange={setShowSendMoney}
      />

      {/* Create Giveaway Sheet */}
      <CreateGiveawaySheet
        isOpen={showCreateGiveaway}
        onClose={() => setShowCreateGiveaway(false)}
        onCreateGiveaway={handleCreateGiveaway}
        balance={ngnBalance}
        liveEvents={getLiveEvents()}
      />

      {/* Giveaway Details Sheet */}
      <GiveawayDetailsSheet
        giveaway={selectedGiveaway}
        isOpen={showGiveawayDetails}
        onClose={() => {
          setShowGiveawayDetails(false);
          setSelectedGiveaway(null);
        }}
        onStop={handleStopGiveaway}
      />

      {/* Redeem Giveaway Sheet */}
      <RedeemGiveawaySheet
        isOpen={showRedeemGiveaway}
        onClose={() => setShowRedeemGiveaway(false)}
        onRedeem={handleRedeemGiveaway}
        findGiveawayByCode={findGiveawayByCode}
      />

      {/* Event Screen Display */}
      <EventScreenDisplay
        event={eventScreenEvent}
        isOpen={showEventScreen}
        onClose={() => {
          setShowEventScreen(false);
          setEventScreenEvent(null);
        }}
        giveaways={getMyGiveaways()}
      />

      {/* Notifications Overlay */}
      <AnimatePresence>
        {showNotifications && (
          <motion.div
            className="fixed inset-0 z-[60] flex flex-col overflow-hidden bg-background"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="flex shrink-0 items-center justify-between px-6 pb-4 pt-12">
              <h1 className="text-2xl font-bold text-foreground">Notifications</h1>
              <motion.button
                onClick={() => setShowNotifications(false)}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-sm font-medium text-muted-foreground"
                whileTap={{ scale: 0.95 }}
              >
                ✕
              </motion.button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-6 pb-28 [-webkit-overflow-scrolling:touch]">
              <NotificationsScreen embedded />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Index;
