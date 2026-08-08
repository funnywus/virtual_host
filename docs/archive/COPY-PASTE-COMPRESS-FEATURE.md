# 复制粘贴压缩功能

## 新增功能

### 1. ✅ 复制文件/文件夹
- 选中文件后点击"复制"按钮
- 或右键单个文件选择"复制"
- 文件被复制到剪贴板

### 2. ✅ 剪切文件/文件夹
- 选中文件后点击"剪切"按钮
- 或右键单个文件选择"剪切"
- 文件被剪切到剪贴板（移动操作）

### 3. ✅ 粘贴文件/文件夹
- 复制或剪切后，导航到目标目录
- 点击"粘贴"按钮
- 文件被复制或移动到当前目录

### 4. ✅ 压缩文件/文件夹
- 选中文件后点击"压缩"按钮
- 或右键单个文件选择"压缩"
- 输入压缩包名称（支持 .zip 和 .tar.gz）
- 自动压缩到当前目录

### 5. ✅ 解压文件（已有，增强）
- 右键压缩包选择"解压到当前目录"
- 支持 .zip, .tar.gz, .tar, .7z 格式
- 自动设置文件权限

## 使用场景

### 场景 1: 复制文件到其他目录
```
1. 在 /images 目录选中 logo.png
2. 点击"复制"
3. 导航到 /assets 目录
4. 点击"粘贴"
5. logo.png 被复制到 /assets/logo.png
```

### 场景 2: 移动文件
```
1. 在 /temp 目录选中多个文件
2. 点击"剪切"
3. 导航到 /backup 目录
4. 点击"粘贴"
5. 文件从 /temp 移动到 /backup
```

### 场景 3: 批量压缩
```
1. 选中多个文件和文件夹
2. 点击"压缩"
3. 输入 "backup.zip"
4. 所有文件被压缩到 backup.zip
```

### 场景 4: 解压并整理
```
1. 上传 website.zip
2. 右键选择"解压到当前目录"
3. 文件自动解压
4. 删除原压缩包（可选）
```

## 工具栏按钮

### 选中文件时显示
```
┌─────────────────────────────────────────────────┐
│ 已选 3 项 [复制] [剪切] [压缩] [删除] [取消选择] │
└─────────────────────────────────────────────────┘
```

### 剪贴板有内容时显示
```
┌──────────────────────────────┐
│ [粘贴 (3)] [清空剪贴板]      │
└──────────────────────────────┘
```

## 右键菜单

### 文件菜单
```
┌─────────────────┐
│ 🔗 访问地址      │
│ ✏️ 编辑          │
│ 👁️ 预览          │
├─────────────────┤
│ 📂 解压到当前目录 │ (仅压缩包)
│ 📦 压缩          │
│ 📋 复制          │
│ ✂️ 剪切          │
│ ✏️ 重命名        │
├─────────────────┤
│ 🗑️ 删除          │
└─────────────────┘
```

### 文件夹菜单
```
┌─────────────────┐
│ 📦 压缩          │
│ 📋 复制          │
│ ✂️ 剪切          │
│ ✏️ 重命名        │
├─────────────────┤
│ 🗑️ 删除          │
└─────────────────┘
```

## API 接口

### 1. 复制文件
```javascript
POST /api/upload/copy
{
  auth_code: "xxx",
  source_path: "images/logo.png",
  target_path: "assets/logo.png"
}
```

### 2. 剪切（移动）文件
```javascript
POST /api/upload/cut
{
  auth_code: "xxx",
  source_path: "temp/file.txt",
  target_path: "backup/file.txt"
}
```

### 3. 压缩文件
```javascript
POST /api/upload/compress
{
  auth_code: "xxx",
  paths: ["file1.txt", "folder1", "file2.txt"],
  archive_name: "backup.zip",
  format: "zip" // 或 "tar.gz"
}
```

### 4. 解压文件
```javascript
POST /api/upload/extract
{
  auth_code: "xxx",
  path: "backup.zip",
  target_dir: "" // 可选，默认当前目录
}
```

## 技术实现

### 前端状态管理
```javascript
// 剪贴板状态
clipboard = {
  files: [
    { name: 'logo.png', type: 'file', path: 'images/logo.png' },
    { name: 'styles', type: 'directory', path: 'css/styles' }
  ],
  operation: 'copy' // 或 'cut'
}
```

### 后端实现

#### 复制
```bash
cp -r "/path/to/source" "/path/to/target"
chmod -R 755 "/path/to/target"
chown -R www:www "/path/to/target"
```

#### 剪切
```bash
mv "/path/to/source" "/path/to/target"
```

#### 压缩
```bash
# ZIP 格式
cd "/home/dir" && zip -r "archive.zip" "file1" "folder1"

# TAR.GZ 格式
cd "/home/dir" && tar -czf "archive.tar.gz" "file1" "folder1"
```

#### 解压
```bash
# ZIP
cd "/target/dir" && unzip -o "/path/to/file.zip"

# TAR.GZ
cd "/target/dir" && tar -xzf "/path/to/file.tar.gz"

# TAR
cd "/target/dir" && tar -xf "/path/to/file.tar"

# 7Z
cd "/target/dir" && 7z x "/path/to/file.7z" -y
```

