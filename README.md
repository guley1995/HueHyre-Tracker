# HueHYRE Tracker

Internes Recruiting-CRM für HueHYRE – gebaut nach dem [Bauplan](docs/Bauplan.md).
Eine Datenbank, zwei Kanban-Boards (Kandidaten, Firmen/Leadliste), Startseite „Heute“,
Schutzregeln direkt in der Datenbank und ein eigener Zugang für Claude.

**Stack:** Next.js 15 (App Router, TypeScript) · Tailwind 4 + shadcn/ui-Stil · dnd-kit ·
Supabase (Postgres, Auth, Storage, Region eu-central-1) · Vercel.

---

## Was drin ist

| Bereich | Wo |
|---|---|
| Datenmodell (10 Tabellen + `ba_profiles`) | `supabase/migrations/…_schema.sql` |
| Schutzregeln, Trigger, Spaltenwechsel mit Pflichtfeldern | `supabase/migrations/…_rules.sql` |
| Ansichten „Heute“, Karten, Suche, Matching · Rollen · RLS | `supabase/migrations/…_views_security.sql` |
| Storage-Buckets `cvs` und `exports` | `supabase/migrations/…_storage.sql` |
| Oberfläche (Heute, Boards, Detailseiten, Matching, Suche, Schnellerfassung, BA-Pool, Einstellungen) | `src/app/(app)/…` |
| Agent-API für Claude | `src/app/api/agent/…`, `src/lib/agent/handlers.ts` |
| Nächtlicher Export (Vercel Cron) | `src/app/api/cron/export`, `src/lib/export.ts` |
| Einmaliger Excel-Import mit Prüfbericht | `scripts/import/` |
| Sync-Skript für den Mac (Export holen, Import-Ordner) | `scripts/sync/` |
| Tests | `tests/` |

### Die Regeln sitzen in der Datenbank

Alle Prüfungen laufen als Postgres-Funktionen. Oberfläche und Claude rufen dieselben Funktionen auf –
niemand kann sie umgehen.

| Regel | Umsetzung |
|---|---|
| Eine K-Nummer pro Person, automatisch | Trigger vergibt `K-2026-065` fortlaufend je Jahr; manuelles Setzen/Ändern wird verhindert. Alte Doppelnummern in `legacy_k_nrs` (Suche findet sie auch). |
| Dublette | Unique-Index auf E-Mail und normalisierte Telefonnummer; `create_candidate` meldet zusätzlich Name+PLZ/Ort („Existiert schon als K-2026-xx“). Zusammenführen in der Detailansicht. |
| Doppelte Vorstellung | Unique-Index `presentations(candidate_id, company_id)`; Schwesterfirmen über `companies.group_name` (z. B. Humbaur/Kögel) → nur mit Bestätigung. |
| Selbst beworben, Sperren, Tabu | `check_presentation` → Stopp mit Grund. |
| Einwilligung | Ohne `consent_date` kein Wechsel nach „Vermarktbar“ (Trigger) und keine nicht-anonyme Vorstellung. |
| Stellencheck | `last_checked_date` älter als 7 Tage → Hinweis „Anzeige erst prüfen“. |
| Pflichtfelder je Spalte | `move_candidate` / `move_company` – fehlt etwas, öffnet die App ein kurzes Formular. |
| Zeitstrahl | Jede Änderung von Spalte/nächster Aktion schreibt eine Zeile in `activities` (mit `created_by` Hüsnü/Claude/Import). |
| Wiedervorlage, Funkstille | Ansicht `today_items`: fällig heute, überfällig, ohne Datum (rot), 14 Tage still. |
| Löschfrist | Ansicht `deletion_due` → Liste in Einstellungen, Löschen nur nach Eingabe der K-Nummer. |

---

## Einrichtung

### 1. Supabase-Projekt

