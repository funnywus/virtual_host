<template>
  <div class="card">
    <div class="page-header">
      <div class="header-top">
        <span class="page-title">
          服务器列表
          <el-tag size="small" type="info">{{ filteredServers.length }}</el-tag>
        </span>
        <div class="header-actions">
          <el-button size="small" @click="loadData" :loading="loading">
            <el-icon><Refresh /></el-icon>
          </el-button>
          <el-button type="primary" size="small" @click="openDialog()">添加服务器</el-button>
        </div>
      </div>
      <div class="filter-bar">
        <el-input
          v-model="searchKeyword"
          placeholder="搜索名称、IP、用户名..."
          clearable
          class="filter-search"
          size="small"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>
        <el-select v-model="filterTag" placeholder="标签" clearable class="filter-select" size="small">
          <el-option v-for="t in dataStore.serverTags" :key="t.id" :label="t.name" :value="t.name" />
        </el-select>
        <el-select v-model="filterStatus" placeholder="状态" clearable class="filter-select filter-select-narrow" size="small">
          <el-option label="正常" value="active" />
          <el-option label="停用" value="disabled" />
        </el-select>
        <div class="filter-checks">
          <el-checkbox v-model="filterExpiringSoon" size="small" border>7天内到期</el-checkbox>
        </div>
        <span class="record-count">共 {{ filteredServers.length }} 台</span>
      </div>
    </div>

    <el-empty
      v-if="!loading && filteredServers.length === 0"
      :description="hasFilters ? '没有匹配的服务器' : '还没有服务器，点击右上角添加'"
    />

    <el-table
      v-else
      :data="filteredServers"
      stripe
      size="small"
      v-loading="loading"
      class="server-table"
    >
      <el-table-column label="服务器" min-width="280">
        <template #default="{ row }">
          <div class="server-cell">
            <span class="server-name" :title="row.name">{{ row.name }}</span>
            <el-tag v-if="row.is_default === 1" type="warning" size="small">默认</el-tag>
            <el-tag
              v-for="tag in parseTags(row.tags)"
              :key="tag"
              :style="getTagStyle(tag)"
              size="small"
            >{{ tag }}</el-tag>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="连接" min-width="220">
        <template #default="{ row }">
          <div class="conn-cell">
            <span class="conn-addr" :title="'点击复制 ' + row.ip + ':' + row.port" @click="copyText(`${row.ip}:${row.port}`)">
              {{ row.ip }}:{{ row.port }}
            </span>
            <el-icon class="copy-btn" @click="copyText(`${row.ip}:${row.port}`)">
              <DocumentCopy />
            </el-icon>
            <span class="conn-secondary">{{ row.username || '-' }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="getServerStatusType(row.status)" size="small">
            {{ getServerStatusText(row.status) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="到期" width="160">
        <template #default="{ row }">
          <div v-if="row.expire_at" class="expire-cell">
            <span class="expire-date" :class="getExpireClass(row.expire_at)">
              {{ formatDateTime(row.expire_at) }}
            </span>
            <span class="expire-days" :class="getExpireClass(row.expire_at)">
              {{ getExpireDaysText(row.expire_at) }}
            </span>
          </div>
          <span v-else class="muted">永久</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="210" fixed="right">
        <template #default="{ row }">
          <div class="row-actions">
            <el-button type="success" size="small" @click="testServer(row)" :loading="row.testing">测试</el-button>
            <el-button
              :type="row.status === 'disabled' ? 'success' : 'warning'"
              size="small"
              @click="toggleServerStatus(row)"
              :loading="row.statusChanging"
            >
              {{ row.status === 'disabled' ? '启用' : '停用' }}
            </el-button>
            <el-dropdown trigger="click">
              <el-button size="small">
                更多<el-icon class="el-icon--right"><ArrowDown /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item @click="openSoftwareDialog(row)">软件管理</el-dropdown-item>
                  <el-dropdown-item @click="openFileManager(row)">文件管理</el-dropdown-item>
                  <el-dropdown-item @click="openTerminal(row)">终端</el-dropdown-item>
                  <el-dropdown-item @click="viewDomains(row)">查看域名</el-dropdown-item>
                  <el-dropdown-item @click="copyText(row.password)" :disabled="!row.password">复制密码</el-dropdown-item>
                  <el-dropdown-item @click="setDefault(row)" :disabled="row.is_default === 1">设为默认</el-dropdown-item>
                  <el-dropdown-item @click="openDialog(row)">编辑</el-dropdown-item>
                  <el-dropdown-item divided @click="handleDelete(row.id)" style="color:#f56c6c">删除</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" :title="form.id ? '编辑服务器' : '添加服务器'" width="760px">
      <el-form :model="form" label-width="92px" class="server-form">
        <div class="form-grid">
          <section class="form-section">
            <h4>连接信息</h4>
            <el-form-item label="名称">
              <el-input v-model="form.name" placeholder="服务器名称" />
            </el-form-item>
            <el-form-item label="地址">
              <div class="addr-row">
                <el-input v-model="form.ip" placeholder="服务器 IP" />
                <el-input-number v-model="form.port" :min="1" :max="65535" controls-position="right" />
              </div>
            </el-form-item>
            <el-form-item label="用户名">
              <el-input v-model="form.username" placeholder="SSH 用户名" />
            </el-form-item>
            <el-form-item label="密码">
              <el-input
                v-model="form.password"
                type="password"
                :placeholder="form.id ? '留空则不修改' : 'SSH 密码'"
                show-password
              />
            </el-form-item>
          </section>
          <section class="form-section">
            <h4>路径与到期</h4>
            <el-form-item label="Nginx 目录">
              <el-input v-model="form.nginx_path" placeholder="/www/server/panel/vhost/nginx" />
            </el-form-item>
            <el-form-item label="FTP 目录">
              <el-input v-model="form.ftp_path" placeholder="/www/wwwroot/ftp" />
            </el-form-item>
            <el-form-item label="标签">
              <el-select
                v-model="form.tagList"
                multiple
                filterable
                allow-create
                default-first-option
                placeholder="选择或输入标签"
                style="width:100%"
                @change="onTagChange"
              >
                <el-option v-for="t in dataStore.serverTags" :key="t.id" :label="t.name" :value="t.name" />
              </el-select>
            </el-form-item>
            <el-form-item label="到期时间">
              <el-date-picker
                v-model="form.expire_at"
                type="datetime"
                placeholder="留空表示永久"
                format="YYYY-MM-DD HH:mm:ss"
                value-format="YYYY-MM-DD HH:mm:ss"
                style="width:100%"
                clearable
              />
            </el-form-item>
          </section>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSave" :loading="saving">确定</el-button>
      </template>
    </el-dialog>

    <FileManager v-model="fileManagerVisible" :server="currentServer" />
    <ServerTerminal v-model="terminalVisible" :server="currentServer" />

    <el-dialog v-model="softwareDialogVisible" :title="'软件管理 - ' + currentServer?.name" width="550px" append-to-body>
      <div v-loading="loadingSoftware">
        <div class="software-item">
          <div class="software-info">
            <span class="software-name">Nginx</span>
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
            <span class="software-name">FTP (vsftpd)</span>
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

    <el-dialog v-model="configDialogVisible" :title="configTitle" width="900px" append-to-body>
      <div v-loading="loadingConfig" style="min-height:400px">
        <el-input
          v-model="configContent"
          type="textarea"
          :rows="20"
          class="config-editor"
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
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowDown, Refresh, Search, DocumentCopy } from '@element-plus/icons-vue'
import { useDataStore } from '@/stores/data'
import { copyText } from '@/utils'
import api from '@/api'
import FileManager from '@/components/FileManager.vue'
import ServerTerminal from '@/components/ServerTerminal.vue'

const router = useRouter()
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
const searchKeyword = ref('')
const filterTag = ref('')
const filterStatus = ref('')
const filterExpiringSoon = ref(false)
const form = reactive({
  id: null,
  name: '',
  ip: '',
  port: 22,
  username: '',
  password: '',
  nginx_path: '/www/server/panel/vhost/nginx',
  ftp_path: '/www/wwwroot/ftp',
  tagList: [],
  expire_at: null
})
const softwareStatus = reactive({ nginx: {}, vsftpd: {}, pureFtpd: {} })
const configDialogVisible = ref(false)
const configTitle = ref('')
const configContent = ref('')
const configPath = ref('')
const loadingConfig = ref(false)
const savingConfig = ref(false)

const hasFilters = computed(() => {
  return !!(searchKeyword.value.trim() || filterTag.value || filterStatus.value || filterExpiringSoon.value)
})

const filteredServers = computed(() => {
  const kw = searchKeyword.value.trim().toLowerCase()
  return dataStore.servers.filter((row) => {
    const status = row.status === 'disabled' ? 'disabled' : 'active'
    if (filterStatus.value && status !== filterStatus.value) return false
    if (filterTag.value && !parseTags(row.tags).includes(filterTag.value)) return false
    if (filterExpiringSoon.value) {
      const days = getExpireDays(row.expire_at)
      if (days === null || days > 7) return false
    }
    if (!kw) return true
    const hay = [row.name, row.ip, String(row.port || ''), row.username, row.tags].join(' ').toLowerCase()
    return hay.includes(kw)
  })
})

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
      tagList: parseTags(row.tags),
      expire_at: row.expire_at || null
    })
  } else {
    const defaultTag = dataStore.serverTags.find(t => t.is_default === 1)
    Object.assign(form, {
      id: null, name: '', ip: '', port: 22, username: '', password: '',
      nginx_path: '/www/server/panel/vhost/nginx',
      ftp_path: '/www/wwwroot/ftp',
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
  try {
    await ElMessageBox.confirm('确定删除此服务器？已绑定站点不会自动解绑。', '删除服务器', {
      type: 'warning',
      confirmButtonText: '删除',
      confirmButtonClass: 'el-button--danger'
    })
  } catch {
    return
  }
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

async function toggleServerStatus(row) {
  const disabling = row.status !== 'disabled'
  try {
    await ElMessageBox.confirm(
      disabling
        ? '停用后无法再分配新站点，已绑定站点不受影响。'
        : '启用后可继续分配站点。',
      disabling ? '停用服务器' : '启用服务器',
      {
        type: 'warning',
        confirmButtonText: disabling ? '停用' : '启用'
      }
    )
  } catch {
    return
  }
  const nextStatus = disabling ? 'disabled' : 'active'
  row.statusChanging = true
  try {
    const res = await api.put(`/servers/${row.id}/status`, { status: nextStatus })
    row.status = res.status
    ElMessage.success(res.message)
    dataStore.loadServers()
  } finally {
    row.statusChanging = false
  }
}

function viewDomains(row) {
  router.push({ path: '/admin-jm/subdomains', query: { server_id: String(row.id) } })
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

function getExpireDays(expireAt) {
  if (!expireAt) return null
  const expire = new Date(expireAt)
  if (isNaN(expire.getTime())) return null
  return Math.ceil((expire - new Date()) / (1000 * 60 * 60 * 24))
}

function getExpireClass(expireAt) {
  const daysLeft = getExpireDays(expireAt)
  if (daysLeft === null) return ''
  if (daysLeft < 0) return 'is-expired'
  if (daysLeft <= 7) return 'is-urgent'
  if (daysLeft <= 30) return 'is-soon'
  return 'is-ok'
}

function getExpireDaysText(expireAt) {
  const daysLeft = getExpireDays(expireAt)
  if (daysLeft === null) return ''
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

.page-header {
  margin-bottom: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid #f0f0f0;
}

.header-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin-bottom: 14px;
}

.page-title {
  font-size: 18px;
  font-weight: 600;
  color: #303133;
  display: flex;
  align-items: center;
  gap: 10px;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.filter-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 12px 14px;
  background: #f8f9fb;
  border: 1px solid #eef0f4;
  border-radius: 10px;
}

.filter-search {
  width: 240px;
  flex-shrink: 0;
}

.filter-select {
  width: 140px;
  flex-shrink: 0;
}

.filter-select-narrow {
  width: 110px;
}

.filter-checks {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.filter-checks :deep(.el-checkbox) {
  margin-right: 0;
  height: 24px;
  padding: 0 10px;
  background: #fff;
}

.record-count {
  color: #909399;
  font-size: 13px;
  margin-left: auto;
}

.server-table {
  width: 100%;
}

.server-cell {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  white-space: nowrap;
}

.server-name {
  flex-shrink: 1;
  min-width: 0;
  font-weight: 600;
  color: #303133;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.server-cell .el-tag {
  flex-shrink: 0;
}

.conn-cell {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  white-space: nowrap;
}

.conn-addr {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 13px;
  color: #303133;
  cursor: pointer;
  line-height: 1.3;
}

.conn-addr:hover {
  color: #409eff;
}

.conn-secondary {
  font-size: 12px;
  color: #909399;
  line-height: 1.3;
}

.copy-btn {
  cursor: pointer;
  color: #909399;
  font-size: 14px;
}

.copy-btn:hover {
  color: #409eff;
}

.expire-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.expire-date {
  font-size: 12px;
  font-weight: 500;
  line-height: 1.3;
}

.expire-days {
  font-size: 11px;
  line-height: 1.3;
}

.is-expired {
  color: #FF3B30;
}

.is-urgent {
  color: #FF9500;
}

.is-soon {
  color: #d4a017;
}

.is-ok {
  color: #34C759;
}

.muted {
  font-size: 12px;
  color: #909399;
}

.row-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.row-actions .el-button {
  margin-left: 0;
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 28px;
}

.form-section h4 {
  margin: 0 0 14px;
  font-size: 13px;
  font-weight: 600;
  color: #909399;
  letter-spacing: 0.02em;
}

.addr-row {
  display: flex;
  gap: 8px;
  width: 100%;
}

.addr-row .el-input {
  flex: 1;
}

.addr-row :deep(.el-input-number) {
  width: 120px;
  flex-shrink: 0;
}

.config-editor :deep(textarea) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 13px;
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

@media (max-width: 768px) {
  .card {
    padding: 15px;
    border-radius: 12px;
  }

  .page-header {
    margin-bottom: 12px;
    padding-bottom: 12px;
  }

  .header-top {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
    margin-bottom: 10px;
  }

  .page-title {
    font-size: 16px;
  }

  .header-actions {
    justify-content: stretch;
  }

  .header-actions .el-button {
    flex: 1;
  }

  .filter-bar {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
    padding: 10px;
  }

  .filter-search,
  .filter-select,
  .filter-select-narrow {
    width: 100%;
  }

  .filter-checks {
    width: 100%;
  }

  .record-count {
    margin-left: 0;
  }

  .form-grid {
    grid-template-columns: 1fr;
  }

  .addr-row {
    flex-direction: column;
  }

  .addr-row :deep(.el-input-number) {
    width: 100%;
  }

  :deep(.el-table) {
    font-size: 12px;
  }

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
}

@media (max-width: 480px) {
  .card {
    padding: 12px;
  }

  .page-title {
    font-size: 15px;
  }

  .software-name {
    font-size: 14px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .copy-btn,
  .conn-addr {
    transition: none;
  }
}
</style>
