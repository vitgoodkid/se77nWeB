// Mobile screen — full-bleed AI chat with drawer + slash menu.
// Pulled from se77n DNA: bg #0d0a08, text cream, red 77, Geist + JetBrains Mono.

const COLORS = {
  bg:     '#0d0a08',
  panel:  '#15110d',
  panel2: '#1c1813',
  line:   'rgba(255,255,255,0.08)',
  text:   '#f5ede0',
  muted:  'rgba(245,237,224,0.5)',
  faint:  'rgba(245,237,224,0.32)',
  red:    '#e04545',
  green:  '#5ba868',
  gold:   '#d4a858',
};

const MODULES = [
  { id: 'home',   label: 'Home',                short: '00', accent: COLORS.text,  icon: '⌂' },
  { id: 'ai',     label: 'AI Playground',       short: '01', accent: COLORS.red,   icon: '✦', desc: 'Chat · image · video' },
  { id: 'tools',  label: 'Toolbox',             short: '02', accent: COLORS.green, icon: '⚒', desc: 'Public + private utilities' },
  { id: 'travel', label: 'Travel Archive',      short: '03', accent: COLORS.gold,  icon: '◯', desc: 'World map · 16 cities' },
  { id: 'game',   label: 'Game',                short: '04', accent: COLORS.red,   icon: '◐', desc: 'Coming soon' },
  { id: 'tech',   label: 'Tech Stack Monitor',  short: '05', accent: COLORS.green, icon: '⌬', desc: '11 services · monthly burn' },
  { id: 'crypto', label: 'Crypto Watch',        short: '06', accent: COLORS.gold,  icon: '$', desc: 'BTC · GOLD · TWD ⇄ VND' },
  { id: 'vault',  label: 'Digital Vault',       short: '07', accent: COLORS.red,   icon: '⌘', desc: 'Credentials manager' },
  { id: 'todo',   label: 'To-Do List',          short: '08', accent: COLORS.green, icon: '✓', desc: 'Priorities · localStorage' },
];

const SLASH_COMMANDS = [
  { cmd: '/chat',      desc: 'Free chat',                  accent: COLORS.text  },
  { cmd: '/translate', desc: 'EN ⇄ VI auto-detect',        accent: COLORS.gold  },
  { cmd: '/tldr',      desc: 'Summarize long text',        accent: COLORS.text  },
  { cmd: '/code',      desc: 'Diagnose & fix',             accent: COLORS.green },
  { cmd: '/image',     desc: 'Generate · edit · remove bg', accent: COLORS.red  },
  { cmd: '/video',     desc: '5s clip via seedance',       accent: COLORS.gold  },
  { cmd: '/todo',      desc: 'Jump to to-do list',         accent: COLORS.green },
  { cmd: '/crypto',    desc: 'Markets · BTC · GOLD',       accent: COLORS.gold  },
];

const SEED_CHAT = [
  { role: 'user', content: 'are the markets open right now?' },
  { role: 'assistant', content: 'HOSE closed at 15:00 ICT (~30m ago). VN-Index settled at 1,294.71 — up 0.42% today.\n\nCrypto runs 24/7 — BTC at $94,200 ↗ · GOLD/oz $2,648.' },
  { role: 'user', mono: true, content: '/translate đường về nhà còn xa quá' },
  { role: 'assistant', intent: 'translate', content: '"the way home is still so far"\n\n— literal; carries a longing, slightly weary undertone. closer in spirit to "the road home stretches on without end."' },
];

const SUGGESTIONS = [
  { cmd: '/translate', label: 'translate text' },
  { cmd: '/image',     label: 'render an image' },
  { cmd: '/tldr',      label: 'summarize an article' },
  { cmd: '/code',      label: 'debug a snippet' },
];

