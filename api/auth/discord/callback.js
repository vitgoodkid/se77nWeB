// GET /api/auth/discord/callback
// Verifies state, exchanges code for token, fetches Discord user, upserts in MongoDB,
// sets session cookie, redirects to home.
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
    if (!verifyOAuthState(state, 'discord')) return fail('state_invalid');

    const clientId = process.env.DISCORD_CLIENT_ID;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;
    if (!clientId || !clientSecret) return fail('discord_not_configured');

    const redirectUri = `${baseUrl}/api/auth/discord/callback`;

    // Exchange code for access token
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
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

    // Fetch user
    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (!userRes.ok) return fail('user_fetch_failed');
    const dUser = await userRes.json();
    if (!dUser.id) return fail('no_user_id');

    // Discord avatars: https://cdn.discordapp.com/avatars/{user_id}/{user_avatar}.png
    const avatarUrl = dUser.avatar
      ? `https://cdn.discordapp.com/avatars/${dUser.id}/${dUser.avatar}.png?size=128`
      : null;

    // Upsert user
    const users = await getUsers();
    const now = new Date();
    const result = await users.findOneAndUpdate(
      { provider: 'discord', providerUserId: dUser.id },
      {
        $set: {
          email: dUser.email || null,
          username: dUser.username || null,
          displayName: dUser.global_name || dUser.username || 'Discord user',
          avatarUrl,
          lastLoginAt: now,
        },
        $setOnInsert: {
          provider: 'discord',
          providerUserId: dUser.id,
          createdAt: now,
        },
      },
      { upsert: true, returnDocument: 'after' },
    );

    const userDoc = result?.value || result; // mongodb 6: returns doc directly when returnDocument:'after'
    const uid = (userDoc?._id || result?.value?._id || result?.lastErrorObject?.upserted)?.toString();
    if (!uid) return fail('upsert_failed');

    const session = signSession({ uid, provider: 'discord' });

    res.setHeader('Set-Cookie', [
      buildSessionCookie(session),
      buildClearStateCookie(),
    ]);
    res.writeHead(302, { Location: homeUrl });
    res.end();
  } catch (e) {
    console.error('discord callback error', e);
    return fail('server_error');
  }
}
