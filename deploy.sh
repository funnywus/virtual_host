#!/usr/bin/env bash
# 打包前端（输出到 backend/public）并上传到服务器
# 使用 tar+ssh 上传（远端无需 rsync）
# 支持 deploy.config 中 DEPLOY_PASSWORD 自动登录
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

CONFIG_FILE="${DEPLOY_CONFIG:-$ROOT_DIR/deploy.config}"

usage() {
  cat <<'EOF'
用法: ./deploy.sh [选项]

选项:
  --static-only    只构建并上传 frontend + admin → backend/public
  --skip-build     跳过前端构建（使用已有 backend/public）
  --skip-restart   上传后不重启远端服务
  --dry-run        只显示将要执行的操作，不实际上传
  -h, --help       显示帮助

首次使用:
  cp deploy.config.example deploy.config
  # 在 deploy.config 填写 DEPLOY_HOST / DEPLOY_PASSWORD 等后:
  ./deploy.sh
EOF
}

STATIC_ONLY=0
SKIP_BUILD=0
SKIP_RESTART=0
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --static-only) STATIC_ONLY=1; shift ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    --skip-restart) SKIP_RESTART=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数: $1"; usage; exit 1 ;;
  esac
done

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "❌ 缺少配置文件: $CONFIG_FILE"
  echo "请先执行: cp deploy.config.example deploy.config"
  exit 1
fi

# shellcheck disable=SC1090
source "$CONFIG_FILE"

: "${DEPLOY_HOST:?请在 deploy.config 中设置 DEPLOY_HOST}"
: "${DEPLOY_USER:?请在 deploy.config 中设置 DEPLOY_USER}"
: "${DEPLOY_PATH:?请在 deploy.config 中设置 DEPLOY_PATH}"
DEPLOY_PORT="${DEPLOY_PORT:-22}"
DEPLOY_SYNC_BACKEND="${DEPLOY_SYNC_BACKEND:-1}"
DEPLOY_REMOTE_NPM_INSTALL="${DEPLOY_REMOTE_NPM_INSTALL:-0}"
DEPLOY_RESTART_CMD="${DEPLOY_RESTART_CMD:-}"
DEPLOY_PASSWORD="${DEPLOY_PASSWORD:-}"

if [[ "$STATIC_ONLY" -eq 1 ]]; then
  DEPLOY_SYNC_BACKEND=0
fi

REMOTE="${DEPLOY_USER}@${DEPLOY_HOST}"
# ControlPath 必须足够短（Unix socket 路径有长度限制）
CTRL_DIR="/tmp/vdssh"
CTRL_HASH="$(printf '%s' "${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_PORT}" | shasum -a 256 2>/dev/null | cut -c1-12 || printf '%s' "${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_PORT}" | md5 -q 2>/dev/null | cut -c1-12 || echo "c")"
CTRL_PATH="${CTRL_DIR}/${CTRL_HASH}"
ASKPASS_SCRIPT=""
mkdir -p "$CTRL_DIR"
chmod 700 "$CTRL_DIR"

SSH_OPTS=(
  -p "$DEPLOY_PORT"
  -o StrictHostKeyChecking=accept-new
  -o ControlMaster=auto
  -o ControlPath="$CTRL_PATH"
  -o ControlPersist=60
)

if [[ -n "$DEPLOY_PASSWORD" ]]; then
  ASKPASS_SCRIPT="$(mktemp "${TMPDIR:-/tmp}/vhost-askpass.XXXXXX")"
  chmod 700 "$ASKPASS_SCRIPT"
  cat > "$ASKPASS_SCRIPT" <<'ASKPASS'
#!/usr/bin/env bash
printf '%s\n' "$DEPLOY_PASSWORD"
ASKPASS
  export DEPLOY_PASSWORD
  export SSH_ASKPASS="$ASKPASS_SCRIPT"
  export SSH_ASKPASS_REQUIRE=force
  export DISPLAY="${DISPLAY:-:0}"
  SSH_OPTS+=(
    -o PreferredAuthentications=password
    -o PubkeyAuthentication=no
    -o NumberOfPasswordPrompts=1
  )
  echo "🔐 认证方式: 配置文件密码（自动）"
elif [[ -n "${DEPLOY_SSH_KEY:-}" ]]; then
  SSH_OPTS+=(-i "$DEPLOY_SSH_KEY")
  echo "🔐 认证方式: 密钥"
else
  echo "🔐 认证方式: 交互输入 / 默认密钥"
fi

# 建立主连接时用 /dev/null 强制 ASKPASS；复用连接后可正常管道传文件
run_ssh() {
  if [[ -n "$DEPLOY_PASSWORD" ]]; then
    ssh "${SSH_OPTS[@]}" "$@" </dev/null
  else
    ssh "${SSH_OPTS[@]}" "$@"
  fi
}

# 管道上传用（不能把 stdin 重定向掉）
pipe_ssh() {
  ssh "${SSH_OPTS[@]}" "$@"
}

cleanup() {
  ssh -O exit -o ControlPath="$CTRL_PATH" "$REMOTE" 2>/dev/null || true
  if [[ -n "$ASKPASS_SCRIPT" && -f "$ASKPASS_SCRIPT" ]]; then
    rm -f "$ASKPASS_SCRIPT"
  fi
}
trap cleanup EXIT

