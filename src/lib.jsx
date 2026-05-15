import { useState, useEffect, useMemo } from 'react';

// ── Colors ─────────────────────────────────────────────────────
export const COLORS = {
  bg: '#0d0a08',
  panel: '#15110d',
  panel2: '#1c1813',
  line: 'rgba(255,255,255,0.08)',
  text: '#f5ede0',
  muted: 'rgba(245,237,224,0.5)',
  red: '#E04545',
  green: '#5BA868',
  gold: '#D4A858',
};

// ── Persisted state ────────────────────────────────────────────
export function usePersisted(key, initial) {
  const [v, setV] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return initial;
      return JSON.parse(raw);
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      /* quota / disabled storage */
    }
  }, [key, v]);
  return [v, setV];
}

// ── Clock + Day/Night (geolocation-aware) ──────────────────────
export function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function useGeoDayNight() {
  const [state, setState] = useState({
    phase: 'day',
    city: '— · —',
    tz: '',
    sunrise: null,
    sunset: null,
  });
  useEffect(() => {
    function fallback() {
      const h = new Date().getHours();
      const phase = h >= 6 && h < 18 ? 'day' : 'night';
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      setState((s) => ({ ...s, phase, tz, city: tz.split('/').pop().replace(/_/g, ' ') }));
    }
    fallback();
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        const now = new Date();
        const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
        const declination = 23.45 * Math.sin(((360 / 365) * (dayOfYear - 81) * Math.PI) / 180);
        const latRad = (lat * Math.PI) / 180;
        const decRad = (declination * Math.PI) / 180;
        const hourAngle = (Math.acos(-Math.tan(latRad) * Math.tan(decRad)) * 180) / Math.PI;
        const solarNoonUTC = 12 - lon / 15;
        const sunriseUTC = solarNoonUTC - hourAngle / 15;
        const sunsetUTC = solarNoonUTC + hourAngle / 15;
        const hUTC = now.getUTCHours() + now.getUTCMinutes() / 60;
        const phase = hUTC >= sunriseUTC && hUTC < sunsetUTC ? 'day' : 'night';
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        setState({
          phase,
          city: tz.split('/').pop().replace(/_/g, ' '),
          tz,
          sunrise: sunriseUTC,
          sunset: sunsetUTC,
        });
      },
      () => {},
      { timeout: 3000, maximumAge: 600000 },
    );
  }, []);
  return state;
}

// ── Discord presence via Lanyard ───────────────────────────────
// https://github.com/Phineas/lanyard
export const LANYARD_USER_ID = '397342895327150080';

export function useLanyard(userId = LANYARD_USER_ID) {
  const [data, setData] = useState(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let ws;
    let hb;
    let retry;
    let alive = true;
    let backoff = 2000;

    function pickInit(d) {
      if (!d) return null;
      if (d.discord_user) return d;             // single-id subscription
      if (d[userId]?.discord_user) return d[userId];
      return null;
    }

    function connect() {
      try {
        ws = new WebSocket('wss://api.lanyard.rest/socket');
      } catch {
        retry = setTimeout(connect, backoff);
        return;
      }

      ws.onopen = () => { backoff = 2000; };
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.op === 1) {
          // Hello → start heartbeat + initialize
          const interval = msg.d?.heartbeat_interval ?? 30000;
          hb = setInterval(() => {
            try { ws.send(JSON.stringify({ op: 3 })); } catch {}
          }, interval);
          ws.send(JSON.stringify({ op: 2, d: { subscribe_to_id: userId } }));
        } else if (msg.op === 0) {
          if (msg.t === 'INIT_STATE' || msg.t === 'PRESENCE_UPDATE') {
            const d = pickInit(msg.d);
            if (d) {
              setData(d);
              setConnected(true);
            }
          }
        }
      };
      ws.onclose = () => {
        setConnected(false);
        clearInterval(hb);
        if (alive) {
          retry = setTimeout(connect, backoff);
          backoff = Math.min(backoff * 2, 30000);
        }
      };
      ws.onerror = () => {
        try { ws.close(); } catch {}
      };
    }

    connect();
    return () => {
      alive = false;
      clearInterval(hb);
      clearTimeout(retry);
      try { ws?.close(); } catch {}
    };
  }, [userId]);

  return { data, connected };
}

