import "server-only";
import { createClient } from "@supabase/supabase-js";

/** Service-Role-Client: nur für Cron/Export auf dem Server. Umgeht RLS. */
export function supabaseAdmin() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY fehlt.");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, { auth: { persistSession: false } });
}
