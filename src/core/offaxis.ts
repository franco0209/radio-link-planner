import { analyzeLink } from './analysis';
import { hopParams, seriesAvailabilityPct, worseVerdict } from './route';
import { REPEATER_HEIGHT_LADDER } from './repeaters';
import type { LatLng, LinkParams, RepeaterSuggestion, TerrainSample, Verdict } from './types';

/** Injected so the search stays pure and testable; the app wires them to the elevation service. */
export interface OffAxisDeps {
  /** Ground elevation (m) of each point, in order. */
  elevations: (points: LatLng[], signal?: AbortSignal) => Promise<number[]>;
  /** Terrain profile between two points, the same one manual placement would load. */
  profile: (a: LatLng, b: LatLng, signal?: AbortSignal) => Promise<TerrainSample[]>;
}

export interface OffAxisOptions {
  heightLadder?: number[];
  minHopKm?: number;
  maxResults?: number;
  /** Ellipse slack: a site must satisfy |AR| + |RB| <= (1 + epsilon) * |AB|. */
  epsilon?: number;
  /** Hard cap on the lateral distance from the A-B line, as a fraction of |AB|. */
  maxLateralFrac?: number;
  /** How many pre-scored sites get their real terrain fetched (the expensive step). */
  finalists?: number;
  cols?: number;
  rows?: number;
}

const KM_PER_DEG = 111.195;
const RANK: Record<Verdict, number> = { good: 0, marginal: 1, blocked: 2 };

/** Local flat frame: u along A->B, v to its left, both in km. Accurate to well under a hop's own error at these scales. */
export interface Frame {
  toLatLng: (u: number, v: number) => LatLng;
  lengthKm: number;
}

export function makeFrame(a: LatLng, b: LatLng): Frame {
  const k = Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  const dx = (b.lng - a.lng) * k * KM_PER_DEG;
  const dy = (b.lat - a.lat) * KM_PER_DEG;
  const len = Math.hypot(dx, dy) || 1e-9;
  const ex = dx / len;
  const ey = dy / len;
  return {
    lengthKm: len,
    toLatLng: (u, v) => ({
      lat: a.lat + (u * ey + v * ex) / KM_PER_DEG,
      lng: a.lng + (u * ex - v * ey) / (KM_PER_DEG * k),
    }),
  };
}

export interface Grid {
  frame: Frame;
  cols: number;
  rows: number;
  /** Half-width of the corridor, km. */
  halfWidthKm: number;
  /** Row-major: index = row * cols + col; u grows with col, v grows with row from -halfWidth. */
  points: LatLng[];
}

/** A regular grid over the corridor around A-B. A and B are grid nodes (column 0 and last, middle row). */
export function buildGrid(a: LatLng, b: LatLng, opts: OffAxisOptions = {}): Grid {
  const frame = makeFrame(a, b);
  const cols = opts.cols ?? 20;
  const rows = (opts.rows ?? 9) | 1; // odd, so the A-B line is a row
  const halfWidthKm = frame.lengthKm * (opts.maxLateralFrac ?? 0.2);
  const points: LatLng[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const u = (frame.lengthKm * c) / (cols - 1);
      const v = -halfWidthKm + (2 * halfWidthKm * r) / (rows - 1);
      points.push(frame.toLatLng(u, v));
    }
  }
  return { frame, cols, rows, halfWidthKm, points };
}

interface Candidate {
  u: number;
  v: number;
  row: number;
  col: number;
  at: LatLng;
}

/** Grid nodes off the A-B line that are inside the ellipse and far enough from both ends. */
function candidatesOf(grid: Grid, epsilon: number, minHop: number): Candidate[] {
  const { frame, cols, rows, halfWidthKm, points } = grid;
  const D = frame.lengthKm;
  const mid = (rows - 1) / 2;
  const out: Candidate[] = [];
  for (let r = 0; r < rows; r++) {
    if (r === mid) continue; // the line itself was already searched exactly
    for (let c = 1; c < cols - 1; c++) {
      const u = (D * c) / (cols - 1);
      const v = -halfWidthKm + (2 * halfWidthKm * r) / (rows - 1);
      const dA = Math.hypot(u, v);
      const dB = Math.hypot(D - u, v);
      if (dA < minHop || dB < minHop || dA + dB > (1 + epsilon) * D) continue;
      out.push({ u, v, row: r, col: c, at: points[r * cols + c] });
    }
  }
  return out;
}

