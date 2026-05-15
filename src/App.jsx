import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { useCallback } from 'react';
import {
  COLORS, SOCIALS,
  Btn, Kicker,
  GlyphSun, GlyphMoon, GlobeIcon, ControllerIcon,
  PaperclipIcon, ChatBubbleIcon,
  useClock, useGeoDayNight, useAmbient, useLanyard,
  usePersisted, usePasteImage, resolveAssetUrl,
} from './lib.jsx';

const AIPlayground       = lazy(() => import('./featuresA.jsx').then((m) => ({ default: m.AIPlayground })));
const Toolbox            = lazy(() => import('./featuresA.jsx').then((m) => ({ default: m.Toolbox })));
const TravelArchive      = lazy(() => import('./featuresA.jsx').then((m) => ({ default: m.TravelArchive })));
const GamePanel          = lazy(() => import('./featuresA.jsx').then((m) => ({ default: m.GamePanel })));
const TechStackMonitor   = lazy(() => import('./featuresB.jsx').then((m) => ({ default: m.TechStackMonitor })));
const CryptoWatch        = lazy(() => import('./featuresB.jsx').then((m) => ({ default: m.CryptoWatch })));
const DigitalVault       = lazy(() => import('./featuresB.jsx').then((m) => ({ default: m.DigitalVault })));
const TodoList           = lazy(() => import('./featuresB.jsx').then((m) => ({ default: m.TodoList })));

const FEATURES = [
  { id: 'home',   label: 'Home',                icon: '⌂',   accent: COLORS.text,  short: '00' },
  { id: 'ai',     label: 'AI Playground',       icon: '✦',   accent: COLORS.red,   short: '01', desc: 'Chat · image · video' },
  { id: 'tools',  label: 'Toolbox',             icon: '⚒',   accent: COLORS.green, short: '02', desc: 'Public + private utilities' },
  { id: 'travel', label: 'Travel Archive',      icon: (c) => <GlobeIcon color={c} size={20} />, accent: COLORS.gold,  short: '03', desc: 'World map · 16 cities' },
  { id: 'game',   label: 'Game',                icon: (c) => <ControllerIcon color={c} size={22} />, accent: COLORS.red,   short: '04', desc: 'Coming soon' },
  { id: 'tech',   label: 'Tech Stack Monitor',  icon: '⌬',   accent: COLORS.green, short: '05', desc: '11 services · monthly burn' },
  { id: 'crypto', label: 'Crypto Watch',        icon: '$',   accent: COLORS.gold,  short: '06', desc: 'BTC · GOLD · TWD ⇄ VND' },
  { id: 'vault',  label: 'Digital Vault',       icon: '⌘',   accent: COLORS.red,   short: '07', desc: 'Credentials manager' },
  { id: 'todo',   label: 'To-Do List',          icon: '✓',   accent: COLORS.green, short: '08', desc: 'Priorities · localStorage' },
];

const EXPERIMENT_NUMBER = '007';

