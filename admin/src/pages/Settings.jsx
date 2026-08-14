import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button, Empty, InputNumber, Modal, Select, Spin, Switch, Table, Tag, message } from 'antd'
import { FileOutlined } from '@ant-design/icons'
import api from '@/api'
import { confirmAction } from '@/utils'
import './Settings.css'

const TABS = [
  { name: 'ssl', label: '证书续期', hint: '自动续期 / 到期' },
  { name: 'diagnose', label: '运维检测', hint: '连通性与健康' },
  { name: 'tools', label: '维护工具', hint: '清理与任务' },
  { name: 'backup', label: '数据库备份', hint: '安全备份' },
  { name: 'info', label: '系统信息', hint: '运行状态' }
]
const TAB_NAMES = TABS.map((t) => t.name)

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => ({
  label: `${String(h).padStart(2, '0')}:00`,
  value: h
}))

const SSL_METRICS = [
  { key: 'active', label: '有效证书', tone: '' },
  { key: 'renew_window', label: '即将自动续期', tone: 'warning' },
  { key: 'expiring_soon', label: '15天内到期', tone: 'warning' },
  { key: 'expired', label: '已过期', tone: 'danger' },
  { key: 'failed', label: '失败', tone: 'danger' },
  { key: 'none', label: '未申请', tone: 'muted' }
]

const STAT_CARDS = [
  { key: 'domains', label: '主域名', tone: '' },
  { key: 'subdomains', label: '子域名', tone: '' },
  { key: 'servers', label: '服务器', tone: '' },
  { key: 'expired_active', label: '过期未停用', tone: 'danger' },
  { key: 'nginx_unsynced', label: 'Nginx未同步', tone: 'warning' },
  { key: 'ssl_failed', label: 'SSL异常', tone: 'danger' },
  { key: 'dns_error', label: 'DNS异常', tone: 'danger' },
  { key: 'temp_sessions', label: '临时会话', tone: 'muted' }
]

const EMPTY_SSL = {
  active: 0,
  none: 0,
  failed: 0,
  expiring_soon: 0,
  expired: 0,
  renew_window: 0,
  schedule: {},
  rows: []
}

const EMPTY_STATS = {
  domains: 0,
  subdomains: 0,
  servers: 0,
  ftp: 0,
  expired_active: 0,
  expiring_soon: 0,
  disabled: 0,
  nginx_unsynced: 0,
  ssl_failed: 0,
  dns_error: 0,
  temp_sessions: 0,
  temp_bytes: 0
}

const EMPTY_INFO = {
  version: '-',
  nodeVersion: '-',
  platform: '-',
  dbType: '-',
  uptime: '-',
  port: '-',
  pid: '-',
  memory: {},
  temp: {}
}

const DEFAULT_SSL_SETTINGS = {
  ssl_auto_renew: true,
  ssl_renew_before_days: 30,
  ssl_check_hour: 3
}

function isCancel(err) {
  return err?.message === 'cancel'
}

