"use server";

// Alle Schreibaktionen der Oberfläche. Die eigentlichen Regeln liegen in der
// Datenbank (move_candidate, create_presentation, …) – hier nur der Aufruf.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import type { PresentationResult, RpcResult } from "@/lib/types";

type Payload = Record<string, unknown>;

function fail(message: string): RpcResult {
  return { ok: false, message };
}

function dbError(error: { message: string; hint?: string } | null): RpcResult | null {
  if (!error) return null;
  if (error.message.includes("duplicate key")) return fail("Existiert schon (gleiche E-Mail/Telefon/Name).");
  return fail(error.message);
}

/** Leere Strings → null, damit die DB "nicht gesetzt" sieht. */
function clean(p: Payload): Payload {
  return Object.fromEntries(Object.entries(p).map(([k, v]) => [k, typeof v === "string" && v.trim() === "" ? null : v]));
}

function refresh(...paths: string[]) {
  for (const p of ["/", ...paths]) revalidatePath(p);
}

export async function logout() {
  const sb = await supabaseServer();
  await sb.auth.signOut();
  redirect("/login");
}

// ---------------------------------------------------------------- Kandidaten

export async function createCandidate(data: Payload, force = false): Promise<RpcResult> {
  const sb = await supabaseServer();
  const { data: r, error } = await sb.rpc("create_candidate", { p: clean(data), p_force: force });
  if (error) return dbError(error)!;
  if ((r as RpcResult).ok) refresh("/kandidaten");
  return r as RpcResult;
}

export async function updateCandidate(id: string, data: Payload): Promise<RpcResult> {
  const sb = await supabaseServer();
  const { data: r, error } = await sb.rpc("update_candidate", { p_id: id, p: clean(data) });
  if (error) return dbError(error)!;
  refresh("/kandidaten", `/kandidaten/${id}`);
  return r as RpcResult;
}

export async function moveCandidate(id: string, stage: string, payload: Payload = {}): Promise<RpcResult> {
  const sb = await supabaseServer();
  const { data: r, error } = await sb.rpc("move_candidate", { p_id: id, p_stage: stage, p_payload: clean(payload) });
  if (error) return dbError(error)!;
  refresh("/kandidaten", `/kandidaten/${id}`);
  return r as RpcResult;
}

export async function mergeCandidates(keepId: string, mergeId: string): Promise<RpcResult> {
  const sb = await supabaseServer();
  const { data: r, error } = await sb.rpc("merge_candidates", { p_keep_id: keepId, p_merge_id: mergeId });
  if (error) return dbError(error)!;
  refresh("/kandidaten", `/kandidaten/${keepId}`);
  return r as RpcResult;
}

/** Löschen nur nach Bestätigung (Löschfrist-Liste in Einstellungen). */
export async function deleteCandidate(id: string, confirmKnr: string): Promise<RpcResult> {
  const sb = await supabaseServer();
  const { data: c } = await sb.from("candidates").select("k_nr").eq("id", id).single();
  if (!c || c.k_nr !== confirmKnr.trim()) return fail("Zur Bestätigung die K-Nummer exakt eingeben.");
  // Vorstellungen mit Platzierung verhindern das Löschen (Honorar-Nachweis).
  const { error } = await sb.from("candidates").delete().eq("id", id);
  if (error) return fail(error.message.includes("foreign key") ? "Hat eine Platzierung – nicht löschbar." : error.message);
  await sb.from("activities").delete().eq("entity_type", "candidate").eq("entity_id", id);
  if (c) await sb.storage.from("cvs").list(c.k_nr).then(async ({ data }) => {
    if (data?.length) await sb.storage.from("cvs").remove(data.map((f) => `${c.k_nr}/${f.name}`));
  });
  refresh("/kandidaten", "/einstellungen");
  return { ok: true };
}

export async function addSelfApplication(candidateId: string, companyName: string, date: string | null, result: string | null) {
  if (!companyName.trim()) return fail("Firma angeben.");
  const sb = await supabaseServer();
  const { error } = await sb.from("self_applications").insert(clean({ candidate_id: candidateId, company_name: companyName.trim(), date, result }));
  if (error) return dbError(error)!;
  refresh(`/kandidaten/${candidateId}`);
  return { ok: true };
}

export async function deleteSelfApplication(id: string, candidateId: string) {
  const sb = await supabaseServer();
  const { error } = await sb.from("self_applications").delete().eq("id", id);
  if (error) return dbError(error)!;
  refresh(`/kandidaten/${candidateId}`);
  return { ok: true };
}

export async function uploadCv(candidateId: string, form: FormData): Promise<RpcResult> {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("Keine Datei gewählt.");
  if (file.size > 20 * 1024 * 1024) return fail("Datei größer als 20 MB.");
  const sb = await supabaseServer();
  const { data: c } = await sb.from("candidates").select("k_nr").eq("id", candidateId).single();
  if (!c) return fail("Kandidat nicht gefunden.");
  const safe = file.name.replace(/[^\w.\-äöüÄÖÜß ]+/g, "_");
  const path = `${c.k_nr}/${safe}`;
  const { error } = await sb.storage.from("cvs").upload(path, file, { upsert: true, contentType: file.type || undefined });
  if (error) return fail(error.message);
  await sb.from("candidates").update({ cv_file: path }).eq("id", candidateId);
  await sb.from("activities").insert({ entity_type: "candidate", entity_id: candidateId, type: "Notiz", summary: `Datei hochgeladen: ${safe}` });
  refresh(`/kandidaten/${candidateId}`);
  return { ok: true };
}

