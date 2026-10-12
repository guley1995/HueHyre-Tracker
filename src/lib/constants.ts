// Spalten, Beschriftungen und Pflichtfelder der Boards (Bauplan, "Kanban-Boards").

export const CANDIDATE_STAGES = [
  { key: "neu", label: "1 Neu", hint: "Bewerbung oder Antwort eingegangen" },
  { key: "qualifizieren", label: "2 Qualifizieren", hint: "Telefonat geplant/geführt" },
  { key: "vermarktbar", label: "3 Vermarktbar", hint: "Profil fertig, Einwilligung liegt vor" },
  { key: "vorgestellt", label: "4 Vorgestellt", hint: "Mindestens eine aktive Vorstellung" },
  { key: "interview", label: "5 Interview", hint: "Termin bei einer Firma" },
  { key: "angebot", label: "6 Angebot", hint: "Vertragsangebot liegt vor" },
  { key: "platziert", label: "7 Platziert", hint: "Vertrag unterschrieben" },
  { key: "pausiert", label: "Pausiert", hint: "Sucht gerade nicht" },
  { key: "raus", label: "Raus", hint: "Absage, nicht vermittelbar, gesperrt" },
] as const;

/** "Pool" steht nicht auf dem Board, nur in der Tabelle. */
export const CANDIDATE_STAGE_LABELS: Record<string, string> = {
  ...Object.fromEntries(CANDIDATE_STAGES.map((s) => [s.key, s.label])),
  pool: "Pool",
};

export const COMPANY_STAGES = [
  { key: "lead", label: "1 Lead", hint: "Firma mit passender Stelle gefunden" },
  { key: "angeschrieben", label: "2 Angeschrieben", hint: "Erste Mail/Anruf raus" },
  { key: "im_gespraech", label: "3 Im Gespräch", hint: "Antwort, Interesse, Fragen" },
  { key: "konditionen", label: "4 Konditionen", hint: "AGB/Angebot verschickt" },
  { key: "kunde_aktiv", label: "5 Kunde aktiv", hint: "Arbeitet mit dir" },
  { key: "ruhend", label: "Ruhend", hint: "Kein Bedarf gerade" },
  { key: "tabu", label: "Tabu", hint: "Nie anschreiben" },
] as const;

export const COMPANY_STAGE_LABELS: Record<string, string> = Object.fromEntries(
  COMPANY_STAGES.map((s) => [s.key, s.label]),
);

/** Spalten ohne Pflicht zur Wiedervorlage. */
export const CLOSED_CANDIDATE_STAGES = ["platziert", "raus", "pool"];
export const CLOSED_COMPANY_STAGES = ["tabu"];

export const CATEGORIES = ["Technik", "Kaufm.", "Vertrieb", "Logistik", "IT"] as const;
export const CANDIDATE_SOURCES = ["Indeed", "BA", "Gmail", "Empfehlung", "Maron", "Telefon", "Sonstige"] as const;
export const COMPANY_SOURCES = ["Leadliste", "Endkunden-Recherche", "Empfehlung", "Sonstige"] as const;
export const PRIORITIES = ["A", "B", "C"] as const;
export const ACTIVITY_TYPES = ["Mail", "Anruf", "SMS", "WhatsApp", "Indeed", "BA", "Notiz", "Status"] as const;
export const CHANNELS = ["Mail", "Telefon", "Portal"] as const;
export const PRESENTATION_STATUSES = [
  "vorgestellt", "interesse", "interview", "angebot", "zusage", "absage", "zurueckgezogen",
] as const;
export const JOB_SOURCE_TYPES = ["eigene Anzeige", "Vermittler-Anzeige", "Mandat", "initiativ", "Vorschlag"] as const;
export const JOB_STATUSES = ["online", "offline", "besetzt"] as const;

/**
 * Formularfelder für fehlende Pflichtangaben beim Spaltenwechsel.
 * Schlüssel = Wert aus move_candidate/move_company → missing[].
 */
export type MissingField = {
  label: string;
  input: "text" | "date" | "textarea" | "select" | "self_applications" | "presentation" | "info";
  payloadKey?: string;
  options?: readonly string[];
};

export const MISSING_FIELDS: Record<string, MissingField> = {
  source: { label: "Quelle", input: "select", payloadKey: "source" },
  contact: { label: "Kontaktweg (E-Mail oder Telefon)", input: "text", payloadKey: "contact" },
  note_or_appointment: { label: "Gesprächsnotiz (oder Termin als nächste Aktion)", input: "textarea", payloadKey: "note" },
  consent_date: { label: "Einwilligung am", input: "date", payloadKey: "consent_date" },
  salary_wish: { label: "Gehaltswunsch", input: "text", payloadKey: "salary_wish" },
  available_from: { label: "Verfügbar ab", input: "text", payloadKey: "available_from" },
  exclusions: { label: "Ausschlüsse (z. B. „keine Kanzlei“, sonst „keine“)", input: "text", payloadKey: "exclusions" },
  self_applications: { label: "Wo hast du dich selbst beworben?", input: "self_applications" },
  presentation: { label: "Erst über „Vorstellen bei …“ eine Vorstellung anlegen.", input: "info" },
  presentation_id: { label: "Bei welcher Firma?", input: "presentation", payloadKey: "presentation_id" },
  interview_date: { label: "Interview-Datum", input: "date", payloadKey: "interview_date" },
  offer_salary: { label: "Angebotenes Gehalt", input: "text", payloadKey: "offer_salary" },
  placement: { label: "Erst in der Detailansicht die Platzierung (Start, Gehalt, Honorar) erfassen.", input: "info" },
  next_action_date: { label: "Wiedervorlage am (in der Zukunft)", input: "date", payloadKey: "next_action_date" },
  reason: { label: "Grund", input: "textarea", payloadKey: "reason" },
  job_or_reason: { label: "Grund (oder erst eine Stelle anlegen)", input: "textarea", payloadKey: "reason" },
  contacted_at: { label: "Angeschrieben am", input: "date", payloadKey: "contacted_at" },
  note: { label: "Notiz", input: "textarea", payloadKey: "note" },
  agb_sent_date: { label: "AGB verschickt am", input: "date", payloadKey: "agb_sent_date" },
  fee_agreed: { label: "Honorarsatz (z. B. 25 % / 20 % Erstbesetzung)", input: "text", payloadKey: "fee_agreed" },
};

export const EXPORT_TABLES = [
  "candidates", "companies", "contacts", "jobs", "presentations", "self_applications",
  "activities", "placements", "blocklist", "ba_profiles",
] as const;
export type ExportTable = (typeof EXPORT_TABLES)[number];
