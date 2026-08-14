import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Form, Input, Modal, Radio, Space, Tag, message } from 'antd'
import api from '@/api'
import { confirmAction } from '@/utils'

const emptyForm = {
  type: 'https',
  config: '',
  root_path: '',
  proxy_pass: 'http://127.0.0.1:3000',
  synced: false
}

export default function NginxDialog({ open, subdomain, onClose, onRefresh }) {
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [removing, setRemoving] = useState(false)
  const formRef = useRef(form)
  formRef.current = form

  const fullDomain = useMemo(() => {
    if (!subdomain) return ''
    return subdomain.subdomain === '@'
      ? subdomain.main_domain
      : `${subdomain.subdomain}.${subdomain.main_domain}`
  }, [subdomain])

  useEffect(() => {
    if (!open || !subdomain) return
    const rootPath = `/www/wwwroot/ftp/${fullDomain}`
    const existing = subdomain.nginx_config || ''
    const current = formRef.current
    const next = {
      ...current,
      config: existing,
      root_path: rootPath,
      synced: subdomain.nginx_synced === 1
    }
    setForm(next)
    if (!existing) generateConfig(next, subdomain)
  }, [open, subdomain, fullDomain])

  async function generateConfig(next = formRef.current, target = subdomain) {
    if (next.type === 'custom' || !target) return
    try {
      const res = await api.post('/nginx/preview', {
        subdomain_id: target.id,
        type: next.type,
        root_path: next.root_path,
        proxy_pass: next.proxy_pass
      })
      setForm((prev) => ({ ...prev, ...next, config: res.config }))
    } catch {
      setForm((prev) => ({ ...prev, ...next }))
    }
  }

  function onTypeChange(type) {
    generateConfig({ ...form, type })
  }

  async function fetchConfig() {
    setFetching(true)
    try {
      const res = await api.get(`/nginx/fetch/${subdomain.id}`)
      if (res.config) {
        setForm((prev) => ({ ...prev, config: res.config }))
        message.success('获取成功')
      } else {
        message.warning('服务器上没有此配置文件')
      }
    } finally {
      setFetching(false)
    }
  }

  async function saveConfig() {
    setSaving(true)
    try {
      await api.post(`/nginx/save/${subdomain.id}`, { config: form.config })
      message.success('保存成功')
      onRefresh?.()
    } finally {
      setSaving(false)
    }
  }

  async function syncConfig() {
    setSyncing(true)
    try {
      const res = await api.post(`/nginx/sync/${subdomain.id}`, { config: form.config })
      if (res.success) {
        message.success('同步成功')
        setForm((prev) => ({ ...prev, synced: true }))
        onRefresh?.()
      } else {
        message.error(res.message || '同步失败')
      }
    } finally {
      setSyncing(false)
    }
  }

  async function removeConfig() {
    try {
      await confirmAction('确定删除服务器上的Nginx配置？')
    } catch {
      return
    }
    setRemoving(true)
    try {
      await api.delete(`/nginx/remove/${subdomain.id}`)
      message.success('删除成功')
      setForm((prev) => ({ ...prev, config: '', synced: false }))
      onRefresh?.()
    } finally {
      setRemoving(false)
    }
  }

  return (
    <Modal
      title="Nginx配置"
      open={open}
      onCancel={onClose}
      width={800}
      destroyOnClose
      wrapClassName="nginx-dialog-wrap"
      footer={(
        <Space wrap>
          <Button onClick={onClose}>关闭</Button>
          <Button onClick={fetchConfig} loading={fetching}>从服务器获取</Button>
          <Button danger onClick={removeConfig} loading={removing}>删除配置</Button>
          <Button type="primary" ghost onClick={syncConfig} loading={syncing}>同步到服务器</Button>
          <Button type="primary" onClick={saveConfig} loading={saving}>保存</Button>
        </Space>
      )}
    >
      {subdomain ? (
        <div style={{ marginBottom: 15 }}>
          <span>域名: <strong className="nginx-full-domain">{fullDomain}</strong></span>
          {form.synced ? <Tag color="success" style={{ marginLeft: 10 }}>已同步</Tag> : null}
        </div>
      ) : null}

      <Form labelCol={{ flex: '100px' }} colon={false}>
        <Form.Item label="配置类型">
          <Radio.Group
            value={form.type}
            optionType="button"
            onChange={(e) => onTypeChange(e.target.value)}
            options={[
              { label: 'HTTP', value: 'http' },
              { label: 'HTTPS', value: 'https' },
              { label: '反向代理', value: 'proxy' },
              { label: '自定义', value: 'custom' }
            ]}
          />
        </Form.Item>
        {form.type !== 'proxy' && form.type !== 'custom' ? (
          <Form.Item label="网站目录">
            <Input
              value={form.root_path}
              onChange={(e) => setForm((prev) => ({ ...prev, root_path: e.target.value }))}
              onBlur={() => generateConfig()}
            />
          </Form.Item>
        ) : null}
        {form.type === 'proxy' ? (
          <Form.Item label="代理地址">
            <Input
              value={form.proxy_pass}
              placeholder="http://127.0.0.1:3000"
              onChange={(e) => setForm((prev) => ({ ...prev, proxy_pass: e.target.value }))}
              onBlur={() => generateConfig()}
            />
          </Form.Item>
        ) : null}
        <Form.Item label="配置内容">
          <Input.TextArea
            value={form.config}
            rows={15}
            style={{ fontFamily: 'monospace' }}
            onChange={(e) => setForm((prev) => ({ ...prev, config: e.target.value }))}
          />
        </Form.Item>
      </Form>
      <style>{`
        .nginx-full-domain { color: #409eff; font-weight: bold; }
        @media (max-width: 768px) {
          .nginx-dialog-wrap .ant-modal { width: 95% !important; max-width: 95vw; top: 5vh; }
          .nginx-dialog-wrap .ant-modal-body { max-height: 70vh; overflow-y: auto; }
          .nginx-dialog-wrap .ant-modal-footer { display: flex; flex-wrap: wrap; gap: 8px; }
          .nginx-dialog-wrap .ant-modal-footer .ant-btn { flex: 1; min-width: calc(50% - 4px); margin: 0; }
          .nginx-dialog-wrap .ant-radio-group { display: flex; flex-wrap: wrap; gap: 8px; }
          .nginx-dialog-wrap .ant-radio-button-wrapper { flex: 1; min-width: calc(50% - 4px); text-align: center; }
        }
        @media (max-width: 480px) {
          .nginx-dialog-wrap .ant-radio-button-wrapper { min-width: 100%; }
          .nginx-dialog-wrap .ant-modal-footer .ant-btn { min-width: 100%; }
        }
      `}</style>
    </Modal>
  )
}
