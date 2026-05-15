// Catch-all auth route for /api/auth/*.
// Keeps the public OAuth URLs stable while staying under Vercel Hobby's
// serverless function limit.
import { ObjectId } from 'mongodb';
import {
  signSession,
  signOAuthState,
  verifyOAuthState,
  readSession,
  readStateCookie,
  buildSessionCookie,
  buildClearSessionCookie,
  buildStateCookie,
  buildClearStateCookie,
  getBaseUrl,
} from '../_lib/session.js';
import { getUsers } from '../_lib/mongo.js';

export const config = { maxDuration: 60 };

function env(name) {
  return process.env[name]?.trim();
}

function getPath(req) {
  const raw = req.query?.path ?? req.query?.slug ?? req.query?.['...path'];
  const fromQuery = Array.isArray(raw) ? raw.join('/') : String(raw || '');
  if (fromQuery) return fromQuery.replace(/^\/+|\/+$/g, '');

  const pathname = new URL(req.url || '', 'https://se77n.local').pathname;
  return pathname.replace(/^\/api\/auth\/?/, '').replace(/^\/+|\/+$/g, '');
}

function redirect(res, location, cookies) {
  if (cookies) res.setHeader('Set-Cookie', cookies);
  res.writeHead(302, { Location: location });
  res.end();
}

function failAuth(req, res, reason) {
  const url = new URL(getBaseUrl(req) + '/');
  url.searchParams.set('auth_error', reason);
  return redirect(res, url.toString(), buildClearStateCookie());
}

async function handleMe(req, res) {
  const session = readSession(req);
  if (!session?.uid) return res.status(200).json({ user: null });

  try {
    let oid;
    try { oid = new ObjectId(session.uid); } catch { return res.status(200).json({ user: null }); }
    const u = await (await getUsers()).findOne({ _id: oid });
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

function handleLogout(req, res) {
  res.setHeader('Set-Cookie', buildClearSessionCookie());
  return res.status(200).json({ ok: true });
}

function handleOAuthStart(req, res, provider) {
  const isGoogle = provider === 'google';
  const clientId = env(isGoogle ? 'GOOGLE_CLIENT_ID' : 'DISCORD_CLIENT_ID');
  if (!clientId) return res.status(500).json({ error: `${isGoogle ? 'GOOGLE' : 'DISCORD'}_CLIENT_ID not configured` });

  const state = signOAuthState(provider);
  const redirectUri = `${getBaseUrl(req)}/api/auth/${provider}/callback`;
  const url = new URL(isGoogle
    ? 'https://accounts.google.com/o/oauth2/v2/auth'
    : 'https://discord.com/api/oauth2/authorize');

  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', isGoogle ? 'openid email profile' : 'identify email');
  url.searchParams.set('state', state);
  if (isGoogle) {
    url.searchParams.set('access_type', 'online');
    url.searchParams.set('prompt', 'select_account');
  }

  return redirect(res, url.toString(), buildStateCookie(state));
}

async function handleOAuthCallback(req, res, provider) {
  const { code, state, error } = req.query || {};
  if (error) return failAuth(req, res, String(error));
  if (!code || !state) return failAuth(req, res, 'missing_code_or_state');

  const cookieState = readStateCookie(req);
  if (!cookieState || cookieState !== state) return failAuth(req, res, 'state_mismatch');
  if (!verifyOAuthState(state, provider)) return failAuth(req, res, 'state_invalid');

  const isGoogle = provider === 'google';
  const baseUrl = getBaseUrl(req);
  const clientId = env(isGoogle ? 'GOOGLE_CLIENT_ID' : 'DISCORD_CLIENT_ID');
  const clientSecret = env(isGoogle ? 'GOOGLE_CLIENT_SECRET' : 'DISCORD_CLIENT_SECRET');
  if (!clientId || !clientSecret) return failAuth(req, res, `${provider}_not_configured`);

  try {
    const redirectUri = `${baseUrl}/api/auth/${provider}/callback`;
    const tokenRes = await fetch(isGoogle ? 'https://oauth2.googleapis.com/token' : 'https://discord.com/api/oauth2/token', {
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
    if (!tokenRes.ok) return failAuth(req, res, 'token_exchange_failed');
    const token = await tokenRes.json();
    if (!token.access_token) return failAuth(req, res, 'no_access_token');

    const userRes = await fetch(
      isGoogle ? 'https://openidconnect.googleapis.com/v1/userinfo' : 'https://discord.com/api/users/@me',
      { headers: { Authorization: `Bearer ${token.access_token}` } },
    );
    if (!userRes.ok) return failAuth(req, res, 'user_fetch_failed');
    const remoteUser = await userRes.json();

    const now = new Date();
    const users = await getUsers();
    const filter = isGoogle
      ? { provider: 'google', providerUserId: remoteUser.sub }
      : { provider: 'discord', providerUserId: remoteUser.id };
    if (!filter.providerUserId) return failAuth(req, res, isGoogle ? 'no_user_sub' : 'no_user_id');

    const avatarUrl = isGoogle
      ? (remoteUser.picture || null)
      : (remoteUser.avatar
          ? `https://cdn.discordapp.com/avatars/${remoteUser.id}/${remoteUser.avatar}.png?size=128`
          : null);

    const result = await users.findOneAndUpdate(
      filter,
      {
        $set: {
          email: remoteUser.email || null,
          username: isGoogle
            ? (remoteUser.email ? remoteUser.email.split('@')[0] : null)
            : (remoteUser.username || null),
          displayName: isGoogle
            ? (remoteUser.name || remoteUser.email || 'Google user')
            : (remoteUser.global_name || remoteUser.username || 'Discord user'),
          avatarUrl,
          lastLoginAt: now,
        },
        $setOnInsert: {
          ...filter,
          createdAt: now,
        },
      },
      { upsert: true, returnDocument: 'after' },
    );

    const userDoc = result?.value || result;
    const uid = (userDoc?._id || result?.lastErrorObject?.upserted)?.toString();
    if (!uid) return failAuth(req, res, 'upsert_failed');

    return redirect(res, baseUrl + '/', [
      buildSessionCookie(signSession({ uid, provider })),
      buildClearStateCookie(),
    ]);
  } catch (e) {
    console.error(`${provider} callback error`, e);
    return failAuth(req, res, 'server_error');
  }
}

export default async function handler(req, res) {
  const path = getPath(req);

  if (path === 'me') return handleMe(req, res);
  if (path === 'logout') return handleLogout(req, res);
  if (path === 'google-start' || path === 'google/start') return handleOAuthStart(req, res, 'google');
  if (path === 'discord-start' || path === 'discord/start') return handleOAuthStart(req, res, 'discord');
  if (path === 'google-callback' || path === 'google/callback') return handleOAuthCallback(req, res, 'google');
  if (path === 'discord-callback' || path === 'discord/callback') return handleOAuthCallback(req, res, 'discord');

  return res.status(404).json({ error: 'not_found' });
}
