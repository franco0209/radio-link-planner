# Methodology

All formulas live in `src/core` and are covered by unit tests (`npm test`).
Distances are in km, frequency in MHz, heights in metres unless stated.

## 1. Path and terrain

The great-circle path between A and B is sampled every ~120 m (30 to 400 samples). Ground elevation at each sample comes from the Copernicus 90 m DEM served by Open-Meteo. Elevations are bare-earth: **buildings and trees are not included**, so urban and forested paths need extra clearance on top of what the tool shows.

## 2. Earth curvature

Radio waves bend slightly in the atmosphere, so the path is drawn on an effective earth radius `k · R`, with `k = 4/3` for a standard atmosphere. The bulge at a point d1 km from A and d2 km from B is:

```
bulge = d1 · d2 / (12.74 · k)   [m]
```

It is added to the terrain, so what you see is what the radio sees.

## 3. Fresnel zone

The first Fresnel zone radius at that point is:

```
r1 = 17.32 · sqrt( d1 · d2 / (f_GHz · (d1 + d2)) )   [m]
```

Common practice asks for at least **60 % of r1 free of obstacles** (the dark core in the chart). That is the pass mark used for the verdict.

## 4. Link budget

```
EIRP      = Ptx + Gtx − Ltx
FSPL      = 32.44 + 20·log10(d) + 20·log10(f)
Prx       = EIRP − FSPL − Ldiffraction − Lextra + Grx − Lrx
FadeMargin = Prx − RxSensitivity
```

A fade margin of **15 dB or more** is treated as healthy; below that, the link is marked marginal.

## 5. Obstruction (diffraction) loss

The point with the lowest clearance ratio is treated as a single knife-edge obstacle. With `h` the height of the obstacle above the direct ray and `λ` the wavelength:

```
v = h · sqrt( 2 (d1 + d2) / (λ · d1 · d2) )
J(v) = 6.9 + 20·log10( sqrt((v − 0.1)² + 1) + v − 0.1 )   for v > −0.78, else 0
```

(ITU-R P.526 approximation.) For paths with several peaks this is **conservative-to-approximate**; it is not a full Deygout or Epstein-Peterson multi-edge model.

## 6. Availability

Yearly availability uses the Vigants-Barnett multipath model:

```
P_outage ≈ 6.0e-7 · C · f_GHz · d³ · 10^(−FadeMargin / 10)
```

with terrain factor `C` = 4 (smooth or over water), 1 (average), 0.25 (mountainous or dry). A blocked path reports 0 %.

## 7. "Raise both masts by X m"

A bisection search finds the smallest uniform height increase (up to 200 m) at which the worst clearance reaches 60 % of the first Fresnel radius. The test suite verifies that applying the suggested increase really fixes the path.

## 8. Repeaters and multi-hop routes

A route is `A → R1 → R2 → B` with at most two repeaters. Each hop gets its own terrain profile and is analysed exactly like a single link.

**Assumptions**

- Every hop uses the global radio settings: TX gain = *Antenna gain A*, RX gain = *Antenna gain B*, same power, frequency and sensitivity.
- Repeaters are **active** (receive on one hop, retransmit on the next) and each hop is assumed to use a **different channel**, so self-interference and co-channel effects are not modelled.
- Each repeater has its own mast height (default 15 m).
- **Route verdict** = the worst hop. The headline is that hop's explanation, prefixed with its name (for example "A → R1").
- **End-to-end availability** = the product of the hop availabilities, because the hops are in series. This assumes fading on different hops is independent, which is optimistic for hops that share weather.
- The chart's horizontal axis is **distance along the path**. With repeaters off the A–B line this is longer than the straight line, and the "Total distance" metric says so.
- With two manual repeaters, the order is the one that gives the **shorter total path**, so it does not flip when you drag a repeater off-axis.

**Suggestions**

The suggestion search never calls the elevation service. Candidates lie on the A–B line, so every hop is a slice of the terrain profile already loaded, re-based so each hop starts at distance 0. That lets the same `analyzeLink` code compute earth bulge, Fresnel radius, diffraction and fade margin for each hop.

1. Try **1 repeater** at every interior sample (keeping a minimum hop length). Try **2 repeaters** only if no 1-repeater option is fully viable. Two are never offered when one is enough.
2. For each count, try repeater mast heights from a ladder (10, 15, 20, 30, 45 m) and **stop at the lowest height that works**.
3. "Works" means every hop is *viable* (60 % Fresnel clearance and 15 dB fade margin).
4. Rank by end-to-end availability, then by the weakest-hop fade margin, and return up to three options kept at least 8 % of the path apart.
5. If nothing is fully viable, the best *marginal* options are returned and labelled as partial improvements. If nothing beats a blocked path, the tool says so and points to manual placement.
6. For pairs, candidates are an even thinning plus the highest local peaks, so a narrow ridge top is not skipped.

