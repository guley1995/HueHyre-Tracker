// Import-Skript gegen eine künstliche Gesamtliste/Master-Datei (Aufbau wie im Bauplan beschrieben).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type pg from "pg";
import { readWorkbook } from "../scripts/import/xlsx";
import { buildPlan, normalizeKnr, parseCompanyList, parseDate } from "../scripts/import/transform";
import { loadPlan } from "../scripts/import/load";
import { adminClient, resetData } from "./helpers";

const TODAY = "2026-10-12";
let dir: string;
let db: pg.Client;

async function writeXlsx(file: string, sheets: Record<string, unknown[][]>) {
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) wb.addWorksheet(name).addRows(rows);
  await wb.xlsx.writeFile(file);
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "huehyre-import-"));
  await writeXlsx(path.join(dir, "gesamt.xlsx"), {
    "Alle Bewerber": [
      ["Übersicht aller Bewerber – Stand 12.10."],
      ["K-Nr.", "Name", "E-Mail", "Telefon", "PLZ", "Ort", "Beruf", "Bereich", "Kategorie", "Status", "Quelle", "Einwilligung", "Firmen (vorgestellt bei)", "Notizen"],
      ["K-32", "Uwe Steinle", "uwe@x.de", "0171 111", "72250", "Freudenstadt", "Elektroniker", "Technik", "Aktiv", "Interview bei Humbaur", "Indeed", new Date("2026-09-01"), "Humbaur 12.09.2026; Kögel", ""],
      ["", "Steinle, Uwe", "UWE@x.de", "", "", "", "", "", "Aktiv", "", "", "", "", "Doppelte Zeile"],
      ["K-2026-047", "Petra Wittler", "petra@x.de", "", "72160", "Horb", "Buchhaltung", "Kaufmännisch", "Pausiert", "", "BA", "", "", ""],
      ["K-2026-047", "Klaus Anders", "klaus@x.de", "", "", "Nagold", "Lagerist", "Logistik", "Vermarktet", "", "Gmail", "", "", ""],
      ["K-03", "Tahsin E.", "", "0151 222", "", "", "", "", "Angeschrieben", "", "Telefon", "", "", ""],
      ["", "Olaf Osbra", "olaf@x.de", "", "", "", "", "", "Gesperrt", "Osbra-Mitarbeiter", "", "", "", ""],
      ["", "Mia Maron", "mia@x.de", "", "", "", "", "", "Maron", "", "", "", "", ""],
      ["", "Ali Absage", "ali@x.de", "", "", "", "", "", "Absage", "", "", "", "", ""],
    ],
    "K-Nummern": [
      ["K-Nr", "Name"],
      ["K-32", "Uwe Steinle"],
      ["K-41", "Uwe Steinle"],
      ["K-2026-047", "Petra Wittler"],
      ["K-2026-050", "Nur Hier"],
    ],
    "Sperren & Tabus": [
      ["Name", "Art", "Grund"],
      ["STEP Kunde GmbH", "Firma", "NDA STEP 2.0"],
    ],
    "BA-Bewerberbörse (anonym)": [
      ["Referenznummer", "Suche", "Qualifikation", "Alter", "Ort", "Kontaktiert", "Antwort"],
      ["10000-123", "Elektriker", "Elektroniker", 34, "Horb", "01.10.2026", ""],
      ["10000-124", "Lager", "Fachlagerist", "41 Jahre", "Nagold", "", ""],
    ],
  });
  await writeXlsx(path.join(dir, "master.xlsx"), {
    "Offene Stellen": [
      ["Firma", "Stelle", "Ort", "Link", "Online-Check", "Status"],
      ["Humbaur", "Elektroniker (m/w/d)", "Gersthofen", "https://humbaur.example/jobs/1", "05.10.2026", "online"],
    ],
    "Matching": [
      ["K-Nr", "Kandidat", "Firma", "Stelle", "Vorgestellt am"],
      ["K-2026-047", "Petra Wittler", "Kirstein", "Buchhalter/in", "20.09.2026"],
      ["K-03", "Tahsin E.", "SURTECO", "Lager", ""],
    ],
    "Tabu & Regeln": [
      ["Name", "Art", "Grund", "Gilt für"],
      ["Petra Wittler", "Person", "Ex-Arbeitgeber", "Kirstein"],
    ],
  });
  db = await adminClient();
});

afterAll(async () => {
  await db.end();
  fs.rmSync(dir, { recursive: true, force: true });
});
beforeEach(async () => { await resetData(); });

async function plan() {
  return buildPlan({
    gesamtliste: await readWorkbook(path.join(dir, "gesamt.xlsx")),
    master: await readWorkbook(path.join(dir, "master.xlsx")),
  }, { today: TODAY });
}

describe("Hilfsfunktionen", () => {
  it("normalisiert K-Nummern und Datumsangaben", () => {
    expect(normalizeKnr("K-32")).toBe("K-2026-032");
    expect(normalizeKnr("k 2025-7")).toBe("K-2025-007");
    expect(normalizeKnr("Profil_K-2026-065_HueHYRE")).toBe("K-2026-065");
    expect(parseDate("12.09.", { today: TODAY })).toBe("2026-09-12");
    expect(parseDate("24.12.", { today: TODAY })).toBe("2025-12-24");
    expect(parseDate("1.2.26")).toBe("2026-02-01");
    expect(parseCompanyList("Humbaur 12.09.2026; Kögel (15.09.), Liebherr", { today: TODAY })).toEqual([
      { company: "Humbaur", date: "2026-09-12" }, { company: "Kögel", date: "2026-09-15" }, { company: "Liebherr", date: null },
    ]);
  });
});

