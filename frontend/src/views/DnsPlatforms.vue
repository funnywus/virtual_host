<template>
  <div class="card">
    <div class="card-title">
      <span>DNS平台配置</span>
      <div class="title-actions">
        <el-input 
          v-model="searchKeyword" 
          placeholder="搜索配置名称、备注..." 
          clearable 
          style="width:220px" 
          size="small"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>
        <el-button size="small" @click="loadData" :loading="loading"><el-icon><Refresh /></el-icon></el-button>
        <el-button type="primary" size="small" @click="openDialog()">添加平台</el-button>
      </div>
    </div>

    <el-table :data="filteredConfigs" stripe class="dns-table">
      <el-table-column label="配置信息" min-width="180">
        <template #default="{ row }">
          <div class="config-name">{{ row.name }}</div>
          <div class="config-meta">
            <el-tag :type="platformTypes[row.platform]?.type || 'info'" size="small">
              {{ platformTypes[row.platform]?.name || row.platform }}
            </el-tag>
            <el-tag v-if="row.is_default === 1" type="warning" size="small">默认</el-tag>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="AccessKey" min-width="220">
        <template #default="{ row }">
          <div class="secret-cell">
            <code class="secret-text">{{ maskValue(row.access_key, showKey[row.id]) }}</code>
            <div class="secret-actions">
              <el-icon class="action-icon" @click="toggleShow(showKey, row.id)">
                <View v-if="!showKey[row.id]" /><Hide v-else />
              </el-icon>
              <el-icon class="action-icon" @click="copyValue(row.access_key, 'AccessKey')">
                <DocumentCopy />
              </el-icon>
            </div>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="SecretKey" min-width="220">
        <template #default="{ row }">
          <div class="secret-cell">
            <code class="secret-text">{{ maskValue(row.secret_key, showSecret[row.id]) }}</code>
            <div class="secret-actions">
              <el-icon class="action-icon" @click="toggleShow(showSecret, row.id)">
                <View v-if="!showSecret[row.id]" /><Hide v-else />
              </el-icon>
              <el-icon class="action-icon" @click="copyValue(row.secret_key, 'SecretKey')">
                <DocumentCopy />
              </el-icon>
            </div>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="标签" min-width="120">
        <template #default="{ row }">
          <div class="tag-list">
            <el-tag v-for="tag in parseTags(row.tags)" :key="tag" :style="getTagStyle(tag)" size="small">{{ tag }}</el-tag>
            <span v-if="!parseTags(row.tags).length" class="empty-text">-</span>
          </div>
        </template>
      </el-table-column>

      <el-table-column prop="remark" label="备注" min-width="120" show-overflow-tooltip />

      <el-table-column prop="created_at" label="创建时间" width="160">
        <template #default="{ row }">
          <span class="time-text">{{ formatDateTime(row.created_at) }}</span>
        </template>
      </el-table-column>

      <el-table-column label="操作" width="170" fixed="right">
        <template #default="{ row }">
          <el-button type="success" size="small" @click="testConfig(row)" :loading="row.testing">测试</el-button>
          <el-dropdown trigger="click" style="margin-left:8px">
            <el-button size="small">更多<el-icon class="el-icon--right"><ArrowDown /></el-icon></el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="setDefault(row)" :disabled="row.is_default === 1">设为默认</el-dropdown-item>
                <el-dropdown-item @click="openDialog(row)">编辑</el-dropdown-item>
                <el-dropdown-item divided @click="handleDelete(row.id)" style="color:#f56c6c">删除</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </template>
      </el-table-column>
    </el-table>

    <AppDialog v-model="dialogVisible" :title="form.id ? '编辑DNS平台' : '添加DNS平台'" width="560px" :loading="saving" @confirm="handleSave">
      <el-form :model="form" label-width="120px">
        <el-form-item label="配置名称">
          <el-input v-model="form.name" placeholder="例如: 主账号" />
        </el-form-item>
        <el-form-item label="DNS平台">
          <el-select v-model="form.platform" style="width:100%">
            <el-option v-for="(info, key) in platformTypes" :key="key" :label="info.name" :value="key" />
          </el-select>
        </el-form-item>
        <el-form-item :label="platformTypes[form.platform]?.keyLabel || 'AccessKey'">
          <el-input v-model="form.access_key" placeholder="请输入 AccessKey" />
        </el-form-item>
        <el-form-item :label="platformTypes[form.platform]?.secretLabel || 'SecretKey'">
          <el-input
            v-model="form.secret_key"
            :type="showFormSecret ? 'text' : 'password'"
            :placeholder="form.id ? '留空则不修改' : '请输入 SecretKey'"
            show-password
          />
          <div v-if="form.id && editingOriginalSecret" class="form-tip">
            当前已保存密钥，留空表示不修改
          </div>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="2" placeholder="可选备注" />
        </el-form-item>
        <el-form-item label="标签">
          <el-select v-model="form.tagList" multiple filterable allow-create default-first-option placeholder="选择或输入标签" style="width:100%" @change="onTagChange">
            <el-option v-for="t in dataStore.serverTags" :key="t.id" :label="t.name" :value="t.name" />
          </el-select>
        </el-form-item>
      </el-form>
    </AppDialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh, Search, View, Hide, ArrowDown, DocumentCopy } from '@element-plus/icons-vue'
