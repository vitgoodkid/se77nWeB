// Session cookie helpers. JWT signed with AUTH_SECRET.
// Cookie name: se77n_session  (HttpOnly, SameSite=Lax, Secure in prod, 30d)
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const COOKIE_NAME = 'se77n_session';
const STATE_COOKIE = 'se77n_oauth_state';
const SESSION_DAYS = 30;

function getSecret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 24) {
    throw new Error('AUTH_SECRET not configured (need at least 24 chars)');
  }
  return s;
}

function isProd() {
  return process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
}

// ── Session JWT (long-lived) ──────────────────────────────────
export function signSession(payload) {
  return jwt.sign(payload, getSecret(), { expiresIn: SESSION_DAYS + 'd' });
}

export function verifySession(token) {
  try { return jwt.verify(token, getSecret()); } catch { return null; }
}

// Read+verify session from a Vercel req. Returns payload (e.g. { uid, provider }) or null.
export function readSession(req) {
  const cookies = parseCookies(req.headers?.cookie || '');
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  return verifySession(token);
}

// ── OAuth state (short-lived, signed) ─────────────────────────
// Embeds the chosen provider so callback can't be tricked.
export function signOAuthState(provider) {
  const nonce = crypto.randomBytes(16).toString('hex');
  return jwt.sign({ provider, nonce }, getSecret(), { expiresIn: '10m' });
}

export function verifyOAuthState(state, expectedProvider) {
  try {
    const decoded = jwt.verify(state, getSecret());
    if (decoded.provider !== expectedProvider) return null;
    return decoded;
  } catch { return null; }
}

// ── Cookie utilities ──────────────────────────────────────────
export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function buildSessionCookie(token) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    `Max-Age=${SESSION_DAYS * 24 * 60 * 60}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (isProd()) parts.push('Secure');
  return parts.join('; ');
}

export function buildClearSessionCookie() {
  const parts = [
    `${COOKIE_NAME}=`,
    'Max-Age=0',
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (isProd()) parts.push('Secure');
  return parts.join('; ');
}

export function buildStateCookie(state) {
  const parts = [
    `${STATE_COOKIE}=${encodeURIComponent(state)}`,
    'Max-Age=600',
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (isProd()) parts.push('Secure');
  return parts.join('; ');
}

export function buildClearStateCookie() {
  const parts = [
    `${STATE_COOKIE}=`,
    'Max-Age=0',
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (isProd()) parts.push('Secure');
  return parts.join('; ');
}

export function readStateCookie(req) {
  const cookies = parseCookies(req.headers?.cookie || '');
  return cookies[STATE_COOKIE] || null;
}

// ── Base URL detection ────────────────────────────────────────
// AUTH_BASE_URL takes precedence (e.g. https://se77n.com). Otherwise infer from host.
export function getBaseUrl(req) {
  if (process.env.AUTH_BASE_URL) return process.env.AUTH_BASE_URL.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || (isProd() ? 'https' : 'http');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
