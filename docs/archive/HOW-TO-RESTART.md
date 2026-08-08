# 如何重启后端服务以应用数据库迁移

## 背景
已为域名和服务器管理添加了到期时间功能，数据库迁移代码已添加到 `backend/server.js` 中，会在启动时自动执行。

## 重启步骤

### 方法 1: 使用 PM2（推荐）
如果使用 PM2 管理后端服务：

```bash
# 进入后端目录
cd backend

# 重启服务
pm2 restart all
# 或指定服务名
pm2 restart server

# 查看日志确认迁移成功
pm2 logs
```

### 方法 2: 直接运行
如果直接运行 Node.js：

```bash
# 停止当前运行的服务（Ctrl+C）

# 重新启动
cd backend
node server.js
```

### 方法 3: 使用 npm scripts
如果配置了 npm scripts：

```bash
cd backend
npm run start
# 或
npm run dev
```

## 验证迁移成功

启动后查看控制台输出，应该看到类似以下信息：

```
[DB Migration] 为 domains 表添加 expire_at 字段...
[DB Migration] ✓ domains 表添加成功
[DB Migration] 为 servers 表添加 expire_at 字段...
[DB Migration] ✓ servers 表添加成功
```

如果字段已存在，不会有任何输出（静默跳过）。

## 测试功能

1. 打开域名管理页面，点击"添加域名"或"编辑"
2. 应该能看到"到期时间"选择器
3. 保存后，列表中应显示到期时间和剩余天数
4. 服务器管理页面同理

## 注意事项

- 数据库迁移是幂等的，多次运行不会出错
- 已有数据的 expire_at 字段默认为 NULL（永久有效）
- 迁移失败不会影响服务启动，只会在控制台输出错误信息
