# 故障排查指南

## 🔴 上传失败：ECONNREFUSED 错误

### 错误信息

```
上传失败: dist.zip - Failed to execute 'json' on 'Response': Unexpected end of JSON input
[vite] http proxy error: /api/upload-chunked/upload-chunk
AggregateError [ECONNREFUSED]
```

### 问题原因

**后端服务未运行**或**端口配置不匹配**

### ✅ 解决方案

#### 步骤 1: 检查后端服务是否运行

```bash
# 检查端口 6002 是否被占用
# Mac/Linux
lsof -i :6002

# Windows
netstat -ano | findstr :6002
```

如果没有输出，说明后端服务未运行。

#### 步骤 2: 启动后端服务

```bash
# 进入后端目录
cd backend

# 安装依赖（首次运行）
npm install

# 启动服务
npm start

# 或使用开发模式（自动重启）
npm run dev
```

#### 步骤 3: 验证后端服务

打开浏览器访问：http://localhost:6002/api/health

应该看到：
```json
{"status":"ok"}
```

#### 步骤 4: 启动前端服务

```bash
# 新开一个终端
cd frontend

# 安装依赖（首次运行）
npm install

# 启动前端
npm run dev
```

#### 步骤 5: 访问系统

打开浏览器访问：http://localhost:5173

---

## 🔴 常见错误及解决方案

### 1. 端口被占用

**错误信息**:
```
Error: listen EADDRINUSE: address already in use :::6002
```

**解决方案**:

```bash
# Mac/Linux - 查找占用端口的进程
lsof -i :6002
# 杀死进程
kill -9 <PID>

# Windows - 查找占用端口的进程
netstat -ano | findstr :6002
# 杀死进程
taskkill /PID <PID> /F

# 或者修改端口
# 编辑 backend/.env
PORT=3000

# 同时修改 frontend/vite.config.js
proxy: {
  '/api': {
    target: 'http://localhost:3000',
    changeOrigin: true
  }
}
```

### 2. 数据库连接失败

**错误信息**:
```
Error: connect ECONNREFUSED (MySQL)
或
Error: SQLITE_CANTOPEN: unable to open database file
```

**解决方案**:

**方式 A: 使用 SQLite（推荐，无需配置）**

```bash
# 编辑 backend/.env
DB_TYPE=sqlite
DB_PATH=./data/app.db

# 重启后端服务
```

**方式 B: 配置 MySQL**

```bash
# 编辑 backend/.env
DB_TYPE=mysql
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=virtual_host

# 创建数据库
mysql -u root -p
CREATE DATABASE virtual_host;
exit;

# 重启后端服务
```

### 3. 授权码无效

**错误信息**:
```
授权码无效或已禁用
```

**解决方案**:

```bash
# 1. 确认已创建子域名和 FTP 账号
# 登录管理后台 → 子域名管理 → 添加子域名

# 2. 获取授权码
# 授权码 = 域名的 MD5 值

# 计算授权码（示例）
echo -n "test.example.com" | md5sum
# 或在线计算: https://www.md5hashgenerator.com/

# 3. 使用完整的 32 位 MD5 值作为授权码
```

### 4. SSH 连接失败

**错误信息**:
```
Error: All configured authentication methods failed
或
Error: connect ETIMEDOUT
```

**解决方案**:

```bash
# 1. 检查服务器配置
# 登录管理后台 → 服务器管理 → 测试连接

# 2. 确认 SSH 信息正确
# - IP 地址
# - 端口（通常是 22）
# - 用户名
# - 密码

# 3. 测试 SSH 连接
ssh username@server_ip -p 22

# 4. 检查防火墙
# 确保服务器防火墙开放 SSH 端口
```

### 5. 文件上传超时

**错误信息**:
```
Error: timeout of 600000ms exceeded
```

**解决方案**:

**方式 A: 使用压缩包上传**
```bash
# 1. 压缩文件
zip -r website.zip .

# 2. 上传压缩包（只需上传 1 个文件）

# 3. 在线解压
```

**方式 B: 增加超时时间**
```javascript
// 编辑 backend/server.js
app.use((req, res, next) => {
  req.setTimeout(1800000); // 30 分钟
  res.setTimeout(1800000);
  next();
});
```

### 6. 空间不足

**错误信息**:
```
空间不足，已用 XXX MB，限制 XXX MB
```

**解决方案**:

```bash
# 1. 清理不需要的文件
# 登录文件管理 → 删除旧文件

# 2. 增加空间配额
# 登录管理后台 → 子域名管理 → 编辑 → 修改空间大小

# 3. 使用压缩包上传（减少传输大小）
```

### 7. 解压失败

**错误信息**:
```
解压失败: unzip: command not found
```

