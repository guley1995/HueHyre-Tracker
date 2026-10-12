# HueHyre Tracker – Bauplan

Oct 12, 2026 · @Hüsnü Güley

## Kurzfassung

Gebaut wird eine kleine Web-App mit **einer** Datenbank, zwei Kanban-Boards und einer Liste „Heute fällig“: ein Board für Kandidaten, eines für Firmen (die Leadliste). Claude bekommt einen eigenen Zugang zur Datenbank und schreibt jede Nacht eine Kopie in den Projektordner.

Warum: Heute liegen Bewerber in rund zehn Dateien und Postfächern verteilt. Am 12.10. tauchten beim Zusammenführen 19 Kandidaten mit K-Nummer auf, die nicht mehr im Master standen, und 5 Personen mit doppelter K-Nummer. Die App verhindert das mit drei Regeln:

- Jede Person existiert genau einmal und hat genau eine K-Nummer.
- Jeder offene Kandidat und jede offene Firma hat eine nächste Aktion mit Datum.
- Jede Vorstellung (Kandidat → Firma) ist ein eigener Datensatz. Die App warnt bei Doppelvorstellung und Sperren.

Startbestand: 418 Bewerber, 493 anonyme BA-Profile und die Firmen aus Leadliste und Master (siehe Datenübernahme).

## Technik und Zugriff

Empfehlung: **Supabase (Postgres) als Datenbank + Next.js-App auf Vercel**, beides in der EU-Region Frankfurt. Das ist in 1–2 Wochen gebaut, kostet am Anfang 0 € und ist eine echte Datenbank, auf die Claude von überall zugreifen kann.

| Baustein | Wahl | Grund |
| --- | --- | --- |
| Datenbank | Supabase Postgres, Region eu-central-1 (Frankfurt) | DSGVO, Backups, Rechte pro Tabelle, kostenloser Einstieg |
| App | Next.js (App Router), TypeScript, Tailwind, shadcn/ui | Schnell gebaut, läuft im Browser und am Handy |
| Kanban | dnd-kit (Drag and Drop) | Karten zwischen Spalten ziehen |
| Login | Supabase Auth, nur dein Konto (später Mitarbeiter) | Kein öffentlicher Zugang |
| Hosting | Vercel (Free/Hobby, später Pro) | Ein Klick pro Update |
| Dateien (CVs, Profile-PDFs) | Supabase Storage, ein Ordner pro K-Nummer | CV hängt direkt am Kandidaten |

**Wie Claude zugreift – drei Wege, alle drei einbauen:**

1. **Direkt auf die Datenbank** über einen eigenen Zugang (Supabase-MCP-Connector oder eine kleine REST-API mit API-Schlüssel). Damit kann Claude lesen, Kandidaten anlegen, Status setzen und Aktivitäten eintragen – auch in der Cloud, wenn dein Mac aus ist.
2. **Nächtlicher Export in den Projektordner** (`Personalvermittlungen HueHyre/Tracker-Export/`): eine Excel-Datei und je Tabelle eine CSV/JSON. So hast du immer eine lesbare Kopie, und Claude kann über den Ordner arbeiten.
3. **Import-Ordner** (`Tracker-Import/`): Claude oder du legen dort CSV-Dateien ab (z. B. neue BA-Treffer), die App übernimmt sie mit Dubletten-Prüfung.

Alternative: Das Ganze als Modul in hyre.hr bauen. Das lohnt sich, wenn hyre.hr schon dieselbe Technik nutzt – das Datenmodell unten passt in beide Fälle.

## Datenmodell

Neun Tabellen. Herzstück ist `presentations`: Sie verbindet Kandidat, Firma und Stelle und belegt jede Vorstellung mit Datum und Zustimmung. Alle Tabellen haben zusätzlich `id` (uuid), `created_at`, `updated_at`.

