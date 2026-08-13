/**
 * 通用后台长任务表（批建子域名、批补发脚本等）
 */
module.exports = {
  id: '002_batch_jobs',
  async up({ db, checkTableExists }) {
    const exists = await checkTableExists('batch_jobs');
    if (exists) return;

    await db.run(`
      CREATE TABLE batch_jobs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        job_id VARCHAR(64) UNIQUE NOT NULL,
        user_id INT NOT NULL,
        job_type VARCHAR(64) NOT NULL,
        status VARCHAR(32) DEFAULT 'pending',
        total INT DEFAULT 0,
        done INT DEFAULT 0,
        success_count INT DEFAULT 0,
        failed_count INT DEFAULT 0,
        message VARCHAR(500) DEFAULT '',
        payload LONGTEXT,
        results LONGTEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        started_at DATETIME NULL,
        finished_at DATETIME NULL,
        INDEX idx_batch_jobs_user (user_id),
        INDEX idx_batch_jobs_type_status (job_type, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('[DB Migration]   + batch_jobs');
  }
};
