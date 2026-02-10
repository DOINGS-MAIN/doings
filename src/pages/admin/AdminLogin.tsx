import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Shield, Eye, EyeOff, Mail, Lock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { useToast } from "@/hooks/use-toast";

export const AdminLogin = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isResetMode, setIsResetMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const { login, resetPassword } = useAdminAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    setTimeout(() => {
      const result = login(email, password);
      setLoading(false);

      if (result.success) {
        if (result.mustChangePassword) {
          navigate("/admin/change-password");
        } else {
          navigate("/admin");
        }
      } else {
        toast({ title: "Login Failed", description: result.error, variant: "destructive" });
      }
    }, 500);
  };

  const handleReset = (e: React.FormEvent) => {
    e.preventDefault();
    const result = resetPassword(email);
    if (result.success) {
      toast({
        title: "Password Reset",
        description: `Temporary password: ${result.tempPassword} — Use this to log in, then change your password.`,
      });
      setIsResetMode(false);
    } else {
      toast({ title: "Reset Failed", description: result.error, variant: "destructive" });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4" style={{ background: "var(--gradient-hero)" }}>
      <Card className="w-full max-w-md bg-card border-border">
        <CardContent className="p-8">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="w-16 h-16 rounded-2xl bg-primary/20 flex items-center justify-center mx-auto mb-4">
              <Shield className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">Doings Admin</h1>
            <p className="text-muted-foreground text-sm mt-1">
              {isResetMode ? "Reset your password" : "Sign in to the management console"}
            </p>
          </div>

          {isResetMode ? (
            <form onSubmit={handleReset} className="space-y-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-2 block">Email</label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    type="email"
                    placeholder="admin@doings.app"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-11"
                    required
                  />
                </div>
              </div>
              <Button type="submit" className="w-full h-12 font-semibold">
                Send Reset Link
              </Button>
              <button
                type="button"
                onClick={() => setIsResetMode(false)}
                className="w-full text-sm text-muted-foreground hover:text-primary transition-colors"
              >
                Back to login
              </button>
            </form>
          ) : (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-2 block">Email</label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    type="email"
                    placeholder="admin@doings.app"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-11"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-2 block">Password</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-11 pr-11"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <Button type="submit" className="w-full h-12 font-semibold" disabled={loading}>
                {loading ? "Signing in..." : "Sign In"}
              </Button>
              <button
                type="button"
                onClick={() => setIsResetMode(true)}
                className="w-full text-sm text-muted-foreground hover:text-primary transition-colors"
              >
                Forgot password?
              </button>
            </form>
          )}

          {/* Demo credentials hint */}
          <div className="mt-6 p-3 rounded-xl bg-muted/50 border border-border">
            <p className="text-xs text-muted-foreground text-center">
              <span className="font-semibold text-primary">Demo:</span> admin@doings.app / admin123
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
