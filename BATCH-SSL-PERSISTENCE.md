# 批量SSL证书任务持久化

## 功能概述

批量SSL证书任务现已支持**数据库持久化**，即使服务器重启，任务信息也不会丢失。

## 主要改进

### 1. 数据库持久化 ✓
- 所有批量任务信息保存到数据库表 `batch_ssl_jobs`
- 任务状态实时同步到数据库
- 服务器重启后自动从数据库恢复任务

### 2. 历史任务加载 ✓
- 打开批量获取对话框时自动加载最近5个任务
- 支持查看历史任务的详细信息
- 可以继续查看已完成任务的日志

### 3. 双重存储机制 ✓
- **内存存储**：快速访问，实时更新
- **数据库存储**：持久化，防止丢失
- 自动同步两者的数据

## 数据库表结构

```sql
CREATE TABLE batch_ssl_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT UNIQUE NOT NULL,           -- 任务唯一ID
  user_id INTEGER NOT NULL,              -- 用户ID
  status TEXT DEFAULT 'pending',         -- 任务状态
  total INTEGER DEFAULT 0,               -- 总域名数
  done INTEGER DEFAULT 0,                -- 已完成数
  success INTEGER DEFAULT 0,             -- 成功数
  failed INTEGER DEFAULT 0,              -- 失败数
  log TEXT,                              -- 执行日志
  results TEXT,                          -- 结果JSON
  cert_type TEXT DEFAULT 'letsencrypt',  -- 证书类型
  created_at DATETIME,                   -- 创建时间
  updated_at DATETIME,                   -- 更新时间
  started_at DATETIME,                   -- 开始时间
  finished_at DATETIME,                  -- 完成时间
  FOREIGN KEY(user_id) REFERENCES users(id)
);
```

## 工作流程

### 创建任务
```
1. 用户点击"开始批量获取"
2. 后端创建任务记录到数据库
3. 同时在内存中创建任务对象
4. 返回任务ID给前端
5. 前端添加到任务列表并开始轮询
```

### 更新任务
```
1. 后台执行任务，处理每个域名
2. 每处理完一个域名，更新数据库
3. 同时更新内存中的任务对象
4. 前端轮询获取最新状态
```

### 恢复任务
```
1. 服务器重启后，内存中的任务丢失
2. 前端请求任务信息
3. 后端从数据库加载任务
4. 恢复到内存中
5. 返回给前端继续显示
```

## 使用场景

### 场景1：服务器重启
**之前**：任务信息丢失，显示"任务已过期"
**现在**：自动从数据库恢复，继续显示任务信息

### 场景2：查看历史任务
**之前**：只能查看当前会话的任务
**现在**：可以查看最近的历史任务

### 场景3：长时间任务
**之前**：24小时后任务被清理
**现在**：任务永久保存在数据库中

## API接口

### 获取单个任务
```http
GET /api/ssl/batch-issue/:job_id
```

**响应**：
```json
{
  "id": "1234567890-abcdef",
  "status": "completed",
  "total": 10,
  "done": 10,
  "success": 9,
  "failed": 1,
  "log": "...",
  "results": [...],
  "created_at": "2024-01-01 14:30:25",
  "updated_at": "2024-01-01 14:35:30",
  "started_at": "2024-01-01 14:30:26",
  "finished_at": "2024-01-01 14:35:30"
}
```

### 获取任务列表
```http
GET /api/ssl/batch-jobs?limit=10&status=completed
```

**参数**：
- `limit` - 返回数量，默认10
- `status` - 过滤状态（可选）

**响应**：
```json
[
  {
    "job_id": "1234567890-abcdef",
    "status": "completed",
    "total": 10,
    "done": 10,
    "success": 9,
    "failed": 1,
    "created_at": "2024-01-01 14:30:25",
    "updated_at": "2024-01-01 14:35:30",
    "started_at": "2024-01-01 14:30:26",
    "finished_at": "2024-01-01 14:35:30"
  }
]
```

## 技术实现

### 后端实现

