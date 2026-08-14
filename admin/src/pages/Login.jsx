import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Button, Checkbox, Form, Input, message } from 'antd'
import { LockOutlined, UserOutlined } from '@ant-design/icons'
import { useUserStore } from '@/stores/user'
import {
  loadRememberedCredentials,
  saveRememberedCredentials,
  clearRememberedCredentials
} from '@/utils/remember-credentials'
import './Login.css'

export default function Login() {
  const navigate = useNavigate()
  const login = useUserStore((s) => s.login)
  const token = useUserStore((s) => s.token)
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [rememberPassword, setRememberPassword] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadRememberedCredentials().then((remembered) => {
      if (cancelled || !remembered?.username) return
      form.setFieldsValue({
        username: remembered.username,
        password: remembered.password || ''
      })
      setRememberPassword(true)
    })
    return () => {
      cancelled = true
    }
  }, [form])

  if (token) return <Navigate to="/subdomains" replace />

  function onRememberChange(checked) {
    setRememberPassword(checked)
    if (!checked) {
      clearRememberedCredentials()
      form.setFieldValue('password', '')
    }
  }

  async function onFinish(values) {
    if (!values.username || !values.password) {
      message.warning('请输入用户名和密码')
      return
    }
    setLoading(true)
    try {
      await login(values.username, values.password)
      if (rememberPassword) {
        await saveRememberedCredentials(values.username, values.password)
      } else {
        clearRememberedCredentials()
      }
      message.success('登录成功')
      navigate('/subdomains')
    } catch {
      // 错误已在拦截器处理
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-box">
          <div className="login-header">
            <div className="login-logo">🔐</div>
            <h2 className="login-title">管理后台</h2>
            <p className="login-subtitle">请登录您的管理员账号</p>
          </div>
          <Form form={form} className="login-form" onFinish={onFinish}>
            <Form.Item name="username">
              <Input size="large" placeholder="请输入用户名" prefix={<UserOutlined />} />
            </Form.Item>
            <Form.Item name="password">
              <Input.Password size="large" placeholder="请输入密码" prefix={<LockOutlined />} />
            </Form.Item>
            <div className="login-options">
              <Checkbox
                checked={rememberPassword}
                onChange={(e) => onRememberChange(e.target.checked)}
              >
                记住密码
              </Checkbox>
            </div>
            <Form.Item>
              <Button type="primary" htmlType="submit" size="large" loading={loading} className="login-btn" block>
                登 录
              </Button>
            </Form.Item>
          </Form>
        </div>
        <div className="login-decoration">
          <div className="decoration-circle circle-1" />
          <div className="decoration-circle circle-2" />
          <div className="decoration-circle circle-3" />
        </div>
      </div>
      <div className="login-footer-text">文件管理系统 · 安全可靠</div>
    </div>
  )
}
