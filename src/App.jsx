import { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from 'react';
import {
  COLORS, ACCENTS, SOCIALS,
  useClock, useGeoDayNight, useAmbient, useLanyard, useLang, useAuth,
  useSyncedData, usePasteImage, useMediaQuery,
  buildChatHistory,
} from './lib.jsx';
import { PixelCoin, PixelHeart, PixelCloud, PixelArrow, ModuleIcon, IconTile, DialogBox, PxButton, Badge } from './ui/arcade.jsx';
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
const StoreApp           = lazy(() => import('./store/StoreApp.jsx'));

// Modules in cartridge order (00 lobby → 08). `tab` is the short tab-bar
// label, `desc` the cartridge one-liner, `blurb` the level-header line.
const FEATURES = [
  { id: 'home',    label: 'Home',            tab: 'LOBBY',    short: '00' },
  { id: 'ai',      label: 'AI Playground',   tab: 'AI',       short: '01', desc: 'Chat · image · video',
    blurb: 'Chat · image · video — seven presets, one control panel. Chat on Gemini 3.1, renders on fal.ai.' },
  { id: 'tools',   label: 'Toolbox',         tab: 'TOOLBOX',  short: '02', desc: 'Public + private utilities',
    blurb: 'Public + private utilities — travel plans, subscriptions, to-do and everyday tools in one box.' },
  { id: 'game',    label: 'Game',            tab: 'GAME',     short: '03', desc: 'Tavern RP · Cờ Cá Ngựa · Project K',
    blurb: 'Game hub — roleplay, board, action RPG and webcam games. Pick a venue and press start.' },
  { id: 'crypto',  label: 'Currency',        tab: 'CURRENCY', short: '04', desc: 'BTC · GOLD · TWD ⇄ VND',
    blurb: 'BTC · GOLD · TWD ⇄ VND — live markets and a cross-rate converter, auto-refreshed every 60s.' },
  { id: 'feed',    label: 'History',         tab: 'HISTORY',  short: '05', desc: 'Private AI history', ownerOnly: true,
    blurb: 'Private AI history — every chat, image, video and background cut in one archive.' },
  { id: 'kata',    label: 'KataS Dashboard', tab: 'KATAS',    short: '06', desc: 'Discord bot · ops · cost', href: '/kata' },
  { id: 'stylist', label: 'Stylist',         tab: 'STYLIST',  short: '07', desc: 'AI wardrobe · outfit mixer',
    blurb: 'AI wardrobe · outfit mixer — digitize your wardrobe, then let AI mix and render full looks.' },
  { id: 'store',   label: 'KataShop',        tab: 'KATASHOP', short: '08', desc: 'Independent shop · orders', href: '/store' },
  // Travel Plan, Subscription Manager and To Do now live inside Toolbox
  // (their routes 'tv4' / 'tech' / 'todo' are still rendered below).
];

// Routes folded into Toolbox — not in the tab bar (TOOLBOX stays lit), but
// they still need a level-header label when their panel is open.
const MERGED_ROUTE_META = {
  tv4:  { id: 'tv4',  label: 'Travel Plan',          tab: 'TRAVEL PLAN',
    blurb: 'Trips · plans · expenses — map, list, trip folder, day-by-day plan and spend.' },
  tech: { id: 'tech', label: 'Subscription Manager', tab: 'SUBSCRIPTIONS',
    blurb: 'Monthly + yearly burn — your recurring bills in one inventory, converted across currencies.' },
  todo: { id: 'todo', label: 'To Do',                tab: 'TO DO',
    blurb: 'Quest log — tasks with P1–P3 priorities, synced to your account when you sign in.' },
};

// Any id the shell can render: a module, or a tool folded into Toolbox
// (so #/tv4, #/tech and #/todo stay directly linkable).
const isRoute = (id) => !!(FEATURES.find((f) => f.id === id) || MERGED_ROUTE_META[id]);

const EXPERIMENT_NUMBER = '007';
const ROUTE_OUT_MS = 150;   // stepped slide-out before the route swaps
const FAB_BOTTOM = 78;      // chat button sits on top of the brick footer

// Strip the leading glyph some i18n strings carry ("● ONLINE", "↗ Open …").
const bare = (s) => String(s || '').replace(/^[●◇✓↗]\s*/, '');

// Shell-only CSS: breakpoints, hovers and keyframes inline styles can't express.
const SHELL_CSS = `
:root, [data-theme="light"] { --sh-red-ink: #b42828; }
[data-theme="dark"] { --sh-red-ink: #ff8a8a; }
.sh-wrap { width: 100%; max-width: 1720px; margin-left: auto; margin-right: auto; padding-left: 48px; padding-right: 48px; box-sizing: border-box; }
.sh-route { padding: 12px max(48px, calc((100% - 1624px) / 2)) 28px; }
.sh-tabs { scrollbar-width: none; }
.sh-tabs::-webkit-scrollbar { display: none; }
.sh-tabs .tab { flex-shrink: 0; }
.sh-tabs .tab:focus-visible { outline: 3px solid #ffd25e; outline-offset: -5px; }
.sh-ghost { transition: background 80ms steps(2); }
.sh-ghost:hover { background: var(--paper-2) !important; }
.sh-crumb { background: none; border: 0; padding: 0; font: inherit; color: inherit; cursor: pointer; text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 3px; }
.sh-crumb:hover { color: var(--text); }
.sh-social { display: grid; place-items: center; width: 28px; height: 28px; color: var(--muted); transition: transform 80ms steps(2), color 80ms steps(2); }
.sh-social:hover { color: var(--sh-red-ink); transform: translateY(-2px); }
.sh-social svg { width: 15px; height: 15px; }
.sh-fabhd { display: grid; place-items: center; width: 32px; height: 32px; padding: 0; border: 0; cursor: pointer; color: #fffaf0; background: transparent; box-shadow: inset 0 0 0 2px rgba(255, 250, 240, 0.35); }
.sh-fabhd:hover { background: var(--strip-2); box-shadow: inset 0 0 0 2px #fffaf0; }
@keyframes sh-in { from { opacity: 0; transform: translateX(28px); } to { opacity: 1; transform: none; } }
@keyframes sh-out { from { opacity: 1; transform: none; } to { opacity: 0; transform: translateX(-28px); } }
@keyframes sh-drift { from { transform: translateX(0); } to { transform: translateX(calc(100% + 180px)); } }
@keyframes sh-sun { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.08); } }
@keyframes sh-coin { 0% { opacity: 1; transform: translateY(0); } 60% { opacity: 1; transform: translateY(-14px); } 100% { opacity: 0; transform: translateY(-18px); } }
@keyframes sh-eq { 0%, 100% { transform: scaleY(0.3); } 50% { transform: scaleY(1); } }
.sh-sun { animation: sh-sun 2s steps(2) infinite; }
.sh-drift { animation: sh-drift 46s linear infinite; }
.sh-coinpop { animation: sh-coin 0.6s steps(6) forwards; }
.sh-hero { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr); gap: 56px; align-items: center; }
.sh-hero-h { font-size: 56px; }
.sh-grid4 { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 48px 28px; }
.sh-cart {
  position: relative; display: flex; flex-direction: column; min-height: 236px; padding: 0;
  text-align: left; border: 0; color: #1b1410; font-family: inherit; cursor: pointer;
  box-shadow: 0 -4px 0 0 var(--ink), 0 4px 0 0 var(--ink), -4px 0 0 0 var(--ink), 4px 0 0 0 var(--ink), 8px 10px 0 4px var(--shadow);
  transition: transform 100ms steps(2), box-shadow 100ms steps(2);
}
.sh-cart:hover, .sh-cart:focus-visible {
  transform: translate(-4px, -6px);
  box-shadow: 0 -4px 0 0 var(--ink), 0 4px 0 0 var(--ink), -4px 0 0 0 var(--ink), 4px 0 0 0 var(--ink), 12px 16px 0 4px var(--shadow);
}
.sh-cart:active {
  transform: translate(4px, 6px);
  box-shadow: 0 -4px 0 0 var(--ink), 0 4px 0 0 var(--ink), -4px 0 0 0 var(--ink), 4px 0 0 0 var(--ink), 0 0 0 4px var(--shadow);
}
.sh-cart:hover .sh-cico, .sh-cart:focus-visible .sh-cico { animation: px-bob 0.6s steps(2) infinite; }
.sh-cart .sh-p1 { opacity: 0; }
.sh-cart:hover .sh-p1, .sh-cart:focus-visible .sh-p1 { opacity: 1; animation: px-bob 1s steps(2) infinite; }
.sh-cart .sh-go { display: inline-block; transition: transform 100ms steps(2); }
.sh-cart:hover .sh-go, .sh-cart:focus-visible .sh-go { transform: translateX(4px); }
/* Wide screens: use the room instead of leaving empty side bands. */
@media (min-width: 1500px) {
  .sh-hero { gap: 72px; }
  .sh-hero-h { font-size: 66px; }
  .sh-scene { height: 500px !important; }
  .sh-grid4 { gap: 52px 36px; }
  .sh-cart { min-height: 268px; }
}
@media (min-width: 1880px) {
  .sh-hero-h { font-size: 76px; }
  .sh-scene { height: 560px !important; }
  .sh-grid4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
@media (max-width: 1200px) {
  .sh-game { display: none !important; }
}
@media (max-width: 1100px) {
  .sh-wrap, .sh-route { padding-left: 32px; padding-right: 32px; }
  .sh-hud-x { display: none !important; }
  .sh-hero { gap: 40px; }
  .sh-hero-h { font-size: 46px; }
  .sh-ctas { gap: 18px !important; }
  .sh-cta { padding: 0 14px !important; font-size: 13px !important; }
}
@media (max-width: 1000px) {
  .sh-grid4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .sh-hide-md { display: none !important; }
}
@media (max-width: 960px) {
  .sh-hero { grid-template-columns: minmax(0, 1fr); }
  .sh-scene { height: 300px !important; }
}
@media (max-width: 900px) {
  .sh-wrap, .sh-route { padding-left: 24px; padding-right: 24px; }
  .sh-np { display: none !important; }
}
`;

// Top-level router: hand off to MobileShell on phone-class viewports;
// otherwise render the full desktop control surface. Splitting like this
// keeps the desktop hooks (useLanyard, useAmbient, etc.) from running on
// mobile where their data is never displayed.

export default function App() {
  const isMobile = useMediaQuery('(max-width: 768px)');

  // KataShop is part of this React build, but owns an independent path,
  // responsive layout and visual system.
  if (typeof window !== 'undefined' && /^\/store(?:\/|$)/.test(window.location.pathname)) {
    return (
      <Suspense fallback={<div style={{ padding: 40, color: COLORS.muted }} className="mono">Loading KataShop...</div>}>
        <StoreApp />
      </Suspense>
    );
  }

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

// Layout: a 100vh column of fixed chrome (HUD header → module tab bar →
// accent strip → level header) above one scrolling route area, with the brick
// footer pinned at the bottom. The route area has a definite height, so
// modules that fill it (height: 100%) keep working; taller content scrolls.
function AppDesktop() {
  const isMobile = useMediaQuery('(max-width: 768px)');

  const [route, setRoute] = useState(() => {
    // Match against first hash segment only — sub-routes like #/tv4/list/<slug>
    // belong to the feature module and are parsed there.
    const h = window.location.hash.replace(/^#\//, '').split('/')[0];
    if (h === 'kata') { window.location.assign('/kata'); }
    else if (h === 'store') { window.location.assign('/store'); }
    else if (isRoute(h)) return h;
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
  const ambient = useAmbient(true, lanyard.data);
  const geo = useGeoDayNight();

  const phase = geo.phase;

  function nav(to) {
    if (to === 'kata') { window.location.assign('/kata'); return; }
    if (to === 'store') { window.location.assign('/store'); return; }
    if (to === route) return;
    setTransitioning(true);
    setTimeout(() => {
      setRoute(to);
      window.history.replaceState(null, '', '#/' + to);
      setTransitioning(false);
    }, ROUTE_OUT_MS);
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
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (chatOpen) { setChatOpen(false); return; }
      // A module's own overlay (lightbox, dialog) owns Esc while it is open.
      const inDialog = (el) => el instanceof Element && !!el.closest('[role="dialog"], [aria-modal="true"]');
      if (inDialog(e.target) || inDialog(document.activeElement) || document.querySelector('[aria-modal="true"]')) return;
      if (route !== 'home') nav('home');
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [route, chatOpen]);

  useEffect(() => {
    const onHash = () => {
      const id = window.location.hash.replace(/^#\//, '').split('/')[0] || 'home';
      if (id === 'kata') { window.location.assign('/kata'); return; }
      if (id === 'store') { window.location.assign('/store'); return; }
      if (isRoute(id) && id !== route) setRoute(id);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [route]);

  const activeFeature = FEATURES.find((f) => f.id === route) || MERGED_ROUTE_META[route];
  const isHome = route === 'home';
  // The AI playground fills the viewport with its thread + composer, so it gets
  // a slim level header and no footer to give the conversation more height.
  const isChat = route === 'ai';

  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      position: 'relative', overflow: 'hidden', color: COLORS.text,
    }}>
      <style>{SHELL_CSS}</style>

      <TopBar phase={phase} geo={geo} nav={nav} ambient={ambient} />
      <ModuleTabs route={route} nav={nav} />
      {!isHome && <LevelHeader route={route} nav={nav} feature={activeFeature} compact={isChat} />}

      <main style={{ position: 'relative', flex: '1 1 0', minHeight: 0, overflow: 'hidden' }}>
        {/* One scroller per level, parent of the module root: modules that
            fill it (height: 100%) keep working, taller pages scroll with real
            bottom room for their pixel drops. The slide is a one-off animation,
            so no transform / will-change lingers to trap position: fixed. */}
        <div
          key={route}
          className={isHome ? undefined : 'sh-route'}
          style={{
            // Opaque background lets the browser composite scrolling instead of
            // repainting the page behind a transparent scroller every frame.
            height: '100%', overflowY: 'auto', overflowX: 'hidden', background: COLORS.bg,
            animation: transitioning
              ? `sh-out ${ROUTE_OUT_MS}ms steps(3) forwards`
              : 'sh-in 240ms steps(4)',
          }}
        >
          <Suspense fallback={<RouteFallback />}>
            {route === 'home'   && <HomeView nav={nav} ambient={ambient} phase={phase} />}
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
      </main>

      {!isChat && <Footer phase={phase} />}

      <ChatFab open={chatOpen}
        hidden={route === 'ai'}
        onOpen={() => setChatOpen(true)}
        onClose={() => setChatOpen(false)}
        ambient={ambient} nav={nav} />
      <AuthErrorToast />
    </div>
  );
}

function RouteFallback() {
  return (
    <div className="sk" style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '40px 8px',
      fontSize: 12, color: COLORS.muted,
    }}>
      <span className="dots-step" aria-hidden="true" style={{ color: COLORS.text }}><i /><i /><i /></span>
      loading module…
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Small pixel glyphs (local to the shell)
// ─────────────────────────────────────────────────────────────
function PxSun({ size = 14, color = '#ffd25e', outline = true }) {
  return (
    <svg width={size} height={size} viewBox="0 0 9 9" shapeRendering="crispEdges" aria-hidden="true">
      <path d="M3 3h3v3H3zM4 0h1v2H4zM4 7h1v2H4zM0 4h2v1H0zM7 4h2v1H7zM1 1h1v1H1zM7 1h1v1H7zM1 7h1v1H1zM7 7h1v1H7z"
        fill={color} stroke={outline ? '#1b1410' : 'none'} strokeWidth="0.35" />
    </svg>
  );
}

function PxMoon({ size = 14, color = '#c9d4ff', outline = true }) {
  return (
    <svg width={size} height={size} viewBox="0 0 8 8" shapeRendering="crispEdges" aria-hidden="true">
      <path d="M2 0h4v1H4v1H3v4h1v1h2v1H2V7H1V6H0V2h1V1h1z"
        fill={color} stroke={outline ? '#1b1410' : 'none'} strokeWidth="0.35" />
    </svg>
  );
}

function PxClose({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 7 7" shapeRendering="crispEdges" aria-hidden="true">
      <path d="M0 0h2v1h1v1h1V1h1V0h2v2H6v1H5v1h1v1h1v2H5V6H4V5H3v1H2v1H0V5h1V4h1V3H1V2H0z" fill="currentColor" />
    </svg>
  );
}

function PxChatIcon({ size = 30, fill = '#fffaf0', dots = '#e04545' }) {
  return (
    <svg width={size} height={Math.round(size * 8 / 9)} viewBox="0 0 9 8" shapeRendering="crispEdges" aria-hidden="true">
      <path d="M1 0h7v1h1v4H8v1H4v1H3v1H2V6H1V5H0V1h1z" fill={fill} />
      <rect x="2" y="2" width="1" height="1" fill={dots} />
      <rect x="4" y="2" width="1" height="1" fill={dots} />
      <rect x="6" y="2" width="1" height="1" fill={dots} />
    </svg>
  );
}

// Square-cap stroke icon (24 grid), matching ModuleIcon.
function StrokeIcon({ d, size = 16, sw = 2.6, color = 'currentColor', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw}
      strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true" style={style}>
      <path d={d} />
    </svg>
  );
}
const ICON_OPEN = 'M14 4h6v6M20 4l-9 9M10 5H4v15h15v-6';
const ICON_IMAGE = 'M3 4h18v16H3zM3 16l5-5 4 4 3-3 6 6';
const ICON_WARN = 'M12 3l10 18H2zM12 10v5M12 18v1';
const ICON_RETRY = 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5';
const ICON_LOGOUT = 'M10 4H4v16h6M15 8l4 4-4 4M19 12H9';

// ─────────────────────────────────────────────────────────────
// Top bar — the HUD header
// ─────────────────────────────────────────────────────────────
function TopBar({ phase, geo, nav, ambient }) {
  const { lang, toggle, t } = useLang();
  const { status, user } = useAuth();
  const now = useClock();
  const [credits, setCredits] = useState(0);
  const tStr = now.toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const day = phase === 'day';
  const live = !!ambient.isLive;
  const city = geo.city && !geo.city.includes('—') ? geo.city : '';
  const player = status === 'authed'
    ? (user?.displayName || user?.username || 'P1')
    : status === 'loading' ? 'P1 …' : 'P1 GUEST';
  const cell = {
    display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 5,
    padding: '2px 18px', borderLeft: `3px dashed ${COLORS.rule}`, minWidth: 0,
  };

  return (
    <header style={{
      flex: 'none', position: 'relative', zIndex: 30,
      background: COLORS.paper, borderBottom: `4px solid ${COLORS.ink}`,
    }}>
      <div className="sh-wrap" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, height: 66,
      }}>
        <button onClick={() => nav('home')} aria-label="se77n · home"
          style={{
            background: 'transparent', border: 0, padding: 0, cursor: 'pointer', flexShrink: 0,
            display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 5,
            color: COLORS.text,
          }}>
          <span className="pf" style={{ fontSize: 31, lineHeight: 1 }}>
            se<span style={{ color: COLORS.red, textShadow: `3px 3px 0 ${COLORS.ink}` }}>77</span>n
          </span>
          <span className="sk" style={{
            fontSize: 10, lineHeight: 1, color: COLORS.muted, textTransform: 'uppercase', whiteSpace: 'nowrap',
          }}>
            {t('topbar.experiment')} <span style={{ color: 'var(--sh-red-ink)' }}>{EXPERIMENT_NUMBER}</span> / {t('topbar.desktop')}
          </span>
        </button>

        <div className="sk" style={{
          display: 'flex', alignItems: 'stretch', flexShrink: 0, whiteSpace: 'nowrap',
          borderRight: `3px dashed ${COLORS.rule}`,
        }}>
          <div style={cell}>
            <span style={{
              fontSize: 10, lineHeight: 1, color: COLORS.muted, whiteSpace: 'nowrap',
              overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 170,
            }}>TIME{city ? ' · ' + city : ''}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, lineHeight: 1 }}>
              <span role="img" title={day ? t('topbar.day') : t('topbar.night')}
                aria-label={day ? t('topbar.day') : t('topbar.night')} style={{ display: 'grid' }}>
                {day ? <PxSun /> : <PxMoon />}
              </span>
              <span style={{ minWidth: 84 }}>{tStr}</span>
            </span>
          </div>
          {/* While Spotify is live the now-playing chip takes this room. */}
          {!live && (
            <>
              <div className="sh-hud-x" style={cell}>
                <span style={{ fontSize: 10, lineHeight: 1, color: COLORS.muted }}>PLAYER</span>
                <span style={{
                  fontSize: 15, lineHeight: 1, maxWidth: 150, whiteSpace: 'nowrap',
                  overflow: 'hidden', textOverflow: 'ellipsis', textTransform: 'uppercase',
                }}>{player}</span>
              </div>
              {/* INSERT COIN toy — purely local, resets on reload. */}
              <button type="button" className="sh-hud-x sh-ghost sk" aria-label="Insert coin"
                title="Insert coin" onClick={() => setCredits((c) => c + 1)}
                style={{
                  ...cell, position: 'relative', alignItems: 'flex-start', background: 'transparent',
                  borderTop: 0, borderBottom: 0, borderRight: 0, color: COLORS.text, cursor: 'pointer',
                }}>
                <span style={{ fontSize: 10, lineHeight: 1, color: COLORS.muted }}>CREDITS</span>
                <span style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 7, fontSize: 15, lineHeight: 1 }}>
                  <PixelCoin size={15} />× {String(Math.min(credits, 99)).padStart(2, '0')}
                  {credits > 0 && (
                    <span key={credits} className="sh-coinpop" aria-hidden="true"
                      style={{ position: 'absolute', left: 0, top: -2, pointerEvents: 'none' }}>
                      <PixelCoin size={15} />
                    </span>
                  )}
                </span>
              </button>
            </>
          )}
        </div>

        {live && (
          <div className="sh-np" style={{ flex: '0 1 440px', minWidth: 0, display: 'flex' }}>
            <NowPlaying ambient={ambient} on />
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0, paddingBottom: 4 }}>
          <LangToggle lang={lang} toggle={toggle} title={t('topbar.toggleLang')} />
          <LightToggle title="Light / dark" />
          <AuthChip />
        </div>
      </div>
    </header>
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
      ?.setAttribute('content', mode === 'light' ? '#f3eee4' : '#17110d');
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
      type="button"
      onClick={() => setMode(light ? 'dark' : 'light')}
      title={title + ' · ' + (light ? 'LIGHT' : 'DARK')}
      aria-label={title}
      aria-pressed={!light}
      className="sbtn sh-ghost"
      style={{
        display: 'grid', placeItems: 'center', width: 36, height: 36, padding: 0,
        background: COLORS.paper, color: COLORS.text,
      }}
    >
      {light ? <PxSun size={18} /> : <PxMoon size={18} />}
    </button>
  );
}

