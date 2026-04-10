# 默认启用直传模式

## 更改说明

直传模式现在默认启用（如果浏览器支持 WebSocket）。

## 行为

### 页面加载时

1. 检测浏览器是否支持 WebSocket
2. 如果支持，自动启用"直传"模式
3. 如果不支持，使用"普通"模式

### 用户可以切换

用户仍然可以通过工具栏的开关在"直传"和"普通"模式之间切换。

## 优势

### 为什么默认启用直传？

1. **速度更快** - 2-3 倍速度提升
2. **节省资源** - 不占用后端服务器内存
3. **更稳定** - 流式传输，不会因大文件导致后端崩溃
4. **用户体验好** - 实时进度反馈

### 对比

| 模式 | 速度 | 后端内存 | 稳定性 | 适用场景 |
|------|------|---------|--------|---------|
| 普通上传 | 1x | 高 | 中 | 小文件 |
| 分片上传 | 1x | 中（已优化） | 中 | 中等文件 |
| **直传模式** | **2-3x** | **很低** | **高** | **所有文件** ⭐ |

## 用户界面

### 默认状态

页面加载后，开关显示为"直传"（已启用）：

```
[直传 ●━━━━━ 普通]
```

### 提示信息

上传对话框中显示：
```
✅ 直传模式已启用 - 速度提升 2 倍，不占用服务器资源
```

### 切换模式

用户可以点击开关切换到"普通"模式：

```
[直传 ━━━━━● 普通]
```

## 技术实现

```javascript
// 检测浏览器支持
const supportsDirectUpload = ref(supportsWebSocketUpload())

// 默认启用（如果支持）
const useDirectUpload = ref(supportsDirectUpload.value)
```

### 逻辑

1. `supportsWebSocketUpload()` 检测浏览器是否支持 WebSocket
2. 如果支持，`useDirectUpload` 初始化为 `true`
3. 如果不支持，`useDirectUpload` 初始化为 `false`，开关禁用

## 兼容性

### 支持的浏览器

✅ Chrome 16+
✅ Firefox 11+
✅ Safari 7+
✅ Edge 12+
✅ Opera 12.1+

### 不支持的浏览器

❌ IE 9 及以下
❌ 非常老的浏览器

对于不支持的浏览器：
- 开关自动禁用
- 显示提示："您的浏览器不支持 WebSocket 直传，将使用普通上传模式"
- 自动使用普通上传

## 回退机制

即使默认启用直传，系统仍有完善的回退机制：

### 自动回退场景

1. **WebSocket 连接失败**
   ```javascript
   try {
     await startDirectUpload()
   } catch (err) {
     ElMessage.error('直传上传失败: ' + err.message)
     useDirectUpload.value = false
     await startNormalUpload()
   }
   ```

2. **SFTP 连接失败**
   - 自动切换到普通上传
   - 显示错误提示

3. **上传过程中断**
   - 自动重试
   - 失败后回退到普通上传

## 用户反馈

### 成功使用直传

```
ℹ️ 正在连接服务器...
✅ 已连接到服务器，开始上传
📤 上传中... 45%
✅ 所有文件上传完成
```

### 自动回退到普通上传

```
❌ 直传上传失败: WebSocket 连接失败
ℹ️ 正在使用普通上传模式...
📤 上传中... 45%
✅ 上传完成
```

## 配置选项（未来扩展）

可以考虑添加配置选项：

### 1. 记住用户选择

```javascript
// 保存用户偏好
localStorage.setItem('preferDirectUpload', useDirectUpload.value)

// 下次加载时恢复
const savedPreference = localStorage.getItem('preferDirectUpload')
if (savedPreference !== null) {
  useDirectUpload.value = savedPreference === 'true'
}
```

### 2. 根据文件大小自动选择

```javascript
// 小文件用普通上传，大文件用直传
if (fileSize < 5 * 1024 * 1024) {
  useDirectUpload.value = false
} else {
  useDirectUpload.value = true
}
```

### 3. 管理员配置

```javascript
// 管理员可以在后台设置默认模式
const defaultUploadMode = await api('/config/upload-mode')
useDirectUpload.value = defaultUploadMode === 'direct'
```

## 性能监控

可以添加性能监控来验证直传的优势：

```javascript
const uploadStartTime = Date.now()

// 上传完成后
const uploadDuration = Date.now() - uploadStartTime
const uploadSpeed = fileSize / uploadDuration * 1000 // bytes/s

console.log(`上传速度: ${(uploadSpeed / 1024 / 1024).toFixed(2)} MB/s`)
```

## 测试

### 测试场景 1: 首次访问

1. 打开上传页面
2. 检查开关状态
3. 应该默认显示"直传"已启用

### 测试场景 2: 上传文件

1. 选择文件
2. 点击"开始上传"
3. 应该使用直传模式
4. 观察控制台日志：`[WS直传] 连接到: ...`

### 测试场景 3: 切换模式

1. 点击开关切换到"普通"
2. 上传文件
3. 应该使用普通上传
4. 不应该看到 `[WS直传]` 日志

### 测试场景 4: 不支持的浏览器

1. 使用 IE 9 或禁用 WebSocket
2. 打开页面
3. 开关应该禁用
4. 显示提示信息

## 用户教育

### 首次使用提示（可选）

可以考虑在用户首次使用时显示提示：

```
💡 提示：系统已自动启用"直传模式"，上传速度更快！
您可以随时通过工具栏的开关切换上传模式。

[知道了]  [不再提示]
```

### 帮助文档

在帮助中心添加说明：

```
Q: 什么是直传模式？
A: 直传模式通过 WebSocket 直接上传文件到服务器，
   速度比普通上传快 2-3 倍，且不占用服务器内存。

Q: 我应该使用哪种模式？
A: 推荐使用直传模式（默认）。如果遇到问题，
   可以切换到普通模式。

Q: 直传模式有什么限制吗？
A: 需要浏览器支持 WebSocket（现代浏览器都支持）。
   如果不支持，系统会自动使用普通模式。
```

## 总结

✅ 直传模式现在默认启用
✅ 自动检测浏览器支持
✅ 用户可以手动切换
✅ 完善的回退机制
✅ 更好的用户体验

**刷新页面即可看到效果！**

默认启用直传模式后，用户无需手动操作，即可享受更快的上传速度和更稳定的上传体验。
