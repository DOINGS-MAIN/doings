import { useMemo } from 'react';
import { useWallet } from './useWallet';

export interface LeaderboardEntry {
  id: string;
  rank: number;
  name: string;
  username: string;
  avatar: string;
  totalGifted: number; // Renamed from totalSprayed - includes sprays + giveaways
  sprayAmount: number;
  giveawayAmount: number;
  eventsAttended: number;
  isCurrentUser: boolean;
  previousRank?: number;
  rankChange: 'up' | 'down' | 'same' | 'new';
}

export type TimePeriod = 'weekly' | 'monthly' | 'allTime';

// Mock data for demonstration - in production this would come from a backend
const mockUsers = [
  { id: 'user_1', name: 'Big Daddy', username: '@bigdaddy', avatar: '👑' },
  { id: 'user_2', name: 'Money Rain', username: '@moneyrain', avatar: '💸' },
  { id: 'user_3', name: 'Naira Queen', username: '@nairaqueen', avatar: '👸' },
  { id: 'user_4', name: 'Cash Flow', username: '@cashflow', avatar: '🤑' },
  { id: 'user_5', name: 'Spray Master', username: '@spraymaster', avatar: '🎯' },
  { id: 'user_6', name: 'Party King', username: '@partyking', avatar: '🎉' },
  { id: 'user_7', name: 'Baller', username: '@baller', avatar: '🏀' },
  { id: 'user_8', name: 'Oluwa Spray', username: '@oluwaspray', avatar: '⭐' },
  { id: 'current_user', name: 'Champion', username: '@champion', avatar: '🏆' },
  { id: 'user_10', name: 'Money Bag', username: '@moneybag', avatar: '💰' },
];

const generateMockData = (period: TimePeriod): LeaderboardEntry[] => {
  const multiplier = period === 'weekly' ? 1 : period === 'monthly' ? 4 : 12;
  
  const entries = mockUsers.map((user) => {
    const sprayAmount = Math.floor(Math.random() * 400000) + 30000;
    const giveawayAmount = Math.floor(Math.random() * 200000) + 10000;
    const previousRank = Math.floor(Math.random() * 10) + 1;
    
    return {
      id: user.id,
      rank: 0,
      name: user.name,
      username: user.username,
      avatar: user.avatar,
      sprayAmount: sprayAmount * multiplier,
      giveawayAmount: giveawayAmount * multiplier,
      totalGifted: (sprayAmount + giveawayAmount) * multiplier,
      eventsAttended: Math.floor(Math.random() * 15) + 1,
      isCurrentUser: user.id === 'current_user',
      previousRank,
      rankChange: 'same' as const,
    };
  });

  // Sort by totalGifted descending
  entries.sort((a, b) => b.totalGifted - a.totalGifted);
  
  // Assign ranks and calculate rank changes
  return entries.map((entry, index) => {
    const rank = index + 1;
    let rankChange: 'up' | 'down' | 'same' | 'new' = 'same';
    
    if (entry.previousRank) {
      if (entry.previousRank > rank) rankChange = 'up';
      else if (entry.previousRank < rank) rankChange = 'down';
    }
    
    return { ...entry, rank, rankChange };
  });
};

export const useLeaderboard = () => {
  const { transactions } = useWallet();
  
  // Calculate current user's spray total from actual transactions
  const currentUserSprayTotal = useMemo(() => {
    return transactions
      .filter(t => t.type === 'spray')
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);
  }, [transactions]);

  // Calculate current user's giveaway total from actual transactions
  const currentUserGiveawayTotal = useMemo(() => {
    return transactions
      .filter(t => t.type === 'giveaway')
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);
  }, [transactions]);

  // Combined total for "Top Gifters"
  const currentUserTotalGifted = currentUserSprayTotal + currentUserGiveawayTotal;

  const getLeaderboard = (period: TimePeriod): LeaderboardEntry[] => {
    const data = generateMockData(period);
    
    // Update current user's actual gifted amounts
    return data.map(entry => {
      if (entry.isCurrentUser) {
        const totalGifted = currentUserTotalGifted || entry.totalGifted;
        return { 
          ...entry, 
          sprayAmount: currentUserSprayTotal || entry.sprayAmount,
          giveawayAmount: currentUserGiveawayTotal || entry.giveawayAmount,
          totalGifted 
        };
      }
      return entry;
    }).sort((a, b) => b.totalGifted - a.totalGifted)
      .map((entry, index) => ({ ...entry, rank: index + 1 }));
  };

  const getCurrentUserRank = (period: TimePeriod): LeaderboardEntry | undefined => {
    const leaderboard = getLeaderboard(period);
    return leaderboard.find(e => e.isCurrentUser);
  };

  const getTopThree = (period: TimePeriod): LeaderboardEntry[] => {
    return getLeaderboard(period).slice(0, 3);
  };

  return {
    getLeaderboard,
    getCurrentUserRank,
    getTopThree,
    currentUserTotalGifted,
    currentUserSprayTotal,
    currentUserGiveawayTotal,
  };
};
