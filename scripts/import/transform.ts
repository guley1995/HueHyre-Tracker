// Datenübernahme (Bauplan, Abschnitt "Datenübernahme"): Excel-Zeilen → Importplan.
// Reine Funktionen ohne Datenbank, damit sie testbar sind.
import { findColumn, findSheet, norm, type Cell, type Sheet, type SheetRow } from "./xlsx";

export type Issue = { level: "fehler" | "warnung" | "info"; source: string; message: string };

export type CandidateIn = {
  key: string;
  k_nr: string | null;
  legacy_k_nrs: string[];
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
  exclusions: string | null;
  source: string | null;
  stage: string;
  priority: string | null;
  next_action: string | null;
  next_action_date: string | null;
  consent_date: string | null;
  notes: string | null;
  name_gap: boolean;
  blocked_reason: string | null;
  /** Sperre nur bei diesen Firmen („für: Ritter“); leer = Sperre für alle. */
  blocked_companies: string[];
  self_applications: string[];
  origin: string[];
};

export type CompanyIn = {
  name: string; city?: string | null; plz?: string | null; industry?: string | null; website?: string | null;
  stage?: string; source?: string | null; notes?: string | null; group_name?: string | null; next_action?: string | null;
  next_action_date?: string | null;
};
export type ContactIn = { company: string; name: string; role?: string | null; email?: string | null; phone?: string | null };
export type JobIn = {
  company: string; title: string; city?: string | null; url?: string | null; source_type?: string | null;
  salary_range?: string | null; posted_date?: string | null; last_checked_date?: string | null; status?: string;
  ref_no?: string | null; notes?: string | null;
};
export type PresentationIn = { candidateKey: string; company: string; jobTitle?: string | null; sent_date: string; notes?: string | null; origin: string };
export type BlockIn = { type: "Person" | "Firma" | "Regel"; name: string; candidateKey?: string | null; company?: string | null; reason: string };
export type BaIn = { ref_no: string; search: string | null; qualification: string | null; age: number | null; city: string | null; contacted_date: string | null; reply: string | null };

export type ImportPlan = {
  candidates: CandidateIn[];
  companies: CompanyIn[];
  contacts: ContactIn[];
  jobs: JobIn[];
  presentations: PresentationIn[];
  blocklist: BlockIn[];
  baProfiles: BaIn[];
  issues: Issue[];
  merged: { kept: string; merged: string; reason: string }[];
};

export type ImportOptions = { year?: number; today?: string };

// ---------------------------------------------------------------- Hilfen

const str = (v: Cell | undefined): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  return s === "" || s === "-" || s === "–" ? null : s;
};

/** Datum aus Excel-Date, "12.09.2026", "12.09.26", "12.09." oder "2026-09-12". */
export function parseDate(v: Cell | undefined, opts: ImportOptions = {}): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number" && v > 20000 && v < 80000) {
    // Excel-Seriennummer
    return new Date(Date.UTC(1899, 11, 30) + v * 864e5).toISOString().slice(0, 10);
  }
  const s = String(v);
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})?/);
  if (!m) return null;
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const d = Number(m[1]), mo = Number(m[2]);
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  let y = m[3] ? Number(m[3]) : Number(today.slice(0, 4));
  if (y < 100) y += 2000;
  let iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  // Ohne Jahr und in der Zukunft → Vorjahr.
  if (!m[3] && iso > today) iso = `${y - 1}${iso.slice(4)}`;
  return iso;
}

/** "K-32", "K32", "K-032", "K-2026-032" → "K-2026-032". */
export function normalizeKnr(v: Cell | undefined, year = 2026): string | null {
  const s = str(v);
  if (!s) return null;
  let m = s.match(/K\s*-?\s*(\d{4})\s*-\s*(\d{1,4})/i);
  if (m) return `K-${m[1]}-${m[2].padStart(3, "0")}`;
  m = s.match(/^\s*K\s*-?\s*(\d{1,4})\s*$/i) ?? s.match(/\bK\s*-?\s*(\d{1,4})\b/i);
  if (m) return `K-${year}-${m[1].padStart(3, "0")}`;
  return null;
}

const knrNumber = (k: string) => Number(k.split("-")[2]) + Number(k.split("-")[1]) * 10000;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

/** Nur echte Adressen; Platzhalter wie „(CV) — (nur über Indeed-Chat erreichbar)“ → null (sonst wären alle eine Dublette). */
export function cleanEmail(v: string | null): string | null {
  return v?.match(EMAIL_RE)?.[0].toLowerCase() ?? null;
}

/** Zeile in einer Personenliste, die eigentlich eine Firma ist (z. B. „OPTIMA packaging group“). */
const COMPANY_RE = /\b(gmbh|ag|kg|se|e v|group|gruppe|holding|packaging|werke?|stadtwerke)\b/;
export const looksLikeCompany = (name: string) => COMPANY_RE.test(norm(name));

/**
 * Namensspalte mit Zusätzen: „Tahsin E. (Nachname nachtragen)“, „Gräf (evtl. K-2026-12) – Maron-Pool“,
 * „K-2026-03 (Klarname fehlt)“, „Kein Name (Aichach)“, „Samet Koc (Mechatroniker Üstra) – Maron-Pool“.
 * Zusätze kommen in die Notiz, „evtl. K-…“ wird nicht zugeordnet, ein einzelnes Wort ist ein Nachname.
 */
export function cleanPersonName(raw: string | null): { first: string | null; last: string | null; gap: boolean; note: string | null } {
  if (!raw) return { first: null, last: null, gap: false, note: null };
  const extras: string[] = [];
  let base = raw.replace(/\(([^)]*)\)/g, (_, inner: string) => { extras.push(inner.trim()); return " "; });
  const dash = base.split(/\s+[–—-]\s+/);
  base = dash[0];
  extras.push(...dash.slice(1).map((s) => s.trim()).filter(Boolean));
  base = base.replace(/\s+/g, " ").trim();
  const hint = /klarname|nachname|name unbekannt|ungeklaert|nachtragen|kein name/;
  let gap = extras.some((e) => hint.test(norm(e))) || hint.test(norm(base));
  if (/^K\s*-?\s*\d/i.test(base) || /^kein name$/i.test(base)) base = "";
  const note = extras.length || base !== raw.trim() ? `Name laut Liste: ${raw.trim()}` : null;
  if (!base) return { first: null, last: null, gap: true, note };
  if (!base.includes(" ") && !base.includes(",")) return { first: null, last: base, gap: true, note };
  const { first, last } = splitName(base);
  gap = gap || nameGap(first, last);
  return { first, last, gap, note };
}

/** Vergleichsschlüssel für Firmen: ohne Rechtsform, „Group“, Klammerzusatz (Ort). */
export function companyKey(name: string): string {
  return norm(name.replace(/\([^)]*\)/g, " "))
    .replace(/\b(gmbh|mbh|co|kg|ag|se|ug|e v|group|gruppe|holding)\b/g, " ")
    .replace(/\s+/g, " ").trim() || norm(name);
}

