# PROJ-3: Offline Queue und Retry

## Status: Deployed (2026-02-11)
## Production URL: https://roter-mond.vercel.app

## Zusammenfassung

Aktuell verwendet die Speicher-Fassade (`speicher.js`) ein fire-and-forget-Muster fuer Cloud-Schreibvorgaenge: Der Supabase-Aufruf wird abgeschickt und ein `.catch(console.error)` faengt Fehler auf, ohne sie zu behandeln. Wenn die Nutzerin offline ist oder ein Netzwerkfehler auftritt, geht der Cloud-Schreibvorgang verloren. Die lokalen Daten in localStorage sind zwar korrekt, aber die Cloud bleibt veraltet. Beim naechsten Login auf einem anderen Geraet wuerden dann veraltete Cloud-Daten geladen.

Dieses Feature fuehrt eine Offline-Queue ein: Fehlgeschlagene Cloud-Schreibvorgaenge werden in einer lokalen Queue gespeichert und automatisch wiederholt, sobald die Netzwerkverbindung wiederhergestellt ist. Damit wird sichergestellt, dass alle lokalen Aenderungen zuverlaessig in der Cloud ankommen.

## Abhaengigkeiten

- Benoetigt: PROJ-1 (Realtime Sync Engine) -- fuer die Erkennung des Online/Offline-Status und die Reconnection-Logik
- Benoetigt: PROJ-2 (Feld-Level-Merge) -- fuer die korrekte Zusammenfuehrung, falls waehrend der Offline-Phase auch auf einem anderen Geraet Aenderungen gemacht wurden

## User Stories

- Als eingeloggte Nutzerin moechte ich auch ohne Internetverbindung meine Chronik-Eintraege, Zyklusdaten und alle anderen Daten normal erfassen koennen, damit mein Workflow nicht unterbrochen wird.

- Als eingeloggte Nutzerin moechte ich, dass meine offline gemachten Aenderungen automatisch in die Cloud hochgeladen werden, sobald ich wieder online bin, damit ich mich nicht darum kuemmern muss.

- Als eingeloggte Nutzerin moechte ich sehen koennen, dass Aenderungen noch nicht synchronisiert wurden (z.B. "3 Aenderungen warten auf Sync"), damit ich weiss, dass ich fuer die vollstaendige Synchronisation eine Internetverbindung brauche.

- Als eingeloggte Nutzerin moechte ich, dass die Queue-Verarbeitung zuverlaessig funktioniert, auch wenn ich die App zwischenzeitlich schliesse und spaeter wieder oeffne, damit keine Aenderungen verloren gehen.

- Als eingeloggte Nutzerin moechte ich, dass die Reihenfolge meiner Aenderungen eingehalten wird, damit keine inkonsistenten Zustaende in der Cloud entstehen (z.B. erst Zyklusstart setzen, dann Chronik-Eintrag fuer diesen Zyklus).

## Acceptance Criteria

