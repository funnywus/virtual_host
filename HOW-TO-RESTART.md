# 如何重启后端服务

## 问题

上传卡在"合并中"是因为代码已经修复，但后端服务还在运行旧代码。

## 解决方案

重启后端服务即可。

## 重启步骤

### 方法 1: 在运行后端的终端中重启

1. 找到运行 `npm start` 或 `npm run dev` 的终端窗口
2. 按 `Ctrl + C` 停止服务
3. 重新运行：
   ```bash
   cd backend
   npm start
   ```

### 方法 2: 使用脚本重启

在项目根目录运行：
```bash
./restart-backend.sh
```

### 方法 3: 手动查找并停止进程

#### 步骤 1: 查找后端进程

```bash
ps aux | grep server.js
```

找到类似这样的行：
```
funnywus  26028  0.0  0.2  node --max-old-space-size=2048 server.js
```

记住进程 ID（第二列的数字，如 26028）

#### 步骤 2: 停止进程

```bash
kill 26028
```

（替换 26028 为你的进程 ID）

#### 步骤 3: 启动新进程

```bash
cd backend
npm start
```

## 验证重启成功

启动后应该看到：
```
Server running on port 6002
WebSocket SFTP Proxy available at ws://localhost:6002/ws-upload
```

## 测试修复

1. 上传一个大文件（> 10MB）
2. 观察进度
3. 应该不会再卡在"合并中"
4. 上传应该正常完成

## 如果还是卡住

### 检查 1: 确认使用新代码

查看后端日志，应该看到：
```
[合并分片] 开始流式上传到远程服务器
[合并分片] 文件大小: XX.XMB
```

如果看到这些日志，说明使用的是新代码。

### 检查 2: 清理临时文件

```bash
rm -rf backend/temp/chunks/*
```

然后重新上传。

### 检查 3: 使用其他上传方式

如果分片上传还是有问题，可以：

1. **使用 WebSocket 直传**（推荐）
   - 在上传页面启用"直传"模式
   - 速度快 2-3 倍
   - 不占用后端内存

2. **使用压缩上传**（最快）
   - 将文件压缩成 .zip
   - 上传压缩包
   - 在服务器上解压
   - 速度快 15 倍

## 快速命令

### 一键重启（复制粘贴）

```bash
# 停止旧进程
pkill -f "node.*server.js.*virtual_host"

# 等待 2 秒
sleep 2

# 启动新进程
cd backend && npm start
```

### 检查服务状态

```bash
# 检查端口是否在监听
lsof -i :6002

# 检查进程是否运行
ps aux | grep server.js | grep -v grep
```

## 常见问题

### Q: 找不到后端进程？

A: 可能后端没有运行，直接启动即可：
```bash
cd backend
npm start
```

### Q: 端口被占用？

A: 查找占用端口的进程：
```bash
lsof -i :6002
```

然后停止该进程。

### Q: 权限不足？

A: 使用 sudo（不推荐）或检查文件权限：
```bash
ls -la backend/
```

## 总结

✅ 代码已修复
❌ 需要重启后端
⏱️ 重启时间：< 1 分钟

**最简单的方法：**
1. 找到运行后端的终端
2. 按 Ctrl+C
3. 运行 `npm start`

就这么简单！
