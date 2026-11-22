import { DEFAULT_PARAMS } from '../core/analysis';
import { isValidLatLng } from '../core/geo';
import type { LatLng, LinkParams } from '../core/types';

export interface PlannerState {
  a: LatLng | null;
  b: LatLng | null;
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

const fmt = (p: LatLng) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;

function parsePoint(text: string | null): LatLng | null {
  if (!text) return null;
  const [lat, lng] = text.split(',').map(Number);
  const p = { lat, lng };
  return isValidLatLng(p) ? p : null;
}

/** Serialise the state so a link can be shared or bookmarked. Only non-default values are written. */
export function encodeState(s: PlannerState): string {
  const q = new URLSearchParams();
  if (s.a) q.set('a', fmt(s.a));
  if (s.b) q.set('b', fmt(s.b));
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
  return { a: parsePoint(q.get('a')), b: parsePoint(q.get('b')), params };
}