// Pick the first non-Spotify, non-CustomStatus activity (= a real game/app)
export function pickGame(lanyard) {
  if (!lanyard?.activities) return null;
  // type 0 = Playing, 1 = Streaming, 3 = Watching, 5 = Competing
  const games = lanyard.activities.filter((a) => a.type === 0 || a.type === 1 || a.type === 3 || a.type === 5);
  return games[0] || null;
}

// Resolve a Discord activity asset key into a real CDN URL.
// Asset keys come in three flavors:
//   1. "mp:external/<encoded>/<host>/path" — proxied external image
//   2. "spotify:<id>"                       — Spotify cover (i.scdn.co)
//   3. "<numeric_hash>"                     — Discord application asset
export function resolveAssetUrl(activity, key = 'large_image') {
  const v = activity?.assets?.[key];
  if (!v) return null;
  if (v.startsWith('mp:external/')) {
    return 'https://media.discordapp.net/external/' + v.slice('mp:external/'.length);
  }
  if (v.startsWith('spotify:')) {
    return 'https://i.scdn.co/image/' + v.slice('spotify:'.length);
  }
  if (activity.application_id) {
    return `https://cdn.discordapp.com/app-assets/${activity.application_id}/${v}.png`;
  }
  return null;
}

// ── Ambient (audio-reactive) background ────────────────────────
// Fallback rotation when Discord/Lanyard isn't broadcasting Spotify.
export const AMBIENT_TRACKS = [
  { artist: 'SEKIMANE × shonci', title: 'TAKA LA DENTRO', album: '005', palette: ['#E04545', '#1a0a08'] },
  { artist: 'odetari', title: 'GMFU', album: 'CYBERNETIC', palette: ['#5BA868', '#0b1a12'] },
  { artist: 'Phum Viphurit', title: 'Lover Boy', album: 'OST', palette: ['#D4A858', '#1a1408'] },
  { artist: 'MAVERICK', title: 'NEON·SADE', album: '∂005', palette: ['#E04545', '#5BA868'] },
  { artist: 'Tame Impala', title: 'Borderline', album: 'Slow Rush', palette: ['#D4A858', '#E04545'] },
];

export function useAmbient(enabled = true, lanyard = null) {
  const [trackIdx, setTrackIdx] = useState(0);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);

  const spotify = lanyard?.spotify || null;
  const isLive = !!(lanyard?.listening_to_spotify && spotify);

  // Build the active track: real Spotify when live, fallback otherwise
  const track = useMemo(() => {
    if (isLive) {
      return {
        artist: spotify.artist?.split(';').join(', ') || '—',
        title: spotify.song || '—',
        album: spotify.album || '',
        palette: ['#1DB954', '#0b1a12'], // Spotify brand green
        coverUrl: spotify.album_art_url || null,
        live: true,
      };
    }
    return AMBIENT_TRACKS[trackIdx];
  }, [isLive, spotify?.track_id, spotify?.song, spotify?.artist, spotify?.album, spotify?.album_art_url, trackIdx]);

  // Progress driver — Spotify timestamps when live, fake time when not
  useEffect(() => {
    if (isLive) {
      const start = spotify.timestamps?.start;
      const end = spotify.timestamps?.end;
      if (!start || !end || end <= start) {
        setT(0);
        return;
      }
      const tick = () => {
        const p = Math.min(1, Math.max(0, (Date.now() - start) / (end - start)));
        setT(p);
      };
      tick();
      const id = setInterval(tick, 500);
      return () => clearInterval(id);
    }
    if (!playing) return;
    const id = setInterval(() => {
      setT((prev) => {
        const next = prev + 0.003;
        if (next >= 1) {
          setTrackIdx((i) => (i + 1) % AMBIENT_TRACKS.length);
          return 0;
        }
        return next;
      });
    }, 200);
    return () => clearInterval(id);
  }, [playing, isLive, spotify?.timestamps?.start, spotify?.timestamps?.end]);

  // Push palette into CSS vars for the AmbientBackground
  useEffect(() => {
    if (!enabled) {
      document.documentElement.style.removeProperty('--ambient-r');
      document.documentElement.style.removeProperty('--ambient-g');
      document.documentElement.style.removeProperty('--ambient-b');
      return;
    }
    const hex = track.palette[0];
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    document.documentElement.style.setProperty('--ambient-r', r);
    document.documentElement.style.setProperty('--ambient-g', g);
    document.documentElement.style.setProperty('--ambient-b', b);
  }, [enabled, track.palette[0]]);

  // Total/elapsed in seconds for display
  const total = isLive && spotify.timestamps?.end && spotify.timestamps?.start
    ? Math.round((spotify.timestamps.end - spotify.timestamps.start) / 1000)
    : 180;
  const elapsed = Math.round(t * total);

  return {
    track,
    t,
    playing: isLive ? true : playing,
    setPlaying,
    next: () => !isLive && setTrackIdx((i) => (i + 1) % AMBIENT_TRACKS.length),
    prev: () => !isLive && setTrackIdx((i) => (i - 1 + AMBIENT_TRACKS.length) % AMBIENT_TRACKS.length),
    isLive,
    game: pickGame(lanyard),
    status: lanyard?.discord_status || 'offline',
    elapsed,
    total,
  };
}

