export function parseTagList(tags) {
  if (!tags) return []
  return tags.split(',').map((tag) => tag.trim()).filter(Boolean)
}

export function isTagFilterable(tagMeta) {
  return tagMeta?.is_filterable !== 0
}

export function getFilterableTagNames(serverTags = []) {
  return serverTags.filter(isTagFilterable).map((tag) => tag.name)
}

export function getDomainFilterableTags(domain, serverTags = []) {
  const domainTags = parseTagList(domain?.tags)
  const filterableNames = new Set(getFilterableTagNames(serverTags))
  return domainTags.filter((tag) => filterableNames.has(tag))
}

export function serverHasAnyTag(server, tagNames = []) {
  if (!tagNames.length) return false
  const serverTags = parseTagList(server?.tags)
  return tagNames.some((tag) => serverTags.includes(tag))
}

export function groupServersByDomainTags(servers = [], domain, serverTags = []) {
  const activeServers = servers.filter((server) => server.status !== 'disabled')
  const domainFilterTags = getDomainFilterableTags(domain, serverTags)

  if (domainFilterTags.length === 0) {
    return [{ label: '全部服务器', servers: activeServers }]
  }

  const matched = activeServers.filter((server) => serverHasAnyTag(server, domainFilterTags))
  const others = activeServers.filter((server) => !serverHasAnyTag(server, domainFilterTags))
  const groups = []

  if (matched.length > 0) {
    groups.push({
      label: `匹配标签（${domainFilterTags.join('、')}）`,
      servers: matched
    })
  }
  if (others.length > 0) {
    groups.push({ label: '其他服务器', servers: others })
  }

  return groups.length > 0 ? groups : [{ label: '全部服务器', servers: activeServers }]
}

export function flattenServerGroups(groups = []) {
  return groups.flatMap((group) => group.servers)
}

export function pickDefaultServerForDomain(servers = [], domain, serverTags = []) {
  const activeServers = servers.filter((server) => server.status !== 'disabled')
  const domainFilterTags = getDomainFilterableTags(domain, serverTags)

  if (domainFilterTags.length > 0) {
    const matched = activeServers.filter((server) => serverHasAnyTag(server, domainFilterTags))
    if (matched.length > 0) {
      return matched.find((server) => server.is_default === 1) || matched[0]
    }
  }

  return activeServers.find((server) => server.is_default === 1) || activeServers[0] || null
}

export function getTagStyle(tagName, serverTags = []) {
  const tag = serverTags.find((item) => item.name === tagName)
  if (!tag?.color) return {}
  return {
    backgroundColor: tag.color,
    borderColor: tag.color,
    color: '#fff'
  }
}
