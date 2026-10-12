import { notFound } from "next/navigation";
import { Mail, Phone } from "lucide-react";
import {
  BlocksPanel, CandidateForm, FilesPanel, MergeDialog, PresentationsPanel, SelfApplicationsPanel, StageControl,
} from "@/components/candidate-detail";
import { CompleteActionButton } from "@/components/complete-action";
import { PresentDialog } from "@/components/present-dialog";
import { Timeline } from "@/components/timeline";
import { Badge, PriorityBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { supabaseServer } from "@/lib/supabase/server";
import type { Activity, BlocklistEntry, CandidateCard, Placement, Presentation, SelfApplication } from "@/lib/types";
import { fmtDate } from "@/lib/utils";

export default async function CandidatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();
  const { data: c } = await sb.from("candidate_cards").select("*").eq("id", id).maybeSingle();
  if (!c) notFound();
  const cand = c as CandidateCard;

  const [pres, self, acts, blocks, companies, dups, files] = await Promise.all([
    sb.from("presentations").select("*, companies(name), jobs(title), placements(*)").eq("candidate_id", id).order("sent_date", { ascending: false }),
    sb.from("self_applications").select("*").eq("candidate_id", id).order("date", { ascending: false }),
    sb.from("activities").select("*").eq("entity_type", "candidate").eq("entity_id", id).order("occurred_at", { ascending: false }).limit(200),
    sb.from("blocklist").select("*, companies(name)").eq("candidate_id", id),
    sb.from("companies").select("id, name, city, stage").neq("stage", "tabu").order("name").range(0, 4999),
    sb.rpc("find_duplicate_candidates", {
      p_email: cand.email, p_phone: cand.phone, p_first_name: cand.first_name, p_last_name: cand.last_name,
      p_plz: cand.plz, p_city: cand.city, p_exclude_id: id,
    }),
    sb.storage.from("cvs").list(cand.k_nr, { sortBy: { column: "created_at", order: "desc" } }),
  ]);

  const fileRows = await Promise.all(
    (files.data ?? []).filter((f) => f.name !== ".emptyFolderPlaceholder").map(async (f) => {
      const path = `${cand.k_nr}/${f.name}`;
      const { data } = await sb.storage.from("cvs").createSignedUrl(path, 3600);
      return { path, name: f.name, url: data?.signedUrl ?? null };
    }),
  );

  type PresJoin = Presentation & { companies: { name: string } | null; jobs: { title: string } | null; placements: Placement[] | Placement | null };
  const presRows = ((pres.data ?? []) as PresJoin[]).map((p) => ({
    ...p,
    company_name: p.companies?.name ?? "?",
    job_title: p.jobs?.title ?? null,
    placement: Array.isArray(p.placements) ? (p.placements[0] ?? null) : p.placements,
  }));
  const companyOptions = (companies.data ?? []).map((f) => ({ id: f.id as string, label: `${f.name}${f.city ? ` (${f.city})` : ""}` }));
  const blockRows = ((blocks.data ?? []) as (BlocklistEntry & { companies: { name: string } | null })[])
    .map((b) => ({ ...b, company_name: b.companies?.name ?? null }));
  const duplicates = (dups.data ?? []) as { id: string; k_nr: string; name: string; match: string }[];

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold">{cand.full_name || "(ohne Namen)"}</h1>
            <Badge variant="outline">{cand.k_nr}</Badge>
            {cand.legacy_k_nrs.length > 0 && <span className="text-xs text-muted-foreground">alt: {cand.legacy_k_nrs.join(", ")}</span>}
            <PriorityBadge priority={cand.priority} />
            {cand.category && <Badge>{cand.category}</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            {[cand.profile_title, [cand.plz, cand.city].filter(Boolean).join(" "), cand.source && `Quelle: ${cand.source}`].filter(Boolean).join(" · ")}
          </p>
          <div className="mt-1 flex flex-wrap gap-3 text-sm">
            {cand.email && <a href={`mailto:${cand.email}`} className="flex items-center gap-1 text-primary hover:underline"><Mail className="size-3.5" />{cand.email}</a>}
            {cand.phone && <a href={`tel:${cand.phone}`} className="flex items-center gap-1 text-primary hover:underline"><Phone className="size-3.5" />{cand.phone}</a>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StageControl id={id} name={cand.full_name} stage={cand.stage} />
          <PresentDialog candidateId={id} candidateName={cand.full_name || cand.k_nr} companies={companyOptions} consentDate={cand.consent_date} />
        </div>
      </div>

      {duplicates.length > 0 && (
        <Notice kind="confirm" className="items-center">
          Mögliche Dublette: {duplicates.map((d) => `${d.k_nr} ${d.name} (${d.match === "email" ? "E-Mail" : d.match === "phone" ? "Telefon" : "Name+Ort"})`).join(", ")}
          <span className="ml-2 inline-block"><MergeDialog keepId={id} keepKnr={cand.k_nr} duplicates={duplicates} /></span>
        </Notice>
      )}
      {blockRows.length > 0 && <Notice kind="stop">Dieser Kandidat hat Sperren – siehe unten.</Notice>}

      <Card>
        <CardBody className="flex flex-wrap items-center gap-3 py-3">
          <div className={cand.missing_next_action || cand.overdue ? "text-red-600 dark:text-red-400" : ""}>
            <p className="text-xs text-muted-foreground">Nächste Aktion</p>
            <p className="font-medium">{cand.missing_next_action ? "Keine Wiedervorlage" : `${cand.next_action ?? "–"} · ${fmtDate(cand.next_action_date)}`}</p>
          </div>
          <div><p className="text-xs text-muted-foreground">Letzte Aktivität</p><p>{cand.days_since_activity} Tage</p></div>
          <div><p className="text-xs text-muted-foreground">Einwilligung</p><p>{cand.consent_date ? `${fmtDate(cand.consent_date)}${cand.consent_scope ? ` (${cand.consent_scope})` : ""}` : "fehlt"}</p></div>
          <div><p className="text-xs text-muted-foreground">Gehalt / verfügbar</p><p>{cand.salary_wish ?? "–"} / {cand.available_from ?? "–"}</p></div>
          <div className="ml-auto"><CompleteActionButton entityType="candidate" id={id} name={cand.full_name} currentAction={cand.next_action} /></div>
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_24rem]">
        <div className="space-y-4">
          <Card>
            <CardHeader title={`Vorstellungen (${presRows.length})`} />
            <CardBody className="py-1"><PresentationsPanel rows={presRows} /></CardBody>
          </Card>
          <Card>
            <CardHeader title="Zeitstrahl" />
            <CardBody><Timeline entityType="candidate" entityId={id} activities={(acts.data ?? []) as Activity[]} /></CardBody>
          </Card>
          <Card>
            <CardHeader title="Stammdaten" />
            <CardBody><CandidateForm candidate={cand} /></CardBody>
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader title="CV & Dateien" />
            <CardBody><FilesPanel candidateId={id} files={fileRows} mainFile={cand.cv_file} /></CardBody>
          </Card>
          <Card>
            <CardHeader title="Selbst beworben bei" />
            <CardBody><SelfApplicationsPanel candidateId={id} rows={(self.data ?? []) as SelfApplication[]} /></CardBody>
          </Card>
          <Card>
            <CardHeader title="Sperren" />
            <CardBody><BlocksPanel candidateId={id} name={cand.full_name} blocks={blockRows} companies={companyOptions} /></CardBody>
          </Card>
          {duplicates.length === 0 && (
            <div className="flex justify-end"><MergeDialog keepId={id} keepKnr={cand.k_nr} duplicates={[]} /></div>
          )}
        </div>
      </div>
    </div>
  );
}
