// ---------------------------------------------------------------------------
// SyncEngine: Supabase Realtime Sync für Cross-Device-Updates
//
// Lauscht auf Postgres-Changes via WebSocket und aktualisiert localStorage
// + React-State, sodass die UI ohne manuellen Reload aktuell bleibt.
// Funktioniert nur für eingeloggte Nutzerinnen (Gast-Modus = rein lokal).
//
// PROJ-2: Verwendet Feld-Level-Merge statt Überschreiben, damit Änderungen
// von verschiedenen Geräten kombiniert werden können.
// ---------------------------------------------------------------------------

import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../utils/supabase.js'
import { useAuth } from './AuthContext.jsx'
import { setOnWriteCallback, setOnQueueChangeCallback } from '../utils/speicher.js'
import * as cloud from '../utils/speicherSupabase.js'
import * as local from '../utils/speicherLocal.js'
import {
  schluesselVonDatum,
  mergeEinzelobjekt,
  mergeArrayNachSchluessel,
  mergeChronik,
  mergeGanzesObjekt,
  mergeAlleStores,
} from '../utils/mergeLogik.js'
import {
  TABELLEN,
  DEBOUNCE_MS,
  EIGENES_EVENT_AUFRAEUM_MS,
  SICHTBARKEIT_MIN_ABSTAND_MS,
  FULL_PULL_RETRIES,
  FULL_PULL_RETRY_DELAY_MS,
  findeEigenesEvent,
  berechneBackoffDelay,
} from '../utils/syncHelpers.js'
import {
  anzahlWartendFuerUser,
  anzahlFehlgeschlageneFuerUser,
  entferneFehlgeschlagene,
  loescheAeltereAls,
  verarbeiteQueue,
  berechneBackoff as queueBackoff,
} from '../utils/offlineQueue.js'

const SyncEngineContext = createContext(null)

const MERGE_HINWEIS_DAUER_MS = 3000
const QUEUE_STABILITAET_MS = 2000
const QUEUE_MAX_RUNDEN = 5
const ZYKLUSDATEN_FELDER = ['zyklusStart', 'zyklusLaenge', 'zyklusTyp', 'ersteinrichtungAbgeschlossen']
const HINWEIS_FELDER = ['letzterHinweis', 'nutzerinHatAbgelehnt', 'ablehnungsDatum']

// ---------------------------------------------------------------------------
// Statische Hilfsfunktionen (kein Component-State nötig)
// ---------------------------------------------------------------------------

function ohneTs(arr) {
  return arr.map(({ feldZeitstempel, ...rest }) => rest)
}

/**
 * Extrahiert Cloud-Zeitstempel aus dem ladeAlleDaten-Ergebnis in das
 * Format, das mergeAlleStores erwartet.
 */
function extrahiereCloudZeitstempel(cloudRoh) {
  function arrayTs(eintraege, schluesselFn) {
    const ts = {}
    for (const e of eintraege) {
      const key = schluesselFn(e)
      if (key && e.feldZeitstempel) {
        ts[key] = e.feldZeitstempel._updated || ''
      }
    }
    return ts
  }

  function chronikTs(eintraege) {
    const ts = {}
    for (const e of eintraege) {
      const key = schluesselVonDatum(e.datum)
      if (key && e.feldZeitstempel) {
        ts[key] = e.feldZeitstempel
      }
    }
    return ts
  }

  return {
    zyklusdaten: cloudRoh.zyklusdaten?.feldZeitstempel || {},
    korrekturen: arrayTs(cloudRoh.korrekturen || [], (e) => schluesselVonDatum(e.datum)),
    historie: arrayTs(cloudRoh.historie || [], (e) => schluesselVonDatum(e.startdatum)),
    chronik: chronikTs(cloudRoh.chronik || []),
    tageskarten: arrayTs(cloudRoh.tageskarten || [], (e) => schluesselVonDatum(e.datum)),
    hinweis: cloudRoh.hinweis?.feldZeitstempel || {},
    grenzen: cloudRoh.grenzenMeta?.feldZeitstempel?._updated || '',
  }
}

/**
 * Entfernt feldZeitstempel aus Cloud-Daten, damit Merge-Ergebnisse
 * keine Zeitstempel-Fragmente in localStorage hinterlassen.
 */
