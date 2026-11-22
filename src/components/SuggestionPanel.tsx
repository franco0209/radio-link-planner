import { formatAvailability } from '../core/rf';
import type { RepeaterSuggestion } from '../core/types';
import { useI18n } from '../i18n';

interface SuggestionPanelProps {
  suggestions: RepeaterSuggestion[];
  onApply: (s: RepeaterSuggestion) => void;
  onPreview: (index: number | null) => void;
  onClose: () => void;
}

export function SuggestionPanel({ suggestions, onApply, onPreview, onClose }: SuggestionPanelProps) {
  const { t } = useI18n();
  const partial = suggestions.length > 0 && suggestions.every((s) => s.verdict !== 'good');

  return (
    <section className="card" aria-labelledby="suggest-title">
      <div className="card-head">
        <h2 id="suggest-title" className="card-title">
          {t.suggest.title}
        </h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label={t.suggest.close} title={t.suggest.close}>
          ×
        </button>
      </div>

      {suggestions.length === 0 ? (
        <p className="note" role="status">
          {t.suggest.none}
        </p>
      ) : (
        <>
          <p className="note">{t.suggest.intro}</p>
          {partial && (
            <p className="banner" role="note">
              {t.suggest.marginalNote}
            </p>
          )}
          <ul className="options">
            {suggestions.map((s, i) => (
              <li
                key={i}
                className="option"
                onMouseEnter={() => onPreview(i)}
                onMouseLeave={() => onPreview(null)}
                onFocus={() => onPreview(i)}
                onBlur={() => onPreview(null)}
              >
                <div className="option-head">
                  <strong>{t.suggest.option(i + 1)}</strong>
                  <span className="muted">{s.repeaters.length === 1 ? t.suggest.one : t.suggest.two}</span>
                  <span className={`pill pill-${s.verdict}`}>{s.verdict === 'good' ? t.suggest.good : t.suggest.marginal}</span>
                </div>
                <ul className="option-sites">
                  {s.repeaters.map((r, k) => (
                    <li key={k}>
                      <span className="badge badge-r" aria-hidden="true">
                        R{k + 1}
                      </span>
                      <span>
                        {t.suggest.at(r.atKm.toFixed(1), r.elevationM.toFixed(0))} · {t.suggest.mast(r.heightM)}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="muted">{t.suggest.stats(formatAvailability(s.availabilityPct), s.minFadeMarginDb.toFixed(0))}</p>
                <button type="button" className="btn btn-small btn-block" onClick={() => onApply(s)}>
                  {t.suggest.apply}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
