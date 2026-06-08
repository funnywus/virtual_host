// API 基础地址
// 开发环境：直连后端 6002 端口（后端已配置 CORS）
// 生产环境：使用相对路径（前端由后端同源提供）
export const API_BASE = import.meta.env.VITE_API_BASE
  ?? (import.meta.env.DEV ? 'http://localhost:6002' : '')

// WebSocket 基础地址
export const WS_BASE = (() => {
  if (API_BASE) {
    return API_BASE.replace(/^http/, 'ws')
  }
  // 相对：根据当前页面协议推导
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}`
})()
