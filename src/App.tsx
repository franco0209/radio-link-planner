import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapView } from './components/MapView';
import { PointField } from './components/PointField';
import { ProfileChart, type HoverPos } from './components/ProfileChart';
import { RadioForm } from './components/RadioForm';
import { RepeaterForm } from './components/RepeaterForm';
import { ResultPanel } from './components/ResultPanel';
import { SuggestionPanel } from './components/SuggestionPanel';
import { distanceKm } from './core/geo';
import { MAX_REPEATERS, suggestRepeaters } from './core/repeaters';
import { analyzeRoute, orderRepeaters } from './core/route';
import type { LatLng, LinkParams, Repeater, RepeaterSuggestion, TerrainSample } from './core/types';
import { LANGUAGES, useI18n, type Lang } from './i18n';
import { ServiceError } from './services/errors';
import { fetchTerrainProfile } from './services/elevation';
import { decodeState, encodeState, fmtPoint } from './state/urlState';

type Terrain =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; hops: TerrainSample[][]; key: string; flat?: boolean }
  | { status: 'error'; error: unknown };

type Placing = 'a' | 'b' | 'r' | null;

const EXAMPLE = {
  a: { lat: -16.3989, lng: -71.535 },
  b: { lat: -16.402, lng: -71.401 },
};

const MIN_KM = 0.05;
const MIN_SUGGEST_KM = 0.5;
const REPEATER_DEFAULT_HEIGHT_M = 15;

/** 5 decimals (~1 m): what the URL stores, so state, cache keys and reloaded links all agree. */
const round5 = (p: LatLng): LatLng => ({ lat: Number(p.lat.toFixed(5)), lng: Number(p.lng.toFixed(5)) });
const hopKey = (p: LatLng, q: LatLng) => `${fmtPoint(p)}>${fmtPoint(q)}`;
const nowKey = () => `${Date.now()}`;

function errorText(t: ReturnType<typeof useI18n>['t'], e: unknown): string {
  if (e instanceof ServiceError) {
    if (e.code === 'rateLimited') return t.errors.rateLimited;
    if (e.code === 'elevationHttp') return t.errors.elevationHttp(e.status ?? 0);
    if (e.code === 'badResponse') return t.errors.badResponse;
  }
  return t.errors.loadFailed;
}

/** Share link without ?lang= so the recipient's own language wins. */
const shareUrl = () => window.location.origin + window.location.pathname + window.location.hash;

