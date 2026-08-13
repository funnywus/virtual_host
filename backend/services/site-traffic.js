/**
 * 站点访问日志流量统计（SSH 解析 Nginx access_log）
 *
 * 兼容：
 * 1) combined：... "$request" $status $body_bytes_sent "referer" ...
 * 2) vhost_traffic：... "$request" $status $body_bytes_sent $bytes_sent "referer" ...
 */

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** 生成 Nginx 日志日期前缀，如 12/Aug/2026 */
function nginxDatePrefix(date) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${pad2(date.getDate())}/${months[date.getMonth()]}/${date.getFullYear()}`;
}

/** period: today | 7d */
function periodDatePrefixes(period = 'today') {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = period === '7d' ? 7 : 1;
  const prefixes = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    prefixes.push(nginxDatePrefix(d));
  }
  return prefixes;
}

function buildLogPaths(fullDomain) {
  const base = `/www/wwwlogs/${fullDomain}.log`;
  return [base, `${base}.1`];
}

/**
 * 用 perl 一行解析（比 awk 处理引号字段更稳）
 * 输出: requests bytes accurate(0|1)
 */
function buildTrafficCommand(fullDomain, period = 'today') {
  const prefixes = periodDatePrefixes(period);
  const logPaths = buildLogPaths(fullDomain);
  const pathsQuoted = logPaths.map(shellQuote).join(' ');
  // 日期字面量给 perl，如 12/Aug/2026|11/Aug/2026
  const dateAlt = prefixes.join('|');

  const script = [
    `FILES=""; for f in ${pathsQuoted}; do [ -f "$f" ] && FILES="$FILES $f"; done`,
    `[ -z "$FILES" ] && echo "0 0 0" && exit 0`,
    `perl -ne ${shellQuote(`
BEGIN { $req=0; $bytes=0; $acc=0; $pat=qr{\\[(?:${dateAlt}):}; }
next unless /$pat/;
# ] "request" status body [bytes_sent] "referer"
if (/\\]\\s+"[^"]*"\\s+(\\d{3})\\s+(\\d+)(?:\\s+(\\d+))?\\s+"/) {
  $req++;
  if (defined $3) { $bytes += $3; $acc = 1; }
  else { $bytes += $2; }
}
END { printf "%d %d %d\\n", $req, $bytes, $acc; }
`.trim())} $FILES`
  ].join('\n');

  return script;
}

function parseTrafficOutput(output) {
  const text = String(output || '').trim().split('\n').filter(Boolean).pop() || '0 0 0';
  const parts = text.trim().split(/\s+/);
  return {
    requests: parseInt(parts[0], 10) || 0,
    bytes: parseInt(parts[1], 10) || 0,
    accurate: String(parts[2] || '0') === '1'
  };
}

/**
 * @param {object} sshService - 需有 exec(cmd, timeout?)
 * @param {string} fullDomain
 * @param {'today'|'7d'} period
 */
async function fetchSiteTraffic(sshService, fullDomain, period = 'today') {
  const safePeriod = period === '7d' ? '7d' : 'today';
  const cmd = buildTrafficCommand(fullDomain, safePeriod);
  const result = await sshService.exec(cmd, 30000);

  if (!result.success && !String(result.output || '').trim()) {
    return {
      requests: 0,
      bytes: 0,
      period: safePeriod,
      accurate: false,
      error: 'SSH 执行失败'
    };
  }

  // 部分环境 perl 失败时回退到简单 wc（仅请求数近似）
  const out = String(result.output || '').trim();
  if (!/^\d+\s+\d+\s+\d+/.test(out.split('\n').filter(Boolean).pop() || '')) {
    return {
      requests: 0,
      bytes: 0,
      period: safePeriod,
      accurate: false,
      error: out || '日志解析失败'
    };
  }

  return {
    ...parseTrafficOutput(out),
    period: safePeriod
  };
}

module.exports = {
  fetchSiteTraffic,
  buildTrafficCommand,
  parseTrafficOutput,
  periodDatePrefixes,
  nginxDatePrefix
};
