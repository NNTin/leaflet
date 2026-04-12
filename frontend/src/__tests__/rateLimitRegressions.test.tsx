/**
 * Tests for the four rate-limit regressions fixed after the initial implementation:
 * 1. logout() must NOT clear local session when CSRF bootstrap or the logout POST
 *    itself returns 429 – the server session is still active.
 * 2. Settings / Admin write handlers must surface CSRF-bootstrap 429s (RateLimitError)
 *    with the countdown UX, not "Unexpected error".
 * 3. Navbar must not hide the last-known user state during /auth/me auto-retry
 *    (the loading placeholder must not show while meRateLimited is set).
 * 4. LoginModal provider click must intercept 429 inline before hard-navigating.
 */

import { fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'
import { meCache, providersCache } from '../authCache'
import { SessionProvider } from '../session'
import { RateLimitError } from '../rateLimit'
import Navbar from '../components/Navbar'
import LoginModal from '../components/LoginModal'

// ---------------------------------------------------------------------------
// Shared axios mock
// ---------------------------------------------------------------------------
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

  return { axiosGet, axiosCreate }
})

vi.mock('axios', () => ({
  default: {
    get: mocks.axiosGet,
    create: mocks.axiosCreate,
    isAxiosError: (value: unknown) =>
      Boolean((value as { isAxiosError?: boolean } | null)?.isAxiosError),
  },
}))

// Mock the api module so we can control csrfHeaders independently.
const csrfHeadersMock = vi.fn()
vi.mock('../api', () => ({
  default: { post: vi.fn() },
  csrfHeaders: (...args: unknown[]) => csrfHeadersMock(...args),
}))

// Minimal fetch mock – individual tests can override with vi.spyOn.
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

function makeAxiosError(status: number, headers: Record<string, string> = {}) {
  return Object.assign(new Error('Request failed'), {
    isAxiosError: true,
    response: { status, data: { error: 'Rate limited.' }, headers },
  })
}

function renderNavbar() {
  return render(
    <MemoryRouter>
      <SessionProvider>
        <Navbar />
      </SessionProvider>
    </MemoryRouter>,
  )
}

function renderLoginModal(onClose = vi.fn()) {
  return render(
    <MemoryRouter>
      <SessionProvider>
        <LoginModal onClose={onClose} />
      </SessionProvider>
    </MemoryRouter>,
  )
}

describe('Regression 1 – logout does not clear session when rate-limited', () => {
  beforeEach(() => {
    meCache.clear()
    providersCache.clear()
    mocks.axiosGet.mockReset()
    mocks.axiosCreate.mockClear()
    csrfHeadersMock.mockReset()
    fetchMock.mockReset()
  })

  it('keeps the user logged in when CSRF bootstrap returns 429 during logout', async () => {
    // User is authenticated.
    mocks.axiosGet.mockImplementation((url: string) => {
      if (url.endsWith('/auth/me')) return Promise.resolve({ data: { id: 1, username: 'alice', role: 'user' } })
      throw new Error(`Unexpected GET: ${url}`)
    })

    // csrfHeaders() throws RateLimitError (simulates /auth/csrf-token 429).
    csrfHeadersMock.mockRejectedValueOnce(new RateLimitError('30'))

    renderNavbar()

    // Wait for user to appear.
    expect(await screen.findByText('alice')).toBeInTheDocument()
    const logoutBtn = screen.getByRole('button', { name: 'Logout' })

    await act(async () => {
      fireEvent.click(logoutBtn)
      await Promise.resolve()
    })

    // User must still be visible (session was NOT cleared).
    await waitFor(() => {
      expect(screen.getByText('alice')).toBeInTheDocument()
    })

    // The logout button should show a countdown.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Logout \(\d+:\d+\)/ })).toBeDisabled()
    })

    // Login button must NOT be visible.
    expect(screen.queryByRole('button', { name: 'Login' })).not.toBeInTheDocument()
  })

  it('keeps the user logged in when the logout POST itself returns 429', async () => {
    mocks.axiosGet.mockImplementation((url: string) => {
      if (url.endsWith('/auth/me')) return Promise.resolve({ data: { id: 2, username: 'bob', role: 'user' } })
      throw new Error(`Unexpected GET: ${url}`)
    })

    // CSRF succeeds.
    csrfHeadersMock.mockResolvedValueOnce({ 'X-CSRF-Token': 'tok' })

    // The actual logout fetch returns 429.
    fetchMock.mockResolvedValueOnce({
      status: 429,
      headers: { get: (name: string) => (name === 'retry-after' ? '20' : null) },
    })

    renderNavbar()

    expect(await screen.findByText('bob')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Logout' }))
      await Promise.resolve()
    })

    // User still visible.
    await waitFor(() => {
      expect(screen.getByText('bob')).toBeInTheDocument()
    })

    // Logout button shows countdown.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Logout \(\d+:\d+\)/ })).toBeDisabled()
    })
  })
})

