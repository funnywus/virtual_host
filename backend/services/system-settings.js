const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const SETTINGS_PATH = path.join(__dirname, '../data/system-settings.json');

const DEFAULTS = {
  ssl_auto_renew: true,
  ssl_renew_before_days: 30,
  ssl_check_hour: 3,
  last_ssl_check_at: null,
  last_ssl_renew_at: null,
  last_ssl_renew_summary: null
};

async function ensureDir() {
  const dir = path.dirname(SETTINGS_PATH);
  await fsp.mkdir(dir, { recursive: true });
}

async function getSettings() {
  try {
    await ensureDir();
    const raw = await fsp.readFile(SETTINGS_PATH, 'utf8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

async function saveSettings(patch = {}) {
  const current = await getSettings();
  const next = {
    ...current,
    ...patch,
    ssl_auto_renew: patch.ssl_auto_renew === undefined
      ? current.ssl_auto_renew
      : !!patch.ssl_auto_renew,
    ssl_renew_before_days: Math.min(
      90,
      Math.max(1, parseInt(patch.ssl_renew_before_days ?? current.ssl_renew_before_days, 10) || 30)
    ),
    ssl_check_hour: Math.min(
      23,
      Math.max(0, parseInt(patch.ssl_check_hour ?? current.ssl_check_hour, 10) || 3)
    )
  };
  await ensureDir();
  await fsp.writeFile(SETTINGS_PATH, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

module.exports = {
  getSettings,
  saveSettings,
  DEFAULTS,
  SETTINGS_PATH
};
