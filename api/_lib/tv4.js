// travel-v4 schema + helpers. All data is per-user; collections are prefixed `tv4_`.
// Validation strategy: whitelist allowed fields per collection and coerce types where safe.
// Anything not listed in `fields` is dropped silently (callers don't get to write arbitrary keys).

import { ObjectId } from 'mongodb';
import { getDb } from './mongo.js';

// Per-collection field whitelist. The handler trusts these and drops everything else.
// `kind` is a hint for shape (string|number|bool|date|object|array|oid|enum).
// `enum` arrays narrow string values.
// Required-on-create fields are listed in `required`.
const SCHEMAS = {
  trips: {
    coll: 'tv4_trips',
    perUser: true,
    fields: {
      slug:          { kind: 'string' },
      title:         { kind: 'string' },
      status:        { kind: 'enum', enum: ['planned', 'ongoing', 'visited'] },
      startDate:     { kind: 'string' },   // ISO yyyy-mm-dd
      endDate:       { kind: 'string' },
      country:       { kind: 'string' },
      region:        { kind: 'enum', enum: ['SEA', 'NEA', 'EU', 'NA', 'OCEANIA', 'SA', 'AF', 'ME', 'OTHER'] },
      tags:          { kind: 'array' },
      baseCurrency:  { kind: 'string' },
      tripCurrency:  { kind: 'string' },
      budget:        { kind: 'object' },    // { total, daily }
      homeBase:      { kind: 'object' },    // { lat, lng, name }
      cover:         { kind: 'object' },    // { type, seed }
      bestOf:        { kind: 'array' },     // [{ label, value }]
      archived:      { kind: 'bool' },
      planStage:     { kind: 'enum', enum: ['drafting', 'booked', 'locked'] }, // sub-status for status='planned'
    },
    required: ['title', 'status'],
  },
  pins: {
    coll: 'tv4_pins',
    perUser: true,
    fields: {
      tripId:   { kind: 'oid' },
      name:     { kind: 'string' },
      lat:      { kind: 'number' },
      lng:      { kind: 'number' },
      type:     { kind: 'enum', enum: ['see', 'eat', 'move', 'stay', 'other', 'wishlist', 'ongoing'] },
      dayIndex: { kind: 'number' },
      estCost:  { kind: 'number' },
      currency: { kind: 'string' },
      notes:    { kind: 'string' },
      order:    { kind: 'number' },
    },
    required: ['tripId', 'name', 'lat', 'lng'],
  },
  'plan-items': {
    coll: 'tv4_plan_items',
    perUser: true,
    fields: {
      tripId:      { kind: 'oid' },
      dayIndex:    { kind: 'number' },
      timeStart:   { kind: 'string' },    // HH:mm
      timeEnd:     { kind: 'string' },
      pinId:       { kind: 'oid' },
      title:       { kind: 'string' },
      type:        { kind: 'enum', enum: ['see', 'eat', 'move', 'stay', 'other'] },
      bookingRef:  { kind: 'string' },
      url:         { kind: 'string' },
      estCost:     { kind: 'number' },
      currency:    { kind: 'string' },
      status:      { kind: 'enum', enum: ['planned', 'done', 'skipped'] },
      order:       { kind: 'number' },
      notes:       { kind: 'string' },
    },
    required: ['tripId', 'title'],
  },
  checklist: {
    coll: 'tv4_checklist',
    perUser: true,
    fields: {
      tripId:        { kind: 'oid' },
      text:          { kind: 'string' },
      done:          { kind: 'bool' },
      dueOffsetDays: { kind: 'number' },
      category:      { kind: 'enum', enum: ['docs', 'money', 'pack', 'other'] },
    },
    required: ['tripId', 'text'],
  },
  reservations: {
    coll: 'tv4_reservations',
    perUser: true,
    fields: {
      tripId:      { kind: 'oid' },
      type:        { kind: 'enum', enum: ['flight', 'hotel', 'restaurant', 'other'] },
      name:        { kind: 'string' },
      code:        { kind: 'string' },
      datetime:    { kind: 'string' },
      endDatetime: { kind: 'string' },
      notes:       { kind: 'string' },
      url:         { kind: 'string' },
    },
    required: ['tripId', 'type'],
  },
  transactions: {
    coll: 'tv4_transactions',
    perUser: true,
    fields: {
      tripId:           { kind: 'oid' },
      date:             { kind: 'string' },
      time:             { kind: 'string' },
      category:         { kind: 'string' },
      customCategory:   { kind: 'string' },
      name:             { kind: 'string' },
      amount:           { kind: 'number' },
      currency:         { kind: 'string' },
      method:           { kind: 'enum', enum: ['cash', 'card', 'ic', 'transfer'] },
      paidBy:           { kind: 'string' },
      pinId:            { kind: 'oid' },
      notes:            { kind: 'string' },
      recurringGroupId: { kind: 'string' },
    },
    required: ['tripId', 'amount', 'currency'],
  },
  notes: {
    coll: 'tv4_notes',
    perUser: true,
    fields: {
      tripId:   { kind: 'oid' },
      dayIndex: { kind: 'number' },
      date:     { kind: 'string' },
      content:  { kind: 'string' },
      pinId:    { kind: 'oid' },
    },
    required: ['tripId'],
  },
  settings: {
    // singleton per user — handler short-circuits to upsert-by-userId
    coll: 'tv4_settings',
    perUser: true,
    singleton: true,
    fields: {
      homeBase:           { kind: 'object' },
      baseCurrency:       { kind: 'string' },
      distanceUnit:       { kind: 'enum', enum: ['km', 'mi'] },
      fxAutoRefresh:      { kind: 'bool' },
      customCategories:   { kind: 'array' },
      tripmates:          { kind: 'array' },
    },
    required: [],
  },
  templates: {
    coll: 'tv4_templates',
    perUser: true,
    fields: {
      name:       { kind: 'string' },
      fromTripId: { kind: 'oid' },
      planItems:  { kind: 'array' },
      pins:       { kind: 'array' },
      checklist:  { kind: 'array' },
    },
    required: ['name'],
  },
  'fx-snapshots': {
    // shared/global, not per-user. Anyone authenticated can read; writes are server-side only.
    coll: 'tv4_fx_snapshots',
    perUser: false,
    fields: {
      date:  { kind: 'string' },   // ISO yyyy-mm-dd, used as natural key
      base:  { kind: 'string' },
      rates: { kind: 'object' },
    },
    required: ['date', 'base', 'rates'],
  },
};

