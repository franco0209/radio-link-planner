import { formatAvailability } from '../core/rf';
import type { LinkAnalysis, Verdict } from '../core/types';

const LABEL: Record<Verdict, string> = {
  good: 'Viable link',
  marginal: 'Marginal link',
  blocked: 'Link will not work',
};
const ICON: Record<Verdict, string> = { good: '✓', marginal: '!', blocked: '✕' };

interface ResultPanelProps {
  analysis: LinkAnalysis;
  onApplyHeight: (extra: number) => void;
}

export function ResultPanel({ analysis: r, onApplyHeight }: ResultPanelProps) {
  const clearPct = Math.max(-100, Math.min(999, r.minClearanceRatio * 100));
  const metrics: { label: string; value: string; tone?: 'ok' | 'warn' | 'bad'; hint: string }[] = [
    { label: 'Distance', value: `${r.distanceKm.toFixed(2)} km`, hint: 'Great-circle distance between sites' },
    {
      label: 'Fade margin',
      value: `${r.fadeMarginDb.toFixed(1)} dB`,
      tone: r.fadeMarginDb >= 15 ? 'ok' : r.fadeMarginDb > 0 ? 'warn' : 'bad',
      hint: 'Signal above receiver sensitivity. 15 dB or more is healthy',
    },
    { label: 'Received signal', value: `${r.rxLevelDbm.toFixed(1)} dBm`, hint: 'Expected level at the receiver' },
    {
      label: 'Fresnel clearance',
      value: `${clearPct.toFixed(0)} %`,
      tone: clearPct >= 60 ? 'ok' : clearPct >= 0 ? 'warn' : 'bad',
      hint: 'Worst point on the path. 60 % or more is the target',
    },
    { label: 'Free-space loss', value: `${r.fsplDb.toFixed(1)} dB`, hint: 'Loss from distance alone' },
    {
      label: 'Availability',
      value: formatAvailability(r.availabilityPct),
      tone: r.availabilityPct >= 99.9 ? 'ok' : r.availabilityPct >= 99 ? 'warn' : 'bad',
      hint: 'Estimated yearly uptime from multipath fading',
    },
  ];

  return (
    <section className={`card verdict verdict-${r.verdict}`} aria-live="polite" aria-labelledby="verdict-title">
      <div className="verdict-head">
        <span className="verdict-icon" aria-hidden="true">
          {ICON[r.verdict]}
        </span>
        <div>
          <h2 id="verdict-title">{LABEL[r.verdict]}</h2>
          <p>{r.headline}</p>
        </div>
      </div>

      {r.extraHeightNeededM > 0 && r.extraHeightReachable && (
        <button type="button" className="btn btn-primary btn-block" onClick={() => onApplyHeight(r.extraHeightNeededM)}>
          Raise both masts by {r.extraHeightNeededM} m
        </button>
      )}

      <dl className="metrics">
        {metrics.map((m) => (
          <div key={m.label} className={`metric ${m.tone ? `tone-${m.tone}` : ''}`} title={m.hint}>
            <dt>{m.label}</dt>
            <dd>{m.value}</dd>
          </div>
        ))}
      </dl>

      {r.diffractionDb > 0.5 && (
        <p className="note">
          Obstruction adds about <strong>{r.diffractionDb.toFixed(1)} dB</strong> of diffraction loss near{' '}
          {r.worstAtKm.toFixed(1)} km.
        </p>
      )}
    </section>
  );
}