// ─────────────────────────────────────────────────────────────
// Top bar — 52px, blur, hamburger · logo · new-chat
// ─────────────────────────────────────────────────────────────
function TopBar({ onMenu, onNewChat }) {
  return (
    <header style={{
      height: 52, flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 14px',
      borderBottom: '1px solid ' + COLORS.line,
      background: 'rgba(13,10,8,0.78)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      position: 'relative', zIndex: 30,
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

      <div className="mono" style={{
        fontSize: 22, fontWeight: 800, letterSpacing: '-0.025em', lineHeight: 1,
        color: COLORS.text,
      }}>
        se<span style={{
          color: COLORS.red,
          textShadow: `0 0 6px ${COLORS.red}cc, 0 0 16px ${COLORS.red}55`,
        }}>77</span>n
      </div>

      <button onClick={onNewChat} aria-label="new chat"
        title="new chat"
        style={{
          width: 36, height: 36, borderRadius: 9,
          background: 'transparent', border: '1px solid ' + COLORS.line,
          color: COLORS.muted, cursor: 'pointer',
          display: 'grid', placeItems: 'center', padding: 0,
          fontFamily: 'JetBrains Mono, monospace', fontSize: 18, fontWeight: 500,
        }}>＋</button>
    </header>
  );
}

// ─────────────────────────────────────────────────────────────
// Drawer — slides from left, 9 modules + footer
// ─────────────────────────────────────────────────────────────
function Drawer({ open, onClose, route, onNav }) {
  return (
    <>
      {/* scrim */}
      <div onClick={onClose}
        style={{
          position: 'absolute', inset: 0, zIndex: 80,
          background: open ? 'rgba(0,0,0,0.55)' : 'transparent',
          pointerEvents: open ? 'auto' : 'none',
          transition: 'background 220ms ease',
        }} />

      <aside style={{
        position: 'absolute', top: 0, bottom: 0, left: 0, zIndex: 90,
        width: 286, maxWidth: '82%',
        background: COLORS.bg,
        borderRight: '1px solid ' + COLORS.line,
        transform: open ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform 280ms cubic-bezier(0.22,1,0.36,1)',
        display: 'flex', flexDirection: 'column',
        paddingTop: 62, /* status bar */
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
              Experiment <span style={{ color: COLORS.red, fontWeight: 700 }}>007</span> · Mobile
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
          }}>Modules · 08</div>
          {MODULES.filter(m => m.id !== 'home').map(m => {
            const active = m.id === route;
            return (
              <button key={m.id} onClick={() => { onNav(m.id); onClose(); }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 10px', borderRadius: 10,
                  background: active ? m.accent + '14' : 'transparent',
                  border: '1px solid ' + (active ? m.accent + '40' : 'transparent'),
                  color: COLORS.text, cursor: 'pointer',
                  textAlign: 'left', position: 'relative',
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
                    color: active ? COLORS.text : COLORS.text,
                  }}>{m.label}</span>
                  <span style={{
                    display: 'block', fontSize: 10.5, color: COLORS.muted, marginTop: 2, lineHeight: 1.35,
                  }}>{m.desc}</span>
                </span>
                <span className="mono" style={{
                  fontSize: 9, letterSpacing: '0.16em', color: m.accent,
                  padding: '3px 6px', borderRadius: 999,
                  background: m.accent + '14', border: `1px solid ${m.accent}30`,
                }}>{m.short}</span>
                {active && (
                  <span style={{
                    position: 'absolute', left: -10, top: 12, bottom: 12, width: 2,
                    background: m.accent, borderRadius: 2,
                  }} />
                )}
              </button>
            );
          })}
        </nav>

        {/* footer */}
        <div style={{
          padding: '12px 16px 22px',
          borderTop: '1px solid ' + COLORS.line,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <span style={{
              width: 28, height: 28, borderRadius: 999,
              background: COLORS.red + '22', color: COLORS.red,
              display: 'grid', placeItems: 'center',
              fontFamily: 'JetBrains Mono, monospace', fontSize: 11, fontWeight: 800,
            }}>Z</span>
            <div>
              <div className="mono" style={{ fontSize: 11, color: COLORS.text, fontWeight: 700 }}>guest</div>
              <div className="mono" style={{ fontSize: 8.5, color: COLORS.muted, letterSpacing: '0.14em', marginTop: 1 }}>SIGN IN ↗</div>
            </div>
          </div>
          <div className="mono" style={{
            display: 'flex', alignItems: 'center', gap: 0,
            border: '1px solid ' + COLORS.line, borderRadius: 999, padding: 3,
            fontSize: 9.5, letterSpacing: '0.14em', fontWeight: 700,
          }}>
            <span style={{ padding: '4px 8px', borderRadius: 999, background: COLORS.text + '12', color: COLORS.text }}>EN</span>
            <span style={{ padding: '4px 8px', color: COLORS.muted }}>VI</span>
          </div>
        </div>
      </aside>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// Chat content — empty state + message list
// ─────────────────────────────────────────────────────────────
function ChatStream({ messages, onSuggest, hero = 'caret', typing = false }) {
  const scrollRef = React.useRef(null);
  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length, typing]);

  const empty = messages.length === 0;

  return (
    <div ref={scrollRef} className="phone-scroll" style={{
      flex: 1, overflowY: 'auto',
      padding: empty ? '24px 18px 8px' : '18px 14px 8px',
      display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      {empty ? (
        <EmptyState onSuggest={onSuggest} hero={hero} />
      ) : (
        <>
          <DayDivider label="TODAY · 16:34 ICT" />
          {messages.map((m, i) => <Bubble key={i} msg={m} />)}
          {typing && <TypingBubble />}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Typing / loading bubble — assistant is "thinking…"
// ─────────────────────────────────────────────────────────────
function TypingBubble({ hint = 'thinking' }) {
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
        }}>◌ rendering · ~3s</span>
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
        <span className="mono" style={{ fontSize: 11, color: COLORS.muted, letterSpacing: '0.04em' }}>
          {hint}
        </span>
      </div>
    </div>
  );
}

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

const HERO_VERBS = ['ask', 'think', 'ship', 'archive'];

function HeroCaret({ word = 'ask', size = 34 }) {
  return (
    <h1 className="mono" style={{
      margin: 0, fontSize: size, fontWeight: 800, letterSpacing: '-0.025em',
      lineHeight: 1.05, color: COLORS.text,
    }}>
      {word}<span style={{
        display: 'inline-block', width: Math.round(size * 0.22), height: Math.round(size * 0.74),
        marginLeft: 8, verticalAlign: '-2px',
        background: COLORS.red, boxShadow: `0 0 12px ${COLORS.red}66`,
        animation: 'blink 1s steps(1) infinite',
      }} />
    </h1>
  );
}

function HeroCycling() {
  const [i, setI] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setI(v => (v + 1) % HERO_VERBS.length), 1800);
    return () => clearInterval(id);
  }, []);
  return (
    <div>
      <HeroCaret word={HERO_VERBS[i]} size={36} />
      <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
        {HERO_VERBS.map((v, idx) => (
          <span key={v} style={{
            width: 18, height: 2, borderRadius: 2,
            background: idx === i ? COLORS.red : COLORS.line,
            transition: 'background 220ms',
          }} />
        ))}
      </div>
    </div>
  );
}

function HeroGreeting() {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);
  const hour = now.getHours();
  const phase = hour >= 5 && hour < 12 ? 'morning'
              : hour < 17 ? 'afternoon'
              : hour < 22 ? 'evening' : 'late';
  const isDay = hour >= 6 && hour < 18;
  const accent = isDay ? COLORS.gold : '#9bb4ff';
  const tStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
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
        }}>{isDay ? 'DAYLIGHT' : 'NIGHTSHIFT'} · {tStr} ICT · HCMC</span>
      </div>
      <h1 style={{
        margin: 0, fontSize: 30, fontWeight: 700, letterSpacing: '-0.02em',
        lineHeight: 1.1, color: COLORS.text,
        fontFamily: "'Geist', system-ui, sans-serif",
      }}>
        good {phase},<br/>
        <span className="mono" style={{
          color: COLORS.red, fontWeight: 800, letterSpacing: '-0.025em',
          textShadow: `0 0 12px ${COLORS.red}55`,
        }}>zzzzz</span><span style={{
          display: 'inline-block', width: 8, height: 22, marginLeft: 6, verticalAlign: '-2px',
          background: COLORS.red, animation: 'blink 1s steps(1) infinite',
        }} />
      </h1>
    </div>
  );
}

