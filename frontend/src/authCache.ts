import axios from 'axios'
import { authUrl } from './urls'

export interface AuthUser {
  id: number;
  username: string;
  role: string;
}

const CACHE_TTL_MS = 45_000

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

function makeCache<T>() {
  let entry: CacheEntry<T> | null = null

  return {
    get(): T | null {
      if (entry && Date.now() < entry.expiresAt) return entry.data
      return null
    },
    set(data: T): void {
      entry = { data, expiresAt: Date.now() + CACHE_TTL_MS }
    },
    clear(): void {
      entry = null
    },
  }
}

export const meCache = makeCache<AuthUser | null>()
export const providersCache = makeCache<string[]>()

export async function fetchMe(): Promise<AuthUser | null> {
  const cached = meCache.get()
  if (cached !== null) return cached
  const res = await axios.get<AuthUser | null>(authUrl('/me'), { withCredentials: true })
  meCache.set(res.data)
  return res.data
}
