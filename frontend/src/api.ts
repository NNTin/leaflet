import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
})

let csrfToken: string | null = null

async function fetchCsrfToken(): Promise<void> {
  try {
    const res = await axios.get<{ csrfToken?: string; token?: string }>('/auth/csrf-token', { withCredentials: true })
    csrfToken = res.data?.csrfToken ?? res.data?.token ?? null
  } catch {
    csrfToken = null
  }
}

api.interceptors.request.use(async (config) => {
  const mutating = ['post', 'put', 'patch', 'delete']
  if (mutating.includes(config.method?.toLowerCase() ?? '')) {
    if (!csrfToken) {
      await fetchCsrfToken()
    }
    if (csrfToken) {
      config.headers['X-CSRF-Token'] = csrfToken
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

export { fetchCsrfToken }
export default api
