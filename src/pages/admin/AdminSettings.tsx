import { useState } from "react";
import {
  Users,
  UserPlus,
  Shield,
  Trash2,
  Ban,
  CheckCircle,
  Key,
  Mail,
  MoreVertical,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAdminAuth, AdminAccount } from "@/hooks/useAdminAuth";
import { AdminRole, ROLE_LABELS } from "@/types/admin";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";

export const AdminSettings = () => {
  const {
    currentAccount,
    accounts,
    inviteAdmin,
    updateAdminRole,
    disableAdmin,
    enableAdmin,
    deleteAdmin,
    resetPassword,
    changePassword,
  } = useAdminAuth();
  const { toast } = useToast();

  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<AdminRole>("support");
  const [changePwCurrent, setChangePwCurrent] = useState("");
  const [changePwNew, setChangePwNew] = useState("");

  const isSuperAdmin = currentAccount?.role === "super_admin";

  const handleInvite = () => {
    if (!inviteName.trim() || !inviteEmail.trim()) {
      toast({ title: "Error", description: "Name and email are required", variant: "destructive" });
      return;
    }
    const result = inviteAdmin(inviteName, inviteEmail, inviteRole);
    if (result.success) {
      toast({ title: "Admin Invited", description: `${inviteName} has been invited as ${ROLE_LABELS[inviteRole]}. They can log in with their email and set a password.` });
      setInviteName("");
      setInviteEmail("");
      setInviteRole("support");
    } else {
      toast({ title: "Error", description: result.error, variant: "destructive" });
    }
  };

  const handleResetPassword = (account: AdminAccount) => {
    const result = resetPassword(account.email);
    if (result.success) {
      toast({ title: "Password Reset", description: `Temporary password for ${account.name}: ${result.tempPassword}` });
    }
  };

  const handleRoleChange = (adminId: string, role: AdminRole) => {
    const result = updateAdminRole(adminId, role);
    if (result.success) {
      toast({ title: "Role Updated" });
    } else {
      toast({ title: "Error", description: result.error, variant: "destructive" });
    }
  };

  const handleDisable = (adminId: string) => {
    const result = disableAdmin(adminId);
    if (result.success) toast({ title: "Account Disabled" });
    else toast({ title: "Error", description: result.error, variant: "destructive" });
  };

  const handleDelete = (adminId: string) => {
    const result = deleteAdmin(adminId);
    if (result.success) toast({ title: "Account Deleted" });
    else toast({ title: "Error", description: result.error, variant: "destructive" });
  };

  const handleChangeOwnPassword = () => {
    if (!currentAccount) return;
    const result = changePassword(currentAccount.id, changePwCurrent, changePwNew);
    if (result.success) {
      toast({ title: "Password Changed" });
      setChangePwCurrent("");
      setChangePwNew("");
    } else {
      toast({ title: "Error", description: result.error, variant: "destructive" });
    }
  };

  const getStatusBadge = (status: AdminAccount["status"]) => {
    switch (status) {
      case "active": return <Badge className="bg-success/20 text-success border-0">Active</Badge>;
      case "invited": return <Badge className="bg-primary/20 text-primary border-0">Invited</Badge>;
      case "disabled": return <Badge variant="destructive">Disabled</Badge>;
    }
  };

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Admin Settings</h1>
        <p className="text-muted-foreground mt-1">Manage admin accounts and permissions</p>
      </div>

      {/* Change Own Password */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Key className="w-5 h-5 text-muted-foreground" />
            Change Your Password
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3 max-w-lg">
            <Input
              type="password"
              placeholder="Current password"
              value={changePwCurrent}
              onChange={(e) => setChangePwCurrent(e.target.value)}
            />
            <Input
              type="password"
              placeholder="New password"
              value={changePwNew}
              onChange={(e) => setChangePwNew(e.target.value)}
            />
            <Button onClick={handleChangeOwnPassword} disabled={!changePwCurrent || !changePwNew}>
              Update
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Invite Admin (Super Admin only) */}
      {isSuperAdmin && (
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-muted-foreground" />
              Invite New Admin
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              <Input
                placeholder="Full name"
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                className="flex-1 min-w-[180px]"
              />
              <Input
                type="email"
                placeholder="Email address"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="flex-1 min-w-[200px]"
              />
              <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as AdminRole)}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ROLE_LABELS).map(([role, label]) => (
                    <SelectItem key={role} value={role}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={handleInvite}>
                <UserPlus className="w-4 h-4 mr-2" />
                Invite
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Admin Accounts List */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Users className="w-5 h-5 text-muted-foreground" />
            Admin Accounts ({accounts.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {accounts.map((account) => (
              <div
                key={account.id}
                className="flex items-center gap-4 p-4 rounded-xl bg-muted/30 border border-border"
              >
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Shield className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-foreground truncate">{account.name}</p>
                    {account.id === currentAccount?.id && (
                      <Badge variant="outline" className="text-xs">You</Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground truncate">{account.email}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {account.lastLogin
                      ? `Last login ${formatDistanceToNow(account.lastLogin, { addSuffix: true })}`
                      : "Never logged in"}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {getStatusBadge(account.status)}
                  <Badge variant="outline">{ROLE_LABELS[account.role]}</Badge>
                  {isSuperAdmin && account.id !== currentAccount?.id && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreVertical className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {/* Role change submenu */}
                        {Object.entries(ROLE_LABELS).map(([role, label]) => (
                          role !== account.role && (
                            <DropdownMenuItem key={role} onClick={() => handleRoleChange(account.id, role as AdminRole)}>
                              <Shield className="w-4 h-4 mr-2" />
                              Set as {label}
                            </DropdownMenuItem>
                          )
                        ))}
                        <DropdownMenuItem onClick={() => handleResetPassword(account)}>
                          <Key className="w-4 h-4 mr-2" />
                          Reset Password
                        </DropdownMenuItem>
                        {account.status === "disabled" ? (
                          <DropdownMenuItem onClick={() => enableAdmin(account.id)}>
                            <CheckCircle className="w-4 h-4 mr-2" />
                            Enable Account
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onClick={() => handleDisable(account.id)} className="text-destructive">
                            <Ban className="w-4 h-4 mr-2" />
                            Disable Account
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => handleDelete(account.id)} className="text-destructive">
                          <Trash2 className="w-4 h-4 mr-2" />
                          Delete Account
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
