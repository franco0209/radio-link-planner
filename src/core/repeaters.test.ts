import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, analyzeLink, analyzeRoute, seriesAvailabilityPct, suggestRepeaters, type TerrainSample } from './index';

/** A synthetic path along the equator: flat ground at `base` m with optional narrow ridges. */
function path(km: number, n: number, ridges: { atKm: number; h: number }[] = [], base = 100): TerrainSample[] {
  return Array.from({ length: n }, (_, i) => {
    const d = (km * i) / (n - 1);
    const spike = ridges.some((r) => Math.abs(r.atKm - d) < km / n);
    const h = spike ? Math.max(...ridges.filter((r) => Math.abs(r.atKm - d) < km / n).map((r) => r.h)) : base;
    return { d, h, lat: 0, lng: d / 111.19 };
  });
}

describe('analyzeRoute', () => {
  it('multiplies hop availabilities (series system) and picks the weakest hop', () => {
    const hop1 = path(8, 60);
    const hop2 = path(12, 60);
    const p = { ...DEFAULT_PARAMS };
    const r = analyzeRoute([hop1, hop2], p, [30, 30, 30]);
    const a1 = analyzeLink(hop1, { ...p, heightAM: 30, heightBM: 30 });
    const a2 = analyzeLink(hop2, { ...p, heightAM: 30, heightBM: 30 });
    expect(r.availabilityPct).toBeCloseTo(seriesAvailabilityPct([a1.availabilityPct, a2.availabilityPct]), 9);
    expect(r.availabilityPct).toBeLessThanOrEqual(Math.min(a1.availabilityPct, a2.availabilityPct));
    expect(r.totalKm).toBeCloseTo(20, 6);
    expect(r.weakestHop).toBe(1); // the longer hop has the smaller fade margin
    expect(r.minFadeMarginDb).toBeCloseTo(a2.fadeMarginDb, 9);
  });

  it('reports the worst verdict of any hop', () => {
    const ok = path(5, 40);
    const blocked = path(10, 60, [{ atKm: 5, h: 400 }]);
    const r = analyzeRoute([ok, blocked], DEFAULT_PARAMS, [30, 30, 30]);
    expect(r.verdict).toBe('blocked');
    expect(r.weakestHop).toBe(1);
  });

  it('rejects a heights array of the wrong length', () => {
    expect(() => analyzeRoute([path(5, 40)], DEFAULT_PARAMS, [10])).toThrow();
  });
});

describe('suggestRepeaters', () => {
  it('puts one repeater on a single ridge and every hop comes out viable', () => {
    const direct = path(20, 167, [{ atKm: 10, h: 300 }]);
    expect(analyzeLink(direct, DEFAULT_PARAMS).verdict).toBe('blocked');

    const out = suggestRepeaters(direct, DEFAULT_PARAMS);
    expect(out.length).toBeGreaterThan(0);
    const best = out[0];
    expect(best.repeaters).toHaveLength(1);
    expect(best.verdict).toBe('good');
    expect(Math.abs(best.repeaters[0].atKm - 10)).toBeLessThan(0.5);
    expect(best.repeaters[0].elevationM).toBe(300);

    // The suggestion must hold up when re-analysed through the public route API.
    const idx = direct.findIndex((s) => s.lat === best.repeaters[0].lat && s.lng === best.repeaters[0].lng);
    const rebase = (a: number, b: number) => direct.slice(a, b + 1).map((s) => ({ ...s, d: s.d - direct[a].d }));
    const route = analyzeRoute([rebase(0, idx), rebase(idx, direct.length - 1)], DEFAULT_PARAMS, [
      DEFAULT_PARAMS.heightAM,
      best.repeaters[0].heightM,
      DEFAULT_PARAMS.heightBM,
    ]);
    expect(route.verdict).toBe('good');
    expect(route.availabilityPct).toBeCloseTo(best.availabilityPct, 6);
  });

  it('uses the lowest mast that works', () => {
    const direct = path(20, 167, [{ atKm: 10, h: 300 }]);
    const best = suggestRepeaters(direct, DEFAULT_PARAMS)[0];
    expect(best.repeaters[0].heightM).toBe(10); // the ridge top already gives clearance
  });

  it('needs two repeaters for two ridges and never offers two when one is enough', () => {
    const two = path(21, 175, [
      { atKm: 7, h: 300 },
      { atKm: 14, h: 300 },
    ]);
    const out = suggestRepeaters(two, DEFAULT_PARAMS);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].repeaters).toHaveLength(2);
    expect(out[0].verdict).toBe('good');

    const one = path(20, 167, [{ atKm: 10, h: 300 }]);
    expect(suggestRepeaters(one, DEFAULT_PARAMS).every((s) => s.repeaters.length === 1)).toBe(true);
  });

  it('keeps alternative options apart from each other', () => {
    // A broad smooth hill: whatever is returned must be spread out, never a row of neighbours.
    const direct = path(20, 167).map((s) => ({ ...s, h: 100 + Math.max(0, 140 * (1 - Math.abs(s.d - 10) / 5)) }));
    const out = suggestRepeaters(direct, { ...DEFAULT_PARAMS, heightAM: 30, heightBM: 30 }, { maxResults: 3 });
    expect(out.length).toBeGreaterThan(0);
    const spots = out.map((s) => s.repeaters[0].atKm).sort((a, b) => a - b);
    for (let i = 1; i < spots.length; i++) expect(spots[i] - spots[i - 1]).toBeGreaterThanOrEqual(20 * 0.08 - 0.2);
  });

  it('improves a long path that fails on signal alone by splitting it', () => {
    const p = { ...DEFAULT_PARAMS, txPowerDbm: 18, heightAM: 100, heightBM: 100 };
    const direct = path(60, 400);
    const before = analyzeLink(direct, p);
    expect(before.verdict).toBe('blocked');
    expect(before.fadeMarginDb).toBeLessThanOrEqual(0);

    const out = suggestRepeaters(direct, p);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].verdict).not.toBe('blocked');
    expect(out[0].minFadeMarginDb).toBeGreaterThan(0);
  });

  it('returns nothing when even two repeaters cannot help', () => {
    const p = { ...DEFAULT_PARAMS, txPowerDbm: -20 };
    expect(suggestRepeaters(path(10, 90), p)).toEqual([]);
  });

  it('handles tiny paths without throwing', () => {
    expect(suggestRepeaters(path(0.3, 8), DEFAULT_PARAMS)).toEqual([]);
  });

  it('is fast enough for the UI thread on a full-size profile', () => {
    const direct = path(48, 400, [
      { atKm: 16, h: 350 },
      { atKm: 33, h: 350 },
    ]);
    const t0 = performance.now();
    const out = suggestRepeaters(direct, DEFAULT_PARAMS);
    const ms = performance.now() - t0;
    expect(out.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(3000);
  });
});
