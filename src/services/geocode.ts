import type { LatLng } from '../core/types';
import { ServiceError } from './errors';

export interface PlaceResult {
  label: string;
  point: LatLng;
}

/** Parse "lat, lng" pasted from a map app. Returns null if it is not a coordinate pair. */
export function parseCoordinates(text: string): LatLng | null {
  const m = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

/** Place search through OpenStreetMap Nominatim (user-initiated, low volume). */
export async function searchPlaces(query: string, lang: string, signal?: AbortSignal): Promise<PlaceResult[]> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=${encodeURIComponent(lang)}&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new ServiceError('searchUnavailable');
  const rows = (await res.json()) as { display_name: string; lat: string; lon: string }[];
  return rows.map((r) => ({ label: r.display_name, point: { lat: Number(r.lat), lng: Number(r.lon) } }));
}
