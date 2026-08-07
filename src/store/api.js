const BASE = '/api/toolbox?kind=store';

async function call(resource, options = {}) {
  const params = new URLSearchParams({ kind: 'store', resource });
  for (const [key, value] of Object.entries(options.query || {})) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const response = await fetch(`/api/toolbox?${params}`, {
    method: options.method || 'GET',
    credentials: 'include',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || payload.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.code = payload.error;
    throw error;
  }
  return payload;
}

async function safeJson(response, label) {
  const raw = await response.text();
  let data = null;
  if (raw) {
    try { data = JSON.parse(raw); } catch { /* not JSON */ }
  }
  if (!response.ok) {
    throw new Error(data?.error || data?.message || `${label} ${response.status}`);
  }
  if (!data) throw new Error(`${label}: empty response`);
  return data;
}

async function pollImage(initial) {
  if (initial?.image) return initial.image;
  if (!initial?.pending || !initial.statusUrl) {
    throw new Error('image: missing url and not pending');
  }
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const data = await safeJson(await fetch(initial.statusUrl), 'image');
    if (data.image) return data.image;
    if (!data.pending) throw new Error('image: unexpected response');
  }
  throw new Error('image: still rendering after 10 min');
}

/** Edit/generate one product photo via /api/image (fal). */
async function generateImage({ prompt, image, engine = 'nano' }) {
  const response = await fetch('/api/image', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, image, engine }),
  });
  return pollImage(await safeJson(response, 'image'));
}

export const storeApi = {
  config: () => call('config'),
  products: (admin = false) => call('products', { query: admin ? { admin: 1 } : {} }),
  product: (id, admin = false) => call('products', { query: { id, ...(admin ? { admin: 1 } : {}) } }),
  createProduct: (body) => call('products', { method: 'POST', body }),
  updateProduct: (id, body) => call('products', { method: 'PUT', query: { id }, body }),
  deleteProduct: (id) => call('products', { method: 'DELETE', query: { id } }),
  uploadImage: (body) => call('uploads', { method: 'POST', body }),
  aiFill: (body) => call('ai', { method: 'POST', body }),
  generateImage,
  createOrder: (body) => call('orders', { method: 'POST', body }),
  orders: () => call('orders'),
  updateOrder: (id, status) => call('orders', { method: 'PATCH', query: { id }, body: { status } }),
  deleteOrder: (id) => call('orders', { method: 'DELETE', query: { id } }),
};

export { BASE };
