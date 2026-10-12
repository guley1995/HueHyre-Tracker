"use client";
import { useState, useTransition } from "react";
import { Bot, Mail, MessageSquare, Phone, StickyNote, Workflow } from "lucide-react";
import { addActivity } from "@/app/actions";
import { ACTIVITY_TYPES } from "@/lib/constants";
import type { Activity } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { fmtDateTime } from "@/lib/utils";

const icons: Record<string, React.ComponentType<{ className?: string }>> = {
  Mail, Anruf: Phone, SMS: MessageSquare, WhatsApp: MessageSquare, Notiz: StickyNote, Status: Workflow,
};

export function Timeline({ entityType, entityId, activities }: { entityType: "candidate" | "company"; entityId: string; activities: Activity[] }) {
  const [type, setType] = useState("Notiz");
  const [direction, setDirection] = useState("");
  const [summary, setSummary] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div>
      <form
        className="mb-3 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await addActivity(entityType, entityId, { type, direction: direction || null, summary });
            if (!r.ok) return setError(r.message ?? "Fehler");
            setSummary("");
            setError(null);
          });
        }}
      >
        <Select value={type} onChange={(e) => setType(e.target.value)} className="w-28">
          {ACTIVITY_TYPES.filter((t) => t !== "Status").map((t) => <option key={t}>{t}</option>)}
        </Select>
        <Select value={direction} onChange={(e) => setDirection(e.target.value)} className="w-24">
          <option value="">–</option><option value="ein">ein</option><option value="aus">aus</option>
        </Select>
        <Input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Was ist passiert?" className="min-w-48 flex-1" />
        <Button type="submit" size="sm" className="h-9" disabled={pending || !summary.trim()}>Eintragen</Button>
        {error && <p className="w-full text-sm text-destructive">{error}</p>}
      </form>
      <ol className="space-y-2">
        {activities.length === 0 && <li className="text-sm text-muted-foreground">Noch keine Aktivitäten.</li>}
        {activities.map((a) => {
          const Icon = icons[a.type] ?? StickyNote;
          return (
            <li key={a.id} className="flex gap-2 text-sm">
              <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-wrap break-words">{a.summary}
                  {a.link && <a href={a.link} target="_blank" rel="noreferrer" className="ml-1 text-primary underline">Link</a>}
                </p>
                <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  {fmtDateTime(a.occurred_at)} · {a.type}{a.direction ? ` (${a.direction})` : ""}
                  {a.created_by === "Claude" ? <Badge variant="primary"><Bot className="size-3" /> Claude</Badge> : <span>· {a.created_by}</span>}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
