import { getSprayDenominationStyle } from "@/lib/sprayNotes";

interface SprayMoneyBillProps {
  denomination: number;
  className?: string;
  size?: "sm" | "md" | "lg";
}

const SIZE_CLASSES = {
  sm: "h-7 w-14 text-[9px]",
  md: "h-9 w-[4.5rem] text-[10px] md:text-xs",
  lg: "h-12 w-24 text-sm md:text-base",
};

/** Naira bill chip used in spray rain animations */
export function SprayMoneyBill({ denomination, className = "", size = "md" }: SprayMoneyBillProps) {
  const style = getSprayDenominationStyle(denomination);

  return (
    <div
      className={`relative flex shrink-0 items-center justify-center rounded-sm border border-white/25 bg-gradient-to-br font-black text-white shadow-lg shadow-black/30 ${style.gradient} ${SIZE_CLASSES[size]} ${className}`}
      aria-hidden
    >
      <span className="relative z-10 drop-shadow-sm">{style.label}</span>
      <div className="pointer-events-none absolute inset-0 rounded-sm bg-gradient-to-tr from-white/20 via-transparent to-black/10" />
    </div>
  );
}
