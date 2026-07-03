export type PspTerminalClass = "terminal_success" | "terminal_failure" | "non_terminal";

export type PspStatusMap = {
  cls: PspTerminalClass;
  raw: string;
  reason?: string;
  unmapped?: true;
};

const MONNIFY_SUCCESS = new Set(["SUCCESS", "SUCCESSFUL", "COMPLETED"]);
const MONNIFY_FAILURE = new Set(["FAILED", "REJECTED", "EXPIRED", "REVERSED", "DECLINED", "CANCELLED"]);
const MONNIFY_NON_TERMINAL = new Set([
  "PENDING",
  "PROCESSING",
  "IN_PROGRESS",
  "AWAITING_PROCESSING",
  "OTP_REQUIRED",
  "ONGOING",
  "PENDING_AUTHORIZATION",
  "OTP_EMAIL_DISPATCH_FAILED",
]);

export function mapMonnifyStatus(raw: string | null | undefined): PspStatusMap {
  const r = String(raw || "").trim().toUpperCase();
  if (MONNIFY_SUCCESS.has(r)) return { cls: "terminal_success", raw: r };
  if (MONNIFY_FAILURE.has(r)) return { cls: "terminal_failure", raw: r, reason: r };
  if (MONNIFY_NON_TERMINAL.has(r)) return { cls: "non_terminal", raw: r };
  return { cls: "non_terminal", raw: r, unmapped: true };
}

const NOMBA_SUCCESS = new Set(["SUCCESS", "COMPLETED"]);
const NOMBA_FAILURE = new Set(["FAILED", "REFUND", "REVERSED", "DECLINED"]);
const NOMBA_NON_TERMINAL = new Set(["PENDING_BILLING", "NEW", "PROCESSING", "PENDING"]);

export function mapNombaTransferStatus(raw: string | null | undefined): PspStatusMap {
  const r = String(raw || "").trim().toUpperCase();
  if (NOMBA_SUCCESS.has(r)) return { cls: "terminal_success", raw: r };
  if (NOMBA_FAILURE.has(r)) return { cls: "terminal_failure", raw: r, reason: r };
  if (NOMBA_NON_TERMINAL.has(r)) return { cls: "non_terminal", raw: r };
  return { cls: "non_terminal", raw: r, unmapped: true };
}

const FLW_SUCCESS = new Set(["SUCCESS", "SUCCESSFUL", "COMPLETED"]);
const FLW_FAILURE = new Set(["FAILED", "CANCELLED", "REVERSED", "DECLINED"]);
const FLW_NON_TERMINAL = new Set(["NEW", "PENDING", "PROCESSING", "IN_PROGRESS", "OTP"]);

export function mapFlutterwaveTransferStatus(raw: string | null | undefined): PspStatusMap {
  const r = String(raw || "").trim().toUpperCase();
  if (FLW_SUCCESS.has(r)) return { cls: "terminal_success", raw: r };
  if (FLW_FAILURE.has(r)) return { cls: "terminal_failure", raw: r, reason: r };
  if (FLW_NON_TERMINAL.has(r)) return { cls: "non_terminal", raw: r };
  return { cls: "non_terminal", raw: r, unmapped: true };
}

export function mapByProvider(
  providerId: string,
  raw: string | null | undefined,
): PspStatusMap {
  if (providerId === "nomba") return mapNombaTransferStatus(raw);
  if (providerId === "flutterwave") return mapFlutterwaveTransferStatus(raw);
  return mapMonnifyStatus(raw);
}
