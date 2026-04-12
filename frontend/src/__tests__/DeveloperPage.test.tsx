import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { meCache } from '../authCache'
import DeveloperPage from '../pages/DeveloperPage'

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

describe('DeveloperPage', () => {
  beforeEach(() => {
    meCache.clear()
    mocks.axiosGet.mockReset()
    mocks.axiosCreate.mockClear()
  })

  it('shows the authenticated user in the navbar after auth resolves', async () => {
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
      <MemoryRouter>
        <DeveloperPage />
      </MemoryRouter>,
    )

    expect(screen.queryByRole('button', { name: 'Login' })).not.toBeInTheDocument()

    resolveMe?.({
      data: { id: 3, username: 'devuser', role: 'admin' },
    })

    expect(await screen.findByText(/devuser/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Logout' })).toBeInTheDocument()
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
      <MemoryRouter>
        <DeveloperPage />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('button', { name: 'Login' })).toBeInTheDocument()
  })
})
