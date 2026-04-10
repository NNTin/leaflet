import axios from 'axios'
import { apiUrl, authUrl } from './urls'

const api = axios.create({
  baseURL: apiUrl(''),
  withCredentials: true,
})

let csrfToken: string | null = null

async function fetchCsrfToken(): Promise<void> {
  try {
    const res = await axios.get<{ csrfToken?: string; token?: string }>(authUrl('/csrf-token'), { withCredentials: true })
    csrfToken = res.data?.csrfToken ?? res.data?.token ?? null
  } catch {
    csrfToken = null
  }
}

async function csrfHeaders(): Promise<Record<string, string>> {
  if (!csrfToken) {
    await fetchCsrfToken()
  }
  return csrfToken ? { 'X-CSRF-Token': csrfToken } : {}
}

api.interceptors.request.use(async (config) => {
  const mutating = ['post', 'put', 'patch', 'delete']
  if (mutating.includes(config.method?.toLowerCase() ?? '')) {
    const headers = await csrfHeaders()
    if (headers['X-CSRF-Token']) {
      config.headers['X-CSRF-Token'] = headers['X-CSRF-Token']
    }
  }
  return config
})

api.interceptors.response.use(
  (res) => res,
  async (err: unknown) => {
    if (axios.isAxiosError(err) && err.response?.status === 403 && csrfToken) {
      csrfToken = null
    }
    return Promise.reject(err)
  }
)

export { csrfHeaders, fetchCsrfToken }
export default api