function formatSize(bytes) {
  if (bytes === null || bytes === undefined || bytes === '-') return '-'
  const n = Number(bytes)
  if (!Number.isFinite(n) || n < 0) return '-'
  if (n === 0) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function sslStatusColor(row) {
  if (row.urgency === 'expired' || row.ssl_status === 'failed' || row.ssl_status === 'error') return 'error'
  if (row.urgency === 'critical' || row.urgency === 'soon') return 'warning'
  if (row.ssl_status === 'active') return 'success'
  return 'blue'
}

function sslExpireClass(row) {
  if (row.urgency === 'expired' || row.urgency === 'critical') return 'expire-danger'
  if (row.urgency === 'soon') return 'expire-warning'
  if (row.urgency === 'ok') return 'expire-ok'
  return ''
}

function remainingText(row) {
  if (row.remaining_days === null || row.remaining_days === undefined) return '-'
  if (row.remaining_days < 0) return `已过期 ${Math.abs(row.remaining_days)} 天`
  return `${row.remaining_days} 天`
}

function confirmBox(content, title, options = {}) {
  return new Promise((resolve, reject) => {
    Modal.confirm({
      title,
      content,
      okText: options.okText || '确定',
      cancelText: options.cancelText || '取消',
      okButtonProps: options.okButtonProps,
      onOk: () => resolve(true),
      onCancel: () => reject(new Error('cancel'))
    })
  })
}

export default function Settings() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tabQuery = searchParams.get('tab') || ''
  const activeTab = TAB_NAMES.includes(tabQuery) ? tabQuery : 'ssl'

  const loaded = useRef({ ssl: false, stats: false, backup: false, info: false })
  const savedSslSettings = useRef({ ...DEFAULT_SSL_SETTINGS })
  const savingSettings = useRef(false)
  const sslSettingsRef = useRef({ ...DEFAULT_SSL_SETTINGS })
  const statsRef = useRef({ ...EMPTY_STATS })

  const [sslSettings, setSslSettings] = useState({ ...DEFAULT_SSL_SETTINGS })
  const [sslData, setSslData] = useState({ ...EMPTY_SSL })
  const [stats, setStats] = useState({ ...EMPTY_STATS })
  const [results, setResults] = useState({
    expire: null,
    servers: null,
    dns: null,
    sites: null,
    ssl: null
  })
  const [systemInfo, setSystemInfo] = useState({ ...EMPTY_INFO })
  const [backupList, setBackupList] = useState([])
  const [lastFullAt, setLastFullAt] = useState('')
  const [systemInfoError, setSystemInfoError] = useState('')

  const [loadingSsl, setLoadingSsl] = useState(false)
  const [loadingStats, setLoadingStats] = useState(false)
  const [loadingBackups, setLoadingBackups] = useState(false)
  const [backing, setBacking] = useState(false)
  const [downloadingBackup, setDownloadingBackup] = useState('')
  const [renewingId, setRenewingId] = useState(null)
  const [running, setRunning] = useState({
    full: false,
    expire: false,
    servers: false,
    dns: false,
    sites: false,
    sslSync: false,
    sslDiagnose: false,
    cleanup: false,
    autoRenew: false
  })

  sslSettingsRef.current = sslSettings
  statsRef.current = stats

  const hasAnyResult = !!(results.expire || results.servers || results.dns || results.sites || results.ssl)

  const infoItems = useMemo(() => [
    { label: '系统版本', value: systemInfo.version ? `v${systemInfo.version}` : '-' },
    { label: 'Node.js', value: systemInfo.nodeVersion },
    { label: '平台', value: systemInfo.platform || '-' },
    { label: '数据库', value: systemInfo.dbType },
    { label: '运行时间', value: systemInfo.uptime },
    { label: '监听端口', value: systemInfo.port || '-' },
    { label: '进程 PID', value: systemInfo.pid || '-' },
    { label: '内存 RSS', value: formatSize(systemInfo.memory?.rss) },
    { label: '堆使用', value: formatSize(systemInfo.memory?.heapUsed) },
    { label: '临时分片', value: `${systemInfo.temp?.sessions || 0} 会话 / ${formatSize(systemInfo.temp?.bytes)}` }
  ], [systemInfo])

  function setRun(key, value) {
    setRunning((prev) => ({ ...prev, [key]: value }))
  }

  function applySslPayload(res) {
    if (!res) return
    setSslData((prev) => ({ ...prev, ...res }))
    if (res.settings) {
      const next = {
        ssl_auto_renew: !!res.settings.ssl_auto_renew,
        ssl_renew_before_days: res.settings.ssl_renew_before_days || 30,
        ssl_check_hour: res.settings.ssl_check_hour ?? 3
      }
      setSslSettings(next)
      savedSslSettings.current = { ...next }
    }
  }

  function goTab(name) {
    const nextName = TAB_NAMES.includes(name) ? name : 'ssl'
    if (nextName === activeTab) return
    const next = new URLSearchParams(searchParams)
    next.set('tab', nextName)
    setSearchParams(next)
  }

  function onNavKeydown(e) {
    const dir = e.key === 'ArrowDown' || e.key === 'ArrowRight'
      ? 1
      : e.key === 'ArrowUp' || e.key === 'ArrowLeft'
        ? -1
        : 0
    if (!dir) return
    e.preventDefault()
    const i = TABS.findIndex((t) => t.name === activeTab)
    const next = TABS[(i + dir + TABS.length) % TABS.length]
    goTab(next.name)
    window.setTimeout(() => {
      document.querySelector('.settings-nav [role="tab"][aria-selected="true"]')?.focus()
    }, 0)
  }

  async function loadSslRenewals() {
    setLoadingSsl(true)
    try {
      const res = await api.get('/system/ssl-renewals')
      applySslPayload(res)
      loaded.current.ssl = true
    } catch {
      // interceptor already showed error
    } finally {
      setLoadingSsl(false)
    }
  }

  async function saveSslSettings(patch) {
    if (savingSettings.current) return
    const prev = { ...savedSslSettings.current }
    const next = { ...sslSettingsRef.current, ...patch }
    setSslSettings(next)
    savingSettings.current = true
    try {
      const res = await api.put('/system/settings', {
        ssl_auto_renew: next.ssl_auto_renew,
        ssl_renew_before_days: next.ssl_renew_before_days,
        ssl_check_hour: next.ssl_check_hour
      })
      const saved = {
        ssl_auto_renew: !!res.settings.ssl_auto_renew,
        ssl_renew_before_days: res.settings.ssl_renew_before_days,
        ssl_check_hour: res.settings.ssl_check_hour
      }
      setSslSettings(saved)
      savedSslSettings.current = saved
      message.success(res.schedule?.message || res.message || '自动续期设置已保存')
      await loadSslRenewals()
    } catch {
      setSslSettings(prev)
    } finally {
      savingSettings.current = false
    }
  }

  async function runAutoRenewNow() {
    const willRenew = !!sslSettings.ssl_auto_renew
    try {
      await confirmBox(
        willRenew
          ? `将检查证书，并对到期前 ${sslSettings.ssl_renew_before_days} 天内的证书执行续期。`
          : '自动续期已关闭，本次仅检查证书状态，不会续期。',
        willRenew ? '立即检查并续期' : '立即检查证书',
        {
          okText: willRenew ? '开始续期' : '仅检查',
          cancelText: '取消'
        }
      )
    } catch {
      return
    }
    setRun('autoRenew', true)
    try {
      const res = await api.post('/system/ssl-auto-renew/run')
      message.success(res.message || '检查完成')
      await loadSslRenewals()
    } catch {
      // interceptor already showed error
    } finally {
      setRun('autoRenew', false)
    }
  }

  async function refreshSslFromServers() {
    setRun('sslSync', true)
    try {
      const res = await api.post('/ssl/check-all')
      message.success(`已同步 ${res.checked || 0} 个域名证书状态`)
      await loadSslRenewals()
    } catch {
      // interceptor already showed error
    } finally {
      setRun('sslSync', false)
    }
  }

  async function renewCert(row) {
    try {
      await confirmAction(`确定续期「${row.domain}」？`, '证书续期')
    } catch {
      return
    }
    setRenewingId(row.id)
    try {
      const res = await api.post(`/ssl/renew/${row.id}`)
      res.success ? message.success(res.message || '续期成功') : message.error(res.message || '续期失败')
      await loadSslRenewals()
    } catch {
      // interceptor already showed error
    } finally {
      setRenewingId(null)
    }
  }

  async function loadStats() {
    setLoadingStats(true)
    try {
      const res = await api.get('/system/stats')
      const merged = { ...statsRef.current, ...res }
      statsRef.current = merged
      setStats(merged)
      loaded.current.stats = true
      return res
    } catch {
      return null
    } finally {
      setLoadingStats(false)
    }
  }

  async function runExpire() {
    if (!loaded.current.stats) await loadStats()
    const count = Number(statsRef.current.expired_active) || 0
    try {
      await confirmBox(
        count
          ? `当前有 ${count} 个过期未停用站点。将禁用其 Nginx，DNS 记录保留，之后可再启用。`
          : '将扫描并停用已过期仍在运行的站点（禁 Nginx，保留 DNS）。若没有这类站点则不会改动。',
        '停用过期站点',
        {
          okText: '确认停用',
          cancelText: '取消',
          okButtonProps: { danger: true }
        }
      )
    } catch {
      return
    }
    setRun('expire', true)
    try {
      const res = await api.post('/system/diagnose/expire')
      setResults((prev) => ({ ...prev, expire: res }))
      message.success(res.message || '过期检测完成')
      await loadStats()
    } catch {
      // interceptor already showed error
    } finally {
      setRun('expire', false)
    }
  }

  async function runServers() {
    setRun('servers', true)
    try {
      const res = await api.post('/system/diagnose/servers')
      setResults((prev) => ({ ...prev, servers: res }))
      message.success('服务器检测完成')
    } catch {
      // interceptor already showed error
    } finally {
      setRun('servers', false)
    }
  }

  async function runDns() {
    setRun('dns', true)
    try {
      const res = await api.post('/system/diagnose/dns')
      setResults((prev) => ({ ...prev, dns: res }))
      message.success('DNS 检测完成')
    } catch {
      // interceptor already showed error
    } finally {
      setRun('dns', false)
    }
  }

  async function runSites() {
    setRun('sites', true)
    try {
      const res = await api.post('/system/diagnose/sites')
      setResults((prev) => ({ ...prev, sites: res }))
      message.success(`站点健康：问题 ${res.issue_count} 个`)
    } catch {
      // interceptor already showed error
    } finally {
      setRun('sites', false)
    }
  }

  async function runSsl(options = {}) {
    const silent = !!options.silent
    setRun('sslDiagnose', true)
    try {
      const res = await api.post('/system/diagnose/ssl')
      setResults((prev) => ({ ...prev, ssl: res }))
      applySslPayload(res)
      loaded.current.ssl = true
      if (!silent) message.success('证书续期时间已更新')
    } catch {
      // interceptor already showed error
    } finally {
      setRun('sslDiagnose', false)
    }
  }

  async function runFull() {
    setRun('full', true)
    try {
      const res = await api.post('/system/diagnose/full')
      if (res.stats) {
        setStats((prev) => ({ ...prev, ...res.stats }))
        loaded.current.stats = true
      }
      setResults((prev) => ({
        ...prev,
        servers: res.servers,
        dns: res.dns,
        sites: res.sites
      }))
      setLastFullAt(res.finished_at || '')
      await runSsl({ silent: true })
      message.success('全面检测完成')
    } catch {
      // interceptor already showed error
    } finally {
      setRun('full', false)
    }
  }

  async function runCleanup() {
    try {
      await confirmAction('确定清理全部上传临时分片？', '清理确认')
    } catch {
      return
    }
    setRun('cleanup', true)
    try {
      const res = await api.post('/system/cleanup-temp')
      message.success(res.message || '清理完成')
      await loadStats()
      await loadSystemInfo()
    } catch {
      // interceptor already showed error
    } finally {
      setRun('cleanup', false)
    }
  }

  async function handleBackup() {
    setBacking(true)
    try {
      const res = await api.post('/system/backup')
      message.success(`备份成功：${res.filename}`)
      loadBackupList()
    } catch {
      // interceptor already showed error
    } finally {
      setBacking(false)
    }
  }

  async function loadBackupList() {
    setLoadingBackups(true)
    try {
      const res = await api.get('/system/backups')
      setBackupList(res.backups || [])
      loaded.current.backup = true
    } catch {
      // interceptor already showed error
    } finally {
      setLoadingBackups(false)
    }
  }

  async function downloadBackup(backup) {
    setDownloadingBackup(backup.filename)
    try {
      const blob = await api.get('/system/backup/download', {
        params: { filename: backup.filename },
        responseType: 'blob'
      })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = backup.filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
    } catch {
      // interceptor already showed error
    } finally {
      setDownloadingBackup('')
    }
  }

  async function deleteBackup(backup) {
    try {
      await confirmAction(`确定删除 "${backup.filename}"？`, '确认删除')
      await api.delete('/system/backup', { params: { filename: backup.filename } })
      message.success('删除成功')
      loadBackupList()
    } catch (err) {
      if (isCancel(err)) return
    }
  }

  async function loadSystemInfo(force = false) {
    if (force) loaded.current.info = false
    setSystemInfoError('')
    try {
      const res = await api.get('/system/info')
      setSystemInfo((prev) => ({ ...prev, ...res }))
      loaded.current.info = true
    } catch (err) {
      setSystemInfoError(err.message || '加载系统信息失败')
    }
  }

  useEffect(() => {
    if (!TAB_NAMES.includes(tabQuery)) {
      const next = new URLSearchParams(searchParams)
      next.set('tab', 'ssl')
      setSearchParams(next, { replace: true })
      return
    }
    if (!loaded.current.ssl) loadSslRenewals()
    if ((tabQuery === 'diagnose' || tabQuery === 'tools') && !loaded.current.stats) loadStats()
    if (tabQuery === 'backup' && !loaded.current.backup) loadBackupList()
    if (tabQuery === 'info' && !loaded.current.info) loadSystemInfo()
  }, [tabQuery])

  const sslColumns = [
    { title: '主域名', dataIndex: 'domain', width: 160, ellipsis: true },
    {
      title: '状态',
      width: 100,
      render: (_, row) => (
        <Tag color={sslStatusColor(row)}>{row.ssl_status || 'none'}</Tag>
      )
    },
    {
      title: '到期时间',
      width: 170,
      render: (_, row) => (
        <span className={sslExpireClass(row)}>{row.ssl_expires || '未设置'}</span>
      )
    },
    {
      title: '剩余',
      width: 120,
      render: (_, row) => (
        <span className={sslExpireClass(row)}>{remainingText(row)}</span>
      )
    },
    { title: '续期建议', dataIndex: 'note', ellipsis: true },
    {
      title: '操作',
      width: 100,
      fixed: 'right',
      render: (_, row) => (
        <Button
          type="link"
          size="small"
          loading={renewingId === row.id}
          onClick={() => renewCert(row)}
        >
          续期
        </Button>
      )
    }
  ]

  const expireColumns = [
    { title: '域名', dataIndex: 'domain', ellipsis: true },
    {
      title: '结果',
      width: 90,
      render: (_, row) => (
        <Tag color={row.success ? 'success' : 'error'}>{row.success ? '成功' : '失败'}</Tag>
      )
    },
    { title: '说明', dataIndex: 'message', ellipsis: true }
  ]

  const serverColumns = [
    { title: '名称', dataIndex: 'name' },
    {
      title: '地址',
      render: (_, row) => `${row.ip}:${row.port}`
    },
    {
      title: '状态',
      width: 90,
      render: (_, row) => (
        <Tag color={row.success ? 'success' : 'error'}>{row.success ? '正常' : '失败'}</Tag>
      )
    },
    { title: '说明', dataIndex: 'message', ellipsis: true }
  ]

  const dnsColumns = [
    { title: '名称', dataIndex: 'name' },
    { title: '平台', dataIndex: 'platform', width: 100 },
    {
      title: '状态',
      width: 90,
      render: (_, row) => (
        <Tag color={row.success ? 'success' : 'error'}>{row.success ? '正常' : '失败'}</Tag>
      )
    },
    { title: '说明', dataIndex: 'message', ellipsis: true }
  ]

  const siteColumns = [
    { title: '域名', dataIndex: 'domain', ellipsis: true },
    { title: '服务器', dataIndex: 'server', width: 120 },
    {
      title: '问题',
      render: (_, row) => (row.problems || []).map((p) => (
        <Tag key={p} color="warning" className="problem-tag">{p}</Tag>
      ))
    }
  ]

  const backupColumns = [
    {
      title: '文件名',
      ellipsis: true,
      render: (_, row) => (
        <span>
          <FileOutlined style={{ marginRight: 6 }} />
          {row.filename}
        </span>
      )
    },
    {
      title: '大小',
      width: 120,
      render: (_, row) => formatSize(row.size)
    },
    { title: '创建时间', dataIndex: 'created_at', width: 180 },
    {
      title: '操作',
      width: 180,
      fixed: 'right',
      render: (_, row) => (
        <>
          <Button
            type="primary"
            size="small"
            style={{ background: '#16a34a', borderColor: '#16a34a', marginRight: 8 }}
            loading={downloadingBackup === row.filename}
            onClick={() => downloadBackup(row)}
          >
            下载
          </Button>
          <Button danger size="small" onClick={() => deleteBackup(row)}>删除</Button>
        </>
      )
    }
  ]

  const checkHour = String(sslSettings.ssl_check_hour).padStart(2, '0')

  return (
    <div className="settings-page">
      <div className="settings-bg" aria-hidden="true" />

      <header className="settings-hero">
        <div>
          <p className="eyebrow">运维中心</p>
          <h1>系统设置</h1>
          <p className="hero-desc">证书自动续期、运维检测与系统维护集中管理</p>
        </div>
        <div className="hero-meta">
          <div className={`meta-chip ${sslSettings.ssl_auto_renew ? 'is-on' : 'is-off'}`}>
            <span className="dot" />
            {sslSettings.ssl_auto_renew ? '自动续期已开启' : '自动续期已关闭'}
          </div>
          <div className="meta-chip muted">下次巡检 {sslData.schedule?.next_check_at || '-'}</div>
        </div>
      </header>

      <div className="settings-shell">
        <nav className="settings-nav" role="tablist" aria-label="系统设置分类" onKeyDown={onNavKeydown}>
          {TABS.map((tab) => (
            <button
              key={tab.name}
              type="button"
              role="tab"
              className={`nav-item${activeTab === tab.name ? ' active' : ''}`}
              aria-selected={activeTab === tab.name}
              aria-controls={`settings-panel-${tab.name}`}
              tabIndex={activeTab === tab.name ? 0 : -1}
              onClick={() => goTab(tab.name)}
            >
              <span className="nav-label">{tab.label}</span>
              <span className="nav-hint">{tab.hint}</span>
            </button>
          ))}
        </nav>

        <main className="settings-main">
          {activeTab === 'ssl' && (
            <section id="settings-panel-ssl" className="panel" role="tabpanel">
              <div className="auto-renew-card">
                <div className="auto-renew-main">
                  <div className="auto-renew-title-row">
                    <h2>证书自动续期</h2>
                    <Switch
                      checked={!!sslSettings.ssl_auto_renew}
                      checkedChildren="开"
                      unCheckedChildren="关"
                      onChange={(checked) => saveSslSettings({ ssl_auto_renew: checked })}
                    />
                  </div>
                  <p>
                    每天 {checkHour}:00 巡检证书；
                    到期前 <b>{sslSettings.ssl_renew_before_days}</b> 天自动续期并同步本地证书。
                  </p>
                  <div className="auto-renew-controls">
                    <label>
                      <span>提前天数</span>
                      <InputNumber
                        min={1}
                        max={90}
                        size="small"
                        value={sslSettings.ssl_renew_before_days}
                        onChange={(val) => {
                          if (val == null) return
                          saveSslSettings({ ssl_renew_before_days: val })
                        }}
                      />
                    </label>
                    <label>
                      <span>巡检时刻</span>
                      <Select
                        size="small"
                        style={{ width: 110 }}
                        value={sslSettings.ssl_check_hour}
                        options={HOUR_OPTIONS}
                        onChange={(val) => saveSslSettings({ ssl_check_hour: val })}
                      />
                    </label>
                  </div>
                  <div className="auto-renew-foot">
                    <span>上次检查：{sslData.schedule?.last_ssl_check_at || '尚未执行'}</span>
                    <span>上次续期：{sslData.schedule?.last_ssl_renew_at || '尚未执行'}</span>
                  </div>
                </div>
                <div className="auto-renew-actions">
                  <Button type="primary" loading={running.autoRenew} onClick={runAutoRenewNow}>
                    立即检查并续期
                  </Button>
                  <Button loading={running.sslSync} onClick={refreshSslFromServers}>同步服务器状态</Button>
                  <Button loading={loadingSsl} onClick={loadSslRenewals}>刷新列表</Button>
                </div>
              </div>

              <Spin spinning={loadingSsl}>
                <div className="metric-row">
                  {SSL_METRICS.map((m) => (
                    <div key={m.key} className={`metric ${m.tone}`.trim()}>
                      <div className="metric-val">{sslData[m.key] ?? 0}</div>
                      <div className="metric-label">{m.label}</div>
                    </div>
                  ))}
                </div>
              </Spin>

              <div className="table-card">
                <div className="table-card-head">
                  <h3>证书续期时间</h3>
                  <span>按剩余天数排序</span>
                </div>
                <Table
                  className="soft-table"
                  rowKey={(row) => row.id ?? row.domain}
                  columns={sslColumns}
                  dataSource={sslData.rows || []}
                  loading={loadingSsl}
                  pagination={false}
                  scroll={{ y: 480, x: 800 }}
                  locale={{ emptyText: <Empty description="暂无主域名证书数据" /> }}
                />
              </div>
            </section>
          )}

          {activeTab === 'diagnose' && (
            <section id="settings-panel-diagnose" className="panel" role="tabpanel">
              <div className="section-intro">
                <h2>运维检测</h2>
                <p>巡检服务器、DNS、站点健康与证书。停用过期站点是独立危险操作，只禁 Nginx，不动 DNS。</p>
              </div>

              <Spin spinning={loadingStats}>
                <div className="metric-row">
                  {STAT_CARDS.map((item) => (
                    <div key={item.key} className={`metric ${item.tone}`.trim()}>
                      <div className="metric-val">{stats[item.key] ?? '-'}</div>
                      <div className="metric-label">{item.label}</div>
                    </div>
                  ))}
                </div>
              </Spin>

              <div className="action-toolbar">
                <div className="action-grid">
                  <Button type="primary" loading={running.full} onClick={runFull}>一键全面检测</Button>
                  <Button loading={running.servers} onClick={runServers}>服务器连通</Button>
                  <Button loading={running.dns} onClick={runDns}>DNS 平台</Button>
                  <Button loading={running.sites} onClick={runSites}>站点健康</Button>
                  <Button loading={loadingStats} onClick={loadStats}>刷新统计</Button>
                </div>
                <Button danger ghost loading={running.expire} onClick={runExpire}>检测并停用过期</Button>
              </div>

              {!hasAnyResult && (
                <div className="empty-tip soft">
                  <Empty description="点击上方按钮开始检测" />
                </div>
              )}

              {results.expire && (
                <div className="result-block">
                  <div className="result-title">
                    过期停用
                    <Tag color="warning">停用 {results.expire.disabled || 0} · 共 {results.expire.total || 0}</Tag>
                  </div>
                  {results.expire.results?.length ? (
                    <Table
                      className="soft-table"
                      size="small"
                      rowKey={(row, i) => row.domain || i}
                      columns={expireColumns}
                      dataSource={results.expire.results}
                      pagination={false}
                      scroll={{ y: 240 }}
                    />
                  ) : (
                    <div className="result-ok">{results.expire.message || '没有需要停用的过期子域名'}</div>
                  )}
                </div>
              )}

              {results.servers && (
                <div className="result-block">
                  <div className="result-title">
                    服务器连通
                    <Tag color={results.servers.failed ? 'error' : 'success'}>
                      正常 {results.servers.success || 0} · 失败 {results.servers.failed || 0}
                    </Tag>
                  </div>
                  <Table
                    className="soft-table"
                    size="small"
                    rowKey={(row, i) => row.name || i}
                    columns={serverColumns}
                    dataSource={results.servers.results || []}
                    pagination={false}
                    scroll={{ y: 260 }}
                  />
                </div>
              )}

              {results.dns && (
                <div className="result-block">
                  <div className="result-title">
                    DNS 平台
                    <Tag color={results.dns.failed ? 'error' : 'success'}>
                      正常 {results.dns.success || 0} · 失败 {results.dns.failed || 0}
                    </Tag>
                  </div>
                  {results.dns.results?.length ? (
                    <Table
                      className="soft-table"
                      size="small"
                      rowKey={(row, i) => row.name || i}
                      columns={dnsColumns}
                      dataSource={results.dns.results}
                      pagination={false}
                      scroll={{ y: 240 }}
                    />
                  ) : (
                    <div className="result-ok">暂无 DNS 平台配置</div>
                  )}
                </div>
              )}

              {results.sites && (
                <div className="result-block">
                  <div className="result-title">
                    站点健康
                    <Tag color="blue">扫描 {results.sites.scanned}</Tag>
                    <Tag color="success">健康 {results.sites.healthy}</Tag>
                    <Tag color={results.sites.issue_count ? 'warning' : 'success'}>问题 {results.sites.issue_count}</Tag>
                  </div>
                  {results.sites.issues?.length ? (
                    <Table
                      className="soft-table"
                      size="small"
                      rowKey={(row, i) => row.domain || i}
                      columns={siteColumns}
                      dataSource={results.sites.issues}
                      pagination={false}
                      scroll={{ y: 320 }}
                    />
                  ) : (
                    <div className="result-ok">已扫描站点均健康，或暂无子域名</div>
                  )}
                </div>
              )}

              {results.ssl && (
                <div className="result-block">
                  <div className="result-title">
                    证书摘要
                    <Tag color="success">有效 {results.ssl.active || 0}</Tag>
                    <Tag color="warning">窗口内 {results.ssl.renew_window || 0}</Tag>
                    <Tag color="error">过期 {results.ssl.expired || 0}</Tag>
                    <Tag color="blue">未申请 {results.ssl.none || 0}</Tag>
                  </div>
                  {results.ssl.schedule && (
                    <div className="result-ok">
                      {results.ssl.schedule.check_time}
                      {' · 下次 '}
                      {results.ssl.schedule.next_check_at || '-'}
                      {' · '}
                      {results.ssl.schedule.note}
                    </div>
                  )}
                  <Button type="link" onClick={() => goTab('ssl')}>查看证书列表并续期</Button>
                </div>
              )}

              {lastFullAt && <div className="last-run">上次全面检测：{lastFullAt}</div>}
            </section>
          )}

          {activeTab === 'tools' && (
            <section id="settings-panel-tools" className="panel" role="tabpanel">
              <div className="section-intro">
                <h2>维护工具</h2>
                <p>清理临时分片。停用过期站点、证书续期请到对应页面执行。</p>
              </div>
              <div className="tool-list">
                <div className="tool-item">
                  <div>
                    <div className="tool-title">清理上传临时分片</div>
                    <div className="tool-desc">
                      当前约 {formatSize(stats.temp_bytes)} / {stats.temp_sessions || 0} 个会话
                    </div>
                  </div>
                  <Button className="btn-warning" loading={running.cleanup} onClick={runCleanup}>立即清理</Button>
                </div>
                <div className="tool-item">
                  <div>
                    <div className="tool-title">过期站点停用</div>
                    <div className="tool-desc">禁用 Nginx，保留 DNS。在运维检测中确认后执行</div>
                  </div>
                  <Button onClick={() => goTab('diagnose')}>前往运维检测</Button>
                </div>
                <div className="tool-item">
                  <div>
                    <div className="tool-title">证书检查 / 自动续期</div>
                    <div className="tool-desc">按自动续期开关与提前天数执行</div>
                  </div>
                  <Button onClick={() => goTab('ssl')}>前往证书续期</Button>
                </div>
              </div>
            </section>
          )}

          {activeTab === 'backup' && (
            <section id="settings-panel-backup" className="panel" role="tabpanel">
              <div className="section-intro">
                <h2>数据库备份</h2>
                <p>备份保存在服务器备份目录，可在此下载或删除。</p>
              </div>
              <div className="action-grid">
                <Button type="primary" loading={backing} onClick={handleBackup}>立即备份</Button>
                <Button loading={loadingBackups} onClick={loadBackupList}>刷新列表</Button>
              </div>
              <div className="table-card">
                <Table
                  className="soft-table"
                  rowKey="filename"
                  columns={backupColumns}
                  dataSource={backupList}
                  loading={loadingBackups}
                  pagination={false}
                  locale={{ emptyText: <Empty description="暂无备份文件" /> }}
                />
              </div>
            </section>
          )}

          {activeTab === 'info' && (
            <section id="settings-panel-info" className="panel" role="tabpanel">
              <div className="section-intro row">
                <div>
                  <h2>系统信息</h2>
                  <p>运行时状态与资源占用</p>
                </div>
                <Button size="small" onClick={() => loadSystemInfo(true)}>刷新</Button>
              </div>
              {systemInfoError && <p className="error-tip">{systemInfoError}</p>}
              <div className="info-grid">
                {infoItems.map((item) => (
                  <div className="info-item" key={item.label}>
                    <span className="info-label">{item.label}</span>
                    <span className="info-value">{item.value}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  )
}
