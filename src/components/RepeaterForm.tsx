import { MAX_REPEATERS } from '../core/repeaters';
import type { Repeater } from '../core/types';
import { useI18n } from '../i18n';
import { Field } from './Field';

interface RepeaterFormProps {
  repeaters: Repeater[];
  /** Both sites must exist before a repeater makes sense. */
  enabled: boolean;
  placing: boolean;
  onAdd: () => void;
  onHeight: (index: number, heightM: number) => void;
  onRemove: (index: number) => void;
}

export function RepeaterForm({ repeaters, enabled, placing, onAdd, onHeight, onRemove }: RepeaterFormProps) {
  const { t } = useI18n();
  const full = repeaters.length >= MAX_REPEATERS;

  return (
    <div className="repeaters">
      <div className="repeaters-head">
        <strong>{t.repeaters.title}</strong>
        <button
          type="button"
          className={`btn btn-small ${placing ? 'btn-active' : ''}`}
          onClick={onAdd}
          disabled={!enabled || full}
          aria-pressed={placing}
          title={!enabled ? t.repeaters.needSites : full ? t.repeaters.full : undefined}
        >
          {placing ? t.repeaters.placing : `+ ${t.repeaters.add}`}
        </button>
      </div>
      {repeaters.length === 0 && <p className="hint">{t.repeaters.hint}</p>}
      {repeaters.map((r, i) => (
        <div className="repeater-row" key={i}>
          <span className="badge badge-r" aria-hidden="true">
            R{i + 1}
          </span>
          <div className="point-coords">
            <strong>{t.repeaters.label(i + 1)}</strong>
            <span className="muted">
              {r.lat.toFixed(5)}, {r.lng.toFixed(5)}
            </span>
          </div>
          <div className="repeater-height">
            <Field label={t.repeaters.height} unit="m" value={r.heightM} min={0} max={300} onChange={(v) => onHeight(i, v)} />
          </div>
          <button type="button" className="icon-btn" onClick={() => onRemove(i)} aria-label={t.repeaters.remove(i + 1)} title={t.repeaters.removeTitle}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