# 用 tar+ssh 覆盖同步目录（远端无需 rsync）
# 用法: upload_dir <本地目录> <远端目录> [--replace]
# --replace: 先清空远端目录再解压（等同 rsync --delete）
upload_dir() {
  local local_dir="$1"
  local remote_dir="$2"
  local replace="${3:-}"

  if [[ ! -d "$local_dir" ]]; then
    echo "❌ 本地目录不存在: $local_dir"
    exit 1
  fi

  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "(dry-run) upload $local_dir -> ${REMOTE}:${remote_dir} ${replace}"
    return 0
  fi

  run_ssh "$REMOTE" "mkdir -p '$remote_dir'"
  if [[ "$replace" == "--replace" ]]; then
    # 清空远端目录内容，保留目录本身
    run_ssh "$REMOTE" "find '$remote_dir' -mindepth 1 -maxdepth 1 -exec rm -rf {} +"
  fi

  # 已建立 ControlMaster，后续管道不再需要密码
  # COPYFILE_DISABLE：避免 macOS 扩展属性污染 Linux 解压
  COPYFILE_DISABLE=1 tar -C "$local_dir" -czf - . | pipe_ssh "$REMOTE" "tar -C '$remote_dir' -xzf -"
}

# 上传后端代码（排除运行时目录）
upload_backend() {
  local local_dir="$1"
  local remote_dir="$2"

  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "(dry-run) upload backend $local_dir -> ${REMOTE}:${remote_dir}"
    return 0
  fi

  run_ssh "$REMOTE" "mkdir -p '$remote_dir'"
  COPYFILE_DISABLE=1 tar -C "$local_dir" -czf - \
    --exclude='node_modules' \
    --exclude='temp' \
    --exclude='uploads' \
    --exclude='data' \
    --exclude='backups' \
    --exclude='logs' \
    --exclude='public' \
    --exclude='.env' \
    --exclude='*.db' \
    --exclude='*.sqlite' \
    . | pipe_ssh "$REMOTE" "tar -C '$remote_dir' -xzf -"
}

echo "========================================="
echo "虚拟主机管理系统 — 打包上传"
echo "目标: ${REMOTE}:${DEPLOY_PATH}"
echo "传输: tar + ssh（远端无需 rsync）"
echo "========================================="

# ---------- 1. 构建前端到 backend/public ----------
if [[ "$SKIP_BUILD" -eq 0 ]]; then
  echo ""
  echo "📦 [1/4] 构建上传页 + 管理后台 → backend/public ..."
  if [[ ! -d "$ROOT_DIR/frontend/node_modules" ]]; then
    (cd "$ROOT_DIR/frontend" && npm install)
  fi
  (cd "$ROOT_DIR/frontend" && npm run build)
  if [[ ! -f "$ROOT_DIR/backend/public/index.html" ]]; then
    echo "❌ 构建失败：未找到 backend/public/index.html"
    exit 1
  fi
  if [[ ! -d "$ROOT_DIR/admin/node_modules" ]]; then
    (cd "$ROOT_DIR/admin" && npm install)
  fi
  (cd "$ROOT_DIR/admin" && npm run build)
  if [[ ! -f "$ROOT_DIR/backend/public/admin-jm/index.html" ]]; then
    echo "❌ 构建失败：未找到 backend/public/admin-jm/index.html"
    exit 1
  fi
  echo "✅ 上传页已输出到 backend/public，管理后台已输出到 backend/public/admin-jm"
else
  echo ""
  echo "⏭  [1/4] 跳过构建，使用现有 backend/public"
  if [[ ! -f "$ROOT_DIR/backend/public/index.html" ]]; then
    echo "❌ 缺少 backend/public/index.html，请先构建或去掉 --skip-build"
    exit 1
  fi
  if [[ ! -f "$ROOT_DIR/backend/public/admin-jm/index.html" ]]; then
    echo "❌ 缺少 backend/public/admin-jm/index.html，请先构建或去掉 --skip-build"
    exit 1
  fi
fi

# ---------- 2. 建立 SSH 复用连接 + 远端目录 ----------
echo ""
echo "📁 [2/4] 准备远端目录..."
if [[ "$DRY_RUN" -eq 0 ]]; then
  run_ssh "$REMOTE" "mkdir -p '$DEPLOY_PATH/public'"
else
  echo "(dry-run) ssh ${REMOTE} mkdir -p ${DEPLOY_PATH}/public"
fi

# ---------- 3. 同步文件 ----------
echo ""
echo "🚀 [3/4] 上传文件..."

echo "  → 同步 public/ (前端静态文件，全量覆盖)"
upload_dir "$ROOT_DIR/backend/public" "$DEPLOY_PATH/public" --replace

if [[ "$DEPLOY_SYNC_BACKEND" -eq 1 ]]; then
  echo "  → 同步后端业务代码"
  upload_backend "$ROOT_DIR/backend" "$DEPLOY_PATH"

  if [[ "$DEPLOY_REMOTE_NPM_INSTALL" -eq 1 && "$DRY_RUN" -eq 0 ]]; then
    echo "  → 远端 npm install --production"
    run_ssh "$REMOTE" "cd '$DEPLOY_PATH' && npm install --production"
  fi
else
  echo "  → 仅静态资源模式，不同步后端代码"
fi

# ---------- 4. 重启服务 ----------
echo ""
if [[ "$SKIP_RESTART" -eq 1 || -z "$DEPLOY_RESTART_CMD" ]]; then
  echo "⏭  [4/4] 跳过重启"
else
  echo "🔄 [4/4] 重启远端服务..."
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "(dry-run) $DEPLOY_RESTART_CMD"
  else
    run_ssh "$REMOTE" "$DEPLOY_RESTART_CMD"
  fi
fi

echo ""
echo "========================================="
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "✅ dry-run 完成（未实际上传）"
else
  echo "✅ 部署完成"
  echo "健康检查: curl http://${DEPLOY_HOST}:\${PORT}/api/health"
fi
echo "========================================="
