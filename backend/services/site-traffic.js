/**
 * 站点访问日志流量统计（SSH 解析 Nginx access_log）
 *
 * 兼容：
 * 1) combined：... "$request" $status $body_bytes_sent "referer" ...
 * 2) vhost_traffic：... "$request" $status $body_bytes_sent $bytes_sent "referer" ...
 *
 * period=today 只扫当天（当前日志 + .log.1）；period=7d 才拆最近 7 天。
 */

/** 短 TTL 缓存，减轻列表反复翻页扫日志（按域名+口径缓存） */
const trafficCache = new Map(); // domain -> { data, expireAt }
const TRAFFIC_CACHE_TTL_MS = 2 * 60 * 1000;
const TRAFFIC_CACHE_MAX = 2000;

function getCachedTraffic(fullDomain, period = 'today') {
  const hit = trafficCache.get(`${fullDomain}:${period}`);
  if (!hit) return null;
  if (hit.expireAt <= Date.now()) {
    trafficCache.delete(`${fullDomain}:${period}`);
    return null;
  }
  return hit.data;
}

function setCachedTraffic(fullDomain, data, period = 'today') {
  const key = `${fullDomain}:${period}`;
  if (trafficCache.size >= TRAFFIC_CACHE_MAX) {
    const drop = Math.ceil(TRAFFIC_CACHE_MAX / 10);
    let i = 0;
    for (const k of trafficCache.keys()) {
      trafficCache.delete(k);
      i += 1;
      if (i >= drop) break;
    }
  }
  trafficCache.set(key, {
    data,
    expireAt: Date.now() + TRAFFIC_CACHE_TTL_MS
  });
}

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

function isoDate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

const DAILY_DAYS = 7;

/** 最近 N 天（含今天），今天在前 */
function trafficDayDefs(count = DAILY_DAYS) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push({
      date: isoDate(d),
      prefix: nginxDatePrefix(d)
    });
  }
  return days;
}

/** period: today | 7d */
function periodDatePrefixes(period = 'today') {
  const days = period === 'today' ? 1 : DAILY_DAYS;
  return trafficDayDefs(days).map((d) => d.prefix);
}

function emptyDays(dayDefs) {
  return dayDefs.map((d) => ({ date: d.date, requests: 0, bytes: 0 }));
}

function sumDays(days, period = '7d') {
  const list = period === 'today' ? (days || []).slice(0, 1) : (days || []);
  return list.reduce(
    (acc, d) => ({
      requests: acc.requests + (Number(d.requests) || 0),
      bytes: acc.bytes + (Number(d.bytes) || 0)
    }),
    { requests: 0, bytes: 0 }
  );
}

function buildLogPaths(fullDomain, days = DAILY_DAYS) {
  const base = `/www/wwwlogs/${fullDomain}.log`;
  const paths = [base, `${base}.1`];
  for (let i = 2; i < days; i++) paths.push(`${base}.${i}`);
  return paths;
}

function perlDailyTrafficScript(dateAlt) {
  return `
BEGIN { $acc=0; %req=(); %byt=(); $pat=qr{\\[((?:${dateAlt})):}; }
next unless /$pat/;
$day=$1;
if (/\\]\\s+"[^"]*"\\s+(\\d{3})\\s+(\\d+)(?:\\s+(\\d+))?\\s+"/) {
  $req{$day}++;
  if (defined $3) { $byt{$day} += $3; $acc = 1; }
  else { $byt{$day} += $2 || 0; }
}
END {
  printf "%d\\t", $acc;
  print join(",", map { sprintf("%s:%d:%d", $_, $req{$_}, $byt{$_} || 0) } keys %req);
  print "\\n";
}
`.trim();
}

function parseDayPairs(daysPart, dayDefs) {
  const days = emptyDays(dayDefs);
  const byPrefix = Object.fromEntries(dayDefs.map((d) => [d.prefix, d.date]));
  const byDate = Object.fromEntries(days.map((d) => [d.date, d]));
  if (!daysPart) return days;
  for (const item of String(daysPart).split(',')) {
    const m = item.match(/^([^:]+):(\d+):(\d+)$/);
    if (!m) continue;
    const iso = byPrefix[m[1]];
    const row = iso ? byDate[iso] : null;
    if (!row) continue;
    row.requests = parseInt(m[2], 10) || 0;
    row.bytes = parseInt(m[3], 10) || 0;
  }
  return days;
}

