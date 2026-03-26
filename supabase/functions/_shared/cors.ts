export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-monnify-signature, x-blockradar-signature, x-quidax-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function withCors(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers ?? {});
  Object.entries(corsHeaders).forEach(([k, v]) => headers.set(k, v));
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), { ...init, headers });
}