**解决方案**:

```bash
# 在服务器上安装解压工具

# Ubuntu/Debian
sudo apt-get update
sudo apt-get install unzip p7zip-full

# CentOS/RHEL
sudo yum install unzip p7zip

# 验证安装
unzip -v
```

### 8. 权限错误

**错误信息**:
```
Error: EACCES: permission denied
```

**解决方案**:

```bash
# 在服务器上设置正确的权限

# 设置目录权限
chmod 755 /home/www/your-domain

# 设置文件权限
find /home/www/your-domain -type f -exec chmod 644 {} \;

# 设置所有者
chown -R www:www /home/www/your-domain
```

---

## 🔧 开发环境配置

### 完整启动流程

```bash
# 1. 克隆项目
git clone <repository-url>
cd virtual-host-manager

# 2. 配置后端
cd backend
npm install
cp .env.example .env
# 编辑 .env 配置数据库等信息
nano .env

# 3. 初始化管理员
node scripts/init-admin.js

# 4. 启动后端（新终端）
npm run dev

# 5. 配置前端（新终端）
cd ../frontend
npm install

# 6. 启动前端
npm run dev

# 7. 访问系统
# 前端: http://localhost:5173
# 后端: http://localhost:6002
```

### 端口配置说明

| 服务 | 默认端口 | 配置文件 |
|------|---------|---------|
| 后端 API | 6002 | backend/.env (PORT) |
| 前端开发 | 5173 | frontend/vite.config.js (server.port) |
| 前端代理 | 6002 | frontend/vite.config.js (proxy.target) |

**重要**: 前端代理的 target 必须与后端 PORT 一致！

---

## 🐛 调试技巧

### 1. 查看后端日志

```bash
cd backend
npm run dev

# 观察控制台输出
# 查看错误信息和请求日志
```

### 2. 查看前端控制台

```
浏览器 → F12 → Console
查看 JavaScript 错误和网络请求
```

### 3. 查看网络请求

```
浏览器 → F12 → Network
查看 API 请求和响应
筛选 XHR/Fetch 请求
```

### 4. 测试 API 接口

```bash
# 使用 curl 测试
curl http://localhost:6002/api/health

# 测试授权
curl -X POST http://localhost:6002/api/upload/auth \
  -H "Content-Type: application/json" \
  -d '{"auth_code":"your_auth_code"}'
```

### 5. 检查数据库

```bash
# SQLite
cd backend
sqlite3 data/app.db
.tables
SELECT * FROM domains;
.exit

# MySQL
mysql -u root -p
USE virtual_host;
SHOW TABLES;
SELECT * FROM domains;
exit;
```

---

## 📊 性能优化

### 1. 上传速度慢

**解决方案**:
- 使用压缩包上传（速度提升 15 倍）
- 使用 FTP 客户端（FileZilla）
- 增加并发上传数量

### 2. 服务器响应慢

**解决方案**:
```javascript
// 增加 Node.js 内存限制
// package.json
"scripts": {
  "start": "node --max-old-space-size=4096 server.js"
}
```

### 3. 数据库查询慢

**解决方案**:
```sql
-- 添加索引
CREATE INDEX idx_domains_domain ON domains(domain);
CREATE INDEX idx_subdomains_domain_id ON subdomains(domain_id);
CREATE INDEX idx_ftp_accounts_subdomain_id ON ftp_accounts(subdomain_id);
```

---

## 📞 获取帮助

### 1. 查看日志

```bash
# 后端日志
cd backend
npm run dev

# 查看错误堆栈
```

### 2. 检查配置

```bash
# 检查环境变量
cd backend
cat .env

# 检查前端配置
cd frontend
cat vite.config.js
```

### 3. 联系支持

微信: feiyu3305  
服务时间: 周一至周日 9:00-22:00

提供以下信息：
- 错误信息截图
- 控制台日志
- 操作步骤
- 系统环境（操作系统、Node.js 版本）

---

## ✅ 快速检查清单

上传失败时，按顺序检查：

- [ ] 后端服务是否运行（`lsof -i :6002`）
- [ ] 前端服务是否运行（`lsof -i :5173`）
- [ ] 端口配置是否一致
- [ ] 数据库连接是否正常
- [ ] 授权码是否正确
- [ ] SSH 连接是否正常
- [ ] 剩余空间是否充足
- [ ] 网络连接是否正常

---

**相关文档**:
- [README.md](README.md) - 项目主文档
- [FTP-UPLOAD-GUIDE.md](FTP-UPLOAD-GUIDE.md) - 上传指南
- [QUICK-UPLOAD-GUIDE.md](QUICK-UPLOAD-GUIDE.md) - 快速上传指南
