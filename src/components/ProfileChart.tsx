import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { LinkAnalysis, LinkParams, TerrainSample } from '../core/types';
import { useI18n } from '../i18n';

interface ProfileChartProps {
  analysis: LinkAnalysis;
  samples: TerrainSample[];
  params: LinkParams;
  onHover: (index: number | null) => void;
  hoverIndex: number | null;
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

export function ProfileChart({ analysis, samples, params, onHover, hoverIndex }: ProfileChartProps) {
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

  const { profile, distanceKm } = analysis;

  const geom = useMemo(() => {
    const topLine = profile.map((p) => p.los + p.fresnel);
    const bottomLine = profile.map((p) => p.los - p.fresnel);
    const yMinRaw = Math.min(...profile.map((p) => p.ground), ...bottomLine.slice(1, -1));
    const yMaxRaw = Math.max(...profile.map((p) => p.ground), ...topLine);
    const pad = Math.max(5, (yMaxRaw - yMinRaw) * 0.08);
    const yMin = Math.floor((yMinRaw - pad) / 5) * 5;
    const yMax = Math.ceil((yMaxRaw + pad) / 5) * 5;
    const innerW = width - M.left - M.right;
    const innerH = HEIGHT - M.top - M.bottom;
    const x = (d: number) => M.left + (d / distanceKm) * innerW;
    const y = (h: number) => M.top + (1 - (h - yMin) / (yMax - yMin)) * innerH;
    return { x, y, yMin, yMax, innerW, innerH };
  }, [profile, distanceKm, width]);

  const { x, y, yMin, yMax } = geom;
  const line = (vals: number[]) => profile.map((p, i) => `${i ? 'L' : 'M'}${x(p.d).toFixed(1)},${y(vals[i]).toFixed(1)}`).join('');

  const groundPath = line(profile.map((p) => p.ground));
  const base = y(yMin);
  const groundArea = `${groundPath}L${x(distanceKm).toFixed(1)},${base}L${x(0).toFixed(1)},${base}Z`;

  const band = (k: number) => {
    const up = profile.map((p, i) => `${i ? 'L' : 'M'}${x(p.d).toFixed(1)},${y(p.los + p.fresnel * k).toFixed(1)}`).join('');
    const down = [...profile]
      .reverse()
      .map((p) => `L${x(p.d).toFixed(1)},${y(p.los - p.fresnel * k).toFixed(1)}`)
      .join('');
    return `${up}${down}Z`;
  };

  const losPath = line(profile.map((p) => p.los));
  const xTicks = niceTicks(0, distanceKm, Math.max(3, Math.floor((width - M.left - M.right) / 90)));
  const yTicks = niceTicks(yMin, yMax, 5);

  const worstIdx = profile.reduce((w, p, i) => (i > 0 && i < profile.length - 1 && p.clearanceRatio < profile[w].clearanceRatio ? i : w), 1);
  const worst = profile[Math.min(worstIdx, profile.length - 1)];
  const hp = hoverIndex !== null ? profile[hoverIndex] : null;

  const onMove = (clientX: number, rect: DOMRect) => {
    const px = clientX - rect.left;
    const d = ((px - M.left) / (rect.width - M.left - M.right)) * distanceKm;
    const idx = Math.round((d / distanceKm) * (profile.length - 1));
    onHover(Math.max(0, Math.min(profile.length - 1, idx)));
  };

  const summary = t.chart.summary(distanceKm.toFixed(1), (analysis.minClearanceRatio * 100).toFixed(0), analysis.worstAtKm.toFixed(1));
  const tooltipLeft = hp ? Math.min(width - 190, Math.max(8, x(hp.d) + 12)) : 0;

  return (
    <div className="chart" ref={wrap}>
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-label={summary}
        tabIndex={0}
        onPointerMove={(e) => onMove(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerLeave={() => onHover(null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault();
            const cur = hoverIndex ?? 0;
            onHover(Math.max(0, Math.min(profile.length - 1, cur + (e.key === 'ArrowRight' ? 1 : -1) * Math.max(1, Math.round(profile.length / 40)))));
          }
          if (e.key === 'Escape') onHover(null);
        }}
        onBlur={() => onHover(null)}
      >
        {/* grid + axes */}
        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line className="grid" x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} />
            <text className="tick" x={M.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle">
              {t}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={`x${t}`} className="tick" x={x(t)} y={HEIGHT - 10} textAnchor="middle">
            {t}
          </text>
        ))}
        <text className="axis-label" x={M.left} y={11}>
          {t.chart.elevation}
        </text>
        <text className="axis-label" x={width - M.right} y={HEIGHT - 10} textAnchor="end">
          {t.chart.km}
        </text>

        {/* Fresnel zone: full first zone, then the 60 % that must stay clear */}
        <path className="fresnel-full" d={band(1)} />
        <path className="fresnel-core" d={band(0.6)} />

        {/* terrain (includes earth curvature) */}
        <path className="ground" d={groundArea} />
        <path className="ground-line" d={groundPath} />

        {/* line of sight */}
        <path className="los" d={losPath} />

        {/* masts */}
        {[profile[0], profile[profile.length - 1]].map((p, i) => (
          <g key={i}>
            <line className="mast" x1={x(p.d)} x2={x(p.d)} y1={y(p.ground)} y2={y(p.los)} />
            <circle className="mast-top" cx={x(p.d)} cy={y(p.los)} r={5} />
            <text className="mast-label" x={x(p.d) + (i === 0 ? 8 : -8)} y={y(p.los) - 10} textAnchor={i === 0 ? 'start' : 'end'}>
              {i === 0 ? `A · ${params.heightAM} m` : `B · ${params.heightBM} m`}
            </text>
          </g>
        ))}

        {/* worst point */}
        {worst && analysis.verdict !== 'good' && (
          <g>
            <circle className={`worst worst-${analysis.verdict}`} cx={x(worst.d)} cy={y(worst.ground)} r={6} />
          </g>
        )}

        {/* hover */}
        {hp && (
          <g pointerEvents="none">
            <line className="cursor" x1={x(hp.d)} x2={x(hp.d)} y1={M.top} y2={HEIGHT - M.bottom} />
            <circle className="cursor-dot" cx={x(hp.d)} cy={y(hp.ground)} r={4} />
            <circle className="cursor-dot los-dot" cx={x(hp.d)} cy={y(hp.los)} r={4} />
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

      {hp && (
        <div className="tooltip" style={{ left: tooltipLeft, top: 14 }} role="status">
          <strong>{hp.d.toFixed(2)} km</strong>
          <span>{t.chart.ground((samples[hoverIndex!]?.h ?? 0).toFixed(0))}</span>
          <span className={hp.clearance < 0 ? 'bad' : hp.clearanceRatio < 0.6 ? 'warn' : 'ok'}>
            {hp.clearance < 0 ? t.chart.blockedBy : t.chart.clearance} {Math.abs(hp.clearance).toFixed(1)} m
            {hp.fresnel > 0 && ` (${(hp.clearanceRatio * 100).toFixed(0)}% ${t.chart.fresnelShort})`}
          </span>
        </div>
      )}
    </div>
  );
}
