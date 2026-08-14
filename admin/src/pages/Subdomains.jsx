import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Alert,
  Button,
  Checkbox,
  Descriptions,
  Divider,
  Dropdown,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popover,
  Progress,
  Radio,
  Result,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Tooltip,
  message
} from 'antd'
import { DownOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import api from '@/api'
import { qk } from '@/api/queryKeys'
import PageCard from '@/components/PageCard'
import NginxDialog from '@/components/NginxDialog'
import { confirmAction, copyText, formatDateTime, formatUploadSize } from '@/utils'
import { PAGE_SIZE, PAGE_SIZES } from '@/utils/pagination'
import {
  getDomainFilterableTags,
  getTagStyle,
  groupServersByDomainTags,
  parseTagList,
  pickDefaultServerForDomain
} from '@/utils/server-tag-filter'
import './Subdomains.css'

const FTP_SPACE_PRESETS = [
  { label: '50MB', value: '50' },
  { label: '100MB', value: '100' },
  { label: '200MB', value: '200' },
  { label: '300MB', value: '300' },
  { label: '500MB', value: '500' },
  { label: '1GB', value: '1024' },
  { label: '自定义', value: 'custom' }
]

const RENEW_INCREASE_OPTIONS = [
  { label: '1个月', shortLabel: '+1个月', value: 1 },
  { label: '3个月', shortLabel: '+3个月', value: 3 },
  { label: '6个月', shortLabel: '+6个月', value: 6 },
  { label: '1年', shortLabel: '+1年', value: 12 },
  { label: '2年', shortLabel: '+2年', value: 24 },
  { label: '3年', shortLabel: '+3年', value: 36 }
]

const RENEW_DECREASE_OPTIONS = [
  { label: '扣减1个月', shortLabel: '-1个月', value: -1 },
  { label: '扣减3个月', shortLabel: '-3个月', value: -3 },
  { label: '扣减6个月', shortLabel: '-6个月', value: -6 }
]

const STATUS_OPTIONS = [
  { value: 'unused', label: '未使用', desc: '尚未分配或空闲', type: 'info' },
  { value: 'used', label: '已使用', desc: '正在对外提供服务', type: 'success' },
  { value: 'disabled', label: '已停用', desc: 'Nginx 禁用，DNS 保留，可快速恢复', type: 'danger' }
]

const emptyJob = {
  job_id: '',
  status: '',
  message: '',
  total: 0,
  done: 0,
  success: 0,
  failed: 0,
  percent: 0
}

const emptyFtpInfo = {
  has_ftp: false,
  full_domain: '',
  server_ip: '',
  username: '',
  password: '',
  port: 21,
  home_dir: '',
  auth_code: '',
  sync_status: ''
}

function calcDurationDays(value, unit) {
  const v = parseInt(value, 10) || 1
  if (unit === 'day') return v
  if (unit === 'month') return v * 31
  if (unit === 'year') return v * 365
  return v
}

function calcFtpMaxUploadSize(source) {
  if (source.ftp_space_preset === 'custom') {
    const value = Number(source.ftp_space_custom_value) || 500
    if (source.ftp_space_custom_unit === 'GB') {
      return Math.round(value * 1024 * 1024 * 1024)
    }
    return Math.round(value * 1024 * 1024)
  }
  const mb = parseInt(source.ftp_space_preset, 10) || 500
  return mb * 1024 * 1024
}

function customDurationToMonths(value, unit) {
  if (unit === 'day') return Math.round(value / 30)
  if (unit === 'year') return value * 12
  return value
}

function getUseStatusColor(status) {
  const colors = { unused: 'default', used: 'success', disabled: 'error' }
  return colors[status] || 'default'
}

function getUseStatusText(status) {
  const texts = { unused: '未使用', used: '已使用', disabled: '已停用' }
  return texts[status] || '未使用'
}

function getDnsStatusColor(status) {
  if (status === 'active') return 'success'
  if (status === 'dns_error') return 'error'
  return 'warning'
}

function getDnsStatusText(status) {
  const texts = { active: '正常', dns_error: '异常', pending: '待同步' }
  return texts[status] || status || '未知'
}

function isExpired(expireAt) {
  if (!expireAt) return false
  return new Date(expireAt) < new Date()
}

function getRemainingDays(expireAt) {
  if (!expireAt) return 0
  const diff = new Date(expireAt) - new Date()
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
}

function getExpireClass(expireAt) {
  if (isExpired(expireAt)) return 'expire-danger'
  if (getRemainingDays(expireAt) <= 7) return 'expire-warning'
  return 'expire-success'
}

function formatDateShort(value) {
  if (!value) return '-'
  return String(value).slice(0, 10)
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

function padDatePart(n) {
  return String(n).padStart(2, '0')
}

function todayIsoDate() {
  const d = new Date()
  return `${d.getFullYear()}-${padDatePart(d.getMonth() + 1)}-${padDatePart(d.getDate())}`
}

function isTodayDate(date) {
  return String(date || '') === todayIsoDate()
}

function formatWeekDate(date) {
  const s = String(date || '')
  if (isTodayDate(s)) return '今天'
  const m = s.match(/^\d{4}-(\d{2})-(\d{2})$/)
  return m ? `${m[1]}-${m[2]}` : s
}

function weekBarWidth(bytes, days) {
  const max = Math.max(0, ...(days || []).map((d) => Number(d.bytes) || 0))
  if (max <= 0) return '0%'
  return `${Math.max(4, Math.round((Number(bytes) || 0) / max * 100))}%`
}

function getDurationText(months) {
  const absMonths = Math.abs(months)
  const prefix = months > 0 ? '增加 ' : '扣减 '
  if (absMonths >= 12 && absMonths % 12 === 0) return prefix + (absMonths / 12) + ' 年'
  if (absMonths >= 1) return prefix + absMonths + ' 个月'
  return prefix + Math.round(absMonths * 30) + ' 天'
}

function getDurationActionText(duration) {
  return Number(duration) > 0 ? '续费' : '扣减'
}

function getUploadUrl(row) {
  if (row.ftp_auth_code) return `${window.location.origin}?code=${row.ftp_auth_code}`
  return null
}

function fullDomainOf(row) {
  if (!row) return ''
  return row.subdomain === '@' ? row.main_domain : `${row.subdomain}.${row.main_domain}`
}

function formatServerLabel(server) {
  const tags = parseTagList(server.tags)
  const tagText = tags.length ? ` · ${tags.join('/')}` : ''
  const defaultText = server.is_default === 1 ? ' (默认)' : ''
  return `${server.name} (${server.ip})${tagText}${defaultText}`
}

function jobProgressStatus(status) {
  if (status === 'completed') return 'success'
  if (status === 'error') return 'exception'
  return undefined
}

function jobProgressColor(status) {
  if (status === 'completed_with_errors') return '#e6a23c'
  return undefined
}

function toServerSelectOptions(groups) {
  return groups.map((group) => ({
    label: group.label,
    options: group.servers.map((s) => ({ value: s.id, label: formatServerLabel(s) }))
  }))
}

function DomainOption({ domain, tags }) {
  const list = parseTagList(domain.tags)
  return (
    <div className="domain-option">
      <span>{domain.domain}{domain.is_default === 1 ? ' (默认)' : ''}</span>
      {list.length ? (
        <span className="domain-option-tags">
          {list.map((tag) => (
            <Tag key={tag} style={getTagStyle(tag, tags)}>{tag}</Tag>
          ))}
        </span>
      ) : null}
    </div>
  )
}

function FtpSpacePicker({ value, onChange }) {
  return (
    <div className="ftp-space-picker">
      <Radio.Group
        value={value.ftp_space_preset}
        optionType="button"
        size="small"
        onChange={(e) => onChange({ ...value, ftp_space_preset: e.target.value })}
        options={FTP_SPACE_PRESETS}
      />
      {value.ftp_space_preset === 'custom' ? (
        <div className="ftp-space-custom">
          <InputNumber
            min={1}
            max={10240}
            style={{ width: 120 }}
            value={value.ftp_space_custom_value}
            onChange={(v) => onChange({ ...value, ftp_space_custom_value: v || 1 })}
          />
          <Select
            style={{ width: 80 }}
            value={value.ftp_space_custom_unit}
            onChange={(v) => onChange({ ...value, ftp_space_custom_unit: v })}
            options={[{ value: 'MB', label: 'MB' }, { value: 'GB', label: 'GB' }]}
          />
        </div>
      ) : null}
      <div className="ftp-space-hint">默认 {formatUploadSize(calcFtpMaxUploadSize(value))}，上传总容量上限</div>
    </div>
  )
}

function TrafficWeekPanel({ traffic }) {
  if (traffic.trafficWeekLoading) return <div className="traffic-week-status">正在统计近 7 天…</div>
  if (traffic.trafficWeekError) return <div className="traffic-week-status is-error">{traffic.trafficWeekError}</div>
  if (!traffic.trafficWeek) return <div className="traffic-week-status">准备统计…</div>
  return (
    <div className="traffic-week">
      <div className="traffic-week-head">
        <span>近 7 天</span>
        <span>
          {formatTrafficBytes(traffic.trafficWeek.bytes)}
          · {formatRequestCount(traffic.trafficWeek.requests)} 次
          {!traffic.trafficWeek.accurate ? <span className="traffic-approx">≈</span> : null}
        </span>
      </div>
      {(traffic.trafficWeek.days || []).map((day) => (
        <div key={day.date} className={`traffic-week-row${isTodayDate(day.date) ? ' today' : ''}`}>
          <span className="traffic-week-date">{formatWeekDate(day.date)}</span>
          <div className="traffic-week-track">
            <div className="traffic-week-fill" style={{ width: weekBarWidth(day.bytes, traffic.trafficWeek.days) }} />
          </div>
          <span className="traffic-week-metric">
            <span className="traffic-week-bytes">{formatTrafficBytes(day.bytes)}</span>
            <span className="traffic-week-count">{formatRequestCount(day.requests)} 次</span>
          </span>
        </div>
      ))}
      <div className="traffic-week-foot">点击查看分时明细</div>
    </div>
  )
}

export default function Subdomains() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { data: domains = [] } = useQuery({ queryKey: qk.domains, queryFn: () => api.get('/dns/domains') })
  const { data: servers = [] } = useQuery({ queryKey: qk.servers, queryFn: () => api.get('/servers') })
  const { data: tags = [] } = useQuery({ queryKey: qk.tags, queryFn: () => api.get('/tags') })

  const [searchKeyword, setSearchKeyword] = useState('')
  const [debouncedKeyword, setDebouncedKeyword] = useState('')
  const [filterDomainId, setFilterDomainId] = useState(() => {
    const v = searchParams.get('domain_id')
    return v ? Number(v) : null
  })
  const [filterServerId, setFilterServerId] = useState(() => {
    const v = searchParams.get('server_id')
    return v ? Number(v) : null
  })
  const [filterStatus, setFilterStatus] = useState(null)
  const [filterExpiringSoon, setFilterExpiringSoon] = useState(false)
  const [filterExpired, setFilterExpired] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(PAGE_SIZE)
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [selectedRowKeys, setSelectedRowKeys] = useState([])
  const [selectedRows, setSelectedRows] = useState([])
  const [trafficMap, setTrafficMap] = useState({})

  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [form] = Form.useForm()

  const [batchOpen, setBatchOpen] = useState(false)
  const [batchCreating, setBatchCreating] = useState(false)
  const [batchForm, setBatchForm] = useState({})
  const [batchResults, setBatchResults] = useState([])
  const [batchJob, setBatchJob] = useState(emptyJob)

  const [nginxOpen, setNginxOpen] = useState(false)
  const [currentSubdomain, setCurrentSubdomain] = useState(null)

  const [statusOpen, setStatusOpen] = useState(false)
  const [statusChanging, setStatusChanging] = useState(false)
  const [statusForm, setStatusForm] = useState({})

  const [renewOpen, setRenewOpen] = useState(false)
  const [renewing, setRenewing] = useState(false)
  const [renewForm, setRenewForm] = useState({})

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteForm, setDeleteForm] = useState({ rows: [], delete_ftp: false, delete_files: false })

  const [checkDirectOpen, setCheckDirectOpen] = useState(false)
  const [checkingDirect, setCheckingDirect] = useState(false)
  const [directCheckResult, setDirectCheckResult] = useState(null)
  const [directCheckRow, setDirectCheckRow] = useState(null)

  const [deployingScript, setDeployingScript] = useState(false)
  const [deployScriptOpen, setDeployScriptOpen] = useState(false)
  const [deployScriptJob, setDeployScriptJob] = useState(emptyJob)

  const [ftpInfoOpen, setFtpInfoOpen] = useState(false)
  const [ftpInfoLoading, setFtpInfoLoading] = useState(false)
  const [showFtpPassword, setShowFtpPassword] = useState(false)
  const [ftpInfo, setFtpInfo] = useState(emptyFtpInfo)

  const [remarkOpen, setRemarkOpen] = useState(false)
  const [remarkSaving, setRemarkSaving] = useState(false)
  const [remarkForm, setRemarkForm] = useState({ id: null, fullDomain: '', remark: '' })

  const [batchRenewOpen, setBatchRenewOpen] = useState(false)
  const [batchRenewDuration, setBatchRenewDuration] = useState(null)
  const [batchRenewing, setBatchRenewing] = useState(false)
  const [batchCustomValue, setBatchCustomValue] = useState(1)
  const [batchCustomUnit, setBatchCustomUnit] = useState('month')

  const [rateLimitOpen, setRateLimitOpen] = useState(false)
  const [rateLimitSaving, setRateLimitSaving] = useState(false)
  const [rateLimitForm, setRateLimitForm] = useState({})

  const trafficLoadToken = useRef(0)
  const trafficMapRef = useRef({})
  const batchPollTimer = useRef(null)
  const deployScriptPollTimer = useRef(null)
  const skipTrafficRef = useRef(false)
  const prevBatchDomainId = useRef()
  trafficMapRef.current = trafficMap

  const formId = Form.useWatch('id', form)
  const formDomainId = Form.useWatch('domain_id', form)
  const formRecordType = Form.useWatch('record_type', form) || 'A'
  const formAutoFtp = Form.useWatch('auto_ftp', form)
  const formAutoNginx = Form.useWatch('auto_nginx', form)
  const formFtpPreset = Form.useWatch('ftp_space_preset', form)
  const formFtpCustomValue = Form.useWatch('ftp_space_custom_value', form)
  const formFtpCustomUnit = Form.useWatch('ftp_space_custom_unit', form)

  const activeDomains = useMemo(() => domains.filter((d) => d.status !== 'disabled'), [domains])
  const availableServers = useMemo(() => servers.filter((s) => s.status !== 'disabled'), [servers])
  const currentDomain = domains.find((d) => d.id === filterDomainId) || null
  const currentServerFilter = servers.find((s) => s.id === filterServerId) || null
  const selectedFormDomain = domains.find((d) => d.id === formDomainId)
  const selectedBatchDomain = domains.find((d) => d.id === batchForm.domain_id)
  const formDomainFilterTags = getDomainFilterableTags(selectedFormDomain, tags)
  const batchDomainFilterTags = getDomainFilterableTags(selectedBatchDomain, tags)
  const formServerGroups = groupServersByDomainTags(servers, selectedFormDomain, tags)
  const batchServerGroups = groupServersByDomainTags(servers, selectedBatchDomain, tags)

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedKeyword(searchKeyword.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [searchKeyword])

  useEffect(() => {
    loadData()
  }, [page, pageSize, filterDomainId, filterServerId, filterStatus, filterExpiringSoon, filterExpired, debouncedKeyword])

  useEffect(() => {
    if (!dialogOpen || formId || !formDomainId) return
    applyDefaultServerToForm(formDomainId)
  }, [dialogOpen, formId, formDomainId])

  useEffect(() => {
    if (!batchOpen || !batchForm.domain_id) return
    if (prevBatchDomainId.current === batchForm.domain_id) return
    prevBatchDomainId.current = batchForm.domain_id
    applyDefaultServerToBatchForm(batchForm.domain_id)
  }, [batchOpen, batchForm.domain_id])

  useEffect(() => () => {
    if (batchPollTimer.current) clearInterval(batchPollTimer.current)
    if (deployScriptPollTimer.current) clearInterval(deployScriptPollTimer.current)
  }, [])

  function onFilterChange(updater) {
    updater()
    setPage(1)
  }

  async function loadData(options = {}) {
    const skipTraffic = options.skipTraffic ?? skipTrafficRef.current
    skipTrafficRef.current = false
    setLoading(true)
    try {
      const params = { page, pageSize }
      if (filterDomainId) params.domain_id = filterDomainId
      if (filterServerId) params.server_id = filterServerId
      if (filterStatus) params.use_status = filterStatus
      if (filterExpiringSoon) params.expiring_soon = 1
      if (filterExpired) params.expired = 1
      if (debouncedKeyword) params.keyword = debouncedKeyword
      const res = await api.get('/dns/subdomains', { params })
      const list = res.list || []
      setRows(list)
      setTotal(res.total || 0)
      if (!skipTraffic) loadTrafficForCurrentPage(list)
    } finally {
      setLoading(false)
    }
  }

  function reload(options = {}) {
    skipTrafficRef.current = !!options.skipTraffic
    return loadData({ skipTraffic: !!options.skipTraffic })
  }

  async function loadTrafficForCurrentPage(list) {
    const token = ++trafficLoadToken.current
    const currentRows = list || rows
    if (!currentRows.length) return
    setTrafficMap((prev) => {
      const next = { ...prev }
      for (const row of currentRows) {
        next[row.id] = { ...next[row.id], trafficLoading: true, trafficError: '', trafficWeek: undefined }
      }
      return next
    })
    try {
      const res = await api.post('/dns/subdomains/traffic', {
        ids: currentRows.map((r) => r.id),
        period: 'today'
      })
      if (token !== trafficLoadToken.current) return
      const map = new Map((res.items || []).map((item) => [item.id, item]))
      setTrafficMap((prev) => {
        const next = { ...prev }
        for (const row of currentRows) {
          const item = map.get(row.id)
          if (!item) {
            next[row.id] = { ...next[row.id], traffic: null, trafficError: '无数据', trafficLoading: false }
          } else {
            next[row.id] = {
              ...next[row.id],
              traffic: { requests: item.requests || 0, bytes: item.bytes || 0, accurate: !!item.accurate },
              trafficError: item.error || '',
              trafficLoading: false
            }
          }
        }
        return next
      })
    } catch (err) {
      if (token !== trafficLoadToken.current) return
      const error = err?.data?.error || err.message || '加载失败'
      setTrafficMap((prev) => {
        const next = { ...prev }
        for (const row of currentRows) {
          next[row.id] = { ...next[row.id], traffic: null, trafficError: error, trafficLoading: false }
        }
        return next
      })
    }
  }

  async function loadTrafficForRow(row) {
    if (!row?.id) return
    setTrafficMap((prev) => ({ ...prev, [row.id]: { ...prev[row.id], trafficLoading: true, trafficError: '' } }))
    try {
      const res = await api.get(`/dns/subdomains/${row.id}/traffic`, { params: { period: 'today' } })
      setTrafficMap((prev) => ({
        ...prev,
        [row.id]: {
          ...prev[row.id],
          traffic: { requests: res.requests || 0, bytes: res.bytes || 0, accurate: !!res.accurate },
          trafficLoading: false,
          trafficError: ''
        }
      }))
    } catch (err) {
      setTrafficMap((prev) => ({
        ...prev,
        [row.id]: {
          ...prev[row.id],
          traffic: null,
          trafficError: err?.data?.error || err.message || '加载失败',
          trafficLoading: false
        }
      }))
    }
  }

  async function loadWeekTraffic(row) {
    const current = trafficMapRef.current[row.id]
    if (!row?.id || current?.trafficWeekLoading || current?.trafficWeek) return
    setTrafficMap((prev) => ({ ...prev, [row.id]: { ...prev[row.id], trafficWeekLoading: true, trafficWeekError: '' } }))
    try {
      const res = await api.get(`/dns/subdomains/${row.id}/traffic`, { params: { period: '7d' } })
      setTrafficMap((prev) => ({
        ...prev,
        [row.id]: {
          ...prev[row.id],
          trafficWeek: {
            requests: res.requests || 0,
            bytes: res.bytes || 0,
            accurate: !!res.accurate,
            days: [...(res.days || [])].reverse().map((d) => ({
              date: d.date,
              bytes: Number(d.bytes) || 0,
              requests: Number(d.requests) || 0
            }))
          },
          trafficWeekError: res.error || '',
          trafficWeekLoading: false
        }
      }))
    } catch (err) {
      setTrafficMap((prev) => ({
        ...prev,
        [row.id]: {
          ...prev[row.id],
          trafficWeek: null,
          trafficWeekError: err?.data?.error || err.message || '加载失败',
          trafficWeekLoading: false
        }
      }))
    }
  }

  function openTrafficPage(row) {
    if (!row?.id) return
    navigate(`/traffic?id=${row.id}&domain=${encodeURIComponent(fullDomainOf(row))}`)
  }

  function applyDefaultServerToForm(domainId) {
    const domain = domains.find((d) => d.id === domainId)
    const defaultServer = pickDefaultServerForDomain(servers, domain, tags)
    form.setFieldsValue({
      server_id: defaultServer?.id,
      record_value: defaultServer?.ip || ''
    })
  }

  function applyDefaultServerToBatchForm(domainId) {
    const domain = domains.find((d) => d.id === domainId)
    const defaultServer = pickDefaultServerForDomain(servers, domain, tags)
    setBatchForm((prev) => ({ ...prev, server_id: defaultServer?.id }))
  }

  function onFormServerChange(serverId) {
    const server = servers.find((s) => s.id === serverId)
    if (server) form.setFieldValue('record_value', server.ip)
  }

  async function refreshSubdomain() {
    setRefreshing(true)
    try {
      const values = form.getFieldsValue()
      const res = await api.get('/dns/generate-subdomain', {
        params: {
          prefix: values.prefix,
          suffix: values.suffix,
          length: values.subdomain_length
        }
      })
      form.setFieldValue('subdomain', res.subdomain)
    } finally {
      setRefreshing(false)
    }
  }

  async function openDialog(row) {
    if (row) {
      form.setFieldsValue({
        id: row.id,
        domain_id: row.domain_id,
        subdomain: row.subdomain,
        server_id: row.server_id,
        record_type: row.record_type,
        record_value: row.record_value,
        ttl: row.ttl || 600,
        remark: row.remark || ''
      })
    } else {
      const defaultDomain = activeDomains.find((d) => d.is_default === 1)
      const domainId = filterDomainId || defaultDomain?.id
      const domain = domains.find((d) => d.id === domainId)
      const defaultServer = pickDefaultServerForDomain(servers, domain, tags)
      form.setFieldsValue({
        id: null,
        domain_id: domainId,
        subdomain: '',
        server_id: defaultServer?.id,
        record_type: 'A',
        record_value: defaultServer?.ip || '',
        ttl: 600,
        remark: '',
        auto_ftp: true,
        auto_nginx: true,
        nginx_type: 'https',
        ftp_space_preset: '500',
        ftp_space_custom_value: 500,
        ftp_space_custom_unit: 'MB',
        prefix: 'ly',
        suffix: '',
        subdomain_length: 8,
        duration_value: 1,
        duration_unit: 'month'
      })
      setDialogOpen(true)
      await refreshSubdomain()
      return
    }
    setDialogOpen(true)
  }

  async function handleSave() {
    const values = await form.validateFields()
    setSaving(true)
    try {
      const data = {
        ...values,
        duration_days: calcDurationDays(values.duration_value, values.duration_unit),
        max_upload_size: calcFtpMaxUploadSize(values)
      }
      if (values.id) {
        await api.put(`/dns/subdomains/${values.id}`, data)
        message.success('保存成功')
      } else {
        await api.post('/dns/subdomains', data)
        message.success('添加成功')
      }
      setDialogOpen(false)
      reload()
    } finally {
      setSaving(false)
    }
  }

  function openBatchDialog() {
    const defaultDomain = activeDomains.find((d) => d.is_default === 1)
    const domainId = filterDomainId || defaultDomain?.id
    const domain = domains.find((d) => d.id === domainId)
    const defaultServer = pickDefaultServerForDomain(servers, domain, tags)
    setBatchForm({
      domain_id: domainId,
      server_id: defaultServer?.id,
      count: 10,
      auto_ftp: true,
      auto_nginx: true,
      nginx_type: 'https',
      ftp_space_preset: '500',
      ftp_space_custom_value: 500,
      ftp_space_custom_unit: 'MB',
      prefix: 'ly',
      suffix: '',
      subdomain_length: 8,
      duration_value: 1,
      duration_unit: 'month'
    })
    setBatchResults([])
    setBatchJob(emptyJob)
    prevBatchDomainId.current = domainId
    if (batchPollTimer.current) {
      clearInterval(batchPollTimer.current)
      batchPollTimer.current = null
    }
    setBatchOpen(true)
  }

  async function handleBatchCreate() {
    if (batchCreating) return
    setBatchCreating(true)
    setBatchResults([])
    setBatchJob({ ...emptyJob, status: 'pending', message: '提交任务...', total: batchForm.count })
    if (batchPollTimer.current) {
      clearInterval(batchPollTimer.current)
      batchPollTimer.current = null
    }
    try {
      const data = {
        ...batchForm,
        duration_days: calcDurationDays(batchForm.duration_value, batchForm.duration_unit),
        max_upload_size: calcFtpMaxUploadSize(batchForm)
      }
      const res = await api.post('/dns/batch-create', data)
      if (!res.async && Array.isArray(res.results)) {
        setBatchResults(res.results)
        message.success(`生成完成: 成功${res.success}个, 失败${res.failed}个`)
        reload({ skipTraffic: true })
        setBatchCreating(false)
        return
      }
      setBatchJob({
        job_id: res.job_id,
        status: res.status || 'pending',
        message: res.message || '任务已创建',
        total: res.total || batchForm.count,
        done: res.done || 0,
        success: res.success || 0,
        failed: res.failed || 0,
        percent: res.percent || 0
      })
      batchPollTimer.current = setInterval(async () => {
        try {
          const job = await api.get(`/dns/batch-jobs/${res.job_id}`)
          setBatchJob({
            job_id: res.job_id,
            status: job.status,
            message: job.message,
            total: job.total,
            done: job.done,
            success: job.success,
            failed: job.failed,
            percent: job.percent
          })
          if (['completed', 'completed_with_errors', 'error'].includes(job.status)) {
            clearInterval(batchPollTimer.current)
            batchPollTimer.current = null
            setBatchCreating(false)
            setBatchResults(Array.isArray(job.results) ? job.results : [])
            if (job.status === 'error' && !(job.success > 0)) {
              message.error(job.message || '批量生成失败')
            } else {
              message.success(job.message || `生成完成: 成功${job.success}个, 失败${job.failed}个`)
            }
            reload({ skipTraffic: true })
          }
        } catch (err) {
          clearInterval(batchPollTimer.current)
          batchPollTimer.current = null
          setBatchCreating(false)
          message.error(err.message || '查询任务进度失败')
        }
      }, 1000)
    } catch {
      setBatchCreating(false)
      setBatchJob((prev) => ({ ...prev, status: 'error', message: '提交失败' }))
    }
  }

  function openNginxDialog(row) {
    setCurrentSubdomain(row)
    setNginxOpen(true)
  }

  function openStatusDialog(row) {
    setStatusForm({
      id: row.id,
      fullDomain: fullDomainOf(row),
      use_status: row.use_status || 'unused',
      expire_at: row.expire_at || '',
      new_status: row.use_status || 'unused'
    })
    setStatusOpen(true)
  }

  async function handleStatusChange() {
    setStatusChanging(true)
    try {
      await api.put(`/dns/subdomains/${statusForm.id}/status`, { use_status: statusForm.new_status })
      message.success('状态已更新')
      setStatusOpen(false)
      const touchedNginx = statusForm.new_status === 'disabled' || statusForm.use_status === 'disabled'
      reload({ skipTraffic: !touchedNginx })
    } finally {
      setStatusChanging(false)
    }
  }

  function openRenewDialog(row) {
    setRenewForm({
      id: row.id,
      fullDomain: fullDomainOf(row),
      use_status: row.use_status || 'unused',
      expire_at: row.expire_at || '',
      quickDuration: null,
      customValue: 1,
      customUnit: 'month'
    })
    setRenewOpen(true)
  }

  async function confirmRenewAdjust() {
    const targetDuration = renewForm.quickDuration
    if (!targetDuration) return
    if (targetDuration < 0 && !renewForm.expire_at) {
      message.warning('当前未设置到期时间，无法扣减时长')
      return
    }
    try {
      const actionText = getDurationActionText(targetDuration)
      await confirmAction(
        `确定要对 "${renewForm.fullDomain}" 执行${actionText}操作吗？\n\n调整时长：${getDurationText(targetDuration)}`,
        `确认${actionText}`
      )
    } catch {
      return
    }
    setRenewing(true)
    try {
      const res = await api.post(`/dns/subdomains/${renewForm.id}/renew`, { duration_months: targetDuration })
      message.success(`${getDurationActionText(targetDuration)}成功，到期时间: ${res.expire_at}`)
      setRenewOpen(false)
      reload({ skipTraffic: true })
    } finally {
      setRenewing(false)
    }
  }

  async function handleDisable(row) {
    try {
      await confirmAction('停用将立即禁用 Nginx 访问（DNS 解析保留，恢复更快），确定？')
    } catch {
      return
    }
    const res = await api.put(`/dns/subdomains/${row.id}/status`, { use_status: 'disabled' })
    message.success(res.message || '已停用')
    reload({ skipTraffic: true })
  }

  async function handleEnable(row) {
    const res = await api.put(`/dns/subdomains/${row.id}/status`, { use_status: 'used' })
    message.success(res.message || '已启用')
    reload({ skipTraffic: true })
  }

  async function batchSetStatus(status) {
    if (!selectedRows.length) return
    const statusText = { used: '已使用', unused: '未使用', disabled: '停用' }
    const hint = status === 'disabled'
      ? `确定停用 ${selectedRows.length} 个子域名？将按服务器并行同步 Nginx（DNS 保留）；失败则统一回退。`
      : `确定将 ${selectedRows.length} 个子域名设为${statusText[status]}？失败则统一回退。`
    try {
      await confirmAction(hint, '批量操作')
    } catch {
      return
    }
    try {
      const res = await api.post('/dns/subdomains/batch-status', {
        ids: selectedRows.map((r) => r.id),
        use_status: status
      })
      message.success(res.message || `操作完成: ${res.total || selectedRows.length} 个`)
      setSelectedRowKeys([])
      setSelectedRows([])
      reload({ skipTraffic: true })
    } catch (err) {
      message.error(err?.data?.message || err.message || '批量状态更新失败，已回退')
    }
  }

  function openBatchRenewDialog() {
    if (!selectedRows.length) return
    setBatchRenewDuration(null)
    setBatchCustomValue(1)
    setBatchCustomUnit('month')
    setBatchRenewOpen(true)
  }

  async function confirmBatchAdjustDuration() {
    if (!batchRenewDuration || !selectedRows.length) return
    try {
      const actionText = getDurationActionText(batchRenewDuration)
      await confirmAction(
        `确定要对选中的 ${selectedRows.length} 个子域名执行${actionText}操作吗？\n\n调整时长：${getDurationText(batchRenewDuration)}`,
        `批量${actionText}`
      )
    } catch {
      return
    }
    setBatchRenewing(true)
    try {
      const res = await api.post('/dns/subdomains/batch-renew', {
        ids: selectedRows.map((r) => r.id),
        duration_months: batchRenewDuration
      })
      const failed = res.failed_count || 0
      message.success(
        `${res.message || getDurationActionText(batchRenewDuration) + '完成'}: 成功${res.success_count || 0}个` +
          (failed ? `, 失败${failed}个` : '') +
          (res.enabled_count ? `, 恢复启用${res.enabled_count}个` : '')
      )
      setBatchRenewOpen(false)
      setSelectedRowKeys([])
      setSelectedRows([])
      reload({ skipTraffic: true })
    } catch (err) {
      message.error(err?.data?.message || err.message || '批量时长调整失败，已回退')
    } finally {
      setBatchRenewing(false)
    }
  }

  function openDeleteDialog(targetRows) {
    setDeleteForm({ rows: targetRows, delete_ftp: false, delete_files: false })
    setDeleteOpen(true)
  }

  async function confirmDelete() {
    const targetRows = deleteForm.rows
    if (!targetRows.length) return
    setDeleting(true)
    try {
      if (targetRows.length === 1) {
        await api.delete(`/dns/subdomains/${targetRows[0].id}`, {
          data: { delete_ftp: deleteForm.delete_ftp, delete_files: deleteForm.delete_files }
        })
        message.success('删除成功')
      } else {
        const res = await api.post('/dns/subdomains/batch-delete', {
          ids: targetRows.map((r) => r.id),
          delete_ftp: deleteForm.delete_ftp,
          delete_files: deleteForm.delete_files
        })
        message.success(`删除完成: 成功 ${res.success} 个, 失败 ${res.failed} 个`)
      }
      setDeleteOpen(false)
      setSelectedRowKeys([])
      setSelectedRows([])
      reload()
    } catch (err) {
      message.error(err.message || '删除失败')
    } finally {
      setDeleting(false)
    }
  }

  async function batchDeployUploadScript() {
    if (deployingScript) return
    const ids = selectedRows.map((r) => r.id)
    const scope = ids.length > 0 ? `选中的 ${ids.length} 个` : '所有'
    try {
      await confirmAction(`确定给${scope}子域名补发直传脚本（_vhost/upload.php）？`, '补发直传脚本')
    } catch {
      return
    }
    setDeployingScript(true)
    setDeployScriptJob({ ...emptyJob, status: 'pending', message: '提交任务...', total: ids.length || 0 })
    setDeployScriptOpen(true)
    if (deployScriptPollTimer.current) {
      clearInterval(deployScriptPollTimer.current)
      deployScriptPollTimer.current = null
    }
    try {
      const res = await api.post('/dns/subdomains/batch-deploy-upload-script', { ids })
      if (!res.async) {
        const status = (res.failed > 0 && !(res.success > 0)) ? 'error' : 'completed'
        const jobMessage = res.message || `补发完成: 成功 ${res.success || 0} 个, 失败 ${res.failed || 0} 个`
        setDeployingScript(false)
        setDeployScriptJob({
          ...emptyJob,
          status,
          message: jobMessage,
          total: res.total || 0,
          done: res.total || 0,
          success: res.success || 0,
          failed: res.failed || 0,
          percent: 100
        })
        if (res.total === 0) message.info(res.message || '没有可下发的子域名')
        else if (status === 'error') message.error(jobMessage)
        else message.success(jobMessage)
        return
      }
      setDeployScriptJob({
        job_id: res.job_id,
        status: res.status || 'pending',
        message: res.message || '任务已创建',
        total: res.total || 0,
        done: res.done || 0,
        success: res.success || 0,
        failed: res.failed || 0,
        percent: res.percent || 0
      })
      deployScriptPollTimer.current = setInterval(async () => {
        try {
          const job = await api.get(`/dns/batch-jobs/${res.job_id}`)
          setDeployScriptJob({
            job_id: res.job_id,
            status: job.status,
            message: job.message,
            total: job.total,
            done: job.done,
            success: job.success,
            failed: job.failed,
            percent: job.percent
          })
          if (['completed', 'completed_with_errors', 'error'].includes(job.status)) {
            clearInterval(deployScriptPollTimer.current)
            deployScriptPollTimer.current = null
            setDeployingScript(false)
            if (job.status === 'error' && !(job.success > 0)) message.error(job.message || '批量补发失败')
            else message.success(job.message || `补发完成: 成功${job.success}个, 失败${job.failed}个`)
          }
        } catch (err) {
          clearInterval(deployScriptPollTimer.current)
          deployScriptPollTimer.current = null
          setDeployingScript(false)
          setDeployScriptJob((prev) => ({ ...prev, status: 'error', message: err.message || '查询任务进度失败' }))
          message.error(err.message || '查询任务进度失败')
        }
      }, 1000)
    } catch (err) {
      setDeployingScript(false)
      setDeployScriptJob((prev) => ({ ...prev, status: 'error', message: err.message || '补发失败' }))
    }
  }

  async function checkDirectUpload(row) {
    setDirectCheckRow(row)
    setDirectCheckResult(null)
    setCheckDirectOpen(true)
    setCheckingDirect(true)
    try {
      const res = await api.get(`/dns/subdomains/${row.id}/check-direct-upload`)
      setDirectCheckResult(res)
    } catch (err) {
      message.error(err.message || '检测失败')
      setCheckDirectOpen(false)
    } finally {
      setCheckingDirect(false)
    }
  }

  async function deployForChecked() {
    if (!directCheckRow) return
    setDeployingScript(true)
    try {
      await api.post(`/dns/subdomains/${directCheckRow.id}/deploy-upload-script`)
      message.success('补发成功，重新检测中...')
      await checkDirectUpload(directCheckRow)
    } catch (err) {
      message.error(err.message || '补发失败')
    } finally {
      setDeployingScript(false)
    }
  }

  async function openFtpInfoDialog(row) {
    setFtpInfoOpen(true)
    setFtpInfoLoading(true)
    setShowFtpPassword(false)
    setFtpInfo(emptyFtpInfo)
    try {
      const res = await api.get(`/dns/subdomains/${row.id}/ftp-info`)
      setFtpInfo(res)
    } catch (err) {
      message.error(err.message || '获取FTP信息失败')
    } finally {
      setFtpInfoLoading(false)
    }
  }

  function copyAllFtpInfo() {
    copyText(
      `网站域名：${ftpInfo.full_domain}\n服务器IP：${ftpInfo.server_ip || '-'}\nFTP用户名：${ftpInfo.username}\nFTP密码：${ftpInfo.password}\n端口：${ftpInfo.port || 21}\n目录：${ftpInfo.home_dir}\n授权码：${ftpInfo.auth_code}`,
      'FTP信息'
    )
  }

  function openRemarkDialog(row) {
    setRemarkForm({ id: row.id, fullDomain: fullDomainOf(row), remark: row.remark || '' })
    setRemarkOpen(true)
  }

  async function handleRemarkSave() {
    setRemarkSaving(true)
    try {
      await api.put(`/dns/subdomains/${remarkForm.id}/remark`, { remark: remarkForm.remark })
      message.success('备注已更新')
      setRemarkOpen(false)
      reload({ skipTraffic: true })
    } finally {
      setRemarkSaving(false)
    }
  }

  function handleShare(row) {
    const uploadUrl = `${window.location.origin}?code=${row.ftp_auth_code}`
    copyText(`上传地址：${uploadUrl}\n授权码：${row.ftp_auth_code}`, '分享信息')
  }

  function openRateLimitDialog(row) {
    setRateLimitForm({
      id: row.id,
      fullDomain: fullDomainOf(row),
      enabled: row.rate_limit_enabled === 1,
      rate: row.rate_limit_rate || '10r/s',
      burst: row.rate_limit_burst || 20,
      nodelay: row.rate_limit_nodelay !== 0,
      conn_limit: row.rate_limit_conn || 10
    })
    setRateLimitOpen(true)
  }

  function applyRateLimitPreset(preset) {
    const presets = {
      low: { rate: '100r/s', burst: 200, conn_limit: 50 },
      medium: { rate: '50r/s', burst: 100, conn_limit: 30 },
      high: { rate: '10r/s', burst: 20, conn_limit: 10 },
      strict: { rate: '5r/s', burst: 10, conn_limit: 5 }
    }
    setRateLimitForm((prev) => ({ ...prev, enabled: true, nodelay: true, ...presets[preset] }))
  }

  async function handleRateLimitSave() {
    setRateLimitSaving(true)
    try {
      const res = await api.put(`/dns/subdomains/${rateLimitForm.id}/rate-limit`, {
        enabled: rateLimitForm.enabled,
        rate: rateLimitForm.rate,
        burst: rateLimitForm.burst,
        nodelay: rateLimitForm.nodelay,
        conn_limit: rateLimitForm.conn_limit
      })
      if (res.synced) message.success('限流配置已保存并同步到服务器')
      else if (res.error) message.warning(`限流配置已保存，但同步失败: ${res.error}`)
      else message.success('限流配置已保存')
      setRateLimitOpen(false)
      reload()
    } catch (err) {
      message.error(err.response?.data?.error || '保存失败')
    } finally {
      setRateLimitSaving(false)
    }
  }

  const domainSelectOptions = activeDomains.map((d) => ({
    value: d.id,
    label: d.domain + (d.is_default === 1 ? ' (默认)' : ''),
    domain: d
  }))

  const columns = [
    {
      title: '域名信息',
      minWidth: 280,
      render: (_, row) => {
        const url = getUploadUrl(row)
        return (
          <div className="domain-cell">
            <div className="domain-primary">
              {url ? (
                <a href={url} target="_blank" rel="noreferrer" className="full-domain">{fullDomainOf(row)}</a>
              ) : (
                <span className="full-domain is-static">{fullDomainOf(row)}</span>
              )}
            </div>
            <div className="domain-secondary">
              <Tag>{row.record_type}</Tag>
              <Tooltip title={row.record_value || '-'}>
                <span className="meta-text">{row.record_value || '-'}</span>
              </Tooltip>
              <span className="meta-divider">·</span>
              <span className={`server-text${row.server_name ? '' : ' is-unbound'}`}>
                {row.server_name || '未绑定服务器'}
              </span>
            </div>
          </div>
        )
      }
    },
    {
      title: '状态',
      width: 150,
      render: (_, row) => (
        <div className="status-cell">
          <Tag color={getUseStatusColor(row.use_status)}>{getUseStatusText(row.use_status)}</Tag>
          <Tag color={getDnsStatusColor(row.status)}>DNS: {getDnsStatusText(row.status)}</Tag>
        </div>
      )
    },
    {
      title: '今日流量',
      width: 168,
      render: (_, row) => {
        const traffic = trafficMap[row.id] || {}
        if (traffic.trafficLoading) return <span className="traffic-muted">统计中</span>
        if (traffic.traffic) {
          return (
            <div className="traffic-cell">
              <Popover
                placement="bottomLeft"
                mouseEnterDelay={0.25}
                mouseLeaveDelay={0.08}
                overlayInnerStyle={{ width: 280 }}
                onOpenChange={(visible) => { if (visible) loadWeekTraffic(row) }}
                content={<TrafficWeekPanel traffic={traffic} />}
              >
                <span className="traffic-cell-inner" onClick={() => openTrafficPage(row)}>
                  <span className="traffic-main">{formatTrafficBytes(traffic.traffic.bytes)}</span>
                  <span className="traffic-sub">
                    {formatRequestCount(traffic.traffic.requests)} 次
                    {!traffic.traffic.accurate ? <span className="traffic-approx">≈</span> : null}
                  </span>
                </span>
              </Popover>
            </div>
          )
        }
        if (traffic.trafficError) {
          return (
            <Tooltip title={traffic.trafficError}>
              <span className="traffic-muted traffic-retry" onClick={() => loadTrafficForRow(row)}>重试</span>
            </Tooltip>
          )
        }
        return <span className="traffic-muted">—</span>
      }
    },
    {
      title: '有效期',
      width: 180,
      render: (_, row) => (
        row.expire_at ? (
          <div className="expire-cell">
            <span className={getExpireClass(row.expire_at)}>
              {isExpired(row.expire_at) ? '已过期' : `剩余 ${getRemainingDays(row.expire_at)} 天`}
            </span>
            <span className="expire-date">{formatDateShort(row.expire_at)}</span>
          </div>
        ) : <span style={{ color: '#999', fontSize: 12 }}>-</span>
      )
    },
    {
      title: '备注',
      minWidth: 120,
      render: (_, row) => (
        row.remark ? (
          <Tooltip title={row.remark}>
            <span className="remark-text" onDoubleClick={() => openRemarkDialog(row)}>{row.remark}</span>
          </Tooltip>
        ) : (
          <span style={{ color: '#999', cursor: 'pointer' }} onDoubleClick={() => openRemarkDialog(row)}>-</span>
        )
      )
    },
    {
      title: '操作',
      width: 300,
      fixed: 'right',
      render: (_, row) => (
        <div className="row-actions">
          {row.ftp_auth_code ? <Button type="primary" size="small" onClick={() => handleShare(row)}>分享</Button> : null}
          <Button size="small" onClick={() => openRenewDialog(row)} style={{ color: '#d46b08', borderColor: '#ffd591' }}>续费</Button>
          <Button size="small" onClick={() => openStatusDialog(row)}>状态</Button>
          <Dropdown
            className="more-actions"
            menu={{
              items: [
                { key: 'ftp', label: 'FTP 信息', onClick: () => openFtpInfoDialog(row) },
                { key: 'traffic', label: '流量统计', onClick: () => openTrafficPage(row) },
                { key: 'direct', label: '检测直传', onClick: () => checkDirectUpload(row) },
                { key: 'nginx', label: 'Nginx 配置', onClick: () => openNginxDialog(row) },
                { key: 'rate', label: '限流配置', onClick: () => openRateLimitDialog(row) },
                { key: 'remark', label: '修改备注', onClick: () => openRemarkDialog(row) },
                { key: 'edit', label: '编辑', onClick: () => openDialog(row) },
                row.use_status !== 'disabled'
                  ? { key: 'disable', label: '停用', onClick: () => handleDisable(row) }
                  : { key: 'enable', label: '启用', onClick: () => handleEnable(row) },
                { type: 'divider' },
                { key: 'del', label: <span style={{ color: '#ff4d4f' }}>删除</span>, onClick: () => openDeleteDialog([row]) }
              ]
            }}
          >
            <Button size="small">更多<DownOutlined style={{ fontSize: 10, marginLeft: 4 }} /></Button>
          </Dropdown>
        </div>
      )
    }
  ]

  const batchPreviewLen = Math.max(1, (batchForm.subdomain_length || 8) - (batchForm.prefix || '').length - (batchForm.suffix || '').length)
  const formDomainName = domains.find((d) => d.id === formDomainId)?.domain

  return (
    <div className="subdomains-page">
      <PageCard
        title={(
          <>
            子域名列表
            {currentDomain ? <Tag className="domain-filter-tag">{currentDomain.domain}</Tag> : null}
            {currentServerFilter ? <Tag className="domain-filter-tag">{currentServerFilter.name}</Tag> : null}
          </>
        )}
        extra={(
          <>
            {selectedRows.length > 0 ? (
              <Dropdown
                menu={{
                  items: [
                    { key: 'used', label: '批量设为已使用', onClick: () => batchSetStatus('used') },
                    { key: 'unused', label: '批量设为未使用', onClick: () => batchSetStatus('unused') },
                    { key: 'disabled', label: '批量停用', onClick: () => batchSetStatus('disabled') },
                    { type: 'divider' },
                    { key: 'renew', label: '批量调整时长', onClick: openBatchRenewDialog },
                    { type: 'divider' },
                    { key: 'del', label: <span style={{ color: '#ff4d4f' }}>批量删除</span>, onClick: () => openDeleteDialog(selectedRows) }
                  ]
                }}
              >
                <Button size="small" type="primary" ghost>
                  批量操作 ({selectedRows.length}) <DownOutlined />
                </Button>
              </Dropdown>
            ) : null}
            <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={() => reload()} />
            <Button type="primary" size="small" onClick={() => openDialog()}>添加子域名</Button>
            <Button size="small" onClick={openBatchDialog} style={{ color: '#389e0d', borderColor: '#b7eb8f' }}>批量生成</Button>
            <Button size="small" loading={deployingScript} onClick={batchDeployUploadScript}>补发直传脚本</Button>
          </>
        )}
        filters={(
          <>
            <Input
              allowClear
              size="small"
              prefix={<SearchOutlined />}
              placeholder="搜索域名、授权码、记录值、服务器..."
              className="filter-search"
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              onPressEnter={() => { setDebouncedKeyword(searchKeyword.trim()); setPage(1) }}
            />
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              size="small"
              placeholder="主域名"
              className="filter-select"
              value={filterDomainId}
              onChange={(v) => onFilterChange(() => setFilterDomainId(v || null))}
              options={activeDomains.map((d) => ({ value: d.id, label: d.domain }))}
            />
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              size="small"
              placeholder="服务器"
              className="filter-select filter-select-wide"
              value={filterServerId}
              onChange={(v) => onFilterChange(() => setFilterServerId(v || null))}
              options={availableServers.map((s) => ({ value: s.id, label: `${s.name} (${s.ip})` }))}
            />
            <Select
              allowClear
              size="small"
              placeholder="使用状态"
              className="filter-select filter-select-narrow"
              value={filterStatus}
              onChange={(v) => onFilterChange(() => setFilterStatus(v || null))}
              options={[
                { value: 'unused', label: '未使用' },
                { value: 'used', label: '已使用' },
                { value: 'disabled', label: '已停用' }
              ]}
            />
            <div className="filter-checks">
              <Checkbox
                checked={filterExpiringSoon}
                onChange={(e) => onFilterChange(() => setFilterExpiringSoon(e.target.checked))}
              >
                快过期
              </Checkbox>
              <Checkbox
                checked={filterExpired}
                onChange={(e) => onFilterChange(() => setFilterExpired(e.target.checked))}
              >
                已过期
              </Checkbox>
            </div>
          </>
        )}
      >
        <Table
          rowKey="id"
          size="small"
          className="subdomain-table"
          loading={loading}
          columns={columns}
          dataSource={rows}
          scroll={{ x: 1200 }}
          rowSelection={{
            selectedRowKeys,
            onChange: (keys, selected) => {
              setSelectedRowKeys(keys)
              setSelectedRows(selected)
            }
          }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showQuickJumper: true,
            pageSizeOptions: PAGE_SIZES,
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p, s) => {
              if (s !== pageSize) {
                setPage(1)
                setPageSize(s)
              } else {
                setPage(p)
              }
            }
          }}
        />
      </PageCard>

      <Modal
        title={formId ? '编辑子域名' : '添加子域名'}
        open={dialogOpen}
        confirmLoading={saving}
        width={620}
        okText="确定"
        onOk={handleSave}
        onCancel={() => setDialogOpen(false)}
        destroyOnClose
      >
        <Form form={form} labelCol={{ flex: '110px' }} colon={false}>
          <Form.Item name="id" hidden><Input /></Form.Item>
          <Form.Item name="record_type" hidden><Input /></Form.Item>
          <Form.Item name="ttl" hidden><InputNumber /></Form.Item>
          <Form.Item name="domain_id" label="主域名">
            <Select
              disabled={!!formId}
              placeholder="选择主域名"
              options={domainSelectOptions}
              optionRender={(option) => <DomainOption domain={option.data.domain} tags={tags} />}
            />
          </Form.Item>
          {formDomainFilterTags.length ? (
            <div className="server-tag-hint" style={{ margin: '-8px 0 12px 110px' }}>
              匹配标签：{formDomainFilterTags.join('、')}
            </div>
          ) : null}
          <Form.Item label="子域名">
            <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
              <Form.Item name="subdomain" noStyle>
                <Input
                  placeholder="例如: lyxxxx"
                  disabled={!!formId}
                  addonAfter={formDomainName ? `.${formDomainName}` : undefined}
                />
              </Form.Item>
              {!formId ? (
                <Button type="primary" loading={refreshing} onClick={refreshSubdomain} style={{ marginLeft: 10 }}>
                  随机生成
                </Button>
              ) : null}
            </div>
          </Form.Item>
          {!formId ? (
            <Form.Item label="生成规则">
              <Space>
                <Form.Item name="prefix" noStyle><Input placeholder="前缀" style={{ width: 70 }} /></Form.Item>
                <span style={{ color: '#999', fontSize: 12 }}>+随机+</span>
                <Form.Item name="suffix" noStyle><Input placeholder="后缀" style={{ width: 70 }} /></Form.Item>
                <span style={{ color: '#999', fontSize: 12 }}>总长</span>
                <Form.Item name="subdomain_length" noStyle>
                  <InputNumber min={3} max={20} style={{ width: 90 }} />
                </Form.Item>
              </Space>
            </Form.Item>
          ) : null}
          {formRecordType === 'A' ? (
            <Form.Item name="server_id" label="服务器">
              <Select
                allowClear
                placeholder="选择服务器"
                onChange={onFormServerChange}
                options={toServerSelectOptions(formServerGroups)}
              />
            </Form.Item>
          ) : null}
          <Form.Item name="record_value" label="记录值">
            <Input placeholder="IP地址或CNAME目标" />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input placeholder="可选备注信息" />
          </Form.Item>
          {!formId ? (
            <>
              <Form.Item label="有效期">
                <Space>
                  <Form.Item name="duration_value" noStyle><InputNumber min={1} max={100} style={{ width: 100 }} /></Form.Item>
                  <Form.Item name="duration_unit" noStyle>
                    <Select style={{ width: 80 }} options={[{ value: 'day', label: '天' }, { value: 'month', label: '月' }, { value: 'year', label: '年' }]} />
                  </Form.Item>
                  <span style={{ color: '#909399', fontSize: 12 }}>（用户首次登录后开始计算）</span>
                </Space>
              </Form.Item>
              <Form.Item name="auto_ftp" label="自动创建FTP" valuePropName="checked">
                <Switch />
              </Form.Item>
              {formAutoFtp ? (
                <Form.Item label="FTP空间">
                  <FtpSpacePicker
                    value={{
                      ftp_space_preset: formFtpPreset || '500',
                      ftp_space_custom_value: formFtpCustomValue || 500,
                      ftp_space_custom_unit: formFtpCustomUnit || 'MB'
                    }}
                    onChange={(next) => form.setFieldsValue(next)}
                  />
                </Form.Item>
              ) : null}
              <Form.Item label="自动配置Nginx">
                <Space>
                  <Form.Item name="auto_nginx" noStyle valuePropName="checked"><Switch /></Form.Item>
                  {formAutoNginx ? (
                    <Form.Item name="nginx_type" noStyle>
                      <Select style={{ width: 120 }} options={[{ value: 'https', label: 'HTTPS' }, { value: 'http', label: 'HTTP' }]} />
                    </Form.Item>
                  ) : null}
                </Space>
              </Form.Item>
            </>
          ) : null}
        </Form>
      </Modal>

      <Modal
        title="批量生成子域名"
        open={batchOpen}
        width={640}
        onCancel={() => setBatchOpen(false)}
        footer={(
          <Space>
            <Button onClick={() => setBatchOpen(false)}>关闭</Button>
            <Button type="primary" loading={batchCreating} disabled={batchCreating} onClick={handleBatchCreate}>
              {batchCreating ? '生成中...' : '开始生成'}
            </Button>
          </Space>
        )}
      >
        <Form labelCol={{ flex: '110px' }} colon={false}>
          <Form.Item label="主域名">
            <Select
              placeholder="选择主域名"
              value={batchForm.domain_id}
              onChange={(v) => setBatchForm((prev) => ({ ...prev, domain_id: v }))}
              options={domainSelectOptions}
              optionRender={(option) => <DomainOption domain={option.data.domain} tags={tags} />}
            />
            {batchDomainFilterTags.length ? (
              <div className="server-tag-hint">匹配标签：{batchDomainFilterTags.join('、')}</div>
            ) : null}
          </Form.Item>
          <Form.Item label="服务器">
            <Select
              placeholder="选择服务器"
              value={batchForm.server_id}
              onChange={(v) => setBatchForm((prev) => ({ ...prev, server_id: v }))}
              options={toServerSelectOptions(batchServerGroups)}
            />
          </Form.Item>
          <Form.Item label="生成规则">
            <Space wrap>
              <Input
                addonBefore="前缀"
                placeholder="前缀"
                style={{ width: 120 }}
                value={batchForm.prefix}
                onChange={(e) => setBatchForm((prev) => ({ ...prev, prefix: e.target.value }))}
              />
              <span style={{ color: '#999' }}>+ 随机字母 +</span>
              <Input
                addonBefore="后缀"
                placeholder="后缀"
                style={{ width: 120 }}
                value={batchForm.suffix}
                onChange={(e) => setBatchForm((prev) => ({ ...prev, suffix: e.target.value }))}
              />
            </Space>
          </Form.Item>
          <Form.Item label="总长度">
            <Space>
              <InputNumber
                min={3}
                max={20}
                value={batchForm.subdomain_length}
                onChange={(v) => setBatchForm((prev) => ({ ...prev, subdomain_length: v || 3 }))}
              />
              <span style={{ color: '#999' }}>
                预览: {batchForm.prefix}{'x'.repeat(batchPreviewLen)}{batchForm.suffix}
              </span>
            </Space>
          </Form.Item>
          <Form.Item label="生成数量">
            <Space>
              <InputNumber
                min={1}
                max={100}
                step={5}
                value={batchForm.count}
                onChange={(v) => setBatchForm((prev) => ({ ...prev, count: v || 1 }))}
              />
              <span style={{ color: '#999' }}>最多100个</span>
            </Space>
          </Form.Item>
          <Form.Item label="有效期">
            <Space>
              <InputNumber
                min={1}
                max={100}
                style={{ width: 100 }}
                value={batchForm.duration_value}
                onChange={(v) => setBatchForm((prev) => ({ ...prev, duration_value: v || 1 }))}
              />
              <Select
                style={{ width: 80 }}
                value={batchForm.duration_unit}
                onChange={(v) => setBatchForm((prev) => ({ ...prev, duration_unit: v }))}
                options={[{ value: 'day', label: '天' }, { value: 'month', label: '月' }, { value: 'year', label: '年' }]}
              />
              <span style={{ color: '#909399', fontSize: 12 }}>（用户首次登录后开始计算）</span>
            </Space>
          </Form.Item>
          <Form.Item label="自动创建FTP">
            <Switch checked={!!batchForm.auto_ftp} onChange={(v) => setBatchForm((prev) => ({ ...prev, auto_ftp: v }))} />
          </Form.Item>
          {batchForm.auto_ftp ? (
            <Form.Item label="FTP空间">
              <FtpSpacePicker value={batchForm} onChange={setBatchForm} />
            </Form.Item>
          ) : null}
          <Form.Item label="自动配置Nginx">
            <Space>
              <Switch checked={!!batchForm.auto_nginx} onChange={(v) => setBatchForm((prev) => ({ ...prev, auto_nginx: v }))} />
              {batchForm.auto_nginx ? (
                <Select
                  style={{ width: 120 }}
                  value={batchForm.nginx_type}
                  onChange={(v) => setBatchForm((prev) => ({ ...prev, nginx_type: v }))}
                  options={[{ value: 'https', label: 'HTTPS' }, { value: 'http', label: 'HTTP' }]}
                />
              ) : null}
            </Space>
          </Form.Item>
        </Form>
        {batchJob.job_id ? (
          <div className="batch-job-progress" style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13, color: '#606266' }}>
              <span>{batchJob.message || '处理中...'}</span>
              <span>{batchJob.done || 0}/{batchJob.total || batchForm.count}</span>
            </div>
            <Progress
              percent={batchJob.percent || 0}
              status={jobProgressStatus(batchJob.status)}
              strokeColor={jobProgressColor(batchJob.status)}
              strokeWidth={10}
            />
          </div>
        ) : null}
        {batchResults.length > 0 ? (
          <div style={{ marginTop: 20 }}>
            <Divider>生成结果</Divider>
            <Table
              rowKey={(r, i) => r.subdomain || i}
              size="small"
              dataSource={batchResults}
              pagination={false}
              scroll={{ y: 300 }}
              columns={[
                { title: '域名', dataIndex: 'subdomain', minWidth: 180 },
                { title: 'FTP用户', width: 120, render: (_, row) => row.ftp?.username || '-' },
                { title: '授权码', width: 100, render: (_, row) => <span style={{ color: '#e6a23c', fontWeight: 'bold' }}>{row.ftp?.auth_code || '-'}</span> },
                { title: '状态', width: 80, render: (_, row) => <Tag color={row.success ? 'success' : 'error'}>{row.success ? '成功' : '失败'}</Tag> }
              ]}
            />
          </div>
        ) : null}
      </Modal>

      <NginxDialog
        open={nginxOpen}
        subdomain={currentSubdomain}
        onClose={() => setNginxOpen(false)}
        onRefresh={() => reload()}
      />

      <Modal
        title="修改使用状态"
        open={statusOpen}
        width={480}
        onCancel={() => setStatusOpen(false)}
        okText="保存状态"
        confirmLoading={statusChanging}
        okButtonProps={{ disabled: statusForm.new_status === statusForm.use_status }}
        onOk={handleStatusChange}
      >
        <div className="status-dialog-body">
          <div className="status-info-card">
            <div className="status-domain">{statusForm.fullDomain}</div>
            <div className="status-info-grid">
              <div className="status-info-item">
                <span className="status-info-label">当前状态</span>
                <Tag color={getUseStatusColor(statusForm.use_status)}>{getUseStatusText(statusForm.use_status)}</Tag>
              </div>
              <div className="status-info-item">
                <span className="status-info-label">到期时间</span>
                {statusForm.expire_at ? (
                  <>
                    <span className={getExpireClass(statusForm.expire_at)}>{formatDateShort(statusForm.expire_at)}</span>
                    <span className="status-expire-hint">
                      {isExpired(statusForm.expire_at) ? '已过期' : `剩余 ${getRemainingDays(statusForm.expire_at)} 天`}
                    </span>
                  </>
                ) : <span className="status-expire-empty">未设置</span>}
              </div>
            </div>
          </div>
          <div className="status-picker">
            <div className="status-picker-title">选择新状态</div>
            <div className="status-options">
              {STATUS_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`status-option is-${option.type}${statusForm.new_status === option.value ? ' active' : ''}`}
                  onClick={() => setStatusForm((prev) => ({ ...prev, new_status: option.value }))}
                >
                  <span className="status-option-label">{option.label}</span>
                  <span className="status-option-desc">{option.desc}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        className="renew-dialog"
        title="续费 / 时长调整"
        open={renewOpen}
        width={560}
        onCancel={() => setRenewOpen(false)}
        okText={renewForm.quickDuration ? `确认${getDurationActionText(renewForm.quickDuration)}` : '确认调整'}
        okButtonProps={{
          disabled: !renewForm.quickDuration,
          danger: renewForm.quickDuration < 0
        }}
        confirmLoading={renewing}
        onOk={confirmRenewAdjust}
      >
        <div className="renew-dialog-body">
          <div className="renew-overview-card">
            <div className="renew-overview-main">
              <div className="renew-overview-label">调整对象</div>
              <div className="renew-overview-domain">{renewForm.fullDomain}</div>
              <div className="renew-overview-meta">
                <span className="renew-overview-meta-label">当前状态</span>
                <Tag color={getUseStatusColor(renewForm.use_status)}>{getUseStatusText(renewForm.use_status)}</Tag>
              </div>
            </div>
            <div className={`renew-expire-card${renewForm.expire_at && isExpired(renewForm.expire_at) ? ' is-expired' : ''}${renewForm.expire_at ? '' : ' is-empty'}`}>
              <div className="renew-expire-label">当前到期</div>
              {renewForm.expire_at ? (
                <>
                  <div className="renew-expire-value">{formatDateTime(renewForm.expire_at)}</div>
                  <div className="renew-expire-meta">
                    <Tag color={isExpired(renewForm.expire_at) ? 'error' : 'success'}>
                      {isExpired(renewForm.expire_at) ? '已过期' : `剩余 ${getRemainingDays(renewForm.expire_at)} 天`}
                    </Tag>
                  </div>
                </>
              ) : (
                <>
                  <div className="renew-expire-value is-muted">未设置</div>
                  <div className="renew-expire-tip">未设置到期时间时，不支持扣减操作。</div>
                </>
              )}
            </div>
          </div>
          <div className="renew-section">
            <div className="renew-section-header">
              <div className="renew-section-title">快捷续费</div>
              <div className="renew-section-tip">选择常用时长，确认后立即顺延到期时间。</div>
            </div>
            <div className="renew-quick-actions">
              {RENEW_INCREASE_OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  size="small"
                  type={renewForm.quickDuration === option.value ? 'primary' : 'default'}
                  disabled={renewing}
                  onClick={() => setRenewForm((prev) => ({ ...prev, quickDuration: option.value }))}
                >
                  {option.shortLabel}
                </Button>
              ))}
            </div>
          </div>
          <div className="renew-section">
            <div className="renew-section-header">
              <div className="renew-section-title">快捷扣减</div>
              <div className="renew-section-tip">扣减会把当前到期时间往前调整，未设置到期时间时不可用。</div>
            </div>
            <div className="renew-quick-actions renew-quick-actions--danger">
              {RENEW_DECREASE_OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  size="small"
                  danger={renewForm.quickDuration === option.value}
                  disabled={renewing || !renewForm.expire_at}
                  onClick={() => setRenewForm((prev) => ({ ...prev, quickDuration: option.value }))}
                >
                  {option.shortLabel}
                </Button>
              ))}
            </div>
          </div>
          <div className="renew-section">
            <div className="renew-section-header">
              <div className="renew-section-title">自定义时长</div>
              <div className="renew-section-tip">输入数值和单位后点击应用。扣减请使用上方快捷扣减。</div>
            </div>
            <div className="renew-custom-row">
              <InputNumber
                min={1}
                max={999}
                style={{ width: 120 }}
                value={renewForm.customValue}
                onChange={(v) => setRenewForm((prev) => ({ ...prev, customValue: v || 1, quickDuration: null }))}
              />
              <Select
                style={{ width: 110 }}
                value={renewForm.customUnit}
                onChange={(v) => setRenewForm((prev) => ({ ...prev, customUnit: v, quickDuration: null }))}
                options={[{ value: 'day', label: '天' }, { value: 'month', label: '月' }, { value: 'year', label: '年' }]}
              />
              <Button
                type="primary"
                disabled={!renewForm.customValue}
                onClick={() => setRenewForm((prev) => ({
                  ...prev,
                  quickDuration: customDurationToMonths(prev.customValue, prev.customUnit)
                }))}
              >
                应用
              </Button>
            </div>
          </div>
          {renewForm.quickDuration ? (
            <div className={`renew-selection-card ${renewForm.quickDuration > 0 ? 'is-increase' : 'is-decrease'}`}>
              <div className="renew-selection-label">已选操作</div>
              <div className="renew-selection-value">
                {getDurationActionText(renewForm.quickDuration)} {getDurationText(renewForm.quickDuration)}
              </div>
              <div className="renew-selection-tip">
                {renewForm.quickDuration > 0 ? '确认后将按当前到期时间顺延。' : '确认后将把当前到期时间向前调整。'}
              </div>
            </div>
          ) : null}
        </div>
      </Modal>

      <Modal
        title="删除子域名"
        open={deleteOpen}
        width={460}
        okText="确认删除"
        okButtonProps={{ danger: true }}
        confirmLoading={deleting}
        onOk={confirmDelete}
        onCancel={() => setDeleteOpen(false)}
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 15 }}
          message={(
            <span style={{ fontSize: 13 }}>
              即将删除 <strong style={{ color: '#f56c6c' }}>{deleteForm.rows.length}</strong> 个子域名，将同时删除 <strong>DNS 解析记录</strong> 和子域名记录，此操作不可恢复。
            </span>
          )}
        />
        <div style={{ marginBottom: 10, color: '#606266', fontSize: 13 }}>可选清理服务器上的残留资源：</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Checkbox
            checked={deleteForm.delete_ftp}
            onChange={(e) => setDeleteForm((prev) => ({ ...prev, delete_ftp: e.target.checked }))}
          >
            删除服务器上的 FTP 账号（系统用户）
          </Checkbox>
          <Checkbox
            checked={deleteForm.delete_files}
            onChange={(e) => setDeleteForm((prev) => ({ ...prev, delete_files: e.target.checked }))}
          >
            <span style={{ color: '#f56c6c' }}>删除网站文件（rm -rf 网站目录，不可恢复）</span>
          </Checkbox>
        </div>
      </Modal>

      <Modal
        title="直传可用性检测"
        open={checkDirectOpen}
        width={460}
        onCancel={() => setCheckDirectOpen(false)}
        footer={(
          <Space>
            <Button onClick={() => setCheckDirectOpen(false)}>关闭</Button>
            {directCheckResult && !directCheckResult.checks?.script_exists ? (
              <Button type="primary" loading={deployingScript} onClick={deployForChecked}>补发脚本</Button>
            ) : null}
          </Space>
        )}
      >
        <Spin spinning={checkingDirect}>
          {directCheckResult ? (
            <>
              <div style={{ marginBottom: 15, fontWeight: 600 }}>{directCheckResult.domain}</div>
              <Result
                status={directCheckResult.usable ? 'success' : 'warning'}
                title={directCheckResult.usable ? '直传已就绪' : '直传不可用，将回退中转上传'}
                subTitle={(
                  <div style={{ textAlign: 'left' }}>
                    <div className="direct-check-row">
                      <span>直传脚本已部署</span>
                      <Tag color={directCheckResult.checks.script_exists ? 'success' : 'error'}>
                        {directCheckResult.checks.script_exists ? '是' : '否'}
                      </Tag>
                    </div>
                    <div className="direct-check-row">
                      <span>网站已配置 SSL</span>
                      <Tag color={directCheckResult.checks.has_ssl ? 'success' : 'error'}>
                        {directCheckResult.checks.has_ssl ? '是' : '否'}
                      </Tag>
                    </div>
                    <div className="direct-check-row">
                      <span>网站支持 PHP</span>
                      <Tag color={(directCheckResult.checks.php_enabled || directCheckResult.checks.php_installed) ? 'success' : 'error'}>
                        {(directCheckResult.checks.php_enabled || directCheckResult.checks.php_installed) ? '是' : '否'}
                      </Tag>
                    </div>
                  </div>
                )}
              />
              {directCheckResult.problems?.length ? (
                <Alert
                  type="warning"
                  showIcon
                  message={directCheckResult.problems.map((p, i) => <div key={i} style={{ fontSize: 12, lineHeight: 1.6 }}>• {p}</div>)}
                />
              ) : null}
            </>
          ) : <div style={{ minHeight: 80 }} />}
        </Spin>
      </Modal>

      <Modal
        title="补发直传脚本"
        open={deployScriptOpen}
        width={480}
        maskClosable={!deployingScript}
        keyboard={!deployingScript}
        closable={!deployingScript}
        onCancel={() => setDeployScriptOpen(false)}
        footer={<Button disabled={deployingScript} onClick={() => setDeployScriptOpen(false)}>{deployingScript ? '执行中...' : '关闭'}</Button>}
      >
        <div className="batch-job-progress">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13, color: '#606266' }}>
            <span>{deployScriptJob.message || '处理中...'}</span>
            <span>{deployScriptJob.done || 0}/{deployScriptJob.total || 0}</span>
          </div>
          <Progress
            percent={deployScriptJob.percent || 0}
            status={jobProgressStatus(deployScriptJob.status)}
            strokeColor={jobProgressColor(deployScriptJob.status)}
            strokeWidth={10}
          />
          {deployScriptJob.success || deployScriptJob.failed ? (
            <div style={{ marginTop: 10, fontSize: 13, color: '#909399' }}>
              成功 {deployScriptJob.success || 0}，失败 {deployScriptJob.failed || 0}
            </div>
          ) : null}
        </div>
      </Modal>

      <Modal
        title="FTP 账号信息"
        open={ftpInfoOpen}
        width={480}
        onCancel={() => setFtpInfoOpen(false)}
        footer={(
          <Space>
            <Button onClick={() => setFtpInfoOpen(false)}>关闭</Button>
            {ftpInfo.has_ftp ? <Button type="primary" onClick={copyAllFtpInfo}>复制全部</Button> : null}
          </Space>
        )}
      >
        <Spin spinning={ftpInfoLoading}>
          {ftpInfo.has_ftp ? (
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="网站域名">{ftpInfo.full_domain}</Descriptions.Item>
              <Descriptions.Item label="服务器IP">{ftpInfo.server_ip || '-'}</Descriptions.Item>
              <Descriptions.Item label="FTP用户名">
                <span className="ftp-value">{ftpInfo.username}</span>
                <Button type="link" size="small" onClick={() => copyText(ftpInfo.username)}>复制</Button>
              </Descriptions.Item>
              <Descriptions.Item label="FTP密码">
                <span className="ftp-value">{showFtpPassword ? ftpInfo.password : '••••••••'}</span>
                <Button type="link" size="small" onClick={() => setShowFtpPassword((v) => !v)}>{showFtpPassword ? '隐藏' : '显示'}</Button>
                <Button type="link" size="small" onClick={() => copyText(ftpInfo.password)}>复制</Button>
              </Descriptions.Item>
              <Descriptions.Item label="端口">{ftpInfo.port || 21}</Descriptions.Item>
              <Descriptions.Item label="目录">
                <span className="ftp-value">{ftpInfo.home_dir}</span>
                <Button type="link" size="small" onClick={() => copyText(ftpInfo.home_dir)}>复制</Button>
              </Descriptions.Item>
              <Descriptions.Item label="授权码">
                <span className="ftp-value" style={{ color: '#e6a23c', fontWeight: 'bold' }}>{ftpInfo.auth_code}</span>
                <Button type="link" size="small" onClick={() => copyText(ftpInfo.auth_code)}>复制</Button>
              </Descriptions.Item>
              <Descriptions.Item label="同步状态">
                <Tag color={ftpInfo.sync_status === 'synced' ? 'success' : ftpInfo.sync_status === 'error' ? 'error' : 'warning'}>
                  {ftpInfo.sync_status === 'synced' ? '已同步' : ftpInfo.sync_status === 'error' ? '同步失败' : '待同步'}
                </Tag>
              </Descriptions.Item>
            </Descriptions>
          ) : (!ftpInfoLoading ? <Empty description="该子域名没有 FTP 账号" /> : <div style={{ minHeight: 80 }} />)}
        </Spin>
      </Modal>

      <Modal
        title="修改备注"
        open={remarkOpen}
        width={400}
        confirmLoading={remarkSaving}
        onOk={handleRemarkSave}
        onCancel={() => setRemarkOpen(false)}
      >
        <Form labelCol={{ span: 4 }}>
          <Form.Item label="域名"><span className="full-domain">{remarkForm.fullDomain}</span></Form.Item>
          <Form.Item label="备注">
            <Input.TextArea
              rows={3}
              placeholder="请输入备注信息"
              value={remarkForm.remark}
              onChange={(e) => setRemarkForm((prev) => ({ ...prev, remark: e.target.value }))}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="批量时长调整"
        open={batchRenewOpen}
        width={480}
        okText="确认调整"
        confirmLoading={batchRenewing}
        okButtonProps={{ disabled: !batchRenewDuration }}
        onOk={confirmBatchAdjustDuration}
        onCancel={() => setBatchRenewOpen(false)}
      >
        <Form labelCol={{ flex: '100px' }} colon={false}>
          <Form.Item label="选中数量"><Tag>{selectedRows.length} 个子域名</Tag></Form.Item>
          <Form.Item label="快捷续费">
            <div className="renew-quick-actions">
              {RENEW_INCREASE_OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  size="small"
                  type={batchRenewDuration === option.value ? 'primary' : 'default'}
                  disabled={batchRenewing}
                  onClick={() => setBatchRenewDuration(option.value)}
                >
                  {option.shortLabel}
                </Button>
              ))}
            </div>
            <div className="renew-quick-tip">常用时长支持一键续费，适合批量处理即将到期的域名。</div>
          </Form.Item>
          <Form.Item label="快捷扣减">
            <div className="renew-quick-actions">
              {RENEW_DECREASE_OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  size="small"
                  danger={batchRenewDuration === option.value}
                  disabled={batchRenewing}
                  onClick={() => setBatchRenewDuration(option.value)}
                >
                  {option.shortLabel}
                </Button>
              ))}
            </div>
            <div className="renew-quick-tip">批量扣减时，未设置到期时间的子域名会自动计为失败。</div>
          </Form.Item>
          <Form.Item label="自定义时长">
            <Space>
              <InputNumber
                min={1}
                max={999}
                style={{ width: 120 }}
                value={batchCustomValue}
                onChange={(v) => { setBatchCustomValue(v || 1); setBatchRenewDuration(null) }}
              />
              <Select
                style={{ width: 100 }}
                value={batchCustomUnit}
                onChange={(v) => { setBatchCustomUnit(v); setBatchRenewDuration(null) }}
                options={[{ value: 'day', label: '天' }, { value: 'month', label: '月' }, { value: 'year', label: '年' }]}
              />
              <Button
                type="primary"
                size="small"
                disabled={!batchCustomValue}
                onClick={() => setBatchRenewDuration(customDurationToMonths(batchCustomValue, batchCustomUnit))}
              >
                应用
              </Button>
            </Space>
            <div className="renew-quick-tip">输入数值和单位，点击应用按钮。负数表示扣减。</div>
          </Form.Item>
          {batchRenewDuration ? (
            <Form.Item label="已选时长">
              <Tag color={batchRenewDuration > 0 ? 'blue' : 'error'}>{getDurationText(batchRenewDuration)}</Tag>
            </Form.Item>
          ) : null}
        </Form>
      </Modal>

      <Modal
        title="限流配置"
        open={rateLimitOpen}
        width={550}
        confirmLoading={rateLimitSaving}
        okText="保存并应用"
        onOk={handleRateLimitSave}
        onCancel={() => setRateLimitOpen(false)}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 20 }}
          message={<div style={{ fontSize: 13, lineHeight: 1.6 }}>限流功能可以防止恶意请求和 DDoS 攻击，保护服务器资源。配置后会自动更新 Nginx 配置并重载。</div>}
        />
        <Form labelCol={{ flex: '120px' }} colon={false}>
          <Form.Item label="域名"><span className="full-domain">{rateLimitForm.fullDomain}</span></Form.Item>
          <Form.Item label="启用限流">
            <Space>
              <Switch checked={!!rateLimitForm.enabled} onChange={(v) => setRateLimitForm((prev) => ({ ...prev, enabled: v }))} />
              <span style={{ color: '#909399', fontSize: 12 }}>{rateLimitForm.enabled ? '已启用' : '已禁用'}</span>
            </Space>
          </Form.Item>
          {rateLimitForm.enabled ? (
            <>
              <Form.Item label="请求速率">
                <Input
                  value={rateLimitForm.rate}
                  placeholder="例如: 10r/s"
                  style={{ width: 180 }}
                  addonAfter="请求/秒"
                  onChange={(e) => setRateLimitForm((prev) => ({ ...prev, rate: e.target.value }))}
                />
                <div style={{ marginTop: 5, color: '#909399', fontSize: 12 }}>格式: 数字 + r/s (每秒) 或 r/m (每分钟)，例如: 10r/s 或 100r/m</div>
              </Form.Item>
              <Form.Item label="突发请求数">
                <InputNumber
                  min={1}
                  max={1000}
                  style={{ width: 150 }}
                  value={rateLimitForm.burst}
                  onChange={(v) => setRateLimitForm((prev) => ({ ...prev, burst: v || 1 }))}
                />
                <div style={{ marginTop: 5, color: '#909399', fontSize: 12 }}>允许的突发请求数量，超过速率限制时的缓冲区大小</div>
              </Form.Item>
              <Form.Item label="无延迟处理">
                <Space>
                  <Switch checked={!!rateLimitForm.nodelay} onChange={(v) => setRateLimitForm((prev) => ({ ...prev, nodelay: v }))} />
                  <span style={{ color: '#909399', fontSize: 12 }}>{rateLimitForm.nodelay ? '立即处理突发请求' : '延迟处理突发请求'}</span>
                </Space>
              </Form.Item>
              <Form.Item label="并发连接数">
                <InputNumber
                  min={1}
                  max={1000}
                  style={{ width: 150 }}
                  value={rateLimitForm.conn_limit}
                  onChange={(v) => setRateLimitForm((prev) => ({ ...prev, conn_limit: v || 1 }))}
                />
                <div style={{ marginTop: 5, color: '#909399', fontSize: 12 }}>单个 IP 允许的最大并发连接数</div>
              </Form.Item>
            </>
          ) : null}
          <Form.Item label="推荐配置">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Button size="small" onClick={() => applyRateLimitPreset('low')}>低限制 (100r/s, 200突发)</Button>
              <Button size="small" onClick={() => applyRateLimitPreset('medium')}>中限制 (50r/s, 100突发)</Button>
              <Button size="small" onClick={() => applyRateLimitPreset('high')}>高限制 (10r/s, 20突发)</Button>
              <Button size="small" onClick={() => applyRateLimitPreset('strict')}>严格限制 (5r/s, 10突发)</Button>
            </div>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
