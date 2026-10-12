-- HueHYRE Tracker – Trigger und Schutzregeln (Bauplan, Abschnitt "Schutzregeln").
-- Alle Funktionen laufen als SECURITY INVOKER, damit RLS und Rechte von
-- claude_agent (kein DELETE) greifen und current_actor() stimmt.

-- Rollen, die Regeln umgehen dürfen (Import-Skript, Migrationen).
create or replace function public.is_privileged() returns boolean
language sql stable as $$
  select current_user not in ('authenticated', 'anon', 'claude_agent')
$$;

-- ---------------------------------------------------------------------------
-- K-Nummer: immer automatisch, nie manuell, nie änderbar
-- ---------------------------------------------------------------------------

create or replace function public.candidates_k_nr() returns trigger
language plpgsql as $$
declare
  v_year int;
  v_no int;
begin
  if tg_op = 'INSERT' then
    if new.k_nr is null or not public.is_privileged() then
      new.k_nr := public.next_k_nr(public.app_today());
    else
      -- Import übernimmt bestehende Nummern: Zähler nachziehen.
      v_year := split_part(new.k_nr, '-', 2)::int;
      v_no := split_part(new.k_nr, '-', 3)::int;
      insert into public.k_nr_counters as c (year, last_no) values (v_year, v_no)
      on conflict (year) do update set last_no = greatest(c.last_no, excluded.last_no);
    end if;
  elsif new.k_nr is distinct from old.k_nr and not public.is_privileged() then
    raise exception 'K-Nummer kann nicht geändert werden (%).', old.k_nr
      using errcode = 'P0001', hint = 'K_NR_IMMUTABLE';
  end if;
  return new;
end $$;

create trigger candidates_k_nr before insert or update of k_nr on public.candidates
  for each row execute function public.candidates_k_nr();

-- ---------------------------------------------------------------------------
-- Einwilligung: ohne consent_date nicht nach "Vermarktbar"
-- ---------------------------------------------------------------------------

create or replace function public.candidates_consent_guard() returns trigger
language plpgsql as $$
begin
  if new.stage = 'vermarktbar' and new.consent_date is null
     and (tg_op = 'INSERT' or old.stage is distinct from new.stage)
     and not public.is_privileged() then
    raise exception 'Ohne Einwilligung (consent_date) kein Wechsel nach „Vermarktbar“.'
      using errcode = 'P0001', hint = 'CONSENT_MISSING';
  end if;
  return new;
end $$;

create trigger candidates_consent_guard before insert or update of stage, consent_date on public.candidates
  for each row execute function public.candidates_consent_guard();

-- ---------------------------------------------------------------------------
-- Zeitstrahl: Anlegen, Spaltenwechsel und Wiedervorlage-Änderung protokollieren
-- ---------------------------------------------------------------------------

create or replace function public.log_entity_changes() returns trigger
language plpgsql as $$
declare
  v_type text := case tg_table_name when 'candidates' then 'candidate' else 'company' end;
  v_actor text := case when public.is_privileged()
    and coalesce(current_setting('app.actor', true), '') = '' then 'Import' else public.current_actor() end;
  v_parts text[] := '{}';
begin
  if tg_op = 'INSERT' then
    insert into public.activities (entity_type, entity_id, type, summary, created_by)
    values (v_type, new.id, 'Status', 'Angelegt in Spalte „' || new.stage || '“', v_actor);
    return new;
  end if;

  if new.stage is distinct from old.stage then
    v_parts := v_parts || ('Spalte: ' || old.stage || ' → ' || new.stage);
  end if;
  if new.next_action_date is distinct from old.next_action_date
     or new.next_action is distinct from old.next_action then
    v_parts := v_parts || ('Nächste Aktion: ' || coalesce(new.next_action, '–') || ' am ' ||
      coalesce(to_char(new.next_action_date, 'DD.MM.YYYY'), 'kein Datum'));
  end if;
  if array_length(v_parts, 1) > 0 then
    insert into public.activities (entity_type, entity_id, type, summary, created_by)
    values (v_type, new.id, 'Status', array_to_string(v_parts, ' · '), v_actor);
  end if;
  return new;
end $$;

create trigger candidates_log after insert or update of stage, next_action, next_action_date
  on public.candidates for each row execute function public.log_entity_changes();
create trigger companies_log after insert or update of stage, next_action, next_action_date
  on public.companies for each row execute function public.log_entity_changes();

-- ---------------------------------------------------------------------------
-- Dublettenprüfung: E-Mail, Telefon (normalisiert), Name + PLZ/Ort
-- ---------------------------------------------------------------------------

