import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LoginPage from '../pages/LoginPage'

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

vi.mock('axios', () => ({
  default: {
    get: mocks.axiosGet,
    create: mocks.axiosCreate,
    isAxiosError: (value: unknown) => Boolean((value as { isAxiosError?: boolean } | null)?.isAxiosError),
  },
}))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

function makeAxiosError(status: number, data: unknown = {}, headers: Record<string, string> = {}) {
  return Object.assign(new Error('Request failed'), {
    isAxiosError: true,
    response: { status, data, headers },
  })
}

function renderLoginPage(entry = '/login') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <LoginPage />
    </MemoryRouter>,
  )
}

describe('LoginPage', () => {
  beforeEach(() => {
    mocks.axiosGet.mockReset()
    mocks.axiosCreate.mockClear()
    fetchMock.mockReset()
  })

  it('preserves returnTo on provider handoff and keeps auth-flow rate limits inline', async () => {
    mocks.axiosGet.mockResolvedValueOnce({
      data: [{ name: 'github', label: 'GitHub' }],
    })

    fetchMock.mockResolvedValueOnce({
      status: 429,
      headers: { get: (name: string) => (name === 'retry-after' ? '60' : null) },
    })

    const originalLocation = window.location
    let capturedHref: string | undefined
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...originalLocation,
        get href() { return capturedHref ?? '' },
        set href(value: string) { capturedHref = value },
      },
    })

    try {
      renderLoginPage('/login?returnTo=https%3A%2F%2Fnntin.xyz%2Fleafspots%2F')

      expect(await screen.findByRole('heading', { name: 'Sign in to Leaflet' })).toBeInTheDocument()

      const githubLink = await screen.findByRole('link', { name: /continue with github/i })
      expect(githubLink.getAttribute('href')).toContain('returnTo=https%3A%2F%2Fnntin.xyz%2Fleafspots%2F')

      await act(async () => {
        fireEvent.click(githubLink)
        await Promise.resolve()
      })

      await waitFor(() => {
        expect(screen.getByText(/sign-in rate limited/i)).toBeInTheDocument()
      })
      expect(capturedHref).toBeUndefined()
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
    }
  })

  it('shows provider-list rate limits inline on the handoff page', async () => {
    mocks.axiosGet.mockRejectedValueOnce(
      makeAxiosError(429, { error: 'Rate limit exceeded.' }, { 'retry-after': '30' }),
    )

    renderLoginPage()

    expect(await screen.findByRole('heading', { name: 'Sign in to Leaflet' })).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByText(/sign-in options temporarily unavailable/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/retrying in \d+:\d+/i)).toBeInTheDocument()
  })
})
