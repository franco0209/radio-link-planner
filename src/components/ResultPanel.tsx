import { HEALTHY_FADE_MARGIN_DB, MAX_EXTRA_HEIGHT_M } from '../core/analysis';
import { formatAvailability } from '../core/rf';
import type { Reason, RouteAnalysis, Verdict } from '../core/types';
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

interface Metric {
  label: string;
  value: string;
  tone?: 'ok' | 'warn' | 'bad';
  hint: string;
}

interface ResultPanelProps {
  route: RouteAnalysis;
  /** Node names in route order: A, R1, R2, B. */
  names: string[];
  /** Raise the two masts of one hop by `extra` metres. */
  onApplyHeight: (hop: number, extra: number) => void;
  /** Present only when repeaters are a sensible next step (the link is blocked and none are set yet). */
  onSuggest?: () => void;
}

const fadeTone = (db: number): Metric['tone'] => (db >= HEALTHY_FADE_MARGIN_DB ? 'ok' : db > 0 ? 'warn' : 'bad');
const clearTone = (pct: number): Metric['tone'] => (pct >= 60 ? 'ok' : pct >= 0 ? 'warn' : 'bad');
const availTone = (pct: number): Metric['tone'] => (pct >= 99.9 ? 'ok' : pct >= 99 ? 'warn' : 'bad');

export function ResultPanel({ route, names, onApplyHeight, onSuggest }: ResultPanelProps) {
  const { t } = useI18n();
  const multi = route.hops.length > 1;
  const weak = route.hops[route.weakestHop];
  const weakName = t.route.hopName(names[route.weakestHop], names[route.weakestHop + 1]);
  const clearPct = (r: number) => Math.max(-100, Math.min(999, r * 100));

  const metrics: Metric[] = multi
    ? [
        { label: t.route.totalDistance, value: `${route.totalKm.toFixed(2)} km`, hint: t.route.totalDistanceHint },
        { label: t.route.hopsCount, value: String(route.hops.length), hint: t.route.hopsCountHint },
        { label: t.route.weakestFade, value: `${route.minFadeMarginDb.toFixed(1)} dB`, tone: fadeTone(route.minFadeMarginDb), hint: t.route.weakestFadeHint },
        {
          label: t.route.weakestClearance,
          value: `${clearPct(route.minClearanceRatio).toFixed(0)} %`,
          tone: clearTone(clearPct(route.minClearanceRatio)),
          hint: t.route.weakestClearanceHint,
        },
        { label: t.route.weakestRx, value: `${weak.rxLevelDbm.toFixed(1)} dBm`, hint: t.route.weakestRxHint },
        {
          label: t.route.e2eAvailability,
          value: formatAvailability(route.availabilityPct),
          tone: availTone(route.availabilityPct),
          hint: t.route.e2eAvailabilityHint,
        },
      ]
    : [
        { label: t.result.distance, value: `${weak.distanceKm.toFixed(2)} km`, hint: t.result.distanceHint },
        { label: t.result.fade, value: `${weak.fadeMarginDb.toFixed(1)} dB`, tone: fadeTone(weak.fadeMarginDb), hint: t.result.fadeHint },
        { label: t.result.rx, value: `${weak.rxLevelDbm.toFixed(1)} dBm`, hint: t.result.rxHint },
        {
          label: t.result.fresnel,
          value: `${clearPct(weak.minClearanceRatio).toFixed(0)} %`,
          tone: clearTone(clearPct(weak.minClearanceRatio)),
          hint: t.result.fresnelHint,
        },
        { label: t.result.fspl, value: `${weak.fsplDb.toFixed(1)} dB`, hint: t.result.fsplHint },
        { label: t.result.availability, value: formatAvailability(weak.availabilityPct), tone: availTone(weak.availabilityPct), hint: t.result.availabilityHint },
      ];

  const reason = reasonText(t, weak.reason);
  const headline = multi && route.verdict !== 'good' ? t.route.hopPrefix(weakName, reason) : reason;
  const canRaise = weak.extraHeightNeededM > 0 && weak.extraHeightReachable;

  return (
    <section className={`card verdict verdict-${route.verdict}`} aria-live="polite" aria-labelledby="verdict-title">
      <div className="verdict-head">
        <span className="verdict-icon" aria-hidden="true">
          {ICON[route.verdict]}
        </span>
        <div>
          <h2 id="verdict-title">{t.result[route.verdict]}</h2>
          <p>{headline}</p>
        </div>
      </div>

      {canRaise && (
        <button type="button" className="btn btn-primary btn-block" onClick={() => onApplyHeight(route.weakestHop, weak.extraHeightNeededM)}>
          {multi ? t.route.raiseHop(weakName, weak.extraHeightNeededM) : t.result.raise(weak.extraHeightNeededM)}
        </button>
      )}

      {onSuggest && (
        <button type="button" className="btn btn-block" onClick={onSuggest} title={t.suggest.hint}>
          {t.suggest.button}
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

      {multi && (
        <div className="hops">
          <h3>{t.route.hopsHeading}</h3>
          <ul>
            {route.hops.map((h, i) => (
              <li key={i} className={`hop hop-${h.verdict} ${i === route.weakestHop && route.verdict !== 'good' ? 'hop-weakest' : ''}`}>
                <span className="hop-icon" aria-hidden="true">
                  {ICON[h.verdict]}
                </span>
                <span className="hop-name">{t.route.hopName(names[i], names[i + 1])}</span>
                <span className="hop-stat">{h.distanceKm.toFixed(1)} km</span>
                <span className="hop-stat">{h.fadeMarginDb.toFixed(0)} dB</span>
                <span className="sr-only">{t.result[h.verdict]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!multi && weak.diffractionDb > 0.5 && (
        <p className="note">{t.result.diffraction(weak.diffractionDb.toFixed(1), weak.worstAtKm.toFixed(1))}</p>
      )}
    </section>
  );
}
