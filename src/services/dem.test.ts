import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { TILE_SIZE, elevationsFromTiles, localElevations, sampleTile, tileId, tileOf } from './dem';

/** A synthetic tile whose value is 10 * row + column, so interpolation is easy to predict. */
function ramp(): Int16Array {
  const t = new Int16Array(TILE_SIZE * TILE_SIZE);
  for (let r = 0; r < TILE_SIZE; r++) for (let c = 0; c < TILE_SIZE; c++) t[r * TILE_SIZE + c] = Math.min(32000, 10 * r + c);
  return t;
}

describe('tile naming', () => {
  it('names tiles by their south-west corner', () => {
    expect(tileId(-17, -72)).toBe('S17_W072');
    expect(tileId(5, 8)).toBe('N05_E008');
    expect(tileOf({ lat: -16.4, lng: -71.5 })).toEqual({ id: 'S17_W072', lat0: -17, lng0: -72 });
    expect(tileOf({ lat: 0.2, lng: 0.2 }).id).toBe('N00_E000');
    expect(tileOf({ lat: -0.2, lng: -0.2 }).id).toBe('S01_W001');
  });
});

describe('sampleTile', () => {
  const t = ramp();
  // Row 0 is the northern edge (lat0 + 1), column 0 the western edge (lng0). Pixel centres are half a pixel in.
  const at = (row: number, col: number) => ({ lat: 1 - (row + 0.5) / TILE_SIZE, lng: (col + 0.5) / TILE_SIZE });

  it('returns the stored value at a pixel centre', () => {
    expect(sampleTile(t, 0, 0, at(100, 200))).toBeCloseTo(10 * 100 + 200, 6);
    expect(sampleTile(t, 0, 0, at(0, 0))).toBeCloseTo(0, 6);
  });

  it('interpolates linearly between pixels', () => {
    const p = at(100, 200);
    expect(sampleTile(t, 0, 0, { lat: p.lat, lng: p.lng + 0.5 / TILE_SIZE })).toBeCloseTo(1200.5, 6); // half a column east
    expect(sampleTile(t, 0, 0, { lat: p.lat - 0.5 / TILE_SIZE, lng: p.lng })).toBeCloseTo(1200 + 5, 6); // half a row south
  });

  it('clamps at the tile edge instead of reading outside it', () => {
    expect(sampleTile(t, 0, 0, { lat: 1, lng: 0 })).toBeCloseTo(0, 6);
    expect(sampleTile(t, 0, 0, { lat: 0, lng: 1 })).toBeCloseTo(10 * (TILE_SIZE - 1) + TILE_SIZE - 1, 6);
  });
});

describe('elevationsFromTiles', () => {
  const t = ramp();

  it('returns null if any point is outside the bundled tiles, so the caller can fall back', async () => {
    const out = await elevationsFromTiles([{ lat: 0.5, lng: 0.5 }, { lat: 5.5, lng: 0.5 }], new Set(['N00_E000']), async () => t);
    expect(out).toBeNull();
  });

  it('loads each tile once, however many points fall in it', async () => {
    let loads = 0;
    const out = await elevationsFromTiles(
      Array.from({ length: 50 }, (_, i) => ({ lat: 0.1 + i / 100, lng: 0.5 })),
      new Set(['N00_E000']),
      async () => (loads++, t),
    );
    expect(out).toHaveLength(50);
    expect(loads).toBe(1);
  });
});

/** The real bundled Arequipa tile, checked against values read from the original GeoTIFF and from the elevation service. */
describe('bundled tile S17_W072', () => {
  const tile = new Int16Array(gunzipSync(readFileSync('public/dem/S17_W072.bin.gz')).buffer.slice(0));
  const centre = (row: number, col: number) => ({ lat: -16 - (row + 0.5) / TILE_SIZE, lng: -72 + (col + 0.5) / TILE_SIZE });

  it('has the expected size and matches the source raster at pixel centres', () => {
    expect(tile.length).toBe(TILE_SIZE * TILE_SIZE);
    // Values read from Copernicus_DSM_COG_30_S17_00_W072_00_DEM.tif with tifffile.
    const known: [number, number, number][] = [
      [0, 0, 3531],
      [300, 900, 4610],
      [600, 600, 2383],
      [1199, 1199, 2566],
    ];
    for (const [r, c, h] of known) expect(sampleTile(tile, -17, -72, centre(r, c))).toBeCloseTo(h, 6);
  });

  it('agrees with the Open-Meteo elevation service around Arequipa', () => {
    // Open-Meteo answers, fetched for these coordinates on 2026-11-22.
    const api: [number, number, number][] = [
      [-16.4, -71.5, 2463],
      [-16.5, -71.6, 2543],
      [-16.3, -71.7, 2433],
      [-16.65, -71.45, 2853],
    ];
    for (const [lat, lng, h] of api) expect(Math.abs(sampleTile(tile, -17, -72, { lat, lng }) - h)).toBeLessThan(40);
  });
});

describe('localElevations (browser loading path)', () => {
  it('fetches the index and a gzipped tile, decompresses it, and declines points outside the tiles', async () => {
    const requested: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      requested.push(url);
      const file = url.replace(/^.*\/dem\//, 'public/dem/');
      return new Response(readFileSync(file));
    });
    const inside = await localElevations([{ lat: -16.4, lng: -71.5 }, { lat: -16.45, lng: -71.55 }]);
    expect(inside).toHaveLength(2);
    expect(Math.abs(inside![0] - 2463)).toBeLessThan(40);
    expect(await localElevations([{ lat: 40.4, lng: -3.7 }])).toBeNull(); // Madrid: not bundled
    // index once, tile once, however many calls
    expect(requested.filter((u) => u.endsWith('index.json'))).toHaveLength(1);
    expect(requested.filter((u) => u.endsWith('S17_W072.bin.gz'))).toHaveLength(1);
    vi.unstubAllGlobals();
  });
});
