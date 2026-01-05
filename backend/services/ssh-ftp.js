const { Client } = require('ssh2');

class SshFtpService {
  constructor(server) {
    this.server = server;
  }

  // 执行SSH命令
  exec(command, timeout = 300000) {  // 默认5分钟超时
    return new Promise((resolve, reject) => {
      const conn = new Client();
      let output = '';
      let errorOutput = '';
      let timeoutId = null;

      // 设置超时
      timeoutId = setTimeout(() => {
        conn.end();
        resolve({ success: false, output: output.trim() + '\n[命令执行超时]', code: -1 });
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
            output += data.toString();  // 也加到output方便查看完整日志
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

  // 检测FTP服务类型
  async detectFtpService() {
    // 检查vsftpd
    const vsftpd = await this.exec('which vsftpd 2>/dev/null || systemctl status vsftpd 2>/dev/null | head -1');
    if (vsftpd.success && vsftpd.output && !vsftpd.output.includes('not found')) {
      return 'vsftpd';
    }

    // 检查pure-ftpd
    const pureftpd = await this.exec('which pure-pw 2>/dev/null || systemctl status pure-ftpd 2>/dev/null | head -1');
    if (pureftpd.success && pureftpd.output && !pureftpd.output.includes('not found')) {
      return 'pure-ftpd';
    }

    // 检查proftpd
    const proftpd = await this.exec('which proftpd 2>/dev/null || systemctl status proftpd 2>/dev/null | head -1');
    if (proftpd.success && proftpd.output && !proftpd.output.includes('not found')) {
      return 'proftpd';
    }

    return null;
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
    
    // 备份原配置并写入新配置
    await this.exec('sudo cp /etc/vsftpd.conf /etc/vsftpd.conf.bak 2>/dev/null');
    await this.exec(`echo '${vsftpdConfig}' | sudo tee /etc/vsftpd.conf`);
    
    // 创建必要目录
    await this.exec('sudo mkdir -p /var/run/vsftpd/empty');
    
    // 启动并设置开机自启
    await this.exec('sudo systemctl enable vsftpd');
    await this.exec('sudo systemctl restart vsftpd');
    
    // 验证安装
    const checkResult = await this.exec('systemctl is-active vsftpd');
    if (checkResult.output?.trim() === 'active') {
      console.log('[FTP] vsftpd安装并启动成功');
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

      // 创建用户目录
      await this.exec(`sudo mkdir -p ${homeDir}`);

      // 检查用户是否存在
      const userExists = await this.exec(`id ${username} 2>/dev/null`);
      
      if (userExists.success) {
        // 用户已存在，更新密码
        const updatePwd = await this.exec(`echo "${username}:${password}" | sudo chpasswd`);
        if (!updatePwd.success) {
          return { success: false, message: '更新密码失败: ' + updatePwd.output };
        }
      } else {
        // 创建新用户
        const createUser = await this.exec(
          `sudo useradd -m -d ${homeDir} -s /bin/false ${username} 2>/dev/null || ` +
          `sudo useradd -m -d ${homeDir} -s /sbin/nologin ${username}`
        );
        
        // 设置密码
        const setPwd = await this.exec(`echo "${username}:${password}" | sudo chpasswd`);
        if (!setPwd.success) {
          return { success: false, message: '设置密码失败: ' + setPwd.output };
        }
      }

      // 设置目录权限
      await this.exec(`sudo chown ${username}:${username} ${homeDir}`);
      await this.exec(`sudo chmod 755 ${homeDir}`);

      // 创建默认 index.html
      await this.exec(`sudo bash -c 'cat > ${homeDir}/index.html << EOF
<!DOCTYPE html>
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
EOF'`);
      await this.exec(`sudo chown ${username}:${username} ${homeDir}/index.html`);

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
    return new Promise((resolve, reject) => {
      const conn = new Client();

      conn.on('ready', () => {
        conn.sftp((err, sftp) => {
          if (err) {
            conn.end();
            return reject(err);
          }

          const writeStream = sftp.createWriteStream(remotePath);
          
          writeStream.on('close', () => {
            conn.end();
            resolve({ success: true, message: '上传成功' });
          });

          writeStream.on('error', (err) => {
            conn.end();
            reject(err);
          });

          writeStream.end(localBuffer);
        });
      });

      conn.on('error', (err) => {
        reject(err);
      });

      conn.connect({
        host: this.server.ip,
        port: this.server.port || 22,
        username: this.server.username,
        password: this.server.password,
        readyTimeout: 30000
      });
    });
  }
}

module.exports = SshFtpService;
