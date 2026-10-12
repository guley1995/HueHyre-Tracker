import { Board, type BoardCard } from "@/components/board";
import { FilterBar } from "@/components/filter-bar";
import { CandidateTable } from "@/components/tables";
import { CANDIDATE_STAGES } from "@/lib/constants";
import { applyFilters, parseFilters } from "@/lib/filters";
import { supabaseServer } from "@/lib/supabase/server";
import type { CandidateCard } from "@/lib/types";

export const metadata = { title: "Kandidaten" };

export default async function CandidatesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const view = sp.view === "tabelle" ? "tabelle" : "board";
  const filters = parseFilters(sp);
  const sb = await supabaseServer();
  let q = applyFilters(sb.from("candidate_cards").select("*"), filters, "candidate");
  if (view === "board") q = q.neq("stage", "pool");
  const { data, error } = await q.order("next_action_date", { ascending: true, nullsFirst: true }).range(0, 4999);
  const rows = (data ?? []) as CandidateCard[];

  return (
    <div>
      <h1 className="mb-3 text-xl font-bold">Kandidaten</h1>
      <FilterBar entity="candidate" filters={filters} view={view} basePath="/kandidaten" />
      {error && <p className="text-sm text-destructive">{error.message}</p>}
      {view === "board" ? (
        <Board
          entity="candidate"
          columns={CANDIDATE_STAGES}
          cards={rows.map((c): BoardCard => ({
            id: c.id, stage: c.stage, title: c.full_name || c.k_nr, subtitle: `${c.k_nr}${c.profile_title ? " · " + c.profile_title : ""}`,
            priority: c.priority, city: [c.plz, c.city].filter(Boolean).join(" ") || null,
            next_action: c.next_action, next_action_date: c.next_action_date, missing_next_action: c.missing_next_action,
            overdue: c.overdue, days_since_activity: c.days_since_activity, active_presentations: c.active_presentations,
          }))}
        />
      ) : (
        <CandidateTable rows={rows} />
      )}
    </div>
  );
}
