import { HEALTHY_FADE_MARGIN_DB, MAX_EXTRA_HEIGHT_M } from '../core/analysis';
import { formatAvailability } from '../core/rf';
import type { LinkAnalysis, Reason, Verdict } from '../core/types';
import { useI18n } from '../i18n';
import type { Dict } from '../i18n/en';

const ICON: Record<Verdict, string> = { good: '✓', marginal: '!', blocked: '✕' };

export function reasonText(t: Dict, r: Reason): string {
  const fix = (x: { extraM: number; reachable: boolean }) =>
    x.reachable ? t.reason.fixRaise(x.extraM) : t.reason.fixImpossible(MAX_EXTRA_HEIGHT_M);
  switch (r.kind) {
    case 'good':
      return t.reason.good;
    case 'blocked':
      return t.reason.blocked(r.worstKm.toFixed(1), fix(r));
    case 'lowSignal':
      return t.reason.lowSignal;
    case 'fresnel':
      return t.reason.fresnel(r.worstKm.toFixed(1), fix(r));
    case 'lowMargin':
      return t.reason.lowMargin(r.fadeDb.toFixed(0), HEALTHY_FADE_MARGIN_DB);
  }
}

interface ResultPanelProps {
  analysis: LinkAnalysis;
  onApplyHeight: (extra: number) => void;
}

export function ResultPanel({ analysis: r, onApplyHeight }: ResultPanelProps) {
  const { t } = useI18n();
  const clearPct = Math.max(-100, Math.min(999, r.minClearanceRatio * 100));
  const metrics: { label: string; value: string; tone?: 'ok' | 'warn' | 'bad'; hint: string }[] = [
    { label: t.result.distance, value: `${r.distanceKm.toFixed(2)} km`, hint: t.result.distanceHint },
    {
      label: t.result.fade,
      value: `${r.fadeMarginDb.toFixed(1)} dB`,
      tone: r.fadeMarginDb >= 15 ? 'ok' : r.fadeMarginDb > 0 ? 'warn' : 'bad',
      hint: t.result.fadeHint,
    },
    { label: t.result.rx, value: `${r.rxLevelDbm.toFixed(1)} dBm`, hint: t.result.rxHint },
    {
      label: t.result.fresnel,
      value: `${clearPct.toFixed(0)} %`,
      tone: clearPct >= 60 ? 'ok' : clearPct >= 0 ? 'warn' : 'bad',
      hint: t.result.fresnelHint,
    },
    { label: t.result.fspl, value: `${r.fsplDb.toFixed(1)} dB`, hint: t.result.fsplHint },
    {
      label: t.result.availability,
      value: formatAvailability(r.availabilityPct),
      tone: r.availabilityPct >= 99.9 ? 'ok' : r.availabilityPct >= 99 ? 'warn' : 'bad',
      hint: t.result.availabilityHint,
    },
  ];

  return (
    <section className={`card verdict verdict-${r.verdict}`} aria-live="polite" aria-labelledby="verdict-title">
      <div className="verdict-head">
        <span className="verdict-icon" aria-hidden="true">
          {ICON[r.verdict]}
        </span>
        <div>
          <h2 id="verdict-title">{t.result[r.verdict]}</h2>
          <p>{reasonText(t, r.reason)}</p>
        </div>
      </div>

      {r.extraHeightNeededM > 0 && r.extraHeightReachable && (
        <button type="button" className="btn btn-primary btn-block" onClick={() => onApplyHeight(r.extraHeightNeededM)}>
          {t.result.raise(r.extraHeightNeededM)}
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

      {r.diffractionDb > 0.5 && <p className="note">{t.result.diffraction(r.diffractionDb.toFixed(1), r.worstAtKm.toFixed(1))}</p>}
    </section>
  );
}
