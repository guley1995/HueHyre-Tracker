"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Trash2, Upload } from "lucide-react";
import {
  addBlock, addSelfApplication, deleteSelfApplication, mergeCandidates, moveCandidate, savePlacement, setMainCv,
  updateCandidate, updatePresentation, uploadCv,
} from "@/app/actions";
import { CANDIDATE_SOURCES, CANDIDATE_STAGE_LABELS, CATEGORIES, PRESENTATION_STATUSES, PRIORITIES } from "@/lib/constants";
import type { BlocklistEntry, Candidate, Placement, Presentation, SelfApplication } from "@/lib/types";
import { StageDialog, type StageMove } from "@/components/stage-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { fmtDate } from "@/lib/utils";

function useAction() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, start] = useTransition();
  function run(fn: () => Promise<{ ok: boolean; message?: string }>, after?: () => void) {
    setOk(false);
    start(async () => {
      const r = await fn();
      if (!r.ok) return setError(r.message ?? "Fehler");
      setError(null);
      setOk(true);
      after?.();
      router.refresh();
    });
  }
  return { error, ok, pending, run };
}

// ------------------------------------------------------------- Stammdaten

const TEXT_FIELDS: [keyof Candidate, string, string?][] = [
  ["first_name", "Vorname"], ["last_name", "Nachname"], ["email", "E-Mail", "email"], ["phone", "Telefon", "tel"],
  ["plz", "PLZ"], ["city", "Ort"], ["profile_title", "Profil/Titel"], ["salary_wish", "Gehaltswunsch"],
  ["available_from", "Verfügbar ab"], ["notice_period", "Kündigungsfrist"], ["radius_km", "Radius km", "number"],
  ["remote_wish", "Remote-Wunsch"], ["exclusions", "Ausschlüsse"], ["next_action", "Nächste Aktion"],
  ["next_action_date", "Datum nächste Aktion", "date"], ["consent_date", "Einwilligung am", "date"],
  ["consent_scope", "Einwilligung Umfang"], ["delete_after", "Löschen nach", "date"],
];

