# MySQL Undefined 参数错误修复

## 问题描述

服务器崩溃，错误信息：
```
Error: Bind parameters must not contain undefined. To pass SQL NULL specify JS null
at PromisePool.execute
```

## 原因分析

MySQL 驱动（mysql2）不接受 `undefined` 作为SQL参数值。必须使用 `null` 来表示 SQL NULL。

### 错误示例
```javascript
// ❌ 错误 - 会导致崩溃
await db.run('UPDATE table SET field = ? WHERE id = ?', [
  job.started_at,  // 可能是 undefined
  job.id
]);
```

### 正确示例
```javascript
// ✅ 正确 - 使用 null 或默认值
await db.run('UPDATE table SET field = ? WHERE id = ?', [
  job.started_at || null,  // undefined 转换为 null
  job.id
]);
```

## 已修复的函数

### 1. updateBatchJob
```javascript
const updateBatchJob = async (job) => {
  job.updated_at = formatTime();
  
  await db.run(`
    UPDATE batch_ssl_jobs 
    SET status = ?, total = ?, done = ?, success = ?, failed = ?, 
        log = ?, results = ?, updated_at = ?, started_at = ?, finished_at = ?
    WHERE job_id = ?
  `, [
    job.status || 'pending',           // 确保有默认值
    job.total || 0,
    job.done || 0,
    job.success || 0,
    job.failed || 0,
    trimSslLog(job.log || ''),
    JSON.stringify(job.results || []),
    job.updated_at,
    job.started_at || null,            // undefined 转 null
    job.finished_at || null,           // undefined 转 null
    job.id
  ]);
  
  batchIssueJobs.set(job.id, job);
};
```

### 2. createBatchJob
```javascript
const createBatchJob = async (user) => {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const now = formatTime();
  
  await db.run(`
    INSERT INTO batch_ssl_jobs (job_id, user_id, status, total, done, success, failed, log, results, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [id, user.id, 'pending', 0, 0, 0, 0, '', '[]', now, now]);
  
  const job = {
    id,
    user_id: user.id,
    role: user.role,
    status: 'pending',
    total: 0,
    done: 0,
    success: 0,
    failed: 0,
    log: '',
    results: [],
    created_at: now,
    updated_at: now,
    started_at: null,      // 明确设置为 null
    finished_at: null      // 明确设置为 null
  };
  
  batchIssueJobs.set(id, job);
  return job;
};
```

## 最佳实践

### 1. 使用默认值
```javascript
// 对于数字类型
const value = job.total || 0;

// 对于字符串类型
const value = job.log || '';

// 对于数组类型
const value = job.results || [];

// 对于可选字段
const value = job.started_at || null;
```

### 2. 类型检查
```javascript
// 检查是否为 undefined
if (typeof value === 'undefined') {
  value = null;
}

// 或使用三元运算符
const safeValue = value !== undefined ? value : null;
```

### 3. 对象初始化
```javascript
// 创建对象时明确所有字段
const job = {
  id: generateId(),
  status: 'pending',
  total: 0,
  done: 0,
  success: 0,
  failed: 0,
  log: '',
  results: [],
  started_at: null,    // 明确设置为 null
  finished_at: null,   // 明确设置为 null
  created_at: now,
  updated_at: now
};
```

### 4. 参数准备函数
```javascript
// 创建一个辅助函数来准备SQL参数
function prepareSqlParams(obj, fields) {
  return fields.map(field => {
    const value = obj[field];
    if (value === undefined) return null;
    if (value === '') return '';
    if (typeof value === 'number') return value;
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return JSON.stringify(value);
    if (value === null) return null;
    return String(value);
  });
}

// 使用示例
const params = prepareSqlParams(job, [
  'status', 'total', 'done', 'success', 'failed',
  'log', 'results', 'updated_at', 'started_at', 'finished_at'
]);
```

## 常见错误场景

### 场景1：时间字段未初始化
```javascript
// ❌ 错误
const job = {
  created_at: formatTime()
  // started_at 和 finished_at 未定义
};

// ✅ 正确
const job = {
  created_at: formatTime(),
  started_at: null,
  finished_at: null
};
```

### 场景2：条件赋值
```javascript
// ❌ 错误
job.started_at = condition ? formatTime() : undefined;

// ✅ 正确
job.started_at = condition ? formatTime() : null;
```

### 场景3：对象解构
```javascript
// ❌ 错误
const { started_at, finished_at } = job;  // 可能是 undefined

// ✅ 正确
const { started_at = null, finished_at = null } = job;
```

### 场景4：数组操作
```javascript
// ❌ 错误
const results = job.results;  // 可能是 undefined
results.push(item);  // 崩溃

// ✅ 正确
const results = job.results || [];
results.push(item);
```

## 调试技巧

### 1. 添加参数验证
```javascript
function validateSqlParams(params) {
  params.forEach((param, index) => {
    if (param === undefined) {
      console.error(`参数 ${index} 是 undefined`);
      throw new Error(`SQL参数不能是 undefined (索引: ${index})`);
    }
  });
}

// 使用
const params = [job.status, job.total, ...];
validateSqlParams(params);
await db.run(sql, params);
```

### 2. 日志输出
```javascript
console.log('SQL参数:', JSON.stringify(params, null, 2));
```

### 3. 类型断言
```javascript
// TypeScript 风格的类型检查
function ensureNotUndefined<T>(value: T | undefined, defaultValue: T): T {
  return value !== undefined ? value : defaultValue;
}
```

## 预防措施

### 1. 代码审查清单
- [ ] 所有SQL参数都有默认值或 null
- [ ] 对象初始化时明确所有字段
- [ ] 条件赋值使用 null 而不是 undefined
- [ ] 数组和对象操作前检查是否存在

### 2. 单元测试
```javascript
describe('updateBatchJob', () => {
  it('should handle undefined values', async () => {
    const job = {
      id: 'test-id',
      status: 'pending',
      // 故意不设置 started_at
    };
    
    // 不应该抛出错误
    await expect(updateBatchJob(job)).resolves.not.toThrow();
  });
});
```

### 3. ESLint 规则
```json
{
  "rules": {
    "no-undefined": "error",
    "no-undef-init": "error"
  }
}
```

## 相关文件

- `backend/routes/ssl.js` - 批量SSL任务逻辑
- `backend/db/database-mysql.js` - MySQL数据库连接
- `BATCH-SSL-PERSISTENCE.md` - 任务持久化说明

## 参考资料

- [mysql2 文档](https://github.com/sidorares/node-mysql2)
- [JavaScript undefined vs null](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/undefined)
- [SQL NULL 值处理](https://dev.mysql.com/doc/refman/8.0/en/working-with-null.html)

## 更新日志

- 2024-01-01: 修复 updateBatchJob 中的 undefined 参数
- 2024-01-01: 修复 createBatchJob 初始化问题
- 2024-01-01: 添加参数验证和默认值处理
