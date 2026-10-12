import { Pool, types } from "pg";

// DATE-Spalten als "JJJJ-MM-TT" zurückgeben statt als JS-Date (keine Zeitzonen-Verschiebung).
types.setTypeParser(types.builtins.DATE, (v) => v);

// Eine Verbindung pro Serverless-Instanz; als Benutzer claude_agent (kein DELETE).
let pool: Pool | null = null;

export function agentPool(): Pool {
  if (!pool) {
    const connectionString = process.env.AGENT_DATABASE_URL;
    if (!connectionString) throw new Error("AGENT_DATABASE_URL fehlt.");
    pool = new Pool({
      connectionString,
      max: 3,
      ssl: connectionString.includes("localhost") ? undefined : { rejectUnauthorized: false },
    });
  }
  return pool;
}
