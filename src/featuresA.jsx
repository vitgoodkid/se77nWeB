import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  COLORS, CITIES,
  Panel, Btn, Field, Pill, Kicker,
  useSyncedData, usePasteImage, copyText, useLang, useMediaQuery,
} from './lib.jsx';

// ═════════════════════════════════════════════════════════════
// 1. AI PLAYGROUND — chat (Gemini via yunwu) + image/video (fal.ai)
// ═════════════════════════════════════════════════════════════
const AI_PRESETS = [
  {
    id: 'chat', kind: 'chat', label: 'Free chat', icon: '∞',
    system: 'You are se77n, a thoughtful warm AI partner. Respond conversationally in the user\'s language. Be concise.',
    placeholder: 'Ask me anything…',
    seed: 'Hi! I\'m running on Gemini 3.1 via yunwu. Ask me anything.',
  },
  {
    id: 'tr', kind: 'chat', label: 'Translator', icon: '⇄',
    system: 'You are a precise translator. Detect the source language, then translate to the OTHER between Vietnamese and English. Output ONLY the translation — no quotes, no commentary. Preserve names, code, and formatting.',
    placeholder: 'Paste text (EN ⇄ VN auto-detect)…',
    seed: 'Paste English or Vietnamese — I\'ll auto-detect and translate to the other.',
  },
  {
    id: 'tldr', kind: 'chat', label: 'TL;DR', icon: '≡',
    system: 'You are a summarizer. Given any text, produce a TL;DR: 3 short bullet points, plain language, no preamble. Then a one-line takeaway.',
    placeholder: 'Paste an article, paper, or long message…',
    seed: 'Drop any long text and I\'ll give you a 3-bullet TL;DR + one-line takeaway.',
  },
  {
    id: 'code', kind: 'chat', label: 'Code helper', icon: '</>',
    system: 'You are a senior engineer. Read code or specs and respond with (1) a tight diagnosis, (2) the minimal fix as a code block, (3) a one-line "why". Skip pleasantries.',
    placeholder: 'Paste a snippet, error, or describe a bug…',
    seed: 'Paste code, an error, or describe the bug. I\'ll diagnose + give you the minimal fix.',
  },
  {
    id: 'image', kind: 'image', label: 'Image gen', icon: '◧',
    placeholder: 'Describe the image, or upload one + describe the edit…',
    seed: 'Drop a prompt (and optionally an image to edit). I\'ll render via fal.ai gpt-image-2.',
  },
  {
    id: 'video', kind: 'video', label: 'Video gen', icon: '▷',
    placeholder: 'Describe the video clip…',
    seed: 'Prompt → 5s clip via fal.ai seedance-2.0. With image input I switch to image-to-video.',
  },
  {
    id: 'bg', kind: 'bg-remove', label: 'BG Remove', icon: '⊘',
    placeholder: 'Attach an image (paperclip or paste) — no prompt needed.',
    seed: 'Drop an image and I\'ll erase the background via fal.ai ideogram/remove-background.',
  },
];

export function AIPlayground() {
  const { t } = useLang();
  const isMobile = useMediaQuery('(max-width: 768px)');
  const [presetId, setPresetId] = useSyncedData(
    { localKey: 'se77n.ai.preset', serverKey: 'aiPreset' },
    'chat',
  );
  const rawPreset = AI_PRESETS.find((p) => p.id === presetId) || AI_PRESETS[0];
  const preset = {
    ...rawPreset,
    label:       t('ai.preset.' + rawPreset.id + '.label'),
    placeholder: t('ai.preset.' + rawPreset.id + '.placeholder'),
    seed:        t('ai.preset.' + rawPreset.id + '.seed'),
  };
  const [history, setHistory] = useSyncedData(
    { localKey: 'se77n.ai.history.v2', serverKey: 'aiHistory' },
    {},
  );
  const messages = history[presetId] || [];
  const [input, setInput] = useState('');
  const [imgRef, setImgRef] = useState(null); // { dataUrl, name }
  const [busy, setBusy] = useState(false);
  const [videoOpts, setVideoOpts] = useSyncedData(
    { localKey: 'se77n.ai.videoOpts', serverKey: 'aiVideoOpts' },
    { duration: 5, resolution: '720p', aspectRatio: '16:9', generateAudio: false },
  );
  const [imageEngine, setImageEngine] = useSyncedData(
    { localKey: 'se77n.ai.imageEngine', serverKey: 'aiImageEngine' },
    'openai',
  );
  const scrollRef = useRef(null);

  // Clipboard paste
  const handlePaste = useCallback((img) => setImgRef(img), []);
  usePasteImage(handlePaste, true);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length, busy]);

  function setMessages(next) {
    setHistory((h) => ({ ...h, [presetId]: typeof next === 'function' ? next(h[presetId] || []) : next }));
  }

  // Read a fetch Response safely: try JSON, fall back to text, never throw
  // the cryptic "Unexpected end of JSON input" — give the caller something usable.
  async function safeJson(res, label) {
    const raw = await res.text();
    let data = null;
    if (raw) {
      try { data = JSON.parse(raw); } catch { /* not JSON */ }
    }
    if (!res.ok) {
      const msg =
        data?.error ||
        data?.message ||
        (raw && raw.length < 200 ? raw : '') ||
        (res.status === 504 ? 'timeout — try a shorter prompt' : `${label} ${res.status}`);
      throw new Error(msg);
    }
    if (!data) throw new Error(`${label}: empty response from server`);
    return data;
  }

  // When the API returns { pending: true, requestId, statusUrl }, poll until ready.
  // statusUrl is a relative path the server constructs, e.g. /api/image?requestId=...&model=...
  // Long cap because seedance video gen + nano-banana-pro both regularly run 2–5 min.
  async function pollMedia(initial, kind) {
    if (!initial?.pending || !initial.statusUrl) {
      throw new Error(`${kind}: missing url and not pending`);
    }
    const url = initial.statusUrl;
    const deadline = Date.now() + 10 * 60_000; // 10 min absolute cap
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5000));
      const res = await fetch(url);
      const data = await safeJson(res, kind);
      if (data[kind]) return data[kind];
      if (!data.pending) throw new Error(`${kind}: unexpected response`);
    }
    throw new Error(`${kind}: still rendering after 10 min — try a shorter prompt`);
  }

  async function send() {
    const q = input.trim();
    if ((!q && !imgRef) || busy) return;

    const userMsg = { role: 'user', content: q || '(no prompt)', image: imgRef?.dataUrl };
    setInput('');
    const usedImage = imgRef;
    setImgRef(null);
    setMessages((m) => [...m, userMsg]);
    setBusy(true);

    try {
      let assistantMsg;
      if (preset.kind === 'chat') {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ system: preset.system, prompt: q, image: usedImage?.dataUrl }),
        });
        const data = await safeJson(res, 'chat');
        assistantMsg = { role: 'assistant', content: data.text };
      } else if (preset.kind === 'image') {
        const res = await fetch('/api/image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: q, image: usedImage?.dataUrl, engine: imageEngine }),
        });
        const data = await safeJson(res, 'image');
        const finalUrl = data.image || await pollMedia(data, 'image');
        assistantMsg = { role: 'assistant', content: '', image: finalUrl };
      } else if (preset.kind === 'video') {
        const res = await fetch('/api/video', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: q,
            image: usedImage?.dataUrl,
            duration: videoOpts.duration,
            resolution: videoOpts.resolution,
            aspectRatio: videoOpts.aspectRatio,
            generateAudio: videoOpts.generateAudio,
          }),
        });
        const data = await safeJson(res, 'video');
        const finalUrl = data.video || await pollMedia(data, 'video');
        assistantMsg = { role: 'assistant', content: '', video: finalUrl };
      } else if (preset.kind === 'bg-remove') {
        if (!usedImage) throw new Error('attach an image first');
        const res = await fetch('/api/bg-remove', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: usedImage.dataUrl }),
        });
        const data = await safeJson(res, 'bg-remove');
        assistantMsg = { role: 'assistant', content: '', image: data.image };
      }
      setMessages((m) => [...m, assistantMsg]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: '⚠ ' + (e.message || 'Connection wobble. Try again?') }]);
    } finally {
      setBusy(false);
    }
  }

  function clearChat() {
    setMessages([]);
  }

  function onImageRef(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = (ev) => setImgRef({ name: f.name, dataUrl: ev.target.result });
    reader.readAsDataURL(f);
  }

  const acceptImage = true; // every preset can take an image (chat = vision, others = source)

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: isMobile ? '1fr' : '260px 1fr',
      gridTemplateRows: isMobile ? 'auto 1fr' : 'auto',
      gap: isMobile ? 12 : 18,
      height: '100%',
    }}>
      {isMobile ? (
        // Compact horizontal preset chip rail on mobile.
        <Panel padding={10} style={{ overflow: 'hidden' }}>
          <div style={{
            display: 'flex', gap: 6, overflowX: 'auto', WebkitOverflowScrolling: 'touch',
            scrollbarWidth: 'none', msOverflowStyle: 'none',
          }}>
            {AI_PRESETS.map((p) => {
              const active = p.id === presetId;
              const label = t('ai.preset.' + p.id + '.label');
              return (
                <button
                  key={p.id}
                  onClick={() => setPresetId(p.id)}
                  className="mono"
                  style={{
                    flexShrink: 0,
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                    padding: '8px 12px', borderRadius: 999,
                    border: '1px solid ' + (active ? COLORS.red + '55' : COLORS.line),
                    background: active ? COLORS.red + '14' : 'transparent',
                    color: active ? COLORS.text : COLORS.muted,
                    cursor: 'pointer', fontSize: 11, letterSpacing: '0.04em',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span style={{
                    color: active ? COLORS.red : COLORS.muted, fontSize: 12, fontWeight: 700,
                  }}>{p.icon}</span>
                  {label}
                </button>
              );
            })}
          </div>
        </Panel>
      ) : (
      <Panel padding={16} style={{ display: 'flex', flexDirection: 'column' }}>
        <Kicker style={{ marginBottom: 14 }}>PRESETS · {String(AI_PRESETS.length).padStart(2, '0')}</Kicker>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {AI_PRESETS.map((p) => {
            const active = p.id === presetId;
            const label = t('ai.preset.' + p.id + '.label');
            return (
              <button
                key={p.id}
                onClick={() => setPresetId(p.id)}
                className="mono"
                style={{
                  textAlign: 'left',
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '11px 12px', borderRadius: 10,
                  border: '1px solid ' + (active ? COLORS.red + '55' : 'transparent'),
                  background: active ? COLORS.red + '14' : 'transparent',
                  color: active ? COLORS.text : COLORS.muted,
                  cursor: 'pointer', fontSize: 12, letterSpacing: '0.04em',
                  transition: 'background 120ms',
                }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{
                  width: 28, height: 28, display: 'grid', placeItems: 'center',
                  border: `1px solid ${active ? COLORS.red : COLORS.line}`, borderRadius: 8,
                  color: active ? COLORS.red : COLORS.muted, fontSize: 13, fontWeight: 700,
                }}>{p.icon}</span>
                {label}
              </button>
            );
          })}
        </div>
        <div style={{ flex: 1 }} />
      </Panel>
      )}

      <Panel padding={0} style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid ' + COLORS.line,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 0, flexWrap: 'wrap' }}>
            <div>
              <Kicker>SESSION · {presetId.toUpperCase()}</Kicker>
              <div className="mono" style={{ fontSize: 16, fontWeight: 700, marginTop: 4 }}>{preset.label}</div>
            </div>
            {preset.kind === 'image' && (
              <ModelSwap
                label="MODEL"
                value={imageEngine}
                onChange={setImageEngine}
                options={IMAGE_ENGINES}
              />
            )}
          </div>
          <Btn onClick={clearChat} variant="ghost">{t('ai.clear')}</Btn>
        </div>
        <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
          {messages.length === 0 && (
            <div style={{
              padding: '20px 22px', background: COLORS.bg,
              border: '1px solid ' + COLORS.line, borderRadius: 12, maxWidth: 560,
            }}>
              <Kicker style={{ color: COLORS.red, marginBottom: 8 }}>se77n ::</Kicker>
              <div style={{ fontSize: 14, lineHeight: 1.6 }}>{preset.seed}</div>
            </div>
          )}
          {messages.map((m, i) => (
            <Message key={i} role={m.role} content={m.content} image={m.image} video={m.video} />
          ))}
          {busy && <Message role="assistant" content="…" typing kind={preset.kind} />}
        </div>
        {preset.kind === 'video' && (
          <VideoOptionsBar opts={videoOpts} onChange={setVideoOpts} />
        )}
        {imgRef && (
          <AttachmentChip imgRef={imgRef} onRemove={() => setImgRef(null)} />
        )}
        <div style={{
          padding: '14px 18px', borderTop: '1px solid ' + COLORS.line,
          background: COLORS.panel2, display: 'flex', gap: 10, alignItems: 'center',
        }}>
          <span className="mono" style={{ color: COLORS.red, fontSize: 13 }}>{'>'}</span>
          {acceptImage && (
            <label
              title={imgRef ? imgRef.name : 'attach image'}
              style={{
                display: 'grid', placeItems: 'center', width: 36, height: 36, borderRadius: 8,
                background: imgRef ? COLORS.gold + '1a' : 'transparent',
                border: `1px solid ${imgRef ? COLORS.gold : COLORS.line}`,
                color: imgRef ? COLORS.gold : COLORS.muted, cursor: 'pointer',
                fontFamily: 'JetBrains Mono, monospace', fontSize: 14,
              }}>
              <input type="file" accept="image/*" onChange={onImageRef} style={{ display: 'none' }} />
              {imgRef ? '◉' : '◇'}
            </label>
          )}
          <Field
            value={input}
            onChange={setInput}
            placeholder={preset.placeholder}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            autoFocus
            style={{ background: COLORS.bg }}
          />
          <Btn variant="solid" onClick={send} disabled={busy || (!input.trim() && !imgRef)}>↗ {t('ai.send')}</Btn>
        </div>
      </Panel>
    </div>
  );
}

