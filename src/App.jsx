import { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import {
  COLORS, SOCIALS,
  Btn, Kicker,
  GlyphSun, GlyphMoon,
  useClock, useGeoDayNight, useAmbient, useLanyard,
  resolveAssetUrl,
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
  { id: 'travel', label: 'Travel Archive',      icon: '◉',   accent: COLORS.gold,  short: '03', desc: 'World map · 16 cities' },
  { id: 'game',   label: 'Game',                icon: '◐',   accent: COLORS.red,   short: '04', desc: 'Coming soon' },
  { id: 'tech',   label: 'Tech Stack Monitor',  icon: '⌬',   accent: COLORS.green, short: '05', desc: '11 services · monthly burn' },
  { id: 'crypto', label: 'Crypto Watch',        icon: '$',   accent: COLORS.gold,  short: '06', desc: 'BTC · GOLD · TWD ⇄ VND' },
  { id: 'vault',  label: 'Digital Vault',       icon: '⌘',   accent: COLORS.red,   short: '07', desc: 'Credentials manager' },
  { id: 'todo',   label: 'To-Do List',          icon: '✓',   accent: COLORS.green, short: '08', desc: 'Priorities · localStorage' },
];

const EXPERIMENT_NUMBER = '005';

export default function App() {
  const ambientOn = true;
  const showBg = true;

  const [route, setRoute] = useState(() => {
    const h = window.location.hash.replace(/^#\//, '');
    return FEATURES.find((f) => f.id === h) ? h : 'home';
  });
  const [transitioning, setTransitioning] = useState(false);

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
      if (e.key === 'Escape' && route !== 'home') nav('home');
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [route]);

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
      <button onClick={() => nav('home')} style={{
        background: 'transparent', border: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 14, padding: 0,
        color: COLORS.text,
      }}>
        <span style={{
          width: 36, height: 36, borderRadius: 10,
          background: COLORS.red, color: '#0d0a08',
          display: 'grid', placeItems: 'center',
          fontFamily: 'JetBrains Mono, monospace', fontSize: 16, fontWeight: 800,
          boxShadow: `0 0 24px ${COLORS.red}55`,
        }}>S</span>
        <div style={{ textAlign: 'left' }}>
          <div className="mono" style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.01em', lineHeight: 1 }}>
            se<span style={{ color: COLORS.red, textShadow: `0 0 12px ${COLORS.red}80` }}>77</span>n
          </div>
          <div className="mono" style={{ fontSize: 8, letterSpacing: '0.22em', color: COLORS.muted, marginTop: 3 }}>
            EXP·{EXPERIMENT_NUMBER} / DESKTOP
          </div>
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
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 18, fontWeight: 700, lineHeight: 1 }}>
              {f.icon}
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
      <section style={{
        display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 28, marginBottom: 28,
      }}>
        <div>
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
            margin: '20px 0 0', maxWidth: 620,
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
        </div>

        <HeroSideCard ambient={ambient} on={ambientOn} />
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

      <section style={{ marginTop: 30 }}>
        <Kicker style={{ marginBottom: 14 }}>CHANNELS</Kicker>
        <div style={{
          display: 'flex', gap: 12, alignItems: 'center',
          padding: 18, background: COLORS.panel,
          border: '1px solid ' + COLORS.line, borderRadius: 14,
        }}>
          {SOCIALS.map((s) => (
            <a key={s.id} href={s.href} aria-label={s.label} title={s.label}
              style={{
                width: 48, height: 48, display: 'grid', placeItems: 'center',
                background: COLORS.bg, borderRadius: 10,
                border: '1px solid ' + COLORS.line,
                color: COLORS.muted, transition: 'all 150ms',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = COLORS.red;
                e.currentTarget.style.borderColor = COLORS.red + '60';
                e.currentTarget.style.transform = 'translateY(-2px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = COLORS.muted;
                e.currentTarget.style.borderColor = COLORS.line;
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >{s.icon}</a>
          ))}
          <div style={{ flex: 1 }} />
          <Kicker style={{ color: COLORS.muted }}>5 SURFACES · @se77n</Kicker>
        </div>
      </section>
    </div>
  );
}

