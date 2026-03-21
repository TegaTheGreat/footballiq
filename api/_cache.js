// =============================================================
// api/_cache.js — Upstash Redis cache layer
// Uses REST API — no npm packages needed
// Falls back to in-memory for local dev or if Redis isn't set up
// =============================================================

const memoryCache = {}

function getRedisConfig() {
  // Support both Upstash naming conventions
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
  return url && token ? { url, token } : null
}

export async function cacheGet(key) {
  const redis = getRedisConfig()
  if (!redis) return memoryCache[key] || null

  try {
    const res = await fetch(`${redis.url}/get/${key}`, {
      headers: { Authorization: `Bearer ${redis.token}` },
    })
    const data = await res.json()
    if (!data.result) return memoryCache[key] || null
    try {
      return JSON.parse(data.result)
    } catch {
      return data.result
    }
  } catch (e) {
    console.log('Redis GET error:', e.message)
    return memoryCache[key] || null
  }
}

export async function cacheSet(key, value, ttlSeconds) {
  memoryCache[key] = value
  const redis = getRedisConfig()
  if (!redis) return true

  try {
    const body = ttlSeconds
      ? ['SET', key, JSON.stringify(value), 'EX', ttlSeconds]
      : ['SET', key, JSON.stringify(value)]

    await fetch(redis.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redis.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    return true
  } catch (e) {
    console.log('Redis SET error:', e.message)
    return false
  }
}

export function hasRedis() {
  return !!getRedisConfig()
}
