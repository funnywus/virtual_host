#!/usr/bin/env node

/**
 * 数据库迁移脚本：添加限流配置字段
 * 
 * 使用方法:
 * node backend/scripts/add-rate-limit-fields.js
 */

require('dotenv').config();
const db = require('../db/database');

async function migrate() {
  console.log('开始迁移：添加限流配置字段...');
  
  try {
    if (db.type === 'mysql') {
      // MySQL 迁移
      console.log('检测到 MySQL 数据库');
      
      // 检查字段是否已存在
      const columns = await db.all(`
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'subdomains' 
        AND COLUMN_NAME IN ('rate_limit_enabled', 'rate_limit_rate', 'rate_limit_burst', 'rate_limit_nodelay', 'rate_limit_conn')
      `);
      
      if (columns.length === 5) {
        console.log('✓ 限流字段已存在，无需迁移');
        return;
      }
      
      // 添加字段
      const fieldsToAdd = [
        { name: 'rate_limit_enabled', sql: 'ALTER TABLE subdomains ADD COLUMN rate_limit_enabled TINYINT DEFAULT 0' },
        { name: 'rate_limit_rate', sql: "ALTER TABLE subdomains ADD COLUMN rate_limit_rate VARCHAR(20) DEFAULT '10r/s'" },
        { name: 'rate_limit_burst', sql: 'ALTER TABLE subdomains ADD COLUMN rate_limit_burst INT DEFAULT 20' },
        { name: 'rate_limit_nodelay', sql: 'ALTER TABLE subdomains ADD COLUMN rate_limit_nodelay TINYINT DEFAULT 1' },
        { name: 'rate_limit_conn', sql: 'ALTER TABLE subdomains ADD COLUMN rate_limit_conn INT DEFAULT 10' }
      ];
      
      for (const field of fieldsToAdd) {
        const exists = columns.find(c => c.COLUMN_NAME === field.name);
        if (!exists) {
          console.log(`添加字段: ${field.name}`);
          await db.run(field.sql);
        }
      }
      
    } else {
      // SQLite 迁移
      console.log('检测到 SQLite 数据库');
      
      // 检查字段是否已存在
      const tableInfo = await db.all('PRAGMA table_info(subdomains)');
      const existingFields = tableInfo.map(col => col.name);
      
      if (existingFields.includes('rate_limit_enabled')) {
        console.log('✓ 限流字段已存在，无需迁移');
        return;
      }
      
      // SQLite 添加字段
      const fieldsToAdd = [
        'ALTER TABLE subdomains ADD COLUMN rate_limit_enabled INTEGER DEFAULT 0',
        "ALTER TABLE subdomains ADD COLUMN rate_limit_rate TEXT DEFAULT '10r/s'",
        'ALTER TABLE subdomains ADD COLUMN rate_limit_burst INTEGER DEFAULT 20',
        'ALTER TABLE subdomains ADD COLUMN rate_limit_nodelay INTEGER DEFAULT 1',
        'ALTER TABLE subdomains ADD COLUMN rate_limit_conn INTEGER DEFAULT 10'
      ];
      
      for (const sql of fieldsToAdd) {
        console.log(`执行: ${sql}`);
        await db.run(sql);
      }
    }
    
    console.log('✓ 迁移完成！限流配置字段已添加到 subdomains 表');
    
  } catch (err) {
    console.error('✗ 迁移失败:', err.message);
    process.exit(1);
  }
  
  process.exit(0);
}

migrate();
