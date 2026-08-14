import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  {
    path: '/',
    name: 'Upload',
    component: () => import('@/views/Upload.vue')
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router
