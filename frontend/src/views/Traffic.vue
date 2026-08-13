<template>
  <div class="card">
    <div class="page-header">
      <div class="header-top">
        <span class="page-title">
          流量统计
          <el-tag v-if="currentSiteName" type="info" size="small" class="domain-filter-tag">{{ currentSiteName }}</el-tag>
          <el-tag v-if="result" size="small" :type="result.accurate ? 'success' : 'warning'">
            {{ result.accurate ? '精确流量' : '近似流量' }}
          </el-tag>
        </span>
        <div class="header-actions">
          <el-button size="small" @click="goBack">返回列表</el-button>
          <el-button type="primary" size="small" :disabled="!selectedId" :loading="loading" @click="runQuery">
            <el-icon><Refresh /></el-icon>
            刷新
          </el-button>
        </div>
      </div>
      <div class="filter-bar">
        <el-select
          v-model="selectedId"
          filterable
          remote
          clearable
          placeholder="搜索子域名"
          :remote-method="searchSites"
          :loading="siteLoading"
          class="filter-search"
          size="small"
        >
          <el-option
            v-for="s in siteOptions"
            :key="s.id"
            :label="s.full_domain"
            :value="s.id"
          />
        </el-select>
        <el-radio-group v-model="preset" size="small">
          <el-radio-button
            v-for="item in presets"
            :key="item.value"
            :value="item.value"
          >
            {{ item.label }}
          </el-radio-button>
        </el-radio-group>
        <div class="filter-checks">
          <el-checkbox v-model="hideEmpty" size="small" border :disabled="!result">只看有流量</el-checkbox>
        </div>
        <span v-if="result" class="record-count">共 {{ tablePoints.length }} 个时段</span>
      </div>
    </div>

    <el-empty v-if="!selectedId && !loading" description="从子域名列表点今日流量，或在上方搜索站点" />

    <div v-else v-loading="loading">
      <template v-if="result">
        <div class="summary-row">
          <div class="summary-block">
            <div class="summary-label">流量</div>
            <div class="summary-value">
              {{ formatTrafficBytes(result.bytes) }}
              <span v-if="!result.accurate" class="approx">≈</span>
            </div>
          </div>
          <div class="summary-block">
            <div class="summary-label">请求</div>
            <div class="summary-value">{{ formatRequestCount(result.requests) }} 次</div>
          </div>
          <div class="summary-block">
            <div class="summary-label">峰值</div>
            <div class="summary-value peak">{{ peakText }}</div>
          </div>
        </div>
        <el-alert
          v-if="result.error"
          :title="result.error"
          type="error"
          :closable="false"
          show-icon
          class="traffic-alert"
        />

        <template v-if="hasTraffic">
          <div class="section-head">
            <span>趋势</span>
            <span class="section-meta">{{ currentPreset.label }}</span>
          </div>
          <div class="chart-wrap">
            <div class="chart-panel">
              <div class="chart-y">
                <span>{{ formatTrafficBytes(chartMaxBytes) }}</span>
                <span>0</span>
              </div>
              <div class="chart" :class="{ dense: chartPoints.length > 48 }">
                <span
                  v-for="bar in chartPoints"
                  :key="bar.time"
                  class="chart-bar"
                  :class="{ empty: !bar.bytes, peak: bar.isPeak }"
                  :style="{ height: bar.height + '%' }"
                  :title="`${bar.time}  ${formatTrafficBytes(bar.bytes)} · ${formatRequestCount(bar.requests)} 次`"
                />
              </div>
            </div>
            <div class="chart-axis">
              <span v-for="tick in chartAxis" :key="tick">{{ tick }}</span>
            </div>
          </div>

          <div class="section-head">
            <span>明细</span>
            <span class="section-meta">最新在前</span>
          </div>
          <el-table
            :data="tablePoints"
            stripe
            size="small"
            max-height="480"
            empty-text="该时段没有访问"
            :row-class-name="tableRowClass"
          >
            <el-table-column prop="time" label="时间" width="150" />
            <el-table-column label="流量" width="120">
              <template #default="{ row }">
                <span class="num" :class="{ muted: !row.bytes }">{{ formatTrafficBytes(row.bytes) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="请求" width="110">
              <template #default="{ row }">
                <span class="num" :class="{ muted: !row.requests }">{{ formatRequestCount(row.requests) }} 次</span>
              </template>
            </el-table-column>
            <el-table-column label="占比">
              <template #default="{ row }">
                <div class="bar-track">
                  <div class="bar-fill" :class="{ peak: peakPoint && row.time === peakPoint.time }" :style="{ width: barWidth(row.bytes) }" />
                </div>
              </template>
            </el-table-column>
          </el-table>
        </template>
        <el-empty v-else description="该时段没有访问" />
      </template>
      <el-empty v-else-if="!loading" description="统计失败，请刷新重试" />
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Refresh } from '@element-plus/icons-vue'
import api from '@/api'

const presets = [
  { value: 'hour-today', label: '今日小时', granularity: 'hour', range: 'today' },
  { value: 'day-7d', label: '近7天', granularity: 'day', range: '7d' },
  { value: 'minute-1h', label: '近1小时', granularity: 'minute', range: '1h' },
  { value: 'minute-today', label: '今日分钟', granularity: 'minute', range: 'today' }
]

const route = useRoute()
const router = useRouter()
const selectedId = ref(null)
const preset = ref('hour-today')
const hideEmpty = ref(true)
const siteOptions = ref([])
const siteLoading = ref(false)
const loading = ref(false)
const result = ref(null)
let queryToken = 0

const currentPreset = computed(() => presets.find((item) => item.value === preset.value) || presets[0])

const currentSiteName = computed(() => {
  return result.value?.full_domain
    || siteOptions.value.find((s) => s.id === selectedId.value)?.full_domain
    || route.query.domain
    || ''
})

const points = computed(() => result.value?.points || [])

const displayPoints = computed(() => {
  if (!hideEmpty.value) return points.value
  return points.value.filter((p) => p.bytes || p.requests)
})

const maxBytes = computed(() => Math.max(0, ...points.value.map((p) => Number(p.bytes) || 0)))
const hasTraffic = computed(() => maxBytes.value > 0 || points.value.some((p) => Number(p.requests) > 0))

const peakPoint = computed(() => {
  let peak = null
  for (const p of points.value) {
    if (!peak || (Number(p.bytes) || 0) > (Number(peak.bytes) || 0)) peak = p
  }
  return peak && Number(peak.bytes) > 0 ? peak : null
})

const peakText = computed(() => {
  if (!peakPoint.value) return '—'
  return `${peakPoint.value.time} · ${formatTrafficBytes(peakPoint.value.bytes)}`
})

const chartPoints = computed(() => {
  const source = downsamplePoints(points.value, 96)
  const max = Math.max(0, ...source.map((p) => Number(p.bytes) || 0))
  let peakMarked = false
  return source.map((p) => {
    const bytes = Number(p.bytes) || 0
    const isPeak = !peakMarked && max > 0 && bytes === max
    if (isPeak) peakMarked = true
    return {
      ...p,
      height: max <= 0 ? 4 : Math.max(4, Math.round(bytes / max * 100)),
      isPeak
    }
  })
})

const chartMaxBytes = computed(() => Math.max(0, ...chartPoints.value.map((p) => Number(p.bytes) || 0)))

const chartAxis = computed(() => {
  const pts = chartPoints.value
  if (!pts.length) return []
  if (pts.length === 1) return [pts[0].time]
  if (pts.length === 2) return [pts[0].time, pts[1].time]
  const mid = pts[Math.floor((pts.length - 1) / 2)]
  return [pts[0].time, mid.time, pts[pts.length - 1].time]
})

const tablePoints = computed(() => [...displayPoints.value].reverse())

function downsamplePoints(list, maxBars) {
  if (!list.length || list.length <= maxBars) return list
  const size = Math.ceil(list.length / maxBars)
  const out = []
  for (let i = 0; i < list.length; i += size) {
    const slice = list.slice(i, i + size)
    out.push({
      time: slice[0].time,
      requests: slice.reduce((sum, p) => sum + (Number(p.requests) || 0), 0),
      bytes: slice.reduce((sum, p) => sum + (Number(p.bytes) || 0), 0)
    })
  }
  return out
}

function goBack() {
  router.push({ name: 'Subdomains' })
}

function tableRowClass({ row }) {
  return peakPoint.value && row.time === peakPoint.value.time ? 'is-peak' : ''
}

watch([selectedId, preset], () => {
  if (selectedId.value) runQuery()
  else result.value = null
})

watch(() => route.query.id, (id) => {
  applyRouteSite(id, route.query.domain)
})

function applyRouteSite(id, domain) {
  const queryId = Number(id)
  if (!queryId) return
  selectedId.value = queryId
  if (domain) mergeSite({ id: queryId, full_domain: String(domain) })
}

function barWidth(bytes) {
  const max = maxBytes.value
  if (max <= 0) return '0%'
  return `${Math.max(2, Math.round((Number(bytes) || 0) / max * 100))}%`
}

function formatTrafficBytes(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB'
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB'
}

function formatRequestCount(count) {
  const n = Number(count) || 0
  if (n < 10000) return String(n)
  if (n < 100000000) return (n / 10000).toFixed(n < 100000 ? 1 : 0) + '万'
  return (n / 100000000).toFixed(2) + '亿'
}

function mapSites(list) {
  return (list || []).map((s) => ({
    id: Number(s.id),
    full_domain: s.subdomain === '@' ? s.main_domain : `${s.subdomain}.${s.main_domain}`
  }))
}

function mergeSite(site) {
  if (!site?.id) return
  const id = Number(site.id)
  const fullDomain = site.full_domain
  if (!fullDomain) return
  const current = siteOptions.value.find((s) => s.id === id)
  if (!current) {
    siteOptions.value = [{ id, full_domain: fullDomain }, ...siteOptions.value]
  } else if (!current.full_domain) {
    current.full_domain = fullDomain
  }
}

async function searchSites(keyword) {
  siteLoading.value = true
  try {
    const res = await api.get('/dns/subdomains', {
      params: { page: 1, pageSize: 50, keyword: keyword || undefined }
    })
    siteOptions.value = mapSites(res.list)
    if (result.value?.id && result.value.full_domain) {
      mergeSite({ id: result.value.id, full_domain: result.value.full_domain })
    } else if (selectedId.value && route.query.domain) {
      mergeSite({ id: selectedId.value, full_domain: String(route.query.domain) })
    }
  } finally {
    siteLoading.value = false
  }
}

async function runQuery() {
  if (!selectedId.value) {
    result.value = null
    return
  }
  const token = ++queryToken
  loading.value = true
  try {
    const res = await api.get(`/dns/subdomains/${selectedId.value}/traffic-series`, {
      params: {
        granularity: currentPreset.value.granularity,
        range: currentPreset.value.range
      }
    })
    if (token !== queryToken) return
    result.value = res
    if (res?.id && res.full_domain) {
      mergeSite({ id: res.id, full_domain: res.full_domain })
    }
  } catch {
    if (token !== queryToken) return
    result.value = null
  } finally {
    if (token === queryToken) loading.value = false
  }
}

onMounted(async () => {
  applyRouteSite(route.query.id, route.query.domain)
  await searchSites('')
})
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
  flex-wrap: wrap;
}

