export function getEventScreenPath(eventId: string, embed?: boolean): string {
  const path = `/events/${eventId}/screen`;
  return embed ? `${path}?embed=1` : path;
}

export function getPublicWatchPath(eventCode: string, embed?: boolean): string {
  const code = eventCode.trim().toUpperCase();
  const path = `/watch/${encodeURIComponent(code)}`;
  return embed ? `${path}?embed=1` : path;
}

export function getProjectorPath(
  event: { id: string; eventCode: string; isPrivate: boolean },
  embed?: boolean,
): string {
  if (event.isPrivate) return getEventScreenPath(event.id, embed);
  return getPublicWatchPath(event.eventCode, embed);
}

export function isEmbedMode(search: string): boolean {
  const value = new URLSearchParams(search).get("embed")?.toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}
