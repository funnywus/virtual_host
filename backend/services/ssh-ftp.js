const { Client } = require('ssh2');
const sshPool = require('../utils/ssh-connection-pool');

/** 同主机 FTP 类型探测缓存，避免批建时反复 which/systemctl */
const ftpTypeCache = new Map(); // key -> { type, expireAt }
const FTP_TYPE_TTL_MS = 10 * 60 * 1000;

function hostCacheKey(server) {
  return `${server.ip || ''}:${server.port || 22}:${server.username || ''}`;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

class SshFtpService {
  constructor(server) {
    this.server = server;
  }

  poolConfig() {
    return {
      ip: this.server.ip,
      port: this.server.port || 22,
      username: this.server.username,
      password: this.server.password
    };
  }

  // 执行SSH命令（默认走连接池；server.usePool === false 时直连）
  exec(command, timeout = 300000) {
    if (this.server.usePool === false) {
      return this.execDirect(command, timeout);
    }
    return sshPool.exec(this.poolConfig(), command, timeout);
  }

  execDirect(command, timeout = 300000) {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      let output = '';
      let errorOutput = '';
      let timeoutId = null;

      timeoutId = setTimeout(() => {
        conn.end();
        resolve({ success: false, output: `${output.trim()}\n[命令执行超时]`, code: -1 });
      }, timeout);

      conn.on('ready', () => {
        conn.exec(command, (err, stream) => {
          if (err) {
            clearTimeout(timeoutId);
            conn.end();
            return reject(err);
          }

          stream.on('close', (code) => {
            clearTimeout(timeoutId);
            conn.end();
            if (code === 0) {
              resolve({ success: true, output: output.trim() });
            } else {
              resolve({ success: false, output: errorOutput.trim() || output.trim(), code });
            }
          });

          stream.on('data', (data) => {
            output += data.toString();
          });

          stream.stderr.on('data', (data) => {
            errorOutput += data.toString();
            output += data.toString();
          });
        });
      });

      conn.on('error', (err) => {
        clearTimeout(timeoutId);
        reject(err);
      });

      conn.connect({
        host: this.server.ip,
        port: this.server.port || 22,
        username: this.server.username,
        password: this.server.password,
        readyTimeout: 10000
      });
    });
  }

  // 检测FTP服务类型（同主机短时缓存）
  async detectFtpService() {
    const key = hostCacheKey(this.server);
    const cached = ftpTypeCache.get(key);
    if (cached && cached.expireAt > Date.now()) {
      return cached.type;
    }

    // 单次 SSH 探测三种常见 FTP
    const probe = await this.exec(`
TYPE=""
if command -v vsftpd >/dev/null 2>&1 || systemctl is-active vsftpd >/dev/null 2>&1; then TYPE=vsftpd
elif command -v pure-pw >/dev/null 2>&1 || systemctl is-active pure-ftpd >/dev/null 2>&1; then TYPE=pure-ftpd
elif command -v proftpd >/dev/null 2>&1 || systemctl is-active proftpd >/dev/null 2>&1; then TYPE=proftpd
fi
echo "FTP_TYPE:$TYPE"
`.trim());

    let type = null;
    const m = String(probe.output || '').match(/FTP_TYPE:(\S*)/);
    if (m && m[1]) type = m[1];

    ftpTypeCache.set(key, { type, expireAt: Date.now() + FTP_TYPE_TTL_MS });
    return type;
  }

  /** 安装成功后写入缓存，避免紧接着再探测 */
  rememberFtpType(type) {
    ftpTypeCache.set(hostCacheKey(this.server), {
      type: type || 'vsftpd',
      expireAt: Date.now() + FTP_TYPE_TTL_MS
    });
  }

  // 自动安装FTP服务 (vsftpd)
  async installFtpService() {
    console.log('[FTP] 检测到服务器未安装FTP服务，开始自动安装vsftpd...');
    
    // 检测系统类型
    const osRelease = await this.exec('cat /etc/os-release 2>/dev/null | grep -E "^ID=" | cut -d= -f2 | tr -d \'"\'');
    const osType = osRelease.output?.trim().toLowerCase() || '';
    
    let installCmd = '';
    if (osType.includes('ubuntu') || osType.includes('debian')) {
      installCmd = 'apt-get update && apt-get install -y vsftpd';
    } else if (osType.includes('centos') || osType.includes('rhel') || osType.includes('rocky') || osType.includes('almalinux') || osType.includes('fedora')) {
      installCmd = 'yum install -y vsftpd || dnf install -y vsftpd';
    } else {
      // 尝试通用方式
      installCmd = 'apt-get update && apt-get install -y vsftpd || yum install -y vsftpd || dnf install -y vsftpd';
    }
    
    // 安装vsftpd
    const installResult = await this.exec(`sudo ${installCmd}`, 120000);
    if (!installResult.success && !installResult.output?.includes('vsftpd')) {
      return { success: false, message: 'FTP服务安装失败: ' + installResult.output };
    }
    
    // 配置vsftpd
    const vsftpdConfig = `
listen=YES
listen_ipv6=NO
anonymous_enable=NO
local_enable=YES
write_enable=YES
local_umask=022
dirmessage_enable=YES
use_localtime=YES
xferlog_enable=YES
connect_from_port_20=YES
chroot_local_user=YES
allow_writeable_chroot=YES
secure_chroot_dir=/var/run/vsftpd/empty
pam_service_name=vsftpd
rsa_cert_file=/etc/ssl/certs/ssl-cert-snakeoil.pem
rsa_private_key_file=/etc/ssl/private/ssl-cert-snakeoil.key
ssl_enable=NO
pasv_enable=YES
pasv_min_port=40000
pasv_max_port=40100
userlist_enable=NO
`;
    
    // 备份/写配置/启动合并为少量命令
    await this.exec(`
sudo cp /etc/vsftpd.conf /etc/vsftpd.conf.bak 2>/dev/null || true
printf %s ${shellQuote(vsftpdConfig)} | sudo tee /etc/vsftpd.conf >/dev/null
sudo mkdir -p /var/run/vsftpd/empty
sudo systemctl enable vsftpd
sudo systemctl restart vsftpd
`.trim());

    // 验证安装
    const checkResult = await this.exec('systemctl is-active vsftpd');
    if (checkResult.output?.trim() === 'active') {
      console.log('[FTP] vsftpd安装并启动成功');
      this.rememberFtpType('vsftpd');
      return { success: true, message: 'FTP服务(vsftpd)安装成功' };
    } else {
      return { success: false, message: 'FTP服务安装后启动失败' };
    }
  }

  // 创建FTP用户 (通用Linux用户方式)
  async createFtpUser(username, password, homeDir) {
    try {
      // 先检测FTP服务是否存在，不存在则自动安装
      const ftpType = await this.detectFtpService();
      if (!ftpType) {
        const installResult = await this.installFtpService();
        if (!installResult.success) {
          return installResult;
        }
      }

      const indexHtml = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Welcome</title>
    <style>
        body { font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
        .container { text-align: center; padding: 40px; background: #fff; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #333; }
        p { color: #666; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Welcome!</h1>
        <p>网站建设中...</p>
    </div>
</body>
</html>
`;

      // 单次 SSH：建目录/建用户/设密/权限/默认页
      const result = await this.exec(`
set -e
USER=${shellQuote(username)}
PASS=${shellQuote(password)}
HOME_DIR=${shellQuote(homeDir)}
sudo mkdir -p "$HOME_DIR"
if id "$USER" >/dev/null 2>&1; then
  echo "$USER:$PASS" | sudo chpasswd
else
  sudo useradd -m -d "$HOME_DIR" -s /bin/false "$USER" 2>/dev/null \\
    || sudo useradd -m -d "$HOME_DIR" -s /sbin/nologin "$USER"
  echo "$USER:$PASS" | sudo chpasswd
fi
sudo chown "$USER:$USER" "$HOME_DIR"
sudo chmod 755 "$HOME_DIR"
if [ ! -f "$HOME_DIR/index.html" ]; then
  printf %s ${shellQuote(indexHtml)} | sudo tee "$HOME_DIR/index.html" >/dev/null
  sudo chown "$USER:$USER" "$HOME_DIR/index.html"
fi
echo FTP_USER_OK
`.trim());

      if (!result.success || !(result.output || '').includes('FTP_USER_OK')) {
        return { success: false, message: result.output || 'FTP用户创建失败' };
      }

      return { success: true, message: 'FTP用户创建成功' };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  // 创建Pure-FTPd虚拟用户
  async createPureFtpdUser(username, password, homeDir) {
    try {
      await this.exec(`sudo mkdir -p ${homeDir}`);
      
      // 创建虚拟用户
      const result = await this.exec(
        `echo "${password}" | sudo pure-pw useradd ${username} -u www-data -g www-data -d ${homeDir} -m`
      );

      if (!result.success && !result.output.includes('already exists')) {
        return { success: false, message: '创建Pure-FTPd用户失败: ' + result.output };
      }

      // 更新数据库
      await this.exec('sudo pure-pw mkdb');

      // 设置目录权限
      await this.exec(`sudo chown www-data:www-data ${homeDir}`);
      await this.exec(`sudo chmod 755 ${homeDir}`);

      return { success: true, message: 'Pure-FTPd用户创建成功' };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  // 删除FTP用户
  async deleteFtpUser(username) {
    try {
      // 尝试删除系统用户
      await this.exec(`sudo userdel ${username} 2>/dev/null`);
      
      // 尝试删除Pure-FTPd虚拟用户
      await this.exec(`sudo pure-pw userdel ${username} 2>/dev/null && sudo pure-pw mkdb 2>/dev/null`);

      return { success: true, message: '用户删除成功' };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  // 修改FTP用户密码
  async changePassword(username, newPassword) {
    try {
      // 系统用户方式
      const result = await this.exec(`echo "${username}:${newPassword}" | sudo chpasswd`);
      
      // Pure-FTPd方式
      await this.exec(`echo "${newPassword}" | sudo pure-pw passwd ${username} -m 2>/dev/null && sudo pure-pw mkdb 2>/dev/null`);

      return { success: true, message: '密码修改成功' };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  // 测试SSH连接
  async testConnection() {
    try {
      const result = await this.exec('echo "connected"');
      return { success: result.success, message: result.success ? 'SSH连接成功' : 'SSH连接失败' };
    } catch (err) {
      return { success: false, message: 'SSH连接失败: ' + err.message };
    }
  }

  // SFTP上传文件（支持大文件）
  uploadFile(localBuffer, remotePath) {
    if (this.server.usePool === false) {
      return this._sftpWithNewConn((conn) => new Promise((resolve, reject) => {
        conn.sftp((err, sftp) => {
          if (err) return reject(err);
          const writeStream = sftp.createWriteStream(remotePath);
          writeStream.on('close', () => resolve({ success: true, message: '上传成功' }));
          writeStream.on('error', reject);
          writeStream.end(localBuffer);
        });
      }), true);
    }

    return sshPool.withConnection(this.poolConfig(), (conn) => new Promise((resolve, reject) => {
      conn.sftp((err, sftp) => {
        if (err) return reject(err);
        const writeStream = sftp.createWriteStream(remotePath);
        writeStream.on('close', () => resolve({ success: true, message: '上传成功' }));
        writeStream.on('error', reject);
        writeStream.end(localBuffer);
      });
    }));
  }

  // SFTP流式上传文件（避免内存溢出，适合大文件）
  // onProgress(bytesWritten) 可选，用于实时上报上传进度
  uploadFileStream(localPath, remotePath, onProgress) {
    const fs = require('fs');
    const run = (conn) => new Promise((resolve, reject) => {
      conn.sftp((err, sftp) => {
        if (err) return reject(err);

        const readStream = fs.createReadStream(localPath);
        const writeStream = sftp.createWriteStream(remotePath);
        let bytesWritten = 0;

        writeStream.on('close', () => {
          resolve({ success: true, message: '上传成功', bytesWritten });
        });
        writeStream.on('error', reject);
        readStream.on('error', reject);
        readStream.on('data', (chunk) => {
          bytesWritten += chunk.length;
          if (typeof onProgress === 'function') onProgress(bytesWritten);
        });
        readStream.pipe(writeStream);
      });
    });

    if (this.server.usePool === false) {
      return this._sftpWithNewConn(run, true);
    }
    return sshPool.withConnection(this.poolConfig(), run);
  }

  /**
   * 将远端文件流式 pipe 到可写流（如 HTTP response）
   */
  streamRemoteFile(remotePath, writable) {
    const run = (conn, endConn) => new Promise((resolve, reject) => {
      let settled = false;
      const finish = (err) => {
        if (settled) return;
        settled = true;
        if (endConn) {
          try { conn.end(); } catch (_) { /* ignore */ }
        }
        if (err) reject(err);
        else resolve();
      };

      conn.sftp((err, sftp) => {
        if (err) return finish(err);
        const rs = sftp.createReadStream(remotePath);
        rs.on('error', (e) => finish(e));
        writable.on('error', (e) => {
          try { rs.destroy(); } catch (_) { /* ignore */ }
          finish(e);
        });
        writable.on('close', () => {
          if (!settled) {
            try { rs.destroy(); } catch (_) { /* ignore */ }
            finish();
          }
        });
        rs.on('end', () => finish());
        rs.pipe(writable);
      });
    });

    if (this.server.usePool === false) {
      return this._sftpWithNewConn((conn) => run(conn, false), true);
    }
    return sshPool.withConnection(this.poolConfig(), (conn) => run(conn, false));
  }

  /** 直连包装（不走池）；endOnDone 时在 finally 关闭连接 */
  _sftpWithNewConn(fn, endOnDone) {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      conn.on('ready', () => {
        Promise.resolve(fn(conn))
          .then((result) => {
            if (endOnDone) {
              try { conn.end(); } catch (_) { /* ignore */ }
            }
            resolve(result);
          })
          .catch((err) => {
            try { conn.end(); } catch (_) { /* ignore */ }
            reject(err);
          });
      });
      conn.on('error', reject);
      conn.connect({
        host: this.server.ip,
        port: this.server.port || 22,
        username: this.server.username,
        password: this.server.password,
        readyTimeout: 30000,
        keepaliveInterval: 10000,
        keepaliveCountMax: 360
      });
    });
  }
}

module.exports = SshFtpService;