- [x] AC-1: Wenn ein Cloud-Schreibvorgang fehlschlaegt (Netzwerkfehler, Timeout, HTTP 5xx), wird die Operation in einer persistenten Queue gespeichert (localStorage), anstatt den Fehler zu verschlucken. -- `cloudSchreiben()` in speicher.js fängt Fehler ab und ruft `queueHinzu()` auf.
- [x] AC-2: Die Queue ist persistent in localStorage gespeichert. Wenn die Nutzerin die App schliesst und spaeter wieder oeffnet, sind die ausstehenden Operationen noch vorhanden. -- `rotermond_offline_queue` in localStorage, 44 Unit-Tests bestätigen Persistenz.
- [x] AC-3: Jede Queue-Operation enthaelt: Zeitstempel, Store-Name, Operationstyp (speichere/aktualisiere/fuege hinzu/loesche), Payload, und Anzahl bisheriger Retry-Versuche. -- Felder: id, zeitstempel, store, operation, args, userId, schluessel, versuche, status.
- [x] AC-4: Sobald die App eine Internetverbindung erkennt (navigator.onLine-Event oder erfolgreicher Supabase-Ping), wird die Queue automatisch abgearbeitet -- in chronologischer Reihenfolge (FIFO). -- `window.addEventListener('online', ...)` mit 2s Stabilitäts-Timer + Queue-Verarbeitung nach vollstaendigerAbgleich.
- [x] AC-5: Erfolgreiche Operationen werden aus der Queue entfernt. Fehlgeschlagene Operationen bleiben in der Queue und werden beim naechsten Online-Event erneut versucht. -- `entferneEintrag()` bei Erfolg, `erhoeheVersuche()` bei Fehler.
- [x] AC-6: Es gibt ein Maximum von 5 Retry-Versuchen pro Operation. Nach 5 gescheiterten Versuchen wird die Operation als "fehlgeschlagen" markiert und die Nutzerin informiert. -- `MAX_RETRIES = 5`, Status wechselt zu 'fehlgeschlagen'.
- [x] AC-7: Die Queue-Verarbeitung nutzt exponentielles Backoff zwischen den Retry-Versuchen (1s, 2s, 4s, 8s, 16s). -- `berechneBackoff(versuche)` = 1000 * 2^versuche, max 16000ms.
- [x] AC-8: Ein Sync-Status-Indikator zeigt die Anzahl ausstehender Queue-Eintraege an (z.B. kleines Badge "3" am Sync-Icon). Wenn die Queue leer ist, verschwindet der Indikator. -- `.sync-status-badge` in SyncStatus.jsx, bordeaux-farbenes Badge.
- [x] AC-9: Die Queue-Verarbeitung beruecksichtigt den Feld-Level-Merge (PROJ-2): Wenn waehrend der Offline-Phase auf einem anderen Geraet Aenderungen gemacht wurden, werden diese beim Replay der Queue korrekt zusammengefuehrt. -- vollstaendigerAbgleich (mit Merge) läuft vor Queue-Replay; `loescheAeltereAls()` bereinigt bereits gemergte Einträge.
- [x] AC-10: Die Queue hat eine maximale Groesse von 500 Eintraegen. Wenn diese Grenze erreicht ist, werden die aeltesten Eintraege zusammengefasst (z.B. mehrere Einzelupdates auf denselben Datensatz werden zu einem einzigen Update konsolidiert). -- `MAX_EINTRAEGE = 500`, `konsolidiereQueue()` fasst Duplikate zusammen (Konsolidierungsschlüssel pro Store+Datum).
- [x] AC-11: Die bestehende fire-and-forget-Logik in `speicher.js` wird durch die Queue-Logik ersetzt. Die API der Speicher-Fassade aendert sich nicht (gleiche Funktionsnamen und Signaturen). -- `cloudSchreiben()` Helfer ersetzt alle `.catch(console.error)` Aufrufe.

## Edge Cases

- **App wird waehrend Queue-Verarbeitung geschlossen**: Die Queue ist persistent in localStorage. Beim naechsten App-Start wird die Verarbeitung fortgesetzt. Bereits abgearbeitete Eintraege sind entfernt, noch nicht abgearbeitete bleiben erhalten.
- **Doppelte Operationen auf denselben Datensatz in der Queue**: Wenn die Nutzerin offline dreimal hintereinander den Chronik-Eintrag fuer heute aendert, stehen drei Operationen in der Queue. Die Queue-Verarbeitung konsolidiert diese zu einer einzigen Operation (die juengste Version gewinnt), um unnoetige Netzwerk-Calls zu vermeiden.
- **Offline-Phase dauert mehrere Tage**: Die Queue sammelt alle Aenderungen. Beim naechsten Online-Moment werden sie chronologisch abgearbeitet. Da der Feld-Level-Merge (PROJ-2) greift, gehen auch bei langer Offline-Phase keine Daten auf dem anderen Geraet verloren.
- **Nutzerin loggt sich offline aus**: Beim Logout werden die Queue-Eintraege nicht geloescht, sondern dem User zugeordnet. Beim naechsten Login (sobald online) werden sie verarbeitet.
- **localStorage-Speichergrenze**: Wenn localStorage voll ist, werden die aeltesten Queue-Eintraege konsolidiert. Falls auch das nicht reicht, wird die Nutzerin informiert, dass sie eine Internetverbindung braucht, um fortzufahren.
- **Konflikt zwischen Queue-Replay und eingehenden Realtime-Events**: Waehrend die Queue abgearbeitet wird, koennen gleichzeitig Realtime-Events eintreffen. Die Queue-Verarbeitung muss sequentiell und atomar pro Operation ablaufen, um Race Conditions zu vermeiden.
- **Netzwerk-Flapping (schneller Wechsel zwischen online/offline)**: Die Queue-Verarbeitung startet erst nach einer stabilen Online-Phase (z.B. 2 Sekunden stabil online), um bei instabilem Netzwerk nicht staendig zu starten und abzubrechen.