import { useDataStore } from '@/stores/data'
import { platformTypes } from '@/utils'
import api from '@/api'

const dataStore = useDataStore()
const dialogVisible = ref(false)
const saving = ref(false)
const loading = ref(false)
const searchKeyword = ref('')
const showKey = ref({})
const showSecret = ref({})
const editingOriginalSecret = ref('')
const form = reactive({ id: null, name: '', platform: 'aliyun', access_key: '', secret_key: '', remark: '', tagList: [] })

const filteredConfigs = computed(() => {
  if (!searchKeyword.value) return dataStore.aliyunConfigs
  const kw = searchKeyword.value.toLowerCase()
  return dataStore.aliyunConfigs.filter(c => 
    c.name?.toLowerCase().includes(kw) ||
    c.remark?.toLowerCase().includes(kw) ||
    c.platform?.toLowerCase().includes(kw) ||
    c.access_key?.toLowerCase().includes(kw) ||
    c.tags?.toLowerCase().includes(kw)
  )
})

onMounted(() => {
  loadData()
  dataStore.loadServerTags()
})

async function loadData() {
  loading.value = true
  try {
    await dataStore.loadAliyunConfigs()
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

function maskValue(value, visible) {
  if (!value) return '-'
  if (visible) return value
  if (value.length <= 8) return '••••••••'
  return `${value.slice(0, 4)}****${value.slice(-4)}`
}

function toggleShow(target, id) {
  target.value = { ...target.value, [id]: !target.value[id] }
}

async function copyValue(value, label) {
  if (!value) {
    ElMessage.warning(`${label} 为空`)
    return
  }
  try {
    await navigator.clipboard.writeText(value)
    ElMessage.success(`${label} 已复制`)
  } catch {
    ElMessage.error('复制失败')
  }
}

function formatDateTime(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
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

function openDialog(row = null) {
  if (row) {
    editingOriginalSecret.value = row.secret_key || ''
    Object.assign(form, {
      id: row.id,
      name: row.name,
      platform: row.platform || 'aliyun',
      access_key: row.access_key || '',
      secret_key: row.secret_key || '',
      remark: row.remark || '',
      tagList: parseTags(row.tags)
    })
  } else {
    editingOriginalSecret.value = ''
    const defaultTag = dataStore.serverTags.find(t => t.is_default === 1)
    Object.assign(form, { 
      id: null, name: '', platform: 'aliyun', access_key: '', secret_key: '', remark: '', 
      tagList: defaultTag ? [defaultTag.name] : [] 
    })
  }
  dialogVisible.value = true
}

async function handleSave() {
  if (!form.name.trim()) {
    ElMessage.warning('请输入配置名称')
    return
  }
  if (!form.access_key.trim()) {
    ElMessage.warning('请输入 AccessKey')
    return
  }
  if (!form.id && !form.secret_key.trim()) {
    ElMessage.warning('请输入 SecretKey')
    return
  }

  saving.value = true
  try {
    const data = {
      name: form.name.trim(),
      platform: form.platform,
      access_key: form.access_key.trim(),
      remark: form.remark || '',
      tags: form.tagList.join(',')
    }

    if (form.id) {
      if (form.secret_key.trim()) {
        data.secret_key = form.secret_key.trim()
      }
      await api.put(`/dns/aliyun-configs/${form.id}`, data)
    } else {
      data.secret_key = form.secret_key.trim()
      await api.post('/dns/aliyun-configs', data)
    }

    ElMessage.success('保存成功')
    dialogVisible.value = false
    dataStore.loadAliyunConfigs()
  } finally {
    saving.value = false
  }
}

async function handleDelete(id) {
  await ElMessageBox.confirm('确定删除此配置？', '提示')
  await api.delete(`/dns/aliyun-configs/${id}`)
  ElMessage.success('删除成功')
  dataStore.loadAliyunConfigs()
}

async function setDefault(row) {
  await api.post(`/dns/aliyun-configs/${row.id}/set-default`)
  ElMessage.success('已设为默认')
  dataStore.loadAliyunConfigs()
}

async function testConfig(row) {
  row.testing = true
  try {
    const res = await api.post(`/dns/aliyun-configs/${row.id}/test`)
    res.success ? ElMessage.success(res.message) : ElMessage.error(res.message)
  } finally {
    row.testing = false
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

.title-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.config-name {
  font-weight: 600;
  color: #303133;
  margin-bottom: 6px;
}

.config-meta {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.secret-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.secret-text {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: #606266;
  background: #f5f7fa;
  padding: 4px 8px;
  border-radius: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.secret-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.action-icon {
  cursor: pointer;
  color: #909399;
  font-size: 16px;
  transition: color 0.2s;
}

.action-icon:hover {
  color: #409eff;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.empty-text,
.time-text {
  color: #909399;
  font-size: 12px;
}

.form-tip {
  margin-top: 6px;
  font-size: 12px;
  color: #909399;
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
    padding: 15px;
    border-radius: 12px;
  }

  .card-title {
    font-size: 16px;
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }

  .title-actions {
    width: 100%;
    flex-wrap: wrap;
  }

  .title-actions .el-input {
    flex: 1;
    min-width: 160px;
  }
}
</style>
