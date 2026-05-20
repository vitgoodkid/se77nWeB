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
import { publish as redisPublish } from '../_lib/redis.js';

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

  // /api/kata/server/:guildId  → GET overview + config
  // /api/kata/server/:guildId/config (PATCH) → write config + redis publish
  // /api/kata/server/:guildId/logs?type=… (GET) → paginated logs
  const serverMatch = kataPath.match(/^server\/([0-9]+)(?:\/(config|logs))?$/);
  if (serverMatch) {
    const [, guildId, sub] = serverMatch;
    if (sub === 'config' && req.method === 'PATCH') {
      return handleKataServerConfigPatch(req, res, guildId);
    }
    if (sub === 'logs' && req.method === 'GET') {
      return handleKataServerLogs(req, res, guildId);
    }
    if (!sub && req.method === 'GET') {
      return handleKataServerGet(req, res, guildId);
    }
    return res.status(405).json({ error: 'method_not_allowed' });
  }

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

// ── Permission gate for per-server endpoints ────────────────────
//
// Returns { user, isAuthorized, reason? }. A guild is authorized when:
//   1. The user signed in with Discord and we have a non-expired access token
//   2. Their /users/@me/guilds list includes this guildId AND
//      they have MANAGE_GUILD on it OR are guild owner OR are KataS bot owner
//   3. The bot's `servers` collection has the guild marked active
//
// We re-check (2) on every request rather than trusting a cached session bit
// because Discord roles/permissions change without our knowledge.

async function authorizeGuildAccess(req, guildId) {
  const session = readSession(req);
  if (!session?.uid) return { error: 'unauthenticated', status: 401 };

  let userOid;
  try { userOid = new ObjectId(session.uid); }
  catch { return { error: 'bad_session', status: 401 }; }

  const users = await getUsers();
  const user = await users.findOne({ _id: userOid });
  if (!user) return { error: 'user_not_found', status: 401 };
  if (user.provider !== 'discord') return { error: 'discord_required', status: 403 };
  if (!user.discordAccessToken) return { error: 'reauth_required', status: 403 };

  const owner = process.env.OWNER_DISCORD_ID?.trim() || '397342895327150080';
  const isOwner = user.providerUserId === owner;

  // Verify the bot is in this guild before doing anything else.
  const kataDb = await getKataDb();
  const serverDoc = await kataDb.collection('servers').findOne({ guildId });
  if (!serverDoc || serverDoc.isActive === false) {
    return { error: 'bot_not_in_guild', status: 404 };
  }

  // Owner override skips Discord round-trip; otherwise verify MANAGE_GUILD.
  if (!isOwner) {
    let userGuilds;
    try {
      const r = await fetch('https://discord.com/api/v10/users/@me/guilds', {
        headers: { Authorization: `Bearer ${user.discordAccessToken}` },
      });
      if (r.status === 401) return { error: 'reauth_required', status: 403 };
      if (!r.ok) return { error: 'discord_unavailable', status: 502 };
      userGuilds = await r.json();
    } catch {
      return { error: 'discord_unavailable', status: 502 };
    }

    const target = userGuilds.find((g) => g.id === guildId);
    if (!target) return { error: 'forbidden', status: 403 };
    let perms = 0n;
    try { perms = BigInt(target.permissions || '0'); } catch { /* keep 0 */ }
    const canManage = (perms & DISCORD_PERM_MANAGE_GUILD) !== 0n || target.owner === true;
    if (!canManage) return { error: 'forbidden', status: 403 };
  }

  return { user, isOwner, serverDoc, kataDb };
}

// ── GET /api/kata/server/:guildId ───────────────────────────────
//
// Returns: { guild, config, stats: { kpis, hourly, topUsers, recent } }
// stats are scoped to last 24h for KPIs and hourly bars; top users + cost
// are 30-day windows.

