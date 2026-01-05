import { createRouter, createWebHistory } from 'vue-router'
import { useUserStore } from '@/stores/user'

const routes = [
  {
    path: '/',
    name: 'Upload',
    component: () => import('@/views/Upload.vue')
  },
  {
    path: '/admin-jm/login',
    name: 'Login',
    component: () => import('@/views/Login.vue')
  },
  {
    path: '/admin-jm',
    component: () => import('@/layouts/MainLayout.vue'),
    meta: { requiresAuth: true },
    children: [
      { path: '', redirect: '/admin-jm/domains' },
      { path: 'domains', name: 'Domains', component: () => import('@/views/Domains.vue') },
      { path: 'subdomains', name: 'Subdomains', component: () => import('@/views/Subdomains.vue') },
      { path: 'ftp', name: 'Ftp', component: () => import('@/views/Ftp.vue') },
      { path: 'servers', name: 'Servers', component: () => import('@/views/Servers.vue') },
      { path: 'dns-platforms', name: 'DnsPlatforms', component: () => import('@/views/DnsPlatforms.vue') },
      { path: 'tags', name: 'Tags', component: () => import('@/views/Tags.vue') },
      { path: 'users', name: 'Users', component: () => import('@/views/Users.vue') }
    ]
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach((to, from, next) => {
  const userStore = useUserStore()
  if (to.meta.requiresAuth && !userStore.token) {
    next('/admin-jm/login')
  } else {
    next()
  }
})

export default router
