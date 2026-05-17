// Thin fetch wrapper around /api/tv4. All calls send the session cookie automatically.
// Throws on non-2xx with the server's error string when available.

const BASE = '/api/tv4';

async function call(method, c, opts = {}) {
  const params = new URLSearchParams({ c });
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
    }
  }
  const url = `${BASE}?${params}`;
  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error || `http_${res.status}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

export const tv4 = {
  list:   (c, query)       => call('GET',    c, { query }),
  one:    (c, id)          => call('GET',    c, { query: { id } }),
  bySlug: (slug)           => call('GET',    'trips', { query: { slug } }),
  create: (c, body)        => call('POST',   c, { body }),
  update: (c, id, body)    => call('PUT',    c, { query: { id }, body }),
  remove: (c, id)          => call('DELETE', c, { query: { id } }),
  // settings is a singleton — server upserts the per-user doc.
  getSettings:  ()         => call('GET',    'settings'),
  saveSettings: (body)     => call('POST',   'settings', { body }),
};
