import { useState, useEffect, useRef } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { FloatingMoney } from "@/components/FloatingMoney";
import { BottomNav } from "@/components/BottomNav";
import { FundWalletSheet } from "@/components/FundWalletSheet";
import { TransactionHistory } from "@/components/TransactionHistory";
import { SpraySetupSheet } from "@/components/SpraySetupSheet";
import { SprayAnimation } from "@/components/SprayAnimation";
import { AvatarCustomization } from "@/components/AvatarCustomization";
import { useAvatar } from "@/hooks/useAvatar";
import { CreateEventSheet } from "@/components/CreateEventSheet";
import { EventDetailsSheet } from "@/components/EventDetailsSheet";
import { JoinEventSheet } from "@/components/JoinEventSheet";
import { BankAccountsSheet } from "@/components/BankAccountsSheet";
import { KYCVerificationSheet } from "@/components/KYCVerificationSheet";
import { WithdrawSheet } from "@/components/WithdrawSheet";
import { SendMoneySheet } from "@/components/SendMoneySheet";
import { ConvertSheet } from "@/components/ConvertSheet";
import { TransactionPinSheet } from "@/components/TransactionPinSheet";
import { CreateGiveawaySheet } from "@/components/CreateGiveawaySheet";
import { GiveawayDetailsSheet } from "@/components/GiveawayDetailsSheet";
import { RedeemGiveawaySheet } from "@/components/RedeemGiveawaySheet";
import { NotificationsScreen } from "@/components/NotificationsScreen";
import { useAuth } from "@/hooks/useAuth";
import { spray as sprayApi, isSupabaseConfigured } from "@/lib/supabase";
import type { SprayTheatrePlan } from "@/lib/sprayTheatrePlan";
import { useMultiWallet } from "@/hooks/useMultiWallet";
import { useKYC } from "@/hooks/useKYC";
import { useEvents, EventData } from "@/hooks/useEvents";
import { useGiveaways, Giveaway } from "@/hooks/useGiveaways";
import { toast } from "sonner";
import { Currency } from "@/types/finance";
import { useTransactionPin } from "@/hooks/useTransactionPin";
import { DashboardShellContext, type DashboardShellValue } from "@/contexts/DashboardShellContext";