// ── Sparkline (SVG) ────────────────────────────────────────────
export function Sparkline({ data, color, w = 96, h = 28, fill = false }) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / span) * (h - 4) - 2;
    return [x, y];
  });
  const d = 'M ' + pts.map((p) => p.join(' ')).join(' L ');
  return (
    <svg width={w} height={h} style={{ display: 'block', overflow: 'visible' }}>
      {fill && <path d={`${d} L ${w} ${h} L 0 ${h} Z`} fill={color} opacity="0.12" />}
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function genSeries(n = 24, start = 100, vol = 2) {
  const out = [start];
  for (let i = 1; i < n; i++) {
    out.push(out[i - 1] + (Math.random() - 0.5) * vol);
  }
  return out;
}

// ── Hex icon ──────────────────────────────────────────────────
export function HexIcon({ glyph, size = 36, color, fill = 0.08 }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} style={{ display: 'block' }}>
      <polygon points="50,4 91,27 91,73 50,96 9,73 9,27" fill="none" stroke={color} strokeWidth="2" opacity="0.55" />
      <polygon points="50,16 80,33 80,67 50,84 20,67 20,33" fill={color} opacity={fill} />
      <text
        x="50"
        y="60"
        textAnchor="middle"
        fontFamily="JetBrains Mono, monospace"
        fontSize="34"
        fontWeight="800"
        fill={color}
      >
        {glyph}
      </text>
    </svg>
  );
}

export function GlyphSun({ size = 18, color = '#D4A858' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6">
      <circle cx="12" cy="12" r="4" />
      <g strokeLinecap="round">
        <line x1="12" y1="2" x2="12" y2="5" />
        <line x1="12" y1="19" x2="12" y2="22" />
        <line x1="2" y1="12" x2="5" y2="12" />
        <line x1="19" y1="12" x2="22" y2="12" />
        <line x1="4.5" y1="4.5" x2="6.7" y2="6.7" />
        <line x1="17.3" y1="17.3" x2="19.5" y2="19.5" />
        <line x1="4.5" y1="19.5" x2="6.7" y2="17.3" />
        <line x1="17.3" y1="6.7" x2="19.5" y2="4.5" />
      </g>
    </svg>
  );
}

