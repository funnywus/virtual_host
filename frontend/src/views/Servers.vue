<template>
  <div class="card">
    <div class="card-title">
      <span>服务器列表</span>
      <div>
        <el-button size="small" @click="loadData" :loading="loading"><el-icon><Refresh /></el-icon></el-button>
        <el-button type="primary" size="small" @click="openDialog()">添加服务器</el-button>
      </div>
    </div>
    <el-table :data="dataStore.servers" stripe>
      <el-table-column prop="name" label="名称" width="120">
        <template #default="{ row }">
          {{ row.name }}
          <el-tag v-if="row.is_default === 1" type="warning" size="small" style="margin-left:5px">默认</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="ip" label="IP地址" width="130"/>
      <el-table-column prop="port" label="端口" width="80" />
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="getServerStatusType(row.status)" size="small">{{ getServerStatusText(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="标签" width="80">
        <template #default="{ row }">
          <el-tag v-for="tag in parseTags(row.tags)" :key="tag" :style="getTagStyle(tag)" size="small" style="margin-right:4px">{{ tag }}</el-tag>
          <span v-if="!row.tags" style="color:#999">-</span>
        </template>
      </el-table-column>
      <el-table-column prop="username" label="用户名" />
      <el-table-column label="密码" width="100">
        <template #default="{ row }">
          <span>{{ showPassword[row.id] ? row.password : '********' }}</span>
          <el-icon class="copy-btn" @click="showPassword[row.id] = !showPassword[row.id]" style="margin-left:5px">
            <View v-if="!showPassword[row.id]" /><Hide v-else />
          </el-icon>
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
      <el-table-column label="操作" width="160" fixed="right">
        <template #default="{ row }">
          <el-button type="success" size="small" @click="testServer(row)" :loading="row.testing">测试</el-button>
          <el-dropdown trigger="click" style="margin-left:8px">
            <el-button size="small">更多<el-icon class="el-icon--right"><ArrowDown /></el-icon></el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="openSoftwareDialog(row)">软件管理</el-dropdown-item>
                <el-dropdown-item @click="openFileManager(row)">文件管理</el-dropdown-item>
                <el-dropdown-item @click="openTerminal(row)">终端</el-dropdown-item>
                <el-dropdown-item @click="viewDomains(row)">查看域名</el-dropdown-item>
                <el-dropdown-item @click="setDefault(row)" :disabled="row.is_default === 1">设为默认</el-dropdown-item>
                <el-dropdown-item @click="openDialog(row)">编辑</el-dropdown-item>
                <el-dropdown-item divided @click="handleDelete(row.id)" style="color:#f56c6c">删除</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </template>
      </el-table-column>
    </el-table>

    <AppDialog v-model="dialogVisible" :title="form.id ? '编辑服务器' : '添加服务器'" width="550px" :loading="saving" @confirm="handleSave">
      <el-form :model="form" label-width="100px">
        <el-form-item label="名称">
          <el-input v-model="form.name" placeholder="服务器名称" />
        </el-form-item>
        <el-form-item label="IP地址">
          <el-input v-model="form.ip" placeholder="服务器IP" />
        </el-form-item>
        <el-form-item label="SSH端口">
          <el-input-number v-model="form.port" :min="1" :max="65535" />
        </el-form-item>
        <el-form-item label="用户名">
          <el-input v-model="form.username" placeholder="SSH用户名" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="form.password" type="password" :placeholder="form.id ? '留空则不修改' : 'SSH密码'" show-password />
        </el-form-item>
        <el-form-item label="Nginx目录">
          <el-input v-model="form.nginx_path" placeholder="/www/server/panel/vhost/nginx" />
        </el-form-item>
        <el-form-item label="FTP目录">
          <el-input v-model="form.ftp_path" placeholder="/www/wwwroot/ftp" />
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="form.status">
            <el-radio-button value="active">正常</el-radio-button>
            <el-radio-button value="disabled">停用</el-radio-button>
          </el-radio-group>
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
    </AppDialog>

    <!-- 文件管理 -->
    <FileManager v-model="fileManagerVisible" :server="currentServer" />
    
    <!-- 终端 -->
    <ServerTerminal v-model="terminalVisible" :server="currentServer" />

    <!-- 软件管理 -->
    <el-dialog v-model="softwareDialogVisible" :title="'软件管理 - ' + currentServer?.name" width="550px" append-to-body>
      <div v-loading="loadingSoftware">
        <div class="software-item">
          <div class="software-info">
            <span class="software-name">🌐 Nginx</span>
            <el-tag v-if="softwareStatus.nginx?.installed" type="success" size="small">已安装</el-tag>
            <el-tag v-else type="info" size="small">未安装</el-tag>
          </div>
          <div class="software-actions">
            <el-button v-if="softwareStatus.nginx?.installed" size="small" @click="viewNginxConfig">配置</el-button>
            <el-button v-if="!softwareStatus.nginx?.installed" type="primary" size="small" @click="installNginx" :loading="installingNginx">安装</el-button>
            <el-button v-else type="warning" size="small" @click="restartNginx" :loading="restartingNginx">重启</el-button>
          </div>
        </div>
        <div class="software-item">
          <div class="software-info">
            <span class="software-name">📤 FTP (vsftpd)</span>
            <el-tag v-if="softwareStatus.vsftpd?.installed" type="success" size="small">已安装</el-tag>
            <el-tag v-else type="info" size="small">未安装</el-tag>
          </div>
          <div class="software-actions">
            <el-button v-if="softwareStatus.vsftpd?.installed" size="small" @click="viewFtpConfig">配置</el-button>
            <el-button v-if="!softwareStatus.vsftpd?.installed" type="primary" size="small" @click="installFtp" :loading="installingFtp">安装</el-button>
            <el-button v-else type="warning" size="small" @click="restartFtp" :loading="restartingFtp">重启</el-button>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="softwareDialogVisible = false">关闭</el-button>
        <el-button type="primary" @click="loadSoftwareStatus">刷新状态</el-button>
      </template>
    </el-dialog>

    <!-- 配置文件编辑 -->
    <el-dialog v-model="configDialogVisible" :title="configTitle" width="900px" append-to-body>
      <div v-loading="loadingConfig" style="min-height:400px">
        <el-input 
          v-model="configContent" 
          type="textarea" 
          :rows="20" 
          style="font-family: monospace; font-size: 13px;"
        />
      </div>
      <template #footer>
        <el-button @click="configDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveConfig" :loading="savingConfig">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { View, Hide, ArrowDown, Refresh } from '@element-plus/icons-vue'
import { useDataStore } from '@/stores/data'
import api from '@/api'
import FileManager from '@/components/FileManager.vue'
import ServerTerminal from '@/components/ServerTerminal.vue'

const dataStore = useDataStore()
const dialogVisible = ref(false)
const fileManagerVisible = ref(false)
const terminalVisible = ref(false)
const softwareDialogVisible = ref(false)
const currentServer = ref(null)
const saving = ref(false)
const loading = ref(false)
const loadingSoftware = ref(false)
const installingNginx = ref(false)
const installingFtp = ref(false)
const restartingNginx = ref(false)
const restartingFtp = ref(false)
const showPassword = ref({})
const form = reactive({ id: null, name: '', ip: '', port: 22, username: '', password: '', nginx_path: '/www/server/panel/vhost/nginx', ftp_path: '/www/wwwroot/ftp', status: 'active', tagList: [], expire_at: null })
const softwareStatus = reactive({ nginx: {}, vsftpd: {}, pureFtpd: {} })
const configDialogVisible = ref(false)
const configTitle = ref('')
const configContent = ref('')
const configPath = ref('')
const loadingConfig = ref(false)
const savingConfig = ref(false)

onMounted(() => {
  loadData()
  dataStore.loadServerTags()
})

async function loadData() {
  loading.value = true
  try {
    await dataStore.loadServers()
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

function getServerStatusText(status) {
  return status === 'disabled' ? '停用' : '正常'
}

function getServerStatusType(status) {
  return status === 'disabled' ? 'danger' : 'success'
}

function openDialog(row = null) {
  if (row) {
    Object.assign(form, { 
      id: row.id, name: row.name, ip: row.ip, port: row.port, 
      username: row.username, password: '', 
      nginx_path: row.nginx_path || '/www/server/panel/vhost/nginx',
      ftp_path: row.ftp_path || '/www/wwwroot/ftp',
      status: row.status || 'active',
      tagList: parseTags(row.tags),
      expire_at: row.expire_at || null
    })
  } else {
    const defaultTag = dataStore.serverTags.find(t => t.is_default === 1)
    Object.assign(form, { 
      id: null, name: '', ip: '', port: 22, username: '', password: '', 
      nginx_path: '/www/server/panel/vhost/nginx',
      ftp_path: '/www/wwwroot/ftp',
      status: 'active',
      tagList: defaultTag ? [defaultTag.name] : [],
      expire_at: null
    })
  }
  dialogVisible.value = true
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

async function handleSave() {
  saving.value = true
  try {
    const data = { ...form, tags: form.tagList.join(',') }
    if (form.id) await api.put('/servers/' + form.id, data)
    else await api.post('/servers', data)
    ElMessage.success('保存成功')
    dialogVisible.value = false
    dataStore.loadServers()
  } finally { 
    saving.value = false 
  }
}

async function handleDelete(id) {
  await ElMessageBox.confirm('确定删除此服务器？', '提示')
  await api.delete('/servers/' + id)
  ElMessage.success('删除成功')
  dataStore.loadServers()
}

async function testServer(row) {
  row.testing = true
  try {
    const res = await api.post('/servers/' + row.id + '/test')
    res.success ? ElMessage.success(res.message) : ElMessage.error(res.message)
  } finally { 
    row.testing = false 
  }
}

async function viewDomains(row) {
  ElMessage.info('查看域名: ' + row.name)
}

function openFileManager(row) {
  currentServer.value = row
  fileManagerVisible.value = true
}

function openTerminal(row) {
  currentServer.value = row
  terminalVisible.value = true
}

async function setDefault(row) {
  await api.post(`/servers/${row.id}/set-default`)
  ElMessage.success('已设为默认')
  dataStore.loadServers()
}

// 软件管理
async function openSoftwareDialog(row) {
  currentServer.value = row
  softwareDialogVisible.value = true
  await loadSoftwareStatus()
}

async function loadSoftwareStatus() {
  if (!currentServer.value) return
  loadingSoftware.value = true
  try {
    const res = await api.get(`/servers/${currentServer.value.id}/software-status`)
    Object.assign(softwareStatus, res)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loadingSoftware.value = false
  }
}

async function installNginx() {
  installingNginx.value = true
  try {
    const res = await api.post(`/servers/${currentServer.value.id}/install-nginx`)
    ElMessage.success(res.message)
    await loadSoftwareStatus()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    installingNginx.value = false
  }
}

async function installFtp() {
  installingFtp.value = true
  try {
    const res = await api.post(`/servers/${currentServer.value.id}/install-ftp`)
    ElMessage.success(res.message)
    await loadSoftwareStatus()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    installingFtp.value = false
  }
}

async function restartNginx() {
  restartingNginx.value = true
  try {
    const res = await api.post(`/servers/${currentServer.value.id}/restart-nginx`)
    ElMessage.success(res.message)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    restartingNginx.value = false
  }
}

async function restartFtp() {
  restartingFtp.value = true
  try {
    const res = await api.post(`/servers/${currentServer.value.id}/restart-ftp`)
    ElMessage.success(res.message)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    restartingFtp.value = false
  }
}

// 查看配置文件
async function viewNginxConfig() {
  const path = softwareStatus.nginx?.configPath || '/etc/nginx/nginx.conf'
  configTitle.value = 'Nginx 配置 - ' + path
  configPath.value = path
  await loadConfig()
}

async function viewFtpConfig() {
  const path = softwareStatus.vsftpd?.configPath || '/etc/vsftpd.conf'
  configTitle.value = 'FTP 配置 - ' + path
  configPath.value = path
  await loadConfig()
}

async function loadConfig() {
  configDialogVisible.value = true
  loadingConfig.value = true
  try {
    const res = await api.post(`/servers/${currentServer.value.id}/files/read`, { path: configPath.value })
    configContent.value = res.content || ''
  } catch (e) {
    ElMessage.error('读取配置失败: ' + e.message)
    configContent.value = ''
  } finally {
    loadingConfig.value = false
  }
}

async function saveConfig() {
  savingConfig.value = true
  try {
    await api.post(`/servers/${currentServer.value.id}/files/write`, { 
      path: configPath.value, 
      content: configContent.value 
    })
    ElMessage.success('配置已保存')
    configDialogVisible.value = false
  } catch (e) {
    ElMessage.error('保存失败: ' + e.message)
  } finally {
    savingConfig.value = false
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

.software-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 15px;
  background: #f8f9fa;
  border-radius: 8px;
  margin-bottom: 12px;
}

.software-info {
  display: flex;
  align-items: center;
  gap: 10px;
}

.software-name {
  font-weight: 500;
  font-size: 15px;
}

.software-actions {
  display: flex;
  gap: 8px;
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
    max-height: 70vh;
    overflow-y: auto;
  }

  :deep(.el-dialog__footer) {
    padding: 12px 15px;
  }

  /* 软件管理项优化 */
  .software-item {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
    padding: 12px;
  }

  .software-info {
    width: 100%;
  }

  .software-actions {
    width: 100%;
    justify-content: flex-end;
  }

  .software-actions .el-button {
    flex: 1;
  }

  /* 表单优化 */
  :deep(.el-form-item) {
    margin-bottom: 15px;
  }

  :deep(.el-form-item__label) {
    font-size: 13px;
  }

  :deep(.el-input-number) {
    width: 100% !important;
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

  .software-name {
    font-size: 14px;
  }
}
</style>
