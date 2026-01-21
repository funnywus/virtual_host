#!/bin/bash

# 修复 MySQL 字符串拼接问题
# 将 SQLite 的 || 替换为兼容的 db.concat() 调用

echo "开始修复 MySQL 字符串拼接..."

# 查找所有使用 || 拼接的 SQL
find backend/routes -name "*.js" -type f -exec sed -i.bak \
  "s/ELSE s\.subdomain || '\.' || d\.domain END/ELSE \${db.concat('s.subdomain', \"'.'\", 'd.domain')} END/g" {} \;

echo "✓ 修复完成！"
echo "备份文件保存为 *.bak"
