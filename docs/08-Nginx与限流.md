# Nginx 与限流

系统通过 SSH 远程管理目标服务器上的 Nginx 虚拟主机配置，并支持 per-子域名 请求限流。

## Nginx 配置管理

### 自动生成

创建子域名时，`nginx-config.js` 服务会根据模板生成虚拟主机配置，通常包含：

- `server_name` — 子域名
- `root` — 网站根目录
- `index` — 默认首页
- SSL 相关块（证书申请后自动追加）
- 限流指令（若启用）

### 同步操作

通过 **Nginx** 相关 API 与前端 `NginxDialog.vue` 组件：

- 查看当前远程配置
- 编辑并保存配置（Monaco Editor）
- 同步到服务器并重载 Nginx
- 检测配置语法（`nginx -t`）

相关路由：`/api/nginx`

## 请求限流

子域名表（`subdomains`）包含限流字段，可在子域名管理页单独配置：

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `rate_limit_enabled` | 0 | 是否启用限流 |
| `rate_limit_rate` | `10r/s` | 请求速率 |
| `rate_limit_burst` | 20 | 突发桶大小 |
| `rate_limit_nodelay` | 1 | 是否 nodelay |
| `rate_limit_conn` | 10 | 并发连接限制 |

### 更新限流

```
PUT /api/dns/subdomains/:id/rate-limit
```

保存后系统会重新生成 Nginx 配置并重载。

### 生成的 Nginx 指令示例

```nginx
limit_req_zone $binary_remote_addr zone=site_xxx:10m rate=10r/s;

server {
    ...
    limit_req zone=site_xxx burst=20 nodelay;
    limit_conn addr 10;
}
```

具体语法以 `nginx-config.js` 实际输出为准。

## 限流使用场景

- 防止单站点被 DDoS 或爬虫压垮
- 限制 API 型静态站点请求频率
- 共享 IP 多租户环境下公平分配资源

## 配置建议

| 站点类型 | rate 建议 | burst 建议 |
|----------|-----------|------------|
| 静态展示页 | 10r/s | 20 |
| 高流量活动页 | 50r/s | 100 |
| 内部测试站 | 5r/s | 10 |

修改后观察 Nginx error.log 中 `limiting requests` 条目，按需调整。

## PHP 配置修复

部分 PHP 站点需要额外 FastCGI 配置，系统提供一键修复：

```
POST /api/dns/subdomains/:id/fix-php-config
```

适用于上传 PHP 项目后 502/空白页等问题。

## 运维命令

通过 SSH 终端或服务器本地执行：

```bash
# 测试配置
nginx -t

# 重载
nginx -s reload

# 查看错误日志
tail -f /var/log/nginx/error.log
```

## 故障排查

| 现象 | 可能原因 | 处理 |
|------|----------|------|
| 502 Bad Gateway | PHP-FPM 未运行 | 检查 php-fpm 服务 |
| 403 Forbidden | 目录权限或 index 缺失 | 确认 index.html 存在、权限 755 |
| 429 / 限流 | rate_limit 过低 | 调高 rate 或暂时关闭限流 |
| 配置未生效 | 未 reload | 在后台重新同步 Nginx |

## 相关文档

- 根目录 `NGINX-RATE-LIMIT-FEATURE.md`
- 根目录 `NGINX-RATE-LIMIT-QUICK-START.md`
- 根目录 `RATE-LIMIT-CHEATSHEET.md`
