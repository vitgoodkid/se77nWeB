// Server-authoritative chat memory with a sliding TTL.
//
// Each conversation lives in the `chat_threads` collection as one doc per
// (ownerKey, threadId). A MongoDB TTL index on `expiresAt` deletes the doc
// once it lapses; every write pushes `expiresAt` forward (sliding window) so
// an active conversation is never dropped mid-use. Authed users key on email,
// guests on the same `se77n_guest` cookie used by the activity feed.
//
// `_lib` prefix → Vercel does NOT expose this as an HTTP route.

import { ObjectId } from 'mongodb';
import { getDb } from './mongo.js';
import { readSession, parseCookies } from './session.js';

const GUEST_COOKIE = 'se77n_guest';
const TTL_DAYS = Number(process.env.CHAT_THREAD_TTL_DAYS) || 3;
const TTL_MS = TTL_DAYS * 24 * 60 * 60 * 1000;
const THREAD_MAX_MESSAGES = 40; // keep doc bounded; context to model is capped separately
const MSG_MAX_LEN = 12_000;

function isProd() {
  return process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
}

function buildGuestCookie(value) {
  const parts = [
    `${GUEST_COOKIE}=${encodeURIComponent(value)}`,
    'Max-Age=31536000', // 1 year
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (isProd()) parts.push('Secure');
  return parts.join('; ');
}

async function nextGuestKey(db) {
  const counters = db.collection('counters');
  const result = await counters.findOneAndUpdate(
    { _id: 'guest' },
    { $inc: { n: 1 } },
    { upsert: true, returnDocument: 'after' },
  );
  const doc = result?.value || result;
  return `guest${doc?.n || 1}`;
}

let ttlEnsured = false;
async function ensureThreadIndexes(col) {
  if (ttlEnsured) return;
  try {
    await col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'chat_thread_ttl' });
    await col.createIndex({ ownerKey: 1, threadId: 1 }, { unique: true, name: 'chat_thread_owner' });
    ttlEnsured = true;
  } catch { /* index race on parallel cold-start — ignore */ }
}

export function sanitizeThreadId(raw) {
  const s = String(raw || 'default').slice(0, 64);
  return /^[\w:.-]+$/.test(s) ? s : 'default';
}

// Resolve the actor. Authed → email; otherwise issue/read a guest cookie
// (mutates res with Set-Cookie when minting a new guest id). Returns null if
// identity can't be resolved (e.g. DB unreachable) so callers degrade to the
// client-supplied history instead of failing the request.
export async function resolveOwner(req, res) {
  try {
    const db = await getDb();
    const session = readSession(req);
    if (session?.uid) {
      try {
        const user = await db.collection('users').findOne({ _id: new ObjectId(session.uid) });
        if (user) return { ownerKey: (user.email || user._id.toString()).toLowerCase(), ownerType: 'user' };
      } catch { /* fall through to guest */ }
    }
    const cookies = parseCookies(req.headers?.cookie || '');
    let key = cookies[GUEST_COOKIE];
    if (!key) {
      key = await nextGuestKey(db);
      res.setHeader('Set-Cookie', buildGuestCookie(key));
    }
    return { ownerKey: key, ownerType: 'guest' };
  } catch {
    return null;
  }
}

export async function loadThreadMessages(ownerKey, threadId) {
  try {
    const db = await getDb();
    const col = db.collection('chat_threads');
    const doc = await col.findOne({ ownerKey, threadId: sanitizeThreadId(threadId) });
    if (!Array.isArray(doc?.messages)) return [];
    return doc.messages
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .map((m) => ({ role: m.role, content: m.content }));
  } catch {
    return [];
  }
}

// Drop a thread so "clear chat" also wipes server-side memory. Best-effort.
export async function deleteThread(ownerKey, threadId) {
  try {
    const db = await getDb();
    await db.collection('chat_threads').deleteOne({ ownerKey, threadId: sanitizeThreadId(threadId) });
  } catch { /* best-effort */ }
}

// Append turns and slide the TTL forward. Best-effort: a DB failure must never
// break the chat response, so all errors are swallowed.
export async function appendThreadTurns(ownerKey, ownerType, threadId, turns) {
  try {
    const clean = (turns || [])
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .map((m) => ({ role: m.role, content: m.content.slice(0, MSG_MAX_LEN), ts: new Date() }));
    if (!clean.length) return;
    const db = await getDb();
    const col = db.collection('chat_threads');
    await ensureThreadIndexes(col);
    const tid = sanitizeThreadId(threadId);
    await col.updateOne(
      { ownerKey, threadId: tid },
      {
        $push: { messages: { $each: clean, $slice: -THREAD_MAX_MESSAGES } },
        $set: { ownerType, updatedAt: new Date(), expiresAt: new Date(Date.now() + TTL_MS) },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true },
    );
  } catch { /* best-effort persistence */ }
}
