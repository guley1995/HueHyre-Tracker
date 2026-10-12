// Agent-API für Claude: jede Aktion ist eine Funktion über einer DB-Verbindung
// als Benutzer claude_agent (kein DELETE). created_by = 'Claude' setzt die
// Datenbank selbst (current_actor()).

import { z } from "zod";
import type { QueryResultRow } from "pg";

export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

export class AgentError extends Error {
  constructor(message: string, public status = 400, public details?: unknown) {
    super(message);
  }
}

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum als JJJJ-MM-TT");
const optText = z.string().trim().nullable().optional();

const candidateFields = z.object({
  first_name: optText,
  last_name: optText,
  email: optText,
  phone: optText,
  plz: optText,
  city: optText,
  profile_title: optText,
  skills: optText,
  category: z.enum(["Technik", "Kaufm.", "Vertrieb", "Logistik", "IT"]).nullable().optional(),
  salary_wish: optText,
  available_from: optText,
  notice_period: optText,
  radius_km: z.number().int().nonnegative().nullable().optional(),
  remote_wish: optText,
  exclusions: optText,
  source: z.enum(["Indeed", "BA", "Gmail", "Empfehlung", "Maron", "Telefon", "Sonstige"]).nullable().optional(),
  priority: z.enum(["A", "B", "C"]).nullable().optional(),
  next_action: optText,
  next_action_date: dateStr.nullable().optional(),
  consent_date: dateStr.nullable().optional(),
  consent_scope: optText,
  delete_after: dateStr.nullable().optional(),
  cv_file: optText,
  notes: optText,
});

const companyFields = z.object({
  name: z.string().trim().min(1).optional(),
  legal_name: optText,
  group_name: optText,
  city: optText,
  plz: optText,
  industry: optText,
  size: optText,
  website: optText,
  careers_url: optText,
  priority: z.enum(["A", "B", "C"]).nullable().optional(),
  pays_agencies: z.enum(["ja", "nein", "unklar"]).nullable().optional(),
  fee_agreed: optText,
  agb_sent_date: dateStr.nullable().optional(),
  next_action: optText,
  next_action_date: dateStr.nullable().optional(),
  source: z.enum(["Leadliste", "Endkunden-Recherche", "Empfehlung", "Sonstige"]).nullable().optional(),
  notes: optText,
});

const CANDIDATE_STAGES = ["neu", "qualifizieren", "vermarktbar", "vorgestellt", "interview", "angebot",
  "platziert", "pausiert", "raus", "pool"] as const;
const COMPANY_STAGES = ["lead", "angeschrieben", "im_gespraech", "konditionen", "kunde_aktiv", "ruhend", "tabu"] as const;

