import { motion } from "framer-motion";
import { Trophy } from "lucide-react";
import heroAvatar from "@/assets/hero-avatar.png";
import { landingImages, landingScreenMock } from "@/lib/landingImages";
import { cn } from "@/lib/utils";

function MoneyRain() {
  const notes = ["₦", "₦", "₦", "₦", "₦", "₦"];
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {notes.map((note, i) => (
        <span
          key={i}
          className="absolute text-primary/80 text-lg font-bold landing-money-fall"
          style={{
            left: `${12 + i * 14}%`,
            animationDelay: `${i * 0.35}s`,
          }}
        >
          {note}
        </span>
      ))}
    </div>
  );
}

/** Projector screen mock composited over a Nigerian event photo. */
export function LandingProjectorShowcase({ className }: { className?: string }) {
  const { eventName, liveSpray, leaderboard } = landingScreenMock;

  return (
    <div className={cn("relative overflow-hidden rounded-[1.75rem] md:rounded-[2rem]", className)}>
      <img
        src={landingImages.projectorVenue.src}
        alt={landingImages.projectorVenue.alt}
        className="absolute inset-0 w-full h-full object-cover"
        loading="lazy"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-black/30" />

      {/* Projector screen */}
      <div className="relative z-10 p-4 md:p-8 lg:p-10 min-h-[420px] md:min-h-[480px] flex flex-col justify-end">
        <div className="mx-auto w-full max-w-4xl">
          <div className="mb-3 flex items-center justify-between text-xs md:text-sm text-white/60 px-1">
            <span>{landingImages.projectorVenue.location} · Live event</span>
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
              LIVE
            </span>
          </div>

          <div
            className="relative overflow-hidden rounded-xl md:rounded-2xl border border-white/20 bg-black shadow-[0_24px_80px_rgba(0,0,0,0.65)] aspect-[16/10]"
            role="img"
            aria-label="Doings projector screen showing a live spray and leaderboard at a Nigerian owambe"
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,hsl(43_96%_56%/0.18),transparent_60%)]" />

            <div className="relative flex h-full">
              {/* Main stage — spray happening */}
              <div className="relative flex flex-1 flex-col items-center justify-center p-4 md:p-6">
                <MoneyRain />
                <p className="text-[10px] md:text-xs font-semibold uppercase tracking-widest text-primary mb-2">
                  {eventName}
                </p>
                <img
                  src={heroAvatar}
                  alt=""
                  className="w-24 md:w-36 h-auto drop-shadow-[0_0_40px_hsl(43_96%_56%/0.45)] mb-3"
                />
                <motion.div
                  className="rounded-full bg-primary/20 border border-primary/40 px-4 py-2 text-center"
                  animate={{ scale: [1, 1.04, 1] }}
                  transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                >
                  <p className="text-white font-bold text-sm md:text-base">
                    {liveSpray.name} sprayed {liveSpray.amount}
                  </p>
                </motion.div>
              </div>

              {/* Leaderboard panel */}
              <aside className="hidden sm:flex w-[38%] max-w-[220px] flex-col border-l border-white/10 bg-black/55 backdrop-blur-sm p-3 md:p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Trophy className="w-4 h-4 text-primary" />
                  <p className="text-xs font-bold text-white uppercase tracking-wide">Top sprayers</p>
                </div>
                <ul className="space-y-2 flex-1">
                  {leaderboard.map((row) => (
                    <li
                      key={row.rank}
                      className={cn(
                        "rounded-lg px-2 py-2 text-xs md:text-sm",
                        row.rank === 1 ? "bg-primary/15 border border-primary/30" : "bg-white/5"
                      )}
                    >
                      <div className="flex justify-between gap-2">
                        <span className="text-white/90 font-medium truncate">
                          #{row.rank} {row.name}
                        </span>
                        <span className="text-primary font-bold shrink-0">{row.amount}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </aside>
            </div>
          </div>

          {/* Phone spraying */}
          <div className="absolute -bottom-2 right-2 md:right-6 w-[38%] max-w-[160px] md:max-w-[190px] rotate-3 shadow-2xl rounded-[1.25rem] overflow-hidden ring-2 ring-white/20">
            <div className="bg-[#12141a] p-3">
              <p className="text-[10px] text-white/50 mb-1">Available to spray</p>
              <p className="text-primary font-bold text-sm mb-3">NGN 285,000</p>
              <div className="rounded-xl bg-primary text-primary-foreground text-center py-2 text-xs font-bold">
                Spray live
              </div>
              <p className="text-[9px] text-white/40 mt-2 text-center">Doings · {eventName}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
