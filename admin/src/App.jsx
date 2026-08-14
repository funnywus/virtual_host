import { Suspense } from 'react'
import { useRoutes } from 'react-router-dom'
import { Spin } from 'antd'
import { routes } from '@/router'

export default function App() {
  const element = useRoutes(routes)
  return (
    <Suspense
      fallback={(
        <div style={{ padding: 120, textAlign: 'center' }}>
          <Spin size="large" />
        </div>
      )}
    >
      {element}
    </Suspense>
  )
}
