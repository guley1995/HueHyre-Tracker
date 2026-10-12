import Link from "next/link";
import { AlertCircle, CalendarCheck, Moon } from "lucide-react";
import { CompleteActionButton } from "@/components/complete-action";
import { Badge, PriorityBadge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { CANDIDATE_STAGE_LABELS, COMPANY_STAGE_LABELS } from "@/lib/constants";
import { supabaseServer } from "@/lib/supabase/server";
import type { TodayItem } from "@/lib/types";
import { cn, fmtDate } from "@/lib/utils";

export const metadata = { title: "Heute" };

export default async function TodayPage() {
  const sb = await supabaseServer();
  const { data, error } = await sb.from("today_items").select("*")
    .order("next_action_date", { ascending: true, nullsFirst: true }).order("priority").range(0, 4999);
  const items = (data ?? []) as TodayItem[];
  const due = items.filter((i) => i.bucket === "heute");
  const overdue = items.filter((i) => i.bucket === "ueberfaellig" || i.bucket === "ohne_datum");
  const asleep = items.filter((i) => i.bucket === "eingeschlafen").sort((a, b) => b.days_since_activity - a.days_since_activity);
  const today = new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Berlin" });

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-xl font-bold">Heute</h1>
        <p className="text-sm text-muted-foreground">{today}</p>
      </div>
      {error && <p className="text-sm text-destructive">{error.message}</p>}
      <TodayList title="Fällig heute" icon={<CalendarCheck className="size-4 text-primary" />} items={due} empty="Nichts fällig heute." />
      <TodayList title="Überfällig / ohne Wiedervorlage" icon={<AlertCircle className="size-4 text-red-600" />} items={overdue} empty="Nichts überfällig." red />
      <TodayList title="Eingeschlafen (14+ Tage ohne Aktivität)" icon={<Moon className="size-4 text-amber-600" />} items={asleep} empty="Keine eingeschlafenen Karten." />
    </div>
  );
}

function TodayList({ title, icon, items, empty, red }: { title: string; icon: React.ReactNode; items: TodayItem[]; empty: string; red?: boolean }) {
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2">{icon}{title}<Badge>{items.length}</Badge></span>} />
      <ul className="divide-y divide-border">
        {items.length === 0 && <li className="px-4 py-3 text-sm text-muted-foreground">{empty}</li>}
        {items.map((i) => {
          const href = i.entity_type === "candidate" ? `/kandidaten/${i.id}` : `/firmen/${i.id}`;
          const stage = (i.entity_type === "candidate" ? CANDIDATE_STAGE_LABELS : COMPANY_STAGE_LABELS)[i.stage] ?? i.stage;
          return (
            <li key={`${i.bucket}-${i.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Link href={href} className="font-medium hover:underline">{i.label || i.ref}</Link>
                  {i.ref && <span className="text-xs text-muted-foreground">{i.ref}</span>}
                  <Badge variant="outline">{i.entity_type === "candidate" ? "Kandidat" : "Firma"} · {stage}</Badge>
                  <PriorityBadge priority={i.priority} />
                </div>
                <p className={cn("text-sm", red && (i.bucket === "ohne_datum" || i.bucket === "ueberfaellig") && "text-red-600 dark:text-red-400")}>
                  {i.bucket === "ohne_datum" ? "Keine Wiedervorlage gesetzt" : `${i.next_action ?? "Aktion"} · ${fmtDate(i.next_action_date)}`}
                  <span className="ml-2 text-xs text-muted-foreground">{i.days_since_activity} Tage still{i.city ? ` · ${i.city}` : ""}</span>
                </p>
              </div>
              <CompleteActionButton entityType={i.entity_type} id={i.id} name={i.label} currentAction={i.next_action} />
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