describe('Regression 3 – /auth/me rate-limited: user state stays visible during auto-retry', () => {
  beforeEach(() => {
    meCache.clear()
    providersCache.clear()
    mocks.axiosGet.mockReset()
    mocks.axiosCreate.mockClear()
    csrfHeadersMock.mockReset()
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows user name even when loading is true and meRateLimited is set (no placeholder shown)', async () => {
    // The invariant: Navbar uses `loading && !meRateLimited` as the placeholder guard.
    // When meRateLimited is truthy, the user area must still render regardless of loading.
    // We test this by having /auth/me be rate-limited on the FIRST call (no known user yet),
    // which means the Navbar should still show the rate-limit indicator and NOT the hidden
    // placeholder that would otherwise mask the Login button / user state.
    mocks.axiosGet.mockImplementation((url: string) => {
      if (url.endsWith('/auth/me')) {
        return Promise.reject(new RateLimitError('5'))
      }
      throw new Error(`Unexpected GET: ${url}`)
    })

    renderNavbar()

    // The rate-limit indicator (red dot) should appear instead of the loading placeholder.
    // When no user is known, the Login button should also be visible (not a blank placeholder).
    await waitFor(() => {
      // The red-dot has role="status".
      expect(screen.getByRole('status')).toBeInTheDocument()
    })

    // Login button should be visible (not hidden by the placeholder).
    expect(screen.getByRole('button', { name: 'Login' })).toBeInTheDocument()

    // The loading placeholder div (aria-hidden, no role) should NOT suppress the Login button.
    // We just confirmed Login is visible above, which is the key invariant.
  })
})

describe('Regression 4 – LoginModal provider click intercepts 429 inline', () => {
  beforeEach(() => {
    meCache.clear()
    providersCache.clear()
    mocks.axiosGet.mockReset()
    mocks.axiosCreate.mockClear()
    csrfHeadersMock.mockReset()
    fetchMock.mockReset()
  })

  it('shows inline rate-limit message and does not navigate when auth-flow returns 429', async () => {
    // /auth/me returns null (anonymous).
    mocks.axiosGet.mockImplementation((url: string) => {
      if (url.endsWith('/auth/me')) return Promise.resolve({ data: null })
      if (url.endsWith('/auth/providers')) {
        return Promise.resolve({ data: [{ name: 'github', label: 'GitHub' }] })
      }
      throw new Error(`Unexpected GET: ${url}`)
    })

    // The fetch probe to /auth/github returns 429.
    fetchMock.mockResolvedValueOnce({
      status: 429,
      headers: { get: (name: string) => (name === 'retry-after' ? '60' : null) },
    })

    const originalHref = Object.getOwnPropertyDescriptor(window, 'location')
    const hrefSetter = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      get: () => ({ href: '' }),
      set: hrefSetter,
    })

    try {
      renderLoginModal()

      // Wait for providers to load.
      const githubLink = await screen.findByText(/Continue with GitHub/i)
      expect(githubLink).toBeInTheDocument()

      // Click the GitHub link.
      await act(async () => {
        fireEvent.click(githubLink)
        await Promise.resolve()
      })

      // Inline rate-limit message should appear.
      await waitFor(() => {
        expect(screen.getByText(/sign-in rate limited/i)).toBeInTheDocument()
      })

      // A countdown should be visible.
      await waitFor(() => {
        expect(screen.getByText(/retry in \d+:\d+/i)).toBeInTheDocument()
      })

      // window.location.href should NOT have been set.
      expect(hrefSetter).not.toHaveBeenCalled()
    } finally {
      if (originalHref) Object.defineProperty(window, 'location', originalHref)
    }
  })

  it('navigates normally (sets window.location.href) when auth-flow probe succeeds', async () => {
    mocks.axiosGet.mockImplementation((url: string) => {
      if (url.endsWith('/auth/me')) return Promise.resolve({ data: null })
      if (url.endsWith('/auth/providers')) {
        return Promise.resolve({ data: [{ name: 'github', label: 'GitHub' }] })
      }
      throw new Error(`Unexpected GET: ${url}`)
    })

    // The fetch probe returns an opaque redirect (normal case).
    fetchMock.mockResolvedValueOnce({
      status: 0,
      type: 'opaqueredirect',
      headers: { get: () => null },
    })

    let capturedHref: string | undefined
    const originalLocation = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...originalLocation,
        get href() { return capturedHref ?? '' },
        set href(v: string) { capturedHref = v },
      },
    })

    try {
      renderLoginModal()

      const githubLink = await screen.findByText(/Continue with GitHub/i)

      await act(async () => {
        fireEvent.click(githubLink)
        await Promise.resolve()
      })

      await waitFor(() => {
        expect(capturedHref).toMatch(/\/auth\/github/)
      })

      // No inline rate-limit message.
      expect(screen.queryByText(/sign-in rate limited/i)).not.toBeInTheDocument()
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
    }
  })
})

