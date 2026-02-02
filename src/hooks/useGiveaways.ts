import { useState, useEffect } from 'react';

export interface Giveaway {
  id: string;
  creatorId: string;
  creatorName: string;
  title: string;
  totalAmount: number;
  perPersonAmount: number;
  remainingAmount: number;
  code: string;
  status: 'active' | 'stopped' | 'exhausted';
  type: 'live' | 'scheduled';
  eventId?: string;
  eventName?: string;
  isPrivate: boolean;
  showOnEventScreen: boolean;
  redeemedBy: string[];
  redemptions: GiveawayRedemption[];
  createdAt: string;
  stoppedAt?: string;
}

export interface GiveawayRedemption {
  id: string;
  giveawayId: string;
  userId: string;
  userName: string;
  amount: number;
  redeemedAt: string;
}

const STORAGE_KEY = 'doings_giveaways';

const generateCode = (): string => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

export const useGiveaways = () => {
  const [giveaways, setGiveaways] = useState<Giveaway[]>([]);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      setGiveaways(JSON.parse(stored));
    }
  }, []);

  const saveGiveaways = (updated: Giveaway[]) => {
    setGiveaways(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  };

  const createGiveaway = (
    data: {
      title: string;
      totalAmount: number;
      perPersonAmount: number;
      type: 'live' | 'scheduled';
      eventId?: string;
      eventName?: string;
      isPrivate: boolean;
      showOnEventScreen: boolean;
    }
  ): Giveaway => {
    const newGiveaway: Giveaway = {
      id: `giveaway_${Date.now()}`,
      creatorId: 'current_user',
      creatorName: 'Champion',
      title: data.title,
      totalAmount: data.totalAmount,
      perPersonAmount: data.perPersonAmount,
      remainingAmount: data.totalAmount,
      code: generateCode(),
      status: 'active',
      type: data.type,
      eventId: data.eventId,
      eventName: data.eventName,
      isPrivate: data.isPrivate,
      showOnEventScreen: data.showOnEventScreen,
      redeemedBy: [],
      redemptions: [],
      createdAt: new Date().toISOString(),
    };

    saveGiveaways([newGiveaway, ...giveaways]);
    return newGiveaway;
  };

  const redeemGiveaway = (
    code: string,
    userId: string = 'current_user',
    userName: string = 'Champion'
  ): { success: boolean; message: string; amount?: number } => {
    // Re-read from localStorage to get latest state
    const stored = localStorage.getItem(STORAGE_KEY);
    const latestGiveaways: Giveaway[] = stored ? JSON.parse(stored) : giveaways;
    
    const giveaway = latestGiveaways.find(
      (g) => g.code.toUpperCase() === code.toUpperCase()
    );

    if (!giveaway) {
      return { success: false, message: 'Invalid giveaway code' };
    }

    if (giveaway.creatorId === userId) {
      return { success: false, message: 'You cannot redeem your own giveaway' };
    }

    if (giveaway.status === 'stopped') {
      return { success: false, message: 'This giveaway has been stopped by the creator' };
    }

    if (giveaway.status === 'exhausted') {
      return { success: false, message: 'This giveaway has been fully redeemed' };
    }

    if (giveaway.redeemedBy.includes(userId)) {
      return { success: false, message: 'You have already redeemed this giveaway' };
    }

    if (giveaway.remainingAmount < giveaway.perPersonAmount) {
      return { success: false, message: 'Insufficient funds remaining in giveaway' };
    }

    const redemption: GiveawayRedemption = {
      id: `redemption_${Date.now()}`,
      giveawayId: giveaway.id,
      userId,
      userName,
      amount: giveaway.perPersonAmount,
      redeemedAt: new Date().toISOString(),
    };

    const updatedGiveaway: Giveaway = {
      ...giveaway,
      remainingAmount: giveaway.remainingAmount - giveaway.perPersonAmount,
      redeemedBy: [...giveaway.redeemedBy, userId],
      redemptions: [...giveaway.redemptions, redemption],
      status:
        giveaway.remainingAmount - giveaway.perPersonAmount < giveaway.perPersonAmount
          ? 'exhausted'
          : 'active',
    };

    saveGiveaways(
      giveaways.map((g) => (g.id === giveaway.id ? updatedGiveaway : g))
    );

    return {
      success: true,
      message: `You received ₦${giveaway.perPersonAmount.toLocaleString()}!`,
      amount: giveaway.perPersonAmount,
    };
  };

  const stopGiveaway = (giveawayId: string): number => {
    const giveaway = giveaways.find((g) => g.id === giveawayId);
    if (!giveaway || giveaway.status !== 'active') return 0;

    const refundAmount = giveaway.remainingAmount;

    const updatedGiveaway: Giveaway = {
      ...giveaway,
      status: 'stopped',
      remainingAmount: 0,
      stoppedAt: new Date().toISOString(),
    };

    saveGiveaways(
      giveaways.map((g) => (g.id === giveawayId ? updatedGiveaway : g))
    );

    return refundAmount;
  };

  const getMyGiveaways = () => {
    return giveaways.filter((g) => g.creatorId === 'current_user');
  };

  const getActiveGiveaways = () => {
    return giveaways.filter((g) => g.status === 'active' && !g.isPrivate);
  };

  const getEventGiveaways = (eventId: string) => {
    return giveaways.filter(
      (g) => g.eventId === eventId && g.status === 'active' && g.showOnEventScreen
    );
  };

  const findGiveawayByCode = (code: string) => {
    return giveaways.find((g) => g.code.toUpperCase() === code.toUpperCase());
  };

  return {
    giveaways,
    createGiveaway,
    redeemGiveaway,
    stopGiveaway,
    getMyGiveaways,
    getActiveGiveaways,
    getEventGiveaways,
    findGiveawayByCode,
  };
};
