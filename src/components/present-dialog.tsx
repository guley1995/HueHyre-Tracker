"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { checkPresentation, createPresentation } from "@/app/actions";
import { CHANNELS } from "@/lib/constants";
import type { PresentationResult } from "@/lib/types";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { fmtDate, todayIso } from "@/lib/utils";

type Option = { id: string; label: string };
type JobOption = { id: string; title: string; last_checked_date: string | null; status: string };

/**
 * „Vorstellen bei …“: prüft live Doppelvorstellung, Schwesterfirma, Selbstbewerbung,
 * Sperren, Einwilligung und Stellencheck, bevor die Vorstellung angelegt wird.
 */
export function PresentDialog({ candidateId, candidateName, companies, fixedCompanyId, fixedJobId, consentDate, trigger }: {
  candidateId: string;
  candidateName: string;
  companies?: Option[];
  fixedCompanyId?: string;
  fixedJobId?: string;
  consentDate: string | null;
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [companyId, setCompanyId] = useState(fixedCompanyId ?? "");
  const [companyFilter, setCompanyFilter] = useState("");
  const [jobs, setJobs] = useState<JobOption[]>([]);
  const [jobId, setJobId] = useState(fixedJobId ?? "");
  const [anonymous, setAnonymous] = useState(!consentDate);
  const [channel, setChannel] = useState("Mail");
  const [sentDate, setSentDate] = useState(todayIso());
  const [notes, setNotes] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [check, setCheck] = useState<PresentationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const filtered = useMemo(
    () => (companies ?? []).filter((c) => c.label.toLowerCase().includes(companyFilter.toLowerCase())).slice(0, 200),
    [companies, companyFilter],
  );

  useEffect(() => {
    if (!open || !companyId) return setJobs([]);
    supabaseBrowser().from("jobs").select("id, title, last_checked_date, status").eq("company_id", companyId).order("title")
      .then(({ data }) => setJobs((data ?? []) as JobOption[]));
  }, [open, companyId]);

  useEffect(() => {
    if (!open || !companyId) return setCheck(null);
    setConfirmed(false);
    let cancelled = false;
    checkPresentation(candidateId, companyId, jobId || null, anonymous).then((r) => !cancelled && setCheck(r));
    return () => { cancelled = true; };
  }, [open, candidateId, companyId, jobId, anonymous]);

  const blocked = (check?.blocking.length ?? 0) > 0;
  const needsConfirm = (check?.confirm.length ?? 0) > 0;

  function submit() {
    start(async () => {
      const r = await createPresentation({
        candidateId, companyId, jobId: jobId || null, channel, anonymous, sentDate, notes, confirm: confirmed,
      });
      if (r.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setCheck(r);
        setError(r.message ?? "Nicht angelegt.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setError(null); }}>
      <DialogTrigger asChild>{trigger ?? <Button size="sm"><Send /> Vorstellen bei …</Button>}</DialogTrigger>
      <DialogContent title={`${candidateName} vorstellen`}>
        <div className="space-y-3">
          {!fixedCompanyId && (
            <Field label="Firma">
              <Input placeholder="Firma suchen …" value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)} className="mb-1" />
              <Select value={companyId} onChange={(e) => { setCompanyId(e.target.value); setJobId(""); }} size={Math.min(6, Math.max(2, filtered.length + 1))} className="h-auto">
                <option value="">– Firma wählen –</option>
                {filtered.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </Select>
            </Field>
          )}
          {companyId && !fixedJobId && (
            <Field label="Stelle (optional)">
              <Select value={jobId} onChange={(e) => setJobId(e.target.value)}>
                <option value="">– ohne Stelle (initiativ) –</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>{j.title} · {j.status} · geprüft {fmtDate(j.last_checked_date)}</option>
                ))}
              </Select>
            </Field>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Kanal">
              <Select value={channel} onChange={(e) => setChannel(e.target.value)}>
                {CHANNELS.map((c) => <option key={c}>{c}</option>)}
              </Select>
            </Field>
            <Field label="Datum">
              <Input type="date" value={sentDate} onChange={(e) => setSentDate(e.target.value)} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
            Anonym vorstellen {consentDate ? `(Einwilligung vom ${fmtDate(consentDate)} liegt vor)` : "(keine Einwilligung erfasst)"}
          </label>
          <Field label="Notiz">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-14" />
          </Field>

          {check && (
            <div className="space-y-1.5">
              {check.blocking.map((m, i) => <Notice key={`b${i}`} kind="stop">{m.message}</Notice>)}
              {check.confirm.map((m, i) => <Notice key={`c${i}`} kind="confirm">{m.message}</Notice>)}
              {check.hints.map((m, i) => <Notice key={`h${i}`} kind="hint">{m.message}</Notice>)}
              {!blocked && !needsConfirm && check.hints.length === 0 && <Notice kind="hint">Prüfung ok – keine Konflikte.</Notice>}
            </div>
          )}
          {needsConfirm && !blocked && (
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              Trotzdem vorstellen – ich habe die Warnung geprüft.
            </label>
          )}
          {error && !check && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button onClick={submit} disabled={pending || !companyId || blocked || (needsConfirm && !confirmed)}>
              {pending ? "…" : "Vorstellung anlegen"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