function parseAccAndDays(line, dayDefs, period) {
  const text = String(line || '').replace(/\r/g, '');
  const tab = text.indexOf('\t');
  if (tab >= 0) {
    const accPart = text.slice(0, tab).trim();
    const daysPart = text.slice(tab + 1).trim();
    const days = parseDayPairs(daysPart, dayDefs);
    return {
      ...sumDays(days, period),
      accurate: accPart === '1',
      days
    };
  }
  const trimmed = text.trim();
  if (/^[01]$/.test(trimmed)) {
    const days = emptyDays(dayDefs);
    return {
      ...sumDays(days, period),
      accurate: trimmed === '1',
      days
    };
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 3 && /^\d+$/.test(parts[0])) {
    return {
      requests: parseInt(parts[0], 10) || 0,
      bytes: parseInt(parts[1], 10) || 0,
      accurate: String(parts[2] || '0') === '1',
      days: emptyDays(dayDefs)
    };
  }
  return null;
}

function lastOutputLine(output) {
  const lines = String(output || '').replace(/\r/g, '').split('\n').filter((l) => l !== '');
  return lines.pop() || '';
}

function isTrafficLine(line) {
  const text = String(line || '');
  return /^\d+\t/.test(text) || /^[01]\s*$/.test(text) || /^\d+\s+\d+\s+\d+/.test(text.trim());
}

/**
 * 用 perl 按日解析（比 awk 处理引号字段更稳）
 * 输出: accurate<TAB>prefix:req:bytes,...
 */
function buildTrafficCommand(fullDomain, period = 'today') {
  const dayCount = period === '7d' ? DAILY_DAYS : 1;
  const dayDefs = trafficDayDefs(dayCount);
  const logPaths = buildLogPaths(fullDomain, dayCount);
  const pathsQuoted = logPaths.map(shellQuote).join(' ');
  const dateAlt = dayDefs.map((d) => d.prefix).join('|');

  const script = [
    `FILES=""; for f in ${pathsQuoted}; do [ -f "$f" ] && FILES="$FILES $f"; done`,
    `[ -z "$FILES" ] && echo "0\t" && exit 0`,
    `perl -ne ${shellQuote(perlDailyTrafficScript(dateAlt))} $FILES`
  ].join('\n');

  return script;
}

function parseTrafficOutput(output, period = '7d', dayDefs = trafficDayDefs()) {
  const parsed = parseAccAndDays(lastOutputLine(output) || '0\t', dayDefs, period);
  if (parsed) return parsed;
  return {
    requests: 0,
    bytes: 0,
    accurate: false,
    days: emptyDays(dayDefs)
  };
}

function emptyTraffic(period = 'today', extra = {}) {
  const dayDefs = trafficDayDefs(period === '7d' ? DAILY_DAYS : 1);
  const days = emptyDays(dayDefs);
  return {
    ...sumDays(days, period),
    accurate: false,
    period,
    days,
    ...extra
  };
}

/**
 * @param {object} sshService - 需有 exec(cmd, timeout?)
 * @param {string} fullDomain
 * @param {'today'|'7d'} period
 */
