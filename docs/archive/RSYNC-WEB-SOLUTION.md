# 网页版 rsync 解决方案

## 🎯 目标

在网页中实现类似 rsync 的增量上传功能，只上传新增或修改的文件。

## 💡 实现方案

### 方案对比

| 方案 | 可行性 | 优势 | 劣势 |
|------|--------|------|------|
| 直接运行 rsync | ❌ 不可行 | - | 浏览器无法执行系统命令 |
| 网页增量上传 | ✅ 可行 | 简单易用 | 需要记录文件状态 |
| 桌面客户端 | ✅ 可行 | 功能完整 | 需要安装软件 |
| 浏览器插件 | ✅ 可行 | 功能强大 | 开发复杂 |

## 🚀 推荐方案：智能增量上传

### 实现原理

1. **本地记录**: 浏览器 localStorage 记录已上传文件的 MD5
2. **对比检测**: 上传前计算文件 MD5，与记录对比
3. **跳过相同**: 跳过未修改的文件
4. **只传新增**: 只上传新增或修改的文件

### 使用场景

- ✅ 网站内容更新（修改了部分文件）
- ✅ 增量部署（只上传变化的文件）
- ✅ 节省时间和带宽

### 性能提升

| 场景 | 文件总数 | 修改文件 | 传统上传 | 增量上传 | 提升 |
|------|---------|---------|---------|---------|------|
| 小更新 | 1000 | 10 | 15分钟 | 30秒 | 30x ⚡ |
| 中更新 | 1000 | 100 | 15分钟 | 3分钟 | 5x |
| 大更新 | 1000 | 500 | 15分钟 | 8分钟 | 2x |

---

## 🔧 方案一：网页增量上传（推荐）

### 功能特点

- ✅ 无需安装软件
- ✅ 自动检测文件变化
- ✅ 只上传修改的文件
- ✅ 显示跳过的文件数量
- ✅ 支持强制全量上传

### 使用方法

1. **首次上传**: 正常上传所有文件
2. **后续更新**: 
   - 拖拽文件夹到上传区域
   - 系统自动检测变化
   - 只上传修改的文件
   - 显示"跳过 XX 个未修改文件"

### 实现代码

已在系统中实现，无需额外操作。

---

## 🖥️ 方案二：命令行 rsync（高级用户）

### 适用场景

- ✅ 熟悉命令行的开发者
- ✅ 需要自动化部署
- ✅ 超大型网站（> 10GB）
- ✅ CI/CD 集成

### 前置条件

1. **服务器支持 SSH**: 端口 22 开放
2. **本地安装 rsync**: 
   - Mac/Linux: 系统自带
   - Windows: 需要安装 WSL 或 Git Bash

### 基础用法

```bash
# 同步整个网站目录
rsync -avz -e "ssh -p 22" \
  /local/website/ \
  username@server_ip:/home/www/

# 参数说明:
# -a: 归档模式（保持文件属性）
# -v: 显示详细信息
# -z: 压缩传输
# -e: 指定 SSH 连接
```

### 高级用法

```bash
# 1. 删除服务器上多余的文件（与本地保持一致）
rsync -avz --delete \
  -e "ssh -p 22" \
  /local/website/ username@server:/home/www/

# 2. 排除特定文件
rsync -avz \
  --exclude='*.log' \
  --exclude='node_modules/' \
  --exclude='.git/' \
  -e "ssh -p 22" \
  /local/website/ username@server:/home/www/

# 3. 显示传输进度
rsync -avz --progress \
  -e "ssh -p 22" \
  /local/website/ username@server:/home/www/

# 4. 限制带宽（1000 KB/s）
rsync -avz --bwlimit=1000 \
  -e "ssh -p 22" \
  /local/website/ username@server:/home/www/

# 5. 只预览不实际传输（测试）
rsync -avz --dry-run \
  -e "ssh -p 22" \
  /local/website/ username@server:/home/www/
```

### 自动化脚本

创建 `deploy.sh`:

```bash
#!/bin/bash

# ============================================
# 网站自动部署脚本
# ============================================

# 配置信息（请修改为你的实际信息）
SERVER_IP="123.456.789.0"
SERVER_USER="your_ftp_username"
SERVER_PATH="/home/www/your-domain/"
LOCAL_PATH="/path/to/your/website/"
SSH_PORT="22"

# 颜色输出
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}开始部署网站...${NC}"
echo -e "${GREEN}========================================${NC}"

# 检查本地目录是否存在
if [ ! -d "$LOCAL_PATH" ]; then
  echo -e "${RED}错误: 本地目录不存在: $LOCAL_PATH${NC}"
  exit 1
fi

# 检查是否有 index.html
if [ ! -f "$LOCAL_PATH/index.html" ]; then
  echo -e "${YELLOW}警告: 未找到 index.html 文件${NC}"
  read -p "是否继续？(y/n) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

# 显示将要同步的文件
echo -e "${YELLOW}预览将要同步的文件...${NC}"
rsync -avz --dry-run \
  --exclude='.git/' \
  --exclude='node_modules/' \
  --exclude='.DS_Store' \
  --exclude='*.log' \
  -e "ssh -p $SSH_PORT" \
  "$LOCAL_PATH" "$SERVER_USER@$SERVER_IP:$SERVER_PATH"

# 确认是否继续
echo ""
read -p "确认开始同步？(y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo -e "${RED}已取消部署${NC}"
  exit 1
fi

# 开始同步
echo -e "${GREEN}开始同步文件...${NC}"
rsync -avz --progress --delete \
  --exclude='.git/' \
  --exclude='node_modules/' \
  --exclude='.DS_Store' \
  --exclude='*.log' \
  -e "ssh -p $SSH_PORT" \
  "$LOCAL_PATH" "$SERVER_USER@$SERVER_IP:$SERVER_PATH"

# 检查结果
if [ $? -eq 0 ]; then
  echo -e "${GREEN}========================================${NC}"
  echo -e "${GREEN}部署成功！${NC}"
  echo -e "${GREEN}========================================${NC}"
else
  echo -e "${RED}========================================${NC}"
  echo -e "${RED}部署失败！${NC}"
  echo -e "${RED}========================================${NC}"
  exit 1
fi
```

