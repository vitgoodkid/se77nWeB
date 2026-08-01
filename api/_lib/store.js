import crypto from 'node:crypto';
import { ObjectId } from 'mongodb';
import { getDb } from './mongo.js';
import { readSession } from './session.js';

const PRODUCT_COLLECTION = 'storeproducts';
const ORDER_COLLECTION = 'storeorders';
const MAX_CART_ITEMS = 25;
const MAX_MAP_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_PRODUCT_IMAGE_BYTES = 2 * 1024 * 1024;
const DEFAULT_SHIPPING_FEE = 38;
const FREESHIP_THRESHOLD = 700;
const DEFAULT_PRODUCT_IMAGE = '/og.svg';
const ORDER_STATUSES = new Set(['new', 'confirmed', 'shipping', 'completed', 'cancelled']);
const DEFAULT_OWNER_DISCORD_ID = '397342895327150080';

const DEFAULT_PRODUCTS = [
  {
    _id: 'kata-shadow-hoodie',
    title: 'Kata Shadow Hoodie',
    subtitle: 'Heavyweight / everyday armor',
    description: 'Hoodie form rộng, chất nỉ dày vừa và những phối màu dễ mặc mỗi ngày.',
    price: 620,
    discountPercent: 0,
    imageUrl: DEFAULT_PRODUCT_IMAGE,
    genders: ['men', 'women'],
    sizes: ['S', 'M', 'L', 'XL'],
    sizeAdjustments: {},
    freeship: true,
    featured: true,
    active: true,
    variants: [
      { id: 'forest', name: 'Forest Shadow', colorHex: '#1f4a3d', imageUrl: DEFAULT_PRODUCT_IMAGE, priceOverride: null, stockBySize: { S: 8, M: 10, L: 12, XL: 7 } },
      { id: 'cream', name: 'Cream Rune', colorHex: '#eee5d4', imageUrl: DEFAULT_PRODUCT_IMAGE, priceOverride: null, stockBySize: { S: 4, M: 6, L: 5, XL: 3 } },
    ],
  },
  {
    _id: 'if-you-run-tee',
    title: 'If You Run Tee',
    subtitle: 'Oversized cotton / signature print',
    description: 'Áo thun oversize mềm, thoáng và lên dáng gọn với hai phối màu signature.',
    price: 420,
    discountPercent: 12,
    imageUrl: DEFAULT_PRODUCT_IMAGE,
    genders: ['men', 'women'],
    sizes: ['M', 'L', 'XL', 'XXL'],
    sizeAdjustments: { XXL: 10 },
    freeship: false,
    featured: false,
    active: true,
    variants: [
      { id: 'black', name: 'Black Signature', colorHex: '#25221f', imageUrl: DEFAULT_PRODUCT_IMAGE, priceOverride: null, stockBySize: { M: 14, L: 16, XL: 10, XXL: 5 } },
      { id: 'mint', name: 'Mint Glow', colorHex: '#bad9ca', imageUrl: DEFAULT_PRODUCT_IMAGE, priceOverride: null, stockBySize: { M: 7, L: 8, XL: 6, XXL: 0 } },
    ],
  },
  {
    _id: 'kata-sticker-pack',
    title: 'Kata Sticker Pack',
    subtitle: 'Glossy set / five pieces',
    description: 'Một set sticker chống nước nhẹ cho laptop, bàn phím và góc setup.',
    price: 180,
    discountPercent: 0,
    imageUrl: DEFAULT_PRODUCT_IMAGE,
    genders: [],
    sizes: ['One size'],
    sizeAdjustments: {},
    freeship: false,
    featured: false,
    active: true,
    variants: [
      { id: 'default', name: 'Mixed Pack', colorHex: '#d36a79', imageUrl: DEFAULT_PRODUCT_IMAGE, priceOverride: null, stockBySize: { 'One size': 40 } },
    ],
  },
];

let indexesEnsured = false;
let seedPromise = null;

