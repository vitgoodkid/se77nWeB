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
import { cached } from '../_lib/redis.js';
import { falChat } from '../_helpers.js';
import {
  resolvePromptConfig as tavernResolvePromptConfig,
  buildSystemPrompt as tavernBuildSystemPrompt,
  parseOOC as tavernParseOOC,
  applyOOC as tavernApplyOOC,
  parseStorytellerReply as tavernParseStorytellerReply,
  trimVerbatimWindow as tavernTrimVerbatimWindow,
  ensureNoMinorSexualization,
  MEMORY_VERBATIM_WINDOW,
} from '../_lib/tavern.js';

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

// ── Owner gate ──────────────────────────────────────────────────────
//
// `/kata` originally only treated the user as owner when their Discord ID
// matched OWNER_DISCORD_ID. That breaks the (legit) case of an admin who
// signs in with Google: same human, different account. We accept both:
//   - Discord ID match (OWNER_DISCORD_ID, default 397342895327150080)
//   - Email match against OWNER_EMAILS (comma-separated, default
//     beliketp@gmail.com so existing local logins keep working)
// One env var per surface; case-insensitive on the email side.
const DEFAULT_OWNER_DISCORD_ID = '397342895327150080';
const DEFAULT_OWNER_EMAILS = 'beliketp@gmail.com';

function getOwnerEmails() {
  const raw = process.env.OWNER_EMAILS?.trim() || DEFAULT_OWNER_EMAILS;
  return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function isUserOwner(user) {
  if (!user) return false;
  const ownerId = process.env.OWNER_DISCORD_ID?.trim() || DEFAULT_OWNER_DISCORD_ID;
  if (user.providerUserId && user.providerUserId === ownerId) return true;
  const email = (user.email || '').trim().toLowerCase();
  if (!email) return false;
  return getOwnerEmails().includes(email);
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

  // /api/kata/admin/tavern-config (GET, PATCH) — owner-only tavern engine
  // defaults. MUST be matched before the generic /admin/<section> regex
  // below; otherwise GET falls through into handleKataAdmin which only
  // knows the dashboard sections (servers/logs/cost/...) and 404s with
  // unknown_section.
  if (kataPath === 'admin/tavern-config') {
    if (req.method === 'GET') return handleKataAdminTavernConfigGet(req, res);
    if (req.method === 'PATCH') return handleKataAdminTavernConfigPatch(req, res);
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  if (kataPath === 'admin/global-config' && req.method === 'PATCH') {
    return handleKataAdminGlobalConfigPatch(req, res);
  }

  // /api/kata/admin/servers/<guildId>/invite — owner-only. Returns an invite
  // link into a guild the bot is already in, so the owner can hop in to look
  // around. MUST precede the generic /admin/<section> match below.
  const inviteMatch = kataPath.match(/^admin\/servers\/(\d+)\/invite$/);
  if (inviteMatch && req.method === 'GET') {
    return handleKataAdminServerInvite(req, res, inviteMatch[1]);
  }

  // /api/kata/admin/<section> — owner-only aggregate dashboards
  const adminMatch = kataPath.match(/^admin\/([a-z-]+)$/);
  if (adminMatch && req.method === 'GET') {
    return handleKataAdmin(req, res, adminMatch[1]);
  }

  // /api/kata/tavern/* — tavern-specific routes (worlds, characters, lore AI)
  if (kataPath.startsWith('tavern/') || kataPath === 'tavern') {
    return handleKataTavern(req, res, kataPath.replace(/^tavern\/?/, ''));
  }

  // /api/kata/server/:guildId/memory                 (GET)   → list user memory
  // /api/kata/server/:guildId/memory/:userId         (PATCH) → set lockedName / ownerNotes
  // /api/kata/server/:guildId/memory/:userId/facts    (DELETE)→ clear learned facts
  // Matched before the generic serverMatch below (which only knows
  // config/logs/cost) so these don't fall through to method_not_allowed.
  const memoryMatch = kataPath.match(/^server\/(\d+)\/memory(?:\/(\d+)(\/facts)?)?$/);
  if (memoryMatch) {
    const [, mGuildId, mUserId, mFacts] = memoryMatch;
    if (!mUserId && req.method === 'GET') return handleKataServerMemoryList(req, res, mGuildId);
    if (mUserId && mFacts && req.method === 'DELETE') return handleKataServerMemoryFactsDelete(req, res, mGuildId, mUserId);
    if (mUserId && !mFacts && req.method === 'PATCH') return handleKataServerMemoryPatch(req, res, mGuildId, mUserId);
    return res.status(405).json({ error: 'method_not_allowed' });
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

  const isOwner = isUserOwner(user);

  // Discord-signed owner / admin: pull their guild list + cross-reference.
  // Email-signed owner (Google): skip the Discord round-trip and just expose
  // the bot's full server roster as "managed" for the owner-view UX.
  let userGuilds = [];
  const usingDiscord = user.provider === 'discord' && !!user.discordAccessToken;
  if (!usingDiscord && !isOwner) {
    return res.status(403).json({
      error: user.provider === 'discord' ? 'reauth_required' : 'discord_required',
      message: user.provider === 'discord'
        ? 'Please log out and sign in with Discord again'
        : 'Sign in with Discord to use /kata',
    });
  }

  if (usingDiscord) {
    try {
      const r = await fetch('https://discord.com/api/v10/users/@me/guilds', {
        headers: { Authorization: `Bearer ${user.discordAccessToken}` },
      });
      if (r.status === 401) {
        // Owner-by-email can fall through; non-owners must reauth.
        if (!isOwner) {
          return res.status(403).json({ error: 'reauth_required', message: 'Discord token expired — please sign in again' });
        }
      } else if (!r.ok) {
        console.error('discord guilds fetch failed', r.status, await r.text().catch(() => ''));
        if (!isOwner) return res.status(502).json({ error: 'discord_unavailable' });
      } else {
        userGuilds = await r.json();
      }
    } catch (e) {
      console.error('discord guilds fetch error', e);
      if (!isOwner) return res.status(502).json({ error: 'discord_unavailable' });
    }
  }

  // Cross-reference with bot's known guilds (servers collection in the KataS
  // bot database — written when the bot joins a guild).
  const kataDb = await getKataDb();
  const botServers = await kataDb
    .collection('servers')
    .find({ isActive: true }, { projection: { guildId: 1, name: 1, iconUrl: 1, ownerId: 1 } })
    .toArray();
  const botGuildIds = new Set(botServers.map((s) => s.guildId));

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

  const isOwner = isUserOwner(user);

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

const KATA_SERVER_CONFIG_DEFAULTS = {
  systemPrompt: '',
  chatModel: 'fal:google/gemini-3.1-pro-preview',
  imageModel: 'fal-ai/nano-banana-pro',
  videoModel: 'bytedance/seedance-2.0/image-to-video',
  rateLimitPerUser: 30,
  allowedChannels: [],
};

function buildServerGuildPayload(guildId, serverDoc) {
  return {
    id: guildId,
    name: serverDoc.name,
    iconUrl: serverDoc.iconUrl ?? null,
    ownerId: serverDoc.ownerId,
    joinedAt: serverDoc.joinedAt,
  };
}

function resolveServerConfig(config, globalConfig) {
  const guildOverride = {};
  const globalLayer = {};
  const effective = { ...KATA_SERVER_CONFIG_DEFAULTS };
  for (const k of Object.keys(KATA_SERVER_CONFIG_DEFAULTS)) {
    const g = globalConfig ? globalConfig[k] : undefined;
    const p = config ? config[k] : undefined;
    if (g !== undefined && g !== null) {
      globalLayer[k] = g;
      effective[k] = g;
    }
    if (p !== undefined && p !== null) {
      guildOverride[k] = p;
      effective[k] = p;
    }
  }
  return {
    ...effective,
    guildOverride,
    global: globalLayer,
    updatedAt: config?.updatedAt ?? null,
  };
}

async function handleKataServerGet(req, res, guildId) {
  const auth = await authorizeGuildAccess(req, guildId);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });

  const { kataDb, serverDoc } = auth;
  if (String(req.query?.lite || '') === '1') {
    const [config, globalConfig] = await Promise.all([
      kataDb.collection('serverconfigs').findOne({ guildId }),
      kataDb.collection('globalconfigs').findOne({ scope: '_global' }),
    ]);
    return res.status(200).json({
      guild: buildServerGuildPayload(guildId, serverDoc),
      config: resolveServerConfig(config, globalConfig),
      stats: null,
    });
  }

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const since24h = new Date(now - day);
  const since48h = new Date(now - 2 * day);
  const since30d = new Date(now - 30 * day);

  const [config, globalConfig, msg24h, msg48h, img24h, img48h, vid24h, vid48h, cmd24h, cmd48h, cost30d, hourly, topUsers, recent, msgs30d, img30d, vid30d, cmd30d, costByType] = await Promise.all([
    kataDb.collection('serverconfigs').findOne({ guildId }),
    kataDb.collection('globalconfigs').findOne({ scope: '_global' }),
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
    // 30d per-type counts for the overview "activity by type" panel.
    kataDb.collection('chatlogs').countDocuments({ guildId, role: 'user', createdAt: { $gte: since30d } }),
    kataDb.collection('imagegens').countDocuments({ guildId, createdAt: { $gte: since30d } }),
    kataDb.collection('videogens').countDocuments({ guildId, createdAt: { $gte: since30d } }),
    kataDb.collection('commandhistories').countDocuments({ guildId, createdAt: { $gte: since30d } }),
    // 30d cost split by activity type, inferred from the numeric fields the
    // cost ledger already records (video duration / image count / tokens).
    kataDb.collection('costentries').aggregate([
      { $match: { guildId, timestamp: { $gte: since30d } } },
      { $group: {
        _id: { $switch: { branches: [
          { case: { $gt: ['$videoDurationSec', 0] }, then: 'video' },
          { case: { $gt: ['$imagesGen', 0] }, then: 'image' },
          { case: { $or: [{ $gt: ['$tokensIn', 0] }, { $gt: ['$tokensOut', 0] }] }, then: 'chat' },
        ], default: 'command' } },
        cost: { $sum: '$costUSD' },
      } },
    ]).toArray(),
  ]);

  const cost30dTotal = cost30d[0]?.total ?? 0;

  // 30d activity-by-type rows: real per-type counts, with cost folded in from
  // the inferred-type aggregation above.
  const costTypeMap = Object.fromEntries(costByType.map((r) => [r._id, Number(r.cost ?? 0)]));
  const typeCounts = { chat: msgs30d, image: img30d, video: vid30d, command: cmd30d };
  const events30d = msgs30d + img30d + vid30d + cmd30d;
  const byType = ['chat', 'image', 'video', 'command'].map((t) => ({
    type: t,
    count: typeCounts[t],
    cost: costTypeMap[t] ?? 0,
  }));

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
    guild: buildServerGuildPayload(guildId, serverDoc),
    config: (() => {
      // Three layers exposed to the FE:
      //   guildOverride: only fields explicitly set on this guild's doc
      //   global: only fields set in the GlobalConfig doc
      //   effective: code-default ← global ← guildOverride
      // FE picks the right badge per field by checking which layer the
      // value came from (matches the bot's resolution order verbatim).
      // Mirror of the bot's DEFAULT_CONFIG (apps/bot/src/services/guildConfig.ts).
      // chatMode + NSFW thresholds are gone — the bot dropped that machinery.
      const codeDefaults = KATA_SERVER_CONFIG_DEFAULTS;
      const guildOverride = {};
      const globalLayer = {};
      const effective = { ...codeDefaults };
      for (const k of Object.keys(codeDefaults)) {
        const g = globalConfig ? globalConfig[k] : undefined;
        const p = config ? config[k] : undefined;
        if (g !== undefined && g !== null) {
          globalLayer[k] = g;
          effective[k] = g;
        }
        if (p !== undefined && p !== null) {
          guildOverride[k] = p;
          effective[k] = p;
        }
      }
      return {
        ...effective,
        guildOverride,
        global: globalLayer,
        updatedAt: config?.updatedAt ?? null,
      };
    })(),
    stats: {
      kpis: {
        msg24h: { value: msg24h, delta: delta(msg24h, msg48h) },
        img24h: { value: img24h, delta: delta(img24h, img48h) },
        vid24h: { value: vid24h, delta: delta(vid24h, vid48h) },
        cmd24h: { value: cmd24h, delta: delta(cmd24h, cmd48h) },
        cost30d: { value: cost30dTotal },
      },
      hourly: hourBars,
      byType,
      events30d,
      msgs30d,
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
// Validates payload, writes to serverconfigs (upsert); the bot's change
// stream on `serverconfigs` picks the write up and invalidates its cache.
//
// Per-guild surface = systemPrompt / rateLimitPerUser / allowedChannels
// only. Models are owner-managed in GlobalConfig (guild admins may still
// send null to CLEAR a legacy per-guild model override, never set one).
// chatMode + NSFW thresholds were dropped from the bot entirely.

const MAX_SYSPROMPT_LEN = 4000;
const MAX_ALLOWED_CHANNELS = 50;
const LEGACY_UNSET_ONLY_FIELDS = ['chatModel', 'imageModel', 'videoModel', 'chatMode', 'nsfwThresholdNormal', 'nsfwThresholdNsfw'];

async function handleKataServerConfigPatch(req, res, guildId) {
  const auth = await authorizeGuildAccess(req, guildId);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'invalid_json' }); }
  }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'invalid_body' });

  // PATCH semantics:
  //   field omitted   → no change
  //   field === null  → $unset (drop back to inherit from global / code)
  //   field === value → validate then $set
  const update = {};
  const unset = {};
  const errors = [];

  function clearOrSet(field, value) {
    if (value === null) {
      unset[field] = '';
      return true;
    }
    return false;
  }

  if (body.systemPrompt !== undefined) {
    if (!clearOrSet('systemPrompt', body.systemPrompt)) {
      if (typeof body.systemPrompt !== 'string') errors.push('systemPrompt must be string');
      else if (body.systemPrompt.length > MAX_SYSPROMPT_LEN) errors.push(`systemPrompt > ${MAX_SYSPROMPT_LEN} chars`);
      else update.systemPrompt = body.systemPrompt;
    }
  }
  // Legacy fields: bot ignores per-guild values for these now. Accept null
  // so old overrides can be cleaned off the doc, reject any attempt to set.
  for (const field of LEGACY_UNSET_ONLY_FIELDS) {
    if (body[field] !== undefined && !clearOrSet(field, body[field])) {
      errors.push(`${field} is owner-managed globally — set it in /kata/admin?tab=settings (null is allowed here to clear a legacy override)`);
    }
  }
  if (body.rateLimitPerUser !== undefined) {
    if (!clearOrSet('rateLimitPerUser', body.rateLimitPerUser)) {
      const n = Number(body.rateLimitPerUser);
      if (!Number.isFinite(n) || n < 1 || n > 1000) errors.push('rateLimitPerUser must be 1-1000');
      else update.rateLimitPerUser = Math.round(n);
    }
  }
  if (body.allowedChannels !== undefined) {
    if (!clearOrSet('allowedChannels', body.allowedChannels)) {
      if (!Array.isArray(body.allowedChannels)) errors.push('allowedChannels must be array');
      else if (body.allowedChannels.length > MAX_ALLOWED_CHANNELS) errors.push(`allowedChannels > ${MAX_ALLOWED_CHANNELS}`);
      else if (!body.allowedChannels.every((c) => typeof c === 'string' && /^\d{15,21}$/.test(c))) errors.push('allowedChannels entries must be channel ids');
      else update.allowedChannels = body.allowedChannels;
    }
  }

  if (errors.length) return res.status(400).json({ error: 'validation_failed', details: errors });
  if (Object.keys(update).length === 0 && Object.keys(unset).length === 0) {
    return res.status(400).json({ error: 'empty_update' });
  }

  const { kataDb } = auth;
  update.updatedAt = new Date();

  const mongoUpdate = { $set: { ...update, guildId } };
  if (Object.keys(unset).length > 0) mongoUpdate.$unset = unset;
  await kataDb.collection('serverconfigs').updateOne({ guildId }, mongoUpdate, { upsert: true });

  // The bot subscribes to a Mongo change stream on `serverconfigs`, so
  // writing the doc here is the publish — there's no separate fanout step.

  // Audit trail
  try {
    await (await getKataDb()).collection('auditlogs').insertOne({
      actorUserId: auth.user.providerUserId,
      guildId,
      action: 'config_update',
      details: {
        set: Object.keys(update).filter((k) => k !== 'updatedAt'),
        unset: Object.keys(unset),
      },
      createdAt: new Date(),
    });
  } catch { /* audit is best-effort */ }

  const fresh = await kataDb.collection('serverconfigs').findOne({ guildId });
  return res.status(200).json({ ok: true, config: fresh });
}