async function handleKataServerGet(req, res, guildId) {
  const auth = await authorizeGuildAccess(req, guildId);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });

  const { kataDb, serverDoc } = auth;
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const since24h = new Date(now - day);
  const since48h = new Date(now - 2 * day);
  const since30d = new Date(now - 30 * day);

  const [config, msg24h, msg48h, img24h, img48h, vid24h, vid48h, cmd24h, cmd48h, cost30d, hourly, topUsers, recent] = await Promise.all([
    kataDb.collection('serverconfigs').findOne({ guildId }),
    kataDb.collection('chatlogs').countDocuments({ guildId, role: 'user', createdAt: { $gte: since24h } }),
    kataDb.collection('chatlogs').countDocuments({ guildId, role: 'user', createdAt: { $gte: since48h, $lt: since24h } }),
    kataDb.collection('imagegens').countDocuments({ guildId, createdAt: { $gte: since24h } }),
    kataDb.collection('imagegens').countDocuments({ guildId, createdAt: { $gte: since48h, $lt: since24h } }),
    kataDb.collection('videogens').countDocuments({ guildId, createdAt: { $gte: since24h } }),
    kataDb.collection('videogens').countDocuments({ guildId, createdAt: { $gte: since48h, $lt: since24h } }),
    kataDb.collection('commandhistories').countDocuments({ guildId, createdAt: { $gte: since24h } }),
    kataDb.collection('commandhistories').countDocuments({ guildId, createdAt: { $gte: since48h, $lt: since24h } }),
    kataDb.collection('costentries').aggregate([
      { $match: { guildId, timestamp: { $gte: since30d } } },
      { $group: { _id: null, total: { $sum: '$costUSD' } } },
    ]).toArray(),
    // 24 hourly buckets — works on chatlogs (TTL 24h) so the count is stable.
    kataDb.collection('chatlogs').aggregate([
      { $match: { guildId, role: 'user', createdAt: { $gte: since24h } } },
      { $group: { _id: { $hour: '$createdAt' }, count: { $sum: 1 } } },
    ]).toArray(),
    kataDb.collection('costentries').aggregate([
      { $match: { guildId, timestamp: { $gte: since30d } } },
      { $group: { _id: '$userId', cost: { $sum: '$costUSD' }, count: { $sum: 1 } } },
      { $sort: { cost: -1 } },
      { $limit: 5 },
    ]).toArray(),
    kataDb.collection('commandhistories').find(
      { guildId },
      { projection: { command: 1, userId: 1, input: 1, success: 1, costUSD: 1, errorMessage: 1, createdAt: 1 } },
    ).sort({ createdAt: -1 }).limit(15).toArray(),
  ]);

  const cost30dTotal = cost30d[0]?.total ?? 0;

  // Build a 24-slot hourly array, current hour first → previous hours back to 24h ago
  const currentHour = new Date().getHours();
  const hourMap = new Map(hourly.map((h) => [h._id, h.count]));
  const hourBars = [];
  for (let i = 23; i >= 0; i--) {
    const hour = (currentHour - i + 24) % 24;
    hourBars.push({ hour, count: hourMap.get(hour) ?? 0 });
  }

  // Compute deltas vs prior 24h window for KPI trend pills.
  const delta = (cur, prev) => {
    if (prev === 0) return cur > 0 ? 100 : 0;
    return Math.round(((cur - prev) / prev) * 100);
  };

  return res.status(200).json({
    guild: {
      id: guildId,
      name: serverDoc.name,
      iconUrl: serverDoc.iconUrl ?? null,
      ownerId: serverDoc.ownerId,
      joinedAt: serverDoc.joinedAt,
    },
    config: config ? {
      systemPrompt: config.systemPrompt ?? '',
      chatModel: config.chatModel ?? 'gemini-3.1-flash-lite',
      chatMode: config.chatMode ?? 'balanced',
      imageModel: config.imageModel ?? 'fal-ai/nano-banana-pro',
      videoModel: config.videoModel ?? 'bytedance/seedance-2.0/image-to-video',
      rateLimitPerUser: config.rateLimitPerUser ?? 30,
      nsfwThresholdNormal: config.nsfwThresholdNormal ?? 0.3,
      nsfwThresholdNsfw: config.nsfwThresholdNsfw ?? 0.85,
      allowedChannels: Array.isArray(config.allowedChannels) ? config.allowedChannels : [],
      updatedAt: config.updatedAt,
    } : null,
    stats: {
      kpis: {
        msg24h: { value: msg24h, delta: delta(msg24h, msg48h) },
        img24h: { value: img24h, delta: delta(img24h, img48h) },
        vid24h: { value: vid24h, delta: delta(vid24h, vid48h) },
        cmd24h: { value: cmd24h, delta: delta(cmd24h, cmd48h) },
        cost30d: { value: cost30dTotal },
      },
      hourly: hourBars,
      topUsers: topUsers.map((u) => ({ userId: u._id, cost: u.cost, count: u.count })),
      recent: recent.map((r) => ({
        command: r.command,
        userId: r.userId,
        input: (r.input || '').slice(0, 120),
        success: r.success,
        costUSD: r.costUSD ?? null,
        errorMessage: r.errorMessage ?? null,
        createdAt: r.createdAt,
      })),
    },
  });
}

