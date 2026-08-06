// SSL证书申请服务 (使用acme.sh)

const CERT_PATH = '/www/certs';

// 证书类型配置
const CERT_TYPES = {
  letsencrypt: {
    name: "Let's Encrypt",
    server: '--server letsencrypt',
    desc: '免费，90天有效期'
  },
  zerossl: {
    name: 'ZeroSSL',
    server: '--server zerossl',
    desc: '免费，90天有效期'
  },
  buypass: {
    name: 'Buypass',
    server: '--server buypass',
    desc: '免费，180天有效期'
  },
  google: {
    name: 'Google Trust Services',
    server: '--server google',
    desc: '免费，90天有效期'
  }
};

// 验证方式
const VERIFY_METHODS = {
  dns_aliyun: { name: '阿里云DNS', dns: 'dns_ali', envKeys: ['Ali_Key', 'Ali_Secret'] },
  dns_tencent: { name: '腾讯云DNS', dns: 'dns_tencent', envKeys: ['Tencent_SecretId', 'Tencent_SecretKey'] },
  dns_cloudflare: { name: 'Cloudflare', dns: 'dns_cf', envKeys: ['CF_Email', 'CF_Key'] },
  dns_dnspod: { name: 'DNSPod', dns: 'dns_dp', envKeys: ['DP_Id', 'DP_Key'] },
  dns_huawei: { name: '华为云DNS', dns: 'dns_huaweicloud', envKeys: ['HUAWEICLOUD_Username', 'HUAWEICLOUD_Password', 'HUAWEICLOUD_ProjectID'] },
  dns_godaddy: { name: 'GoDaddy', dns: 'dns_gd', envKeys: ['GD_Key', 'GD_Secret'] },
  http: { name: 'HTTP验证', dns: null, desc: '需要80端口可访问' }
};

// 获取证书路径 (通配符证书)
function getCertPath(domain) {
  return {
    dir: `${CERT_PATH}/${domain}`,
    cert: `${CERT_PATH}/${domain}/${domain}.crt`,
    key: `${CERT_PATH}/${domain}/${domain}.key`,
    fullchain: `${CERT_PATH}/${domain}/${domain}.fullchain.crt`
  };
}

// 生成DNS验证环境变量
function getDnsEnvVars(platform, accessKey, secretKey) {
  const { decryptSecret } = require('../utils/secret-crypto');
  const key = decryptSecret(accessKey);
  const secret = decryptSecret(secretKey);
  const method = VERIFY_METHODS[`dns_${platform}`] || VERIFY_METHODS.dns_aliyun;

  switch (platform) {
    case 'aliyun':
      return `export Ali_Key="${key}"\nexport Ali_Secret="${secret}"`;
    case 'tencent':
      // 腾讯云DNS使用 Tencent_SecretId 和 Tencent_SecretKey
      return `export Tencent_SecretId="${key}"\nexport Tencent_SecretKey="${secret}"`;
    case 'dnspod':
      return `export DP_Id="${key}"\nexport DP_Key="${secret}"`;
    case 'cloudflare':
      return `export CF_Email="${key}"\nexport CF_Key="${secret}"`;
    case 'huawei':
      return `export HUAWEICLOUD_Username="${key}"\nexport HUAWEICLOUD_Password="${secret}"`;
    case 'godaddy':
      return `export GD_Key="${key}"\nexport GD_Secret="${secret}"`;
    default:
      return `export Ali_Key="${key}"\nexport Ali_Secret="${secret}"`;
  }
}

// 获取DNS验证类型
function getDnsType(platform) {
  const mapping = {
    aliyun: 'dns_ali',
    tencent: 'dns_tencent',  // 腾讯云DNS使用 dns_tencent
    dnspod: 'dns_dp',
    cloudflare: 'dns_cf',
    huawei: 'dns_huaweicloud',
    godaddy: 'dns_gd'
  };
  return mapping[platform] || 'dns_ali';
}

