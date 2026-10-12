"use client";
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { AlertCircle, CalendarClock, Clock, Send } from "lucide-react";
import { moveCandidate, moveCompany } from "@/app/actions";
import { StageDialog, type StageMove } from "@/components/stage-dialog";
import { Badge, PriorityBadge } from "@/components/ui/badge";
import { cn, fmtDate } from "@/lib/utils";

export type BoardCard = {
  id: string;
  stage: string;
  title: string;
  subtitle?: string | null;
  priority: string | null;
  city: string | null;
  next_action: string | null;
  next_action_date: string | null;
  missing_next_action: boolean;
  overdue: boolean;
  days_since_activity: number;
  active_presentations: number;
};

type Column = { key: string; label: string; hint: string };

export function Board({ entity, columns, cards: initial }: { entity: "candidate" | "company"; columns: readonly Column[]; cards: BoardCard[] }) {
  const router = useRouter();
  const [cards, setCards] = useState(initial);
  const [active, setActive] = useState<BoardCard | null>(null);
  const [move, setMove] = useState<StageMove | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  useEffect(() => setCards(initial), [initial]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  function onDragStart(e: DragStartEvent) {
    setActive(cards.find((c) => c.id === e.active.id) ?? null);
  }

  function onDragEnd(e: DragEndEvent) {
    setActive(null);
    const card = cards.find((c) => c.id === e.active.id);
    const target = e.over?.id as string | undefined;
    if (!card || !target || target === card.stage) return;
    const previous = card.stage;
    setCards((cs) => cs.map((c) => (c.id === card.id ? { ...c, stage: target } : c)));
    setError(null);
    start(async () => {
      const r = entity === "candidate" ? await moveCandidate(card.id, target) : await moveCompany(card.id, target);
      if (r.ok) return router.refresh();
      setCards((cs) => cs.map((c) => (c.id === card.id ? { ...c, stage: previous } : c)));
      if (r.missing?.length) setMove({ entity, id: card.id, name: card.title, stage: target, missing: r.missing });
      else setError(r.message ?? "Verschieben fehlgeschlagen.");
    });
  }

  const href = (id: string) => (entity === "candidate" ? `/kandidaten/${id}` : `/firmen/${id}`);

  return (
    <>
      {error && <p className="mb-2 text-sm text-destructive">{error}</p>}
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
        <div className="flex gap-3 overflow-x-auto pb-4" style={{ scrollSnapType: "x proximity" }}>
          {columns.map((col) => (
            <BoardColumn key={col.key} column={col} cards={cards.filter((c) => c.stage === col.key)} href={href} />
          ))}
        </div>
        <DragOverlay>{active ? <CardView card={active} dragging /> : null}</DragOverlay>
      </DndContext>
      <StageDialog move={move} onClose={() => setMove(null)} onDone={() => router.refresh()} />
    </>
  );
}

function BoardColumn({ column, cards, href }: { column: Column; cards: BoardCard[]; href: (id: string) => string }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.key });
  const red = cards.filter((c) => c.missing_next_action || c.overdue).length;
  return (
    <section
      ref={setNodeRef}
      className={cn("flex w-72 shrink-0 flex-col rounded-lg bg-column p-2", isOver && "ring-2 ring-primary/50")}
      style={{ scrollSnapAlign: "start" }}
    >
      <header className="mb-2 px-1" title={column.hint}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">{column.label}</h3>
          <span className="text-xs text-muted-foreground">
            {cards.length}
            {red > 0 && <span className="ml-1 text-red-600">· {red} !</span>}
          </span>
        </div>
        <p className="truncate text-[11px] text-muted-foreground">{column.hint}</p>
      </header>
      <div className="flex min-h-24 flex-col gap-2">
        {cards.map((c) => <DraggableCard key={c.id} card={c} href={href(c.id)} />)}
      </div>
    </section>
  );
}

function DraggableCard({ card, href }: { card: BoardCard; href: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: card.id });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className={cn("touch-manipulation", isDragging && "opacity-30")}>
      <Link href={href} draggable={false} className="block">
        <CardView card={card} />
      </Link>
    </div>
  );
}

function CardView({ card, dragging }: { card: BoardCard; dragging?: boolean }) {
  const red = card.missing_next_action || card.overdue;
  return (
    <article
      className={cn(
        "rounded-md border bg-card p-2.5 text-sm shadow-xs hover:border-primary/40",
        red ? "border-red-300 dark:border-red-900" : "border-border",
        dragging && "rotate-1 shadow-lg",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium">{card.title}</p>
          {card.subtitle && <p className="truncate text-xs text-muted-foreground">{card.subtitle}</p>}
        </div>
        <PriorityBadge priority={card.priority} />
      </div>
      {card.city && <p className="mt-1 truncate text-xs text-muted-foreground">{card.city}</p>}
      <div className={cn("mt-1.5 flex items-center gap-1 text-xs", red ? "text-red-600 dark:text-red-400" : "text-foreground")}>
        {card.missing_next_action ? <AlertCircle className="size-3.5" /> : <CalendarClock className="size-3.5" />}
        <span className="truncate">
          {card.missing_next_action ? "Keine Wiedervorlage" : `${card.next_action ?? "Aktion"} · ${fmtDate(card.next_action_date)}`}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        <Badge variant={card.days_since_activity >= 14 ? "amber" : "default"}>
          <Clock className="size-3" /> {card.days_since_activity} T
        </Badge>
        {card.active_presentations > 0 && (
          <Badge variant="primary"><Send className="size-3" /> {card.active_presentations}</Badge>
        )}
      </div>
    </article>
  );
}