function EmptyState({ onSuggest, hero = 'caret' }) {
  return (
    <div style={{ marginTop: 8, animation: 'fadeUp 320ms ease-out' }}>
      <div className="mono" style={{
        fontSize: 8.5, letterSpacing: '0.24em', color: COLORS.red, fontWeight: 700, marginBottom: 10,
      }}>● ONLINE · EXP 007</div>

      {hero === 'cycling'  && <HeroCycling />}
      {hero === 'greeting' && <HeroGreeting />}
      {hero === 'caret'    && <HeroCaret word="ask" size={34} />}

      <p style={{
        margin: '14px 0 0', maxWidth: 320,
        fontSize: 13.5, color: COLORS.muted, lineHeight: 1.55,
      }}>
        {hero === 'greeting'
          ? <>what are we shipping tonight? type <span className="mono" style={{
              color: COLORS.text, background: COLORS.panel, padding: '1px 5px',
              borderRadius: 4, border: '1px solid ' + COLORS.line, fontSize: 12,
            }}>/</span> to pick an intent.</>
          : <>one prompt, eight modules. chat freely, or type <span className="mono" style={{
              color: COLORS.text, background: COLORS.panel, padding: '1px 5px',
              borderRadius: 4, border: '1px solid ' + COLORS.line, fontSize: 12,
            }}>/</span> to switch intents.</>
        }
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
              <span style={{ fontSize: 12.5, color: COLORS.muted }}>{s.label}</span>
              <span style={{ flex: 1 }} />
              <span style={{ color: COLORS.faint, fontSize: 13 }}>↗</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const INTENT_BADGE = {
  translate: { label: '⇄ translate',     color: COLORS.gold  },
  image:     { label: '✨ image',         color: '#C77BFF'    },
  video:     { label: '▶ video',          color: COLORS.gold  },
  bg:        { label: '⊘ bg-removed',    color: '#7ABEFF'    },
  code:      { label: '⌬ code',           color: COLORS.green },
  tldr:      { label: '◇ tl;dr',          color: COLORS.text  },
};

function Bubble({ msg }) {
  const isUser = msg.role === 'user';
  const badge = !isUser && msg.intent ? INTENT_BADGE[msg.intent] : null;

  if (isUser) {
    return (
      <div style={{
        alignSelf: 'flex-end', maxWidth: '85%',
        padding: '9px 13px', borderRadius: 12,
        background: COLORS.red + '14', border: `1px solid ${COLORS.red}40`,
        color: COLORS.text, fontSize: 13.5, lineHeight: 1.5,
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        fontFamily: msg.mono ? "'JetBrains Mono', monospace" : "inherit",
        animation: 'fadeUp 200ms ease-out',
      }}>{msg.content}</div>
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
      {msg.content}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Module strip (variant B only) — horizontal scroll pills
// ─────────────────────────────────────────────────────────────
function ModuleStrip({ onNav }) {
  return (
    <div style={{
      borderTop: '1px solid ' + COLORS.line,
      padding: '10px 12px 11px',
      background: 'rgba(13,10,8,0.6)',
    }}>
      <div className="mono" style={{
        fontSize: 8.5, letterSpacing: '0.24em', color: COLORS.muted,
        marginBottom: 8, paddingLeft: 2,
      }}>JUMP TO ·</div>
      <div style={{
        display: 'flex', gap: 8, overflowX: 'auto',
        scrollbarWidth: 'none',
        margin: '0 -12px', padding: '0 12px',
      }}>
        {MODULES.filter(m => m.id !== 'home' && m.id !== 'ai').map(m => (
          <button key={m.id} onClick={() => onNav(m.id)}
            style={{
              flexShrink: 0,
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '7px 12px 7px 8px', borderRadius: 999,
              background: m.accent + '0e',
              border: `1px solid ${m.accent}38`,
              color: COLORS.text, cursor: 'pointer',
            }}>
            <span style={{
              width: 22, height: 22, borderRadius: 999,
              background: m.accent + '22',
              color: m.accent,
              display: 'grid', placeItems: 'center',
              fontFamily: 'JetBrains Mono, monospace', fontSize: 11, fontWeight: 700,
            }}>{m.icon}</span>
            <span className="mono" style={{
              fontSize: 11, fontWeight: 600, color: COLORS.text, lineHeight: 1,
            }}>{m.label.split(' ')[0]}</span>
            <span className="mono" style={{
              fontSize: 8.5, color: m.accent, letterSpacing: '0.14em',
            }}>{m.short}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Slash menu popover — anchored above input
// ─────────────────────────────────────────────────────────────
function SlashMenu({ query, onPick }) {
  const q = query.toLowerCase();
  const filtered = SLASH_COMMANDS.filter(c => c.cmd.startsWith(q) || c.desc.toLowerCase().includes(q.slice(1)));
  const list = filtered.length ? filtered : SLASH_COMMANDS;
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
        <span>SLASH · {list.length} matches</span>
        <span style={{ color: COLORS.faint }}>ESC</span>
      </div>
      <div style={{ maxHeight: 240, overflowY: 'auto' }}>
        {list.slice(0, 6).map((c, i) => (
          <button key={c.cmd} onClick={() => onPick(c.cmd + ' ')}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 10,
              padding: '9px 12px',
              background: i === 0 ? c.accent + '0e' : 'transparent',
              border: 'none', borderBottom: i < Math.min(list.length, 6) - 1 ? '1px solid ' + COLORS.line : 'none',
              color: COLORS.text, cursor: 'pointer', textAlign: 'left',
              fontFamily: 'inherit',
            }}>
            <span className="mono" style={{
              fontSize: 11.5, fontWeight: 700, color: c.accent, minWidth: 78,
            }}>{c.cmd}</span>
            <span style={{ fontSize: 11.5, color: COLORS.muted, flex: 1 }}>{c.desc}</span>
            <span style={{ color: COLORS.faint, fontSize: 11 }}>↵</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Input bar — sticky bottom; paperclip · text · send
// ─────────────────────────────────────────────────────────────
function InputBar({ value, onChange, onSend, attached, onAttach, onRemoveAttach }) {
  const hasContent = value.trim().length > 0 || !!attached;
  const slashOpen = value.startsWith('/');

  return (
    <div style={{
      position: 'relative', flexShrink: 0,
      borderTop: '1px solid ' + COLORS.line,
      background: 'rgba(13,10,8,0.85)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      padding: '10px 12px 14px',
    }}>
      {slashOpen && <SlashMenu query={value.split(/\s/)[0]} onPick={(v) => onChange(v)} />}

      {attached && (
        <div style={{
          marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10,
          padding: '6px 10px 6px 6px', borderRadius: 10,
          background: COLORS.bg, border: '1px solid ' + COLORS.red + '40',
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 6,
            background: `repeating-linear-gradient(45deg, ${COLORS.red}22 0 6px, ${COLORS.red}11 6px 12px)`,
            border: '1px solid ' + COLORS.red + '40',
          }} />
          <span className="mono" style={{ fontSize: 10.5, color: COLORS.text, flex: 1 }}>{attached}</span>
          <button onClick={onRemoveAttach} aria-label="remove"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: COLORS.muted, fontSize: 13, padding: 4,
            }}>✕</button>
        </div>
      )}

      <div style={{
        display: 'flex', alignItems: 'flex-end', gap: 8,
      }}>
        <button onClick={onAttach} title="attach image"
          style={{
            width: 38, height: 38, borderRadius: 10, flexShrink: 0,
            background: attached ? COLORS.red + '14' : 'transparent',
            border: `1px solid ${attached ? COLORS.red + '55' : COLORS.line}`,
            color: attached ? COLORS.red : COLORS.muted, cursor: 'pointer',
            display: 'grid', placeItems: 'center', padding: 0,
          }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
          </svg>
        </button>

        <div style={{
          flex: 1, minWidth: 0,
          background: COLORS.bg, border: '1px solid ' + (slashOpen ? COLORS.red + '60' : COLORS.line),
          borderRadius: 10,
          transition: 'border-color 120ms',
          boxShadow: slashOpen ? `0 0 0 3px ${COLORS.red}18` : 'none',
        }}>
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="ask se77n…"
            rows={1}
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

        <button onClick={onSend} disabled={!hasContent} aria-label="send"
          style={{
            width: 38, height: 38, borderRadius: 10, flexShrink: 0,
            background: hasContent ? COLORS.red : 'transparent',
            border: `1px solid ${hasContent ? COLORS.red : COLORS.line}`,
            color: hasContent ? '#0d0a08' : COLORS.muted,
            cursor: hasContent ? 'pointer' : 'not-allowed',
            display: 'grid', placeItems: 'center', padding: 0,
            boxShadow: hasContent ? `0 6px 16px -6px ${COLORS.red}99` : 'none',
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
        fontSize: 8, letterSpacing: '0.22em', color: COLORS.faint,
      }}>
        <span>se77n · gemini 3.1 via yunwu</span>
        <span style={{ color: COLORS.muted }}>/ for intents</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Composite mobile screen — exported for both variants
// ─────────────────────────────────────────────────────────────
function MobileScreen({ variant = 'chat-only', initialMessages = SEED_CHAT, initialDrawer = false, hero = 'greeting', typing = false }) {
  const [drawerOpen, setDrawerOpen] = React.useState(initialDrawer);
  const [route, setRoute] = React.useState('ai');
  const [input, setInput] = React.useState('');
  const [attached, setAttached] = React.useState(null);
  const [messages, setMessages] = React.useState(initialMessages);

  function send() {
    const t = input.trim();
    if (!t && !attached) return;
    setMessages([...messages, { role: 'user', content: t || '(image)', mono: t.startsWith('/') }]);
    setInput('');
    setAttached(null);
  }

  return (
    <div style={{
      width: '100%', height: '100%', position: 'relative',
      background: COLORS.bg, color: COLORS.text,
      fontFamily: "'Geist', system-ui, sans-serif",
      overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* push past status bar */}
      <div style={{ height: 62, flexShrink: 0 }} />

      <TopBar
        onMenu={() => setDrawerOpen(true)}
        onNewChat={() => setMessages([])}
      />

      <ChatStream
        messages={messages}
        onSuggest={(v) => setInput(v)}
        hero={hero}
        typing={typing}
      />

      {variant === 'with-modules' && (
        <ModuleStrip onNav={(id) => { setRoute(id); }} />
      )}

      <InputBar
        value={input}
        onChange={setInput}
        onSend={send}
        attached={attached}
        onAttach={() => setAttached(attached ? null : 'mockup-screenshot.png')}
        onRemoveAttach={() => setAttached(null)}
      />

      {/* home indicator safe area */}
      <div style={{ height: 34, flexShrink: 0, background: COLORS.bg }} />

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        route={route}
        onNav={setRoute}
      />
    </div>
  );
}

Object.assign(window, { MobileScreen, COLORS, MODULES });