// Video gen options bar — duration / resolution / aspect ratio / audio toggle.
// Persisted via useSyncedData (see videoOpts state above).
const VIDEO_DURATIONS = [8, 10, 15];
const VIDEO_RESOLUTIONS = ['480p', '720p', '1080p'];
const VIDEO_ASPECTS = ['16:9', '9:16', '1:1', '21:9'];

const IMAGE_ENGINES = [
  { v: 'openai', l: 'GPT-IMAGE-2' },
  { v: 'nano',   l: 'NANO-BANANA-PRO' },
];

// Animated dropdown — uses CSS transitions on opacity + transform for the
// flip-card feel from the GSAP reference. Lightweight, no GSAP dep.
function ModelSwap({ label, value, onChange, options }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const current = options.find((o) => o.v === value) || options[0];

  // Click-outside to close.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div ref={wrapRef} style={{
      position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 8,
      flexShrink: 0,
    }}>
      <span className="mono" style={{
        fontSize: 9, letterSpacing: '0.22em', color: COLORS.muted,
      }}>{label}</span>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mono"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '6px 12px', borderRadius: 999,
          background: open ? COLORS.gold + '24' : COLORS.gold + '14',
          border: `1px solid ${COLORS.gold}80`,
          color: COLORS.gold, cursor: 'pointer',
          fontSize: 11, letterSpacing: '0.14em',
          fontFamily: 'JetBrains Mono, monospace',
          whiteSpace: 'nowrap',
          transition: 'background 180ms ease, transform 180ms ease',
          transform: open ? 'translateY(-1px)' : 'translateY(0)',
        }}
      >
        <span style={{
          width: 6, height: 6, borderRadius: 999,
          background: COLORS.gold, flexShrink: 0,
          boxShadow: `0 0 8px ${COLORS.gold}`,
        }} />
        {current.l}
        <span style={{
          fontSize: 9, opacity: 0.7,
          transition: 'transform 220ms ease',
          transform: open ? 'rotate(180deg)' : 'rotate(0)',
        }}>▾</span>
      </button>
      <div
        style={{
          position: 'absolute', left: 0, top: 'calc(100% + 6px)', zIndex: 30,
          minWidth: 210,
          background: COLORS.panel, border: '1px solid ' + COLORS.line,
          borderRadius: 10, padding: 4,
          boxShadow: '0 12px 30px rgba(0,0,0,0.5)',
          opacity: open ? 1 : 0,
          transform: open ? 'translateY(0) scale(1)' : 'translateY(-6px) scale(0.96)',
          transformOrigin: 'top left',
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 180ms ease, transform 180ms ease',
        }}
      >
        {options.map((o, i) => {
          const on = o.v === value;
          return (
            <button
              key={o.v}
              type="button"
              onClick={() => { onChange(o.v); setOpen(false); }}
              className="mono"
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '8px 12px', borderRadius: 7,
                background: on ? COLORS.gold + '1f' : 'transparent',
                color: on ? COLORS.gold : COLORS.text,
                border: 'none', cursor: 'pointer',
                fontSize: 12, letterSpacing: '0.06em',
                opacity: open ? 1 : 0,
                transform: open ? 'translateX(0)' : 'translateX(-6px)',
                transition: `opacity 220ms ease ${i * 30}ms, transform 220ms ease ${i * 30}ms, background 120ms ease`,
              }}
              onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = 'rgba(245,237,224,0.05)'; }}
              onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = 'transparent'; }}
            >
              {o.l}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Pill above the composer: thumbnail + filename + × so users can see at a glance
// what they've attached, instead of just the gold dot on the paperclip.
function AttachmentChip({ imgRef, onRemove }) {
  const truncate = (s, n = 28) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || 'pasted-image.png');
  return (
    <div style={{
      padding: '8px 18px', borderTop: '1px solid ' + COLORS.line,
      background: COLORS.bg, display: 'flex', alignItems: 'center',
    }}>
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 10,
        padding: '6px 10px 6px 6px', borderRadius: 999,
        background: 'rgba(212,168,88,0.08)',
        border: `1px solid ${COLORS.gold}55`,
      }}>
        <img
          src={imgRef.dataUrl}
          alt={imgRef.name || 'attachment'}
          style={{
            width: 28, height: 28, borderRadius: 999, objectFit: 'cover',
            display: 'block', flexShrink: 0,
            border: '1px solid ' + COLORS.line,
          }}
        />
        <span className="mono" style={{
          fontSize: 11, letterSpacing: '0.04em', color: COLORS.gold,
        }}>{truncate(imgRef.name)}</span>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove attachment"
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: COLORS.gold, fontSize: 14, lineHeight: 1, padding: '0 4px',
          }}
        >×</button>
      </div>
    </div>
  );
}

function VideoOptionsBar({ opts, onChange }) {
  const set = (patch) => onChange({ ...opts, ...patch });
  return (
    <div style={{
      padding: '10px 18px', borderTop: '1px solid ' + COLORS.line,
      display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center',
      background: COLORS.bg, fontSize: 11,
    }}>
      <PillGroup label="DURATION" value={opts.duration} onChange={(v) => set({ duration: v })}
        options={VIDEO_DURATIONS.map((s) => ({ v: s, l: `${s}s` }))} />
      <PillGroup label="RES" value={opts.resolution} onChange={(v) => set({ resolution: v })}
        options={VIDEO_RESOLUTIONS.map((r) => ({ v: r, l: r }))} />
      <PillGroup label="ASPECT" value={opts.aspectRatio} onChange={(v) => set({ aspectRatio: v })}
        options={VIDEO_ASPECTS.map((a) => ({ v: a, l: a }))} />
      <button
        type="button"
        onClick={() => set({ generateAudio: !opts.generateAudio })}
        className="mono"
        style={{
          padding: '5px 12px', borderRadius: 999,
          background: opts.generateAudio ? COLORS.gold + '1f' : 'transparent',
          border: '1px solid ' + (opts.generateAudio ? COLORS.gold + '80' : COLORS.line),
          color: opts.generateAudio ? COLORS.gold : COLORS.muted,
          fontSize: 10, letterSpacing: '0.18em', cursor: 'pointer',
        }}
        title="Generate audio track with the video"
      >
        ♪ AUDIO {opts.generateAudio ? 'ON' : 'OFF'}
      </button>
    </div>
  );
}

function PillGroup({ label, value, onChange, options }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span className="mono" style={{ fontSize: 9, letterSpacing: '0.2em', color: COLORS.muted }}>{label}</span>
      <div style={{ display: 'inline-flex', border: '1px solid ' + COLORS.line, borderRadius: 8, overflow: 'hidden' }}>
        {options.map((o) => {
          const on = String(value) === String(o.v);
          return (
            <button
              key={o.v}
              type="button"
              onClick={() => onChange(o.v)}
              className="mono"
              style={{
                padding: '5px 10px', cursor: 'pointer',
                background: on ? COLORS.gold + '1f' : 'transparent',
                color: on ? COLORS.gold : COLORS.muted,
                border: 'none', fontSize: 10, letterSpacing: '0.14em',
              }}
            >{o.l}</button>
          );
        })}
      </div>
    </div>
  );
}

function Message({ role, content, image, video, typing, kind }) {
  const isUser = role === 'user';
  return (
    <div style={{
      display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start',
      margin: '12px 0', animation: 'fadeUp 200ms ease-out',
    }}>
      <div style={{
        maxWidth: '78%', padding: '12px 16px', borderRadius: 12,
        background: isUser ? COLORS.red + '14' : COLORS.bg,
        border: `1px solid ${isUser ? COLORS.red + '40' : COLORS.line}`,
        whiteSpace: 'pre-wrap', fontSize: 13.5, lineHeight: 1.6,
        fontFamily: isUser ? "'JetBrains Mono', monospace" : "'Geist', system-ui, sans-serif",
        color: COLORS.text,
      }}>
        {!isUser && (
          <div className="mono" style={{
            fontSize: 9, letterSpacing: '0.2em', color: COLORS.red, marginBottom: 6,
          }}>se77n ::</div>
        )}
        {image && (
          <img src={image} alt="" style={{ display: 'block', maxWidth: '100%', borderRadius: 8, marginBottom: content ? 8 : 0 }} />
        )}
        {video && (
          <video src={video} controls style={{ display: 'block', maxWidth: '100%', borderRadius: 8, marginBottom: content ? 8 : 0 }} />
        )}
        {typing ? <TypingDots kind={kind} /> : content}
      </div>
    </div>
  );
}