/** Text an Trennzeichen teilen, aber nicht innerhalb von Klammern: „Humbaur (10.10., Kreditor), Kögel“. */
export function splitTopLevel(text: string, seps = ",;"): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (depth === 0 && seps.includes(ch)) { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

export type PresentedItem = { company: string; date: string | null; detail: string | null; uncertain: boolean };

/**
 * „Craiss, Sirl, Sortimo, Koffer-Kopf (07.10.); Humbaur (10.10., Kreditor), GROB?“ →
 * je Firma Datum und Klammertext. Ein Datum am Ende einer Komma-Gruppe gilt für die Firmen davor ohne eigene Klammer.
 * „GROB?“ ist unsicher und bekommt kein Datum.
 */
export function parsePresentedList(text: string | null, opts: ImportOptions = {}): PresentedItem[] {
  if (!text) return [];
  const out: PresentedItem[] = [];
  for (const group of splitTopLevel(text, ";")) {
    const items = splitTopLevel(group, ",").map((raw) => {
      const m = raw.match(/^(.*?)\s*\((.*)\)\s*$/);
      const name = (m ? m[1] : raw).trim();
      const detail = m ? m[2].trim() : null;
      const uncertain = name.includes("?");
      return { company: name.replace(/\?/g, "").trim(), detail, uncertain, date: detail ? parseDate(detail, opts) : null };
    }).filter((x) => x.company.length >= 2);
    for (let i = items.length - 2; i >= 0; i--) {
      const it = items[i], next = items[i + 1];
      if (!it.detail && !it.uncertain && !next.uncertain && next.date) it.date = next.date;
    }
    out.push(...items);
  }
  return out;
}

/** Firmennamen aus „DAHER Standortleiter (Absage 09.10.), Aracom u. a. (frühe Phase)“. */
function parseNameList(text: string | null): string[] {
  if (!text) return [];
  return splitTopLevel(text).map((s) => s.replace(/\(.*\)\s*$/, "").replace(/\bu\.\s*a\.?$/i, "").replace(/\?/g, "").trim()).filter((s) => s.length >= 2);
}

/**
 * Spalte „Firmen (vorgestellt / gematcht / Ziel)“: Abschnitte mit „ | “ getrennt.
 * Nur „Vorgestellt:“ wird Vorstellung und „Selbst beworben:“ Selbstbewerbung; Matching/Indeed-Ziel/Zielkunden u. Ä. bleiben als Notiz.
 */
export function parseFirmenText(text: string | null, opts: ImportOptions = {}): { presented: PresentedItem[]; selfApplied: string[]; rest: string[] } {
  const res = { presented: [] as PresentedItem[], selfApplied: [] as string[], rest: [] as string[] };
  for (const seg of (text ?? "").split(/\s+\|\s+/).map((s) => s.trim()).filter(Boolean)) {
    const m = seg.match(/^(vorgestellt|selbst beworben)(?: bei)?\s*:\s*(.*)$/i);
    if (m && /^vorgestellt/i.test(m[1])) res.presented.push(...parsePresentedList(m[2], opts));
    else if (m) res.selfApplied.push(...parseNameList(m[2]));
    else res.rest.push(seg);
  }
  return res;
}

/**
 * Geltungsbereich einer Personensperre aus „SPERRE: aktuell Ritter (für: Ritter)“ oder „nicht zu Kögel/Humbaur“.
 * all = true, wenn „für: alle“ vorkommt oder sich keine Firma erkennen lässt.
 */
export function parseBlockScope(text: string | null): { all: boolean; companies: string[] } {
  const t = text ?? "";
  const targets: string[] = [];
  for (const m of t.matchAll(/\(für:\s*((?:[^()]|\([^()]*\))*)\)/gi)) targets.push(m[1]);
  if (!targets.length) for (const m of t.matchAll(/\b(?:nicht|nie)\s+(?:zu|bei)\s+([^|–;,]+?)(?:\s+vorschlagen)?\s*(?=$|[|–;,])/gi)) targets.push(m[1]);
  if (!targets.length || targets.some((x) => /\balle\b/i.test(x))) return { all: true, companies: [] };
  const companies = targets.flatMap((x) => x.split(/[\/,]/)).map((c) => c.replace(/\(.*\)/, "").trim()).filter((c) => c.length >= 2);
  return { all: companies.length === 0, companies: [...new Set(companies)] };
}

export function normPhone(p: string | null): string | null {
  if (!p) return null;
  const d = p.replace(/[^0-9+]/g, "").replace(/^(\+|00)49/, "0").replace(/[^0-9]/g, "");
  return d.length >= 5 ? d : null;
}

function splitName(full: string | null): { first: string | null; last: string | null } {
  if (!full) return { first: null, last: null };
  const s = full.replace(/\s+/g, " ").trim();
  if (s.includes(",")) {
    const [last, first] = s.split(",").map((x) => x.trim());
    return { first: first || null, last: last || null };
  }
  const parts = s.split(" ");
  // Nur ein Wort: unklar, ob Vor- oder Nachname → als Vorname, Nachname fehlt (Klarnamen-Lücke).
  if (parts.length === 1) return { first: parts[0], last: null };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

const personKey = (first: string | null, last: string | null) => norm(`${first ?? ""} ${last ?? ""}`);

function mapCategory(v: string | null): string | null {
  if (!v) return null;
  const n = norm(v);
  if (/techn|elektr|mechan|ingen|handwerk|produktion/.test(n)) return "Technik";
  if (/kaufm|buchhalt|verwalt|assist|office|personal|finanz|einkauf/.test(n)) return "Kaufm.";
  if (/vertrieb|sales|verkauf|aussendienst|key account/.test(n)) return "Vertrieb";
  if (/logist|lager|spedition|disposit|fahrer|versand/.test(n)) return "Logistik";
  if (/^it\b|informatik|software|entwickl|admin|edv/.test(n)) return "IT";
  return null;
}

function mapSource(v: string | null): string | null {
  if (!v) return null;
  const n = norm(v);
  if (n.includes("indeed")) return "Indeed";
  if (n === "ba" || n.includes("arbeitsagentur") || n.includes("bewerberboerse") || /\bba\b/.test(n)) return "BA";
  if (n.includes("maron")) return "Maron";
  if (n.includes("empfehl")) return "Empfehlung";
  if (n.includes("telefon") || n.includes("anruf")) return "Telefon";
  if (n.includes("gmail") || n.includes("mail")) return "Gmail";
  return "Sonstige";
}

function mapPriority(v: string | null): string | null {
  if (!v) return null;
  const s = v.trim().toUpperCase();
  if (["A", "B", "C"].includes(s[0])) return s[0];
  if (s.startsWith("1") || s.includes("HOCH")) return "A";
  if (s.startsWith("2") || s.includes("MITTEL")) return "B";
  if (s.startsWith("3") || s.includes("NIEDRIG")) return "C";
  return null;
}

/**
 * Kategorie-Spalte der Gesamtliste → Board-Spalte.
 * Aktiv → je nach Status 3–5, Pausiert → Pausiert, Vermarktet/Kontakt → 2, Angeschrieben → 1,
 * Absage/Raus → Raus, Nur gescreent/Maron → Pool, Gesperrt → Raus + Sperrliste.
 */
export function mapStage(kategorie: string | null, status: string | null): { stage: string; blocked: boolean; maron: boolean; known: boolean } {
  const k = norm(kategorie ?? "");
  const s = norm(status ?? "");
  // „Neu“, „Neu – Umzug klären“, „Aktiv – neu“ (heute beworben, noch ohne Einwilligung) → 1 Neu.
  if (k.startsWith("neu") || (k.startsWith("aktiv") && /\bneu\b/.test(k))) return { stage: "neu", blocked: false, maron: false, known: true };
  if (k.startsWith("pool")) return { stage: "pool", blocked: false, maron: false, known: true };
  if (k.startsWith("aktiv")) {
    if (/interview|vorstellungsgespraech|termin/.test(s)) return { stage: "interview", blocked: false, maron: false, known: true };
    if (/angebot|vertrag/.test(s)) return { stage: "angebot", blocked: false, maron: false, known: true };
    if (/vorgestellt|versendet|profil (raus|gesendet)|pitch/.test(s)) return { stage: "vorgestellt", blocked: false, maron: false, known: true };
    return { stage: "vermarktbar", blocked: false, maron: false, known: true };
  }
  if (k.startsWith("pausiert") || k.startsWith("pause")) return { stage: "pausiert", blocked: false, maron: false, known: true };
  if (k.startsWith("vermarktet") || k.startsWith("kontakt")) return { stage: "qualifizieren", blocked: false, maron: false, known: true };
  if (k.startsWith("angeschrieben")) return { stage: "neu", blocked: false, maron: false, known: true };
  if (k.startsWith("absage") || k.startsWith("raus")) return { stage: "raus", blocked: false, maron: false, known: true };
  if (k.startsWith("platziert")) return { stage: "platziert", blocked: false, maron: false, known: true };
  if (k.includes("maron")) return { stage: "pool", blocked: false, maron: true, known: true };
  if (k.includes("gescreent")) return { stage: "pool", blocked: false, maron: false, known: true };
  if (k.startsWith("gesperrt") || k.startsWith("sperre")) return { stage: "raus", blocked: true, maron: false, known: true };
  return { stage: "neu", blocked: false, maron: false, known: false };
}

function mapCompanyStage(status: string | null): string {
  const n = norm(status ?? "");
  if (!n) return "lead";
  if (/tabu|nda|nie |abgelehnt|kein interesse/.test(n)) return "tabu";
  if (/kunde|aktiv|auftrag/.test(n)) return "kunde_aktiv";
  if (/agb|kondition|angebot/.test(n)) return "konditionen";
  if (/gespraech|interesse|antwort|rueckmeldung|termin/.test(n)) return "im_gespraech";
  if (/ruhend|einstellungsstopp|kein bedarf|spaeter/.test(n)) return "ruhend";
  if (/angeschrieben|mail|kontaktiert|angerufen|raus|gesendet|versendet/.test(n)) return "angeschrieben";
  return "lead";
}

type Cols<K extends string> = Record<K, string | undefined>;

function columns<K extends string>(sheet: Sheet, spec: Record<K, string[]>): Cols<K> {
  return Object.fromEntries(Object.entries(spec).map(([k, aliases]) => [k, findColumn(sheet.headers, aliases as string[])])) as Cols<K>;
}

const get = (row: SheetRow, col: string | undefined): Cell => (col ? row[col] ?? null : null);

// ---------------------------------------------------------------- Kandidaten

const CANDIDATE_COLS = {
  k_nr: ["K-Nr", "K-Nr.", "K-Nummer", "KNr", "Kandidaten-Nr", "Kandidatennummer"],
  name: ["Name", "Kandidat", "Bewerber", "Vollständiger Name"],
  first_name: ["Vorname"],
  last_name: ["Nachname", "Familienname"],
  email: ["E-Mail", "Email", "Mail", "E-Mail-Adresse"],
  phone: ["Telefon", "Tel", "Tel.", "Handy", "Mobil", "Telefonnummer", "Mobilnummer"],
  plz: ["PLZ", "Postleitzahl"],
  city: ["Ort", "Wohnort", "Stadt"],
  profile_title: ["Beruf", "Profil", "Position", "Jobtitel", "Titel", "Qualifikation"],
  skills: ["Skills", "Kenntnisse", "Erfahrung", "Schwerpunkte"],
  bereich: ["Bereich", "Fachbereich", "Fachrichtung", "Berufsfeld", "Branche"],
  kategorie: ["Kategorie", "Status-Kategorie", "Statuskategorie", "Gruppe"],
  status: ["Status", "Stand", "Pipeline", "Aktueller Stand"],
  salary: ["Gehaltswunsch", "Wunschgehalt", "Gehalt"],
  available: ["Verfügbar ab", "Verfügbarkeit", "Verfügbar", "Eintritt"],
  notice: ["Kündigungsfrist"],
  exclusions: ["Ausschlüsse", "Ausschluss", "Ausschlusskriterien"],
  source: ["Quelle", "Herkunft", "Kanal"],
  priority: ["Prio", "Priorität"],
  next_action: ["Nächste Aktion", "Nächster Schritt", "Next Step", "To-do", "ToDo"],
  next_action_date: ["Datum nächste Aktion", "Wiedervorlage", "WV", "Fällig", "Fällig am"],
  consent: ["Einwilligung am", "Einwilligung", "DSGVO", "Zustimmung"],
  firmen: ["Firmen (vorgestellt", "Firmen vorgestellt", "Vorgestellt bei", "Vorgestellt", "Firmen"],
  self_applied: ["Selbst beworben", "Selbstbewerbung", "Selbst beworben bei", "Eigenbewerbungen"],
  notes: ["Notizen", "Notiz", "Bemerkung", "Bemerkungen", "Kommentar", "Anmerkungen", "Besonderheiten"],
  indeed_contacted: ["Indeed angeschrieben am", "Indeed angeschrieben"],
};

/** Master-Blatt „Kandidaten“ (gepflegte Profile der aktiven Kandidaten). */
const MASTER_CANDIDATE_COLS = {
  k_nr: CANDIDATE_COLS.k_nr, name: CANDIDATE_COLS.name, email: CANDIDATE_COLS.email, phone: CANDIDATE_COLS.phone,
  city: CANDIDATE_COLS.city, profile_title: CANDIDATE_COLS.profile_title, priority: CANDIDATE_COLS.priority,
  skills: ["Kernkompetenzen", ...CANDIDATE_COLS.skills], salary: ["Gehalt (Wunsch)", ...CANDIDATE_COLS.salary],
  available: CANDIDATE_COLS.available, radius: ["Radius / Umzug / HO", "Radius", "Umzug"],
  exclusions: ["Wünsche / Ausschlüsse", ...CANDIDATE_COLS.exclusions], presented: ["Bereits vorgestellt bei", "Vorgestellt bei"],
  self_applied: ["Selbst beworben bei", "Selbst beworben"], status: CANDIDATE_COLS.status, next_action: CANDIDATE_COLS.next_action,
};

/** Platzhalter im Blatt „K-Nummern“ – keine Person. */
const KNR_PLACEHOLDER = /^(unbekannt|kein treffer|klarname|ungeklaert|offen\b|\?)/;

function nameGap(first: string | null, last: string | null): boolean {
  if (!last) return true;
  if (/^[A-Za-zÄÖÜäöü]\.?$/.test(last.trim())) return true;
  return false;
}

/** "Humbaur 12.09.; Kögel (15.09.2026), Liebherr" → [{company, date|null}] */
export function parseCompanyList(text: string | null, opts: ImportOptions = {}): { company: string; date: string | null }[] {
  if (!text) return [];
  return text
    .split(/[;\n]|,(?!\d)|\s\/\s|\s\+\s/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const date = parseDate(part, opts);
      const company = part
        .replace(/\(?\s*(am\s+)?\d{1,2}\.\d{1,2}\.(\d{2,4})?\s*\)?/g, "")
        .replace(/\b(vorgestellt|am|seit)\b/gi, "")
        .replace(/[()–-]+\s*$/g, "")
        .replace(/\s+/g, " ")
        .trim();
      return { company, date };
    })
    .filter((x) => x.company.length >= 2);
}

// ---------------------------------------------------------------- Hauptfunktion

export function buildPlan(input: { gesamtliste?: Sheet[]; master?: Sheet[]; leads?: { file: string; sheets: Sheet[] }[] }, opts: ImportOptions = {}): ImportPlan {
  const year = opts.year ?? 2026;
  const plan: ImportPlan = { candidates: [], companies: [], contacts: [], jobs: [], presentations: [], blocklist: [], baProfiles: [], issues: [], merged: [] };
  const issue = (level: Issue["level"], source: string, message: string) => plan.issues.push({ level, source, message });
  const companies = new Map<string, CompanyIn>();
  const addCompany = (c: CompanyIn) => {
    const k = companyKey(c.name);
    if (!k) return;
    const existing = companies.get(k);
    if (!existing) return void companies.set(k, { ...c });
    // Angezeigter Name: „Kirstein“ statt „Kirstein (Kunde)“.
    if (/\(/.test(existing.name) && !/\(/.test(c.name)) existing.name = c.name;
    for (const [f, v] of Object.entries(c)) {
      const key = f as keyof CompanyIn;
      if (v != null && (existing[key] == null || existing[key] === "")) (existing as Record<string, unknown>)[key] = v;
    }
    // Weiter fortgeschrittene Spalte gewinnt (Tabu immer).
    const order = ["lead", "angeschrieben", "im_gespraech", "konditionen", "kunde_aktiv", "ruhend", "tabu"];
    if (c.stage && (c.stage === "tabu" || order.indexOf(c.stage) > order.indexOf(existing.stage ?? "lead"))) existing.stage = c.stage;
  };
  const jobs = new Map<string, JobIn>();
  const addJob = (j: JobIn) => {
    const k = `${companyKey(j.company)}|${norm(j.title)}`;
    if (!jobs.has(k)) jobs.set(k, j);
    else {
      const e = jobs.get(k)!;
      for (const [f, v] of Object.entries(j)) if (v != null && (e as Record<string, unknown>)[f] == null) (e as Record<string, unknown>)[f] = v;
      if (j.last_checked_date && (!e.last_checked_date || j.last_checked_date > e.last_checked_date)) e.last_checked_date = j.last_checked_date;
    }
  };

  // --- K-Nummern-Blatt: Name → alle Nummern
  const knrByName = new Map<string, Set<string>>();
  const nameByKnr = new Map<string, string>();
  // Nur ein Nachname („Tkocz (Maron)“): wird nach dem Einlesen eindeutig einem Bewerber zugeordnet.
  const knrBySurname = new Map<string, { knr: string; label: string; maron: boolean }>();
  const knrSheet = input.gesamtliste && findSheet(input.gesamtliste, "K-Nummern", "K Nummern", "KNummern");
  if (knrSheet) {
    const c = columns(knrSheet, { k_nr: CANDIDATE_COLS.k_nr, name: CANDIDATE_COLS.name, first: ["Vorname"], last: ["Nachname"] });
    for (const r of knrSheet.rows) {
      const k = normalizeKnr(get(r, c.k_nr), year);
      const raw = str(get(r, c.name)) ?? [str(get(r, c.first)), str(get(r, c.last))].filter(Boolean).join(" ");
      if (!k || !raw) continue;
      if (KNR_PLACEHOLDER.test(norm(raw))) {
        issue("info", "K-Nummern", `${k}: „${raw}“ – keine Person zugeordnet, Nummer bleibt frei.`);
        continue;
      }
      if (/\bevtl\b|\boder\b|\?/i.test(raw)) {
        issue("warnung", "K-Nummern", `${k}: Zuordnung unsicher („${raw}“) – nicht übernommen, bitte von Hand prüfen.`);
        continue;
      }
      // „Stephan Steinle (= K-58)“ → Person + verknüpfte Doppelnummer.
      const linked = [...raw.matchAll(/\(=\s*([^)]*)\)/g)].map((m) => normalizeKnr(m[1], year)).filter(Boolean) as string[];
      const maron = /maron/i.test(raw);
      const full = raw.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
      if (!full) continue;
      if (!full.includes(" ")) {
        knrBySurname.set(norm(full), { knr: k, label: raw, maron });
        continue;
      }
      const nk = norm(full);
      for (const l of linked) {
        if (!knrByName.has(nk)) knrByName.set(nk, new Set());
        knrByName.get(nk)!.add(l);
      }
      if (!knrByName.has(nk)) knrByName.set(nk, new Set());
      knrByName.get(nk)!.add(k);
      nameByKnr.set(k, full);
    }
    for (const [n, set] of knrByName) {
      if (set.size > 1) issue("info", "K-Nummern", `${nameByKnr.get([...set][0])}: mehrere Nummern ${[...set].join(", ")} – niedrigste bleibt, Rest in legacy_k_nrs.`);
      void n;
    }
  } else if (input.gesamtliste) {
    issue("warnung", "Gesamtliste", "Blatt „K-Nummern“ nicht gefunden.");
  }

  // --- Alle Bewerber
  const sheet = input.gesamtliste && findSheet(input.gesamtliste, "Alle Bewerber", "Bewerber", "Gesamtliste");
  const rawCandidates: CandidateIn[] = [];
  const presentedByKey = new Map<string, { items: PresentedItem[]; origin: string }[]>();
  const companyRowBlocks: { name: string; city: string | null; reason: string }[] = [];
  if (sheet) {
    const c = columns(sheet, CANDIDATE_COLS);
    if (!c.name && !c.last_name) issue("fehler", "Alle Bewerber", "Keine Namensspalte erkannt.");
    for (const r of sheet.rows) {
      const src = `Alle Bewerber Z.${r.__row}`;
      let first = str(get(r, c.first_name));
      let last = str(get(r, c.last_name));
      const rawName = str(get(r, c.name));
      const cleaned = first || last ? { first, last, gap: nameGap(first, last), note: null } : cleanPersonName(rawName);
      ({ first, last } = cleaned);
      const emailRaw = str(get(r, c.email));
      const email = cleanEmail(emailRaw);
      const phone = str(get(r, c.phone));
      const own = normalizeKnr(get(r, c.k_nr), year);
      if (!first && !last && !email && !phone && !own && !str(get(r, c.profile_title))) {
        issue("warnung", src, "Leere Zeile ohne Name/Kontakt übersprungen.");
        continue;
      }
      const kat = str(get(r, c.kategorie));
      const st = mapStage(kat, str(get(r, c.status)));
      if (!st.known) issue("warnung", src, `Kategorie „${kat ?? ""}“ unbekannt – als „neu“ importiert.`);
      const fullName = rawName ?? [first, last].filter(Boolean).join(" ");
      const special = str(get(r, c.notes));

      // Gesperrte „Person“, die eine Firma ist → Tabu-Firma statt Kandidat.
      if (st.blocked && looksLikeCompany(fullName)) {
        companyRowBlocks.push({ name: fullName.replace(/\s*\([^)]*\)\s*$/, ""), city: fullName.match(/\(([^)]*)\)\s*$/)?.[1] ?? null, reason: special ?? str(get(r, c.status)) ?? "Gesperrt (Import)" });
        issue("info", src, `„${fullName}“ ist eine Firma – als Tabu-Firma übernommen, nicht als Kandidat.`);
        continue;
      }

      // K-Nummer: aus der Zeile, sonst aus dem K-Nummern-Blatt per Name.
      const knrs = new Set<string>();
      if (own) knrs.add(own);
      for (const k of knrByName.get(personKey(first, last)) ?? []) knrs.add(k);
      const sorted = [...knrs].sort((a, b) => knrNumber(a) - knrNumber(b));

      const consentRaw = get(r, c.consent);
      const consentDate = parseDate(consentRaw, opts);
      const notes: string[] = [];
      if (cleaned.note) notes.push(cleaned.note);
      if (special) notes.push(special);
      if (emailRaw && !email) notes.push(`Kontakt laut Liste: ${emailRaw}`);
      if (!consentDate && str(consentRaw)) notes.push(`Einwilligung laut Liste: ${str(consentRaw)} (ohne Datum)`);
      const status = str(get(r, c.status));
      if (status) notes.push(`Status (Import): ${status}`);
      const firmen = parseFirmenText(str(get(r, c.firmen)), opts);
      if (firmen.rest.length) notes.push(`Firmen/Matching laut Liste: ${firmen.rest.join(" | ")}`);
      const indeed = get(r, c.indeed_contacted);
      if (str(indeed)) notes.push(`Indeed angeschrieben am: ${parseDate(indeed, opts) ?? str(indeed)}`);
      const scope = st.blocked ? parseBlockScope([special, status].filter(Boolean).join(" | ")) : { all: true, companies: [] };
      const gap = cleaned.gap;
      if (gap) {
        notes.unshift("[Klarname fehlt – beim Import nicht geraten, bitte ergänzen]");
        issue("warnung", src, `Klarname unvollständig: „${[first, last].filter(Boolean).join(" ") || "?"}“${sorted[0] ? ` (${sorted[0]})` : ""} – markiert.`);
      }
      const selfApplied = str(get(r, c.self_applied));
      const cand: CandidateIn = {
        key: `row-${r.__row}`,
        k_nr: sorted[0] ?? null,
        legacy_k_nrs: sorted.slice(1),
        first_name: first, last_name: last, email, phone,
        plz: str(get(r, c.plz)), city: str(get(r, c.city)),
        profile_title: str(get(r, c.profile_title)), skills: str(get(r, c.skills)),
        category: mapCategory(str(get(r, c.bereich))) ?? mapCategory(str(get(r, c.profile_title))),
        salary_wish: str(get(r, c.salary)), available_from: str(get(r, c.available)),
        notice_period: str(get(r, c.notice)), exclusions: str(get(r, c.exclusions)),
        source: st.maron ? "Maron" : mapSource(str(get(r, c.source))),
        stage: st.stage,
        priority: mapPriority(str(get(r, c.priority))),
        next_action: str(get(r, c.next_action)),
        next_action_date: parseDate(get(r, c.next_action_date), opts),
        consent_date: consentDate,
        notes: notes.join("\n") || null,
        name_gap: gap,
        blocked_reason: st.blocked ? (special ?? status ?? kat ?? "Gesperrt (Import)") : null,
        blocked_companies: scope.companies,
        self_applications: [...new Set([...parseNameList(selfApplied), ...firmen.selfApplied])],
        origin: [src],
      };
      rawCandidates.push(cand);
      if (firmen.presented.length) presentedByKey.set(cand.key, [{ items: firmen.presented, origin: "Alle Bewerber: Vorgestellt" }]);
    }
    // Einzelne Nachnamen aus „K-Nummern“ („Tkocz (Maron)“) nur bei eindeutigem Treffer zuordnen.
    for (const [surname, e] of knrBySurname) {
      const hits = rawCandidates.filter((x) => norm(x.last_name ?? "") === surname);
      if (hits.length === 1 && !hits[0].k_nr) {
        hits[0].k_nr = e.knr;
        issue("info", "K-Nummern", `${e.knr} „${e.label}“ → ${hits[0].first_name ?? ""} ${hits[0].last_name} (${hits[0].origin[0]}) zugeordnet.`);
      } else {
        const nk = surname;
        if (!knrByName.has(nk)) knrByName.set(nk, new Set());
        knrByName.get(nk)!.add(e.knr);
        nameByKnr.set(e.knr, e.label.replace(/\([^)]*\)/g, "").trim());
        if (hits.length > 1) issue("warnung", "K-Nummern", `${e.knr} „${e.label}“: mehrere Bewerber mit diesem Nachnamen – nicht zugeordnet.`);
      }
    }
  } else if (input.gesamtliste) {
    issue("fehler", "Gesamtliste", "Blatt „Alle Bewerber“ nicht gefunden.");
  }

  // --- Dubletten innerhalb des Imports zusammenführen
  const byEmail = new Map<string, CandidateIn>();
  const byPhone = new Map<string, CandidateIn>();
  const byName = new Map<string, CandidateIn>();
  const byKnr = new Map<string, CandidateIn>();
  const aliasKey = new Map<string, string>(); // alter key → behaltener key
  for (const cand of rawCandidates) {
    const nameKey = cand.last_name && !cand.name_gap ? `${personKey(cand.first_name, cand.last_name)}|${cand.plz ?? norm(cand.city ?? "")}` : null;
    const hit = (cand.email && byEmail.get(cand.email))
      || (normPhone(cand.phone) && byPhone.get(normPhone(cand.phone)!))
      || (cand.k_nr && sameperson(byKnr.get(cand.k_nr), cand))
      || (nameKey && byName.get(nameKey))
      || null;
    if (hit) {
      const reason = cand.email && hit.email === cand.email ? "E-Mail" : normPhone(cand.phone) && normPhone(hit.phone) === normPhone(cand.phone) ? "Telefon" : cand.k_nr && hit.k_nr === cand.k_nr ? "K-Nr." : "Name+Ort";
      mergeInto(hit, cand);
      aliasKey.set(cand.key, hit.key);
      plan.merged.push({ kept: hit.k_nr ?? hit.key, merged: `${cand.origin[0]} (${[cand.first_name, cand.last_name].filter(Boolean).join(" ")})`, reason });
    } else {
      plan.candidates.push(cand);
    }
    const target = hit ?? cand;
    if (target.email) byEmail.set(target.email, target);
    if (normPhone(target.phone)) byPhone.set(normPhone(target.phone)!, target);
    if (target.k_nr) byKnr.set(target.k_nr, target);
    for (const l of target.legacy_k_nrs) byKnr.set(l, target);
    if (nameKey) byName.set(nameKey, target);
  }

  // Zwei Personen mit derselben K-Nummer (Doppelvergabe): die zweite bekommt eine neue Nummer.
  const seenKnr = new Map<string, CandidateIn>();
  for (const cand of plan.candidates) {
    for (const k of [cand.k_nr, ...cand.legacy_k_nrs].filter(Boolean) as string[]) {
      const other = seenKnr.get(k);
      if (other && other !== cand) {
        if (cand.k_nr === k) {
          issue("warnung", cand.origin[0], `${k} ist doppelt vergeben (${other.first_name ?? ""} ${other.last_name ?? ""} / ${cand.first_name ?? ""} ${cand.last_name ?? ""}) – zweite Person bekommt neue Nummer, alte steht in legacy_k_nrs.`);
          cand.legacy_k_nrs = [...cand.legacy_k_nrs, k];
          cand.k_nr = null;
        } else {
          cand.legacy_k_nrs = cand.legacy_k_nrs.filter((x) => x !== k);
        }
      } else seenKnr.set(k, cand);
    }
  }

  // Nach der Neuvergabe: K-Nummer → Person neu aufbauen (Hauptnummern vor Alt-Nummern).
  byKnr.clear();
  for (const cand of plan.candidates) if (cand.k_nr) byKnr.set(cand.k_nr, cand);
  for (const cand of plan.candidates) for (const l of cand.legacy_k_nrs) if (!byKnr.has(l)) byKnr.set(l, cand);

  // K-Nummern ohne Zeile in „Alle Bewerber“ → als Pool anlegen und melden.
  for (const [nk, set] of knrByName) {
    const ks = [...set].sort((a, b) => knrNumber(a) - knrNumber(b));
    if (ks.some((k) => byKnr.has(k))) continue;
    if ([...byName.keys()].some((k) => k.startsWith(nk + "|"))) continue;
    const full = nameByKnr.get(ks[0])!;
    // Nur ein Nachname („Gräf“): als Nachname mit Klarnamen-Lücke.
    const single = !full.includes(" ");
    const { first, last } = single ? { first: null, last: full } : splitName(full);
    const gap = single || nameGap(first, last);
    const cand: CandidateIn = {
      key: `knr-${ks[0]}`, k_nr: ks[0], legacy_k_nrs: ks.slice(1), first_name: first, last_name: last, email: null, phone: null,
      plz: null, city: null, profile_title: null, skills: null, category: null, salary_wish: null, available_from: null,
      notice_period: null, exclusions: null, source: null, stage: "pool", priority: null, next_action: null,
      next_action_date: null, consent_date: null,
      notes: `${gap ? "[Klarname fehlt – beim Import nicht geraten, bitte ergänzen]\n" : ""}Nur im Blatt „K-Nummern“ gefunden, nicht in „Alle Bewerber“.`,
      name_gap: gap, blocked_reason: null, blocked_companies: [], self_applications: [], origin: ["K-Nummern"],
    };
    plan.candidates.push(cand);
    byKnr.set(ks[0], cand);
    issue("warnung", "K-Nummern", `${ks[0]} ${full}: nicht in „Alle Bewerber“ – als Pool angelegt, bitte prüfen.`);
  }

  const resolveKey = (k: string) => {
    for (let i = 0; i < 20 && aliasKey.has(k); i++) k = aliasKey.get(k)!;
    return k;
  };

  // --- Master „Kandidaten“: ergänzt die gepflegten Profile (nur leere Felder), Vorstellungen und Selbstbewerbungen.
  const masterSheet = input.master && findSheet(input.master, "Kandidaten");
  if (masterSheet) {
    const c = columns(masterSheet, MASTER_CANDIDATE_COLS);
    for (const r of masterSheet.rows) {
      const src = `Master Kandidaten Z.${r.__row}`;
      const split = splitName(str(get(r, c.name)));
      // Nur ein Wort im Master („Andjelovic“) = Nachname.
      const { first, last } = split.first && !split.last ? { first: null, last: split.first } : split;
      if (!first && !last) continue;
      const email = cleanEmail(str(get(r, c.email)));
      const phone = normPhone(str(get(r, c.phone)));
      const knr = normalizeKnr(get(r, c.k_nr), year);
      const probe = { first_name: first, last_name: last, name_gap: nameGap(first, last) } as CandidateIn;
      const target = (email && plan.candidates.find((x) => x.email === email))
        || (phone && plan.candidates.find((x) => normPhone(x.phone) === phone))
        || (knr && sameperson(byKnr.get(knr), probe))
        || plan.candidates.find((x) => personKey(x.first_name, x.last_name) === personKey(first, last))
        || plan.candidates.find((x) => norm(x.last_name ?? "") === norm(last ?? "") && norm(x.first_name ?? "").split(" ")[0] === norm(first ?? "").split(" ")[0])
        || (!first && last && ((hits) => hits.length === 1 ? hits[0] : null)(plan.candidates.filter((x) => norm(x.last_name ?? "") === norm(last))))
        || null;
      if (!target) {
        issue("warnung", src, `${first ?? ""} ${last ?? ""} steht im Master, aber nicht in „Alle Bewerber“ – nicht übernommen, bitte prüfen.`);
        continue;
      }
      const fill = (f: keyof CandidateIn, v: string | null) => {
        if (v && (target[f] == null || target[f] === "")) (target as Record<string, unknown>)[f] = v;
      };
      fill("email", email);
      fill("phone", str(get(r, c.phone)));
      fill("city", str(get(r, c.city)));
      fill("profile_title", str(get(r, c.profile_title)));
      fill("skills", str(get(r, c.skills)));
      fill("salary_wish", str(get(r, c.salary)));
      fill("available_from", str(get(r, c.available)));
      fill("exclusions", str(get(r, c.exclusions)));
      fill("next_action", str(get(r, c.next_action)));
      fill("priority", mapPriority(str(get(r, c.priority))));
      if (knr && !target.k_nr && !plan.candidates.some((x) => x.k_nr === knr)) target.k_nr = knr;
      else if (knr && target.k_nr !== knr && !target.legacy_k_nrs.includes(knr)) {
        issue("info", src, `${first} ${last}: Master nennt ${knr}, behalten wird ${target.k_nr ?? "die neue Nummer"} (${knr} als alte Nummer).`);
        target.legacy_k_nrs = [...target.legacy_k_nrs, knr].sort((a, b) => knrNumber(a) - knrNumber(b));
      }
      const extra = [
        str(get(r, c.radius)) && `Radius/Umzug/HO (Master): ${str(get(r, c.radius))}`,
        str(get(r, c.status)) && `Status (Master): ${str(get(r, c.status))}`,
      ].filter(Boolean).join("\n");
      if (extra) target.notes = [target.notes, extra].filter(Boolean).join("\n");
      target.self_applications = [...new Set([...target.self_applications, ...parseNameList(str(get(r, c.self_applied)))])];
      const presented = parsePresentedList(str(get(r, c.presented)), opts);
      if (presented.length) presentedByKey.set(target.key, [...(presentedByKey.get(target.key) ?? []), { items: presented, origin: src }]);
      target.origin.push(src);
    }
  }

  // --- Vorstellungen: nur Abschnitt „Vorgestellt:“ (Gesamtliste) bzw. „Bereits vorgestellt bei“ (Master), nur mit Datum.
  for (const [rawKey, lists] of presentedByKey) {
    const key = resolveKey(rawKey);
    const who = plan.candidates.find((c) => c.key === key);
    const label = who ? `${who.k_nr ?? ""} ${[who.first_name, who.last_name].filter(Boolean).join(" ")}`.trim() : key;
    const warned = new Set<string>();
    for (const { items, origin } of lists) {
      for (const it of items) {
        if (it.uncertain) {
          if (!warned.has(norm(it.company))) issue("warnung", `Kandidat ${label}`, `Vorstellung bei „${it.company}?“ unsicher – nicht übernommen, bitte prüfen.`);
          warned.add(norm(it.company));
          continue;
        }
        addCompany({ name: it.company, source: "Leadliste" });
        if (it.date) plan.presentations.push({ candidateKey: key, company: it.company, sent_date: it.date, notes: it.detail ? `Laut Liste: ${it.detail}` : null, origin });
        else if (!warned.has(norm(it.company))) {
          warned.add(norm(it.company));
          issue("warnung", `Kandidat ${label}`, `Vorgestellt bei „${it.company}“${it.detail ? ` (${it.detail})` : ""} ohne Datum – nicht als Vorstellung übernommen, bitte Datum nachtragen.`);
        }
      }
    }
  }

  // --- Sperren (Gesamtliste „Sperren & Tabus“ + Master „Tabu & Regeln“)
  const candidateByName = new Map(plan.candidates.map((c) => [personKey(c.first_name, c.last_name), c]));
  const blockedFromList = new Set<string>();
  for (const cand of plan.candidates) {
    if (!cand.blocked_reason) continue;
    const name = [cand.first_name, cand.last_name].filter(Boolean).join(" ");
    blockedFromList.add(personKey(cand.first_name, cand.last_name));
    if (!cand.blocked_companies.length) plan.blocklist.push({ type: "Person", name, candidateKey: cand.key, reason: cand.blocked_reason });
    for (const f of cand.blocked_companies) {
      addCompany({ name: f, source: "Leadliste" });
      plan.blocklist.push({ type: "Person", name, candidateKey: cand.key, company: f, reason: cand.blocked_reason });
    }
  }
  for (const b of companyRowBlocks) {
    addCompany({ name: b.name, city: b.city, stage: "tabu", source: "Leadliste", notes: b.reason });
    plan.blocklist.push({ type: "Firma", name: b.name, company: b.name, reason: b.reason });
  }
  const blockSheets = [
    input.gesamtliste && findSheet(input.gesamtliste, "Sperren & Tabus", "Sperren"),
    input.master && findSheet(input.master, "Tabu & Regeln", "Tabu"),
  ].filter(Boolean) as Sheet[];

  // --- Master: Offene Stellen
  const jobSheet = input.master && findSheet(input.master, "Offene Stellen", "Stellen");
  if (jobSheet) {
    const c = columns(jobSheet, {
      company: ["Firma", "Unternehmen", "Arbeitgeber", "Kunde"], title: ["Stelle", "Position", "Titel", "Jobtitel", "Stellenbezeichnung"],
      city: ["Ort", "Standort", "Einsatzort"], url: ["Link", "URL", "Anzeige"], type: ["Art", "Quelle", "Typ"],
      salary: ["Gehalt"], posted: ["Veröffentlicht", "Datum", "Online seit"], checked: ["Online-Check", "Online Check", "Geprüft", "Check", "Stellencheck"],
      status: ["Status", "Online"], ref: ["Ref", "Referenz", "Ref.-Nr", "Kennziffer"], notes: ["Notiz", "Bemerkung", "Kommentar"],
    });
    for (const r of jobSheet.rows) {
      const company = str(get(r, c.company));
      const title = str(get(r, c.title));
      if (!company || !title) { issue("warnung", `Offene Stellen Z.${r.__row}`, "Firma oder Stelle fehlt – übersprungen."); continue; }
      addCompany({ name: company, city: str(get(r, c.city)), source: "Leadliste" });
      const statusRaw = norm(str(get(r, c.status)) ?? "");
      const typ = norm(str(get(r, c.type)) ?? "");
      addJob({
        company, title, city: str(get(r, c.city)), url: str(get(r, c.url)),
        source_type: typ.includes("vermittler") ? "Vermittler-Anzeige" : typ.includes("mandat") ? "Mandat" : typ.includes("initiativ") ? "initiativ" : typ ? "eigene Anzeige" : null,
        salary_range: str(get(r, c.salary)), posted_date: parseDate(get(r, c.posted), opts),
        last_checked_date: parseDate(get(r, c.checked), opts),
        status: /besetzt/.test(statusRaw) ? "besetzt" : /offline|weg|nicht mehr/.test(statusRaw) ? "offline" : "online",
        ref_no: str(get(r, c.ref)), notes: str(get(r, c.notes)),
      });
    }
  }

  // Nur Vor- oder Nachname („Gözde“, „Mühlhause“): nur bei eindeutigem Treffer.
  const looseCandidate = (raw: string | null): CandidateIn | undefined => {
    const n = norm(raw ?? "");
    if (!n || n.includes(" ")) return undefined;
    const byLast = plan.candidates.filter((x) => norm(x.last_name ?? "") === n);
    if (byLast.length === 1) return byLast[0];
    const byFirst = plan.candidates.filter((x) => norm(x.first_name ?? "").split(" ")[0] === n);
    return byLast.length === 0 && byFirst.length === 1 ? byFirst[0] : undefined;
  };

  // --- Master: Matching (mit Datum = Vorstellung, ohne = Stellen-Vorschlag)
  const matchSheet = input.master && findSheet(input.master, "Matching", "Matches");
  if (matchSheet) {
    const c = columns(matchSheet, {
      k_nr: CANDIDATE_COLS.k_nr, name: ["Kandidat", "Name", "Bewerber"], company: ["Firma", "Unternehmen", "Arbeitgeber", "Kunde"],
      title: ["Stelle", "Position", "Titel", "Jobtitel"], date: ["Vorgestellt am", "Datum", "Gesendet", "Versendet"], notes: ["Notiz", "Status", "Bemerkung"],
    });
    for (const r of matchSheet.rows) {
      const src = `Matching Z.${r.__row}`;
      const company = str(get(r, c.company));
      if (!company) { issue("warnung", src, "Firma fehlt – übersprungen."); continue; }
      const knr = normalizeKnr(get(r, c.k_nr), year);
      const byName = candidateByName.get(norm(str(get(r, c.name)) ?? "")) ?? looseCandidate(str(get(r, c.name)));
      const byNr = knr ? byKnr.get(knr) : undefined;
      // Passt der Name nicht zur Nummer (Doppelvergabe), gewinnt der Name.
      const cand = (byNr && (!byName || byName === byNr) ? byNr : byName ?? byNr) ?? null;
      const title = str(get(r, c.title));
      const date = parseDate(get(r, c.date), opts);
      addCompany({ name: company, source: "Leadliste" });
      if (date) {
        if (!cand) { issue("fehler", src, `Vorstellung bei ${company} am ${date}: Kandidat „${knr ?? str(get(r, c.name)) ?? "?"}“ nicht gefunden.`); continue; }
        if (title) addJob({ company, title });
        plan.presentations.push({ candidateKey: cand.key, company, jobTitle: title, sent_date: date, notes: str(get(r, c.notes)), origin: src });
      } else if (title) {
        const who = cand ? `${cand.k_nr ?? ""} ${cand.first_name ?? ""} ${cand.last_name ?? ""}`.replace(/\s+/g, " ").trim() : str(get(r, c.name));
        addJob({ company, title, source_type: "Vorschlag", notes: [who && `Match-Vorschlag: ${who}`, str(get(r, c.notes))].filter(Boolean).join(" – ") || null });
      } else {
        issue("info", src, `Match ohne Stelle und ohne Datum (${company}) – nur Firma übernommen.`);
      }
    }
  }

  // --- Leadlisten
  for (const { file, sheets } of input.leads ?? []) {
    const source = /endkunden/i.test(file) ? "Endkunden-Recherche" : "Leadliste";
    for (const s of sheets) {
      const c = columns(s, {
        company: ["Firma", "Unternehmen", "Firmenname", "Arbeitgeber", "Name"], city: ["Ort", "Standort", "Stadt"], plz: ["PLZ"],
        industry: ["Branche"], website: ["Website", "Webseite", "Homepage", "URL"], contact: ["Ansprechpartner", "Kontakt", "Kontaktperson"],
        role: ["Funktion", "Rolle", "Position Ansprechpartner"], email: ["E-Mail", "Email", "Mail"], phone: ["Telefon", "Tel"],
        status: ["Status", "Stand"], notes: ["Notiz", "Notizen", "Bemerkung", "Kommentar"], job: ["Stelle", "Stellen", "Position", "Offene Stelle"],
        next: ["Nächste Aktion", "Nächster Schritt"], next_date: ["Wiedervorlage", "Datum nächste Aktion", "WV"],
        group: ["Gruppe", "Konzern", "Schwesterfirma"],
      });
      if (!c.company) { issue("info", `${file} / ${s.name}`, "Keine Firmenspalte – Blatt übersprungen."); continue; }
      for (const r of s.rows) {
        const name = str(get(r, c.company));
        if (!name) continue;
        addCompany({
          name, city: str(get(r, c.city)), plz: str(get(r, c.plz)), industry: str(get(r, c.industry)), website: str(get(r, c.website)),
          stage: mapCompanyStage(str(get(r, c.status))), source, notes: str(get(r, c.notes)), group_name: str(get(r, c.group)),
          next_action: str(get(r, c.next)), next_action_date: parseDate(get(r, c.next_date), opts),
        });
        const contact = str(get(r, c.contact));
        if (contact) plan.contacts.push({ company: name, name: contact, role: str(get(r, c.role)), email: str(get(r, c.email)), phone: str(get(r, c.phone)) });
        const job = str(get(r, c.job));
        if (job && job.length < 120) addJob({ company: name, title: job, city: str(get(r, c.city)) });
      }
    }
  }

  /**
   * Zeile aus „Tabu & Regeln“: „Kögel für Schwab“ → Personensperre nur bei Kögel; „AGG“, „Mails“ … → Regel;
   * „Bauer, Optima Packaging“ / „Hoffmann Group / Hoffmann Supply Chain“ → je Firma ein Tabu;
   * „Humbaur*“ → Ausnahme (Grund erklärt sie), nur Hinweis; „derzeit kein Bedarf“ → Ruhend statt Tabu.
   */
  const tabuEntry = (name: string, reason: string, src: string) => {
    const fuer = name.match(/^(.+?)\s+für\s+(.+)$/i);
    if (fuer) {
      let who = plan.candidates.filter((x) => personKey(x.first_name, x.last_name) === norm(fuer[2]) || norm(x.last_name ?? "") === norm(fuer[2]));
      // Mehrere gleichnamige: nur die aktiven (nicht Raus/Pool) zählen.
      if (who.length > 1) {
        who = who.filter((x) => !["raus", "pool"].includes(x.stage));
        if (who.length === 1) issue("info", src, `„${name}“: mehrere „${fuer[2]}“ – Sperre an den aktiven ${who[0].k_nr ?? ""} ${who[0].first_name ?? ""} ${who[0].last_name} gehängt.`);
      }
      if (who.length === 1) {
        addCompany({ name: fuer[1].trim(), source: "Leadliste" });
        plan.blocklist.push({ type: "Person", name: [who[0].first_name, who[0].last_name].filter(Boolean).join(" "), candidateKey: who[0].key, company: fuer[1].trim(), reason });
      } else {
        plan.blocklist.push({ type: "Regel", name, reason });
        issue("warnung", src, `„${name}“: Person nicht eindeutig gefunden – als Regel übernommen.`);
      }
      return;
    }
    if (/\b(agg|anonymitaet|mails?|agenturen|vor jedem|pitch)\b/.test(norm(name))) {
      plan.blocklist.push({ type: "Regel", name, reason });
      return;
    }
    for (const part of splitTopLevel(name, ",")) {
      if (/^alle\b/i.test(part)) {
        plan.blocklist.push({ type: "Regel", name: part, reason });
        continue;
      }
      for (const sub of part.split(/\s+\/\s+/)) {
        const star = sub.includes("*");
        const city = sub.match(/\(([^)]*)\)\s*$/)?.[1] ?? null;
        const firm = sub.replace(/\*/g, "").replace(/\s*\([^)]*\)\s*$/, "").trim();
        if (firm.length < 2) continue;
        if (star) {
          addCompany({ name: firm, city, source: "Leadliste", notes: `Hinweis aus Tabu-Liste („${sub.trim()}“): ${reason}` });
          issue("warnung", src, `„${sub.trim()}“ mit Sternchen = Ausnahme laut Grund („${reason}“) – nicht gesperrt, Hinweis an der Firma.`);
        } else if (/derzeit|fuer passende|spaeter|aktuell kein/.test(norm(reason))) {
          addCompany({ name: firm, city, stage: "ruhend", source: "Leadliste", notes: reason });
          issue("info", src, `${firm}: „${reason}“ – als Ruhend übernommen, nicht als Tabu.`);
        } else {
          addCompany({ name: firm, city, stage: "tabu", source: "Leadliste", notes: reason });
          plan.blocklist.push({ type: "Firma", name: firm, company: firm, reason });
        }
      }
    }
  };

  for (const s of blockSheets) {
    const c = columns(s, {
      name: ["Name", "Firma", "Person", "Wer", "Eintrag"], type: ["Art", "Typ", "Kategorie"],
      reason: ["Grund", "Begründung", "Regel", "Hinweis", "Bemerkung"], scope: ["Gilt für", "Scope", "Bereich", "Nur bei"],
    });
    for (const r of s.rows) {
      const name = str(get(r, c.name));
      if (!name) continue;
      const src = `${s.name} Z.${r.__row}`;
      const reason = str(get(r, c.reason)) ?? s.name;
      const typ = norm(str(get(r, c.type)) ?? "");
      const cand = candidateByName.get(norm(name));
      const scopeCompany = str(get(r, c.scope));
      if ((typ.startsWith("person") || (cand && !typ)) && !(!cand && looksLikeCompany(name))) {
        if (cand && blockedFromList.has(norm(name))) {
          // Schon aus „Alle Bewerber“ gesperrt – dort steht der genaue Geltungsbereich („für: Ritter“).
          issue("info", src, `${name}: Sperre aus „Alle Bewerber“ übernommen (mit Geltungsbereich), Eintrag hier nicht doppelt.`);
          continue;
        }
        const onlyAt = scopeCompany && !/alle|ueberall/.test(norm(scopeCompany)) ? scopeCompany : null;
        if (onlyAt) addCompany({ name: onlyAt, source: "Leadliste" });
        plan.blocklist.push({ type: "Person", name, candidateKey: cand?.key ?? null, company: onlyAt, reason });
      } else if (typ.startsWith("regel")) {
        plan.blocklist.push({ type: "Regel", name, reason });
      } else {
        tabuEntry(name, reason, src);
      }
    }
  }

  // --- BA-Bewerberbörse
  const baSheet = input.gesamtliste && findSheet(input.gesamtliste, "BA-Bewerberbörse (anonym)", "BA-Bewerberbörse", "BA Bewerberboerse", "BA");
  if (baSheet) {
    const c = columns(baSheet, {
      ref: ["Referenznummer", "Ref.-Nr", "Ref-Nr", "Ref", "Referenz", "Kennung"], search: ["Suche", "Suchbegriff", "Suchprofil"],
      qual: ["Qualifikation", "Beruf", "Profil", "Titel"], age: ["Alter"], city: ["Ort", "Wohnort", "Region"],
      contacted: ["Kontaktiert", "Angeschrieben", "Kontaktiert am", "Datum"], reply: ["Antwort", "Reaktion", "Rückmeldung"],
    });
    const seen = new Set<string>();
    for (const r of baSheet.rows) {
      const ref = str(get(r, c.ref));
      if (!ref) { issue("warnung", `BA Z.${r.__row}`, "Ohne Referenznummer – übersprungen."); continue; }
      if (seen.has(ref)) { issue("info", `BA Z.${r.__row}`, `Referenz ${ref} doppelt – zusammengeführt.`); continue; }
      seen.add(ref);
      const age = Number(str(get(r, c.age))?.replace(/\D/g, ""));
      plan.baProfiles.push({
        ref_no: ref, search: str(get(r, c.search)), qualification: str(get(r, c.qual)), age: Number.isFinite(age) && age > 0 ? age : null,
        city: str(get(r, c.city)), contacted_date: parseDate(get(r, c.contacted), opts), reply: str(get(r, c.reply)),
      });
    }
  }

  // Aktive Kandidaten mit Vorstellung stehen mindestens auf „vorgestellt“.
  const presented = new Set(plan.presentations.map((p) => p.candidateKey));
  for (const cand of plan.candidates) {
    if (cand.stage === "vermarktbar" && presented.has(cand.key)) cand.stage = "vorgestellt";
  }

  // Gleiche Vorstellung aus Gesamtliste und Master nur einmal (frühestes Datum).
  const firstPres = new Map<string, PresentationIn>();
  for (const p of plan.presentations) {
    const k = `${p.candidateKey}|${norm(p.company)}`;
    const e = firstPres.get(k);
    if (!e) firstPres.set(k, p);
    else if (p.sent_date < e.sent_date) firstPres.set(k, { ...p, jobTitle: p.jobTitle ?? e.jobTitle, notes: p.notes ?? e.notes });
    else if (!e.jobTitle && p.jobTitle) e.jobTitle = p.jobTitle;
  }
  plan.presentations = [...firstPres.values()];

  // Alle Verweise auf den Namen zeigen, unter dem die Firma angelegt wird („Optima Packaging“ → „OPTIMA packaging group“).
  const canonical = (name: string) => companies.get(companyKey(name))?.name ?? name;
  for (const p of plan.presentations) p.company = canonical(p.company);
  for (const j of jobs.values()) j.company = canonical(j.company);
  for (const ct of plan.contacts) ct.company = canonical(ct.company);
  for (const b of plan.blocklist) if (b.company) b.company = canonical(b.company);
  // Firmen-Sperre je Firma nur einmal (Tabu-Liste und Sperrliste nennen oft dieselbe Firma).
  const firmBlocks = new Set<string>();
  plan.blocklist = plan.blocklist.filter((b) => {
    if (b.type !== "Firma" || !b.company) return true;
    const k = companyKey(b.company);
    if (firmBlocks.has(k)) return false;
    firmBlocks.add(k);
    b.name = b.company;
    return true;
  });

  plan.companies = [...companies.values()];
  plan.jobs = [...jobs.values()];
  return plan;
}

