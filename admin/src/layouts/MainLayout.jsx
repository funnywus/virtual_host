import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Button, Tag } from 'antd'
import { LogoutOutlined } from '@ant-design/icons'
import { useUserStore } from '@/stores/user'
import './MainLayout.css'

const MENU = [
  { to: '/subdomains', icon: '📁', label: '子域名管理' },
  { to: '/traffic', icon: '📊', label: '流量统计' },
  { to: '/domains', icon: '🌐', label: '域名管理' },
  { to: '/dns', icon: '📡', label: 'DNS记录' },
  { to: '/servers', icon: '🖥️', label: '服务器管理' },
  { to: '/ftp', icon: '📤', label: 'FTP账号' },
  { to: '/dns-platforms', icon: '☁️', label: 'DNS平台' },
  { to: '/tags', icon: '🏷️', label: '标签管理' },
  { to: '/users', icon: '👥', label: '用户管理', adminOnly: true },
  { to: '/settings', icon: '⚙️', label: '系统设置', adminOnly: true }
]

export default function MainLayout() {
  const navigate = useNavigate()
  const user = useUserStore((s) => s.user)
  const logout = useUserStore((s) => s.logout)
  const isAdmin = user?.role === 'admin'
  const [collapsed, setCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    function checkMobile() {
      const mobile = window.innerWidth <= 768
      setIsMobile(mobile)
      if (!mobile) setMobileMenuOpen(false)
    }
    checkMobile()
    window.addEventListener('resize', checkMobile)
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('resize', checkMobile)
      document.documentElement.style.overflow = ''
      document.body.style.overflow = ''
    }
  }, [])

  function handleMenuClick() {
    if (isMobile) setMobileMenuOpen(false)
  }

  function handleLogout() {
    logout()
    navigate('/login')
  }

  const className = [
    'admin-layout',
    collapsed ? 'collapsed' : '',
    mobileMenuOpen ? 'mobile-menu-open' : ''
  ].filter(Boolean).join(' ')

  return (
    <div className={className}>
      {mobileMenuOpen && (
        <div className="mobile-overlay" onClick={() => setMobileMenuOpen(false)} />
      )}

      <div className="sidebar">
        <div className="sidebar-header">
          <span className="logo-icon">🚀</span>
          {!collapsed && <span className="logo-text">虚拟主机管理</span>}
          <span className="mobile-close" onClick={() => setMobileMenuOpen(false)}>✕</span>
        </div>
        <div className="sidebar-menu">
          {MENU.filter((item) => !item.adminOnly || isAdmin).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `menu-item${isActive ? ' active' : ''}`}
              onClick={handleMenuClick}
            >
              <span className="menu-icon">{item.icon}</span>
              {(!collapsed || isMobile) && <span className="menu-text">{item.label}</span>}
            </NavLink>
          ))}
        </div>
        <div className="sidebar-footer">
          <div
            className="collapse-btn"
            onClick={() => {
              if (!isMobile) setCollapsed((v) => !v)
            }}
          >
            <span>{collapsed ? '▶' : '◀'}</span>
          </div>
          {!collapsed && <div className="version">v2.0.0</div>}
        </div>
      </div>

      <div className="main-area">
        <div className="header">
          <div className="header-left">
            <button
              className="mobile-menu-btn"
              type="button"
              aria-label="打开后台菜单"
              onClick={() => setMobileMenuOpen((v) => !v)}
            >
              <span />
              <span />
              <span />
            </button>
            <span className="welcome">欢迎回来，</span>
            <span className="username">{user?.username}</span>
            <Tag color={isAdmin ? 'red' : 'default'} className="user-tag">
              {isAdmin ? '管理员' : '用户'}
            </Tag>
          </div>
          <div className="header-right">
            <Button type="text" className="logout-btn" icon={<LogoutOutlined />} onClick={handleLogout}>
              <span className="logout-text">退出登录</span>
            </Button>
          </div>
        </div>
        <div className="content">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
