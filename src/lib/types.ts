// Zeilentypen der Datenbank (siehe supabase/migrations).

export type Candidate = {
  id: string;
  k_nr: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  plz: string | null;
  city: string | null;
  profile_title: string | null;
  skills: string | null;
  category: string | null;
  salary_wish: string | null;
  available_from: string | null;
  notice_period: string | null;
  radius_km: number | null;
  remote_wish: string | null;
  exclusions: string | null;
  source: string | null;
  stage: string;
  priority: string | null;
  next_action: string | null;
  next_action_date: string | null;
  consent_date: string | null;
  consent_scope: string | null;
  delete_after: string | null;
  cv_file: string | null;
  notes: string | null;
  legacy_k_nrs: string[];
  created_at: string;
  updated_at: string;
};

export type CardExtras = {
  last_activity_at: string | null;
  days_since_activity: number;
  active_presentations: number;
  missing_next_action: boolean;
  overdue: boolean;
};

export type CandidateCard = Candidate & CardExtras & { full_name: string };

export type Company = {
  id: string;
  name: string;
  legal_name: string | null;
  group_name: string | null;
  city: string | null;
  plz: string | null;
  industry: string | null;
  size: string | null;
  website: string | null;
  careers_url: string | null;
  stage: string;
  priority: string | null;
  pays_agencies: string | null;
  fee_agreed: string | null;
  agb_sent_date: string | null;
  next_action: string | null;
  next_action_date: string | null;
  source: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type CompanyCard = Company & CardExtras & { open_jobs: number };

export type Contact = {
  id: string;
  company_id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  linkedin: string | null;
  notes: string | null;
};

export type Job = {
  id: string;
  company_id: string;
  title: string;
  city: string | null;
  url: string | null;
  source_type: string | null;
  salary_range: string | null;
  posted_date: string | null;
  last_checked_date: string | null;
  status: string;
  ref_no: string | null;
  notes: string | null;
};

export type Presentation = {
  id: string;
  candidate_id: string;
  company_id: string;
  job_id: string | null;
  sent_date: string;
  channel: string | null;
  anonymous: boolean;
  consent_given_date: string | null;
  status: string;
  result_date: string | null;
  rejection_reason: string | null;
  gmail_thread_id: string | null;
  notes: string | null;
};

export type Activity = {
  id: string;
  entity_type: "candidate" | "company";
  entity_id: string;
  type: string;
  direction: string | null;
  occurred_at: string;
  summary: string;
  link: string | null;
  created_by: string;
};

export type Placement = {
  id: string;
  presentation_id: string;
  start_date: string | null;
  annual_salary: number | null;
  fee_percent: number | null;
  fee_amount: number | null;
  invoice_date: string | null;
  paid_date: string | null;
  guarantee_until: string | null;
  split_partner: string | null;
};

export type BlocklistEntry = {
  id: string;
  type: "Person" | "Firma" | "Regel";
  name: string;
  candidate_id: string | null;
  company_id: string | null;
  scope: "alle" | "nur_firma";
  reason: string;
};

export type SelfApplication = {
  id: string;
  candidate_id: string;
  company_name: string;
  date: string | null;
  result: string | null;
};

export type BaProfile = {
  id: string;
  ref_no: string;
  search: string | null;
  qualification: string | null;
  age: number | null;
  city: string | null;
  contacted_date: string | null;
  reply: string | null;
  candidate_id: string | null;
};

export type TodayItem = {
  entity_type: "candidate" | "company";
  id: string;
  ref: string | null;
  label: string;
  stage: string;
  priority: string | null;
  city: string | null;
  next_action: string | null;
  next_action_date: string | null;
  last_activity_at: string | null;
  days_since_activity: number;
  active_presentations: number;
  bucket: "heute" | "ueberfaellig" | "ohne_datum" | "eingeschlafen";
};

export type GuardMessage = { code: string; message: string; first_date?: string };

/** Ergebnis von create_presentation / check_presentation. */
export type PresentationResult = {
  ok?: boolean;
  id?: string;
  reason?: "blocked" | "needs_confirmation";
  message?: string;
  blocking: GuardMessage[];
  confirm: GuardMessage[];
  hints: GuardMessage[];
};

/** Ergebnis von move_candidate / move_company / create_candidate. */
export type RpcResult = {
  ok: boolean;
  id?: string;
  k_nr?: string;
  reason?: string;
  message?: string;
  missing?: string[];
  duplicates?: { id: string; k_nr: string; name: string; match: string }[];
};
