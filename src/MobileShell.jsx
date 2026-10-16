// MobileShell.jsx — chat-first mobile experience ("B · Pixel Lobby" skin).
// Replaces the desktop chrome (TopBar/NavRail/Breadcrumbs/Footer/ChatFab)
// with a single full-bleed chat surface + slide-in drawer for module nav.
//
// Activated from App.jsx when useMediaQuery('(max-width: 768px)') matches.
// All persistence + auth + i18n hooks come straight from lib.jsx, so the
// shell stays in sync with the desktop build (same /api/agent, same Mongo
// sync, same EN/VI translations, same auth tokens).

import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import {
  COLORS, ACCENTS, withAlpha,
  useClock, useGeoDayNight, useLang, useAuth,
  useSyncedData, usePasteImage, compressImage,
  buildChatHistory,
} from './lib.jsx';
import { ModuleIcon, PixelArrow, PixelCoin } from './ui/arcade.jsx';

const AIPlayground       = lazy(() => import('./featuresA.jsx').then((m) => ({ default: m.AIPlayground })));
const Toolbox            = lazy(() => import('./featuresA.jsx').then((m) => ({ default: m.Toolbox })));
const TravelV4           = lazy(() => import('./tv4/index.jsx').then((m) => ({ default: m.TravelV4 })));
const GamePanel          = lazy(() => import('./featuresA.jsx').then((m) => ({ default: m.GamePanel })));
const TechStackMonitor   = lazy(() => import('./featuresB.jsx').then((m) => ({ default: m.TechStackMonitor })));
const CryptoWatch        = lazy(() => import('./featuresB.jsx').then((m) => ({ default: m.CryptoWatch })));
const TodoList           = lazy(() => import('./featuresB.jsx').then((m) => ({ default: m.TodoList })));
const Feed               = lazy(() => import('./featuresB.jsx').then((m) => ({ default: m.Feed })));
const Stylist            = lazy(() => import('./featuresC.jsx').then((m) => ({ default: m.Stylist })));

// Travel Plan, Subscription Manager and To Do are NOT standalone modules —
// they live inside the Toolbox (routes 'tv4' / 'tech' / 'todo' are still
// rendered, and reached from the Toolbox cards + the drawer's sub-links).
// Numbering matches the desktop tab bar.
const MODULES = [
  { id: 'ai',      short: '01', i18nLabel: 'nav.ai',      i18nDesc: 'feature.ai.desc' },
  { id: 'tools',   short: '02', i18nLabel: 'nav.tools',   i18nDesc: 'feature.tools.desc' },
  { id: 'game',    short: '03', i18nLabel: 'nav.game',    i18nDesc: 'feature.game.desc' },
  { id: 'crypto',  short: '04', i18nLabel: 'nav.crypto',  i18nDesc: 'feature.crypto.desc' },
  { id: 'feed',    short: '05', i18nLabel: 'nav.feed',    i18nDesc: 'feature.feed.desc', ownerOnly: true },
  { id: 'kata',    short: '06', i18nLabel: 'nav.kata',    i18nDesc: 'feature.kata.desc' },
  { id: 'stylist', short: '07', i18nLabel: 'nav.stylist', i18nDesc: 'feature.stylist.desc' },
  { id: 'store',   short: '08', i18nLabel: 'nav.store',   i18nDesc: 'feature.store.desc' },
];

// Toolbox sub-pages, shown as chips under the Toolbox row in the drawer.
const TOOLBOX_SUBS = [
  { id: 'tv4',  label: 'TRAVEL PLAN' },
  { id: 'tech', label: 'SUBSCRIPTIONS' },
  { id: 'todo', label: 'TO DO' },
];
const SUB_IDS = TOOLBOX_SUBS.map((s) => s.id);

// Header chip per in-shell route (number + name in the module accent).
const ROUTE_META = {
  ai:      { num: '01', i18nLabel: 'nav.ai' },
  tools:   { num: '02', i18nLabel: 'nav.tools' },
  tv4:     { num: '02', i18nLabel: 'nav.travel' },
  tech:    { num: '02', i18nLabel: 'nav.tech' },
  todo:    { num: '02', i18nLabel: 'nav.todo' },
  game:    { num: '03', i18nLabel: 'nav.game' },
  crypto:  { num: '04', i18nLabel: 'nav.crypto' },
  feed:    { num: '05', i18nLabel: 'nav.feed' },
  stylist: { num: '07', i18nLabel: 'nav.stylist' },
};

// Slash commands → either prefix the prompt for the chat agent (so the
// router on /api/agent picks the intent) or navigate to a module.
// `swatch` is the little colour square shown in the slash menu.
const SLASH_COMMANDS = [
  { cmd: '/chat',      kind: 'prompt', swatch: ACCENTS.home,   desc: 'Free chat' },
  { cmd: '/translate', kind: 'prompt', swatch: ACCENTS.crypto, desc: 'EN ⇄ VI auto-detect' },
  { cmd: '/tldr',      kind: 'prompt', swatch: ACCENTS.home,   desc: 'Summarize long text' },
  { cmd: '/code',      kind: 'prompt', swatch: ACCENTS.tools,  desc: 'Diagnose & fix' },
  { cmd: '/image',     kind: 'prompt', swatch: ACCENTS.kata,   desc: 'Generate · edit · remove bg' },
  { cmd: '/video',     kind: 'prompt', swatch: ACCENTS.crypto, desc: '5s clip via seedance' },
  // route shortcuts
  { cmd: '/todo',      kind: 'nav', route: 'todo',   swatch: ACCENTS.todo,   desc: 'Jump · to-do list' },
  { cmd: '/crypto',    kind: 'nav', route: 'crypto', swatch: ACCENTS.crypto, desc: 'Jump · markets' },
  { cmd: '/travel',    kind: 'nav', route: 'tv4',    swatch: ACCENTS.tv4,    desc: 'Jump · travel' },
  { cmd: '/tech',      kind: 'nav', route: 'tech',   swatch: ACCENTS.tech,   desc: 'Jump · tech stack' },
  { cmd: '/tools',     kind: 'nav', route: 'tools',  swatch: ACCENTS.tools,  desc: 'Jump · toolbox' },
  { cmd: '/feed',      kind: 'nav', route: 'feed',   swatch: ACCENTS.feed,   desc: 'Jump · feed' },
  { cmd: '/game',      kind: 'nav', route: 'game',   swatch: ACCENTS.game,   desc: 'Jump · game' },
  { cmd: '/kata',      kind: 'url', url: '/kata',    swatch: ACCENTS.kata,   desc: 'Open · KataS dashboard' },
];

