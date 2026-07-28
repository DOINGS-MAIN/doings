import { motion } from "framer-motion";
import QRCode from "react-qr-code";

interface EventScreenJoinQrProps {
  joinLink: string;
  eventCode: string;
  compact?: boolean;
}

/** Compact join QR — corner overlay on the projector. */
export function EventScreenJoinQr({ joinLink, eventCode, compact = true }: EventScreenJoinQrProps) {
  const qrSize = compact ? 72 : 120;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={
        compact
          ? "flex items-center gap-3 rounded-2xl border border-white/10 bg-black/55 px-3 py-2 backdrop-blur-md"
          : "flex flex-col items-center text-center"
      }
    >
      <div className={`shrink-0 rounded-lg bg-white ${compact ? "p-1.5" : "p-3"}`}>
        <QRCode value={joinLink} size={qrSize} level="M" />
      </div>
      <div className={compact ? "min-w-0 text-left" : "mt-3"}>
        {!compact && (
          <p className="mb-1 text-xs font-bold uppercase tracking-widest text-white/60">
            Scan to join & spray
          </p>
        )}
        {compact && (
          <p className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Join & spray</p>
        )}
        <p
          className={
            compact
              ? "font-mono text-lg font-black tracking-[0.2em] text-primary"
              : "font-mono text-3xl font-black tracking-[0.3em] text-primary"
          }
        >
          {eventCode}
        </p>
      </div>
    </motion.div>
  );
}