function LangToggle({ lang, toggle, title }) {
  const isEn = lang === 'en';
  // Highlight the *current* language; the other half is the "click to switch" target.
  return (
    <div role="group" aria-label={title} title={title} className="pxs" style={{ display: 'flex' }}>
      {[['en', isEn], ['vi', !isEn]].map(([code, on]) => (
        <button key={code} type="button" aria-pressed={on}
          onClick={() => { if (!on) toggle(); }}
          className={'chip-px sk' + (on ? ' on' : '')}
          style={{ height: 36, padding: '0 10px', fontSize: 12, boxShadow: 'none' }}>
          {code.toUpperCase()}
        </button>
      ))}
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
      <div className="sk pxs" style={{
        height: 36, padding: '0 12px', display: 'flex', alignItems: 'center',
        background: COLORS.paper, color: COLORS.muted, fontSize: 11,
      }}>
        <span className="dots-step" aria-hidden="true" style={{ marginRight: 4, transform: 'scale(0.6)' }}><i /><i /><i /></span>
        {t('auth.syncing')}
      </div>
    );
  }

  const label = { fontSize: 11, color: COLORS.muted, marginBottom: 8 };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {status === 'authed' ? (
        <button type="button" onClick={() => setOpen((v) => !v)}
          aria-label={user?.displayName || t('auth.signedInAs')}
          aria-haspopup="menu" aria-expanded={open}
          className="sbtn sh-ghost"
          style={{
            display: 'flex', alignItems: 'center', gap: 9, height: 36, padding: '0 10px 0 4px',
            background: COLORS.paper, color: COLORS.text,
          }}
        >
          {user?.avatarUrl ? (
            <img src={user.avatarUrl} alt="" style={{
              width: 28, height: 28, objectFit: 'cover', imageRendering: 'pixelated',
              boxShadow: `0 0 0 2px ${COLORS.ink}`,
            }} />
          ) : (
            <span className="pf" style={{
              width: 28, height: 28, display: 'grid', placeItems: 'center',
              background: ACCENTS.ai, color: COLORS.onAccent, fontSize: 15,
            }}>{(user?.displayName || '?').slice(0, 1).toUpperCase()}</span>
          )}
          <span className="mono" style={{
            maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            fontSize: 12, fontWeight: 700,
          }}>{user?.displayName || user?.username || '—'}</span>
          <PixelArrow dir="down" size={5} />
        </button>
      ) : (
        <button type="button" onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu" aria-expanded={open}
          className="sbtn sk"
          style={{
            height: 36, padding: '0 14px', fontSize: 12, textTransform: 'uppercase',
            background: COLORS.red, color: COLORS.onAccent,
            display: 'flex', alignItems: 'center', gap: 8,
          }}
        >
          {t('auth.signIn')}
        </button>
      )}

      {open && (
        <div role="menu" className="px" style={{
          position: 'absolute', top: 'calc(100% + 18px)', right: 0, zIndex: 60,
          width: 280, padding: '16px 18px 20px', background: COLORS.paper, color: COLORS.text,
          animation: 'px-rise 0.2s steps(3)',
        }}>
          {status === 'authed' ? (
            <>
              <div className="sk" style={label}>
                {t('auth.signedInAs').toUpperCase()} · {user?.provider?.toUpperCase()}
              </div>
              <div style={{ paddingBottom: 14, marginBottom: 16, borderBottom: `3px dashed ${COLORS.rule}` }}>
                <div className="pf" style={{ fontSize: 20, lineHeight: 1.1, overflowWrap: 'anywhere' }}>
                  {user?.displayName || '—'}
                </div>
                {user?.email && (
                  <div style={{ fontSize: 11, color: COLORS.muted, marginTop: 5, overflowWrap: 'anywhere' }}>
                    {user.email}
                  </div>
                )}
              </div>
              <button type="button" role="menuitem" onClick={() => { setOpen(false); logout(); }}
                className="sbtn sk sh-ghost"
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 10, height: 38,
                  padding: '0 12px', fontSize: 12, background: COLORS.paper, color: COLORS.text,
                }}
              ><StrokeIcon d={ICON_LOGOUT} size={15} />{t('auth.logout')}</button>
            </>
          ) : (
            <>
              <div className="sk" style={label}>{t('auth.signInTitle').toUpperCase()}</div>
              <div style={{ marginBottom: 16, fontSize: 12, color: COLORS.muted, lineHeight: 1.55 }}>
                {t('auth.signInDesc')}
              </div>
              <ProviderBtn provider="discord" color="#5865F2" label={t('auth.discord')} onClick={() => login('discord')} />
              <div style={{ height: 14 }} />
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
    <button type="button" role="menuitem" onClick={onClick} className="sbtn sh-ghost"
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 10, minHeight: 40,
        padding: '0 12px', background: COLORS.paper, color: COLORS.text,
        fontSize: 12, fontWeight: 700, textAlign: 'left',
      }}
    >
      {provider === 'discord' && (
        <svg width="16" height="16" viewBox="0 0 24 24" fill={color} aria-hidden="true">
          <path d="M20.317 4.37a19.79 19.79 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.74 19.74 0 003.677 4.37a.07.07 0 00-.032.028C.533 9.046-.32 13.58.099 18.058a.082.082 0 00.031.056 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.873-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.1 13.1 0 01-1.872-.892.077.077 0 01-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 01.078-.01c3.928 1.793 8.18 1.793 12.061 0a.074.074 0 01.079.01c.12.099.246.197.373.291a.077.077 0 01-.006.128 12.3 12.3 0 01-1.873.891.076.076 0 00-.04.107c.36.698.772 1.363 1.225 1.993a.076.076 0 00.084.028 19.84 19.84 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.029zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
        </svg>
      )}
      {provider === 'google' && (
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#4285F4" d="M21.6 12.227c0-.709-.064-1.39-.182-2.045H12v3.868h5.382a4.6 4.6 0 01-1.995 3.018v2.51h3.232c1.891-1.741 2.981-4.305 2.981-7.351z" />
          <path fill="#34A853" d="M12 22c2.7 0 4.964-.895 6.619-2.422l-3.232-2.51c-.895.6-2.04.955-3.387.955-2.605 0-4.81-1.76-5.595-4.124H3.064v2.59A9.996 9.996 0 0012 22z" />
          <path fill="#FBBC05" d="M6.405 13.9a6.012 6.012 0 010-3.8V7.51H3.064a10.001 10.001 0 000 8.98l3.341-2.59z" />
          <path fill="#EA4335" d="M12 5.977c1.468 0 2.786.504 3.823 1.495l2.868-2.868C16.96 2.99 14.696 2 12 2 8.092 2 4.71 4.244 3.064 7.51l3.341 2.59C7.19 7.736 9.395 5.977 12 5.977z" />
        </svg>
      )}
      <span style={{ flex: 1 }}>{label}</span>
      <PixelArrow size={9} />
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
    <div role="alert" className="px" style={{
      position: 'fixed', top: 150, right: 32, zIndex: 70,
      width: 340, maxWidth: 'calc(100vw - 64px)',
      padding: '14px 14px 16px 16px', background: COLORS.paper, color: COLORS.text,
      borderLeft: `8px solid ${COLORS.red}`,
      display: 'flex', alignItems: 'flex-start', gap: 12,
      animation: 'px-rise 0.24s steps(4)',
    }}>
      <StrokeIcon d={ICON_WARN} size={20} color="var(--sh-red-ink)" style={{ flexShrink: 0, marginTop: 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="sk" style={{ fontSize: 12, color: 'var(--sh-red-ink)' }}>{t('auth.error').toUpperCase()}</div>
        <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 6, lineHeight: 1.5, overflowWrap: 'anywhere' }}>{err}</div>
      </div>
      <button type="button" onClick={() => setErr(null)} aria-label={t('auth.errorDismiss')}
        className="sbtn sh-ghost"
        style={{
          display: 'grid', placeItems: 'center', width: 28, height: 28, padding: 0, flexShrink: 0,
          background: COLORS.paper, color: COLORS.text,
        }}><PxClose size={10} /></button>
    </div>
  );
}

