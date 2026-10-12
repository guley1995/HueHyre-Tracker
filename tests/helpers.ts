import pg from "pg";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/huehyre_test";

const agentUrl = () => {
  const u = new URL(TEST_DATABASE_URL);
  u.username = "claude_agent";
  u.password = "agent-test";
  return u.toString();
};

/** Verbindung als Superuser (Setup/Aufräumen). */
export async function adminClient() {
  const c = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await c.connect();
  return c;
}

/** Verbindung wie die App: Rolle authenticated (eingeloggter Nutzer). */
export async function appClient() {
  const c = await adminClient();
  await c.query("set role authenticated");
  return c;
}

/** Verbindung wie die Agent-API: eigener DB-Benutzer claude_agent. */
export async function agentClient() {
  const c = new pg.Client({ connectionString: agentUrl() });
  await c.connect();
  return c;
}

export async function resetData() {
  const c = await adminClient();
  await c.query(`truncate public.activities, public.placements, public.presentations, public.self_applications,
    public.blocklist, public.ba_profiles, public.jobs, public.contacts, public.companies, public.candidates,
    public.k_nr_counters restart identity cascade`);
  await c.end();
}

type Q = { query: pg.Client["query"] };

export async function rpc<T = Record<string, unknown>>(db: Q, sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query(`select ${sql} as r`, params);
  return rows[0].r as T;
}

export async function newCandidate(db: Q, data: Record<string, unknown>) {
  const r = await rpc<{ ok: boolean; id: string; k_nr: string; message?: string }>(
    db, "public.create_candidate($1::jsonb)", [JSON.stringify(data)]);
  if (!r.ok) throw new Error(r.message);
  return r;
}

export async function newCompany(db: Q, name: string, extra: Record<string, unknown> = {}) {
  const cols = ["name", ...Object.keys(extra)];
  const { rows } = await db.query(
    `insert into public.companies (${cols.join(",")}) values (${cols.map((_, i) => `$${i + 1}`).join(",")}) returning id`,
    [name, ...Object.values(extra)]);
  return rows[0].id as string;
}
