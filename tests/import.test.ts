// Import-Skript gegen eine künstliche Gesamtliste/Master-Datei (Aufbau wie im Bauplan beschrieben).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type pg from "pg";
import { readWorkbook } from "../scripts/import/xlsx";
import { buildPlan, cleanEmail, companyKey, normalizeKnr, parseBlockScope, parseCompanyList, parseDate, parseFirmenText, parsePresentedList } from "../scripts/import/transform";
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
      ["K-Nr.", "Name", "E-Mail", "Telefon", "PLZ", "Ort", "Beruf", "Bereich", "Kategorie", "Status", "Quelle", "Einwilligung", "Firmen (vorgestellt / gematcht / Ziel)", "Besonderheiten / Sperren"],
      ["K-32", "Uwe Steinle", "uwe@x.de", "0171 111", "72250", "Freudenstadt", "Elektroniker", "Technik", "Aktiv", "Interview bei Humbaur", "Indeed", new Date("2026-09-01"), "Humbaur 12.09.2026; Kögel | Vorgestellt: Humbaur (12.09.2026), Kögel | Matching: Liebherr – Elektriker (80 %", ""],
      ["", "Steinle, Uwe", "UWE@x.de", "", "", "", "", "", "Aktiv", "", "", "", "", "Doppelte Zeile"],
      ["K-2026-047", "Petra Wittler", "petra@x.de", "", "72160", "Horb", "Buchhaltung", "Kaufmännisch", "Pausiert", "", "BA", "", "", ""],
      ["K-2026-047", "Klaus Anders", "klaus@x.de", "", "", "Nagold", "Lagerist", "Logistik", "Vermarktet", "", "Gmail", "", "", ""],
      ["K-03", "Tahsin E.", "", "0151 222", "", "", "", "", "Angeschrieben", "", "Telefon", "", "", ""],
      ["", "Olaf Osbra", "olaf@x.de", "", "", "", "", "", "Gesperrt", "Osbra-Mitarbeiter", "", "", "", ""],
      ["", "Mia Maron", "mia@x.de", "", "", "", "", "", "Maron", "", "", "", "", ""],
      ["", "Ali Absage", "ali@x.de", "", "", "", "", "", "Absage", "", "", "", "", ""],
      // Platzhalter statt E-Mail: darf nicht zur Dublette führen.
      ["", "Ina Indeed", "(CV) — (nur über Indeed-Chat erreichbar)", "", "", "", "", "", "Nur gescreent", "", "Indeed", "", "", ""],
      ["", "Ole Indeed", "(CV) — (nur über Indeed-Chat erreichbar)", "", "", "", "", "", "Nur gescreent", "", "Indeed", "", "Indeed-Ziel: Sortimo – Mechaniker (88 %", ""],
      // Sperre nur für eine Firma.
      ["", "Nico Ritterer", "nico@x.de", "", "", "", "", "", "⛔ Gesperrt", "Indeed: Offen", "", "", "", "Aktuell bei Ritter – nicht zu Ritter | SPERRE: aktuell Ritter (für: Ritter)"],
      // Firma in der Personenliste.
      ["", "OPTIMA packaging group (Schwäbisch Hall)", "", "", "", "", "", "", "⛔ Gesperrt", "", "", "", "", "SPERRE: keine Zusammenarbeit (für: alle)"],
      ["", "Ed Schwab", "ed@x.de", "", "", "", "", "", "Aktiv", "", "", "", "Vorgestellt: Craiss, Sirl (07.10.2026); GROB?, AIB (Absage) | Selbst beworben: DAHER (Absage 09.10.), Aracom u. a.", ""],
      ["", "Tom Schwab", "tom@x.de", "", "", "", "", "", "Absage", "", "", "", "", ""],
      ["", "Uta Tkocz", "uta@x.de", "", "", "", "", "", "Maron", "", "", "", "", ""],
    ],
    "K-Nummern": [
      ["K-Nr", "Name"],
      ["K-32", "Uwe Steinle"],
      ["K-41", "Uwe Steinle"],
      ["K-2026-047", "Petra Wittler"],
      ["K-2026-050", "Nur Hier"],
      ["K-58", "Uwe Steinle (= K-32)"],
      ["K-2026-04", "kein Treffer"],
      ["K-2026-13", "Kovbuz, Khan oder Kaya (Maron)"],
      ["K-2026-16", "Tkocz (Maron)"],
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
      ["Bauer, Optima Packaging", "", "Haben abgelehnt – nie wieder anschreiben", ""],
      ["Grenzebach, Humbaur*, alle STEP 2.0 / KMS-Kunden", "", "NDA Ex-Arbeitgeber (Humbaur nur über Frau Hasler)", ""],
      ["Kögel für Schwab", "", "war dort über Zeitarbeit", ""],
      ["AGG", "", "Kein Alter in Profilen", ""],
      ["Glas Seele (Neusäß)", "", "Absage 13.10.: derzeit kein Bedarf", ""],
    ],
    "Kandidaten": [
      ["Prio", "Name", "K-Nr.", "Kernkompetenzen", "Gehalt (Wunsch)", "Wünsche / Ausschlüsse", "Bereits vorgestellt bei (nicht doppelt!)", "Selbst beworben bei", "Nächster Schritt"],
      ["A", "Ed Schwab", "", "SPS, Vertrieb", "ca. 60k", "keine Kanzlei", "Craiss (07.10.2026), Mader (Zustimmung 09.10.2026)", "Hilti", "Feedback Mader"],
      ["B", "Tkocz", "", "Lager", "", "", "", "", ""],
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
  it("erkennt Platzhalter, Abschnitte, Firmenlisten und Sperr-Geltungsbereiche", () => {
    expect(cleanEmail("(CV) — (nur über Indeed-Chat erreichbar)")).toBeNull();
    expect(cleanEmail(" Eva@X.de ")).toBe("eva@x.de");
    expect(companyKey("OPTIMA packaging group (Schwäbisch Hall)")).toBe(companyKey("Optima Packaging"));
    expect(companyKey("Hoffmann Group")).not.toBe(companyKey("Hoffmann Supply Chain"));
    expect(parsePresentedList("Craiss, Sirl, Koffer-Kopf (07.10.); Humbaur (10.10., Kreditor), GROB?, Mader (Zustimmung 09.10.)", { today: TODAY }))
      .toEqual([
        { company: "Craiss", date: "2026-10-07", detail: null, uncertain: false },
        { company: "Sirl", date: "2026-10-07", detail: null, uncertain: false },
        { company: "Koffer-Kopf", date: "2026-10-07", detail: "07.10.", uncertain: false },
        { company: "Humbaur", date: "2026-10-10", detail: "10.10., Kreditor", uncertain: false },
        { company: "GROB", date: null, detail: null, uncertain: true },
        { company: "Mader", date: "2026-10-09", detail: "Zustimmung 09.10.", uncertain: false },
      ]);
    const f = parseFirmenText("Humbaur Fibu (Pitch 31.08.) | Vorgestellt: CABB (08.10.) | Selbst beworben: DAHER (Absage), Aracom u. a. | Matching: seele – Buchhalter (85 %", { today: TODAY });
    expect(f.presented.map((x) => x.company)).toEqual(["CABB"]);
    expect(f.selfApplied).toEqual(["DAHER", "Aracom"]);
    expect(f.rest).toEqual(["Humbaur Fibu (Pitch 31.08.)", "Matching: seele – Buchhalter (85 %"]);
    expect(parseBlockScope("Aktuell bei Ritter – nicht zu Ritter | SPERRE: aktuell Ritter (für: Ritter)")).toEqual({ all: false, companies: ["Ritter"] });
    expect(parseBlockScope("SPERRE: aktuell Humbaur (Anlagenführer) (für: Kögel/Humbaur)")).toEqual({ all: false, companies: ["Kögel", "Humbaur"] });
    expect(parseBlockScope("Aktuell bei Humbaur – nicht zu Kögel/Humbaur")).toEqual({ all: false, companies: ["Kögel", "Humbaur"] });
    expect(parseBlockScope("SPERRE: Ex-Kögel (für: Kögel (Hinweis))")).toEqual({ all: false, companies: ["Kögel"] });
    expect(parseBlockScope("SPERRE: Osbra (für: Sortimo Produktionsplaner, alle anderen)").all).toBe(true);
    expect(parseBlockScope("Osbra-Mitarbeiter").all).toBe(true);
  });

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
    expect(steinle.legacy_k_nrs).toEqual(["K-2026-041", "K-2026-058"]); // „Uwe Steinle (= K-32)“ im K-Nummern-Blatt
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

    expect(p.presentations.map((x) => `${x.company}@${x.sent_date}`).sort()).toEqual(["Craiss@2026-10-07", "Humbaur@2026-09-12", "Kirstein@2026-09-20", "Mader@2026-10-09", "Sirl@2026-10-07"]);
    expect(p.issues.some((i) => i.message.includes("Kögel") && i.message.includes("ohne Datum"))).toBe(true);
    expect(p.jobs.find((j) => j.title === "Lager")!.source_type).toBe("Vorschlag");
    expect(p.jobs.find((j) => j.title.startsWith("Elektroniker"))!.last_checked_date).toBe("2026-10-05");
    expect(p.baProfiles).toHaveLength(2);
    expect(p.baProfiles[1].age).toBe(41);
  });
});

