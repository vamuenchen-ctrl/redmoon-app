// ---------------------------------------------------------------------------
// Reine localStorage-Persistenzschicht (extrahiert aus speicher.js)
// Diese Datei enthält die gleiche Logik wie das Original, wird aber
// vom Fassaden-Modul speicher.js importiert.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// localStorage-Schlüssel
// ---------------------------------------------------------------------------

const SCHLUESSEL = {
  ZYKLUSDATEN: 'rotermond_zyklusdaten',
  KORREKTUREN: 'rotermond_korrekturen',
  HISTORIE: 'rotermond_zyklushistorie',
  CHRONIK: 'rotermond_chronik',
  TAGESKARTEN: 'rotermond_tageskarten',
  ZYKLUSTYP_HINWEIS: 'rotermond_zyklustyp_hinweis',
  ANGEPASSTE_GRENZEN: 'rotermond_angepasste_grenzen',
}

const ZEITSTEMPEL_SCHLUESSEL = {
  ZYKLUSDATEN: 'rotermond_zyklusdaten_zeitstempel',
  KORREKTUREN: 'rotermond_korrekturen_zeitstempel',
  HISTORIE: 'rotermond_zyklushistorie_zeitstempel',
  CHRONIK: 'rotermond_chronik_zeitstempel',
  TAGESKARTEN: 'rotermond_tageskarten_zeitstempel',
  ZYKLUSTYP_HINWEIS: 'rotermond_zyklustyp_hinweis_zeitstempel',
  ANGEPASSTE_GRENZEN: 'rotermond_angepasste_grenzen_zeitstempel',
}

// ---------------------------------------------------------------------------
// Generische Helfer
// ---------------------------------------------------------------------------

function ladeJSON(schluessel, fallback) {
  try {
    const daten = localStorage.getItem(schluessel)
    if (daten === null) return fallback
    return JSON.parse(daten)
  } catch {
    return fallback
  }
}

function speichereJSON(schluessel, wert) {
  try {
    localStorage.setItem(schluessel, JSON.stringify(wert))
  } catch {
    // localStorage voll – älteste Tageskarten entfernen und erneut versuchen
    try {
      const karten = ladeJSON(SCHLUESSEL.TAGESKARTEN, [])
      if (karten.length > 10) {
        localStorage.setItem(
          SCHLUESSEL.TAGESKARTEN,
          JSON.stringify(karten.slice(-10)),
        )
        localStorage.setItem(schluessel, JSON.stringify(wert))
      }
    } catch {
      // Speichern nicht möglich
    }
  }
}

/**
 * Serialisiert ein Date-Objekt als "YYYY-MM-DD"-String für localStorage.
 * Verwendet lokale Zeitzone, damit kein Tages-Shift bei UTC-Konvertierung entsteht.
 * Gibt null zurück wenn kein gültiges Datum.
 */
export function datumZuString(datum) {
  if (!datum) return null
  if (datum instanceof Date) {
    const p = (n) => String(n).padStart(2, '0')
    return `${datum.getFullYear()}-${p(datum.getMonth() + 1)}-${p(datum.getDate())}`
  }
  return datum // bereits ein String
}

/**
 * Deserialisiert einen Datum-String zurück zu einem Date-Objekt.
 * Parst als lokale Mitternacht (nicht UTC), damit kein Tages-Shift entsteht.
 * Gibt null zurück wenn kein gültiger String.
 */
export function stringZuDatum(str) {
  if (!str) return null
  const teile = str.slice(0, 10).split('-').map(Number)
  if (teile.length < 3) return null
  const d = new Date(teile[0], teile[1] - 1, teile[2])
  return isNaN(d.getTime()) ? null : d
}

// ---------------------------------------------------------------------------
// 1) Zyklusdaten
// ---------------------------------------------------------------------------

const ZYKLUSDATEN_DEFAULT = {
  zyklusStart: null,
  zyklusLaenge: 28,
  zyklusTyp: null,
  ersteinrichtungAbgeschlossen: false,
}

export function ladeZyklusdaten() {
  const daten = ladeJSON(SCHLUESSEL.ZYKLUSDATEN, ZYKLUSDATEN_DEFAULT)
  return {
    ...ZYKLUSDATEN_DEFAULT,
    ...daten,
    zyklusStart: stringZuDatum(daten.zyklusStart),
  }
}

export function speichereZyklusdaten(daten) {
  const zuSpeichern = {
    ...daten,
    zyklusStart: datumZuString(daten.zyklusStart),
  }
  speichereJSON(SCHLUESSEL.ZYKLUSDATEN, zuSpeichern)
}

export function aktualisiereZyklusdaten(teilDaten) {
  const aktuell = ladeZyklusdaten()
  speichereZyklusdaten({ ...aktuell, ...teilDaten })
}

