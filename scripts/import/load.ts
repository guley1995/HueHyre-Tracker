// Importplan in die Datenbank schreiben – alles in einer Transaktion.
// Läuft als privilegierter DB-Benutzer (postgres), damit bestehende K-Nummern übernommen werden.
import type pg from "pg";
import { norm } from "./xlsx";
import type { ImportPlan, Issue } from "./transform";

export type LoadStats = Record<string, { inserted: number; updated: number; skipped: number }>;

const stat = (s: LoadStats, k: string) => (s[k] ??= { inserted: 0, updated: 0, skipped: 0 });

export async function loadPlan(db: pg.Client, plan: ImportPlan, opts: { dryRun: boolean }) {
  const stats: LoadStats = {};
  const issues: Issue[] = [];
  const fail = (source: string, message: string) => issues.push({ level: "fehler", source, message });

  // Fehler einer Zeile abfangen, ohne die Transaktion abzubrechen.
  let sp = 0;
  async function safe<T>(source: string, fn: () => Promise<T>): Promise<T | undefined> {
    const name = `sp${++sp}`;
    await db.query(`savepoint ${name}`);
    try {
      const r = await fn();
      await db.query(`release savepoint ${name}`);
      return r;
    } catch (e) {
      await db.query(`rollback to savepoint ${name}`);
      fail(source, (e as Error).message);
      return undefined;
    }
  }

  await db.query("begin");
  // Leerer app.actor → Zeitstrahl-Einträge erscheinen mit created_by = 'Import'.
  await db.query("set local app.actor = ''");

  // ------------------------------------------------ Firmen
  const companyId = new Map<string, string>();
  const existing = await db.query<{ id: string; name: string }>("select id, name from public.companies");
  for (const r of existing.rows) companyId.set(norm(r.name), r.id);
  for (const c of plan.companies) {
    const k = norm(c.name);
    await safe(`Firma ${c.name}`, async () => {
      if (companyId.has(k)) {
        await db.query(
          `update public.companies set city = coalesce(city, $2), plz = coalesce(plz, $3), industry = coalesce(industry, $4),
             website = coalesce(website, $5), source = coalesce(source, $6), notes = coalesce(notes, $7),
             group_name = coalesce(group_name, $8) where id = $1`,
          [companyId.get(k), c.city ?? null, c.plz ?? null, c.industry ?? null, c.website ?? null, c.source ?? null, c.notes ?? null, c.group_name ?? null]);
        stat(stats, "companies").updated++;
      } else {
        const { rows } = await db.query<{ id: string }>(
          `insert into public.companies (name, city, plz, industry, website, stage, source, notes, group_name, next_action, next_action_date)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
          [c.name, c.city ?? null, c.plz ?? null, c.industry ?? null, c.website ?? null, c.stage ?? "lead", c.source ?? null,
            c.notes ?? null, c.group_name ?? null, c.next_action ?? null, c.next_action_date ?? null]);
        companyId.set(k, rows[0].id);
        stat(stats, "companies").inserted++;
      }
    });
  }

  for (const ct of plan.contacts) {
    const fid = companyId.get(norm(ct.company));
    if (!fid) continue;
    await safe(`Ansprechpartner ${ct.name}`, async () => {
      const dup = await db.query("select 1 from public.contacts where company_id = $1 and public.normalize_name(name) = public.normalize_name($2)", [fid, ct.name]);
      if (dup.rows.length) return void stat(stats, "contacts").skipped++;
      await db.query("insert into public.contacts (company_id, name, role, email, phone) values ($1, $2, $3, $4, $5)",
        [fid, ct.name, ct.role ?? null, ct.email ?? null, ct.phone ?? null]);
      stat(stats, "contacts").inserted++;
    });
  }

  // ------------------------------------------------ Kandidaten (erst mit K-Nr., dann ohne → automatische Nummer)
  const candidateId = new Map<string, string>();
  const ordered = [...plan.candidates].sort((a, b) => Number(!a.k_nr) - Number(!b.k_nr));
  for (const c of ordered) {
    const label = `${c.k_nr ?? "neu"} ${[c.first_name, c.last_name].filter(Boolean).join(" ")} (${c.origin[0]})`;
    await safe(label, async () => {
      const dup = await db.query<{ id: string; k_nr: string }>(
        "select id, k_nr from public.find_duplicate_candidates($1, $2, $3, $4, $5, $6) where match <> 'name_ort' or $7",
        [c.email, c.phone, c.first_name, c.last_name, c.plz, c.city, !c.name_gap]);
      const byKnr = c.k_nr ? await db.query<{ id: string; k_nr: string }>(
        "select id, k_nr from public.candidates where k_nr = $1 or $1 = any(legacy_k_nrs)", [c.k_nr]) : { rows: [] };
      // Nur ein Name bekannt (z. B. „nur über Indeed-Chat erreichbar“): beim zweiten Lauf über den Namen wiederfinden,
      // aber nur Einträge, die ebenfalls weder E-Mail, Telefon noch Ort haben.
      const bare = !c.k_nr && !c.email && !c.phone && !c.plz && !c.city && c.last_name && !c.name_gap
        ? await db.query<{ id: string; k_nr: string }>(
          `select id, k_nr from public.candidates where public.normalize_name(last_name) = public.normalize_name($1)
             and public.normalize_name(first_name) is not distinct from public.normalize_name($2)
             and email is null and phone is null and plz is null and city is null`, [c.last_name, c.first_name])
        : { rows: [] };
      const hit = byKnr.rows[0] ?? dup.rows[0] ?? bare.rows[0];
      if (hit) {
        // Schon in der Datenbank (z. B. zweiter Importlauf): nur leere Felder ergänzen.
        await db.query(
          `update public.candidates set email = coalesce(email, $2), phone = coalesce(phone, $3), plz = coalesce(plz, $4),
             city = coalesce(city, $5), profile_title = coalesce(profile_title, $6), category = coalesce(category, $7),
             consent_date = coalesce(consent_date, $8),
             legacy_k_nrs = (select coalesce(array_agg(distinct x), '{}') from unnest(legacy_k_nrs || $9::text[]) x where x <> k_nr)
           where id = $1`,
          [hit.id, c.email, c.phone, c.plz, c.city, c.profile_title, c.category, c.consent_date,
            [c.k_nr, ...c.legacy_k_nrs].filter(Boolean)]);
        candidateId.set(c.key, hit.id);
        stat(stats, "candidates").updated++;
        return;
      }
      const { rows } = await db.query<{ id: string }>(
        `insert into public.candidates (k_nr, legacy_k_nrs, first_name, last_name, email, phone, plz, city, profile_title, skills,
           category, salary_wish, available_from, notice_period, exclusions, source, stage, priority, next_action,
           next_action_date, consent_date, notes)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22) returning id`,
        [c.k_nr, c.legacy_k_nrs, c.first_name, c.last_name, c.email, c.phone, c.plz, c.city, c.profile_title, c.skills,
          c.category, c.salary_wish, c.available_from, c.notice_period, c.exclusions, c.source, c.stage, c.priority,
          c.next_action, c.next_action_date, c.consent_date, c.notes]);
      candidateId.set(c.key, rows[0].id);
      stat(stats, "candidates").inserted++;
      for (const s of c.self_applications) {
        await db.query("insert into public.self_applications (candidate_id, company_name) values ($1, $2)", [rows[0].id, s]);
        stat(stats, "self_applications").inserted++;
      }
    });
  }

  // ------------------------------------------------ Stellen
  const jobId = new Map<string, string>();
  for (const j of plan.jobs) {
    const fid = companyId.get(norm(j.company));
    if (!fid) { fail(`Stelle ${j.title}`, `Firma ${j.company} fehlt.`); continue; }
    await safe(`Stelle ${j.company} / ${j.title}`, async () => {
      const ex = await db.query<{ id: string }>(
        "select id from public.jobs where company_id = $1 and public.normalize_name(title) = public.normalize_name($2)", [fid, j.title]);
      if (ex.rows[0]) {
        await db.query(`update public.jobs set last_checked_date = greatest(last_checked_date, $2), url = coalesce(url, $3) where id = $1`,
          [ex.rows[0].id, j.last_checked_date ?? null, j.url ?? null]);
        jobId.set(`${norm(j.company)}|${norm(j.title)}`, ex.rows[0].id);
        return void stat(stats, "jobs").updated++;
      }
      const { rows } = await db.query<{ id: string }>(
        `insert into public.jobs (company_id, title, city, url, source_type, salary_range, posted_date, last_checked_date, status, ref_no, notes)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
        [fid, j.title, j.city ?? null, j.url ?? null, j.source_type ?? null, j.salary_range ?? null, j.posted_date ?? null,
          j.last_checked_date ?? null, j.status ?? "online", j.ref_no ?? null, j.notes ?? null]);
      jobId.set(`${norm(j.company)}|${norm(j.title)}`, rows[0].id);
      stat(stats, "jobs").inserted++;
    });
  }

  // ------------------------------------------------ Vorstellungen
  for (const p of plan.presentations) {
    const cid = candidateId.get(p.candidateKey);
    const fid = companyId.get(norm(p.company));
    if (!cid || !fid) { fail(p.origin, `Vorstellung ${p.company}: Kandidat oder Firma fehlt.`); continue; }
    await safe(`${p.origin}: ${p.company}`, async () => {
      const { rows } = await db.query(
        `insert into public.presentations (candidate_id, company_id, job_id, sent_date, notes, status)
         values ($1, $2, $3, $4, $5, 'vorgestellt')
         on conflict (candidate_id, company_id) do update set sent_date = least(presentations.sent_date, excluded.sent_date)
         returning (xmax = 0) as inserted`,
        [cid, fid, p.jobTitle ? jobId.get(`${norm(p.company)}|${norm(p.jobTitle)}`) ?? null : null, p.sent_date, p.notes ?? null]);
      if (rows[0].inserted) stat(stats, "presentations").inserted++;
      else stat(stats, "presentations").skipped++;
    });
  }

  // ------------------------------------------------ Sperren
  for (const b of plan.blocklist) {
    await safe(`Sperre ${b.name}`, async () => {
      const cid = b.candidateKey ? candidateId.get(b.candidateKey) ?? null : null;
      const fid = b.company ? companyId.get(norm(b.company)) ?? null : null;
      const scope = b.type === "Person" && fid ? "nur_firma" : "alle";
      const dup = await db.query(
        `select 1 from public.blocklist where type = $1 and public.normalize_name(name) = public.normalize_name($2)
           and candidate_id is not distinct from $3 and company_id is not distinct from $4`, [b.type, b.name, cid, fid]);
      if (dup.rows.length) return void stat(stats, "blocklist").skipped++;
      await db.query("insert into public.blocklist (type, name, candidate_id, company_id, scope, reason) values ($1, $2, $3, $4, $5, $6)",
        [b.type, b.name, cid, fid, scope, b.reason]);
      if (b.type === "Firma" && fid) await db.query("update public.companies set stage = 'tabu' where id = $1", [fid]);
      stat(stats, "blocklist").inserted++;
    });
  }

  // ------------------------------------------------ BA-Profile
  for (const b of plan.baProfiles) {
    await safe(`BA ${b.ref_no}`, async () => {
      const { rows } = await db.query(
        `insert into public.ba_profiles (ref_no, search, qualification, age, city, contacted_date, reply)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (ref_no) do update set search = coalesce(excluded.search, ba_profiles.search),
           qualification = coalesce(excluded.qualification, ba_profiles.qualification), age = coalesce(excluded.age, ba_profiles.age),
           city = coalesce(excluded.city, ba_profiles.city), contacted_date = coalesce(excluded.contacted_date, ba_profiles.contacted_date),
           reply = coalesce(excluded.reply, ba_profiles.reply)
         returning (xmax = 0) as inserted`,
        [b.ref_no, b.search, b.qualification, b.age, b.city, b.contacted_date, b.reply]);
      if (rows[0].inserted) stat(stats, "ba_profiles").inserted++;
      else stat(stats, "ba_profiles").updated++;
    });
  }

  const totals = await db.query<{ t: string; n: number }>(`
    select 'candidates' as t, count(*)::int as n from public.candidates union all
    select 'companies', count(*)::int from public.companies union all
    select 'contacts', count(*)::int from public.contacts union all
    select 'jobs', count(*)::int from public.jobs union all
    select 'presentations', count(*)::int from public.presentations union all
    select 'self_applications', count(*)::int from public.self_applications union all
    select 'blocklist', count(*)::int from public.blocklist union all
    select 'ba_profiles', count(*)::int from public.ba_profiles`);

  await db.query(opts.dryRun ? "rollback" : "commit");
  return { stats, issues, totals: Object.fromEntries(totals.rows.map((r) => [r.t, r.n])), candidateId };
}
