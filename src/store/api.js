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

export const storeApi = {
  config: () => call('config'),
  products: (admin = false) => call('products', { query: admin ? { admin: 1 } : {} }),
  product: (id, admin = false) => call('products', { query: { id, ...(admin ? { admin: 1 } : {}) } }),
  createProduct: (body) => call('products', { method: 'POST', body }),
  updateProduct: (id, body) => call('products', { method: 'PUT', query: { id }, body }),
  deleteProduct: (id) => call('products', { method: 'DELETE', query: { id } }),
  uploadImage: (body) => call('uploads', { method: 'POST', body }),
  aiFill: (body) => call('ai', { method: 'POST', body }),
  createOrder: (body) => call('orders', { method: 'POST', body }),
  orders: () => call('orders'),
  updateOrder: (id, status) => call('orders', { method: 'PATCH', query: { id }, body: { status } }),
  deleteOrder: (id) => call('orders', { method: 'DELETE', query: { id } }),
};

export { BASE };
