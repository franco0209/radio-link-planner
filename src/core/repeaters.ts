import { analyzeLink } from './analysis';
import { hopParams, seriesAvailabilityPct, worseVerdict } from './route';
import type { LinkParams, RepeaterSuggestion, TerrainSample, Verdict } from './types';

/** Repeater mast heights tried in order, m. The search stops at the lowest one that works. */
export const REPEATER_HEIGHT_LADDER = [10, 15, 20, 30, 45];
export const MAX_REPEATERS = 2;

export interface SuggestOptions {
  heightLadder?: number[];
  /** Minimum length of any hop, km. Keeps repeaters from landing on top of a site. */
  minHopKm?: number;
  maxResults?: number;
  /** Cap on thinned candidates when searching pairs (local peaks are always kept). */
  pairCandidates?: number;
}

interface HopEval {
  verdict: Verdict;
  availabilityPct: number;
  fadeDb: number;
  km: number;
}

interface Solution {
  idx: number[];
  height: number;
  verdict: Verdict;
  availabilityPct: number;
  minFadeDb: number;
  hopKm: number[];
}

/**
 * Suggest up to two repeater sites for a path that does not work.
 *
 * Candidates lie on the A-B line, so every hop is a slice of the terrain profile we already have
 * (no extra elevation requests). Ranking: fewest repeaters, then the lowest mast, then the highest
 * end-to-end availability, then the largest weakest-hop fade margin.
 * If nothing is fully viable, the best marginal option is returned; if nothing beats a blocked
 * path the result is empty.
 */
export function suggestRepeaters(direct: TerrainSample[], params: LinkParams, opts: SuggestOptions = {}): RepeaterSuggestion[] {
  const ladder = opts.heightLadder ?? REPEATER_HEIGHT_LADDER;
  const maxResults = opts.maxResults ?? 3;
  const n = direct.length;
  if (n < 5) return [];
  const total = direct[n - 1].d;
  const minHop = Math.max(opts.minHopKm ?? 0.25, 0);
  if (total < 2 * minHop) return [];

  const cands: number[] = [];
  for (let k = 1; k < n - 1; k++) if (direct[k].d >= minHop && total - direct[k].d >= minHop) cands.push(k);
  if (cands.length === 0) return [];

  const sliceCache = new Map<string, TerrainSample[]>();
  const slice = (i: number, j: number) => {
    const key = `${i}|${j}`;
    let s = sliceCache.get(key);
    if (!s) {
      const d0 = direct[i].d;
      s = direct.slice(i, j + 1).map((p) => ({ ...p, d: p.d - d0 }));
      sliceCache.set(key, s);
    }
    return s;
  };

  const memo = new Map<string, HopEval>();
  const hop = (i: number, j: number, hi: number, hj: number): HopEval => {
    const key = `${i}|${j}|${hi}|${hj}`;
    let r = memo.get(key);
    if (!r) {
      const a = analyzeLink(slice(i, j), hopParams(params, hi, hj), { heightSearch: false });
      r = { verdict: a.verdict, availabilityPct: a.availabilityPct, fadeDb: a.fadeMarginDb, km: a.distanceKm };
      memo.set(key, r);
    }
    return r;
  };

  const evaluate = (idx: number[], h: number): Solution => {
    const nodes = [0, ...idx, n - 1];
    const heights = [params.heightAM, ...idx.map(() => h), params.heightBM];
    const hops = nodes.slice(0, -1).map((from, k) => hop(from, nodes[k + 1], heights[k], heights[k + 1]));
    return {
      idx,
      height: h,
      verdict: hops.reduce<Verdict>((v, x) => worseVerdict(v, x.verdict), 'good'),
      availabilityPct: seriesAvailabilityPct(hops.map((x) => x.availabilityPct)),
      minFadeDb: Math.min(...hops.map((x) => x.fadeDb)),
      hopKm: hops.map((x) => x.km),
    };
  };

  const better = (x: Solution, y: Solution) => x.availabilityPct - y.availabilityPct || x.minFadeDb - y.minFadeDb;

  // Pair candidates: an even thinning plus the highest local peaks (a ridge top is the classic site).
  const pairCands = (() => {
    const cap = opts.pairCandidates ?? 90;
    if (cands.length <= cap) return cands;
    const step = Math.ceil(cands.length / (cap * 0.7));
    const keep = new Set(cands.filter((_, i) => i % step === 0));
    const peaks = cands
      .filter((k) => {
        const lo = Math.max(0, k - 3);
        const hi = Math.min(n - 1, k + 3);
        return direct.slice(lo, hi + 1).every((p) => p.h <= direct[k].h);
      })
      .sort((a, b) => direct[b].h - direct[a].h)
      .slice(0, Math.floor(cap * 0.3));
    peaks.forEach((k) => keep.add(k));
    return [...keep].sort((a, b) => a - b);
  })();

  const search = (count: 1 | 2, h: number): Solution[] => {
    const out: Solution[] = [];
    if (count === 1) {
      for (const c of cands) out.push(evaluate([c], h));
    } else {
      for (let x = 0; x < pairCands.length; x++) {
        for (let y = x + 1; y < pairCands.length; y++) {
          if (direct[pairCands[y]].d - direct[pairCands[x]].d < minHop) continue;
          out.push(evaluate([pairCands[x], pairCands[y]], h));
        }
      }
    }
    return out;
  };

  const toSuggestion = (s: Solution): RepeaterSuggestion => ({
    repeaters: s.idx.map((k) => ({
      lat: direct[k].lat,
      lng: direct[k].lng,
      heightM: s.height,
      atKm: direct[k].d,
      elevationM: direct[k].h,
    })),
    verdict: s.verdict,
    availabilityPct: s.availabilityPct,
    minFadeMarginDb: s.minFadeDb,
    hopKm: s.hopKm,
  });

  /** Best options, kept apart from each other so the user sees real alternatives, not neighbours. */
  const diverse = (sols: Solution[]): Solution[] => {
    const sorted = [...sols].sort((a, b) => better(b, a));
    const picked: Solution[] = [];
    const gap = total * 0.08;
    for (const s of sorted) {
      const clash = picked.some((p) => s.idx.every((k, i) => Math.abs(direct[k].d - direct[p.idx[i]].d) < gap));
      if (!clash) picked.push(s);
      if (picked.length >= maxResults) break;
    }
    return picked;
  };

  let fallback: Solution[] | null = null;
  for (const count of [1, 2] as const) {
    for (const h of ladder) {
      const sols = search(count, h);
      const good = sols.filter((s) => s.verdict === 'good');
      if (good.length) return diverse(good).map(toSuggestion);
      if (!fallback) {
        const marginal = sols.filter((s) => s.verdict === 'marginal');
        if (marginal.length) fallback = diverse(marginal);
      }
    }
  }
  return fallback ? fallback.map(toSuggestion) : [];
}
