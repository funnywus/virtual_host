# 数据库自动迁移

## 功能说明
后端启动时会自动检查并添加缺失的数据库字段，无需手动执行 SQL 脚本。

## 实现方式

### 自动迁移
在 `backend/server.js` 中添加了 `migrateDatabase()` 函数：

```javascript
async function migrateDatabase() {
  try {
    // 检查 domains 表是否已有 expire_at 字段
    const domainsColumns = await db.all("PRAGMA table_info(domains)");
    const hasDomainsExpireAt = domainsColumns.some(col => col.name === 'expire_at');
    
    if (!hasDomainsExpireAt) {
      console.log('[DB Migration] 为 domains 表添加 expire_at 字段...');
      await db.run('ALTER TABLE domains ADD COLUMN expire_at DATETIME DEFAULT NULL');
      console.log('[DB Migration] ✓ domains 表添加成功');
    }
    
    // 检查 servers 表是否已有 expire_at 字段
    const serversColumns = await db.all("PRAGMA table_info(servers)");
    const hasServersExpireAt = serversColumns.some(col => col.name === 'expire_at');
    
    if (!hasServersExpireAt) {
      console.log('[DB Migration] 为 servers 表添加 expire_at 字段...');
      await db.run('ALTER TABLE servers ADD COLUMN expire_at DATETIME DEFAULT NULL');
      console.log('[DB Migration] ✓ servers 表添加成功');
    }
  } catch (err) {
    console.error('[DB Migration] 错误:', err.message);
  }
}
```

### 执行时机
- 在 `db.init()` 之后立即执行
- 每次后端启动时自动运行
- 如果字段已存在，则跳过

## 添加的字段

### domains 表
```sql
ALTER TABLE domains ADD COLUMN expire_at DATETIME DEFAULT NULL;
```

### servers 表
```sql
ALTER TABLE servers ADD COLUMN expire_at DATETIME DEFAULT NULL;
```

## 启动日志

### 首次启动（需要添加字段）
```
[DB Migration] 为 domains 表添加 expire_at 字段...
[DB Migration] ✓ domains 表添加成功
[DB Migration] 为 servers 表添加 expire_at 字段...
[DB Migration] ✓ servers 表添加成功
```

### 后续启动（字段已存在）
```
（无输出，静默跳过）
```

## 优点

1. **自动化** - 无需手动执行 SQL 脚本
2. **幂等性** - 多次执行不会出错
3. **安全性** - 只添加缺失的字段，不影响现有数据
4. **便捷性** - 新部署或更新时自动完成迁移

## 扩展方式

如果将来需要添加更多字段，只需在 `migrateDatabase()` 函数中添加相应的检查和执行代码：

```javascript
// 示例：添加新字段
const hasNewField = columns.some(col => col.name === 'new_field');
if (!hasNewField) {
  console.log('[DB Migration] 为 xxx 表添加 new_field 字段...');
  await db.run('ALTER TABLE xxx ADD COLUMN new_field VARCHAR(255) DEFAULT NULL');
  console.log('[DB Migration] ✓ xxx 表添加成功');
}
```

## 注意事项

1. **SQLite 限制**
   - SQLite 的 ALTER TABLE 功能有限
   - 只能添加列，不能删除或修改列
   - 如需复杂修改，需要重建表

2. **MySQL 兼容**
   - 如果使用 MySQL，需要调整 PRAGMA 语句
   - 使用 `SHOW COLUMNS FROM table_name` 代替

3. **备份建议**
   - 重要数据库建议先备份
   - 测试环境验证后再部署到生产环境

## 手动迁移脚本

如果需要手动执行迁移，可以使用：

```bash
node backend/scripts/add-expire-at-field.js
```

但通常不需要，因为启动时会自动执行。
