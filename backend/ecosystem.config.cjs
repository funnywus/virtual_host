/**
 * 宝塔 / PM2 进程配置（可选）
 *
 * 用法:
 *   cd /www/wwwroot/me/virtual_host
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *
 * 或宝塔 Node 项目选择 PM2 时指定本文件。
 */
module.exports = {
  apps: [
    {
      name: 'vhost-manager',
      script: 'server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      node_args: '--max-old-space-size=2048',
      max_memory_restart: '1800M',
      env: {
        NODE_ENV: 'production'
      },
      // 日志交给宝塔/PM2 默认目录；也可改为绝对路径
      time: true,
      autorestart: true,
      watch: false
    }
  ]
};
