"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, ExternalLink, Pencil, Plus } from "lucide-react";
import { checkJob, moveCompany, saveCompany, saveContact, saveJob } from "@/app/actions";
import { COMPANY_SOURCES, COMPANY_STAGE_LABELS, JOB_SOURCE_TYPES, JOB_STATUSES, PRIORITIES } from "@/lib/constants";
import type { Company, Contact, Job } from "@/lib/types";
import { StageDialog, type StageMove } from "@/components/stage-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { fmtDate, todayIso } from "@/lib/utils";

type Values = Record<string, string>;

function toValues(o: object | null, keys: string[]): Values {
  const rec = (o ?? {}) as Record<string, unknown>;
  return Object.fromEntries(keys.map((k) => [k, rec[k] == null ? "" : String(rec[k])]));
}

const COMPANY_KEYS = ["name", "legal_name", "group_name", "city", "plz", "industry", "size", "website", "careers_url",
  "priority", "pays_agencies", "fee_agreed", "agb_sent_date", "next_action", "next_action_date", "source", "notes"];

function CompanyFields({ v, set }: { v: Values; set: (k: string, val: string) => void }) {
  const text: [string, string, string?][] = [
    ["name", "Name"], ["legal_name", "Firmierung"], ["group_name", "Gruppe (Schwesterfirmen)"], ["plz", "PLZ"], ["city", "Ort"],
    ["industry", "Branche"], ["size", "Größe"], ["website", "Website"], ["careers_url", "Karriereseite"],
    ["fee_agreed", "Honorar vereinbart"], ["agb_sent_date", "AGB verschickt", "date"], ["next_action", "Nächste Aktion"],
    ["next_action_date", "Datum", "date"],
  ];
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {text.map(([k, label, type]) => (
          <Field key={k} label={label}>
            <Input type={type ?? "text"} value={v[k] ?? ""} onChange={(e) => set(k, e.target.value)} />
          </Field>
        ))}
        <Field label="Priorität">
          <Select value={v.priority ?? ""} onChange={(e) => set("priority", e.target.value)}>
            <option value="">–</option>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}
          </Select>
        </Field>
        <Field label="Zahlt Vermittler">
          <Select value={v.pays_agencies ?? ""} onChange={(e) => set("pays_agencies", e.target.value)}>
            <option value="">–</option><option>ja</option><option>nein</option><option>unklar</option>
          </Select>
        </Field>
        <Field label="Quelle">
          <Select value={v.source ?? ""} onChange={(e) => set("source", e.target.value)}>
            <option value="">–</option>{COMPANY_SOURCES.map((s) => <option key={s}>{s}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Notizen"><Textarea value={v.notes ?? ""} onChange={(e) => set("notes", e.target.value)} /></Field>
    </>
  );
}

export function CompanyForm({ company }: { company: Company }) {
  const router = useRouter();
  const [v, setV] = useState(() => toValues(company, COMPANY_KEYS));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <form className="space-y-3" onSubmit={(e) => {
      e.preventDefault();
      start(async () => {
        const r = await saveCompany(company.id, v);
        setMsg(r.ok ? { ok: true, text: "Gespeichert." } : { ok: false, text: r.message ?? "Fehler" });
        if (r.ok) router.refresh();
      });
    }}>
      <CompanyFields v={v} set={(k, val) => setV((s) => ({ ...s, [k]: val }))} />
      <div className="flex items-center justify-end gap-3">
        {msg && <span className={msg.ok ? "text-sm text-emerald-600" : "text-sm text-destructive"}>{msg.text}</span>}
        <Button disabled={pending}>Speichern</Button>
      </div>
    </form>
  );
}

