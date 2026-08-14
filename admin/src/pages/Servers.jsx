import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Button,
  Checkbox,
  DatePicker,
  Dropdown,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Spin,
  Table,
  Tag,
  message
} from 'antd'
import { CopyOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import api from '@/api'
import { qk } from '@/api/queryKeys'
import PageCard from '@/components/PageCard'
import FileManager from '@/components/FileManager'
import ServerTerminal from '@/components/ServerTerminal'
import { confirmAction, copyText, formatDateTime } from '@/utils'
import { getTagStyle, parseTagList } from '@/utils/server-tag-filter'
import './Servers.css'

function getExpireDays(expireAt) {
  if (!expireAt) return null
  const expire = new Date(expireAt)
  if (Number.isNaN(expire.getTime())) return null
  return Math.ceil((expire - new Date()) / (1000 * 60 * 60 * 24))
}

function getExpireClass(expireAt) {
  const daysLeft = getExpireDays(expireAt)
  if (daysLeft === null) return ''
  if (daysLeft < 0) return 'is-expired'
  if (daysLeft <= 7) return 'is-urgent'
  if (daysLeft <= 30) return 'is-soon'
  return 'is-ok'
}

function getExpireDaysText(expireAt) {
  const daysLeft = getExpireDays(expireAt)
  if (daysLeft === null) return ''
  if (daysLeft < 0) return `已过期 ${Math.abs(daysLeft)} 天`
  if (daysLeft === 0) return '今天到期'
  if (daysLeft === 1) return '明天到期'
  return `还剩 ${daysLeft} 天`
}

export default function Servers() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: servers = [], isFetching, refetch } = useQuery({
    queryKey: qk.servers,
    queryFn: () => api.get('/servers')
  })
  const { data: tags = [] } = useQuery({
    queryKey: qk.tags,
    queryFn: () => api.get('/tags')
  })

  const [searchKeyword, setSearchKeyword] = useState('')
  const [filterTag, setFilterTag] = useState()
  const [filterStatus, setFilterStatus] = useState()
  const [filterExpiringSoon, setFilterExpiringSoon] = useState(false)
  const [testingIds, setTestingIds] = useState({})
  const [statusChangingIds, setStatusChangingIds] = useState({})

  const [dialogVisible, setDialogVisible] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()
  const editingId = Form.useWatch('id', form)

  const [currentServer, setCurrentServer] = useState(null)
  const [fileManagerVisible, setFileManagerVisible] = useState(false)
  const [terminalVisible, setTerminalVisible] = useState(false)

  const [softwareDialogVisible, setSoftwareDialogVisible] = useState(false)
  const [loadingSoftware, setLoadingSoftware] = useState(false)
  const [installingNginx, setInstallingNginx] = useState(false)
  const [installingFtp, setInstallingFtp] = useState(false)
  const [restartingNginx, setRestartingNginx] = useState(false)
  const [restartingFtp, setRestartingFtp] = useState(false)
  const [softwareStatus, setSoftwareStatus] = useState({ nginx: {}, vsftpd: {}, pureFtpd: {} })

  const [configDialogVisible, setConfigDialogVisible] = useState(false)
  const [configTitle, setConfigTitle] = useState('')
  const [configContent, setConfigContent] = useState('')
  const [configPath, setConfigPath] = useState('')
  const [loadingConfig, setLoadingConfig] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)

  const hasFilters = !!(searchKeyword.trim() || filterTag || filterStatus || filterExpiringSoon)

  const filteredServers = useMemo(() => {
    const kw = searchKeyword.trim().toLowerCase()
    return servers.filter((row) => {
      const status = row.status === 'disabled' ? 'disabled' : 'active'
      if (filterStatus && status !== filterStatus) return false
      if (filterTag && !parseTagList(row.tags).includes(filterTag)) return false
      if (filterExpiringSoon) {
        const days = getExpireDays(row.expire_at)
        if (days === null || days > 7) return false
      }
      if (!kw) return true
      const hay = [row.name, row.ip, String(row.port || ''), row.username, row.tags].join(' ').toLowerCase()
      return hay.includes(kw)
    })
  }, [servers, searchKeyword, filterTag, filterStatus, filterExpiringSoon])

  function openDialog(row) {
    if (row) {
      form.setFieldsValue({
        id: row.id,
        name: row.name,
        ip: row.ip,
        port: row.port,
        username: row.username,
        password: '',
        nginx_path: row.nginx_path || '/www/server/panel/vhost/nginx',
        ftp_path: row.ftp_path || '/www/wwwroot/ftp',
        tagList: parseTagList(row.tags),
        expire_at: row.expire_at ? dayjs(row.expire_at) : null
      })
    } else {
      const defaultTag = tags.find((t) => t.is_default === 1)
      form.setFieldsValue({
        id: null,
        name: '',
        ip: '',
        port: 22,
        username: '',
        password: '',
        nginx_path: '/www/server/panel/vhost/nginx',
        ftp_path: '/www/wwwroot/ftp',
        tagList: defaultTag ? [defaultTag.name] : [],
        expire_at: null
      })
    }
    setDialogVisible(true)
  }

  async function onTagChange(tagNames) {
    for (const tag of tagNames) {
      if (!tags.some((t) => t.name === tag)) {
        try {
          await api.post('/tags', { name: tag })
          queryClient.invalidateQueries({ queryKey: qk.tags })
        } catch {
          // 拦截器已提示
        }
      }
    }
  }

  async function handleSave() {
    const values = await form.validateFields()
    setSaving(true)
    try {
      const data = {
        ...values,
        tags: (values.tagList || []).join(','),
        expire_at: values.expire_at ? dayjs(values.expire_at).format('YYYY-MM-DD HH:mm:ss') : null
      }
      if (values.id) await api.put(`/servers/${values.id}`, data)
      else await api.post('/servers', data)
      message.success('保存成功')
      setDialogVisible(false)
      queryClient.invalidateQueries({ queryKey: qk.servers })
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    await confirmAction('确定删除此服务器？已绑定站点不会自动解绑。', '删除服务器')
    await api.delete(`/servers/${id}`)
    message.success('删除成功')
    queryClient.invalidateQueries({ queryKey: qk.servers })
  }

  async function testServer(row) {
    setTestingIds((s) => ({ ...s, [row.id]: true }))
    try {
      const res = await api.post(`/servers/${row.id}/test`)
      res.success ? message.success(res.message) : message.error(res.message)
    } finally {
      setTestingIds((s) => ({ ...s, [row.id]: false }))
    }
  }

  async function toggleServerStatus(row) {
    const disabling = row.status !== 'disabled'
    try {
      await confirmAction(
        disabling ? '停用后无法再分配新站点，已绑定站点不受影响。' : '启用后可继续分配站点。',
        disabling ? '停用服务器' : '启用服务器'
      )
    } catch {
      return
    }
    const nextStatus = disabling ? 'disabled' : 'active'
    setStatusChangingIds((s) => ({ ...s, [row.id]: true }))
    try {
      const res = await api.put(`/servers/${row.id}/status`, { status: nextStatus })
      message.success(res.message)
      queryClient.invalidateQueries({ queryKey: qk.servers })
    } finally {
      setStatusChangingIds((s) => ({ ...s, [row.id]: false }))
    }
  }

  function viewDomains(row) {
    navigate(`/subdomains?server_id=${row.id}`)
  }

  function openFileManager(row) {
    setCurrentServer(row)
    setFileManagerVisible(true)
  }

  function openTerminal(row) {
    setCurrentServer(row)
    setTerminalVisible(true)
  }

  async function setDefault(row) {
    await api.post(`/servers/${row.id}/set-default`)
    message.success('已设为默认')
    queryClient.invalidateQueries({ queryKey: qk.servers })
  }

  async function loadSoftwareStatus(server) {
    const target = server || currentServer
    if (!target) return
    setLoadingSoftware(true)
    try {
      const res = await api.get(`/servers/${target.id}/software-status`)
      setSoftwareStatus(res)
    } finally {
      setLoadingSoftware(false)
    }
  }

  async function openSoftwareDialog(row) {
    setCurrentServer(row)
    setSoftwareDialogVisible(true)
    await loadSoftwareStatus(row)
  }

  async function installNginx() {
    setInstallingNginx(true)
    try {
      const res = await api.post(`/servers/${currentServer.id}/install-nginx`)
      message.success(res.message)
      await loadSoftwareStatus()
    } finally {
      setInstallingNginx(false)
    }
  }

  async function installFtp() {
    setInstallingFtp(true)
    try {
      const res = await api.post(`/servers/${currentServer.id}/install-ftp`)
      message.success(res.message)
      await loadSoftwareStatus()
    } finally {
      setInstallingFtp(false)
    }
  }

  async function restartNginx() {
    setRestartingNginx(true)
    try {
      const res = await api.post(`/servers/${currentServer.id}/restart-nginx`)
      message.success(res.message)
    } finally {
      setRestartingNginx(false)
    }
  }

  async function restartFtp() {
    setRestartingFtp(true)
    try {
      const res = await api.post(`/servers/${currentServer.id}/restart-ftp`)
      message.success(res.message)
    } finally {
      setRestartingFtp(false)
    }
  }

  async function loadConfig(path) {
    setConfigPath(path)
    setConfigDialogVisible(true)
    setLoadingConfig(true)
    try {
      const res = await api.post(`/servers/${currentServer.id}/files/read`, { path })
      setConfigContent(res.content || '')
    } catch {
      setConfigContent('')
    } finally {
      setLoadingConfig(false)
    }
  }

  function viewNginxConfig() {
    const path = softwareStatus.nginx?.configPath || '/etc/nginx/nginx.conf'
    setConfigTitle(`Nginx 配置 - ${path}`)
    loadConfig(path)
  }

  function viewFtpConfig() {
    const path = softwareStatus.vsftpd?.configPath || '/etc/vsftpd.conf'
    setConfigTitle(`FTP 配置 - ${path}`)
    loadConfig(path)
  }

  async function saveConfig() {
    setSavingConfig(true)
    try {
      await api.post(`/servers/${currentServer.id}/files/write`, {
        path: configPath,
        content: configContent
      })
      message.success('配置已保存')
      setConfigDialogVisible(false)
    } finally {
      setSavingConfig(false)
    }
  }

  const columns = [
    {
      title: '服务器',
      minWidth: 280,
      render: (_, row) => (
        <div className="server-cell">
          <span className="server-name" title={row.name}>{row.name}</span>
          {row.is_default === 1 && <Tag color="orange">默认</Tag>}
          {parseTagList(row.tags).map((tag) => (
            <Tag key={tag} style={getTagStyle(tag, tags)}>{tag}</Tag>
          ))}
        </div>
      )
    },
    {
      title: '连接',
      minWidth: 220,
      render: (_, row) => (
        <div className="conn-cell">
          <span
            className="conn-addr"
            title={`点击复制 ${row.ip}:${row.port}`}
            onClick={() => copyText(`${row.ip}:${row.port}`)}
          >
            {row.ip}:{row.port}
          </span>
          <CopyOutlined className="server-copy-btn" onClick={() => copyText(`${row.ip}:${row.port}`)} />
          <span className="conn-secondary">{row.username || '-'}</span>
        </div>
      )
    },
    {
      title: '状态',
      width: 90,
      render: (_, row) => (
        <Tag color={row.status === 'disabled' ? 'error' : 'success'}>
          {row.status === 'disabled' ? '停用' : '正常'}
        </Tag>
      )
    },
    {
      title: '到期',
      width: 160,
      render: (_, row) => (row.expire_at ? (
        <div className="expire-cell">
          <span className={`expire-date ${getExpireClass(row.expire_at)}`}>{formatDateTime(row.expire_at)}</span>
          <span className={`expire-days ${getExpireClass(row.expire_at)}`}>{getExpireDaysText(row.expire_at)}</span>
        </div>
      ) : <span className="expire-muted">永久</span>)
    },
    {
      title: '操作',
      width: 210,
      fixed: 'right',
      render: (_, row) => (
        <div className="row-actions">
          <Button
            size="small"
            color="green"
            variant="solid"
            loading={!!testingIds[row.id]}
            onClick={() => testServer(row)}
          >
            测试
          </Button>
          <Button
            size="small"
            color={row.status === 'disabled' ? 'green' : 'orange'}
            variant="solid"
            loading={!!statusChangingIds[row.id]}
            onClick={() => toggleServerStatus(row).catch(() => {})}
          >
            {row.status === 'disabled' ? '启用' : '停用'}
          </Button>
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                { key: 'software', label: '软件管理', onClick: () => openSoftwareDialog(row) },
                { key: 'files', label: '文件管理', onClick: () => openFileManager(row) },
                { key: 'terminal', label: '终端', onClick: () => openTerminal(row) },
                { key: 'domains', label: '查看域名', onClick: () => viewDomains(row) },
                { key: 'password', label: '复制密码', disabled: !row.password, onClick: () => copyText(row.password) },
                { key: 'default', label: '设为默认', disabled: row.is_default === 1, onClick: () => setDefault(row) },
                { key: 'edit', label: '编辑', onClick: () => openDialog(row) },
                { type: 'divider' },
                { key: 'del', label: <span style={{ color: '#ff4d4f' }}>删除</span>, onClick: () => handleDelete(row.id).catch(() => {}) }
              ]
            }}
          >
            <Button size="small">更多</Button>
          </Dropdown>
        </div>
      )
    }
  ]

  return (
    <PageCard
      title={(
        <>
          服务器列表
          <Tag>{filteredServers.length}</Tag>
        </>
      )}
      extra={(
        <>
          <Button size="small" icon={<ReloadOutlined />} loading={isFetching} onClick={() => refetch()} />
          <Button type="primary" size="small" onClick={() => openDialog()}>添加服务器</Button>
        </>
      )}
      filters={(
        <>
          <Input
            size="small"
            allowClear
            placeholder="搜索名称、IP、用户名..."
            prefix={<SearchOutlined />}
            className="filter-search"
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
          />
          <Select
            allowClear
            size="small"
            placeholder="标签"
            className="filter-select"
            value={filterTag}
            onChange={setFilterTag}
            options={tags.map((t) => ({ value: t.name, label: t.name }))}
          />
          <Select
            allowClear
            size="small"
            placeholder="状态"
            className="filter-select-narrow"
            value={filterStatus}
            onChange={setFilterStatus}
            options={[
              { value: 'active', label: '正常' },
              { value: 'disabled', label: '停用' }
            ]}
          />
          <Checkbox checked={filterExpiringSoon} onChange={(e) => setFilterExpiringSoon(e.target.checked)}>
            7天内到期
          </Checkbox>
          <span className="servers-record-count">共 {filteredServers.length} 台</span>
        </>
      )}
    >
      {!isFetching && filteredServers.length === 0 ? (
        <Empty description={hasFilters ? '没有匹配的服务器' : '还没有服务器，点击右上角添加'} />
      ) : (
        <Table
          rowKey="id"
          size="small"
          loading={isFetching}
          columns={columns}
          dataSource={filteredServers}
          pagination={false}
          scroll={{ x: 960 }}
        />
      )}

      <Modal
        title={editingId ? '编辑服务器' : '添加服务器'}
        open={dialogVisible}
        confirmLoading={saving}
        onOk={handleSave}
        onCancel={() => setDialogVisible(false)}
        width={760}
        destroyOnClose
      >
        <Form
          form={form}
          labelCol={{ style: { width: 92 } }}
          initialValues={{ port: 22, tagList: [] }}
        >
          <Form.Item name="id" hidden><Input /></Form.Item>
          <div className="server-form-grid">
            <section className="server-form-section">
              <h4>连接信息</h4>
              <Form.Item name="name" label="名称">
                <Input placeholder="服务器名称" />
              </Form.Item>
              <Form.Item label="地址">
                <div className="server-addr-row">
                  <Form.Item name="ip" noStyle>
                    <Input placeholder="服务器 IP" />
                  </Form.Item>
                  <Form.Item name="port" noStyle>
                    <InputNumber min={1} max={65535} />
                  </Form.Item>
                </div>
              </Form.Item>
              <Form.Item name="username" label="用户名">
                <Input placeholder="SSH 用户名" />
              </Form.Item>
              <Form.Item name="password" label="密码">
                <Input.Password placeholder={editingId ? '留空则不修改' : 'SSH 密码'} />
              </Form.Item>
            </section>
            <section className="server-form-section">
              <h4>路径与到期</h4>
              <Form.Item name="nginx_path" label="Nginx 目录">
                <Input placeholder="/www/server/panel/vhost/nginx" />
              </Form.Item>
              <Form.Item name="ftp_path" label="FTP 目录">
                <Input placeholder="/www/wwwroot/ftp" />
              </Form.Item>
              <Form.Item name="tagList" label="标签">
                <Select
                  mode="tags"
                  placeholder="选择或输入标签"
                  options={tags.map((t) => ({ value: t.name, label: t.name }))}
                  onChange={onTagChange}
                />
              </Form.Item>
              <Form.Item name="expire_at" label="到期时间">
                <DatePicker
                  showTime
                  allowClear
                  format="YYYY-MM-DD HH:mm:ss"
                  placeholder="留空表示永久"
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </section>
          </div>
        </Form>
      </Modal>

      <FileManager
        open={fileManagerVisible}
        server={currentServer}
        onClose={() => setFileManagerVisible(false)}
      />
      <ServerTerminal
        open={terminalVisible}
        server={currentServer}
        onClose={() => setTerminalVisible(false)}
      />

      <Modal
        title={`软件管理 - ${currentServer?.name || ''}`}
        open={softwareDialogVisible}
        onCancel={() => setSoftwareDialogVisible(false)}
        width={550}
        footer={[
          <Button key="close" onClick={() => setSoftwareDialogVisible(false)}>关闭</Button>,
          <Button key="refresh" type="primary" onClick={() => loadSoftwareStatus()}>刷新状态</Button>
        ]}
      >
        <Spin spinning={loadingSoftware}>
          <div className="software-item">
            <div className="software-info">
              <span className="software-name">Nginx</span>
              {softwareStatus.nginx?.installed
                ? <Tag color="success">已安装</Tag>
                : <Tag>未安装</Tag>}
            </div>
            <div className="software-actions">
              {softwareStatus.nginx?.installed && (
                <Button size="small" onClick={viewNginxConfig}>配置</Button>
              )}
              {!softwareStatus.nginx?.installed ? (
                <Button type="primary" size="small" loading={installingNginx} onClick={installNginx}>安装</Button>
              ) : (
                <Button size="small" color="orange" variant="solid" loading={restartingNginx} onClick={restartNginx}>重启</Button>
              )}
            </div>
          </div>
          <div className="software-item">
            <div className="software-info">
              <span className="software-name">FTP (vsftpd)</span>
              {softwareStatus.vsftpd?.installed
                ? <Tag color="success">已安装</Tag>
                : <Tag>未安装</Tag>}
            </div>
            <div className="software-actions">
              {softwareStatus.vsftpd?.installed && (
                <Button size="small" onClick={viewFtpConfig}>配置</Button>
              )}
              {!softwareStatus.vsftpd?.installed ? (
                <Button type="primary" size="small" loading={installingFtp} onClick={installFtp}>安装</Button>
              ) : (
                <Button size="small" color="orange" variant="solid" loading={restartingFtp} onClick={restartFtp}>重启</Button>
              )}
            </div>
          </div>
        </Spin>
      </Modal>

      <Modal
        title={configTitle}
        open={configDialogVisible}
        onCancel={() => setConfigDialogVisible(false)}
        onOk={saveConfig}
        confirmLoading={savingConfig}
        okText="保存"
        width={900}
      >
        <Spin spinning={loadingConfig}>
          <div style={{ minHeight: 400 }}>
            <Input.TextArea
              className="server-config-editor"
              value={configContent}
              onChange={(e) => setConfigContent(e.target.value)}
              rows={20}
            />
          </div>
        </Spin>
      </Modal>
    </PageCard>
  )
}