// ── /api/kata/server/:guildId/memory ────────────────────────────
//
// User-memory admin surface. The bot maintains one `usermemories` doc per
// (guildId, userId) with auto-learned `facts` plus two owner-authored fields:
//   lockedName  — bot always calls the user this, overriding chat/nicknames
//   ownerNotes  — trusted personality/context, never overwritten by learning
// The dashboard may ONLY write those two. `facts`/`turnsSinceExtract` are the
// bot's — never $set them here (clearing facts has its own DELETE route). The
// bot re-reads usermemories fresh every message, so a write here needs no
// publish/restart. Same permission gate as the rest of the per-server API.

const MAX_LOCKED_NAME_LEN = 64;
const MAX_OWNER_NOTES_LEN = 500;
const MAX_FACTS_RETURNED = 50;

function shapeMemory(doc, meta) {
  return {
    userId: doc.userId,
    displayName: meta?.displayName ?? null,
    username: meta?.username ?? null,
    avatarUrl: meta?.avatarUrl ?? null,
    lockedName: doc.lockedName ?? null,
    ownerNotes: doc.ownerNotes ?? null,
    facts: Array.isArray(doc.facts) ? doc.facts.slice(0, MAX_FACTS_RETURNED) : [],
    updatedAt: doc.updatedAt ?? null,
  };
}

async function handleKataServerMemoryList(req, res, guildId) {
  const auth = await authorizeGuildAccess(req, guildId);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  const { kataDb } = auth;

  const page = Math.max(1, parseInt(req.query?.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query?.limit, 10) || 50));
  const q = typeof req.query?.q === 'string' ? req.query.q.trim().toLowerCase() : '';

  const docs = await kataDb.collection('usermemories')
    .find({ guildId }, { projection: { userId: 1, lockedName: 1, ownerNotes: 1, facts: 1, updatedAt: 1 } })
    .toArray();

  const meta = await hydrateUsernames(kataDb, docs.map((d) => d.userId));
  let items = docs.map((d) => shapeMemory(d, meta[d.userId]));

  // Optional name/id filter (client can also filter the short list locally).
  if (q) {
    items = items.filter((it) =>
      (it.displayName || '').toLowerCase().includes(q)
      || (it.username || '').toLowerCase().includes(q)
      || it.userId.includes(q));
  }

  // Owner-tagged rows (locked name or notes) float to the top, then newest.
  items.sort((a, b) => {
    const aTag = (a.lockedName || a.ownerNotes) ? 1 : 0;
    const bTag = (b.lockedName || b.ownerNotes) ? 1 : 0;
    if (aTag !== bTag) return bTag - aTag;
    return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
  });

  const total = items.length;
  const start = (page - 1) * limit;
  return res.status(200).json({
    items: items.slice(start, start + limit),
    page,
    limit,
    total,
    hasMore: start + limit < total,
  });
}

async function handleKataServerMemoryPatch(req, res, guildId, userId) {
  const auth = await authorizeGuildAccess(req, guildId);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'invalid_json' }); }
  }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'invalid_body' });

  // Whitelist: lockedName + ownerNotes only. Everything else (notably `facts`)
  // is silently ignored so a stray/malicious field can never touch bot state.
  const set = {};
  const errors = [];

  if (body.lockedName !== undefined) {
    if (body.lockedName === null) set.lockedName = null;
    else if (typeof body.lockedName !== 'string') errors.push('lockedName must be string or null');
    else {
      const v = body.lockedName.trim();
      if (v.length > MAX_LOCKED_NAME_LEN) errors.push(`lockedName > ${MAX_LOCKED_NAME_LEN} chars`);
      else set.lockedName = v === '' ? null : v; // empty string clears the lock
    }
  }
  if (body.ownerNotes !== undefined) {
    if (body.ownerNotes === null) set.ownerNotes = null;
    else if (typeof body.ownerNotes !== 'string') errors.push('ownerNotes must be string or null');
    else {
      const v = body.ownerNotes.trim();
      if (v.length > MAX_OWNER_NOTES_LEN) errors.push(`ownerNotes > ${MAX_OWNER_NOTES_LEN} chars`);
      else set.ownerNotes = v === '' ? null : v;
    }
  }

  if (errors.length) return res.status(400).json({ error: 'validation_failed', details: errors });
  if (Object.keys(set).length === 0) return res.status(400).json({ error: 'empty_update' });

  const { kataDb } = auth;
  set.updatedAt = new Date();
  await kataDb.collection('usermemories').updateOne(
    { guildId, userId },
    { $set: { ...set, guildId, userId } },
    { upsert: true },
  );

  try {
    await kataDb.collection('auditlogs').insertOne({
      actorUserId: auth.user.providerUserId,
      guildId,
      action: 'memory_update',
      details: { userId, set: Object.keys(set).filter((k) => k !== 'updatedAt') },
      createdAt: new Date(),
    });
  } catch { /* audit is best-effort */ }

  const fresh = await kataDb.collection('usermemories').findOne({ guildId, userId });
  const meta = await hydrateUsernames(kataDb, [userId]);
  return res.status(200).json({ ok: true, item: shapeMemory(fresh, meta[userId]) });
}

