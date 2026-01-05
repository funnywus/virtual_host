<template>
  <div class="card">
    <div class="card-title">
      <span>主域名列表</span>
      <div>
        <el-input v-model="searchKeyword" placeholder="搜索域名" clearable style="width:200px;margin-right:10px" size="small" />
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
      <el-table-column prop="created_at" label="添加时间">
        <template #default="{ row }">
          <span style="font-size:12px;color:#909399">{{ row.created_at }}</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="180" fixed="right">
        <template #default="{ row }">
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
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSave" :loading="saving">确定</el-button>
      </template>
    </el-dialog>

    <!-- SSL证书对话框 -->
    <SslDialog v-model="sslDialogVisible" :domain="currentDomain" @refresh="dataStore.loadDomains" />
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { useDataStore } from '@/stores/data'
import { formatSslDays, getSslDaysType } from '@/utils'
import api from '@/api'
import SslDialog from '@/components/SslDialog.vue'

const router = useRouter()
const dataStore = useDataStore()

const dialogVisible = ref(false)
const sslDialogVisible = ref(false)
const saving = ref(false)
const loading = ref(false)
const refreshingSsl = ref(false)
const currentDomain = ref(null)
const searchKeyword = ref('')
const form = reactive({ id: null, domain: '', aliyun_config_id: null, tagList: [] })

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
    Object.assign(form, { id: row.id, domain: row.domain, aliyun_config_id: row.aliyun_config_id, tagList: parseTags(row.tags) })
  } else {
    const defaultConfig = dataStore.aliyunConfigs.find(c => c.is_default === 1)
    const defaultTag = dataStore.serverTags.find(t => t.is_default === 1)
    Object.assign(form, { 
      id: null, 
      domain: '', 
      aliyun_config_id: defaultConfig?.id || null, 
      tagList: defaultTag ? [defaultTag.name] : [] 
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
    const data = { aliyun_config_id: form.aliyun_config_id, tags: form.tagList.join(',') }
    if (form.id) {
      await api.put(`/dns/domains/${form.id}`, data)
    } else {
      await api.post('/dns/domains', { ...form, tags: form.tagList.join(',') })
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
</style>
