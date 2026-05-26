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

  // Routing
  let cls;
  if (maybeWantsMedia(prompt, !!image)) {
    cls = await classify(prompt, !!image);
  } else {
    cls = { tool: 'chat' };
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
