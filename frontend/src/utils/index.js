import { ElMessage } from 'element-plus'

// 复制文本到剪贴板
export function copyText(text) {
  navigator.clipboard.writeText(text)
  ElMessage.success('已复制')
}

// 格式化上传大小
export function formatUploadSize(bytes) {
  if (!bytes) return '500MB'
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + 'KB'
  if (bytes < 1024 * 1024 * 1024) return Math.round(bytes / 1024 / 1024) + 'MB'
  return (bytes / 1024 / 1024 / 1024).toFixed(1) + 'GB'
}

// 计算SSL证书剩余天数
export function formatSslDays(expiresStr) {
  if (!expiresStr) return ''
  try {
    const expires = new Date(expiresStr)
    const now = new Date()
    const diffMs = expires - now
    const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
    if (days < 0) return '已过期'
    if (days === 0) return '今天过期'
    return `剩余${days}天`
  } catch (e) {
    return expiresStr
  }
}

// 根据剩余天数返回标签类型
export function getSslDaysType(expiresStr) {
  if (!expiresStr) return 'info'
  try {
    const expires = new Date(expiresStr)
    const now = new Date()
    const diffMs = expires - now
    const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
    if (days < 0) return 'danger'
    if (days <= 7) return 'danger'
    if (days <= 30) return 'warning'
    return 'success'
  } catch (e) {
    return 'info'
  }
}

// DNS平台类型配置
export const platformTypes = {
  aliyun: { name: '阿里云', type: 'warning', keyLabel: 'AccessKey ID', secretLabel: 'AccessKey Secret' },
  tencent: { name: '腾讯云', type: 'primary', keyLabel: 'SecretId', secretLabel: 'SecretKey' },
  cloudflare: { name: 'Cloudflare', type: 'success', keyLabel: 'Email/API Token', secretLabel: 'API Key/Token' },
  dnspod: { name: 'DNSPod', type: 'info', keyLabel: 'ID', secretLabel: 'Token' },
  huawei: { name: '华为云', type: 'danger', keyLabel: 'Access Key', secretLabel: 'Secret Key' },
  godaddy: { name: 'GoDaddy', type: '', keyLabel: 'API Key', secretLabel: 'API Secret' }
}
