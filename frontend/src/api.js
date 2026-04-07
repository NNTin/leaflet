import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
})

let csrfToken = null

async function fetchCsrfToken() {
  try {
    const res = await axios.get('/auth/csrf-token', { withCredentials: true })
    csrfToken = res.data?.csrfToken || res.data?.token || null
  } catch {
    csrfToken = null
  }
}

// Attach CSRF token to mutating requests
api.interceptors.request.use(async (config) => {
  const mutating = ['post', 'put', 'patch', 'delete']
  if (mutating.includes(config.method?.toLowerCase())) {
    if (!csrfToken) {
      await fetchCsrfToken()
    }
    if (csrfToken) {
      config.headers['X-CSRF-Token'] = csrfToken
    }
  }
  return config
})

// If a 403 is returned, the CSRF token may have rotated — reset it
api.interceptors.response.use(
  (res) => res,
  async (err) => {
    if (err.response?.status === 403 && csrfToken) {
      csrfToken = null
    }
    return Promise.reject(err)
  }
)

export { fetchCsrfToken }
export default api
