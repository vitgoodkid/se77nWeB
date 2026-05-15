// POST /api/auth/logout — clears session cookie. (Also accepts GET for /logout link UX.)
import { buildClearSessionCookie } from '../_lib/session.js';

export default function handler(req, res) {
  res.setHeader('Set-Cookie', buildClearSessionCookie());
  return res.status(200).json({ ok: true });
}
