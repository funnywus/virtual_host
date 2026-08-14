import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Checkbox, DatePicker, Dropdown, Form, Input, Modal, Progress, Select, Space, Table, Tabs, Tag, message } from 'antd'
import { CheckCircleOutlined, CloseCircleOutlined, LoadingOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import api from '@/api'
import { qk } from '@/api/queryKeys'
import PageCard from '@/components/PageCard'
import SslDialog from '@/components/SslDialog'
import { confirmAction, formatDateTime, formatSslDays, getSslDaysType } from '@/utils'
import { getDomainFilterableTags, getTagStyle, parseTagList, serverHasAnyTag } from '@/utils/server-tag-filter'

function getSslStatusColor(status) {
  const map = { active: 'success', issuing: 'warning', renewing: 'warning', error: 'error' }
  return map[status] || 'default'
}

function getSslStatusText(status) {
  const map = { active: '已启用', issuing: '申请中', renewing: '续期中', error: '失败' }
  return map[status] || '未申请'
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

function getBatchStatusColor(status) {
  if (status === 'completed') return 'success'
  if (status === 'completed_with_errors' || status === 'error') return 'error'
  if (status === 'running' || status === 'pending') return 'warning'
  return 'default'
}

function getTaskProgress(task) {
  if (!task || !task.total) return 0
  return Math.min(100, Math.round((task.done / task.total) * 100))
}

function isTaskRetryable(task) {
  return task && ['error', 'completed_with_errors'].includes(task.status)
}

function isTaskRunning(task) {
  return task?.status === 'running' || task?.status === 'pending'
}

function isTaskFinished(task) {
  return ['completed', 'completed_with_errors', 'error'].includes(task?.status)
}

function taskTabLabel(task) {
  const created = task.created_at
  if (created) {
    const match = String(created).match(/(\d{2}:\d{2}:\d{2})/)
    if (match) return `任务 ${match[1]}`
  }
  return `任务 ${String(task.job_id || '').slice(0, 8)}`
}

function getExpireColor(expireAt) {
  if (!expireAt) return '#909399'
  const daysLeft = Math.ceil((new Date(expireAt) - new Date()) / (1000 * 60 * 60 * 24))
  if (daysLeft < 0) return '#FF3B30'
  if (daysLeft <= 7) return '#FF9500'
  if (daysLeft <= 30) return '#FFCC00'
  return '#34C759'
}

function getExpireDaysText(expireAt) {
  if (!expireAt) return ''
  const daysLeft = Math.ceil((new Date(expireAt) - new Date()) / (1000 * 60 * 60 * 24))
  if (daysLeft < 0) return `已过期 ${Math.abs(daysLeft)} 天`
  if (daysLeft === 0) return '今天到期'
  if (daysLeft === 1) return '明天到期'
  return `还剩 ${daysLeft} 天`
}

function formatExpireAt(value) {
  if (!value) return null
  return dayjs.isDayjs(value) ? value.format('YYYY-MM-DD HH:mm:ss') : value
}

export default function Domains() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: domains = [], isFetching, refetch } = useQuery({
    queryKey: qk.domains,
    queryFn: () => api.get('/dns/domains')
  })
  const { data: tags = [] } = useQuery({
    queryKey: qk.tags,
    queryFn: () => api.get('/tags')
  })
  const { data: dnsPlatforms = [] } = useQuery({
    queryKey: qk.dnsPlatforms,
    queryFn: () => api.get('/dns/aliyun-configs')
  })
  const { data: servers = [] } = useQuery({
    queryKey: qk.servers,
    queryFn: () => api.get('/servers')
  })
  const { data: certTypes = {} } = useQuery({
    queryKey: ['ssl-types'],
    queryFn: () => api.get('/ssl/types')
  })

  const [form] = Form.useForm()
  const editingId = Form.useWatch('id', form)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [searchKeyword, setSearchKeyword] = useState('')
  const [filterTag, setFilterTag] = useState()
  const [filterStatus, setFilterStatus] = useState()
  const [selectedRowKeys, setSelectedRowKeys] = useState([])
  const [sslOpen, setSslOpen] = useState(false)
  const [currentDomain, setCurrentDomain] = useState(null)
  const [refreshingSsl, setRefreshingSsl] = useState(false)

  const [batchSslOpen, setBatchSslOpen] = useState(false)
  const [batchSslForm, setBatchSslForm] = useState({ cert_type: 'letsencrypt' })
  const [batchSslTasks, setBatchSslTasks] = useState([])
  const [activeTaskTab, setActiveTaskTab] = useState('')
  const [startingBatchSsl, setStartingBatchSsl] = useState(false)
  const [refreshingTask, setRefreshingTask] = useState(false)
  const [retryingTask, setRetryingTask] = useState(false)

  const [batchPublishOpen, setBatchPublishOpen] = useState(false)
  const [batchPublishing, setBatchPublishing] = useState(false)
  const [batchPublishLog, setBatchPublishLog] = useState('')
  const [batchPublishForm, setBatchPublishForm] = useState({
    server_ids: [],
    target_dir_template: '/www/certs/{domain}'
  })

  const pollingRef = useRef(null)
  const tasksRef = useRef([])
  const activeTabRef = useRef('')
  const logBoxRef = useRef(null)
  const publishLogRef = useRef(null)

  const availableServers = useMemo(
    () => servers.filter((s) => s.status !== 'disabled'),
    [servers]
  )

  const filteredDomains = useMemo(() => {
    let list = domains
    if (filterStatus) list = list.filter((d) => d.status === filterStatus)
    if (searchKeyword) {
      const kw = searchKeyword.toLowerCase()
      list = list.filter((d) =>
        d.domain?.toLowerCase().includes(kw)
        || d.aliyun_name?.toLowerCase().includes(kw)
        || d.tags?.toLowerCase().includes(kw)
      )
    }
    if (filterTag) {
      list = list.filter((d) => parseTagList(d.tags).includes(filterTag))
    }
    return list
  }, [domains, filterStatus, searchKeyword, filterTag])

  const selectedDomains = useMemo(
    () => domains.filter((d) => selectedRowKeys.includes(d.id)),
    [domains, selectedRowKeys]
  )
  const batchTargetDomains = selectedDomains.length > 0 ? selectedDomains : filteredDomains
  const batchPublishTargetDomains = batchTargetDomains
  const currentBatchTask = batchSslTasks.find((t) => t.job_id === activeTaskTab) || null
  const hasRunningTask = batchSslTasks.some(isTaskRunning)
  const hasCompletedTasks = batchSslTasks.some(isTaskFinished)

  useEffect(() => {
    tasksRef.current = batchSslTasks
  }, [batchSslTasks])

  useEffect(() => {
    activeTabRef.current = activeTaskTab
  }, [activeTaskTab])

  useEffect(() => () => {
    if (pollingRef.current) clearInterval(pollingRef.current)
  }, [])

  useEffect(() => {
    if (currentBatchTask?.log && logBoxRef.current) {
      logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight
    }
  }, [currentBatchTask?.log, currentBatchTask?.job_id])

  useEffect(() => {
    if (batchPublishLog && publishLogRef.current) {
      publishLogRef.current.scrollTop = publishLogRef.current.scrollHeight
    }
  }, [batchPublishLog])

  function invalidateDomains() {
    queryClient.invalidateQueries({ queryKey: qk.domains })
  }

  function stopBatchSslPolling() {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
  }

  async function loadBatchSslJob() {
    const runningTasks = tasksRef.current.filter(isTaskRunning)
    const updates = {}

    for (const task of runningTasks) {
      if (!task.job_id) {
        console.error('任务缺少 job_id:', task)
        continue
      }
      try {
        const res = await api.get(`/ssl/batch-issue/${task.job_id}`)
        updates[task.job_id] = {
          status: res.status,
          total: res.total || 0,
          done: res.done || 0,
          success: res.success || 0,
          failed: res.failed || 0,
          log: res.log || '',
          results: res.results || [],
          updated_at: res.updated_at
        }
      } catch (err) {
        if (err.message?.includes('不存在') || err.message?.includes('过期')) {
          updates[task.job_id] = {
            status: 'error',
            log: `${task.log || ''}\n[${formatDateTime(new Date())}] 任务已过期或服务器已重启，任务信息已丢失。\n提示：批量任务在24小时后会自动清理，服务器重启也会导致任务丢失。\n`
          }
        } else {
          console.error('加载任务失败:', err)
        }
      }
    }

    let nextTasks = tasksRef.current
    if (Object.keys(updates).length) {
      nextTasks = tasksRef.current.map((t) => (updates[t.job_id] ? { ...t, ...updates[t.job_id] } : t))
      tasksRef.current = nextTasks
      setBatchSslTasks(nextTasks)
    }

    if (nextTasks.filter(isTaskRunning).length === 0) {
      stopBatchSslPolling()
      invalidateDomains()
    }
  }

  function startBatchSslPolling() {
    stopBatchSslPolling()
    pollingRef.current = setInterval(() => {
      loadBatchSslJob()
    }, 1000)
  }

  async function refreshTaskById(jobId, showSuccess = true) {
    if (!jobId) {
      message.error('任务ID无效')
      return
    }
    setRefreshingTask(true)
    try {
      const res = await api.get(`/ssl/batch-issue/${jobId}`)
      setBatchSslTasks((prev) => {
        const next = prev.map((t) => (t.job_id === jobId ? {
          ...t,
          status: res.status,
          total: res.total || 0,
          done: res.done || 0,
          success: res.success || 0,
          failed: res.failed || 0,
          log: res.log || '',
          results: res.results || [],
          updated_at: res.updated_at
        } : t))
        tasksRef.current = next
        return next
      })
      if (showSuccess) message.success('刷新成功')
    } catch (err) {
      message.error(err.message || '刷新失败')
    } finally {
      setRefreshingTask(false)
    }
  }

  async function loadHistoryTasks() {
    try {
      const res = await api.get('/ssl/batch-jobs?limit=10')
      const serverJobIds = new Set(res.map((j) => j.job_id))
      const prev = tasksRef.current.filter((t) => serverJobIds.has(t.job_id) || isTaskRunning(t))
      const nextMap = new Map(prev.map((t) => [t.job_id, { ...t }]))

      for (const job of res) {
        const existing = nextMap.get(job.job_id)
        if (existing) {
          nextMap.set(job.job_id, {
            ...existing,
            status: job.status,
            total: job.total,
            done: job.done,
            success: job.success,
            failed: job.failed,
            updated_at: job.updated_at,
            finished_at: job.finished_at
          })
        } else {
          nextMap.set(job.job_id, {
            job_id: job.job_id,
            status: job.status,
            total: job.total,
            done: job.done,
            success: job.success,
            failed: job.failed,
            log: '',
            results: [],
            created_at: job.created_at,
            updated_at: job.updated_at
          })
        }
      }

      const next = [...nextMap.values()].sort(
        (a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0)
      )
      tasksRef.current = next
      setBatchSslTasks(next)

      if (next.some(isTaskRunning)) startBatchSslPolling()

      if (next.length > 0 && !activeTabRef.current) {
        const latestId = next[next.length - 1].job_id
        activeTabRef.current = latestId
        setActiveTaskTab(latestId)
        await refreshTaskById(latestId)
      }
    } catch (err) {
      console.error('加载历史任务失败:', err)
    }
  }

  function openBatchSslDialog() {
    setBatchSslOpen(true)
    loadHistoryTasks()
  }

  function backToNewTask() {
    activeTabRef.current = ''
    setActiveTaskTab('')
  }

  async function removeTask(jobId) {
    const task = tasksRef.current.find((t) => t.job_id === jobId)
    if (!task) return
    if (isTaskRunning(task)) {
      message.warning('任务正在运行中，不能删除')
      return
    }
    try {
      await confirmAction('确定删除该任务记录？删除后不可恢复', '删除任务')
    } catch {
      return
    }
    try {
      await api.delete(`/ssl/batch-issue/${jobId}`)
      const next = tasksRef.current.filter((t) => t.job_id !== jobId)
      tasksRef.current = next
      setBatchSslTasks(next)
      if (activeTabRef.current === jobId) {
        const nextId = next.length > 0 ? next[next.length - 1].job_id : ''
        activeTabRef.current = nextId
        setActiveTaskTab(nextId)
      }
      message.success('已删除')
    } catch (err) {
      message.error(err.message || '删除失败')
    }
  }

  async function clearCompletedTasks() {
    try {
      await confirmAction('确定清空所有已完成的任务？', '清空任务')
    } catch {
      return
    }
    try {
      const res = await api.delete('/ssl/batch-jobs/clear')
      const next = tasksRef.current.filter(isTaskRunning)
      tasksRef.current = next
      setBatchSslTasks(next)
      if (activeTabRef.current && !next.find((t) => t.job_id === activeTabRef.current)) {
        const nextId = next.length > 0 ? next[next.length - 1].job_id : ''
        activeTabRef.current = nextId
        setActiveTaskTab(nextId)
      }
      message.success(`已清空 ${res.count || 0} 个任务`)
    } catch (err) {
      message.error(err.message || '清空失败')
    }
  }

  async function retryBatchTask(task, mode) {
    const modeText = { remaining: '从中断位置继续', failed: '仅重试失败项', all: '全部重新执行' }
    try {
      await confirmAction(`确定${modeText[mode]}？`, '重试任务')
    } catch {
      return
    }
    setRetryingTask(true)
    try {
      const res = await api.post(`/ssl/batch-issue/${task.job_id}/retry`, {
        mode,
        cert_type: batchSslForm.cert_type
      })
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
      const next = [...tasksRef.current, newTask]
      tasksRef.current = next
      setBatchSslTasks(next)
      activeTabRef.current = newTask.job_id
      setActiveTaskTab(newTask.job_id)
      startBatchSslPolling()
      await loadBatchSslJob()
      message.success(res.message || '重试任务已启动')
    } catch (err) {
      message.error(err.message || '重试失败')
    } finally {
      setRetryingTask(false)
    }
  }

  async function startBatchSsl() {
    const targets = batchTargetDomains
    if (targets.length === 0) {
      message.warning('没有可获取证书的域名')
      return
    }
    try {
      await confirmAction(`确定后台获取 ${targets.length} 个域名的通配符证书？`, '批量获取证书')
    } catch {
      return
    }
    setStartingBatchSsl(true)
    try {
      const res = await api.post('/ssl/batch-issue', {
        domain_ids: targets.map((item) => item.id),
        cert_type: batchSslForm.cert_type
      })
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
      const next = [...tasksRef.current, newTask]
      tasksRef.current = next
      setBatchSslTasks(next)
      activeTabRef.current = newTask.job_id
      setActiveTaskTab(newTask.job_id)
      startBatchSslPolling()
      await loadBatchSslJob()
      message.success(res.message || '已开始后台获取证书')
    } catch (err) {
      message.error(err.message || '启动失败')
    } finally {
      setStartingBatchSsl(false)
    }
  }

  function openBatchPublishDialog() {
    setBatchPublishLog('')
    const targets = batchPublishTargetDomains
    const domainTags = new Set()
    for (const domain of targets) {
      getDomainFilterableTags(domain, tags).forEach((tag) => domainTags.add(tag))
    }
    let serverIds = []
    if (domainTags.size > 0) {
      serverIds = availableServers
        .filter((server) => serverHasAnyTag(server, [...domainTags]))
        .map((server) => server.id)
    } else {
      const defaultServer = availableServers.find((server) => server.is_default === 1)
      serverIds = defaultServer ? [defaultServer.id] : []
    }
    setBatchPublishForm((prev) => ({ ...prev, server_ids: serverIds }))
    setBatchPublishOpen(true)
  }

  async function executeBatchPublish() {
    const targets = batchPublishTargetDomains
    if (targets.length === 0) {
      message.warning('没有可发布的域名')
      return
    }
    if (batchPublishForm.server_ids.length === 0) {
      message.warning('请选择目标服务器')
      return
    }
    try {
      await confirmAction(
        `确定将 ${targets.length} 个域名的证书发布到 ${batchPublishForm.server_ids.length} 台服务器？`,
        '批量发布证书'
      )
    } catch {
      return
    }
    setBatchPublishing(true)
    setBatchPublishLog('')
    try {
      const res = await api.post('/ssl/batch-publish', {
        domain_ids: targets.map((d) => d.id),
        server_ids: batchPublishForm.server_ids,
        target_dir_template: batchPublishForm.target_dir_template || '/www/certs/{domain}'
      })
      setBatchPublishLog(res.log || '')
      message.success(`发布完成: 成功 ${res.success_count} 个, 失败 ${res.failed_count} 个`)
    } catch (err) {
      setBatchPublishLog(err.data?.log || err.message || '发布失败')
      message.error(err.message || '发布失败')
    } finally {
      setBatchPublishing(false)
    }
  }

  async function onTagChange(tagNames) {
    for (const tag of tagNames) {
      if (!tags.some((t) => t.name === tag)) {
        try {
          await api.post('/tags', { name: tag })
          queryClient.invalidateQueries({ queryKey: qk.tags })
        } catch {
          // 已有拦截器提示
        }
      }
    }
  }

  function openDialog(row) {
    if (row) {
      form.setFieldsValue({
        id: row.id,
        domain: row.domain,
        aliyun_config_id: row.aliyun_config_id,
        tagList: parseTagList(row.tags),
        expire_at: row.expire_at ? dayjs(row.expire_at) : null
      })
    } else {
      const defaultConfig = dnsPlatforms.find((c) => c.is_default === 1)
      const defaultTag = tags.find((t) => t.is_default === 1)
      form.setFieldsValue({
        id: null,
        domain: '',
        aliyun_config_id: defaultConfig?.id || null,
        tagList: defaultTag ? [defaultTag.name] : [],
        expire_at: null
      })
    }
    setOpen(true)
  }

  function openSslDialog(row) {
    setCurrentDomain(row)
    setSslOpen(true)
  }

  async function handleSave() {
    const values = await form.validateFields()
    setSaving(true)
    try {
      const expireAt = formatExpireAt(values.expire_at)
      const data = {
        aliyun_config_id: values.aliyun_config_id || null,
        tags: (values.tagList || []).join(','),
        expire_at: expireAt
      }
      if (values.id) {
        await api.put(`/dns/domains/${values.id}`, data)
      } else {
        await api.post('/dns/domains', {
          domain: values.domain,
          ...data
        })
      }
      message.success('保存成功')
      setOpen(false)
      invalidateDomains()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    await confirmAction('确定删除此域名？')
    await api.delete(`/dns/domains/${id}`)
    message.success('删除成功')
    invalidateDomains()
  }

  async function toggleDomainStatus(row) {
    const newStatus = row.status === 'disabled' ? 'active' : 'disabled'
    const action = newStatus === 'disabled' ? '禁用' : '启用'
    await confirmAction(`确定${action}域名 ${row.domain}？`)
    await api.put(`/dns/domains/${row.id}/status`, { status: newStatus })
    message.success(`已${action}`)
    invalidateDomains()
  }

  async function setDefault(row) {
    await api.post(`/dns/domains/${row.id}/set-default`)
    message.success('已设为默认')
    invalidateDomains()
  }

  async function refreshAllSsl() {
    setRefreshingSsl(true)
    try {
      await api.post('/ssl/check-all')
      await refetch()
      message.success('证书状态已更新')
    } finally {
      setRefreshingSsl(false)
    }
  }

  const columns = [
    {
      title: '域名',
      width: 180,
      render: (_, row) => (
        <Space size={6}>
          <span className="full-domain">{row.domain}</span>
          {row.is_default === 1 ? <Tag color="orange">默认</Tag> : null}
        </Space>
      )
    },
    {
      title: 'DNS配置',
      width: 120,
      render: (_, row) => (
        row.aliyun_name
          ? <Tag color="success">{row.aliyun_name}</Tag>
          : <Tag>未配置</Tag>
      )
    },
    {
      title: '状态',
      width: 80,
      render: (_, row) => (
        <Tag color={row.status === 'disabled' ? 'error' : 'success'}>
          {row.status === 'disabled' ? '禁用' : '正常'}
        </Tag>
      )
    },
    {
      title: '标签',
      width: 120,
      render: (_, row) => {
        const list = parseTagList(row.tags)
        if (!list.length) return <span style={{ color: '#999' }}>-</span>
        return (
          <Space size={4} wrap>
            {list.map((tag) => (
              <Tag key={tag} style={getTagStyle(tag, tags)}>{tag}</Tag>
            ))}
          </Space>
        )
      }
    },
    {
      title: 'SSL证书',
      width: 120,
      render: (_, row) => (
        <div className="ssl-cell">
          <Tag color={getSslStatusColor(row.ssl_status)}>{getSslStatusText(row.ssl_status)}</Tag>
          {row.ssl_expires ? (
            <Tag color={getSslDaysType(row.ssl_expires)}>{formatSslDays(row.ssl_expires)}</Tag>
          ) : null}
        </div>
      )
    },
    {
      title: '添加时间',
      width: 160,
      render: (_, row) => <span className="muted-time">{formatDateTime(row.created_at)}</span>
    },
    {
      title: '到期时间',
      width: 180,
      render: (_, row) => (
        row.expire_at ? (
          <div className="expire-cell">
            <span style={{ color: getExpireColor(row.expire_at), fontWeight: 500 }}>{formatDateTime(row.expire_at)}</span>
            <span style={{ color: getExpireColor(row.expire_at) }}>{getExpireDaysText(row.expire_at)}</span>
          </div>
        ) : <span className="muted-time">永久</span>
      )
    },
    {
      title: '操作',
      width: 240,
      fixed: 'right',
      render: (_, row) => (
        <Space size={6}>
          <Button size="small" type="primary" onClick={() => navigate(`/dns?domain_id=${row.id}`)}>DNS记录</Button>
          <Button size="small" onClick={() => openSslDialog(row)}>SSL</Button>
          <Dropdown
            menu={{
              items: [
                { key: 'sub', label: '子域名', onClick: () => navigate(`/subdomains?domain_id=${row.id}`) },
                { key: 'default', label: '设为默认', disabled: row.is_default === 1, onClick: () => setDefault(row) },
                { key: 'toggle', label: row.status === 'disabled' ? '启用' : '禁用', onClick: () => toggleDomainStatus(row).catch(() => {}) },
                { key: 'edit', label: '编辑', onClick: () => openDialog(row) },
                { type: 'divider' },
                { key: 'del', label: <span style={{ color: '#ff4d4f' }}>删除</span>, onClick: () => handleDelete(row.id).catch(() => {}) }
              ]
            }}
          >
            <Button size="small">更多</Button>
          </Dropdown>
        </Space>
      )
    }
  ]

  const batchTabItems = batchSslTasks.map((task) => {
    const percent = getTaskProgress(task)
    const progressStatus = task.failed > 0 && !isTaskRunning(task)
      ? 'exception'
      : percent === 100 ? 'success' : (isTaskRunning(task) ? 'active' : 'normal')
    return {
      key: task.job_id,
      closable: isTaskFinished(task),
      label: (
        <span className="batch-tab-label">
          {isTaskRunning(task) ? <LoadingOutlined /> : null}
          {task.status === 'completed' ? <CheckCircleOutlined style={{ color: '#52c41a' }} /> : null}
          {task.status === 'error' || task.status === 'completed_with_errors' ? <CloseCircleOutlined style={{ color: '#ff4d4f' }} /> : null}
          <span>{taskTabLabel(task)}</span>
          {isTaskRunning(task) ? <span className="batch-tab-count">{task.done}/{task.total}</span> : null}
        </span>
      ),
      children: (
        <div className="batch-task-content">
          <div className="batch-ssl-summary">
            <div>
              <span className="batch-ssl-label">任务ID</span>
              <span className="batch-job-id">{task.job_id}</span>
            </div>
            <Tag color={getBatchStatusColor(task.status)}>{getBatchStatusText(task.status)}</Tag>
          </div>
          <Progress percent={percent} status={progressStatus} style={{ margin: '15px 0' }} />
          <div className="batch-ssl-counts">
            <span>总数 {task.total}</span>
            <span>完成 {task.done}</span>
            <span className="success">成功 {task.success}</span>
            <span className="failed">失败 {task.failed}</span>
          </div>
          {isTaskRetryable(task) ? (
            <div className="batch-retry-actions">
              <Button size="small" loading={retryingTask} onClick={() => retryBatchTask(task, 'remaining')}>从中断位置继续</Button>
              <Button size="small" danger loading={retryingTask} disabled={task.failed === 0} onClick={() => retryBatchTask(task, 'failed')}>
                仅重试失败项 ({task.failed})
              </Button>
              <Button size="small" type="primary" loading={retryingTask} onClick={() => retryBatchTask(task, 'all')}>全部重新执行</Button>
            </div>
          ) : null}
          <div className="batch-log-box" ref={activeTaskTab === task.job_id ? logBoxRef : undefined}>
            {task.log || '等待开始...'}
          </div>
        </div>
      )
    }
  })

  return (
    <PageCard
      title="主域名列表"
      extra={(
        <>
          <Button size="small" icon={<ReloadOutlined />} loading={isFetching} onClick={() => refetch()} />
          <Button size="small" loading={refreshingSsl} onClick={refreshAllSsl}>刷新证书状态</Button>
          <Button size="small" type="primary" ghost disabled={filteredDomains.length === 0} onClick={openBatchSslDialog}>批量获取证书</Button>
          <Button size="small" disabled={filteredDomains.length === 0} onClick={openBatchPublishDialog}>批量发布证书</Button>
          <Button type="primary" size="small" onClick={() => openDialog()}>添加域名</Button>
        </>
      )}
      filters={(
        <>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索域名、备注..."
            className="filter-search"
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
          />
          <Select
            allowClear
            placeholder="筛选标签"
            className="filter-select"
            value={filterTag}
            onChange={setFilterTag}
            options={tags.map((t) => ({ value: t.name, label: t.name }))}
          />
          <Select
            allowClear
            placeholder="筛选状态"
            className="filter-select-narrow"
            value={filterStatus}
            onChange={setFilterStatus}
            options={[
              { value: 'active', label: '正常' },
              { value: 'disabled', label: '禁用' }
            ]}
          />
        </>
      )}
    >
      <Table
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={filteredDomains}
        pagination={false}
        scroll={{ x: 1200 }}
        rowSelection={{
          preserveSelectedRowKeys: true,
          selectedRowKeys,
          onChange: setSelectedRowKeys
        }}
      />

      <Modal
        title={editingId ? '编辑域名' : '添加域名'}
        open={open}
        confirmLoading={saving}
        onOk={handleSave}
        onCancel={() => setOpen(false)}
        destroyOnClose
        width={650}
      >
        <Form form={form} labelCol={{ span: 5 }} initialValues={{ tagList: [] }}>
          <Form.Item name="id" hidden><Input /></Form.Item>
          <Form.Item name="domain" label="域名" rules={editingId ? [] : [{ required: true, message: '请输入域名' }]}>
            <Input placeholder="例如: example.com" disabled={!!editingId} />
          </Form.Item>
          <Form.Item name="aliyun_config_id" label="DNS配置">
            <Select
              allowClear
              placeholder="选择DNS配置"
              options={dnsPlatforms.map((c) => ({
                value: c.id,
                label: `${c.name}${c.is_default === 1 ? ' (默认)' : ''}`
              }))}
            />
          </Form.Item>
          <Form.Item name="tagList" label="标签">
            <Select
              mode="tags"
              placeholder="选择或输入标签"
              options={tags.map((t) => ({ value: t.name, label: t.name }))}
              onChange={onTagChange}
            />
          </Form.Item>
          <Form.Item name="expire_at" label="到期时间">
            <DatePicker showTime format="YYYY-MM-DD HH:mm:ss" style={{ width: '100%' }} placeholder="选择到期时间" />
          </Form.Item>
        </Form>
      </Modal>

      <SslDialog
        open={sslOpen}
        domain={currentDomain}
        onClose={() => setSslOpen(false)}
        onRefresh={invalidateDomains}
      />

      <Modal
        title="批量获取证书"
        open={batchSslOpen}
        onCancel={() => setBatchSslOpen(false)}
        width={900}
        style={{ top: '5vh' }}
        footer={(
          <div className="batch-footer">
            <Space>
              {currentBatchTask ? (
                <Button icon={<PlusOutlined />} disabled={hasRunningTask} onClick={backToNewTask}>新建任务</Button>
              ) : null}
              {hasCompletedTasks ? (
                <Button danger onClick={clearCompletedTasks}>清空已完成</Button>
              ) : null}
            </Space>
            <Space>
              <Button onClick={() => setBatchSslOpen(false)}>关闭</Button>
              {currentBatchTask ? (
                <Button type="primary" icon={<ReloadOutlined />} loading={refreshingTask} onClick={() => refreshTaskById(currentBatchTask.job_id)}>
                  刷新
                </Button>
              ) : null}
            </Space>
          </div>
        )}
      >
        {!currentBatchTask ? (
          <div className="batch-ssl-new-task">
            <div className="batch-ssl-summary">
              <div>
                <span className="batch-ssl-label">处理范围</span>
                <strong>{batchTargetDomains.length} 个域名</strong>
                <span className="batch-ssl-muted">{selectedDomains.length ? '已勾选' : '当前筛选结果'}</span>
              </div>
            </div>
            <Form labelCol={{ style: { width: 90 } }} style={{ marginTop: 15 }}>
              <Form.Item label="证书类型">
                <Select
                  style={{ width: 280 }}
                  value={batchSslForm.cert_type}
                  onChange={(value) => setBatchSslForm({ cert_type: value })}
                  options={Object.entries(certTypes).map(([value, info]) => ({
                    value,
                    label: `${info.name} - ${info.desc}`
                  }))}
                />
              </Form.Item>
            </Form>
            <div style={{ textAlign: 'center', marginTop: 20 }}>
              <Button
                type="primary"
                size="large"
                icon={<PlusOutlined />}
                loading={startingBatchSsl}
                disabled={batchTargetDomains.length === 0}
                onClick={startBatchSsl}
              >
                开始批量获取
              </Button>
            </div>
          </div>
        ) : (
          <div className="batch-ssl-tasks">
            <Tabs
              type="editable-card"
              hideAdd
              activeKey={activeTaskTab}
              onChange={setActiveTaskTab}
              onEdit={(targetKey, action) => {
                if (action === 'remove') removeTask(targetKey)
              }}
              items={batchTabItems}
            />
          </div>
        )}
      </Modal>

      <Modal
        title="批量发布证书"
        open={batchPublishOpen}
        onCancel={() => setBatchPublishOpen(false)}
        width={700}
        style={{ top: '5vh' }}
        footer={(
          <Space>
            <Button onClick={() => setBatchPublishOpen(false)}>关闭</Button>
            <Button
              type="primary"
              loading={batchPublishing}
              disabled={batchPublishForm.server_ids.length === 0}
              onClick={executeBatchPublish}
            >
              开始发布
            </Button>
          </Space>
        )}
      >
        <div style={{ maxHeight: '65vh', overflowY: 'auto' }}>
          <Alert
            type="info"
            showIcon={false}
            style={{ marginBottom: 20 }}
            message="将本地已保存的证书批量发布到选定的服务器。支持同时发布到多台服务器。"
          />
          <Form labelCol={{ style: { width: 100 } }}>
            <Form.Item label="发布域名">
              <Space>
                <Tag>{batchPublishTargetDomains.length} 个域名</Tag>
                <span className="batch-ssl-muted" style={{ marginLeft: 0 }}>{selectedDomains.length ? '已勾选' : '当前筛选结果'}</span>
              </Space>
            </Form.Item>
            <Form.Item label="目标服务器">
              <Checkbox.Group
                value={batchPublishForm.server_ids}
                onChange={(ids) => setBatchPublishForm((prev) => ({ ...prev, server_ids: ids }))}
              >
                <Space direction="vertical">
                  {availableServers.map((s) => (
                    <Checkbox key={s.id} value={s.id}>
                      {s.name} ({s.ip})
                      {s.is_default === 1 ? <Tag color="orange" style={{ marginLeft: 8 }}>默认</Tag> : null}
                    </Checkbox>
                  ))}
                </Space>
              </Checkbox.Group>
              <div style={{ marginTop: 8 }}>
                <Space>
                  <Button size="small" onClick={() => setBatchPublishForm((prev) => ({ ...prev, server_ids: availableServers.map((s) => s.id) }))}>全选</Button>
                  <Button size="small" onClick={() => setBatchPublishForm((prev) => ({ ...prev, server_ids: [] }))}>清空</Button>
                </Space>
              </div>
            </Form.Item>
            <Form.Item label="目标目录">
              <Input
                value={batchPublishForm.target_dir_template}
                placeholder="/www/certs/{domain}"
                addonAfter="{domain} = 域名"
                onChange={(e) => setBatchPublishForm((prev) => ({ ...prev, target_dir_template: e.target.value }))}
              />
              <div style={{ marginTop: 5, color: '#909399', fontSize: 12 }}>
                使用 {'{domain}'} 作为域名占位符，例如: /www/certs/{'{domain}'}
              </div>
            </Form.Item>
          </Form>
          {batchPublishLog ? (
            <div className="batch-log-box" style={{ marginTop: 15 }} ref={publishLogRef}>{batchPublishLog}</div>
          ) : null}
        </div>
      </Modal>

      <style>{`
        .full-domain { color: #1677ff; font-weight: 600; }
        .muted-time { font-size: 12px; color: #909399; }
        .ssl-cell { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }
        .expire-cell { display: flex; flex-direction: column; gap: 2px; font-size: 12px; }
        .expire-cell span:last-child { font-size: 11px; }
        .batch-ssl-summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
        .batch-ssl-label { color: #606266; margin-right: 8px; font-size: 13px; }
        .batch-ssl-muted { color: #909399; margin-left: 8px; font-size: 12px; }
        .batch-ssl-counts { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 12px; color: #606266; font-size: 13px; }
        .batch-ssl-counts .success { color: #52c41a; }
        .batch-ssl-counts .failed { color: #ff4d4f; }
        .batch-retry-actions { display: flex; gap: 10px; margin-bottom: 12px; padding: 12px; background: #fef0f0; border-radius: 6px; border: 1px solid #fde2e2; flex-wrap: wrap; }
        .batch-log-box { background: #1e1e1e; color: #d4d4d4; padding: 14px; border-radius: 6px; min-height: 260px; max-height: 420px; overflow-y: auto; white-space: pre-wrap; word-break: break-all; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; line-height: 1.6; }
        .batch-ssl-new-task { padding: 20px; background: #f8f9fa; border-radius: 8px; min-height: 300px; }
        .batch-ssl-tasks { min-height: 400px; }
        .batch-task-content { padding: 15px 0; }
        .batch-job-id { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; color: #909399; }
        .batch-tab-label { display: inline-flex; align-items: center; gap: 8px; }
        .batch-tab-count { color: #1677ff; font-size: 12px; }
        .batch-footer { display: flex; justify-content: space-between; align-items: center; width: 100%; }
      `}</style>
    </PageCard>
  )
}
