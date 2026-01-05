# 虚拟主机管理系统 (Virtual Host Manager)

一个功能完整的虚拟主机管理系统，支持多服务器管理、DNS 解析、SSL 证书、FTP 文件管理等功能。

## 技术栈

**后端**
- Node.js + Express
- SQLite 数据库
- JWT 身份认证
- SSH2 远程连接

**前端**
- Vue 3 + Vite
- Element Plus UI
- Pinia 状态管理
- CodeMirror 代码编辑器
- Xterm.js 终端模拟

## 功能特性

- 🖥️ **服务器管理** - 添加、编辑、删除服务器，支持 SSH 连接
- 🌐 **域名管理** - 主域名和子域名管理，支持标签分类
- 📡 **DNS 解析** - 支持阿里云和腾讯云 DNS 自动解析
- 🔒 **SSL 证书** - 自动申请和续期 SSL 证书，定时检查过期状态
- 📁 **FTP 文件管理** - 在线文件浏览、上传、下载、编辑
- ⚙️ **Nginx 配置** - 虚拟主机配置管理
- 👥 **用户管理** - 管理员和普通用户权限控制
- ⏰ **自动化任务** - 证书状态检查、过期子域名自动停用

## 快速开始

### 环境要求

- Node.js >= 16
- npm 或 yarn

### 安装

```bash
# 克隆项目
git clone <repository-url>
cd <project-folder>

# 安装后端依赖
cd backend
npm install

# 安装前端依赖
cd ../frontend
npm install
```

### 配置

编辑 `backend/.env` 文件：

```env
PORT=3000
JWT_SECRET=your_jwt_secret_key_change_this
DB_PATH=./data/app.db

# 阿里云 DNS 配置（可选）
ALIYUN_ACCESS_KEY=your_access_key
ALIYUN_SECRET_KEY=your_secret_key
ALIYUN_REGION=cn-hangzhou
```

### 初始化管理员

```bash
cd backend
node scripts/init-admin.js [用户名] [密码] [邮箱]

# 使用默认值: admin / admin123 / admin@example.com
node scripts/init-admin.js
```

### 运行

**开发模式**

```bash
# 启动后端 (端口 3000)
cd backend
npm run dev

# 启动前端 (另开终端，端口 5173)
cd frontend
npm run dev
```

**生产模式**

```bash
# 构建前端
cd frontend
npm run build

# 将构建产物复制到后端 public 目录
cp -r dist/* ../backend/public/

# 启动后端
cd ../backend
npm start
```

### 访问

- 用户页面: http://localhost:3000/
- 后台管理: http://localhost:3000/admin-jm

## 项目结构

```
├── backend/                 # 后端服务
│   ├── data/               # SQLite 数据库
│   ├── db/                 # 数据库配置
│   ├── middleware/         # 中间件 (JWT 认证)
│   ├── routes/             # API 路由
│   │   ├── auth.js         # 认证接口
│   │   ├── servers.js      # 服务器管理
│   │   ├── dns.js          # DNS 解析
│   │   ├── ftp.js          # FTP 文件管理
│   │   ├── nginx.js        # Nginx 配置
│   │   ├── ssl.js          # SSL 证书
│   │   ├── tags.js         # 标签管理
│   │   ├── upload.js       # 文件上传
│   │   └── users.js        # 用户管理
│   ├── services/           # 业务服务
│   │   ├── aliyun-dns.js   # 阿里云 DNS
│   │   ├── tencent-dns.js  # 腾讯云 DNS
│   │   ├── nginx-config.js # Nginx 配置生成
│   │   ├── ssh-ftp.js      # SSH/FTP 连接
│   │   └── ssl-cert.js     # SSL 证书管理
│   ├── scripts/            # 脚本
│   └── server.js           # 入口文件
│
└── frontend/               # 前端应用
    ├── src/
    │   ├── api/            # API 请求
    │   ├── components/     # 组件
    │   ├── layouts/        # 布局
    │   ├── router/         # 路由
    │   ├── stores/         # Pinia 状态
    │   ├── utils/          # 工具函数
    │   └── views/          # 页面
    └── vite.config.js      # Vite 配置
```

## API 接口

| 模块 | 路径 | 说明 |
|------|------|------|
| 认证 | `/api/auth` | 登录、Token 刷新 |
| 服务器 | `/api/servers` | 服务器 CRUD |
| DNS | `/api/dns` | DNS 记录管理 |
| FTP | `/api/ftp` | 文件浏览、上传、下载 |
| Nginx | `/api/nginx` | 虚拟主机配置 |
| SSL | `/api/ssl` | 证书申请、续期 |
| 标签 | `/api/tags` | 标签管理 |
| 用户 | `/api/users` | 用户管理 |
| 上传 | `/api/upload` | 文件上传 |

## License

MIT
