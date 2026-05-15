// GET /api/auth/discord/start
// Redirects user to Discord OAuth with a signed state cookie for CSRF protection.
import {
  signOAuthState, buildStateCookie, getBaseUrl,
} from '../../_lib/session.js';

export default function handler(req, res) {
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!clientId) return res.status(500).json({ error: 'DISCORD_CLIENT_ID not configured' });

  const state = signOAuthState('discord');
  const redirectUri = `${getBaseUrl(req)}/api/auth/discord/callback`;

  const url = new URL('https://discord.com/api/oauth2/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify email');
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'none');

  res.setHeader('Set-Cookie', buildStateCookie(state));
  res.writeHead(302, { Location: url.toString() });
  res.end();
}
