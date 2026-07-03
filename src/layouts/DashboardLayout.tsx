import { useState, useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { FloatingMoney } from "@/components/FloatingMoney";
import { BottomNav } from "@/components/BottomNav";
import { FundWalletSheet } from "@/components/FundWalletSheet";
import { TransactionHistory } from "@/components/TransactionHistory";
import { SpraySetupSheet } from "@/components/SpraySetupSheet";
import { SprayAnimation } from "@/components/SprayAnimation";
import { AvatarCustomization, AvatarData } from "@/components/AvatarCustomization";
import { CreateEventSheet } from "@/components/CreateEventSheet";
import { EventDetailsSheet } from "@/components/EventDetailsSheet";
import { JoinEventSheet } from "@/components/JoinEventSheet";
import { BankAccountsSheet } from "@/components/BankAccountsSheet";
import { KYCVerificationSheet } from "@/components/KYCVerificationSheet";
import { WithdrawSheet } from "@/components/WithdrawSheet";
import { SendMoneySheet } from "@/components/SendMoneySheet";
import { TransactionPinSheet } from "@/components/TransactionPinSheet";
import { CreateGiveawaySheet } from "@/components/CreateGiveawaySheet";
import { GiveawayDetailsSheet } from "@/components/GiveawayDetailsSheet";
import { RedeemGiveawaySheet } from "@/components/RedeemGiveawaySheet";
import { NotificationsScreen } from "@/components/NotificationsScreen";
import { useAuth } from "@/hooks/useAuth";
import { spray as sprayApi, isSupabaseConfigured } from "@/lib/supabase";
import { useMultiWallet } from "@/hooks/useMultiWallet";
import { useKYC } from "@/hooks/useKYC";
import { useEvents, EventData } from "@/hooks/useEvents";
import { useGiveaways, Giveaway } from "@/hooks/useGiveaways";
import { toast } from "sonner";
import { Currency } from "@/types/finance";
import { useTransactionPin } from "@/hooks/useTransactionPin";
import { DashboardShellContext, type DashboardShellValue } from "@/contexts/DashboardShellContext";

export function DashboardLayout() {
  const { user, profile, signOut, updateProfile, setUsername } = useAuth();
  const location = useLocation();

  const { hasPin, loading: pinLoading } = useTransactionPin();

  const [showTransactionPin, setShowTransactionPin] = useState(false);
  const [showFundSheet, setShowFundSheet] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [activeCurrency, setActiveCurrency] = useState<Currency>("NGN");

  const [showSpraySetup, setShowSpraySetup] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<EventData | null>(null);
  const [isSprayActive, setIsSprayActive] = useState(false);
  const [sprayAmount, setSprayAmount] = useState(0);
  const [sprayDenomination, setSprayDenomination] = useState(0);
  const [sprayPin, setSprayPin] = useState("");

  useEffect(() => {
    if (!pinLoading && hasPin === false) {
      setShowTransactionPin(true);
    }
  }, [hasPin, pinLoading]);

  const [showAvatarCustomization, setShowAvatarCustomization] = useState(false);
  const [avatarData, setAvatarData] = useState<AvatarData>({
    photoUrl: null,
    outfit: "agbada",
    accessory: "none",
    background: "gold-gradient",
  });

  const [showCreateEvent, setShowCreateEvent] = useState(false);
  const [showEventDetails, setShowEventDetails] = useState(false);
  const [selectedEventDetails, setSelectedEventDetails] = useState<EventData | null>(null);

  const [showBankAccounts, setShowBankAccounts] = useState(false);
  const [showKYC, setShowKYC] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [showSendMoney, setShowSendMoney] = useState(false);
  const [showJoinEvent, setShowJoinEvent] = useState(false);

  const [showCreateGiveaway, setShowCreateGiveaway] = useState(false);
  const [showRedeemGiveaway, setShowRedeemGiveaway] = useState(false);
  const [showGiveawayDetails, setShowGiveawayDetails] = useState(false);
  const [selectedGiveaway, setSelectedGiveaway] = useState<Giveaway | null>(null);

  const [showNotifications, setShowNotifications] = useState(false);

  const {
    ngnBalance,
    usdtBalance,
    transactions,
    monnifyAccount,
    ngnReservedAccount,
    fundingProviderId,
    blockradarAddresses,
    withdrawNGN,
    withdrawUSDT,
    createNgnAccount,
    createMonnifyAccount,
    createBlockradarAddress,
    refreshBalances,
    balanceRefreshing,
    withdrawalFeeSettings,
  } = useMultiWallet();

  const { currentLevel: kycLevel, verifyLevel1, verifyLevel2 } = useKYC();

  const {
    events,
    myEvents,
    myEventsInitialLoading,
    createEvent,
    updateEvent: persistEventPatch,
    goLive,
    endEvent,
    deleteEvent,
    findEventByCode,
    getLiveEvents,
    getMyLiveEvents,
    joinEvent,
  } = useEvents();

  const {
    createGiveaway,
    redeemGiveaway,
    stopGiveaway,
    loadGiveawayDetail,
    getMyGiveaways,
    findGiveawayByCode,
  } = useGiveaways();

  const liveEventsForList = getLiveEvents().map((event) => ({
    id: event.id,
    title: event.title,
    type: event.type.charAt(0).toUpperCase() + event.type.slice(1),
    location: event.location,
    participants: event.participants,
    timeLeft: event.status === "live" ? "Live Now" : "Scheduled",
    emoji: event.emoji,
    gradient: event.gradient,
  }));

  const handleJoinEvent = (event: EventData) => {
    if (event.status !== "live") {
      toast.info("This event hasn't started yet");
      return;
    }
    setSelectedEvent(event);
    setShowSpraySetup(true);
    joinEvent(event.id);
  };

  const openPinSettings = () => setShowTransactionPin(true);

  const handleStartSpray = (amount: number, denomination: number, pin: string) => {
    setSprayAmount(amount);
    setSprayDenomination(denomination);
    setSprayPin(pin);
    setShowSpraySetup(false);
    setIsSprayActive(true);
  };

  const recordSpray = async (sprayedAmount: number) => {
    if (!selectedEvent || sprayedAmount <= 0) return;
    await sprayApi.send(
      selectedEvent.id,
      sprayedAmount,
      sprayDenomination as 200 | 500 | 1000,
      sprayPin,
    );
  };

  const handleSprayComplete = async (sprayedAmount: number) => {
    try {
      await recordSpray(sprayedAmount);
      toast.success(`Successfully sprayed ₦${sprayedAmount.toLocaleString()}! 🎉`);
    } catch (err) {
      const code = (err as Error & { code?: string }).code;
      if (code === "PIN_NOT_SET") openPinSettings();
      toast.error(err instanceof Error ? err.message : "Failed to complete spray");
    }
    setIsSprayActive(false);
    setSelectedEvent(null);
    setSprayPin("");
  };

  const handleSprayCancel = async (sprayedAmount: number) => {
    if (sprayedAmount > 0) {
      try {
        await recordSpray(sprayedAmount);
        toast.info(`Spray stopped. ₦${sprayedAmount.toLocaleString()} was sprayed.`);
      } catch (err) {
        const code = (err as Error & { code?: string }).code;
        if (code === "PIN_NOT_SET") openPinSettings();
        toast.error(err instanceof Error ? err.message : "Failed to record spray");
      }
    } else {
      toast.info("Spray cancelled");
    }
    setIsSprayActive(false);
    setSelectedEvent(null);
    setSprayPin("");
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

  const handleUpdateEvent = async (eventId: string, body: Record<string, unknown>) => {
    const updated = await persistEventPatch(eventId, body);
    if (updated) setSelectedEventDetails(updated);
    return updated;
  };

  const handleCreateGiveaway = async (data: Parameters<typeof createGiveaway>[0]) => {
    const giveaway = await createGiveaway(data);
    toast.success("Giveaway created! 🎁");
    return { code: giveaway.code, id: giveaway.id };
  };

  const handleRedeemGiveaway = async (code: string) => {
    return redeemGiveaway(code);
  };

  const handleStopGiveaway = async (giveawayId: string, pin: string) => {
    const refund = await stopGiveaway(giveawayId, pin);
    if (refund > 0) {
      toast.success(`₦${refund.toLocaleString()} refunded to your wallet`);
    } else {
      toast.info("Giveaway stopped");
    }
  };

  const handleViewGiveaway = async (giveaway: Giveaway) => {
    const id = giveaway.id;
    setSelectedGiveaway(giveaway);
    setShowGiveawayDetails(true);
    try {
      const enriched = await loadGiveawayDetail(giveaway);
      setSelectedGiveaway((cur) => (cur?.id === id ? enriched : cur));
    } catch {
      /* list snapshot is enough */
    }
  };

  const handleFundNGN = (_amount: number, _description: string) => {
    toast.info("Transfer to your reserved account. Balance updates automatically.");
    setShowFundSheet(false);
  };

  const handleFundUSDT = (_amount: number, _provider: "blockradar", _description: string) => {
    toast.info("Send USDT to your deposit address. Balance updates automatically.");
    setShowFundSheet(false);
  };

  const handleCreateNgnAccount = async (bvn?: string) => createNgnAccount(bvn);
  const handleCreateMonnifyAccount = async (bvn: string) => createNgnAccount(bvn);

  const shellValue: DashboardShellValue = {
    user,
    profile,
    avatarData,
    setAvatarData,
    kycLevel,
    ngnBalance,
    usdtBalance,
    balanceRefreshing,
    refreshBalances,
    activeCurrency,
    setActiveCurrency,
    transactions,
    monnifyAccount,
    ngnReservedAccount,
    fundingProviderId,
    blockradarAddresses,
    createNgnAccount,
    createMonnifyAccount,
    createBlockradarAddress,
    withdrawNGN,
    withdrawUSDT,
    verifyLevel1,
    verifyLevel2,
    events,
    myEvents,
    myEventsInitialLoading,
    createEvent,
    updateEvent: handleUpdateEvent,
    goLive,
    endEvent,
    deleteEvent,
    findEventByCode,
    getLiveEvents,
    joinEvent,
    createGiveaway,
    redeemGiveaway,
    stopGiveaway,
    getMyGiveaways,
    findGiveawayByCode,
    liveEventsForList,
    setShowFundSheet,
    setShowHistory,
    setShowJoinEvent,
    setShowCreateEvent,
    setShowKYC,
    setShowWithdraw,
    setShowSendMoney,
    setShowCreateGiveaway,
    setShowRedeemGiveaway,
    setShowAvatarCustomization,
    setShowBankAccounts,
    setShowTransactionPin,
    setShowNotifications,
    handleJoinEvent,
    handleManageEvent,
    handleGoLive,
    handleEndEvent,
    handleViewGiveaway,
    signOut,
    updateProfile,
    setUsername,
  };

  return (
    <DashboardShellContext.Provider value={shellValue}>
      <div className="min-h-dvh relative overflow-x-hidden">
        {!isSupabaseConfigured && (
          <div className="relative z-[100] bg-destructive/20 text-destructive text-sm text-center px-4 py-3 border-b border-destructive/30">
            This build has no Supabase URL/key. In Railway, set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY as
            variables and trigger a new deploy so they are present during the build step (Vite reads them at build
            time, not only at runtime).
          </div>
        )}
        <FloatingMoney count={15} />

        <motion.div
          key={location.pathname}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
          className="relative z-10 pb-32"
        >
          <Outlet />
        </motion.div>

        <BottomNav />

        <FundWalletSheet
          isOpen={showFundSheet}
          onClose={() => setShowFundSheet(false)}
          onFundNGN={handleFundNGN}
          onFundUSDT={handleFundUSDT}
          activeCurrency={activeCurrency}
          kycLevel={kycLevel}
          onOpenKYC={() => {
            setShowFundSheet(false);
            setShowKYC(true);
          }}
          fundingProviderId={fundingProviderId}
          ngnReservedAccount={ngnReservedAccount}
          monnifyAccount={monnifyAccount}
          onCreateNgnAccount={handleCreateNgnAccount}
          onCreateMonnifyAccount={handleCreateMonnifyAccount}
          blockradarAddresses={blockradarAddresses}
          onCreateBlockradarAddress={createBlockradarAddress}
        />

        <AnimatePresence>
          {showHistory && (
            <TransactionHistory
              transactions={transactions}
              isOpen={showHistory}
              onClose={() => setShowHistory(false)}
            />
          )}
        </AnimatePresence>

        <SpraySetupSheet
          isOpen={showSpraySetup}
          onClose={() => {
            setShowSpraySetup(false);
            setSelectedEvent(null);
          }}
          onStartSpray={handleStartSpray}
          balance={ngnBalance}
          eventName={selectedEvent?.title || ""}
          onPinNotSet={openPinSettings}
        />

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

        <AvatarCustomization
          isOpen={showAvatarCustomization}
          onClose={() => setShowAvatarCustomization(false)}
          onSave={setAvatarData}
          currentAvatar={avatarData}
        />

        <CreateEventSheet
          isOpen={showCreateEvent}
          onClose={() => setShowCreateEvent(false)}
          onCreateEvent={createEvent}
        />

        <EventDetailsSheet
          event={selectedEventDetails}
          isOpen={showEventDetails}
          onClose={() => {
            setShowEventDetails(false);
            setSelectedEventDetails(null);
          }}
          onUpdateEvent={handleUpdateEvent}
          onGoLive={handleGoLive}
          onEndEvent={handleEndEvent}
          onDelete={deleteEvent}
        />

        <JoinEventSheet
          isOpen={showJoinEvent}
          onClose={() => setShowJoinEvent(false)}
          onJoinEvent={handleJoinEvent}
          findEventByCode={findEventByCode}
          liveEvents={getLiveEvents()}
        />

        <BankAccountsSheet open={showBankAccounts} onOpenChange={setShowBankAccounts} />

        <KYCVerificationSheet
          open={showKYC}
          onOpenChange={setShowKYC}
          currentLevel={kycLevel}
          onVerifyLevel1={verifyLevel1}
          onVerifyLevel2={verifyLevel2}
        />

        <WithdrawSheet
          open={showWithdraw}
          onOpenChange={setShowWithdraw}
          onOpenBankAccounts={() => setShowBankAccounts(true)}
          onOpenKYC={() => setShowKYC(true)}
          activeCurrency={activeCurrency}
          kycLevel={kycLevel}
          ngnBalance={ngnBalance}
          usdtBalance={usdtBalance}
          ngnWithdrawalFees={withdrawalFeeSettings}
          onWithdrawNGN={(amount, bankCode, accountNumber, accountName, pin) =>
            withdrawNGN(amount, bankCode, accountNumber, accountName, pin)
          }
          onWithdrawUSDT={(amount, toAddress, network, provider, fee, pin) => {
            void withdrawUSDT(amount, toAddress, network, provider, fee, pin);
          }}
          onPinNotSet={openPinSettings}
        />

        <SendMoneySheet open={showSendMoney} onOpenChange={setShowSendMoney} onPinNotSet={openPinSettings} />

        <CreateGiveawaySheet
          isOpen={showCreateGiveaway}
          onClose={() => setShowCreateGiveaway(false)}
          onCreateGiveaway={handleCreateGiveaway}
          balance={ngnBalance}
          liveEvents={getMyLiveEvents()}
          onPinNotSet={openPinSettings}
        />

        <GiveawayDetailsSheet
          giveaway={selectedGiveaway}
          isOpen={showGiveawayDetails}
          onClose={() => {
            setShowGiveawayDetails(false);
            setSelectedGiveaway(null);
          }}
          onStop={handleStopGiveaway}
          onPinNotSet={openPinSettings}
        />

        <TransactionPinSheet open={showTransactionPin} onOpenChange={setShowTransactionPin} />

        <RedeemGiveawaySheet
          isOpen={showRedeemGiveaway}
          onClose={() => setShowRedeemGiveaway(false)}
          onRedeem={handleRedeemGiveaway}
          findGiveawayByCode={findGiveawayByCode}
        />

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
                  type="button"
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
    </DashboardShellContext.Provider>
  );
}
