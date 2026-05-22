// In-process cache helpers for the kata dashboard, used by the Vercel
// serverless functions. Replaces the previous Upstash Redis cache after
// the bot project also dropped Redis (it was burning the free tier just
// from BullMQ idle polls).
//
// Vercel keeps function instances warm for a few minutes between calls
// when traffic is steady, so a module-level Map gives us cache hits in
// the common dashboard-refresh case. Cold starts recompute — same
// behaviour the old wrapper had when Redis was unreachable.
//
// Each function file imports its own copy of this module, so caches are
// isolated per function. That's fine — the only callers (kata cost +
// admin cost) live in the same auth handler.

const store = new Map();

function readEntry(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

function writeEntry(key, value, ttlSeconds) {
  // Soft cap so a runaway key explosion can't OOM the function. 2k entries
  // at ~5KB each ≈ 10MB; well under the Vercel function memory budget.
  const MAX = 2000;
  if (store.size >= MAX && !store.has(key)) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

/**
 * Cache wrapper for expensive aggregations. Returns the cached value if
 * present, otherwise runs `producer`, stores the result with TTL, and
 * returns it. Same shape as the old Redis-backed `cached(...)` so callers
 * don't need to change.
 *
 * Returns `{ value, hit }` so the dashboard can label "fresh / cached".
 */
export async function cached(key, ttlSeconds, producer) {
  const cachedValue = readEntry(key);
  if (cachedValue !== null) return { value: cachedValue, hit: true };
  const value = await producer();
  writeEntry(key, value, ttlSeconds);
  return { value, hit: false };
}

/**
 * Compatibility shim for the admin health page, which used to ping
 * Upstash. With the in-process cache there's nothing to ping — we just
 * return `ok: true` so the page renders without a "redis down" banner.
 * Kept as an async function in case callers `await` it.
 */
export async function ping() {
  return { ok: true, latencyMs: 0, mode: 'in-process' };
}