async function handleKataServerMemoryFactsDelete(req, res, guildId, userId) {
  const auth = await authorizeGuildAccess(req, guildId);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  const { kataDb } = auth;

  const existing = await kataDb.collection('usermemories').findOne({ guildId, userId });
  if (!existing) return res.status(404).json({ error: 'not_found' });

  // Clear only the auto-learned facts; keep lockedName/ownerNotes intact.
  await kataDb.collection('usermemories').updateOne(
    { guildId, userId },
    { $set: { facts: [], updatedAt: new Date() } },
  );
  try {
    await kataDb.collection('auditlogs').insertOne({
      actorUserId: auth.user.providerUserId,
      guildId,
      action: 'memory_facts_clear',
      details: { userId },
      createdAt: new Date(),
    });
  } catch { /* audit is best-effort */ }

  const fresh = await kataDb.collection('usermemories').findOne({ guildId, userId });
  const meta = await hydrateUsernames(kataDb, [userId]);
  return res.status(200).json({ ok: true, item: shapeMemory(fresh, meta[userId]) });
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
  const includeTotal = String(req.query?.count ?? '1') !== '0';
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
  if (!cursorRaw && includeTotal) {
    try {
      total = await kataDb.collection(spec.coll).countDocuments(filter);
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
  const includeTotal = String(req.query?.count ?? '1') !== '0';
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
  if (!cursorRaw && includeTotal) {
    try {
      total = await kataDb.collection(spec.coll).countDocuments(filter);
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

  // Resolve author names from katasusers — same as the admin logs handler.
  // Missing entries stay null and the UI falls back to the snowflake suffix.
  const userIds = [...new Set(sanitized.map((r) => r.userId).filter(Boolean))];
  const userMeta = userIds.length > 0 ? await hydrateUsernames(kataDb, userIds) : {};

  return res.status(200).json({
    type,
    items: sanitized.map((r) => ({ ...r, user: userMeta[r.userId] ?? null })),
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

const ADMIN_SECTIONS = new Set(['servers', 'logs', 'cost', 'models', 'health', 'global-config']);
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

  if (!isUserOwner(user)) {
    return { error: 'forbidden', status: 403, message: 'Owner only' };
  }
  return { user, ownerId: process.env.OWNER_DISCORD_ID?.trim() || DEFAULT_OWNER_DISCORD_ID };
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
    case 'global-config': return adminGlobalConfigGet(req, res, kataDb);
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

// ── /admin/servers/:guildId/invite ─────────────────────────────
// Resolve a Discord invite link into a guild the bot is already in. Tried in
// order: (1) an invite/vanity URL stored on the server doc, (2) the bot
// minting a fresh 7-day instant invite (needs DISCORD_BOT_TOKEN + a channel
// where the bot has CREATE_INSTANT_INVITE), (3) the guild widget's public
// instant invite (only if the guild enabled its widget). Cached 30min.
async function handleKataAdminServerInvite(req, res, guildId) {
  const auth = await requireOwner(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error, message: auth.message });

  const kataDb = await getKataDb();
  const server = await kataDb.collection('servers').findOne(
    { guildId },
    { projection: { guildId: 1, name: 1, isActive: 1, inviteUrl: 1, vanityUrl: 1 } },
  );
  if (!server) return res.status(404).json({ error: 'not_in_guild', message: 'Bot không ở trong server này.' });

  const { value } = await cached(`kata:admin:invite:${guildId}`, 1800, async () => {
    // 1) stored link wins — zero API cost, survives token/widget gaps.
    const stored = server.inviteUrl || server.vanityUrl;
    if (stored) return { url: String(stored), source: 'stored' };

    // 2) mint via the bot (most reliable when configured).
    const botToken = env('DISCORD_BOT_TOKEN');
    if (botToken) {
      const minted = await createBotInvite(guildId, botToken);
      if (minted) return { url: minted, source: 'bot' };
    }

    // 3) public widget fallback — works without any secret, but only when the
    //    guild has its widget enabled.
    const widget = await fetchWidgetInvite(guildId);
    if (widget) return { url: widget, source: 'widget' };

    return null;
  });

  if (!value) {
    return res.status(404).json({
      error: 'no_invite',
      message: 'Không tạo được invite. Cần bật server widget hoặc đặt DISCORD_BOT_TOKEN cho web.',
    });
  }
  return res.status(200).json({ guildId, ...value });
}

// Create a 7-day instant invite. Walks the guild's text/announcement channels
// (by position) until one accepts the invite — channels can individually deny
// the bot CREATE_INSTANT_INVITE, so a single 403 isn't fatal.
async function createBotInvite(guildId, botToken) {
  const headers = { Authorization: `Bot ${botToken}` };
  let channels;
  try {
    const r = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, { headers });
    if (!r.ok) return null;
    channels = await r.json();
  } catch { return null; }
  if (!Array.isArray(channels)) return null;

  const candidates = channels
    .filter((c) => c.type === 0 || c.type === 5) // GUILD_TEXT, GUILD_ANNOUNCEMENT
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .slice(0, 6);

  for (const ch of candidates) {
    try {
      const r = await fetch(`https://discord.com/api/v10/channels/${ch.id}/invites`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ max_age: 604800, max_uses: 0, unique: false }),
      });
      if (r.ok) {
        const inv = await r.json();
        if (inv?.code) return `https://discord.gg/${inv.code}`;
      }
    } catch { /* try next channel */ }
  }
  return null;
}

// Public guild widget — returns instant_invite when the guild enabled it.
async function fetchWidgetInvite(guildId) {
  try {
    const r = await fetch(`https://discord.com/api/v10/guilds/${guildId}/widget.json`);
    if (!r.ok) return null;
    const w = await r.json();
    return w?.instant_invite || null;
  } catch { return null; }
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

  // Hydrate the message author (chat / image / video / command logs all
  // store userId). The dashboard wants displayName + avatar to render the
  // row, not the bare snowflake. Bot writes katasusers on every mention.
  const userIds = [...new Set(trimmed.map((r) => r.userId).filter(Boolean))];
  const userMeta = userIds.length > 0 ? await hydrateUsernames(kataDb, userIds) : {};

  return res.status(200).json({
    type,
    items: trimmed.map((r) => ({
      ...r,
      guild: guildMeta[r.guildId] ?? { name: r.guildId, iconUrl: null },
      user: userMeta[r.userId] ?? null,
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

// ── /admin/global-config ──────────────────────────────────────
//
// GET  → returns the single GlobalConfig doc (scope='_global'). Fields
//         the owner hasn't set are simply absent so the dashboard can
//         show "(inherited from code default)" as placeholder text.
// PATCH → owner sets / unsets fields. Sending a field as `null` clears
//         it (drops back to code default). Validation reuses the per-
//         guild rules since the field shape is identical.

const GLOBAL_SCOPE = '_global';

async function adminGlobalConfigGet(req, res, kataDb) {
  const doc = await kataDb.collection('globalconfigs').findOne({ scope: GLOBAL_SCOPE });
  return res.status(200).json({
    config: doc ?? { scope: GLOBAL_SCOPE },
    // Mirror of the bot's DEFAULT_CONFIG (apps/bot/src/services/guildConfig.ts).
    codeDefaults: {
      systemPrompt: '',
      chatModel: 'fal:google/gemini-3.1-pro-preview',
      imageModel: 'fal-ai/nano-banana-pro',
      videoModel: 'bytedance/seedance-2.0/image-to-video',
      rateLimitPerUser: 30,
      allowedChannels: [],
    },
  });
}

async function handleKataAdminGlobalConfigPatch(req, res) {
  const auth = await requireOwner(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error, message: auth.message });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'invalid_json' }); }
  }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'invalid_body' });

  // Build $set / $unset from the input. null → unset (drop back to code
  // default); undefined → leave alone; value → validate then set.
  const set = {};
  const unset = {};
  const errors = [];

  function take(field, validate) {
    if (!(field in body)) return;
    const v = body[field];
    if (v === null) {
      unset[field] = '';
      return;
    }
    const result = validate(v);
    if (result.error) errors.push(result.error);
    else set[field] = result.value;
  }

  take('systemPrompt', (v) =>
    typeof v !== 'string'
      ? { error: 'systemPrompt must be string' }
      : v.length > MAX_SYSPROMPT_LEN
        ? { error: `systemPrompt > ${MAX_SYSPROMPT_LEN} chars` }
        : { value: v },
  );
  take('chatModel', (v) =>
    typeof v !== 'string' || !v.trim()
      ? { error: 'chatModel must be non-empty string' }
      : { value: v.trim() },
  );
  take('imageModel', (v) =>
    typeof v !== 'string' || !v.trim()
      ? { error: 'imageModel must be non-empty string' }
      : { value: v.trim() },
  );
  take('videoModel', (v) =>
    typeof v !== 'string' || !v.trim()
      ? { error: 'videoModel must be non-empty string' }
      : { value: v.trim() },
  );
  take('rateLimitPerUser', (v) => {
    const n = Number(v);
    return !Number.isFinite(n) || n < 1 || n > 1000
      ? { error: 'rateLimitPerUser must be 1-1000' }
      : { value: Math.round(n) };
  });
  // chatMode + NSFW thresholds intentionally not taken — dropped from the
  // bot; legacy values can still be cleared by sending null (handled above).
  take('chatMode', () => ({ error: 'chatMode no longer exists in the bot (send null to clear a legacy value)' }));
  take('nsfwThresholdNormal', () => ({ error: 'nsfwThresholdNormal no longer exists in the bot (send null to clear)' }));
  take('nsfwThresholdNsfw', () => ({ error: 'nsfwThresholdNsfw no longer exists in the bot (send null to clear)' }));
  take('allowedChannels', (v) => {
    if (!Array.isArray(v)) return { error: 'allowedChannels must be array' };
    if (v.length > MAX_ALLOWED_CHANNELS) return { error: `allowedChannels > ${MAX_ALLOWED_CHANNELS}` };
    if (!v.every((c) => typeof c === 'string' && /^\d{15,21}$/.test(c))) return { error: 'allowedChannels entries must be channel ids' };
    return { value: v };
  });

  if (errors.length) return res.status(400).json({ error: 'validation_failed', details: errors });
  if (Object.keys(set).length === 0 && Object.keys(unset).length === 0) {
    return res.status(400).json({ error: 'empty_update' });
  }

  set.updatedAt = new Date();

  const kataDb = await getKataDb();
  const update = { $set: { ...set, scope: GLOBAL_SCOPE } };
  if (Object.keys(unset).length > 0) update.$unset = unset;
  await kataDb.collection('globalconfigs').updateOne({ scope: GLOBAL_SCOPE }, update, { upsert: true });

  // The bot subscribes to a Mongo change stream on `globalconfigs`, so the
  // updateOne above triggers cache invalidation across every guild on its
  // own — no separate fanout step.

  // Audit log — same collection as per-guild changes, no guildId.
  try {
    await kataDb.collection('auditlogs').insertOne({
      actorUserId: auth.user.providerUserId,
      action: 'global_config_update',
      details: {
        set: Object.keys(set).filter((k) => k !== 'updatedAt'),
        unset: Object.keys(unset),
      },
      createdAt: new Date(),
    });
  } catch { /* audit is best-effort */ }

  const fresh = await kataDb.collection('globalconfigs').findOne({ scope: GLOBAL_SCOPE });
  return res.status(200).json({ ok: true, config: fresh });
}

// ────────────────────────────────────────────────────────────────
// /api/kata/tavern/*  — tavern roleplay system
// ────────────────────────────────────────────────────────────────
//
// Per PLAN-tavern.md §9. Surface:
//
//   GET    /tavern/me/worlds                → user's worlds across guilds
//   GET    /tavern/world/:id                → world detail + recent messages
//   PATCH  /tavern/world/:id                → edit world fields + overrides
//   POST   /tavern/world/:id/end            → /endstory equivalent (lock)
//   GET    /tavern/character                → user's character library
//   POST   /tavern/character                → create
//   PATCH  /tavern/character/:id            → edit
//   DELETE /tavern/character/:id            → delete (rejected if used)
//   POST   /tavern/lore/generate            → AI write lore/rules from brief
//   POST   /tavern/lore/improve             → AI improve a draft
//
// Everything below scopes by `userId === user.providerUserId` (Discord id).
// Owner sees everyone's data on the dedicated /admin/* surface, not here.

const TAVERN_FIELD_LIMITS = {
  name: 100,
  setting: 1500,
  lore: 30_000,
  rules: 1500,
  imageStyle: 200,
  imageBasePrompt: 600,
  greeting: 600,
  persona: 1500,
  appearance: 1500,
  storytellerSystemPrompt: 16_000,
  modeInstruction: 4_000,
  difficulty: 4_000,
  outputRules: 4_000,
  imagePromptTemplate: 1_500,
  imageNegativePrompt: 1_500,
  modelId: 200,
};

// Each entry: [field-name, kind].
//   string: validated against TAVERN_FIELD_LIMITS[kind]
//   number: numeric range (min,max)
//   array:  array of model-ids (each ≤ TAVERN_FIELD_LIMITS.modelId), max 8 entries
const TAVERN_OVERRIDE_FIELDS = [
  ['storytellerSystemPrompt', 'string', 'storytellerSystemPrompt'],
  ['modeInstructionChat', 'string', 'modeInstruction'],
  ['modeInstructionRpg', 'string', 'modeInstruction'],
  ['difficultyEasy', 'string', 'difficulty'],
  ['difficultyNormal', 'string', 'difficulty'],
  ['difficultyHard', 'string', 'difficulty'],
  ['outputRules', 'string', 'outputRules'],
  ['imagePromptTemplate', 'string', 'imagePromptTemplate'],
  ['imageNegativePrompt', 'string', 'imageNegativePrompt'],
  // Model picks — strings, validated as model ids (≤200 chars, non-empty).
  ['chatModel', 'string', 'modelId'],
  ['loreModel', 'string', 'modelId'],
  ['worldGenModel', 'string', 'modelId'],
  ['subjectModel', 'string', 'modelId'],
  // Numeric ranges — turn temperature/max_tokens/memory window.
  ['turnTemperature', 'number', { min: 0, max: 2 }],
  ['turnMaxTokens', 'number', { min: 1, max: 32_000 }],
  ['memoryWindowSize', 'number', { min: 1, max: 500 }],
  // Array of model ids — fal model fallback chains.
  ['sceneImageModels', 'array', 'modelId'],
  ['coverImageModels', 'array', 'modelId'],
];

async function requireUser(req) {
  const session = readSession(req);
  if (!session?.uid) return { error: 'unauthenticated', status: 401 };
  let userOid;
  try { userOid = new ObjectId(session.uid); }
  catch { return { error: 'bad_session', status: 401 }; }
  const user = await (await getUsers()).findOne({ _id: userOid });
  if (!user) return { error: 'user_not_found', status: 401 };
  const isOwner = isUserOwner(user);
  // Tavern player paths still need a Discord identity (turns are written
  // against providerUserId). Email-only owners can read but not write a
  // player turn — that's fine, they're not playing.
  if ((user.provider !== 'discord' || !user.providerUserId) && !isOwner) {
    return { error: 'discord_required', status: 403 };
  }
  return {
    user,
    isOwner,
    ownerId: process.env.OWNER_DISCORD_ID?.trim() || DEFAULT_OWNER_DISCORD_ID,
  };
}

async function handleKataTavern(req, res, sub) {
  const path = sub.replace(/^\/+|\/+$/g, '');

  if (path === 'me/worlds' && req.method === 'GET') return tavernMyWorlds(req, res);

  if (path === 'world' && req.method === 'POST') return tavernWorldCreate(req, res);

  const worldMatch = path.match(/^world\/([a-f0-9]{24})(?:\/(end))?$/i);
  if (worldMatch) {
    const [, id, action] = worldMatch;
    if (action === 'end' && req.method === 'POST') return tavernWorldEnd(req, res, id);
    if (!action && req.method === 'GET') return tavernWorldGet(req, res, id);
    if (!action && req.method === 'PATCH') return tavernWorldPatch(req, res, id);
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  if (path === 'character') {
    if (req.method === 'GET') return tavernCharacterList(req, res);
    if (req.method === 'POST') return tavernCharacterCreate(req, res);
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  const charMatch = path.match(/^character\/([a-f0-9]{24})$/i);
  if (charMatch) {
    const [, id] = charMatch;
    if (req.method === 'PATCH') return tavernCharacterPatch(req, res, id);
    if (req.method === 'DELETE') return tavernCharacterDelete(req, res, id);
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  if (path === 'lore/generate' && req.method === 'POST') return tavernLoreGenerate(req, res);
  if (path === 'lore/improve' && req.method === 'POST') return tavernLoreImprove(req, res);

  // Cover-art generation. POST { name, setting, coverPromptSeed?, imageStyle? } → { url }.
  // Uses fal flux-schnell directly so it's fast + cheap. Mirrors result to
  // R2-equivalent storage isn't available on se77n yet — we hand back fal's
  // CDN URL and let the client persist it via PATCH /world/:id { coverImageUrl }.
  if (path === 'cover/generate' && req.method === 'POST') return tavernCoverGenerate(req, res);

  // Web roleplay turn (Phase T6). Submits player text, returns bot reply
  // synchronously. Same persistence side-effects as the bot's roleplay path.
  const turnMatch = path.match(/^world\/([a-f0-9]{24})\/turn$/i);
  if (turnMatch && req.method === 'POST') return tavernWorldTurn(req, res, turnMatch[1]);

  // Scene illustration for the latest narrator turn. Generated in a separate
  // request (after /turn returns text) so it never blocks / times out the turn.
  const sceneImgMatch = path.match(/^world\/([a-f0-9]{24})\/scene-image$/i);
  if (sceneImgMatch && req.method === 'POST') return tavernWorldSceneImage(req, res, sceneImgMatch[1]);

  return res.status(404).json({ error: 'tavern_not_found', path });
}

// ── Worlds ──────────────────────────────────────────────────────

// Web-created worlds aren't tied to a Discord forum thread. We synthesize a
// `threadId` with a `web:` prefix so the unique-index on TavernWorld.threadId
// stays satisfied without colliding with real Discord snowflakes.
function makeWebThreadId() {
  return `web:${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

const WORLD_NAME_MAX = 100;
const WORLD_SETTING_MAX = 1500;
const WORLD_LORE_MAX = 30_000;
const WORLD_RULES_MAX = 1500;
const IMAGE_STYLE_MAX = 200;

async function tavernWorldCreate(req, res) {
  const auth = await requireUser(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'invalid_json' }); }
  }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'invalid_body' });

  const errors = [];
  function strReq(name, max) {
    const v = body[name];
    if (typeof v !== 'string' || !v.trim()) return errors.push(`${name} required`);
    if (v.length > max) return errors.push(`${name} > ${max} chars`);
  }
  function strOpt(name, max) {
    if (!(name in body)) return;
    const v = body[name];
    if (typeof v !== 'string') return errors.push(`${name} must be string`);
    if (v.length > max) return errors.push(`${name} > ${max} chars`);
  }
  strReq('name', WORLD_NAME_MAX);
  strReq('setting', WORLD_SETTING_MAX);
  strOpt('lore', WORLD_LORE_MAX);
  strOpt('rules', WORLD_RULES_MAX);
  strOpt('imageStyle', IMAGE_STYLE_MAX);
  if (!['chat', 'rpg'].includes(body.mode)) errors.push('mode invalid (chat | rpg)');
  if ('difficulty' in body && !['easy', 'normal', 'hard'].includes(body.difficulty)) {
    errors.push('difficulty invalid');
  }
  if ('participation' in body && !['creator_only', 'anyone'].includes(body.participation)) {
    errors.push('participation invalid');
  }
  if ('imageGenEnabled' in body && typeof body.imageGenEnabled !== 'boolean') {
    errors.push('imageGenEnabled must be boolean');
  }

  // Optional character link or inline shape.
  let characterOid = null;
  if (body.characterId) {
    try { characterOid = new ObjectId(body.characterId); }
    catch { errors.push('invalid characterId'); }
  }
  let characterInline = null;
  if (body.characterInline && typeof body.characterInline === 'object') {
    const ci = body.characterInline;
    if (ci.name && typeof ci.name !== 'string') errors.push('characterInline.name must be string');
    if (ci.appearance && typeof ci.appearance !== 'string') errors.push('characterInline.appearance must be string');
    characterInline = {
      name: typeof ci.name === 'string' ? ci.name.slice(0, 200) : null,
      appearance: typeof ci.appearance === 'string' ? ci.appearance.slice(0, 1500) : null,
    };
  }

  if (errors.length) return res.status(400).json({ error: 'validation_failed', details: errors });

  const kataDb = await getKataDb();

  // Verify the character exists and belongs to the user (if linked).
  if (characterOid) {
    const c = await kataDb.collection('tavern_characters').findOne({ _id: characterOid });
    if (!c) return res.status(400).json({ error: 'character_not_found' });
    if (c.userId !== auth.user.providerUserId && !auth.isOwner) {
      return res.status(403).json({ error: 'character_not_yours' });
    }
  }

  const now = new Date();
  const worldDoc = {
    userId: auth.user.providerUserId,
    // Web-only worlds aren't scoped to a Discord guild. We tag them with a
    // sentinel so the bot's per-guild aggregations skip them cleanly.
    guildId: typeof body.guildId === 'string' && body.guildId ? body.guildId : 'web',
    name: body.name.trim(),
    setting: body.setting,
    lore: body.lore ?? '',
    rules: body.rules ?? '',
    characterId: characterOid,
    characterInline,
    mode: body.mode,
    difficulty: body.difficulty ?? 'normal',
    visibility: 'public',
    participation: body.participation ?? 'creator_only',
    imageGenEnabled: body.imageGenEnabled ?? false, // default off for web — fal cost
    imageStyle: body.imageStyle ?? 'cinematic detailed',
    coverImageUrl: typeof body.coverImageUrl === 'string' && /^https?:\/\//i.test(body.coverImageUrl) ? body.coverImageUrl : null,
    coverGenerated: false,
    forumChannelId: '',
    threadId: makeWebThreadId(),
    appliedTagIds: [],
    isLocked: false,
    overrides: {},
    lastActiveAt: now,
    createdAt: now,
    updatedAt: now,
  };

  let inserted;
  try {
    inserted = await kataDb.collection('tavern_worlds').insertOne(worldDoc);
  } catch (err) {
    return res.status(500).json({ error: 'world_insert_failed', message: err?.message });
  }

  // Empty session shell — opening generation is on-demand via /turn (the
  // first reply will use the world's lore as system context). Keeping the
  // create flow snappy — no LLM call inside this endpoint.
  await kataDb.collection('tavern_sessions').insertOne({
    worldId: inserted.insertedId,
    userId: auth.user.providerUserId,
    threadId: worldDoc.threadId,
    messages: [],
    summary: '',
    directorNotes: [],
    pendingImageJobId: null,
    messageCount: 0,
    lastSummaryAt: null,
    startedAt: now,
    lastActiveAt: now,
    endedAt: null,
    createdAt: now,
    updatedAt: now,
  });

  try {
    await kataDb.collection('auditlogs').insertOne({
      actorUserId: auth.user.providerUserId,
      action: 'tavern.worldCreateWeb',
      details: { worldId: String(inserted.insertedId), name: worldDoc.name, mode: worldDoc.mode },
      createdAt: now,
    });
  } catch { /* best-effort */ }

  return res.status(200).json({
    ok: true,
    world: { ...worldDoc, _id: inserted.insertedId },
  });
}

async function tavernMyWorlds(req, res) {
  const auth = await requireUser(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  const kataDb = await getKataDb();
  const worlds = await kataDb
    .collection('tavern_worlds')
    .find({ userId: auth.user.providerUserId })
    .project({ name: 1, guildId: 1, mode: 1, difficulty: 1, isLocked: 1, threadId: 1, lastActiveAt: 1, imageGenEnabled: 1, imageStyle: 1, coverImageUrl: 1, createdAt: 1, setting: 1 })
    .sort({ lastActiveAt: -1 })
    .limit(100)
    .toArray();
  // Pull turn counts from sessions in one query.
  const ids = worlds.map((w) => w._id);
  const sessions = await kataDb
    .collection('tavern_sessions')
    .find({ worldId: { $in: ids } }, { projection: { worldId: 1, messageCount: 1 } })
    .toArray();
  const countMap = new Map(sessions.map((s) => [String(s.worldId), s.messageCount ?? 0]));
  return res.status(200).json({
    worlds: worlds.map((w) => ({ ...w, messageCount: countMap.get(String(w._id)) ?? 0 })),
  });
}

async function loadTavernWorldOrFail(kataDb, id, auth) {
  let worldOid;
  try { worldOid = new ObjectId(id); } catch { return { error: 'invalid_id', status: 400 }; }
  const world = await kataDb.collection('tavern_worlds').findOne({ _id: worldOid });
  if (!world) return { error: 'not_found', status: 404 };
  if (world.userId !== auth.user.providerUserId && !auth.isOwner) {
    return { error: 'forbidden', status: 403 };
  }
  return { world };
}

function tavernMessageLimit(req, fallback = 120) {
  const n = Number.parseInt(req.query?.limit, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(200, Math.max(1, n));
}

async function tavernWorldGet(req, res, id) {
  const auth = await requireUser(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  const kataDb = await getKataDb();
  const r = await loadTavernWorldOrFail(kataDb, id, auth);
  if (r.error) return res.status(r.status).json({ error: r.error });

  const limit = tavernMessageLimit(req);
  const [session, character] = await Promise.all([
    kataDb
      .collection('tavern_sessions')
      .findOne(
        { worldId: r.world._id },
        {
          projection: {
            summary: 1,
            directorNotes: 1,
            messageCount: 1,
            messages: { $slice: -(limit * 2) },
          },
        },
      ),
    r.world.characterId
      ? kataDb.collection('tavern_characters').findOne({ _id: r.world.characterId })
      : Promise.resolve(null),
  ]);

  // Truncate to the last non-OOC messages so the response stays bounded.
  const allMessages = (session?.messages ?? []).filter((m) => !m.isOOC);
  const messages = allMessages.slice(-limit);

  return res.status(200).json({
    world: r.world,
    character,
    summary: session?.summary ?? '',
    directorNotes: session?.directorNotes ?? [],
    messageCount: session?.messageCount ?? allMessages.length,
    messages,
  });
}

async function tavernWorldPatch(req, res, id) {
  const auth = await requireUser(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  const kataDb = await getKataDb();
  const r = await loadTavernWorldOrFail(kataDb, id, auth);
  if (r.error) return res.status(r.status).json({ error: r.error });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'invalid_json' }); }
  }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'invalid_body' });

  const set = {};
  const errors = [];

  function strField(name, max) {
    if (!(name in body)) return;
    const v = body[name];
    if (typeof v !== 'string') return errors.push(`${name} must be string`);
    if (v.length > max) return errors.push(`${name} > ${max} chars`);
    set[name] = v;
  }

  strField('name', TAVERN_FIELD_LIMITS.name);
  strField('setting', TAVERN_FIELD_LIMITS.setting);
  strField('lore', TAVERN_FIELD_LIMITS.lore);
  strField('rules', TAVERN_FIELD_LIMITS.rules);
  strField('imageStyle', TAVERN_FIELD_LIMITS.imageStyle);

  if ('coverImageUrl' in body) {
    if (body.coverImageUrl === null || body.coverImageUrl === '') {
      set.coverImageUrl = null;
    } else if (typeof body.coverImageUrl !== 'string') {
      errors.push('coverImageUrl must be string or null');
    } else if (!/^https?:\/\//i.test(body.coverImageUrl)) {
      errors.push('coverImageUrl must start with http(s)://');
    } else {
      set.coverImageUrl = body.coverImageUrl;
    }
  }

  if ('imageGenEnabled' in body) {
    if (typeof body.imageGenEnabled !== 'boolean') errors.push('imageGenEnabled must be boolean');
    else set.imageGenEnabled = body.imageGenEnabled;
  }
  if ('participation' in body) {
    if (!['creator_only', 'anyone'].includes(body.participation)) errors.push('participation invalid');
    else set.participation = body.participation;
  }
  if ('difficulty' in body) {
    if (!['easy', 'normal', 'hard'].includes(body.difficulty)) errors.push('difficulty invalid');
    else set.difficulty = body.difficulty;
  }

  // Overrides subdoc — null on a field clears it (drops back to global/default).
  if ('overrides' in body) {
    const ov = body.overrides;
    if (ov === null) {
      set.overrides = {};
    } else if (typeof ov !== 'object') {
      errors.push('overrides must be object or null');
    } else {
      const cleaned = {};
      for (const [field, kind, meta] of TAVERN_OVERRIDE_FIELDS) {
        if (!(field in ov)) continue;
        const v = ov[field];
        if (v === null || v === '') continue; // unset
        if (kind === 'string') {
          if (typeof v !== 'string') { errors.push(`overrides.${field} must be string`); continue; }
          if (v.length > TAVERN_FIELD_LIMITS[meta]) {
            errors.push(`overrides.${field} > ${TAVERN_FIELD_LIMITS[meta]} chars`);
            continue;
          }
          cleaned[field] = v;
        } else if (kind === 'number') {
          const n = Number(v);
          if (!Number.isFinite(n)) { errors.push(`overrides.${field} must be number`); continue; }
          if (n < meta.min || n > meta.max) {
            errors.push(`overrides.${field} must be ${meta.min}..${meta.max}`);
            continue;
          }
          cleaned[field] = n;
        } else if (kind === 'array') {
          if (!Array.isArray(v)) { errors.push(`overrides.${field} must be array`); continue; }
          if (v.length > 8) { errors.push(`overrides.${field} > 8 entries`); continue; }
          if (!v.every((s) => typeof s === 'string' && s.trim() && s.length <= TAVERN_FIELD_LIMITS[meta])) {
            errors.push(`overrides.${field} entries must be non-empty strings ≤ ${TAVERN_FIELD_LIMITS[meta]} chars`);
            continue;
          }
          cleaned[field] = v.map((s) => s.trim());
        }
      }
      set.overrides = cleaned;
    }
  }

  if (errors.length) return res.status(400).json({ error: 'validation_failed', details: errors });
  if (Object.keys(set).length === 0) return res.status(400).json({ error: 'empty_update' });

  set.lastActiveAt = new Date();
  await kataDb.collection('tavern_worlds').updateOne({ _id: r.world._id }, { $set: set });

  try {
    await kataDb.collection('auditlogs').insertOne({
      actorUserId: auth.user.providerUserId,
      action: 'tavern.worldEditWeb',
      details: { worldId: String(r.world._id), keys: Object.keys(set) },
      createdAt: new Date(),
    });
  } catch { /* best-effort */ }

  const fresh = await kataDb.collection('tavern_worlds').findOne({ _id: r.world._id });
  return res.status(200).json({ ok: true, world: fresh });
}

async function tavernWorldEnd(req, res, id) {
  const auth = await requireUser(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  const kataDb = await getKataDb();
  const r = await loadTavernWorldOrFail(kataDb, id, auth);
  if (r.error) return res.status(r.status).json({ error: r.error });
  if (r.world.isLocked) return res.status(400).json({ error: 'already_locked' });

  await kataDb.collection('tavern_worlds').updateOne(
    { _id: r.world._id },
    { $set: { isLocked: true, lastActiveAt: new Date() } },
  );
  await kataDb.collection('tavern_sessions').updateOne(
    { worldId: r.world._id },
    { $set: { endedAt: new Date() } },
  );
  // Discord side-effects (thread lock + archive divider) are bot-only — the
  // bot's tavern world cache invalidates on next message hit; the locked
  // post will simply stop accepting bot replies.
  try {
    await kataDb.collection('auditlogs').insertOne({
      actorUserId: auth.user.providerUserId,
      action: 'tavern.endStoryWeb',
      details: { worldId: String(r.world._id), worldName: r.world.name },
      createdAt: new Date(),
    });
  } catch { /* best-effort */ }
  return res.status(200).json({ ok: true });
}

// ── Character library ──────────────────────────────────────────

async function tavernCharacterList(req, res) {
  const auth = await requireUser(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  const kataDb = await getKataDb();
  const chars = await kataDb
    .collection('tavern_characters')
    .find({ userId: auth.user.providerUserId })
    .sort({ updatedAt: -1 })
    .limit(200)
    .toArray();
  return res.status(200).json({ characters: chars });
}

function validateCharacterBody(body, errors, partial = false) {
  function fld(name, max, required) {
    if (!(name in body)) {
      if (required && !partial) errors.push(`${name} required`);
      return;
    }
    const v = body[name];
    if (typeof v !== 'string') return errors.push(`${name} must be string`);
    if (required && !v.trim()) return errors.push(`${name} required`);
    if (v.length > max) return errors.push(`${name} > ${max} chars`);
  }
  fld('name', TAVERN_FIELD_LIMITS.name, true);
  fld('persona', TAVERN_FIELD_LIMITS.persona, false);
  fld('appearance', TAVERN_FIELD_LIMITS.appearance, false);
  fld('greeting', TAVERN_FIELD_LIMITS.greeting, false);
  fld('imageBasePrompt', TAVERN_FIELD_LIMITS.imageBasePrompt, false);
}

async function tavernCharacterCreate(req, res) {
  const auth = await requireUser(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'invalid_json' }); }
  }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'invalid_body' });
  const errors = [];
  validateCharacterBody(body, errors, false);
  if (errors.length) return res.status(400).json({ error: 'validation_failed', details: errors });

  const now = new Date();
  const doc = {
    userId: auth.user.providerUserId,
    name: body.name.trim(),
    persona: body.persona ?? '',
    appearance: body.appearance ?? '',
    greeting: body.greeting ?? '',
    imageBasePrompt: body.imageBasePrompt ?? '',
    isAdult: true,
    createdAt: now,
    updatedAt: now,
  };
  const kataDb = await getKataDb();
  try {
    const r = await kataDb.collection('tavern_characters').insertOne(doc);
    return res.status(200).json({ ok: true, character: { ...doc, _id: r.insertedId } });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ error: 'duplicate_name', message: 'You already have a character with that name' });
    }
    return res.status(500).json({ error: 'insert_failed', message: err?.message });
  }
}

async function tavernCharacterPatch(req, res, id) {
  const auth = await requireUser(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  let charOid;
  try { charOid = new ObjectId(id); } catch { return res.status(400).json({ error: 'invalid_id' }); }
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'invalid_json' }); }
  }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'invalid_body' });
  const errors = [];
  validateCharacterBody(body, errors, true);
  if (errors.length) return res.status(400).json({ error: 'validation_failed', details: errors });

  const kataDb = await getKataDb();
  const existing = await kataDb.collection('tavern_characters').findOne({ _id: charOid });
  if (!existing) return res.status(404).json({ error: 'not_found' });
  if (existing.userId !== auth.user.providerUserId && !auth.isOwner) {
    return res.status(403).json({ error: 'forbidden' });
  }

  const set = { updatedAt: new Date() };
  for (const k of ['name', 'persona', 'appearance', 'greeting', 'imageBasePrompt']) {
    if (k in body) set[k] = String(body[k] ?? '');
  }
  if (set.name) set.name = set.name.trim();

  try {
    await kataDb.collection('tavern_characters').updateOne({ _id: charOid }, { $set: set });
  } catch (err) {
    if (err?.code === 11000) return res.status(409).json({ error: 'duplicate_name' });
    return res.status(500).json({ error: 'update_failed', message: err?.message });
  }
  const fresh = await kataDb.collection('tavern_characters').findOne({ _id: charOid });
  return res.status(200).json({ ok: true, character: fresh });
}

async function tavernCharacterDelete(req, res, id) {
  const auth = await requireUser(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  let charOid;
  try { charOid = new ObjectId(id); } catch { return res.status(400).json({ error: 'invalid_id' }); }
  const kataDb = await getKataDb();
  const existing = await kataDb.collection('tavern_characters').findOne({ _id: charOid });
  if (!existing) return res.status(404).json({ error: 'not_found' });
  if (existing.userId !== auth.user.providerUserId && !auth.isOwner) {
    return res.status(403).json({ error: 'forbidden' });
  }
  // Refuse if any world references it — would orphan the protagonist.
  const inUse = await kataDb.collection('tavern_worlds').findOne(
    { characterId: charOid },
    { projection: { _id: 1, name: 1 } },
  );
  if (inUse) {
    return res.status(409).json({
      error: 'character_in_use',
      message: `Used by world "${inUse.name}". Update the world first.`,
    });
  }
  await kataDb.collection('tavern_characters').deleteOne({ _id: charOid });
  return res.status(200).json({ ok: true });
}

// ── Lore / rules AI ────────────────────────────────────────────

const LORE_GEN_SYS = (mode, difficulty) => [
  'You are a world-building assistant for a tabletop / roleplay setting.',
  'Given a short brief from the player, write a rich lore document for the world.',
  '',
  'TARGET',
  `- Mode: ${mode === 'rpg' ? 'RPG / adventure (narrator-driven)' : mode === 'chat' ? 'Chat / 1-1 with NPC' : 'either'}`,
  `- Difficulty hint: ${difficulty || 'normal'}`,
  '',
  'OUTPUT REQUIREMENTS',
  '- 600-1500 words.',
  '- Plain prose paragraphs. No markdown headers, no bullet points, no JSON.',
  '- Cover: setting, key factions, important locations, recent history / current tension, one or two specific NPCs the player will hear about.',
  '- Do NOT invent the player character.',
  '- Adult content / dark themes are allowed when the brief asks for them. Sexualized characters must be adults; never a minor in sexual context.',
  '',
  'Return only the lore prose.',
].join('\n');

const LORE_FIX_SYS = `You polish and expand world-building drafts.

- Keep every name, faction, place, and hook the player wrote — do NOT silently delete things.
- Fix prose flow. Add depth where the draft was thin. Cut repetition.
- Expand to 600-1500 words if the original was shorter; otherwise stay near original length.
- Plain prose paragraphs. No markdown headers, no bullets, no JSON.
- Adult / dark themes stay if present. Only hard rule: no sexualizing minors.

Return only the improved lore prose.`;

const RULES_GEN_SYS = `You write the rules of magic / physics / society for a roleplay world.

- 200-600 words. Plain prose, 3-6 short paragraphs by topic. No bullets, no headers.
- Be concrete: limits, costs, what a player CAN and CANNOT do. Bias toward constraints.
- Do not invent the player character.
- Adult / dark themes allowed. Only hard rule: no sexualizing minors.

Return only the rules prose.`;

const RULES_FIX_SYS = `You polish a player's draft of world rules.

- Keep every constraint the player named. Don't silently relax rules.
- Make each rule concrete (cost, where it fails, who it applies to).
- 200-600 words. Plain prose, 3-6 short paragraphs. No bullets, no headers.
- Adult / dark themes stay if present.

Return only the improved rules prose.`;

async function callYunwuChat(systemPrompt, userContent, maxTokens) {
  // Lore/rules generation — text-only, runs through fal openrouter/router.
  const { text } = await falChat({
    system: systemPrompt,
    prompt: userContent,
    model: process.env.FAL_TAVERN_LORE_MODEL || 'google/gemini-2.5-flash',
    temperature: 0.85,
    maxTokens,
  });
  return text;
}

async function tavernLoreGenerate(req, res) {
  const auth = await requireUser(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'invalid_json' }); }
  }
  const brief = (body?.brief ?? '').toString().trim();
  if (!brief) return res.status(400).json({ error: 'brief_required' });
  const kind = body?.kind === 'rules' ? 'rules' : 'lore';
  const mode = body?.mode === 'rpg' ? 'rpg' : body?.mode === 'chat' ? 'chat' : 'chat';
  const difficulty = ['easy', 'normal', 'hard'].includes(body?.difficulty) ? body.difficulty : 'normal';
  const systemPrompt = kind === 'rules' ? RULES_GEN_SYS : LORE_GEN_SYS(mode, difficulty);
  try {
    const text = await callYunwuChat(systemPrompt, brief, kind === 'rules' ? 900 : 1800);
    return res.status(200).json({ ok: true, text });
  } catch (err) {
    return res.status(502).json({ error: 'llm_failed', message: err?.message?.slice(0, 500) });
  }
}

// ── Cover-art generation ───────────────────────────────────────
//
// POST /api/kata/tavern/cover/generate
// Body: { name?, setting?, coverPromptSeed?, imageStyle?, lore? }
// Returns: { url, model }
//
// Calls fal queue API directly (flux-schnell — fast + cheap, ~3s p50).
// Returns fal's CDN URL; the client persists it via PATCH /world/:id
// { coverImageUrl }. fal CDN expires after 30+ days but cover images are
// re-generatable so we don't bother mirroring to durable storage here.

async function tavernCoverGenerate(req, res) {
  const auth = await requireUser(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'invalid_json' }); }
  }
  const apiKey = process.env.FAL_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'fal_not_configured' });

  const seed = (body?.coverPromptSeed ?? '').toString().trim();
  const style = (body?.imageStyle ?? '').toString().trim() || 'cinematic, detailed, atmospheric, book cover art';
  const settingHint = (body?.setting ?? '').toString().trim();
  const name = (body?.name ?? '').toString().trim();
  const lore = (body?.lore ?? '').toString().trim();

  let prompt = seed;
  if (!prompt) {
    // Heuristic from setting + lore. Yank content-bearing words.
    const blob = `${settingHint}\n${lore}`.replace(/[^\p{L}\p{N}\s,.\-]/gu, ' ');
    const words = blob.split(/\s+/).filter((w) => w.length > 3).slice(0, 14).join(', ').toLowerCase();
    prompt = [name, words || 'wide landscape vista', style].filter(Boolean).join(', ');
  } else {
    prompt = `${prompt}, ${style}`;
  }

  const model = process.env.FAL_TAVERN_COVER_MODEL || 'fal-ai/flux/schnell';
  try {
    const submit = await fetch(`https://queue.fal.run/${model}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Key ${apiKey}` },
      body: JSON.stringify({ prompt }),
    });
    const submitData = await submit.json();
    if (!submit.ok) {
      return res.status(submit.status).json({ error: 'fal_submit_failed', upstream: submitData });
    }
    const requestId = submitData.request_id;
    const statusUrl = submitData.status_url || `https://queue.fal.run/${model}/requests/${requestId}/status`;
    const resultUrl = submitData.response_url || `https://queue.fal.run/${model}/requests/${requestId}`;

    const deadline = Date.now() + 50_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      const s = await fetch(statusUrl, { headers: { Authorization: `Key ${apiKey}` } });
      const sd = await s.json();
      if (sd.status === 'COMPLETED') {
        const finalRes = await fetch(resultUrl, { headers: { Authorization: `Key ${apiKey}` } });
        const final = await finalRes.json();
        const url = final?.images?.[0]?.url ?? final?.image?.url;
        if (!url) return res.status(502).json({ error: 'no_image_url', upstream: final });
        return res.status(200).json({ ok: true, url, model, prompt });
      }
      if (sd.status === 'FAILED' || sd.status === 'CANCELLED') {
        return res.status(502).json({ error: 'fal_' + sd.status.toLowerCase(), upstream: sd });
      }
    }
    return res.status(504).json({ error: 'fal_timeout' });
  } catch (err) {
    return res.status(502).json({ error: 'cover_gen_failed', message: err?.message?.slice(0, 500) });
  }
}

