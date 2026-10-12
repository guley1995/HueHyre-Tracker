import { NextResponse, type NextRequest } from "next/server";
import { AgentError, runAgentAction } from "@/lib/agent/handlers";
import { agentPool } from "@/lib/agent/db";
import { checkBearer } from "@/lib/agent/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(req: NextRequest, action: string) {
  if (!checkBearer(req.headers.get("authorization"), process.env.AGENT_API_KEY)) {
    return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  }
  let body: unknown = {};
  if (req.method === "POST") {
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Body muss JSON sein." }, { status: 400 });
    }
  } else {
    body = Object.fromEntries(
      [...req.nextUrl.searchParams.entries()].map(([k, v]) => [k, k === "limit" ? Number(v) : v]),
    );
  }
  try {
    const result = await runAgentAction(agentPool(), action, body);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof AgentError) {
      return NextResponse.json({ error: e.message, details: e.details }, { status: e.status });
    }
    const err = e as { message?: string; hint?: string; code?: string };
    // Datenbank-Regeln (z. B. Einwilligung, Unique-Index) als 409 melden.
    if (err.code === "P0001" || err.code === "23505" || err.code === "23514") {
      return NextResponse.json({ error: err.message, code: err.hint ?? err.code }, { status: 409 });
    }
    if (err.code === "42501") {
      return NextResponse.json({ error: "Keine Berechtigung (claude_agent darf nicht löschen)." }, { status: 403 });
    }
    console.error("agent api", action, e);
    return NextResponse.json({ error: "Serverfehler" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ action: string }> }) {
  return handle(req, (await ctx.params).action);
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ action: string }> }) {
  return handle(req, (await ctx.params).action);
}