export default function App() {
  const ambientOn = true;
  const showBg = true;

  const [route, setRoute] = useState(() => {
    const h = window.location.hash.replace(/^#\//, '');
    return FEATURES.find((f) => f.id === h) ? h : 'home';
  });
  const [transitioning, setTransitioning] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  const lanyard = useLanyard();
  const ambient = useAmbient(ambientOn, lanyard.data);
  const geo = useGeoDayNight();
  const now = useClock();

  const phase = geo.phase;

  function nav(to) {
    if (to === route) return;
    setTransitioning(true);
    setTimeout(() => {
      setRoute(to);
      window.history.replaceState(null, '', '#/' + to);
      setTimeout(() => setTransitioning(false), 360);
    }, 220);
  }

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
      const id = window.location.hash.replace(/^#\//, '') || 'home';
      if (FEATURES.find((f) => f.id === id) && id !== route) setRoute(id);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [route]);

  const activeFeature = FEATURES.find((f) => f.id === route);

  return (
    <div style={{
      minHeight: '100vh', background: COLORS.bg, color: COLORS.text,
      position: 'relative', overflow: 'hidden',
    }}>
      {showBg && <AmbientBackground phase={phase} enabled={ambientOn} track={ambient.track} />}

      <TopBar phase={phase} now={now} geo={geo} route={route} nav={nav} ambient={ambient} ambientOn={ambientOn} />
      <NavRail route={route} nav={nav} />

      <main style={{
        position: 'relative', marginLeft: 84,
        padding: '24px 32px 32px',
        minHeight: 'calc(100vh - 64px)', marginTop: 64,
      }}>
        <Breadcrumbs route={route} nav={nav} feature={activeFeature} />
        <div style={{ position: 'relative', minHeight: 'calc(100vh - 200px)' }}>
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
              {route === 'tools'  && <Toolbox />}
              {route === 'travel' && <TravelArchive />}
              {route === 'game'   && <GamePanel />}
              {route === 'tech'   && <TechStackMonitor />}
              {route === 'crypto' && <CryptoWatch />}
              {route === 'vault'  && <DigitalVault />}
              {route === 'todo'   && <TodoList />}
            </Suspense>
          </div>
        </div>

        <footer style={{
          marginTop: 40, paddingTop: 20,
          borderTop: '1px solid ' + COLORS.line,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontSize: 10, color: COLORS.muted, letterSpacing: '0.18em',
        }} className="mono">
          <span>SE77N · {now.getFullYear()} · EXP {EXPERIMENT_NUMBER}</span>
          <span>BUILD · {now.toISOString().slice(0, 10).replaceAll('-', '.')}</span>
          <span style={{ color: phase === 'day' ? COLORS.gold : '#9bb4ff' }}>
            {phase === 'day' ? '◐ DAYLIGHT' : '◑ NIGHTSHIFT'}
          </span>
        </footer>
      </main>

      <ChatFab open={chatOpen}
        onOpen={() => setChatOpen(true)}
        onClose={() => setChatOpen(false)}
        ambient={ambient} nav={nav} />
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
  const tStr = now.toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
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
          Experiment&nbsp;<span style={{
            color: COLORS.red, fontWeight: 700,
            textShadow: `0 0 4px ${COLORS.red}aa, 0 0 10px ${COLORS.red}55`,
          }}>{EXPERIMENT_NUMBER}</span> / Desktop
        </div>
      </button>

      <NowPlaying ambient={ambient} on={ambientOn} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <DayNightChip phase={phase} city={geo.city} />
        <div style={{ width: 1, height: 24, background: COLORS.line }} />
        <div className="mono" style={{
          fontSize: 13, fontWeight: 700, letterSpacing: '0.05em', color: COLORS.text,
          minWidth: 76, textAlign: 'right',
        }}>{tStr}</div>
      </div>
    </header>
  );
}

function DayNightChip({ phase, city }) {
  const day = phase === 'day';
  const color = day ? COLORS.gold : '#9bb4ff';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '6px 12px 6px 8px', borderRadius: 999,
      background: color + '12', border: `1px solid ${color}40`,
    }}>
      <span style={{
        width: 22, height: 22, borderRadius: 999, display: 'grid', placeItems: 'center',
        background: color + '22',
      }}>
        {day ? <GlyphSun color={color} size={14} /> : <GlyphMoon color={color} size={14} />}
      </span>
      <div style={{ textAlign: 'left' }}>
        <div className="mono" style={{ fontSize: 9, letterSpacing: '0.16em', color, fontWeight: 700 }}>
          {day ? 'DAY' : 'NIGHT'}
        </div>
        <div className="mono" style={{ fontSize: 9, color: COLORS.muted, letterSpacing: '0.06em', marginTop: 2 }}>
          {city || '—'}
        </div>
      </div>
    </div>
  );
}

