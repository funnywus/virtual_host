/**
 * FTP 已使用空间缓存：刷新后落库，列表默认不再实时 SSH 统计。
 */
module.exports = {
  id: '002_ftp_used_size',

  async up({ db, getTableColumns }) {
    const columns = await getTableColumns('ftp_accounts');
    if (!columns.some((col) => col.name === 'used_size')) {
      await db.run('ALTER TABLE ftp_accounts ADD COLUMN used_size BIGINT DEFAULT NULL');
      console.log('[DB Migration]   + ftp_accounts.used_size');
    }
    if (!columns.some((col) => col.name === 'used_size_at')) {
      await db.run('ALTER TABLE ftp_accounts ADD COLUMN used_size_at DATETIME DEFAULT NULL');
      console.log('[DB Migration]   + ftp_accounts.used_size_at');
    }
  }
};
