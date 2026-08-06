# 文件上传与 FTP

系统提供多种文件传输方案，覆盖网页上传、分片大文件、FTP 账号管理与公开授权码上传页。

## 功能概览

| 能力 | 说明 |
|------|------|
| FTP 账号管理 | 为子域名创建 SFTP 账号，重置密码/授权码 |
| 网页文件管理 | 列表、上传、删除、重命名、压缩、解压 |
| 分片上传 | 大于 5MB 自动分片，支持断点续传 |
| 文件夹拖拽 | 保持目录结构批量上传 |
| 公开上传页 | `/` 授权码验证后上传（Upload.vue） |
| PHP 直传 | 部署 upload.php 到目标服务器，浏览器直传 |
| WebSocket SFTP | 可选 WS 代理加速传输 |

## FTP 账号管理

在 **FTP 管理** 页面：

1. 选择可用子域名
2. 创建 FTP 账号（自动生成用户名/密码）
3. 获取 SFTP 连接信息（主机、端口 22、路径）

### 常用 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/ftp` | FTP 列表 |
| POST | `/api/ftp` | 创建账号 |
| GET | `/api/ftp/:id/usage` | 空间使用量 |
| POST | `/api/ftp/:id/reset-password` | 重置密码 |
| POST | `/api/ftp/:id/reset-auth-code` | 重置授权码 |
| DELETE | `/api/ftp/:id` | 删除账号 |

### 客户端连接（FileZilla）

```
协议: SFTP
主机: 服务器 IP
端口: 22
用户名: FTP 账号用户名
密码: FTP 账号密码
```

## 网页文件管理

通过 `FileManager.vue` 组件操作，后端经 SSH/SFTP 执行。

### 文件操作 API（需授权码或管理端 Token）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/upload/auth` | 授权码验证 |
| POST | `/api/upload/list` | 文件列表 |
| POST | `/api/upload/upload-file` | 单文件上传 |
| POST | `/api/upload/mkdir` | 创建目录 |
| POST | `/api/upload/delete` | 删除（`path` 或 `paths[]`） |
| POST | `/api/upload/rename` | 重命名 |
| POST | `/api/upload/extract` | 解压 zip |
| POST | `/api/upload/compress` | 压缩为 zip |
| POST | `/api/upload/copy` / `/cut` | 复制/剪切（单条 `source_path`+`target_path`，或 `items[]`） |
| POST | `/api/upload/lift-contents/check` | 提取到上级：冲突预检（`path` 或 `paths[]`） |
| POST | `/api/upload/lift-contents` | 提取到上级（`path`/`paths[]` + `on_conflict`） |
| POST | `/api/upload/empty-folder` | 清空文件夹（`path` 或 `paths[]`） |
| POST | `/api/upload/read` / `/write` | 读写文本文件 |

批量操作约定：多选删除 / 提取 / 清空 / 粘贴 / 移动应一次请求完成，服务端复用同一条 SSH，避免前端按文件循环调用。

## 分片上传

大文件走 `/api/upload-chunked` 路由，前端工具见 `frontend/src/utils/chunked-upload.js`。

### 流程

```
init → 上传 chunk（并发 3 片，每片 2MB）→ merge → SFTP 写入目标目录
```

### 参数（默认）

- 分片阈值：**5MB**
- 分片大小：**2MB**
- 最大并发：**3**

临时分片存储在 `backend/temp/chunks/`，可定期运行清理脚本：

```bash
cd backend && node scripts/cleanup-temp.js
```

## 公开上传页

路由 `/` 对应 `Upload.vue`，面向终端用户：

1. 输入 FTP 授权码
2. 验证通过后进入文件管理界面
3. 支持拖拽上传、在线解压等

授权码与 FTP 账号绑定，可在 FTP 管理页重置。

## PHP 直传方案

为跳过「浏览器 → 后端 → 服务器」的中转损耗，系统支持部署 PHP 上传脚本到目标站点：

```
POST /api/dns/subdomains/:id/deploy-upload-script
```

部署后浏览器可直接向目标服务器 POST 文件，速度显著提升。详见根目录 `DIRECT-UPLOAD-GUIDE.md`。

## 推荐上传策略

| 场景 | 推荐方案 | 预期效果 |
|------|----------|----------|
| 首次部署整站 | 压缩包上传 + 在线解压 | 速度提升约 15 倍 |
| 少量文件 | 网页拖拽 | 操作简单 |
| 大文件 / 频繁更新 | FileZilla SFTP | 断点续传、多线程 |
| 自动化部署 | rsync / CI 脚本 | 增量同步最快 |

### 压缩包上传步骤

```bash
# 本地打包
zip -r website.zip . -x "*.git*" "node_modules/*"

# 网页上传 website.zip → 操作 → 解压到当前目录
```

## 注意事项

1. 网站首页须命名为 `index.html`（小写）
2. 上传后默认权限：文件 644，目录 755
3. 注意 FTP 空间配额，上传前查看剩余空间
4. 文件名避免特殊字符与空格
5. 后端请求超时 30 分钟，极大文件仍建议使用 SFTP 客户端

## 故障排查

```bash
# 检查后端
lsof -i :6002

# 清理临时分片
node backend/scripts/cleanup-temp.js

# 检查上传状态
node backend/scripts/check-upload-status.js
```

更多见根目录 `UPLOAD-TROUBLESHOOTING.md`、`TROUBLESHOOTING.md`。
