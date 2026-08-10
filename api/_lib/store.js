import crypto from 'node:crypto';
import { ObjectId } from 'mongodb';
import { getDb } from './mongo.js';
import { readSession } from './session.js';
import { uploadStoreImage } from './store-media.js';
import { callChat, tryParseJson } from '../_helpers.js';

const PRODUCT_COLLECTION = 'storeproducts';
const ORDER_COLLECTION = 'storeorders';
const VISIT_DAY_COLLECTION = 'storevisitdays';
const VISIT_UNIQUE_COLLECTION = 'storevisituniques';
const MAX_CART_ITEMS = 25;
const MAX_MAP_IMAGE_BYTES = 1 * 1024 * 1024;
const MAX_MAP_IMAGES = 3;
const MAX_PRODUCT_IMAGE_BYTES = 2 * 1024 * 1024;
const DEFAULT_SHIPPING_FEE = 38;
const FREESHIP_THRESHOLD = 700;
const DEFAULT_PRODUCT_IMAGE = '/og.svg';
const ORDER_STATUSES = new Set(['new', 'confirmed', 'shipping', 'completed', 'cancelled']);
const DEFAULT_OWNER_DISCORD_IDS = [
  '397342895327150080',
  '609407967586156544',
  '489092502998220812',
];
const DEFAULT_OWNER_DISCORD_ID = DEFAULT_OWNER_DISCORD_IDS[0];

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
  const galleryImages = list(source.galleryImages, 12, MAX_PRODUCT_IMAGE_BYTES * 2).map((entry) => imageUrl(entry, '')).filter(Boolean);
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
    galleryImages,
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
    mapImages: Array.isArray(doc.mapImages) ? doc.mapImages : (doc.mapImage ? [doc.mapImage] : []),
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

function ownerDiscordIds() {
  const raw = process.env.STORE_OWNER_DISCORD_IDS
    || process.env.STORE_OWNER_DISCORD_ID
    || process.env.OWNER_DISCORD_IDS
    || process.env.OWNER_DISCORD_ID
    || '';
  const fromEnv = String(raw).split(/[\s,]+/).map((entry) => entry.trim()).filter(Boolean);
  return [...new Set([...DEFAULT_OWNER_DISCORD_IDS, ...fromEnv])];
}

