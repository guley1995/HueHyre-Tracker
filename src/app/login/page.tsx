import { LoginForm } from "./login-form";

export const metadata = { title: "Anmelden" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-xs">
        <h1 className="mb-1 text-lg font-bold">HueHYRE Tracker</h1>
        <p className="mb-5 text-sm text-muted-foreground">Nur für angemeldete Nutzer.</p>
        <LoginForm next={next?.startsWith("/") ? next : "/"} />
      </div>
    </div>
  );
}