export function GlyphMoon({ size = 18, color = '#9bb4ff' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} stroke="none">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

export const SocialIcons = {
  github: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55 0-.27-.01-1-.02-1.96-3.2.7-3.87-1.54-3.87-1.54-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.71.08-.71 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.47.11-3.07 0 0 .97-.31 3.18 1.18.92-.26 1.91-.39 2.89-.39.98 0 1.97.13 2.89.39 2.21-1.49 3.18-1.18 3.18-1.18.63 1.6.23 2.78.11 3.07.74.81 1.19 1.84 1.19 3.1 0 4.43-2.69 5.41-5.26 5.69.41.36.78 1.06.78 2.13 0 1.54-.01 2.78-.01 3.16 0 .3.21.67.8.55C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z" />
    </svg>
  ),
  discord: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
      <path d="M20.317 4.37a19.79 19.79 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.74 19.74 0 003.677 4.37a.07.07 0 00-.032.028C.533 9.046-.32 13.58.099 18.058a.082.082 0 00.031.056 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.873-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.1 13.1 0 01-1.872-.892.077.077 0 01-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 01.078-.01c3.928 1.793 8.18 1.793 12.061 0a.074.074 0 01.079.01c.12.099.246.197.373.291a.077.077 0 01-.006.128 12.3 12.3 0 01-1.873.891.076.076 0 00-.04.107c.36.698.772 1.363 1.225 1.993a.076.076 0 00.084.028 19.84 19.84 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.029zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  ),
  facebook: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
      <path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5 3.66 9.15 8.44 9.94v-7.03H7.9v-2.91h2.54V9.84c0-2.52 1.49-3.91 3.78-3.91 1.1 0 2.24.2 2.24.2v2.47h-1.26c-1.24 0-1.63.77-1.63 1.56v1.88h2.77l-.44 2.91h-2.33V22c4.78-.79 8.43-4.94 8.43-9.94z" />
    </svg>
  ),
  instagram: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  ),
  x: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
      <path d="M18.244 2H21.5l-7.5 8.57L22.5 22h-6.83l-5.35-7-6.13 7H.93l8.02-9.16L1.5 2h7l4.84 6.4L18.24 2zm-1.2 18h1.9L7.05 4h-2.02l12.01 16z" />
    </svg>
  ),
};

export const SOCIALS = [
  { id: 'github', label: 'GitHub', icon: SocialIcons.github, href: '#' },
  { id: 'discord', label: 'Discord', icon: SocialIcons.discord, href: '#' },
  { id: 'x', label: 'X', icon: SocialIcons.x, href: '#' },
  { id: 'facebook', label: 'Facebook', icon: SocialIcons.facebook, href: '#' },
  { id: 'instagram', label: 'Instagram', icon: SocialIcons.instagram, href: '#' },
];

