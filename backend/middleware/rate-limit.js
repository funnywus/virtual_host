/**
 * 轻量内存限流（单进程）。多实例部署时请换 Redis 等共享存储。
 */

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function createRateLimiter(options = {}) {
  const windowMs = options.windowMs || 15 * 60 * 1000;
  const max = options.max || 100;
  const message = options.message || '请求过于频繁，请稍后再试';
  const keyFn = options.keyFn || ((req) => clientIp(req));
  const hits = new Map();

  // 偶尔清理过期桶，避免 Map 无限增长
  setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of hits.entries()) {
      if (now > bucket.resetAt) hits.delete(key);
    }
  }, Math.min(windowMs, 60 * 1000)).unref?.();

  return function rateLimitMiddleware(req, res, next) {
    const key = keyFn(req);
    const now = Date.now();
    let bucket = hits.get(key);
    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      hits.set(key, bucket);
    }
    bucket.count += 1;

    const remaining = Math.max(0, max - bucket.count);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      return res.status(429).json({
        error: message,
        code: 'rate_limited',
        retry_after: Math.ceil((bucket.resetAt - now) / 1000)
      });
    }
    return next();
  };
}

/** 登录 / 注册：按 IP */
const loginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_LOGIN || '30', 10) || 30,
  message: '登录尝试过于频繁，请 15 分钟后再试'
});

/** 上传页授权码：按 IP + auth_code 前缀，防爆破 */
const uploadAuthLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_UPLOAD_AUTH || '60', 10) || 60,
  keyFn: (req) => {
    const code = String(req.body?.auth_code || '').trim().toLowerCase().slice(0, 8);
    return `${clientIp(req)}:auth:${code || '_'}`;
  },
  message: '授权验证过于频繁，请稍后再试'
});

module.exports = {
  createRateLimiter,
  clientIp,
  loginLimiter,
  uploadAuthLimiter
};