create or replace function public.find_duplicate_candidates(
  p_email text default null,
  p_phone text default null,
  p_first_name text default null,
  p_last_name text default null,
  p_plz text default null,
  p_city text default null,
  p_exclude_id uuid default null
) returns table (id uuid, k_nr text, name text, match text)
language sql stable as $$
  select c.id, c.k_nr, btrim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')),
    case
      when public.normalize_email(p_email) is not null
        and public.normalize_email(c.email) = public.normalize_email(p_email) then 'email'
      when public.normalize_phone(p_phone) is not null
        and public.normalize_phone(c.phone) = public.normalize_phone(p_phone) then 'phone'
      else 'name_ort'
    end
  from public.candidates c
  where (p_exclude_id is null or c.id <> p_exclude_id)
    and (
      (public.normalize_email(p_email) is not null
        and public.normalize_email(c.email) = public.normalize_email(p_email))
      or (public.normalize_phone(p_phone) is not null
        and public.normalize_phone(c.phone) = public.normalize_phone(p_phone))
      or (public.normalize_name(p_last_name) is not null
        and public.normalize_name(c.last_name) = public.normalize_name(p_last_name)
        and public.normalize_name(c.first_name) is not distinct from public.normalize_name(p_first_name)
        and ((nullif(btrim(p_plz), '') is not null and c.plz = btrim(p_plz))
          or (public.normalize_name(p_city) is not null
            and public.normalize_name(c.city) = public.normalize_name(p_city))))
    )
$$;

-- Felder, die über create_candidate/update_candidate gesetzt werden dürfen.
create or replace function public.candidate_from_json(p jsonb, base public.candidates)
returns public.candidates
language plpgsql stable as $$
declare
  r public.candidates := base;
begin
  if p ? 'first_name' then r.first_name := nullif(btrim(p->>'first_name'), ''); end if;
  if p ? 'last_name' then r.last_name := nullif(btrim(p->>'last_name'), ''); end if;
  if p ? 'email' then r.email := nullif(btrim(p->>'email'), ''); end if;
  if p ? 'phone' then r.phone := nullif(btrim(p->>'phone'), ''); end if;
  if p ? 'plz' then r.plz := nullif(btrim(p->>'plz'), ''); end if;
  if p ? 'city' then r.city := nullif(btrim(p->>'city'), ''); end if;
  if p ? 'profile_title' then r.profile_title := nullif(p->>'profile_title', ''); end if;
  if p ? 'skills' then r.skills := nullif(p->>'skills', ''); end if;
  if p ? 'category' then r.category := nullif(p->>'category', ''); end if;
  if p ? 'salary_wish' then r.salary_wish := nullif(p->>'salary_wish', ''); end if;
  if p ? 'available_from' then r.available_from := nullif(p->>'available_from', ''); end if;
  if p ? 'notice_period' then r.notice_period := nullif(p->>'notice_period', ''); end if;
  if p ? 'radius_km' then r.radius_km := nullif(p->>'radius_km', '')::int; end if;
  if p ? 'remote_wish' then r.remote_wish := nullif(p->>'remote_wish', ''); end if;
  if p ? 'exclusions' then r.exclusions := nullif(p->>'exclusions', ''); end if;
  if p ? 'source' then r.source := nullif(p->>'source', ''); end if;
  if p ? 'priority' then r.priority := nullif(p->>'priority', ''); end if;
  if p ? 'next_action' then r.next_action := nullif(p->>'next_action', ''); end if;
  if p ? 'next_action_date' then r.next_action_date := nullif(p->>'next_action_date', '')::date; end if;
  if p ? 'consent_date' then r.consent_date := nullif(p->>'consent_date', '')::date; end if;
  if p ? 'consent_scope' then r.consent_scope := nullif(p->>'consent_scope', ''); end if;
  if p ? 'delete_after' then r.delete_after := nullif(p->>'delete_after', '')::date; end if;
  if p ? 'cv_file' then r.cv_file := nullif(p->>'cv_file', ''); end if;
  if p ? 'notes' then r.notes := nullif(p->>'notes', ''); end if;
  return r;
end $$;

-- Kandidat anlegen mit Dublettenprüfung.
-- Treffer per E-Mail/Telefon sind immer ein Stopp (Unique-Index);
-- Treffer nur per Name+Ort lassen sich mit p_force = true übergehen.
create or replace function public.create_candidate(p jsonb, p_force boolean default false)
returns jsonb
language plpgsql as $$
declare
  v_dups jsonb;
  v_hard boolean;
  r public.candidates;
  v_stage text := coalesce(nullif(p->>'stage', ''), 'neu');
