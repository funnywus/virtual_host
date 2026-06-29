<?php
/**
 * 分片直传接收脚本（由管理后台自动下发到各站点目录）
 * 工作流程：init -> chunk(多次) -> merge
 * 鉴权：HMAC-SHA256 签名 + 时间戳，密钥由后台下发时替换 __SIGN_SECRET__
 *
 * 安全说明：
 * - 本脚本所在目录即为网站根目录，文件只能写入该目录及其子目录
 * - 文件名/相对路径做了目录穿越防护
 * - token 有时效，过期失效
 */

// ===== CORS（允许管理后台页面跨域上传）=====
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Access-Control-Max-Age: 86400');
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// ===== 配置（下发时替换占位符）=====
define('SIGN_SECRET', '__SIGN_SECRET__');
define('ROOT_DIR', __DIR__);                       // 网站根目录
define('TEMP_BASE', __DIR__ . '/.upload_tmp');     // 分片临时目录

function jsonOut($data, $code = 200) {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

// ===== 验签：token = HMAC-SHA256(expires, SECRET)，expires 为过期时间戳（秒）=====
function verifyToken($token, $expires) {
    if (!$token || !$expires) return false;
    if (!ctype_digit((string)$expires)) return false;
    if (time() > intval($expires)) return false;
    $expect = hash_hmac('sha256', (string)$expires, SIGN_SECRET);
    return hash_equals($expect, $token);
}

// ===== 安全清理文件名（去掉路径分隔与危险字符）=====
function safeName($name) {
    $name = basename((string)$name);
    $name = preg_replace('/[^\w.\-\x{4e00}-\x{9fa5} ()（）\[\]]+/u', '_', $name);
    if ($name === '' || $name === '.' || $name === '..') {
        $name = 'file_' . time();
    }
    return $name;
}

// ===== 安全解析相对子目录（禁止穿越到网站根目录之外）=====
function safeSubDir($relPath) {
    $relPath = str_replace('\\', '/', (string)$relPath);
    $parts = [];
    foreach (explode('/', $relPath) as $seg) {
        $seg = trim($seg);
        if ($seg === '' || $seg === '.') continue;
        if ($seg === '..') return false; // 禁止上跳
        $parts[] = preg_replace('/[^\w.\-\x{4e00}-\x{9fa5} ()（）\[\]]+/u', '_', $seg);
    }
    return implode('/', $parts);
}

// uploadId 只允许十六进制，作为临时目录名，防注入
function safeUploadId($id) {
    return preg_match('/^[a-f0-9]{8,64}$/i', (string)$id) ? $id : false;
}

// ===== 入口 =====
$action  = $_POST['action']  ?? $_GET['action']  ?? '';
$token   = $_POST['token']   ?? $_GET['token']   ?? '';
$expires = $_POST['expires'] ?? $_GET['expires'] ?? '';

if (!verifyToken($token, $expires)) {
    jsonOut(['error' => '鉴权失败或链接已过期'], 403);
}

if (!is_dir(TEMP_BASE)) {
    @mkdir(TEMP_BASE, 0755, true);
}

switch ($action) {
    case 'chunk':
        handleChunk();
        break;
    case 'merge':
        handleMerge();
        break;
    case 'status':
        handleStatus();
        break;
    default:
        jsonOut(['error' => '未知操作'], 400);
}

// ===== 接收单个分片 =====
function handleChunk() {
    $uploadId = safeUploadId($_POST['uploadId'] ?? '');
    $index    = $_POST['index'] ?? '';
    if ($uploadId === false || !ctype_digit((string)$index)) {
        jsonOut(['error' => '参数错误'], 400);
    }
    if (!isset($_FILES['chunk']) || $_FILES['chunk']['error'] !== UPLOAD_ERR_OK) {
        jsonOut(['error' => '分片数据缺失'], 400);
    }

    $chunkDir = TEMP_BASE . '/' . $uploadId;
    if (!is_dir($chunkDir) && !@mkdir($chunkDir, 0755, true)) {
        jsonOut(['error' => '创建临时目录失败'], 500);
    }

    $dest = $chunkDir . '/chunk_' . intval($index);
    if (!move_uploaded_file($_FILES['chunk']['tmp_name'], $dest)) {
        jsonOut(['error' => '保存分片失败'], 500);
    }

    jsonOut(['success' => true, 'index' => intval($index)]);
}

// ===== 合并分片到目标文件 =====
function handleMerge() {
    $uploadId    = safeUploadId($_POST['uploadId'] ?? '');
    $totalChunks = $_POST['total_chunks'] ?? '';
    $filename    = safeName($_POST['filename'] ?? '');
    $subDir      = safeSubDir($_POST['path'] ?? '');

    if ($uploadId === false || !ctype_digit((string)$totalChunks)) {
        jsonOut(['error' => '参数错误'], 400);
    }
    if ($subDir === false) {
        jsonOut(['error' => '非法的目标路径'], 400);
    }

    $total = intval($totalChunks);
    $chunkDir = TEMP_BASE . '/' . $uploadId;

    // 校验所有分片齐全
    for ($i = 0; $i < $total; $i++) {
        if (!is_file($chunkDir . '/chunk_' . $i)) {
            jsonOut(['error' => "分片不完整，缺少分片 $i"], 400);
        }
    }

    // 目标目录
    $targetDir = ROOT_DIR . ($subDir !== '' ? '/' . $subDir : '');
    if (!is_dir($targetDir) && !@mkdir($targetDir, 0755, true)) {
        jsonOut(['error' => '创建目标目录失败'], 500);
    }

    $targetFile = $targetDir . '/' . $filename;

    // 流式合并，避免内存溢出
    $out = @fopen($targetFile, 'wb');
    if (!$out) {
        jsonOut(['error' => '无法写入目标文件，请检查目录权限'], 500);
    }
    for ($i = 0; $i < $total; $i++) {
        $in = @fopen($chunkDir . '/chunk_' . $i, 'rb');
        if (!$in) {
            fclose($out);
            jsonOut(['error' => "读取分片 $i 失败"], 500);
        }
        while (!feof($in)) {
            $buf = fread($in, 1048576); // 1MB
            if ($buf === false) break;
            fwrite($out, $buf);
        }
        fclose($in);
    }
    fclose($out);

    // 清理临时分片
    for ($i = 0; $i < $total; $i++) {
        @unlink($chunkDir . '/chunk_' . $i);
    }
    @rmdir($chunkDir);

    @chmod($targetFile, 0644);

    jsonOut([
        'success'  => true,
        'message'  => '上传成功',
        'filename' => $filename,
        'size'     => is_file($targetFile) ? filesize($targetFile) : 0
    ]);
}

// ===== 查询已上传分片（用于断点续传）=====
function handleStatus() {
    $uploadId = safeUploadId($_POST['uploadId'] ?? ($_GET['uploadId'] ?? ''));
    if ($uploadId === false) {
        jsonOut(['error' => '参数错误'], 400);
    }
    $chunkDir = TEMP_BASE . '/' . $uploadId;
    $uploaded = [];
    if (is_dir($chunkDir)) {
        foreach (scandir($chunkDir) as $f) {
            if (preg_match('/^chunk_(\d+)$/', $f, $m)) {
                $uploaded[] = intval($m[1]);
            }
        }
    }
    jsonOut(['success' => true, 'uploaded' => $uploaded]);
}
