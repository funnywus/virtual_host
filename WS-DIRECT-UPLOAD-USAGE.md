# WebSocket 直传使用指南

## ✅ 已实现功能

### 后端
- ✅ WebSocket SFTP 代理服务
- ✅ 流式文件传输
- ✅ 实时进度反馈
- ✅ 多文件队列管理
- ✅ 自动权限设置

### 前端
- ✅ WebSocket 上传工具类
- ✅ 分片上传支持
- ✅ 进度显示
- ✅ 错误处理

## 🚀 使用方法

### 1. 安装依赖

```bash
cd backend
npm install ws
```

### 2. 启动后端服务

```bash
cd backend
npm run dev
```

后端会自动启动 WebSocket 服务在 `ws://localhost:6002/ws-upload`

### 3. 前端使用

在上传页面会自动检测是否支持 WebSocket 直传，如果支持会显示"直传模式"开关。

#### 手动使用示例

```javascript
import { WebSocketDirectUploader } from '@/utils/ws-direct-upload'

// 创建上传器
const uploader = new WebSocketDirectUploader({
  host: 'server_ip',
  port: 22,
  username: 'ftp_username',
  password: 'ftp_password',
  onProgress: (progress) => {
    console.log(`进度: ${progress.progress}%`)
  },
  onSuccess: (result) => {
    console.log('上传成功:', result.remotePath)
  },
  onError: (error) => {
    console.error('上传失败:', error)
  }
})

// 连接到服务器
await uploader.connect()

// 上传文件
await uploader.uploadFile(file, '/home/www/index.html')

// 断开连接
uploader.disconnect()
```

## 📊 性能对比

### 传统方式（经过后端缓存）

```
浏览器 → 后端服务器（缓存） → 目标服务器
  ↓         ↓                    ↓
 慢      占用内存              二次传输
```

**100MB 文件**: 5 分钟

### WebSocket 直传（代理模式）

```
浏览器 ←WebSocket→ 后端代理 ←SFTP→ 目标服务器
  ↓                  ↓              ↓
 快            不缓存，只转发      一次传输
```

**100MB 文件**: 2-3 分钟

**速度提升**: 1.5-2x ⚡

## 🔧 配置说明

### 后端配置

WebSocket 服务会自动在 HTTP 服务器上启动，无需额外配置。

### 前端配置

前端会自动检测 WebSocket 支持，无需手动配置。

## ⚠️ 注意事项

### 1. 浏览器兼容性

WebSocket 直传需要浏览器支持 WebSocket API（所有现代浏览器都支持）。

### 2. 网络稳定性

WebSocket 连接对网络稳定性要求较高，如果网络不稳定建议使用传统上传方式。

### 3. 文件大小限制

- 单个文件建议 < 500MB
- 超大文件建议使用 FTP 客户端

### 4. 并发限制

WebSocket 直传一次只能上传一个文件，多个文件会自动排队。

## 🐛 故障排查

### 问题 1: WebSocket 连接失败

**错误**: `WebSocket connection failed`

**解决方案**:
1. 检查后端服务是否运行
2. 检查防火墙是否开放端口
3. 检查浏览器控制台错误信息

### 问题 2: 上传中断

**错误**: `Connection closed`

**解决方案**:
1. 检查网络连接
2. 重新上传
3. 使用传统上传方式

### 问题 3: 权限错误

**错误**: `Permission denied`

**解决方案**:
1. 检查 SSH 用户权限
2. 检查目标目录权限
3. 联系管理员

## 💡 最佳实践

### 1. 选择合适的上传方式

| 场景 | 推荐方式 | 原因 |
|------|---------|------|
| 首次部署 | 压缩包上传 | 最快（15x） |
| 单个大文件 | WebSocket 直传 | 快速（2x） |
| 多个小文件 | 文件夹拖拽 | 简单 |
| 频繁更新 | FileZilla | 增量同步 |

### 2. 网络不稳定时

使用传统上传方式，支持断点续传。

### 3. 超大文件

使用 FTP 客户端（FileZilla），更稳定可靠。

## 📈 性能优化

### 1. 调整分片大小

```javascript
// 在 ws-direct-upload.js 中
const CHUNK_SIZE = 512 * 1024; // 512KB（默认）

// 网络好时可以增大
const CHUNK_SIZE = 1024 * 1024; // 1MB

// 网络差时可以减小
const CHUNK_SIZE = 256 * 1024; // 256KB
```

### 2. 并发上传

WebSocket 直传目前不支持并发，如需并发请使用传统方式。

## 🔐 安全说明

### 1. 密码传输

密码通过 WebSocket 传输，建议使用 WSS（WebSocket Secure）。

### 2. 生产环境配置

```javascript
// 使用 WSS
const wsUrl = `wss://${window.location.hostname}/ws-upload`;
```

需要配置 HTTPS 和 WSS 证书。

## 📞 技术支持

微信: feiyu3305  
服务时间: 周一至周日 9:00-22:00

## 📚 相关文档

- [前端直传方案](DIRECT-UPLOAD-GUIDE.md)
- [上传速度对比](UPLOAD-SPEED-COMPARISON.md)
- [故障排查指南](TROUBLESHOOTING.md)

---

**最后更新**: 2026-04-06
