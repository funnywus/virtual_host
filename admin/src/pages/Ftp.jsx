import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Dropdown, Form, Input, InputNumber, Modal, Progress, Select, Space, Table, Tag, Tooltip, message } from 'antd'
import { CopyOutlined, EyeInvisibleOutlined, EyeOutlined, ReloadOutlined } from '@ant-design/icons'
import api from '@/api'
import { qk } from '@/api/queryKeys'
import PageCard from '@/components/PageCard'
import { confirmAction, copyText, formatUploadSize } from '@/utils'

function calcMaxUploadSize(value, unit) {
  const n = value || 500
  return unit === 'GB' ? n * 1024 * 1024 * 1024 : n * 1024 * 1024
}

function parseUploadSize(bytes) {
  if (!bytes) return { value: 500, unit: 'MB' }
  const gb = bytes / (1024 * 1024 * 1024)
  if (gb >= 1 && gb === Math.floor(gb)) return { value: gb, unit: 'GB' }
  return { value: Math.round(bytes / (1024 * 1024)), unit: 'MB' }
}

function formatUsedSize(bytes) {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n < 0) return '-'
  if (n === 0) return '0B'
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`
  if (n < 1024 * 1024 * 1024) return `${Math.round(n / 1024 / 1024)}MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(1)}GB`
}

function formatUsageTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function getUsagePercentage(used, max) {
  if (used === null || used === undefined || used === '' || !max) return 0
  return Math.min(Math.round((Number(used) / max) * 100), 100)
}

function getUsageColor(used, max) {
  const p = getUsagePercentage(used, max)
  if (p >= 90) return '#f56c6c'
  if (p >= 70) return '#e6a23c'
  return '#67c23a'
}

function hasRecordedUsage(row) {
  return row.used_size !== null && row.used_size !== undefined && row.used_size !== ''
}

export default function Ftp() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [keyword, setKeyword] = useState('')
  const [debouncedKeyword, setDebouncedKeyword] = useState('')
  const [showPassword, setShowPassword] = useState({})
  const [usageMap, setUsageMap] = useState({})
  const [usageRefreshing, setUsageRefreshing] = useState(false)
  const [syncingId, setSyncingId] = useState(null)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [availableSubdomains, setAvailableSubdomains] = useState([])
  const [form] = Form.useForm()
  const editingId = Form.useWatch('id', form)

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedKeyword(keyword.trim())
      setPage(1)
    }, 350)
    return () => clearTimeout(t)
  }, [keyword])

  const { data, isFetching, refetch } = useQuery({
    queryKey: qk.ftp(page, pageSize, debouncedKeyword),
    queryFn: () => api.get(`/ftp?${new URLSearchParams({ page, pageSize, ...(debouncedKeyword ? { keyword: debouncedKeyword } : {}) })}`)
  })

  const accounts = (data?.list || []).map((row) => ({ ...row, ...usageMap[row.id] }))
  const total = data?.total || 0
  const uploadUrl = `${window.location.origin}/`

  async function refreshUsage(account) {
    setUsageMap((prev) => ({ ...prev, [account.id]: { ...prev[account.id], usageLoading: true } }))
    try {
      const res = await api.get(`/ftp/${account.id}/usage`)
      setUsageMap((prev) => ({
        ...prev,
        [account.id]: { used_size: res.used_size ?? 0, used_size_at: res.used_size_at, usageLoading: false }
      }))
    } catch {
      setUsageMap((prev) => ({ ...prev, [account.id]: { ...prev[account.id], usageLoading: false } }))
    }
  }

  async function loadUsageForCurrentPage() {
    if (!accounts.length) return
    setUsageRefreshing(true)
    try {
      const concurrency = 3
      let cursor = 0
      async function worker() {
        while (cursor < accounts.length) {
          const account = accounts[cursor]
          cursor += 1
          await refreshUsage(account)
        }
      }
      await Promise.all(Array.from({ length: Math.min(concurrency, accounts.length) }, worker))
    } finally {
      setUsageRefreshing(false)
    }
  }

  async function openDialog(row) {
    if (row) {
      const parsed = parseUploadSize(row.max_upload_size)
      form.setFieldsValue({
        id: row.id,
        subdomain_id: row.subdomain_id,
        username: row.username,
        password: '',
        home_dir: row.home_dir,
        upload_size_value: parsed.value,
        upload_size_unit: parsed.unit
      })
    } else {
      setAvailableSubdomains(await api.get('/ftp/available-subdomains'))
      form.setFieldsValue({
        id: null,
        subdomain_id: '',
        username: '',
        password: '',
        home_dir: '',
        upload_size_value: 500,
        upload_size_unit: 'MB'
      })
    }
    setOpen(true)
  }

  async function handleSave() {
    const values = await form.validateFields()
    setSaving(true)
    try {
      const payload = {
        ...values,
        max_upload_size: calcMaxUploadSize(values.upload_size_value, values.upload_size_unit)
      }
      if (values.id) await api.put(`/ftp/${values.id}`, payload)
      else await api.post('/ftp', payload)
      message.success('保存成功')
      setOpen(false)
      queryClient.invalidateQueries({ queryKey: ['ftp'] })
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    await confirmAction('确定删除此FTP账号？')
    await api.delete(`/ftp/${id}`)
    message.success('删除成功')
    queryClient.invalidateQueries({ queryKey: ['ftp'] })
  }

  async function syncFtp(row) {
    setSyncingId(row.id)
    try {
      const res = await api.post(`/ftp/${row.id}/sync`)
      res.success ? message.success(res.message) : message.error(res.message)
      queryClient.invalidateQueries({ queryKey: ['ftp'] })
    } finally {
      setSyncingId(null)
    }
  }

  async function resetPassword(id) {
    await confirmAction('确定重置密码？')
    const res = await api.post(`/ftp/${id}/reset-password`)
    message.success(`新密码: ${res.password}`)
    queryClient.invalidateQueries({ queryKey: ['ftp'] })
  }

  async function resetAuthCode(row) {
    await confirmAction('重置后旧授权码立即失效，客户需使用新授权码登录上传页。确定继续？', '重置授权码')
    const res = await api.post(`/ftp/${row.id}/reset-auth-code`)
    Modal.info({
      title: '授权码已重置',
      content: res.auth_code,
      okText: '复制并关闭',
      onOk: () => copyText(res.auth_code, '授权码')
    })
    queryClient.invalidateQueries({ queryKey: ['ftp'] })
  }

  const columns = [
    { title: '关联域名', dataIndex: 'full_domain', minWidth: 160, render: (v) => <span style={{ color: '#409eff', fontWeight: 600 }}>{v}</span> },
    { title: '服务器', width: 160, render: (_, row) => `${row.server_name || '-'}${row.server_ip ? ` (${row.server_ip})` : ''}` },
    {
      title: '用户名',
      width: 120,
      render: (_, row) => (
        <Space>
          {row.username}
          <CopyOutlined className="copy-btn" onClick={() => copyText(row.username)} />
        </Space>
      )
    },
    {
      title: '授权码',
      width: 180,
      render: (_, row) => (
        <Space>
          <Tooltip title={row.auth_code}><span>{row.auth_code?.substring(0, 8)}...</span></Tooltip>
          <CopyOutlined className="copy-btn" onClick={() => copyText(row.auth_code)} />
          {row.auth_code_weak ? <Tag color="error">弱码</Tag> : null}
        </Space>
      )
    },
    {
      title: '密码',
      minWidth: 180,
      render: (_, row) => (
        <Space>
          <span>{showPassword[row.id] ? row.password : '••••••••'}</span>
          <Button type="text" size="small" icon={showPassword[row.id] ? <EyeInvisibleOutlined /> : <EyeOutlined />} onClick={() => setShowPassword((s) => ({ ...s, [row.id]: !s[row.id] }))} />
          <CopyOutlined className="copy-btn" onClick={() => copyText(row.password)} />
        </Space>
      )
    },
    { title: '目录', width: 150, dataIndex: 'home_dir', ellipsis: true },
    { title: '空间限制', width: 100, render: (_, row) => <Tag color="orange">{formatUploadSize(row.max_upload_size)}</Tag> },
    {
      title: (
        <Space>
          已使用
          <Tooltip title="刷新本页已使用空间">
            <Button type="link" size="small" loading={usageRefreshing} onClick={loadUsageForCurrentPage} icon={<ReloadOutlined />} />
          </Tooltip>
        </Space>
      ),
      width: 160,
      render: (_, row) => {
        const recorded = hasRecordedUsage(row)
        const color = getUsageColor(row.used_size, row.max_upload_size)
        return (
          <div>
            <Space size={4}>
              {row.usageLoading ? <Tag>统计中</Tag> : recorded ? <Tag color={getUsagePercentage(row.used_size, row.max_upload_size) >= 90 ? 'error' : getUsagePercentage(row.used_size, row.max_upload_size) >= 70 ? 'warning' : 'success'}>{formatUsedSize(row.used_size)}</Tag> : <span style={{ color: '#c0c4cc' }}>未统计</span>}
              <Button type="link" size="small" loading={row.usageLoading} disabled={usageRefreshing} icon={<ReloadOutlined />} onClick={() => refreshUsage(row)} />
            </Space>
            {recorded && !row.usageLoading ? <Progress percent={getUsagePercentage(row.used_size, row.max_upload_size)} showInfo={false} size="small" strokeColor={color} /> : null}
            {row.used_size_at && !row.usageLoading ? <div style={{ color: '#909399', fontSize: 11 }}>{formatUsageTime(row.used_size_at)}</div> : null}
          </div>
        )
      }
    },
    {
      title: '同步状态',
      width: 100,
      render: (_, row) => (
        <Tooltip title={row.sync_message || ''}>
          <Tag color={row.sync_status === 'synced' ? 'success' : row.sync_status === 'error' ? 'error' : 'warning'}>
            {row.sync_status === 'synced' ? '已同步' : row.sync_status === 'error' ? '失败' : '待同步'}
          </Tag>
        </Tooltip>
      )
    },
    {
      title: '操作',
      width: 160,
      fixed: 'right',
      render: (_, row) => (
        <Space size={8}>
          <Button size="small" type="primary" loading={syncingId === row.id} disabled={!row.server_ip} onClick={() => syncFtp(row)}>同步</Button>
          <Dropdown
            menu={{
              items: [
                { key: 'edit', label: '编辑', onClick: () => openDialog(row) },
                { key: 'pwd', label: '重置密码', onClick: () => resetPassword(row.id).catch(() => {}) },
                { key: 'auth', label: '重置授权码', onClick: () => resetAuthCode(row).catch(() => {}) },
                { key: 'link', label: '复制上传链接', onClick: () => copyText(`${window.location.origin}/?code=${row.auth_code}`, '上传链接') },
                { type: 'divider' },
                { key: 'del', label: <span style={{ color: '#ff4d4f' }}>删除</span>, onClick: () => handleDelete(row.id).catch(() => {}) }
              ]
            }}
          >
            <Button size="small">更多</Button>
          </Dropdown>
        </Space>
      )
    }
  ]

  return (
    <PageCard
      title="FTP账号列表"
      extra={(
        <>
          <Input
            size="small"
            allowClear
            placeholder="搜索域名/用户名/授权码"
            style={{ width: 200 }}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onPressEnter={() => setDebouncedKeyword(keyword.trim())}
          />
          <Button size="small" icon={<ReloadOutlined />} loading={isFetching} onClick={() => refetch()} />
          <Button type="primary" size="small" onClick={() => openDialog()}>添加FTP账号</Button>
        </>
      )}
    >
      <Table
        rowKey="id"
        size="small"
        loading={isFetching}
        columns={columns}
        dataSource={accounts}
        scroll={{ x: 1400 }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50],
          showTotal: (t) => `共 ${t} 条`,
          onChange: (p, s) => { setPage(p); setPageSize(s) }
        }}
      />
      <Alert
        type="info"
        showIcon
        style={{ marginTop: 15 }}
        message={<span>客户上传入口: <a href={uploadUrl} target="_blank" rel="noreferrer">{uploadUrl}</a>（携带授权码：<code>{uploadUrl}?code=授权码</code>）</span>}
      />
      <Modal title={editingId ? '编辑FTP账号' : '添加FTP账号'} open={open} confirmLoading={saving} onOk={handleSave} onCancel={() => setOpen(false)} width={500} destroyOnClose>
        <Form form={form} labelCol={{ span: 6 }} initialValues={{ upload_size_value: 500, upload_size_unit: 'MB' }}>
          <Form.Item name="id" hidden><Input /></Form.Item>
          {!editingId && (
            <Form.Item name="subdomain_id" label="关联域名">
              <Select placeholder="选择域名" options={availableSubdomains.map((s) => ({ value: s.id, label: s.full_domain }))} />
            </Form.Item>
          )}
          <Form.Item name="username" label="用户名"><Input placeholder="FTP用户名" /></Form.Item>
          {!editingId && <Form.Item name="password" label="密码"><Input placeholder="留空自动生成" /></Form.Item>}
          <Form.Item name="home_dir" label="主目录"><Input placeholder="/www/wwwroot/ftp/用户名" /></Form.Item>
          <Form.Item label="空间限制">
            <Space>
              <Form.Item name="upload_size_value" noStyle><InputNumber min={1} max={1024} /></Form.Item>
              <Form.Item name="upload_size_unit" noStyle>
                <Select style={{ width: 80 }} options={[{ value: 'MB', label: 'MB' }, { value: 'GB', label: 'GB' }]} />
              </Form.Item>
              <span style={{ color: '#909399', fontSize: 12 }}>默认 500 MB</span>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
      <style>{`.copy-btn { color:#909399; cursor:pointer; } .copy-btn:hover { color:#1677ff; }`}</style>
    </PageCard>
  )
}