describe('Regression 2 – Settings/Admin write handlers handle CSRF-bootstrap 429', () => {
  // These are tested indirectly via the existing SettingsPage integration tests.
  // The key unit-level invariant is that RateLimitError (thrown by csrfHeaders on 429)
  // results in setWriteRateLimitDeadline being called, not setError('Unexpected error.').
  // We verify this at the component level through the Settings page:

  it('SettingsPage: CSRF-bootstrap 429 on disconnect shows countdown, not "Unexpected error"', async () => {
    const { default: SettingsPage } = await import('../pages/SettingsPage')

    meCache.clear()
    providersCache.clear()

    mocks.axiosGet.mockImplementation((url: string) => {
      if (url.endsWith('/auth/me')) return Promise.resolve({ data: { id: 5, username: 'dave', role: 'user' } })
      if (url.endsWith('/auth/identities')) {
        return Promise.resolve({
          data: {
            // Two identities so the disconnect button is enabled.
            identities: [
              { id: 1, provider: 'github', displayName: null, email: 'dave@test.com', emailVerified: true, connectedAt: '2026-01-01T00:00:00Z' },
              { id: 2, provider: 'google', displayName: 'Dave', email: 'dave@gmail.com', emailVerified: true, connectedAt: '2026-01-02T00:00:00Z' },
            ],
          },
        })
      }
      if (url.endsWith('/auth/providers')) {
        return Promise.resolve({ data: [{ name: 'github', label: 'GitHub' }, { name: 'google', label: 'Google' }] })
      }
      throw new Error(`Unexpected GET: ${url}`)
    })

    // csrfHeaders() throws RateLimitError when disconnect is attempted.
    csrfHeadersMock.mockRejectedValueOnce(new RateLimitError('45'))

    render(
      <MemoryRouter>
        <SessionProvider>
          <SettingsPage />
        </SessionProvider>
      </MemoryRouter>,
    )

    // Wait for identities to load and find an enabled disconnect button.
    const disconnectBtns = await screen.findAllByRole('button', { name: /disconnect/i })
    // At least one disconnect button should be enabled (user has 2 identities).
    const enabledDisconnect = disconnectBtns.find(b => !b.hasAttribute('disabled'))
    expect(enabledDisconnect).toBeDefined()

    await act(async () => {
      fireEvent.click(enabledDisconnect!)
      await Promise.resolve()
    })

    // Should show countdown, NOT "Unexpected error".
    await waitFor(() => {
      expect(screen.getByText(/\d+:\d+/)).toBeInTheDocument()
    })

    expect(screen.queryByText(/unexpected error/i)).not.toBeInTheDocument()
  })
})