export async function setMainCv(candidateId: string, path: string) {
  const sb = await supabaseServer();
  await sb.from("candidates").update({ cv_file: path }).eq("id", candidateId);
  refresh(`/kandidaten/${candidateId}`);
  return { ok: true };
}

// ---------------------------------------------------------------- Firmen

const COMPANY_COLUMNS = ["name", "legal_name", "group_name", "city", "plz", "industry", "size", "website",
  "careers_url", "priority", "pays_agencies", "fee_agreed", "agb_sent_date", "next_action", "next_action_date",
  "source", "notes"];

export async function saveCompany(id: string | null, data: Payload): Promise<RpcResult> {
  const row = clean(Object.fromEntries(Object.entries(data).filter(([k]) => COMPANY_COLUMNS.includes(k))));
  const sb = await supabaseServer();
  if (id) {
    const { error } = await sb.from("companies").update(row).eq("id", id);
    if (error) return dbError(error)!;
    refresh("/firmen", `/firmen/${id}`);
    return { ok: true, id };
  }
  if (!row.name) return fail("Name fehlt.");
  const { data: existing } = await sb.from("companies").select("id, name").ilike("name", String(row.name)).maybeSingle();
  if (existing) return { ok: false, reason: "duplicate", id: existing.id, message: `Firma „${existing.name}“ gibt es schon.` };
  const { data: created, error } = await sb.from("companies").insert(row).select("id").single();
  if (error) return dbError(error)!;
  refresh("/firmen");
  return { ok: true, id: created.id };
}

export async function moveCompany(id: string, stage: string, payload: Payload = {}): Promise<RpcResult> {
  const sb = await supabaseServer();
  const { data: r, error } = await sb.rpc("move_company", { p_id: id, p_stage: stage, p_payload: clean(payload) });
  if (error) return dbError(error)!;
  refresh("/firmen", `/firmen/${id}`);
  return r as RpcResult;
}

export async function saveContact(companyId: string, id: string | null, data: Payload): Promise<RpcResult> {
  const row = clean({ name: data.name, role: data.role, email: data.email, phone: data.phone, linkedin: data.linkedin, notes: data.notes });
  if (!row.name) return fail("Name fehlt.");
  const sb = await supabaseServer();
  const { error } = id
    ? await sb.from("contacts").update(row).eq("id", id)
    : await sb.from("contacts").insert({ ...row, company_id: companyId });
  if (error) return dbError(error)!;
  refresh(`/firmen/${companyId}`);
  return { ok: true };
}

export async function saveJob(companyId: string, id: string | null, data: Payload): Promise<RpcResult> {
  const row = clean({
    title: data.title, city: data.city, url: data.url, source_type: data.source_type, salary_range: data.salary_range,
    posted_date: data.posted_date, last_checked_date: data.last_checked_date, status: data.status ?? "online",
    ref_no: data.ref_no, notes: data.notes,
  });
  if (!row.title) return fail("Titel fehlt.");
  const sb = await supabaseServer();
  const { error } = id
    ? await sb.from("jobs").update(row).eq("id", id)
    : await sb.from("jobs").insert({ ...row, company_id: companyId });
  if (error) return dbError(error)!;
  refresh(`/firmen/${companyId}`, "/matching");
  return { ok: true };
}

/** Stellencheck: Anzeige heute geprüft (online/offline/besetzt). */
export async function checkJob(jobId: string, companyId: string, status: string) {
  const sb = await supabaseServer();
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  const { error } = await sb.from("jobs").update({ last_checked_date: today, status }).eq("id", jobId);
  if (error) return dbError(error)!;
  refresh(`/firmen/${companyId}`, "/matching");
  return { ok: true };
}

// ---------------------------------------------------------------- Vorstellungen

export async function checkPresentation(candidateId: string, companyId: string, jobId: string | null, anonymous: boolean) {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("check_presentation", {
    p_candidate_id: candidateId, p_company_id: companyId, p_job_id: jobId, p_anonymous: anonymous,
  });
  if (error) return { ok: false, message: error.message, blocking: [], confirm: [], hints: [] } as PresentationResult;
  return data as PresentationResult;
}

export async function createPresentation(input: {
  candidateId: string; companyId: string; jobId: string | null; channel: string; anonymous: boolean;
  sentDate: string | null; notes: string | null; confirm: boolean;
}): Promise<PresentationResult> {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("create_presentation", {
    p_candidate_id: input.candidateId, p_company_id: input.companyId, p_job_id: input.jobId, p_channel: input.channel,
    p_anonymous: input.anonymous, p_sent_date: input.sentDate || null, p_notes: input.notes || null, p_confirm: input.confirm,
  });
  if (error) return { ok: false, message: error.message, blocking: [], confirm: [], hints: [] };
  refresh("/kandidaten", `/kandidaten/${input.candidateId}`, `/firmen/${input.companyId}`, "/matching");
  return data as PresentationResult;
}

