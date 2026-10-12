import { NextResponse, type NextRequest } from "next/server";
import { describeActions } from "@/lib/agent/handlers";
import { checkBearer } from "@/lib/agent/auth";

export const runtime = "nodejs";

/** Liste aller Aktionen mit JSON-Schema – damit Claude die API selbst entdecken kann. */
export async function GET(req: NextRequest) {
  if (!checkBearer(req.headers.get("authorization"), process.env.AGENT_API_KEY)) {
    return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  }
  return NextResponse.json({
    usage: "POST /api/agent/<aktion> mit JSON-Body; Header Authorization: Bearer <AGENT_API_KEY>. Kein DELETE.",
    actions: describeActions(),
  });
}
