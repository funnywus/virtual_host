<template>
  <el-dialog :model-value="modelValue" @update:model-value="$emit('update:modelValue', $event)" title="SSL证书管理" width="750px" append-to-body>
    <div v-if="domain" style="margin-bottom:20px">
      <span style="margin-right:10px">域名: <strong class="full-domain">{{ domain.domain }}</strong></span>
      <el-tag v-if="form.verify_method === 'dns'" type="info" style="margin-right:10px">*.{{ domain.domain }}</el-tag>
      <el-tag :type="getSslStatusType(sslInfo.status)" size="small">{{ getSslStatusText(sslInfo.status) }}</el-tag>
      <el-button type="text" size="small" @click="refreshStatus" :loading="refreshing" style="margin-left:10px">刷新状态</el-button>
      <el-button type="primary" size="small" @click="showCertFiles" :loading="loadingFiles">
        <el-icon><FolderOpened /></el-icon>证书文件
      </el-button>
      <el-button type="success" size="small" @click="openPublishDialog" :disabled="!sslInfo.local_cert?.stored">
        <el-icon><Upload /></el-icon>发布证书
      </el-button>
    </div>

    <!-- 证书信息 -->
    <div v-if="sslInfo.exists" style="margin-bottom:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <strong>证书信息</strong>
        <div>
          <el-button type="primary" size="small" @click="viewCert" :loading="viewing">查看证书</el-button>
          <el-button type="success" size="small" @click="downloadCert" :loading="downloading">下载证书</el-button>
          <el-button type="text" size="small" @click="showCertInfo = !showCertInfo">{{ showCertInfo ? '收起' : '展开' }}</el-button>
        </div>
      </div>
      <div v-show="showCertInfo" class="ftp-info">
        <p><strong>证书类型：</strong>{{ sslInfo.san?.includes('*') ? '通配符证书' : '单域名证书' }}</p>
        <p><strong>覆盖域名：</strong>{{ sslInfo.san || domain?.domain }}</p>
        <p><strong>颁发机构：</strong>{{ sslInfo.issuer || '-' }}</p>
        <p><strong>生效时间：</strong>{{ sslInfo.not_before || '-' }}</p>
        <p><strong>过期时间：</strong>{{ sslInfo.not_after || '-' }}</p>
        <p><strong>证书路径：</strong><span style="font-size:12px;color:#666">{{ sslInfo.paths?.fullchain }}</span></p>
        <p><strong>私钥路径：</strong><span style="font-size:12px;color:#666">{{ sslInfo.paths?.key }}</span></p>
      </div>
    </div>

    <!-- 申请表单 -->
    <el-form :model="form" label-width="100px">
      <el-form-item label="验证方式">
        <el-radio-group v-model="form.verify_method">
          <el-radio-button value="dns">DNS验证 (通配符)</el-radio-button>
          <el-radio-button value="http">HTTP验证 (单域名)</el-radio-button>
          <el-radio-button value="standalone">Standalone (单域名)</el-radio-button>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="证书类型">
        <el-select v-model="form.cert_type" style="width:100%">
          <el-option
            v-for="(info, key) in certTypes"
            :key="key"
            :label="`${info.name} - ${info.desc}`"
            :value="key"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="签发服务器">
        <div class="issue-server-line">
          <el-tag :type="defaultServer ? 'success' : 'warning'" size="small">
            {{ defaultServer ? `${defaultServer.name || defaultServer.ip} (${defaultServer.ip})` : '未设置默认服务器' }}
          </el-tag>
          <span class="issue-server-note">申请和续期统一使用默认服务器，证书会保存到当前项目 uploads/certs。</span>
        </div>
      </el-form-item>
      <el-form-item label="网站目录" v-if="form.verify_method === 'http'">
        <el-input v-model="form.webroot" :placeholder="`/www/wwwroot/ftp/${domain?.domain}`" />
      </el-form-item>
    </el-form>

    <el-alert v-if="form.verify_method === 'dns' && !hasDnsConfig" type="error" :closable="false" style="margin-bottom:15px">
      通配符证书需要配置 DNS 平台（编辑域名选择 DNS 平台配置）
    </el-alert>
    <el-alert v-else-if="form.verify_method === 'http'" type="info" :closable="false" style="margin-bottom:15px">
      HTTP 验证仅申请主域名 {{ domain?.domain }}，需确保 80 端口可访问且网站目录正确。
    </el-alert>
    <el-alert v-else-if="form.verify_method === 'standalone'" type="warning" :closable="false" style="margin-bottom:15px">
      Standalone 模式会临时停止 Nginx 释放 80 端口，仅申请主域名 {{ domain?.domain }}。
    </el-alert>

    <!-- 申请日志 -->
    <div v-if="sslInfo.log" style="margin-bottom:15px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <strong>申请日志</strong>
        <el-button type="text" size="small" @click="showLog = !showLog">{{ showLog ? '收起' : '展开' }}</el-button>
      </div>
      <div v-show="showLog" class="log-box">{{ sslInfo.log }}</div>
    </div>

    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">关闭</el-button>
      <el-button type="success" @click="openPublishDialog" :disabled="!sslInfo.local_cert?.stored">发布证书</el-button>
      <el-button type="info" @click="openApplyBtDialog" :disabled="!sslInfo.local_cert?.stored">应用到宝塔网站</el-button>
      <el-button type="warning" @click="renewCert" :loading="renewing" :disabled="!sslInfo.exists">续期证书</el-button>
      <el-button type="primary" @click="issueCert" :loading="issuing" :disabled="!canIssueCert">申请证书</el-button>
    </template>

    <!-- 证书内容对话框 -->
    <el-dialog v-model="certDialogVisible" title="证书内容" width="800px" append-to-body>
      <el-tabs v-model="certTab">
        <el-tab-pane label="证书 (fullchain.crt)" name="cert">
          <div class="log-box">{{ certContent }}</div>
        </el-tab-pane>
        <el-tab-pane label="私钥 (key)" name="key">
          <div class="log-box">{{ keyContent }}</div>
        </el-tab-pane>
      </el-tabs>
      <template #footer>
        <el-button @click="copyText(certTab === 'cert' ? certContent : keyContent)">复制内容</el-button>
        <el-button type="primary" @click="certDialogVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 当前项目证书文件对话框 -->
    <el-dialog v-model="certFilesDialogVisible" title="证书文件" width="820px" append-to-body>
      <div v-if="certFilesInfo.domain" class="cert-files-head">
        <div>
          <span class="cert-files-label">本地域名</span>
          <strong>{{ certFilesInfo.domain }}</strong>
        </div>
        <el-tag :type="certFilesInfo.stored ? 'success' : 'warning'" size="small">
          {{ certFilesInfo.stored ? '已保存完整证书' : '本地证书不完整' }}
        </el-tag>
      </div>

      <div class="cert-dir-row">
        <span class="cert-files-label">本地目录</span>
        <span class="cert-path">{{ certFilesInfo.dir || '-' }}</span>
        <el-button v-if="certFilesInfo.dir" type="primary" link @click="copyText(certFilesInfo.dir)">复制</el-button>
      </div>

      <el-table :data="certFiles" size="small" border style="width:100%">
        <el-table-column prop="label" label="类型" width="90">
          <template #default="{ row }">
            <el-tag :type="row.missing ? 'info' : row.type === 'key' ? 'danger' : 'success'" size="small">
              {{ row.label }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="name" label="文件名" min-width="170" show-overflow-tooltip />
        <el-table-column label="大小" width="95">
          <template #default="{ row }">{{ row.missing ? '-' : formatFileSize(row.size) }}</template>
        </el-table-column>
        <el-table-column label="更新时间" width="155">
          <template #default="{ row }">{{ row.modified_at || '-' }}</template>
        </el-table-column>
        <el-table-column label="路径" min-width="240">
          <template #default="{ row }">
            <div class="cert-file-path-cell">
              <span class="cert-path" :class="{ muted: row.missing }">{{ row.path }}</span>
              <el-button type="primary" link @click="copyText(row.path)">复制</el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <el-empty v-if="certFiles.length === 0" description="暂无证书文件" />

      <template #footer>
        <el-button type="primary" @click="certFilesDialogVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 发布证书对话框 -->
    <el-dialog v-model="publishDialogVisible" title="发布证书" width="620px" append-to-body>
      <el-form :model="publishForm" label-width="100px">
        <el-form-item label="发布服务器">
          <el-select v-model="publishForm.server_id" placeholder="默认服务器" clearable style="width:100%">
            <el-option
              v-for="s in servers"
              :key="s.id"
              :label="`${s.name || s.ip} (${s.ip})${s.is_default ? ' - 默认' : ''}`"
              :value="s.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="发布目录">
          <el-input v-model="publishForm.target_dir" :placeholder="`/www/certs/${domain?.domain}`" />
        </el-form-item>
      </el-form>
      <div class="publish-path-preview">
        <div><span>证书链</span>{{ publishForm.target_dir }}/{{ domain?.domain }}.fullchain.crt</div>
        <div><span>私钥</span>{{ publishForm.target_dir }}/{{ domain?.domain }}.key</div>
        <div><span>证书</span>{{ publishForm.target_dir }}/{{ domain?.domain }}.crt</div>
      </div>
      <template #footer>
        <el-button @click="publishDialogVisible = false">取消</el-button>
        <el-button type="success" @click="publishCert" :loading="publishing">发布</el-button>
      </template>
    </el-dialog>

    <!-- 应用证书到宝塔网站对话框 -->
    <el-dialog v-model="applyBtDialogVisible" title="应用证书到宝塔网站" width="720px" append-to-body top="5vh">
      <el-alert type="info" :closable="false" style="margin-bottom:15px">
        <template #title>
          <div style="font-size:13px;line-height:1.6">
            选择目标服务器后，会自动列出宝塔已有的网站。选中需要应用证书的网站，证书会发布到 /www/server/panel/vhost/cert/ 下并自动改写网站 nginx 配置启用 HTTPS。
          </div>
        </template>
      </el-alert>
      <el-form :model="applyBtForm" label-width="100px">
        <el-form-item label="目标服务器">
          <el-select v-model="applyBtForm.server_id" placeholder="选择服务器" style="width:100%" @change="loadBtSites">
            <el-option
              v-for="s in servers"
              :key="s.id"
              :label="`${s.name || s.ip} (${s.ip})${s.is_default ? ' - 默认' : ''}`"
              :value="s.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="强制 HTTPS">
          <el-switch v-model="applyBtForm.force_https" />
          <span style="margin-left:10px;color:#909399;font-size:12px">开启后访问 HTTP 会自动跳转 HTTPS</span>
        </el-form-item>
      </el-form>
      
      <div v-if="applyBtForm.server_id" style="margin-top:15px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <span style="font-weight:600">选择网站 ({{ btSites.length }} 个)</span>
          <div>
            <el-input
              v-model="btSiteKeyword"
              placeholder="搜索网站..."
              size="small"
              clearable
              style="width:200px;margin-right:8px"
            />
            <el-button size="small" @click="loadBtSites" :loading="loadingBtSites">刷新</el-button>
          </div>
        </div>
        <el-table :data="filteredBtSites" stripe max-height="350" v-loading="loadingBtSites" @selection-change="onBtSiteSelectionChange">
          <el-table-column type="selection" width="44" />
          <el-table-column prop="name" label="网站域名" min-width="200" />
          <el-table-column label="当前SSL" width="100">
            <template #default="{ row }">
              <el-tag :type="row.has_ssl ? 'success' : 'info'" size="small">
                {{ row.has_ssl ? '已启用' : '未启用' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="config_path" label="配置路径" min-width="260" show-overflow-tooltip />
        </el-table>
        <div v-if="btSites.length === 0 && !loadingBtSites" style="text-align:center;color:#909399;padding:20px">
          未找到宝塔网站
        </div>
      </div>
      
      <!-- 应用日志 -->
      <div v-if="applyBtLog" class="log-box" style="margin-top:15px;max-height:300px">{{ applyBtLog }}</div>
      
      <template #footer>
        <el-button @click="applyBtDialogVisible = false">关闭</el-button>
        <el-button 
          type="primary" 
          @click="executeApplyBt" 
          :loading="applyingBt" 
          :disabled="selectedBtSites.length === 0"
        >
          应用到 {{ selectedBtSites.length }} 个网站
        </el-button>
      </template>
    </el-dialog>
  </el-dialog>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import api from '@/api'
import { copyText } from '@/utils'
import { API_BASE, WS_BASE } from '@/config'

const props = defineProps({
  modelValue: Boolean,
  domain: Object
})
const emit = defineEmits(['update:modelValue', 'refresh'])

const servers = ref([])
const certTypes = ref({})
const defaultServer = computed(() => servers.value.find(s => s.is_default) || servers.value[0])
const hasDnsConfig = ref(false)
const sslInfo = reactive({ exists: false, status: '', issuer: '', not_before: '', not_after: '', paths: null, san: '', log: '', local_cert: null })
const form = reactive({ verify_method: 'dns', cert_type: 'letsencrypt', webroot: '' })
const canIssueCert = computed(() => {
  if (!defaultServer.value) return false
  if (form.verify_method === 'dns') return hasDnsConfig.value
  return true
})
const publishForm = reactive({ server_id: '', target_dir: '' })

const showCertInfo = ref(false)
const showLog = ref(false)
const refreshing = ref(false)
const issuing = ref(false)
const renewing = ref(false)
const viewing = ref(false)
const downloading = ref(false)
const loadingFiles = ref(false)
const publishing = ref(false)
const sslLogSocket = ref(null)

const certDialogVisible = ref(false)
const certTab = ref('cert')
const certContent = ref('')
const keyContent = ref('')
const certFilesDialogVisible = ref(false)
const certFiles = ref([])
const certFilesInfo = reactive({ domain: '', stored: false, dir: '', metadata: null })
const publishDialogVisible = ref(false)

// 应用到宝塔网站
const applyBtDialogVisible = ref(false)
const applyingBt = ref(false)
const loadingBtSites = ref(false)
const btSites = ref([])
const selectedBtSites = ref([])
const btSiteKeyword = ref('')
const applyBtLog = ref('')
const applyBtForm = reactive({
  server_id: '',
  force_https: true
})

const filteredBtSites = computed(() => {
  if (!btSiteKeyword.value) return btSites.value
  const kw = btSiteKeyword.value.toLowerCase()
  return btSites.value.filter(s => s.name.toLowerCase().includes(kw))
})

function scrollLogToBottom() {
  setTimeout(() => {
    const logBox = document.querySelector('.log-box')
    if (logBox) logBox.scrollTop = logBox.scrollHeight
  }, 50)
}

function startSslLogSocket() {
  if (sslLogSocket.value || !props.domain) return

  const token = localStorage.getItem('token')
  if (!token) return

  const wsUrl = `${WS_BASE}/api/ws-ssl-log?token=${encodeURIComponent(token)}&domainId=${props.domain.id}`
  const socket = new WebSocket(wsUrl)

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)
      if (data.type !== 'ssl-log') return

      if (typeof data.log === 'string') {
        sslInfo.log = data.log
        scrollLogToBottom()
      }
      if (typeof data.status === 'string') {
        sslInfo.status = data.status
        if (data.status !== 'issuing' && data.status !== 'renewing') {
          stopSslLogSocket()
        }
      }
      if (typeof data.expires === 'string' || data.expires === null) {
        sslInfo.not_after = data.expires || sslInfo.not_after
      }
    } catch (err) {
      console.error('解析 SSL 日志消息失败:', err)
    }
  }

  socket.onclose = () => {
    if (sslLogSocket.value === socket) {
      sslLogSocket.value = null
    }
  }

  socket.onerror = () => {
    socket.close()
  }

  sslLogSocket.value = socket
}

