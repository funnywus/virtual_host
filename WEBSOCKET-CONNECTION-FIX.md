# WebSocket 连接问题修复

## 问题

WebSocket 尝试连接到 `ws://localhost:5173/ws-upload`，但这是前端开发服务器的端口，不是后端服务器。

## 原因

前端 Vite 配置缺少 WebSocket 代理设置。

## 已修复

已在 `frontend/vite.config.js` 中添加 WebSocket 代理配置：

```javascript
server: {
  port: 5173,
  proxy: {
    '/api': {
      target: 'http://localhost:6002',
      changeOrigin: true
    },
    '/ws-upload': {
      target: 'ws://localhost:6002',  // 代理到后端
      ws: true,                        // 启用 WebSocket
      changeOrigin: true
    }
  }
}
```

## 修复步骤

### 1. 确认后端正在运行

```bash
cd backend
npm start
```

应该看到：
```
Server running on port 6002
WebSocket SFTP Proxy available at ws://localhost:6002/ws-upload
```

### 2. 重启前端开发服务器

**重要：必须重启前端才能应用新的 Vite 配置！**

```bash
# 停止当前的前端服务（Ctrl+C）
# 然后重新启动
cd frontend
npm run dev
```

### 3. 清除浏览器缓存并刷新

1. 打开浏览器开发者工具（F12）
2. 右键点击刷新按钮
3. 选择"清空缓存并硬性重新加载"

### 4. 测试连接

1. 登录上传页面
2. 打开浏览器控制台
3. 启用"直传"模式
4. 点击上传文件

**成功的日志：**
```
[WS直传] 连接到: ws://localhost:5173/ws-upload
[WS直传] WebSocket 连接已建立
[WS直传] 会话 ID: xxx
[WS直传] SFTP 连接成功
```

## 工作原理

```
浏览器 → ws://localhost:5173/ws-upload (前端开发服务器)
         ↓ (Vite 代理)
         ws://localhost:6002/ws-upload (后端服务器)
         ↓ (WebSocket SFTP 代理)
         SFTP 服务器
```

## 验证配置

### 检查后端是否运行

```bash
lsof -i :6002
```

应该看到 node 进程。

### 检查 WebSocket 端点

```bash
# 安装 wscat（如果没有）
npm install -g wscat

# 测试连接
wscat -c ws://localhost:6002/ws-upload
```

应该收到会话 ID 消息。

## 常见问题

### Q1: 前端重启后还是连不上？

**A**: 清除浏览器缓存，或使用无痕模式测试。

### Q2: 后端日志没有 WebSocket 消息？

**A**: 检查后端代码是否正确集成了 WebSocket 服务：

```javascript
// backend/server.js
const WebSocketSFTPProxy = require('./services/ws-sftp-proxy');
const server = http.createServer(app);
new WebSocketSFTPProxy(server);
server.listen(PORT, () => {
  console.log(`WebSocket SFTP Proxy available at ws://localhost:${PORT}/ws-upload`);
});
```

### Q3: 生产环境怎么配置？

**A**: 生产环境不需要 Vite 代理，前端会直接连接到后端：

```javascript
// 自动使用当前页面的 host
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${protocol}//${window.location.host}/ws-upload`;
```

## 端口说明

| 服务 | 端口 | 说明 |
|------|------|------|
| 前端开发服务器 | 5173 | Vite dev server |
| 后端服务器 | 6002 | Express + WebSocket |
| FTP 服务器 | 22 | SSH/SFTP |

## 下一步

配置修复后，按照 [快速开始指南](QUICK-START-WEBSOCKET.md) 测试上传功能。
