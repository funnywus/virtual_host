<template>
  <div class="card">
    <div class="card-title">
      <span>标签管理</span>
      <div>
        <el-button size="small" @click="loadData" :loading="loading"><el-icon><Refresh /></el-icon></el-button>
        <el-button type="primary" size="small" @click="openDialog()">添加标签</el-button>
      </div>
    </div>
    <el-table :data="dataStore.serverTags" stripe>
      <el-table-column prop="name" label="标签名称">
        <template #default="{ row }">
          <el-tag :style="row.color ? { backgroundColor: row.color, borderColor: row.color, color: '#fff' } : {}">{{ row.name }}</el-tag>
          <el-tag v-if="row.is_default === 1" type="warning" size="small" style="margin-left:5px">默认</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="color" label="颜色" width="120">
        <template #default="{ row }">
          <div v-if="row.color" style="display:flex;align-items:center;gap:8px">
            <span :style="{ display:'inline-block', width:'20px', height:'20px', borderRadius:'4px', backgroundColor: row.color }"></span>
            <span>{{ row.color }}</span>
          </div>
          <span v-else style="color:#999">默认</span>
        </template>
      </el-table-column>
      <el-table-column label="参与匹配" width="100">
        <template #default="{ row }">
          <el-tag :type="row.is_filterable === 0 ? 'info' : 'success'" size="small">
            {{ row.is_filterable === 0 ? '不参与' : '参与' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="created_at" label="创建时间" width="180" />
      <el-table-column label="操作" width="200" fixed="right">
        <template #default="{ row }">
          <el-button type="success" size="small" @click="setDefault(row)" :disabled="row.is_default === 1">默认</el-button>
          <el-button type="warning" size="small" @click="openDialog(row)">编辑</el-button>
          <el-button type="danger" size="small" @click="handleDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <AppDialog v-model="dialogVisible" :title="form.id ? '编辑标签' : '添加标签'" width="400px" :loading="saving" @confirm="handleSave">
      <el-form :model="form" label-width="80px">
        <el-form-item label="名称">
          <el-input v-model="form.name" placeholder="标签名称" />
        </el-form-item>
        <el-form-item label="颜色">
          <el-color-picker v-model="form.color" />
          <span style="margin-left:10px;color:#999">可选</span>
        </el-form-item>
        <el-form-item label="参与匹配">
          <el-switch v-model="form.is_filterable" :active-value="1" :inactive-value="0" />
          <span style="margin-left:10px;color:#999;font-size:12px">关闭后仅作标记，不参与域名与服务器的标签匹配</span>
        </el-form-item>
      </el-form>
    </AppDialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { useDataStore } from '@/stores/data'
import api from '@/api'

const dataStore = useDataStore()
const dialogVisible = ref(false)
const saving = ref(false)
const loading = ref(false)
const form = reactive({ id: null, name: '', color: '', is_filterable: 1 })

onMounted(() => loadData())

async function loadData() {
  loading.value = true
  try {
    await dataStore.loadServerTags()
  } finally {
    loading.value = false
  }
}

function openDialog(row = null) {
  if (row) {
    Object.assign(form, { id: row.id, name: row.name, color: row.color || '', is_filterable: row.is_filterable === 0 ? 0 : 1 })
  } else {
    Object.assign(form, { id: null, name: '', color: '', is_filterable: 1 })
  }
  dialogVisible.value = true
}

async function handleSave() {
  if (!form.name.trim()) {
    ElMessage.warning('请输入标签名称')
    return
  }
  saving.value = true
  try {
    if (form.id) {
      await api.put('/tags/' + form.id, form)
    } else {
      await api.post('/tags', form)
    }
    ElMessage.success('保存成功')
    dialogVisible.value = false
    dataStore.loadServerTags()
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function handleDelete(row) {
  await ElMessageBox.confirm('确定删除此标签？', '提示')
  await api.delete('/tags/' + row.id)
  ElMessage.success('删除成功')
  dataStore.loadServerTags()
}

async function setDefault(row) {
  await api.post(`/tags/${row.id}/set-default`)
  ElMessage.success('已设为默认')
  dataStore.loadServerTags()
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

  .card-title > div .el-button {
    flex: 1;
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
  }

  /* 操作按钮优化 */
  :deep(.el-button--small) {
    padding: 5px 8px;
    font-size: 12px;
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
    font-size: 11px;
  }

  :deep(.el-button--small) {
    padding: 4px 6px;
    font-size: 11px;
  }
}
</style>
