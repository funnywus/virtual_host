# Nginx 限流配置 - 快速开始

## 快速使用指南

### 1. 数据库迁移（首次使用）

如果你的数据库是在此功能之前创建的，需要先运行迁移脚本：

```bash
cd backend
node scripts/add-rate-limit-fields.js
```

输出示例：
```
开始迁移：添加限流配置字段...
检测到 SQLite 数据库
执行: ALTER TABLE subdomains ADD COLUMN rate_limit_enabled INTEGER DEFAULT 0
执行: ALTER TABLE subdomains ADD COLUMN rate_limit_rate TEXT DEFAULT '10r/s'
执行: ALTER TABLE subdomains ADD COLUMN rate_limit_burst INTEGER DEFAULT 20
执行: ALTER TABLE subdomains ADD COLUMN rate_limit_nodelay INTEGER DEFAULT 1
执行: ALTER TABLE subdomains ADD COLUMN rate_limit_conn INTEGER DEFAULT 10
✓ 迁移完成！限流配置字段已添加到 subdomains 表
```

### 2. 前端配置限流

#### 步骤 1: 打开子域名列表
访问系统的"子域名列表"页面

#### 步骤 2: 选择子域名
找到需要配置限流的子域名，点击"更多" → "限流配置"

#### 步骤 3: 配置参数
在弹出的对话框中：

**方式一：使用预设模板（推荐）**
- 点击"低限制"、"中限制"、"高限制"或"严格限制"按钮
- 系统会自动填充对应的参数

**方式二：手动配置**
1. 启用限流开关
2. 设置请求速率（如：`10r/s` 或 `100r/m`）
3. 设置突发请求数（如：20）
4. 选择是否启用无延迟处理
5. 设置并发连接数限制（如：10）

#### 步骤 4: 保存并应用
点击"保存并应用"按钮，系统会：
- 保存配置到数据库
- 自动生成新的 Nginx 配置
- 通过 SSH 同步到服务器
- 测试 Nginx 配置
- 重载 Nginx 服务

### 3. 预设模板说明

| 模板 | 适用场景 | 请求速率 | 突发请求 | 并发连接 |
|------|---------|---------|---------|---------|
| **低限制** | 高流量网站、CDN 源站 | 100r/s | 200 | 50 |
| **中限制** | 普通企业网站、博客 | 50r/s | 100 | 30 |
| **高限制** | 小型网站、个人站点 | 10r/s | 20 | 10 |
| **严格限制** | API 接口、敏感操作 | 5r/s | 10 | 5 |

### 4. 验证限流是否生效

#### 方法 1: 使用浏览器快速刷新
1. 打开子域名网站
2. 快速按 F5 刷新多次
3. 如果看到 429 错误页面，说明限流已生效

#### 方法 2: 使用命令行工具
```bash
# 使用 curl 测试
for i in {1..50}; do 
  curl -I https://your-subdomain.example.com/ 2>&1 | grep "HTTP"
done

# 正常响应: HTTP/2 200
# 被限流: HTTP/2 429
```

#### 方法 3: 查看 Nginx 配置
```bash
# SSH 登录服务器
ssh user@server-ip

# 查看配置文件
cat /www/server/panel/vhost/nginx/your-subdomain.example.com.conf

# 应该能看到类似内容：
# limit_req_zone $binary_remote_addr zone=one:10m rate=10r/s;
# limit_req zone=one burst=20 nodelay;
```

### 5. 常见使用场景

#### 场景 1: 防止爬虫过度抓取
```
推荐配置: 高限制
- 请求速率: 10r/s
- 突发请求: 20
- 并发连接: 10
```

#### 场景 2: 保护 API 接口
```
推荐配置: 严格限制
- 请求速率: 5r/s
- 突发请求: 10
- 并发连接: 5
```

#### 场景 3: 防止 DDoS 攻击
```
推荐配置: 严格限制 + 更低的参数
- 请求速率: 2r/s
- 突发请求: 5
- 并发连接: 3
```

#### 场景 4: 高流量网站
```
推荐配置: 低限制
- 请求速率: 100r/s
- 突发请求: 200
- 并发连接: 50
```

### 6. 调整和优化

#### 如何判断限流是否合适？

**限流过严的表现：**
- 正常用户频繁看到 429 错误
- 网站加载缓慢或不完整
- 用户投诉无法正常访问

**限流过松的表现：**
- 服务器负载仍然很高
- 恶意请求未被有效拦截
- 带宽消耗异常

**调整建议：**
1. 从"中限制"开始
2. 观察 1-2 天的访问情况
3. 根据实际情况调整：
   - 正常用户受影响 → 放宽限制
   - 仍有恶意请求 → 收紧限制

### 7. 监控和日志

#### 查看被限流的请求
```bash
# 查看错误日志
tail -f /www/wwwlogs/your-subdomain.example.com.error.log | grep "limiting requests"

# 查看访问日志中的 429 状态码
tail -f /www/wwwlogs/your-subdomain.example.com.log | grep " 429 "
```

#### 统计被限流的 IP
```bash
# 统计最近被限流的 IP
grep " 429 " /www/wwwlogs/your-subdomain.example.com.log | \
  awk '{print $1}' | sort | uniq -c | sort -rn | head -10
```

### 8. 禁用限流

如果需要临时或永久禁用限流：

1. 打开"限流配置"对话框
2. 关闭"启用限流"开关
3. 点击"保存并应用"

系统会自动生成不包含限流规则的 Nginx 配置。

### 9. 故障排查

#### 问题 1: 配置保存成功但未生效
```bash
# 检查 Nginx 配置文件
cat /www/server/panel/vhost/nginx/your-subdomain.example.com.conf

# 测试 Nginx 配置
nginx -t

# 手动重载 Nginx
nginx -s reload
```

#### 问题 2: 同步失败
- 检查服务器 SSH 连接是否正常
- 确认服务器上 Nginx 路径是否正确
- 查看后端日志获取详细错误信息

#### 问题 3: 限流过于严格
- 立即调整为"低限制"模板
- 或临时禁用限流
- 分析日志找出合适的参数

## 技术支持

如有问题，请查看：
- 详细文档: `NGINX-RATE-LIMIT-FEATURE.md`
- 配置示例: `backend/services/nginx-config.js`
- API 文档: `backend/routes/dns.js`

## 更新记录

- 2026-04-10: 初始版本发布
