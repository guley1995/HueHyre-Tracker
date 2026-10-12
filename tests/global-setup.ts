import { execFileSync } from "node:child_process";
import pg from "pg";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/huehyre_test";

export default async function setup() {
  execFileSync("scripts/db-test-reset.sh", { stdio: "inherit", env: { ...process.env, TEST_DATABASE_URL } });
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  // Wie in Produktion: claude_agent als eigener Login (Passwort nur für Tests).
  await client.query("alter role claude_agent login password 'agent-test'");
  await client.end();
}
