import { useEffect } from "react";
import { Link, Navigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { LandingGiveawaySection } from "@/components/landing/LandingGiveawaySection";
import { LandingProjectorShowcase } from "@/components/landing/LandingProjectorShowcase";
import { useAuth } from "@/hooks/useAuth";
import { landingImages } from "@/lib/landingImages";
import { cn } from "@/lib/utils";

const EVENT_TYPES = [
  "Lagos owambe",
  "Abuja weddings",
  "Birthday drops",
  "Live DJ nights",
  "Corporate events",
  "After-party",
];

const STEPS = [
  {
    title: "Join the event",
    body: "Scan the QR at the venue or open the WhatsApp link. Works in your browser — no app download.",
    image: landingImages.steps.join,
    imageAlt: "Guests at an African wedding celebration",
    location: "Nigeria",
  },
  {
    title: "Fund your wallet",
    body: "Add NGN by bank transfer. You control your balance before you spray or redeem a drop.",
    image: landingImages.steps.fund,
    imageAlt: "Yellow danfo bus on a Lagos street",
    location: "Lagos, Nigeria",
  },
  {
    title: "Spray on the projector",
    body: "Pick who you are celebrating. Your name and amount hit the event screen — the hall reacts.",
    image: landingImages.steps.spray,
    imageAlt: "Wedding guests dancing at a Nigerian reception",
    location: "Nigeria",
  },
  {
    title: "Redeem giveaway drops",
    body: "When the host runs a drop, scan the code on the screen. Your share lands in your wallet.",
    image: landingImages.steps.giveaway,
    imageAlt: "Guest at a Nigerian celebration",
    location: "Nigeria",
  },
] as const;

const FAQ = [
  {
    question: "What is spraying?",
    answer:
      "Spraying is celebrating someone with money at a live event — on the dance floor, at an owambe, during a performance. Doings does it digitally and shows your name on the projector.",
  },
  {
    question: "How do giveaways work?",
    answer:
      "A host creates a drop with a total amount and per-person share. The QR code appears on the event screen. Guests scan, redeem, and the money goes to their Doings wallet.",
  },
  {
    question: "Is my money safe?",
    answer:
      "Yes. Payments run through verified partners, every spray and redemption is logged, and unused balance stays in your wallet until you withdraw.",
  },
  {
    question: "Do I need to download an app?",
    answer:
      "No. Open the event link on your phone, sign up once, and you can spray or redeem from the browser.",
  },
  {
    question: "Can people join from abroad?",
    answer:
      "Yes. Share the event link and guests abroad can spray or join drops — it still shows on the screen in the hall.",
  },
] as const;

const fadeUp = {
  hidden: { opacity: 0, y: 28 },
  visible: { opacity: 1, y: 0 },
};

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
}

function LandingImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={cn("landing-photo", className)}
    />
  );
}

