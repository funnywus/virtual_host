/**
 * 站点直传系统文件（对用户隐藏、不可通过上传页删除）
 * 放在 _vhost/ 下（非 dot 目录，nginx 不会 deny；属主 www，FTP 用户无法改动）
 */
const VHOST_DIR = '_vhost';
const UPLOAD_SCRIPT = 'upload.php';
const UPLOAD_TMP = '.upload_tmp';

const UPLOAD_PUBLIC_PATH = `/${VHOST_DIR}/${UPLOAD_SCRIPT}`;

function normalizeRelPath(p) {
  return String(p || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

/** 相对站点根的路径是否受保护（不可删/改/读） */
function isProtectedPath(relativePath) {
  const rel = normalizeRelPath(relativePath);
  if (!rel) return false;
  if (rel === VHOST_DIR || rel.startsWith(`${VHOST_DIR}/`)) return true;
  // 旧版根目录路径（兼容已部署站点）
  if (rel === UPLOAD_SCRIPT || rel === UPLOAD_TMP || rel.startsWith(`${UPLOAD_TMP}/`)) return true;
  return false;
}

/** 文件列表中是否隐藏 */
function shouldHideInList(name, currentPath) {
  const rel = currentPath ? `${normalizeRelPath(currentPath)}/${name}` : name;
  return isProtectedPath(rel);
}

function scriptRelPath() {
  return `${VHOST_DIR}/${UPLOAD_SCRIPT}`;
}

function tmpRelPath() {
  return `${VHOST_DIR}/${UPLOAD_TMP}`;
}

module.exports = {
  VHOST_DIR,
  UPLOAD_SCRIPT,
  UPLOAD_TMP,
  UPLOAD_PUBLIC_PATH,
  isProtectedPath,
  shouldHideInList,
  scriptRelPath,
  tmpRelPath,
  normalizeRelPath,
};
