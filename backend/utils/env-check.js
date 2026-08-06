/**
 * 启动期环境变量校验：缺失或仍为占位默认值则直接退出。
 */

const WEAK_SECRETS = new Set([
  '',
  'secret',
  'jwt_secret',
  'change_me',
  'your_jwt_secret_key_change_this',
  'change_this_to_a_long_random_secret_string'
]);

function isWeakSecret(value) {
  const v = String(value || '').trim();
  if (v.length < 16) return true;
  if (WEAK_SECRETS.has(v)) return true;
  if (/change_this|your_.*_secret|changeme/i.test(v)) return true;
  return false;
}

function requireSecret(name) {
  const value = process.env[name];
  if (isWeakSecret(value)) {
    console.error(
      `[FATAL] 环境变量 ${name} 未设置或仍为不安全默认值。\n` +
      `请在 backend/.env 中配置至少 16 位的随机字符串后重启。`
    );
    process.exit(1);
  }
  return value.trim();
}

function assertRequiredSecrets() {
  requireSecret('JWT_SECRET');
  requireSecret('UPLOAD_SIGN_SECRET');
  requireSecret('DATA_ENCRYPTION_KEY');
}

function getJwtSecret() {
  return requireSecret('JWT_SECRET');
}

function getUploadSignSecret() {
  return requireSecret('UPLOAD_SIGN_SECRET');
}

function getDataEncryptionKey() {
  return requireSecret('DATA_ENCRYPTION_KEY');
}

module.exports = {
  assertRequiredSecrets,
  requireSecret,
  getJwtSecret,
  getUploadSignSecret,
  getDataEncryptionKey,
  isWeakSecret
};
