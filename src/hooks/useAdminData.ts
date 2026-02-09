import { useState, useEffect, useCallback } from "react";
import {
  AdminUser,
  PlatformUser,
  AdminTransaction,
  KYCSubmission,
  AdminEvent,
  AdminStats,
  AdminRole,
} from "@/types/admin";

const ADMIN_STORAGE_KEY = "doings_admin_data";

interface AdminDataState {
  currentAdmin: AdminUser | null;
  users: PlatformUser[];
  transactions: AdminTransaction[];
  kycSubmissions: KYCSubmission[];
  events: AdminEvent[];
}

// Generate mock data
const generateMockUsers = (): PlatformUser[] => {
  const statuses: PlatformUser["status"][] = ["active", "active", "active", "suspended", "active"];
  const kycStatuses: PlatformUser["kycStatus"][] = ["verified", "pending", "none", "verified", "rejected"];
  const names = [
    "Adebayo Johnson", "Chioma Okonkwo", "Emeka Nwosu", "Fatima Bello", "Gbenga Adeyemi",
    "Halima Yusuf", "Ikenna Eze", "Jennifer Adekunle", "Kunle Ogundimu", "Lola Bakare",
    "Mohammed Ibrahim", "Ngozi Okeke", "Oluwaseun Adeniyi", "Patricia Nnamdi", "Rasheed Lawal"
  ];
  
  return names.map((name, i) => ({
    id: `user-${i + 1}`,
    name,
    phone: `+234${String(8010000000 + i * 1234567).slice(0, 10)}`,
    email: `${name.toLowerCase().replace(" ", ".")}@email.com`,
    walletBalance: Math.floor(Math.random() * 500000),
    totalSprayed: Math.floor(Math.random() * 1000000),
    totalReceived: Math.floor(Math.random() * 800000),
    eventsHosted: Math.floor(Math.random() * 10),
    eventsJoined: Math.floor(Math.random() * 25),
    status: statuses[i % statuses.length],
    kycStatus: kycStatuses[i % kycStatuses.length],
    createdAt: new Date(Date.now() - Math.random() * 90 * 24 * 60 * 60 * 1000),
    lastActive: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000),
  }));
};

const generateMockTransactions = (users: PlatformUser[]): AdminTransaction[] => {
  const types: AdminTransaction["type"][] = ["deposit", "withdrawal", "spray", "giveaway", "refund"];
  const statuses: AdminTransaction["status"][] = ["completed", "completed", "pending", "completed", "failed"];
  
  return Array.from({ length: 50 }, (_, i) => {
    const user = users[i % users.length];
    const type = types[i % types.length];
    const amount = Math.floor(Math.random() * 100000) + 1000;
    
    return {
      id: `txn-${i + 1}`,
      userId: user.id,
      userName: user.name,
      type,
      amount: type === "withdrawal" || type === "spray" ? -amount : amount,
      status: statuses[i % statuses.length],
      method: type === "deposit" ? (i % 2 === 0 ? "bank" : "card") : undefined,
      reference: `TXN-${String(i + 1).padStart(6, "0")}`,
      description: getTransactionDescription(type, amount),
      createdAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000),
      flagged: i % 15 === 0,
      flagReason: i % 15 === 0 ? "Unusual transaction pattern" : undefined,
    };
  });
};

const getTransactionDescription = (type: string, amount: number): string => {
  switch (type) {
    case "deposit": return `Wallet funding via bank transfer`;
    case "withdrawal": return `Withdrawal to bank account`;
    case "spray": return `Sprayed at event`;
    case "giveaway": return `Giveaway distribution`;
    case "refund": return `Refund for failed transaction`;
    default: return `Transaction`;
  }
};

const generateMockKYC = (users: PlatformUser[]): KYCSubmission[] => {
  const pendingUsers = users.filter(u => u.kycStatus === "pending" || u.kycStatus === "verified");
  const idTypes: KYCSubmission["idType"][] = ["national_id", "drivers_license", "passport", "voters_card"];
  
  return pendingUsers.slice(0, 8).map((user, i) => ({
    id: `kyc-${i + 1}`,
    userId: user.id,
    userName: user.name,
    userPhone: user.phone,
    bvn: `${22100000000 + i * 12345678}`.slice(0, 11),
    nin: i % 2 === 0 ? `${10000000000 + i * 98765432}`.slice(0, 11) : undefined,
    idType: idTypes[i % idTypes.length],
    idNumber: `ID-${String(i + 1).padStart(8, "0")}`,
    idImageUrl: "/placeholder.svg",
    selfieUrl: "/placeholder.svg",
    status: user.kycStatus === "verified" ? "approved" : "pending",
    submittedAt: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000),
    reviewedAt: user.kycStatus === "verified" ? new Date() : undefined,
    reviewedBy: user.kycStatus === "verified" ? "Admin" : undefined,
  }));
};

