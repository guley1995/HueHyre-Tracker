// Schutzregeln aus dem Bauplan, direkt gegen die Datenbank (Rolle authenticated).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { appClient, newCandidate, newCompany, resetData, rpc } from "./helpers";

let db: pg.Client;
beforeAll(async () => { db = await appClient(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await resetData(); });

type PresResult = { ok: boolean; reason?: string; message?: string;
  blocking: { code: string }[]; confirm: { code: string }[]; hints: { code: string }[] };

const present = (cid: string, fid: string, opts: { anonymous?: boolean; confirm?: boolean; jobId?: string } = {}) =>
  rpc<PresResult>(db, "public.create_presentation(p_candidate_id => $1, p_company_id => $2, p_job_id => $3, p_anonymous => $4, p_confirm => $5)",
    [cid, fid, opts.jobId ?? null, opts.anonymous ?? false, opts.confirm ?? false]);

describe("K-Nummer", () => {
  it("wird automatisch fortlaufend vergeben", async () => {
    const a = await newCandidate(db, { first_name: "A", last_name: "Eins", source: "Indeed", email: "a@x.de" });
    const b = await newCandidate(db, { first_name: "B", last_name: "Zwei", source: "Indeed", email: "b@x.de" });
    expect(a.k_nr).toMatch(/^K-\d{4}-001$/);
    expect(b.k_nr).toMatch(/^K-\d{4}-002$/);
  });

  it("kann von der App weder manuell gesetzt noch geändert werden", async () => {
    const { rows } = await db.query(
      "insert into public.candidates (k_nr, last_name) values ('K-2026-999', 'Manuell') returning k_nr");
    expect(rows[0].k_nr).not.toBe("K-2026-999");
    await expect(db.query("update public.candidates set k_nr = 'K-2026-500'")).rejects.toThrow(/K-Nummer/);
  });
});

describe("Dublettenprüfung", () => {
  it("erkennt eine Testperson mit gleicher E-Mail (Groß-/Kleinschreibung egal)", async () => {
    const first = await newCandidate(db, { first_name: "Eva", last_name: "Test", email: "eva@test.de", source: "Indeed" });
    const r = await rpc<{ ok: boolean; reason: string; message: string; duplicates: { k_nr: string; match: string }[] }>(
      db, "public.create_candidate($1::jsonb)", [JSON.stringify({ first_name: "E.", last_name: "T", email: " EVA@test.de" })]);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("duplicate");
    expect(r.duplicates[0]).toMatchObject({ k_nr: first.k_nr, match: "email" });
    expect(r.message).toContain(`Existiert schon als ${first.k_nr}`);
  });

  it("erkennt gleiche Telefonnummer in anderer Schreibweise", async () => {
    await newCandidate(db, { last_name: "Tel", phone: "+49 (171) 123-4567", source: "Telefon" });
    const r = await rpc<{ ok: boolean; duplicates: { match: string }[] }>(
      db, "public.create_candidate($1::jsonb)", [JSON.stringify({ last_name: "Anders", phone: "0171 1234567" })]);
    expect(r.ok).toBe(false);
    expect(r.duplicates[0].match).toBe("phone");
  });

  it("Name+PLZ ist eine Warnung, die sich bewusst übergehen lässt", async () => {
    await newCandidate(db, { first_name: "Jan", last_name: "Meier", plz: "72250", source: "BA" });
    const dup = await rpc<{ ok: boolean; duplicates: { match: string }[] }>(
      db, "public.create_candidate($1::jsonb)", [JSON.stringify({ first_name: "jan", last_name: "MEIER", plz: "72250" })]);
    expect(dup.ok).toBe(false);
    expect(dup.duplicates[0].match).toBe("name_ort");
    const forced = await rpc<{ ok: boolean }>(
      db, "public.create_candidate($1::jsonb, true)", [JSON.stringify({ first_name: "Jan", last_name: "Meier", plz: "72250" })]);
    expect(forced.ok).toBe(true);
  });

  it("Unique-Index stoppt E-Mail-Dubletten auch bei direktem Insert", async () => {
    await newCandidate(db, { last_name: "X", email: "x@x.de", source: "BA" });
    await expect(db.query("insert into public.candidates (last_name, email) values ('Y', 'X@X.DE')")).rejects.toThrow(/duplicate key/);
  });

  it("Zusammenführen übernimmt Vorstellungen und merkt sich die alte K-Nummer", async () => {
    const keep = await newCandidate(db, { first_name: "Uwe", last_name: "Steinle", email: "uwe@a.de", source: "BA" });
    const dupe = await newCandidate(db, { first_name: "Uwe", last_name: "Steinle", phone: "0170 999", source: "Indeed" });
    const f = await newCompany(db, "Firma A");
    await present(dupe.id, f, { anonymous: true });
    const r = await rpc<{ ok: boolean }>(db, "public.merge_candidates($1, $2)", [keep.id, dupe.id]);
    expect(r.ok).toBe(true);
    const { rows } = await db.query("select phone, legacy_k_nrs from public.candidates where id = $1", [keep.id]);
    expect(rows[0].phone).toBe("0170 999");
    expect(rows[0].legacy_k_nrs).toContain(dupe.k_nr);
    const p = await db.query("select count(*)::int as n from public.presentations where candidate_id = $1", [keep.id]);
    expect(p.rows[0].n).toBe(1);
  });
});

describe("Vorstellung", () => {
  it("zweite Vorstellung bei derselben Firma wird gestoppt (mit Datum der ersten)", async () => {
    const c = await newCandidate(db, { last_name: "Doppel", email: "d@x.de", source: "BA", consent_date: "2026-10-01" });
    const f = await newCompany(db, "Kirstein");
    expect((await present(c.id, f)).ok).toBe(true);
    const second = await present(c.id, f, { confirm: true });
    expect(second.ok).toBe(false);
    expect(second.blocking[0].code).toBe("DUPLICATE_PRESENTATION");
    expect(second.message).toMatch(/vorgestellt am \d{2}\.\d{2}\.\d{4}/);
  });

  it("Kögel nach Humbaur (Schwesterfirma) wird gestoppt, außer mit Bestätigung", async () => {
    const c = await newCandidate(db, { last_name: "Schwester", email: "s@x.de", source: "BA", consent_date: "2026-10-01" });
    const humbaur = await newCompany(db, "Humbaur", { group_name: "Humbaur/Kögel" });
    const koegel = await newCompany(db, "Kögel", { group_name: "humbaur/kögel" });
    expect((await present(c.id, humbaur)).ok).toBe(true);
    const r = await present(c.id, koegel);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("needs_confirmation");
    expect(r.confirm[0].code).toBe("SISTER_COMPANY");
    expect((await present(c.id, koegel, { confirm: true })).ok).toBe(true);
  });

  it("gesperrte Person (z. B. Osbra-Mitarbeiter) kann nicht vorgestellt werden", async () => {
    const c = await newCandidate(db, { first_name: "Olaf", last_name: "Osbra", email: "o@x.de", source: "BA", consent_date: "2026-10-01" });
    const f = await newCompany(db, "Irgendwer GmbH");
    await db.query("insert into public.blocklist (type, name, candidate_id, reason) values ('Person', 'Olaf Osbra', $1, 'Osbra-Mitarbeiter')", [c.id]);
    const r = await present(c.id, f, { confirm: true });
    expect(r.ok).toBe(false);
    expect(r.blocking.map((b) => b.code)).toContain("BLOCKLIST");
  });

  it("Sperre per Name greift auch ohne Verknüpfung; Sperre nur für eine Firma gilt nur dort", async () => {
    const c = await newCandidate(db, { first_name: "Nina", last_name: "Name", email: "n@x.de", source: "BA", consent_date: "2026-10-01" });
    const a = await newCompany(db, "Firma A");
    const b = await newCompany(db, "Firma B");
    await db.query("insert into public.blocklist (type, name, scope, company_id, reason) values ('Person', 'nina  name', 'nur_firma', $1, 'Ex-Arbeitgeber')", [a]);
    expect((await present(c.id, a)).blocking[0]?.code).toBe("BLOCKLIST");
    expect((await present(c.id, b)).ok).toBe(true);
  });

  it("Firma auf Tabu oder Sperrliste (Regel, z. B. STEP-2.0-Kunde) stoppt", async () => {
    const c = await newCandidate(db, { last_name: "K", email: "k@x.de", source: "BA", consent_date: "2026-10-01" });
    const tabu = await newCompany(db, "Tabu AG");
    await rpc(db, "public.move_company($1, 'tabu', $2::jsonb)", [tabu, JSON.stringify({ reason: "hat abgelehnt" })]);
    const step = await newCompany(db, "Step Kunde GmbH");
    await db.query("insert into public.blocklist (type, name, reason) values ('Regel', 'Step Kunde GmbH', 'NDA STEP 2.0')");
    expect((await present(c.id, tabu)).blocking.map((b) => b.code)).toEqual(expect.arrayContaining(["COMPANY_TABU", "BLOCKLIST"]));
    expect((await present(c.id, step)).blocking[0].code).toBe("BLOCKLIST");
  });

  it("selbst beworben → Stopp", async () => {
    const c = await newCandidate(db, { last_name: "Selbst", email: "self@x.de", source: "BA", consent_date: "2026-10-01" });
    const f = await newCompany(db, "SURTECO GmbH");
    await db.query("insert into public.self_applications (candidate_id, company_name, date) values ($1, 'Surteco', '2026-09-01')", [c.id]);
    const r = await present(c.id, f);
    expect(r.ok).toBe(false);
    expect(r.blocking[0].code).toBe("SELF_APPLIED");
  });

  it("ohne Einwilligung nur anonym", async () => {
    const c = await newCandidate(db, { last_name: "Anonym", email: "an@x.de", source: "BA" });
    const f = await newCompany(db, "Firma C");
    expect((await present(c.id, f)).blocking[0].code).toBe("CONSENT_MISSING");
    expect((await present(c.id, f, { anonymous: true })).ok).toBe(true);
  });

  it("Stellencheck älter als 7 Tage gibt Hinweis, blockiert aber nicht", async () => {
    const c = await newCandidate(db, { last_name: "Job", email: "j@x.de", source: "BA", consent_date: "2026-10-01" });
    const f = await newCompany(db, "Firma D");
    const { rows } = await db.query(
      "insert into public.jobs (company_id, title, last_checked_date) values ($1, 'Elektriker', public.app_today() - 10) returning id", [f]);
    const r = await present(c.id, f, { jobId: rows[0].id });
    expect(r.ok).toBe(true);
    expect(r.hints[0].code).toBe("JOB_CHECK");
  });

  it("Vorstellung schiebt Kandidat nach „vorgestellt“ und schreibt den Zeitstrahl", async () => {
    const c = await newCandidate(db, { last_name: "Flow", email: "f@x.de", source: "BA", consent_date: "2026-10-01" });
    const f = await newCompany(db, "Firma E");
    await present(c.id, f);
    const { rows } = await db.query("select stage from public.candidates where id = $1", [c.id]);
    expect(rows[0].stage).toBe("vorgestellt");
    const acts = await db.query("select summary from public.activities where entity_id = $1 order by created_at", [c.id]);
    expect(acts.rows.map((r) => r.summary)).toEqual(expect.arrayContaining(["Vorgestellt bei Firma E", "Spalte: neu → vorgestellt"]));
  });
});

describe("Boards: Pflichtfelder beim Spaltenwechsel", () => {
  it("Vermarktbar nur mit Einwilligung, Gehalt, Verfügbarkeit, Ausschlüssen, Selbstbewerbungen", async () => {
    const c = await newCandidate(db, { last_name: "Board", email: "b@x.de", source: "BA" });
    const r1 = await rpc<{ ok: boolean; missing: string[] }>(db, "public.move_candidate($1, 'vermarktbar')", [c.id]);
    expect(r1.ok).toBe(false);
    expect(r1.missing).toEqual(["consent_date", "salary_wish", "available_from", "exclusions", "self_applications"]);
    const r2 = await rpc<{ ok: boolean }>(db, "public.move_candidate($1, 'vermarktbar', $2::jsonb)", [c.id, JSON.stringify({
      consent_date: "2026-10-10", salary_wish: "55.000", available_from: "01.01.2027", exclusions: "keine Kanzlei",
      self_applications: [{ company_name: "Liebherr", date: "2026-09-01" }],
    })]);
    expect(r2.ok).toBe(true);
    const s = await db.query("select count(*)::int as n from public.self_applications where candidate_id = $1", [c.id]);
    expect(s.rows[0].n).toBe(1);
  });

  it("Datenbank verweigert „vermarktbar“ ohne Einwilligung auch per direktem Update", async () => {
    const c = await newCandidate(db, { last_name: "Direkt", email: "dir@x.de", source: "BA" });
    await expect(db.query("update public.candidates set stage = 'vermarktbar' where id = $1", [c.id]))
      .rejects.toThrow(/Einwilligung/);
  });

  it("Raus braucht Grund, Pausiert eine Wiedervorlage in der Zukunft", async () => {
    const c = await newCandidate(db, { last_name: "Pause", email: "p@x.de", source: "BA" });
    expect((await rpc<{ missing: string[] }>(db, "public.move_candidate($1, 'raus')", [c.id])).missing).toEqual(["reason"]);
    expect((await rpc<{ missing: string[] }>(db, "public.move_candidate($1, 'pausiert')", [c.id])).missing).toEqual(["next_action_date"]);
    const ok = await rpc<{ ok: boolean }>(db, "public.move_candidate($1, 'pausiert', $2::jsonb)",
      [c.id, JSON.stringify({ next_action_date: "2099-01-01", next_action: "Nachfragen" })]);
    expect(ok.ok).toBe(true);
  });

  it("Firmen: Konditionen braucht AGB-Datum und Honorar", async () => {
    const f = await newCompany(db, "Konditionen GmbH", { source: "Leadliste" });
    const r = await rpc<{ ok: boolean; missing: string[] }>(db, "public.move_company($1, 'konditionen')", [f]);
    expect(r.missing).toEqual(["agb_sent_date", "fee_agreed"]);
    const ok = await rpc<{ ok: boolean }>(db, "public.move_company($1, 'konditionen', $2::jsonb)",
      [f, JSON.stringify({ agb_sent_date: "2026-10-12", fee_agreed: "25 %" })]);
    expect(ok.ok).toBe(true);
  });

  it("Spaltenwechsel schreibt automatisch eine Zeile in activities", async () => {
    const c = await newCandidate(db, { last_name: "Log", email: "l@x.de", source: "BA" });
    await rpc(db, "public.move_candidate($1, 'qualifizieren', $2::jsonb)", [c.id, JSON.stringify({ note: "Telefonat gut" })]);
    const { rows } = await db.query("select summary, created_by from public.activities where entity_id = $1 order by created_at", [c.id]);
    expect(rows.map((r) => r.summary)).toEqual(expect.arrayContaining(["Telefonat gut", "Spalte: neu → qualifizieren"]));
    expect(rows.every((r) => r.created_by === "Hüsnü")).toBe(true);
  });
});

describe("Heute", () => {
  it("Karte ohne next_action_date erscheint in „Heute“ (ohne Datum, rot)", async () => {
    const c = await newCandidate(db, { last_name: "Ohne", email: "o2@x.de", source: "BA" });
    const { rows } = await db.query("select bucket from public.today_items where id = $1", [c.id]);
    expect(rows.map((r) => r.bucket)).toContain("ohne_datum");
  });

  it("fällig heute, überfällig und eingeschlafen werden getrennt; Raus/Platziert/Tabu fehlen", async () => {
    const heute = await newCandidate(db, { last_name: "Heute", email: "h@x.de", source: "BA" });
    const alt = await newCandidate(db, { last_name: "Alt", email: "alt@x.de", source: "BA" });
    const raus = await newCandidate(db, { last_name: "Raus", email: "r@x.de", source: "BA" });
    await db.query("update public.candidates set next_action_date = public.app_today() where id = $1", [heute.id]);
    await db.query("update public.candidates set next_action_date = public.app_today() - 3 where id = $1", [alt.id]);
    await rpc(db, "public.move_candidate($1, 'raus', $2::jsonb)", [raus.id, JSON.stringify({ reason: "Absage" })]);
    await db.query("update public.activities set occurred_at = now() - interval '20 days' where entity_id = $1", [alt.id]);
    await db.query("update public.candidates set created_at = now() - interval '20 days' where id = $1", [alt.id]);
    const { rows } = await db.query("select id, bucket from public.today_items");
    const b = (id: string) => rows.filter((r) => r.id === id).map((r) => r.bucket).sort();
    expect(b(heute.id)).toEqual(["heute"]);
    expect(b(alt.id)).toEqual(["eingeschlafen", "ueberfaellig"]);
    expect(b(raus.id)).toEqual([]);
  });
});
