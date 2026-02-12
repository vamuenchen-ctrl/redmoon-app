import { berechneMondphase } from './mondphasen'

// ---------------------------------------------------------------------------
// Phasen-Metadaten aus INHALTE.md
// ---------------------------------------------------------------------------

export const PHASEN_INFO = {
  alteWeise: {
    kurzname: 'Alte Weise',
    schluessel: 'alteWeise',
    symbol: '🌑',
    farbe: '#26496F',       // Tiefes Blau
    farbeHex: '#26496F',
    farbeBgHex: '#F5F5F3',  // RINGANA Warmgrau
    jahreszeit: 'Winter',
    element: 'Wasser',
    mondphase: 'Neumond / Dunkelmond',
    zyklusphase: 'Menstruation',
    kernenergie: 'Innenschau, Loslassen, Erneuerung, tiefe Spiritualität',
    symboltier: 'Hase',
    kurzbeschreibung:
      'Die Zeit der Stille. Während deiner Menstruation ziehst du dich in deine innere Welt zurück. Es ist die kraftvollste Zeit für Loslassen, Erneuerung und visionäre Einsichten.',
  },
  jungeFrau: {
    kurzname: 'Junge Frau',
    schluessel: 'jungeFrau',
    symbol: '🌙',
    farbe: '#677E3D',       // Olivgrün
    farbeHex: '#677E3D',
    farbeBgHex: '#D2F0E8',  // RINGANA Zartes Mintgrün
    jahreszeit: 'Frühling',
    element: 'Luft',
    mondphase: 'Zunehmender Mond',
    zyklusphase: 'Präovulatorisch (nach der Menstruation)',
    kernenergie: 'Aufbruch, Dynamik, Selbstvertrauen, Unabhängigkeit',
    symboltier: 'Schmetterling',
    kurzbeschreibung:
      'Die Zeit des Neubeginns. Nach der Menstruation steigt deine Energie wieder an. Du fühlst dich leicht, klar und voller Tatendrang. Die Welt steht dir offen.',
  },
  mutter: {
    kurzname: 'Mutter',
    schluessel: 'mutter',
    symbol: '🌕',
    farbe: '#FFA500',       // Gold
    farbeHex: '#FFA500',
    farbeBgHex: '#FEE8C4',  // RINGANA Pfirsich
    jahreszeit: 'Sommer',
    element: 'Erde',
    mondphase: 'Vollmond',
    zyklusphase: 'Ovulation / Eisprung',
    kernenergie: 'Fürsorge, Ausstrahlung, Empathie, Nähren',
    symboltier: 'Taube',
    kurzbeschreibung:
      'Die Zeit der Fülle. Rund um deinen Eisprung bist du auf dem Höhepunkt deiner nach außen gerichteten Energie. Du strahlst Wärme aus und fühlst dich verbunden mit allem, was lebt.',
  },
  zauberin: {
    kurzname: 'Zauberin',
    schluessel: 'zauberin',
    symbol: '🌗',
    farbe: '#C94963',       // Lebhaftes Rosa
    farbeHex: '#C94963',
    farbeBgHex: '#F7D0D3',  // RINGANA Zartrosa
    jahreszeit: 'Herbst',
    element: 'Feuer',
    mondphase: 'Abnehmender Mond',
    zyklusphase: 'Prämenstruell / Lutealphase',
    kernenergie: 'Kreative Kraft, Intuition, Wandlung, wilde innere Energie',
    symboltier: 'Eule',
    kurzbeschreibung:
      'Die Zeit der inneren Kraft. Deine Energie wendet sich nach innen. Intuition und Kreativität sind jetzt besonders stark – aber auch deine Emotionen. Du spürst, was unter der Oberfläche liegt.',
  },
}

// ---------------------------------------------------------------------------
// Grammatisch korrekte Kasusformen der Phasennamen (Deutsch)
// ---------------------------------------------------------------------------

export const PHASEN_KASUS = {
  jungeFrau: {
    nominativ: 'die Junge Frau',
    genitiv: 'der Jungen Frau',
    dativ: 'der Jungen Frau',
    kompositum: 'Junge-Frau',
  },
  mutter: {
    nominativ: 'die Mutter',
    genitiv: 'der Mutter',
    dativ: 'der Mutter',
    kompositum: 'Mutter',
  },
  zauberin: {
    nominativ: 'die Zauberin',
    genitiv: 'der Zauberin',
    dativ: 'der Zauberin',
    kompositum: 'Zauberinnen',
  },
  alteWeise: {
    nominativ: 'die Alte Weise',
    genitiv: 'der Alten Weisen',
    dativ: 'der Alten Weisen',
    kompositum: 'Alte-Weise',
  },
}