async function tavernLoreImprove(req, res) {
  const auth = await requireUser(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'invalid_json' }); }
  }
  const draft = (body?.draft ?? '').toString().trim();
  if (!draft) return res.status(400).json({ error: 'draft_required' });
  const kind = body?.kind === 'rules' ? 'rules' : 'lore';
  const systemPrompt = kind === 'rules' ? RULES_FIX_SYS : LORE_FIX_SYS;
  try {
    const text = await callYunwuChat(systemPrompt, draft, kind === 'rules' ? 900 : 1800);
    return res.status(200).json({ ok: true, text });
  } catch (err) {
    return res.status(502).json({ error: 'llm_failed', message: err?.message?.slice(0, 500) });
  }
}

// ── Roleplay turn (Phase T6 — web chat) ───────────────────────
//
// Mirrors the bot's runRoleplayTurn:
//   1. Load world + session + character (creator-only access, except owner)
//   2. OOC short-circuit on `((...))` — append to directorNotes, no LLM
//   3. Resolve layered prompt config (per-world > global > engine defaults)
//   4. Build system prompt, splice last 50 non-OOC turns, fire chatFn
//   5. Post-process child-safety
//   6. Persist user + assistant messages, bump messageCount + lastActiveAt
//
// Web turns DO NOT cross-post to Discord — the user picks one venue per
// session. Documented in PLAN-tavern §9.3.