/** Bilinear ground elevation at (u, v) from the coarse grid. */
function elevationAt(grid: Grid, h: number[], u: number, v: number): number {
  const { cols, rows, halfWidthKm, frame } = grid;
  const fc = Math.min(cols - 1, Math.max(0, (u / frame.lengthKm) * (cols - 1)));
  const fr = Math.min(rows - 1, Math.max(0, ((v + halfWidthKm) / (2 * halfWidthKm)) * (rows - 1)));
  const c0 = Math.min(cols - 2, Math.floor(fc));
  const r0 = Math.min(rows - 2, Math.floor(fr));
  const tc = fc - c0;
  const tr = fr - r0;
  const at = (r: number, c: number) => h[r * cols + c];
  return (
    at(r0, c0) * (1 - tc) * (1 - tr) + at(r0, c0 + 1) * tc * (1 - tr) + at(r0 + 1, c0) * (1 - tc) * tr + at(r0 + 1, c0 + 1) * tc * tr
  );
}

/** Rough terrain from the coarse grid. Only used to rank sites; never shown or applied. */
function coarseHop(grid: Grid, h: number[], from: { u: number; v: number }, to: { u: number; v: number }): TerrainSample[] {
  const len = Math.hypot(to.u - from.u, to.v - from.v);
  const n = Math.min(40, Math.max(8, Math.ceil(len / 0.5)));
  return Array.from({ length: n }, (_, i) => {
    const f = i / (n - 1);
    const u = from.u + (to.u - from.u) * f;
    const v = from.v + (to.v - from.v) * f;
    const p = grid.frame.toLatLng(u, v);
    return { d: len * f, h: elevationAt(grid, h, u, v), lat: p.lat, lng: p.lng };
  });
}

interface Scored {
  verdict: Verdict;
  availabilityPct: number;
  minFadeDb: number;
  height: number;
  hopKm: number[];
}

/** Best mast height for a route made of the given hop terrains: the lowest that works, else the best partial. */
function bestHeight(hops: TerrainSample[][], params: LinkParams, ladder: number[]): Scored {
  let marginal: Scored | null = null;
  let best: Scored | null = null;
  for (const height of ladder) {
    const ends = [params.heightAM, height, params.heightBM];
    const res = hops.map((s, i) => analyzeLink(s, hopParams(params, ends[i], ends[i + 1]), { heightSearch: false }));
    const scored: Scored = {
      verdict: res.reduce<Verdict>((v, x) => worseVerdict(v, x.verdict), 'good'),
      availabilityPct: seriesAvailabilityPct(res.map((x) => x.availabilityPct)),
      minFadeDb: Math.min(...res.map((x) => x.fadeMarginDb)),
      height,
      hopKm: res.map((x) => x.distanceKm),
    };
    if (scored.verdict === 'good') return scored;
    if (scored.verdict === 'marginal' && !marginal) marginal = scored;
    if (!best || scored.availabilityPct > best.availabilityPct) best = scored;
  }
  return marginal ?? (best as Scored);
}

/** Order: better verdict first, then the lower mast, then availability, then the weakest margin. */
const compare = (x: Scored, y: Scored) =>
  RANK[x.verdict] - RANK[y.verdict] || x.height - y.height || y.availabilityPct - x.availabilityPct || y.minFadeDb - x.minFadeDb;

/** One viable repeater on the line cannot be beaten on count, so only then is the off-line search skipped. */
export function needsOffAxis(onLine: RepeaterSuggestion[]): boolean {
  return !(onLine.length > 0 && onLine[0].verdict === 'good' && onLine[0].repeaters.length === 1);
}

/** Merge on-line and off-line options: viable first, then fewest repeaters, lowest mast, availability, weakest margin. */
export function mergeSuggestions(a: RepeaterSuggestion[], b: RepeaterSuggestion[], maxResults = 3): RepeaterSuggestion[] {
  return [...a, ...b]
    .sort(
      (x, y) =>
        RANK[x.verdict] - RANK[y.verdict] ||
        x.repeaters.length - y.repeaters.length ||
        x.repeaters[0].heightM - y.repeaters[0].heightM ||
        y.availabilityPct - x.availabilityPct ||
        y.minFadeMarginDb - x.minFadeMarginDb,
    )
    .slice(0, maxResults);
}

