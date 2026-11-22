import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';
import type { LatLng, Verdict } from '../core/types';
import { useI18n } from '../i18n';

interface MapViewProps {
  a: LatLng | null;
  b: LatLng | null;
  repeaters: LatLng[];
  /** Verdict of each hop, in route order (same length as repeaters + 1), or null before analysis. */
  hopVerdicts: Verdict[] | null;
  /** Ghost pins for the suggestion the user is looking at. */
  preview: LatLng[] | null;
  /** Point to highlight (synced with the profile chart hover). */
  hover: LatLng | null;
  placing: 'a' | 'b' | 'r' | null;
  /** Changing this value re-fits the map around every site. */
  fitKey: string;
  dark: boolean;
  onMapClick: (p: LatLng) => void;
  onDrag: (which: 'a' | 'b', p: LatLng) => void;
  onRepeaterDrag: (index: number, p: LatLng) => void;
}

const TILES = {
  streets: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  },
  terrain: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors, SRTM | &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    maxZoom: 17,
  },
} as const;

const LINE_COLOR: Record<Verdict, string> = { good: '#16a34a', marginal: '#d97706', blocked: '#dc2626' };

const pin = (label: string, cls: string) =>
  L.divIcon({
    className: '',
    html: `<div class="pin"><i class="${cls}"></i><b>${label}</b></div>`,
    iconSize: [34, 42],
    iconAnchor: [17, 40],
  });