// Reihenfolge der Phasen im Zyklus (Tag 1 = Beginn der Menstruation = Alte Weise)
const PHASEN_REIHENFOLGE = ['alteWeise', 'jungeFrau', 'mutter', 'zauberin']

const MS_PRO_TAG = 1000 * 60 * 60 * 24

// ---------------------------------------------------------------------------
// 1) berechneZyklusPhase
// ---------------------------------------------------------------------------

/**
 * Berechnet den aktuellen Zyklustag und die aktuelle Phase.
 *
 * @param {Date}   zyklusStart    – Erster Tag der letzten Menstruation
 * @param {number} zyklusLaenge   – Durchschnittliche Zykluslänge in Tagen (Standard: 28)
 * @param {Date}   heutigesDatum  – Das Datum, für das berechnet werden soll
 * @returns {{
 *   zyklusTag: number,
 *   phase: string,
 *   phaseName: string,
 *   phaseTag: number,
 *   phaseLaenge: number,
 *   naechstePhase: string,
 *   tageBisNaechstePhase: number
 * }}
 */
export function berechneZyklusPhase(zyklusStart, zyklusLaenge, heutigesDatum) {
  const diffMs = heutigesDatum.getTime() - zyklusStart.getTime()
  const diffTage = Math.floor(diffMs / MS_PRO_TAG)

  // Zyklustag 1-basiert, bei Überlauf in neuen Zyklus wrappen
  const zyklusTag = (diffTage % zyklusLaenge) + 1

  const grenzen = berechnePhasenGrenzen(zyklusLaenge)

  return ermittlePhaseAusGrenzen(zyklusTag, grenzen)
}

// ---------------------------------------------------------------------------
// 2) berechneZyklusTyp
// ---------------------------------------------------------------------------

const MOND_ZYKLUS_LAENGE = 29.53058867

/**
 * Bestimmt den Zyklustyp (Weißmond / Rotmond) anhand der Mondphase
 * am ersten Tag der Menstruation.
 *
 * @param {Date} menstruationsStart – Erster Tag der Menstruation
 * @returns {{
 *   vorschlag: "weissmond" | "rotmond" | "unklar",
 *   naechsterTyp: "weissmond" | "rotmond",
 *   mondphaseAnTag1: object,
 *   erklaerung: string
 * }}
 */
export function berechneZyklusTyp(menstruationsStart) {
  const mondInfo = berechneMondphase(menstruationsStart)
  const tageImMondZyklus = mondInfo.tageImZyklus

  let vorschlag
  if (tageImMondZyklus <= 3 || tageImMondZyklus >= MOND_ZYKLUS_LAENGE - 3) {
    vorschlag = 'weissmond'
  } else if (tageImMondZyklus >= 12 && tageImMondZyklus <= 17) {
    vorschlag = 'rotmond'
  } else {
    vorschlag = 'unklar'
  }

  // Nächstliegender Typ (immer eindeutig): Distanz zum Neumond vs. Vollmond
  const halbMondZyklus = MOND_ZYKLUS_LAENGE / 2
  const distanzNeumond = Math.min(tageImMondZyklus, MOND_ZYKLUS_LAENGE - tageImMondZyklus)
  const distanzVollmond = Math.abs(tageImMondZyklus - halbMondZyklus)
  const naechsterTyp = distanzNeumond <= distanzVollmond ? 'weissmond' : 'rotmond'

  const erklaerung = erzeugeZyklusTypErklaerung(menstruationsStart, mondInfo)

  return {
    vorschlag,
    naechsterTyp,
    mondphaseAnTag1: mondInfo,
    erklaerung,
  }
}

// ---------------------------------------------------------------------------
// 3) berechneAngepasstePhase
// ---------------------------------------------------------------------------

/**
 * Wie berechneZyklusPhase, aber berücksichtigt gespeicherte Korrekturen und
 * erlernte Muster aus vergangenen Zyklen.
 *
 * @param {Date}   zyklusStart    – Erster Tag der letzten Menstruation
 * @param {number} zyklusLaenge   – Durchschnittliche Zykluslänge in Tagen
 * @param {Date}   heutigesDatum  – Das Datum, für das berechnet werden soll
 * @param {Array<{zyklusTag: number, korrigiertePhase: string}>} korrekturen
 * @returns {object} – Wie berechneZyklusPhase, plus `quelle`-Feld
 */