// ---------------------------------------------------------------------------
// 2) Phasenkorrekturen
// ---------------------------------------------------------------------------

export function ladeKorrekturen() {
  const korrekturen = ladeJSON(SCHLUESSEL.KORREKTUREN, [])
  return korrekturen.map((k) => ({
    ...k,
    datum: stringZuDatum(k.datum),
  }))
}

export function speichereKorrekturen(korrekturen) {
  const zuSpeichern = korrekturen.map((k) => ({
    ...k,
    datum: datumZuString(k.datum),
  }))
  speichereJSON(SCHLUESSEL.KORREKTUREN, zuSpeichern)
}

export function fuegeKorrekturHinzu(korrektur) {
  const korrekturen = ladeKorrekturen()
  // Bei mehrfacher Anpassung am selben Tag: vorherige Korrektur ersetzen
  const korrekturTag = korrektur.datum instanceof Date
    ? korrektur.datum.toISOString().slice(0, 10)
    : String(korrektur.datum).slice(0, 10)
  const gefiltert = korrekturen.filter((k) => {
    const kTag = k.datum instanceof Date
      ? k.datum.toISOString().slice(0, 10)
      : String(k.datum).slice(0, 10)
    return kTag !== korrekturTag
  })
  gefiltert.push({
    datum: korrektur.datum,
    zyklusTag: korrektur.zyklusTag,
    berechnetePhase: korrektur.berechnetePhase,
    korrigiertePhase: korrektur.korrigiertePhase,
  })
  speichereKorrekturen(gefiltert)
}

// ---------------------------------------------------------------------------
// 3) Zyklushistorie
// ---------------------------------------------------------------------------

export function ladeZyklushistorie() {
  const historie = ladeJSON(SCHLUESSEL.HISTORIE, [])
  return historie.map((h) => ({
    ...h,
    startdatum: stringZuDatum(h.startdatum),
  }))
}

export function speichereZyklushistorie(historie) {
  const zuSpeichern = historie.map((h) => ({
    ...h,
    startdatum: datumZuString(h.startdatum),
  }))
  speichereJSON(SCHLUESSEL.HISTORIE, zuSpeichern)
}

export function fuegeZyklusHinzu(eintrag) {
  const historie = ladeZyklushistorie()
  historie.push({
    startdatum: eintrag.startdatum,
    mondphase: eintrag.mondphase,
    zyklusTyp: eintrag.zyklusTyp,
    zyklusLaenge: eintrag.zyklusLaenge,
  })
  speichereZyklushistorie(historie)
}

export function aktualisiereLetztenZyklus(teilDaten) {
  const historie = ladeZyklushistorie()
  if (historie.length === 0) return
  historie[historie.length - 1] = {
    ...historie[historie.length - 1],
    ...teilDaten,
  }
  speichereZyklushistorie(historie)
}

// ---------------------------------------------------------------------------
// 4) Chronik-Einträge
// ---------------------------------------------------------------------------

export function ladeChronik() {
  const chronik = ladeJSON(SCHLUESSEL.CHRONIK, [])
  return chronik.map((e) => ({
    ...e,
    datum: stringZuDatum(e.datum),
  }))
}

export function speichereChronik(chronik) {
  const zuSpeichern = chronik.map((e) => ({
    ...e,
    datum: datumZuString(e.datum),
  }))
  speichereJSON(SCHLUESSEL.CHRONIK, zuSpeichern)
}

export function speichereChronikEintrag(eintrag) {
  const chronik = ladeChronik()
  const datumStr = datumZuString(eintrag.datum)

  // Bestehenden Eintrag für denselben Tag überschreiben oder neuen hinzufügen
  const index = chronik.findIndex(
    (e) => datumZuString(e.datum) && datumZuString(e.datum).slice(0, 10) === datumStr.slice(0, 10),
  )

  const neuerEintrag = {
    datum: eintrag.datum,
    koerper: eintrag.koerper ?? null,
    stimmung: eintrag.stimmung ?? null,
    energie: eintrag.energie ?? null,
    traeume: eintrag.traeume ?? '',
    kreativitaet: eintrag.kreativitaet ?? '',
    sexuellesEmpfinden: eintrag.sexuellesEmpfinden ?? null,
    phase: eintrag.phase ?? null,
  }

  if (index >= 0) {
    chronik[index] = neuerEintrag
  } else {
    chronik.push(neuerEintrag)
  }

  speichereChronik(chronik)
}

export function ladeChronikEintrag(datum) {
  const chronik = ladeChronik()
  const datumStr = datumZuString(datum)
  if (!datumStr) return null

  return chronik.find(
    (e) => datumZuString(e.datum) && datumZuString(e.datum).slice(0, 10) === datumStr.slice(0, 10),
  ) || null
}