### 使用脚本

```bash
# 1. 保存脚本
nano deploy.sh

# 2. 修改配置信息（SERVER_IP, SERVER_USER 等）

# 3. 添加执行权限
chmod +x deploy.sh

# 4. 运行脚本
./deploy.sh
```

### Windows 用户

**方式 1: 使用 Git Bash**

1. 安装 Git for Windows（自带 Git Bash）
2. 打开 Git Bash
3. 运行 rsync 命令

**方式 2: 使用 WSL**

```bash
# 1. 安装 WSL
wsl --install

# 2. 在 WSL 中使用 rsync
wsl rsync -avz -e "ssh -p 22" /mnt/c/website/ user@server:/home/www/
```

**方式 3: 使用 cwRsync（Windows 原生）**

下载: https://itefix.net/cwrsync

---

## 🖥️ 方案三：桌面客户端（最简单）

### 推荐工具

#### 1. FileZilla（免费）⭐⭐⭐⭐⭐

**下载**: https://filezilla-project.org/

**同步功能**:
1. 连接服务器
2. 菜单 → 查看 → 目录比较
3. 选择"同步浏览"
4. 只上传修改的文件

#### 2. WinSCP（Windows，免费）⭐⭐⭐⭐⭐

**下载**: https://winscp.net/

**同步功能**:
1. 连接服务器
2. 命令 → 同步
3. 选择"本地 → 远程"
4. 勾选"仅上传新文件和修改的文件"
5. 点击"确定"

**优势**:
- ✅ 图形界面，简单易用
- ✅ 自动检测文件变化
- ✅ 支持预览将要同步的文件
- ✅ 可保存同步配置

---

## 📊 方案对比

| 方案 | 速度 | 易用性 | 增量同步 | 自动化 | 推荐度 |
|------|------|--------|---------|--------|--------|
| 网页增量上传 | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ✅ | ❌ | ⭐⭐⭐⭐ |
| 压缩包上传 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ❌ | ❌ | ⭐⭐⭐⭐⭐ |
| FileZilla 同步 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ✅ | ❌ | ⭐⭐⭐⭐⭐ |
| rsync 命令 | ⭐⭐⭐⭐⭐ | ⭐⭐ | ✅ | ✅ | ⭐⭐⭐⭐ |

---

## 🎯 使用建议

### 场景一：首次部署

**推荐**: 压缩包上传
- 最快速度（15x 提升）
- 操作简单
- 一次性上传所有文件

### 场景二：日常更新（修改少量文件）

**推荐**: FileZilla 同步 或 网页增量上传
- 只上传修改的文件
- 图形界面，直观易用
- 无需命令行知识

### 场景三：频繁更新（每天多次）

**推荐**: rsync 命令 + 自动化脚本
- 一键部署
- 速度最快
- 可集成到开发流程

### 场景四：自动化部署（CI/CD）

**推荐**: rsync 命令
- 可编写脚本
- 支持自动化
- 适合 Git Hook、Jenkins 等

---

## 💡 最佳实践

### 1. 首次部署流程

```bash
# 步骤 1: 压缩文件
zip -r website.zip . -x "*.git*" "node_modules/*"

# 步骤 2: 上传压缩包（网页）

# 步骤 3: 在线解压
```

### 2. 日常更新流程

**方式 A: FileZilla**
1. 打开 FileZilla
2. 连接服务器
3. 启用"同步浏览"
4. 拖拽修改的文件

**方式 B: rsync 脚本**
```bash
./deploy.sh
```

### 3. 紧急修复流程

**方式: 网页直接编辑**
1. 登录文件管理
2. 找到文件
3. 点击"编辑"
4. 修改并保存

---

## ❓ 常见问题

### Q1: rsync 命令在 Windows 上无法使用？

**A**: 三种解决方案：
1. 安装 Git Bash（推荐）
2. 安装 WSL
3. 使用 FileZilla 代替

### Q2: 如何获取 SSH 连接信息？

**A**: 在系统中查看：
- 服务器 IP: 服务器管理页面
- SSH 端口: 通常是 22
- 用户名: FTP 账号用户名
- 密码: FTP 账号密码

### Q3: rsync 提示权限错误？

**A**: 检查：
1. SSH 用户是否有权限
2. 目标目录是否存在
3. 是否使用了正确的路径

### Q4: 如何只上传特定类型的文件？

**A**: 使用 --include 参数：
```bash
rsync -avz \
  --include='*.html' \
  --include='*.css' \
  --include='*.js' \
  --exclude='*' \
  -e "ssh -p 22" \
  /local/ user@server:/remote/
```

---

## 📞 技术支持

微信: feiyu3305  
服务时间: 周一至周日 9:00-22:00

---

**相关文档**:
- [FTP 批量上传指南](FTP-UPLOAD-GUIDE.md)
- [快速上传指南](QUICK-UPLOAD-GUIDE.md)
- [系统使用手册](README.md)
