import { describe, it, expect } from 'vitest'
import {
  schluesselVonDatum,
  mergeEinzelobjekt,
  mergeArrayNachSchluessel,
  mergeChronik,
  mergeGanzesObjekt,
  mergeAlleStores,
} from './mergeLogik'

// =========================================================================
// schluesselVonDatum
// =========================================================================

describe('schluesselVonDatum', () => {
  it('normalisiert Date-Objekt zu YYYY-MM-DD', () => {
    expect(schluesselVonDatum(new Date('2026-01-15T14:30:00Z'))).toBe('2026-01-15')
  })

  it('normalisiert ISO-String zu YYYY-MM-DD', () => {
    expect(schluesselVonDatum('2026-01-15T14:30:00.000Z')).toBe('2026-01-15')
  })

  it('gibt null für null/undefined zurück', () => {
    expect(schluesselVonDatum(null)).toBeNull()
    expect(schluesselVonDatum(undefined)).toBeNull()
  })
})

// =========================================================================
// Strategie A: mergeEinzelobjekt
// =========================================================================

describe('mergeEinzelobjekt', () => {
  const felder = ['zyklusStart', 'zyklusLaenge', 'zyklusTyp', 'ersteinrichtungAbgeschlossen']

  it('übernimmt Cloud-Wert wenn Cloud neuer (AC-4)', () => {
    const lokal = { zyklusStart: '2026-01-05', zyklusLaenge: 30, zyklusTyp: 'rotmond', ersteinrichtungAbgeschlossen: true }
    const lokalTs = { zyklusStart: '2026-01-10T10:00:00Z', zyklusLaenge: '2026-01-10T10:00:00Z', zyklusTyp: '2026-01-10T10:00:00Z', ersteinrichtungAbgeschlossen: '2026-01-10T10:00:00Z' }

    const cloud = { zyklusStart: '2026-01-08', zyklusLaenge: 28, zyklusTyp: 'rotmond', ersteinrichtungAbgeschlossen: true }
    const cloudTs = { zyklusStart: '2026-01-12T10:00:00Z', zyklusLaenge: '2026-01-09T10:00:00Z', zyklusTyp: '2026-01-10T10:00:00Z', ersteinrichtungAbgeschlossen: '2026-01-10T10:00:00Z' }

    const ergebnis = mergeEinzelobjekt(lokal, lokalTs, cloud, cloudTs, felder)

    expect(ergebnis.daten.zyklusStart).toBe('2026-01-08') // Cloud neuer
    expect(ergebnis.daten.zyklusLaenge).toBe(30) // Lokal neuer
    expect(ergebnis.daten.zyklusTyp).toBe('rotmond') // Gleich
    expect(ergebnis.geaendert).toBe(true)
  })

  it('behält lokale Daten wenn gleicher Zeitstempel (Tie-Breaker)', () => {
    const lokal = { zyklusStart: '2026-01-05', zyklusLaenge: 30, zyklusTyp: 'rotmond', ersteinrichtungAbgeschlossen: true }
    const ts = { zyklusStart: '2026-01-10T10:00:00Z', zyklusLaenge: '2026-01-10T10:00:00Z', zyklusTyp: '2026-01-10T10:00:00Z', ersteinrichtungAbgeschlossen: '2026-01-10T10:00:00Z' }
    const cloud = { zyklusStart: '2026-01-08', zyklusLaenge: 28, zyklusTyp: 'weissmond', ersteinrichtungAbgeschlossen: true }

    const ergebnis = mergeEinzelobjekt(lokal, ts, cloud, ts, felder)

    expect(ergebnis.daten.zyklusStart).toBe('2026-01-05') // Lokal gewinnt bei Tie
    expect(ergebnis.geaendert).toBe(false)
  })

  it('verschiedene Felder von verschiedenen Geräten (AC-3)', () => {
    const lokal = { zyklusStart: '2026-01-05', zyklusLaenge: 30, zyklusTyp: 'rotmond', ersteinrichtungAbgeschlossen: true }
    const lokalTs = { zyklusStart: '2026-01-12T10:00:00Z', zyklusLaenge: '2026-01-08T10:00:00Z', zyklusTyp: '2026-01-08T10:00:00Z', ersteinrichtungAbgeschlossen: '2026-01-08T10:00:00Z' }

    const cloud = { zyklusStart: '2026-01-08', zyklusLaenge: 28, zyklusTyp: 'weissmond', ersteinrichtungAbgeschlossen: true }
    const cloudTs = { zyklusStart: '2026-01-08T10:00:00Z', zyklusLaenge: '2026-01-12T10:00:00Z', zyklusTyp: '2026-01-12T10:00:00Z', ersteinrichtungAbgeschlossen: '2026-01-08T10:00:00Z' }

    const ergebnis = mergeEinzelobjekt(lokal, lokalTs, cloud, cloudTs, felder)

    expect(ergebnis.daten.zyklusStart).toBe('2026-01-05') // Lokal neuer
    expect(ergebnis.daten.zyklusLaenge).toBe(28) // Cloud neuer
    expect(ergebnis.daten.zyklusTyp).toBe('weissmond') // Cloud neuer
    expect(ergebnis.geaendert).toBe(true)
  })

  it('behandelt fehlende Zeitstempel (Fallback zu Epoch)', () => {
    const lokal = { zyklusStart: '2026-01-05', zyklusLaenge: 30, zyklusTyp: 'rotmond', ersteinrichtungAbgeschlossen: true }
    const lokalTs = {} // Keine Zeitstempel
    const cloud = { zyklusStart: '2026-01-08', zyklusLaenge: 28, zyklusTyp: 'weissmond', ersteinrichtungAbgeschlossen: true }
    const cloudTs = { zyklusStart: '2026-01-12T10:00:00Z' }

    const ergebnis = mergeEinzelobjekt(lokal, lokalTs, cloud, cloudTs, felder)

    expect(ergebnis.daten.zyklusStart).toBe('2026-01-08') // Cloud hat Zeitstempel, lokal nicht
    expect(ergebnis.daten.zyklusLaenge).toBe(30) // Beide kein Zeitstempel → lokal gewinnt (Tie)
  })

  it('ist idempotent (AC-8)', () => {
    const lokal = { zyklusStart: '2026-01-05', zyklusLaenge: 30, zyklusTyp: 'rotmond', ersteinrichtungAbgeschlossen: true }
    const lokalTs = { zyklusStart: '2026-01-10T10:00:00Z', zyklusLaenge: '2026-01-10T10:00:00Z' }
    const cloud = { zyklusStart: '2026-01-08', zyklusLaenge: 28, zyklusTyp: 'rotmond', ersteinrichtungAbgeschlossen: true }
    const cloudTs = { zyklusStart: '2026-01-12T10:00:00Z', zyklusLaenge: '2026-01-09T10:00:00Z' }

    const ergebnis1 = mergeEinzelobjekt(lokal, lokalTs, cloud, cloudTs, felder)
    const ergebnis2 = mergeEinzelobjekt(lokal, lokalTs, cloud, cloudTs, felder)

    expect(ergebnis1.daten).toEqual(ergebnis2.daten)
    expect(ergebnis1.zeitstempel).toEqual(ergebnis2.zeitstempel)
  })
})

