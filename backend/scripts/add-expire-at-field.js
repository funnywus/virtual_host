const db = require('../db/database');

async function addExpireAtField() {
  try {
    console.log('开始添加 expire_at 字段...');
    
    // 检查 domains 表是否已有 expire_at 字段
    const domainsColumns = await db.all("PRAGMA table_info(domains)");
    const hasDomainsExpireAt = domainsColumns.some(col => col.name === 'expire_at');
    
    if (!hasDomainsExpireAt) {
      console.log('为 domains 表添加 expire_at 字段...');
      await db.run('ALTER TABLE domains ADD COLUMN expire_at DATETIME DEFAULT NULL');
      console.log('✓ domains 表添加成功');
    } else {
      console.log('✓ domains 表已有 expire_at 字段');
    }
    
    // 检查 servers 表是否已有 expire_at 字段
    const serversColumns = await db.all("PRAGMA table_info(servers)");
    const hasServersExpireAt = serversColumns.some(col => col.name === 'expire_at');
    
    if (!hasServersExpireAt) {
      console.log('为 servers 表添加 expire_at 字段...');
      await db.run('ALTER TABLE servers ADD COLUMN expire_at DATETIME DEFAULT NULL');
      console.log('✓ servers 表添加成功');
    } else {
      console.log('✓ servers 表已有 expire_at 字段');
    }
    
    console.log('\n✅ 所有字段添加完成！');
    process.exit(0);
  } catch (err) {
    console.error('❌ 错误:', err.message);
    process.exit(1);
  }
}

addExpireAtField();
