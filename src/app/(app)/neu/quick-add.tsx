"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createCandidate } from "@/app/actions";
import { CANDIDATE_SOURCES, CATEGORIES } from "@/lib/constants";
import type { RpcResult } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { addDays, todayIso } from "@/lib/utils";

export function QuickAdd({ initialName }: { initialName: string }) {
  const router = useRouter();
  const [first, ...rest] = initialName.trim().split(/\s+/);
  const [v, setV] = useState<Record<string, string>>({
    first_name: rest.length ? first : "", last_name: rest.length ? rest.join(" ") : (first ?? ""), email: "", phone: "",
    city: "", source: "Telefon", category: "", next_action: "Rückruf / Qualifizieren", next_action_date: addDays(todayIso(), 1), notes: "",
  });
  const [result, setResult] = useState<RpcResult | null>(null);
  const [pending, start] = useTransition();
  const set = (k: string, val: string) => setV((s) => ({ ...s, [k]: val }));
  const onlyNameMatch = result?.duplicates?.length && result.duplicates.every((d) => d.match === "name_ort");

  function save(force: boolean) {
    start(async () => {
      const r = await createCandidate(v, force);
      setResult(r);
      if (r.ok) router.push(`/kandidaten/${r.id}`);
    });
  }

  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save(false); }}>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Vorname"><Input value={v.first_name} onChange={(e) => set("first_name", e.target.value)} autoFocus /></Field>
        <Field label="Nachname"><Input value={v.last_name} onChange={(e) => set("last_name", e.target.value)} required /></Field>
      </div>
      <Field label="Telefon"><Input type="tel" inputMode="tel" value={v.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
      <Field label="E-Mail"><Input type="email" inputMode="email" value={v.email} onChange={(e) => set("email", e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Quelle">
          <Select value={v.source} onChange={(e) => set("source", e.target.value)}>
            {CANDIDATE_SOURCES.map((s) => <option key={s}>{s}</option>)}
          </Select>
        </Field>
        <Field label="Kategorie">
          <Select value={v.category} onChange={(e) => set("category", e.target.value)}>
            <option value="">–</option>{CATEGORIES.map((s) => <option key={s}>{s}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Ort"><Input value={v.city} onChange={(e) => set("city", e.target.value)} /></Field>
      <div className="grid grid-cols-[1fr_9.5rem] gap-2">
        <Field label="Nächste Aktion"><Input value={v.next_action} onChange={(e) => set("next_action", e.target.value)} required /></Field>
        <Field label="Datum"><Input type="date" value={v.next_action_date} onChange={(e) => set("next_action_date", e.target.value)} required /></Field>
      </div>
      <Field label="Notiz"><Textarea value={v.notes} onChange={(e) => set("notes", e.target.value)} className="min-h-14" /></Field>

      {result && !result.ok && (
        <Notice kind={onlyNameMatch ? "confirm" : "stop"}>
          {result.message}
          {result.duplicates?.map((d) => (
            <div key={d.id}><Link href={`/kandidaten/${d.id}`} className="underline">{d.k_nr} {d.name} öffnen</Link></div>
          ))}
        </Notice>
      )}
      <div className="flex gap-2">
        <Button type="submit" className="h-11 flex-1" disabled={pending || (!v.email && !v.phone)}>
          {pending ? "…" : "Anlegen"}
        </Button>
        {onlyNameMatch && <Button type="button" variant="outline" className="h-11" onClick={() => save(true)}>Trotzdem anlegen</Button>}
      </div>
      {!v.email && !v.phone && <p className="text-xs text-muted-foreground">Telefon oder E-Mail angeben (Kontaktweg).</p>}
    </form>
  );
}
