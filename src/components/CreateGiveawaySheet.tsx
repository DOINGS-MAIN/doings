import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Gift, Users, Coins, Lock, Eye, ChevronLeft, ChevronRight, Sparkles, PartyPopper } from "lucide-react";
import { EventData } from "@/hooks/useEvents";

interface CreateGiveawaySheetProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateGiveaway: (data: {
    title: string;
    totalAmount: number;
    perPersonAmount: number;
    type: 'live' | 'scheduled';
    eventId?: string;
    eventName?: string;
    isPrivate: boolean;
    showOnEventScreen: boolean;
  }) => { code: string; id: string } | Promise<{ code: string; id: string }>;
  balance: number;
  liveEvents: EventData[];
}

export const CreateGiveawaySheet = ({
  isOpen,
  onClose,
  onCreateGiveaway,
  balance,
  liveEvents,
}: CreateGiveawaySheetProps) => {
  const [step, setStep] = useState(1);
  const [title, setTitle] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [perPersonAmount, setPerPersonAmount] = useState("");
  const [type, setType] = useState<'live' | 'scheduled'>('scheduled');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [isPrivate, setIsPrivate] = useState(false);
  const [showOnEventScreen, setShowOnEventScreen] = useState(true);
  const [createdGiveaway, setCreatedGiveaway] = useState<{ code: string; id: string } | null>(null);

  const numericTotal = parseFloat(totalAmount) || 0;
  const numericPerPerson = parseFloat(perPersonAmount) || 0;
  const maxWinners = numericPerPerson > 0 ? Math.floor(numericTotal / numericPerPerson) : 0;
  const canCreate = title && numericTotal >= 100 && numericPerPerson >= 10 && numericTotal <= balance && numericPerPerson <= numericTotal;

  const selectedEvent = liveEvents.find(e => e.id === selectedEventId);

  const handleCreate = async () => {
    const result = await onCreateGiveaway({
      title,
      totalAmount: numericTotal,
      perPersonAmount: numericPerPerson,
      type,
      eventId: selectedEventId || undefined,
      eventName: selectedEvent?.title,
      isPrivate,
      showOnEventScreen: type === 'live' ? showOnEventScreen : false,
    });
    setCreatedGiveaway(result);
    setStep(4);
  };

  const handleClose = () => {
    setStep(1);
    setTitle("");
    setTotalAmount("");
    setPerPersonAmount("");
    setType('scheduled');
    setSelectedEventId(null);
    setIsPrivate(false);
    setShowOnEventScreen(true);
    setCreatedGiveaway(null);
    onClose();
  };

  const renderStep = () => {
    switch (step) {
      case 1:
        return (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-6"
          >
            <div className="text-center mb-6">
              <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-4">
                <Gift className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-lg font-bold text-foreground">Create a Giveaway</h3>
              <p className="text-sm text-muted-foreground">Share the love with your people</p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">Giveaway Title</label>
                <Input
                  placeholder="e.g., Birthday Celebration Giveaway"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>

              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">Type</label>
                <div className="grid grid-cols-2 gap-3">
                  <motion.button
                    onClick={() => setType('scheduled')}
                    className={`p-4 rounded-2xl border-2 transition-all ${
                      type === 'scheduled' 
                        ? 'border-primary bg-primary/10' 
                        : 'border-border bg-card'
                    }`}
                    whileTap={{ scale: 0.98 }}
                  >
                    <Sparkles className={`w-6 h-6 mx-auto mb-2 ${type === 'scheduled' ? 'text-primary' : 'text-muted-foreground'}`} />
                    <p className="text-sm font-medium text-foreground">Scheduled</p>
                    <p className="text-xs text-muted-foreground">Anytime giveaway</p>
                  </motion.button>
                  <motion.button
                    onClick={() => setType('live')}
                    className={`p-4 rounded-2xl border-2 transition-all ${
                      type === 'live' 
                        ? 'border-primary bg-primary/10' 
                        : 'border-border bg-card'
                    }`}
                    whileTap={{ scale: 0.98 }}
                  >
                    <PartyPopper className={`w-6 h-6 mx-auto mb-2 ${type === 'live' ? 'text-primary' : 'text-muted-foreground'}`} />
                    <p className="text-sm font-medium text-foreground">Event Live</p>
                    <p className="text-xs text-muted-foreground">During an event</p>
                  </motion.button>
                </div>
              </div>

              {type === 'live' && selectedEventId && (
                <div>
                  <label className="text-sm font-medium text-foreground mb-2 block">Select Event</label>
                  {liveEvents.length > 0 ? (
                    <div className="space-y-2 max-h-32 overflow-y-auto">
                      {liveEvents.map(event => (
                        <motion.button
                          key={event.id}
                          onClick={() => setSelectedEventId(event.id)}
                          className={`w-full p-3 rounded-xl border-2 transition-all flex items-center gap-3 ${
                            selectedEventId === event.id 
                              ? 'border-primary bg-primary/10' 
                              : 'border-border bg-card'
                          }`}
                          whileTap={{ scale: 0.98 }}
                        >
                          <span className="text-2xl">{event.emoji}</span>
                          <div className="text-left flex-1">
                            <p className="text-sm font-medium text-foreground">{event.title}</p>
                            <p className="text-xs text-green-400">● Live Now</p>
                          </div>
                        </motion.button>
                      ))}
                    </div>
                  ) : (
                    <div className="p-4 rounded-xl bg-muted/50 text-center">
                      <p className="text-sm text-muted-foreground">No live events. Start an event first or choose "Scheduled".</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            <Button
              onClick={() => setStep(2)}
              disabled={!title || (type === 'live' && !selectedEventId)}
              className="w-full h-14 rounded-2xl bg-primary text-primary-foreground font-bold text-lg"
            >
              Continue
              <ChevronRight className="w-5 h-5 ml-2" />
            </Button>
          </motion.div>
        );

      case 2:
        return (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-6"
          >
            <button onClick={() => setStep(1)} className="flex items-center gap-2 text-muted-foreground">
              <ChevronLeft className="w-4 h-4" />
              Back
            </button>

            <div className="text-center mb-6">
              <div className="w-16 h-16 rounded-full bg-accent/20 flex items-center justify-center mx-auto mb-4">
                <Coins className="w-8 h-8 text-accent" />
              </div>
              <h3 className="text-lg font-bold text-foreground">Set Amounts</h3>
              <p className="text-sm text-muted-foreground">Balance: ₦{balance.toLocaleString()}</p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">Total Amount</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-bold">₦</span>
                  <Input
                    type="number"
                    placeholder="0"
                    value={totalAmount}
                    onChange={(e) => setTotalAmount(e.target.value)}
                    className="pl-10 text-xl font-bold"
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1">Minimum ₦100</p>
              </div>

              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">Amount Per Person</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-bold">₦</span>
                  <Input
                    type="number"
                    placeholder="0"
                    value={perPersonAmount}
                    onChange={(e) => setPerPersonAmount(e.target.value)}
                    className="pl-10 text-xl font-bold"
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1">Minimum ₦10</p>
              </div>

              {maxWinners > 0 && (
                <div className="p-4 rounded-2xl bg-primary/10 border border-primary/20">
                  <div className="flex items-center gap-3">
                    <Users className="w-6 h-6 text-primary" />
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        Up to <span className="text-primary font-bold">{maxWinners}</span> people can redeem
                      </p>
                      <p className="text-xs text-muted-foreground">
                        ₦{numericPerPerson.toLocaleString()} each
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <Button
              onClick={() => setStep(3)}
              disabled={!canCreate}
              className="w-full h-14 rounded-2xl bg-primary text-primary-foreground font-bold text-lg"
            >
              Continue
              <ChevronRight className="w-5 h-5 ml-2" />
            </Button>
          </motion.div>
        );

      case 3:
        return (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-6"
          >
            <button onClick={() => setStep(2)} className="flex items-center gap-2 text-muted-foreground">
              <ChevronLeft className="w-4 h-4" />
              Back
            </button>

            <div className="text-center mb-6">
              <div className="w-16 h-16 rounded-full bg-secondary/20 flex items-center justify-center mx-auto mb-4">
                <Eye className="w-8 h-8 text-secondary-foreground" />
              </div>
              <h3 className="text-lg font-bold text-foreground">Privacy Settings</h3>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-2xl bg-card border border-border">
                <div className="flex items-center gap-3">
                  <Lock className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium text-foreground">Private Giveaway</p>
                    <p className="text-xs text-muted-foreground">Only share via code/link</p>
                  </div>
                </div>
                <Switch checked={isPrivate} onCheckedChange={setIsPrivate} />
              </div>

              {type === 'live' && (
                <div className="flex items-center justify-between p-4 rounded-2xl bg-card border border-border">
                  <div className="flex items-center gap-3">
                    <Eye className="w-5 h-5 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium text-foreground">Show on Event Screen</p>
                      <p className="text-xs text-muted-foreground">Visible to all event participants</p>
                    </div>
                  </div>
                  <Switch checked={showOnEventScreen} onCheckedChange={setShowOnEventScreen} />
                </div>
              )}

              {/* Preview */}
              <div className="p-4 rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 border border-primary/30">
                <h4 className="text-sm font-bold text-foreground mb-3">Preview</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Title</span>
                    <span className="text-foreground font-medium">{title}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Amount</span>
                    <span className="text-foreground font-medium">₦{numericTotal.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Per Person</span>
                    <span className="text-foreground font-medium">₦{numericPerPerson.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Max Winners</span>
                    <span className="text-foreground font-medium">{maxWinners} people</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Type</span>
                    <span className="text-foreground font-medium capitalize">{type}</span>
                  </div>
                </div>
              </div>
            </div>

            <Button
              onClick={handleCreate}
              className="w-full h-14 rounded-2xl bg-gradient-to-r from-primary to-accent text-primary-foreground font-bold text-lg"
            >
              Create Giveaway 🎁
            </Button>
          </motion.div>
        );

      case 4:
        return (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center space-y-6"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", delay: 0.2 }}
              className="w-24 h-24 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center mx-auto"
            >
              <Gift className="w-12 h-12 text-primary-foreground" />
            </motion.div>

            <div>
              <h3 className="text-2xl font-bold text-foreground mb-2">Giveaway Created! 🎉</h3>
              <p className="text-muted-foreground">Share the code or link with your people</p>
            </div>

            <div className="p-6 rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 border border-primary/30">
              <p className="text-sm text-muted-foreground mb-2">Giveaway Code</p>
              <p className="text-4xl font-black text-primary tracking-widest">
                {createdGiveaway?.code}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(createdGiveaway?.code || '');
                }}
                className="h-12 rounded-xl"
              >
                Copy Code
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(`https://doings.app/redeem/${createdGiveaway?.code}`);
                }}
                className="h-12 rounded-xl"
              >
                Copy Link
              </Button>
            </div>

            <Button
              onClick={handleClose}
              className="w-full h-14 rounded-2xl bg-primary text-primary-foreground font-bold"
            >
              Done
            </Button>
          </motion.div>
        );
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={handleClose}>
      <SheetContent
        side="bottom"
        className="flex h-[85dvh] max-h-[85dvh] flex-col overflow-hidden rounded-t-3xl bg-background"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Create Giveaway</SheetTitle>
        </SheetHeader>
        <div className="mx-auto mb-4 h-1 w-12 shrink-0 rounded-full bg-muted" />
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch]">
          <AnimatePresence mode="sync">{renderStep()}</AnimatePresence>
        </div>
      </SheetContent>
    </Sheet>
  );
};
