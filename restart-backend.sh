#!/bin/bash

echo "🔄 正在重启后端服务..."

# 查找并停止后端进程
echo "📍 查找后端进程..."
BACKEND_PID=$(ps aux | grep "node.*server.js" | grep "virtual_host/backend" | grep -v grep | awk '{print $2}')

if [ -n "$BACKEND_PID" ]; then
    echo "🛑 停止旧进程 (PID: $BACKEND_PID)..."
    kill $BACKEND_PID
    sleep 2
    
    # 确认进程已停止
    if ps -p $BACKEND_PID > /dev/null 2>&1; then
        echo "⚠️  进程未停止，强制终止..."
        kill -9 $BACKEND_PID
        sleep 1
    fi
    echo "✅ 旧进程已停止"
else
    echo "ℹ️  未找到运行中的后端进程"
fi

# 启动新进程
echo "🚀 启动新进程..."
cd backend
npm start &

sleep 3

# 检查是否启动成功
NEW_PID=$(ps aux | grep "node.*server.js" | grep "virtual_host/backend" | grep -v grep | awk '{print $2}')

if [ -n "$NEW_PID" ]; then
    echo "✅ 后端服务已启动 (PID: $NEW_PID)"
    echo "📝 查看日志: tail -f backend/logs/server.log"
    echo ""
    echo "🎉 重启完成！现在可以测试上传功能了"
else
    echo "❌ 后端服务启动失败"
    echo "请手动启动: cd backend && npm start"
fi