begin
  select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb), coalesce(bool_or(d.match <> 'name_ort'), false)
    into v_dups, v_hard
  from public.find_duplicate_candidates(p->>'email', p->>'phone', p->>'first_name',
    p->>'last_name', p->>'plz', p->>'city') d;

  if jsonb_array_length(v_dups) > 0 and (v_hard or not p_force) then
    return jsonb_build_object('ok', false, 'reason', 'duplicate', 'duplicates', v_dups,
      'message', 'Existiert schon als ' || (v_dups->0->>'k_nr') ||
        ' (' || (v_dups->0->>'name') || ') – zusammenführen statt neu anlegen.');
  end if;

  if v_stage not in ('neu', 'pool') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_stage',
      'message', 'Neue Kandidaten starten in „neu“ oder „pool“; danach über move_candidate weiterschieben.');
  end if;

  r := public.candidate_from_json(p, null::public.candidates);
  r.id := gen_random_uuid();
  r.stage := v_stage;
  r.legacy_k_nrs := '{}';
  r.created_at := now();
  r.updated_at := now();
  insert into public.candidates select r.* returning * into r;

  return jsonb_build_object('ok', true, 'id', r.id, 'k_nr', r.k_nr,
    'duplicates', v_dups);
end $$;

-- Kandidat aktualisieren (ohne Spaltenwechsel; dafür move_candidate).
create or replace function public.update_candidate(p_id uuid, p jsonb)
returns jsonb
language plpgsql as $$
declare
  r public.candidates;
  v_dups jsonb;
begin
  select * into r from public.candidates where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found', 'message', 'Kandidat nicht gefunden.');
  end if;
  r := public.candidate_from_json(p, r);

  select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) into v_dups
  from public.find_duplicate_candidates(r.email, r.phone, null, null, null, null, p_id) d;
  if jsonb_array_length(v_dups) > 0 then
    return jsonb_build_object('ok', false, 'reason', 'duplicate', 'duplicates', v_dups,
      'message', 'E-Mail/Telefon gehört schon zu ' || (v_dups->0->>'k_nr') || '.');
  end if;

  update public.candidates c set
    first_name = r.first_name, last_name = r.last_name, email = r.email, phone = r.phone,
    plz = r.plz, city = r.city, profile_title = r.profile_title, skills = r.skills,
    category = r.category, salary_wish = r.salary_wish, available_from = r.available_from,
    notice_period = r.notice_period, radius_km = r.radius_km, remote_wish = r.remote_wish,
    exclusions = r.exclusions, source = r.source, priority = r.priority,
    next_action = r.next_action, next_action_date = r.next_action_date,
    consent_date = r.consent_date, consent_scope = r.consent_scope,
    delete_after = r.delete_after, cv_file = r.cv_file, notes = r.notes
  where c.id = p_id;
  return jsonb_build_object('ok', true, 'id', r.id, 'k_nr', r.k_nr);
end $$;

-- Zwei Kandidaten zusammenführen: p_merge_id geht in p_keep_id auf.
-- Nur für eingeloggte Nutzer (löscht den Doppel-Datensatz), nicht für Claude.
create or replace function public.merge_candidates(p_keep_id uuid, p_merge_id uuid)
returns jsonb
language plpgsql as $$
declare
  k public.candidates;
  m public.candidates;
begin
  if p_keep_id = p_merge_id then
    return jsonb_build_object('ok', false, 'message', 'Gleicher Datensatz.');
  end if;
  select * into k from public.candidates where id = p_keep_id for update;
  select * into m from public.candidates where id = p_merge_id for update;
  if k.id is null or m.id is null then
    return jsonb_build_object('ok', false, 'message', 'Kandidat nicht gefunden.');
  end if;

  -- Doppelte Vorstellungen: die ältere behalten.
  delete from public.presentations pm
  using public.presentations pk
  where pm.candidate_id = m.id and pk.candidate_id = k.id and pm.company_id = pk.company_id
    and not exists (select 1 from public.placements pl where pl.presentation_id = pm.id);
  update public.presentations set candidate_id = k.id where candidate_id = m.id;
  update public.self_applications set candidate_id = k.id where candidate_id = m.id;
  update public.blocklist set candidate_id = k.id where candidate_id = m.id;
  update public.ba_profiles set candidate_id = k.id where candidate_id = m.id;
  update public.activities set entity_id = k.id where entity_type = 'candidate' and entity_id = m.id;

  delete from public.candidates where id = m.id;

  update public.candidates set
    email = coalesce(k.email, m.email),
    phone = coalesce(k.phone, m.phone),
    first_name = coalesce(k.first_name, m.first_name),
    last_name = coalesce(k.last_name, m.last_name),
    plz = coalesce(k.plz, m.plz), city = coalesce(k.city, m.city),
    profile_title = coalesce(k.profile_title, m.profile_title),
    skills = coalesce(k.skills, m.skills), category = coalesce(k.category, m.category),
    salary_wish = coalesce(k.salary_wish, m.salary_wish),
    available_from = coalesce(k.available_from, m.available_from),
    notice_period = coalesce(k.notice_period, m.notice_period),
    radius_km = coalesce(k.radius_km, m.radius_km),
    remote_wish = coalesce(k.remote_wish, m.remote_wish),
    exclusions = coalesce(k.exclusions, m.exclusions),
    source = coalesce(k.source, m.source),
    consent_date = coalesce(k.consent_date, m.consent_date),
    consent_scope = coalesce(k.consent_scope, m.consent_scope),
    cv_file = coalesce(k.cv_file, m.cv_file),
    notes = nullif(concat_ws(E'\n', k.notes, m.notes), ''),
    legacy_k_nrs = (select array_agg(distinct x) from unnest(k.legacy_k_nrs || m.legacy_k_nrs || m.k_nr) x)
  where id = k.id;

  insert into public.activities (entity_type, entity_id, type, summary)
  values ('candidate', k.id, 'Notiz', 'Zusammengeführt mit ' || m.k_nr || ' (' ||
    btrim(coalesce(m.first_name, '') || ' ' || coalesce(m.last_name, '')) || ')');

  return jsonb_build_object('ok', true, 'id', k.id, 'k_nr', k.k_nr, 'merged_k_nr', m.k_nr);
