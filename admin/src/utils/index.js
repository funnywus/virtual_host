import { message, Modal } from 'antd'

export async function copyText(text, label = '') {
  const value = String(text ?? '')
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
    } else {
      const el = document.createElement('textarea')
      el.value = value
      el.setAttribute('readonly', '')
      el.style.position = 'fixed'
      el.style.left = '-9999px'
      document.body.appendChild(el)
      el.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(el)
      if (!ok) throw new Error('copy failed')
    }
    message.success(label ? `${label}已复制` : '已复制')
  } catch {
    message.error('复制失败，请手动复制')
  }
}

export function formatUploadSize(bytes) {
  if (!bytes) return '500MB'
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + 'KB'
  if (bytes < 1024 * 1024 * 1024) return Math.round(bytes / 1024 / 1024) + 'MB'
  return (bytes / 1024 / 1024 / 1024).toFixed(1) + 'GB'
}

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
  } catch {
    return expiresStr
  }
}

export function getSslDaysType(expiresStr) {
  if (!expiresStr) return 'default'
  try {
    const expires = new Date(expiresStr)
    const now = new Date()
    const days = Math.ceil((expires - now) / (1000 * 60 * 60 * 24))
    if (days < 0) return 'error'
    if (days <= 7) return 'error'
    if (days <= 30) return 'warning'
    return 'success'
  } catch {
    return 'default'
  }
}

export const platformTypes = {
  aliyun: { name: '阿里云', color: 'orange', keyLabel: 'AccessKey ID', secretLabel: 'AccessKey Secret' },
  tencent: { name: '腾讯云', color: 'blue', keyLabel: 'SecretId', secretLabel: 'SecretKey' },
  cloudflare: { name: 'Cloudflare', color: 'green', keyLabel: 'Email/API Token', secretLabel: 'API Key/Token' },
  dnspod: { name: 'DNSPod', color: 'cyan', keyLabel: 'ID', secretLabel: 'Token' },
  huawei: { name: '华为云', color: 'red', keyLabel: 'Access Key', secretLabel: 'Secret Key' },
  godaddy: { name: 'GoDaddy', color: 'default', keyLabel: 'API Key', secretLabel: 'API Secret' }
}

export function formatDateTime(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

export function confirmAction(content, title = '提示') {
  return new Promise((resolve, reject) => {
    Modal.confirm({
      title,
      content,
      okText: '确定',
      cancelText: '取消',
      onOk: () => resolve(true),
      onCancel: () => reject(new Error('cancel'))
    })
  })
}