// ── PATCH /api/kata/server/:guildId/config ──────────────────────
//
// Validates payload, writes to serverconfigs (upsert), publishes
// config:updated:{guildId} on Redis so the bot invalidates its cache.

const ALLOWED_CHAT_MODES = new Set(['fast', 'balanced', 'deep']);
const MAX_SYSPROMPT_LEN = 4000;
const MAX_ALLOWED_CHANNELS = 50;

async function handleKataServerConfigPatch(req, res, guildId) {
  const auth = await authorizeGuildAccess(req, guildId);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'invalid_json' }); }
  }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'invalid_body' });

  const update = {};
  const errors = [];

  if (body.systemPrompt !== undefined) {
    if (typeof body.systemPrompt !== 'string') errors.push('systemPrompt must be string');
    else if (body.systemPrompt.length > MAX_SYSPROMPT_LEN) errors.push(`systemPrompt > ${MAX_SYSPROMPT_LEN} chars`);
    else update.systemPrompt = body.systemPrompt;
  }
  if (body.chatModel !== undefined) {
    if (typeof body.chatModel !== 'string' || !body.chatModel.trim()) errors.push('chatModel must be non-empty string');
    else update.chatModel = body.chatModel.trim();
  }
  if (body.chatMode !== undefined) {
    if (!ALLOWED_CHAT_MODES.has(body.chatMode)) errors.push('chatMode must be fast|balanced|deep');
    else update.chatMode = body.chatMode;
  }
  if (body.imageModel !== undefined) {
    if (typeof body.imageModel !== 'string' || !body.imageModel.trim()) errors.push('imageModel must be non-empty string');
    else update.imageModel = body.imageModel.trim();
  }
  if (body.videoModel !== undefined) {
    if (typeof body.videoModel !== 'string' || !body.videoModel.trim()) errors.push('videoModel must be non-empty string');
    else update.videoModel = body.videoModel.trim();
  }
  if (body.rateLimitPerUser !== undefined) {
    const n = Number(body.rateLimitPerUser);
    if (!Number.isFinite(n) || n < 1 || n > 1000) errors.push('rateLimitPerUser must be 1-1000');
    else update.rateLimitPerUser = Math.round(n);
  }
  if (body.nsfwThresholdNormal !== undefined) {
    const n = Number(body.nsfwThresholdNormal);
    if (!Number.isFinite(n) || n < 0 || n > 1) errors.push('nsfwThresholdNormal must be 0-1');
    else update.nsfwThresholdNormal = n;
  }
  if (body.nsfwThresholdNsfw !== undefined) {
    const n = Number(body.nsfwThresholdNsfw);
    if (!Number.isFinite(n) || n < 0 || n > 1) errors.push('nsfwThresholdNsfw must be 0-1');
    else update.nsfwThresholdNsfw = n;
  }
  if (body.allowedChannels !== undefined) {
    if (!Array.isArray(body.allowedChannels)) errors.push('allowedChannels must be array');
    else if (body.allowedChannels.length > MAX_ALLOWED_CHANNELS) errors.push(`allowedChannels > ${MAX_ALLOWED_CHANNELS}`);
    else if (!body.allowedChannels.every((c) => typeof c === 'string' && /^\d{15,21}$/.test(c))) errors.push('allowedChannels entries must be channel ids');
    else update.allowedChannels = body.allowedChannels;
  }

  if (errors.length) return res.status(400).json({ error: 'validation_failed', details: errors });
  if (Object.keys(update).length === 0) return res.status(400).json({ error: 'empty_update' });

  const { kataDb } = auth;
  update.updatedAt = new Date();

  await kataDb.collection('serverconfigs').updateOne(
    { guildId },
    { $set: update, $setOnInsert: { guildId } },
    { upsert: true },
  );

  // Best-effort Redis publish — bot also polls Mongo every 30s so a missed
  // publish only delays propagation, doesn't drop the change.
  try {
    await redisPublish(`config:updated:${guildId}`, { guildId, ts: Date.now() });
  } catch (e) {
    console.warn('redis publish failed', e?.message || e);
  }

  // Audit trail
  try {
    await (await getKataDb()).collection('auditlogs').insertOne({
      actorUserId: auth.user.providerUserId,
      guildId,
      action: 'config_update',
      details: { fields: Object.keys(update).filter((k) => k !== 'updatedAt') },
      createdAt: new Date(),
    });
  } catch { /* audit is best-effort */ }

  const fresh = await kataDb.collection('serverconfigs').findOne({ guildId });
  return res.status(200).json({ ok: true, config: fresh });
}

