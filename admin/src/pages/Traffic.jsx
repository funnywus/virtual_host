import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Alert, Button, Checkbox, Empty, Radio, Select, Spin, Table, Tag } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import api from '@/api'
import PageCard from '@/components/PageCard'

const presets = [
  { value: 'hour-today', label: '今日小时', granularity: 'hour', range: 'today' },
  { value: 'day-7d', label: '近7天', granularity: 'day', range: '7d' },
  { value: 'minute-1h', label: '近1小时', granularity: 'minute', range: '1h' },
  { value: 'minute-today', label: '今日分钟', granularity: 'minute', range: 'today' }
]

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

function mapSites(list) {
  return (list || []).map((s) => ({
    id: Number(s.id),
    full_domain: s.subdomain === '@' ? s.main_domain : `${s.subdomain}.${s.main_domain}`
  }))
}

export default function Traffic() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [selectedId, setSelectedId] = useState(searchParams.get('id') ? Number(searchParams.get('id')) : null)
  const [preset, setPreset] = useState('hour-today')
  const [hideEmpty, setHideEmpty] = useState(true)
  const [siteOptions, setSiteOptions] = useState([])
  const [siteLoading, setSiteLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const queryToken = useRef(0)

  const currentPreset = presets.find((item) => item.value === preset) || presets[0]
  const currentSiteName = result?.full_domain
    || siteOptions.find((s) => s.id === selectedId)?.full_domain
    || searchParams.get('domain')
    || ''

  const points = result?.points || []
  const displayPoints = hideEmpty ? points.filter((p) => p.bytes || p.requests) : points
  const maxBytes = Math.max(0, ...points.map((p) => Number(p.bytes) || 0))
  const hasTraffic = maxBytes > 0 || points.some((p) => Number(p.requests) > 0)

  const peakPoint = useMemo(() => {
    let peak = null
    for (const p of points) {
      if (!peak || (Number(p.bytes) || 0) > (Number(peak.bytes) || 0)) peak = p
    }
    return peak && Number(peak.bytes) > 0 ? peak : null
  }, [points])

  const chartPoints = useMemo(() => {
    const source = downsamplePoints(points, 96)
    const max = Math.max(0, ...source.map((p) => Number(p.bytes) || 0))
    let peakMarked = false
    return source.map((p) => {
      const bytes = Number(p.bytes) || 0
      const isPeak = !peakMarked && max > 0 && bytes === max
      if (isPeak) peakMarked = true
      return { ...p, height: max <= 0 ? 4 : Math.max(4, Math.round(bytes / max * 100)), isPeak }
    })
  }, [points])

  const chartAxis = useMemo(() => {
    if (!chartPoints.length) return []
    if (chartPoints.length <= 2) return chartPoints.map((p) => p.time)
    return [chartPoints[0].time, chartPoints[Math.floor((chartPoints.length - 1) / 2)].time, chartPoints[chartPoints.length - 1].time]
  }, [chartPoints])

  function mergeSite(site) {
    if (!site?.id || !site.full_domain) return
    setSiteOptions((prev) => {
      const id = Number(site.id)
      const current = prev.find((s) => s.id === id)
      if (!current) return [{ id, full_domain: site.full_domain }, ...prev]
      return prev
    })
  }

  async function searchSites(keyword) {
    setSiteLoading(true)
    try {
      const res = await api.get('/dns/subdomains', { params: { page: 1, pageSize: 50, keyword: keyword || undefined } })
      let next = mapSites(res.list)
      const domain = searchParams.get('domain')
      if (selectedId && domain && !next.some((s) => s.id === selectedId)) {
        next = [{ id: selectedId, full_domain: domain }, ...next]
      }
      setSiteOptions(next)
    } finally {
      setSiteLoading(false)
    }
  }

  async function runQuery(id = selectedId) {
    if (!id) {
      setResult(null)
      return
    }
    const token = ++queryToken.current
    setLoading(true)
    try {
      const res = await api.get(`/dns/subdomains/${id}/traffic-series`, {
        params: { granularity: currentPreset.granularity, range: currentPreset.range }
      })
      if (token !== queryToken.current) return
      setResult(res)
      if (res?.id && res.full_domain) mergeSite({ id: res.id, full_domain: res.full_domain })
    } catch {
      if (token !== queryToken.current) return
      setResult(null)
    } finally {
      if (token === queryToken.current) setLoading(false)
    }
  }

  useEffect(() => {
    const id = searchParams.get('id') ? Number(searchParams.get('id')) : null
    if (id) {
      setSelectedId(id)
      const domain = searchParams.get('domain')
      if (domain) mergeSite({ id, full_domain: domain })
    }
    searchSites('')
  }, [])

  useEffect(() => {
    if (selectedId) runQuery(selectedId)
    else setResult(null)
  }, [selectedId, preset])

  const tablePoints = [...displayPoints].reverse()
  const chartMaxBytes = Math.max(0, ...chartPoints.map((p) => Number(p.bytes) || 0))

  return (
    <PageCard
      title={(
        <>
          流量统计
          {currentSiteName ? <Tag>{currentSiteName}</Tag> : null}
          {result ? <Tag color={result.accurate ? 'success' : 'warning'}>{result.accurate ? '精确流量' : '近似流量'}</Tag> : null}
        </>
      )}
      extra={(
        <>
          <Button size="small" onClick={() => navigate('/subdomains')}>返回列表</Button>
          <Button type="primary" size="small" icon={<ReloadOutlined />} disabled={!selectedId} loading={loading} onClick={() => runQuery()}>刷新</Button>
        </>
      )}
      filters={(
        <>
          <Select
            showSearch
            allowClear
            filterOption={false}
            placeholder="搜索子域名"
            className="filter-search"
            style={{ width: 260 }}
            loading={siteLoading}
            value={selectedId}
            onSearch={searchSites}
            onChange={setSelectedId}
            options={siteOptions.map((s) => ({ value: s.id, label: s.full_domain }))}
          />
          <Radio.Group value={preset} onChange={(e) => setPreset(e.target.value)} optionType="button" size="small" options={presets.map((p) => ({ label: p.label, value: p.value }))} />
          <Checkbox checked={hideEmpty} disabled={!result} onChange={(e) => setHideEmpty(e.target.checked)}>只看有流量</Checkbox>
          {result ? <span className="record-count">共 {tablePoints.length} 个时段</span> : null}
        </>
      )}
    >
      {!selectedId && !loading ? (
        <Empty description="从子域名列表点今日流量，或在上方搜索站点" />
      ) : (
        <Spin spinning={loading}>
          {result ? (
            <>
              <div className="summary-row">
                <div className="summary-block">
                  <div className="summary-label">流量</div>
                  <div className="summary-value">{formatTrafficBytes(result.bytes)}{!result.accurate && <span className="approx">≈</span>}</div>
                </div>
                <div className="summary-block">
                  <div className="summary-label">请求</div>
                  <div className="summary-value">{formatRequestCount(result.requests)} 次</div>
                </div>
                <div className="summary-block">
                  <div className="summary-label">峰值</div>
                  <div className="summary-value peak">{peakPoint ? `${peakPoint.time} · ${formatTrafficBytes(peakPoint.bytes)}` : '—'}</div>
                </div>
              </div>
              {result.error ? <Alert type="error" showIcon message={result.error} style={{ marginBottom: 14 }} /> : null}
              {hasTraffic ? (
                <>
                  <div className="section-head"><span>趋势</span><span className="section-meta">{currentPreset.label}</span></div>
                  <div className="chart-wrap">
                    <div className="chart-panel">
                      <div className="chart-y"><span>{formatTrafficBytes(chartMaxBytes)}</span><span>0</span></div>
                      <div className={`chart${chartPoints.length > 48 ? ' dense' : ''}`}>
                        {chartPoints.map((bar) => (
                          <span
                            key={bar.time}
                            className={`chart-bar${bar.bytes ? '' : ' empty'}${bar.isPeak ? ' peak' : ''}`}
                            style={{ height: `${bar.height}%` }}
                            title={`${bar.time}  ${formatTrafficBytes(bar.bytes)} · ${formatRequestCount(bar.requests)} 次`}
                          />
                        ))}
                      </div>
                    </div>
                    <div className="chart-axis">{chartAxis.map((tick) => <span key={tick}>{tick}</span>)}</div>
                  </div>
                  <div className="section-head"><span>明细</span><span className="section-meta">最新在前</span></div>
                  <Table
                    rowKey="time"
                    size="small"
                    dataSource={tablePoints}
                    pagination={false}
                    scroll={{ y: 480 }}
                    rowClassName={(row) => (peakPoint && row.time === peakPoint.time ? 'is-peak' : '')}
                    columns={[
                      { title: '时间', dataIndex: 'time', width: 150 },
                      { title: '流量', width: 120, render: (_, row) => <span className={`num${!row.bytes ? ' muted' : ''}`}>{formatTrafficBytes(row.bytes)}</span> },
                      { title: '请求', width: 110, render: (_, row) => <span className={`num${!row.requests ? ' muted' : ''}`}>{formatRequestCount(row.requests)} 次</span> },
                      {
                        title: '占比',
                        render: (_, row) => (
                          <div className="bar-track">
                            <div className={`bar-fill${peakPoint && row.time === peakPoint.time ? ' peak' : ''}`} style={{ width: maxBytes <= 0 ? '0%' : `${Math.max(2, Math.round((Number(row.bytes) || 0) / maxBytes * 100))}%` }} />
                          </div>
                        )
                      }
                    ]}
                  />
                </>
              ) : <Empty description="该时段没有访问" />}
            </>
          ) : (!loading ? <Empty description="统计失败，请刷新重试" /> : <div style={{ height: 120 }} />)}
        </Spin>
      )}
      <style>{`
        .record-count { color:#909399; font-size:13px; margin-left:auto; }
        .summary-row { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; margin-bottom:16px; }
        .summary-block { padding:14px 16px; background:#f8f9fb; border:1px solid #eef0f4; border-radius:10px; }
        .summary-label { font-size:12px; color:#909399; margin-bottom:6px; }
        .summary-value { font-size:20px; font-weight:600; font-variant-numeric:tabular-nums; }
        .summary-value.peak { font-size:15px; }
        .approx { margin-left:4px; color:#e6a23c; font-size:14px; }
        .section-head { display:flex; justify-content:space-between; margin:4px 0 8px; font-size:13px; font-weight:600; }
        .section-meta { font-size:12px; font-weight:400; color:#909399; }
        .chart-wrap { margin-bottom:18px; padding:14px 14px 10px; background:#f8f9fb; border:1px solid #eef0f4; border-radius:10px; }
        .chart-panel { display:grid; grid-template-columns:64px 1fr; gap:8px; }
        .chart-y { display:flex; flex-direction:column; justify-content:space-between; align-items:flex-end; font-size:11px; color:#909399; }
        .chart { display:flex; align-items:flex-end; gap:4px; height:132px; }
        .chart.dense { gap:1px; }
        .chart-bar { flex:1; min-width:3px; background:#409eff; border-radius:2px 2px 0 0; }
        .chart-bar.empty { background:#e4e7ed; }
        .chart-bar.peak { background:#e6a23c; }
        .chart-axis { display:flex; justify-content:space-between; margin:8px 0 0 72px; font-size:12px; color:#909399; }
        .num { font-variant-numeric:tabular-nums; }
        .num.muted { color:#c0c4cc; }
        .bar-track { height:8px; background:#ebeef5; border-radius:4px; overflow:hidden; }
        .bar-fill { height:100%; background:#409eff; border-radius:4px; }
        .bar-fill.peak { background:#e6a23c; }
        .is-peak td { background:#fff7e6 !important; }
        @media (max-width:900px) { .summary-row { grid-template-columns:1fr; } }
      `}</style>
    </PageCard>
  )
}