const TAVERN_DEFAULT_MODEL = process.env.OPENROUTER_TAVERN_MODEL?.trim() || 'google/gemini-2.5-pro';
const TAVERN_TURN_TEMPERATURE = 0.85;
const TAVERN_TURN_MAX_TOKENS = 1200;

async function callTavernChat(systemContent, history, userText, model, temperature, maxTokens) {
  // Storyteller turn — text-only, runs through fal openrouter/router.
  return await falChat({
    system: systemContent,
    history,
    prompt: userText,
    model,
    temperature: typeof temperature === 'number' ? temperature : 0.85,
    maxTokens: typeof maxTokens === 'number' ? maxTokens : 1200,
  });
}

async function tavernWorldTurn(req, res, id) {
  const auth = await requireUser(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'invalid_json' }); }
  }
  const userText = (body?.userText ?? '').toString().trim();
  if (!userText) return res.status(400).json({ error: 'userText_required' });
  if (userText.length > 4000) return res.status(400).json({ error: 'userText_too_long' });

  const kataDb = await getKataDb();
  let worldOid;
  try { worldOid = new ObjectId(id); } catch { return res.status(400).json({ error: 'invalid_id' }); }
  const world = await kataDb.collection('tavern_worlds').findOne({ _id: worldOid });
  if (!world) return res.status(404).json({ error: 'not_found' });

  // Web-side participation gate matches Discord-side: creator only on
  // creator_only worlds (owner can ride along for testing). Anyone-mode
  // worlds let any logged-in user participate.
  const myDiscordId = auth.user.providerUserId;
  if (world.userId !== myDiscordId && world.participation === 'creator_only' && !auth.isOwner) {
    return res.status(403).json({ error: 'forbidden' });
  }
  if (world.isLocked) return res.status(409).json({ error: 'world_locked' });

  const session = await kataDb.collection('tavern_sessions').findOne({ worldId: world._id });
  if (!session) return res.status(500).json({ error: 'session_missing' });

  // OOC short-circuit — no LLM round-trip.
  const parsed = tavernParseOOC(userText);
  if (parsed.isOOC) {
    const directorNotes = session.directorNotes ?? [];
    tavernApplyOOC(directorNotes, parsed.body);
    const userMsg = { role: 'user', content: userText, timestamp: Date.now(), isOOC: true };
    await kataDb.collection('tavern_sessions').updateOne(
      { _id: session._id },
      {
        $set: { directorNotes, lastActiveAt: new Date() },
        $push: { messages: userMsg },
        $inc: { messageCount: 1 },
      },
    );
    await kataDb.collection('tavern_worlds').updateOne(
      { _id: world._id },
      { $set: { lastActiveAt: new Date() } },
    );
    return res.status(200).json({
      ok: true,
      isOOC: true,
      ackText: `*ghi nhớ:* ${parsed.body.slice(0, 200)}`,
    });
  }

  // Resolve layered overrides for this turn.
  const globalDoc = await kataDb.collection('globalconfigs').findOne({ scope: GLOBAL_SCOPE }, { projection: { tavern: 1 } });
  const promptConfig = tavernResolvePromptConfig(world.overrides, globalDoc?.tavern);

  // Pull character + build the prompt.
  const character = world.characterId ? await kataDb.collection('tavern_characters').findOne({ _id: world.characterId }) : null;
  const systemContent = tavernBuildSystemPrompt(
    {
      world: {
        name: world.name,
        setting: world.setting,
        lore: world.lore,
        rules: world.rules,
        mode: world.mode,
        difficulty: world.difficulty,
      },
      character: character
        ? { name: character.name, persona: character.persona, appearance: character.appearance }
        : null,
      characterInline: world.characterInline ?? null,
      summary: session.summary ?? '',
      directorNotes: (session.directorNotes ?? []).map((d) => d.note),
    },
    promptConfig,
  );
  const window = tavernTrimVerbatimWindow(session.messages ?? [], promptConfig.memoryWindowSize);

  let completion;
  try {
    completion = await callTavernChat(
      systemContent,
      window.messages,
      userText,
      promptConfig.chatModel,
      promptConfig.turnTemperature,
      promptConfig.turnMaxTokens,
    );
  } catch (err) {
    return res.status(502).json({ error: 'llm_failed', message: err?.message?.slice(0, 500) });
  }
  const parsedReply = tavernParseStorytellerReply(completion.text);

  // Empty reply guard — never silently swap models. With the large token
  // budget this is rare; if the configured model still returns no usable
  // prose, don't persist a blank turn — let the player resend.
  if (!parsedReply.prose || !parsedReply.prose.trim()) {
    return res.status(200).json({ ok: true, isOOC: false, emptyReply: true });
  }

  // Child-safety post-process — silent hard rule.
  const protagonistAppearance = character?.appearance ?? world.characterInline?.appearance ?? null;
  const safety = ensureNoMinorSexualization({
    reply: parsedReply.prose,
    protagonistAppearance,
    worldLore: `${world.setting || ''}\n${world.lore || ''}`,
  });
  if (!safety.ok) {
    // Persist the user message, refuse the assistant turn.
    await kataDb.collection('tavern_sessions').updateOne(
      { _id: session._id },
      {
        $set: { lastActiveAt: new Date() },
        $push: { messages: { role: 'user', content: userText, timestamp: Date.now(), isOOC: false } },
        $inc: { messageCount: 1 },
      },
    );
    try {
      await kataDb.collection('tavern_audits').insertOne({
        userId: myDiscordId,
        action: 'tavern.childSafetyDropWeb',
        worldId: world._id,
        details: { reason: safety.reason },
        createdAt: new Date(),
      });
    } catch { /* best-effort */ }
    return res.status(200).json({
      ok: true,
      isOOC: false,
      refusedForSafety: true,
      replyText: '*(scene refused — minor sexualization)*',
    });
  }

  const now = Date.now();
  await kataDb.collection('tavern_sessions').updateOne(
    { _id: session._id },
    {
      $set: { lastActiveAt: new Date() },
      $push: {
        messages: {
          $each: [
            { role: 'user', content: userText, timestamp: now, isOOC: false, suggestions: [] },
            { role: 'assistant', content: parsedReply.prose, timestamp: now, isOOC: false, suggestions: parsedReply.suggestions },
          ],
        },
      },
      $inc: { messageCount: 2 },
    },
  );
  await kataDb.collection('tavern_worlds').updateOne(
    { _id: world._id },
    { $set: { lastActiveAt: new Date() } },
  );

  // Cost ledger so /kata/admin/cost rolls up tavern web-turn usage too.
  try {
    await kataDb.collection('costentries').insertOne({
      guildId: world.guildId,
      userId: myDiscordId,
      service: 'yunwu',
      model: promptConfig.chatModel,
      command: '/tavern-web',
      tokensIn: completion.tokensIn,
      tokensOut: completion.tokensOut,
      timestamp: new Date(),
    });
  } catch { /* best-effort */ }

  return res.status(200).json({
    ok: true,
    isOOC: false,
    refusedForSafety: false,
    replyText: parsedReply.prose,
    suggestions: parsedReply.suggestions,
    tokensIn: completion.tokensIn,
    tokensOut: completion.tokensOut,
  });
}