function stopSslLogSocket() {
  if (sslLogSocket.value) {
    sslLogSocket.value.close()
    sslLogSocket.value = null
  }
}

watch(() => props.modelValue, async (val) => {
  if (val && props.domain) {
    form.webroot = `/www/wwwroot/ftp/${props.domain.domain}`
    publishForm.target_dir = `/www/certs/${props.domain.domain}`
    publishForm.server_id = defaultServer.value?.id || ''
    await refreshStatus()
    // 如果正在申请中，开始轮询
    if (sslInfo.status === 'issuing' || sslInfo.status === 'renewing') {
      showLog.value = true
      startSslLogSocket()
    }
  } else {
    stopSslLogSocket()
  }
})

onMounted(async () => {
  const [serverList, types] = await Promise.all([
    api.get('/ssl/servers'),
    api.get('/ssl/types')
  ])
  servers.value = serverList
  certTypes.value = types
})

onUnmounted(() => {
  stopSslLogSocket()
})

function getSslStatusType(status) {
  const types = { active: 'success', issuing: 'warning', renewing: 'warning', error: 'danger' }
  return types[status] || 'info'
}

function getSslStatusText(status) {
  const texts = { active: '已启用', issuing: '申请中', renewing: '续期中', error: '失败' }
  return texts[status] || '未申请'
}

