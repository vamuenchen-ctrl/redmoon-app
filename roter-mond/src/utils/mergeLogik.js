// ---------------------------------------------------------------------------
// Merge-Logik: Feld-Level-Merge für Cross-Device-Synchronisation
//
// Reine Funktionen ohne Seiteneffekte. Nehmen lokale + Cloud-Daten samt
// Zeitstempeln entgegen und geben das Merge-Ergebnis zurück.
// ---------------------------------------------------------------------------

const EPOCH = '1970-01-01T00:00:00.000Z'

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

/**
 * Normalisiert ein Datum (Date oder String) zu "YYYY-MM-DD".
 */
export function schluesselVonDatum(d) {
  if (!d) return null
  if (d instanceof Date) {
    // Lokale Zeitzone verwenden (nicht UTC), damit kein Tages-Shift entsteht
    const p = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  }
  if (typeof d === 'string') return d.slice(0, 10)
  return null
}

/**
 * Vergleicht zwei Zeitstempel. Gibt 1 zurück wenn a neuer, -1 wenn b neuer, 0 bei Gleichheit.
 */
function vergleicheZeitstempel(a, b) {
  const za = (typeof a === 'string' && a) ? a : EPOCH
  const zb = (typeof b === 'string' && b) ? b : EPOCH
  if (za > zb) return 1
  if (za < zb) return -1
  return 0
}

// ---------------------------------------------------------------------------
// Strategie A: Einzelobjekt-Merge (Feld für Feld)
// Für: zyklusdaten, zyklustyp_hinweis
// ---------------------------------------------------------------------------

/**
 * Mergt zwei Einzelobjekte feldweise.
 *
 * @param {Object} lokal - Lokale Daten
 * @param {Object} lokalTs - Lokale Feld-Zeitstempel { feldName: "iso", ... }
 * @param {Object} cloud - Cloud-Daten
 * @param {Object} cloudTs - Cloud-Feld-Zeitstempel { feldName: "iso", ... }
 * @param {string[]} felder - Liste der zu mergenden Felder
 * @returns {{ daten: Object, zeitstempel: Object, geaendert: boolean }}
 */
export function mergeEinzelobjekt(lokal, lokalTs, cloud, cloudTs, felder) {
  const daten = { ...lokal }
  const zeitstempel = { ...lokalTs }
  let geaendert = false

  for (const feld of felder) {
    const vgl = vergleicheZeitstempel(lokalTs[feld], cloudTs[feld])

    if (vgl < 0) {
      // Cloud ist neuer → Cloud-Wert übernehmen
      daten[feld] = cloud[feld]
      zeitstempel[feld] = cloudTs[feld]
      geaendert = true
    } else if (vgl === 0) {
      // Gleichzeitig → lokal gewinnt (Tie-Breaker), kein geaendert-Flag
    }
    // vgl > 0: lokal ist neuer → nichts zu tun
  }

  return { daten, zeitstempel, geaendert }
}

// ---------------------------------------------------------------------------
// Strategie B: Array-Merge nach Schlüssel (Datum)
// Für: korrekturen, zyklushistorie, tageskarten
// ---------------------------------------------------------------------------

/**
 * Mergt zwei Arrays nach einem Schlüssel-Feld. Pro Schlüssel gewinnt der
 * Eintrag mit dem neueren Zeitstempel (Zeilen-Level, kein Feld-Level).
 *
 * @param {Array} lokal - Lokale Einträge
 * @param {Object} lokalTs - Lokale Zeitstempel { "YYYY-MM-DD": "iso", ... }
 * @param {Array} cloud - Cloud-Einträge
 * @param {Object} cloudTs - Cloud-Zeitstempel { "YYYY-MM-DD": "iso", ... }
 * @param {Function} schluesselFn - Funktion die aus einem Eintrag den Schlüssel extrahiert
 * @returns {{ daten: Array, zeitstempel: Object, geaendert: boolean }}
 */
