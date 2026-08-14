import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Alert, Button, Empty, Form, Input, Modal, Radio, Select, Space, Switch, Table, Tabs, Tag, message } from 'antd'
import { FolderOpenOutlined, UploadOutlined } from '@ant-design/icons'
import api from '@/api'
import { qk } from '@/api/queryKeys'
import { API_BASE, WS_BASE } from '@/config'
import { copyText } from '@/utils'

function getSslStatusColor(status) {
  const map = { active: 'success', issuing: 'warning', renewing: 'warning', error: 'error' }
  return map[status] || 'default'
}

function getSslStatusText(status) {
  const map = { active: '已启用', issuing: '申请中', renewing: '续期中', error: '失败' }
  return map[status] || '未申请'
}

function getErrorLog(error) {
  return error?.data?.log || error?.response?.data?.log || ''
}

function formatFileSize(size) {
  if (!size) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = size
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

const emptySslInfo = {
  exists: false,
  status: '',
  issuer: '',
  not_before: '',
  not_after: '',
  paths: null,
  san: '',
  log: '',
  local_cert: null
}

export default function SslDialog({ open, domain, onClose, onRefresh }) {
  const { data: serverList = [] } = useQuery({
    queryKey: qk.servers,
    queryFn: () => api.get('/servers')
  })
  const { data: certTypes = {} } = useQuery({
    queryKey: ['ssl-types'],
    queryFn: () => api.get('/ssl/types')
  })

  const servers = useMemo(
    () => serverList.filter((s) => s.status !== 'disabled'),
    [serverList]
  )
  const defaultServer = servers.find((s) => s.is_default) || servers[0]
  const domainRef = useRef(domain)
  const sslLogSocket = useRef(null)
  const logBoxRef = useRef(null)
  const applyLogRef = useRef(null)

  const [hasDnsConfig, setHasDnsConfig] = useState(false)
  const [sslInfo, setSslInfo] = useState(emptySslInfo)
  const [form, setForm] = useState({ verify_method: 'dns', cert_type: 'letsencrypt', webroot: '' })
  const [publishForm, setPublishForm] = useState({ server_id: '', target_dir: '' })
  const [showCertInfo, setShowCertInfo] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [issuing, setIssuing] = useState(false)
  const [renewing, setRenewing] = useState(false)
  const [viewing, setViewing] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [certDialogVisible, setCertDialogVisible] = useState(false)
  const [certTab, setCertTab] = useState('cert')
  const [certContent, setCertContent] = useState('')
  const [keyContent, setKeyContent] = useState('')
  const [certFilesDialogVisible, setCertFilesDialogVisible] = useState(false)
  const [certFiles, setCertFiles] = useState([])
  const [certFilesInfo, setCertFilesInfo] = useState({ domain: '', stored: false, dir: '', metadata: null })
  const [publishDialogVisible, setPublishDialogVisible] = useState(false)
  const [applyBtDialogVisible, setApplyBtDialogVisible] = useState(false)
  const [applyingBt, setApplyingBt] = useState(false)
  const [loadingBtSites, setLoadingBtSites] = useState(false)
  const [btSites, setBtSites] = useState([])
  const [selectedBtSites, setSelectedBtSites] = useState([])
  const [btSiteKeyword, setBtSiteKeyword] = useState('')
  const [applyBtLog, setApplyBtLog] = useState('')
  const [applyBtForm, setApplyBtForm] = useState({ server_id: '', force_https: true })

  const canIssueCert = !!defaultServer && (form.verify_method !== 'dns' || hasDnsConfig)
  const filteredBtSites = useMemo(() => {
    if (!btSiteKeyword) return btSites
    const kw = btSiteKeyword.toLowerCase()
    return btSites.filter((s) => s.name.toLowerCase().includes(kw))
  }, [btSites, btSiteKeyword])

  useEffect(() => {
    domainRef.current = domain
  }, [domain])

  function scrollLogToBottom() {
    setTimeout(() => {
      if (logBoxRef.current) logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight
    }, 50)
  }

  function stopSslLogSocket() {
    if (sslLogSocket.current) {
      sslLogSocket.current.close()
      sslLogSocket.current = null
    }
  }

  function startSslLogSocket() {
    if (sslLogSocket.current || !domainRef.current) return
    const token = localStorage.getItem('token')
    if (!token) return

    const wsUrl = `${WS_BASE}/api/ws-ssl-log?token=${encodeURIComponent(token)}&domainId=${domainRef.current.id}`
    const socket = new WebSocket(wsUrl)

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type !== 'ssl-log') return
        if (typeof data.log === 'string') {
          setSslInfo((prev) => ({ ...prev, log: data.log }))
          scrollLogToBottom()
        }
        if (typeof data.status === 'string') {
          setSslInfo((prev) => ({ ...prev, status: data.status }))
          if (data.status !== 'issuing' && data.status !== 'renewing') {
            stopSslLogSocket()
          }
        }
        if (typeof data.expires === 'string' || data.expires === null) {
          setSslInfo((prev) => ({ ...prev, not_after: data.expires || prev.not_after }))
        }
      } catch (err) {
        console.error('解析 SSL 日志消息失败:', err)
      }
    }

    socket.onclose = () => {
      if (sslLogSocket.current === socket) sslLogSocket.current = null
    }

    socket.onerror = () => {
      socket.close()
    }

    sslLogSocket.current = socket
  }

  async function refreshStatus() {
    if (!domainRef.current) return null
    setRefreshing(true)
    try {
      const res = await api.get(`/ssl/status/${domainRef.current.id}`)
      const info = {
        exists: res.exists,
        status: res.ssl_status || '',
        issuer: res.issuer || '',
        not_before: res.not_before || '',
        not_after: res.not_after || '',
        paths: res.paths,
        san: res.san || '',
        log: res.ssl_log || '',
        local_cert: res.local_cert || null
      }
      setSslInfo(info)
      setHasDnsConfig(!!res.has_dns_config)
      return info
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    if (open && domain) {
      setForm((prev) => ({ ...prev, webroot: `/www/wwwroot/ftp/${domain.domain}` }))
      setPublishForm({
        target_dir: `/www/certs/${domain.domain}`,
        server_id: defaultServer?.id || ''
      })
      refreshStatus().then((info) => {
        if (info?.status === 'issuing' || info?.status === 'renewing') {
          setShowLog(true)
          startSslLogSocket()
        }
      })
    } else {
      stopSslLogSocket()
      setCertDialogVisible(false)
      setCertFilesDialogVisible(false)
      setPublishDialogVisible(false)
      setApplyBtDialogVisible(false)
    }
    return () => stopSslLogSocket()
  }, [open, domain?.id])

  useEffect(() => {
    if (open && defaultServer?.id) {
      setPublishForm((prev) => (prev.server_id ? prev : { ...prev, server_id: defaultServer.id }))
    }
  }, [open, defaultServer?.id])

  useEffect(() => {
    if (showLog) scrollLogToBottom()
  }, [sslInfo.log, showLog])

  useEffect(() => {
    if (applyBtLog && applyLogRef.current) {
      applyLogRef.current.scrollTop = applyLogRef.current.scrollHeight
    }
  }, [applyBtLog])

  async function issueCert() {
    if (!domain) return
    setIssuing(true)
    setShowLog(true)
    setSslInfo((prev) => ({ ...prev, log: '正在申请证书，请稍候...\n' }))
    startSslLogSocket()
    try {
      const res = await api.post(`/ssl/issue/${domain.id}`, {
        verify_method: form.verify_method,
        cert_type: form.cert_type,
        webroot: form.webroot
      })
      setSslInfo((prev) => ({ ...prev, log: res.log || prev.log }))
      if (res.success) {
        message.success(res.message)
        onRefresh?.()
      } else {
        message.error(res.message || '申请失败')
      }
    } catch (e) {
      const serverLog = getErrorLog(e)
      setSslInfo((prev) => ({ ...prev, log: serverLog || `${prev.log}\n错误: ${e.message}` }))
    } finally {
      setIssuing(false)
      stopSslLogSocket()
      await refreshStatus()
    }
  }

  async function renewCert() {
    if (!domain) return
    setRenewing(true)
    setShowLog(true)
    setSslInfo((prev) => ({ ...prev, log: '正在续期证书，请稍候...\n' }))
    startSslLogSocket()
    try {
      const res = await api.post(`/ssl/renew/${domain.id}`)
      setSslInfo((prev) => ({ ...prev, log: res.log || prev.log }))
      if (res.success) {
        message.success(res.message)
        onRefresh?.()
      } else {
        message.error(res.message || '续期失败')
      }
    } catch (e) {
      const serverLog = getErrorLog(e)
      setSslInfo((prev) => ({ ...prev, log: serverLog || `${prev.log}\n错误: ${e.message}` }))
    } finally {
      setRenewing(false)
      stopSslLogSocket()
      await refreshStatus()
    }
  }

  async function viewCert() {
    if (!domain) return
    setViewing(true)
    try {
      const res = await api.get(`/ssl/view/${domain.id}`)
      setCertContent(res.cert || '(无法读取证书内容)')
      setKeyContent(res.key || '(无法读取私钥内容)')
      setCertTab('cert')
      setCertDialogVisible(true)
    } finally {
      setViewing(false)
    }
  }

  async function downloadCert() {
    if (!domain) return
    setDownloading(true)
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`${API_BASE}/api/ssl/download/${domain.id}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!response.ok) throw new Error('下载失败')
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${domain.domain}_ssl.zip`
      a.click()
      window.URL.revokeObjectURL(url)
      message.success('证书下载成功')
    } catch (e) {
      message.error(e.message || '下载失败')
    } finally {
      setDownloading(false)
    }
  }

  async function showCertFiles() {
    if (!domain) return
    setLoadingFiles(true)
    try {
      const res = await api.get(`/ssl/files/${domain.id}`)
      setCertFiles(res.files || [])
      setCertFilesInfo({
        domain: res.domain || domain.domain,
        stored: !!res.stored,
        dir: res.dir || '',
        metadata: res.metadata || null
      })
      setCertFilesDialogVisible(true)
    } finally {
      setLoadingFiles(false)
    }
  }

  function openPublishDialog() {
    if (!domain) return
    setPublishForm((prev) => ({
      target_dir: prev.target_dir || `/www/certs/${domain.domain}`,
      server_id: prev.server_id || defaultServer?.id || ''
    }))
    setPublishDialogVisible(true)
  }

  async function publishCert() {
    if (!domain) return
    setPublishing(true)
    try {
      const res = await api.post(`/ssl/publish/${domain.id}`, {
        server_id: publishForm.server_id || null,
        target_dir: publishForm.target_dir || `/www/certs/${domain.domain}`
      })
      setSslInfo((prev) => ({ ...prev, log: res.log || prev.log }))
      setShowLog(true)
      setPublishDialogVisible(false)
      message.success(res.message || '证书发布成功')
    } catch (e) {
      const serverLog = getErrorLog(e)
      setSslInfo((prev) => ({ ...prev, log: serverLog || `${prev.log}\n错误: ${e.message}` }))
      setShowLog(true)
    } finally {
      setPublishing(false)
    }
  }

  async function loadBtSites(serverId) {
    const sid = serverId || applyBtForm.server_id
    if (!sid) return
    setLoadingBtSites(true)
    setSelectedBtSites([])
    try {
      const res = await api.get(`/ssl/bt-sites/${sid}`)
      setBtSites(res.sites || [])
    } catch (e) {
      message.error(e.message || '加载宝塔网站失败')
      setBtSites([])
    } finally {
      setLoadingBtSites(false)
    }
  }

  function openApplyBtDialog() {
    setApplyBtLog('')
    setBtSites([])
    setSelectedBtSites([])
    setBtSiteKeyword('')
    const serverId = defaultServer?.id || ''
    setApplyBtForm({ server_id: serverId, force_https: true })
    setApplyBtDialogVisible(true)
    if (serverId) loadBtSites(serverId)
  }

  async function executeApplyBt() {
    if (!domain) return
    if (selectedBtSites.length === 0) {
      message.warning('请选择要应用证书的网站')
      return
    }

    setApplyingBt(true)
    setApplyBtLog('')
    let successCount = 0
    let failedCount = 0
    let logText = ''

    for (const site of selectedBtSites) {
      logText += `\n>>> 处理 ${site.name}...\n`
      setApplyBtLog(logText)
      try {
        const res = await api.post('/ssl/apply-to-bt-site', {
          domain_id: domain.id,
          server_id: applyBtForm.server_id,
          site_name: site.name,
          force_https: applyBtForm.force_https
        })
        logText += res.log || ''
        successCount += 1
      } catch (e) {
        logText += getErrorLog(e) || `错误: ${e.message}\n`
        failedCount += 1
      }
      setApplyBtLog(logText)
    }

    logText += `\n========== 完成: 成功 ${successCount} 个, 失败 ${failedCount} 个 ==========\n`
    setApplyBtLog(logText)
    message.success(`应用完成: 成功 ${successCount} 个, 失败 ${failedCount} 个`)
    await loadBtSites(applyBtForm.server_id)
    setApplyingBt(false)
  }

  const certFileColumns = [
    {
      title: '类型',
      width: 90,
      render: (_, row) => (
        <Tag color={row.missing ? 'default' : row.type === 'key' ? 'error' : 'success'}>{row.label}</Tag>
      )
    },
    { title: '文件名', dataIndex: 'name', ellipsis: true },
    {
      title: '大小',
      width: 95,
      render: (_, row) => (row.missing ? '-' : formatFileSize(row.size))
    },
    {
      title: '更新时间',
      width: 155,
      render: (_, row) => row.modified_at || '-'
    },
    {
      title: '路径',
      ellipsis: true,
      render: (_, row) => (
        <div className="ssl-file-path-cell">
          <span className={`ssl-path ${row.missing ? 'muted' : ''}`}>{row.path}</span>
          <Button type="link" size="small" onClick={() => copyText(row.path)}>复制</Button>
        </div>
      )
    }
  ]

  const btSiteColumns = [
    { title: '网站域名', dataIndex: 'name', ellipsis: true },
    {
      title: '当前SSL',
      width: 100,
      render: (_, row) => (
        <Tag color={row.has_ssl ? 'success' : 'default'}>{row.has_ssl ? '已启用' : '未启用'}</Tag>
      )
    },
    { title: '配置路径', dataIndex: 'config_path', ellipsis: true }
  ]

  const serverOptions = servers.map((s) => ({
    value: s.id,
    label: `${s.name || s.ip} (${s.ip})${s.is_default ? ' - 默认' : ''}`
  }))

  return (
    <>
      <Modal
        title="SSL证书管理"
        open={open}
        onCancel={onClose}
        width={750}
        destroyOnClose={false}
        footer={(
          <Space wrap>
            <Button onClick={onClose}>关闭</Button>
            <Button type="primary" ghost disabled={!sslInfo.local_cert?.stored} onClick={openPublishDialog}>发布证书</Button>
            <Button disabled={!sslInfo.local_cert?.stored} onClick={openApplyBtDialog}>应用到宝塔网站</Button>
            <Button type="primary" ghost disabled={!sslInfo.exists} loading={renewing} onClick={renewCert}>续期证书</Button>
            <Button type="primary" disabled={!canIssueCert} loading={issuing} onClick={issueCert}>申请证书</Button>
          </Space>
        )}
      >
        {domain ? (
          <>
            <div className="ssl-head">
              <span>域名: <strong className="ssl-full-domain">{domain.domain}</strong></span>
              {form.verify_method === 'dns' ? <Tag>*.{domain.domain}</Tag> : null}
              <Tag color={getSslStatusColor(sslInfo.status)}>{getSslStatusText(sslInfo.status)}</Tag>
              <Button type="link" size="small" loading={refreshing} onClick={refreshStatus}>刷新状态</Button>
              <Button size="small" type="primary" icon={<FolderOpenOutlined />} loading={loadingFiles} onClick={showCertFiles}>证书文件</Button>
              <Button size="small" type="primary" ghost icon={<UploadOutlined />} disabled={!sslInfo.local_cert?.stored} onClick={openPublishDialog}>发布证书</Button>
            </div>

            {sslInfo.exists ? (
              <div className="ssl-block">
                <div className="ssl-block-head">
                  <strong>证书信息</strong>
                  <Space>
                    <Button size="small" type="primary" loading={viewing} onClick={viewCert}>查看证书</Button>
                    <Button size="small" type="primary" ghost loading={downloading} onClick={downloadCert}>下载证书</Button>
                    <Button type="link" size="small" onClick={() => setShowCertInfo((v) => !v)}>{showCertInfo ? '收起' : '展开'}</Button>
                  </Space>
                </div>
                {showCertInfo ? (
                  <div className="ssl-info-box">
                    <p><strong>证书类型：</strong>{sslInfo.san?.includes('*') ? '通配符证书' : '单域名证书'}</p>
                    <p><strong>覆盖域名：</strong>{sslInfo.san || domain.domain}</p>
                    <p><strong>颁发机构：</strong>{sslInfo.issuer || '-'}</p>
                    <p><strong>生效时间：</strong>{sslInfo.not_before || '-'}</p>
                    <p><strong>过期时间：</strong>{sslInfo.not_after || '-'}</p>
                    <p><strong>证书路径：</strong><span className="ssl-muted">{sslInfo.paths?.fullchain}</span></p>
                    <p><strong>私钥路径：</strong><span className="ssl-muted">{sslInfo.paths?.key}</span></p>
                  </div>
                ) : null}
              </div>
            ) : null}

            <Form labelCol={{ style: { width: 100 } }} colon={false}>
              <Form.Item label="验证方式">
                <Radio.Group
                  optionType="button"
                  value={form.verify_method}
                  onChange={(e) => setForm((prev) => ({ ...prev, verify_method: e.target.value }))}
                  options={[
                    { label: 'DNS验证 (通配符)', value: 'dns' },
                    { label: 'HTTP验证 (单域名)', value: 'http' },
                    { label: 'Standalone (单域名)', value: 'standalone' }
                  ]}
                />
              </Form.Item>
              <Form.Item label="证书类型">
                <Select
                  value={form.cert_type}
                  onChange={(value) => setForm((prev) => ({ ...prev, cert_type: value }))}
                  options={Object.entries(certTypes).map(([value, info]) => ({
                    value,
                    label: `${info.name} - ${info.desc}`
                  }))}
                />
              </Form.Item>
              <Form.Item label="签发服务器">
                <div className="ssl-issue-server">
                  <Tag color={defaultServer ? 'success' : 'warning'}>
                    {defaultServer ? `${defaultServer.name || defaultServer.ip} (${defaultServer.ip})` : '未设置默认服务器'}
                  </Tag>
                  <span className="ssl-note">申请和续期统一使用默认服务器，证书会保存到当前项目 uploads/certs。</span>
                </div>
              </Form.Item>
              {form.verify_method === 'http' ? (
                <Form.Item label="网站目录">
                  <Input
                    value={form.webroot}
                    placeholder={`/www/wwwroot/ftp/${domain.domain}`}
                    onChange={(e) => setForm((prev) => ({ ...prev, webroot: e.target.value }))}
                  />
                </Form.Item>
              ) : null}
            </Form>

            {form.verify_method === 'dns' && !hasDnsConfig ? (
              <Alert type="error" showIcon={false} style={{ marginBottom: 15 }} message="通配符证书需要配置 DNS 平台（编辑域名选择 DNS 平台配置）" />
            ) : null}
            {form.verify_method === 'http' ? (
              <Alert type="info" showIcon={false} style={{ marginBottom: 15 }} message={`HTTP 验证仅申请主域名 ${domain.domain}，需确保 80 端口可访问且网站目录正确。`} />
            ) : null}
            {form.verify_method === 'standalone' ? (
              <Alert type="warning" showIcon={false} style={{ marginBottom: 15 }} message={`Standalone 模式会临时停止 Nginx 释放 80 端口，仅申请主域名 ${domain.domain}。`} />
            ) : null}

            {sslInfo.log ? (
              <div className="ssl-block">
                <div className="ssl-block-head">
                  <strong>申请日志</strong>
                  <Button type="link" size="small" onClick={() => setShowLog((v) => !v)}>{showLog ? '收起' : '展开'}</Button>
                </div>
                {showLog ? <div className="ssl-log-box" ref={logBoxRef}>{sslInfo.log}</div> : null}
              </div>
            ) : null}
          </>
        ) : null}
      </Modal>

      <Modal
        title="证书内容"
        open={certDialogVisible}
        onCancel={() => setCertDialogVisible(false)}
        width={800}
        footer={(
          <Space>
            <Button onClick={() => copyText(certTab === 'cert' ? certContent : keyContent)}>复制内容</Button>
            <Button type="primary" onClick={() => setCertDialogVisible(false)}>关闭</Button>
          </Space>
        )}
      >
        <Tabs
          activeKey={certTab}
          onChange={setCertTab}
          items={[
            { key: 'cert', label: '证书 (fullchain.crt)', children: <div className="ssl-log-box">{certContent}</div> },
            { key: 'key', label: '私钥 (key)', children: <div className="ssl-log-box">{keyContent}</div> }
          ]}
        />
      </Modal>

      <Modal
        title="证书文件"
        open={certFilesDialogVisible}
        onCancel={() => setCertFilesDialogVisible(false)}
        width={820}
        footer={<Button type="primary" onClick={() => setCertFilesDialogVisible(false)}>关闭</Button>}
      >
        {certFilesInfo.domain ? (
          <div className="ssl-files-head">
            <div>
              <span className="ssl-files-label">本地域名</span>
              <strong>{certFilesInfo.domain}</strong>
            </div>
            <Tag color={certFilesInfo.stored ? 'success' : 'warning'}>
              {certFilesInfo.stored ? '已保存完整证书' : '本地证书不完整'}
            </Tag>
          </div>
        ) : null}
        <div className="ssl-dir-row">
          <span className="ssl-files-label">本地目录</span>
          <span className="ssl-path">{certFilesInfo.dir || '-'}</span>
          {certFilesInfo.dir ? <Button type="link" size="small" onClick={() => copyText(certFilesInfo.dir)}>复制</Button> : null}
        </div>
        <Table
          rowKey={(r) => r.path || r.name}
          size="small"
          bordered
          pagination={false}
          columns={certFileColumns}
          dataSource={certFiles}
        />
        {certFiles.length === 0 ? <Empty description="暂无证书文件" /> : null}
      </Modal>

      <Modal
        title="发布证书"
        open={publishDialogVisible}
        onCancel={() => setPublishDialogVisible(false)}
        width={620}
        confirmLoading={publishing}
        okText="发布"
        okButtonProps={{ type: 'primary' }}
        onOk={publishCert}
      >
        <Form labelCol={{ style: { width: 100 } }}>
          <Form.Item label="发布服务器">
            <Select
              allowClear
              placeholder="默认服务器"
              value={publishForm.server_id || undefined}
              onChange={(value) => setPublishForm((prev) => ({ ...prev, server_id: value || '' }))}
              options={serverOptions}
            />
          </Form.Item>
          <Form.Item label="发布目录">
            <Input
              value={publishForm.target_dir}
              placeholder={`/www/certs/${domain?.domain}`}
              onChange={(e) => setPublishForm((prev) => ({ ...prev, target_dir: e.target.value }))}
            />
          </Form.Item>
        </Form>
        <div className="ssl-publish-preview">
          <div><span>证书链</span>{publishForm.target_dir}/{domain?.domain}.fullchain.crt</div>
          <div><span>私钥</span>{publishForm.target_dir}/{domain?.domain}.key</div>
          <div><span>证书</span>{publishForm.target_dir}/{domain?.domain}.crt</div>
        </div>
      </Modal>

      <Modal
        title="应用证书到宝塔网站"
        open={applyBtDialogVisible}
        onCancel={() => setApplyBtDialogVisible(false)}
        width={720}
        style={{ top: '5vh' }}
        footer={(
          <Space>
            <Button onClick={() => setApplyBtDialogVisible(false)}>关闭</Button>
            <Button type="primary" loading={applyingBt} disabled={selectedBtSites.length === 0} onClick={executeApplyBt}>
              应用到 {selectedBtSites.length} 个网站
            </Button>
          </Space>
        )}
      >
        <Alert
          type="info"
          showIcon={false}
          style={{ marginBottom: 15 }}
          message="选择目标服务器后，会自动列出宝塔已有的网站。选中需要应用证书的网站，证书会发布到 /www/server/panel/vhost/cert/ 下并自动改写网站 nginx 配置启用 HTTPS。"
        />
        <Form labelCol={{ style: { width: 100 } }}>
          <Form.Item label="目标服务器">
            <Select
              placeholder="选择服务器"
              value={applyBtForm.server_id || undefined}
              options={serverOptions}
              onChange={(value) => {
                setApplyBtForm((prev) => ({ ...prev, server_id: value }))
                loadBtSites(value)
              }}
            />
          </Form.Item>
          <Form.Item label="强制 HTTPS">
            <Space>
              <Switch
                checked={applyBtForm.force_https}
                onChange={(checked) => setApplyBtForm((prev) => ({ ...prev, force_https: checked }))}
              />
              <span className="ssl-note">开启后访问 HTTP 会自动跳转 HTTPS</span>
            </Space>
          </Form.Item>
        </Form>
        {applyBtForm.server_id ? (
          <div>
            <div className="ssl-block-head" style={{ marginBottom: 10 }}>
              <span style={{ fontWeight: 600 }}>选择网站 ({btSites.length} 个)</span>
              <Space>
                <Input
                  allowClear
                  size="small"
                  placeholder="搜索网站..."
                  style={{ width: 200 }}
                  value={btSiteKeyword}
                  onChange={(e) => setBtSiteKeyword(e.target.value)}
                />
                <Button size="small" loading={loadingBtSites} onClick={() => loadBtSites()}>刷新</Button>
              </Space>
            </div>
            <Table
              rowKey={(r) => r.name}
              size="small"
              loading={loadingBtSites}
              columns={btSiteColumns}
              dataSource={filteredBtSites}
              pagination={false}
              scroll={{ y: 350 }}
              rowSelection={{
                selectedRowKeys: selectedBtSites.map((s) => s.name),
                onChange: (_, rows) => setSelectedBtSites(rows)
              }}
            />
            {btSites.length === 0 && !loadingBtSites ? (
              <div style={{ textAlign: 'center', color: '#909399', padding: 20 }}>未找到宝塔网站</div>
            ) : null}
          </div>
        ) : null}
        {applyBtLog ? <div className="ssl-log-box" style={{ marginTop: 15, maxHeight: 300 }} ref={applyLogRef}>{applyBtLog}</div> : null}
      </Modal>

      <style>{`
        .ssl-head { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; }
        .ssl-full-domain { color: #1677ff; font-weight: 700; }
        .ssl-block { margin-bottom: 20px; }
        .ssl-block-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; gap: 8px; }
        .ssl-info-box { background: #f5f7fa; padding: 15px; border-radius: 4px; }
        .ssl-info-box p { margin: 5px 0; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
        .ssl-muted { font-size: 12px; color: #666; }
        .ssl-note { color: #909399; font-size: 12px; line-height: 1.4; }
        .ssl-issue-server { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .ssl-log-box { background: #1e1e1e; color: #d4d4d4; padding: 15px; border-radius: 6px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; max-height: 300px; overflow-y: auto; white-space: pre-wrap; word-break: break-all; }
        .ssl-files-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
        .ssl-files-label { color: #606266; margin-right: 8px; font-size: 13px; }
        .ssl-dir-row { display: flex; align-items: center; gap: 8px; padding: 10px 12px; margin-bottom: 12px; background: #f5f7fa; border-radius: 4px; }
        .ssl-path { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; color: #303133; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ssl-path.muted { color: #909399; }
        .ssl-file-path-cell { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px; min-width: 0; }
        .ssl-publish-preview { background: #f5f7fa; border-radius: 4px; padding: 10px 12px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; color: #303133; }
        .ssl-publish-preview div { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 8px; line-height: 1.8; word-break: break-all; }
        .ssl-publish-preview span { color: #606266; }
      `}</style>
    </>
  )
}
