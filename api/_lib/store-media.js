import crypto from 'node:crypto';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const IMAGE_DATA_URL = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i;

let client;
let clientSignature = '';

function storageError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function config() {
  const accountId = process.env.STORE_R2_ACCOUNT_ID?.trim() || process.env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = process.env.STORE_R2_ACCESS_KEY_ID?.trim() || process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.STORE_R2_SECRET_ACCESS_KEY?.trim() || process.env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = process.env.STORE_R2_BUCKET?.trim() || process.env.R2_BUCKET?.trim() || 'katas-media';
  const publicUrl = process.env.STORE_R2_PUBLIC_URL?.trim() || process.env.R2_PUBLIC_URL?.trim();
  if (!accountId || !accessKeyId || !secretAccessKey || !publicUrl) {
    throw storageError(503, 'Kho ảnh Store chưa được cấu hình.', 'STORE_MEDIA_NOT_CONFIGURED');
  }
  return { accountId, accessKeyId, secretAccessKey, bucket, publicUrl: publicUrl.replace(/\/$/, '') };
}

function getClient(cfg) {
  const signature = `${cfg.accountId}:${cfg.accessKeyId}`;
  if (client && clientSignature === signature) return client;
  client = new S3Client({
    region: 'auto',
    endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
  clientSignature = signature;
  return client;
}

function parseImage(dataUrl) {
  const match = String(dataUrl || '').match(IMAGE_DATA_URL);
  if (!match) throw storageError(400, 'Ảnh phải là PNG, JPG hoặc WebP.', 'STORE_IMAGE_INVALID');
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
    throw storageError(400, 'Ảnh sản phẩm phải nhỏ hơn 2 MB.', 'STORE_IMAGE_TOO_LARGE');
  }
  const rawType = match[1].toLowerCase();
  const extension = rawType.startsWith('jp') ? 'jpg' : rawType;
  const contentType = extension === 'jpg' ? 'image/jpeg' : `image/${extension}`;
  return { buffer, extension, contentType };
}

function safeStem(fileName) {
  return String(fileName || 'product')
    .replace(/\.[^.]+$/, '')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'product';
}

export async function uploadStoreImage({ dataUrl, fileName }) {
  const cfg = config();
  const image = parseImage(dataUrl);
  const now = new Date();
  const datePath = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const key = `store/products/${datePath}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${safeStem(fileName)}.${image.extension}`;
  await getClient(cfg).send(new PutObjectCommand({
    Bucket: cfg.bucket,
    Key: key,
    Body: image.buffer,
    ContentType: image.contentType,
    CacheControl: 'public, max-age=31536000, immutable',
  }));
  return { key, url: `${cfg.publicUrl}/${key}`, size: image.buffer.length, contentType: image.contentType };
}
