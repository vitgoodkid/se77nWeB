// MobileShell.jsx — chat-first mobile experience.
// Replaces the desktop chrome (TopBar/NavRail/Breadcrumbs/Footer/ChatFab)
// with a single full-bleed chat surface + slide-in drawer for module nav.
//
// Activated from App.jsx when useMediaQuery('(max-width: 768px)') matches.
// All persistence + auth + i18n hooks come straight from lib.jsx, so the
// shell stays in sync with the desktop build (same /api/agent, same Mongo
// sync, same EN/VI translations, same auth tokens).

import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import {
  COLORS,
  useClock, useGeoDayNight, useLang, useAuth,
  useSyncedData, usePasteImage, compressImage,
  buildChatHistory,
} from './lib.jsx';

const AIPlayground       = lazy(() => import('./featuresA.jsx').then((m) => ({ default: m.AIPlayground })));
const Toolbox            = lazy(() => import('./featuresA.jsx').then((m) => ({ default: m.Toolbox })));
const TravelV4           = lazy(() => import('./tv4/index.jsx').then((m) => ({ default: m.TravelV4 })));
const GamePanel          = lazy(() => import('./featuresA.jsx').then((m) => ({ default: m.GamePanel })));
const TechStackMonitor   = lazy(() => import('./featuresB.jsx').then((m) => ({ default: m.TechStackMonitor })));
const CryptoWatch        = lazy(() => import('./featuresB.jsx').then((m) => ({ default: m.CryptoWatch })));
const TodoList           = lazy(() => import('./featuresB.jsx').then((m) => ({ default: m.TodoList })));
const Feed               = lazy(() => import('./featuresB.jsx').then((m) => ({ default: m.Feed })));

const MODULES = [
  { id: 'ai',     short: '01', accent: COLORS.red,   icon: '✦', i18nLabel: 'nav.ai',     i18nDesc: 'feature.ai.desc' },
  { id: 'tools',  short: '02', accent: COLORS.green, icon: '⚒', i18nLabel: 'nav.tools',  i18nDesc: 'feature.tools.desc' },
  { id: 'tv4',    short: '03', accent: COLORS.gold,  icon: '✈', i18nLabel: 'nav.travel', i18nDesc: 'feature.travel.desc' },
  { id: 'game',   short: '04', accent: COLORS.red,   icon: '◐', i18nLabel: 'nav.game',   i18nDesc: 'feature.game.desc' },
  { id: 'tech',   short: '05', accent: COLORS.green, icon: '⌬', i18nLabel: 'nav.tech',   i18nDesc: 'feature.tech.desc' },
  { id: 'crypto', short: '06', accent: COLORS.gold,  icon: '$', i18nLabel: 'nav.crypto', i18nDesc: 'feature.crypto.desc' },
  { id: 'todo',   short: '07', accent: COLORS.green, icon: '✓', i18nLabel: 'nav.todo',   i18nDesc: 'feature.todo.desc' },
  { id: 'feed',   short: '08', accent: COLORS.gold,  icon: '◧', i18nLabel: 'nav.feed',   i18nDesc: 'feature.feed.desc', ownerOnly: true },
  { id: 'kata',   short: '09', accent: COLORS.red,   icon: '⌨', i18nLabel: 'nav.kata',   i18nDesc: 'feature.kata.desc' },
];

// Slash commands → either prefix the prompt for the chat agent (so the
// router on /api/agent picks the intent) or navigate to a module.
const SLASH_COMMANDS = [
  { cmd: '/chat',      kind: 'prompt', accent: COLORS.text,  desc: 'Free chat' },
  { cmd: '/translate', kind: 'prompt', accent: COLORS.gold,  desc: 'EN ⇄ VI auto-detect' },
  { cmd: '/tldr',      kind: 'prompt', accent: COLORS.text,  desc: 'Summarize long text' },
  { cmd: '/code',      kind: 'prompt', accent: COLORS.green, desc: 'Diagnose & fix' },
  { cmd: '/image',     kind: 'prompt', accent: '#C77BFF',    desc: 'Generate · edit · remove bg' },
  { cmd: '/video',     kind: 'prompt', accent: COLORS.gold,  desc: '5s clip via seedance' },
  // route shortcuts
  { cmd: '/todo',      kind: 'nav', route: 'todo',   accent: COLORS.green, desc: 'Jump · to-do list' },
  { cmd: '/crypto',    kind: 'nav', route: 'crypto', accent: COLORS.gold,  desc: 'Jump · markets' },
  { cmd: '/travel',    kind: 'nav', route: 'tv4',    accent: COLORS.gold,  desc: 'Jump · travel' },
  { cmd: '/tech',      kind: 'nav', route: 'tech',   accent: COLORS.green, desc: 'Jump · tech stack' },
  { cmd: '/tools',     kind: 'nav', route: 'tools',  accent: COLORS.green, desc: 'Jump · toolbox' },
  { cmd: '/feed',      kind: 'nav', route: 'feed',   accent: COLORS.gold,  desc: 'Jump · feed' },
  { cmd: '/game',      kind: 'nav', route: 'game',   accent: COLORS.red,   desc: 'Jump · game' },
  { cmd: '/kata',      kind: 'url', url: '/kata',    accent: COLORS.red,   desc: 'Open · KataS dashboard' },
];