async function fetchSiteTraffic(sshService, fullDomain, period = 'today') {
  const safePeriod = period === '7d' ? '7d' : 'today';
  const dayDefs = trafficDayDefs(safePeriod === '7d' ? DAILY_DAYS : 1);
  const cached = getCachedTraffic(fullDomain, safePeriod);
  if (cached?.days) {
    return {
      ...sumDays(cached.days, safePeriod),
      accurate: !!cached.accurate,
      period: safePeriod,
      days: cached.days,
      cached: true
    };
  }

  const cmd = buildTrafficCommand(fullDomain, safePeriod);
  const result = await sshService.exec(cmd, 30000);

  if (!result.success && !String(result.output || '').trim()) {
    return emptyTraffic(safePeriod, { error: 'SSH 执行失败' });
  }

  const out = String(result.output || '').trim();
  const last = lastOutputLine(out);
  if (!isTrafficLine(last)) {
    return emptyTraffic(safePeriod, { error: out || '日志解析失败' });
  }

  const parsed = parseTrafficOutput(out, safePeriod, dayDefs);
  setCachedTraffic(fullDomain, { accurate: parsed.accurate, days: parsed.days }, safePeriod);
  return {
    ...sumDays(parsed.days, safePeriod),
    accurate: parsed.accurate,
    period: safePeriod,
    days: parsed.days
  };
}

/**
 * 同服一次 SSH 统计多个域名
 * 输出多行: domain<TAB>accurate<TAB>prefix:req:bytes,...
 */
function buildMultiTrafficCommand(fullDomains, period = 'today') {
  const dayCount = period === '7d' ? DAILY_DAYS : 1;
  const dayDefs = trafficDayDefs(dayCount);
  const dateAlt = dayDefs.map((d) => d.prefix).join('|');
  const domains = (fullDomains || []).filter(Boolean);
  if (!domains.length) return 'echo ""';

  const domainList = domains.map((d) => shellQuote(d)).join(' ');
  const rotated = period === '7d' ? '"/www/wwwlogs/$DOMAIN.log".[1-6]' : '"/www/wwwlogs/$DOMAIN.log.1"';
  return `
for DOMAIN in ${domainList}; do
  FILES=""
  for f in "/www/wwwlogs/$DOMAIN.log" ${rotated}; do
    [ -f "$f" ] && FILES="$FILES $f"
  done
  if [ -z "$FILES" ]; then
    printf '%s\\t0\\t\\n' "$DOMAIN"
    continue
  fi
  RESULT=$(perl -ne ${shellQuote(perlDailyTrafficScript(dateAlt))} $FILES 2>/dev/null || printf '0\\t')
  printf '%s\\t%s\\n' "$DOMAIN" "$RESULT"
done
`.trim();
}

function parseMultiTrafficOutput(output, period = 'today', dayDefs = trafficDayDefs()) {
  const map = {};
  const lines = String(output || '').replace(/\r/g, '').split('\n').filter((l) => l !== '');
  for (const line of lines) {
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const domain = line.slice(0, tab);
    const rest = line.slice(tab + 1);
    const parsed = parseAccAndDays(rest, dayDefs, period);
    if (!parsed) continue;
    map[domain] = {
      ...parsed,
      period
    };
  }
  return map;
}

/**
 * @param {object} sshService
 * @param {string[]} fullDomains
 * @param {'today'|'7d'} period
 */
async function fetchSitesTraffic(sshService, fullDomains, period = 'today') {
  const safePeriod = period === '7d' ? '7d' : 'today';
  const domains = [...new Set((fullDomains || []).filter(Boolean))];
  if (!domains.length) return {};

  const dayDefs = trafficDayDefs(safePeriod === '7d' ? DAILY_DAYS : 1);
  const out = {};
  const needFetch = [];
  for (const d of domains) {
    const cached = getCachedTraffic(d, safePeriod);
    if (cached?.days) {
      out[d] = {
        ...sumDays(cached.days, safePeriod),
        accurate: !!cached.accurate,
        period: safePeriod,
        days: cached.days,
        cached: true
      };
    } else {
      needFetch.push(d);
    }
  }
  if (!needFetch.length) return out;

  const cmd = buildMultiTrafficCommand(needFetch, safePeriod);
  const result = await sshService.exec(cmd, 60000);
  if (!result.success && !String(result.output || '').trim()) {
    for (const d of needFetch) {
      out[d] = emptyTraffic(safePeriod, { error: 'SSH 执行失败' });
    }
    return out;
  }
  const parsed = parseMultiTrafficOutput(result.output, safePeriod, dayDefs);
  for (const d of needFetch) {
    const row = parsed[d] || emptyTraffic(safePeriod);
    setCachedTraffic(d, { accurate: row.accurate, days: row.days }, safePeriod);
    out[d] = {
      ...sumDays(row.days, safePeriod),
      accurate: row.accurate,
      period: safePeriod,
      days: row.days
    };
  }
  return out;
}

