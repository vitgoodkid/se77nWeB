# se77n

Personal desktop dashboard. 8 modules wired to one prompt.

## Stack

- **Vite + React 18** (JSX, no TypeScript)
- **Vercel Serverless Functions** (`/api/*`) for proxying AI + market APIs
- Inline CSS-in-JS, JetBrains Mono + Geist via Google Fonts
- React.lazy + Suspense for per-route code splitting
- localStorage persistence for to-dos, AI history, vault state

## Modules

| # | Route       | Module             | Backend                                      |
|---|-------------|--------------------|----------------------------------------------|
| 00| `/`         | Home grid          | —                                            |
| 01| `#/ai`      | AI Playground      | `/api/chat` (yunwu Gemini), `/api/image` `/api/video` (fal.ai) |
| 02| `#/tools`   | Toolbox            | client-side (PIN gate `7777`)                |
| 03| `#/travel`  | Travel Archive     | static (16 cities)                           |
| 04| `#/game`    | Game               | placeholder                                  |
| 05| `#/tech`    | Tech Stack Monitor | static + `/api/crypto` for FX                |
| 06| `#/crypto`  | Crypto Watch       | `/api/crypto` (CoinGecko + exchangerate.host)|
| 07| `#/vault`   | Digital Vault      | client-side mock                             |
| 08| `#/todo`    | To-Do List         | localStorage                                 |

## Local dev

```bash
npm install
cp .env.example .env.local
# fill in keys in .env.local
npm run dev
```

Opens on `http://localhost:5173`. The frontend talks to `/api/*`, which under
`vite dev` won't exist — for full-stack local dev with API routes, use:

```bash
npm i -g vercel
vercel dev
```

## Environment variables

| Name                   | Required | Notes                                       |
|------------------------|----------|---------------------------------------------|
| `YUNWU_API_KEY`        | yes      | yunwu.ai bearer token                       |
| `YUNWU_BASE_URL`       | no       | defaults to `https://yunwu.ai/v1`           |
| `YUNWU_CHAT_MODEL`     | no       | defaults to `gemini-3.1-flash-lite`         |
| `FAL_API_KEY`          | yes      | fal.ai key (`<key-id>:<key-secret>`)        |
| `FAL_IMAGE_MODEL`      | no       | defaults to `fal-ai/openai/gpt-image-2/edit`|
| `FAL_VIDEO_T2V_MODEL`  | no       | defaults to `fal-ai/bytedance/seedance-2.0/text-to-video`  |
| `FAL_VIDEO_I2V_MODEL`  | no       | defaults to `fal-ai/bytedance/seedance-2.0/image-to-video` |
| `MONGODB_URI`          | login    | MongoDB Atlas connection string             |
| `AUTH_SECRET`          | login    | ≥24 random chars, signs session JWT         |
| `AUTH_BASE_URL`        | login    | e.g. `https://se77n.com` (for OAuth redirects) |
| `DISCORD_CLIENT_ID`    | login    | Discord OAuth app                           |
| `DISCORD_CLIENT_SECRET`| login    | Discord OAuth app                           |
| `GOOGLE_CLIENT_ID`     | login    | Google OAuth client                         |
| `GOOGLE_CLIENT_SECRET` | login    | Google OAuth client                         |

`.env.local` is gitignored. **Never commit secrets.**

## Login + cross-device sync (optional)

Logging in via Discord or Google enables per-user sync of todos, AI chat
history, and (later) vault entries via MongoDB. Without these env vars,
the site still works — falls back to localStorage as before.

### Setting it up

1. **MongoDB Atlas** — create a free M0 cluster
   ([atlas](https://www.mongodb.com/cloud/atlas/register)). Add a database
   user, allow `0.0.0.0/0` in Network Access (Vercel uses dynamic IPs).
   Grab the connection string → `MONGODB_URI`.
2. **AUTH_SECRET** — generate with
   `node -e "console.log(crypto.randomBytes(48).toString('base64'))"`.
3. **Discord OAuth** — at
   [discord.com/developers](https://discord.com/developers/applications),
   create an application → OAuth2 → add redirect:
   `https://YOUR_DOMAIN/api/auth/discord/callback`. Copy Client ID + Secret.
4. **Google OAuth** — at
   [console.cloud.google.com](https://console.cloud.google.com/apis/credentials),
   create OAuth client (Web). Add redirect:
   `https://YOUR_DOMAIN/api/auth/google/callback`. Copy Client ID + Secret.
5. **AUTH_BASE_URL** — your public origin (no trailing slash).
6. Add all of the above in Vercel → Settings → Environment Variables, redeploy.

### Local dev caveat

`npm run dev` (vite) only serves the frontend — `/api/*` routes don't run.
Login flow is therefore disabled on `localhost:5173`; the UI silently falls
back to guest mode (localStorage only).

To test login locally, use `vercel dev` instead (port 3000 by default), and
register `http://localhost:3000/api/auth/{discord,google}/callback` as an
additional redirect URI in each provider's console.

## Deploy to Vercel

```bash
npm i -g vercel
vercel link    # connect repo + project
vercel env add YUNWU_API_KEY        # paste key
vercel env add FAL_API_KEY          # paste key
# (optional) override defaults:
vercel env add YUNWU_CHAT_MODEL     # gemini-3.1-flash-lite
vercel deploy --prod
```

Or push to GitHub and import the repo in the Vercel dashboard. Add env vars in
Settings → Environment Variables, then redeploy.

### Custom domain

In Vercel → Project → Settings → Domains: add your apex domain (e.g.
`se77n.com`). Vercel issues an SSL cert + gives you DNS records to point at
your registrar (CNAME or A). Propagation usually finishes within minutes.

## Build

```bash
npm run build      # outputs dist/
npm run preview    # serves dist/ at :4173 for smoke testing
```

`dist/` is what Vercel serves. Static + per-route chunks; React in a separate
`vendor` chunk.

## Notes

- **Geolocation** for Day/Night requires HTTPS. Local dev over `http://` falls
  back to a simple hour heuristic — that's expected.
- **Video gen** can exceed Vercel's 60s function cap. The `/api/video` route
  returns `202 { pending: true, requestId, statusUrl }` if it doesn't finish in
  time; client polling is on the to-do list. For now, retry or use shorter prompts.
- **Crypto** is rate-limited at 1 fetch/60s, cached server-side.
- **`window.claude.complete`** (the design's stub) is gone — chat now goes
  through `/api/chat`.

## Project layout

```
se77n/
├── api/                  # Vercel serverless functions (Node)
│   ├── chat.js           # yunwu Gemini proxy
│   ├── image.js          # fal.ai image-edit proxy
│   ├── video.js          # fal.ai video-gen proxy
│   └── crypto.js         # BTC + GOLD + USD/TWD/VND aggregator
├── public/               # static assets
│   ├── favicon.svg
│   ├── og.svg
│   ├── manifest.webmanifest
│   └── robots.txt
├── src/
│   ├── main.jsx          # React mount + StrictMode + ErrorBoundary
│   ├── App.jsx           # shell, routing, home, lazy module loaders
│   ├── lib.jsx           # COLORS, hooks, UI primitives, data
│   ├── featuresA.jsx     # AI · Toolbox · Travel · Game
│   ├── featuresB.jsx     # Tech · Crypto · Vault · Todo
│   ├── ErrorBoundary.jsx
│   └── styles.css        # CSS reset + keyframes + scrollbar
├── .design/              # original Claude Design handoff (gitignored)
├── index.html            # Vite entry (meta tags, font preconnect)
├── vite.config.js
├── vercel.json           # function config + cache headers
└── package.json
```
