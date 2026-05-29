<template>
  <div class="card">
    <div class="card-title">
      <span>主域名列表</span>
      <div>
        <el-input 
          v-model="searchKeyword" 
          placeholder="搜索域名、备注..." 
          clearable 
          style="width:200px;margin-right:10px" 
          size="small"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>
        <el-select v-model="filterTag" placeholder="筛选标签" clearable style="width:140px;margin-right:10px" size="small">
          <el-option v-for="t in dataStore.serverTags" :key="t.id" :label="t.name" :value="t.name" />
        </el-select>
        <el-select v-model="filterStatus" placeholder="筛选状态" clearable style="width:120px;margin-right:10px" size="small">
          <el-option label="正常" value="active" />
          <el-option label="禁用" value="disabled" />
        </el-select>
        <el-button size="small" @click="loadData" :loading="loading"><el-icon><Refresh /></el-icon></el-button>
        <el-button size="small" @click="refreshAllSsl" :loading="refreshingSsl">刷新证书状态</el-button>
        <el-button type="success" size="small" @click="openBatchSslDialog" :disabled="filteredDomains.length === 0">批量获取证书</el-button>
        <el-button type="warning" size="small" @click="openBatchPublishDialog" :disabled="filteredDomains.length === 0">批量发布证书</el-button>
        <el-button type="primary" size="small" @click="openDialog()">添加域名</el-button>
      </div>
    </div>
    <el-table :data="filteredDomains" stripe @selection-change="selectedDomains = $event">
      <el-table-column type="selection" width="44" />
      <el-table-column prop="domain" label="域名" width="180">
        <template #default="{ row }">
          <span class="full-domain">{{ row.domain }}</span>
          <el-tag v-if="row.is_default === 1" type="warning" size="small" style="margin-left:5px">默认</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="aliyun_name" label="DNS配置" width="120">
        <template #default="{ row }">
          <el-tag v-if="row.aliyun_name" type="success">{{ row.aliyun_name }}</el-tag>
          <el-tag v-else type="info">未配置</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="80">
        <template #default="{ row }">
          <el-tag :type="row.status === 'disabled' ? 'danger' : 'success'" size="small">{{ row.status === 'disabled' ? '禁用' : '正常' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="标签" width="80">
        <template #default="{ row }">
          <el-tag v-for="tag in parseTags(row.tags)" :key="tag" :style="getTagStyle(tag)" size="small" style="margin-right:4px">{{ tag }}</el-tag>
          <span v-if="!row.tags" style="color:#999">-</span>
        </template>
      </el-table-column>
      <el-table-column label="SSL证书" width="120">
        <template #default="{ row }">
          <p>
          <el-tag :type="getSslStatusType(row.ssl_status)" size="small">{{ getSslStatusText(row.ssl_status) }}</el-tag>
          </p>
          <p>
          <el-tag v-if="row.ssl_expires" :type="getSslDaysType(row.ssl_expires)" size="small">
            {{ formatSslDays(row.ssl_expires) }}
          </el-tag>
          </p>
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
      <el-table-column label="操作" width="240" fixed="right">
        <template #default="{ row }">
          <el-button type="primary" size="small" @click="openDnsRecordsDialog(row)">DNS记录</el-button>
          <el-button type="warning" size="small" @click="openSslDialog(row)">SSL</el-button>
          <el-dropdown trigger="click" style="margin-left:8px">
            <el-button size="small">更多<el-icon class="el-icon--right"><ArrowDown /></el-icon></el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="viewSubdomains(row)">子域名</el-dropdown-item>
                <el-dropdown-item @click="setDefault(row)" :disabled="row.is_default === 1">设为默认</el-dropdown-item>
                <el-dropdown-item @click="toggleDomainStatus(row)">{{ row.status === 'disabled' ? '启用' : '禁用' }}</el-dropdown-item>
                <el-dropdown-item @click="openDialog(row)">编辑</el-dropdown-item>
                <el-dropdown-item divided @click="handleDelete(row.id)" style="color:#f56c6c">删除</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </template>
      </el-table-column>
    </el-table>

    <!-- 添加/编辑对话框 -->
    <el-dialog v-model="dialogVisible" :title="form.id ? '编辑域名' : '添加域名'" width="650px">
      <el-form :model="form" label-width="100px">
        <el-form-item label="域名">
          <el-input v-model="form.domain" placeholder="例如: example.com" :disabled="!!form.id" />
        </el-form-item>
        <el-form-item label="DNS配置">
          <el-select v-model="form.aliyun_config_id" placeholder="选择DNS配置" clearable style="width:100%">
            <el-option v-for="c in dataStore.aliyunConfigs" :key="c.id" :label="c.name + (c.is_default === 1 ? ' (默认)' : '')" :value="c.id" />
          </el-select>
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
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSave" :loading="saving">确定</el-button>
      </template>
    </el-dialog>

    <!-- SSL证书对话框 -->
    <SslDialog v-model="sslDialogVisible" :domain="currentDomain" @refresh="dataStore.loadDomains" />

    <!-- 批量获取证书日志 - 多任务Tab模式 -->
    <el-dialog v-model="batchSslDialogVisible" title="批量获取证书" width="900px" append-to-body top="5vh">
      <!-- 新建任务区域 -->
      <div v-if="!currentBatchTask" class="batch-ssl-new-task">
        <div class="batch-ssl-summary">
          <div>
            <span class="batch-ssl-label">处理范围</span>
            <strong>{{ batchTargetDomains.length }} 个域名</strong>
            <span class="batch-ssl-muted">{{ selectedDomains.length ? '已勾选' : '当前筛选结果' }}</span>
          </div>
        </div>
        <el-form :model="batchSslForm" label-width="90px" style="margin-top:15px">
          <el-form-item label="证书类型">
            <el-select v-model="batchSslForm.cert_type" style="width:220px">
              <el-option label="Let's Encrypt" value="letsencrypt" />
              <el-option label="ZeroSSL" value="zerossl" />
            </el-select>
          </el-form-item>
        </el-form>
        <div style="text-align:center;margin-top:20px">
          <el-button type="primary" size="large" @click="startBatchSsl" :loading="startingBatchSsl" :disabled="batchTargetDomains.length === 0">
            <el-icon style="margin-right:5px"><Plus /></el-icon>
            开始批量获取
          </el-button>
        </div>
      </div>

      <!-- 任务列表Tab -->
      <div v-else class="batch-ssl-tasks">
        <el-tabs v-model="activeTaskTab" type="card" closable @tab-remove="removeTask">
          <el-tab-pane
            v-for="task in batchSslTasks"
            :key="task.job_id"
            :name="task.job_id"
            :closable="task.status === 'completed' || task.status === 'completed_with_errors' || task.status === 'error'"
          >
            <template #label>
              <div style="display:flex;align-items:center;gap:8px">
                <el-icon v-if="task.status === 'running' || task.status === 'pending'" class="is-loading"><Loading /></el-icon>
                <el-icon v-else-if="task.status === 'completed'" style="color:#67c23a"><CircleCheck /></el-icon>
                <el-icon v-else-if="task.status === 'error' || task.status === 'completed_with_errors'" style="color:#f56c6c"><CircleClose /></el-icon>
                <span>任务 {{ task.created_at?.slice(11, 19) || task.job_id.slice(0, 8) }}</span>
                <el-badge v-if="task.status === 'running' || task.status === 'pending'" :value="`${task.done}/${task.total}`" type="primary" />
              </div>
            </template>

            <!-- 任务详情 -->
            <div class="batch-task-content">
              <div class="batch-ssl-summary">
                <div>
                  <span class="batch-ssl-label">任务ID</span>
                  <span style="font-family:monospace;font-size:12px;color:#909399">{{ task.job_id }}</span>
                </div>
                <el-tag :type="getBatchStatusType(task.status)" size="small">{{ getBatchStatusText(task.status) }}</el-tag>
              </div>
              
              <el-progress
                :percentage="getTaskProgress(task)"
                :status="task.failed > 0 && task.status !== 'running' && task.status !== 'pending' ? 'exception' : getTaskProgress(task) === 100 ? 'success' : ''"
                style="margin:15px 0"
              />
              
              <div class="batch-ssl-counts">
                <span>总数 {{ task.total }}</span>
                <span>完成 {{ task.done }}</span>
                <span class="success">成功 {{ task.success }}</span>
                <span class="failed">失败 {{ task.failed }}</span>
              </div>

              <!-- 重试操作按钮 -->
              <div v-if="isTaskRetryable(task)" class="batch-retry-actions">
                <el-button type="warning" size="small" @click="retryBatchTask(task, 'remaining')" :loading="retryingTask">
                  从中断位置继续
                </el-button>
                <el-button type="danger" size="small" @click="retryBatchTask(task, 'failed')" :loading="retryingTask" :disabled="task.failed === 0">
                  仅重试失败项 ({{ task.failed }})
                </el-button>
                <el-button type="primary" size="small" @click="retryBatchTask(task, 'all')" :loading="retryingTask">
                  全部重新执行
                </el-button>
              </div>
              
              <div class="batch-log-box">{{ task.log || '等待开始...' }}</div>
            </div>
          </el-tab-pane>
        </el-tabs>
      </div>

      <template #footer>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="display:flex;gap:8px">
            <el-button v-if="currentBatchTask" @click="backToNewTask" :disabled="hasRunningTask">
              <el-icon style="margin-right:5px"><Plus /></el-icon>
              新建任务
            </el-button>
            <el-button v-if="hasCompletedTasks" type="danger" plain @click="clearCompletedTasks">
              清空已完成
            </el-button>
          </div>
          <div>
            <el-button @click="batchSslDialogVisible = false">关闭</el-button>
            <el-button v-if="currentBatchTask" type="primary" @click="refreshCurrentTask" :loading="refreshingTask">
              <el-icon style="margin-right:5px"><Refresh /></el-icon>
              刷新
            </el-button>
          </div>
        </div>
      </template>
    </el-dialog>

    <!-- DNS记录对话框 -->
    <el-dialog v-model="dnsRecordsDialogVisible" :title="'DNS解析记录 - ' + (currentDomain?.domain || '')" width="900px" append-to-body top="5vh">
      <div style="margin-bottom:15px;display:flex;justify-content:space-between;align-items:center">
        <div style="display:flex;gap:10px;align-items:center">
          <el-tag type="info">{{ dnsRecords.platform === 'tencent' ? '腾讯云' : '阿里云' }}</el-tag>
          <span style="color:#909399">共 {{ filteredDnsRecords.length }} 条记录</span>
        </div>
        <div style="display:flex;gap:10px">
          <el-input 
            v-model="dnsSearchKeyword" 
            placeholder="搜索主机记录、记录值..." 
            clearable 
            style="width:220px" 
            size="small"
          >
            <template #prefix>
              <el-icon><Search /></el-icon>
            </template>
          </el-input>
          <el-button size="small" @click="loadDnsRecords" :loading="loadingDnsRecords"><el-icon><Refresh /></el-icon> 刷新</el-button>
          <el-button type="primary" size="small" @click="openAddDnsRecordDialog">添加记录</el-button>
        </div>
      </div>
      <el-table :data="paginatedDnsRecords" stripe v-loading="loadingDnsRecords" max-height="500">
        <el-table-column prop="name" label="主机记录" width="120" />
        <el-table-column prop="type" label="类型" width="80" />
        <el-table-column prop="value" label="记录值" min-width="180" show-overflow-tooltip />
        <el-table-column label="服务器" width="120">
          <template #default="{ row }">
            <span v-if="row.type === 'A'">{{ getServerNameByIp(row.value) || '-' }}</span>
            <span v-else style="color:#999">-</span>
          </template>
        </el-table-column>
        <el-table-column prop="ttl" label="TTL" width="80" />
        <el-table-column label="状态" width="80">
          <template #default="{ row }">
            <el-tag :type="row.status === 'active' ? 'success' : 'danger'" size="small">
              {{ row.status === 'active' ? '启用' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.status === 'active'" type="warning" size="small" @click="toggleDnsRecordStatus(row, 'DISABLE')">停用</el-button>
            <el-button v-else type="success" size="small" @click="toggleDnsRecordStatus(row, 'ENABLE')">启用</el-button>
            <el-button type="danger" size="small" @click="deleteDnsRecord(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div style="margin-top:15px;display:flex;justify-content:flex-end">
        <el-pagination
          v-model:current-page="dnsCurrentPage"
          v-model:page-size="dnsPageSize"
          :page-sizes="[10, 20, 50, 100]"
          :total="filteredDnsRecords.length"
          layout="total, sizes, prev, pager, next"
          @size-change="dnsCurrentPage = 1"
        />
      </div>
    </el-dialog>

    <!-- 添加DNS记录对话框 -->
    <AppDialog v-model="addDnsRecordDialogVisible" title="添加DNS记录" width="450px" :loading="addingDnsRecord" confirm-text="添加" @confirm="addDnsRecord">
      <el-form :model="dnsRecordForm" label-width="100px">
        <el-form-item label="主机记录">
          <el-input v-model="dnsRecordForm.name" placeholder="例如: www, @, *" />
        </el-form-item>
        <el-form-item label="记录类型">
          <el-select v-model="dnsRecordForm.type" style="width:100%" @change="onDnsTypeChange">
            <el-option label="A" value="A" />
            <el-option label="CNAME" value="CNAME" />
            <el-option label="TXT" value="TXT" />
            <el-option label="MX" value="MX" />
            <el-option label="AAAA" value="AAAA" />
          </el-select>
        </el-form-item>
        <el-form-item label="服务器" v-if="dnsRecordForm.type === 'A'">
          <el-select v-model="dnsRecordForm.server_id" placeholder="选择服务器" clearable style="width:100%" @change="onDnsServerChange">
            <el-option v-for="s in availableServers" :key="s.id" :label="`${s.name} (${s.ip})${s.is_default === 1 ? ' (默认)' : ''}`" :value="s.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="记录值">
          <el-input v-model="dnsRecordForm.value" placeholder="IP地址或目标域名" />
        </el-form-item>
        <el-form-item label="TTL">
          <el-select v-model="dnsRecordForm.ttl" style="width:100%">
            <el-option label="1分钟" :value="60" />
            <el-option label="10分钟" :value="600" />
            <el-option label="30分钟" :value="1800" />
            <el-option label="1小时" :value="3600" />
          </el-select>
        </el-form-item>
      </el-form>
    </AppDialog>

    <!-- 批量发布证书对话框 -->
    <el-dialog v-model="batchPublishDialogVisible" title="批量发布证书" width="700px" append-to-body top="5vh">
      <div style="max-height:65vh;overflow-y:auto">
      <el-alert type="info" :closable="false" style="margin-bottom:20px">
        <template #title>
          <div style="font-size:13px;line-height:1.6">
            将本地已保存的证书批量发布到选定的服务器。支持同时发布到多台服务器。
          </div>
        </template>
      </el-alert>
      <el-form :model="batchPublishForm" label-width="100px">
        <el-form-item label="发布域名">
          <div style="display:flex;align-items:center;gap:10px">
            <el-tag type="info">{{ batchPublishTargetDomains.length }} 个域名</el-tag>
            <span style="color:#909399;font-size:12px">{{ selectedDomains.length ? '已勾选' : '当前筛选结果' }}</span>
          </div>
        </el-form-item>
        <el-form-item label="目标服务器">
          <el-checkbox-group v-model="batchPublishForm.server_ids">
            <el-checkbox
              v-for="s in availableServers"
              :key="s.id"
              :value="s.id"
              :label="s.id"
              style="display:flex;margin-bottom:6px"
            >
              {{ s.name }} ({{ s.ip }})
              <el-tag v-if="s.is_default === 1" type="warning" size="small" style="margin-left:5px">默认</el-tag>
            </el-checkbox>
          </el-checkbox-group>
          <div style="margin-top:8px">
            <el-button size="small" @click="selectAllServers">全选</el-button>
            <el-button size="small" @click="batchPublishForm.server_ids = []">清空</el-button>
          </div>
        </el-form-item>
        <el-form-item label="目标目录">
          <el-input v-model="batchPublishForm.target_dir_template" placeholder="/www/certs/{domain}">
            <template #append>{domain} = 域名</template>
          </el-input>
          <div style="margin-top:5px;color:#909399;font-size:12px">
            使用 {domain} 作为域名占位符，例如: /www/certs/{domain}
          </div>
        </el-form-item>
      </el-form>

      <!-- 发布结果 -->
      <div v-if="batchPublishLog" class="batch-log-box" style="margin-top:15px">{{ batchPublishLog }}</div>
      </div>

      <template #footer>
        <el-button @click="batchPublishDialogVisible = false">关闭</el-button>
        <el-button type="success" @click="executeBatchPublish" :loading="batchPublishing" :disabled="batchPublishForm.server_ids.length === 0">
          开始发布
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh, ArrowDown, Search, Plus, Loading, CircleCheck, CircleClose } from '@element-plus/icons-vue'
import { useDataStore } from '@/stores/data'
import { formatSslDays, getSslDaysType } from '@/utils'
import api from '@/api'
import SslDialog from '@/components/SslDialog.vue'

const router = useRouter()
const dataStore = useDataStore()

const dialogVisible = ref(false)
const sslDialogVisible = ref(false)
const dnsRecordsDialogVisible = ref(false)
const addDnsRecordDialogVisible = ref(false)
const saving = ref(false)
const loading = ref(false)
const refreshingSsl = ref(false)
const loadingDnsRecords = ref(false)
const addingDnsRecord = ref(false)
const currentDomain = ref(null)
const searchKeyword = ref('')
const filterTag = ref('')
const filterStatus = ref('')
const dnsSearchKeyword = ref('')
const form = reactive({ id: null, domain: '', aliyun_config_id: null, tagList: [], expire_at: null })
const selectedDomains = ref([])
const batchSslDialogVisible = ref(false)
const batchSslForm = reactive({ cert_type: 'letsencrypt' })

// 多任务管理
const batchSslTasks = ref([]) // 所有批量任务列表
const activeTaskTab = ref('') // 当前激活的任务Tab
const batchSslPolling = ref(null) // 轮询定时器
const startingBatchSsl = ref(false)
const refreshingTask = ref(false)
const retryingTask = ref(false)

// 当前任务（用于显示）
const currentBatchTask = computed(() => {
  if (!activeTaskTab.value) return null
  return batchSslTasks.value.find(t => t.job_id === activeTaskTab.value)
})

// 是否有正在运行的任务
const hasRunningTask = computed(() => {
  return batchSslTasks.value.some(t => t.status === 'running' || t.status === 'pending')
})

// 是否有已完成的任务（可清空）
const hasCompletedTasks = computed(() => {
  return batchSslTasks.value.some(t => 
    t.status === 'completed' || t.status === 'completed_with_errors' || t.status === 'error'
  )
})

// 兼容旧代码的batchSsl对象
const batchSsl = computed(() => currentBatchTask.value || {
  job_id: '',
  status: 'idle',
  total: 0,
  done: 0,
  success: 0,
  failed: 0,
  log: '',
  results: []
})

const isBatchSslRunning = computed(() => {
  return currentBatchTask.value && ['pending', 'running'].includes(currentBatchTask.value.status)
})

const batchSslProgress = computed(() => {
  if (!currentBatchTask.value || !currentBatchTask.value.total) return 0
  return Math.min(100, Math.round((currentBatchTask.value.done / currentBatchTask.value.total) * 100))
})

const dnsRecords = reactive({ platform: '', records: [] })
const dnsRecordForm = reactive({ name: '', type: 'A', value: '', ttl: 600, server_id: null })
const dnsCurrentPage = ref(1)
const dnsPageSize = ref(10)

// 批量发布证书
const batchPublishDialogVisible = ref(false)
const batchPublishing = ref(false)
const batchPublishLog = ref('')
const batchPublishForm = reactive({
  server_ids: [],
  target_dir_template: '/www/certs/{domain}'
})

const availableServers = computed(() => dataStore.servers.filter(s => s.status !== 'disabled'))

function getDefaultAvailableServer() {
  return availableServers.value.find(s => s.is_default === 1) || availableServers.value[0] || null
}

const filteredDnsRecords = computed(() => {
  let records = dnsRecords.records
  
  // 搜索过滤
  if (dnsSearchKeyword.value) {
    const kw = dnsSearchKeyword.value.toLowerCase()
    records = records.filter(r => 
      r.name?.toLowerCase().includes(kw) ||
      r.value?.toLowerCase().includes(kw) ||
      r.type?.toLowerCase().includes(kw)
    )
  }
  
  return records
})

const paginatedDnsRecords = computed(() => {
  const start = (dnsCurrentPage.value - 1) * dnsPageSize.value
  return filteredDnsRecords.value.slice(start, start + dnsPageSize.value)
})

function getServerNameByIp(ip) {
  const server = dataStore.servers.find(s => s.ip === ip)
  return server?.name || ''
}

const filteredDomains = computed(() => {
  let list = dataStore.domains
  if (filterStatus.value) {
    list = list.filter(d => d.status === filterStatus.value)
  }
  if (searchKeyword.value) {
    const kw = searchKeyword.value.toLowerCase()
    list = list.filter(d => 
      d.domain?.toLowerCase().includes(kw) ||
      d.aliyun_name?.toLowerCase().includes(kw) ||
      d.tags?.toLowerCase().includes(kw)
    )
  }
  if (filterTag.value) {
    list = list.filter(d => {
      const tags = d.tags ? d.tags.split(',').map(t => t.trim()) : []
      return tags.includes(filterTag.value)
    })
  }
  return list
})

const batchTargetDomains = computed(() => selectedDomains.value.length > 0 ? selectedDomains.value : filteredDomains.value)

onMounted(() => {
  loadData()
  dataStore.loadAliyunConfigs()
  dataStore.loadServerTags()
  dataStore.loadServers()
})

onUnmounted(() => {
  stopBatchSslPolling()
})

async function loadData() {
  loading.value = true
  try {
    await dataStore.loadDomains()
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

function getSslStatusType(status) {
  const types = { active: 'success', issuing: 'warning', renewing: 'warning', error: 'danger' }
  return types[status] || 'info'
}

function getSslStatusText(status) {
  const texts = { active: '已启用', issuing: '申请中', renewing: '续期中', error: '失败' }
  return texts[status] || '未申请'
}

function openDialog(row = null) {
  if (row) {
    Object.assign(form, { 
      id: row.id, 
      domain: row.domain, 
      aliyun_config_id: row.aliyun_config_id, 
      tagList: parseTags(row.tags),
      expire_at: row.expire_at || null
    })
  } else {
    const defaultConfig = dataStore.aliyunConfigs.find(c => c.is_default === 1)
    const defaultTag = dataStore.serverTags.find(t => t.is_default === 1)
    Object.assign(form, { 
      id: null, 
      domain: '', 
      aliyun_config_id: defaultConfig?.id || null, 
      tagList: defaultTag ? [defaultTag.name] : [],
      expire_at: null
    })
  }
  dialogVisible.value = true
}

function openSslDialog(row) {
  currentDomain.value = row
  sslDialogVisible.value = true
}

function viewSubdomains(row) {
  router.push({ path: '/admin-jm/subdomains', query: { domain_id: row.id } })
}

async function handleSave() {
  saving.value = true
  try {
    const data = { 
      aliyun_config_id: form.aliyun_config_id, 
      tags: form.tagList.join(','),
      expire_at: form.expire_at || null
    }
    if (form.id) {
      await api.put(`/dns/domains/${form.id}`, data)
    } else {
      await api.post('/dns/domains', { ...form, tags: form.tagList.join(','), expire_at: form.expire_at || null })
    }
    ElMessage.success('保存成功')
    dialogVisible.value = false
    dataStore.loadDomains()
  } finally {
    saving.value = false
  }
}

async function handleDelete(id) {
  await ElMessageBox.confirm('确定删除此域名？', '提示')
  await api.delete(`/dns/domains/${id}`)
  ElMessage.success('删除成功')
  dataStore.loadDomains()
}

async function toggleDomainStatus(row) {
  const newStatus = row.status === 'disabled' ? 'active' : 'disabled'
  const action = newStatus === 'disabled' ? '禁用' : '启用'
  await ElMessageBox.confirm(`确定${action}域名 ${row.domain}？`, '提示')
  await api.put(`/dns/domains/${row.id}/status`, { status: newStatus })
  ElMessage.success(`已${action}`)
  dataStore.loadDomains()
}

async function setDefault(row) {
  await api.post(`/dns/domains/${row.id}/set-default`)
  ElMessage.success('已设为默认')
  dataStore.loadDomains()
}

async function refreshAllSsl() {
  refreshingSsl.value = true
  try {
    await api.post('/ssl/check-all')
    await dataStore.loadDomains()
    ElMessage.success('证书状态已更新')
  } finally {
    refreshingSsl.value = false
  }
}

function getBatchStatusText(status) {
  const map = {
    idle: '未开始',
    pending: '等待中',
    running: '执行中',
    completed: '已完成',
    completed_with_errors: '部分失败',
    error: '异常'
  }
  return map[status] || status || '未开始'
}

function getBatchStatusType(status) {
  if (status === 'completed') return 'success'
  if (status === 'completed_with_errors' || status === 'error') return 'danger'
  if (status === 'running' || status === 'pending') return 'warning'
  return 'info'
}

function getTaskProgress(task) {
  if (!task || !task.total) return 0
  return Math.min(100, Math.round((task.done / task.total) * 100))
}

function openBatchSslDialog() {
  batchSslDialogVisible.value = true
  // 加载历史任务
  loadHistoryTasks()
}

async function loadHistoryTasks() {
  try {
    const res = await api.get('/ssl/batch-jobs?limit=10')
    const serverJobIds = new Set(res.map(j => j.job_id))
    
    // 移除服务器上已不存在的任务（保留正在运行的本地任务，避免误删刚启动的任务）
    batchSslTasks.value = batchSslTasks.value.filter(t => 
      serverJobIds.has(t.job_id) || t.status === 'pending' || t.status === 'running'
    )
    
    // 同步/添加服务器上的任务
    for (const job of res) {
      const existing = batchSslTasks.value.find(t => t.job_id === job.job_id)
      if (existing) {
        // 更新现有任务的状态
        Object.assign(existing, {
          status: job.status,
          total: job.total,
          done: job.done,
          success: job.success,
          failed: job.failed,
          updated_at: job.updated_at,
          finished_at: job.finished_at
        })
      } else {
        batchSslTasks.value.push({
          job_id: job.job_id,
          status: job.status,
          total: job.total,
          done: job.done,
          success: job.success,
          failed: job.failed,
          log: '',  // 不加载日志，点击Tab时再加载
          results: [],
          created_at: job.created_at,
          updated_at: job.updated_at
        })
      }
    }
    
    // 按创建时间排序（最新的在最后）
    batchSslTasks.value.sort((a, b) => 
      new Date(a.created_at || 0) - new Date(b.created_at || 0)
    )
    
    // 如果有任务且当前没有激活的Tab，默认显示最新的任务
    if (batchSslTasks.value.length > 0 && !activeTaskTab.value) {
      activeTaskTab.value = batchSslTasks.value[batchSslTasks.value.length - 1].job_id
      // 加载该任务的详细信息
      await refreshCurrentTask()
    }
  } catch (err) {
    console.error('加载历史任务失败:', err)
  }
}

function backToNewTask() {
  activeTaskTab.value = ''
}

async function removeTask(jobId) {
  const task = batchSslTasks.value.find(t => t.job_id === jobId)
  if (!task) return
  
  // 运行中的任务不允许删除
  if (task.status === 'running' || task.status === 'pending') {
    ElMessage.warning('任务正在运行中，不能删除')
    return
  }
  
  try {
    await ElMessageBox.confirm('确定删除该任务记录？删除后不可恢复', '删除任务', {
      type: 'warning'
    })
  } catch (e) {
    return
  }
  
  try {
    await api.delete(`/ssl/batch-issue/${jobId}`)
    
    // 从内存中删除
    const index = batchSslTasks.value.findIndex(t => t.job_id === jobId)
    if (index > -1) {
      batchSslTasks.value.splice(index, 1)
      // 如果删除的是当前任务，切换到其他任务或新建页面
      if (activeTaskTab.value === jobId) {
        if (batchSslTasks.value.length > 0) {
          activeTaskTab.value = batchSslTasks.value[batchSslTasks.value.length - 1].job_id
        } else {
          activeTaskTab.value = ''
        }
      }
    }
    ElMessage.success('已删除')
  } catch (err) {
    ElMessage.error(err.message || '删除失败')
  }
}

async function clearCompletedTasks() {
  try {
    await ElMessageBox.confirm('确定清空所有已完成的任务？', '清空任务', {
      type: 'warning'
    })
  } catch (e) {
    return
  }
  
  try {
    const res = await api.delete('/ssl/batch-jobs/clear')
    
    // 从内存中移除已完成的任务
    batchSslTasks.value = batchSslTasks.value.filter(t => 
      t.status === 'running' || t.status === 'pending'
    )
    
    // 如果当前激活任务被清空，切换到新建页面
    if (activeTaskTab.value && !batchSslTasks.value.find(t => t.job_id === activeTaskTab.value)) {
      activeTaskTab.value = batchSslTasks.value.length > 0 
        ? batchSslTasks.value[batchSslTasks.value.length - 1].job_id 
        : ''
    }
    
    ElMessage.success(`已清空 ${res.count || 0} 个任务`)
  } catch (err) {
    ElMessage.error(err.message || '清空失败')
  }
}

function stopBatchSslPolling() {
  if (batchSslPolling.value) {
    clearInterval(batchSslPolling.value)
    batchSslPolling.value = null
  }
}

async function loadBatchSslJob() {
  // 轮询所有运行中的任务
  const runningTasks = batchSslTasks.value.filter(t => t.status === 'running' || t.status === 'pending')
  
  for (const task of runningTasks) {
    // 检查 job_id 是否有效
    if (!task.job_id) {
      console.error('任务缺少 job_id:', task)
      continue
    }
    
    try {
      const res = await api.get(`/ssl/batch-issue/${task.job_id}`)
      Object.assign(task, {
        status: res.status,
        total: res.total || 0,
        done: res.done || 0,
        success: res.success || 0,
        failed: res.failed || 0,
        log: res.log || '',
        results: res.results || [],
        updated_at: res.updated_at
      })
      
      // 如果是当前显示的任务，滚动日志到底部
      if (activeTaskTab.value === task.job_id) {
        await nextTick()
        const box = document.querySelector('.batch-log-box')
        if (box) box.scrollTop = box.scrollHeight
      }
    } catch (err) {
      // 任务不存在或已过期
      if (err.message?.includes('不存在') || err.message?.includes('过期')) {
        task.status = 'error'
        task.log = task.log + `\n[${formatDateTime(new Date())}] 任务已过期或服务器已重启，任务信息已丢失。\n提示：批量任务在24小时后会自动清理，服务器重启也会导致任务丢失。\n`
      } else {
        console.error('加载任务失败:', err)
      }
    }
  }
  
  // 如果没有运行中的任务，停止轮询
  if (runningTasks.length === 0) {
    stopBatchSslPolling()
    await dataStore.loadDomains()
  }
}

async function refreshCurrentTask() {
  if (!currentBatchTask.value) return
  if (!currentBatchTask.value.job_id) {
    ElMessage.error('任务ID无效')
    return
  }
  
  refreshingTask.value = true
  try {
    const res = await api.get(`/ssl/batch-issue/${currentBatchTask.value.job_id}`)
    Object.assign(currentBatchTask.value, {
      status: res.status,
      total: res.total || 0,
      done: res.done || 0,
      success: res.success || 0,
      failed: res.failed || 0,
      log: res.log || '',
      results: res.results || [],
      updated_at: res.updated_at
    })
    await nextTick()
    const box = document.querySelector('.batch-log-box')
    if (box) box.scrollTop = box.scrollHeight
    ElMessage.success('刷新成功')
  } catch (err) {
    ElMessage.error(err.message || '刷新失败')
  } finally {
    refreshingTask.value = false
  }
}

// 判断任务是否可重试
function isTaskRetryable(task) {
  return task && ['error', 'completed_with_errors'].includes(task.status)
}

// 重试批量任务
async function retryBatchTask(task, mode) {
  const modeText = { remaining: '从中断位置继续', failed: '仅重试失败项', all: '全部重新执行' }
  try {
    await ElMessageBox.confirm(`确定${modeText[mode]}？`, '重试任务')
  } catch (e) {
    return
  }

  retryingTask.value = true
  try {
    const res = await api.post(`/ssl/batch-issue/${task.job_id}/retry`, {
      mode,
      cert_type: batchSslForm.cert_type
    })
    
    // 创建新任务并切换到新任务
    const newTask = {
      job_id: res.job_id,
      status: 'pending',
      total: res.total || 0,
      done: 0,
      success: 0,
      failed: 0,
      log: '',
      results: [],
      created_at: formatDateTime(new Date())
    }
    
    batchSslTasks.value.push(newTask)
    activeTaskTab.value = newTask.job_id
    
    // 启动轮询
    stopBatchSslPolling()
    batchSslPolling.value = setInterval(loadBatchSslJob, 1000)
    await loadBatchSslJob()
    
    ElMessage.success(res.message || '重试任务已启动')
  } catch (err) {
    ElMessage.error(err.message || '重试失败')
  } finally {
    retryingTask.value = false
  }
}

async function startBatchSsl() {
  const targets = batchTargetDomains.value
  if (targets.length === 0) {
    ElMessage.warning('没有可获取证书的域名')
    return
  }

  try {
    await ElMessageBox.confirm(`确定后台获取 ${targets.length} 个域名的通配符证书？`, '批量获取证书')
  } catch (e) {
    return
  }

  startingBatchSsl.value = true
  try {
    const res = await api.post('/ssl/batch-issue', {
      domain_ids: targets.map(item => item.id),
      cert_type: batchSslForm.cert_type
    })
    
    // 创建新任务
    const newTask = {
      job_id: res.job_id,
      status: 'pending',
      total: res.total || targets.length,
      done: 0,
      success: 0,
      failed: 0,
      log: res.message ? `[${formatDateTime(new Date())}] ${res.message}\n` : '',
      results: [],
      created_at: formatDateTime(new Date())
    }
    
    batchSslTasks.value.push(newTask)
    activeTaskTab.value = newTask.job_id
    
    // 启动轮询
    stopBatchSslPolling()
    batchSslPolling.value = setInterval(loadBatchSslJob, 1000)
    await loadBatchSslJob()
    
    ElMessage.success(res.message || '已开始后台获取证书')
  } catch (err) {
    ElMessage.error(err.message || '启动失败')
  } finally {
    startingBatchSsl.value = false
  }
}

// DNS记录相关
async function openDnsRecordsDialog(row) {
  currentDomain.value = row
  dnsRecords.platform = ''
  dnsRecords.records = []
  dnsRecordsDialogVisible.value = true
  await loadDnsRecords()
}

async function loadDnsRecords() {
  if (!currentDomain.value) return
  loadingDnsRecords.value = true
  try {
    const res = await api.get(`/dns/domains/${currentDomain.value.id}/dns-records`)
    dnsRecords.platform = res.platform
    dnsRecords.records = res.records
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loadingDnsRecords.value = false
  }
}

function openAddDnsRecordDialog() {
  const defaultServer = getDefaultAvailableServer()
  Object.assign(dnsRecordForm, { 
    name: '', 
    type: 'A', 
    value: defaultServer?.ip || '', 
    ttl: 600,
    server_id: defaultServer?.id || null
  })
  addDnsRecordDialogVisible.value = true
}

function onDnsServerChange() {
  const server = dataStore.servers.find(s => s.id === dnsRecordForm.server_id)
  if (server) {
    dnsRecordForm.value = server.ip
  }
}

function onDnsTypeChange() {
  if (dnsRecordForm.type === 'A') {
    const defaultServer = getDefaultAvailableServer()
    dnsRecordForm.server_id = defaultServer?.id || null
    dnsRecordForm.value = defaultServer?.ip || ''
  } else {
    dnsRecordForm.server_id = null
    dnsRecordForm.value = ''
  }
}

async function addDnsRecord() {
  if (!dnsRecordForm.name || !dnsRecordForm.value) {
    ElMessage.warning('请填写主机记录和记录值')
    return
  }
  addingDnsRecord.value = true
  try {
    await api.post(`/dns/domains/${currentDomain.value.id}/dns-records`, dnsRecordForm)
    ElMessage.success('添加成功')
    addDnsRecordDialogVisible.value = false
    loadDnsRecords()
  } finally {
    addingDnsRecord.value = false
  }
}

async function deleteDnsRecord(row) {
  await ElMessageBox.confirm(`确定删除记录 "${row.name}" ?`, '提示')
  try {
    await api.delete(`/dns/domains/${currentDomain.value.id}/dns-records/${row.id}`)
    ElMessage.success('删除成功')
    loadDnsRecords()
  } catch (e) {
    ElMessage.error(e.message)
  }
}

async function toggleDnsRecordStatus(row, status) {
  try {
    await api.put(`/dns/domains/${currentDomain.value.id}/dns-records/${row.id}/status`, { status })
    ElMessage.success(status === 'ENABLE' ? '已启用' : '已停用')
    loadDnsRecords()
  } catch (e) {
    ElMessage.error(e.message)
  }
}

// 批量发布证书相关
const batchPublishTargetDomains = computed(() => selectedDomains.value.length > 0 ? selectedDomains.value : filteredDomains.value)

function openBatchPublishDialog() {
  batchPublishLog.value = ''
  // 收集待发布域名的所有标签
  const targets = batchPublishTargetDomains.value
  const domainTags = new Set()
  for (const d of targets) {
    if (d.tags) {
      d.tags.split(',').map(t => t.trim()).filter(Boolean).forEach(t => domainTags.add(t))
    }
  }
  
  // 根据域名标签匹配服务器
  if (domainTags.size > 0) {
    const matchedServers = availableServers.value.filter(s => {
      const serverTags = s.tags ? s.tags.split(',').map(t => t.trim()) : []
      return serverTags.some(t => domainTags.has(t))
    })
    batchPublishForm.server_ids = matchedServers.map(s => s.id)
  } else {
    // 域名没有标签时，默认选中默认服务器
    const defaultServer = availableServers.value.find(s => s.is_default === 1)
    batchPublishForm.server_ids = defaultServer ? [defaultServer.id] : []
  }
  batchPublishDialogVisible.value = true
}

function selectAllServers() {
  batchPublishForm.server_ids = availableServers.value.map(s => s.id)
}

async function executeBatchPublish() {
  const targets = batchPublishTargetDomains.value
  if (targets.length === 0) {
    ElMessage.warning('没有可发布的域名')
    return
  }
  if (batchPublishForm.server_ids.length === 0) {
    ElMessage.warning('请选择目标服务器')
    return
  }

  try {
    await ElMessageBox.confirm(
      `确定将 ${targets.length} 个域名的证书发布到 ${batchPublishForm.server_ids.length} 台服务器？`,
      '批量发布证书'
    )
  } catch (e) {
    return
  }

  batchPublishing.value = true
  batchPublishLog.value = ''
  try {
    const res = await api.post('/ssl/batch-publish', {
      domain_ids: targets.map(d => d.id),
      server_ids: batchPublishForm.server_ids,
      target_dir_template: batchPublishForm.target_dir_template || '/www/certs/{domain}'
    })
    batchPublishLog.value = res.log || ''
    ElMessage.success(`发布完成: 成功 ${res.success_count} 个, 失败 ${res.failed_count} 个`)
  } catch (err) {
    batchPublishLog.value = err.data?.log || err.message || '发布失败'
    ElMessage.error(err.message || '发布失败')
  } finally {
    batchPublishing.value = false
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

.full-domain {
  color: #409eff;
  font-weight: 600;
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

.batch-ssl-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.batch-ssl-label {
  color: #606266;
  margin-right: 8px;
  font-size: 13px;
}

.batch-ssl-muted {
  color: #909399;
  margin-left: 8px;
  font-size: 12px;
}

.batch-ssl-counts {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 12px;
  color: #606266;
  font-size: 13px;
}

.batch-ssl-counts .success {
  color: #67c23a;
}

.batch-ssl-counts .failed {
  color: #f56c6c;
}

.batch-retry-actions {
  display: flex;
  gap: 10px;
  margin-bottom: 12px;
  padding: 12px;
  background: #fef0f0;
  border-radius: 6px;
  border: 1px solid #fde2e2;
}

.batch-log-box {
  background: #1e1e1e;
  color: #d4d4d4;
  padding: 14px;
  border-radius: 6px;
  min-height: 260px;
  max-height: 420px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
  font-family: monospace;
  font-size: 12px;
  line-height: 1.6;
}

.batch-ssl-new-task {
  padding: 20px;
  background: #f8f9fa;
  border-radius: 8px;
  min-height: 300px;
}

.batch-ssl-tasks {
  min-height: 400px;
}

.batch-task-content {
  padding: 15px 0;
}

:deep(.el-tabs__item) {
  padding: 0 15px !important;
}

:deep(.el-tabs__content) {
  padding: 0;
}

:deep(.is-loading) {
  animation: rotating 2s linear infinite;
}

@keyframes rotating {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
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
    gap: 12px;
  }

  .card-title > div {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    width: 100%;
  }

  .card-title > div .el-input {
    width: 100% !important;
    margin-right: 0 !important;
  }

  .card-title > div .el-button {
    flex: 1;
    min-width: 0;
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
    line-height: 1.4;
  }

  /* 隐藏部分列 */
  :deep(.el-table__column--selection) {
    display: none;
  }

  /* 操作按钮优化 */
  :deep(.el-button + .el-button) {
    margin-left: 5px;
  }

  :deep(.el-button--small) {
    padding: 5px 8px;
    font-size: 12px;
  }

  /* 分页器移动端优化 */
  :deep(.el-pagination) {
    justify-content: center;
    flex-wrap: wrap;
    gap: 5px;
  }

  :deep(.el-pagination .el-pagination__sizes) {
    margin: 0;
  }

  :deep(.el-pagination .el-pagination__jump) {
    margin-left: 0;
  }

  /* 对话框移动端全屏 */
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

  /* DNS记录对话框优化 */
  :deep(.el-table__fixed-right) {
    right: 0 !important;
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

  :deep(.el-tag--small) {
    padding: 0 4px;
    font-size: 11px;
  }
}
</style>