export function berechneAngepasstePhase(
  zyklusStart,
  zyklusLaenge,
  heutigesDatum,
  korrekturen = [],
  gespeicherteGrenzen = null,
) {
  const diffMs = heutigesDatum.getTime() - zyklusStart.getTime()
  const diffTage = Math.floor(diffMs / MS_PRO_TAG)
  const zyklusTag = (diffTage % zyklusLaenge) + 1

  const standardGrenzen = berechnePhasenGrenzen(zyklusLaenge)
  const standardErgebnis = ermittlePhaseAusGrenzen(zyklusTag, standardGrenzen)

  // Berechnete Phase ermitteln (ohne Einzelkorrekturen):
  // personalisiert > muster > standard
  let berechnetePhase = standardErgebnis.phase

  // 1) Gespeicherte personalisierte Grenzen haben Vorrang
  if (gespeicherteGrenzen && gespeicherteGrenzen.length === 4) {
    const persErgebnis = ermittlePhaseAusGrenzen(zyklusTag, gespeicherteGrenzen)
    if (persErgebnis.phase !== standardErgebnis.phase) {
      berechnetePhase = persErgebnis.phase
      return {
        ...persErgebnis,
        berechnetePhase,
        quelle: 'personalisiert',
      }
    }
  }

  // 2) Muster-basierte Anpassung (3+ gleiche Korrekturen am selben Tag)?
  //    Hat Vorrang vor Einzelkorrekturen, da es über mehrere Zyklen gelernt wurde.
  const angepassteGrenzen = berechneAngepassteGrenzen(zyklusLaenge, korrekturen)
  const musterErgebnis = ermittlePhaseAusGrenzen(zyklusTag, angepassteGrenzen)

  if (musterErgebnis.phase !== standardErgebnis.phase) {
    berechnetePhase = musterErgebnis.phase
    return {
      ...musterErgebnis,
      berechnetePhase,
      quelle: 'muster',
    }
  }

  // 3) Einzelne direkte Korrektur für diesen Tag?
  //    Nur anwenden wenn genau 1 Korrektur vorliegt (= aktuelle Zyklus-Korrektur).
  //    Mehrere Einträge für denselben Tag stammen aus vergangenen Zyklen
  //    und werden nur via Mustererkennung (3+) berücksichtigt.
  const korrekturenFuerTag = korrekturen.filter((k) => k.zyklusTag === zyklusTag)
  if (korrekturenFuerTag.length === 1) {
    const info = PHASEN_INFO[korrekturenFuerTag[0].korrigiertePhase]

    return {
      ...standardErgebnis,
      phase: korrekturenFuerTag[0].korrigiertePhase,
      phaseName: info.kurzname,
      berechnetePhase,
      quelle: 'korrektur',
    }
  }

  // 4) Standard-Berechnung
  return {
    ...standardErgebnis,
    berechnetePhase,
    quelle: 'berechnung',
  }
}

// ---------------------------------------------------------------------------
// Interne Hilfsfunktionen
// ---------------------------------------------------------------------------

/**
 * Berechnet die Tagesgrenzen der vier Phasen für eine gegebene Zykluslänge.
 * Gibt ein Array von { phase, start, ende } zurück (Tag 1-basiert, inklusive).
 */
export function berechnePhasenGrenzen(zyklusLaenge) {
  // Alte Weise etwas kürzer, Zauberin etwas länger (wie in KONZEPT.md beschrieben)
  const alteWeiseLaenge = Math.round(zyklusLaenge * 0.22)  // ~6 Tage bei 28
  const jungeFrauLaenge = Math.round(zyklusLaenge * 0.25)  // ~7 Tage bei 28
  const mutterLaenge = Math.round(zyklusLaenge * 0.25)      // ~7 Tage bei 28
  // Zauberin bekommt den Rest (etwas länger)
  const zauberinLaenge = zyklusLaenge - alteWeiseLaenge - jungeFrauLaenge - mutterLaenge

  const grenzen = []
  let tagStart = 1

  const laengen = [alteWeiseLaenge, jungeFrauLaenge, mutterLaenge, zauberinLaenge]

  for (let i = 0; i < 4; i++) {
    const ende = tagStart + laengen[i] - 1
    grenzen.push({
      phase: PHASEN_REIHENFOLGE[i],
      start: tagStart,
      ende,
      laenge: laengen[i],
    })
    tagStart = ende + 1
  }

  return grenzen
}

/**
 * Ermittelt Phase-Details anhand des Zyklustags und vorberechneter Grenzen.
 */
function ermittlePhaseAusGrenzen(zyklusTag, grenzen) {
  let aktuellePhase = grenzen[grenzen.length - 1]
  let aktuellerIndex = grenzen.length - 1

  for (let i = 0; i < grenzen.length; i++) {
    if (zyklusTag >= grenzen[i].start && zyklusTag <= grenzen[i].ende) {
      aktuellePhase = grenzen[i]
      aktuellerIndex = i
      break
    }
  }

  const naechsterIndex = (aktuellerIndex + 1) % grenzen.length
  const phaseTag = zyklusTag - aktuellePhase.start + 1
  const tageBisNaechstePhase = aktuellePhase.ende - zyklusTag + 1

  return {
    zyklusTag,
    phase: aktuellePhase.phase,
    phaseName: PHASEN_INFO[aktuellePhase.phase].kurzname,
    phaseTag,
    phaseLaenge: aktuellePhase.laenge,
    naechstePhase: PHASEN_INFO[grenzen[naechsterIndex].phase].kurzname,
    tageBisNaechstePhase,
  }
}

