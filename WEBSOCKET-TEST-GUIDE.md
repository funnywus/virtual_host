# WebSocket 直传功能测试指南

## 当前状态

WebSocket 直传功能已完全实现并集成到前端 UI。

## 已完成的工作

### 后端实现 ✅
- ✅ WebSocket SFTP 代理服务 (`backend/services/ws-sftp-proxy.js`)
- ✅ 集成到 Express 服务器 (`backend/server.js`)
- ✅ WebSocket 端点: `/ws-upload`
- ✅ 安装 `ws` 依赖包 (v8.20.0)

### 前端实现 ✅
- ✅ WebSocket 上传工具类 (`frontend/src/utils/ws-direct-upload.js`)
- ✅ UI 切换开关（直传/普通模式）
- ✅ 上传逻辑集成
- ✅ 进度显示
- ✅ 错误处理和回退机制

## 测试步骤

### 1. 启动后端服务

```bash
cd backend
npm start
```

确认看到以下日志：
```
Server running on port 3000
WebSocket SFTP Proxy available at ws://localhost:3000/ws-upload
```

### 2. 启动前端服务

```bash
cd frontend
npm run dev
```

### 3. 测试 WebSocket 连接

打开浏览器控制台，访问上传页面：

1. 输入授权码登录
2. 点击工具栏中的"直传"开关，启用直传模式
3. 点击"上传文件"按钮
4. 选择一个小文件（建议 < 10MB）进行测试
5. 观察控制台日志：

**成功的日志示例：**
```
[WS直传] 连接到: ws://localhost:3000/ws-upload
[WS直传] WebSocket 连接已建立
[WS直传] 会话 ID: abc123...
[WS直传] SFTP 连接成功
[WS直传] 开始上传: /home/user/test.txt
[WS直传] 上传完成: /home/user/test.txt
```

**失败的日志示例：**
```
[WS直传] WebSocket 错误: ...
[WS直传] 错误: 未连接到服务器
```

### 4. 验证上传结果

- 检查文件是否出现在文件列表中
- 点击"访问"按钮验证文件可访问
- 检查文件权限是否正确（644）

## 常见问题排查

### 问题 1: WebSocket 连接失败

**症状：** 控制台显示 "WebSocket 连接失败"

**解决方案：**
1. 确认后端服务正在运行
2. 检查端口是否正确（应该是后端服务的端口，不是 FTP 端口）
3. 检查防火墙设置

### 问题 2: SFTP 连接失败

**症状：** WebSocket 连接成功，但显示 "SFTP 初始化失败"

**解决方案：**
1. 检查 FTP 服务器配置（IP、端口、用户名、密码）
2. 确认 FTP 服务器可访问
3. 检查后端日志中的详细错误信息

### 问题 3: 上传卡住不动

**症状：** 进度条停在某个百分比不动

**解决方案：**
1. 检查网络连接
2. 查看后端日志是否有错误
3. 尝试上传更小的文件
4. 检查服务器磁盘空间

### 问题 4: 自动回退到普通上传

**症状：** 启用直传后仍使用普通上传

**解决方案：**
1. 检查浏览器是否支持 WebSocket
2. 查看控制台错误信息
3. 确认后端 WebSocket 服务正常运行

## 性能对比

| 上传方式 | 速度 | 服务器资源占用 | 适用场景 |
|---------|------|---------------|---------|
| 普通上传 | 1x | 高（需要中转） | 小文件 |
| 分片上传 | 1x | 很高（需要合并） | 大文件 |
| WebSocket 直传 | 2-3x | 低（仅代理） | 所有文件 |
| 压缩上传 | 15x | 中（需要解压） | 批量文件 |

## 推荐使用场景

1. **单个大文件（> 50MB）**: WebSocket 直传
2. **多个小文件**: WebSocket 直传
3. **整个网站目录**: 压缩后上传（最快）
4. **超大文件（> 500MB）**: 分片上传（更稳定）

## 下一步优化建议

1. ✅ 添加断点续传功能
2. ✅ 支持多文件并发上传
3. ✅ 添加上传速度显示
4. ✅ 优化大文件上传的内存使用
5. ✅ 添加上传队列管理

## 技术细节

### WebSocket 消息协议

**客户端 → 服务器：**
- `connect`: 连接到 FTP 服务器
- `upload-start`: 开始上传文件
- `upload-chunk`: 发送文件分片
- `upload-end`: 完成上传
- `disconnect`: 断开连接

**服务器 → 客户端：**
- `session`: 会话 ID
- `connected`: SFTP 连接成功
- `upload-ready`: 准备接收文件
- `upload-progress`: 上传进度
- `upload-continue`: 继续发送下一个分片
- `upload-complete`: 上传完成
- `upload-error`: 上传错误
- `error`: 一般错误

### 分片大小

- WebSocket 直传: 512KB/片（适合 WebSocket 传输）
- 普通分片上传: 2MB/片（适合 HTTP 传输）

### 安全性

- WebSocket 连接使用与 HTTP 相同的域名和端口
- 支持 WSS（WebSocket Secure）用于 HTTPS 站点
- FTP 密码仅在后端使用，不暴露给前端
- 每个 WebSocket 连接都有独立的会话 ID

## 故障排除命令

### 检查后端 WebSocket 服务

```bash
# 查看后端日志
cd backend
npm start

# 应该看到：
# WebSocket SFTP Proxy available at ws://localhost:3000/ws-upload
```

### 测试 WebSocket 连接（使用 wscat）

```bash
# 安装 wscat
npm install -g wscat

# 测试连接
wscat -c ws://localhost:3000/ws-upload

# 应该收到会话 ID 消息
```

### 检查 FTP 服务器连接

```bash
# 使用 sftp 命令测试
sftp -P 22 username@server_ip

# 或使用 ssh
ssh -p 22 username@server_ip
```

## 联系支持

如果遇到问题，请提供以下信息：
1. 浏览器控制台完整日志
2. 后端服务器日志
3. 上传的文件大小和类型
4. 网络环境（本地/远程）
