import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  COLORS, CITIES,
  Panel, Btn, Field, Pill, Kicker,
  useSyncedData, usePasteImage, copyText, useLang, useMediaQuery, usePersisted, compressImage,
  buildChatHistory,
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
  const [videoEngine, setVideoEngine] = useSyncedData(
    { localKey: 'se77n.ai.videoEngine', serverKey: 'aiVideoEngine' },
    'seedance',
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

  async function send(retry) {
    const q = retry ? retry.prompt : input.trim();
    const usedImage = retry ? retry.image : imgRef;
    if ((!q && !usedImage) || busy) return;

    if (retry) {
      // Drop prior error bubbles before re-attempting the same input.
      setMessages((m) => m.filter((x) => !x.error));
    } else {
      const userMsg = { role: 'user', content: q || '(no prompt)', image: usedImage?.dataUrl };
      setInput('');
      setImgRef(null);
      setMessages((m) => [...m, userMsg]);
    }
    setBusy(true);

    try {
      let assistantMsg;
      if (preset.kind === 'chat') {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ system: preset.system, prompt: q, image: usedImage?.dataUrl, model: 'google/gemini-2.5-flash', threadId: 'ai:' + presetId, history: buildChatHistory(messages, retry ? q : undefined) }),
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
            engine: videoEngine,
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

      // Auto-log every successful AI activity to the private history feed.
      // Server identifies the actor (auth user via session, guest via cookie).
      // Fire-and-forget so a failed log never blocks the chat UX.
      const histPayload = (() => {
        const promptStr = (q || '').trim();
        if (preset.kind === 'chat' && assistantMsg?.content) {
          return { kind: 'chat', prompt: promptStr, reply: assistantMsg.content, preset: preset.id };
        }
        if (preset.kind === 'image' && assistantMsg?.image) {
          return { kind: 'image', prompt: promptStr, mediaUrl: assistantMsg.image, preset: preset.id };
        }
        if (preset.kind === 'video' && assistantMsg?.video) {
          return { kind: 'video', prompt: promptStr, mediaUrl: assistantMsg.video, preset: preset.id };
        }
        if (preset.kind === 'bg-remove' && assistantMsg?.image) {
          return { kind: 'bg-remove', prompt: promptStr || '(no prompt)', mediaUrl: assistantMsg.image, preset: preset.id };
        }
        return null;
      })();
      if (histPayload) {
        fetch('/api/toolbox?kind=history', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(histPayload),
        }).catch(() => { /* silent */ });
      }
    } catch (e) {
      setMessages((m) => [...m, {
        role: 'assistant',
        content: '⚠ ' + (e.message || 'Connection wobble. Try again?'),
        error: true,
        retry: { prompt: q, image: usedImage },
      }]);
    } finally {
      setBusy(false);
    }
  }

  function clearChat() {
    setMessages([]);
    fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clear: true, threadId: 'ai:' + presetId }),
    }).catch(() => { /* best-effort */ });
  }

  function onImageRef(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    compressImage(f).then((img) => { if (img) setImgRef(img); }).catch(() => {});
    e.target.value = '';
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

      <Panel padding={0} style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%' }}>
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
            {preset.kind === 'video' && (
              <ModelSwap
                label="MODEL"
                value={videoEngine}
                onChange={setVideoEngine}
                options={VIDEO_ENGINES}
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
            <Message
              key={i}
              role={m.role}
              content={m.content}
              image={m.image}
              video={m.video}
              onReplyImage={
                preset.kind === 'image' && m.role === 'assistant' && m.image
                  ? () => setImgRef({ name: 'reply.jpg', dataUrl: m.image })
                  : null
              }
              onRetry={m.error && m.retry ? () => send(m.retry) : null}
              retryLabel={t('ai.retry')}
            />
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

const VIDEO_ENGINES = [
  { v: 'seedance', l: 'SEEDANCE-2.0' },
  { v: 'veo3',     l: 'VEO 3.1' },
  { v: 'kling',    l: 'KLING 2.5' },
  { v: 'grok',     l: 'GROK IMAGINE' },
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

function Message({ role, content, image, video, typing, kind, onReplyImage, onRetry, retryLabel }) {
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
        {onRetry && (
          <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-start' }}>
            <button
              onClick={onRetry}
              className="mono"
              style={{
                fontSize: 10, letterSpacing: '0.15em',
                padding: '4px 10px', borderRadius: 999,
                background: 'transparent',
                border: `1px solid ${COLORS.red}66`,
                color: COLORS.red, cursor: 'pointer',
              }}
            >↻ {retryLabel}</button>
          </div>
        )}
        {onReplyImage && (
          <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={onReplyImage}
              className="mono"
              style={{
                fontSize: 10, letterSpacing: '0.15em',
                padding: '4px 10px', borderRadius: 999,
                background: 'transparent',
                border: `1px solid ${COLORS.gold}66`,
                color: COLORS.gold, cursor: 'pointer',
              }}
            >↺ REPLY · EDIT</button>
          </div>
        )}
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
// Pink isn't a global brand color — it's the dedicated accent for the Thảo
// love-letter tool, so it lives next to the tool data rather than in COLORS.
const PINK = '#f59cb4';

const PUBLIC_TOOLS = [
  // Full modules folded into Toolbox — clicking these navigates to their panel.
  { id: 'tv4',  route: 'tv4',  name: 'Travel Plan',          desc: 'Trips · plans · expenses',   icon: '⊕', accent: COLORS.gold,  tag: 'TRAVEL' },
  { id: 'tech', route: 'tech', name: 'Subscription Manager', desc: 'Monthly + yearly burn',      icon: '⌬', accent: COLORS.green, tag: 'FINANCE' },
  { id: 'todo', route: 'todo', name: 'To Do',                desc: 'Priorities · localStorage',  icon: '✓', accent: COLORS.green, tag: 'TASKS' },
  { id: 'short',   nameKey: 'tools.short.name',   descKey: 'tools.short.desc',   icon: '/',  accent: COLORS.green, tag: 'WEB' },
  { id: 'pst',     nameKey: 'tools.pst.name',     descKey: 'tools.pst.desc',     icon: '¶',  accent: COLORS.green, tag: 'WEB' },
  { id: 'game',    nameKey: 'tools.game.name',    descKey: 'tools.game.desc',    icon: '◉',  accent: COLORS.gold,  tag: 'ARCHIVE' },
  { id: 'bmi',     nameKey: 'tools.bmi.name',     descKey: 'tools.bmi.desc',     icon: '⚖',  accent: COLORS.green, tag: 'HEALTH' },
  { id: 'convert', nameKey: 'tools.convert.name', descKey: 'tools.convert.desc', icon: '⇄',  accent: COLORS.gold,  tag: 'MEDIA' },
  { id: 'mic',     nameKey: 'tools.mic.name',     descKey: 'tools.mic.desc',     icon: '⏺',  accent: COLORS.red,   tag: 'MEDIA' },
  { id: 'hex',     nameKey: 'tools.hex.name',     descKey: 'tools.hex.desc',     icon: '0x', accent: COLORS.green, tag: 'DEV' },
  { id: '2fa',     nameKey: 'tools.2fa.name',     descKey: 'tools.2fa.desc',     icon: '2F', accent: COLORS.red,   tag: 'SECURITY' },
  { id: 'thao',    nameKey: 'tools.thao.name',    descKey: 'tools.thao.desc',    icon: '♥',  accent: PINK,         tag: 'PIN · 4 DIGIT' },
];
const PRIVATE_TOOLS = [
  { id: 'srv', nameKey: 'tools.srv.name', descKey: 'tools.srv.desc', icon: '⌬', accent: COLORS.red, tag: 'OWNER' },
  { id: 'fin', nameKey: 'tools.fin.name', descKey: 'tools.fin.desc', icon: '$', accent: COLORS.red, tag: 'OWNER' },
];

const THAO_PIN = '2609';

export function Toolbox({ nav }) {
  const { t } = useLang();
  const [tab, setTab] = useState('public');
  // Some "tools" are actually full modules (Travel / Subscriptions / To Do) —
  // clicking those navigates to their panel instead of opening inline.
  const toolName = (tool) => tool.name ?? t(tool.nameKey);
  const toolDesc = (tool) => tool.desc ?? t(tool.descKey);
  const openTool = (tool) => { if (tool.route && nav) nav(tool.route); else setActiveTool(tool); };
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState(false);
  const [activeTool, setActiveTool] = useState(null);

  // Phone shell (≤768) gets the dedicated mobile layout: full-width segmented
  // control + single-column horizontal tool rows. On desktop the cards are
  // 3-up, collapsing to 2 on a narrow desktop window.
  const isMobile = useMediaQuery('(max-width: 768px)');
  const tbMid = useMediaQuery('(max-width: 900px)');
  const toolCols = tbMid ? 2 : 3;

  // Sub-route #/tools/thao opens the Thảo letter directly.
  useEffect(() => {
    function syncFromHash() {
      const sub = window.location.hash.replace(/^#\//, '').split('/')[1] || '';
      if (sub === 'thao') {
        const t = PUBLIC_TOOLS.find((x) => x.id === 'thao');
        if (t) { setTab('public'); setActiveTool(t); }
      } else if (sub === '' && activeTool?.id === 'thao') {
        setActiveTool(null);
      }
    }
    syncFromHash();
    window.addEventListener('hashchange', syncFromHash);
    return () => window.removeEventListener('hashchange', syncFromHash);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push #/tools/thao when opening; clear when leaving.
  useEffect(() => {
    if (activeTool?.id === 'thao') {
      if (!/^#\/tools\/thao/.test(window.location.hash)) {
        window.history.replaceState(null, '', '#/tools/thao');
      }
    } else if (/^#\/tools\/thao/.test(window.location.hash)) {
      window.history.replaceState(null, '', '#/tools');
    }
  }, [activeTool]);

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
  const tbAccent = tab === 'public' ? COLORS.green : COLORS.red;
  const accent = tbAccent;
  const subtitle = tab === 'public'
    ? `${PUBLIC_TOOLS.length} public utilities — no sign-in`
    : (unlocked ? `${PRIVATE_TOOLS.length} private tools — owner only` : 'Locked zone — PIN required');

  // Segmented PUBLIC / PRIVATE — full-width on mobile, compact pill on desktop.
  const segmented = (
    <div style={{
      display: 'flex', gap: 6, padding: 5,
      background: COLORS.bg, border: '1px solid ' + COLORS.line,
      borderRadius: isMobile ? 13 : 12, flex: isMobile ? undefined : 'none',
    }}>
      {['public', 'private'].map((k) => {
        const active = tab === k;
        const c = k === 'public' ? COLORS.green : COLORS.red;
        return (
          <button
            key={k}
            onClick={() => { setTab(k); setActiveTool(null); }}
            className="mono tabtap"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: isMobile ? 7 : 8, flex: isMobile ? 1 : undefined,
              padding: isMobile ? '12px 0' : '10px 18px', borderRadius: 9,
              background: active ? c + '1f' : 'transparent',
              border: `1px solid ${active ? c + '73' : 'transparent'}`,
              color: active ? c : COLORS.muted,
              fontSize: isMobile ? 11 : 10.5, letterSpacing: '0.16em',
              textTransform: 'uppercase', fontWeight: 800, cursor: 'pointer',
              transition: 'all 180ms',
            }}
          >
            {k}
            {k === 'public' && <span style={{ fontSize: 9, color: active ? c : COLORS.muted }}>0{PUBLIC_TOOLS.length}</span>}
            {k === 'private' && !unlocked && <span style={{ fontSize: 11 }}>🔒</span>}
          </button>
        );
      })}
    </div>
  );

  const header = (
    <>
      <div className="mono" style={{
        fontSize: isMobile ? 9.5 : 10, letterSpacing: '0.26em', fontWeight: 800,
        color: tbAccent, transition: 'color 250ms',
      }}>02 · UTILITIES</div>
      <h1 className="mono" style={{
        fontSize: isMobile ? 32 : 34, margin: isMobile ? '8px 0 6px' : '10px 0 7px',
        color: COLORS.text, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1,
      }}>Toolbox<span style={{ color: tbAccent, transition: 'color 250ms' }}>.</span></h1>
      <p style={{ margin: 0, fontSize: isMobile ? 11.5 : 12.5, color: COLORS.muted, lineHeight: 1.5 }}>{subtitle}</p>
    </>
  );

  return (
    <Panel padding={0} style={{
      display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%',
      ...(isMobile ? { background: 'transparent', border: 'none', borderRadius: 0 } : {}),
    }}>
      {isMobile ? (
        <div style={{ padding: '6px 2px 0' }}>
          {header}
          <div style={{ marginTop: 16 }}>{segmented}</div>
        </div>
      ) : (
        <div style={{
          padding: '22px 24px', borderBottom: '1px solid ' + COLORS.line,
          display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24,
        }}>
          <div>{header}</div>
          {segmented}
        </div>
      )}

      <div style={{ flex: 1, padding: isMobile ? '16px 2px 4px' : 24, overflow: 'auto' }}>
        {tab === 'private' && !unlocked ? (
          <div style={{
            display: isMobile ? 'block' : 'grid', placeItems: 'center',
            minHeight: isMobile ? 0 : 360, animation: 'fadeUp 250ms ease-out',
          }}>
            <div className={isMobile ? 'mtap' : ''} style={{
              position: 'relative', overflow: 'hidden',
              padding: isMobile ? '34px 26px' : 36, textAlign: 'center',
              border: '1px solid ' + COLORS.line, borderRadius: isMobile ? 18 : 16,
              background: isMobile ? '#131010' : COLORS.bg,
              width: isMobile ? '100%' : undefined, maxWidth: isMobile ? undefined : 360,
              animation: err ? 'shake 350ms ease' : 'none',
              boxShadow: isMobile ? `0 18px 44px rgba(0,0,0,.45), 0 0 40px ${COLORS.red}14` : 'none',
            }}>
              {isMobile && <span className="msheen" />}
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
          <ToolDetail tool={activeTool} accent={activeTool.accent || accent} onBack={() => setActiveTool(null)} />
        ) : isMobile ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, animation: 'fadeUp 200ms ease-out' }}>
            {tools.map((tool) => {
              const a = tool.accent || accent;
              return (
                <button
                  key={tool.id}
                  onClick={() => openTool(tool)}
                  className="mtap"
                  style={{
                    position: 'relative', overflow: 'hidden', textAlign: 'left',
                    display: 'flex', alignItems: 'center', gap: 15, padding: '16px 18px',
                    border: '1px solid ' + COLORS.line, borderRadius: 15,
                    background: '#131010', cursor: 'pointer', color: COLORS.text,
                  }}
                >
                  <span className="msheen" />
                  <div className="mono" style={{
                    width: 50, height: 50, flex: 'none', display: 'grid', placeItems: 'center',
                    borderRadius: 13, border: `1px solid ${a}55`, background: a + '12',
                    color: a, fontSize: 20, fontWeight: 800,
                  }}>{tool.icon}</div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="mono" style={{
                        fontSize: 13, fontWeight: 800, letterSpacing: '0.03em', textTransform: 'uppercase',
                        color: COLORS.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>{toolName(tool)}</span>
                      <span className="mono" style={{
                        fontSize: 7.5, letterSpacing: '0.16em', fontWeight: 800, color: a,
                        border: `1px solid ${a}55`, borderRadius: 999, padding: '3px 8px', flex: 'none',
                      }}>{tool.tag}</span>
                    </div>
                    <div style={{ fontSize: 11, color: COLORS.muted, marginTop: 5, lineHeight: 1.5 }}>{toolDesc(tool)}</div>
                  </div>
                  <span className="mono" style={{ flex: 'none', fontSize: 16, color: a, fontWeight: 800 }}>›</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div style={{
            display: 'grid', gridTemplateColumns: `repeat(${toolCols}, minmax(0, 1fr))`,
            gap: 16, animation: 'fadeUp 200ms ease-out',
          }}>
            {tools.map((tool) => {
              const a = tool.accent || accent;
              return (
                <button
                  key={tool.id}
                  onClick={() => openTool(tool)}
                  className="tcard lit"
                  style={{
                    position: 'relative', overflow: 'hidden', textAlign: 'left',
                    display: 'flex', flexDirection: 'column', gap: 16, padding: 22,
                    border: '1px solid ' + COLORS.line, borderRadius: 14,
                    background: COLORS.bg, cursor: 'pointer', color: COLORS.text,
                    transition: 'transform 180ms, border-color 180ms, box-shadow 180ms',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-3px)';
                    e.currentTarget.style.borderColor = a + '70';
                    e.currentTarget.style.boxShadow = `0 18px 44px rgba(0,0,0,.4), 0 0 36px ${a}1f`;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.borderColor = COLORS.line;
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  <span className="sheen" />
                  <div className="wm mono" style={{
                    position: 'absolute', top: -30, right: -14, fontSize: 104, fontWeight: 800,
                    color: a + '12', lineHeight: 1, pointerEvents: 'none',
                  }}>{tool.icon}</div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div className="tile mono" style={{
                      width: 44, height: 44, display: 'grid', placeItems: 'center', borderRadius: 11,
                      border: `1px solid ${a}55`, background: a + '12', color: a,
                      fontSize: 18, fontWeight: 800,
                    }}>{tool.icon}</div>
                    <span className="mono" style={{
                      fontSize: 8.5, letterSpacing: '0.2em', fontWeight: 800, color: a,
                      border: `1px solid ${a}55`, borderRadius: 999, padding: '4px 10px',
                    }}>{tool.tag}</span>
                  </div>
                  <div>
                    <div className="mono" style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', color: COLORS.text }}>
                      {toolName(tool)}
                    </div>
                    <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 6, lineHeight: 1.5 }}>
                      {toolDesc(tool)}
                    </div>
                  </div>
                  <div className="mono" style={{
                    marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 8,
                    fontSize: 9.5, letterSpacing: '0.2em', fontWeight: 800, color: a,
                  }}>OPEN <span className="arrow">→</span></div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Panel>
  );
}

function ToolDetail({ tool, accent, onBack }) {
  const { t } = useLang();
  return (
    <div style={{ animation: 'fadeUp 200ms ease-out' }}>
      <div style={{ marginBottom: 18, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Btn onClick={onBack} variant="ghost">← Back</Btn>
        <div>
          <Kicker style={{ color: accent }}>{tool.icon} · TOOL</Kicker>
          <div className="mono" style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>{t(tool.nameKey)}</div>
        </div>
      </div>
      <div style={{
        border: '1px solid ' + COLORS.line, borderRadius: 12, padding: 22, background: COLORS.bg,
      }}>
        {tool.id === 'short'   ? <ShortenerTool accent={accent} /> :
         tool.id === 'pst'     ? <PastebinTool accent={accent} /> :
         tool.id === 'convert' ? <ConverterTool accent={accent} /> :
         tool.id === 'mic'     ? <VoiceRecorderTool accent={accent} /> :
         tool.id === 'hex'     ? <HexToTextTool accent={accent} /> :
         tool.id === 'bmi'     ? <BMICalculatorTool accent={accent} /> :
         tool.id === '2fa'     ? <TotpAuthenticatorTool accent={accent} /> :
         tool.id === 'fin'     ? <FinanceTool accent={accent} /> :
         tool.id === 'game'    ? <GameResourcesTool accent={accent} /> :
         tool.id === 'thao'    ? <ThaoTool onClose={onBack} /> :
         <PlaceholderTool tool={tool} accent={accent} />}
      </div>
    </div>
  );
}

// Letter-cosmic experience — gated by a 4-digit PIN, then opened in a new
// standalone tab so the standalone HTML keeps its scroll, audio, and particle
// stack intact without competing with the dashboard chrome.
function ThaoTool({ onClose }) {
  const [unlocked, setUnlocked] = usePersisted('se77n.tools.thao.unlocked', false);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState(false);
  const accent = '#f59cb4';

  function openLetter() {
    window.open('/thao/iuuuu', '_blank', 'noopener');
  }

  function tryUnlock() {
    if (pin === THAO_PIN) {
      setUnlocked(true);
      setErr(false);
      openLetter();
    } else {
      setErr(true);
      setTimeout(() => setErr(false), 600);
      setPin('');
    }
  }

  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: 360 }}>
      <div style={{
        padding: 36, textAlign: 'center', border: '1px solid ' + COLORS.line,
        borderRadius: 16, background: COLORS.bg, maxWidth: 380,
        animation: err ? 'shake 350ms ease' : 'fadeUp 250ms ease-out',
      }}>
        <div style={{
          width: 56, height: 56, margin: '0 auto 16px', borderRadius: 999,
          display: 'grid', placeItems: 'center',
          background: accent + '14', border: `1px solid ${accent}55`,
          fontSize: 26, color: accent,
        }}>♥</div>
        <div className="mono" style={{
          fontSize: 13, letterSpacing: '0.18em', textTransform: 'uppercase',
          color: COLORS.text, fontWeight: 700, marginBottom: 6,
        }}>Thảo</div>
        <div style={{ fontSize: 12, color: COLORS.muted, marginBottom: 22, lineHeight: 1.5 }}>
          {unlocked
            ? 'Bấm mở để xem lại lá thư (mở trong tab mới).'
            : 'Nhập 4 số bí mật để mở lá thư.'}
        </div>
        {unlocked ? (
          <Btn variant="solid" color={accent} onClick={openLetter} style={{ width: '100%' }}>
            ♥ Mở thư ↗
          </Btn>
        ) : (
          <>
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
              <Btn variant="solid" color={accent} onClick={tryUnlock} style={{ width: '100%' }}>
                Mở
              </Btn>
            </div>
            {err && (
              <div className="mono" style={{
                fontSize: 10, color: COLORS.red, marginTop: 12, letterSpacing: '0.12em',
              }}>✕ SAI MÃ</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ShortenerTool({ accent }) {
  const [url, setUrl] = useState('');
  const [alias, setAlias] = useState('');
  const [out, setOut] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function shorten() {
    if (busy) return;
    const u = url.trim();
    if (!u) { setErr('URL is required'); return; }
    setBusy(true); setErr(''); setOut(null);
    try {
      const r = await fetch('/api/toolbox?kind=short', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: u, alias: alias.trim() || undefined }),
      });
      const data = await r.json();
      if (!r.ok) { setErr(data.error || 'Failed'); return; }
      const fullUrl = `${window.location.origin}${data.path}`;
      setOut({ slug: data.slug, url: fullUrl });
    } catch (e) {
      setErr(e.message || 'Network error');
    } finally { setBusy(false); }
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
      <div>
        <Btn variant="solid" color={accent} onClick={shorten} disabled={busy}>
          {busy ? 'Shortening…' : 'Shorten'}
        </Btn>
      </div>
      {err && (
        <div className="mono" style={{
          padding: '10px 14px', borderRadius: 10,
          border: `1px solid ${COLORS.red}55`, background: COLORS.red + '0e',
          color: COLORS.red, fontSize: 12,
        }}>✕ {err}</div>
      )}
      {out && (
        <div style={{
          padding: 16, borderRadius: 10, border: `1px solid ${accent}55`,
          background: accent + '0e',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        }}>
          <a
            href={out.url}
            target="_blank"
            rel="noreferrer"
            className="mono"
            style={{ fontSize: 14, color: accent, fontWeight: 700, textDecoration: 'none', wordBreak: 'break-all' }}
          >{out.url}</a>
          <Btn variant="tinted" color={accent} onClick={() => copyText(out.url)}>Copy</Btn>
        </div>
      )}
    </div>
  );
}

function PastebinTool({ accent }) {
  const [text, setText] = useState('');
  const [saved, setSaved] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (busy) return;
    if (!text.trim()) { setErr('Content is empty'); return; }
    setBusy(true); setErr(''); setSaved(null);
    try {
      const r = await fetch('/api/toolbox?kind=paste', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text }),
      });
      const data = await r.json();
      if (!r.ok) { setErr(data.error || 'Failed'); return; }
      const fullUrl = `${window.location.origin}${data.viewUrl}`;
      setSaved({ id: data.id, url: fullUrl, len: text.length });
    } catch (e) {
      setErr(e.message || 'Network error');
    } finally { setBusy(false); }
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
        <Btn variant="solid" color={accent} onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save paste'}
        </Btn>
        <span className="mono" style={{ fontSize: 10, color: COLORS.muted }}>
          {text.length} chars · {(new Blob([text]).size / 1024).toFixed(1)} KB
        </span>
      </div>
      {err && (
        <div className="mono" style={{
          padding: '10px 14px', borderRadius: 10,
          border: `1px solid ${COLORS.red}55`, background: COLORS.red + '0e',
          color: COLORS.red, fontSize: 12,
        }}>✕ {err}</div>
      )}
      {saved && (
        <div style={{
          padding: 14, borderRadius: 10, border: `1px solid ${accent}55`,
          background: accent + '0e', display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', gap: 10,
        }}>
          <a
            href={saved.url}
            target="_blank"
            rel="noreferrer"
            className="mono"
            style={{ fontSize: 13, color: accent, fontWeight: 700, textDecoration: 'none', wordBreak: 'break-all' }}
          >{saved.url}</a>
          <Btn variant="tinted" color={accent} onClick={() => copyText(saved.url)}>Copy</Btn>
        </div>
      )}
    </div>
  );
}

function decodeHexUtf8(input) {
  const normalized = input
    .trim()
    .replace(/(?:0x|\\x)/gi, '')
    .replace(/[\s,;:_-]+/g, '');

  if (!normalized) throw new Error('Nhập mã HEX cần giải mã.');
  if (!/^[0-9a-f]+$/i.test(normalized)) {
    throw new Error('Mã HEX chỉ được chứa ký tự 0-9 và A-F.');
  }
  if (normalized.length % 2 !== 0) {
    throw new Error('Mã HEX phải có số ký tự chẵn.');
  }

  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < normalized.length; i += 2) {
    bytes[i / 2] = Number.parseInt(normalized.slice(i, i + 2), 16);
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('Chuỗi HEX không phải văn bản UTF-8 hợp lệ.');
  }
}

function HexToTextTool({ accent }) {
  const [hex, setHex] = useState('');
  const [output, setOutput] = useState('');
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);

  function convert() {
    try {
      setOutput(decodeHexUtf8(hex));
      setErr('');
    } catch (e) {
      setOutput('');
      setErr(e.message || 'Không thể giải mã chuỗi HEX.');
    }
  }

  function clear() {
    setHex('');
    setOutput('');
    setErr('');
    setCopied(false);
  }

  function copyOutput() {
    copyText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const textAreaStyle = {
    width: '100%', background: COLORS.bg, border: '1px solid ' + COLORS.line,
    borderRadius: 10, padding: 14, color: COLORS.text, fontSize: 13,
    resize: 'vertical', outline: 'none', lineHeight: 1.6,
  };

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div>
        <Kicker style={{ marginBottom: 8 }}>HEX INPUT</Kicker>
        <textarea
          value={hex}
          onChange={(e) => { setHex(e.target.value); setErr(''); }}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') convert();
          }}
          rows={7}
          className="mono"
          placeholder="48656c6c6f20576f726c64 or 0x48 0x65 0x6c 0x6c 0x6f"
          style={textAreaStyle}
        />
        <div className="mono" style={{ marginTop: 7, fontSize: 10, color: COLORS.muted }}>
          Hỗ trợ HEX liền nhau, khoảng trắng, dấu phẩy, 0x và \\x · Ctrl/⌘ + Enter để chuyển đổi
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Btn variant="solid" color={accent} onClick={convert} disabled={!hex.trim()}>
          Chuyển sang text
        </Btn>
        <Btn variant="ghost" onClick={clear} disabled={!hex && !output}>Xóa</Btn>
      </div>

      {err && (
        <div className="mono" style={{
          padding: '10px 14px', borderRadius: 10,
          border: `1px solid ${COLORS.red}55`, background: COLORS.red + '0e',
          color: COLORS.red, fontSize: 12,
        }}>✕ {err}</div>
      )}

      {output !== '' && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <Kicker style={{ color: accent }}>TEXT OUTPUT</Kicker>
            <Btn variant="tinted" color={accent} onClick={copyOutput}>
              {copied ? 'Đã sao chép' : 'Sao chép'}
            </Btn>
          </div>
          <textarea
            value={output}
            readOnly
            rows={7}
            style={{ ...textAreaStyle, borderColor: accent + '55' }}
          />
        </div>
      )}
    </div>
  );
}

// WHO BMI bands, scaled onto a 12–40 axis so the marker + segmented gauge
// share one coordinate space. Asia-Pacific cutoffs differ (overweight ≥23),
// but we keep the standard WHO bands and surface the healthy-weight RANGE for
// the user's height, which is the more actionable number anyway.
const BMI_BANDS = [
  { max: 18.5, label: 'Thiếu cân',   color: '#6aa0d8' },
  { max: 25,   label: 'Bình thường', color: COLORS.green },
  { max: 30,   label: 'Thừa cân',    color: COLORS.gold },
  { max: Infinity, label: 'Béo phì', color: COLORS.red },
];
const BMI_AXIS_MIN = 12;
const BMI_AXIS_MAX = 40;

function bmiBandFor(bmi) {
  return BMI_BANDS.find((b) => bmi < b.max) || BMI_BANDS[BMI_BANDS.length - 1];
}

function BMICalculatorTool({ accent }) {
  const [height, setHeight] = useState(''); // cm
  const [weight, setWeight] = useState(''); // kg

  const h = parseFloat(height.replace(',', '.'));
  const w = parseFloat(weight.replace(',', '.'));
  const valid = h > 0 && h < 300 && w > 0 && w < 600;

  const hM = h / 100;
  const bmi = valid ? w / (hM * hM) : null;
  const band = bmi != null ? bmiBandFor(bmi) : null;
  const idealMin = valid ? 18.5 * hM * hM : null;
  const idealMax = valid ? 24.9 * hM * hM : null;
  const markerPct = bmi == null
    ? 0
    : Math.max(0, Math.min(100, ((bmi - BMI_AXIS_MIN) / (BMI_AXIS_MAX - BMI_AXIS_MIN)) * 100));

  // Segment widths along the 12–40 axis, in %.
  const segments = BMI_BANDS.map((b, i) => {
    const lo = i === 0 ? BMI_AXIS_MIN : BMI_BANDS[i - 1].max;
    const hi = b.max === Infinity ? BMI_AXIS_MAX : b.max;
    return { color: b.color, pct: ((hi - lo) / (BMI_AXIS_MAX - BMI_AXIS_MIN)) * 100 };
  });

  function reset() { setHeight(''); setWeight(''); }

  const labelStyle = { marginBottom: 8 };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <Kicker style={labelStyle}>CHIỀU CAO (cm)</Kicker>
          <Field
            value={height}
            onChange={(v) => setHeight(v.replace(/[^\d.,]/g, ''))}
            placeholder="170"
            style={{ fontSize: 16 }}
          />
        </div>
        <div>
          <Kicker style={labelStyle}>CÂN NẶNG (kg)</Kicker>
          <Field
            value={weight}
            onChange={(v) => setWeight(v.replace(/[^\d.,]/g, ''))}
            placeholder="65"
            style={{ fontSize: 16 }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <Btn variant="ghost" onClick={reset} disabled={!height && !weight}>Xóa</Btn>
      </div>

      {bmi != null ? (
        <div style={{
          border: `1px solid ${band.color}55`, borderRadius: 12,
          padding: 20, background: band.color + '0e',
          animation: 'fadeUp 200ms ease-out',
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div className="mono" style={{ fontSize: 40, fontWeight: 800, color: band.color, lineHeight: 1 }}>
              {bmi.toFixed(1)}
            </div>
            <div className="mono" style={{
              fontSize: 12, letterSpacing: '0.16em', textTransform: 'uppercase',
              fontWeight: 800, color: band.color,
              border: `1px solid ${band.color}66`, borderRadius: 999, padding: '6px 14px',
            }}>{band.label}</div>
          </div>

          {/* Segmented WHO gauge + marker */}
          <div style={{ marginTop: 20, position: 'relative' }}>
            <div style={{ display: 'flex', height: 8, borderRadius: 999, overflow: 'hidden' }}>
              {segments.map((s, i) => (
                <div key={i} style={{ width: s.pct + '%', background: s.color, opacity: 0.85 }} />
              ))}
            </div>
            <div style={{
              position: 'absolute', top: -4, left: `calc(${markerPct}% - 1px)`,
              width: 2, height: 16, background: COLORS.text,
              boxShadow: '0 0 6px rgba(0,0,0,0.6)', transition: 'left 260ms ease',
            }} />
            <div className="mono" style={{
              display: 'flex', justifyContent: 'space-between',
              fontSize: 9, color: COLORS.muted, marginTop: 8, letterSpacing: '0.08em',
            }}>
              <span>18.5</span><span>25</span><span>30</span>
            </div>
          </div>

          <div className="mono" style={{ fontSize: 11.5, color: COLORS.muted, marginTop: 16, lineHeight: 1.6 }}>
            Cân nặng hợp lý cho {h} cm:{' '}
            <span style={{ color: COLORS.green, fontWeight: 700 }}>
              {idealMin.toFixed(1)}–{idealMax.toFixed(1)} kg
            </span>
          </div>
        </div>
      ) : (
        <div className="mono" style={{
          padding: '14px 16px', borderRadius: 10, border: '1px solid ' + COLORS.line,
          background: COLORS.bg, color: COLORS.muted, fontSize: 11.5, lineHeight: 1.6,
        }}>
          Nhập chiều cao &amp; cân nặng để tính BMI. Công thức:{' '}
          <span style={{ color: accent }}>cân nặng (kg) ÷ chiều cao² (m)</span>.
        </div>
      )}
    </div>
  );
}

function extractTotpSecret(input) {
  const value = input.trim();
  if (!value) throw new Error('empty');

  if (/^otpauth:\/\//i.test(value)) {
    try {
      const secret = new URL(value).searchParams.get('secret');
      if (!secret) throw new Error('missing');
      return secret;
    } catch {
      throw new Error('url');
    }
  }

  return value;
}

function decodeBase32(input) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const normalized = extractTotpSecret(input)
    .toUpperCase()
    .replace(/[\s-]+/g, '')
    .replace(/=+$/, '');

  if (!normalized) throw new Error('empty');
  if (!/^[A-Z2-7]+$/.test(normalized)) throw new Error('base32');

  let bits = 0;
  let bitCount = 0;
  const bytes = [];
  for (const char of normalized) {
    bits = (bits << 5) | alphabet.indexOf(char);
    bitCount += 5;
    if (bitCount >= 8) {
      bitCount -= 8;
      bytes.push((bits >>> bitCount) & 0xff);
      bits &= (1 << bitCount) - 1;
    }
  }

  if (!bytes.length) throw new Error('base32');
  return new Uint8Array(bytes);
}

async function generateTotp(input, timestamp = Date.now()) {
  if (!globalThis.crypto?.subtle) throw new Error('crypto');

  const keyBytes = decodeBase32(input);
  const counter = Math.floor(timestamp / 30000);
  const counterBytes = new ArrayBuffer(8);
  const view = new DataView(counterBytes);
  view.setUint32(0, Math.floor(counter / 0x100000000), false);
  view.setUint32(4, counter >>> 0, false);

  const key = await globalThis.crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'],
  );
  const signature = new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', key, counterBytes));
  const offset = signature[signature.length - 1] & 0x0f;
  const binary = (
    ((signature[offset] & 0x7f) << 24) |
    ((signature[offset + 1] & 0xff) << 16) |
    ((signature[offset + 2] & 0xff) << 8) |
    (signature[offset + 3] & 0xff)
  );
  return String(binary % 1000000).padStart(6, '0');
}

function TotpAuthenticatorTool({ accent }) {
  const { lang } = useLang();
  const [secret, setSecret] = useState('');
  const [activeSecret, setActiveSecret] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const period = Math.floor(now / 30000);
  const remaining = 30 - (Math.floor(now / 1000) % 30);
  const progress = ((30 - remaining) / 30) * 360;

  const labels = useMemo(() => (lang === 'vi' ? {
    input: 'SECRET KEY 2FA', placeholder: 'Nhập secret Base32 hoặc link otpauth://',
    generate: 'Lấy mã 2FA', generating: 'Đang tạo…', show: 'Hiện', hide: 'Ẩn',
    clear: 'Xóa', copy: 'Sao chép', copied: 'Đã sao chép', next: 'Mã mới sau',
    local: 'Mã được tạo ngay trên trình duyệt. Secret không được gửi hoặc lưu trên máy chủ.',
    empty: 'Nhập secret key 2FA.', base32: 'Secret Base32 không hợp lệ.',
    url: 'Link otpauth không hợp lệ hoặc thiếu secret.', crypto: 'Trình duyệt không hỗ trợ tạo mã TOTP.',
    failed: 'Không thể tạo mã 2FA.',
  } : {
    input: '2FA SECRET KEY', placeholder: 'Enter a Base32 secret or otpauth:// URL',
    generate: 'Generate code', generating: 'Generating…', show: 'Show', hide: 'Hide',
    clear: 'Clear', copy: 'Copy', copied: 'Copied', next: 'New code in',
    local: 'The code is generated in your browser. Your secret is never sent to or stored on the server.',
    empty: 'Enter a 2FA secret key.', base32: 'The Base32 secret is invalid.',
    url: 'The otpauth URL is invalid or missing its secret.', crypto: 'This browser cannot generate TOTP codes.',
    failed: 'Could not generate the 2FA code.',
  }), [lang]);

  const errorMessage = useCallback((error) => labels[error?.message] || labels.failed, [labels]);

  const updateCode = useCallback(async (value, timestamp) => {
    try {
      const nextCode = await generateTotp(value, timestamp);
      setCode(nextCode);
      setErr('');
      return true;
    } catch (error) {
      setCode('');
      setErr(errorMessage(error));
      return false;
    }
  }, [errorMessage]);

  useEffect(() => {
    if (!activeSecret) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [activeSecret]);

  useEffect(() => {
    if (activeSecret) updateCode(activeSecret, period * 30000);
  }, [activeSecret, period, updateCode]);

  async function activate() {
    if (busy) return;
    setBusy(true);
    const timestamp = Date.now();
    setNow(timestamp);
    const ok = await updateCode(secret, timestamp);
    setActiveSecret(ok ? secret : '');
    setBusy(false);
  }

  function reset() {
    setSecret('');
    setActiveSecret('');
    setCode('');
    setErr('');
    setCopied(false);
    setVisible(false);
  }

  function copyCode() {
    copyText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div>
        <Kicker style={{ marginBottom: 8 }}>{labels.input}</Kicker>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8 }}>
          <Field
            value={secret}
            onChange={(value) => {
              setSecret(value);
              setActiveSecret('');
              setCode('');
              setErr('');
            }}
            type={visible ? 'text' : 'password'}
            placeholder={labels.placeholder}
            onKeyDown={(e) => { if (e.key === 'Enter') activate(); }}
            autoFocus
          />
          <Btn variant="tinted" color={accent} onClick={() => setVisible((value) => !value)}>
            {visible ? labels.hide : labels.show}
          </Btn>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Btn variant="solid" color={accent} onClick={activate} disabled={!secret.trim() || busy}>
          {busy ? labels.generating : labels.generate}
        </Btn>
        <Btn variant="ghost" onClick={reset} disabled={!secret && !code}>{labels.clear}</Btn>
      </div>

      {err && (
        <div className="mono" style={{
          padding: '10px 14px', borderRadius: 10,
          border: `1px solid ${COLORS.red}55`, background: COLORS.red + '0e',
          color: COLORS.red, fontSize: 12,
        }}>✕ {err}</div>
      )}

      {code && (
        <div style={{
          padding: 22, borderRadius: 14, border: `1px solid ${accent}55`,
          background: accent + '0b', display: 'grid', gap: 16,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
            <button
              type="button"
              onClick={copyCode}
              className="mono"
              title={labels.copy}
              style={{
                border: 0, background: 'transparent', padding: 0, cursor: 'pointer',
                color: accent, fontSize: 'clamp(32px, 7vw, 52px)', fontWeight: 800,
                letterSpacing: '0.16em', lineHeight: 1, whiteSpace: 'nowrap',
              }}
            >{code.slice(0, 3)} {code.slice(3)}</button>
            <div style={{
              width: 58, height: 58, borderRadius: 999, flex: '0 0 auto',
              display: 'grid', placeItems: 'center',
              background: `conic-gradient(${accent} ${progress}deg, ${COLORS.line} ${progress}deg)`,
            }}>
              <div className="mono" style={{
                width: 48, height: 48, borderRadius: 999, display: 'grid', placeItems: 'center',
                background: COLORS.bg, color: remaining <= 5 ? COLORS.red : COLORS.text,
                fontSize: 15, fontWeight: 700,
              }}>{remaining}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span className="mono" style={{ color: COLORS.muted, fontSize: 10, letterSpacing: '0.08em' }}>
              {labels.next} {remaining}s
            </span>
            <Btn variant="tinted" color={accent} onClick={copyCode}>
              {copied ? labels.copied : labels.copy}
            </Btn>
          </div>
        </div>
      )}

      <div className="mono" style={{
        padding: '10px 14px', borderRadius: 10, background: COLORS.bg,
        border: '1px solid ' + COLORS.line, fontSize: 10, color: COLORS.muted, lineHeight: 1.6,
      }}>◇ {labels.local}</div>
    </div>
  );
}

// Combined Image / Video converter under a single tool entry. The two
// implementations stay separate components — they have different state
// shapes (canvas-encoded for image, ffmpeg-only for video) — but share
// one tile and one tab strip so users find both via "Converter".
function ConverterTool({ accent }) {
  const [mode, setMode] = useState('image'); // 'image' | 'video'
  const TABS = [
    { id: 'image', label: 'IMAGE', sub: 'PNG · JPG · WEBP · GIF' },
    { id: 'video', label: 'VIDEO', sub: 'FILE / LINK → GIF / MP3' },
  ];
  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div role="tablist" aria-label="Converter mode" style={{
        display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8,
      }}>
        {TABS.map((tab) => {
          const active = tab.id === mode;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setMode(tab.id)}
              className="mono"
              style={{
                cursor: 'pointer', textAlign: 'left',
                padding: '12px 14px',
                borderRadius: 10,
                border: `1px solid ${active ? accent : COLORS.line}`,
                background: active ? accent + '14' : 'transparent',
                color: active ? COLORS.text : COLORS.muted,
                transition: 'all 160ms ease',
              }}
              onMouseEnter={(e) => { if (!active) e.currentTarget.style.borderColor = accent + '55'; }}
              onMouseLeave={(e) => { if (!active) e.currentTarget.style.borderColor = COLORS.line; }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.18em', marginBottom: 2 }}>
                {tab.label}
              </div>
              <div style={{ fontSize: 10, letterSpacing: '0.1em', opacity: 0.7 }}>{tab.sub}</div>
            </button>
          );
        })}
      </div>
      {mode === 'image' ? <ImageConverterTool accent={accent} /> : <VideoToTool accent={accent} />}
    </div>
  );
}

function ImageConverterTool({ accent }) {
  const [src, setSrc] = useState(null);          // { name, size, file, dataUrl, w, h }
  const [srcFmt, setSrcFmt] = useState('png');   // detected from upload
  const [target, setTarget] = useState('webp');
  const [quality, setQuality] = useState(80);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [err, setErr] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [urlBusy, setUrlBusy] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const urlTimerRef = useRef(null);
  const urlRequestRef = useRef('');

  // Crop state — null = no crop applied. cropRect is normalized 0..1.
  const [cropOpen, setCropOpen] = useState(false);
  const [cropRect, setCropRect] = useState(null); // { x, y, w, h } in 0..1

  const FORMATS = ['png', 'jpg', 'webp', 'gif'];

  function detectFmt(name, mimeType) {
    const m = (mimeType || '').toLowerCase();
    if (m.includes('gif'))  return 'gif';
    if (m.includes('webp')) return 'webp';
    if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
    if (m.includes('png'))  return 'png';
    const ext = (name || '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
    if (ext === 'jpeg') return 'jpg';
    if (FORMATS.includes(ext)) return ext;
    return 'png';
  }

  function loadFile(f) {
    if (!f) return;
    const fmt = detectFmt(f.name, f.type);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target.result;
      const img = new Image();
      img.onload = () => setSrc({ name: f.name, size: f.size, file: f, dataUrl, w: img.width, h: img.height });
      img.onerror = () => setErr('This link does not point to a usable image.');
      img.src = dataUrl;
    };
    reader.readAsDataURL(f);
    if (fmt === 'gif') setTarget('webp');
    else if (fmt === 'webp') setTarget('gif');
    else setTarget('webp');
    setSrcFmt(fmt);
    setCropRect(null);
    setCropOpen(false);
    setErr(''); setStage('');
  }

  function onFile(e) {
    loadFile(e.target.files?.[0]);
  }

  function handleImageUrlChange(value) {
    setImageUrl(value);
    if (urlTimerRef.current) window.clearTimeout(urlTimerRef.current);
    const candidate = value.trim();
    if (!/^https?:\/\/\S+$/i.test(candidate)) return;
    urlTimerRef.current = window.setTimeout(() => loadImageUrl(candidate), 120);
  }

  function droppedImageUrl(dataTransfer) {
    const uriList = dataTransfer.getData('text/uri-list')
      .split(/\r?\n/).map((entry) => entry.trim()).find((entry) => entry && !entry.startsWith('#'));
    if (uriList) return uriList;
    const html = dataTransfer.getData('text/html');
    const imageMatch = html.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (imageMatch?.[1]) return imageMatch[1];
    const plain = dataTransfer.getData('text/plain').trim();
    return /^https?:\/\/\S+$/i.test(plain) ? plain : '';
  }

  function handleDrop(event) {
    event.preventDefault();
    setIsDragging(false);
    const imageFile = Array.from(event.dataTransfer.files || []).find((file) => file.type.startsWith('image/'));
    if (imageFile) { loadFile(imageFile); return; }
    const droppedUrl = droppedImageUrl(event.dataTransfer);
    if (droppedUrl) { setImageUrl(droppedUrl); loadImageUrl(droppedUrl); return; }
    setErr('Drop an image file or a direct image link.');
  }

  async function loadImageUrl(rawInput = imageUrl) {
    const raw = String(rawInput || '').trim();
    if (!raw) return;
    let parsed;
    try {
      parsed = new URL(raw);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('invalid protocol');
    } catch {
      setErr('Paste a direct http(s) image link.');
      return;
    }
    const requestKey = parsed.toString();
    if (urlRequestRef.current === requestKey) return;
    urlRequestRef.current = requestKey;
    setUrlBusy(true); setErr(''); setStage('Loading image link...');
    try {
      const response = await fetch(requestKey);
      if (!response.ok) throw new Error(`The image host returned ${response.status}.`);
      const blob = await response.blob();
      const mime = (blob.type || response.headers.get('content-type') || '').split(';')[0].toLowerCase();
      if (!mime.startsWith('image/')) throw new Error('That link does not point to an image.');
      const ext = mime === 'image/jpeg' ? 'jpg' : (mime.split('/')[1] || 'png');
      const fromPath = decodeURIComponent(parsed.pathname.split('/').pop() || 'image').replace(/[^a-z0-9._-]/gi, '-');
      const name = /\.[a-z0-9]+$/i.test(fromPath) ? fromPath : `${fromPath || 'image'}.${ext}`;
      loadFile(new File([blob], name, { type: mime }));
    } catch (error) {
      setErr(error?.message || 'Could not load this image link. Make sure it is a direct image URL that allows access.');
    } finally {
      if (urlRequestRef.current === requestKey) urlRequestRef.current = '';
      setUrlBusy(false); setStage('');
    }
  }
  function swap() {
    setSrcFmt(target);
    setTarget(srcFmt);
  }

  // Render the (optionally cropped) source onto a canvas at full
  // resolution and return it. Used for the canvas-encoded formats
  // (png/jpg/webp). Animated frames are lost here — that's fine, those
  // formats are static when the canvas path is chosen.
  function renderToCanvas() {
    return new Promise((resolve, reject) => {
      if (!src) return reject(new Error('no source'));
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        let sx = 0, sy = 0, sw = img.width, sh = img.height;
        if (cropRect) {
          sx = Math.round(cropRect.x * img.width);
          sy = Math.round(cropRect.y * img.height);
          sw = Math.max(1, Math.round(cropRect.w * img.width));
          sh = Math.max(1, Math.round(cropRect.h * img.height));
        }
        c.width = sw; c.height = sh;
        c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
        resolve(c);
      };
      img.onerror = reject;
      img.src = src.dataUrl;
    });
  }

  // FFmpeg path — handles GIF↔WebP↔anything while preserving animation.
  // Quality slider maps to GIF dither quality / WebP -quality flag, and
  // cropRect (if set) is applied via the ffmpeg `crop` filter so the
  // output reflects the same rect the user dragged.
  async function convertWithFFmpeg() {
    const ff = await getFFmpeg();
    const { fetchFile } = await import('@ffmpeg/util');
    const inExt = src.name.match(/\.[a-z0-9]+$/i)?.[0] || ('.' + srcFmt);
    const inputName  = 'in' + inExt;
    const outputName = 'out.' + target;

    setStage('Loading file…');
    await ff.writeFile(inputName, await fetchFile(src.file));

    // Build the filter chain. crop=w:h:x:y in source pixels.
    const filters = [];
    if (cropRect) {
      const cw = Math.max(1, Math.round(cropRect.w * src.w));
      const ch = Math.max(1, Math.round(cropRect.h * src.h));
      const cx = Math.round(cropRect.x * src.w);
      const cy = Math.round(cropRect.y * src.h);
      filters.push(`crop=${cw}:${ch}:${cx}:${cy}`);
    }

    let args = ['-i', inputName];
    if (target === 'gif') {
      // High-quality GIF: split, palettegen, paletteuse. Cap fps at 20
      // so file stays sane; users wanting full fps can convert offline.
      const palette = 'palette.png';
      const fpsFilter = 'fps=20';
      const baseChain = [fpsFilter, ...filters].join(',');
      // Pass 1: palette
      await ff.exec(['-i', inputName, '-vf', `${baseChain},palettegen=stats_mode=diff`, '-y', palette]);
      // Pass 2: encode
      await ff.exec([
        '-i', inputName, '-i', palette,
        '-filter_complex', `${baseChain}[v];[v][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
        '-loop', '0',
        '-y', outputName,
      ]);
    } else if (target === 'webp') {
      // Animated WebP. -loop 0 = infinite. -lossless 0 + -q:v from slider.
      const vfArg = filters.length ? ['-vf', filters.join(',')] : [];
      args = [
        '-i', inputName, ...vfArg,
        '-c:v', 'libwebp', '-lossless', '0', '-q:v', String(quality),
        '-loop', '0', '-an', '-vsync', '0',
        '-y', outputName,
      ];
      await ff.exec(args);
    } else {
      // png / jpg from animated source → first frame.
      const vfArg = filters.length ? ['-vf', filters.join(',')] : [];
      args = ['-i', inputName, ...vfArg, '-frames:v', '1', '-y', outputName];
      await ff.exec(args);
    }

    setStage('Reading output…');
    const data = await ff.readFile(outputName);
    const mime = target === 'gif'  ? 'image/gif'
              : target === 'webp' ? 'image/webp'
              : target === 'jpg'  ? 'image/jpeg'
              : 'image/png';
    return new Blob([data.buffer], { type: mime });
  }

  async function download() {
    if (!src || busy) return;
    setBusy(true); setErr(''); setStage('');
    try {
      // Animated paths (gif involved either way) need FFmpeg.
      const needsFFmpeg = srcFmt === 'gif' || target === 'gif' || (srcFmt === 'webp' && target === 'webp');
      let blob;
      if (needsFFmpeg) {
        setStage('Loading FFmpeg…');
        blob = await convertWithFFmpeg();
      } else {
        const c = await renderToCanvas();
        const mime = target === 'jpg' ? 'image/jpeg' : target === 'webp' ? 'image/webp' : 'image/png';
        blob = await new Promise((resolve) => c.toBlob(resolve, mime, quality / 100));
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = src.name.replace(/\.[^.]+$/, '') + (cropRect ? '-cropped' : '') + '.' + target;
      a.click();
      setStage('Done');
    } catch (e) {
      console.error('[imgc] convert failed', e);
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gap: 10 }}>
        <Kicker>1. ADD IMAGE</Kicker>
        <Field
          value={imageUrl}
          onChange={handleImageUrlChange}
          placeholder="Paste a direct image link - it loads automatically"
          style={{ padding: '15px 17px', fontSize: 14 }}
        />
        <div className="mono" style={{ fontSize: 11, color: urlBusy ? accent : COLORS.muted, letterSpacing: '0.05em' }}>
          {urlBusy ? 'LOADING IMAGE LINK...' : 'PASTE A LINK, OR USE THE DROP ZONE BELOW'}
        </div>
        <label
          onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
          onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setIsDragging(true); }}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setIsDragging(false); }}
          onDrop={handleDrop}
          style={{
            minHeight: 164, padding: 24, textAlign: 'center', borderRadius: 12, cursor: 'pointer',
            border: `2px dashed ${isDragging ? accent : COLORS.line}`,
            background: isDragging ? accent + '12' : COLORS.bg,
            transition: 'border-color 150ms, background 150ms',
            display: 'grid', placeItems: 'center',
          }}
        >
          <input type="file" accept="image/*,.gif,.webp" onChange={onFile} style={{ display: 'none' }} />
          {src ? (
            <div style={{ display: 'flex', gap: 18, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
              <img src={src.dataUrl} style={{ height: 100, maxWidth: 130, objectFit: 'cover', borderRadius: 8, border: `1px solid ${COLORS.line}` }} alt="" />
              <div style={{ textAlign: 'left' }}>
                <div className="mono" style={{ fontSize: 13, fontWeight: 700, color: COLORS.text }}>{src.name}</div>
                <div className="mono" style={{ fontSize: 11, color: COLORS.muted, marginTop: 6 }}>
                  {(src.size / 1024).toFixed(1)} KB - {src.w}x{src.h}{cropRect ? ` -> ${Math.round(cropRect.w * src.w)}x${Math.round(cropRect.h * src.h)}` : ''}
                </div>
                <div className="mono" style={{ fontSize: 10, color: accent, marginTop: 12, letterSpacing: '0.08em' }}>DROP ANOTHER IMAGE TO REPLACE</div>
              </div>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 32, color: accent, marginBottom: 11 }}>+</div>
              <div className="mono" style={{ fontSize: 14, color: COLORS.text, fontWeight: 700, letterSpacing: '0.09em' }}>DROP IMAGE HERE</div>
              <div className="mono" style={{ fontSize: 11, color: COLORS.muted, marginTop: 8, letterSpacing: '0.04em' }}>
                Drag a file from your device or an image/link from another website. Click to browse.
              </div>
            </div>
          )}
        </label>
      </div>

      {/* Source -> target format */}
      <div style={{ padding: 18, border: `1px solid ${COLORS.line}`, borderRadius: 12, background: COLORS.bg }}>
        <Kicker style={{ marginBottom: 14 }}>2. CHOOSE FORMAT</Kicker>
        <div style={{ display: 'flex', alignItems: 'end', gap: 18, flexWrap: 'wrap' }}>
          <div style={{ display: 'grid', gap: 8 }}>
            <div className="mono" style={{ fontSize: 10, color: COLORS.muted, letterSpacing: '0.12em' }}>SOURCE</div>
            <FmtPills value={srcFmt} options={FORMATS} accent={accent} onChange={setSrcFmt} dim />
          </div>
          <button
            type="button"
            onClick={swap}
            title="Swap source and target formats"
            aria-label="Swap formats"
            style={{
              border: `1px solid ${accent}77`, background: accent + '12', color: accent,
              width: 50, height: 50, borderRadius: 12, cursor: 'pointer', fontSize: 21, lineHeight: 1,
              display: 'grid', placeItems: 'center', transition: 'all 160ms ease',
            }}
            onMouseEnter={(event) => { event.currentTarget.style.background = accent + '24'; }}
            onMouseLeave={(event) => { event.currentTarget.style.background = accent + '12'; }}
          >⇄</button>
          <div style={{ display: 'grid', gap: 8 }}>
            <div className="mono" style={{ fontSize: 10, color: accent, letterSpacing: '0.12em' }}>CONVERT TO</div>
            <FmtPills value={target} options={FORMATS} accent={accent} onChange={setTarget} />
          </div>
        </div>
        {(srcFmt === 'gif' || target === 'gif') && (
          <div className="mono" style={{ fontSize: 10, color: COLORS.muted, marginTop: 14, letterSpacing: '0.05em' }}>
            GIF and WebP keep animation. First use loads FFmpeg once in your browser.
          </div>
        )}
      </div>

      <div>
        <Kicker style={{ marginBottom: 10 }}>3. QUALITY - {quality}</Kicker>
        <input
          type="range" min="20" max="100" value={quality}
          onChange={(event) => setQuality(+event.target.value)}
          style={{ width: '100%', accentColor: accent, height: 22, cursor: 'pointer' }}
        />
      </div>

      {/* Crop controls — opens an inline cropper that renders the source
          and lets the user drag a rectangle. cropRect is in 0..1 so it
          survives quality / format changes without re-clipping. */}
      {src && (
        <div>
          <Kicker style={{ marginBottom: 8 }}>CROP {cropRect ? '· APPLIED' : '· OFF'}</Kicker>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Btn variant={cropOpen ? 'tinted' : 'ghost'} color={accent} onClick={() => setCropOpen((v) => !v)}>
              {cropOpen ? 'Đóng cropper' : 'Mở crop'}
            </Btn>
            {cropRect && (
              <Btn variant="ghost" color={accent} onClick={() => setCropRect(null)}>
                Xoá vùng crop
              </Btn>
            )}
          </div>
          {cropOpen && (
            <div style={{ marginTop: 12 }}>
              <CropCanvas
                src={src}
                value={cropRect}
                onChange={setCropRect}
                accent={accent}
              />
            </div>
          )}
        </div>
      )}

      <Btn variant="solid" color={accent} onClick={download} disabled={!src || busy}>
        {busy ? (stage || 'Working…') : `Convert ${cropRect ? '+ Crop ' : ''}& Download`}
      </Btn>
      {err && (
        <div className="mono" style={{ fontSize: 11, color: '#c46868', whiteSpace: 'pre-wrap' }}>
          {err}
        </div>
      )}
    </div>
  );
}

// Compact pill row for source / target format. `dim` styles the source
// chip a touch lower-key so the visual hierarchy reads "SRC → TGT".
function FmtPills({ value, options, onChange, accent, dim }) {
  return (
    <div style={{ display: 'flex', gap: 6, opacity: dim ? 0.85 : 1 }}>
      {options.map((f) => (
        <Btn key={f} variant={value === f ? 'tinted' : 'ghost'} color={accent} onClick={() => onChange(f)} style={{ minWidth: 66, minHeight: 50, padding: '13px 17px', fontSize: 13 }}>
          {f.toUpperCase()}
        </Btn>
      ))}
    </div>
  );
}

// Inline cropper — preview-sized canvas with a drag-and-resize rectangle.
// Outputs a normalized rect (0..1) so the parent can apply it at the
// source's full resolution at convert time.
function CropCanvas({ src, value, onChange, accent }) {
  const wrapRef = React.useRef(null);
  const [box, setBox] = React.useState(value || { x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
  const [drag, setDrag] = React.useState(null); // { mode: 'move'|'tl'|'tr'|'bl'|'br'|'new', startX, startY, start: box }

  React.useEffect(() => { onChange(box); }, [box]);

  // Convert pointer coords (in CSS px relative to the wrapper) to 0..1.
  function toNorm(e) {
    const r = wrapRef.current.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top)  / r.height;
    return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
  }

  function clamp(b) {
    const minSide = 0.02;
    let { x, y, w, h } = b;
    w = Math.max(minSide, w);
    h = Math.max(minSide, h);
    x = Math.max(0, Math.min(1 - w, x));
    y = Math.max(0, Math.min(1 - h, y));
    return { x, y, w, h };
  }

  function onPointerDown(e, mode) {
    e.preventDefault();
    const p = toNorm(e);
    if (mode === 'new') {
      // Start a fresh rectangle from this point.
      setBox({ x: p.x, y: p.y, w: 0.001, h: 0.001 });
      setDrag({ mode: 'br', startX: p.x, startY: p.y, start: { x: p.x, y: p.y, w: 0, h: 0 } });
    } else {
      setDrag({ mode, startX: p.x, startY: p.y, start: { ...box } });
    }
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
  }

  function onPointerMove(e) {
    setDrag((d) => {
      if (!d) return d;
      const p = toNorm(e);
      const dx = p.x - d.startX;
      const dy = p.y - d.startY;
      let next = { ...d.start };
      if (d.mode === 'move') {
        next.x = d.start.x + dx;
        next.y = d.start.y + dy;
      } else {
        // Resize handles: each corner anchors the opposite corner.
        let x1 = d.start.x, y1 = d.start.y, x2 = d.start.x + d.start.w, y2 = d.start.y + d.start.h;
        if (d.mode === 'tl') { x1 = d.start.x + dx; y1 = d.start.y + dy; }
        if (d.mode === 'tr') { x2 = d.start.x + d.start.w + dx; y1 = d.start.y + dy; }
        if (d.mode === 'bl') { x1 = d.start.x + dx; y2 = d.start.y + d.start.h + dy; }
        if (d.mode === 'br') { x2 = d.start.x + d.start.w + dx; y2 = d.start.y + d.start.h + dy; }
        if (x2 < x1) [x1, x2] = [x2, x1];
        if (y2 < y1) [y2, y1] = [y1, y2];
        next = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
      }
      setBox(clamp(next));
      return d;
    });
  }
  function onPointerUp() {
    setDrag(null);
    window.removeEventListener('pointermove', onPointerMove);
  }

  // Compute display dims so the cropper fits a comfy max width while
  // preserving the source aspect ratio.
  const maxW = 560;
  const ratio = src.w / src.h;
  const dispW = Math.min(maxW, src.w);
  const dispH = dispW / ratio;

  const pct = (n) => `${(n * 100).toFixed(2)}%`;

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div
        ref={wrapRef}
        onPointerDown={(e) => {
          // Start a fresh rect only if the user clicked the empty image
          // area (not on the existing rect or its handles).
          if (e.target === wrapRef.current || e.target.tagName === 'IMG') {
            onPointerDown(e, 'new');
          }
        }}
        style={{
          position: 'relative',
          width: dispW, maxWidth: '100%',
          aspectRatio: `${src.w} / ${src.h}`,
          background: '#000',
          borderRadius: 10,
          overflow: 'hidden',
          touchAction: 'none',
          userSelect: 'none',
          border: `1px solid ${COLORS.line}`,
        }}
      >
        <img
          src={src.dataUrl}
          alt=""
          draggable={false}
          style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover', pointerEvents: 'none' }}
        />
        {/* Dimming mask outside the rect — 4 strips so we don't fight
            the crop rect's own pointer events. */}
        <div style={{ position: 'absolute', left: 0, top: 0, right: 0, height: pct(box.y), background: 'rgba(0,0,0,0.55)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', left: 0, top: pct(box.y + box.h), right: 0, bottom: 0, background: 'rgba(0,0,0,0.55)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', left: 0, top: pct(box.y), width: pct(box.x), height: pct(box.h), background: 'rgba(0,0,0,0.55)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', left: pct(box.x + box.w), top: pct(box.y), right: 0, height: pct(box.h), background: 'rgba(0,0,0,0.55)', pointerEvents: 'none' }} />

        {/* Rect itself */}
        <div
          onPointerDown={(e) => { e.stopPropagation(); onPointerDown(e, 'move'); }}
          style={{
            position: 'absolute',
            left: pct(box.x), top: pct(box.y),
            width: pct(box.w), height: pct(box.h),
            border: `1.5px solid ${accent}`,
            boxShadow: `0 0 0 1px ${accent}55, 0 0 0 9999px transparent inset`,
            cursor: 'move',
          }}
        >
          {/* Handles */}
          {[
            { k: 'tl', s: { left: -6, top: -6, cursor: 'nwse-resize' } },
            { k: 'tr', s: { right: -6, top: -6, cursor: 'nesw-resize' } },
            { k: 'bl', s: { left: -6, bottom: -6, cursor: 'nesw-resize' } },
            { k: 'br', s: { right: -6, bottom: -6, cursor: 'nwse-resize' } },
          ].map(({ k, s }) => (
            <div
              key={k}
              onPointerDown={(e) => { e.stopPropagation(); onPointerDown(e, k); }}
              style={{
                position: 'absolute',
                width: 12, height: 12,
                background: accent,
                border: '2px solid #0d0a08',
                borderRadius: 2,
                ...s,
              }}
            />
          ))}
        </div>
      </div>
      <div className="mono" style={{ fontSize: 10, color: COLORS.muted, letterSpacing: '0.1em' }}>
        {Math.round(box.x * src.w)},{Math.round(box.y * src.h)} · {Math.round(box.w * src.w)}×{Math.round(box.h * src.h)} px
      </div>
    </div>
  );
}

// Module-level singleton — FFmpeg core stays loaded across renders + tool re-opens.
// Loaded lazily on first convert; ~25 MB download from CDN once per browser session.
//
// We use ESM build (not UMD): @ffmpeg/ffmpeg uses a module worker which
// `import()`s the core, and UMD doesn't import cleanly as ESM. ESM URLs work
// directly via dynamic import — no toBlobURL needed; module workers allow
// cross-origin imports when CDN sends proper CORS headers (unpkg/jsdelivr do).
let ffmpegInstance = null;
let ffmpegLoading = null;
const FFMPEG_CORE_VERSION = '0.12.6';
const FFMPEG_CDN_BASES = [
  `https://unpkg.com/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/esm`,
  `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/esm`,
];

async function getFFmpeg() {
  if (ffmpegInstance) return ffmpegInstance;
  if (ffmpegLoading) return ffmpegLoading;
  ffmpegLoading = (async () => {
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    let lastErr;
    for (const baseURL of FFMPEG_CDN_BASES) {
      try {
        const ff = new FFmpeg();
        await ff.load({
          coreURL: `${baseURL}/ffmpeg-core.js`,
          wasmURL: `${baseURL}/ffmpeg-core.wasm`,
        });
        ffmpegInstance = ff;
        return ff;
      } catch (e) {
        console.warn('[ffmpeg] CDN failed', baseURL, e);
        lastErr = e;
      }
    }
    throw new Error(`FFmpeg core load failed from all CDNs: ${lastErr?.message || lastErr}`);
  })();
  try { return await ffmpegLoading; }
  finally { ffmpegLoading = null; }
}

function VideoToTool({ accent }) {
  const [src, setSrc] = useState(null);
  const [duration, setDuration] = useState(0);
  const [mode, setMode] = useState('mp3');
  const [fps, setFps] = useState(10);
  const [width, setWidth] = useState(480);
  const [bitrate, setBitrate] = useState('192k');
  const [startTime, setStartTime] = useState(0);
  const [clipLen, setClipLen] = useState(8);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState('');
  const [output, setOutput] = useState(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [urlBusy, setUrlBusy] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const videoRef = useRef(null);
  const urlRequestRef = useRef('');

  function clearOutput() {
    if (output) { URL.revokeObjectURL(output.url); setOutput(null); }
  }

  function loadVideoFile(f, displayName) {
    if (!f) return;
    clearOutput();
    setSrc((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      const name = displayName || f.name || 'video.mp4';
      return { name, size: f.size, url: URL.createObjectURL(f), file: f };
    });
    setErr(''); setProgress(0); setStage(''); setStartTime(0); setDuration(0);
  }

  function onFile(e) {
    loadVideoFile(e.target.files?.[0]);
  }

  function onMetadata() {
    if (!videoRef.current) return;
    const d = videoRef.current.duration;
    if (Number.isFinite(d)) {
      setDuration(d);
      setClipLen(Math.min(8, Math.max(1, Math.floor(d))));
    }
  }

  function droppedVideoUrl(dataTransfer) {
    const uriList = dataTransfer.getData('text/uri-list')
      .split(/\r?\n/).map((entry) => entry.trim()).find((entry) => entry && !entry.startsWith('#'));
    if (uriList) return uriList;
    const plain = dataTransfer.getData('text/plain').trim();
    return /^https?:\/\/\S+$/i.test(plain) ? plain : '';
  }

  function handleDrop(event) {
    event.preventDefault();
    setIsDragging(false);
    const videoFile = Array.from(event.dataTransfer.files || []).find((file) =>
      file.type.startsWith('video/') || file.type.startsWith('audio/'));
    if (videoFile) { loadVideoFile(videoFile); return; }
    const droppedUrl = droppedVideoUrl(event.dataTransfer);
    if (droppedUrl) { setVideoUrl(droppedUrl); loadVideoUrl(droppedUrl); return; }
    setErr('Drop a video/audio file or a media link.');
  }

  async function adoptBlobAsOutput(blob, filename, outMode = 'mp3') {
    clearOutput();
    const ext = outMode === 'mp3' ? 'mp3' : (filename.match(/\.([a-z0-9]+)$/i)?.[1] || 'bin');
    const mime = outMode === 'mp3' ? 'audio/mpeg' : (blob.type || 'application/octet-stream');
    const named = /\.[a-z0-9]+$/i.test(filename) ? filename : `${filename}.${ext}`;
    const url = URL.createObjectURL(blob);
    setMode(outMode);
    setOutput({ url, name: named, size: blob.size, mode: outMode });
    setSrc(null);
    setStage('Done');
    setProgress(1);
  }

  async function fetchBlob(url, label = 'Downloading…') {
    setStage(label);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Download failed (${response.status}).`);
    return response.blob();
  }

  async function loadVideoUrl(rawInput = videoUrl) {
    const raw = String(rawInput || '').trim();
    if (!raw) return;
    let parsed;
    try {
      parsed = new URL(raw);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('invalid protocol');
    } catch {
      setErr('Paste an http(s) video link or direct media URL.');
      return;
    }
    const requestKey = parsed.toString();
    if (urlRequestRef.current === requestKey) return;
    urlRequestRef.current = requestKey;
    setUrlBusy(true); setErr(''); setProgress(0); setStage('Resolving link…');

    try {
      const prefer = mode === 'gif' ? 'video' : 'audio';
      const r = await fetch('/api/toolbox?kind=media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: requestKey, prefer, bitrate }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(data.error || `Could not resolve link (${r.status})`
          + (data.hint ? ` — ${data.hint}` : ''));
      }

      if (data.mode === 'download' && data.downloadUrl) {
        const blob = await fetchBlob(data.downloadUrl, 'Fetching media from link…');
        const mime = (blob.type || '').split(';')[0].toLowerCase();
        const filename = data.filename || 'media';
        const isAudio = data.kind === 'audio' || mime.startsWith('audio/');
        if (isAudio) {
          const outBlob = mime.startsWith('audio/')
            ? blob
            : new Blob([blob], { type: 'audio/mpeg' });
          const base = filename.replace(/\.[^.]+$/, '') || 'audio';
          await adoptBlobAsOutput(outBlob, `${base}.mp3`, 'mp3');
          return;
        }
        // Video from platform — load into converter for GIF / MP3 trim.
        const name = /\.[a-z0-9]+$/i.test(filename) ? filename : `${filename}.mp4`;
        loadVideoFile(new File([blob], name, { type: mime || 'video/mp4' }), name);
        setStage('');
        return;
      }

      // Direct URL — fetch in the browser (same idea as image converter).
      const blob = await fetchBlob(data.url || requestKey, 'Loading media link…');
      const mime = (blob.type || '').split(';')[0].toLowerCase();
      const fromPath = decodeURIComponent(parsed.pathname.split('/').pop() || 'media').replace(/[^a-z0-9._-]/gi, '-');
      if (mime.startsWith('audio/') || data.kind === 'audio') {
        const ext = mime === 'audio/mpeg' ? 'mp3' : (mime.split('/')[1] || 'mp3');
        const name = /\.[a-z0-9]+$/i.test(fromPath) ? fromPath : `${fromPath || 'audio'}.${ext}`;
        await adoptBlobAsOutput(new Blob([blob], { type: mime || 'audio/mpeg' }), name, 'mp3');
        return;
      }
      if (!mime.startsWith('video/') && !mime.startsWith('application/octet-stream') && mime !== '') {
        // Some hosts omit/wrong content-type; still try as video if URL looks like media.
        if (!/\.(mp4|webm|mov|mkv|m4v|avi)(?:$|[?#])/i.test(requestKey)) {
          throw new Error('That link does not point to a video or audio file.');
        }
      }
      const ext = mime.includes('webm') ? 'webm' : mime.includes('quicktime') ? 'mov' : 'mp4';
      const name = /\.[a-z0-9]+$/i.test(fromPath) ? fromPath : `${fromPath || 'video'}.${ext}`;
      loadVideoFile(new File([blob], name, { type: mime || `video/${ext}` }), name);
      setStage('');
    } catch (error) {
      const msg = error?.message || 'Could not load this link.';
      const corsHint = /Failed to fetch|NetworkError|CORS/i.test(msg)
        ? ' The host may block browser downloads (CORS) — try uploading the file, or use a Cobalt instance for YouTube/TikTok.'
        : '';
      setErr(msg + corsHint);
      setStage('');
    } finally {
      if (urlRequestRef.current === requestKey) urlRequestRef.current = '';
      setUrlBusy(false);
    }
  }

  async function convert() {
    if (!src || busy) return;
    setBusy(true); setErr(''); clearOutput(); setProgress(0); setStage('Loading FFmpeg…');

    const logs = [];
    const onLog = ({ message }) => { logs.push(message); };
    const onProgress = ({ progress }) => setProgress(Math.max(0, Math.min(1, progress)));
    let ff = null;
    try {
      ff = await getFFmpeg();
      const { fetchFile } = await import('@ffmpeg/util');
      ff.on('log', onLog);
      ff.on('progress', onProgress);

      const inputName = 'input' + (src.name.match(/\.[a-z0-9]+$/i)?.[0] || '.mp4');
      setStage('Loading file…');
      await ff.writeFile(inputName, await fetchFile(src.file));

      const args = ['-ss', String(startTime), '-i', inputName, '-t', String(clipLen)];
      let outName, mime, outExt;

      if (mode === 'gif') {
        outExt = 'gif'; outName = 'out.gif'; mime = 'image/gif';
        args.push('-vf', `fps=${fps},scale=${width}:-2:flags=lanczos`, '-loop', '0', outName);
      } else {
        outExt = 'mp3'; outName = 'out.mp3'; mime = 'audio/mpeg';
        args.push('-vn', '-acodec', 'libmp3lame', '-b:a', bitrate, outName);
      }

      setStage(mode === 'gif' ? 'Converting to GIF…' : 'Extracting MP3…');
      try {
        await ff.exec(args);
      } catch (execErr) {
        const tail = logs.slice(-8).join(' | ');
        const code = typeof execErr === 'number' ? execErr : (execErr?.message ?? String(execErr));
        throw new Error(`FFmpeg exec failed (${code}). Last log: ${tail || '(empty — check console)'}`);
      }

      let data;
      try { data = await ff.readFile(outName); }
      catch {
        const tail = logs.slice(-8).join(' | ');
        throw new Error(`Output file not produced. Last log: ${tail || '(empty)'}`);
      }

      const blob = new Blob([data.buffer], { type: mime });
      const url = URL.createObjectURL(blob);
      const base = src.name.replace(/\.[^.]+$/, '');
      setOutput({ url, name: `${base}.${outExt}`, size: blob.size, mode });
      setStage('Done');
      setProgress(1);

      try { await ff.deleteFile(inputName); } catch {}
      try { await ff.deleteFile(outName); } catch {}
    } catch (e) {
      console.error('[ffmpeg]', e, '\n— logs —\n', logs.join('\n'));
      setErr(e?.message || String(e) || 'Conversion failed (check browser console for details)');
      setStage('');
    } finally {
      try { ff?.off?.('log', onLog); } catch {}
      try { ff?.off?.('progress', onProgress); } catch {}
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gap: 8 }}>
        <Kicker>LINK → AUDIO / VIDEO</Kicker>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
          <Field
            value={videoUrl}
            onChange={setVideoUrl}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); loadVideoUrl(); } }}
            placeholder="Paste YouTube / TikTok / direct .mp4 · .webm · audio URL"
            style={{ padding: '15px 17px', fontSize: 14 }}
          />
          <Btn variant="tinted" color={accent} disabled={urlBusy || !videoUrl.trim()}
            onClick={() => loadVideoUrl()}>
            {urlBusy ? 'Loading…' : 'Load'}
          </Btn>
        </div>
        <div className="mono" style={{ fontSize: 11, color: urlBusy ? accent : COLORS.muted, letterSpacing: '0.05em', lineHeight: 1.5 }}>
          {urlBusy
            ? (stage || 'RESOLVING LINK…')
            : 'Direct media links load in-browser. YouTube / TikTok need COBALT_API_URL (optional env).'}
        </div>
      </div>

      <Kicker>OR UPLOAD VIDEO</Kicker>
      <label
        onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setIsDragging(true); }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setIsDragging(false); }}
        onDrop={handleDrop}
        style={{
          padding: 32, textAlign: 'center', borderRadius: 12, cursor: 'pointer',
          border: `2px dashed ${isDragging ? accent : COLORS.line}`,
          background: isDragging ? accent + '12' : COLORS.bg,
          transition: 'border-color 150ms, background 150ms',
        }}
      >
        <input type="file" accept="video/*,audio/*" onChange={onFile} style={{ display: 'none' }} />
        {src ? (
          <div>
            <video ref={videoRef} src={src.url} controls onLoadedMetadata={onMetadata}
              style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 8 }} />
            <div className="mono" style={{ fontSize: 11, color: COLORS.muted, marginTop: 8 }}>
              {src.name} · {(src.size / 1024 / 1024).toFixed(2)} MB
              {duration > 0 && ` · ${duration.toFixed(1)}s`}
            </div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 28, color: COLORS.muted, marginBottom: 8 }}>▶</div>
            <div className="mono" style={{ fontSize: 12, color: COLORS.muted, letterSpacing: '0.1em' }}>
              DROP FILE / LINK · OR CLICK TO BROWSE
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

      {src && (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <Kicker style={{ marginBottom: 8 }}>START · {startTime.toFixed(1)}s</Kicker>
              <input type="range" min="0" max={Math.max(0, duration - 0.5)} step="0.1"
                value={startTime} onChange={(e) => setStartTime(+e.target.value)}
                style={{ width: '100%', accentColor: accent }} />
            </div>
            <div>
              <Kicker style={{ marginBottom: 8 }}>DURATION · {clipLen}s</Kicker>
              <input type="range" min="1" max={Math.max(1, Math.floor(duration - startTime) || 1)} step="1"
                value={clipLen} onChange={(e) => setClipLen(+e.target.value)}
                style={{ width: '100%', accentColor: accent }} />
            </div>
          </div>

          {mode === 'gif' ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <Kicker style={{ marginBottom: 8 }}>FPS · {fps}</Kicker>
                <input type="range" min="5" max="24" step="1"
                  value={fps} onChange={(e) => setFps(+e.target.value)}
                  style={{ width: '100%', accentColor: accent }} />
              </div>
              <div>
                <Kicker style={{ marginBottom: 8 }}>WIDTH · {width}px</Kicker>
                <input type="range" min="240" max="960" step="40"
                  value={width} onChange={(e) => setWidth(+e.target.value)}
                  style={{ width: '100%', accentColor: accent }} />
              </div>
            </div>
          ) : (
            <div>
              <Kicker style={{ marginBottom: 8 }}>BITRATE</Kicker>
              <div style={{ display: 'flex', gap: 6 }}>
                {['128k', '192k', '320k'].map((b) => (
                  <Btn key={b} variant={bitrate === b ? 'tinted' : 'ghost'} color={accent}
                    onClick={() => setBitrate(b)}>{b}</Btn>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mono" style={{
        padding: '10px 14px', borderRadius: 10, background: COLORS.bg,
        border: '1px solid ' + COLORS.line, fontSize: 11, color: COLORS.muted, lineHeight: 1.5,
      }}>
        ◇ File / direct-link conversion runs in your browser via ffmpeg.wasm (~25 MB lib, cached). Platform-link audio uses Cobalt when configured — nothing is stored on our servers.
      </div>

      {(busy || urlBusy || progress > 0) && (
        <div>
          <div className="mono" style={{ fontSize: 11, color: COLORS.muted, marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
            <span>{stage}</span>
            <span>{Math.round(progress * 100)}%</span>
          </div>
          <div style={{ height: 4, background: COLORS.line, borderRadius: 4, overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${progress * 100}%`,
              background: accent, transition: 'width 120ms',
            }} />
          </div>
        </div>
      )}

      {err && (
        <div className="mono" style={{
          padding: '10px 14px', borderRadius: 10,
          border: `1px solid ${COLORS.red}55`, background: COLORS.red + '0e',
          color: COLORS.red, fontSize: 12,
        }}>✕ {err}</div>
      )}

      {output && (
        <div style={{
          padding: 14, borderRadius: 12, border: `1px solid ${accent}55`,
          background: accent + '08', display: 'grid', gap: 10,
        }}>
          {output.mode === 'gif' ? (
            <img src={output.url} alt="GIF preview" style={{ maxWidth: '100%', borderRadius: 8 }} />
          ) : (
            <audio src={output.url} controls style={{ width: '100%' }} />
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <div className="mono" style={{ fontSize: 11, color: COLORS.muted }}>
              {output.name} · {(output.size / 1024).toFixed(1)} KB
            </div>
            <a href={output.url} download={output.name} style={{ textDecoration: 'none' }}>
              <Btn variant="solid" color={accent}>↓ Download</Btn>
            </a>
          </div>
        </div>
      )}

      <Btn variant="solid" color={accent} disabled={!src || busy || urlBusy} onClick={convert}>
        {busy ? 'Converting…' : 'Convert'}
      </Btn>
    </div>
  );
}

// ── Voice Recorder ─────────────────────────────────────────────
// Captures the mic and exports a clean MP3. "Clarity" is applied in two
// places: (1) at capture — the browser's own echo-cancel / noise-suppress /
// auto-gain DSP plus an in-browser Web Audio chain (high-pass to kill rumble,
// a presence EQ lift around 3 kHz, and a compressor to even out levels); and
// (2) at encode — optional ffmpeg loudnorm (broadcast-style level) and silence
// trimming. Recording is MediaRecorder (webm/opus) then transcoded to MP3 via
// the same ffmpeg.wasm singleton the converter uses (libmp3lame, mono 44.1k).
function pickRecorderMime() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  if (typeof MediaRecorder === 'undefined') return '';
  return candidates.find((m) => {
    try { return MediaRecorder.isTypeSupported(m); } catch { return false; }
  }) || '';
}

function mimeToExt(mime) {
  if (/mp4/.test(mime)) return 'm4a';
  if (/ogg/.test(mime)) return 'ogg';
  return 'webm';
}

function fmtClock(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function VoiceRecorderTool({ accent }) {
  const [status, setStatus] = useState('idle'); // idle | recording | paused
  const [elapsed, setElapsed] = useState(0);
  const [enhance, setEnhance] = useState(true);
  const [normalize, setNormalize] = useState(true);
  const [trimSilence, setTrimSilence] = useState(false);
  const [bitrate, setBitrate] = useState('192k');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState('');
  const [output, setOutput] = useState(null);
  const [micPerm, setMicPerm] = useState('unknown'); // unknown | prompt | granted | denied | requesting
  const [permErr, setPermErr] = useState('');

  const streamRef = useRef(null);
  const ctxRef = useRef(null);
  const analyserRef = useRef(null);
  const freqRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const rafRef = useRef(0);
  const timerRef = useRef(null);
  const startTsRef = useRef(0);
  const pausedAtRef = useRef(0);
  const pausedTotalRef = useRef(0);
  const canvasRef = useRef(null);

  const clearOutput = useCallback(() => {
    setOutput((prev) => { if (prev?.url) URL.revokeObjectURL(prev.url); return null; });
  }, []);

  const stopMeter = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  const teardown = useCallback(() => {
    stopMeter();
    try { recorderRef.current?.state !== 'inactive' && recorderRef.current?.stop(); } catch {}
    recorderRef.current = null;
    try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch {}
    streamRef.current = null;
    try { ctxRef.current?.close(); } catch {}
    ctxRef.current = null;
    analyserRef.current = null;
  }, [stopMeter]);

  // Stop the mic + free resources if the tool unmounts mid-session.
  useEffect(() => () => { teardown(); if (output?.url) URL.revokeObjectURL(output.url); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Reflect the current mic-permission state (best effort — not all browsers
  // expose the 'microphone' Permissions descriptor). We only READ here; the
  // actual prompt is triggered on user intent (the button below or Start).
  useEffect(() => {
    let permStatus = null;
    const onChange = () => setMicPerm(permStatus?.state || 'unknown');
    if (navigator.permissions?.query) {
      navigator.permissions.query({ name: 'microphone' })
        .then((st) => { permStatus = st; setMicPerm(st.state); st.onchange = onChange; })
        .catch(() => { /* descriptor unsupported — leave as 'unknown', Start still works */ });
    }
    return () => { if (permStatus) permStatus.onchange = null; };
  }, []);

  // Explicitly ask for mic access on user intent, without starting a take.
  // Grabbing a stream is what surfaces the browser prompt; we release it at once.
  async function requestMic() {
    setPermErr('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setPermErr('This browser can\'t access a microphone (no getUserMedia).');
      setMicPerm('denied');
      return;
    }
    setMicPerm('requesting');
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      setMicPerm('granted');
    } catch (e) {
      const name = e?.name || '';
      setMicPerm(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'prompt');
      setPermErr(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'Microphone blocked. Enable it in your browser\'s site settings (the 🔒 icon in the address bar), then retry.'
          : name === 'NotFoundError'
            ? 'No microphone found. Plug one in and retry.'
            : `Could not access the mic: ${e?.message || name || 'unknown error'}`,
      );
    }
  }

  function drawMeter() {
    rafRef.current = requestAnimationFrame(drawMeter);
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;
    const data = freqRef.current || (freqRef.current = new Uint8Array(analyser.frequencyBinCount));
    analyser.getByteFrequencyData(data);
    const ctx2d = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx2d.clearRect(0, 0, W, H);
    const bars = 48;
    const step = Math.max(1, Math.floor(data.length / bars));
    const bw = W / bars;
    for (let i = 0; i < bars; i++) {
      const v = data[i * step] / 255;
      const h = Math.max(2, v * H);
      ctx2d.fillStyle = accent;
      ctx2d.globalAlpha = 0.35 + v * 0.65;
      ctx2d.fillRect(i * bw + 1, (H - h) / 2, bw - 2, h);
    }
    ctx2d.globalAlpha = 1;
  }

  function tickTimer() {
    timerRef.current = setInterval(() => {
      if (startTsRef.current) {
        setElapsed((performance.now() - startTsRef.current - pausedTotalRef.current) / 1000);
      }
    }, 200);
  }

  async function start() {
    if (status !== 'idle') return;
    setErr(''); clearOutput(); setProgress(0); setStage('');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setErr('This browser can\'t record audio (no MediaRecorder / getUserMedia).');
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: enhance,
          noiseSuppression: enhance,
          autoGainControl: enhance,
          channelCount: 1,
        },
      });
    } catch (e) {
      const name = e?.name || '';
      const denied = name === 'NotAllowedError' || name === 'SecurityError';
      setMicPerm(denied ? 'denied' : 'prompt');
      setErr(
        denied
          ? 'Microphone permission denied. Allow mic access in your browser, then try again.'
          : name === 'NotFoundError'
            ? 'No microphone found. Plug one in and retry.'
            : `Could not open the mic: ${e?.message || name || 'unknown error'}`,
      );
      return;
    }
    setMicPerm('granted');
    streamRef.current = stream;

    // Web Audio graph: always tap an analyser for the meter. When "enhance" is
    // on, route the mic through cleanup nodes into a fresh MediaStream and
    // record THAT; otherwise record the raw mic stream.
    let recordStream = stream;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      ctxRef.current = ctx;
      if (ctx.state === 'suspended') { try { await ctx.resume(); } catch {} }
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      analyserRef.current = analyser;

      if (enhance) {
        const highpass = ctx.createBiquadFilter();
        highpass.type = 'highpass'; highpass.frequency.value = 85; // cut rumble / handling noise
        const presence = ctx.createBiquadFilter();
        presence.type = 'peaking'; presence.frequency.value = 3000; presence.Q.value = 1; presence.gain.value = 3; // vocal intelligibility
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -24; comp.knee.value = 30; comp.ratio.value = 3; comp.attack.value = 0.003; comp.release.value = 0.25;
        const dest = ctx.createMediaStreamDestination();
        source.connect(highpass); highpass.connect(presence); presence.connect(comp);
        comp.connect(dest); comp.connect(analyser);
        recordStream = dest.stream;
      } else {
        source.connect(analyser);
      }
    } catch (e) {
      // Meter/enhancement are best-effort — fall back to recording the raw stream.
      console.warn('[mic] audio graph failed', e);
      recordStream = stream;
    }

    const mimeType = pickRecorderMime();
    let recorder;
    try {
      recorder = mimeType ? new MediaRecorder(recordStream, { mimeType }) : new MediaRecorder(recordStream);
    } catch (e) {
      setErr(`Recorder init failed: ${e?.message || e}`);
      teardown();
      return;
    }
    recorderRef.current = recorder;
    chunksRef.current = [];
    recorder.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunksRef.current.push(ev.data); };
    recorder.onstop = () => finalize(recorder.mimeType || mimeType);
    recorder.start(250); // gather chunks periodically so long takes don't buffer one huge blob

    startTsRef.current = performance.now();
    pausedTotalRef.current = 0;
    pausedAtRef.current = 0;
    setElapsed(0);
    setStatus('recording');
    tickTimer();
    rafRef.current = requestAnimationFrame(drawMeter);
  }

  function pause() {
    const rec = recorderRef.current;
    if (!rec || status !== 'recording') return;
    try { rec.pause(); } catch { return; }
    pausedAtRef.current = performance.now();
    setStatus('paused');
  }

  function resume() {
    const rec = recorderRef.current;
    if (!rec || status !== 'paused') return;
    try { rec.resume(); } catch { return; }
    if (pausedAtRef.current) { pausedTotalRef.current += performance.now() - pausedAtRef.current; pausedAtRef.current = 0; }
    setStatus('recording');
  }

  function stop() {
    const rec = recorderRef.current;
    if (!rec || status === 'idle') return;
    stopMeter();
    setStatus('idle');
    try { rec.stop(); } catch { finalize(rec.mimeType); } // onstop fires finalize
    // stop tracks after a tick so the last chunk flushes
    setTimeout(() => { try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch {} }, 100);
  }

  function cancel() {
    stopMeter();
    try { recorderRef.current && (recorderRef.current.onstop = null); } catch {}
    teardown();
    chunksRef.current = [];
    setStatus('idle'); setElapsed(0); setStage(''); setProgress(0);
  }

  async function finalize(recMime) {
    const chunks = chunksRef.current;
    chunksRef.current = [];
    // release the mic + audio context now that capture is done
    try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch {}
    streamRef.current = null;
    try { ctxRef.current?.close(); } catch {}
    ctxRef.current = null;
    analyserRef.current = null;

    if (!chunks.length) { setErr('Nothing was recorded — the take was empty.'); return; }
    const rawMime = (recMime || 'audio/webm').split(';')[0];
    const raw = new Blob(chunks, { type: rawMime });
    await encodeToMp3(raw, rawMime);
  }

  async function encodeToMp3(raw, rawMime) {
    setBusy(true); setErr(''); setProgress(0); setStage('Loading FFmpeg…');
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const outFile = `voice-${stamp}.mp3`;
    const logs = [];
    const onLog = ({ message }) => logs.push(message);
    const onProgress = ({ progress }) => setProgress(Math.max(0, Math.min(1, progress)));
    let ff = null;
    try {
      ff = await getFFmpeg();
      const { fetchFile } = await import('@ffmpeg/util');
      ff.on('log', onLog);
      ff.on('progress', onProgress);

      const inName = 'take.' + mimeToExt(rawMime);
      setStage('Loading take…');
      await ff.writeFile(inName, await fetchFile(raw));

      const filters = [];
      if (trimSilence) {
        filters.push('silenceremove=start_periods=1:start_silence=0.15:start_threshold=-50dB:detection=peak,areverse,silenceremove=start_periods=1:start_silence=0.25:start_threshold=-50dB:detection=peak,areverse');
      }
      if (normalize) filters.push('loudnorm=I=-16:TP=-1.5:LRA=11');

      const args = ['-i', inName, '-vn', '-ac', '1', '-ar', '44100', '-acodec', 'libmp3lame', '-b:a', bitrate];
      if (filters.length) args.push('-af', filters.join(','));
      args.push('out.mp3');

      setStage('Encoding MP3…');
      await ff.exec(args);

      let data;
      try { data = await ff.readFile('out.mp3'); }
      catch {
        const tail = logs.slice(-8).join(' | ');
        throw new Error(`MP3 not produced. Last log: ${tail || '(empty)'}`);
      }
      const blob = new Blob([data.buffer], { type: 'audio/mpeg' });
      clearOutput();
      setOutput({ url: URL.createObjectURL(blob), name: outFile, size: blob.size });
      setStage('Done'); setProgress(1);
      try { await ff.deleteFile(inName); } catch {}
      try { await ff.deleteFile('out.mp3'); } catch {}
    } catch (e) {
      console.error('[mic] encode', e, '\n— logs —\n', logs.join('\n'));
      // Fallback: still hand the user the untranscoded take so a recording is never lost.
      const ext = mimeToExt(rawMime);
      clearOutput();
      setOutput({ url: URL.createObjectURL(raw), name: outFile.replace(/\.mp3$/, `.${ext}`), size: raw.size, fallback: true });
      setErr(`MP3 encode failed (${e?.message || e}). Saved the raw ${ext.toUpperCase()} take instead.`);
      setStage('');
    } finally {
      try { ff?.off?.('log', onLog); } catch {}
      try { ff?.off?.('progress', onProgress); } catch {}
      setBusy(false);
    }
  }

  const recording = status === 'recording';
  const paused = status === 'paused';
  const active = recording || paused;

  const Toggle = ({ on, set, label, hint }) => (
    <button
      type="button"
      onClick={() => set(!on)}
      disabled={active || busy}
      className="mono"
      style={{
        textAlign: 'left', display: 'grid', gap: 3, padding: '10px 12px', borderRadius: 10,
        cursor: active || busy ? 'not-allowed' : 'pointer', width: '100%',
        border: `1px solid ${on ? accent + '66' : COLORS.line}`,
        background: on ? accent + '12' : COLORS.bg,
        opacity: active || busy ? 0.55 : 1, transition: 'border-color 120ms, background 120ms',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: COLORS.text }}>
        <span style={{
          width: 26, height: 15, borderRadius: 999, position: 'relative', flexShrink: 0,
          background: on ? accent : COLORS.line, transition: 'background 120ms',
        }}>
          <span style={{
            position: 'absolute', top: 2, left: on ? 13 : 2, width: 11, height: 11, borderRadius: 999,
            background: '#0d0a08', transition: 'left 120ms',
          }} />
        </span>
        {label}
      </span>
      <span style={{ fontSize: 10, color: COLORS.muted, lineHeight: 1.4, paddingLeft: 34 }}>{hint}</span>
    </button>
  );

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* Recorder stage */}
      <div style={{
        padding: 20, borderRadius: 14, border: `1px solid ${active ? accent + '55' : COLORS.line}`,
        background: COLORS.bg, display: 'grid', gap: 14, transition: 'border-color 200ms',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 10, height: 10, borderRadius: 999,
              background: recording ? COLORS.red : paused ? COLORS.gold : COLORS.line,
              animation: recording ? 'blink 1s step-start infinite' : 'none',
            }} />
            <span className="mono" style={{ fontSize: 11, letterSpacing: '0.16em', color: COLORS.muted, textTransform: 'uppercase' }}>
              {recording ? 'Recording' : paused ? 'Paused' : busy ? 'Processing'
                : micPerm === 'granted' ? 'Ready'
                : micPerm === 'denied' ? 'Mic blocked' : 'Mic access needed'}
            </span>
          </div>
          <span className="mono" style={{ fontSize: 26, fontWeight: 700, color: active ? COLORS.text : COLORS.muted, fontVariantNumeric: 'tabular-nums' }}>
            {fmtClock(elapsed)}
          </span>
        </div>

        <canvas
          ref={canvasRef}
          width={600}
          height={72}
          style={{
            width: '100%', height: 72, borderRadius: 8, background: COLORS.panel,
            border: '1px solid ' + COLORS.line, opacity: active ? 1 : 0.4,
          }}
        />

        {/* Permission gate — only ask for the mic once the user opts in here. */}
        {!active && micPerm !== 'granted' && (
          <div className="mono" style={{
            padding: '10px 12px', borderRadius: 10, fontSize: 11, lineHeight: 1.5,
            border: `1px solid ${micPerm === 'denied' ? COLORS.red + '55' : COLORS.line}`,
            background: micPerm === 'denied' ? COLORS.red + '0e' : COLORS.bg,
            color: micPerm === 'denied' ? COLORS.red : COLORS.muted,
          }}>
            {micPerm === 'denied'
              ? (permErr || 'Mic access is blocked. Enable it in your browser\'s site settings (🔒 in the address bar), then allow again.')
              : micPerm === 'requesting'
                ? 'Waiting for you to allow microphone access…'
                : 'This tool needs your microphone. It only asks when you tap “Allow microphone” — nothing records until you press record.'}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {!active && micPerm !== 'granted' && (
            <Btn variant="solid" color={accent} disabled={busy || micPerm === 'requesting'}
              onClick={requestMic} style={{ flex: 1, minWidth: 130 }}>
              🎙 {micPerm === 'requesting' ? 'Requesting…' : micPerm === 'denied' ? 'Retry mic access' : 'Allow microphone'}
            </Btn>
          )}
          {!active && micPerm === 'granted' && (
            <Btn variant="solid" color={accent} disabled={busy} onClick={start} style={{ flex: 1, minWidth: 130 }}>
              ⏺ {busy ? 'Processing…' : 'Start recording'}
            </Btn>
          )}
          {recording && (
            <Btn variant="tinted" color={COLORS.gold} onClick={pause} style={{ flex: 1, minWidth: 100 }}>❚❚ Pause</Btn>
          )}
          {paused && (
            <Btn variant="tinted" color={COLORS.green} onClick={resume} style={{ flex: 1, minWidth: 100 }}>▶ Resume</Btn>
          )}
          {active && (
            <Btn variant="solid" color={accent} onClick={stop} style={{ flex: 1, minWidth: 100 }}>■ Stop &amp; save</Btn>
          )}
          {active && (
            <Btn variant="ghost" onClick={cancel} title="Discard this take" style={{ minWidth: 90 }}>✕ Discard</Btn>
          )}
        </div>
      </div>

      {/* Clarity options */}
      <div>
        <Kicker style={{ marginBottom: 8 }}>VOICE CLARITY</Kicker>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
          <Toggle on={enhance} set={setEnhance} label="Clean capture"
            hint="Echo cancel + noise suppression + auto-gain, plus a high-pass, presence EQ and compressor for a clearer voice." />
          <Toggle on={normalize} set={setNormalize} label="Normalize loudness"
            hint="Broadcast-style leveling (loudnorm −16 LUFS) so quiet & loud parts sit evenly." />
          <Toggle on={trimSilence} set={setTrimSilence} label="Trim silence"
            hint="Cut dead air from the start and end of the take." />
        </div>
      </div>

      <div>
        <Kicker style={{ marginBottom: 8 }}>MP3 BITRATE</Kicker>
        <div style={{ display: 'flex', gap: 6 }}>
          {['128k', '192k', '320k'].map((b) => (
            <Btn key={b} variant={bitrate === b ? 'tinted' : 'ghost'} color={accent}
              disabled={active} onClick={() => setBitrate(b)}>{b}</Btn>
          ))}
        </div>
      </div>

      <div className="mono" style={{
        padding: '10px 14px', borderRadius: 10, background: COLORS.bg,
        border: '1px solid ' + COLORS.line, fontSize: 11, color: COLORS.muted, lineHeight: 1.5,
      }}>
        ◇ Everything runs in your browser. The mic feed is recorded locally and transcoded to MP3 via ffmpeg.wasm (~25 MB lib, cached on first use) — nothing is uploaded. Recording needs an HTTPS page (or localhost) and mic permission.
      </div>

      {(busy || progress > 0) && (
        <div>
          <div className="mono" style={{ fontSize: 11, color: COLORS.muted, marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
            <span>{stage}</span>
            <span>{Math.round(progress * 100)}%</span>
          </div>
          <div style={{ height: 4, background: COLORS.line, borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progress * 100}%`, background: accent, transition: 'width 120ms' }} />
          </div>
        </div>
      )}

      {err && (
        <div className="mono" style={{
          padding: '10px 14px', borderRadius: 10,
          border: `1px solid ${COLORS.red}55`, background: COLORS.red + '0e',
          color: COLORS.red, fontSize: 12, lineHeight: 1.5,
        }}>✕ {err}</div>
      )}

      {output && (
        <div style={{
          padding: 14, borderRadius: 12, border: `1px solid ${accent}55`,
          background: accent + '08', display: 'grid', gap: 10,
        }}>
          <audio src={output.url} controls style={{ width: '100%' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div className="mono" style={{ fontSize: 11, color: COLORS.muted }}>
              {output.name} · {(output.size / 1024).toFixed(1)} KB
              {output.fallback && <span style={{ color: COLORS.gold }}> · raw take</span>}
            </div>
            <a href={output.url} download={output.name} style={{ textDecoration: 'none' }}>
              <Btn variant="solid" color={accent}>↓ Download</Btn>
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

const CCY_SUGGESTIONS = ['USD', 'TWD', 'VND', 'EUR', 'JPY', 'KRW', 'SGD', 'BTC', 'ETH', 'GOLD'];

function FinanceTool({ accent }) {
  const [accounts, setAccounts] = usePersisted('se77n.finance.accounts.v1', []);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: '', value: '', ccy: 'USD' });
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState(null);

  const totalsByCcy = useMemo(() => {
    const m = {};
    for (const a of accounts) {
      const v = Number(a.value);
      if (!Number.isFinite(v)) continue;
      m[a.ccy] = (m[a.ccy] || 0) + v;
    }
    return Object.entries(m).sort(([, a], [, b]) => b - a);
  }, [accounts]);

  function addAccount() {
    const name = draft.name.trim();
    const ccy = draft.ccy.trim().toUpperCase();
    const v = Number(draft.value);
    if (!name || !ccy || !Number.isFinite(v)) return;
    setAccounts([...accounts, {
      id: Math.random().toString(36).slice(2, 10),
      name, value: v, ccy,
    }]);
    setDraft({ name: '', value: '', ccy: 'USD' });
    setAdding(false);
  }
  function startEdit(a) {
    setEditingId(a.id);
    setEditDraft({ name: a.name, value: String(a.value), ccy: a.ccy });
  }
  function saveEdit() {
    if (!editingId || !editDraft) return;
    const name = editDraft.name.trim();
    const ccy = editDraft.ccy.trim().toUpperCase();
    const v = Number(editDraft.value);
    if (!name || !ccy || !Number.isFinite(v)) return;
    setAccounts(accounts.map((a) =>
      a.id === editingId ? { ...a, name, value: v, ccy } : a
    ));
    setEditingId(null); setEditDraft(null);
  }
  function deleteAccount(id) {
    setAccounts(accounts.filter((a) => a.id !== id));
    if (editingId === id) { setEditingId(null); setEditDraft(null); }
  }

  function formatVal(v, ccy) {
    if (!Number.isFinite(v)) return '—';
    const isCrypto = ccy === 'BTC' || ccy === 'ETH';
    return isCrypto
      ? v.toLocaleString(undefined, { maximumFractionDigits: 8 })
      : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* ─ Totals ─ */}
      {totalsByCcy.length > 0 && (
        <div style={{
          padding: 16, borderRadius: 12, border: `1px solid ${accent}55`,
          background: accent + '08',
        }}>
          <Kicker style={{ color: accent, marginBottom: 10 }}>NET WORTH · BY CURRENCY</Kicker>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {totalsByCcy.map(([ccy, val]) => (
              <div key={ccy} className="mono" style={{
                padding: '8px 12px', borderRadius: 8,
                border: '1px solid ' + COLORS.line, background: COLORS.bg,
                fontSize: 12,
              }}>
                <span style={{ color: accent, fontWeight: 700 }}>{formatVal(val, ccy)}</span>
                <span style={{ color: COLORS.muted, marginLeft: 6 }}>{ccy}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─ Account list ─ */}
      <div style={{ display: 'grid', gap: 8 }}>
        {accounts.length === 0 && !adding && (
          <div style={{
            padding: 28, textAlign: 'center', borderRadius: 12,
            border: `1px dashed ${COLORS.line}`, background: COLORS.bg,
            color: COLORS.muted, fontSize: 13,
          }}>
            <div className="mono" style={{ fontSize: 12, letterSpacing: '0.14em', marginBottom: 6 }}>
              NO ACCOUNTS YET
            </div>
            Add cash, crypto, stocks, or any holding you want to track.
          </div>
        )}
        {accounts.map((a) => {
          const isEditing = editingId === a.id;
          if (isEditing) {
            return (
              <div key={a.id} style={{
                padding: 12, borderRadius: 10,
                border: `1px solid ${accent}55`, background: accent + '08',
                display: 'grid', gridTemplateColumns: '2fr 1fr 80px auto', gap: 8, alignItems: 'center',
              }}>
                <Field value={editDraft.name} onChange={(v) => setEditDraft({ ...editDraft, name: v })} placeholder="Name" />
                <Field value={editDraft.value} onChange={(v) => setEditDraft({ ...editDraft, value: v })} placeholder="0" />
                <Field value={editDraft.ccy} onChange={(v) => setEditDraft({ ...editDraft, ccy: v.toUpperCase() })} placeholder="USD" />
                <div style={{ display: 'flex', gap: 4 }}>
                  <Btn variant="solid" color={accent} onClick={saveEdit}>Save</Btn>
                  <Btn variant="ghost" onClick={() => { setEditingId(null); setEditDraft(null); }}>✕</Btn>
                </div>
              </div>
            );
          }
          return (
            <div key={a.id} style={{
              padding: 14, borderRadius: 10, background: COLORS.bg,
              border: '1px solid ' + COLORS.line,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
            }}>
              <div className="mono" style={{ fontSize: 12, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {a.name}
              </div>
              <div className="mono" style={{ fontSize: 14, fontWeight: 700, color: accent }}>
                {formatVal(a.value, a.ccy)}
                <span style={{ fontSize: 10, color: COLORS.muted, marginLeft: 6 }}>{a.ccy}</span>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <Btn variant="ghost" onClick={() => startEdit(a)} title="Edit">✎</Btn>
                <Btn variant="ghost" onClick={() => deleteAccount(a.id)} title="Delete">✕</Btn>
              </div>
            </div>
          );
        })}
      </div>

      {/* ─ Add form ─ */}
      {adding ? (
        <div style={{
          padding: 14, borderRadius: 10,
          border: `1px solid ${accent}55`, background: accent + '08',
          display: 'grid', gap: 10,
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 80px', gap: 8 }}>
            <div>
              <Kicker style={{ marginBottom: 6 }}>NAME</Kicker>
              <Field value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} placeholder="Cash · USD" />
            </div>
            <div>
              <Kicker style={{ marginBottom: 6 }}>VALUE</Kicker>
              <Field value={draft.value} onChange={(v) => setDraft({ ...draft, value: v })} placeholder="0" />
            </div>
            <div>
              <Kicker style={{ marginBottom: 6 }}>CCY</Kicker>
              <Field value={draft.ccy} onChange={(v) => setDraft({ ...draft, ccy: v.toUpperCase() })} placeholder="USD" />
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {CCY_SUGGESTIONS.map((c) => (
              <button
                key={c}
                onClick={() => setDraft({ ...draft, ccy: c })}
                className="mono"
                style={{
                  padding: '4px 8px', fontSize: 10, borderRadius: 6,
                  border: '1px solid ' + COLORS.line, cursor: 'pointer',
                  background: draft.ccy === c ? accent + '20' : 'transparent',
                  color: draft.ccy === c ? accent : COLORS.muted,
                  letterSpacing: '0.1em',
                }}
              >{c}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn variant="solid" color={accent} onClick={addAccount}>Add</Btn>
            <Btn variant="ghost" onClick={() => { setAdding(false); setDraft({ name: '', value: '', ccy: 'USD' }); }}>
              Cancel
            </Btn>
          </div>
        </div>
      ) : (
        <Btn variant="tinted" color={accent} onClick={() => setAdding(true)}>+ Add account</Btn>
      )}
    </div>
  );
}

function GameResourcesTool({ accent }) {
  const [files, setFiles] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true); setErr('');
    fetch('/api/toolbox?kind=games')
      .then(async (r) => {
        const data = await r.json();
        if (!alive) return;
        if (!r.ok) { setErr(data.error || 'Failed to load'); setFiles([]); }
        else { setFiles(data.files || []); }
      })
      .catch((e) => { if (alive) { setErr(e.message); setFiles([]); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const filtered = useMemo(() => {
    if (!files) return [];
    const s = search.trim().toLowerCase();
    if (!s) return files;
    return files.filter((f) => f.name.toLowerCase().includes(s));
  }, [files, search]);

  function formatSize(n) {
    if (!Number.isFinite(n) || n == null) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
    return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }
  function formatDate(s) {
    try { return new Date(s).toISOString().slice(0, 10); } catch { return '—'; }
  }
  function iconFor(f) {
    if (f.isFolder) return '▤';
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    if (['zip', '7z', 'rar', 'tar', 'gz'].includes(ext)) return '◫';
    if (['exe', 'msi', 'dmg', 'pkg'].includes(ext)) return '▶';
    if (['iso', 'img'].includes(ext)) return '◉';
    if (['txt', 'md', 'pdf', 'doc', 'docx'].includes(ext)) return '¶';
    if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return '◐';
    if (['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext)) return '▶';
    return '◇';
  }

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: COLORS.muted }} className="mono">
        ◇ loading drive…
      </div>
    );
  }

  if (err) {
    const isSetup = err.includes('not configured');
    return (
      <div style={{
        padding: 24, borderRadius: 12,
        border: `1px solid ${COLORS.line}`, background: COLORS.bg,
        color: COLORS.muted, fontSize: 13, lineHeight: 1.6,
      }}>
        <div className="mono" style={{ color: COLORS.red, fontSize: 12, letterSpacing: '0.14em', marginBottom: 10 }}>
          {isSetup ? '⚠ SETUP REQUIRED' : '✕ ERROR'}
        </div>
        <div style={{ marginBottom: 12, color: COLORS.text }}>{err}</div>
        {isSetup && (
          <ol style={{ paddingLeft: 18, margin: 0, fontSize: 12 }}>
            <li>Create a Google Drive folder, share "Anyone with link" → Viewer.</li>
            <li>Grab the folder ID from the URL (the part after <code>/folders/</code>).</li>
            <li>Google Cloud Console → enable Drive API → Create an API Key.</li>
            <li>In Vercel → Project → Settings → Environment Variables, add:
              <pre style={{ background: COLORS.bg, padding: 10, borderRadius: 6, marginTop: 6, fontSize: 11, color: COLORS.text }}>
{`GDRIVE_API_KEY=AIza…
GDRIVE_FOLDER_ID=1abcXYZ…`}
              </pre>
            </li>
            <li>Redeploy.</li>
          </ol>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <div style={{ flex: 1 }}>
          <Field value={search} onChange={setSearch} placeholder="Search files…" />
        </div>
        <span className="mono" style={{ fontSize: 10, color: COLORS.muted, letterSpacing: '0.1em' }}>
          {filtered.length}/{files.length} FILES
        </span>
      </div>

      {filtered.length === 0 ? (
        <div style={{
          padding: 28, textAlign: 'center', borderRadius: 12,
          border: `1px dashed ${COLORS.line}`, background: COLORS.bg,
          color: COLORS.muted, fontSize: 13,
        }}>
          <div className="mono" style={{ fontSize: 12, letterSpacing: '0.14em', marginBottom: 6 }}>
            {files.length === 0 ? 'FOLDER EMPTY' : 'NO MATCHES'}
          </div>
          {files.length === 0
            ? 'Upload files to your Drive folder, then refresh.'
            : 'Try a different search term.'}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 6 }}>
          {filtered.map((f) => (
            <div key={f.id} style={{
              padding: 12, borderRadius: 10, background: COLORS.bg,
              border: '1px solid ' + COLORS.line,
              display: 'grid', gridTemplateColumns: '40px 1fr auto auto', gap: 12, alignItems: 'center',
            }}>
              <div style={{
                width: 36, height: 36, display: 'grid', placeItems: 'center',
                borderRadius: 8, border: `1px solid ${accent}55`,
                color: accent, fontSize: 16, fontFamily: 'JetBrains Mono, monospace',
              }}>{iconFor(f)}</div>
              <div style={{ minWidth: 0 }}>
                <div className="mono" style={{
                  fontSize: 12, fontWeight: 700, overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{f.name}</div>
                <div className="mono" style={{ fontSize: 10, color: COLORS.muted, marginTop: 3 }}>
                  {formatSize(f.size)} · {formatDate(f.modifiedAt)}
                </div>
              </div>
              <a
                href={f.viewUrl}
                target="_blank"
                rel="noreferrer"
                className="mono"
                style={{
                  fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase',
                  padding: '6px 10px', borderRadius: 6, color: COLORS.muted,
                  border: '1px solid ' + COLORS.line, textDecoration: 'none',
                }}
              >View</a>
              {!f.isFolder && (
                <a
                  href={f.downloadUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mono"
                  style={{
                    fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase',
                    padding: '6px 10px', borderRadius: 6, color: accent, fontWeight: 700,
                    border: `1px solid ${accent}55`, textDecoration: 'none',
                  }}
                >↓ DL</a>
              )}
            </div>
          ))}
        </div>
      )}
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
// 4. GAME — hub of game-adjacent modules. Today: Tavern (KataS roleplay).
// ═════════════════════════════════════════════════════════════
const GAME_TILES = [
  {
    id: 'tavern',
    label: 'Tavern',
    accent: '#8a4fff',
    glyph: '⌑',
    tagline: 'Roleplay engine',
    desc: 'Worlds, characters, lore AI, scene images. Discord + web.',
    chips: ['DISCORD', 'WEB', 'LORE AI'],
    href: '/kata/tavern.html',
    external: true,
  },
  {
    id: 'ludo',
    label: 'Cờ Cá Ngựa',
    accent: '#ff5763',
    glyph: '◆',
    tagline: 'Anime Fantasy Ludo',
    desc: 'Bàn cờ 3D phong cách anime, 4 tộc, AI đối thủ, 6 chủ đề. Chơi ngay trên web.',
    chips: ['3D BOARD', 'VS AI', '6 THEMES'],
    href: '/games/ludo/',
    external: true,
  },
];

function readGameSubRoute() {
  if (typeof window === 'undefined') return null;
  const segs = window.location.hash.replace(/^#\//, '').split('/').filter(Boolean);
  // #/game/<sub>
  return segs[0] === 'game' && segs[1] ? segs[1] : null;
}

export function GamePanel() {
  const [sub, setSub] = useState(readGameSubRoute);
  // Two big venue cards side-by-side on desktop; stack into the dedicated
  // mobile layout (full-width PLAY NOW, auto-sheen, tap press) on phones.
  const isMobile = useMediaQuery('(max-width: 768px)');

  useEffect(() => {
    function onHash() { setSub(readGameSubRoute()); }
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Resolve `#/game/tavern` and friends — open the external dashboard target
  // in this tab (full-page navigation) so the user lands inside /kata's auth
  // surface instead of bouncing back here.
  useEffect(() => {
    if (!sub) return;
    const tile = GAME_TILES.find((t) => t.id === sub);
    if (!tile) return;
    if (tile.external) {
      window.location.href = tile.href;
    }
  }, [sub]);

  return (
    <Panel padding={0} style={{
      display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%',
      ...(isMobile ? { background: 'transparent', border: 'none', borderRadius: 0 } : {}),
    }}>
      <div style={{
        padding: isMobile ? '6px 2px 0' : '22px 24px',
        borderBottom: isMobile ? 'none' : '1px solid ' + COLORS.line,
      }}>
        <div className="mono" style={{ fontSize: isMobile ? 9.5 : 10, letterSpacing: '0.26em', fontWeight: 800, color: COLORS.red }}>04 · GAME HUB</div>
        <h1 className="mono" style={{
          fontSize: isMobile ? 32 : 34, margin: isMobile ? '8px 0 6px' : '10px 0 7px', color: COLORS.text,
          fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1,
        }}>Pick a venue<span style={{ color: COLORS.red }}>.</span></h1>
        <p style={{ margin: 0, fontSize: isMobile ? 11.5 : 12.5, color: COLORS.muted }}>
          {GAME_TILES.length} venues live · web + Discord
        </p>
      </div>

      <div style={{ flex: 1, padding: isMobile ? '16px 2px 4px' : 24, overflow: 'auto' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: isMobile ? 14 : 18,
          animation: 'fadeUp 200ms ease-out',
        }}>
          {GAME_TILES.map((t) => (
            <a
              key={t.id}
              href={`#/game/${t.id}`}
              onClick={(e) => {
                if (t.external) {
                  e.preventDefault();
                  window.location.href = t.href;
                }
              }}
              className={isMobile ? 'gcard mtap' : 'gcard lit'}
              style={{
                position: 'relative', overflow: 'hidden',
                display: 'flex', flexDirection: 'column', gap: isMobile ? 13 : 14,
                padding: isMobile ? '24px 22px 22px' : '30px 30px 26px',
                minHeight: isMobile ? 'auto' : 280, borderRadius: 18,
                border: `1px solid ${COLORS.line}`,
                background: 'linear-gradient(180deg, #141010, #100d0c)',
                color: COLORS.text, textDecoration: 'none',
                transition: 'border-color 200ms ease, transform 200ms ease, box-shadow 200ms ease',
              }}
              onMouseEnter={isMobile ? undefined : (e) => {
                e.currentTarget.style.transform = 'translateY(-4px)';
                e.currentTarget.style.borderColor = t.accent + '70';
                e.currentTarget.style.boxShadow = `0 24px 60px rgba(0,0,0,.5), 0 0 50px ${t.accent}26`;
              }}
              onMouseLeave={isMobile ? undefined : (e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.borderColor = COLORS.line;
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <span className={isMobile ? 'msheen' : 'sheen'} />
              <div style={{
                position: 'absolute', inset: 0, pointerEvents: 'none',
                background: `radial-gradient(60% 70% at 85% 100%, ${t.accent}14 0%, transparent 70%)`,
              }} />
              <div className="gwm mono" style={{
                position: 'absolute', bottom: isMobile ? -42 : -52, right: isMobile ? -16 : -22,
                fontSize: isMobile ? 150 : 190, lineHeight: 1,
                color: t.accent + '16', pointerEvents: 'none', fontWeight: 800,
              }}>{t.glyph}</div>

              <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span className="mono" style={{
                  fontSize: 9.5, letterSpacing: '0.22em', fontWeight: 800, color: t.accent,
                  border: `1px solid ${t.accent}55`, background: t.accent + '12',
                  borderRadius: 999, padding: '5px 12px', textTransform: 'uppercase',
                }}>{t.tagline}</span>
                <span className="gglyph" style={{ fontSize: 26, color: t.accent, lineHeight: 1 }}>{t.glyph}</span>
              </div>

              <div style={{ position: 'relative' }}>
                <div className="gtitle mono" style={{
                  fontSize: isMobile ? 27 : 30, fontWeight: 800, letterSpacing: '-0.02em', color: COLORS.text,
                }}>{t.label}</div>
                <div style={{ fontSize: 12.5, color: COLORS.muted, marginTop: 8, lineHeight: 1.65, maxWidth: 380 }}>{t.desc}</div>
              </div>

              <div style={{ position: 'relative', display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                {t.chips.map((c) => (
                  <span key={c} className="mono" style={{
                    fontSize: 9, letterSpacing: '0.14em', fontWeight: 700, color: COLORS.muted,
                    border: `1px solid ${COLORS.line}`, borderRadius: 999, padding: '4px 11px',
                  }}>{c}</span>
                ))}
              </div>

              {isMobile ? (
                <span className="mono" style={{
                  position: 'relative', marginTop: 4, width: '100%', textAlign: 'center',
                  background: t.accent, color: '#ffffff', padding: '14px 0', borderRadius: 11,
                  fontWeight: 800, letterSpacing: '0.18em', fontSize: 11,
                  boxShadow: `0 10px 26px ${t.accent}45`,
                }}>PLAY NOW →</span>
              ) : (
                <div style={{ position: 'relative', marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span className="gplay mono" style={{
                    background: t.accent, color: '#ffffff', padding: '13px 26px', borderRadius: 10,
                    fontWeight: 800, letterSpacing: '0.18em', fontSize: 10.5,
                    whiteSpace: 'nowrap', flex: 'none', boxShadow: `0 10px 28px ${t.accent}45`,
                  }}>PLAY NOW →</span>
                  <span className="mono" style={{
                    fontSize: 9.5, letterSpacing: '0.16em', color: COLORS.muted, fontWeight: 700,
                  }}>{t.href}</span>
                </div>
              )}
            </a>
          ))}
        </div>

        {/* Slim "more soon" strip — keeps the hub feeling alive without a
            hollow placeholder tile. */}
        <div className="mono" style={{
          marginTop: isMobile ? 14 : 18, display: 'flex', alignItems: 'center', gap: isMobile ? 12 : 14,
          padding: isMobile ? '16px 20px' : '18px 24px', border: `1px dashed ${COLORS.line}`,
          borderRadius: 14, color: COLORS.muted,
        }}>
          <span style={{ fontSize: isMobile ? 15 : 16 }}>✦</span>
          {isMobile ? (
            <div>
              <div style={{ fontSize: 9.5, letterSpacing: '0.18em', fontWeight: 800 }}>MORE · SOON</div>
              <div style={{ fontSize: 10.5, color: COLORS.muted, marginTop: 3 }}>Mini-games, leaderboards, arcade</div>
            </div>
          ) : (
            <>
              <span style={{ fontSize: 10, letterSpacing: '0.2em', fontWeight: 800 }}>MORE · SOON</span>
              <span style={{ fontSize: 11.5, color: COLORS.muted, letterSpacing: 0 }}>Mini-games, leaderboards, arcade</span>
            </>
          )}
        </div>
      </div>
    </Panel>
  );
}
