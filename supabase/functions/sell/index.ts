import { corsHeaders, withCors } from "../_shared/cors.ts";
import { getAuthUserIdFromRequest, getServiceClient } from "../_shared/db.ts";
import { checkRateLimit, RATE_LIMITS } from "../_shared/rate-limit.ts";
import { requireTransactionPin } from "../_shared/pin.ts";
import { logPspEvent } from "../_shared/psp/pspEvents.ts";
import { getPlatformPaymentSettings } from "../_shared/psp/platformSettings.ts";
import { listBanks, submitTransfer, verifyBankAccount } from "../_shared/psp/registry.ts";
import { applyWithdrawalStatus } from "../_shared/psp/withdrawalFinalize.ts";
import { mapByProvider } from "../_shared/psp/pspStatus.ts";
import { sendUsdc } from "../_shared/blockradar.ts";
import { refreshMarketRateIfStale } from "../_shared/bundles.ts";
import {
  getKycLegalName,
  isDefiniteBlockradarRejection,
  isSolanaAddress,
  NAME_MISMATCH_MESSAGE,
  nameMatchesKyc,
} from "../_shared/sell.ts";

/**
 * Sell bundles (cash-out). KYC level 2; selling needs the transaction PIN.
 *   GET    /sell/quote?bundles=N&currency=NGN|USDC
 *   GET    /sell/accounts                     own bank accounts (+ name_matches)
 *   POST   /sell/accounts {bank_code, account_number}   resolve, name-match, save
 *   DELETE /sell/accounts/:id
 *   POST   /sell {bundles, currency, bank_account_id | address, pin, idempotency_key}
 *   GET    /sell/:transaction_id              own sale status
 * Money rules live in create_bundle_sale / complete_bundle_sale / fail_bundle_sale (migration 082).
 */

const MAX_BUNDLES = 100_000_000;
const SALE_COLUMNS = "id, status, fee, amount, net_amount, metadata, created_at";

type SellSettings = {
  bundle_price_kobo: number;
  bundle_sell_fee_flat_kobo: number;
  bundle_sell_fee_percent: number;
  bundle_sell_min: number;
  bundle_sell_usdc_enabled: boolean;
  bundle_sell_usdc_min_micro: number;
  bundle_sell_usdc_network_fee_micro: number;
  fx_market_rate_kobo: number | null;
  fx_buy_flat_kobo: number | null;
  fx_buy_percent: number | null;
};

function parseBundles(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n <= MAX_BUNDLES ? n : null;
}

/** Mirrors create_bundle_sale's maths (the RPC is authoritative). */
function quote(bundles: number, currency: "NGN" | "USDC", s: SellSettings) {
  const value = bundles * s.bundle_price_kobo;
  const fee = s.bundle_sell_fee_flat_kobo + Math.floor((value * Number(s.bundle_sell_fee_percent)) / 100);
  const base = {
    currency,
    bundles,
    fee_kobo: fee,
    min_bundles: s.bundle_sell_min,
    usdc_min_micro: s.bundle_sell_usdc_min_micro,
  };
  if (currency === "NGN") return { ...base, payout_kobo: Math.max(value - fee, 0) };
  const market = Number(s.fx_market_rate_kobo ?? 0);
  if (!market) return null;
  const rate = Math.max(
    1,
    market + Number(s.fx_buy_flat_kobo ?? 0) + Math.floor((market * Number(s.fx_buy_percent ?? 0)) / 100),
  );
  const usdc = Math.floor(((value - fee) * 1_000_000) / rate) - s.bundle_sell_usdc_network_fee_micro;
  return { ...base, usdc_micro: Math.max(usdc, 0), network_fee_micro: s.bundle_sell_usdc_network_fee_micro, rate_kobo: rate };
}

function rpcMessage(err: unknown): string {
  const raw = err && typeof err === "object" && "message" in err ? String((err as { message: unknown }).message) : String(err);
  return raw.split("\n")[0];
}