.domain-filter-tag {
  font-weight: 400;
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
  width: 260px;
  flex-shrink: 0;
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

.summary-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.summary-block {
  padding: 14px 16px;
  background: #f8f9fb;
  border: 1px solid #eef0f4;
  border-radius: 10px;
}

.summary-label {
  font-size: 12px;
  color: #909399;
  margin-bottom: 6px;
}

.summary-value {
  font-size: 20px;
  font-weight: 600;
  color: #303133;
  font-variant-numeric: tabular-nums;
  line-height: 1.3;
}

.summary-value.peak {
  font-size: 15px;
}

.approx {
  margin-left: 4px;
  color: #e6a23c;
  font-size: 14px;
}

.traffic-alert {
  margin-bottom: 14px;
}

.section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin: 4px 0 8px;
  font-size: 13px;
  font-weight: 600;
  color: #303133;
}

.section-meta {
  font-size: 12px;
  font-weight: 400;
  color: #909399;
}

.chart-wrap {
  margin-bottom: 18px;
  padding: 14px 14px 10px;
  background: #f8f9fb;
  border: 1px solid #eef0f4;
  border-radius: 10px;
}

.chart-panel {
  display: grid;
  grid-template-columns: 64px 1fr;
  gap: 8px;
  align-items: stretch;
}