function HeroSideCard({ ambient, on }) {
  const { track, t: progress, isLive, game, status, elapsed, total } = ambient;
  const accent = track.palette[0];
  const statusColor = {
    online:  COLORS.green,
    idle:    COLORS.gold,
    dnd:     COLORS.red,
    offline: COLORS.muted,
  }[status] || COLORS.muted;
  const gameArt = game ? resolveAssetUrl(game, 'large_image') : null;

  return (
    <div style={{
      padding: 22, borderRadius: 18,
      background: `linear-gradient(135deg, ${accent}22, ${track.palette[1] || COLORS.green}1a)`,
      border: `1px solid ${accent}40`,
      display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      minHeight: 320,
      transition: 'background 1.4s, border-color 1.4s',
      position: 'relative', overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', inset: 0,
        background: `radial-gradient(80% 80% at 70% 30%, ${accent}33, transparent 60%)`,
        pointerEvents: 'none',
      }} />

      <div style={{ position: 'relative', display: 'flex', gap: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Kicker style={{ color: accent }}>
              {isLive ? '● LIVE · SPOTIFY' : on ? '● AMBIENT · DEMO' : '○ AMBIENT · IDLE'}
            </Kicker>
            <span title={`Discord · ${status}`} style={{
              width: 8, height: 8, borderRadius: 999,
              background: statusColor,
              boxShadow: status === 'online' ? `0 0 6px ${statusColor}` : 'none',
            }} />
          </div>
          <div className="mono" style={{
            fontSize: 11, color: COLORS.muted, marginTop: 16, letterSpacing: '0.16em',
          }}>NOW PLAYING</div>
          <div style={{
            fontSize: 24, fontWeight: 700, marginTop: 6,
            fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.2,
            wordBreak: 'break-word',
          }}>{track.title}</div>
          <div className="mono" style={{ fontSize: 12, color: COLORS.muted, marginTop: 6 }}>
            {track.artist}{track.album ? ' · ' + track.album : ''}
          </div>
        </div>
        {track.coverUrl && (
          <img src={track.coverUrl} alt="" style={{
            width: 88, height: 88, borderRadius: 12,
            objectFit: 'cover', flexShrink: 0,
            boxShadow: `0 8px 24px -8px ${accent}66`,
          }} />
        )}
      </div>

      {game && (
        <div style={{
          position: 'relative', marginTop: 18,
          padding: '12px 14px', borderRadius: 12,
          background: 'rgba(0,0,0,0.25)', border: `1px solid ${COLORS.red}40`,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: 8, flexShrink: 0,
            background: gameArt ? `url(${gameArt}) center/cover no-repeat` : COLORS.red + '30',
            display: 'grid', placeItems: 'center',
          }}>
            {!gameArt && <span className="mono" style={{ fontSize: 18, color: COLORS.red, fontWeight: 800 }}>◐</span>}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="mono" style={{
              fontSize: 9, letterSpacing: '0.2em', color: COLORS.red, fontWeight: 700,
            }}>● PLAYING NOW</div>
            <div className="mono" style={{
              fontSize: 14, color: COLORS.text, marginTop: 4, fontWeight: 700,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{game.name}</div>
            {(game.details || game.state) && (
              <div className="mono" style={{
                fontSize: 10, color: COLORS.muted, marginTop: 2,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>{[game.details, game.state].filter(Boolean).join(' · ')}</div>
            )}
          </div>
        </div>
      )}

      <div style={{ position: 'relative', marginTop: game ? 14 : 0 }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          {[accent, track.palette[1] || COLORS.green, COLORS.gold].map((c, i) => (
            <div key={i} style={{ flex: 1, height: 24, borderRadius: 4, background: c }} />
          ))}
        </div>
        <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{
            height: '100%', width: progress * 100 + '%',
            background: accent, transition: 'width 200ms',
          }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }} className="mono">
          <span style={{ fontSize: 10, color: COLORS.muted }}>{fmtSec(elapsed)}</span>
          <span style={{ fontSize: 10, color: COLORS.muted }}>{fmtSec(total)}</span>
        </div>
      </div>
    </div>
  );
}

function fmtSec(s) {
  if (!s || !isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const ss = String(Math.floor(s % 60)).padStart(2, '0');
  return `${m}:${ss}`;
}

function FeatureCard({ feature, onClick, idx }) {
  return (
    <button onClick={onClick} style={{
      textAlign: 'left', padding: 22, borderRadius: 14,
      background: COLORS.panel, border: '1px solid ' + COLORS.line,
      cursor: 'pointer',
      display: 'flex', flexDirection: 'column', gap: 18,
      minHeight: 168, position: 'relative', overflow: 'hidden',
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
        position: 'absolute', top: 16, right: 18,
        fontFamily: 'JetBrains Mono, monospace', fontSize: 10,
        letterSpacing: '0.16em', color: COLORS.muted,
      }}>{feature.short}</span>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <span style={{
          width: 44, height: 44, borderRadius: 12,
          background: feature.accent + '14',
          border: `1px solid ${feature.accent}50`,
          color: feature.accent,
          display: 'grid', placeItems: 'center',
          fontFamily: 'JetBrains Mono, monospace', fontSize: 20, fontWeight: 800,
        }}>{feature.icon}</span>
      </div>

      <div>
        <div className="mono" style={{
          fontSize: 14, fontWeight: 700, letterSpacing: '-0.005em', color: COLORS.text,
        }}>{feature.label}</div>
        <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 6, lineHeight: 1.5 }}>
          {feature.desc}
        </div>
      </div>

      <div style={{ flex: 1 }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            width: 6, height: 6, borderRadius: 999,
            background: COLORS.green, boxShadow: `0 0 6px ${COLORS.green}`,
          }} />
          <span className="mono" style={{ fontSize: 9, letterSpacing: '0.18em', color: COLORS.green }}>READY</span>
        </span>
        <span className="mono" style={{ fontSize: 11, color: feature.accent, letterSpacing: '0.06em' }}>
          OPEN →
        </span>
      </div>
    </button>
  );
}
