#!/usr/bin/env node
/**
 * 独立脚本：重启宝塔面板「Node 项目」
 *
 * 必须在宝塔服务器本机执行（建议 root）。零 npm 依赖，仅用 Node 内置模块。
 * 不要在项目目录内通过 SSH 前台调用：宝塔停进程时会把当前会话一起杀掉。
 * 建议: cd /tmp && node /path/to/scripts/restart-bt-nodejs.js <项目名>
 *
 * 用法:
 *   node restart-bt-nodejs.js <项目名>
 *   node restart-bt-nodejs.js --list
 *   node restart-bt-nodejs.js --status <项目名>
 *   node restart-bt-nodejs.js --cwd
 *   BT_NODE_PROJECT=vhost-manager node restart-bt-nodejs.js
 *
 * 策略:
 *   1. 优先调用宝塔官方 nodejsModel.RestartProject（面板运行状态会同步）
 *   2. 失败则回退到该项目所用 Node 版本下的 PM2
 *
 * 宝塔面板「Node 项目」名称以面板里显示的为准，不一定等于 PM2 名或目录名。
 */

'use strict';

const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PANEL_DIR = '/www/server/panel';
const NODEJS_ROOT = '/www/server/nodejs';
const SITE_DB_CANDIDATES = [
  path.join(PANEL_DIR, 'data/default.db'),
  path.join(PANEL_DIR, 'data/db/site.db')
];

function usage(code) {
  const self = path.basename(process.argv[1] || 'restart-bt-nodejs.js');
  console.log(`用法:
  node ${self} <项目名>          重启指定 Node 项目
  node ${self} --list            列出宝塔 Node 项目
  node ${self} --status <项目名> 查看项目运行状态
  node ${self} --cwd             按当前目录匹配并重启
  node ${self} -h, --help        显示帮助

环境变量:
  BT_NODE_PROJECT   未传项目名时使用
  BT_PANEL          宝塔面板目录，默认 ${PANEL_DIR}
`);
  process.exit(code);
}

function log(msg) {
  console.log(`[bt-nodejs] ${msg}`);
}

function fail(msg, extra) {
  console.error(`[bt-nodejs] ❌ ${msg}`);
  if (extra) console.error(extra);
  process.exit(1);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.includes('-h') || args.includes('--help')) usage(0);

  const list = args.includes('--list') || args.includes('-l');
  const status = args.includes('--status');
  const byCwd = args.includes('--cwd');
  const positional = args.filter((a) => !a.startsWith('-'));

  return {
    list,
    status,
    byCwd,
    projectName: positional[0] || process.env.BT_NODE_PROJECT || ''
  };
}

