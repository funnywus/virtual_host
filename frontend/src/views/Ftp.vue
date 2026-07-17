<template>
  <div class="card">
    <div class="card-title">
      <span>FTP账号列表</span>
      <div>
        <el-input
          v-model="searchKeyword"
          placeholder="搜索域名/用户名/授权码"
          clearable
          style="width:200px;margin-right:10px"
          size="small"
          @clear="onSearch"
          @keyup.enter="onSearch"
        />
        <el-button size="small" @click="onSearch">搜索</el-button>
        <el-button size="small" @click="loadData" :loading="loading"><el-icon><Refresh /></el-icon></el-button>
        <el-button type="primary" size="small" @click="openDialog()">添加FTP账号</el-button>
      </div>
    </div>
    <el-table :data="dataStore.ftpAccounts" stripe v-loading="loading">
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
      <el-table-column label="已使用" width="120">
        <template #default="{ row }">
          <div style="display:flex;flex-direction:column;gap:4px">
            <el-tag v-if="row.used_size === null || row.usageLoading" type="info" size="small">
              统计中
            </el-tag>
            <el-tag v-else :type="getUsageType(row.used_size, row.max_upload_size)" size="small">
              {{ formatUploadSize(row.used_size) }}
            </el-tag>
            <el-progress 
              :percentage="getUsagePercentage(row.used_size, row.max_upload_size)" 
              :stroke-width="4"
              :show-text="false"
              :color="getUsageColor(row.used_size, row.max_upload_size)"
            />
          </div>
        </template>
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
                <el-dropdown-item @click="resetAuthCode(row)">重置授权码</el-dropdown-item>
                <el-dropdown-item @click="copyUploadLink(row)">复制上传链接</el-dropdown-item>
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
        :page-sizes="[10, 20, 50]"
        :total="dataStore.ftpAccountsTotal"
        layout="total, sizes, prev, pager, next, jumper"
        @size-change="onSizeChange"
        @current-change="onPageChange"
      />
    </div>
    
    <el-alert type="info" :closable="false" style="margin-top:15px">
      <p>客户上传入口: <a :href="uploadUrl" target="_blank" style="color:#409eff">{{ uploadUrl }}</a>（携带授权码：<code>{{ uploadUrl }}?code=授权码</code>）</p>
    </el-alert>

    <AppDialog v-model="dialogVisible" :title="form.id ? '编辑FTP账号' : '添加FTP账号'" width="500px" :loading="saving" @confirm="handleSave">
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
            <span style="color:#909399;font-size:12px">默认 500 MB</span>
          </div>
        </el-form-item>
      </el-form>
    </AppDialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue'
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
const pageSize = ref(10)
const form = reactive({ id: null, subdomain_id: '', username: '', password: '', home_dir: '', max_upload_size: 524288000, upload_size_value: 500, upload_size_unit: 'MB' })

// 计算实际字节数
function calcMaxUploadSize() {
  const value = form.upload_size_value || 500
  if (form.upload_size_unit === 'GB') {
    return value * 1024 * 1024 * 1024
  }
  return value * 1024 * 1024
}

// 从字节数解析为值和单位
function parseUploadSize(bytes) {
  if (!bytes) return { value: 500, unit: 'MB' }
  const gb = bytes / (1024 * 1024 * 1024)
  if (gb >= 1 && gb === Math.floor(gb)) {
    return { value: gb, unit: 'GB' }
  }
  return { value: Math.round(bytes / (1024 * 1024)), unit: 'MB' }
}
const uploadUrl = computed(() => window.location.origin + '/')

onMounted(() => loadData())

let searchTimer = null
watch(searchKeyword, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    currentPage.value = 1
    loadData()
  }, 350)
})

async function loadData() {
  loading.value = true
  try {
    await dataStore.loadFtpAccounts(currentPage.value, pageSize.value, searchKeyword.value.trim())
    loadUsageForCurrentPage()
  } finally {
    loading.value = false
  }
}