function httpError(status, message, code = message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function text(value, maxLength = 0) {
  const result = String(value ?? '').trim();
  return maxLength > 0 ? result.slice(0, maxLength) : result;
}

function list(value, maxItems = 30, maxLength = 40) {
  const values = Array.isArray(value) ? value : String(value ?? '').split(',');
  return [...new Set(values.map((entry) => text(entry, maxLength)).filter(Boolean))].slice(0, maxItems);
}

function money(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Math.max(0, Math.round(Number(fallback) || 0));
  return Math.max(0, Math.round(parsed));
}

function percent(value, fallback = 0) {
  return Math.min(95, money(value, fallback));
}

function stock(value, fallback = 0) {
  return Math.min(99999, money(value, fallback));
}

function slugify(value, fallback = 'item') {
  return text(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || fallback;
}

function color(value, fallback = '#d36a79') {
  const result = text(value, 7);
  return /^#[0-9a-f]{6}$/i.test(result) ? result : fallback;
}

function imageUrl(value, fallback = DEFAULT_PRODUCT_IMAGE) {
  const result = text(value, MAX_PRODUCT_IMAGE_BYTES * 2);
  if (!result) return fallback;
  if (/^\/(?!\/)/.test(result) || /^https?:\/\//i.test(result)) return result;
  if (/^data:image\/(png|jpe?g|webp);base64,/i.test(result)) {
    const base64 = result.slice(result.indexOf(',') + 1);
    if (Buffer.byteLength(base64, 'base64') <= MAX_PRODUCT_IMAGE_BYTES) return result;
  }
  return fallback;
}

function normalizeVariant(raw, index, sizes, fallbackImage) {
  const name = text(raw?.name || raw?.label || `Variant ${index + 1}`, 80);
  const id = slugify(raw?.id || name, `variant-${index + 1}`);
  const stockBySize = {};
  for (const sizeName of sizes) stockBySize[sizeName] = stock(raw?.stockBySize?.[sizeName], 0);
  const override = raw?.priceOverride === '' || raw?.priceOverride === null || raw?.priceOverride === undefined
    ? null
    : money(raw.priceOverride);
  return {
    id,
    name,
    colorHex: color(raw?.colorHex || raw?.color),
    imageUrl: imageUrl(raw?.imageUrl, fallbackImage),
    priceOverride: override,
    stockBySize,
  };
}

function legacyVariants(raw, sizes, fallbackImage) {
  const colors = list(raw?.colors, 12, 80);
  if (!colors.length) return [];
  return colors.map((entry, index) => {
    const [name, hex] = entry.split('|');
    return normalizeVariant({ name, colorHex: hex }, index, sizes, fallbackImage);
  });
}

function normalizeProduct(raw = {}, existing = {}) {
  const source = { ...existing, ...raw };
  const title = text(source.title, 120) || 'Untitled product';
  const sizes = list(source.sizes, 16, 32);
  if (!sizes.length) sizes.push('One size');
  const productImage = imageUrl(source.imageUrl, existing.imageUrl || DEFAULT_PRODUCT_IMAGE);
  const inputVariants = Array.isArray(source.variants) && source.variants.length
    ? source.variants
    : legacyVariants(source, sizes, productImage);
  const variants = (inputVariants.length ? inputVariants : [{ name: 'Default', colorHex: '#d36a79' }])
    .slice(0, 16)
    .map((variant, index) => normalizeVariant(variant, index, sizes, productImage));
  const sizeAdjustments = {};
  for (const sizeName of sizes) sizeAdjustments[sizeName] = money(source.sizeAdjustments?.[sizeName], 0);
  return {
    title,
    subtitle: text(source.subtitle, 140),
    description: text(source.description, 2400),
    price: money(source.price),
    discountPercent: percent(source.discountPercent),
    imageUrl: productImage,
    genders: list(source.genders, 4, 20).filter((entry) => ['men', 'women', 'unisex'].includes(entry)),
    sizes,
    sizeAdjustments,
    variants,
    freeship: Boolean(source.freeship),
    featured: Boolean(source.featured),
    active: source.active !== false,
  };
}

function discountedPrice(base, discount) {
  return Math.max(0, Math.round(base * (1 - discount / 100)));
}

function productView(doc = {}) {
  const product = normalizeProduct(doc, doc);
  const variants = product.variants.map((variant) => {
    const sizePrices = product.sizes.map((sizeName) => {
      const base = (variant.priceOverride ?? product.price) + money(product.sizeAdjustments[sizeName]);
      return discountedPrice(base, product.discountPercent);
    });
    const totalStock = Object.values(variant.stockBySize).reduce((sum, value) => sum + stock(value), 0);
    return {
      ...variant,
      totalStock,
      hasStock: totalStock > 0,
      minPrice: Math.min(...sizePrices),
      maxPrice: Math.max(...sizePrices),
    };
  });
  const allPrices = variants.flatMap((variant) => [variant.minPrice, variant.maxPrice]);
  const totalStock = variants.reduce((sum, variant) => sum + variant.totalStock, 0);
  return {
    id: String(doc._id || doc.id || ''),
    ...product,
    variants,
    finalPrice: discountedPrice(product.price, product.discountPercent),
    minPrice: allPrices.length ? Math.min(...allPrices) : product.price,
    maxPrice: allPrices.length ? Math.max(...allPrices) : product.price,
    totalStock,
    hasStock: totalStock > 0,
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null,
  };
}

function orderView(doc = {}) {
  return {
    id: String(doc._id || doc.id || ''),
    customer: doc.customer || {},
    items: Array.isArray(doc.items) ? doc.items : [],
    subtotal: money(doc.subtotal),
    shippingFee: money(doc.shippingFee),
    discountTotal: money(doc.discountTotal),
    total: money(doc.total),
    status: ORDER_STATUSES.has(doc.status) ? doc.status : 'new',
    mapImage: doc.mapImage || null,
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null,
  };
}

async function ensureStore() {
  const db = await getDb();
  const products = db.collection(PRODUCT_COLLECTION);
  const orders = db.collection(ORDER_COLLECTION);
  if (!indexesEnsured) {
    try {
      await Promise.all([
        products.createIndex({ active: 1, updatedAt: -1 }, { name: 'store_products_active' }),
        orders.createIndex({ createdAt: -1 }, { name: 'store_orders_recent' }),
      ]);
      indexesEnsured = true;
    } catch { /* another cold start may be creating the same indexes */ }
  }
  if (!seedPromise) {
    seedPromise = products.countDocuments({}).then(async (count) => {
      if (count) return;
      const now = new Date();
      try {
        await products.insertMany(DEFAULT_PRODUCTS.map((product) => ({ ...product, createdAt: now, updatedAt: now })));
      } catch (error) {
        if (error?.code !== 11000) throw error;
      }
    }).catch((error) => {
      seedPromise = null;
      throw error;
    });
  }
  await seedPromise;
  return { db, products, orders };
}

function ownerEmails() {
  const raw = process.env.STORE_OWNER_EMAILS
    || process.env.OWNER_EMAILS
    || process.env.PUBLIC_TECH_OWNER_EMAIL
    || 'beliketp@gmail.com';
  return new Set(raw.split(/[\s,]+/).map((entry) => entry.trim().toLowerCase()).filter(Boolean));
}

function isOwner(user) {
  if (!user) return false;
  const ownerId = text(process.env.STORE_OWNER_DISCORD_ID || process.env.OWNER_DISCORD_ID || DEFAULT_OWNER_DISCORD_ID);
  if (user.provider === 'discord' && text(user.providerUserId) === ownerId) return true;
  const email = text(user.email).toLowerCase();
  return Boolean(email && ownerEmails().has(email));
}

async function sessionUser(req) {
  const session = readSession(req);
  if (!session?.uid) return null;
  let id;
  try { id = new ObjectId(session.uid); } catch { return null; }
  const db = await getDb();
  return db.collection('users').findOne({ _id: id });
}

async function requireOwner(req) {
  const user = await sessionUser(req);
  if (!user) throw httpError(401, 'Vui lòng đăng nhập để tiếp tục.', 'LOGIN_REQUIRED');
  if (!isOwner(user)) throw httpError(403, 'Tài khoản này không có quyền quản trị Store.', 'OWNER_REQUIRED');
  return user;
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: String(user._id),
    displayName: user.displayName || user.username || user.email || 'Owner',
    avatarUrl: user.avatarUrl || null,
    provider: user.provider || null,
  };
}

function requestBody(req) {
  if (!req?.body) return {};
  if (typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body); } catch { throw httpError(400, 'Dữ liệu gửi lên không hợp lệ.', 'INVALID_JSON'); }
}

async function listProducts(products, includeInactive = false) {
  const filter = includeInactive ? {} : { active: { $ne: false } };
  const docs = await products.find(filter).sort({ featured: -1, updatedAt: -1, title: 1 }).toArray();
  return docs.map(productView);
}

async function handleConfig(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  const user = await sessionUser(req);
  return res.status(200).json({
    ok: true,
    shipping: { fee: DEFAULT_SHIPPING_FEE, freeThreshold: FREESHIP_THRESHOLD },
    support: {
      label: process.env.STORE_SUPPORT_LABEL?.trim() || 'Nhắn hỗ trợ',
      url: process.env.STORE_SUPPORT_URL?.trim() || 'https://www.tiktok.com/@hoa197915',
    },
    admin: { signedIn: Boolean(user), allowed: isOwner(user), user: publicUser(user) },
  });
}

async function handleProducts(req, res) {
  const { products } = await ensureStore();
  const id = text(req.query?.id, 120);
  const adminMode = req.query?.admin === '1';

  if (req.method === 'GET') {
    if (adminMode) await requireOwner(req);
    if (id) {
      const doc = await products.findOne({ _id: id, ...(adminMode ? {} : { active: { $ne: false } }) });
      if (!doc) throw httpError(404, 'Không tìm thấy sản phẩm.', 'PRODUCT_NOT_FOUND');
      return res.status(200).json({ ok: true, product: productView(doc) });
    }
    return res.status(200).json({ ok: true, products: await listProducts(products, adminMode) });
  }

  await requireOwner(req);
  const body = requestBody(req);

  if (req.method === 'POST') {
    const normalized = normalizeProduct(body);
    if (!text(body.title)) throw httpError(400, 'Tên sản phẩm là bắt buộc.', 'TITLE_REQUIRED');
    const baseId = slugify(body.id || body.title, `product-${Date.now()}`);
    let idCandidate = baseId;
    for (let attempt = 1; await products.findOne({ _id: idCandidate }); attempt += 1) idCandidate = `${baseId}-${attempt + 1}`;
    const now = new Date();
    const doc = { _id: idCandidate, ...normalized, createdAt: now, updatedAt: now };
    await products.insertOne(doc);
    return res.status(201).json({ ok: true, product: productView(doc) });
  }

  if (!id) throw httpError(400, 'Thiếu mã sản phẩm.', 'PRODUCT_ID_REQUIRED');
  const existing = await products.findOne({ _id: id });
  if (!existing) throw httpError(404, 'Không tìm thấy sản phẩm.', 'PRODUCT_NOT_FOUND');

  if (req.method === 'PUT') {
    const patch = normalizeProduct(body, existing);
    patch.updatedAt = new Date();
    await products.updateOne({ _id: id }, { $set: patch });
    return res.status(200).json({ ok: true, product: productView({ ...existing, ...patch }) });
  }

  if (req.method === 'DELETE') {
    await products.deleteOne({ _id: id });
    return res.status(200).json({ ok: true, deleted: { id } });
  }

  return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
}

function parseMapImage(value) {
  if (!value || typeof value !== 'object') return null;
  const dataUrl = text(value.dataUrl);
  const match = dataUrl.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/i);
  if (!match) return null;
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > MAX_MAP_IMAGE_BYTES) throw httpError(400, 'Ảnh bản đồ phải nhỏ hơn 2 MB.', 'MAP_IMAGE_TOO_LARGE');
  const type = match[1].toLowerCase();
  const extension = type.startsWith('jp') ? 'jpg' : type;
  return {
    fileName: text(value.fileName, 120) || `map.${extension}`,
    mimeType: `image/${type === 'jpg' ? 'jpeg' : type}`,
    size: buffer.length,
    dataUrl,
    buffer,
  };
}

