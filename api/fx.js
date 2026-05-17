// /api/fx — daily FX snapshot. Source: exchangerate.host (free, no key).
// Caches today's snapshot in Mongo (tv4_fx_snapshots, shared across all users).
//
// GET ?base=USD                       → 200 { snapshot: { date, base, rates } }
// POST body={ base, rates }            → 200 { snapshot }   (manual override for current day)
//
// Auth: session cookie required (any signed-in user can read or override).

import { readSession } from './_lib/session.js';
import { getDb } from './_lib/mongo.js';

export const config = { maxDuration: 15 };

const COLL = 'tv4_fx_snapshots';
const ALLOWED_BASES = new Set(['USD', 'EUR', 'GBP', 'JPY', 'KRW', 'TWD', 'VND', 'CNY', 'THB', 'SGD', 'AUD', 'CAD']);

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

async function fetchFromUpstream(base) {
  // exchangerate.host's /latest endpoint returns { base, rates: { CCY: rate, ... } }.
  // No key, ~free. If it fails, fall back to frankfurter.app.
  const tryUrls = [
    `https://api.exchangerate.host/latest?base=${encodeURIComponent(base)}`,
    `https://api.frankfurter.app/latest?from=${encodeURIComponent(base)}`,
  ];
  for (const url of tryUrls) {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!r.ok) continue;
      const j = await r.json();
      const rates = j.rates || j.conversion_rates || null;
      if (rates && typeof rates === 'object' && Object.keys(rates).length) {
        return { rates, source: url };
      }
    } catch (e) {
      // try next
    }
  }
  return null;
}

export default async function handler(req, res) {
  const session = readSession(req);
  if (!session?.uid) return res.status(401).json({ error: 'unauthorized' });

  const base = ((req.query?.base || req.body?.base || 'USD') + '').toUpperCase();
  if (!ALLOWED_BASES.has(base)) return res.status(400).json({ error: 'invalid_base' });

  const db = await getDb();
  const coll = db.collection(COLL);

  try {
    if (req.method === 'POST' || req.method === 'PUT') {
      const rates = req.body?.rates;
      if (!rates || typeof rates !== 'object') return res.status(400).json({ error: 'rates_required' });
      const date = todayISO();
      const doc = { date, base, rates, source: 'manual', updatedAt: new Date() };
      await coll.updateOne({ date, base }, { $set: doc }, { upsert: true });
      const fresh = await coll.findOne({ date, base });
      return res.status(200).json({ snapshot: fresh });
    }

    if (req.method === 'GET') {
      const date = todayISO();
      // Look for today first; fall back to most recent.
      let snap = await coll.findOne({ date, base });
      if (!snap) {
        const upstream = await fetchFromUpstream(base);
        if (upstream) {
          const doc = { date, base, rates: upstream.rates, source: upstream.source, updatedAt: new Date() };
          await coll.updateOne({ date, base }, { $set: doc }, { upsert: true });
          snap = await coll.findOne({ date, base });
        }
      }
      if (!snap) snap = await coll.findOne({ base }, { sort: { date: -1 } });
      return res.status(200).json({ snapshot: snap || null });
    }

    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (e) {
    console.error('fx api error', e);
    return res.status(500).json({ error: 'server_error' });
  }
}