// =========================================================================
// Strategie B: mergeArrayNachSchluessel
// =========================================================================

describe('mergeArrayNachSchluessel', () => {
  const schluesselFn = (e) => e.datum instanceof Date ? e.datum.toISOString().slice(0, 10) : String(e.datum).slice(0, 10)

  it('fügt Einträge von beiden Seiten zusammen', () => {
    const lokal = [{ datum: '2026-01-15', zyklusTag: 5 }]
    const lokalTs = { '2026-01-15': '2026-01-15T10:00:00Z' }
    const cloud = [{ datum: '2026-01-16', zyklusTag: 6 }]
    const cloudTs = { '2026-01-16': '2026-01-16T10:00:00Z' }

    const ergebnis = mergeArrayNachSchluessel(lokal, lokalTs, cloud, cloudTs, schluesselFn)

    expect(ergebnis.daten).toHaveLength(2)
    expect(ergebnis.geaendert).toBe(true)
  })

  it('bei gleichem Schlüssel gewinnt neuerer Eintrag', () => {
    const lokal = [{ datum: '2026-01-15', zyklusTag: 5, korrigiertePhase: 'mutter' }]
    const lokalTs = { '2026-01-15': '2026-01-15T10:00:00Z' }
    const cloud = [{ datum: '2026-01-15', zyklusTag: 5, korrigiertePhase: 'zauberin' }]
    const cloudTs = { '2026-01-15': '2026-01-15T14:00:00Z' }

    const ergebnis = mergeArrayNachSchluessel(lokal, lokalTs, cloud, cloudTs, schluesselFn)

    expect(ergebnis.daten).toHaveLength(1)
    expect(ergebnis.daten[0].korrigiertePhase).toBe('zauberin') // Cloud neuer
    expect(ergebnis.geaendert).toBe(true)
  })

  it('bei gleichem Schlüssel und gleichem Zeitstempel gewinnt lokal', () => {
    const ts = '2026-01-15T10:00:00Z'
    const lokal = [{ datum: '2026-01-15', zyklusTag: 5, korrigiertePhase: 'mutter' }]
    const cloud = [{ datum: '2026-01-15', zyklusTag: 5, korrigiertePhase: 'zauberin' }]

    const ergebnis = mergeArrayNachSchluessel(lokal, { '2026-01-15': ts }, cloud, { '2026-01-15': ts }, schluesselFn)

    expect(ergebnis.daten[0].korrigiertePhase).toBe('mutter') // Lokal gewinnt bei Tie
    expect(ergebnis.geaendert).toBe(false)
  })

  it('sortiert Ergebnis chronologisch', () => {
    const lokal = [{ datum: '2026-01-17', zyklusTag: 7 }]
    const cloud = [{ datum: '2026-01-15', zyklusTag: 5 }, { datum: '2026-01-16', zyklusTag: 6 }]

    const ergebnis = mergeArrayNachSchluessel(lokal, {}, cloud, {}, schluesselFn)

    expect(ergebnis.daten.map((e) => e.datum)).toEqual(['2026-01-15', '2026-01-16', '2026-01-17'])
  })

  it('ist idempotent', () => {
    const lokal = [{ datum: '2026-01-15', zyklusTag: 5 }]
    const lokalTs = { '2026-01-15': '2026-01-15T10:00:00Z' }
    const cloud = [{ datum: '2026-01-16', zyklusTag: 6 }]
    const cloudTs = { '2026-01-16': '2026-01-16T10:00:00Z' }

    const e1 = mergeArrayNachSchluessel(lokal, lokalTs, cloud, cloudTs, schluesselFn)
    const e2 = mergeArrayNachSchluessel(lokal, lokalTs, cloud, cloudTs, schluesselFn)

    expect(e1.daten).toEqual(e2.daten)
  })
})