export function mergeArrayNachSchluessel(lokal, lokalTs, cloud, cloudTs, schluesselFn) {
  const lokalMap = new Map()
  for (const eintrag of lokal) {
    const key = schluesselFn(eintrag)
    if (key) lokalMap.set(key, eintrag)
  }

  const cloudMap = new Map()
  for (const eintrag of cloud) {
    const key = schluesselFn(eintrag)
    if (key) cloudMap.set(key, eintrag)
  }

  const alleKeys = new Set([...lokalMap.keys(), ...cloudMap.keys()])
  const daten = []
  const zeitstempel = {}
  let geaendert = false

  for (const key of alleKeys) {
    const hatLokal = lokalMap.has(key)
    const hatCloud = cloudMap.has(key)

    if (hatLokal && hatCloud) {
      const vgl = vergleicheZeitstempel(lokalTs[key], cloudTs[key])
      if (vgl < 0) {
        // Cloud neuer
        daten.push(cloudMap.get(key))
        zeitstempel[key] = cloudTs[key]
        geaendert = true
      } else {
        // Lokal neuer oder gleich
        daten.push(lokalMap.get(key))
        zeitstempel[key] = lokalTs[key] || cloudTs[key] || EPOCH
      }
    } else if (hatLokal) {
      daten.push(lokalMap.get(key))
      zeitstempel[key] = lokalTs[key] || EPOCH
    } else {
      // Nur Cloud
      daten.push(cloudMap.get(key))
      zeitstempel[key] = cloudTs[key] || EPOCH
      geaendert = true
    }
  }

  // Nach Schlüssel sortieren (chronologisch)
  daten.sort((a, b) => {
    const ka = schluesselFn(a) || ''
    const kb = schluesselFn(b) || ''
    return ka < kb ? -1 : ka > kb ? 1 : 0
  })

  return { daten, zeitstempel, geaendert }
}

// ---------------------------------------------------------------------------
// Strategie C: Array + Feld-Level-Merge (Chronik)
// ---------------------------------------------------------------------------

const CHRONIK_FELDER = ['stimmung', 'energie', 'koerper', 'traeume', 'kreativitaet', 'sexuellesEmpfinden', 'phase']

/**
 * Vereinigt zwei koerper-Arrays (Union, dedupliziert).
 */
function mergeKoerper(lokalKoerper, cloudKoerper) {
  const lokalArr = Array.isArray(lokalKoerper) ? lokalKoerper : []
  const cloudArr = Array.isArray(cloudKoerper) ? cloudKoerper : []
  return [...new Set([...lokalArr, ...cloudArr])]
}

/**
 * Mergt einen einzelnen Chronik-Eintrag feldweise.
 */
function mergeChronikEintrag(lokal, lokalTs, cloud, cloudTs) {
  const daten = { ...lokal }
  const zeitstempel = { ...lokalTs }
  let geaendert = false

  for (const feld of CHRONIK_FELDER) {
    if (feld === 'koerper') {
      // Spezialfall: Union-Merge für koerper-Array
      const merged = mergeKoerper(lokal.koerper, cloud.koerper)
      const lokalArr = Array.isArray(lokal.koerper) ? lokal.koerper : []
      const cloudArr = Array.isArray(cloud.koerper) ? cloud.koerper : []

      // koerper geändert wenn das Merge-Ergebnis sich vom lokalen unterscheidet
      if (merged.length !== lokalArr.length || !merged.every((v) => lokalArr.includes(v))) {
        daten.koerper = merged
        // Zeitstempel: den neueren der beiden nehmen
        const vgl = vergleicheZeitstempel(lokalTs.koerper, cloudTs.koerper)
        zeitstempel.koerper = vgl >= 0 ? (lokalTs.koerper || cloudTs.koerper || EPOCH) : cloudTs.koerper
        geaendert = true
      }
      continue
    }

    const vgl = vergleicheZeitstempel(lokalTs[feld], cloudTs[feld])

    if (vgl < 0) {
      // Cloud ist neuer
      daten[feld] = cloud[feld]
      zeitstempel[feld] = cloudTs[feld]
      geaendert = true
    } else if (vgl === 0) {
      // Gleichzeitig → lokal gewinnt
    }
    // vgl > 0: lokal neuer → nichts tun
  }

  return { daten, zeitstempel, geaendert }
}