/** Gleiche K-Nummer zählt nur als Dublette, wenn auch der Name passt (sonst Doppelvergabe). */
function sameperson(a: CandidateIn | undefined, b: CandidateIn): CandidateIn | null {
  if (!a) return null;
  if (a.name_gap || b.name_gap) return a;
  return norm(a.last_name ?? "") === norm(b.last_name ?? "") ? a : null;
}

function mergeInto(target: CandidateIn, other: CandidateIn) {
  const fields: (keyof CandidateIn)[] = ["first_name", "last_name", "email", "phone", "plz", "city", "profile_title", "skills",
    "category", "salary_wish", "available_from", "notice_period", "exclusions", "source", "priority", "next_action",
    "next_action_date", "consent_date", "blocked_reason"];
  for (const f of fields) if (target[f] == null && other[f] != null) (target as Record<string, unknown>)[f] = other[f];
  const ks = [target.k_nr, ...target.legacy_k_nrs, other.k_nr, ...other.legacy_k_nrs].filter(Boolean) as string[];
  const uniq = [...new Set(ks)].sort((a, b) => knrNumber(a) - knrNumber(b));
  target.k_nr = uniq[0] ?? null;
  target.legacy_k_nrs = uniq.slice(1);
  target.notes = [target.notes, other.notes].filter(Boolean).join("\n") || null;
  target.self_applications = [...new Set([...target.self_applications, ...other.self_applications])];
  target.blocked_companies = [...new Set([...target.blocked_companies, ...other.blocked_companies])];
  target.origin.push(...other.origin);
  target.name_gap = target.name_gap && other.name_gap;
}