/**
 * Erzeugt den Erklärungstext für den Zyklustyp.
 */
function erzeugeZyklusTypErklaerung(menstruationsStart, mondInfo) {
  const tag = menstruationsStart.getDate()
  const monat = menstruationsStart.toLocaleDateString('de-DE', { month: 'long' })

  const mondphaseText = mondInfo.phase === 'neumond'
    ? 'Neumond'
    : mondInfo.phase === 'vollmond'
      ? 'Vollmond'
      : mondInfo.phase === 'zunehmend'
        ? 'zunehmender Mond'
        : 'abnehmender Mond'

  const tageImZyklus = mondInfo.tageImZyklus
  let bezug
  if (tageImZyklus <= 14.76) {
    const tageNachNeumond = Math.round(tageImZyklus)
    bezug = tageNachNeumond === 0
      ? 'genau bei Neumond'
      : `${tageNachNeumond} ${tageNachNeumond === 1 ? 'Tag' : 'Tage'} nach Neumond`
  } else {
    const tageBisNeumond = Math.round(29.53 - tageImZyklus)
    bezug = tageBisNeumond === 0
      ? 'genau bei Neumond'
      : `${tageBisNeumond} ${tageBisNeumond === 1 ? 'Tag' : 'Tage'} vor Neumond`
  }

  return `Am ${tag}. ${monat} war ${mondphaseText}, ${bezug}.`
}

/**
 * Analysiert Korrekturmuster und berechnet angepasste Phasengrenzen.
 * Benötigt mindestens 3 Korrekturen am gleichen Zyklustag mit der gleichen
 * Phase, um als Muster zu gelten.
 */
export function berechneAngepassteGrenzen(zyklusLaenge, korrekturen) {
  const standardGrenzen = berechnePhasenGrenzen(zyklusLaenge)

  if (korrekturen.length < 3) {
    return standardGrenzen
  }

  // Zähle, wie oft welcher Zyklustag zu welcher Phase korrigiert wurde
  const muster = {}
  for (const k of korrekturen) {
    const schluessel = `${k.zyklusTag}:${k.korrigiertePhase}`
    muster[schluessel] = (muster[schluessel] || 0) + 1
  }

  // Nur Muster mit 3+ Wiederholungen berücksichtigen
  const staerkeMuster = Object.entries(muster)
    .filter(([, anzahl]) => anzahl >= 3)
    .map(([schluessel]) => {
      const [tag, phase] = schluessel.split(':')
      return { zyklusTag: parseInt(tag), phase }
    })

  if (staerkeMuster.length === 0) {
    return standardGrenzen
  }

  // Grenzen anpassen: Finde den frühesten Zyklustag pro Phase-Korrektur
  // und verschiebe die Grenze entsprechend
  const neueGrenzen = standardGrenzen.map((g) => ({ ...g }))

  for (const m of staerkeMuster) {
    const phaseIndex = PHASEN_REIHENFOLGE.indexOf(m.phase)
    if (phaseIndex === -1) continue

    const aktuelleGrenze = neueGrenzen[phaseIndex]

    // Wenn der korrigierte Tag vor dem aktuellen Start liegt, Grenze vorziehen
    if (m.zyklusTag < aktuelleGrenze.start) {
      const vorherigePhase = neueGrenzen[(phaseIndex - 1 + 4) % 4]
      vorherigePhase.ende = m.zyklusTag - 1
      vorherigePhase.laenge = vorherigePhase.ende - vorherigePhase.start + 1
      aktuelleGrenze.start = m.zyklusTag
      aktuelleGrenze.laenge = aktuelleGrenze.ende - aktuelleGrenze.start + 1
    }
    // Wenn der korrigierte Tag nach dem aktuellen Ende liegt, Grenze erweitern
    else if (m.zyklusTag > aktuelleGrenze.ende) {
      const naechstePhase = neueGrenzen[(phaseIndex + 1) % 4]
      aktuelleGrenze.ende = m.zyklusTag
      aktuelleGrenze.laenge = aktuelleGrenze.ende - aktuelleGrenze.start + 1
      naechstePhase.start = m.zyklusTag + 1
      naechstePhase.laenge = naechstePhase.ende - naechstePhase.start + 1
    }
  }

  return neueGrenzen
}
