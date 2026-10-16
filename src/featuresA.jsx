import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  COLORS, ACCENTS, CITIES, withAlpha,
  Panel, Btn, Field, Pill, Kicker,
  useSyncedData, usePasteImage, copyText, useLang, useMediaQuery, usePersisted, compressImage,
  buildChatHistory,
} from './lib.jsx';
import { PixelArrow, PixelCoin, PixelHeart, IconTile, DialogBox, PxButton, EmptyState } from './ui/arcade.jsx';
import './featuresA.arcade.css';

// ── Shared pixel bits for this file ────────────────────────────
// Square-cap stroke icon (24 grid) from one or more path strings.
function StrokeIcon({ d, size = 20, sw = 2.4, color = 'currentColor', style, children }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw}
      strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true" style={{ flexShrink: 0, ...style }}>
      {d && <path d={d} />}
      {children}
    </svg>
  );
}

const ICO = {
  x: 'M5 5l14 14M19 5L5 19',
  warn: 'M12 3l10 18H2zM12 10v5M12 18v1',
  retry: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  clip: 'M7 9v10h10V4h-7v11h4V8',
  edit: 'M4 20h4L19 9l-4-4L4 16z',
  sound: 'M4 9h4l5-4v14l-5-4H4zM17 9v6M20 7v10',
  copy: 'M8 8h12v12H8zM4 16V4h12',
  down: 'M12 4v12M6 11l6 6 6-6M4 20h16',
  open: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  swap: 'M4 8h15M15 4l4 4-4 4M20 16H5M9 12l-4 4 4 4',
  plus: 'M12 4v16M4 12h16',
  play: 'M7 4v16l12-8z',
  pause: 'M6 4h4v16H6zM14 4h4v16h-4z',
  mic: 'M9 3h6v11H9zM5 11v1a7 7 0 0 0 14 0v-1M12 19v3M8 22h8',
  search: 'M4 4h11v11H4zM15 15l5 5',
};

// Names with Vietnamese diacritics fall back to the mono face (see .fa-vi).
const hasVi = (s) => /[̀-ͯẠ-ỹƠơƯưĐđ]/.test(String(s || '').normalize('NFC'));

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

  const kindLabel = preset.kind === 'bg-remove' ? 'BG REMOVE' : preset.kind.toUpperCase();
  const engineChip = preset.kind === 'chat' ? 'GEMINI 3.1 · YUNWU'
    : preset.kind === 'bg-remove' ? 'IDEOGRAM · FAL.AI' : null;
  const canSend = !busy && (input.trim() || imgRef);
  const AI_ACCENT = ACCENTS.ai;
  const panelHead = isMobile ? '12px 14px' : '12px 18px';

  return (
    <div className="fa-ai" style={{ height: '100%', minHeight: 0, padding: '4px 14px 14px 4px', boxSizing: 'border-box' }}>
      {/* ── Main column: conversation + control panel ── */}
      {/* If the area is very short the column scrolls instead of crushing the thread. */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 28, minWidth: 0, minHeight: 0,
        overflowY: 'auto', padding: '4px 14px 14px 4px', margin: '-4px -14px -14px -4px',
      }}>
        <section className="px" aria-label="Conversation" style={{
          flex: 1, minHeight: 170, display: 'flex', flexDirection: 'column', overflow: 'hidden',
          background: COLORS.paper,
        }}>
          <div style={{
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between',
            gap: 14, padding: panelHead, borderBottom: '4px solid ' + COLORS.ink,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 0 }}>
              <span className="pxs" style={{
                display: 'grid', placeItems: 'center', flexShrink: 0, width: 42, height: 42,
                background: AI_ACCENT, color: COLORS.onAccent,
              }}><PresetIcon id={presetId} size={24} /></span>
              <div style={{ minWidth: 0 }}>
                <div className="sk" style={{ fontSize: 11, color: COLORS.muted, marginBottom: 6 }}>SESSION · {presetId.toUpperCase()}</div>
                <h2 className={'pf' + (hasVi(preset.label) ? ' fa-vi' : '')} style={{ margin: 0, fontSize: 24, lineHeight: 1 }}>{preset.label}</h2>
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, padding: '3px 6px 6px 3px' }}>
              {preset.kind === 'image' && (
                <ModelSwap label="MODEL" value={imageEngine} onChange={setImageEngine} options={IMAGE_ENGINES} />
              )}
              {preset.kind === 'video' && (
                <ModelSwap label="MODEL" value={videoEngine} onChange={setVideoEngine} options={VIDEO_ENGINES} />
              )}
              {engineChip && (
                <span className="sk pxs" style={{
                  display: 'inline-flex', alignItems: 'center', height: 36, padding: '0 10px',
                  fontSize: 11, background: COLORS.field, color: COLORS.text,
                }}>{engineChip}</span>
              )}
              <button type="button" onClick={clearChat} className="sk sbtn" style={{
                display: 'inline-flex', alignItems: 'center', gap: 8, height: 36, padding: '0 14px',
                fontSize: 12, color: COLORS.text, background: COLORS.paper, textTransform: 'uppercase',
              }}>
                <StrokeIcon d={ICO.trash} size={14} />{t('ai.clear')}
              </button>
            </div>
          </div>

          <div ref={scrollRef} role="log" aria-label="Messages" style={{
            flex: 1, minHeight: 0, overflowY: 'auto', background: COLORS.cream,
            padding: isMobile ? '28px 16px 30px' : '34px 30px 36px',
            display: 'flex', flexDirection: 'column', gap: 26,
          }}>
            {messages.length === 0 && (
              <DialogBox speaker="SE77N SAYS:" style={{ maxWidth: 620, marginTop: 14 }} padding="32px 26px 28px">
                <p style={{ margin: 0, fontSize: 15, lineHeight: 1.65, color: COLORS.text }}>{preset.seed}</p>
                <p className="sk" style={{ margin: '16px 0 0', fontSize: 11, color: COLORS.muted }}>
                  NO SAVE DATA IN THIS PRESET · TYPE BELOW TO START
                </p>
              </DialogBox>
            )}
            {messages.map((m, i) => (
              <Message
                key={i}
                role={m.role}
                content={m.content}
                image={m.image}
                video={m.video}
                error={m.error}
                badge={m.role === 'assistant' && !m.error ? resultBadge(preset.kind, presetId, messages[i - 1]) : null}
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
        </section>

        {/* ── Composer · control panel ── */}
        <section className="px" aria-label="Composer" style={{ position: 'relative', zIndex: 2, flexShrink: 0, background: COLORS.paper }}>
          <div className="sk" style={{
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10,
            minHeight: 30, padding: '0 18px', fontSize: 11, color: COLORS.stripText, background: COLORS.strip,
          }}>
            <span>CONTROL PANEL · P1</span>
            <span className="fa-ai-hint" style={{ color: '#c9bca6', fontSize: 10 }}>ENTER · SEND / CTRL+V · PASTE IMAGE</span>
            <span style={{ color: AI_ACCENT }}>{kindLabel} MODE</span>
          </div>
          <div className="fa-cq" style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '14px 14px 12px' }}>
            <div>
              <div role="group" aria-label={t('ai.presets')} className={isMobile ? 'fa-rail' : undefined} style={{
                display: 'flex', flexWrap: isMobile ? 'nowrap' : 'wrap', gap: '12px 8px', padding: 3,
                minWidth: 0, overflowX: isMobile ? 'auto' : 'visible',
              }}>
                {AI_PRESETS.map((p) => {
                  const active = p.id === presetId;
                  const label = t('ai.preset.' + p.id + '.label');
                  return (
                    <button
                      key={p.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setPresetId(p.id)}
                      className={'chip-px sk fa-pchip' + (active ? ' on' : '')}
                      style={{
                        flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 7,
                        height: 36, padding: '0 9px', fontSize: 10, whiteSpace: 'nowrap',
                      }}
                    >
                      <PresetIcon id={p.id} size={14} />
                      <span className={hasVi(label) ? 'fa-vi' : undefined}>{label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {preset.kind === 'video' && (
              <VideoOptionsBar opts={videoOpts} onChange={setVideoOpts} />
            )}
            {imgRef && (
              <AttachmentChip imgRef={imgRef} onRemove={() => setImgRef(null)} />
            )}

            <div>
              <label htmlFor="ai-prompt" className="sr">Prompt · {preset.label}</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '3px 12px 10px 3px' }}>
                <span className="pf" aria-hidden="true" style={{ flexShrink: 0, fontSize: 24, color: COLORS.red }}>&gt;</span>
                {acceptImage && (
                  <label
                    title={imgRef ? imgRef.name : 'attach image'}
                    className="sbtn"
                    style={{
                      display: 'grid', placeItems: 'center', flexShrink: 0, width: 50, height: 56,
                      color: imgRef ? COLORS.onAccent : COLORS.text,
                      background: imgRef ? '#ffd25e' : COLORS.paper,
                    }}>
                    <input type="file" accept="image/*" onChange={onImageRef} className="sr" />
                    <span className="sr">{t('ai.attach')}</span>
                    <StrokeIcon d={ICO.clip} size={22} />
                  </label>
                )}
                <div style={{ flex: 1, minWidth: 0, display: 'flex' }}>
                  <input
                    id="ai-prompt"
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={preset.placeholder}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                    autoFocus
                    className="field pxs"
                    style={{ width: '100%', height: 56, padding: '0 14px', fontSize: 14, fontFamily: "'JetBrains Mono', monospace" }}
                  />
                </div>
                <button
                  type="button"
                  className="sk pbtn"
                  onClick={() => send()}
                  disabled={!canSend}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 12, flexShrink: 0, height: 56,
                    padding: isMobile ? '0 16px' : '0 24px', fontSize: isMobile ? 14 : 17,
                    color: COLORS.onAccent, background: '#e04545', textTransform: 'uppercase',
                  }}
                >
                  {t('ai.send')}<PixelArrow dir="right" size={16} />
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* ── Side column: session + engines + tip ── */}
      <aside className="fa-ai-aside" aria-label="Session settings" style={{
        display: 'flex', flexDirection: 'column', gap: 34, minWidth: 0, minHeight: 0,
        overflowY: 'auto', padding: '4px 14px 16px 4px', margin: '-4px -14px -14px -4px',
      }}>
        <section className="px" aria-label="Session" style={{ padding: '20px 20px 12px', background: COLORS.paper, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
            <h3 className="sk" style={{ margin: 0, fontSize: 14, fontFamily: "'Silkscreen', monospace" }}>SESSION</h3>
            <span className="sk pxs" style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px', fontSize: 10,
              background: '#7fd18b', color: COLORS.onAccent,
            }}><span className="blink" style={{ width: 8, height: 8, background: COLORS.onAccent }} />SAVED</span>
          </div>
          <dl style={{ margin: 0 }}>
            {[
              ['PRESET', preset.label],
              ['KIND', kindLabel],
              ['THREAD', 'ai:' + presetId],
              ['MESSAGES', String(messages.length).padStart(2, '0')],
              ['AUTO-LOG', '→ HISTORY'],
            ].map(([k, v], i, arr) => (
              <div key={k} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '10px 0',
                borderBottom: i < arr.length - 1 ? '3px dashed ' + COLORS.rule : 'none',
              }}>
                <dt className="sk" style={{ fontSize: 11, color: COLORS.muted }}>{k}</dt>
                <dd style={{ margin: 0, fontSize: 13, fontWeight: 700, textAlign: 'right', color: COLORS.text }}>{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="px" aria-label="Engines" style={{ padding: '20px 14px 18px', background: COLORS.paper, flexShrink: 0 }}>
          <h3 className="sk" style={{ margin: '0 6px 6px', fontSize: 14, fontFamily: "'Silkscreen', monospace" }}>ENGINES</h3>
          <p style={{ margin: '0 6px 16px', fontSize: 12, lineHeight: 1.5, color: COLORS.muted }}>
            Saved per player. The MODEL switch above uses the same picks.
          </p>
          <EngineGroup title="IMAGE GEN" value={imageEngine} onChange={setImageEngine} options={IMAGE_ENGINES} />
          <EngineGroup title="VIDEO GEN" value={videoEngine} onChange={setVideoEngine} options={VIDEO_ENGINES} />
          <div className="sk" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 6px', fontSize: 11 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><span style={{ color: COLORS.muted }}>CHAT</span><span>GEMINI 3.1 · YUNWU</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><span style={{ color: COLORS.muted }}>BG REMOVE</span><span>IDEOGRAM · FAL.AI</span></div>
          </div>
        </section>

        <DialogBox speaker="SE77N TIP:" padding="28px 20px 28px" style={{ flexShrink: 0 }}>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: COLORS.text }}>
            Paste an image anywhere with Ctrl+V to attach it. Every finished reply is auto-logged to History.
          </p>
        </DialogBox>
      </aside>
    </div>
  );
}

// Preset icons (square-cap strokes) — replace the old glyph icons.
const PRESET_ICON = {
  chat: 'M3 4h18v12H11l-5 4v-4H3z',
  tr: 'M3 8h14M13 4l4 4-4 4M21 16H7M11 12l-4 4 4 4',
  tldr: 'M4 6h16M4 12h16M4 18h10',
  code: 'M8 6l-6 6 6 6M16 6l6 6-6 6M14 3l-4 18',
  image: 'M3 4h18v16H3zM3 16l5-5 4 4 3-3 6 6M15 7h3v3h-3z',
  video: 'M3 5h18v14H3zM10 9v6l5-3z',
  bg: 'M4 12a8 8 0 1 0 16 0a8 8 0 1 0-16 0M6.5 17.5l11-11',
};
function PresetIcon({ id, size = 18 }) {
  return <StrokeIcon d={PRESET_ICON[id] || PRESET_ICON.chat} size={size} />;
}

// Result-kind tag for an assistant reply (pixel chip next to the name plate).
// Image replies count as "edited" when the prompt that produced them carried
// an image. Plain chat replies carry no tag.
function resultBadge(kind, presetId, prevMsg) {
  if (kind === 'image') {
    return prevMsg?.role === 'user' && prevMsg.image
      ? { label: 'IMAGE · EDITED', color: '#b9a2ff', icon: ICO.edit }
      : { label: 'IMAGE · GENERATED', color: '#b9a2ff', icon: PRESET_ICON.image };
  }
  if (kind === 'video') return { label: 'VIDEO · GENERATED', color: '#ffd25e', icon: PRESET_ICON.video };
  if (kind === 'bg-remove') return { label: 'BACKGROUND · REMOVED', color: '#9fd8ff', icon: PRESET_ICON.bg };
  if (presetId === 'tr') return { label: 'TRANSLATE', color: '#ffd25e', icon: PRESET_ICON.tr };
  if (presetId === 'code') return { label: 'CODE', color: '#7fd18b', icon: PRESET_ICON.code };
  if (presetId === 'tldr') return { label: 'TL;DR', color: '#fffaf0', icon: PRESET_ICON.tldr };
  return null;
}

// Radio list of engines (side panel). Same state as the MODEL switch.
function EngineGroup({ title, value, onChange, options }) {
  return (
    <>
      <div className="sk" style={{ margin: '0 6px 6px', fontSize: 10, color: COLORS.muted }}>{title}</div>
      <div role="radiogroup" aria-label={title} style={{
        display: 'flex', flexDirection: 'column', gap: 2, paddingBottom: 12, marginBottom: 14,
        borderBottom: '3px dashed ' + COLORS.rule,
      }}>
        {options.map((o) => (
          <button key={o.v} type="button" role="radio" aria-checked={o.v === value}
            className="fa-eng sk" onClick={() => onChange(o.v)}>
            <span className="rd" />{o.l}
          </button>
        ))}
      </div>
    </>
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

// Model switch — gold pixel chip that flips open a paper list. CSS-only
// motion (stepped opacity/transform); click-outside closes it.
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
      position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 12,
      flexShrink: 0,
    }}>
      <span className="sk" style={{ fontSize: 11, color: COLORS.muted }}>{label}</span>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="sk pxs"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 10, height: 36, padding: '0 12px',
          border: 0, cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap',
          color: COLORS.onAccent, background: '#ffd25e',
        }}
      >
        <span className="blink" style={{ width: 8, height: 8, background: COLORS.onAccent, flexShrink: 0 }} />
        {current.l}
        <PixelArrow dir="down" size={7} style={{ transform: open ? 'scaleY(-1)' : 'none' }} />
      </button>
      <div
        role="listbox"
        aria-label={label}
        className="px fa-drop-menu"
        style={{
          position: 'absolute', left: 0, top: 'calc(100% + 16px)', zIndex: 30,
          display: 'flex', flexDirection: 'column', gap: 2, minWidth: 230, padding: 8,
          background: COLORS.paper,
          opacity: open ? 1 : 0,
          transform: open ? 'translateY(0)' : 'translateY(-6px)',
          pointerEvents: open ? 'auto' : 'none',
          visibility: open ? 'visible' : 'hidden',
        }}
      >
        {options.map((o) => (
          <button
            key={o.v}
            type="button"
            role="option"
            aria-selected={o.v === value}
            onClick={() => { onChange(o.v); setOpen(false); }}
            className="fa-eng sk"
          >
            <span className="rd" />{o.l}
          </button>
        ))}
      </div>
    </div>
  );
}

// Attached image: thumbnail + filename + remove, as a gold pixel chip.
function AttachmentChip({ imgRef, onRemove }) {
  const truncate = (s, n = 28) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || 'pasted-image.png');
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '0 3px' }}>
      <span className="sk" style={{ fontSize: 11, color: COLORS.muted }}>ATTACHED</span>
      <div className="pxs" style={{
        display: 'inline-flex', alignItems: 'center', gap: 12, padding: 4, minWidth: 0,
        background: '#ffd25e', color: COLORS.onAccent,
      }}>
        <img
          src={imgRef.dataUrl}
          alt={imgRef.name || 'attachment'}
          style={{
            width: 26, height: 26, objectFit: 'cover', display: 'block', flexShrink: 0,
            border: '3px solid #1b1410', boxSizing: 'border-box',
          }}
        />
        <span style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{truncate(imgRef.name)}</span>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove attachment"
          style={{
            display: 'grid', placeItems: 'center', flexShrink: 0, width: 26, height: 26, padding: 0,
            border: 0, cursor: 'pointer', color: '#fffaf0', background: '#1b1410',
          }}
        ><StrokeIcon d={ICO.x} size={12} sw={3.4} /></button>
      </div>
    </div>
  );
}