export function DashboardLayout() {
  const { user, profile, signOut, updateProfile, setUsername, refreshProfile } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

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
  const [sprayTheatrePlan, setSprayTheatrePlan] = useState<SprayTheatrePlan | null>(null);
  const [sprayHoldId, setSprayHoldId] = useState<string | null>(null);
  const sprayHoldIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isSprayActive) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isSprayActive]);

  useEffect(() => {
    if (!pinLoading && hasPin === false) {
      setShowTransactionPin(true);
    }
  }, [hasPin, pinLoading]);


  const [showAvatarCustomization, setShowAvatarCustomization] = useState(false);
  const { avatarData, saveAvatarData, saving: savingAvatar } = useAvatar(
    user?.id,
    profile?.avatar_data,
    profile?.avatar_url,
    refreshProfile,
  );

  const [showCreateEvent, setShowCreateEvent] = useState(false);
  const [showEventDetails, setShowEventDetails] = useState(false);
  const [selectedEventDetails, setSelectedEventDetails] = useState<EventData | null>(null);

  const [showBankAccounts, setShowBankAccounts] = useState(false);
  const [showKYC, setShowKYC] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [showSendMoney, setShowSendMoney] = useState(false);
  const [showConvert, setShowConvert] = useState(false);
  const [showJoinEvent, setShowJoinEvent] = useState(false);
  const [joinEventInitialCode, setJoinEventInitialCode] = useState<string | undefined>();
  const [redeemGiveawayInitialCode, setRedeemGiveawayInitialCode] = useState<string | undefined>();

  const [showCreateGiveaway, setShowCreateGiveaway] = useState(false);
  const [showRedeemGiveaway, setShowRedeemGiveaway] = useState(false);
  const [showGiveawayDetails, setShowGiveawayDetails] = useState(false);
  const [selectedGiveaway, setSelectedGiveaway] = useState<Giveaway | null>(null);

  const [showNotifications, setShowNotifications] = useState(false);
  const processedJoinCodeRef = useRef<string | null>(null);

  const {
    ngnBalance,
    ngnAvailableBalance,
    usdcBalance,
    transactions,
    monnifyAccount,
    ngnReservedAccount,
    fundingProviderId,
    blockradarAddresses,
    withdrawNGN,
    withdrawUSDC,
    createNgnAccount,
    createMonnifyAccount,
    createBlockradarAddress,
    refreshBalances,
    balanceRefreshing,
    walletLoading,
    withdrawalFeeSettings,
  } = useMultiWallet();

  const { currentLevel: kycLevel, kycLoading, verifyLevel1, verifyLevel2 } = useKYC();

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

  const openPinSettings = () => setShowTransactionPin(true);

  const handleJoinEvent = async (event: EventData) => {
    if (event.status !== "live") {
      toast.info("This event hasn't started yet");
      return;
    }
    if (profile?.id && event.hostId === profile.id) {
      toast.info("You're hosting this event — share the code for guests to spray you");
      setSelectedEventDetails(event);
      setShowEventDetails(true);
      return;
    }
    try {
      await joinEvent(event.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not join event");
      return;
    }
    setSelectedEvent(event);
    setShowSpraySetup(true);
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const join = params.get("join")?.trim().toUpperCase();
    const redeem = params.get("redeem")?.trim().toUpperCase();

    if (redeem) {
      params.delete("redeem");
      navigate(
        { pathname: location.pathname, search: params.toString() ? `?${params.toString()}` : "" },
        { replace: true },
      );
      setRedeemGiveawayInitialCode(redeem);
      setShowRedeemGiveaway(true);
      return;
    }

    if (!join) return;
    if (!profile?.id) return;

    if (processedJoinCodeRef.current === join) return;
    processedJoinCodeRef.current = join;

    params.delete("join");
    navigate(
      { pathname: "/events", search: params.toString() ? `?${params.toString()}` : "" },
      { replace: true },
    );

    void (async () => {
      const event = await findEventByCode(join);
      if (!event) {
        toast.error("Event not found. Check the code and try again.");
        setJoinEventInitialCode(join);
        setShowJoinEvent(true);
        return;
      }
      await handleJoinEvent(event);
    })();
    // handleJoinEvent is stable enough for one-shot deep links; omit to avoid re-firing.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- join query consumed once via processedJoinCodeRef
  }, [location.search, profile?.id, findEventByCode, navigate]);

  const handleSprayError = (err: unknown): never => {
    const code = (err as Error & { code?: string }).code;
    if (code === "PIN_NOT_SET") {
      openPinSettings();
    } else if (code === "KYC_REQUIRED") {
      setShowKYC(true);
    } else {
      toast.error(err instanceof Error ? err.message : "Spray failed");
    }
    throw err;
  };

  const handleStartSpray = async (amount: number, denomination: number, pin: string) => {
    if (!selectedEvent) throw new Error("No event selected");
    let theatrePlan: SprayTheatrePlan | null = null;
    let holdId: string | null = null;
    try {
      const result = await sprayApi.validate(
        selectedEvent.id,
        amount,
        denomination as 200 | 500 | 1000,
        pin,
      );
      theatrePlan = result.theatre_plan;
      holdId = result.hold_id;
    } catch (err) {
      handleSprayError(err);
    }
    if (!holdId) {
      toast.error("Could not reserve spray funds. Try again.");
      return;
    }
    sprayHoldIdRef.current = holdId;
    setSprayAmount(amount);
    setSprayDenomination(denomination);
    setSprayPin(pin);
    setSprayTheatrePlan(theatrePlan);
    setSprayHoldId(holdId);
    setShowSpraySetup(false);
    setIsSprayActive(true);
  };

  const settleSpray = async (
    settlement: "partial" | "full" | "cancelled",
    sprayedAmount?: number,
  ) => {
    const holdId = sprayHoldIdRef.current ?? sprayHoldId;
    const finishWithLegacySend = async (amountMajor: number) => {
      if (!selectedEvent || !sprayPin || amountMajor <= 0) {
        throw new Error("No active spray hold");
      }
      const result = await sprayApi.send(
        selectedEvent.id,
        amountMajor,
        sprayDenomination as 200 | 500 | 1000,
        sprayPin,
      );
      sprayHoldIdRef.current = null;
      await refreshBalances();
      return result;
    };

    if (!holdId) {
      if (settlement === "cancelled") throw new Error("No active spray hold");
      const amountMajor = settlement === "full" ? sprayAmount : (sprayedAmount ?? 0);
      return finishWithLegacySend(amountMajor);
    }

    try {
      const result = await sprayApi.settle(
        holdId,
        settlement,
        settlement === "partial" ? sprayedAmount : undefined,
      );
      sprayHoldIdRef.current = null;
      await refreshBalances();
      return result;
    } catch (err) {
      if (settlement === "cancelled") throw err;
      const amountMajor = settlement === "full" ? sprayAmount : (sprayedAmount ?? 0);
      return finishWithLegacySend(amountMajor);
    }
  };

  const handleSprayComplete = async (_sprayedAmount: number) => {
    try {
      const result = await settleSpray("full");
      toast.success(`Successfully sprayed ₦${result.charged_amount.toLocaleString()}! 🎉`);
    } catch (err) {
      handleSprayError(err);
      throw err;
    } finally {
      setIsSprayActive(false);
      setSelectedEvent(null);
      setSprayPin("");
      setSprayTheatrePlan(null);
      setSprayHoldId(null);
      sprayHoldIdRef.current = null;
    }
  };

  const handleSprayAutoStop = async () => {
    try {
      const result = await settleSpray("full");
      toast.success(`Time's up! Full spray sent — ₦${result.charged_amount.toLocaleString()} 🎉`);
    } catch (err) {
      handleSprayError(err);
      throw err;
    } finally {
      setIsSprayActive(false);
      setSelectedEvent(null);
      setSprayPin("");
      setSprayTheatrePlan(null);
      setSprayHoldId(null);
      sprayHoldIdRef.current = null;
    }
  };

  const handleSprayCancel = async (sprayedAmount: number) => {
    try {
      if (sprayedAmount >= sprayAmount) {
        const result = await settleSpray("full");
        toast.success(`Successfully sprayed ₦${result.charged_amount.toLocaleString()}! 🎉`);
      } else if (sprayedAmount > 0) {
        const result = await settleSpray("partial", sprayedAmount);
        toast.info(`Spray stopped. ₦${result.charged_amount.toLocaleString()} was sprayed.`);
      } else {
        await settleSpray("cancelled");
        toast.info("Spray cancelled — hold released");
      }
    } catch (err) {
      handleSprayError(err);
      throw err;
    } finally {
      setIsSprayActive(false);
      setSelectedEvent(null);
      setSprayPin("");
      setSprayTheatrePlan(null);
      setSprayHoldId(null);
      sprayHoldIdRef.current = null;
    }
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

  const handleFundUSDC = (_amount: number, _provider: "blockradar", _description: string) => {
    toast.info("Send USDC to your deposit address. Balance updates automatically.");
    setShowFundSheet(false);
  };

  const handleCreateNgnAccount = async (bvn?: string) => createNgnAccount(bvn);
  const handleCreateMonnifyAccount = async (bvn: string) => createNgnAccount(bvn);

  const shellValue: DashboardShellValue = {
    user,
    profile,
    avatarData,
    kycLevel,
    kycLoading,
    ngnBalance,
    usdcBalance,
    walletLoading,
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
    withdrawUSDC,
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
    setShowConvert,
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
          onFundUSDC={handleFundUSDC}
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
          balance={ngnAvailableBalance}
          eventName={selectedEvent?.title || ""}
          kycLevel={kycLevel}
          hasPin={hasPin}
          isHost={Boolean(profile?.id && selectedEvent?.hostId === profile.id)}
          onOpenKYC={() => setShowKYC(true)}
          onPinNotSet={openPinSettings}
        />

        <AnimatePresence>
          {isSprayActive && (
            <SprayAnimation
              isActive={isSprayActive}
              amount={sprayAmount}
              denomination={sprayDenomination}
              noteIntervalSec={sprayTheatrePlan?.note_interval_sec ?? 1}
              sessionDurationSec={sprayTheatrePlan?.session_duration_sec ?? sprayAmount}
              avatarData={avatarData}
              onComplete={handleSprayComplete}
              onAutoStop={handleSprayAutoStop}
              onCancel={handleSprayCancel}
              eventName={selectedEvent?.title || "Event"}
            />
          )}
        </AnimatePresence>

        <AvatarCustomization
          isOpen={showAvatarCustomization}
          onClose={() => setShowAvatarCustomization(false)}
          onSave={async (data) => {
            try {
              await saveAvatarData(data);
              toast.success("Avatar saved! 🎉");
              setShowAvatarCustomization(false);
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Could not save avatar");
            }
          }}
          currentAvatar={avatarData}
          saving={savingAvatar}
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
          onClose={() => {
            setShowJoinEvent(false);
            setJoinEventInitialCode(undefined);
          }}
          onJoinEvent={handleJoinEvent}
          findEventByCode={findEventByCode}
          liveEvents={getLiveEvents()}
          initialCode={joinEventInitialCode}
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
          usdcBalance={usdcBalance}
          ngnWithdrawalFees={withdrawalFeeSettings}
          onWithdrawNGN={(amount, bankCode, accountNumber, accountName, pin) =>
            withdrawNGN(amount, bankCode, accountNumber, accountName, pin)
          }
          onWithdrawUSDC={(amount, toAddress, network, provider, fee, pin) =>
            withdrawUSDC(amount, toAddress, network, provider, fee, pin)
          }
          onPinNotSet={openPinSettings}
        />

        <SendMoneySheet open={showSendMoney} onOpenChange={setShowSendMoney} onPinNotSet={openPinSettings} />

        <ConvertSheet
          open={showConvert}
          onOpenChange={setShowConvert}
          onOpenKYC={() => setShowKYC(true)}
          onPinNotSet={openPinSettings}
          kycLevel={kycLevel}
          ngnBalance={ngnBalance}
          usdcBalance={usdcBalance}
          onSuccess={() => void refreshBalances()}
        />

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
          onClose={() => {
            setShowRedeemGiveaway(false);
            setRedeemGiveawayInitialCode(undefined);
          }}
          onRedeem={handleRedeemGiveaway}
          findGiveawayByCode={findGiveawayByCode}
          initialCode={redeemGiveawayInitialCode}
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