```javascript
// 创建任务（保存到数据库）
const createBatchJob = async (user) => {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const now = formatTime();
  
  // 保存到数据库
  await db.run(`
    INSERT INTO batch_ssl_jobs (job_id, user_id, status, ...)
    VALUES (?, ?, ?, ...)
  `, [id, user.id, 'pending', ...]);
  
  // 同时保存到内存
  const job = { id, user_id: user.id, ... };
  batchIssueJobs.set(id, job);
  
  return job;
};

// 更新任务（同步到数据库）
const updateBatchJob = async (job) => {
  job.updated_at = formatTime();
  
  // 更新数据库
  await db.run(`
    UPDATE batch_ssl_jobs 
    SET status = ?, total = ?, done = ?, ...
    WHERE job_id = ?
  `, [job.status, job.total, job.done, ..., job.id]);
  
  // 更新内存
  batchIssueJobs.set(job.id, job);
};

// 获取任务（优先内存，其次数据库）
router.get('/batch-issue/:job_id', async (req, res) => {
  // 先从内存查找
  let job = batchIssueJobs.get(req.params.job_id);
  
  // 如果内存中没有，从数据库加载
  if (!job) {
    const dbJob = await db.get('SELECT * FROM batch_ssl_jobs WHERE job_id = ?', [req.params.job_id]);
    if (dbJob) {
      // 恢复到内存
      job = { ...dbJob, results: JSON.parse(dbJob.results) };
      batchIssueJobs.set(job.id, job);
    }
  }
  
  res.json(job);
});
```

### 前端实现

```javascript
// 打开对话框时加载历史任务
function openBatchSslDialog() {
  batchSslDialogVisible.value = true
  loadHistoryTasks()
}

async function loadHistoryTasks() {
  const res = await api.get('/ssl/batch-jobs?limit=5')
  for (const job of res) {
    if (!batchSslTasks.value.find(t => t.job_id === job.job_id)) {
      batchSslTasks.value.push(job)
    }
  }
}
```

## 性能优化

### 1. 双重存储
- 内存：快速读取，1ms响应
- 数据库：持久化，10-50ms响应
- 优先使用内存，内存miss时查数据库

### 2. 批量更新
- 每处理完一个域名才更新数据库
- 避免频繁的数据库写入
- 日志使用trimSslLog限制大小

### 3. 自动清理
- 内存中的任务24小时后清理
- 数据库中的任务永久保存
- 可以手动删除旧任务

## 注意事项

### 1. 数据库大小
- 每个任务约10-100KB（取决于日志长度）
- 建议定期清理旧任务
- 可以设置自动清理策略

### 2. 日志大小
- 日志自动截断到60KB
- 保留开头和末尾重要信息
- 避免数据库过大

### 3. 并发控制
- 同一任务只能有一个执行实例
- 使用任务状态防止重复执行
- 数据库事务保证一致性

## 迁移说明

### 自动迁移
服务器启动时会自动创建 `batch_ssl_jobs` 表，无需手动操作。

### 数据迁移
如果之前有运行中的任务，重启后会丢失。建议：
1. 等待所有任务完成后再重启
2. 或者记录任务ID，重启后重新创建

## 未来改进

### 计划中的功能
1. **任务清理策略** - 自动清理N天前的任务
2. **任务导出** - 导出任务结果为CSV
3. **任务统计** - 统计成功率、平均耗时等
4. **任务重试** - 一键重试失败的域名
5. **任务暂停/恢复** - 支持暂停和恢复长时间任务

## 相关文件

- `backend/db/database-sqlite.js` - 数据库表定义
- `backend/routes/ssl.js` - 任务持久化逻辑
- `frontend/src/views/Domains.vue` - 历史任务加载
- `BATCH-SSL-MULTI-TASK.md` - 多任务功能说明
- `BATCH-SSL-TASK-EXPIRY.md` - 任务过期问题说明

## 常见问题

### Q: 服务器重启后任务会丢失吗？
A: 不会。任务信息已保存到数据库，重启后会自动恢复。

### Q: 可以查看多久之前的任务？
A: 默认显示最近5个任务，可以通过API查询更多历史任务。

### Q: 任务日志会占用多少空间？
A: 每个任务约10-100KB，日志会自动截断到60KB以内。

### Q: 如何清理旧任务？
A: 目前需要手动删除数据库记录，未来会提供自动清理功能。

### Q: 任务执行失败会保存吗？
A: 会。所有任务（成功、失败、异常）都会保存到数据库。