function bereinigeCloudDaten(cloudRoh) {
  const { feldZeitstempel: _z, ...zyklusdaten } = cloudRoh.zyklusdaten || {}
  const { feldZeitstempel: _h, ...hinweis } = cloudRoh.hinweis || {}

  return {
    zyklusdaten,
    korrekturen: ohneTs(cloudRoh.korrekturen || []),
    historie: ohneTs(cloudRoh.historie || []),
    chronik: ohneTs(cloudRoh.chronik || []),
    tageskarten: ohneTs(cloudRoh.tageskarten || []),
    hinweis,
    grenzen: cloudRoh.grenzen,
  }
}

/**
 * Speichert das mergeAlleStores-Ergebnis in localStorage + Zeitstempel-Keys.
 */
function speichereMergeErgebnis(ergebnis) {
  const { daten, zeitstempel } = ergebnis

  local.speichereZyklusdaten(daten.zyklusdaten)
  local.speichereZeitstempel('ZYKLUSDATEN', zeitstempel.zyklusdaten)

  local.speichereKorrekturen(daten.korrekturen)
  local.speichereZeitstempel('KORREKTUREN', zeitstempel.korrekturen)

  local.speichereZyklushistorie(daten.historie)
  local.speichereZeitstempel('HISTORIE', zeitstempel.historie)

  local.speichereChronik(daten.chronik)
  local.speichereZeitstempel('CHRONIK', zeitstempel.chronik)

  local.speichereTageskarten(daten.tageskarten)
  local.speichereZeitstempel('TAGESKARTEN', zeitstempel.tageskarten)

  local.speichereZyklustypHinweis(daten.hinweis)
  local.speichereZeitstempel('ZYKLUSTYP_HINWEIS', zeitstempel.hinweis)

  if (daten.grenzen) {
    local.speichereAngepassteGrenzen(daten.grenzen)
  } else {
    local.setzeGrenzenZurueck()
  }
  local.speichereZeitstempel('ANGEPASSTE_GRENZEN', zeitstempel.grenzen)
}

/**
 * Pusht das Merge-Ergebnis zurück an Supabase – nur geänderte Stores.
 */
async function pusheMergeZurCloud(userId, ergebnis) {
  const { daten, zeitstempel, geaenderteStores } = ergebnis

  const aufgaben = []

  if (geaenderteStores.zyklusdaten) {
    aufgaben.push(cloud.speichereZyklusdaten(userId, {
      ...daten.zyklusdaten,
      feldZeitstempel: zeitstempel.zyklusdaten,
    }))
  }
  if (geaenderteStores.korrekturen) {
    aufgaben.push(cloud.speichereKorrekturen(userId, daten.korrekturen.map((k) => ({
      ...k,
      feldZeitstempel: { _updated: zeitstempel.korrekturen[schluesselVonDatum(k.datum)] || '' },
    }))))
  }
  if (geaenderteStores.zyklushistorie) {
    aufgaben.push(cloud.speichereZyklushistorie(userId, daten.historie.map((h) => ({
      ...h,
      feldZeitstempel: { _updated: zeitstempel.historie[schluesselVonDatum(h.startdatum)] || '' },
    }))))
  }
  if (geaenderteStores.chronik) {
    aufgaben.push(cloud.speichereChronik(userId, daten.chronik.map((e) => ({
      ...e,
      feldZeitstempel: zeitstempel.chronik[schluesselVonDatum(e.datum)] || {},
    }))))
  }
  if (geaenderteStores.tageskarten) {
    aufgaben.push(cloud.speichereTageskarten(userId, daten.tageskarten.map((k) => ({
      ...k,
      feldZeitstempel: { _updated: zeitstempel.tageskarten[schluesselVonDatum(k.datum)] || '' },
    }))))
  }
  if (geaenderteStores.zyklustyp_hinweis) {
    aufgaben.push(cloud.speichereZyklustypHinweis(userId, {
      ...daten.hinweis,
      feldZeitstempel: zeitstempel.hinweis,
    }))
  }
  if (geaenderteStores.angepasste_grenzen) {
    aufgaben.push(
      daten.grenzen
        ? cloud.speichereAngepassteGrenzen(userId, daten.grenzen, { _updated: zeitstempel.grenzen })
        : cloud.setzeGrenzenZurueck(userId),
    )
  }

  if (aufgaben.length > 0) {
    await Promise.all(aufgaben)
  }
}

