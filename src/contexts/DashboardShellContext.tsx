import { createContext, useContext, type Dispatch, type SetStateAction } from "react";
import type { User } from "@supabase/supabase-js";
import type { UserProfile } from "@/hooks/useAuth";
import type { AvatarData } from "@/components/AvatarCustomization";
import type { EventData } from "@/hooks/useEvents";
import type { Giveaway } from "@/hooks/useGiveaways";
import type { Currency, FinanceTransaction, MonnifyReservedAccount, BlockradarAddress } from "@/types/finance";

export interface LiveEventListItem {
  id: string;
  title: string;
  type: string;
  location: string;
  participants: number;
  timeLeft: string;
  emoji: string;
  gradient: string;
}

export type CreateEventPayload = Omit<
  EventData,
  "id" | "eventCode" | "participants" | "totalSprayed" | "createdAt" | "updatedAt" | "emoji" | "gradient"
>;

export type CreateGiveawayPayload = {
  title: string;
  totalAmount: number;
  perPersonAmount: number;
  type: "live" | "scheduled";
  eventId?: string;
  eventName?: string;
  isPrivate: boolean;
  showOnEventScreen: boolean;
};

export interface DashboardShellValue {
  user: User | null;
  profile: UserProfile | null;
  avatarData: AvatarData;
  setAvatarData: Dispatch<SetStateAction<AvatarData>>;
  kycLevel: number;
  ngnBalance: number;
  usdtBalance: number;
  activeCurrency: Currency;
  setActiveCurrency: Dispatch<SetStateAction<Currency>>;
  transactions: FinanceTransaction[];
  monnifyAccount: MonnifyReservedAccount | undefined;
  blockradarAddresses: BlockradarAddress[];
  createMonnifyAccount: () => Promise<unknown>;
  createBlockradarAddress: (network?: string) => Promise<unknown>;
  withdrawNGN: (amount: number, bankName: string, accountNumber: string, fee: number) => void;
  withdrawUSDT: (
    amount: number,
    toAddress: string,
    network: string,
    provider: "blockradar" | "quidax",
    fee: number
  ) => void;
  verifyLevel1: (phone: string, email: string, fullName: string) => Promise<boolean>;
  verifyLevel2: (bvn: string, dateOfBirth: string) => Promise<{ success: boolean; message: string }>;
  verifyLevel3: (nin: string, selfieBase64: string) => Promise<{ success: boolean; message: string }>;
  events: EventData[];
  myEvents: EventData[];
  /** First load of hosted events; use for /events page loader. */
  myEventsInitialLoading: boolean;
  createEvent: (eventData: CreateEventPayload) => Promise<EventData>;
  updateEvent: (eventId: string, body: Record<string, unknown>) => Promise<EventData | null>;
  goLive: (eventId: string) => void;
  endEvent: (eventId: string) => void;
  deleteEvent: (eventId: string) => void;
  findEventByCode: (code: string) => Promise<EventData | undefined>;
  getLiveEvents: () => EventData[];
  joinEvent: (eventId: string) => void;
  createGiveaway: (data: CreateGiveawayPayload) => Promise<Giveaway>;
  redeemGiveaway: (code: string) => Promise<unknown>;
  stopGiveaway: (giveawayId: string) => Promise<number>;
  getMyGiveaways: () => Giveaway[];
  findGiveawayByCode: (code: string) => Giveaway | undefined;
  liveEventsForList: LiveEventListItem[];
  setShowFundSheet: Dispatch<SetStateAction<boolean>>;
  setShowHistory: Dispatch<SetStateAction<boolean>>;
  setShowJoinEvent: Dispatch<SetStateAction<boolean>>;
  setShowCreateEvent: Dispatch<SetStateAction<boolean>>;
  setShowKYC: Dispatch<SetStateAction<boolean>>;
  setShowWithdraw: Dispatch<SetStateAction<boolean>>;
  setShowSendMoney: Dispatch<SetStateAction<boolean>>;
  setShowCreateGiveaway: Dispatch<SetStateAction<boolean>>;
  setShowRedeemGiveaway: Dispatch<SetStateAction<boolean>>;
  setShowAvatarCustomization: Dispatch<SetStateAction<boolean>>;
  setShowBankAccounts: Dispatch<SetStateAction<boolean>>;
  setShowNotifications: Dispatch<SetStateAction<boolean>>;
  handleJoinEvent: (event: EventData) => void;
  handleManageEvent: (event: EventData) => void;
  handleGoLive: (eventId: string) => void;
  handleEndEvent: (eventId: string) => void;
  handleViewGiveaway: (giveaway: Giveaway) => void;
  signOut: () => Promise<void>;
  updateProfile: (updates: { full_name?: string }) => Promise<void>;
}

const DashboardShellContext = createContext<DashboardShellValue | null>(null);

export function useDashboardShell(): DashboardShellValue {
  const ctx = useContext(DashboardShellContext);
  if (!ctx) {
    throw new Error("useDashboardShell must be used inside DashboardLayout");
  }
  return ctx;
}

export { DashboardShellContext };
