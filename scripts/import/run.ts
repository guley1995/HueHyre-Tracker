// Einmaliger Import der bestehenden Excel-Listen.
//
//   npm run import -- --inspect --gesamtliste HueHYRE_Bewerber_Gesamtliste.xlsx --master HueHYRE_Kandidaten_Master.xlsx
//   npm run import -- --dry-run --gesamtliste … --master … --leads HueHYRE_Akquise_Leads_2026-09-23.xlsx --leads Kaltakquise_Firmen_2026-09-23.xlsx
//   npm run import -- --gesamtliste … --master … --leads … [--cv-dir "…/CVs"]
//
// Verbindung: IMPORT_DATABASE_URL (direkte Supabase-Verbindung als postgres, siehe README).
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { readWorkbook, type Sheet } from "./xlsx";
import { buildPlan, normalizeKnr, type Issue } from "./transform";
import { loadPlan } from "./load";

pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

function args() {
  const a = process.argv.slice(2);
  const out: { gesamtliste?: string; master?: string; leads: string[]; cvDir?: string; dryRun: boolean; inspect: boolean; report?: string } =
    { leads: [], dryRun: false, inspect: false };
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    if (k === "--dry-run") out.dryRun = true;
    else if (k === "--inspect") out.inspect = true;
    else if (k === "--gesamtliste") out.gesamtliste = a[++i];
    else if (k === "--master") out.master = a[++i];
    else if (k === "--leads") out.leads.push(a[++i]);
    else if (k === "--cv-dir") out.cvDir = a[++i];
    else if (k === "--report") out.report = a[++i];
    else throw new Error(`Unbekannte Option ${k}`);
  }
  return out;
}

function inspect(label: string, sheets: Sheet[]) {
  console.log(`\n=== ${label}`);
  for (const s of sheets) {
    console.log(`  Blatt „${s.name}“: ${s.rows.length} Zeilen`);
    console.log(`    Spalten: ${s.headers.join(" | ")}`);
  }
}

function report(file: string, data: {
  dryRun: boolean; inputs: string[]; plan: ReturnType<typeof buildPlan>; stats: Record<string, { inserted: number; updated: number; skipped: number }>;
  totals: Record<string, number>; loadIssues: Issue[]; cv?: { uploaded: number; unmatched: string[] };
}) {
  const { plan } = data;
  const issues = [...plan.issues, ...data.loadIssues];
  const lines: string[] = [];
  lines.push(`# Prüfbericht Import – ${new Date().toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}`, "");
  lines.push(data.dryRun ? "**Probelauf (--dry-run): nichts wurde gespeichert.**" : "**Import gespeichert.**", "");
  lines.push("Quellen: " + data.inputs.map((f) => `\`${path.basename(f)}\``).join(", "), "");
  lines.push("## Anzahl je Tabelle", "", "| Tabelle | aus Excel | neu | aktualisiert | übersprungen | Bestand danach |", "|---|---:|---:|---:|---:|---:|");
  const planned: Record<string, number> = {
    candidates: plan.candidates.length, companies: plan.companies.length, contacts: plan.contacts.length, jobs: plan.jobs.length,
    presentations: plan.presentations.length, blocklist: plan.blocklist.length, ba_profiles: plan.baProfiles.length,
    self_applications: plan.candidates.reduce((n, c) => n + c.self_applications.length, 0),
  };
  for (const t of Object.keys(data.totals)) {
    const s = data.stats[t] ?? { inserted: 0, updated: 0, skipped: 0 };
    lines.push(`| ${t} | ${planned[t] ?? "–"} | ${s.inserted} | ${s.updated} | ${s.skipped} | ${data.totals[t]} |`);
  }
  const errors = issues.filter((i) => i.level === "fehler");
  const warnings = issues.filter((i) => i.level === "warnung");
  const infos = issues.filter((i) => i.level === "info");
  lines.push("", `## Abgelehnte Zeilen / Fehler (${errors.length})`, "");
  lines.push(...(errors.length ? errors.map((i) => `- **${i.source}**: ${i.message}`) : ["Keine."]));
  lines.push("", `## Zusammengeführte Dubletten (${plan.merged.length})`, "");
  lines.push(...(plan.merged.length ? plan.merged.map((m) => `- ${m.merged} → ${m.kept} (gleiche ${m.reason})`) : ["Keine."]));
  const legacy = plan.candidates.filter((c) => c.legacy_k_nrs.length);
  lines.push("", `## Alte Doppel-K-Nummern (${legacy.length})`, "");
  lines.push(...(legacy.length ? legacy.map((c) => `- ${c.k_nr ?? "(neue Nummer)"} ${c.first_name ?? ""} ${c.last_name ?? ""}: alt ${c.legacy_k_nrs.join(", ")}`) : ["Keine."]));
  const gaps = plan.candidates.filter((c) => c.name_gap);
  lines.push("", `## Klarname fehlt – markiert, nicht geraten (${gaps.length})`, "");
  lines.push(...(gaps.length ? gaps.map((c) => `- ${c.k_nr ?? "(ohne K-Nr.)"} „${[c.first_name, c.last_name].filter(Boolean).join(" ") || "?"}“`) : ["Keine."]));
  lines.push("", `## Warnungen (${warnings.length})`, "");
  lines.push(...(warnings.length ? warnings.map((i) => `- **${i.source}**: ${i.message}`) : ["Keine."]));
  if (infos.length) lines.push("", `## Hinweise (${infos.length})`, "", ...infos.map((i) => `- **${i.source}**: ${i.message}`));
  if (data.cv) {
    lines.push("", `## CVs/Profile (${data.cv.uploaded} hochgeladen)`, "");
    if (data.cv.unmatched.length) lines.push("Ohne passende K-Nummer:", ...data.cv.unmatched.map((f) => `- ${f}`));
  }
  fs.writeFileSync(file, lines.join("\n") + "\n");
}