end $$;

-- ---------------------------------------------------------------------------
-- Vorstellungsprüfung
-- ---------------------------------------------------------------------------
-- Ergebnis: { blocking: [{code, message}], confirm: [{code, message}], hints: [{code, message}] }
--   blocking = Stopp, confirm = nur mit Bestätigung, hints = Hinweis.

create or replace function public.check_presentation(
  p_candidate_id uuid,
  p_company_id uuid,
  p_job_id uuid default null,
  p_anonymous boolean default false
) returns jsonb
language plpgsql stable as $$
declare
  c public.candidates;
  f public.companies;
  j public.jobs;
  v_blocking jsonb := '[]';
  v_confirm jsonb := '[]';
  v_hints jsonb := '[]';
  rec record;
  v_full_name text;
begin
  select * into c from public.candidates where id = p_candidate_id;
  select * into f from public.companies where id = p_company_id;
  if c.id is null then
    return jsonb_build_object('blocking', jsonb_build_array(jsonb_build_object(
      'code', 'NOT_FOUND', 'message', 'Kandidat nicht gefunden.')), 'confirm', '[]'::jsonb, 'hints', '[]'::jsonb);
  end if;
  if f.id is null then
    return jsonb_build_object('blocking', jsonb_build_array(jsonb_build_object(
      'code', 'NOT_FOUND', 'message', 'Firma nicht gefunden.')), 'confirm', '[]'::jsonb, 'hints', '[]'::jsonb);
  end if;
  v_full_name := public.normalize_name(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, ''));

  -- 1. Doppelte Vorstellung bei derselben Firma
  for rec in select p.sent_date from public.presentations p
             where p.candidate_id = c.id and p.company_id = f.id loop
    v_blocking := v_blocking || jsonb_build_object('code', 'DUPLICATE_PRESENTATION',
      'message', 'Schon bei ' || f.name || ' vorgestellt am ' || to_char(rec.sent_date, 'DD.MM.YYYY') || '.',
      'first_date', rec.sent_date);
  end loop;

  -- 2. Schwesterfirma (gleiche group_name)
  if public.normalize_name(f.group_name) is not null then
    for rec in select o.name, p.sent_date from public.presentations p
               join public.companies o on o.id = p.company_id
               where p.candidate_id = c.id and o.id <> f.id
                 and public.normalize_name(o.group_name) = public.normalize_name(f.group_name) loop
      v_confirm := v_confirm || jsonb_build_object('code', 'SISTER_COMPANY',
        'message', 'Schon bei Schwesterfirma ' || rec.name || ' vorgestellt am ' ||
          to_char(rec.sent_date, 'DD.MM.YYYY') || ' (Gruppe ' || f.group_name || ').',
        'first_date', rec.sent_date);
    end loop;
  end if;

  -- 3. Selbst beworben
  for rec in select s.company_name, s.date from public.self_applications s
             where s.candidate_id = c.id and (
               public.normalize_name(s.company_name) in (public.normalize_name(f.name), public.normalize_name(f.legal_name))
               or public.normalize_name(f.name) like '%' || public.normalize_name(s.company_name) || '%'
               or public.normalize_name(s.company_name) like '%' || public.normalize_name(f.name) || '%') loop
    v_blocking := v_blocking || jsonb_build_object('code', 'SELF_APPLIED',
      'message', 'Hat sich selbst bei ' || rec.company_name || ' beworben' ||
        coalesce(' (' || to_char(rec.date, 'DD.MM.YYYY') || ')', '') || ' – keine Vorstellung.');
  end loop;

  -- 4. Sperren
  if f.stage = 'tabu' then
    v_blocking := v_blocking || jsonb_build_object('code', 'COMPANY_TABU',
      'message', f.name || ' steht auf „Tabu“.');
  end if;
  for rec in select b.* from public.blocklist b
             where (b.candidate_id = c.id and (b.scope = 'alle' or b.company_id = f.id))
                or (b.candidate_id is null and b.type = 'Person' and b.scope = 'alle'
                    and public.normalize_name(b.name) = v_full_name)
                or (b.candidate_id is null and b.type = 'Person' and b.scope = 'nur_firma'
                    and b.company_id = f.id and public.normalize_name(b.name) = v_full_name)
                or (b.candidate_id is null and b.type in ('Firma', 'Regel') and (
                      b.company_id = f.id
                      or (b.company_id is null and public.normalize_name(b.name) in
                          (public.normalize_name(f.name), public.normalize_name(f.legal_name),
                           public.normalize_name(f.group_name)))))
  loop
    v_blocking := v_blocking || jsonb_build_object('code', 'BLOCKLIST',
      'message', 'Gesperrt (' || rec.type || ': ' || rec.name || '): ' || rec.reason);
  end loop;

  -- 5. Einwilligung bei nicht-anonymer Vorstellung
  if not p_anonymous and c.consent_date is null then
    v_blocking := v_blocking || jsonb_build_object('code', 'CONSENT_MISSING',
      'message', 'Keine Einwilligung (consent_date) – nur anonym vorstellen.');
  end if;

  -- 6. Stellencheck
  if p_job_id is not null then
    select * into j from public.jobs where id = p_job_id;
    if j.id is null or j.company_id <> f.id then
      v_blocking := v_blocking || jsonb_build_object('code', 'JOB_MISMATCH',
        'message', 'Stelle gehört nicht zu ' || f.name || '.');
    else
      if j.last_checked_date is null or j.last_checked_date < public.app_today() - 7 then
        v_hints := v_hints || jsonb_build_object('code', 'JOB_CHECK',
          'message', 'Anzeige erst prüfen – letzter Stellencheck: ' ||
            coalesce(to_char(j.last_checked_date, 'DD.MM.YYYY'), 'nie') || '.');
      end if;
      if j.status <> 'online' then
        v_hints := v_hints || jsonb_build_object('code', 'JOB_NOT_ONLINE',
          'message', 'Stelle ist als „' || j.status || '“ markiert.');
      end if;
    end if;
  end if;

  -- 7. Kandidat bereits raus/pausiert
  if c.stage in ('raus', 'pausiert') then
    v_hints := v_hints || jsonb_build_object('code', 'CANDIDATE_STAGE',
      'message', 'Kandidat steht auf „' || c.stage || '“.');
  end if;

  return jsonb_build_object('blocking', v_blocking, 'confirm', v_confirm, 'hints', v_hints);