/**
 * Mergt zwei Chronik-Arrays. Einträge werden nach Datum zusammengeführt,
 * für gleiche Tage wird ein Feld-Level-Merge durchgeführt.
 *
 * @param {Array} lokal - Lokale Chronik-Einträge
 * @param {Object} lokalTs - { "YYYY-MM-DD": { stimmung: "iso", ... }, ... }
 * @param {Array} cloud - Cloud-Chronik-Einträge
 * @param {Object} cloudTs - { "YYYY-MM-DD": { stimmung: "iso", ... }, ... }
 * @returns {{ daten: Array, zeitstempel: Object, geaendert: boolean }}
 */
export function mergeChronik(lokal, lokalTs, cloud, cloudTs) {
  const lokalMap = new Map()
  for (const eintrag of lokal) {
    const key = schluesselVonDatum(eintrag.datum)
    if (key) lokalMap.set(key, eintrag)
  }

  const cloudMap = new Map()
  for (const eintrag of cloud) {
    const key = schluesselVonDatum(eintrag.datum)
    if (key) cloudMap.set(key, eintrag)
  }

  const alleKeys = new Set([...lokalMap.keys(), ...cloudMap.keys()])
  const daten = []
  const zeitstempel = {}
  let geaendert = false

  for (const key of alleKeys) {
    const hatLokal = lokalMap.has(key)
    const hatCloud = cloudMap.has(key)

    if (hatLokal && hatCloud) {
      // Feld-Level-Merge für diesen Tag
      const ergebnis = mergeChronikEintrag(
        lokalMap.get(key),
        lokalTs[key] || {},
        cloudMap.get(key),
        cloudTs[key] || {},
      )
      daten.push(ergebnis.daten)
      zeitstempel[key] = ergebnis.zeitstempel
      if (ergebnis.geaendert) geaendert = true
    } else if (hatLokal) {
      daten.push(lokalMap.get(key))
      zeitstempel[key] = lokalTs[key] || {}
    } else {
      // Nur Cloud
      daten.push(cloudMap.get(key))
      zeitstempel[key] = cloudTs[key] || {}
      geaendert = true
    }
  }

  // Nach Datum sortieren
  daten.sort((a, b) => {
    const ka = schluesselVonDatum(a.datum) || ''
    const kb = schluesselVonDatum(b.datum) || ''
    return ka < kb ? -1 : ka > kb ? 1 : 0
  })

  return { daten, zeitstempel, geaendert }
}

// ---------------------------------------------------------------------------
// Strategie D: Ganzes Objekt ersetzen (Angepasste Grenzen)
// ---------------------------------------------------------------------------

/**
 * Vergleicht zwei Objekte nach einem einzigen Zeitstempel.
 * Der neuere gewinnt komplett.
 *
 * @param {*} lokal - Lokale Daten (kann null sein)
 * @param {string} lokalTs - Lokaler Zeitstempel (ISO-String)
 * @param {*} cloud - Cloud-Daten (kann null sein)
 * @param {string} cloudTs - Cloud-Zeitstempel (ISO-String)
 * @returns {{ daten: *, zeitstempel: string, geaendert: boolean }}
 */
export function mergeGanzesObjekt(lokal, lokalTs, cloud, cloudTs) {
  const vgl = vergleicheZeitstempel(lokalTs, cloudTs)

  if (vgl < 0) {
    return { daten: cloud, zeitstempel: cloudTs || EPOCH, geaendert: true }
  }
  // Lokal neuer oder gleich → lokal gewinnt
  return { daten: lokal, zeitstempel: lokalTs || cloudTs || EPOCH, geaendert: false }
}

// ---------------------------------------------------------------------------
// Orchestrator: Alle 7 Stores mergen
// ---------------------------------------------------------------------------

const ZYKLUSDATEN_FELDER = ['zyklusStart', 'zyklusLaenge', 'zyklusTyp', 'ersteinrichtungAbgeschlossen']
const HINWEIS_FELDER = ['letzterHinweis', 'nutzerinHatAbgelehnt', 'ablehnungsDatum']

