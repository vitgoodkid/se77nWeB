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
import { publish as redisPublish, cached, ping as redisPing } from '../_lib/redis.js';

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
  if (kataPath === 'me/history') return handleKataMeHistory(req, res);
  // /api/kata/admin/<section> — owner-only aggregate dashboards
  const adminMatch = kataPath.match(/^admin\/([a-z-]+)$/);
  if (adminMatch && req.method === 'GET') {
    return handleKataAdmin(req, res, adminMatch[1]);
  }

  // /api/kata/server/:guildId  → GET overview + config
  // /api/kata/server/:guildId/config (PATCH) → write config + redis publish
  // /api/kata/server/:guildId/logs?type=… (GET) → paginated logs
  // /api/kata/server/:guildId/cost?range=7d|30d|90d (GET) → cost aggregations
  const serverMatch = kataPath.match(/^server\/([0-9]+)(?:\/(config|logs|cost))?$/);
  if (serverMatch) {
    const [, guildId, sub] = serverMatch;
    if (sub === 'config' && req.method === 'PATCH') {
      return handleKataServerConfigPatch(req, res, guildId);
    }
    if (sub === 'logs' && req.method === 'GET') {
      return handleKataServerLogs(req, res, guildId);
    }
    if (sub === 'cost' && req.method === 'GET') {
      return handleKataServerCost(req, res, guildId);
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
  const botServers = await kataDb
    .collection('servers')
    .find({ isActive: true }, { projection: { guildId: 1, name: 1, iconUrl: 1, ownerId: 1 } })
    .toArray();
  const botGuildIds = new Set(botServers.map((s) => s.guildId));

  const owner = process.env.OWNER_DISCORD_ID?.trim() || '397342895327150080';
  const isOwner = user.providerUserId === owner;

  // Surface only servers the user can actually manage (admin/owner) AND the
  // bot is in. Anything they don't admin doesn't appear at all — no "có thể
  // mời" rail. The bot owner additionally sees every server the bot is in,
  // even ones they aren't a member of.
  const managed = [];
  const seenGuildIds = new Set();

  for (const g of userGuilds) {
    let perms = 0n;
    try { perms = BigInt(g.permissions || '0'); } catch { /* keep 0 */ }
    const canManage = (perms & DISCORD_PERM_MANAGE_GUILD) !== 0n || g.owner === true;
    if (!canManage && !isOwner) continue;
    if (!botGuildIds.has(g.id)) continue;

    seenGuildIds.add(g.id);
    managed.push({
      id: g.id,
      name: g.name,
      iconUrl: g.icon
        ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=128`
        : null,
      isOwner: !!g.owner,
      botOwnerView: false,
    });
  }

  if (isOwner) {
    for (const s of botServers) {
      if (seenGuildIds.has(s.guildId)) continue;
      managed.push({
        id: s.guildId,
        name: s.name || `Server ${s.guildId.slice(-4)}`,
        iconUrl: s.iconUrl || null,
        isOwner: false,
        botOwnerView: true,
      });
    }
  }

  // 30-day rollup across the user's managed guilds. Used by the landing page
  // hero tiles + sparkline + activity feed so /kata stops showing "12.4k msg
  // · $18.40" demo numbers. Owner with no managed guilds gets numbers across
  // the whole bot fleet.
  const managedGuildIds = managed.map((g) => g.id);
  let summary = null;
  let recentActivity = [];
  if (managedGuildIds.length > 0) {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const sincePrior = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const sevenDay = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const filterCur = { guildId: { $in: managedGuildIds }, timestamp: { $gte: since } };
    const filterPrior = { guildId: { $in: managedGuildIds }, timestamp: { $gte: sincePrior, $lt: since } };
    const chatFilter = { guildId: { $in: managedGuildIds }, role: 'user' };

    const [costAgg, costPrior, msgs30d, msgsPrior, img30d, vid30d, daily, recent] = await Promise.all([
      kataDb.collection('costentries').aggregate([
        { $match: filterCur },
        { $group: { _id: null, total: { $sum: '$costUSD' } } },
      ]).toArray(),
      kataDb.collection('costentries').aggregate([
        { $match: filterPrior },
        { $group: { _id: null, total: { $sum: '$costUSD' } } },
      ]).toArray(),
      kataDb.collection('chatlogs').countDocuments({ ...chatFilter, createdAt: { $gte: since } }),
      kataDb.collection('chatlogs').countDocuments({ ...chatFilter, createdAt: { $gte: sincePrior, $lt: since } }),
      kataDb.collection('imagegens').countDocuments({ guildId: { $in: managedGuildIds }, createdAt: { $gte: since } }),
      kataDb.collection('videogens').countDocuments({ guildId: { $in: managedGuildIds }, createdAt: { $gte: since } }),
      // Daily user-msg counts for the 7-day sparkline. Using chatlogs role=user
      // because cost entries don't reflect free chat turns.
      kataDb.collection('chatlogs').aggregate([
        { $match: { ...chatFilter, createdAt: { $gte: sevenDay } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, msgs: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]).toArray(),
      // Recent activity feed across managed guilds. We pull from
      // commandhistories so each row already has command+input+success+
      // createdAt. 6 latest is enough for the "right now" panel.
      kataDb.collection('commandhistories')
        .find(
          { guildId: { $in: managedGuildIds } },
          { projection: { command: 1, input: 1, userId: 1, success: 1, createdAt: 1 } },
        )
        .sort({ createdAt: -1 })
        .limit(6)
        .toArray(),
    ]);

    const cost30d = Number(costAgg[0]?.total ?? 0);
    const costPrev = Number(costPrior[0]?.total ?? 0);
    const costDelta = costPrev === 0 ? (cost30d > 0 ? 100 : 0) : Math.round(((cost30d - costPrev) / costPrev) * 100);
    const msgsDelta = msgsPrior === 0 ? (msgs30d > 0 ? 100 : 0) : Math.round(((msgs30d - msgsPrior) / msgsPrior) * 100);

    // Backfill 7d sparkline so the SVG path stays stable even on quiet days.
    const dailyMap = new Map(daily.map((r) => [r._id, r.msgs]));
    const sparkline = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const id = d.toISOString().slice(0, 10);
      sparkline.push({ date: id, msgs: Number(dailyMap.get(id) ?? 0) });
    }
    const peak = sparkline.reduce((m, p) => (p.msgs > m.msgs ? p : m), { date: null, msgs: 0 });

    summary = {
      cost30d,
      costDelta,
      msgs30d,
      msgsDelta,
      images30d: img30d,
      videos30d: vid30d,
      sparkline,
      peak,
    };
    recentActivity = recent.map((r) => ({
      command: r.command ?? '?',
      input: typeof r.input === 'string' ? r.input.slice(0, 120) : '',
      userId: r.userId ?? null,
      success: r.success !== false,
      createdAt: r.createdAt,
    }));
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
    counts: {
      managed: managed.length,
      botTotal: botGuildIds.size,
    },
    summary,
    recentActivity,
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

// Resolve a list of Discord user IDs to display names from the bot's
// `katasusers` collection (written by apps/bot/src/services/userMeta.ts on
// every mention/command). Returns a map keyed by id; missing entries are
// omitted so callers can fall back to "?{snowflake-suffix}" rendering.
async function hydrateUsernames(kataDb, userIds) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return {};
  try {
    const rows = await kataDb
      .collection('katasusers')
      .find(
        { discordId: { $in: ids } },
        { projection: { discordId: 1, username: 1, displayName: 1, avatarUrl: 1 } },
      )
      .toArray();
    const out = {};
    for (const r of rows) {
      out[r.discordId] = {
        username: r.username,
        displayName: r.displayName ?? r.username,
        avatarUrl: r.avatarUrl ?? null,
      };
    }
    return out;
  } catch {
    return {};
  }
}

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
      topUsers: await (async () => {
        const meta = await hydrateUsernames(
          kataDb,
          topUsers.map((u) => u._id),
        );
        return topUsers.map((u) => ({
          userId: u._id,
          cost: u.cost,
          count: u.count,
          username: meta[u._id]?.username ?? null,
          displayName: meta[u._id]?.displayName ?? null,
          avatarUrl: meta[u._id]?.avatarUrl ?? null,
        }));
      })(),
      recent: await (async () => {
        const meta = await hydrateUsernames(
          kataDb,
          recent.map((r) => r.userId),
        );
        return recent.map((r) => ({
          command: r.command,
          userId: r.userId,
          username: meta[r.userId]?.username ?? null,
          displayName: meta[r.userId]?.displayName ?? null,
          input: (r.input || '').slice(0, 120),
          success: r.success,
          costUSD: r.costUSD ?? null,
          errorMessage: r.errorMessage ?? null,
          createdAt: r.createdAt,
        }));
      })(),
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

// ── GET /api/kata/me/history ───────────────────────────────────
//
// Cross-server lịch sử của chính user đang đăng nhập. Mỗi item kèm
// guildName + iconUrl để dashboard render label cho biết command đã chạy
// ở server nào. Auth: chỉ cần Discord session — KHÔNG cần MANAGE_GUILD,
// vì user chỉ xem dữ liệu của chính mình.
async function handleKataMeHistory(req, res) {
  const session = readSession(req);
  if (!session?.uid) return res.status(401).json({ error: 'unauthenticated' });

  let userOid;
  try { userOid = new ObjectId(session.uid); }
  catch { return res.status(401).json({ error: 'bad_session' }); }

  const users = await getUsers();
  const user = await users.findOne({ _id: userOid });
  if (!user) return res.status(401).json({ error: 'user_not_found' });
  if (user.provider !== 'discord' || !user.providerUserId) {
    return res.status(403).json({ error: 'discord_required' });
  }

  const type = String(req.query?.type || 'chat').toLowerCase();
  const spec = LOG_TYPES[type];
  if (!spec) return res.status(400).json({ error: 'invalid_type', allowed: Object.keys(LOG_TYPES) });

  const limit = Math.min(MAX_LOG_LIMIT, Math.max(1, parseInt(req.query?.limit, 10) || DEFAULT_LOG_LIMIT));
  const cursorRaw = req.query?.cursor;

  const filter = { userId: user.providerUserId };
  if (cursorRaw) {
    const cursorDate = new Date(String(cursorRaw));
    if (!isNaN(cursorDate.getTime())) {
      filter[spec.timeField] = { $lt: cursorDate };
    }
  }
  // Chat: hide assistant rows by default (the user only cares what THEY said).
  if (type === 'chat' && req.query?.role !== 'all') {
    filter.role = 'user';
  }

  const kataDb = await getKataDb();
  // Pull rows + the matching guild metadata (name/icon) in one shot. We
  // include guildId in the projection so the UI can deep-link to the
  // server's dashboard if the user is also an admin there.
  const items = await kataDb
    .collection(spec.coll)
    .find(filter, { projection: { ...spec.project, guildId: 1 } })
    .sort({ [spec.timeField]: -1 })
    .limit(limit + 1)
    .toArray();

  const hasMore = items.length > limit;
  const trimmed = hasMore ? items.slice(0, limit) : items;
  const nextCursor = hasMore ? trimmed[trimmed.length - 1][spec.timeField].toISOString() : null;

  // Hydrate guild meta once per unique guildId (cheap — usually <10 distinct
  // guilds in a page of 20 rows).
  const guildIds = [...new Set(trimmed.map((r) => r.guildId).filter(Boolean))];
  let guildMeta = {};
  if (guildIds.length > 0) {
    const servers = await kataDb
      .collection('servers')
      .find({ guildId: { $in: guildIds } }, { projection: { guildId: 1, name: 1, iconUrl: 1 } })
      .toArray();
    guildMeta = Object.fromEntries(servers.map((s) => [s.guildId, { name: s.name, iconUrl: s.iconUrl ?? null }]));
  }

  let total = null;
  if (!cursorRaw) {
    try {
      total = await kataDb.collection(spec.coll).countDocuments({
        userId: user.providerUserId,
        ...(filter.role ? { role: filter.role } : {}),
      });
    } catch { /* total is best-effort */ }
  }

  return res.status(200).json({
    type,
    items: trimmed.map((r) => ({
      ...r,
      guild: guildMeta[r.guildId] ?? { name: r.guildId, iconUrl: null },
    })),
    nextCursor,
    hasMore,
    total,
  });
}

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

// ── GET /api/kata/server/:guildId/cost ──────────────────────────
//
// Query: ?range=7d|30d|90d  (default 30d)
// Returns: { range, total, totalDelta, byModel[], byCommand[], topUsers[],
//   dailyCost[], dailyTokens[], totals { tokensIn, tokensOut, images, videos } }
//
// Aggregations hit costentries (cost), commandhistories (latency p50,
// command-level counts), chatlogs (tokens). Costentries already has a
// { guildId, timestamp } index — pages compute in <500ms even at 100k rows.

const COST_RANGES = { '7d': 7, '30d': 30, '90d': 90 };
const DEFAULT_COST_RANGE = '30d';
// Cost aggregations are 11 Mongo pipelines; on a 90d range the heavier ones
// scan tens of thousands of rows. Dashboard refreshes / tab switches hit this
// endpoint a lot, so cache for 5 minutes — fresh enough for ops-style use,
// 60-90× cheaper than recomputing every refresh.
const COST_CACHE_TTL_SECONDS = 5 * 60;

async function handleKataServerCost(req, res, guildId) {
  const auth = await authorizeGuildAccess(req, guildId);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });

  const range = COST_RANGES[req.query?.range] ? req.query.range : DEFAULT_COST_RANGE;
  const days = COST_RANGES[range];
  // Anchor cache key to the start of the current 5-min window so all calls
  // within a window share the same key. Prevents the case where wall-clock
  // ms in the key would force a fresh recompute on every request.
  const windowSlot = Math.floor(Date.now() / (COST_CACHE_TTL_SECONDS * 1000));
  const cacheKey = `kata:cost:${guildId}:${range}:${windowSlot}`;

  const { kataDb } = auth;

  const { value, hit } = await cached(cacheKey, COST_CACHE_TTL_SECONDS, async () => {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const sincePrior = new Date(Date.now() - 2 * days * 24 * 60 * 60 * 1000);

    const cost = kataDb.collection('costentries');
    const cmd = kataDb.collection('commandhistories');
    const chat = kataDb.collection('chatlogs');
    const img = kataDb.collection('imagegens');
    const vid = kataDb.collection('videogens');

    const [
      totalAgg,
      totalsCurrent,
      totalsPrior,
      byModel,
      byCommand,
      topUsers,
      dailyCost,
      dailyTokens,
      imageCount,
      videoCount,
      cmdLatencies,
    ] = await Promise.all([
      cost.aggregate([
        { $match: { guildId, timestamp: { $gte: since } } },
        { $group: {
          _id: null,
          total: { $sum: '$costUSD' },
          tokensIn: { $sum: '$tokensIn' },
          tokensOut: { $sum: '$tokensOut' },
          images: { $sum: '$imagesGen' },
          videoSec: { $sum: '$videoDurationSec' },
        } },
      ]).toArray(),
      // Window total (same as totalAgg.total but explicit for delta calc readability)
      cost.aggregate([
        { $match: { guildId, timestamp: { $gte: since } } },
        { $group: { _id: null, total: { $sum: '$costUSD' } } },
      ]).toArray(),
      cost.aggregate([
        { $match: { guildId, timestamp: { $gte: sincePrior, $lt: since } } },
        { $group: { _id: null, total: { $sum: '$costUSD' } } },
      ]).toArray(),
      cost.aggregate([
        { $match: { guildId, timestamp: { $gte: since } } },
        { $group: { _id: { service: '$service', model: '$model' }, cost: { $sum: '$costUSD' }, count: { $sum: 1 } } },
        { $sort: { cost: -1 } },
        { $limit: 10 },
      ]).toArray(),
      cost.aggregate([
        { $match: { guildId, timestamp: { $gte: since } } },
        { $group: { _id: '$command', cost: { $sum: '$costUSD' }, count: { $sum: 1 } } },
        { $sort: { cost: -1 } },
      ]).toArray(),
      cost.aggregate([
        { $match: { guildId, timestamp: { $gte: since } } },
        { $group: { _id: '$userId', cost: { $sum: '$costUSD' }, count: { $sum: 1 } } },
        { $sort: { cost: -1 } },
        { $limit: 10 },
      ]).toArray(),
      cost.aggregate([
        { $match: { guildId, timestamp: { $gte: since } } },
        { $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
          cost: { $sum: '$costUSD' },
        } },
        { $sort: { _id: 1 } },
      ]).toArray(),
      chat.aggregate([
        { $match: { guildId, createdAt: { $gte: since } } },
        { $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          tokensIn: { $sum: '$tokensIn' },
          tokensOut: { $sum: '$tokensOut' },
        } },
        { $sort: { _id: 1 } },
      ]).toArray(),
      img.countDocuments({ guildId, createdAt: { $gte: since } }),
      vid.countDocuments({ guildId, createdAt: { $gte: since } }),
      // Latency p50 per command via $bucket would need a 2-stage pipeline;
      // a simple sort+pick-middle on each command beats $bucketAuto for small N.
      cmd.aggregate([
        { $match: { guildId, createdAt: { $gte: since }, success: true, latencyMs: { $exists: true, $ne: null } } },
        { $group: { _id: '$command', latencies: { $push: '$latencyMs' } } },
      ]).toArray(),
    ]);

    const totals = totalAgg[0] || { total: 0, tokensIn: 0, tokensOut: 0, images: 0, videoSec: 0 };
    const total = Number(totalsCurrent[0]?.total ?? 0);
    const priorTotal = Number(totalsPrior[0]?.total ?? 0);
    const totalDelta = priorTotal === 0 ? (total > 0 ? 100 : 0) : Math.round(((total - priorTotal) / priorTotal) * 100);

    // Backfill missing days with 0 so the line chart has a stable x-axis.
    function fillSeries(rows, key) {
      const map = new Map(rows.map((r) => [r._id, r]));
      const out = [];
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
        const id = d.toISOString().slice(0, 10);
        const row = map.get(id);
        if (key === 'tokens') {
          out.push({ date: id, tokensIn: row?.tokensIn ?? 0, tokensOut: row?.tokensOut ?? 0 });
        } else {
          out.push({ date: id, cost: Number(row?.cost ?? 0) });
        }
      }
      return out;
    }

    // p50 latency per command
    const latencyMap = {};
    for (const row of cmdLatencies) {
      const sorted = row.latencies.slice().sort((a, b) => a - b);
      latencyMap[row._id] = sorted[Math.floor(sorted.length / 2)] ?? null;
    }

    const userMeta = await hydrateUsernames(kataDb, topUsers.map((u) => u._id));

    return {
      range,
      days,
      total,
      totalDelta,
      totals: {
        tokensIn: totals.tokensIn ?? 0,
        tokensOut: totals.tokensOut ?? 0,
        images: imageCount,
        videos: videoCount,
        videoSec: totals.videoSec ?? 0,
      },
      byModel: byModel.map((m) => ({ service: m._id.service, model: m._id.model, cost: Number(m.cost), count: m.count })),
      byCommand: byCommand.map((c) => ({
        command: c._id,
        cost: Number(c.cost),
        count: c.count,
        latencyP50Ms: latencyMap[c._id] ?? null,
      })),
      topUsers: topUsers.map((u) => ({
        userId: u._id,
        cost: Number(u.cost),
        count: u.count,
        username: userMeta[u._id]?.username ?? null,
        displayName: userMeta[u._id]?.displayName ?? null,
        avatarUrl: userMeta[u._id]?.avatarUrl ?? null,
      })),
      dailyCost: fillSeries(dailyCost, 'cost'),
      dailyTokens: fillSeries(dailyTokens, 'tokens'),
    };
  });

  // Surface cache state so the dashboard can show "fresh / cached 3m ago"
  // and so we can verify the cache is actually working in production logs.
  res.setHeader('X-Kata-Cache', hit ? 'HIT' : 'MISS');
  res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
  return res.status(200).json(value);
}

// ────────────────────────────────────────────────────────────────
// /api/kata/admin/<section>  — owner-only aggregate endpoints
// ────────────────────────────────────────────────────────────────

const ADMIN_SECTIONS = new Set(['servers', 'logs', 'cost', 'models', 'health']);
const ADMIN_CACHE_TTL_SECONDS = 5 * 60;

async function requireOwner(req) {
  const session = readSession(req);
  if (!session?.uid) return { error: 'unauthenticated', status: 401 };

  let userOid;
  try { userOid = new ObjectId(session.uid); }
  catch { return { error: 'bad_session', status: 401 }; }

  const users = await getUsers();
  const user = await users.findOne({ _id: userOid });
  if (!user) return { error: 'user_not_found', status: 401 };
  if (user.provider !== 'discord' || !user.providerUserId) {
    return { error: 'discord_required', status: 403 };
  }

  const ownerId = process.env.OWNER_DISCORD_ID?.trim() || '397342895327150080';
  if (user.providerUserId !== ownerId) {
    return { error: 'forbidden', status: 403, message: 'Owner only' };
  }
  return { user, ownerId };
}

async function handleKataAdmin(req, res, section) {
  if (!ADMIN_SECTIONS.has(section)) {
    return res.status(404).json({ error: 'unknown_section', allowed: [...ADMIN_SECTIONS] });
  }
  const auth = await requireOwner(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error, message: auth.message });

  const kataDb = await getKataDb();

  switch (section) {
    case 'servers':  return adminServers(req, res, kataDb);
    case 'logs':     return adminLogs(req, res, kataDb);
    case 'cost':     return adminCost(req, res, kataDb);
    case 'models':   return adminModels(req, res, kataDb);
    case 'health':   return adminHealth(req, res, kataDb);
  }
}

// ── /admin/servers ─────────────────────────────────────────────
// Every guild the bot is in, plus per-guild 30d totals so the owner can
// spot servers that are racking up cost.
async function adminServers(req, res, kataDb) {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [servers, costByGuild, msgByGuild] = await Promise.all([
    kataDb.collection('servers')
      .find({}, { projection: { guildId: 1, name: 1, iconUrl: 1, ownerId: 1, isActive: 1, joinedAt: 1, memberCount: 1 } })
      .sort({ joinedAt: -1 })
      .toArray(),
    kataDb.collection('costentries').aggregate([
      { $match: { timestamp: { $gte: since } } },
      { $group: { _id: '$guildId', cost: { $sum: '$costUSD' }, count: { $sum: 1 } } },
    ]).toArray(),
    kataDb.collection('chatlogs').aggregate([
      { $match: { createdAt: { $gte: since }, role: 'user' } },
      { $group: { _id: '$guildId', msgs: { $sum: 1 } } },
    ]).toArray(),
  ]);

  const costMap = Object.fromEntries(costByGuild.map((r) => [r._id, r]));
  const msgMap = Object.fromEntries(msgByGuild.map((r) => [r._id, r.msgs]));

  return res.status(200).json({
    servers: servers.map((s) => ({
      guildId: s.guildId,
      name: s.name,
      iconUrl: s.iconUrl ?? null,
      ownerId: s.ownerId ?? null,
      isActive: s.isActive !== false,
      joinedAt: s.joinedAt ?? null,
      memberCount: s.memberCount ?? null,
      cost30d: Number(costMap[s.guildId]?.cost ?? 0),
      events30d: Number(costMap[s.guildId]?.count ?? 0),
      msgs30d: Number(msgMap[s.guildId] ?? 0),
    })),
  });
}

// ── /admin/logs ────────────────────────────────────────────────
// Like the per-server logs page but unscoped — last N events across all
// guilds, joined with guild name/icon.
async function adminLogs(req, res, kataDb) {
  const type = String(req.query?.type || 'chat').toLowerCase();
  const spec = LOG_TYPES[type];
  if (!spec) return res.status(400).json({ error: 'invalid_type', allowed: Object.keys(LOG_TYPES) });

  const limit = Math.min(MAX_LOG_LIMIT, Math.max(1, parseInt(req.query?.limit, 10) || DEFAULT_LOG_LIMIT));
  const cursorRaw = req.query?.cursor;

  const filter = {};
  if (cursorRaw) {
    const cursorDate = new Date(String(cursorRaw));
    if (!isNaN(cursorDate.getTime())) filter[spec.timeField] = { $lt: cursorDate };
  }
  if (type === 'chat' && req.query?.role !== 'all') filter.role = 'user';

  const items = await kataDb.collection(spec.coll)
    .find(filter, { projection: { ...spec.project, guildId: 1 } })
    .sort({ [spec.timeField]: -1 })
    .limit(limit + 1)
    .toArray();

  const hasMore = items.length > limit;
  const trimmed = hasMore ? items.slice(0, limit) : items;
  const nextCursor = hasMore ? trimmed[trimmed.length - 1][spec.timeField].toISOString() : null;

  const guildIds = [...new Set(trimmed.map((r) => r.guildId).filter(Boolean))];
  let guildMeta = {};
  if (guildIds.length > 0) {
    const servers = await kataDb.collection('servers')
      .find({ guildId: { $in: guildIds } }, { projection: { guildId: 1, name: 1, iconUrl: 1 } })
      .toArray();
    guildMeta = Object.fromEntries(servers.map((s) => [s.guildId, { name: s.name, iconUrl: s.iconUrl ?? null }]));
  }

  return res.status(200).json({
    type,
    items: trimmed.map((r) => ({
      ...r,
      guild: guildMeta[r.guildId] ?? { name: r.guildId, iconUrl: null },
    })),
    nextCursor,
    hasMore,
  });
}

// ── /admin/cost ────────────────────────────────────────────────
// Global cost across every guild. 5-minute Redis cache.
async function adminCost(req, res, kataDb) {
  const range = COST_RANGES[req.query?.range] ? req.query.range : DEFAULT_COST_RANGE;
  const days = COST_RANGES[range];
  const windowSlot = Math.floor(Date.now() / (ADMIN_CACHE_TTL_SECONDS * 1000));
  const key = `kata:admin:cost:${range}:${windowSlot}`;

  const { value, hit } = await cached(key, ADMIN_CACHE_TTL_SECONDS, async () => {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const sincePrior = new Date(Date.now() - 2 * days * 24 * 60 * 60 * 1000);
    const cost = kataDb.collection('costentries');

    const [totalsCurrent, totalsPrior, byService, byCommand, byGuild, dailyCost] = await Promise.all([
      cost.aggregate([
        { $match: { timestamp: { $gte: since } } },
        { $group: { _id: null, total: { $sum: '$costUSD' }, events: { $sum: 1 } } },
      ]).toArray(),
      cost.aggregate([
        { $match: { timestamp: { $gte: sincePrior, $lt: since } } },
        { $group: { _id: null, total: { $sum: '$costUSD' } } },
      ]).toArray(),
      cost.aggregate([
        { $match: { timestamp: { $gte: since } } },
        { $group: { _id: '$service', cost: { $sum: '$costUSD' }, count: { $sum: 1 } } },
        { $sort: { cost: -1 } },
      ]).toArray(),
      cost.aggregate([
        { $match: { timestamp: { $gte: since } } },
        { $group: { _id: '$command', cost: { $sum: '$costUSD' }, count: { $sum: 1 } } },
        { $sort: { cost: -1 } },
        { $limit: 20 },
      ]).toArray(),
      cost.aggregate([
        { $match: { timestamp: { $gte: since } } },
        { $group: { _id: '$guildId', cost: { $sum: '$costUSD' }, count: { $sum: 1 } } },
        { $sort: { cost: -1 } },
        { $limit: 15 },
      ]).toArray(),
      cost.aggregate([
        { $match: { timestamp: { $gte: since } } },
        { $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
          cost: { $sum: '$costUSD' },
        } },
        { $sort: { _id: 1 } },
      ]).toArray(),
    ]);

    const total = Number(totalsCurrent[0]?.total ?? 0);
    const priorTotal = Number(totalsPrior[0]?.total ?? 0);
    const totalDelta = priorTotal === 0 ? (total > 0 ? 100 : 0) : Math.round(((total - priorTotal) / priorTotal) * 100);

    const guildIds = byGuild.map((g) => g._id).filter(Boolean);
    const guildMeta = {};
    if (guildIds.length > 0) {
      const servers = await kataDb.collection('servers')
        .find({ guildId: { $in: guildIds } }, { projection: { guildId: 1, name: 1, iconUrl: 1 } })
        .toArray();
      for (const s of servers) guildMeta[s.guildId] = { name: s.name, iconUrl: s.iconUrl ?? null };
    }

    const dailyMap = new Map(dailyCost.map((r) => [r._id, r.cost]));
    const daily = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const id = d.toISOString().slice(0, 10);
      daily.push({ date: id, cost: Number(dailyMap.get(id) ?? 0) });
    }

    return {
      range,
      total,
      totalDelta,
      events: Number(totalsCurrent[0]?.events ?? 0),
      byService: byService.map((s) => ({ service: s._id, cost: Number(s.cost), count: s.count })),
      byCommand: byCommand.map((c) => ({ command: c._id, cost: Number(c.cost), count: c.count })),
      byGuild: byGuild.map((g) => ({
        guildId: g._id,
        name: guildMeta[g._id]?.name ?? g._id,
        iconUrl: guildMeta[g._id]?.iconUrl ?? null,
        cost: Number(g.cost),
        count: g.count,
      })),
      daily,
    };
  });

  res.setHeader('X-Kata-Cache', hit ? 'HIT' : 'MISS');
  return res.status(200).json(value);
}

// ── /admin/models ──────────────────────────────────────────────
// Read-only snapshot: which models are actually being called and at what
// volume / cost. We don't expose chain editing — chains live in the bot
// source so the dashboard view is purely observational.
async function adminModels(req, res, kataDb) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const cost = kataDb.collection('costentries');

  const rows = await cost.aggregate([
    { $match: { timestamp: { $gte: since } } },
    { $group: {
      _id: { service: '$service', model: '$model' },
      cost: { $sum: '$costUSD' },
      count: { $sum: 1 },
      lastUsed: { $max: '$timestamp' },
    } },
    { $sort: { cost: -1 } },
  ]).toArray();

  return res.status(200).json({
    rangeDays: 7,
    models: rows.map((r) => ({
      service: r._id.service,
      model: r._id.model,
      cost: Number(r.cost),
      count: r.count,
      lastUsed: r.lastUsed,
    })),
  });
}

// ── /admin/health ──────────────────────────────────────────────
// Liveness across the stack:
//   - Mongo: ping the kata db
//   - Redis: PING
//   - Bot: read botheartbeats — any row whose lastSeen is within 2 min is
//     considered alive
async function adminHealth(req, res, kataDb) {
  const startedMongo = Date.now();
  let mongo;
  try {
    await kataDb.command({ ping: 1 });
    mongo = { ok: true, latencyMs: Date.now() - startedMongo };
  } catch (err) {
    mongo = { ok: false, latencyMs: Date.now() - startedMongo, error: err.message };
  }

  const redis = await redisPing();

  const heartbeats = await kataDb.collection('botheartbeats')
    .find({}, { projection: { instanceId: 1, lastSeen: 1, startedAt: 1, pid: 1, version: 1, guildCount: 1, queueDepth: 1, memMB: 1, nodeVersion: 1, extras: 1 } })
    .sort({ lastSeen: -1 })
    .toArray();

  const aliveCutoff = Date.now() - 2 * 60 * 1000;
  const annotated = heartbeats.map((h) => ({
    instanceId: h.instanceId,
    lastSeen: h.lastSeen,
    startedAt: h.startedAt,
    pid: h.pid ?? null,
    version: h.version ?? null,
    guildCount: h.guildCount ?? 0,
    queueDepth: h.queueDepth ?? 0,
    memMB: h.memMB ?? null,
    nodeVersion: h.nodeVersion ?? null,
    isShuttingDown: !!h.extras?.isShuttingDown,
    alive: h.lastSeen?.getTime?.() >= aliveCutoff,
  }));

  return res.status(200).json({
    mongo,
    redis,
    bot: {
      instances: annotated,
      anyAlive: annotated.some((h) => h.alive && !h.isShuttingDown),
    },
    checkedAt: new Date().toISOString(),
  });
}