function customerFrom(body) {
  const customer = body.customer || {};
  const fullName = text(customer.fullName, 100);
  const phone = text(customer.phone, 40);
  const address = text(customer.address, 700);
  const mapImage = parseMapImage(body.mapImage);
  if (!fullName) throw httpError(400, 'Vui lòng nhập tên người nhận.', 'CUSTOMER_NAME_REQUIRED');
  if (!phone) throw httpError(400, 'Vui lòng nhập số điện thoại.', 'CUSTOMER_PHONE_REQUIRED');
  if (!address && !mapImage) throw httpError(400, 'Vui lòng nhập địa chỉ hoặc gửi ảnh bản đồ.', 'CUSTOMER_ADDRESS_REQUIRED');
  return { customer: { fullName, phone, address }, mapImage };
}

async function buildOrderItems(rawItems, products) {
  const requested = Array.isArray(rawItems) ? rawItems.slice(0, MAX_CART_ITEMS) : [];
  if (!requested.length) throw httpError(400, 'Giỏ hàng đang trống.', 'ORDER_ITEMS_REQUIRED');
  const ids = [...new Set(requested.map((item) => text(item.productId || item.id, 120)).filter(Boolean))];
  const docs = await products.find({ _id: { $in: ids }, active: { $ne: false } }).toArray();
  const byId = new Map(docs.map((doc) => [String(doc._id), productView(doc)]));

  return requested.map((raw) => {
    const product = byId.get(text(raw.productId || raw.id, 120));
    if (!product) throw httpError(400, 'Một sản phẩm trong đơn không còn tồn tại.', 'ORDER_PRODUCT_NOT_FOUND');
    const variant = product.variants.find((entry) => entry.id === text(raw.variantId, 64)) || product.variants[0];
    if (!variant) throw httpError(400, 'Sản phẩm chưa có phân loại.', 'ORDER_VARIANT_REQUIRED');
    const sizeName = text(raw.size, 32) || product.sizes[0];
    if (!product.sizes.includes(sizeName)) throw httpError(400, 'Size sản phẩm không hợp lệ.', 'ORDER_SIZE_INVALID');
    const quantity = Math.min(99, Math.max(1, Number.parseInt(raw.quantity, 10) || 1));
    if (stock(variant.stockBySize[sizeName]) < quantity) throw httpError(409, `${product.title} không đủ tồn kho.`, 'ORDER_OUT_OF_STOCK');
    const basePrice = (variant.priceOverride ?? product.price) + money(product.sizeAdjustments[sizeName]);
    const unitPrice = discountedPrice(basePrice, product.discountPercent);
    return {
      productId: product.id,
      title: product.title,
      imageUrl: variant.imageUrl || product.imageUrl,
      variantId: variant.id,
      variantName: variant.name,
      size: sizeName,
      quantity,
      basePrice,
      unitPrice,
      discountPercent: product.discountPercent,
      freeship: product.freeship,
      lineTotal: unitPrice * quantity,
    };
  });
}

