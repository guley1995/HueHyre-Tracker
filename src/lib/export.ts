// Export aller Tabellen als XLSX (ein Blatt je Tabelle) und CSV/JSON.
import ExcelJS from "exceljs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EXPORT_TABLES, type ExportTable } from "@/lib/constants";

export type Row = Record<string, unknown>;
export const KEEP_EXPORTS = 30;

const SHEET_NAMES: Record<ExportTable, string> = {
  candidates: "Kandidaten", companies: "Firmen", contacts: "Ansprechpartner", jobs: "Stellen",
  presentations: "Vorstellungen", self_applications: "Selbst beworben", activities: "Aktivitäten",
  placements: "Platzierungen", blocklist: "Sperren", ba_profiles: "BA-Profile",
};

/** Alle Zeilen einer Tabelle/Ansicht holen (PostgREST liefert max. 1000 je Abfrage). */
export async function fetchAll(sb: SupabaseClient, table: string, apply?: (q: any) => any): Promise<Row[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from(table).select("*");
    if (apply) q = apply(q);
    const { data, error } = await q.order("id").range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) return out;
  }
}

export async function fetchAllTables(sb: SupabaseClient): Promise<Record<ExportTable, Row[]>> {
  const result = {} as Record<ExportTable, Row[]>;
  for (const t of EXPORT_TABLES) result[t] = await fetchAll(sb, t);
  return result;
}

function cell(v: unknown): string | number | boolean | null {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return v as string | number | boolean;
}

export async function buildWorkbook(sheets: Record<string, Row[]>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "HueHYRE Tracker";
  wb.created = new Date();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = wb.addWorksheet((SHEET_NAMES[name as ExportTable] ?? name).slice(0, 31));
    const cols = rows.length ? Object.keys(rows[0]) : [];
    ws.columns = cols.map((c) => ({ header: c, key: c, width: Math.min(40, Math.max(10, c.length + 2)) }));
    for (const r of rows) ws.addRow(Object.fromEntries(cols.map((c) => [c, cell(r[c])])));
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    if (cols.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** CSV mit Semikolon und BOM – öffnet sich in deutschem Excel direkt richtig. */
export function toCsv(rows: Row[]): string {
  if (!rows.length) return "﻿";
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = cell(v);
    if (s === null) return "";
    const str = String(s);
    return /[;"\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  return "﻿" + [cols.join(";"), ...rows.map((r) => cols.map((c) => esc(r[c])).join(";"))].join("\r\n");
}

export function berlinDate(d = new Date()): string {
  return d.toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
}

/**
 * Nächtlicher Export nach Storage:
 *   exports/2026-10-12/HueHYRE_Tracker_2026-10-12.xlsx
 *   exports/2026-10-12/<tabelle>.csv und .json
 * Hält die letzten 30 Stände.
 */
export async function runNightlyExport(sb: SupabaseClient) {
  const date = berlinDate();
  const tables = await fetchAllTables(sb);
  const bucket = sb.storage.from("exports");
  const xlsx = await buildWorkbook(tables);
  const upload = async (path: string, body: Buffer | string, contentType: string) => {
    const { error } = await bucket.upload(`${date}/${path}`, body, { upsert: true, contentType });
    if (error) throw new Error(`Upload ${path}: ${error.message}`);
  };
  await upload(`HueHYRE_Tracker_${date}.xlsx`, xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  for (const [t, rows] of Object.entries(tables)) {
    await upload(`${t}.csv`, toCsv(rows), "text/csv; charset=utf-8");
    await upload(`${t}.json`, JSON.stringify(rows, null, 1), "application/json");
  }

  // Aufräumen: nur die 30 neuesten Tagesordner behalten.
  const { data: folders } = await bucket.list("", { limit: 1000, sortBy: { column: "name", order: "desc" } });
  const days = (folders ?? []).map((f) => f.name).filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n)).sort().reverse();
  const removed: string[] = [];
  for (const old of days.slice(KEEP_EXPORTS)) {
    const { data: files } = await bucket.list(old, { limit: 1000 });
    if (files?.length) await bucket.remove(files.map((f) => `${old}/${f.name}`));
    removed.push(old);
  }
  return { date, counts: Object.fromEntries(Object.entries(tables).map(([t, r]) => [t, r.length])), removed };
}
