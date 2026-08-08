# MySQL 字符串拼接修复指南

## 问题

SQLite 使用 `||` 进行字符串拼接，但 MySQL 需要使用 `CONCAT()` 函数。

## 已修复的文件

- ✅ `backend/db/database.js` - 添加了 `db.concat()` 兼容函数
- ✅ `backend/routes/ftp.js` - 3 处修复
- ✅ `backend/routes/nginx.js` - 1 处修复

## 需要修复的文件

以下文件仍需手动修复（搜索 `|| '.' ||` 并替换）：

### backend/routes/nginx.js
还有 2 处需要修复（第 71, 161, 198 行）

### backend/routes/upload.js  
2 处需要修复（第 34, 110 行）

### backend/routes/servers.js
1 处需要修复（第 72 行）

## 修复方法

### 查找
```sql
ELSE s.subdomain || '.' || d.domain END
```

### 替换为
```sql
ELSE ${db.concat('s.subdomain', "'.'", 'd.domain')} END
```

## 批量修复命令

在每个文件中执行查找替换：

```bash
# 在 VS Code 中
1. 打开文件
2. Cmd/Ctrl + F 查找: || '.' ||
3. 逐个检查并替换为: ${db.concat('s.subdomain', "'.'", 'd.domain')}
```

## 验证

修复后重启服务，检查 FTP 账号列表是否正常显示域名。

```bash
cd backend
npm start
```

访问 FTP 账号管理页面，确认"关联域名"列正常显示。
