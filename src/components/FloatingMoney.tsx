import { useEffect, useRef } from "react";
import gsap from "gsap";

interface FloatingMoneyProps {
  count?: number;
}

export const FloatingMoney = ({ count = 20 }: FloatingMoneyProps) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const particles = containerRef.current.querySelectorAll(".money-particle");
    
    particles.forEach((particle, i) => {
      gsap.set(particle, {
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        rotation: Math.random() * 360,
        scale: 0.3 + Math.random() * 0.7,
        opacity: 0.1 + Math.random() * 0.3,
      });

      gsap.to(particle, {
        y: "-=100",
        rotation: "+=180",
        duration: 4 + Math.random() * 4,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
        delay: i * 0.2,
      });

      gsap.to(particle, {
        x: `+=${-50 + Math.random() * 100}`,
        duration: 3 + Math.random() * 3,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
        delay: i * 0.1,
      });
    });

    return () => {
      gsap.killTweensOf(particles);
    };
  }, []);

  return (
    <div ref={containerRef} className="fixed inset-0 pointer-events-none overflow-hidden z-0">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="money-particle absolute text-2xl md:text-4xl"
          style={{ filter: "blur(1px)" }}
        >
          {i % 3 === 0 ? "💵" : i % 3 === 1 ? "🪙" : "💰"}
        </div>
      ))}
    </div>
  );
};
