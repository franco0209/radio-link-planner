import { DEFAULT_PARAMS } from '../core/analysis';
import { isValidLatLng } from '../core/geo';
import { MAX_REPEATERS } from '../core/repeaters';
import type { LatLng, LinkParams, Repeater } from '../core/types';

export interface PlannerState {
  a: LatLng | null;
  b: LatLng | null;
  /** Repeaters in route order (A to B). */
  repeaters: Repeater[];
  params: LinkParams;
}

const NUMERIC_KEYS: (keyof LinkParams)[] = [
  'freqMHz',
  'txPowerDbm',
  'gainADbi',
  'gainBDbi',
  'cableLossADb',
  'cableLossBDb',
  'rxSensitivityDbm',
  'heightAM',
  'heightBM',
  'kFactor',
  'terrainFactor',
  'marginDb',
];

/** Coordinates are rounded to 5 decimals (~1 m) everywhere, including cache keys. */
export const fmtPoint = (p: LatLng) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;

function parsePoint(text: string | null): LatLng | null {
  if (!text) return null;
  const [lat, lng] = text.split(',').map(Number);
  const p = { lat, lng };
  return isValidLatLng(p) ? p : null;
}

function parseRepeater(text: string | null): Repeater | null {
  if (!text) return null;
  const [lat, lng, h] = text.split(',').map(Number);
  const p = { lat, lng };
  if (!isValidLatLng(p) || !Number.isFinite(h) || h < 0 || h > 300) return null;
  return { lat, lng, heightM: h };
}

/** Serialise the state so a link can be shared or bookmarked. Only non-default values are written. */
export function encodeState(s: PlannerState): string {
  const q = new URLSearchParams();
  if (s.a) q.set('a', fmtPoint(s.a));
  if (s.b) q.set('b', fmtPoint(s.b));
  s.repeaters.slice(0, MAX_REPEATERS).forEach((r, i) => q.set(`r${i + 1}`, `${fmtPoint(r)},${r.heightM}`));
  for (const k of NUMERIC_KEYS) {
    if (s.params[k] !== DEFAULT_PARAMS[k]) q.set(k, String(s.params[k]));
  }
  return q.toString();
}

export function decodeState(hash: string): PlannerState {
  const q = new URLSearchParams(hash.replace(/^#/, ''));
  const params: LinkParams = { ...DEFAULT_PARAMS };
  for (const k of NUMERIC_KEYS) {
    const raw = q.get(k);
    if (raw === null) continue;
    const n = Number(raw);
    if (Number.isFinite(n)) params[k] = n;
  }
  const a = parsePoint(q.get('a'));
  const b = parsePoint(q.get('b'));
  // Repeaters make no sense without both ends.
  const repeaters = a && b ? [parseRepeater(q.get('r1')), parseRepeater(q.get('r2'))].filter((r): r is Repeater => r !== null) : [];
  return { a, b, repeaters, params };
}
