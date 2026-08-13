<template>
  <div class="settings-page">
    <div class="settings-bg" aria-hidden="true"></div>

    <header class="settings-hero">
      <div>
        <p class="eyebrow">运维中心</p>
        <h1>系统设置</h1>
        <p class="hero-desc">证书自动续期、运维检测与系统维护集中管理</p>
      </div>
      <div class="hero-meta">
        <div class="meta-chip" :class="sslSettings.ssl_auto_renew ? 'is-on' : 'is-off'">
          <span class="dot"></span>
          {{ sslSettings.ssl_auto_renew ? '自动续期已开启' : '自动续期已关闭' }}
        </div>
        <div class="meta-chip muted">下次巡检 {{ sslData.schedule?.next_check_at || '-' }}</div>
      </div>
    </header>

    <div class="settings-shell">
      <nav class="settings-nav" role="tablist" aria-label="系统设置分类" @keydown="onNavKeydown">
        <button
          v-for="tab in tabs"
          :key="tab.name"
          type="button"
          role="tab"
          class="nav-item"
          :class="{ active: activeTab === tab.name }"
          :aria-selected="activeTab === tab.name"
          :aria-controls="`settings-panel-${tab.name}`"
          :tabindex="activeTab === tab.name ? 0 : -1"
          @click="goTab(tab.name)"
        >
          <span class="nav-label">{{ tab.label }}</span>
          <span class="nav-hint">{{ tab.hint }}</span>
        </button>
      </nav>

      <main class="settings-main">
        <!-- 证书续期 -->
        <section
          v-show="activeTab === 'ssl'"
          id="settings-panel-ssl"
          class="panel"
          role="tabpanel"
        >
          <div class="auto-renew-card">
            <div class="auto-renew-main">
              <div class="auto-renew-title-row">
                <h2>证书自动续期</h2>
                <el-switch
                  v-model="sslSettings.ssl_auto_renew"
                  inline-prompt
                  active-text="开"
                  inactive-text="关"
                  @change="saveSslSettings"
                />
              </div>
              <p>
                每天 {{ String(sslSettings.ssl_check_hour).padStart(2, '0') }}:00 巡检证书；
                到期前 <b>{{ sslSettings.ssl_renew_before_days }}</b> 天自动续期并同步本地证书。
              </p>
              <div class="auto-renew-controls">
                <label>
                  <span>提前天数</span>
                  <el-input-number
                    v-model="sslSettings.ssl_renew_before_days"
                    :min="1"
                    :max="90"
                    size="small"
                    @change="saveSslSettings"
                  />
                </label>
                <label>
                  <span>巡检时刻</span>
                  <el-select
                    v-model="sslSettings.ssl_check_hour"
                    size="small"
                    style="width:110px"
                    @change="saveSslSettings"
                  >
                    <el-option v-for="h in 24" :key="h - 1" :label="`${String(h - 1).padStart(2, '0')}:00`" :value="h - 1" />
                  </el-select>
                </label>
              </div>
              <div class="auto-renew-foot">
                <span>上次检查：{{ sslData.schedule?.last_ssl_check_at || '尚未执行' }}</span>
                <span>上次续期：{{ sslData.schedule?.last_ssl_renew_at || '尚未执行' }}</span>
              </div>
            </div>
            <div class="auto-renew-actions">
              <el-button type="primary" :loading="running.autoRenew" @click="runAutoRenewNow">立即检查并续期</el-button>
              <el-button :loading="running.sslSync" @click="refreshSslFromServers">同步服务器状态</el-button>
              <el-button :loading="loadingSsl" @click="loadSslRenewals">刷新列表</el-button>
            </div>
          </div>

          <div class="metric-row" v-loading="loadingSsl">
            <div class="metric" v-for="m in sslMetrics" :key="m.key" :class="m.tone">
              <div class="metric-val">{{ sslData[m.key] ?? 0 }}</div>
              <div class="metric-label">{{ m.label }}</div>
            </div>
          </div>

          <div class="table-card">
            <div class="table-card-head">
              <h3>证书续期时间</h3>
              <span>按剩余天数排序</span>
            </div>
            <el-table :data="sslData.rows || []" stripe v-loading="loadingSsl" max-height="480" class="soft-table">
              <el-table-column prop="domain" label="主域名" min-width="160" show-overflow-tooltip />
              <el-table-column label="状态" width="100">
                <template #default="{ row }">
                  <el-tag :type="sslStatusType(row)" size="small" effect="plain">{{ row.ssl_status || 'none' }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="到期时间" width="170">
                <template #default="{ row }">
                  <span :class="sslExpireClass(row)">{{ row.ssl_expires || '未设置' }}</span>
                </template>
              </el-table-column>
              <el-table-column label="剩余" width="120">
                <template #default="{ row }">
                  <span :class="sslExpireClass(row)">
                    {{ row.remaining_days === null ? '-' : (row.remaining_days < 0 ? `已过期 ${Math.abs(row.remaining_days)} 天` : `${row.remaining_days} 天`) }}
                  </span>
                </template>
              </el-table-column>
              <el-table-column prop="note" label="续期建议" min-width="180" show-overflow-tooltip />
              <el-table-column label="操作" width="100" fixed="right">
                <template #default="{ row }">
                  <el-button type="primary" link size="small" :loading="renewingId === row.id" @click="renewCert(row)">续期</el-button>
                </template>
              </el-table-column>
            </el-table>
            <div v-if="!(sslData.rows || []).length && !loadingSsl" class="empty-tip">
              <el-empty description="暂无主域名证书数据" />
            </div>
          </div>
        </section>

        <!-- 运维检测 -->
        <section
          v-show="activeTab === 'diagnose'"
          id="settings-panel-diagnose"
          class="panel"
          role="tabpanel"
        >
          <div class="section-intro">
            <h2>运维检测</h2>
            <p>巡检服务器、DNS、站点健康与证书。停用过期站点是独立危险操作，只禁 Nginx，不动 DNS。</p>
          </div>

          <div class="metric-row" v-loading="loadingStats">
            <div class="metric" v-for="item in statCards" :key="item.key" :class="item.tone">
              <div class="metric-val">{{ stats[item.key] ?? '-' }}</div>
              <div class="metric-label">{{ item.label }}</div>
            </div>
          </div>

          <div class="action-toolbar">
            <div class="action-grid">
              <el-button type="primary" :loading="running.full" @click="runFull">一键全面检测</el-button>
              <el-button :loading="running.servers" @click="runServers">服务器连通</el-button>
              <el-button :loading="running.dns" @click="runDns">DNS 平台</el-button>
              <el-button :loading="running.sites" @click="runSites">站点健康</el-button>
              <el-button @click="loadStats" :loading="loadingStats">刷新统计</el-button>
            </div>
            <el-button type="danger" plain :loading="running.expire" @click="runExpire">检测并停用过期</el-button>
          </div>

          <div v-if="!hasAnyResult" class="empty-tip soft">
            <el-empty description="点击上方按钮开始检测" />
          </div>

          <div v-if="results.expire" class="result-block">
            <div class="result-title">过期停用 <el-tag size="small" type="warning">停用 {{ results.expire.disabled || 0 }} · 共 {{ results.expire.total || 0 }}</el-tag></div>
            <el-table v-if="results.expire.results?.length" :data="results.expire.results" size="small" stripe max-height="240" class="soft-table">
              <el-table-column prop="domain" label="域名" min-width="180" />
              <el-table-column label="结果" width="90">
                <template #default="{ row }"><el-tag :type="row.success ? 'success' : 'danger'" size="small">{{ row.success ? '成功' : '失败' }}</el-tag></template>
              </el-table-column>
              <el-table-column prop="message" label="说明" min-width="200" show-overflow-tooltip />
            </el-table>
            <div v-else class="result-ok">{{ results.expire.message || '没有需要停用的过期子域名' }}</div>
          </div>

          <div v-if="results.servers" class="result-block">
            <div class="result-title">服务器连通 <el-tag size="small" :type="results.servers.failed ? 'danger' : 'success'">正常 {{ results.servers.success || 0 }} · 失败 {{ results.servers.failed || 0 }}</el-tag></div>
            <el-table :data="results.servers.results || []" size="small" stripe max-height="260" class="soft-table">
              <el-table-column prop="name" label="名称" min-width="120" />
              <el-table-column label="地址" min-width="140"><template #default="{ row }">{{ row.ip }}:{{ row.port }}</template></el-table-column>
              <el-table-column label="状态" width="90">
                <template #default="{ row }"><el-tag :type="row.success ? 'success' : 'danger'" size="small">{{ row.success ? '正常' : '失败' }}</el-tag></template>
              </el-table-column>
              <el-table-column prop="message" label="说明" min-width="160" show-overflow-tooltip />
            </el-table>
          </div>

          <div v-if="results.dns" class="result-block">
            <div class="result-title">DNS 平台 <el-tag size="small" :type="results.dns.failed ? 'danger' : 'success'">正常 {{ results.dns.success || 0 }} · 失败 {{ results.dns.failed || 0 }}</el-tag></div>
            <el-table v-if="results.dns.results?.length" :data="results.dns.results" size="small" stripe max-height="240" class="soft-table">
              <el-table-column prop="name" label="名称" min-width="120" />
              <el-table-column prop="platform" label="平台" width="100" />
              <el-table-column label="状态" width="90">
                <template #default="{ row }"><el-tag :type="row.success ? 'success' : 'danger'" size="small">{{ row.success ? '正常' : '失败' }}</el-tag></template>
              </el-table-column>
              <el-table-column prop="message" label="说明" min-width="180" show-overflow-tooltip />
            </el-table>
            <div v-else class="result-ok">暂无 DNS 平台配置</div>
          </div>

          <div v-if="results.sites" class="result-block">
            <div class="result-title">
              站点健康
              <el-tag size="small" type="info">扫描 {{ results.sites.scanned }}</el-tag>
              <el-tag size="small" type="success">健康 {{ results.sites.healthy }}</el-tag>
              <el-tag size="small" :type="results.sites.issue_count ? 'warning' : 'success'">问题 {{ results.sites.issue_count }}</el-tag>
            </div>
            <el-table v-if="results.sites.issues?.length" :data="results.sites.issues" size="small" stripe max-height="320" class="soft-table">
              <el-table-column prop="domain" label="域名" min-width="180" show-overflow-tooltip />
              <el-table-column prop="server" label="服务器" width="120" />
              <el-table-column label="问题" min-width="240">
                <template #default="{ row }">
                  <el-tag v-for="p in row.problems" :key="p" size="small" type="warning" class="problem-tag">{{ p }}</el-tag>
                </template>
              </el-table-column>
            </el-table>
            <div v-else class="result-ok">已扫描站点均健康，或暂无子域名</div>
          </div>

          <div v-if="results.ssl" class="result-block">
            <div class="result-title">
              证书摘要
              <el-tag size="small" type="success">有效 {{ results.ssl.active || 0 }}</el-tag>
              <el-tag size="small" type="warning">窗口内 {{ results.ssl.renew_window || 0 }}</el-tag>
              <el-tag size="small" type="danger">过期 {{ results.ssl.expired || 0 }}</el-tag>
              <el-tag size="small" type="info">未申请 {{ results.ssl.none || 0 }}</el-tag>
            </div>
            <div v-if="results.ssl.schedule" class="result-ok">
              {{ results.ssl.schedule.check_time }}
              · 下次 {{ results.ssl.schedule.next_check_at || '-' }}
              · {{ results.ssl.schedule.note }}
            </div>
            <el-button type="primary" link @click="goTab('ssl')">查看证书列表并续期</el-button>
          </div>

          <div v-if="lastFullAt" class="last-run">上次全面检测：{{ lastFullAt }}</div>
        </section>

        <!-- 维护工具 -->
        <section
          v-show="activeTab === 'tools'"
          id="settings-panel-tools"
          class="panel"
          role="tabpanel"
        >
          <div class="section-intro">
            <h2>维护工具</h2>
            <p>清理临时分片。停用过期站点、证书续期请到对应页面执行。</p>
          </div>
          <div class="tool-list">
            <div class="tool-item">
              <div>
                <div class="tool-title">清理上传临时分片</div>
                <div class="tool-desc">当前约 {{ formatSize(stats.temp_bytes) }} / {{ stats.temp_sessions || 0 }} 个会话</div>
              </div>
              <el-button type="warning" :loading="running.cleanup" @click="runCleanup">立即清理</el-button>
            </div>
            <div class="tool-item">
              <div>
                <div class="tool-title">过期站点停用</div>
                <div class="tool-desc">禁用 Nginx，保留 DNS。在运维检测中确认后执行</div>
              </div>
              <el-button @click="goTab('diagnose')">前往运维检测</el-button>
            </div>
            <div class="tool-item">
              <div>
                <div class="tool-title">证书检查 / 自动续期</div>
                <div class="tool-desc">按自动续期开关与提前天数执行</div>
              </div>
              <el-button @click="goTab('ssl')">前往证书续期</el-button>
            </div>
          </div>
        </section>

        <!-- 备份 -->
        <section
          v-show="activeTab === 'backup'"
          id="settings-panel-backup"
          class="panel"
          role="tabpanel"
        >
          <div class="section-intro">
            <h2>数据库备份</h2>
            <p>备份保存在服务器备份目录，可在此下载或删除。</p>
          </div>
          <div class="action-grid">
            <el-button type="primary" :loading="backing" @click="handleBackup">立即备份</el-button>
            <el-button :loading="loadingBackups" @click="loadBackupList">刷新列表</el-button>
          </div>
          <div class="table-card">
            <el-table :data="backupList" stripe v-loading="loadingBackups" class="soft-table">
              <el-table-column label="文件名" min-width="200">
                <template #default="{ row }"><el-icon style="margin-right:6px"><Document /></el-icon>{{ row.filename }}</template>
              </el-table-column>
              <el-table-column label="大小" width="120"><template #default="{ row }">{{ formatSize(row.size) }}</template></el-table-column>
              <el-table-column prop="created_at" label="创建时间" width="180" />
              <el-table-column label="操作" width="180" fixed="right">
                <template #default="{ row }">
                  <el-button type="success" size="small" @click="downloadBackup(row)" :loading="downloadingBackup === row.filename">下载</el-button>
                  <el-button type="danger" size="small" @click="deleteBackup(row)">删除</el-button>
                </template>
              </el-table-column>
            </el-table>
            <div v-if="backupList.length === 0 && !loadingBackups" class="empty-tip"><el-empty description="暂无备份文件" /></div>
          </div>
        </section>

        <!-- 系统信息 -->
        <section
          v-show="activeTab === 'info'"
          id="settings-panel-info"
          class="panel"
          role="tabpanel"
        >
          <div class="section-intro row">
            <div>
              <h2>系统信息</h2>
              <p>运行时状态与资源占用</p>
            </div>
            <el-button size="small" @click="loadSystemInfo(true)">刷新</el-button>
          </div>
          <p v-if="systemInfoError" class="error-tip">{{ systemInfoError }}</p>
          <div class="info-grid">
            <div class="info-item" v-for="item in infoItems" :key="item.label">
              <span class="info-label">{{ item.label }}</span>
              <span class="info-value">{{ item.value }}</span>
            </div>
          </div>
        </section>
      </main>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Document } from '@element-plus/icons-vue'
