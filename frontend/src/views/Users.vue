<template>
  <div class="card">
    <div class="card-title">
      <span>用户列表</span>
      <div class="title-actions">
        <el-button type="primary" size="small" @click="openCreateDialog">
          新增用户
        </el-button>
        <el-button size="small" @click="loadData" :loading="loading"><el-icon><Refresh /></el-icon></el-button>
      </div>
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

    <AppDialog v-model="createDialogVisible" title="新增用户" width="420px" :loading="creating" confirm-text="创建" @confirm="handleCreate">
      <el-form :model="createForm" label-width="80px">
        <el-form-item label="用户名">
          <el-input v-model.trim="createForm.username" placeholder="请输入用户名" />
        </el-form-item>
        <el-form-item label="邮箱">
          <el-input v-model.trim="createForm.email" placeholder="请输入邮箱" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="createForm.password" type="password" placeholder="请输入密码" show-password />
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="createForm.role" style="width:100%">
            <el-option label="用户" value="user" />
            <el-option label="管理员" value="admin" />
          </el-select>
        </el-form-item>
      </el-form>
    </AppDialog>
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
const creating = ref(false)
const createDialogVisible = ref(false)
const createForm = ref({
  username: '',
  email: '',
  password: '',
  role: 'user'
})

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
  try {
    await api.put(`/users/${row.id}/role`, { role: row.role })
    ElMessage.success('更新成功')
  } catch (err) {
    ElMessage.error(err.message || '更新失败')
    loadData()
  }
}

async function handleDelete(id) {
  try {
    await ElMessageBox.confirm('确定删除此用户？', '提示')
    await api.delete(`/users/${id}`)
    ElMessage.success('删除成功')
    dataStore.loadUsers()
  } catch (err) {
    if (err !== 'cancel') {
      ElMessage.error(err.message || '删除失败')
    }
  }
}

function openCreateDialog() {
  createForm.value = {
    username: '',
    email: '',
    password: '',
    role: 'user'
  }
  createDialogVisible.value = true
}

async function handleCreate() {
  if (!createForm.value.username || !createForm.value.email || !createForm.value.password) {
    ElMessage.warning('请填写用户名、邮箱和密码')
    return
  }

  creating.value = true
  try {
    await api.post('/users', createForm.value)
    ElMessage.success('创建成功')
    createDialogVisible.value = false
    loadData()
  } catch (err) {
    ElMessage.error(err.message || '创建失败')
  } finally {
    creating.value = false
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
  color: #303133;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.title-actions {
  display: flex;
  gap: 8px;
  align-items: center;
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
  }

  .title-actions {
    width: 100%;
    justify-content: flex-start;
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
