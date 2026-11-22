import { useState } from 'react';
import type { LinkParams } from '../core/types';
import { useI18n } from '../i18n';
import { Field } from './Field';

const BANDS: { label: string; mhz: number }[] = [
  { label: '900 MHz', mhz: 915 },
  { label: '2.4 GHz', mhz: 2437 },
  { label: '5.8 GHz', mhz: 5800 },
  { label: '11 GHz', mhz: 11000 },
  { label: '24 GHz', mhz: 24125 },
];

/** Keys into the band-notes dictionary, keyed by the band's centre frequency. */
const BAND_NOTE_KEY: Record<number, string> = { 915: '900', 2437: '2400', 5800: '5800', 11000: '11000', 24125: '24000' };

/** Typical, editable starting points. Check your radio's datasheet for exact figures. */
const PRESETS: { id: string; patch: Partial<LinkParams> }[] = [
  { id: 'cpe5', patch: { freqMHz: 5800, txPowerDbm: 20, gainADbi: 16, gainBDbi: 16, rxSensitivityDbm: -80 } },
  { id: 'dish5', patch: { freqMHz: 5800, txPowerDbm: 23, gainADbi: 25, gainBDbi: 25, rxSensitivityDbm: -85 } },
  { id: 'grid24', patch: { freqMHz: 2437, txPowerDbm: 20, gainADbi: 24, gainBDbi: 24, rxSensitivityDbm: -85 } },
];

interface RadioFormProps {
  params: LinkParams;
  onChange: (patch: Partial<LinkParams>) => void;
}

export function RadioForm({ params, onChange }: RadioFormProps) {
  const { t } = useI18n();
  const r = t.radio;
  const [advanced, setAdvanced] = useState(false);
  const band = BANDS.find((b) => b.mhz === params.freqMHz);

  return (
    <>
      <section className="card" aria-labelledby="radio-title">
        <h2 id="radio-title" className="card-title">
          {r.title}
        </h2>

        <div className="field">
          <span className="label" id="band-label">
            {r.bandLabel}
          </span>
          <div className="chips" role="group" aria-labelledby="band-label">
            {BANDS.map((b) => (
              <button key={b.label} type="button" className="chip" aria-pressed={b.mhz === params.freqMHz} onClick={() => onChange({ freqMHz: b.mhz })}>
                {b.label}
              </button>
            ))}
          </div>
          <p className="hint">{band ? r.bandNotes[BAND_NOTE_KEY[band.mhz]] : r.bandCustom}</p>
        </div>

        <div className="grid-2">
          <Field label={r.frequency} unit="MHz" value={params.freqMHz} min={30} max={100000} onChange={(v) => onChange({ freqMHz: v })} />
          <Field label={r.txPower} unit="dBm" value={params.txPowerDbm} min={-20} max={60} onChange={(v) => onChange({ txPowerDbm: v })} />
          <Field label={r.gainA} unit="dBi" value={params.gainADbi} min={0} max={60} onChange={(v) => onChange({ gainADbi: v })} />
          <Field label={r.gainB} unit="dBi" value={params.gainBDbi} min={0} max={60} onChange={(v) => onChange({ gainBDbi: v })} />
        </div>

        <div className="field">
          <label htmlFor="preset">{r.presetLabel}</label>
          <select
            id="preset"
            value=""
            onChange={(e) => {
              const p = PRESETS.find((x) => x.id === e.target.value);
              if (p) onChange(p.patch);
            }}
          >
            <option value="">{r.presetChoose}</option>
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {r.presets[p.id]}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="card" aria-labelledby="mast-title">
        <h2 id="mast-title" className="card-title">
          {r.heightsTitle}
        </h2>
        <div className="grid-2">
          <Field label={r.mastA} unit="m" value={params.heightAM} min={0} max={300} hint={r.aboveGround} onChange={(v) => onChange({ heightAM: v })} />
          <Field label={r.mastB} unit="m" value={params.heightBM} min={0} max={300} hint={r.aboveGround} onChange={(v) => onChange({ heightBM: v })} />
        </div>
      </section>

      <section className="card" aria-labelledby="adv-title">
        <h2 id="adv-title" className="card-title">
          <button type="button" className="disclosure" aria-expanded={advanced} aria-controls="adv-body" onClick={() => setAdvanced((v) => !v)}>
            {r.advanced}
            <span aria-hidden="true">{advanced ? '−' : '+'}</span>
          </button>
        </h2>
        {advanced && (
          <div id="adv-body" className="grid-2">
            <Field label={r.sensitivity} unit="dBm" value={params.rxSensitivityDbm} min={-130} max={0} hint={r.sensitivityHint} onChange={(v) => onChange({ rxSensitivityDbm: v })} />
            <Field label={r.extraLosses} unit="dB" value={params.marginDb} min={0} max={60} hint={r.extraLossesHint} onChange={(v) => onChange({ marginDb: v })} />
            <Field label={r.cableA} unit="dB" value={params.cableLossADb} min={0} max={30} onChange={(v) => onChange({ cableLossADb: v })} />
            <Field label={r.cableB} unit="dB" value={params.cableLossBDb} min={0} max={30} onChange={(v) => onChange({ cableLossBDb: v })} />
            <Field label={r.kFactor} value={params.kFactor} min={0.5} max={5} hint={r.kHint} onChange={(v) => onChange({ kFactor: v })} />
            <div className="field">
              <label htmlFor="terrain">{r.terrainType}</label>
              <select id="terrain" value={params.terrainFactor} onChange={(e) => onChange({ terrainFactor: Number(e.target.value) })}>
                <option value={4}>{r.terrainSmooth}</option>
                <option value={1}>{r.terrainAverage}</option>
                <option value={0.25}>{r.terrainRough}</option>
              </select>
              <p className="hint">{r.terrainHint}</p>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