end $$;

create or replace function public.create_presentation(
  p_candidate_id uuid,
  p_company_id uuid,
  p_job_id uuid default null,
  p_channel text default 'Mail',
  p_anonymous boolean default false,
  p_sent_date date default null,
  p_notes text default null,
  p_confirm boolean default false,
  p_gmail_thread_id text default null
) returns jsonb
language plpgsql as $$
declare
  v_check jsonb;
  v_id uuid;
  v_company text;
  c public.candidates;
begin
  v_check := public.check_presentation(p_candidate_id, p_company_id, p_job_id, p_anonymous);

  if jsonb_array_length(v_check->'blocking') > 0 then
    return v_check || jsonb_build_object('ok', false, 'reason', 'blocked',
      'message', v_check->'blocking'->0->>'message');
  end if;
  if jsonb_array_length(v_check->'confirm') > 0 and not p_confirm then
    return v_check || jsonb_build_object('ok', false, 'reason', 'needs_confirmation',
      'message', v_check->'confirm'->0->>'message');
  end if;

  select * into c from public.candidates where id = p_candidate_id;
  select name into v_company from public.companies where id = p_company_id;

  insert into public.presentations (candidate_id, company_id, job_id, sent_date, channel, anonymous,
    consent_given_date, notes, gmail_thread_id)
  values (p_candidate_id, p_company_id, p_job_id, coalesce(p_sent_date, public.app_today()), p_channel,
    p_anonymous, case when p_anonymous then null else c.consent_date end, p_notes, p_gmail_thread_id)
  returning id into v_id;

  insert into public.activities (entity_type, entity_id, type, direction, summary)
  values ('candidate', p_candidate_id, 'Status', 'aus',
          'Vorgestellt bei ' || v_company || case when p_anonymous then ' (anonym)' else '' end),
         ('company', p_company_id, 'Status', 'aus',
          'Kandidat ' || c.k_nr || ' vorgestellt' || case when p_anonymous then ' (anonym)' else '' end);

  if c.stage in ('neu', 'qualifizieren', 'vermarktbar') then
    update public.candidates set stage = 'vorgestellt' where id = p_candidate_id;
  end if;

  return v_check || jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- ---------------------------------------------------------------------------
