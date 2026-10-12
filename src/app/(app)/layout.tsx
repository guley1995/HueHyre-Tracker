import { MobileNav, SearchBox, Sidebar } from "@/components/nav";
import { logout } from "@/app/actions";
import { LogOut } from "lucide-react";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background/95 px-4 py-2 backdrop-blur">
          <span className="font-bold md:hidden">HH</span>
          <SearchBox />
          <form action={logout} className="ml-auto">
            <button className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted" title="Abmelden">
              <LogOut className="size-4" /> <span className="hidden sm:inline">Abmelden</span>
            </button>
          </form>
        </header>
        <main className="flex-1 px-4 pb-24 pt-4 md:pb-8">{children}</main>
      </div>
      <MobileNav />
    </div>
  );
}
