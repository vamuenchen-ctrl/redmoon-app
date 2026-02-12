import { useState, useEffect, useRef } from 'react'
import {
  ladeZyklusdaten,
  ladeKorrekturen,
  ladeHeutigeTageskarte,
  speichereTageskarte,
  ladeAngepassteGrenzen,
} from '../utils/speicher'
import { useSyncEngine } from '../context/SyncEngineContext'
import { berechneAngepasstePhase, PHASEN_INFO, PHASEN_KASUS } from '../utils/zyklus'
import orakelkarten from '../data/orakelkarten.json'

// ---------------------------------------------------------------------------
// Archetyp → Farbe & Anzeigename
// ---------------------------------------------------------------------------

const ARCHETYP_META = {
  zentral: { farbe: '#C94963', name: 'Zyklische Göttin', emoji: '🌀' },
  jungeFrau: { farbe: PHASEN_INFO.jungeFrau.farbeHex, name: 'Junge Frau', emoji: '🦋' },
  mutter: { farbe: PHASEN_INFO.mutter.farbeHex, name: 'Mutter', emoji: '🕊️' },
  zauberin: { farbe: PHASEN_INFO.zauberin.farbeHex, name: 'Zauberin', emoji: '🦉' },
  alteWeise: { farbe: PHASEN_INFO.alteWeise.farbeHex, name: 'Alte Weise', emoji: '🐇' },
}

// ===========================================================================
// Hauptkomponente
// ===========================================================================

