// POST /api/agent
// Body: { prompt: string, image?: string }
// Returns:
//   { kind: 'chat',  text: string, intent }
//   { kind: 'image', image: url,   intent }
//   { kind: 'video', video: url,   intent }
//   { kind: 'pending', requestId, intent }
//
// One-shot router for the floating chat. Heuristic short-circuits clearly
// chat-only prompts. Otherwise asks the chat model to classify intent then
// dispatches to the correct tool (image gen/edit, video gen, bg remove).

import { callChat, falSubmitAndPoll, pickImageUrl, pickVideoUrl, tryParseJson } from './_helpers.js';
import { resolveOwner, loadThreadMessages, appendThreadTurns, deleteThread, sanitizeThreadId } from './_lib/threads.js';
import { enforceLimits, LIMITS } from './_lib/ratelimit.js';

export const config = { maxDuration: 60 };

const SE77N_SYSTEM =
  'You are se77n, a thoughtful warm AI partner. Respond conversationally in the user\'s language. Be concise.';

const ROUTER_SYSTEM = `You are a routing classifier for a multimodal AI assistant. Given a user message and whether they attached an image, output STRICT JSON on a single line — no markdown, no explanation:

{"tool":"chat|image_gen|image_edit|video_gen|bg_remove","refined_prompt":"..."}

Rules:
- chat: questions, conversation, summary, code, explanation, ANY task that produces text. Includes describing/analyzing an attached image. Default if unclear.
- image_gen: user wants a NEW image created from text only (no source image edit). Triggers: draw, vẽ, tạo ảnh, create an image, render, generate ... picture/image.
- image_edit: user has an image AND wants it modified (add/remove/change/restyle/swap/recolor/upscale). Requires has_image=true.
- bg_remove: user wants to remove or erase the background. Triggers: remove bg, remove background, xóa nền, tách nền, transparent background, cut out subject. Requires has_image=true.
- video_gen: user wants a video/animation/clip. Triggers: video, clip, animation, animate, làm video.

For image_gen/image_edit/video_gen, refined_prompt is a concise English visual description suitable for a diffusion model. For chat/bg_remove, refined_prompt may be empty.`;

// Cheap heuristic: skip classifier when prompt is obviously not a media request
// AND no image is attached. Image attachment always triggers classification.
function maybeWantsMedia(prompt, hasImage) {
  if (hasImage) return true;
  const p = String(prompt || '').toLowerCase();
  const verbs = /\b(draw|paint|generate|render|create|make|design|illustrate|sketch|tạo|vẽ|render|làm)\b/;
  const nouns = /\b(image|picture|photo|art|painting|illustration|sketch|render|video|clip|animation|animate|gif|ảnh|hình|tranh|video)\b/;
  return verbs.test(p) && nouns.test(p) || /\b(video|clip|animation|animate|gif)\b/.test(p);
}

const VALID_TOOLS = new Set(['chat', 'image_gen', 'image_edit', 'video_gen', 'bg_remove']);

// ── Stylist actions (folded in to stay under the Hobby-plan 12-function cap) ──
// Both are single chat calls — no fal jobs here, so they're always fast.
const STYLIST_CATEGORIES = ['top', 'bottom', 'outer', 'shoes', 'accessory'];

const STYLIST_CLASSIFY_SYSTEM = `You are a fashion cataloguer. Look at the single clothing item or accessory in the image and output STRICT JSON on one line — no markdown:

{"name":"...","category":"top|bottom|outer|shoes|accessory","color":"..."}

Rules:
- name: a short human label, max 4 words (e.g. "white linen shirt").
- category: exactly one of top, bottom, outer, shoes, accessory. Pick the closest. Hats/bags/belts/jewellery/glasses → accessory. Jackets/coats/blazers → outer.
- color: the dominant color in one or two words.`;

const STYLIST_MIX_SYSTEM = `You are a personal stylist. You are given a wardrobe (a list of items with id, name, category, color) and an occasion. Compose complete, tasteful outfits using ONLY the given item ids.

Output STRICT JSON on one line — no markdown:

{"sets":[{"name":"...","itemIds":["id1","id2"],"rationale":"..."}]}

Rules:
- Decide a sensible number of distinct outfits the wardrobe genuinely supports — usually 2 to 6. Quality over quantity: never pad with weak, forced, or near-duplicate combinations.
- If the wearer's height is given, factor it into proportions and silhouettes (e.g. shorter heights suit higher-waisted / more fitted cuts).
- Each outfit should combine items that work together for the occasion: ideally one top + one bottom (or a one-piece), optional outer, shoes, and at most one or two accessories. Use only ids that exist in the wardrobe.
- name: a short evocative label for the look (max 4 words).
- rationale: one short sentence on why it works for the occasion.
- Do not invent ids. Do not repeat the exact same set twice.`;

