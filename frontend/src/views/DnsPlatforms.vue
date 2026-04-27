<template>
  <div class="card">
    <div class="card-title">
      <span>DNS平台配置</span>
      <div>
        <el-input 
          v-model="searchKeyword" 
          placeholder="搜索配置名称、备注..." 
          clearable 
          style="width:200px;margin-right:10px" 
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
    <el-table :data="filteredConfigs" stripe>
      <el-table-column prop="name" label="配置名称" width="140">
        <template #default="{ row }">
          {{ row.name }}
          <el-tag v-if="row.is_default === 1" type="warning" size="small" style="margin-left:5px">默认</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="platform" label="平台" width="100">
        <template #default="{ row }">
          <el-tag :type="platformTypes[row.platform]?.type || 'info'">{{ platformTypes[row.platform]?.name || row.platform }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="AccessKey" width="120">
        <template #default="{ row }">
          <span>{{ showKey[row.id] ? row.access_key : row.access_key.substring(0, 8) + '****' }}</span>
          <el-icon class="copy-btn" @click="showKey[row.id] = !showKey[row.id]" style="margin-left:5px">
            <View v-if="!showKey[row.id]" /><Hide v-else />
          </el-icon>
        </template>
      </el-table-column>
      <el-table-column label="SecretKey" width="120">
        <template #default="{ row }">
          <span>{{ showSecret[row.id] ? row.secret_key : '••••••••••••' }}</span>
          <el-icon class="copy-btn" @click="showSecret[row.id] = !showSecret[row.id]" style="margin-left:5px">
            <View v-if="!showSecret[row.id]" /><Hide v-else />
          </el-icon>
        </template>
      </el-table-column>
      <el-table-column prop="remark" label="备注" />
      <el-table-column label="标签" width="80">
        <template #default="{ row }">
          <el-tag v-for="tag in parseTags(row.tags)" :key="tag" :style="getTagStyle(tag)" size="small" style="margin-right:4px">{{ tag }}</el-tag>
          <span v-if="!row.tags" style="color:#999">-</span>
        </template>
      </el-table-column>
      <el-table-column prop="created_at" label="创建时间" width="120" />
      <el-table-column label="操作" width="160" fixed="right">
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

    <el-dialog v-model="dialogVisible" :title="form.id ? '编辑DNS平台' : '添加DNS平台'" width="500px">
      <el-form :model="form" label-width="140px">
        <el-form-item label="配置名称"><el-input v-model="form.name" placeholder="例如: 主账号" /></el-form-item>
        <el-form-item label="DNS平台">
          <el-select v-model="form.platform" style="width:100%">
            <el-option v-for="(info, key) in platformTypes" :key="key" :label="info.name" :value="key" />
          </el-select>
        </el-form-item>
        <el-form-item :label="platformTypes[form.platform]?.keyLabel || 'AccessKey'">
          <el-input v-model="form.access_key" />
        </el-form-item>
        <el-form-item :label="platformTypes[form.platform]?.secretLabel || 'SecretKey'">
          <el-input v-model="form.secret_key" type="password" :placeholder="form.id ? '留空则不修改' : ''" show-password />
        </el-form-item>
        <el-form-item label="备注"><el-input v-model="form.remark" type="textarea" /></el-form-item>
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
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh, Search, View, Hide } from '@element-plus/icons-vue'
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
const form = reactive({ id: null, name: '', platform: 'aliyun', access_key: '', secret_key: '', remark: '', tagList: [] })

const filteredConfigs = computed(() => {
  if (!searchKeyword.value) return dataStore.aliyunConfigs
  const kw = searchKeyword.value.toLowerCase()
  return dataStore.aliyunConfigs.filter(c => 
    c.name?.toLowerCase().includes(kw) ||
    c.remark?.toLowerCase().includes(kw) ||
    c.platform?.toLowerCase().includes(kw) ||
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
  if (row) Object.assign(form, { id: row.id, name: row.name, platform: row.platform || 'aliyun', access_key: row.access_key, secret_key: '', remark: row.remark || '', tagList: parseTags(row.tags) })
  else {
    const defaultTag = dataStore.serverTags.find(t => t.is_default === 1)
    Object.assign(form, { 
      id: null, name: '', platform: 'aliyun', access_key: '', secret_key: '', remark: '', 
      tagList: defaultTag ? [defaultTag.name] : [] 
    })
  }
  dialogVisible.value = true
}

async function handleSave() {
  saving.value = true
  try {
    const data = { ...form, tags: form.tagList.join(',') }
    if (form.id) await api.put(`/dns/aliyun-configs/${form.id}`, data)
    else await api.post('/dns/aliyun-configs', data)
    ElMessage.success('保存成功')
    dialogVisible.value = false
    dataStore.loadAliyunConfigs()
  } finally { saving.value = false }
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
  } finally { row.testing = false }
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

.copy-btn {
  cursor: pointer;
  color: #409eff;
  transition: color 0.3s;
}

.copy-btn:hover {
  color: #66b1ff;
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
    gap: 10px;
  }

  .card-title > div {
    display: flex;
    gap: 8px;
    width: 100%;
  }

  .card-title > div .el-input {
    flex: 1;
    width: auto !important;
    margin-right: 0 !important;
  }

  .card-title > div .el-button {
    flex-shrink: 0;
  }

  /* 表格移动端优化 */
  :deep(.el-table) {
    font-size: 11px;
  }

  :deep(.el-table th),
  :deep(.el-table td) {
    padding: 6px 3px;
  }

  :deep(.el-table .cell) {
    padding: 0 3px;
  }

  /* 操作按钮优化 */
  :deep(.el-button--small) {
    padding: 4px 6px;
    font-size: 11px;
  }

  :deep(.el-tag--small) {
    padding: 0 4px;
    font-size: 10px;
  }

  /* 对话框移动端优化 */
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
    font-size: 10px;
  }

  :deep(.el-button--small) {
    padding: 3px 5px;
    font-size: 10px;
  }
}
</style>