// =========================================================================
// Strategie C: mergeChronik
// =========================================================================

describe('mergeChronik', () => {
  it('verschiedene Felder am gleichen Tag werden zusammengeführt (AC-3)', () => {
    const lokal = [{
      datum: '2026-01-15',
      stimmung: 'freudig',
      energie: null,
      koerper: null,
      traeume: '',
      kreativitaet: '',
      sexuellesEmpfinden: null,
      phase: 'mutter',
    }]
    const lokalTs = { '2026-01-15': { stimmung: '2026-01-15T14:00:00Z', phase: '2026-01-15T14:00:00Z' } }

    const cloud = [{
      datum: '2026-01-15',
      stimmung: null,
      energie: 7,
      koerper: null,
      traeume: 'Wald',
      kreativitaet: '',
      sexuellesEmpfinden: null,
      phase: 'mutter',
    }]
    const cloudTs = { '2026-01-15': { energie: '2026-01-15T20:00:00Z', traeume: '2026-01-15T20:00:00Z', phase: '2026-01-15T14:00:00Z' } }

    const ergebnis = mergeChronik(lokal, lokalTs, cloud, cloudTs)

    expect(ergebnis.daten).toHaveLength(1)
    expect(ergebnis.daten[0].stimmung).toBe('freudig') // Lokal hatte Zeitstempel
    expect(ergebnis.daten[0].energie).toBe(7) // Cloud hatte Zeitstempel
    expect(ergebnis.daten[0].traeume).toBe('Wald') // Cloud hatte Zeitstempel
    expect(ergebnis.geaendert).toBe(true)
  })

  it('gleiches Feld → neuerer gewinnt (AC-4)', () => {
    const lokal = [{ datum: '2026-01-15', stimmung: 'traurig', energie: 3, koerper: null, traeume: '', kreativitaet: '', sexuellesEmpfinden: null, phase: 'zauberin' }]
    const lokalTs = { '2026-01-15': { stimmung: '2026-01-15T10:00:00Z', energie: '2026-01-15T10:00:00Z' } }

    const cloud = [{ datum: '2026-01-15', stimmung: 'freudig', energie: 7, koerper: null, traeume: '', kreativitaet: '', sexuellesEmpfinden: null, phase: 'zauberin' }]
    const cloudTs = { '2026-01-15': { stimmung: '2026-01-15T14:00:00Z', energie: '2026-01-15T08:00:00Z' } }

    const ergebnis = mergeChronik(lokal, lokalTs, cloud, cloudTs)

    expect(ergebnis.daten[0].stimmung).toBe('freudig') // Cloud neuer
    expect(ergebnis.daten[0].energie).toBe(3) // Lokal neuer
  })

  it('koerper-Array: Union-Merge', () => {
    const lokal = [{ datum: '2026-01-15', koerper: ['Kopfschmerzen', 'Muedigkeit'], stimmung: null, energie: null, traeume: '', kreativitaet: '', sexuellesEmpfinden: null, phase: null }]
    const lokalTs = { '2026-01-15': { koerper: '2026-01-15T10:00:00Z' } }

    const cloud = [{ datum: '2026-01-15', koerper: ['Muedigkeit', 'Uebelkeit'], stimmung: null, energie: null, traeume: '', kreativitaet: '', sexuellesEmpfinden: null, phase: null }]
    const cloudTs = { '2026-01-15': { koerper: '2026-01-15T14:00:00Z' } }

    const ergebnis = mergeChronik(lokal, lokalTs, cloud, cloudTs)

    expect(ergebnis.daten[0].koerper).toContain('Kopfschmerzen')
    expect(ergebnis.daten[0].koerper).toContain('Muedigkeit')
    expect(ergebnis.daten[0].koerper).toContain('Uebelkeit')
    expect(ergebnis.daten[0].koerper).toHaveLength(3) // Keine Duplikate
    expect(ergebnis.geaendert).toBe(true)
  })

  it('Einträge an verschiedenen Tagen werden zusammengeführt', () => {
    const lokal = [{ datum: '2026-01-15', stimmung: 'freudig', koerper: null, energie: null, traeume: '', kreativitaet: '', sexuellesEmpfinden: null, phase: null }]
    const cloud = [{ datum: '2026-01-16', stimmung: 'traurig', koerper: null, energie: null, traeume: '', kreativitaet: '', sexuellesEmpfinden: null, phase: null }]

    const ergebnis = mergeChronik(lokal, {}, cloud, {})

    expect(ergebnis.daten).toHaveLength(2)
    expect(ergebnis.geaendert).toBe(true)
  })

  it('identische Daten → geaendert: false', () => {
    const eintrag = { datum: '2026-01-15', stimmung: 'freudig', koerper: null, energie: 5, traeume: '', kreativitaet: '', sexuellesEmpfinden: null, phase: 'mutter' }
    const ts = { stimmung: '2026-01-15T10:00:00Z', energie: '2026-01-15T10:00:00Z' }

    const ergebnis = mergeChronik([{ ...eintrag }], { '2026-01-15': { ...ts } }, [{ ...eintrag }], { '2026-01-15': { ...ts } })

    expect(ergebnis.geaendert).toBe(false)
  })

  it('ist idempotent (AC-8)', () => {
    const lokal = [{ datum: '2026-01-15', stimmung: 'freudig', koerper: ['Kopfschmerzen'], energie: null, traeume: '', kreativitaet: '', sexuellesEmpfinden: null, phase: null }]
    const lokalTs = { '2026-01-15': { stimmung: '2026-01-15T10:00:00Z', koerper: '2026-01-15T10:00:00Z' } }
    const cloud = [{ datum: '2026-01-15', stimmung: null, koerper: ['Uebelkeit'], energie: 7, traeume: 'Traum', kreativitaet: '', sexuellesEmpfinden: null, phase: null }]
    const cloudTs = { '2026-01-15': { energie: '2026-01-15T14:00:00Z', traeume: '2026-01-15T14:00:00Z', koerper: '2026-01-15T14:00:00Z' } }

    const e1 = mergeChronik(lokal, lokalTs, cloud, cloudTs)
    const e2 = mergeChronik(lokal, lokalTs, cloud, cloudTs)

    expect(e1.daten).toEqual(e2.daten)
    expect(e1.zeitstempel).toEqual(e2.zeitstempel)
  })
})