function pricing(items) {
  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const discountTotal = items.reduce((sum, item) => sum + (item.basePrice - item.unitPrice) * item.quantity, 0);
  const shippingFee = subtotal >= FREESHIP_THRESHOLD || items.some((item) => item.freeship) ? 0 : DEFAULT_SHIPPING_FEE;
  return { subtotal, discountTotal, shippingFee, total: subtotal + shippingFee };
}

async function decrementStock(products, items) {
  for (const item of items) {
    const existing = await products.findOne({ _id: item.productId });
    if (!existing) continue;
    const normalized = normalizeProduct(existing, existing);
    const variants = normalized.variants.map((variant) => variant.id !== item.variantId ? variant : ({
      ...variant,
      stockBySize: {
        ...variant.stockBySize,
        [item.size]: Math.max(0, stock(variant.stockBySize[item.size]) - item.quantity),
      },
    }));
    await products.updateOne({ _id: existing._id }, { $set: { variants, updatedAt: new Date() } });
  }
}

function formatTwd(value) {
  return `${money(value).toLocaleString('zh-TW')} TWD`;
}

async function sendWebhook(order, mapImage) {
  const webhookUrl = text(process.env.STORE_DISCORD_WEBHOOK_URL || process.env.DISCORD_STORE_WEBHOOK_URL);
  if (!webhookUrl) return;
  const fields = order.items.map((item) => `• ${item.title} ×${item.quantity} · ${item.variantName} / ${item.size} · ${formatTwd(item.lineTotal)}`).join('\n').slice(0, 1000);
  const payload = {
    username: 'KataShop',
    content: 'Đơn hàng KataShop mới',
    embeds: [{
      title: `Đơn ${order._id}`,
      color: 0xd36a79,
      fields: [
        { name: 'Khách hàng', value: `${order.customer.fullName}\n${order.customer.phone}\n${order.customer.address || 'Có ảnh bản đồ đính kèm'}`.slice(0, 1000) },
        { name: 'Sản phẩm', value: fields || '—' },
        { name: 'Tổng cộng', value: `${formatTwd(order.subtotal)} + ship ${formatTwd(order.shippingFee)} = **${formatTwd(order.total)}**` },
      ],
      timestamp: new Date(order.createdAt).toISOString(),
    }],
  };
  let options;
  if (mapImage?.buffer?.length) {
    const form = new FormData();
    form.append('payload_json', JSON.stringify(payload));
    form.append('files[0]', new Blob([mapImage.buffer], { type: mapImage.mimeType }), mapImage.fileName);
    options = { method: 'POST', body: form };
  } else {
    options = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
  }
  const response = await fetch(webhookUrl, options);
  if (!response.ok) throw new Error(`Discord webhook ${response.status}`);
}