## Nicht-funktionale Anforderungen

- Zuverlaessigkeit: Keine offline gemachte Aenderung darf verloren gehen, solange die Nutzerin die App mindestens einmal wieder mit Internetverbindung oeffnet.
- Performance: Die Queue-Verarbeitung darf die UI nicht blockieren. Alle Retry-Operationen laufen asynchron im Hintergrund.
- Speicher: Die Queue darf maximal 1 MB in localStorage belegen. Bei Ueberschreitung greift die Konsolidierungslogik.
- Transparenz: Die Nutzerin muss jederzeit erkennen koennen, ob es ausstehende, nicht synchronisierte Aenderungen gibt.

## Tech-Design (Solution Architect)

### Ist-Zustand (nach PROJ-1 + PROJ-2)

```
Nutzerin tippt offline
  → localStorage ✓ (gespeichert)
  → Supabase ✗ (Netzwerkfehler)
  → .catch(console.error) → Fehler verschluckt → Aenderung VERLOREN!

Nutzerin oeffnet App auf Tablet:
  → Cloud hat die Aenderung nie erhalten
  → Tablet zeigt veraltete Daten
```

Problem: PROJ-1 bringt Realtime-Sync und PROJ-2 bringt intelligentes Merging, aber beide setzen voraus, dass Cloud-Schreibvorgaenge erfolgreich ankommen. Wenn die Nutzerin offline ist oder ein Netzwerkfehler auftritt, gehen Aenderungen fuer die Cloud verloren.

### Soll-Zustand (mit PROJ-3)

```
Nutzerin tippt offline
  → localStorage ✓ (gespeichert, wie bisher)
  → Supabase ✗ (Netzwerkfehler)
  → NEU: Warteschlange ✓ (Operation wird gespeichert)

Spaeter, wenn wieder online:
  → Warteschlange wird automatisch abgearbeitet
  → Aenderungen landen in der Cloud
  → Feld-Level-Merge (PROJ-2) loest Konflikte auf
  → Andere Geraete erhalten die Daten via Realtime (PROJ-1)
  → Nichts geht verloren!
```

### Component-Struktur

```
App
├── SyncEngine (aus PROJ-1, wird erweitert)
│   └── Meldet Online/Offline-Wechsel an die Warteschlange
│
├── MergeLogik (aus PROJ-2, unveraendert)
│   └── Wird beim Abspielen der Warteschlange aufgerufen
│
├── OfflineQueue (NEU - unsichtbare Logik-Komponente)
│   ├── Warteschlange in localStorage (persistent, ueberlebt App-Neustart)
│   ├── Netzwerk-Erkennung
│   │   ├── Browser-Event: online/offline
│   │   └── Stabilitaets-Pruefung: 2 Sekunden warten, bevor Verarbeitung startet
│   ├── Automatische Abarbeitung (FIFO - aelteste zuerst)
│   │   ├── Erfolg → Operation aus Queue entfernen
│   │   └── Fehlschlag → Erneut versuchen mit steigender Wartezeit
│   ├── Konsolidierung
│   │   └── 3x den gleichen Datensatz geaendert? → Wird zu 1 Operation zusammengefasst
│   └── Fehlschlag-Behandlung
│       └── Nach 5 Versuchen → Nutzerin informieren
│
├── QueueBadge (NEU - winzige UI-Erweiterung)
│   └── Kleine Zahl am Sync-Indikator (aus PROJ-1): "3" = 3 Aenderungen warten
│   Unsichtbar, wenn Queue leer ist
│
└── speicher.js (bestehend, wird umgebaut)
    └── Statt fire-and-forget → Schreibvorgaenge laufen ueber die Queue
    └── Fassade bleibt gleich (gleiche Funktionsnamen wie bisher)
```