import api from '@/api'

const tabs = [
  { name: 'ssl', label: '证书续期', hint: '自动续期 / 到期' },
  { name: 'diagnose', label: '运维检测', hint: '连通性与健康' },
  { name: 'tools', label: '维护工具', hint: '清理与任务' },
  { name: 'backup', label: '数据库备份', hint: '安全备份' },
  { name: 'info', label: '系统信息', hint: '运行状态' }
]
const TAB_NAMES = tabs.map((t) => t.name)

const route = useRoute()
const router = useRouter()

const activeTab = computed(() => {
  const tab = String(route.query.tab || '')
  return TAB_NAMES.includes(tab) ? tab : 'ssl'
})

const backing = ref(false)
const loadingBackups = ref(false)
const downloadingBackup = ref('')
const backupList = ref([])
const loadingStats = ref(false)
const loadingSsl = ref(false)
const renewingId = ref(null)
const lastFullAt = ref('')
const savingSettings = ref(false)
const systemInfoError = ref('')
const loaded = reactive({
  ssl: false,
  stats: false,
  backup: false,
  info: false
})

const sslSettings = reactive({
  ssl_auto_renew: true,
  ssl_renew_before_days: 30,
  ssl_check_hour: 3
})

const savedSslSettings = {
  ssl_auto_renew: true,
  ssl_renew_before_days: 30,
  ssl_check_hour: 3
}

