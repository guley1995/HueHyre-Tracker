import Link from "next/link";
import { Briefcase, Plus, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CANDIDATE_STAGE_LABELS, COMPANY_STAGE_LABELS } from "@/lib/constants";
import { supabaseServer } from "@/lib/supabase/server";

export const metadata = { title: "Suche" };

type Hit = { entity_type: "candidate" | "company"; id: string; label: string; sublabel: string | null; stage: string };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  let hits: Hit[] = [];
  if (q.trim().length >= 2) {
    const sb = await supabaseServer();
    const { data } = await sb.rpc("global_search", { p_query: q.trim(), p_limit: 40 });
    hits = (data ?? []) as Hit[];
  }
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <form action="/suche" className="flex gap-2">
        <Input name="q" defaultValue={q} placeholder="Name, K-Nr., Firma, Telefon, E-Mail …" autoFocus className="h-10" />
        <Button type="submit" className="h-10">Suchen</Button>
      </form>
      {q && <p className="text-sm text-muted-foreground">{hits.length} Treffer für „{q}“</p>}
      <ul className="divide-y divide-border rounded-lg border border-border">
        {hits.map((h) => (
          <li key={`${h.entity_type}-${h.id}-${h.label}`}>
            <Link href={h.entity_type === "candidate" ? `/kandidaten/${h.id}` : `/firmen/${h.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50">
              {h.entity_type === "candidate" ? <User className="size-4 text-muted-foreground" /> : <Briefcase className="size-4 text-muted-foreground" />}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{h.label}</p>
                {h.sublabel && <p className="truncate text-xs text-muted-foreground">{h.sublabel}</p>}
              </div>
              <Badge variant="outline">{(h.entity_type === "candidate" ? CANDIDATE_STAGE_LABELS : COMPANY_STAGE_LABELS)[h.stage] ?? h.stage}</Badge>
            </Link>
          </li>
        ))}
      </ul>
      {q && hits.length === 0 && (
        <Link href={`/neu?name=${encodeURIComponent(q)}`} className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
          <Plus className="size-4" /> „{q}“ als neuen Kandidaten anlegen
        </Link>
      )}
    </div>
  );
}
