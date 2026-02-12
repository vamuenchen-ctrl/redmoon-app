import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ladeZyklusdaten,
  speichereZyklusdaten,
  aktualisiereZyklusdaten,
  fuegeZyklusHinzu,
  aktualisiereLetztenZyklus,
  ladeZyklushistorie,
  ladeAngepassteGrenzen,
  setzeGrenzenZurueck,
} from '../utils/speicher'
import { useSyncEngine } from '../context/SyncEngineContext'
import { berechneZyklusTyp, berechneZyklusPhase, berechnePhasenGrenzen, PHASEN_INFO } from '../utils/zyklus'
import { berechneMondphase } from '../utils/mondphasen'
import CloudBanner from '../components/CloudBanner'
import { useAuth } from '../context/AuthContext.jsx'
import { supabase } from '../utils/supabase.js'

// ---------------------------------------------------------------------------
// Tooltip-Texte
// ---------------------------------------------------------------------------

const TOOLTIP_WEISSMOND =
  'Deine Menstruation fällt in die Neumondphase und dein Eisprung in die Vollmondphase. Dieser Typ wird traditionell mit Fruchtbarkeit, Nähren und nach außen gerichteter Energie in Verbindung gebracht.'

const TOOLTIP_ROTMOND =
  'Deine Menstruation fällt in die Vollmondphase und dein Eisprung in die Neumondphase. Dieser Typ wird traditionell mit Heilung, Intuition und nach innen gerichteter Kreativität verbunden.'

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

/** Formatiert ein Date als YYYY-MM-DD für <input type="date"> */
function datumAlsString(datum) {
  const j = datum.getFullYear()
  const m = String(datum.getMonth() + 1).padStart(2, '0')
  const t = String(datum.getDate()).padStart(2, '0')
  return `${j}-${m}-${t}`
}

/** Parst einen YYYY-MM-DD String als lokales Date (Mitternacht) */
function stringAlsDatum(str) {
  const [j, m, t] = str.split('-').map(Number)
  return new Date(j, m - 1, t)
}

// ===========================================================================
// Hauptkomponente
// ===========================================================================

function Einstellungen() {
  const { syncVersion } = useSyncEngine()
  const { migration } = useAuth()
  const [daten, setDaten] = useState(null)

  useEffect(() => {
    setDaten(ladeZyklusdaten())
  }, [syncVersion, migration])

  if (!daten) return null

  if (!daten.ersteinrichtungAbgeschlossen) {
    return <Onboarding onFertig={() => setDaten(ladeZyklusdaten())} />
  }

  return <EinstellungenAnsicht daten={daten} onUpdate={() => setDaten(ladeZyklusdaten())} />
}

// ===========================================================================
// Onboarding (3 Schritte: Anmeldung → Zyklusdaten → Zyklustyp)
// ===========================================================================