| Tabelle | Wichtige Felder | Hinweise |
| --- | --- | --- |
| `candidates` | `k_nr` (eindeutig, auto: K-2026-065 …), `first_name`, `last_name`, `email`, `phone`, `plz`, `city`, `profile_title`, `skills` (Text), `category` (Technik/Kaufm./Vertrieb/Logistik/IT), `salary_wish`, `available_from`, `notice_period`, `radius_km`, `remote_wish`, `exclusions` (z. B. „keine Kanzlei“), `source` (Indeed/BA/Gmail/Empfehlung/Maron/Telefon), `stage`, `priority` (A/B/C), `next_action`, `next_action_date`, `consent_date`, `consent_scope`, `delete_after`, `cv_file`, `notes`, `legacy_k_nrs` (alte Doppel-Nummern) | Dubletten-Prüfung über E-Mail, Telefon (normalisiert) und Name+Ort |
| `companies` | `name`, `legal_name`, `city`, `plz`, `industry`, `size`, `website`, `careers_url`, `stage`, `priority`, `pays_agencies` (ja/nein/unklar), `fee_agreed` (z. B. 25 % / 20 % Erstbesetzung), `agb_sent_date`, `next_action`, `next_action_date`, `source` (Leadliste/Endkunden-Recherche/Empfehlung), `notes` | Leadliste = alle Firmen mit `stage` vor „Kunde“ |
| `contacts` | `company_id`, `name`, `role`, `email`, `phone`, `linkedin`, `notes` | Ansprechpartner (z. B. Selin Ünsal, Tanja Hasler) |
| `jobs` | `company_id`, `title`, `city`, `url`, `source_type` (eigene Anzeige/Vermittler-Anzeige/Mandat/initiativ), `salary_range`, `posted_date`, `last_checked_date`, `status` (online/offline/besetzt), `ref_no`, `notes` | `last_checked_date` = Stellencheck vor jedem Pitch |
| `presentations` | `candidate_id`, `company_id`, `job_id` (optional), `sent_date`, `channel` (Mail/Telefon/Portal), `anonymous` (ja/nein), `consent_given_date`, `status`, `result_date`, `rejection_reason`, `gmail_thread_id`, `notes` | Eindeutig je Kandidat+Firma – zweiter Versuch nur mit Bestätigung |
| `self_applications` | `candidate_id`, `company_name`, `date`, `result` | „Wo hast du dich selbst beworben?“ – schützt vor Provisionsstreit |
| `activities` | `entity_type` (candidate/company), `entity_id`, `type` (Mail/Anruf/SMS/WhatsApp/Indeed/BA/Notiz/Status), `direction` (ein/aus), `occurred_at`, `summary`, `link`, `created_by` (Hüsnü/Claude) | Zeitstrahl je Karte; jede Statusänderung schreibt automatisch eine Zeile |
| `placements` | `presentation_id`, `start_date`, `annual_salary`, `fee_percent`, `fee_amount`, `invoice_date`, `paid_date`, `guarantee_until`, `split_partner` (z. B. Oliver Mikus 50/50) | Honorar und Garantie im Blick |
| `blocklist` | `type` (Person/Firma/Regel), `name`, `candidate_id`/`company_id`, `scope` (alle / nur Firma X), `reason` | Sperren aus „Sperren & Tabus“, z. B. Osbra-Mitarbeiter, STEP-2.0-Kunden |

Zusätzlich eine kleine Tabelle `ba_profiles` für anonyme BA-Treffer (`ref_no`, `search`, `qualification`, `age`, `city`, `contacted_date`, `reply`). Wenn jemand antwortet, wird daraus per Klick ein Kandidat.

## Kanban-Boards

Zwei Boards mit festen Spalten. Eine Karte darf nur weiter, wenn die Pflichtfelder der Zielspalte gefüllt sind; sonst öffnet die App ein kurzes Formular.

**Board Kandidaten**

