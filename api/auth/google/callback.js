// GET /api/auth/google/callback
// Verifies state, exchanges code, fetches Google userinfo, upserts in MongoDB,
// sets session cookie, redirects home.
import {
  signSession, verifyOAuthState, readStateCookie,
  buildSessionCookie, buildClearStateCookie, getBaseUrl,
} from '../../_lib/session.js';
import { getUsers } from '../../_lib/mongo.js';

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  const baseUrl = getBaseUrl(req);
  const homeUrl = baseUrl + '/';

  function fail(reason) {
    const url = new URL(homeUrl);
    url.searchParams.set('auth_error', reason);
    res.setHeader('Set-Cookie', buildClearStateCookie());
    res.writeHead(302, { Location: url.toString() });
    res.end();
  }

  try {
    const { code, state, error } = req.query || {};
    if (error) return fail(String(error));
    if (!code || !state) return fail('missing_code_or_state');

    const cookieState = readStateCookie(req);
    if (!cookieState || cookieState !== state) return fail('state_mismatch');
    if (!verifyOAuthState(state, 'google')) return fail('state_invalid');

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return fail('google_not_configured');

    const redirectUri = `${baseUrl}/api/auth/google/callback`;

    // Exchange code for token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: redirectUri,
      }),
    });
    if (!tokenRes.ok) return fail('token_exchange_failed');
    const token = await tokenRes.json();
    if (!token.access_token) return fail('no_access_token');

    // Fetch userinfo
    const userRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (!userRes.ok) return fail('user_fetch_failed');
    const gUser = await userRes.json();
    if (!gUser.sub) return fail('no_user_sub');

    // Upsert
    const users = await getUsers();
    const now = new Date();
    const result = await users.findOneAndUpdate(
      { provider: 'google', providerUserId: gUser.sub },
      {
        $set: {
          email: gUser.email || null,
          username: gUser.email ? gUser.email.split('@')[0] : null,
          displayName: gUser.name || gUser.email || 'Google user',
          avatarUrl: gUser.picture || null,
          lastLoginAt: now,
        },
        $setOnInsert: {
          provider: 'google',
          providerUserId: gUser.sub,
          createdAt: now,
        },
      },
      { upsert: true, returnDocument: 'after' },
    );

    const userDoc = result?.value || result;
    const uid = (userDoc?._id || result?.lastErrorObject?.upserted)?.toString();
    if (!uid) return fail('upsert_failed');

    const session = signSession({ uid, provider: 'google' });

    res.setHeader('Set-Cookie', [
      buildSessionCookie(session),
      buildClearStateCookie(),
    ]);
    res.writeHead(302, { Location: homeUrl });
    res.end();
  } catch (e) {
    console.error('google callback error', e);
    return fail('server_error');
  }
}
