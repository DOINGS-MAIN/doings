import { useState } from "react";
import { motion } from "framer-motion";
import {
  User, Shield, CreditCard, Bell, Moon, Sun, LogOut,
  ChevronRight, Camera, Copy, Check, HelpCircle, FileText,
  Lock, Smartphone, Star, Award
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { AvatarData } from "@/components/AvatarCustomization";

interface ProfileScreenProps {
  avatarData: AvatarData;
  kycLevel: number;
  ngnBalance: number;
  usdtBalance: number;
  userName: string;
  userPhone: string;
  userId: string;
  onOpenAvatar: () => void;
  onOpenKYC: () => void;
  onOpenBankAccounts: () => void;
  onOpenNotifications: () => void;
  onLogout: () => void;
  onUpdateName?: (name: string) => Promise<void>;
}

const kycLabels: Record<number, { label: string; color: string; badge: string }> = {
  0: { label: "Unverified", color: "text-destructive", badge: "bg-destructive/20 text-destructive" },
  1: { label: "Basic", color: "text-yellow-500", badge: "bg-yellow-500/20 text-yellow-500" },
  2: { label: "Intermediate", color: "text-blue-500", badge: "bg-blue-500/20 text-blue-500" },
  3: { label: "Fully Verified", color: "text-green-500", badge: "bg-green-500/20 text-green-500" },
};

export const ProfileScreen = ({
  avatarData,
  kycLevel,
  ngnBalance,
  usdtBalance,
  userName,
  userPhone,
  userId,
  onOpenAvatar,
  onOpenKYC,
  onOpenBankAccounts,
  onOpenNotifications,
  onLogout,
  onUpdateName,
}: ProfileScreenProps) => {
  const [darkMode, setDarkMode] = useState(true);
  const [notifications, setNotifications] = useState(true);
  const [copied, setCopied] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(userName);

  const displayId = userId ? `USR-${userId.slice(0, 6).toUpperCase()}` : "USR-000000";
  const kycInfo = kycLabels[kycLevel] || kycLabels[0];

  const maskedPhone = userPhone
    ? userPhone.replace(/(\+\d{3})\d+(\d{4})/, "$1 •••• •• $2")
    : "+234 •••• •• ••••";

  const handleCopyId = () => {
    navigator.clipboard.writeText(displayId);
    setCopied(true);
    toast.success("User ID copied!");
    setTimeout(() => setCopied(false), 2000);
  };

  const backgrounds = {
    "gold-gradient": "from-amber-500 via-yellow-400 to-amber-600",
    "purple-gradient": "from-purple-600 via-violet-500 to-purple-700",
    "green-gradient": "from-green-600 via-emerald-500 to-green-700",
    "cyan-gradient": "from-cyan-500 via-blue-400 to-cyan-600",
    "red-gradient": "from-red-500 via-orange-400 to-red-600",
    "dark-gradient": "from-slate-800 via-slate-700 to-slate-900",
  };

  const bgGradient = backgrounds[avatarData.background as keyof typeof backgrounds] || backgrounds["gold-gradient"];

  const menuSections = [
    {
      title: "Account",
      items: [
        { icon: Shield, label: "KYC Verification", sublabel: kycInfo.label, action: onOpenKYC, badge: kycInfo.badge },
        { icon: CreditCard, label: "Bank Accounts", sublabel: "Manage linked accounts", action: onOpenBankAccounts },
        { icon: Lock, label: "Security", sublabel: "PIN & password", action: () => toast.info("Coming soon") },
        { icon: Smartphone, label: "Linked Devices", sublabel: "1 device active", action: () => toast.info("Coming soon") },
      ],
    },
    {
      title: "Preferences",
      items: [
        {
          icon: darkMode ? Moon : Sun,
          label: "Dark Mode",
          sublabel: darkMode ? "On" : "Off",
          toggle: true,
          toggled: darkMode,
          onToggle: setDarkMode,
        },
        {
          icon: Bell,
          label: "Notifications",
          sublabel: "View & manage alerts",
          toggle: false,
          action: onOpenNotifications,
        },
      ],
    },
    {
      title: "Support",
      items: [
        { icon: HelpCircle, label: "Help & FAQ", sublabel: "Get assistance", action: () => toast.info("Coming soon") },
        { icon: FileText, label: "Terms & Privacy", sublabel: "Legal info", action: () => toast.info("Coming soon") },
        { icon: Star, label: "Rate the App", sublabel: "Share your feedback", action: () => toast.info("Coming soon") },
      ],
    },
  ];

  return (
    <div className="pb-8">
      {/* Header */}
      <motion.div
        className="px-6 pt-12 pb-6"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h1 className="text-2xl font-bold text-foreground">Profile</h1>
      </motion.div>

      {/* Avatar & User Info Card */}
      <motion.div
        className="mx-6 mb-6 glass rounded-3xl p-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <div className="flex items-center gap-4">
          <motion.button
            onClick={onOpenAvatar}
            className="relative group"
            whileTap={{ scale: 0.95 }}
          >
            <div className={`w-20 h-20 rounded-full bg-gradient-to-br ${bgGradient} p-0.5 shadow-lg`}>
              <div className="w-full h-full rounded-full bg-card overflow-hidden flex items-center justify-center">
                {avatarData.photoUrl ? (
                  <img src={avatarData.photoUrl} alt="Avatar" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-3xl">👤</span>
                )}
              </div>
            </div>
            <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-primary flex items-center justify-center shadow-md">
              <Camera className="w-3.5 h-3.5 text-primary-foreground" />
            </div>
          </motion.button>

          <div className="flex-1">
            {editingName ? (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (nameInput.trim() && onUpdateName) {
                    await onUpdateName(nameInput.trim());
                    setEditingName(false);
                    toast.success("Name updated!");
                  }
                }}
                className="flex items-center gap-2"
              >
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  className="text-lg font-bold text-foreground bg-transparent border-b border-primary outline-none w-full"
                  autoFocus
                />
                <button type="submit" className="text-xs text-primary font-semibold">Save</button>
              </form>
            ) : (
              <button onClick={() => { setNameInput(userName); setEditingName(true); }} className="text-left">
                <h2 className="text-lg font-bold text-foreground">{userName || "Tap to set name"}</h2>
              </button>
            )}
            <p className="text-sm text-muted-foreground">{maskedPhone}</p>
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${kycInfo.badge}`}>
                {kycInfo.label}
              </span>
              <button onClick={handleCopyId} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                <span>{displayId}</span>
                {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
              </button>
            </div>
          </div>
        </div>

        {/* Wallet Summary */}
        <div className="grid grid-cols-2 gap-3 mt-5 pt-5 border-t border-border/50">
          <div className="text-center">
            <p className="text-lg font-bold text-foreground">₦{ngnBalance.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">NGN Balance</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-foreground">${usdtBalance.toFixed(2)}</p>
            <p className="text-xs text-muted-foreground">USDT Balance</p>
          </div>
        </div>
      </motion.div>

      {/* Menu Sections */}
      {menuSections.map((section, sIdx) => (
        <motion.div
          key={section.title}
          className="mx-6 mb-4"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 + sIdx * 0.05 }}
        >
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1">
            {section.title}
          </p>
          <div className="glass rounded-2xl overflow-hidden divide-y divide-border/30">
            {section.items.map((item) => (
              <motion.button
                key={item.label}
                onClick={'toggle' in item && item.toggle ? undefined : ('action' in item ? item.action : undefined)}
                className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-muted/30 transition-colors"
                whileTap={'toggle' in item && item.toggle ? undefined : { scale: 0.99 }}
              >
                <div className="w-9 h-9 rounded-xl bg-muted/50 flex items-center justify-center">
                  <item.icon className="w-4.5 h-4.5 text-foreground" />
                </div>
                <div className="flex-1 text-left">
                  <p className="text-sm font-medium text-foreground">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.sublabel}</p>
                </div>
                {'toggle' in item && item.toggle ? (
                  <Switch
                    checked={'toggled' in item ? item.toggled : false}
                    onCheckedChange={'onToggle' in item ? item.onToggle : undefined}
                  />
                ) : (
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                )}
              </motion.button>
            ))}
          </div>
        </motion.div>
      ))}

      {/* Logout */}
      <motion.div
        className="mx-6 mt-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35 }}
      >
        <Button
          variant="outline"
          onClick={onLogout}
          className="w-full rounded-2xl py-6 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <LogOut className="w-4 h-4 mr-2" />
          Log Out
        </Button>
      </motion.div>

      <p className="text-center text-xs text-muted-foreground mt-6">Doings v1.0.0</p>
    </div>
  );
};