| Spalte | Bedeutung | Pflicht beim Hineinziehen |
| --- | --- | --- |
| 1 Neu | Bewerbung oder Antwort eingegangen | Quelle, Kontaktweg |
| 2 Qualifizieren | Telefonat geplant/geführt | Termin oder Gesprächsnotiz |
| 3 Vermarktbar | Profil fertig, Einwilligung liegt vor | `consent_date`, Gehalt, Verfügbarkeit, Ausschlüsse, „selbst beworben bei“ |
| 4 Vorgestellt | Mindestens eine aktive Vorstellung | mindestens 1 Eintrag in `presentations` |
| 5 Interview | Termin bei einer Firma | Firma + Datum |
| 6 Angebot | Vertragsangebot liegt vor | Firma, Gehalt |
| 7 Platziert | Vertrag unterschrieben | Eintrag in `placements` (Start, Gehalt, Honorar) |
| Pausiert | Sucht gerade nicht (z. B. Borowinski) | Wiedervorlage-Datum |
| Raus | Absage, nicht vermittelbar, gesperrt | Grund |

**Board Firmen (Leadliste)**

| Spalte | Bedeutung | Pflicht |
| --- | --- | --- |
| 1 Lead | Firma mit passender Stelle gefunden | Quelle, mindestens 1 Stelle oder Grund |
| 2 Angeschrieben | Erste Mail/Anruf raus | Datum, Ansprechpartner falls bekannt |
| 3 Im Gespräch | Antwort, Interesse, Fragen | Notiz |
| 4 Konditionen | AGB/Angebot verschickt | `agb_sent_date`, `fee_agreed` |
| 5 Kunde aktiv | Arbeitet mit dir (z. B. Kirstein) | Honorarsatz |
| Ruhend | Kein Bedarf gerade (z. B. SURTECO Einstellungsstopp) | Wiedervorlage-Datum |
| Tabu | Nie anschreiben | Grund (z. B. NDA STEP 2.0, hat abgelehnt) |

**Regeln für beide Boards**

- Jede Karte außer „Platziert“, „Raus“ und „Tabu“ hat `next_action_date`. Ohne Datum: rote Markierung.
- Karte zeigt: Name/K-Nr. bzw. Firma, Prio, Ort, nächste Aktion mit Datum, Tage seit letzter Aktivität, Anzahl aktiver Vorstellungen.
- Spaltenwechsel schreibt automatisch eine Zeile in `activities`.
- Filter über beiden Boards: Prio, Kategorie, Region, Quelle, „überfällig“.

## Ansichten

Sieben Screens reichen. Startseite ist „Heute“, nicht das Board – so siehst du zuerst, was fällig ist.

1. **Heute** – drei Listen: fällig heute, überfällig, seit 14 Tagen keine Aktivität. Je Zeile ein Knopf „erledigt + nächste Aktion“.
2. **Board Kandidaten** – Kanban wie oben, umschaltbar auf Tabellenansicht (sortier- und filterbar, Export nach Excel).
3. **Board Firmen** – Kanban der Leadliste, ebenfalls mit Tabellenansicht.
4. **Kandidat-Detail** – Stammdaten, CV-Vorschau, Vorstellungen (Firma, Datum, Status), „selbst beworben bei“, Zeitstrahl aller Aktivitäten, Sperren. Knopf „Vorstellen bei …“ startet die Doppel- und Sperrprüfung.
5. **Firma-Detail** – Ansprechpartner, offene Stellen mit letztem Stellencheck, alle vorgestellten Kandidaten, Konditionen, Zeitstrahl.
6. **Matching** – Stelle wählen → Liste passender Kandidaten (Kategorie, Ort/Radius, Gehalt, Verfügbarkeit), bereits vorgestellte und gesperrte ausgegraut.
7. **Suche + Schnellerfassung** – eine Suchleiste für alles (Name, K-Nr., Firma, Telefon). „+“ legt in 20 Sekunden einen Kandidaten an: Name, Kontakt, Quelle, nächste Aktion. Am Handy nutzbar, z. B. direkt nach einem Anruf.

