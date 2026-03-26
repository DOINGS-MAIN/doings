const BLOCKRADAR_BASE_URL = "https://api.blockradar.io/v1";
const BLOCKRADAR_API_KEY = Deno.env.get("BLOCKRADAR_API_KEY") ?? "";
const BLOCKRADAR_WALLET_ID = Deno.env.get("BLOCKRADAR_WALLET_ID") ?? "";

export async function generateDepositAddress(params: {
  userId: string;
  network?: string;
}): Promise<{
  address: string;
  network: string;
}> {
  const network = params.network ?? "tron";
  const res = await fetch(`${BLOCKRADAR_BASE_URL}/wallets/${BLOCKRADAR_WALLET_ID}/addresses`, {
    method: "POST",
    headers: {
      "x-api-key": BLOCKRADAR_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: `DOINGS-${params.userId}`,
      network,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Blockradar address creation failed: ${res.status} — ${errBody}`);
  }

  const body = await res.json();
  const data = body.data ?? body;

  return {
    address: data.address,
    network: data.network ?? network,
  };
}

export async function sendUsdt(params: {
  toAddress: string;
  amount: string;
  network: string;
  userId: string;
  reference: string;
}): Promise<{ hash: string }> {
  const res = await fetch(`${BLOCKRADAR_BASE_URL}/wallets/${BLOCKRADAR_WALLET_ID}/withdraw`, {
    method: "POST",
    headers: {
      "x-api-key": BLOCKRADAR_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      address: params.toAddress,
      amount: params.amount,
      asset: "USDT",
      network: params.network,
      metadata: { userId: params.userId, reference: params.reference },
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Blockradar withdrawal failed: ${res.status} — ${errBody}`);
  }

  const body = await res.json();
  return { hash: body.data?.hash ?? "" };
}
