// Cached MongoClient for Vercel serverless. Re-uses one TCP pool across invocations.
// `_lib` prefix → Vercel does NOT expose this as an HTTP route.
import { MongoClient } from 'mongodb';

const DB_NAME = 'se77n';
// KataS bot writes to a separate database in the same cluster (database path
// `katas` in its MONGODB_URI). /api/kata/* reads/writes there directly so the
// se77n.com auth + tv4 stack stays in its own namespace.
const KATA_DB_NAME = process.env.KATA_DB_NAME?.trim() || 'katas';

let cached = global.__se77nMongo;
if (!cached) cached = global.__se77nMongo = { client: null, promise: null };

export async function getDb() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI not configured');

  if (cached.client) return cached.client.db(DB_NAME);

  if (!cached.promise) {
    cached.promise = MongoClient.connect(uri, {
      maxPoolSize: 5,
      serverSelectionTimeoutMS: 8000,
    }).then(async (c) => {
      cached.client = c;
      // Idempotent indexes — cheap on every cold start, MongoDB no-ops if exists.
      try {
        await c.db(DB_NAME).collection('users').createIndex(
          { provider: 1, providerUserId: 1 },
          { unique: true, name: 'provider_user_unique' },
        );
      } catch { /* index race on cold-start parallel — ignore */ }
      return c;
    }).catch((err) => {
      cached.promise = null; // allow retry on next call
      throw err;
    });
  }

  const c = await cached.promise;
  return c.db(DB_NAME);
}

export async function getUsers() { return (await getDb()).collection('users'); }
export async function getUserData() { return (await getDb()).collection('userData'); }

// Read-only handle on the KataS bot database. Same MongoClient pool — only the
// db namespace differs.
export async function getKataDb() {
  await getDb(); // ensure cached.client is initialized
  return cached.client.db(KATA_DB_NAME);
}
