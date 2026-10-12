// Agent-API: läuft als DB-Benutzer claude_agent – wie in Produktion.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { AgentError, runAgentAction } from "@/lib/agent/handlers";
import { checkBearer } from "@/lib/agent/auth";
import { agentClient, resetData } from "./helpers";

let db: pg.Client;
beforeAll(async () => { db = await agentClient(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await resetData(); });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (action: string, body: unknown = {}) => runAgentAction(db, action, body) as Promise<any>;

describe("Agent-API", () => {
  it("Claude legt einen Kandidaten an und trägt eine Aktivität ein (created_by = Claude)", async () => {
    const c = await call("upsert_candidate", {
      first_name: "Clara", last_name: "Agent", email: "clara@agent.de", phone: "0151 2223334", source: "Gmail",
      next_action: "Anrufen", next_action_date: "2026-10-13",
    });
    expect(c.ok).toBe(true);
    expect(c.k_nr).toMatch(/^K-\d{4}-\d{3}$/);

    const a = await call("add_activity", {
      entity_type: "candidate", k_nr: c.k_nr, type: "Mail", direction: "ein", summary: "Bewerbung per Mail",
    });
    expect(a).toMatchObject({ ok: true, created_by: "Claude" });

    const detail = await call("get_candidate", { k_nr: c.k_nr });
    expect(detail.activities.every((x: { created_by: string }) => x.created_by === "Claude")).toBe(true);
    expect(detail.activities.map((x: { summary: string }) => x.summary)).toContain("Bewerbung per Mail");
  });

  it("meldet Dubletten statt neu anzulegen", async () => {
    await call("upsert_candidate", { last_name: "Eins", email: "dup@agent.de", source: "Gmail" });
    const r = await call("upsert_candidate", { last_name: "Zwei", email: "DUP@agent.de", source: "Gmail" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("duplicate");
  });

  it("aktualisiert per K-Nummer und setzt Status mit Pflichtangaben", async () => {
    const c = await call("upsert_candidate", { last_name: "Status", email: "st@agent.de", source: "Indeed" });
    const r = await call("upsert_candidate", { k_nr: c.k_nr, city: "Tübingen", stage: "raus" });
    expect(r.ok).toBe(true);
    expect(r.stage_result).toMatchObject({ ok: false, missing: ["reason"] });
    const r2 = await call("upsert_candidate", { k_nr: c.k_nr, stage: "raus", stage_payload: { reason: "kein Interesse" } });
    expect(r2.stage_result.ok).toBe(true);
  });

  it("create_presentation wendet alle Prüfungen an", async () => {
    const c = await call("upsert_candidate", { last_name: "Pres", email: "p@agent.de", source: "BA", consent_date: "2026-10-01" });
    await call("upsert_company", { name: "Kirstein GmbH", source: "Leadliste" });
    const dry = await call("create_presentation", { k_nr: c.k_nr, company_name: "kirstein gmbh", dry_run: true });
    expect(dry.blocking).toEqual([]);
    const first = await call("create_presentation", { k_nr: c.k_nr, company_name: "Kirstein GmbH" });
    expect(first.ok).toBe(true);
    const second = await call("create_presentation", { k_nr: c.k_nr, company_name: "Kirstein GmbH", confirm: true });
    expect(second.ok).toBe(false);
    expect(second.blocking[0].code).toBe("DUPLICATE_PRESENTATION");
  });

  it("upsert_company findet bestehende Firma über den Namen; upsert_job legt Stellen ohne Dubletten an", async () => {
    const a = await call("upsert_company", { name: "SURTECO GmbH", city: "Buttenwiesen", source: "Leadliste" });
    const b = await call("upsert_company", { name: "surteco gmbh", industry: "Oberflächen" });
    expect(b.id).toBe(a.id);
    expect(b.created).toBe(false);
    const j1 = await call("upsert_job", { company_name: "SURTECO GmbH", title: "Elektroniker", last_checked_date: "2026-10-12" });
    const j2 = await call("upsert_job", { company_id: a.id, title: "elektroniker", status: "offline" });
    expect(j2.id).toBe(j1.id);
  });

  it("get_today liefert die Listen", async () => {
    await call("upsert_candidate", { last_name: "Heute", email: "h@agent.de", source: "BA" });
    const t = await call("get_today");
    expect(t.ohne_datum).toHaveLength(1);
    expect(Object.keys(t)).toEqual(expect.arrayContaining(["date", "heute", "ueberfaellig", "eingeschlafen"]));
  });

  it("validiert Eingaben und kennt keine Lösch-Aktion", async () => {
    await expect(call("upsert_candidate", { category: "Quatsch" })).rejects.toBeInstanceOf(AgentError);
    await expect(call("delete_candidate", { id: "x" })).rejects.toThrow(/Unbekannte Aktion/);
  });

  it("claude_agent hat in der Datenbank kein DELETE-Recht und darf nicht zusammenführen", async () => {
    const c = await call("upsert_candidate", { last_name: "Bleibt", email: "b@agent.de", source: "BA" });
    await expect(db.query("delete from public.candidates where id = $1", [c.id])).rejects.toThrow(/permission denied/);
    await expect(db.query("delete from public.activities")).rejects.toThrow(/permission denied/);
    await expect(db.query("select public.merge_candidates($1, $1)", [c.id])).rejects.toThrow(/permission denied/);
  });
});

describe("Bearer-Prüfung", () => {
  const key = "a".repeat(32);
  it("akzeptiert nur den richtigen Schlüssel", () => {
    expect(checkBearer(`Bearer ${key}`, key)).toBe(true);
    expect(checkBearer(`Bearer ${key}x`, key)).toBe(false);
    expect(checkBearer(null, key)).toBe(false);
    expect(checkBearer(`Bearer ${key}`, undefined)).toBe(false);
    expect(checkBearer("Bearer short", "short")).toBe(false);
  });
});