-- Spaltenwechsel mit Pflichtfeldern (Bauplan, Abschnitt "Kanban-Boards")
-- ---------------------------------------------------------------------------
-- p_payload kann fehlende Pflichtangaben mitliefern, z. B.
--   {"consent_date": "2026-10-12", "salary_wish": "55k", "note": "...",
--    "reason": "...", "presentation_id": "...", "interview_date": "...",
--    "offer_salary": "...", "self_applications_none": true}
-- Fehlt etwas, kommt {ok:false, missing:[...]} zurück und nichts wird geändert.

create or replace function public.move_candidate(p_id uuid, p_stage text, p_payload jsonb default '{}')
returns jsonb
language plpgsql as $$
declare
  c public.candidates;
  v_missing text[] := '{}';
  v_note text := nullif(btrim(p_payload->>'note'), '');
  v_reason text := nullif(btrim(p_payload->>'reason'), '');
  v_pres uuid := nullif(p_payload->>'presentation_id', '')::uuid;
  v_pres_status text;
  v_company text;
begin
  select * into c from public.candidates where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'Kandidat nicht gefunden.');
  end if;
  if p_stage not in ('neu', 'qualifizieren', 'vermarktbar', 'vorgestellt', 'interview', 'angebot',
                     'platziert', 'pausiert', 'raus', 'pool') then
    return jsonb_build_object('ok', false, 'message', 'Unbekannte Spalte: ' || p_stage);
  end if;

  -- Mitgelieferte Stammdaten übernehmen (nur im Speicher, gespeichert wird am Ende).
  c := public.candidate_from_json(p_payload - 'note' - 'reason' - 'presentation_id'
    - 'interview_date' - 'offer_salary' - 'self_applications_none' - 'self_applications', c);

  if v_pres is not null then
    select p.status, f.name into v_pres_status, v_company from public.presentations p
      join public.companies f on f.id = p.company_id
      where p.id = v_pres and p.candidate_id = p_id;
    if v_company is null then
      return jsonb_build_object('ok', false, 'message', 'Vorstellung gehört nicht zu diesem Kandidaten.');
    end if;
  end if;

  case p_stage
    when 'neu' then
      if c.source is null then v_missing := v_missing || 'source'::text; end if;
      if c.email is null and c.phone is null then v_missing := v_missing || 'contact'::text; end if;
    when 'qualifizieren' then
      if v_note is null and c.next_action_date is null then
        v_missing := v_missing || 'note_or_appointment'::text;
      end if;
    when 'vermarktbar' then
      if c.consent_date is null then v_missing := v_missing || 'consent_date'::text; end if;
      if c.salary_wish is null then v_missing := v_missing || 'salary_wish'::text; end if;
      if c.available_from is null then v_missing := v_missing || 'available_from'::text; end if;
      if c.exclusions is null then v_missing := v_missing || 'exclusions'::text; end if;
      if not coalesce((p_payload->>'self_applications_none')::boolean, false)
         and jsonb_array_length(coalesce(p_payload->'self_applications', '[]')) = 0
         and not exists (select 1 from public.self_applications s where s.candidate_id = p_id)
         and not exists (select 1 from public.activities a where a.entity_type = 'candidate'
                         and a.entity_id = p_id and a.summary like 'Selbstbewerbungen abgefragt%') then
        v_missing := v_missing || 'self_applications'::text;
      end if;
    when 'vorgestellt' then
      if not exists (select 1 from public.presentations p where p.candidate_id = p_id) then
        v_missing := v_missing || 'presentation'::text;
      end if;
    when 'interview' then
      if v_pres is null and not exists (select 1 from public.presentations p
                                       where p.candidate_id = p_id and p.status = 'interview') then
        v_missing := v_missing || 'presentation_id'::text;
      end if;
      if v_pres is not null and nullif(p_payload->>'interview_date', '') is null then
        v_missing := v_missing || 'interview_date'::text;
      end if;
    when 'angebot' then
      if v_pres is null and not exists (select 1 from public.presentations p
                                       where p.candidate_id = p_id and p.status = 'angebot') then
        v_missing := v_missing || 'presentation_id'::text;
      end if;
      if v_pres is not null and nullif(btrim(p_payload->>'offer_salary'), '') is null then
        v_missing := v_missing || 'offer_salary'::text;
      end if;
    when 'platziert' then
      if not exists (select 1 from public.placements pl join public.presentations p on p.id = pl.presentation_id
                     where p.candidate_id = p_id) then
        v_missing := v_missing || 'placement'::text;
      end if;
    when 'pausiert' then
      if c.next_action_date is null or c.next_action_date <= public.app_today() then
        v_missing := v_missing || 'next_action_date'::text;
      end if;
    when 'raus' then
      if v_reason is null then v_missing := v_missing || 'reason'::text; end if;
    else null;
  end case;

  if array_length(v_missing, 1) > 0 then
    return jsonb_build_object('ok', false, 'reason', 'missing_fields', 'missing', to_jsonb(v_missing),
      'message', 'Pflichtangaben fehlen: ' || array_to_string(v_missing, ', '));
  end if;

  -- Selbstbewerbungen aus dem Formular speichern
  if jsonb_array_length(coalesce(p_payload->'self_applications', '[]')) > 0 then
    insert into public.self_applications (candidate_id, company_name, date, result)
    select p_id, x->>'company_name', nullif(x->>'date', '')::date, nullif(x->>'result', '')
    from jsonb_array_elements(p_payload->'self_applications') x
    where nullif(btrim(x->>'company_name'), '') is not null;
  end if;
  if coalesce((p_payload->>'self_applications_none')::boolean, false) then
    insert into public.activities (entity_type, entity_id, type, summary)
    values ('candidate', p_id, 'Notiz', 'Selbstbewerbungen abgefragt: keine');
  end if;

  if v_pres is not null and p_stage = 'interview' then
    update public.presentations set status = 'interview' where id = v_pres;
    c.next_action := coalesce(nullif(p_payload->>'next_action', ''), 'Interview bei ' || v_company);
    c.next_action_date := (p_payload->>'interview_date')::date;
  elsif v_pres is not null and p_stage = 'angebot' then
    update public.presentations set status = 'angebot',
      notes = concat_ws(E'\n', notes, 'Angebot: ' || (p_payload->>'offer_salary'))
    where id = v_pres;
    insert into public.activities (entity_type, entity_id, type, summary)
    values ('candidate', p_id, 'Notiz', 'Angebot von ' || v_company || ': ' || (p_payload->>'offer_salary'));
  end if;

  if v_note is not null then
    insert into public.activities (entity_type, entity_id, type, summary)
    values ('candidate', p_id, 'Notiz', v_note);
  end if;
  if v_reason is not null then
    insert into public.activities (entity_type, entity_id, type, summary)
    values ('candidate', p_id, 'Notiz', 'Grund (' || p_stage || '): ' || v_reason);
  end if;

  update public.candidates set
    stage = p_stage,
    first_name = c.first_name, last_name = c.last_name, email = c.email, phone = c.phone,
    plz = c.plz, city = c.city, profile_title = c.profile_title, skills = c.skills,
    category = c.category, salary_wish = c.salary_wish, available_from = c.available_from,
    notice_period = c.notice_period, radius_km = c.radius_km, remote_wish = c.remote_wish,
    exclusions = c.exclusions, source = c.source, priority = c.priority,
    next_action = case when p_stage in ('platziert', 'raus') and not (p_payload ? 'next_action') then null else c.next_action end,
    next_action_date = case when p_stage in ('platziert', 'raus') and not (p_payload ? 'next_action_date') then null else c.next_action_date end,
    consent_date = c.consent_date, consent_scope = c.consent_scope,
    delete_after = c.delete_after, notes = c.notes
  where id = p_id;

  return jsonb_build_object('ok', true, 'id', p_id, 'stage', p_stage);
