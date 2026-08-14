export const qk = {
  tags: ['tags'],
  users: ['users'],
  domains: ['domains'],
  servers: ['servers'],
  dnsPlatforms: ['dns-platforms'],
  ftp: (page, pageSize, keyword) => ['ftp', page, pageSize, keyword],
  subdomains: (params) => ['subdomains', params]
}