// =========================================================================
// Strategie D: mergeGanzesObjekt
// =========================================================================

describe('mergeGanzesObjekt', () => {
  it('Cloud gewinnt wenn neuer', () => {
    const lokal = { phase1: 7, phase2: 14 }
    const cloud = { phase1: 8, phase2: 15 }

    const ergebnis = mergeGanzesObjekt(lokal, '2026-01-10T10:00:00Z', cloud, '2026-01-12T10:00:00Z')

    expect(ergebnis.daten).toEqual(cloud)
    expect(ergebnis.geaendert).toBe(true)
  })

  it('Lokal gewinnt wenn neuer', () => {
    const lokal = { phase1: 7, phase2: 14 }
    const cloud = { phase1: 8, phase2: 15 }

    const ergebnis = mergeGanzesObjekt(lokal, '2026-01-12T10:00:00Z', cloud, '2026-01-10T10:00:00Z')

    expect(ergebnis.daten).toEqual(lokal)
    expect(ergebnis.geaendert).toBe(false)
  })

  it('Lokal gewinnt bei gleichem Zeitstempel', () => {
    const ts = '2026-01-10T10:00:00Z'
    const ergebnis = mergeGanzesObjekt({ a: 1 }, ts, { a: 2 }, ts)

    expect(ergebnis.daten).toEqual({ a: 1 })
    expect(ergebnis.geaendert).toBe(false)
  })

  it('behandelt null-Werte', () => {
    const ergebnis = mergeGanzesObjekt(null, '', { a: 1 }, '2026-01-10T10:00:00Z')

    expect(ergebnis.daten).toEqual({ a: 1 })
    expect(ergebnis.geaendert).toBe(true)
  })

  it('behandelt {} als fehlenden Zeitstempel (BUG-1 Regression)', () => {
    // ladeZeitstempel gibt {} zurück wenn nie geschrieben → Cloud muss gewinnen
    const ergebnis = mergeGanzesObjekt(null, {}, { phase1: 7 }, '2026-01-10T10:00:00Z')

    expect(ergebnis.daten).toEqual({ phase1: 7 })
    expect(ergebnis.geaendert).toBe(true)
  })
})