async function refreshStatus() {
  if (!props.domain) return
  refreshing.value = true
  try {
    const res = await api.get(`/ssl/status/${props.domain.id}`)
    // 映射字段名
    sslInfo.exists = res.exists
    sslInfo.status = res.ssl_status || ''
    sslInfo.issuer = res.issuer || ''
    sslInfo.not_before = res.not_before || ''
    sslInfo.not_after = res.not_after || ''
    sslInfo.paths = res.paths
    sslInfo.san = res.san || ''
    sslInfo.log = res.ssl_log || ''
    sslInfo.local_cert = res.local_cert || null
    hasDnsConfig.value = !!res.has_dns_config
  } finally {
    refreshing.value = false
  }
}

async function issueCert() {
  issuing.value = true
  showLog.value = true
  sslInfo.log = '正在申请证书，请稍候...\n'
  startSslLogSocket()
  try {
    const payload = {
      verify_method: form.verify_method,
      cert_type: form.cert_type,
      webroot: form.webroot
    }
    const res = await api.post(`/ssl/issue/${props.domain.id}`, payload)
    sslInfo.log = res.log || sslInfo.log
    if (res.success) {
      ElMessage.success(res.message)
      emit('refresh')
    } else {
      ElMessage.error(res.message || '申请失败')
    }
  } catch (e) {
    const serverLog = e.response?.data?.log
    sslInfo.log = serverLog || `${sslInfo.log}\n错误: ${e.message}`
  } finally {
    issuing.value = false
    stopSslLogSocket()
    await refreshStatus()
  }
}

