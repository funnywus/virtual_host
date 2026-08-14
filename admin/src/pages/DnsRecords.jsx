import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Button, Dropdown, Empty, Form, Input, Modal, Select, Space, Table, Tag, Tooltip, message } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import api from '@/api'
import { qk } from '@/api/queryKeys'
import PageCard from '@/components/PageCard'
import { confirmAction, copyText, platformTypes } from '@/utils'

function formatTtl(ttl) {
  const value = Number(ttl)
  if (value === 60) return '1分钟'
  if (value === 600) return '10分钟'
  if (value === 1800) return '30分钟'
  if (value === 3600) return '1小时'
  if (!value) return '-'
  if (value < 60) return `${value}秒`
  if (value % 3600 === 0) return `${value / 3600}小时`
  if (value % 60 === 0) return `${value / 60}分钟`
  return `${value}秒`
}

export default function DnsRecords() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: domains = [] } = useQuery({ queryKey: qk.domains, queryFn: () => api.get('/dns/domains') })
  const { data: servers = [] } = useQuery({ queryKey: qk.servers, queryFn: () => api.get('/servers') })
  const queryDomainId = searchParams.get('domain_id') ? Number(searchParams.get('domain_id')) : null
  const [selectedDomainId, setSelectedDomainId] = useState(queryDomainId)
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [records, setRecords] = useState([])
  const [platform, setPlatform] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form] = Form.useForm()
  const recordType = Form.useWatch('type', form) || 'A'

  const currentDomain = domains.find((d) => d.id === selectedDomainId) || null
  const availableServers = servers.filter((s) => s.status !== 'disabled')
  const platformInfo = platformTypes[platform] || { name: platform || '未知平台', color: 'default' }

  useEffect(() => {
    if (queryDomainId) {
      setSelectedDomainId(queryDomainId)
      return
    }
    if (domains.length && !selectedDomainId) {
      const fallback = domains.find((d) => d.is_default === 1) || domains[0]
      if (fallback) {
        setSelectedDomainId(fallback.id)
        setSearchParams({ domain_id: String(fallback.id) })
      }
    }
  }, [domains, queryDomainId])

  useEffect(() => {
    if (selectedDomainId) loadDnsRecords()
    else {
      setPlatform('')
      setRecords([])
    }
  }, [selectedDomainId])

  async function loadDnsRecords(showSuccess = false) {
    if (!selectedDomainId) return
    setLoading(true)
    try {
      const res = await api.get(`/dns/domains/${selectedDomainId}/dns-records`)
      setPlatform(res.platform)
      setRecords(res.records || [])
      if (showSuccess) message.success(`已获取最新 DNS，共 ${res.records?.length || 0} 条记录`)
    } catch {
      setPlatform('')
      setRecords([])
    } finally {
      setLoading(false)
    }
  }

  function onDomainChange(domainId) {
    setPage(1)
    setKeyword('')
    setSelectedDomainId(domainId || null)
    setSearchParams(domainId ? { domain_id: String(domainId) } : {})
  }

  const filtered = useMemo(() => {
    if (!keyword) return records
    const kw = keyword.toLowerCase()
    return records.filter((r) =>
      r.name?.toLowerCase().includes(kw) || r.value?.toLowerCase().includes(kw) || r.type?.toLowerCase().includes(kw)
    )
  }, [records, keyword])

  function getDefaultServer() {
    return availableServers.find((s) => s.is_default === 1) || availableServers[0] || null
  }

  function getDnsFullDomain(name) {
    const domain = currentDomain?.domain
    if (!domain) return ''
    if (!name || name === '@') return domain
    return `${name}.${domain}`
  }

  function openAdd() {
    const defaultServer = getDefaultServer()
    setEditingId(null)
    form.setFieldsValue({
      name: '',
      type: 'A',
      value: defaultServer?.ip || '',
      ttl: 600,
      server_id: defaultServer?.id || null
    })
    setOpen(true)
  }

  function openEdit(row) {
    const server = row.type === 'A' ? servers.find((s) => s.ip === row.value) : null
    setEditingId(row.id)
    form.setFieldsValue({
      name: row.name,
      type: row.type,
      value: row.value,
      ttl: row.ttl || 600,
      server_id: server?.id || null
    })
    setOpen(true)
  }

  function onServerChange(serverId) {
    const server = servers.find((s) => s.id === serverId)
    if (server) form.setFieldValue('value', server.ip)
  }

  function onTypeChange(type) {
    if (type === 'A') {
      const defaultServer = getDefaultServer()
      form.setFieldsValue({ server_id: defaultServer?.id || null, value: defaultServer?.ip || '' })
    } else {
      form.setFieldsValue({ server_id: null, value: '' })
    }
  }

  async function saveRecord() {
    const values = await form.validateFields()
    setSaving(true)
    try {
      const payload = { name: values.name, type: values.type, value: values.value, ttl: values.ttl }
      if (editingId) {
        await api.put(`/dns/domains/${selectedDomainId}/dns-records/${editingId}`, payload)
        message.success('修改成功')
      } else {
        await api.post(`/dns/domains/${selectedDomainId}/dns-records`, payload)
        message.success('添加成功')
      }
      setOpen(false)
      loadDnsRecords()
    } finally {
      setSaving(false)
    }
  }

  async function deleteRecord(row) {
    await confirmAction(`确定删除记录 "${row.name}" ?`)
    await api.delete(`/dns/domains/${selectedDomainId}/dns-records/${row.id}`)
    message.success('删除成功')
    loadDnsRecords()
  }

  async function toggleStatus(row, status) {
    await api.put(`/dns/domains/${selectedDomainId}/dns-records/${row.id}/status`, { status })
    message.success(status === 'ENABLE' ? '已启用' : '已停用')
    loadDnsRecords()
  }

  const columns = [
    {
      title: '主机记录',
      minWidth: 220,
      render: (_, row) => (
        <div>
          <Tooltip title="点击复制完整域名">
            <span className="record-name" onClick={() => copyText(getDnsFullDomain(row.name))}>{row.name || '@'}</span>
          </Tooltip>
          <div className="record-fqdn">{getDnsFullDomain(row.name)}</div>
        </div>
      )
    },
    { title: '类型', width: 80, render: (_, row) => <Tag>{row.type}</Tag> },
    { title: '记录值', minWidth: 180, dataIndex: 'value', ellipsis: true },
    {
      title: '服务器',
      width: 160,
      render: (_, row) => row.type === 'A' ? (servers.find((s) => s.ip === row.value)?.name || '-') : '-'
    },
    { title: 'TTL', width: 90, render: (_, row) => formatTtl(row.ttl) },
    {
      title: '状态',
      width: 80,
      render: (_, row) => <Tag color={row.status === 'active' ? 'success' : 'default'}>{row.status === 'active' ? '启用' : '停用'}</Tag>
    },
    {
      title: '操作',
      width: 150,
      fixed: 'right',
      render: (_, row) => (
        <Space size={6}>
          <Button size="small" type="primary" onClick={() => openEdit(row)}>修改</Button>
          <Dropdown
            menu={{
              items: [
                row.status === 'active'
                  ? { key: 'off', label: '停用', onClick: () => toggleStatus(row, 'DISABLE') }
                  : { key: 'on', label: '启用', onClick: () => toggleStatus(row, 'ENABLE') },
                { type: 'divider' },
                { key: 'del', label: <span style={{ color: '#ff4d4f' }}>删除</span>, onClick: () => deleteRecord(row).catch(() => {}) }
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
      title={(
        <>
          DNS记录
          {currentDomain ? <Tag>{currentDomain.domain}</Tag> : null}
        </>
      )}
      extra={(
        <>
          <Button size="small" disabled={!selectedDomainId} loading={loading} onClick={() => loadDnsRecords(true)}>获取最新DNS</Button>
          <Button type="primary" size="small" disabled={!selectedDomainId} onClick={openAdd}>添加记录</Button>
        </>
      )}
      filters={(
        <>
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="选择主域名"
            className="filter-select"
            style={{ width: 180 }}
            value={selectedDomainId}
            onChange={onDomainChange}
            options={domains.map((d) => ({ value: d.id, label: d.domain }))}
          />
          <Input
            allowClear
            disabled={!selectedDomainId}
            prefix={<SearchOutlined />}
            placeholder="搜索主机记录、记录值..."
            className="filter-search"
            value={keyword}
            onChange={(e) => { setKeyword(e.target.value); setPage(1) }}
          />
          {platform ? <Tag color={platformInfo.color}>{platformInfo.name}</Tag> : null}
          {selectedDomainId ? <span className="record-count">共 {filtered.length} 条记录</span> : null}
        </>
      )}
    >
      {!selectedDomainId ? (
        <Empty description="请选择主域名查看 DNS 解析记录" />
      ) : (
        <Table
          rowKey={(r) => r.id || `${r.name}-${r.type}-${r.value}`}
          size="small"
          loading={loading}
          columns={columns}
          dataSource={filtered}
          scroll={{ x: 900 }}
          pagination={{
            current: page,
            pageSize,
            total: filtered.length,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p, s) => { setPage(p); setPageSize(s) }
          }}
        />
      )}
      <Modal
        title={editingId ? '修改DNS记录' : '添加DNS记录'}
        open={open}
        confirmLoading={saving}
        okText={editingId ? '保存' : '添加'}
        onOk={saveRecord}
        onCancel={() => setOpen(false)}
        width={450}
        destroyOnClose
      >
        <Form form={form} labelCol={{ span: 6 }} initialValues={{ type: 'A', ttl: 600 }}>
          <Form.Item name="name" label="主机记录" rules={[{ required: true, message: '请填写主机记录' }]}>
            <Input placeholder="例如: www, @, *" />
          </Form.Item>
          <Form.Item name="type" label="记录类型">
            <Select
              onChange={onTypeChange}
              options={['A', 'CNAME', 'TXT', 'MX', 'AAAA'].map((v) => ({ value: v, label: v }))}
            />
          </Form.Item>
          {recordType === 'A' && (
            <Form.Item name="server_id" label="服务器">
              <Select
                allowClear
                placeholder="选择服务器"
                onChange={onServerChange}
                options={availableServers.map((s) => ({
                  value: s.id,
                  label: `${s.name} (${s.ip})${s.is_default === 1 ? ' (默认)' : ''}`
                }))}
              />
            </Form.Item>
          )}
          <Form.Item name="value" label="记录值" rules={[{ required: true, message: '请填写记录值' }]}>
            <Input placeholder="IP地址或目标域名" />
          </Form.Item>
          <Form.Item name="ttl" label="TTL">
            <Select options={[
              { value: 60, label: '1分钟' },
              { value: 600, label: '10分钟' },
              { value: 1800, label: '30分钟' },
              { value: 3600, label: '1小时' }
            ]} />
          </Form.Item>
        </Form>
      </Modal>
      <style>{`
        .record-name { color: #1677ff; cursor: pointer; font-weight: 600; }
        .record-fqdn { color: #909399; font-size: 12px; margin-top: 4px; }
        .record-count { color: #909399; font-size: 13px; margin-left: auto; }
      `}</style>
    </PageCard>
  )
}
