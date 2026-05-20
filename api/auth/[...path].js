// Catch-all auth route for /api/auth/*.
// Also serves /api/kata/* via vercel.json rewrite to /api/auth/__kata__?kataPath=*
// — keeps us under Vercel Hobby's 12-function cap by sharing one handler.
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
import { getUsers, getKataDb } from '../_lib/mongo.js';

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

    // Owner gate for the History feature: matches FEED_WHITELIST_EMAILS plus
    // PUBLIC_TECH_OWNER_EMAIL (case-insensitive). Surfaced as a boolean so the
    // client can hide the nav entry without leaking the whitelist.
    const userEmail = (u.email || '').trim().toLowerCase();
    const ownerEmail = process.env.PUBLIC_TECH_OWNER_EMAIL?.trim()?.toLowerCase();
    const whitelist = (process.env.FEED_WHITELIST_EMAILS || '')
      .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    const isHistoryOwner = !!userEmail && (
      userEmail === ownerEmail || whitelist.includes(userEmail)
    );

    return res.status(200).json({
      user: {
        id: u._id.toString(),
        provider: u.provider,
        providerUserId: u.providerUserId,
        displayName: u.displayName,
        username: u.username,
        email: u.email,
        avatarUrl: u.avatarUrl,
        isHistoryOwner,
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
  const redirectUri = getOAuthRedirectUri(req, provider);
  const url = new URL(isGoogle
    ? 'https://accounts.google.com/o/oauth2/v2/auth'
    : 'https://discord.com/oauth2/authorize');

  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  // Discord scope `guilds` is required by /kata to list servers the user can
  // manage. Bumping the scope forces existing users to re-authorize on next
  // login — Discord will prompt automatically.
  url.searchParams.set('scope', isGoogle ? 'openid email profile' : 'identify email guilds');
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
    const redirectUri = getOAuthRedirectUri(req, provider);
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
          // Stash Discord OAuth token for /api/kata to call /users/@me/guilds.
          // Cleared on Google login so Google users never expose a stale Discord token.
          ...(isGoogle ? {
            discordAccessToken: null,
            discordTokenExpiresAt: null,
          } : {
            discordAccessToken: token.access_token,
            discordTokenExpiresAt: token.expires_in
              ? new Date(Date.now() + token.expires_in * 1000)
              : null,
          }),
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

function getOAuthRedirectUri(req, provider) {
  const configured = env(provider === 'google' ? 'GOOGLE_REDIRECT_URI' : 'DISCORD_REDIRECT_URI');
  return configured || `${getBaseUrl(req)}/api/auth/${provider}/callback`;
}

export default async function handler(req, res) {
  const path = getPath(req);

  // /api/kata/* — multiplexed via vercel.json rewrite (kataPath query param).
  if (path === '__kata__' || (req.query && 'kataPath' in req.query)) {
    return handleKata(req, res);
  }

  if (path === 'me') return handleMe(req, res);
  if (path === 'logout') return handleLogout(req, res);
  if (path === 'google-start' || path === 'google/start') return handleOAuthStart(req, res, 'google');
  if (path === 'discord-start' || path === 'discord/start') return handleOAuthStart(req, res, 'discord');
  if (path === 'google-callback' || path === 'google/callback') return handleOAuthCallback(req, res, 'google');
  if (path === 'discord-callback' || path === 'discord/callback') return handleOAuthCallback(req, res, 'discord');

  return res.status(404).json({ error: 'not_found' });
}

// ── /api/kata/* router ──────────────────────────────────────────
//
// Phase 11 surface (foundation only):
//   GET /api/kata/me           → user profile + manageable guilds where bot is installed
//
// Phase 12+ will add: /api/kata/server/[id], /api/kata/server/[id]/config (PATCH), etc.

const DISCORD_PERM_MANAGE_GUILD = 0x20n;

async function handleKata(req, res) {
  const raw = req.query?.kataPath;
  const kataPath = (Array.isArray(raw) ? raw.join('/') : String(raw || ''))
    .replace(/^\/+|\/+$/g, '');

  if (kataPath === 'me') return handleKataMe(req, res);

  return res.status(404).json({ error: 'not_found', path: kataPath });
}

async function handleKataMe(req, res) {
  const session = readSession(req);
  if (!session?.uid) return res.status(401).json({ error: 'unauthenticated' });

  let userOid;
  try { userOid = new ObjectId(session.uid); }
  catch { return res.status(401).json({ error: 'bad_session' }); }

  const users = await getUsers();
  const user = await users.findOne({ _id: userOid });
  if (!user) return res.status(401).json({ error: 'user_not_found' });
  if (user.provider !== 'discord') {
    return res.status(403).json({ error: 'discord_required', message: 'Sign in with Discord to use /kata' });
  }
  if (!user.discordAccessToken) {
    // Old session pre-dating the guilds scope upgrade.
    return res.status(403).json({ error: 'reauth_required', message: 'Please log out and sign in with Discord again' });
  }

  // Pull user's guild list from Discord. Discord returns up to 200 guilds in
  // a single call; we don't paginate yet (assumption: a single user in 200+
  // servers is rare and wouldn't be served well by this list view anyway).
  let userGuilds;
  try {
    const r = await fetch('https://discord.com/api/v10/users/@me/guilds', {
      headers: { Authorization: `Bearer ${user.discordAccessToken}` },
    });
    if (r.status === 401) {
      return res.status(403).json({ error: 'reauth_required', message: 'Discord token expired — please sign in again' });
    }
    if (!r.ok) {
      console.error('discord guilds fetch failed', r.status, await r.text().catch(() => ''));
      return res.status(502).json({ error: 'discord_unavailable' });
    }
    userGuilds = await r.json();
  } catch (e) {
    console.error('discord guilds fetch error', e);
    return res.status(502).json({ error: 'discord_unavailable' });
  }

  // Cross-reference with bot's known guilds (servers collection in the KataS
  // bot database — written when the bot joins a guild).
  const kataDb = await getKataDb();
  const botGuildIds = new Set(
    (await kataDb.collection('servers').find({ isActive: true }, { projection: { guildId: 1 } }).toArray())
      .map((s) => s.guildId),
  );

  const owner = process.env.OWNER_DISCORD_ID?.trim() || '397342895327150080';
  const isOwner = user.providerUserId === owner;

  const managed = [];
  const canInvite = [];
  for (const g of userGuilds) {
    // Discord returns permissions as a string in v10 (snowflake-safe).
    let perms = 0n;
    try { perms = BigInt(g.permissions || '0'); } catch { /* keep 0 */ }
    const canManage = (perms & DISCORD_PERM_MANAGE_GUILD) !== 0n || g.owner === true || isOwner;
    if (!canManage) continue;

    const entry = {
      id: g.id,
      name: g.name,
      iconUrl: g.icon
        ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=128`
        : null,
      isOwner: !!g.owner,
    };
    if (botGuildIds.has(g.id)) managed.push(entry);
    else canInvite.push(entry);
  }

  return res.status(200).json({
    user: {
      id: user._id.toString(),
      providerUserId: user.providerUserId,
      displayName: user.displayName,
      username: user.username,
      avatarUrl: user.avatarUrl,
      isOwner,
    },
    managed,
    canInvite,
    counts: {
      managed: managed.length,
      canInvite: canInvite.length,
      botTotal: botGuildIds.size,
    },
  });
}
