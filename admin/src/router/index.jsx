import { lazy } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { useUserStore } from '@/stores/user'
import MainLayout from '@/layouts/MainLayout'
import Login from '@/pages/Login'

const Subdomains = lazy(() => import('@/pages/Subdomains'))
const Traffic = lazy(() => import('@/pages/Traffic'))
const Domains = lazy(() => import('@/pages/Domains'))
const DnsRecords = lazy(() => import('@/pages/DnsRecords'))
const Servers = lazy(() => import('@/pages/Servers'))
const Ftp = lazy(() => import('@/pages/Ftp'))
const DnsPlatforms = lazy(() => import('@/pages/DnsPlatforms'))
const Tags = lazy(() => import('@/pages/Tags'))
const Users = lazy(() => import('@/pages/Users'))
const Settings = lazy(() => import('@/pages/Settings'))

function RequireAuth() {
  const token = useUserStore((s) => s.token)
  if (!token) return <Navigate to="/login" replace />
  return <Outlet />
}

function RequireAdmin() {
  const user = useUserStore((s) => s.user)
  if (user?.role !== 'admin') return <Navigate to="/subdomains" replace />
  return <Outlet />
}

export const routes = [
  { path: '/login', element: <Login /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <MainLayout />,
        children: [
          { index: true, element: <Navigate to="/subdomains" replace /> },
          { path: 'subdomains', element: <Subdomains /> },
          { path: 'traffic', element: <Traffic /> },
          { path: 'domains', element: <Domains /> },
          { path: 'dns', element: <DnsRecords /> },
          { path: 'servers', element: <Servers /> },
          { path: 'ftp', element: <Ftp /> },
          { path: 'dns-platforms', element: <DnsPlatforms /> },
          { path: 'tags', element: <Tags /> },
          {
            element: <RequireAdmin />,
            children: [
              { path: 'users', element: <Users /> },
              { path: 'settings', element: <Settings /> }
            ]
          }
        ]
      }
    ]
  },
  { path: '*', element: <Navigate to="/subdomains" replace /> }
]
