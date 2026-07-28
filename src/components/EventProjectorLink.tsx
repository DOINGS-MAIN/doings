import { motion } from "framer-motion";
import { Copy, ExternalLink, Tv } from "lucide-react";
import { toast } from "sonner";
import { buildEventScreenLink } from "@/lib/shareLinks";
import { getEventScreenPath } from "@/lib/eventScreenLink";

interface EventProjectorLinkProps {
  eventId: string;
  variant?: "card" | "inline";
}

export function EventProjectorLink({ eventId, variant = "card" }: EventProjectorLinkProps) {
  const screenUrl = buildEventScreenLink(eventId);
  const screenPath = getEventScreenPath(eventId);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(screenUrl);
      toast.success("Projector link copied!");
    } catch {
      toast.error("Could not copy link");
    }
  };

  const openProjector = () => {
    window.open(screenPath, "_blank", "noopener,noreferrer");
  };

  if (variant === "inline") {
    return (
      <div className="flex flex-wrap gap-2">
        <motion.button
          type="button"
          onClick={openProjector}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          whileTap={{ scale: 0.98 }}
        >
          <Tv className="h-4 w-4" />
          Open projector
        </motion.button>
        <motion.button
          type="button"
          onClick={() => void copyLink()}
          className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-foreground"
          whileTap={{ scale: 0.98 }}
        >
          <Copy className="h-4 w-4" />
          Copy link
        </motion.button>
      </div>
    );
  }

  return (
    <div className="glass rounded-2xl p-4">
      <div className="mb-3 flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent">
          <Tv className="h-6 w-6 text-primary-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-foreground">Projector screen</p>
          <p className="text-sm text-muted-foreground">
            Open on a TV or projector — live sprayers on the dance floor with a compact join QR.
          </p>
        </div>
      </div>

      <p className="mb-3 truncate rounded-lg bg-black/20 px-3 py-2 font-mono text-xs text-muted-foreground">
        {screenUrl}
      </p>

      <div className="flex gap-2">
        <motion.button
          type="button"
          onClick={openProjector}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-accent py-3 text-sm font-bold text-primary-foreground"
          whileTap={{ scale: 0.98 }}
        >
          <ExternalLink className="h-4 w-4" />
          Open projector
        </motion.button>
        <motion.button
          type="button"
          onClick={() => void copyLink()}
          className="flex items-center justify-center gap-2 rounded-xl bg-white/10 px-4 py-3 text-sm font-semibold text-foreground"
          whileTap={{ scale: 0.98 }}
          aria-label="Copy projector link"
        >
          <Copy className="h-4 w-4" />
        </motion.button>
      </div>
    </div>
  );
}