const SUGGESTIONS = [
  { cmd: '/translate', i18nKey: 'mobile.try.translate', fallback: 'translate text' },
  { cmd: '/image',     i18nKey: 'mobile.try.image',     fallback: 'render an image' },
  { cmd: '/tldr',      i18nKey: 'mobile.try.tldr',      fallback: 'summarize an article' },
  { cmd: '/code',      i18nKey: 'mobile.try.code',      fallback: 'debug a snippet' },
];

const INTENT_BADGE = {
  image_gen:  { label: '✨ Image · generated',      color: '#C77BFF' },
  image_edit: { label: '✏ Image · edited',         color: '#C77BFF' },
  bg_remove:  { label: '⊘ Background · removed',   color: '#7ABEFF' },
  video_gen:  { label: '▶ Video · generated',      color: COLORS.gold },
  translate:  { label: '⇄ Translate',              color: COLORS.gold },
  code:       { label: '⌬ Code',                   color: COLORS.green },
  tldr:       { label: '◇ TL;DR',                  color: COLORS.text },
};

// ─────────────────────────────────────────────────────────────
// Top bar — 52px, blur, hamburger · logo · new-chat
// ─────────────────────────────────────────────────────────────
function MobileTopBar({ onMenu, onNewChat, route, onBack }) {
  const inChat = route === 'ai';
  return (
    <header style={{
      flexShrink: 0,
      height: 52,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 14px',
      paddingTop: 'env(safe-area-inset-top, 0px)',
      boxSizing: 'content-box',
      borderBottom: '1px solid ' + COLORS.line,
      background: 'rgba(13,10,8,0.78)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      position: 'sticky', top: 0, zIndex: 30,
    }}>
      <button onClick={onMenu} aria-label="modules"
        style={{
          width: 36, height: 36, borderRadius: 9,
          background: 'transparent', border: '1px solid ' + COLORS.line,
          color: COLORS.text, cursor: 'pointer',
          display: 'grid', placeItems: 'center', padding: 0,
        }}>
        <svg width="14" height="12" viewBox="0 0 14 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <line x1="1" y1="2" x2="13" y2="2" />
          <line x1="1" y1="6" x2="13" y2="6" />
          <line x1="1" y1="10" x2="9"  y2="10" />
        </svg>
      </button>

      <button onClick={onBack} className="mono" aria-label="home"
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: COLORS.text, fontSize: 22, fontWeight: 800,
          letterSpacing: '-0.025em', lineHeight: 1, padding: 0,
        }}>
        se<span style={{
          color: COLORS.red,
          textShadow: `0 0 6px ${COLORS.red}cc, 0 0 16px ${COLORS.red}55`,
        }}>77</span>n
      </button>

      {inChat ? (
        <button onClick={onNewChat} aria-label="new chat" title="new chat"
          style={{
            width: 36, height: 36, borderRadius: 9,
            background: 'transparent', border: '1px solid ' + COLORS.line,
            color: COLORS.muted, cursor: 'pointer',
            display: 'grid', placeItems: 'center', padding: 0,
            fontFamily: 'JetBrains Mono, monospace', fontSize: 18,
          }}>＋</button>
      ) : (
        <button onClick={onBack} aria-label="back to chat" title="back to chat"
          style={{
            width: 36, height: 36, borderRadius: 9,
            background: 'transparent', border: '1px solid ' + COLORS.line,
            color: COLORS.muted, cursor: 'pointer',
            display: 'grid', placeItems: 'center', padding: 0,
            fontFamily: 'JetBrains Mono, monospace', fontSize: 14,
          }}>✕</button>
      )}
    </header>
  );
}