function which(bin) {
  try {
    return execFileSync('which', [bin], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    return '';
  }
}

function findBtPython() {
  const candidates = [
    which('btpython'),
    '/usr/bin/btpython',
    path.join(PANEL_DIR, 'pyenv/bin/python3'),
    path.join(PANEL_DIR, 'pyenv/bin/python')
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return '';
}

function runBtPython(code, timeoutMs) {
  const bin = findBtPython();
  if (!bin) {
    throw new Error('未找到 btpython / 面板 pyenv，确认已安装宝塔面板');
  }
  return execFileSync(bin, ['-c', code], {
    encoding: 'utf8',
    timeout: timeoutMs || 90000,
    maxBuffer: 4 * 1024 * 1024,
    env: {
      ...process.env,
      HOME: process.env.HOME || os.homedir() || '/root'
    }
  });
}

function parseJsonOutput(raw) {
  const text = String(raw || '').trim();
  if (!text) throw new Error('宝塔接口无输出');
  const start = text.indexOf('{') >= 0 && (text.indexOf('[') < 0 || text.indexOf('{') < text.indexOf('['))
    ? text.indexOf('{')
    : text.indexOf('[');
  if (start < 0) throw new Error(`宝塔接口输出不是 JSON: ${text.slice(0, 300)}`);
  return JSON.parse(text.slice(start));
}

function pyGetHelper() {
  return `
import sys, json
sys.path.insert(0, "${PANEL_DIR}/class")
import public
from projectModel.nodejsModel import main
m = main()
try:
    get = public.dict_obj()
except Exception:
    class _G: pass
    get = _G()
`;
}

function listProjectsViaPython() {
  const code = `
${pyGetHelper()}
get.p = 1
get.limit = 1000
get.search = ""
fn = getattr(m, "get_project_list", None) or getattr(m, "GetProjectList", None)
if fn is None:
    raise RuntimeError("nodejsModel 无 get_project_list")
print(json.dumps(fn(get), default=str, ensure_ascii=False))
`;
  return parseJsonOutput(runBtPython(code));
}

function listProjectsViaSqlite() {
  const db = SITE_DB_CANDIDATES.find((p) => fs.existsSync(p));
  if (!db) return [];
  const sqlite = which('sqlite3');
  if (!sqlite) return [];
  const sql = "SELECT name, path, project_config FROM sites WHERE project_type='Node'";
  let raw = '';
  try {
    raw = execFileSync(sqlite, ['-separator', '\t', db, sql], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    return [];
  }
  if (!raw) return [];
  return raw.split('\n').map((line) => {
    const [name, projectPath, config] = line.split('\t');
    let port = '';
    let nodejsVersion = '';
    try {
      const cfg = JSON.parse(config || '{}');
      port = cfg.port || (cfg.project_config && cfg.project_config.port) || '';
      nodejsVersion = cfg.nodejs_version || '';
    } catch {
      /* ignore */
    }
    return {
      name,
      path: projectPath,
      port,
      nodejs_version: nodejsVersion
    };
  }).filter((p) => p.name);
}

function normalizeProjectList(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.data)) return payload.data;
  if (payload && Array.isArray(payload.list)) return payload.list;
  return [];
}

function loadProjects() {
  try {
    const payload = listProjectsViaPython();
    const list = normalizeProjectList(payload);
    if (list.length) return list;
  } catch (err) {
    log(`官方列表接口不可用，改用 SQLite: ${err.message}`);
  }
  return listProjectsViaSqlite();
}

function projectLabel(p) {
  const name = p.name || p.project_name || '';
  const cwd = p.path || p.project_cwd || (p.project_config && p.project_config.projectcwd) || '';
  const run = p.run === true || p.run === 1 || p.run === '1' ? '运行中' : (p.run === false || p.run === 0 ? '已停止' : '-');
  const port = p.port || (p.project_config && p.project_config.port) || '';
  return { name, cwd, run, port };
}

function resolveProjectPath(raw) {
  try {
    return fs.realpathSync(raw);
  } catch {
    return raw;
  }
}

function matchByCwd(projects) {
  const cwd = fs.realpathSync(process.cwd());
  const scored = [];
  for (const p of projects) {
    const info = projectLabel(p);
    if (!info.cwd) continue;
    const projectPath = resolveProjectPath(info.cwd);
    if (cwd === projectPath || cwd.startsWith(projectPath + path.sep)) {
      scored.push({ p, len: projectPath.length });
    }
  }
  if (!scored.length) return [];
  const maxLen = Math.max(...scored.map((s) => s.len));
  return scored.filter((s) => s.len === maxLen).map((s) => s.p);
}

function restartViaPython(projectName) {
  const code = `
${pyGetHelper()}
get.project_name = ${JSON.stringify(projectName)}
fn = getattr(m, "RestartProject", None) or getattr(m, "restart_project", None)
if fn is None:
    raise RuntimeError("nodejsModel 无 RestartProject")
print(json.dumps(fn(get), default=str, ensure_ascii=False))
`;
  return parseJsonOutput(runBtPython(code, 120000));
}

function statusViaPython(projectName) {
  const code = `
${pyGetHelper()}
get.project_name = ${JSON.stringify(projectName)}
fn = getattr(m, "get_project_stat", None) or getattr(m, "GetProjectStat", None)
if fn is None:
    raise RuntimeError("nodejsModel 无 get_project_stat")
print(json.dumps(fn(get), default=str, ensure_ascii=False))
`;
  return parseJsonOutput(runBtPython(code));
}

function findPm2Bins() {
  const bins = [];
  const fromWhich = which('pm2');
  if (fromWhich) bins.push(fromWhich);
  if (!fs.existsSync(NODEJS_ROOT)) return [...new Set(bins)];
  let versions = [];
  try {
    versions = fs.readdirSync(NODEJS_ROOT).filter((n) => n.startsWith('v'));
  } catch {
    return [...new Set(bins)];
  }
  versions.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  for (const ver of versions.reverse()) {
    const candidates = [
      path.join(NODEJS_ROOT, ver, 'bin/pm2'),
      path.join(NODEJS_ROOT, ver, 'lib/node_modules/pm2/bin/pm2')
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) bins.push(c);
    }
  }
  return [...new Set(bins)];
}