// 生成申请通配符证书的命令 (DNS验证)
function getIssueWildcardCommand(domain, certType, platform, accessKey, secretKey) {
  const paths = getCertPath(domain);
  const server = CERT_TYPES[certType]?.server || CERT_TYPES.letsencrypt.server;
  const envVars = getDnsEnvVars(platform, accessKey, secretKey);
  const dnsType = getDnsType(platform);
  
  return `
# 创建证书目录
mkdir -p ${paths.dir}

# 设置DNS API环境变量
${envVars}

echo "=== 开始申请证书 ==="
echo "域名: ${domain}, *.${domain}"
echo "DNS类型: ${dnsType}"
echo "证书服务: ${server}"

# 使用DNS验证方式申请通配符证书 (*.domain.com 和 domain.com)
~/.acme.sh/acme.sh --issue ${server} -d ${domain} -d "*.${domain}" --dns ${dnsType} --force --debug 2>&1

# 检查证书是否申请成功
ACME_CERT=~/.acme.sh/${domain}_ecc/${domain}.cer
if [ ! -f "$ACME_CERT" ]; then
  ACME_CERT=~/.acme.sh/${domain}/${domain}.cer
fi

if [ -f "$ACME_CERT" ]; then
  echo "=== 证书申请成功，开始安装 ==="
  # 安装证书到指定目录
  ~/.acme.sh/acme.sh --install-cert -d ${domain} \\
    --key-file ${paths.key} \\
    --fullchain-file ${paths.fullchain} \\
    --cert-file ${paths.cert} \\
    --reloadcmd "nginx -s reload 2>/dev/null || systemctl reload nginx 2>/dev/null || true" 2>&1
  echo "=== 证书安装完成 ==="
else
  echo "=== 证书申请失败，证书文件不存在 ==="
  echo "检查路径: ~/.acme.sh/${domain}_ecc/ 或 ~/.acme.sh/${domain}/"
  ls -la ~/.acme.sh/ 2>/dev/null | head -20
fi
`.trim();
}

// 生成申请单域名证书的命令 (HTTP验证，不需要DNS)
function getIssueHttpCommand(domain, certType, webroot) {
  const paths = getCertPath(domain);
  const server = CERT_TYPES[certType]?.server || CERT_TYPES.letsencrypt.server;
  const webrootPath = webroot || `/www/wwwroot/ftp/${domain}`;
  
  return `
# 创建证书目录
mkdir -p ${paths.dir}

# 创建webroot目录
mkdir -p ${webrootPath}/.well-known/acme-challenge

echo "=== 开始申请证书 (HTTP验证) ==="
echo "域名: ${domain}"
echo "Webroot: ${webrootPath}"

# 使用HTTP验证方式申请证书 (仅主域名，不支持通配符)
~/.acme.sh/acme.sh --issue ${server} -d ${domain} -w ${webrootPath} --force --debug 2>&1

# 检查证书是否申请成功
ACME_CERT=~/.acme.sh/${domain}_ecc/${domain}.cer
if [ ! -f "$ACME_CERT" ]; then
  ACME_CERT=~/.acme.sh/${domain}/${domain}.cer
fi

if [ -f "$ACME_CERT" ]; then
  echo "=== 证书申请成功，开始安装 ==="
  ~/.acme.sh/acme.sh --install-cert -d ${domain} \\
    --key-file ${paths.key} \\
    --fullchain-file ${paths.fullchain} \\
    --cert-file ${paths.cert} \\
    --reloadcmd "nginx -s reload 2>/dev/null || systemctl reload nginx 2>/dev/null || true" 2>&1
  echo "=== 证书安装完成 ==="
else
  echo "=== 证书申请失败 ==="
fi
`.trim();
}

