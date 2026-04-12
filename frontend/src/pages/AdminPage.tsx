import { useEffect, useState } from 'react'
import axios from 'axios'
import LoadingSpinner from '../components/LoadingSpinner'
import { csrfHeaders } from '../api'
import { adminUrl, shortUrl } from '../urls'
import { useSession } from '../session'
import styles from './AdminPage.module.css'

const adminApi = axios.create({ baseURL: adminUrl(''), withCredentials: true })

interface User {
  id: number;
  username: string;
  role: string;
  createdAt?: string;
}

interface LinkItem {
  id: number;
  shortCode: string;
  originalUrl: string;
  createdAt?: string;
  expiresAt?: string | null;
  createdBy?: string | null;
}

export default function AdminPage() {
  const { user, loading } = useSession()
  const [tab, setTab] = useState('links')

  const [links, setLinks] = useState<LinkItem[]>([])
  const [linksLoading, setLinksLoading] = useState(false)
  const [linksError, setLinksError] = useState('')

  const [users, setUsers] = useState<User[]>([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [usersError, setUsersError] = useState('')

  const [actionMsg, setActionMsg] = useState('')
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    if (user?.role !== 'admin') return
    if (tab === 'links') void fetchLinks()
    if (tab === 'users') void fetchUsers()
  }, [tab, user])

  async function fetchLinks() {
    setLinksLoading(true)
    setLinksError('')
    try {
      const res = await adminApi.get<LinkItem[] | { urls: LinkItem[] }>('/urls')
      setLinks(Array.isArray(res.data) ? res.data : res.data.urls ?? [])
    } catch (err) {
      setLinksError(axios.isAxiosError(err) ? err.response?.data?.error ?? 'Failed to load links.' : 'Failed to load links.')
    } finally {
      setLinksLoading(false)
    }
  }

  async function fetchUsers() {
    setUsersLoading(true)
    setUsersError('')
    try {
      const res = await adminApi.get<User[] | { users: User[] }>('/users')
      setUsers(Array.isArray(res.data) ? res.data : res.data.users ?? [])
    } catch (err) {
      setUsersError(axios.isAxiosError(err) ? err.response?.data?.error ?? 'Failed to load users.' : 'Failed to load users.')
    } finally {
      setUsersLoading(false)
    }
  }

  function clearMessages() {
    setActionMsg('')
    setActionError('')
  }

  async function deleteLink(id: number) {
    clearMessages()
    try {
      const headers = await csrfHeaders()
      await adminApi.delete(`/urls/${id}`, { headers })
      setLinks(prev => prev.filter(l => l.id !== id))
      setActionMsg('Link deleted.')
    } catch (err) {
      setActionError(axios.isAxiosError(err) ? err.response?.data?.error ?? 'Failed to delete link.' : 'Failed to delete link.')
    }
  }

  async function setUserRole(userId: number, role: string) {
    clearMessages()
    try {
      const headers = await csrfHeaders()
      await adminApi.patch(`/users/${userId}/role`, { role }, { headers })
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, role } : u))
      setActionMsg(`User role updated to "${role}".`)
    } catch (err) {
      setActionError(axios.isAxiosError(err) ? err.response?.data?.error ?? 'Failed to update user role.' : 'Failed to update user role.')
    }
  }

  if (loading) {
    return (
      <main className={styles.main}>
        <LoadingSpinner />
      </main>
    )
  }

  if (!user || user.role !== 'admin') {
    return (
      <main className={styles.main}>
        <div className={`card ${styles.forbiddenCard}`}>
          <div className={styles.forbiddenIcon}>🚫</div>
          <h1 className={styles.forbiddenTitle}>Access Denied</h1>
          <p className={styles.forbiddenMsg}>
            You must be an administrator to view this page.
          </p>
        </div>
      </main>
    )
  }

  return (
    <div className={`page-container-wide ${styles.content}`}>
      <h1 className={styles.heading}>Admin Dashboard</h1>

      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${tab === 'links' ? styles.tabActive : ''}`}
          onClick={() => setTab('links')}
        >
          🔗 Links
        </button>
        <button
          className={`${styles.tab} ${tab === 'users' ? styles.tabActive : ''}`}
          onClick={() => setTab('users')}
        >
          👥 Users
        </button>
      </div>

      {(actionMsg || actionError) && (
        <div className={actionError ? 'error-msg' : 'success-msg'} style={{ marginBottom: '1rem' }}>
          {actionMsg || actionError}
        </div>
      )}

        {tab === 'links' && (
          <div className={`card ${styles.tableCard}`}>
            <div className={styles.tableHeader}>
              <h2 className={styles.tableTitle}>All Links</h2>
              <button onClick={() => void fetchLinks()} className="btn btn-secondary btn-sm">↻ Refresh</button>
            </div>
            {linksLoading ? (
              <div className={styles.center}><LoadingSpinner /></div>
            ) : linksError ? (
              <div className="error-msg">{linksError}</div>
            ) : links.length === 0 ? (
              <p className={styles.empty}>No links found.</p>
            ) : (
              <div className={styles.tableWrapper}>
                <table>
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Original URL</th>
                      <th>Created</th>
                      <th>Expires</th>
                      <th>Created By</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {links.map(link => (
                      <tr key={link.id}>
                        <td>
                          <a
                            href={shortUrl(link.shortCode)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={styles.codeLink}
                          >
                            {link.shortCode}
                          </a>
                        </td>
                        <td>
                          <a
                            href={link.originalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="truncate"
                            title={link.originalUrl}
                          >
                            {link.originalUrl}
                          </a>
                        </td>
                        <td>{link.createdAt ? new Date(link.createdAt).toLocaleDateString() : '—'}</td>
                        <td>{link.expiresAt ? new Date(link.expiresAt).toLocaleString() : 'Never'}</td>
                        <td>{link.createdBy ?? '—'}</td>
                        <td>
                          <button
                            onClick={() => void deleteLink(link.id)}
                            className="btn btn-danger btn-sm"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === 'users' && (
          <div className={`card ${styles.tableCard}`}>
            <div className={styles.tableHeader}>
              <h2 className={styles.tableTitle}>All Users</h2>
              <button onClick={() => void fetchUsers()} className="btn btn-secondary btn-sm">↻ Refresh</button>
            </div>
            {usersLoading ? (
              <div className={styles.center}><LoadingSpinner /></div>
            ) : usersError ? (
              <div className="error-msg">{usersError}</div>
            ) : users.length === 0 ? (
              <p className={styles.empty}>No users found.</p>
            ) : (
              <div className={styles.tableWrapper}>
                <table>
                  <thead>
                    <tr>
                      <th>Username</th>
                      <th>Role</th>
                      <th>Created</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(u => (
                      <tr key={u.id}>
                        <td className={styles.username}>{u.username}</td>
                        <td>
                          <span className={`${styles.roleBadge} ${styles[`role_${u.role}`]}`}>
                            {u.role}
                          </span>
                        </td>
                        <td>{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}</td>
                        <td className={styles.actionCell}>
                          {u.role === 'user' && (
                            <button
                              onClick={() => void setUserRole(u.id, 'privileged')}
                              className="btn btn-secondary btn-sm"
                            >
                              Make Privileged
                            </button>
                          )}
                          {u.role === 'privileged' && (
                            <button
                              onClick={() => void setUserRole(u.id, 'user')}
                              className="btn btn-secondary btn-sm"
                            >
                              Make User
                            </button>
                          )}
                          {u.role === 'admin' && (
                            <span className={styles.adminNote}>Admin</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
    </div>
  )
}