function saleView(row: Record<string, unknown>) {
  const m = (row.metadata ?? {}) as Record<string, unknown>;
  const usdc = m.kind === "bundle_sale_usdc";
  return {
    id: row.id,
    status: row.status,
    currency: usdc ? "USDC" : "NGN",
    bundles: Number(m.bundles ?? 0),
    fee_kobo: Number(row.fee ?? 0),
    payout_kobo: usdc ? undefined : Math.abs(Number(row.amount ?? 0)),
    usdc_micro: usdc ? Number(m.usdc_micro ?? 0) : undefined,
    failure_reason: (m.failure_reason as string | undefined) ?? null,
    created_at: row.created_at,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authUserId = await getAuthUserIdFromRequest(req.headers.get("Authorization"));
  if (!authUserId) return withCors({ error: "Unauthorized" }, { status: 401 });

  const supabase = getServiceClient();
  const { data: user } = await supabase
    .from("users")
    .select("id, kyc_level")
    .eq("auth_id", authUserId)
    .maybeSingle();
  if (!user) return withCors({ error: "User not found" }, { status: 404 });
  if (user.kyc_level < 2) {
    return withCors({ error: "Complete identity verification (BVN + NIN) to sell bundles" }, { status: 403 });
  }

  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const rest = parts.slice(parts.indexOf("sell") + 1);

  try {
    // ── Quote ──
    if (req.method === "GET" && rest[0] === "quote") {
      const bundles = parseBundles(url.searchParams.get("bundles"));
      const currency = (url.searchParams.get("currency") ?? "NGN").toUpperCase();
      if (!bundles) return withCors({ error: "Enter how many bundles to sell" }, { status: 400 });
      if (currency !== "NGN" && currency !== "USDC") {
        return withCors({ error: "currency must be NGN or USDC" }, { status: 400 });
      }
      if (currency === "USDC") await refreshMarketRateIfStale(supabase);
      const { data: s } = await supabase.from("platform_settings").select("*").limit(1).single();
      const settings = s as SellSettings;
      if (currency === "USDC" && !settings.bundle_sell_usdc_enabled) {
        return withCors({ error: "USDC payouts are paused" }, { status: 503 });
      }
      const q = quote(bundles, currency, settings);
      if (!q) return withCors({ error: "USDC payouts are temporarily unavailable" }, { status: 503 });
      return withCors({ ok: true, ...q });
    }

    // ── Bank accounts ──
    if (rest[0] === "accounts") {
      if (req.method === "GET" && !rest[1]) {
        const { data: rows } = await supabase
          .from("bank_accounts")
          .select("id, bank_code, bank_name, account_number, account_name, is_default")
          .eq("user_id", user.id)
          .order("is_default", { ascending: false })
          .order("created_at", { ascending: true });
        const legal = await getKycLegalName(supabase, user.id);
        const accounts = (rows ?? []).map((a) => ({
          ...a,
          name_matches: legal ? nameMatchesKyc(String(a.account_name ?? ""), legal) : false,
        }));
        return withCors({ ok: true, accounts });
      }

      if (req.method === "POST" && !rest[1]) {
        const body = await req.json().catch(() => ({})) as { bank_code?: string; account_number?: string };
        const bankCode = String(body.bank_code ?? "").trim();
        const accountNumber = String(body.account_number ?? "").trim();
        if (!bankCode || !/^\d{10}$/.test(accountNumber)) {
          return withCors({ error: "Enter a 10-digit account number and choose a bank" }, { status: 400 });
        }
        const platform = await getPlatformPaymentSettings(supabase);
        let resolvedName = "";
        try {
          const r = await verifyBankAccount(platform.disbursementProviderId, bankCode, accountNumber, platform.pspEnv);
          resolvedName = String(r.accountName ?? "").trim();
        } catch {
          return withCors({ error: "We couldn't verify that account" }, { status: 422 });
        }
        if (!resolvedName) return withCors({ error: "We couldn't verify that account" }, { status: 422 });
        const legal = await getKycLegalName(supabase, user.id);
        if (!legal || !nameMatchesKyc(resolvedName, legal)) {
          return withCors({ error: NAME_MISMATCH_MESSAGE, account_name: resolvedName }, { status: 422 });
        }
        let bankName = bankCode;
        try {
          const banks = await listBanks(platform.disbursementProviderId, platform.pspEnv);
          bankName = banks.find((b) => b.code === bankCode)?.name ?? bankCode;
        } catch { /* keep the code as the name */ }
        const { count } = await supabase
          .from("bank_accounts").select("id", { count: "exact", head: true }).eq("user_id", user.id);
        const { data: saved, error: saveErr } = await supabase
          .from("bank_accounts")
          .upsert({
            user_id: user.id,
            bank_code: bankCode,
            bank_name: bankName,
            account_number: accountNumber,
            account_name: resolvedName,
            is_verified: true,
            verified_at: new Date().toISOString(),
            ...(count ? {} : { is_default: true }),
          }, { onConflict: "user_id,bank_code,account_number" })
          .select("id, bank_code, bank_name, account_number, account_name, is_default")
          .single();
        if (saveErr) throw saveErr;
        return withCors({ ok: true, account: { ...saved, name_matches: true } });
      }

      if (req.method === "DELETE" && rest[1]) {
        const { error } = await supabase.from("bank_accounts").delete().eq("id", rest[1]).eq("user_id", user.id);
        if (error) throw error;
        return withCors({ ok: true });
      }
    }

    // ── Sale status ──
    if (req.method === "GET" && rest[0] && rest.length === 1) {
      const { data: row } = await supabase
        .from("transactions")
        .select(SALE_COLUMNS)
        .eq("id", rest[0])
        .eq("user_id", user.id)
        .eq("type", "withdrawal")
        .maybeSingle();
      const kind = (row?.metadata as Record<string, unknown> | null)?.kind;
      if (!row || typeof kind !== "string" || !kind.startsWith("bundle_sale")) {
        return withCors({ error: "Sale not found" }, { status: 404 });
      }
      return withCors({ ok: true, sale: saleView(row) });
    }

    // ── Sell ──
    if (req.method === "POST" && rest.length === 0) {
      const body = await req.json().catch(() => ({})) as {
        bundles?: unknown;
        currency?: string;
        bank_account_id?: string;
        address?: string;
        pin?: string;
        idempotency_key?: string;
      };
      const clientKey = String(body.idempotency_key ?? "");
      if (!/^[A-Za-z0-9_-]{8,64}$/.test(clientKey)) {
        return withCors({ error: "Invalid idempotency_key" }, { status: 400 });
      }
      const reference = `SELL-${user.id.slice(0, 8)}-${clientKey}`;

      // A retry of an attempt whose outcome the client never saw: answer with that sale before any
      // check that could fail differently this time (PIN, rate limit, bank lookup).
      const { data: prior } = await supabase
        .from("transactions")
        .select(SALE_COLUMNS)
        .eq("idempotency_key", reference)
        .eq("user_id", user.id)
        .maybeSingle();
      if (prior) {
        const view = saleView(prior);
        return withCors({
          ok: true,
          transaction_id: prior.id,
          status: prior.status === "pending" ? "processing" : prior.status,
          payout_kobo: view.payout_kobo,
          usdc_micro: view.usdc_micro,
        });
      }

      const pinCheck = await requireTransactionPin(supabase, user.id, body.pin);
      if (pinCheck) return pinCheck;

      const rl = await checkRateLimit(RATE_LIMITS.withdrawal(user.id));
      if (!rl.allowed) return withCors({ error: "Too many requests. Try again shortly." }, { status: 429 });

      const bundles = parseBundles(body.bundles);
      const currency = String(body.currency ?? "").toUpperCase();
      if (!bundles) return withCors({ error: "Enter how many bundles to sell" }, { status: 400 });
      if (currency !== "NGN" && currency !== "USDC") {
        return withCors({ error: "currency must be NGN or USDC" }, { status: 400 });
      }

      const platform = await getPlatformPaymentSettings(supabase);
      let destination: Record<string, string>;
      if (currency === "NGN") {
        const { data: acct } = await supabase
          .from("bank_accounts")
          .select("bank_code, bank_name, account_number")
          .eq("id", String(body.bank_account_id ?? ""))
          .eq("user_id", user.id)
          .maybeSingle();
        if (!acct) return withCors({ error: "Choose a bank account" }, { status: 400 });
        // Never trust the saved row (clients can write bank_accounts): re-resolve and re-match now.
        let resolvedName = "";
        try {
          const r = await verifyBankAccount(platform.disbursementProviderId, acct.bank_code, acct.account_number, platform.pspEnv);
          resolvedName = String(r.accountName ?? "").trim();
        } catch {
          return withCors({ error: "We couldn't verify that account" }, { status: 422 });
        }
        const legal = await getKycLegalName(supabase, user.id);
        if (!resolvedName || !legal || !nameMatchesKyc(resolvedName, legal)) {
          return withCors({ error: NAME_MISMATCH_MESSAGE, account_name: resolvedName }, { status: 422 });
        }
        destination = {
          bank_code: acct.bank_code,
          bank_name: acct.bank_name ?? "",
          account_number: acct.account_number,
          account_name: resolvedName,
        };
      } else {
        const address = String(body.address ?? "").trim();
        if (!isSolanaAddress(address)) {
          return withCors({ error: "Enter a valid Solana USDC address" }, { status: 400 });
        }
        await refreshMarketRateIfStale(supabase);
        destination = { address };
      }

      const { data: created, error: createErr } = await supabase.rpc("create_bundle_sale", {
        p_user_id: user.id,
        p_bundles: bundles,
        p_currency: currency,
        p_destination: destination,
        p_idempotency_key: reference,
      });
      if (createErr) return withCors({ error: rpcMessage(createErr) }, { status: 400 });
      const sale = created as {
        transaction_id: string;
        status: string;
        already?: boolean;
        payout_kobo?: number;
        usdc_micro?: number;
      };
      if (sale.already) {
        return withCors({ ok: true, transaction_id: sale.transaction_id, status: sale.status, payout_kobo: sale.payout_kobo, usdc_micro: sale.usdc_micro });
      }
      const txnId = sale.transaction_id;
      await supabase.from("transactions").update({ provider_ref: reference }).eq("id", txnId);

      const mergeMetadata = async (patch: Record<string, unknown>) => {
        const { data: row } = await supabase.from("transactions").select("metadata").eq("id", txnId).maybeSingle();
        const prev = (row?.metadata as Record<string, unknown> | null) ?? {};
        await supabase.from("transactions").update({ metadata: { ...prev, ...patch }, updated_at: new Date().toISOString() }).eq("id", txnId);
      };

      // From here on the provider may have accepted the payout: errors never release the bundles.
      try {
        if (currency === "NGN") {
          const providerId = platform.disbursementProviderId;
          const result = await submitTransfer({
            providerId,
            env: platform.pspEnv,
            reference,
            amountNaira: Number(sale.payout_kobo) / 100,
            destinationBankCode: destination.bank_code,
            destinationAccountNumber: destination.account_number,
            destinationAccountName: destination.account_name,
            narration: "Doings bundles sale",
          });
          await logPspEvent(supabase, {
            transactionId: txnId,
            providerId,
            direction: "outbound",
            eventType: "api_response",
            status: result.kind,
            providerStatus: "providerStatus" in result ? result.providerStatus : null,
            reference,
            providerRef: "providerRef" in result ? result.providerRef : null,
            responseSummary: result as unknown as Record<string, unknown>,
            errorMessage: result.kind === "rejected_terminal" ? result.message : null,
          });
          if (result.kind === "rejected_terminal") {
            await mergeMetadata({ failure_reason: result.message });
            await supabase.rpc("fail_bundle_sale", { p_transaction_id: txnId });
            return withCors({ error: "The bank transfer was rejected. Your bundles are back in your purse." }, { status: 502 });
          }
          const providerRef = "providerRef" in result ? result.providerRef : reference;
          const providerStatus = "providerStatus" in result ? result.providerStatus : "";
          await supabase.from("transactions").update({ provider_ref: providerRef }).eq("id", txnId);
          await mergeMetadata({ psp_status: providerStatus });
          const mapped = mapByProvider(providerId, providerStatus);
          const finalState = await applyWithdrawalStatus(
            supabase,
            { id: txnId, provider: providerId, idempotency_key: reference, provider_ref: providerRef, status: "pending" },
            {
              normalized: result.kind === "accepted" || mapped.cls === "terminal_success"
                ? "terminal_success"
                : mapped.cls === "terminal_failure"
                ? "terminal_failure"
                : "non_terminal",
              providerStatus,
              providerRef,
            },
            "submit",
          );
          return withCors({
            ok: true,
            transaction_id: txnId,
            status: finalState === "completed" ? "completed" : finalState === "failed" ? "failed" : "processing",
            payout_kobo: sale.payout_kobo,
          });
        }

        const result = await sendUsdc({
          toAddress: destination.address,
          amount: (Number(sale.usdc_micro) / 1_000_000).toFixed(6),
          network: "solana",
          userId: user.id,
          reference,
        });
        await mergeMetadata({ tx_hash: result.hash || null });
        await supabase.from("transactions").update({ status: "processing" }).eq("id", txnId).eq("status", "pending");
        return withCors({ ok: true, transaction_id: txnId, status: "processing", usdc_micro: sale.usdc_micro });
      } catch (err) {
        if (currency === "USDC" && isDefiniteBlockradarRejection(err)) {
          await mergeMetadata({ failure_reason: String(err).slice(0, 300) }).catch(() => {});
          await supabase.rpc("fail_bundle_sale", { p_transaction_id: txnId });
          return withCors({ error: "The USDC payout was rejected. Your bundles are back in your purse." }, { status: 502 });
        }
        console.error("sell payout outcome unknown:", txnId, String(err));
        await mergeMetadata({ submit_error: String(err).slice(0, 300) }).catch(() => {});
        await supabase.from("transactions").update({ status: "processing" }).eq("id", txnId).eq("status", "pending");
        return withCors({ ok: true, transaction_id: txnId, status: "processing", note: "confirming" }, { status: 202 });
      }
    }

    return withCors({ error: "Not found" }, { status: 404 });
  } catch (err) {
    console.error("sell:", err);
    return withCors({ error: "Something went wrong" }, { status: 500 });
  }
});
