import Link from "next/link";
import { Download } from "lucide-react";
import { BlocklistManager, DeletionList } from "./settings-client";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AGENT_ACTIONS } from "@/lib/agent/handlers";
import { CATEGORIES } from "@/lib/constants";
import { supabaseServer } from "@/lib/supabase/server";
import type { BlocklistEntry } from "@/lib/types";
import { fmtDate } from "@/lib/utils";

export const metadata = { title: "Einstellungen" };

export default async function SettingsPage() {
  const sb = await supabaseServer();
  const [blocks, companies, due, exports] = await Promise.all([
    sb.from("blocklist").select("*, candidates(k_nr, first_name, last_name), companies(name)").order("type").order("name"),
    sb.from("companies").select("id, name").order("name").range(0, 4999),
    sb.from("deletion_due").select("*").order("delete_after"),
    sb.storage.from("exports").list("", { limit: 40, sortBy: { column: "name", order: "desc" } }),
  ]);
  const days = (exports.data ?? []).map((f) => f.name).filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n)).sort().reverse().slice(0, 10);
  const exportLinks = await Promise.all(days.map(async (d) => {
    const { data } = await sb.storage.from("exports").createSignedUrl(`${d}/HueHYRE_Tracker_${d}.xlsx`, 600);
    return { day: d, url: data?.signedUrl ?? null };
  }));

  type BlockJoin = BlocklistEntry & { candidates: { k_nr: string; first_name: string | null; last_name: string | null } | null; companies: { name: string } | null };

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <h1 className="text-xl font-bold">Einstellungen</h1>

      <Card>
        <CardHeader title="Sperrliste (Sperren & Tabus)" />
        <CardBody>
          <BlocklistManager
            rows={((blocks.data ?? []) as BlockJoin[]).map((b) => ({
              ...b,
              candidate_label: b.candidates ? `${b.candidates.k_nr} ${[b.candidates.first_name, b.candidates.last_name].filter(Boolean).join(" ")}` : null,
              company_label: b.companies?.name ?? null,
            }))}
            companies={(companies.data ?? []).map((c) => ({ id: c.id as string, label: c.name as string }))}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Export" action={
          <a href="/api/export?table=all" className="flex items-center gap-1 text-sm text-primary hover:underline"><Download className="size-4" /> Jetzt alles als Excel</a>
        } />
        <CardBody>
          <p className="mb-2 text-sm text-muted-foreground">
            Täglich um 2:00 Uhr (Sommerzeit; im Winter 1:00 Uhr) landet ein Export im Storage „exports“. Das Sync-Skript auf dem Mac kopiert ihn nach
            <code className="mx-1 rounded bg-muted px-1">Tracker-Export/</code>und behält 30 Stände.
          </p>
          <ul className="flex flex-wrap gap-2 text-sm">
            {exportLinks.length === 0 && <li className="text-muted-foreground">Noch keine nächtlichen Exporte.</li>}
            {exportLinks.map((e) => (
              <li key={e.day}>{e.url ? <a href={e.url} className="text-primary hover:underline">{fmtDate(e.day)}</a> : fmtDate(e.day)}</li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={`Löschfrist erreicht (${(due.data ?? []).length})`} />
        <CardBody>
          <DeletionList rows={(due.data ?? []) as { id: string; k_nr: string; full_name: string; stage: string; delete_after: string }[]} />
        </CardBody>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader title="Kategorien" />
          <CardBody className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((c) => <Badge key={c}>{c}</Badge>)}
            <p className="mt-2 w-full text-xs text-muted-foreground">Änderungen über eine Migration (Check-Constraint candidates.category) und src/lib/constants.ts.</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Claude-Zugang (Agent-API)" />
          <CardBody className="space-y-2 text-sm">
            <p>Endpunkt: <code className="rounded bg-muted px-1">POST /api/agent/&lt;aktion&gt;</code> mit <code className="rounded bg-muted px-1">Authorization: Bearer AGENT_API_KEY</code>. Kein Löschen.</p>
            <div className="flex flex-wrap gap-1">{AGENT_ACTIONS.map((a) => <Badge key={a} variant="outline">{a}</Badge>)}</div>
            <p className="text-xs text-muted-foreground">Alles, was Claude schreibt, erscheint im Zeitstrahl mit „Claude“. Details: README, Abschnitt „Claude-Zugang“. <Link href="/api/agent" className="underline">Schema</Link> (braucht den Schlüssel).</p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
