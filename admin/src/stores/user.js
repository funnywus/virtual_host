import { create } from 'zustand'
import api from '@/api'

function readStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('user') || '{}')
  } catch {
    return {}
  }
}

export const useUserStore = create((set) => ({
  token: localStorage.getItem('token') || '',
  user: readStoredUser(),

  async login(username, password) {
    const res = await api.post('/auth/login', { username, password })
    localStorage.setItem('token', res.token)
    localStorage.setItem('user', JSON.stringify(res.user))
    set({ token: res.token, user: res.user })
    return res
  },

  logout() {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    set({ token: '', user: {} })
  }
}))