const schemas = {
  search_candidates: z.object({
    query: z.string().optional(),
    stage: z.enum(CANDIDATE_STAGES).optional(),
    category: z.string().optional(),
    limit: z.number().int().min(1).max(200).default(25),
  }),
  get_candidate: z.object({ id: z.string().uuid().optional(), k_nr: z.string().optional() })
    .refine((v) => v.id || v.k_nr, "id oder k_nr angeben"),
  upsert_candidate: candidateFields.extend({
    id: z.string().uuid().optional(),
    k_nr: z.string().optional(),
    stage: z.enum(CANDIDATE_STAGES).optional(),
    stage_payload: z.record(z.string(), z.unknown()).optional(),
    force: z.boolean().optional(),
  }),
  search_companies: z.object({
    query: z.string().optional(),
    stage: z.enum(COMPANY_STAGES).optional(),
    limit: z.number().int().min(1).max(200).default(25),
  }),
  get_company: z.object({ id: z.string().uuid().optional(), name: z.string().optional() })
    .refine((v) => v.id || v.name, "id oder name angeben"),
  upsert_company: companyFields.extend({
    id: z.string().uuid().optional(),
    stage: z.enum(COMPANY_STAGES).optional(),
    stage_payload: z.record(z.string(), z.unknown()).optional(),
  }),
  upsert_job: z.object({
    id: z.string().uuid().optional(),
    company_id: z.string().uuid().optional(),
    company_name: z.string().optional(),
    title: z.string().trim().min(1).optional(),
    city: optText,
    url: optText,
    source_type: z.enum(["eigene Anzeige", "Vermittler-Anzeige", "Mandat", "initiativ", "Vorschlag"]).nullable().optional(),
    salary_range: optText,
    posted_date: dateStr.nullable().optional(),
    last_checked_date: dateStr.nullable().optional(),
    status: z.enum(["online", "offline", "besetzt"]).optional(),
    ref_no: optText,
    notes: optText,
  }),
  create_presentation: z.object({
    candidate_id: z.string().uuid().optional(),
    k_nr: z.string().optional(),
    company_id: z.string().uuid().optional(),
    company_name: z.string().optional(),
    job_id: z.string().uuid().nullable().optional(),
    channel: z.enum(["Mail", "Telefon", "Portal"]).default("Mail"),
    anonymous: z.boolean().default(false),
    sent_date: dateStr.optional(),
    notes: z.string().optional(),
    confirm: z.boolean().default(false),
    gmail_thread_id: z.string().optional(),
    /** Nur prüfen, nichts anlegen. */
    dry_run: z.boolean().default(false),
  }),
  add_activity: z.object({
    entity_type: z.enum(["candidate", "company"]),
    entity_id: z.string().uuid().optional(),
    k_nr: z.string().optional(),
    company_name: z.string().optional(),
    type: z.enum(["Mail", "Anruf", "SMS", "WhatsApp", "Indeed", "BA", "Notiz", "Status"]),
    direction: z.enum(["ein", "aus"]).nullable().optional(),
    occurred_at: z.string().datetime({ offset: true }).optional(),
    summary: z.string().trim().min(1),
    link: z.string().nullable().optional(),
  }),
  upsert_ba_profile: z.object({
    ref_no: z.string().trim().min(1),
    search: optText,
    qualification: optText,
    age: z.number().int().nullable().optional(),
    city: optText,
    contacted_date: dateStr.nullable().optional(),
    reply: optText,
  }),
  get_today: z.object({}).passthrough(),
} as const;

export type AgentAction = keyof typeof schemas;
export const AGENT_ACTIONS = Object.keys(schemas) as AgentAction[];

