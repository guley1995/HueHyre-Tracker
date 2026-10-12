"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, UserPlus } from "lucide-react";
import { convertBaProfile, updateBaProfile } from "@/app/actions";
import type { BaProfile, RpcResult } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { todayIso } from "@/lib/utils";

// Link-Vorlage zur Bewerberbörse, z. B. "https://…/bewerberdetail/{ref}" (in .env setzen).
const BA_TEMPLATE = process.env.NEXT_PUBLIC_BA_PROFILE_URL;
const BA_URL = (ref: string) => (BA_TEMPLATE ? BA_TEMPLATE.replace("{ref}", encodeURIComponent(ref)) : null);

export function BaTable({ rows }: { rows: BaProfile[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2">Ref.-Nr.</th><th className="px-3 py-2">Suche</th><th className="px-3 py-2">Qualifikation</th>
            <th className="px-3 py-2">Alter</th><th className="px-3 py-2">Ort</th><th className="px-3 py-2">Kontaktiert</th>
            <th className="px-3 py-2">Antwort</th><th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => <BaRow key={r.id} r={r} />)}
          {rows.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">Keine Profile.</td></tr>}
        </tbody>
      </table>
      <p className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">{rows.length} Profile</p>
    </div>
  );
}

function BaRow({ r }: { r: BaProfile }) {
  const router = useRouter();
  const [reply, setReply] = useState(r.reply ?? "");
  const [pending, start] = useTransition();
  const save = (data: Record<string, unknown>) => start(async () => { await updateBaProfile(r.id, data); router.refresh(); });
  return (
    <tr className="border-t border-border align-top">
      <td className="whitespace-nowrap px-3 py-1.5">
        {BA_URL(r.ref_no) ? (
          <a href={BA_URL(r.ref_no)!} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
            {r.ref_no}<ExternalLink className="size-3" />
          </a>
        ) : r.ref_no}
      </td>
      <td className="px-3 py-1.5">{r.search ?? "–"}</td>
      <td className="px-3 py-1.5">{r.qualification ?? "–"}</td>
      <td className="px-3 py-1.5">{r.age ?? "–"}</td>
      <td className="px-3 py-1.5">{r.city ?? "–"}</td>
      <td className="whitespace-nowrap px-3 py-1.5">
        <input type="date" defaultValue={r.contacted_date ?? ""} disabled={pending} className="bg-transparent text-sm"
          onChange={(e) => save({ contacted_date: e.target.value, reply })} />
        {!r.contacted_date && <button className="ml-1 text-xs text-primary" onClick={() => save({ contacted_date: todayIso(), reply })}>heute</button>}
      </td>
      <td className="px-3 py-1.5">
        <input value={reply} onChange={(e) => setReply(e.target.value)} onBlur={() => reply !== (r.reply ?? "") && save({ contacted_date: r.contacted_date, reply })}
          placeholder="–" className="w-40 bg-transparent text-sm outline-none focus:border-b focus:border-primary" />
      </td>
      <td className="px-3 py-1.5 text-right">
        {r.candidate_id ? <Link href={`/kandidaten/${r.candidate_id}`} className="text-xs text-primary hover:underline">Kandidat</Link> : <ConvertDialog r={r} />}
      </td>
    </tr>
  );
}

function ConvertDialog({ r }: { r: BaProfile }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ first_name: "", last_name: "", email: "", phone: "", next_action: "Qualifizieren", next_action_date: todayIso() });
  const [result, setResult] = useState<RpcResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><UserPlus /> Kandidat</Button></DialogTrigger>
      <DialogContent title={`BA ${r.ref_no} → Kandidat`}>
        <form className="space-y-3" onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await convertBaProfile(r.id, v);
            setResult(res);
            if (res.ok) { setOpen(false); router.push(`/kandidaten/${res.id}`); }
          });
        }}>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Vorname"><Input value={v.first_name} onChange={(e) => setV({ ...v, first_name: e.target.value })} /></Field>
            <Field label="Nachname"><Input required value={v.last_name} onChange={(e) => setV({ ...v, last_name: e.target.value })} /></Field>
            <Field label="E-Mail"><Input value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
            <Field label="Telefon"><Input value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} /></Field>
            <Field label="Nächste Aktion"><Input value={v.next_action} onChange={(e) => setV({ ...v, next_action: e.target.value })} /></Field>
            <Field label="Datum"><Input type="date" value={v.next_action_date} onChange={(e) => setV({ ...v, next_action_date: e.target.value })} /></Field>
          </div>
          {result && !result.ok && <Notice kind="stop">{result.message}</Notice>}
          <div className="flex justify-end"><Button disabled={pending}>Anlegen</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
