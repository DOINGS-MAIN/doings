import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Upload, Camera, Shirt, Sparkles, Crown, Glasses, Watch, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface AvatarCustomizationProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (avatarData: AvatarData) => void;
  currentAvatar?: AvatarData;
}

export interface AvatarData {
  photoUrl: string | null;
  outfit: string;
  accessory: string;
  background: string;
}

const outfits = [
  { id: "agbada", name: "Agbada", emoji: "👘", color: "from-amber-500 to-yellow-600" },
  { id: "suit", name: "Classic Suit", emoji: "🤵", color: "from-slate-600 to-slate-800" },
  { id: "dashiki", name: "Dashiki", emoji: "👕", color: "from-green-500 to-emerald-600" },
  { id: "kaftan", name: "Kaftan", emoji: "🧥", color: "from-purple-500 to-violet-600" },
  { id: "casual", name: "Casual", emoji: "👔", color: "from-blue-500 to-cyan-600" },
  { id: "aso-oke", name: "Aso Oke", emoji: "🎭", color: "from-orange-500 to-red-600" },
];

const accessories = [
  { id: "none", name: "None", emoji: "✨" },
  { id: "cap", name: "Fila Cap", emoji: "🧢" },
  { id: "crown", name: "Crown", emoji: "👑" },
  { id: "glasses", name: "Shades", emoji: "🕶️" },
  { id: "chain", name: "Gold Chain", emoji: "⛓️" },
  { id: "watch", name: "Luxury Watch", emoji: "⌚" },
];

const backgrounds = [
  { id: "gold-gradient", name: "Gold", colors: "from-amber-500 via-yellow-400 to-amber-600" },
  { id: "purple-gradient", name: "Royal", colors: "from-purple-600 via-violet-500 to-purple-700" },
  { id: "green-gradient", name: "Naija", colors: "from-green-600 via-emerald-500 to-green-700" },
  { id: "cyan-gradient", name: "Ocean", colors: "from-cyan-500 via-blue-400 to-cyan-600" },
  { id: "red-gradient", name: "Fire", colors: "from-red-500 via-orange-400 to-red-600" },
  { id: "dark-gradient", name: "Elite", colors: "from-slate-800 via-slate-700 to-slate-900" },
];

