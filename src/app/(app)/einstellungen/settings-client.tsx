"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { addBlock, deleteCandidate, removeBlock } from "@/app/actions";
import type { BlocklistEntry } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/input";
import { fmtDate } from "@/lib/utils";

type Row = BlocklistEntry & { candidate_label: string | null; company_label: string | null };

export function BlocklistManager({ rows, companies }: { rows: Row[]; companies: { id: string; label: string }[] }) {
  const router = useRouter();
  const [type, setType] = useState<"Person" | "Firma" | "Regel">("Firma");
  const [name, setName] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr><th className="py-1 pr-3">Art</th><th className="py-1 pr-3">Name</th><th className="py-1 pr-3">Gilt für</th><th className="py-1 pr-3">Grund</th><th></th></tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="py-2 text-muted-foreground">Keine Sperren.</td></tr>}
            {rows.map((b) => (
              <tr key={b.id} className="border-t border-border">
                <td className="py-1.5 pr-3"><Badge variant={b.type === "Person" ? "amber" : "red"}>{b.type}</Badge></td>
                <td className="py-1.5 pr-3">
                  {b.candidate_id ? <Link href={`/kandidaten/${b.candidate_id}`} className="text-primary hover:underline">{b.candidate_label ?? b.name}</Link>
                    : b.company_id && b.type !== "Person" ? <Link href={`/firmen/${b.company_id}`} className="text-primary hover:underline">{b.company_label ?? b.name}</Link>
                    : b.name}
                </td>
                <td className="py-1.5 pr-3">{b.scope === "alle" ? "alle Firmen" : `nur ${b.company_label}`}</td>
                <td className="py-1.5 pr-3">{b.reason}</td>
                <td className="py-1.5 text-right">
                  <button className="text-muted-foreground hover:text-destructive" title="Sperre aufheben"
                    onClick={() => confirm(`Sperre „${b.name}“ aufheben?`) && start(async () => { await removeBlock(b.id); router.refresh(); })}>
                    <Trash2 className="size-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form className="flex flex-wrap gap-2 border-t border-border pt-3" onSubmit={(e) => {
        e.preventDefault();
        const company = companies.find((c) => c.id === companyId);
        start(async () => {
          const r = await addBlock({
            type, name: name || company?.label || "", reason,
            company_id: companyId || null,
            scope: type === "Person" && companyId ? "nur_firma" : "alle",
          });
          if (!r.ok) return setError(r.message ?? "Fehler");
          setName(""); setReason(""); setCompanyId(""); setError(null);
          router.refresh();
        });
      }}>
        <Select value={type} onChange={(e) => setType(e.target.value as typeof type)} className="w-28">
          <option>Firma</option><option>Person</option><option>Regel</option>
        </Select>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={type === "Person" ? "Vor- und Nachname" : "Name (oder Firma wählen)"} className="w-52" />
        <Select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className="w-56">
          <option value="">{type === "Person" ? "gesperrt bei allen Firmen" : "– Firma aus Liste –"}</option>
          {companies.map((c) => <option key={c.id} value={c.id}>{type === "Person" ? `nur bei ${c.label}` : c.label}</option>)}
        </Select>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Grund (z. B. NDA STEP 2.0)" className="min-w-48 flex-1" />
        <Button size="sm" className="h-9" disabled={pending}>Sperren</Button>
        {error && <p className="w-full text-sm text-destructive">{error}</p>}
      </form>
      <p className="text-xs text-muted-foreground">
        Personen werden per Name (oder Verknüpfung in der Kandidaten-Ansicht) erkannt; Firmen/Regeln per Firma oder Name, Firmierung oder Gruppe.
      </p>
    </div>
  );
}

export function DeletionList({ rows }: { rows: { id: string; k_nr: string; full_name: string; stage: string; delete_after: string }[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!rows.length) return <p className="text-sm text-muted-foreground">Keine Kandidaten mit erreichter Löschfrist.</p>;
  return (
    <div>
      <ul className="divide-y divide-border text-sm">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-3 py-1.5">
            <Link href={`/kandidaten/${r.id}`} className="font-medium hover:underline">{r.k_nr} {r.full_name}</Link>
            <span className="text-xs text-muted-foreground">Löschen nach {fmtDate(r.delete_after)} · {r.stage}</span>
            <Button variant="destructive" size="sm" className="ml-auto" disabled={pending} onClick={() => {
              const k = prompt(`Zum endgültigen Löschen die K-Nummer ${r.k_nr} eingeben:`);
              if (!k) return;
              start(async () => {
                const res = await deleteCandidate(r.id, k);
                if (!res.ok) return setError(res.message ?? "Fehler");
                router.refresh();
              });
            }}>Löschen</Button>
          </li>
        ))}
      </ul>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