function VideoOptionsBar({ opts, onChange }) {
  const set = (patch) => onChange({ ...opts, ...patch });
  return (
    <div role="group" aria-label="Video options" style={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 18px',
      padding: '8px 10px 10px', background: COLORS.field, border: '3px dashed ' + COLORS.rule,
    }}>
      <PillGroup label="DUR" value={opts.duration} onChange={(v) => set({ duration: v })}
        options={VIDEO_DURATIONS.map((s) => ({ v: s, l: `${s}s` }))} />
      <PillGroup label="RES" value={opts.resolution} onChange={(v) => set({ resolution: v })}
        options={VIDEO_RESOLUTIONS.map((r) => ({ v: r, l: r }))} />
      <PillGroup label="ASPECT" value={opts.aspectRatio} onChange={(v) => set({ aspectRatio: v })}
        options={VIDEO_ASPECTS.map((a) => ({ v: a, l: a }))} />
      <button
        type="button"
        onClick={() => set({ generateAudio: !opts.generateAudio })}
        aria-pressed={!!opts.generateAudio}
        className="sk sbtn"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, height: 30, padding: '0 10px', margin: '3px 7px 8px 3px', fontSize: 10,
          color: opts.generateAudio ? COLORS.onAccent : COLORS.text,
          background: opts.generateAudio ? '#ffd25e' : COLORS.paper,
        }}
        title="Generate audio track with the video"
      >
        <StrokeIcon d={ICO.sound} size={14} sw={2.6} />
        AUDIO {opts.generateAudio ? 'ON' : 'OFF'}
      </button>
    </div>
  );
}

function PillGroup({ label, value, onChange, options }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span className="sk" style={{ fontSize: 9, color: COLORS.muted }}>{label}</span>
      <div role="group" aria-label={label} className="fa-seg pxs">
        {options.map((o) => {
          const on = String(value) === String(o.v);
          return (
            <button
              key={o.v}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(o.v)}
              className="sk"
              style={{ height: 30, padding: '0 8px', fontSize: 10 }}
            >{o.l}</button>
          );
        })}
      </div>
    </div>
  );
}

// Name plate that straddles the top edge of an assistant dialog box, with an
// optional result-kind chip beside it.
function NamePlate({ badge, extra }) {
  return (
    <div style={{ position: 'absolute', left: 16, top: -14, zIndex: 1, display: 'flex', alignItems: 'center', gap: 14 }}>
      <span className="sk" style={{ padding: '6px 12px', fontSize: 11, color: COLORS.stripText, background: COLORS.strip }}>SE77N</span>
      {badge && (
        <span className="sk pxs" style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px', fontSize: 10,
          color: COLORS.onAccent, background: badge.color, whiteSpace: 'nowrap',
        }}><StrokeIcon d={badge.icon} size={12} sw={3} />{badge.label}</span>
      )}
      {extra}
    </div>
  );
}

// Checkerboard behind media so transparent PNGs (BG remove) read clearly.
const CHECKER = {
  backgroundColor: '#fffaf0',
  backgroundImage: 'linear-gradient(45deg, #d8cdb9 25%, transparent 25%, transparent 75%, #d8cdb9 75%), linear-gradient(45deg, #d8cdb9 25%, transparent 25%, transparent 75%, #d8cdb9 75%)',
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0, 8px 8px',
};

function Message({ role, content, image, video, typing, kind, error, badge, onReplyImage, onRetry, retryLabel }) {
  const isUser = role === 'user';

  if (isUser) {
    return (
      <div className="rise" style={{ display: 'flex', justifyContent: 'flex-end', paddingRight: 12 }}>
        <div className="fa-ubub" style={{
          display: 'flex', flexDirection: image ? 'column' : 'row', gap: 10,
          padding: image ? 10 : '12px 16px',
          fontSize: 14, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {image && (
            <img src={image} alt="" style={{
              display: 'block', maxWidth: '100%', maxHeight: 180, objectFit: 'contain', alignSelf: 'flex-start',
              border: '3px solid #fffaf0', ...CHECKER,
            }} />
          )}
          <span style={{ padding: image ? '0 6px 2px' : 0 }}>{content}</span>
          <svg className="fa-tail" width="12" height="12" viewBox="0 0 3 3" shapeRendering="crispEdges" aria-hidden="true"><path d="M0 0h1v1h1v1h1v1H0z" /></svg>
        </div>
      </div>
    );
  }

  const media = image || video;
  const text = error && typeof content === 'string' ? content.replace(/^⚠\s*/, '') : content;
  return (
    <div className={typing ? undefined : 'rise'} style={{ display: 'flex', justifyContent: 'flex-start' }}>
      <div role={typing ? 'status' : undefined} style={{ position: 'relative', width: typing ? 'auto' : '100%', maxWidth: media ? 560 : 640, marginTop: 14 }}>
        <NamePlate
          badge={typing ? null : badge}
          extra={typing && (kind === 'image' || kind === 'video') ? (
            <span className="sk pxs" style={{ padding: '4px 8px', fontSize: 10, color: COLORS.onAccent, background: '#ffd25e' }}>RENDERING</span>
          ) : null}
        />
        <div className="px" style={{
          position: 'relative', background: COLORS.paper, color: COLORS.text,
          padding: typing ? '28px 22px 18px' : '30px 22px 20px',
          borderLeft: error ? '8px solid #e04545' : undefined,
        }}>
          {typing ? <TypingDots kind={kind} /> : (
            <>
              {image && (
                <a href={image} target="_blank" rel="noreferrer" aria-label="Open image" className="pxs" style={{
                  display: 'block', border: '6px solid #ffd25e', ...CHECKER,
                }}>
                  <img src={image} alt="" style={{ display: 'block', width: '100%', maxHeight: 340, objectFit: 'contain' }} />
                </a>
              )}
              {video && (
                <div className="pxs" style={{ border: '6px solid #ffd25e', background: '#1b1410' }}>
                  <video src={video} controls style={{ display: 'block', width: '100%', maxHeight: 340 }} />
                </div>
              )}
              {error ? (
                <p style={{ display: 'flex', alignItems: 'flex-start', gap: 12, margin: 0, fontSize: 14, lineHeight: 1.55 }}>
                  <StrokeIcon d={ICO.warn} size={20} sw={2.6} color="#e04545" style={{ marginTop: 1 }} />
                  <span><span className="sr">Error: </span>{text}</span>
                </p>
              ) : text ? (
                <div style={{
                  marginTop: media ? 14 : 0, fontSize: 14, lineHeight: 1.7,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>{text}</div>
              ) : null}
              {(onRetry || onReplyImage || media) && (
                <div style={{
                  display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: onRetry ? 'flex-start' : 'flex-end',
                  gap: 16, marginTop: 16, padding: '0 6px 6px 3px',
                }}>
                  {onRetry && (
                    <button type="button" onClick={onRetry} className="sk sbtn" style={{
                      display: 'inline-flex', alignItems: 'center', gap: 8, height: 36, padding: '0 14px',
                      fontSize: 12, color: COLORS.onAccent, background: '#ff7a7a', textTransform: 'uppercase',
                    }}><StrokeIcon d={ICO.retry} size={14} sw={2.8} />{retryLabel}</button>
                  )}
                  {onReplyImage && (
                    <button type="button" onClick={onReplyImage} className="sk sbtn" style={{
                      display: 'inline-flex', alignItems: 'center', gap: 8, height: 36, padding: '0 12px',
                      fontSize: 11, color: COLORS.onAccent, background: '#ffd25e',
                    }}><StrokeIcon d={ICO.edit} size={13} sw={2.8} />REPLY · EDIT</button>
                  )}
                  {media && (
                    <a href={media} target="_blank" rel="noreferrer" className="sk sbtn" style={{
                      display: 'inline-flex', alignItems: 'center', gap: 8, height: 36, padding: '0 12px',
                      fontSize: 11, color: COLORS.text, background: COLORS.paper, textDecoration: 'none',
                    }}>OPEN <StrokeIcon d={ICO.open} size={13} sw={2.8} /></a>
                  )}
                </div>
              )}
            </>
          )}
          {!typing && !error && !media && (
            <PixelArrow dir="down" size={9} color="#e04545" className="bob" style={{ position: 'absolute', right: 16, bottom: 12 }} />
          )}
        </div>
      </div>
    </div>
  );
}

function TypingDots({ kind }) {
  const media = kind === 'image' || kind === 'video';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
      <span className="dots-step" aria-hidden="true" style={{ color: COLORS.text, display: 'inline-flex' }}><i /><i /><i /></span>
      <span className="sk" style={{ fontSize: 11, color: COLORS.muted }}>
        {media
          ? `RENDERING · ${kind === 'video' ? 'THIS CAN TAKE 30–60S' : 'A FEW SECONDS'}`
          : 'THINKING'}
      </span>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// 2. TOOLBOX — Public / Private (PIN 7777)
// ═════════════════════════════════════════════════════════════
// Pink isn't a global brand color — it's the dedicated accent for the Thảo
// love-letter tool, so it lives next to the tool data rather than in COLORS.
const PINK = '#f59cb4';
// Item-shop accents (B · Pixel Lobby palette) — always carry ink text.
const T_GOLD = '#ffd25e';
const T_GREEN = '#7fd18b';
const T_RED = '#ff7a7a';

const PUBLIC_TOOLS = [
  // Full modules folded into Toolbox — clicking these navigates to their panel.
  { id: 'tv4',  route: 'tv4',  name: 'Travel Plan',          desc: 'Trips · plans · expenses',   icon: '⊕', accent: T_GOLD,  tag: 'TRAVEL' },
  { id: 'tech', route: 'tech', name: 'Subscription Manager', desc: 'Monthly + yearly burn',      icon: '⌬', accent: T_GREEN, tag: 'FINANCE' },
  { id: 'todo', route: 'todo', name: 'To Do',                desc: 'Priorities · localStorage',  icon: '✓', accent: T_GREEN, tag: 'TASKS' },
  { id: 'short',   nameKey: 'tools.short.name',   descKey: 'tools.short.desc',   icon: '/',  accent: T_GREEN, tag: 'WEB' },
  { id: 'pst',     nameKey: 'tools.pst.name',     descKey: 'tools.pst.desc',     icon: '¶',  accent: T_GREEN, tag: 'WEB' },
  { id: 'game',    nameKey: 'tools.game.name',    descKey: 'tools.game.desc',    icon: '◉',  accent: T_GOLD,  tag: 'ARCHIVE' },
  { id: 'bmi',     nameKey: 'tools.bmi.name',     descKey: 'tools.bmi.desc',     icon: '⚖',  accent: T_GREEN, tag: 'HEALTH' },
  { id: 'convert', nameKey: 'tools.convert.name', descKey: 'tools.convert.desc', icon: '⇄',  accent: T_GOLD,  tag: 'MEDIA' },
  { id: 'mic',     nameKey: 'tools.mic.name',     descKey: 'tools.mic.desc',     icon: '⏺',  accent: T_RED,   tag: 'MEDIA' },
  { id: 'hex',     nameKey: 'tools.hex.name',     descKey: 'tools.hex.desc',     icon: '0x', accent: T_GREEN, tag: 'DEV' },
  { id: '2fa',     nameKey: 'tools.2fa.name',     descKey: 'tools.2fa.desc',     icon: '2F', accent: T_RED,   tag: 'SECURITY' },
  { id: 'thao',    nameKey: 'tools.thao.name',    descKey: 'tools.thao.desc',    icon: '♥',  accent: PINK,    tag: 'PIN · 4 DIGIT' },
];
const PRIVATE_TOOLS = [
  { id: 'srv', nameKey: 'tools.srv.name', descKey: 'tools.srv.desc', icon: '⌬', accent: T_RED, tag: 'OWNER' },
  { id: 'fin', nameKey: 'tools.fin.name', descKey: 'tools.fin.desc', icon: '$', accent: T_RED, tag: 'OWNER' },
];

const THAO_PIN = '2609';

// Inventory icons (square-cap strokes on the tool's accent tile).
const TOOL_ICON = {
  tv4: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14',
  tech: 'M3 6h18v13H3zM3 10h18M7 15h4',
  todo: 'M4 4h16v16H4zM8 12l3 3 5-6',
  short: 'M10 7H5v10h5M14 7h5v10h-5M8 12h8',
  pst: 'M5 5h14v16H5zM9 3h6v4H9zM8 12h8M8 16h5',
  game: 'M4 4h13l3 3v13H4zM8 4v5h7V4M8 20v-6h8v6',
  bmi: 'M12 4v16M7 20h10M4 7h16M6 7l-3 6h6zM18 7l-3 6h6z',
  convert: 'M4 8h15M15 4l4 4-4 4M20 16H5M9 12l-4 4 4 4',
  mic: 'M9 3h6v11H9zM5 11v1a7 7 0 0 0 14 0v-1M12 19v3M8 22h8',
  hex: 'M8 6l-5 6 5 6M16 6l5 6-5 6M14 4l-4 16',
  '2fa': 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM8.5 12l2.5 2.5 4.5-5',
  srv: 'M4 4h16v7H4zM4 13h16v7H4zM8 7.5h2M8 16.5h2',
  fin: 'M12 3v18M17 7H9.5a2.5 2.5 0 0 0 0 5h5a2.5 2.5 0 0 1 0 5H7',
};

function ToolIcon({ id, size = 26 }) {
  if (id === 'thao') return <PixelHeart size={size} color="#1b1410" />;
  return <StrokeIcon d={TOOL_ICON[id] || TOOL_ICON.tech} size={size} />;
}

// Accent icon tile for a tool (pixel ring, ink glyph).
function ToolTile({ tool, size = 48, className }) {
  return (
    <span className={'pxs' + (className ? ' ' + className : '')} style={{
      display: 'grid', placeItems: 'center', flexShrink: 0, width: size, height: size,
      background: tool.accent, color: COLORS.onAccent,
    }}>
      <ToolIcon id={tool.id} size={Math.round(size * 0.54)} />
    </span>
  );
}

// Pixel padlock — closed or open.
function PixelLock({ open = false, size = 10, color = 'currentColor', hole }) {
  return open ? (
    <svg width={size} height={size} viewBox="0 0 9 9" shapeRendering="crispEdges" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M4 0h4v1h1v2H8V1H5v3H4z" fill={color} /><path d="M0 4h7v5H0z" fill={color} />
    </svg>
  ) : (
    <svg width={Math.round(size * 8 / 9)} height={size} viewBox="0 0 8 9" shapeRendering="crispEdges" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M2 0h4v1h1v3H6V1H2v3H1V1h1z" fill={color} /><path d="M0 4h8v5H0z" fill={color} />
      {hole && <rect x="3" y="5" width="2" height="2" fill={hole} />}
    </svg>
  );
}

// PUBLIC / PRIVATE access badge.
function AccessBadge({ priv, unlocked, compact }) {
  return (
    <span className="sk" style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, flexShrink: 0,
      padding: compact ? 0 : '3px 7px', width: compact ? 24 : undefined, height: compact ? 24 : undefined,
      fontSize: 10, boxSizing: 'border-box', border: '2px solid ' + (priv ? COLORS.ink : COLORS.text),
      background: priv ? COLORS.ink : COLORS.field, color: priv ? COLORS.stripText : COLORS.text,
    }}>
      <PixelLock open={!priv || unlocked} size={10} />
      {compact ? <span className="sr">{priv ? 'Private' : 'Public'}</span> : (priv ? 'PRIVATE' : 'PUBLIC')}
    </span>
  );
}

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
  // Item-shop category filter (presentation only; resets with the access tab).
  const [cat, setCat] = useState('all');
  const scrollRef = useRef(null);
  // Opening / closing a tool starts at the top of the panel.
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; }, [activeTool]);

  // Phone shell (≤768) gets the dedicated mobile layout: full-width segmented
  // control, a scrolling category rail and a 2-up inventory of compact slots.
  const isMobile = useMediaQuery('(max-width: 768px)');

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
  const subtitle = tab === 'public'
    ? `${PUBLIC_TOOLS.length} public utilities — no sign-in`
    : (unlocked ? `${PRIVATE_TOOLS.length} private tools — owner only` : 'Locked zone — PIN required');
  const locked = tab === 'private' && !unlocked;

  // Category chips come from the tags of the tools in the current tab.
  const cats = useMemo(() => {
    const m = new Map();
    for (const tl of tools) m.set(tl.tag, (m.get(tl.tag) || 0) + 1);
    return [...m.entries()];
  }, [tools]);
  const shown = cat === 'all' ? tools : tools.filter((tl) => tl.tag === cat);
  const pad2 = (n) => String(n).padStart(2, '0');

  function pickTab(k) { setTab(k); setActiveTool(null); setCat('all'); }

  // ACCESS: PUBLIC / PRIVATE in one pixel ring.
  const segmented = (
    <div role="group" aria-label="Filter by access" className="fa-seg pxs sk" style={{
      display: isMobile ? 'grid' : 'inline-flex', gridTemplateColumns: isMobile ? '1fr 1fr' : undefined,
      fontSize: isMobile ? 12 : 13,
    }}>
      {['public', 'private'].map((k) => (
        <button
          key={k}
          type="button"
          aria-pressed={tab === k}
          onClick={() => pickTab(k)}
          className="sk"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            height: 44, padding: '0 16px', fontSize: 'inherit',
          }}
        >
          {k.toUpperCase()}
          <span style={{ opacity: 0.75 }}>{pad2(k === 'public' ? PUBLIC_TOOLS.length : PRIVATE_TOOLS.length)}</span>
          {k === 'private' && !unlocked && <PixelLock size={11} />}
        </button>
      ))}
    </div>
  );

  const chipRow = (
    <div role="group" aria-label="Filter by category" className={isMobile ? 'fa-rail' : undefined} style={{
      display: 'flex', flexWrap: isMobile ? 'nowrap' : 'wrap', gap: isMobile ? 14 : '16px 14px',
      overflowX: isMobile ? 'auto' : 'visible', padding: isMobile ? '3px 3px 8px' : 3, minWidth: 0, flex: 1,
    }}>
      {[['all', tools.length], ...cats].map(([c, n]) => (
        <button
          key={c}
          type="button"
          aria-pressed={cat === c}
          onClick={() => setCat(cat === c && c !== 'all' ? 'all' : c)}
          className={'chip-px sk' + (cat === c ? ' on' : '')}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
            height: isMobile ? 44 : 38, padding: '0 12px', fontSize: 11, whiteSpace: 'nowrap',
          }}
        >{c === 'all' ? 'ALL' : c} <span style={{ opacity: 0.7 }}>{pad2(n)}</span></button>
      ))}
    </div>
  );

  const status = (
    <p className="sk" style={{
      display: 'flex', alignItems: 'center', gap: 10, margin: 0, fontSize: isMobile ? 11 : 12,
      color: locked ? COLORS.muted : COLORS.greenInk, whiteSpace: 'nowrap',
    }}>
      <span className={locked ? undefined : 'blink'} style={{ width: 10, height: 10, background: 'currentColor' }} />
      {locked ? 'LOCKED' : (activeTool ? 'EQUIPPED' : `SHOWING ${pad2(shown.length)} / ${pad2(tools.length)} ITEMS`)}
    </p>
  );

  let body;
  if (locked) {
    body = (
      <div style={{ display: 'grid', placeItems: isMobile ? 'stretch' : 'center', padding: isMobile ? '6px 6px 0 3px' : '20px 0 10px' }}>
        <div className={'px' + (err ? ' fa-shake' : ' rise')} style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center',
          width: '100%', maxWidth: isMobile ? undefined : 400, boxSizing: 'border-box',
          padding: isMobile ? '28px 20px 26px' : '34px 30px 30px', background: COLORS.paper,
        }}>
          <span className="pxs" style={{ display: 'grid', placeItems: 'center', width: 64, height: 64, background: T_RED }}>
            <PixelLock size={32} color="#1b1410" hole={T_RED} />
          </span>
          <p className="sk" style={{ margin: '6px 0 0', fontSize: 16, color: COLORS.text }}>PRIVATE ZONE</p>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: COLORS.muted }}>
            Nhập 4-digit PIN để mở khu vực private.
          </p>
          <label className="sr" htmlFor="tb-pin">4-digit PIN</label>
          <div style={{ width: '100%', maxWidth: 260, marginTop: 8, padding: 3 }}>
            <PinInput id="tb-pin" value={pin} err={err}
              onChange={(v) => setPin(v.replace(/\D/g, '').slice(0, 4))}
              onEnter={tryUnlock} />
          </div>
          <PxButton kind="big" fill="#e04545" onClick={tryUnlock} style={{ width: '100%', maxWidth: 254, marginTop: 10 }}>
            UNLOCK
          </PxButton>
          {err && (
            <p className="sk" role="alert" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0 0', fontSize: 11, color: COLORS.text }}>
              <StrokeIcon d={ICO.x} size={12} sw={3.4} color="#e04545" />INVALID PIN
            </p>
          )}
        </div>
      </div>
    );
  } else if (activeTool) {
    body = (
      <ToolDetail
        tool={activeTool}
        name={toolName(activeTool)}
        desc={toolDesc(activeTool)}
        priv={tab === 'private'}
        accent={activeTool.accent}
        onBack={() => setActiveTool(null)}
      />
    );
  } else {
    body = (
      <>
        <div className={isMobile ? 'fa-inv-m' : 'fa-inv'} style={{ padding: isMobile ? '0 6px 6px 3px' : '0 12px 14px 4px' }}>
          {shown.map((tool, i) => {
            const name = toolName(tool);
            const desc = toolDesc(tool);
            const priv = tab === 'private';
            return isMobile ? (
              <button
                key={tool.id}
                type="button"
                onClick={() => openTool(tool)}
                className="fa-slot rise"
                style={{
                  display: 'flex', flexDirection: 'column', gap: 8, width: '100%', height: '100%', minHeight: 160,
                  boxSizing: 'border-box', padding: 12, textAlign: 'left', border: 0,
                  background: COLORS.paper, color: COLORS.text, animationDelay: i * 40 + 'ms',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6 }}>
                  <ToolTile tool={tool} size={38} />
                  <AccessBadge priv={priv} unlocked={unlocked} compact />
                </span>
                <span className={'pf' + (hasVi(name) ? ' fa-vi' : '')} style={{ fontSize: 15, lineHeight: 1.15 }}>{name}</span>
                <span className="fa-clamp2" style={{ fontSize: 11, lineHeight: 1.4, color: COLORS.muted }}>{desc}</span>
                <span className="sk" style={{
                  display: 'flex', justifyContent: 'space-between', gap: 6, marginTop: 'auto', paddingTop: 8,
                  borderTop: '3px dashed ' + COLORS.rule, fontSize: 9,
                }}><span style={{ color: COLORS.muted }}>{tool.tag}</span><PixelArrow size={9} /></span>
              </button>
            ) : (
              <button
                key={tool.id}
                type="button"
                onClick={() => openTool(tool)}
                className="fa-card px lift rise"
                style={{
                  position: 'relative', display: 'flex', flexDirection: 'column', gap: 12,
                  width: '100%', height: '100%', minHeight: 214, boxSizing: 'border-box', padding: 18,
                  textAlign: 'left', border: 0, background: COLORS.paper, color: COLORS.text,
                  animationDelay: i * 40 + 'ms',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                  <ToolTile tool={tool} className="fa-ico" />
                  <span className="sk" style={{ padding: '3px 7px', fontSize: 10, whiteSpace: 'nowrap', border: '2px solid ' + COLORS.text }}>{tool.tag}</span>
                </span>
                <span className={'pf' + (hasVi(name) ? ' fa-vi' : '')} style={{ fontSize: 20, lineHeight: 1.1 }}>{name}</span>
                <span style={{ fontSize: 12, lineHeight: 1.5, color: COLORS.muted }}>{desc}</span>
                <span className="sk" style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                  marginTop: 'auto', paddingTop: 12, borderTop: '3px dashed ' + COLORS.rule, fontSize: 10,
                }}>
                  <AccessBadge priv={priv} unlocked={unlocked} />
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{tool.route ? 'ENTER' : 'USE'} <PixelArrow size={9} /></span>
                </span>
              </button>
            );
          })}
        </div>
        {tab === 'public' && cat === 'all' && (
          <DialogBox speaker="SE77N SAYS:" padding={isMobile ? '28px 18px 24px' : '28px 24px 24px'}
            style={{ marginTop: isMobile ? 34 : 52, maxWidth: 760, marginRight: isMobile ? 6 : 12 }}>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: COLORS.text }}>
              Travel Plan, Subscription Manager and To Do live inside Toolbox — their cards open the full page. Every other item opens right here.
            </p>
          </DialogBox>
        )}
      </>
    );
  }

  return (
    <div ref={scrollRef} style={{
      height: '100%', overflowY: 'auto', overflowX: 'hidden', boxSizing: 'border-box',
      padding: isMobile ? '6px 2px 24px' : '8px 14px 36px 6px',
    }}>
      {/* Item-shop filters */}
      {isMobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 18 }}>
          <div style={{ padding: '3px 3px 0' }}>{segmented}</div>
          {!activeTool && <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: COLORS.muted }}>{subtitle}</p>}
          {!locked && !activeTool && chipRow}
          {!activeTool && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
              <h2 className="pf" style={{ margin: 0, fontSize: 22 }}>{locked ? 'Locked' : 'Inventory'}</h2>
              {status}
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, marginBottom: 46, padding: '0 8px 0 4px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 20 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 18 }}>
              <span className="sk" style={{ width: 92, fontSize: 12, color: COLORS.muted }}>ACCESS</span>
              {segmented}
              <span style={{ fontSize: 12, color: COLORS.muted }}>{subtitle}</span>
            </div>
            {status}
          </div>
          {!locked && !activeTool && (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 18 }}>
              <span className="sk" style={{ width: 92, paddingTop: 12, fontSize: 12, color: COLORS.muted }}>CATEGORY</span>
              {chipRow}
            </div>
          )}
        </div>
      )}
      {body}
    </div>
  );
}