function NowPlaying({ ambient, on }) {
  const { track, playing, setPlaying, next, prev, isLive, game } = ambient;
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
      {isLive ? (
        <span className="mono" title="Live from Discord · Spotify"
          style={{
            fontSize: 8, letterSpacing: '0.18em', fontWeight: 700,
            padding: '4px 8px', borderRadius: 999,
            background: '#1DB95418', border: '1px solid #1DB95455', color: '#1DB954',
          }}>● LIVE</span>
      ) : (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <PlayerBtn onClick={prev}>◀</PlayerBtn>
          <PlayerBtn onClick={() => setPlaying((p) => !p)} primary>
            {playing ? '❚❚' : '▶'}
          </PlayerBtn>
          <PlayerBtn onClick={next}>▶</PlayerBtn>
        </div>
      )}
    </div>
  );
}

function GameChip({ game }) {
  const art = resolveAssetUrl(game, 'large_image');
  return (
    <div title={[game.name, game.details, game.state].filter(Boolean).join(' · ')}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '4px 10px 4px 4px', borderRadius: 999,
        background: COLORS.red + '12',
        border: '1px solid ' + COLORS.red + '40',
        maxWidth: 200, flexShrink: 0,
      }}>
      <span style={{
        width: 22, height: 22, borderRadius: 6, flexShrink: 0,
        background: art ? `url(${art}) center/cover no-repeat` : COLORS.red + '40',
        display: 'grid', placeItems: 'center',
      }}>
        {!art && <span className="mono" style={{ fontSize: 10, color: COLORS.red, fontWeight: 800 }}>◐</span>}
      </span>
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

function PlayerBtn({ children, onClick, primary }) {
  return (
    <button onClick={onClick} style={{
      width: 26, height: 26, borderRadius: 999,
      background: primary ? COLORS.text : 'transparent',
      border: `1px solid ${primary ? COLORS.text : COLORS.line}`,
      color: primary ? '#0d0a08' : COLORS.muted,
      cursor: 'pointer', fontSize: 9,
      display: 'grid', placeItems: 'center',
    }}>{children}</button>
  );
}