async function handleOrders(req, res) {
  const { products, orders } = await ensureStore();

  if (req.method === 'POST') {
    const body = requestBody(req);
    const items = await buildOrderItems(body.items, products);
    const { customer, mapImage } = customerFrom(body);
    const totals = pricing(items);
    const now = new Date();
    const order = {
      _id: `KS-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
      customer,
      items,
      ...totals,
      status: 'new',
      mapImage: mapImage ? { fileName: mapImage.fileName, mimeType: mapImage.mimeType, size: mapImage.size } : null,
      createdAt: now,
      updatedAt: now,
    };
    await orders.insertOne(order);
    await decrementStock(products, items);
    let notificationSent = true;
    try { await sendWebhook(order, mapImage); } catch (error) {
      notificationSent = false;
      console.error('[store] webhook failed', error?.message);
      await orders.updateOne({ _id: order._id }, { $set: { notificationError: text(error?.message, 200) } });
    }
    return res.status(201).json({ ok: true, order: orderView(order), notificationSent });
  }

  await requireOwner(req);
  const id = text(req.query?.id, 120);

  if (req.method === 'GET') {
    const docs = await orders.find({}).sort({ createdAt: -1 }).limit(100).toArray();
    return res.status(200).json({ ok: true, orders: docs.map(orderView) });
  }

  if (!id) throw httpError(400, 'Thiếu mã đơn hàng.', 'ORDER_ID_REQUIRED');
  const existing = await orders.findOne({ _id: id });
  if (!existing) throw httpError(404, 'Không tìm thấy đơn hàng.', 'ORDER_NOT_FOUND');

  if (req.method === 'PATCH') {
    const status = text(requestBody(req).status, 32);
    if (!ORDER_STATUSES.has(status)) throw httpError(400, 'Trạng thái đơn hàng không hợp lệ.', 'ORDER_STATUS_INVALID');
    const updatedAt = new Date();
    await orders.updateOne({ _id: id }, { $set: { status, updatedAt } });
    return res.status(200).json({ ok: true, order: orderView({ ...existing, status, updatedAt }) });
  }

  if (req.method === 'DELETE') {
    await orders.deleteOne({ _id: id });
    return res.status(200).json({ ok: true, deleted: { id } });
  }

  return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
}

export async function handleStore(req, res) {
  const resource = text(req.query?.resource, 32) || 'config';
  try {
    if (resource === 'config') return await handleConfig(req, res);
    if (resource === 'products') return await handleProducts(req, res);
    if (resource === 'orders') return await handleOrders(req, res);
    return res.status(400).json({ error: 'UNKNOWN_STORE_RESOURCE' });
  } catch (error) {
    console.error('[store]', resource, error);
    return res.status(Number(error?.status) || 500).json({
      ok: false,
      error: error?.code || 'STORE_REQUEST_FAILED',
      message: Number(error?.status) >= 500 ? 'Store đang gặp sự cố. Vui lòng thử lại.' : text(error?.message, 300),
    });
  }
}

export const STORE_DEFAULTS = {
  shippingFee: DEFAULT_SHIPPING_FEE,
  freeThreshold: FREESHIP_THRESHOLD,
};
