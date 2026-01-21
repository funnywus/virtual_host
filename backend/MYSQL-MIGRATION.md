# SQLite 迁移到 MySQL 指南

## 步骤 1: 安装依赖

```bash
cd backend
npm install mysql2
# 或
pnpm install mysql2
```

## 步骤 2: 创建 MySQL 数据库

```bash
mysql -u root -p
```

```sql
CREATE DATABASE virtual_host CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
EXIT;
```

## 步骤 3: 转换 SQLite 数据到 MySQL

```bash
cd backend/scripts
node sqlite-to-mysql.js ../data/app.db output.sql
```

## 步骤 4: 导入数据到 MySQL

```bash
mysql -u root -p virtual_host < scripts/output.sql
```

## 步骤 5: 配置环境变量

编辑 `backend/.env` 文件：

```env
# 数据库类型：sqlite 或 mysql
DB_TYPE=mysql

# MySQL 配置
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=virtual_host
```

## 步骤 6: 启动服务

```bash
cd backend
npm start
```

## 切换回 SQLite

如果需要切换回 SQLite，只需修改 `.env`：

```env
DB_TYPE=sqlite
DB_PATH=./data/app.db
```

## 验证

启动后查看日志，应该显示：

```
✓ 使用 MySQL 数据库
MySQL 数据库连接成功
Server running on port 6002
```

## 注意事项

1. **备份数据**：迁移前务必备份 SQLite 数据库
2. **字符集**：MySQL 使用 utf8mb4，支持 emoji 等特殊字符
3. **连接池**：MySQL 使用连接池，性能更好
4. **大小写**：MySQL 在某些系统上表名区分大小写
5. **事务**：两种数据库的事务行为略有不同

## 故障排除

### 连接失败

检查 MySQL 服务是否运行：
```bash
mysql -u root -p
```

### 权限问题

确保 MySQL 用户有足够权限：
```sql
GRANT ALL PRIVILEGES ON virtual_host.* TO 'root'@'localhost';
FLUSH PRIVILEGES;
```

### 导入错误

检查 SQL 文件是否正确生成，可以手动编辑修复。

## 性能对比

| 特性 | SQLite | MySQL |
|------|--------|-------|
| 并发写入 | 较差 | 优秀 |
| 并发读取 | 良好 | 优秀 |
| 数据量 | < 1GB | 无限制 |
| 部署 | 简单 | 需要服务 |
| 备份 | 复制文件 | mysqldump |

## 推荐配置

- **开发环境**：SQLite（简单快速）
- **生产环境**：MySQL（稳定可靠）
- **小型项目**：SQLite
- **大型项目**：MySQL
