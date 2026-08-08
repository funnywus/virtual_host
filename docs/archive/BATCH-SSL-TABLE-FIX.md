# 批量SSL任务表创建失败修复指南

## 问题描述

启动服务时出现错误：
```
Table 'virtual_host.batch_ssl_jobs' doesn't exist
```

## 原因分析

批量SSL证书任务表 `batch_ssl_jobs` 不存在。这可能是因为：
1. 首次启动，表还未创建
2. 数据库迁移失败
3. 使用了旧版本的数据库

## 解决方案

### 方案1：重启服务（推荐）

服务器启动时会自动检测并创建缺失的表。

```bash
# 停止服务
pm2 stop all

# 重新启动
cd backend
node server.js

# 或使用 PM2
pm2 restart all
```

查看启动日志，应该看到：
```
[DB Migration] 创建 batch_ssl_jobs 表...
[DB Migration] ✓ batch_ssl_jobs 表创建成功
```

### 方案2：手动执行SQL（MySQL）

如果自动迁移失败，可以手动创建表。

#### 步骤1：连接数据库
```bash
mysql -u root -p
```

#### 步骤2：选择数据库
```sql
USE virtual_host;
```

#### 步骤3：执行SQL文件
```bash
# 退出MySQL，在命令行执行
mysql -u root -p virtual_host < backend/scripts/create-batch-ssl-jobs-table.sql
```

或者直接在MySQL中执行：
```sql
CREATE TABLE IF NOT EXISTS batch_ssl_jobs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  job_id VARCHAR(255) UNIQUE NOT NULL COMMENT '任务唯一ID',
  user_id INT NOT NULL COMMENT '用户ID',
  status VARCHAR(50) DEFAULT 'pending' COMMENT '任务状态',
  total INT DEFAULT 0 COMMENT '总域名数',
  done INT DEFAULT 0 COMMENT '已完成数',
  success INT DEFAULT 0 COMMENT '成功数',
  failed INT DEFAULT 0 COMMENT '失败数',
  log TEXT COMMENT '执行日志',
  results TEXT COMMENT '结果JSON',
  cert_type VARCHAR(50) DEFAULT 'letsencrypt' COMMENT '证书类型',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  started_at DATETIME COMMENT '开始时间',
  finished_at DATETIME COMMENT '完成时间',
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_id (user_id),
  INDEX idx_status (status),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='批量SSL证书任务表';
```

#### 步骤4：验证表创建
```sql
-- 查看表结构
DESC batch_ssl_jobs;

-- 查看所有表
SHOW TABLES;
```

### 方案3：使用迁移脚本（SQLite）

如果使用SQLite数据库，表会在启动时自动创建。如果没有创建，检查：

```bash
# 查看数据库文件
ls -la data/app.db

# 删除旧数据库（注意：会丢失所有数据）
rm data/app.db

# 重新启动服务
node server.js
```

## 验证修复

### 1. 检查表是否存在

**MySQL:**
```sql
USE virtual_host;
SHOW TABLES LIKE 'batch_ssl_jobs';
DESC batch_ssl_jobs;
```

**SQLite:**
```bash
sqlite3 data/app.db
.tables
.schema batch_ssl_jobs
```

### 2. 测试功能

1. 登录系统
2. 进入域名管理页面
3. 点击"批量获取证书"
4. 创建一个测试任务
5. 检查任务是否正常显示

### 3. 查看数据

**MySQL:**
```sql
SELECT * FROM batch_ssl_jobs ORDER BY created_at DESC LIMIT 5;
```

**SQLite:**
```bash
sqlite3 data/app.db "SELECT * FROM batch_ssl_jobs ORDER BY created_at DESC LIMIT 5;"
```

## 常见问题

### Q1: 自动迁移为什么失败？

**可能原因：**
- 数据库连接失败
- 权限不足
- 表名冲突
- SQL语法错误

**解决方法：**
1. 检查数据库连接配置（.env文件）
2. 确保数据库用户有CREATE TABLE权限
3. 查看服务器启动日志
4. 使用手动SQL创建

### Q2: 手动创建表后还是报错？

**检查项：**
1. 表名是否正确（batch_ssl_jobs）
2. 数据库名是否正确（virtual_host）
3. 是否重启了服务
4. 是否有其他错误日志

**解决方法：**
```bash
# 查看完整错误日志
pm2 logs

# 或
tail -f logs/error.log
```

### Q3: 如何清空任务数据？

**MySQL:**
```sql
TRUNCATE TABLE batch_ssl_jobs;
```

**SQLite:**
```sql
DELETE FROM batch_ssl_jobs;
VACUUM;
```

### Q4: 如何删除表重新创建？

**MySQL:**
```sql
DROP TABLE IF EXISTS batch_ssl_jobs;
-- 然后重新执行CREATE TABLE语句
```

**SQLite:**
```sql
DROP TABLE IF EXISTS batch_ssl_jobs;
-- 重启服务会自动创建
```

## 预防措施

### 1. 定期备份数据库

**MySQL:**
```bash
mysqldump -u root -p virtual_host > backup_$(date +%Y%m%d).sql
```

**SQLite:**
```bash
cp data/app.db data/app.db.backup_$(date +%Y%m%d)
```

### 2. 使用版本控制

将数据库迁移脚本纳入版本控制：
```bash
git add backend/scripts/*.sql
git commit -m "Add database migration scripts"
```

### 3. 监控日志

定期检查启动日志，确保迁移成功：
```bash
grep "DB Migration" logs/app.log
```

## 相关文件

- `backend/server.js` - 数据库迁移逻辑
- `backend/db/database-sqlite.js` - SQLite表定义
- `backend/db/database-mysql.js` - MySQL连接配置
- `backend/scripts/create-batch-ssl-jobs-table.sql` - 手动创建表SQL
- `BATCH-SSL-PERSISTENCE.md` - 任务持久化说明

## 技术支持

如果以上方法都无法解决问题，请：

1. 收集错误日志
2. 检查数据库版本
3. 确认环境配置
4. 提供详细的错误信息

## 更新日志

- 2024-01-01: 添加自动迁移功能
- 2024-01-01: 添加手动创建SQL脚本
- 2024-01-01: 完善错误处理和日志
