import { QuickAdd } from "./quick-add";

export const metadata = { title: "Schnellerfassung" };

export default async function NewPage({ searchParams }: { searchParams: Promise<{ name?: string }> }) {
  const { name } = await searchParams;
  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-1 text-xl font-bold">Schnellerfassung</h1>
      <p className="mb-4 text-sm text-muted-foreground">Name, Kontakt, Quelle, nächste Aktion – fertig.</p>
      <QuickAdd initialName={name ?? ""} />
    </div>
  );
}
