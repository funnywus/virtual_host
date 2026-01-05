import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/api'

export const useDataStore = defineStore('data', () => {
  const domains = ref([])
  const subdomains = ref([])
  const subdomainsTotal = ref(0)
  const servers = ref([])
  const aliyunConfigs = ref([])
  const ftpAccounts = ref([])
  const users = ref([])
  const serverTags = ref([])

  async function loadDomains() {
    domains.value = await api.get('/dns/domains')
  }

  async function loadSubdomains(domainId = null, page = 1, pageSize = 20) {
    let url = `/dns/subdomains?page=${page}&pageSize=${pageSize}`
    if (domainId) url += `&domain_id=${domainId}`
    const res = await api.get(url)
    subdomains.value = res.list || []
    subdomainsTotal.value = res.total || 0
    return res
  }

  async function loadServers() {
    servers.value = await api.get('/servers')
  }

  async function loadAliyunConfigs() {
    aliyunConfigs.value = await api.get('/dns/aliyun-configs')
  }

  async function loadFtpAccounts() {
    ftpAccounts.value = await api.get('/ftp')
  }

  async function loadUsers() {
    users.value = await api.get('/users')
  }

  async function loadServerTags() {
    serverTags.value = await api.get('/tags')
  }

  async function loadAll() {
    await Promise.all([
      loadDomains(),
      loadSubdomains(),
      loadServers(),
      loadAliyunConfigs(),
      loadUsers(),
      loadServerTags()
    ])
  }

  return {
    domains, subdomains, subdomainsTotal, servers, aliyunConfigs, ftpAccounts, users, serverTags,
    loadDomains, loadSubdomains, loadServers, loadAliyunConfigs, loadFtpAccounts, loadUsers, loadServerTags, loadAll
  }
})
