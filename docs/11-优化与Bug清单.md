# 优化点与 Bug 清单

> 审计范围：仓库当前 `main` 全量代码（Node/Express + Vue 3 虚拟主机管理系统）  
> 审计日期：2026-08-06  
> 严重级别：`P0` 安全/可被利用 · `P1` 功能缺陷或高概率故障 · `P2` 体验/性能/可维护性 · `P3` 债项/文档漂移

---

## 一、执行摘要

项目在上传多通道、SSH 连接池、SSL/DNS 自动化方面已较完整，但存在几类**系统性风险**：

1. **密钥与凭据暴露面过大**（明文存库、上传鉴权回传 SSH 密码、WS 无鉴权代理）
2. **鉴权与租户隔离不完整**（开放注册、部分写操作缺 ownership 校验）
3. **超大单体文件**导致难测、难演进（`Upload.vue` / `upload.js` / `ssl.js` / `dns.js` / `Subdomains.vue`）
4. **迁移与环境变量双轨**（SQLite ALTER + `server.js` migrate + MySQL SQL；`DB_*` vs `MYSQL_*`）

建议优先处理全部 `P0`，再按上传链路与后台权限做 `P1`。

---

## 二、Bug / 缺陷清单

### P0 — 安全（应优先修复）

| ID | 问题 | 位置 | 说明 | 建议修复 |
|----|------|------|------|----------|
| B-01 | WebSocket SFTP 代理无鉴权 | `backend/services/ws-sftp-proxy.js` | ~~已修~~：仅接受 `auth_code`，服务端查库建 SSH；拒绝 host/password；写入路径限制在 home | 已落地 |
| B-02 | `/api/upload/auth` 回传 SSH 明文密码 | `backend/routes/upload.js` | ~~已修~~：`/auth` 不再返回 `ftp_password` / SSH 字段 | 已落地 |
| B-03 | SSH/FTP/DNS 密钥明文入库 | `servers.password`、`ftp_accounts.password`、`aliyun_config.secret_key` | DB 泄露即全盘沦陷 | 应用层加密（KMS/主密钥）或至少 AES-GCM + 密钥环境变量 |
| B-04 | 开放注册无开关 | `backend/routes/auth.js` `POST /register` | ~~已修~~：默认关闭；`ALLOW_REGISTER=true` 才开放；平时用 admin `/api/users` | 已落地 |
| B-05 | `UPLOAD_SIGN_SECRET` 默认硬编码 | `backend/routes/upload.js` | ~~已修~~：启动 `assertRequiredSecrets` fail-fast；禁止弱默认值 | 已落地 |
| B-06 | 历史授权码=域名 MD5 | `backend/services/ftp-auth.js` | ~~已修~~：登录返回 `auth_code_weak`；管理端标「弱码」；`FORCE_LEGACY_AUTH_RESET` 可强制拒绝 | 已落地（存量需管理员点重置） |
| B-07 | CORS 全开 + 超大 body | `backend/server.js` `cors()` + 500MB JSON | 配合开放接口放大滥用面 | 限制 Origin；上传走 multipart/chunk，缩小 JSON limit |

### P1 — 功能 / 正确性

