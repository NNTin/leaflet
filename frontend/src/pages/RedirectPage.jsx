import React, { useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import LoadingSpinner from '../components/LoadingSpinner'

export default function RedirectPage() {
  const { code } = useParams()
  const navigate = useNavigate()

  useEffect(() => {
    if (!code) {
      navigate('/expired')
      return
    }

    // Call the backend redirect endpoint directly.
    // The backend returns 302; axios follows redirects, so we use fetch
    // with redirect:'manual' to intercept the Location header.
    fetch(`/api/${code}`, {
      method: 'GET',
      credentials: 'include',
      redirect: 'manual',
    })
      .then(res => {
        if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
          const location = res.headers.get('Location')
          if (location) {
            window.location.href = location
          } else {
            // Fallback: navigate browser directly to backend URL
            window.location.href = `/api/${code}`
          }
        } else if (res.status === 404 || res.status === 410) {
          navigate('/expired')
        } else if (res.ok) {
          // Some backends return 200 with a redirect URL in JSON
          res.json().then(data => {
            if (data?.url) {
              window.location.href = data.url
            } else {
              navigate('/expired')
            }
          }).catch(() => navigate('/expired'))
        } else {
          navigate('/expired')
        }
      })
      .catch(() => navigate('/expired'))
  }, [code, navigate])

  return <LoadingSpinner fullPage />
}