const sslData = reactive({
  active: 0,
  none: 0,
  failed: 0,
  expiring_soon: 0,
  expired: 0,
  renew_window: 0,
  schedule: {},
  rows: []
})

const running = reactive({
  full: false,
  expire: false,
  servers: false,
  dns: false,
  sites: false,
  sslSync: false,
  sslDiagnose: false,
  cleanup: false,
  autoRenew: false
})

const stats = reactive({
  domains: 0,
  subdomains: 0,
  servers: 0,
  ftp: 0,
  expired_active: 0,
  expiring_soon: 0,
  disabled: 0,
  nginx_unsynced: 0,
  ssl_failed: 0,
  dns_error: 0,
  temp_sessions: 0,
  temp_bytes: 0
})

const results = reactive({
  expire: null,
  servers: null,
  dns: null,
  sites: null,
  ssl: null
})

const systemInfo = reactive({
  version: '-',
  nodeVersion: '-',
  platform: '-',
  dbType: '-',
  uptime: '-',
  port: '-',
  pid: '-',
  memory: {},
  temp: {}
})

const sslMetrics = [
  { key: 'active', label: '有效证书', tone: '' },
  { key: 'renew_window', label: '即将自动续期', tone: 'warning' },
  { key: 'expiring_soon', label: '15天内到期', tone: 'warning' },
  { key: 'expired', label: '已过期', tone: 'danger' },
  { key: 'failed', label: '失败', tone: 'danger' },
  { key: 'none', label: '未申请', tone: 'muted' }
]

