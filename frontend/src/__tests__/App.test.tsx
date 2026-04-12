import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { meCache, providersCache } from '../authCache'
import App from '../App'

const mocks = vi.hoisted(() => {
  const axiosGet = vi.fn()
  const axiosCreate = vi.fn(() => ({
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  }))

  return {
    axiosGet,
    axiosCreate,
  }
})

vi.mock('axios', () => {
  const axios = {
    get: mocks.axiosGet,
    create: mocks.axiosCreate,
    isAxiosError: (value: unknown) => Boolean((value as { isAxiosError?: boolean } | null)?.isAxiosError),
  }

  return {
    default: axios,
  }
})

describe('App routes', () => {
  beforeEach(() => {
    meCache.clear()
    providersCache.clear()
    mocks.axiosGet.mockReset()
    mocks.axiosCreate.mockClear()

    mocks.axiosGet.mockImplementation((url: string) => {
      if (url.endsWith('/auth/me')) {
        return Promise.resolve({ data: null })
      }

      if (url.endsWith('/auth/providers')) {
        return Promise.resolve({ data: [{ name: 'github', label: 'GitHub' }] })
      }

      throw new Error(`Unexpected axios.get call for ${url}`)
    })
  })

  it('renders the generic error page on /error', async () => {
    render(
      <MemoryRouter initialEntries={['/error']}>
        <App />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument()
    expect(screen.getByText('500')).toBeInTheDocument()
  })

  it('renders the 404 page for unknown routes', async () => {
    render(
      <MemoryRouter initialEntries={['/randomstring']}>
        <App />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
    expect(screen.getByText('404')).toBeInTheDocument()
    expect(screen.getByText('The page you are looking for does not exist or has been moved.')).toBeInTheDocument()
  })

  it('renders the login handoff page on /login', async () => {
    render(
      <MemoryRouter initialEntries={['/login?returnTo=https%3A%2F%2Fnntin.xyz%2Fleafspots%2F']}>
        <App />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: 'Sign in to Leaflet' })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: /continue with github/i })).toBeInTheDocument()
  })
})
