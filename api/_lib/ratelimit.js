// Per-owner rate limiting backed by MongoDB fixed-window counters.
//
// One doc per (ownerKey, action, window) keyed by a derived _id, incremented
// atomically. A TTL index on `expiresAt` sweeps stale window docs. Identity
// comes from resolveOwner() (authed email or guest cookie), so limits apply to
// guests too. Fails OPEN on any DB error — a rate limiter must never take the
// whole chat down when Mongo hiccups.
//
// `_lib` prefix → Vercel does NOT expose this as an HTTP route.

import { getDb } from './mongo.js';

let ttlEnsured = false;
async function ensureIndex(col) {
  if (ttlEnsured) return;
  try {
    await col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'rl_ttl' });
    ttlEnsured = true;
  } catch { /* index race — ignore */ }
}

// Default limits (per owner). All overridable via env. Media gets both a
// burst (per-minute) and a sustained (per-day) cap to bound API spend.
export const LIMITS = {
  // Generic gate for /api/agent — bounds total calls (incl. the cheap router
  // classifier) before any paid work, regardless of resolved intent.
  agentReq:  { action: 'agent', limit: Number(process.env.RL_AGENT_PER_MIN) || 20, windowMs: 60_000 },
  chat:      { action: 'chat',  limit: Number(process.env.RL_CHAT_PER_MIN)  || 20, windowMs: 60_000 },
  imageMin:  { action: 'image', limit: Number(process.env.RL_IMAGE_PER_MIN) || 8,  windowMs: 60_000 },
  imageDay:  { action: 'image_day', limit: Number(process.env.RL_IMAGE_PER_DAY) || 100, windowMs: 86_400_000 },
  videoMin:  { action: 'video', limit: Number(process.env.RL_VIDEO_PER_MIN) || 4,  windowMs: 60_000 },
  videoDay:  { action: 'video_day', limit: Number(process.env.RL_VIDEO_PER_DAY) || 30,  windowMs: 86_400_000 },
};

async function checkOne(ownerKey, action, limit, windowMs) {
  if (!ownerKey) return { ok: true }; // can't identify → fail open
  try {
    const db = await getDb();
    const col = db.collection('rate_limits');
    await ensureIndex(col);
    const now = Date.now();
    const bucket = Math.floor(now / windowMs);
    const _id = `${ownerKey}:${action}:${bucket}`;
    const windowEnd = (bucket + 1) * windowMs;
    const r = await col.findOneAndUpdate(
      { _id },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(windowEnd + 5000) } },
      { upsert: true, returnDocument: 'after' },
    );
    const count = (r?.value || r)?.count || 1;
    if (count > limit) {
      return { ok: false, retryAfter: Math.max(1, Math.ceil((windowEnd - now) / 1000)) };
    }
    return { ok: true };
  } catch {
    return { ok: true }; // DB error → fail open
  }
}

// Run the given specs; on the first breach, send a 429 and return false so the
// handler can `return`. Returns true when all checks pass (or can't be applied).
export async function enforceLimits(res, ownerKey, specs) {
  for (const s of specs) {
    const r = await checkOne(ownerKey, s.action, s.limit, s.windowMs);
    if (!r.ok) {
      res.setHeader('Retry-After', String(r.retryAfter || 60));
      res.status(429).json({
        error: `Bạn gửi hơi nhanh — thử lại sau ${r.retryAfter || 60}s.`,
        retryAfter: r.retryAfter || 60,
      });
      return false;
    }
  }
  return true;
}
