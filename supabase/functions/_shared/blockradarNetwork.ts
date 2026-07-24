/** Map UI network labels to Blockradar API slugs. */
const NETWORK_MAP: Record<string, string> = {
  SOL: "solana",
  SOLANA: "solana",
  solana: "solana",
  SPL: "solana",
  TRC20: "tron",
  TRON: "tron",
  tron: "tron",
  BEP20: "bsc",
  BSC: "bsc",
  bsc: "bsc",
  ERC20: "ethereum",
  ETH: "ethereum",
  ethereum: "ethereum",
};

/** Canonical display label stored in wallet_addresses.network */
const DISPLAY_MAP: Record<string, string> = {
  solana: "SOLANA",
  tron: "TRC20",
  bsc: "BEP20",
  ethereum: "ERC20",
};

/** Default USDC rail — Solana mainnet. */
export const DEFAULT_BLOCKRADAR_NETWORK = "solana";
export const DEFAULT_STORAGE_NETWORK = "SOLANA";

export function toBlockradarNetwork(network?: string): string {
  if (!network) return DEFAULT_BLOCKRADAR_NETWORK;
  const key = network.trim();
  return NETWORK_MAP[key] ?? NETWORK_MAP[key.toUpperCase()] ?? DEFAULT_BLOCKRADAR_NETWORK;
}

export function toDisplayNetwork(blockradarNetwork: string): string {
  return DISPLAY_MAP[blockradarNetwork] ?? blockradarNetwork.toUpperCase();
}

/** Lookup key for wallet_addresses.network */
export function toStorageNetwork(network?: string): string {
  return toDisplayNetwork(toBlockradarNetwork(network));
}
