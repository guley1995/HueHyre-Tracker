import { NextResponse, type NextRequest } from "next/server";
import { EXPORT_TABLES } from "@/lib/constants";
import { berlinDate, buildWorkbook, fetchAll, fetchAllTables } from "@/lib/export";
import { applyFilters, parseFilters } from "@/lib/filters";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Excel-Export für eingeloggte Nutzer.
 *   ?table=candidates|companies (+ Filter wie im Board) → gefilterte Tabelle
 *   ?table=all → alle Tabellen, ein Blatt je Tabelle
 */
export async function GET(req: NextRequest) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });

  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const table = sp.table ?? "all";
  let sheets: Record<string, Record<string, unknown>[]>;
  if (table === "all") {
    sheets = await fetchAllTables(sb);
  } else if (table === "candidates" || table === "companies") {
    const entity = table === "candidates" ? "candidate" : "company";
    const view = table === "candidates" ? "candidate_cards" : "company_cards";
    sheets = { [table]: await fetchAll(sb, view, (q) => applyFilters(q, parseFilters(sp), entity)) };
  } else if ((EXPORT_TABLES as readonly string[]).includes(table)) {
    sheets = { [table]: await fetchAll(sb, table) };
  } else {
    return NextResponse.json({ error: "Unbekannte Tabelle" }, { status: 400 });
  }
  const buf = await buildWorkbook(sheets);
  const name = `HueHYRE_${table === "all" ? "Tracker" : table}_${berlinDate()}.xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  });
}