export interface OffAxisResult {
  suggestions: RepeaterSuggestion[];
  /** How many sites had their real terrain fetched (the expensive step). */
  verified: number;
}

/**
 * Look for ONE repeater off the A-B line. A heuristic funnel, built around network cost:
 *   1. a coarse grid over an ellipse-shaped corridor (|AR| + |RB| <= (1 + epsilon) |AB|) is fetched in a couple of requests;
 *   2. every grid node is pre-scored on rough terrain interpolated from that grid, with no network;
 *   3. only the best few, spread apart, get their real terrain fetched and are scored for real.
 * Not exhaustive: a narrow peak between grid nodes can be missed, and nothing here is guaranteed optimal.
 */
export async function suggestOffAxis(
  a: LatLng,
  b: LatLng,
  params: LinkParams,
  deps: OffAxisDeps,
  opts: OffAxisOptions = {},
  signal?: AbortSignal,
): Promise<OffAxisResult> {
  const ladder = opts.heightLadder ?? REPEATER_HEIGHT_LADDER;
  const maxResults = opts.maxResults ?? 3;
  const finalists = opts.finalists ?? 5;
  const minHop = Math.max(opts.minHopKm ?? 0.25, 0);
  const none: OffAxisResult = { suggestions: [], verified: 0 };

  const grid = buildGrid(a, b, opts);
  if (grid.frame.lengthKm < 2 * minHop) return none;
  const cands = candidatesOf(grid, opts.epsilon ?? 0.15, minHop);
  if (cands.length === 0) return none;

  const h = await deps.elevations(grid.points, signal);
  if (h.length !== grid.points.length) return none;
  const D = grid.frame.lengthKm;
  const A = { u: 0, v: 0 };
  const B = { u: D, v: 0 };

  // Pre-score with rough terrain.
  const ranked = cands
    .map((c) => {
      const hops = [coarseHop(grid, h, A, c), coarseHop(grid, h, c, B)];
      return { c, s: bestHeight(hops, params, ladder) };
    })
    .sort((x, y) => compare(x.s, y.s));

  // Keep the finalists apart, so they are real alternatives and not neighbouring cells.
  const gap = D * 0.08;
  const picked: typeof ranked = [];
  for (const r of ranked) {
    if (picked.length >= finalists) break;
    if (picked.every((p) => Math.hypot(p.c.u - r.c.u, p.c.v - r.c.v) >= gap)) picked.push(r);
  }

  // Real terrain, one site at a time (each costs a few requests), best first. Stop once there are enough good ones.
  const real: { c: Candidate; at: LatLng; s: Scored; hops: TerrainSample[][] }[] = [];
  let verified = 0;
  for (const { c } of picked) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (real.filter((r) => r.s.verdict === 'good').length >= maxResults) break;
    const at = { lat: Number(c.at.lat.toFixed(5)), lng: Number(c.at.lng.toFixed(5)) };
    const first = await deps.profile(a, at, signal);
    const second = await deps.profile(at, b, signal);
    verified++;
    const hops = [first, second];
    real.push({ c, at, s: bestHeight(hops, params, ladder), hops });
  }

  const usable = real.filter((r) => r.s.verdict !== 'blocked').sort((x, y) => compare(x.s, y.s));
  const goods = usable.filter((r) => r.s.verdict === 'good');
  const chosen = (goods.length ? goods : usable).slice(0, maxResults);

  const suggestions: RepeaterSuggestion[] = chosen.map(({ c, at, s, hops }) => {
    const ground = hops[0][hops[0].length - 1].h;
    return {
      repeaters: [{ ...at, heightM: s.height, atKm: Math.max(0, c.u), offKm: Math.abs(c.v), elevationM: ground }],
      verdict: s.verdict,
      availabilityPct: s.availabilityPct,
      minFadeMarginDb: s.minFadeDb,
      hopKm: s.hopKm,
      hopTerrain: hops,
    };
  });
  return { suggestions, verified };
}