/**
 * Mergt eine einzelne Tabelle (Cloud vs. Local) und speichert das Ergebnis.
 * Gibt true zurück wenn ein Merge stattfand (lokale Daten geändert).
 */
async function tabelleZusammenfuehren(tabelle, userId) {
  switch (tabelle) {
    case 'zyklusdaten': {
      const cloudData = await cloud.ladeZyklusdaten(userId)
      const { feldZeitstempel: cloudTs, ...cloudClean } = cloudData
      const lokalData = local.ladeZyklusdaten()
      const lokalTs = local.ladeZeitstempel('ZYKLUSDATEN')
      const result = mergeEinzelobjekt(lokalData, lokalTs, cloudClean, cloudTs || {}, ZYKLUSDATEN_FELDER)
      local.speichereZyklusdaten(result.daten)
      local.speichereZeitstempel('ZYKLUSDATEN', result.zeitstempel)
      if (result.geaendert) {
        await cloud.speichereZyklusdaten(userId, { ...result.daten, feldZeitstempel: result.zeitstempel })
      }
      return result.geaendert
    }

    case 'korrekturen': {
      const cloudEntries = await cloud.ladeKorrekturen(userId)
      const cloudTs = {}
      for (const k of cloudEntries) {
        const key = schluesselVonDatum(k.datum)
        if (key) cloudTs[key] = k.feldZeitstempel?._updated || ''
      }
      const lokalEntries = local.ladeKorrekturen()
      const lokalTs = local.ladeZeitstempel('KORREKTUREN')
      const result = mergeArrayNachSchluessel(
        lokalEntries, lokalTs, ohneTs(cloudEntries), cloudTs,
        (e) => schluesselVonDatum(e.datum),
      )
      local.speichereKorrekturen(result.daten)
      local.speichereZeitstempel('KORREKTUREN', result.zeitstempel)
      if (result.geaendert) {
        const mitTs = result.daten.map((k) => ({
          ...k,
          feldZeitstempel: { _updated: result.zeitstempel[schluesselVonDatum(k.datum)] || '' },
        }))
        await cloud.speichereKorrekturen(userId, mitTs)
      }
      return result.geaendert
    }

    case 'zyklushistorie': {
      const cloudEntries = await cloud.ladeZyklushistorie(userId)
      const cloudTs = {}
      for (const h of cloudEntries) {
        const key = schluesselVonDatum(h.startdatum)
        if (key) cloudTs[key] = h.feldZeitstempel?._updated || ''
      }
      const lokalEntries = local.ladeZyklushistorie()
      const lokalTs = local.ladeZeitstempel('HISTORIE')
      const result = mergeArrayNachSchluessel(
        lokalEntries, lokalTs, ohneTs(cloudEntries), cloudTs,
        (e) => schluesselVonDatum(e.startdatum),
      )
      local.speichereZyklushistorie(result.daten)
      local.speichereZeitstempel('HISTORIE', result.zeitstempel)
      if (result.geaendert) {
        const mitTs = result.daten.map((h) => ({
          ...h,
          feldZeitstempel: { _updated: result.zeitstempel[schluesselVonDatum(h.startdatum)] || '' },
        }))
        await cloud.speichereZyklushistorie(userId, mitTs)
      }
      return result.geaendert
    }

    case 'chronik': {
      const cloudEntries = await cloud.ladeChronik(userId)
      const cloudTs = {}
      for (const e of cloudEntries) {
        const key = schluesselVonDatum(e.datum)
        if (key) cloudTs[key] = e.feldZeitstempel || {}
      }
      const lokalEntries = local.ladeChronik()
      const lokalTs = local.ladeZeitstempel('CHRONIK')
      const result = mergeChronik(lokalEntries, lokalTs, ohneTs(cloudEntries), cloudTs)
      local.speichereChronik(result.daten)
      local.speichereZeitstempel('CHRONIK', result.zeitstempel)
      if (result.geaendert) {
        const mitTs = result.daten.map((e) => ({
          ...e,
          feldZeitstempel: result.zeitstempel[schluesselVonDatum(e.datum)] || {},
        }))
        await cloud.speichereChronik(userId, mitTs)
      }
      return result.geaendert
    }

    case 'tageskarten': {
      const cloudEntries = await cloud.ladeTageskarten(userId)
      const cloudTs = {}
      for (const k of cloudEntries) {
        const key = schluesselVonDatum(k.datum)
        if (key) cloudTs[key] = k.feldZeitstempel?._updated || ''
      }
      const lokalEntries = local.ladeTageskarten()
      const lokalTs = local.ladeZeitstempel('TAGESKARTEN')
      console.log(`[SyncEngine] 🃏 tageskarten merge: cloud=${cloudEntries.length}, lokal=${lokalEntries.length}`)
      const result = mergeArrayNachSchluessel(
        lokalEntries, lokalTs, ohneTs(cloudEntries), cloudTs,
        (e) => schluesselVonDatum(e.datum),
      )
      console.log(`[SyncEngine] 🃏 tageskarten merge result: daten=${result.daten.length}, geaendert=${result.geaendert}`)
      local.speichereTageskarten(result.daten)
      local.speichereZeitstempel('TAGESKARTEN', result.zeitstempel)
      if (result.geaendert) {
        const mitTs = result.daten.map((k) => ({
          ...k,
          feldZeitstempel: { _updated: result.zeitstempel[schluesselVonDatum(k.datum)] || '' },
        }))
        await cloud.speichereTageskarten(userId, mitTs)
      }
      return result.geaendert
    }

    case 'zyklustyp_hinweis': {
      const cloudData = await cloud.ladeZyklustypHinweis(userId)
      const { feldZeitstempel: cloudTs, ...cloudClean } = cloudData
      const lokalData = local.ladeZyklustypHinweis()
      const lokalTs = local.ladeZeitstempel('ZYKLUSTYP_HINWEIS')
      const result = mergeEinzelobjekt(lokalData, lokalTs, cloudClean, cloudTs || {}, HINWEIS_FELDER)
      local.speichereZyklustypHinweis(result.daten)
      local.speichereZeitstempel('ZYKLUSTYP_HINWEIS', result.zeitstempel)
      if (result.geaendert) {
        await cloud.speichereZyklustypHinweis(userId, { ...result.daten, feldZeitstempel: result.zeitstempel })
      }
      return result.geaendert
    }

    case 'angepasste_grenzen': {
      const cloudResult = await cloud.ladeAngepassteGrenzen(userId)
      const cloudGrenzen = cloudResult.grenzen
      const cloudTs = cloudResult.feldZeitstempel?._updated || ''
      const lokalGrenzen = local.ladeAngepassteGrenzen()
      const lokalTs = local.ladeZeitstempel('ANGEPASSTE_GRENZEN')
      const result = mergeGanzesObjekt(lokalGrenzen, lokalTs, cloudGrenzen, cloudTs)
      if (result.daten) {
        local.speichereAngepassteGrenzen(result.daten)
      } else {
        local.setzeGrenzenZurueck()
      }
      local.speichereZeitstempel('ANGEPASSTE_GRENZEN', result.zeitstempel)
      if (result.geaendert) {
        if (result.daten) {
          await cloud.speichereAngepassteGrenzen(userId, result.daten, { _updated: result.zeitstempel })
        } else {
          await cloud.setzeGrenzenZurueck(userId)
        }
      }
      return result.geaendert
    }

    default:
      return false
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function SyncEngineProvider({ children }) {
  const { user } = useAuth()
  const userId = user?.id || null

  const [syncStatus, setSyncStatus] = useState('getrennt')
  const [syncVersion, setSyncVersion] = useState(0)
  const [letzterSync, setLetzterSync] = useState(null)
  const [mergeHinweis, setMergeHinweis] = useState(false)
  const [queueAnzahl, setQueueAnzahl] = useState(() => userId ? anzahlWartendFuerUser(userId) : 0)
  const [fehlgeschlageneAnzahl, setFehlgeschlageneAnzahl] = useState(() => userId ? anzahlFehlgeschlageneFuerUser(userId) : 0)

  // Refs für veränderlichen State, der keine Re-Renders auslösen soll
  const channelRef = useRef(null)
  const queueVerarbeitungRef = useRef(false)
  const eigeneSchreibvorgaengeRef = useRef([]) // Array<{ table, zeit }>
  const debounceTimersRef = useRef({})         // { tabelle: timeoutId }
  const reconnectAttemptRef = useRef(0)
  const reconnectTimerRef = useRef(null)
  const letzterVollAbgleichRef = useRef(0)
  const mergeHinweisTimerRef = useRef(null)
  const userIdRef = useRef(userId)

  // userId-Ref aktuell halten (für Callbacks die sich nicht bei jedem
  // userId-Wechsel neu registrieren sollen)
  useEffect(() => {
    userIdRef.current = userId
  }, [userId])

  // Helfer: Merge-Toast anzeigen (3s auto-hide)
  function zeigeMergeHinweis() {
    setMergeHinweis(true)
    if (mergeHinweisTimerRef.current) clearTimeout(mergeHinweisTimerRef.current)
    mergeHinweisTimerRef.current = setTimeout(() => {
      setMergeHinweis(false)
      mergeHinweisTimerRef.current = null
    }, MERGE_HINWEIS_DAUER_MS)
  }

  // Helfer: Eigenen Schreibvorgang registrieren (Echo-Events ignorieren)
  function registriereEigenenSchreibvorgang(tabelle) {
    const eintrag = { table: tabelle, zeit: Date.now() }
    eigeneSchreibvorgaengeRef.current.push(eintrag)
    setTimeout(() => {
      const arr = eigeneSchreibvorgaengeRef.current
      const idx = arr.indexOf(eintrag)
      if (idx >= 0) arr.splice(idx, 1)
    }, EIGENES_EVENT_AUFRAEUM_MS)
  }

  // Helfer: Queue-Anzahl aktualisieren
  function aktualisiereQueueAnzahl() {
    const uid = userIdRef.current
    setQueueAnzahl(uid ? anzahlWartendFuerUser(uid) : 0)
    setFehlgeschlageneAnzahl(uid ? anzahlFehlgeschlageneFuerUser(uid) : 0)
  }

  // -----------------------------------------------------------------------
  // Queue-Verarbeitung (PROJ-3)
  // -----------------------------------------------------------------------

  // Fehlgeschlagene Queue-Einträge verwerfen (AC-6: Nutzerin bestätigt)
  const fehlgeschlageneVerwerfen = useCallback(() => {
    const uid = userIdRef.current
    if (!uid) return
    entferneFehlgeschlagene(uid)
    setFehlgeschlageneAnzahl(0)
  }, [])

  const starteQueueVerarbeitung = useCallback(async (uid) => {
    if (queueVerarbeitungRef.current || !uid) return
    queueVerarbeitungRef.current = true

    try {
      let ergebnis = await verarbeiteQueue(uid)
      setQueueAnzahl(ergebnis.verbleibend)

      let runde = 0
      while (ergebnis.verbleibend > 0 && ergebnis.naechsterBackoff > 0 && runde < QUEUE_MAX_RUNDEN) {
        await new Promise((r) => setTimeout(r, ergebnis.naechsterBackoff))
        // Prüfe ob User noch eingeloggt ist
        if (userIdRef.current !== uid) break
        ergebnis = await verarbeiteQueue(uid)
        setQueueAnzahl(ergebnis.verbleibend)
        runde++
      }
    } catch (err) {
      console.error('[SyncEngine] Queue-Verarbeitung fehlgeschlagen:', err)
    } finally {
      queueVerarbeitungRef.current = false
      const aktuellerUid = userIdRef.current
      setQueueAnzahl(aktuellerUid ? anzahlWartendFuerUser(aktuellerUid) : 0)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // -----------------------------------------------------------------------
  // Vollständiger Abgleich: Alle 7 Tabellen laden + Merge
  // -----------------------------------------------------------------------

  const vollstaendigerAbgleich = useCallback(async (uid, versuch = 0) => {
    if (!supabase || !uid) return

    const abgleichStart = new Date().toISOString()

    try {
      const cloudRoh = await cloud.ladeAlleDaten(uid)
      if (!cloudRoh) return

      // Cross-Device-Löschung erkennen: Wenn Cloud-Zyklusdaten auf
      // ersteinrichtung=false zurückgesetzt wurden (mit frischen Zeitstempeln),
      // aber lokal ersteinrichtung=true ist und synced-Flag gesetzt,
      // wurden die Daten von einem anderen Gerät gelöscht.
      const cloudErsteinrichtung = cloudRoh.zyklusdaten?.ersteinrichtungAbgeschlossen
      const lokaleErsteinrichtung = local.ladeZyklusdaten().ersteinrichtungAbgeschlossen
      const hatSyncedFlag = !!localStorage.getItem(`rotermond_synced_${uid}`)

      if (!cloudErsteinrichtung && lokaleErsteinrichtung && hatSyncedFlag) {
        local.loescheAlleDaten()
        localStorage.removeItem(`rotermond_synced_${uid}`)
        setSyncVersion((v) => v + 1)
        // Lokale Session beenden — der globale Signout hat server-seitig
        // bereits alle Refresh-Tokens revoziert, aber der JWT ist noch gültig.
        // signOut() löst onAuthStateChange('SIGNED_OUT') aus → UI-Update.
        try { await supabase.auth.signOut() } catch { /* */ }
        return
      }

      // Lokale Daten + Zeitstempel laden
      const lokaleDaten = {
        zyklusdaten: local.ladeZyklusdaten(),
        korrekturen: local.ladeKorrekturen(),
        historie: local.ladeZyklushistorie(),
        chronik: local.ladeChronik(),
        tageskarten: local.ladeTageskarten(),
        hinweis: local.ladeZyklustypHinweis(),
        grenzen: local.ladeAngepassteGrenzen(),
      }
      const lokaleTs = {
        zyklusdaten: local.ladeZeitstempel('ZYKLUSDATEN'),
        korrekturen: local.ladeZeitstempel('KORREKTUREN'),
        historie: local.ladeZeitstempel('HISTORIE'),
        chronik: local.ladeZeitstempel('CHRONIK'),
        tageskarten: local.ladeZeitstempel('TAGESKARTEN'),
        hinweis: local.ladeZeitstempel('ZYKLUSTYP_HINWEIS'),
        grenzen: local.ladeZeitstempel('ANGEPASSTE_GRENZEN'),
      }

      // Cloud-Zeitstempel extrahieren + Daten bereinigen
      const cloudTs = extrahiereCloudZeitstempel(cloudRoh)
      const cloudDaten = bereinigeCloudDaten(cloudRoh)

      // Alle 7 Stores mergen
      const ergebnis = mergeAlleStores(lokaleDaten, lokaleTs, cloudDaten, cloudTs)

      // Merge-Ergebnis in localStorage speichern
      speichereMergeErgebnis(ergebnis)

      // Falls Merge Änderungen ergab, an Cloud zurückpushen
      if (ergebnis.hatGemerged) {
        // Nur geänderte Stores als eigene Schreibvorgänge registrieren,
        // damit Realtime-Events für unveränderte Stores nicht unterdrückt werden
        for (const t of TABELLEN) {
          if (ergebnis.geaenderteStores[t]) {
            registriereEigenenSchreibvorgang(t)
          }
        }
        await pusheMergeZurCloud(uid, ergebnis)
        zeigeMergeHinweis()
      }

      // PROJ-3: Queue-Einträge bereinigen, die vor dem Abgleich erstellt
      // wurden (der Merge hat alle lokalen Daten an die Cloud gepusht)
      loescheAeltereAls(uid, abgleichStart)
      aktualisiereQueueAnzahl()

      // Verbleibende Queue-Einträge nach Stabilitäts-Timer abarbeiten
      const wartend = anzahlWartendFuerUser(uid)
      if (wartend > 0) {
        setTimeout(() => starteQueueVerarbeitung(uid), QUEUE_STABILITAET_MS)
      }

      setSyncVersion((v) => v + 1)
      setLetzterSync(new Date())
      letzterVollAbgleichRef.current = Date.now()
    } catch (err) {
      console.error('[SyncEngine] Vollständiger Abgleich fehlgeschlagen:', err)
      if (versuch < FULL_PULL_RETRIES) {
        await new Promise((r) => setTimeout(r, FULL_PULL_RETRY_DELAY_MS))
        return vollstaendigerAbgleich(uid, versuch + 1)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // -----------------------------------------------------------------------
  // Einzelne Tabelle nachladen + Merge (nach Remote-Event)
  // -----------------------------------------------------------------------

  const tabelleNeuLaden = useCallback(async (tabelle, uid) => {
    if (!supabase || !uid) return

    try {
      // Cross-Device-Löschung bei zyklusdaten-Events erkennen:
      // Supabase global signOut revoziert nur Refresh-Tokens, sendet aber
      // keine Echtzeit-Benachrichtigung. Das Realtime-Event für die
      // zyklusdaten-Änderung (ersteinrichtung=false) kommt aber sofort.
      if (tabelle === 'zyklusdaten') {
        const cloudData = await cloud.ladeZyklusdaten(uid)
        const lokaleData = local.ladeZyklusdaten()
        const hatSyncedFlag = !!localStorage.getItem(`rotermond_synced_${uid}`)

        if (!cloudData?.ersteinrichtungAbgeschlossen && lokaleData?.ersteinrichtungAbgeschlossen && hatSyncedFlag) {
          local.loescheAlleDaten()
          localStorage.removeItem(`rotermond_synced_${uid}`)
          setSyncVersion((v) => v + 1)
          try { await supabase.auth.signOut() } catch { /* */ }
          return
        }
      }

      console.log(`[SyncEngine] 🔄 tabelleNeuLaden: ${tabelle}`)
      const geaendert = await tabelleZusammenfuehren(tabelle, uid)
      console.log(`[SyncEngine] 🔄 tabelleNeuLaden: ${tabelle} → geaendert=${geaendert}`)
      if (geaendert) {
        registriereEigenenSchreibvorgang(tabelle)
        zeigeMergeHinweis()
      }
    } catch (err) {
      console.error(`[SyncEngine] ❌ Tabelle ${tabelle} neu laden fehlgeschlagen:`, err)
    } finally {
      // syncVersion IMMER erhöhen (auch bei Fehler), damit UI den
      // aktuellen localStorage-Stand anzeigt
      setSyncVersion((v) => v + 1)
      setLetzterSync(new Date())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // -----------------------------------------------------------------------
  // Eingehendes Realtime-Event verarbeiten
  // -----------------------------------------------------------------------

  const handleRealtimeEvent = useCallback(
    (tabelle) => {
      const uid = userIdRef.current
      if (!uid) return

      // Eigene-Event-Erkennung: Prüfe ob wir kürzlich in diese Tabelle
      // geschrieben haben (innerhalb EIGENES_EVENT_FENSTER_MS)
      const jetzt = Date.now()
      const eigene = eigeneSchreibvorgaengeRef.current
      const eigenIndex = findeEigenesEvent(eigene, tabelle, jetzt)

      if (eigenIndex >= 0) {
        // Eigenes Echo → konsumieren und ignorieren
        eigene.splice(eigenIndex, 1)
        console.log(`[SyncEngine] ⏭ Eigenes Echo ignoriert: ${tabelle}`)
        return
      }

      console.log(`[SyncEngine] 📡 Fremdes Event empfangen: ${tabelle}`)

      // Fremdes Event → Tabelle mit Debounce nachladen + mergen
      const timers = debounceTimersRef.current
      if (timers[tabelle]) {
        clearTimeout(timers[tabelle])
      }
      timers[tabelle] = setTimeout(() => {
        delete timers[tabelle]
        tabelleNeuLaden(tabelle, uid)
      }, DEBOUNCE_MS)
    },
    [tabelleNeuLaden],
  )

  // -----------------------------------------------------------------------
  // Reconnection mit exponentiellem Backoff
  // -----------------------------------------------------------------------

  const attemptReconnect = useCallback(
    (uid) => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
      }

      const attempt = reconnectAttemptRef.current
      const delay = berechneBackoffDelay(attempt)
      reconnectAttemptRef.current = attempt + 1

      if (attempt >= 4) {
        // Session prüfen um Netzwerkfehler von Session-Ablauf zu unterscheiden
        supabase.auth.getSession().then(({ data }) => {
          if (!data?.session) {
            setSyncStatus('sitzung_abgelaufen')
          } else {
            setSyncStatus('getrennt')
          }
        }).catch(() => {
          setSyncStatus('getrennt')
        })
      }

      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null
        if (!channelRef.current || !userIdRef.current) return

        // Channel entfernen und neu aufbauen
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
        starteSubscription(uid)
      }, delay)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  // -----------------------------------------------------------------------
  // Channel-Subscription starten
  // -----------------------------------------------------------------------

  const starteSubscription = useCallback(
    (uid) => {
      if (!supabase || !uid) return

      setSyncStatus('verbindend')

      let channel = supabase.channel(`sync-${uid}-${Date.now()}`)

      TABELLEN.forEach((tabelle) => {
        channel = channel.on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: tabelle,
            filter: `user_id=eq.${uid}`,
          },
          () => handleRealtimeEvent(tabelle),
        )
      })

      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setSyncStatus('verbunden')
          reconnectAttemptRef.current = 0
          // Vollständiger Abgleich bei erster Verbindung
          vollstaendigerAbgleich(uid)
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setSyncStatus('verbindend')
          attemptReconnect(uid)
        } else if (status === 'CLOSED') {
          setSyncStatus('getrennt')
        }
      })

      channelRef.current = channel
    },
    [handleRealtimeEvent, vollstaendigerAbgleich, attemptReconnect],
  )

  // -----------------------------------------------------------------------
  // Haupt-Effect: Subscriptions starten/stoppen bei userId-Wechsel
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (!supabase || !userId) {
      setSyncStatus('getrennt')
      return
    }

    // Schreib-Callback bei speicher.js registrieren
    setOnWriteCallback((tabelle) => {
      registriereEigenenSchreibvorgang(tabelle)
    })

    // Queue-Change-Callback registrieren (PROJ-3: Badge aktualisieren)
    setOnQueueChangeCallback(() => {
      aktualisiereQueueAnzahl()
    })

    // Initiale Queue-Anzahl setzen
    aktualisiereQueueAnzahl()

    // Subscription starten
    starteSubscription(userId)

    // Visibility-Handler: Full-Pull bei Tab-Rückkehr
    function handleVisibility() {
      if (document.visibilityState === 'visible' && userIdRef.current) {
        const vergangen = Date.now() - letzterVollAbgleichRef.current
        if (vergangen > SICHTBARKEIT_MIN_ABSTAND_MS) {
          vollstaendigerAbgleich(userIdRef.current)
        }
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)

    // Online-Handler: Queue-Verarbeitung nach Stabilitäts-Timer (PROJ-3)
    let onlineTimerId = null
    function handleOnline() {
      if (onlineTimerId) clearTimeout(onlineTimerId)
      onlineTimerId = setTimeout(() => {
        onlineTimerId = null
        const uid = userIdRef.current
        if (uid && anzahlWartendFuerUser(uid) > 0) {
          starteQueueVerarbeitung(uid)
        }
      }, QUEUE_STABILITAET_MS)
    }
    window.addEventListener('online', handleOnline)

    // Cleanup
    return () => {
      setOnWriteCallback(null)
      setOnQueueChangeCallback(null)
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('online', handleOnline)
      if (onlineTimerId) clearTimeout(onlineTimerId)

      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      if (mergeHinweisTimerRef.current) {
        clearTimeout(mergeHinweisTimerRef.current)
        mergeHinweisTimerRef.current = null
      }
      // Alle Debounce-Timer aufräumen
      Object.values(debounceTimersRef.current).forEach(clearTimeout)
      debounceTimersRef.current = {}
      eigeneSchreibvorgaengeRef.current = []
      reconnectAttemptRef.current = 0
    }
  }, [userId, starteSubscription, vollstaendigerAbgleich, starteQueueVerarbeitung])

  return (
    <SyncEngineContext.Provider value={{ syncStatus, syncVersion, letzterSync, mergeHinweis, queueAnzahl, fehlgeschlageneAnzahl, fehlgeschlageneVerwerfen }}>
      {children}
    </SyncEngineContext.Provider>
  )
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSyncEngine() {
  const context = useContext(SyncEngineContext)
  if (!context) {
    return { syncStatus: 'getrennt', syncVersion: 0, letzterSync: null, mergeHinweis: false, queueAnzahl: 0, fehlgeschlageneAnzahl: 0, fehlgeschlageneVerwerfen: () => {} }
  }
  return context
}