const statCards = [
  { key: 'domains', label: '主域名', tone: '' },
  { key: 'subdomains', label: '子域名', tone: '' },
  { key: 'servers', label: '服务器', tone: '' },
  { key: 'expired_active', label: '过期未停用', tone: 'danger' },
  { key: 'nginx_unsynced', label: 'Nginx未同步', tone: 'warning' },
  { key: 'ssl_failed', label: 'SSL异常', tone: 'danger' },
  { key: 'dns_error', label: 'DNS异常', tone: 'danger' },
  { key: 'temp_sessions', label: '临时会话', tone: 'muted' }
]

const hasAnyResult = computed(() =>
  !!(results.expire || results.servers || results.dns || results.sites || results.ssl)
)

const infoItems = computed(() => [
  { label: '系统版本', value: systemInfo.version ? `v${systemInfo.version}` : '-' },
  { label: 'Node.js', value: systemInfo.nodeVersion },
  { label: '平台', value: systemInfo.platform || '-' },
  { label: '数据库', value: systemInfo.dbType },
  { label: '运行时间', value: systemInfo.uptime },
  { label: '监听端口', value: systemInfo.port || '-' },
  { label: '进程 PID', value: systemInfo.pid || '-' },
  { label: '内存 RSS', value: formatSize(systemInfo.memory?.rss) },
  { label: '堆使用', value: formatSize(systemInfo.memory?.heapUsed) },
  { label: '临时分片', value: `${systemInfo.temp?.sessions || 0} 会话 / ${formatSize(systemInfo.temp?.bytes)}` }
])

