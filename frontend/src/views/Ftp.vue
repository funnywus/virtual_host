<template>
  <div class="card">
    <div class="card-title">
      <span>FTP账号列表</span>
      <div>
        <el-input v-model="searchKeyword" placeholder="搜索域名/用户名" clearable style="width:180px;margin-right:10px" size="small" />
        <el-button size="small" @click="loadData" :loading="loading"><el-icon><Refresh /></el-icon></el-button>
        <el-button type="primary" size="small" @click="openDialog()">添加FTP账号</el-button>
      </div>
    </div>
    <el-table :data="filteredFtpAccounts" stripe>
      <el-table-column prop="full_domain" label="关联域名" min-width="160">
        <template #default="{ row }"><span class="full-domain">{{ row.full_domain }}</span></template>
      </el-table-column>
      <el-table-column prop="server_name" label="服务器" width="140">
        <template #default="{ row }">{{ row.server_name || '-' }} {{ row.server_ip ? '(' + row.server_ip + ')' : '' }}</template>
      </el-table-column>
      <el-table-column prop="username" label="用户名" width="100">
        <template #default="{ row }">
          <span>{{ row.username }}</span>
          <el-icon class="copy-btn" @click="copyText(row.username)"><DocumentCopy /></el-icon>
        </template>
      </el-table-column>
      <el-table-column prop="auth_code" label="授权码" width="160">
        <template #default="{ row }">
          <el-tooltip :content="row.auth_code" placement="top">
            <span class="auth-code">{{ row.auth_code.substring(0, 8) }}...</span>
          </el-tooltip>
          <el-icon class="copy-btn" @click="copyText(row.auth_code)"><DocumentCopy /></el-icon>
        </template>
      </el-table-column>
      <el-table-column prop="password" label="密码">
        <template #default="{ row }">
          <span>{{ showPassword[row.id] ? row.password : '••••••••' }}</span>
          <el-icon class="copy-btn" @click="showPassword[row.id] = !showPassword[row.id]" style="margin-left:5px">
            <View v-if="!showPassword[row.id]" /><Hide v-else />
          </el-icon>
          <el-icon class="copy-btn" @click="copyText(row.password)"><DocumentCopy /></el-icon>
        </template>
      </el-table-column>
      <el-table-column prop="home_dir" label="目录" width="150">
        <template #default="{ row }">
          <el-tooltip :content="row.home_dir" placement="top">
            <span class="ellipsis-text">{{ row.home_dir }}</span>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column prop="max_upload_size" label="空间限制" width="100">
        <template #default="{ row }"><el-tag type="warning" size="small">{{ formatUploadSize(row.max_upload_size) }}</el-tag></template>
      </el-table-column>
      <el-table-column prop="sync_status" label="同步状态" width="100">
        <template #default="{ row }">
          <el-tooltip :content="row.sync_message || ''" placement="top" :disabled="!row.sync_message">
            <el-tag :type="row.sync_status === 'synced' ? 'success' : row.sync_status === 'error' ? 'danger' : 'warning'">
              {{ row.sync_status === 'synced' ? '已同步' : row.sync_status === 'error' ? '失败' : '待同步' }}
            </el-tag>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="160" fixed="right">
        <template #default="{ row }">
          <el-button type="success" size="small" @click="syncFtp(row)" :loading="row.syncing" :disabled="!row.server_ip">同步</el-button>
          <el-dropdown trigger="click" style="margin-left:8px">
            <el-button size="small">更多<el-icon class="el-icon--right"><ArrowDown /></el-icon></el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="openDialog(row)">编辑</el-dropdown-item>
                <el-dropdown-item @click="resetPassword(row.id)">重置密码</el-dropdown-item>
                <el-dropdown-item divided @click="handleDelete(row.id)" style="color:#f56c6c">删除</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </template>
      </el-table-column>
    </el-table>
    
    <!-- 分页 -->
    <div style="margin-top:15px;display:flex;justify-content:flex-end">
      <el-pagination
        :current-page="currentPage"
        :page-size="pageSize"
        :page-sizes="[20, 50, 100]"
        :total="dataStore.ftpAccountsTotal"
        layout="total, sizes, prev, pager, next, jumper"
        @size-change="onSizeChange"
        @current-change="onPageChange"
      />
    </div>
    
    <el-alert type="info" :closable="false" style="margin-top:15px">
      <p>客户上传地址: <a :href="uploadUrl" target="_blank" style="color:#409eff">{{ uploadUrl }}</a></p>
    </el-alert>

    <el-dialog v-model="dialogVisible" :title="form.id ? '编辑FTP账号' : '添加FTP账号'" width="500px">
      <el-form :model="form" label-width="100px">
        <el-form-item label="关联域名" v-if="!form.id">
          <el-select v-model="form.subdomain_id" placeholder="选择域名" style="width:100%">
            <el-option v-for="s in availableSubdomains" :key="s.id" :label="s.full_domain" :value="s.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="用户名"><el-input v-model="form.username" placeholder="FTP用户名" /></el-form-item>
        <el-form-item label="密码" v-if="!form.id"><el-input v-model="form.password" placeholder="留空自动生成" /></el-form-item>
        <el-form-item label="主目录"><el-input v-model="form.home_dir" placeholder="/www/wwwroot/ftp/用户名" /></el-form-item>
        <el-form-item label="空间限制">
          <div style="display:flex;gap:10px;align-items:center">
            <el-input-number v-model="form.upload_size_value" :min="1" :max="1024" style="width:120px" />
            <el-select v-model="form.upload_size_unit" style="width:80px">
              <el-option label="MB" value="MB" />
              <el-option label="GB" value="GB" />
            </el-select>
            <span style="color:#909399;font-size:12px">默认 200 MB</span>
          </div>
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
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { useDataStore } from '@/stores/data'
import { copyText, formatUploadSize } from '@/utils'
import api from '@/api'