describe("Importplan", () => {
  it("mappt Spalten, führt Dubletten zusammen und markiert Klarnamen-Lücken", async () => {
    const p = await plan();
    const steinle = p.candidates.find((c) => c.last_name === "Steinle")!;
    expect(steinle.k_nr).toBe("K-2026-032");
    expect(steinle.legacy_k_nrs).toEqual(["K-2026-041"]);
    expect(steinle.stage).toBe("interview");
    expect(steinle.consent_date).toBe("2026-09-01");
    expect(steinle.category).toBe("Technik");
    expect(p.merged).toHaveLength(1);
    expect(p.candidates.filter((c) => c.last_name === "Steinle")).toHaveLength(1);

    const tahsin = p.candidates.find((c) => c.first_name === "Tahsin")!;
    expect(tahsin.name_gap).toBe(true);
    expect(tahsin.notes).toContain("Klarname fehlt");

    expect(p.candidates.find((c) => c.last_name === "Osbra")!.stage).toBe("raus");
    expect(p.candidates.find((c) => c.last_name === "Maron")!).toMatchObject({ stage: "pool", source: "Maron" });
    expect(p.candidates.find((c) => c.last_name === "Wittler")!.stage).toBe("pausiert");

    // Doppelt vergebene K-2026-047: zweite Person bekommt neue Nummer.
    const anders = p.candidates.find((c) => c.last_name === "Anders")!;
    expect(anders.k_nr).toBeNull();
    expect(anders.legacy_k_nrs).toContain("K-2026-047");

    // Nur im K-Nummern-Blatt → Pool + Warnung
    expect(p.candidates.find((c) => c.k_nr === "K-2026-050")!.stage).toBe("pool");

    expect(p.presentations.map((x) => `${x.company}@${x.sent_date}`).sort()).toEqual(["Humbaur@2026-09-12", "Kirstein@2026-09-20"]);
    expect(p.issues.some((i) => i.message.includes("Kögel") && i.message.includes("ohne Datum"))).toBe(true);
    expect(p.jobs.find((j) => j.title === "Lager")!.source_type).toBe("Vorschlag");
    expect(p.jobs.find((j) => j.title.startsWith("Elektroniker"))!.last_checked_date).toBe("2026-10-05");
    expect(p.baProfiles).toHaveLength(2);
    expect(p.baProfiles[1].age).toBe(41);
  });
});

describe("Laden in die Datenbank", () => {
  it("schreibt alles, behält K-Nummern, legt Sperren an – Probelauf ändert nichts", async () => {
    const dry = await loadPlan(db, await plan(), { dryRun: true });
    expect(dry.totals.candidates).toBe(8);
    expect((await db.query("select count(*)::int as n from public.candidates")).rows[0].n).toBe(0);

    const r = await loadPlan(db, await plan(), { dryRun: false });
    expect(r.issues).toEqual([]);
    expect(r.totals).toMatchObject({ candidates: 8, presentations: 2, ba_profiles: 2 });

    const { rows } = await db.query("select k_nr, legacy_k_nrs, last_name, stage from public.candidates order by k_nr");
    expect(rows.find((x) => x.last_name === "Steinle")).toMatchObject({ k_nr: "K-2026-032", legacy_k_nrs: ["K-2026-041"] });
    expect(rows.find((x) => x.last_name === "Anders")!.k_nr).toBe("K-2026-051"); // nach höchster vorhandener Nummer
    const acts = await db.query("select distinct created_by from public.activities");
    expect(acts.rows.map((a) => a.created_by)).toEqual(["Import"]);

    // Sperren greifen danach in der Vorstellungsprüfung.
    const check = await db.query(`select public.check_presentation(c.id, f.id, null, true) as r
      from public.candidates c, public.companies f where c.last_name = 'Wittler' and f.name = 'Kirstein'`);
    expect(check.rows[0].r.blocking.map((b: { code: string }) => b.code)).toEqual(expect.arrayContaining(["DUPLICATE_PRESENTATION", "BLOCKLIST"]));
    const step = await db.query("select stage from public.companies where name = 'STEP Kunde GmbH'");
    expect(step.rows[0].stage).toBe("tabu");
    const osbra = await db.query("select count(*)::int as n from public.blocklist b join public.candidates c on c.id = b.candidate_id where c.last_name = 'Osbra'");
    expect(osbra.rows[0].n).toBe(1);
  });

  it("zweiter Lauf erzeugt keine Dubletten", async () => {
    await loadPlan(db, await plan(), { dryRun: false });
    const second = await loadPlan(db, await plan(), { dryRun: false });
    expect(second.issues).toEqual([]);
    expect(second.stats.candidates.inserted ?? 0).toBe(0);
    expect(second.totals).toMatchObject({ candidates: 8, presentations: 2, ba_profiles: 2 });
  });
});