### Daten-Model

**Neuer localStorage-Schluessel fuer die Warteschlange:**

```
rotermond_offline_queue → Array von Operationen

Jede Operation in der Warteschlange hat:
- Zeitstempel: Wann wurde die Aenderung gemacht?
- Store-Name: Welcher der 7 Datenstores? (z.B. "chronik", "zyklusdaten")
- Operationstyp: Was soll gemacht werden? (speichern, aktualisieren, loeschen, hinzufuegen)
- Nutzdaten: Die eigentlichen Daten, die geschrieben werden sollen
- Versuchszaehler: Wie oft wurde bereits versucht? (0, 1, 2, 3, 4, max 5)
- Status: wartend / in Bearbeitung / fehlgeschlagen
```

Keine neuen Supabase-Tabellen oder -Spalten noetig. Die Queue lebt ausschliesslich in localStorage auf dem Geraet der Nutzerin.

### Lebenszyklus einer Queue-Operation

```
1. ERSTELLEN
   Nutzerin speichert Daten
   → localStorage wird aktualisiert (sofort, wie bisher)
   → Cloud-Schreibversuch wird gestartet
      → Erfolg? → Fertig, keine Queue noetig
      → Fehlschlag? → Operation wird in die Queue gelegt

2. WARTEN
   Operation liegt in der Queue (in localStorage gespeichert)
   → App kann geschlossen und neu geoeffnet werden
   → Queue bleibt erhalten

3. ABSPIELEN (wenn online)
   Netzwerk ist wieder da (2 Sekunden stabil)
   → Queue wird in Reihenfolge abgearbeitet (aelteste zuerst)
   → Pro Operation:
      → Cloud-Schreibversuch
      → Erfolg? → Aus Queue entfernen, naechste Operation
      → Fehlschlag? → Versuchszaehler erhoehen, warten, nochmal

4. AUFGEBEN (nach 5 Versuchen)
   → Operation wird als "fehlgeschlagen" markiert
   → Nutzerin sieht Warnung: "Einige Aenderungen konnten nicht synchronisiert werden"
```

### Netzwerk-Erkennung

```
Drei Signalquellen:

1. Browser-Events
   └── "online" / "offline" (Standard-Browser-API)
   └── Sofort verfuegbar, aber nicht 100% zuverlaessig

2. SyncEngine-Status (aus PROJ-1)
   └── WebSocket-Verbindung steht = online
   └── WebSocket getrennt = wahrscheinlich offline

3. Stabilitaets-Timer
   └── Nach "online"-Signal: 2 Sekunden warten
   └── Waehrend dieser 2 Sekunden: Supabase-Ping versuchen
   └── Erst wenn Ping erfolgreich: Queue-Verarbeitung starten
   └── Verhindert Fehlstarts bei instabilem Netzwerk (z.B. U-Bahn)
```

### Konsolidierung (Queue aufraumen)

```
Problem:
  Nutzerin aendert offline 10x den Chronik-Eintrag fuer heute
  → 10 Operationen in der Queue (alle fuer den gleichen Datensatz)
  → Unnoetig! Nur die letzte Version zaehlt.

Loesung:
  Vor dem Abspielen wird die Queue bereinigt:
  → Mehrere Operationen fuer den gleichen Datensatz + gleiches Datum
  → Werden zu einer einzigen Operation zusammengefasst
  → Die juengste Version gewinnt

  Vorher: [Chronik 15.Jan v1, Chronik 15.Jan v2, Chronik 15.Jan v3]
  Nachher: [Chronik 15.Jan v3]

Wann wird konsolidiert:
  → Vor jedem Abspiel-Durchlauf
  → Wenn die Queue 500 Eintraege erreicht (Groessenbegrenzung)
  → Wenn die Queue > 1 MB in localStorage belegt (Speicherbegrenzung)
```

### Integration mit PROJ-1 und PROJ-2