const dataStore = useDataStore()
const dialogVisible = ref(false)
const saving = ref(false)
const loading = ref(false)
const showPassword = ref({})
const availableSubdomains = ref([])
const searchKeyword = ref('')
const currentPage = ref(1)
const pageSize = ref(20)
const form = reactive({ id: null, subdomain_id: '', username: '', password: '', home_dir: '', max_upload_size: 209715200, upload_size_value: 200, upload_size_unit: 'MB' })

// 计算实际字节数
function calcMaxUploadSize() {
  const value = form.upload_size_value || 200
  if (form.upload_size_unit === 'GB') {
    return value * 1024 * 1024 * 1024
  }
  return value * 1024 * 1024
}

// 从字节数解析为值和单位
function parseUploadSize(bytes) {
  if (!bytes) return { value: 200, unit: 'MB' }
  const gb = bytes / (1024 * 1024 * 1024)
  if (gb >= 1 && gb === Math.floor(gb)) {
    return { value: gb, unit: 'GB' }
  }
  return { value: Math.round(bytes / (1024 * 1024)), unit: 'MB' }
}
const uploadUrl = computed(() => window.location.origin + '/upload')

const filteredFtpAccounts = computed(() => {
  if (!searchKeyword.value) return dataStore.ftpAccounts
  const kw = searchKeyword.value.toLowerCase()
  return dataStore.ftpAccounts.filter(f => 
    f.full_domain?.toLowerCase().includes(kw) ||
    f.username?.toLowerCase().includes(kw) ||
    f.server_name?.toLowerCase().includes(kw)
  )
})

onMounted(() => loadData())

async function loadData() {
  loading.value = true
  try {
    await dataStore.loadFtpAccounts(currentPage.value, pageSize.value)
  } finally {
    loading.value = false
  }
}

function onPageChange(page) {
  currentPage.value = page
  loadData()
}

function onSizeChange(size) {
  pageSize.value = size
  currentPage.value = 1
  loadData()
}

async function openDialog(row = null) {
  if (row) {
    const parsed = parseUploadSize(row.max_upload_size)
    Object.assign(form, { 
      id: row.id, 
      subdomain_id: row.subdomain_id, 
      username: row.username, 
      home_dir: row.home_dir, 
      max_upload_size: row.max_upload_size || 209715200,
      upload_size_value: parsed.value,
      upload_size_unit: parsed.unit
    })
  } else {
    availableSubdomains.value = await api.get('/ftp/available-subdomains')
    Object.assign(form, { id: null, subdomain_id: '', username: '', password: '', home_dir: '', max_upload_size: 209715200, upload_size_value: 200, upload_size_unit: 'MB' })
  }
  dialogVisible.value = true
}

async function handleSave() {
  saving.value = true
  try {
    const data = { ...form, max_upload_size: calcMaxUploadSize() }
    if (form.id) await api.put(`/ftp/${form.id}`, data)
    else await api.post('/ftp', data)
    ElMessage.success('保存成功')
    dialogVisible.value = false
    dataStore.loadFtpAccounts()
  } finally { saving.value = false }
}

async function handleDelete(id) {
  await ElMessageBox.confirm('确定删除此FTP账号？', '提示')
  await api.delete(`/ftp/${id}`)
  ElMessage.success('删除成功')
  dataStore.loadFtpAccounts()
}

async function syncFtp(row) {
  row.syncing = true
  try {
    const res = await api.post(`/ftp/${row.id}/sync`)
    res.success ? ElMessage.success(res.message) : ElMessage.error(res.message)
    dataStore.loadFtpAccounts()
  } finally { row.syncing = false }
}

async function resetPassword(id) {
  await ElMessageBox.confirm('确定重置密码？', '提示')
  const res = await api.post(`/ftp/${id}/reset-password`)
  ElMessage.success(`新密码: ${res.password}`)
  dataStore.loadFtpAccounts()
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

.copy-btn {
  cursor: pointer;
  color: #409eff;
  margin-left: 5px;
  transition: color 0.3s;
}

.copy-btn:hover {
  color: #66b1ff;
}

.auth-code {
  font-family: monospace;
  font-size: 12px;
  color: #e6a23c;
  cursor: pointer;
}

.ellipsis-text {
  font-size: 12px;
  color: #666;
  display: block;
  max-width: 130px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
