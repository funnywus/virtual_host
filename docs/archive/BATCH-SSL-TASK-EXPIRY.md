# 批量SSL证书任务过期问题说明

## 问题描述

在使用批量获取SSL证书功能时，可能会遇到"批量任务不存在或已过期"的错误提示。

## 原因分析

批量SSL证书任务使用**内存存储**（而非数据库），存在以下限制：

1. **服务器重启后任务丢失** - 内存中的任务数据不会持久化
2. **24小时后自动过期** - 为防止内存泄漏，任务会在24小时后自动清理
3. **前端轮询时任务已被清理** - 如果长时间未查看，任务可能已被清理

## 已实施的优化

### 1. 延长过期时间 ✓
- **之前**：2小时后过期
- **现在**：24小时后过期
- **位置**：`backend/routes/ssl.js` 中的 `BATCH_JOB_TTL_MS`

### 2. 前端错误处理 ✓
- 捕获任务过期错误
- 在日志中显示友好的提示信息
- 自动停止轮询，避免持续报错

## 使用建议

### 最佳实践
1. **及时查看结果** - 批量任务开始后，尽快查看执行结果
2. **避免服务器重启** - 批量任务执行期间避免重启后端服务
3. **小批量执行** - 建议每次不超过20个域名，减少执行时间

### 如果遇到任务过期
1. **检查域名状态** - 进入域名列表，查看SSL证书状态
2. **重新执行** - 对失败的域名重新执行批量获取
3. **单独处理** - 对个别域名可以使用单独的SSL证书申请功能

## 技术细节

### 当前实现
```javascript
// backend/routes/ssl.js
const BATCH_JOB_TTL_MS = 24 * 60 * 60 * 1000; // 24小时
const batchIssueJobs = new Map(); // 内存存储

// 定期清理过期任务
const cleanupBatchJobs = () => {
  const now = Date.now();
  for (const [id, job] of batchIssueJobs.entries()) {
    if (job.finished_at_ms && now - job.finished_at_ms > BATCH_JOB_TTL_MS) {
      batchIssueJobs.delete(id);
    }
  }
};
```

### 前端错误处理
```javascript
// frontend/src/views/Domains.vue
async function loadBatchSslJob() {
  try {
    const res = await api.get(`/ssl/batch-issue/${batchSsl.job_id}`)
    // ... 处理响应
  } catch (err) {
    // 任务不存在或已过期
    stopBatchSslPolling()
    if (err.message?.includes('不存在') || err.message?.includes('过期')) {
      // 显示友好提示
    }
  }
}
```

## 未来改进方向

### 方案1：数据库持久化（推荐）
- 将批量任务信息存储到数据库
- 服务器重启后任务信息不丢失
- 可以查询历史任务记录

### 方案2：Redis缓存
- 使用Redis存储任务信息
- 支持分布式部署
- 可设置更灵活的过期策略

### 方案3：任务队列
- 使用专业的任务队列（如Bull、BullMQ）
- 支持任务重试、优先级等高级功能
- 更好的可观测性

## 相关文件

- `backend/routes/ssl.js` - SSL证书路由，包含批量任务逻辑
- `frontend/src/views/Domains.vue` - 域名管理页面，包含批量SSL功能
- `frontend/src/components/SslDialog.vue` - SSL证书对话框组件

## 常见问题

### Q: 为什么不直接存储到数据库？
A: 当前实现优先考虑简单性和性能。批量任务通常在短时间内完成，内存存储足够。未来如有需求可以改为数据库存储。

### Q: 24小时后任务会自动删除吗？
A: 是的。任务完成后24小时会被自动清理，以防止内存泄漏。

### Q: 服务器重启后能恢复任务吗？
A: 不能。当前实现使用内存存储，服务器重启后任务信息会丢失。但已完成的证书申请不受影响，可以在域名列表中查看证书状态。

### Q: 如何查看历史批量任务？
A: 当前版本不支持查看历史任务。可以通过域名列表的SSL证书状态和日志来了解证书申请情况。
