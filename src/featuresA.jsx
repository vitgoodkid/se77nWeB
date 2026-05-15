import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  COLORS, CITIES,
  Panel, Btn, Field, Pill, Kicker,
  usePersisted, usePasteImage, copyText,
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
    id: 'name', kind: 'chat', label: 'Naming', icon: '✦',
    system: 'You are a brand naming partner. Given a concept, return 6 name candidates. For each: NAME — one-line vibe — domain.com guess. No fluff.',
    placeholder: 'Describe the product or vibe…',
    seed: 'Tell me what you\'re naming and the vibe. I\'ll give 6 candidates with domain guesses.',
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
  const [presetId, setPresetId] = usePersisted('se77n.ai.preset', 'chat');
  const preset = AI_PRESETS.find((p) => p.id === presetId) || AI_PRESETS[0];
  const [history, setHistory] = usePersisted('se77n.ai.history.v2', {});
  const messages = history[presetId] || [];
  const [input, setInput] = useState('');
  const [imgRef, setImgRef] = useState(null); // { dataUrl, name }
  const [busy, setBusy] = useState(false);
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
          body: JSON.stringify({ prompt: q, image: usedImage?.dataUrl }),
        });
        const data = await safeJson(res, 'image');
        assistantMsg = { role: 'assistant', content: '', image: data.image };
      } else if (preset.kind === 'video') {
        const res = await fetch('/api/video', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: q, image: usedImage?.dataUrl }),
        });
        const data = await safeJson(res, 'video');
        assistantMsg = { role: 'assistant', content: '', video: data.video };
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
    <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 18, height: '100%' }}>
      <Panel padding={16} style={{ display: 'flex', flexDirection: 'column' }}>
        <Kicker style={{ marginBottom: 14 }}>PRESETS · {String(AI_PRESETS.length).padStart(2, '0')}</Kicker>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {AI_PRESETS.map((p) => {
            const active = p.id === presetId;
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
                {p.label}
              </button>
            );
          })}
        </div>
        <div style={{ flex: 1 }} />
        <div style={{
          marginTop: 16, paddingTop: 14, borderTop: '1px solid ' + COLORS.line,
          fontSize: 10, color: COLORS.muted, lineHeight: 1.6,
        }} className="mono">
          <div>chat · gemini-3.1-flash-lite</div>
          <div>image · fal · gpt-image-2</div>
          <div>video · fal · seedance-2.0</div>
          <div>bg · fal · ideogram</div>
          <div style={{ marginTop: 6, opacity: 0.6 }}>⌘V to paste images</div>
        </div>
      </Panel>

      <Panel padding={0} style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid ' + COLORS.line,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <Kicker>SESSION · {presetId.toUpperCase()}</Kicker>
            <div className="mono" style={{ fontSize: 16, fontWeight: 700, marginTop: 4 }}>{preset.label}</div>
          </div>
          <Btn onClick={clearChat} variant="ghost">Clear</Btn>
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
          <Btn variant="solid" onClick={send} disabled={busy || (!input.trim() && !imgRef)}>↗ Send</Btn>
        </div>
      </Panel>
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
// 3. TRAVEL ARCHIVE — dotted world map + 16 pins
// ═════════════════════════════════════════════════════════════
export function TravelArchive() {
  const [active, setActive] = useState(null);
  const [filter, setFilter] = useState('all');

  const cities = useMemo(() => CITIES.filter((c) => filter === 'all' || c.type === filter), [filter]);
  const stats = useMemo(() => ({
    home: CITIES.filter((c) => c.type === 'home').length,
    visited: CITIES.filter((c) => c.type === 'visited').length,
    planned: CITIES.filter((c) => c.type === 'planned').length,
  }), []);

  const typeColor = { home: COLORS.gold, visited: COLORS.green, planned: COLORS.red };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 18, height: '100%' }}>
      <Panel padding={0} style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid ' + COLORS.line,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <Kicker>ARCHIVE · 16 CITIES</Kicker>
            <div className="mono" style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>Travel map</div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {[['all', 'ALL'], ['home', 'HOME'], ['visited', 'VISITED'], ['planned', 'PLANNED']].map(([k, l]) => {
              const c = k === 'all' ? COLORS.text : typeColor[k];
              const isActive = filter === k;
              return (
                <button key={k} onClick={() => setFilter(k)} className="mono"
                  style={{
                    padding: '6px 11px', borderRadius: 999,
                    fontSize: 10, letterSpacing: '0.14em', cursor: 'pointer',
                    background: isActive ? c + '1f' : 'transparent',
                    border: `1px solid ${isActive ? c + '70' : COLORS.line}`,
                    color: isActive ? c : COLORS.muted,
                  }}>{l}</button>
              );
            })}
          </div>
        </div>
        <div style={{ flex: 1, padding: 16, position: 'relative' }}>
          <WorldMap cities={cities} active={active} setActive={setActive} typeColor={typeColor} />
        </div>
      </Panel>

      <Panel padding={20} style={{ overflow: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 18 }}>
          {[['home', stats.home, 'HOME'], ['visited', stats.visited, 'VISITED'], ['planned', stats.planned, 'PLANNED']].map(([k, n, l]) => (
            <div key={k} style={{
              padding: 12, borderRadius: 10, background: COLORS.bg, border: `1px solid ${typeColor[k]}40`,
            }}>
              <div className="mono" style={{ fontSize: 9, color: typeColor[k], letterSpacing: '0.16em' }}>{l}</div>
              <div className="mono" style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{n}</div>
            </div>
          ))}
        </div>

        {active ? (
          <div style={{ animation: 'fadeUp 200ms ease-out' }}>
            <Kicker style={{ color: typeColor[active.type] }}>
              ● {active.type.toUpperCase()} · {active.country}
            </Kicker>
            <div className="mono" style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}>{active.city}</div>
            <div className="mono" style={{ fontSize: 11, color: COLORS.muted, marginTop: 4 }}>
              {active.lat.toFixed(2)}°, {active.lng.toFixed(2)}°
            </div>
            <div style={{
              marginTop: 14, padding: 14, borderRadius: 10,
              background: COLORS.bg, border: '1px solid ' + COLORS.line,
              fontSize: 13, lineHeight: 1.5, color: COLORS.text,
            }}>{active.note}</div>
          </div>
        ) : (
          <div>
            <Kicker style={{ marginBottom: 10 }}>ALL · {cities.length}</Kicker>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {cities.map((c) => (
                <button key={c.id} onClick={() => setActive(c)} style={{
                  textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '8px 10px', background: 'transparent',
                  border: '1px solid transparent', borderRadius: 8,
                  cursor: 'pointer', color: COLORS.text, transition: 'background 100ms',
                }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: typeColor[c.type] }} />
                    <span className="mono" style={{ fontSize: 13 }}>{c.city}</span>
                  </span>
                  <span className="mono" style={{ fontSize: 10, color: COLORS.muted }}>{c.country}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </Panel>
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
