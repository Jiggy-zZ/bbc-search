import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getServerEnv } from "@/lib/env";

let client: SupabaseClient | undefined;

export function getSupabaseServerClient(): SupabaseClient {
  if (!client) {
    const env = getServerEnv();

    client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
  }

  return client;
}

export async function probeDatabase(): Promise<void> {
  const { error } = await getSupabaseServerClient()
    .from("episodes")
    .select("id")
    .limit(1);

  if (error) {
    throw error;
  }
}