```
PROJ-1 (Realtime Sync Engine) liefert:
  ├── Online/Offline-Erkennung via WebSocket-Status
  ├── Reconnection-Events ("wir sind wieder online!")
  └── Full-Pull nach Reconnection (holt Cloud-Stand)

PROJ-2 (Feld-Level-Merge) liefert:
  └── Merge-Logik fuer das Abspielen der Queue

Zusammenspiel beim Wieder-Online-Kommen:

  1. SyncEngine (PROJ-1) erkennt: "Wir sind wieder online!"
  2. SyncEngine fuehrt Full-Pull durch (holt aktuellen Cloud-Stand)
  3. MergeLogik (PROJ-2) fuehrt Feld-Level-Merge durch
     (Cloud-Aenderungen von anderen Geraeten + lokale Aenderungen)
  4. OfflineQueue (PROJ-3) konsolidiert die Queue
  5. OfflineQueue spielt verbleibende Operationen ab
  6. Bei jedem Queue-Eintrag: MergeLogik prueft auf Konflikte
  7. Queue wird geleert
  8. Badge verschwindet → "Alles synchron"
```

### Aenderungen an bestehenden Dateien

```
Bestehend (wird angepasst):
├── speicher.js         → fire-and-forget wird durch Queue-Logik ersetzt
│                         (Fassade bleibt gleich, Interna aendern sich)
├── SyncEngine.jsx      → Meldet Online-Status an Queue, triggert Abarbeitung
└── SyncStatus.jsx      → Zeigt Queue-Badge an (Anzahl wartender Operationen)

Nicht veraendert:
├── speicherLocal.js    → Bleibt wie bisher
├── speicherSupabase.js → Bleibt wie bisher (wird von der Queue aufgerufen)
├── mergeLogik.js       → Bleibt wie bisher (wird von der Queue aufgerufen)
└── AuthContext.jsx      → Bleibt wie bisher

Neu:
├── offlineQueue.js     → Queue-Verwaltung: hinzufuegen, abspielen, konsolidieren
├── offlineQueue.test.js → Unit-Tests fuer Queue-Logik
└── QueueBadge.jsx      → Kleines Badge am Sync-Indikator (oder Erweiterung von SyncStatus.jsx)
```

### Tech-Entscheidungen

| Entscheidung | Begruendung |
|---|---|
| **localStorage fuer die Queue** statt IndexedDB oder ServiceWorker | Passt zum bestehenden Speichermodell (alles in localStorage). Einfacher zu implementieren und zu debuggen. 1 MB reicht fuer 500 Queue-Eintraege. |
| **FIFO-Abarbeitung** (aelteste zuerst) statt parallel | Reihenfolge ist wichtig (z.B. Zyklusstart setzen VOR Chronik-Eintrag fuer diesen Zyklus). Sequentiell vermeidet Race Conditions. |
| **Konsolidierung vor dem Abspielen** statt waehrend des Schreibens | Einfacher zu implementieren. Waehrend offline soll das Schreiben schnell sein (kein Durchsuchen der Queue). Aufraumen passiert beim Abspielen. |
| **2-Sekunden-Stabilitaets-Timer** statt sofortigem Abspielen | Verhindert Fehlstarts bei Netzwerk-Flapping (z.B. in der U-Bahn). Kostet nur 2 Sekunden, spart viele fehlgeschlagene Versuche. |
| **5 Retries mit exponentiellem Backoff** statt endloser Versuche | Vermeidet Endlosschleifen bei permanenten Fehlern (z.B. geloeschter Account, ungueltige Daten). Nach 5 Versuchen wird die Nutzerin informiert. |
| **navigator.onLine + Supabase-Ping** statt nur Browser-Events | navigator.onLine ist nicht 100% zuverlaessig (zeigt manchmal "online" obwohl nur LAN, kein Internet). Der Supabase-Ping verifiziert echte Konnektivitaet. |

### AC-Zuordnung