function TypingDots({ kind }) {
  if (kind === 'image' || kind === 'video') {
    return (
      <span className="mono" style={{ fontSize: 11, color: COLORS.muted, letterSpacing: '0.1em' }}>
        ◇ rendering · {kind === 'video' ? 'this can take 30–60s' : 'a few seconds'}…
      </span>
    );
  }
  return (
    <span style={{ display: 'inline-flex', gap: 4 }}>
      {[0, 1, 2].map((i) => (
        <span key={i} style={{
          width: 6, height: 6, borderRadius: 999, background: COLORS.text,
          opacity: 0.45, animation: `pulse 1s ease-in-out ${i * 0.15}s infinite`,
        }} />
      ))}
    </span>
  );
}

// ═════════════════════════════════════════════════════════════
// 2. TOOLBOX — Public / Private (PIN 7777)
// ═════════════════════════════════════════════════════════════
const PUBLIC_TOOLS = [
  { id: 'short', name: 'Rút gọn link',     desc: 'URL shortener với custom alias', icon: '/' },
  { id: 'pst',   name: 'Pastebin',         desc: 'Quick share snippets / notes',   icon: '¶' },
  { id: 'game',  name: 'Game resources',   desc: 'Cheat sheets, mods, saves',      icon: '◉' },
  { id: 'imgc',  name: 'Image Converter',  desc: 'PNG/JPG/WebP + compressor',      icon: '◐' },
  { id: 'v2g',   name: 'Video → GIF / MP3',desc: 'Extract clips và audio',         icon: '▶' },
];
const PRIVATE_TOOLS = [
  { id: 'srv', name: 'Server',      desc: 'Home lab dashboard',  icon: '⌬' },
  { id: 'pp',  name: 'Hộ chiếu số', desc: 'Identity vault',      icon: '⌘' },
  { id: 'fin', name: 'Tài chính',   desc: 'Net worth + tracking',icon: '$' },
];

export function Toolbox() {
  const [tab, setTab] = useState('public');
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState(false);
  const [activeTool, setActiveTool] = useState(null);

  function tryUnlock() {
    if (pin === '7777') {
      setUnlocked(true);
      setErr(false);
    } else {
      setErr(true);
      setTimeout(() => setErr(false), 600);
      setPin('');
    }
  }

  const tools = tab === 'public' ? PUBLIC_TOOLS : PRIVATE_TOOLS;
  const accent = tab === 'public' ? COLORS.green : COLORS.red;

  return (
    <Panel padding={0} style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{
        padding: '16px 20px', borderBottom: '1px solid ' + COLORS.line,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {['public', 'private'].map((k) => {
            const active = tab === k;
            const c = k === 'public' ? COLORS.green : COLORS.red;
            return (
              <button
                key={k}
                onClick={() => { setTab(k); setActiveTool(null); }}
                className="mono"
                style={{
                  padding: '10px 18px', borderRadius: 10,
                  background: active ? c + '14' : 'transparent',
                  border: `1px solid ${active ? c + '55' : 'transparent'}`,
                  color: active ? c : COLORS.muted,
                  fontSize: 11, letterSpacing: '0.14em',
                  textTransform: 'uppercase', fontWeight: 700, cursor: 'pointer',
                }}
              >
                {k} {k === 'private' && !unlocked && '🔒'}
              </button>
            );
          })}
        </div>
        <Kicker>{tools.length.toString().padStart(2, '0')} TOOLS</Kicker>
      </div>

      <div style={{ flex: 1, padding: 24, overflow: 'auto' }}>
        {tab === 'private' && !unlocked ? (
          <div style={{ display: 'grid', placeItems: 'center', minHeight: 360, animation: 'fadeUp 250ms ease-out' }}>
            <div style={{
              padding: 36, textAlign: 'center', border: '1px solid ' + COLORS.line,
              borderRadius: 16, background: COLORS.bg, maxWidth: 360,
              animation: err ? 'shake 350ms ease' : 'none',
            }}>
              <div style={{
                width: 56, height: 56, margin: '0 auto 16px', borderRadius: 999,
                display: 'grid', placeItems: 'center',
                background: COLORS.red + '14', border: `1px solid ${COLORS.red}55`,
                fontSize: 24, color: COLORS.red,
              }}>🔒</div>
              <div className="mono" style={{
                fontSize: 13, letterSpacing: '0.18em', textTransform: 'uppercase',
                color: COLORS.text, fontWeight: 700, marginBottom: 6,
              }}>Private zone</div>
              <div style={{ fontSize: 12, color: COLORS.muted, marginBottom: 22, lineHeight: 1.5 }}>
                Nhập 4-digit PIN để mở khu vực private.
              </div>
              <Field
                value={pin}
                onChange={(v) => setPin(v.replace(/\D/g, '').slice(0, 4))}
                placeholder="• • • •"
                type="password"
                onKeyDown={(e) => { if (e.key === 'Enter') tryUnlock(); }}
                style={{
                  textAlign: 'center', fontSize: 22, letterSpacing: '0.5em',
                  padding: '14px 16px', borderColor: err ? COLORS.red : COLORS.line,
                }}
                autoFocus
              />
              <div style={{ marginTop: 16 }}>
                <Btn variant="solid" onClick={tryUnlock} style={{ width: '100%' }}>Unlock</Btn>
              </div>
              {err && (
                <div className="mono" style={{ fontSize: 10, color: COLORS.red, marginTop: 12, letterSpacing: '0.12em' }}>
                  ✕ INVALID PIN
                </div>
              )}
            </div>
          </div>
        ) : activeTool ? (
          <ToolDetail tool={activeTool} accent={accent} onBack={() => setActiveTool(null)} />
        ) : (
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 14, animation: 'fadeUp 200ms ease-out',
          }}>
            {tools.map((tool) => (
              <button
                key={tool.id}
                onClick={() => setActiveTool(tool)}
                style={{
                  textAlign: 'left', padding: 18,
                  border: '1px solid ' + COLORS.line, borderRadius: 12,
                  background: COLORS.bg, cursor: 'pointer',
                  transition: 'transform 120ms, border-color 120ms, background 120ms',
                  display: 'flex', flexDirection: 'column', gap: 14, color: COLORS.text,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.borderColor = accent + '60';
                  e.currentTarget.style.background = accent + '0a';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.borderColor = COLORS.line;
                  e.currentTarget.style.background = COLORS.bg;
                }}
              >
                <div style={{
                  width: 40, height: 40, display: 'grid', placeItems: 'center',
                  borderRadius: 10, border: `1px solid ${accent}55`,
                  color: accent, fontSize: 18, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700,
                }}>{tool.icon}</div>
                <div>
                  <div className="mono" style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    {tool.name}
                  </div>
                  <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 4, lineHeight: 1.4 }}>
                    {tool.desc}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}

function ToolDetail({ tool, accent, onBack }) {
  return (
    <div style={{ animation: 'fadeUp 200ms ease-out' }}>
      <div style={{ marginBottom: 18, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Btn onClick={onBack} variant="ghost">← Back</Btn>
        <div>
          <Kicker style={{ color: accent }}>{tool.icon} · TOOL</Kicker>
          <div className="mono" style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>{tool.name}</div>
        </div>
      </div>
      <div style={{
        border: '1px solid ' + COLORS.line, borderRadius: 12, padding: 22, background: COLORS.bg,
      }}>
        {tool.id === 'short' ? <ShortenerTool accent={accent} /> :
         tool.id === 'pst'   ? <PastebinTool accent={accent} /> :
         tool.id === 'imgc'  ? <ImageConverterTool accent={accent} /> :
         tool.id === 'v2g'   ? <VideoToTool accent={accent} /> :
         tool.id === 'fin'   ? <FinanceTool accent={accent} /> :
         <PlaceholderTool tool={tool} accent={accent} />}
      </div>
    </div>
  );
}

function ShortenerTool({ accent }) {
  const [url, setUrl] = useState('');
  const [alias, setAlias] = useState('');
  const [out, setOut] = useState(null);
  function shorten() {
    if (!url.trim()) return;
    const slug = alias || Math.random().toString(36).slice(2, 8);
    setOut(`se7.tn/${slug}`);
  }
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div>
        <Kicker style={{ marginBottom: 8 }}>LONG URL</Kicker>
        <Field value={url} onChange={setUrl} placeholder="https://…" />
      </div>
      <div>
        <Kicker style={{ marginBottom: 8 }}>CUSTOM ALIAS (optional)</Kicker>
        <Field value={alias} onChange={setAlias} placeholder="my-link" />
      </div>
      <div><Btn variant="solid" color={accent} onClick={shorten}>Shorten</Btn></div>
      {out && (
        <div style={{
          padding: 16, borderRadius: 10, border: `1px solid ${accent}55`,
          background: accent + '0e',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        }}>
          <div className="mono" style={{ fontSize: 14, color: accent, fontWeight: 700 }}>{out}</div>
          <Btn variant="tinted" color={accent} onClick={() => copyText(out)}>Copy</Btn>
        </div>
      )}
    </div>
  );
}

function PastebinTool({ accent }) {
  const [text, setText] = useState('');
  const [saved, setSaved] = useState(null);
  function save() {
    if (!text.trim()) return;
    const id = Math.random().toString(36).slice(2, 8);
    setSaved({ id, url: `se7.tn/p/${id}`, len: text.length });
  }
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <Kicker>PASTE CONTENT</Kicker>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={9}
        className="mono"
        placeholder="Drop your snippet, log, or note here…"
        style={{
          width: '100%', background: COLORS.bg, border: '1px solid ' + COLORS.line,
          borderRadius: 10, padding: 14, color: COLORS.text, fontSize: 12,
          resize: 'vertical', outline: 'none',
        }}
      />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <Btn variant="solid" color={accent} onClick={save}>Save paste</Btn>
        <span className="mono" style={{ fontSize: 10, color: COLORS.muted }}>{text.length} chars</span>
      </div>
      {saved && (
        <div style={{
          padding: 14, borderRadius: 10, border: `1px solid ${accent}55`,
          background: accent + '0e', display: 'flex', justifyContent: 'space-between',
        }}>
          <div className="mono" style={{ fontSize: 13, color: accent }}>{saved.url}</div>
          <Btn variant="tinted" color={accent} onClick={() => copyText(saved.url)}>Copy</Btn>
        </div>
      )}
    </div>
  );
}

function ImageConverterTool({ accent }) {
  const [src, setSrc] = useState(null);
  const [target, setTarget] = useState('webp');
  const [quality, setQuality] = useState(80);

  function onFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = (ev) => setSrc({ name: f.name, size: f.size, dataUrl: ev.target.result });
    reader.readAsDataURL(f);
  }
  function download() {
    if (!src) return;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      c.getContext('2d').drawImage(img, 0, 0);
      const mime = target === 'jpg' ? 'image/jpeg' : target === 'webp' ? 'image/webp' : 'image/png';
      c.toBlob((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = src.name.replace(/\.[^.]+$/, '') + '.' + target;
        a.click();
      }, mime, quality / 100);
    };
    img.src = src.dataUrl;
  }
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Kicker>UPLOAD IMAGE</Kicker>
      <label style={{
        padding: 32, textAlign: 'center', borderRadius: 12,
        border: `2px dashed ${COLORS.line}`, cursor: 'pointer', background: COLORS.bg,
      }}>
        <input type="file" accept="image/*" onChange={onFile} style={{ display: 'none' }} />
        {src ? (
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', justifyContent: 'center' }}>
            <img src={src.dataUrl} style={{ height: 80, borderRadius: 8 }} alt="" />
            <div style={{ textAlign: 'left' }}>
              <div className="mono" style={{ fontSize: 12, fontWeight: 700 }}>{src.name}</div>
              <div className="mono" style={{ fontSize: 10, color: COLORS.muted, marginTop: 4 }}>
                {(src.size / 1024).toFixed(1)} KB
              </div>
            </div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 28, color: COLORS.muted, marginBottom: 8 }}>◐</div>
            <div className="mono" style={{ fontSize: 12, color: COLORS.muted, letterSpacing: '0.1em' }}>
              CLICK TO BROWSE
            </div>
          </div>
        )}
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div>
          <Kicker style={{ marginBottom: 8 }}>TARGET FORMAT</Kicker>
          <div style={{ display: 'flex', gap: 6 }}>
            {['webp', 'jpg', 'png'].map((f) => (
              <Btn key={f} variant={target === f ? 'tinted' : 'ghost'} color={accent} onClick={() => setTarget(f)}>
                {f.toUpperCase()}
              </Btn>
            ))}
          </div>
        </div>
        <div>
          <Kicker style={{ marginBottom: 8 }}>QUALITY · {quality}</Kicker>
          <input
            type="range" min="20" max="100" value={quality}
            onChange={(e) => setQuality(+e.target.value)}
            style={{ width: '100%', accentColor: accent }}
          />
        </div>
      </div>
      <Btn variant="solid" color={accent} onClick={download} disabled={!src}>Convert & Download</Btn>
    </div>
  );
}

