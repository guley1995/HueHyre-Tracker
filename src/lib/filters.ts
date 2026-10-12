// Filter für Boards/Tabellen und Excel-Export (gleiche Logik an beiden Stellen).

export type BoardFilters = {
  prio?: string;
  kategorie?: string;
  region?: string;
  quelle?: string;
  ueberfaellig?: string;
  q?: string;
  stage?: string;
};

export function parseFilters(sp: Record<string, string | string[] | undefined>): BoardFilters {
  const get = (k: string) => {
    const v = sp[k];
    const s = Array.isArray(v) ? v[0] : v;
    return s && s.trim() ? s.trim() : undefined;
  };
  return {
    prio: get("prio"), kategorie: get("kategorie"), region: get("region"), quelle: get("quelle"),
    ueberfaellig: get("ueberfaellig"), q: get("q"), stage: get("stage"),
  };
}

/** Eingaben für PostgREST-Filter entschärfen (Kommas/Klammern beenden sonst den Ausdruck). */
function safe(s: string) {
  return s.replace(/[,()*%\\]/g, " ").trim();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Q = any;

export function applyFilters(query: Q, f: BoardFilters, entity: "candidate" | "company"): Q {
  let q = query;
  if (f.prio) q = q.eq("priority", f.prio);
  if (f.kategorie && entity === "candidate") q = q.eq("category", f.kategorie);
  if (f.quelle) q = q.eq("source", f.quelle);
  if (f.stage) q = q.eq("stage", f.stage);
  if (f.region) {
    const r = safe(f.region);
    q = /^\d+$/.test(r) ? q.like("plz", `${r}%`) : q.ilike("city", `%${r}%`);
  }
  if (f.ueberfaellig) q = q.or("overdue.eq.true,missing_next_action.eq.true");
  if (f.q) {
    const s = safe(f.q);
    q = entity === "candidate"
      ? q.or(`full_name.ilike.%${s}%,k_nr.ilike.%${s}%,profile_title.ilike.%${s}%,skills.ilike.%${s}%`)
      : q.or(`name.ilike.%${s}%,industry.ilike.%${s}%,group_name.ilike.%${s}%`);
  }
  return q;
}

export function filtersToQuery(f: BoardFilters): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
  return p.toString();
}
