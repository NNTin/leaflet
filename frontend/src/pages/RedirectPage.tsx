import { useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import LoadingSpinner from '../components/LoadingSpinner'
import { shortUrl } from '../urls'

export default function RedirectPage() {
  const { code } = useParams<{ code: string }>()
  const navigate = useNavigate()

  useEffect(() => {
    if (!code) {
      navigate('/expired')
      return
    }

    window.location.replace(shortUrl(code))
  }, [code, navigate])

  return <LoadingSpinner fullPage />
}
