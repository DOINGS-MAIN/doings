import { useState } from "react";
import { 
  Search, 
  Filter, 
  MoreHorizontal, 
  UserX, 
  UserCheck, 
  Ban,
  Eye,
  Mail
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAdminData } from "@/hooks/useAdminData";
import { PlatformUser } from "@/types/admin";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

export const AdminUsers = () => {
  const { users, suspendUser, unsuspendUser, banUser } = useAdminData();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [kycFilter, setKycFilter] = useState<string>("all");
  const [selectedUser, setSelectedUser] = useState<PlatformUser | null>(null);
  const [actionType, setActionType] = useState<"suspend" | "ban" | "view" | null>(null);
  const [actionReason, setActionReason] = useState("");

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const filteredUsers = users.filter((user) => {
    const matchesSearch = 
      user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.phone.includes(searchQuery) ||
      user.email?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = statusFilter === "all" || user.status === statusFilter;
    const matchesKYC = kycFilter === "all" || user.kycStatus === kycFilter;
    
    return matchesSearch && matchesStatus && matchesKYC;
  });

  const getStatusBadge = (status: PlatformUser["status"]) => {
    switch (status) {
      case "active":
        return <Badge className="bg-success/20 text-success border-0">Active</Badge>;
      case "suspended":
        return <Badge className="bg-accent/20 text-accent border-0">Suspended</Badge>;
      case "banned":
        return <Badge variant="destructive">Banned</Badge>;
    }
  };

  const getKYCBadge = (status: PlatformUser["kycStatus"]) => {
    switch (status) {
      case "verified":
        return <Badge className="bg-success/20 text-success border-0">Verified</Badge>;
      case "pending":
        return <Badge className="bg-primary/20 text-primary border-0">Pending</Badge>;
      case "rejected":
        return <Badge variant="destructive">Rejected</Badge>;
      case "none":
        return <Badge variant="outline" className="text-muted-foreground">None</Badge>;
    }
  };

  const handleAction = () => {
    if (!selectedUser || !actionType) return;

    if (actionType === "suspend") {
      suspendUser(selectedUser.id, actionReason);
      toast.success(`${selectedUser.name} has been suspended`);
    } else if (actionType === "ban") {
      banUser(selectedUser.id, actionReason);
      toast.success(`${selectedUser.name} has been banned`);
    }

    setSelectedUser(null);
    setActionType(null);
    setActionReason("");
  };

  const handleUnsuspend = (user: PlatformUser) => {
    unsuspendUser(user.id);
    toast.success(`${user.name} has been unsuspended`);
  };

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">User Management</h1>
        <p className="text-muted-foreground mt-1">Manage platform users and their accounts</p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, phone, or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
            <SelectItem value="banned">Banned</SelectItem>
          </SelectContent>
        </Select>
        <Select value={kycFilter} onValueChange={setKycFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="KYC Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All KYC</SelectItem>
            <SelectItem value="verified">Verified</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="none">None</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Users Table */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-muted-foreground">User</TableHead>
              <TableHead className="text-muted-foreground">Status</TableHead>
              <TableHead className="text-muted-foreground">KYC</TableHead>
              <TableHead className="text-muted-foreground">Balance</TableHead>
              <TableHead className="text-muted-foreground">Activity</TableHead>
              <TableHead className="text-muted-foreground">Last Active</TableHead>
              <TableHead className="text-muted-foreground w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredUsers.map((user) => (
              <TableRow key={user.id} className="border-border">
                <TableCell>
                  <div>
                    <p className="font-medium text-foreground">{user.name}</p>
                    <p className="text-sm text-muted-foreground">{user.phone}</p>
                  </div>
                </TableCell>
                <TableCell>{getStatusBadge(user.status)}</TableCell>
                <TableCell>{getKYCBadge(user.kycStatus)}</TableCell>
                <TableCell className="font-medium">
                  {formatCurrency(user.walletBalance)}
                </TableCell>
                <TableCell>
                  <div className="text-sm">
                    <span className="text-muted-foreground">{user.eventsHosted} hosted</span>
                    <span className="mx-1 text-border">•</span>
                    <span className="text-muted-foreground">{user.eventsJoined} joined</span>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {formatDistanceToNow(user.lastActive, { addSuffix: true })}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem 
                        onClick={() => {
                          setSelectedUser(user);
                          setActionType("view");
                        }}
                      >
                        <Eye className="w-4 h-4 mr-2" />
                        View Details
                      </DropdownMenuItem>
                      <DropdownMenuItem>
                        <Mail className="w-4 h-4 mr-2" />
                        Send Message
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {user.status === "active" ? (
                        <>
                          <DropdownMenuItem 
                            onClick={() => {
                              setSelectedUser(user);
                              setActionType("suspend");
                            }}
                            className="text-accent"
                          >
                            <UserX className="w-4 h-4 mr-2" />
                            Suspend User
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={() => {
                              setSelectedUser(user);
                              setActionType("ban");
                            }}
                            className="text-destructive"
                          >
                            <Ban className="w-4 h-4 mr-2" />
                            Ban User
                          </DropdownMenuItem>
                        </>
                      ) : user.status === "suspended" ? (
                        <DropdownMenuItem 
                          onClick={() => handleUnsuspend(user)}
                          className="text-success"
                        >
                          <UserCheck className="w-4 h-4 mr-2" />
                          Unsuspend User
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Results count */}
      <p className="text-sm text-muted-foreground">
        Showing {filteredUsers.length} of {users.length} users
      </p>

      {/* Suspend/Ban Dialog */}
      <Dialog 
        open={!!selectedUser && (actionType === "suspend" || actionType === "ban")} 
        onOpenChange={() => {
          setSelectedUser(null);
          setActionType(null);
          setActionReason("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionType === "suspend" ? "Suspend" : "Ban"} User
            </DialogTitle>
            <DialogDescription>
              {actionType === "suspend" 
                ? "This user will be temporarily suspended from the platform."
                : "This user will be permanently banned from the platform."
              }
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="bg-muted p-4 rounded-lg">
              <p className="font-medium">{selectedUser?.name}</p>
              <p className="text-sm text-muted-foreground">{selectedUser?.phone}</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Reason</label>
              <Textarea
                placeholder="Enter reason for this action..."
                value={actionReason}
                onChange={(e) => setActionReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => {
                setSelectedUser(null);
                setActionType(null);
                setActionReason("");
              }}
            >
              Cancel
            </Button>
            <Button 
              variant={actionType === "ban" ? "destructive" : "default"}
              onClick={handleAction}
              disabled={!actionReason.trim()}
            >
              {actionType === "suspend" ? "Suspend User" : "Ban User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View User Dialog */}
      <Dialog 
        open={!!selectedUser && actionType === "view"} 
        onOpenChange={() => {
          setSelectedUser(null);
          setActionType(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>User Details</DialogTitle>
          </DialogHeader>
          {selectedUser && (
            <div className="space-y-6 py-4">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center text-2xl font-bold text-primary">
                  {selectedUser.name.charAt(0)}
                </div>
                <div>
                  <p className="text-xl font-bold">{selectedUser.name}</p>
                  <p className="text-muted-foreground">{selectedUser.phone}</p>
                  {selectedUser.email && (
                    <p className="text-sm text-muted-foreground">{selectedUser.email}</p>
                  )}
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-muted p-4 rounded-lg">
                  <p className="text-sm text-muted-foreground">Wallet Balance</p>
                  <p className="text-xl font-bold">{formatCurrency(selectedUser.walletBalance)}</p>
                </div>
                <div className="bg-muted p-4 rounded-lg">
                  <p className="text-sm text-muted-foreground">Total Sprayed</p>
                  <p className="text-xl font-bold">{formatCurrency(selectedUser.totalSprayed)}</p>
                </div>
                <div className="bg-muted p-4 rounded-lg">
                  <p className="text-sm text-muted-foreground">Events Hosted</p>
                  <p className="text-xl font-bold">{selectedUser.eventsHosted}</p>
                </div>
                <div className="bg-muted p-4 rounded-lg">
                  <p className="text-sm text-muted-foreground">Events Joined</p>
                  <p className="text-xl font-bold">{selectedUser.eventsJoined}</p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status</span>
                  {getStatusBadge(selectedUser.status)}
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">KYC Status</span>
                  {getKYCBadge(selectedUser.kycStatus)}
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Member Since</span>
                  <span>{selectedUser.createdAt.toLocaleDateString()}</span>
                </div>
              </div>

              {selectedUser.suspendedReason && (
                <div className="bg-destructive/10 p-4 rounded-lg">
                  <p className="text-sm font-medium text-destructive">Suspension Reason</p>
                  <p className="text-sm mt-1">{selectedUser.suspendedReason}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