// Big centred PIN well (Toolbox private zone + Thảo letter).
function PinInput({ id, value, onChange, onEnter, err }) {
  return (
    <input
      id={id}
      type="password"
      inputMode="numeric"
      autoComplete="off"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') onEnter(); }}
      placeholder="• • • •"
      autoFocus
      className="field mono"
      style={{
        width: '100%', height: 56, padding: '0 12px', boxSizing: 'border-box', textAlign: 'center',
        fontSize: 22, letterSpacing: '0.5em',
        ...(err ? { boxShadow: '0 -3px 0 0 #e04545, 0 3px 0 0 #e04545, -3px 0 0 0 #e04545, 3px 0 0 0 #e04545' } : {}),
      }}
    />
  );
}

// The "EQUIPPED" panel: an RPG box with a back button, the tool's tile and
// its body. On wide screens an item card sits beside it.
function ToolDetail({ tool, name, desc, priv, accent, onBack }) {
  const isMobile = useMediaQuery('(max-width: 768px)');
  const wide = useMediaQuery('(min-width: 1181px)');
  return (
    <div className="rise" style={{ display: 'flex', alignItems: 'flex-start', gap: 40, padding: isMobile ? '0 6px 0 3px' : '0 12px 0 4px' }}>
      <div style={{ position: 'relative', flex: '999 1 560px', minWidth: 0, marginTop: 14 }}>
        <span className="sk" style={{
          position: 'absolute', left: isMobile ? 14 : 20, top: -18, zIndex: 1, padding: '6px 12px',
          fontSize: 12, color: COLORS.stripText, background: COLORS.strip,
        }}>EQUIPPED</span>
        <div className="px" style={{ padding: isMobile ? '30px 16px 22px' : '34px 26px 28px', background: COLORS.paper }}>
          <div style={{
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: isMobile ? 14 : 18,
            paddingBottom: 20, borderBottom: '3px dashed ' + COLORS.rule,
          }}>
            <button type="button" onClick={onBack} className="sk sbtn" style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0, height: 38, padding: '0 12px',
              fontSize: 11, color: COLORS.text, background: COLORS.paper,
            }}><PixelArrow dir="left" size={10} />BACK</button>
            <ToolTile tool={tool} size={isMobile ? 40 : 48} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="sk" style={{ marginBottom: 6, fontSize: 11, color: COLORS.muted }}>TOOL · {tool.tag}</div>
              <h2 className={'pf' + (hasVi(name) ? ' fa-vi' : '')} style={{ margin: 0, fontSize: isMobile ? 22 : 26, lineHeight: 1.05 }}>{name}</h2>
            </div>
            {!isMobile && <AccessBadge priv={priv} unlocked />}
          </div>
          <div style={{ marginTop: 24 }}>
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
             <PlaceholderTool tool={tool} name={name} desc={desc} accent={accent} />}
          </div>
        </div>
      </div>

      {wide && (
        <aside aria-label="Item card" style={{ flex: '1 1 260px', maxWidth: 320, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 40, marginTop: 14 }}>
          <div className="px" style={{ padding: '22px 22px 14px', background: COLORS.paper }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
              <ToolTile tool={tool} size={56} className="bob" />
              <div className="sk" style={{ fontSize: 11, color: COLORS.muted, lineHeight: 1.5 }}>ITEM CARD<br />SLOT · {tool.id.toUpperCase()}</div>
            </div>
            <p style={{ margin: '0 0 8px', fontSize: 13, lineHeight: 1.55, color: COLORS.text }}>{desc}</p>
            <dl style={{ margin: 0 }}>
              {[['CATEGORY', tool.tag], ['ACCESS', priv ? 'OWNER · PIN' : 'PUBLIC']].map(([k, v], i) => (
                <div key={k} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '10px 0',
                  borderTop: '3px dashed ' + COLORS.rule,
                }}>
                  <dt className="sk" style={{ fontSize: 10, color: COLORS.muted }}>{k}</dt>
                  <dd className="sk" style={{ margin: 0, fontSize: 11, textAlign: 'right' }}>{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="px" style={{ padding: '20px 22px 16px', background: COLORS.paper }}>
            <div className="sk" style={{ marginBottom: 6, fontSize: 12, color: COLORS.muted }}>ACCESS KEY</div>
            {[
              [<AccessBadge key="p" />, 'No sign-in — open to everyone'],
              [<AccessBadge key="q" priv />, 'Owner only — 4-digit PIN'],
            ].map(([b, txt], i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0', borderBottom: i === 0 ? '3px dashed ' + COLORS.rule : 'none' }}>
                <span style={{ width: 92, flexShrink: 0 }}>{b}</span>
                <span style={{ fontSize: 12, lineHeight: 1.45, color: COLORS.muted }}>{txt}</span>
              </div>
            ))}
          </div>
        </aside>
      )}
    </div>
  );
}

// ── Shared tool UI (B vocabulary) ──────────────────────────────
// Visible label above an input.
function TLabel({ children, htmlFor, style }) {
  return (
    <label htmlFor={htmlFor} className="sk" style={{ display: 'block', marginBottom: 8, fontSize: 11, color: COLORS.muted, ...style }}>
      {children}
    </label>
  );
}

// Inline error: paper slab, red edge + warning glyph, ink text (contrast-safe).
function TError({ children, style }) {
  return (
    <div role="alert" className="pxs" style={{
      display: 'flex', alignItems: 'flex-start', gap: 10, padding: '11px 14px', margin: 3,
      background: COLORS.paper, color: COLORS.text, borderLeft: '6px solid #e04545',
      fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', ...style,
    }}>
      <StrokeIcon d={ICO.warn} size={16} sw={2.6} color="#e04545" style={{ marginTop: 1 }} />
      <span className="mono">{children}</span>
    </div>
  );
}

// Dark "screen" output box with a blinking OUTPUT header.
function Screen({ label = 'OUTPUT', dot = '#7fd18b', children, style, live = true, right }) {
  return (
    <div className="fa-screen" aria-live={live ? 'polite' : undefined} style={{ padding: '18px 20px 20px', ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
        <span className="sk" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: '#c9bca6' }}>
          <span className="blink" style={{ width: 8, height: 8, background: dot }} />{label}
        </span>
        {right}
      </div>
      {children}
    </div>
  );
}

// "> PROMPT_" idle line for screens.
function ScreenPrompt({ children }) {
  return (
    <p className="sk" style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: '#fffaf0' }}>
      &gt; {children}<span className="blink" style={{ color: '#7fd18b' }}>_</span>
    </p>
  );
}

// Primary action — big pixel button in the tool's accent.
function PrimaryBtn({ accent, children, style, ...rest }) {
  return (
    <PxButton kind="big" fill={accent} style={{ height: 50, minHeight: 50, padding: '0 22px', fontSize: 14, textTransform: 'uppercase', ...style }} {...rest}>
      {children}
    </PxButton>
  );
}

// Note / hint slab (dashed rule frame).
function TNote({ children, style }) {
  return (
    <div className="mono" style={{
      padding: '11px 14px', border: '3px dashed ' + COLORS.rule, background: COLORS.field,
      fontSize: 11, lineHeight: 1.6, color: COLORS.muted, ...style,
    }}>{children}</div>
  );
}

// Pixel progress bar (stage + percent).
function TProgress({ stage, progress, accent }) {
  return (
    <div>
      <div className="sk" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 8, fontSize: 10, color: COLORS.muted }}>
        <span>{stage}</span>
        <span>{Math.round(progress * 100)}%</span>
      </div>
      <div className="hpbar" style={{ '--a': accent }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
        <span style={{ width: `${progress * 100}%` }} />
      </div>
    </div>
  );
}

// Segmented choice in one ring.
function Seg({ value, options, onChange, label, disabled, size = 'md' }) {
  return (
    <div role="group" aria-label={label} className="fa-seg pxs" style={{ margin: 3 }}>
      {options.map((o) => {
        const v = typeof o === 'string' ? o : o.v;
        const l = typeof o === 'string' ? o : o.l;
        return (
          <button key={v} type="button" aria-pressed={value === v} disabled={disabled}
            onClick={() => onChange(v)} className="sk"
            style={{ height: size === 'lg' ? 46 : 36, padding: size === 'lg' ? '0 16px' : '0 12px', fontSize: size === 'lg' ? 13 : 11 }}>
            {l}
          </button>
        );
      })}
    </div>
  );
}

// Copy-to-clipboard small button.
function CopyBtn({ onClick, children = 'COPY', style }) {
  return (
    <button type="button" onClick={onClick} className="sk sbtn" style={{
      display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0, height: 36, padding: '0 12px',
      fontSize: 11, color: '#1b1410', background: '#fffaf0', textTransform: 'uppercase', ...style,
    }}><StrokeIcon d={ICO.copy} size={13} sw={2.6} />{children}</button>
  );
}

// Labelled text input (pixel well). Mirrors Field's onChange(value) API.
function TInput({ id, value, onChange, placeholder, type = 'text', onKeyDown, autoFocus, inputMode, ariaLabel, style }) {
  return (
    <input
      id={id}
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      onKeyDown={onKeyDown}
      autoFocus={autoFocus}
      inputMode={inputMode}
      aria-label={ariaLabel}
      className="field mono"
      style={{ width: '100%', height: 46, padding: '0 14px', boxSizing: 'border-box', fontSize: 14, ...style }}
    />
  );
}

