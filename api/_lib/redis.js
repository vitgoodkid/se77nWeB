// Lightweight Redis helpers for Vercel serverless. Used by the kata
// dashboard to:
//   - broadcast config:updated:{guildId} so the bot picks up new config
//     across processes (Phase 10 pub/sub)
//   - cache expensive aggregations (e.g. /api/kata/server/:id/cost) for
//     a few minutes so a dashboard refresh doesn't refire 11 Mongo
//     aggregations every time
//
// We open a per-invocation connection rather than caching a long-lived client
// because Vercel functions can be frozen for minutes between calls — a stale
// ioredis socket would hang the next call for the connect timeout.
import Redis from 'ioredis';

const CONNECT_OPTS = {
  // Keep the function lean — fail fast instead of holding the request open.
  connectTimeout: 4000,
  maxRetriesPerRequest: 1,
  enableReadyCheck: true,
  lazyConnect: false,
};

function makeClient() {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL not configured');
  return new Redis(url, CONNECT_OPTS);
}

export async function publish(channel, payload) {
  const client = makeClient();
  try {
    const message = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return await client.publish(channel, message);
  } finally {
    // disconnect() is non-blocking; quit() flushes the buffer first. We want quit.
    try { await client.quit(); } catch { /* socket already gone */ }
  }
}

/**
 * Cache wrapper for expensive serverless aggregations. Returns the cached
 * value if present, otherwise runs `producer`, stores the result with TTL,
 * and returns it. Cache failures degrade to running the producer directly —
 * Redis going down should NEVER break the dashboard.
 *
 * Values are stringified JSON. `producer` must return something JSON-safe.
 *
 * Returns `{ value, hit: boolean }` so callers can surface cache status in
 * response headers for debugging.
 */
export async function cached(key, ttlSeconds, producer) {
  let client;
  try {
    client = makeClient();
  } catch {
    return { value: await producer(), hit: false };
  }

  try {
    let raw = null;
    try {
      raw = await client.get(key);
    } catch {
      // ignore read errors — fall through to recompute.
    }
    if (raw) {
      try {
        return { value: JSON.parse(raw), hit: true };
      } catch {
        // Cached blob is corrupt — fall through to recompute.
      }
    }
    const value = await producer();
    try {
      await client.setex(key, ttlSeconds, JSON.stringify(value));
    } catch {
      // ignore — better to serve uncached than 500.
    }
    return { value, hit: false };
  } finally {
    try { await client.quit(); } catch { /* ignore */ }
  }
}
