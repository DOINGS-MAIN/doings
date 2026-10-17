import { useCallback } from "react";
import { admin as adminApi } from "@/lib/supabase";
import type {
  AdminLedgerEntry,
  AdminTransaction,
  AdminTransactionDetail,
  PspEventRecord,
  WebhookLogDetail,
  WebhookLogSummary,
} from "@/types/admin";

const toDisplay = (amount: number, currency: string) =>
  currency === "USDC" ? amount / 1_000_000 : amount / 100;

function mapTransaction(row: Record<string, unknown>): AdminTransaction & {
  userPhone?: string;
  userEmail?: string;
} {
  const currency = ((row.currency as string) ?? "NGN") as AdminTransaction["currency"];
  const rawFee = Number(row.fee ?? 0);
  const rawAmount = Number(row.amount ?? 0);
  const rawNet = Number(row.net_amount ?? 0);
  const metadata = row.metadata as Record<string, unknown> | undefined;
  const feeBreakdown = metadata?.fee_breakdown as { total_fee_kobo?: number } | undefined;
  const inferredFeeKobo = rawFee > 0
    ? rawFee
    : Number(feeBreakdown?.total_fee_kobo ?? 0) > 0
    ? Number(feeBreakdown?.total_fee_kobo)
    : Math.max(Math.abs(rawNet) - Math.abs(rawAmount), 0);

  return {
    id: row.id as string,
    userId: (row.user_id as string) ?? "",
    userName: (row.user_name as string) ?? "",
    userPhone: row.user_phone as string | undefined,
    userEmail: row.user_email as string | undefined,
    type: row.type as AdminTransaction["type"],
    amount: toDisplay(rawAmount, currency),
    fee: toDisplay(inferredFeeKobo, currency),
    netAmount: toDisplay(rawNet, currency),
    currency,
    status: row.status as AdminTransaction["status"],
    provider: row.provider as string | undefined,
    providerRef: row.provider_ref as string | undefined,
    reference: (row.idempotency_key as string) ?? (row.id as string),
    description: (row.description as string) ?? "",
    metadata: row.metadata as Record<string, unknown> | undefined,
    flagged: (row.flagged as boolean) ?? false,
    flagReason: row.flag_reason as string | undefined,
    createdAt: new Date((row.created_at as string) ?? Date.now()),
    processedAt: row.completed_at ? new Date(row.completed_at as string) : undefined,
  };
}

function mapPspEvent(row: Record<string, unknown>): PspEventRecord {
  return {
    id: row.id as string,
    transactionId: row.transaction_id as string | undefined,
    providerId: row.provider_id as string,
    direction: row.direction as PspEventRecord["direction"],
    eventType: row.event_type as string,
    status: row.status as string | undefined,
    providerStatus: row.provider_status as string | undefined,
    reference: row.reference as string | undefined,
    providerRef: row.provider_ref as string | undefined,
    requestSummary: row.request_summary as Record<string, unknown> | undefined,
    responseSummary: row.response_summary as Record<string, unknown> | undefined,
    errorMessage: row.error_message as string | undefined,
    createdAt: new Date((row.created_at as string) ?? Date.now()),
  };
}

function mapWebhookSummary(row: Record<string, unknown>): WebhookLogSummary {
  return {
    id: row.id as string,
    provider: row.provider as string,
    eventType: row.event_type as string | undefined,
    processed: Boolean(row.processed),
    processingError: row.processing_error as string | undefined,
    signatureValid: row.signature_valid as boolean | undefined,
    idempotencyKey: row.idempotency_key as string | undefined,
    createdAt: new Date((row.created_at as string) ?? Date.now()),
    processedAt: row.processed_at ? new Date(row.processed_at as string) : undefined,
  };
}

export const useAdminMonitoring = () => {
  const fetchTransactionDetail = useCallback(async (id: string): Promise<AdminTransactionDetail | null> => {
    const res = (await adminApi.transactions.get(id)) as Record<string, unknown>;
    const txn = mapTransaction((res.transaction as Record<string, unknown>) ?? {});
    const ledger = ((res.ledger_entries as Record<string, unknown>[]) ?? []).map((row) => {
      const currency = txn.currency;
      return {
        id: row.id as string,
        entryType: row.entry_type as AdminLedgerEntry["entryType"],
        amount: toDisplay((row.amount as number) ?? 0, currency),
        balanceBefore: toDisplay((row.balance_before as number) ?? 0, currency),
        balanceAfter: toDisplay((row.balance_after as number) ?? 0, currency),
        createdAt: new Date((row.created_at as string) ?? Date.now()),
      };
    });

    return {
      transaction: txn,
      ledgerEntries: ledger,
      pspEvents: ((res.psp_events as Record<string, unknown>[]) ?? []).map(mapPspEvent),
      relatedWebhooks: ((res.related_webhooks as Record<string, unknown>[]) ?? []).map(mapWebhookSummary),
    };
  }, []);

  const fetchWebhooks = useCallback(
    async (params: {
      page?: number;
      limit?: number;
      provider?: string;
      processed?: string;
      event_type?: string;
      search?: string;
    } = {}) => {
      const res = (await adminApi.webhooks.list(params)) as {
        webhooks?: Record<string, unknown>[];
        total?: number;
        page?: number;
      };
      return {
        webhooks: (res.webhooks ?? []).map(mapWebhookSummary),
        total: res.total ?? 0,
        page: res.page ?? 1,
      };
    },
    []
  );

  const fetchWebhookDetail = useCallback(async (id: string): Promise<WebhookLogDetail | null> => {
    const res = (await adminApi.webhooks.get(id)) as { webhook?: Record<string, unknown> };
    const row = res.webhook;
    if (!row) return null;
    return {
      ...mapWebhookSummary(row),
      payload: (row.payload as Record<string, unknown>) ?? {},
      headers: row.headers as Record<string, unknown> | undefined,
      signature: row.signature as string | undefined,
    };
  }, []);

  const fetchPspEvents = useCallback(
    async (params: { page?: number; limit?: number; provider?: string; direction?: string; search?: string } = {}) => {
      const res = (await adminApi.pspEvents.list(params)) as {
        events?: Record<string, unknown>[];
        total?: number;
        page?: number;
      };
      return {
        events: (res.events ?? []).map(mapPspEvent),
        total: res.total ?? 0,
        page: res.page ?? 1,
      };
    },
    []
  );

  return {
    fetchTransactionDetail,
    fetchWebhooks,
    fetchWebhookDetail,
    fetchPspEvents,
    reprocessWebhook: (id: string) => adminApi.webhooks.reprocess(id),
  };
};