const TEXTAREA_STYLE = {
  width: '100%', boxSizing: 'border-box', padding: '12px 14px', fontSize: 13, lineHeight: 1.6,
  resize: 'vertical', display: 'block',
};

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
    <div style={{ display: 'grid', placeItems: 'center', minHeight: 340, padding: '10px 0' }}>
      <div className={'px ' + (err ? 'fa-shake' : 'rise')} style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center',
        width: '100%', maxWidth: 380, boxSizing: 'border-box', padding: '32px 28px 28px', background: COLORS.paper,
      }}>
        <span className="pxs" style={{ display: 'grid', placeItems: 'center', width: 64, height: 64, background: accent }}>
          <PixelHeart size={34} color="#1b1410" />
        </span>
        <div className="sk fa-vi" style={{ marginTop: 6, fontSize: 16, fontWeight: 700, color: COLORS.text }}>Thảo</div>
        <div style={{ fontSize: 13, color: COLORS.muted, marginBottom: 8, lineHeight: 1.5 }}>
          {unlocked
            ? 'Bấm mở để xem lại lá thư (mở trong tab mới).'
            : 'Nhập 4 số bí mật để mở lá thư.'}
        </div>
        {unlocked ? (
          <PxButton kind="big" fill={accent} onClick={openLetter} style={{ width: '100%', maxWidth: 260 }}>
            <PixelHeart size={16} color="#1b1410" /> <span className="fa-vi">Mở thư</span> <StrokeIcon d={ICO.open} size={14} sw={2.8} />
          </PxButton>
        ) : (
          <>
            <label className="sr" htmlFor="thao-pin">4-digit PIN</label>
            <div style={{ width: '100%', maxWidth: 260, padding: 3 }}>
              <PinInput id="thao-pin" value={pin} err={err}
                onChange={(v) => setPin(v.replace(/\D/g, '').slice(0, 4))}
                onEnter={tryUnlock} />
            </div>
            <PxButton kind="big" fill={accent} onClick={tryUnlock} style={{ width: '100%', maxWidth: 254, marginTop: 10 }}>
              <span className="fa-vi">Mở</span>
            </PxButton>
            {err && (
              <p className="sk" role="alert" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0 0', fontSize: 11, color: COLORS.text }}>
                <StrokeIcon d={ICO.x} size={12} sw={3.4} color="#e04545" /><span className="fa-vi">SAI MÃ</span>
              </p>
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
    <div style={{ display: 'grid', gap: 20 }}>
      <div>
        <TLabel htmlFor="sh-url">LONG URL</TLabel>
        <div style={{ padding: 3 }}><TInput id="sh-url" value={url} onChange={setUrl} placeholder="https://…" type="url" /></div>
      </div>
      <div>
        <TLabel htmlFor="sh-alias">CUSTOM ALIAS (optional)</TLabel>
        <div style={{ padding: 3 }}><TInput id="sh-alias" value={alias} onChange={setAlias} placeholder="my-link" /></div>
      </div>
      <div style={{ padding: '4px 0 6px 4px' }}>
        <PrimaryBtn accent={accent} onClick={shorten} disabled={busy}>
          {busy ? 'Shortening…' : 'Shorten'} <PixelArrow size={12} />
        </PrimaryBtn>
      </div>
      <Screen style={{ minHeight: 112 }}>
        {err ? (
          <p className="sk" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0, fontSize: 13, color: '#ff7a7a' }}>
            <StrokeIcon d={ICO.x} size={12} sw={3.4} />{err}
          </p>
        ) : out ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
            <a
              href={out.url}
              target="_blank"
              rel="noreferrer"
              className="mono"
              style={{ minWidth: 0, fontSize: 14, color: '#7fd18b', fontWeight: 700, textDecoration: 'none', wordBreak: 'break-all' }}
            >{out.url}</a>
            <CopyBtn onClick={() => copyText(out.url)}>Copy</CopyBtn>
          </div>
        ) : (
          <ScreenPrompt>{busy ? 'SHORTENING' : 'PASTE A LONG URL'}</ScreenPrompt>
        )}
      </Screen>
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
    <div style={{ display: 'grid', gap: 18 }}>
      <div>
        <TLabel htmlFor="pst-text">PASTE CONTENT</TLabel>
        <div style={{ padding: 3 }}>
          <textarea
            id="pst-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={9}
            className="field mono"
            placeholder="Drop your snippet, log, or note here…"
            style={{ ...TEXTAREA_STYLE, fontSize: 12 }}
          />
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'center', padding: '4px 0 6px 4px' }}>
        <PrimaryBtn accent={accent} onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save paste'} <PixelArrow size={12} />
        </PrimaryBtn>
        <span className="sk" style={{ fontSize: 10, color: COLORS.muted }}>
          {text.length} chars · {(new Blob([text]).size / 1024).toFixed(1)} KB
        </span>
      </div>
      <Screen style={{ minHeight: 104 }}>
        {err ? (
          <p className="sk" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0, fontSize: 13, color: '#ff7a7a' }}>
            <StrokeIcon d={ICO.x} size={12} sw={3.4} />{err}
          </p>
        ) : saved ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
            <a
              href={saved.url}
              target="_blank"
              rel="noreferrer"
              className="mono"
              style={{ minWidth: 0, fontSize: 13, color: '#7fd18b', fontWeight: 700, textDecoration: 'none', wordBreak: 'break-all' }}
            >{saved.url}</a>
            <CopyBtn onClick={() => copyText(saved.url)}>Copy</CopyBtn>
          </div>
        ) : (
          <ScreenPrompt>{busy ? 'SAVING' : 'WRITE SOMETHING, THEN SAVE'}</ScreenPrompt>
        )}
      </Screen>
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

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div>
        <TLabel htmlFor="hex-in">HEX INPUT</TLabel>
        <div style={{ padding: 3 }}>
          <textarea
            id="hex-in"
            value={hex}
            onChange={(e) => { setHex(e.target.value); setErr(''); }}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') convert();
            }}
            rows={7}
            className="field mono"
            placeholder="48656c6c6f20576f726c64 or 0x48 0x65 0x6c 0x6c 0x6f"
            style={TEXTAREA_STYLE}
          />
        </div>
        <div className="mono" style={{ marginTop: 8, fontSize: 11, lineHeight: 1.5, color: COLORS.muted }}>
          Hỗ trợ HEX liền nhau, khoảng trắng, dấu phẩy, 0x và \\x · Ctrl/⌘ + Enter để chuyển đổi
        </div>
      </div>

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center', padding: '4px 0 6px 4px' }}>
        <PrimaryBtn accent={accent} onClick={convert} disabled={!hex.trim()} style={{ textTransform: 'none' }}>
          <span className="fa-vi" style={{ fontWeight: 700 }}>Chuyển sang text</span> <PixelArrow size={12} />
        </PrimaryBtn>
        <Btn variant="ghost" onClick={clear} disabled={!hex && !output}><span className="fa-vi">Xóa</span></Btn>
      </div>

      {err && <TError>{err}</TError>}

      <Screen
        label="TEXT OUTPUT"
        right={output !== '' ? (
          <CopyBtn onClick={copyOutput}><span className="fa-vi">{copied ? 'Đã sao chép' : 'Sao chép'}</span></CopyBtn>
        ) : null}
      >
        {output !== '' ? (
          <textarea
            value={output}
            readOnly
            rows={7}
            aria-label="Text output"
            className="mono"
            style={{
              ...TEXTAREA_STYLE, padding: 0, border: 0, outline: 'none', background: 'transparent',
              color: '#fffaf0', fontSize: 14,
            }}
          />
        ) : (
          <ScreenPrompt>DECODED TEXT APPEARS HERE</ScreenPrompt>
        )}
      </Screen>
    </div>
  );
}