const generateMockEvents = (users: PlatformUser[]): AdminEvent[] => {
  const types: AdminEvent["type"][] = ["wedding", "birthday", "party", "corporate", "other"];
  const statuses: AdminEvent["status"][] = ["live", "upcoming", "ended", "ended", "live"];
  const eventNames = [
    "Ade & Bola's Wedding", "Chidi's 30th Birthday", "New Year Party 2024",
    "Tech Summit Lagos", "Graduation Celebration", "Baby Shower - Mama Twins",
    "Company Christmas Party", "Engagement Ceremony", "Housewarming Party"
  ];
  
  return eventNames.map((name, i) => {
    const host = users[i % users.length];
    return {
      id: `event-${i + 1}`,
      name,
      hostId: host.id,
      hostName: host.name,
      code: `EVT${String(1000 + i).slice(1)}`,
      type: types[i % types.length],
      status: statuses[i % statuses.length],
      participantCount: Math.floor(Math.random() * 200) + 10,
      totalSprayed: Math.floor(Math.random() * 2000000),
      giveawayCount: Math.floor(Math.random() * 5),
      createdAt: new Date(Date.now() - Math.random() * 60 * 24 * 60 * 60 * 1000),
      scheduledAt: new Date(Date.now() + Math.random() * 30 * 24 * 60 * 60 * 1000),
      flagged: i === 2,
      flagReason: i === 2 ? "Reported for inappropriate content" : undefined,
    };
  });
};

const getInitialState = (): AdminDataState => {
  if (typeof window === "undefined") {
    return { currentAdmin: null, users: [], transactions: [], kycSubmissions: [], events: [] };
  }
  
  const stored = localStorage.getItem(ADMIN_STORAGE_KEY);
  if (stored) {
    const parsed = JSON.parse(stored);
    return {
      ...parsed,
      users: parsed.users.map((u: PlatformUser) => ({
        ...u,
        createdAt: new Date(u.createdAt),
        lastActive: new Date(u.lastActive),
      })),
      transactions: parsed.transactions.map((t: AdminTransaction) => ({
        ...t,
        createdAt: new Date(t.createdAt),
        processedAt: t.processedAt ? new Date(t.processedAt) : undefined,
      })),
      kycSubmissions: parsed.kycSubmissions.map((k: KYCSubmission) => ({
        ...k,
        submittedAt: new Date(k.submittedAt),
        reviewedAt: k.reviewedAt ? new Date(k.reviewedAt) : undefined,
      })),
      events: parsed.events.map((e: AdminEvent) => ({
        ...e,
        createdAt: new Date(e.createdAt),
        scheduledAt: e.scheduledAt ? new Date(e.scheduledAt) : undefined,
        endedAt: e.endedAt ? new Date(e.endedAt) : undefined,
      })),
    };
  }
  
  // Generate fresh mock data
  const users = generateMockUsers();
  const transactions = generateMockTransactions(users);
  const kycSubmissions = generateMockKYC(users);
  const events = generateMockEvents(users);
  
  return {
    currentAdmin: {
      id: "admin-1",
      name: "Admin User",
      email: "admin@doings.app",
      role: "super_admin",
      createdAt: new Date(),
      lastLogin: new Date(),
    },
    users,
    transactions,
    kycSubmissions,
    events,
  };
};

