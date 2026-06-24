// POST /api/stylist?action=classify | mix
//
// Chat-only helper for the Stylist module. No fal jobs here, so it always stays
// well under the function cap — the slow image work (catalog re-render +
// lookbook) goes through /api/image with its own pending/poll machinery.
//
//   action=classify  body { image }                       → { name, category, color }
//   action=mix       body { items[], occasion, count }     → { sets:[{ name, itemIds, rationale }] }
//
// Mirrors api/agent.js: rate-limit per owner, hide the model key, parse JSON
// defensively with tryParseJson.

import { callChat, tryParseJson } from './_helpers.js';
import { resolveOwner } from './_lib/threads.js';
import { enforceLimits, LIMITS } from './_lib/ratelimit.js';

export const config = { maxDuration: 30 };

const CATEGORIES = ['top', 'bottom', 'outer', 'shoes', 'accessory'];

const CLASSIFY_SYSTEM = `You are a fashion cataloguer. Look at the single clothing item or accessory in the image and output STRICT JSON on one line — no markdown:

{"name":"...","category":"top|bottom|outer|shoes|accessory","color":"..."}

Rules:
- name: a short human label, max 4 words (e.g. "white linen shirt").
- category: exactly one of top, bottom, outer, shoes, accessory. Pick the closest. Hats/bags/belts/jewellery/glasses → accessory. Jackets/coats/blazers → outer.
- color: the dominant color in one or two words.`;

const MIX_SYSTEM = `You are a personal stylist. You are given a wardrobe (a list of items with id, name, category, color) and an occasion. Compose complete, tasteful outfits using ONLY the given item ids.

Output STRICT JSON on one line — no markdown:

{"sets":[{"name":"...","itemIds":["id1","id2"],"rationale":"..."}]}

Rules:
- Build as many distinct outfits as requested (the user gives a count), but never more than the wardrobe realistically supports.
- Each outfit should combine items that work together for the occasion: ideally one top + one bottom (or a one-piece), optional outer, shoes, and at most one or two accessories. Use only ids that exist in the wardrobe.
- name: a short evocative label for the look (max 4 words).
- rationale: one short sentence on why it works for the occasion.
- Do not invent ids. Do not repeat the exact same set twice.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const action = req.query?.action;
  const owner = await resolveOwner(req, res);
  // Cheap chat gate — both actions are single LLM calls.
  if (!(await enforceLimits(res, owner?.ownerKey, [LIMITS.chat]))) return;

  try {
    if (action === 'classify') {
      const { image } = req.body || {};
      if (!image) return res.status(400).json({ error: 'image required' });
      const text = await callChat({
        system: CLASSIFY_SYSTEM,
        prompt: 'Classify this item.',
        image,
        max_tokens: 200,
        temperature: 0.1,
        jsonMode: true,
        model: process.env.YUNWU_ROUTER_MODEL || 'gemini-3.1-flash-lite',
      });
      const parsed = tryParseJson(text) || {};
      const category = CATEGORIES.includes(parsed.category) ? parsed.category : 'top';
      const name = typeof parsed.name === 'string' && parsed.name.trim()
        ? parsed.name.trim().slice(0, 60) : 'item';
      const color = typeof parsed.color === 'string' ? parsed.color.trim().slice(0, 30) : '';
      return res.status(200).json({ name, category, color });
    }

    if (action === 'mix') {
      const { items, occasion = '', count = 3 } = req.body || {};
      if (!Array.isArray(items) || !items.length) {
        return res.status(400).json({ error: 'items required' });
      }
      // Trim to what the model needs; cap to keep the prompt bounded.
      const valid = items
        .filter((it) => it && typeof it.id === 'string')
        .slice(0, 120)
        .map((it) => ({
          id: it.id,
          name: String(it.name || '').slice(0, 60),
          category: CATEGORIES.includes(it.category) ? it.category : 'top',
          color: String(it.color || '').slice(0, 30),
        }));
      const ids = new Set(valid.map((it) => it.id));
      const n = Math.min(6, Math.max(1, Number(count) || 3));

      const text = await callChat({
        system: MIX_SYSTEM,
        prompt: `occasion: ${String(occasion).slice(0, 200) || '(everyday)'}\noutfits wanted: ${n}\n\nwardrobe:\n${JSON.stringify(valid)}`,
        max_tokens: 1200,
        temperature: 0.7,
        jsonMode: true,
        model: process.env.YUNWU_CHAT_MODEL || 'gemini-3.1-flash-lite',
      });
      const parsed = tryParseJson(text) || {};
      const rawSets = Array.isArray(parsed.sets) ? parsed.sets : [];
      // Keep only sets whose ids all exist; drop unknown ids; drop empties.
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
        .slice(0, n);

      return res.status(200).json({ sets });
    }

    return res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    return res.status(e.status || 502).json({ error: String(e.message || e), upstream: e.upstream });
  }
}
