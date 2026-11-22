import type { LatLng } from '../core/types';

/**
 * Offline terrain: Copernicus GLO-90 tiles bundled with the app (see scripts/build-dem.py).
 * Each 1x1 degree tile is 1200 x 1200 Int16 metres, north to south, gzipped.
 * Anything outside the bundled tiles returns null, and the caller falls back to the elevation service.
 */
export const TILE_SIZE = 1200;

export const tileId = (lat0: number, lng0: number) =>
  `${lat0 >= 0 ? 'N' : 'S'}${String(Math.abs(lat0)).padStart(2, '0')}_${lng0 >= 0 ? 'E' : 'W'}${String(Math.abs(lng0)).padStart(3, '0')}`;

/** Tile that contains a point, named by its south-west corner. */
export const tileOf = (p: LatLng) => {
  const lat0 = Math.floor(p.lat);
  const lng0 = Math.floor(p.lng);
  return { id: tileId(lat0, lng0), lat0, lng0 };
};

/** Bilinear elevation at a point inside the tile whose south-west corner is (lat0, lng0). Pixel values sit at pixel centres. */
export function sampleTile(data: Int16Array, lat0: number, lng0: number, p: LatLng): number {
  const max = TILE_SIZE - 1;
  const fx = Math.min(max, Math.max(0, (p.lng - lng0) * TILE_SIZE - 0.5));
  const fy = Math.min(max, Math.max(0, (lat0 + 1 - p.lat) * TILE_SIZE - 0.5));
  const x0 = Math.min(max - 1, Math.floor(fx));
  const y0 = Math.min(max - 1, Math.floor(fy));
  const tx = fx - x0;
  const ty = fy - y0;
  const at = (y: number, x: number) => data[y * TILE_SIZE + x];
  return (
    at(y0, x0) * (1 - tx) * (1 - ty) + at(y0, x0 + 1) * tx * (1 - ty) + at(y0 + 1, x0) * (1 - tx) * ty + at(y0 + 1, x0 + 1) * tx * ty
  );
}

/** Elevation of every point from the given tiles, or null if any point is outside them. */
export async function elevationsFromTiles(
  points: LatLng[],
  available: ReadonlySet<string>,
  loadTile: (id: string) => Promise<Int16Array>,
): Promise<number[] | null> {
  const owners = points.map(tileOf);
  if (owners.some((o) => !available.has(o.id))) return null;
  const data = new Map<string, Int16Array>();
  await Promise.all([...new Set(owners.map((o) => o.id))].map(async (id) => data.set(id, await loadTile(id))));
  return points.map((p, i) => sampleTile(data.get(owners[i].id)!, owners[i].lat0, owners[i].lng0, p));
}

async function gunzip(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const head = new Uint8Array(buf, 0, 2);
  if (head[0] !== 0x1f || head[1] !== 0x8b) return buf; // the server already decoded it
  return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}

const base = () => `${import.meta.env.BASE_URL}dem/`;
let index: Promise<Set<string>> | null = null;
const tiles = new Map<string, Promise<Int16Array>>();

function loadIndex(): Promise<Set<string>> {
  index ??= fetch(`${base()}index.json`)
    .then((r) => (r.ok ? (r.json() as Promise<{ tiles: string[] }>) : { tiles: [] }))
    .then((j) => new Set(j.tiles))
    .catch(() => new Set<string>());
  return index;
}

function loadTile(id: string): Promise<Int16Array> {
  let t = tiles.get(id);
  if (!t) {
    t = fetch(`${base()}${id}.bin.gz`)
      .then((r) => {
        if (!r.ok) throw new Error(`tile ${id}: ${r.status}`);
        return r.arrayBuffer();
      })
      .then(gunzip)
      .then((b) => {
        if (b.byteLength !== TILE_SIZE * TILE_SIZE * 2) throw new Error(`tile ${id}: bad size`);
        return new Int16Array(b);
      });
    t.catch(() => tiles.delete(id)); // let a later attempt retry
    tiles.set(id, t);
  }
  return t;
}

/** Elevations from the bundled tiles, or null when they do not cover every point (or cannot be loaded). */
export async function localElevations(points: LatLng[]): Promise<number[] | null> {
  try {
    return await elevationsFromTiles(points, await loadIndex(), loadTile);
  } catch {
    return null;
  }
}