export function CandidateForm({ candidate }: { candidate: Candidate }) {
  const { error, ok, pending, run } = useAction();
  const [v, setV] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(candidate).map(([k, val]) => [k, val == null ? "" : String(val)])),
  );
  const set = (k: string, val: string) => setV((s) => ({ ...s, [k]: val }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data: Record<string, unknown> = {};
        for (const [k] of TEXT_FIELDS) data[k] = v[k];
        for (const k of ["category", "source", "priority", "skills", "notes"]) data[k] = v[k];
        data.radius_km = v.radius_km ? Number(v.radius_km) : null;
        run(() => updateCandidate(candidate.id, data));
      }}
      className="space-y-3"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TEXT_FIELDS.map(([k, label, type]) => (
          <Field key={k} label={label}>
            <Input type={type ?? "text"} value={v[k] ?? ""} onChange={(e) => set(k, e.target.value)} />
          </Field>
        ))}
        <Field label="Kategorie">
          <Select value={v.category ?? ""} onChange={(e) => set("category", e.target.value)}>
            <option value="">–</option>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </Select>
        </Field>
        <Field label="Quelle">
          <Select value={v.source ?? ""} onChange={(e) => set("source", e.target.value)}>
            <option value="">–</option>
            {CANDIDATE_SOURCES.map((c) => <option key={c}>{c}</option>)}
          </Select>
        </Field>
        <Field label="Priorität">
          <Select value={v.priority ?? ""} onChange={(e) => set("priority", e.target.value)}>
            <option value="">–</option>
            {PRIORITIES.map((c) => <option key={c}>{c}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Skills">
        <Textarea value={v.skills ?? ""} onChange={(e) => set("skills", e.target.value)} className="min-h-16" />
      </Field>
      <Field label="Notizen">
        <Textarea value={v.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
      </Field>
      {error && <Notice kind="stop">{error}</Notice>}
      <div className="flex items-center justify-end gap-3">
        {ok && <span className="text-sm text-emerald-600">Gespeichert.</span>}
        <Button type="submit" disabled={pending}>{pending ? "…" : "Speichern"}</Button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------- Spalte

export function StageControl({ id, name, stage }: { id: string; name: string; stage: string }) {
  const router = useRouter();
  const [move, setMove] = useState<StageMove | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-2">
      <Select
        value={stage}
        disabled={pending}
        className="w-44"
        onChange={(e) => {
          const target = e.target.value;
          start(async () => {
            const r = await moveCandidate(id, target);
            if (r.ok) { setError(null); return router.refresh(); }
            if (r.missing?.length) setMove({ entity: "candidate", id, name, stage: target, missing: r.missing });
            else setError(r.message ?? "Fehler");
          });
        }}
      >
        {Object.entries(CANDIDATE_STAGE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </Select>
      {error && <span className="text-sm text-destructive">{error}</span>}
      <StageDialog move={move} onClose={() => setMove(null)} onDone={() => router.refresh()} />
    </div>
  );
}

// ------------------------------------------------------------- Vorstellungen

type PresentationRow = Presentation & { company_name: string; job_title: string | null; placement: Placement | null };

export function PresentationsPanel({ rows }: { rows: PresentationRow[] }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">Noch keine Vorstellungen.</p>;
  return (
    <ul className="divide-y divide-border">
      {rows.map((p) => <PresentationItem key={p.id} p={p} />)}
    </ul>
  );
}

function PresentationItem({ p }: { p: PresentationRow }) {
  const { error, pending, run } = useAction();
  const [reason, setReason] = useState(p.rejection_reason ?? "");
  return (
    <li className="py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/firmen/${p.company_id}`} className="font-medium hover:underline">{p.company_name}</Link>
        {p.job_title && <span className="text-muted-foreground">· {p.job_title}</span>}
        <span className="text-xs text-muted-foreground">{fmtDate(p.sent_date)} · {p.channel ?? "–"}</span>
        {p.anonymous && <Badge>anonym</Badge>}
        <Select
          value={p.status}
          disabled={pending}
          className="ml-auto h-8 w-40"
          onChange={(e) => run(() => updatePresentation(p.id, { status: e.target.value, result_date: new Date().toISOString().slice(0, 10) }))}
        >
          {PRESENTATION_STATUSES.map((s) => <option key={s}>{s}</option>)}
        </Select>
      </div>
      {p.status === "absage" && (
        <div className="mt-1 flex gap-2">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Absagegrund" className="h-8" />
          <Button size="sm" variant="outline" onClick={() => run(() => updatePresentation(p.id, { status: p.status, rejection_reason: reason }))}>OK</Button>
        </div>
      )}
      {p.notes && <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{p.notes}</p>}
      {(p.status === "angebot" || p.status === "zusage" || p.placement) && <PlacementForm presentationId={p.id} placement={p.placement} />}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </li>
  );
}

function PlacementForm({ presentationId, placement }: { presentationId: string; placement: Placement | null }) {
  const { error, ok, pending, run } = useAction();
  const fields: [keyof Placement, string, string][] = [
    ["start_date", "Start", "date"], ["annual_salary", "Jahresgehalt €", "number"], ["fee_percent", "Honorar %", "number"],
    ["fee_amount", "Honorar €", "number"], ["invoice_date", "Rechnung am", "date"], ["paid_date", "Bezahlt am", "date"],
    ["guarantee_until", "Garantie bis", "date"], ["split_partner", "Split-Partner", "text"],
  ];
  const [v, setV] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map(([k]) => [k, placement?.[k] == null ? "" : String(placement[k])])),
  );
  return (
    <details className="mt-2 rounded-md border border-border p-2" open={!placement}>
      <summary className="cursor-pointer text-xs font-medium">Platzierung {placement ? "✓" : "erfassen"}</summary>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {fields.map(([k, label, type]) => (
          <Field key={k} label={label}>
            <Input type={type} value={v[k]} onChange={(e) => {
              const val = e.target.value;
              setV((s) => {
                const next = { ...s, [k]: val };
                if ((k === "annual_salary" || k === "fee_percent") && next.annual_salary && next.fee_percent) {
                  next.fee_amount = String(Math.round(Number(next.annual_salary) * Number(next.fee_percent)) / 100);
                }
                return next;
              });
            }} className="h-8" />
          </Field>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-end gap-2">
        {ok && <span className="text-xs text-emerald-600">Gespeichert.</span>}
        {error && <span className="text-xs text-destructive">{error}</span>}
        <Button size="sm" disabled={pending} onClick={() => run(() => savePlacement(presentationId, v))}>Platzierung speichern</Button>
      </div>
    </details>
  );
}

// ------------------------------------------------------------- Selbst beworben

export function SelfApplicationsPanel({ candidateId, rows }: { candidateId: string; rows: SelfApplication[] }) {
  const { error, pending, run } = useAction();
  const [company, setCompany] = useState("");
  const [date, setDate] = useState("");
  return (
    <div>
      <ul className="mb-2 space-y-1 text-sm">
        {rows.length === 0 && <li className="text-muted-foreground">Keine eingetragen.</li>}
        {rows.map((s) => (
          <li key={s.id} className="flex items-center gap-2">
            <span className="font-medium">{s.company_name}</span>
            <span className="text-xs text-muted-foreground">{fmtDate(s.date)}{s.result ? ` · ${s.result}` : ""}</span>
            <button className="ml-auto text-muted-foreground hover:text-destructive" title="Entfernen"
              onClick={() => run(() => deleteSelfApplication(s.id, candidateId))}><Trash2 className="size-3.5" /></button>
          </li>
        ))}
      </ul>
      <form className="flex gap-2" onSubmit={(e) => {
        e.preventDefault();
        run(() => addSelfApplication(candidateId, company, date || null, null), () => { setCompany(""); setDate(""); });
      }}>
        <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Firma" className="h-8" />
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-8 w-36" />
        <Button size="sm" disabled={pending || !company.trim()}>+</Button>
      </form>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

// ------------------------------------------------------------- Dateien

export function FilesPanel({ candidateId, files, mainFile }: {
  candidateId: string; files: { path: string; name: string; url: string | null }[]; mainFile: string | null;
}) {
  const { error, pending, run } = useAction();
  const main = files.find((f) => f.path === mainFile) ?? files[0];
  return (
    <div className="space-y-2">
      {main?.url && /\.pdf$/i.test(main.name) && (
        <iframe src={main.url} className="h-[28rem] w-full rounded-md border border-border" title="CV-Vorschau" />
      )}
      <ul className="space-y-1 text-sm">
        {files.length === 0 && <li className="text-muted-foreground">Noch keine Dateien.</li>}
        {files.map((f) => (
          <li key={f.path} className="flex items-center gap-2">
            <FileText className="size-4 text-muted-foreground" />
            {f.url ? <a href={f.url} target="_blank" rel="noreferrer" className="truncate hover:underline">{f.name}</a> : f.name}
            {f.path === mainFile ? <Badge variant="primary">Haupt-CV</Badge> : (
              <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => run(() => setMainCv(candidateId, f.path))}>als CV</button>
            )}
          </li>
        ))}
      </ul>
      <form action={(fd) => run(() => uploadCv(candidateId, fd))} className="flex items-center gap-2">
        <input type="file" name="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" className="min-w-0 flex-1 text-xs" />
        <Button size="sm" variant="outline" disabled={pending}><Upload /> Hochladen</Button>
      </form>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

// ------------------------------------------------------------- Sperren

export function BlocksPanel({ candidateId, name, blocks, companies }: {
  candidateId: string; name: string; blocks: (BlocklistEntry & { company_name: string | null })[]; companies: { id: string; label: string }[];
}) {
  const { error, pending, run } = useAction();
  const [reason, setReason] = useState("");
  const [companyId, setCompanyId] = useState("");
  return (
    <div className="space-y-2">
      {blocks.map((b) => (
        <Notice key={b.id} kind="stop">
          <b>Gesperrt {b.scope === "alle" ? "für alle Firmen" : `bei ${b.company_name}`}:</b> {b.reason}
        </Notice>
      ))}
      {blocks.length === 0 && <p className="text-sm text-muted-foreground">Keine Sperren.</p>}
      <details>
        <summary className="cursor-pointer text-xs text-muted-foreground">Sperre hinzufügen</summary>
        <form className="mt-2 space-y-2" onSubmit={(e) => {
          e.preventDefault();
          run(() => addBlock({ type: "Person", name, candidate_id: candidateId, company_id: companyId || null,
            scope: companyId ? "nur_firma" : "alle", reason }), () => setReason(""));
        }}>
          <Select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
            <option value="">Für alle Firmen</option>
            {companies.map((c) => <option key={c.id} value={c.id}>Nur bei {c.label}</option>)}
          </Select>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Grund (z. B. Osbra-Mitarbeiter)" />
          <Button size="sm" variant="destructive" disabled={pending || !reason.trim()}>Sperren</Button>
        </form>
      </details>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

// ------------------------------------------------------------- Zusammenführen

export function MergeDialog({ keepId, keepKnr, duplicates }: {
  keepId: string; keepKnr: string; duplicates: { id: string; k_nr: string; name: string; match: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mergeKnr, setMergeKnr] = useState(duplicates[0]?.k_nr ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline" size="sm">Dublette zusammenführen</Button></DialogTrigger>
      <DialogContent title={`In ${keepKnr} zusammenführen`} description="Vorstellungen, Aktivitäten, Sperren und Selbstbewerbungen wandern hierher; die andere K-Nummer wird als Alt-Nummer gespeichert. Der andere Datensatz wird gelöscht.">
        <div className="space-y-3">
          {duplicates.length > 0 && (
            <Notice kind="confirm">Mögliche Dubletten: {duplicates.map((d) => `${d.k_nr} ${d.name} (${d.match})`).join(", ")}</Notice>
          )}
          <Field label="K-Nummer der Dublette">
            <Input value={mergeKnr} onChange={(e) => setMergeKnr(e.target.value)} placeholder="K-2026-0xx" />
          </Field>
          {error && <Notice kind="stop">{error}</Notice>}
          <div className="flex justify-end">
            <Button variant="destructive" disabled={pending || !mergeKnr.trim()} onClick={() => start(async () => {
              const { supabaseBrowser } = await import("@/lib/supabase/client");
              const { data } = await supabaseBrowser().from("candidates").select("id").eq("k_nr", mergeKnr.trim()).maybeSingle();
              if (!data) return setError("K-Nummer nicht gefunden.");
              const r = await mergeCandidates(keepId, data.id);
              if (!r.ok) return setError(r.message ?? "Fehler");
              setOpen(false);
              router.refresh();
            })}>Zusammenführen</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
