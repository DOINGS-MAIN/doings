declare namespace Deno {
  function serve(
    handler: (req: Request) => Response | Promise<Response>,
  ): void;

  const env: {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    toObject(): Record<string, string>;
  };
}

declare module "npm:@supabase/supabase-js@2" {
  export * from "@supabase/supabase-js";
  export { createClient } from "@supabase/supabase-js";
}