// ─────────────────────────────────────────────────────────────
// Drawer — slides from left
// ─────────────────────────────────────────────────────────────
function Drawer({ open, onClose, route, onNav }) {
  const { t, lang, toggle } = useLang();
  const { status, user, login, logout } = useAuth();
  const [authPanel, setAuthPanel] = useState(false);
  const isOwner = !!user?.isHistoryOwner;
  const visibleModules = MODULES.filter((m) => !m.ownerOnly || isOwner);

  // close auth panel when drawer closes
  useEffect(() => { if (!open) setAuthPanel(false); }, [open]);

  return (
    <>
      <div onClick={onClose} aria-hidden
        style={{
          position: 'fixed', inset: 0, zIndex: 80,
          background: open ? 'rgba(0,0,0,0.55)' : 'transparent',
          pointerEvents: open ? 'auto' : 'none',
          transition: 'background 220ms ease',
        }} />

      <aside style={{
        position: 'fixed', top: 0, bottom: 0, left: 0, zIndex: 90,
        width: 296, maxWidth: '84%',
        background: COLORS.bg,
        borderRight: '1px solid ' + COLORS.line,
        transform: open ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform 280ms cubic-bezier(0.22,1,0.36,1)',
        display: 'flex', flexDirection: 'column',
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        boxShadow: open ? '24px 0 60px -20px rgba(0,0,0,0.6)' : 'none',
      }}>
        {/* header */}
        <div style={{
          padding: '18px 20px 16px',
          borderBottom: '1px solid ' + COLORS.line,
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10,
        }}>
          <div>
            <div className="mono" style={{
              fontSize: 28, fontWeight: 800, letterSpacing: '-0.025em', lineHeight: 0.95,
              color: COLORS.text,
            }}>
              se<span style={{
                color: COLORS.red,
                textShadow: `0 0 6px ${COLORS.red}cc, 0 0 18px ${COLORS.red}55`,
              }}>77</span>n
            </div>
            <div className="mono" style={{
              marginTop: 6, fontSize: 8.5, letterSpacing: '0.22em', color: COLORS.muted,
              textTransform: 'uppercase',
            }}>
              {t('topbar.experiment')}&nbsp;<span style={{ color: COLORS.red, fontWeight: 700 }}>007</span> · Mobile
            </div>
          </div>
          <button onClick={onClose} aria-label="close"
            style={{
              width: 30, height: 30, borderRadius: 8,
              background: 'transparent', border: '1px solid ' + COLORS.line,
              color: COLORS.muted, cursor: 'pointer',
              display: 'grid', placeItems: 'center', padding: 0,
              fontFamily: 'JetBrains Mono, monospace', fontSize: 12,
            }}>✕</button>
        </div>

        {/* modules */}
        <nav style={{ flex: 1, overflowY: 'auto', padding: '10px 10px 8px' }}>
          <div className="mono" style={{
            fontSize: 8.5, letterSpacing: '0.24em', color: COLORS.muted,
            padding: '6px 10px 8px', textTransform: 'uppercase',
          }}>{t('home.modules')}</div>
          {visibleModules.map((m) => {
            const active = m.id === route;
            const handleClick = () => {
              if (m.id === 'kata') { window.open('/kata', '_blank', 'noopener'); onClose(); return; }
              onNav(m.id);
              onClose();
            };
            return (
              <button key={m.id} onClick={handleClick}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 10px', borderRadius: 10,
                  background: active ? m.accent + '14' : 'transparent',
                  border: '1px solid ' + (active ? m.accent + '40' : 'transparent'),
                  color: COLORS.text, cursor: 'pointer',
                  textAlign: 'left', position: 'relative',
                  fontFamily: 'inherit',
                }}>
                <span style={{
                  width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                  background: m.accent + (active ? '24' : '10'),
                  border: `1px solid ${m.accent}${active ? '60' : '30'}`,
                  color: m.accent,
                  display: 'grid', placeItems: 'center',
                  fontFamily: 'JetBrains Mono, monospace', fontSize: 17, fontWeight: 700,
                }}>{m.icon}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="mono" style={{
                    display: 'block', fontSize: 13, fontWeight: 700, letterSpacing: '-0.005em',
                    color: COLORS.text,
                  }}>{t(m.i18nLabel)}</span>
                  <span style={{
                    display: 'block', fontSize: 10.5, color: COLORS.muted, marginTop: 2, lineHeight: 1.35,
                  }}>{t(m.i18nDesc)}</span>
                </span>
                <span className="mono" style={{
                  fontSize: 9, letterSpacing: '0.16em', color: m.accent,
                  padding: '3px 6px', borderRadius: 999,
                  background: m.accent + '14', border: `1px solid ${m.accent}30`,
                }}>{m.short}</span>
              </button>
            );
          })}
        </nav>

        {/* footer · auth + lang */}
        <div style={{
          padding: '12px 14px 18px',
          borderTop: '1px solid ' + COLORS.line,
        }}>
          {!authPanel ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <button onClick={() => setAuthPanel(true)}
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', gap: 10,
                  padding: '6px 8px 6px 4px', borderRadius: 10,
                  background: 'transparent', border: '1px solid transparent',
                  color: COLORS.text, cursor: 'pointer', textAlign: 'left',
                  fontFamily: 'inherit',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                {status === 'authed' && user?.avatarUrl ? (
                  <img src={user.avatarUrl} alt="" style={{
                    width: 30, height: 30, borderRadius: 999, objectFit: 'cover',
                    border: '1px solid ' + COLORS.line,
                  }} />
                ) : (
                  <span style={{
                    width: 30, height: 30, borderRadius: 999,
                    background: COLORS.red + '22', color: COLORS.red,
                    display: 'grid', placeItems: 'center',
                    fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 800,
                  }}>{((user?.displayName || user?.username || 'g').slice(0, 1)).toUpperCase()}</span>
                )}
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span className="mono" style={{
                    display: 'block', fontSize: 12, color: COLORS.text, fontWeight: 700,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{status === 'authed' ? (user?.displayName || user?.username || '—') : t('auth.guest')}</span>
                  <span className="mono" style={{
                    display: 'block', fontSize: 8.5, color: COLORS.muted, letterSpacing: '0.14em',
                    marginTop: 1,
                  }}>{status === 'authed' ? t('auth.signedInAs').toUpperCase() : t('auth.signIn').toUpperCase() + ' ↗'}</span>
                </span>
              </button>

              <button onClick={toggle} className="mono"
                title={t('topbar.toggleLang')} aria-label={t('topbar.toggleLang')}
                style={{
                  display: 'flex', alignItems: 'center', gap: 0,
                  padding: 3, borderRadius: 999,
                  background: 'transparent',
                  border: '1px solid ' + COLORS.line,
                  color: COLORS.text, cursor: 'pointer',
                  fontSize: 9.5, letterSpacing: '0.14em', fontWeight: 700,
                  height: 28,
                }}>
                <span style={{
                  padding: '3px 7px', borderRadius: 999,
                  background: lang === 'en' ? COLORS.text + '12' : 'transparent',
                  color: lang === 'en' ? COLORS.text : COLORS.muted,
                }}>EN</span>
                <span style={{
                  padding: '3px 7px', borderRadius: 999,
                  background: lang === 'vi' ? COLORS.text + '12' : 'transparent',
                  color: lang === 'vi' ? COLORS.text : COLORS.muted,
                }}>VI</span>
              </button>
            </div>
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

function AuthPanel({ status, user, login, logout, onBack }) {
  const { t } = useLang();
  return (
    <div style={{ animation: 'fadeUp 180ms ease-out' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8,
      }}>
        <div className="mono" style={{
          fontSize: 9, letterSpacing: '0.2em', color: COLORS.muted,
        }}>
          {status === 'authed'
            ? t('auth.signedInAs').toUpperCase() + ' · ' + (user?.provider?.toUpperCase() || '—')
            : t('auth.signInTitle').toUpperCase()}
        </div>
        <button onClick={onBack} aria-label="back"
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: COLORS.muted, fontSize: 12, padding: 4,
            fontFamily: 'JetBrains Mono, monospace',
          }}>✕</button>
      </div>

      {status === 'authed' ? (
        <>
          <div style={{
            padding: '8px 4px 12px', fontSize: 12, color: COLORS.text,
          }}>
            <div className="mono" style={{ fontWeight: 700 }}>{user?.displayName || '—'}</div>
            {user?.email && (
              <div className="mono" style={{ fontSize: 10, color: COLORS.muted, marginTop: 2 }}>
                {user.email}
              </div>
            )}
          </div>
          <button onClick={logout} className="mono"
            style={{
              width: '100%', padding: '9px 10px', borderRadius: 8,
              background: 'transparent', border: '1px solid ' + COLORS.line,
              color: COLORS.text, cursor: 'pointer',
              fontSize: 11, letterSpacing: '0.08em', textAlign: 'left',
            }}>↩ {t('auth.logout')}</button>
        </>
      ) : (
        <>
          <div style={{ padding: '0 4px 10px', fontSize: 11, color: COLORS.muted, lineHeight: 1.5 }}>
            {t('auth.signInDesc')}
          </div>
          <ProviderBtn provider="discord" color="#5865F2" label={t('auth.discord')} onClick={() => login('discord')} />
          <div style={{ height: 6 }} />
          <ProviderBtn provider="google"  color="#EA4335" label={t('auth.google')}  onClick={() => login('google')} />
        </>
      )}
    </div>
  );
}

function ProviderBtn({ provider, color, label, onClick }) {
  return (
    <button onClick={onClick} className="mono"
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 10,
        padding: '9px 10px', borderRadius: 8,
        background: color + '14', border: `1px solid ${color}50`,
        color: COLORS.text, cursor: 'pointer',
        fontSize: 11.5, letterSpacing: '0.04em', fontWeight: 600,
      }}>
      {provider === 'discord' ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill={color}>
          <path d="M20.317 4.37a19.79 19.79 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.74 19.74 0 003.677 4.37a.07.07 0 00-.032.028C.533 9.046-.32 13.58.099 18.058a.082.082 0 00.031.056 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.873-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.1 13.1 0 01-1.872-.892.077.077 0 01-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 01.078-.01c3.928 1.793 8.18 1.793 12.061 0a.074.074 0 01.079.01c.12.099.246.197.373.291a.077.077 0 01-.006.128 12.3 12.3 0 01-1.873.891.076.076 0 00-.04.107c.36.698.772 1.363 1.225 1.993a.076.076 0 00.084.028 19.84 19.84 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.029zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24">
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
  const accent = isDay ? COLORS.gold : '#9bb4ff';
  const tStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const tzShort = (geo.tz || '').split('/').pop()?.replace(/_/g, ' ') || '—';
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <span style={{
          width: 22, height: 22, borderRadius: 999,
          background: accent + '22', border: `1px solid ${accent}40`,
          display: 'grid', placeItems: 'center', color: accent, fontSize: 11,
        }}>{isDay ? '☼' : '☾'}</span>
        <span className="mono" style={{
          fontSize: 9, letterSpacing: '0.22em', color: COLORS.muted,
        }}>{isDay ? 'DAYLIGHT' : 'NIGHTSHIFT'} · {tStr} · {geo.city || tzShort}</span>
      </div>
      <h1 style={{
        margin: 0, fontSize: 30, fontWeight: 700, letterSpacing: '-0.02em',
        lineHeight: 1.1, color: COLORS.text,
        fontFamily: "'Geist', system-ui, sans-serif",
      }}>
        {t('mobile.greeting.' + phase)},<br/>
        <span className="mono" style={{
          color: COLORS.red, fontWeight: 800, letterSpacing: '-0.025em',
          textShadow: `0 0 12px ${COLORS.red}55`,
        }}>{name}</span><span style={{
          display: 'inline-block', width: 8, height: 22, marginLeft: 6, verticalAlign: '-2px',
          background: COLORS.red, animation: 'blink 1s steps(1) infinite',
        }} />
      </h1>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Empty state — hero + try-this suggestion cards
// ─────────────────────────────────────────────────────────────
function EmptyState({ onSuggest, displayName }) {
  const { t } = useLang();
  return (
    <div style={{ marginTop: 8, animation: 'fadeUp 320ms ease-out' }}>
      <div className="mono" style={{
        fontSize: 8.5, letterSpacing: '0.24em', color: COLORS.red, fontWeight: 700, marginBottom: 10,
      }}>● ONLINE · EXP 007</div>

      <HeroGreeting name={displayName} />

      <p style={{
        margin: '14px 0 0', maxWidth: 320,
        fontSize: 13.5, color: COLORS.muted, lineHeight: 1.55,
      }}>
        {t('mobile.heroHelp')} <span className="mono" style={{
          color: COLORS.text, background: COLORS.panel, padding: '1px 5px',
          borderRadius: 4, border: '1px solid ' + COLORS.line, fontSize: 12,
        }}>/</span> {t('mobile.heroHelpTail')}
      </p>

      <div style={{ marginTop: 22 }}>
        <div className="mono" style={{
          fontSize: 8.5, letterSpacing: '0.24em', color: COLORS.muted, marginBottom: 8,
        }}>TRY ·</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {SUGGESTIONS.map(s => (
            <button key={s.cmd} onClick={() => onSuggest(s.cmd + ' ')}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '11px 14px', borderRadius: 10,
                background: COLORS.panel, border: '1px solid ' + COLORS.line,
                color: COLORS.text, cursor: 'pointer', textAlign: 'left',
                fontFamily: 'inherit',
              }}>
              <span className="mono" style={{
                fontSize: 11, fontWeight: 700, color: COLORS.red,
              }}>{s.cmd}</span>
              <span style={{ fontSize: 12.5, color: COLORS.muted }}>{t(s.i18nKey)}</span>
              <span style={{ flex: 1 }} />
              <span style={{ color: 'rgba(245,237,224,0.3)', fontSize: 13 }}>↗</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Chat bubbles
// ─────────────────────────────────────────────────────────────
function DayDivider({ label }) {
  return (
    <div className="mono" style={{
      display: 'flex', alignItems: 'center', gap: 10,
      fontSize: 8.5, letterSpacing: '0.24em', color: COLORS.muted,
      padding: '4px 4px 8px',
    }}>
      <span style={{ flex: 1, height: 1, background: COLORS.line }} />
      <span>{label}</span>
      <span style={{ flex: 1, height: 1, background: COLORS.line }} />
    </div>
  );
}

function Bubble({ msg, onRetry, retryLabel }) {
  const isUser = msg.role === 'user';
  const badge = !isUser && msg.intent ? INTENT_BADGE[msg.intent] : null;
  const mono = isUser && typeof msg.content === 'string' && msg.content.startsWith('/');

  if (isUser) {
    return (
      <div style={{
        alignSelf: 'flex-end', maxWidth: '85%',
        padding: '9px 13px', borderRadius: 12,
        background: COLORS.red + '14', border: `1px solid ${COLORS.red}40`,
        color: COLORS.text, fontSize: 13.5, lineHeight: 1.5,
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        fontFamily: mono ? "'JetBrains Mono', monospace" : "inherit",
        animation: 'fadeUp 200ms ease-out',
      }}>
        {msg.image && (
          <img src={msg.image} alt="" style={{
            display: 'block', maxWidth: '100%', borderRadius: 6,
            marginBottom: msg.content && msg.content !== '(image)' ? 6 : 0,
            border: '1px solid ' + COLORS.line,
          }} />
        )}
        {msg.content && msg.content !== '(image)' && msg.content}
      </div>
    );
  }

  return (
    <div style={{
      alignSelf: 'flex-start', maxWidth: '92%',
      padding: '11px 13px 12px', borderRadius: 12,
      background: COLORS.panel, border: '1px solid ' + COLORS.line,
      color: COLORS.text, fontSize: 13.5, lineHeight: 1.55,
      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      animation: 'fadeUp 200ms ease-out',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap',
      }}>
        <span className="mono" style={{
          fontSize: 8.5, letterSpacing: '0.22em', color: COLORS.red, fontWeight: 700,
        }}>se77n ::</span>
        {badge && (
          <span className="mono" style={{
            fontSize: 8.5, letterSpacing: '0.16em', fontWeight: 700,
            padding: '2px 7px', borderRadius: 4,
            background: badge.color + '1a', color: badge.color,
            border: `1px solid ${badge.color}40`,
          }}>{badge.label}</span>
        )}
      </div>
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
      {msg.content}
      {onRetry && (
        <div style={{ marginTop: 8 }}>
          <button onClick={onRetry} className="mono" style={{
            fontSize: 10, letterSpacing: '0.15em', padding: '5px 12px', borderRadius: 999,
            background: 'transparent', border: `1px solid ${COLORS.red}66`, color: COLORS.red, cursor: 'pointer',
          }}>↻ {retryLabel}</button>
        </div>
      )}
    </div>
  );
}

function TypingBubble({ hint }) {
  return (
    <div style={{
      alignSelf: 'flex-start', maxWidth: '92%',
      padding: '11px 13px 12px', borderRadius: 12,
      background: COLORS.panel, border: '1px solid ' + COLORS.line,
      animation: 'fadeUp 200ms ease-out',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6,
      }}>
        <span className="mono" style={{
          fontSize: 8.5, letterSpacing: '0.22em', color: COLORS.red, fontWeight: 700,
        }}>se77n ::</span>
        <span className="mono" style={{
          fontSize: 8.5, letterSpacing: '0.16em', fontWeight: 700,
          padding: '2px 7px', borderRadius: 4,
          background: COLORS.gold + '1a', color: COLORS.gold,
          border: `1px solid ${COLORS.gold}40`,
        }}>◌ rendering</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
          {[0, 1, 2].map((i) => (
            <span key={i} style={{
              width: 6, height: 6, borderRadius: 999, background: COLORS.text,
              animation: `pulse 1s ease-in-out ${i * 0.15}s infinite`,
            }} />
          ))}
        </span>
        {hint && (
          <span className="mono" style={{ fontSize: 11, color: COLORS.muted, letterSpacing: '0.04em' }}>
            {hint}
          </span>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Slash menu — popover above input
// ─────────────────────────────────────────────────────────────
function SlashMenu({ query, onPick }) {
  const q = query.toLowerCase();
  const list = SLASH_COMMANDS.filter(c => c.cmd.startsWith(q) || c.desc.toLowerCase().includes(q.slice(1)));
  const items = (list.length ? list : SLASH_COMMANDS).slice(0, 6);
  return (
    <div style={{
      position: 'absolute', left: 12, right: 12, bottom: 'calc(100% + 8px)',
      background: COLORS.panel, border: '1px solid ' + COLORS.line,
      borderRadius: 12, overflow: 'hidden',
      boxShadow: '0 24px 60px -20px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04)',
      animation: 'fadeUp 160ms ease-out', zIndex: 20,
    }}>
      <div className="mono" style={{
        padding: '8px 12px', fontSize: 8.5, letterSpacing: '0.22em',
        color: COLORS.muted, borderBottom: '1px solid ' + COLORS.line,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span>SLASH · {items.length} matches</span>
        <span style={{ color: 'rgba(245,237,224,0.3)' }}>↵</span>
      </div>
      <div style={{ maxHeight: 280, overflowY: 'auto' }}>
        {items.map((c, i) => (
          <button key={c.cmd} onClick={() => onPick(c)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 10,
              padding: '9px 12px',
              background: i === 0 ? c.accent + '0e' : 'transparent',
              border: 'none', borderBottom: i < items.length - 1 ? '1px solid ' + COLORS.line : 'none',
              color: COLORS.text, cursor: 'pointer', textAlign: 'left',
              fontFamily: 'inherit',
            }}>
            <span className="mono" style={{
              fontSize: 11.5, fontWeight: 700, color: c.accent, minWidth: 76,
            }}>{c.cmd}</span>
            <span style={{ fontSize: 11.5, color: COLORS.muted, flex: 1 }}>{c.desc}</span>
            {c.kind === 'nav' && (
              <span className="mono" style={{
                fontSize: 8.5, color: c.accent, letterSpacing: '0.14em',
              }}>NAV</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Input bar — sticky bottom
// ─────────────────────────────────────────────────────────────
function InputBar({ inputRef, value, onChange, onSend, attached, onPickFile, onRemoveAttach, busy }) {
  const hasContent = value.trim().length > 0 || !!attached;
  const slashOpen = value.startsWith('/') && !busy;

  return (
    <div style={{
      position: 'relative', flexShrink: 0,
      borderTop: '1px solid ' + COLORS.line,
      background: 'rgba(13,10,8,0.92)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      padding: '10px 12px 10px',
      paddingBottom: 'calc(10px + env(safe-area-inset-bottom, 0px))',
    }}>
      {slashOpen && <SlashMenu query={value.split(/\s/)[0]} onPick={(c) => onSend(c, true)} />}

      {attached && (
        <div style={{
          marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10,
          padding: '6px 10px 6px 6px', borderRadius: 10,
          background: COLORS.bg, border: '1px solid ' + COLORS.red + '40',
        }}>
          <img src={attached.dataUrl} alt="" style={{
            width: 36, height: 36, borderRadius: 6, objectFit: 'cover',
            border: '1px solid ' + COLORS.red + '40',
          }} />
          <span className="mono" style={{
            fontSize: 10.5, color: COLORS.text, flex: 1,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{attached.name}</span>
          <button onClick={onRemoveAttach} aria-label="remove"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: COLORS.muted, fontSize: 13, padding: 4,
            }}>✕</button>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
        <label title="attach image"
          style={{
            width: 38, height: 38, borderRadius: 10, flexShrink: 0,
            background: attached ? COLORS.red + '14' : 'transparent',
            border: `1px solid ${attached ? COLORS.red + '55' : COLORS.line}`,
            color: attached ? COLORS.red : COLORS.muted, cursor: 'pointer',
            display: 'grid', placeItems: 'center',
          }}>
          <input type="file" accept="image/*" onChange={onPickFile}
            style={{ display: 'none' }} />
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
          </svg>
        </label>

        <div style={{
          flex: 1, minWidth: 0,
          background: COLORS.bg, border: '1px solid ' + (slashOpen ? COLORS.red + '60' : COLORS.line),
          borderRadius: 10,
          transition: 'border-color 120ms, box-shadow 120ms',
          boxShadow: slashOpen ? `0 0 0 3px ${COLORS.red}18` : 'none',
        }}>
          <textarea
            ref={inputRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="ask se77n…"
            rows={1}
            disabled={busy}
            style={{
              width: '100%', resize: 'none', outline: 'none', border: 'none',
              background: 'transparent', color: COLORS.text,
              padding: '10px 12px', fontSize: 14, lineHeight: 1.4,
              fontFamily: value.startsWith('/') ? "'JetBrains Mono', monospace" : "inherit",
              maxHeight: 100,
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); }
            }}
          />
        </div>

        <button onClick={() => onSend()} disabled={!hasContent || busy} aria-label="send"
          style={{
            width: 38, height: 38, borderRadius: 10, flexShrink: 0,
            background: hasContent && !busy ? COLORS.red : 'transparent',
            border: `1px solid ${hasContent && !busy ? COLORS.red : COLORS.line}`,
            color: hasContent && !busy ? '#0d0a08' : COLORS.muted,
            cursor: hasContent && !busy ? 'pointer' : 'not-allowed',
            display: 'grid', placeItems: 'center', padding: 0,
            boxShadow: hasContent && !busy ? `0 6px 16px -6px ${COLORS.red}99` : 'none',
            transition: 'all 140ms',
          }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="19" x2="19" y2="5"/>
            <polyline points="9 5 19 5 19 15"/>
          </svg>
        </button>
      </div>

      <div className="mono" style={{
        marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontSize: 8, letterSpacing: '0.22em', color: 'rgba(245,237,224,0.3)',
      }}>
        <span>se77n · gemini 3.1 via yunwu</span>
        <span style={{ color: COLORS.muted }}>/ for intents</span>
      </div>
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
// MobileShell — the export App.jsx renders when isMobile
// ─────────────────────────────────────────────────────────────
export default function MobileShell() {
  const { t } = useLang();
  const { user } = useAuth();
  const displayName = (user?.displayName || user?.username || 'zzzzz').toLowerCase();

  const [route, setRoute] = useState(() => {
    const h = (typeof window !== 'undefined' ? window.location.hash : '').replace(/^#\//, '').split('/')[0];
    return ['ai', 'tools', 'tv4', 'game', 'tech', 'crypto', 'todo', 'feed'].includes(h) ? h : 'ai';
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
      const next = ['ai', 'tools', 'tv4', 'game', 'tech', 'crypto', 'todo', 'feed'].includes(h) ? h : 'ai';
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
      window.open(slashEntry.url, '_blank', 'noopener');
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

  return (
    <div style={{
      position: 'fixed', inset: 0,
      display: 'flex', flexDirection: 'column',
      background: COLORS.bg, color: COLORS.text,
      fontFamily: "'Geist', system-ui, sans-serif",
      overflow: 'hidden',
    }}>
      <MobileTopBar
        onMenu={() => setDrawerOpen(true)}
        onNewChat={clearChat}
        route={route}
        onBack={() => nav('ai')}
      />

      {inChat ? (
        <>
          <div ref={scrollRef} className="mobile-chat-scroll" style={{
            flex: 1, overflowY: 'auto',
            padding: messages.length ? '18px 14px 8px' : '24px 18px 8px',
            display: 'flex', flexDirection: 'column', gap: 12,
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
          flex: 1, overflowY: 'auto',
          padding: '12px 16px 20px',
          paddingBottom: 'calc(20px + env(safe-area-inset-bottom, 0px))',
        }}>
          <Suspense fallback={<RouteFallback />}>
            {route === 'tools'  && <Toolbox />}
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

