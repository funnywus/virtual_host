#!/bin/bash

echo "========================================="
echo "启动虚拟主机管理系统后端"
echo "========================================="

# 进入后端目录
cd backend

# 检查 Node.js 版本
echo "Node.js 版本:"
node --version

# 检查端口是否被占用
if lsof -i :6002 > /dev/null 2>&1; then
  echo ""
  echo "⚠️  警告: 端口 6002 已被占用"
  echo "正在停止旧进程..."
  lsof -ti :6002 | xargs kill -9 2>/dev/null
  sleep 2
fi

# 清理临时文件
echo ""
echo "清理临时文件..."
node scripts/cleanup-temp.js

# 启动服务
echo ""
echo "========================================="
echo "启动后端服务..."
echo "内存限制: 2GB"
echo "超时时间: 30分钟"
echo "========================================="
echo ""

# 使用 npm run dev 启动（已包含内存限制）
npm run dev