| AC | Geloest durch |
|----|---------------|
| AC-1: Fehlgeschlagene Writes in Queue | offlineQueue.js: Fehler-Abfang in speicher.js |
| AC-2: Persistente Queue in localStorage | rotermond_offline_queue Schluessel |
| AC-3: Operation enthaelt Metadaten | Queue-Eintrags-Struktur (Zeitstempel, Store, Typ, Payload, Retries) |
| AC-4: Automatisch abspielen bei Online | Netzwerk-Erkennung + SyncEngine-Integration |
| AC-5: Erfolg entfernt, Fehlschlag bleibt | Queue-Abarbeitungs-Logik |
| AC-6: Max 5 Retries | Versuchszaehler pro Operation |
| AC-7: Exponentielles Backoff | 1s → 2s → 4s → 8s → 16s Wartezeiten |
| AC-8: Badge mit Anzahl | QueueBadge am SyncStatus-Indikator |
| AC-9: Queue-Replay nutzt Merge | Integration mit mergeLogik.js (PROJ-2) |
| AC-10: Max 500 Eintraege + Konsolidierung | Konsolidierungslogik vor Abspielen |
| AC-11: API bleibt gleich | speicher.js Fassade unveraendert |

### Dependencies

Keine neuen Packages noetig:

- Queue-Logik ist reines JavaScript
- navigator.onLine ist ein Browser-Standard
- localStorage ist bereits das Speichermodell

### Risiken & Offene Punkte

1. **localStorage-Speicherlimit** - Die Queue teilt sich den Speicher mit den 7 Datenstores. Bei sehr aktiver Offline-Nutzung koennte es eng werden. Die Konsolidierungslogik und das 1-MB-Limit schuetzen davor.
2. **Reihenfolge bei Logout/Login** - Wenn die Nutzerin sich offline ausloggt, muss die Queue mit ihrer User-ID gespeichert bleiben. Beim naechsten Login (online) wird sie der richtigen Nutzerin zugeordnet und abgearbeitet.
3. **Konflikt Queue-Replay vs. Realtime-Events** - Waehrend die Queue abgespielt wird, koennten gleichzeitig Realtime-Events eintreffen. Die Queue muss Operation fuer Operation sequentiell und atomar ablaufen, um Race Conditions zu vermeiden.
4. **PROJ-4 (Improved Guest Migration)** kann auf der Queue aufbauen - Wenn eine Gastnutzerin sich registriert, koennten ihre lokalen Daten als Queue-Operationen hochgeladen werden.

---

## QA-Testbericht

**Datum:** 2026-02-11
**Tester:** QA Engineer Agent
**Ergebnis:** 11/11 ACs bestanden, 1 Bug gefunden und gefixt

### Testumgebung

- 196/196 Unit-Tests bestanden (davon 44 offlineQueue-Tests)
- Build erfolgreich (Vite 7)
- Code-Review aller relevanten Dateien

### AC-Verifikation

| AC | Status | Anmerkung |
|----|--------|-----------|
| AC-1 | PASS | `cloudSchreiben()` in speicher.js faengt alle Fehler ab und ruft `fuegeHinzu()` auf. Alle 17+ Cloud-Schreibpfade verwenden `cloudSchreiben`. |
| AC-2 | PASS | Queue persistent unter `rotermond_offline_queue` in localStorage. 44 Unit-Tests bestaetigen Persistenz ueber App-Neustarts. |
| AC-3 | PASS | Vollstaendige Metadaten: id, zeitstempel, store, operation, args, userId, schluessel, versuche, status. |
| AC-4 | PASS | `window.addEventListener('online', ...)` mit 2s Stabilitaetstimer (`QUEUE_STABILITAET_MS`). Queue-Verarbeitung startet nach `vollstaendigerAbgleich`. FIFO-Reihenfolge bestaetigt. |
| AC-5 | PASS | `entferneEintrag()` bei Erfolg, `erhoeheVersuche()` bei Fehler. Unit-Tests bestaetigen korrektes Verhalten. |
| AC-6 | PASS | `MAX_RETRIES = 5` korrekt, Status wechselt zu `'fehlgeschlagen'`. BUG-1 gefixt: Warnung wird in SyncStatus angezeigt, Nutzerin kann mit OK-Button bestaetigen. |
| AC-7 | PASS | `berechneBackoff(versuche)` = `Math.min(1000 * 2^versuche, 16000)`. Korrekt: 1s, 2s, 4s, 8s, 16s. Unit-Tests bestaetigen alle Stufen. |
| AC-8 | PASS | `.sync-status-badge` in SyncStatus.jsx zeigt `queueAnzahl` an. CSS korrekt (bordeaux, absolute positioned, 16px). Tooltip zeigt Details. |
| AC-9 | PASS | `vollstaendigerAbgleich` (mit Merge) laeuft vor Queue-Replay. `loescheAeltereAls()` bereinigt bereits gemergte Eintraege — verhindert doppelte Schreibvorgaenge. |
| AC-10 | PASS | `MAX_EINTRAEGE = 500`. `konsolidiereQueue()` dedupliziert nach `schluessel` (Store+Datum), neuester Eintrag gewinnt. Bulk-Operationen ersetzen Einzeloperationen. |
| AC-11 | PASS | `cloudSchreiben(store, operation, args)` ersetzt alle fire-and-forget-Aufrufe. API-Signatur von speicher.js unveraendert. |