function NowPlaying({ ambient, on }) {
  const { track, playing, isLive, game } = ambient;
  const bar = track.palette[0];
  return (
    <div className="pxs" style={{
      display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, width: '100%',
      padding: '4px 12px 4px 4px', background: COLORS.paper,
    }}>
      <div style={{
        width: 34, height: 34, flexShrink: 0,
        background: track.coverUrl
          ? `url(${track.coverUrl}) center/cover no-repeat`
          : `linear-gradient(135deg, ${track.palette[0]} 50%, ${track.palette[1] || ACCENTS.tools} 50%)`,
        display: 'grid', placeItems: 'center', boxShadow: `0 0 0 2px ${COLORS.ink}`,
      }}>
        {!track.coverUrl && (
          <span className="sk" style={{ fontSize: 9, color: '#1b1410' }}>{track.album.slice(0, 3)}</span>
        )}
      </div>
      <div aria-hidden="true" style={{
        display: 'flex', alignItems: 'flex-end', gap: 2, height: 26, padding: '4px 4px',
        background: COLORS.strip, flexShrink: 0,
      }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} style={{
            width: 3, height: 18, background: bar, transformOrigin: 'bottom',
            animation: playing && on ? `sh-eq ${0.6 + i * 0.13}s steps(3) ${i * 0.06}s infinite` : 'none',
            opacity: playing && on ? 1 : 0.35,
          }} />
        ))}
      </div>
      <div style={{ minWidth: 0, flex: 1, lineHeight: 1.2 }}>
        <div className="sk" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 9, color: COLORS.greenInk, whiteSpace: 'nowrap' }}>
          {isLive && <span className="blink" style={{ width: 6, height: 6, background: '#1DB954' }} />}
          {isLive ? 'NOW PLAYING' : 'AMBIENT'}
        </div>
        <div className="mono" style={{
          fontSize: 12, fontWeight: 700, color: COLORS.text, marginTop: 3,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{track.title}</div>
        <div className="mono" style={{
          fontSize: 10, color: COLORS.muted, marginTop: 1,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{track.artist}{track.album ? ' · ' + track.album : ''}</div>
      </div>
      {game && <GameChip game={game} />}
    </div>
  );
}

function GameChip({ game }) {
  return (
    <div className="sh-game" title={[game.name, game.details, game.state].filter(Boolean).join(' · ')}
      style={{
        padding: '4px 8px', background: ACCENTS.game, color: COLORS.onAccent,
        maxWidth: 140, flexShrink: 0, minWidth: 0,
      }}>
      <div className="sk" style={{ fontSize: 9, lineHeight: 1 }}>PLAYING</div>
      <div className="mono" style={{
        fontSize: 10, fontWeight: 700, marginTop: 3, lineHeight: 1.1,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{game.name}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Module tab bar + accent strip
// ─────────────────────────────────────────────────────────────
const LOBBY_STRIP = 'linear-gradient(90deg, ' + ['ai', 'tools', 'game', 'crypto', 'feed', 'kata', 'stylist', 'store']
  .map((id, i, a) => `${ACCENTS[id]} ${(i * 100) / a.length}% ${((i + 1) * 100) / a.length}%`).join(', ') + ')';

function ModuleTabs({ route, nav }) {
  const { user } = useAuth();
  const isOwner = !!user?.isHistoryOwner;
  const visibleFeatures = FEATURES.filter((f) => !f.ownerOnly || isOwner);
  // Tools merged into Toolbox keep the TOOLBOX tab lit.
  const activeId = MERGED_ROUTE_META[route] ? 'tools' : route;
  const barRef = useRef(null);

  // Keep the active tab in view when the bar scrolls (narrow windows).
  useEffect(() => {
    let live = true;
    const reveal = () => {
      const bar = barRef.current;
      const el = live && bar && bar.querySelector('[aria-current="page"]');
      if (!el) return;
      const l = el.offsetLeft;
      const r = l + el.offsetWidth;
      if (l < bar.scrollLeft) bar.scrollLeft = l - 24;
      else if (r > bar.scrollLeft + bar.clientWidth) bar.scrollLeft = r - bar.clientWidth + 24;
    };
    reveal();
    // Pixel fonts are wider than the fallback: measure again once they load.
    document.fonts?.ready?.then(reveal);
    return () => { live = false; };
  }, [activeId]);

  return (
    <div style={{ flex: 'none', position: 'relative', zIndex: 20 }}>
      <nav aria-label="Modules" style={{ background: COLORS.strip }}>
        <div ref={barRef} className="sh-wrap sh-tabs" style={{
          position: 'relative', display: 'flex', alignItems: 'flex-end', gap: 6,
          height: 54, overflowX: 'auto', overflowY: 'hidden',
        }}>
          {visibleFeatures.map((f) => {
            const on = f.id === activeId;
            return (
              <a key={f.id} href={f.href || '#/' + f.id}
                className={'tab sk' + (on ? ' tab-on' : '')}
                aria-current={on ? 'page' : undefined}
                title={f.label}
                style={{ '--a': ACCENTS[f.id] }}
                onClick={(e) => {
                  // Plain clicks go through nav() (transition / full-page hop);
                  // modified clicks keep the browser's open-in-new-tab behaviour.
                  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                  e.preventDefault();
                  nav(f.id);
                }}
              >
                <span className="tn">{f.short}</span>{f.tab}
              </a>
            );
          })}
        </div>
      </nav>
      <div aria-hidden="true" style={{
        height: 12, borderBottom: `4px solid ${COLORS.ink}`,
        background: activeId === 'home' ? LOBBY_STRIP : (ACCENTS[activeId] || COLORS.paper),
      }} />
    </div>
  );
}

// 5 social links, now in the footer.
function NavSocials() {
  return (
    <nav aria-label="Social links" style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
      {SOCIALS.map((s) => (
        <a key={s.id} href={s.href} aria-label={s.label} title={s.label} className="sh-social">{s.icon}</a>
      ))}
    </nav>
  );
}

// ─────────────────────────────────────────────────────────────
// Level header (replaces the breadcrumbs)
// ─────────────────────────────────────────────────────────────
function LevelHeader({ route, nav, feature, compact = false }) {
  const { t } = useLang();
  const merged = !!MERGED_ROUTE_META[route];
  const f = feature || {};
  const btn = {
    display: 'inline-flex', alignItems: 'center', gap: 8, height: 34, padding: '0 12px',
    fontSize: 11, background: COLORS.paper, color: COLORS.text, whiteSpace: 'nowrap',
  };
  return (
    <section className="sh-wrap" style={{ flex: 'none', paddingTop: compact ? 10 : 14, paddingBottom: compact ? 2 : 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, minWidth: 0 }}>
          <IconTile id={route} accent={ACCENTS[route]} size={compact ? 40 : 52} />
          <div style={{ minWidth: 0 }}>
            <p className="sk" style={{ margin: '0 0 5px', fontSize: 11, lineHeight: 1.2, color: COLORS.muted, whiteSpace: 'nowrap' }}>
              WORLD {EXPERIMENT_NUMBER} ›{' '}
              {merged ? (
                <><button type="button" className="sh-crumb" onClick={() => nav('tools')}>TOOLBOX</button> › {f.tab}</>
              ) : (
                <>LEVEL {f.short}</>
              )}
            </p>
            <h1 className="pf" style={{ margin: 0, fontSize: compact ? 22 : 28, lineHeight: 1, letterSpacing: 0 }}>{f.label}</h1>
            {f.blurb && !compact && (
              <p title={f.blurb} style={{
                margin: '5px 0 0', fontSize: 13, lineHeight: 1.35, color: COLORS.muted,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>{f.blurb}</p>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0, padding: '0 8px 8px 0' }}>
          {merged && (
            <button type="button" className="sbtn sk sh-ghost" onClick={() => nav('tools')} style={btn}>
              <PixelArrow dir="left" size={9} />TOOLBOX
            </button>
          )}
          <button type="button" className="sbtn sk sh-ghost" onClick={() => nav('home')} style={btn}>
            {t('breadcrumb.escHome')}
          </button>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// Footer — HUD text over a brick + grass strip
// ─────────────────────────────────────────────────────────────
function Footer({ phase }) {
  const now = useClock();
  const day = phase === 'day';
  return (
    <footer style={{
      flex: 'none', position: 'relative', zIndex: 10,
      background: COLORS.paper, borderTop: `4px solid ${COLORS.ink}`,
    }}>
      <div className="sh-wrap sk" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
        height: 32, fontSize: 11, color: COLORS.muted, whiteSpace: 'nowrap',
      }}>
        <span>SE77N · {now.getFullYear()} · EXP {EXPERIMENT_NUMBER}</span>
        <span className="sh-hide-md">BUILD · {now.toISOString().slice(0, 10).replaceAll('-', '.')}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <NavSocials />
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: COLORS.text }}>
            {day ? <PxSun size={12} /> : <PxMoon size={12} />}
            {day ? 'DAYLIGHT' : 'NIGHTSHIFT'}
          </span>
        </span>
      </div>
      <div className="bricks" aria-hidden="true" style={{ height: 24, borderTopWidth: 6, backgroundSize: '32px 12px' }} />
    </footer>
  );
}

// ─────────────────────────────────────────────────────────────
// Home view — the lobby
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

// The ambient theme lock (persisted by useAmbient) now picks the lobby sky.
// AUTO follows the visitor's day/night; the palettes tint it.
const SKY_OPTIONS = [
  { idx: null, label: 'AUTO' },
  { idx: 0,    label: 'RED',     top: '#ff9f8a', mid: '#ffb99a', bottom: '#ffd3ad' },
  { idx: 1,    label: 'GREEN',   top: '#9edcab', mid: '#b9e6bf', bottom: '#d6f2d4' },
  { idx: 2,    label: 'GOLD',    top: '#ffd27a', mid: '#ffe19e', bottom: '#fff0c2' },
  { idx: 3,    label: 'DUO R×G', top: '#ff9f8a', mid: '#ffc9a6', bottom: '#b9e8c0' },
  { idx: 4,    label: 'DUO G×R', top: '#ffd27a', mid: '#ffb98a', bottom: '#ff9f8a' },
  { idx: 5,    label: 'WHITE',   top: '#dfe6ec', mid: '#ebf0f3', bottom: '#f7f9fa' },
];
const SKY_DAY = { top: '#9fd8ff', mid: '#b6e2ff', bottom: '#cdeeff' };
const SKY_NIGHT = { top: '#1f2a52', mid: '#2c3a6c', bottom: '#3d4c8a', night: true };

function skyFor(lockedIdx, phase) {
  const opt = SKY_OPTIONS.find((o) => o.idx != null && o.idx === lockedIdx);
  if (opt) return opt;
  return phase === 'night' ? SKY_NIGHT : SKY_DAY;
}

// Three hard bands, like a pixel-art sky.
function skyBackground(sky) {
  return `linear-gradient(180deg, ${sky.top} 0 34%, ${sky.mid} 34% 62%, ${sky.bottom} 62% 100%)`;
}

const COIN_PATH = 'M2 0h4v1h1v1h1v4H7v1H6v1H2V7H1V6H0V2h1V1h1z';
const STARS = [[8, 14], [18, 30], [30, 10], [44, 24], [58, 8], [70, 30], [84, 16], [92, 40], [12, 44], [38, 40]];

function HomeView({ nav, ambient, phase }) {
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

  // Offline / not-yet-loaded values show as dashed placeholders.
  const fmtBtc = (v) => v == null ? '$--,---' : '$' + Math.round(v).toLocaleString('en-US');
  const fmtGold = (v) => v == null ? '----.--' : v.toFixed(2);
  // /api/crypto returns USD→TWD and USD→VND. Convert to TWD→VND directly.
  const twdVnd = (markets.twd && markets.vnd) ? markets.vnd / markets.twd : null;
  const fmtTwdVnd = (v) => v == null ? '---' : v.toFixed(0);

  const tickerItems = useMemo(() => [
    { k: 'BTC', c: '#ffd25e', v: fmtBtc(markets.btc) },
    { k: 'GOLD/OZ', c: '#ffd25e', v: fmtGold(markets.gold) },
    { k: '1 TWD', c: '#7fd18b', v: '= ' + fmtTwdVnd(twdVnd) + ' VND' },
    { k: 'PRESS START TO PLAY', c: '#9fd8ff', v: '' },
  ], [markets.btc, markets.gold, twdVnd]);
  // Four groups per half, two halves: the -50% loop never shows a gap.
  const tickerRun = useMemo(() => Array.from({ length: 8 }).flatMap(() => tickerItems), [tickerItems]);

  const modules = FEATURES.filter((f) => f.id !== 'home' && (!f.ownerOnly || user?.isHistoryOwner));
  const quote = QUOTES[quoteIdx];

  return (
    <div>
      {/* ── Hero: dialog box + pixel scene ── */}
      <section className="sh-wrap" style={{ paddingTop: 44, paddingBottom: 56 }}>
        <div className="sh-hero">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 28, minWidth: 0 }}>
            <span className="sk pxs" style={{
              alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 10,
              padding: '7px 12px', fontSize: 12, background: ACCENTS.tools, color: COLORS.onAccent,
            }}>
              <span className="blink" aria-hidden="true" style={{ width: 9, height: 9, background: '#1b1410' }} />
              {bare(t('home.online'))} {EXPERIMENT_NUMBER}
            </span>

            <DialogBox speaker="SE77N SAYS:" padding="40px 34px 34px" style={{ marginTop: 6 }}>
              <h1 className="pf sh-hero-h" aria-label={quote} style={{
                margin: 0, lineHeight: 1.06, minHeight: '2.12em', letterSpacing: 0, overflowWrap: 'anywhere',
              }}>
                <span aria-hidden="true">
                  {[...typed].map((ch, idx) => {
                    const glow = glowSet.has(idx);
                    return (
                      <span key={idx} className={glow ? 'qglow' : undefined}
                        style={{ color: glow ? COLORS.red : COLORS.text }}>{ch}</span>
                    );
                  })}
                  <span className="blink" style={{
                    display: 'inline-block', width: '0.42em', height: '0.8em',
                    marginLeft: '0.12em', verticalAlign: '-0.06em', background: COLORS.red,
                  }} />
                </span>
              </h1>
              <p style={{ margin: '22px 0 0', maxWidth: 540, fontSize: 15, lineHeight: 1.65, color: COLORS.muted }}>
                A personal control surface — your modules wired to one prompt.
                AI, finance, travel, subscriptions, tools, and the KataS bot ops, woven into a single command center.
              </p>
            </DialogBox>

            <div className="sh-ctas" style={{ display: 'flex', flexWrap: 'wrap', gap: 24, padding: '4px 12px 12px 4px' }}>
              <PxButton kind="big" fill={COLORS.red} onClick={() => nav('ai')} title={bare(t('home.openAi'))}
                className="sh-cta" style={{ height: 54, padding: '0 22px', fontSize: 15 }}>
                <PixelArrow size={13} />PRESS START
              </PxButton>
              <PxButton kind="big" fill={ACCENTS.crypto} onClick={() => nav('crypto')}
                className="sh-cta" style={{ height: 54, padding: '0 20px', fontSize: 15, textTransform: 'uppercase' }}>
                {t('home.markets')}
              </PxButton>
              <PxButton kind="big" fill={ACCENTS.todo} onClick={() => nav('todo')}
                className="sh-cta" style={{ height: 54, padding: '0 20px', fontSize: 15, textTransform: 'uppercase' }}>
                {t('home.todo')}
              </PxButton>
            </div>
          </div>

          <LobbyScene ambient={ambient} phase={phase} />
        </div>
      </section>

      {/* ── Markets marquee ── */}
      <div role="region" aria-label="Markets ticker" style={{
        position: 'relative', display: 'flex', alignItems: 'center', height: 58, overflow: 'hidden',
        background: COLORS.strip, color: COLORS.stripText,
        borderTop: `4px solid ${COLORS.ink}`, borderBottom: `4px solid ${COLORS.ink}`,
      }}>
        <p className="sr">
          BTC {fmtBtc(markets.btc)} · GOLD/OZ {fmtGold(markets.gold)} · 1 TWD = {fmtTwdVnd(twdVnd)} VND
        </p>
        <div className="marq sk" aria-hidden="true" style={{
          display: 'flex', width: 'max-content', whiteSpace: 'nowrap', fontSize: 17,
          animationDuration: '48s',
        }}>
          {tickerRun.map((it, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center' }}>
              <span style={{ marginRight: it.v ? 12 : 0, color: it.c }}>{it.k}</span>
              {it.v && <span>{it.v}</span>}
              <span style={{ margin: '0 40px', color: COLORS.red }}>★</span>
            </span>
          ))}
        </div>
      </div>

      {/* ── Cartridge select ── */}
      <section className="sh-wrap" style={{ paddingTop: 60, paddingBottom: 72 }}>
        <div style={{
          display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end',
          gap: 16, marginBottom: 60,
        }}>
          <div>
            <p className="sk" style={{ margin: '0 0 10px', fontSize: 13, color: COLORS.muted }}>
              {String(modules.length).padStart(2, '0')} CARTRIDGES
            </p>
            <h2 className="pf" style={{ margin: 0, fontSize: 42, lineHeight: 1 }}>Choose your module</h2>
          </div>
          <p className="sk" style={{
            display: 'flex', alignItems: 'center', gap: 10, margin: 0, fontSize: 13, color: COLORS.greenInk,
          }}>
            <span className="blink" aria-hidden="true" style={{ width: 10, height: 10, background: COLORS.greenInk }} />
            {bare(t('home.allOnline'))}
          </p>
        </div>

        <div className="sh-grid4">
          {modules.map((f, i) => (
            <Cartridge key={f.id} feature={f} idx={i} onClick={() => nav(f.id)} />
          ))}
        </div>
      </section>
    </div>
  );
}

function Cartridge({ feature, idx, onClick }) {
  return (
    <button type="button" onClick={onClick} className="sh-cart rise"
      aria-label={feature.label + ' — ' + feature.desc}
      style={{ background: ACCENTS[feature.id], animationDelay: idx * 60 + 'ms' }}>
      <span className="sk sh-p1" aria-hidden="true" style={{
        position: 'absolute', left: '50%', top: -40, marginLeft: -26, padding: '4px 10px',
        fontSize: 12, color: COLORS.stripText, background: COLORS.strip, whiteSpace: 'nowrap',
      }}>P1 ▼</span>
      <span className="sk ribs" style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: 26,
        padding: '0 12px', fontSize: 12, color: COLORS.onAccent, borderBottom: '4px solid #1b1410',
      }}>
        <span>{feature.ownerOnly ? 'OWNER' : ''}</span>{feature.short}
      </span>
      <span style={{
        display: 'flex', flexDirection: 'column', gap: 10, flex: 1, margin: 14, padding: 16,
        background: COLORS.paper, color: COLORS.text, border: '3px solid #1b1410',
      }}>
        <span className="sh-cico" style={{ display: 'inline-flex', alignSelf: 'flex-start' }}>
          <ModuleIcon id={feature.id} size={34} />
        </span>
        <span className="pf" style={{ fontSize: 22, lineHeight: 1.1 }}>{feature.label}</span>
        <span style={{ fontSize: 13, lineHeight: 1.45, color: COLORS.muted }}>{feature.desc}</span>
      </span>
      <span className="sk" style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px 14px', fontSize: 12, color: COLORS.onAccent,
      }}>
        {feature.href ? 'OPEN' : 'SELECT'}<span className="sh-go"><PixelArrow size={10} /></span>
      </span>
    </button>
  );
}

