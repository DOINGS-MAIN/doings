// Suspended and banned users can still read, but can't move money or host.
export type AccountBlock = { error: string; code: "ACCOUNT_SUSPENDED" | "ACCOUNT_BANNED" };

export function accountBlock(status: string | null | undefined): AccountBlock | null {
  if (status === "suspended") return { error: "Your account is suspended. Contact support.", code: "ACCOUNT_SUSPENDED" };
  if (status === "banned") return { error: "Your account is banned. Contact support.", code: "ACCOUNT_BANNED" };
  return null;
}
