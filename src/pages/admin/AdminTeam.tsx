import { useCallback, useEffect, useState } from "react";
import { Ban, CheckCircle, MoreVertical, Shield, UserPlus, Users } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { admin as adminApi } from "@/lib/supabase";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { AdminRole, ROLE_LABELS, can } from "@/types/admin";

type TeamMember = {
  id: string;
  user_id: string;
  email: string;
  role: AdminRole;
  status: "active" | "invited" | "disabled";
  last_login_at: string | null;
  created_at: string;
};

const errorMessage = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

export const AdminTeam = () => {
  const { session } = useAdminAuth();
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<AdminRole>("support");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = (await adminApi.team.list()) as { team?: TeamMember[] };
      setTeam(res.team ?? []);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't load the team"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Every change goes through the server, which refuses unsafe ones (e.g. removing the last super admin).
  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      await load();
    } catch (err) {
      toast.error(errorMessage(err, "That didn't work"));
    } finally {
      setBusy(false);
    }
  };

  const handleInvite = async () => {
    const email = inviteEmail.trim();
    if (!email) return;
    await run(() => adminApi.team.invite(email, inviteRole), `Invite sent to ${email}`);
    setInviteEmail("");
    setInviteRole("support");
  };

  const statusBadge = (status: TeamMember["status"]) => {
    switch (status) {
      case "active": return <Badge className="bg-success/20 text-success border-0">Active</Badge>;
      case "invited": return <Badge className="bg-primary/20 text-primary border-0">Invited</Badge>;
      case "disabled": return <Badge variant="destructive">Disabled</Badge>;
    }
  };

  if (!can(session?.role, "*")) {
    return <div className="p-8 text-muted-foreground">Only super admins can manage the team.</div>;
  }

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Team</h1>
        <p className="text-muted-foreground mt-1">Invite admins, change roles, and disable access</p>
      </div>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-muted-foreground" />
            Invite an admin
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <Input
              type="email"
              placeholder="Email address"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="flex-1 min-w-[220px]"
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
            <Button onClick={handleInvite} disabled={busy || !inviteEmail.trim()}>
              <UserPlus className="w-4 h-4 mr-2" />
              Invite
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            New people get an email link to set a password. People who already have a Doings account sign in to the admin with it.
          </p>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Users className="w-5 h-5 text-muted-foreground" />
            Admins ({team.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="space-y-3">
              {team.map((member) => {
                const isMe = member.user_id === session?.adminId;
                return (
                  <div key={member.id} className="flex items-center gap-4 p-4 rounded-xl bg-muted/30 border border-border">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                      <Shield className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-foreground truncate">{member.email || member.user_id}</p>
                        {isMe && <Badge variant="outline" className="text-xs">You</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {member.last_login_at
                          ? `Last login ${formatDistanceToNow(new Date(member.last_login_at), { addSuffix: true })}`
                          : "Never logged in"}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      {statusBadge(member.status)}
                      <Badge variant="outline">{ROLE_LABELS[member.role] ?? member.role}</Badge>
                      {!isMe && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" disabled={busy}>
                              <MoreVertical className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {Object.entries(ROLE_LABELS).map(([role, label]) =>
                              role !== member.role ? (
                                <DropdownMenuItem
                                  key={role}
                                  onClick={() => run(() => adminApi.team.setRole(member.id, role), `Role changed to ${label}`)}
                                >
                                  <Shield className="w-4 h-4 mr-2" />
                                  Make {label}
                                </DropdownMenuItem>
                              ) : null,
                            )}
                            <DropdownMenuSeparator />
                            {member.status === "disabled" ? (
                              <DropdownMenuItem onClick={() => run(() => adminApi.team.enable(member.id), "Access restored")}>
                                <CheckCircle className="w-4 h-4 mr-2" />
                                Enable
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                onClick={() => run(() => adminApi.team.disable(member.id), "Access disabled")}
                                className="text-destructive"
                              >
                                <Ban className="w-4 h-4 mr-2" />
                                Disable
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
