-- HueHYRE Tracker – Grundschema
-- Tabellen exakt nach Bauplan, Abschnitt "Datenmodell".
-- Alle Tabellen: id (uuid), created_at, updated_at.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Hilfsfunktionen
-- ---------------------------------------------------------------------------

-- "Heute" immer in deutscher Zeit, nicht UTC.
create or replace function public.app_today() returns date
language sql stable as $$
  select (now() at time zone 'Europe/Berlin')::date
$$;

-- Telefon normalisieren: nur Ziffern, +49/0049 -> 0.
create or replace function public.normalize_phone(p text) returns text
language sql immutable as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        regexp_replace(coalesce(p, ''), '[^0-9+]', '', 'g'),
        '^(\+|00)49', '0'),
      '[^0-9]', '', 'g'),
    '')
$$;

create or replace function public.normalize_email(p text) returns text
language sql immutable as $$
  select nullif(lower(btrim(coalesce(p, ''))), '')
$$;

create or replace function public.normalize_name(p text) returns text
language sql immutable as $$
  select nullif(lower(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g')), '')
$$;

-- Wer schreibt gerade? Claude (DB-User claude_agent) oder Hüsnü (App-Login).
create or replace function public.current_actor() returns text
language sql stable as $$
  select case
    when current_user = 'claude_agent' or session_user = 'claude_agent' then 'Claude'
    else coalesce(nullif(current_setting('app.actor', true), ''), 'Hüsnü')
  end
$$;

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- K-Nummern: K-2026-065 (Jahr aus Datum, laufende Nummer je Jahr)
-- ---------------------------------------------------------------------------

create table public.k_nr_counters (
  year int primary key,
  last_no int not null default 0
);

create or replace function public.next_k_nr(p_date date default null) returns text
language plpgsql as $$
declare
  v_year int := extract(year from coalesce(p_date, public.app_today()))::int;
  v_no int;
begin
  insert into public.k_nr_counters as c (year, last_no) values (v_year, 1)
  on conflict (year) do update set last_no = c.last_no + 1
  returning last_no into v_no;
  return format('K-%s-%s', v_year, lpad(v_no::text, 3, '0'));
end $$;

-- ---------------------------------------------------------------------------
-- Tabellen
-- ---------------------------------------------------------------------------

create table public.candidates (
  id uuid primary key default gen_random_uuid(),
  k_nr text not null unique check (k_nr ~ '^K-[0-9]{4}-[0-9]{3,}$'),
  first_name text,
  last_name text,
  email text,
  phone text,
  plz text,
  city text,
  profile_title text,
  skills text,
  category text check (category in ('Technik', 'Kaufm.', 'Vertrieb', 'Logistik', 'IT')),
  salary_wish text,
  available_from text,
  notice_period text,
  radius_km int check (radius_km is null or radius_km >= 0),
  remote_wish text,
  exclusions text,
  source text check (source in ('Indeed', 'BA', 'Gmail', 'Empfehlung', 'Maron', 'Telefon', 'Sonstige')),
  stage text not null default 'neu' check (stage in (
    'neu', 'qualifizieren', 'vermarktbar', 'vorgestellt', 'interview', 'angebot', 'platziert',
    'pausiert', 'raus', 'pool')),
  priority text check (priority in ('A', 'B', 'C')),
  next_action text,
  next_action_date date,
  consent_date date,
  consent_scope text,
  delete_after date,
  cv_file text,
  notes text,
  legacy_k_nrs text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Dubletten hart verhindern: gleiche E-Mail / gleiche Telefonnummer.
create unique index candidates_email_uq on public.candidates (public.normalize_email(email))
  where public.normalize_email(email) is not null;
create unique index candidates_phone_uq on public.candidates (public.normalize_phone(phone))
  where public.normalize_phone(phone) is not null;
create index candidates_name_plz_idx on public.candidates
  (public.normalize_name(first_name), public.normalize_name(last_name), plz);
create index candidates_stage_idx on public.candidates (stage);
create index candidates_next_action_idx on public.candidates (next_action_date);
create index candidates_search_idx on public.candidates using gin (
  (coalesce(first_name, '') || ' ' || coalesce(last_name, '') || ' ' || k_nr || ' ' ||
   coalesce(city, '') || ' ' || coalesce(profile_title, '')) gin_trgm_ops);

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_name text,
  -- Schwesterfirmen (z. B. Humbaur/Kögel) teilen sich group_name.
  group_name text,
  city text,
  plz text,
  industry text,
  size text,
  website text,
  careers_url text,
  stage text not null default 'lead' check (stage in (
    'lead', 'angeschrieben', 'im_gespraech', 'konditionen', 'kunde_aktiv', 'ruhend', 'tabu')),
  priority text check (priority in ('A', 'B', 'C')),
  pays_agencies text check (pays_agencies in ('ja', 'nein', 'unklar')),
  fee_agreed text,
  agb_sent_date date,
  next_action text,
  next_action_date date,
  source text check (source in ('Leadliste', 'Endkunden-Recherche', 'Empfehlung', 'Sonstige')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index companies_name_uq on public.companies (public.normalize_name(name));
create index companies_group_idx on public.companies (public.normalize_name(group_name));
create index companies_stage_idx on public.companies (stage);
create index companies_search_idx on public.companies using gin (
  (name || ' ' || coalesce(legal_name, '') || ' ' || coalesce(city, '')) gin_trgm_ops);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  role text,
  email text,
  phone text,
  linkedin text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index contacts_company_idx on public.contacts (company_id);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  title text not null,
  city text,
  url text,
  source_type text check (source_type in ('eigene Anzeige', 'Vermittler-Anzeige', 'Mandat', 'initiativ', 'Vorschlag')),
  salary_range text,
  posted_date date,
  last_checked_date date,
  status text not null default 'online' check (status in ('online', 'offline', 'besetzt')),
  ref_no text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index jobs_company_idx on public.jobs (company_id);

create table public.presentations (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete restrict,
  job_id uuid references public.jobs (id) on delete set null,
  sent_date date not null default public.app_today(),
  channel text check (channel in ('Mail', 'Telefon', 'Portal')),
  anonymous boolean not null default false,
  consent_given_date date,
  status text not null default 'vorgestellt' check (status in (
    'vorgestellt', 'interesse', 'interview', 'angebot', 'zusage', 'absage', 'zurueckgezogen')),
  result_date date,
  rejection_reason text,
  gmail_thread_id text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Eine Vorstellung je Kandidat+Firma.
create unique index presentations_candidate_company_uq on public.presentations (candidate_id, company_id);
create index presentations_company_idx on public.presentations (company_id);

create table public.self_applications (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  company_name text not null,
  date date,
  result text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index self_applications_candidate_idx on public.self_applications (candidate_id);

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('candidate', 'company')),
  entity_id uuid not null,
  type text not null check (type in ('Mail', 'Anruf', 'SMS', 'WhatsApp', 'Indeed', 'BA', 'Notiz', 'Status')),
  direction text check (direction in ('ein', 'aus')),
  occurred_at timestamptz not null default now(),
  summary text not null,
  link text,
  created_by text not null default public.current_actor() check (created_by in ('Hüsnü', 'Claude', 'Import')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index activities_entity_idx on public.activities (entity_type, entity_id, occurred_at desc);

create table public.placements (
  id uuid primary key default gen_random_uuid(),
  presentation_id uuid not null unique references public.presentations (id) on delete restrict,
  start_date date,
  annual_salary numeric(12, 2),
  fee_percent numeric(5, 2),
  fee_amount numeric(12, 2),
  invoice_date date,
  paid_date date,
  guarantee_until date,
  split_partner text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.blocklist (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('Person', 'Firma', 'Regel')),
  name text not null,
  candidate_id uuid references public.candidates (id) on delete cascade,
  company_id uuid references public.companies (id) on delete cascade,
  -- 'alle' = überall gesperrt; 'nur_firma' = Person nur bei company_id gesperrt.
  scope text not null default 'alle' check (scope in ('alle', 'nur_firma')),
  reason text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (scope <> 'nur_firma' or company_id is not null)
);
create index blocklist_candidate_idx on public.blocklist (candidate_id);
create index blocklist_company_idx on public.blocklist (company_id);

create table public.ba_profiles (
  id uuid primary key default gen_random_uuid(),
  ref_no text not null unique,
  search text,
  qualification text,
  age int,
  city text,
  contacted_date date,
  reply text,
  candidate_id uuid references public.candidates (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- updated_at-Trigger überall
do $$
declare t text;
begin
  foreach t in array array['candidates', 'companies', 'contacts', 'jobs', 'presentations',
    'self_applications', 'activities', 'placements', 'blocklist', 'ba_profiles']
  loop
    execute format('create trigger %I before update on public.%I
      for each row execute function public.set_updated_at()', t || '_updated_at', t);
  end loop;
end $$;
