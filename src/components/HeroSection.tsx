import { useEffect, useRef } from "react";
import gsap from "gsap";
import { motion } from "framer-motion";
import heroAvatar from "@/assets/hero-avatar.png";

export const HeroSection = () => {
  const avatarRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const subtitleRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      // Avatar entrance animation
      gsap.from(avatarRef.current, {
        scale: 0.5,
        opacity: 0,
        y: 100,
        duration: 1.2,
        ease: "back.out(1.7)",
      });

      // Title animation
      gsap.from(titleRef.current, {
        y: 50,
        opacity: 0,
        duration: 0.8,
        delay: 0.3,
        ease: "power3.out",
      });

      // Subtitle animation
      gsap.from(subtitleRef.current, {
        y: 30,
        opacity: 0,
        duration: 0.8,
        delay: 0.5,
        ease: "power3.out",
      });

      // Floating animation for avatar
      gsap.to(avatarRef.current, {
        y: -15,
        duration: 2,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
        delay: 1.2,
      });
    });

    return () => ctx.revert();
  }, []);

  return (
    <section className="relative flex flex-col items-center justify-center px-6 pt-8 pb-16">
      {/* Glow effect behind avatar */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-primary/20 rounded-full blur-3xl pointer-events-none" />
      
      {/* Avatar */}
      <motion.div
        ref={avatarRef}
        className="relative z-10 mb-6"
        whileHover={{ scale: 1.05 }}
        transition={{ type: "spring", stiffness: 300 }}
      >
        <div className="relative">
          <img
            src={heroAvatar}
            alt="Doings Avatar"
            className="w-64 h-auto drop-shadow-2xl"
          />
          {/* Coin spray effect */}
          <motion.div
            className="absolute -top-4 -right-4 text-4xl"
            animate={{
              y: [-5, -20, -5],
              rotate: [0, 15, 0],
              opacity: [0.8, 1, 0.8],
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          >
            🪙
          </motion.div>
          <motion.div
            className="absolute top-8 -left-6 text-3xl"
            animate={{
              y: [-5, -15, -5],
              rotate: [0, -10, 0],
              opacity: [0.6, 1, 0.6],
            }}
            transition={{
              duration: 2.5,
              repeat: Infinity,
              ease: "easeInOut",
              delay: 0.3,
            }}
          >
            💵
          </motion.div>
        </div>
      </motion.div>

      {/* Title */}
      <h1
        ref={titleRef}
        className="text-4xl md:text-5xl font-black text-center mb-4"
      >
        <span className="text-gradient-gold glow-text">Spray</span>
        <span className="text-foreground"> the Vibe</span>
      </h1>

      {/* Subtitle */}
      <p
        ref={subtitleRef}
        className="text-muted-foreground text-center text-lg md:text-xl max-w-md leading-relaxed"
      >
        Digital money rain at your fingertips. Create unforgettable moments at every celebration.
      </p>
    </section>
  );
};
