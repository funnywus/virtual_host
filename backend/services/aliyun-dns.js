const https = require('https');
const crypto = require('crypto');

class AliyunDns {
  constructor(accessKey, secretKey) {
    this.accessKey = accessKey;
    this.secretKey = secretKey;
    this.endpoint = 'alidns.cn-hangzhou.aliyuncs.com';
  }

  sign(params) {
    const sortedKeys = Object.keys(params).sort();
    const canonicalizedQuery = sortedKeys
      .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
      .join('&');
    
    const stringToSign = `GET&${encodeURIComponent('/')}&${encodeURIComponent(canonicalizedQuery)}`;
    
    const signature = crypto
      .createHmac('sha1', this.secretKey + '&')
      .update(stringToSign)
      .digest('base64');
    
    return signature;
  }

  getCommonParams() {
    return {
      Format: 'JSON',
      Version: '2015-01-09',
      AccessKeyId: this.accessKey,
      SignatureMethod: 'HMAC-SHA1',
      Timestamp: new Date().toISOString().replace(/\.\d{3}/, ''),
      SignatureVersion: '1.0',
      SignatureNonce: Math.random().toString(36).substring(2)
    };
  }

  request(action, params = {}) {
    return new Promise((resolve, reject) => {
      const allParams = {
        ...this.getCommonParams(),
        Action: action,
        ...params
      };
      
      allParams.Signature = this.sign(allParams);
      
      const query = Object.keys(allParams)
        .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(allParams[key])}`)
        .join('&');
      
      const options = {
        hostname: this.endpoint,
        path: `/?${query}`,
        method: 'GET'
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            if (result.Code) {
              reject(new Error(result.Message || result.Code));
            } else {
              resolve(result);
            }
          } catch (e) {
            reject(e);
          }
        });
      });

      req.on('error', reject);
      req.end();
    });
  }

  async addRecord(domain, rr, value, type = 'A', ttl = 600) {
    const result = await this.request('AddDomainRecord', {
      DomainName: domain,
      RR: rr,
      Type: type,
      Value: value,
      TTL: ttl
    });
    return result.RecordId;
  }

  async deleteRecord(recordId) {
    return this.request('DeleteDomainRecord', { RecordId: recordId });
  }

  async getRecords(domain) {
    return this.request('DescribeDomainRecords', { DomainName: domain });
  }
}

module.exports = AliyunDns;
