const STORAGE_KEY = 'admin_remember_credentials'
const DEVICE_KEY = 'admin_remember_device_key'
const LEGACY_KEY = 'remembered_user_info'

function toBase64(bytes) {
  return btoa(String.fromCharCode(...bytes))
}

function fromBase64(value) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0))
}

async function getCryptoKey() {
  let deviceKey = localStorage.getItem(DEVICE_KEY)
  if (!deviceKey) {
    deviceKey = toBase64(crypto.getRandomValues(new Uint8Array(32)))
    localStorage.setItem(DEVICE_KEY, deviceKey)
  }

  return crypto.subtle.importKey(
    'raw',
    fromBase64(deviceKey),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  )
}

async function encryptText(text) {
  const key = await getCryptoKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(text)
  )
  const payload = new Uint8Array(iv.length + encrypted.byteLength)
  payload.set(iv, 0)
  payload.set(new Uint8Array(encrypted), iv.length)
  return toBase64(payload)
}

async function decryptText(payload) {
  const key = await getCryptoKey()
  const bytes = fromBase64(payload)
  const iv = bytes.slice(0, 12)
  const data = bytes.slice(12)
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data)
  return new TextDecoder().decode(decrypted)
}

function readLegacyCredentials() {
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null')
    if (legacy?.username) {
      return { username: legacy.username, password: '' }
    }
  } catch {
    localStorage.removeItem(LEGACY_KEY)
  }
  return null
}

export async function loadRememberedCredentials() {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return readLegacyCredentials()
  }

  try {
    const saved = JSON.parse(raw)
    if (!saved?.username || !saved?.passwordEnc) {
      clearRememberedCredentials()
      return null
    }

    const password = await decryptText(saved.passwordEnc)
    return {
      username: saved.username,
      password
    }
  } catch {
    clearRememberedCredentials()
    return null
  }
}

export async function saveRememberedCredentials(username, password) {
  const trimmedUsername = username.trim()
  if (!trimmedUsername || !password) return

  const passwordEnc = await encryptText(password)
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      v: 1,
      username: trimmedUsername,
      passwordEnc
    })
  )
  localStorage.removeItem(LEGACY_KEY)
}

export function clearRememberedCredentials() {
  localStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem(LEGACY_KEY)
}
