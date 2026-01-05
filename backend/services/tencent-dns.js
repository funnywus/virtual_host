const crypto = require('crypto');
const https = require('https');

class TencentDns {
  constructor(secretId, secretKey) {
    this.secretId = secretId;
    this.secretKey = secretKey;
    this.host = 'dnspod.tencentcloudapi.com';
    this.service = 'dnspod';
    this.version = '2021-03-23';
  }

  // 生成签名
  sign(params, timestamp, date) {
    const canonicalHeaders = `content-type:application/json\nhost:${this.host}\n`;
    const signedHeaders = 'content-type;host';
    const hashedPayload = crypto.createHash('sha256').update(JSON.stringify(params)).digest('hex');
    const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${hashedPayload}`;
    
    const credentialScope = `${date}/${this.service}/tc3_request`;
    const hashedCanonicalRequest = crypto.createHash('sha256').update(canonicalRequest).digest('hex');
    const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${hashedCanonicalRequest}`;
    
    const secretDate = crypto.createHmac('sha256', `TC3${this.secretKey}`).update(date).digest();
    const secretService = crypto.createHmac('sha256', secretDate).update(this.service).digest();
    const secretSigning = crypto.createHmac('sha256', secretService).update('tc3_request').digest();
    const signature = crypto.createHmac('sha256', secretSigning).update(stringToSign).digest('hex');
    
    return `TC3-HMAC-SHA256 Credential=${this.secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  }

  // 发送请求
  request(action, params = {}) {
    return new Promise((resolve, reject) => {
      const timestamp = Math.floor(Date.now() / 1000);
      const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
      const authorization = this.sign(params, timestamp, date);
      
      const options = {
        hostname: this.host,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Host': this.host,
          'X-TC-Action': action,
          'X-TC-Version': this.version,
          'X-TC-Timestamp': timestamp.toString(),
          'Authorization': authorization
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            if (result.Response?.Error) {
              reject(new Error(result.Response.Error.Message));
            } else {
              resolve(result.Response);
            }
          } catch (e) {
            reject(new Error('解析响应失败'));
          }
        });
      });

      req.on('error', reject);
      req.write(JSON.stringify(params));
      req.end();
    });
  }

  // 添加DNS记录
  async addRecord(domain, subdomain, value, type = 'A', ttl = 600) {
    const result = await this.request('CreateRecord', {
      Domain: domain,
      SubDomain: subdomain === '@' ? '@' : subdomain,
      RecordType: type,
      RecordLine: '默认',
      Value: value,
      TTL: ttl
    });
    return result.RecordId?.toString();
  }

  // 更新DNS记录
  async updateRecord(domain, recordId, subdomain, value, type = 'A', ttl = 600) {
    await this.request('ModifyRecord', {
      Domain: domain,
      RecordId: parseInt(recordId),
      SubDomain: subdomain === '@' ? '@' : subdomain,
      RecordType: type,
      RecordLine: '默认',
      Value: value,
      TTL: ttl
    });
    return true;
  }

  // 删除DNS记录
  async deleteRecord(domain, recordId) {
    await this.request('DeleteRecord', {
      Domain: domain,
      RecordId: parseInt(recordId)
    });
    return true;
  }

  // 获取域名列表（用于测试连接）
  async getDomainList() {
    return await this.request('DescribeDomainList', { Offset: 0, Limit: 1 });
  }
}

module.exports = TencentDns;
