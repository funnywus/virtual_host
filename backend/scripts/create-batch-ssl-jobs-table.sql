-- 创建批量SSL证书任务表
-- 适用于 MySQL 数据库

CREATE TABLE IF NOT EXISTS batch_ssl_jobs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  job_id VARCHAR(255) UNIQUE NOT NULL COMMENT '任务唯一ID',
  user_id INT NOT NULL COMMENT '用户ID',
  status VARCHAR(50) DEFAULT 'pending' COMMENT '任务状态: pending, running, completed, completed_with_errors, error',
  total INT DEFAULT 0 COMMENT '总域名数',
  done INT DEFAULT 0 COMMENT '已完成数',
  success INT DEFAULT 0 COMMENT '成功数',
  failed INT DEFAULT 0 COMMENT '失败数',
  log TEXT COMMENT '执行日志',
  results TEXT COMMENT '结果JSON',
  cert_type VARCHAR(50) DEFAULT 'letsencrypt' COMMENT '证书类型',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  started_at DATETIME COMMENT '开始时间',
  finished_at DATETIME COMMENT '完成时间',
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_id (user_id),
  INDEX idx_status (status),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='批量SSL证书任务表';

-- 查看表结构
DESC batch_ssl_jobs;

-- 查看表数据
SELECT * FROM batch_ssl_jobs ORDER BY created_at DESC LIMIT 10;