function isOwner(user) {
  if (!user) return false;
  const discordId = text(user.providerUserId);
  if (user.provider === 'discord' && discordId && ownerDiscordIds().includes(discordId)) return true;
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

async function handleUploads(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  await requireOwner(req);
  const body = requestBody(req);
  const uploaded = await uploadStoreImage({ dataUrl: body.dataUrl, fileName: body.fileName });
  return res.status(201).json({ ok: true, ...uploaded });
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
  const note = text(customer.note, 1000);
  const rawImages = Array.isArray(body.mapImages) ? body.mapImages.slice(0, MAX_MAP_IMAGES) : (body.mapImage ? [body.mapImage] : []);
  const mapImages = rawImages.map(parseMapImage).filter(Boolean);
  if (!fullName) throw httpError(400, 'Vui lòng nhập tên người nhận.', 'CUSTOMER_NAME_REQUIRED');
  if (!phone) throw httpError(400, 'Vui lòng nhập số điện thoại.', 'CUSTOMER_PHONE_REQUIRED');
  if (!address && !mapImages.length) throw httpError(400, 'Vui lòng nhập địa chỉ hoặc gửi ảnh bản đồ.', 'CUSTOMER_ADDRESS_REQUIRED');
  return { customer: { fullName, phone, address, note }, mapImages };
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

function productUrl(productId) {
  const base = text(process.env.STORE_PUBLIC_URL || process.env.AUTH_BASE_URL || 'https://se77n.com', 300).replace(/\/+$/, '');
  return `${base}/store/product/${encodeURIComponent(productId)}`;
}

async function sendWebhook(order, mapImages = []) {
  const webhookUrl = text(process.env.STORE_DISCORD_WEBHOOK_URL || process.env.DISCORD_STORE_WEBHOOK_URL);
  if (!webhookUrl) return;
  const ownerIds = ownerDiscordIds();
  const mentionIds = ownerIds.length ? ownerIds : [DEFAULT_OWNER_DISCORD_ID];
  const products = order.items.map((item) => `• [${item.title}](${productUrl(item.productId)})`).join('\n').slice(0, 1024);
  const variants = order.items.map((item) => `• ${item.variantName} ×${item.quantity}`).join('\n').slice(0, 1024);
  const sizes = order.items.map((item) => `• ${item.size} ×${item.quantity}`).join('\n').slice(0, 1024);
  const prices = order.items.map((item) => `• ${formatTwd(item.unitPrice)} ×${item.quantity} = ${formatTwd(item.lineTotal)}`).join('\n');
  const totals = `${prices}\nTạm tính: ${formatTwd(order.subtotal)}\nGiao hàng: ${order.shippingFee ? formatTwd(order.shippingFee) : 'Miễn phí'}\n**Tổng cộng: ${formatTwd(order.total)}**`.slice(0, 1024);
  const payload = {
    username: 'KataShop',
    content: `${mentionIds.map((id) => `<@${id}>`).join(' ')} Đơn hàng KataShop mới`,
    allowed_mentions: { parse: [], users: mentionIds },
    embeds: [{
      title: `Đơn ${order._id}`,
      color: 0xd36a79,
      fields: [
        { name: 'Khách hàng', value: `${order.customer.fullName}\n${order.customer.phone}\n${order.customer.address || 'Đã gửi ảnh vị trí'}`.slice(0, 1024) },
        { name: 'Sản phẩm', value: products || '—' },
        { name: 'Mẫu', value: variants || '—', inline: true },
        { name: 'Size', value: sizes || '—', inline: true },
        { name: 'Giá / Tổng cộng', value: totals },
        { name: 'Ảnh đính kèm', value: mapImages.length ? `Có ${mapImages.length} ảnh vị trí đính kèm.` : 'Không có ảnh đính kèm.' },
        { name: 'Ghi chú', value: order.customer.note || 'Không có ghi chú.' },
      ],
      timestamp: new Date(order.createdAt).toISOString(),
    }],
  };
  let options;
  if (mapImages.length) {
    const form = new FormData();
    form.append('payload_json', JSON.stringify(payload));
    mapImages.forEach((mapImage, index) => form.append(`files[${index}]`, new Blob([mapImage.buffer], { type: mapImage.mimeType }), mapImage.fileName));
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
    const { customer, mapImages } = customerFrom(body);
    const totals = pricing(items);
    const now = new Date();
    const order = {
      _id: `KS-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
      customer,
      items,
      ...totals,
      status: 'new',
      mapImage: mapImages[0] ? { fileName: mapImages[0].fileName, mimeType: mapImages[0].mimeType, size: mapImages[0].size } : null,
      mapImages: mapImages.map((image) => ({ fileName: image.fileName, mimeType: image.mimeType, size: image.size })),
      createdAt: now,
      updatedAt: now,
    };
    await orders.insertOne(order);
    await decrementStock(products, items);
    let notificationSent = true;
    try { await sendWebhook(order, mapImages); } catch (error) {
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

const STORE_AI_SYSTEM = [
  'Bạn là trợ lý merchandising cho KataShop (cửa hàng thời trang/lifestyle nhỏ tại Đài Loan).',
  'Nhìn ảnh sản phẩm + NOTE của admin (nếu có) và trả về ĐÚNG MỘT JSON object thuần (không markdown, không giải thích, không ```) theo schema:',
  '{',
  '  "title": string,',
  '  "subtitle": string,',
  '  "description": string,',
  '  "genders": ["men"|"women"|"unisex"],',
  '  "sizes": string[],',
  '  "price": number,',
  '  "discountPercent": number,',
  '  "freeship": boolean,',
  '  "mainImageIndex": number,',
  '  "galleryImageIndexes": number[],',
  '  "variants": [{',
  '    "name": string,',
  '    "colorHex": "#RRGGBB",',
  '    "imageIndex": number,',
  '    "priceOverride": number|null,',
  '    "stockBySize": { "<size>": number }',
  '  }]',
  '}',
  'Quy tắc:',
  '- NOTE của admin là ưu tiên tuyệt đối: số mẫu, màu, size, mô tả, GIÁ, GIẢM GIÁ, FREESHIP, TỒN KHO… phải tuân theo đúng số liệu trong NOTE.',
  '- price: giá mặc định (TWD). Lấy số từ NOTE (vd "180", "180 TWD", "giá 180"). Không bịa giá nếu NOTE không nói — khi đó để 0.',
  '- discountPercent: % giảm nếu NOTE có (vd "giảm 10%", "sale 15", "-20%"); không thì 0. Chỉ 0–95.',
  '- freeship: true nếu NOTE nhắc free ship / freeship / miễn phí ship / miễn ship; không thì false.',
  '- stockBySize: bắt buộc điền theo NOTE. Nếu NOTE nói tồn chung (vd "còn 10", "stock 10") thì gán cùng số cho mọi size của mọi mẫu.',
  '- Nếu NOTE nói tồn theo size/mẫu (vd "Đen S:5 M:3", "mỗi mẫu 8 cái") thì map đúng từng ô stockBySize.',
  '- Nếu NOTE không nói tồn kho thì để 0 (không tự bịa).',
  '- priceOverride: chỉ khi NOTE ghi giá khác theo mẫu; không thì null (dùng price chung).',
  '- Viết title/subtitle/description bằng tiếng Việt, tự nhiên, bán hàng, không phóng đại quá đà.',
  '- title ngắn gọn (≤ 80 ký tự). subtitle một dòng. description 2–4 câu (bổ sung chi tiết từ NOTE nếu có).',
  '- sizes: lấy từ NOTE nếu admin ghi; không thì gợi ý phù hợp sản phẩm.',
  '- mainImageIndex: ảnh đẹp/đại diện nhất làm ảnh chính (0-based).',
  '- galleryImageIndexes: ảnh phụ (chi tiết/góc khác), không trùng main.',
  '- variants: mỗi màu/kiểu là một mẫu. imageIndex trỏ ảnh phù hợp nhất cho mẫu đó.',
  '- Nếu NOTE yêu cầu N mẫu thì trả đúng N mẫu (trong khả năng ảnh).',
  '- colorHex phải là hex hợp lệ. Không trả field ngoài schema.',
].join('\n');

function isHttpOrDataImage(value) {
  return /^https?:\/\//i.test(value) || /^data:image\/(png|jpe?g|webp);base64,/i.test(value);
}

function stockMapFrom(raw, sizes) {
  const out = Object.fromEntries(sizes.map((size) => [size, 0]));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const size of sizes) {
    const direct = raw[size];
    if (direct != null) {
      out[size] = Math.max(0, Math.min(9999, Math.round(Number(direct) || 0)));
      continue;
    }
    // Case-insensitive key match
    const hit = Object.keys(raw).find((key) => String(key).trim().toLowerCase() === size.toLowerCase());
    if (hit != null) out[size] = Math.max(0, Math.min(9999, Math.round(Number(raw[hit]) || 0)));
  }
  // If NOTE-style single stock was returned as { all: N } / { default: N } / { "*": N }
  const sharedKeys = ['all', 'default', '*', 'total', 'chung'];
  const shared = sharedKeys.map((key) => raw[key]).find((value) => value != null && Number.isFinite(Number(value)));
  if (shared != null && sizes.every((size) => out[size] === 0)) {
    const n = Math.max(0, Math.min(9999, Math.round(Number(shared) || 0)));
    for (const size of sizes) out[size] = n;
  }
  return out;
}

function normalizeAiFill(raw, imageCount) {
  const parsed = raw && typeof raw === 'object' ? raw : {};
  const title = text(parsed.title, 120);
  const subtitle = text(parsed.subtitle, 160);
  const description = text(parsed.description, 2000);
  if (!title) throw httpError(422, 'AI không trả về tên sản phẩm.', 'AI_TITLE_MISSING');

  let genders = list(parsed.genders, 3, 16).filter((entry) => entry === 'men' || entry === 'women' || entry === 'unisex');
  if (!genders.length) genders = ['unisex'];
  if (genders.includes('unisex') && genders.length > 1) genders = ['unisex'];

  let sizes = list(parsed.sizes, 12, 32);
  if (!sizes.length) sizes = ['Free size'];

  const price = Math.max(0, Math.min(1_000_000, Math.round(Number(parsed.price) || 0)));
  let discountPercent = Math.round(Number(parsed.discountPercent) || 0);
  if (!Number.isFinite(discountPercent)) discountPercent = 0;
  discountPercent = Math.max(0, Math.min(95, discountPercent));
  const freeship = parsed.freeship === true
    || parsed.freeship === 1
    || parsed.freeship === 'true'
    || parsed.freeShip === true
    || parsed.free_shipping === true;

  let mainImageIndex = Number.parseInt(parsed.mainImageIndex, 10);
  if (!Number.isFinite(mainImageIndex) || mainImageIndex < 0 || mainImageIndex >= imageCount) mainImageIndex = 0;

  const galleryImageIndexes = [...new Set(
    (Array.isArray(parsed.galleryImageIndexes) ? parsed.galleryImageIndexes : [])
      .map((entry) => Number.parseInt(entry, 10))
      .filter((entry) => Number.isFinite(entry) && entry >= 0 && entry < imageCount && entry !== mainImageIndex),
  )].slice(0, 8);

  const rawVariants = Array.isArray(parsed.variants) ? parsed.variants.slice(0, 8) : [];
  const variants = (rawVariants.length ? rawVariants : [{ name: 'Mặc định', colorHex: '#d36a79', imageIndex: mainImageIndex }]).map((entry, index) => {
    const name = text(entry?.name, 60) || `Mẫu ${index + 1}`;
    let colorHex = text(entry?.colorHex, 7).toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(colorHex)) colorHex = '#d36a79';
    let imageIndex = Number.parseInt(entry?.imageIndex, 10);
    if (!Number.isFinite(imageIndex) || imageIndex < 0 || imageIndex >= imageCount) {
      imageIndex = Math.min(index, Math.max(0, imageCount - 1));
    }
    let priceOverride = null;
    if (entry?.priceOverride != null && entry.priceOverride !== '') {
      const n = Math.round(Number(entry.priceOverride));
      if (Number.isFinite(n) && n >= 0) priceOverride = Math.min(1_000_000, n);
    }
    // Accept stockBySize object, or a flat stock number for all sizes.
    let stockBySize = stockMapFrom(entry?.stockBySize, sizes);
    if (sizes.every((size) => stockBySize[size] === 0)) {
      const flat = entry?.stock ?? entry?.quantity ?? entry?.qty ?? parsed.stock ?? parsed.quantity;
      if (flat != null && Number.isFinite(Number(flat))) {
        const n = Math.max(0, Math.min(9999, Math.round(Number(flat) || 0)));
        stockBySize = Object.fromEntries(sizes.map((size) => [size, n]));
      }
    }
    return { name, colorHex, imageIndex, priceOverride, stockBySize };
  });

  return {
    title, subtitle, description, genders, sizes, price, discountPercent, freeship,
    mainImageIndex, galleryImageIndexes, variants,
  };
}

async function handleAiFill(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  await requireOwner(req);
  const body = requestBody(req);
  const hint = text(body.hint || body.note, 2000);
  const images = [];
  const pushImage = (value) => {
    const url = text(value, 2_500_000);
    if (!url || !isHttpOrDataImage(url)) return;
    if (images.includes(url)) return;
    if (images.length >= 8) return;
    images.push(url);
  };
  pushImage(body.imageUrl);
  (Array.isArray(body.images) ? body.images : []).forEach(pushImage);
  (Array.isArray(body.galleryImages) ? body.galleryImages : []).forEach(pushImage);
  if (!images.length) throw httpError(400, 'Cần ít nhất một ảnh sản phẩm để AI điền.', 'AI_IMAGE_REQUIRED');

  const prompt = [
    `Có ${images.length} ảnh sản phẩm (imageIndex 0 → ${images.length - 1}), chưa xếp sẵn vai trò.`,
    'Hãy tự chọn ảnh chính, ảnh phụ và ảnh cho từng mẫu.',
    hint
      ? `NOTE BẮT BUỘC TỪ ADMIN (ưu tiên tuyệt đối — trích đúng GIÁ, % GIẢM, FREESHIP và TỒN KHO nếu có):\n${hint}`
      : 'Admin không để NOTE — tự suy luận hợp lý từ ảnh; price=0, discountPercent=0, freeship=false và stockBySize=0 nếu không chắc.',
    'Nhớ trả price, discountPercent, freeship và variants[].stockBySize theo NOTE.',
    'Hãy điền listing KataShop theo schema đã cho.',
  ].filter(Boolean).join('\n');

  let textOut;
  const primaryModel = process.env.STORE_AI_MODEL || process.env.OPENROUTER_VISION_MODEL || 'google/gemini-2.5-pro';
  const fallbackModel = process.env.STORE_AI_FALLBACK_MODEL || 'google/gemini-2.5-flash';
  async function runFill(model) {
    return callChat({
      system: STORE_AI_SYSTEM,
      prompt,
      images,
      jsonMode: true,
      temperature: 0.2,
      max_tokens: 8192,
      model,
    });
  }
  try {
    textOut = await runFill(primaryModel);
  } catch (error) {
    // Surface provider/config errors to the admin UI (avoid generic 5xx mask).
    const status = Number(error?.status) || 422;
    throw httpError(
      status >= 500 ? 422 : status,
      error?.message || 'AI điền sản phẩm thất bại.',
      error?.code || 'AI_FILL_FAILED',
    );
  }

  let parsed = tryParseJson(textOut);
  // Gemini 2.5-pro via OpenRouter sometimes returns empty/prose instead of JSON —
  // one automatic retry on flash before failing the admin.
  if (!parsed && fallbackModel && fallbackModel !== primaryModel) {
    try {
      textOut = await runFill(fallbackModel);
      parsed = tryParseJson(textOut);
    } catch {
      /* keep original parse failure below */
    }
  }
  if (!parsed) {
    const preview = String(textOut || '').replace(/\s+/g, ' ').slice(0, 120);
    throw httpError(
      422,
      preview
        ? `AI trả JSON không hợp lệ (không phải ảnh mờ). Đoạn trả về: “${preview}…” — thử lại.`
        : 'AI (OpenRouter/Gemini) trả về rỗng — thường do model reasoning nuốt hết token. Thử lại hoặc đặt STORE_AI_MODEL=google/gemini-2.5-flash.',
      'AI_PARSE_FAILED',
    );
  }
  const fill = normalizeAiFill(parsed, images.length);
  return res.status(200).json({ ok: true, fill, images });
}

function taiwanDayKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function normalizeVisitPath(rawPath) {
  const path = text(rawPath, 200).split('?')[0].replace(/\/+$/, '') || '/store';
  if (path === '/store') return '/store';
  if (/^\/store\/[MF]$/i.test(path)) return `/store/${path.slice(-1).toUpperCase()}`;
  if (/^\/store\/product\/[^/]+$/i.test(path)) return '/store/product';
  if (path.startsWith('/store/') && path !== '/store/admin') return '/store';
  return '';
}

async function recordVisit(req, res) {
  if (req.method !== 'POST') throw httpError(405, 'Method not allowed.', 'METHOD_NOT_ALLOWED');
  const body = requestBody(req);
  const path = normalizeVisitPath(body.path || req.query?.path);
  if (!path) return res.status(200).json({ ok: true, skipped: true });
  const visitorId = text(body.visitorId, 80).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  const day = taiwanDayKey();
  const now = new Date();
  const { db } = await ensureStore();
  const days = db.collection(VISIT_DAY_COLLECTION);
  const uniques = db.collection(VISIT_UNIQUE_COLLECTION);
  const pathKey = path.replace(/\./g, '_');
  await days.updateOne(
    { _id: day },
    {
      $inc: { views: 1, [`paths.${pathKey}`]: 1 },
      $set: { updatedAt: now },
      $setOnInsert: { day, createdAt: now },
    },
    { upsert: true },
  );
  let unique = false;
  if (visitorId) {
    try {
      await uniques.insertOne({ _id: `${day}:${visitorId}`, day, visitorId, path, createdAt: now });
      unique = true;
      await days.updateOne({ _id: day }, { $inc: { uniques: 1 }, $set: { updatedAt: now } });
    } catch (error) {
      if (error?.code !== 11000) throw error;
    }
  }
  return res.status(200).json({ ok: true, unique });
}

async function handleVisits(req, res) {
  if (req.method === 'POST') return recordVisit(req, res);
  if (req.method !== 'GET') throw httpError(405, 'Method not allowed.', 'METHOD_NOT_ALLOWED');
  await requireOwner(req);
  const { db } = await ensureStore();
  const days = db.collection(VISIT_DAY_COLLECTION);
  const today = taiwanDayKey();
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 29);
  const recent = await days.find({ _id: { $gte: taiwanDayKey(start) } }).sort({ _id: 1 }).toArray();
  const byId = new Map(recent.map((doc) => [doc._id, doc]));
  const series = [];
  for (let offset = 13; offset >= 0; offset -= 1) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - offset);
    const key = taiwanDayKey(date);
    const doc = byId.get(key);
    series.push({
      day: key,
      views: Number(doc?.views || 0),
      uniques: Number(doc?.uniques || 0),
    });
  }
  const sumDocs = (docs) => docs.reduce((acc, doc) => {
    acc.views += Number(doc.views || 0);
    acc.uniques += Number(doc.uniques || 0);
    const paths = doc.paths || {};
    for (const [key, value] of Object.entries(paths)) {
      acc.paths[key] = (acc.paths[key] || 0) + Number(value || 0);
    }
    return acc;
  }, { views: 0, uniques: 0, paths: {} });
  const last7Keys = series.slice(-7).map((entry) => entry.day);
  const last7Docs = last7Keys.map((key) => byId.get(key)).filter(Boolean);
  const todayDoc = byId.get(today) || { views: 0, uniques: 0, paths: {} };
  const last7 = sumDocs(last7Docs);
  const last30 = sumDocs(recent);
  const pathLabel = {
    '/store': 'Tất cả / trang chủ',
    '/store/M': 'Nam (/store/M)',
    '/store/F': 'Nữ (/store/F)',
    '/store/product': 'Trang sản phẩm',
  };
  const topPaths = Object.entries({ ...(last30.paths || {}) })
    .map(([path, views]) => ({ path, label: pathLabel[path] || path, views: Number(views || 0) }))
    .sort((a, b) => b.views - a.views);
  return res.status(200).json({
    ok: true,
    timezone: 'Asia/Taipei',
    today: {
      day: today,
      views: Number(todayDoc.views || 0),
      uniques: Number(todayDoc.uniques || 0),
      paths: todayDoc.paths || {},
    },
    last7: { views: last7.views, uniques: last7.uniques, paths: last7.paths },
    last30: { views: last30.views, uniques: last30.uniques, paths: last30.paths },
    series,
    topPaths,
  });
}

export async function handleStore(req, res) {
  const resource = text(req.query?.resource, 32) || 'config';
  try {
    if (resource === 'config') return await handleConfig(req, res);
    if (resource === 'products') return await handleProducts(req, res);
    if (resource === 'uploads') return await handleUploads(req, res);
    if (resource === 'orders') return await handleOrders(req, res);
    if (resource === 'ai') return await handleAiFill(req, res);
    if (resource === 'visits') return await handleVisits(req, res);
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
