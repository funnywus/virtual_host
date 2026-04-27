<template>
  <el-dialog :model-value="modelValue" @update:model-value="$emit('update:modelValue', $event)" title="SSL证书管理" width="750px">
    <div v-if="domain" style="margin-bottom:20px">
      <span style="margin-right:10px">域名: <strong class="full-domain">{{ domain.domain }}</strong></span>
      <el-tag v-if="form.verify_method === 'dns'" type="info" style="margin-right:10px">*.{{ domain.domain }}</el-tag>
      <el-tag :type="getSslStatusType(sslInfo.status)" size="small">{{ getSslStatusText(sslInfo.status) }}</el-tag>
      <el-button type="text" size="small" @click="refreshStatus" :loading="refreshing" style="margin-left:10px">刷新状态</el-button>
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
          <el-radio-button value="dns">DNS验证 (支持通配符)</el-radio-button>
          <el-radio-button value="http">HTTP验证</el-radio-button>
          <el-radio-button value="standalone">Standalone</el-radio-button>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="证书类型">
        <el-select v-model="form.cert_type" style="width:100%">
          <el-option label="Let's Encrypt - 免费证书" value="letsencrypt" />
          <el-option label="ZeroSSL - 免费证书" value="zerossl" />
        </el-select>
      </el-form-item>
      <el-form-item label="目标服务器">
        <el-select v-model="form.server_id" placeholder="自动选择" clearable style="width:100%">
          <el-option v-for="s in servers" :key="s.id" :label="`${s.name} (${s.ip})`" :value="s.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="网站目录" v-if="form.verify_method === 'http'">
        <el-input v-model="form.webroot" :placeholder="`/www/wwwroot/ftp/${domain?.domain}`" />
      </el-form-item>
    </el-form>

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
      <el-button type="warning" @click="renewCert" :loading="renewing" :disabled="!sslInfo.exists">续期证书</el-button>
      <el-button type="primary" @click="issueCert" :loading="issuing">申请证书</el-button>
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
  </el-dialog>
</template>

<script setup>
import { ref, reactive, watch, onMounted, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import api from '@/api'
import { copyText } from '@/utils'

const props = defineProps({
  modelValue: Boolean,
  domain: Object
})
const emit = defineEmits(['update:modelValue', 'refresh'])

const servers = ref([])
const sslInfo = reactive({ exists: false, status: '', issuer: '', not_before: '', not_after: '', paths: null, san: '', log: '' })
const form = reactive({ verify_method: 'dns', cert_type: 'letsencrypt', server_id: null, webroot: '' })

const showCertInfo = ref(false)
const showLog = ref(false)
const refreshing = ref(false)
const issuing = ref(false)
const renewing = ref(false)
const viewing = ref(false)
const downloading = ref(false)
const logPolling = ref(null)

const certDialogVisible = ref(false)
const certTab = ref('cert')
const certContent = ref('')
const keyContent = ref('')

// 开始轮询日志
function startLogPolling() {
  if (logPolling.value) return
  logPolling.value = setInterval(async () => {
    if (!props.domain) return
    try {
      const res = await api.get(`/ssl/log/${props.domain.id}`)
      if (res.log) {
        sslInfo.log = res.log
        // 自动滚动到底部
        setTimeout(() => {
          const logBox = document.querySelector('.log-box')
          if (logBox) logBox.scrollTop = logBox.scrollHeight
        }, 50)
      }
      // 如果状态不再是申请中/续期中，停止轮询
      if (res.status !== 'issuing' && res.status !== 'renewing') {
        stopLogPolling()
      }
    } catch (e) {}
  }, 1000)
}

// 停止轮询日志
function stopLogPolling() {
  if (logPolling.value) {
    clearInterval(logPolling.value)
    logPolling.value = null
  }
}

watch(() => props.modelValue, async (val) => {
  if (val && props.domain) {
    form.webroot = `/www/wwwroot/ftp/${props.domain.domain}`
    await refreshStatus()
    // 如果正在申请中，开始轮询
    if (sslInfo.status === 'issuing' || sslInfo.status === 'renewing') {
      showLog.value = true
      startLogPolling()
    }
  } else {
    stopLogPolling()
  }
})

onMounted(async () => {
  servers.value = await api.get('/servers')
})

onUnmounted(() => {
  stopLogPolling()
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
  } finally {
    refreshing.value = false
  }
}

async function issueCert() {
  issuing.value = true
  showLog.value = true
  sslInfo.log = '正在申请证书，请稍候...\n'
  startLogPolling()
  try {
    const res = await api.post(`/ssl/issue/${props.domain.id}`, form)
    sslInfo.log = res.log || sslInfo.log
    if (res.success) {
      ElMessage.success(res.message)
      emit('refresh')
    } else {
      ElMessage.error(res.message || '申请失败')
    }
  } catch (e) {
    sslInfo.log += `\n错误: ${e.message}`
  } finally {
    issuing.value = false
    stopLogPolling()
    await refreshStatus()
  }
}

async function renewCert() {
  renewing.value = true
  showLog.value = true
  sslInfo.log = '正在续期证书，请稍候...\n'
  startLogPolling()
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
    sslInfo.log += `\n错误: ${e.message}`
  } finally {
    renewing.value = false
    stopLogPolling()
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
    const response = await fetch(`/api/ssl/download/${props.domain.id}`, {
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
</script>

<style scoped>
.full-domain { color: #409eff; font-weight: bold; }
.ftp-info { background: #f5f7fa; padding: 15px; border-radius: 4px; }
.ftp-info p { margin: 5px 0; font-family: monospace; }
.log-box { background: #1e1e1e; color: #d4d4d4; padding: 15px; border-radius: 6px; font-family: monospace; font-size: 12px; max-height: 300px; overflow-y: auto; white-space: pre-wrap; word-break: break-all; }

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
