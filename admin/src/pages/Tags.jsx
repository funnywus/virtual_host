import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, ColorPicker, Form, Input, Modal, Space, Switch, Table, Tag, message } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import api from '@/api'
import { qk } from '@/api/queryKeys'
import PageCard from '@/components/PageCard'
import { confirmAction } from '@/utils'

const emptyForm = { id: null, name: '', color: '', is_filterable: 1 }

export default function Tags() {
  const queryClient = useQueryClient()
  const { data = [], isFetching, refetch } = useQuery({
    queryKey: qk.tags,
    queryFn: () => api.get('/tags')
  })
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()
  const editingId = Form.useWatch('id', form)

  function openDialog(row) {
    form.setFieldsValue(row
      ? { id: row.id, name: row.name, color: row.color || '', is_filterable: row.is_filterable === 0 ? 0 : 1 }
      : emptyForm)
    setOpen(true)
  }

  async function handleSave() {
    const values = await form.validateFields()
    if (!values.name?.trim()) {
      message.warning('请输入标签名称')
      return
    }
    setSaving(true)
    try {
      const payload = {
        name: values.name.trim(),
        color: typeof values.color === 'string' ? values.color : (values.color?.toHexString?.() || ''),
        is_filterable: values.is_filterable
      }
      if (values.id) await api.put(`/tags/${values.id}`, { ...payload, id: values.id })
      else await api.post('/tags', payload)
      message.success('保存成功')
      setOpen(false)
      queryClient.invalidateQueries({ queryKey: qk.tags })
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(row) {
    await confirmAction('确定删除此标签？')
    await api.delete(`/tags/${row.id}`)
    message.success('删除成功')
    queryClient.invalidateQueries({ queryKey: qk.tags })
  }

  async function setDefault(row) {
    await api.post(`/tags/${row.id}/set-default`)
    message.success('已设为默认')
    queryClient.invalidateQueries({ queryKey: qk.tags })
  }

  const columns = [
    {
      title: '标签名称',
      dataIndex: 'name',
      render: (_, row) => (
        <Space size={4}>
          <Tag color={row.color || undefined} style={row.color ? { color: '#fff', borderColor: row.color, background: row.color } : undefined}>
            {row.name}
          </Tag>
          {row.is_default === 1 && <Tag color="orange">默认</Tag>}
        </Space>
      )
    },
    {
      title: '颜色',
      width: 120,
      render: (_, row) => row.color
        ? (
          <Space size={8}>
            <span style={{ display: 'inline-block', width: 20, height: 20, borderRadius: 4, background: row.color }} />
            <span>{row.color}</span>
          </Space>
        )
        : <span style={{ color: '#999' }}>默认</span>
    },
    {
      title: '参与匹配',
      width: 100,
      render: (_, row) => (
        <Tag color={row.is_filterable === 0 ? 'default' : 'success'}>
          {row.is_filterable === 0 ? '不参与' : '参与'}
        </Tag>
      )
    },
    { title: '创建时间', dataIndex: 'created_at', width: 180 },
    {
      title: '操作',
      width: 220,
      fixed: 'right',
      render: (_, row) => (
        <Space size={6}>
          <Button size="small" type="primary" disabled={row.is_default === 1} onClick={() => setDefault(row)}>默认</Button>
          <Button size="small" onClick={() => openDialog(row)}>编辑</Button>
          <Button size="small" danger onClick={() => handleDelete(row).catch(() => {})}>删除</Button>
        </Space>
      )
    }
  ]

  return (
    <PageCard
      title="标签管理"
      extra={(
        <>
          <Button size="small" icon={<ReloadOutlined />} loading={isFetching} onClick={() => refetch()} />
          <Button type="primary" size="small" onClick={() => openDialog()}>添加标签</Button>
        </>
      )}
    >
      <Table rowKey="id" size="small" columns={columns} dataSource={data} pagination={false} scroll={{ x: 800 }} />
      <Modal
        title={editingId ? '编辑标签' : '添加标签'}
        open={open}
        confirmLoading={saving}
        onOk={handleSave}
        onCancel={() => setOpen(false)}
        destroyOnClose
        width={400}
      >
        <Form form={form} labelCol={{ span: 6 }} initialValues={emptyForm}>
          <Form.Item name="id" hidden><Input /></Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入标签名称' }]}>
            <Input placeholder="标签名称" />
          </Form.Item>
          <Form.Item
            name="color"
            label="颜色"
            getValueFromEvent={(color) => (typeof color === 'string' ? color : (color?.toHexString?.() || ''))}
          >
            <ColorPicker showText />
          </Form.Item>
          <Form.Item name="is_filterable" label="参与匹配" valuePropName="checked" getValueFromEvent={(v) => (v ? 1 : 0)} getValueProps={(v) => ({ checked: v !== 0 })}>
            <Switch />
          </Form.Item>
          <div style={{ margin: '-8px 0 12px 88px', color: '#999', fontSize: 12 }}>关闭后仅作标记，不参与域名与服务器的标签匹配</div>
        </Form>
      </Modal>
    </PageCard>
  )
}