| ID | 问题 | 位置 | 说明 | 建议修复 |
|----|------|------|------|----------|
| B-08 | 路径保护可被 `..` 绕过 | `upload-system-files.js` `normalizeRelPath` + `upload.js` `isProtectedPath` | ~~已修~~：`posix.normalize` + 逃逸返回 null；非法路径按受保护拒绝 | 已落地 |
| B-09 | `home_dir` 前缀校验不严谨 | `upload.js` 多处 `startsWith(ftp.home_dir)` | ~~已修~~：统一 `isPathInsideHome` / `denyOutsideHome`；`remoteAbs` 二次约束 | 已落地 |
| B-10 | 授权码查找全表扫描 | `upload.js` `findFtpByAuthCode` | ~~已修~~：等值查询 + `idx_ftp_auth_code`；空值回填后可走索引 | 已落地 |
| B-11 | 首次激活存在竞态 | `upload.js` `/auth` | ~~已修~~：`WHERE activated_at IS NULL` 条件更新，冲突则回读 | 已落地 |
| B-12 | 删除服务器对 admin 无效/静默 | `servers.js` `DELETE /:id` | ~~已修~~：`getAccessibleServer`；admin 可删，非所有者 404 | 已落地 |
| B-13 | 设默认服务器缺所有权校验 | `servers.js` `POST /:id/set-default` | ~~已修~~：先校验可访问，再按所有者清默认并设置 | 已落地 |
| B-14 | 服务器停用/恢复可能缺租户校验 | `servers.js` status 更新 | ~~已修~~：status/update/SSH 操作均走 `getAccessibleServer` | 已落地 |
| B-15 | 分片上传会话无二次鉴权 | `upload-chunked.js` | `uploadId` 知悉即可续传；`info.json` 含 SSH 密码 | uploadId 绑定 auth 会话；磁盘上的密码加密或改用连接池凭据查询 |
| B-16 | MySQL 环境变量与文档不一致 | `database-mysql.js` vs README/docs | 代码只读 `MYSQL_*`，文档常写 `DB_*` | 统一一套，并兼容读取；补 `.env.example` |
| B-17 | Vite 构建产物路径与部署文档不一致 | `frontend/vite.config.js` `outDir: ./dist` | 文档要求拷到 `backend/public`，易部署错版 | build 直接 `outDir: ../backend/public` 或加 copy 脚本 |
| B-18 | `JWT_SECRET` 未启动校验 | `auth.js` / `middleware/auth.js` | ~~已修~~：与 B-05 一并在启动期校验 | 已落地 |

### P2 — 体验 / 稳定性（已知历史痛点，根目录大量 FIX 文档佐证）

| ID | 问题 | 相关线索 |
|----|------|----------|
| B-19 | 分片合并卡住 / 磁盘占满 | `URGENT-FIX-MERGE-STUCK.md`、`CHUNKED-UPLOAD-FIX.md`；`temp/chunks` 需定期清理 |
| B-20 | WS 直传多文件/连接问题 | `WEBSOCKET-MULTI-FILE-FIX.md`、`WEBSOCKET-REMOVED.md` 后又重新启用 |
| B-21 | MySQL `concat` / undefined | `MYSQL-UNDEFINED-FIX.md`；`db.concat()` 已部分抽象，需全路由回归 |
| B-22 | 批量 SSL 任务持久化/过期 | 多份 `BATCH-SSL-*.md`；`batch_ssl_jobs` 与进程内状态需单一真相源 |
| B-23 | 前端超大单页难维护 | `Upload.vue` ~4600+ 行、`Subdomains.vue` ~2700 行 |

---

## 三、优化点清单

### 3.1 安全与权限（高优先）

| ID | 优化项 | 收益 | 工作量 |
|----|--------|------|--------|
| O-01 | 上传链路短期 token 替代「回传 SSH 密码」 | ~~部分完成~~：`/auth` 已不回传密码；WS 凭授权码服务端建连 | — |
| O-02 | WS `/ws-upload` 鉴权 + host 白名单 | ~~已完成~~：禁凭据直连，仅 auth_code + home 路径约束 | — |
| O-03 | 关闭开放注册 / 后台邀请制 | ~~已完成~~：默认关，`ALLOW_REGISTER` 开关 | — |
| O-04 | 登录/上传/API 限流（IP + auth_code） | 防爆破授权码与撞库 | S |
| O-05 | 敏感字段加密存储 + 审计日志 | 合规与失陷损失可控 | L |
| O-06 | 管理端 API 统一 ownership 中间件 | 杜绝 IDOR 类缺陷 | M |

### 3.2 性能