// 生成申请单域名证书的命令 (Standalone模式，需要停止nginx)
function getIssueStandaloneCommand(domain, certType) {
  const paths = getCertPath(domain);
  const server = CERT_TYPES[certType]?.server || CERT_TYPES.letsencrypt.server;
  
  return `
# 创建证书目录
mkdir -p ${paths.dir}

echo "=== 开始申请证书 (Standalone模式) ==="
echo "域名: ${domain}"

# 临时停止nginx释放80端口
systemctl stop nginx 2>/dev/null || nginx -s stop 2>/dev/null || true

# 使用Standalone模式申请证书
~/.acme.sh/acme.sh --issue ${server} -d ${domain} --standalone --force --debug 2>&1

# 重启nginx
systemctl start nginx 2>/dev/null || nginx 2>/dev/null || true

# 检查证书是否申请成功
ACME_CERT=~/.acme.sh/${domain}_ecc/${domain}.cer
if [ ! -f "$ACME_CERT" ]; then
  ACME_CERT=~/.acme.sh/${domain}/${domain}.cer
fi

if [ -f "$ACME_CERT" ]; then
  echo "=== 证书申请成功，开始安装 ==="
  ~/.acme.sh/acme.sh --install-cert -d ${domain} \\
    --key-file ${paths.key} \\
    --fullchain-file ${paths.fullchain} \\
    --cert-file ${paths.cert} \\
    --reloadcmd "nginx -s reload 2>/dev/null || systemctl reload nginx 2>/dev/null || true" 2>&1
  echo "=== 证书安装完成 ==="
else
  echo "=== 证书申请失败 ==="
fi
`.trim();
}

// 生成续期命令
function getRenewCommand(domain, isWildcard = true) {
  const paths = getCertPath(domain);
  const domainArg = isWildcard ? `-d ${domain} -d "*.${domain}"` : `-d ${domain}`;
  
  return `
~/.acme.sh/acme.sh --renew ${domainArg} --force

~/.acme.sh/acme.sh --install-cert -d ${domain} \\
  --key-file ${paths.key} \\
  --fullchain-file ${paths.fullchain} \\
  --cert-file ${paths.cert} \\
  --reloadcmd "nginx -s reload 2>/dev/null || systemctl reload nginx 2>/dev/null || true"
`.trim();
}

// 检查证书状态命令
function getCheckCommand(domain) {
  const paths = getCertPath(domain);
  return `
if [ -f "${paths.fullchain}" ]; then
  echo "CERT_EXISTS=true"
  openssl x509 -in ${paths.fullchain} -noout -dates 2>/dev/null | grep -E "notBefore|notAfter"
  openssl x509 -in ${paths.fullchain} -noout -issuer 2>/dev/null
  openssl x509 -in ${paths.fullchain} -noout -text 2>/dev/null | grep -A1 "Subject Alternative Name" | tail -1
else
  echo "CERT_EXISTS=false"
fi
`.trim();
}

// 安装acme.sh命令 (先用国内镜像，失败再用官方)
function getInstallAcmeCommand(email) {
  return `
if [ ! -f ~/.acme.sh/acme.sh ]; then
  echo "=== 开始安装acme.sh ==="
  
  # 先尝试国内gitee镜像
  echo "尝试使用国内镜像安装..."
  rm -rf /tmp/acme.sh 2>/dev/null
  git clone https://gitee.com/neilpang/acme.sh.git /tmp/acme.sh 2>&1
  
  if [ -f /tmp/acme.sh/acme.sh ]; then
    cd /tmp/acme.sh && ./acme.sh --install -m ${email} 2>&1
    rm -rf /tmp/acme.sh
  fi
  
  # 如果国内镜像失败，尝试官方安装
  if [ ! -f ~/.acme.sh/acme.sh ]; then
    echo "国内镜像安装失败，尝试官方安装..."
    curl https://get.acme.sh | sh -s email=${email} 2>&1
  fi
  
  # 最后检查是否安装成功
  if [ -f ~/.acme.sh/acme.sh ]; then
    echo "=== acme.sh安装成功 ==="
  else
    echo "=== acme.sh安装失败 ==="
  fi
fi
~/.acme.sh/acme.sh --version 2>&1
`.trim();
}

module.exports = {
  CERT_PATH,
  CERT_TYPES,
  VERIFY_METHODS,
  getCertPath,
  getDnsEnvVars,
  getDnsType,
  getIssueWildcardCommand,
  getIssueHttpCommand,
  getIssueStandaloneCommand,
  getRenewCommand,
  getCheckCommand,
  getInstallAcmeCommand
};
