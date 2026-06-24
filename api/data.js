// /api/data — per-user key-value sync (one document per user in `userData` collection).
//
// GET                       → 200 { data: { [key]: value, ... } }   (entire userData blob)
// GET  ?key=todo            → 200 { value: <value or null> }
// POST { key, value }       → 200 { ok: true }                       (upsert single key)
// DELETE ?key=todo          → 200 { ok: true }                       (unset single key)
//
// Auth: requires session cookie. Returns 401 otherwise.
//
// Allowed keys: whitelisted to prevent arbitrary writes blowing up the doc.
// Per-key value size capped at ~512KB to keep MongoDB doc <16MB hard limit.
import { ObjectId } from 'mongodb';
import { readSession } from './_lib/session.js';
import { getUserData } from './_lib/mongo.js';

export const config = { maxDuration: 15 };

const ALLOWED_KEYS = new Set([
  'todo',         // se77n.todo.v2
  'aiHistory',    // se77n.ai.history.v2
  'aiPreset',     // se77n.ai.preset
  'vault',        // future digital vault entries
  'lang',         // se77n.lang
  'wardrobe',     // se77n.wardrobe.v1 — stylist items + outfit sets (metadata only)
]);

const MAX_VALUE_BYTES = 512 * 1024; // 512 KB per key

function isAllowedKey(k) { return typeof k === 'string' && ALLOWED_KEYS.has(k); }

export default async function handler(req, res) {
  const session = readSession(req);
  if (!session?.uid) return res.status(401).json({ error: 'unauthorized' });

  let oid;
  try { oid = new ObjectId(session.uid); } catch { return res.status(401).json({ error: 'unauthorized' }); }

  const coll = await getUserData();

  try {
    if (req.method === 'GET') {
      const key = req.query?.key;
      const doc = await coll.findOne({ _id: oid });
      if (key) {
        if (!isAllowedKey(key)) return res.status(400).json({ error: 'invalid_key' });
        return res.status(200).json({ value: doc?.[key] ?? null });
      }
      // Strip _id and meta from the response
      const { _id, updatedAt, createdAt, ...data } = doc || {};
      return res.status(200).json({ data });
    }

    if (req.method === 'POST' || req.method === 'PUT') {
      const { key, value } = req.body || {};
      if (!isAllowedKey(key)) return res.status(400).json({ error: 'invalid_key' });
      const size = Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
      if (size > MAX_VALUE_BYTES) {
        return res.status(413).json({ error: 'value_too_large', size, max: MAX_VALUE_BYTES });
      }
      const now = new Date();
      await coll.updateOne(
        { _id: oid },
        {
          $set: { [key]: value, updatedAt: now },
          $setOnInsert: { createdAt: now },
        },
        { upsert: true },
      );
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const key = req.query?.key;
      if (!isAllowedKey(key)) return res.status(400).json({ error: 'invalid_key' });
      await coll.updateOne(
        { _id: oid },
        { $unset: { [key]: '' }, $set: { updatedAt: new Date() } },
      );
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (e) {
    console.error('data api error', e);
    return res.status(500).json({ error: 'server_error' });
  }
}