function Onboarding({ onFertig }) {
  const navigate = useNavigate()
  const { user } = useAuth()

  // Wenn Supabase konfiguriert ist: Login als Schritt 1, sonst direkt Zyklusdaten
  const [schritt, setSchritt] = useState(supabase ? 1 : 2)
  const gesamtSchritte = supabase ? 3 : 2

  // Nach OAuth-Rückkehr: User ist eingeloggt → Login-Schritt überspringen
  useEffect(() => {
    if (user && schritt === 1) {
      setSchritt(2)
    }
  }, [user, schritt])

  // Anzeige-Schrittnummer (ohne Supabase: Schritt 2→1, 3→2)
  function anzeigeSchritt() {
    return supabase ? schritt : schritt - 1
  }

  // Schritt 2: Formularwerte
  const [startDatum, setStartDatum] = useState(datumAlsString(new Date()))
  const [zyklusLaenge, setZyklusLaenge] = useState(28)
  const [zyklusLaengeText, setZyklusLaengeText] = useState('28')

  // Schritt 3: Zyklustyp
  const [zyklusTyp, setZyklusTyp] = useState(null)
  const [typInfo, setTypInfo] = useState(null)

  // Schritt 3: Tooltips
  const [tooltipOffen, setTooltipOffen] = useState(null) // 'weissmond' | 'rotmond' | null

  // Tooltip außerhalb schließen
  const tooltipRef = useRef(null)
  useEffect(() => {
    function handleClickAussen(e) {
      if (tooltipRef.current && !tooltipRef.current.contains(e.target)) {
        setTooltipOffen(null)
      }
    }
    if (tooltipOffen) {
      document.addEventListener('mousedown', handleClickAussen)
      return () => document.removeEventListener('mousedown', handleClickAussen)
    }
  }, [tooltipOffen])

  // Beim Wechsel zu Schritt 3: Zyklustyp berechnen
  function geheZuSchritt3() {
    const datum = stringAlsDatum(startDatum)
    const info = berechneZyklusTyp(datum)
    setTypInfo(info)
    setZyklusTyp(info.naechsterTyp)
    setSchritt(3)
  }

  // Alles speichern und App starten
  function appStarten() {
    const datum = stringAlsDatum(startDatum)
    const mondInfo = berechneMondphase(datum)

    speichereZyklusdaten({
      zyklusStart: datum,
      zyklusLaenge,
      zyklusTyp,
      ersteinrichtungAbgeschlossen: true,
    })

    fuegeZyklusHinzu({
      startdatum: datum,
      mondphase: mondInfo.phase,
      zyklusTyp,
      zyklusLaenge,
    })

    onFertig()
    window.dispatchEvent(new Event('rotermond:phasen-update'))
    navigate('/')
  }

  // --- Schritt 1: Anmeldung (nur wenn Supabase konfiguriert) ---
  if (schritt === 1) {
    return (
      <div className="page einstellungen-page">
        <div className="onboarding-schritt">
          <h1>Willkommen bei Roter Mond</h1>
          <div className="onboarding-fortschritt">Schritt 1 von 3</div>
          <h2>Anmeldung</h2>

          <p className="onboarding-text">
            Wenn du dich anmeldest, werden deine Daten sicher in der Cloud
            gespeichert und auf all deinen Geräten synchronisiert.
          </p>

          <button className="btn-primary" onClick={() => navigate('/anmelden')}>
            Anmelden
          </button>
          <button
            className="btn-secondary"
            onClick={() => setSchritt(2)}
            style={{ marginTop: '12px' }}
          >
            Als Gast fortfahren
          </button>
          <p className="text-muted onboarding-cloud-spaeter">
            Du kannst dich jederzeit später unter Einstellungen anmelden.
          </p>
        </div>
      </div>
    )
  }

  // --- Schritt 2: Zyklusdaten ---
  if (schritt === 2) {
    return (
      <div className="page einstellungen-page">
        <div className="onboarding-schritt">
          <h1>Willkommen bei Roter Mond</h1>
          <div className="onboarding-fortschritt">Schritt {anzeigeSchritt()} von {gesamtSchritte}</div>
          <h2>Deine Zyklusdaten</h2>

          <label className="form-label">
            Wann hat deine letzte Menstruation begonnen?
            <input
              type="date"
              className="form-input"
              value={startDatum}
              max={datumAlsString(new Date())}
              onChange={(e) => setStartDatum(e.target.value)}
            />
          </label>

          <label className="form-label">
            Wie lang ist dein Zyklus durchschnittlich?
            <div className="zyklus-laenge-eingabe">
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                className="form-input form-input-zahl"
                value={zyklusLaengeText}
                onChange={(e) => setZyklusLaengeText(e.target.value.replace(/[^0-9]/g, ''))}
                onBlur={() => {
                  const val = parseInt(zyklusLaengeText, 10)
                  if (!isNaN(val) && val >= 1 && val <= 999) {
                    setZyklusLaenge(val)
                    setZyklusLaengeText(String(val))
                  } else {
                    setZyklusLaengeText(String(zyklusLaenge))
                  }
                }}
              />
              <span className="form-einheit">Tage</span>
            </div>
          </label>

          <button className="btn-primary" onClick={geheZuSchritt3}>
            Weiter
          </button>
        </div>
      </div>
    )
  }

  // --- Schritt 3: Zyklustyp ---
  if (schritt === 3) {
    return (
      <div className="page einstellungen-page">
        <div className="onboarding-schritt" ref={tooltipRef}>
          <h1>Willkommen bei Roter Mond</h1>
          <div className="onboarding-fortschritt">Schritt {anzeigeSchritt()} von {gesamtSchritte}</div>
          <h2>Dein Zyklustyp</h2>

          {typInfo && (
            <p className="mondphase-info">{typInfo.erklaerung}</p>
          )}

          <div className="zyklustyp-auswahl">
            <ZyklustypKarte
              typ="weissmond"
              label="Weißmond-Zyklus"
              symbol="🌑"
              ausgewaehlt={zyklusTyp === 'weissmond'}
              berechnet={typInfo && typInfo.naechsterTyp === 'weissmond'}
              onWaehlen={() => setZyklusTyp('weissmond')}
              tooltipOffen={tooltipOffen === 'weissmond'}
              onTooltipToggle={() =>
                setTooltipOffen((v) => (v === 'weissmond' ? null : 'weissmond'))
              }
              tooltipText={TOOLTIP_WEISSMOND}
            />
            <ZyklustypKarte
              typ="rotmond"
              label="Rotmond-Zyklus"
              symbol="🌕"
              ausgewaehlt={zyklusTyp === 'rotmond'}
              berechnet={typInfo && typInfo.naechsterTyp === 'rotmond'}
              onWaehlen={() => setZyklusTyp('rotmond')}
              tooltipOffen={tooltipOffen === 'rotmond'}
              onTooltipToggle={() =>
                setTooltipOffen((v) => (v === 'rotmond' ? null : 'rotmond'))
              }
              tooltipText={TOOLTIP_ROTMOND}
            />
          </div>

          <button className="btn-primary" onClick={appStarten}>
            App starten
          </button>
        </div>
      </div>
    )
  }

  return null
}

