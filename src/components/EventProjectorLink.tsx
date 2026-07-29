import { motion } from "framer-motion";
import { Copy, ExternalLink, Tv } from "lucide-react";
import { toast } from "sonner";
import { buildProjectorShareLink } from "@/lib/shareLinks";
import { getProjectorPath } from "@/lib/eventScreenLink";

interface EventProjectorLinkProps {
  eventId: string;
  eventCode: string;
  /** Public events: anyone with the link can watch live sprays. */
  isPrivate?: boolean;
  variant?: "card" | "inline";
}

export function EventProjectorLink({
  eventId,
  eventCode,
  isPrivate = false,
  variant = "card",
}: EventProjectorLinkProps) {
  const shareEvent = { id: eventId, eventCode, isPrivate };
  const screenUrl = buildProjectorShareLink(shareEvent);
  const embedUrl = buildProjectorShareLink(shareEvent, { embed: true });
  const screenPath = getProjectorPath(shareEvent);

  const copyLink = async (url: string, label: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(`${label} copied!`);
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
          onClick={() => void copyLink(screenUrl, "Projector link")}
          className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-foreground"
          whileTap={{ scale: 0.98 }}
        >
          <Copy className="h-4 w-4" />
          Copy link
        </motion.button>
        {!isPrivate && (
          <motion.button
            type="button"
            onClick={() => void copyLink(embedUrl, "Embed link")}
            className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-foreground"
            whileTap={{ scale: 0.98 }}
          >
            <Copy className="h-4 w-4" />
            Copy embed
          </motion.button>
        )}
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
            {isPrivate
              ? "Host-only screen for your TV or projector — live sprayers with a join QR."
              : "Share the watch link with anyone — no login needed. Use embed link for iframe/TV overlays."}
          </p>
        </div>
      </div>

      <p className="mb-3 truncate rounded-lg bg-black/20 px-3 py-2 font-mono text-xs text-muted-foreground">
        {screenUrl}
      </p>

      <div className="flex flex-wrap gap-2">
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
          onClick={() => void copyLink(screenUrl, "Projector link")}
          className="flex items-center justify-center gap-2 rounded-xl bg-white/10 px-4 py-3 text-sm font-semibold text-foreground"
          whileTap={{ scale: 0.98 }}
          aria-label="Copy projector link"
        >
          <Copy className="h-4 w-4" />
        </motion.button>
        {!isPrivate && (
          <motion.button
            type="button"
            onClick={() => void copyLink(embedUrl, "Embed link")}
            className="flex items-center justify-center gap-2 rounded-xl bg-white/10 px-4 py-3 text-sm font-semibold text-foreground"
            whileTap={{ scale: 0.98 }}
            aria-label="Copy embed link"
          >
            <Copy className="h-4 w-4" />
            Embed
          </motion.button>
        )}
      </div>
    </div>
  );
}
