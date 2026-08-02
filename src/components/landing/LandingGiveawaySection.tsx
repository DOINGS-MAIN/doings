import { Gift, QrCode, Share2, Wallet } from "lucide-react";
import { motion } from "framer-motion";
import { landingImages, landingScreenMock } from "@/lib/landingImages";

const GIVEAWAY_STEPS = [
  {
    icon: Share2,
    title: "Anyone in the room drops",
    body: "Host or guest — set the total, per-person amount, and spots. Doings generates a redeem code.",
  },
  {
    icon: QrCode,
    title: "Show it on the screen",
    body: "The QR and code appear on the projector so everyone in the hall can scan.",
  },
  {
    icon: Wallet,
    title: "Guests redeem to wallet",
    body: "They tap the link, claim their share, and the money lands in their Doings wallet instantly.",
  },
] as const;

export function LandingGiveawaySection() {
  const { giveaway } = landingScreenMock;

  return (
    <section id="giveaways" className="bg-[#0f1016] py-20 md:py-28">
      <div className="container">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          <motion.div
            className="relative landing-reveal"
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.55 }}
          >
            <div className="relative aspect-[4/5] rounded-[2rem] overflow-hidden">
              <img
                src={landingImages.giveaway.host}
                alt={landingImages.giveaway.alt}
                className="w-full h-full object-cover"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
            </div>

            {/* Giveaway card overlay — mirrors projector UI */}
            <div className="absolute bottom-6 left-6 right-6 md:bottom-10 md:left-10 md:right-auto md:max-w-sm rounded-2xl border border-primary/35 bg-black/75 backdrop-blur-md p-4 shadow-2xl">
              <div className="flex gap-3 items-start">
                <div className="shrink-0 rounded-xl bg-white p-2">
                  <div className="w-16 h-16 md:w-20 md:h-20 bg-[repeating-linear-gradient(45deg,#111_0,#111_2px,#222_2px,#222_4px)] rounded-md flex items-center justify-center">
                    <QrCode className="w-8 h-8 text-black/70" />
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Gift className="w-4 h-4 text-primary shrink-0" />
                    <p className="font-bold text-white truncate">{giveaway.title}</p>
                  </div>
                  <p className="text-primary font-semibold text-sm md:text-base">
                    Scan to redeem · {giveaway.amount}
                  </p>
                  <p className="text-white/55 text-xs mt-1">
                    Code {giveaway.code} · {giveaway.spotsLeft} spots left
                  </p>
                </div>
              </div>
            </div>
          </motion.div>

          <motion.div
            className="space-y-8 landing-reveal"
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.55, delay: 0.08 }}
          >
            <div>
              <p className="text-primary font-semibold mb-2">Giveaways & drops</p>
              <h2 className="landing-display text-5xl md:text-6xl text-white uppercase leading-none">
                Drop cash.
                <span className="block text-primary">Guests redeem live.</span>
              </h2>
              <p className="mt-5 text-lg text-white/70 leading-relaxed max-w-lg">
                Hosts and guests can run money drops during a live event — birthday surprises, owambe hype,
                or thank-you gifts. The code shows on the big screen; everyone scans and cash hits
                their wallet.
              </p>
            </div>

            <ul className="space-y-5">
              {GIVEAWAY_STEPS.map((step) => (
                <li key={step.title} className="flex gap-4">
                  <div className="shrink-0 w-11 h-11 rounded-xl bg-primary/15 flex items-center justify-center">
                    <step.icon className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-bold text-white text-lg">{step.title}</h3>
                    <p className="text-white/65 leading-relaxed">{step.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
