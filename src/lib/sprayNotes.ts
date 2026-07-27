const DENOM_STYLES: Record<number, { gradient: string; label: string }> = {
  200: { gradient: "from-emerald-600 to-green-900", label: "₦200" },
  500: { gradient: "from-violet-600 to-purple-900", label: "₦500" },
  1000: { gradient: "from-amber-500 to-yellow-700", label: "₦1K" },
};

export function formatSprayDenomination(denomination: number): string {
  if (denomination === 1000) return "₦1K";
  return `₦${denomination.toLocaleString()}`;
}

export function getSprayDenominationStyle(denomination: number) {
  return DENOM_STYLES[denomination] ?? {
    gradient: "from-emerald-600 to-green-900",
    label: formatSprayDenomination(denomination),
  };
}

/** Build a DOM bill node for GSAP rain (no React root needed) */
export function createSprayBillElement(denomination: number, size: "sm" | "md" | "lg" = "lg"): HTMLDivElement {
  const style = getSprayDenominationStyle(denomination);
  const dims = { sm: [56, 28], md: [72, 36], lg: [96, 48] }[size];

  const el = document.createElement("div");
  el.className = `pointer-events-none select-none relative flex items-center justify-center rounded-sm border border-white/25 bg-gradient-to-br font-black text-white shadow-lg shadow-black/30 ${style.gradient}`;
  el.style.width = `${dims[0]}px`;
  el.style.height = `${dims[1]}px`;
  el.style.fontSize = size === "lg" ? "14px" : "11px";
  el.style.position = "absolute";

  const label = document.createElement("span");
  label.className = "relative z-10 drop-shadow-sm";
  label.textContent = style.label;
  el.appendChild(label);

  const shine = document.createElement("div");
  shine.className = "pointer-events-none absolute inset-0 rounded-sm bg-gradient-to-tr from-white/20 via-transparent to-black/10";
  el.appendChild(shine);

  return el;
}
