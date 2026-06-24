import { useState, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import { useCallback } from 'react';
import {
  COLORS, SOCIALS,
  Btn, Kicker,
  GlyphSun, GlyphMoon, GlobeIcon, ControllerIcon,
  PaperclipIcon, ChatBubbleIcon,
  useClock, useGeoDayNight, useAmbient, useLanyard, useLang, useAuth,
  usePersisted, useSyncedData, usePasteImage, useMediaQuery,
  buildChatHistory,
} from './lib.jsx';
import MobileShell from './MobileShell.jsx';

const AIPlayground       = lazy(() => import('./featuresA.jsx').then((m) => ({ default: m.AIPlayground })));
const Toolbox            = lazy(() => import('./featuresA.jsx').then((m) => ({ default: m.Toolbox })));
const TravelV4           = lazy(() => import('./tv4/index.jsx').then((m) => ({ default: m.TravelV4 })));
const SharedTripView     = lazy(() => import('./tv4/SharedTripView.jsx'));
const GamePanel          = lazy(() => import('./featuresA.jsx').then((m) => ({ default: m.GamePanel })));
const TechStackMonitor   = lazy(() => import('./featuresB.jsx').then((m) => ({ default: m.TechStackMonitor })));
const CryptoWatch        = lazy(() => import('./featuresB.jsx').then((m) => ({ default: m.CryptoWatch })));
const TodoList           = lazy(() => import('./featuresB.jsx').then((m) => ({ default: m.TodoList })));
const Feed               = lazy(() => import('./featuresB.jsx').then((m) => ({ default: m.Feed })));
const Stylist            = lazy(() => import('./featuresC.jsx').then((m) => ({ default: m.Stylist })));

const FEATURES = [
  { id: 'home',   label: 'Home',                  icon: (c) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10.7 12 3l9 7.7" />
      <path d="M5.5 9.4V20h13V9.4" />
      <path d="M10 20v-5h4v5" />
    </svg>
  ), accent: COLORS.text,  short: '00' },
  { id: 'ai',     label: 'AI Playground',         icon: '✦',   accent: COLORS.red,   short: '01', desc: 'Chat · image · video' },
  { id: 'tools',  label: 'Toolbox',               icon: '⚒',   accent: COLORS.green, short: '02', desc: 'Public + private utilities' },
  { id: 'stylist',label: 'Stylist',               icon: '👗',  accent: COLORS.gold,  short: '07', desc: 'AI wardrobe · outfit mixer' },
  { id: 'game',   label: 'Game',                  icon: (c) => <ControllerIcon color={c} size={22} />, accent: COLORS.red,   short: '03', desc: 'Coming soon' },
  { id: 'crypto', label: 'Currency',              icon: '$',   accent: COLORS.gold,  short: '04', desc: 'BTC · GOLD · TWD ⇄ VND' },
  { id: 'feed',   label: 'History',               icon: '◧',   accent: COLORS.gold,  short: '05', desc: 'Private AI history', ownerOnly: true },
  { id: 'kata',   label: 'KataS Dashboard',       icon: '⌨',   accent: COLORS.red,   short: '06', desc: 'Discord bot · ops · cost' },
  // Travel Plan, Subscription Manager and To Do now live inside Toolbox
  // (their routes 'tv4' / 'tech' / 'todo' are still rendered below).
];

// Routes folded into Toolbox — not in the rail, but they still need a
// breadcrumb label/accent when their panel is open.
const MERGED_ROUTE_META = {
  tv4:  { label: 'Travel Plan',          accent: COLORS.gold,  short: 'TB' },
  tech: { label: 'Subscription Manager', accent: COLORS.green, short: 'TB' },
  todo: { label: 'To Do',                accent: COLORS.green, short: 'TB' },
};

const EXPERIMENT_NUMBER = '007';

// Top-level router: hand off to MobileShell on phone-class viewports;
// otherwise render the full desktop control surface. Splitting like this
// keeps the desktop hooks (useLanyard, useAmbient, etc.) from running on
// mobile where their data is never displayed.

export default function App() {
  const isMobile = useMediaQuery('(max-width: 768px)');

  // Public read-only share path bypasses auth + nav. Detected via ?share=<hash>.
  const shareToken = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('share')
    : null;
  if (shareToken) {
    return (
      <Suspense fallback={<div style={{ padding: 40, color: COLORS.muted }} className="mono">◇ loading share…</div>}>
        <SharedTripView token={shareToken} />
      </Suspense>
    );
  }

  if (isMobile) return <MobileShell />;
  return <AppDesktop />;
}

