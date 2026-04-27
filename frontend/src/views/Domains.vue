<template>
  <div class="card">
    <div class="card-title">
      <span>主域名列表</span>
      <div>
        <el-input 
          v-model="searchKeyword" 
          placeholder="搜索域名、备注..." 
          clearable 
          style="width:200px;margin-right:10px" 
          size="small"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>
        <el-button size="small" @click="loadData" :loading="loading"><el-icon><Refresh /></el-icon></el-button>
        <el-button size="small" @click="refreshAllSsl" :loading="refreshingSsl">刷新证书状态</el-button>
        <el-button type="primary" size="small" @click="openDialog()">添加域名</el-button>
      </div>
    </div>
    <el-table :data="filteredDomains" stripe>
      <el-table-column prop="domain" label="域名" width="180">
        <template #default="{ row }">
          <span class="full-domain">{{ row.domain }}</span>
          <el-tag v-if="row.is_default === 1" type="warning" size="small" style="margin-left:5px">默认</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="aliyun_name" label="DNS配置" width="120">
        <template #default="{ row }">
          <el-tag v-if="row.aliyun_name" type="success">{{ row.aliyun_name }}</el-tag>
          <el-tag v-else type="info">未配置</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="标签" width="80">
        <template #default="{ row }">
          <el-tag v-for="tag in parseTags(row.tags)" :key="tag" :style="getTagStyle(tag)" size="small" style="margin-right:4px">{{ tag }}</el-tag>
          <span v-if="!row.tags" style="color:#999">-</span>
        </template>
      </el-table-column>
      <el-table-column label="SSL证书" width="120">
        <template #default="{ row }">
          <p>
          <el-tag :type="getSslStatusType(row.ssl_status)" size="small">{{ getSslStatusText(row.ssl_status) }}</el-tag>
          </p>
          <p>
          <el-tag v-if="row.ssl_expires" :type="getSslDaysType(row.ssl_expires)" size="small">
            {{ formatSslDays(row.ssl_expires) }}
          </el-tag>
          </p>
        </template>
      </el-table-column>
      <el-table-column prop="created_at" label="添加时间" width="160">
        <template #default="{ row }">
          <span style="font-size:12px;color:#909399">{{ formatDateTime(row.created_at) }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="expire_at" label="到期时间" width="180">
        <template #default="{ row }">
          <div v-if="row.expire_at" style="display:flex;flex-direction:column;gap:2px">
            <span :style="{ fontSize: '12px', color: getExpireColor(row.expire_at), fontWeight: '500' }">
              {{ formatDateTime(row.expire_at) }}
            </span>
            <span :style="{ fontSize: '11px', color: getExpireColor(row.expire_at) }">
              {{ getExpireDaysText(row.expire_at) }}
            </span>
          </div>
          <span v-else style="font-size:12px;color:#909399">永久</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="240" fixed="right">
        <template #default="{ row }">
          <el-button type="primary" size="small" @click="openDnsRecordsDialog(row)">DNS记录</el-button>
          <el-button type="warning" size="small" @click="openSslDialog(row)">SSL</el-button>
          <el-dropdown trigger="click" style="margin-left:8px">
            <el-button size="small">更多<el-icon class="el-icon--right"><ArrowDown /></el-icon></el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="viewSubdomains(row)">子域名</el-dropdown-item>
                <el-dropdown-item @click="setDefault(row)" :disabled="row.is_default === 1">设为默认</el-dropdown-item>
                <el-dropdown-item @click="openDialog(row)">编辑</el-dropdown-item>
                <el-dropdown-item divided @click="handleDelete(row.id)" style="color:#f56c6c">删除</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </template>
      </el-table-column>
    </el-table>

    <!-- 添加/编辑对话框 -->
    <el-dialog v-model="dialogVisible" :title="form.id ? '编辑域名' : '添加域名'" width="450px">
      <el-form :model="form" label-width="100px">
        <el-form-item label="域名">
          <el-input v-model="form.domain" placeholder="例如: example.com" :disabled="!!form.id" />
        </el-form-item>
        <el-form-item label="DNS配置">
          <el-select v-model="form.aliyun_config_id" placeholder="选择DNS配置" clearable style="width:100%">
            <el-option v-for="c in dataStore.aliyunConfigs" :key="c.id" :label="c.name + (c.is_default === 1 ? ' (默认)' : '')" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="标签">
          <el-select v-model="form.tagList" multiple filterable allow-create default-first-option placeholder="选择或输入标签" style="width:100%" @change="onTagChange">
            <el-option v-for="t in dataStore.serverTags" :key="t.id" :label="t.name" :value="t.name" />
          </el-select>
        </el-form-item>
        <el-form-item label="到期时间">
          <el-date-picker
            v-model="form.expire_at"
            type="datetime"
            placeholder="选择到期时间"
            format="YYYY-MM-DD HH:mm:ss"
            value-format="YYYY-MM-DD HH:mm:ss"
            style="width:100%"
            clearable
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSave" :loading="saving">确定</el-button>
      </template>
    </el-dialog>

    <!-- SSL证书对话框 -->
    <SslDialog v-model="sslDialogVisible" :domain="currentDomain" @refresh="dataStore.loadDomains" />

    <!-- DNS记录对话框 -->
    <el-dialog v-model="dnsRecordsDialogVisible" :title="'DNS解析记录 - ' + (currentDomain?.domain || '')" width="900px">
      <div style="margin-bottom:15px;display:flex;justify-content:space-between;align-items:center">
        <div style="display:flex;gap:10px;align-items:center">
          <el-tag type="info">{{ dnsRecords.platform === 'tencent' ? '腾讯云' : '阿里云' }}</el-tag>
          <span style="color:#909399">共 {{ filteredDnsRecords.length }} 条记录</span>
        </div>
        <div style="display:flex;gap:10px">
          <el-input 
            v-model="dnsSearchKeyword" 
            placeholder="搜索主机记录、记录值..." 
            clearable 
            style="width:220px" 
            size="small"
          >
            <template #prefix>
              <el-icon><Search /></el-icon>
            </template>
          </el-input>
          <el-button size="small" @click="loadDnsRecords" :loading="loadingDnsRecords"><el-icon><Refresh /></el-icon> 刷新</el-button>
          <el-button type="primary" size="small" @click="openAddDnsRecordDialog">添加记录</el-button>
        </div>
      </div>
      <el-table :data="paginatedDnsRecords" stripe v-loading="loadingDnsRecords" max-height="500">
        <el-table-column prop="name" label="主机记录" width="120" />
        <el-table-column prop="type" label="类型" width="80" />
        <el-table-column prop="value" label="记录值" min-width="180" show-overflow-tooltip />
        <el-table-column label="服务器" width="120">
          <template #default="{ row }">
            <span v-if="row.type === 'A'">{{ getServerNameByIp(row.value) || '-' }}</span>
            <span v-else style="color:#999">-</span>
          </template>
        </el-table-column>
        <el-table-column prop="ttl" label="TTL" width="80" />
        <el-table-column label="状态" width="80">
          <template #default="{ row }">
            <el-tag :type="row.status === 'active' ? 'success' : 'danger'" size="small">
              {{ row.status === 'active' ? '启用' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.status === 'active'" type="warning" size="small" @click="toggleDnsRecordStatus(row, 'DISABLE')">停用</el-button>
            <el-button v-else type="success" size="small" @click="toggleDnsRecordStatus(row, 'ENABLE')">启用</el-button>
            <el-button type="danger" size="small" @click="deleteDnsRecord(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div style="margin-top:15px;display:flex;justify-content:flex-end">
        <el-pagination
          v-model:current-page="dnsCurrentPage"
          v-model:page-size="dnsPageSize"
          :page-sizes="[10, 20, 50, 100]"
          :total="filteredDnsRecords.length"
          layout="total, sizes, prev, pager, next"
          @size-change="dnsCurrentPage = 1"
        />
      </div>
    </el-dialog>

    <!-- 添加DNS记录对话框 -->
    <el-dialog v-model="addDnsRecordDialogVisible" title="添加DNS记录" width="450px">
      <el-form :model="dnsRecordForm" label-width="100px">
        <el-form-item label="主机记录">
          <el-input v-model="dnsRecordForm.name" placeholder="例如: www, @, *" />
        </el-form-item>
        <el-form-item label="记录类型">
          <el-select v-model="dnsRecordForm.type" style="width:100%" @change="onDnsTypeChange">
            <el-option label="A" value="A" />
            <el-option label="CNAME" value="CNAME" />
            <el-option label="TXT" value="TXT" />
            <el-option label="MX" value="MX" />
            <el-option label="AAAA" value="AAAA" />
          </el-select>
        </el-form-item>
        <el-form-item label="服务器" v-if="dnsRecordForm.type === 'A'">
          <el-select v-model="dnsRecordForm.server_id" placeholder="选择服务器" clearable style="width:100%" @change="onDnsServerChange">
            <el-option v-for="s in dataStore.servers" :key="s.id" :label="`${s.name} (${s.ip})${s.is_default === 1 ? ' (默认)' : ''}`" :value="s.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="记录值">
          <el-input v-model="dnsRecordForm.value" placeholder="IP地址或目标域名" />
        </el-form-item>
        <el-form-item label="TTL">
          <el-select v-model="dnsRecordForm.ttl" style="width:100%">
            <el-option label="1分钟" :value="60" />
            <el-option label="10分钟" :value="600" />
            <el-option label="30分钟" :value="1800" />
            <el-option label="1小时" :value="3600" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="addDnsRecordDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="addDnsRecord" :loading="addingDnsRecord">添加</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh, ArrowDown, Search } from '@element-plus/icons-vue'
import { useDataStore } from '@/stores/data'
import { formatSslDays, getSslDaysType } from '@/utils'
import api from '@/api'
import SslDialog from '@/components/SslDialog.vue'

const router = useRouter()
const dataStore = useDataStore()

const dialogVisible = ref(false)
const sslDialogVisible = ref(false)
const dnsRecordsDialogVisible = ref(false)
const addDnsRecordDialogVisible = ref(false)
const saving = ref(false)
const loading = ref(false)
const refreshingSsl = ref(false)
const loadingDnsRecords = ref(false)
const addingDnsRecord = ref(false)
const currentDomain = ref(null)
const searchKeyword = ref('')
const dnsSearchKeyword = ref('')
const form = reactive({ id: null, domain: '', aliyun_config_id: null, tagList: [], expire_at: null })
const dnsRecords = reactive({ platform: '', records: [] })
const dnsRecordForm = reactive({ name: '', type: 'A', value: '', ttl: 600, server_id: null })
const dnsCurrentPage = ref(1)
const dnsPageSize = ref(10)

const filteredDnsRecords = computed(() => {
  let records = dnsRecords.records
  
  // 搜索过滤
  if (dnsSearchKeyword.value) {
    const kw = dnsSearchKeyword.value.toLowerCase()
    records = records.filter(r => 
      r.name?.toLowerCase().includes(kw) ||
      r.value?.toLowerCase().includes(kw) ||
      r.type?.toLowerCase().includes(kw)
    )
  }
  
  return records
})

const paginatedDnsRecords = computed(() => {
  const start = (dnsCurrentPage.value - 1) * dnsPageSize.value
  return filteredDnsRecords.value.slice(start, start + dnsPageSize.value)
})

function getServerNameByIp(ip) {
  const server = dataStore.servers.find(s => s.ip === ip)
  return server?.name || ''
}

const filteredDomains = computed(() => {
  if (!searchKeyword.value) return dataStore.domains
  const kw = searchKeyword.value.toLowerCase()
  return dataStore.domains.filter(d => 
    d.domain?.toLowerCase().includes(kw) ||
    d.aliyun_name?.toLowerCase().includes(kw) ||
    d.tags?.toLowerCase().includes(kw)
  )
})

onMounted(() => {
  loadData()
  dataStore.loadAliyunConfigs()
  dataStore.loadServerTags()
  dataStore.loadServers()
})

async function loadData() {
  loading.value = true
  try {
    await dataStore.loadDomains()
  } finally {
    loading.value = false
  }
}

function parseTags(tags) {
  if (!tags) return []
  return tags.split(',').filter(t => t.trim())
}

function getTagColor(tagName) {
  const tag = dataStore.serverTags.find(t => t.name === tagName)
  return tag?.color || ''
}

function getTagStyle(tagName) {
  const color = getTagColor(tagName)
  return color ? { backgroundColor: color, borderColor: color, color: '#fff' } : {}
}

async function onTagChange(tags) {
  for (const tag of tags) {
    const exists = dataStore.serverTags.some(t => t.name === tag)
    if (!exists) {
      try {
        await api.post('/tags', { name: tag })
        dataStore.loadServerTags()
      } catch (e) {}
    }
  }
}

function getSslStatusType(status) {
  const types = { active: 'success', issuing: 'warning', renewing: 'warning', error: 'danger' }
  return types[status] || 'info'
}

function getSslStatusText(status) {
  const texts = { active: '已启用', issuing: '申请中', renewing: '续期中', error: '失败' }
  return texts[status] || '未申请'
}

function openDialog(row = null) {
  if (row) {
    Object.assign(form, { 
      id: row.id, 
      domain: row.domain, 
      aliyun_config_id: row.aliyun_config_id, 
      tagList: parseTags(row.tags),
      expire_at: row.expire_at || null
    })
  } else {
    const defaultConfig = dataStore.aliyunConfigs.find(c => c.is_default === 1)
    const defaultTag = dataStore.serverTags.find(t => t.is_default === 1)
    Object.assign(form, { 
      id: null, 
      domain: '', 
      aliyun_config_id: defaultConfig?.id || null, 
      tagList: defaultTag ? [defaultTag.name] : [],
      expire_at: null
    })
  }
  dialogVisible.value = true
}

function openSslDialog(row) {
  currentDomain.value = row
  sslDialogVisible.value = true
}

function viewSubdomains(row) {
  router.push({ path: '/admin-jm/subdomains', query: { domain_id: row.id } })
}

async function handleSave() {
  saving.value = true
  try {
    const data = { 
      aliyun_config_id: form.aliyun_config_id, 
      tags: form.tagList.join(','),
      expire_at: form.expire_at || null
    }
    if (form.id) {
      await api.put(`/dns/domains/${form.id}`, data)
    } else {
      await api.post('/dns/domains', { ...form, tags: form.tagList.join(','), expire_at: form.expire_at || null })
    }
    ElMessage.success('保存成功')
    dialogVisible.value = false
    dataStore.loadDomains()
  } finally {
    saving.value = false
  }
}

async function handleDelete(id) {
  await ElMessageBox.confirm('确定删除此域名？', '提示')
  await api.delete(`/dns/domains/${id}`)
  ElMessage.success('删除成功')
  dataStore.loadDomains()
}

async function setDefault(row) {
  await api.post(`/dns/domains/${row.id}/set-default`)
  ElMessage.success('已设为默认')
  dataStore.loadDomains()
}

async function refreshAllSsl() {
  refreshingSsl.value = true
  try {
    await api.post('/ssl/check-all')
    await dataStore.loadDomains()
    ElMessage.success('证书状态已更新')
  } finally {
    refreshingSsl.value = false
  }
}

// DNS记录相关
async function openDnsRecordsDialog(row) {
  currentDomain.value = row
  dnsRecords.platform = ''
  dnsRecords.records = []
  dnsRecordsDialogVisible.value = true
  await loadDnsRecords()
}

async function loadDnsRecords() {
  if (!currentDomain.value) return
  loadingDnsRecords.value = true
  try {
    const res = await api.get(`/dns/domains/${currentDomain.value.id}/dns-records`)
    dnsRecords.platform = res.platform
    dnsRecords.records = res.records
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loadingDnsRecords.value = false
  }
}

function openAddDnsRecordDialog() {
  const defaultServer = dataStore.servers.find(s => s.is_default === 1)
  Object.assign(dnsRecordForm, { 
    name: '', 
    type: 'A', 
    value: defaultServer?.ip || '', 
    ttl: 600,
    server_id: defaultServer?.id || null
  })
  addDnsRecordDialogVisible.value = true
}

function onDnsServerChange() {
  const server = dataStore.servers.find(s => s.id === dnsRecordForm.server_id)
  if (server) {
    dnsRecordForm.value = server.ip
  }
}

function onDnsTypeChange() {
  if (dnsRecordForm.type === 'A') {
    const defaultServer = dataStore.servers.find(s => s.is_default === 1)
    dnsRecordForm.server_id = defaultServer?.id || null
    dnsRecordForm.value = defaultServer?.ip || ''
  } else {
    dnsRecordForm.server_id = null
    dnsRecordForm.value = ''
  }
}

async function addDnsRecord() {
  if (!dnsRecordForm.name || !dnsRecordForm.value) {
    ElMessage.warning('请填写主机记录和记录值')
    return
  }
  addingDnsRecord.value = true
  try {
    await api.post(`/dns/domains/${currentDomain.value.id}/dns-records`, dnsRecordForm)
    ElMessage.success('添加成功')
    addDnsRecordDialogVisible.value = false
    loadDnsRecords()
  } finally {
    addingDnsRecord.value = false
  }
}

async function deleteDnsRecord(row) {
  await ElMessageBox.confirm(`确定删除记录 "${row.name}" ?`, '提示')
  try {
    await api.delete(`/dns/domains/${currentDomain.value.id}/dns-records/${row.id}`)
    ElMessage.success('删除成功')
    loadDnsRecords()
  } catch (e) {
    ElMessage.error(e.message)
  }
}

async function toggleDnsRecordStatus(row, status) {
  try {
    await api.put(`/dns/domains/${currentDomain.value.id}/dns-records/${row.id}/status`, { status })
    ElMessage.success(status === 'ENABLE' ? '已启用' : '已停用')
    loadDnsRecords()
  } catch (e) {
    ElMessage.error(e.message)
  }
}

// 时间格式化函数
function formatDateTime(dateStr) {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return dateStr
  
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const h = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  const s = String(date.getSeconds()).padStart(2, '0')
  
  return `${y}-${m}-${d} ${h}:${min}:${s}`
}

// 获取到期时间颜色
function getExpireColor(expireAt) {
  if (!expireAt) return '#909399'
  
  const now = new Date()
  const expire = new Date(expireAt)
  const daysLeft = Math.ceil((expire - now) / (1000 * 60 * 60 * 24))
  
  if (daysLeft < 0) return '#FF3B30' // 已过期 - 红色
  if (daysLeft <= 7) return '#FF9500' // 7天内 - 橙色
  if (daysLeft <= 30) return '#FFCC00' // 30天内 - 黄色
  return '#34C759' // 正常 - 绿色
}

// 获取剩余天数文本
function getExpireDaysText(expireAt) {
  if (!expireAt) return ''
  
  const now = new Date()
  const expire = new Date(expireAt)
  const daysLeft = Math.ceil((expire - now) / (1000 * 60 * 60 * 24))
  
  if (daysLeft < 0) return `已过期 ${Math.abs(daysLeft)} 天`
  if (daysLeft === 0) return '今天到期'
  if (daysLeft === 1) return '明天到期'
  return `还剩 ${daysLeft} 天`
}
</script>

<style scoped>
.card {
  background: rgba(255, 255, 255, 0.95);
  padding: 25px;
  border-radius: 16px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
}

.card-title {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 20px;
  padding-bottom: 15px;
  border-bottom: 1px solid #f0f0f0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: #303133;
}

.full-domain {
  color: #409eff;
  font-weight: 600;
}

:deep(.el-table) {
  border-radius: 10px;
  overflow: hidden;
}

:deep(.el-table th) {
  background: #f8f9fa !important;
  font-weight: 600;
}

:deep(.el-dialog) {
  border-radius: 16px;
}

:deep(.el-dialog__header) {
  border-bottom: 1px solid #f0f0f0;
  padding: 20px 25px;
}

:deep(.el-dialog__body) {
  padding: 25px;
}

:deep(.el-dialog__footer) {
  border-top: 1px solid #f0f0f0;
  padding: 15px 25px;
}

/* ========== 移动端适配 ========== */
@media (max-width: 768px) {
  .card {
    padding: 15px;
    border-radius: 12px;
  }

  .card-title {
    font-size: 16px;
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }

  .card-title > div {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    width: 100%;
  }

  .card-title > div .el-input {
    width: 100% !important;
    margin-right: 0 !important;
  }

  .card-title > div .el-button {
    flex: 1;
    min-width: 0;
  }

  /* 表格移动端优化 */
  :deep(.el-table) {
    font-size: 12px;
  }

  :deep(.el-table th),
  :deep(.el-table td) {
    padding: 8px 5px;
  }

  :deep(.el-table .cell) {
    padding: 0 5px;
    line-height: 1.4;
  }

  /* 隐藏部分列 */
  :deep(.el-table__column--selection) {
    display: none;
  }

  /* 操作按钮优化 */
  :deep(.el-button + .el-button) {
    margin-left: 5px;
  }

  :deep(.el-button--small) {
    padding: 5px 8px;
    font-size: 12px;
  }

  /* 分页器移动端优化 */
  :deep(.el-pagination) {
    justify-content: center;
    flex-wrap: wrap;
    gap: 5px;
  }

  :deep(.el-pagination .el-pagination__sizes) {
    margin: 0;
  }

  :deep(.el-pagination .el-pagination__jump) {
    margin-left: 0;
  }

  /* 对话框移动端全屏 */
  :deep(.el-dialog:not(.is-fullscreen)) {
    width: 95% !important;
    margin-top: 5vh !important;
  }

  :deep(.el-dialog__header) {
    padding: 15px;
  }

  :deep(.el-dialog__body) {
    padding: 15px;
    max-height: 70vh;
    overflow-y: auto;
  }

  :deep(.el-dialog__footer) {
    padding: 12px 15px;
  }

  /* 表单优化 */
  :deep(.el-form-item) {
    margin-bottom: 15px;
  }

  :deep(.el-form-item__label) {
    font-size: 13px;
  }

  /* DNS记录对话框优化 */
  :deep(.el-table__fixed-right) {
    right: 0 !important;
  }
}

/* 小屏手机适配 */
@media (max-width: 480px) {
  .card {
    padding: 12px;
  }

  .card-title {
    font-size: 15px;
  }

  :deep(.el-table) {
    font-size: 11px;
  }

  :deep(.el-button--small) {
    padding: 4px 6px;
    font-size: 11px;
  }

  :deep(.el-tag--small) {
    padding: 0 4px;
    font-size: 11px;
  }
}
</style>
