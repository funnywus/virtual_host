# 域名与 DNS 管理

域名模块负责主域名、子域名的全生命周期管理，并与阿里云、腾讯云 DNS API 深度集成。

## 概念说明

| 概念 | 说明 |
|------|------|
| 主域名 | 在 DNS 平台托管的顶级域名，如 `example.com` |
| 子域名 | 主域名下的主机记录，如 `site1.example.com` |
| DNS 平台 | 存储 API 密钥的配置项，支持阿里云、腾讯云 |
| 虚拟主机 | 子域名绑定的 Web 服务实例（Nginx + 网站目录） |

## DNS 平台配置

在使用域名功能前，需先在 **DNS 平台** 页添加 API 凭证：

### 阿里云

- AccessKey ID
- AccessKey Secret
- 支持多个配置，可设默认

### 腾讯云

- SecretId
- SecretKey

添加后可点击「测试」验证 API 是否有效。

相关 API：

- `GET /api/dns/aliyun-configs` — 列表
- `POST /api/dns/aliyun-configs` — 新增
- `POST /api/dns/aliyun-configs/:id/test` — 测试连接

## 主域名管理

在 **域名管理** 页面：

1. 添加主域名（如 `example.com`）
2. 关联 DNS 平台配置
3. 可选设置到期时间 `expire_at`
4. 查看 SSL 状态摘要

支持操作：编辑、停用、删除、设为默认域名。

## 子域名管理

在 **子域名管理** 页面是日常运维的核心入口。

### 创建子域名

创建时系统通常会自动完成：

1. 在 DNS 平台添加 A/CNAME 记录
2. 在目标服务器生成 Nginx 虚拟主机配置
3. 创建网站根目录（如 `/home/www/xxx/`）
4. 可选同步 FTP 账号

### 批量操作

- **批量创建** — `POST /api/dns/batch-create`
- **批量删除** — `POST /api/dns/subdomains/batch-delete`
- **批量部署上传脚本** — 为目标站点部署 PHP 直传脚本
- **到期检查** — `POST /api/dns/subdomains/check-expire`

### 子域名字段说明

| 字段 | 说明 |
|------|------|
| `record_type` | DNS 记录类型，默认 A |
| `record_value` | 解析目标 IP |
| `nginx_synced` | Nginx 配置是否已同步 |
| `ssl_status` | SSL 证书状态 |
| `rate_limit_*` | Nginx 限流参数 |
| `use_status` | 使用状态（含到期停用） |

## DNS 记录管理

针对主域名可单独管理 DNS 记录，入口为侧边栏 **DNS记录** 页面，也可从 **域名管理** 列表点击「DNS记录」跳转：

- `GET /api/dns/domains/:id/dns-records` — 列表
- `POST /api/dns/domains/:id/dns-records` — 新增
- `PUT /api/dns/domains/:id/dns-records/:recordId` — 修改
- `PUT /api/dns/domains/:id/dns-records/:recordId/status` — 启用/停用
- `DELETE /api/dns/domains/:id/dns-records/:recordId` — 删除

## 到期自动处理

系统定时检查过期子域名（`server.js` 中 `checkExpiredSubdomains`）：

1. 查询 `expire_at` 已过期的子域名
2. 调用 DNS API 删除对应解析记录
3. 更新子域名状态为 `disabled`

## 随机子域名

支持自动生成随机子域名前缀：

```
GET /api/dns/generate-subdomain
```

适用于快速分配临时站点。

## 最佳实践

1. **先配 DNS 平台，再配主域名** — 避免创建子域名时 API 调用失败
2. **确认解析生效** — 新建 A 记录后等待 TTL 传播（通常 600 秒）
3. **绑定正确服务器** — 子域名的 `record_value` 应指向对应服务器 IP
4. **设置到期时间** — 临时站点务必填写 `expire_at`，避免资源泄漏

## 常见问题

| 问题 | 排查 |
|------|------|
| DNS 记录创建失败 | 检查 API 密钥权限、域名是否在对应平台 |
| 网站无法访问 | 确认 Nginx 已同步、防火墙 80/443 已开放 |
| 子域名显示 pending | 查看 DNS API 返回错误，重试同步 |