function readTheme(): 'light' | 'dark' {
  try {
    const saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* storage unavailable */
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export default function App() {
  const { t, lang, setLang } = useI18n();
  const initial = useMemo(() => decodeState(window.location.hash), []);
  const [a, setA] = useState<LatLng | null>(initial.a);
  const [b, setB] = useState<LatLng | null>(initial.b);
  const [repeaters, setRepeaters] = useState<Repeater[]>(initial.repeaters);
  const [params, setParams] = useState<LinkParams>(initial.params);
  const [placing, setPlacing] = useState<Placing>(initial.a ? (initial.b ? null : 'b') : 'a');
  const [terrain, setTerrain] = useState<Terrain>({ status: 'idle' });
  const [hover, setHover] = useState<HoverPos | null>(null);
  const [fitKey, setFitKey] = useState('init');
  const [theme, setTheme] = useState<'light' | 'dark'>(readTheme);
  const [copied, setCopied] = useState(false);
  const [retry, setRetry] = useState(0);
  const [suggestions, setSuggestions] = useState<RepeaterSuggestion[] | null>(null);
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const suggestToken = useRef(0);
  /** Terrain per hop, keyed by its endpoints. Also seeded when a suggestion is applied. */
  const hopCache = useRef(new Map<string, TerrainSample[]>());

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('theme', theme);
    } catch {
      /* storage unavailable */
    }
  }, [theme]);

  // Keep the URL in sync so any state can be shared or bookmarked.
  useEffect(() => {
    const hash = encodeState({ a, b, repeaters, params });
    window.history.replaceState(null, '', hash ? `#${hash}` : window.location.pathname + window.location.search);
  }, [a, b, repeaters, params]);

  const nodes = useMemo(() => (a && b ? [a, ...repeaters, b] : []), [a, b, repeaters]);
  /** Changes only when a position changes, not when a mast height does (no refetch for that). */
  const routeKey = nodes.map(fmtPoint).join('>');
  const latestNodes = useRef(nodes);
  latestNodes.current = nodes;

  // Load terrain for every hop whenever positions change.
  useEffect(() => {
    const pts = latestNodes.current;
    const hopPairs = pts.slice(0, -1).map((p, i) => [p, pts[i + 1]] as const);
    if (hopPairs.length === 0 || hopPairs.some(([p, q]) => distanceKm(p, q) < MIN_KM)) {
      setTerrain({ status: 'idle' });
      return;
    }
    const ctrl = new AbortController();
    setTerrain({ status: 'loading' });
    const load = async ([p, q]: readonly [LatLng, LatLng]) => {
      const key = hopKey(p, q);
      const hit = hopCache.current.get(key);
      if (hit) return hit;
      const samples = await fetchTerrainProfile(p, q, ctrl.signal);
      hopCache.current.set(key, samples);
      return samples;
    };
    const timer = setTimeout(() => {
      Promise.all(hopPairs.map(load))
        .then((hops) => setTerrain({ status: 'ready', hops, key: routeKey }))
        .catch((e: Error) => {
          if (e.name !== 'AbortError') setTerrain({ status: 'error', error: e });
        });
    }, 350);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [routeKey, retry]);

  // Suggestions describe one specific situation, so any change invalidates them.
  useEffect(() => {
    suggestToken.current += 1;
    setSuggestions(null);
    setPreviewIdx(null);
  }, [routeKey, params]);

  const heights = useMemo(() => [params.heightAM, ...repeaters.map((r) => r.heightM), params.heightBM], [params.heightAM, params.heightBM, repeaters]);
  const hopSamples = terrain.status === 'ready' && terrain.key === routeKey && terrain.hops.length === repeaters.length + 1 ? terrain.hops : null;
  const route = useMemo(() => (hopSamples ? analyzeRoute(hopSamples, params, heights) : null), [hopSamples, params, heights]);
  const names = useMemo(() => ['A', ...repeaters.map((_, i) => `R${i + 1}`), 'B'], [repeaters]);

  const patchParams = useCallback((patch: Partial<LinkParams>) => setParams((p) => ({ ...p, ...patch })), []);
  const setReps = (list: Repeater[]) => (a && b ? setRepeaters(orderRepeaters(a, b, list).slice(0, MAX_REPEATERS)) : setRepeaters([]));

  const handleMapClick = (p: LatLng) => {
    if (placing === 'a') {
      setA(round5(p));
      setPlacing(b ? null : 'b');
      if (b) setFitKey(nowKey());
    } else if (placing === 'b') {
      setB(round5(p));
      setPlacing(null);
      setFitKey(nowKey());
    } else if (placing === 'r' && repeaters.length < MAX_REPEATERS) {
      setReps([...repeaters, { ...round5(p), heightM: REPEATER_DEFAULT_HEIGHT_M }]);
      setPlacing(null);
    }
  };

  const setPoint = (which: 'a' | 'b', p: LatLng) => {
    (which === 'a' ? setA : setB)(round5(p));
    setPlacing(null);
    setFitKey(nowKey());
  };

  /** Repeaters sit between A and B, so removing either end removes them too. */
  const clearPoint = (which: 'a' | 'b') => {
    (which === 'a' ? setA : setB)(null);
    setRepeaters([]);
  };

  const swap = () => {
    if (!a || !b) return;
    setA(b);
    setB(a);
    setRepeaters([...repeaters].reverse());
    setParams((p) => ({
      ...p,
      heightAM: p.heightBM,
      heightBM: p.heightAM,
      gainADbi: p.gainBDbi,
      gainBDbi: p.gainADbi,
      cableLossADb: p.cableLossBDb,
      cableLossBDb: p.cableLossADb,
    }));
    setHover(null);
  };

  /** Raise the two masts of one hop. Node k of the route is A (0), a repeater, or B (last). */
  const applyHopHeight = (hop: number, extra: number) => {
    const last = repeaters.length + 1;
    const bump = (node: number) => {
      if (node === 0) setParams((p) => ({ ...p, heightAM: p.heightAM + extra }));
      else if (node === last) setParams((p) => ({ ...p, heightBM: p.heightBM + extra }));
      else setRepeaters((rs) => rs.map((r, i) => (i === node - 1 ? { ...r, heightM: r.heightM + extra } : r)));
    };
    bump(hop);
    bump(hop + 1);
  };

  const suggest = () => {
    if (!hopSamples || repeaters.length > 0 || suggesting) return;
    setPreviewIdx(null);
    setSuggesting(true);
    const token = suggestToken.current;
    // The worst case (nothing works) takes a few hundred ms; let the button repaint first.
    setTimeout(() => {
      const found = suggestRepeaters(hopSamples[0], params);
      setSuggesting(false);
      if (token === suggestToken.current) setSuggestions(found); // drop results if the scene changed meanwhile
    }, 30);
  };

  const applySuggestion = (s: RepeaterSuggestion) => {
    if (!hopSamples || !a || !b || repeaters.length > 0) return;
    const direct = hopSamples[0];
    const reps: Repeater[] = s.repeaters.map((r) => ({ ...round5(r), heightM: r.heightM }));
    const idx = [0, ...s.repeaters.map((r) => direct.findIndex((p) => p.lat === r.lat && p.lng === r.lng)), direct.length - 1];
    if (idx.some((i) => i < 0)) return;
    // Reuse the exact terrain the suggestion was scored on, so what you see matches what was promised.
    const pts = [a, ...reps, b];
    for (let k = 0; k < pts.length - 1; k++) {
      const d0 = direct[idx[k]].d;
      hopCache.current.set(
        hopKey(pts[k], pts[k + 1]),
        direct.slice(idx[k], idx[k + 1] + 1).map((p) => ({ ...p, d: p.d - d0 })),
      );
    }
    setRepeaters(reps);
    setSuggestions(null);
    setPreviewIdx(null);
    setFitKey(nowKey());
  };

  const flatFallback = () => {
    if (nodes.length < 2) return;
    const hops: TerrainSample[][] = nodes.slice(0, -1).map((p, i) => {
      const q = nodes[i + 1];
      const total = distanceKm(p, q);
      const n = 60;
      return Array.from({ length: n }, (_, k) => {
        const f = k / (n - 1);
        return { d: total * f, h: 0, lat: p.lat + (q.lat - p.lat) * f, lng: p.lng + (q.lng - p.lng) * f };
      });
    });
    setTerrain({ status: 'ready', hops, key: routeKey, flat: true });
  };

  const share = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt(t.app.copyPrompt, shareUrl());
    }
  };

  const hoverPoint = hopSamples && hover && hopSamples[hover.hop]?.[hover.i] ? hopSamples[hover.hop][hover.i] : null;
  const canSuggest = !!route && route.verdict === 'blocked' && repeaters.length === 0 && route.hops[0].distanceKm >= MIN_SUGGEST_KM;
  const preview = suggestions && previewIdx !== null ? suggestions[previewIdx]?.repeaters ?? null : null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
            <rect width="32" height="32" rx="8" fill="currentColor" />
            <circle cx="8" cy="22" r="3" fill="#fff" />
            <circle cx="24" cy="10" r="3" fill="#fff" />
            <path d="M8 22Q16 6 24 10" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeDasharray="1 4" />
          </svg>
          <h1>{t.app.title}</h1>
        </div>
        <div className="top-actions">
          <select className="lang-select" value={lang} onChange={(e) => setLang(e.target.value as Lang)} aria-label={t.app.language}>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code} lang={l.code}>
                {l.name}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-small" onClick={share} disabled={!a && !b} aria-label={copied ? t.app.copied : t.app.share}>
            <span aria-hidden="true">{copied ? '✓' : '↗'}</span>
            <span className="lbl">{copied ? t.app.copied : t.app.share}</span>
          </button>
          <button type="button" className="btn btn-small" onClick={() => window.print()} disabled={!route} aria-label={t.app.print}>
            <span aria-hidden="true">⎙</span>
            <span className="lbl">{t.app.print}</span>
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setTheme((v) => (v === 'dark' ? 'light' : 'dark'))}
            aria-label={theme === 'dark' ? t.app.themeToLight : t.app.themeToDark}
            title={t.app.themeToggle}
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        </div>
      </header>

      <aside className="sidebar" aria-label={t.app.settings}>
        {route && <ResultPanel route={route} names={names} onApplyHeight={applyHopHeight} onSuggest={canSuggest ? suggest : undefined} suggesting={suggesting} />}

        {suggestions && repeaters.length === 0 && (
          <SuggestionPanel
            suggestions={suggestions}
            onApply={applySuggestion}
            onPreview={setPreviewIdx}
            onClose={() => {
              setSuggestions(null);
              setPreviewIdx(null);
            }}
          />
        )}

        {terrain.status === 'loading' && (
          <div className="card status" role="status">
            <span className="spinner" aria-hidden="true" /> {t.app.loadingTerrain}
          </div>
        )}

        {terrain.status === 'error' && (
          <div className="card status status-error" role="alert">
            <p>{errorText(t, terrain.error)}</p>
            <div className="row">
              <button type="button" className="btn btn-small" onClick={() => setRetry((n) => n + 1)}>
                {t.app.retry}
              </button>
              <button type="button" className="btn btn-small" onClick={flatFallback}>
                {t.app.flatGround}
              </button>
            </div>
          </div>
        )}

        {terrain.status === 'ready' && terrain.flat && (
          <p className="banner" role="note">
            {t.app.flatBanner}
          </p>
        )}

        {!a && !b && (
          <div className="card empty">
            <h2>{t.empty.title}</h2>
            <p>{t.empty.body}</p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setA(EXAMPLE.a);
                setB(EXAMPLE.b);
                setPlacing(null);
                setFitKey(nowKey());
              }}
            >
              {t.empty.example}
            </button>
          </div>
        )}

        <section className="card" aria-labelledby="sites-title">
          <div className="card-head">
            <h2 id="sites-title" className="card-title">
              {t.sites.title}
            </h2>
            {a && b && (
              <button type="button" className="btn btn-small" onClick={swap}>
                {t.sites.swap}
              </button>
            )}
          </div>
          <PointField name="A" point={a} placing={placing === 'a'} onPlace={() => setPlacing(placing === 'a' ? null : 'a')} onSet={(p) => setPoint('a', p)} onClear={() => clearPoint('a')} />
          <PointField name="B" point={b} placing={placing === 'b'} onPlace={() => setPlacing(placing === 'b' ? null : 'b')} onSet={(p) => setPoint('b', p)} onClear={() => clearPoint('b')} />
          <RepeaterForm
            repeaters={repeaters}
            enabled={!!a && !!b}
            placing={placing === 'r'}
            onAdd={() => setPlacing(placing === 'r' ? null : 'r')}
            onHeight={(i, h) => setRepeaters((rs) => rs.map((r, k) => (k === i ? { ...r, heightM: h } : r)))}
            onRemove={(i) => setRepeaters((rs) => rs.filter((_, k) => k !== i))}
          />
        </section>

        <RadioForm params={params} onChange={patchParams} />

        <p className="footnote">{t.app.footnote}</p>
      </aside>

      <main className="stage">
        <MapView
          a={a}
          b={b}
          repeaters={repeaters}
          hopVerdicts={route ? route.hops.map((h) => h.verdict) : null}
          preview={preview}
          hover={hoverPoint}
          placing={placing}
          fitKey={fitKey}
          dark={theme === 'dark'}
          onMapClick={handleMapClick}
          onDrag={(which, p) => setPoint(which, p)}
          onRepeaterDrag={(i, p) => setReps(repeaters.map((r, k) => (k === i ? { ...r, ...round5(p) } : r)))}
        />
        <section className="profile card" aria-label={t.app.profileLabel}>
          {route && hopSamples ? (
            <ProfileChart route={route} hopSamples={hopSamples} names={names} heights={heights} hover={hover} onHover={setHover} />
          ) : (
            <div className="profile-empty">
              <p>{a && b ? t.app.profileWaiting : t.app.profileSetSites}</p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