function listFiles(dir: string): string[] {
  const files: string[] = [];
  const walk = (d: string) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : /\.(pdf|docx?|png|jpe?g)$/i.test(e.name) && files.push(path.join(d, e.name)));
  walk(dir);
  return files;
}

const knrInName = (f: string) =>
  normalizeKnr(path.basename(f).match(/K[\s_-]*(\d{4}[\s_-]+)?\d{1,4}/i)?.[0].replace(/[\s_]/g, "-") ?? null);

/** K-Nummern aus Dateinamen (z. B. Profil_K-2026-67_HueHYRE.pdf) – werden beim Import reserviert. */
function knrsInFiles(dir: string): string[] {
  return listFiles(dir).map(knrInName).filter(Boolean) as string[];
}

async function uploadCvs(dir: string, db: pg.Client) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Für --cv-dir: NEXT_PUBLIC_SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY setzen.");
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { rows } = await db.query<{ id: string; k_nr: string; legacy_k_nrs: string[]; cv_file: string | null }>(
    "select id, k_nr, legacy_k_nrs, cv_file from public.candidates");
  const byKnr = new Map<string, (typeof rows)[number]>();
  for (const r of rows) for (const k of [r.k_nr, ...r.legacy_k_nrs]) byKnr.set(k, r);
  const files = listFiles(dir);
  let uploaded = 0;
  const unmatched: string[] = [];
  for (const f of files) {
    const k = knrInName(f);
    const cand = k ? byKnr.get(k) : undefined;
    if (!cand) { unmatched.push(path.relative(dir, f)); continue; }
    const name = path.basename(f).replace(/[^\w.\-äöüÄÖÜß ]+/g, "_");
    const { error } = await sb.storage.from("cvs").upload(`${cand.k_nr}/${name}`, fs.readFileSync(f), { upsert: true });
    if (error) { unmatched.push(`${path.relative(dir, f)} (Fehler: ${error.message})`); continue; }
    // Haupt-CV: eigener CV vor dem generierten Profil_K-….pdf.
    if (!cand.cv_file || !/^Profil_/i.test(name)) {
      cand.cv_file = `${cand.k_nr}/${name}`;
      await db.query("update public.candidates set cv_file = $2 where id = $1", [cand.id, cand.cv_file]);
    }
    uploaded++;
  }
  return { uploaded, unmatched };
}

async function main() {
  const o = args();
  if (!o.gesamtliste && !o.master && !o.leads.length) {
    console.log("Nutzung: npm run import -- [--inspect|--dry-run] --gesamtliste <xlsx> --master <xlsx> [--leads <xlsx> …] [--cv-dir <ordner>]");
    process.exit(1);
  }
  const gesamtliste = o.gesamtliste ? await readWorkbook(o.gesamtliste) : undefined;
  const master = o.master ? await readWorkbook(o.master) : undefined;
  const leads = await Promise.all(o.leads.map(async (f) => ({ file: path.basename(f), sheets: await readWorkbook(f) })));

  if (o.inspect) {
    if (gesamtliste) inspect(o.gesamtliste!, gesamtliste);
    if (master) inspect(o.master!, master);
    for (const l of leads) inspect(l.file, l.sheets);
    const plan = buildPlan({ gesamtliste, master, leads });
    console.log(`\nPlan: ${plan.candidates.length} Kandidaten, ${plan.companies.length} Firmen, ${plan.jobs.length} Stellen, ` +
      `${plan.presentations.length} Vorstellungen, ${plan.blocklist.length} Sperren, ${plan.baProfiles.length} BA-Profile, ` +
      `${plan.merged.length} Dubletten zusammengeführt, ${plan.issues.length} Meldungen.`);
    return;
  }

  const conn = process.env.IMPORT_DATABASE_URL;
  if (!conn) throw new Error("IMPORT_DATABASE_URL fehlt (direkte Verbindung als postgres).");
  const db = new pg.Client({ connectionString: conn, ssl: conn.includes("localhost") ? undefined : { rejectUnauthorized: false } });
  await db.connect();
  try {
    const plan = buildPlan({ gesamtliste, master, leads });
    const result = await loadPlan(db, plan, { dryRun: o.dryRun, reserveKnrs: o.cvDir ? knrsInFiles(o.cvDir) : [] });
    const cv = o.cvDir && !o.dryRun ? await uploadCvs(o.cvDir, db) : undefined;
    const file = o.report ?? `import-report-${new Date().toISOString().slice(0, 10)}${o.dryRun ? "-probelauf" : ""}.md`;
    report(file, {
      dryRun: o.dryRun, inputs: [o.gesamtliste, o.master, ...o.leads].filter(Boolean) as string[], plan,
      stats: result.stats, totals: result.totals, loadIssues: result.issues, cv,
    });
    const errors = [...plan.issues, ...result.issues].filter((i) => i.level === "fehler").length;
    console.log(`${o.dryRun ? "Probelauf" : "Import"} fertig. Prüfbericht: ${file} (${errors} Fehler).`);
    console.table(result.totals);
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