async function renewCert() {
  renewing.value = true
  showLog.value = true
  sslInfo.log = '正在续期证书，请稍候...\n'
  startSslLogSocket()
  try {
    const res = await api.post(`/ssl/renew/${props.domain.id}`)
    sslInfo.log = res.log || sslInfo.log
    if (res.success) {
      ElMessage.success(res.message)
      emit('refresh')
    } else {
      ElMessage.error(res.message || '续期失败')
    }
  } catch (e) {
    const serverLog = e.response?.data?.log
    sslInfo.log = serverLog || `${sslInfo.log}\n错误: ${e.message}`
  } finally {
    renewing.value = false
    stopSslLogSocket()
    await refreshStatus()
  }
}

async function viewCert() {
  viewing.value = true
  try {
    const res = await api.get(`/ssl/view/${props.domain.id}`)
    certContent.value = res.cert || '(无法读取证书内容)'
    keyContent.value = res.key || '(无法读取私钥内容)'
    certTab.value = 'cert'
    certDialogVisible.value = true
  } finally {
    viewing.value = false
  }
}

async function downloadCert() {
  downloading.value = true
  try {
    const token = localStorage.getItem('token')
    const response = await fetch(`${API_BASE}/api/ssl/download/${props.domain.id}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (!response.ok) throw new Error('下载失败')
    const blob = await response.blob()
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${props.domain.domain}_ssl.zip`
    a.click()
    window.URL.revokeObjectURL(url)
    ElMessage.success('证书下载成功')
  } finally {
    downloading.value = false
  }
}

function formatFileSize(size) {
  if (!size) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = size
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex++
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

async function showCertFiles() {
  if (!props.domain) return
  loadingFiles.value = true
  try {
    const res = await api.get(`/ssl/files/${props.domain.id}`)
    certFiles.value = res.files || []
    Object.assign(certFilesInfo, {
      domain: res.domain || props.domain.domain,
      stored: !!res.stored,
      dir: res.dir || '',
      metadata: res.metadata || null
    })
    certFilesDialogVisible.value = true
  } finally {
    loadingFiles.value = false
  }
}

function openPublishDialog() {
  if (!props.domain) return
  publishForm.target_dir = publishForm.target_dir || `/www/certs/${props.domain.domain}`
  publishForm.server_id = publishForm.server_id || defaultServer.value?.id || ''
  publishDialogVisible.value = true
}

async function publishCert() {
  if (!props.domain) return
  publishing.value = true
  try {
    const res = await api.post(`/ssl/publish/${props.domain.id}`, {
      server_id: publishForm.server_id || null,
      target_dir: publishForm.target_dir || `/www/certs/${props.domain.domain}`
    })
    sslInfo.log = res.log || sslInfo.log
    showLog.value = true
    publishDialogVisible.value = false
    ElMessage.success(res.message || '证书发布成功')
  } catch (e) {
    const serverLog = e.response?.data?.log
    sslInfo.log = serverLog || `${sslInfo.log}\n错误: ${e.message}`
    showLog.value = true
  } finally {
    publishing.value = false
  }
}

// 应用证书到宝塔网站
function openApplyBtDialog() {
  applyBtLog.value = ''
  btSites.value = []
  selectedBtSites.value = []
  btSiteKeyword.value = ''
  applyBtForm.server_id = defaultServer.value?.id || ''
  applyBtForm.force_https = true
  applyBtDialogVisible.value = true
  if (applyBtForm.server_id) {
    loadBtSites()
  }
}

async function loadBtSites() {
  if (!applyBtForm.server_id) return
  loadingBtSites.value = true
  selectedBtSites.value = []
  try {
    const res = await api.get(`/ssl/bt-sites/${applyBtForm.server_id}`)
    btSites.value = res.sites || []
  } catch (e) {
    ElMessage.error(e.message || '加载宝塔网站失败')
    btSites.value = []
  } finally {
    loadingBtSites.value = false
  }
}

function onBtSiteSelectionChange(rows) {
  selectedBtSites.value = rows
}

async function executeApplyBt() {
  if (!props.domain) return
  if (selectedBtSites.value.length === 0) {
    ElMessage.warning('请选择要应用证书的网站')
    return
  }
  
  applyingBt.value = true
  applyBtLog.value = ''
  let successCount = 0
  let failedCount = 0
  
  for (const site of selectedBtSites.value) {
    applyBtLog.value += `\n>>> 处理 ${site.name}...\n`
    try {
      const res = await api.post('/ssl/apply-to-bt-site', {
        domain_id: props.domain.id,
        server_id: applyBtForm.server_id,
        site_name: site.name,
        force_https: applyBtForm.force_https
      })
      applyBtLog.value += res.log || ''
      successCount++
    } catch (e) {
      const serverLog = e.response?.data?.log
      applyBtLog.value += serverLog || `错误: ${e.message}\n`
      failedCount++
    }
  }
  
  applyBtLog.value += `\n========== 完成: 成功 ${successCount} 个, 失败 ${failedCount} 个 ==========\n`
  ElMessage.success(`应用完成: 成功 ${successCount} 个, 失败 ${failedCount} 个`)
  
  // 刷新宝塔网站列表（更新 has_ssl 状态）
  await loadBtSites()
  applyingBt.value = false
}
</script>

<style scoped>
.full-domain { color: #409eff; font-weight: bold; }
.ftp-info { background: #f5f7fa; padding: 15px; border-radius: 4px; }
.ftp-info p { margin: 5px 0; font-family: monospace; }
.log-box { background: #1e1e1e; color: #d4d4d4; padding: 15px; border-radius: 6px; font-family: monospace; font-size: 12px; max-height: 300px; overflow-y: auto; white-space: pre-wrap; word-break: break-all; }
.cert-files-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.cert-files-label { color: #606266; margin-right: 8px; font-size: 13px; }
.cert-dir-row { display: flex; align-items: center; gap: 8px; padding: 10px 12px; margin-bottom: 12px; background: #f5f7fa; border-radius: 4px; }
.cert-path { font-family: monospace; font-size: 12px; color: #303133; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cert-path.muted { color: #909399; }
.cert-file-path-cell { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px; min-width: 0; }
.issue-server-line { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-width: 0; }
.issue-server-note { color: #909399; font-size: 12px; line-height: 1.4; }
.publish-path-preview { background: #f5f7fa; border-radius: 4px; padding: 10px 12px; font-family: monospace; font-size: 12px; color: #303133; }
.publish-path-preview div { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 8px; line-height: 1.8; word-break: break-all; }
.publish-path-preview span { color: #606266; }

/* ========== 移动端适配 ========== */
@media (max-width: 768px) {
  :deep(.el-dialog) {
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
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  :deep(.el-dialog__footer .el-button) {
    flex: 1;
    min-width: calc(50% - 4px);
    margin: 0;
    font-size: 12px;
  }

  /* 表单优化 */
  :deep(.el-form-item) {
    margin-bottom: 15px;
  }

  :deep(.el-form-item__label) {
    font-size: 13px;
  }

  /* Radio Group 优化 */
  :deep(.el-radio-group) {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  :deep(.el-radio-button) {
    width: 100%;
  }

  :deep(.el-radio-button__inner) {
    width: 100%;
    font-size: 12px;
    padding: 8px 10px;
  }

  /* 证书信息优化 */
  .ftp-info {
    padding: 12px;
    font-size: 12px;
  }

  .ftp-info p {
    font-size: 11px;
    word-break: break-all;
  }

  /* 日志框优化 */
  .log-box {
    padding: 10px;
    font-size: 11px;
    max-height: 200px;
  }

  /* 按钮组优化 */
  :deep(.el-button-group) {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  :deep(.el-button-group .el-button) {
    width: 100%;
    margin: 0;
  }
}

/* 小屏手机适配 */
@media (max-width: 480px) {
  :deep(.el-dialog__footer .el-button) {
    min-width: 100%;
    font-size: 11px;
  }

  .ftp-info {
    padding: 10px;
    font-size: 11px;
  }

  .ftp-info p {
    font-size: 10px;
  }

  .log-box {
    font-size: 10px;
    padding: 8px;
  }
}
</style>
