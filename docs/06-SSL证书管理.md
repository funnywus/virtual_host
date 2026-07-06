# SSL 证书管理

系统支持为域名与子域名自动申请、续期 SSL 证书，并提供批量签发与实时日志推送能力。

## 支持的证书类型

通过 `GET /api/ssl/types` 获取当前支持的证书类型，主要包括：

- **Let's Encrypt** — 免费 DV 证书，自动 HTTP-01 / DNS 验证
- 其他类型视 `ssl-cert.js` 服务实现而定

验证方式可通过 `GET /api/ssl/verify-methods` 查询。

## 单域名 SSL

### 申请流程

1. 在子域名或域名列表中选择目标站点
2. 点击申请 SSL
3. 系统通过 SSH 在目标服务器执行 certbot 或等效工具
4. 更新 Nginx 配置并重载
5. 数据库记录 `ssl_status`、`ssl_expires`、`ssl_type`

### 查看状态

```
GET /api/ssl/status/:domain_id
GET /api/ssl/log/:domain_id
```

SSL 操作日志可通过 WebSocket 实时推送（`ssl-log-ws.js`）。

## 批量 SSL 签发

适用于一次性为多个子域名申请证书的场景。

### 发起批量任务

```
POST /api/ssl/batch-issue
```

请求体包含待处理域名 ID 列表与证书类型。系统创建 `batch_ssl_jobs` 记录并异步执行。

### 查询任务进度

```
GET /api/ssl/batch-issue/:job_id
```

返回字段：

| 字段 | 说明 |
|------|------|
| `status` | pending / running / completed / failed |
| `total` | 总任务数 |
| `done` | 已完成数 |
| `success` | 成功数 |
| `failed` | 失败数 |
| `log` | 执行日志 |
| `results` | 各域名结果详情 |

## 自动检查与续期

后端启动后注册定时任务（`scheduleSslCheck`）：

- **首次执行** — 下一个凌晨 3:00
- **周期** — 每 24 小时
- **动作** — 扫描所有域名/子域名证书状态，对即将过期证书触发续期逻辑

控制台日志前缀：`[SSL Check]`

## 前置条件

SSL 申请成功需满足：

1. 域名 DNS 已正确解析到目标服务器
2. 服务器 80/443 端口可从公网访问（HTTP-01 验证）
3. Nginx 配置已同步且包含对应 `server_name`
4. 服务器已安装 certbot 或系统预置的证书工具

## 数据库表

### domains / subdomains

存储每个域名的 SSL 状态字段：

- `ssl_status` — none / pending / active / failed 等
- `ssl_type` — 证书类型
- `ssl_expires` — 过期时间
- `ssl_log` — 最近操作日志

### batch_ssl_jobs

批量任务持久化表，服务重启后仍可查询历史任务进度。

## 故障排查

| 现象 | 可能原因 | 建议 |
|------|----------|------|
| 验证失败 | DNS 未生效 | 等待 TTL，用 dig 确认解析 |
| certbot 报错 | 未安装或版本过旧 | SSH 登录服务器手动安装 certbot |
| 443 无法访问 | 防火墙或 Nginx 未监听 | 检查安全组与 `nginx -t` |
| 批量任务卡住 | 单域名 SSH 超时 | 查看 job log，跳过问题域名后重试 |

## 相关文档

项目根目录另有详细修复记录：

- `BATCH-SSL-MULTI-TASK.md`
- `BATCH-SSL-PERSISTENCE.md`
- `BATCH-SSL-TASK-EXPIRY.md`
