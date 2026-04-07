import { useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import LoadingSpinner from '../components/LoadingSpinner'

export default function RedirectPage() {
  const { code } = useParams<{ code: string }>()
  const navigate = useNavigate()

  useEffect(() => {
    if (!code) {
      navigate('/expired')
      return
    }

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
            window.location.href = `/api/${code}`
          }
        } else if (res.status === 404 || res.status === 410) {
          navigate('/expired')
        } else if (res.ok) {
          res.json().then((data: { url?: string }) => {
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
