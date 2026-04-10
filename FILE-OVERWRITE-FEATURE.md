# 文件覆盖确认功能

## 功能说明

在上传文件时，如果文件已存在，系统会自动检测并提示用户选择如何处理。

## 功能特性

### 1. 单个文件冲突

当上传的单个文件已存在时，显示确认对话框：

```
文件 "index.html" 已存在，是否覆盖？

[覆盖]  [跳过]
```

- **覆盖**：替换现有文件
- **跳过**：不上传该文件

### 2. 批量文件冲突

当上传多个文件且有部分文件已存在时，显示批量处理对话框：

```
有 5 个文件已存在，如何处理？

[全部覆盖]  [全部跳过]  [X]
```

- **全部覆盖**：覆盖所有已存在的文件，上传所有文件
- **全部跳过**：跳过所有已存在的文件，只上传新文件
- **关闭 (X)**：取消本次上传操作

### 3. 支持的上传方式

✅ 点击选择文件
✅ 点击选择文件夹
✅ 拖拽文件
✅ 拖拽文件夹

## 使用场景

### 场景 1: 更新单个文件

1. 点击"上传文件"
2. 选择一个已存在的文件（如 index.html）
3. 系统提示："文件 'index.html' 已存在，是否覆盖？"
4. 点击"覆盖"完成更新

### 场景 2: 批量更新网站

1. 拖拽整个网站文件夹到上传区域
2. 系统检测到 10 个文件已存在
3. 系统提示："有 10 个文件已存在，如何处理？"
4. 点击"全部覆盖"更新所有文件

### 场景 3: 只上传新文件

1. 选择多个文件上传
2. 系统检测到 3 个文件已存在
3. 系统提示："有 3 个文件已存在，如何处理？"
4. 点击"全部跳过"只上传新文件
5. 系统提示："已跳过 3 个文件，添加了 7 个文件"

## 技术实现

### 文件检测逻辑

```javascript
// 检查文件是否存在
const exists = files.value.some(f => {
  if (f.type !== 'file') return false
  return f.name === fileName && currentPath.value === checkPath
})
```

### 单个文件处理

```javascript
try {
  await ElMessageBox.confirm(
    `文件 "${existingFiles[0].name}" 已存在，是否覆盖？`,
    '文件已存在',
    {
      type: 'warning',
      confirmButtonText: '覆盖',
      cancelButtonText: '跳过'
    }
  )
  // 用户选择覆盖
  uploadQueue.value.push(...allFiles)
} catch (e) {
  // 用户选择跳过
  const filesToAdd = allFiles.filter(f => !existingFiles.includes(f))
  uploadQueue.value.push(...filesToAdd)
}
```

### 批量文件处理

```javascript
try {
  await ElMessageBox.confirm(
    `有 ${existingFiles.length} 个文件已存在，如何处理？`,
    '批量文件冲突',
    {
      type: 'warning',
      distinguishCancelAndClose: true,
      confirmButtonText: '全部覆盖',
      cancelButtonText: '全部跳过'
    }
  )
  // 全部覆盖
  uploadQueue.value.push(...allFiles)
} catch (action) {
  if (action === 'cancel') {
    // 全部跳过
    const filesToAdd = allFiles.filter(f => !existingFiles.includes(f))
    uploadQueue.value.push(...filesToAdd)
  }
}
```

## 用户反馈

系统会根据用户的选择显示相应的提示信息：

### 覆盖操作
```
✅ 已添加 10 个文件（将覆盖已存在的文件）
```

### 跳过操作
```
ℹ️ 已跳过 3 个文件，添加了 7 个文件
```

### 取消操作
```
ℹ️ 已取消添加文件
```

## 注意事项

### 1. 检测范围

- 只检测当前目录的文件
- 子目录中的文件不会触发冲突检测（会自动创建目录结构）

### 2. 文件夹上传

上传文件夹时：
- 如果根目录文件已存在，会提示冲突
- 子目录中的文件会自动创建目录结构，不提示冲突

### 3. 性能考虑

- 检测逻辑在前端执行，不增加服务器负担
- 大量文件时检测速度快（< 100ms）

## 示例流程

### 示例 1: 更新网站首页

```
1. 用户修改了本地的 index.html
2. 拖拽 index.html 到上传区域
3. 系统检测到文件已存在
4. 弹窗提示："文件 'index.html' 已存在，是否覆盖？"
5. 用户点击"覆盖"
6. 文件添加到上传队列
7. 点击"开始上传"完成更新
```

### 示例 2: 批量更新图片

```
1. 用户选择 20 张图片上传
2. 系统检测到其中 8 张图片已存在
3. 弹窗提示："有 8 个文件已存在，如何处理？"
4. 用户点击"全部覆盖"
5. 所有 20 张图片添加到队列
6. 点击"开始上传"完成更新
```

### 示例 3: 只添加新文件

```
1. 用户拖拽整个项目文件夹
2. 系统检测到 15 个文件已存在
3. 弹窗提示："有 15 个文件已存在，如何处理？"
4. 用户点击"全部跳过"
5. 系统提示："已跳过 15 个文件，添加了 5 个文件"
6. 只有 5 个新文件添加到队列
```

## 配置选项（未来扩展）

可以考虑添加以下配置选项：

### 1. 默认行为设置

```javascript
// 用户可以设置默认行为
const defaultOverwriteBehavior = ref('ask') // 'ask' | 'overwrite' | 'skip'
```

### 2. 记住选择

```javascript
// 在当前会话中记住用户的选择
const rememberChoice = ref(false)
```

### 3. 文件版本管理

```javascript
// 保留旧版本文件
const keepBackup = ref(false)
// 备份文件命名：index.html.bak.20260406
```

## 相关功能

- [文件上传功能](README.md)
- [批量上传优化](FTP-UPLOAD-GUIDE.md)
- [WebSocket 直传](IMPLEMENTATION-SUMMARY.md)

## 总结

文件覆盖确认功能提供了友好的用户体验，避免意外覆盖重要文件。支持单个和批量文件的智能处理，让用户完全掌控上传过程。
