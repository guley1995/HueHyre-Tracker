import { timingSafeEqual } from "node:crypto";

/** Prüft "Authorization: Bearer <key>" gegen einen erwarteten Schlüssel (zeitkonstant). */
export function checkBearer(header: string | null, expected: string | undefined): boolean {
  if (!expected || expected.length < 16 || !header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice(7).trim());
  const want = Buffer.from(expected);
  return given.length === want.length && timingSafeEqual(given, want);
}
