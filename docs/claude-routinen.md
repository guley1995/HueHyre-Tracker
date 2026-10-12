# Claude-Routinen für den Tracker

Vorlagen für die geplanten Aufgaben aus dem Bauplan („Automatik“). Jede Routine nutzt die Agent-API
(`https://<app>/api/agent/<aktion>`, Header `Authorization: Bearer <AGENT_API_KEY>`). Claude löscht nichts
und verschickt keine Mails – es schreibt Entwürfe und Einträge, du gibst frei.

## Werktags 7:30 – Gmail prüfen

> Prüfe in Gmail (bewerbung@, info@, hgueley@) alle Mails seit dem letzten Lauf.
> Für jede Bewerbung: `search_candidates` mit E-Mail und Telefon. Gibt es die Person schon, trage die Mail mit
> `add_activity` (type `Mail`, direction `ein`, link = Gmail-Link) an ihrer Karte ein. Sonst `upsert_candidate`
> mit Name, E-Mail, Telefon, Ort, `source: "Gmail"` (oder Indeed/BA, je nach Absender),
> `next_action: "Qualifizieren"`, `next_action_date`: heute. Meldet die API eine Dublette, nichts neu anlegen,
> sondern die Aktivität an der gemeldeten K-Nummer eintragen.
> Antworten von Firmen: `search_companies`, dann `add_activity` an der Firma; bei einer Antwort zu einer
> Vorstellung zusätzlich an der Kandidatenkarte.
> Am Ende: Liste „neu angelegt“, „zugeordnet“, „unklar“ (unklar = nichts eingetragen, bitte prüfen).

## Werktags 7:45 – Morgen-Briefing

> Rufe `get_today` auf und schicke mir eine kurze Nachricht: fällig heute, überfällig, ohne Wiedervorlage,
> eingeschlafen (14+ Tage) – je Zeile Name/K-Nr. bzw. Firma, nächste Aktion, Tage still. Dazu die neuen
> Bewerber aus dem 7:30-Lauf. Maximal 25 Zeilen, wichtigste (Prio A, überfällig) zuerst.

## Montags 8:00 – Wochen-Durchgang

> Hole mit `search_candidates` (je `stage`, `limit` 200) und `search_companies` alle offenen Karten und liste sie
> nach Board-Spalte. Schlage vor: Pausieren (30+ Tage still, keine aktive Vorstellung), Raus (Absagen ohne neue
> Option), Nachfassen (Vorstellung älter als 10 Tage ohne Rückmeldung). Nichts selbst verschieben – nur Vorschläge.

## Bei Bedarf – Stellenmatching

> Suche neue Stellen bei Firmen aus dem Tracker (Karriereseiten, `careers_url`) und lege sie mit `upsert_job`
> an (`last_checked_date`: heute). Für jede neue Stelle: passende Kandidaten mit `search_candidates`
> (Kategorie, Ort) und `create_presentation` mit `dry_run: true` prüfen. Schlage mir nur Kandidaten vor, bei denen
> `blocking` leer ist; Hinweise aus `confirm`/`hints` mit angeben. Vorstellungen lege ich selbst an.
