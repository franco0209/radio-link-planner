import { availabilityPct, earthBulgeM, freeSpaceLossDb, fresnelRadiusM, knifeEdgeLossDb } from './rf';
import type { LinkAnalysis, LinkParams, ProfilePoint, TerrainSample, Verdict } from './types';

/** Fraction of the first Fresnel zone that should be free of obstacles. */
export const TARGET_CLEARANCE = 0.6;
/** Minimum fade margin considered healthy, dB. */
export const HEALTHY_FADE_MARGIN_DB = 15;

export const DEFAULT_PARAMS: LinkParams = {
  freqMHz: 5800,
  txPowerDbm: 23,
  gainADbi: 23,
  gainBDbi: 23,
  cableLossADb: 0.5,
  cableLossBDb: 0.5,
  rxSensitivityDbm: -80,
  heightAM: 10,
  heightBM: 10,
  kFactor: 4 / 3,
  terrainFactor: 1,
  marginDb: 0,
};

function buildProfile(samples: TerrainSample[], p: LinkParams, extraM = 0): ProfilePoint[] {
  const total = samples[samples.length - 1].d;
  const hA = samples[0].h + p.heightAM + extraM;
  const hB = samples[samples.length - 1].h + p.heightBM + extraM;
  return samples.map((s) => {
    const d1 = s.d;
    const d2 = total - s.d;
    const los = hA + ((hB - hA) * d1) / total;
    const ground = s.h + earthBulgeM(d1, d2, p.kFactor);
    const fresnel = fresnelRadiusM(d1, d2, p.freqMHz);
    const clearance = los - ground;
    const clearanceRatio = fresnel > 0 ? clearance / fresnel : clearance >= 0 ? Infinity : -Infinity;
    return { d: s.d, ground, los, fresnel, clearance, clearanceRatio };
  });
}

function worstPoint(profile: ProfilePoint[]): ProfilePoint {
  // Only interior points matter: both ends sit on the masts.
  const inner = profile.slice(1, -1);
  const pool = inner.length ? inner : profile;
  return pool.reduce((w, pt) => (pt.clearanceRatio < w.clearanceRatio ? pt : w), pool[0]);
}

/** Smallest uniform mast-height increase (m) giving TARGET_CLEARANCE everywhere, found by bisection. */
function extraHeightNeeded(samples: TerrainSample[], p: LinkParams): { m: number; reachable: boolean } {
  const ok = (extra: number) => worstPoint(buildProfile(samples, p, extra)).clearanceRatio >= TARGET_CLEARANCE;
  if (ok(0)) return { m: 0, reachable: true };
  const LIMIT = 200;
  if (!ok(LIMIT)) return { m: LIMIT, reachable: false };
  let lo = 0;
  let hi = LIMIT;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) hi = mid;
    else lo = mid;
  }
  return { m: Math.ceil(hi * 2) / 2, reachable: true };
}

export function analyzeLink(samples: TerrainSample[], p: LinkParams): LinkAnalysis {
  if (samples.length < 2) throw new Error('At least two terrain samples are required');
  const distanceKm = samples[samples.length - 1].d;
  const profile = buildProfile(samples, p);
  const worst = worstPoint(profile);

  const fsplDb = freeSpaceLossDb(distanceKm, p.freqMHz);
  const eirpDbm = p.txPowerDbm + p.gainADbi - p.cableLossADb;

  // Single worst obstruction treated as one knife edge (conservative for multi-peak paths).
  const diffractionDb =
    worst.clearance < worst.fresnel
      ? knifeEdgeLossDb(-worst.clearance, worst.d, distanceKm - worst.d, p.freqMHz)
      : 0;

  const rxLevelDbm = eirpDbm - fsplDb - diffractionDb - p.marginDb + p.gainBDbi - p.cableLossBDb;
  const fadeMarginDb = rxLevelDbm - p.rxSensitivityDbm;

  const blocked = worst.clearance < 0;
  const availability = blocked ? 0 : availabilityPct(distanceKm, p.freqMHz, fadeMarginDb, p.terrainFactor);

  let verdict: Verdict;
  if (blocked || fadeMarginDb <= 0) verdict = 'blocked';
  else if (worst.clearanceRatio < TARGET_CLEARANCE || fadeMarginDb < HEALTHY_FADE_MARGIN_DB) verdict = 'marginal';
  else verdict = 'good';

  const extra = extraHeightNeeded(samples, p);

  return {
    distanceKm,
    profile,
    fsplDb,
    eirpDbm,
    diffractionDb,
    rxLevelDbm,
    fadeMarginDb,
    availabilityPct: availability,
    minClearanceRatio: worst.clearanceRatio,
    worstAtKm: worst.d,
    extraHeightNeededM: extra.m,
    extraHeightReachable: extra.reachable,
    verdict,
    headline: buildHeadline(verdict, worst.clearanceRatio, fadeMarginDb, extra, worst.d, blocked),
  };
}

function buildHeadline(
  verdict: Verdict,
  ratio: number,
  fade: number,
  extra: { m: number; reachable: boolean },
  worstKm: number,
  blocked: boolean,
): string {
  if (verdict === 'good') return 'The path is clear and the link has a healthy fade margin.';
  const fix = extra.reachable
    ? `Raising both masts by about ${extra.m} m should clear it.`
    : 'Even 200 m masts do not clear it; pick different sites.';
  if (blocked) return `Terrain blocks the direct path near ${worstKm.toFixed(1)} km. ${fix}`;
  if (fade <= 0) {
    return 'The signal would arrive below the receiver sensitivity. Use higher-gain antennas, more power or a lower frequency.';
  }
  if (ratio < TARGET_CLEARANCE) return `The Fresnel zone is partly obstructed near ${worstKm.toFixed(1)} km. ${fix}`;
  return `The path is clear, but the fade margin is only ${fade.toFixed(0)} dB. Aim for ${HEALTHY_FADE_MARGIN_DB} dB or more.`;
}