export async function updatePresentation(id: string, data: Payload): Promise<RpcResult> {
  const row = clean({ status: data.status, result_date: data.result_date, rejection_reason: data.rejection_reason, notes: data.notes });
  const sb = await supabaseServer();
  const { data: p, error } = await sb.from("presentations").update(row).eq("id", id)
    .select("candidate_id, company_id, status, companies(name)").single();
  if (error) return dbError(error)!;
  const company = (p.companies as unknown as { name: string } | null)?.name ?? "";
  await sb.from("activities").insert([
    { entity_type: "candidate", entity_id: p.candidate_id, type: "Status", summary: `Vorstellung ${company}: ${p.status}` },
    { entity_type: "company", entity_id: p.company_id, type: "Status", summary: `Vorstellung: ${p.status}` },
  ]);
  refresh(`/kandidaten/${p.candidate_id}`, `/firmen/${p.company_id}`);
  return { ok: true };
}

export async function savePlacement(presentationId: string, data: Payload): Promise<RpcResult> {
  const row = clean({
    start_date: data.start_date, annual_salary: data.annual_salary || null, fee_percent: data.fee_percent || null,
    fee_amount: data.fee_amount || null, invoice_date: data.invoice_date, paid_date: data.paid_date,
    guarantee_until: data.guarantee_until, split_partner: data.split_partner,
  });
  const sb = await supabaseServer();
  const { error } = await sb.from("placements").upsert({ presentation_id: presentationId, ...row }, { onConflict: "presentation_id" });
  if (error) return dbError(error)!;
  const { data: p } = await sb.from("presentations").update({ status: "zusage" }).eq("id", presentationId).select("candidate_id").single();
  if (p) refresh(`/kandidaten/${p.candidate_id}`);
  return { ok: true };
}

// ---------------------------------------------------------------- Aktivitäten / Heute

export async function addActivity(entityType: "candidate" | "company", entityId: string, data: Payload): Promise<RpcResult> {
  if (!String(data.summary ?? "").trim()) return fail("Text fehlt.");
  const sb = await supabaseServer();
  const { error } = await sb.from("activities").insert(clean({
    entity_type: entityType, entity_id: entityId, type: data.type ?? "Notiz", direction: data.direction,
    summary: data.summary, link: data.link, occurred_at: data.occurred_at || undefined,
  }));
  if (error) return dbError(error)!;
  refresh(entityType === "candidate" ? `/kandidaten/${entityId}` : `/firmen/${entityId}`);
  return { ok: true };
}

export async function completeAction(entityType: "candidate" | "company", id: string, summary: string,
  nextAction: string, nextActionDate: string | null, activityType = "Notiz"): Promise<RpcResult> {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("complete_action", {
    p_entity_type: entityType, p_id: id, p_summary: summary, p_next_action: nextAction || null,
    p_next_action_date: nextActionDate || null, p_activity_type: activityType,
  });
  if (error) return dbError(error)!;
  refresh("/kandidaten", "/firmen", entityType === "candidate" ? `/kandidaten/${id}` : `/firmen/${id}`);
  return data as RpcResult;
}

// ---------------------------------------------------------------- Sperren, BA-Pool

export async function addBlock(data: Payload): Promise<RpcResult> {
  const row = clean({ type: data.type, name: data.name, candidate_id: data.candidate_id, company_id: data.company_id,
    scope: data.scope ?? "alle", reason: data.reason });
  if (!row.name || !row.reason) return fail("Name und Grund angeben.");
  const sb = await supabaseServer();
  const { error } = await sb.from("blocklist").insert(row);
  if (error) return dbError(error)!;
  refresh("/einstellungen", row.candidate_id ? `/kandidaten/${row.candidate_id}` : "/einstellungen");
  return { ok: true };
}

export async function removeBlock(id: string): Promise<RpcResult> {
  const sb = await supabaseServer();
  const { error } = await sb.from("blocklist").delete().eq("id", id);
  if (error) return dbError(error)!;
  refresh("/einstellungen");
  return { ok: true };
}

export async function updateBaProfile(id: string, data: Payload): Promise<RpcResult> {
  const sb = await supabaseServer();
  const { error } = await sb.from("ba_profiles").update(clean({ contacted_date: data.contacted_date, reply: data.reply })).eq("id", id);
  if (error) return dbError(error)!;
  refresh("/ba-pool");
  return { ok: true };
}

export async function convertBaProfile(id: string, data: Payload): Promise<RpcResult> {
  const sb = await supabaseServer();
  const { data: r, error } = await sb.rpc("convert_ba_profile", { p_ba_id: id, p: clean(data) });
  if (error) return dbError(error)!;
  refresh("/ba-pool", "/kandidaten");
  return r as RpcResult;
}