async function handleStylist(req, res, action) {
  const owner = await resolveOwner(req, res);
  if (!(await enforceLimits(res, owner?.ownerKey, [LIMITS.chat]))) return;

  try {
    if (action === 'classify') {
      const { image } = req.body || {};
      if (!image) return res.status(400).json({ error: 'image required' });
      const text = await callChat({
        system: STYLIST_CLASSIFY_SYSTEM,
        prompt: 'Classify this item.',
        image,
        max_tokens: 200,
        temperature: 0.1,
        jsonMode: true,
        model: process.env.YUNWU_ROUTER_MODEL || 'gemini-3.1-flash-lite',
      });
      const parsed = tryParseJson(text) || {};
      const category = STYLIST_CATEGORIES.includes(parsed.category) ? parsed.category : 'top';
      const name = typeof parsed.name === 'string' && parsed.name.trim()
        ? parsed.name.trim().slice(0, 60) : 'item';
      const color = typeof parsed.color === 'string' ? parsed.color.trim().slice(0, 30) : '';
      return res.status(200).json({ name, category, color });
    }

    // action === 'mix' — the model decides how many outfits the wardrobe supports.
    const { items, occasion = '', height } = req.body || {};
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: 'items required' });
    }
    const valid = items
      .filter((it) => it && typeof it.id === 'string')
      .slice(0, 120)
      .map((it) => ({
        id: it.id,
        name: String(it.name || '').slice(0, 60),
        category: STYLIST_CATEGORIES.includes(it.category) ? it.category : 'top',
        color: String(it.color || '').slice(0, 30),
      }));
    const ids = new Set(valid.map((it) => it.id));

    const text = await callChat({
      system: STYLIST_MIX_SYSTEM,
      prompt: `occasion: ${String(occasion).slice(0, 200) || '(everyday)'}\nwearer height: ${Number(height) ? Number(height) + ' cm' : 'unspecified'}\n\nwardrobe:\n${JSON.stringify(valid)}`,
      max_tokens: 1200,
      temperature: 0.7,
      jsonMode: true,
      model: process.env.YUNWU_CHAT_MODEL || 'gemini-3.1-flash-lite',
    });
    const parsed = tryParseJson(text) || {};
    const rawSets = Array.isArray(parsed.sets) ? parsed.sets : [];
    const sets = rawSets
      .map((s) => {
        const itemIds = Array.isArray(s?.itemIds) ? s.itemIds.filter((id) => ids.has(id)) : [];
        return {
          name: typeof s?.name === 'string' && s.name.trim() ? s.name.trim().slice(0, 60) : 'Look',
          itemIds,
          rationale: typeof s?.rationale === 'string' ? s.rationale.trim().slice(0, 240) : '',
        };
      })
      .filter((s) => s.itemIds.length >= 2)
      .slice(0, 8); // safety cap only — the model picks the real count

    return res.status(200).json({ sets });
  } catch (e) {
    return res.status(e.status || 502).json({ error: String(e.message || e), upstream: e.upstream });
  }
}

