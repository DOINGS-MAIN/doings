/**
 * Blockradar egress for Supabase Edge.
 *
 * Correct model for this stack (per Static IP Relay + Blockradar docs):
 *   1. Create an HTTP Relay in Static IP Relay with target:
 *        https://api.blockradar.co
 *   2. Set BLOCKRADAR_BASE_URL=https://YOUR_ID.staticiprelay.com
 *   3. Whitelist the relay's dedicated static IP in Blockradar → Developers
 *   4. Call paths as usual: `${BLOCKRADAR_BASE_URL}/v1/wallets/...`
 *
 * Plain HTTPS fetch on :443 — no SOCKS/HTTP CONNECT proxy.
 * (Advanced Proxy :3128 CONNECT fails on Edge with "unsuccessful tunnel";
 *  Keyraso SOCKS was for Monnify disbursement, not this API.)
 *
 * Opt-in only: BLOCKRADAR_USE_PROXY=true + STATIC_IP_PROXY_* for experiments.
 */
import { toBlockradarNetwork } from "./blockradarNetwork.ts";
import {
  getStaticIpProxyDiagnostics,
  staticIpFetch,
} from "./staticIpProxy.ts";

/** Official API host per https://docs.blockradar.co/en/introduction/api-tour */
const BLOCKRADAR_API_DEFAULT = "https://api.blockradar.co";

const BLOCKRADAR_API_KEY = Deno.env.get("BLOCKRADAR_API_KEY") ?? "";
const BLOCKRADAR_WALLET_ID = Deno.env.get("BLOCKRADAR_WALLET_ID") ?? "";

function resolveBaseUrl(): { baseUrl: string; mode: "hostname_swap" | "direct" | "proxy" } {
  const relay = (Deno.env.get("BLOCKRADAR_BASE_URL") ?? "").trim().replace(/\/$/, "");
  const useProxy = Deno.env.get("BLOCKRADAR_USE_PROXY")?.trim() === "true";

  if (useProxy) {
    return { baseUrl: BLOCKRADAR_API_DEFAULT, mode: "proxy" };
  }

  if (relay) {
    try {
      const host = new URL(relay).hostname;
      if (host.endsWith(".staticiprelay.com") || host.includes(".")) {
        return { baseUrl: relay, mode: host.endsWith(".staticiprelay.com") ? "hostname_swap" : "direct" };
      }
    } catch {
      /* fall through */
    }
  }

  return { baseUrl: BLOCKRADAR_API_DEFAULT, mode: "direct" };
}

const egress = resolveBaseUrl();

function blockradarFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = `${egress.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  if (egress.mode === "proxy") {
    return staticIpFetch(url, init);
  }
  // Hostname swap / direct: normal Edge HTTPS (port 443) — Static IP Relay's designed path
  return fetch(url, init);
}

function enrichError(error: unknown, res?: Response, bodyPreview?: string): Error {
  const msg = error instanceof Error
    ? error.message
    : res
    ? `Blockradar request failed: ${res.status} — ${bodyPreview ?? ""}`
    : String(error);

  const hints: string[] = [`mode=${egress.mode}`, `base=${egress.baseUrl}`];

  if (res?.status === 502 || /502/.test(msg)) {
    hints.push(
      "Static IP Relay nginx 502: recreate an HTTP relay with target exactly https://api.blockradar.co (not .io), confirm relay is Active, then set BLOCKRADAR_BASE_URL to https://YOUR_ID.staticiprelay.com",
    );
  }
  if (/unsuccessful tunnel|host unreachable/i.test(msg)) {
    hints.push(
      "Do not use Advanced Proxy CONNECT for Blockradar on Supabase Edge. Use hostname-swap (BLOCKRADAR_BASE_URL) instead; unset BLOCKRADAR_USE_PROXY",
    );
  }
  if (egress.mode === "direct") {
    hints.push(
      "Calling api.blockradar.co directly from Edge (dynamic IPs). If IP whitelist is on, set BLOCKRADAR_BASE_URL to your Static IP Relay hostname and allowlist that static IP in Blockradar → Developers",
    );
  }

  return new Error(`${msg.trim()} | ${hints.join(" | ")}`);
}

export async function generateDepositAddress(params: {
  userId: string;
  network?: string;
}): Promise<{
  address: string;
  network: string;
}> {
  const network = toBlockradarNetwork(params.network);
  let res: Response;
  try {
    // POST /v1/wallets/{walletId}/addresses — https://docs.blockradar.co/en/api-reference/addresses/generate-address
    res = await blockradarFetch(`/v1/wallets/${BLOCKRADAR_WALLET_ID}/addresses`, {
      method: "POST",
      headers: {
        "x-api-key": BLOCKRADAR_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: `DOINGS-${params.userId}`,
        metadata: { userId: params.userId, network },
      }),
    });
  } catch (error) {
    throw enrichError(error);
  }

  if (!res.ok) {
    const errBody = await res.text();
    const preview = errBody.replace(/\s+/g, " ").slice(0, 180);
    throw enrichError(null, res, preview);
  }

  const body = await res.json();
  const data = body.data ?? body;

  return {
    address: data.address,
    network: data.network ?? network,
  };
}

type WalletAssetRow = {
  id?: string;
  asset?: {
    id?: string;
    symbol?: string;
    blockchain?: { slug?: string; symbol?: string; name?: string };
  };
};

/**
 * Blockradar withdraw requires a wallet-specific asset UUID (`assetId`),
 * not a symbol like "USDC". Prefer BLOCKRADAR_USDC_ASSET_ID; else look it up.
 */
async function resolveUsdcAssetId(network: string): Promise<string> {
  const fromEnv = (Deno.env.get("BLOCKRADAR_USDC_ASSET_ID") ?? "").trim();
  if (fromEnv) return fromEnv;

  let res: Response;
  try {
    res = await blockradarFetch(`/v1/wallets/${BLOCKRADAR_WALLET_ID}/assets`, {
      method: "GET",
      headers: { "x-api-key": BLOCKRADAR_API_KEY },
    });
  } catch (error) {
    throw enrichError(error);
  }

  if (!res.ok) {
    const errBody = await res.text();
    const preview = errBody.replace(/\s+/g, " ").slice(0, 180);
    throw enrichError(null, res, preview);
  }

  const body = await res.json() as { data?: WalletAssetRow[] };
  const rows = Array.isArray(body.data) ? body.data : [];
  const net = network.toLowerCase();

  const match = rows.find((row) => {
    const symbol = (row.asset?.symbol ?? "").toUpperCase();
    if (symbol !== "USDC") return false;
    const slug = (row.asset?.blockchain?.slug ?? "").toLowerCase();
    const chainSym = (row.asset?.blockchain?.symbol ?? "").toLowerCase();
    const chainName = (row.asset?.blockchain?.name ?? "").toLowerCase();
    return (
      slug === net ||
      slug.includes(net) ||
      chainSym === net ||
      chainName.includes(net)
    );
  }) ?? rows.find((row) => (row.asset?.symbol ?? "").toUpperCase() === "USDC");

  // Wallet-asset binding id (preferred); fall back to nested asset.id
  const assetId = match?.id || match?.asset?.id;
  if (!assetId) {
    throw new Error(
      `No USDC asset on Blockradar wallet for network=${network}. Enable USDC on the master wallet or set BLOCKRADAR_USDC_ASSET_ID.`,
    );
  }
  return assetId;
}

export async function sendUsdc(params: {
  toAddress: string;
  amount: string;
  network: string;
  userId: string;
  reference: string;
}): Promise<{ hash: string }> {
  const network = toBlockradarNetwork(params.network);
  const assetId = await resolveUsdcAssetId(network);

  let res: Response;
  try {
    // POST /v1/wallets/{walletId}/withdraw — requires assetId (UUID), not asset symbol
    res = await blockradarFetch(`/v1/wallets/${BLOCKRADAR_WALLET_ID}/withdraw`, {
      method: "POST",
      headers: {
        "x-api-key": BLOCKRADAR_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        assetId,
        address: params.toAddress,
        amount: params.amount,
        reference: params.reference,
        metadata: { userId: params.userId, reference: params.reference, network },
      }),
    });
  } catch (error) {
    throw enrichError(error);
  }

  if (!res.ok) {
    const errBody = await res.text();
    const preview = errBody.replace(/\s+/g, " ").slice(0, 180);
    throw enrichError(null, res, preview);
  }

  const body = await res.json();
  const data = body?.data ?? {};
  const hash =
    (typeof data.hash === "string" && data.hash) ||
    (typeof data.transactionHash === "string" && data.transactionHash) ||
    (typeof data.id === "string" && data.id) ||
    "";
  return { hash };
}

/** Safe config snapshot for diagnostics. */
export function getBlockradarEgressInfo(): Record<string, unknown> {
  return {
    ...egress,
    defaultApi: BLOCKRADAR_API_DEFAULT,
    walletIdSet: Boolean(BLOCKRADAR_WALLET_ID),
    apiKeySet: Boolean(BLOCKRADAR_API_KEY),
    proxyOptIn: Deno.env.get("BLOCKRADAR_USE_PROXY")?.trim() === "true",
    proxyDiagnostics: getStaticIpProxyDiagnostics(),
  };
}