const SUGGESTIONS = [
  { cmd: '/translate', i18nKey: 'mobile.try.translate', fallback: 'translate text' },
  { cmd: '/image',     i18nKey: 'mobile.try.image',     fallback: 'render an image' },
  { cmd: '/tldr',      i18nKey: 'mobile.try.tldr',      fallback: 'summarize an article' },
  { cmd: '/code',      i18nKey: 'mobile.try.code',      fallback: 'debug a snippet' },
];

// Kind badges on assistant replies — pixel chips on the module accents.
const INTENT_BADGE = {
  image_gen:  { label: 'IMAGE · GENERATED', color: ACCENTS.kata },
  image_edit: { label: 'IMAGE · EDITED',    color: ACCENTS.kata },
  bg_remove:  { label: 'BG · REMOVED',      color: '#9fd8ff' },
  video_gen:  { label: 'VIDEO · GENERATED', color: ACCENTS.crypto },
  translate:  { label: 'TRANSLATE',         color: ACCENTS.crypto },
  code:       { label: 'CODE',              color: ACCENTS.tools },
  tldr:       { label: 'TL;DR',             color: ACCENTS.home },
};
const ERROR_BADGE = { label: 'ERROR', color: ACCENTS.ai };

const MONO = "'JetBrains Mono', ui-monospace, monospace";
const pad2 = (n) => String(n).padStart(2, '0');

// Shell-only CSS (hover/press states, staggered menu entrance, theme-aware
// text red). Motion is transform/opacity only and stops under .still /
// prefers-reduced-motion via the global rules in arcade.css.
const MOBILE_CSS = `
.ms-root {
  --ms-red-ink: #b42828;
  background-image: radial-gradient(var(--dot) 1.2px, transparent 1.6px);
  background-size: 14px 14px;
}
[data-theme="dark"] .ms-root { --ms-red-ink: #ff8f8f; }
.ms-dots {
  background-image: radial-gradient(var(--dot) 1.2px, transparent 1.6px);
  background-size: 14px 14px;
}
.ms-row {
  box-shadow: 0 -3px 0 0 var(--ink), 0 3px 0 0 var(--ink), -3px 0 0 0 var(--ink), 3px 0 0 0 var(--ink),
    4px 5px 0 3px var(--shadow);
  transition: transform 80ms steps(2);
}
.ms-row:active { transform: translate(3px, 4px); }
.ms-row .ms-cur { opacity: 0; }
.ms-row.on .ms-cur { opacity: 1; }
.ms-in .ms-row { animation: ms-rise 0.35s steps(4) backwards; }
@keyframes ms-rise { from { opacity: 0; transform: translateX(-18px); } to { opacity: 1; transform: none; } }
.ms-press { transition: transform 60ms; }
.ms-press:active:not(:disabled) { transform: translate(2px, 2px); }
.ms-srow { background: transparent; }
.ms-srow:hover { background: var(--paper-2); }
.ms-attach:focus-within { outline: 3px solid var(--red); outline-offset: 3px; }
.ms-drawer { border-right: 4px solid var(--ink); }
@media (max-width: 440px) { .ms-drawer { border-right: 0; } }
`;

// Pixel glyphs (crispEdges) used by the shell's icon buttons.
function PixelX({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 5 5" shapeRendering="crispEdges" aria-hidden="true">
      <path d="M0 0h1v1h1v1h1V1h1V0h1v1H4v1H3v1h1v1h1v1H4V4H3V3H2v1H1v1H0V4h1V3h1V2H1V1H0z" fill="currentColor" />
    </svg>
  );
}

function PixelPlus({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 5 5" shapeRendering="crispEdges" aria-hidden="true">
      <path d="M2 0h1v2h2v1H3v2H2V3H0V2h2z" fill="currentColor" />
    </svg>
  );
}

function PixelSun({ size = 12, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 6 6" shapeRendering="crispEdges" aria-hidden="true">
      <path d="M2 0h2v1h1v1h1v2H5v1H4v1H2V5H1V4H0V2h1V1h1z" fill={color} />
    </svg>
  );
}

function PixelMoon({ size = 12, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 6 6" shapeRendering="crispEdges" aria-hidden="true">
      <path d="M2 0h3v1H3v1H2v2h1v1h2v1H2V5H1V4H0V2h1V1h1z" fill={color} />
    </svg>
  );
}

function MenuGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="square" aria-hidden="true">
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

// Square 44px icon button with the small pixel ring.
const iconBtn = {
  display: 'grid', placeItems: 'center', flexShrink: 0,
  width: 44, height: 44, padding: 0, border: 0,
  background: COLORS.paper, color: COLORS.text, cursor: 'pointer',
};

// ─────────────────────────────────────────────────────────────
// Top bar — 66px paper header.
//   chat:    se77n logo · prompt-count coin chip · new chat · menu
//   modules: back · module chip (number + name, module accent) · menu
// ─────────────────────────────────────────────────────────────
function MobileTopBar({ onMenu, onNewChat, route, onBack, prompts = 0 }) {
  const { t } = useLang();
  const inChat = route === 'ai';
  const meta = ROUTE_META[route] || ROUTE_META.ai;
  const accent = ACCENTS[route] || ACCENTS.ai;
  return (
    <header style={{
      flexShrink: 0,
      height: 66,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
      padding: '0 14px',
      paddingTop: 'env(safe-area-inset-top, 0px)',
      boxSizing: 'content-box',
      background: COLORS.paper,
      borderBottom: '4px solid ' + COLORS.ink,
      position: 'relative', zIndex: 30,
    }}>
      {inChat ? (
        <>
          <button onClick={onBack} aria-label="home"
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
              padding: 0, border: 0, background: 'transparent',
              color: COLORS.text, cursor: 'pointer', textAlign: 'left',
            }}>
            <span className="pf" style={{ fontSize: 28, lineHeight: 1 }}>
              se<span style={{ color: COLORS.red, textShadow: '2px 2px 0 ' + COLORS.ink }}>77</span>n
            </span>
            <span className="sk" style={{ fontSize: 9, color: COLORS.muted }}>WORLD 007</span>
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span className="sk pxs" title="prompts sent" aria-label={prompts + ' prompts sent'}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 8px', fontSize: 12,
                background: ACCENTS.crypto, color: COLORS.onAccent,
              }}>
              <PixelCoin size={14} />× {pad2(Math.min(prompts, 99))}
            </span>
            <button onClick={onNewChat} className="pxs ms-press" aria-label="new chat" title="new chat" style={iconBtn}>
              <PixelPlus size={15} />
            </button>
            <button onClick={onMenu} className="pxs ms-press" aria-label="modules" title="modules" style={iconBtn}>
              <MenuGlyph />
            </button>
          </div>
        </>
      ) : (
        <>
          <button onClick={onBack} className="pxs ms-press" aria-label="back to chat" title="back to chat" style={iconBtn}>
            <PixelArrow dir="left" size={16} />
          </button>
          <span className="sk pxs" style={{
            display: 'flex', alignItems: 'center', gap: 8, minWidth: 0,
            padding: '8px 12px', fontSize: 12,
            background: accent, color: COLORS.onAccent,
            whiteSpace: 'nowrap', overflow: 'hidden', textTransform: 'uppercase',
          }}>
            <span style={{ opacity: 0.7 }}>{meta.num}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{t(meta.i18nLabel)}</span>
          </span>
          <button onClick={onMenu} className="pxs ms-press" aria-label="modules" title="modules" style={iconBtn}>
            <MenuGlyph />
          </button>
        </>
      )}
    </header>
  );
}

