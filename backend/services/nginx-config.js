// Nginx配置模板生成器

const NGINX_PATH = '/www/server/panel/vhost/nginx';
const CERT_PATH = '/www/certs';

// 限流配置模板
const rateLimitConfig = (options = {}) => {
  const {
    enabled = false,
    rate = '10r/s',        // 每秒请求数
    burst = 20,            // 突发请求数
    nodelay = true,        // 是否延迟
    conn_limit = 10        // 并发连接数限制
  } = options;

  if (!enabled) return '';

  return `
    # 限流配置
    limit_req_zone $binary_remote_addr zone=one:10m rate=${rate};
    limit_conn_zone $binary_remote_addr zone=addr:10m;
    
    # 应用限流
    limit_req zone=one burst=${burst}${nodelay ? ' nodelay' : ''};
    limit_conn addr ${conn_limit};
    
    # 限流错误页面
    limit_req_status 429;
    limit_conn_status 429;
`;
};

// 获取证书路径 (使用主域名的通配符证书)
function getCertPaths(domain) {
  const parts = domain.split('.');
  const mainDomain = parts.length > 2 ? parts.slice(-2).join('.') : domain;
  return {
    fullchain: `${CERT_PATH}/${mainDomain}/${mainDomain}.fullchain.crt`,
    key: `${CERT_PATH}/${mainDomain}/${mainDomain}.key`
  };
}

// HTTP基础模板
const httpTemplate = (domain, rootPath, rateLimitOpts = {}) => {
  const rateLimitConf = rateLimitConfig(rateLimitOpts);
  
  return `server {
    listen 80;
    server_name ${domain};
    index index.php index.html index.htm;
    root ${rootPath};

    # 日志
    access_log /www/wwwlogs/${domain}.log;
    error_log /www/wwwlogs/${domain}.error.log;
${rateLimitConf}
    # 禁止访问隐藏文件
    location ~ /\\. {
        deny all;
    }

    # PHP配置
    location ~ \\.php$ {
        fastcgi_pass unix:/tmp/php-cgi.sock;
        fastcgi_index index.php;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        include fastcgi_params;
    }

    # 静态文件缓存
    location ~ \\.(gif|jpg|jpeg|png|bmp|swf|ico)$ {
        expires 30d;
        access_log off;
    }

    location ~ \\.(js|css)?$ {
        expires 12h;
        access_log off;
    }
}`;
};

// HTTPS模板
const httpsTemplate = (domain, rootPath, sslCertPath, sslKeyPath, rateLimitOpts = {}) => {
  const certPaths = getCertPaths(domain);
  const certPath = sslCertPath || certPaths.fullchain;
  const keyPath = sslKeyPath || certPaths.key;
  const rateLimitConf = rateLimitConfig(rateLimitOpts);
  
  return `server {
    listen 80;
    server_name ${domain};
    # 强制跳转HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ${domain};
    index index.php index.html index.htm;
    root ${rootPath};

    # SSL证书配置 (证书路径: ${CERT_PATH}/主域名/)
    ssl_certificate ${certPath};
    ssl_certificate_key ${keyPath};
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES128-GCM-SHA256:HIGH:!aNULL:!MD5:!RC4:!DHE;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # 日志
    access_log /www/wwwlogs/${domain}.log;
    error_log /www/wwwlogs/${domain}.error.log;
${rateLimitConf}
    # 禁止访问隐藏文件
    location ~ /\\. {
        deny all;
    }

    # PHP配置
    location ~ \\.php$ {
        fastcgi_pass unix:/tmp/php-cgi.sock;
        fastcgi_index index.php;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        include fastcgi_params;
    }

    # 静态文件缓存
    location ~ \\.(gif|jpg|jpeg|png|bmp|swf|ico)$ {
        expires 30d;
        access_log off;
    }

    location ~ \\.(js|css)?$ {
        expires 12h;
        access_log off;
    }
}`;
};

// 反向代理模板
const proxyTemplate = (domain, proxyPass) => `server {
    listen 80;
    server_name ${domain};

    location / {
        proxy_pass ${proxyPass};
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 60s;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
    }

    access_log /www/wwwlogs/${domain}.log;
    error_log /www/wwwlogs/${domain}.error.log;
}`;

// 生成配置
function generateConfig(type, domain, options = {}) {
  const rootPath = options.rootPath || `/www/wwwroot/ftp/${domain}`;
  const rateLimitOpts = options.rateLimit || {};
  
  // 如果提供了mainDomain，使用它来获取证书路径
  let sslCertPath = options.sslCertPath;
  let sslKeyPath = options.sslKeyPath;
  
  if (!sslCertPath && options.mainDomain) {
    sslCertPath = `${CERT_PATH}/${options.mainDomain}/${options.mainDomain}.fullchain.crt`;
    sslKeyPath = `${CERT_PATH}/${options.mainDomain}/${options.mainDomain}.key`;
  }
  
  switch (type) {
    case 'http':
      return httpTemplate(domain, rootPath, rateLimitOpts);
    case 'https':
      return httpsTemplate(domain, rootPath, sslCertPath, sslKeyPath, rateLimitOpts);
    case 'proxy':
      return proxyTemplate(domain, options.proxyPass || 'http://127.0.0.1:3000');
    default:
      return httpTemplate(domain, rootPath, rateLimitOpts);
  }
}

// 获取配置文件路径
function getConfigPath(domain) {
  return `${NGINX_PATH}/${domain}.conf`;
}

module.exports = {
  generateConfig,
  getConfigPath,
  getCertPaths,
  rateLimitConfig,
  NGINX_PATH,
  CERT_PATH,
  templates: {
    http: httpTemplate,
    https: httpsTemplate,
    proxy: proxyTemplate
  }
};
