import { corsHeaders, withCors } from "../_shared/cors.ts";

// Retired (2026-11). Cashing out is the sell function ("Get reward"): it applies the sell fee and minimum,
// which this older route did not. The function stays deployed so old clients get a clear answer.
Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return withCors(
    { error: "This way of withdrawing has been retired. Update the app and use Get reward.", code: "RETIRED" },
    { status: 410 },
  );
});