// ── Scene illustration (web) ──────────────────────────────────
//
// POST /api/kata/tavern/world/:id/scene-image  body: { text }
// Turns the latest narrator prose into an image and persists its URL onto
// the last assistant message so it renders between the prose and the option
// buttons. Gated by world.imageGenEnabled. Runs as its own request so the
// /turn endpoint stays fast.

const SCENE_SUBJECT_SYS = [
  'You convert a roleplay scene into a concise image-generation prompt.',
  'Read the scene and output ONLY a comma-separated list of visual descriptors',
  '(booru / Stable-Diffusion style) capturing: the character(s) present and their',
  'appearance, what they are doing, the setting / location, lighting, and mood.',
  'Output the prompt only — no explanation, no quotes, no full sentences.',
  'Keep it under ~50 tokens. Everyone depicted is an adult; never describe a minor.',
].join(' ');

async function falGenScene(apiKey, model, input, deadline) {
  const submit = await fetch(`https://queue.fal.run/${model}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Key ${apiKey}` },
    body: JSON.stringify(input),
  });
  const submitData = await submit.json();
  if (!submit.ok) throw new Error('fal submit ' + submit.status);
  const requestId = submitData.request_id;
  const statusUrl = submitData.status_url || `https://queue.fal.run/${model}/requests/${requestId}/status`;
  const resultUrl = submitData.response_url || `https://queue.fal.run/${model}/requests/${requestId}`;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    const s = await fetch(statusUrl, { headers: { Authorization: `Key ${apiKey}` } });
    const sd = await s.json();
    if (sd.status === 'COMPLETED') {
      const fr = await fetch(resultUrl, { headers: { Authorization: `Key ${apiKey}` } });
      const final = await fr.json();
      return final?.images?.[0]?.url || final?.image?.url || final?.url || null;
    }
    if (sd.status === 'FAILED' || sd.status === 'CANCELLED') throw new Error('fal ' + sd.status);
  }
  return null; // timed out → caller tries the next model in the chain
}