// ─────────────────────────────────────────────────────────────
// Nav rail
// ─────────────────────────────────────────────────────────────
function NavRail({ route, nav }) {
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
      {FEATURES.map((f) => {
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
              {typeof f.icon === 'function' ? f.icon(active ? f.accent : COLORS.muted) : f.icon}
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
    </aside>
  );
}

// ─────────────────────────────────────────────────────────────
// Breadcrumbs
// ─────────────────────────────────────────────────────────────
function Breadcrumbs({ route, nav, feature }) {
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
              {feature?.label.toUpperCase()}
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
        }}>← ESC · HOME</button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Home view
// ─────────────────────────────────────────────────────────────
const VERBS = ['ask', 'think', 'ship', 'archive'];

function HomeView({ nav, ambient, ambientOn }) {
  const [verb, setVerb] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setVerb((v) => (v + 1) % VERBS.length), 1800);
    return () => clearInterval(id);
  }, []);

  return (
    <div>
      <section style={{ marginBottom: 36 }}>
        <Kicker style={{ marginBottom: 14, color: COLORS.red }}>● ONLINE · EXP {EXPERIMENT_NUMBER}</Kicker>
        <h1 style={{
          margin: 0,
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 78, lineHeight: 1.02, fontWeight: 800, letterSpacing: '-0.03em',
        }}>
          <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 26, flexWrap: 'wrap' }}>
            {VERBS.map((v, i) => (
              <span key={v} style={{
                opacity: verb === i ? 1 : 0.18,
                color: verb === i ? COLORS.text : COLORS.muted,
                transition: 'opacity 300ms, color 300ms',
                position: 'relative',
              }}>
                {v}
                {verb === i && (
                  <span style={{
                    display: 'inline-block', width: 14, height: 56,
                    marginLeft: 8, verticalAlign: '-4px',
                    background: COLORS.red,
                    boxShadow: `0 0 18px ${COLORS.red}66`,
                    animation: 'blink 1s steps(1) infinite',
                  }} />
                )}
              </span>
            ))}
          </span>
        </h1>
        <p style={{
          margin: '20px 0 0', maxWidth: 720,
          fontSize: 16, color: COLORS.muted, lineHeight: 1.6,
        }}>
          A personal control surface — eight modules wired to one prompt.
          AI, finance, travel, vault, and tools, woven into a single command center.
        </p>
        <div style={{ marginTop: 26, display: 'flex', gap: 10 }}>
          <Btn variant="solid" color={COLORS.red} onClick={() => nav('ai')}>↗ Open AI Playground</Btn>
          <Btn variant="ghost" onClick={() => nav('crypto')}>$ Markets</Btn>
          <Btn variant="ghost" onClick={() => nav('todo')}>✓ To-Do</Btn>
        </div>
      </section>

      <section style={{ marginBottom: 28 }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
          marginBottom: 18,
        }}>
          <div>
            <Kicker>MODULES · 08</Kicker>
            <div className="mono" style={{ fontSize: 20, fontWeight: 700, marginTop: 6, letterSpacing: '-0.01em' }}>
              The dashboard
            </div>
          </div>
          <Kicker style={{ color: COLORS.green }}>● ALL ONLINE</Kicker>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 16,
        }}>
          {FEATURES.filter((f) => f.id !== 'home').map((f, i) => (
            <FeatureCard key={f.id} feature={f} onClick={() => nav(f.id)} idx={i} />
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
  const [history, setHistory] = usePersisted('se77n.ai.history.v2', {});
  const messages = history.chat || [];
  const recent = messages.slice(-6);
  const [input, setInput] = useState('');
  const [imgRef, setImgRef] = useState(null);
  const [busy, setBusy] = useState(false);
  const [busyHint, setBusyHint] = useState('thinking');
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

  async function send() {
    const q = input.trim();
    if ((!q && !imgRef) || busy) return;
    const used = imgRef;
    setInput('');
    setImgRef(null);
    setHistory((h) => ({
      ...h,
      chat: [...(h.chat || []), { role: 'user', content: q || '(image)', image: used?.dataUrl }],
    }));
    setBusy(true);
    setBusyHint(used ? 'analyzing image' : 'thinking');
    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: q, image: used?.dataUrl }),
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
      } else {
        assistantMsg = { role: 'assistant', content: data.text || '', intent: data.intent || 'chat' };
      }
      setHistory((h) => ({ ...h, chat: [...(h.chat || []), assistantMsg] }));
    } catch (e) {
      setHistory((h) => ({
        ...h,
        chat: [...(h.chat || []), { role: 'assistant', content: '⚠ ' + (e.message || 'error') }],
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
      <button onClick={onOpen} aria-label="Open chat with se77n"
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
        Ask anything…
      </button>
    );
  }

  return (
    <div role="dialog" aria-label="Chat with se77n"
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
            Ask anything…
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <FabHeaderBtn title="Open full chat" onClick={() => { onClose(); nav('ai'); }}>↗</FabHeaderBtn>
          <FabHeaderBtn title="Close (Esc)" onClick={onClose}>✕</FabHeaderBtn>
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
          recent.map((m, i) => <ChatBubble key={i} msg={m} accent={accent} />)
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
          placeholder="ask se77n…"
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

function ChatBubble({ msg, accent, typing }) {
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
    </div>
  );
}

function FeatureCard({ feature, onClick, idx }) {
  const iconNode = typeof feature.icon === 'function' ? feature.icon(feature.accent) : feature.icon;
  return (
    <button onClick={onClick} style={{
      textAlign: 'left', padding: 22, borderRadius: 14,
      background: COLORS.panel, border: '1px solid ' + COLORS.line,
      cursor: 'pointer',
      display: 'flex', flexDirection: 'column', gap: 16,
      minHeight: 148, position: 'relative', overflow: 'hidden',
      color: COLORS.text,
      transition: 'all 180ms',
      animation: `fadeUp 500ms ease-out ${idx * 50}ms both`,
    }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-4px)';
        e.currentTarget.style.borderColor = feature.accent + '70';
        e.currentTarget.style.boxShadow = `0 16px 36px -16px ${feature.accent}55, 0 0 0 1px ${feature.accent}33`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.borderColor = COLORS.line;
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
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
        }}>{feature.label}</div>
        <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 6, lineHeight: 1.5 }}>
          {feature.desc}
        </div>
      </div>
    </button>
  );
}
