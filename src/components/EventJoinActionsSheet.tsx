import { motion } from "framer-motion";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Gift, Zap } from "lucide-react";
import { EventData } from "@/hooks/useEvents";

interface EventJoinActionsSheetProps {
  isOpen: boolean;
  onClose: () => void;
  event: EventData;
  onSpray: () => void;
  onDropGiveaway: () => void;
}

export const EventJoinActionsSheet = ({
  isOpen,
  onClose,
  event,
  onSpray,
  onDropGiveaway,
}: EventJoinActionsSheetProps) => {
  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="bottom"
        className="flex flex-col overflow-hidden rounded-t-3xl bg-background"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Join {event.title}</SheetTitle>
        </SheetHeader>
        <div className="mx-auto mb-4 h-1 w-12 shrink-0 rounded-full bg-muted" />

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6 pb-6"
        >
          <div className="text-center">
            <div
              className={`mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br ${event.gradient} text-3xl`}
            >
              {event.emoji}
            </div>
            <h3 className="text-xl font-bold text-foreground">You&apos;re in!</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {event.title} is live — spray the host or drop a giveaway for everyone.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3">
            <Button
              onClick={onSpray}
              className="h-14 rounded-2xl bg-gradient-to-r from-primary to-accent text-lg font-bold"
            >
              <Zap className="mr-2 h-5 w-5" />
              Spray the host
            </Button>
            <Button
              variant="outline"
              onClick={onDropGiveaway}
              className="h-14 rounded-2xl text-lg font-bold"
            >
              <Gift className="mr-2 h-5 w-5" />
              Drop a giveaway
            </Button>
          </div>

          <p className="text-center text-xs text-muted-foreground">
            Giveaways show on the event screen — guests scan or enter your code to redeem.
          </p>
        </motion.div>
      </SheetContent>
    </Sheet>
  );
};