export function getSchema(name) {
  return SCHEMAS[name] || null;
}

export function listCollections() {
  return Object.keys(SCHEMAS);
}

// Coerce + whitelist incoming body against a schema. Drops unknown keys.
// Returns { doc, error }. On error, doc is null.
export function validate(schema, body, { partial = false } = {}) {
  if (!body || typeof body !== 'object') return { doc: null, error: 'body_required' };
  const out = {};
  for (const [key, def] of Object.entries(schema.fields)) {
    if (!(key in body)) continue;
    const v = body[key];
    if (v === null) { out[key] = null; continue; }
    const coerced = coerce(v, def);
    if (coerced.error) return { doc: null, error: `field:${key}:${coerced.error}` };
    out[key] = coerced.value;
  }
  if (!partial) {
    for (const req of schema.required || []) {
      if (out[req] === undefined || out[req] === null || out[req] === '') {
        return { doc: null, error: `missing:${req}` };
      }
    }
  }
  return { doc: out, error: null };
}

function coerce(v, def) {
  switch (def.kind) {
    case 'string':
      if (typeof v !== 'string') return { error: 'not_string' };
      if (v.length > 8000) return { error: 'too_long' };
      return { value: v };
    case 'number':
      if (typeof v === 'string') v = Number(v);
      if (typeof v !== 'number' || !Number.isFinite(v)) return { error: 'not_number' };
      return { value: v };
    case 'bool':
      return { value: !!v };
    case 'date':
      if (typeof v !== 'string') return { error: 'not_date' };
      return { value: v };
    case 'enum':
      if (!def.enum.includes(v)) return { error: 'not_in_enum' };
      return { value: v };
    case 'object':
      if (typeof v !== 'object' || Array.isArray(v)) return { error: 'not_object' };
      return { value: v };
    case 'array':
      if (!Array.isArray(v)) return { error: 'not_array' };
      return { value: v };
    case 'oid':
      try { return { value: new ObjectId(v) }; } catch { return { error: 'bad_oid' }; }
    default:
      return { error: 'unknown_kind' };
  }
}

// Slug helper for trips. Used at create time. ASCII-safe, dash-separated, max 60 chars.
export function slugify(s) {
  if (!s) return '';
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// Returns a slug guaranteed unique for the given user.
export async function ensureUniqueTripSlug(userId, base) {
  const root = slugify(base) || 'trip';
  const db = await getDb();
  const coll = db.collection(SCHEMAS.trips.coll);
  let candidate = root;
  let i = 2;
  while (await coll.findOne({ userId, slug: candidate }, { projection: { _id: 1 } })) {
    candidate = `${root}-${i++}`;
    if (i > 999) return `${root}-${Date.now().toString(36)}`;
  }
  return candidate;
}

export async function ensureIndexes() {
  const db = await getDb();
  // Idempotent — Mongo no-ops if the index already exists.
  await Promise.all([
    db.collection('tv4_trips').createIndex({ userId: 1, slug: 1 }, { unique: true, name: 'user_slug_unique' }),
    db.collection('tv4_trips').createIndex({ userId: 1, status: 1, startDate: -1 }, { name: 'user_status_start' }),
    db.collection('tv4_pins').createIndex({ userId: 1, tripId: 1 }, { name: 'user_trip' }),
    db.collection('tv4_plan_items').createIndex({ userId: 1, tripId: 1, dayIndex: 1, order: 1 }, { name: 'user_trip_day' }),
    db.collection('tv4_checklist').createIndex({ userId: 1, tripId: 1 }, { name: 'user_trip' }),
    db.collection('tv4_reservations').createIndex({ userId: 1, tripId: 1, datetime: 1 }, { name: 'user_trip_dt' }),
    db.collection('tv4_transactions').createIndex({ userId: 1, tripId: 1, date: -1 }, { name: 'user_trip_date' }),
    db.collection('tv4_notes').createIndex({ userId: 1, tripId: 1, dayIndex: 1 }, { name: 'user_trip_day' }),
    db.collection('tv4_settings').createIndex({ userId: 1 }, { unique: true, name: 'user_unique' }),
    db.collection('tv4_templates').createIndex({ userId: 1, name: 1 }, { name: 'user_name' }),
    db.collection('tv4_fx_snapshots').createIndex({ date: -1, base: 1 }, { name: 'date_base' }),
  ]);
}

export function maybeOid(s) {
  if (!s || typeof s !== 'string') return null;
  try { return new ObjectId(s); } catch { return null; }
}
