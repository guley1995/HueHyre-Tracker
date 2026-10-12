"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { completeAction } from "@/app/actions";
import { ACTIVITY_TYPES } from "@/lib/constants";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { addDays, todayIso } from "@/lib/utils";

/** "erledigt + nächste Aktion": Aktivität schreiben und neue Wiedervorlage setzen. */
export function CompleteActionButton({ entityType, id, name, currentAction, size = "sm" }: {
  entityType: "candidate" | "company"; id: string; name: string; currentAction: string | null; size?: "sm" | "default";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState(currentAction ?? "");
  const [type, setType] = useState("Anruf");
  const [next, setNext] = useState("");
  const [date, setDate] = useState(addDays(todayIso(), 7));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const quick = [1, 3, 7, 14, 30];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size={size}><Check /> erledigt + nächste</Button>
      </DialogTrigger>
      <DialogContent title={`Erledigt: ${name}`}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!next.trim() || !date) return setError("Nächste Aktion mit Datum angeben.");
            start(async () => {
              const r = await completeAction(entityType, id, summary, next, date, type);
              if (!r.ok) return setError(r.message ?? "Fehler");
              setOpen(false);
              router.refresh();
            });
          }}
        >
          <div className="grid grid-cols-[1fr_8rem] gap-2">
            <Field label="Was wurde erledigt?">
              <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} className="min-h-16" />
            </Field>
            <Field label="Art">
              <Select value={type} onChange={(e) => setType(e.target.value)}>
                {ACTIVITY_TYPES.filter((t) => t !== "Status").map((t) => <option key={t}>{t}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Nächste Aktion">
            <Input value={next} onChange={(e) => setNext(e.target.value)} placeholder="z. B. Nachfassen, Profil schicken …" autoFocus />
          </Field>
          <Field label="Datum">
            <div className="flex flex-wrap items-center gap-2">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" />
              {quick.map((d) => (
                <Button key={d} type="button" variant="ghost" size="sm" onClick={() => setDate(addDays(todayIso(), d))}>+{d}</Button>
              ))}
            </div>
          </Field>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="submit" disabled={pending}>{pending ? "…" : "Speichern"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