function VideoToTool({ accent }) {
  const [src, setSrc] = useState(null);
  const [mode, setMode] = useState('gif');
  function onFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setSrc({ name: f.name, size: f.size, url: URL.createObjectURL(f) });
  }
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Kicker>UPLOAD VIDEO</Kicker>
      <label style={{
        padding: 32, textAlign: 'center', borderRadius: 12,
        border: `2px dashed ${COLORS.line}`, cursor: 'pointer', background: COLORS.bg,
      }}>
        <input type="file" accept="video/*" onChange={onFile} style={{ display: 'none' }} />
        {src ? (
          <div>
            <video src={src.url} controls style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 8 }} />
            <div className="mono" style={{ fontSize: 11, color: COLORS.muted, marginTop: 8 }}>
              {src.name} · {(src.size / 1024 / 1024).toFixed(2)} MB
            </div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 28, color: COLORS.muted, marginBottom: 8 }}>▶</div>
            <div className="mono" style={{ fontSize: 12, color: COLORS.muted, letterSpacing: '0.1em' }}>
              CLICK TO BROWSE
            </div>
          </div>
        )}
      </label>
      <div>
        <Kicker style={{ marginBottom: 8 }}>EXTRACT AS</Kicker>
        <div style={{ display: 'flex', gap: 6 }}>
          {[['gif', 'GIF (clip)'], ['mp3', 'MP3 (audio)']].map(([k, lbl]) => (
            <Btn key={k} variant={mode === k ? 'tinted' : 'ghost'} color={accent} onClick={() => setMode(k)}>
              {lbl}
            </Btn>
          ))}
        </div>
      </div>
      <div style={{
        padding: 14, borderRadius: 10, background: COLORS.bg,
        border: '1px solid ' + COLORS.line, fontSize: 12, color: COLORS.muted, lineHeight: 1.5,
      }} className="mono">
        ◇ Heavy conversion routes through edge worker — drop your file, set the trim window, hit convert. Demo only here.
      </div>
      <Btn variant="solid" color={accent} disabled={!src}>Convert & Download</Btn>
    </div>
  );
}

