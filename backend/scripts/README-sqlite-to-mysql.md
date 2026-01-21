# SQLite 转 MySQL 工具

将 SQLite 数据库文件转换为 MySQL SQL 脚本。

## 使用方法

### 基本用法

```bash
cd backend/scripts
node sqlite-to-mysql.js [SQLite文件路径] [输出MySQL文件路径]
```

### 示例

1. **使用默认路径**（转换 `../data/app.db` 到 `output.sql`）：
```bash
node sqlite-to-mysql.js
```

2. **指定输入文件**：
```bash
node sqlite-to-mysql.js ../data/app.db
```

3. **指定输入和输出文件**：
```bash
node sqlite-to-mysql.js ../data/app.db mysql-dump.sql
```

4. **转换其他 SQLite 文件**：
```bash
node sqlite-to-mysql.js /path/to/your/database.db output.sql
```

## 功能特性

- ✅ 自动转换表结构（CREATE TABLE）
- ✅ 自动转换数据类型（SQLite → MySQL）
- ✅ 导出所有表数据（INSERT）
- ✅ 支持主键和自增
- ✅ 支持 NOT NULL 约束
- ✅ 支持默认值
- ✅ 字符串自动转义
- ✅ 分批插入（每 100 行）
- ✅ UTF-8 编码支持

## 数据类型映射

| SQLite 类型 | MySQL 类型 |
|------------|-----------|
| INTEGER    | INT       |
| TEXT       | TEXT      |
| BLOB       | BLOB      |
| REAL       | DOUBLE    |
| NUMERIC    | DECIMAL   |
| DATETIME   | DATETIME  |

## 导入到 MySQL

转换完成后，使用以下命令导入到 MySQL：

```bash
mysql -u username -p database_name < output.sql
```

或者在 MySQL 客户端中：

```sql
SOURCE /path/to/output.sql;
```

## 注意事项

1. 转换前请备份原数据库
2. 确保 MySQL 数据库已创建
3. 检查字符集设置（默认 utf8mb4）
4. 大型数据库可能需要较长时间
5. 转换后请验证数据完整性

## 故障排除

### 错误：SQLite 文件不存在
确保提供的 SQLite 文件路径正确。

### 错误：权限不足
确保脚本有执行权限：
```bash
chmod +x sqlite-to-mysql.js
```

### MySQL 导入错误
检查 MySQL 版本兼容性，某些语法可能需要调整。