export function NewCompanyButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<Values>({ source: "Leadliste" });
  const [error, setError] = useState<{ text: string; id?: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm"><Plus /> Firma</Button></DialogTrigger>
      <DialogContent title="Neue Firma" className="max-w-2xl">
        <form className="space-y-3" onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await saveCompany(null, v);
            if (!r.ok) return setError({ text: r.message ?? "Fehler", id: r.id });
            setOpen(false);
            router.push(`/firmen/${r.id}`);
          });
        }}>
          <CompanyFields v={v} set={(k, val) => setV((s) => ({ ...s, [k]: val }))} />
          {error && (
            <Notice kind="stop">
              {error.text} {error.id && <Link className="underline" href={`/firmen/${error.id}`}>öffnen</Link>}
            </Notice>
          )}
          <div className="flex justify-end"><Button disabled={pending}>Anlegen</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CompanyStageControl({ id, name, stage }: { id: string; name: string; stage: string }) {
  const router = useRouter();
  const [move, setMove] = useState<StageMove | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-2">
      <Select value={stage} disabled={pending} className="w-44" onChange={(e) => {
        const target = e.target.value;
        start(async () => {
          const r = await moveCompany(id, target);
          if (r.ok) { setError(null); return router.refresh(); }
          if (r.missing?.length) setMove({ entity: "company", id, name, stage: target, missing: r.missing });
          else setError(r.message ?? "Fehler");
        });
      }}>
        {Object.entries(COMPANY_STAGE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </Select>
      {error && <span className="text-sm text-destructive">{error}</span>}
      <StageDialog move={move} onClose={() => setMove(null)} onDone={() => router.refresh()} />
    </div>
  );
}

// ------------------------------------------------------------- Ansprechpartner

const CONTACT_KEYS = ["name", "role", "email", "phone", "linkedin", "notes"];

export function ContactsPanel({ companyId, contacts }: { companyId: string; contacts: Contact[] }) {
  return (
    <div className="space-y-2">
      {contacts.length === 0 && <p className="text-sm text-muted-foreground">Noch keine Ansprechpartner.</p>}
      <ul className="space-y-2 text-sm">
        {contacts.map((c) => (
          <li key={c.id} className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{c.name}{c.role && <span className="font-normal text-muted-foreground"> · {c.role}</span>}</p>
              <p className="flex flex-wrap gap-x-3 text-xs">
                {c.email && <a href={`mailto:${c.email}`} className="text-primary hover:underline">{c.email}</a>}
                {c.phone && <a href={`tel:${c.phone}`} className="text-primary hover:underline">{c.phone}</a>}
                {c.linkedin && <a href={c.linkedin} target="_blank" rel="noreferrer" className="text-primary hover:underline">LinkedIn</a>}
              </p>
              {c.notes && <p className="text-xs text-muted-foreground">{c.notes}</p>}
            </div>
            <ContactDialog companyId={companyId} contact={c} />
          </li>
        ))}
      </ul>
      <ContactDialog companyId={companyId} contact={null} />
    </div>
  );
}

function ContactDialog({ companyId, contact }: { companyId: string; contact: Contact | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(() => toValues(contact, CONTACT_KEYS));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {contact ? <Button variant="ghost" size="icon" title="Bearbeiten"><Pencil /></Button> : <Button variant="outline" size="sm"><Plus /> Ansprechpartner</Button>}
      </DialogTrigger>
      <DialogContent title={contact ? contact.name : "Neuer Ansprechpartner"}>
        <form className="space-y-3" onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await saveContact(companyId, contact?.id ?? null, v);
            if (!r.ok) return setError(r.message ?? "Fehler");
            setOpen(false);
            if (!contact) setV(toValues(null, CONTACT_KEYS));
            router.refresh();
          });
        }}>
          {([["name", "Name"], ["role", "Rolle"], ["email", "E-Mail"], ["phone", "Telefon"], ["linkedin", "LinkedIn"]] as const).map(([k, l]) => (
            <Field key={k} label={l}><Input value={v[k]} onChange={(e) => setV((s) => ({ ...s, [k]: e.target.value }))} /></Field>
          ))}
          <Field label="Notizen"><Textarea value={v.notes} onChange={(e) => setV((s) => ({ ...s, notes: e.target.value }))} /></Field>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end"><Button disabled={pending}>Speichern</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------- Stellen

const JOB_KEYS = ["title", "city", "url", "source_type", "salary_range", "posted_date", "last_checked_date", "status", "ref_no", "notes"];