Dazu ein Bereich **BA-Pool** (anonyme Referenznummern mit Link zur Bewerberbörse) und **Einstellungen** (Kategorien, Sperrliste, Export).

## Schutzregeln

Diese Prüfungen laufen in der Datenbank bzw. in der App, nicht nur als Hinweis im Kopf.

| Regel | Wann geprüft | Was passiert |
| --- | --- | --- |
| Dublette | Beim Anlegen/Import | Gleiche E-Mail, Telefon oder Name+PLZ → „Existiert schon als K-2026-xx“, Zusammenführen statt neu anlegen |
| Eine K-Nummer pro Person | Immer | K-Nummer wird automatisch vergeben, nie manuell; alte Doppelnummern stehen in `legacy_k_nrs` |
| Doppelte Vorstellung | Bei „Vorstellen bei …“ | Kandidat schon bei dieser Firma (oder Schwesterfirma, z. B. Humbaur/Kögel) → Warnung mit Datum der ersten Vorstellung |
| Selbst beworben | Bei „Vorstellen bei …“ | Firma steht in `self_applications` → Stopp |
| Sperren | Bei Vorstellung und Anschreiben | Treffer in `blocklist` (Person oder Firma, z. B. STEP-2.0-Kunden, Osbra-Mitarbeiter) → Stopp mit Grund |
| Einwilligung | Beim Wechsel nach „Vermarktbar“ und bei nicht-anonymer Vorstellung | Ohne `consent_date` kein Weiterschieben |
| Stellencheck | Bei Vorstellung mit Stelle | `last_checked_date` älter als 7 Tage → Hinweis „Anzeige erst prüfen“ |
| Wiedervorlage | Täglich | Offene Karte ohne `next_action_date` oder Datum vorbei → erscheint in „Heute“ |
| Funkstille | Täglich | 14 Tage ohne Aktivität → Liste „eingeschlafen“ |
| Löschfrist | Monatlich | `delete_after` erreicht → Liste zum Prüfen; Löschen nur nach Bestätigung |

Datenschutz kurz: Zugriff nur mit Login, Daten in Frankfurt, Einwilligung mit Datum und Umfang je Kandidat, Löschdatum als Vorschlag (z. B. 6 Monate nach letztem Kontakt bei Absage). Die genauen Fristen bitte einmal rechtlich klären – das ist keine Rechtsberatung.

## Claude-Anbindung und Automatik

Claude arbeitet wie ein Mitarbeiter mit eigenem, eingeschränktem Zugang: lesen, anlegen, Status setzen, Aktivitäten eintragen – aber nichts löschen und keine Mails selbst versenden.

**Zugang**

- Eigener Datenbank-Benutzer `claude_agent` mit Rechten nur auf die nötigen Tabellen (kein DELETE).
- Entweder über den Supabase-MCP-Connector oder über eine kleine API unter `/api/agent/*` mit API-Schlüssel. Endpunkte: Kandidat suchen, anlegen/aktualisieren, Firma suchen/anlegen, Vorstellung anlegen (mit allen Schutzregeln), Aktivität eintragen, Liste „Heute“ abrufen.
- Jede Änderung von Claude bekommt `created_by = Claude` und ist im Zeitstrahl sichtbar.

**Automatik (geplante Aufgaben)**

| Wann | Was | Ergebnis |
| --- | --- | --- |
| Werktags 7:30 | Gmail (bewerbung@, info@, hgueley@) auf neue Bewerbungen und Antworten prüfen | Neue Kandidaten in „Neu“, Antworten als Aktivität an der richtigen Karte |
| Werktags 7:45 | Morgen-Briefing | Kurze Nachricht an dich: fällig heute, überfällig, eingeschlafen, neue Bewerber |
| Täglich 2:00 | Export in den Projektordner | `Tracker-Export/HueHYRE_Tracker_JJJJ-MM-TT.xlsx` + CSV/JSON je Tabelle, letzte 30 Stände behalten |
| Montags 8:00 | Wochen-Durchgang | Liste aller offenen Karten nach Board-Spalte, Vorschläge für Pausieren/Raus |
| Bei Bedarf | Stellenmatching | Claude sucht neue Stellen, legt sie als `jobs` an und schlägt Vorstellungen vor – du gibst frei |

