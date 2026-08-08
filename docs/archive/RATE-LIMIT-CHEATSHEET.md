# Nginx 限流配置 - 速查表

## 快速配置（3 步）

```bash
# 1. 数据库迁移（仅首次）
node backend/scripts/add-rate-limit-fields.js

# 2. Web 界面配置
子域名列表 → 更多 → 限流配置 → 选择模板 → 保存

# 3. 验证生效
curl -I https://your-domain.com/  # 多次执行，看到 429 即生效
```

## 预设模板速查

| 模板 | 速率 | 突发 | 连接 | 场景 |
|-----|------|-----|------|------|
| 低 | 100r/s | 200 | 50 | 高流量 |
| 中 | 50r/s | 100 | 30 | 普通站 |
| 高 | 10r/s | 20 | 10 | 小站点 |
| 严 | 5r/s | 10 | 5 | API |

## 参数说明

```
rate: 请求速率
  - 格式: 10r/s (每秒) 或 100r/m (每分钟)
  - 建议: 根据实际流量设置

burst: 突发请求数
  - 作用: 缓冲区大小
  - 建议: rate 的 2 倍

nodelay: 无延迟处理
  - true: 立即处理突发请求（推荐）
  - false: 延迟处理

conn_limit: 并发连接数
  - 作用: 单 IP 最大连接数
  - 建议: 10-50
```

## API 接口

```bash
# 更新限流配置
curl -X PUT http://localhost:3000/api/dns/subdomains/123/rate-limit \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": true,
    "rate": "10r/s",
    "burst": 20,
    "nodelay": true,
    "conn_limit": 10
  }'
```

## 常用命令

```bash
# 查看 Nginx 配置
cat /www/server/panel/vhost/nginx/domain.com.conf

# 测试配置
nginx -t

# 重载 Nginx
nginx -s reload

# 查看限流日志
tail -f /www/wwwlogs/domain.com.error.log | grep "limiting"

# 统计 429 错误
grep " 429 " /www/wwwlogs/domain.com.log | wc -l

# 查看被限流的 IP
grep " 429 " /www/wwwlogs/domain.com.log | awk '{print $1}' | sort | uniq -c | sort -rn
```

## 测试限流

```bash
# 方法 1: curl 循环
for i in {1..50}; do curl -I https://domain.com/ 2>&1 | grep "HTTP"; done

# 方法 2: ab 压测
ab -n 100 -c 10 https://domain.com/

# 方法 3: 浏览器
快速按 F5 刷新多次
```

## 故障排查

```bash
# 问题: 配置不生效
1. 检查配置文件: cat /www/server/panel/vhost/nginx/domain.com.conf
2. 测试语法: nginx -t
3. 重载服务: nginx -s reload

# 问题: 同步失败
1. 检查 SSH 连接
2. 查看后端日志
3. 手动同步配置

# 问题: 限流过严
1. 临时禁用限流
2. 调整为"低限制"
3. 分析日志找合适参数
```

## 推荐配置

```nginx
# 普通网站
rate: 50r/s
burst: 100
conn_limit: 30

# API 接口
rate: 10r/s
burst: 20
conn_limit: 10

# 静态资源
rate: 100r/s
burst: 200
conn_limit: 50

# 登录接口
rate: 5r/s
burst: 10
conn_limit: 5
```

## 监控指标

```bash
# 每分钟被限流次数
grep " 429 " /www/wwwlogs/domain.com.log | \
  awk '{print $4}' | cut -d: -f1-2 | uniq -c

# 被限流最多的 IP Top 10
grep " 429 " /www/wwwlogs/domain.com.log | \
  awk '{print $1}' | sort | uniq -c | sort -rn | head -10

# 被限流的 URL Top 10
grep " 429 " /www/wwwlogs/domain.com.log | \
  awk '{print $7}' | sort | uniq -c | sort -rn | head -10
```

## 文件位置

```
数据库: backend/db/database-sqlite.js
API: backend/routes/dns.js
配置: backend/services/nginx-config.js
前端: frontend/src/views/Subdomains.vue
迁移: backend/scripts/add-rate-limit-fields.js
```

## 相关文档

- 详细文档: `NGINX-RATE-LIMIT-FEATURE.md`
- 快速开始: `NGINX-RATE-LIMIT-QUICK-START.md`
- 实现总结: `RATE-LIMIT-IMPLEMENTATION-SUMMARY.md`

---
**提示**: 从"中限制"开始，根据实际情况调整