watch(
  () => route.query.tab,
  (tab) => {
    if (!TAB_NAMES.includes(String(tab || ''))) {
      router.replace({ query: { ...route.query, tab: 'ssl' } })
      return
    }
    ensureTabData(String(tab))
  },
  { immediate: true }
)

function snapshotSslSettings() {
  savedSslSettings.ssl_auto_renew = !!sslSettings.ssl_auto_renew
  savedSslSettings.ssl_renew_before_days = sslSettings.ssl_renew_before_days
  savedSslSettings.ssl_check_hour = sslSettings.ssl_check_hour
}

function restoreSslSettings() {
  sslSettings.ssl_auto_renew = savedSslSettings.ssl_auto_renew
  sslSettings.ssl_renew_before_days = savedSslSettings.ssl_renew_before_days
  sslSettings.ssl_check_hour = savedSslSettings.ssl_check_hour
}

function applySslPayload(res) {
  if (!res) return
  Object.assign(sslData, res)
  if (res.settings) {
    sslSettings.ssl_auto_renew = !!res.settings.ssl_auto_renew
    sslSettings.ssl_renew_before_days = res.settings.ssl_renew_before_days || 30
    sslSettings.ssl_check_hour = res.settings.ssl_check_hour ?? 3
    snapshotSslSettings()
  }
}

async function goTab(name) {
  if (!TAB_NAMES.includes(name)) name = 'ssl'
  if (name === activeTab.value) return
  await router.push({ query: { ...route.query, tab: name } })
}

function onNavKeydown(e) {
  const dir = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1
    : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1
      : 0
  if (!dir) return
  e.preventDefault()
  const i = tabs.findIndex((t) => t.name === activeTab.value)
  const next = tabs[(i + dir + tabs.length) % tabs.length]
  goTab(next.name).then(() => {
    nextTick(() => {
      document.querySelector('.settings-nav [role="tab"][aria-selected="true"]')?.focus()
    })
  })
}

function ensureTabData(tab) {
  if (!loaded.ssl) loadSslRenewals()
  if ((tab === 'diagnose' || tab === 'tools') && !loaded.stats) loadStats()
  if (tab === 'backup' && !loaded.backup) loadBackupList()
  if (tab === 'info' && !loaded.info) loadSystemInfo()
}

function sslStatusType(row) {
  if (row.urgency === 'expired' || row.ssl_status === 'failed' || row.ssl_status === 'error') return 'danger'
  if (row.urgency === 'critical' || row.urgency === 'soon') return 'warning'
  if (row.ssl_status === 'active') return 'success'
  return 'info'
}

function sslExpireClass(row) {
  if (row.urgency === 'expired' || row.urgency === 'critical') return 'expire-danger'
  if (row.urgency === 'soon') return 'expire-warning'
  if (row.urgency === 'ok') return 'expire-ok'
  return ''
}

async function loadSslRenewals() {
  loadingSsl.value = true
  try {
    const res = await api.get('/system/ssl-renewals')
    applySslPayload(res)
    loaded.ssl = true
  } catch (err) {
    ElMessage.error(err.message || '加载证书续期时间失败')
  } finally {
    loadingSsl.value = false
  }
}

async function saveSslSettings() {
  if (savingSettings.value) return
  savingSettings.value = true
  try {
    const res = await api.put('/system/settings', {
      ssl_auto_renew: sslSettings.ssl_auto_renew,
      ssl_renew_before_days: sslSettings.ssl_renew_before_days,
      ssl_check_hour: sslSettings.ssl_check_hour
    })
    Object.assign(sslSettings, {
      ssl_auto_renew: !!res.settings.ssl_auto_renew,
      ssl_renew_before_days: res.settings.ssl_renew_before_days,
      ssl_check_hour: res.settings.ssl_check_hour
    })
    snapshotSslSettings()
    ElMessage.success(res.schedule?.message || res.message || '自动续期设置已保存')
    await loadSslRenewals()
  } catch (err) {
    restoreSslSettings()
    ElMessage.error(err.message || '保存失败')
  } finally {
    savingSettings.value = false
  }
}

