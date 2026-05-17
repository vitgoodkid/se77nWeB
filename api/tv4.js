// /api/tv4 — unified CRUD for travel-v4 collections.
//
// Why one endpoint: Vercel Hobby has a function count limit, and the spec lists ~10 collections.
// Bundling keeps the surface tight and centralizes auth + validation.
//
// Query params:
//   c=<collection>   collection name (see api/_lib/tv4.js for whitelist)
//   id=<oid>         single-doc operations (GET one, PUT, DELETE)
//   tripId=<oid>     scope LIST to a trip (for pins, plan-items, transactions, etc.)
//   slug=<string>    GET one trip by slug (trips only)
//
// Methods:
//   GET    list (or one if id/slug provided)
//   POST   create
//   PUT    update by id (partial)
//   DELETE by id
//
// Auth: session cookie required. All per-user collections are scoped by userId.
// Settings is a singleton — POST/PUT both upsert the single document for the user.

import { ObjectId } from 'mongodb';
import { readSession } from './_lib/session.js';
import { getDb } from './_lib/mongo.js';
import {
  getSchema, listCollections, validate, ensureUniqueTripSlug,
  ensureIndexes, maybeOid, slugify,
} from './_lib/tv4.js';

export const config = { maxDuration: 15 };

let indexPromise = null;
function ensureIndexesOnce() {
  if (!indexPromise) {
    indexPromise = ensureIndexes().catch((e) => {
      indexPromise = null; // allow retry
      console.warn('tv4 index ensure failed', e?.message);
    });
  }
  return indexPromise;
}