So gibt es immer drei Stellen, an denen die Daten liegen: die Datenbank (aktuell), der nächtliche Export im Ordner (Kopie) und Supabase-Backups (Notfall).

## Datenübernahme

Alles Bestehende kommt per einmaligem Import-Skript rein; die Quelldateien bleiben als Archiv im Ordner.

| Quelle (Projektordner) | Ziel | Zuordnung |
| --- | --- | --- |
| `HueHYRE_Bewerber_Gesamtliste.xlsx`, Blatt „Alle Bewerber“ (418) | `candidates` | Kategorie → Spalte: Aktiv → je nach Status 3–5, Pausiert → Pausiert, Vermarktet/Kontakt → 2 Qualifizieren, Angeschrieben → 1 Neu, Absage/Raus → Raus, Nur gescreent + Maron → eigener Status „Pool“ (nicht auf dem Board, nur in der Tabelle), Gesperrt → `blocklist` |
| Blatt „K-Nummern“ | `candidates.k_nr`, `legacy_k_nrs` | Bei Doppelten die niedrigere Nummer behalten (Steinle K-32, Mezger K-34, Wittler K-47, Hettich K-39, Graf K-52) |
| Spalte „Firmen (vorgestellt …)“ + Master-Blatt „Matching“ (120 Zeilen) | `presentations`, `jobs`, `companies` | Nur Einträge mit Datum als Vorstellung, reine Matches als `jobs`-Vorschlag |
| Master-Blatt „Offene Stellen“ (120) | `jobs` + `companies` | Online-Check-Datum → `last_checked_date` |
| `HueHYRE_Akquise_Leads_2026-09-23.xlsx`, `Kaltakquise_Firmen_2026-09-23.xlsx`, Endkunden-Recherche | `companies` (Board Firmen) | Status → Spalte Lead/Angeschrieben/Im Gespräch |
| Blatt „Sperren & Tabus“ + Master „Tabu & Regeln“ | `blocklist` | Firmen als Tabu-Karte, Personen mit `scope` |
| Blatt „BA-Bewerberbörse (anonym)“ (493) | `ba_profiles` | 1:1 |
| CVs und `Profil_K-2026-xx_HueHYRE.pdf` | Storage, Ordner je K-Nr. | Dateiname enthält K-Nr. |

Vor dem Import: Kandidaten mit Klarnamen-Lücke (K-03, K-09, K-38, Tahsin E.) markieren, nicht raten. Nach dem Import ein Prüfbericht: Anzahl je Tabelle, abgelehnte Zeilen, gefundene Dubletten.

## Bauphasen und Abnahme

Nach Phase 1 arbeitest du schon nur noch im Tracker; Excel-Listen werden ab dann nicht mehr gepflegt.

&#91;embedded content: Bauphasen · 3 Phasen, 2 Abnahmen\]

Die Dauer ist eine Schätzung für Claude Code mit deiner Begleitung; mit einem externen Entwickler eher 2–3 Wochen. Laufende Kosten am Anfang 0 € (Supabase Free, Vercel Hobby), später ca. 25 $/Monat für Supabase Pro mit täglichen Backups.

**Abgenommen ist es, wenn:**

