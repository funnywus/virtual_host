/**
 * 统一 DB 迁移入口：按版本号顺序执行 backend/db/migrations/*.js
 */
const fs = require('fs');
const path = require('path');
const db = require('./database');

async function getTableColumns(tableName) {
  if (db.type === 'mysql') {
    const rows = await db.all(`SHOW COLUMNS FROM ${tableName}`);
    return rows.map((row) => ({ name: row.Field }));
  }
  return db.all(`PRAGMA table_info(${tableName})`);
}

async function checkTableExists(tableName) {
  try {
    if (db.type === 'mysql') {
      const rows = await db.all(`SHOW TABLES LIKE '${tableName}'`);
      return rows.length > 0;
    }
    const row = await db.get(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
      [tableName]
    );
    return !!row;
  } catch {
    return false;
  }
}

async function ensureMigrationsTable() {
  if (db.type === 'mysql') {
    await db.run(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id VARCHAR(191) PRIMARY KEY,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  } else {
    await db.run(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }
}

function loadMigrationModules() {
  const dir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d+_.+\.js$/.test(f))
    .sort()
    .map((file) => {
      const mod = require(path.join(dir, file));
      const id = mod.id || file.replace(/\.js$/, '');
      if (typeof mod.up !== 'function') {
        throw new Error(`migration ${file} missing up()`);
      }
      return { id, file, up: mod.up };
    });
}

async function isApplied(id) {
  const row = await db.get('SELECT id FROM schema_migrations WHERE id = ?', [id]);
  return !!row;
}

async function markApplied(id) {
  await db.run('INSERT INTO schema_migrations (id) VALUES (?)', [id]);
}

/**
 * 运行未应用的迁移
 */
async function runMigrations() {
  await ensureMigrationsTable();
  const migrations = loadMigrationModules();
  const helpers = { getTableColumns, checkTableExists, db };

  for (const mig of migrations) {
    if (await isApplied(mig.id)) continue;
    console.log(`[DB Migration] → ${mig.id}`);
    await mig.up(helpers);
    await markApplied(mig.id);
    console.log(`[DB Migration] ✓ ${mig.id}`);
  }
}

module.exports = {
  runMigrations,
  getTableColumns,
  checkTableExists
};