// Pixel scene: sky (follows the theme lock / day-night), drifting clouds,
// hills, brick floor and the spinning 77 coin. Pure CSS/SVG.
function LobbyScene({ ambient, phase }) {
  const sky = skyFor(ambient.lockedIdx, phase);
  const night = !!sky.night;
  const clouds = [
    { w: 160, top: 26, delay: '-38s', dur: '52s' },
    { w: 128, top: 74, delay: '-12s', dur: '46s' },
    { w: 96,  top: 154, delay: '-30s', dur: '60s' },
  ];
  return (
    <div className="px sh-scene" style={{
      position: 'relative', height: 440, overflow: 'hidden', background: skyBackground(sky),
    }}>
      <div aria-hidden="true" style={{ position: 'absolute', inset: 0 }}>
        <div style={{ position: 'absolute', left: 16, top: 16, display: 'flex', gap: 8 }}>
          <PixelHeart size={26} /><PixelHeart size={26} /><PixelHeart size={26} />
        </div>

        {night && STARS.map(([x, y], i) => (
          <span key={i} className={i % 3 === 0 ? 'blink' : undefined} style={{
            position: 'absolute', left: x + '%', top: y + '%', width: i % 2 ? 4 : 6, height: i % 2 ? 4 : 6,
            background: '#fff3c4', animationDelay: (i * 0.17) + 's',
          }} />
        ))}

        {night ? (
          <div className="sh-sun" style={{ position: 'absolute', right: 70, top: 62, display: 'grid' }}>
            <PxMoon size={76} color="#fff3c4" outline={false} />
          </div>
        ) : (
          <div className="sh-sun" style={{
            position: 'absolute', right: 72, top: 72, width: 60, height: 60, background: '#ffd25e',
            boxShadow: '0 -8px 0 0 #ffd25e, 0 8px 0 0 #ffd25e, -8px 0 0 0 #ffd25e, 8px 0 0 0 #ffd25e',
          }} />
        )}

        {clouds.map((c, i) => (
          <div key={i} className="sh-drift" style={{
            position: 'absolute', left: 0, top: c.top, width: '100%', height: 0,
            animationDelay: c.delay, animationDuration: c.dur, opacity: night ? 0.35 : 1,
          }}>
            <PixelCloud width={c.w} style={{ position: 'absolute', right: '100%', top: 0 }} />
          </div>
        ))}

        <div className="bob" style={{
          position: 'absolute', left: '50%', top: 128, marginLeft: -56, width: 112, height: 112,
        }}>
          <div className="coin-spin" style={{ position: 'relative', width: 112, height: 112 }}>
            <svg width="112" height="112" viewBox="0 0 8 8" shapeRendering="crispEdges" style={{ position: 'absolute', inset: 0 }}>
              <path d={COIN_PATH} fill="#ffc93c" stroke="#1b1410" strokeWidth="0.25" />
              <path d="M2 1h4v1h1v4H6v1H2V6H1V2h1z" fill="none" stroke="#c98a12" strokeWidth="0.25" />
            </svg>
            <span className="pf" style={{
              position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
              fontSize: 40, color: '#1b1410',
            }}>77</span>
          </div>
        </div>
        <div style={{ position: 'absolute', left: '20%', top: 214, display: 'flex', gap: 24 }}>
          <PixelCoin size={28} spin />
          <PixelCoin size={28} spin style={{ animationDelay: '0.2s' }} />
        </div>
        <div style={{ position: 'absolute', right: '18%', top: 240 }}>
          <PixelCoin size={28} spin style={{ animationDelay: '0.4s' }} />
        </div>

        <svg width="100%" viewBox="0 0 70 20" shapeRendering="crispEdges" preserveAspectRatio="xMidYMax slice"
          style={{ position: 'absolute', left: 0, right: 0, bottom: 60, height: 150 }}>
          <path d="M0 20V12h4V9h4V7h6v2h4v3h4v8z" fill="#8fd99a" stroke="#1b1410" strokeWidth="0.4" />
          <path d="M30 20v-7h4v-3h4V8h8v2h4v3h4v7z" fill="#8fd99a" stroke="#1b1410" strokeWidth="0.4" />
          <path d="M14 20v-4h4v-3h4v-2h6v2h4v3h4v4z" fill="#5bbf6a" stroke="#1b1410" strokeWidth="0.4" />
          <path d="M48 20v-5h4v-3h8v3h4v2h6v3z" fill="#5bbf6a" stroke="#1b1410" strokeWidth="0.4" />
        </svg>
        <div className="bricks" style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, height: 64, backgroundSize: '32px 20px',
          boxShadow: 'inset 0 4px 0 #1b1410',
        }} />
      </div>

      <SkyPicker ambient={ambient} />
    </div>
  );
}