.chart-y {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  align-items: flex-end;
  padding: 2px 0;
  font-size: 11px;
  color: #909399;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.chart {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  height: 132px;
}

.chart.dense {
  gap: 1px;
}

.chart-bar {
  flex: 1;
  min-width: 3px;
  background: #409eff;
  border-radius: 2px 2px 0 0;
}

.chart-bar.empty {
  background: #e4e7ed;
}

.chart.dense .chart-bar {
  min-width: 2px;
}

.chart-axis {
  display: flex;
  justify-content: space-between;
  margin: 8px 0 0 72px;
  font-size: 12px;
  color: #909399;
  font-variant-numeric: tabular-nums;
}

.num {
  font-variant-numeric: tabular-nums;
}

.num.muted {
  color: #c0c4cc;
}

.bar-track {
  height: 8px;
  background: #ebeef5;
  border-radius: 4px;
  overflow: hidden;
}

.bar-fill {
  height: 100%;
  background: #409eff;
  border-radius: 4px;
}

.chart-bar.peak {
  background: #e6a23c;
}

.bar-fill.peak {
  background: #e6a23c;
}

:deep(.is-peak) {
  --el-table-tr-bg-color: #fff7e6;
}

@media (max-width: 900px) {
  .filter-search,
  .filter-checks,
  .record-count {
    width: 100%;
    margin-left: 0;
  }

  .summary-row {
    grid-template-columns: 1fr;
  }

  .chart-panel {
    grid-template-columns: 52px 1fr;
  }

  .chart-axis {
    margin-left: 60px;
  }
}
</style>
