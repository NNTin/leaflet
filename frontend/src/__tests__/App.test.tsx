import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import App from '../App'

describe('App routes', () => {
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
})