export function MapView({
  a,
  b,
  repeaters,
  hopVerdicts,
  preview,
  hover,
  placing,
  fitKey,
  dark,
  onMapClick,
  onDrag,
  onRepeaterDrag,
}: MapViewProps) {
  const { t } = useI18n();
  const tRef = useRef(t);
  tRef.current = t;
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const tiles = useRef<L.TileLayer | null>(null);
  const markers = useRef<{ a?: L.Marker; b?: L.Marker }>({});
  const repMarkers = useRef<L.Marker[]>([]);
  const ghosts = useRef<L.Marker[]>([]);
  const lines = useRef<L.Polyline[]>([]);
  const hoverDot = useRef<L.CircleMarker | null>(null);
  const handlers = useRef({ onMapClick, onDrag, onRepeaterDrag });
  handlers.current = { onMapClick, onDrag, onRepeaterDrag };
  const [layer, setLayer] = useState<'streets' | 'terrain'>('streets');

  // Create the map once.
  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: false, worldCopyJump: true }).setView([-12.05, -77.04], 5);
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => handlers.current.onMapClick({ lat: e.latlng.lat, lng: e.latlng.lng }));
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      tiles.current = null;
      markers.current = {};
      repMarkers.current = [];
      ghosts.current = [];
      lines.current = [];
      hoverDot.current = null;
    };
  }, []);

  // Base layer follows the layer switch (dark mode is a CSS filter on streets).
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    tiles.current?.remove();
    const tl = TILES[layer];
    tiles.current = L.tileLayer(tl.url, { attribution: tl.attribution, maxZoom: tl.maxZoom }).addTo(m);
    tiles.current.bringToBack();
  }, [layer]);

  // Sites A and B.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    (['a', 'b'] as const).forEach((k) => {
      const p = k === 'a' ? a : b;
      const existing = markers.current[k];
      if (!p) {
        existing?.remove();
        delete markers.current[k];
        return;
      }
      if (existing) {
        existing.setLatLng([p.lat, p.lng]);
        return;
      }
      const mk = L.marker([p.lat, p.lng], {
        draggable: true,
        icon: pin(k.toUpperCase(), k === 'a' ? 'pin-a' : 'pin-b'),
        title: tRef.current.map.pinTitle(k.toUpperCase()),
        keyboard: true,
      }).addTo(m);
      mk.on('dragend', () => {
        const ll = mk.getLatLng();
        handlers.current.onDrag(k, { lat: ll.lat, lng: ll.lng });
      });
      markers.current[k] = mk;
    });
  }, [a, b]);

  // Repeaters: a dynamic list of draggable pins.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    while (repMarkers.current.length > repeaters.length) repMarkers.current.pop()?.remove();
    repeaters.forEach((p, i) => {
      const existing = repMarkers.current[i];
      if (existing) {
        existing.setLatLng([p.lat, p.lng]);
        return;
      }
      const mk = L.marker([p.lat, p.lng], {
        draggable: true,
        icon: pin(`R${i + 1}`, 'pin-r'),
        title: tRef.current.map.pinRepeaterTitle(i + 1),
        keyboard: true,
      }).addTo(m);
      mk.on('dragend', () => {
        const ll = mk.getLatLng();
        handlers.current.onRepeaterDrag(i, { lat: ll.lat, lng: ll.lng });
      });
      repMarkers.current[i] = mk;
    });
  }, [repeaters]);

  // Ghost pins for the suggestion being previewed.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    ghosts.current.forEach((g) => g.remove());
    ghosts.current = (preview ?? []).map((p, i) =>
      L.marker([p.lat, p.lng], { icon: pin(`R${i + 1}`, 'pin-r pin-ghost'), interactive: false, keyboard: false, zIndexOffset: -100 }).addTo(m),
    );
  }, [preview]);

  // Keep pin and zoom tooltips in the current language (runs after the markers exist).
  useEffect(() => {
    const root = el.current;
    root?.querySelector('.leaflet-control-zoom-in')?.setAttribute('title', t.map.zoomIn);
    root?.querySelector('.leaflet-control-zoom-in')?.setAttribute('aria-label', t.map.zoomIn);
    root?.querySelector('.leaflet-control-zoom-out')?.setAttribute('title', t.map.zoomOut);
    root?.querySelector('.leaflet-control-zoom-out')?.setAttribute('aria-label', t.map.zoomOut);
    (['a', 'b'] as const).forEach((k) => markers.current[k]?.getElement()?.setAttribute('title', t.map.pinTitle(k.toUpperCase())));
    repMarkers.current.forEach((mk, i) => mk.getElement()?.setAttribute('title', t.map.pinRepeaterTitle(i + 1)));
  }, [t, repeaters.length]);

  // One line per hop, coloured by that hop's own verdict.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    lines.current.forEach((l) => l.remove());
    lines.current = [];
    if (!a || !b) return;
    const nodes = [a, ...repeaters, b];
    const verdicts = hopVerdicts && hopVerdicts.length === nodes.length - 1 ? hopVerdicts : null;
    for (let i = 0; i < nodes.length - 1; i++) {
      lines.current.push(
        L.polyline(
          [
            [nodes[i].lat, nodes[i].lng],
            [nodes[i + 1].lat, nodes[i + 1].lng],
          ],
          {
            color: verdicts ? LINE_COLOR[verdicts[i]] : '#64748b',
            weight: 4,
            opacity: 0.9,
            dashArray: verdicts ? undefined : '8 8',
          },
        ).addTo(m),
      );
    }
  }, [a, b, repeaters, hopVerdicts]);

  // Hover marker from the chart.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!hover) {
      hoverDot.current?.remove();
      hoverDot.current = null;
      return;
    }
    if (!hoverDot.current) {
      hoverDot.current = L.circleMarker([hover.lat, hover.lng], {
        radius: 7,
        color: '#fff',
        weight: 3,
        fillColor: '#0f766e',
        fillOpacity: 1,
        interactive: false,
      }).addTo(m);
    } else {
      hoverDot.current.setLatLng([hover.lat, hover.lng]);
    }
  }, [hover]);

  // Fit around every site when asked.
  useEffect(() => {
    const m = map.current;
    if (!m || !a || !b) return;
    const pts = [a, ...repeaters, b].map((p) => [p.lat, p.lng] as [number, number]);
    m.fitBounds(L.latLngBounds(pts), { padding: [60, 60], maxZoom: 15 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  useEffect(() => {
    if (el.current) el.current.style.cursor = placing ? 'crosshair' : '';
  }, [placing]);

  const toast = placing === 'r' ? t.map.placeRepeaterToast : placing ? t.map.placeToast(placing.toUpperCase()) : null;

  return (
    <div className={`map-shell ${dark && layer === 'streets' ? 'map-dark' : ''}`}>
      <div ref={el} className="map" role="application" aria-label={t.map.label} />
      <div className="layer-switch" role="group" aria-label={t.map.style}>
        <button type="button" aria-pressed={layer === 'streets'} onClick={() => setLayer('streets')}>
          {t.map.streets}
        </button>
        <button type="button" aria-pressed={layer === 'terrain'} onClick={() => setLayer('terrain')}>
          {t.map.terrain}
        </button>
      </div>
      {toast && (
        <div className="map-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