async function classify(prompt, hasImage) {
  try {
    const text = await callChat({
      system: ROUTER_SYSTEM,
      prompt: `has_image: ${hasImage}\n\nuser: ${prompt || '(image only)'}`,
      max_tokens: 200,
      temperature: 0.1,
      jsonMode: true,
      // Routing is a cheap classification — keep it on a fast, non-reasoning
      // model so it stays quick/cheap even when chat uses a reasoning model.
      model: process.env.YUNWU_ROUTER_MODEL || 'gemini-3.1-flash-lite',
    });
    const parsed = tryParseJson(text) || {};
    if (!VALID_TOOLS.has(parsed.tool)) parsed.tool = 'chat';
    if (parsed.tool === 'image_edit' && !hasImage) parsed.tool = 'image_gen';
    if (parsed.tool === 'bg_remove' && !hasImage) parsed.tool = 'chat';
    return parsed;
  } catch {
    return { tool: 'chat' };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Stylist garment classify / outfit mix live here (not their own function)
  // to keep the deployment under the Hobby-plan 12-serverless-function cap.
  const stylistAction = req.query?.action;
  if (stylistAction === 'classify' || stylistAction === 'mix') {
    return handleStylist(req, res, stylistAction);
  }

  const { prompt = '', image, history } = req.body || {};

  // Server-side conversation memory (3-day sliding TTL). Prefer the stored
  // thread for context; fall back to client-sent history when there's no
  // server identity or the thread is empty/new.
  const threadId = sanitizeThreadId(req.body?.threadId);

  // "clear chat" → wipe server memory too so a cleared thread isn't recalled.
  if (req.body?.clear === true) {
    const o = await resolveOwner(req, res);
    if (o) await deleteThread(o.ownerKey, threadId);
    return res.status(200).json({ ok: true, cleared: true });
  }

  if (!prompt && !image) return res.status(400).json({ error: 'prompt or image required' });

  const owner = await resolveOwner(req, res);
  const userTurn = prompt || (image ? '(image)' : '');
  let context = Array.isArray(history) ? history : [];
  if (owner) {
    const stored = await loadThreadMessages(owner.ownerKey, threadId);
    if (stored.length) context = stored;
  }
  const remember = (assistantContent) => {
    if (!owner || !assistantContent) return;
    return appendThreadTurns(owner.ownerKey, owner.ownerType, threadId, [
      { role: 'user', content: userTurn },
      { role: 'assistant', content: assistantContent },
    ]);
  };

  // Generic per-owner gate first — bounds total agent calls (including the
  // cheap router classifier) before any paid work.
  if (!(await enforceLimits(res, owner?.ownerKey, [LIMITS.agentReq]))) return;

  // Routing
  let cls;
  if (maybeWantsMedia(prompt, !!image)) {
    cls = await classify(prompt, !!image);
  } else {
    cls = { tool: 'chat' };
  }

  // Media is far pricier than chat → additional burst + daily caps before the
  // fal submission.
  if (cls.tool === 'video_gen') {
    if (!(await enforceLimits(res, owner?.ownerKey, [LIMITS.videoMin, LIMITS.videoDay]))) return;
  } else if (cls.tool === 'image_gen' || cls.tool === 'image_edit' || cls.tool === 'bg_remove') {
    if (!(await enforceLimits(res, owner?.ownerKey, [LIMITS.imageMin, LIMITS.imageDay]))) return;
  }

  try {
    if (cls.tool === 'image_gen' || cls.tool === 'image_edit') {
      const refined = cls.refined_prompt || prompt;
      const engine = (req.body?.engine === 'nano') ? 'nano' : 'openai';
      const model = engine === 'nano'
        ? (image
            ? (process.env.FAL_IMAGE_NANO_MODEL || 'fal-ai/nano-banana-pro/edit')
            : (process.env.FAL_IMAGE_NANO_T2I_MODEL || 'fal-ai/nano-banana-pro'))
        : (image
            ? (process.env.FAL_IMAGE_MODEL || 'openai/gpt-image-2/edit')
            : (process.env.FAL_IMAGE_T2I_MODEL || 'openai/gpt-image-2'));
      const input = { prompt: refined };
      if (image) input.image_urls = [image];
      const result = await falSubmitAndPoll(model, input);
      if (result.__pending) {
        return res.status(202).json({ kind: 'pending', requestId: result.requestId, intent: cls.tool });
      }
      const url = pickImageUrl(result);
      if (!url) return res.status(502).json({ error: 'no image in result', upstream: result });
      await remember('[generated an image]');
      return res.status(200).json({ kind: 'image', image: url, intent: cls.tool, refined });
    }

    if (cls.tool === 'video_gen') {
      const refined = cls.refined_prompt || prompt;
      const t2v = process.env.FAL_VIDEO_T2V_MODEL || 'bytedance/seedance-2.0/text-to-video';
      const i2v = process.env.FAL_VIDEO_I2V_MODEL || 'bytedance/seedance-2.0/image-to-video';
      const model = image ? i2v : t2v;
      const input = { prompt: refined };
      if (image) input.image_url = image;
      const result = await falSubmitAndPoll(model, input);
      if (result.__pending) {
        return res.status(202).json({
          kind: 'pending', requestId: result.requestId, intent: cls.tool,
          message: 'Video generation often exceeds 60s — please try again or shorten the prompt.',
        });
      }
      const url = pickVideoUrl(result);
      if (!url) return res.status(502).json({ error: 'no video in result', upstream: result });
      await remember('[generated a video]');
      return res.status(200).json({ kind: 'video', video: url, intent: cls.tool, refined });
    }

    if (cls.tool === 'bg_remove') {
      const model = process.env.FAL_BG_REMOVE_MODEL || 'fal-ai/ideogram/remove-background';
      const result = await falSubmitAndPoll(model, { image_url: image });
      if (result.__pending) return res.status(202).json({ kind: 'pending', requestId: result.requestId, intent: cls.tool });
      const url = pickImageUrl(result);
      if (!url) return res.status(502).json({ error: 'no image in result', upstream: result });
      await remember('[removed image background]');
      return res.status(200).json({ kind: 'image', image: url, intent: cls.tool });
    }

    // Default: chat (with vision if image attached). Mirrors the AI Playground:
    // gemini-3.1-pro-preview with a large budget so the reasoning model has
    // room for hidden thinking + a full answer (otherwise it returns empty).
    const text = await callChat({
      system: SE77N_SYSTEM,
      prompt,
      image,
      history: context,
      max_tokens: 8000,
      model: 'gemini-3.1-pro-preview',
    });
    if (!text || !text.trim()) {
      // Reasoning model can burn the whole budget on thinking → empty reply.
      // Flag it so the client shows a retry affordance instead of a blank bubble.
      return res.status(200).json({ kind: 'chat', text: '', empty: true, intent: 'chat' });
    }
    await remember(text);
    return res.status(200).json({ kind: 'chat', text, intent: 'chat' });
  } catch (e) {
    return res.status(e.status || 502).json({ error: String(e.message || e), upstream: e.upstream });
  }
}
