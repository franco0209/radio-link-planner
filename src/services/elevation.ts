import { distanceKm, samplePath } from '../core/geo';
import type { LatLng, TerrainSample } from '../core/types';

const ENDPOINT = 'https://api.open-meteo.com/v1/elevation';
const MAX_PER_REQUEST = 100;
const cache = new Map<string, TerrainSample[]>();

/** Target spacing between samples (m). The underlying DEM is ~90 m. */
const SPACING_M = 120;

export function sampleCountFor(km: number): number {
  return Math.min(400, Math.max(30, Math.round((km * 1000) / SPACING_M)));
}

async function fetchChunk(points: LatLng[], signal?: AbortSignal): Promise<number[]> {
  const lat = points.map((p) => p.lat.toFixed(5)).join(',');
  const lng = points.map((p) => p.lng.toFixed(5)).join(',');
  const res = await fetch(`${ENDPOINT}?latitude=${lat}&longitude=${lng}`, { signal });
  if (res.status === 429) throw new Error('The elevation service is rate limiting us. Wait a minute and try again.');
  if (!res.ok) throw new Error(`Elevation service error (${res.status}).`);
  const json = (await res.json()) as { elevation?: number[] };
  if (!json.elevation || json.elevation.length !== points.length) throw new Error('Unexpected elevation response.');
  return json.elevation;
}

/** Terrain elevation profile between a and b (Copernicus 90 m DEM via Open-Meteo). */
export async function fetchTerrainProfile(a: LatLng, b: LatLng, signal?: AbortSignal): Promise<TerrainSample[]> {
  const total = distanceKm(a, b);
  const count = sampleCountFor(total);
  const key = [a.lat, a.lng, b.lat, b.lng].map((n) => n.toFixed(5)).join('|') + `|${count}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const points = samplePath(a, b, count);
  const chunks: LatLng[][] = [];
  for (let i = 0; i < points.length; i += MAX_PER_REQUEST) chunks.push(points.slice(i, i + MAX_PER_REQUEST));
  const parts = await Promise.all(chunks.map((c) => fetchChunk(c, signal)));
  const elevations = parts.flat();

  const samples: TerrainSample[] = points.map((p, i) => ({
    lat: p.lat,
    lng: p.lng,
    h: elevations[i],
    d: (total * i) / (points.length - 1),
  }));
  cache.set(key, samples);
  return samples;
}
