import { corsHeaders, withCors } from "../_shared/cors.ts";

/**
 * Disabled (bundles model, 2026-10-04): users no longer get personal bank transfer accounts.
 * Bundles are bought per purchase via checkout instead. Kept deployed (not deleted) so the
 * current app's Fund Wallet gets a clear answer rather than a 404.
 */
Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return withCors(
    {
      error: "Personal transfer accounts are no longer available. Buy bundles in the app instead.",
      code: "va_disabled",
    },
    { status: 410 },
  );
});
