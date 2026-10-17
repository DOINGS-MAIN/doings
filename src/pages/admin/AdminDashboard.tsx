import { 
  Users, 
  CreditCard, 
  FileCheck, 
  Calendar, 
  TrendingUp,
  AlertTriangle,
  DollarSign,
  Activity,
  Coins,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAdminEvents, useAdminKyc, useAdminStats, useAdminTransactions } from "@/hooks/admin/useAdminQueries";
import type { AdminStats } from "@/types/admin";
import { formatDistanceToNow } from "date-fns";

const EMPTY_STATS: AdminStats = {
  totalUsers: 0, activeUsers: 0, suspendedUsers: 0, totalTransactions: 0, totalVolume: 0, todayVolume: 0,
  totalFeeRevenue: 0, todayFeeRevenue: 0, activeEvents: 0, totalEvents: 0, flaggedTransactions: 0, stuckWithdrawals: 0,
};

export const AdminDashboard = () => {
  const { data: statsData } = useAdminStats();
  const stats = statsData ?? EMPTY_STATS;
  const { data: recentTx } = useAdminTransactions({ page: 1, limit: 5 });
  const { data: liveEv } = useAdminEvents({ tab: "live", page: 1, limit: 5 });
  const { data: recentKyc } = useAdminKyc({ status: "all", page: 1, limit: 5 });
  const recentTransactions = recentTx?.rows ?? [];
  const liveEvents = liveEv?.rows ?? [];
  const recentKYC = recentKyc?.rows ?? [];

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const statCards = [
    {
      title: "Total Users",
      value: stats.totalUsers,
      subtitle: `${stats.activeUsers} active`,
      icon: Users,
      color: "text-primary",
      bgColor: "bg-primary/10",
    },
    {
      title: "Transaction Volume",
      value: formatCurrency(stats.totalVolume),
      subtitle: `${formatCurrency(stats.todayVolume)} today`,
      icon: DollarSign,
      color: "text-secondary",
      bgColor: "bg-secondary/10",
    },
    {
      title: "Fee Revenue",
      value: formatCurrency(stats.totalFeeRevenue),
      subtitle: `${formatCurrency(stats.todayFeeRevenue)} today`,
      icon: Coins,
      color: "text-primary",
      bgColor: "bg-primary/10",
    },
    {
      title: "Flagged Transactions",
      value: stats.flaggedTransactions,
      subtitle: `${stats.stuckWithdrawals} stuck withdrawals`,
      icon: AlertTriangle,
      color: "text-accent",
      bgColor: "bg-accent/10",
    },
    {
      title: "Active Events",
      value: stats.activeEvents,
      subtitle: `${stats.totalEvents} total`,
      icon: Calendar,
      color: "text-success",
      bgColor: "bg-success/10",
    },
  ];

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Welcome back! Here's what's happening.</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
        {statCards.map((stat) => (
          <Card key={stat.title} className="bg-card border-border">
            <CardContent className="p-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">{stat.title}</p>
                  <p className="text-2xl font-bold text-foreground mt-1">{stat.value}</p>
                  <p className="text-xs text-muted-foreground mt-1">{stat.subtitle}</p>
                </div>
                <div className={`p-3 rounded-xl ${stat.bgColor}`}>
                  <stat.icon className={`w-5 h-5 ${stat.color}`} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Alerts */}
      {(stats.flaggedTransactions > 0 || stats.suspendedUsers > 0) && (
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              <div className="flex-1">
                <p className="font-medium text-foreground">Attention Required</p>
                <p className="text-sm text-muted-foreground">
                  {stats.flaggedTransactions > 0 && `${stats.flaggedTransactions} flagged transactions`}
                  {stats.flaggedTransactions > 0 && stats.suspendedUsers > 0 && " • "}
                  {stats.suspendedUsers > 0 && `${stats.suspendedUsers} suspended users`}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Three Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Transactions */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-muted-foreground" />
              Recent Transactions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentTransactions.map((txn) => (
              <div 
                key={txn.id} 
                className="flex items-center justify-between py-2 border-b border-border last:border-0"
              >
                <div>
                  <p className="font-medium text-sm text-foreground">{txn.userName}</p>
                  <p className="text-xs text-muted-foreground capitalize">{txn.type}</p>
                </div>
                <div className="text-right">
                  <p className={`font-semibold text-sm ${txn.amount >= 0 ? "text-success" : "text-foreground"}`}>
                    {txn.amount >= 0 ? "+" : ""}{formatCurrency(Math.abs(txn.amount))}
                  </p>
                  {(txn.fee ?? 0) > 0 && (
                    <p className="text-xs text-primary">Fee {formatCurrency(txn.fee ?? 0)}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {formatDistanceToNow(txn.createdAt, { addSuffix: true })}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Recent KYC results */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <FileCheck className="w-5 h-5 text-muted-foreground" />
              Recent KYC results
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentKYC.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No KYC results yet
              </p>
            ) : (
              recentKYC.map((kyc) => (
                <div 
                  key={kyc.id} 
                  className="flex items-center justify-between py-2 border-b border-border last:border-0"
                >
                  <div>
                    <p className="font-medium text-sm text-foreground">{kyc.userName}</p>
                    <p className="text-xs text-muted-foreground capitalize">Level {kyc.level} · {kyc.status}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatDistanceToNow(kyc.submittedAt, { addSuffix: true })}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Live Events */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Activity className="w-5 h-5 text-muted-foreground" />
              Live Events
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {liveEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No live events
              </p>
            ) : (
              liveEvents.map((event) => (
                <div 
                  key={event.id} 
                  className="flex items-center justify-between py-2 border-b border-border last:border-0"
                >
                  <div>
                    <p className="font-medium text-sm text-foreground">{event.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {event.participantCount} participants
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
                    <span className="text-xs text-success font-medium">Live</span>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