**Where the elevations come from.** If every point of a profile lies inside the bundled Copernicus tiles, elevations are read locally (bilinear, pixel values at pixel centres) with no network. Otherwise the whole request goes to the Open-Meteo elevation service, which serves the same dataset; a profile is never stitched from both. Inside the bundled area the off-line search therefore costs no API requests at all. Bilinear sampling differs slightly from the service's own; on four points around Arequipa the two agree within a few tens of metres, comparable to the DEM's own vertical error. At a tile seam the interpolation clamps to the edge pixel instead of reading the neighbouring tile.

**Paradigm**

- **On the line:** exhaustive search (brute force) over a bounded candidate set, with iterative deepening and memoisation. Not greedy, not divide and conquer, not a metaheuristic.
- **Off the line:** a heuristic filter-and-refine funnel (corridor, coarse grid, network-free pre-score, verification of a few finalists on real terrain).

**Complexity and exactness**

Let `n` be the number of samples (at most 400), `C ≤ n` the candidate sites, `P ≤ 90` the candidates used for pairs and `H = 5` the mast heights. Scoring one hop is `O(n)`: the mast-height bisection is switched off inside the loop because it costs about 30 times more.

- One repeater: `O(H · C · n)`, which is `O(H · n²)`.
- Two repeaters: `O(H · P² · n)`. The hop from A and the hop to B are memoised per `(slice, mast heights)`, so each pair adds only one new `O(n)` hop. Without the cap on `P` this would be `O(H · n³)`.
- Because the search deepens by repeater count and mast height and stops at the first viable layer, the common case is far cheaper than the worst case.
- It is **not** a metaheuristic: it is deterministic and exhaustive over the candidate set. It is optimal for one repeater, and for two when `C ≤ P`. Above that the candidate set is pruned by thinning plus local peaks, never the scoring. The test suite checks both claims against an independent brute force.

The same problem can be written as a graph (sites are nodes, viable hops are edges weighted `−ln(availability)`), where "at most k repeaters" is a hop-limited shortest path. That would avoid the exponential growth in `k` and is the planned route to more than two repeaters.

Applying a suggestion reuses the exact terrain it was scored on, so the result you see matches the card you clicked.

**Search off the A–B line**

Hilltops beside the line are often better than anything on it, but each site off the line needs two new terrain profiles from the elevation service (up to about 8 requests for a long link), and that service rate-limits. So the search is a funnel built to fetch as little as possible, and it is a **heuristic**:

1. The line search above runs first and costs nothing. The off-line search starts only if it did not find a single viable repeater.
2. **Corridor.** A site R is allowed if `|AR| + |RB| ≤ 1.15 · |AB|` (an ellipse with A and B as foci, so it narrows towards the ends) and it is at most 20 % of `|AB|` away from the line.
3. **Coarse grid.** A 20 × 9 grid over that corridor (180 points, two elevation requests) is fetched. A and B are grid nodes.
4. **Pre-score, no network.** Every grid node off the line is scored with rough terrain interpolated bilinearly from the grid, using the same `analyzeLink` and mast ladder.
5. **Finalists.** The best 5 sites, kept at least 8 % of `|AB|` apart, get their *real* terrain fetched with the same loader manual placement uses, one site at a time and best first. Fetching stops as soon as 3 viable sites are confirmed. Only these real profiles decide the verdict and are applied.
6. One off-line repeater is compared with the line results by the usual rule (viable first, fewest repeaters, lowest mast, availability), so a single off-line site can outrank two on the line.

Cost: 2 elevation requests plus roughly 2 to 8 per finalist, so typically 10 to 25 in total and never the hundreds a one-by-one search would need. Computation is `O(cols · rows · n)` and negligible next to the network.

It is **not exact**: a narrow peak between grid nodes can be missed, a site that looks poor on rough terrain is never verified, and two repeaters off the line are not searched. It never reports a site it did not verify on real terrain. The test suite uses a mocked elevation service to check that it finds a gap around walls no on-line site can clear, that it returns the terrain it scored on, and that the request count stays bounded.

The suggest button appears only when the direct link is **blocked** and no repeaters are set. Marginal links do not get it: raising the masts or adjusting the radio comes first.

## Known limits

- Off-line suggestions are limited to **one** repeater, inside a corridor around the line, and found by a heuristic (see above). For two off-line repeaters or a peak outside the corridor, place them by hand.
- When you add repeaters yourself, the tool analyses the route you drew but does not propose a better one.

- No rain fading, atmospheric absorption or foliage model (use *Extra losses* to account for them).
- Bare-earth terrain only; clutter is not modelled.
- Vigants-Barnett is a rough indicator for clear line-of-sight paths. Real availability depends on climate, equipment and interference.
- The DEM resolution (~90 m) can miss narrow ridges and steep cliffs.
- Beyond roughly 100 km, k-factor variation matters more than the defaults assume.

These are the right places to improve the tool; see the roadmap in the README.
