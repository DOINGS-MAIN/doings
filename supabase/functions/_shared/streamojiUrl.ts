/**
 * True for a plain https address on streamoji.com, one of its subdomains, or Google's public file hosts. The avatar "store" step
 * downloads a preview address sent by the client; without this the server would fetch any address it
 * was given (including internal ones) and host the result publicly.
 */
/** Public file hosts Streamoji (a Firebase project) may serve pictures from. Not internal addresses. */
const STORAGE_HOSTS = new Set(["firebasestorage.googleapis.com", "storage.googleapis.com"]);

export function isStreamojiUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username !== "" || url.password !== "") return false;
  const host = url.hostname.toLowerCase();
  return host === "streamoji.com" || host.endsWith(".streamoji.com") || STORAGE_HOSTS.has(host);
}
