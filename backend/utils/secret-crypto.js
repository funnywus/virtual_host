/**
 * 敏感字段应用层加密（AES-256-GCM）
 * 密文格式：enc:v1:<base64url(iv||tag||ciphertext)>
 * 未加前缀的值视为历史明文，decrypt 原样返回。
 */
const crypto = require('crypto');
const { requireSecret } = require('./env-check');

const PREFIX = 'enc:v1:';

let cachedKey = null;

function getDataKey() {
  if (cachedKey) return cachedKey;
  const raw = requireSecret('DATA_ENCRYPTION_KEY');
  // 支持 64 位 hex，或任意长字符串经 SHA-256 派生为 32 字节
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    cachedKey = Buffer.from(raw, 'hex');
  } else {
    cachedKey = crypto.createHash('sha256').update(raw).digest();
  }
  return cachedKey;
}

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

function encryptSecret(plain) {
  if (plain == null || plain === '') return plain;
  const text = String(plain);
  if (isEncrypted(text)) return text;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getDataKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const packed = Buffer.concat([iv, tag, encrypted]);
  return PREFIX + packed.toString('base64url');
}

function decryptSecret(value) {
  if (value == null || value === '') return value;
  const text = String(value);
  if (!isEncrypted(text)) return text;

  const packed = Buffer.from(text.slice(PREFIX.length), 'base64url');
  if (packed.length < 12 + 16 + 1) {
    throw new Error('密文损坏');
  }
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(12, 28);
  const data = packed.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', getDataKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function decryptDnsCreds(row) {
  if (!row) return row;
  if (row.access_key != null) row.access_key = decryptSecret(row.access_key);
  if (row.secret_key != null) row.secret_key = decryptSecret(row.secret_key);
  return row;
}

function decryptServerSecrets(row) {
  if (!row) return row;
  if (row.password != null) row.password = decryptSecret(row.password);
  if (row.ssh_pass != null) row.ssh_pass = decryptSecret(row.ssh_pass);
  return row;
}

function decryptFtpSecrets(row) {
  if (!row) return row;
  if (row.password != null) row.password = decryptSecret(row.password);
  if (row.ssh_pass != null) row.ssh_pass = decryptSecret(row.ssh_pass);
  return row;
}

module.exports = {
  PREFIX,
  isEncrypted,
  encryptSecret,
  decryptSecret,
  decryptDnsCreds,
  decryptServerSecrets,
  decryptFtpSecrets
};
