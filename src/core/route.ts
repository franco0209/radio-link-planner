import { analyzeLink, type AnalyzeOptions } from './analysis';
import { distanceKm } from './geo';
import type { LatLng, LinkAnalysis, LinkParams, RouteAnalysis, TerrainSample, Verdict } from './types';

const RANK: Record<Verdict, number> = { good: 0, marginal: 1, blocked: 2 };

export const worseVerdict = (a: Verdict, b: Verdict): Verdict => (RANK[a] >= RANK[b] ? a : b);

/** Radio parameters for one hop: the masts at its two ends. TX gain = gainA, RX gain = gainB on every hop. */
export function hopParams(p: LinkParams, heightFromM: number, heightToM: number): LinkParams {
  return { ...p, heightAM: heightFromM, heightBM: heightToM };
}

/** Availability of hops in series, in %. Assumes fading on different hops is independent. */
export function seriesAvailabilityPct(hopPct: number[]): number {
  return hopPct.reduce((acc, pct) => acc * (pct / 100), 1) * 100;
}

/**
 * Analyse a route made of consecutive hops.
 * @param hops     terrain samples of each hop (distance restarts at 0 on every hop)
 * @param heights  mast height at every node: A, repeaters in order, B (so hops.length + 1 values)
 */
export function analyzeRoute(
  hops: TerrainSample[][],
  params: LinkParams,
  heights: number[],
  opts?: AnalyzeOptions,
): RouteAnalysis {
  if (hops.length < 1 || heights.length !== hops.length + 1) throw new Error('heights must have hops.length + 1 entries');
  const results: LinkAnalysis[] = hops.map((samples, i) => analyzeLink(samples, hopParams(params, heights[i], heights[i + 1]), opts));

  let weakest = 0;
  results.forEach((r, i) => {
    const w = results[weakest];
    if (RANK[r.verdict] > RANK[w.verdict] || (r.verdict === w.verdict && r.fadeMarginDb < w.fadeMarginDb)) weakest = i;
  });

  return {
    hops: results,
    totalKm: results.reduce((s, r) => s + r.distanceKm, 0),
    verdict: results.reduce<Verdict>((v, r) => worseVerdict(v, r.verdict), 'good'),
    availabilityPct: seriesAvailabilityPct(results.map((r) => r.availabilityPct)),
    weakestHop: weakest,
    minFadeMarginDb: Math.min(...results.map((r) => r.fadeMarginDb)),
    minClearanceRatio: Math.min(...results.map((r) => r.minClearanceRatio)),
  };
}

/**
 * Put repeaters in route order. With two of them, choose the order giving the shorter total path,
 * which stays stable when a repeater is dragged off the A-B axis (unlike sorting by distance from A).
 */
export function orderRepeaters<T extends LatLng>(a: LatLng, b: LatLng, reps: T[]): T[] {
  if (reps.length < 2) return reps;
  const [r1, r2] = reps;
  const forward = distanceKm(a, r1) + distanceKm(r1, r2) + distanceKm(r2, b);
  const swapped = distanceKm(a, r2) + distanceKm(r2, r1) + distanceKm(r1, b);
  return swapped < forward ? [r2, r1] : [r1, r2];
}
