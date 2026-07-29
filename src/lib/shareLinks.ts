/** Public app URL for share links (giveaways, events). */
export function getAppBaseUrl(): string {
  const fromEnv = (import.meta.env.VITE_APP_URL ?? "").trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  return "https://doings.app";
}

export function buildEventJoinLink(eventCode: string): string {
  const code = eventCode.trim().toUpperCase();
  return `${getAppBaseUrl()}/join/${encodeURIComponent(code)}`;
}

export function buildGiveawayRedeemLink(code: string): string {
  const normalized = code.trim().toUpperCase();
  return `${getAppBaseUrl()}/redeem/${encodeURIComponent(normalized)}`;
}

export function buildEventScreenLink(eventId: string, options?: { embed?: boolean }): string {
  const id = eventId.trim();
  const base = `${getAppBaseUrl()}/events/${encodeURIComponent(id)}/screen`;
  return options?.embed ? `${base}?embed=1` : base;
}

/** Short public watch URL — works without login for public live events. */
export function buildPublicWatchLink(eventCode: string, options?: { embed?: boolean }): string {
  const code = eventCode.trim().toUpperCase();
  const base = `${getAppBaseUrl()}/watch/${encodeURIComponent(code)}`;
  return options?.embed ? `${base}?embed=1` : base;
}

/** Prefer watch link for public events; host UUID link for private. */
export function buildProjectorShareLink(
  event: { id: string; eventCode: string; isPrivate: boolean },
  options?: { embed?: boolean },
): string {
  if (event.isPrivate) return buildEventScreenLink(event.id, options);
  return buildPublicWatchLink(event.eventCode, options);
}

export function buildEventSharePayload(event: { title: string; eventCode: string }) {
  const code = event.eventCode.trim().toUpperCase();
  const url = buildEventJoinLink(code);
  const text = `Join "${event.title}" on Doings! Event code: ${code}`;
  return { title: event.title, text, url, clipboard: `${text}\n${url}` };
}

export async function shareEventLink(event: { title: string; eventCode: string }): Promise<"shared" | "copied"> {
  const { title, text, url, clipboard } = buildEventSharePayload(event);

  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return "shared";
    } catch (err) {
      if ((err as Error).name === "AbortError") throw err;
    }
  }

  await navigator.clipboard.writeText(clipboard);
  return "copied";
}