- [ ] Alle 418 Bewerber, 493 BA-Profile und die Firmen importiert sind, Prüfbericht ohne offene Fehler
- [ ] Eine Testperson mit gleicher E-Mail als Dublette erkannt wird
- [ ] Eine zweite Vorstellung bei derselben Firma (oder Kögel nach Humbaur) gestoppt wird
- [ ] Eine gesperrte Person (z. B. Osbra-Mitarbeiter) nicht vorgestellt werden kann
- [ ] Jede offene Karte ein Wiedervorlage-Datum hat oder in „Heute“ rot erscheint
- [ ] Claude über die Agent-API einen Kandidaten anlegen und eine Aktivität eintragen kann
- [ ] Morgens die Export-Datei im Ordner `Tracker-Export` liegt

## Bau-Auftrag zum Kopieren

Diesen Text 1:1 an Claude Code oder einen Entwickler geben, zusammen mit diesem Dokument (Export als Markdown) und der Datei `HueHYRE_Bewerber_Gesamtliste.xlsx`.

```markdown
Baue "HueHYRE Tracker": ein internes Recruiting-CRM für eine Ein-Personen-Personalvermittlung.

Stack: Next.js 15 (App Router, TypeScript), Tailwind + shadcn/ui, dnd-kit, Supabase (Postgres, Auth, Storage, Region eu-central-1). Deployment auf Vercel. Sprache der Oberfläche: Deutsch.

1. Datenbank: Lege die Tabellen candidates, companies, contacts, jobs, presentations, self_applications, activities, placements, blocklist, ba_profiles exakt wie im Abschnitt "Datenmodell" an, als Supabase-Migrationen. RLS aktiv: nur eingeloggte Nutzer; zusätzliche Rolle claude_agent ohne DELETE-Recht.
2. K-Nummer automatisch per Sequenz (Format K-2026-065, Jahr aus Datum), unique. legacy_k_nrs als Text-Array.
3. Trigger: jede Änderung von stage oder next_action_date schreibt eine Zeile in activities. Unique-Index auf presentations(candidate_id, company_id).
4. Schutzregeln aus Abschnitt "Schutzregeln" als Server-Funktionen (Postgres-Funktion oder Server Action) umsetzen: Dublettenprüfung, Doppelvorstellung inkl. Schwesterfirmen (Feld companies.group_name), self_applications, blocklist, Einwilligung, Stellencheck älter 7 Tage.
5. Screens aus Abschnitt "Ansichten": Heute (Startseite), Board Kandidaten, Board Firmen (Spalten und Pflichtfelder aus "Kanban-Boards"), Detailseiten mit Zeitstrahl, Matching, globale Suche, Schnellerfassung (mobil tauglich), BA-Pool, Einstellungen. Jedes Board auch als filterbare Tabelle mit Excel-Export.
6. Agent-API unter /api/agent/* mit Bearer-API-Key: search_candidates, upsert_candidate, search_companies, upsert_company, create_presentation (mit allen Prüfungen, gibt Warnungen zurück), add_activity, get_today. Jede Schreibaktion setzt created_by='Claude'. Kein DELETE.
7. Nächtlicher Export (Supabase Cron oder Vercel Cron, 2:00): alle Tabellen als XLSX (ein Blatt je Tabelle) + CSV/JSON nach Supabase Storage /exports; ein kleines Sync-Skript (Node, läuft auf dem Mac per launchd) kopiert die neueste Datei in den Ordner "Personalvermittlungen HueHyre/Tracker-Export" und hält 30 Stände.
8. Import-Skript (einmalig, Node/TS): liest HueHYRE_Bewerber_Gesamtliste.xlsx und HueHYRE_Kandidaten_Master.xlsx, mappt wie im Abschnitt "Datenübernahme", führt Dubletten zusammen und schreibt einen Prüfbericht.
9. Tests: Dublette wird erkannt; zweite Vorstellung bei gleicher Firma wird blockiert; gesperrte Person kann nicht vorgestellt werden; Karte ohne next_action_date erscheint in "Heute".
10. Liefere README mit Setup (Supabase-Projekt, Env-Variablen, API-Key für Claude, Deployment) und eine .env.example.

Frage nach, bevor du vom Datenmodell abweichst.
```
