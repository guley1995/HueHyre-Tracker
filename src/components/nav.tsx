"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Briefcase, CalendarCheck, Database, Plus, Search, Settings, Shuffle, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { href: "/", label: "Heute", icon: CalendarCheck },
  { href: "/kandidaten", label: "Kandidaten", icon: Users },
  { href: "/firmen", label: "Firmen", icon: Briefcase },
  { href: "/matching", label: "Matching", icon: Shuffle },
  { href: "/ba-pool", label: "BA-Pool", icon: Database },
  { href: "/einstellungen", label: "Einstellungen", icon: Settings },
];

function isActive(path: string, href: string) {
  return href === "/" ? path === "/" : path.startsWith(href);
}

export function Sidebar() {
  const path = usePathname();
  return (
    <aside className="sticky top-0 hidden h-dvh w-52 shrink-0 flex-col border-r border-border bg-card px-3 py-4 md:flex">
      <Link href="/" className="mb-5 px-2 text-base font-bold tracking-tight">
        HueHYRE <span className="text-primary">Tracker</span>
      </Link>
      <nav className="flex flex-col gap-0.5">
        {items.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
              isActive(path, href) ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        ))}
      </nav>
      <Link
        href="/neu"
        className="mt-4 flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        <Plus className="size-4" /> Schnellerfassung
      </Link>
    </aside>
  );
}

export function MobileNav() {
  const path = usePathname();
  const mobile = [items[0], items[1], items[2], { href: "/suche", label: "Suche", icon: Search }];
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden">
      {mobile.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className={cn("flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px]", isActive(path, href) ? "text-primary" : "text-muted-foreground")}
        >
          <Icon className="size-5" />
          {label}
        </Link>
      ))}
      <Link href="/neu" className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] text-primary">
        <Plus className="size-5" />
        Neu
      </Link>
    </nav>
  );
}

export function SearchBox() {
  const router = useRouter();
  const [q, setQ] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (q.trim()) router.push(`/suche?q=${encodeURIComponent(q.trim())}`);
      }}
      className="relative w-full max-w-md"
    >
      <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Suche: Name, K-Nr., Firma, Telefon …"
        className="h-9 w-full rounded-md border border-border bg-background pl-8 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </form>
  );
}
