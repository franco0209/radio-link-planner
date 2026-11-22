import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapView } from './components/MapView';
import { PointField } from './components/PointField';
import { ProfileChart } from './components/ProfileChart';
import { RadioForm } from './components/RadioForm';
import { ResultPanel } from './components/ResultPanel';
import { analyzeLink } from './core/analysis';
import { distanceKm } from './core/geo';
import type { LatLng, LinkParams, TerrainSample } from './core/types';
import { fetchTerrainProfile } from './services/elevation';
import { LANGUAGES, useI18n, type Lang } from './i18n';
import { ServiceError } from './services/errors';
import { decodeState, encodeState } from './state/urlState';

type Terrain =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; samples: TerrainSample[]; flat?: boolean }
  | { status: 'error'; error: unknown };

const EXAMPLE = {
  a: { lat: -16.3989, lng: -71.535 },
  b: { lat: -16.402, lng: -71.401 },
};

const MIN_KM = 0.05;

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
  const [params, setParams] = useState<LinkParams>(initial.params);
  const [placing, setPlacing] = useState<'a' | 'b' | null>(initial.a ? (initial.b ? null : 'b') : 'a');
  const [terrain, setTerrain] = useState<Terrain>({ status: 'idle' });
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [fitKey, setFitKey] = useState('init');
  const [theme, setTheme] = useState<'light' | 'dark'>(readTheme);
  const [copied, setCopied] = useState(false);
  const [retry, setRetry] = useState(0);

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
    const hash = encodeState({ a, b, params });
    window.history.replaceState(null, '', hash ? `#${hash}` : window.location.pathname + window.location.search);
  }, [a, b, params]);

  // Load terrain whenever the two sites change.
  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    abort.current?.abort();
    if (!a || !b || distanceKm(a, b) < MIN_KM) {
      setTerrain({ status: 'idle' });
      return;
    }
    const ctrl = new AbortController();
    abort.current = ctrl;
    setTerrain({ status: 'loading' });
    const timer = setTimeout(() => {
      fetchTerrainProfile(a, b, ctrl.signal)
        .then((samples) => setTerrain({ status: 'ready', samples }))
        .catch((e: Error) => {
          if (e.name !== 'AbortError') setTerrain({ status: 'error', error: e });
        });
    }, 350);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [a, b, retry]);

  const samples = terrain.status === 'ready' ? terrain.samples : null;
  const analysis = useMemo(() => (samples ? analyzeLink(samples, params) : null), [samples, params]);

  const patchParams = useCallback((patch: Partial<LinkParams>) => setParams((p) => ({ ...p, ...patch })), []);

  const handleMapClick = (p: LatLng) => {
    if (placing === 'a') {
      setA(p);
      setPlacing(b ? null : 'b');
      if (b) setFitKey(`${Date.now()}`);
    } else if (placing === 'b') {
      setB(p);
      setPlacing(null);
      setFitKey(`${Date.now()}`);
    }
  };

  const setPoint = (which: 'a' | 'b', p: LatLng) => {
    (which === 'a' ? setA : setB)(p);
    setPlacing(null);
    setFitKey(`${Date.now()}`);
  };

  const flatFallback = () => {
    if (!a || !b) return;
    const total = distanceKm(a, b);
    const n = 60;
    const flat: TerrainSample[] = Array.from({ length: n }, (_, i) => {
      const f = i / (n - 1);
      return { d: total * f, h: 0, lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f };
    });
    setTerrain({ status: 'ready', samples: flat, flat: true });
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

  const hoverPoint =
    samples && hoverIndex !== null && samples[hoverIndex] ? { lat: samples[hoverIndex].lat, lng: samples[hoverIndex].lng } : null;

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
          <button type="button" className="btn btn-small" onClick={() => window.print()} disabled={!analysis} aria-label={t.app.print}>
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
        {analysis && <ResultPanel analysis={analysis} onApplyHeight={(extra) => patchParams({ heightAM: params.heightAM + extra, heightBM: params.heightBM + extra })} />}

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
                setFitKey(`${Date.now()}`);
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
              <button
                type="button"
                className="btn btn-small"
                onClick={() => {
                  setA(b);
                  setB(a);
                  setHoverIndex(null);
                }}
              >
                {t.sites.swap}
              </button>
            )}
          </div>
          <PointField name="A" point={a} placing={placing === 'a'} onPlace={() => setPlacing(placing === 'a' ? null : 'a')} onSet={(p) => setPoint('a', p)} onClear={() => setA(null)} />
          <PointField name="B" point={b} placing={placing === 'b'} onPlace={() => setPlacing(placing === 'b' ? null : 'b')} onSet={(p) => setPoint('b', p)} onClear={() => setB(null)} />
        </section>

        <RadioForm params={params} onChange={patchParams} />

        <p className="footnote">
          {t.app.footnote}
        </p>
      </aside>

      <main className="stage">
        <MapView
          a={a}
          b={b}
          verdict={analysis?.verdict ?? null}
          hover={hoverPoint}
          placing={placing}
          fitKey={fitKey}
          dark={theme === 'dark'}
          onMapClick={handleMapClick}
          onDrag={(which, p) => setPoint(which, p)}
        />
        <section className="profile card" aria-label={t.app.profileLabel}>
          {analysis && samples ? (
            <ProfileChart analysis={analysis} samples={samples} params={params} hoverIndex={hoverIndex} onHover={setHoverIndex} />
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
