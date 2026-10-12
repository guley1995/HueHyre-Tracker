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
  if (/angeschrieben|mail|kontaktiert|angerufen|raus/.test(n)) return "angeschrieben";
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
  notes: ["Notizen", "Notiz", "Bemerkung", "Bemerkungen", "Kommentar", "Anmerkungen"],
};

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
    const k = norm(c.name);
    if (!k) return;
    const existing = companies.get(k);
    if (!existing) return void companies.set(k, { ...c });
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
    const k = `${norm(j.company)}|${norm(j.title)}`;
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
  const knrSheet = input.gesamtliste && findSheet(input.gesamtliste, "K-Nummern", "K Nummern", "KNummern");
  if (knrSheet) {
    const c = columns(knrSheet, { k_nr: CANDIDATE_COLS.k_nr, name: CANDIDATE_COLS.name, first: ["Vorname"], last: ["Nachname"] });
    for (const r of knrSheet.rows) {
      const k = normalizeKnr(get(r, c.k_nr), year);
      const full = str(get(r, c.name)) ?? [str(get(r, c.first)), str(get(r, c.last))].filter(Boolean).join(" ");
      if (!k || !full) continue;
      const nk = norm(full);
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
  const firmenText = new Map<string, string>();
  if (sheet) {
    const c = columns(sheet, CANDIDATE_COLS);
    if (!c.name && !c.last_name) issue("fehler", "Alle Bewerber", "Keine Namensspalte erkannt.");
    for (const r of sheet.rows) {
      const src = `Alle Bewerber Z.${r.__row}`;
      let first = str(get(r, c.first_name));
      let last = str(get(r, c.last_name));
      if (!first && !last) ({ first, last } = splitName(str(get(r, c.name))));
      const email = str(get(r, c.email))?.toLowerCase() ?? null;
      const phone = str(get(r, c.phone));
      if (!first && !last && !email && !phone) {
        issue("warnung", src, "Leere Zeile ohne Name/Kontakt übersprungen.");
        continue;
      }
      const kat = str(get(r, c.kategorie));
      const st = mapStage(kat, str(get(r, c.status)));
      if (!st.known) issue("warnung", src, `Kategorie „${kat ?? ""}“ unbekannt – als „neu“ importiert.`);

      // K-Nummer: aus der Zeile, sonst aus dem K-Nummern-Blatt per Name.
      const knrs = new Set<string>();
      const own = normalizeKnr(get(r, c.k_nr), year);
      if (own) knrs.add(own);
      for (const k of knrByName.get(personKey(first, last)) ?? []) knrs.add(k);
      const sorted = [...knrs].sort((a, b) => knrNumber(a) - knrNumber(b));

      const consentRaw = get(r, c.consent);
      const consentDate = parseDate(consentRaw, opts);
      const notes: string[] = [];
      const existingNotes = str(get(r, c.notes));
      if (existingNotes) notes.push(existingNotes);
      if (!consentDate && str(consentRaw)) notes.push(`Einwilligung laut Liste: ${str(consentRaw)} (ohne Datum)`);
      const status = str(get(r, c.status));
      if (status) notes.push(`Status (Import): ${status}`);
      const gap = nameGap(first, last);
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
        blocked_reason: st.blocked ? (status ?? kat ?? "Gesperrt (Import)") : null,
        self_applications: selfApplied ? parseCompanyList(selfApplied, opts).map((x) => x.company) : [],
        origin: [src],
      };
      rawCandidates.push(cand);
      const firmen = str(get(r, c.firmen));
      if (firmen) firmenText.set(cand.key + "|" + r.__row, firmen);
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
    const { first, last } = splitName(full);
    const gap = nameGap(first, last);
    const cand: CandidateIn = {
      key: `knr-${ks[0]}`, k_nr: ks[0], legacy_k_nrs: ks.slice(1), first_name: first, last_name: last, email: null, phone: null,
      plz: null, city: null, profile_title: null, skills: null, category: null, salary_wish: null, available_from: null,
      notice_period: null, exclusions: null, source: null, stage: "pool", priority: null, next_action: null,
      next_action_date: null, consent_date: null,
      notes: `${gap ? "[Klarname fehlt – beim Import nicht geraten, bitte ergänzen]\n" : ""}Nur im Blatt „K-Nummern“ gefunden, nicht in „Alle Bewerber“.`,
      name_gap: gap, blocked_reason: null, self_applications: [], origin: ["K-Nummern"],
    };
    plan.candidates.push(cand);
    byKnr.set(ks[0], cand);
    issue("warnung", "K-Nummern", `${ks[0]} ${full}: nicht in „Alle Bewerber“ – als Pool angelegt, bitte prüfen.`);
  }

  // --- Vorstellungen aus „Firmen (vorgestellt …)“
  const resolveKey = (k: string) => {
    for (let i = 0; i < 20 && aliasKey.has(k); i++) k = aliasKey.get(k)!;
    return k;
  };
  for (const [fk, text] of firmenText) {
    const key = resolveKey(fk.split("|")[0]);
    const who = plan.candidates.find((c) => c.key === key);
    const label = who ? `${who.k_nr ?? ""} ${[who.first_name, who.last_name].filter(Boolean).join(" ")}`.trim() : key;
    for (const { company, date } of parseCompanyList(text, opts)) {
      addCompany({ name: company, source: "Leadliste" });
      if (date) plan.presentations.push({ candidateKey: key, company, sent_date: date, origin: "Alle Bewerber: Firmen (vorgestellt)" });
      else issue("warnung", `Kandidat ${label}`, `Firma „${company}“ ohne Datum genannt – nicht als Vorstellung übernommen, bitte prüfen.`);
    }
  }

  // --- Sperren (Gesamtliste „Sperren & Tabus“ + Master „Tabu & Regeln“)
  const candidateByName = new Map(plan.candidates.map((c) => [personKey(c.first_name, c.last_name), c]));
  for (const cand of plan.candidates) {
    if (cand.blocked_reason) plan.blocklist.push({ type: "Person", name: [cand.first_name, cand.last_name].filter(Boolean).join(" "), candidateKey: cand.key, reason: cand.blocked_reason });
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
      const byName = candidateByName.get(norm(str(get(r, c.name)) ?? ""));
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
        addJob({ company, title, source_type: "Vorschlag", notes: cand ? `Match-Vorschlag: ${cand.k_nr ?? ""} ${cand.first_name ?? ""} ${cand.last_name ?? ""}`.trim() : str(get(r, c.notes)) });
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

  for (const s of blockSheets) {
    const c = columns(s, {
      name: ["Name", "Firma", "Person", "Wer", "Eintrag"], type: ["Art", "Typ", "Kategorie"],
      reason: ["Grund", "Begründung", "Regel", "Hinweis", "Bemerkung"], scope: ["Gilt für", "Scope", "Bereich", "Nur bei"],
    });
    for (const r of s.rows) {
      const name = str(get(r, c.name));
      if (!name) continue;
      const reason = str(get(r, c.reason)) ?? s.name;
      const typ = norm(str(get(r, c.type)) ?? "");
      const cand = candidateByName.get(norm(name));
      const scopeCompany = str(get(r, c.scope));
      if (typ.startsWith("person") || (cand && !typ)) {
        const onlyAt = scopeCompany && !/alle|ueberall/.test(norm(scopeCompany)) ? scopeCompany : null;
        if (onlyAt) addCompany({ name: onlyAt, source: "Leadliste" });
        plan.blocklist.push({ type: "Person", name, candidateKey: cand?.key ?? null, company: onlyAt, reason });
      } else if (typ.startsWith("regel")) {
        plan.blocklist.push({ type: "Regel", name, reason });
      } else {
        addCompany({ name, stage: "tabu", source: "Leadliste", notes: reason });
        plan.blocklist.push({ type: "Firma", name, company: name, reason });
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
  target.origin.push(...other.origin);
  target.name_gap = target.name_gap && other.name_gap;
}