function normalizeGranularity(value) {
  if (value === 'hour' || value === 'minute' || value === 'day') return value;
  return 'hour';
}

function normalizeSeriesRange(granularity, range) {
  if (granularity === 'minute') return range === 'today' ? 'today' : '1h';
  if (granularity === 'hour') return range === '7d' ? '7d' : 'today';
  return range === 'today' ? 'today' : '7d';
}

function floorToGranularity(date, granularity) {
  const d = new Date(date);
  d.setSeconds(0, 0);
  if (granularity !== 'minute') d.setMinutes(0, 0, 0);
  if (granularity === 'day') d.setHours(0, 0, 0, 0);
  return d;
}

function seriesWindow(granularity, range) {
  const end = floorToGranularity(new Date(), granularity);
  const start = new Date(end);
  if (granularity === 'minute') {
    if (range === 'today') start.setHours(0, 0, 0, 0);
    else start.setTime(end.getTime() - 59 * 60 * 1000);
  } else if (granularity === 'hour') {
    if (range === '7d') {
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
    } else {
      start.setHours(0, 0, 0, 0);
    }
  } else if (range !== 'today') {
    start.setDate(start.getDate() - 6);
  }
  return { start, end };
}

function nginxSeriesKey(date, granularity) {
  const prefix = nginxDatePrefix(date);
  if (granularity === 'day') return prefix;
  if (granularity === 'hour') return `${prefix}:${pad2(date.getHours())}`;
  return `${prefix}:${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function formatSeriesTime(date, granularity) {
  const md = `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  if (granularity === 'day') return `${date.getFullYear()}-${md}`;
  if (granularity === 'hour') return `${md} ${pad2(date.getHours())}:00`;
  return `${md} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function seriesStepMs(granularity) {
  if (granularity === 'minute') return 60 * 1000;
  if (granularity === 'hour') return 60 * 60 * 1000;
  return 24 * 60 * 60 * 1000;
}

function buildSeriesBuckets(granularity, range) {
  const { start, end } = seriesWindow(granularity, range);
  const step = seriesStepMs(granularity);
  const buckets = [];
  for (let t = start.getTime(); t <= end.getTime(); t += step) {
    const d = new Date(t);
    buckets.push({
      time: formatSeriesTime(d, granularity),
      key: nginxSeriesKey(d, granularity),
      requests: 0,
      bytes: 0
    });
  }
  return { start, end, buckets };
}

function dayPrefixesInWindow(start, end) {
  const prefixes = [];
  const d = new Date(start);
  d.setHours(0, 0, 0, 0);
  const last = new Date(end);
  last.setHours(0, 0, 0, 0);
  while (d.getTime() <= last.getTime()) {
    prefixes.push(nginxDatePrefix(d));
    d.setDate(d.getDate() + 1);
  }
  return prefixes;
}

function perlSeriesTrafficScript(dateAlt, granChar) {
  const g = granChar === 'h' || granChar === 'm' ? granChar : 'd';
  return `
BEGIN { $acc=0; %req=(); %byt=(); $pat=qr{\\[((?:${dateAlt})):(\\d{2}):(\\d{2}):\\d{2} }; }
next unless /$pat/;
$day=$1; $hh=$2; $mm=$3;
$key=$day;
$key="$day:$hh" if '${g}' eq 'h';
$key="$day:$hh:$mm" if '${g}' eq 'm';
if (/\\]\\s+"[^"]*"\\s+(\\d{3})\\s+(\\d+)(?:\\s+(\\d+))?\\s+"/) {
  $req{$key}++;
  if (defined $3) { $byt{$key} += $3; $acc = 1; }
  else { $byt{$key} += $2 || 0; }
}
END {
  printf "%d\\t", $acc;
  print join(",", map { sprintf("%s=%d=%d", $_, $req{$_}, $byt{$_} || 0) } keys %req);
  print "\\n";
}
`.trim();
}

function parseSeriesPairs(daysPart, buckets) {
  const byKey = Object.fromEntries(buckets.map((b) => [b.key, b]));
  if (!daysPart) return buckets;
  for (const item of String(daysPart).split(',')) {
    const m = item.match(/^(.+)=(\d+)=(\d+)$/);
    if (!m) continue;
    const row = byKey[m[1]];
    if (!row) continue;
    row.requests = parseInt(m[2], 10) || 0;
    row.bytes = parseInt(m[3], 10) || 0;
  }
  return buckets;
}

function buildSeriesCommand(fullDomain, granularity, range) {
  const gran = normalizeGranularity(granularity);
  const safeRange = normalizeSeriesRange(gran, range);
  const { start, end, buckets } = buildSeriesBuckets(gran, safeRange);
  const dateAlt = dayPrefixesInWindow(start, end).join('|') || nginxDatePrefix(new Date());
  const granChar = gran === 'hour' ? 'h' : gran === 'minute' ? 'm' : 'd';
  const logCount = safeRange === '7d' || gran === 'day' ? DAILY_DAYS : 2;
  const logPaths = [`/www/wwwlogs/${fullDomain}.log`];
  for (let i = 1; i < logCount; i++) logPaths.push(`/www/wwwlogs/${fullDomain}.log.${i}`);
  const pathsQuoted = logPaths.map(shellQuote).join(' ');
  const script = [
    `FILES=""; for f in ${pathsQuoted}; do [ -f "$f" ] && FILES="$FILES $f"; done`,
    `[ -z "$FILES" ] && echo "0\t" && exit 0`,
    `perl -ne ${shellQuote(perlSeriesTrafficScript(dateAlt, granChar))} $FILES`
  ].join('\n');
  return { cmd: script, buckets, granularity: gran, range: safeRange };
}

async function fetchSiteTrafficSeries(sshService, fullDomain, granularity = 'hour', range = 'today') {
  const built = buildSeriesCommand(fullDomain, granularity, range);
  const result = await sshService.exec(built.cmd, 90000);
  if (!result.success && !String(result.output || '').trim()) {
    return {
      granularity: built.granularity,
      range: built.range,
      accurate: false,
      requests: 0,
      bytes: 0,
      points: built.buckets.map(({ time, requests, bytes }) => ({ time, requests, bytes })),
      error: 'SSH 执行失败'
    };
  }
  const last = lastOutputLine(result.output);
  if (!isTrafficLine(last) && last.trim() !== '') {
    return {
      granularity: built.granularity,
      range: built.range,
      accurate: false,
      requests: 0,
      bytes: 0,
      points: built.buckets.map(({ time, requests, bytes }) => ({ time, requests, bytes })),
      error: last || '日志解析失败'
    };
  }
  const text = last || '0\t';
  const tab = text.indexOf('\t');
  const accPart = tab >= 0 ? text.slice(0, tab).trim() : text.trim();
  const daysPart = tab >= 0 ? text.slice(tab + 1).trim() : '';
  parseSeriesPairs(daysPart, built.buckets);
  const points = built.buckets.map(({ time, requests, bytes }) => ({ time, requests, bytes }));
  const totals = points.reduce(
    (acc, p) => ({ requests: acc.requests + p.requests, bytes: acc.bytes + p.bytes }),
    { requests: 0, bytes: 0 }
  );
  return {
    granularity: built.granularity,
    range: built.range,
    accurate: accPart === '1',
    ...totals,
    points
  };
}

module.exports = {
  fetchSiteTraffic,
  fetchSitesTraffic,
  fetchSiteTrafficSeries,
  buildTrafficCommand,
  buildMultiTrafficCommand,
  buildSeriesCommand,
  parseTrafficOutput,
  parseMultiTrafficOutput,
  periodDatePrefixes,
  nginxDatePrefix,
  trafficDayDefs,
  emptyTraffic,
  sumDays,
  getCachedTraffic,
  setCachedTraffic
};
