import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Shield, Lock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PasswordInput } from "@/components/PasswordInput";
import { Button } from "@/components/ui/button";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { cameFromEmailLink } from "@/lib/authMethods";

export const AdminChangePassword = () => {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const { currentAccount, loading, changePassword, acceptInvite } = useAdminAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [fromEmailLink, setFromEmailLink] = useState(false);
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setFromEmailLink(cameFromEmailLink(data.session?.access_token)));
  }, [currentAccount]);
  // Signed in from an invite or reset link: there's no current password to confirm.
  const needsInviteAccept = !loading && !currentAccount;
  const settingFirstPassword = fromEmailLink;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast({ title: "Error", description: "Passwords don't match", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const result = await changePassword(newPassword, settingFirstPassword ? undefined : currentPassword);
      if (!result.success) {
        toast({ title: "Error", description: result.error, variant: "destructive" });
        return;
      }
      if (needsInviteAccept) {
        const accepted = await acceptInvite();
        if (!accepted.success) {
          toast({ title: "Error", description: accepted.error, variant: "destructive" });
          return;
        }
      }
      toast({ title: "Password Changed", description: "Your password has been updated." });
      navigate("/admin");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4" style={{ background: "var(--gradient-hero)" }}>
      <Card className="w-full max-w-md bg-card border-border">
        <CardContent className="p-8">
          <div className="text-center mb-8">
            <div className="w-16 h-16 rounded-2xl bg-primary/20 flex items-center justify-center mx-auto mb-4">
              <Shield className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">Change Password</h1>
            <p className="text-muted-foreground text-sm mt-1">
              {settingFirstPassword ? "Set a password to finish joining the admin team" : "Update your admin password"}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {!settingFirstPassword && (
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-2 block">Current Password</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none z-10" />
                  <PasswordInput
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="pl-11"
                    required
                  />
                </div>
              </div>
            )}
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-2 block">New Password</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none z-10" />
                <PasswordInput
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="pl-11"
                  required
                  minLength={6}
                />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-2 block">Confirm New Password</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none z-10" />
                <PasswordInput
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="pl-11"
                  required
                  minLength={6}
                />
              </div>
            </div>
            <Button type="submit" className="w-full h-12 font-semibold" disabled={saving || loading}>
              {settingFirstPassword ? "Set Password" : "Update Password"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};
