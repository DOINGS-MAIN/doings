import type { User } from "@supabase/supabase-js";

export type SignUpResult = {
  user: User | null;
  /** True when Supabase requires email confirmation before issuing a session */
  needsEmailConfirmation: boolean;
};
