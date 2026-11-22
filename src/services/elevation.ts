import { distanceKm, samplePath } from '../core/geo';
import type { LatLng, TerrainSample } from '../core/types';
import { localElevations } from './dem';
import { ServiceError } from './errors';

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
  if (res.status === 429) throw new ServiceError('rateLimited');
  if (!res.ok) throw new ServiceError('elevationHttp', res.status);
  const json = (await res.json()) as { elevation?: number[] };
  if (!json.elevation || json.elevation.length !== points.length) throw new ServiceError('badResponse');
  return json.elevation;
}

/** Terrain elevation profile between a and b (Copernicus 90 m DEM: bundled tiles where available, else Open-Meteo). */
export async function fetchTerrainProfile(a: LatLng, b: LatLng, signal?: AbortSignal): Promise<TerrainSample[]> {
  const total = distanceKm(a, b);
  const count = sampleCountFor(total);
  const key = [a.lat, a.lng, b.lat, b.lng].map((n) => n.toFixed(5)).join('|') + `|${count}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const points = samplePath(a, b, count);
  const elevations = (await localElevations(points)) ?? (await fetchRemote(points, signal));

  const samples: TerrainSample[] = points.map((p, i) => ({
    lat: p.lat,
    lng: p.lng,
    h: elevations[i],
    d: (total * i) / (points.length - 1),
  }));
  cache.set(key, samples);
  return samples;
}

/** Ground elevation of arbitrary points: bundled tiles when they cover them all, else the elevation service. */
export async function fetchElevations(points: LatLng[], signal?: AbortSignal): Promise<number[]> {
  return (await localElevations(points)) ?? (await fetchRemote(points, signal));
}

/** The elevation service. Chunks of 100, two requests at a time to stay clear of the rate limit. */
async function fetchRemote(points: LatLng[], signal?: AbortSignal): Promise<number[]> {
  const chunks: LatLng[][] = [];
  for (let i = 0; i < points.length; i += MAX_PER_REQUEST) chunks.push(points.slice(i, i + MAX_PER_REQUEST));
  const parts: number[][] = [];
  for (let i = 0; i < chunks.length; i += 2) {
    parts.push(...(await Promise.all(chunks.slice(i, i + 2).map((c) => fetchChunk(c, signal)))));
  }
  return parts.flat();
}