// ── GET /api/kata/server/:guildId/logs ──────────────────────────
//
// Query: ?type=chat|image|video|command  &cursor=<ISO date>  &limit=20
// Sort: createdAt desc. Cursor pagination (Date-based) — cheaper than skip
// once entries grow, and works with the existing { guildId, createdAt } index.

const LOG_TYPES = {
  chat: {
    coll: 'chatlogs',
    timeField: 'createdAt',
    project: { _id: 0, channelId: 1, userId: 1, role: 1, content: 1, modelUsed: 1, tokensIn: 1, tokensOut: 1, costUSD: 1, attachments: 1, createdAt: 1 },
  },
  image: {
    coll: 'imagegens',
    timeField: 'createdAt',
    project: { _id: 0, channelId: 1, userId: 1, command: 1, prompt: 1, inputImageUrl: 1, outputUrl: 1, modelUsed: 1, fallbackChain: 1, costUSD: 1, createdAt: 1 },
  },
  video: {
    coll: 'videogens',
    timeField: 'createdAt',
    project: { _id: 0, channelId: 1, userId: 1, command: 1, prompt: 1, inputUrl: 1, outputUrl: 1, modelUsed: 1, costUSD: 1, durationSec: 1, createdAt: 1 },
  },
  command: {
    coll: 'commandhistories',
    timeField: 'createdAt',
    project: { _id: 0, channelId: 1, userId: 1, command: 1, input: 1, success: 1, errorMessage: 1, modelUsed: 1, costUSD: 1, latencyMs: 1, createdAt: 1 },
  },
};

const MAX_LOG_LIMIT = 50;
const DEFAULT_LOG_LIMIT = 20;

async function handleKataServerLogs(req, res, guildId) {
  const auth = await authorizeGuildAccess(req, guildId);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });

  const type = String(req.query?.type || 'chat').toLowerCase();
  const spec = LOG_TYPES[type];
  if (!spec) return res.status(400).json({ error: 'invalid_type', allowed: Object.keys(LOG_TYPES) });

  const limit = Math.min(MAX_LOG_LIMIT, Math.max(1, parseInt(req.query?.limit, 10) || DEFAULT_LOG_LIMIT));
  const cursorRaw = req.query?.cursor;
  const filter = { guildId };
  if (cursorRaw) {
    const cursorDate = new Date(String(cursorRaw));
    if (!isNaN(cursorDate.getTime())) {
      filter[spec.timeField] = { $lt: cursorDate };
    }
  }

  // Optional filters
  if (req.query?.userId && /^\d{15,21}$/.test(req.query.userId)) {
    filter.userId = req.query.userId;
  }
  if (req.query?.channelId && /^\d{15,21}$/.test(req.query.channelId)) {
    filter.channelId = req.query.channelId;
  }
  if (req.query?.command && /^\/?[a-z0-9_-]{1,32}$/i.test(req.query.command)) {
    filter.command = req.query.command.startsWith('/') ? req.query.command : `/${req.query.command}`;
  }
  // Chat is special — show user-side only by default. Bot replies double the
  // log volume without adding info to a glance.
  if (type === 'chat' && req.query?.role !== 'all') {
    filter.role = 'user';
  }

  const { kataDb } = auth;
  const items = await kataDb
    .collection(spec.coll)
    .find(filter, { projection: spec.project })
    .sort({ [spec.timeField]: -1 })
    .limit(limit + 1)
    .toArray();

  const hasMore = items.length > limit;
  const trimmed = hasMore ? items.slice(0, limit) : items;
  const nextCursor = hasMore ? trimmed[trimmed.length - 1][spec.timeField].toISOString() : null;

  // Total count is expensive on large collections — only return when no cursor
  // (first page) so the UI can show "X total" once.
  let total = null;
  if (!cursorRaw) {
    try {
      total = await kataDb.collection(spec.coll).countDocuments({ guildId, ...(filter.role ? { role: filter.role } : {}) });
    } catch {
      total = null;
    }
  }

  // Trim user-visible content for chat (could be huge). Other types are
  // already structured with short prompts.
  const sanitized = trimmed.map((row) => {
    if (type === 'chat' && typeof row.content === 'string' && row.content.length > 600) {
      return { ...row, content: row.content.slice(0, 600), contentTruncated: true };
    }
    return row;
  });

  return res.status(200).json({
    type,
    items: sanitized,
    nextCursor,
    total,
    limit,
  });
}
