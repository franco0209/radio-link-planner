import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PARAMS,
  analyzeLink,
  availabilityPct,
  bearingDeg,
  distanceKm,
  earthBulgeM,
  freeSpaceLossDb,
  fresnelRadiusM,
  interpolate,
  knifeEdgeLossDb,
  type TerrainSample,
} from './index';

const flatPath = (km: number, elev = 100, n = 50): TerrainSample[] =>
  Array.from({ length: n }, (_, i) => ({ d: (km * i) / (n - 1), h: elev, lat: 0, lng: 0 }));

describe('geo', () => {
  it('computes the known distance between two cities', () => {
    // Lima -> Arequipa is ~765 km as the crow flies.
    const d = distanceKm({ lat: -12.0464, lng: -77.0428 }, { lat: -16.409, lng: -71.5375 });
    expect(d).toBeGreaterThan(755);
    expect(d).toBeLessThan(775);
  });

  it('interpolates the midpoint on the equator', () => {
    const mid = interpolate({ lat: 0, lng: 0 }, { lat: 0, lng: 10 }, 0.5);
    expect(mid.lat).toBeCloseTo(0, 6);
    expect(mid.lng).toBeCloseTo(5, 6);
  });

  it('gives a due-east bearing along the equator', () => {
    expect(bearingDeg({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(90, 5);
  });
});

describe('rf', () => {
  it('matches the textbook FSPL value (10 km @ 5.8 GHz = 127.7 dB)', () => {
    expect(freeSpaceLossDb(10, 5800)).toBeCloseTo(127.7, 1);
  });

  it('matches the textbook Fresnel radius (10 km @ 5.8 GHz, midpoint = 11.37 m)', () => {
    expect(fresnelRadiusM(5, 5, 5800)).toBeCloseTo(11.37, 1);
  });

  it('computes earth bulge at the middle of a 20 km path (k=4/3) as ~5.9 m', () => {
    expect(earthBulgeM(10, 10, 4 / 3)).toBeCloseTo(5.89, 1);
  });

  it('has ~6 dB knife-edge loss when the ray just grazes the obstacle', () => {
    expect(knifeEdgeLossDb(0, 5, 5, 5800)).toBeCloseTo(6, 0);
  });

  it('has no diffraction loss when well clear', () => {
    expect(knifeEdgeLossDb(-100, 5, 5, 5800)).toBe(0);
  });

  it('gives higher availability for a larger fade margin', () => {
    expect(availabilityPct(10, 5800, 30, 1)).toBeGreaterThan(availabilityPct(10, 5800, 15, 1));
    expect(availabilityPct(10, 5800, 0, 1)).toBe(0);
  });
});

describe('analyzeLink', () => {
  it('flags a short flat path with tall masts as good', () => {
    const r = analyzeLink(flatPath(5), { ...DEFAULT_PARAMS, heightAM: 20, heightBM: 20 });
    expect(r.verdict).toBe('good');
    expect(r.fadeMarginDb).toBeGreaterThan(15);
    expect(r.extraHeightNeededM).toBe(0);
  });

  it('flags a hill in the middle as blocked and suggests a height', () => {
    const path = flatPath(10);
    path[25].h = 160;
    const r = analyzeLink(path, DEFAULT_PARAMS);
    expect(r.verdict).toBe('blocked');
    expect(r.diffractionDb).toBeGreaterThan(6);
    expect(r.extraHeightNeededM).toBeGreaterThan(40);
    // The suggested height must really fix the path.
    const fixed = analyzeLink(path, {
      ...DEFAULT_PARAMS,
      heightAM: DEFAULT_PARAMS.heightAM + r.extraHeightNeededM,
      heightBM: DEFAULT_PARAMS.heightBM + r.extraHeightNeededM,
    });
    expect(fixed.minClearanceRatio).toBeGreaterThanOrEqual(0.6);
  });

  it('reports a link-budget that adds up', () => {
    const r = analyzeLink(flatPath(8), { ...DEFAULT_PARAMS, heightAM: 30, heightBM: 30 });
    const manual = 23 + 23 - 0.5 - freeSpaceLossDb(8, 5800) + 23 - 0.5;
    expect(r.rxLevelDbm).toBeCloseTo(manual, 6);
    expect(r.fadeMarginDb).toBeCloseTo(manual + 80, 6);
  });

  it('is marginal when the path is clear but the budget is thin', () => {
    const r = analyzeLink(flatPath(5), { ...DEFAULT_PARAMS, heightAM: 20, heightBM: 20, txPowerDbm: 0, gainADbi: 10, gainBDbi: 10 });
    expect(r.verdict).not.toBe('good');
  });
});
