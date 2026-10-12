import { Board, type BoardCard } from "@/components/board";
import { FilterBar } from "@/components/filter-bar";
import { CompanyTable } from "@/components/tables";
import { NewCompanyButton } from "@/components/company-forms";
import { COMPANY_STAGES } from "@/lib/constants";
import { applyFilters, parseFilters } from "@/lib/filters";
import { supabaseServer } from "@/lib/supabase/server";
import type { CompanyCard } from "@/lib/types";

export const metadata = { title: "Firmen" };

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const view = sp.view === "tabelle" ? "tabelle" : "board";
  const filters = parseFilters(sp);
  const sb = await supabaseServer();
  const { data, error } = await applyFilters(sb.from("company_cards").select("*"), filters, "company")
    .order("next_action_date", { ascending: true, nullsFirst: true }).range(0, 4999);
  const rows = (data ?? []) as CompanyCard[];

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-xl font-bold">Firmen <span className="text-sm font-normal text-muted-foreground">(Leadliste)</span></h1>
        <NewCompanyButton />
      </div>
      <FilterBar entity="company" filters={filters} view={view} basePath="/firmen" />
      {error && <p className="text-sm text-destructive">{error.message}</p>}
      {view === "board" ? (
        <Board
          entity="company"
          columns={COMPANY_STAGES}
          cards={rows.map((f): BoardCard => ({
            id: f.id, stage: f.stage, title: f.name,
            subtitle: [f.industry, f.open_jobs ? `${f.open_jobs} Stelle${f.open_jobs > 1 ? "n" : ""}` : null].filter(Boolean).join(" · ") || null,
            priority: f.priority, city: [f.plz, f.city].filter(Boolean).join(" ") || null,
            next_action: f.next_action, next_action_date: f.next_action_date, missing_next_action: f.missing_next_action,
            overdue: f.overdue, days_since_activity: f.days_since_activity, active_presentations: f.active_presentations,
          }))}
        />
      ) : (
        <CompanyTable rows={rows} />
      )}
    </div>
  );
}