end $$;

create or replace function public.move_company(p_id uuid, p_stage text, p_payload jsonb default '{}')
returns jsonb
language plpgsql as $$
declare
  f public.companies;
  v_missing text[] := '{}';
  v_note text := nullif(btrim(p_payload->>'note'), '');
  v_reason text := nullif(btrim(p_payload->>'reason'), '');
  v_contacted date := nullif(p_payload->>'contacted_at', '')::date;
begin
  select * into f from public.companies where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'Firma nicht gefunden.');
  end if;
  if p_stage not in ('lead', 'angeschrieben', 'im_gespraech', 'konditionen', 'kunde_aktiv', 'ruhend', 'tabu') then
    return jsonb_build_object('ok', false, 'message', 'Unbekannte Spalte: ' || p_stage);
  end if;

  if p_payload ? 'source' then f.source := nullif(p_payload->>'source', ''); end if;
  if p_payload ? 'fee_agreed' then f.fee_agreed := nullif(btrim(p_payload->>'fee_agreed'), ''); end if;
  if p_payload ? 'agb_sent_date' then f.agb_sent_date := nullif(p_payload->>'agb_sent_date', '')::date; end if;
  if p_payload ? 'next_action' then f.next_action := nullif(p_payload->>'next_action', ''); end if;
  if p_payload ? 'next_action_date' then f.next_action_date := nullif(p_payload->>'next_action_date', '')::date; end if;

  case p_stage
    when 'lead' then
      if f.source is null then v_missing := v_missing || 'source'::text; end if;
      if v_reason is null and f.notes is null
         and not exists (select 1 from public.jobs j where j.company_id = p_id) then
        v_missing := v_missing || 'job_or_reason'::text;
      end if;
    when 'angeschrieben' then
      if v_contacted is null then v_missing := v_missing || 'contacted_at'::text; end if;
    when 'im_gespraech' then
      if v_note is null then v_missing := v_missing || 'note'::text; end if;
    when 'konditionen' then
      if f.agb_sent_date is null then v_missing := v_missing || 'agb_sent_date'::text; end if;
      if f.fee_agreed is null then v_missing := v_missing || 'fee_agreed'::text; end if;
    when 'kunde_aktiv' then
      if f.fee_agreed is null then v_missing := v_missing || 'fee_agreed'::text; end if;
    when 'ruhend' then
      if f.next_action_date is null or f.next_action_date <= public.app_today() then
        v_missing := v_missing || 'next_action_date'::text;
      end if;
    when 'tabu' then
      if v_reason is null then v_missing := v_missing || 'reason'::text; end if;
    else null;
  end case;

  if array_length(v_missing, 1) > 0 then
    return jsonb_build_object('ok', false, 'reason', 'missing_fields', 'missing', to_jsonb(v_missing),
      'message', 'Pflichtangaben fehlen: ' || array_to_string(v_missing, ', '));
  end if;

  if v_contacted is not null then
    insert into public.activities (entity_type, entity_id, type, direction, occurred_at, summary)
    values ('company', p_id, 'Mail', 'aus', v_contacted::timestamptz,
      'Erstansprache' || coalesce(' an ' || nullif(p_payload->>'contact_name', ''), ''));
    if nullif(btrim(p_payload->>'contact_name'), '') is not null
       and not exists (select 1 from public.contacts ct where ct.company_id = p_id
                       and public.normalize_name(ct.name) = public.normalize_name(p_payload->>'contact_name')) then
      insert into public.contacts (company_id, name, email)
      values (p_id, btrim(p_payload->>'contact_name'), nullif(p_payload->>'contact_email', ''));
    end if;
  end if;
  if v_note is not null then
    insert into public.activities (entity_type, entity_id, type, summary) values ('company', p_id, 'Notiz', v_note);
  end if;
  if v_reason is not null then
    insert into public.activities (entity_type, entity_id, type, summary)
    values ('company', p_id, 'Notiz', 'Grund (' || p_stage || '): ' || v_reason);
    if p_stage = 'lead' and f.notes is null then f.notes := v_reason; end if;
  end if;
  if p_stage = 'tabu' and not exists (select 1 from public.blocklist b where b.company_id = p_id and b.type = 'Firma') then
    insert into public.blocklist (type, name, company_id, scope, reason)
    values ('Firma', f.name, p_id, 'alle', v_reason);
  end if;

  update public.companies set
    stage = p_stage, source = f.source, fee_agreed = f.fee_agreed, agb_sent_date = f.agb_sent_date,
    notes = f.notes,
    next_action = case when p_stage = 'tabu' and not (p_payload ? 'next_action') then null else f.next_action end,
    next_action_date = case when p_stage = 'tabu' and not (p_payload ? 'next_action_date') then null else f.next_action_date end
  where id = p_id;

  return jsonb_build_object('ok', true, 'id', p_id, 'stage', p_stage);