export default function LandingPage() {
  const { initialized, loading, isAuthenticated } = useAuth();

  useEffect(() => {
    document.title = "Doings — Spray & giveaways at Nigerian events";
  }, []);

  if (!initialized || loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/home" replace />;
  }

  return (
    <div className="landing-page min-h-dvh bg-[#0a0b0f] text-foreground overflow-x-hidden">
      <header className="fixed top-0 inset-x-0 z-50 bg-gradient-to-b from-black/70 to-transparent">
        <div className="container flex h-16 md:h-20 items-center justify-between">
          <Link to="/" className="landing-display text-3xl text-primary tracking-wide">
            DOINGS
          </Link>
          <nav className="hidden md:flex items-center gap-8 text-sm text-white/70">
            <button type="button" onClick={() => scrollTo("screen")} className="hover:text-white transition-colors">
              Live screen
            </button>
            <button type="button" onClick={() => scrollTo("giveaways")} className="hover:text-white transition-colors">
              Giveaways
            </button>
            <button type="button" onClick={() => scrollTo("how")} className="hover:text-white transition-colors">
              How it works
            </button>
          </nav>
          <Button asChild variant="gold" size="sm" className="rounded-full px-5">
            <Link to="/login">
              Get started
              <ArrowRight className="w-4 h-4" />
            </Link>
          </Button>
        </div>
      </header>

      <main>
        {/* Hero — Nigerian wedding photo */}
        <section className="relative min-h-[92dvh] flex items-end">
          <div className="absolute inset-0">
            <LandingImage
              src={landingImages.heroMain.src}
              alt={landingImages.heroMain.alt}
              className="scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0a0b0f] via-[#0a0b0f]/80 to-[#0a0b0f]/35" />
            <div className="absolute inset-0 bg-gradient-to-r from-[#0a0b0f]/95 via-[#0a0b0f]/50 to-transparent" />
          </div>

          <div className="landing-grain relative container pb-12 md:pb-20 pt-28 w-full">
            <div className="grid lg:grid-cols-2 gap-10 lg:gap-14 items-end">
              <motion.div
                className="space-y-6 landing-reveal"
                initial="hidden"
                animate="visible"
                variants={fadeUp}
                transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              >
                <p className="text-primary font-semibold text-sm md:text-base">
                  {landingImages.heroMain.location} · Spray · Giveaways · Live screen
                </p>
                <h1 className="landing-display text-[clamp(3rem,10vw,6rem)] text-white uppercase">
                  Spray at the owambe.
                  <span className="block text-primary">Watch it hit the screen.</span>
                </h1>
                <p className="text-lg md:text-xl text-white/80 max-w-xl leading-relaxed">
                  Doings is for Nigerian events — weddings, birthdays, and live shows. Guests spray
                  from their phones, hosts run giveaway drops, and everything shows on the projector
                  with your name on the projector, top sprayers on screen, and giveaway drops.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 pt-2">
                  <Button asChild variant="hero" size="lg" className="rounded-full">
                    <Link to="/login">
                      Create free account
                      <ArrowRight className="w-5 h-5" />
                    </Link>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    className="rounded-full border-white/25 text-white hover:bg-white/10"
                    onClick={() => scrollTo("screen")}
                  >
                    See the live screen
                  </Button>
                </div>
              </motion.div>

              <motion.div
                className="hidden lg:block relative h-[420px] landing-reveal"
                initial={{ opacity: 0, x: 40 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.8, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
              >
                <div className="absolute right-0 top-0 w-[68%] h-[85%] rounded-[2rem] overflow-hidden shadow-2xl ring-1 ring-white/15 rotate-2">
                  <LandingImage src={landingImages.heroOwambe.src} alt={landingImages.heroOwambe.alt} />
                </div>
                <div className="absolute left-0 bottom-0 w-[55%] h-[55%] rounded-[1.5rem] overflow-hidden shadow-2xl ring-1 ring-white/15 -rotate-3">
                  <LandingImage src={landingImages.heroInset.src} alt={landingImages.heroInset.alt} />
                </div>
                <div className="absolute right-[6%] bottom-[8%] glass rounded-2xl px-4 py-3 max-w-[210px]">
                  <p className="text-xs text-primary font-semibold">Live on projector</p>
                  <p className="text-sm text-white/90 mt-1">Zara sprayed ₦50,000</p>
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* Live projector + spraying */}
        <section id="screen" className="container py-20 md:py-28">
          <div className="grid lg:grid-cols-5 gap-10 lg:gap-14 items-end mb-10 md:mb-12">
            <div className="lg:col-span-2 space-y-4">
              <h2 className="landing-display text-5xl md:text-6xl text-white uppercase leading-none">
                The projector
                <span className="text-primary block">is the point</span>
              </h2>
              <p className="text-lg text-white/70 leading-relaxed">
                Every spray animates on the event screen — avatar, amount, and name. Top sprayers
                for this event stay visible on the right as totals update.
              </p>
            </div>
          </div>
          <motion.div
            className="landing-reveal"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={fadeUp}
          >
            <LandingProjectorShowcase className="min-h-[440px] md:min-h-[520px]" />
          </motion.div>
        </section>

        {/* Event types marquee */}
        <div className="border-y border-white/10 bg-[#0f1016] py-4 overflow-hidden">
          <div className="flex gap-10 landing-marquee whitespace-nowrap w-max">
            {[...EVENT_TYPES, ...EVENT_TYPES].map((label, i) => (
              <span key={`${label}-${i}`} className="text-white/50 text-sm md:text-base font-medium">
                {label}
                <span className="text-primary mx-10">✦</span>
              </span>
            ))}
          </div>
        </div>

        {/* Story */}
        <section className="container py-20 md:py-28">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <motion.div
              className="relative aspect-[4/5] rounded-[2rem] overflow-hidden landing-reveal"
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-80px" }}
              variants={fadeUp}
            >
              <LandingImage src={landingImages.story.src} alt={landingImages.story.alt} />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
              <span className="absolute bottom-4 left-4 text-xs font-medium text-white/80 bg-black/50 px-3 py-1 rounded-full">
                {landingImages.story.location}
              </span>
            </motion.div>
            <motion.div
              className="space-y-6 landing-reveal"
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-80px" }}
              variants={fadeUp}
              transition={{ delay: 0.1 }}
            >
              <h2 className="landing-display text-5xl md:text-6xl text-white uppercase">
                Same spraying culture,
                <span className="text-primary block">now on screen</span>
              </h2>
              <p className="text-lg text-white/75 leading-relaxed max-w-lg">
                You already know the energy — cash on the dance floor, the MC calling names, the
                crowd reacting. Doings keeps that feeling and adds a wallet, a projector view, and
                giveaway drops anyone can redeem.
              </p>
              <blockquote className="border-l-2 border-primary pl-5 text-white/90 italic text-lg">
                &ldquo;It feels like spraying at an owambe — but the whole hall sees your name on
                the screen.&rdquo;
              </blockquote>
            </motion.div>
          </div>
        </section>

        <LandingGiveawaySection />

        {/* How it works */}
        <section id="how" className="py-20 md:py-28">
          <div className="container">
            <div className="max-w-2xl mb-16">
              <h2 className="landing-display text-5xl md:text-6xl text-white uppercase mb-4">
                From WhatsApp link to screen
              </h2>
              <p className="text-white/65 text-lg">
                Spray, redeem drops, and climb the top sprayers board — on the projector and in the app.
              </p>
            </div>
            <div className="space-y-16 md:space-y-20">
              {STEPS.map((step, index) => (
                <motion.div
                  key={step.title}
                  className={cn(
                    "grid md:grid-cols-2 gap-8 md:gap-14 items-center landing-reveal",
                    index % 2 === 1 && "md:[direction:rtl] md:[&>*]:![direction:ltr]"
                  )}
                  initial="hidden"
                  whileInView="visible"
                  viewport={{ once: true, margin: "-60px" }}
                  variants={fadeUp}
                >
                  <div className="relative aspect-[4/3] rounded-[1.75rem] overflow-hidden">
                    <LandingImage src={step.image} alt={step.imageAlt} />
                    <span className="absolute top-4 left-4 landing-display text-6xl text-white/25">
                      0{index + 1}
                    </span>
                    <span className="absolute bottom-4 left-4 text-xs font-medium text-white/90 bg-black/55 px-3 py-1 rounded-full">
                      {step.location}
                    </span>
                  </div>
                  <div className="space-y-3">
                    <h3 className="text-2xl md:text-3xl font-bold text-white">{step.title}</h3>
                    <p className="text-white/70 text-lg leading-relaxed">{step.body}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Photo mosaic — Nigeria */}
        <section className="bg-[#0f1016] py-20 md:py-28">
          <div className="container">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-12">
              <h2 className="landing-display text-5xl md:text-6xl text-white uppercase max-w-md">
                Built for Nigerian events
              </h2>
              <p className="text-white/65 max-w-sm text-lg">
                Owambe halls, wedding receptions, and live nights across the country.
              </p>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5">
              {landingImages.mosaic.map((item, i) => (
                <motion.figure
                  key={item.caption}
                  className={cn(
                    "relative overflow-hidden rounded-2xl md:rounded-3xl landing-reveal",
                    i === 0 && "col-span-2 row-span-2 aspect-square lg:aspect-auto lg:min-h-[420px]",
                    i !== 0 && "aspect-[4/5]"
                  )}
                  initial="hidden"
                  whileInView="visible"
                  viewport={{ once: true }}
                  variants={fadeUp}
                  transition={{ delay: i * 0.06 }}
                >
                  <LandingImage src={item.src} alt={item.alt} />
                  <figcaption className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black/85 to-transparent">
                    <span className="text-white font-semibold block">{item.caption}</span>
                    <span className="text-white/55 text-xs">{item.location}</span>
                  </figcaption>
                </motion.figure>
              ))}
            </div>
          </div>
        </section>

        {/* Voices */}
        <section className="container py-20 md:py-28">
          <h2 className="landing-display text-5xl md:text-6xl text-white uppercase mb-12">
            From the room
          </h2>
          <div className="grid md:grid-cols-3 gap-6 md:gap-8">
            {landingImages.voices.map((voice, i) => (
              <motion.blockquote
                key={voice.name}
                className="flex flex-col gap-5 landing-reveal"
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                variants={fadeUp}
                transition={{ delay: i * 0.08 }}
              >
                <div className="flex items-center gap-4">
                  <img
                    src={voice.portrait}
                    alt=""
                    className="w-14 h-14 rounded-full object-cover ring-2 ring-primary/40"
                  />
                  <div>
                    <p className="font-semibold text-white">{voice.name}</p>
                    <p className="text-sm text-white/55">{voice.role}</p>
                  </div>
                </div>
                <p className="text-white/80 text-lg leading-relaxed">&ldquo;{voice.quote}&rdquo;</p>
              </motion.blockquote>
            ))}
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="bg-[#0f1016] py-20 md:py-28">
          <div className="container max-w-3xl">
            <h2 className="landing-display text-5xl text-white uppercase mb-8">Before you spray</h2>
            <Accordion type="single" collapsible className="w-full">
              {FAQ.map((item) => (
                <AccordionItem key={item.question} value={item.question} className="border-white/10">
                  <AccordionTrigger className="text-left text-lg text-white hover:no-underline">
                    {item.question}
                  </AccordionTrigger>
                  <AccordionContent className="text-white/65 text-base leading-relaxed">
                    {item.answer}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </section>

        {/* CTA */}
        <section className="relative py-24 md:py-32 overflow-hidden">
          <div className="absolute inset-0">
            <LandingImage src={landingImages.cta.src} alt={landingImages.cta.alt} />
            <div className="absolute inset-0 bg-[#0a0b0f]/85" />
          </div>
          <div className="relative container text-center max-w-2xl mx-auto space-y-8">
            <h2 className="landing-display text-5xl md:text-7xl text-white uppercase">
              Your next owambe is waiting
            </h2>
            <p className="text-white/75 text-lg">
              Sign up free. Join with a code. Spray and redeem drops when the DJ drops.
            </p>
            <Button asChild variant="hero" size="xl" className="rounded-full">
              <Link to="/login">
                Get started
                <ArrowRight className="w-5 h-5" />
              </Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 py-10 bg-[#0a0b0f]">
        <div className="container flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-white/45">
          <span className="landing-display text-2xl text-primary">DOINGS</span>
          <a href="mailto:support@doingsapp.com" className="hover:text-white transition-colors">
            support@doingsapp.com
          </a>
          <span>© {new Date().getFullYear()} Doings · Nigeria</span>
        </div>
      </footer>
    </div>
  );
}
