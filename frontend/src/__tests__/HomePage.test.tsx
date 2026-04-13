import { fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { meCache, providersCache } from '../authCache'
import HomePage from '../pages/HomePage'
import { SessionProvider } from '../session'
import { RateLimitError } from '../rateLimit'

const mocks = vi.hoisted(() => {
  const apiPost = vi.fn()
  const apiGet = vi.fn()
  const csrfHeaders = vi.fn(() => Promise.resolve({ 'X-CSRF-Token': 'test-csrf' }))
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

  return { apiPost, apiGet, csrfHeaders, axiosGet, axiosCreate }
})

vi.mock('axios', () => {
  return {
    default: {
      get: mocks.axiosGet,
      create: mocks.axiosCreate,
      isAxiosError: (value: unknown) => Boolean((value as { isAxiosError?: boolean } | null)?.isAxiosError),
    },
  }
})

// Mock the api module to avoid the complex axios.create chain.
vi.mock('../api', () => {
  return {
    default: {
      get: mocks.apiGet,
      post: mocks.apiPost,
    },
    csrfHeaders: mocks.csrfHeaders,
  }
})

function makeAxiosError(status: number, data: unknown = {}, headers: Record<string, string> = {}) {
  return Object.assign(new Error('Request failed'), {
    isAxiosError: true,
    response: { status, data, headers },
  })
}

function renderHomePage() {
  return render(
    <MemoryRouter>
      <SessionProvider>
        <HomePage />
      </SessionProvider>
    </MemoryRouter>,
  )
}

describe('HomePage', () => {
  beforeEach(() => {
    meCache.clear()
    providersCache.clear()
    mocks.axiosGet.mockReset()
    mocks.axiosCreate.mockClear()
    mocks.apiPost.mockReset()
    mocks.apiGet.mockReset()
    mocks.csrfHeaders.mockReset()
    mocks.csrfHeaders.mockResolvedValue({ 'X-CSRF-Token': 'test-csrf' })

    mocks.axiosGet.mockImplementation((url: string) => {
      if (url.endsWith('/auth/me')) {
        return Promise.resolve({ data: null })
      }
      throw new Error(`Unexpected GET: ${url}`)
    })

    mocks.apiGet.mockImplementation((url: string) => {
      if (url === '/shorten/capabilities') {
        return Promise.resolve({
          data: {
            authenticated: false,
            anonymous: true,
            role: null,
            shortenAllowed: true,
            aliasingAllowed: false,
            neverAllowed: false,
            ttlOptions: [
              { value: '5m', label: '5 minutes' },
              { value: '1h', label: '1 hour' },
              { value: '24h', label: '24 hours' },
            ],
          },
        })
      }
      throw new Error(`Unexpected api.get: ${url}`)
    })
  })

  it('renders the shorten form', async () => {
    renderHomePage()
    expect(await screen.findByLabelText('Paste your long URL')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /shorten url/i })).toBeInTheDocument()
  })

  it('shows submit button enabled by default', async () => {
    renderHomePage()
    const btn = await screen.findByRole('button', { name: /shorten url/i })
    expect(btn).not.toBeDisabled()
  })

  it('shows MM:SS countdown and disables button when POST /api/shorten returns 429', async () => {
    renderHomePage()

    const btn = await screen.findByRole('button', { name: /shorten url/i })
    const urlInput = screen.getByLabelText('Paste your long URL')

    fireEvent.change(urlInput, { target: { value: 'https://example.com' } })

    mocks.apiPost.mockRejectedValueOnce(
      makeAxiosError(429, { error: 'Rate limit exceeded.' }, { 'retry-after': '90' })
    )

    fireEvent.click(btn)

    // Button should show MM:SS and be disabled
    await waitFor(() => {
      const submitBtn = screen.getByRole('button', { name: /\d+:\d+/ })
      expect(submitBtn).toBeDisabled()
      // Must be MM:SS format (two digits colon two digits)
      expect(submitBtn.textContent).toMatch(/\d{2}:\d{2}/)
    })

    // Rate limit message visible
    expect(screen.getByText(/too many requests/i)).toBeInTheDocument()
  })

  it('does not auto-submit when countdown expires (button re-enables but stays idle)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })

    try {
      renderHomePage()

      await screen.findByRole('button', { name: /shorten url/i })
      fireEvent.change(screen.getByLabelText('Paste your long URL'), {
        target: { value: 'https://example.com' },
      })

      mocks.apiPost.mockRejectedValueOnce(
        makeAxiosError(429, {}, { 'retry-after': '1' })
      )

      fireEvent.click(screen.getByRole('button', { name: /shorten url/i }))

      // Button should be disabled with countdown
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /\d+:\d+/ })).toBeDisabled()
      })

      // Advance time past the deadline
      act(() => {
        vi.advanceTimersByTime(3_000)
      })

      // Button should re-enable and show original label
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /shorten url/i })).not.toBeDisabled()
      })

      // No automatic post should have been made (only the one that got 429)
      expect(mocks.apiPost).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows rate-limit state when CSRF bootstrap returns 429', async () => {
    renderHomePage()

    const btn = await screen.findByRole('button', { name: /shorten url/i })
    const urlInput = screen.getByLabelText('Paste your long URL')

    fireEvent.change(urlInput, { target: { value: 'https://example.com' } })

    // Simulate CSRF bootstrap 429: the request interceptor in api.ts throws
    // RateLimitError when fetchCsrfToken() returns 429. We reproduce that here
    // by making api.post reject with the same RateLimitError.
    mocks.apiPost.mockRejectedValueOnce(new RateLimitError('45'))

    fireEvent.click(btn)

    // Should show countdown on button
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /\d+:\d+/ })).toBeDisabled()
    })
  })

  it('formats countdown as MM:SS with zero-padding', async () => {
    renderHomePage()

    await screen.findByRole('button', { name: /shorten url/i })
    fireEvent.change(screen.getByLabelText('Paste your long URL'), {
      target: { value: 'https://example.com' },
    })

    mocks.apiPost.mockRejectedValueOnce(
      makeAxiosError(429, {}, { 'retry-after': '125' }) // 2:05
    )

    fireEvent.click(screen.getByRole('button', { name: /shorten url/i }))

    await waitFor(() => {
      // Format should be MM:SS with colon and zero-padding
      const countdownBtn = screen.getByRole('button', { name: /\d+:\d+/ })
      expect(countdownBtn.textContent).toMatch(/\d{2}:\d{2}/)
      // Seconds part should be zero-padded (e.g. 02:05 not 2:5)
      const match = countdownBtn.textContent?.match(/(\d+):(\d+)/)
      expect(match?.[1]).toHaveLength(2)
      expect(match?.[2]).toHaveLength(2)
    })
  })
})