// WHO BMI bands, scaled onto a 12–40 axis so the marker + segmented gauge
// share one coordinate space. Asia-Pacific cutoffs differ (overweight ≥23),
// but we keep the standard WHO bands and surface the healthy-weight RANGE for
// the user's height, which is the more actionable number anyway.
const BMI_BANDS = [
  { max: 18.5, label: 'Thiếu cân',   color: '#9fd8ff' },
  { max: 25,   label: 'Bình thường', color: '#7fd18b' },
  { max: 30,   label: 'Thừa cân',    color: '#ffd25e' },
  { max: Infinity, label: 'Béo phì', color: '#ff7a7a' },
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

  // Tick positions on the 12–40 axis for the band edges.
  const tickPct = (v) => ((v - BMI_AXIS_MIN) / (BMI_AXIS_MAX - BMI_AXIS_MIN)) * 100;
  const gauge = (lit) => (
    <div aria-hidden="true" style={{ display: 'flex', height: 16, border: '3px solid ' + (lit ? '#fffaf0' : '#5c5046') }}>
      {segments.map((s, i) => (
        <span key={i} style={{
          width: s.pct + '%', background: lit ? s.color : '#2e251d',
          borderLeft: i ? '3px solid #1b1410' : 'none',
        }} />
      ))}
    </div>
  );

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 18 }}>
        <div>
          <TLabel htmlFor="bmi-h" style={labelStyle}><span className="fa-vi">CHIỀU CAO</span> (cm)</TLabel>
          <div style={{ padding: 3 }}>
            <TInput
              id="bmi-h"
              inputMode="decimal"
              value={height}
              onChange={(v) => setHeight(v.replace(/[^\d.,]/g, ''))}
              placeholder="170"
              style={{ fontSize: 16, height: 48 }}
            />
          </div>
        </div>
        <div>
          <TLabel htmlFor="bmi-w" style={labelStyle}><span className="fa-vi">CÂN NẶNG</span> (kg)</TLabel>
          <div style={{ padding: 3 }}>
            <TInput
              id="bmi-w"
              inputMode="decimal"
              value={weight}
              onChange={(v) => setWeight(v.replace(/[^\d.,]/g, ''))}
              placeholder="65"
              style={{ fontSize: 16, height: 48 }}
            />
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <Btn variant="ghost" onClick={reset} disabled={!height && !weight}><span className="fa-vi">Xóa</span></Btn>
        <span className="sk" style={{ fontSize: 10, color: COLORS.muted }}>WHO BANDS · AXIS 12–40</span>
      </div>

      <Screen style={{ minHeight: 196 }}>
        {bmi != null ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div className="pf" style={{ fontSize: 56, lineHeight: 0.9, color: band.color }}>
                {bmi.toFixed(1)}
              </div>
              <div className="sk" style={{ padding: '6px 10px', fontSize: 12, color: '#1b1410', background: band.color }}>
                <span className="fa-vi" style={{ fontWeight: 700 }}>{band.label}</span>
              </div>
            </div>

            {/* Segmented WHO gauge + marker */}
            <div style={{ position: 'relative', marginTop: 30 }}>
              <svg width="14" height="10" viewBox="0 0 7 5" shapeRendering="crispEdges" aria-hidden="true" style={{
                position: 'absolute', top: -15, left: `calc(${markerPct}% - 7px)`,
              }}><path d="M0 0h7v1H6v1H5v1H4v1H3V3H2V2H1V1H0z" fill="#fffaf0" /></svg>
              {gauge(true)}
              <div className="sk" aria-hidden="true" style={{ position: 'relative', height: 14, marginTop: 8, fontSize: 10, color: '#c9bca6' }}>
                {[18.5, 25, 30].map((v) => (
                  <span key={v} style={{ position: 'absolute', left: tickPct(v) + '%', transform: 'translateX(-50%)' }}>{v}</span>
                ))}
              </div>
            </div>

            <div className="mono" style={{ fontSize: 12, color: '#c9bca6', marginTop: 18, lineHeight: 1.6 }}>
              Cân nặng hợp lý cho {h} cm:{' '}
              <span style={{ color: '#7fd18b', fontWeight: 700 }}>
                {idealMin.toFixed(1)}–{idealMax.toFixed(1)} kg
              </span>
            </div>
          </div>
        ) : (
          <div>
            <p className="mono" style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: '#fffaf0' }}>
              &gt; Nhập chiều cao &amp; cân nặng để tính BMI.<span className="blink" style={{ color: '#7fd18b' }}>_</span>
            </p>
            <p className="mono" style={{ margin: '12px 0 0', fontSize: 12, lineHeight: 1.6, color: '#c9bca6' }}>
              Công thức: <span style={{ color: '#7fd18b' }}>cân nặng (kg) ÷ chiều cao² (m)</span>.
            </p>
            <div style={{ marginTop: 24 }}>{gauge(false)}</div>
          </div>
        )}
      </Screen>
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
    <div style={{ display: 'grid', gap: 20 }}>
      <div>
        <TLabel htmlFor="totp-secret">{labels.input}</TLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 14, alignItems: 'center', padding: '3px 0 0 3px' }}>
          <TInput
            id="totp-secret"
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
          <Btn variant="ghost" onClick={() => setVisible((value) => !value)} style={{ margin: '3px 7px 8px 3px' }}>
            {visible ? labels.hide : labels.show}
          </Btn>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center', padding: '4px 0 6px 4px' }}>
        <PrimaryBtn accent={accent} onClick={activate} disabled={!secret.trim() || busy}>
          {busy ? labels.generating : labels.generate} <PixelArrow size={12} />
        </PrimaryBtn>
        <Btn variant="ghost" onClick={reset} disabled={!secret && !code}>{labels.clear}</Btn>
      </div>

      {err && <TError>{err}</TError>}

      <Screen
        label="ONE-TIME CODE"
        dot={code ? (remaining <= 5 ? '#ff7a7a' : '#7fd18b') : '#5c5046'}
        right={code ? <CopyBtn onClick={copyCode}>{copied ? labels.copied : labels.copy}</CopyBtn> : null}
      >
        {code ? (
          <div style={{ display: 'grid', gap: 18 }}>
            <button
              type="button"
              onClick={copyCode}
              className="pf"
              title={labels.copy}
              style={{
                justifySelf: 'start', border: 0, background: 'transparent', padding: 0, cursor: 'pointer',
                color: accent, fontSize: 'clamp(36px, 7vw, 60px)', fontWeight: 700,
                letterSpacing: '0.12em', lineHeight: 1, whiteSpace: 'nowrap',
              }}
            >{code.slice(0, 3)} {code.slice(3)}</button>
            <div>
              <div className="sk" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 8, fontSize: 10, color: '#c9bca6' }}>
                <span>{labels.next} {remaining}s</span>
                <span style={{ color: remaining <= 5 ? '#ff7a7a' : '#fffaf0' }}>{String(remaining).padStart(2, '0')}</span>
              </div>
              <div className="hpbar" style={{ '--a': remaining <= 5 ? '#ff7a7a' : accent, background: '#2e251d', borderColor: '#fffaf0' }} aria-hidden="true">
                <span style={{ width: `${(remaining / 30) * 100}%` }} />
              </div>
            </div>
          </div>
        ) : (
          <ScreenPrompt>------</ScreenPrompt>
        )}
      </Screen>

      <TNote>{labels.local}</TNote>
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
    { id: 'image', label: 'IMAGE', sub: 'PNG · JPG · WEBP · GIF', icon: PRESET_ICON.image },
    { id: 'video', label: 'VIDEO', sub: 'FILE / LINK → GIF / MP3', icon: PRESET_ICON.video },
  ];
  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <div role="tablist" aria-label="Converter mode" style={{
        display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16, padding: 3,
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
              className="chip-px"
              style={{
                display: 'flex', alignItems: 'center', gap: 12, minWidth: 0,
                textAlign: 'left', padding: '12px 14px',
              }}
            >
              <span className="pxs" style={{
                display: 'grid', placeItems: 'center', flexShrink: 0, width: 36, height: 36,
                background: accent, color: COLORS.onAccent,
              }}><StrokeIcon d={tab.icon} size={20} /></span>
              <span style={{ minWidth: 0 }}>
                <span className="sk" style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>{tab.label}</span>
                <span className="sk" style={{ display: 'block', fontSize: 9, opacity: 0.75, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tab.sub}</span>
              </span>
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
    <div style={{ display: 'grid', gap: 22 }}>
      <div style={{ display: 'grid', gap: 10 }}>
        <TLabel htmlFor="imgc-url" style={{ marginBottom: 0 }}>1. ADD IMAGE</TLabel>
        <div style={{ padding: 3 }}>
          <TInput
            id="imgc-url"
            value={imageUrl}
            onChange={handleImageUrlChange}
            placeholder="Paste a direct image link - it loads automatically"
            style={{ height: 50, fontSize: 14 }}
          />
        </div>
        <div className="sk" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: urlBusy ? COLORS.text : COLORS.muted }}>
          {urlBusy && <span className="blink" style={{ width: 8, height: 8, background: accent }} />}
          {urlBusy ? 'LOADING IMAGE LINK...' : 'PASTE A LINK, OR USE THE DROP ZONE BELOW'}
        </div>
        <label
          onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
          onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setIsDragging(true); }}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setIsDragging(false); }}
          onDrop={handleDrop}
          className={'fa-dropzone' + (isDragging ? ' on' : '')}
          style={{
            minHeight: 164, padding: 24, textAlign: 'center',
            display: 'grid', placeItems: 'center',
          }}
        >
          <input type="file" accept="image/*,.gif,.webp" onChange={onFile} className="sr" />
          {src ? (
            <div style={{ display: 'flex', gap: 18, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
              <img src={src.dataUrl} style={{ height: 100, maxWidth: 130, objectFit: 'cover', border: '3px solid ' + COLORS.ink, ...CHECKER }} alt="" />
              <div style={{ textAlign: 'left', minWidth: 0 }}>
                <div className="mono" style={{ fontSize: 13, fontWeight: 700, color: COLORS.text, wordBreak: 'break-all' }}>{src.name}</div>
                <div className="mono" style={{ fontSize: 11, color: COLORS.muted, marginTop: 6 }}>
                  {(src.size / 1024).toFixed(1)} KB - {src.w}x{src.h}{cropRect ? ` -> ${Math.round(cropRect.w * src.w)}x${Math.round(cropRect.h * src.h)}` : ''}
                </div>
                <div className="sk" style={{ fontSize: 10, color: COLORS.text, marginTop: 12 }}>DROP ANOTHER IMAGE TO REPLACE</div>
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', justifyItems: 'center' }}>
              <span className="pxs" style={{ display: 'grid', placeItems: 'center', width: 44, height: 44, marginBottom: 14, background: accent, color: COLORS.onAccent }}>
                <StrokeIcon d={ICO.plus} size={22} sw={3} />
              </span>
              <div className="sk" style={{ fontSize: 14, color: COLORS.text }}>DROP IMAGE HERE</div>
              <div className="mono" style={{ fontSize: 11, color: COLORS.muted, marginTop: 8, lineHeight: 1.5 }}>
                Drag a file from your device or an image/link from another website. Click to browse.
              </div>
            </div>
          )}
        </label>
      </div>

      {/* Source -> target format */}
      <div style={{ padding: '16px 16px 18px', border: '3px dashed ' + COLORS.rule, background: COLORS.field }}>
        <div className="sk" style={{ marginBottom: 14, fontSize: 11, color: COLORS.muted }}>2. CHOOSE FORMAT</div>
        <div style={{ display: 'flex', alignItems: 'end', gap: 18, flexWrap: 'wrap' }}>
          <div style={{ display: 'grid', gap: 8 }}>
            <div className="sk" style={{ fontSize: 10, color: COLORS.muted }}>SOURCE</div>
            <FmtPills value={srcFmt} options={FORMATS} accent={accent} onChange={setSrcFmt} dim label="Source format" />
          </div>
          <button
            type="button"
            onClick={swap}
            title="Swap source and target formats"
            aria-label="Swap formats"
            className="sbtn"
            style={{
              display: 'grid', placeItems: 'center', width: 48, height: 46, margin: '3px 7px 8px 3px',
              color: COLORS.onAccent, background: accent,
            }}
          ><StrokeIcon d={ICO.swap} size={22} /></button>
          <div style={{ display: 'grid', gap: 8 }}>
            <div className="sk" style={{ fontSize: 10, color: COLORS.text }}>CONVERT TO</div>
            <FmtPills value={target} options={FORMATS} accent={accent} onChange={setTarget} label="Target format" />
          </div>
        </div>
        {(srcFmt === 'gif' || target === 'gif') && (
          <div className="mono" style={{ fontSize: 11, color: COLORS.muted, marginTop: 14, lineHeight: 1.5 }}>
            GIF and WebP keep animation. First use loads FFmpeg once in your browser.
          </div>
        )}
      </div>

      <div>
        <TLabel htmlFor="imgc-q">3. QUALITY - {quality}</TLabel>
        <input
          id="imgc-q"
          type="range" min="20" max="100" value={quality}
          onChange={(event) => setQuality(+event.target.value)}
          className="fa-range"
          style={{ '--a': accent }}
        />
      </div>

      {/* Crop controls — opens an inline cropper that renders the source
          and lets the user drag a rectangle. cropRect is in 0..1 so it
          survives quality / format changes without re-clipping. */}
      {src && (
        <div>
          <TLabel>CROP {cropRect ? '· APPLIED' : '· OFF'}</TLabel>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Btn variant={cropOpen ? 'tinted' : 'ghost'} color={accent} onClick={() => setCropOpen((v) => !v)}>
              <span className="fa-vi">{cropOpen ? 'Đóng cropper' : 'Mở crop'}</span>
            </Btn>
            {cropRect && (
              <Btn variant="ghost" color={accent} onClick={() => setCropRect(null)}>
                <span className="fa-vi">Xoá vùng crop</span>
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

      <div style={{ padding: '4px 0 6px 4px' }}>
        <PrimaryBtn accent={accent} onClick={download} disabled={!src || busy}>
          {busy ? (stage || 'Working…') : `Convert ${cropRect ? '+ Crop ' : ''}& Download`}
          {!busy && <StrokeIcon d={ICO.down} size={16} sw={2.8} />}
        </PrimaryBtn>
      </div>
      {err && <TError>{err}</TError>}
    </div>
  );
}

// Compact pill row for source / target format. `dim` styles the source
// chip a touch lower-key so the visual hierarchy reads "SRC → TGT".
function FmtPills({ value, options, onChange, accent, dim, label }) {
  return (
    <div role="group" aria-label={label} className="fa-seg pxs" style={{ margin: '3px 7px 8px 3px', opacity: dim ? 0.9 : 1 }}>
      {options.map((f) => (
        <button key={f} type="button" aria-pressed={value === f} onClick={() => onChange(f)} className="sk"
          style={{ minWidth: 60, height: 46, padding: '0 14px', fontSize: 13 }}>
          {f.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

// Inline cropper — preview-sized canvas with a drag-and-resize rectangle.
// Outputs a normalized rect (0..1) so the parent can apply it at the
// source's full resolution at convert time.
function CropCanvas({ src, value, onChange, accent }) {
  const wrapRef = useRef(null);
  const [box, setBox] = useState(value || { x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
  const [drag, setDrag] = useState(null); // { mode: 'move'|'tl'|'tr'|'bl'|'br'|'new', startX, startY, start: box }

  useEffect(() => { onChange(box); }, [box]);

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
    <div style={{ display: 'grid', gap: 10 }}>
      <div
        ref={wrapRef}
        onPointerDown={(e) => {
          // Start a fresh rect only if the user clicked the empty image
          // area (not on the existing rect or its handles).
          if (e.target === wrapRef.current || e.target.tagName === 'IMG') {
            onPointerDown(e, 'new');
          }
        }}
        className="pxs"
        style={{
          position: 'relative',
          width: dispW, maxWidth: 'calc(100% - 6px)',
          margin: 3,
          aspectRatio: `${src.w} / ${src.h}`,
          background: '#1b1410',
          overflow: 'hidden',
          touchAction: 'none',
          userSelect: 'none',
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
        <div style={{ position: 'absolute', left: 0, top: 0, right: 0, height: pct(box.y), background: 'rgba(27,20,16,0.62)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', left: 0, top: pct(box.y + box.h), right: 0, bottom: 0, background: 'rgba(27,20,16,0.62)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', left: 0, top: pct(box.y), width: pct(box.x), height: pct(box.h), background: 'rgba(27,20,16,0.62)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', left: pct(box.x + box.w), top: pct(box.y), right: 0, height: pct(box.h), background: 'rgba(27,20,16,0.62)', pointerEvents: 'none' }} />

        {/* Rect itself */}
        <div
          onPointerDown={(e) => { e.stopPropagation(); onPointerDown(e, 'move'); }}
          style={{
            position: 'absolute',
            left: pct(box.x), top: pct(box.y),
            width: pct(box.w), height: pct(box.h),
            border: `3px dashed ${accent}`,
            boxSizing: 'border-box',
            cursor: 'move',
          }}
        >
          {/* Handles */}
          {[
            { k: 'tl', s: { left: -8, top: -8, cursor: 'nwse-resize' } },
            { k: 'tr', s: { right: -8, top: -8, cursor: 'nesw-resize' } },
            { k: 'bl', s: { left: -8, bottom: -8, cursor: 'nesw-resize' } },
            { k: 'br', s: { right: -8, bottom: -8, cursor: 'nwse-resize' } },
          ].map(({ k, s }) => (
            <div
              key={k}
              onPointerDown={(e) => { e.stopPropagation(); onPointerDown(e, k); }}
              style={{
                position: 'absolute',
                width: 13, height: 13,
                background: accent,
                border: '3px solid #1b1410',
                ...s,
              }}
            />
          ))}
        </div>
      </div>
      <div className="sk" style={{ fontSize: 10, color: COLORS.muted }}>
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
    <div style={{ display: 'grid', gap: 22 }}>
      <div style={{ display: 'grid', gap: 10 }}>
        <TLabel htmlFor="vid-url" style={{ marginBottom: 0 }}>LINK → AUDIO / VIDEO</TLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 14, alignItems: 'center', padding: '3px 0 0 3px' }}>
          <TInput
            id="vid-url"
            value={videoUrl}
            onChange={setVideoUrl}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); loadVideoUrl(); } }}
            placeholder="Paste YouTube / TikTok / direct .mp4 · .webm · audio URL"
            style={{ height: 50, fontSize: 14 }}
          />
          <Btn variant="solid" color={accent} disabled={urlBusy || !videoUrl.trim()}
            onClick={() => loadVideoUrl()} style={{ height: 46 }}>
            {urlBusy ? 'Loading…' : 'Load'}
          </Btn>
        </div>
        <div className="mono" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: urlBusy ? COLORS.text : COLORS.muted, lineHeight: 1.5 }}>
          {urlBusy && <span className="blink" style={{ flexShrink: 0, width: 8, height: 8, background: accent }} />}
          {urlBusy
            ? (stage || 'RESOLVING LINK…')
            : 'Direct media links load in-browser. YouTube / TikTok need COBALT_API_URL (optional env).'}
        </div>
      </div>

      <div>
        <TLabel>OR UPLOAD VIDEO</TLabel>
        <label
          onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
          onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setIsDragging(true); }}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setIsDragging(false); }}
          onDrop={handleDrop}
          className={'fa-dropzone' + (isDragging ? ' on' : '')}
          style={{ display: 'block', padding: 28, textAlign: 'center' }}
        >
          <input type="file" accept="video/*,audio/*" onChange={onFile} className="sr" />
          {src ? (
            <div>
              <video ref={videoRef} src={src.url} controls onLoadedMetadata={onMetadata}
                style={{ maxWidth: '100%', maxHeight: 200, background: '#1b1410', border: '3px solid ' + COLORS.ink }} />
              <div className="mono" style={{ fontSize: 11, color: COLORS.muted, marginTop: 8, wordBreak: 'break-all' }}>
                {src.name} · {(src.size / 1024 / 1024).toFixed(2)} MB
                {duration > 0 && ` · ${duration.toFixed(1)}s`}
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', justifyItems: 'center' }}>
              <span className="pxs" style={{ display: 'grid', placeItems: 'center', width: 44, height: 44, marginBottom: 14, background: accent, color: COLORS.onAccent }}>
                <StrokeIcon d={PRESET_ICON.video} size={22} />
              </span>
              <div className="sk" style={{ fontSize: 12, color: COLORS.text }}>
                DROP FILE / LINK · OR CLICK TO BROWSE
              </div>
            </div>
          )}
        </label>
      </div>

      <div>
        <TLabel>EXTRACT AS</TLabel>
        <Seg label="Extract as" value={mode} onChange={setMode}
          options={[{ v: 'gif', l: 'GIF (clip)' }, { v: 'mp3', l: 'MP3 (audio)' }]} size="lg" />
      </div>

      {src && (
        <div style={{ display: 'grid', gap: 18 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '18px 24px' }}>
            <div>
              <TLabel htmlFor="vid-start">START · {startTime.toFixed(1)}s</TLabel>
              <input id="vid-start" type="range" min="0" max={Math.max(0, duration - 0.5)} step="0.1"
                value={startTime} onChange={(e) => setStartTime(+e.target.value)}
                className="fa-range" style={{ '--a': accent }} />
            </div>
            <div>
              <TLabel htmlFor="vid-len">DURATION · {clipLen}s</TLabel>
              <input id="vid-len" type="range" min="1" max={Math.max(1, Math.floor(duration - startTime) || 1)} step="1"
                value={clipLen} onChange={(e) => setClipLen(+e.target.value)}
                className="fa-range" style={{ '--a': accent }} />
            </div>
          </div>

          {mode === 'gif' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '18px 24px' }}>
              <div>
                <TLabel htmlFor="vid-fps">FPS · {fps}</TLabel>
                <input id="vid-fps" type="range" min="5" max="24" step="1"
                  value={fps} onChange={(e) => setFps(+e.target.value)}
                  className="fa-range" style={{ '--a': accent }} />
              </div>
              <div>
                <TLabel htmlFor="vid-w">WIDTH · {width}px</TLabel>
                <input id="vid-w" type="range" min="240" max="960" step="40"
                  value={width} onChange={(e) => setWidth(+e.target.value)}
                  className="fa-range" style={{ '--a': accent }} />
              </div>
            </div>
          ) : (
            <div>
              <TLabel>BITRATE</TLabel>
              <Seg label="Bitrate" value={bitrate} onChange={setBitrate} options={['128k', '192k', '320k']} />
            </div>
          )}
        </div>
      )}

      <TNote>
        File / direct-link conversion runs in your browser via ffmpeg.wasm (~25 MB lib, cached). Platform-link audio uses Cobalt when configured — nothing is stored on our servers.
      </TNote>

      {(busy || urlBusy || progress > 0) && (
        <TProgress stage={stage} progress={progress} accent={accent} />
      )}

      {err && <TError>{err}</TError>}

      {output && (
        <Screen label={output.mode === 'gif' ? 'GIF READY' : 'MP3 READY'}>
          <div style={{ display: 'grid', gap: 14 }}>
            {output.mode === 'gif' ? (
              <img src={output.url} alt="GIF preview" style={{ maxWidth: '100%', justifySelf: 'start', border: '3px solid #fffaf0' }} />
            ) : (
              <audio src={output.url} controls style={{ width: '100%' }} />
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
              <div className="mono" style={{ fontSize: 11, color: '#c9bca6', wordBreak: 'break-all' }}>
                {output.name} · {(output.size / 1024).toFixed(1)} KB
              </div>
              <a href={output.url} download={output.name} className="sk sbtn" style={{
                display: 'inline-flex', alignItems: 'center', gap: 8, height: 38, padding: '0 14px', margin: '3px 7px 8px 3px',
                fontSize: 12, color: '#1b1410', background: accent, textDecoration: 'none', textTransform: 'uppercase',
              }}><StrokeIcon d={ICO.down} size={14} sw={2.8} />Download</a>
            </div>
          </div>
        </Screen>
      )}

      <div style={{ padding: '4px 0 6px 4px' }}>
        <PrimaryBtn accent={accent} disabled={!src || busy || urlBusy} onClick={convert}>
          {busy ? 'Converting…' : 'Convert'} {!busy && <PixelArrow size={12} />}
        </PrimaryBtn>
      </div>
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
  const { lang } = useLang();
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

  // Derived from `status`, and declared up here because effects further down
  // read `active` in their dependency arrays — those are evaluated during
  // render, so a `const` declared lower would still be in its temporal dead
  // zone and throw before the tool could paint.
  const recording = status === 'recording';
  const paused = status === 'paused';
  const active = recording || paused;

  const labels = useMemo(() => (lang === 'vi' ? {
    statusRecording: 'Đang ghi', statusPaused: 'Đã tạm dừng', statusProcessing: 'Đang xử lý',
    statusReady: 'Sẵn sàng', statusBlocked: 'Mic bị chặn', statusNeeded: 'Cần quyền mic',
    permPrompt: 'Công cụ này cần dùng micro của bạn. Nó chỉ hỏi khi bạn bấm "Cho phép micro" — không ghi âm gì cho đến khi bạn bấm ghi.',
    permRequesting: 'Đang chờ bạn cho phép quyền micro…',
    permDenied: 'Micro đang bị chặn. Bật lại trong cài đặt trang của trình duyệt (biểu tượng ổ khóa trên thanh địa chỉ), rồi thử lại.',
    btnAllow: 'Cho phép micro', btnRequesting: 'Đang xin quyền…', btnRetry: 'Thử lại quyền micro',
    btnStart: 'Bắt đầu ghi', btnProcessing: 'Đang xử lý…', btnPause: 'Tạm dừng', btnResume: 'Tiếp tục',
    btnStop: 'Dừng & lưu', btnDiscard: 'Xóa bản ghi', discardTitle: 'Xóa bản ghi này',
    clarityTitle: 'ĐỘ TRONG GIỌNG NÓI',
    cleanLabel: 'Thu âm sạch',
    cleanHint: 'Khử tiếng vọng + lọc tạp âm + tự cân âm lượng, cùng bộ lọc cao tần, tăng dải trung (EQ) và nén động để giọng rõ hơn.',
    normLabel: 'Cân bằng âm lượng',
    normHint: 'Cân âm lượng chuẩn phát thanh (loudnorm −16 LUFS) để đoạn to/nhỏ đều nhau.',
    trimLabel: 'Cắt khoảng lặng',
    trimHint: 'Cắt bỏ khoảng lặng ở đầu và cuối bản ghi.',
    clarityCount: (n) => `${n}/3 đang bật`,
    tapHint: 'BẤM ĐỂ GHI · PHÍM CÁCH',
    btnReRecord: 'Ghi lại',
    bitrateTitle: 'BITRATE MP3',
    footer: 'Mọi thứ chạy ngay trong trình duyệt. Mic được ghi cục bộ rồi chuyển sang MP3 qua ffmpeg.wasm (~25 MB, chỉ tải lần đầu) — không upload lên đâu cả. Cần trang HTTPS (hoặc localhost) và quyền micro.',
    rawTakeBadge: '· bản gốc',
    download: '↓ Tải xuống',
    errNoRecorder: 'Trình duyệt này không hỗ trợ ghi âm (thiếu MediaRecorder / getUserMedia).',
    errNoGetUserMedia: 'Trình duyệt này không thể truy cập micro (thiếu getUserMedia).',
    errPermDeniedStart: 'Quyền truy cập micro bị từ chối. Hãy cho phép micro trong trình duyệt rồi thử lại.',
    errPermBlockedRequest: 'Micro đang bị chặn. Bật lại trong cài đặt trang của trình duyệt (biểu tượng ổ khóa trên thanh địa chỉ), rồi thử lại.',
    errNoMic: 'Không tìm thấy micro. Hãy cắm micro rồi thử lại.',
    errOpenMicFailed: (d) => `Không thể mở micro: ${d}`,
    errAccessMicFailed: (d) => `Không thể truy cập micro: ${d}`,
    errRecorderInit: (d) => `Khởi tạo bộ ghi âm thất bại: ${d}`,
    errEmptyTake: 'Không ghi được gì — bản ghi trống.',
    errMp3NotProduced: (tail) => `Không tạo được MP3. Log gần nhất: ${tail}`,
    errMp3EncodeFailed: (d, ext) => `Chuyển MP3 thất bại (${d}). Đã lưu bản gốc ${ext} thay thế.`,
    stageLoadingFFmpeg: 'Đang tải FFmpeg…', stageLoadingTake: 'Đang tải bản ghi…',
    stageEncoding: 'Đang mã hóa MP3…', stageDone: 'Xong',
  } : {
    statusRecording: 'Recording', statusPaused: 'Paused', statusProcessing: 'Processing',
    statusReady: 'Ready', statusBlocked: 'Mic blocked', statusNeeded: 'Mic access needed',
    permPrompt: 'This tool needs your microphone. It only asks when you tap "Allow microphone" — nothing records until you press record.',
    permRequesting: 'Waiting for you to allow microphone access…',
    permDenied: 'Mic access is blocked. Enable it in your browser\'s site settings (the lock icon in the address bar), then allow again.',
    btnAllow: 'Allow microphone', btnRequesting: 'Requesting…', btnRetry: 'Retry mic access',
    btnStart: 'Start recording', btnProcessing: 'Processing…', btnPause: 'Pause', btnResume: 'Resume',
    btnStop: 'Stop & save', btnDiscard: 'Discard', discardTitle: 'Discard this take',
    clarityTitle: 'VOICE CLARITY',
    cleanLabel: 'Clean capture',
    cleanHint: 'Echo cancel + noise suppression + auto-gain, plus a high-pass, presence EQ and compressor for a clearer voice.',
    normLabel: 'Normalize loudness',
    normHint: 'Broadcast-style leveling (loudnorm −16 LUFS) so quiet & loud parts sit evenly.',
    trimLabel: 'Trim silence',
    trimHint: 'Cut dead air from the start and end of the take.',
    clarityCount: (n) => `${n} of 3 on`,
    tapHint: 'TAP TO RECORD · SPACE',
    btnReRecord: 'Re-record',
    bitrateTitle: 'MP3 BITRATE',
    footer: 'Everything runs in your browser. The mic feed is recorded locally and transcoded to MP3 via ffmpeg.wasm (~25 MB lib, cached on first use) — nothing is uploaded. Recording needs an HTTPS page (or localhost) and mic permission.',
    rawTakeBadge: '· raw take',
    download: '↓ Download',
    errNoRecorder: 'This browser can\'t record audio (no MediaRecorder / getUserMedia).',
    errNoGetUserMedia: 'This browser can\'t access a microphone (no getUserMedia).',
    errPermDeniedStart: 'Microphone permission denied. Allow mic access in your browser, then try again.',
    errPermBlockedRequest: 'Microphone blocked. Enable it in your browser\'s site settings (the lock icon in the address bar), then retry.',
    errNoMic: 'No microphone found. Plug one in and retry.',
    errOpenMicFailed: (d) => `Could not open the mic: ${d}`,
    errAccessMicFailed: (d) => `Could not access the mic: ${d}`,
    errRecorderInit: (d) => `Recorder init failed: ${d}`,
    errEmptyTake: 'Nothing was recorded — the take was empty.',
    errMp3NotProduced: (tail) => `Output MP3 not produced. Last log: ${tail}`,
    errMp3EncodeFailed: (d, ext) => `MP3 encode failed (${d}). Saved the raw ${ext} take instead.`,
    stageLoadingFFmpeg: 'Loading FFmpeg…', stageLoadingTake: 'Loading take…',
    stageEncoding: 'Encoding MP3…', stageDone: 'Done',
  }), [lang]);

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
      setPermErr(labels.errNoGetUserMedia);
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
          ? labels.errPermBlockedRequest
          : name === 'NotFoundError'
            ? labels.errNoMic
            : labels.errAccessMicFailed(e?.message || name || 'unknown error'),
      );
    }
  }

  const METER_BARS = 48;

  // Rounded, evenly-gapped bars centred on the baseline (matches the design's
  // 48-column meter). `color` and `alphaFor` differ per state so an idle meter
  // reads as a faint resting pattern rather than a dead canvas.
  function paintBars(ctx2d, W, H, heightAt, color, alphaFor) {
    ctx2d.clearRect(0, 0, W, H);
    const slot = W / METER_BARS;
    const bw = Math.max(2, Math.min(6, slot - 4));
    ctx2d.fillStyle = color;
    for (let i = 0; i < METER_BARS; i++) {
      const v = heightAt(i);
      // Square bars snapped to a 4px grid — reads as a pixel VU meter.
      const h = Math.max(bw, Math.round((v * H) / 4) * 4);
      const x = Math.round(i * slot + (slot - bw) / 2);
      const y = Math.round((H - h) / 2);
      ctx2d.globalAlpha = alphaFor(v);
      ctx2d.fillRect(x, y, bw, h);
    }
    ctx2d.globalAlpha = 1;
  }

  function drawMeter() {
    rafRef.current = requestAnimationFrame(drawMeter);
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;
    const data = freqRef.current || (freqRef.current = new Uint8Array(analyser.frequencyBinCount));
    analyser.getByteFrequencyData(data);
    const step = Math.max(1, Math.floor(data.length / METER_BARS));
    paintBars(
      canvas.getContext('2d'),
      canvas.width,
      canvas.height,
      (i) => data[i * step] / 255,
      accent,
      (v) => 0.35 + v * 0.65,
    );
  }

  // Resting meter: a low, static ripple so the panel still reads as a meter
  // before the first take (and after one finishes, when the analyser is gone).
  useEffect(() => {
    if (active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Canvas pixels don't follow the light/dark CSS layer, so the resting
    // bars use the (theme-independent) accent rather than a text colour that
    // would vanish on a light panel.
    paintBars(
      canvas.getContext('2d'),
      canvas.width,
      canvas.height,
      (i) => 0.06 + (i % 5) * 0.018,
      accent,
      () => (output ? 0.5 : 0.28),
    );
  }, [active, output, accent]);

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
      setErr(labels.errNoRecorder);
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
          ? labels.errPermDeniedStart
          : name === 'NotFoundError'
            ? labels.errNoMic
            : labels.errOpenMicFailed(e?.message || name || 'unknown error'),
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
      setErr(labels.errRecorderInit(e?.message || e));
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

    if (!chunks.length) { setErr(labels.errEmptyTake); return; }
    const rawMime = (recMime || 'audio/webm').split(';')[0];
    const raw = new Blob(chunks, { type: rawMime });
    await encodeToMp3(raw, rawMime);
  }

  async function encodeToMp3(raw, rawMime) {
    setBusy(true); setErr(''); setProgress(0); setStage(labels.stageLoadingFFmpeg);
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
      setStage(labels.stageLoadingTake);
      await ff.writeFile(inName, await fetchFile(raw));

      const filters = [];
      if (trimSilence) {
        filters.push('silenceremove=start_periods=1:start_silence=0.15:start_threshold=-50dB:detection=peak,areverse,silenceremove=start_periods=1:start_silence=0.25:start_threshold=-50dB:detection=peak,areverse');
      }
      if (normalize) filters.push('loudnorm=I=-16:TP=-1.5:LRA=11');

      const args = ['-i', inName, '-vn', '-ac', '1', '-ar', '44100', '-acodec', 'libmp3lame', '-b:a', bitrate];
      if (filters.length) args.push('-af', filters.join(','));
      args.push('out.mp3');

      setStage(labels.stageEncoding);
      await ff.exec(args);

      let data;
      try { data = await ff.readFile('out.mp3'); }
      catch {
        const tail = logs.slice(-8).join(' | ');
        throw new Error(labels.errMp3NotProduced(tail || '(empty)'));
      }
      const blob = new Blob([data.buffer], { type: 'audio/mpeg' });
      clearOutput();
      setOutput({ url: URL.createObjectURL(blob), name: outFile, size: blob.size });
      setStage(labels.stageDone); setProgress(1);
      try { await ff.deleteFile(inName); } catch {}
      try { await ff.deleteFile('out.mp3'); } catch {}
    } catch (e) {
      console.error('[mic] encode', e, '\n— logs —\n', logs.join('\n'));
      // Fallback: still hand the user the untranscoded take so a recording is never lost.
      const ext = mimeToExt(rawMime);
      clearOutput();
      setOutput({ url: URL.createObjectURL(raw), name: outFile.replace(/\.mp3$/, `.${ext}`), size: raw.size, fallback: true });
      setErr(labels.errMp3EncodeFailed(e?.message || e, ext.toUpperCase()));
      setStage('');
    } finally {
      try { ff?.off?.('log', onLog); } catch {}
      try { ff?.off?.('progress', onProgress); } catch {}
      setBusy(false);
    }
  }

  // Compact take player (the design shows a single round play button, not the
  // browser's default audio chrome), so playback state lives here.
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => { setPlaying(false); }, [output]);

  function togglePlay() {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => {});
    else el.pause();
  }

  // Space starts/stops a take, matching the "TAP TO RECORD · SPACE" hint.
  // Ignored while typing or when the mic hasn't been granted yet.
  useEffect(() => {
    function onKey(e) {
      if (e.code !== 'Space' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target;
      const tag = el?.tagName;
      if (el?.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      // A focused button already treats Space as "click it" — don't double-fire.
      if (tag === 'BUTTON' || tag === 'A') return;
      if (busy) return;
      if (active) { e.preventDefault(); stop(); return; }
      if (micPerm === 'granted') { e.preventDefault(); start(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, busy, micPerm, status]);

  // Full-width row with a pixel switch on the left; rows stack and are
  // divided by a dashed rule rather than sitting in separate cards.
  const Toggle = ({ on, set, label, hint, first }) => (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => set(!on)}
      disabled={active || busy}
      className="mono fa-row-btn"
      style={{
        textAlign: 'left', display: 'flex', alignItems: 'flex-start', gap: 16,
        padding: '13px 6px', width: '100%', background: 'transparent', color: COLORS.text,
        border: 'none', borderTop: first ? 'none' : '3px dashed ' + COLORS.rule,
        cursor: active || busy ? 'not-allowed' : 'pointer',
        opacity: active || busy ? 0.55 : 1,
      }}
    >
      <span className={'fa-switch' + (on ? ' on' : '')} style={{ '--a': accent }}><span /></span>
      <span style={{ display: 'grid', gap: 4, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: COLORS.text }}>{label}</span>
        <span style={{ fontSize: 11, color: COLORS.muted, lineHeight: 1.55 }}>{hint}</span>
      </span>
    </button>
  );

  const onCount = [enhance, normalize, trimSilence].filter(Boolean).length;
  const statusText = recording ? labels.statusRecording
    : paused ? labels.statusPaused
      : busy ? labels.statusProcessing
        : micPerm === 'granted' ? labels.statusReady
          : micPerm === 'denied' ? labels.statusBlocked : labels.statusNeeded;
  const statusDot = recording ? '#ff7a7a'
    : paused ? '#ffd25e'
      : output ? '#7fd18b'
        : micPerm === 'granted' ? '#c9bca6' : '#ff7a7a';
  // Round arcade button (record / stop) — the only round controls here.
  const roundBtn = (size) => ({
    width: size, height: size, background: accent, color: '#1b1410',
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  });

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {/* Recorder stage — a dark screen with the VU meter */}
      <div className="fa-screen" style={{ padding: '18px 20px 20px', display: 'grid', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className={recording ? 'blink' : undefined} style={{ width: 9, height: 9, background: statusDot }} />
            <span className="sk" style={{ fontSize: 11, color: '#c9bca6', textTransform: 'uppercase' }}>
              {statusText}
            </span>
          </div>
          <span className="pf" style={{
            fontSize: 30, lineHeight: 1,
            color: recording ? accent : (active || output) ? '#fffaf0' : '#c9bca6',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {fmtClock(elapsed)}
          </span>
        </div>

        <div className="fa-scan" style={{
          height: 92, display: 'flex', alignItems: 'center', padding: '0 14px', overflow: 'hidden',
          background: '#241b15', boxShadow: 'inset 0 0 0 3px #3a2f27',
        }}>
          <canvas ref={canvasRef} width={600} height={72} style={{ width: '100%', height: 72, display: 'block' }} />
        </div>

        {/* Permission gate — only ask for the mic once the user opts in here. */}
        {!active && !busy && micPerm !== 'granted' && (
          <div style={{ display: 'grid', gap: 14, justifyItems: 'center' }}>
            <p className="mono" style={{
              margin: 0, maxWidth: 460, textAlign: 'center', fontSize: 12, lineHeight: 1.65,
              color: micPerm === 'denied' ? '#ff9a9a' : '#c9bca6',
            }}>
              {micPerm === 'denied'
                ? (permErr || labels.permDenied)
                : micPerm === 'requesting' ? labels.permRequesting : labels.permPrompt}
            </p>
            <PxButton kind="small" fill={accent} disabled={busy || micPerm === 'requesting'} onClick={requestMic}
              style={{ margin: '3px 7px 8px 3px', textTransform: 'uppercase' }}>
              <StrokeIcon d={ICO.mic} size={15} sw={2.6} />
              {micPerm === 'requesting' ? labels.btnRequesting : micPerm === 'denied' ? labels.btnRetry : labels.btnAllow}
            </PxButton>
          </div>
        )}

        {/* Ready — one big target, the way a recorder should read. */}
        {!active && !busy && micPerm === 'granted' && (
          <div style={{ display: 'grid', gap: 12, justifyItems: 'center' }}>
            <button type="button" onClick={start} title={labels.btnStart} aria-label={labels.btnStart} className="abtn round" style={roundBtn(66)}>
              <span className="round" style={{ width: 22, height: 22, background: '#1b1410', display: 'block' }} />
            </button>
            <span className="sk" style={{ fontSize: 10, color: '#c9bca6' }}>{labels.tapHint}</span>
          </div>
        )}

        {active && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 18, flexWrap: 'wrap' }}>
            {recording
              ? <Btn variant="ghost" onClick={pause}><StrokeIcon d={ICO.pause} size={12} sw={0} style={{ fill: 'currentColor', marginRight: 6, verticalAlign: '-1px' }} />{labels.btnPause}</Btn>
              : <Btn variant="ghost" onClick={resume}><StrokeIcon d={ICO.play} size={12} sw={0} style={{ fill: 'currentColor', marginRight: 6, verticalAlign: '-1px' }} />{labels.btnResume}</Btn>}
            <button type="button" onClick={stop} title={labels.btnStop} aria-label={labels.btnStop} className="abtn round" style={roundBtn(58)}>
              <span style={{ width: 18, height: 18, background: '#1b1410', display: 'block' }} />
            </button>
            <Btn variant="ghost" onClick={cancel} title={labels.discardTitle}><StrokeIcon d={ICO.x} size={11} sw={3.4} style={{ marginRight: 6, verticalAlign: '-1px' }} />{labels.btnDiscard}</Btn>
          </div>
        )}

        {/* Finished take — compact row, then the two things you'd do next. */}
        {output && !active && !busy && (
          <div style={{ display: 'grid', gap: 12 }}>
            <audio
              ref={audioRef}
              src={output.url}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              style={{ display: 'none' }}
            />
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
              background: '#2e251d', padding: '10px 12px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                <button
                  type="button"
                  onClick={togglePlay}
                  aria-label={playing ? labels.btnPause : labels.btnResume}
                  style={{
                    width: 34, height: 34, flex: 'none', border: 'none', cursor: 'pointer',
                    background: accent, color: '#1b1410', boxShadow: '0 0 0 3px #fffaf0',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <StrokeIcon d={playing ? ICO.pause : ICO.play} size={13} sw={0} style={{ fill: 'currentColor' }} />
                </button>
                <span className="mono" style={{
                  fontSize: 11, lineHeight: 1.3, color: '#fffaf0',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {output.name} · {bitrate} · {(output.size / 1024).toFixed(1)} KB
                  {output.fallback && <span style={{ color: '#ffd25e' }}> {labels.rawTakeBadge}</span>}
                </span>
              </div>
              <span className="sk" style={{ fontSize: 10, color: '#c9bca6', whiteSpace: 'nowrap' }}>{fmtClock(elapsed)}</span>
            </div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
              <a href={output.url} download={output.name} className="sk sbtn" style={{
                flex: 1, minWidth: 170, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                height: 42, margin: '3px 7px 8px 3px', fontSize: 12, color: '#1b1410', background: accent,
                textDecoration: 'none', textTransform: 'uppercase',
              }}>{labels.download}</a>
              <Btn variant="ghost" onClick={start}>
                <span className="round" style={{ display: 'inline-block', width: 9, height: 9, marginRight: 8, background: '#e04545' }} />{labels.btnReRecord}
              </Btn>
            </div>
          </div>
        )}
      </div>

      {/* Clarity options + bitrate */}
      <div className="pxs" style={{ margin: 3, padding: '16px 18px', background: COLORS.paper, display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span className="sk" style={{ fontSize: 11, color: COLORS.muted }}>{labels.clarityTitle}</span>
          <span className="sk" style={{ fontSize: 10, padding: '3px 7px', color: COLORS.onAccent, background: accent }}>{labels.clarityCount(onCount)}</span>
        </div>

        <div style={{ display: 'grid' }}>
          <Toggle first on={enhance} set={setEnhance} label={labels.cleanLabel} hint={labels.cleanHint} />
          <Toggle on={normalize} set={setNormalize} label={labels.normLabel} hint={labels.normHint} />
          <Toggle on={trimSilence} set={setTrimSilence} label={labels.trimLabel} hint={labels.trimHint} />
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
          paddingTop: 12, borderTop: '3px dashed ' + COLORS.rule,
        }}>
          <span className="sk" style={{ fontSize: 11, color: COLORS.muted }}>{labels.bitrateTitle}</span>
          <Seg label={labels.bitrateTitle} value={bitrate} onChange={setBitrate} disabled={active || busy}
            options={['128k', '192k', '320k'].map((b) => ({ v: b, l: b.toUpperCase() }))} />
        </div>
      </div>

      <p className="mono" style={{ margin: 0, padding: '0 4px', fontSize: 11, lineHeight: 1.7, color: COLORS.muted }}>
        {labels.footer}
      </p>

      {(busy || progress > 0) && (
        <TProgress stage={stage} progress={progress} accent={accent} />
      )}

      {err && <TError>{err}</TError>}
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

  const rowBtn = { width: 38, height: 36, padding: 0, display: 'inline-grid', placeItems: 'center' };

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {/* ─ Totals ─ */}
      {totalsByCcy.length > 0 && (
        <Screen label="NET WORTH · BY CURRENCY" live={false}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 26px', alignItems: 'baseline' }}>
            {totalsByCcy.map(([ccy, val], i) => (
              <div key={ccy} style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                {i === 0 && <PixelCoin size={18} spin />}
                <span className="pf" style={{ fontSize: i === 0 ? 34 : 22, lineHeight: 1, color: i === 0 ? '#ffd25e' : '#fffaf0' }}>{formatVal(val, ccy)}</span>
                <span className="sk" style={{ fontSize: 11, color: '#c9bca6' }}>{ccy}</span>
              </div>
            ))}
          </div>
        </Screen>
      )}

      {/* ─ Account list ─ */}
      <div className="pxs" style={{ margin: 3, background: COLORS.paper }}>
        <div className="sk" style={{
          display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 14px',
          fontSize: 10, color: COLORS.muted, borderBottom: '3px solid ' + COLORS.ink,
        }}>
          <span>ACCOUNT</span><span>VALUE · CCY</span>
        </div>
        {accounts.length === 0 && !adding && (
          <EmptyState title="NO ACCOUNTS YET" hint="Add cash, crypto, stocks, or any holding you want to track." style={{ padding: '28px 16px' }} />
        )}
        {accounts.map((a, i) => {
          const isEditing = editingId === a.id;
          const sep = i < accounts.length - 1 ? '3px dashed ' + COLORS.rule : 'none';
          if (isEditing) {
            return (
              <div key={a.id} style={{
                padding: '12px 12px 6px', background: withAlpha(accent, 0.18), borderBottom: sep,
                display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr) 84px auto', gap: 12, alignItems: 'center',
              }}>
                <TInput value={editDraft.name} onChange={(v) => setEditDraft({ ...editDraft, name: v })} placeholder="Name" ariaLabel="Name" style={{ height: 40, fontSize: 13 }} />
                <TInput value={editDraft.value} onChange={(v) => setEditDraft({ ...editDraft, value: v })} placeholder="0" ariaLabel="Value" style={{ height: 40, fontSize: 13 }} />
                <TInput value={editDraft.ccy} onChange={(v) => setEditDraft({ ...editDraft, ccy: v.toUpperCase() })} placeholder="USD" ariaLabel="Currency" style={{ height: 40, fontSize: 13 }} />
                <div style={{ display: 'flex', gap: 4 }}>
                  <Btn variant="solid" color={accent} onClick={saveEdit}>Save</Btn>
                  <Btn variant="ghost" onClick={() => { setEditingId(null); setEditDraft(null); }} title="Cancel" style={rowBtn}>
                    <StrokeIcon d={ICO.x} size={12} sw={3.2} /><span className="sr">Cancel</span>
                  </Btn>
                </div>
              </div>
            );
          }
          return (
            <div key={a.id} style={{
              padding: '8px 10px 8px 14px', borderBottom: sep,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
            }}>
              <div className="mono" style={{ fontSize: 13, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {a.name}
              </div>
              <div className="mono" style={{ fontSize: 14, fontWeight: 700, color: COLORS.text, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {formatVal(a.value, a.ccy)}
                <span className="sk" style={{ fontSize: 10, color: COLORS.muted, marginLeft: 6 }}>{a.ccy}</span>
              </div>
              <div style={{ display: 'flex', gap: 2 }}>
                <Btn variant="ghost" onClick={() => startEdit(a)} title="Edit" style={rowBtn}>
                  <StrokeIcon d={ICO.edit} size={14} sw={2.6} /><span className="sr">Edit</span>
                </Btn>
                <Btn variant="ghost" onClick={() => deleteAccount(a.id)} title="Delete" style={rowBtn}>
                  <StrokeIcon d={ICO.x} size={12} sw={3.2} /><span className="sr">Delete</span>
                </Btn>
              </div>
            </div>
          );
        })}
      </div>

      {/* ─ Add form ─ */}
      {adding ? (
        <div className="pxs" style={{ margin: 3, padding: '16px 16px 12px', background: COLORS.field, display: 'grid', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr) 90px', gap: 14 }}>
            <div>
              <TLabel htmlFor="fin-name">NAME</TLabel>
              <TInput id="fin-name" value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} placeholder="Cash · USD" style={{ height: 42, fontSize: 13 }} />
            </div>
            <div>
              <TLabel htmlFor="fin-val">VALUE</TLabel>
              <TInput id="fin-val" value={draft.value} onChange={(v) => setDraft({ ...draft, value: v })} placeholder="0" style={{ height: 42, fontSize: 13 }} />
            </div>
            <div>
              <TLabel htmlFor="fin-ccy">CCY</TLabel>
              <TInput id="fin-ccy" value={draft.ccy} onChange={(v) => setDraft({ ...draft, ccy: v.toUpperCase() })} placeholder="USD" style={{ height: 42, fontSize: 13 }} />
            </div>
          </div>
          <div role="group" aria-label="Currency suggestions" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, padding: 3 }}>
            {CCY_SUGGESTIONS.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={draft.ccy === c}
                onClick={() => setDraft({ ...draft, ccy: c })}
                className={'chip-px sk' + (draft.ccy === c ? ' on' : '')}
                style={{ height: 30, padding: '0 9px', fontSize: 10 }}
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
        <div>
          <Btn variant="solid" color={accent} onClick={() => setAdding(true)}>
            <StrokeIcon d={ICO.plus} size={12} sw={3.2} style={{ marginRight: 8, verticalAlign: '-1px' }} />Add account
          </Btn>
        </div>
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
  // File-type pixel icons (stroke paths on the accent tile).
  function iconFor(f) {
    if (f.isFolder) return 'M3 6h7l2 2h9v11H3z';
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    if (['zip', '7z', 'rar', 'tar', 'gz'].includes(ext)) return 'M5 3h14v18H5zM11 3v2h2v2h-2v2h2v2h-2v3h2v3h-2z';
    if (['exe', 'msi', 'dmg', 'pkg'].includes(ext)) return 'M3 4h18v14H3zM3 8h18M10 11v5l4-2.5z';
    if (['iso', 'img'].includes(ext)) return 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 10a2 2 0 1 0 0 4a2 2 0 1 0 0-4';
    if (['txt', 'md', 'pdf', 'doc', 'docx'].includes(ext)) return 'M6 3h9l4 4v14H6zM15 3v4h4M9 12h7M9 16h7';
    if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return PRESET_ICON.image;
    if (['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext)) return PRESET_ICON.video;
    return 'M6 3h9l4 4v14H6zM15 3v4h4';
  }

  if (loading) {
    return (
      <div style={{ padding: 40, display: 'grid', justifyItems: 'center', gap: 14, color: COLORS.muted }}>
        <span className="dots-step" aria-hidden="true" style={{ color: COLORS.text, display: 'inline-flex' }}><i /><i /><i /></span>
        <span className="sk" style={{ fontSize: 11 }}>LOADING DRIVE…</span>
      </div>
    );
  }

  if (err) {
    const isSetup = err.includes('not configured');
    return (
      <Screen label={isSetup ? 'SETUP REQUIRED' : 'ERROR'} dot="#ff7a7a" live={false}>
        <div className="mono" style={{ marginBottom: isSetup ? 14 : 0, fontSize: 13, lineHeight: 1.6, color: '#fffaf0' }}>{err}</div>
        {isSetup && (
          <ol className="mono" style={{ paddingLeft: 20, margin: 0, fontSize: 12, lineHeight: 1.7, color: '#c9bca6' }}>
            <li>Create a Google Drive folder, share "Anyone with link" → Viewer.</li>
            <li>Grab the folder ID from the URL (the part after <code style={{ color: '#7fd18b' }}>/folders/</code>).</li>
            <li>Google Cloud Console → enable Drive API → Create an API Key.</li>
            <li>In Vercel → Project → Settings → Environment Variables, add:
              <pre style={{ background: '#2e251d', padding: 10, marginTop: 6, fontSize: 11, color: '#7fd18b', overflowX: 'auto' }}>
{`GDRIVE_API_KEY=AIza…
GDRIVE_FOLDER_ID=1abcXYZ…`}
              </pre>
            </li>
            <li>Redeploy.</li>
          </ol>
        )}
      </Screen>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200, position: 'relative', padding: 3 }}>
          <label htmlFor="gr-search" className="sr">Search files</label>
          <StrokeIcon d={ICO.search} size={16} sw={2.6} color={COLORS.muted} style={{ position: 'absolute', left: 15, top: 18, pointerEvents: 'none' }} />
          <TInput id="gr-search" value={search} onChange={setSearch} placeholder="Search files…" style={{ paddingLeft: 40 }} />
        </div>
        <span className="sk" style={{ fontSize: 11, color: COLORS.muted }}>
          {filtered.length}/{files.length} FILES
        </span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={files.length === 0 ? 'FOLDER EMPTY' : 'NO MATCHES'}
          hint={files.length === 0
            ? 'Upload files to your Drive folder, then refresh.'
            : 'Try a different search term.'}
        />
      ) : (
        <div className="pxs" style={{ margin: 3, background: COLORS.paper }}>
          {filtered.map((f, i) => (
            <div key={f.id} style={{
              padding: '10px 12px', borderBottom: i < filtered.length - 1 ? '3px dashed ' + COLORS.rule : 'none',
              display: 'grid', gridTemplateColumns: '40px minmax(0, 1fr) auto auto', gap: 12, alignItems: 'center',
            }}>
              <span className="pxs" style={{
                width: 34, height: 34, display: 'grid', placeItems: 'center', margin: 3,
                background: accent, color: COLORS.onAccent,
              }}><StrokeIcon d={iconFor(f)} size={18} sw={2.4} /></span>
              <div style={{ minWidth: 0 }}>
                <div className="mono" style={{
                  fontSize: 13, fontWeight: 700, overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{f.name}</div>
                <div className="mono" style={{ fontSize: 11, color: COLORS.muted, marginTop: 3 }}>
                  {formatSize(f.size)} · {formatDate(f.modifiedAt)}
                </div>
              </div>
              <a
                href={f.viewUrl}
                target="_blank"
                rel="noreferrer"
                className="sk sbtn"
                style={{
                  display: 'inline-flex', alignItems: 'center', height: 32, padding: '0 10px', margin: '3px 7px 8px 3px',
                  fontSize: 10, color: COLORS.text, background: COLORS.paper, textDecoration: 'none',
                }}
              >VIEW</a>
              {!f.isFolder ? (
                <a
                  href={f.downloadUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="sk sbtn"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 10px', margin: '3px 7px 8px 3px',
                    fontSize: 10, color: COLORS.onAccent, background: accent, textDecoration: 'none',
                  }}
                ><StrokeIcon d={ICO.down} size={12} sw={2.8} />DL</a>
              ) : <span />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PlaceholderTool({ tool, name, desc, accent }) {
  return (
    <Screen label="CARTRIDGE LOADED" live={false} style={{ padding: '20px 22px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <span className="pxs" style={{
          display: 'grid', placeItems: 'center', width: 52, height: 52, flexShrink: 0,
          background: accent, color: COLORS.onAccent, boxShadow: '0 0 0 3px #fffaf0',
        }}><ToolIcon id={tool.id} size={28} /></span>
        <p className={'pf' + (hasVi(name) ? ' fa-vi' : '')} style={{ margin: 0, fontSize: 28, lineHeight: 1.05, color: accent }}>{name || tool.name}</p>
      </div>
      <p className="mono" style={{ margin: '14px 0 0', fontSize: 13, lineHeight: 1.55, color: '#c9bca6' }}>
        {desc || tool.desc}. Module wired to private API — interactive in production build.
      </p>
      <p className="sk" style={{ margin: '18px 0 0', fontSize: 13, color: '#fffaf0' }}>
        READY<span className="blink" style={{ color: '#7fd18b' }}>_</span>
      </p>
    </Screen>
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
    accent: '#b9a2ff',
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
    accent: '#ff7a7a',
    glyph: '◆',
    tagline: 'Anime Fantasy Ludo',
    desc: 'Bàn cờ 3D phong cách anime, 4 tộc, AI đối thủ, 6 chủ đề. Chơi ngay trên web.',
    chips: ['3D BOARD', 'VS AI', '6 THEMES'],
    href: '/games/ludo/',
    external: true,
  },
  {
    id: 'project-k',
    label: 'Project K',
    accent: '#ffd25e',
    glyph: '♜',
    tagline: 'Game design · Unity',
    desc: 'Action RPG kiểu Souls/Sekiro, hệ đồ kiểu Path of Exile 2. Tải bản thử nghiệm cho Windows, xem đoạn mở đầu, ảnh trong game và tài liệu thiết kế.',
    chips: ['TẢI GAME', 'GDD', 'CHANGELOG'],
    href: '/games/project-k/',
    external: true,
  },
  {
    id: 'cultivation',
    label: 'Ngự Kiếm',
    accent: '#9fd8ff',
    glyph: '⚔',
    tagline: 'Flying Swords · webcam',
    desc: '13 cử chỉ tay điều khiển đàn kiếm bay. Nhận diện tay chạy hoàn toàn trong trình duyệt — video không rời khỏi máy bạn.',
    chips: ['3D', 'WEBCAM', '13 CỬ CHỈ'],
    href: '/games/cultivation/',
    external: true,
  },
];

// Presentation extras per venue: cartridge status + genre plate + icon.
// Project K ships as a Windows test build, hence PLAYTEST.
const GAME_META = {
  tavern:        { status: 'LIVE',     genre: 'RP',      icon: 'M5 7h11v14H5zM16 10h3v7h-3M8.5 11v6M12.5 11v6M5 4h11' },
  ludo:          { status: 'LIVE',     genre: 'BOARD',   icon: 'M4 4h16v16H4z' },
  'project-k':   { status: 'PLAYTEST', genre: 'ARPG',    icon: 'M20 4L9 15M20 4h-4M20 4v4M6 12l6 6M8.5 15.5L4 20' },
  cultivation:   { status: 'LIVE',     genre: 'GESTURE', icon: 'M8 13V5h2.5v7M10.5 11V3.5H13V11M13 11.5V5h2.5v7.5M15.5 12.5V8H18v6.5c0 4-2.6 6.5-6 6.5-3 0-4.6-1.6-6-4.2L4 13.5l1.8-1 2.2 2.5' },
};

function GameIcon({ id, size = 36 }) {
  const meta = GAME_META[id] || GAME_META.tavern;
  return (
    <StrokeIcon d={meta.icon} size={size}>
      {id === 'ludo' && (
        <g fill="currentColor" stroke="none">
          <rect x="7.5" y="7.5" width="2" height="2" /><rect x="14.5" y="7.5" width="2" height="2" />
          <rect x="11" y="11" width="2" height="2" />
          <rect x="7.5" y="14.5" width="2" height="2" /><rect x="14.5" y="14.5" width="2" height="2" />
        </g>
      )}
    </StrokeIcon>
  );
}

// Pixel scenes for the cabinet screen — one per venue (static rects; only
// a few cells blink).
function GameScene({ id }) {
  return (
    <svg width="100%" height="100%" viewBox="0 0 40 24" preserveAspectRatio="xMidYMid meet" shapeRendering="crispEdges" aria-hidden="true">
      {id === 'tavern' && (<>
        <rect x="3" y="2" width="1" height="1" fill="#fffaf0" /><rect className="blink" x="13" y="4" width="1" height="1" fill="#fffaf0" /><rect x="20" y="1" width="1" height="1" fill="#9fd8ff" /><rect className="blink" x="38" y="3" width="1" height="1" fill="#fffaf0" style={{ animationDelay: '0.5s' }} />
        <path d="M34 1h2v1h1v2h-1v1h-2V4h1V2h-1z" fill="#ffd25e" />
        <rect x="0" y="20" width="40" height="4" fill="#2f7a3d" /><rect x="0" y="20" width="40" height="1" fill="#5bbf6a" />
        <rect x="8" y="6" width="12" height="1" fill="#8e4a22" /><rect x="7" y="7" width="14" height="1" fill="#8e4a22" /><rect x="6" y="8" width="16" height="1" fill="#8e4a22" /><rect x="5" y="9" width="18" height="1" fill="#8e4a22" />
        <rect x="6" y="10" width="16" height="10" fill="#c9733e" />
        <rect x="12" y="14" width="4" height="6" fill="#1b1410" />
        <rect x="8" y="12" width="3" height="3" fill="#ffd25e" /><rect x="17" y="12" width="3" height="3" fill="#ffd25e" />
        <rect x="22" y="11" width="3" height="1" fill="#1b1410" /><rect x="23" y="12" width="2" height="3" fill="#fffaf0" />
        <rect x="25" y="4" width="12" height="6" fill="#fffaf0" /><rect x="26" y="10" width="2" height="1" fill="#fffaf0" /><rect x="26" y="11" width="1" height="1" fill="#fffaf0" />
        <rect className="blink" x="28" y="6" width="2" height="2" fill="#1b1410" /><rect className="blink" x="31" y="6" width="2" height="2" fill="#1b1410" style={{ animationDelay: '0.33s' }} /><rect className="blink" x="34" y="6" width="2" height="2" fill="#1b1410" style={{ animationDelay: '0.66s' }} />
        <rect x="29" y="14" width="2" height="2" fill="#ffd2a8" /><rect x="28" y="16" width="4" height="3" fill="#b9a2ff" /><rect x="28" y="19" width="1" height="1" fill="#1b1410" /><rect x="31" y="19" width="1" height="1" fill="#1b1410" />
      </>)}
      {id === 'ludo' && (<>
        <rect x="8" y="0" width="24" height="24" fill="#fffaf0" />
        <rect x="9" y="1" width="8" height="8" fill="#ff7a7a" /><rect x="23" y="1" width="8" height="8" fill="#7fd18b" /><rect x="9" y="15" width="8" height="8" fill="#9fd8ff" /><rect x="23" y="15" width="8" height="8" fill="#ffd25e" />
        <rect x="11" y="3" width="4" height="4" fill="#fffaf0" /><rect x="25" y="3" width="4" height="4" fill="#fffaf0" /><rect x="11" y="17" width="4" height="4" fill="#fffaf0" /><rect x="25" y="17" width="4" height="4" fill="#fffaf0" />
        <rect x="18" y="1" width="4" height="22" fill="#f3eee4" /><rect x="9" y="10" width="22" height="4" fill="#f3eee4" />
        <path d="M18 1v22M20 1v22M22 1v22M9 10h22M9 12h22M9 14h22" stroke="#d8cdb9" strokeWidth="0.3" fill="none" />
        <rect x="18" y="10" width="4" height="4" fill="#b9a2ff" />
        <rect x="19" y="4" width="2" height="2" fill="#e04545" stroke="#1b1410" strokeWidth="0.3" /><rect x="25" y="11" width="2" height="2" fill="#2f7a3d" stroke="#1b1410" strokeWidth="0.3" /><rect x="12" y="11" width="2" height="2" fill="#7aa8ff" stroke="#1b1410" strokeWidth="0.3" /><rect x="19" y="18" width="2" height="2" fill="#c98a12" stroke="#1b1410" strokeWidth="0.3" />
        <rect x="12" y="4" width="2" height="2" fill="#e04545" /><rect x="26" y="4" width="2" height="2" fill="#2f7a3d" /><rect x="12" y="18" width="2" height="2" fill="#7aa8ff" /><rect x="26" y="18" width="2" height="2" fill="#c98a12" />
        <rect x="33" y="15" width="6" height="6" fill="#fffaf0" stroke="#1b1410" strokeWidth="0.4" />
        <rect x="34" y="16" width="1" height="1" fill="#1b1410" /><rect x="37" y="16" width="1" height="1" fill="#1b1410" /><rect x="34" y="19" width="1" height="1" fill="#1b1410" /><rect x="37" y="19" width="1" height="1" fill="#1b1410" />
        <rect className="blink" x="2" y="4" width="1" height="1" fill="#ffd25e" /><rect className="blink" x="4" y="9" width="1" height="1" fill="#ff7a7a" style={{ animationDelay: '0.5s' }} /><rect x="35" y="5" width="1" height="1" fill="#9fd8ff" />
      </>)}
      {id === 'project-k' && (<>
        <rect x="3" y="2" width="3" height="3" fill="#e04545" />
        <rect x="36" y="4" width="1" height="1" fill="#c9bca6" /><rect x="31" y="1" width="1" height="1" fill="#c9bca6" />
        <rect x="0" y="21" width="40" height="3" fill="#5c5046" /><rect x="0" y="21" width="40" height="1" fill="#8e4a22" />
        <rect x="18" y="9" width="4" height="12" fill="#8e4a22" /><rect x="16" y="19" width="2" height="2" fill="#8e4a22" /><rect x="22" y="19" width="2" height="2" fill="#8e4a22" />
        <rect x="14" y="2" width="12" height="2" fill="#2f7a3d" /><rect x="12" y="4" width="16" height="3" fill="#2f7a3d" /><rect x="10" y="6" width="20" height="3" fill="#2f7a3d" /><rect x="13" y="9" width="5" height="1" fill="#2f7a3d" /><rect x="22" y="9" width="5" height="1" fill="#2f7a3d" />
        <rect className="blink" x="13" y="1" width="2" height="2" fill="#e04545" /><rect x="17" y="0" width="2" height="2" fill="#ffa764" /><rect className="blink" x="22" y="1" width="2" height="2" fill="#e04545" style={{ animationDelay: '0.5s' }} /><rect x="26" y="3" width="2" height="2" fill="#ffd25e" /><rect className="blink" x="10" y="4" width="2" height="2" fill="#ffa764" style={{ animationDelay: '0.25s' }} /><rect x="28" y="6" width="2" height="2" fill="#e04545" /><rect x="20" y="1" width="1" height="1" fill="#ffd25e" />
        <rect x="32" y="12" width="1" height="9" fill="#c9bca6" /><rect x="30" y="11" width="5" height="1" fill="#ffd25e" /><rect x="32" y="8" width="1" height="3" fill="#8e4a22" /><rect x="32" y="7" width="1" height="1" fill="#ffd25e" />
        <rect x="6" y="15" width="2" height="2" fill="#ffd2a8" /><rect x="5" y="17" width="4" height="3" fill="#7aa8ff" /><rect x="5" y="20" width="1" height="1" fill="#1b1410" /><rect x="8" y="20" width="1" height="1" fill="#1b1410" /><rect x="9" y="16" width="1" height="4" fill="#c9bca6" />
      </>)}
      {id === 'cultivation' && (<>
        <rect x="2" y="2" width="1" height="1" fill="#fffaf0" /><rect className="blink" x="9" y="5" width="1" height="1" fill="#9fd8ff" /><rect x="26" y="2" width="1" height="1" fill="#fffaf0" /><rect className="blink" x="37" y="8" width="1" height="1" fill="#fffaf0" style={{ animationDelay: '0.5s' }} /><rect x="34" y="20" width="1" height="1" fill="#9fd8ff" />
        <rect x="10" y="4" width="3" height="1" fill="#7aa8ff" /><rect x="14" y="4" width="2" height="1" fill="#8e4a22" /><rect x="16" y="3" width="1" height="3" fill="#ffd25e" /><rect x="17" y="4" width="6" height="1" fill="#fffaf0" />
        <rect x="18" y="8" width="3" height="1" fill="#7aa8ff" /><rect x="22" y="8" width="2" height="1" fill="#8e4a22" /><rect x="24" y="7" width="1" height="3" fill="#ffd25e" /><rect x="25" y="8" width="6" height="1" fill="#fffaf0" />
        <rect x="12" y="11" width="3" height="1" fill="#7aa8ff" /><rect x="16" y="11" width="2" height="1" fill="#8e4a22" /><rect x="18" y="10" width="1" height="3" fill="#ffd25e" /><rect x="19" y="11" width="6" height="1" fill="#fffaf0" />
        <rect x="21" y="14" width="3" height="1" fill="#7aa8ff" /><rect x="25" y="14" width="2" height="1" fill="#8e4a22" /><rect x="27" y="13" width="1" height="3" fill="#ffd25e" /><rect x="28" y="14" width="6" height="1" fill="#fffaf0" />
        <rect x="15" y="17" width="3" height="1" fill="#7aa8ff" /><rect x="19" y="17" width="2" height="1" fill="#8e4a22" /><rect x="21" y="16" width="1" height="3" fill="#ffd25e" /><rect x="22" y="17" width="6" height="1" fill="#fffaf0" />
        <rect x="3" y="13" width="1" height="4" fill="#ffd2a8" /><rect x="5" y="12" width="1" height="5" fill="#ffd2a8" /><rect x="7" y="13" width="1" height="4" fill="#ffd2a8" /><rect x="2" y="17" width="7" height="5" fill="#ffd2a8" /><rect x="9" y="16" width="1" height="3" fill="#ffd2a8" />
      </>)}
    </svg>
  );
}

function readGameSubRoute() {
  if (typeof window === 'undefined') return null;
  const segs = window.location.hash.replace(/^#\//, '').split('/').filter(Boolean);
  // #/game/<sub>
  return segs[0] === 'game' && segs[1] ? segs[1] : null;
}

export function GamePanel() {
  const [sub, setSub] = useState(readGameSubRoute);
  // Arcade floor: a featured cabinet + info card, then one cartridge per
  // venue. Stacks to a single column on phones.
  const isMobile = useMediaQuery('(max-width: 768px)');
  // Which venue the cabinet shows (presentation only).
  const [featured, setFeatured] = useState(0);

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

  // Same link behaviour as before: #/game/<id>, external venues load in-tab.
  const onPlay = (t) => (e) => {
    if (t.external) {
      e.preventDefault();
      window.location.href = t.href;
    }
  };

  const total = GAME_TILES.length;
  const num = (i) => String(i + 1).padStart(2, '0');
  const cur = GAME_TILES[featured] || GAME_TILES[0];
  const curMeta = GAME_META[cur.id] || {};
  const curVi = hasVi(cur.label);

  return (
    <div style={{
      height: '100%', overflowY: 'auto', overflowX: 'hidden', boxSizing: 'border-box',
      padding: isMobile ? '6px 6px 30px 3px' : '8px 18px 40px 6px',
    }}>
      {/* ── 1 · Arcade floor (featured venue) ── */}
      <section aria-labelledby="floor-h">
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, marginBottom: isMobile ? 26 : 34 }}>
          <div>
            <p className="sk" style={{ margin: '0 0 10px', fontSize: isMobile ? 11 : 13, color: COLORS.muted }}>ARCADE FLOOR · NOW SHOWING</p>
            <h2 id="floor-h" className="pf fa-sec-h" style={{ margin: 0, fontSize: 40, lineHeight: 1 }}>
              Pick a venue<span style={{ color: '#e04545' }}>.</span>
            </h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '0 8px 8px 0' }}>
            <button type="button" className="sk sbtn" onClick={() => setFeatured((featured - 1 + total) % total)} aria-label="Previous venue" style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, height: 40, padding: '0 14px', fontSize: 12, color: COLORS.text, background: COLORS.paper,
            }}><PixelArrow dir="left" size={10} />PREV</button>
            <span className="sk" style={{ fontSize: 13 }}>{num(featured)} / {num(total - 1)}</span>
            <button type="button" className="sk sbtn" onClick={() => setFeatured((featured + 1) % total)} aria-label="Next venue" style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, height: 40, padding: '0 14px', fontSize: 12, color: COLORS.text, background: COLORS.paper,
            }}>NEXT<PixelArrow size={10} /></button>
          </div>
        </div>

        <div className="fa-hero">
          {/* Cabinet */}
          <div className="px" style={{ position: 'relative', display: 'flex', flexDirection: 'column', padding: isMobile ? '14px 14px 0' : '18px 18px 0', background: cur.accent }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '14px 16px',
              background: '#fffaf0', color: '#1b1410', border: '3px solid #1b1410',
            }}>
              <span aria-hidden="true" style={{ display: 'flex', gap: 6 }}>
                <span className="blink" style={{ width: 8, height: 8, background: '#e04545' }} />
                <span className="blink" style={{ width: 8, height: 8, background: '#ffd25e', animationDelay: '0.5s' }} />
              </span>
              <span className={'pf fa-cab-h' + (curVi ? ' fa-vi' : '')} style={{ fontSize: 30, lineHeight: 1, textAlign: 'center' }}>{cur.label}</span>
              <span aria-hidden="true" style={{ display: 'flex', gap: 6 }}>
                <span className="blink" style={{ width: 8, height: 8, background: '#ffd25e', animationDelay: '0.5s' }} />
                <span className="blink" style={{ width: 8, height: 8, background: '#e04545' }} />
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, marginTop: 16, padding: 14, background: '#1b1410' }}>
              <div className="fa-scan fa-scr" role="img" aria-label={`${cur.label} — attract screen`} style={{
                position: 'relative', flex: 1, minHeight: 300, overflow: 'hidden', backgroundColor: '#241b15',
              }}>
                <div className="sk" style={{
                  position: 'absolute', left: 14, right: 14, top: 12, zIndex: 1, display: 'flex', justifyContent: 'space-between',
                  fontSize: 12, color: '#fffaf0',
                }}><span>1UP · P1</span><span style={{ color: '#ffd25e' }}>{curMeta.status} · {num(featured)}</span></div>
                <div aria-hidden="true" style={{ position: 'absolute', left: 18, right: 18, top: 40, bottom: 44 }}>
                  <GameScene id={cur.id} />
                </div>
                <p className="sk blink" style={{ position: 'absolute', left: 0, right: 0, bottom: 14, margin: 0, textAlign: 'center', fontSize: 14, color: '#ffd25e' }}>PRESS START</p>
              </div>
            </div>

            <div aria-hidden="true" style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
              margin: isMobile ? '0 -14px' : '0 -18px', padding: '14px 24px',
              backgroundImage: 'linear-gradient(rgba(27, 20, 16, 0.14), rgba(27, 20, 16, 0.14))', borderTop: '4px solid #1b1410',
            }}>
              <svg width="36" height="44" viewBox="0 0 10 12" shapeRendering="crispEdges"><path d="M3 0h4v1h1v3H7v1H3V4H2V1h1z" fill="#e04545" stroke="#1b1410" strokeWidth="0.4" /><rect x="4" y="5" width="2" height="4" fill="#1b1410" /><rect x="1" y="9" width="8" height="3" fill="#1b1410" /></svg>
              <span style={{ display: 'flex', gap: 14 }}>
                {['#e04545', '#ffd25e', '#9fd8ff'].map((c) => (
                  <span key={c} className="round" style={{ width: 28, height: 28, background: c, border: '3px solid #1b1410', boxShadow: '0 4px 0 #1b1410' }} />
                ))}
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '8px 12px', background: '#1b1410' }}>
                <span style={{ width: 4, height: 18, background: '#ffd25e' }} />
                <span className="sk" style={{ fontSize: 10, color: '#fffaf0' }}>COIN</span>
              </span>
            </div>
          </div>

          {/* Venue info */}
          <div className="px fa-hero-p" style={{
            position: 'relative', display: 'flex', flexDirection: 'column', gap: 20,
            padding: '32px 32px 28px', background: COLORS.paper,
          }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14 }}>
              <span className="sk pxs" style={{ padding: '6px 10px', fontSize: 11, color: COLORS.onAccent, background: cur.accent, textTransform: 'uppercase' }}>{cur.tagline}</span>
              <span className="sk pxs" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 10px', fontSize: 11, background: COLORS.paper, color: COLORS.text }}>
                <span className="blink" style={{ width: 8, height: 8, background: COLORS.greenInk }} />{curMeta.status}
              </span>
              <span className="sk" style={{ marginLeft: 'auto', fontSize: 11, color: COLORS.muted }}>CARTRIDGE {num(featured)}</span>
            </div>
            <div>
              <h3 className={'pf fa-hero-t' + (curVi ? ' fa-vi' : '')} style={{ margin: 0, fontSize: 46, lineHeight: 1 }}>{cur.label}</h3>
              <p style={{ margin: '14px 0 0', fontSize: 15, lineHeight: 1.6, color: COLORS.muted }}>{cur.desc}</p>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, paddingLeft: 3 }}>
              {cur.chips.map((c) => (
                <span key={c} className={'sk pxs' + (hasVi(c) ? ' fa-vi' : '')} style={{ padding: '5px 9px', fontSize: 10, fontWeight: 700, background: COLORS.field, color: COLORS.text }}>{c}</span>
              ))}
            </div>
            <dl style={{ margin: 0, borderTop: '3px dashed ' + COLORS.rule }}>
              {[
                ['GENRE', curMeta.genre],
                ['STATUS', curMeta.status],
                ['OPENS', 'FULL PAGE · THIS TAB'],
                ['PATH', cur.href],
              ].map(([k, v]) => (
                <div key={k} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12,
                  padding: '10px 0', borderBottom: '3px dashed ' + COLORS.rule,
                }}>
                  <dt className="sk" style={{ fontSize: 11, color: COLORS.muted }}>{k}</dt>
                  <dd className={k === 'PATH' ? 'mono' : 'sk'} style={{ margin: 0, fontSize: k === 'PATH' ? 13 : 12, textAlign: 'right', wordBreak: 'break-all' }}>{v}</dd>
                </div>
              ))}
            </dl>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 22, marginTop: 'auto', padding: '6px 10px 10px 4px' }}>
              <a className="sk pbtn" href={`#/game/${cur.id}`} onClick={onPlay(cur)} style={{
                display: 'inline-flex', alignItems: 'center', gap: 12, height: 56, padding: '0 24px', fontSize: 16,
                color: COLORS.onAccent, background: '#e04545', textDecoration: 'none',
              }}>
                <PixelArrow size={14} />PLAY NOW
              </a>
              <span className="sk" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 11, color: COLORS.muted }}>OR PICK A CARTRIDGE BELOW <PixelArrow dir="down" size={6} /></span>
            </div>
          </div>
        </div>
      </section>

      {/* ── 2 · Game select (one cartridge per venue) ── */}
      <section aria-labelledby="select-h" style={{ marginTop: isMobile ? 64 : 84 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, marginBottom: isMobile ? 52 : 60 }}>
          <div>
            <p className="sk" style={{ margin: '0 0 10px', fontSize: isMobile ? 11 : 13, color: COLORS.muted }}>GAME SELECT · {num(total - 1)} CARTRIDGES</p>
            <h2 id="select-h" className="pf fa-sec-h" style={{ margin: 0, fontSize: 40, lineHeight: 1 }}>Choose your cartridge</h2>
          </div>
          <p className="sk" style={{ display: 'flex', alignItems: 'center', gap: 10, margin: 0, fontSize: isMobile ? 11 : 13, color: COLORS.greenInk }}>
            <span className="blink" style={{ width: 10, height: 10, background: 'currentColor' }} />
            {total} VENUES LIVE · WEB + DISCORD
          </p>
        </div>

        <div className="fa-carts" style={{ padding: '0 12px 14px 4px' }}>
          {GAME_TILES.map((t, i) => {
            const meta = GAME_META[t.id] || {};
            const on = i === featured;
            const vi = hasVi(t.label);
            return (
              <article key={t.id} className={'fa-cart rise' + (on ? ' fa-cart-on' : '')} style={{
                display: 'flex', flexDirection: 'column', minHeight: 340, background: t.accent, color: COLORS.onAccent,
                animationDelay: i * 60 + 'ms',
              }}>
                {on && (
                  <span className="sk bob" aria-hidden="true" style={{
                    position: 'absolute', left: '50%', top: -40, marginLeft: -28, display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '4px 10px', fontSize: 12, color: COLORS.stripText, background: COLORS.strip,
                  }}>P1 <PixelArrow dir="down" size={6} /></span>
                )}
                <span className="sk fa-ribs" style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: 26, padding: '0 12px',
                  fontSize: 12, borderBottom: '4px solid #1b1410',
                }}><span>{meta.status}</span>{num(i)}</span>
                <button type="button" className="fa-csel" onClick={() => setFeatured(i)} aria-pressed={on} aria-label={`Feature ${t.label}`} style={{
                  display: 'flex', flexDirection: 'column', gap: 10, flex: 1, margin: '14px 14px 0', padding: 16,
                  textAlign: 'left', color: COLORS.text, background: COLORS.paper, border: '3px solid #1b1410',
                }}>
                  <span className="fa-ico" style={{ display: 'inline-flex' }}><GameIcon id={t.id} size={34} /></span>
                  <span className={'pf' + (vi ? ' fa-vi' : '')} style={{ fontSize: vi ? 21 : 24, lineHeight: 1.05 }}>{t.label}</span>
                  <span className="sk" style={{ fontSize: 11, color: COLORS.muted, textTransform: 'uppercase' }}>{t.tagline}</span>
                  <span className="fa-clamp2" style={{ fontSize: 13, lineHeight: 1.5, color: COLORS.muted }}>{t.desc}</span>
                  <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 'auto', paddingTop: 4 }}>
                    {t.chips.map((c) => (
                      <span key={c} className={'sk' + (hasVi(c) ? ' fa-vi' : '')} style={{ padding: '3px 6px', fontSize: 10, fontWeight: 700, border: '2px solid ' + COLORS.text }}>{c}</span>
                    ))}
                  </span>
                </button>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '16px 18px 18px 14px' }}>
                  <span className="sk" style={{ fontSize: 11 }}>GENRE · {meta.genre}</span>
                  <a className="sk sbtn" href={`#/game/${t.id}`} onClick={onPlay(t)} aria-label={`Play ${t.label}`} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 8, height: 36, padding: '0 12px', fontSize: 12,
                    color: '#1b1410', background: '#fffaf0', textDecoration: 'none',
                  }}>PLAY <PixelArrow size={10} /></a>
                </div>
              </article>
            );
          })}
        </div>

        {/* Slim "more soon" line — an RPG dialog box keeps the hub feeling
            alive without a hollow placeholder tile. */}
        <DialogBox speaker="SE77N SAYS:" padding={isMobile ? '28px 46px 22px 20px' : '28px 60px 24px 28px'}
          style={{ marginTop: isMobile ? 44 : 60, marginRight: 12 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 20px' }}>
            <svg width="28" height="28" viewBox="0 0 7 7" shapeRendering="crispEdges" aria-hidden="true">
              <path d="M3 0h1v2h2v1h1v1H6v1H4v2H3V5H1V4H0V3h1V2h2z" fill="#ffd25e" stroke="#1b1410" strokeWidth="0.35" />
            </svg>
            <span className="sk" style={{ fontSize: 15, color: COLORS.text }}>MORE · SOON</span>
            <span style={{ fontSize: 14, lineHeight: 1.5, color: COLORS.muted }}>Mini-games, leaderboards, arcade</span>
          </div>
        </DialogBox>
      </section>
    </div>
  );
}
