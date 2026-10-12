import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-lg font-bold">Nicht gefunden</h1>
      <p className="mt-1 text-sm text-muted-foreground">Den Datensatz gibt es nicht (mehr) – evtl. zusammengeführt.</p>
      <Link href="/" className="mt-4 inline-block text-primary hover:underline">Zu „Heute“</Link>
    </div>
  );
}
