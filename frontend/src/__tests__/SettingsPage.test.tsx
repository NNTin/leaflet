import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { meCache, providersCache } from '../authCache'
import SettingsPage from '../pages/SettingsPage'
import { SessionProvider } from '../session'

const mocks = vi.hoisted(() => {
  const axiosGet = vi.fn()
  const axiosDelete = vi.fn()
  const axiosPost = vi.fn()
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
    axiosDelete,
    axiosPost,
    axiosCreate,
  }
})

vi.mock('axios', () => {
  const axios = {
    get: mocks.axiosGet,
    delete: mocks.axiosDelete,
    post: mocks.axiosPost,
    create: mocks.axiosCreate,
    isAxiosError: (value: unknown) => Boolean((value as { isAxiosError?: boolean } | null)?.isAxiosError),
  }

  return {
    default: axios,
  }
})

describe('SettingsPage', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/settings')
    meCache.clear()
    providersCache.clear()
    mocks.axiosGet.mockReset()
    mocks.axiosDelete.mockReset()
    mocks.axiosPost.mockReset()
    mocks.axiosCreate.mockClear()
  })

  function renderSettingsPage() {
    render(
      <MemoryRouter>
        <SessionProvider>
          <SettingsPage />
        </SessionProvider>
      </MemoryRouter>,
    )
  }

  it('renders connected accounts when the identities payload is wrapped in an object', async () => {
    mocks.axiosGet.mockImplementation((url: string) => {
      if (url.endsWith('/auth/me')) {
        return Promise.resolve({
          data: { id: 7, username: 'settingsuser', role: 'user' },
        })
      }

      if (url.endsWith('/auth/identities')) {
        return Promise.resolve({
          data: {
            identities: [
              {
                id: 1,
                provider: 'github',
                displayName: null,
                email: 'settings@example.com',
                emailVerified: true,
                connectedAt: '2026-04-11T16:00:00.000Z',
              },
            ],
          },
        })
      }

      if (url.endsWith('/auth/providers')) {
        return Promise.resolve({
          data: [
            { name: 'github', label: 'GitHub' },
            { name: 'google', label: 'Google' },
          ],
        })
      }

      throw new Error(`Unexpected axios.get call for ${url}`)
    })

    renderSettingsPage()

    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByText('Connected Accounts')).toBeInTheDocument()
    expect(await screen.findByText('GitHub')).toBeInTheDocument()
    expect(await screen.findByText('settings@example.com')).toBeInTheDocument()
  })

  it('surfaces provider link conflicts and can merge the duplicate account', async () => {
    window.history.pushState({}, '', '/settings?auth=link_conflict&provider=google&conflictingUserId=17')

    let identitiesRequestCount = 0

    mocks.axiosGet.mockImplementation((url: string) => {
      if (url.endsWith('/auth/me')) {
        return Promise.resolve({
          data: { id: 18, username: 'b6d', role: 'user' },
        })
      }

      if (url.endsWith('/auth/providers')) {
        return Promise.resolve({
          data: [
            { name: 'discord', label: 'Discord' },
            { name: 'google', label: 'Google' },
          ],
        })
      }

      if (url.endsWith('/auth/identities')) {
        identitiesRequestCount += 1

        if (identitiesRequestCount === 1) {
          return Promise.resolve({
            data: [
              {
                id: 10,
                provider: 'discord',
                displayName: 'b6d',
                email: 'whoisreading@this.com',
                emailVerified: true,
                connectedAt: '2026-04-11T18:47:06.000Z',
              },
            ],
          })
        }

        return Promise.resolve({
          data: [
            {
              id: 10,
              provider: 'discord',
              displayName: 'b6d',
              email: 'whoisreading@this.com',
              emailVerified: true,
              connectedAt: '2026-04-11T18:47:06.000Z',
            },
            {
              id: 9,
              provider: 'google',
              displayName: 'Tin Nguyen',
              email: 'nguyen.ngoctindaniel@gmail.com',
              emailVerified: true,
              connectedAt: '2026-04-11T18:36:50.000Z',
            },
          ],
        })
      }

      if (url.endsWith('/auth/csrf-token')) {
        return Promise.resolve({
          data: { csrfToken: 'csrf-token' },
        })
      }

      throw new Error(`Unexpected axios.get call for ${url}`)
    })

    mocks.axiosPost.mockImplementation((url: string, body: unknown) => {
      if (url.endsWith('/auth/merge/initiate')) {
        expect(body).toEqual({ targetUserId: 17 })
        return Promise.resolve({
          data: { mergeToken: 'merge-token' },
        })
      }

      if (url.endsWith('/auth/merge/confirm')) {
        expect(body).toEqual({ mergeToken: 'merge-token' })
        return Promise.resolve({
          data: { success: true },
        })
      }

      throw new Error(`Unexpected axios.post call for ${url}`)
    })

    renderSettingsPage()

    expect(await screen.findByRole('heading', { name: 'Account merge required' })).toBeInTheDocument()
    expect(screen.getByText(/already connected to another Leaflet account/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Merge accounts' }))

    expect(await screen.findByText('Google is now connected after merging the duplicate account.')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('Tin Nguyen')).toBeInTheDocument()
    })

    expect(window.location.search).toBe('')
  })

  it('clears stale link conflict params when the provider is already connected', async () => {
    window.history.pushState({}, '', '/settings?auth=link_conflict&provider=google&conflictingUserId=17')

    mocks.axiosGet.mockImplementation((url: string) => {
      if (url.endsWith('/auth/me')) {
        return Promise.resolve({
          data: { id: 18, username: 'b6d', role: 'user' },
        })
      }

      if (url.endsWith('/auth/providers')) {
        return Promise.resolve({
          data: [
            { name: 'discord', label: 'Discord' },
            { name: 'google', label: 'Google' },
          ],
        })
      }

      if (url.endsWith('/auth/identities')) {
        return Promise.resolve({
          data: [
            {
              id: 10,
              provider: 'discord',
              displayName: 'b6d',
              email: 'whoisreading@this.com',
              emailVerified: true,
              connectedAt: '2026-04-11T18:47:06.000Z',
            },
            {
              id: 9,
              provider: 'google',
              displayName: 'Tin Nguyen',
              email: 'nguyen.ngoctindaniel@gmail.com',
              emailVerified: true,
              connectedAt: '2026-04-11T18:36:50.000Z',
            },
          ],
        })
      }

      throw new Error(`Unexpected axios.get call for ${url}`)
    })

    renderSettingsPage()

    expect(await screen.findByText('Google is already connected to this account.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Account merge required' })).not.toBeInTheDocument()
    expect(window.location.search).toBe('')
  })
})