// The old ambient "Theme" control, re-homed in the scene it now paints.
function SkyPicker({ ambient }) {
  const { lockedIdx, setLockedIdx } = ambient;
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

  const current = SKY_OPTIONS.find((o) => o.idx === lockedIdx) || SKY_OPTIONS[0];
  const ring = '0 -3px 0 0 #1b1410, 0 3px 0 0 #1b1410, -3px 0 0 0 #1b1410, 3px 0 0 0 #1b1410';
  const swatch = (o) => {
    const s = o.idx == null ? null : o;
    return (
      <span aria-hidden="true" style={{
        width: 14, height: 14, flexShrink: 0, boxShadow: '0 0 0 2px #1b1410',
        background: s
          ? `linear-gradient(180deg, ${s.top} 50%, ${s.bottom} 50%)`
          : `linear-gradient(135deg, ${SKY_DAY.top} 50%, ${SKY_NIGHT.top} 50%)`,
      }} />
    );
  };

  return (
    <div ref={ref} style={{ position: 'absolute', right: 16, top: 16, zIndex: 3 }}>
      <button type="button" onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu" aria-expanded={open} aria-label={'Theme · sky ' + current.label}
        title="Theme · lobby sky"
        className="sk"
        style={{
          display: 'flex', alignItems: 'center', gap: 8, height: 32, padding: '0 10px',
          background: '#fffaf0', color: '#1b1410', border: 0, boxShadow: ring,
          fontSize: 11, cursor: 'pointer',
        }}>
        {swatch(current)}SKY · {current.label}
        <PixelArrow dir="down" size={5} />
      </button>
      {open && (
        <div role="menu" style={{
          position: 'absolute', top: 'calc(100% + 10px)', right: 0, minWidth: 168, padding: 6,
          background: '#fffaf0', color: '#1b1410', boxShadow: ring,
          animation: 'px-rise 0.18s steps(3)',
        }}>
          {SKY_OPTIONS.map((opt) => {
            const active = opt.idx === lockedIdx || (opt.idx == null && lockedIdx == null);
            return (
              <button key={String(opt.idx)} type="button" role="menuitemradio" aria-checked={active}
                onClick={() => { setLockedIdx(opt.idx); setOpen(false); }}
                className="sk"
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 10, height: 30,
                  padding: '0 8px', border: 0, cursor: 'pointer', fontSize: 11, textAlign: 'left',
                  background: active ? '#1b1410' : 'transparent', color: active ? '#fffaf0' : '#1b1410',
                }}>
                {swatch(opt)}
                <span style={{ flex: 1 }}>{opt.label}</span>
                {active && <PixelArrow dir="left" size={7} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Floating chat — global FAB, expand on click, ESC to close
// Routes to /api/agent which auto-picks chat / image gen / image edit /
// video gen / bg-remove based on the user's prompt.
// ─────────────────────────────────────────────────────────────
function ChatFab({ open, hidden, onOpen, onClose, ambient, nav }) {
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
    // The AI module is the full chat, so the button steps aside there.
    if (hidden) return null;
    return (
      <button type="button" onClick={onOpen} aria-label={t('fab.openChat')} title={t('fab.ask')}
        className="pbtn"
        style={{
          position: 'fixed', right: 40, bottom: FAB_BOTTOM, zIndex: 60,
          display: 'grid', placeItems: 'center', width: 64, height: 64, padding: 0,
          background: accent,
        }}
      >
        <PxChatIcon size={32} dots={accent} />
      </button>
    );
  }

  const canSend = !!(input.trim() || imgRef) && !busy;

  return (
    <div role="dialog" aria-label={t('fab.openChat')} className="px"
      style={{
        position: 'fixed', right: 40, bottom: FAB_BOTTOM, zIndex: 60,
        width: 400, maxWidth: 'calc(100vw - 72px)',
        height: 'min(540px, calc(100vh - 210px))',
        display: 'flex', flexDirection: 'column',
        background: COLORS.paper, color: COLORS.text,
        animation: 'px-rise 0.24s steps(4)',
      }}>
      <div style={{
        flex: 'none', height: 48, padding: '0 8px 0 14px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        background: COLORS.strip, color: COLORS.stripText,
      }}>
        <div className="sk" style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, fontSize: 12 }}>
          <span className="blink" aria-hidden="true" style={{ width: 8, height: 8, flexShrink: 0, background: accent }} />
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            SE77N · {t('fab.ask')}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <FabHeaderBtn title={t('fab.openFull')} onClick={() => { onClose(); nav('ai'); }}>
            <StrokeIcon d={ICON_OPEN} size={15} />
          </FabHeaderBtn>
          <FabHeaderBtn title={t('fab.close')} onClick={onClose}><PxClose size={11} /></FabHeaderBtn>
        </div>
      </div>

      <div ref={scrollRef} role="log" style={{
        flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 18px 18px',
        display: 'flex', flexDirection: 'column', gap: 20, background: COLORS.cream,
      }}>
        {recent.length === 0 ? (
          <DialogBox speaker="SE77N SAYS:" padding="22px 16px 18px" style={{ marginTop: 10, marginRight: 10 }}>
            <span style={{ fontSize: 14, lineHeight: 1.5 }}>{t('fab.needHelp')}</span>
          </DialogBox>
        ) : (
          recent.map((m, i) => <ChatBubble key={i} msg={m} accent={accent} onRetry={m.error && m.retry ? () => send(m.retry) : null} retryLabel={t('ai.retry')} />)
        )}
        {busy && <ChatBubble msg={{ role: 'assistant', content: busyHint + '…' }} accent={accent} typing />}
      </div>

      {imgRef && (
        <div style={{
          flex: 'none', padding: '10px 14px', borderTop: `3px dashed ${COLORS.rule}`,
          display: 'flex', alignItems: 'center', gap: 12, background: COLORS.paper,
        }}>
          <img src={imgRef.dataUrl} alt="" style={{
            width: 40, height: 40, objectFit: 'cover', boxShadow: `0 0 0 3px ${COLORS.ink}`,
          }} />
          <div style={{
            fontSize: 11, color: COLORS.muted, flex: 1,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{imgRef.name}</div>
          <button type="button" onClick={() => setImgRef(null)} aria-label="Remove image"
            className="sbtn sh-ghost"
            style={{
              display: 'grid', placeItems: 'center', width: 28, height: 28, padding: 0,
              background: COLORS.paper, color: COLORS.text,
            }}><PxClose size={10} /></button>
        </div>
      )}

      <div style={{
        flex: 'none', padding: '12px 16px 16px 12px', borderTop: `4px solid ${COLORS.ink}`,
        background: COLORS.paper, display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <label title="Attach image" className="sbtn sh-ghost"
          style={{
            display: 'grid', placeItems: 'center', width: 38, height: 38, flexShrink: 0,
            background: imgRef ? ACCENTS.crypto : COLORS.paper,
            color: imgRef ? COLORS.onAccent : COLORS.text, cursor: 'pointer',
          }}>
          <input type="file" accept="image/*" onChange={onImage} aria-label="Attach image" style={{ display: 'none' }} />
          <StrokeIcon d={ICON_IMAGE} size={18} />
        </label>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t('fab.placeholder')}
          aria-label={t('fab.placeholder')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
          }}
          className="field mono"
          style={{ flex: 1, minWidth: 0, height: 38, padding: '0 12px', fontSize: 13 }}
        />
        <button type="button" onClick={() => send()} disabled={!canSend}
          aria-label="send" className="sbtn"
          style={{
            display: 'grid', placeItems: 'center', width: 42, height: 38, flexShrink: 0, padding: 0,
            background: canSend ? accent : COLORS.paper,
            color: canSend ? COLORS.onAccent : COLORS.muted,
            cursor: busy ? 'not-allowed' : 'pointer',
          }}><PixelArrow size={13} /></button>
      </div>
    </div>
  );
}

function FabHeaderBtn({ children, onClick, title }) {
  return (
    <button type="button" onClick={onClick} title={title} aria-label={title} className="sh-fabhd">
      {children}
    </button>
  );
}

const INTENT_BADGE = {
  image_gen:  { label: 'IMAGE · GENERATED',    color: ACCENTS.kata },
  image_edit: { label: 'IMAGE · EDITED',       color: ACCENTS.kata },
  bg_remove:  { label: 'BACKGROUND · REMOVED', color: ACCENTS.store },
  video_gen:  { label: 'VIDEO · GENERATED',    color: ACCENTS.crypto },
};

function ChatBubble({ msg, accent, typing, onRetry, retryLabel }) {
  const isUser = msg.role === 'user';
  const badge = !isUser && msg.intent ? INTENT_BADGE[msg.intent] : null;
  const media = (
    <>
      {msg.image && (
        <a href={msg.image} target="_blank" rel="noreferrer" style={{ display: 'block' }}>
          <img src={msg.image} alt="" style={{
            display: 'block', maxWidth: '100%', marginBottom: msg.content ? 10 : 0,
            boxShadow: `0 0 0 3px ${COLORS.ink}`,
          }} />
        </a>
      )}
      {msg.video && (
        <video src={msg.video} controls style={{
          display: 'block', maxWidth: '100%', marginBottom: msg.content ? 10 : 0,
        }} />
      )}
    </>
  );

  if (isUser) {
    return (
      <div style={{
        alignSelf: 'flex-end', position: 'relative', maxWidth: '86%', marginRight: 12,
        padding: '10px 14px', background: COLORS.strip, color: COLORS.stripText,
        fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
        animation: 'px-rise 0.2s steps(3)',
      }}>
        {media}
        {msg.content}
        <svg width="12" height="12" viewBox="0 0 3 3" shapeRendering="crispEdges" aria-hidden="true"
          style={{ position: 'absolute', right: -12, bottom: 0 }}>
          <path d="M0 0h1v1h1v1h1v1H0z" style={{ fill: COLORS.strip }} />
        </svg>
      </div>
    );
  }

  const text = msg.error ? String(msg.content || '').replace(/^⚠\s*/, '') : msg.content;
  return (
    <div style={{
      alignSelf: 'flex-start', position: 'relative', maxWidth: '92%', marginTop: 10,
      animation: 'px-rise 0.2s steps(3)',
    }}>
      <span className="sk" style={{
        position: 'absolute', left: 12, top: -11, zIndex: 1, padding: '3px 8px', fontSize: 10,
        color: COLORS.stripText, background: COLORS.strip,
      }}>SE77N</span>
      <div className="pxs" style={{
        padding: '18px 14px 12px', background: COLORS.paper, color: COLORS.text,
        borderLeft: msg.error ? `6px solid ${COLORS.red}` : undefined,
        fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
      }}>
        {badge && <div style={{ marginBottom: 10 }}><Badge color={badge.color}>{badge.label}</Badge></div>}
        {media}
        {typing ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span className="dots-step" aria-hidden="true" style={{ color: accent }}><i /><i /><i /></span>
            {msg.content && (
              <span className="sk" style={{ fontSize: 10, color: COLORS.muted, marginLeft: 2 }}>
                {msg.content.replace(/…$/, '')}
              </span>
            )}
          </span>
        ) : msg.error ? (
          <span style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <StrokeIcon d={ICON_WARN} size={17} color="var(--sh-red-ink)" style={{ flexShrink: 0, marginTop: 1 }} />
            <span><span className="sr">Error: </span>{text}</span>
          </span>
        ) : text}
        {onRetry && (
          <div style={{ marginTop: 12, paddingBottom: 4 }}>
            <button type="button" onClick={onRetry} className="sbtn sk" style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, height: 32, padding: '0 12px',
              fontSize: 11, background: ACCENTS.ai, color: COLORS.onAccent,
            }}><StrokeIcon d={ICON_RETRY} size={13} sw={2.8} />{retryLabel}</button>
          </div>
        )}
      </div>
    </div>
  );
}
