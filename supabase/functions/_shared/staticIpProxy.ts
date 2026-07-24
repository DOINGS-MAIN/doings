/**
 * Optional Static IP Relay for provider APIs that require an allowlisted egress IP.
 *
 * Preferred on Supabase Edge (HTTP CONNECT on :3128 — works; SOCKS :1080 often does not):
 *   STATIC_IP_PROXY_URL=http://HOST.staticiprelay.com:3128
 *   STATIC_IP_PROXY_USER=…
 *   STATIC_IP_PROXY_PASSWORD=…
 *   (or embed user:pass in the URL — we still parse into Deno basicAuth)
 *
 * Hostname-swap fallback:
 *   BLOCKRADAR_BASE_URL=https://abcd.staticiprelay.com
 *
 * SOCKS5 only if STATIC_IP_USE_SOCKS=true (often Host unreachable on Edge).
 */

let cachedProxyClient: Deno.HttpClient | null | undefined;
let cachedProxyFingerprint: string | null = null;

function proxyConfigFingerprint(): string {
  return [
    Deno.env.get("STATIC_IP_PROXY_URL") || "",
    Deno.env.get("STATIC_IP_PROXY_USER") || "",
    Deno.env.get("STATIC_IP_PROXY_PASSWORD") || "",
  ].join("\0");
}

/** Match Keyraso: clean proxy URL + Deno basicAuth (required for HTTP CONNECT). */
export function parseStaticIpProxy(): Deno.Proxy | null {
  const raw = Deno.env.get("STATIC_IP_PROXY_URL")?.trim();
  if (!raw) return null;

  // Hostname-swap relays are not CONNECT endpoints.
  if (
    /^https?:\/\/[^/]+\.staticiprelay\.com\/?$/i.test(raw) &&
    !raw.includes("@") &&
    !/:\d+$/.test(raw.replace(/\/$/, ""))
  ) {
    return null;
  }

  const explicitUser = Deno.env.get("STATIC_IP_PROXY_USER")?.trim();
  const explicitPass = Deno.env.get("STATIC_IP_PROXY_PASSWORD")?.trim();
  const normalized = /^(https?|socks5):\/\//i.test(raw) ? raw : `http://${raw}`;

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return null;
  }

  const transport =
    parsed.protocol === "socks5:" ? "socks5" :
    parsed.protocol === "https:" ? "https" : "http";

  const username = explicitUser || decodeURIComponent(parsed.username);
  const password = explicitPass || decodeURIComponent(parsed.password);
  // Trailing slash matches Deno proxy examples; no credentials in URL.
  const hostUrl =
    `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}/`;

  if (username && password) {
    return { transport, url: hostUrl, basicAuth: { username, password } };
  }
  return { transport, url: hostUrl };
}

/** Safe diagnostics — never returns full password. */
export function getStaticIpProxyDiagnostics(): Record<string, unknown> {
  const raw = Deno.env.get("STATIC_IP_PROXY_URL")?.trim() || "";
  const explicitUser = Deno.env.get("STATIC_IP_PROXY_USER")?.trim() || "";
  const explicitPass = Deno.env.get("STATIC_IP_PROXY_PASSWORD")?.trim() || "";
  const proxy = parseStaticIpProxy();

  let parsedHost = "";
  let parsedPort = "";
  let parsedTransport = "";
  let urlHasEmbeddedUser = false;
  try {
    const normalized = /^(https?|socks5):\/\//i.test(raw) ? raw : `http://${raw}`;
    const u = new URL(normalized);
    parsedHost = u.hostname;
    parsedPort = u.port;
    parsedTransport = u.protocol.replace(":", "");
    urlHasEmbeddedUser = Boolean(u.username);
  } catch {
    /* ignore */
  }

  const username =
    explicitUser ||
    (proxy && "basicAuth" in proxy ? proxy.basicAuth?.username : "") ||
    "";

  return {
    configured: Boolean(raw),
    parsedHost,
    parsedPort,
    parsedTransport,
    urlHasEmbeddedUser,
    explicitUserSet: Boolean(explicitUser),
    explicitPasswordSet: Boolean(explicitPass),
    usernameLength: username.length,
    passwordLength: (explicitPass || "").length ||
      (urlHasEmbeddedUser ? -1 : 0), // -1 = password only in URL (length unknown here)
    basicAuthConfigured: Boolean(
      proxy && "basicAuth" in proxy && proxy.basicAuth?.username && proxy.basicAuth?.password,
    ),
    resolvedTransport: proxy && "transport" in proxy ? proxy.transport : null,
    resolvedProxyUrl: proxy && "url" in proxy ? proxy.url : null,
    proxyActive: Boolean(proxy),
  };
}

function staticIpHttpClient(): Deno.HttpClient | undefined {
  const fingerprint = proxyConfigFingerprint();
  if (cachedProxyClient !== undefined && cachedProxyFingerprint === fingerprint) {
    return cachedProxyClient ?? undefined;
  }
  cachedProxyFingerprint = fingerprint;
  const proxy = parseStaticIpProxy();
  if (!proxy) {
    cachedProxyClient = null;
    return undefined;
  }
  cachedProxyClient = Deno.createHttpClient({ proxy });
  return cachedProxyClient;
}

export function staticIpFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  const client = staticIpHttpClient();
  return client ? fetch(url, { ...init, client }) : fetch(url, init);
}

export type EgressMode = "http_proxy" | "hostname_swap" | "socks" | "direct";

export function resolveEgress(apiDefaultBase: string, relayBaseEnv?: string): {
  baseUrl: string;
  useProxy: boolean;
  mode: EgressMode;
} {
  const defaultBase = apiDefaultBase.replace(/\/$/, "");
  const relayBase = (relayBaseEnv || "").trim().replace(/\/$/, "");
  const proxy = parseStaticIpProxy();
  const forceSocks = Deno.env.get("STATIC_IP_USE_SOCKS")?.trim() === "true";

  if (proxy && (proxy.transport === "http" || proxy.transport === "https")) {
    return { baseUrl: defaultBase, useProxy: true, mode: "http_proxy" };
  }

  if (proxy && proxy.transport === "socks5" && forceSocks) {
    return { baseUrl: defaultBase, useProxy: true, mode: "socks" };
  }

  if (relayBase && /\.staticiprelay\.com$/i.test((() => {
    try {
      return new URL(relayBase).hostname;
    } catch {
      return "";
    }
  })())) {
    return { baseUrl: relayBase, useProxy: false, mode: "hostname_swap" };
  }

  return { baseUrl: defaultBase, useProxy: false, mode: "direct" };
}

export function egressFetch(
  url: string,
  init: RequestInit | undefined,
  useProxy: boolean,
): Promise<Response> {
  if (useProxy) return staticIpFetch(url, init);
  return fetch(url, init);
}
