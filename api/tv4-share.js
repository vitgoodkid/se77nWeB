// /api/tv4-share — read-only trip sharing via short hash.
//
// POST body={ tripId, expiryDays }  (auth required) → 200 { hash, url, expiresAt }
//   Snapshots the trip + its pins/plan/transactions/notes into tv4_shares.
//
// GET  ?hash=xxx                     (NO AUTH) → 200 { snapshot, expiresAt }
//   Returns the snapshot for read-only viewing.
//
// Note: share docs DO carry a userId for analytics + revocation, but GET path is
// auth-less by design so anyone with the link can read.

import { ObjectId } from 'mongodb';
import crypto from 'crypto';
import { readSession } from './_lib/session.js';
import { getDb } from './_lib/mongo.js';

export const config = { maxDuration: 15 };

const COLL = 'tv4_shares';

function shortHash() {
  // 9 chars of base36 ≈ 47 bits, plenty for share tokens.
  return crypto.randomBytes(8).toString('base64url').slice(0, 9).replace(/[^A-Za-z0-9]/g, '0');
}

export default async function handler(req, res) {
  const db = await getDb();
  const coll = db.collection(COLL);

  try {
    if (req.method === 'GET') {
      const hash = req.query?.hash;
      if (!hash || hash.length > 32) return res.status(400).json({ error: 'bad_hash' });
      const doc = await coll.findOne({ hash });
      if (!doc) return res.status(404).json({ error: 'not_found' });
      if (doc.expiresAt && new Date(doc.expiresAt) < new Date()) {
        return res.status(410).json({ error: 'expired' });
      }
      return res.status(200).json({
        snapshot: doc.snapshot,
        expiresAt: doc.expiresAt || null,
      });
    }

    const session = readSession(req);
    if (!session?.uid) return res.status(401).json({ error: 'unauthorized' });
    const userId = new ObjectId(session.uid);

    if (req.method === 'POST') {
      const { tripId, expiryDays } = req.body || {};
      if (!tripId) return res.status(400).json({ error: 'tripId_required' });
      let tripOid;
      try { tripOid = new ObjectId(tripId); } catch { return res.status(400).json({ error: 'bad_tripId' }); }

      const trip = await db.collection('tv4_trips').findOne({ _id: tripOid, userId });
      if (!trip) return res.status(404).json({ error: 'trip_not_found' });

      const [pins, planItems, transactions, notes, reservations, checklist] = await Promise.all([
        db.collection('tv4_pins').find({ userId, tripId: tripOid }).toArray(),
        db.collection('tv4_plan_items').find({ userId, tripId: tripOid }).toArray(),
        db.collection('tv4_transactions').find({ userId, tripId: tripOid }).toArray(),
        db.collection('tv4_notes').find({ userId, tripId: tripOid }).toArray(),
        db.collection('tv4_reservations').find({ userId, tripId: tripOid }).toArray(),
        db.collection('tv4_checklist').find({ userId, tripId: tripOid }).toArray(),
      ]);

      const hash = shortHash();
      let expiresAt = null;
      if (expiryDays && Number(expiryDays) > 0) {
        expiresAt = new Date(Date.now() + Number(expiryDays) * 86400_000);
      }
      const doc = {
        hash, userId,
        snapshot: { trip, pins, planItems, transactions, notes, reservations, checklist },
        expiresAt,
        createdAt: new Date(),
      };
      await coll.insertOne(doc);

      // Build full URL based on request host.
      const proto = req.headers['x-forwarded-proto'] || 'https';
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      const base = process.env.AUTH_BASE_URL || `${proto}://${host}`;
      const url = `${base}/?share=${hash}`;

      return res.status(200).json({ hash, url, expiresAt });
    }

    if (req.method === 'DELETE') {
      const hash = req.query?.hash;
      if (!hash) return res.status(400).json({ error: 'hash_required' });
      const r = await coll.deleteOne({ hash, userId });
      if (!r.deletedCount) return res.status(404).json({ error: 'not_found' });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (e) {
    console.error('tv4-share api error', e);
    return res.status(500).json({ error: 'server_error' });
  }
}