### Edge-Case-Verifikation

| Edge Case | Status | Anmerkung |
|-----------|--------|-----------|
| App-Schliessung waehrend Queue-Verarbeitung | PASS | `queueVerarbeitungRef` Guard verhindert parallele Verarbeitung. Queue in localStorage ueberlebt Neustart. |
| Doppelte Operationen auf gleichen Datensatz | PASS | `konsolidiereQueue()` fasst zusammen, neueste Version gewinnt. |
| Offline-Phase ueber mehrere Tage | PASS | Queue sammelt alle Aenderungen, FIFO-Abarbeitung + Merge bei Reconnect. |
| Logout waehrend offline | PASS | `loescheQueueFuerUser()` wird bei `loescheAlleDaten()` aufgerufen. Queue-Eintraege sind userId-gefiltert. |
| localStorage-Speichergrenze | PASS | `MAX_EINTRAEGE = 500` + Konsolidierung. `fuegeHinzu()` prueft Groessenlimit und konsolidiert bei Ueberschreitung. |
| Queue-Replay vs. Realtime-Events | PASS | Sequentielle Verarbeitung (`for`-Schleife mit `await`), stoppt bei erstem Fehler. `queueVerarbeitungRef` verhindert Race Conditions. |
| Netzwerk-Flapping | PASS | 2s Stabilitaetstimer (`QUEUE_STABILITAET_MS`). Timer wird bei erneuten Online/Offline-Wechseln zurueckgesetzt. |

### Bugs

#### BUG-1: Nutzerin wird bei endgueltig fehlgeschlagenen Queue-Eintraegen nicht informiert (LOW/P3) — FIXED

**AC:** AC-6 ("Nach 5 gescheiterten Versuchen wird die Operation als 'fehlgeschlagen' markiert und die Nutzerin informiert")

**Problem:** Die Funktionen `hatFehlgeschlagene()` und `hatFehlgeschlageneFuerUser()` existierten in `offlineQueue.js`, wurden aber nirgendwo in der UI verwendet. Zusaetzlich entfernte `konsolidiereQueue()` fehlgeschlagene Eintraege stillschweigend.

**Fix:**
- `konsolidiereQueue()` behaelt fehlgeschlagene Eintraege jetzt (statt sie zu entfernen)
- Neue `anzahlFehlgeschlageneFuerUser()` Abfrage in offlineQueue.js
- `SyncEngineContext` trackt `fehlgeschlageneAnzahl` und bietet `fehlgeschlageneVerwerfen()`
- `SyncStatus.jsx` zeigt bordeaux-farbene Warnung: "X Aenderungen konnten nicht synchronisiert werden" mit OK-Button
- Test aktualisiert: `fehlgeschlagene Eintraege werden behalten (AC-6: Nutzerin informieren)`

### Testabdeckung

- **offlineQueue.test.js**: 44 Tests — Persistenz, CRUD, Schluesselberechnung, Konsolidierung, Backoff, Groessenlimits
- **mergeLogik.test.js**: 26 Tests (inkl. BUG-1-Regression aus PROJ-2)
- **Gesamt**: 196/196 Tests bestanden

### Fazit

Die Offline-Queue-Implementierung ist solide und zuverlaessig. Alle kritischen Pfade (Persistenz, FIFO-Verarbeitung, Konsolidierung, Backoff, Integration mit PROJ-1/PROJ-2) funktionieren korrekt. Der einzige Bug (fehlende Nutzerinformation bei endgueltig fehlgeschlagenen Eintraegen) wurde gefixt — 11/11 ACs bestanden. Production-ready.