function FinanceTool({ accent }) {
  const accounts = [
    { name: 'Cash · TWD',   value: 145200,    ccy: 'TWD' },
    { name: 'Cash · VND',   value: 28500000,  ccy: 'VND' },
    { name: 'Cash · USD',   value: 4820,      ccy: 'USD' },
    { name: 'Crypto · BTC', value: 0.137,     ccy: 'BTC' },
    { name: 'Stocks · ETF', value: 12450,     ccy: 'USD' },
  ];
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {accounts.map((a) => (
        <div key={a.name} style={{
          padding: 14, borderRadius: 10, background: COLORS.bg,
          border: '1px solid ' + COLORS.line,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div className="mono" style={{ fontSize: 12 }}>{a.name}</div>
          <div className="mono" style={{ fontSize: 14, fontWeight: 700, color: accent }}>
            {a.value.toLocaleString()}{' '}
            <span style={{ fontSize: 10, color: COLORS.muted, marginLeft: 4 }}>{a.ccy}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function PlaceholderTool({ tool, accent }) {
  return (
    <div style={{ padding: 30, textAlign: 'center', color: COLORS.muted }}>
      <div style={{ fontSize: 36, color: accent, marginBottom: 12 }}>{tool.icon}</div>
      <div className="mono" style={{
        fontSize: 12, letterSpacing: '0.16em', textTransform: 'uppercase',
        color: COLORS.text, marginBottom: 8,
      }}>{tool.name}</div>
      <div style={{ fontSize: 13, maxWidth: 320, margin: '0 auto', lineHeight: 1.5 }}>
        {tool.desc}. Module wired to private API — interactive in production build.
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// 3. TRAVEL ARCHIVE — 5-view: Map · List · Detail · Plan · Expenses
// ═════════════════════════════════════════════════════════════
const T_COLOR = { home: COLORS.gold, visited: COLORS.green, planned: COLORS.red };

const TRIP_META = {
  tpe: { dates: '—',       days: 0, photos: 0,  pins: 1,  tags: ['home'],                budget: null, spend: null },
  sgn: { dates: '2026-01', days: 9, photos: 88, pins: 7,  tags: ['family','food'],        budget: 1200, spend: 980  },
  han: { dates: '2025-06', days: 5, photos: 54, pins: 8,  tags: ['solo','rain'],          budget: 800,  spend: 740  },
  tyo: { dates: '2025-11', days: 6, photos: 42, pins: 12, tags: ['food','solo','photo'],  budget: 630,  spend: 581  },
  osa: { dates: '2025-11', days: 4, photos: 31, pins: 6,  tags: ['food','solo'],          budget: 500,  spend: 460  },
  sel: { dates: '2025-09', days: 4, photos: 31, pins: 8,  tags: ['music','solo'],         budget: 550,  spend: 510  },
  bkk: { dates: '2024-12', days: 5, photos: 45, pins: 9,  tags: ['food','solo'],          budget: 600,  spend: 580  },
  sin: { dates: '2024-08', days: 3, photos: 28, pins: 5,  tags: ['work','hawker'],        budget: 700,  spend: 650  },
  hkg: { dates: '2024-06', days: 3, photos: 22, pins: 4,  tags: ['solo','harbor'],        budget: 550,  spend: 530  },
  kul: { dates: '2026-07', days: 5, photos: 0,  pins: 3,  tags: ['planned'],              budget: 800,  spend: null },
  syd: { dates: '2026-11', days: 7, photos: 0,  pins: 5,  tags: ['coastal','planned'],    budget: 2000, spend: null },
  sfo: { dates: '2026-09', days: 7, photos: 0,  pins: 3,  tags: ['work','planned'],       budget: 2500, spend: null },
  nyc: { dates: '2026-10', days: 5, photos: 0,  pins: 2,  tags: ['planned'],              budget: 2800, spend: null },
  lhr: { dates: '2026-08', days: 7, photos: 0,  pins: 3,  tags: ['draft','planned'],      budget: 3000, spend: null },
  par: { dates: '2027-01', days: 5, photos: 0,  pins: 1,  tags: ['planned'],              budget: 2200, spend: null },
  ber: { dates: '2027-02', days: 5, photos: 0,  pins: 1,  tags: ['music','planned'],      budget: 1800, spend: null },
};
const TRIPS = CITIES.map((c) => ({ ...c, ...(TRIP_META[c.id] || {}) }));

const TVIEWS = [
  { id: 'map',      label: 'MAP',      num: '01' },
  { id: 'list',     label: 'LIST',     num: '02' },
  { id: 'detail',   label: 'DETAIL',   num: '03' },
  { id: 'plan',     label: 'PLAN',     num: '04' },
  { id: 'expenses', label: 'EXPENSES', num: '05' },
];

export function TravelArchive() {
  const [view, setView]           = useState('map');
  const [selectedTrip, setSelected] = useState(TRIPS.find((t) => t.id === 'tyo'));
  const [mapActive, setMapActive] = useState(null);
  const [listFilter, setListFilter] = useState('all');

  function openTrip(trip) { setSelected(trip); setView('detail'); }

  const tripColor = T_COLOR[selectedTrip?.type] || COLORS.gold;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* ── Nav bar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '10px 16px', borderBottom: '1px solid ' + COLORS.line, flexShrink: 0,
      }}>
        {TVIEWS.map(({ id, label, num }) => {
          const on = view === id;
          return (
            <button key={id} onClick={() => setView(id)} className="mono" style={{
              padding: '6px 13px', borderRadius: 999, cursor: 'pointer',
              fontSize: 10, letterSpacing: '0.18em',
              background: on ? COLORS.gold + '1f' : 'transparent',
              border: `1px solid ${on ? COLORS.gold + '80' : COLORS.line}`,
              color: on ? COLORS.gold : COLORS.muted,
              display: 'flex', alignItems: 'center', gap: 7,
            }}>
              <span style={{ opacity: 0.55 }}>{num}</span>{label}
            </button>
          );
        })}
        {selectedTrip && ['detail','plan','expenses'].includes(view) && (
          <div style={{
            marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 11, color: COLORS.muted, fontFamily: 'JetBrains Mono, monospace',
          }}>
            <span style={{ width: 7, height: 7, borderRadius: 999, background: tripColor, flexShrink: 0 }} />
            {selectedTrip.city} · {selectedTrip.country}
          </div>
        )}
      </div>

      {/* ── Views ── */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {view === 'map'      && <TvMap      trips={TRIPS} active={mapActive} setActive={setMapActive} onOpen={openTrip} />}
        {view === 'list'     && <TvList     trips={TRIPS} filter={listFilter} setFilter={setListFilter} onOpen={openTrip} />}
        {view === 'detail'   && <TvDetail   trip={selectedTrip} onPlan={() => setView('plan')} onExpenses={() => setView('expenses')} />}
        {view === 'plan'     && <TvPlan     trip={selectedTrip} />}
        {view === 'expenses' && <TvExpenses trip={selectedTrip} />}
      </div>
    </div>
  );
}

/* ─── VIEW 01 · MAP ─────────────────────────────────────────── */
function TvMap({ trips, active, setActive, onOpen }) {
  const filtered = trips;
  const stats = useMemo(() => ({
    home:    trips.filter((t) => t.type === 'home').length,
    visited: trips.filter((t) => t.type === 'visited').length,
    planned: trips.filter((t) => t.type === 'planned').length,
    photos:  trips.reduce((s, t) => s + (t.photos || 0), 0),
  }), [trips]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', height: '100%', gap: 0 }}>
      {/* Map canvas */}
      <div style={{ position: 'relative', overflow: 'hidden' }}>
        <WorldMap cities={filtered} active={active} setActive={setActive} typeColor={T_COLOR} />
      </div>

      {/* Info column */}
      <div style={{
        borderLeft: '1px solid ' + COLORS.line, overflow: 'auto',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Stats */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(4,1fr)',
          borderBottom: '1px solid ' + COLORS.line,
        }}>
          {[
            ['HOME',    stats.home,    COLORS.gold],
            ['VISITED', stats.visited, COLORS.green],
            ['PLANNED', stats.planned, COLORS.red],
            ['PHOTOS',  stats.photos,  COLORS.text],
          ].map(([l, n, c]) => (
            <div key={l} style={{ padding: '12px 10px', borderRight: '1px solid ' + COLORS.line }}>
              <div className="mono" style={{ fontSize: 9, letterSpacing: '0.16em', color: COLORS.muted }}>{l}</div>
              <div className="mono" style={{ fontSize: 20, fontWeight: 700, marginTop: 4, color: c }}>{n}</div>
            </div>
          ))}
        </div>

        {/* Active pin detail or city list */}
        {active ? (
          <div style={{ padding: 18, flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <Kicker style={{ color: T_COLOR[active.type] }}>● {active.type.toUpperCase()} · {active.country}</Kicker>
                <div className="mono" style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}>{active.city}</div>
                <div className="mono" style={{ fontSize: 11, color: COLORS.muted, marginTop: 3 }}>
                  {active.lat.toFixed(2)}° · {active.lng.toFixed(2)}°
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'flex-end' }}>
                {active.dates && active.dates !== '—' && (
                  <span className="mono" style={{
                    fontSize: 10, padding: '3px 9px', borderRadius: 999,
                    border: `1px solid ${T_COLOR[active.type]}60`, color: T_COLOR[active.type],
                  }}>{active.dates}</span>
                )}
                {active.days > 0 && (
                  <span className="mono" style={{
                    fontSize: 10, padding: '3px 9px', borderRadius: 999,
                    border: '1px solid ' + COLORS.line, color: COLORS.muted,
                  }}>{active.days} days</span>
                )}
              </div>
            </div>

            {/* Mini stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6 }}>
              {[
                ['PINS',   active.pins   || 0],
                ['PHOTOS', active.photos || 0],
                ['DAYS',   active.days   || '—'],
                ['$',      active.spend ? `$${active.spend}` : '—'],
              ].map(([l, v]) => (
                <div key={l} style={{
                  padding: '8px 4px', textAlign: 'center',
                  border: '1px solid ' + COLORS.line, borderRadius: 9,
                }}>
                  <div className="mono" style={{ fontSize: 15, fontWeight: 700 }}>{v}</div>
                  <div className="mono" style={{ fontSize: 9, color: COLORS.muted, marginTop: 3, letterSpacing: '0.16em' }}>{l}</div>
                </div>
              ))}
            </div>

            {/* Tags */}
            {active.tags?.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {active.tags.map((tag) => (
                  <span key={tag} className="mono" style={{
                    fontSize: 9, padding: '3px 8px', borderRadius: 999,
                    border: '1px solid ' + COLORS.line, color: COLORS.muted, letterSpacing: '0.14em',
                  }}>{tag}</span>
                ))}
              </div>
            )}

            <div style={{
              padding: 13, borderRadius: 10, background: COLORS.bg,
              border: '1px solid ' + COLORS.line, fontSize: 12,
              color: COLORS.muted, lineHeight: 1.6, fontStyle: 'italic',
            }}>{active.note}</div>

            {active.type !== 'home' && (
              <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
                <button onClick={() => onOpen(active)} className="mono" style={{
                  flex: 1, padding: '10px 0', borderRadius: 10, cursor: 'pointer',
                  background: COLORS.gold, color: COLORS.bg, fontWeight: 700,
                  fontSize: 11, letterSpacing: '0.16em', border: 'none',
                }}>OPEN TRIP →</button>
                <button onClick={() => setActive(null)} className="mono" style={{
                  padding: '10px 14px', borderRadius: 10, cursor: 'pointer',
                  background: 'transparent', border: '1px solid ' + COLORS.line,
                  color: COLORS.text, fontSize: 11, letterSpacing: '0.16em',
                }}>✕</button>
              </div>
            )}
          </div>
        ) : (
          <div style={{ padding: '14px 16px', overflow: 'auto', flex: 1 }}>
            <Kicker style={{ marginBottom: 10 }}>ALL · {trips.length} CITIES</Kicker>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {trips.map((c) => (
                <button key={c.id} onClick={() => setActive(c)} style={{
                  textAlign: 'left', display: 'flex', justifyContent: 'space-between',
                  alignItems: 'center', padding: '7px 9px', background: 'transparent',
                  border: '1px solid transparent', borderRadius: 8,
                  cursor: 'pointer', color: COLORS.text,
                }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <span style={{ width: 7, height: 7, borderRadius: 999, background: T_COLOR[c.type], flexShrink: 0 }} />
                    <span className="mono" style={{ fontSize: 12 }}>{c.city}</span>
                  </span>
                  <span className="mono" style={{ fontSize: 10, color: COLORS.muted }}>{c.country}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── VIEW 02 · LIST ─────────────────────────────────────────── */
function TvList({ trips, filter, setFilter, onOpen }) {
  const filtered = filter === 'all' ? trips : trips.filter((t) => t.type === filter);
  const stats = useMemo(() => ({
    home:    trips.filter((t) => t.type === 'home').length,
    visited: trips.filter((t) => t.type === 'visited').length,
    planned: trips.filter((t) => t.type === 'planned').length,
    photos:  trips.reduce((s, t) => s + (t.photos || 0), 0),
  }), [trips]);

  const filterRows = [
    { k: 'all',     l: 'ALL',     n: trips.length,                   c: COLORS.text  },
    { k: 'home',    l: 'HOME',    n: stats.home,                     c: COLORS.gold  },
    { k: 'visited', l: 'VISITED', n: stats.visited,                  c: COLORS.green },
    { k: 'planned', l: 'PLANNED', n: stats.planned,                  c: COLORS.red   },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', height: '100%', overflow: 'hidden' }}>
      {/* Filter rail */}
      <div style={{
        borderRight: '1px solid ' + COLORS.line, padding: 16,
        overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 22,
      }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <Kicker>TYPE</Kicker>
            <Kicker>4</Kicker>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {filterRows.map(({ k, l, n, c }) => {
              const on = filter === k;
              return (
                <button key={k} onClick={() => setFilter(k)} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '7px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 12,
                  background: on ? 'rgba(245,237,224,0.03)' : 'transparent',
                  border: on ? '1px solid ' + COLORS.line : '1px solid transparent',
                  color: on ? COLORS.text : COLORS.muted,
                }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 7, height: 7, borderRadius: 999, background: c }} />
                    <span className="mono" style={{ fontSize: 10, letterSpacing: '0.14em' }}>{l}</span>
                  </span>
                  <span className="mono" style={{ fontSize: 10, color: `rgba(245,237,224,0.28)` }}>{n}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <Kicker style={{ marginBottom: 10 }}>ALL TAGS</Kicker>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {['food','solo','work','family','music','photo','coastal','draft'].map((tag) => (
              <span key={tag} className="mono" style={{
                fontSize: 9, padding: '3px 8px', borderRadius: 999,
                border: '1px solid ' + COLORS.line, color: COLORS.muted, letterSpacing: '0.14em',
              }}>{tag}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Main area */}
      <div style={{ overflow: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Stats row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
          {[
            ['HOME',    stats.home,    COLORS.gold,  COLORS.bg],
            ['VISITED', stats.visited, COLORS.green, COLORS.bg],
            ['PLANNED', stats.planned, COLORS.red,   COLORS.bg],
            ['PHOTOS',  stats.photos,  COLORS.text,  COLORS.bg],
          ].map(([l, n, c]) => (
            <div key={l} style={{
              padding: 14, borderRadius: 10,
              background: COLORS.panel, border: '1px solid ' + COLORS.line,
            }}>
              <div className="mono" style={{ fontSize: 9, letterSpacing: '0.16em', color: COLORS.muted }}>{l}</div>
              <div className="mono" style={{ fontSize: 26, fontWeight: 700, marginTop: 6, letterSpacing: '-0.01em', color: c }}>{n}</div>
            </div>
          ))}
        </div>

        {/* Trip cards grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14 }}>
          {filtered.map((trip) => (
            <TripCard key={trip.id} trip={trip} onClick={() => trip.type !== 'home' && onOpen(trip)} />
          ))}
          <button style={{
            border: `1px dashed ${COLORS.gold}60`, borderRadius: 12,
            background: 'transparent', color: COLORS.gold, cursor: 'pointer',
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', minHeight: 200, gap: 8,
          }}>
            <span className="mono" style={{ fontSize: 28, lineHeight: 1 }}>+</span>
            <span className="mono" style={{ fontSize: 10, letterSpacing: '0.18em', color: COLORS.gold + 'cc' }}>NEW TRIP</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function TripCard({ trip, onClick }) {
  const col = T_COLOR[trip.type];
  const hasPhoto = trip.photos > 0;
  return (
    <div onClick={onClick} style={{
      background: COLORS.panel, border: '1px solid ' + COLORS.line,
      borderRadius: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column',
      cursor: onClick ? 'pointer' : 'default',
    }}
      onMouseEnter={(e) => { if (onClick) e.currentTarget.style.borderColor = col + '60'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = COLORS.line; }}
    >
      {/* Cover placeholder */}
      <div style={{
        aspectRatio: '16/9', background: hasPhoto ? col + '12' : COLORS.bg,
        borderBottom: '1px solid ' + COLORS.line,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative',
      }}>
        {hasPhoto ? (
          <div style={{
            position: 'absolute', inset: 0,
            background: `radial-gradient(circle at center, ${col}18 1px, transparent 1px)`,
            backgroundSize: '12px 12px',
          }} />
        ) : (
          <div style={{
            position: 'absolute', inset: 0,
            background: 'radial-gradient(circle at center, rgba(245,237,224,0.06) 1px, transparent 1px)',
            backgroundSize: '12px 12px',
          }} />
        )}
      </div>

      <div style={{ padding: '12px 14px 14px' }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{trip.city}</div>
        <div className="mono" style={{ fontSize: 11, color: COLORS.muted, marginTop: 3 }}>
          {trip.dates} · {trip.days > 0 ? `${trip.days} days` : 'home'} · {trip.pins} pins
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
          <span className="mono" style={{
            fontSize: 9, padding: '3px 9px', borderRadius: 999,
            border: `1px solid ${col}60`, color: col, letterSpacing: '0.14em',
          }}>{trip.type}</span>
          {trip.photos > 0 && (
            <span className="mono" style={{
              fontSize: 9, padding: '3px 9px', borderRadius: 999,
              border: '1px solid ' + COLORS.line, color: COLORS.muted, letterSpacing: '0.14em',
            }}>{trip.photos} photos</span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── VIEW 03 · DETAIL ───────────────────────────────────────── */
function TvDetail({ trip, onPlan, onExpenses }) {
  const [tab, setTab] = useState('photos');
  if (!trip) return null;
  const col = T_COLOR[trip.type];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Pills row */}
      <div style={{
        padding: '10px 18px', borderBottom: '1px solid ' + COLORS.line,
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flexShrink: 0,
      }}>
        {[
          [trip.type, col],
          [trip.dates, COLORS.muted],
          [`${trip.days} days`, COLORS.muted],
          [`${trip.country}`, COLORS.muted],
          ...(trip.tags || []).map((t) => [t, COLORS.muted]),
        ].map(([l, c], i) => (
          <span key={i} className="mono" style={{
            fontSize: 10, padding: '3px 10px', borderRadius: 999,
            border: `1px solid ${i === 0 ? col + '60' : COLORS.line}`,
            color: i === 0 ? col : COLORS.muted, letterSpacing: '0.14em',
          }}>{l}</span>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button onClick={onPlan} className="mono" style={{
            padding: '5px 11px', borderRadius: 8, cursor: 'pointer', fontSize: 10,
            letterSpacing: '0.14em', background: 'transparent',
            border: '1px solid ' + COLORS.line, color: COLORS.muted,
          }}>PLAN →</button>
          <button onClick={onExpenses} className="mono" style={{
            padding: '5px 11px', borderRadius: 8, cursor: 'pointer', fontSize: 10,
            letterSpacing: '0.14em', background: 'transparent',
            border: '1px solid ' + COLORS.line, color: COLORS.muted,
          }}>EXPENSES →</button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 18 }}>
        {/* Hero drop zone */}
        <div style={{
          aspectRatio: '16/5', borderRadius: 14,
          border: `1.5px dashed ${col}60`,
          background: col + '08',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 18, flexDirection: 'column', gap: 8,
        }}>
          <div className="mono" style={{ fontSize: 16, color: col, fontWeight: 700 }}>+ Drop cover photo here</div>
          <div className="mono" style={{ fontSize: 11, color: COLORS.muted, letterSpacing: '0.12em' }}>
            Paste (⌘V) · drag from desktop · pick from library
          </div>
        </div>

        {/* Tabs */}
        <div style={{
          display: 'flex', gap: 3, padding: 3,
          background: COLORS.panel, border: '1px solid ' + COLORS.line,
          borderRadius: 11, width: 'fit-content', marginBottom: 18,
        }}>
          {[['photos', `PHOTOS · ${trip.photos}`], ['journal', 'JOURNAL'], ['map', 'MAP']].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className="mono" style={{
              padding: '7px 14px', borderRadius: 8, cursor: 'pointer',
              fontSize: 11, letterSpacing: '0.14em',
              background: tab === k ? 'rgba(245,237,224,0.08)' : 'transparent',
              border: 'none', color: tab === k ? COLORS.text : COLORS.muted,
            }}>{l}</button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 18 }}>
          {/* Main content */}
          <div>
            {tab === 'photos' && (
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(4,1fr)',
                gridAutoRows: '100px', gap: 8,
              }}>
                {[
                  { s: '2col 2row' }, {}, {}, {},
                  { s: '2row' }, {}, {}, {}, {}, {},
                  { s: '2col' }, { add: true },
                ].map((cell, i) => (
                  <div key={i} style={{
                    gridColumn: cell.s?.includes('2col') ? 'span 2' : undefined,
                    gridRow:    cell.s?.includes('2row') ? 'span 2' : undefined,
                    borderRadius: 8,
                    background: cell.add ? 'transparent' : col + '10',
                    border: cell.add
                      ? `1px dashed ${col}50`
                      : '1px solid ' + COLORS.line,
                    display: 'grid', placeItems: 'center',
                    backgroundImage: cell.add ? undefined :
                      `radial-gradient(circle at center, rgba(245,237,224,0.12) 1px, transparent 1px)`,
                    backgroundSize: '10px 10px',
                    cursor: cell.add ? 'pointer' : 'default',
                    color: COLORS.gold,
                  }}>
                    {cell.add && <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                      <span className="mono" style={{ fontSize: 22 }}>+</span>
                      <span className="mono" style={{ fontSize: 9, letterSpacing: '0.16em' }}>DROP</span>
                    </div>}
                  </div>
                ))}
              </div>
            )}

            {tab === 'journal' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {[
                  { day: '01', mo: trip.dates?.slice(0, 7), title: 'Landing late, first impressions', body: 'Arrived evening, went straight to the city. First meal was exactly what I needed after the flight.' },
                  { day: '02', mo: trip.dates?.slice(0, 7), title: 'Exploring on foot', body: 'Walked most of the day. Found a small place with no English menu — best decision of the trip.' },
                  { day: '03', mo: trip.dates?.slice(0, 7), title: 'The main event', body: 'The thing I came here for. Didn\'t disappoint. Bought something I shouldn\'t have and don\'t regret it.' },
                ].map((entry) => (
                  <div key={entry.day} style={{
                    padding: 16, background: COLORS.panel,
                    border: '1px solid ' + COLORS.line, borderRadius: 12,
                    display: 'grid', gridTemplateColumns: '80px 1fr', gap: 16,
                  }}>
                    <div>
                      <div className="mono" style={{ fontSize: 26, fontWeight: 700 }}>{entry.day}</div>
                      <div className="mono" style={{ fontSize: 10, color: COLORS.muted, letterSpacing: '0.14em' }}>{entry.mo}</div>
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>{entry.title}</div>
                      <div style={{ color: COLORS.muted, fontSize: 13, lineHeight: 1.6 }}>{entry.body}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab === 'map' && (
              <div style={{
                height: 320, borderRadius: 12, overflow: 'hidden',
                background: COLORS.panel, border: '1px solid ' + COLORS.line,
              }}>
                <WorldMap cities={[trip]} active={trip} setActive={() => {}} typeColor={T_COLOR} />
              </div>
            )}
          </div>

          {/* Right rail */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Key facts */}
            <div style={{
              background: COLORS.panel, border: '1px solid ' + COLORS.line,
              borderRadius: 12, padding: 16,
            }}>
              <Kicker style={{ marginBottom: 10 }}>KEY FACTS</Kicker>
              {[
                ['Dates',    trip.dates],
                ['Days',     trip.days],
                ['Pins',     trip.pins],
                ['Photos',   trip.photos],
                ['Spend',    trip.spend ? `$${trip.spend}` : '—'],
                ['Budget',   trip.budget ? `$${trip.budget}` : '—'],
                ['Country',  trip.country],
              ].map(([k, v]) => (
                <div key={k} style={{
                  display: 'flex', justifyContent: 'space-between',
                  padding: '8px 0', borderBottom: '1px dashed ' + COLORS.line, fontSize: 12,
                }}>
                  <span style={{ color: COLORS.muted }}>{k}</span>
                  <span className="mono">{v}</span>
                </div>
              ))}
            </div>

            {/* Expense bar */}
            {trip.spend && (
              <div style={{
                background: COLORS.panel, border: '1px solid ' + COLORS.line,
                borderRadius: 12, padding: 16,
              }}>
                <Kicker style={{ marginBottom: 10 }}>EXPENSES</Kicker>
                <div style={{ height: 12, borderRadius: 999, overflow: 'hidden', display: 'grid', gridTemplateColumns: '38fr 24fr 18fr 12fr 8fr' }}>
                  {[COLORS.gold, COLORS.green, COLORS.red, 'rgba(245,237,224,0.30)', 'rgba(245,237,224,0.18)'].map((bg, i) => (
                    <div key={i} style={{ background: bg }} />
                  ))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '6px 14px', marginTop: 12 }}>
                  {[['Food','38%',COLORS.gold],['Stay','24%',COLORS.green],['Transport','18%',COLORS.red],['Shopping','12%','rgba(245,237,224,0.4)'],['Other','8%','rgba(245,237,224,0.25)']].map(([l,p,c]) => (
                    <div key={l} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: COLORS.muted }}>
                        <span style={{ width: 7, height: 7, borderRadius: 999, background: c }} />{l}
                      </span>
                      <span className="mono">{p}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={onPlan} className="mono" style={{
                flex: 1, padding: '10px 0', borderRadius: 10, cursor: 'pointer',
                background: COLORS.gold, color: COLORS.bg,
                fontWeight: 700, fontSize: 11, letterSpacing: '0.16em', border: 'none',
              }}>OPEN PLAN →</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── VIEW 04 · PLAN ─────────────────────────────────────────── */
const PLAN_DAYS = [
  {
    d: 'DAY 1', date: 'TUE',
    items: [
      { time: '14:30', tag: 'MOVE', name: 'Arrival — airport transfer', type: 'move' },
      { time: '18:00', tag: 'SEE',  name: 'Walk the neighborhood', type: 'see' },
      { time: '20:00', tag: 'EAT',  name: 'Dinner — local spot', type: 'eat' },
    ],
  },
  {
    d: 'DAY 2', date: 'WED',
    items: [
      { time: '10:00', tag: 'SEE',  name: 'Main attraction', type: 'see' },
      { time: '13:00', tag: 'EAT',  name: 'Lunch at the market', type: 'eat' },
      { time: '16:00', tag: 'SEE',  name: 'Afternoon walk', type: 'see' },
    ],
  },
  {
    d: 'DAY 3', date: 'THU',
    items: [
      { time: '09:30', tag: 'MOVE', name: 'Day trip out of city', type: 'move' },
      { time: '19:00', tag: 'EAT',  name: 'Dinner back in town', type: 'eat' },
    ],
  },
  {
    d: 'DAY 4', date: 'FRI',
    items: [],
  },
];

const CHECKLIST = [
  { done: true,  lab: 'Passport ≥ 6mo validity' },
  { done: true,  lab: 'Flights booked' },
  { done: true,  lab: 'Accommodation confirmed' },
  { done: true,  lab: 'Travel insurance' },
  { done: true,  lab: 'eSIM / data plan' },
  { done: false, lab: 'Local currency cash' },
  { done: false, lab: 'Notify bank of travel' },
  { done: false, lab: 'Print boarding pass backup' },
];

function TvPlan({ trip }) {
  if (!trip) return null;
  const col = T_COLOR[trip.type];
  const tagColor = { eat: COLORS.gold, see: COLORS.green, move: COLORS.red };
  const donePct = trip.budget && trip.spend ? Math.round((trip.spend / trip.budget) * 100) : 64;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{
        padding: '8px 18px', borderBottom: '1px solid ' + COLORS.line,
        display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap',
      }}>
        {[
          [trip.type, col],
          [trip.dates, COLORS.muted],
          [`${trip.days} days`, COLORS.muted],
          [`${trip.country} · ${trip.city}`, COLORS.muted],
        ].map(([l, c], i) => (
          <span key={i} className="mono" style={{
            fontSize: 10, padding: '3px 10px', borderRadius: 999,
            border: `1px solid ${i === 0 ? col + '60' : COLORS.line}`,
            color: i === 0 ? col : COLORS.muted, letterSpacing: '0.14em',
          }}>{l}</span>
        ))}
      </div>

      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 290px', overflow: 'hidden' }}>
        {/* Kanban */}
        <div style={{ overflow: 'auto', padding: 18 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, minWidth: 640 }}>
            {PLAN_DAYS.map((day) => (
              <div key={day.d} style={{
                background: COLORS.panel, border: '1px solid ' + COLORS.line,
                borderRadius: 12, display: 'flex', flexDirection: 'column', minHeight: 300,
              }}>
                <div style={{
                  padding: '10px 13px', borderBottom: '1px solid ' + COLORS.line,
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <span className="mono" style={{ fontSize: 11, letterSpacing: '0.16em', color: COLORS.gold }}>{day.d}</span>
                  <span className="mono" style={{ fontSize: 10, color: COLORS.muted }}>{day.date}</span>
                </div>
                <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                  {day.items.map((item, i) => (
                    <div key={i} style={{
                      padding: '9px 11px', background: COLORS.bg,
                      border: '1px solid ' + COLORS.line, borderRadius: 9,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="mono" style={{ fontSize: 10, color: COLORS.muted, letterSpacing: '0.14em' }}>{item.time}</span>
                        <span className="mono" style={{
                          fontSize: 9, padding: '2px 6px', borderRadius: 4, letterSpacing: '0.12em',
                          background: (tagColor[item.type] || COLORS.muted) + '22',
                          color: tagColor[item.type] || COLORS.muted,
                        }}>{item.tag}</span>
                      </div>
                      <div style={{ fontSize: 13, marginTop: 4 }}>{item.name}</div>
                    </div>
                  ))}
                  {day.items.length === 0 && (
                    <div style={{
                      flex: 1, border: '1px dashed ' + COLORS.line, borderRadius: 9,
                      display: 'grid', placeItems: 'center',
                      color: `rgba(245,237,224,0.28)`, fontSize: 10, minHeight: 80,
                    }}>
                      <span className="mono" style={{ letterSpacing: '0.14em' }}>EMPTY DAY</span>
                    </div>
                  )}
                  <button className="mono" style={{
                    padding: '8px 0', border: '1px dashed ' + COLORS.line, borderRadius: 9,
                    background: 'transparent', color: `rgba(245,237,224,0.28)`,
                    fontSize: 10, letterSpacing: '0.14em', cursor: 'pointer',
                  }}>+ ADD STOP</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right rail */}
        <div style={{
          borderLeft: '1px solid ' + COLORS.line, overflow: 'auto', padding: 16,
          display: 'flex', flexDirection: 'column', gap: 14,
        }}>
          {/* Checklist */}
          <div style={{
            background: COLORS.panel, border: '1px solid ' + COLORS.line,
            borderRadius: 12, padding: 16,
          }}>
            <Kicker style={{ marginBottom: 10 }}>
              PRE-TRIP · {CHECKLIST.filter((c) => c.done).length}/{CHECKLIST.length}
            </Kicker>
            {CHECKLIST.map((item, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '7px 0', borderBottom: '1px dashed ' + COLORS.line, fontSize: 12,
              }}>
                <div style={{
                  width: 13, height: 13, borderRadius: 4, flexShrink: 0,
                  border: item.done ? 'none' : '1.5px solid ' + COLORS.muted,
                  background: item.done ? COLORS.green : 'transparent',
                }} />
                <span style={{ color: item.done ? COLORS.muted : COLORS.text, textDecoration: item.done ? 'line-through' : 'none' }}>{item.lab}</span>
              </div>
            ))}
          </div>

          {/* Budget */}
          <div style={{
            background: COLORS.panel, border: '1px solid ' + COLORS.line,
            borderRadius: 12, padding: 16,
          }}>
            <Kicker style={{ marginBottom: 6 }}>
              BUDGET · ${trip.spend || '—'} / ${trip.budget || '—'}
            </Kicker>
            <div style={{ height: 10, borderRadius: 999, background: 'rgba(245,237,224,0.10)', overflow: 'hidden', marginTop: 8 }}>
              <div style={{ height: '100%', width: `${Math.min(donePct, 100)}%`, background: donePct > 90 ? COLORS.red : COLORS.gold }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11, color: COLORS.muted }}>
              <span className="mono">{donePct}% USED</span>
              <span className="mono">${trip.budget && trip.spend ? trip.budget - trip.spend : '—'} LEFT</span>
            </div>
          </div>

          {/* Export */}
          <div style={{
            background: COLORS.panel, border: '1px solid ' + COLORS.line,
            borderRadius: 12, padding: 16,
          }}>
            <Kicker style={{ marginBottom: 10 }}>EXPORT</Kicker>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {['↓ ICAL · day-by-day', '↓ PDF · printable', '↗ SHARE LINK · read-only'].map((l) => (
                <button key={l} className="mono" style={{
                  padding: '9px 12px', borderRadius: 10, cursor: 'pointer',
                  border: '1px solid ' + COLORS.line, background: 'transparent',
                  color: COLORS.text, fontSize: 10, letterSpacing: '0.14em', textAlign: 'left',
                }}>{l}</button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── VIEW 05 · EXPENSES ─────────────────────────────────────── */
const TX_LOG = [
  { day: 'D1', cat: 'Transport', name: 'Airport transfer',     method: 'card',    amt: 42,   usd: 42   },
  { day: 'D1', cat: 'Food',      name: 'First dinner',         method: 'cash',    amt: 28,   usd: 28   },
  { day: 'D1', cat: 'Stay',      name: 'Hotel night 1',        method: 'card',    amt: 120,  usd: 120  },
  { day: 'D2', cat: 'Food',      name: 'Lunch at the market',  method: 'cash',    amt: 18,   usd: 18   },
  { day: 'D2', cat: 'See',       name: 'Museum entry',         method: 'card',    amt: 24,   usd: 24   },
  { day: 'D3', cat: 'Transport', name: 'Day trip transfer',    method: 'card',    amt: 35,   usd: 35   },
  { day: 'D3', cat: 'Food',      name: 'Dinner back in town',  method: 'cash',    amt: 55,   usd: 55   },
];

function TvExpenses({ trip }) {
  if (!trip) return null;
  const col = T_COLOR[trip.type];
  const total = trip.spend || TX_LOG.reduce((s, t) => s + t.usd, 0);
  const catColor = { Transport: COLORS.red, Food: COLORS.gold, Stay: COLORS.green, See: 'rgba(245,237,224,0.40)', Other: 'rgba(245,237,224,0.25)' };

  const kpis = [
    { l: 'TOTAL SPEND', n: `$${total}`,                         sub: `budget $${trip.budget || '—'}`, c: COLORS.gold  },
    { l: 'PER DAY AVG', n: `$${Math.round(total / (trip.days || 1))}`, sub: `${trip.days} days`, c: COLORS.text  },
    { l: 'BUDGET LEFT', n: trip.budget ? `$${trip.budget - total}` : '—', sub: trip.budget ? `${Math.round((total/trip.budget)*100)}% used` : '', c: COLORS.green },
    { l: 'BIGGEST DAY', n: '$120',                              sub: 'DAY 01 · hotel + dinner',       c: COLORS.red   },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{
        padding: '8px 18px', borderBottom: '1px solid ' + COLORS.line,
        display: 'flex', gap: 8, flexShrink: 0,
      }}>
        {[[trip.type, col], [trip.dates, COLORS.muted], [`${trip.days} days`, COLORS.muted], [`${TX_LOG.length} tx`, COLORS.gold]].map(([l, c], i) => (
          <span key={i} className="mono" style={{
            fontSize: 10, padding: '3px 10px', borderRadius: 999,
            border: `1px solid ${i === 0 ? col + '60' : i === 3 ? COLORS.gold + '50' : COLORS.line}`,
            color: i === 0 ? col : i === 3 ? COLORS.gold : COLORS.muted, letterSpacing: '0.14em',
          }}>{l}</span>
        ))}
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* KPI row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
          {kpis.map(({ l, n, sub, c }) => (
            <div key={l} style={{
              padding: 16, borderRadius: 12,
              background: COLORS.panel, border: '1px solid ' + COLORS.line,
            }}>
              <div className="mono" style={{ fontSize: 10, color: COLORS.muted, letterSpacing: '0.16em' }}>{l}</div>
              <div className="mono" style={{ fontSize: 26, fontWeight: 700, marginTop: 8, color: c }}>{n}</div>
              <div className="mono" style={{ fontSize: 11, marginTop: 4, color: COLORS.muted }}>{sub}</div>
            </div>
          ))}
        </div>

        {/* Charts row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 14 }}>
          {/* Donut breakdown */}
          <div style={{
            background: COLORS.panel, border: '1px solid ' + COLORS.line, borderRadius: 12, padding: 18,
          }}>
            <Kicker style={{ marginBottom: 14 }}>BREAKDOWN BY CATEGORY</Kicker>
            <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: 20, alignItems: 'center' }}>
              <div style={{ position: 'relative', width: 150, height: 150 }}>
                <svg width="150" height="150" viewBox="0 0 150 150">
                  {(() => {
                    const segs = [[38,COLORS.gold],[24,COLORS.green],[18,COLORS.red],[12,'rgba(245,237,224,0.35)'],[8,'rgba(245,237,224,0.20)']];
                    let offset = 0;
                    return segs.map(([pct, c], i) => {
                      const r = 55, cx = 75, cy = 75;
                      const circ = 2 * Math.PI * r;
                      const dash = (pct / 100) * circ;
                      const gap  = circ - dash;
                      const rot  = (offset / 100) * 360 - 90;
                      offset += pct;
                      return (
                        <circle key={i} cx={cx} cy={cy} r={r}
                          fill="none" stroke={c} strokeWidth="28"
                          strokeDasharray={`${dash} ${gap}`}
                          transform={`rotate(${rot} ${cx} ${cy})`} />
                      );
                    });
                  })()}
                  <circle cx="75" cy="75" r="41" fill={COLORS.panel} />
                  <text x="75" y="72" textAnchor="middle" fill={COLORS.text}
                    fontFamily="JetBrains Mono, monospace" fontSize="16" fontWeight="700">${total}</text>
                  <text x="75" y="86" textAnchor="middle" fill={COLORS.muted}
                    fontFamily="JetBrains Mono, monospace" fontSize="9" letterSpacing="0.14em">TOTAL</text>
                </svg>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[['Food & drink','38%',COLORS.gold],['Stay','24%',COLORS.green],['Transport','18%',COLORS.red],['Shopping','12%','rgba(245,237,224,0.35)'],['Other','8%','rgba(245,237,224,0.20)']].map(([l,p,c]) => (
                  <div key={l} style={{
                    display: 'grid', gridTemplateColumns: '12px 1fr auto auto', gap: 10,
                    alignItems: 'center', padding: '7px 0',
                    borderBottom: '1px dashed ' + COLORS.line, fontSize: 12,
                  }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: c }} />
                    <span>{l}</span>
                    <span className="mono" style={{ color: COLORS.muted, fontSize: 10 }}>{p}</span>
                    <span className="mono" style={{ fontWeight: 700 }}>${Math.round(total * parseInt(p) / 100)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Per-day bar chart */}
          <div style={{
            background: COLORS.panel, border: '1px solid ' + COLORS.line, borderRadius: 12, padding: 18,
          }}>
            <Kicker style={{ marginBottom: 14 }}>SPEND PER DAY</Kicker>
            <div style={{
              display: 'flex', alignItems: 'flex-end', gap: 6, height: 140,
              paddingBottom: 0, borderBottom: '1px dashed ' + COLORS.line,
            }}>
              {[
                [34, 48, 22],
                [24, 48, 14, 30],
                [46, 48, 18, 14, 8],
                [30, 48, 24],
                [38, 48, 8, 22],
                [18, 0, 42, 0, 10],
              ].map((bars, i) => (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column-reverse', gap: 2 }}>
                  {bars.map((h, j) => h > 0 && (
                    <div key={j} style={{
                      height: h, borderRadius: '2px 2px 0 0',
                      background: [COLORS.gold, COLORS.green, COLORS.red, 'rgba(245,237,224,0.30)', 'rgba(245,237,224,0.18)'][j],
                    }} />
                  ))}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6, paddingTop: 6 }}>
              {['D1','D2','D3','D4','D5','D6'].map((d) => (
                <div key={d} style={{ flex: 1, textAlign: 'center' }}>
                  <span className="mono" style={{ fontSize: 9, color: COLORS.muted }}>{d}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 14px', marginTop: 12, fontSize: 11, color: COLORS.muted }}>
              {[['Food',COLORS.gold],['Stay',COLORS.green],['Transport',COLORS.red]].map(([l,c]) => (
                <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 999, background: c }} />{l}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Transaction log + sidebar */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 14 }}>
          <div style={{
            background: COLORS.panel, border: '1px solid ' + COLORS.line, borderRadius: 12, padding: 18,
          }}>
            <Kicker style={{ marginBottom: 14 }}>TRANSACTION LOG · {TX_LOG.length} ITEMS</Kicker>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  {['DAY','CATEGORY','NAME','METHOD','USD'].map((h) => (
                    <th key={h} style={{
                      textAlign: h === 'USD' ? 'right' : 'left',
                      padding: '8px 10px', borderBottom: '1px solid ' + COLORS.line,
                      fontFamily: 'JetBrains Mono, monospace', fontSize: 9,
                      letterSpacing: '0.16em', color: COLORS.muted, textTransform: 'uppercase',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {TX_LOG.map((tx, i) => (
                  <tr key={i}>
                    <td style={{ padding: '9px 10px', borderBottom: '1px dashed ' + COLORS.line }}>
                      <span className="mono" style={{ fontSize: 10, color: COLORS.muted }}>{tx.day}</span>
                    </td>
                    <td style={{ padding: '9px 10px', borderBottom: '1px dashed ' + COLORS.line }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <span style={{ width: 7, height: 7, borderRadius: 999, background: catColor[tx.cat] || COLORS.muted }} />
                        {tx.cat}
                      </span>
                    </td>
                    <td style={{ padding: '9px 10px', borderBottom: '1px dashed ' + COLORS.line }}>{tx.name}</td>
                    <td style={{ padding: '9px 10px', borderBottom: '1px dashed ' + COLORS.line, color: COLORS.muted }}>{tx.method}</td>
                    <td style={{ padding: '9px 10px', borderBottom: '1px dashed ' + COLORS.line, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>${tx.usd}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} style={{ padding: '11px 10px', borderTop: '1px solid ' + COLORS.line, fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.16em', color: COLORS.muted }}>
                    TOTAL · {TX_LOG.length} ITEMS
                  </td>
                  <td style={{ padding: '11px 10px', borderTop: '1px solid ' + COLORS.line, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 14, color: COLORS.gold }}>${total}</td>
                </tr>
              </tfoot>
            </table>
            <div style={{
              padding: '12px 0', textAlign: 'center', marginTop: 8,
              border: `1.5px dashed ${COLORS.gold}50`, borderRadius: 10,
              color: COLORS.gold, fontFamily: 'JetBrains Mono, monospace',
              fontSize: 11, letterSpacing: '0.16em', cursor: 'pointer',
            }}>+ ADD TRANSACTION</div>
          </div>

          {/* Side: daily budget + FX */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{
              background: COLORS.panel, border: '1px solid ' + COLORS.line,
              borderRadius: 12, padding: 16,
            }}>
              <Kicker style={{ marginBottom: 10 }}>DAILY VS BUDGET</Kicker>
              {[['D1',62,90],['D2',78,180],['D3',135,55],['D4',54,80],['D5',96,148],['D6',64,97]].map(([d,pct,amt]) => (
                <div key={d} style={{
                  display: 'grid', gridTemplateColumns: '40px 1fr 52px', gap: 10,
                  alignItems: 'center', padding: '7px 0', borderBottom: '1px dashed ' + COLORS.line, fontSize: 12,
                }}>
                  <span className="mono" style={{ fontSize: 10, color: COLORS.muted }}>{d}</span>
                  <div style={{ height: 6, borderRadius: 999, background: 'rgba(245,237,224,0.10)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, background: pct > 100 ? COLORS.red : COLORS.gold }} />
                  </div>
                  <span className="mono" style={{ textAlign: 'right', fontWeight: 700, fontSize: 11, color: pct > 100 ? COLORS.red : COLORS.text }}>${amt}</span>
                </div>
              ))}
            </div>

            <div style={{
              background: COLORS.panel, border: '1px solid ' + COLORS.line,
              borderRadius: 12, padding: 16,
            }}>
              <Kicker style={{ marginBottom: 10 }}>EXPORT</Kicker>
              {['↓ CSV · transactions', '↓ PDF · expense report'].map((l) => (
                <button key={l} className="mono" style={{
                  display: 'block', width: '100%', padding: '8px 12px',
                  marginBottom: 7, borderRadius: 9, cursor: 'pointer',
                  border: '1px solid ' + COLORS.line, background: 'transparent',
                  color: COLORS.text, fontSize: 10, letterSpacing: '0.14em', textAlign: 'left',
                }}>{l}</button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function WorldMap({ cities, active, setActive, typeColor }) {
  const W = 1000, H = 500;
  const project = (lat, lng) => {
    const x = ((lng + 180) / 360) * W;
    const y = ((90 - lat) / 180) * H;
    return [x, y * 0.95 + H * 0.025];
  };
  const dots = useMemo(() => makeDottedLandscape(W, H), []);
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
           style={{ width: '100%', height: '100%', display: 'block' }}>
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.025)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width={W} height={H} fill="url(#grid)" />
        {dots.map((d, i) => (
          <circle key={i} cx={d[0]} cy={d[1]} r={d[2]} fill="rgba(245,237,224,0.16)" />
        ))}
        {cities.map((c) => {
          const [x, y] = project(c.lat, c.lng);
          const col = typeColor[c.type];
          const isActive = active?.id === c.id;
          return (
            <g key={c.id} style={{ cursor: 'pointer' }} onClick={() => setActive(c)}>
              <circle cx={x} cy={y} r={isActive ? 18 : 12} fill={col} opacity="0.12" />
              <circle cx={x} cy={y} r={isActive ? 10 : 6} fill={col} opacity="0.32" />
              <circle cx={x} cy={y} r={isActive ? 5 : 3.5} fill={col}>
                {c.type === 'home' && (
                  <animate attributeName="r" values="3.5;5.5;3.5" dur="2s" repeatCount="indefinite" />
                )}
              </circle>
              {isActive && (
                <g>
                  <rect x={x + 10} y={y - 18} width={c.city.length * 7 + 14} height={22}
                        rx="4" fill="#0d0a08" stroke={col} strokeWidth="1" />
                  <text x={x + 17} y={y - 3} fill={COLORS.text}
                        fontFamily="JetBrains Mono, monospace" fontSize="11">{c.city}</text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function makeDottedLandscape(W, H) {
  const out = [];
  const step = 9;
  const regions = [
    [200, 175, 110, 90, 0.95], [210, 220, 80, 60, 0.85], [160, 280, 50, 40, 0.6],
    [280, 350, 50, 80, 0.92], [270, 410, 35, 50, 0.88],
    [495, 165, 60, 50, 0.92],
    [510, 270, 70, 110, 0.95], [520, 350, 45, 50, 0.88],
    [555, 215, 35, 30, 0.85],
    [620, 145, 130, 50, 0.9], [720, 160, 100, 45, 0.85],
    [670, 245, 45, 50, 0.92],
    [750, 290, 50, 40, 0.92], [780, 320, 35, 30, 0.85],
    [760, 200, 70, 50, 0.9], [820, 215, 25, 25, 0.85],
    [830, 380, 75, 50, 0.92],
    [780, 340, 40, 18, 0.85],
    [400, 90, 35, 35, 0.7],
    [468, 155, 14, 18, 0.85],
  ];
  const holes = [[240, 240, 30, 25], [180, 195, 20, 25], [550, 230, 18, 12]];
  function inRegion(x, y) {
    let best = 0;
    for (const [cx, cy, rx, ry, d] of regions) {
      const v = ((x - cx) ** 2) / (rx * rx) + ((y - cy) ** 2) / (ry * ry);
      if (v < 1) best = Math.max(best, d * (1 - v));
    }
    for (const [cx, cy, rx, ry] of holes) {
      const v = ((x - cx) ** 2) / (rx * rx) + ((y - cy) ** 2) / (ry * ry);
      if (v < 1) best *= 0.1;
    }
    return best;
  }
  for (let y = 0; y < H; y += step) {
    for (let x = 0; x < W; x += step) {
      const d = inRegion(x, y);
      if (d > 0.05) {
        const jx = Math.sin(x * 0.31 + y * 0.17) * 2;
        const jy = Math.cos(x * 0.13 + y * 0.29) * 2;
        out.push([x + jx, y + jy, 1.1 + d * 0.6]);
      }
    }
  }
  return out;
}

// ═════════════════════════════════════════════════════════════
// 4. GAME — placeholder
// ═════════════════════════════════════════════════════════════
export function GamePanel() {
  return (
    <Panel padding={0} style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid ' + COLORS.line }}>
        <Kicker>GAME · WIP</Kicker>
        <div className="mono" style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>Coming soon</div>
      </div>
      <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 40 }}>
        <div style={{ textAlign: 'center', maxWidth: 480 }}>
          <div style={{
            width: 120, height: 120, margin: '0 auto 24px',
            border: `1px dashed ${COLORS.line}`, borderRadius: 16,
            display: 'grid', placeItems: 'center', position: 'relative',
          }}>
            <svg width="68" height="68" viewBox="0 0 64 64" fill="none">
              <rect x="6" y="20" width="52" height="28" rx="14" stroke={COLORS.red} strokeWidth="2" opacity="0.6" />
              <circle cx="20" cy="34" r="2.5" fill={COLORS.green} />
              <circle cx="44" cy="30" r="2" fill={COLORS.gold} />
              <circle cx="48" cy="38" r="2" fill={COLORS.red} />
              <line x1="14" y1="30" x2="14" y2="38" stroke={COLORS.text} strokeWidth="2" strokeLinecap="round" />
              <line x1="10" y1="34" x2="18" y2="34" stroke={COLORS.text} strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
          <div className="mono" style={{
            fontSize: 13, letterSpacing: '0.18em', textTransform: 'uppercase',
            color: COLORS.text, fontWeight: 700, marginBottom: 8,
          }}>Game hub</div>
          <div style={{ fontSize: 14, color: COLORS.muted, lineHeight: 1.6 }}>
            Mini-games, leaderboards và arcade collection sẽ xuất hiện ở đây.
            Hiện tại slot này là <em style={{ color: COLORS.gold, fontStyle: 'normal' }}>placeholder</em> theo design brief.
          </div>
          <div style={{ marginTop: 22, display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Pill color={COLORS.red}>idle</Pill>
            <Pill color={COLORS.green}>browser</Pill>
            <Pill color={COLORS.gold}>multiplayer</Pill>
          </div>
        </div>
      </div>
    </Panel>
  );
}
