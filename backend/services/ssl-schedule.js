/**
 * SSL 定时巡检调度：支持设置变更后热更新，无需重启进程
 */
const { getSettings } = require('./system-settings');

let runner = null;
let timeoutId = null;
let intervalId = null;
let plannedHour = null;
let plannedNext = null;

function clearTimers() {
  if (timeoutId) {
    clearTimeout(timeoutId);
    timeoutId = null;
  }
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

function formatLocal(date) {
  const d = new Date(date);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * @param {() => void | Promise<void>} checkFn 到期检查 / 自动续期入口
 */
function initSslSchedule(checkFn) {
  runner = checkFn;
  return rescheduleSslCheck();
}

async function rescheduleSslCheck() {
  if (!runner) {
    return { success: false, message: '调度未初始化' };
  }

  clearTimers();

  let hour = 3;
  try {
    const settings = await getSettings();
    hour = Number.isInteger(settings.ssl_check_hour) ? settings.ssl_check_hour : 3;
    hour = Math.min(23, Math.max(0, hour));
  } catch (_) {
    hour = 3;
  }

  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);

  const delay = next - now;
  plannedHour = hour;
  plannedNext = next;

  console.log(`[SSL Check] 自动续期计划: 每天 ${String(hour).padStart(2, '0')}:00，下次 ${formatLocal(next)}`);

  timeoutId = setTimeout(() => {
    timeoutId = null;
    Promise.resolve(runner()).catch(err => {
      console.error('[SSL Check] 执行失败:', err.message);
    });
    intervalId = setInterval(() => {
      Promise.resolve(runner()).catch(err => {
        console.error('[SSL Check] 执行失败:', err.message);
      });
    }, 24 * 60 * 60 * 1000);
  }, delay);

  return {
    success: true,
    check_hour: hour,
    next_check_at: formatLocal(next),
    message: `已更新为每天 ${String(hour).padStart(2, '0')}:00 巡检`
  };
}

function getSslScheduleStatus() {
  return {
    check_hour: plannedHour,
    next_check_at: plannedNext ? formatLocal(plannedNext) : null
  };
}

module.exports = {
  initSslSchedule,
  rescheduleSslCheck,
  getSslScheduleStatus
};