async function tavernWorldSceneImage(req, res, id) {
  const auth = await requireUser(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'invalid_json' }); }
  }
  const sceneText = (body?.text ?? '').toString().trim();
  if (!sceneText) return res.status(400).json({ error: 'text_required' });

  const apiKey = process.env.FAL_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'fal_not_configured' });

  const kataDb = await getKataDb();
  let worldOid;
  try { worldOid = new ObjectId(id); } catch { return res.status(400).json({ error: 'invalid_id' }); }
  const world = await kataDb.collection('tavern_worlds').findOne({ _id: worldOid });
  if (!world) return res.status(404).json({ error: 'not_found' });

  const myDiscordId = auth.user.providerUserId;
  if (world.userId !== myDiscordId && world.participation === 'creator_only' && !auth.isOwner) {
    return res.status(403).json({ error: 'forbidden' });
  }
  if (!world.imageGenEnabled) return res.status(200).json({ ok: true, skipped: 'image_gen_disabled' });

  const globalDoc = await kataDb.collection('globalconfigs').findOne({ scope: GLOBAL_SCOPE }, { projection: { tavern: 1 } });
  const cfg = tavernResolvePromptConfig(world.overrides, globalDoc?.tavern);

  const character = world.characterId
    ? await kataDb.collection('tavern_characters').findOne({ _id: world.characterId })
    : null;
  const charBase = (character?.imageBasePrompt || character?.appearance || world.characterInline?.appearance || '').toString().trim();
  const style = (world.imageStyle || 'cinematic detailed').toString().trim();

  // 1) Extract a concise visual prompt from the prose (fast model).
  let keywords = '';
  try {
    const ext = await callTavernChat(SCENE_SUBJECT_SYS, [], sceneText.slice(0, 4000), cfg.subjectModel, 0.4, 220);
    keywords = (ext.text || '').replace(/\s+/g, ' ').trim().slice(0, 600);
  } catch { /* fall back to a trimmed slice of the prose */ keywords = sceneText.replace(/\s+/g, ' ').slice(0, 200); }

  // 2) Assemble the final prompt from the world's template.
  let prompt = (cfg.imagePromptTemplate || '{character_base}, {keywords}, {style}')
    .replace('{character_base}', charBase)
    .replace('{keywords}', keywords)
    .replace('{style}', style);
  prompt = prompt.split(',').map((s) => s.trim()).filter(Boolean).join(', ');
  if (!prompt) return res.status(200).json({ ok: true, skipped: 'empty_prompt' });

  // 3) Generate via the world's fal model chain (fallback in order).
  const models = (cfg.sceneImageModels && cfg.sceneImageModels.length) ? cfg.sceneImageModels : ['fal-ai/flux/schnell'];
  const deadline = Date.now() + 50_000;
  let url = null;
  let usedModel = null;
  let lastErr = null;
  for (const model of models) {
    if (Date.now() > deadline) break;
    try {
      const input = { prompt };
      if (cfg.imageNegativePrompt) input.negative_prompt = cfg.imageNegativePrompt;
      const r = await falGenScene(apiKey, model, input, deadline);
      if (r) { url = r; usedModel = model; break; }
    } catch (e) { lastErr = e; }
  }
  if (!url) return res.status(502).json({ error: 'image_failed', message: lastErr?.message?.slice(0, 200) });

  // 4) Persist onto the most-recent narrator message so it survives reload.
  const session = await kataDb.collection('tavern_sessions').findOne({ worldId: world._id }, { projection: { messages: 1 } });
  if (session && Array.isArray(session.messages)) {
    let lastIdx = -1;
    for (let i = session.messages.length - 1; i >= 0; i--) {
      if (session.messages[i].role === 'assistant' && !session.messages[i].isOOC) { lastIdx = i; break; }
    }
    if (lastIdx >= 0) {
      await kataDb.collection('tavern_sessions').updateOne(
        { _id: session._id },
        { $set: { ['messages.' + lastIdx + '.imageUrl']: url } },
      );
    }
  }

  try {
    await kataDb.collection('costentries').insertOne({
      guildId: world.guildId, userId: myDiscordId,
      service: 'fal', model: usedModel, command: '/tavern-web-image',
      imagesGen: 1, timestamp: new Date(),
    });
  } catch { /* best-effort */ }

  return res.status(200).json({ ok: true, url, model: usedModel });
}

