import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Dropdown, Form, Input, Modal, Select, Space, Table, Tag, message } from 'antd'
import { CopyOutlined, EyeInvisibleOutlined, EyeOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import api from '@/api'
import { qk } from '@/api/queryKeys'
import PageCard from '@/components/PageCard'
import { confirmAction, copyText, formatDateTime, platformTypes } from '@/utils'
import { getTagStyle, parseTagList } from '@/utils/server-tag-filter'

function maskValue(value, visible) {
  if (!value) return '-'
  if (visible) return value
  if (value.length <= 8) return '••••••••'
  return `${value.slice(0, 4)}****${value.slice(-4)}`
}

export default function DnsPlatforms() {
  const queryClient = useQueryClient()
  const { data: configs = [], isFetching, refetch } = useQuery({
    queryKey: qk.dnsPlatforms,
    queryFn: () => api.get('/dns/aliyun-configs')
  })
  const { data: tags = [] } = useQuery({
    queryKey: qk.tags,
    queryFn: () => api.get('/tags')
  })
  const [keyword, setKeyword] = useState('')
  const [showKey, setShowKey] = useState({})
  const [showSecret, setShowSecret] = useState({})
  const [testingId, setTestingId] = useState(null)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()
  const editingId = Form.useWatch('id', form)
  const platform = Form.useWatch('platform', form) || 'aliyun'

  const filtered = useMemo(() => {
    if (!keyword) return configs
    const kw = keyword.toLowerCase()
    return configs.filter((c) =>
      c.name?.toLowerCase().includes(kw)
      || c.remark?.toLowerCase().includes(kw)
      || c.platform?.toLowerCase().includes(kw)
      || c.access_key?.toLowerCase().includes(kw)
      || c.tags?.toLowerCase().includes(kw)
    )
  }, [configs, keyword])

  function openDialog(row) {
    if (row) {
      form.setFieldsValue({
        id: row.id,
        name: row.name,
        platform: row.platform || 'aliyun',
        access_key: row.access_key || '',
        secret_key: row.secret_key || '',
        remark: row.remark || '',
        tagList: parseTagList(row.tags)
      })
    } else {
      const defaultTag = tags.find((t) => t.is_default === 1)
      form.setFieldsValue({
        id: null,
        name: '',
        platform: 'aliyun',
        access_key: '',
        secret_key: '',
        remark: '',
        tagList: defaultTag ? [defaultTag.name] : []
      })
    }
    setOpen(true)
  }

  async function onTagChange(tagNames) {
    for (const tag of tagNames) {
      if (!tags.some((t) => t.name === tag)) {
        try {
          await api.post('/tags', { name: tag })
          queryClient.invalidateQueries({ queryKey: qk.tags })
        } catch {
          // 已有拦截器提示
        }
      }
    }
  }

  async function handleSave() {
    const values = await form.validateFields()
    setSaving(true)
    try {
      const data = {
        name: values.name.trim(),
        platform: values.platform,
        access_key: values.access_key.trim(),
        remark: values.remark || '',
        tags: (values.tagList || []).join(',')
      }
      if (values.id) {
        if (values.secret_key?.trim()) data.secret_key = values.secret_key.trim()
        await api.put(`/dns/aliyun-configs/${values.id}`, data)
      } else {
        data.secret_key = values.secret_key.trim()
        await api.post('/dns/aliyun-configs', data)
      }
      message.success('保存成功')
      setOpen(false)
      queryClient.invalidateQueries({ queryKey: qk.dnsPlatforms })
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    await confirmAction('确定删除此配置？')
    await api.delete(`/dns/aliyun-configs/${id}`)
    message.success('删除成功')
    queryClient.invalidateQueries({ queryKey: qk.dnsPlatforms })
  }

  async function setDefault(row) {
    await api.post(`/dns/aliyun-configs/${row.id}/set-default`)
    message.success('已设为默认')
    queryClient.invalidateQueries({ queryKey: qk.dnsPlatforms })
  }

  async function testConfig(row) {
    setTestingId(row.id)
    try {
      const res = await api.post(`/dns/aliyun-configs/${row.id}/test`)
      res.success ? message.success(res.message) : message.error(res.message)
    } finally {
      setTestingId(null)
    }
  }

  const columns = [
    {
      title: '配置信息',
      minWidth: 180,
      render: (_, row) => (
        <div>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>{row.name}</div>
          <Space size={6} wrap>
            <Tag color={platformTypes[row.platform]?.color}>{platformTypes[row.platform]?.name || row.platform}</Tag>
            {row.is_default === 1 && <Tag color="orange">默认</Tag>}
          </Space>
        </div>
      )
    },
    {
      title: 'AccessKey',
      minWidth: 220,
      render: (_, row) => (
        <Space>
          <code className="secret-text">{maskValue(row.access_key, showKey[row.id])}</code>
          <Button type="text" size="small" icon={showKey[row.id] ? <EyeInvisibleOutlined /> : <EyeOutlined />} onClick={() => setShowKey((s) => ({ ...s, [row.id]: !s[row.id] }))} />
          <Button type="text" size="small" icon={<CopyOutlined />} onClick={() => copyText(row.access_key, 'AccessKey')} />
        </Space>
      )
    },
    {
      title: 'SecretKey',
      minWidth: 220,
      render: (_, row) => (
        <Space>
          <code className="secret-text">{maskValue(row.secret_key, showSecret[row.id])}</code>
          <Button type="text" size="small" icon={showSecret[row.id] ? <EyeInvisibleOutlined /> : <EyeOutlined />} onClick={() => setShowSecret((s) => ({ ...s, [row.id]: !s[row.id] }))} />
          <Button type="text" size="small" icon={<CopyOutlined />} onClick={() => copyText(row.secret_key, 'SecretKey')} />
        </Space>
      )
    },
    {
      title: '标签',
      minWidth: 120,
      render: (_, row) => {
        const list = parseTagList(row.tags)
        if (!list.length) return <span style={{ color: '#909399' }}>-</span>
        return (
          <Space size={4} wrap>
            {list.map((tag) => (
              <Tag key={tag} style={getTagStyle(tag, tags)}>{tag}</Tag>
            ))}
          </Space>
        )
      }
    },
    {
      title: '备注',
      dataIndex: 'remark',
      ellipsis: true,
      minWidth: 120
    },
    {
      title: '创建时间',
      width: 160,
      render: (_, row) => <span style={{ color: '#909399', fontSize: 12 }}>{formatDateTime(row.created_at)}</span>
    },
    {
      title: '操作',
      width: 180,
      fixed: 'right',
      render: (_, row) => (
        <Space size={8}>
          <Button size="small" type="primary" loading={testingId === row.id} onClick={() => testConfig(row)}>测试</Button>
          <Dropdown
            menu={{
              items: [
                { key: 'default', label: '设为默认', disabled: row.is_default === 1, onClick: () => setDefault(row) },
                { key: 'edit', label: '编辑', onClick: () => openDialog(row) },
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
      title="DNS平台配置"
      extra={(
        <>
          <Input
            size="small"
            allowClear
            placeholder="搜索配置名称、备注..."
            prefix={<SearchOutlined />}
            style={{ width: 220 }}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <Button size="small" icon={<ReloadOutlined />} loading={isFetching} onClick={() => refetch()} />
          <Button type="primary" size="small" onClick={() => openDialog()}>添加平台</Button>
        </>
      )}
    >
      <Table rowKey="id" size="small" columns={columns} dataSource={filtered} pagination={false} scroll={{ x: 1100 }} />
      <Modal
        title={editingId ? '编辑DNS平台' : '添加DNS平台'}
        open={open}
        confirmLoading={saving}
        onOk={handleSave}
        onCancel={() => setOpen(false)}
        destroyOnClose
        width={560}
      >
        <Form form={form} labelCol={{ span: 6 }} initialValues={{ platform: 'aliyun', tagList: [] }}>
          <Form.Item name="id" hidden><Input /></Form.Item>
          <Form.Item name="name" label="配置名称" rules={[{ required: true, message: '请输入配置名称' }]}>
            <Input placeholder="例如: 主账号" />
          </Form.Item>
          <Form.Item name="platform" label="DNS平台">
            <Select options={Object.entries(platformTypes).map(([value, info]) => ({ value, label: info.name }))} />
          </Form.Item>
          <Form.Item name="access_key" label={platformTypes[platform]?.keyLabel || 'AccessKey'} rules={[{ required: true, message: '请输入 AccessKey' }]}>
            <Input placeholder="请输入 AccessKey" />
          </Form.Item>
          <Form.Item
            name="secret_key"
            label={platformTypes[platform]?.secretLabel || 'SecretKey'}
            rules={editingId ? [] : [{ required: true, message: '请输入 SecretKey' }]}
          >
            <Input.Password placeholder={editingId ? '留空则不修改' : '请输入 SecretKey'} />
          </Form.Item>
          {editingId ? <div style={{ margin: '-12px 0 12px 25%', color: '#909399', fontSize: 12 }}>当前已保存密钥，留空表示不修改</div> : null}
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} placeholder="可选备注" />
          </Form.Item>
          <Form.Item name="tagList" label="标签">
            <Select
              mode="tags"
              placeholder="选择或输入标签"
              options={tags.map((t) => ({ value: t.name, label: t.name }))}
              onChange={onTagChange}
            />
          </Form.Item>
        </Form>
      </Modal>
      <style>{`
        .secret-text {
          font-size: 12px;
          color: #606266;
          background: #f5f7fa;
          padding: 4px 8px;
          border-radius: 6px;
          max-width: 160px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          display: inline-block;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        }
      `}</style>
    </PageCard>
  )
}