export default async function handler(req, res) {
  const session = readSession(req);
  if (!session?.uid) return res.status(401).json({ error: 'unauthorized' });

  let userId;
  try { userId = new ObjectId(session.uid); } catch { return res.status(401).json({ error: 'unauthorized' }); }

  const c = req.query?.c;
  const schema = getSchema(c);
  if (!schema) return res.status(400).json({ error: 'invalid_collection', allowed: listCollections() });

  // Best-effort index creation — fire-and-forget, doesn't block first request.
  ensureIndexesOnce();

  const db = await getDb();
  const coll = db.collection(schema.coll);
  const baseFilter = schema.perUser ? { userId } : {};

  try {
    if (req.method === 'GET') return await onGet(req, res, { schema, coll, baseFilter, userId });
    if (req.method === 'POST') return await onCreate(req, res, { schema, coll, baseFilter, userId, c });
    if (req.method === 'PUT' || req.method === 'PATCH') return await onUpdate(req, res, { schema, coll, baseFilter });
    if (req.method === 'DELETE') return await onDelete(req, res, { schema, coll, baseFilter });
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (e) {
    console.error('tv4 api error', e);
    return res.status(500).json({ error: 'server_error' });
  }
}

async function onGet(req, res, { schema, coll, baseFilter }) {
  const { id, slug, tripId } = req.query;

  // Singleton settings: ignore id, return the single doc.
  if (schema.singleton) {
    const doc = await coll.findOne(baseFilter);
    return res.status(200).json({ doc: doc || null });
  }

  if (id) {
    const oid = maybeOid(id);
    if (!oid) return res.status(400).json({ error: 'bad_id' });
    const doc = await coll.findOne({ ...baseFilter, _id: oid });
    if (!doc) return res.status(404).json({ error: 'not_found' });
    return res.status(200).json({ doc });
  }

  if (slug) {
    const doc = await coll.findOne({ ...baseFilter, slug });
    if (!doc) return res.status(404).json({ error: 'not_found' });
    return res.status(200).json({ doc });
  }

  // List, optionally scoped by tripId.
  const filter = { ...baseFilter };
  if (tripId) {
    const oid = maybeOid(tripId);
    if (!oid) return res.status(400).json({ error: 'bad_tripId' });
    filter.tripId = oid;
  }
  const sort = pickSort(schema.coll);
  const docs = await coll.find(filter).sort(sort).limit(2000).toArray();
  return res.status(200).json({ docs });
}

async function onCreate(req, res, { schema, coll, baseFilter, userId, c }) {
  const body = req.body || {};

  // Settings is upsert-only — no separate "create".
  if (schema.singleton) {
    const { doc, error } = validate(schema, body, { partial: true });
    if (error) return res.status(400).json({ error });
    const now = new Date();
    await coll.updateOne(
      baseFilter,
      { $set: { ...doc, updatedAt: now }, $setOnInsert: { ...baseFilter, createdAt: now } },
      { upsert: true },
    );
    const fresh = await coll.findOne(baseFilter);
    return res.status(200).json({ doc: fresh });
  }

  const { doc, error } = validate(schema, body, { partial: false });
  if (error) return res.status(400).json({ error });

  const now = new Date();
  const insert = { ...doc, ...baseFilter, createdAt: now, updatedAt: now };

  // Trip slug uniqueness — auto-generate from title if missing.
  if (c === 'trips') {
    insert.slug = await ensureUniqueTripSlug(userId, doc.slug || doc.title);
  }

  const r = await coll.insertOne(insert);
  return res.status(200).json({ doc: { ...insert, _id: r.insertedId } });
}

async function onUpdate(req, res, { schema, coll, baseFilter }) {
  const body = req.body || {};

  if (schema.singleton) {
    const { doc, error } = validate(schema, body, { partial: true });
    if (error) return res.status(400).json({ error });
    const now = new Date();
    await coll.updateOne(
      baseFilter,
      { $set: { ...doc, updatedAt: now }, $setOnInsert: { ...baseFilter, createdAt: now } },
      { upsert: true },
    );
    const fresh = await coll.findOne(baseFilter);
    return res.status(200).json({ doc: fresh });
  }

  const id = req.query?.id;
  const oid = maybeOid(id);
  if (!oid) return res.status(400).json({ error: 'bad_id' });

  const { doc, error } = validate(schema, body, { partial: true });
  if (error) return res.status(400).json({ error });

  // Slug rewrite guard for trips — keep slug unique-per-user if title or slug changes.
  if (schema.coll === 'tv4_trips' && (doc.title || doc.slug)) {
    const current = await coll.findOne({ ...baseFilter, _id: oid }, { projection: { slug: 1 } });
    if (!current) return res.status(404).json({ error: 'not_found' });
    const desired = slugify(doc.slug || doc.title);
    if (desired && desired !== current.slug) {
      doc.slug = await ensureUniqueTripSlug(baseFilter.userId, desired);
    } else {
      delete doc.slug;
    }
  }

  const r = await coll.findOneAndUpdate(
    { ...baseFilter, _id: oid },
    { $set: { ...doc, updatedAt: new Date() } },
    { returnDocument: 'after' },
  );
  if (!r) return res.status(404).json({ error: 'not_found' });
  return res.status(200).json({ doc: r });
}

async function onDelete(req, res, { schema, coll, baseFilter }) {
  if (schema.singleton) {
    await coll.deleteOne(baseFilter);
    return res.status(200).json({ ok: true });
  }
  const id = req.query?.id;
  const oid = maybeOid(id);
  if (!oid) return res.status(400).json({ error: 'bad_id' });

  // Trip delete cascades to all child collections owned by the same user.
  if (schema.coll === 'tv4_trips') {
    const db = await getDb();
    await Promise.all([
      db.collection('tv4_pins').deleteMany({ ...baseFilter, tripId: oid }),
      db.collection('tv4_plan_items').deleteMany({ ...baseFilter, tripId: oid }),
      db.collection('tv4_checklist').deleteMany({ ...baseFilter, tripId: oid }),
      db.collection('tv4_reservations').deleteMany({ ...baseFilter, tripId: oid }),
      db.collection('tv4_transactions').deleteMany({ ...baseFilter, tripId: oid }),
      db.collection('tv4_notes').deleteMany({ ...baseFilter, tripId: oid }),
    ]);
  }

  const r = await coll.deleteOne({ ...baseFilter, _id: oid });
  if (!r.deletedCount) return res.status(404).json({ error: 'not_found' });
  return res.status(200).json({ ok: true });
}

function pickSort(collName) {
  switch (collName) {
    case 'tv4_trips':         return { startDate: -1, createdAt: -1 };
    case 'tv4_plan_items':    return { dayIndex: 1, order: 1, timeStart: 1 };
    case 'tv4_transactions':  return { date: -1, time: -1 };
    case 'tv4_pins':          return { dayIndex: 1, order: 1 };
    case 'tv4_reservations':  return { datetime: 1 };
    case 'tv4_notes':         return { dayIndex: 1, date: 1 };
    case 'tv4_fx_snapshots':  return { date: -1 };
    default:                  return { createdAt: -1 };
  }
}
