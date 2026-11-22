import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RouteAnalysis, TerrainSample } from '../core/types';
import { useI18n } from '../i18n';

export interface HoverPos {
  hop: number;
  i: number;
}

interface ProfileChartProps {
  route: RouteAnalysis;
  hopSamples: TerrainSample[][];
  /** Node names in route order: A, R1, R2, B. */
  names: string[];
  /** Mast height at every node, m. */
  heights: number[];
  hover: HoverPos | null;
  onHover: (pos: HoverPos | null) => void;
}

const HEIGHT = 280;
const M = { top: 20, right: 18, bottom: 32, left: 52 };

function niceTicks(min: number, max: number, target: number): number[] {
  const span = max - min || 1;
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const first = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = first; v <= max + 1e-9; v += step) ticks.push(Number(v.toFixed(6)));
  return ticks;
}

export function ProfileChart({ route, hopSamples, names, heights, hover, onHover }: ProfileChartProps) {
  const { t } = useI18n();
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);

  useLayoutEffect(() => {
    const node = wrap.current;
    if (!node) return;
    const measure = () => setWidth(Math.max(320, Math.floor(node.getBoundingClientRect().width)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  const totalKm = route.totalKm;
  const multi = route.hops.length > 1;

  /** Distance along the path where each hop starts. */
  const offsets = useMemo(() => {
    const out: number[] = [];
    let acc = 0;
    for (const h of route.hops) {
      out.push(acc);
      acc += h.distanceKm;
    }
    return out;
  }, [route]);

  const geom = useMemo(() => {
    let yMinRaw = Infinity;
    let yMaxRaw = -Infinity;
    for (const h of route.hops) {
      h.profile.forEach((p, i) => {
        yMinRaw = Math.min(yMinRaw, p.ground);
        yMaxRaw = Math.max(yMaxRaw, p.ground, p.los + p.fresnel);
        if (i > 0 && i < h.profile.length - 1) yMinRaw = Math.min(yMinRaw, p.los - p.fresnel);
      });
    }
    const pad = Math.max(5, (yMaxRaw - yMinRaw) * 0.08);
    const yMin = Math.floor((yMinRaw - pad) / 5) * 5;
    const yMax = Math.ceil((yMaxRaw + pad) / 5) * 5;
    const innerW = width - M.left - M.right;
    const innerH = HEIGHT - M.top - M.bottom;
    const x = (d: number) => M.left + (d / totalKm) * innerW;
    const y = (h: number) => M.top + (1 - (h - yMin) / (yMax - yMin)) * innerH;
    return { x, y, yMin, yMax };
  }, [route, width, totalKm]);

  const { x, y, yMin, yMax } = geom;
  const f = (n: number) => n.toFixed(1);
  const base = y(yMin);

  const hopPaths = route.hops.map((h, k) => {
    const off = offsets[k];
    const pts = h.profile;
    const line = (val: (i: number) => number) => pts.map((p, i) => `${i ? 'L' : 'M'}${f(x(off + p.d))},${f(y(val(i)))}`).join('');
    const ground = line((i) => pts[i].ground);
    const band = (kk: number) => {
      const up = pts.map((p, i) => `${i ? 'L' : 'M'}${f(x(off + p.d))},${f(y(p.los + p.fresnel * kk))}`).join('');
      const down = [...pts].reverse().map((p) => `L${f(x(off + p.d))},${f(y(p.los - p.fresnel * kk))}`).join('');
      return `${up}${down}Z`;
    };
    return {
      ground,
      area: `${ground}L${f(x(off + h.distanceKm))},${base}L${f(x(off))},${base}Z`,
      los: line((i) => pts[i].los),
      full: band(1),
      core: band(0.6),
    };
  });

  const nodes = names.map((name, k) => {
    const hop = k < route.hops.length ? route.hops[k] : route.hops[k - 1];
    const p = k < route.hops.length ? hop.profile[0] : hop.profile[hop.profile.length - 1];
    const at = k < route.hops.length ? offsets[k] : totalKm;
    return { name, at, ground: p.ground, los: p.los, height: heights[k] };
  });

  const xTicks = niceTicks(0, totalKm, Math.max(3, Math.floor((width - M.left - M.right) / 90)));
  const yTicks = niceTicks(yMin, yMax, 5);

  // Flat list of every sample so pointer and keyboard can walk the whole path.
  const flat = useMemo(() => route.hops.flatMap((h, hop) => h.profile.map((p, i) => ({ hop, i, at: offsets[hop] + p.d }))), [route, offsets]);

  const nearest = (clientX: number, rect: DOMRect) => {
    const d = ((clientX - rect.left - M.left) / (rect.width - M.left - M.right)) * totalKm;
    let best = flat[0];
    let bestDist = Infinity;
    for (const s of flat) {
      const dist = Math.abs(s.at - d);
      if (dist < bestDist) {
        best = s;
        bestDist = dist;
      }
    }
    onHover({ hop: best.hop, i: best.i });
  };

  const hovered = hover && route.hops[hover.hop]?.profile[hover.i] ? hover : null;
  const hp = hovered ? route.hops[hovered.hop].profile[hovered.i] : null;
  const hAt = hovered && hp ? offsets[hovered.hop] + hp.d : 0;
  const hGroundM = hovered ? hopSamples[hovered.hop]?.[hovered.i]?.h ?? 0 : 0;

  const worst = route.hops[route.weakestHop];
  const summary = t.chart.summary(totalKm.toFixed(1), (route.minClearanceRatio * 100).toFixed(0), (offsets[route.weakestHop] + worst.worstAtKm).toFixed(1));
  const tooltipLeft = hp ? Math.min(width - 190, Math.max(8, x(hAt) + 12)) : 0;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') return onHover(null);
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const cur = hovered ? flat.findIndex((s) => s.hop === hovered.hop && s.i === hovered.i) : 0;
    const step = Math.max(1, Math.round(flat.length / 40)) * (e.key === 'ArrowRight' ? 1 : -1);
    const next = flat[Math.max(0, Math.min(flat.length - 1, cur + step))];
    onHover({ hop: next.hop, i: next.i });
  };

  return (
    <div className="chart" ref={wrap}>
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-label={summary}
        tabIndex={0}
        onPointerMove={(e) => nearest(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerLeave={() => onHover(null)}
        onKeyDown={onKey}
        onBlur={() => onHover(null)}
      >
        {yTicks.map((tk) => (
          <g key={`y${tk}`}>
            <line className="grid" x1={M.left} x2={width - M.right} y1={y(tk)} y2={y(tk)} />
            <text className="tick" x={M.left - 8} y={y(tk)} textAnchor="end" dominantBaseline="middle">
              {tk}
            </text>
          </g>
        ))}
        {xTicks.map((tk) => (
          <text key={`x${tk}`} className="tick" x={x(tk)} y={HEIGHT - 10} textAnchor="middle">
            {tk}
          </text>
        ))}
        <text className="axis-label" x={M.left} y={11}>
          {t.chart.elevation}
        </text>
        <text className="axis-label" x={width - M.right} y={HEIGHT - 10} textAnchor="end">
          {t.chart.km}
        </text>

        {hopPaths.map((h, k) => (
          <g key={k}>
            <path className="fresnel-full" d={h.full} />
            <path className="fresnel-core" d={h.core} />
            <path className="ground" d={h.area} />
            <path className="ground-line" d={h.ground} />
            <path className="los" d={h.los} />
          </g>
        ))}

        {/* hop boundaries are marked by their repeater masts */}
        {nodes.map((n, k) => (
          <g key={n.name}>
            <line className="mast" x1={x(n.at)} x2={x(n.at)} y1={y(n.ground)} y2={y(n.los)} />
            <circle className="mast-top" cx={x(n.at)} cy={y(n.los)} r={5} />
            <text
              className="mast-label"
              x={x(n.at) + (k === 0 ? 8 : k === nodes.length - 1 ? -8 : 0)}
              y={y(n.los) - 10}
              textAnchor={k === 0 ? 'start' : k === nodes.length - 1 ? 'end' : 'middle'}
            >
              {n.name} · {n.height} m
            </text>
          </g>
        ))}

        {/* worst point of every hop that is not healthy */}
        {route.hops.map((h, k) => {
          if (h.verdict === 'good') return null;
          const wp = h.profile.reduce((w, p, i) => (i > 0 && i < h.profile.length - 1 && p.clearanceRatio < w.clearanceRatio ? p : w), h.profile[1] ?? h.profile[0]);
          return <circle key={k} className={`worst worst-${h.verdict}`} cx={x(offsets[k] + wp.d)} cy={y(wp.ground)} r={6} />;
        })}

        {hp && (
          <g pointerEvents="none">
            <line className="cursor" x1={x(hAt)} x2={x(hAt)} y1={M.top} y2={HEIGHT - M.bottom} />
            <circle className="cursor-dot" cx={x(hAt)} cy={y(hp.ground)} r={4} />
            <circle className="cursor-dot los-dot" cx={x(hAt)} cy={y(hp.los)} r={4} />
          </g>
        )}
      </svg>

      <div className="legend" aria-hidden="true">
        <span>
          <i className="sw sw-ground" /> {t.chart.legendGround}
        </span>
        <span>
          <i className="sw sw-los" /> {t.chart.legendLos}
        </span>
        <span>
          <i className="sw sw-fresnel" /> {t.chart.legendFresnel}
        </span>
      </div>

      {hp && hovered && (
        <div className="tooltip" style={{ left: tooltipLeft, top: 14 }} role="status">
          <strong>
            {multi && `${t.route.hopName(names[hovered.hop], names[hovered.hop + 1])} · `}
            {hAt.toFixed(2)} km
          </strong>
          <span>{t.chart.ground(hGroundM.toFixed(0))}</span>
          <span className={hp.clearance < 0 ? 'bad' : hp.clearanceRatio < 0.6 ? 'warn' : 'ok'}>
            {hp.clearance < 0 ? t.chart.blockedBy : t.chart.clearance} {Math.abs(hp.clearance).toFixed(1)} m
            {hp.fresnel > 0 && ` (${(hp.clearanceRatio * 100).toFixed(0)}% ${t.chart.fresnelShort})`}
          </span>
        </div>
      )}
    </div>
  );
}
