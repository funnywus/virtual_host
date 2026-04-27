<template>
  <div class="card">
    <div class="card-title">
      <span>用户列表</span>
      <el-button size="small" @click="loadData" :loading="loading"><el-icon><Refresh /></el-icon></el-button>
    </div>
    <el-table :data="dataStore.users" stripe>
      <el-table-column prop="id" label="ID" width="80" />
      <el-table-column prop="username" label="用户名" />
      <el-table-column prop="email" label="邮箱" />
      <el-table-column prop="role" label="角色">
        <template #default="{ row }">
          <el-select v-model="row.role" @change="updateRole(row)">
            <el-option label="用户" value="user" />
            <el-option label="管理员" value="admin" />
          </el-select>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="100" fixed="right">
        <template #default="{ row }">
          <el-button type="danger" size="small" @click="handleDelete(row.id)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { useDataStore } from '@/stores/data'
import api from '@/api'

const dataStore = useDataStore()
const loading = ref(false)

onMounted(() => loadData())

async function loadData() {
  loading.value = true
  try {
    await dataStore.loadUsers()
  } finally {
    loading.value = false
  }
}

async function updateRole(row) {
  await api.put(`/users/${row.id}/role`, { role: row.role })
  ElMessage.success('更新成功')
}

async function handleDelete(id) {
  await ElMessageBox.confirm('确定删除此用户？', '提示')
  await api.delete(`/users/${id}`)
  ElMessage.success('删除成功')
  dataStore.loadUsers()
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

/* ========== 移动端适配 ========== */
@media (max-width: 768px) {
  .card {
    padding: 15px;
    border-radius: 12px;
  }

  .card-title {
    font-size: 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
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

  /* 下拉选择器优化 */
  :deep(.el-select) {
    width: 100%;
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
