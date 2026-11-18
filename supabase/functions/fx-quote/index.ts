import { corsHeaders, withCors } from "../_shared/cors.ts";

// Retired (2026-11). Only the old app's naira/USDC wallet conversion used it; the new app holds bundles and prices USDC
// inside the bundles and sell functions.
// The function stays deployed so old clients get a clear answer.
Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return withCors(
    { error: "Currency conversion has been retired. Update the app.", code: "RETIRED" },
    { status: 410 },
  );
});
