"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

export type ColumnDef<T> = {
  key: string;
  label: string;
  value: (row: T) => string | number | null;
  render?: (row: T) => React.ReactNode;
  className?: string;
};

/** Sortierbare Tabelle (Klick auf Spaltenkopf). */
export function DataTable<T extends { id: string }>({ rows, columns, href, rowClassName }: {
  rows: T[]; columns: ColumnDef<T>[]; href?: (row: T) => string; rowClassName?: (row: T) => string | undefined;
}) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    return [...rows].sort((a, b) => {
      const va = col.value(a);
      const vb = col.value(b);
      if (va === vb) return 0;
      if (va === null || va === "") return 1;
      if (vb === null || vb === "") return -1;
      return (typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "de")) * sort.dir;
    });
  }, [rows, columns, sort]);

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={cn("whitespace-nowrap px-3 py-2 font-medium", c.className)}>
                <button
                  className="flex items-center gap-1 hover:text-foreground"
                  onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 1 ? -1 : 1 } : { key: c.key, dir: 1 }))}
                >
                  {c.label}
                  {sort?.key === c.key && (sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.id} className={cn("border-t border-border hover:bg-muted/40", rowClassName?.(row))}>
              {columns.map((c, i) => (
                <td key={c.key} className={cn("px-3 py-1.5 align-top", c.className)}>
                  {i === 0 && href ? (
                    <Link href={href(row)} className="font-medium text-primary hover:underline">{c.render ? c.render(row) : c.value(row)}</Link>
                  ) : c.render ? c.render(row) : (c.value(row) ?? "–")}
                </td>
              ))}
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr><td colSpan={columns.length} className="px-3 py-6 text-center text-muted-foreground">Keine Einträge.</td></tr>
          )}
        </tbody>
      </table>
      <p className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">{rows.length} Einträge</p>
    </div>
  );
}
