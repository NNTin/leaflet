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

vi.mock('swagger-ui-react', () => ({
  default: function SwaggerUiStub() {
    return <div data-testid="swagger-ui" />
  },
}))

vi.mock('qrcode.react', () => ({
  QRCodeCanvas: function QrCodeCanvasStub() {
    return <div data-testid="qr-code" />
  },
}))

describe('App layout auth state', () => {
  beforeEach(() => {
    meCache.clear()
    providersCache.clear()
    mocks.axiosGet.mockReset()
    mocks.axiosCreate.mockClear()
  })

  it.each([
    {
      label: '/developer',
      initialEntries: ['/developer'],
      heading: 'Developer API',
    },
    {
      label: '/result',
      initialEntries: [{ pathname: '/result', state: { shortUrl: 'https://leaflet.test/s/abc', shortCode: 'abc', expiresAt: null } }],
      heading: 'Your link is ready!',
    },
    {
      label: '/expired',
      initialEntries: ['/expired'],
      heading: 'Link not found',
    },
    {
      label: '/error',
      initialEntries: ['/error'],
      heading: 'Something went wrong',
    },
    {
      label: '/randomstring',
      initialEntries: ['/randomstring'],
      heading: 'Page not found',
    },
  ])('shows the authenticated navbar on $label', async ({ initialEntries, heading }) => {
    mocks.axiosGet.mockImplementation((url: string) => {
      if (url.endsWith('/auth/me')) {
        return Promise.resolve({
          data: { id: 3, username: 'routeuser', role: 'admin' },
        })
      }

      if (url.includes('/api/openapi.json')) {
        return Promise.resolve({ data: { openapi: '3.0.0', info: { title: 'Leaflet', version: '1.0.0' }, paths: {} } })
      }

      throw new Error(`Unexpected axios.get call for ${url}`)
    })

    render(
      <MemoryRouter initialEntries={initialEntries}>
        <App />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
    expect(await screen.findByText(/routeuser/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Logout' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Login' })).not.toBeInTheDocument()
  })

  it('does not show the login button while session state is still loading', async () => {
    let resolveMe: ((value: { data: { id: number; username: string; role: string } }) => void) | undefined

    mocks.axiosGet.mockImplementation((url: string) => {
      if (url.endsWith('/auth/me')) {
        return new Promise((resolve) => {
          resolveMe = resolve
        })
      }

      throw new Error(`Unexpected axios.get call for ${url}`)
    })

    render(
      <MemoryRouter initialEntries={['/expired']}>
        <App />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: 'Link not found' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Login' })).not.toBeInTheDocument()

    resolveMe?.({
      data: { id: 7, username: 'loadinguser', role: 'user' },
    })

    expect(await screen.findByText('loadinguser')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Login' })).not.toBeInTheDocument()
  })

  it('shows the login button for anonymous sessions', async () => {
    mocks.axiosGet.mockImplementation((url: string) => {
      if (url.endsWith('/auth/me')) {
        return Promise.resolve({ data: null })
      }

      throw new Error(`Unexpected axios.get call for ${url}`)
    })

    render(
      <MemoryRouter initialEntries={['/error']}>
        <App />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Login' })).toBeInTheDocument()
  })
})
