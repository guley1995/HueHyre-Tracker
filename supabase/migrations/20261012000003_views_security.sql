-- HueHYRE Tracker – Ansichten für Boards/"Heute", Rollen, Rechte, RLS.

-- ---------------------------------------------------------------------------
-- Karten-Ansichten
-- ---------------------------------------------------------------------------

create or replace view public.candidate_cards with (security_invoker = true) as
select c.*,
  btrim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')) as full_name,
  la.last_activity_at,
  (public.app_today() - coalesce(la.last_activity_at, c.created_at)::date) as days_since_activity,
  coalesce(pr.active_presentations, 0) as active_presentations,
  (c.stage not in ('platziert', 'raus', 'pool') and c.next_action_date is null) as missing_next_action,
  (c.next_action_date is not null and c.next_action_date < public.app_today()) as overdue
from public.candidates c
left join lateral (
  select max(a.occurred_at) as last_activity_at from public.activities a
  where a.entity_type = 'candidate' and a.entity_id = c.id
) la on true
left join lateral (
  select count(*)::int as active_presentations from public.presentations p
  where p.candidate_id = c.id and p.status not in ('absage', 'zurueckgezogen')
) pr on true;

create or replace view public.company_cards with (security_invoker = true) as
select f.*,
  la.last_activity_at,
  (public.app_today() - coalesce(la.last_activity_at, f.created_at)::date) as days_since_activity,
  coalesce(pr.active_presentations, 0) as active_presentations,
  coalesce(jb.open_jobs, 0) as open_jobs,
  (f.stage <> 'tabu' and f.next_action_date is null) as missing_next_action,
  (f.next_action_date is not null and f.next_action_date < public.app_today()) as overdue
from public.companies f
left join lateral (
  select max(a.occurred_at) as last_activity_at from public.activities a
  where a.entity_type = 'company' and a.entity_id = f.id
) la on true
left join lateral (
  select count(*)::int as active_presentations from public.presentations p
  where p.company_id = f.id and p.status not in ('absage', 'zurueckgezogen')
) pr on true
left join lateral (
  select count(*)::int as open_jobs from public.jobs j
  where j.company_id = f.id and j.status = 'online'
) jb on true;

-- "Heute": fällig heute, überfällig (inkl. ohne Datum), eingeschlafen (14 Tage still).
-- Eine Karte kann in mehreren Listen stehen (z. B. überfällig und eingeschlafen).
create or replace view public.today_items with (security_invoker = true) as
with open_items as (
  select 'candidate'::text as entity_type, id, k_nr as ref, full_name as label, stage, priority, city,
    next_action, next_action_date, last_activity_at, days_since_activity, active_presentations
  from public.candidate_cards
  where stage not in ('platziert', 'raus', 'pool')
  union all
  select 'company', id, null, name, stage, priority, city,
    next_action, next_action_date, last_activity_at, days_since_activity, active_presentations
  from public.company_cards
  where stage <> 'tabu'
)
select o.*, 'heute'::text as bucket from open_items o where o.next_action_date = public.app_today()
union all
select o.*, case when o.next_action_date is null then 'ohne_datum' else 'ueberfaellig' end
from open_items o where o.next_action_date is null or o.next_action_date < public.app_today()
union all
select o.*, 'eingeschlafen' from open_items o where o.days_since_activity >= 14;

-- Löschfrist erreicht (monatlich prüfen, Löschen nur nach Bestätigung).
create or replace view public.deletion_due with (security_invoker = true) as
select c.id, c.k_nr, btrim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')) as full_name,
  c.stage, c.delete_after
from public.candidates c
where c.delete_after is not null and c.delete_after <= public.app_today();

