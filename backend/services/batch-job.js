/**
 * 通用长任务：内存 + MySQL 双写，供批建/批补发等异步进度查询
 */
const db = require('../db/database');

const memoryJobs = new Map();
const JOB_TTL_MS = 6 * 60 * 60 * 1000;

function formatTime(date = new Date()) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function newJobId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function toPublic(job) {
  if (!job) return null;
  return {
    job_id: job.job_id,
    job_type: job.job_type,
    status: job.status,
    total: job.total || 0,
    done: job.done || 0,
    success: job.success_count || 0,
    failed: job.failed_count || 0,
    message: job.message || '',
    results: job.results || [],
    created_at: job.created_at,
    updated_at: job.updated_at,
    started_at: job.started_at,
    finished_at: job.finished_at,
    percent: job.total > 0 ? Math.min(100, Math.round((job.done / job.total) * 100)) : 0
  };
}

async function createJob({ userId, jobType, total = 0, payload = null, message = '' }) {
  const job_id = newJobId();
  const now = formatTime();
  const job = {
    job_id,
    user_id: userId,
    job_type: jobType,
    status: 'pending',
    total,
    done: 0,
    success_count: 0,
    failed_count: 0,
    message,
    payload,
    results: [],
    created_at: now,
    updated_at: now,
    started_at: null,
    finished_at: null,
    _finished_ms: null
  };

  await db.run(
    `INSERT INTO batch_jobs
      (job_id, user_id, job_type, status, total, done, success_count, failed_count, message, payload, results, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      job.job_id,
      job.user_id,
      job.job_type,
      job.status,
      job.total,
      job.done,
      job.success_count,
      job.failed_count,
      job.message,
      payload ? JSON.stringify(payload) : null,
      '[]',
      now,
      now
    ]
  );

  memoryJobs.set(job_id, job);
  return job;
}

async function saveJob(job) {
  job.updated_at = formatTime();
  memoryJobs.set(job.job_id, job);
  await db.run(
    `UPDATE batch_jobs SET
      status=?, total=?, done=?, success_count=?, failed_count=?, message=?,
      results=?, updated_at=?, started_at=?, finished_at=?
     WHERE job_id=?`,
    [
      job.status,
      job.total || 0,
      job.done || 0,
      job.success_count || 0,
      job.failed_count || 0,
      job.message || '',
      JSON.stringify(job.results || []),
      job.updated_at,
      job.started_at,
      job.finished_at,
      job.job_id
    ]
  );
}

async function startJob(job, message = '') {
  job.status = 'running';
  job.started_at = formatTime();
  job.message = message || job.message;
  await saveJob(job);
}

async function progressJob(job, patch = {}) {
  Object.assign(job, patch);
  await saveJob(job);
}

async function finishJob(job, { status = 'completed', message = '' } = {}) {
  job.status = status;
  job.message = message || job.message;
  job.finished_at = formatTime();
  job._finished_ms = Date.now();
  if (job.done < job.total && status === 'completed') {
    job.done = job.total;
  }
  await saveJob(job);
}

async function getJob(jobId, user) {
  let job = memoryJobs.get(jobId);
  if (!job) {
    const row = await db.get('SELECT * FROM batch_jobs WHERE job_id = ?', [jobId]);
    if (!row) return null;
    job = {
      ...row,
      results: safeJson(row.results, []),
      payload: safeJson(row.payload, null)
    };
    memoryJobs.set(jobId, job);
  }
  if (user && user.role !== 'admin' && Number(job.user_id) !== Number(user.id)) {
    return null;
  }
  return job;
}

function safeJson(text, fallback) {
  if (text == null || text === '') return fallback;
  if (typeof text !== 'string') return text;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function cleanupMemoryJobs() {
  const now = Date.now();
  for (const [id, job] of memoryJobs.entries()) {
    if (job._finished_ms && now - job._finished_ms > JOB_TTL_MS) {
      memoryJobs.delete(id);
    }
  }
}

setInterval(cleanupMemoryJobs, 30 * 60 * 1000).unref?.();

module.exports = {
  createJob,
  saveJob,
  startJob,
  progressJob,
  finishJob,
  getJob,
  toPublic,
  formatTime
};
