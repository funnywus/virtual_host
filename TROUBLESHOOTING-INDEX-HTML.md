# index.html 不显示问题排查指南

## 🔍 可能的原因

### 1. 文件名大小写问题
- ✅ **正确**: `index.html` (全小写)
- ❌ **错误**: `Index.html`, `INDEX.HTML`, `index.HTML`

**解决方法**:
- 确保文件名是 `index.html` (全小写)
- Linux 系统区分大小写

### 2. 文件位置问题
- 文件必须在网站根目录
- 不能在子文件夹中

**检查方法**:
1. 登录上传页面
2. 确认当前在根目录（面包屑显示"根目录"）
3. 确认 index.html 在文件列表中

### 3. 文件权限问题
**正确的权限**:
- 文件权限: `644` (rw-r--r--)
- 所有者: `www:www` 或 `www-data:www-data`

**如何检查**:
管理员可以通过服务器终端执行：
```bash
ls -la /www/wwwroot/ftp/你的域名/index.html
```

应该看到类似：
```
-rw-r--r-- 1 www www 1234 Apr 27 10:00 index.html
```

### 4. Nginx 配置问题
**检查 Nginx 配置**:
1. 进入"子域名管理"
2. 找到你的域名
3. 点击"Nginx"按钮
4. 确认配置中有：
   ```nginx
   index index.php index.html index.htm;
   root /www/wwwroot/ftp/你的域名;
   ```

### 5. 文件内容问题
**最简单的测试文件**:
```html
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>测试页面</title>
</head>
<body>
    <h1>Hello World!</h1>
    <p>如果你看到这个页面，说明网站正常运行。</p>
</body>
</html>
```

### 6. 浏览器缓存问题
**清除缓存**:
- Chrome/Edge: `Ctrl + Shift + Delete`
- Firefox: `Ctrl + Shift + Delete`
- Safari: `Command + Option + E`

或者使用无痕/隐私模式访问

### 7. DNS 解析问题
**检查 DNS**:
```bash
# Windows
nslookup 你的域名

# Linux/Mac
dig 你的域名
```

确认域名解析到正确的服务器 IP

## 🛠️ 快速修复步骤

### 步骤 1: 检查文件
1. 登录上传页面
2. 确认在根目录
3. 查看是否有 `index.html` 文件
4. 文件名必须是小写

### 步骤 2: 重新上传
如果文件名不对：
1. 删除错误的文件
2. 创建新文件，命名为 `index.html`
3. 粘贴上面的测试代码
4. 保存

### 步骤 3: 检查 Nginx
1. 进入"子域名管理"
2. 点击你的域名的"Nginx"按钮
3. 点击"同步到服务器"
4. 等待同步完成

### 步骤 4: 清除缓存并访问
1. 清除浏览器缓存
2. 或使用无痕模式
3. 访问你的域名

## 📋 完整检查清单

- [ ] 文件名是 `index.html` (全小写)
- [ ] 文件在根目录，不在子文件夹
- [ ] 文件内容是有效的 HTML
- [ ] Nginx 配置已同步
- [ ] DNS 解析正确
- [ ] 清除了浏览器缓存
- [ ] 使用 HTTP 或 HTTPS 访问（不是 FTP）

## 🔧 管理员诊断命令

如果你是管理员，可以在服务器终端执行以下命令诊断：

```bash
# 1. 检查文件是否存在
ls -la /www/wwwroot/ftp/你的域名/index.html

# 2. 查看文件内容
cat /www/wwwroot/ftp/你的域名/index.html

# 3. 检查 Nginx 配置
cat /www/server/panel/vhost/nginx/你的域名.conf

# 4. 测试 Nginx 配置
nginx -t

# 5. 重新加载 Nginx
nginx -s reload

# 6. 检查 Nginx 错误日志
tail -f /www/wwwlogs/你的域名.error.log

# 7. 修复权限（如果需要）
cd /www/wwwroot/ftp/你的域名
chmod 644 index.html
chown www:www index.html
chmod 755 .
```

## 💡 常见错误示例

### 错误 1: 文件名大小写
```
❌ Index.html
❌ INDEX.html
❌ index.HTML
✅ index.html
```

### 错误 2: 文件位置
```
❌ /www/wwwroot/ftp/domain.com/html/index.html
❌ /www/wwwroot/ftp/domain.com/public/index.html
✅ /www/wwwroot/ftp/domain.com/index.html
```

### 错误 3: 文件内容
```html
❌ 空文件
❌ 只有文字，没有 HTML 标签
✅ 完整的 HTML 文档（包含 <!DOCTYPE html>）
```

## 🎯 最快的解决方法

1. **删除现有文件**（如果有）
2. **点击"新建文件"**
3. **文件名输入**: `index.html`
4. **文件内容粘贴**:
```html
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>我的网站</title>
</head>
<body>
    <h1>欢迎访问我的网站！</h1>
    <p>网站正在建设中...</p>
</body>
</html>
```
5. **点击"创建"**
6. **清除浏览器缓存**
7. **访问你的域名**

## 📞 仍然无法解决？

如果按照以上步骤仍然无法解决，请联系管理员并提供：
1. 你的域名
2. 截图：文件列表
3. 截图：访问域名时的错误信息
4. 浏览器控制台的错误信息（F12 打开）

---

**提示**: 99% 的情况下，问题都是文件名大小写或文件位置不对。请仔细检查这两点！