async function runAutoRenewNow() {
  const willRenew = !!sslSettings.ssl_auto_renew
  try {
    await ElMessageBox.confirm(
      willRenew
        ? `将检查证书，并对到期前 ${sslSettings.ssl_renew_before_days} 天内的证书执行续期。`
        : '自动续期已关闭，本次仅检查证书状态，不会续期。',
      willRenew ? '立即检查并续期' : '立即检查证书',
      {
        type: willRenew ? 'warning' : 'info',
        confirmButtonText: willRenew ? '开始续期' : '仅检查',
        cancelButtonText: '取消'
      }
    )
  } catch { return }
  running.autoRenew = true
  try {
    const res = await api.post('/system/ssl-auto-renew/run')
    ElMessage.success(res.message || '检查完成')
    await loadSslRenewals()
  } catch (err) {
    ElMessage.error(err.message || '自动续期执行失败')
  } finally {
    running.autoRenew = false
  }
}

async function refreshSslFromServers() {
  running.sslSync = true
  try {
    const res = await api.post('/ssl/check-all')
    ElMessage.success(`已同步 ${res.checked || 0} 个域名证书状态`)
    await loadSslRenewals()
  } catch (err) {
    ElMessage.error(err.message || '同步失败')
  } finally {
    running.sslSync = false
  }
}

async function renewCert(row) {
  try {
    await ElMessageBox.confirm(`确定续期「${row.domain}」？`, '证书续期', { type: 'warning' })
  } catch { return }
  renewingId.value = row.id
  try {
    const res = await api.post(`/ssl/renew/${row.id}`)
    res.success ? ElMessage.success(res.message || '续期成功') : ElMessage.error(res.message || '续期失败')
    await loadSslRenewals()
  } catch (err) {
    ElMessage.error(err.message || '续期失败')
  } finally {
    renewingId.value = null
  }
}

async function loadStats() {
  loadingStats.value = true
  try {
    Object.assign(stats, await api.get('/system/stats'))
    loaded.stats = true
  } catch (err) {
    ElMessage.error(err.message || '加载统计失败')
  } finally {
    loadingStats.value = false
  }
}

async function runExpire() {
  if (!loaded.stats) await loadStats()
  const count = Number(stats.expired_active) || 0
  try {
    await ElMessageBox.confirm(
      count
        ? `当前有 ${count} 个过期未停用站点。将禁用其 Nginx，DNS 记录保留，之后可再启用。`
        : '将扫描并停用已过期仍在运行的站点（禁 Nginx，保留 DNS）。若没有这类站点则不会改动。',
      '停用过期站点',
      {
        type: 'warning',
        confirmButtonText: '确认停用',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger'
      }
    )
  } catch { return }
  running.expire = true
  try {
    results.expire = await api.post('/system/diagnose/expire')
    ElMessage.success(results.expire.message || '过期检测完成')
    await loadStats()
  } catch (err) {
    ElMessage.error(err.message || '过期检测失败')
  } finally {
    running.expire = false
  }
}

async function runServers() {
  running.servers = true
  try {
    results.servers = await api.post('/system/diagnose/servers')
    ElMessage.success('服务器检测完成')
  } catch (err) {
    ElMessage.error(err.message || '服务器检测失败')
  } finally {
    running.servers = false
  }
}

async function runDns() {
  running.dns = true
  try {
    results.dns = await api.post('/system/diagnose/dns')
    ElMessage.success('DNS 检测完成')
  } catch (err) {
    ElMessage.error(err.message || 'DNS 检测失败')
  } finally {
    running.dns = false
  }
}

async function runSites() {
  running.sites = true
  try {
    results.sites = await api.post('/system/diagnose/sites')
    ElMessage.success(`站点健康：问题 ${results.sites.issue_count} 个`)
  } catch (err) {
    ElMessage.error(err.message || '站点检测失败')
  } finally {
    running.sites = false
  }
}

async function runSsl(options = {}) {
  const silent = !!options.silent
  running.sslDiagnose = true
  try {
    const res = await api.post('/system/diagnose/ssl')
    results.ssl = res
    applySslPayload(res)
    loaded.ssl = true
    if (!silent) ElMessage.success('证书续期时间已更新')
  } catch (err) {
    ElMessage.error(err.message || 'SSL 检测失败')
  } finally {
    running.sslDiagnose = false
  }
}

async function runFull() {
  running.full = true
  try {
    const res = await api.post('/system/diagnose/full')
    if (res.stats) Object.assign(stats, res.stats)
    loaded.stats = true
    results.servers = res.servers
    results.dns = res.dns
    results.sites = res.sites
    lastFullAt.value = res.finished_at || ''
    await runSsl({ silent: true })
    ElMessage.success('全面检测完成')
  } catch (err) {
    ElMessage.error(err.message || '全面检测失败')
  } finally {
    running.full = false
  }
}

async function runCleanup() {
  try {
    await ElMessageBox.confirm('确定清理全部上传临时分片？', '清理确认', { type: 'warning' })
  } catch { return }
  running.cleanup = true
  try {
    const res = await api.post('/system/cleanup-temp')
    ElMessage.success(res.message || '清理完成')
    await loadStats()
    await loadSystemInfo()
  } catch (err) {
    ElMessage.error(err.message || '清理失败')
  } finally {
    running.cleanup = false
  }
}

