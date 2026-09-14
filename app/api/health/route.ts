import { createHealthResponse } from "@/lib/health";
import { probeStorage } from "@/lib/r2/client";
import { probeDatabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return createHealthResponse({
    database: probeDatabase,
    storage: probeStorage,
  });
}