// =========================================================================
// Orchestrator: mergeAlleStores
// =========================================================================

describe('mergeAlleStores', () => {
  it('mergt alle 7 Stores', () => {
    const lokaleDaten = {
      zyklusdaten: { zyklusStart: '2026-01-05', zyklusLaenge: 30, zyklusTyp: 'rotmond', ersteinrichtungAbgeschlossen: true },
      korrekturen: [],
      historie: [],
      chronik: [],
      tageskarten: [],
      hinweis: { letzterHinweis: null, nutzerinHatAbgelehnt: false, ablehnungsDatum: null },
      grenzen: null,
    }
    const lokaleTs = {
      zyklusdaten: { zyklusStart: '2026-01-10T10:00:00Z', zyklusLaenge: '2026-01-10T10:00:00Z' },
      korrekturen: {},
      historie: {},
      chronik: {},
      tageskarten: {},
      hinweis: {},
      grenzen: '',
    }

    const cloudDaten = {
      zyklusdaten: { zyklusStart: '2026-01-08', zyklusLaenge: 28, zyklusTyp: 'weissmond', ersteinrichtungAbgeschlossen: true },
      korrekturen: [{ datum: '2026-01-15', zyklusTag: 5, korrigiertePhase: 'mutter' }],
      historie: [],
      chronik: [],
      tageskarten: [],
      hinweis: { letzterHinweis: null, nutzerinHatAbgelehnt: false, ablehnungsDatum: null },
      grenzen: { phase1: 7 },
    }
    const cloudTs = {
      zyklusdaten: { zyklusStart: '2026-01-12T10:00:00Z', zyklusLaenge: '2026-01-08T10:00:00Z' },
      korrekturen: { '2026-01-15': '2026-01-15T10:00:00Z' },
      historie: {},
      chronik: {},
      tageskarten: {},
      hinweis: {},
      grenzen: '2026-01-12T10:00:00Z',
    }

    const ergebnis = mergeAlleStores(lokaleDaten, lokaleTs, cloudDaten, cloudTs)

    expect(ergebnis.hatGemerged).toBe(true)
    // Zyklusdaten: zyklusStart von Cloud (neuer), zyklusLaenge von Lokal (neuer)
    expect(ergebnis.daten.zyklusdaten.zyklusStart).toBe('2026-01-08')
    expect(ergebnis.daten.zyklusdaten.zyklusLaenge).toBe(30)
    // Korrekturen: Cloud-Eintrag übernommen
    expect(ergebnis.daten.korrekturen).toHaveLength(1)
    // Grenzen: Cloud gewinnt (hat Zeitstempel)
    expect(ergebnis.daten.grenzen).toEqual({ phase1: 7 })
    // geaenderteStores: nur tatsächlich geänderte Stores sind true
    expect(ergebnis.geaenderteStores.zyklusdaten).toBe(true)
    expect(ergebnis.geaenderteStores.korrekturen).toBe(true)
    expect(ergebnis.geaenderteStores.zyklushistorie).toBe(false)
    expect(ergebnis.geaenderteStores.chronik).toBe(false)
    expect(ergebnis.geaenderteStores.tageskarten).toBe(false)
    expect(ergebnis.geaenderteStores.zyklustyp_hinweis).toBe(false)
    expect(ergebnis.geaenderteStores.angepasste_grenzen).toBe(true)
  })

  it('gibt hatGemerged: false wenn alles identisch', () => {
    const daten = {
      zyklusdaten: { zyklusStart: '2026-01-05', zyklusLaenge: 28, zyklusTyp: 'rotmond', ersteinrichtungAbgeschlossen: true },
      korrekturen: [],
      historie: [],
      chronik: [],
      tageskarten: [],
      hinweis: { letzterHinweis: null, nutzerinHatAbgelehnt: false, ablehnungsDatum: null },
      grenzen: null,
    }
    const ts = {
      zyklusdaten: { zyklusStart: '2026-01-10T10:00:00Z' },
      korrekturen: {},
      historie: {},
      chronik: {},
      tageskarten: {},
      hinweis: {},
      grenzen: '',
    }

    const ergebnis = mergeAlleStores(daten, ts, daten, ts)

    expect(ergebnis.hatGemerged).toBe(false)
    // Alle Stores unverändert
    expect(ergebnis.geaenderteStores.zyklusdaten).toBe(false)
    expect(ergebnis.geaenderteStores.korrekturen).toBe(false)
    expect(ergebnis.geaenderteStores.tageskarten).toBe(false)
  })
})
