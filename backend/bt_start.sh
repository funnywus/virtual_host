#!/usr/bin/env bash
# 宝塔面板 → Node 项目 启动脚本
#
# 面板建议配置：
#   项目路径 : 与 deploy.config 的 DEPLOY_PATH 一致
#              （例如 /www/wwwroot/me/virtual_host）
#   启动文件 : bt_start.sh
#   启动方式 : 脚本启动 / 自定义启动命令:
#              bash /www/wwwroot/me/virtual_host/bt_start.sh
#   端口     : 与本目录 .env 中 PORT 一致（常见 6002）
#   包管理器 : npm（首次需在项目目录执行 npm install --production）
#
# 说明：
#   - 本脚本需放在后端根目录（与 server.js、.env、public/ 同级）
#   - 使用 exec 前台运行，便于宝塔/PM2 接管进程
set -euo pipefail

cd "$(dirname "$0")"

# 宝塔 Node 路径兜底（面板未注入 PATH 时）
if ! command -v node >/dev/null 2>&1; then
  # 取版本号最高的已安装 Node
  LATEST_BIN="$(ls -1d /www/server/nodejs/v*/bin 2>/dev/null | sort -V | tail -n 1 || true)"
  if [[ -n "${LATEST_BIN}" && -x "${LATEST_BIN}/node" ]]; then
    export PATH="${LATEST_BIN}:${PATH}"
  fi
fi

if ! command -v node >/dev/null 2>&1; then
  echo "❌ 未找到 node，请先在宝塔安装 Node.js 版本管理器中的 Node"
  exit 1
fi

if [[ ! -f server.js ]]; then
  echo "❌ 当前目录缺少 server.js: $(pwd)"
  echo "   请确认宝塔「项目路径」指向后端部署目录"
  exit 1
fi

if [[ ! -f .env ]]; then
  echo "⚠️  未找到 .env，请先配置 PORT / JWT_SECRET / MYSQL_* 等"
fi

if [[ ! -d node_modules ]]; then
  echo "⚠️  未找到 node_modules，正在 npm install --production ..."
  npm install --production
fi

PORT_HINT="$(grep -E '^PORT=' .env 2>/dev/null | head -n1 | cut -d= -f2- || true)"
PORT_HINT="${PORT_HINT:-6002}"

echo "========================================="
echo "虚拟主机管理系统 — 宝塔启动"
echo "目录: $(pwd)"
echo "Node: $(node -v) ($(command -v node))"
echo "端口: ${PORT_HINT}（以 .env 为准）"
echo "内存: --max-old-space-size=2048"
echo "========================================="

exec node --max-old-space-size=2048 server.js
