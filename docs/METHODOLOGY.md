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

## Known limits

- No rain fading, atmospheric absorption or foliage model (use *Extra losses* to account for them).
- Bare-earth terrain only; clutter is not modelled.
- Vigants-Barnett is a rough indicator for clear line-of-sight paths. Real availability depends on climate, equipment and interference.
- The DEM resolution (~90 m) can miss narrow ridges and steep cliffs.
- Beyond roughly 100 km, k-factor variation matters more than the defaults assume.

These are the right places to improve the tool; see the roadmap in the README.