function AppDesktop() {
  const ambientOn = true;
  const showBg = true;
  const isMobile = useMediaQuery('(max-width: 768px)');
  // Fixed rail + top-bar sizes so 27"/32" QHD look identical. Wider viewports
  // get letterboxed by the max-width cap on <main>, not scaled chrome.
  const railWidth = 84;
  const topBarH   = 64;

  const [route, setRoute] = useState(() => {
    // Match against first hash segment only — sub-routes like #/tv4/list/<slug>
    // belong to the feature module and are parsed there.
    const h = window.location.hash.replace(/^#\//, '').split('/')[0];
    if (h === 'kata') { window.location.assign('/kata'); }
    else if (FEATURES.find((f) => f.id === h)) return h;
    // On mobile, default landing → AI chat instead of the desktop landing page.
    const mobileNow = typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(max-width: 768px)').matches : false;
    return mobileNow ? 'ai' : 'home';
  });
  const [transitioning, setTransitioning] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  const { user: authUser } = useAuth();
  // Subscribe to Lanyard for the logged-in Discord user when available;
  // otherwise fall back to the owner's preset ID inside the lib hook.
  const lanyardUserId = authUser?.provider === 'discord' && authUser?.providerUserId
    ? authUser.providerUserId
    : undefined;
  const lanyard = useLanyard(lanyardUserId);
  const ambient = useAmbient(ambientOn, lanyard.data);
  const geo = useGeoDayNight();
  const now = useClock();

  const phase = geo.phase;

  function nav(to) {
    if (to === 'kata') { window.location.assign('/kata'); return; }
    if (to === route) return;
    setTransitioning(true);
    setTimeout(() => {
      setRoute(to);
      window.history.replaceState(null, '', '#/' + to);
      setTimeout(() => setTransitioning(false), 360);
    }, 220);
  }

  // On mobile, the desktop landing page is hidden — bounce 'home' → 'ai' (chat box default).
  useEffect(() => {
    if (isMobile && route === 'home') {
      setRoute('ai');
      window.history.replaceState(null, '', '#/ai');
    }
  }, [isMobile, route]);

  useEffect(() => {
    const h = (e) => {
      if (e.key !== 'Escape') return;
      if (chatOpen) { setChatOpen(false); return; }
      if (route !== 'home') nav('home');
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [route, chatOpen]);

  useEffect(() => {
    const onHash = () => {
      const id = window.location.hash.replace(/^#\//, '').split('/')[0] || 'home';
      if (id === 'kata') { window.location.assign('/kata'); return; }
      if (FEATURES.find((f) => f.id === id) && id !== route) setRoute(id);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [route]);

  const activeFeature = FEATURES.find((f) => f.id === route) || MERGED_ROUTE_META[route];

  return (
    <div style={{
      minHeight: '100vh', background: COLORS.bg, color: COLORS.text,
      position: 'relative', overflow: 'hidden',
    }}>
      {showBg && <AmbientBackground phase={phase} enabled={ambientOn} track={ambient.track} />}

      <TopBar phase={phase} now={now} geo={geo} route={route} nav={nav} ambient={ambient} ambientOn={ambientOn} />
      <NavRail route={route} nav={nav} />

      <main style={{
        position: 'relative', marginLeft: railWidth,
        padding: '24px 32px 32px',
        height: `calc(100vh - ${topBarH}px)`, marginTop: topBarH,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <Breadcrumbs route={route} nav={nav} feature={activeFeature} />
        <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
          <div
            key={route + '_' + transitioning}
            style={{
              animation: transitioning
                ? 'slideOutLeft 220ms ease-in forwards'
                : 'slideInRight 360ms cubic-bezier(0.22,1,0.36,1)',
              willChange: 'transform, opacity',
              height: '100%',
            }}
          >
            <Suspense fallback={<RouteFallback />}>
              {route === 'home'   && <HomeView nav={nav} ambient={ambient} ambientOn={ambientOn} />}
              {route === 'ai'     && <AIPlayground />}
              {route === 'tools'  && <Toolbox nav={nav} />}
              {route === 'stylist'&& <Stylist />}
              {route === 'tv4'    && <TravelV4 />}
              {route === 'game'   && <GamePanel />}
              {route === 'tech'   && <TechStackMonitor />}
              {route === 'crypto' && <CryptoWatch />}
              {route === 'todo'   && <TodoList />}
              {route === 'feed'   && (authUser?.isHistoryOwner ? <Feed /> : <RouteFallback />)}
            </Suspense>
          </div>
        </div>

        <footer style={{
          marginTop: 40, paddingTop: 20,
          borderTop: '1px solid ' + COLORS.line,
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', alignItems: 'center',
          fontSize: 10, color: COLORS.muted, letterSpacing: '0.18em',
        }} className="mono">
          <span style={{ textAlign: 'left' }}>SE77N · {now.getFullYear()} · EXP {EXPERIMENT_NUMBER}</span>
          <span style={{ textAlign: 'center' }}>BUILD · {now.toISOString().slice(0, 10).replaceAll('-', '.')}</span>
          <span style={{ textAlign: 'right', color: phase === 'day' ? COLORS.gold : '#9bb4ff' }}>
            {phase === 'day' ? '◐ DAYLIGHT' : '◑ NIGHTSHIFT'}
          </span>
        </footer>
      </main>

      <ChatFab open={chatOpen}
        onOpen={() => setChatOpen(true)}
        onClose={() => setChatOpen(false)}
        ambient={ambient} nav={nav} />
      <AuthErrorToast />
    </div>
  );
}

function RouteFallback() {
  return (
    <div style={{ padding: 40, color: COLORS.muted, fontSize: 12 }} className="mono">
      ◇ loading module…
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Ambient (audio-reactive) background
// ─────────────────────────────────────────────────────────────
function AmbientBackground({ phase, enabled, track }) {
  const c1 = enabled ? track.palette[0] : COLORS.red;
  const c2 = enabled ? track.palette[1] || COLORS.green : COLORS.green;
  const baseTint = phase === 'day' ? 'rgba(212,168,88,0.04)' : 'rgba(91,168,104,0.02)';

  return (
    <>
      <div aria-hidden style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0,
        backgroundImage: `
          radial-gradient(60% 50% at 18% 12%, ${c1}26 0%, transparent 65%),
          radial-gradient(50% 45% at 90% 88%, ${c2}28 0%, transparent 70%),
          radial-gradient(35% 30% at 60% 50%, ${COLORS.gold}10 0%, transparent 75%),
          linear-gradient(180deg, ${baseTint} 0%, transparent 50%)
        `,
        transition: 'background-image 1.2s ease',
      }} />
      <div aria-hidden style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0,
        opacity: 0.5,
        backgroundImage: 'radial-gradient(rgba(255,255,255,0.04) 1px, transparent 1px)',
        backgroundSize: '3px 3px',
      }} />
      {enabled && (
        <div aria-hidden style={{
          position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0,
          background: `radial-gradient(600px circle at 50% 100%, ${c1}11, transparent 70%)`,
          animation: 'ambient 4s ease-in-out infinite',
        }} />
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// Top bar
// ─────────────────────────────────────────────────────────────
function TopBar({ phase, now, geo, nav, ambient, ambientOn }) {
  const { lang, toggle, t } = useLang();
  const isMobile = useMediaQuery('(max-width: 768px)');
  const tStr = now.toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  // Fixed-height bar; rail + bar both stay 64/84 across viewports so 27"/32" QHD render identically.
  return (
    <header style={{
      position: 'fixed', top: 0, left: 0, right: 0,
      height: 64, zIndex: 50,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 28px 0 22px',
      background: 'rgba(13,10,8,0.7)',
      backdropFilter: 'blur(14px)',
      borderBottom: '1px solid ' + COLORS.line,
    }}>
      <button onClick={() => nav('home')} aria-label="se77n · home"
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
          padding: 0, gap: 4, color: COLORS.text,
        }}>
        <div className="mono" style={{
          fontSize: 30, fontWeight: 800, letterSpacing: '-0.025em', lineHeight: 0.95,
        }}>
          se<span style={{
            color: COLORS.red,
            textShadow: `0 0 6px ${COLORS.red}cc, 0 0 18px ${COLORS.red}66, 0 0 36px ${COLORS.red}33`,
          }}>77</span>n
        </div>
        <div className="mono" style={{
          fontSize: 9, letterSpacing: '0.24em', color: COLORS.muted, lineHeight: 1,
          textTransform: 'uppercase',
        }}>
          {t('topbar.experiment')}&nbsp;<span style={{
            color: COLORS.red, fontWeight: 700,
            textShadow: `0 0 4px ${COLORS.red}aa, 0 0 10px ${COLORS.red}55`,
          }}>{EXPERIMENT_NUMBER}</span> / {t('topbar.desktop')}
        </div>
      </button>

      {ambient.isLive && (
        <div style={{
          position: 'absolute', left: '50%', top: '50%',
          transform: 'translate(-50%, -50%)',
        }}>
          <NowPlaying ambient={ambient} on={ambientOn} />
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <LangToggle lang={lang} toggle={toggle} title={t('topbar.toggleLang')} />
        <LightToggle title="Light / dark" />
        <ThemeToggle ambient={ambient} title="Theme" />
        {!isMobile && <TimeChip phase={phase} city={geo.city} timeStr={tStr} />}
        <AuthChip />
      </div>
    </header>
  );
}

// Compact pill: [day/night icon] [HH:MM:SS] [· City]
function TimeChip({ phase, city, timeStr }) {
  const day = phase === 'day';
  const color = day ? COLORS.gold : '#9bb4ff';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '6px 14px 6px 8px', borderRadius: 999,
      background: color + '10', border: `1px solid ${color}33`,
    }}>
      <span style={{
        width: 24, height: 24, borderRadius: 999, display: 'grid', placeItems: 'center',
        background: color + '22',
      }}
        title={day ? 'DAY' : 'NIGHT'}
        aria-label={day ? 'day' : 'night'}>
        {day ? <GlyphSun color={color} size={14} /> : <GlyphMoon color={color} size={14} />}
      </span>
      <span className="mono" style={{
        fontSize: 13, fontWeight: 700, letterSpacing: '0.05em', color: COLORS.text,
        lineHeight: 1, minWidth: 76, textAlign: 'left',
      }}>{timeStr}</span>
      {city && (
        <span className="mono" style={{
          fontSize: 9, color: COLORS.muted, letterSpacing: '0.06em',
          paddingLeft: 8, borderLeft: `1px solid ${color}25`,
        }}>{city}</span>
      )}
    </div>
  );
}

// Light / dark mode toggle. Persisted in `kata.theme` (shared with the kata
// dashboard pages) and applied via [data-theme] on <html>; the actual palette
// flip lives in styles.css.
function readThemeMode() {
  try {
    const m = localStorage.getItem('kata.theme');
    if (m === 'light' || m === 'dark') return m;
  } catch { /* ignore */ }
  // Default is light: only an explicit dark attribute keeps dark.
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

// Keep the browser UI chrome (mobile address bar) in sync with the theme.
function syncThemeColorMeta(mode) {
  try {
    document.querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', mode === 'light' ? '#f3eee4' : '#0d0a08');
  } catch { /* ignore */ }
}

function LightToggle({ title }) {
  const [mode, setMode] = useState(readThemeMode);
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', mode);
    syncThemeColorMeta(mode);
    try { localStorage.setItem('kata.theme', mode); } catch { /* ignore */ }
  }, [mode]);
  useEffect(() => {
    const onStorage = (e) => { if (e.key === 'kata.theme') setMode(readThemeMode()); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const light = mode === 'light';
  return (
    <button
      onClick={() => setMode(light ? 'dark' : 'light')}
      title={title}
      aria-label={title}
      className="mono"
      style={{
        display: 'flex', alignItems: 'center', gap: 7, height: 32,
        padding: '0 12px 0 9px', borderRadius: 999,
        border: '1px solid ' + COLORS.line, background: 'transparent',
        color: COLORS.text, cursor: 'pointer',
        fontSize: 10, letterSpacing: '0.14em', fontWeight: 700,
        transition: 'border-color 120ms, background 120ms',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = COLORS.text + '55'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = COLORS.line; }}
    >
      <span style={{
        width: 12, height: 12, borderRadius: 999, flex: 'none',
        background: light ? '#f3eee4' : '#0d0a08',
        boxShadow: '0 0 0 1px rgba(127,127,127,0.35)',
      }} />
      {light ? 'LIGHT' : 'DARK'}
    </button>
  );
}

function LangToggle({ lang, toggle, title }) {
  const isEn = lang === 'en';
  // Highlight the *current* language; the other half is the "click to switch" target.
  const active = COLORS.text;
  const inactive = COLORS.muted;
  return (
    <button
      onClick={toggle}
      title={title}
      aria-label={title}
      className="mono"
      style={{
        display: 'flex', alignItems: 'center', gap: 0,
        padding: '5px 4px', borderRadius: 999,
        background: 'transparent',
        border: '1px solid ' + COLORS.line,
        color: COLORS.text, cursor: 'pointer',
        fontSize: 10, letterSpacing: '0.14em', fontWeight: 700,
        height: 32,
        transition: 'border-color 120ms, background 120ms',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = COLORS.text + '55'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = COLORS.line; }}
    >
      <span style={{
        padding: '4px 8px', borderRadius: 999,
        background: isEn ? COLORS.text + '12' : 'transparent',
        color: isEn ? active : inactive,
      }}>EN</span>
      <span style={{ color: COLORS.muted, opacity: 0.4, fontSize: 9 }}>·</span>
      <span style={{
        padding: '4px 8px', borderRadius: 999,
        background: !isEn ? COLORS.text + '12' : 'transparent',
        color: !isEn ? active : inactive,
      }}>VI</span>
    </button>
  );
}

const THEME_OPTIONS = [
  { idx: null, label: 'AUTO',    swatch: null },
  { idx: 0,    label: 'RED',     swatch: ['#E04545'] },
  { idx: 1,    label: 'GREEN',   swatch: ['#5BA868'] },
  { idx: 2,    label: 'GOLD',    swatch: ['#D4A858'] },
  { idx: 3,    label: 'DUO R×G', swatch: ['#E04545', '#5BA868'] },
  { idx: 4,    label: 'DUO G×R', swatch: ['#D4A858', '#E04545'] },
  { idx: 5,    label: 'WHITE',   swatch: ['#FAFAF7'] },
];

function ThemeSwatch({ colors, size = 12 }) {
  const base = { width: size, height: size, borderRadius: 999, flexShrink: 0 };
  if (!colors) return <span style={{
    ...base,
    background: `conic-gradient(${COLORS.red}, ${COLORS.green}, ${COLORS.gold}, ${COLORS.red})`,
    border: '1px solid ' + COLORS.line,
  }} />;
  if (colors.length === 1) return <span style={{
    ...base, background: colors[0],
    boxShadow: `0 0 6px ${colors[0]}88`,
  }} />;
  return <span style={{
    ...base,
    background: `linear-gradient(135deg, ${colors[0]} 50%, ${colors[1]} 50%)`,
  }} />;
}

function ThemeToggle({ ambient, title }) {
  const { lockedIdx, setLockedIdx, isLive } = ambient;
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const current = THEME_OPTIONS.find((o) => o.idx === lockedIdx) || THEME_OPTIONS[0];

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        title={isLive ? 'Spotify live — theme override pauses until rotation resumes' : title}
        aria-label={title}
        className="mono"
        style={{
          height: 32, padding: '0 10px 0 9px', borderRadius: 999,
          background: 'transparent',
          border: '1px solid ' + (open ? COLORS.text + '55' : COLORS.line),
          color: COLORS.text, cursor: 'pointer',
          fontSize: 10, letterSpacing: '0.14em', fontWeight: 700,
          display: 'flex', alignItems: 'center', gap: 7,
          opacity: isLive ? 0.6 : 1,
          transition: 'border-color 120ms, opacity 120ms',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = COLORS.text + '55'; }}
        onMouseLeave={(e) => { if (!open) e.currentTarget.style.borderColor = COLORS.line; }}
      >
        <ThemeSwatch colors={current.swatch} />
        <span>{current.label}</span>
        <span style={{ color: COLORS.muted, fontSize: 9, marginLeft: -2 }}>▾</span>
      </button>
      {open && (
        <div role="menu" style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 60,
          minWidth: 160, padding: 6, borderRadius: 12,
          background: COLORS.panel, border: '1px solid ' + COLORS.line,
          boxShadow: '0 24px 60px -20px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.04)',
          animation: 'fadeUp 180ms ease-out',
        }}>
          {THEME_OPTIONS.map((opt) => {
            const active = opt.idx === lockedIdx;
            return (
              <button key={String(opt.idx)}
                onClick={() => { setLockedIdx(opt.idx); setOpen(false); }}
                className="mono"
                style={{
                  width: '100%', textAlign: 'left',
                  padding: '8px 10px', borderRadius: 8,
                  background: active ? COLORS.text + '12' : 'transparent',
                  border: 'none', color: COLORS.text, cursor: 'pointer',
                  fontSize: 10, letterSpacing: '0.14em', fontWeight: 700,
                  display: 'flex', alignItems: 'center', gap: 10,
                }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = COLORS.text + '08'; }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
              >
                <ThemeSwatch colors={opt.swatch} />
                <span style={{ flex: 1 }}>{opt.label}</span>
                {active && <span style={{ color: COLORS.text, fontSize: 9 }}>●</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Login button (when guest) / user menu (when authed).
function AuthChip() {
  const { status, user, login, logout } = useAuth();
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onEsc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  if (status === 'loading') {
    return (
      <div className="mono" style={{
        height: 32, padding: '0 12px', borderRadius: 999,
        border: '1px solid ' + COLORS.line, color: COLORS.muted,
        fontSize: 10, letterSpacing: '0.14em', display: 'flex', alignItems: 'center',
      }}>{t('auth.syncing')}</div>
    );
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {status === 'authed' ? (
        <button onClick={() => setOpen((v) => !v)}
          aria-label={user?.displayName || t('auth.signedInAs')}
          className="mono"
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            height: 32, padding: '2px 10px 2px 2px', borderRadius: 999,
            background: 'transparent', border: '1px solid ' + COLORS.line,
            color: COLORS.text, cursor: 'pointer',
            fontSize: 11, letterSpacing: '0.04em',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = COLORS.text + '55'; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = COLORS.line; }}
        >
          {user?.avatarUrl ? (
            <img src={user.avatarUrl} alt="" style={{
              width: 26, height: 26, borderRadius: 999, objectFit: 'cover',
              border: '1px solid ' + COLORS.line,
            }} />
          ) : (
            <span style={{
              width: 26, height: 26, borderRadius: 999,
              background: COLORS.red + '22', color: COLORS.red,
              display: 'grid', placeItems: 'center',
              fontSize: 11, fontWeight: 800,
            }}>{(user?.displayName || '?').slice(0, 1).toUpperCase()}</span>
          )}
          <span style={{
            maxWidth: 96, overflow: 'hidden', textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>{user?.displayName || user?.username || '—'}</span>
          <span style={{ color: COLORS.muted, fontSize: 9 }}>▾</span>
        </button>
      ) : (
        <button onClick={() => setOpen((v) => !v)}
          className="mono"
          style={{
            height: 32, padding: '0 14px', borderRadius: 999,
            background: COLORS.red + '14', border: `1px solid ${COLORS.red}55`,
            color: COLORS.red, cursor: 'pointer',
            fontSize: 11, letterSpacing: '0.14em', fontWeight: 700,
            textTransform: 'uppercase',
            display: 'flex', alignItems: 'center', gap: 6,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = COLORS.red + '22'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = COLORS.red + '14'; }}
        >
          {t('auth.signIn')}
        </button>
      )}

      {open && (
        <div role="menu" style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 60,
          minWidth: 240, padding: 12, borderRadius: 12,
          background: COLORS.panel, border: '1px solid ' + COLORS.line,
          boxShadow: '0 24px 60px -20px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.04)',
          animation: 'fadeUp 180ms ease-out',
        }}>
          {status === 'authed' ? (
            <>
              <div className="mono" style={{
                fontSize: 9, letterSpacing: '0.18em', color: COLORS.muted,
                padding: '4px 8px', marginBottom: 8,
              }}>{t('auth.signedInAs').toUpperCase()} · {user?.provider?.toUpperCase()}</div>
              <div style={{ padding: '4px 8px 10px', borderBottom: '1px solid ' + COLORS.line }}>
                <div className="mono" style={{ fontSize: 13, fontWeight: 700, color: COLORS.text }}>
                  {user?.displayName || '—'}
                </div>
                {user?.email && (
                  <div className="mono" style={{ fontSize: 10, color: COLORS.muted, marginTop: 3 }}>
                    {user.email}
                  </div>
                )}
              </div>
              <button onClick={() => { setOpen(false); logout(); }}
                className="mono"
                style={{
                  marginTop: 8, width: '100%', textAlign: 'left',
                  padding: '10px 12px', borderRadius: 8,
                  background: 'transparent', border: '1px solid ' + COLORS.line,
                  color: COLORS.text, cursor: 'pointer',
                  fontSize: 11, letterSpacing: '0.08em',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = COLORS.red + '12'; e.currentTarget.style.borderColor = COLORS.red + '55'; e.currentTarget.style.color = COLORS.red; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = COLORS.line; e.currentTarget.style.color = COLORS.text; }}
              >↩ {t('auth.logout')}</button>
            </>
          ) : (
            <>
              <div className="mono" style={{
                fontSize: 9, letterSpacing: '0.18em', color: COLORS.muted,
                padding: '4px 8px', marginBottom: 6,
              }}>{t('auth.signInTitle').toUpperCase()}</div>
              <div style={{ padding: '0 8px 10px', fontSize: 11, color: COLORS.muted, lineHeight: 1.5 }}>
                {t('auth.signInDesc')}
              </div>
              <ProviderBtn provider="discord" color="#5865F2" label={t('auth.discord')} onClick={() => login('discord')} />
              <div style={{ height: 6 }} />
              <ProviderBtn provider="google" color="#EA4335" label={t('auth.google')} onClick={() => login('google')} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ProviderBtn({ provider, color, label, onClick }) {
  return (
    <button onClick={onClick} className="mono"
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 12px', borderRadius: 8,
        background: color + '14', border: `1px solid ${color}50`,
        color: COLORS.text, cursor: 'pointer',
        fontSize: 12, letterSpacing: '0.04em', fontWeight: 600,
        transition: 'background 120ms',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = color + '24'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = color + '14'; }}
    >
      {provider === 'discord' && (
        <svg width="16" height="16" viewBox="0 0 24 24" fill={color}>
          <path d="M20.317 4.37a19.79 19.79 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.74 19.74 0 003.677 4.37a.07.07 0 00-.032.028C.533 9.046-.32 13.58.099 18.058a.082.082 0 00.031.056 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.873-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.1 13.1 0 01-1.872-.892.077.077 0 01-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 01.078-.01c3.928 1.793 8.18 1.793 12.061 0a.074.074 0 01.079.01c.12.099.246.197.373.291a.077.077 0 01-.006.128 12.3 12.3 0 01-1.873.891.076.076 0 00-.04.107c.36.698.772 1.363 1.225 1.993a.076.076 0 00.084.028 19.84 19.84 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.029zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
        </svg>
      )}
      {provider === 'google' && (
        <svg width="16" height="16" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M21.6 12.227c0-.709-.064-1.39-.182-2.045H12v3.868h5.382a4.6 4.6 0 01-1.995 3.018v2.51h3.232c1.891-1.741 2.981-4.305 2.981-7.351z" />
          <path fill="#34A853" d="M12 22c2.7 0 4.964-.895 6.619-2.422l-3.232-2.51c-.895.6-2.04.955-3.387.955-2.605 0-4.81-1.76-5.595-4.124H3.064v2.59A9.996 9.996 0 0012 22z" />
          <path fill="#FBBC05" d="M6.405 13.9a6.012 6.012 0 010-3.8V7.51H3.064a10.001 10.001 0 000 8.98l3.341-2.59z" />
          <path fill="#EA4335" d="M12 5.977c1.468 0 2.786.504 3.823 1.495l2.868-2.868C16.96 2.99 14.696 2 12 2 8.092 2 4.71 4.244 3.064 7.51l3.341 2.59C7.19 7.736 9.395 5.977 12 5.977z" />
        </svg>
      )}
      <span style={{ flex: 1, textAlign: 'left' }}>{label}</span>
      <span style={{ color: COLORS.muted, fontSize: 10 }}>↗</span>
    </button>
  );
}

// Reads ?auth_error=... from URL on mount, shows a small toast, clears the param.
function AuthErrorToast() {
  const { t } = useLang();
  const [err, setErr] = useState(null);
  useEffect(() => {
    const url = new URL(window.location.href);
    const e = url.searchParams.get('auth_error');
    if (e) {
      setErr(e);
      url.searchParams.delete('auth_error');
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
  }, []);
  if (!err) return null;
  return (
    <div role="alert" style={{
      position: 'fixed', top: 76, right: 24, zIndex: 70,
      padding: '12px 16px', borderRadius: 10,
      background: COLORS.panel, border: '1px solid ' + COLORS.red + '66',
      boxShadow: '0 16px 40px -16px ' + COLORS.red + '99',
      color: COLORS.text, fontSize: 12, lineHeight: 1.5,
      maxWidth: 320, display: 'flex', alignItems: 'flex-start', gap: 10,
      animation: 'fadeUp 200ms ease-out',
    }}>
      <span style={{ color: COLORS.red, fontSize: 14 }}>⚠</span>
      <div style={{ flex: 1 }}>
        <div className="mono" style={{
          fontSize: 10, letterSpacing: '0.18em', color: COLORS.red, fontWeight: 700,
        }}>{t('auth.error').toUpperCase()}</div>
        <div className="mono" style={{ fontSize: 11, color: COLORS.muted, marginTop: 4 }}>{err}</div>
      </div>
      <button onClick={() => setErr(null)} aria-label={t('auth.errorDismiss')}
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: COLORS.muted, fontSize: 14, padding: 0,
        }}>✕</button>
    </div>
  );
}

function NowPlaying({ ambient, on }) {
  const { track, playing, isLive, game } = ambient;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14,
      padding: '6px 16px 6px 8px', borderRadius: 999,
      background: COLORS.panel,
      border: '1px solid ' + (isLive ? '#1DB95455' : COLORS.line),
      maxWidth: 540,
      boxShadow: isLive ? '0 0 0 1px #1DB95422, 0 8px 24px -12px #1DB95455' : 'none',
      transition: 'border-color 600ms, box-shadow 600ms',
    }}>
      <div style={{
        width: 38, height: 38, borderRadius: 8, flexShrink: 0,
        background: track.coverUrl
          ? `url(${track.coverUrl}) center/cover no-repeat`
          : `linear-gradient(135deg, ${track.palette[0]}, ${track.palette[1] || COLORS.green})`,
        display: 'grid', placeItems: 'center',
        position: 'relative', overflow: 'hidden',
      }}>
        {!track.coverUrl && (
          <span className="mono" style={{
            fontSize: 11, color: '#0d0a08', fontWeight: 800, letterSpacing: '0.05em',
          }}>{track.album.slice(0, 3)}</span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 18 }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} style={{
            width: 2.5, height: 18, background: track.palette[0],
            borderRadius: 1, transformOrigin: 'bottom',
            animation: playing && on ? `eq ${0.6 + i * 0.13}s ease-in-out ${i * 0.06}s infinite` : 'none',
            opacity: playing && on ? 1 : 0.3,
          }} />
        ))}
      </div>
      <div style={{ minWidth: 0, flex: 1, lineHeight: 1.2 }}>
        <div className="mono" style={{
          fontSize: 12, fontWeight: 700, color: COLORS.text,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{track.title}</div>
        <div className="mono" style={{
          fontSize: 9, color: COLORS.muted, letterSpacing: '0.08em', marginTop: 2,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{track.artist}{track.album ? ' · ' + track.album : ''}</div>
      </div>
      {game && <GameChip game={game} />}
    </div>
  );
}

function GameChip({ game }) {
  return (
    <div title={[game.name, game.details, game.state].filter(Boolean).join(' · ')}
      style={{
        display: 'flex', alignItems: 'center',
        padding: '4px 12px', borderRadius: 999,
        background: COLORS.red + '12',
        border: '1px solid ' + COLORS.red + '40',
        maxWidth: 200, flexShrink: 0,
      }}>
      <div style={{ minWidth: 0 }}>
        <div className="mono" style={{
          fontSize: 8, letterSpacing: '0.16em', color: COLORS.red, fontWeight: 700, lineHeight: 1,
        }}>PLAYING</div>
        <div className="mono" style={{
          fontSize: 10, color: COLORS.text, marginTop: 2, lineHeight: 1.1,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140,
        }}>{game.name}</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Nav rail
// ─────────────────────────────────────────────────────────────
function NavRail({ route, nav }) {
  const { user } = useAuth();
  const isOwner = !!user?.isHistoryOwner;
  const visibleFeatures = FEATURES.filter((f) => !f.ownerOnly || isOwner);
  return (
    <aside style={{
      position: 'fixed', top: 64, left: 0, bottom: 0,
      width: 84, zIndex: 40,
      borderRight: '1px solid ' + COLORS.line,
      background: 'rgba(13,10,8,0.6)',
      backdropFilter: 'blur(8px)',
      padding: '20px 0',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
    }}>
      {visibleFeatures.map((f) => {
        const active = f.id === route;
        return (
          <button key={f.id} onClick={() => nav(f.id)} title={f.label}
            style={{
              width: 56, height: 56, borderRadius: 12,
              background: active ? f.accent + '1a' : 'transparent',
              border: `1px solid ${active ? f.accent + '60' : 'transparent'}`,
              color: active ? f.accent : COLORS.muted,
              cursor: 'pointer',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 4, transition: 'background 120ms, color 120ms, border-color 120ms',
              position: 'relative',
            }}
            onMouseEnter={(e) => {
              if (!active) {
                e.currentTarget.style.color = COLORS.text;
                e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
              }
            }}
            onMouseLeave={(e) => {
              if (!active) {
                e.currentTarget.style.color = COLORS.muted;
                e.currentTarget.style.background = 'transparent';
              }
            }}
          >
            <span style={{
              fontFamily: 'JetBrains Mono, monospace', fontSize: 18, fontWeight: 700, lineHeight: 1,
              display: 'grid', placeItems: 'center', height: 20,
            }}>
              {typeof f.icon === 'function' ? f.icon('currentColor') : f.icon}
            </span>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 8, letterSpacing: '0.16em' }}>
              {f.short}
            </span>
            {active && (
              <span style={{
                position: 'absolute', left: -1, top: 12, bottom: 12, width: 2,
                background: f.accent, borderRadius: 2,
              }} />
            )}
          </button>
        );
      })}
      <div style={{ flex: 1 }} />
      <NavSocials />
    </aside>
  );
}

// 5 social links. On desktop they sit stacked at the bottom of the nav rail.
// On mobile, collapse to a single toggle icon — tap expands the 5 icons upward.
function NavSocials() {
  const isMobile = useMediaQuery('(max-width: 768px)');
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('touchstart', onDoc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('touchstart', onDoc);
    };
  }, [open]);

  if (!isMobile) {
    return (
      <div style={{
        borderTop: '1px solid ' + COLORS.line, paddingTop: 14,
        display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center',
      }}>
        {SOCIALS.map((s) => (
          <a key={s.id} href={s.href} aria-label={s.label} title={s.label}
            style={{
              width: 32, height: 32, display: 'grid', placeItems: 'center',
              color: COLORS.muted, transition: 'color 120ms, transform 120ms',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = COLORS.red;
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = COLORS.muted;
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >{s.icon}</a>
        ))}
      </div>
    );
  }

  return (
    <div ref={ref} style={{
      borderTop: '1px solid ' + COLORS.line, paddingTop: 14,
      width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center',
      position: 'relative',
    }}>
      {open && (
        <div style={{
          position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
          marginBottom: 8,
          padding: '8px 6px', borderRadius: 12,
          background: COLORS.panel, border: '1px solid ' + COLORS.line,
          boxShadow: '0 16px 40px -16px rgba(0,0,0,0.6)',
          display: 'flex', flexDirection: 'column', gap: 4,
          animation: 'fadeUp 160ms ease-out',
        }}>
          {SOCIALS.map((s) => (
            <a key={s.id} href={s.href} aria-label={s.label} title={s.label}
              onClick={() => setOpen(false)}
              style={{
                width: 32, height: 32, borderRadius: 8,
                display: 'grid', placeItems: 'center',
                color: COLORS.muted, transition: 'color 120ms, background 120ms',
              }}
              onTouchStart={(e) => { e.currentTarget.style.color = COLORS.red; }}
            >{s.icon}</a>
          ))}
        </div>
      )}
      <button onClick={() => setOpen((v) => !v)} aria-label={open ? 'Collapse' : 'Expand socials'}
        style={{
          width: 32, height: 32, borderRadius: 8,
          background: open ? COLORS.red + '14' : 'transparent',
          border: '1px solid ' + (open ? COLORS.red + '55' : COLORS.line),
          color: open ? COLORS.red : COLORS.muted,
          cursor: 'pointer', display: 'grid', placeItems: 'center',
          transition: 'background 120ms, color 120ms, border-color 120ms',
        }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {/* simple "share / link" glyph */}
          <circle cx="6" cy="12" r="2" />
          <circle cx="18" cy="6" r="2" />
          <circle cx="18" cy="18" r="2" />
          <line x1="8" y1="11" x2="16" y2="7" />
          <line x1="8" y1="13" x2="16" y2="17" />
        </svg>
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Breadcrumbs
// ─────────────────────────────────────────────────────────────
function Breadcrumbs({ route, nav, feature }) {
  const { t } = useLang();
  const featureLabel = feature ? feature.label : '';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      marginBottom: 18, gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={() => nav('home')} className="mono" style={{
          background: 'transparent', border: 'none', color: COLORS.muted, cursor: 'pointer',
          fontSize: 11, letterSpacing: '0.2em',
        }}>HOME</button>
        {route !== 'home' && (
          <>
            <span className="mono" style={{ color: COLORS.muted, opacity: 0.4 }}>/</span>
            <span className="mono" style={{ fontSize: 11, letterSpacing: '0.2em', color: COLORS.text }}>
              {featureLabel.toUpperCase()}
            </span>
            <span className="mono" style={{
              padding: '3px 8px', borderRadius: 999,
              background: feature?.accent + '14',
              border: `1px solid ${feature?.accent}40`,
              color: feature?.accent, fontSize: 9, letterSpacing: '0.16em',
            }}>{feature?.short}</span>
          </>
        )}
      </div>
      {route !== 'home' && (
        <button onClick={() => nav('home')} className="mono" style={{
          padding: '7px 14px', borderRadius: 8,
          background: 'transparent', border: '1px solid ' + COLORS.line,
          color: COLORS.muted, fontSize: 10, letterSpacing: '0.14em',
          cursor: 'pointer',
        }}>{t('breadcrumb.escHome')}</button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Home view
// ─────────────────────────────────────────────────────────────
// Short maker/builder one-liners rotated at random in the hero headline.
const QUOTES = [
  'Ask better questions.', 'Think in systems.', "Ship before you're ready.", 'Archive everything.',
  'Done beats perfect.', 'Start small, ship often.', 'Make it work, then make it right.', 'Less, but better.',
  'Simplicity scales.', 'Build in public.', 'Move with intent.', 'Curiosity compounds.',
  'Read the source.', 'Write to think.', 'Measure, then cut.', 'Default to action.',
  'Kill your darlings.', 'Iterate relentlessly.', 'Stay close to the work.', 'Trust the process.',
  'Focus is a superpower.', 'Slow is smooth, smooth is fast.', 'Make the invisible visible.', 'Question every default.',
  'Ship the smallest thing.', 'Notes are a second brain.', 'Edit ruthlessly.', 'Begin again.',
  'Small steps, every day.', 'Done is a feature.', 'Constraints breed creativity.', 'Build what you wish existed.',
  'Taste is a muscle.', 'Sweat the details.', 'Ship, then learn.', 'Optimize for momentum.',
  'Keep it boring.', 'Reduce, reuse, refactor.', 'Make it obvious.', 'Code is a liability.',
  'Delete more than you add.', 'Clarity over cleverness.', 'Think slow, act fast.', 'Protect your focus.',
  'Compounding is quiet.', 'Be hard to distract.', 'Finish what you start.', 'Make tomorrow easier.',
  'Leave it better.', 'Stay curious.', 'Do the obvious thing.', 'One thing at a time.',
  'Patience is leverage.', "Show, don't tell.", 'Make it real.', 'Prototype the future.',
  'Embrace the boring stack.', 'Automate the tedious.', 'Build for yourself first.', 'Listen more than you speak.',
  'Strong opinions, loosely held.', 'Be a beginner often.', 'Practice in public.', 'Keep shipping.',
  'Make space to think.', 'Tend your garden.', 'Small bets, often.', 'Direction over speed.',
  'Choose your hard.', 'Quiet the noise.', 'Build the muscle.', 'Trust your taste.',
  'Stay in motion.', 'Make it yours.', 'Think for yourself.', 'Read widely, build narrowly.',
  'Cut scope, not quality.', 'Energy follows attention.', "Begin before you're ready.", 'Keep the loop tight.',
  'Ship daily.', 'Less hype, more craft.', 'Make it durable.', 'Aim small, miss small.',
  'Default to curiosity.', 'Earn your simplicity.', 'Build, measure, learn.', 'Stay humble, ship anyway.',
  'Notes outlive memory.', 'Done is the engine.', 'Care is the differentiator.', 'Make the next step easy.',
  'Slow down to speed up.', "Refine, don't restart.", 'Protect deep work.', 'Make it once, reuse forever.',
  'Question the brief.', 'Polish the rough edges.', 'Keep the spark.', 'Build things that last.',
];

// Pick 2–3 random non-space character positions in a quote to glow.
function pickGlowIndices(str) {
  const idxs = [];
  for (let k = 0; k < str.length; k++) if (str[k] !== ' ') idxs.push(k);
  for (let k = idxs.length - 1; k > 0; k--) {
    const j = Math.floor(Math.random() * (k + 1));
    [idxs[k], idxs[j]] = [idxs[j], idxs[k]];
  }
  const count = Math.min(idxs.length, 2 + Math.floor(Math.random() * 2)); // 2 or 3
  return new Set(idxs.slice(0, count));
}

// Drifting module-color dots connected with thin lines, sitting behind the hero.
function Constellation({ height = 360, dotCount = 18 }) {
  const wrapRef = useRef(null);
  const [size, setSize] = useState({ w: 800, h: height });
  const [t, setT] = useState(0);
  const modules = FEATURES.filter((f) => f.id !== 'home');

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(() => {
      const r = wrapRef.current.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let raf;
    const start = performance.now();
    const loop = (now) => {
      setT((now - start) / 1000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const dots = useMemo(() => {
    const out = [];
    for (let i = 0; i < dotCount; i++) {
      const m = modules[i % modules.length];
      const seed = i * 17.31;
      out.push({
        i, color: m.accent,
        cx: 0.1 + ((seed * 0.13) % 0.8),
        cy: 0.1 + ((seed * 0.21) % 0.8),
        amp: 0.02 + ((seed * 0.07) % 0.04),
        freq: 0.25 + ((seed * 0.05) % 0.3),
        phase: (seed * 1.7) % (Math.PI * 2),
        r: 1.6 + ((seed * 0.11) % 1.2),
      });
    }
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dotCount]);

  const pts = dots.map((d) => ({
    ...d,
    x: (d.cx + Math.cos(t * d.freq + d.phase) * d.amp) * size.w,
    y: (d.cy + Math.sin(t * d.freq * 0.8 + d.phase) * d.amp) * size.h,
  }));

  const edges = [];
  const MAX = Math.min(size.w, size.h) * 0.28;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[i].x - pts[j].x;
      const dy = pts[i].y - pts[j].y;
      const d = Math.hypot(dx, dy);
      if (d < MAX) edges.push({ a: pts[i], b: pts[j], d });
    }
  }

  return (
    <div ref={wrapRef} aria-hidden style={{
      position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0,
      overflow: 'hidden',
    }}>
      <svg width={size.w} height={size.h} style={{ display: 'block' }}>
        {edges.map((e, i) => {
          const alpha = 1 - e.d / MAX;
          return (
            <line key={i} x1={e.a.x} y1={e.a.y} x2={e.b.x} y2={e.b.y}
              stroke={COLORS.text} strokeWidth="0.6" opacity={alpha * 0.18} />
          );
        })}
        {pts.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={p.r * 3} fill={p.color} opacity="0.10" />
            <circle cx={p.x} cy={p.y} r={p.r} fill={p.color} opacity="0.6" />
          </g>
        ))}
      </svg>
    </div>
  );
}

function ExperimentWatermark({ number = EXPERIMENT_NUMBER }) {
  return (
    <div aria-hidden style={{
      position: 'absolute', top: -40, right: -20, pointerEvents: 'none', zIndex: 0,
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 340, fontWeight: 800, letterSpacing: '-0.04em', lineHeight: 1,
      color: 'transparent',
      WebkitTextStroke: `1px ${COLORS.red}26`,
      opacity: 0.65,
      userSelect: 'none',
      animation: 'breath 6s ease-in-out infinite',
    }}>
      {number}
    </div>
  );
}

function MarqueeTicker({ speed = 60, items, minRepeats = 6 }) {
  // For short item lists we need to repeat enough times that the marquee track
  // is wider than the viewport even after the -50% translate, otherwise the
  // right side stays blank between loops.
  const reps = Math.max(2, minRepeats);
  const doubled = Array.from({ length: reps }).flatMap(() => items);
  return (
    <div style={{
      width: '100%', overflow: 'hidden', position: 'relative',
      padding: '10px 0', borderTop: `1px solid ${COLORS.line}`,
      borderBottom: `1px solid ${COLORS.line}`,
      background: 'rgba(13,10,8,0.5)',
      maskImage: 'linear-gradient(90deg, transparent, #000 5%, #000 95%, transparent)',
      WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 5%, #000 95%, transparent)',
    }}>
      <div style={{
        display: 'inline-flex', gap: 28, whiteSpace: 'nowrap',
        animation: `ticker ${speed}s linear infinite`,
        paddingLeft: 28,
      }}>
        {doubled.map((it, i) => (
          <span key={i} className="mono" style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            fontSize: 11, letterSpacing: '0.18em', color: it.c, fontWeight: 700,
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: 999, background: it.c,
              boxShadow: `0 0 6px ${it.c}aa`,
            }} />
            {it.t}
          </span>
        ))}
      </div>
    </div>
  );
}

function HomeView({ nav, ambient, ambientOn }) {
  const { t } = useLang();
  const { user } = useAuth();
  const [quoteIdx, setQuoteIdx] = useState(() => Math.floor(Math.random() * QUOTES.length));
  const [typed, setTyped] = useState('');
  // 2–3 random chars in THIS quote glow (re-rolled each quote).
  const glowSet = useMemo(() => pickGlowIndices(QUOTES[quoteIdx]), [quoteIdx]);
  const [markets, setMarkets] = useState({ btc: null, gold: null, twd: null, vnd: null });
  // Typewriter for the active quote: type in → hold ~10s → backspace out →
  // advance to a new random quote (which re-runs this effect).
  useEffect(() => {
    const full = QUOTES[quoteIdx];
    const TYPE_MS = 48, ERASE_MS = 24, HOLD_MS = 8200;
    let i = 0, cancelled = false, timer;
    function type() {
      if (cancelled) return;
      i += 1;
      setTyped(full.slice(0, i));
      timer = setTimeout(i < full.length ? type : erase, i < full.length ? TYPE_MS : HOLD_MS);
    }
    function erase() {
      if (cancelled) return;
      i -= 1;
      setTyped(full.slice(0, Math.max(0, i)));
      if (i > 0) { timer = setTimeout(erase, ERASE_MS); return; }
      setQuoteIdx((cur) => {
        let n = Math.floor(Math.random() * QUOTES.length);
        if (QUOTES.length > 1 && n === cur) n = (n + 1) % QUOTES.length;
        return n;
      });
    }
    setTyped('');
    timer = setTimeout(type, 140);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [quoteIdx]);

  // Live BTC + gold + TWD↔VND for the ticker. /api/crypto polls CoinGecko + FX
  // upstream and exposes them on a single endpoint. Refresh every 60s like the
  // CryptoWatch module so we don't double-bill.
  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const r = await fetch('/api/crypto');
        if (!r.ok) return;
        const d = await r.json();
        if (!alive) return;
        setMarkets({
          btc: Number.isFinite(d.btc) ? d.btc : null,
          gold: Number.isFinite(d.gold) ? d.gold : null,
          twd: Number.isFinite(d.twd) ? d.twd : null,
          vnd: Number.isFinite(d.vnd) ? d.vnd : null,
        });
      } catch {}
    }
    poll();
    const id = setInterval(poll, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const fmtBtc = (v) => v == null ? '—' : '$' + Math.round(v).toLocaleString('en-US');
  const fmtGold = (v) => v == null ? '—' : v.toFixed(2);
  // /api/crypto returns USD→TWD and USD→VND. Convert to TWD→VND directly.
  const twdVnd = (markets.twd && markets.vnd) ? markets.vnd / markets.twd : null;
  const fmtTwdVnd = (v) => v == null ? '—' : v.toFixed(0);

  const tickerItems = useMemo(() => [
    { c: COLORS.gold, t: 'BTC · ' + fmtBtc(markets.btc) },
    { c: COLORS.gold, t: 'GOLD/OZ · ' + fmtGold(markets.gold) },
    { c: COLORS.green, t: '1 TWD · ' + fmtTwdVnd(twdVnd) + ' VND' },
  ], [markets.btc, markets.gold, twdVnd]);

  return (
    <div>
      <section style={{ position: 'relative', marginBottom: 36, padding: '4px 0' }}>
        <Constellation />
        <ExperimentWatermark />

        <div style={{ position: 'relative', zIndex: 1 }}>
          <Kicker style={{ marginBottom: 14, color: COLORS.red }}>● ONLINE · EXP {EXPERIMENT_NUMBER}</Kicker>
          <div style={{ maxWidth: 1000, minHeight: 152, display: 'grid', alignItems: 'center' }}>
            <h1 style={{
              margin: 0,
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 62, lineHeight: 1.12, fontWeight: 800, letterSpacing: '-0.03em',
            }}>
              {[...typed].map((ch, idx) => {
                const glow = glowSet.has(idx);
                return (
                  <span
                    key={idx}
                    className={glow ? 'qglow' : undefined}
                    style={{ color: glow ? COLORS.red : COLORS.text, animation: 'fadeIn 150ms ease-out' }}
                  >{ch}</span>
                );
              })}
              <span style={{
                display: 'inline-block', width: 14, height: 46,
                marginLeft: 10, verticalAlign: '-7px',
                background: COLORS.red,
                boxShadow: `0 0 18px ${COLORS.red}66`,
                animation: 'blink 1s steps(1) infinite',
              }} />
            </h1>
          </div>
          <p style={{
            margin: '20px 0 0', maxWidth: 720,
            fontSize: 16, color: COLORS.muted, lineHeight: 1.6,
          }}>
            A personal control surface — your modules wired to one prompt.
            AI, finance, travel, subscriptions, tools, and the KataS bot ops, woven into a single command center.
          </p>
          <div style={{ marginTop: 26, display: 'flex', gap: 10 }}>
            <Btn variant="solid" color={COLORS.red} onClick={() => nav('ai')}>{t('home.openAi')}</Btn>
            <Btn variant="ghost" onClick={() => nav('crypto')}>{t('home.markets')}</Btn>
            <Btn variant="ghost" onClick={() => nav('todo')}>{t('home.todo')}</Btn>
          </div>
        </div>
      </section>

      <div style={{ margin: '36px -32px 36px -84px' }}>
        <MarqueeTicker speed={30} items={tickerItems} />
      </div>

      <section style={{ marginBottom: 28 }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
          marginBottom: 18,
        }}>
          <div>
            <Kicker>MODULES · {String(FEATURES.filter((f) => f.id !== 'home' && (!f.ownerOnly || user?.isHistoryOwner)).length).padStart(2, '0')}</Kicker>
            <div className="mono" style={{ fontSize: 20, fontWeight: 700, marginTop: 6, letterSpacing: '-0.01em' }}>
              The dashboard
            </div>
          </div>
          <Kicker style={{ color: COLORS.green }}>● ALL ONLINE</Kicker>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
          gap: 16,
        }}>
          {FEATURES.filter((f) => f.id !== 'home' && (!f.ownerOnly || user?.isHistoryOwner)).map((f, i) => (
            <FeatureCard
              key={f.id}
              feature={f}
              onClick={() => nav(f.id)}
              idx={i}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Floating chat — global FAB, expand on click, ESC to close
// Routes to /api/agent which auto-picks chat / image gen / image edit /
// video gen / bg-remove based on the user's prompt.
// ─────────────────────────────────────────────────────────────
function ChatFab({ open, onOpen, onClose, ambient, nav }) {
  const { t } = useLang();
  const [history, setHistory] = useSyncedData(
    { localKey: 'se77n.ai.history.v2', serverKey: 'aiHistory' },
    {},
  );
  const messages = history.chat || [];
  const recent = messages.slice(-6);
  const [input, setInput] = useState('');
  const [imgRef, setImgRef] = useState(null);
  const [busy, setBusy] = useState(false);
  const [busyHint, setBusyHint] = useState(t('fab.thinking'));
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const accent = ambient?.isLive ? '#1DB954' : COLORS.red;

  // Clipboard paste — only while expanded
  const handlePaste = useCallback((img) => setImgRef(img), []);
  usePasteImage(handlePaste, open);

  useEffect(() => {
    if (open) {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [open, messages.length, busy]);

  async function send(retry) {
    const q = retry ? retry.prompt : input.trim();
    const used = retry ? retry.image : imgRef;
    if ((!q && !used) || busy) return;
    if (retry) {
      setHistory((h) => ({ ...h, chat: (h.chat || []).filter((x) => !x.error) }));
    } else {
      setInput('');
      setImgRef(null);
      setHistory((h) => ({
        ...h,
        chat: [...(h.chat || []), { role: 'user', content: q || '(image)', image: used?.dataUrl }],
      }));
    }
    setBusy(true);
    setBusyHint(used ? t('fab.analyzing') : t('fab.thinking'));
    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: q, image: used?.dataUrl, threadId: 'agent', history: buildChatHistory(messages, retry ? q : undefined) }),
      });
      const data = await res.json();
      if (!res.ok && res.status !== 202) throw new Error(data.error || `agent ${res.status}`);

      let assistantMsg;
      if (data.kind === 'image') {
        assistantMsg = { role: 'assistant', content: '', image: data.image, intent: data.intent };
      } else if (data.kind === 'video') {
        assistantMsg = { role: 'assistant', content: '', video: data.video, intent: data.intent };
      } else if (data.kind === 'pending') {
        assistantMsg = {
          role: 'assistant',
          content: '◇ Still rendering — ' + (data.intent || 'job') + ' often exceeds 60s. Try again or shorten the prompt.',
          intent: data.intent,
        };
      } else if (data.empty) {
        assistantMsg = { role: 'assistant', content: '⚠ ' + t('fab.empty'), error: true, retry: { prompt: q, image: used } };
      } else {
        assistantMsg = { role: 'assistant', content: data.text || '', intent: data.intent || 'chat' };
      }
      setHistory((h) => ({ ...h, chat: [...(h.chat || []), assistantMsg] }));
    } catch (e) {
      setHistory((h) => ({
        ...h,
        chat: [...(h.chat || []), { role: 'assistant', content: '⚠ ' + (e.message || 'error'), error: true, retry: { prompt: q, image: used } }],
      }));
    } finally {
      setBusy(false);
    }
  }

  function onImage(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = (ev) => setImgRef({ name: f.name, dataUrl: ev.target.result });
    reader.readAsDataURL(f);
    e.target.value = '';
  }

  if (!open) {
    return (
      <button onClick={onOpen} aria-label={t('fab.openChat')}
        style={{
          position: 'fixed', right: 24, bottom: 24, zIndex: 60,
          padding: '13px 20px 13px 16px', borderRadius: 999,
          background: accent, color: '#0d0a08',
          border: 'none', fontFamily: 'inherit',
          fontWeight: 700, fontSize: 13, letterSpacing: '0.01em',
          cursor: 'pointer',
          boxShadow: `0 14px 40px -10px ${accent}aa, 0 0 0 1px ${accent}66`,
          display: 'flex', alignItems: 'center', gap: 10,
          transition: 'transform 150ms, box-shadow 150ms',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'translateY(-2px)';
          e.currentTarget.style.boxShadow = `0 18px 48px -10px ${accent}cc, 0 0 0 1px ${accent}99`;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.boxShadow = `0 14px 40px -10px ${accent}aa, 0 0 0 1px ${accent}66`;
        }}
      >
        <ChatBubbleIcon size={16} color="#0d0a08" />
        {t('fab.ask')}
      </button>
    );
  }

  return (
    <div role="dialog" aria-label={t('fab.openChat')}
      style={{
        position: 'fixed', right: 24, bottom: 24, zIndex: 60,
        width: 400, maxWidth: 'calc(100vw - 32px)',
        height: 'min(560px, calc(100vh - 96px))',
        display: 'flex', flexDirection: 'column',
        borderRadius: 18, overflow: 'hidden',
        background: COLORS.panel,
        border: '1px solid ' + accent + '55',
        boxShadow: `0 28px 64px -20px rgba(0,0,0,0.6), 0 0 0 1px ${accent}22`,
        animation: 'fadeUp 220ms cubic-bezier(0.22,1,0.36,1)',
      }}>
      <div style={{
        padding: '12px 12px 12px 18px', borderBottom: '1px solid ' + COLORS.line,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            width: 6, height: 6, borderRadius: 999, background: accent,
            boxShadow: `0 0 6px ${accent}`,
          }} />
          <div className="mono" style={{ fontSize: 13, fontWeight: 700, color: COLORS.text }}>
            {t('fab.ask')}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <FabHeaderBtn title={t('fab.openFull')} onClick={() => { onClose(); nav('ai'); }}>↗</FabHeaderBtn>
          <FabHeaderBtn title={t('fab.close')} onClick={onClose}>✕</FabHeaderBtn>
        </div>
      </div>

      <div ref={scrollRef} style={{
        flex: 1, padding: '14px 16px', overflowY: 'auto',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        {recent.length === 0 ? (
          <div style={{
            padding: '12px 14px', borderRadius: 10,
            background: COLORS.bg, border: '1px solid ' + COLORS.line,
            fontSize: 13, lineHeight: 1.5, color: COLORS.text,
          }}>
            <div className="mono" style={{
              fontSize: 9, letterSpacing: '0.2em', color: accent, fontWeight: 700, marginBottom: 6,
            }}>se77n ::</div>
            Need help?
          </div>
        ) : (
          recent.map((m, i) => <ChatBubble key={i} msg={m} accent={accent} onRetry={m.error && m.retry ? () => send(m.retry) : null} retryLabel={t('ai.retry')} />)
        )}
        {busy && <ChatBubble msg={{ role: 'assistant', content: busyHint + '…' }} accent={accent} typing />}
      </div>

      {imgRef && (
        <div style={{
          padding: '8px 14px', borderTop: '1px solid ' + COLORS.line,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <img src={imgRef.dataUrl} alt="" style={{
            width: 40, height: 40, borderRadius: 6, objectFit: 'cover',
            border: '1px solid ' + accent + '55',
          }} />
          <div className="mono" style={{
            fontSize: 10, color: COLORS.muted, flex: 1,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{imgRef.name}</div>
          <button onClick={() => setImgRef(null)} aria-label="Remove image"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: COLORS.muted, fontSize: 14, padding: 4,
            }}>✕</button>
        </div>
      )}

      <div style={{
        padding: '10px 12px', borderTop: '1px solid ' + COLORS.line,
        background: COLORS.panel2,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <label title="Attach image"
          style={{
            display: 'grid', placeItems: 'center', width: 34, height: 34, borderRadius: 8,
            background: imgRef ? accent + '1a' : 'transparent',
            border: `1px solid ${imgRef ? accent : COLORS.line}`,
            color: imgRef ? accent : COLORS.muted, cursor: 'pointer', flexShrink: 0,
          }}>
          <input type="file" accept="image/*" onChange={onImage} style={{ display: 'none' }} />
          <PaperclipIcon size={15} color="currentColor" />
        </label>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t('fab.placeholder')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
          }}
          className="mono"
          style={{
            flex: 1, background: COLORS.bg,
            border: '1px solid ' + COLORS.line, borderRadius: 8,
            padding: '9px 12px', color: COLORS.text, fontSize: 12,
            outline: 'none', transition: 'border-color 120ms, box-shadow 120ms',
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = accent;
            e.currentTarget.style.boxShadow = `0 0 0 3px ${accent}22`;
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = COLORS.line;
            e.currentTarget.style.boxShadow = 'none';
          }}
        />
        <button onClick={send} disabled={busy || (!input.trim() && !imgRef)} className="mono"
          aria-label="send"
          style={{
            padding: '9px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700,
            background: (input.trim() || imgRef) && !busy ? accent : 'transparent',
            border: '1px solid ' + ((input.trim() || imgRef) && !busy ? accent : COLORS.line),
            color: (input.trim() || imgRef) && !busy ? '#0d0a08' : COLORS.muted,
            cursor: busy ? 'not-allowed' : 'pointer',
            opacity: busy ? 0.5 : 1,
            transition: 'background 120ms',
          }}>↗</button>
      </div>
    </div>
  );
}

function FabHeaderBtn({ children, onClick, title }) {
  return (
    <button onClick={onClick} title={title}
      style={{
        width: 28, height: 28, borderRadius: 8,
        background: 'transparent', border: '1px solid ' + COLORS.line,
        color: COLORS.muted, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit',
        display: 'grid', placeItems: 'center',
        transition: 'color 120ms, border-color 120ms',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.color = COLORS.text; e.currentTarget.style.borderColor = COLORS.text + '55'; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = COLORS.muted; e.currentTarget.style.borderColor = COLORS.line; }}
    >{children}</button>
  );
}

const INTENT_BADGE = {
  image_gen:  { label: '✨ Image · generated', color: '#C77BFF' },
  image_edit: { label: '✏ Image · edited',    color: '#C77BFF' },
  bg_remove:  { label: '⊘ Background · removed', color: '#7ABEFF' },
  video_gen:  { label: '▶ Video · generated', color: '#D4A858' },
};

function ChatBubble({ msg, accent, typing, onRetry, retryLabel }) {
  const isUser = msg.role === 'user';
  const badge = !isUser && msg.intent ? INTENT_BADGE[msg.intent] : null;
  return (
    <div style={{
      maxWidth: '92%',
      alignSelf: isUser ? 'flex-end' : 'flex-start',
      padding: '10px 13px', borderRadius: 10,
      background: isUser ? accent + '18' : COLORS.bg,
      border: `1px solid ${isUser ? accent + '40' : COLORS.line}`,
      fontSize: 12.5, lineHeight: 1.55,
      whiteSpace: 'pre-wrap',
      fontFamily: isUser ? "'JetBrains Mono', monospace" : "'Geist', system-ui, sans-serif",
      color: COLORS.text,
      animation: 'fadeUp 200ms ease-out',
    }}>
      {!isUser && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6,
          flexWrap: 'wrap',
        }}>
          <span className="mono" style={{
            fontSize: 8, letterSpacing: '0.2em', color: accent, fontWeight: 700,
          }}>se77n ::</span>
          {badge && (
            <span className="mono" style={{
              fontSize: 8, letterSpacing: '0.16em', fontWeight: 700,
              padding: '2px 6px', borderRadius: 4,
              background: badge.color + '1a', color: badge.color,
              border: `1px solid ${badge.color}40`,
            }}>{badge.label}</span>
          )}
        </div>
      )}
      {msg.image && (
        <a href={msg.image} target="_blank" rel="noreferrer">
          <img src={msg.image} alt="" style={{
            display: 'block', maxWidth: '100%', borderRadius: 8,
            marginBottom: msg.content ? 8 : 0,
            border: '1px solid ' + COLORS.line,
          }} />
        </a>
      )}
      {msg.video && (
        <video src={msg.video} controls style={{
          display: 'block', maxWidth: '100%', borderRadius: 8,
          marginBottom: msg.content ? 8 : 0,
        }} />
      )}
      {typing ? (
        <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
          {[0, 1, 2].map((i) => (
            <span key={i} style={{
              width: 5, height: 5, borderRadius: 999, background: COLORS.text, opacity: 0.45,
              animation: `pulse 1s ease-in-out ${i * 0.15}s infinite`,
            }} />
          ))}
          {msg.content && (
            <span className="mono" style={{ fontSize: 10, color: COLORS.muted, marginLeft: 6 }}>
              {msg.content.replace(/…$/, '')}
            </span>
          )}
        </span>
      ) : msg.content}
      {onRetry && (
        <div style={{ marginTop: 8 }}>
          <button onClick={onRetry} className="mono" style={{
            fontSize: 10, letterSpacing: '0.15em', padding: '4px 10px', borderRadius: 999,
            background: 'transparent', border: `1px solid ${COLORS.red}66`, color: COLORS.red, cursor: 'pointer',
          }}>↻ {retryLabel}</button>
        </div>
      )}
    </div>
  );
}

function FeatureCard({ feature, onClick, idx }) {
  const [hover, setHover] = useState(false);
  const label = feature.label;
  const desc = feature.desc;
  const iconNode = typeof feature.icon === 'function' ? feature.icon(feature.accent) : feature.icon;
  return (
    <button onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        textAlign: 'left', padding: 22, borderRadius: 14,
        background: COLORS.panel,
        border: '1px solid ' + (hover ? feature.accent + '70' : COLORS.line),
        cursor: 'pointer',
        display: 'flex', flexDirection: 'column', gap: 16,
        minHeight: 148, position: 'relative', overflow: 'hidden',
        color: COLORS.text,
        transform: hover ? 'translateY(-4px)' : 'translateY(0)',
        boxShadow: hover ? `0 16px 36px -16px ${feature.accent}55, 0 0 0 1px ${feature.accent}33` : 'none',
        transition: 'transform 180ms, border-color 180ms, box-shadow 180ms',
        animation: `fadeUp 500ms ease-out ${idx * 50}ms both`,
      }}
    >
      {hover && (
        <>
          <span aria-hidden style={{
            position: 'absolute', top: 0, left: '-30%', width: '40%', height: '100%',
            background: `linear-gradient(115deg, transparent 0%, ${feature.accent}28 50%, transparent 100%)`,
            animation: 'rimSweep 900ms ease-out forwards',
            pointerEvents: 'none',
          }} />
          <span aria-hidden style={{
            position: 'absolute', inset: 0,
            background: `radial-gradient(130% 90% at 30% 35%, ${feature.accent}1f 0%, transparent 65%)`,
            animation: 'cardGlowIn 500ms ease-out 900ms both, cardGlow 2400ms ease-in-out 1400ms infinite',
            pointerEvents: 'none',
          }} />
        </>
      )}

      <span style={{
        position: 'absolute', top: 14, right: 16,
        fontFamily: 'JetBrains Mono, monospace', fontSize: 14, fontWeight: 800,
        letterSpacing: '0.06em', color: feature.accent, opacity: 0.7,
      }}>{feature.short}</span>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <span style={{
          width: 44, height: 44, borderRadius: 12,
          background: feature.accent + '14',
          border: `1px solid ${feature.accent}50`,
          color: feature.accent,
          display: 'grid', placeItems: 'center',
          fontFamily: 'JetBrains Mono, monospace', fontSize: 20, fontWeight: 800,
        }}>{iconNode}</span>
      </div>

      <div>
        <div className="mono" style={{
          fontSize: 14, fontWeight: 700, letterSpacing: '-0.005em', color: COLORS.text,
        }}>{label}</div>
        <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 6, lineHeight: 1.5 }}>
          {desc}
        </div>
      </div>

      <div style={{
        position: 'absolute', bottom: 14, right: 16, display: 'flex', alignItems: 'center', gap: 6,
        fontFamily: 'JetBrains Mono, monospace', fontSize: 8.5, letterSpacing: '0.18em',
        color: COLORS.muted,
      }}>
        <span style={{
          width: 5, height: 5, borderRadius: 999, background: COLORS.green,
          boxShadow: `0 0 5px ${COLORS.green}aa`,
          animation: 'pulse 1.6s ease-in-out infinite',
        }} />
        OK
      </div>
    </button>
  );
}