-- Globale Suche über Kandidaten, Firmen, Ansprechpartner.
create or replace function public.global_search(p_query text, p_limit int default 30)
returns table (entity_type text, id uuid, label text, sublabel text, stage text)
language sql stable as $$
  with q as (select btrim(p_query) as t, public.normalize_phone(p_query) as ph)
  (select 'candidate', c.id, c.k_nr || ' · ' || btrim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')),
     concat_ws(' · ', c.profile_title, c.city), c.stage
   from public.candidates c, q
   where length(q.t) >= 2 and (
     c.k_nr ilike '%' || q.t || '%'
     or (coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')) ilike '%' || q.t || '%'
     or (coalesce(c.last_name, '') || ' ' || coalesce(c.first_name, '')) ilike '%' || q.t || '%'
     or c.email ilike '%' || q.t || '%'
     or (length(q.ph) >= 5 and public.normalize_phone(c.phone) like '%' || q.ph || '%')
     or array_to_string(c.legacy_k_nrs, ' ') ilike '%' || q.t || '%')
   limit p_limit)
  union all
  (select 'company', f.id, f.name, concat_ws(' · ', f.city, f.industry), f.stage
   from public.companies f, q
   where length(q.t) >= 2 and (f.name ilike '%' || q.t || '%' or f.legal_name ilike '%' || q.t || '%'
     or f.group_name ilike '%' || q.t || '%')
   limit p_limit)
  union all
  (select 'company', f.id, ct.name || ' (' || f.name || ')', concat_ws(' · ', ct.role, ct.email, ct.phone), f.stage
   from public.contacts ct join public.companies f on f.id = ct.company_id, q
   where length(q.t) >= 2 and (ct.name ilike '%' || q.t || '%' or ct.email ilike '%' || q.t || '%'
     or (length(q.ph) >= 5 and public.normalize_phone(ct.phone) like '%' || q.ph || '%'))
   limit p_limit)
$$;

-- Matching: Kandidaten für eine Stelle, bereits vorgestellte/gesperrte markiert.
create or replace function public.match_candidates(p_job_id uuid, p_category text default null)
returns table (
  candidate_id uuid, k_nr text, full_name text, category text, city text, plz text, radius_km int,
  salary_wish text, available_from text, stage text, priority text,
  already_presented boolean, blocked boolean, block_reason text, score int)
language plpgsql stable as $$
declare
  j public.jobs;
begin
  select * into j from public.jobs where id = p_job_id;
  if j.id is null then return; end if;
  return query
  select c.id, c.k_nr, btrim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')),
    c.category, c.city, c.plz, c.radius_km, c.salary_wish, c.available_from, c.stage, c.priority,
    exists (select 1 from public.presentations p join public.companies o on o.id = p.company_id
            join public.companies f on f.id = j.company_id
            where p.candidate_id = c.id and (o.id = f.id or (public.normalize_name(f.group_name) is not null
              and public.normalize_name(o.group_name) = public.normalize_name(f.group_name)))),
    jsonb_array_length(chk->'blocking') > 0,
    chk->'blocking'->0->>'message',
    (case when p_category is not null and c.category = p_category then 3 else 0 end
     + case when public.normalize_name(c.city) = public.normalize_name(j.city) then 3
            when left(coalesce(c.plz, ''), 2) <> '' and exists (select 1 from public.companies f
              where f.id = j.company_id and left(f.plz, 2) = left(c.plz, 2)) then 2 else 0 end
     + case c.priority when 'A' then 2 when 'B' then 1 else 0 end
     + case when c.stage in ('vermarktbar', 'vorgestellt') then 2 else 0 end)::int
  from public.candidates c
  cross join lateral (select public.check_presentation(c.id, j.company_id, null, true) as chk) x
  where c.stage not in ('platziert', 'raus')
    and (p_category is null or c.category = p_category)
  order by 15 desc, 2;
end $$;

-- ---------------------------------------------------------------------------
-- Rollen
-- ---------------------------------------------------------------------------
-- claude_agent: eigener DB-Benutzer für Claude. Lesen, anlegen, ändern – kein DELETE.
-- Passwort/Login wird NICHT hier gesetzt, sondern einmalig per SQL (siehe README).

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'claude_agent') then
    create role claude_agent nologin noinherit;
  end if;
  -- Ermöglicht den Zugriff über PostgREST/Supabase-JWT mit role=claude_agent.
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    grant claude_agent to authenticator;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Rechte
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon, public;

grant usage on schema public to authenticated, claude_agent;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select, insert, update on all tables in schema public to claude_agent;
revoke delete, truncate on all tables in schema public from claude_agent;
grant execute on all functions in schema public to authenticated, claude_agent, service_role;
-- Zusammenführen löscht – nicht für Claude.
revoke execute on function public.merge_candidates(uuid, uuid) from claude_agent;

-- ---------------------------------------------------------------------------
-- Row Level Security: nur eingeloggte Nutzer und claude_agent.
-- (Sign-ups in Supabase Auth deaktivieren – siehe README.)
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['candidates', 'companies', 'contacts', 'jobs', 'presentations',
    'self_applications', 'activities', 'placements', 'blocklist', 'ba_profiles', 'k_nr_counters']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for all to authenticated using (true) with check (true)',
      t || '_app_all', t);
    execute format('create policy %I on public.%I for select to claude_agent using (true)',
      t || '_agent_select', t);
    execute format('create policy %I on public.%I for insert to claude_agent with check (true)',
      t || '_agent_insert', t);
    execute format('create policy %I on public.%I for update to claude_agent using (true) with check (true)',
      t || '_agent_update', t);
  end loop;
end $$;
