// Lightweight Redis publish helper for Vercel serverless. Used by the kata
// dashboard to broadcast config:updated:{guildId} so the bot picks up new
// config across processes (Phase 10 pub/sub).
//
// We open a per-invocation connection rather than caching a long-lived client
// because Vercel functions can be frozen for minutes between calls — a stale
// ioredis socket would hang the next publish for the connect timeout.
import Redis from 'ioredis';

export async function publish(channel, payload) {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL not configured');

  const client = new Redis(url, {
    // Keep the function lean — fail fast instead of holding the request open.
    connectTimeout: 4000,
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
    lazyConnect: false,
  });

  try {
    const message = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return await client.publish(channel, message);
  } finally {
    // disconnect() is non-blocking; quit() flushes the buffer first. We want quit.
    try { await client.quit(); } catch { /* socket already gone */ }
  }
}
