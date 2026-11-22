import { useRef, useState } from 'react';
import type { LatLng } from '../core/types';
import { parseCoordinates, searchPlaces, type PlaceResult } from '../services/geocode';

interface PointFieldProps {
  name: 'A' | 'B';
  point: LatLng | null;
  placing: boolean;
  onPlace: () => void;
  onSet: (p: LatLng) => void;
  onClear: () => void;
}

export function PointField({ name, point, placing, onPlace, onSet, onClear }: PointFieldProps) {
  const [text, setText] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);

  const submit = async () => {
    const q = text.trim();
    if (!q) return;
    setError('');
    const coords = parseCoordinates(q);
    if (coords) {
      onSet(coords);
      setText('');
      setResults([]);
      return;
    }
    abort.current?.abort();
    abort.current = new AbortController();
    setBusy(true);
    try {
      const found = await searchPlaces(q, abort.current.signal);
      setResults(found);
      if (!found.length) setError('No places found. Try another name or paste "lat, lng".');
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="point">
      <div className="point-head">
        <span className={`badge badge-${name.toLowerCase()}`} aria-hidden="true">
          {name}
        </span>
        <div className="point-coords">
          <strong>Site {name}</strong>
          <span className="muted">
            {point ? `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}` : 'Not set'}
          </span>
        </div>
        <button type="button" className={`btn btn-small ${placing ? 'btn-active' : ''}`} onClick={onPlace} aria-pressed={placing}>
          {placing ? 'Click the map…' : point ? 'Move' : 'Pick on map'}
        </button>
        {point && (
          <button type="button" className="icon-btn" onClick={onClear} aria-label={`Clear site ${name}`} title="Clear">
            ×
          </button>
        )}
      </div>
      <form
        className="search"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search a place or paste lat, lng"
          aria-label={`Search a place or coordinates for site ${name}`}
        />
        <button type="submit" className="btn btn-small" disabled={busy || !text.trim()}>
          {busy ? '…' : 'Go'}
        </button>
      </form>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {results.length > 0 && (
        <ul className="results" aria-label="Search results">
          {results.map((r) => (
            <li key={`${r.point.lat},${r.point.lng}`}>
              <button
                type="button"
                onClick={() => {
                  onSet(r.point);
                  setResults([]);
                  setText('');
                }}
              >
                {r.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