// ─────────────────────────────────────────────────────────────
// Drawer — full-height module menu, slides from left
// ─────────────────────────────────────────────────────────────
function Drawer({ open, onClose, route, onNav }) {
  const { t, lang, toggle } = useLang();
  const { status, user, login, logout } = useAuth();
  const [authPanel, setAuthPanel] = useState(false);
  const isOwner = !!user?.isHistoryOwner;
  const visibleModules = MODULES.filter((m) => !m.ownerOnly || isOwner);
  const activeId = SUB_IDS.includes(route) ? 'tools' : route;
  const authed = status === 'authed';

  // close auth panel when drawer closes
  useEffect(() => { if (!open) setAuthPanel(false); }, [open]);

  const go = (id) => {
    if (id === 'kata') { window.location.assign('/kata'); return; }
    if (id === 'store') { window.location.assign('/store'); return; }
    onNav(id);
    onClose();
  };

  return (
    <>
      <div onClick={onClose} aria-hidden
        style={{
          position: 'fixed', inset: 0, zIndex: 80,
          background: open ? withAlpha('#1b1410', 0.55) : 'transparent',
          pointerEvents: open ? 'auto' : 'none',
          transition: 'background 220ms ease',
        }} />

      <aside aria-label="Module menu" aria-hidden={!open} className="ms-dots ms-drawer" style={{
        position: 'fixed', top: 0, bottom: 0, left: 0, zIndex: 90,
        width: '100%', maxWidth: 440,
        backgroundColor: COLORS.bg,
        transform: open ? 'translateX(0)' : 'translateX(-100%)',
        visibility: open ? 'visible' : 'hidden',
        transition: open
          ? 'transform 280ms cubic-bezier(0.22,1,0.36,1), visibility 0s'
          : 'transform 280ms cubic-bezier(0.22,1,0.36,1), visibility 0s linear 280ms',
        display: 'flex', flexDirection: 'column',
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}>
        {/* header */}
        <div style={{
          flexShrink: 0, height: 66,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          padding: '0 14px 0 16px',
          background: COLORS.strip, color: COLORS.stripText,
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span className="pf" style={{ fontSize: 28, lineHeight: 1 }}>
              se<span style={{ color: ACCENTS.ai }}>77</span>n
            </span>
            <span className="sk" style={{ fontSize: 9, color: '#c9bca6', textTransform: 'uppercase' }}>
              {t('topbar.experiment')} 007 · Mobile
            </span>
          </div>
          <button onClick={onClose} aria-label="close" className="ms-press"
            style={{ ...iconBtn, background: '#fffaf0', color: '#1b1410' }}>
            <PixelX size={16} />
          </button>
        </div>

        {/* modules */}
        <nav key={open ? 'open' : 'closed'} className={open ? 'ms-in' : undefined}
          aria-label={t('home.modules')}
          style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '22px 18px 24px 30px' }}>
          <p className="sk" style={{
            display: 'flex', justifyContent: 'space-between', gap: 10,
            margin: '0 0 18px -12px', fontSize: 11, color: COLORS.muted,
          }}>
            <span>SELECT MODULE</span>
            <span style={{ color: COLORS.greenInk }}>{pad2(visibleModules.length)} ONLINE</span>
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {visibleModules.map((m, i) => {
              const row = (
                <ModuleRow key={m.id} m={m} index={i} active={m.id === activeId}
                  label={t(m.i18nLabel)} desc={t(m.i18nDesc)} onClick={() => go(m.id)} />
              );
              if (m.id !== 'tools') return row;
              return (
                <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {row}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 10px', paddingLeft: 6 }}>
                    {TOOLBOX_SUBS.map((s) => (
                      <button key={s.id} onClick={() => go(s.id)}
                        aria-current={route === s.id ? 'page' : undefined}
                        className={'sk chip-px ms-press' + (route === s.id ? ' on' : '')}
                        style={{ minHeight: 34, padding: '0 8px', fontSize: 9 }}>
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </nav>

        {/* footer · auth + lang + theme */}
        <div style={{
          flexShrink: 0,
          display: 'flex', flexDirection: 'column', gap: 16,
          padding: '14px 16px 18px',
          background: COLORS.paper,
          borderTop: '4px solid ' + COLORS.ink,
        }}>
          {!authPanel ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '3px 3px 0' }}>
                <button onClick={() => setAuthPanel(true)}
                  style={{
                    flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 12,
                    padding: 0, background: 'transparent', border: 0,
                    color: COLORS.text, cursor: 'pointer', textAlign: 'left',
                  }}>
                  {authed && user?.avatarUrl ? (
                    <img src={user.avatarUrl} alt="" className="pxs" style={{
                      width: 40, height: 40, flexShrink: 0, objectFit: 'cover',
                    }} />
                  ) : (
                    <span className="pf pxs" aria-hidden style={{
                      width: 40, height: 40, flexShrink: 0,
                      background: ACCENTS.ai, color: COLORS.onAccent,
                      display: 'grid', placeItems: 'center', fontSize: 20,
                    }}>{((user?.displayName || user?.username || 'g').slice(0, 1)).toUpperCase()}</span>
                  )}
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span className="sk" style={{
                      display: 'block', fontSize: 13,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{authed ? (user?.displayName || user?.username || '—') : 'P1 GUEST'}</span>
                    <span style={{
                      display: 'block', marginTop: 2, fontSize: 11, color: COLORS.muted,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{authed ? t('auth.signedInAs') : t('auth.guest')}</span>
                  </span>
                </button>
                {authed ? (
                  <button onClick={logout} className="sk sbtn"
                    style={{ height: 40, padding: '0 12px', fontSize: 11, background: COLORS.paper, color: COLORS.text, flexShrink: 0 }}>
                    {t('auth.logout').toUpperCase()}
                  </button>
                ) : (
                  <button onClick={() => setAuthPanel(true)} className="sk sbtn"
                    style={{ height: 40, padding: '0 12px', fontSize: 11, background: COLORS.red, color: COLORS.onAccent, flexShrink: 0 }}>
                    {t('auth.signIn').toUpperCase()}
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', gap: 14, padding: '0 3px 3px' }}>
                <div role="group" aria-label={t('topbar.toggleLang')} title={t('topbar.toggleLang')}
                  className="sk pxs" style={{ display: 'flex', flex: 1, background: COLORS.paper }}>
                  {['en', 'vi'].map((code) => {
                    const on = lang === code;
                    return (
                      <button key={code} aria-pressed={on}
                        onClick={() => { if (!on) toggle(); }}
                        style={{
                          flex: 1, height: 44, border: 0, cursor: 'pointer',
                          fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
                          background: on ? COLORS.text : 'transparent',
                          color: on ? COLORS.paper : COLORS.text,
                        }}>{code.toUpperCase()}</button>
                    );
                  })}
                </div>
                <ThemeToggleMini />
              </div>
            </>
          ) : (
            <AuthPanel
              status={status} user={user} login={login} logout={logout}
              onBack={() => setAuthPanel(false)}
            />
          )}
        </div>
      </aside>
    </>
  );
}

// One "SELECT MODULE" row: accent icon tile, title + desc, number (or OWNER).
function ModuleRow({ m, index, active, label, desc, onClick }) {
  const accent = ACCENTS[m.id];
  return (
    <button onClick={onClick} aria-current={active ? 'page' : undefined}
      className={'ms-row' + (active ? ' on' : '')}
      style={{
        position: 'relative', width: '100%',
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 12px 10px 10px', border: 0,
        background: active ? accent : COLORS.paper,
        color: active ? COLORS.onAccent : COLORS.text,
        cursor: 'pointer', textAlign: 'left',
        animationDelay: index * 40 + 'ms',
      }}>
      <PixelArrow dir="right" size={14} color={COLORS.red} className={'ms-cur' + (active ? ' blink' : '')}
        style={{ position: 'absolute', left: -22, top: '50%', marginTop: -7 }} />
      <span style={{
        display: 'grid', placeItems: 'center', flexShrink: 0,
        width: 40, height: 40, boxSizing: 'border-box',
        background: active ? '#fffaf0' : accent, color: '#1b1410',
        border: '3px solid #1b1410',
      }}>
        <ModuleIcon id={m.id} size={22} strokeWidth={2.6} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className="pf" style={{ display: 'block', fontSize: 18, lineHeight: 1.1 }}>{label}</span>
        <span style={{
          display: 'block', marginTop: 3, fontSize: 11, lineHeight: 1.35,
          color: active ? COLORS.onAccent : COLORS.muted,
        }}>{desc}</span>
      </span>
      {m.ownerOnly ? (
        <span className="sk pxs" style={{
          padding: '3px 6px', fontSize: 9, background: ACCENTS.crypto, color: COLORS.onAccent,
        }}>OWNER</span>
      ) : (
        <span className="sk" style={{ fontSize: 11, color: active ? COLORS.onAccent : COLORS.muted }}>{m.short}</span>
      )}
    </button>
  );
}

function AuthPanel({ status, user, login, logout, onBack }) {
  const { t } = useLang();
  return (
    <div className="rise" style={{ padding: '3px 3px 0' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12,
      }}>
        <div className="sk" style={{ fontSize: 10, color: COLORS.muted, textTransform: 'uppercase' }}>
          {status === 'authed'
            ? t('auth.signedInAs') + ' · ' + (user?.provider?.toUpperCase() || '—')
            : t('auth.signInTitle')}
        </div>
        <button onClick={onBack} aria-label="back" className="pxs ms-press"
          style={{ ...iconBtn, width: 36, height: 36 }}>
          <PixelX size={12} />
        </button>
      </div>

      {status === 'authed' ? (
        <>
          <div style={{ padding: '0 0 14px', color: COLORS.text }}>
            <div className="pf" style={{ fontSize: 18, lineHeight: 1.15 }}>{user?.displayName || '—'}</div>
            {user?.email && (
              <div style={{ fontSize: 11, color: COLORS.muted, marginTop: 3 }}>{user.email}</div>
            )}
          </div>
          <button onClick={logout} className="sk sbtn"
            style={{
              width: '100%', minHeight: 44, display: 'flex', alignItems: 'center', gap: 10,
              padding: '0 12px', fontSize: 12, background: COLORS.paper, color: COLORS.text,
            }}>
            <PixelArrow dir="left" size={11} />{t('auth.logout').toUpperCase()}
          </button>
        </>
      ) : (
        <>
          <div style={{ padding: '0 0 14px', fontSize: 12, color: COLORS.muted, lineHeight: 1.5 }}>
            {t('auth.signInDesc')}
          </div>
          <ProviderBtn provider="discord" color="#5865F2" label={t('auth.discord')} onClick={() => login('discord')} />
          <div style={{ height: 14 }} />
          <ProviderBtn provider="google"  color="#EA4335" label={t('auth.google')}  onClick={() => login('google')} />
        </>
      )}
    </div>
  );
}

function ProviderBtn({ provider, color, label, onClick }) {
  return (
    <button onClick={onClick} className="sbtn"
      style={{
        width: '100%', minHeight: 44, display: 'flex', alignItems: 'center', gap: 12,
        padding: '0 12px', background: COLORS.paper, color: COLORS.text,
        fontFamily: MONO, fontSize: 12, fontWeight: 700, textAlign: 'left',
      }}>
      <span aria-hidden style={{
        display: 'grid', placeItems: 'center', flexShrink: 0, width: 26, height: 26,
        background: '#fffaf0', border: '2px solid ' + withAlpha(color, 0.6),
      }}>
        {provider === 'discord' ? (
          <svg width="15" height="15" viewBox="0 0 24 24" fill={color}>
            <path d="M20.317 4.37a19.79 19.79 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.74 19.74 0 003.677 4.37a.07.07 0 00-.032.028C.533 9.046-.32 13.58.099 18.058a.082.082 0 00.031.056 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.873-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.1 13.1 0 01-1.872-.892.077.077 0 01-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 01.078-.01c3.928 1.793 8.18 1.793 12.061 0a.074.074 0 01.079.01c.12.099.246.197.373.291a.077.077 0 01-.006.128 12.3 12.3 0 01-1.873.891.076.076 0 00-.04.107c.36.698.772 1.363 1.225 1.993a.076.076 0 00.084.028 19.84 19.84 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.029zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
          </svg>
        ) : (
          <svg width="15" height="15" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M21.6 12.227c0-.709-.064-1.39-.182-2.045H12v3.868h5.382a4.6 4.6 0 01-1.995 3.018v2.51h3.232c1.891-1.741 2.981-4.305 2.981-7.351z" />
            <path fill="#34A853" d="M12 22c2.7 0 4.964-.895 6.619-2.422l-3.232-2.51c-.895.6-2.04.955-3.387.955-2.605 0-4.81-1.76-5.595-4.124H3.064v2.59A9.996 9.996 0 0012 22z" />
            <path fill="#FBBC05" d="M6.405 13.9a6.012 6.012 0 010-3.8V7.51H3.064a10.001 10.001 0 000 8.98l3.341-2.59z" />
            <path fill="#EA4335" d="M12 5.977c1.468 0 2.786.504 3.823 1.495l2.868-2.868C16.96 2.99 14.696 2 12 2 8.092 2 4.71 4.244 3.064 7.51l3.341 2.59C7.19 7.736 9.395 5.977 12 5.977z" />
          </svg>
        )}
      </span>
      <span style={{ flex: 1 }}>{label}</span>
      <span aria-hidden style={{ color: COLORS.muted, fontSize: 12 }}>↗</span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// Light / dark toggle (mobile) — mirrors the desktop LightToggle.
// Persisted in `kata.theme` (shared with desktop + kata pages), applied via
// [data-theme] on <html>; palette flip lives in styles.css. Default is light.
// ─────────────────────────────────────────────────────────────
function readThemeMode() {
  try {
    const m = localStorage.getItem('kata.theme');
    if (m === 'light' || m === 'dark') return m;
  } catch { /* ignore */ }
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function ThemeToggleMini() {
  const [mode, setMode] = useState(readThemeMode);
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', mode);
    try {
      localStorage.setItem('kata.theme', mode);
      document.querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', mode === 'light' ? '#f3eee4' : '#0d0a08');
    } catch { /* ignore */ }
  }, [mode]);
  useEffect(() => {
    const onStorage = (e) => { if (e.key === 'kata.theme') setMode(readThemeMode()); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const light = mode === 'light';
  return (
    <button onClick={() => setMode(light ? 'dark' : 'light')}
      title={light ? 'Switch to dark' : 'Switch to light'}
      aria-label={light ? 'Switch to dark' : 'Switch to light'}
      className="sk pxs ms-press"
      style={{
        flex: 1, height: 44, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        padding: 0, border: 0, cursor: 'pointer',
        background: COLORS.paper, color: COLORS.text, fontSize: 12,
      }}>
      {light ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="square" aria-hidden="true">
          <rect x="8" y="8" width="8" height="8" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
        </svg>
      ) : (
        <PixelMoon size={15} />
      )}
      {light ? 'LIGHT' : 'DARK'}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// Hero — time-aware greeting; reads live clock + geolocation phase
// ─────────────────────────────────────────────────────────────
function HeroGreeting({ name }) {
  const { t } = useLang();
  const now = useClock();
  const geo = useGeoDayNight();
  const hour = now.getHours();
  const phase = hour >= 5 && hour < 12 ? 'morning'
              : hour < 17 ? 'afternoon'
              : hour < 22 ? 'evening' : 'late';
  const isDay = geo.phase === 'day';
  const tStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const tzShort = (geo.tz || '').split('/').pop()?.replace(/_/g, ' ') || '—';
  return (
    <div>
      <p className="sk" style={{
        display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 12px',
        fontSize: 10, color: COLORS.muted,
      }}>
        <span className="pxs" aria-hidden style={{
          display: 'grid', placeItems: 'center', width: 20, height: 20, flexShrink: 0,
          background: isDay ? ACCENTS.crypto : '#9fd8ff',
        }}>
          {isDay ? <PixelSun color="#1b1410" /> : <PixelMoon color="#1b1410" />}
        </span>
        <span>{isDay ? 'DAYLIGHT' : 'NIGHTSHIFT'} · {tStr} · {geo.city || tzShort}</span>
      </p>
      <h1 className="pf" style={{
        margin: 0, fontSize: 30, lineHeight: 1.08, color: COLORS.text, overflowWrap: 'anywhere',
      }}>
        {t('mobile.greeting.' + phase)},<br/>
        <span style={{ color: COLORS.red, textShadow: '2px 2px 0 ' + COLORS.ink }}>{name}</span>
        <span className="blink" aria-hidden style={{
          display: 'inline-block', width: 8, height: 24, marginLeft: 6, verticalAlign: '-3px',
          background: COLORS.red,
        }} />
      </h1>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Empty state — hero + try-this suggestion chips
// ─────────────────────────────────────────────────────────────
function EmptyState({ onSuggest, displayName }) {
  const { t } = useLang();
  return (
    <section aria-label="Welcome" className="rise" style={{ marginTop: 2 }}>
      <p className="sk" style={{
        display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 12px',
        fontSize: 10, color: 'var(--ms-red-ink)',
      }}>
        <span className="blink" aria-hidden style={{ width: 8, height: 8, background: COLORS.red }} />
        ONLINE · EXP 007
      </p>

      <HeroGreeting name={displayName} />

      <p style={{
        margin: '14px 0 0', maxWidth: 330,
        fontSize: 12.5, color: COLORS.muted, lineHeight: 1.6,
      }}>
        {t('mobile.heroHelp')} <kbd className="pxs" style={{
          margin: '0 3px', padding: '0 5px',
          fontFamily: MONO, fontSize: 12, fontWeight: 700,
          color: COLORS.text, background: COLORS.paper,
        }}>/</kbd> {t('mobile.heroHelpTail')}
      </p>

      <p className="sk" style={{ margin: '20px 0 12px', fontSize: 10, color: COLORS.muted }}>TRY ·</p>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        gap: '14px 16px', padding: '0 3px 6px',
      }}>
        {SUGGESTIONS.map((s) => (
          <button key={s.cmd} onClick={() => onSuggest(s.cmd + ' ')} className="pxs ms-press"
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center', gap: 3,
              minHeight: 52, padding: '6px 10px', border: 0,
              background: COLORS.paper, color: COLORS.text,
              cursor: 'pointer', textAlign: 'left', fontFamily: MONO,
            }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ms-red-ink)' }}>{s.cmd}</span>
            <span style={{ fontSize: 11, color: COLORS.muted }}>{t(s.i18nKey)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// Chat bubbles
// ─────────────────────────────────────────────────────────────
function DayDivider({ label }) {
  return (
    <div className="sk" style={{
      display: 'flex', alignItems: 'center', gap: 10,
      fontSize: 10, color: COLORS.muted,
      padding: '2px 0 4px',
    }}>
      <span aria-hidden style={{ flex: 1, borderTop: '3px dashed ' + COLORS.rule }} />
      <span>{label}</span>
      <span aria-hidden style={{ flex: 1, borderTop: '3px dashed ' + COLORS.rule }} />
    </div>
  );
}

// Name plate + kind badge straddling the top edge of an assistant dialog box.
function SpeakerPlate({ badge }) {
  return (
    <div style={{
      position: 'absolute', left: 12, top: -12, zIndex: 1,
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <span className="sk" style={{
        padding: '4px 9px', fontSize: 10, color: COLORS.stripText, background: COLORS.strip,
      }}>SE77N</span>
      {badge && (
        <span className="sk pxs" style={{
          padding: '2px 6px', fontSize: 9, whiteSpace: 'nowrap',
          background: badge.color, color: COLORS.onAccent,
        }}>{badge.label}</span>
      )}
    </div>
  );
}

function Bubble({ msg, onRetry, retryLabel }) {
  const isUser = msg.role === 'user';

  if (isUser) {
    return (
      <div className="rise" style={{
        alignSelf: 'flex-end', position: 'relative', maxWidth: '85%', marginRight: 10,
        padding: '8px 12px',
        background: COLORS.text, color: COLORS.paper,
        fontSize: 13, lineHeight: 1.5,
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>
        {msg.image && (
          <img src={msg.image} alt="" style={{
            display: 'block', maxWidth: '100%',
            marginBottom: msg.content && msg.content !== '(image)' ? 8 : 0,
            border: '3px solid ' + COLORS.paper,
          }} />
        )}
        {msg.content && msg.content !== '(image)' && msg.content}
        <svg width="10" height="10" viewBox="0 0 3 3" shapeRendering="crispEdges" aria-hidden="true"
          style={{ position: 'absolute', right: -10, bottom: 0 }}>
          <path d="M0 0h1v1h1v1h1v1H0z" fill={COLORS.text} />
        </svg>
      </div>
    );
  }

  const badge = msg.error ? ERROR_BADGE : (msg.intent ? INTENT_BADGE[msg.intent] : null);
  // Error replies carry a leading warning glyph in their text; the ERROR chip replaces it.
  const content = msg.error && typeof msg.content === 'string' ? msg.content.replace(/^⚠\s*/, '') : msg.content;

  return (
    <div className="rise" style={{
      alignSelf: 'flex-start', position: 'relative', maxWidth: '92%', marginTop: 12,
    }}>
      <SpeakerPlate badge={badge} />
      <div className="px" style={{
        padding: '22px 14px 14px',
        background: COLORS.paper, color: COLORS.text,
        fontSize: 13, lineHeight: 1.55,
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>
        {msg.image && (
          <a href={msg.image} target="_blank" rel="noreferrer" style={{ display: 'block' }}>
            <img src={msg.image} alt="" style={{
              display: 'block', maxWidth: '100%',
              marginBottom: msg.content ? 10 : 0,
              border: '3px solid ' + COLORS.ink,
            }} />
          </a>
        )}
        {msg.video && (
          <video src={msg.video} controls style={{
            display: 'block', maxWidth: '100%',
            marginBottom: msg.content ? 10 : 0,
            border: '3px solid ' + COLORS.ink,
          }} />
        )}
        {content}
        {onRetry && (
          <div style={{ marginTop: 12, paddingBottom: 4 }}>
            <button onClick={onRetry} className="sk sbtn" style={{
              minHeight: 36, padding: '0 12px', fontSize: 11,
              background: ACCENTS.ai, color: COLORS.onAccent,
            }}>↻ {retryLabel}</button>
          </div>
        )}
      </div>
    </div>
  );
}

function TypingBubble({ hint }) {
  return (
    <div role="status" className="rise" style={{
      alignSelf: 'flex-start', position: 'relative', maxWidth: '92%', marginTop: 12,
    }}>
      <SpeakerPlate badge={{ label: 'RENDERING', color: ACCENTS.crypto }} />
      <div className="px" style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '22px 16px 14px', background: COLORS.paper,
      }}>
        <span className="dots-step" aria-hidden style={{ display: 'inline-flex', alignItems: 'center', color: COLORS.text }}>
          <i /><i /><i />
        </span>
        {hint && (
          <span style={{ fontSize: 11, color: COLORS.muted }}>{hint}</span>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Slash menu — pixel popover above the dock
// ─────────────────────────────────────────────────────────────
function SlashMenu({ query, onPick }) {
  const q = query.toLowerCase();
  const list = SLASH_COMMANDS.filter(c => c.cmd.startsWith(q) || c.desc.toLowerCase().includes(q.slice(1)));
  const items = (list.length ? list : SLASH_COMMANDS).slice(0, 6);
  return (
    <div className="px rise" role="listbox" aria-label="Slash commands" style={{
      position: 'absolute', left: 14, right: 18, bottom: 'calc(100% + 16px)',
      background: COLORS.paper, zIndex: 20,
    }}>
      <div className="sk" style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        height: 36, padding: '0 12px', fontSize: 10,
        color: COLORS.stripText, background: COLORS.strip,
      }}>
        <span>SLASH · {pad2(items.length)} MATCHES</span>
        <span aria-hidden>↵</span>
      </div>
      <div style={{ maxHeight: 280, overflowY: 'auto' }}>
        {items.map((c, i) => {
          const hi = i === 0;
          return (
            <button key={c.cmd} onClick={() => onPick(c)} role="option" aria-selected={hi}
              className="ms-srow"
              style={{
                width: '100%', minHeight: 44, display: 'flex', alignItems: 'center', gap: 10,
                padding: '0 12px', border: 0,
                borderBottom: i < items.length - 1 ? '3px dashed ' + COLORS.rule : 0,
                background: hi ? ACCENTS.ai : undefined,
                color: hi ? COLORS.onAccent : COLORS.text,
                cursor: 'pointer', textAlign: 'left', fontFamily: MONO,
              }}>
              <span aria-hidden style={{
                flexShrink: 0, width: 10, height: 10, background: c.swatch, border: '2px solid #1b1410',
              }} />
              <span style={{ minWidth: 84, fontSize: 13, fontWeight: 700 }}>{c.cmd}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: hi ? COLORS.onAccent : COLORS.muted }}>{c.desc}</span>
              {c.kind === 'nav' && (
                <span className="sk" style={{ fontSize: 9, color: hi ? COLORS.onAccent : COLORS.muted }}>NAV</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Input bar — pixel dock: attach · field · red arcade send button
// ─────────────────────────────────────────────────────────────
function InputBar({ inputRef, value, onChange, onSend, attached, onPickFile, onRemoveAttach, busy }) {
  const hasContent = value.trim().length > 0 || !!attached;
  const slashOpen = value.startsWith('/') && !busy;
  const canSend = hasContent && !busy;

  return (
    <div style={{
      position: 'relative', flexShrink: 0, zIndex: 3,
      background: COLORS.paper,
      borderTop: '4px solid ' + COLORS.ink,
      padding: '14px 16px 10px 18px',
      paddingBottom: 'calc(10px + env(safe-area-inset-bottom, 0px))',
    }}>
      {slashOpen && <SlashMenu query={value.split(/\s/)[0]} onPick={(c) => onSend(c, true)} />}

      {attached && (
        <div className="pxs" style={{
          display: 'flex', alignItems: 'center', gap: 10,
          margin: '0 4px 16px 3px', padding: '5px 5px 5px 6px',
          background: COLORS.paper,
        }}>
          <img src={attached.dataUrl} alt="" style={{
            width: 36, height: 36, flexShrink: 0, objectFit: 'cover', boxSizing: 'border-box',
            border: '3px solid ' + COLORS.ink,
          }} />
          <span style={{
            fontSize: 12, color: COLORS.text, flex: 1, minWidth: 0,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{attached.name}</span>
          <button onClick={onRemoveAttach} aria-label="remove" className="ms-press"
            style={{
              display: 'grid', placeItems: 'center', flexShrink: 0,
              width: 44, height: 40, padding: 0, border: 0, cursor: 'pointer',
              background: COLORS.text, color: COLORS.paper,
            }}>
            <PixelX size={12} />
          </button>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <label title="attach image" className="pxs ms-attach"
          style={{
            position: 'relative', flexShrink: 0,
            width: 44, height: 46,
            display: 'grid', placeItems: 'center', cursor: 'pointer',
            background: attached ? ACCENTS.crypto : COLORS.paper,
            color: attached ? COLORS.onAccent : COLORS.text,
          }}>
          <input type="file" accept="image/*" onChange={onPickFile} className="sr" />
          <span className="sr">attach image</span>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true">
            <path d="M7 9v10h10V4h-7v11h4V8" />
          </svg>
        </label>

        <label htmlFor="ms-chat-input" className="sr">ask se77n</label>
        <textarea
          id="ms-chat-input"
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="ask se77n…"
          rows={1}
          disabled={busy}
          className="field"
          style={{
            flex: 1, minWidth: 0, height: 46, maxHeight: 100,
            resize: 'none', boxSizing: 'border-box',
            padding: '13px 12px', fontSize: 14, lineHeight: 1.4,
            fontFamily: MONO,
            opacity: busy ? 0.7 : 1,
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); }
          }}
        />

        <button onClick={() => onSend()} disabled={!canSend} aria-label="send" title="send"
          className="sk abtn round"
          style={{
            display: 'grid', placeItems: 'center', flexShrink: 0,
            width: 52, height: 52, padding: 0,
            fontSize: 20, color: '#fffaf0', background: '#e04545',
            opacity: canSend ? 1 : 0.45,
            cursor: canSend ? 'pointer' : 'not-allowed',
          }}>A</button>
      </div>

      <div className="sk" style={{
        marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
        fontSize: 9, color: COLORS.muted,
      }}>
        <span>SE77N · GEMINI 3.1 VIA YUNWU</span>
        <span>/ FOR INTENTS</span>
      </div>
    </div>
  );
}

function RouteFallback() {
  return (
    <div role="status" style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '40px 6px', color: COLORS.muted,
    }}>
      <span className="dots-step" aria-hidden style={{ display: 'inline-flex', alignItems: 'center', color: COLORS.text }}>
        <i /><i /><i />
      </span>
      <span className="sk" style={{ fontSize: 11 }}>LOADING MODULE…</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// MobileShell — the export App.jsx renders when isMobile
// ─────────────────────────────────────────────────────────────
export default function MobileShell() {
  const { t } = useLang();
  const { user } = useAuth();
  const displayName = (user?.displayName || user?.username || 'zzzzz').toLowerCase();

  const [route, setRoute] = useState(() => {
    const h = (typeof window !== 'undefined' ? window.location.hash : '').replace(/^#\//, '').split('/')[0];
    return ['ai', 'tools', 'stylist', 'tv4', 'game', 'tech', 'crypto', 'todo', 'feed'].includes(h) ? h : 'ai';
  });
  const [drawerOpen, setDrawerOpen] = useState(false);

  // chat state — synced via /api/sync the same way desktop does
  const [history, setHistory] = useSyncedData(
    { localKey: 'se77n.ai.history.v2', serverKey: 'aiHistory' },
    {},
  );
  const messages = history.chat || [];

  const [input, setInput] = useState('');
  const [attached, setAttached] = useState(null);
  const [busy, setBusy] = useState(false);
  const [busyHint, setBusyHint] = useState(t('fab.thinking'));
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  function nav(id) {
    setRoute(id);
    window.history.replaceState(null, '', '#/' + id);
    setDrawerOpen(false);
  }

  // hashchange sync (back/forward button)
  useEffect(() => {
    const onHash = () => {
      const h = window.location.hash.replace(/^#\//, '').split('/')[0];
      const next = ['ai', 'tools', 'stylist', 'tv4', 'game', 'tech', 'crypto', 'todo', 'feed'].includes(h) ? h : 'ai';
      if (next !== route) setRoute(next);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [route]);

  // ESC closes drawer
  useEffect(() => {
    const h = (e) => {
      if (e.key === 'Escape' && drawerOpen) setDrawerOpen(false);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [drawerOpen]);

  // Swipe gestures for the left drawer: a right-swipe from anywhere on
  // screen opens it; while open, a left-swipe closes it. We still reject
  // mostly-vertical swipes so list scrolling isn't hijacked.
  useEffect(() => {
    const THRESH = 56;  // min horizontal travel to count as a swipe
    let startX = 0, startY = 0, tracking = false;
    const onStart = (e) => {
      const tch = e.touches[0];
      if (!tch) { tracking = false; return; }
      startX = tch.clientX;
      startY = tch.clientY;
      tracking = true;
    };
    const onEnd = (e) => {
      if (!tracking) return;
      tracking = false;
      const tch = e.changedTouches[0];
      if (!tch) return;
      const dx = tch.clientX - startX;
      const dy = tch.clientY - startY;
      if (Math.abs(dx) < THRESH || Math.abs(dx) <= Math.abs(dy)) return; // not a horizontal swipe
      if (!drawerOpen && dx > 0) setDrawerOpen(true);
      else if (drawerOpen && dx < 0) setDrawerOpen(false);
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchend', onEnd);
    };
  }, [drawerOpen]);

  // auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length, busy]);

  // clipboard paste
  const handlePaste = useCallback((img) => setAttached(img), []);
  usePasteImage(handlePaste, route === 'ai');

  function onPickFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    compressImage(f).then((img) => { if (img) setAttached(img); }).catch(() => {});
    e.target.value = '';
  }

  async function send(slashEntry, fromSlash = false, retry) {
    // Slash menu picked a /nav command → just route there
    if (slashEntry && slashEntry.kind === 'nav') {
      setInput('');
      nav(slashEntry.route);
      return;
    }
    if (slashEntry && slashEntry.kind === 'url') {
      setInput('');
      window.location.assign(slashEntry.url);
      return;
    }
    // Slash menu picked a /prompt command → fill the input, focus, wait for user
    if (slashEntry && slashEntry.kind === 'prompt') {
      setInput(slashEntry.cmd + ' ');
      setTimeout(() => inputRef.current?.focus(), 0);
      return;
    }

    const q = retry ? retry.prompt : input.trim();
    const used = retry ? retry.image : attached;
    if ((!q && !used) || busy) return;

    if (retry) {
      setHistory((h) => ({ ...h, chat: (h.chat || []).filter((x) => !x.error) }));
    } else {
      setInput('');
      setAttached(null);
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

  function clearChat() {
    setHistory((h) => ({ ...h, chat: [] }));
    fetch('/api/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clear: true, threadId: 'agent' }),
    }).catch(() => { /* best-effort */ });
  }

  // ── Render ────────────────────────────────────────────────
  const inChat = route === 'ai';
  const prompts = messages.filter((m) => m.role === 'user').length;

  return (
    <div className="ms-root" style={{
      position: 'fixed', inset: 0,
      display: 'flex', flexDirection: 'column',
      backgroundColor: COLORS.bg, color: COLORS.text,
      fontFamily: MONO,
      overflow: 'hidden',
    }}>
      <style>{MOBILE_CSS}</style>

      <MobileTopBar
        onMenu={() => setDrawerOpen(true)}
        onNewChat={clearChat}
        route={route}
        onBack={() => nav('ai')}
        prompts={prompts}
      />

      {inChat ? (
        <>
          <div ref={scrollRef} className="mobile-chat-scroll" role={messages.length ? 'log' : undefined}
            aria-label={messages.length ? 'Conversation' : undefined}
            style={{
              flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden',
              padding: messages.length ? '18px 18px 24px' : '18px 18px 16px',
              display: 'flex', flexDirection: 'column', gap: 20,
            }}>
            {messages.length === 0 ? (
              <EmptyState
                onSuggest={(v) => { setInput(v); setTimeout(() => inputRef.current?.focus(), 0); }}
                displayName={displayName}
              />
            ) : (
              <>
                <DayDivider label={new Date().toLocaleDateString('en-GB', {
                  weekday: 'short', day: '2-digit', month: 'short',
                }).toUpperCase()} />
                {messages.map((m, i) => <Bubble key={i} msg={m} onRetry={m.error && m.retry ? () => send(undefined, false, m.retry) : null} retryLabel={t('ai.retry')} />)}
                {busy && <TypingBubble hint={busyHint} />}
              </>
            )}
          </div>

          <InputBar
            inputRef={inputRef}
            value={input}
            onChange={setInput}
            onSend={send}
            attached={attached}
            onPickFile={onPickFile}
            onRemoveAttach={() => setAttached(null)}
            busy={busy}
          />
        </>
      ) : (
        <div style={{
          flex: 1, minHeight: 0, overflowY: 'auto',
          padding: '18px 18px 24px',
          paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))',
        }}>
          <Suspense fallback={<RouteFallback />}>
            {route === 'tools'  && <Toolbox nav={nav} />}
            {route === 'stylist'&& <Stylist />}
            {route === 'game'   && <GamePanel />}
            {route === 'tech'   && <TechStackMonitor />}
            {route === 'crypto' && <CryptoWatch />}
            {route === 'todo'   && <TodoList />}
            {route === 'feed'   && (user?.isHistoryOwner ? <Feed /> : <RouteFallback />)}
            {route === 'tv4'    && <TravelV4 />}
          </Suspense>
        </div>
      )}

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        route={route}
        onNav={nav}
      />
    </div>
  );
}

// (formerly MountedInputBar — removed; InputBar now accepts inputRef directly.)