1. Neues Projekt auf [supabase.com](https://supabase.com), **Region: Central EU (Frankfurt) / eu-central-1**.
2. Migrationen einspielen – entweder mit der Supabase-CLI:
   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push
   ```
   oder die vier Dateien aus `supabase/migrations/` in dieser Reihenfolge im SQL-Editor ausführen.
3. **Authentication → Providers → Email:** „Allow new users to sign up“ **ausschalten**.
   Dann unter **Authentication → Users → Add user** dein Konto (E-Mail + Passwort) anlegen.
   Nur so angelegte Nutzer kommen in die App.
4. **Project Settings → API → Max rows:** auf `5000` setzen (Standard 1000; Boards laden alle Karten).
5. **Zugang für Claude** – im SQL-Editor ein starkes Passwort setzen:
   ```sql
   alter role claude_agent with login password '<langes-zufallspasswort>';
   ```
   `claude_agent` darf lesen, anlegen und ändern, aber **nichts löschen** und nicht zusammenführen.

### 2. Umgebungsvariablen

`.env.example` nach `.env.local` kopieren und ausfüllen:

| Variable | Woher |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | ebenda (geheim! nur Server/Mac) |
| `AGENT_API_KEY` | selbst erzeugen: `openssl rand -hex 32` |
| `AGENT_DATABASE_URL` | Supabase → Connect → Transaction pooler, Benutzer `claude_agent.<project-ref>` und das Passwort aus Schritt 1.5 |
| `CRON_SECRET` | selbst erzeugen: `openssl rand -hex 32` |
| `NEXT_PUBLIC_BA_PROFILE_URL` | optional: Link-Vorlage zur BA-Bewerberbörse mit `{ref}` |

### 3. Deployment auf Vercel

1. Repository in Vercel importieren, Region **Frankfurt (fra1)** wählen.
2. Alle Variablen aus Schritt 2 (außer den lokalen `TEST_…`/`TRACKER_…`) unter Settings → Environment Variables eintragen.
3. Deploy. Der Cron aus `vercel.json` ruft täglich `/api/cron/export` auf
   (`0 0 * * *` UTC = 2:00 Uhr Sommerzeit / 1:00 Uhr Winterzeit).

### 4. Bestehende Daten übernehmen (einmalig)

Benötigt `IMPORT_DATABASE_URL` = direkte Verbindung als `postgres` (Supabase → Connect → Session pooler oder Direct).

```bash
# 1. Ansehen, welche Blätter/Spalten erkannt werden
npm run import -- --inspect \
  --gesamtliste "HueHYRE_Bewerber_Gesamtliste.xlsx" --master "HueHYRE_Kandidaten_Master.xlsx" \
  --leads "HueHYRE_Akquise_Leads_2026-09-23.xlsx" --leads "Kaltakquise_Firmen_2026-09-23.xlsx"

# 2. Probelauf: schreibt nichts, erzeugt aber den Prüfbericht import-report-…-probelauf.md
IMPORT_DATABASE_URL=… npm run import -- --dry-run --gesamtliste … --master … --leads … --leads …

# 3. Echter Import (+ CVs/Profil-PDFs aus einem Ordner; Dateiname muss die K-Nr. enthalten)
IMPORT_DATABASE_URL=… npm run import -- --gesamtliste … --master … --leads … --leads … --cv-dir "…/CVs"
```

Zuordnung wie im Bauplan, Abschnitt „Datenübernahme“:

- **Kategorie → Spalte:** Aktiv → 3–5 je nach Status (Interview/Angebot/vorgestellt), Pausiert → Pausiert,
  Vermarktet/Kontakt → 2 Qualifizieren, Angeschrieben → 1 Neu, Absage/Raus → Raus,
  Nur gescreent/Maron → **Pool** (nicht auf dem Board), Gesperrt → Raus + Sperrliste.
- **K-Nummern:** bei mehreren Nummern pro Person bleibt die niedrigste, die anderen landen in `legacy_k_nrs`.
  Zwei verschiedene Personen mit derselben Nummer: die zweite bekommt eine neue, die alte steht in `legacy_k_nrs`.
  Personen nur im Blatt „K-Nummern“ werden als Pool angelegt und im Bericht gemeldet.
- **Vorstellungen:** nur Einträge **mit Datum**; Firmen ohne Datum stehen als Warnung im Bericht.
  Matches ohne Datum werden Stellen mit Art „Vorschlag“.
- **Klarnamen-Lücken** (z. B. „Tahsin E.“, nur ein Vorname) werden markiert, nicht geraten.
- Der Import erkennt Spalten über gängige Namen (`scripts/import/transform.ts`, `CANDIDATE_COLS` usw.).
  Passt eine Spalte nicht, zeigt `--inspect` die echten Spaltennamen – Alias ergänzen, erneut laufen lassen.
  Ein zweiter Lauf legt nichts doppelt an.

### 5. Sync-Skript auf dem Mac

```bash
git clone … && cd huehyre-tracker && npm install
cp .env.example .env.local   # TRACKER_EXPORT_DIR, TRACKER_IMPORT_DIR, TRACKER_API_URL, AGENT_API_KEY, Supabase-Werte
npm run sync                 # einmal von Hand testen
```

Danach `scripts/sync/de.huehyre.tracker-sync.plist` anpassen (Projektpfad, `which node`) und mit `launchctl load` aktivieren
(Anleitung steht in der Datei). Das Skript

- legt `Tracker-Export/HueHYRE_Tracker_JJJJ-MM-TT.xlsx` und `Tracker-Export/JJJJ-MM-TT/*.csv|json` ab, hält 30 Stände
  und spiegelt den neuesten Stand nach `Tracker-Export/aktuell/` (fester Pfad für Claude);
- übernimmt CSV-Dateien aus `Tracker-Import/` über die Agent-API (mit Dublettenprüfung).
  Dateiname bestimmt die Art: `kandidaten*.csv`, `firmen*.csv`, `stellen*.csv`, `ba*.csv`;
  Spaltennamen = Feldnamen der API (z. B. `first_name;last_name;email;phone;source`).
  Danach liegen Datei und Ergebnis in `Tracker-Import/erledigt/`.

---

## Claude-Zugang

Claude arbeitet wie ein Mitarbeiter mit eigenem, eingeschränktem Zugang: lesen, anlegen, Status setzen,
Aktivitäten eintragen – nichts löschen, keine Mails versenden. Alles, was Claude schreibt, steht im
Zeitstrahl mit dem Kennzeichen „Claude“.

**Agent-API** (empfohlen) – `POST https://<app>/api/agent/<aktion>`, Header `Authorization: Bearer <AGENT_API_KEY>`:

| Aktion | Zweck |
|---|---|
| `search_candidates` | `{query?, stage?, category?, limit?}` – Name, K-Nr. (auch alte), E-Mail, Telefon, Ort, Skills |
| `get_candidate` | `{k_nr \| id}` – Stammdaten, Vorstellungen, Selbstbewerbungen, Zeitstrahl, Sperren |
| `upsert_candidate` | ohne `k_nr`/`id`: anlegen mit Dublettenprüfung; mit: ändern. Optional `stage` + `stage_payload` |
| `search_companies`, `get_company` | Firmen inkl. Ansprechpartner, Stellen, Vorstellungen |
| `upsert_company` | anlegen/ändern (Abgleich über den Namen), optional `stage` + `stage_payload` |
| `upsert_job` | Stelle anlegen/aktualisieren (z. B. Stellencheck: `last_checked_date`, `status`) |
| `create_presentation` | `{k_nr, company_name, job_id?, anonymous?, confirm?, dry_run?}` – mit allen Prüfungen, gibt `blocking`/`confirm`/`hints` zurück |
| `add_activity` | `{entity_type, k_nr \| company_name \| entity_id, type, direction?, summary, link?}` |
| `upsert_ba_profile` | BA-Treffer per Referenznummer |
| `get_today` | fällig heute, überfällig, ohne Datum, eingeschlafen |

`GET /api/agent` liefert alle Aktionen mit JSON-Schema. Beispiel:

```bash
curl -s https://<app>/api/agent/upsert_candidate -H "Authorization: Bearer $AGENT_API_KEY" \
  -d '{"first_name":"Eva","last_name":"Muster","email":"eva@example.de","source":"Gmail","next_action":"Anrufen","next_action_date":"2026-10-13"}'
```

**Direkt auf die Datenbank:** Mit `claude_agent` und dem Passwort aus Schritt 1.5 kann sich Claude auch über einen
Postgres-MCP-Server verbinden – gleiche Rechte (kein DELETE). Den offiziellen Supabase-MCP-Connector nur mit
`--read-only` nutzen, da er sonst Vollzugriff hat.

**Geplante Aufgaben** (Gmail 7:30, Morgen-Briefing 7:45, Wochen-Durchgang Montag 8:00, Stellenmatching) sind
Claude-Routinen, keine App-Funktionen. Vorlagen für die Prompts: [docs/claude-routinen.md](docs/claude-routinen.md).

---

## Entwicklung und Tests

```bash
npm install
npm run dev          # http://localhost:3000 (braucht .env.local mit Supabase-Projekt)
npm run typecheck && npm run lint
npm test             # braucht ein lokales Postgres (TEST_DATABASE_URL), spielt alle Migrationen frisch ein
```

Die Tests laufen gegen ein echtes Postgres mit den echten Migrationen (Rollen `authenticated` und `claude_agent`
wie in Produktion). Abgedeckt sind die Abnahmepunkte aus dem Bauplan:

- [x] Testperson mit gleicher E-Mail wird als Dublette erkannt (`tests/rules.test.ts`)
- [x] Zweite Vorstellung bei derselben Firma wird gestoppt, Kögel nach Humbaur nur mit Bestätigung
- [x] Gesperrte Person (Osbra-Mitarbeiter) kann nicht vorgestellt werden
- [x] Karte ohne `next_action_date` erscheint in „Heute“
- [x] Claude legt über die Agent-API einen Kandidaten an und trägt eine Aktivität ein (`tests/agent.test.ts`)
- [x] `claude_agent` kann nicht löschen
- [x] Import: Spaltenzuordnung, Dubletten, K-Nummern, Klarnamen-Lücken, Probelauf, zweiter Lauf ohne Dubletten (`tests/import.test.ts`)
- [ ] Alle 418 Bewerber, 493 BA-Profile und Firmen importiert – erst mit den echten Excel-Dateien
- [ ] Export-Datei morgens im Ordner `Tracker-Export` – nach Deployment + Sync-Einrichtung

---

## Abweichungen vom Datenmodell – bitte bestätigen

Der Bauplan sagt „Frage nach, bevor du vom Datenmodell abweichst“. Diese kleinen Ergänzungen waren nötig;
alles andere ist exakt wie im Bauplan:

1. **`companies.group_name`** – für Schwesterfirmen (steht so im Bau-Auftrag, Punkt 4).
2. **`ba_profiles.candidate_id`** – merkt sich, zu welchem Kandidaten ein BA-Profil umgewandelt wurde.
3. **`blocklist.scope`** hat die Werte `alle` / `nur_firma`; bei `nur_firma` steht die Firma in `company_id`
   (statt Freitext „nur Firma X“), damit die Prüfung automatisch greift.
4. **Hilfstabelle `k_nr_counters`** – laufende Nummer je Jahr für die K-Nummern.
5. **Zusätzliche erlaubte Werte:** Quelle `Sonstige` (Kandidaten/Firmen), Stellen-Art `Vorschlag`
   (reine Matches aus dem Import), `created_by = Import` (Zeitstrahl der Datenübernahme), Spalte `pool`.
6. **Keine eigenen Felder** für Interview-Termin, Angebotsgehalt und „Raus“-Grund: Interview setzt die Vorstellung
   auf `interview` und die nächste Aktion auf den Termin; Angebot steht in der Vorstellung (`status`, `notes`);
   Gründe stehen im Zeitstrahl. „Selbst beworben bei“ gilt als abgefragt, wenn ein Eintrag existiert oder
   „Nirgends selbst beworben“ im Zeitstrahl steht.

Datenschutz-Hinweis aus dem Bauplan gilt weiter: Löschfristen bitte rechtlich klären – das ist keine Rechtsberatung.