export const useAdminData = () => {
  const [state, setState] = useState<AdminDataState>(getInitialState);

  useEffect(() => {
    localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  // Stats calculation
  const getStats = useCallback((): AdminStats => {
    const { users, transactions, events, kycSubmissions } = state;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    return {
      totalUsers: users.length,
      activeUsers: users.filter(u => u.status === "active").length,
      suspendedUsers: users.filter(u => u.status === "suspended" || u.status === "banned").length,
      pendingKYC: kycSubmissions.filter(k => k.status === "pending").length,
      totalTransactions: transactions.length,
      totalVolume: transactions.filter(t => t.status === "completed" && t.amount > 0).reduce((sum, t) => sum + t.amount, 0),
      todayVolume: transactions.filter(t => t.createdAt >= today && t.amount > 0).reduce((sum, t) => sum + t.amount, 0),
      activeEvents: events.filter(e => e.status === "live").length,
      totalEvents: events.length,
      flaggedTransactions: transactions.filter(t => t.flagged).length,
    };
  }, [state]);

  // User actions
  const suspendUser = useCallback((userId: string, reason: string) => {
    setState(prev => ({
      ...prev,
      users: prev.users.map(u =>
        u.id === userId ? { ...u, status: "suspended" as const, suspendedReason: reason } : u
      ),
    }));
  }, []);

  const unsuspendUser = useCallback((userId: string) => {
    setState(prev => ({
      ...prev,
      users: prev.users.map(u =>
        u.id === userId ? { ...u, status: "active" as const, suspendedReason: undefined } : u
      ),
    }));
  }, []);

  const banUser = useCallback((userId: string, reason: string) => {
    setState(prev => ({
      ...prev,
      users: prev.users.map(u =>
        u.id === userId ? { ...u, status: "banned" as const, suspendedReason: reason } : u
      ),
    }));
  }, []);

  // Transaction actions
  const refundTransaction = useCallback((transactionId: string) => {
    setState(prev => ({
      ...prev,
      transactions: prev.transactions.map(t =>
        t.id === transactionId ? { ...t, status: "refunded" as const } : t
      ),
    }));
  }, []);

  const flagTransaction = useCallback((transactionId: string, reason: string) => {
    setState(prev => ({
      ...prev,
      transactions: prev.transactions.map(t =>
        t.id === transactionId ? { ...t, flagged: true, flagReason: reason } : t
      ),
    }));
  }, []);

  const unflagTransaction = useCallback((transactionId: string) => {
    setState(prev => ({
      ...prev,
      transactions: prev.transactions.map(t =>
        t.id === transactionId ? { ...t, flagged: false, flagReason: undefined } : t
      ),
    }));
  }, []);

  // KYC actions
  const approveKYC = useCallback((kycId: string) => {
    setState(prev => {
      const kyc = prev.kycSubmissions.find(k => k.id === kycId);
      if (!kyc) return prev;
      
      return {
        ...prev,
        kycSubmissions: prev.kycSubmissions.map(k =>
          k.id === kycId ? { 
            ...k, 
            status: "approved" as const, 
            reviewedAt: new Date(),
            reviewedBy: prev.currentAdmin?.name || "Admin"
          } : k
        ),
        users: prev.users.map(u =>
          u.id === kyc.userId ? { ...u, kycStatus: "verified" as const } : u
        ),
      };
    });
  }, []);

  const rejectKYC = useCallback((kycId: string, reason: string) => {
    setState(prev => {
      const kyc = prev.kycSubmissions.find(k => k.id === kycId);
      if (!kyc) return prev;
      
      return {
        ...prev,
        kycSubmissions: prev.kycSubmissions.map(k =>
          k.id === kycId ? { 
            ...k, 
            status: "rejected" as const, 
            reviewedAt: new Date(),
            reviewedBy: prev.currentAdmin?.name || "Admin",
            rejectionReason: reason
          } : k
        ),
        users: prev.users.map(u =>
          u.id === kyc.userId ? { ...u, kycStatus: "rejected" as const } : u
        ),
      };
    });
  }, []);

  // Event actions
  const flagEvent = useCallback((eventId: string, reason: string) => {
    setState(prev => ({
      ...prev,
      events: prev.events.map(e =>
        e.id === eventId ? { ...e, flagged: true, flagReason: reason } : e
      ),
    }));
  }, []);

  const unflagEvent = useCallback((eventId: string) => {
    setState(prev => ({
      ...prev,
      events: prev.events.map(e =>
        e.id === eventId ? { ...e, flagged: false, flagReason: undefined } : e
      ),
    }));
  }, []);

  const endEvent = useCallback((eventId: string) => {
    setState(prev => ({
      ...prev,
      events: prev.events.map(e =>
        e.id === eventId ? { ...e, status: "ended" as const, endedAt: new Date() } : e
      ),
    }));
  }, []);

  // Admin role change
  const setAdminRole = useCallback((role: AdminRole) => {
    setState(prev => ({
      ...prev,
      currentAdmin: prev.currentAdmin ? { ...prev.currentAdmin, role } : null,
    }));
  }, []);

  return {
    currentAdmin: state.currentAdmin,
    users: state.users,
    transactions: state.transactions,
    kycSubmissions: state.kycSubmissions,
    events: state.events,
    getStats,
    suspendUser,
    unsuspendUser,
    banUser,
    refundTransaction,
    flagTransaction,
    unflagTransaction,
    approveKYC,
    rejectKYC,
    flagEvent,
    unflagEvent,
    endEvent,
    setAdminRole,
  };
};
