import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { CompanyForm, CompanyStageControl, ContactsPanel, JobsPanel } from "@/components/company-forms";
import { CompleteActionButton } from "@/components/complete-action";
import { Timeline } from "@/components/timeline";
import { Badge, PriorityBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { CANDIDATE_STAGE_LABELS } from "@/lib/constants";
import { supabaseServer } from "@/lib/supabase/server";
import type { Activity, CompanyCard, Contact, Job } from "@/lib/types";
import { fmtDate } from "@/lib/utils";

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();
  const { data: f } = await sb.from("company_cards").select("*").eq("id", id).maybeSingle();
  if (!f) notFound();
  const company = f as CompanyCard;

  const [contacts, jobs, pres, acts, blocks, sisters] = await Promise.all([
    sb.from("contacts").select("*").eq("company_id", id).order("name"),
    sb.from("jobs").select("*").eq("company_id", id).order("status").order("title"),
    sb.from("presentations").select("id, sent_date, status, anonymous, candidate_id, candidates(k_nr, first_name, last_name, stage), jobs(title)")
      .eq("company_id", id).order("sent_date", { ascending: false }),
    sb.from("activities").select("*").eq("entity_type", "company").eq("entity_id", id).order("occurred_at", { ascending: false }).limit(200),
    sb.from("blocklist").select("*").eq("company_id", id),
    company.group_name
      ? sb.from("companies").select("id, name").ilike("group_name", company.group_name).neq("id", id)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);

  type PresRow = { id: string; sent_date: string; status: string; anonymous: boolean; candidate_id: string;
    candidates: { k_nr: string; first_name: string | null; last_name: string | null; stage: string } | null; jobs: { title: string } | null };

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold">{company.name}</h1>
            <PriorityBadge priority={company.priority} />
            {company.group_name && <Badge variant="outline">Gruppe: {company.group_name}</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            {[company.legal_name, [company.plz, company.city].filter(Boolean).join(" "), company.industry, company.size].filter(Boolean).join(" · ")}
          </p>
          <div className="mt-1 flex flex-wrap gap-3 text-sm">
            {company.website && <a href={company.website} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-primary hover:underline"><ExternalLink className="size-3.5" />Website</a>}
            {company.careers_url && <a href={company.careers_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-primary hover:underline"><ExternalLink className="size-3.5" />Karriereseite</a>}
          </div>
        </div>
        <CompanyStageControl id={id} name={company.name} stage={company.stage} />
      </div>

      {(blocks.data ?? []).map((b) => <Notice key={b.id} kind="stop">Gesperrt ({b.type}): {b.reason}</Notice>)}
      {(sisters.data ?? []).length > 0 && (
        <Notice kind="hint">
          Schwesterfirmen: {(sisters.data ?? []).map((s, i) => (
            <span key={s.id}>{i > 0 && ", "}<Link href={`/firmen/${s.id}`} className="underline">{s.name}</Link></span>
          ))} – Vorstellungen dort werden bei Doppelprüfung berücksichtigt.
        </Notice>
      )}

      <Card>
        <CardBody className="flex flex-wrap items-center gap-4 py-3">
          <div className={company.missing_next_action || company.overdue ? "text-red-600 dark:text-red-400" : ""}>
            <p className="text-xs text-muted-foreground">Nächste Aktion</p>
            <p className="font-medium">{company.missing_next_action ? "Keine Wiedervorlage" : `${company.next_action ?? "–"} · ${fmtDate(company.next_action_date)}`}</p>
          </div>
          <div><p className="text-xs text-muted-foreground">Konditionen</p><p>{company.fee_agreed ?? "–"}{company.agb_sent_date ? ` · AGB ${fmtDate(company.agb_sent_date)}` : ""}</p></div>
          <div><p className="text-xs text-muted-foreground">Zahlt Vermittler</p><p>{company.pays_agencies ?? "–"}</p></div>
          <div><p className="text-xs text-muted-foreground">Letzte Aktivität</p><p>{company.days_since_activity} Tage</p></div>
          <div className="ml-auto"><CompleteActionButton entityType="company" id={id} name={company.name} currentAction={company.next_action} /></div>
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_24rem]">
        <div className="space-y-4">
          <Card>
            <CardHeader title={`Offene Stellen (${company.open_jobs})`} />
            <CardBody><JobsPanel companyId={id} jobs={(jobs.data ?? []) as Job[]} /></CardBody>
          </Card>
          <Card>
            <CardHeader title={`Vorgestellte Kandidaten (${(pres.data ?? []).length})`} />
            <CardBody className="py-1">
              <ul className="divide-y divide-border text-sm">
                {(pres.data ?? []).length === 0 && <li className="py-2 text-muted-foreground">Noch niemand vorgestellt.</li>}
                {((pres.data ?? []) as unknown as PresRow[]).map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-2 py-2">
                    <Link href={`/kandidaten/${p.candidate_id}`} className="font-medium hover:underline">
                      {[p.candidates?.first_name, p.candidates?.last_name].filter(Boolean).join(" ") || p.candidates?.k_nr}
                    </Link>
                    <span className="text-xs text-muted-foreground">{p.candidates?.k_nr}</span>
                    {p.jobs?.title && <span className="text-xs text-muted-foreground">· {p.jobs.title}</span>}
                    {p.anonymous && <Badge>anonym</Badge>}
                    <span className="ml-auto text-xs">{fmtDate(p.sent_date)}</span>
                    <Badge variant={p.status === "absage" ? "default" : "primary"}>{p.status}</Badge>
                    <Badge variant="outline">{CANDIDATE_STAGE_LABELS[p.candidates?.stage ?? ""] ?? ""}</Badge>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Zeitstrahl" />
            <CardBody><Timeline entityType="company" entityId={id} activities={(acts.data ?? []) as Activity[]} /></CardBody>
          </Card>
          <Card>
            <CardHeader title="Stammdaten & Konditionen" />
            <CardBody><CompanyForm company={company} /></CardBody>
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Ansprechpartner" />
            <CardBody><ContactsPanel companyId={id} contacts={(contacts.data ?? []) as Contact[]} /></CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
