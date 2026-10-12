"use client";
import { useEffect, useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { moveCandidate, moveCompany } from "@/app/actions";
import { CANDIDATE_SOURCES, CANDIDATE_STAGE_LABELS, COMPANY_SOURCES, COMPANY_STAGE_LABELS, MISSING_FIELDS } from "@/lib/constants";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { supabaseBrowser } from "@/lib/supabase/client";

export type StageMove = {
  entity: "candidate" | "company";
  id: string;
  name: string;
  stage: string;
  missing: string[];
};

type PresOption = { id: string; label: string };

/**
 * Formular für fehlende Pflichtangaben beim Spaltenwechsel.
 * Öffnet sich, wenn move_candidate/move_company "missing" zurückgibt.
 */
export function StageDialog({ move, onClose, onDone }: { move: StageMove | null; onClose: () => void; onDone?: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [selfApps, setSelfApps] = useState<{ company_name: string; date: string }[]>([]);
  const [noSelfApps, setNoSelfApps] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [presentations, setPresentations] = useState<PresOption[]>([]);
  const [pending, start] = useTransition();

  useEffect(() => {
    setValues({});
    setSelfApps([]);
    setNoSelfApps(false);
    setError(null);
    setMissing(move?.missing ?? []);
    if (move?.entity === "candidate" && move.missing.includes("presentation_id")) {
      supabaseBrowser()
        .from("presentations")
        .select("id, status, sent_date, companies(name)")
        .eq("candidate_id", move.id)
        .not("status", "in", "(absage,zurueckgezogen)")
        .then(({ data }) =>
          setPresentations(
            (data ?? []).map((p) => ({
              id: p.id as string,
              label: `${(p.companies as unknown as { name: string } | null)?.name ?? "?"} (${p.status})`,
            })),
          ),
        );
    }
  }, [move]);

  if (!move) return null;
  const labels = move.entity === "candidate" ? CANDIDATE_STAGE_LABELS : COMPANY_STAGE_LABELS;
  const set = (k: string, v: string) => setValues((s) => ({ ...s, [k]: v }));
  const onlyInfo = missing.every((m) => MISSING_FIELDS[m]?.input === "info");

  function submit() {
    if (!move) return;
    const payload: Record<string, unknown> = { ...values };
    if ("contact" in payload) {
      const c = String(payload.contact ?? "");
      delete payload.contact;
      payload[c.includes("@") ? "email" : "phone"] = c;
    }
    if (missing.includes("self_applications")) {
      const list = selfApps.filter((s) => s.company_name.trim());
      if (list.length) payload.self_applications = list;
      if (noSelfApps) payload.self_applications_none = true;
    }
    if (move.stage === "pausiert" || move.stage === "ruhend") payload.next_action ??= "Wiedervorlage";
    start(async () => {
      const r = move.entity === "candidate"
        ? await moveCandidate(move.id, move.stage, payload)
        : await moveCompany(move.id, move.stage, payload);
      if (r.ok) {
        onDone?.();
        onClose();
      } else {
        setError(r.message ?? "Fehler");
        if (r.missing) setMissing(r.missing);
      }
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`${move.name} → ${labels[move.stage] ?? move.stage}`} description="Für diese Spalte fehlen noch Angaben.">
        <div className="space-y-3">
          {missing.map((key) => {
            const f = MISSING_FIELDS[key];
            if (!f) return <p key={key} className="text-sm">{key}</p>;
            if (f.input === "info") return <Notice key={key} kind="hint">{f.label}</Notice>;
            if (f.input === "self_applications") {
              return (
                <div key={key} className="rounded-md border border-border p-3">
                  <p className="mb-2 text-sm font-medium">{f.label}</p>
                  {selfApps.map((s, i) => (
                    <div key={i} className="mb-2 flex gap-2">
                      <Input placeholder="Firma" value={s.company_name}
                        onChange={(e) => setSelfApps((l) => l.map((x, j) => (j === i ? { ...x, company_name: e.target.value } : x)))} />
                      <Input type="date" className="w-40" value={s.date}
                        onChange={(e) => setSelfApps((l) => l.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))} />
                      <Button type="button" variant="ghost" size="icon" onClick={() => setSelfApps((l) => l.filter((_, j) => j !== i))}><X /></Button>
                    </div>
                  ))}
                  <div className="flex flex-wrap items-center gap-3">
                    <Button type="button" variant="outline" size="sm" onClick={() => setSelfApps((l) => [...l, { company_name: "", date: "" }])}>
                      <Plus /> Firma
                    </Button>
                    <label className="flex items-center gap-1.5 text-sm">
                      <input type="checkbox" checked={noSelfApps} onChange={(e) => setNoSelfApps(e.target.checked)} />
                      Nirgends selbst beworben
                    </label>
                  </div>
                </div>
              );
            }
            const k = f.payloadKey!;
            return (
              <Field key={key} label={f.label}>
                {f.input === "textarea" ? (
                  <Textarea value={values[k] ?? ""} onChange={(e) => set(k, e.target.value)} />
                ) : f.input === "select" ? (
                  <Select value={values[k] ?? ""} onChange={(e) => set(k, e.target.value)}>
                    <option value="">– wählen –</option>
                    {(move.entity === "candidate" ? CANDIDATE_SOURCES : COMPANY_SOURCES).map((s) => <option key={s}>{s}</option>)}
                  </Select>
                ) : f.input === "presentation" ? (
                  <Select value={values[k] ?? ""} onChange={(e) => set(k, e.target.value)}>
                    <option value="">– Vorstellung wählen –</option>
                    {presentations.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </Select>
                ) : (
                  <Input type={f.input === "date" ? "date" : "text"} value={values[k] ?? ""} onChange={(e) => set(k, e.target.value)} />
                )}
              </Field>
            );
          })}
          {move.stage === "angeschrieben" && missing.includes("contacted_at") && (
            <Field label="Ansprechpartner (falls bekannt)">
              <Input value={values.contact_name ?? ""} onChange={(e) => set("contact_name", e.target.value)} />
            </Field>
          )}
          {(move.stage === "pausiert" || move.stage === "ruhend") && (
            <Field label="Nächste Aktion">
              <Input placeholder="Wiedervorlage" value={values.next_action ?? ""} onChange={(e) => set("next_action", e.target.value)} />
            </Field>
          )}
          {error && <Notice kind="stop">{error}</Notice>}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={onClose}>Abbrechen</Button>
            {!onlyInfo && <Button onClick={submit} disabled={pending}>{pending ? "…" : "Speichern und verschieben"}</Button>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
