import Link from "next/link";
import { Download, KanbanSquare, Table2 } from "lucide-react";
import { CANDIDATE_SOURCES, CATEGORIES, COMPANY_SOURCES, PRIORITIES } from "@/lib/constants";
import { filtersToQuery, type BoardFilters } from "@/lib/filters";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Filterleiste über beiden Boards (GET-Formular, damit Filter in der URL stehen). */
export function FilterBar({ entity, filters, view, basePath }: {
  entity: "candidate" | "company"; filters: BoardFilters; view: "board" | "tabelle"; basePath: string;
}) {
  const qs = filtersToQuery(filters);
  const table = entity === "candidate" ? "candidates" : "companies";
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <form className="flex flex-wrap items-center gap-2" action={basePath}>
        <input type="hidden" name="view" value={view} />
        <Input name="q" defaultValue={filters.q} placeholder="Filter …" className="w-36" />
        <Select name="prio" defaultValue={filters.prio ?? ""} className="w-24">
          <option value="">Prio</option>
          {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
        </Select>
        {entity === "candidate" && (
          <Select name="kategorie" defaultValue={filters.kategorie ?? ""} className="w-32">
            <option value="">Kategorie</option>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </Select>
        )}
        <Input name="region" defaultValue={filters.region} placeholder="PLZ/Ort" className="w-28" />
        <Select name="quelle" defaultValue={filters.quelle ?? ""} className="w-36">
          <option value="">Quelle</option>
          {(entity === "candidate" ? CANDIDATE_SOURCES : COMPANY_SOURCES).map((s) => <option key={s}>{s}</option>)}
        </Select>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" name="ueberfaellig" value="1" defaultChecked={!!filters.ueberfaellig} /> überfällig
        </label>
        <Button type="submit" variant="secondary" size="sm">Filtern</Button>
        {qs && <Link href={`${basePath}?view=${view}`} className="text-xs text-muted-foreground underline">zurücksetzen</Link>}
      </form>
      <div className="ml-auto flex items-center gap-1">
        <Link href={`${basePath}?${qs}${qs ? "&" : ""}view=board`}
          className={cn("flex items-center gap-1 rounded-md px-2 py-1 text-sm", view === "board" ? "bg-muted font-medium" : "text-muted-foreground")}>
          <KanbanSquare className="size-4" /> Board
        </Link>
        <Link href={`${basePath}?${qs}${qs ? "&" : ""}view=tabelle`}
          className={cn("flex items-center gap-1 rounded-md px-2 py-1 text-sm", view === "tabelle" ? "bg-muted font-medium" : "text-muted-foreground")}>
          <Table2 className="size-4" /> Tabelle
        </Link>
        <a href={`/api/export?table=${table}${qs ? "&" + qs : ""}`}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted">
          <Download className="size-4" /> Excel
        </a>
      </div>
    </div>
  );
}
