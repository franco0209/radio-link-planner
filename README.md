# Radio Link Planner

A modern, accurate point-to-point radio link planner that runs in the browser.
Drop two sites on a map and see, in seconds, whether a wireless link will work: terrain profile, Fresnel zone, link budget and estimated availability, explained in plain language.

> Most online link calculators are dated, cramped and hard to trust. This one aims to be the opposite: clear, fast, and honest about its assumptions.

## Project status

In active development since **October 2026**: about a month of research on propagation models, terrain data and UX, followed by this first working version. The roadmap below shows what is next.

## Features

- **Map first.** Place sites A and B by clicking, dragging pins, searching a place name or pasting `lat, lng`. Street and topographic map styles.
- **Real terrain.** Elevation profile from the Copernicus 90 m DEM (via Open-Meteo), sampled about every 120 m.
- **Fresnel zone and earth curvature.** The profile shows terrain with earth bulge (configurable k-factor), the line of sight and the first Fresnel zone, with the 60 % core highlighted.
- **Plain-language verdict.** *Viable*, *Marginal* or *Will not work*, with the reason and the fix. Never colour alone: every state has an icon and a label.
- **"How high do I need to build?"** Finds the smallest equal mast-height increase that reaches 60 % Fresnel clearance, applied with one click.
- **Link budget.** EIRP, free-space loss, diffraction loss from the worst obstruction, received level, fade margin and yearly availability (Vigants-Barnett).
- **Linked chart and map.** Hover (or use the arrow keys on) the profile and the exact spot lights up on the map.
- **Shareable.** The whole scenario lives in the URL. Copy the link, bookmark it, or print a one-page PDF report.
- **Three languages.** English, Español and Português, detected from the browser and switchable from the header. Text in the core is never hard-coded: results are structured and phrased by the UI.
- **Accessible and responsive.** Keyboard operable, labelled controls, light and dark themes, works on phones.

## How it computes

| Quantity | Method |
|---|---|
| Distance, path sampling | Haversine and great-circle interpolation |
| Free-space path loss | `32.44 + 20·log10(d km) + 20·log10(f MHz)` |
| Fresnel radius | `17.32 · sqrt(d1·d2 / (f GHz · d))` |
| Earth bulge | `d1·d2 / (12.74·k)` with k = 4/3 by default |
| Obstruction loss | Single knife edge, ITU-R P.526 approximation, using the worst point |
| Availability | Vigants-Barnett multipath model with terrain factor |

Details, assumptions and limits are in [docs/METHODOLOGY.md](docs/METHODOLOGY.md).

**This is a planning aid, not a survey.** Always verify a link on site before buying hardware.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests for the calculation core
npm run build    # production build in dist/
```

The scenario is stored in the URL hash, for example:
`#a=-16.39890,-71.53500&b=-16.40200,-71.40100&heightAM=60&heightBM=60`

## Project layout

```
src/
  core/         Pure TypeScript radio maths (no UI, fully unit-tested)
  services/     Elevation and place-search clients
  state/        URL (de)serialisation
  i18n/         English / Spanish / Portuguese dictionaries (typed against English)
  components/   Map, profile chart, results, forms
```

Adding a language means adding one file typed as `Dict`: the compiler lists every missing string.

The calculation core has no dependency on React or the DOM, so it can be reused in a CLI, an API or a future mobile app.

## Tech

React 19, TypeScript, Vite, Leaflet, Vitest. The chart is hand-written SVG, so there is no charting dependency.

## Roadmap

- [ ] Multiple hops and repeaters
- [ ] Equipment library with real radio datasheets
- [ ] Rain fading for licensed bands (ITU-R P.838 / P.530)
- [ ] Obstruction heights from building and tree layers
- [ ] Export KML for Google Earth
- [ ] Offline mode with cached tiles and terrain

## Data and attribution

Terrain: Copernicus DEM GLO-90 through [Open-Meteo](https://open-meteo.com/). Maps: © OpenStreetMap contributors and OpenTopoMap (CC-BY-SA). Place search: Nominatim. Please respect their usage policies if you deploy this publicly.

## License

MIT