| ID | 优化项 | 现状 | 建议 |
|----|--------|------|------|
| O-10 | 授权码索引查询 | 全表加载后 JS 匹配 | DB 唯一索引 + 等值查询 |
| O-11 | SSH 连接池扩到更多路由 | list/usage 已用池，部分仍新建连接 | 统一走 `ssh-connection-pool` |
| O-12 | 文件列表分页与字段裁剪 | 大目录仍可能一次拉全量 | 服务端分页 + 可选不返回 content meta |
| O-13 | 分片临时目录生命周期 | 依赖脚本/重启清理 | TTL 任务 + 磁盘水位熔断 |
| O-14 | Worker 池用于压缩/解压/大复制 | 已有 `file-operation-worker` | 覆盖更多 CPU 密集路径，限制并发 |
| O-15 | 前端 Upload 虚拟列表 | 大目录 DOM 过重 | 表格虚拟滚动 |
| O-16 | 文件操作批量接口 | 删除/提取/复制/剪切/清空按文件循环请求 | 已对齐：`paths[]` / `items[]` 一次请求 + 单 SSH |

### 3.3 架构与可维护性

| ID | 优化项 | 说明 |
|----|--------|------|
| O-20 | 拆分巨型 route/view | `upload` / `ssl` / `dns` / `Upload.vue` / `Subdomains.vue` 按用例拆模块与 composable |
| O-21 | 业务逻辑下沉 service | route 只做校验与编排，SSH/DNS/SSL 进 service，便于单测 |
| O-22 | 统一 DB 迁移机制 | 废弃「多处 ALTER + 手工 SQL」；单一 migrations 目录（版本号） |
| O-23 | 清理根目录历史 FIX/GUIDE md | 合并进 `docs/` + CHANGELOG，降低噪音 |
| O-24 | 补齐 `.env.example`、健康检查、基础集成测试 | 降低部署踩坑；覆盖 auth / upload / ownership |
| O-25 | 删除死代码 | 如疑似未用的 `database-new.js`、空 `start.sh` / 空指南文件 |

### 3.4 产品能力（路线图已有，可择优）

参见 `docs/FILE-SPACE-ROADMAP.md`，建议与安全修复错峰：

- 分享链接（带过期/密码）— 注意勿再复用「回传主机密码」模式  
- 打包下载 ZIP 流式返回  
- 回收站 / 操作历史  
- Quick Look 预览（纯前端优先）

---

## 四、建议落地顺序（4 周示意）

| 周次 | 目标 | 项 |
|------|------|----|
| W1 | 止血 | B-01、B-02、B-05、B-04、B-18；O-03、O-04 |
| W2 | 隔离与路径 | B-08、B-09、B-12–B-14、O-06；B-10 索引 |
| W3 | 凭据与上传 | B-03 加密方案、B-06 强制重置、B-15；O-01/O-02 闭环 |
| W4 | 结构债 | O-20 拆 Upload 上传链路、O-22 迁移统一、O-17 构建路径、文档收敛 |

---

## 五、关键文件索引

| 区域 | 路径 |
|------|------|
| 入口 | `backend/server.js` |
| 鉴权 | `backend/middleware/auth.js`、`backend/routes/auth.js` |
| 上传 | `backend/routes/upload.js`、`upload-chunked.js`、`frontend/src/views/Upload.vue` |
| WS | `backend/services/ws-sftp-proxy.js` |
| FTP 授权码 | `backend/services/ftp-auth.js` |
| 服务器 CRUD | `backend/routes/servers.js` |
| DB | `backend/db/database.js`、`database-mysql.js`、`database-sqlite.js` |
| 产品文档 | `docs/01-项目概述.md` … `docs/10-数据库与部署.md` |

---

## 六、说明

- 本清单基于静态代码审查，**未做渗透测试与线上流量复现**；P0/P1 建议在修复后做针对性验证。  
- 根目录大量 `*-FIX.md` / `*-GUIDE.md` 反映历史上传/SSL/MySQL 问题，修复时应对照是否仍复现，再归档删除。  
- 若只需跟踪某一子系统（例如「仅上传」或「仅 SSL」），可在此文档拆出子表继续迭代。
