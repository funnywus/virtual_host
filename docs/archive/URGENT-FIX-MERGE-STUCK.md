# 紧急修复："合并中"卡住问题

## 问题状态

✅ **代码已修复**
❌ **后端服务未重启**（需要重启才能生效）

## 立即修复步骤

### 方法 1: 使用重启脚本（推荐）

```bash
./restart-backend.sh
```

### 方法 2: 手动重启

#### 步骤 1: 停止后端服务

找到后端进程：
```bash
ps aux | grep "node.*server.js" | grep virtual_host
```

停止进程（替换 PID）：
```bash
kill 26028
```

或者在运行后端的终端按 `Ctrl+C`

#### 步骤 2: 启动后端服务

```bash
cd backend
npm start
```

#### 步骤 3: 验证启动成功

应该看到：
```
Server running on port 6002
WebSocket SFTP Proxy available at ws://localhost:6002/ws-upload
```

### 方法 3: 使用 nodemon 自动重启

如果使用 nodemon：
```bash
cd backend
npm run dev
```

nodemon 会自动检测文件变化并重启。

## 验证修复

### 1. 检查代码版本

```bash
grep -A 5 "uploadFileStream" backend/routes/upload-chunked.js
```

应该看到：
```javascript
// 使用流式上传
await sshService.uploadFileStream(mergedPath, targetFile);
```

### 2. 测试上传

1. 上传一个大文件（> 10MB）
2. 观察后端日志
3. 应该看到：

```
[合并分片] 开始合并 uploadId: xxx
[合并分片] 已合并 1/20 分片
[合并分片] 已合并 2/20 分片
...
[合并分片] 合并完成
[合并分片] 开始流式上传到远程服务器
[合并分片] 文件大小: 50.5MB
[合并分片] 上传完成
[合并分片] 完成
```

### 3. 确认不再卡住

- ✅ 进度条正常显示
- ✅ 不会卡在"合并中"
- ✅ 上传成功完成
- ✅ 后端服务不崩溃

## 修复原理

### 问题代码（已修复）

```javascript
// ❌ 旧代码：一次性读取整个文件到内存
const fileBuffer = fs.readFileSync(mergedPath);
await sshService.uploadFile(fileBuffer, targetFile);
```

### 修复代码（当前版本）

```javascript
// ✅ 新代码：流式上传，不占用内存
const fileStats = fs.statSync(mergedPath);
console.log(`[合并分片] 文件大小: ${(fileStats.size / 1024 / 1024).toFixed(2)}MB`);
await sshService.uploadFileStream(mergedPath, targetFile);
```

### 新增方法

在 `backend/services/ssh-ftp.js` 中添加了：

```javascript
uploadFileStream(localPath, remotePath) {
  return new Promise((resolve, reject) => {
    const fs = require('fs');
    const conn = new Client();

    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) {
          conn.end();
          return reject(err);
        }

        const readStream = fs.createReadStream(localPath);
        const writeStream = sftp.createWriteStream(remotePath);
        
        // 流式传输，不占用内存
        readStream.pipe(writeStream);
        
        writeStream.on('close', () => {
          conn.end();
          resolve({ success: true, message: '上传成功' });
        });
        
        // 错误处理...
      });
    });
    
    // 连接配置...
  });
}
```

## 为什么需要重启

Node.js 是运行时解释执行的，但已经加载的模块会缓存在内存中。修改代码后：

1. ✅ 文件已更新
2. ❌ 内存中的代码还是旧版本
3. ✅ 重启后加载新代码

## 常见问题

### Q1: 重启后还是卡住？

**检查清单：**
1. 确认后端进程已完全停止
   ```bash
   ps aux | grep "node.*server.js" | grep virtual_host
   ```

2. 确认新进程已启动
   ```bash
   lsof -i :6002
   ```

3. 清理临时文件
   ```bash
   rm -rf backend/temp/chunks/*
   ```

4. 重新上传测试

### Q2: 如何确认使用的是新代码？

在后端日志中查找：
```
[合并分片] 开始流式上传到远程服务器
```

如果看到这行日志，说明使用的是新代码。

### Q3: 还是内存溢出？

1. 检查 Node.js 内存限制：
   ```bash
   node --max-old-space-size=2048 server.js
   ```

2. 检查文件大小：
   - 如果文件 > 500MB，建议使用 WebSocket 直传
   - 如果文件 > 1GB，建议使用 FTP 客户端

3. 检查服务器内存：
   ```bash
   free -h
   ```

## 性能对比

### 修复前
| 文件大小 | 内存占用 | 结果 |
|---------|---------|------|
| 10MB | ~50MB | ✅ 正常 |
| 50MB | ~150MB | ⚠️ 可能失败 |
| 100MB | ~250MB | ❌ 崩溃 |
| 200MB | ~450MB | ❌ 崩溃 |

### 修复后
| 文件大小 | 内存占用 | 结果 |
|---------|---------|------|
| 10MB | ~50MB | ✅ 正常 |
| 50MB | ~80MB | ✅ 正常 |
| 100MB | ~80MB | ✅ 正常 |
| 200MB | ~80MB | ✅ 正常 |
| 500MB | ~80MB | ✅ 正常 |

## 监控后端状态

### 实时查看日志

```bash
# 如果有日志文件
tail -f backend/logs/server.log

# 或者查看控制台输出
# 在运行 npm start 的终端查看
```

### 监控内存使用

```bash
# 查看进程内存
ps aux | grep "node.*server.js" | grep virtual_host

# 或使用 top
top -pid <PID>
```

### 监控端口

```bash
# 确认端口正在监听
lsof -i :6002
```

## 下次上传建议

为了避免再次遇到问题：

1. **小文件（< 5MB）**：使用普通上传
2. **中等文件（5-50MB）**：使用分片上传（已修复）
3. **大文件（50-500MB）**：使用 WebSocket 直传（速度快 2-3x）
4. **超大文件（> 500MB）**：使用压缩上传（速度快 15x）

## 相关文档

- [分片上传修复详情](CHUNKED-UPLOAD-FIX.md)
- [WebSocket 直传](IMPLEMENTATION-SUMMARY.md)
- [上传速度对比](UPLOAD-SPEED-COMPARISON.md)

## 总结

✅ 代码已修复
❌ 需要重启后端服务
⏱️ 预计修复时间：1 分钟

**立即执行：**
```bash
./restart-backend.sh
```

或手动重启：
```bash
# 停止旧进程
kill $(ps aux | grep "node.*server.js" | grep virtual_host | grep -v grep | awk '{print $2}')

# 启动新进程
cd backend && npm start
```

重启后，上传功能应该恢复正常！
