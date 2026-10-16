import { useState } from "react";
import { Key } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/PasswordInput";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { useToast } from "@/hooks/use-toast";

// Team management lives on /admin/team (super admins only).
export const AdminSettings = () => {
  const { changePassword } = useAdminAuth();
  const { toast } = useToast();

  const [changePwCurrent, setChangePwCurrent] = useState("");
  const [changePwNew, setChangePwNew] = useState("");
  const [saving, setSaving] = useState(false);

  const handleChangeOwnPassword = async () => {
    setSaving(true);
    try {
      const result = await changePassword(changePwNew, changePwCurrent);
      if (result.success) {
        toast({ title: "Password Changed" });
        setChangePwCurrent("");
        setChangePwNew("");
      } else {
        toast({ title: "Error", description: result.error, variant: "destructive" });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Settings</h1>
        <p className="text-muted-foreground mt-1">Your admin account</p>
      </div>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Key className="w-5 h-5 text-muted-foreground" />
            Change Your Password
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3 max-w-lg">
            <PasswordInput
              placeholder="Current password"
              value={changePwCurrent}
              onChange={(e) => setChangePwCurrent(e.target.value)}
            />
            <PasswordInput
              placeholder="New password"
              value={changePwNew}
              onChange={(e) => setChangePwNew(e.target.value)}
            />
            <Button onClick={handleChangeOwnPassword} disabled={saving || !changePwCurrent || changePwNew.length < 6}>
              Update
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