export const AvatarCustomization = ({ isOpen, onClose, onSave, currentAvatar }: AvatarCustomizationProps) => {
  const [photoUrl, setPhotoUrl] = useState<string | null>(currentAvatar?.photoUrl || null);
  const [selectedOutfit, setSelectedOutfit] = useState(currentAvatar?.outfit || "agbada");
  const [selectedAccessory, setSelectedAccessory] = useState(currentAvatar?.accessory || "none");
  const [selectedBackground, setSelectedBackground] = useState(currentAvatar?.background || "gold-gradient");
  const [activeTab, setActiveTab] = useState<"photo" | "outfit" | "accessory" | "background">("photo");
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        toast.success("Photo uploaded successfully!");
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSave = () => {
    onSave({
      photoUrl,
      outfit: selectedOutfit,
      accessory: selectedAccessory,
      background: selectedBackground,
    });
    toast.success("Avatar saved! 🎉");
    onClose();
  };

  const currentOutfit = outfits.find(o => o.id === selectedOutfit);
  const currentAccessory = accessories.find(a => a.id === selectedAccessory);
  const currentBackground = backgrounds.find(b => b.id === selectedBackground);

  const tabs = [
    { id: "photo", label: "Photo", icon: Camera },
    { id: "outfit", label: "Outfit", icon: Shirt },
    { id: "accessory", label: "Extras", icon: Sparkles },
    { id: "background", label: "BG", icon: Crown },
  ];

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-background/95 backdrop-blur-xl"
      >
        {/* Header */}
        <motion.div
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="flex items-center justify-between px-6 pt-12 pb-4"
        >
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="rounded-full"
          >
            <X className="h-6 w-6" />
          </Button>
          <h1 className="text-xl font-bold text-foreground">Customize Avatar</h1>
          <Button
            onClick={handleSave}
            className="bg-primary text-primary-foreground rounded-full px-4"
          >
            <Check className="h-4 w-4 mr-1" />
            Save
          </Button>
        </motion.div>

        {/* Avatar Preview */}
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="flex justify-center py-6"
        >
          <div className="relative">
            {/* Background */}
            <div className={`w-40 h-40 rounded-full bg-gradient-to-br ${currentBackground?.colors} p-1 shadow-lg`}>
              {/* Avatar container */}
              <div className="w-full h-full rounded-full bg-card overflow-hidden flex items-center justify-center relative">
                {photoUrl ? (
                  <img
                    src={photoUrl}
                    alt="Avatar"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="text-6xl">
                    {currentOutfit?.emoji || "👤"}
                  </div>
                )}
                
                {/* Overlay with outfit indicator */}
                {photoUrl && (
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent h-12 flex items-end justify-center pb-1">
                    <span className="text-2xl">{currentOutfit?.emoji}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Accessory badge */}
            {selectedAccessory !== "none" && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="absolute -top-2 -right-2 w-12 h-12 rounded-full bg-card border-2 border-primary flex items-center justify-center text-2xl shadow-lg"
              >
                {currentAccessory?.emoji}
              </motion.div>
            )}
          </div>
        </motion.div>

        {/* Tab Navigation */}
        <div className="px-6 mb-4">
          <div className="glass rounded-2xl p-2 flex gap-2">
            {tabs.map((tab) => (
              <motion.button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={`flex-1 flex flex-col items-center gap-1 py-3 rounded-xl transition-all ${
                  activeTab === tab.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground"
                }`}
                whileTap={{ scale: 0.95 }}
              >
                <tab.icon className="h-5 w-5" />
                <span className="text-xs font-medium">{tab.label}</span>
              </motion.button>
            ))}
          </div>
        </div>

        {/* Tab Content */}
        <div className="px-6 flex-1 overflow-auto pb-20">
          <AnimatePresence mode="wait">
            {/* Photo Tab */}
            {activeTab === "photo" && (
              <motion.div
                key="photo"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <p className="text-muted-foreground text-sm text-center mb-4">
                  Upload a photo to personalize your spray avatar
                </p>
                
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="hidden"
                />

                <div className="grid grid-cols-2 gap-4">
                  <motion.button
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
                    onClick={() => fileInputRef.current?.click()}
                    className="glass rounded-2xl p-6 flex flex-col items-center gap-3 border-2 border-dashed border-secondary/30 hover:border-secondary transition-colors"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <div className="w-14 h-14 rounded-full bg-secondary/20 flex items-center justify-center">
                      <Camera className="h-7 w-7 text-secondary" />
                    </div>
                    <span className="text-sm font-medium text-foreground">Take Photo</span>
                  </motion.button>
                </div>

                {photoUrl && (
                  <motion.button
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
                    <Sparkles className="h-5 w-5 text-primary" />
                    <div>
                      <p className="text-sm font-medium text-foreground">AI Avatar Coming Soon!</p>
                      <p className="text-xs">Generate unique avatars with AI</p>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Outfit Tab */}
            {activeTab === "outfit" && (
              <motion.div
                key="outfit"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
              >
                <p className="text-muted-foreground text-sm text-center mb-4">
                  Choose your spray outfit style
                </p>
                
                <div className="grid grid-cols-3 gap-3">
                  {outfits.map((outfit) => (
                    <motion.button
                      key={outfit.id}
                      onClick={() => setSelectedOutfit(outfit.id)}
                      className={`glass rounded-2xl p-4 flex flex-col items-center gap-2 transition-all ${
                        selectedOutfit === outfit.id
                          ? "ring-2 ring-primary bg-primary/10"
                          : ""
                      }`}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      <div className={`w-12 h-12 rounded-full bg-gradient-to-br ${outfit.color} flex items-center justify-center text-2xl`}>
                        {outfit.emoji}
                      </div>
                      <span className="text-xs font-medium text-foreground">{outfit.name}</span>
                      {selectedOutfit === outfit.id && (
                        <motion.div
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-primary flex items-center justify-center"
                        >
                          <Check className="h-3 w-3 text-primary-foreground" />
                        </motion.div>
                      )}
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            )}

            {/* Accessory Tab */}
            {activeTab === "accessory" && (
              <motion.div
                key="accessory"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
              >
                <p className="text-muted-foreground text-sm text-center mb-4">
                  Add some flair to your avatar
                </p>
                
                <div className="grid grid-cols-3 gap-3">
                  {accessories.map((accessory) => (
                    <motion.button
                      key={accessory.id}
                      onClick={() => setSelectedAccessory(accessory.id)}
                      className={`glass rounded-2xl p-4 flex flex-col items-center gap-2 transition-all relative ${
                        selectedAccessory === accessory.id
                          ? "ring-2 ring-primary bg-primary/10"
                          : ""
                      }`}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center text-2xl">
                        {accessory.emoji}
                      </div>
                      <span className="text-xs font-medium text-foreground">{accessory.name}</span>
                      {selectedAccessory === accessory.id && (
                        <motion.div
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-primary flex items-center justify-center"
                        >
                          <Check className="h-3 w-3 text-primary-foreground" />
                        </motion.div>
                      )}
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            )}

            {/* Background Tab */}
            {activeTab === "background" && (
              <motion.div
                key="background"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
              >
                <p className="text-muted-foreground text-sm text-center mb-4">
                  Pick your avatar frame color
                </p>
                
                <div className="grid grid-cols-3 gap-3">
                  {backgrounds.map((bg) => (
                    <motion.button
                      key={bg.id}
                      onClick={() => setSelectedBackground(bg.id)}
                      className={`relative rounded-2xl p-4 flex flex-col items-center gap-2 transition-all ${
                        selectedBackground === bg.id
                          ? "ring-2 ring-white"
                          : ""
                      }`}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      <div className={`w-12 h-12 rounded-full bg-gradient-to-br ${bg.colors}`} />
                      <span className="text-xs font-medium text-foreground">{bg.name}</span>
                      {selectedBackground === bg.id && (
                        <motion.div
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-white flex items-center justify-center"
                        >
                          <Check className="h-3 w-3 text-primary-foreground" />
                        </motion.div>
                      )}
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
