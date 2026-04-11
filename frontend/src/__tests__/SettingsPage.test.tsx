import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsPage from '../pages/SettingsPage'

const mocks = vi.hoisted(() => {
  const axiosGet = vi.fn()
  const axiosDelete = vi.fn()
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
    axiosCreate,
  }
})

vi.mock('axios', () => {
  const axios = {
    get: mocks.axiosGet,
    delete: mocks.axiosDelete,
    create: mocks.axiosCreate,
    isAxiosError: (value: unknown) => Boolean((value as { isAxiosError?: boolean } | null)?.isAxiosError),
  }

  return {
    default: axios,
  }
})

describe('SettingsPage', () => {
  beforeEach(() => {
    mocks.axiosGet.mockReset()
    mocks.axiosDelete.mockReset()
    mocks.axiosCreate.mockClear()
  })

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

    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByText('Connected Accounts')).toBeInTheDocument()
    expect(screen.getByText('settingsuser')).toBeInTheDocument()
    expect(await screen.findByText('GitHub')).toBeInTheDocument()
    expect(await screen.findByText('settings@example.com')).toBeInTheDocument()
  })
})
