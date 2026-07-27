import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Upload, Camera, Shirt, Sparkles, Crown, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { SprayAvatarCharacter } from "@/components/SprayAvatarCharacter";
import type { AvatarData } from "@/types/avatar";
import { AVATAR_ACCESSORIES, AVATAR_BACKGROUNDS, AVATAR_OUTFITS } from "@/lib/avatarConfig";

export type { AvatarData } from "@/types/avatar";

interface AvatarCustomizationProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (avatarData: AvatarData) => void | Promise<void>;
  currentAvatar?: AvatarData;
  saving?: boolean;
}

export const AvatarCustomization = ({
  isOpen,
  onClose,
  onSave,
  currentAvatar,
  saving = false,
}: AvatarCustomizationProps) => {
  const [photoUrl, setPhotoUrl] = useState<string | null>(currentAvatar?.photoUrl || null);
  const [selectedOutfit, setSelectedOutfit] = useState(currentAvatar?.outfit || "agbada");
  const [selectedAccessory, setSelectedAccessory] = useState(currentAvatar?.accessory || "none");
  const [selectedBackground, setSelectedBackground] = useState(currentAvatar?.background || "gold-gradient");
  const [activeTab, setActiveTab] = useState<"photo" | "outfit" | "accessory" | "background">("photo");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setPhotoUrl(currentAvatar?.photoUrl || null);
    setSelectedOutfit(currentAvatar?.outfit || "agbada");
    setSelectedAccessory(currentAvatar?.accessory || "none");
    setSelectedBackground(currentAvatar?.background || "gold-gradient");
  }, [isOpen, currentAvatar]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        toast.error("Image size should be less than 5MB");
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        setPhotoUrl(event.target?.result as string);
        toast.success("Photo uploaded — your avatar is ready to dance!");
      };
      reader.readAsDataURL(file);
    }
  };

  const previewAvatar: AvatarData = {
    photoUrl,
    outfit: selectedOutfit,
    accessory: selectedAccessory,
    background: selectedBackground,
  };

  const handleSave = async () => {
    await onSave(previewAvatar);
  };

  const tabs = [
    { id: "photo", label: "Photo", icon: Camera },
    { id: "outfit", label: "Outfit", icon: Shirt },
    { id: "accessory", label: "Extras", icon: Sparkles },
    { id: "background", label: "BG", icon: Crown },
  ] as const;

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-background/95 backdrop-blur-xl"
      >
        <motion.div
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="flex items-center justify-between px-6 pt-12 pb-4"
        >
          <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full" disabled={saving}>
            <X className="h-6 w-6" />
          </Button>
          <h1 className="text-xl font-bold text-foreground">Spray Avatar</h1>
          <Button
            onClick={() => void handleSave()}
            disabled={saving}
            className="bg-primary text-primary-foreground rounded-full px-4"
          >
            <Check className="h-4 w-4 mr-1" />
            {saving ? "Saving…" : "Save"}
          </Button>
        </motion.div>

        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="flex justify-center py-4"
        >
          <SprayAvatarCharacter avatar={previewAvatar} size="hero" dancing danceStyle="sway" showGlow />
        </motion.div>

        <div className="px-6 mb-4">
          <div className="glass rounded-2xl p-2 flex gap-2">
            {tabs.map((tab) => (
              <motion.button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 flex flex-col items-center gap-1 py-3 rounded-xl transition-all ${
                  activeTab === tab.id ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                }`}
                whileTap={{ scale: 0.95 }}
              >
                <tab.icon className="h-5 w-5" />
                <span className="text-xs font-medium">{tab.label}</span>
              </motion.button>
            ))}
          </div>
        </div>

        <div className="px-6 flex-1 overflow-auto pb-20">
          <AnimatePresence mode="sync">
            {activeTab === "photo" && (
              <motion.div
                key="photo"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <p className="text-muted-foreground text-sm text-center mb-4">
                  Upload your photo — we turn it into a dancing spray avatar on the big screen
                </p>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture="user"
                  onChange={handleFileChange}
                  className="hidden"
                />

                <div className="grid grid-cols-2 gap-4">
                  <motion.button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="glass rounded-2xl p-6 flex flex-col items-center gap-3 border-2 border-dashed border-primary/30 hover:border-primary transition-colors"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <div className="w-14 h-14 rounded-full bg-primary/20 flex items-center justify-center">
                      <Upload className="h-7 w-7 text-primary" />
                    </div>
                    <span className="text-sm font-medium text-foreground">Upload Photo</span>
                  </motion.button>

                  <motion.button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="glass rounded-2xl p-6 flex flex-col items-center gap-3 border-2 border-dashed border-secondary/30 hover:border-secondary transition-colors"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <div className="w-14 h-14 rounded-full bg-secondary/20 flex items-center justify-center">
                      <Camera className="h-7 w-7 text-secondary" />
                    </div>
                    <span className="text-sm font-medium text-foreground">Take Selfie</span>
                  </motion.button>
                </div>

                {photoUrl && (
                  <motion.button
                    type="button"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    onClick={() => setPhotoUrl(null)}
                    className="w-full py-3 text-destructive text-sm font-medium"
                  >
                    Remove Photo
                  </motion.button>
                )}

                <div className="glass rounded-2xl p-4 mt-6">
                  <div className="flex items-center gap-3 text-muted-foreground">
                    <Sparkles className="h-5 w-5 text-primary shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-foreground">Snapchat-style on the projector</p>
                      <p className="text-xs">Your face + outfit dances when you spray at live events</p>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === "outfit" && (
              <motion.div
                key="outfit"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
              >
                <p className="text-muted-foreground text-sm text-center mb-4">Choose your spray outfit style</p>
                <div className="grid grid-cols-3 gap-3">
                  {AVATAR_OUTFITS.map((outfit) => (
                    <motion.button
                      key={outfit.id}
                      type="button"
                      onClick={() => setSelectedOutfit(outfit.id)}
                      className={`relative glass rounded-2xl p-4 flex flex-col items-center gap-2 transition-all ${
                        selectedOutfit === outfit.id ? "ring-2 ring-primary bg-primary/10" : ""
                      }`}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      <div
                        className={`w-12 h-12 rounded-full bg-gradient-to-br ${outfit.color} flex items-center justify-center text-2xl`}
                      >
                        {outfit.emoji}
                      </div>
                      <span className="text-xs font-medium text-foreground">{outfit.name}</span>
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            )}

            {activeTab === "accessory" && (
              <motion.div
                key="accessory"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
              >
                <p className="text-muted-foreground text-sm text-center mb-4">Add some flair to your avatar</p>
                <div className="grid grid-cols-3 gap-3">
                  {AVATAR_ACCESSORIES.map((accessory) => (
                    <motion.button
                      key={accessory.id}
                      type="button"
                      onClick={() => setSelectedAccessory(accessory.id)}
                      className={`relative glass rounded-2xl p-4 flex flex-col items-center gap-2 transition-all ${
                        selectedAccessory === accessory.id ? "ring-2 ring-primary bg-primary/10" : ""
                      }`}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center text-2xl">
                        {accessory.emoji}
                      </div>
                      <span className="text-xs font-medium text-foreground">{accessory.name}</span>
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            )}

            {activeTab === "background" && (
              <motion.div
                key="background"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
              >
                <p className="text-muted-foreground text-sm text-center mb-4">Pick your avatar frame color</p>
                <div className="grid grid-cols-3 gap-3">
                  {AVATAR_BACKGROUNDS.map((bg) => (
                    <motion.button
                      key={bg.id}
                      type="button"
                      onClick={() => setSelectedBackground(bg.id)}
                      className={`relative rounded-2xl p-4 flex flex-col items-center gap-2 transition-all ${
                        selectedBackground === bg.id ? "ring-2 ring-white" : ""
                      }`}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      <div className={`w-12 h-12 rounded-full bg-gradient-to-br ${bg.colors}`} />
                      <span className="text-xs font-medium text-foreground">{bg.name}</span>
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
