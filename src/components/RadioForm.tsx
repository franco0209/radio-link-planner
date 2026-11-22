import { useState } from 'react';
import type { LinkParams } from '../core/types';
import { Field } from './Field';

interface Band {
  label: string;
  mhz: number;
  note: string;
}

const BANDS: Band[] = [
  { label: '900 MHz', mhz: 915, note: 'Long range, good through trees' },
  { label: '2.4 GHz', mhz: 2437, note: 'Crowded, handles some foliage' },
  { label: '5.8 GHz', mhz: 5800, note: 'Most common for backhaul' },
  { label: '11 GHz', mhz: 11000, note: 'Licensed, high capacity' },
  { label: '24 GHz', mhz: 24125, note: 'Short, very high capacity' },
];

interface Preset {
  label: string;
  patch: Partial<LinkParams>;
}

/** Typical, editable starting points. Check your radio's datasheet for exact figures. */
const PRESETS: Preset[] = [
  { label: '5 GHz CPE (typical)', patch: { freqMHz: 5800, txPowerDbm: 20, gainADbi: 16, gainBDbi: 16, rxSensitivityDbm: -80 } },
  { label: '5 GHz dish (typical)', patch: { freqMHz: 5800, txPowerDbm: 23, gainADbi: 25, gainBDbi: 25, rxSensitivityDbm: -85 } },
  { label: '2.4 GHz grid (typical)', patch: { freqMHz: 2437, txPowerDbm: 20, gainADbi: 24, gainBDbi: 24, rxSensitivityDbm: -85 } },
];

interface RadioFormProps {
  params: LinkParams;
  onChange: (patch: Partial<LinkParams>) => void;
}

export function RadioForm({ params, onChange }: RadioFormProps) {
  const [advanced, setAdvanced] = useState(false);
  const band = BANDS.find((b) => b.mhz === params.freqMHz);

  return (
    <>
      <section className="card" aria-labelledby="radio-title">
        <h2 id="radio-title" className="card-title">
          Radio
        </h2>

        <div className="field">
          <span className="label" id="band-label">
            Frequency band
          </span>
          <div className="chips" role="group" aria-labelledby="band-label">
            {BANDS.map((b) => (
              <button
                key={b.label}
                type="button"
                className="chip"
                aria-pressed={b.mhz === params.freqMHz}
                onClick={() => onChange({ freqMHz: b.mhz })}
              >
                {b.label}
              </button>
            ))}
          </div>
          <p className="hint">{band ? band.note : 'Custom frequency'}</p>
        </div>

        <div className="grid-2">
          <Field label="Frequency" unit="MHz" value={params.freqMHz} min={30} max={100000} onChange={(v) => onChange({ freqMHz: v })} />
          <Field label="TX power" unit="dBm" value={params.txPowerDbm} min={-20} max={60} onChange={(v) => onChange({ txPowerDbm: v })} />
          <Field label="Antenna gain A" unit="dBi" value={params.gainADbi} min={0} max={60} onChange={(v) => onChange({ gainADbi: v })} />
          <Field label="Antenna gain B" unit="dBi" value={params.gainBDbi} min={0} max={60} onChange={(v) => onChange({ gainBDbi: v })} />
        </div>

        <div className="field">
          <label htmlFor="preset">Start from a typical setup</label>
          <select
            id="preset"
            value=""
            onChange={(e) => {
              const p = PRESETS.find((x) => x.label === e.target.value);
              if (p) onChange(p.patch);
            }}
          >
            <option value="">Choose…</option>
            {PRESETS.map((p) => (
              <option key={p.label}>{p.label}</option>
            ))}
          </select>
        </div>
      </section>

      <section className="card" aria-labelledby="mast-title">
        <h2 id="mast-title" className="card-title">
          Antenna heights
        </h2>
        <div className="grid-2">
          <Field label="Mast A" unit="m" value={params.heightAM} min={0} max={300} hint="Above ground" onChange={(v) => onChange({ heightAM: v })} />
          <Field label="Mast B" unit="m" value={params.heightBM} min={0} max={300} hint="Above ground" onChange={(v) => onChange({ heightBM: v })} />
        </div>
      </section>

      <section className="card" aria-labelledby="adv-title">
        <h2 id="adv-title" className="card-title">
          <button
            type="button"
            className="disclosure"
            aria-expanded={advanced}
            aria-controls="adv-body"
            onClick={() => setAdvanced((v) => !v)}
          >
            Advanced
            <span aria-hidden="true">{advanced ? '−' : '+'}</span>
          </button>
        </h2>
        {advanced && (
          <div id="adv-body" className="grid-2">
            <Field label="Receiver sensitivity" unit="dBm" value={params.rxSensitivityDbm} min={-130} max={0} hint="At your target data rate" onChange={(v) => onChange({ rxSensitivityDbm: v })} />
            <Field label="Extra losses" unit="dB" value={params.marginDb} min={0} max={60} hint="Rain, foliage, mismatch" onChange={(v) => onChange({ marginDb: v })} />
            <Field label="Cable loss A" unit="dB" value={params.cableLossADb} min={0} max={30} onChange={(v) => onChange({ cableLossADb: v })} />
            <Field label="Cable loss B" unit="dB" value={params.cableLossBDb} min={0} max={30} onChange={(v) => onChange({ cableLossBDb: v })} />
            <Field label="K factor" value={params.kFactor} min={0.5} max={5} hint="4/3 ≈ 1.33 is standard air" onChange={(v) => onChange({ kFactor: v })} />
            <div className="field">
              <label htmlFor="terrain">Terrain type</label>
              <select id="terrain" value={params.terrainFactor} onChange={(e) => onChange({ terrainFactor: Number(e.target.value) })}>
                <option value={4}>Smooth / over water</option>
                <option value={1}>Average</option>
                <option value={0.25}>Mountainous / dry</option>
              </select>
              <p className="hint">Used for the availability estimate</p>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
