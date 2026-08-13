/**
 * 按服务器缓存探测结果，避免批建/批补发时重复 SSH 探测。
 * key 建议用 ip:port
 */

const DEFAULT_TTL_MS = 5 * 60 * 1000;

const store = new Map();

function cacheKey(host, port, kind) {
  return `${kind}:${host || ''}:${port || 22}`;
}

function getCached(host, port, kind) {
  const key = cacheKey(host, port, kind);
  const hit = store.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expireAt) {
    store.delete(key);
    return null;
  }
  return hit.value;
}

function setCached(host, port, kind, value, ttlMs = DEFAULT_TTL_MS) {
  store.set(cacheKey(host, port, kind), {
    value,
    expireAt: Date.now() + ttlMs
  });
  return value;
}

function clearCached(host, port, kind) {
  if (kind) {
    store.delete(cacheKey(host, port, kind));
    return;
  }
  const prefix = `:${host || ''}:${port || 22}`;
  for (const key of store.keys()) {
    if (key.endsWith(prefix) || key.includes(`:${host || ''}:${port || 22}`)) {
      store.delete(key);
    }
  }
}

module.exports = {
  getCached,
  setCached,
  clearCached,
  DEFAULT_TTL_MS
};
