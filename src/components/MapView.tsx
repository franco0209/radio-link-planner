import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';
import type { LatLng, Verdict } from '../core/types';
import { useI18n } from '../i18n';

interface MapViewProps {
  a: LatLng | null;
  b: LatLng | null;
  verdict: Verdict | null;
  /** Point to highlight (synced with the profile chart hover). */
  hover: LatLng | null;
  placing: 'a' | 'b' | null;
  /** Changing this value re-fits the map around both sites. */
  fitKey: string;
  dark: boolean;
  onMapClick: (p: LatLng) => void;
  onDrag: (which: 'a' | 'b', p: LatLng) => void;
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

const pin = (letter: string, cls: string) =>
  L.divIcon({
    className: '',
    html: `<div class="pin"><i class="${cls}"></i><b>${letter}</b></div>`,
    iconSize: [34, 42],
    iconAnchor: [17, 40],
  });

export function MapView({ a, b, verdict, hover, placing, fitKey, dark, onMapClick, onDrag }: MapViewProps) {
  const { t } = useI18n();
  const tRef = useRef(t);
  tRef.current = t;
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const tiles = useRef<L.TileLayer | null>(null);
  const markers = useRef<{ a?: L.Marker; b?: L.Marker }>({});
  const line = useRef<L.Polyline | null>(null);
  const hoverDot = useRef<L.CircleMarker | null>(null);
  const handlers = useRef({ onMapClick, onDrag });
  handlers.current = { onMapClick, onDrag };
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
      line.current = null;
      hoverDot.current = null;
    };
  }, []);

  // Base layer follows the theme and the layer switch.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    tiles.current?.remove();
    const t = TILES[layer];
    tiles.current = L.tileLayer(t.url, { attribution: t.attribution, maxZoom: t.maxZoom }).addTo(m);
    tiles.current.bringToBack();
  }, [layer]);

  // Keep pin tooltips in the current language.
  useEffect(() => {
    (['a', 'b'] as const).forEach((k) => markers.current[k]?.getElement()?.setAttribute('title', t.map.pinTitle(k.toUpperCase())));
  }, [t]);

  // Markers.
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

  // Link line, coloured by verdict.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    line.current?.remove();
    line.current = null;
    if (a && b) {
      line.current = L.polyline(
        [
          [a.lat, a.lng],
          [b.lat, b.lng],
        ],
        { color: verdict ? LINE_COLOR[verdict] : '#64748b', weight: 4, opacity: 0.9, dashArray: verdict ? undefined : '8 8' },
      ).addTo(m);
    }
  }, [a, b, verdict]);

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

  // Fit when asked.
  useEffect(() => {
    const m = map.current;
    if (!m || !a || !b) return;
    m.fitBounds(
      L.latLngBounds([a.lat, a.lng], [b.lat, b.lng]),
      { padding: [60, 60], maxZoom: 15 },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  useEffect(() => {
    if (el.current) el.current.style.cursor = placing ? 'crosshair' : '';
  }, [placing]);

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
      {placing && (
        <div className="map-toast" role="status">
          {t.map.placeToast(placing.toUpperCase())}
        </div>
      )}
    </div>
  );
}