async function handleBackup() {
  backing.value = true
  try {
    const res = await api.post('/system/backup')
    ElMessage.success(`备份成功：${res.filename}`)
    loadBackupList()
  } catch (err) {
    ElMessage.error(err.message || '备份失败')
  } finally {
    backing.value = false
  }
}

async function loadBackupList() {
  loadingBackups.value = true
  try {
    const res = await api.get('/system/backups')
    backupList.value = res.backups || []
    loaded.backup = true
  } catch (err) {
    ElMessage.error(err.message || '加载备份失败')
  } finally {
    loadingBackups.value = false
  }
}

async function downloadBackup(backup) {
  downloadingBackup.value = backup.filename
  try {
    const blob = await api.get('/system/backup/download', {
      params: { filename: backup.filename },
      responseType: 'blob'
    })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = backup.filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
  } catch (err) {
    ElMessage.error(err.message || '下载失败')
  } finally {
    downloadingBackup.value = ''
  }
}

async function deleteBackup(backup) {
  try {
    await ElMessageBox.confirm(`确定删除 "${backup.filename}"？`, '确认删除', { type: 'warning' })
    await api.delete('/system/backup', { params: { filename: backup.filename } })
    ElMessage.success('删除成功')
    loadBackupList()
  } catch (err) {
    if (err !== 'cancel') ElMessage.error(err.message || '删除失败')
  }
}

async function loadSystemInfo(force = false) {
  if (force) loaded.info = false
  systemInfoError.value = ''
  try {
    Object.assign(systemInfo, await api.get('/system/info'))
    loaded.info = true
  } catch (err) {
    systemInfoError.value = err.message || '加载系统信息失败'
  }
}

function formatSize(bytes) {
  if (bytes === null || bytes === undefined || bytes === '-') return '-'
  const n = Number(bytes)
  if (!Number.isFinite(n) || n < 0) return '-'
  if (n === 0) return '0 B'
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB'
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB'
}
</script>

<style scoped>
.settings-page {
  --ink: #1c2430;
  --muted: #6b7280;
  --line: rgba(28, 36, 48, 0.08);
  --panel: rgba(255, 255, 255, 0.82);
  --accent: #0f766e;
  --accent-soft: #ccfbf1;
  --warn: #b45309;
  --danger: #b91c1c;
  --page-font: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "PingFang SC", "Helvetica Neue", Arial, sans-serif;
  position: relative;
  min-height: calc(100vh - 120px);
  padding: 8px 4px 28px;
  font-family: var(--page-font);
  color: var(--ink);
}

.settings-page :deep(.el-button--primary) {
  --el-button-bg-color: var(--accent);
  --el-button-border-color: var(--accent);
  --el-button-hover-bg-color: #0d9488;
  --el-button-hover-border-color: #0d9488;
  --el-button-active-bg-color: #0f766e;
  --el-button-active-border-color: #0f766e;
}

.settings-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background:
    radial-gradient(900px 420px at 8% -10%, rgba(15, 118, 110, 0.16), transparent 60%),
    radial-gradient(700px 360px at 96% 8%, rgba(14, 116, 144, 0.12), transparent 55%),
    linear-gradient(180deg, #f3f6f8 0%, #eef2f4 100%);
}

.settings-hero,
.settings-shell {
  position: relative;
  z-index: 1;
}

.settings-hero {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  align-items: flex-end;
  margin-bottom: 18px;
  padding: 8px 6px 4px;
  animation: rise 0.45s ease both;
}

.eyebrow {
  margin: 0 0 6px;
  font-size: 12px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--accent);
  font-weight: 600;
}

.settings-hero h1 {
  margin: 0;
  font-family: var(--page-font);
  font-size: 30px;
  font-weight: 700;
  letter-spacing: -0.03em;
}

.hero-desc {
  margin: 8px 0 0;
  color: var(--muted);
  font-size: 14px;
}

.hero-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.meta-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.75);
  border: 1px solid var(--line);
  font-size: 12px;
  font-weight: 500;
  backdrop-filter: blur(8px);
}

.meta-chip .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #94a3b8;
}

.meta-chip.is-on {
  background: var(--accent-soft);
  color: #115e59;
  border-color: rgba(15, 118, 110, 0.18);
}

