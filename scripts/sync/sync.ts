// Läuft auf dem Mac (launchd, siehe de.huehyre.tracker-sync.plist):
//
// 1. Export holen: neuester Stand aus Supabase Storage "exports" →
//      Tracker-Export/HueHYRE_Tracker_JJJJ-MM-TT.xlsx
//      Tracker-Export/JJJJ-MM-TT/<tabelle>.csv|.json
//      Tracker-Export/aktuell/<tabelle>.csv|.json   (immer der neueste Stand – fester Pfad für Claude)
//    Es bleiben die letzten 30 Stände.
//
// 2. Import-Ordner abarbeiten: CSV-Dateien in Tracker-Import/ gehen über die Agent-API
//    (mit Dublettenprüfung) in den Tracker. Dateiname bestimmt die Art:
//      kandidaten*.csv → upsert_candidate   firmen*.csv → upsert_company
//      stellen*.csv    → upsert_job         ba*.csv     → upsert_ba_profile
//    Danach landen Datei + Ergebnisbericht in Tracker-Import/erledigt/.
//
// Konfiguration: .env.local im Projektordner (oder Umgebungsvariablen), siehe .env.example.
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const ROOT = path.resolve(import.meta.dirname, "../..");
try {
  process.loadEnvFile(path.join(ROOT, ".env.local"));
} catch {
  // keine .env.local – Umgebungsvariablen nutzen
}

const KEEP = 30;
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} fehlt (in .env.local setzen).`);
  return v;
}

// ------------------------------------------------------------------ Export

async function syncExport() {
  const dir = env("TRACKER_EXPORT_DIR");
  const sb = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const bucket = sb.storage.from("exports");
  const { data: folders, error } = await bucket.list("", { limit: 1000 });
  if (error) throw new Error(`Storage: ${error.message}`);
  const days = (folders ?? []).map((f) => f.name).filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n)).sort();
  const latest = days.at(-1);
  if (!latest) return log("Noch kein Export im Storage.");

  fs.mkdirSync(dir, { recursive: true });
  const xlsxName = `HueHYRE_Tracker_${latest}.xlsx`;
  const dayDir = path.join(dir, latest);
  if (fs.existsSync(path.join(dir, xlsxName)) && fs.existsSync(dayDir)) {
    log(`Export ${latest} schon vorhanden.`);
  } else {
    const { data: files } = await bucket.list(latest, { limit: 1000 });
    fs.mkdirSync(dayDir, { recursive: true });
    for (const f of files ?? []) {
      const { data, error: e } = await bucket.download(`${latest}/${f.name}`);
      if (e || !data) throw new Error(`Download ${f.name}: ${e?.message}`);
      const buf = Buffer.from(await data.arrayBuffer());
      fs.writeFileSync(f.name.endsWith(".xlsx") ? path.join(dir, f.name) : path.join(dayDir, f.name), buf);
    }
    log(`Export ${latest} geladen (${files?.length ?? 0} Dateien).`);
  }

  // "aktuell" spiegelt immer den neuesten Stand.
  const current = path.join(dir, "aktuell");
  fs.rmSync(current, { recursive: true, force: true });
  fs.cpSync(dayDir, current, { recursive: true });

  // Nur die letzten 30 Stände behalten.
  const localDays = fs.readdirSync(dir).filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n)).sort();
  for (const old of localDays.slice(0, Math.max(0, localDays.length - KEEP))) {
    fs.rmSync(path.join(dir, old), { recursive: true, force: true });
    fs.rmSync(path.join(dir, `HueHYRE_Tracker_${old}.xlsx`), { force: true });
    log(`Alter Stand ${old} entfernt.`);
  }
}

// ------------------------------------------------------------------ Import-Ordner

/** CSV mit ; oder , (automatisch erkannt), Anführungszeichen, BOM. */
export function parseCsv(text: string): Record<string, string>[] {
  const t = text.replace(/^﻿/, "");
  const firstLine = t.split(/\r?\n/, 1)[0] ?? "";
  const sep = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (quoted) {
      if (ch === '"' && t[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((x) => x.trim())) rows.push(row);
  const [header, ...body] = rows;
  if (!header) return [];
  const keys = header.map((h) => h.trim());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()]).filter(([, v]) => v !== "")));
}

const ACTIONS: [RegExp, string][] = [
  [/^kandidat/i, "upsert_candidate"],
  [/^firm/i, "upsert_company"],
  [/^stelle/i, "upsert_job"],
  [/^ba/i, "upsert_ba_profile"],
];
const NUMERIC = new Set(["radius_km", "age"]);

async function processImports() {
  const dir = process.env.TRACKER_IMPORT_DIR;
  if (!dir || !fs.existsSync(dir)) return;
  const api = env("TRACKER_API_URL").replace(/\/$/, "");
  const key = env("AGENT_API_KEY");
  const done = path.join(dir, "erledigt");
  const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".csv"));
  for (const file of files) {
    const action = ACTIONS.find(([re]) => re.test(file))?.[1];
    const report: string[] = [`Import ${file} – ${new Date().toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}`, ""];
    if (!action) {
      log(`${file}: unbekannte Art (Dateiname muss mit kandidaten/firmen/stellen/ba beginnen) – übersprungen.`);
      continue;
    }
    const rows = parseCsv(fs.readFileSync(path.join(dir, file), "utf8"));
    let ok = 0;
    for (const [i, raw] of rows.entries()) {
      const body: Record<string, unknown> = { ...raw };
      for (const k of Object.keys(body)) if (NUMERIC.has(k)) body[k] = Number(body[k]);
      try {
        const res = await fetch(`${api}/api/agent/${action}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = (await res.json()) as { ok?: boolean; message?: string; error?: string; k_nr?: string; id?: string };
        if (res.ok && json.ok !== false) {
          ok++;
          report.push(`Zeile ${i + 2}: ok ${json.k_nr ?? json.id ?? ""}`);
        } else {
          report.push(`Zeile ${i + 2}: NICHT übernommen – ${json.message ?? json.error ?? res.status}`);
        }
      } catch (e) {
        report.push(`Zeile ${i + 2}: Fehler – ${(e as Error).message}`);
      }
    }
    report.splice(1, 0, `${ok} von ${rows.length} Zeilen übernommen.`);
    fs.mkdirSync(done, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
    fs.renameSync(path.join(dir, file), path.join(done, `${stamp}_${file}`));
    fs.writeFileSync(path.join(done, `${stamp}_${file}.ergebnis.txt`), report.join("\n") + "\n");
    log(`${file}: ${ok}/${rows.length} übernommen.`);
  }
}

async function main() {
  const failures: string[] = [];
  await syncExport().catch((e) => failures.push(`Export: ${e.message}`));
  await processImports().catch((e) => failures.push(`Import: ${e.message}`));
  if (failures.length) {
    failures.forEach((f) => log(f));
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  void main();
}
