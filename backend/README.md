# 虚拟主机管理系统

基于 Node.js + SQLite + Vue 3 + Element Plus 的虚拟主机管理系统。

## 功能

- 用户注册/登录
- 服务器管理
- 虚拟主机管理（含FTP账号配置）
- 阿里云DNS解析
- 管理员用户管理

## 安装

```bash
npm install
```

## 配置

编辑 `.env` 文件：

```
PORT=3000
JWT_SECRET=your_jwt_secret_key
ALIYUN_ACCESS_KEY=your_access_key
ALIYUN_SECRET_KEY=your_secret_key
```

## 运行

```bash
# 开发模式
npm run dev

# 生产模式
npm start
```

## 初始化管理员

```bash
node scripts/init-admin.js [用户名] [密码] [邮箱]
# 默认: admin / admin123 / admin@example.com
```

## 访问

打开浏览器访问 http://localhost:3000
