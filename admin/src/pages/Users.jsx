import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Form, Input, Modal, Select, Space, Table, message } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import api from '@/api'
import { qk } from '@/api/queryKeys'
import PageCard from '@/components/PageCard'
import { confirmAction } from '@/utils'

export default function Users() {
  const queryClient = useQueryClient()
  const { data = [], isFetching, refetch } = useQuery({
    queryKey: qk.users,
    queryFn: () => api.get('/users')
  })
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [form] = Form.useForm()

  async function updateRole(row, role) {
    try {
      await api.put(`/users/${row.id}/role`, { role })
      message.success('更新成功')
      queryClient.invalidateQueries({ queryKey: qk.users })
    } catch {
      refetch()
    }
  }

  async function handleDelete(id) {
    await confirmAction('确定删除此用户？')
    await api.delete(`/users/${id}`)
    message.success('删除成功')
    queryClient.invalidateQueries({ queryKey: qk.users })
  }

  async function handleCreate() {
    const values = await form.validateFields()
    setCreating(true)
    try {
      await api.post('/users', values)
      message.success('创建成功')
      setOpen(false)
      queryClient.invalidateQueries({ queryKey: qk.users })
    } finally {
      setCreating(false)
    }
  }

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: '用户名', dataIndex: 'username' },
    { title: '邮箱', dataIndex: 'email' },
    {
      title: '角色',
      dataIndex: 'role',
      width: 160,
      render: (role, row) => (
        <Select
          value={role}
          style={{ width: 120 }}
          options={[
            { label: '用户', value: 'user' },
            { label: '管理员', value: 'admin' }
          ]}
          onChange={(value) => updateRole(row, value)}
        />
      )
    },
    {
      title: '操作',
      width: 100,
      fixed: 'right',
      render: (_, row) => (
        <Button size="small" danger onClick={() => handleDelete(row.id).catch(() => {})}>删除</Button>
      )
    }
  ]

  return (
    <PageCard
      title="用户列表"
      extra={(
        <>
          <Button type="primary" size="small" onClick={() => { form.resetFields(); setOpen(true) }}>新增用户</Button>
          <Button size="small" icon={<ReloadOutlined />} loading={isFetching} onClick={() => refetch()} />
        </>
      )}
    >
      <Table rowKey="id" size="small" columns={columns} dataSource={data} pagination={false} />
      <Modal
        title="新增用户"
        open={open}
        confirmLoading={creating}
        okText="创建"
        onOk={handleCreate}
        onCancel={() => setOpen(false)}
        destroyOnClose
        width={420}
      >
        <Form form={form} labelCol={{ span: 5 }} initialValues={{ role: 'user' }}>
          <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input placeholder="请输入用户名" />
          </Form.Item>
          <Form.Item name="email" label="邮箱" rules={[{ required: true, message: '请输入邮箱' }]}>
            <Input placeholder="请输入邮箱" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password placeholder="请输入密码" />
          </Form.Item>
          <Form.Item name="role" label="角色">
            <Select options={[{ label: '用户', value: 'user' }, { label: '管理员', value: 'admin' }]} />
          </Form.Item>
        </Form>
      </Modal>
    </PageCard>
  )
}