end $$;

-- "erledigt + nächste Aktion" aus der Heute-Liste
create or replace function public.complete_action(
  p_entity_type text, p_id uuid, p_summary text, p_next_action text, p_next_action_date date,
  p_activity_type text default 'Notiz'
) returns jsonb
language plpgsql as $$
begin
  if p_entity_type not in ('candidate', 'company') then
    return jsonb_build_object('ok', false, 'message', 'entity_type muss candidate oder company sein.');
  end if;
  if nullif(btrim(p_summary), '') is not null then
    insert into public.activities (entity_type, entity_id, type, summary)
    values (p_entity_type, p_id, coalesce(p_activity_type, 'Notiz'), 'Erledigt: ' || p_summary);
  end if;
  if p_entity_type = 'candidate' then
    update public.candidates set next_action = p_next_action, next_action_date = p_next_action_date where id = p_id;
  else
    update public.companies set next_action = p_next_action, next_action_date = p_next_action_date where id = p_id;
  end if;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'Datensatz nicht gefunden.');
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- BA-Profil in Kandidaten umwandeln
create or replace function public.convert_ba_profile(p_ba_id uuid, p jsonb)
returns jsonb
language plpgsql as $$
declare
  b public.ba_profiles;
  v_res jsonb;
begin
  select * into b from public.ba_profiles where id = p_ba_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'BA-Profil nicht gefunden.');
  end if;
  if b.candidate_id is not null then
    return jsonb_build_object('ok', false, 'message', 'Schon als Kandidat angelegt.', 'id', b.candidate_id);
  end if;
  v_res := public.create_candidate(
    jsonb_build_object('source', 'BA', 'city', b.city, 'profile_title', b.qualification,
      'notes', 'BA-Referenz ' || b.ref_no || coalesce(' · Suche: ' || b.search, '')) || coalesce(p, '{}'),
    coalesce((p->>'force')::boolean, false));
  if (v_res->>'ok')::boolean then
    update public.ba_profiles set candidate_id = (v_res->>'id')::uuid where id = p_ba_id;
  end if;
  return v_res;
end $$;
