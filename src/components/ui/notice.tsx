import * as React from "react";
import { AlertTriangle, Ban, Info } from "lucide-react";
import { cn } from "@/lib/utils";

/** Meldungen der Schutzregeln: Stopp (rot), Bestätigung (gelb), Hinweis (blau). */
export function Notice({ kind, children, className }: { kind: "stop" | "confirm" | "hint"; children: React.ReactNode; className?: string }) {
  const Icon = kind === "stop" ? Ban : kind === "confirm" ? AlertTriangle : Info;
  return (
    <div
      className={cn(
        "flex gap-2 rounded-md border px-3 py-2 text-sm",
        kind === "stop" && "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100",
        kind === "confirm" && "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100",
        kind === "hint" && "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-100",
        className,
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}