// ---------------------------------------------------------------------------
// 5) Gezogene Tageskarten
// ---------------------------------------------------------------------------

export function ladeTageskarten() {
  const karten = ladeJSON(SCHLUESSEL.TAGESKARTEN, [])
  return karten.map((k) => ({
    ...k,
    datum: stringZuDatum(k.datum),
  }))
}

export function speichereTageskarten(karten) {
  const zuSpeichern = karten.map((k) => ({
    ...k,
    datum: datumZuString(k.datum),
  }))
  speichereJSON(SCHLUESSEL.TAGESKARTEN, zuSpeichern)
}

export function speichereTageskarte(datum, kartenId) {
  const karten = ladeTageskarten()
  const datumStr = datumZuString(datum)

  const index = karten.findIndex(
    (k) => datumZuString(k.datum) && datumZuString(k.datum).slice(0, 10) === datumStr.slice(0, 10),
  )

  const neueKarte = { datum, kartenId }

  if (index >= 0) {
    karten[index] = neueKarte
  } else {
    karten.push(neueKarte)
  }

  speichereTageskarten(karten)
}

export function ladeHeutigeTageskarte() {
  const heuteStr = datumZuString(new Date())
  const karten = ladeTageskarten()

  return karten.find(
    (k) => datumZuString(k.datum) === heuteStr,
  ) || null
}

// ---------------------------------------------------------------------------
// 6) Zyklustyp-Hinweis
// ---------------------------------------------------------------------------

const ZYKLUSTYP_HINWEIS_DEFAULT = {
  letzterHinweis: null,
  nutzerinHatAbgelehnt: false,
  ablehnungsDatum: null,
}

export function ladeZyklustypHinweis() {
  const daten = ladeJSON(SCHLUESSEL.ZYKLUSTYP_HINWEIS, ZYKLUSTYP_HINWEIS_DEFAULT)
  return {
    ...ZYKLUSTYP_HINWEIS_DEFAULT,
    ...daten,
    letzterHinweis: stringZuDatum(daten.letzterHinweis),
    ablehnungsDatum: stringZuDatum(daten.ablehnungsDatum),
  }
}

export function speichereZyklustypHinweis(daten) {
  const zuSpeichern = {
    ...daten,
    letzterHinweis: datumZuString(daten.letzterHinweis),
    ablehnungsDatum: datumZuString(daten.ablehnungsDatum),
  }
  speichereJSON(SCHLUESSEL.ZYKLUSTYP_HINWEIS, zuSpeichern)
}

export function markiereHinweisAlsGezeigt() {
  const aktuell = ladeZyklustypHinweis()
  speichereZyklustypHinweis({
    ...aktuell,
    letzterHinweis: new Date(),
  })
}

export function markiereHinweisAlsAbgelehnt() {
  speichereZyklustypHinweis({
    letzterHinweis: new Date(),
    nutzerinHatAbgelehnt: true,
    ablehnungsDatum: new Date(),
  })
}

export function setzeHinweisZurueck() {
  speichereZyklustypHinweis(ZYKLUSTYP_HINWEIS_DEFAULT)
}

// ---------------------------------------------------------------------------
// 7) Angepasste Phasengrenzen
// ---------------------------------------------------------------------------

export function ladeAngepassteGrenzen() {
  return ladeJSON(SCHLUESSEL.ANGEPASSTE_GRENZEN, null)
}

export function speichereAngepassteGrenzen(grenzen) {
  speichereJSON(SCHLUESSEL.ANGEPASSTE_GRENZEN, grenzen)
}

export function setzeGrenzenZurueck() {
  localStorage.removeItem(SCHLUESSEL.ANGEPASSTE_GRENZEN)
}

// ---------------------------------------------------------------------------
// Alle Daten löschen
// ---------------------------------------------------------------------------

export function loescheAlleDaten() {
  Object.values(SCHLUESSEL).forEach((s) => localStorage.removeItem(s))
  Object.values(ZEITSTEMPEL_SCHLUESSEL).forEach((s) => localStorage.removeItem(s))
  // PROJ-4: Guest-ID ebenfalls entfernen
  try { localStorage.removeItem('rotermond_guest_id') } catch { /* */ }
}

// ---------------------------------------------------------------------------
// Feld-Zeitstempel (PROJ-2: Merge)
// ---------------------------------------------------------------------------

export function ladeZeitstempel(store) {
  return ladeJSON(ZEITSTEMPEL_SCHLUESSEL[store], {})
}

export function speichereZeitstempel(store, data) {
  speichereJSON(ZEITSTEMPEL_SCHLUESSEL[store], data)
}
