# Nginx 限流配置功能

## 功能概述

为子域名添加了 Nginx 限流配置功能，类似宝塔面板的限流管理。可以防止恶意请求和 DDoS 攻击，保护服务器资源。

## 功能特性

### 1. 限流参数配置

- **请求速率限制** (rate): 控制每秒/每分钟的请求数
  - 格式: `10r/s` (每秒10个请求) 或 `100r/m` (每分钟100个请求)
  - 默认: `10r/s`

- **突发请求数** (burst): 允许的突发请求缓冲区大小
  - 超过速率限制时的缓冲区
  - 默认: 20

- **无延迟处理** (nodelay): 是否立即处理突发请求
  - 启用: 立即处理突发请求
  - 禁用: 延迟处理突发请求
  - 默认: 启用

- **并发连接数限制** (conn_limit): 单个 IP 的最大并发连接数
  - 默认: 10

### 2. 预设配置模板

提供 4 种常用限流模板：

| 模板 | 请求速率 | 突发请求 | 并发连接 | 适用场景 |
|------|---------|---------|---------|---------|
| 低限制 | 100r/s | 200 | 50 | 高流量网站 |
| 中限制 | 50r/s | 100 | 30 | 普通网站 |
| 高限制 | 10r/s | 20 | 10 | 小型网站 |
| 严格限制 | 5r/s | 10 | 5 | 敏感接口 |

### 3. 自动同步到服务器

- 配置保存后自动更新 Nginx 配置文件
- 自动测试 Nginx 配置语法
- 自动重载 Nginx 服务
- 实时反馈同步状态

## 使用方法

### 前端操作

1. 进入"子域名列表"页面
2. 找到需要配置限流的子域名
3. 点击"更多" → "限流配置"
4. 在弹出的对话框中：
   - 启用/禁用限流功能
   - 手动设置参数或选择预设模板
   - 点击"保存并应用"

### API 接口

**更新限流配置**

```http
PUT /api/dns/subdomains/:id/rate-limit
Content-Type: application/json

{
  "enabled": true,
  "rate": "10r/s",
  "burst": 20,
  "nodelay": true,
  "conn_limit": 10
}
```

**响应**

```json
{
  "message": "限流配置已更新并同步到服务器",
  "synced": true
}
```

## 数据库结构

### 新增字段 (subdomains 表)

```sql
-- SQLite
rate_limit_enabled INTEGER DEFAULT 0
rate_limit_rate TEXT DEFAULT '10r/s'
rate_limit_burst INTEGER DEFAULT 20
rate_limit_nodelay INTEGER DEFAULT 1
rate_limit_conn INTEGER DEFAULT 10

-- MySQL
rate_limit_enabled TINYINT DEFAULT 0
rate_limit_rate VARCHAR(20) DEFAULT '10r/s'
rate_limit_burst INT DEFAULT 20
rate_limit_nodelay TINYINT DEFAULT 1
rate_limit_conn INT DEFAULT 10
```

### 数据库迁移

对于已有数据库，运行迁移脚本：

```bash
node backend/scripts/add-rate-limit-fields.js
```

## Nginx 配置示例

启用限流后，生成的 Nginx 配置包含：

```nginx
# 限流配置
limit_req_zone $binary_remote_addr zone=one:10m rate=10r/s;
limit_conn_zone $binary_remote_addr zone=addr:10m;

# 应用限流
limit_req zone=one burst=20 nodelay;
limit_conn addr 10;

# 限流错误页面
limit_req_status 429;
limit_conn_status 429;
```

## 技术实现

### 后端实现

1. **数据库层** (`backend/db/database-sqlite.js`)
   - 添加限流配置字段到 subdomains 表

2. **API 路由** (`backend/routes/dns.js`)
   - `PUT /api/dns/subdomains/:id/rate-limit` - 更新限流配置
   - 自动重新生成 Nginx 配置
   - 通过 SSH 同步到服务器

3. **Nginx 配置服务** (`backend/services/nginx-config.js`)
   - `rateLimitConfig()` - 生成限流配置模板
   - 集成到 HTTP/HTTPS 配置模板中

### 前端实现

1. **UI 组件** (`frontend/src/views/Subdomains.vue`)
   - 限流配置对话框
   - 预设模板快捷按钮
   - 实时参数调整

2. **状态管理**
   - `rateLimitForm` - 限流配置表单数据
   - `rateLimitDialogVisible` - 对话框显示状态
   - `rateLimitSaving` - 保存状态

## 注意事项

1. **服务器要求**
   - 子域名必须关联服务器才能同步配置
   - 需要 SSH 访问权限
   - Nginx 必须已安装

2. **配置建议**
   - 根据实际流量调整参数
   - 避免设置过于严格的限制
   - 定期监控 429 错误日志

3. **错误处理**
   - 配置保存到数据库，即使同步失败也不会丢失
   - 可以在 Nginx 对话框中手动重新同步
   - 查看服务器日志排查同步问题

## 测试验证

### 1. 测试限流是否生效

```bash
# 使用 ab (Apache Bench) 测试
ab -n 100 -c 10 https://your-subdomain.example.com/

# 使用 curl 循环测试
for i in {1..50}; do curl -I https://your-subdomain.example.com/; done
```

### 2. 查看 Nginx 错误日志

```bash
tail -f /www/wwwlogs/your-subdomain.example.com.error.log
```

### 3. 验证配置文件

```bash
cat /www/server/panel/vhost/nginx/your-subdomain.example.com.conf
nginx -t
```

## 常见问题

### Q: 限流配置不生效？

A: 检查以下几点：
1. 确认子域名已关联服务器
2. 检查 SSH 连接是否正常
3. 查看 Nginx 配置文件是否已更新
4. 确认 Nginx 已重载 (`nginx -s reload`)

### Q: 如何调整限流参数？

A: 根据实际情况：
- 高流量网站：使用"低限制"模板
- 普通网站：使用"中限制"模板
- API 接口：使用"高限制"或"严格限制"模板

### Q: 限流会影响正常用户吗？

A: 合理的限流配置不会影响正常用户：
- 突发请求数 (burst) 提供缓冲
- nodelay 确保快速响应
- 只有异常高频请求才会被限制

## 相关文件

- `backend/db/database-sqlite.js` - 数据库表结构
- `backend/routes/dns.js` - API 路由
- `backend/services/nginx-config.js` - Nginx 配置生成
- `frontend/src/views/Subdomains.vue` - 前端界面
- `backend/scripts/add-rate-limit-fields.js` - 数据库迁移脚本

## 更新日志

### 2026-04-10
- ✅ 添加限流配置数据库字段
- ✅ 实现限流配置 API 接口
- ✅ 集成到 Nginx 配置生成器
- ✅ 添加前端限流配置界面
- ✅ 提供 4 种预设配置模板
- ✅ 自动同步到服务器
- ✅ 创建数据库迁移脚本