// ===========================================================================
// Zyklustyp-Karte (wiederverwendbar)
// ===========================================================================

function ZyklustypKarte({
  typ,
  label,
  symbol,
  ausgewaehlt,
  onWaehlen,
  tooltipOffen,
  onTooltipToggle,
  tooltipText,
  berechnet,
}) {
  return (
    <div
      className={`zyklustyp-karte ${ausgewaehlt ? 'zyklustyp-karte-aktiv' : ''}`}
      onClick={onWaehlen}
    >
      <div className="zyklustyp-karte-kopf">
        <span className="zyklustyp-symbol">{symbol}</span>
        <span className="zyklustyp-label">{label}</span>
        <button
          className="info-btn"
          onClick={(e) => {
            e.stopPropagation()
            onTooltipToggle()
          }}
          aria-label={`Info zu ${label}`}
        >
          ⓘ
        </button>
        {berechnet && (
          <span className="phasen-karte-badge">berechnet</span>
        )}
      </div>
      {tooltipOffen && (
        <div className="tooltip">
          {tooltipText}
        </div>
      )}
    </div>
  )
}

// ===========================================================================
// Einstellungen-Ansicht (nach Ersteinrichtung)
// ===========================================================================

function EinstellungenAnsicht({ daten, onUpdate }) {
  const { syncVersion } = useSyncEngine()
  const [startDatum, setStartDatum] = useState(
    daten.zyklusStart ? datumAlsString(daten.zyklusStart) : datumAlsString(new Date()),
  )
  const [zyklusLaenge, setZyklusLaenge] = useState(daten.zyklusLaenge)
  const [zyklusLaengeText, setZyklusLaengeText] = useState(String(daten.zyklusLaenge))
  const [zyklusTyp, setZyklusTyp] = useState(daten.zyklusTyp || 'weissmond')
  const [tooltipOffen, setTooltipOffen] = useState(null)
  const [gespeichertMeldung, setGespeichertMeldung] = useState(false)

  // Berechneter Zyklustyp-Vorschlag (immer eindeutig)
  const berechneterTyp = daten.zyklusStart
    ? berechneZyklusTyp(daten.zyklusStart).naechsterTyp
    : null

  // Neuer Zyklus
  const [neuerZyklusOffen, setNeuerZyklusOffen] = useState(false)
  const [neuerZyklusStart, setNeuerZyklusStart] = useState(datumAlsString(new Date()))

  // Historie
  const [historie, setHistorie] = useState([])

  // Phasengrenzen (personalisiert oder Standard)
  const [angepassteGrenzen, setAngepassteGrenzen] = useState(null)
  const [grenzenZurueckgesetzt, setGrenzenZurueckgesetzt] = useState(false)

  // Archetyp-Info-Tooltip
  const [archetypTooltipPhase, setArchetypTooltipPhase] = useState(null) // phase key or null

  // Klappbare Sektionen
  const [offeneSektionen, setOffeneSektionen] = useState(new Set())
  function toggleSektion(key) {
    setOffeneSektionen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  useEffect(() => {
    setHistorie(ladeZyklushistorie())
    setAngepassteGrenzen(ladeAngepassteGrenzen())
  }, [syncVersion])

  // Tooltip außerhalb schließen
  const tooltipRef = useRef(null)
  useEffect(() => {
    function handleClickAussen(e) {
      if (tooltipRef.current && !tooltipRef.current.contains(e.target)) {
        setTooltipOffen(null)
      }
    }
    if (tooltipOffen) {
      document.addEventListener('mousedown', handleClickAussen)
      return () => document.removeEventListener('mousedown', handleClickAussen)
    }
  }, [tooltipOffen])

  function speichern() {
    const neuesDatum = stringAlsDatum(startDatum)
    aktualisiereZyklusdaten({
      zyklusStart: neuesDatum,
      zyklusLaenge,
      zyklusTyp,
    })
    // Letzten Historieneintrag ebenfalls aktualisieren
    const mondInfo = berechneMondphase(neuesDatum)
    aktualisiereLetztenZyklus({
      startdatum: neuesDatum,
      mondphase: mondInfo.phase,
      zyklusTyp,
      zyklusLaenge,
    })
    setHistorie(ladeZyklushistorie())
    window.dispatchEvent(new Event('rotermond:phasen-update'))
    setGespeichertMeldung(true)
    setTimeout(() => setGespeichertMeldung(false), 2000)
    onUpdate()
  }

  function neuerZyklusStarten() {
    const datum = stringAlsDatum(neuerZyklusStart)
    const mondInfo = berechneMondphase(datum)
    const typInfo = berechneZyklusTyp(datum)
    const neuerTyp = typInfo.vorschlag === 'unklar' ? zyklusTyp : typInfo.vorschlag

    // Tatsächliche Dauer des vorherigen Zyklus berechnen und aktualisieren
    if (daten.zyklusStart) {
      const diffMs = datum.getTime() - daten.zyklusStart.getTime()
      const tatsaechlicheTage = Math.round(diffMs / (1000 * 60 * 60 * 24))
      if (tatsaechlicheTage > 0) {
        aktualisiereLetztenZyklus({ zyklusLaenge: tatsaechlicheTage })
      }
    }

    // Durchschnittliche Zykluslänge aus abgeschlossenen Zyklen berechnen
    const aktHistorie = ladeZyklushistorie()
    let neueLaenge = zyklusLaenge
    if (aktHistorie.length > 0) {
      const summe = aktHistorie.reduce((s, e) => s + e.zyklusLaenge, 0)
      neueLaenge = Math.round(summe / aktHistorie.length)
    }

    fuegeZyklusHinzu({
      startdatum: datum,
      mondphase: mondInfo.phase,
      zyklusTyp: neuerTyp,
      zyklusLaenge: neueLaenge,
    })

    aktualisiereZyklusdaten({
      zyklusStart: datum,
      zyklusTyp: neuerTyp,
      zyklusLaenge: neueLaenge,
    })

    setZyklusTyp(neuerTyp)
    setZyklusLaenge(neueLaenge)
    setZyklusLaengeText(String(neueLaenge))
    setNeuerZyklusOffen(false)
    setStartDatum(datumAlsString(datum))
    setHistorie(ladeZyklushistorie())
    window.dispatchEvent(new Event('rotermond:phasen-update'))
    onUpdate()
  }

  // Aktuelle Phase berechnen
  const aktuellePhase = daten.zyklusStart
    ? berechneZyklusPhase(daten.zyklusStart, daten.zyklusLaenge, new Date())
    : null

  return (
    <div className="page einstellungen-page">
      <h1>Einstellungen</h1>
      <p className="page-subtitle">Zyklus-Einrichtung</p>

      {/* Aktuelle Phase */}
      {aktuellePhase && (
        <div
          className={`settings-card klappbar ${offeneSektionen.has('phase') ? 'klappbar-offen' : ''}`}
          style={{ '--karten-farbe': PHASEN_INFO[aktuellePhase.phase].farbeHex }}
        >
          <button className="settings-card-header klappbar-kopf" onClick={() => toggleSektion('phase')}>
            <span>Aktuelle Phase</span>
            <span className="klappbar-pfeil">›</span>
          </button>
          {offeneSektionen.has('phase') && (
            <div className="klappbar-inhalt">
              <div className="aktuelle-phase-anzeige">
                <button
                  className="archetyp-symbol-btn phase-symbol"
                  onClick={() => setArchetypTooltipPhase(
                    archetypTooltipPhase === aktuellePhase.phase ? null : aktuellePhase.phase
                  )}
                >
                  {PHASEN_INFO[aktuellePhase.phase].symbol}
                </button>
                <span className="phase-name">{aktuellePhase.phaseName}</span>
                <span className="phase-tag">Tag {aktuellePhase.zyklusTag}</span>
              </div>
              {archetypTooltipPhase === aktuellePhase.phase && (
                <div
                  className="archetyp-info-tooltip"
                  style={{ '--phasen-farbe': PHASEN_INFO[aktuellePhase.phase].farbeHex }}
                >
                  <div className="archetyp-info-tooltip-kopf">
                    <span className="archetyp-info-tooltip-name">
                      {PHASEN_INFO[aktuellePhase.phase].symbol} {PHASEN_INFO[aktuellePhase.phase].kurzname}
                    </span>
                    <button
                      className="archetyp-info-tooltip-close"
                      onClick={() => setArchetypTooltipPhase(null)}
                    >
                      ✕
                    </button>
                  </div>
                  <p>{PHASEN_INFO[aktuellePhase.phase].kurzbeschreibung}</p>
                  <p className="archetyp-info-tooltip-energie">
                    {PHASEN_INFO[aktuellePhase.phase].kernenergie}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Phasenaufteilung */}
      <PhasenBalken
        zyklusLaenge={daten.zyklusLaenge}
        angepassteGrenzen={angepassteGrenzen}
        grenzenZurueckgesetzt={grenzenZurueckgesetzt}
        onZuruecksetzen={() => {
          setzeGrenzenZurueck()
          setAngepassteGrenzen(null)
          setGrenzenZurueckgesetzt(true)
          setTimeout(() => setGrenzenZurueckgesetzt(false), 2000)
        }}
      />

      {/* Zyklusdaten bearbeiten */}
      <div
        className={`settings-card klappbar ${offeneSektionen.has('zyklusdaten') ? 'klappbar-offen' : ''}`}
        style={{ '--karten-farbe': 'var(--color-indigo)' }}
      >
        <button className="settings-card-header klappbar-kopf" onClick={() => toggleSektion('zyklusdaten')}>
          <span>Zyklusdaten</span>
          <span className="klappbar-pfeil">›</span>
        </button>
        {offeneSektionen.has('zyklusdaten') && (
        <div className="klappbar-inhalt">

        <label className="form-label">
          Beginn letzte Menstruation
          <input
            type="date"
            className="form-input"
            value={startDatum}
            max={datumAlsString(new Date())}
            onChange={(e) => setStartDatum(e.target.value)}
          />
        </label>

        {(() => {
          const startDate = stringAlsDatum(startDatum)
          if (startDate) {
            const tageHer = Math.floor((new Date() - startDate) / (1000 * 60 * 60 * 24))
            if (tageHer > zyklusLaenge) {
              return (
                <div className="hinweis-card zykluslaenge-hinweis">
                  <p>
                    Deine letzte Menstruation ist {tageHer} Tage her – das ist länger als deine
                    eingestellte Zykluslänge von {zyklusLaenge} Tagen.
                  </p>
                  <button
                    className="btn-secondary"
                    onClick={() => {
                      setZyklusLaenge(tageHer)
                      setZyklusLaengeText(String(tageHer))
                    }}
                  >
                    Zykluslänge auf {tageHer} Tage anpassen
                  </button>
                </div>
              )
            }
          }
          return null
        })()}

        <label className="form-label">
          Zykluslänge
          <div className="zyklus-laenge-eingabe">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              className="form-input form-input-zahl"
              value={zyklusLaengeText}
              onChange={(e) => setZyklusLaengeText(e.target.value.replace(/[^0-9]/g, ''))}
              onBlur={() => {
                const val = parseInt(zyklusLaengeText, 10)
                if (!isNaN(val) && val >= 1 && val <= 999) {
                  setZyklusLaenge(val)
                  setZyklusLaengeText(String(val))
                } else {
                  setZyklusLaengeText(String(zyklusLaenge))
                }
              }}
            />
            <span className="form-einheit">Tage</span>
          </div>
        </label>

        {/* Zyklustyp */}
        <div className="form-label" ref={tooltipRef}>
          Zyklustyp
          <div className="zyklustyp-auswahl zyklustyp-auswahl-klein">
            <ZyklustypKarte
              typ="weissmond"
              label="Weißmond"
              symbol="🌑"
              ausgewaehlt={zyklusTyp === 'weissmond'}
              berechnet={berechneterTyp === 'weissmond'}
              onWaehlen={() => setZyklusTyp('weissmond')}
              tooltipOffen={tooltipOffen === 'weissmond'}
              onTooltipToggle={() =>
                setTooltipOffen((v) => (v === 'weissmond' ? null : 'weissmond'))
              }
              tooltipText={TOOLTIP_WEISSMOND}
            />
            <ZyklustypKarte
              typ="rotmond"
              label="Rotmond"
              symbol="🌕"
              ausgewaehlt={zyklusTyp === 'rotmond'}
              berechnet={berechneterTyp === 'rotmond'}
              onWaehlen={() => setZyklusTyp('rotmond')}
              tooltipOffen={tooltipOffen === 'rotmond'}
              onTooltipToggle={() =>
                setTooltipOffen((v) => (v === 'rotmond' ? null : 'rotmond'))
              }
              tooltipText={TOOLTIP_ROTMOND}
            />
          </div>
        </div>

        <button className="btn-primary" onClick={speichern}>
          {gespeichertMeldung ? '✓ Gespeichert' : 'Speichern'}
        </button>
        </div>
        )}
      </div>

      {/* Neuen Zyklus starten */}
      <div
        className={`settings-card klappbar ${offeneSektionen.has('neuerZyklus') ? 'klappbar-offen' : ''}`}
        style={{ '--karten-farbe': 'var(--color-bordeaux)' }}
      >
        <button className="settings-card-header klappbar-kopf" onClick={() => toggleSektion('neuerZyklus')}>
          <span>Neuer Zyklus</span>
          <span className="klappbar-pfeil">›</span>
        </button>
        {offeneSektionen.has('neuerZyklus') && (
          <div className="klappbar-inhalt">
            {!neuerZyklusOffen ? (
              <button
                className="btn-secondary"
                onClick={() => setNeuerZyklusOffen(true)}
              >
                Menstruation hat begonnen
              </button>
            ) : (
              <>
                <label className="form-label">
                  Wann hat deine Menstruation begonnen?
                  <input
                    type="date"
                    className="form-input"
                    value={neuerZyklusStart}
                    max={datumAlsString(new Date())}
                    onChange={(e) => setNeuerZyklusStart(e.target.value)}
                  />
                </label>
                <div className="btn-gruppe">
                  <button className="btn-primary" onClick={neuerZyklusStarten}>
                    Neuen Zyklus starten
                  </button>
                  <button
                    className="btn-text"
                    onClick={() => setNeuerZyklusOffen(false)}
                  >
                    Abbrechen
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Zyklushistorie */}
      {historie.length > 0 && (
        <div
          className={`settings-card klappbar ${offeneSektionen.has('historie') ? 'klappbar-offen' : ''}`}
          style={{ '--karten-farbe': 'var(--color-gold)' }}
        >
          <button className="settings-card-header klappbar-kopf" onClick={() => toggleSektion('historie')}>
            <span>Letzte Zyklen</span>
            <span className="klappbar-pfeil">›</span>
          </button>
          {offeneSektionen.has('historie') && (
            <div className="klappbar-inhalt">
              <div className="historie-liste">
                {[...historie].reverse().map((eintrag, i, reversed) => {
                  // Für abgeschlossene Zyklen: tatsächliche Dauer aus Startdaten berechnen
                  // reversed[0] = neuester (aktueller) Zyklus, reversed[1] = vorletzter, etc.
                  const istAktuell = i === 0
                  let anzeigeLaenge = eintrag.zyklusLaenge
                  if (!istAktuell && i < reversed.length) {
                    // Nächster Zyklus in chronologischer Reihenfolge = reversed[i-1]
                    const naechster = reversed[i - 1]
                    if (naechster && naechster.startdatum && eintrag.startdatum) {
                      const diff = Math.round(
                        (naechster.startdatum.getTime() - eintrag.startdatum.getTime()) / (1000 * 60 * 60 * 24)
                      )
                      if (diff > 0) anzeigeLaenge = diff
                    }
                  }
                  return (
                    <div className="historie-eintrag" key={i}>
                      <span className="historie-datum">
                        {eintrag.startdatum.toLocaleDateString('de-DE', {
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric',
                        })}
                      </span>
                      <span className="historie-details">
                        {istAktuell ? `~${anzeigeLaenge}` : anzeigeLaenge} Tage · {eintrag.zyklusTyp === 'weissmond' ? 'Weißmond' : 'Rotmond'}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Cloud-Sicherung + Abmelden/Löschen */}
      <CloudBanner />

    </div>
  )
}

// ===========================================================================
// Phasenbalken-Visualisierung
// ===========================================================================

function PhasenBalken({ zyklusLaenge, angepassteGrenzen, grenzenZurueckgesetzt, onZuruecksetzen }) {
  const [infoOffen, setInfoOffen] = useState(false)
  const [sektionOffen, setSektionOffen] = useState(false)
  const [archetypTooltip, setArchetypTooltip] = useState(null) // phase key or null
  const infoRef = useRef(null)

  useEffect(() => {
    function handleClickAussen(e) {
      if (infoRef.current && !infoRef.current.contains(e.target)) {
        setInfoOffen(false)
      }
    }
    if (infoOffen) {
      document.addEventListener('mousedown', handleClickAussen)
      return () => document.removeEventListener('mousedown', handleClickAussen)
    }
  }, [infoOffen])

  const standardGrenzen = berechnePhasenGrenzen(zyklusLaenge)
  const grenzen = angepassteGrenzen && angepassteGrenzen.length === 4
    ? angepassteGrenzen
    : standardGrenzen

  const istPersonalisiert = angepassteGrenzen && angepassteGrenzen.length === 4

  return (
    <div
      className={`settings-card klappbar ${sektionOffen ? 'klappbar-offen' : ''}`}
      style={{ '--karten-farbe': 'var(--color-gold)' }}
    >
      <button className="settings-card-header klappbar-kopf" onClick={() => setSektionOffen(!sektionOffen)}>
        <span>Deine Phasenaufteilung</span>
        <span className="klappbar-pfeil">›</span>
      </button>
      {sektionOffen && (
      <div className="klappbar-inhalt">

      <div className="phasenbalken-hinweis-zeile" ref={infoRef}>
        {istPersonalisiert && (
          <p className="phasenbalken-hinweis">
            Personalisiert – basierend auf deinen Korrekturen angepasst.
          </p>
        )}
        {!istPersonalisiert && (
          <p className="phasenbalken-hinweis">
            Standard-Aufteilung für {zyklusLaenge} Tage.
          </p>
        )}
        <button
          className="info-btn"
          onClick={() => setInfoOffen((v) => !v)}
          aria-label="Info zur Phasenaufteilung"
        >
          ⓘ
        </button>
        {infoOffen && (
          <div className="tooltip">
            {istPersonalisiert
              ? 'Wurde automatisch an deine persönliche Aufteilung angepasst, da du mindestens 3 mal auf der „Heute"-Seite unter „Phase anpassen" ähnliche Anpassungen vorgenommen hast.'
              : 'Passt sich automatisch an deine persönliche Aufteilung an, wenn du mindestens 3 mal auf der „Heute"-Seite unter „Phase anpassen" ähnliche Anpassungen vorgenommen hast.'}
          </div>
        )}
      </div>

      {/* Phasenkreis mit externen Labels */}
      <div className="phasenkreis-container">
        <svg className="phasenkreis" viewBox="0 0 300 260">
          {/* Hintergrundring */}
          <circle
            cx="150"
            cy="120"
            r="55"
            fill="none"
            stroke="var(--color-border)"
            strokeWidth="23"
          />
          {/* Phasen-Segmente + externe Labels */}
          {(() => {
            const cx = 150, cy = 120
            const radius = 55
            const umfang = 2 * Math.PI * radius
            const labelRadius = 90
            let winkelOffset = 0
            const elemente = []

            grenzen.forEach((g) => {
              const prozent = g.laenge / zyklusLaenge
              const segmentLaenge = prozent * umfang
              const segmentWinkel = prozent * 2 * Math.PI
              const currentOffset = -winkelOffset
              const meta = PHASEN_INFO[g.phase]

              // Segment-Rand (kräftige Archetyp-Farbe)
              elemente.push(
                <circle
                  key={`border-${g.phase}`}
                  cx={cx}
                  cy={cy}
                  r={radius}
                  fill="none"
                  stroke={meta.farbeHex}
                  strokeWidth="24"
                  strokeDasharray={`${segmentLaenge} ${umfang - segmentLaenge}`}
                  strokeDashoffset={currentOffset}
                  transform={`rotate(-90 ${cx} ${cy})`}
                />
              )
              // Segment-Füllung (pastell)
              elemente.push(
                <circle
                  key={g.phase}
                  cx={cx}
                  cy={cy}
                  r={radius}
                  fill="none"
                  stroke={meta.farbeBgHex}
                  strokeWidth="20"
                  strokeDasharray={`${segmentLaenge} ${umfang - segmentLaenge}`}
                  strokeDashoffset={currentOffset}
                  transform={`rotate(-90 ${cx} ${cy})`}
                />
              )

              // Label am Mittelpunkt des Segments
              const mittelpunktWinkel = winkelOffset / umfang * 2 * Math.PI + segmentWinkel / 2
              const lx = cx + labelRadius * Math.sin(mittelpunktWinkel)
              const ly = cy - labelRadius * Math.cos(mittelpunktWinkel)
              const sinVal = Math.sin(mittelpunktWinkel)
              const textAnchor = sinVal > 0.15 ? 'start' : sinVal < -0.15 ? 'end' : 'middle'

              elemente.push(
                <g
                  key={`label-${g.phase}`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setArchetypTooltip(archetypTooltip === g.phase ? null : g.phase)}
                >
                  <text
                    x={lx}
                    y={ly}
                    textAnchor={textAnchor}
                    dominantBaseline="central"
                    className="phasenkreis-ext-name"
                    fill={meta.farbeHex}
                  >
                    {meta.symbol} {meta.kurzname}
                  </text>
                  <text
                    x={lx}
                    y={ly + 13}
                    textAnchor={textAnchor}
                    dominantBaseline="central"
                    className="phasenkreis-ext-tage"
                  >
                    Tag {g.start}–{g.ende} ({g.laenge} T)
                  </text>
                </g>
              )

              winkelOffset += segmentLaenge
            })

            // Trennlinien zwischen Segmenten (je 2 pro Grenze: Farbe beider Nachbarn)
            const innerR = radius - 10
            const outerR = radius + 10
            const trennAbstand = 0.012 // Winkel-Offset in Radiant (~0.7°)
            let trennOffset = 0
            grenzen.forEach((g, i) => {
              const winkel = (trennOffset / umfang) * 2 * Math.PI - Math.PI / 2
              const vorher = grenzen[(i - 1 + grenzen.length) % grenzen.length]
              const metaVorher = PHASEN_INFO[vorher.phase]
              const metaNachher = PHASEN_INFO[g.phase]

              // Linie links (Farbe des vorherigen Segments)
              const w1 = winkel - trennAbstand
              elemente.push(
                <line
                  key={`trenn-l-${g.phase}`}
                  x1={cx + innerR * Math.cos(w1)} y1={cy + innerR * Math.sin(w1)}
                  x2={cx + outerR * Math.cos(w1)} y2={cy + outerR * Math.sin(w1)}
                  stroke={metaVorher.farbeHex}
                  strokeWidth="1.5"
                />
              )
              // Weiße Trennlinie in der Mitte
              elemente.push(
                <line
                  key={`trenn-w-${g.phase}`}
                  x1={cx + innerR * Math.cos(winkel)} y1={cy + innerR * Math.sin(winkel)}
                  x2={cx + outerR * Math.cos(winkel)} y2={cy + outerR * Math.sin(winkel)}
                  stroke="#FFFFFF"
                  strokeWidth="1"
                />
              )
              // Linie rechts (Farbe des nächsten Segments)
              const w2 = winkel + trennAbstand
              elemente.push(
                <line
                  key={`trenn-r-${g.phase}`}
                  x1={cx + innerR * Math.cos(w2)} y1={cy + innerR * Math.sin(w2)}
                  x2={cx + outerR * Math.cos(w2)} y2={cy + outerR * Math.sin(w2)}
                  stroke={metaNachher.farbeHex}
                  strokeWidth="1.5"
                />
              )
              trennOffset += (g.laenge / zyklusLaenge) * umfang
            })

            return elemente
          })()}
          {/* Zentrierte Zahl */}
          <text x="150" y="113" textAnchor="middle" dominantBaseline="central" className="phasenkreis-zahl">
            {zyklusLaenge}
          </text>
          <text x="150" y="136" textAnchor="middle" dominantBaseline="central" className="phasenkreis-label">
            Tage
          </text>
        </svg>
      </div>

      {/* Archetyp-Info-Tooltip */}
      {archetypTooltip && PHASEN_INFO[archetypTooltip] && (
        <div
          className="archetyp-info-tooltip"
          style={{ '--phasen-farbe': PHASEN_INFO[archetypTooltip].farbeHex }}
        >
          <div className="archetyp-info-tooltip-kopf">
            <span className="archetyp-info-tooltip-name">
              {PHASEN_INFO[archetypTooltip].symbol} {PHASEN_INFO[archetypTooltip].kurzname}
            </span>
            <button
              className="archetyp-info-tooltip-close"
              onClick={() => setArchetypTooltip(null)}
            >
              ✕
            </button>
          </div>
          <p>{PHASEN_INFO[archetypTooltip].kurzbeschreibung}</p>
          <p className="archetyp-info-tooltip-energie">
            {PHASEN_INFO[archetypTooltip].kernenergie}
          </p>
        </div>
      )}

      {/* Reset-Button */}
      {istPersonalisiert && (
        <button className="btn-text phasenbalken-reset" onClick={onZuruecksetzen}>
          {grenzenZurueckgesetzt ? '✓ Zurückgesetzt' : 'Phasenaufteilung zurücksetzen'}
        </button>
      )}
      </div>
      )}
    </div>
  )
}

export default Einstellungen