function Orakel() {
  const { syncVersion } = useSyncEngine()
  const [gezogeneKarte, setGezogeneKarte] = useState(null) // Kartenobjekt
  const [bereitsGezogen, setBereitsGezogen] = useState(false)
  const [flipAktiv, setFlipAktiv] = useState(false)
  const [karteZeigen, setKarteZeigen] = useState(false)
  const [karteKlein, setKarteKlein] = useState(false)
  // Phasenkontext
  const [aktuellePhase, setAktuellePhase] = useState(null)
  const detailsRef = useRef(null)

  useEffect(() => {
    // Prüfe ob heute schon eine Karte gezogen wurde
    const heutige = ladeHeutigeTageskarte()
    console.log(`[Orakel] syncVersion=${syncVersion}, heutigeTageskarte=`, heutige)
    if (heutige) {
      const karte = orakelkarten.find((k) => k.id === heutige.kartenId)
      console.log(`[Orakel] Karte gefunden: ${karte?.id || 'NICHT GEFUNDEN'} (kartenId=${heutige.kartenId})`)
      setGezogeneKarte(karte || null)
      setBereitsGezogen(true)
      setFlipAktiv(true)
      setKarteZeigen(true)
      setKarteKlein(true)
    }

    // Aktuelle Phase laden für Kontextbezug
    const daten = ladeZyklusdaten()
    if (daten.ersteinrichtungAbgeschlossen && daten.zyklusStart) {
      const korrekturen = ladeKorrekturen()
      const gespeicherteGrenzen = ladeAngepassteGrenzen()
      const phase = berechneAngepasstePhase(
        daten.zyklusStart,
        daten.zyklusLaenge,
        new Date(),
        korrekturen,
        gespeicherteGrenzen,
      )
      setAktuellePhase(phase.phase)
    }
  }, [syncVersion])

  function karteZiehen() {
    if (bereitsGezogen) return

    try {
      // Zufällige Karte wählen
      const zufallsIndex = Math.floor(Math.random() * orakelkarten.length)
      const karte = orakelkarten[zufallsIndex]

      // Speichern
      speichereTageskarte(new Date(), karte.id)

      setGezogeneKarte(karte)
      setBereitsGezogen(true)

      // Flip-Animation starten
      setFlipAktiv(true)
      setTimeout(() => {
        setKarteZeigen(true)
      }, 400) // Hälfte der Flip-Dauer: Karte wechselt bei 180°
      setTimeout(() => {
        setKarteKlein(true)
        // Nach Shrink-Animation zu Details scrollen (mobile)
        setTimeout(() => {
          detailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        }, 550)
      }, 1200) // Nach Flip: Karte verkleinern
    } catch (err) {
      console.error('Fehler beim Kartenziehen:', err)
    }
  }

  // Kontextbezug zur aktuellen Phase
  function erzeugePhasenKontext(karte) {
    if (!aktuellePhase || !karte) return null

    const phasenGenitiv = PHASEN_KASUS[aktuellePhase]?.genitiv || PHASEN_INFO[aktuellePhase].kurzname

    if (karte.archetyp === 'zentral') {
      return `Du bist gerade in der Phase ${phasenGenitiv}. Diese Karte erinnert dich daran, dass alle vier Archetypen in dir leben.`
    }

    if (karte.archetyp === aktuellePhase) {
      return `Du bist gerade in der Phase ${phasenGenitiv}. Diese Karte verstärkt die Energie deiner aktuellen Phase.`
    }

    const kartenGenitiv = PHASEN_KASUS[karte.archetyp]?.genitiv
    const kartenArchetypName = kartenGenitiv || ARCHETYP_META[karte.archetyp]?.name || karte.archetyp
    return `Du bist gerade in der Phase ${phasenGenitiv}. Diese Karte bringt die Energie ${kartenArchetypName} in deine aktuelle Phase.`
  }

  return (
    <div className="page orakel-page">
      <h1>Orakel</h1>
      <p className="page-subtitle">
        {bereitsGezogen ? 'Deine Tageskarte für heute' : 'Ziehe deine Tageskarte'}
      </p>

      {/* Kartenstapel / Gezogene Karte */}
      <div className={`orakel-karten-bereich ${karteKlein ? 'karten-bereich-klein' : ''}`}>
        {!bereitsGezogen ? (
          /* Zustand 1: Kartenstapel */
          <button className="karten-stapel" onClick={karteZiehen}>
            <div className="karten-rueckseite">
              <div className="karten-rueckseite-rahmen">
                <div className="karten-rueckseite-mond">🌙</div>
                <div className="karten-rueckseite-titel">Roter Mond</div>
                <div className="karten-rueckseite-sub">Ziehe eine Karte</div>
              </div>
            </div>
            {/* Schatten-Karten für Stapel-Effekt */}
            <div className="karten-schatten karten-schatten-1" />
            <div className="karten-schatten karten-schatten-2" />
          </button>
        ) : (
          /* Zustand 2: Gezogene Karte (mit/ohne Flip) */
          <div className={`karten-flip-container ${flipAktiv ? 'karten-flip-aktiv' : ''}`}>
            <div className="karten-flip-inner">
              {/* Rückseite */}
              <div className="karten-flip-front">
                <div className="karten-rueckseite">
                  <div className="karten-rueckseite-rahmen">
                    <div className="karten-rueckseite-mond">🌙</div>
                    <div className="karten-rueckseite-titel">Roter Mond</div>
                  </div>
                </div>
              </div>
              {/* Vorderseite */}
              <div className="karten-flip-back">
                {gezogeneKarte && (
                  <KartenVorderseite karte={gezogeneKarte} />
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Kartendetails (unterhalb, wenn sichtbar) */}
      {karteZeigen && gezogeneKarte && (
        <div ref={detailsRef}>
          <KartenDetails
            karte={gezogeneKarte}
            phasenKontext={erzeugePhasenKontext(gezogeneKarte)}
          />
        </div>
      )}
    </div>
  )
}

// ===========================================================================
// Karten-Vorderseite (in der Flip-Animation)
// ===========================================================================

function KartenVorderseite({ karte }) {
  const meta = ARCHETYP_META[karte.archetyp] || ARCHETYP_META.zentral

  return (
    <div className="karten-vorderseite" style={{ '--phasen-farbe': meta.farbe }}>
      <div className="karten-vorderseite-bild">
        <span className="karten-vorderseite-emoji">{karte.emoji || meta.emoji}</span>
      </div>
      <div className="karten-vorderseite-inhalt">
        <div className="karten-vorderseite-nummer">
          {karte.nummer}
        </div>
        <div className="karten-vorderseite-titel">{karte.titel}</div>
      </div>
    </div>
  )
}

// ===========================================================================
// Kartendetails (unterhalb der Karte)
// ===========================================================================

function KartenDetails({ karte, phasenKontext }) {
  const meta = ARCHETYP_META[karte.archetyp] || ARCHETYP_META.zentral

  return (
    <div className="karten-details" style={{ '--phasen-farbe': meta.farbe }}>
      {/* Archetyp-Zugehörigkeit */}
      <div className="karten-archetyp">
        {karte.archetyp === 'zentral'
          ? 'Zentrale Karte'
          : `Karte ${PHASEN_KASUS[karte.archetyp]?.genitiv || `der ${meta.name}`}`}
      </div>

      {/* Titel */}
      <h2 className="karten-titel">{karte.titel}</h2>

      {/* Botschaft */}
      <blockquote className="karten-botschaft">
        {karte.botschaft}
      </blockquote>

      {/* Bedeutung */}
      <p className="karten-bedeutung">{karte.bedeutung}</p>

      {/* Phasenkontext */}
      {phasenKontext && (
        <div className="karten-kontext">
          {phasenKontext}
        </div>
      )}
    </div>
  )
}

export default Orakel