// ── Admin tavern engine defaults (owner-only) ─────────────────

const TAVERN_GLOBAL_FIELDS = TAVERN_OVERRIDE_FIELDS;

async function handleKataAdminTavernConfigGet(req, res) {
  const auth = await requireOwner(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error, message: auth.message });
  const kataDb = await getKataDb();
  const doc = await kataDb.collection('globalconfigs').findOne({ scope: GLOBAL_SCOPE });
  return res.status(200).json({ tavern: doc?.tavern ?? {} });
}

async function handleKataAdminTavernConfigPatch(req, res) {
  const auth = await requireOwner(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error, message: auth.message });
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'invalid_json' }); }
  }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'invalid_body' });

  const set = {};
  const unset = {};
  const errors = [];

  for (const [field, kind, meta] of TAVERN_GLOBAL_FIELDS) {
    if (!(field in body)) continue;
    const v = body[field];
    if (v === null || v === '') {
      unset[`tavern.${field}`] = '';
      continue;
    }
    if (kind === 'string') {
      if (typeof v !== 'string') { errors.push(`${field} must be string`); continue; }
      if (v.length > TAVERN_FIELD_LIMITS[meta]) {
        errors.push(`${field} > ${TAVERN_FIELD_LIMITS[meta]} chars`);
        continue;
      }
      set[`tavern.${field}`] = v;
    } else if (kind === 'number') {
      const n = Number(v);
      if (!Number.isFinite(n)) { errors.push(`${field} must be number`); continue; }
      if (n < meta.min || n > meta.max) {
        errors.push(`${field} must be ${meta.min}..${meta.max}`);
        continue;
      }
      set[`tavern.${field}`] = n;
    } else if (kind === 'array') {
      if (!Array.isArray(v)) { errors.push(`${field} must be array`); continue; }
      if (v.length === 0) { unset[`tavern.${field}`] = ''; continue; }
      if (v.length > 8) { errors.push(`${field} > 8 entries`); continue; }
      if (!v.every((s) => typeof s === 'string' && s.trim() && s.length <= TAVERN_FIELD_LIMITS[meta])) {
        errors.push(`${field} entries must be non-empty strings ≤ ${TAVERN_FIELD_LIMITS[meta]} chars`);
        continue;
      }
      set[`tavern.${field}`] = v.map((s) => s.trim());
    }
  }

  if (errors.length) return res.status(400).json({ error: 'validation_failed', details: errors });
  if (Object.keys(set).length === 0 && Object.keys(unset).length === 0) {
    return res.status(400).json({ error: 'empty_update' });
  }

  set.updatedAt = new Date();
  const kataDb = await getKataDb();
  const update = { $set: { ...set, scope: GLOBAL_SCOPE } };
  if (Object.keys(unset).length > 0) update.$unset = unset;
  await kataDb.collection('globalconfigs').updateOne({ scope: GLOBAL_SCOPE }, update, { upsert: true });

  try {
    await kataDb.collection('auditlogs').insertOne({
      actorUserId: auth.user.providerUserId,
      action: 'tavern.globalConfigUpdate',
      details: {
        set: Object.keys(set).filter((k) => k !== 'updatedAt'),
        unset: Object.keys(unset),
      },
      createdAt: new Date(),
    });
  } catch { /* best-effort */ }

  const fresh = await kataDb.collection('globalconfigs').findOne({ scope: GLOBAL_SCOPE });
  return res.status(200).json({ ok: true, tavern: fresh?.tavern ?? {} });
}