/** Spaltenliste für dynamische Updates (nur erlaubte Felder). */
function pickDefined<T extends Record<string, unknown>>(obj: T, keys: readonly string[]) {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

async function resolveCandidateId(db: Queryable, id?: string, kNr?: string): Promise<string> {
  if (id) return id;
  if (!kNr) throw new AgentError("candidate_id oder k_nr angeben.");
  const { rows } = await db.query<{ id: string }>(
    "select id from public.candidates where k_nr = $1 or $1 = any(legacy_k_nrs) limit 1", [kNr.trim()]);
  if (!rows[0]) throw new AgentError(`Kandidat ${kNr} nicht gefunden.`, 404);
  return rows[0].id;
}

async function resolveCompanyId(db: Queryable, id?: string, name?: string): Promise<string> {
  if (id) return id;
  if (!name) throw new AgentError("company_id oder company_name angeben.");
  const { rows } = await db.query<{ id: string }>(
    "select id from public.companies where public.normalize_name(name) = public.normalize_name($1) limit 1", [name]);
  if (!rows[0]) throw new AgentError(`Firma „${name}“ nicht gefunden – erst upsert_company.`, 404);
  return rows[0].id;
}

const handlers: { [A in AgentAction]: (db: Queryable, input: z.infer<(typeof schemas)[A]>) => Promise<unknown> } = {
  async search_candidates(db, { query, stage, category, limit }) {
    const params: unknown[] = [];
    const where: string[] = [];
    if (query?.trim()) {
      params.push(query.trim());
      const q = `$${params.length}`;
      where.push(`(k_nr ilike '%'||${q}||'%' or full_name ilike '%'||${q}||'%'
        or (coalesce(last_name,'')||' '||coalesce(first_name,'')) ilike '%'||${q}||'%'
        or email ilike '%'||${q}||'%' or profile_title ilike '%'||${q}||'%' or city ilike '%'||${q}||'%'
        or skills ilike '%'||${q}||'%' or ${q} = any(legacy_k_nrs)
        or (length(public.normalize_phone(${q})) >= 5 and public.normalize_phone(phone) like '%'||public.normalize_phone(${q})||'%'))`);
    }
    if (stage) { params.push(stage); where.push(`stage = $${params.length}`); }
    if (category) { params.push(category); where.push(`category = $${params.length}`); }
    params.push(limit);
    const { rows } = await db.query(
      `select id, k_nr, full_name, email, phone, plz, city, profile_title, category, stage, priority,
              next_action, next_action_date, consent_date, salary_wish, available_from, exclusions,
              last_activity_at, days_since_activity, active_presentations, legacy_k_nrs
       from public.candidate_cards ${where.length ? "where " + where.join(" and ") : ""}
       order by updated_at desc limit $${params.length}`, params);
    return { count: rows.length, candidates: rows };
  },

  async get_candidate(db, { id, k_nr }) {
    const cid = await resolveCandidateId(db, id, k_nr);
    // Nacheinander: eine Verbindung verarbeitet nur eine Abfrage zur Zeit.
    const c = await db.query("select * from public.candidate_cards where id = $1", [cid]);
    const pres = await db.query(`select p.*, f.name as company_name from public.presentations p
      join public.companies f on f.id = p.company_id where p.candidate_id = $1 order by p.sent_date desc`, [cid]);
    const self = await db.query(
      "select * from public.self_applications where candidate_id = $1 order by date desc nulls last", [cid]);
    const acts = await db.query(`select type, direction, occurred_at, summary, link, created_by from public.activities
      where entity_type = 'candidate' and entity_id = $1 order by occurred_at desc limit 50`, [cid]);
    const blocks = await db.query("select type, name, scope, reason from public.blocklist where candidate_id = $1", [cid]);
    if (!c.rows[0]) throw new AgentError("Kandidat nicht gefunden.", 404);
    return { candidate: c.rows[0], presentations: pres.rows, self_applications: self.rows,
      activities: acts.rows, blocklist: blocks.rows };
  },

  async upsert_candidate(db, input) {
    const { id, k_nr, stage, stage_payload, force, ...fields } = input;
    const data = pickDefined(fields, Object.keys(candidateFields.shape));
    let result: Record<string, unknown>;
    let cid: string;
    if (id || k_nr) {
      cid = await resolveCandidateId(db, id, k_nr);
      const { rows } = await db.query<{ r: Record<string, unknown> }>(
        "select public.update_candidate($1, $2::jsonb) as r", [cid, JSON.stringify(data)]);
      result = rows[0].r;
    } else {
      const startStage = stage === "pool" ? "pool" : "neu";
      const { rows } = await db.query<{ r: Record<string, unknown> }>(
        "select public.create_candidate($1::jsonb, $2) as r",
        [JSON.stringify({ ...data, stage: startStage }), force ?? false]);
      result = rows[0].r;
      cid = result.id as string;
    }
    if (!result.ok) return result;
    const isUpdate = Boolean(id || k_nr);
    if (stage && (isUpdate || (stage !== "neu" && stage !== "pool"))) {
      const { rows } = await db.query<{ r: Record<string, unknown> }>(
        "select public.move_candidate($1, $2, $3::jsonb) as r", [cid, stage, JSON.stringify(stage_payload ?? {})]);
      result = { ...result, stage_result: rows[0].r };
    }
    return result;
  },

  async search_companies(db, { query, stage, limit }) {
    const params: unknown[] = [];
    const where: string[] = [];
    if (query?.trim()) {
      params.push(query.trim());
      where.push(`(name ilike '%'||$1||'%' or legal_name ilike '%'||$1||'%' or group_name ilike '%'||$1||'%'
        or city ilike '%'||$1||'%' or industry ilike '%'||$1||'%')`);
    }
    if (stage) { params.push(stage); where.push(`stage = $${params.length}`); }
    params.push(limit);
    const { rows } = await db.query(
      `select id, name, group_name, city, plz, industry, stage, priority, pays_agencies, fee_agreed,
              next_action, next_action_date, open_jobs, active_presentations, days_since_activity
       from public.company_cards ${where.length ? "where " + where.join(" and ") : ""}
       order by updated_at desc limit $${params.length}`, params);
    return { count: rows.length, companies: rows };
  },

  async get_company(db, { id, name }) {
    const fid = await resolveCompanyId(db, id, name);
    const f = await db.query("select * from public.company_cards where id = $1", [fid]);
    const contacts = await db.query("select * from public.contacts where company_id = $1 order by name", [fid]);
    const jobs = await db.query(
      "select * from public.jobs where company_id = $1 order by status, last_checked_date desc nulls last", [fid]);
    const pres = await db.query(`select p.sent_date, p.status, p.anonymous, c.k_nr,
        btrim(coalesce(c.first_name,'')||' '||coalesce(c.last_name,'')) as candidate_name
      from public.presentations p join public.candidates c on c.id = p.candidate_id
      where p.company_id = $1 order by p.sent_date desc`, [fid]);
    const acts = await db.query(`select type, direction, occurred_at, summary, created_by from public.activities
      where entity_type = 'company' and entity_id = $1 order by occurred_at desc limit 50`, [fid]);
    if (!f.rows[0]) throw new AgentError("Firma nicht gefunden.", 404);
    return { company: f.rows[0], contacts: contacts.rows, jobs: jobs.rows, presentations: pres.rows, activities: acts.rows };
  },

  async upsert_company(db, input) {
    const { id, stage, stage_payload, ...fields } = input;
    const data = pickDefined(fields, Object.keys(companyFields.shape));
    let fid = id;
    if (!fid && data.name) {
      const { rows } = await db.query<{ id: string }>(
        "select id from public.companies where public.normalize_name(name) = public.normalize_name($1)", [data.name]);
      fid = rows[0]?.id;
    }
    let created = false;
    if (fid) {
      const cols = Object.keys(data);
      if (cols.length) {
        const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(", ");
        const { rows } = await db.query(`update public.companies set ${sets} where id = $1 returning id`,
          [fid, ...cols.map((c) => data[c])]);
        if (!rows[0]) throw new AgentError("Firma nicht gefunden.", 404);
      }
    } else {
      if (!data.name) throw new AgentError("name ist Pflicht für eine neue Firma.");
      const cols = Object.keys(data);
      const { rows } = await db.query<{ id: string }>(
        `insert into public.companies (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
        cols.map((c) => data[c]));
      fid = rows[0].id;
      created = true;
    }
    const result: Record<string, unknown> = { ok: true, id: fid, created };
    if (stage) {
      const { rows } = await db.query<{ r: unknown }>(
        "select public.move_company($1, $2, $3::jsonb) as r", [fid, stage, JSON.stringify(stage_payload ?? {})]);
      result.stage_result = rows[0].r;
    }
    return result;
  },

  async upsert_job(db, input) {
    const { id, company_id, company_name, ...rest } = input;
    const data = pickDefined(rest, ["title", "city", "url", "source_type", "salary_range", "posted_date",
      "last_checked_date", "status", "ref_no", "notes"]);
    if (id) {
      const cols = Object.keys(data);
      if (!cols.length) return { ok: true, id };
      const { rows } = await db.query(
        `update public.jobs set ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")} where id = $1 returning id`,
        [id, ...cols.map((c) => data[c])]);
      if (!rows[0]) throw new AgentError("Stelle nicht gefunden.", 404);
      return { ok: true, id, created: false };
    }
    const fid = await resolveCompanyId(db, company_id, company_name);
    if (!data.title) throw new AgentError("title ist Pflicht für eine neue Stelle.");
    // Gleiche Stelle (Firma + Titel oder URL) nicht doppelt anlegen.
    const existing = await db.query<{ id: string }>(
      `select id from public.jobs where company_id = $1 and (public.normalize_name(title) = public.normalize_name($2)
        or (url is not null and url = $3)) limit 1`, [fid, data.title, data.url ?? null]);
    if (existing.rows[0]) {
      return handlers.upsert_job(db, { ...input, id: existing.rows[0].id, company_id: undefined, company_name: undefined });
    }
    const all = { company_id: fid, ...data };
    const cols = Object.keys(all);
    const { rows } = await db.query<{ id: string }>(
      `insert into public.jobs (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
      cols.map((c) => (all as Record<string, unknown>)[c]));
    return { ok: true, id: rows[0].id, created: true };
  },

  async create_presentation(db, input) {
    const cid = await resolveCandidateId(db, input.candidate_id, input.k_nr);
    const fid = await resolveCompanyId(db, input.company_id, input.company_name);
    if (input.dry_run) {
      const { rows } = await db.query<{ r: Record<string, unknown> }>(
        "select public.check_presentation($1, $2, $3, $4) as r", [cid, fid, input.job_id ?? null, input.anonymous]);
      return { dry_run: true, ...rows[0].r };
    }
    const { rows } = await db.query<{ r: unknown }>(
      `select public.create_presentation(p_candidate_id => $1, p_company_id => $2, p_job_id => $3,
         p_channel => $4, p_anonymous => $5, p_sent_date => $6, p_notes => $7, p_confirm => $8,
         p_gmail_thread_id => $9) as r`,
      [cid, fid, input.job_id ?? null, input.channel, input.anonymous, input.sent_date ?? null,
        input.notes ?? null, input.confirm, input.gmail_thread_id ?? null]);
    return rows[0].r;
  },

  async add_activity(db, input) {
    const entityId = input.entity_type === "candidate"
      ? await resolveCandidateId(db, input.entity_id, input.k_nr)
      : await resolveCompanyId(db, input.entity_id, input.company_name);
    const table = input.entity_type === "candidate" ? "candidates" : "companies";
    const exists = await db.query(`select 1 from public.${table} where id = $1`, [entityId]);
    if (!exists.rows[0]) throw new AgentError("Datensatz nicht gefunden.", 404);
    const { rows } = await db.query<{ id: string; created_by: string }>(
      `insert into public.activities (entity_type, entity_id, type, direction, occurred_at, summary, link)
       values ($1, $2, $3, $4, coalesce($5::timestamptz, now()), $6, $7) returning id, created_by`,
      [input.entity_type, entityId, input.type, input.direction ?? null, input.occurred_at ?? null,
        input.summary, input.link ?? null]);
    return { ok: true, ...rows[0] };
  },

  async upsert_ba_profile(db, input) {
    const data = pickDefined(input, ["search", "qualification", "age", "city", "contacted_date", "reply"]);
    const cols = Object.keys(data);
    const { rows } = await db.query<{ id: string; inserted: boolean }>(
      `insert into public.ba_profiles (ref_no${cols.map((c) => ", " + c).join("")})
       values ($1${cols.map((_, i) => `, $${i + 2}`).join("")})
       on conflict (ref_no) do update set ${cols.length ? cols.map((c) => `${c} = excluded.${c}`).join(", ") : "ref_no = excluded.ref_no"}
       returning id, (xmax = 0) as inserted`,
      [input.ref_no, ...cols.map((c) => data[c])]);
    return { ok: true, id: rows[0].id, created: rows[0].inserted };
  },

  async get_today(db) {
    const { rows } = await db.query<{ bucket: string }>(
      `select entity_type, id, ref, label, stage, priority, city, next_action, next_action_date,
              days_since_activity, active_presentations, bucket
       from public.today_items order by next_action_date nulls first, priority nulls last, label`);
    const grouped: Record<string, unknown[]> = { heute: [], ueberfaellig: [], ohne_datum: [], eingeschlafen: [] };
    for (const r of rows) grouped[r.bucket].push(r);
    const today = await db.query<{ d: string }>("select public.app_today()::text as d");
    return { date: today.rows[0].d, ...grouped };
  },
};

export async function runAgentAction(db: Queryable, action: string, body: unknown) {
  if (!(action in schemas)) {
    throw new AgentError(`Unbekannte Aktion „${action}“. Verfügbar: ${AGENT_ACTIONS.join(", ")}`, 404);
  }
  const a = action as AgentAction;
  const parsed = schemas[a].safeParse(body ?? {});
  if (!parsed.success) {
    throw new AgentError("Ungültige Eingabe", 422, z.treeifyError(parsed.error));
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (handlers[a] as (db: Queryable, input: any) => Promise<unknown>)(db, parsed.data);
}

/** Kurzbeschreibung für GET /api/agent (Selbstdokumentation für Claude). */
export function describeActions() {
  return Object.fromEntries(AGENT_ACTIONS.map((a) => [a, z.toJSONSchema(schemas[a], { io: "input", unrepresentable: "any" })]));
}
