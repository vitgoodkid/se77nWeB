// GET /api/auth/me — returns current user (200 { user }) or { user: null }.
// Reads session cookie, looks up user in MongoDB.
import { ObjectId } from 'mongodb';
import { readSession } from '../_lib/session.js';
import { getUsers } from '../_lib/mongo.js';

export const config = { maxDuration: 10 };

export default async function handler(req, res) {
  const session = readSession(req);
  if (!session?.uid) return res.status(200).json({ user: null });

  try {
    const users = await getUsers();
    let oid;
    try { oid = new ObjectId(session.uid); } catch { return res.status(200).json({ user: null }); }
    const u = await users.findOne({ _id: oid });
    if (!u) return res.status(200).json({ user: null });

    return res.status(200).json({
      user: {
        id: u._id.toString(),
        provider: u.provider,
        displayName: u.displayName,
        username: u.username,
        email: u.email,
        avatarUrl: u.avatarUrl,
      },
    });
  } catch (e) {
    console.error('me error', e);
    return res.status(500).json({ error: 'lookup_failed' });
  }
}
