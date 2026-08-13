import axios from 'axios'
import { ElMessage } from 'element-plus'
import { API_BASE } from '@/config'

const api = axios.create({
  baseURL: `${API_BASE}/api`,
  timeout: 300000  // 5分钟超时，SSL证书申请需要较长时间
})

// 请求拦截器
api.interceptors.request.use(config => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

async function readErrorMessage(error) {
  const data = error.response?.data
  if (data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text())
      if (parsed?.error) return parsed.error
    } catch {
      // 非 JSON 的 blob 错误页（如 nginx 404 HTML）走默认文案
    }
  }
  return data?.error || error.message
}

// 响应拦截器
api.interceptors.response.use(
  response => response.data,
  async error => {
    const msg = await readErrorMessage(error)
    const status = error.response?.status
    const normalizedError = new Error(msg)
    normalizedError.response = error.response
    normalizedError.status = status
    normalizedError.data = error.response?.data
    
    // 登录接口的 401 不跳转，只提示错误
    const isLoginRequest = error.config?.url?.includes('/auth/login')
    
    if (status === 401 && !isLoginRequest) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      window.location.href = '/admin-jm/login'
    } else {
      ElMessage.error(msg)
    }
    return Promise.reject(normalizedError)
  }
)

export default api