function onSearch() {
  currentPage.value = 1
  loadData()
}

async function loadUsageForCurrentPage() {
  const accounts = [...dataStore.ftpAccounts]
  const concurrency = 3
  let cursor = 0

  async function worker() {
    while (cursor < accounts.length) {
      const account = accounts[cursor]
      cursor += 1
      account.usageLoading = true
      try {
        const res = await api.get(`/ftp/${account.id}/usage`)
        account.used_size = res.used_size || 0
      } catch (err) {
        account.used_size = 0
      } finally {
        account.usageLoading = false
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, accounts.length) }, worker))
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
      max_upload_size: row.max_upload_size || 524288000,
      upload_size_value: parsed.value,
      upload_size_unit: parsed.unit
    })
  } else {
    availableSubdomains.value = await api.get('/ftp/available-subdomains')
    Object.assign(form, { id: null, subdomain_id: '', username: '', password: '', home_dir: '', max_upload_size: 524288000, upload_size_value: 500, upload_size_unit: 'MB' })
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
    loadData()
  } finally { saving.value = false }
}

async function handleDelete(id) {
  await ElMessageBox.confirm('确定删除此FTP账号？', '提示')
  await api.delete(`/ftp/${id}`)
  ElMessage.success('删除成功')
  loadData()
}

async function syncFtp(row) {
  row.syncing = true
  try {
    const res = await api.post(`/ftp/${row.id}/sync`)
    res.success ? ElMessage.success(res.message) : ElMessage.error(res.message)
    loadData()
  } finally { row.syncing = false }
}

async function resetPassword(id) {
  await ElMessageBox.confirm('确定重置密码？', '提示')
  const res = await api.post(`/ftp/${id}/reset-password`)
  ElMessage.success(`新密码: ${res.password}`)
  loadData()
}

async function resetAuthCode(row) {
  await ElMessageBox.confirm(
    '重置后旧授权码立即失效，客户需使用新授权码登录上传页。确定继续？',
    '重置授权码',
    { type: 'warning' }
  )
  const res = await api.post(`/ftp/${row.id}/reset-auth-code`)
  row.auth_code = res.auth_code
  ElMessageBox.alert(`新授权码：\n${res.auth_code}`, '授权码已重置', {
    confirmButtonText: '复制并关闭',
    callback: () => copyText(res.auth_code)
  })
  loadData()
}

function copyUploadLink(row) {
  if (!row.auth_code) {
    ElMessage.error('暂无授权码')
    return
  }
  const link = `${window.location.origin}/?code=${row.auth_code}`
  copyText(link)
  ElMessage.success('上传链接已复制')
}

// 计算使用百分比
function getUsagePercentage(used, max) {
  if (used === null || used === undefined) return 0
  if (!max || max === 0) return 0
  const percentage = (used / max) * 100
  return Math.min(Math.round(percentage), 100)
}

// 获取使用状态类型
function getUsageType(used, max) {
  const percentage = getUsagePercentage(used, max)
  if (percentage >= 90) return 'danger'
  if (percentage >= 70) return 'warning'
  return 'success'
}

// 获取进度条颜色
function getUsageColor(used, max) {
  const percentage = getUsagePercentage(used, max)
  if (percentage >= 90) return '#f56c6c'
  if (percentage >= 70) return '#e6a23c'
  return '#67c23a'
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
    line-height: 1.3;
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

  /* 分页器移动端优化 */
  :deep(.el-pagination) {
    justify-content: center;
    flex-wrap: wrap;
    gap: 5px;
  }

  :deep(.el-pagination .el-pagination__sizes),
  :deep(.el-pagination .el-pagination__jump) {
    display: none;
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

  /* Alert 优化 */
  :deep(.el-alert) {
    padding: 10px;
    font-size: 12px;
  }

  :deep(.el-alert a) {
    word-break: break-all;
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
