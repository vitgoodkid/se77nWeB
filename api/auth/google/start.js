// GET /api/auth/google/start
// Redirects user to Google OAuth (OpenID Connect) with signed state cookie.
import {
  signOAuthState, buildStateCookie, getBaseUrl,
} from '../../_lib/session.js';

export default function handler(req, res) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return res.status(500).json({ error: 'GOOGLE_CLIENT_ID not configured' });

  const state = signOAuthState('google');
  const redirectUri = `${getBaseUrl(req)}/api/auth/google/callback`;

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('access_type', 'online');
  url.searchParams.set('prompt', 'select_account');

  res.setHeader('Set-Cookie', buildStateCookie(state));
  res.writeHead(302, { Location: url.toString() });
  res.end();
}
