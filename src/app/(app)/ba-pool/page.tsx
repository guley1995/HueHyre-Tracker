import { BaTable } from "./ba-table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabaseServer } from "@/lib/supabase/server";
import type { BaProfile } from "@/lib/types";

export const metadata = { title: "BA-Pool" };

export default async function BaPoolPage({ searchParams }: { searchParams: Promise<{ q?: string; offen?: string }> }) {
  const { q, offen } = await searchParams;
  const sb = await supabaseServer();
  let query = sb.from("ba_profiles").select("*").order("contacted_date", { ascending: false, nullsFirst: false }).order("ref_no");
  if (q?.trim()) {
    const s = q.trim().replace(/[,()*%\\]/g, " ");
    query = query.or(`ref_no.ilike.%${s}%,search.ilike.%${s}%,qualification.ilike.%${s}%,city.ilike.%${s}%`);
  }
  if (offen) query = query.is("candidate_id", null).is("contacted_date", null);
  const { data } = await query.range(0, 4999);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">BA-Pool</h1>
        <p className="text-sm text-muted-foreground">Anonyme Profile aus der Bewerberbörse. Antwortet jemand, per Klick zum Kandidaten machen.</p>
      </div>
      <form action="/ba-pool" className="flex flex-wrap items-center gap-2">
        <Input name="q" defaultValue={q} placeholder="Ref.-Nr., Suche, Qualifikation, Ort" className="w-72" />
        <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="offen" value="1" defaultChecked={!!offen} /> noch nicht kontaktiert</label>
        <Button variant="secondary" size="sm">Filtern</Button>
      </form>
      <BaTable rows={(data ?? []) as BaProfile[]} />
    </div>
  );
}
