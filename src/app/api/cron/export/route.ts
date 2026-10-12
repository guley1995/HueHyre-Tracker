import { NextResponse, type NextRequest } from "next/server";
import { checkBearer } from "@/lib/agent/auth";
import { runNightlyExport } from "@/lib/export";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Vercel Cron (siehe vercel.json) – Vercel schickt "Authorization: Bearer $CRON_SECRET". */
export async function GET(req: NextRequest) {
  if (!checkBearer(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  }
  try {
    const result = await runNightlyExport(supabaseAdmin());
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("export", e);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
