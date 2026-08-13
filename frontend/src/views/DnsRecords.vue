<template>
  <div class="card">
    <div class="page-header">
      <div class="header-top">
        <span class="page-title">
          DNS记录
          <el-tag v-if="currentDomain" type="info" size="small" class="domain-filter-tag">{{ currentDomain.domain }}</el-tag>
        </span>
        <div class="header-actions">
          <el-button size="small" @click="loadDnsRecords(true)" :disabled="!selectedDomainId" :loading="loading">获取最新DNS</el-button>
          <el-button type="primary" size="small" :disabled="!selectedDomainId" @click="openAddDnsRecordDialog">添加记录</el-button>
        </div>
      </div>
      <div class="filter-bar">
        <el-select
          v-model="selectedDomainId"
          placeholder="选择主域名"
          clearable
          filterable
          class="filter-select"
          size="small"
          @change="onDomainChange"
        >
          <el-option v-for="d in dataStore.domains" :key="d.id" :label="d.domain" :value="d.id" />
        </el-select>
        <el-input
          v-model="searchKeyword"
          placeholder="搜索主机记录、记录值..."
          clearable
          class="filter-search"
          size="small"
          :disabled="!selectedDomainId"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>
        <el-tag v-if="dnsRecords.platform" size="small" :type="platformInfo.type">{{ platformInfo.name }}</el-tag>
        <span v-if="selectedDomainId" class="record-count">共 {{ filteredDnsRecords.length }} 条记录</span>
      </div>
    </div>

    <el-empty v-if="!selectedDomainId" description="请选择主域名查看 DNS 解析记录" />

    <template v-else>
      <el-table :data="paginatedDnsRecords" stripe size="small" v-loading="loading" class="dns-table">
        <el-table-column label="主机记录" min-width="220">
          <template #default="{ row }">
            <div class="record-cell">
              <el-tooltip content="点击复制完整域名" placement="top" :show-after="400">
                <span class="record-name" @click="copyDnsFullDomain(row)">{{ row.name || '@' }}</span>
              </el-tooltip>
              <span class="record-fqdn">{{ getDnsFullDomain(row.name) }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="80">
          <template #default="{ row }">
            <el-tag size="small" type="info">{{ row.type }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="记录值" min-width="180">
          <template #default="{ row }">
            <span class="record-value" :title="row.value">{{ row.value }}</span>
          </template>
        </el-table-column>
        <el-table-column label="服务器" width="160">
          <template #default="{ row }">
            <span v-if="row.type === 'A'" class="server-name">{{ getServerNameByIp(row.value) || '-' }}</span>
            <span v-else class="empty-text">-</span>
          </template>
        </el-table-column>
        <el-table-column label="TTL" width="90">
          <template #default="{ row }">
            <span class="ttl-text">{{ formatTtl(row.ttl) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="80">
          <template #default="{ row }">
            <el-tag :type="row.status === 'active' ? 'success' : 'info'" size="small">
              {{ row.status === 'active' ? '启用' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <div class="row-actions">
              <el-button type="primary" size="small" @click="openEditDnsRecordDialog(row)">修改</el-button>
              <el-dropdown trigger="click">
                <el-button size="small">更多<el-icon class="el-icon--right"><ArrowDown /></el-icon></el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item v-if="row.status === 'active'" @click="toggleDnsRecordStatus(row, 'DISABLE')">停用</el-dropdown-item>
                    <el-dropdown-item v-else @click="toggleDnsRecordStatus(row, 'ENABLE')">启用</el-dropdown-item>
                    <el-dropdown-item divided @click="deleteDnsRecord(row)" style="color:#f56c6c">删除</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </template>
        </el-table-column>
      </el-table>
      <div class="pagination-wrap">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :page-sizes="[10, 20, 50, 100]"
          :total="filteredDnsRecords.length"
          layout="total, sizes, prev, pager, next"
          @size-change="currentPage = 1"
        />
      </div>
    </template>

    <AppDialog
      v-model="recordDialogVisible"
      :title="editingRecordId ? '修改DNS记录' : '添加DNS记录'"
      width="450px"
      :loading="saving"
      :confirm-text="editingRecordId ? '保存' : '添加'"
      @confirm="saveDnsRecord"
    >
      <el-form :model="recordForm" label-width="100px">
        <el-form-item label="主机记录">
          <el-input v-model="recordForm.name" placeholder="例如: www, @, *" />
        </el-form-item>
        <el-form-item label="记录类型">
          <el-select v-model="recordForm.type" style="width:100%" @change="onDnsTypeChange">
            <el-option label="A" value="A" />
            <el-option label="CNAME" value="CNAME" />
            <el-option label="TXT" value="TXT" />
            <el-option label="MX" value="MX" />
            <el-option label="AAAA" value="AAAA" />
          </el-select>
        </el-form-item>
        <el-form-item label="服务器" v-if="recordForm.type === 'A'">
          <el-select v-model="recordForm.server_id" placeholder="选择服务器" clearable style="width:100%" @change="onDnsServerChange">
            <el-option v-for="s in availableServers" :key="s.id" :label="`${s.name} (${s.ip})${s.is_default === 1 ? ' (默认)' : ''}`" :value="s.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="记录值">
          <el-input v-model="recordForm.value" placeholder="IP地址或目标域名" />
        </el-form-item>
        <el-form-item label="TTL">
          <el-select v-model="recordForm.ttl" style="width:100%">
            <el-option label="1分钟" :value="60" />
            <el-option label="10分钟" :value="600" />
            <el-option label="30分钟" :value="1800" />
            <el-option label="1小时" :value="3600" />
          </el-select>
        </el-form-item>
      </el-form>
    </AppDialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, ArrowDown } from '@element-plus/icons-vue'
import { useDataStore } from '@/stores/data'
import { copyText, platformTypes } from '@/utils'
import api from '@/api'

const route = useRoute()
const router = useRouter()
const dataStore = useDataStore()

const selectedDomainId = ref(null)
const searchKeyword = ref('')
const loading = ref(false)
const saving = ref(false)
const recordDialogVisible = ref(false)
const editingRecordId = ref(null)
const currentPage = ref(1)
const pageSize = ref(10)
const dnsRecords = reactive({ platform: '', records: [] })
const recordForm = reactive({ name: '', type: 'A', value: '', ttl: 600, server_id: null })

const currentDomain = computed(() => dataStore.domains.find(d => d.id === selectedDomainId.value) || null)
const availableServers = computed(() => dataStore.servers.filter(s => s.status !== 'disabled'))
const platformInfo = computed(() => platformTypes[dnsRecords.platform] || { name: dnsRecords.platform || '未知平台', type: 'info' })

const filteredDnsRecords = computed(() => {
  let records = dnsRecords.records
  if (searchKeyword.value) {
    const kw = searchKeyword.value.toLowerCase()
    records = records.filter(r =>
      r.name?.toLowerCase().includes(kw) ||
      r.value?.toLowerCase().includes(kw) ||
      r.type?.toLowerCase().includes(kw)
    )
  }
  return records
})

const paginatedDnsRecords = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return filteredDnsRecords.value.slice(start, start + pageSize.value)
})

watch(searchKeyword, () => {
  currentPage.value = 1
})

watch(() => route.query.domain_id, (domainId) => {
  applyDomainFromQuery(domainId)
})

onMounted(async () => {
  await Promise.all([
    dataStore.loadDomains(),
    dataStore.loadServers()
  ])
  applyDomainFromQuery(route.query.domain_id, { autoSelect: true })
})

function applyDomainFromQuery(domainId, { autoSelect = false } = {}) {
  const parsed = domainId ? parseInt(domainId, 10) : null
  if (parsed) {
    if (selectedDomainId.value !== parsed) {
      selectedDomainId.value = parsed
      loadDnsRecords()
    }
    return
  }
  if (autoSelect && !selectedDomainId.value) {
    const defaultDomain = dataStore.domains.find(d => d.is_default === 1)
    const fallback = defaultDomain || dataStore.domains[0]
    if (fallback) {
      selectedDomainId.value = fallback.id
      router.replace({ path: '/admin-jm/dns', query: { domain_id: fallback.id } })
      loadDnsRecords()
    }
    return
  }
  selectedDomainId.value = null
  dnsRecords.platform = ''
  dnsRecords.records = []
}

function onDomainChange(domainId) {
  currentPage.value = 1
  searchKeyword.value = ''
  dnsRecords.platform = ''
  dnsRecords.records = []
  router.replace({
    path: '/admin-jm/dns',
    query: domainId ? { domain_id: domainId } : {}
  })
  if (domainId) loadDnsRecords()
}

function getDefaultAvailableServer() {
  return availableServers.value.find(s => s.is_default === 1) || availableServers.value[0] || null
}

function getServerNameByIp(ip) {
  const server = dataStore.servers.find(s => s.ip === ip)
  return server?.name || ''
}

function formatTtl(ttl) {
  const value = Number(ttl)
  if (value === 60) return '1分钟'
  if (value === 600) return '10分钟'
  if (value === 1800) return '30分钟'
  if (value === 3600) return '1小时'
  if (!value) return '-'
  if (value < 60) return `${value}秒`
  if (value % 3600 === 0) return `${value / 3600}小时`
  if (value % 60 === 0) return `${value / 60}分钟`
  return `${value}秒`
}

function getDnsFullDomain(name) {
  const domain = currentDomain.value?.domain
  if (!domain) return ''
  if (!name || name === '@') return domain
  return `${name}.${domain}`
}

function copyDnsFullDomain(row) {
  copyText(getDnsFullDomain(row.name))
}

async function loadDnsRecords(showSuccess = false) {
  if (!selectedDomainId.value) return
  loading.value = true
  try {
    const res = await api.get(`/dns/domains/${selectedDomainId.value}/dns-records`)
    dnsRecords.platform = res.platform
    dnsRecords.records = res.records || []
    if (showSuccess) {
      ElMessage.success(`已获取最新 DNS，共 ${res.records?.length || 0} 条记录`)
    }
  } catch (e) {
    dnsRecords.platform = ''
    dnsRecords.records = []
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}

function openAddDnsRecordDialog() {
  editingRecordId.value = null
  const defaultServer = getDefaultAvailableServer()
  Object.assign(recordForm, {
    name: '',
    type: 'A',
    value: defaultServer?.ip || '',
    ttl: 600,
    server_id: defaultServer?.id || null
  })
  recordDialogVisible.value = true
}

function openEditDnsRecordDialog(row) {
  editingRecordId.value = row.id
  const server = row.type === 'A' ? dataStore.servers.find(s => s.ip === row.value) : null
  Object.assign(recordForm, {
    name: row.name,
    type: row.type,
    value: row.value,
    ttl: row.ttl || 600,
    server_id: server?.id || null
  })
  recordDialogVisible.value = true
}

function onDnsServerChange() {
  const server = dataStore.servers.find(s => s.id === recordForm.server_id)
  if (server) {
    recordForm.value = server.ip
  }
}

function onDnsTypeChange() {
  if (recordForm.type === 'A') {
    const defaultServer = getDefaultAvailableServer()
    recordForm.server_id = defaultServer?.id || null
    recordForm.value = defaultServer?.ip || ''
  } else {
    recordForm.server_id = null
    recordForm.value = ''
  }
}

async function saveDnsRecord() {
  if (!recordForm.name || !recordForm.value) {
    ElMessage.warning('请填写主机记录和记录值')
    return
  }
  saving.value = true
  try {
    const payload = {
      name: recordForm.name,
      type: recordForm.type,
      value: recordForm.value,
      ttl: recordForm.ttl
    }
    if (editingRecordId.value) {
      await api.put(`/dns/domains/${selectedDomainId.value}/dns-records/${editingRecordId.value}`, payload)
      ElMessage.success('修改成功')
    } else {
      await api.post(`/dns/domains/${selectedDomainId.value}/dns-records`, payload)
      ElMessage.success('添加成功')
    }
    recordDialogVisible.value = false
    loadDnsRecords()
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function deleteDnsRecord(row) {
  await ElMessageBox.confirm(`确定删除记录 "${row.name}" ?`, '提示')
  try {
    await api.delete(`/dns/domains/${selectedDomainId.value}/dns-records/${row.id}`)
    ElMessage.success('删除成功')
    loadDnsRecords()
  } catch (e) {
    ElMessage.error(e.message)
  }
}

async function toggleDnsRecordStatus(row, status) {
  try {
    await api.put(`/dns/domains/${selectedDomainId.value}/dns-records/${row.id}/status`, { status })
    ElMessage.success(status === 'ENABLE' ? '已启用' : '已停用')
    loadDnsRecords()
  } catch (e) {
    ElMessage.error(e.message)
  }
}
</script>

<style scoped>
.card {
  background: rgba(255, 255, 255, 0.95);
  padding: 25px;
  border-radius: 16px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
}

.page-header {
  margin-bottom: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid #f0f0f0;
}

.header-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin-bottom: 14px;
}

.page-title {
  font-size: 18px;
  font-weight: 600;
  color: #303133;
  display: flex;
  align-items: center;
  gap: 10px;
}

.domain-filter-tag {
  font-weight: 400;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.filter-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 12px 14px;
  background: #f8f9fb;
  border: 1px solid #eef0f4;
  border-radius: 10px;
}

.filter-select {
  width: 220px;
}

.filter-search {
  width: 240px;
}

.record-count {
  color: #909399;
  font-size: 13px;
  margin-left: auto;
}

.dns-table {
  width: 100%;
}

.record-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.record-name {
  font-weight: 600;
  color: #303133;
  cursor: pointer;
  line-height: 1.3;
}

.record-name:hover {
  color: #409eff;
}

.record-fqdn {
  font-size: 12px;
  color: #909399;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.record-value {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  color: #606266;
}

.server-name {
  color: #606266;
}

.ttl-text,
.empty-text {
  color: #909399;
  font-size: 12px;
}

.row-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.row-actions .el-button {
  margin-left: 0;
}

.pagination-wrap {
  margin-top: 15px;
  display: flex;
  justify-content: flex-end;
}

:deep(.el-table) {
  border-radius: 10px;
  overflow: hidden;
}

:deep(.el-table th) {
  background: #f8f9fa !important;
  font-weight: 600;
}

@media (max-width: 768px) {
  .card {
    padding: 16px;
  }

  .header-top {
    flex-direction: column;
    align-items: stretch;
  }

  .filter-select,
  .filter-search {
    width: 100%;
  }

  .record-count {
    margin-left: 0;
  }

  .pagination-wrap {
    justify-content: center;
  }
}
</style>