export function JobsPanel({ companyId, jobs }: { companyId: string; jobs: Job[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const stale = (d: string | null) => !d || d < new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  return (
    <div className="space-y-2">
      {jobs.length === 0 && <p className="text-sm text-muted-foreground">Keine Stellen erfasst.</p>}
      <ul className="divide-y divide-border text-sm">
        {jobs.map((j) => (
          <li key={j.id} className="flex flex-wrap items-center gap-2 py-1.5">
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {j.title}
                {j.url && <a href={j.url} target="_blank" rel="noreferrer" className="ml-1 inline-flex text-primary"><ExternalLink className="size-3.5" /></a>}
              </p>
              <p className="text-xs text-muted-foreground">
                {[j.city, j.source_type, j.salary_range, j.ref_no && `Ref ${j.ref_no}`].filter(Boolean).join(" · ")}
              </p>
            </div>
            <Badge variant={j.status === "online" ? "green" : "default"}>{j.status}</Badge>
            <Badge variant={stale(j.last_checked_date) ? "amber" : "default"} title="Letzter Stellencheck">geprüft {fmtDate(j.last_checked_date)}</Badge>
            <Button variant="ghost" size="sm" disabled={pending} title="Heute geprüft: noch online"
              onClick={() => start(async () => { await checkJob(j.id, companyId, "online"); router.refresh(); })}>
              <CheckCircle2 /> online
            </Button>
            <Button variant="ghost" size="sm" disabled={pending} title="Heute geprüft: offline"
              onClick={() => start(async () => { await checkJob(j.id, companyId, "offline"); router.refresh(); })}>
              offline
            </Button>
            <Link href={`/matching?job=${j.id}`} className="text-xs text-primary hover:underline">Matching</Link>
            <JobDialog companyId={companyId} job={j} />
          </li>
        ))}
      </ul>
      <JobDialog companyId={companyId} job={null} />
    </div>
  );
}

function JobDialog({ companyId, job }: { companyId: string; job: Job | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(() => (job ? toValues(job, JOB_KEYS) : { ...toValues(null, JOB_KEYS), status: "online", last_checked_date: todayIso() }));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: string, val: string) => setV((s) => ({ ...s, [k]: val }));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {job ? <Button variant="ghost" size="icon" title="Bearbeiten"><Pencil /></Button> : <Button variant="outline" size="sm"><Plus /> Stelle</Button>}
      </DialogTrigger>
      <DialogContent title={job ? job.title : "Neue Stelle"}>
        <form className="space-y-3" onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await saveJob(companyId, job?.id ?? null, v);
            if (!r.ok) return setError(r.message ?? "Fehler");
            setOpen(false);
            router.refresh();
          });
        }}>
          <Field label="Titel"><Input value={v.title} onChange={(e) => set("title", e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Ort"><Input value={v.city} onChange={(e) => set("city", e.target.value)} /></Field>
            <Field label="Gehalt"><Input value={v.salary_range} onChange={(e) => set("salary_range", e.target.value)} /></Field>
            <Field label="Art">
              <Select value={v.source_type} onChange={(e) => set("source_type", e.target.value)}>
                <option value="">–</option>{JOB_SOURCE_TYPES.map((s) => <option key={s}>{s}</option>)}
              </Select>
            </Field>
            <Field label="Status">
              <Select value={v.status} onChange={(e) => set("status", e.target.value)}>
                {JOB_STATUSES.map((s) => <option key={s}>{s}</option>)}
              </Select>
            </Field>
            <Field label="Veröffentlicht"><Input type="date" value={v.posted_date} onChange={(e) => set("posted_date", e.target.value)} /></Field>
            <Field label="Zuletzt geprüft"><Input type="date" value={v.last_checked_date} onChange={(e) => set("last_checked_date", e.target.value)} /></Field>
            <Field label="Ref.-Nr."><Input value={v.ref_no} onChange={(e) => set("ref_no", e.target.value)} /></Field>
          </div>
          <Field label="URL"><Input value={v.url} onChange={(e) => set("url", e.target.value)} /></Field>
          <Field label="Notizen"><Textarea value={v.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end"><Button disabled={pending}>Speichern</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