## 权限设置

### 解压后自动设置
```bash
# 目录权限 755
chmod -R 755 "/extract/dir"

# 文件权限 644
find "/extract/dir" -type f -exec chmod 644 {} \;

# 所有者 www
chown -R www:www "/extract/dir"
```

### 复制后自动设置
```bash
# 目录权限 755
chmod -R 755 "/target/path"

# 文件权限 644
find "/target/path" -type f -exec chmod 644 {} \;

# 所有者 www
chown -R www:www "/target/path"
```

## 错误处理

### 1. 空间不足
```javascript
if (targetSize > remainingSpace) {
  throw new Error('目标目录空间不足')
}
```

### 2. 文件已存在
```javascript
// 自动覆盖（使用 -o 参数）
unzip -o "file.zip"
cp -r "source" "target" // 自动覆盖
```

### 3. 权限不足
```javascript
if (!targetPath.startsWith(homeDir)) {
  throw new Error('无权访问该目录')
}
```

### 4. 格式不支持
```javascript
const supportedFormats = ['.zip', '.tar.gz', '.tar', '.7z']
if (!supportedFormats.includes(ext)) {
  throw new Error('不支持的压缩格式')
}
```

## 性能优化

### 1. 大文件压缩
```javascript
// 显示进度提示
const loading = ElMessage({
  message: '正在压缩文件...',
  duration: 0
})

// 压缩完成后关闭
loading.close()
```

### 2. 批量操作
```javascript
// 并发处理（谨慎使用）
for (const file of files) {
  await copyFile(file) // 串行，更稳定
}
```

### 3. 剪贴板管理
```javascript
// 剪切后自动清空剪贴板
if (operation === 'cut') {
  clearClipboard()
}

// 复制后保留剪贴板
if (operation === 'copy') {
  // 可以多次粘贴
}
```

## 用户体验

### 1. 操作反馈
```javascript
// 复制
ElMessage.success('已复制 3 个项目到剪贴板')

// 粘贴
ElMessage.success('成功复制 3 个项目')

// 压缩
ElMessage.success('压缩成功！')
```

### 2. 进度提示
```javascript
// 长时间操作显示加载提示
const loading = ElMessage({
  message: '正在压缩文件...',
  type: 'info',
  duration: 0
})
```

### 3. 确认对话框
```javascript
// 解压前确认
await ElMessageBox.confirm(
  '确定要解压 "backup.zip" 到当前目录吗？',
  '解压文件',
  { type: 'info' }
)

// 压缩时输入文件名
await ElMessageBox.prompt(
  '将 3 个项目压缩为：',
  '压缩文件',
  { inputValue: 'archive.zip' }
)
```

## 快捷键（未来扩展）

```javascript
// Ctrl+C - 复制
// Ctrl+X - 剪切
// Ctrl+V - 粘贴
// Delete - 删除

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'c') copyFiles()
  if (e.ctrlKey && e.key === 'x') cutFiles()
  if (e.ctrlKey && e.key === 'v') pasteFiles()
  if (e.key === 'Delete') deleteSelected()
})
```

## 最佳实践

### 1. 压缩前检查
```javascript
// 检查文件大小
const totalSize = files.reduce((sum, f) => sum + f.size, 0)
if (totalSize > 100 * 1024 * 1024) {
  ElMessage.warning('文件过大，压缩可能需要较长时间')
}
```

### 2. 解压前检查
```javascript
// 检查剩余空间
if (archiveSize * 2 > remainingSpace) {
  ElMessage.error('空间不足，无法解压')
  return
}
```

### 3. 批量操作提示
```javascript
// 显示操作进度
let success = 0, failed = 0
for (const file of files) {
  try {
    await copyFile(file)
    success++
  } catch (e) {
    failed++
  }
}
ElMessage.success(`操作完成: 成功 ${success} 个, 失败 ${failed} 个`)
```

## 故障排查

### 问题 1: 粘贴失败
**原因：** 目标目录权限不足

**解决：** 检查目标目录是否在 home_dir 内

### 问题 2: 压缩失败
**原因：** 服务器未安装 zip 命令

**解决：** 
```bash
# Ubuntu/Debian
apt-get install zip unzip

# CentOS/RHEL
yum install zip unzip
```

### 问题 3: 解压失败
**原因：** 压缩包损坏或格式不支持

**解决：** 检查文件完整性，确认格式支持

### 问题 4: 剪切后文件消失
**原因：** 移动失败但源文件已删除

**解决：** 使用复制代替剪切，确认成功后再删除

## 总结

✅ 复制粘贴功能已实现
✅ 压缩解压功能已实现
✅ 支持批量操作
✅ 自动设置权限
✅ 完善的错误处理
✅ 友好的用户提示

**刷新页面即可体验！**

类似宝塔面板的文件管理功能，支持：
- 📋 复制文件/文件夹
- ✂️ 剪切文件/文件夹
- 📦 压缩文件/文件夹
- 📂 解压压缩包
- 🗑️ 批量删除
- ✏️ 重命名
- 📝 编辑文件
- 👁️ 预览图片
