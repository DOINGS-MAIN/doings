// True when the access token was issued from an emailed recovery or invite link — the only
// sessions allowed to set a password without confirming the current one.
export function cameFromEmailLink(accessToken: string | undefined): boolean {
  if (!accessToken) return false;
  try {
    const part = accessToken.split(".")[1];
    if (!part) return false;
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    const amr = (JSON.parse(json) as { amr?: { method?: string }[] }).amr ?? [];
    return amr.some((a) => a.method === "recovery" || a.method === "invite");
  } catch {
    return false;
  }
}
