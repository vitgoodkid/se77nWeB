// /api/games — lists files from a public Google Drive folder.
//
// GET ?q=<search>     → 200 { files: [...] }   (search optional, filters by filename)
//
// Setup (one-time):
//   1. Create a Drive folder, right-click → Share → "Anyone with the link" → Viewer.
//   2. Copy folder ID from URL: /folders/<THIS_PART>
//   3. Google Cloud Console → enable Drive API → Credentials → API Key.
//   4. Set Vercel env vars:
//        GDRIVE_API_KEY=AIza...
//        GDRIVE_FOLDER_ID=1abcXYZ...
//
// Because the folder is public, just an API key (no OAuth) is enough.
//
// Public — no auth required on this endpoint.

export const config = { maxDuration: 15 };

// Tiny in-memory cache survives within a warm lambda instance.
let cache = { at: 0, data: null };
const CACHE_MS = 60_000;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GDRIVE_API_KEY;
  const folderId = process.env.GDRIVE_FOLDER_ID;
  if (!apiKey || !folderId) {
    return res.status(503).json({
      error: 'GDrive not configured',
      hint: 'Set GDRIVE_API_KEY and GDRIVE_FOLDER_ID in Vercel env vars.',
    });
  }

  const search = (req.query?.q || '').toString().trim().toLowerCase();

  try {
    if (cache.data && Date.now() - cache.at < CACHE_MS) {
      return res.status(200).json(filterFiles(cache.data, search));
    }

    const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
    const fields = encodeURIComponent('files(id,name,mimeType,size,modifiedTime,thumbnailLink,iconLink,webViewLink,webContentLink,description)');
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&pageSize=1000&orderBy=modifiedTime desc&key=${apiKey}`;

    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    const data = await r.json();
    if (!r.ok) {
      console.error('[/api/games] drive error', data);
      return res.status(r.status).json({
        error: data?.error?.message || 'Drive API error',
        upstream: data?.error,
      });
    }

    const files = (data.files || []).map((f) => ({
      id: f.id,
      name: f.name,
      mime: f.mimeType,
      isFolder: f.mimeType === 'application/vnd.google-apps.folder',
      size: f.size ? Number(f.size) : null,
      modifiedAt: f.modifiedTime,
      thumb: f.thumbnailLink || null,
      icon: f.iconLink || null,
      description: f.description || null,
      viewUrl: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
      downloadUrl: f.webContentLink || `https://drive.google.com/uc?export=download&id=${f.id}`,
    }));

    cache = { at: Date.now(), data: files };
    return res.status(200).json(filterFiles(files, search));
  } catch (err) {
    console.error('[/api/games]', err);
    return res.status(500).json({ error: err.message || 'internal error' });
  }
}

function filterFiles(files, search) {
  if (!search) return { files, total: files.length };
  const filtered = files.filter((f) => f.name.toLowerCase().includes(search));
  return { files: filtered, total: filtered.length, filteredFrom: files.length };
}