.meta-chip.is-on .dot { background: #0f766e; box-shadow: 0 0 0 4px rgba(15, 118, 110, 0.15); }
.meta-chip.is-off .dot { background: #94a3b8; }
.meta-chip.muted { color: var(--muted); }

.settings-shell {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 16px;
  align-items: start;
  animation: rise 0.55s ease 0.05s both;
}

.settings-nav {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: 18px;
  background: var(--panel);
  border: 1px solid var(--line);
  backdrop-filter: blur(10px);
  box-shadow: 0 10px 30px rgba(28, 36, 48, 0.05);
  position: sticky;
  top: 12px;
}

.nav-item {
  appearance: none;
  border: 0;
  background: transparent;
  text-align: left;
  padding: 12px 12px;
  border-radius: 12px;
  cursor: pointer;
  transition: background 0.2s ease, transform 0.2s ease;
}

.nav-item:hover { background: rgba(15, 118, 110, 0.06); }
.nav-item:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.nav-item.active {
  background: linear-gradient(135deg, rgba(15, 118, 110, 0.14), rgba(14, 116, 144, 0.08));
  box-shadow: inset 0 0 0 1px rgba(15, 118, 110, 0.12);
}

.nav-label {
  display: block;
  font-family: var(--page-font);
  font-size: 14px;
  font-weight: 600;
  color: var(--ink);
}

.nav-hint {
  display: block;
  margin-top: 3px;
  font-size: 12px;
  color: var(--muted);
}

.settings-main,
.panel {
  min-width: 0;
}

.panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.section-intro h2,
.auto-renew-title-row h2,
.table-card-head h3 {
  margin: 0;
  font-family: var(--page-font);
  font-weight: 600;
  letter-spacing: -0.02em;
}

.section-intro p,
.auto-renew-main p {
  margin: 8px 0 0;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.6;
}

.section-intro.row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.auto-renew-card,
.table-card,
.tool-item,
.info-grid {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 18px;
  backdrop-filter: blur(10px);
  box-shadow: 0 12px 34px rgba(28, 36, 48, 0.05);
}

.auto-renew-card {
  display: grid;
  grid-template-columns: 1.4fr 0.8fr;
  gap: 18px;
  padding: 20px;
}

.auto-renew-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.auto-renew-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin-top: 14px;
}

.auto-renew-controls label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--muted);
}

.auto-renew-foot {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin-top: 14px;
  font-size: 12px;
  color: #64748b;
}

.auto-renew-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  justify-content: center;
}

.metric-row {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 10px;
}

.metric {
  padding: 14px 12px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.78);
  border: 1px solid var(--line);
  text-align: center;
  transition: transform 0.2s ease;
}

.metric:hover { transform: translateY(-2px); }
.metric.warning { background: #fff7ed; border-color: #fdba74; }
.metric.danger { background: #fef2f2; border-color: #fca5a5; }
.metric.muted { background: #f8fafc; }

.metric-val {
  font-family: var(--page-font);
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.03em;
}

.metric-label {
  margin-top: 4px;
  font-size: 12px;
  color: var(--muted);
}

.action-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
}

.action-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.table-card { padding: 16px; }
.table-card-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 12px;
}
.table-card-head span { font-size: 12px; color: var(--muted); }

.soft-table {
  --el-table-bg-color: transparent;
  --el-table-tr-bg-color: transparent;
  --el-table-header-bg-color: rgba(15, 118, 110, 0.04);
}

.tool-list { display: flex; flex-direction: column; gap: 12px; }
.tool-item {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
  padding: 16px 18px;
}
.tool-title { font-weight: 600; margin-bottom: 4px; }
.tool-desc { font-size: 13px; color: var(--muted); }

.info-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1px;
  overflow: hidden;
  background: var(--line);
  padding: 0;
}

.info-item {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  background: rgba(255, 255, 255, 0.9);
}
.info-label { color: var(--muted); font-size: 13px; }
.info-value { font-weight: 600; font-size: 13px; text-align: right; }

.result-block {
  padding: 14px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid var(--line);
}

.result-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  margin-bottom: 10px;
}

.result-ok {
  padding: 12px 14px;
  border-radius: 10px;
  background: #ecfdf5;
  color: #047857;
  font-size: 13px;
}

.problem-tag { margin: 0 6px 4px 0; }
.last-run { font-size: 12px; color: var(--muted); }
.empty-tip { padding: 20px 0; }
.empty-tip.soft {
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.55);
  border: 1px dashed var(--line);
}

.expire-ok { color: #047857; }
.expire-warning { color: var(--warn); font-weight: 600; }
.expire-danger { color: var(--danger); font-weight: 600; }

.error-tip {
  margin: 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: #fef2f2;
  color: var(--danger);
  font-size: 13px;
}

@keyframes rise {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
  .settings-hero,
  .settings-shell,
  .metric {
    animation: none;
    transition: none;
  }
}

@media (max-width: 960px) {
  .settings-shell { grid-template-columns: 1fr; }
  .settings-nav {
    position: static;
    flex-direction: row;
    overflow-x: auto;
  }
  .nav-item { min-width: 132px; }
  .auto-renew-card { grid-template-columns: 1fr; }
  .settings-hero { flex-direction: column; align-items: flex-start; }
  .info-grid { grid-template-columns: 1fr; }
  .tool-item,
  .action-grid,
  .action-toolbar,
  .auto-renew-actions { flex-direction: column; align-items: stretch; }
}
</style>