/**
 * Mergt alle 7 Datenstores.
 *
 * @param {Object} lokaleDaten - { zyklusdaten, korrekturen, historie, chronik, tageskarten, hinweis, grenzen }
 * @param {Object} lokaleTs - { zyklusdaten: {...}, korrekturen: {...}, ... }
 * @param {Object} cloudDaten - gleiche Struktur
 * @param {Object} cloudTs - gleiche Struktur
 * @returns {{ daten: Object, zeitstempel: Object, hatGemerged: boolean }}
 */
export function mergeAlleStores(lokaleDaten, lokaleTs, cloudDaten, cloudTs) {
  let hatGemerged = false

  // 1. Zyklusdaten (Strategie A)
  const zyklus = mergeEinzelobjekt(
    lokaleDaten.zyklusdaten || {},
    lokaleTs.zyklusdaten || {},
    cloudDaten.zyklusdaten || {},
    cloudTs.zyklusdaten || {},
    ZYKLUSDATEN_FELDER,
  )
  if (zyklus.geaendert) hatGemerged = true

  // 2. Korrekturen (Strategie B, Schlüssel: datum)
  const korrekturen = mergeArrayNachSchluessel(
    lokaleDaten.korrekturen || [],
    lokaleTs.korrekturen || {},
    cloudDaten.korrekturen || [],
    cloudTs.korrekturen || {},
    (e) => schluesselVonDatum(e.datum),
  )
  if (korrekturen.geaendert) hatGemerged = true

  // 3. Zyklushistorie (Strategie B, Schlüssel: startdatum)
  const historie = mergeArrayNachSchluessel(
    lokaleDaten.historie || [],
    lokaleTs.historie || {},
    cloudDaten.historie || [],
    cloudTs.historie || {},
    (e) => schluesselVonDatum(e.startdatum),
  )
  if (historie.geaendert) hatGemerged = true

  // 4. Chronik (Strategie C)
  const chronik = mergeChronik(
    lokaleDaten.chronik || [],
    lokaleTs.chronik || {},
    cloudDaten.chronik || [],
    cloudTs.chronik || {},
  )
  if (chronik.geaendert) hatGemerged = true

  // 5. Tageskarten (Strategie B, Schlüssel: datum)
  const tageskarten = mergeArrayNachSchluessel(
    lokaleDaten.tageskarten || [],
    lokaleTs.tageskarten || {},
    cloudDaten.tageskarten || [],
    cloudTs.tageskarten || {},
    (e) => schluesselVonDatum(e.datum),
  )
  if (tageskarten.geaendert) hatGemerged = true

  // 6. Zyklustyp-Hinweis (Strategie A)
  const hinweis = mergeEinzelobjekt(
    lokaleDaten.hinweis || {},
    lokaleTs.hinweis || {},
    cloudDaten.hinweis || {},
    cloudTs.hinweis || {},
    HINWEIS_FELDER,
  )
  if (hinweis.geaendert) hatGemerged = true

  // 7. Angepasste Grenzen (Strategie D)
  const grenzen = mergeGanzesObjekt(
    lokaleDaten.grenzen,
    lokaleTs.grenzen || '',
    cloudDaten.grenzen,
    cloudTs.grenzen || '',
  )
  if (grenzen.geaendert) hatGemerged = true

  return {
    daten: {
      zyklusdaten: zyklus.daten,
      korrekturen: korrekturen.daten,
      historie: historie.daten,
      chronik: chronik.daten,
      tageskarten: tageskarten.daten,
      hinweis: hinweis.daten,
      grenzen: grenzen.daten,
    },
    zeitstempel: {
      zyklusdaten: zyklus.zeitstempel,
      korrekturen: korrekturen.zeitstempel,
      historie: historie.zeitstempel,
      chronik: chronik.zeitstempel,
      tageskarten: tageskarten.zeitstempel,
      hinweis: hinweis.zeitstempel,
      grenzen: grenzen.zeitstempel,
    },
    hatGemerged,
    geaenderteStores: {
      zyklusdaten: zyklus.geaendert,
      korrekturen: korrekturen.geaendert,
      zyklushistorie: historie.geaendert,
      chronik: chronik.geaendert,
      tageskarten: tageskarten.geaendert,
      zyklustyp_hinweis: hinweis.geaendert,
      angepasste_grenzen: grenzen.geaendert,
    },
  }
}
