<template>
  <div class="card">
    <div class="card-title">
      <span>
        子域名列表
        <el-tag v-if="currentDomain" type="info" style="margin-left:10px">{{ currentDomain.domain }}</el-tag>
      </span>
      <div class="toolbar">
        <el-input v-model="searchKeyword" placeholder="搜索域名" clearable style="width:150px" size="small" />
        <el-select v-model="filterDomainId" placeholder="筛选域名" clearable style="width:180px" size="small" @change="onFilterChange">
          <el-option v-for="d in dataStore.domains" :key="d.id" :label="d.domain" :value="d.id" />
        </el-select>
        <el-dropdown v-if="selectedRows.length > 0" trigger="click">
          <el-button type="warning" size="small">
            批量操作 ({{ selectedRows.length }})<el-icon class="el-icon--right"><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item @click="batchSetStatus('used')">批量设为已使用</el-dropdown-item>
              <el-dropdown-item @click="batchSetStatus('unused')">批量设为未使用</el-dropdown-item>
              <el-dropdown-item @click="batchSetStatus('disabled')">批量停用</el-dropdown-item>
              <el-dropdown-item divided @click="openBatchRenewDialog">批量续费</el-dropdown-item>
              <el-dropdown-item divided @click="batchDelete" style="color:#f56c6c">批量删除</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-button size="small" @click="loadData" :loading="loading"><el-icon><Refresh /></el-icon></el-button>
        <el-button type="primary" size="small" @click="openDialog()">添加子域名</el-button>
        <el-button type="success" size="small" @click="openBatchDialog">批量生成</el-button>
      </div>
    </div>
    <el-table :data="filteredSubdomains" stripe @selection-change="onSelectionChange">
      <el-table-column type="selection" width="45" />
      <el-table-column label="完整域名" min-width="120">
        <template #default="{ row }">
          <a v-if="row.ftp_auth_code" :href="getUploadUrl(row)" target="_blank" class="full-domain">{{ row.subdomain }}.{{ row.main_domain }}</a>
          <span v-else class="full-domain" style="cursor:default">{{ row.subdomain }}.{{ row.main_domain }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="record_type" label="类型" width="70" />
      <el-table-column prop="record_value" label="记录值" min-width="66" />
      <el-table-column prop="server_name" label="服务器" width="120" show-overflow-tooltip />
      <el-table-column label="使用状态" width="90">
        <template #default="{ row }">
          <el-tag :type="getUseStatusType(row.use_status)" size="small">{{ getUseStatusText(row.use_status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="到期时间" width="100">
        <template #default="{ row }">
          <template v-if="row.expire_at">
            <span :style="{ color: isExpired(row.expire_at) ? '#f56c6c' : getRemainingDays(row.expire_at) <= 7 ? '#e6a23c' : '#67c23a', fontSize: '12px' }">
              {{ isExpired(row.expire_at) ? '已过期' : '剩余 ' + getRemainingDays(row.expire_at) + ' 天' }}
            </span>
          </template>
          <span v-else style="color:#999;font-size:12px">-</span>
        </template>
      </el-table-column>
      <el-table-column prop="status" label="DNS" width="80">
        <template #default="{ row }">
          <el-tag :type="row.status === 'active' ? 'success' : row.status === 'dns_error' ? 'danger' : 'warning'" size="small">{{ row.status }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="created_at" label="创建时间" width="160">
        <template #default="{ row }">
          <span style="font-size:12px;color:#909399">{{ row.created_at }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="remark" label="备注" min-width="120">
        <template #default="{ row }">
          <el-tooltip v-if="row.remark" :content="row.remark" placement="top">
            <span class="remark-text" @dblclick="openRemarkDialog(row)">{{ row.remark }}</span>
          </el-tooltip>
          <span v-else style="color:#999;cursor:pointer" @dblclick="openRemarkDialog(row)">-</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="220" fixed="right">
        <template #default="{ row }">
          <el-button v-if="row.ftp_auth_code" type="primary" size="small" @click="handleShare(row)">分享</el-button>
          <el-button type="success" size="small" @click="openNginxDialog(row)">Nginx</el-button>
          <el-dropdown trigger="click" style="margin-left:8px">
            <el-button size="small">更多<el-icon class="el-icon--right"><ArrowDown /></el-icon></el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="openRemarkDialog(row)">修改备注</el-dropdown-item>
                <el-dropdown-item @click="openStatusDialog(row)">状态/续费</el-dropdown-item>
                <el-dropdown-item @click="openDialog(row)">编辑</el-dropdown-item>
                <el-dropdown-item v-if="row.use_status !== 'disabled'" @click="handleDisable(row)">停用</el-dropdown-item>
                <el-dropdown-item v-if="row.use_status === 'disabled'" @click="handleEnable(row)">启用</el-dropdown-item>
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
        :page-sizes="[10, 20, 50, 100]"
        :total="dataStore.subdomainsTotal"
        layout="total, sizes, prev, pager, next, jumper"
        @size-change="onSizeChange"
        @current-change="onPageChange"
      />
    </div>

    <!-- 添加/编辑对话框 -->
    <el-dialog v-model="dialogVisible" :title="form.id ? '编辑子域名' : '添加子域名'" width="550px">
      <el-form :model="form" label-width="110px">
        <el-form-item label="主域名">
          <el-select v-model="form.domain_id" placeholder="选择主域名" style="width:100%" :disabled="!!form.id">
            <el-option v-for="d in dataStore.domains" :key="d.id" :label="d.domain + (d.is_default === 1 ? ' (默认)' : '')" :value="d.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="子域名">
          <div style="display:flex;align-items:center;width:100%">
            <el-input v-model="form.subdomain" placeholder="例如: lyxxxx" :disabled="!!form.id" style="flex:1">
              <template #append v-if="form.domain_id">.{{ dataStore.domains.find(d => d.id === form.domain_id)?.domain }}</template>
            </el-input>
            <el-button v-if="!form.id" type="primary" @click="refreshSubdomain" style="margin-left:10px" :loading="refreshing">随机生成</el-button>
          </div>
        </el-form-item>
        <el-form-item label="生成规则" v-if="!form.id">
          <div style="display:flex;gap:8px;align-items:center">
            <el-input v-model="form.prefix" placeholder="前缀" style="width:70px" size="small" />
            <span style="color:#999;font-size:12px">+随机+</span>
            <el-input v-model="form.suffix" placeholder="后缀" style="width:70px" size="small" />
            <span style="color:#999;font-size:12px">总长</span>
            <el-input-number v-model="form.subdomain_length" :min="3" :max="20" size="small" style="width:90px" />
          </div>
        </el-form-item>
        <el-form-item label="服务器" v-if="form.record_type === 'A'">
          <el-select v-model="form.server_id" placeholder="选择服务器" clearable style="width:100%" @change="onServerChange">
            <el-option v-for="s in dataStore.servers" :key="s.id" :label="`${s.name} (${s.ip})${s.is_default === 1 ? ' (默认)' : ''}`" :value="s.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="记录值">
          <el-input v-model="form.record_value" placeholder="IP地址或CNAME目标" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" placeholder="可选备注信息" />
        </el-form-item>
        <el-form-item label="有效期" v-if="!form.id">
          <div style="display:flex;gap:10px;align-items:center">
            <el-input-number v-model="form.duration_value" :min="1" :max="100" style="width:100px" />
            <el-select v-model="form.duration_unit" style="width:80px">
              <el-option label="天" value="day" />
              <el-option label="月" value="month" />
              <el-option label="年" value="year" />
            </el-select>
            <span style="color:#909399;font-size:12px">（用户首次登录后开始计算）</span>
          </div>
        </el-form-item>
        <el-form-item label="自动创建FTP" v-if="!form.id">
          <el-switch v-model="form.auto_ftp" />
        </el-form-item>
        <el-form-item label="自动配置Nginx" v-if="!form.id">
          <el-switch v-model="form.auto_nginx" />
          <el-select v-model="form.nginx_type" style="width:120px;margin-left:10px" v-if="form.auto_nginx">
            <el-option label="HTTPS" value="https" />
            <el-option label="HTTP" value="http" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSave" :loading="saving">确定</el-button>
      </template>
    </el-dialog>

    <!-- 批量生成对话框 -->
    <el-dialog v-model="batchDialogVisible" title="批量生成子域名" width="600px">
      <el-form :model="batchForm" label-width="110px">
        <el-form-item label="主域名">
          <el-select v-model="batchForm.domain_id" placeholder="选择主域名" style="width:100%">
            <el-option v-for="d in dataStore.domains" :key="d.id" :label="d.domain + (d.is_default === 1 ? ' (默认)' : '')" :value="d.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="服务器">
          <el-select v-model="batchForm.server_id" placeholder="选择服务器" style="width:100%">
            <el-option v-for="s in dataStore.servers" :key="s.id" :label="`${s.name} (${s.ip})${s.is_default === 1 ? ' (默认)' : ''}`" :value="s.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="生成规则">
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <el-input v-model="batchForm.prefix" placeholder="前缀" style="width:80px">
              <template #prepend>前缀</template>
            </el-input>
            <span style="color:#999">+ 随机字母 +</span>
            <el-input v-model="batchForm.suffix" placeholder="后缀" style="width:80px">
              <template #prepend>后缀</template>
            </el-input>
          </div>
        </el-form-item>
        <el-form-item label="总长度">
          <el-input-number v-model="batchForm.subdomain_length" :min="3" :max="20" />
          <span style="margin-left:10px;color:#999">
            预览: {{ batchForm.prefix }}{{ 'x'.repeat(Math.max(1, batchForm.subdomain_length - batchForm.prefix.length - batchForm.suffix.length)) }}{{ batchForm.suffix }}
          </span>
        </el-form-item>
        <el-form-item label="生成数量">
          <el-input-number v-model="batchForm.count" :min="1" :max="100" :step="5" />
          <span style="margin-left:10px;color:#999">最多100个</span>
        </el-form-item>
        <el-form-item label="有效期">
          <div style="display:flex;gap:10px;align-items:center">
            <el-input-number v-model="batchForm.duration_value" :min="1" :max="100" style="width:100px" />
            <el-select v-model="batchForm.duration_unit" style="width:80px">
              <el-option label="天" value="day" />
              <el-option label="月" value="month" />
              <el-option label="年" value="year" />
            </el-select>
            <span style="color:#909399;font-size:12px">（用户首次登录后开始计算）</span>
          </div>
        </el-form-item>
        <el-form-item label="自动创建FTP">
          <el-switch v-model="batchForm.auto_ftp" />
        </el-form-item>
        <el-form-item label="自动配置Nginx">
          <el-switch v-model="batchForm.auto_nginx" />
          <el-select v-model="batchForm.nginx_type" style="width:120px;margin-left:10px" v-if="batchForm.auto_nginx">
            <el-option label="HTTPS" value="https" />
            <el-option label="HTTP" value="http" />
          </el-select>
        </el-form-item>
      </el-form>
      <div v-if="batchResults.length > 0" style="margin-top:20px">
        <el-divider>生成结果</el-divider>
        <el-table :data="batchResults" size="small" stripe max-height="300">
          <el-table-column prop="subdomain" label="域名" min-width="180" />
          <el-table-column label="FTP用户" width="120">
            <template #default="{ row }">{{ row.ftp?.username || '-' }}</template>
          </el-table-column>
          <el-table-column label="授权码" width="100">
            <template #default="{ row }">
              <span style="color:#e6a23c;font-weight:bold">{{ row.ftp?.auth_code || '-' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="80">
            <template #default="{ row }">
              <el-tag :type="row.success ? 'success' : 'danger'" size="small">{{ row.success ? '成功' : '失败' }}</el-tag>
            </template>
          </el-table-column>
        </el-table>
      </div>
      <template #footer>
        <el-button @click="batchDialogVisible = false">关闭</el-button>
        <el-button type="primary" @click="handleBatchCreate" :loading="batchCreating">开始生成</el-button>
      </template>
    </el-dialog>

    <!-- Nginx配置对话框 -->
    <NginxDialog v-model="nginxDialogVisible" :subdomain="currentSubdomain" @refresh="loadData" />

    <!-- 状态/续费对话框 -->
    <el-dialog v-model="statusDialogVisible" title="状态管理 / 续费" width="450px">
      <el-form :model="statusForm" label-width="100px">
        <el-form-item label="域名">
          <span class="full-domain">{{ statusForm.fullDomain }}</span>
        </el-form-item>
        <el-form-item label="当前状态">
          <el-tag :type="getUseStatusType(statusForm.use_status)">{{ getUseStatusText(statusForm.use_status) }}</el-tag>
        </el-form-item>
        <el-form-item label="到期时间">
          <span v-if="statusForm.expire_at" :style="{ color: isExpired(statusForm.expire_at) ? '#f56c6c' : '#67c23a' }">
            {{ statusForm.expire_at }}
            <el-tag v-if="isExpired(statusForm.expire_at)" type="danger" size="small" style="margin-left:8px">已过期</el-tag>
          </span>
          <span v-else style="color:#999">未设置</span>
        </el-form-item>
        <el-divider>修改状态</el-divider>
        <el-form-item label="使用状态">
          <el-radio-group v-model="statusForm.new_status">
            <el-radio-button value="unused">未使用</el-radio-button>
            <el-radio-button value="used">已使用</el-radio-button>
            <el-radio-button value="disabled">停用</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-divider>续费</el-divider>
        <el-form-item label="续费时长">
          <el-select v-model="statusForm.duration" placeholder="选择时长" style="width:100%">
            <el-option label="1个月" :value="1" />
            <el-option label="3个月" :value="3" />
            <el-option label="6个月" :value="6" />
            <el-option label="1年" :value="12" />
            <el-option label="2年" :value="24" />
            <el-option label="3年" :value="36" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="statusDialogVisible = false">取消</el-button>
        <el-button type="warning" @click="handleRenew" :loading="renewing" :disabled="!statusForm.duration">续费</el-button>
        <el-button type="primary" @click="handleStatusChange" :loading="statusChanging">保存状态</el-button>
      </template>
    </el-dialog>

    <!-- 修改备注对话框 -->
    <el-dialog v-model="remarkDialogVisible" title="修改备注" width="400px">
      <el-form :model="remarkForm" label-width="80px">
        <el-form-item label="域名">
          <span class="full-domain">{{ remarkForm.fullDomain }}</span>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="remarkForm.remark" type="textarea" :rows="3" placeholder="请输入备注信息" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="remarkDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleRemarkSave" :loading="remarkSaving">保存</el-button>
      </template>
    </el-dialog>

    <!-- 批量续费对话框 -->
    <el-dialog v-model="batchRenewDialogVisible" title="批量续费" width="400px">
      <el-form label-width="100px">
        <el-form-item label="选中数量">
          <el-tag type="info">{{ selectedRows.length }} 个子域名</el-tag>
        </el-form-item>
        <el-form-item label="续费时长">
          <el-select v-model="batchRenewDuration" placeholder="选择时长" style="width:100%">
            <el-option label="1个月" :value="1" />
            <el-option label="3个月" :value="3" />
            <el-option label="6个月" :value="6" />
            <el-option label="1年" :value="12" />
            <el-option label="2年" :value="24" />
            <el-option label="3年" :value="36" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="batchRenewDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleBatchRenew" :loading="batchRenewing" :disabled="!batchRenewDuration">确定续费</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowDown, Refresh } from '@element-plus/icons-vue'
import { useDataStore } from '@/stores/data'
import api from '@/api'
import NginxDialog from '@/components/NginxDialog.vue'

const route = useRoute()
const dataStore = useDataStore()

const filterDomainId = ref(null)
const dialogVisible = ref(false)
const batchDialogVisible = ref(false)
const nginxDialogVisible = ref(false)
const statusDialogVisible = ref(false)
const saving = ref(false)
const loading = ref(false)
const refreshing = ref(false)
const batchCreating = ref(false)
const statusChanging = ref(false)
const renewing = ref(false)
const currentSubdomain = ref(null)
const batchResults = ref([])
const searchKeyword = ref('')
const currentPage = ref(1)
const pageSize = ref(10)
const selectedRows = ref([])

const statusForm = reactive({
  id: null,
  fullDomain: '',
  use_status: 'unused',
  expire_at: '',
  new_status: 'unused',
  duration: null
})

// 获取上传页面URL
function getUploadUrl(row) {
  if (row.ftp_auth_code) {
    return `${window.location.origin}?code=${row.ftp_auth_code}`
  }
  return null
}

// 使用状态相关
function getUseStatusType(status) {
  const types = { unused: 'info', used: 'success', disabled: 'danger' }
  return types[status] || 'info'
}

function getUseStatusText(status) {
  const texts = { unused: '未使用', used: '已使用', disabled: '已停用' }
  return texts[status] || '未使用'
}

function isExpired(expireAt) {
  if (!expireAt) return false
  return new Date(expireAt) < new Date()
}

function getRemainingDays(expireAt) {
  if (!expireAt) return 0
  const now = new Date()
  const expire = new Date(expireAt)
  const diff = expire - now
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
}

// 计算有效期天数
function calcDurationDays(value, unit) {
  const v = parseInt(value) || 1
  if (unit === 'day') return v
  if (unit === 'month') return v * 31
  if (unit === 'year') return v * 365
  return v
}

function openStatusDialog(row) {
  statusForm.id = row.id
  statusForm.fullDomain = `${row.subdomain}.${row.main_domain}`
  statusForm.use_status = row.use_status || 'unused'
  statusForm.expire_at = row.expire_at || ''
  statusForm.new_status = row.use_status || 'unused'
  statusForm.duration = null
  statusDialogVisible.value = true
}

async function handleStatusChange() {
  statusChanging.value = true
  try {
    await api.put(`/dns/subdomains/${statusForm.id}/status`, { use_status: statusForm.new_status })
    ElMessage.success('状态已更新')
    statusDialogVisible.value = false
    loadData()
  } finally {
    statusChanging.value = false
  }
}

async function handleRenew() {
  if (!statusForm.duration) return
  renewing.value = true
  try {
    const res = await api.post(`/dns/subdomains/${statusForm.id}/renew`, { duration_months: statusForm.duration })
    ElMessage.success(`续费成功，到期时间: ${res.expire_at}`)
    statusForm.expire_at = res.expire_at
    statusForm.duration = null
    loadData()
  } finally {
    renewing.value = false
  }
}

async function handleDisable(row) {
  await ElMessageBox.confirm('停用将删除DNS解析记录，确定？', '提示')
  await api.put(`/dns/subdomains/${row.id}/status`, { use_status: 'disabled' })
  ElMessage.success('已停用')
  loadData()
}

async function handleEnable(row) {
  // 启用时恢复为"已使用"状态
  await api.put(`/dns/subdomains/${row.id}/status`, { use_status: 'used' })
  ElMessage.success('已启用')
  loadData()
}

// 批量操作
function onSelectionChange(rows) {
  selectedRows.value = rows
}

const batchRenewDialogVisible = ref(false)
const batchRenewDuration = ref(null)
const batchRenewing = ref(false)

// 备注相关
const remarkDialogVisible = ref(false)
const remarkSaving = ref(false)
const remarkForm = reactive({
  id: null,
  fullDomain: '',
  remark: ''
})

function openRemarkDialog(row) {
  remarkForm.id = row.id
  remarkForm.fullDomain = `${row.subdomain}.${row.main_domain}`
  remarkForm.remark = row.remark || ''
  remarkDialogVisible.value = true
}

async function handleRemarkSave() {
  remarkSaving.value = true
  try {
    await api.put(`/dns/subdomains/${remarkForm.id}/remark`, { remark: remarkForm.remark })
    ElMessage.success('备注已更新')
    remarkDialogVisible.value = false
    loadData()
  } finally {
    remarkSaving.value = false
  }
}

async function batchSetStatus(status) {
  if (selectedRows.value.length === 0) return
  const statusText = { used: '已使用', unused: '未使用', disabled: '停用' }
  await ElMessageBox.confirm(`确定将 ${selectedRows.value.length} 个子域名设为${statusText[status]}？`, '批量操作')
  
  let success = 0, failed = 0
  for (const row of selectedRows.value) {
    try {
      await api.put(`/dns/subdomains/${row.id}/status`, { use_status: status })
      success++
    } catch (e) {
      failed++
    }
  }
  ElMessage.success(`操作完成: 成功${success}个, 失败${failed}个`)
  selectedRows.value = []
  loadData()
}

function openBatchRenewDialog() {
  if (selectedRows.value.length === 0) return
  batchRenewDuration.value = null
  batchRenewDialogVisible.value = true
}

async function handleBatchRenew() {
  if (!batchRenewDuration.value || selectedRows.value.length === 0) return
  batchRenewing.value = true
  try {
    let success = 0, failed = 0
    for (const row of selectedRows.value) {
      try {
        await api.post(`/dns/subdomains/${row.id}/renew`, { duration_months: batchRenewDuration.value })
        success++
      } catch (e) {
        failed++
      }
    }
    ElMessage.success(`续费完成: 成功${success}个, 失败${failed}个`)
    batchRenewDialogVisible.value = false
    selectedRows.value = []
    loadData()
  } finally {
    batchRenewing.value = false
  }
}

async function batchDelete() {
  if (selectedRows.value.length === 0) return
  await ElMessageBox.confirm(`确定删除 ${selectedRows.value.length} 个子域名？此操作不可恢复！`, '批量删除', { type: 'warning' })
  
  let success = 0, failed = 0
  for (const row of selectedRows.value) {
    try {
      await api.delete(`/dns/subdomains/${row.id}`)
      success++
    } catch (e) {
      failed++
    }
  }
  ElMessage.success(`删除完成: 成功${success}个, 失败${failed}个`)
  selectedRows.value = []
  loadData()
}

const filteredSubdomains = computed(() => {
  if (!searchKeyword.value) return dataStore.subdomains
  const kw = searchKeyword.value.toLowerCase()
  return dataStore.subdomains.filter(s => 
    s.subdomain?.toLowerCase().includes(kw) ||
    s.main_domain?.toLowerCase().includes(kw) ||
    s.record_value?.toLowerCase().includes(kw) ||
    s.server_name?.toLowerCase().includes(kw)
  )
})

const form = reactive({
  id: null, domain_id: '', subdomain: '', server_id: null,
  record_type: 'A', record_value: '', ttl: 600, remark: '',
  auto_ftp: true, auto_nginx: true, nginx_type: 'https',
  prefix: 'ly', suffix: '', subdomain_length: 8,
  duration_value: 1, duration_unit: 'month'
})

const batchForm = reactive({
  domain_id: '', server_id: '', count: 10,
  auto_ftp: true, auto_nginx: true, nginx_type: 'https',
  prefix: 'ly', suffix: '', subdomain_length: 8,
  duration_value: 1, duration_unit: 'month'
})

const currentDomain = computed(() => {
  if (!filterDomainId.value) return null
  return dataStore.domains.find(d => d.id === filterDomainId.value)
})

onMounted(async () => {
  await dataStore.loadDomains()
  await dataStore.loadServers()
  if (route.query.domain_id) {
    filterDomainId.value = parseInt(route.query.domain_id)
  }
  loadData()
})

async function loadData() {
  loading.value = true
  try {
    await dataStore.loadSubdomains(filterDomainId.value, currentPage.value, pageSize.value)
  } finally {
    loading.value = false
  }
}

function onFilterChange() {
  currentPage.value = 1
  loadData()
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
    Object.assign(form, {
      id: row.id, domain_id: row.domain_id, subdomain: row.subdomain,
      server_id: row.server_id, record_type: row.record_type,
      record_value: row.record_value, ttl: row.ttl || 600, remark: row.remark || ''
    })
  } else {
    // 获取默认值
    const defaultDomain = dataStore.domains.find(d => d.is_default === 1)
    const defaultServer = dataStore.servers.find(s => s.is_default === 1)
    
    Object.assign(form, {
      id: null, domain_id: filterDomainId.value || defaultDomain?.id || '', subdomain: '',
      server_id: defaultServer?.id || null, record_type: 'A', record_value: defaultServer?.ip || '', ttl: 600, remark: '',
      auto_ftp: true, auto_nginx: true, nginx_type: 'https',
      prefix: 'ly', suffix: '', subdomain_length: 8,
      duration_value: 1, duration_unit: 'month'
    })
    await refreshSubdomain()
  }
  dialogVisible.value = true
}

function openBatchDialog() {
  // 获取默认值
  const defaultDomain = dataStore.domains.find(d => d.is_default === 1)
  const defaultServer = dataStore.servers.find(s => s.is_default === 1)
  
  batchForm.domain_id = filterDomainId.value || defaultDomain?.id || ''
  batchForm.server_id = defaultServer?.id || ''
  batchForm.count = 10
  batchForm.auto_ftp = true
  batchForm.auto_nginx = true
  batchForm.nginx_type = 'https'
  batchForm.prefix = 'ly'
  batchForm.suffix = ''
  batchForm.subdomain_length = 8
  batchForm.duration_value = 1
  batchForm.duration_unit = 'month'
  batchResults.value = []
  batchDialogVisible.value = true
}

function openNginxDialog(row) {
  currentSubdomain.value = row
  nginxDialogVisible.value = true
}

async function refreshSubdomain() {
  refreshing.value = true
  try {
    const res = await api.get('/dns/generate-subdomain', {
      params: {
        prefix: form.prefix,
        suffix: form.suffix,
        length: form.subdomain_length
      }
    })
    form.subdomain = res.subdomain
  } finally {
    refreshing.value = false
  }
}

function onServerChange() {
  const server = dataStore.servers.find(s => s.id === form.server_id)
  if (server) form.record_value = server.ip
}

async function handleSave() {
  saving.value = true
  try {
    const data = { ...form, duration_days: calcDurationDays(form.duration_value, form.duration_unit) }
    if (form.id) {
      await api.put(`/dns/subdomains/${form.id}`, data)
      ElMessage.success('保存成功')
    } else {
      await api.post('/dns/subdomains', data)
      ElMessage.success('添加成功')
    }
    dialogVisible.value = false
    loadData()
  } finally {
    saving.value = false
  }
}

async function handleDelete(id) {
  await ElMessageBox.confirm('删除子域名将同时删除关联的FTP账号和Nginx配置，确定？', '提示')
  await api.delete(`/dns/subdomains/${id}`)
  ElMessage.success('删除成功')
  loadData()
}

async function handleBatchCreate() {
  batchCreating.value = true
  batchResults.value = []
  try {
    const data = { ...batchForm, duration_days: calcDurationDays(batchForm.duration_value, batchForm.duration_unit) }
    const res = await api.post('/dns/batch-create', data)
    batchResults.value = res.results
    ElMessage.success(`生成完成: 成功${res.success}个, 失败${res.failed}个`)
    loadData()
  } finally {
    batchCreating.value = false
  }
}

// 分享功能
function handleShare(row) {
  const uploadUrl = `${window.location.origin}?code=${row.ftp_auth_code}`
  const shareText = `上传地址：${uploadUrl}\n授权码：${row.ftp_auth_code}`
  
  navigator.clipboard.writeText(shareText).then(() => {
    ElMessage.success('分享信息已复制到剪贴板')
  }).catch(() => {
    // 降级方案
    const textarea = document.createElement('textarea')
    textarea.value = shareText
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
    ElMessage.success('分享信息已复制到剪贴板')
  })
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

.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
}

.full-domain {
  color: #409eff;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
  transition: color 0.3s;
}

.full-domain:hover {
  color: #66b1ff;
  text-decoration: underline;
}

.remark-text {
  font-size: 12px;
  color: #666;
  display: block;
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.remark-text:hover {
  color: #409eff;
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