function restartViaPm2(projectName) {
  const bins = findPm2Bins();
  if (!bins.length) {
    throw new Error('未找到 PM2（宝塔 Node 版本管理器里通常自带）');
  }
  let lastErr = null;
  for (const bin of bins) {
    try {
      const out = execFileSync(bin, ['restart', projectName], {
        encoding: 'utf8',
        timeout: 60000,
        env: {
          ...process.env,
          HOME: process.env.HOME || '/root',
          PM2_HOME: process.env.PM2_HOME || path.join(process.env.HOME || '/root', '.pm2')
        }
      });
      return { bin, out };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('PM2 重启失败');
}

function assertSafeName(name) {
  if (!name || !/^[\w.\-]+$/.test(name)) {
    fail(`非法项目名: ${name || '(空)'}，只允许字母/数字/下划线/点/短横线`);
  }
}

function printList(projects) {
  if (!projects.length) {
    log('未找到宝塔 Node 项目');
    return;
  }
  console.log('项目名\t状态\t端口\t路径');
  for (const p of projects) {
    const info = projectLabel(p);
    console.log(`${info.name}\t${info.run}\t${info.port || '-'}\t${info.cwd || '-'}`);
  }
}

function isSuccess(result) {
  if (!result || typeof result !== 'object') return false;
  if (result.status === true || result.status === 1 || result.status === 'true') return true;
  if (result.code === 0) return true;
  return false;
}

function main() {
  if (!fs.existsSync(PANEL_DIR)) {
    fail(`未检测到宝塔面板目录: ${PANEL_DIR}，请在宝塔服务器上执行`);
  }

  const opts = parseArgs(process.argv);

  if (opts.list) {
    printList(loadProjects());
    return;
  }

  let projectName = opts.projectName;

  if (opts.byCwd || !projectName) {
    const projects = loadProjects();
    if (opts.byCwd || !projectName) {
      const hits = matchByCwd(projects);
      if (hits.length === 1) {
        projectName = projectLabel(hits[0]).name;
        log(`按当前目录匹配到项目: ${projectName}`);
      } else if (hits.length > 1) {
        printList(hits);
        fail('当前目录匹配到多个项目，请显式传入项目名');
      } else if (opts.byCwd) {
        fail(`当前目录未匹配到宝塔 Node 项目: ${process.cwd()}`);
      }
    }
  }

  if (!projectName) usage(1);
  assertSafeName(projectName);

  if (opts.status) {
    try {
      const stat = statusViaPython(projectName);
      console.log(JSON.stringify(stat, null, 2));
    } catch (err) {
      fail(`查询状态失败: ${err.message}`);
    }
    return;
  }

  log(`重启项目: ${projectName}`);
  try {
    const result = restartViaPython(projectName);
    if (!isSuccess(result)) {
      const msg = (result && (result.msg || result.message)) || JSON.stringify(result);
      throw new Error(msg);
    }
    log(`官方接口重启成功: ${(result && result.msg) || 'ok'}`);
    return;
  } catch (err) {
    log(`官方接口失败，回退 PM2: ${err.message}`);
  }

  try {
    const { bin, out } = restartViaPm2(projectName);
    log(`PM2 重启成功 (${bin})`);
    if (out && out.trim()) console.log(out.trim());
  } catch (err) {
    const detail = err.stdout || err.stderr || err.message;
    fail(`重启失败: ${err.message}`, typeof detail === 'string' ? detail : '');
  }
}

main();