describe("Importplan mit echten Listenmustern", () => {
  it("führt Platzhalter-E-Mails nicht zusammen und übernimmt Freitext nur als Notiz", async () => {
    const p = await plan();
    expect(p.merged.map((m) => m.reason)).toEqual(["E-Mail"]); // nur Steinle
    const ole = p.candidates.find((c) => c.first_name === "Ole")!;
    expect(ole.email).toBeNull();
    expect(ole.notes).toContain("Kontakt laut Liste: (CV)");
    expect(ole.notes).toContain("Firmen/Matching laut Liste: Indeed-Ziel: Sortimo");
    expect(p.candidates.find((c) => c.first_name === "Ina")).toBeTruthy();
    expect(p.companies.some((c) => /Indeed-Ziel|Sortimo/.test(c.name))).toBe(false);
  });

  it("K-Nummern-Blatt: Platzhalter und unsichere Zuordnungen anlegen nichts, Nachname wird eindeutig zugeordnet", async () => {
    const p = await plan();
    expect(p.candidates.some((c) => /treffer|kovbuz|kaya/i.test(`${c.first_name} ${c.last_name}`))).toBe(false);
    expect(p.issues.some((i) => i.level === "warnung" && i.message.includes("K-2026-013") && i.message.includes("unsicher"))).toBe(true);
    expect(p.candidates.find((c) => c.last_name === "Tkocz")!.k_nr).toBe("K-2026-016");
    expect(p.candidates.filter((c) => c.last_name === "Steinle")).toHaveLength(1);
  });

  it("Master „Kandidaten“ ergänzt Profil, Selbstbewerbungen und Vorstellungen", async () => {
    const p = await plan();
    const ed = p.candidates.find((c) => c.first_name === "Ed")!;
    expect(ed).toMatchObject({ skills: "SPS, Vertrieb", salary_wish: "ca. 60k", exclusions: "keine Kanzlei", next_action: "Feedback Mader", priority: "A" });
    expect(ed.self_applications.sort()).toEqual(["Aracom", "DAHER", "Hilti"]);
    expect(p.presentations.filter((x) => x.candidateKey === ed.key)).toHaveLength(3); // Craiss nur einmal, Sirl, Mader
    expect(p.issues.some((i) => i.message.includes("GROB?") && i.message.includes("unsicher"))).toBe(true);
    expect(p.candidates.find((c) => c.last_name === "Tkocz")!.skills).toBe("Lager");
  });

  it("Sperren: Geltungsbereich, Firma in Personenliste, Regeln, Sternchen und Ruhend", async () => {
    const p = await plan();
    expect(p.candidates.some((c) => /optima/i.test(`${c.first_name} ${c.last_name}`))).toBe(false);
    const ritterer = p.blocklist.filter((b) => b.name === "Nico Ritterer");
    expect(ritterer).toEqual([expect.objectContaining({ type: "Person", company: "Ritter" })]);
    const firms = p.blocklist.filter((b) => b.type === "Firma").map((b) => b.company).sort();
    expect(firms).toEqual(["Bauer", "Grenzebach", "OPTIMA packaging group", "STEP Kunde GmbH"]);
    expect(p.companies.find((c) => c.name === "OPTIMA packaging group")).toMatchObject({ stage: "tabu", city: "Schwäbisch Hall" });
    expect(p.companies.find((c) => c.name === "Humbaur")!.stage).not.toBe("tabu");
    expect(p.companies.find((c) => c.name === "Humbaur")!.notes).toContain("Frau Hasler");
    expect(p.companies.find((c) => c.name === "Glas Seele")!.stage).toBe("ruhend");
    expect(p.blocklist.filter((b) => b.type === "Regel").map((b) => b.name).sort()).toEqual(["AGG", "alle STEP 2.0 / KMS-Kunden"]);
    const ed = p.candidates.find((c) => c.first_name === "Ed")!;
    expect(p.blocklist.find((b) => b.candidateKey === ed.key)).toMatchObject({ company: "Kögel" });
  });
});

describe("Laden in die Datenbank", () => {
  it("schreibt alles, behält K-Nummern, legt Sperren an – Probelauf ändert nichts", async () => {
    const dry = await loadPlan(db, await plan(), { dryRun: true });
    expect(dry.totals.candidates).toBe(14);
    expect((await db.query("select count(*)::int as n from public.candidates")).rows[0].n).toBe(0);

    const r = await loadPlan(db, await plan(), { dryRun: false });
    expect(r.issues).toEqual([]);
    expect(r.totals).toMatchObject({ candidates: 14, presentations: 5, ba_profiles: 2 });

    const { rows } = await db.query("select k_nr, legacy_k_nrs, last_name, stage from public.candidates order by k_nr");
    expect(rows.find((x) => x.last_name === "Steinle")).toMatchObject({ k_nr: "K-2026-032", legacy_k_nrs: ["K-2026-041", "K-2026-058"] });
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
    expect(second.totals).toMatchObject({ candidates: 14, presentations: 5, ba_profiles: 2 });
  });
});
