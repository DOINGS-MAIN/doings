import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Calendar, Clock, MapPin, Users, Lock, Globe, ChevronRight, Sparkles } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { EventData, EVENT_TYPES_CONFIG } from "@/hooks/useEvents";

interface CreateEventSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateEvent: (eventData: Omit<EventData, "id" | "eventCode" | "participants" | "totalSprayed" | "createdAt" | "updatedAt" | "emoji" | "gradient">) => EventData;
}

const eventTypes = [
  { id: "wedding", label: "Wedding", emoji: "💒" },
  { id: "birthday", label: "Birthday", emoji: "🎂" },
  { id: "party", label: "Party", emoji: "🎉" },
  { id: "graduation", label: "Graduation", emoji: "🎓" },
  { id: "funeral", label: "Funeral", emoji: "🕊️" },
  { id: "naming", label: "Naming", emoji: "👶" },
  { id: "other", label: "Other", emoji: "✨" },
] as const;

export const CreateEventSheet = ({ isOpen, onClose, onCreateEvent }: CreateEventSheetProps) => {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    title: "",
    type: "party" as EventData["type"],
    description: "",
    location: "",
    date: "",
    time: "",
    isPrivate: false,
    maxParticipants: undefined as number | undefined,
  });

  const handleNext = () => {
    if (step === 1) {
      if (!formData.title || !formData.type) {
        toast.error("Please fill in event title and type");
        return;
      }
    } else if (step === 2) {
      if (!formData.date || !formData.time || !formData.location) {
        toast.error("Please fill in date, time, and location");
        return;
      }
    }
    setStep((prev) => Math.min(prev + 1, 3));
  };

  const handleBack = () => {
    setStep((prev) => Math.max(prev - 1, 1));
  };

  const handleCreate = () => {
    const event = onCreateEvent({
      ...formData,
      hostId: "current-user",
      hostName: "You",
      status: "draft",
    });
    
    toast.success(
      <div className="flex flex-col gap-1">
        <span className="font-bold">Event Created! 🎉</span>
        <span className="text-sm">Event code: <span className="font-mono font-bold">{event.eventCode}</span></span>
      </div>
    );
    
    // Reset form
    setFormData({
      title: "",
      type: "party",
      description: "",
      location: "",
      date: "",
      time: "",
      isPrivate: false,
      maxParticipants: undefined,
    });
    setStep(1);
    onClose();
  };

  const renderStep = () => {
    switch (step) {
      case 1:
        return (
          <motion.div
            key="step1"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-6"
          >
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Event Name *
              </label>
              <Input
                placeholder="e.g., Ade & Bimpe's Wedding"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="bg-white/5 border-white/10"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-3">
                Event Type *
              </label>
              <div className="grid grid-cols-4 gap-2">
                {eventTypes.map((type) => (
                  <motion.button
                    key={type.id}
                    onClick={() => setFormData({ ...formData, type: type.id as EventData["type"] })}
                    className={`flex flex-col items-center gap-1 p-3 rounded-xl border transition-all ${
                      formData.type === type.id
                        ? "bg-primary/20 border-primary"
                        : "bg-white/5 border-white/10 hover:bg-white/10"
                    }`}
                    whileTap={{ scale: 0.95 }}
                  >
                    <span className="text-2xl">{type.emoji}</span>
                    <span className="text-xs font-medium text-foreground">{type.label}</span>
                  </motion.button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Description
              </label>
              <Textarea
                placeholder="Tell people what your event is about..."
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="bg-white/5 border-white/10 min-h-[80px]"
              />
            </div>
          </motion.div>
        );

      case 2:
        return (
          <motion.div
            key="step2"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-6"
          >
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  <Calendar className="w-4 h-4 inline mr-1" />
                  Date *
                </label>
                <Input
                  type="date"
                  value={formData.date}
                  onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                  className="bg-white/5 border-white/10"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  <Clock className="w-4 h-4 inline mr-1" />
                  Time *
                </label>
                <Input
                  type="time"
                  value={formData.time}
                  onChange={(e) => setFormData({ ...formData, time: e.target.value })}
                  className="bg-white/5 border-white/10"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                <MapPin className="w-4 h-4 inline mr-1" />
                Location *
              </label>
              <Input
                placeholder="e.g., Lagos, Nigeria"
                value={formData.location}
                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                className="bg-white/5 border-white/10"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                <Users className="w-4 h-4 inline mr-1" />
                Max Participants (optional)
              </label>
              <Input
                type="number"
                placeholder="Unlimited"
                value={formData.maxParticipants || ""}
                onChange={(e) => setFormData({ ...formData, maxParticipants: e.target.value ? parseInt(e.target.value) : undefined })}
                className="bg-white/5 border-white/10"
              />
            </div>
          </motion.div>
        );

      case 3:
        return (
          <motion.div
            key="step3"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-6"
          >
            <div className="glass rounded-2xl p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                {formData.isPrivate ? (
                  <Lock className="w-5 h-5 text-primary" />
                ) : (
                  <Globe className="w-5 h-5 text-primary" />
                )}
                <div>
                  <h4 className="font-medium text-foreground">Private Event</h4>
                  <p className="text-sm text-muted-foreground">
                    {formData.isPrivate ? "Only people with code can join" : "Anyone can discover and join"}
                  </p>
                </div>
              </div>
              <Switch
                checked={formData.isPrivate}
                onCheckedChange={(checked) => setFormData({ ...formData, isPrivate: checked })}
              />
            </div>

            {/* Preview */}
            <div>
              <h4 className="text-sm font-medium text-foreground mb-3">Event Preview</h4>
              <div className="glass rounded-2xl p-4">
                <div className="flex items-center gap-4">
                  <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${EVENT_TYPES_CONFIG[formData.type].gradient} flex items-center justify-center text-2xl`}>
                    {EVENT_TYPES_CONFIG[formData.type].emoji}
                  </div>
                  <div className="flex-1">
                    <span className="text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                      {eventTypes.find(t => t.id === formData.type)?.label}
                    </span>
                    <h3 className="font-bold text-foreground mt-1">{formData.title || "Event Name"}</h3>
                    <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {formData.location || "Location"}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {formData.date || "Date"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="glass rounded-2xl p-4 text-center">
              <Sparkles className="w-8 h-8 text-primary mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">
                After creating, you'll receive a unique event code to share with guests
              </p>
            </div>
          </motion.div>
        );
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent side="bottom" className="h-[85vh] bg-background rounded-t-3xl">
        <SheetHeader className="pb-4">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-xl font-bold text-foreground">
              Create Event
            </SheetTitle>
            <div className="flex items-center gap-2">
              {[1, 2, 3].map((s) => (
                <div
                  key={s}
                  className={`w-8 h-1 rounded-full transition-colors ${
                    s <= step ? "bg-primary" : "bg-white/20"
                  }`}
                />
              ))}
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            {step === 1 && "Basic Information"}
            {step === 2 && "Date & Location"}
            {step === 3 && "Privacy & Review"}
          </p>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto pb-24">
          <AnimatePresence mode="wait">
            {renderStep()}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="absolute bottom-0 left-0 right-0 p-6 bg-background border-t border-white/10">
          <div className="flex gap-3">
            {step > 1 && (
              <motion.button
                onClick={handleBack}
                className="flex-1 py-3 rounded-xl font-bold bg-white/10 text-foreground"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                Back
              </motion.button>
            )}
            <motion.button
              onClick={step === 3 ? handleCreate : handleNext}
              className="flex-1 py-3 rounded-xl font-bold bg-gradient-to-r from-primary to-accent text-primary-foreground flex items-center justify-center gap-2"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              {step === 3 ? (
                <>
                  <Sparkles className="w-5 h-5" />
                  Create Event
                </>
              ) : (
                <>
                  Continue
                  <ChevronRight className="w-5 h-5" />
                </>
              )}
            </motion.button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};
