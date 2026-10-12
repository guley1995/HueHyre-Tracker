import Link from "next/link";
import { PresentDialog } from "@/components/present-dialog";
import { Badge, PriorityBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { CANDIDATE_STAGE_LABELS, CATEGORIES } from "@/lib/constants";
import { supabaseServer } from "@/lib/supabase/server";
import { cn, fmtDate } from "@/lib/utils";

export const metadata = { title: "Matching" };

type Match = {
  candidate_id: string; k_nr: string; full_name: string; category: string | null; city: string | null; plz: string | null;
  radius_km: number | null; salary_wish: string | null; available_from: string | null; stage: string; priority: string | null;
  already_presented: boolean; blocked: boolean; block_reason: string | null; score: number;
};

export default async function MatchingPage({ searchParams }: { searchParams: Promise<{ job?: string; kategorie?: string }> }) {
  const { job, kategorie } = await searchParams;
  const sb = await supabaseServer();
  const { data: jobs } = await sb.from("jobs").select("id, title, city, status, last_checked_date, salary_range, company_id, companies(name, stage)")
    .neq("status", "besetzt").order("title").range(0, 4999);
  type JobRow = { id: string; title: string; city: string | null; status: string; last_checked_date: string | null; salary_range: string | null;
    company_id: string; companies: { name: string; stage: string } | null };
  const jobRows = ((jobs ?? []) as unknown as JobRow[]).filter((j) => j.companies?.stage !== "tabu")
    .sort((a, b) => (a.companies?.name ?? "").localeCompare(b.companies?.name ?? "", "de"));
  const selected = jobRows.find((j) => j.id === job);

  let matches: Match[] = [];
  let consent = new Map<string, string | null>();
  if (selected) {
    const { data } = await sb.rpc("match_candidates", { p_job_id: selected.id, p_category: kategorie || null });
    matches = (data ?? []) as Match[];
    const ids = matches.map((m) => m.candidate_id);
    if (ids.length) {
      const { data: cs } = await sb.from("candidates").select("id, consent_date").in("id", ids.slice(0, 1000));
      consent = new Map((cs ?? []).map((c) => [c.id as string, c.consent_date as string | null]));
    }
  }
  const stale = selected && (!selected.last_checked_date || selected.last_checked_date < new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10));

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <h1 className="text-xl font-bold">Matching</h1>
      <form className="flex flex-wrap gap-2" action="/matching">
        <Select name="job" defaultValue={job ?? ""} className="max-w-xl flex-1">
          <option value="">– Stelle wählen –</option>
          {jobRows.map((j) => (
            <option key={j.id} value={j.id}>{j.companies?.name} · {j.title}{j.city ? ` (${j.city})` : ""}{j.status !== "online" ? ` [${j.status}]` : ""}</option>
          ))}
        </Select>
        <Select name="kategorie" defaultValue={kategorie ?? ""} className="w-36">
          <option value="">alle Kategorien</option>
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </Select>
        <Button type="submit">Passende Kandidaten</Button>
      </form>

      {selected && (
        <>
          <p className="text-sm">
            <Link href={`/firmen/${selected.company_id}`} className="font-medium hover:underline">{selected.companies?.name}</Link>
            {" · "}{selected.title}{selected.salary_range ? ` · ${selected.salary_range}` : ""} · zuletzt geprüft {fmtDate(selected.last_checked_date)}
          </p>
          {stale && <Notice kind="hint">Stellencheck älter als 7 Tage – Anzeige erst prüfen.</Notice>}
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Kandidat</th><th className="px-3 py-2">Kat.</th><th className="px-3 py-2">Ort / Radius</th>
                  <th className="px-3 py-2">Gehalt</th><th className="px-3 py-2">Verfügbar</th><th className="px-3 py-2">Spalte</th>
                  <th className="px-3 py-2">Score</th><th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {matches.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">Keine Kandidaten.</td></tr>}
                {matches.map((m) => {
                  const grey = m.already_presented || m.blocked;
                  return (
                    <tr key={m.candidate_id} className={cn("border-t border-border", grey && "opacity-50")}>
                      <td className="px-3 py-1.5">
                        <Link href={`/kandidaten/${m.candidate_id}`} className="font-medium text-primary hover:underline">{m.full_name || m.k_nr}</Link>
                        <span className="ml-1 text-xs text-muted-foreground">{m.k_nr}</span> <PriorityBadge priority={m.priority} />
                      </td>
                      <td className="px-3 py-1.5">{m.category ?? "–"}</td>
                      <td className="px-3 py-1.5">{[m.plz, m.city].filter(Boolean).join(" ") || "–"}{m.radius_km ? ` · ${m.radius_km} km` : ""}</td>
                      <td className="px-3 py-1.5">{m.salary_wish ?? "–"}</td>
                      <td className="px-3 py-1.5">{m.available_from ?? "–"}</td>
                      <td className="px-3 py-1.5">{CANDIDATE_STAGE_LABELS[m.stage]}</td>
                      <td className="px-3 py-1.5">{m.score}</td>
                      <td className="px-3 py-1.5 text-right">
                        {m.already_presented ? <Badge>schon vorgestellt</Badge>
                          : m.blocked ? <Badge variant="red" title={m.block_reason ?? ""}>gesperrt</Badge>
                          : <PresentDialog candidateId={m.candidate_id} candidateName={m.full_name || m.k_nr}
                              fixedCompanyId={selected.company_id} fixedJobId={selected.id} consentDate={consent.get(m.candidate_id) ?? null}
                              trigger={<Button size="sm" variant="outline">Vorstellen</Button>} />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
