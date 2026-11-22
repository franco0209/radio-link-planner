import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PARAMS,
  analyzeLink,
  buildGrid,
  distanceKm,
  mergeSuggestions,
  needsOffAxis,
  samplePath,
  suggestOffAxis,
  suggestRepeaters,
  type LatLng,
  type OffAxisDeps,
  type RepeaterSuggestion,
  type TerrainSample,
} from './index';

const A: LatLng = { lat: 0, lng: 0 };
const B: LatLng = { lat: 0, lng: 0.2 }; // ~22 km along the equator

/**
 * Flat 100 m ground with five 500-700 m walls across the A-B line, each ending 0.7 km either side of it.
 * Two repeaters on the line can sit on at most two of them, so a hop always has a wall in the way,
 * while one repeater beside the walls sees both ends over open ground.
 */
const WALLS = [
  { lng: 0.033, h: 500 },
  { lng: 0.066, h: 700 },
  { lng: 0.1, h: 500 },
  { lng: 0.133, h: 700 },
  { lng: 0.167, h: 500 },
];
const wall = (p: LatLng) => {
  const w = WALLS.find((x) => Math.abs(p.lng - x.lng) < 0.004);
  return w && Math.abs(p.lat) < 0.006 ? w.h : 100;
};

function deps(ground: (p: LatLng) => number) {
  const elevations = vi.fn(async (pts: LatLng[]) => pts.map(ground));
  const profile = vi.fn(async (a: LatLng, b: LatLng): Promise<TerrainSample[]> => {
    const total = distanceKm(a, b);
    return samplePath(a, b, Math.max(30, Math.round((total * 1000) / 120))).map((p, i, all) => ({
      ...p,
      h: ground(p),
      d: (total * i) / (all.length - 1),
    }));
  });
  return { elevations, profile } satisfies OffAxisDeps;
}

describe('buildGrid', () => {
  it('has A and B as nodes and stays inside the lateral cap', () => {
    const g = buildGrid(A, B, { cols: 20, rows: 9, maxLateralFrac: 0.2 });
    const mid = (g.rows - 1) / 2;
    expect(distanceKm(g.points[mid * g.cols], A)).toBeLessThan(0.01);
    expect(distanceKm(g.points[mid * g.cols + g.cols - 1], B)).toBeLessThan(0.01);
    for (const p of g.points) expect(Math.abs(p.lat)).toBeLessThanOrEqual((g.halfWidthKm / 111.195) * 1.001);
  });
});

describe('suggestOffAxis', () => {
  it('finds a way around a wall that no site on the line can clear', async () => {
    const d = deps(wall);
    // The line itself is hopeless, so the exhaustive on-line search finds nothing viable.
    const direct = await d.profile(A, B);
    expect(analyzeLink(direct, { ...DEFAULT_PARAMS }).verdict).toBe('blocked');
    expect(suggestRepeaters(direct, DEFAULT_PARAMS).every((s) => s.verdict !== 'good')).toBe(true);

    const { suggestions } = await suggestOffAxis(A, B, DEFAULT_PARAMS, d);
    expect(suggestions.length).toBeGreaterThan(0);
    const best = suggestions[0];
    expect(best.verdict).toBe('good');
    expect(best.repeaters).toHaveLength(1);
    expect(best.repeaters[0].offKm).toBeGreaterThan(0);
    expect(Math.abs(best.repeaters[0].lat)).toBeGreaterThan(0.006); // beside the walls, not on them
    // Longer than the straight line, as it should be off-axis.
    expect(best.hopKm[0] + best.hopKm[1]).toBeGreaterThan(distanceKm(A, B));
  });

  it('returns the terrain it scored on, ending exactly at the repeater, so applying it matches the card', async () => {
    const { suggestions } = await suggestOffAxis(A, B, DEFAULT_PARAMS, deps(wall));
    const s = suggestions[0];
    const r = s.repeaters[0];
    expect(s.hopTerrain).toHaveLength(2);
    const [h1, h2] = s.hopTerrain!;
    const near = (p: LatLng, q: LatLng) => expect(distanceKm(p, q)).toBeLessThan(1e-6);
    near(h1[0], A);
    near(h1[h1.length - 1], r);
    near(h2[0], r);
    near(h2[h2.length - 1], B);
  });

  it('keeps the network cost bounded', async () => {
    const d = deps(wall);
    await suggestOffAxis(A, B, DEFAULT_PARAMS, d, { finalists: 5 });
    expect(d.elevations).toHaveBeenCalledTimes(1);
    expect(d.profile.mock.calls.length).toBeLessThanOrEqual(2 * 5);
  });

  it('only fetches enough real profiles to fill the result list', async () => {
    const d = deps(wall);
    const { verified } = await suggestOffAxis(A, B, DEFAULT_PARAMS, d, { finalists: 8, maxResults: 1 });
    expect(verified).toBeLessThan(8);
  });

  it('stops when aborted', async () => {
    const ctrl = new AbortController();
    const d = deps(wall);
    d.profile.mockImplementation(async () => {
      ctrl.abort();
      throw new DOMException('Aborted', 'AbortError');
    });
    await expect(suggestOffAxis(A, B, DEFAULT_PARAMS, d, {}, ctrl.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('gives up cleanly on a path too short to place a repeater', async () => {
    const { suggestions } = await suggestOffAxis(A, { lat: 0, lng: 0.002 }, DEFAULT_PARAMS, deps(wall));
    expect(suggestions).toEqual([]);
  });
});

const sug = (verdict: RepeaterSuggestion['verdict'], count: number, availabilityPct = 99, heightM = 10): RepeaterSuggestion => ({
  repeaters: Array.from({ length: count }, () => ({ lat: 0, lng: 0, heightM, atKm: 1, elevationM: 100 })),
  verdict,
  availabilityPct,
  minFadeMarginDb: 20,
  hopKm: [],
});

describe('needsOffAxis', () => {
  it('skips the network search only when one repeater on the line already works', () => {
    expect(needsOffAxis([sug('good', 1)])).toBe(false);
    expect(needsOffAxis([sug('good', 2)])).toBe(true);
    expect(needsOffAxis([sug('marginal', 1)])).toBe(true);
    expect(needsOffAxis([])).toBe(true);
  });
});

describe('mergeSuggestions', () => {
  it('ranks a single off-line repeater ahead of two on the line', () => {
    const merged = mergeSuggestions([sug('good', 2, 99.9)], [sug('good', 1, 99)]);
    expect(merged.map((s) => s.repeaters.length)).toEqual([1, 2]);
  });

  it('puts viable options before partial ones and caps the list', () => {
    const merged = mergeSuggestions([sug('marginal', 1), sug('marginal', 1), sug('marginal', 1)], [sug('good', 2)]);
    expect(merged[0].verdict).toBe('good');
    expect(merged).toHaveLength(3);
  });
});