// ── UI primitives ─────────────────────────────────────────────
export function Panel({ children, style, padding = 20 }) {
  return (
    <div
      style={{
        background: COLORS.panel,
        border: '1px solid ' + COLORS.line,
        borderRadius: 14,
        padding,
        position: 'relative',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function PanelHeader({ kicker, title, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 14 }}>
      <div>
        <div className="mono" style={{ fontSize: 10, letterSpacing: '0.22em', color: COLORS.muted, marginBottom: 6 }}>
          {kicker}
        </div>
        <div className="mono" style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em' }}>
          {title}
        </div>
      </div>
      {right}
    </div>
  );
}

export function Btn({ children, onClick, variant = 'ghost', color = COLORS.red, style, type, disabled, title }) {
  const styles = {
    ghost: {
      background: 'transparent',
      border: `1px solid ${COLORS.line}`,
      color: COLORS.text,
    },
    solid: {
      background: color,
      border: `1px solid ${color}`,
      color: '#0d0a08',
      fontWeight: 700,
    },
    tinted: {
      background: color + '1a',
      border: `1px solid ${color}55`,
      color,
    },
  }[variant];
  return (
    <button
      onClick={onClick}
      type={type}
      disabled={disabled}
      title={title}
      className="mono"
      style={{
        padding: '9px 14px',
        borderRadius: 10,
        fontSize: 11,
        letterSpacing: '0.08em',
        cursor: disabled ? 'not-allowed' : 'pointer',
        textTransform: 'uppercase',
        opacity: disabled ? 0.45 : 1,
        transition: 'transform 100ms, background 120ms',
        ...styles,
        ...style,
      }}
      onMouseDown={(e) => {
        if (!disabled) e.currentTarget.style.transform = 'translateY(1px)';
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      {children}
    </button>
  );
}

export function Field({ value, onChange, placeholder, type = 'text', mono = true, style, onKeyDown, autoFocus }) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      onKeyDown={onKeyDown}
      autoFocus={autoFocus}
      className={mono ? 'mono' : ''}
      style={{
        width: '100%',
        background: COLORS.bg,
        border: `1px solid ${COLORS.line}`,
        borderRadius: 10,
        padding: '11px 14px',
        color: COLORS.text,
        fontSize: 13,
        outline: 'none',
        transition: 'border-color 120ms, box-shadow 120ms',
        ...style,
      }}
      onFocus={(e) => {
        e.currentTarget.style.borderColor = COLORS.red;
        e.currentTarget.style.boxShadow = `0 0 0 3px ${COLORS.red}22`;
      }}
      onBlur={(e) => {
        e.currentTarget.style.borderColor = COLORS.line;
        e.currentTarget.style.boxShadow = 'none';
      }}
    />
  );
}

export function Pill({ children, color = COLORS.red, size = 'sm' }) {
  return (
    <span
      className="mono"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: size === 'sm' ? '3px 8px' : '5px 11px',
        borderRadius: 999,
        background: color + '18',
        border: `1px solid ${color}40`,
        color,
        fontSize: size === 'sm' ? 9 : 10,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

export function Kicker({ children, color = COLORS.muted, style }) {
  return (
    <div className="mono" style={{ fontSize: 10, letterSpacing: '0.22em', color, ...style }}>
      {children}
    </div>
  );
}

// ── Data ──────────────────────────────────────────────────────
export const CITIES = [
  { id: 'tpe', city: 'Taipei',       country: 'TW', lat: 25.04,  lng: 121.56, type: 'home',    note: 'Home base ∂005' },
  { id: 'sgn', city: 'Saigon',       country: 'VN', lat: 10.76,  lng: 106.66, type: 'visited', note: 'Family · childhood' },
  { id: 'han', city: 'Hà Nội',       country: 'VN', lat: 21.03,  lng: 105.85, type: 'visited', note: 'Old quarter rain' },
  { id: 'tyo', city: 'Tokyo',        country: 'JP', lat: 35.68,  lng: 139.69, type: 'visited', note: 'Shibuya · Akiba' },
  { id: 'osa', city: 'Osaka',        country: 'JP', lat: 34.69,  lng: 135.50, type: 'visited', note: 'Dotonbori nights' },
  { id: 'sel', city: 'Seoul',        country: 'KR', lat: 37.57,  lng: 126.98, type: 'visited', note: 'Hongdae records' },
  { id: 'bkk', city: 'Bangkok',      country: 'TH', lat: 13.75,  lng: 100.50, type: 'visited', note: 'Sukhumvit ramen' },
  { id: 'sin', city: 'Singapore',    country: 'SG', lat: 1.35,   lng: 103.82, type: 'visited', note: 'Marina + Hawker' },
  { id: 'hkg', city: 'Hong Kong',    country: 'HK', lat: 22.32,  lng: 114.17, type: 'visited', note: 'TST harbor walk' },
  { id: 'kul', city: 'Kuala Lumpur', country: 'MY', lat: 3.14,   lng: 101.69, type: 'planned', note: 'KLCC sky' },
  { id: 'syd', city: 'Sydney',       country: 'AU', lat: -33.87, lng: 151.21, type: 'planned', note: 'Coastal walk' },
  { id: 'sfo', city: 'San Francisco',country: 'US', lat: 37.77,  lng: -122.42,type: 'planned', note: 'Mission · Dogpatch' },
  { id: 'nyc', city: 'New York',     country: 'US', lat: 40.71,  lng: -74.01, type: 'planned', note: 'Brooklyn studios' },
  { id: 'lhr', city: 'London',       country: 'UK', lat: 51.51,  lng: -0.13,  type: 'planned', note: 'Shoreditch crawl' },
  { id: 'par', city: 'Paris',        country: 'FR', lat: 48.85,  lng: 2.35,   type: 'planned', note: 'Le Marais' },
  { id: 'ber', city: 'Berlin',       country: 'DE', lat: 52.52,  lng: 13.40,  type: 'planned', note: 'Kreuzberg' },
];

export const TECH = [
  { id: 'ado',  name: 'Adobe Creative',   category: 'design',   cost: 22.99, native: 22.99, currency: 'USD' },
  { id: 'fig',  name: 'Figma Pro',        category: 'design',   cost: 15.00, native: 15.00, currency: 'USD' },
  { id: 'gh',   name: 'GitHub Pro',       category: 'dev',      cost: 4.00,  native: 4.00,  currency: 'USD' },
  { id: 'cf',   name: 'Cloudflare Pro',   category: 'infra',    cost: 25.00, native: 25.00, currency: 'USD' },
  { id: 'vc',   name: 'Vercel Pro',       category: 'infra',    cost: 20.00, native: 20.00, currency: 'USD' },
  { id: 'cla',  name: 'Claude Max',       category: 'ai',       cost: 20.00, native: 20.00, currency: 'USD' },
  { id: 'ctx',  name: 'Cursor Pro',       category: 'ai',       cost: 20.00, native: 20.00, currency: 'USD' },
  { id: 'sp',   name: 'Spotify Family',   category: 'media',    cost: 5.43,  native: 169,   currency: 'TWD' },
  { id: 'nf',   name: 'Netflix Standard', category: 'media',    cost: 10.85, native: 330,   currency: 'TWD' },
  { id: 'icl',  name: 'iCloud+ 200GB',    category: 'storage',  cost: 2.99,  native: 90,    currency: 'TWD' },
  { id: '1p',   name: '1Password Fam',    category: 'security', cost: 4.99,  native: 4.99,  currency: 'USD' },
];

export const VAULT_SEED = [
  { id: 'v1',  label: 'GitHub',     category: 'dev',      user: 'se77n',         secret: 'gh_p_••••••XK4n2',  tags: ['code','2fa'], updated: '2026-04-12' },
  { id: 'v2',  label: 'Vercel',     category: 'infra',    user: 'team@se77n',    secret: 'vc_•••••MGW',       tags: ['deploy'],     updated: '2026-03-30' },
  { id: 'v3',  label: 'Cloudflare', category: 'infra',    user: 'admin@se77n',   secret: 'cf_•••••2Yk',       tags: ['dns','edge'], updated: '2026-04-22' },
  { id: 'v4',  label: 'Notion',     category: 'docs',     user: 's@se77n.com',   secret: 'ntn_•••••P9a',      tags: ['team'],       updated: '2026-04-01' },
  { id: 'v5',  label: 'Figma',      category: 'design',   user: 's@se77n.com',   secret: 'fig_•••••H4t',      tags: ['design'],     updated: '2026-03-18' },
  { id: 'v6',  label: 'Spotify',    category: 'media',    user: 's@se77n.com',   secret: '••••••Lp2x9k',      tags: ['music'],      updated: '2026-02-28' },
  { id: 'v7',  label: 'Cursor',     category: 'ai',       user: 's@se77n.com',   secret: 'cur_•••••AbE',      tags: ['ai','ide'],   updated: '2026-04-30' },
  { id: 'v8',  label: 'Anthropic',  category: 'ai',       user: 's@se77n.com',   secret: 'sk-ant-•••••3Qa',   tags: ['claude'],     updated: '2026-05-02' },
  { id: 'v9',  label: 'OpenAI',     category: 'ai',       user: 's@se77n.com',   secret: 'sk-•••••YxKp',      tags: ['gpt'],        updated: '2026-04-11' },
  { id: 'v10', label: 'AWS Root',   category: 'infra',    user: 'root@se77n',    secret: 'aws_•••••V8w',      tags: ['root','2fa'], updated: '2026-01-21' },
  { id: 'v11', label: 'Discord',    category: 'social',   user: 'se77n#0007',    secret: '••••••disc1n',      tags: ['social'],     updated: '2026-04-18' },
  { id: 'v12', label: 'X / Twitter',category: 'social',   user: '@se77n',        secret: '••••••twX9z',       tags: ['social'],     updated: '2026-03-12' },
];

export function copyText(t) {
  try {
    navigator.clipboard?.writeText(t);
  } catch {
    /* clipboard unavailable */
  }
}

// Re-export hooks used widely so feature files only import from lib
export { useState, useEffect, useMemo };
